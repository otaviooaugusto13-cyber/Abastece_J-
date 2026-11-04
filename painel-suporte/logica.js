// Regras PURAS da fila e da ficha (sem React, sem Firebase): testadas em test/painel-suporte.test.js.

export const ABAS = [
  { id: "todos", rotulo: "Todos" }, { id: "promotores", rotulo: "Promotores" },
  { id: "lojas", rotulo: "Lojas" }, { id: "pendentes", rotulo: "Pendentes de resposta" }
];
/** Quanto tempo o usuário espera antes de a fila avisar (amarelo) e de ficar crítico (vermelho). Ajuste à meta de SLA da operação. */
export const LIMITE_ATENCAO_MS = 15 * 60_000, LIMITE_CRITICO_MS = 60 * 60_000;
const FUSO = "America/Sao_Paulo";

/** Normaliza qualquer data do Firestore/API para milissegundos (0 se vazia). */
export function ms(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(v); return Number.isNaN(n) ? 0 : n;
}

const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** A bola está com a equipe: a última fala foi do usuário e o ticket não foi resolvido DEPOIS dela. */
export function ehPendente(conv, ticket) {
  if (!conv || conv.ultimaDe !== "usuario") return false;
  if (ticket?.status === "resolvido" && ms(ticket.resolvidoMs) >= ms(conv.ultimaEm)) return false;
  return true;
}

/** `tickets`: Map uid → ticket. Pendentes: mais antigos primeiro (quem espera mais passa na frente); demais abas: mais recentes primeiro. */
export function filtrarConversas(conversas, tickets, aba = "todos", busca = "") {
  const q = semAcento(busca).trim();
  const passaAba = (c) => aba === "promotores" ? c.tipo === "promotor" : aba === "lojas" ? c.tipo === "loja" : aba === "pendentes" ? ehPendente(c, tickets?.get?.(c.uid)) : true;
  const passaBusca = (c) => !q || semAcento(`${c.nome} ${c.ultimaMsg} ${tickets?.get?.(c.uid)?.protocolo || ""}`).includes(q);
  const lista = (conversas || []).filter((c) => passaAba(c) && passaBusca(c));
  return lista.sort((a, b) => (aba === "pendentes" ? ms(a.ultimaEm) - ms(b.ultimaEm) : ms(b.ultimaEm) - ms(a.ultimaEm)));
}

export function contarAbas(conversas, tickets) {
  const r = { todos: 0, promotores: 0, lojas: 0, pendentes: 0 };
  for (const c of conversas || []) { r.todos++; if (c.tipo === "promotor") r.promotores++; if (c.tipo === "loja") r.lojas++; if (ehPendente(c, tickets?.get?.(c.uid))) r.pendentes++; }
  return r;
}

export function formatarEspera(ms_) {
  const s = Math.max(0, Math.floor(ms_ / 1000));
  if (s < 60) return "agora"; const m = Math.floor(s / 60); if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} h`; return `${Math.floor(h / 24)} d`;
}
export const nivelEspera = (ms_) => (ms_ >= LIMITE_CRITICO_MS ? "critico" : ms_ >= LIMITE_ATENCAO_MS ? "atencao" : "ok");

// ---------- mensagens ----------
export const ordenarMensagens = (msgs) => [...(msgs || [])].sort((a, b) => (a.id > b.id ? 1 : a.id < b.id ? -1 : 0));
const fmtDia = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }), fmtHora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });
export const chaveDia = (t) => fmtDia.format(new Date(t));
export const horaDe = (t) => (t ? fmtHora.format(new Date(t)) : "");
export function rotuloDia(t, agora = Date.now()) {
  const k = chaveDia(t);
  if (k === chaveDia(agora)) return "Hoje"; if (k === chaveDia(agora - 86_400_000)) return "Ontem";
  const [a, m, d] = k.split("-"); return `${d}/${m}/${a}`;
}
/** Intercala separadores de dia e marca o início de cada "rajada" (mesmo autor, menos de 5 min entre mensagens). */
export function agruparMensagens(msgs, agora = Date.now()) {
  const itens = []; let dia = "", ant = null;
  for (const m of msgs || []) {
    const t = ms(m.criadoEm) || Number(String(m.id).slice(0, 13)) || 0, k = chaveDia(t);
    if (k !== dia) { itens.push({ tipo: "dia", chave: `dia-${k}`, rotulo: rotuloDia(t, agora) }); dia = k; ant = null; }
    itens.push({ tipo: "msg", chave: m.id, msg: m, ms: t, inicioGrupo: !ant || ant.de !== m.de || t - ant.t > 5 * 60_000 });
    ant = { de: m.de, t };
  }
  return itens;
}

// ---------- ficha ----------
export const primeiroNome = (n) => String(n ?? "").trim().split(/\s+/)[0] || "";
export function iniciais(nome) {
  const p = String(nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?"; return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}
export function formatarTelefone(t) {
  let d = String(t ?? "").replace(/\D/g, ""); if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`; if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(t ?? "");
}
/** CPF aparece mascarado; CNPJ (pessoa jurídica) aparece formatado. */
export function mascararDocumento(doc) {
  const d = String(doc ?? "").replace(/\D/g, "");
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return String(doc ?? "");
}
const RUINS = new Set(["suspenso", "banido", "reprovado", "bloqueado", "recusado", "inativo", "rejeitado"]);
export function rotuloStatusConta(status) {
  const s = String(status ?? "").toLowerCase();
  if (s === "ativo") return { texto: "Ativo", tom: "ok" };
  if (s === "pendente") return { texto: "Pendente", tom: "aviso" };
  if (!s) return { texto: "Sem status", tom: "neutro" };
  return { texto: s[0].toUpperCase() + s.slice(1), tom: RUINS.has(s) ? "erro" : "neutro" };
}
export function progressoTreinamento(t) {
  const total = Math.max(0, Number(t?.total) || 0), feitos = Math.min(total, Math.max(0, Number(t?.concluidos) || 0));
  return { feitos, total, pct: total ? Math.round((feitos / total) * 100) : 0 };
}
export const titulo = (s) => { const t = String(s ?? "").replace(/_/g, " "); return t ? t[0].toUpperCase() + t.slice(1) : ""; };
