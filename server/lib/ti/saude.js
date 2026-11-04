// Monitor de saúde dos serviços integrados (healthcheck). Roda em SEGUNDO PLANO, a cada 30 s, e guarda só o último resultado
// e um histórico curto em memória: o painel de TI lê o cache (custo zero para o banco e para as APIs externas, qualquer que seja
// o número de operadores olhando). Sem dependências: as "sondas" são funções injetadas (ver sondas.js), então tudo é testável sem rede.
//
// Estados:  ok · degradado (lento ou 1ª falha) · fora (2 falhas seguidas) · nao_configurado (serviço opcional não ligado) · desconhecido (ainda não medido)
// Histerese: UMA falha isolada só marca "degradado"; "fora" exige 2 verificações seguidas falhando (evita alarme falso por um soluço de rede).
// Limite honesto: o histórico é por instância do servidor e some ao reiniciar. Com várias instâncias, cada uma mede por conta própria.
const PIOR = { desconhecido: 0, nao_configurado: 0, ok: 1, degradado: 2, fora: 3 };

function criarSaude({ sondas: sondasIniciais = {}, intervaloMs = 30_000, timeoutMs = 5_000, historicoMax = 30, janelaWebhookMs = 15 * 60_000, relogio = () => Date.now(), medir = () => Number(process.hrtime.bigint() / 1000n) / 1000 } = {}) {
  let sondas = sondasIniciais;
  const definirSondas = (s) => { sondas = s; estado.clear(); };
  const estado = new Map();         // id → { historico, falhasSeguidas, atual }
  let timer = null, rodando = null, ultimaVerificacaoMs = 0;
  const eventosWebhook = [];        // { em, ok } — só o que o handler realmente processou (ver registrarWebhook)

  const comTimeout = (p, ms) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(Object.assign(new Error(`sem resposta em ${ms / 1000} s`), { timeout: true })), ms); p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); }); });
  const curto = (e) => String(e?.message || e || "erro").replace(/\s+/g, " ").slice(0, 140);   // nunca devolve stack nem corpo de resposta (poderia conter segredo)

  async function medirUma(id, s) {
    const e = estado.get(id) || { historico: [], falhasSeguidas: 0, atual: null }; estado.set(id, e);
    const t0 = medir(); let r, falhou = false, detalhe = "";
    try { r = (await comTimeout(Promise.resolve().then(() => s.fn()), s.timeoutMs || timeoutMs)) || {}; }
    catch (err) { falhou = true; detalhe = curto(err); r = {}; }
    const ms = Math.round(Number.isFinite(r.latenciaMs) ? r.latenciaMs : medir() - t0);
    let status;
    if (r.estado === "nao_configurado") { status = "nao_configurado"; e.falhasSeguidas = 0; detalhe = r.detalhe || "Não configurado"; }
    else if (falhou || r.estado === "fora") { e.falhasSeguidas++; status = e.falhasSeguidas >= 2 ? "fora" : "degradado"; detalhe = falhou ? detalhe : (r.detalhe || "Indisponível"); if (status === "degradado") detalhe += " (1ª falha; confirmando…)"; }
    else { e.falhasSeguidas = 0; detalhe = r.detalhe || ""; status = r.estado === "degradado" ? "degradado" : "ok"; if (status === "ok" && s.lentoMs && ms > s.lentoMs) { status = "degradado"; detalhe = `${detalhe ? detalhe + " · " : ""}lento: ${ms} ms (limite ${s.lentoMs} ms)`; } }
    const em = relogio();
    e.atual = { id, nome: s.nome, tipo: s.tipo || "externo", status, latenciaMs: status === "nao_configurado" ? null : ms, detalhe, verificadoEm: new Date(em).toISOString(), lentoMs: s.lentoMs || null };
    if (status !== "nao_configurado") { e.historico.push({ em, ms, s: status }); if (e.historico.length > historicoMax) e.historico.shift(); }
  }

  /** Mede todos os serviços em paralelo (uma sonda lenta não atrasa as outras). Chamadas simultâneas compartilham a mesma rodada. */
  function verificar() {
    if (rodando) return rodando;
    rodando = Promise.all(Object.entries(sondas).map(([id, s]) => medirUma(id, s).catch((err) => console.warn("saude:", id, curto(err))))).then(() => { ultimaVerificacaoMs = relogio(); }).finally(() => { rodando = null; });
    return rodando;
  }
  function resumo() {
    const servicos = [...Object.keys(sondas)].map((id) => {
      const e = estado.get(id); if (!e?.atual) return { id, nome: sondas[id].nome, tipo: sondas[id].tipo || "externo", status: "desconhecido", latenciaMs: null, detalhe: "Ainda não medido", verificadoEm: null, historico: [], disponibilidadePct: null };
      const h = e.historico, up = h.filter((x) => x.s !== "fora").length;
      return { ...e.atual, historico: h.map((x) => ({ em: x.em, ms: x.ms, s: x.s })), disponibilidadePct: h.length ? Math.round((up / h.length) * 1000) / 10 : null };
    });
    const medidos = servicos.filter((s) => PIOR[s.status] > 0);
    const geral = !medidos.length ? "desconhecido" : medidos.reduce((a, s) => (PIOR[s.status] > PIOR[a] ? s.status : a), "ok");
    return { geral, verificadoEm: ultimaVerificacaoMs ? new Date(ultimaVerificacaoMs).toISOString() : null, intervaloSeg: Math.round(intervaloMs / 1000), servicos };
  }
  /** Para as rotas: devolve o cache; mede antes se nunca mediu ou (com `forcar`) se o último resultado tem mais de 10 s — ninguém martela as APIs externas. */
  async function obter({ forcar = false } = {}) {
    if (!ultimaVerificacaoMs || (forcar && relogio() - ultimaVerificacaoMs > 10_000)) await verificar();
    return resumo();
  }
  function iniciar() {
    if (timer) return; verificar().catch(() => {});
    timer = setInterval(() => verificar().catch(() => {}), intervaloMs); timer.unref?.();
  }
  const parar = () => { clearInterval(timer); timer = null; };
  const limpar = () => { estado.clear(); eventosWebhook.length = 0; ultimaVerificacaoMs = 0; };

  // ---- passivo: o que o handler real do webhook está fazendo (não só se a porta responde) ----
  /** Chamado pelo handler a cada resposta. 4xx (assinatura inválida, ignorado) NÃO conta: é ruído de quem bate sem assinatura. */
  function registrarWebhook({ status }) {
    if (!(status < 400 || status >= 500)) return;
    eventosWebhook.push({ em: relogio(), ok: status < 500 }); while (eventosWebhook.length > 500) eventosWebhook.shift();
  }
  function webhookRecente() {
    const corte = relogio() - janelaWebhookMs, ev = eventosWebhook.filter((x) => x.em >= corte), falhas = ev.filter((x) => !x.ok).length;
    return { total: ev.length, falhas, taxa: ev.length ? falhas / ev.length : 0, ultimoEm: eventosWebhook.length ? new Date(eventosWebhook[eventosWebhook.length - 1].em).toISOString() : null };
  }
  return { definirSondas, verificar, resumo, obter, iniciar, parar, limpar, registrarWebhook, webhookRecente, _estado: estado };
}
module.exports = { criarSaude };
