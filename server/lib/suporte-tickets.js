// Tickets do atendimento (protocolo SP-000123) e ESCALAMENTO para a fila de TI/gestão.
//   suporte_tickets/{uid}   ticket vigente da conversa: protocolo, status (aberto | escalado | resolvido), escalonamento. Só a equipe lê (regras); só o servidor escreve.
//   contadores/suporte      { n } — número sequencial do protocolo.
// Um ticket por conversa: ao resolver, a próxima necessidade abre um NOVO protocolo (reaberturas + 1). O histórico das mensagens continua
// em suporte_mensagens (nunca é copiado para o ticket); o chamado de TI recebe um dossiê + a transcrição recente como notas INTERNAS.
const { Falha } = require("./erros");

const DESTINOS = ["ti", "gestao"];
const ROTULO_DESTINO = { ti: "TI (desenvolvimento)", gestao: "Gestão/ADM" };
const MAX_MSGS = 60;          // mensagens recentes levadas ao chamado
const MAX_PARTES = 6;         // notas internas com a transcrição (≤ 1000 caracteres cada)
const LIM_PARTE = 950;

/** Tira dados pessoais óbvios do texto antes de levá-lo à fila de TI (mesma política dos relatórios de erro). Não é infalível: texto livre. */
function anonimizar(t) {
  return String(t || "")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[e-mail]")
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[CNPJ]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF]")
    .replace(/(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, "[telefone]")
    .replace(/\b\d{9,}\b/g, "[número]");
}
const hora = (ms) => { const d = new Date(ms - 3 * 3_600_000), p = (n) => String(n).padStart(2, "0"); return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };

/** Quebra as linhas em partes de até `lim` caracteres, mantendo as MAIS RECENTES quando passa de `maxPartes`. */
function partir(linhas, lim = LIM_PARTE, maxPartes = MAX_PARTES) {
  const partes = []; let atual = "";
  for (const l of linhas) {
    const linha = l.length > lim ? `${l.slice(0, lim - 1)}…` : l;
    if (atual && atual.length + linha.length + 1 > lim) { partes.push(atual); atual = ""; }
    atual += (atual ? "\n" : "") + linha;
  }
  if (atual) partes.push(atual);
  return partes.slice(-maxPartes);
}

function criarTickets({ db, FieldValue, Timestamp, V, suporte, chamados, habilitacao, K }) {
  const COL = "suporte_tickets", ref = (uid) => db.collection(COL).doc(uid);
  const protocolo = (n) => `SP-${String(n).padStart(6, "0")}`;
  const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
  const visao = (t) => ({ uid: t.uid, protocolo: t.protocolo, tipo: t.tipo, status: t.status, reaberturas: t.reaberturas || 0, criadoEm: iso(t.criadoMs), resolvidoEm: iso(t.resolvidoMs), escalonamento: t.escalonamento ? { ...t.escalonamento, em: iso(t.escalonamento.emMs) } : null });

  /** Devolve o ticket vigente da conversa; cria (ou reabre, com novo protocolo) se não houver um em andamento. Idempotente. */
  async function garantir(uid) {
    const c = (await db.collection("suporte_conversas").doc(uid).get()).data() || await suporte.identificar(uid);
    if (!c) throw new Falha(404, "Conversa não encontrada.", "nao-encontrado");
    const t = await db.runTransaction(async (tx) => {
      const atual = (await tx.get(ref(uid))).data();
      if (atual && atual.status !== "resolvido") return atual;
      const cref = db.collection("contadores").doc("suporte"), n = ((await tx.get(cref)).data()?.n || 0) + 1, agora = Date.now();
      const novo = { uid, protocolo: protocolo(n), tipo: c.tipo, nome: c.nome || "", status: "aberto", reaberturas: atual ? (atual.reaberturas || 0) + 1 : 0, criadoMs: agora, atualizadoMs: agora, resolvidoMs: null, escalonamento: null, criadoEm: Timestamp.fromMillis(agora), atualizadoEm: Timestamp.fromMillis(agora) };
      tx.set(cref, { n }, { merge: true }); tx.set(ref(uid), novo);
      return novo;
    });
    return visao(t);
  }

  async function resolver(uid) {
    const t = (await ref(uid).get()).data();
    if (!t) throw new Falha(404, "Ticket não encontrado.", "nao-encontrado");
    if (t.status === "resolvido") return visao(t);
    const agora = Date.now(); await ref(uid).set({ status: "resolvido", resolvidoMs: agora, atualizadoMs: agora, atualizadoEm: Timestamp.fromMillis(agora) }, { merge: true });
    return visao({ ...t, status: "resolvido", resolvidoMs: agora });
  }

  async function mensagensRecentes(uid) {
    const s = await db.collection("suporte_mensagens").where("uid", "==", uid).limit(500).get();
    return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.id > b.id ? 1 : -1)).slice(-MAX_MSGS)
      .map((m) => ({ de: m.de, texto: String(m.texto || ""), ms: m.criadoEm?.toMillis?.() || Number(String(m.id).slice(0, 13)) || 0 }));
  }

  /** Situação técnica da conta SEM dados pessoais (sem CPF, telefone, e-mail): o que a TI precisa para reproduzir o problema. */
  async function situacaoConta(uid, tipo) {
    try {
      if (tipo === "promotor") {
        const [p, h] = await Promise.all([db.collection("profissionais").doc(uid).get(), habilitacao.situacao(uid).catch(() => null)]);
        const x = p.data() || {};
        return `Conta: promotor · status ${x.status || "?"}${x.statusMotivo ? ` (${anonimizar(x.statusMotivo).slice(0, 80)})` : ""} · pendências: ${(h?.pendencias || []).join(", ") || "nenhuma"} · nota ${x.ratingMedia ?? "—"}`;
      }
      const l = (await db.collection("contratantes").doc(uid).get()).data() || {};
      return `Conta: loja · status ${l.status || "ativo"}`;
    } catch { return "Conta: situação indisponível no momento da escalada."; }
  }

  /**
   * Escala a conversa: abre um chamado em chamados_ti (origem "suporte") com dossiê técnico e a transcrição recente em notas internas,
   * marca o ticket como "escalado" e, se pedido, avisa o usuário. Uma conversa só pode ter UM escalamento ativo por ticket.
   */
  async function escalar(uid, { destino, motivo, categoria, prioridade, avisarUsuario = true }, ator) {
    destino = V.opcao(destino || "ti", DESTINOS, "destino");
    motivo = V.texto(motivo, "motivo", { min: 5, max: 300 });
    categoria = V.opcao(categoria || "outro", K.CATEGORIAS, "categoria"); prioridade = V.opcao(prioridade || "media", K.PRIORIDADES, "prioridade");
    const t0 = await garantir(uid), t = (await ref(uid).get()).data();
    if (t.status === "escalado") throw new Falha(409, `Este atendimento já foi escalado (${t.escalonamento?.protocoloTI || "chamado de TI"}).`, "ja-escalado", { protocoloTI: t.escalonamento?.protocoloTI });
    const [msgs, conta] = await Promise.all([mensagensRecentes(uid), situacaoConta(uid, t.tipo)]);
    const linha = (m) => `[${hora(m.ms)}] ${m.de === "usuario" ? "Usuário" : "Equipe"}: ${anonimizar(m.texto).replace(/\s+/g, " ").trim()}`;
    const linhas = msgs.map(linha);

    const cab = [`ESCALADO DO SUPORTE ${t0.protocolo} → ${ROTULO_DESTINO[destino]}`, `Solicitante: ${t.nome || t.tipo} (${t.tipo}) · uid ${uid}`, `Escalado por: ${ator.nome}`, `Motivo: ${anonimizar(motivo)}`, conta, "Últimas mensagens:"];
    let descricao = cab.join("\n"); const sobra = 2000 - descricao.length - 40;
    const cauda = []; let usado = 0;
    for (let i = linhas.length - 1; i >= 0 && cauda.length < 8; i--) { const l = linhas[i].slice(0, 220); if (usado + l.length + 1 > sobra) break; cauda.unshift(l); usado += l.length + 1; }
    descricao += `\n${cauda.join("\n") || "(sem mensagens)"}\n(Transcrição completa nas notas internas.)`;

    const ch = await chamados.criar({ titulo: `[Suporte ${t0.protocolo}] ${anonimizar(motivo)}`.slice(0, 120), descricao: descricao.slice(0, 2000), categoria, prioridade }, { solicitante: { uid, tipo: t.tipo, nome: t.nome }, origem: "suporte", criador: ator });
    await db.collection("chamados_ti").doc(ch.id).set({ filaDestino: destino, suporteProtocolo: t0.protocolo, conversaUid: uid }, { merge: true });
    const partes = partir(linhas);
    for (let i = 0; i < partes.length; i++) await chamados.comentar(ch.id, ator, `Histórico do chat (${i + 1}/${partes.length})\n${partes[i]}`, true);

    const agora = Date.now(), escalonamento = { chamadoId: ch.id, protocoloTI: ch.protocolo, destino, motivo: anonimizar(motivo), porNome: ator.nome, emMs: agora };
    await ref(uid).set({ status: "escalado", escalonamento, atualizadoMs: agora, atualizadoEm: Timestamp.fromMillis(agora) }, { merge: true });
    if (avisarUsuario) await suporte.postar({ uid, de: "suporte", texto: `Seu atendimento (protocolo ${t0.protocolo}) foi encaminhado para a equipe responsável. Avisaremos por aqui assim que houver novidades.`, autorUid: ator.uid });
    return { ticket: visao({ ...t, status: "escalado", escalonamento }), chamado: { id: ch.id, protocolo: ch.protocolo, destino } };
  }

  return { garantir, resolver, escalar, visao };
}
module.exports = { criarTickets, anonimizar, partir, DESTINOS };
