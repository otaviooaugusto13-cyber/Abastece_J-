// Teste do servidor SEM rede: express e firebase-admin são substituídos por fakes em memória.
// Valida as regras de negócio de ponta a ponta (cartão, 6 h, 3x/semana, valores, nota sem margens).
process.env.MODO_TESTE = "1"; process.env.APP_URL = "https://exemplo.onrender.com";
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

// ---------- Firestore falso ----------
const store = new Map(); // "col/id" -> data
let seq = 0;
const TS = { __ts: true };
const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
const snapDoc = (col, id) => { const k = `${col}/${id}`; const d = store.get(k); return { id, exists: d !== undefined, data: () => (d === undefined ? undefined : clone(d)), ref: docRef(col, id) }; };
const docRef = (col, id) => ({
  id, col,
  get: async () => snapDoc(col, id),
  set: async (data, opt) => { const k = `${col}/${id}`; store.set(k, opt?.merge ? { ...(store.get(k) || {}), ...clone(data) } : clone(data)); },
  update: async (data) => { const k = `${col}/${id}`; if (!store.has(k)) throw new Error("not found"); store.set(k, { ...store.get(k), ...clone(data) }); },
  delete: async () => { store.delete(`${col}/${id}`); }
});
const query = (col, filtros = []) => ({
  where: (f, op, v) => query(col, [...filtros, [f, v]]),
  limit: () => query(col, filtros),
  get: async () => { const docs = [...store.keys()].filter((k) => k.startsWith(col + "/")).map((k) => snapDoc(col, k.slice(col.length + 1))).filter((s) => filtros.every(([f, v]) => s.data()[f] === v)); return { docs, empty: docs.length === 0 }; },
  __query: true
});
const colecao = (col) => ({ doc: (id) => docRef(col, id || `auto${++seq}`), where: (...a) => query(col).where(...a), get: () => query(col).get() });
const fsDb = {
  collection: colecao,
  batch: () => { const ops = []; return { set: (r, d) => ops.push(() => r.set(d)), delete: (r) => ops.push(() => r.delete()), commit: async () => { for (const o of ops) await o(); } }; },
  runTransaction: async (fn) => fn({
    get: async (x) => (x.__query ? x.get() : x.get()),
    set: (r, d) => r.set(d), update: (r, d) => r.update(d)
  })
};
const tokens = {
  "t-loja": { uid: "teste-loja", teste: true, email: "l@x" }, "t-prom": { uid: "teste-promotor", teste: true, name: "Promotor Teste" },
  "t-lojaB": { uid: "lojaB" }, "t-prom2": { uid: "prom2" }
};
const adminFake = {
  apps: [1], credential: { cert: () => ({}) }, initializeApp: () => {},
  firestore: Object.assign(() => fsDb, { FieldValue: { serverTimestamp: () => TS }, Timestamp: { fromMillis: (m) => ({ ms: m }) } }),
  auth: () => ({ verifyIdToken: async (t) => { if (!tokens[t]) throw new Error("x"); return tokens[t]; }, createCustomToken: async (uid, c) => `custom:${uid}:${JSON.stringify(c)}` })
};
// ---------- express falso ----------
const rotas = {};
const expressFake = () => { const a = { set() {}, use() {}, get: (p, h) => (rotas["GET " + p] = h), post: (p, h) => (rotas["POST " + p] = h), all: (p, h) => (rotas["ALL " + p] = h), listen() {} }; return a; };
expressFake.json = () => {}; expressFake.static = () => {};
const orig = Module._load;
Module._load = function (req, ...r) { if (req === "express") return expressFake; if (req === "cors") return () => {}; if (req === "firebase-admin") return adminFake; return orig.call(this, req, ...r); };
require(path.join(__dirname, "../server/server.js"));
Module._load = orig;

async function chamar(rota, token, body = {}) {
  const h = rotas["POST " + rota] || rotas["ALL " + rota];
  let saida = { status: 200, json: null };
  const res = { status(s) { saida.status = s; return this; }, json(j) { saida.json = j; return this; }, sendStatus(s) { saida.status = s; return this; } };
  await h({ get: (n) => (n.toLowerCase() === "authorization" && token ? "Bearer " + token : ""), body, query: {}, protocol: "https" }, res);
  return saida;
}
const iso = (d) => d.toISOString().slice(0, 10);
(async () => {
  // próxima segunda-feira (semana inteira no futuro)
  const hoje = new Date(); const dias = ((8 - hoje.getUTCDay()) % 7) || 7; const seg = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() + dias));
  const dia = (n) => iso(new Date(seg.getTime() + n * 86400000));
  const base = { loja: "Mercado Central — Rua A, 1", foco: "Mercearia", entrada: "08:00", saida: "12:00" };
  store.set("profissionais/teste-promotor", { nome: "Promotor Teste", status: "ativo", mpConectado: true });
  store.set("profissionais/prom2", { nome: "Outro", status: "ativo", mpConectado: false });

  // 1) sem cartão não pode solicitar
  let r = await chamar("/criarPedido", "t-loja", { ...base, data: dia(0) });
  assert.equal(r.status, 402); assert.equal(r.json.codigo, "cartao-obrigatorio");

  // 2) cartão simulado só em conta de teste
  r = await chamar("/cartao/registrar", "t-lojaB", { simulado: true, ultimos4: "3704", mes: 12, ano: 2099, bandeira: "Visa" });
  assert.equal(r.status, 404 === r.status ? 404 : r.status); assert.ok([403, 404].includes(r.status));
  r = await chamar("/cartao/registrar", "t-loja", { simulado: true, ultimos4: "3704", mes: 12, ano: 2099, bandeira: "Visa" });
  assert.equal(r.status, 200);
  r = await chamar("/cartao/registrar", "t-loja", { simulado: true, ultimos4: "3704", mes: 1, ano: 2020, bandeira: "Visa" });
  assert.equal(r.status, 400); assert.equal(r.json.codigo, "cartao-vencido");

  // 3) trava de 6 horas
  r = await chamar("/criarPedido", "t-loja", { ...base, data: dia(0), saida: "14:01" });
  assert.equal(r.status, 400); assert.equal(r.json.codigo, "turno-invalido"); assert.match(r.json.erro, /6 horas/);
  r = await chamar("/criarPedido", "t-loja", { ...base, data: dia(0), entrada: "06:00", saida: "22:00" });
  assert.equal(r.status, 400);

  // 4) pedido de 6 h: valores
  r = await chamar("/criarPedido", "t-loja", { ...base, data: dia(0), saida: "14:00" });
  assert.equal(r.status, 200); assert.deepEqual(Object.keys(r.json).sort(), ["id", "taxaFixa", "total", "valor"]);
  assert.equal(r.json.total, 22149);
  const doc1 = store.get("solicitacoes/" + r.json.id);
  assert.equal(doc1.valorPromotorCentavos, 21000);                               // promotor: R$ 35 × 6 h
  assert.equal("valorCentavos" in doc1 || "pagamento" in doc1 || "total" in doc1, false); // doc visível ao promotor não traz o total
  assert.deepEqual(Object.keys(store.get("solicitacoes_financeiro/" + r.json.id)).filter((k) => ["promotor", "royalty", "app", "split"].includes(k)), []); // loja não vê repasse
  assert.equal(store.get("pagamentos_internos/" + r.json.id).split.royalty, 649);

  // 5) máx. 3 vezes por semana na mesma loja
  const ids = [r.json.id];
  for (let i = 1; i < 4; i++) { const x = await chamar("/criarPedido", "t-loja", { ...base, data: dia(i) }); assert.equal(x.status, 200); ids.push(x.json.id); }
  for (let i = 0; i < 3; i++) { const x = await chamar("/aceitarTurno", "t-prom", { solicitacaoId: ids[i] }); assert.equal(x.status, 200, JSON.stringify(x.json)); }
  r = await chamar("/aceitarTurno", "t-prom", { solicitacaoId: ids[3] });
  assert.equal(r.status, 409); assert.equal(r.json.codigo, "limite-semanal");
  // outro promotor sem MP conectado é barrado; turno já aceito não é aceito de novo
  r = await chamar("/aceitarTurno", "t-prom2", { solicitacaoId: ids[3] }); assert.equal(r.json.codigo, "promotor-sem-mp");
  r = await chamar("/aceitarTurno", "t-prom", { solicitacaoId: ids[0] }); assert.equal(r.json.codigo, "turno-indisponivel");
  // 4º turno em OUTRA semana passa
  const prox = await chamar("/criarPedido", "t-loja", { ...base, data: dia(7) });
  r = await chamar("/aceitarTurno", "t-prom", { solicitacaoId: prox.json.id }); assert.equal(r.status, 200);

  // 6) pagamento simulado: nota só com valor + taxa + total
  r = await chamar("/teste/pagar", "t-loja", { solicitacaoId: ids[0] });
  assert.equal(r.status, 200); assert.ok(r.json.notaId);
  const nota = store.get("notas/" + r.json.notaId);
  assert.deepEqual(Object.keys(nota.valores).sort(), ["taxaFixa", "total", "valor"]);
  assert.equal(nota.valores.total, 22149); assert.equal(nota.promotorUid, undefined);
  assert.equal(store.get("solicitacoes/" + ids[0]).status, "paga");
  assert.equal(store.get("pagamentos_internos/" + ids[0]).split.promotor, 21000);
  // conta que não é de teste não usa o pagamento simulado
  r = await chamar("/teste/pagar", "t-lojaB", { solicitacaoId: ids[0] }); assert.equal(r.status, 403);

  // 7) login de teste emite token com claim
  r = await chamar("/teste/login", null, { perfil: "promotor" }); assert.equal(r.status, 200); assert.match(r.json.customToken, /"teste":true/);
  console.log("✅ servidor (fake): cartão, 6 h, 3x/semana, valores e nota — OK");
})().catch((e) => { console.error("❌", e); process.exit(1); });
