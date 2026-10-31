// Bateria das funcionalidades avançadas: geofencing + foto, níveis/comissão, inatividade, vidas/multas/banimento, ruptura e B2B.
const crypto = require("node:crypto");
process.env.AMBIENTE = "teste"; process.env.MODO_TESTE = "1"; process.env.APP_URL = "https://app.exemplo.com";
process.env.MP_ACCESS_TOKEN = "APP_USR-teste"; process.env.MP_WEBHOOK_SECRET = "segredo-webhook"; process.env.CRON_SECRET = "cron-secreto";
process.env.DATA_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString("base64")}`; process.env.DATA_ENCRYPTION_KEY_ID = "1"; process.env.BLIND_INDEX_KEY = crypto.randomBytes(32).toString("base64");
const assert = require("node:assert/strict");
const E = require("./fake-env.cjs");
const { ctx, chamar } = E.carregarServidor();
const { V, S, C, Cripto } = ctx;
const DIA = 86_400_000, MIN = 60_000;
const LAT = -22.4358, LNG = -46.8216, M = 1 / 111_320;        // 1 metro em graus de latitude

const U = {
  lojaA: { uid: "lojaA", email: "a@x.com", email_verified: true }, lojaB: { uid: "lojaB", email: "b@x.com", email_verified: true },
  prom1: { uid: "prom1", email: "p@x.com", email_verified: true }, prom2: { uid: "prom2", email: "p2@x.com", email_verified: true },
  adm: { uid: "adm1", email: "adm@x.com", email_verified: true },
  marcaA: { uid: "marcaA", email: "ma@x.com", email_verified: true }, marcaB: { uid: "marcaB", email: "mb@x.com", email_verified: true }
};
const set = (col, id, d) => ctx.db.collection(col).doc(id).set(d);
const get = async (col, id) => (await ctx.db.collection(col).doc(id).get()).data();
const ok = (r, m = "") => assert.equal(r.status, 200, `${m} esperado 200, veio ${r.status} ${JSON.stringify(r.json)}`);
const falha = (r, status, codigo) => { assert.equal(r.status, status, `esperado ${status}/${codigo}, veio ${r.status} ${JSON.stringify(r.json)}`); if (codigo) assert.equal(r.json.codigo, codigo); };
const enc = (uid, campo, v) => Cripto.cifrar(v, `profissionais_privado/${campo}/${uid}`);
const CPFS = ["52998224725", "11144477735", "39053344705"];

/** relógio fixo: hoje às HH:MM de Brasília (determinístico, qualquer que seja a hora real de execução) */
const relogio = (hhmm) => { E.clock.now = V.instanteSP(V.hojeSP(Date.now()), hhmm); };
const avancarMin = (n) => E.avancar(n * MIN);
const dia = (n) => { const d = new Date(V.hojeSP() + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function reset() {
  E.limpar(); Object.assign(E.tokens, U);
  E.claimsStore.lojaA = { role: "loja" }; E.claimsStore.lojaB = { role: "loja" }; E.claimsStore.prom1 = { role: "promotor", treinado: true }; E.claimsStore.prom2 = { role: "promotor", treinado: true };
  E.claimsStore.adm1 = { role: "admin" }; E.claimsStore.marcaA = { role: "marca" }; E.claimsStore.marcaB = { role: "marca" };
  relogio("10:00"); ctx.__reset?.();
}
async function semearPromotor(uid = "prom1", cpfn = 0) {
  await set("profissionais", uid, { uid, nome: "Maria Silva " + uid, status: "ativo", treinamentoOk: true, habilitacoes: { mercearia: { em: new E.Timestamp(Date.now()), tentativas: 1, elite: true } } });
  await set("profissionais_privado", uid, { uid, cpfEnc: enc(uid, "cpf", CPFS[cpfn]), cpfIdx: Cripto.indiceCego(CPFS[cpfn]), nascimentoEnc: enc(uid, "nascimento", "1990-05-20") });
  await set("treinamento_modulos", "m1", { ordem: 1, titulo: "M", provedor: "youtube", videoRef: "abcdefghijk", duracaoSeg: 100, ativo: true });
  await set("treinamento_progresso", `${uid}_m1`, { uid, moduloId: "m1", validoSeg: 100, concluido: true });
}
async function lojaComCartao(uid = "lojaA", extra = {}) { await set("contratantes", uid, { uid, razaoSocial: "Mercado " + uid, localizacao: { lat: LAT, lng: LNG, cidade: "Itapira", uf: "SP" }, ...extra }); await set("cartoes", uid, { uid, status: "ativo", ultimos4: "1234" }); }
async function pedido(over = {}, token = "lojaA") {
  await lojaComCartao(token);
  const r = await chamar("POST", "/criarPedido", { token, body: { loja: "Mercado A — Rua 1", data: V.hojeSP(), entrada: "10:00", saida: "14:00", foco: "Mercearia", ...over } });
  ok(r, "criarPedido"); return r.json.id;
}
const aceitar = (sid, token = "prom1") => chamar("POST", "/aceitarTurno", { token, body: { solicitacaoId: sid } });
const fix = (extra = {}) => ({ lat: LAT, lng: LNG, precisao: 12, idadeFixMs: 800, ...extra });
const checkin = (sid, f = fix(), token = "prom1") => chamar("POST", "/checkin", { token, body: { solicitacaoId: sid, ...f } });
/** JPEG sintético válido (SOI + COM com bytes aleatórios + SOF0 com dimensões + EOI) */
function jpeg(w = 800, h = 600, bytes = 12_000) {
  const com = crypto.randomBytes(bytes), sof = Buffer.from([0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const c = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xfe, (bytes + 2) >> 8, (bytes + 2) & 255]), com, sof, Buffer.from([0xff, 0xd9])]);
  return "data:image/jpeg;base64," + c.toString("base64");
}
const miniatura = () => jpeg(160, 120, 900);
const checkout = (sid, over = {}, token = "prom1") => chamar("POST", "/checkout", { token, body: { solicitacaoId: sid, foto: jpeg(), miniatura: miniatura(), gondola: "cheia", ...fix(), ...over } });
/** aceita → check-in → espera a permanência → check-out */
async function executarPelaApi(sid, token = "prom1", espera = 125) { ok(await aceitar(sid, token), "aceitar"); ok(await checkin(sid, fix(), token), "checkin"); avancarMin(espera); ok(await checkout(sid, {}, token), "checkout"); }
const mpMock = (map) => { global.fetch = async (url, init = {}) => { const k = `${init.method || "GET"} ${String(url).replace("https://api.mercadopago.com", "")}`; const h = map[k]; if (!h) return { ok: false, status: 404, json: async () => ({}) }; return { ok: true, status: 200, json: async () => h }; }; };
async function pagar(sid, valor = 200, token = "lojaA") { mpMock({ "GET /v1/payments/777": { id: 777, status: "approved", external_reference: sid, currency_id: "BRL", transaction_amount: valor, payment_type_id: "credit_card", fee_details: [] } }); return chamar("POST", "/confirmarPagamento", { token, body: { solicitacaoId: sid, paymentId: "777" } }); }
const seedRep = (uid, d) => set("reputacao", uid, { uid, papel: "promotor", advertencias: 0, banido: false, ...d });
const ts = (ms) => new E.Timestamp(ms);

const testes = []; const t = (n, f) => testes.push([n, f]);

// =================== NÍVEIS ===================
t("níveis: limiares 30/90/190 e comissão 25/20/15/10% (R$ 50/40/30/20), sempre fechando em R$ 200", async () => {
  for (const [n, id] of [[0, "bronze"], [29, "bronze"], [30, "prata"], [89, "prata"], [90, "ouro"], [189, "ouro"], [190, "platina"], [999, "platina"]]) assert.equal(S.nivelPorConcluidos(n).id, id, `${n}`);
  for (const [id, prom, com] of [["bronze", 15000, 5000], ["prata", 16000, 4000], ["ouro", 17000, 3000], ["platina", 18000, 2000]]) { const d = S.calcularDiaria(S.PADRAO, id); assert.deepEqual([d.promotor, d.comissao, d.total, d.promotor + d.app], [prom, com, 20000, 20000], id); }
  const b = S.calcularDiaria(S.PADRAO, "ouro", 3000); assert.deepEqual([b.total, b.promotor, b.comissao], [23000, 20000, 3000]);   // bônus 100% do promotor
});
t("o 30º chamado concluído (check-out) promove a Prata; o próximo turno já nasce com comissão de 20%", async () => {
  await semearPromotor(); await seedRep("prom1", { nivel: "bronze", concluidos: 29, nivelDesde: ts(Date.now()), atividadeRefEm: ts(Date.now()) });
  const s1 = await pedido(); await executarPelaApi(s1);
  const rep = await get("reputacao", "prom1"); assert.deepEqual([rep.concluidos, rep.nivel], [30, "prata"]);
  assert.equal((await get("solicitacoes", s1)).valorPromotorCentavos, 15000, "o turno aceito como Bronze mantém a comissão do Bronze");
  const s2 = await pedido({ entrada: "16:00", saida: "20:00" }); ok(await aceitar(s2));
  const p = await get("solicitacoes", s2); assert.deepEqual([p.nivelAceite, p.comissaoPct, p.valorPromotorCentavos], ["prata", 20, 16000]);
  relogio("16:10"); ok(await checkin(s2)); avancarMin(125); ok(await checkout(s2));
  ok(await pagar(s2));
  assert.equal((await get("carteiras", "prom1")).pendenteCentavos, 16000); assert.equal((await get("carteiras", "PLATAFORMA")).disponivelCentavos, 4000);
  assert.equal((await get("solicitacoes_financeiro", s2)).total, 20000, "a loja paga o mesmo valor em qualquer nível");
  const c = await chamar("GET", "/admin/conciliacao", { token: "adm" }); assert.equal(c.json.ok, true, JSON.stringify(c.json.divergencias));
  const r = await chamar("GET", "/reputacao", { token: "prom1" }); ok(r); assert.deepEqual([r.json.nivel.id, r.json.proximo.id, r.json.proximo.faltam], ["prata", "ouro", 59]);
});
t("inatividade: 2 meses sem concluir rebaixa (1 nível por período) ou zera, e o contador acompanha", async () => {
  await semearPromotor(); const agora = Date.now();
  await seedRep("prom1", { nivel: "ouro", concluidos: 100, nivelDesde: ts(agora - 200 * DIA), atividadeRefEm: ts(agora - 65 * DIA) });
  let r = await chamar("GET", "/reputacao", { token: "prom1" }); assert.deepEqual([r.json.nivel.id, r.json.concluidos], ["prata", 30]);
  r = await chamar("GET", "/reputacao", { token: "prom1" }); assert.equal(r.json.nivel.id, "prata", "idempotente: não rebaixa duas vezes pelo mesmo período");
  await seedRep("prom1", { nivel: "platina", concluidos: 200, nivelDesde: ts(agora), atividadeRefEm: ts(agora - 130 * DIA) });
  r = await chamar("GET", "/reputacao", { token: "prom1" }); assert.deepEqual([r.json.nivel.id, r.json.concluidos], ["prata", 30]);   // 130 dias = 2 períodos: platina → ouro → prata
});
t("inatividade em modo 'resetar' volta ao Bronze; cron de manutenção também aplica", async () => {
  await semearPromotor(); const agora = Date.now(); const antes = C.INATIVIDADE_MODO;
  C.INATIVIDADE_MODO = "resetar";
  try {
    await seedRep("prom1", { nivel: "ouro", concluidos: 120, nivelDesde: ts(agora), atividadeRefEm: ts(agora - 61 * DIA) });
    const m = await chamar("POST", "/interno/manutencao", { headers: { "x-cron-secret": "cron-secreto" } }); ok(m); assert.equal(m.json.rebaixados, 1);
    assert.deepEqual([(await get("reputacao", "prom1")).nivel, (await get("reputacao", "prom1")).concluidos], ["bronze", 0]);
  } finally { C.INATIVIDADE_MODO = antes; }
  falha(await chamar("POST", "/interno/manutencao", { headers: { "x-cron-secret": "x" } }), 401);
});

// =================== GEOFENCING ===================
t("check-in: 99 m passa, 101 m não; GPS impreciso/antigo recusados; tentativas negadas ficam registradas", async () => {
  await semearPromotor(); const sid = await pedido(); ok(await aceitar(sid));
  falha(await checkin(sid, fix({ lat: LAT + 150 * M })), 409, "fora-do-raio");
  const neg = await chamar("POST", "/checkin", { token: "prom1", body: { solicitacaoId: sid, ...fix({ lat: LAT + 101 * M }) } }); falha(neg, 409, "fora-do-raio"); assert.ok(neg.json.detalhe.distanciaM > 100); assert.match(neg.json.erro, /101|102/);
  falha(await checkin(sid, fix({ precisao: 150 })), 409, "gps-impreciso");
  falha(await checkin(sid, fix({ idadeFixMs: 300_000 })), 409, "gps-antigo");
  falha(await checkin(sid, { lat: "x", lng: 1, precisao: 5, idadeFixMs: 1 }), 400, "gps-invalido");
  falha(await checkin(sid, { lat: 0, lng: 0, precisao: 5, idadeFixMs: 1 }), 400, "gps-invalido");
  assert.equal((await get("solicitacoes", sid)).checkinNegados, 4); assert.ok(!(await get("solicitacoes", sid)).fase, "nada de fase sem check-in válido");
  const negados = (await ctx.db.collection("presencas").where("ok", "==", false).get()).docs; assert.equal(negados.length, 4);
});
t("check-in: janela de horário, uma vez só, só o promotor do turno, loja precisa ter localização", async () => {
  await semearPromotor(); await semearPromotor("prom2", 1);
  const sid = await pedido({ entrada: "14:00", saida: "18:00" }); ok(await aceitar(sid));
  falha(await checkin(sid), 409, "checkin-cedo"); relogio("13:29"); falha(await checkin(sid), 409, "checkin-cedo"); relogio("13:31"); ok(await checkin(sid));
  falha(await checkin(sid), 409, "checkin-ja-feito"); falha(await checkin(sid, fix(), "prom2"), 404, "nao-encontrado");
  const s2 = await pedido({ entrada: "08:00", saida: "12:00" }); ok(await aceitar(s2, "prom2")); relogio("11:00"); falha(await checkin(s2, fix(), "prom2"), 409, "checkin-expirado");
  await set("contratantes", "lojaB", { uid: "lojaB" }); await set("cartoes", "lojaB", { uid: "lojaB", status: "ativo" });
  falha(await chamar("POST", "/criarPedido", { token: "lojaB", body: { loja: "Mercado B — Rua 2", data: dia(1), entrada: "08:00", saida: "12:00", foco: "Mercearia" } }), 409, "localizacao-obrigatoria");
});
t("loja define a localização (GPS ou manual) com UF válida; coordenadas inválidas são recusadas", async () => {
  const b = { lat: LAT, lng: LNG, precisao: 20, cidade: "Itapira", uf: "sp" };
  ok(await chamar("POST", "/loja/localizacao", { token: "lojaA", body: b })); assert.equal((await get("contratantes", "lojaA")).localizacao.uf, "SP");
  falha(await chamar("POST", "/loja/localizacao", { token: "lojaA", body: { ...b, uf: "XX" } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/loja/localizacao", { token: "lojaA", body: { ...b, lat: 120 } }), 400, "gps-invalido");
  falha(await chamar("POST", "/loja/localizacao", { token: "prom1", body: b }), 403, "sem-permissao");
});

// =================== CHECK-OUT + FOTO ===================
t("check-out exige check-in, foto JPEG íntegra e inédita, permanência mínima; só então libera o pagamento", async () => {
  await semearPromotor(); const sid = await pedido(); ok(await aceitar(sid));
  falha(await checkout(sid), 409, "checkin-pendente");
  falha(await chamar("POST", "/criarCobranca", { token: "lojaA", body: { solicitacaoId: sid } }), 409, "execucao-pendente");
  ok(await checkin(sid));
  falha(await checkout(sid), 409, "permanencia-minima");
  avancarMin(125);
  falha(await checkout(sid, { foto: undefined }), 400, "foto-invalida");
  falha(await checkout(sid, { foto: "data:image/png;base64,AAAA" }), 400, "foto-invalida");
  falha(await checkout(sid, { foto: "data:image/jpeg;base64," + Buffer.alloc(20_000, 1).toString("base64") }), 400, "foto-invalida");     // sem assinatura JPEG
  falha(await checkout(sid, { foto: jpeg(300, 200) }), 400, "foto-invalida");                                                                // pequena demais
  falha(await checkout(sid, { foto: jpeg(800, 600, 600_000) }), 400, "foto-invalida");   // acima do limite
  falha(await checkout(sid, { gondola: "vazia" }), 400, "dados-invalidos");
  const f = jpeg(); ok(await checkout(sid, { foto: f, observacao: "ok" }));
  const so = await get("solicitacoes", sid); assert.deepEqual([so.fase, so.checkout.gondola, so.checkout.noRaio], ["executada", "cheia", true]);
  const foto = await get("fotos_checkout", sid); assert.equal(foto.promotorUid, "prom1"); assert.equal(foto.largura, 800); assert.ok(foto.sha256 && foto.imagem && foto.miniatura);
  falha(await checkout(sid), 409, "checkout-ja-feito");
  const s2 = await pedido({ entrada: "16:00", saida: "20:00" }); ok(await aceitar(s2)); relogio("16:05"); ok(await checkin(s2)); avancarMin(125);
  falha(await checkout(s2, { foto: f }), 409, "foto-repetida");
  const p = await chamar("POST", "/criarCobranca", { token: "lojaA", body: { solicitacaoId: sid } }); assert.notEqual(p.json.codigo, "execucao-pendente");   // liberado (falha adiante só por APP_URL/MP)
  ok(await pagar(sid)); assert.equal((await get("solicitacoes", sid)).status, "paga");
});
t("a foto só é entregue a quem tem direito (loja dona, promotor, admin) e a loja audita/contesta", async () => {
  await semearPromotor(); await semearPromotor("prom2", 1); const sid = await pedido(); await executarPelaApi(sid);
  for (const tk of ["lojaA", "prom1", "adm"]) { const r = await chamar("GET", `/execucao/foto/${sid}`, { token: tk }); ok(r, tk); assert.equal(r.h["Content-Type"], "image/jpeg"); }
  ok(await chamar("GET", `/execucao/foto/${sid}`, { token: "lojaA", query: { miniatura: "1" } }));
  await lojaComCartao("lojaB"); falha(await chamar("GET", `/execucao/foto/${sid}`, { token: "lojaB" }), 404, "nao-encontrado"); falha(await chamar("GET", `/execucao/foto/${sid}`, { token: "prom2" }), 404, "nao-encontrado");
  falha(await chamar("POST", "/auditarFoto", { token: "lojaA", body: { solicitacaoId: sid, resultado: "contestada", comentario: "" } }), 400);
  ok(await chamar("POST", "/auditarFoto", { token: "lojaA", body: { solicitacaoId: sid, resultado: "contestada", comentario: "Gôndola de bebidas vazia" } }));
  falha(await chamar("POST", "/auditarFoto", { token: "lojaA", body: { solicitacaoId: sid, resultado: "aprovada" } }), 409, "ja-auditado");
  falha(await chamar("POST", "/auditarFoto", { token: "lojaB", body: { solicitacaoId: sid, resultado: "aprovada" } }), 404, "nao-encontrado");
});

// =================== VIDAS, MULTAS, BANIMENTO ===================
t("desistir em cima da hora = advertência + multa debitada + vida a menos; com antecedência não pune", async () => {
  await semearPromotor();
  const longe = await pedido({ data: dia(3) }); ok(await aceitar(longe)); const r0 = await chamar("POST", "/desistirTurno", { token: "prom1", body: { solicitacaoId: longe } }); ok(r0); assert.equal(r0.json.infracao, null);
  const sid = await pedido(); ok(await aceitar(sid));
  const r = await chamar("POST", "/desistirTurno", { token: "prom1", body: { solicitacaoId: sid } }); ok(r);
  assert.deepEqual([r.json.infracao.tipo, r.json.infracao.vidas, r.json.infracao.multaCentavos], ["desistencia_tardia", 2, 3000]);
  assert.equal((await get("carteiras", "prom1")).disponivelCentavos, -3000); assert.equal((await get("carteiras", "PLATAFORMA")).disponivelCentavos, 3000);
  const rep = await chamar("GET", "/reputacao", { token: "prom1" }); assert.deepEqual([rep.json.vidas, rep.json.advertencias, rep.json.infracoes.length], [2, 1, 1]);
  const c = await chamar("GET", "/admin/conciliacao", { token: "adm" }); assert.equal(c.json.ok, true, JSON.stringify(c.json.divergencias));
});
t("falta (sem check-in até o fim da janela) é detectada sozinha, uma única vez, e libera o pedido da loja", async () => {
  await semearPromotor(); const sid = await pedido(); ok(await aceitar(sid)); relogio("11:05");
  let r = await chamar("GET", "/reputacao", { token: "prom1" }); assert.deepEqual([r.json.vidas, r.json.infracoes[0].tipo], [2, "falta_promotor"]);
  r = await chamar("GET", "/reputacao", { token: "prom1" }); assert.equal(r.json.vidas, 2, "não pune duas vezes");
  const o = await get("solicitacoes", sid); assert.deepEqual([o.status, o.motivoCancelamento], ["cancelada", "falta_promotor"]);
  assert.equal((await get("carteiras", "prom1")).disponivelCentavos, -5000);
});
t("3ª advertência bane: claim, status, sessões, turnos liberados, rotas fechadas e motivo visível", async () => {
  await semearPromotor(); const ids = [];
  for (const [e, s] of [["10:00", "14:00"], ["14:30", "18:30"], ["19:00", "23:00"]]) ids.push(await pedido({ entrada: e, saida: s }));
  const outra = await pedido({ data: dia(4), entrada: "08:00", saida: "12:00" }); ok(await aceitar(outra));
  let ultimo; for (const id of ids) { ok(await aceitar(id)); ultimo = await chamar("POST", "/desistirTurno", { token: "prom1", body: { solicitacaoId: id } }); ok(ultimo); }
  assert.deepEqual([ultimo.json.infracao.vidas, ultimo.json.infracao.banido], [0, true]);
  assert.equal(E.claimsStore.prom1.banido, true); assert.equal((await get("profissionais", "prom1")).status, "bloqueado");
  assert.equal((await get("solicitacoes", outra)).status, "aberta", "turnos futuros do banido voltam para a fila");
  falha(await chamar("GET", "/reputacao", { token: "prom1" }), 401, "sessao-invalida");     // sessão revogada
  E.revogados.delete("prom1");                                                               // novo login: o token já nasce com a claim
  falha(await aceitar(ids[0]), 403, "conta-banida"); falha(await chamar("GET", "/carteira", { token: "prom1" }), 403, "conta-banida");
  const r = await chamar("GET", "/reputacao", { token: "prom1" }); ok(r); assert.equal(r.json.banido, true); assert.match(r.json.banidoMotivo, /3 advertências|advertências acumuladas/); assert.equal(r.json.vidas, 0);
});
t("loja: cancelar com promotor escalado em cima da hora pune; com antecedência ou sem promotor não; 3 bane a loja", async () => {
  await semearPromotor(); await lojaComCartao();
  const aberta = await pedido(); const r1 = await chamar("POST", "/cancelarPedido", { token: "lojaA", body: { solicitacaoId: aberta } }); ok(r1); assert.equal(r1.json.infracao, null);
  const futura = await pedido({ data: dia(5) }); ok(await aceitar(futura)); const r2 = await chamar("POST", "/cancelarPedido", { token: "lojaA", body: { solicitacaoId: futura } }); ok(r2); assert.equal(r2.json.infracao, null);
  let r; for (const [e, s] of [["10:00", "14:00"], ["14:30", "18:30"], ["19:00", "23:00"]]) { const id = await pedido({ entrada: e, saida: s }); ok(await aceitar(id)); r = await chamar("POST", "/cancelarPedido", { token: "lojaA", body: { solicitacaoId: id } }); ok(r); }
  assert.deepEqual([r.json.infracao.tipo, r.json.infracao.multaCentavos, r.json.infracao.banido], ["cancelamento_tardio_loja", 4000, true]);
  assert.equal((await get("infracoes", r.json.infracao.id)).multaStatus, "pendente"); assert.equal(E.claimsStore.lojaA.banido, true);
  E.revogados.delete("lojaA"); falha(await chamar("POST", "/criarPedido", { token: "lojaA", body: {} }), 403, "conta-banida");
});
t("cancelar/desistir depois do check-in é bloqueado; promotor reporta loja ausente e a LOJA recebe a advertência", async () => {
  await semearPromotor(); const sid = await pedido(); ok(await aceitar(sid)); ok(await checkin(sid));
  falha(await chamar("POST", "/cancelarPedido", { token: "lojaA", body: { solicitacaoId: sid } }), 409, "servico-em-andamento");
  falha(await chamar("POST", "/desistirTurno", { token: "prom1", body: { solicitacaoId: sid } }), 409, "servico-em-andamento");
  falha(await chamar("POST", "/reportarFaltaLoja", { token: "prom1", body: { solicitacaoId: sid, motivo: "Loja fechada" } }), 409, "aguarde");
  avancarMin(21); ok(await chamar("POST", "/reportarFaltaLoja", { token: "prom1", body: { solicitacaoId: sid, motivo: "Loja fechada" } }));
  assert.equal((await get("solicitacoes", sid)).motivoCancelamento, "falta_loja");
  const r = await chamar("GET", "/reputacao", { token: "lojaA" }); assert.deepEqual([r.json.vidas, r.json.infracoes[0].tipo], [2, "falta_loja"]);
});
t("admin revoga infração (devolve multa e vida, desfaz o banimento que ela causou) e desbane manualmente", async () => {
  await semearPromotor(); await seedRep("prom1", { nivel: "bronze", concluidos: 0, advertencias: 2 });
  const sid = await pedido(); ok(await aceitar(sid)); const r = await chamar("POST", "/desistirTurno", { token: "prom1", body: { solicitacaoId: sid } }); assert.equal(r.json.infracao.banido, true);
  const inf = r.json.infracao.id; falha(await chamar("POST", `/admin/infracoes/${inf}/revogar`, { token: "lojaA", body: { motivo: "teste ok" } }), 403);
  const rv = await chamar("POST", `/admin/infracoes/${inf}/revogar`, { token: "adm", body: { motivo: "Contestação procedente" } }); ok(rv); assert.deepEqual([rv.json.vidas, rv.json.desbanir], [1, true]);
  assert.equal(E.claimsStore.prom1.banido, false); assert.equal((await get("profissionais", "prom1")).status, "ativo"); assert.equal((await get("carteiras", "prom1")).disponivelCentavos, 0);
  falha(await chamar("POST", `/admin/infracoes/${inf}/revogar`, { token: "adm", body: { motivo: "repetido ok" } }), 409, "infracao-revogada");
  const c = await chamar("GET", "/admin/conciliacao", { token: "adm" }); assert.equal(c.json.ok, true, JSON.stringify(c.json.divergencias));
  await set("reputacao", "prom2", { uid: "prom2", papel: "promotor", banido: true, advertencias: 3 }); E.claimsStore.prom2 = { role: "promotor", banido: true };
  ok(await chamar("POST", "/admin/contas/prom2/desbanir", { token: "adm", body: { motivo: "Revisão manual", zerar: true } })); assert.equal((await get("reputacao", "prom2")).advertencias, 0); assert.equal(E.claimsStore.prom2.banido, false);
});
t("sandbox: contas de teste nunca recebem advertência", async () => {
  const r = await ctx.reputacao.aplicarInfracao({ uid: "teste-promotor", papel: "promotor", tipo: "falta_promotor", pedidoId: "x" }); assert.equal(r.ignorada, true);
});

// =================== RUPTURA ===================
t("chamado relâmpago: bônus só nas opções, alcance por raio/categoria/habilitação, expira, e o bônus vai 100% ao promotor", async () => {
  await semearPromotor(); await semearPromotor("prom2", 1); await set("profissionais", "prom3", { uid: "prom3", nome: "Longe", status: "ativo", treinamentoOk: true });
  const agora = Date.now(), pos = (uid, extra) => set("alertas_promotor", uid, { uid, ativo: true, lat: LAT, lng: LNG, posEm: ts(agora), ...extra });
  await pos("prom1", {}); await pos("prom2", { lat: LAT + 8000 * M }); await pos("prom3", { lat: LAT + 100 * M, posEm: ts(agora - 30 * 3_600_000) });
  await set("profissionais", "prom1", { uid: "prom1", nome: "Maria", status: "ativo", treinamentoOk: true, especialidade: "Bebidas", habilitacoes: { mercearia: { em: new E.Timestamp(Date.now()), tentativas: 1, elite: true } } });
  await lojaComCartao();
  const base = { loja: "Mercado A — Rua 1", foco: "Bebidas", bonusCentavos: 3000, observacao: "Gôndola de cerveja zerada" };
  falha(await chamar("POST", "/criarRuptura", { token: "lojaA", body: { ...base, bonusCentavos: 1234 } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/criarRuptura", { token: "prom1", body: base }), 403, "sem-permissao");
  const r = await chamar("POST", "/criarRuptura", { token: "lojaA", body: base }); ok(r); assert.deepEqual([r.json.total, r.json.bonus, r.json.valor, r.json.destinatarios], [23000, 3000, 20000, 1]);   // prom2 longe (8 km), prom3 posição velha
  const o = await get("solicitacoes", r.json.id); assert.deepEqual([o.tipo, o.urgente, o.status, o.exigeExecucao], ["ruptura", true, "aberta", true]); assert.equal(o.valorPromotorCentavos, 18000);
  ok(await aceitar(r.json.id));
  assert.equal((await get("solicitacoes", r.json.id)).valorPromotorCentavos, 18000);
  ok(await checkin(r.json.id)); falha(await checkout(r.json.id), 409, "permanencia-minima"); avancarMin(31); ok(await checkout(r.json.id));
  falha(await pagar(r.json.id, 200), 400, "valor-divergente"); ok(await pagar(r.json.id, 230));
  assert.equal((await get("carteiras", "prom1")).pendenteCentavos, 18000); assert.equal((await get("carteiras", "PLATAFORMA")).disponivelCentavos, 5000);
  const c = await chamar("GET", "/admin/conciliacao", { token: "adm" }); assert.equal(c.json.ok, true, JSON.stringify(c.json.divergencias));
});
t("chamado relâmpago sem aceite expira em 30 min (sem multa) e não pode mais ser aceito", async () => {
  await semearPromotor(); await lojaComCartao();
  const r = await chamar("POST", "/criarRuptura", { token: "lojaA", body: { loja: "Mercado A — Rua 1", foco: "Mercearia", bonusCentavos: 2000 } }); ok(r);
  avancarMin(31); falha(await aceitar(r.json.id), 409, "turno-expirado");
  ok(await chamar("POST", "/interno/manutencao", { headers: { "x-cron-secret": "cron-secreto" } }));
  assert.deepEqual([(await get("solicitacoes", r.json.id)).status, (await get("solicitacoes", r.json.id)).motivoCancelamento], ["cancelada", "expirada"]);
  assert.equal((await get("reputacao", "lojaA"))?.advertencias || 0, 0);
});
t("promotor liga/desliga alertas com posição válida", async () => {
  await semearPromotor();
  ok(await chamar("POST", "/promotor/alertas", { token: "prom1", body: { ativo: true, lat: LAT, lng: LNG, fcmToken: "t".repeat(40) } })); assert.equal((await get("alertas_promotor", "prom1")).ativo, true);
  falha(await chamar("POST", "/promotor/alertas", { token: "prom1", body: { ativo: true, lat: 999, lng: 0 } }), 400, "gps-invalido");
  ok(await chamar("POST", "/promotor/alertas", { token: "prom1", body: { ativo: false } })); assert.equal((await get("alertas_promotor", "prom1")).ativo, false);
});

// =================== B2B ===================
t("painel B2B: cada marca vê só os seus pedidos; métricas, ranking, presença por GPS e fotos; acesso controlado", async () => {
  await semearPromotor(); await semearPromotor("prom2", 1);
  const m1 = await chamar("POST", "/admin/marcas", { token: "adm", body: { nome: "Marca Alfa" } }); ok(m1); const m2 = await chamar("POST", "/admin/marcas", { token: "adm", body: { nome: "Marca Beta" } });
  E.claimsStore.marcaA = {}; E.claimsStore.marcaB = {};
  ok(await chamar("POST", `/admin/marcas/${m1.json.id}/acesso`, { token: "adm", body: { email: "ma@x.com" } })); ok(await chamar("POST", `/admin/marcas/${m2.json.id}/acesso`, { token: "adm", body: { email: "mb@x.com" } }));
  assert.equal(E.claimsStore.marcaA.role, "marca");
  falha(await chamar("POST", `/admin/marcas/${m1.json.id}/acesso`, { token: "adm", body: { email: "a@x.com" } }), 409, "papel-conflito");
  falha(await chamar("POST", `/admin/marcas/${m1.json.id}/acesso`, { token: "lojaA", body: { email: "ma@x.com" } }), 403);
  const lista = await chamar("GET", "/marcas", { token: "lojaA" }); ok(lista); assert.equal(lista.json.length, 2);
  const s1 = await pedido({ marcaId: m1.json.id }); await executarPelaApi(s1);
  const s2 = await pedido({ marcaId: m1.json.id, entrada: "16:00", saida: "20:00" }); ok(await aceitar(s2, "prom2")); relogio("16:05"); ok(await checkin(s2, fix(), "prom2")); avancarMin(125); ok(await checkout(s2, { gondola: "parcial" }, "prom2"));
  const s3 = await pedido({ marcaId: m2.json.id, data: dia(1) });
  falha(await chamar("POST", "/criarPedido", { token: "lojaA", body: { loja: "Mercado A — Rua 1", data: dia(1), entrada: "08:00", saida: "12:00", foco: "Mercearia", marcaId: "naoexiste" } }), 400, "dados-invalidos");
  const r = await chamar("GET", "/b2b/painel", { token: "marcaA" }); ok(r);
  assert.deepEqual([r.json.kpis.chamados, r.json.kpis.executados, r.json.kpis.taxaGondolaCheia, r.json.kpis.fotosAuditoria, r.json.kpis.promotores], [2, 2, 50, 2, 2]);
  assert.equal(r.json.porRegiao[0].regiao, "Itapira/SP"); assert.ok(r.json.porRegiao[0].horas >= 4); assert.equal(r.json.ranking.length, 2); assert.match(r.json.ranking[0].nome, /^Maria P\.$/);
  assert.ok(r.json.presencas[0].noRaio === true && r.json.presencas[0].distanciaM <= 100); assert.equal(r.json.fotos.length, 2); assert.match(r.json.fotos[0].miniatura, /^data:image\/jpeg;base64,/);
  assert.ok(!JSON.stringify(r.json).includes("prom1") && !JSON.stringify(r.json).includes("lojaA"), "sem UIDs no painel");
  const b = await chamar("GET", "/b2b/painel", { token: "marcaB" }); ok(b); assert.equal(b.json.kpis.chamados, 1); assert.equal(b.json.kpis.executados, 0);
  ok(await chamar("GET", `/b2b/foto/${s1}`, { token: "marcaA" })); falha(await chamar("GET", `/b2b/foto/${s1}`, { token: "marcaB" }), 404, "nao-encontrado");
  falha(await chamar("GET", "/b2b/painel", { token: "lojaA" }), 403, "sem-permissao"); falha(await chamar("GET", "/b2b/painel", { token: "prom1" }), 403, "sem-permissao");
  ok(await chamar("POST", `/admin/marcas/${m1.json.id}/acesso`, { token: "adm", body: { email: "ma@x.com", remover: true } })); falha(await chamar("GET", "/b2b/painel", { token: "marcaA" }), 403, "sem-marca");
});

// =================== REGRAS DO FIRESTORE ===================
t("regras do Firestore: reputação/infrações só leitura do dono; foto, presença, alertas e marcas só pela API", async () => {
  const rules = require("node:fs").readFileSync(require("node:path").join(__dirname, "../firestore.rules"), "utf8");
  for (const col of ["fotos_checkout", "presencas", "alertas_promotor", "marcas", "niveis_historico"]) assert.ok(new RegExp("match \\/" + col + "\\/\\{\\w+\\}\\s*\\{ allow read, write: if false;").test(rules), col);
  assert.match(rules, /match \/reputacao\/\{uid\}\s*\{ allow read: if dono\(uid\) \|\| ehAdmin\(\); allow write: if false;/);
  assert.match(rules, /match \/infracoes\/\{id\}\s*\{ allow read: if logado\(\) && \(resource\.data\.uid == request\.auth\.uid \|\| ehAdmin\(\)\); allow write: if false;/);
  assert.match(rules, /treinado\(\) && !banido\(\) && resource\.data\.status == 'aberta'/);
  const upd = /match \/contratantes\/\{uid\}[\s\S]*?soMuda\(\[([^\]]*)\]\)/.exec(rules)[1]; assert.ok(!upd.includes("localizacao"), "a loja não pode forjar a localização pelo cliente");
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    reset(); const w = console.warn, e = console.error; console.warn = () => {}; console.error = () => {};
    try { await fn(); process.stdout.write(`  ✓ ${nome}\n`); }
    catch (err) { falhas++; process.stdout.write(`  ✗ ${nome}\n      ${String(err.stack || err).split("\n").slice(0, 5).join("\n      ")}\n`); }
    finally { console.warn = w; console.error = e; }
  }
  E.restaurarRelogio(); process.stdout.write(`\n${testes.length - falhas}/${testes.length} testes das funcionalidades avançadas passaram\n`); process.exit(falhas ? 1 : 0);
})();
