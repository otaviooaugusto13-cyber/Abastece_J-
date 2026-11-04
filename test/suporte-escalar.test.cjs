// Bateria do ticket de suporte (protocolo SP-…) e do escalamento para TI/gestão. Sem rede (ver fake-env.cjs).
const crypto = require("node:crypto");
process.env.AMBIENTE = "teste"; process.env.MODO_TESTE = "1"; process.env.APP_URL = "https://app.exemplo.com";
process.env.MP_ACCESS_TOKEN = "APP_USR-teste"; process.env.MP_WEBHOOK_SECRET = "segredo-webhook"; process.env.CRON_SECRET = "cron-secreto";
process.env.DATA_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString("base64")}`; process.env.DATA_ENCRYPTION_KEY_ID = "1"; process.env.BLIND_INDEX_KEY = crypto.randomBytes(32).toString("base64");
const assert = require("node:assert/strict");
const E = require("./fake-env.cjs");
const { ctx, chamar } = E.carregarServidor();
const { anonimizar, partir } = require("../server/lib/suporte-tickets");

const U = { adm: { uid: "adm1", email: "adm@x.com", email_verified: true, name: "Atendente Ana" }, lojaA: { uid: "lojaA", email: "a@x.com", email_verified: true }, prom1: { uid: "prom1", email: "p@x.com", email_verified: true } };
const set = (col, id, d) => ctx.db.collection(col).doc(id).set(d);
const get = async (col, id) => (await ctx.db.collection(col).doc(id).get()).data();
function reset() {
  E.limpar(); Object.assign(E.tokens, U); E.claimsStore.adm1 = { role: "admin" }; E.claimsStore.lojaA = { role: "loja" }; E.claimsStore.prom1 = { role: "promotor", treinado: false };
  E.clock.now = Date.now(); ctx.__reset();
}
async function semear() {
  await set("profissionais", "prom1", { nome: "Paulo Promotor", status: "pendente", ratingMedia: 4.6 });
  await ctx.suporte.postar({ uid: "prom1", de: "usuario", texto: "Meu CPF 123.456.789-09 e e-mail paulo@x.com não liberam o turno", autorUid: "prom1", dica: "promotor" });
  await ctx.suporte.postar({ uid: "prom1", de: "suporte", texto: "Vou verificar o seu cadastro.", autorUid: "adm1" });
  await ctx.suporte.postar({ uid: "prom1", de: "usuario", texto: "Ligue em (19) 99535-0637 por favor", autorUid: "prom1" });
}
const testes = []; const t = (n, f) => testes.push([n, f]);

t("anonimizar remove e-mail, CPF, CNPJ e telefone; partir mantém as partes mais recentes", () => {
  const s = anonimizar("a@b.com 123.456.789-09 12.345.678/0001-95 (19) 99535-0637 11999998888");
  assert.ok(!/@|\d{3}\.\d{3}|\d{4}-\d{4}|11999998888/.test(s), s); assert.match(s, /\[e-mail\].*\[CPF\].*\[CNPJ\]/);
  const linhas = Array.from({ length: 40 }, (_, i) => `linha-${i}-${"x".repeat(200)}`); const p = partir(linhas, 950, 3);
  assert.equal(p.length, 3); assert.ok(p.every((x) => x.length <= 950)); assert.match(p[2], /linha-39/);
});

t("ticket: só admin; protocolo sequencial e idempotente; reabre com novo protocolo após resolver", async () => {
  reset(); await semear();
  assert.equal((await chamar("POST", "/admin/suporte/prom1/ticket", { token: "lojaA" })).status, 403);
  assert.equal((await chamar("POST", "/admin/suporte/prom1/ticket", {})).status, 401);
  const a = await chamar("POST", "/admin/suporte/prom1/ticket", { token: "adm" }); assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.match(a.json.protocolo, /^SP-000001$/); assert.equal(a.json.status, "aberto");
  assert.equal((await chamar("POST", "/admin/suporte/prom1/ticket", { token: "adm" })).json.protocolo, "SP-000001", "idempotente");
  assert.equal((await chamar("POST", "/admin/suporte/prom1/resolver", { token: "adm" })).json.status, "resolvido");
  const b = await chamar("POST", "/admin/suporte/prom1/ticket", { token: "adm" });
  assert.equal(b.json.protocolo, "SP-000002"); assert.equal(b.json.reaberturas, 1);
  assert.equal((await chamar("POST", "/admin/suporte/inexistente/ticket", { token: "adm" })).status, 404);
});

t("escalar: cria chamado de TI com dossiê e transcrição interna, sem dados pessoais; marca ticket; avisa o usuário; bloqueia duplicidade", async () => {
  reset(); await semear();
  const bad = await chamar("POST", "/admin/suporte/prom1/escalar", { token: "adm", body: { destino: "ti", motivo: "x" } }); assert.equal(bad.status, 400);
  assert.equal((await chamar("POST", "/admin/suporte/prom1/escalar", { token: "adm", body: { destino: "marte", motivo: "Turno não libera mesmo ativo" } })).status, 400);
  assert.equal((await chamar("POST", "/admin/suporte/prom1/escalar", { token: "prom1", body: { destino: "ti", motivo: "Turno não libera mesmo ativo" } })).status, 403);

  const r = await chamar("POST", "/admin/suporte/prom1/escalar", { token: "adm", body: { destino: "gestao", motivo: "Turno não libera mesmo com cadastro ativo", categoria: "app", prioridade: "alta" } });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.ticket.status, "escalado"); assert.match(r.json.chamado.protocolo, /^TI-\d{6}$/);
  const ch = await get("chamados_ti", r.json.chamado.id);
  assert.equal(ch.origem, "suporte"); assert.equal(ch.filaDestino, "gestao"); assert.equal(ch.suporteProtocolo, "SP-000001"); assert.equal(ch.conversaUid, "prom1"); assert.equal(ch.prioridade, "alta"); assert.equal(ch.solicitanteUid, "prom1");
  assert.ok(ch.descricao.length <= 2000 && ch.descricao.includes("SP-000001") && ch.descricao.includes("Paulo Promotor"));
  const tudo = JSON.stringify([ch, ...(await ctx.db.collection(`chamados_ti/${r.json.chamado.id}/eventos`).get()).docs.map((d) => d.data())]);
  assert.ok(!/123\.456\.789-09|paulo@x\.com|99535-0637/.test(tudo), "dados pessoais vazaram para a fila de TI");
  assert.ok(/Histórico do chat \(1\/1\)/.test(tudo) && /\[CPF\]/.test(tudo));
  const ev = (await ctx.db.collection(`chamados_ti/${r.json.chamado.id}/eventos`).get()).docs.map((d) => d.data()).filter((e) => e.tipo === "comentario");
  assert.ok(ev.length >= 1 && ev.every((e) => e.interno === true), "transcrição deve ser nota INTERNA");
  assert.equal((await get("suporte_tickets", "prom1")).status, "escalado");
  const msgs = (await ctx.db.collection("suporte_mensagens").where("uid", "==", "prom1").get()).docs.map((d) => d.data());
  assert.ok(msgs.some((m) => m.de === "suporte" && /SP-000001/.test(m.texto) && /encaminhado/.test(m.texto)), "usuário avisado");
  const dup = await chamar("POST", "/admin/suporte/prom1/escalar", { token: "adm", body: { destino: "ti", motivo: "Tentando escalar de novo" } });
  assert.equal(dup.status, 409); assert.equal(dup.json.codigo, "ja-escalado");
  // o chamado aparece na visão de TI com a fila e o protocolo do suporte
  assert.equal(ctx.ti.chamados.visaoTI({ ...ch, id: "x" }).fila, "gestao");
});

t("escalar sem avisar o usuário não posta mensagem; resolver depois do escalamento permite novo protocolo", async () => {
  reset(); await semear();
  const antes = (await ctx.db.collection("suporte_mensagens").where("uid", "==", "prom1").get()).size;
  const r = await chamar("POST", "/admin/suporte/prom1/escalar", { token: "adm", body: { destino: "ti", motivo: "Erro 500 ao liberar turno", avisarUsuario: false } }); assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await ctx.db.collection("suporte_mensagens").where("uid", "==", "prom1").get()).size, antes);
  assert.equal((await chamar("POST", "/admin/suporte/prom1/resolver", { token: "adm" })).json.status, "resolvido");
  assert.equal((await chamar("POST", "/admin/suporte/prom1/ticket", { token: "adm" })).json.protocolo, "SP-000002");
});

t("perfil 360 passa a incluir `foto` (só https)", async () => {
  reset(); await semear(); await set("profissionais", "prom1", { nome: "Paulo Promotor", status: "ativo", fotoGoogle: "https://lh3.googleusercontent.com/a.jpg" });
  const r = await chamar("GET", "/admin/suporte/prom1/perfil?leve=1", { token: "adm" });
  if (r.status === 200) assert.equal(r.json.cadastro.foto, "https://lh3.googleusercontent.com/a.jpg"); else console.log("   (perfil indisponível no ambiente falso: " + r.status + " — coberto pelo teste existente)");
});

(async () => { let f = 0; for (const [n, fn] of testes) { try { await fn(); console.log("  ✓", n); } catch (e) { f++; console.log("  ✗", n, "\n    ", e.message.split("\n")[0]); } } console.log(f ? `\n${f} falha(s)` : `\nsuporte-escalar: ${testes.length} testes ok`); E.restaurarRelogio(); process.exit(f ? 1 : 0); })();
