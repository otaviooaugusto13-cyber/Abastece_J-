// Despacho: depois que o roteador escolheu o departamento, AVISA a equipe certa — sem depender de alguém abrir o painel.
//   Painel     o chamado já está na fila do departamento (TI: /painel-ti · ADM e Suporte: /painel-admin → Chamados). Sempre acontece.
//   Push       ADM e Suporte: aviso no aparelho dos administradores (FCM, o mesmo canal do chat de suporte).
//   Chat       webhook de entrada por departamento (Slack, Discord, Google Chat, Teams ou JSON genérico), configurado por variável de ambiente:
//                CHAMADOS_WEBHOOK_TI | CHAMADOS_WEBHOOK_ADM | CHAMADOS_WEBHOOK_SUPORTE   (ou CHAMADOS_WEBHOOK_URL para todos)
//                CHAMADOS_WEBHOOK_SEGREDO   opcional: assina o corpo (HMAC-SHA256) no cabeçalho X-Abastece-Assinatura (receptores genéricos)
//   Melhor esforço: NUNCA lança e nunca atrasa a resposta ao usuário; o resultado fica numa nota interna do chamado.
// Privacidade: o canal do ADM/Suporte recebe resumo (sem stack trace, sem arquivo); o do TI recebe também as primeiras linhas da stack. Nunca vai uid, e-mail ou documento.
const crypto = require("crypto");
const K = require("./constantes");

const TIMEOUT_MS = 5000, LIMITE_POR_MIN = 20;
const ICONE = { alta: "🟠", media: "🟡", baixa: "🟢", critica: "🔴" };
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const linhas = (txt, n) => String(txt || "").split("\n").slice(0, n).map((l) => l.trim()).filter(Boolean).join("\n");

function criarDespacho({ suporte, chamados, env = () => process.env, fetchFn = (...a) => globalThis.fetch(...a), appUrl = () => process.env.APP_URL || "" }) {
  const janelas = { ti: [], adm: [], suporte: [] };   // timestamps dos últimos avisos por departamento (freio contra tempestade)
  const ultimos = new Set();                          // promessas em andamento: os testes aguardam por aqui; em produção ninguém espera

  const urlPainel = (t) => { const base = String(appUrl()).replace(/\/$/, ""), d = t.departamento || K.DEPARTAMENTO_PADRAO; return d === "ti" ? `${base}/painel-ti?chamado=${t.id}` : `${base}/painel-admin?chamado=${t.id}#chamados`; };

  /** O que chega para a equipe. Mesma estrutura para os três departamentos; só o nível de detalhe técnico muda. */
  function montarPayload(t) {
    const dep = t.departamento || K.DEPARTAMENTO_PADRAO, l = t.logsTecnicos || {}, c = t.classificacao || {}, ehTI = dep === "ti";
    const erro = { nome: l.nome || "", mensagem: l.mensagem || "", rota: l.rota || "", status: l.status || null, codigo: l.codigo || "", tela: l.tela || "", perfil: l.perfil || "",
      ...(ehTI ? { origem: l.origem || "", arquivo: l.arquivo || "", stack: linhas(l.stack, 6) } : {}) };
    const p = {
      evento: "chamado.aberto", versao: 1, em: new Date().toISOString(),
      departamento: dep, setor: K.DEPARTAMENTO_NOME[dep], prioridade: t.prioridade, prazoPrimeiroRetornoEm: iso(t.slaAtendMs),
      chamado: { id: t.id, protocolo: t.protocolo, titulo: t.titulo, categoria: t.categoria, status: t.status, origem: t.origem, criadoEm: iso(t.criadoMs) },
      roteamento: { motivo: c.motivo || "", confianca: c.confianca || "", sinais: c.sinais || [] },
      solicitante: { tipo: t.solicitanteTipo || "", nome: t.solicitanteNome || "" },
      erro, links: { painel: urlPainel(t) }
    };
    const onde = [erro.rota && `Rota: ${erro.rota}`, erro.status && `status ${erro.status}`, erro.codigo && `código ${erro.codigo}`].filter(Boolean).join(" · ");
    p.texto = [
      `${ICONE[t.prioridade] || "🟡"} Novo chamado ${t.protocolo} → ${p.setor}`,
      `Prioridade: ${t.prioridade} · Roteamento: ${c.confianca || "n/d"}${c.motivo ? ` (${c.motivo})` : ""}`,
      `Solicitante: ${p.solicitante.nome || "—"}${p.solicitante.tipo ? ` (${p.solicitante.tipo})` : ""}`,
      `Erro: ${[erro.nome, erro.mensagem].filter(Boolean).join(" — ").slice(0, 300) || t.titulo}`,
      onde, ehTI && erro.stack ? `Stack:\n${erro.stack}` : "", `Abrir: ${p.links.painel}`
    ].filter(Boolean).join("\n").slice(0, 1900);
    return p;
  }

  const urlDoDepartamento = (dep, e) => { const u = String(e[`CHAMADOS_WEBHOOK_${dep.toUpperCase()}`] || e.CHAMADOS_WEBHOOK_URL || "").trim(); return /^https:\/\/[^\s/]+\.[^\s/]+/.test(u) ? u : ""; };
  /** Cada chat espera um formato: Discord quer "content"; Slack/Google Chat/Teams aceitam "text"; o resto recebe o payload completo + "text". */
  function corpoPara(url, p) {
    const host = new URL(url).hostname;
    if (/(^|\.)discord(app)?\.com$/.test(host)) return { content: p.texto, username: "Abastece Já · Chamados" };
    if (/(^|\.)(slack\.com|googleapis\.com|office\.com|office365\.com|webhook\.office\.com)$/.test(host)) return { text: p.texto };
    return { text: p.texto, ...p };
  }
  async function enviarWebhook(dep, p, e) {
    const url = urlDoDepartamento(dep, e); if (!url) return { canal: "webhook", ok: false, motivo: "nao-configurado" };
    const corpo = JSON.stringify(corpoPara(url, p)), cab = { "Content-Type": "application/json" };
    if (e.CHAMADOS_WEBHOOK_SEGREDO) cab["X-Abastece-Assinatura"] = `sha256=${crypto.createHmac("sha256", e.CHAMADOS_WEBHOOK_SEGREDO).update(corpo).digest("hex")}`;
    try {
      const r = await fetchFn(url, { method: "POST", headers: cab, body: corpo, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
      return { canal: "webhook", ok: r.ok, status: r.status };
    } catch (err) { return { canal: "webhook", ok: false, motivo: String(err?.name === "TimeoutError" ? "tempo-esgotado" : err?.message || err).slice(0, 80) }; }
  }
  async function enviarPush(dep, p) {
    if (dep === "ti" || !suporte?.enviarPush) return { canal: "push", ok: false, motivo: dep === "ti" ? "nao-se-aplica" : "indisponivel" };
    const n = await suporte.enviarPush({ admins: true, titulo: `Chamado ${p.chamado.protocolo} · ${p.setor}`.slice(0, 80), corpo: p.chamado.titulo, url: `painel-admin?chamado=${p.chamado.id}#chamados` });
    return { canal: "push", ok: n > 0, aparelhos: n };
  }

  /**
   * Avisa a equipe do departamento do chamado `t` (o documento completo devolvido por abrirAutomatico). Devolve { payload, canais }.
   * Nunca lança. Excedeu LIMITE_POR_MIN avisos no departamento no último minuto: o chamado existe na fila, só o aviso é omitido.
   */
  async function notificar(t) {
    const dep = t.departamento || K.DEPARTAMENTO_PADRAO, e = env();
    try {
      const agora = Date.now(), j = janelas[dep] || (janelas[dep] = []); while (j.length && agora - j[0] > 60_000) j.shift();
      if (j.length >= LIMITE_POR_MIN) { await chamados.anotar(t.id, `Aviso à equipe omitido: mais de ${LIMITE_POR_MIN} chamados por minuto em ${K.DEPARTAMENTO_NOME[dep]}. O chamado está na fila.`); return { payload: null, canais: [{ canal: "limite", ok: false }] }; }
      j.push(agora);
      const payload = montarPayload(t);
      const canais = await Promise.all([enviarPush(dep, payload), enviarWebhook(dep, payload, e)]);
      const resumo = canais.filter((c) => c.motivo !== "nao-configurado" && c.motivo !== "nao-se-aplica").map((c) => `${c.canal} ${c.ok ? "ok" : `falhou (${c.motivo || c.status || "?"})`}${c.aparelhos != null ? ` · ${c.aparelhos} aparelho(s)` : ""}`);
      await chamados.anotar(t.id, `Roteado para ${K.DEPARTAMENTO_NOME[dep]} (${t.classificacao?.motivo || "sem motivo"}). Painel: fila de ${K.DEPARTAMENTO_NOME[dep]}${resumo.length ? `. Avisos: ${resumo.join("; ")}` : ""}.`);
      return { payload, canais };
    } catch (err) { console.warn("despacho:", err.message); return { payload: null, canais: [{ canal: "erro", ok: false, motivo: String(err.message).slice(0, 80) }] }; }
  }
  /** Dispara sem esperar (a resposta ao usuário não depende de chat/push). Devolve a promessa só para os testes. */
  function disparar(t) { const p = notificar(t).finally(() => ultimos.delete(p)); ultimos.add(p); return p; }
  const aguardar = () => Promise.all([...ultimos]);

  return { montarPayload, notificar, disparar, aguardar, corpoPara, urlDoDepartamento };
}
module.exports = { criarDespacho };
