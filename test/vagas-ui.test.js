// Front do Mural de Vagas (vagas.js): validação do PDF no aparelho, mensagens e o fluxo de candidatura com a pré-checagem
// "complete seu perfil" — com um DOM mínimo simulado (sem navegador, sem rede).
import assert from "node:assert/strict";
import { validarArquivoPdf, fmtTamanho, textoFaltas, destinoDasFaltas, rotuloStatus, MAX_PDF_BYTES, iniciarVagas } from "../vagas.js";

let n = 0; const t = async (nome, fn) => { await fn(); n++; process.stdout.write(`  ✓ ${nome}\n`); };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

await t("validarArquivoPdf: só PDF, não vazio, até 5 MB (exato)", () => {
  assert.equal(validarArquivoPdf({ name: "cv.pdf", type: "application/pdf", size: 1000 }).ok, true);
  assert.equal(validarArquivoPdf({ name: "CV.PDF", type: "", size: 1000 }).ok, true, "alguns navegadores não informam o tipo");
  assert.equal(validarArquivoPdf({ name: "cv.pdf", type: "application/pdf", size: MAX_PDF_BYTES }).ok, true);
  assert.match(validarArquivoPdf({ name: "cv.pdf", type: "application/pdf", size: MAX_PDF_BYTES + 1 }).erro, /passa de 5 MB/);
  assert.match(validarArquivoPdf({ name: "foto.jpg", type: "image/jpeg", size: 1000 }).erro, /PDF/);
  assert.match(validarArquivoPdf({ name: "cv.pdf", type: "application/pdf", size: 0 }).erro, /vazio/);
  assert.equal(validarArquivoPdf(null).ok, false);
});
await t("textos: tamanho legível, faltas em português e destino do aviso", () => {
  assert.equal(fmtTamanho(2048), "2 KB"); assert.equal(fmtTamanho(1572864), "1,5 MB");
  assert.deepEqual(textoFaltas(["curriculo", "inexistente"]).length, 1);
  assert.equal(destinoDasFaltas(["nome", "cpf"]), "dados"); assert.equal(destinoDasFaltas(["nome", "curriculo"]), "divulgacao");
  assert.deepEqual(rotuloStatus("em_analise"), ["Em análise", "blue"]); assert.deepEqual(rotuloStatus("xyz"), ["xyz", "gray"]);
});

/** DOM mínimo: qualquer id vira um elemento "mudo"; guardamos os ouvintes para disparar cliques/mudanças. */
function ambiente({ perfil, erroCandidatar } = {}) {
  const els = new Map(), ouvintes = {}, chamadas = [], dialogos = [], eventos = [];
  const el = (id) => { if (!els.has(id)) els.set(id, { id, value: "", checked: false, hidden: false, disabled: false, innerHTML: "", textContent: "", dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, querySelector: () => null, addEventListener: (ev, fn) => { (ouvintes[`${id}:${ev}`] ||= []).push(fn); } }); return els.get(id); };
  const raiz = { getElementById: el, querySelectorAll: () => [], addEventListener: (ev, fn) => { (ouvintes[`raiz:${ev}`] ||= []).push(fn); } };
  const feed = { vagas: [{ id: "v1", titulo: "Repositor", descricao: "x".repeat(30), cidade: "Itapira", uf: "SP", tipo: "repositor", tipoRotulo: "Repositor", apenasMaiores: true, empresa: { id: "e1", nome: "Rede" }, jaCandidatou: false }], filtros: { cidades: [], tipos: [], redes: [] } };
  const deps = {
    consultar: async (c) => { chamadas.push(["GET", c]); return c.startsWith("perfil/vagas") ? perfil : c.startsWith("vagas") ? feed : []; },
    enviar: async (c, corpo, m) => { chamadas.push([m || "POST", c, corpo]); if (/candidatar/.test(c) && erroCandidatar) throw erroCandidatar; return perfil; },
    abrirPDF: async () => {}, dialogo: async (o) => { dialogos.push(o); return deps.respostaDialogo; }, respostaDialogo: "ir",
    abrir: (id) => eventos.push(["abrir", id]), irPara: (id) => eventos.push(["irPara", id]), ok: (m) => eventos.push(["ok", m]), erro: (m) => eventos.push(["erro", m]),
    esc, skeleton: () => "", vazio: (_i, tit) => tit, raiz
  };
  const app = iniciarVagas(deps);
  const clicar = async (seletor, dataset) => { const alvo = { closest: (s) => (s === seletor ? { dataset } : null) }; for (const fn of ouvintes["raiz:click"]) await fn({ target: alvo }); await new Promise((r) => setTimeout(r, 5)); };
  return { app, deps, chamadas, dialogos, eventos, clicar, el, ouvintes };
}
const termo = { versao: "2026-11", texto: "Aceito…" };
const candidaturas = (a) => a.chamadas.filter((c) => /candidatar/.test(c[1]));

await t("candidatar: perfil incompleto abre o modal 'complete seu perfil' e NÃO chama a API; 'Completar agora' leva à aba de divulgação", async () => {
  const a = ambiente({ perfil: { pronto: false, falta: ["divulgacao", "curriculo"], termo } });
  await a.clicar("[data-vg-candidatar]", { vgCandidatar: "v1" });
  assert.equal(candidaturas(a).length, 0); assert.equal(a.dialogos.length, 1); assert.equal(a.dialogos[0].titulo, "Complete seu perfil");
  assert.match(a.dialogos[0].texto, /aceitar a divulgação/); assert.match(a.dialogos[0].texto, /currículo em PDF/);
  assert.deepEqual(a.eventos.find((e) => e[0] === "irPara"), ["irPara", "tab-divulgacao"]);
});
await t("candidatar: falta só nome/CPF → o modal leva para 'Meus dados' (sheet-perfil), não para a divulgação", async () => {
  const a = ambiente({ perfil: { pronto: false, falta: ["nome", "cpf"], termo } });
  await a.clicar("[data-vg-candidatar]", { vgCandidatar: "v1" });
  assert.deepEqual(a.eventos.find((e) => e[0] === "abrir"), ["abrir", "sheet-perfil"]); assert.ok(!a.eventos.some((e) => e[0] === "irPara"));
  const b = ambiente({ perfil: { pronto: false, falta: ["curriculo"], termo } }); b.deps.respostaDialogo = null;   // "Agora não"
  await b.clicar("[data-vg-candidatar]", { vgCandidatar: "v1" }); assert.equal(b.eventos.length, 0);
});
await t("candidatar: perfil pronto → 1 clique envia só o id da vaga (nome/CPF/PDF são cruzados no servidor) e avisa o sucesso", async () => {
  const a = ambiente({ perfil: { pronto: true, falta: [], termo } });
  await a.clicar("[data-vg-candidatar]", { vgCandidatar: "v1" });
  const c = candidaturas(a); assert.equal(c.length, 1); assert.equal(c[0][1], "vagas/v1/candidatar"); assert.deepEqual(c[0][2], {});
  assert.equal(a.dialogos.length, 0); assert.ok(a.eventos.some((e) => e[0] === "ok" && /Candidatura enviada/.test(e[1])));
});
await t("candidatar: se o servidor responder 'perfil-incompleto' (estado mudou), abre o mesmo modal com o que ele pediu", async () => {
  const a = ambiente({ perfil: { pronto: true, falta: [], termo }, erroCandidatar: Object.assign(new Error("x"), { code: "perfil-incompleto", detalhe: { falta: ["curriculo"] } }) });
  await a.clicar("[data-vg-candidatar]", { vgCandidatar: "v1" });
  assert.equal(a.dialogos.length, 1); assert.match(a.dialogos[0].texto, /currículo em PDF/); assert.ok(!a.eventos.some((e) => e[0] === "erro"));
});
await t("candidatar: erros do servidor viram aviso; 'já se candidatou' não assusta; cliques repetidos não duplicam o envio", async () => {
  const a = ambiente({ perfil: { pronto: true, falta: [], termo }, erroCandidatar: Object.assign(new Error("Esta vaga não está mais aberta."), { code: "vaga-encerrada" }) });
  await a.clicar("[data-vg-candidatar]", { vgCandidatar: "v1" }); assert.ok(a.eventos.some((e) => e[0] === "erro" && /não está mais aberta/.test(e[1])));
  const b = ambiente({ perfil: { pronto: true, falta: [], termo }, erroCandidatar: Object.assign(new Error("dup"), { code: "ja-candidatou" }) });
  await b.clicar("[data-vg-candidatar]", { vgCandidatar: "v1" }); assert.ok(!b.eventos.some((e) => e[0] === "erro"));
  const c = ambiente({ perfil: { pronto: true, falta: [], termo } });
  await Promise.all([c.clicar("[data-vg-candidatar]", { vgCandidatar: "v1" }), c.clicar("[data-vg-candidatar]", { vgCandidatar: "v1" })]); assert.equal(candidaturas(c).length, 1);
});
await t("consentimento: retirar pede confirmação (cancelar mantém ligado e não chama a API); aceitar envia a versão do termo exibido", async () => {
  const a = ambiente({ perfil: { pronto: true, falta: [], termo, aceitaDivulgacao: true, curriculo: null, nomeCompleto: "A B", cpfMascarado: "***" } });
  await a.app.carregarDivulgacao(); a.deps.respostaDialogo = null;
  const box = a.el("dv-consent"); box.checked = false; for (const f of a.ouvintes["dv-consent:change"]) await f({});
  assert.equal(box.checked, true); assert.equal(a.chamadas.filter((c) => /consentimento/.test(c[1])).length, 0); assert.equal(a.dialogos[0].titulo, "Retirar autorização?");
  box.checked = true; a.deps.respostaDialogo = "sim"; box.checked = false; for (const f of a.ouvintes["dv-consent:change"]) await f({});
  const req = a.chamadas.find((c) => /consentimento/.test(c[1])); assert.deepEqual(req[2], { aceito: false, versao: "2026-11" }); assert.equal(req[3] ?? "PUT", "PUT");
});
await t("sem as telas no HTML (outra página), o módulo não quebra", () => {
  const vazio = iniciarVagas({ raiz: { getElementById: () => null }, esc }); assert.equal(typeof vazio.carregarMural, "function");
});
process.stdout.write(`\n${n} testes do front do mural de vagas passaram\n`);
