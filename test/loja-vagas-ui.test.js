// Front das vagas da LOJA (loja-vagas.js): validação, textos do plano e o fluxo (listar, publicar, encerrar, candidatos, PDF)
// com um DOM mínimo simulado (sem navegador, sem rede).
import assert from "node:assert/strict";
import { validarVaga, textoPlano, rotuloVaga, rotuloModeracao, rotuloCandidatura, iniciarVagasLoja } from "../loja-vagas.js";

let n = 0; const t = async (nome, fn) => { await fn(); n++; process.stdout.write(`  ✓ ${nome}\n`); };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ok_ = { titulo: "Repositor de mercearia", descricao: "Repor gôndolas no turno da manhã, com intervalo.", cidade: "Itapira", uf: "SP", tipo: "repositor" };

await t("validarVaga: título, descrição, cidade, UF e tipo (mensagem do 1º problema)", () => {
  assert.equal(validarVaga(ok_), "");
  assert.match(validarVaga({ ...ok_, titulo: "abc" }), /título/);
  assert.match(validarVaga({ ...ok_, descricao: "curta" }), /20 letras/);
  assert.match(validarVaga({ ...ok_, cidade: "" }), /cidade/);
  assert.match(validarVaga({ ...ok_, uf: "XX" }), /estado/);
  assert.match(validarVaga({ ...ok_, uf: "sp" }), /^$/, "UF em minúsculas é aceita (o servidor normaliza)");
  assert.match(validarVaga({ ...ok_, tipo: "" }), /tipo/);
});
await t("textos: plano gratuito, créditos, assinatura e rótulos", () => {
  assert.match(textoPlano({ gratuito: true, limiteGratis: 10 }), /grátis.*10 vagas/);
  assert.match(textoPlano({ gratuito: false, modelo: "creditos", creditos: 3 }), /1 crédito.*3/);
  assert.match(textoPlano({ gratuito: false, modelo: "mensalidade" }), /assinatura/);
  assert.equal(textoPlano(null), "");
  assert.deepEqual(rotuloVaga("ativa"), ["No ar", "green"]); assert.deepEqual(rotuloModeracao("aprovada"), ["", ""]);
  assert.deepEqual(rotuloCandidatura("aceita"), ["Aceita", "green"]); assert.deepEqual(rotuloCandidatura("zzz"), ["zzz", "gray"]);
});

function ambiente({ vagas, cands = [], falhaEnvio } = {}) {
  const els = new Map(), chamadas = [], avisos = []; let ouvinte = null;
  const mk = (id) => ({ id, value: "", checked: true, hidden: false, disabled: false, innerHTML: "", textContent: "", dataset: {}, focus() {}, querySelectorAll: () => [] });
  const el = (id) => { if (!els.has(id)) els.set(id, mk(id)); return els.get(id); };
  el("tab-vagas").addEventListener = (ev, fn) => { if (ev === "click") ouvinte = fn; };
  el("vl-lista"); el("vl-form").querySelectorAll = () => [];
  const raiz = { getElementById: el };
  const dados = { empresa: { id: "e1", nome: "Loja" }, plano: { gratuito: true, limiteGratis: 10 }, vagas };
  const api = {
    consultar: async (c) => { chamadas.push(["GET", c]); return c.endsWith("/candidaturas") ? { vaga: {}, candidaturas: cands } : dados; },
    enviar: async (c, corpo, m) => { chamadas.push([m || "POST", c, corpo]); if (falhaEnvio) throw Object.assign(new Error("x"), falhaEnvio); return {}; },
    abrirPDF: async (c) => { chamadas.push(["PDF", c]); },
    ok: (m) => avisos.push(["ok", m]), erro: (m) => avisos.push(["erro", m]), esc, skeleton: () => "<sk>", vazio: (i, a, b) => `<vazio>${a}|${b}</vazio>`
  };
  const mod = iniciarVagasLoja({ ...api, raiz });
  const clicar = (atr, valor, extra = {}) => { const alvo = { dataset: extra, closest: (s) => (s === `[${atr}]` ? alvo : null) }; return ouvinte({ target: alvo }); };
  return { mod, el, chamadas, avisos, clicar };
}
const vaga = (o = {}) => ({ id: "v1", titulo: "Repositor", descricao: "d".repeat(30), cidade: "Itapira", uf: "SP", tipo: "repositor", tipoRotulo: "Repositor", apenasMaiores: true, status: "rascunho", moderacao: "pendente", candidaturas: 2, ...o });
const preencher = (a, d) => { a.el("vl-titulo").value = d.titulo; a.el("vl-descricao").value = d.descricao; a.el("vl-cidade").value = d.cidade; a.el("vl-uf").value = d.uf; a.el("vl-tipo").value = d.tipo; };
const tick = () => new Promise((r) => setTimeout(r, 0));

await t("sem as telas no HTML (outra página), o módulo não quebra", () => {
  const m = iniciarVagasLoja({ raiz: { getElementById: () => null }, esc, skeleton() {}, vazio() {} }); m.carregar();
});
await t("listar: mostra a vaga com selo de status, moderação e contagem; texto do servidor é escapado", async () => {
  const a = ambiente({ vagas: [vaga({ titulo: "<img onerror=x>", status: "ativa", moderacao: "pendente" })] });
  await a.mod.carregar();
  const h = a.el("vl-lista").innerHTML;
  assert.match(h, /No ar/); assert.match(h, /Em moderação/); assert.match(h, /2 candidato/); assert.match(h, /Encerrar/);
  assert.doesNotMatch(h, /<img onerror/); assert.match(h, /&lt;img onerror=x&gt;/);
  assert.match(a.el("vl-plano").innerHTML, /grátis/);
});
await t("lista vazia: convida a anunciar", async () => {
  const a = ambiente({ vagas: [] }); await a.mod.carregar();
  assert.match(a.el("vl-lista").innerHTML, /ainda não anunciou/);
});
await t("publicar: formulário inválido não chama a API; válido envia POST /loja/vagas com publicar=true", async () => {
  const a = ambiente({ vagas: [] }); await a.mod.carregar();
  await a.clicar("data-vl-publicar");
  assert.match(a.el("vl-erro").textContent, /título/); assert.equal(a.chamadas.filter((c) => c[0] === "POST").length, 0);
  preencher(a, ok_); a.el("vl-maiores").checked = false;
  await a.clicar("data-vl-publicar"); await tick();
  const p = a.chamadas.find((c) => c[0] === "POST");
  assert.equal(p[1], "loja/vagas"); assert.equal(p[2].publicar, true); assert.equal(p[2].apenasMaiores, false); assert.equal(p[2].titulo, ok_.titulo);
  assert.ok(a.avisos.some(([k]) => k === "ok"));
});
await t("rascunho: envia publicar=false", async () => {
  const a = ambiente({ vagas: [] }); await a.mod.carregar(); preencher(a, ok_);
  await a.clicar("data-vl-rascunho"); await tick();
  assert.equal(a.chamadas.find((c) => c[0] === "POST")[2].publicar, false);
});
await t("sem plano: o 402 vira orientação clara e o formulário continua preenchido", async () => {
  const a = ambiente({ vagas: [], falhaEnvio: { code: "plano-necessario", message: "402" } }); await a.mod.carregar(); preencher(a, ok_);
  await a.clicar("data-vl-publicar"); await tick();
  assert.match(a.el("vl-erro").textContent, /plano ativo/); assert.equal(a.el("vl-titulo").value, ok_.titulo);
});
await t("publicar/encerrar uma vaga existente: PUT …/status com o status certo", async () => {
  const a = ambiente({ vagas: [vaga({ status: "rascunho" }), vaga({ id: "v2", status: "ativa", moderacao: "aprovada" })] }); await a.mod.carregar();
  await a.clicar("data-vl-status", "ativa", { id: "v1", vlStatus: "ativa" }); await tick();
  await a.clicar("data-vl-status", "encerrada", { id: "v2", vlStatus: "encerrada" }); await tick();
  const puts = a.chamadas.filter((c) => c[0] === "PUT");
  assert.deepEqual(puts.map((p) => [p[1], p[2].status]), [["loja/vagas/v1/status", "ativa"], ["loja/vagas/v2/status", "encerrada"]]);
});
await t("candidatos: abre a lista, mostra CPF mascarado, muda status e abre o PDF só de quem tem currículo", async () => {
  const cands = [{ id: "v1_u1", nome: "Ana Souza", cpfMascarado: "***.456.789-**", status: "pendente", candidatouEm: 1, temCurriculo: true, divulgacaoAtiva: true },
    { id: "v1_u2", nome: "Bia", cpfMascarado: "***.000.111-**", status: "pendente", candidatouEm: 1, temCurriculo: false, divulgacaoAtiva: false }];
  const a = ambiente({ vagas: [vaga({ status: "ativa", moderacao: "aprovada" })], cands }); await a.mod.carregar();
  await a.clicar("data-vl-cands", "v1", { vlCands: "v1" }); await tick(); await tick();
  const h = a.el("vl-c-v1").innerHTML;
  assert.match(h, /Ana Souza/); assert.match(h, /\*\*\*\.456\.789-\*\*/); assert.match(h, /Retirou a autorização/); assert.equal((h.match(/data-vl-pdf=/g) || []).length, 1);
  await a.clicar("data-vl-cand", "aceita", { vlCand: "v1_u1", st: "aceita" }); await tick();
  assert.deepEqual(a.chamadas.find((c) => c[0] === "PUT").slice(1), ["loja/vagas/candidaturas/v1_u1/status", { status: "aceita" }]);
  await a.clicar("data-vl-pdf", "", { vlPdf: "v1_u1" });
  assert.deepEqual(a.chamadas.find((c) => c[0] === "PDF"), ["PDF", "loja/vagas/candidaturas/v1_u1/curriculo"]);
});

process.stdout.write(`\n${n} testes do front das vagas da loja passaram\n`);
