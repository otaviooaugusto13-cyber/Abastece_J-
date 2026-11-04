// Mapa de promotores online (o raio vem do Admin Root: lib/operacao.js): filtro por distância (haversine), privacidade dos pins,
// presença (online/offline/expirado) e permissões. Sem rede (ver fake-env.cjs).  node test/mapa.test.cjs
const crypto = require("node:crypto");
process.env.AMBIENTE = "teste"; process.env.MODO_TESTE = "1"; process.env.APP_URL = "https://app.exemplo.com";
process.env.MP_ACCESS_TOKEN = "APP_USR-teste"; process.env.MP_WEBHOOK_SECRET = "segredo-webhook"; process.env.CRON_SECRET = "cron-secreto";
process.env.DATA_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString("base64")}`; process.env.DATA_ENCRYPTION_KEY_ID = "1"; process.env.BLIND_INDEX_KEY = crypto.randomBytes(32).toString("base64");
const assert = require("node:assert/strict");
const E = require("./fake-env.cjs");
const { ctx, chamar } = E.carregarServidor();
const { filtrarPorRaio, pinAnonimo, arredondar } = require("../server/lib/mapa.js");
const { distanciaM } = require("../server/lib/geo.js");

const BASE = { lat: -22.4358, lng: -46.8231 };                        // Itapira/SP (a "loja")
const grau = (km) => km / 111.19;                                      // 1° de latitude ≈ 111,19 km
const ponto = (km) => ({ lat: BASE.lat + grau(km), lng: BASE.lng });
const U = { loja: { uid: "loja1", email: "l@x.com", email_verified: true }, loja2: { uid: "loja2", email: "l2@x.com", email_verified: true }, adm: { uid: "adm1", email: "a@x.com", email_verified: true },
  p1: { uid: "p1", email: "p1@x.com", email_verified: true }, p2: { uid: "p2", email: "p2@x.com", email_verified: true }, p3: { uid: "p3", email: "p3@x.com", email_verified: true }, p4: { uid: "p4", email: "p4@x.com", email_verified: true }, pend: { uid: "pend", email: "pe@x.com", email_verified: true }, sem: { uid: "sem", email: "s@x.com", email_verified: true } };
const set = (c, id, d) => ctx.db.collection(c).doc(id).set(d);
const get = async (c, id) => (await ctx.db.collection(c).doc(id).get()).data();
const todos = async (c) => (await ctx.db.collection(c).get()).docs.map((d) => d.data());
const ok = (r, m = "") => assert.equal(r.status, 200, `${m} esperado 200, veio ${r.status} ${JSON.stringify(r.json)}`);
const falha = (r, status, codigo) => { assert.equal(r.status, status, `esperado ${status}/${codigo}, veio ${r.status} ${JSON.stringify(r.json)}`); if (codigo) assert.equal(r.json.codigo, codigo); };

async function reset() {
  E.limpar(); Object.assign(E.tokens, U); E.clock.now = Date.now(); ctx.__reset();
  await definirRaio(30);                                              // raio inicial dos cenários (o padrão do Root é 20 km)
  for (const k of ["loja", "loja2"]) E.claimsStore[U[k].uid] = { role: "loja" };
  E.claimsStore.adm1 = { role: "admin" };
  for (const k of ["p1", "p2", "p3", "p4", "pend"]) E.claimsStore[U[k].uid] = { role: "promotor", treinado: true };
  for (const k of ["p1", "p2", "p3", "p4"]) await set("profissionais", k, { uid: k, status: "ativo", treinamentoOk: true, nome: `Nome Secreto ${k}` });
  await set("profissionais", "pend", { uid: "pend", status: "pendente", treinamentoOk: false });
  await set("contratantes", "loja1", { razaoSocial: "Mercado Um", localizacao: { lat: BASE.lat, lng: BASE.lng, cidade: "Itapira", uf: "SP" } });
  await set("contratantes", "loja2", { razaoSocial: "Mercado Sem GPS" });
}
const definirRaio = (km) => ctx.operacao.salvar({ raioKm: km }, { ator: "root-teste" });
const online = (tk, km, extra = {}) => chamar("POST", "/promotor/online", { token: tk, body: { online: true, ...ponto(km), rumo: 90, precisao: 20, ...extra } });
const mapa = (tk = "loja", query = {}) => chamar("GET", "/loja/promotores-proximos", { token: tk, query });
const testes = []; const t = (n, f) => testes.push([n, f]);

// ---------- núcleo geoespacial (puro) ----------
t("haversine: filtra por raio (<=), ordena do mais perto ao mais longe e ignora posição velha ou inválida", () => {
  const agora = Date.now(), mk = (uid, km, extra = {}) => ({ uid, ...ponto(km), atualizadoMs: agora, ...extra });
  const lista = [mk("longe", 55), mk("a20", 20), mk("a5", 5), mk("a30", 29.9), mk("velho", 3, { atualizadoMs: agora - 120_000 }), { uid: "nan", lat: NaN, lng: 0, atualizadoMs: agora }];
  assert.deepEqual(filtrarPorRaio(lista, BASE, 30, { agora }).map((p) => p.uid), ["a5", "a20", "a30"]);
  assert.deepEqual(filtrarPorRaio(lista, BASE, 10, { agora }).map((p) => p.uid), ["a5"]);
  assert.deepEqual(filtrarPorRaio(lista, BASE, 1, { agora }), []);
  assert.ok(Math.abs(distanciaM(BASE, ponto(10)) / 1000 - 10) < 0.05, "10 km são 10 km");
  const borda = [mk("borda", 10)], dM = distanciaM(BASE, borda[0]); assert.equal(filtrarPorRaio(borda, BASE, dM / 1000, { agora }).length, 1);   // exatamente no raio = dentro
});
t("pin anônimo: sem uid/nome, coordenada arredondada a ~110 m, id estável e diferente do uid", () => {
  const p = pinAnonimo({ uid: "abc123", lat: -22.435812345, lng: -46.823199999, rumo: 45, distKm: 3.14159, nome: "Fulano" });
  assert.deepEqual(Object.keys(p).sort(), ["distKm", "lat", "lng", "pin", "rumo"]); assert.equal(p.lat, -22.436); assert.equal(p.lng, -46.823); assert.equal(p.distKm, 3.1);
  assert.equal(p.pin, pinAnonimo({ uid: "abc123", lat: 0, lng: 0, distKm: 0 }).pin); assert.notEqual(p.pin, "abc123"); assert.equal(arredondar(1.23456), 1.235);
});

// ---------- configuração do raio (admin) ----------
t("mapa: 30 km → 10 km → 1 km muda quem aparece imediatamente; contador exato; ordenado por distância", async () => {
  for (const [tk, km] of [["p1", 5], ["p2", 20], ["p3", 27.8], ["p4", 55]]) { const r = await online(tk, km); ok(r, tk); assert.equal(r.json.gravado, true); }
  let r = await mapa(); ok(r); assert.equal(r.json.raioKm, 30); assert.equal(r.json.total, 3); assert.deepEqual(r.json.pins.map((p) => p.distKm), [5, 20, 27.8]); assert.deepEqual(r.json.loja, { lat: BASE.lat, lng: BASE.lng });
  await definirRaio(10);
  r = await mapa(); assert.equal(r.json.raioKm, 10); assert.equal(r.json.total, 1); assert.equal(r.json.pins.length, 1); assert.ok(r.json.versaoRaio >= 1);
  await definirRaio(1);
  r = await mapa(); assert.equal(r.json.total, 0); assert.deepEqual(r.json.pins, []); assert.equal(r.json.semLocalizacao, undefined);         // caso "ninguém por perto": a tela mostra o aviso
  assert.equal(await ctx.mapa.contarOnline(), 4);                                                      // o admin vê quantos estão online no total
});
t("mapa: privacidade — a loja não recebe uid, nome nem coordenada exata; não consegue consultar outro ponto; ids estáveis entre consultas", async () => {
  ok(await online("p1", 4.1234));
  const a = await mapa(), b = await mapa("loja", { lat: "-23.5", lng: "-46.6", raio: "100", raioKm: "100" });                                  // parâmetros do navegador são ignorados
  assert.equal(a.json.pins.length, 1); const pin = a.json.pins[0]; assert.deepEqual(Object.keys(pin).sort(), ["distKm", "lat", "lng", "pin", "rumo"]);
  assert.ok(!JSON.stringify(a.json).includes("p1") && !JSON.stringify(a.json).includes("Secreto")); assert.equal(pin.lat, arredondar(ponto(4.1234).lat)); assert.equal(b.json.pins[0].pin, pin.pin); assert.equal(b.json.raioKm, 30);
  assert.ok(pin.pin !== "p1" && pin.pin.length === 10);
});
t("mapa: loja sem localização cadastrada recebe semLocalizacao (e nenhum pin); loja2 não vê dados da loja1", async () => {
  ok(await online("p1", 2)); const r = await mapa("loja2"); ok(r); assert.equal(r.json.semLocalizacao, true); assert.deepEqual(r.json.pins, []); assert.equal(r.json.total, 0);
});
t("mapa: promotor sai do mapa (online:false), expira sem sinal (45 s) e volta ao enviar posição", async () => {
  ok(await online("p1", 3)); ok(await online("p2", 6)); assert.equal((await mapa()).json.total, 2);
  ok(await chamar("POST", "/promotor/online", { token: "p1", body: { online: false } })); assert.equal((await get("promotores_online", "p1")), undefined); assert.equal((await mapa()).json.total, 1);
  E.avancar(46_000); assert.equal((await mapa()).json.total, 0);                                                                             // p2 parou de enviar posição
  ok(await online("p2", 6)); E.avancar(3_100); assert.equal((await mapa()).json.total, 1);   // o conjunto de online fica em cache por 3 s (compartilhado entre as lojas)
});
t("mapa: posição muito frequente é ignorada; GPS impreciso ou inválido é recusado; promotor não habilitado não aparece", async () => {
  ok(await online("p1", 3)); const r2 = await online("p1", 3.5); ok(r2); assert.equal(r2.json.gravado, false); assert.equal(r2.json.motivo, "muito-rapido");
  E.avancar(9_000); const r3 = await online("p1", 3.5); assert.equal(r3.json.gravado, true);
  const imp = await online("p2", 3, { precisao: 5000 }); ok(imp); assert.equal(imp.json.gravado, false); assert.equal(imp.json.motivo, "gps-impreciso");
  for (const ruim of [{ lat: 0, lng: 0 }, { lat: 200, lng: 10 }, { lat: "x", lng: 1 }, { lat: null, lng: null }]) falha(await chamar("POST", "/promotor/online", { token: "p2", body: { online: true, ...ruim } }), 400, "gps-invalido");
  falha(await chamar("POST", "/promotor/online", { token: "pend", body: { online: true, ...ponto(1) } }), 403, "promotor-nao-habilitado");
  falha(await chamar("POST", "/promotor/online", { token: "p2", body: { online: "talvez", ...ponto(1) } }), 400);
});
t("mapa: permissões — loja não envia posição, promotor não vê o mapa da loja, anônimo é barrado", async () => {
  falha(await chamar("POST", "/promotor/online", { token: "loja", body: { online: true, ...ponto(1) } }), 403); falha(await chamar("POST", "/promotor/online", { body: { online: true, ...ponto(1) } }), 401);
  falha(await mapa("p1"), 403); falha(await mapa("adm"), 403); falha(await mapa("sem"), 403); falha(await chamar("GET", "/loja/promotores-proximos", {}), 401);
});
t("mapa: mais de 100 promotores no raio → devolve os 100 mais perto, mas o contador mostra o total exato", async () => {
  const agora = Date.now(); for (let i = 0; i < 130; i++) await set("promotores_online", `m${i}`, { uid: `m${i}`, ...ponto(1 + i * 0.1), rumo: null, atualizadoMs: agora });
  const r = await mapa(); ok(r); assert.equal(r.json.total, 130); assert.equal(r.json.pins.length, 100); assert.equal(r.json.pins[0].distKm, 1);
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    await reset(); const w = console.warn, er = console.error; console.warn = () => {}; console.error = () => {};
    try { await fn(); process.stdout.write(`  ✓ ${nome}\n`); } catch (e) { falhas++; process.stdout.write(`  ✗ ${nome}\n      ${String(e.stack || e).split("\n").slice(0, 5).join("\n      ")}\n`); } finally { console.warn = w; console.error = er; }
  }
  E.restaurarRelogio(); process.stdout.write(`\n${testes.length - falhas}/${testes.length} testes do raio e do mapa passaram\n`); process.exit(falhas ? 1 : 0);
})();
