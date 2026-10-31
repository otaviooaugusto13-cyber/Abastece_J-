// Bateria do backend: regras financeiras, idade 16+, treinamento obrigatório, RBAC, IDOR, ledger, estornos, saques, conciliação.
const crypto = require("node:crypto");
process.env.AMBIENTE = "teste"; process.env.MODO_TESTE = "1"; process.env.APP_URL = "https://app.exemplo.com";
process.env.MP_ACCESS_TOKEN = "APP_USR-teste"; process.env.MP_WEBHOOK_SECRET = "segredo-webhook"; process.env.CRON_SECRET = "cron-secreto";
process.env.DATA_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString("base64")}`; process.env.DATA_ENCRYPTION_KEY_ID = "1"; process.env.BLIND_INDEX_KEY = crypto.randomBytes(32).toString("base64");
const assert = require("node:assert/strict");
const E = require("./fake-env.cjs");
const { app, ctx, chamar, Seg } = E.carregarServidor();
const { V, S, C } = ctx;
const DIA = 86_400_000;
const dia = (n) => { const d = new Date(V.hojeSP() + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nasc = (anos, extraDias = 0) => dia(-(anos * 365 + Math.floor(anos / 4)) - extraDias);
const CPFS = ["52998224725", "11144477735", "39053344705", "86288366757", "01234567890"].filter(ctx.V.cpfValido);
const cpf = (i) => CPFS[i];

// usuários
const U = {
  lojaA: { uid: "lojaA", email: "a@x.com", email_verified: true }, lojaB: { uid: "lojaB", email: "b@x.com", email_verified: true },
  novo: { uid: "novo1", email: "n@x.com", email_verified: true, name: "Fulano de Tal" }, novo2: { uid: "novo2", email: "n2@x.com", email_verified: true, name: "Ciclano" },
  prom1: { uid: "prom1", email: "p@x.com", email_verified: true }, prom2: { uid: "prom2", email: "p2@x.com", email_verified: true },
  adm: { uid: "adm1", email: "adm@x.com", email_verified: true }, nv: { uid: "nv", email: "nv@x.com", email_verified: false }
};
function reset() {
  E.limpar(); Object.assign(E.tokens, U);
  E.claimsStore.lojaA = { role: "loja" }; E.claimsStore.lojaB = { role: "loja" }; E.claimsStore.prom1 = { role: "promotor", treinado: false };
  E.claimsStore.prom2 = { role: "promotor", treinado: false }; E.claimsStore.adm1 = { role: "admin" }; E.claimsStore.nv = { role: "loja" };
  E.clock.now = Date.now(); ctx.__reset?.(); ctx.taxas.invalidar();
}
const set = (col, id, d) => ctx.db.collection(col).doc(id).set(d);
const get = async (col, id) => (await ctx.db.collection(col).doc(id).get()).data();
const ok = (r, msg = "") => assert.equal(r.status, 200, `${msg} esperado 200, veio ${r.status} ${JSON.stringify(r.json)}`);
const falha = (r, status, codigo) => { assert.equal(r.status, status, `esperado ${status}/${codigo}, veio ${r.status} ${JSON.stringify(r.json)}`); if (codigo) assert.equal(r.json.codigo, codigo); };
const Cripto = ctx.Cripto;
const enc = (uid, campo, v) => Cripto.cifrar(v, `profissionais_privado/${campo}/${uid}`);

async function semear({ uid = "prom1", nascimento = "1995-05-20", status = "ativo", responsavel = false, cpfn = 0, treinado = false, habilitado = true } = {}) {
  await set("profissionais", uid, { uid, nome: "Profissional " + uid, status, treinamentoOk: false, ...(habilitado ? { habilitacoes: { mercearia: { em: new E.Timestamp(Date.now()), tentativas: 1, elite: true } } } : {}) });
  await set("profissionais_privado", uid, { uid, cpfEnc: enc(uid, "cpf", cpf(cpfn)), cpfIdx: Cripto.indiceCego(cpf(cpfn)), nascimentoEnc: enc(uid, "nascimento", nascimento), pixEnc: enc(uid, "pix", { tipo: "CPF", chave: cpf(cpfn) }), pixTipo: "CPF",
    ...(responsavel ? { responsavelEnc: enc(uid, "responsavel", { nome: "Maria Responsável", cpf: cpf(1), telefone: "19999990000", parentesco: "Mãe" }), autorizacaoResponsavelEm: new E.Timestamp(Date.now()) } : {}) });
  if (treinado) await concluirTreino(uid);
}
async function modulo(id = "m1", ordem = 1, dur = 100) { await set("treinamento_modulos", id, { ordem, titulo: "Módulo " + id, provedor: "youtube", videoRef: "abcdefghijk", duracaoSeg: dur, ativo: true }); }
async function concluirTreino(uid) { await modulo(); await set("treinamento_progresso", `${uid}_m1`, { uid, moduloId: "m1", validoSeg: 100, concluido: true }); }
const LOJA_LAT = -22.4358, LOJA_LNG = -46.8216;
async function lojaComCartao(uid = "lojaA") { await set("contratantes", uid, { uid, razaoSocial: "Mercado " + uid, localizacao: { lat: LOJA_LAT, lng: LOJA_LNG, cidade: "Itapira", uf: "SP" } }); await set("cartoes", uid, { uid, status: "ativo", ultimos4: "1234" }); }
async function pedido(over = {}) {
  await lojaComCartao();
  const r = await chamar("POST", "/criarPedido", { token: "lojaA", body: { loja: "Mercado A — Rua 1", data: dia(2), entrada: "08:00", saida: "12:00", foco: "Mercearia", ...over } });
  ok(r, "criarPedido"); return r.json.id;
}
/** marca o serviço como executado (check-in/out) sem passar pela API: usado nos testes financeiros, que não são sobre geofence */
async function executar(sid) { await ctx.db.collection("solicitacoes").doc(sid).update({ fase: "executada", checkin: { em: new E.Timestamp(Date.now()), noRaio: true }, checkout: { em: new E.Timestamp(Date.now()), gondola: "cheia" } }); }
const mpMock = (map) => { global.fetch = async (url, init = {}) => { const k = `${init.method || "GET"} ${String(url).replace("https://api.mercadopago.com", "")}`; const h = map[k] ?? Object.entries(map).find(([p]) => k.startsWith(p))?.[1]; if (!h) return { ok: false, status: 404, json: async () => ({}) }; const v = typeof h === "function" ? h(init) : h; return { ok: true, status: 200, json: async () => v }; }; };
const pgMP = (sid, over = {}) => ({ id: 777, status: "approved", external_reference: sid, currency_id: "BRL", transaction_amount: 200, payment_type_id: "credit_card", fee_details: [{ type: "mercadopago_fee", amount: 7.9 }], ...over });
async function pagar(sid, over = {}) { await executar(sid); mpMock({ "GET /v1/payments/777": pgMP(sid, over) }); return chamar("POST", "/confirmarPagamento", { token: "lojaA", body: { solicitacaoId: sid, paymentId: "777" } }); }
/** pedido aceito e pago: profissional aprovado, treinado, adulto */
async function cenarioPago() {
  await semear({ treinado: true }); const sid = await pedido();
  ok(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: sid } })); ok(await pagar(sid)); return sid;
}

const testes = [];
const t = (nome, fn) => testes.push([nome, fn]);

// =================== 1. MODELO FINANCEIRO ===================
t("diária: R$200 = R$150 profissional + R$50 plataforma; nada some nem sobra", async () => {
  const d = S.calcularDiaria();
  assert.deepEqual([d.total, d.promotor, d.comissao, d.app], [20000, 15000, 5000, 5000]); assert.equal(d.promotor + d.app, d.total);
  assert.equal(S.PCT_REPASSE, 75, "150/200 é 75% (o enunciado fala em 80%: ver documentação)");
  for (const [e, s] of [["08:00", "12:00"], ["08:00", "14:00"]]) assert.equal(S.validarTurno(e, s), "");
  assert.match(S.validarTurno("08:00", "11:59"), /mínimo/); assert.match(S.validarTurno("08:00", "14:01"), /máximo/);
});
t("o cliente não consegue definir o preço do pedido", async () => {
  await lojaComCartao();
  const r = await chamar("POST", "/criarPedido", { token: "lojaA", body: { loja: "Mercado A — Rua 1", data: dia(2), entrada: "08:00", saida: "12:00", foco: "Mercearia", valor: 1, valorCentavos: 1, total: 1 } });
  ok(r); assert.equal(r.json.total, 20000); const p = await get("solicitacoes", r.json.id); assert.equal(p.valorPromotorCentavos, 15000);
});
t("pagamento aprovado credita R$150 (carência) + R$50 plataforma, de forma idempotente", async () => {
  const sid = await cenarioPago();
  assert.deepEqual(await get("carteiras", "prom1").then((c) => [c.pendenteCentavos, c.disponivelCentavos]), [15000, 0]);
  assert.equal((await get("carteiras", "PLATAFORMA")).disponivelCentavos, 5000);
  ok(await pagar(sid)); ok(await pagar(sid));                                            // repetição (webhook + retorno)
  assert.equal((await get("carteiras", "prom1")).pendenteCentavos, 15000, "crédito duplicado!");
  const n = await get("notas", (await get("solicitacoes", sid)).notaId); assert.match(n.prestador.documento, /^\*\*\*\./, "CPF na nota deve estar mascarado");
});
t("valor/moeda/referência divergentes do Mercado Pago são recusados", async () => {
  await semear({ treinado: true }); const sid = await pedido(); ok(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: sid } }));
  falha(await pagar(sid, { transaction_amount: 199.99 }), 400, "valor-divergente");
  falha(await pagar(sid, { external_reference: "outro" }), 400, "pagamento-invalido");
  assert.equal((await get("solicitacoes", sid)).status, "aceita");
});
t("carência: saldo pendente → disponível só depois de LIBERACAO_DIAS; saque com todas as travas", async () => {
  await cenarioPago();
  let r = await chamar("GET", "/carteira", { token: "prom1" }); assert.deepEqual([r.json.pendenteCentavos, r.json.disponivelCentavos], [15000, 0]);
  falha(await chamar("POST", "/carteira/saque", { token: "prom1", body: { valorCentavos: 5000 } }), 409, "saldo-insuficiente");
  E.avancar((C.LIBERACAO_DIAS + 1) * DIA);
  r = await chamar("GET", "/carteira", { token: "prom1" }); assert.deepEqual([r.json.pendenteCentavos, r.json.disponivelCentavos], [0, 15000]);
  falha(await chamar("POST", "/carteira/saque", { token: "prom1", body: { valorCentavos: 100 } }), 400, "saque-minimo");
  falha(await chamar("POST", "/carteira/saque", { token: "prom1", body: { valorCentavos: 16000 } }), 409, "saldo-insuficiente");
  E.tokens.prom1.auth_time = Math.floor(E.clock.now / 1000) - 3600;                      // login antigo
  falha(await chamar("POST", "/carteira/saque", { token: "prom1", body: { valorCentavos: 5000 } }), 401, "reautenticar");
  E.tokens.prom1.auth_time = undefined;
  const s = await chamar("POST", "/carteira/saque", { token: "prom1", body: { valorCentavos: 5000 } }); ok(s);
  assert.equal((await get("carteiras", "prom1")).disponivelCentavos, 10000);
  // admin paga um, rejeita outro (devolve)
  ok(await chamar("POST", `/admin/saques/${s.json.id}/rejeitar`, { token: "adm", body: { motivo: "teste" } }));
  assert.equal((await get("carteiras", "prom1")).disponivelCentavos, 15000);
  falha(await chamar("POST", `/admin/saques/${s.json.id}/pagar`, { token: "adm", body: { comprovante: "E2E123" } }), 409, "saque-resolvido");
  const s2 = await chamar("POST", "/carteira/saque", { token: "prom1", body: { valorCentavos: 15000 } }); ok(s2);
  ok(await chamar("POST", `/admin/saques/${s2.json.id}/pagar`, { token: "adm", body: { comprovante: "E2E456" } }));
  const c = await chamar("GET", "/admin/conciliacao", { token: "adm" }); assert.equal(c.json.ok, true, JSON.stringify(c.json.divergencias));
});
t("Pix recém-alterado trava saques por 24h", async () => {
  await cenarioPago(); E.avancar(3 * DIA);
  ok(await chamar("PUT", "/perfil/promotor/pix", { token: "prom1", body: { tipo: "E-mail", chave: "novo@pix.com" } }));
  falha(await chamar("POST", "/carteira/saque", { token: "prom1", body: { valorCentavos: 5000 } }), 403, "pix-recente");
  const p = await get("profissionais_privado", "prom1"); assert.ok(!JSON.stringify(p).includes("novo@pix.com"), "Pix em texto puro!");
});
t("estorno antes da liberação desfaz R$150 e R$50 e a conciliação fecha", async () => {
  const sid = await cenarioPago();
  mpMock({ "POST /v1/payments/777/refunds": { id: 5 }, "GET /v1/payments/777": pgMP(sid) });
  falha(await chamar("POST", `/admin/pedidos/${sid}/estornar`, { token: "prom1", body: { motivo: "x ok ok" } }), 403, "sem-permissao");
  ok(await chamar("POST", `/admin/pedidos/${sid}/estornar`, { token: "adm", body: { motivo: "Serviço não prestado" } }));
  assert.deepEqual(await get("carteiras", "prom1").then((c) => [c.pendenteCentavos, c.disponivelCentavos]), [0, 0]);
  assert.equal((await get("carteiras", "PLATAFORMA")).disponivelCentavos, 0);
  assert.equal((await get("solicitacoes", sid)).status, "estornada"); assert.equal((await get("notas", (await get("solicitacoes", sid)).notaId)).status, "cancelada");
  const r2 = await chamar("POST", `/admin/pedidos/${sid}/estornar`, { token: "adm", body: { motivo: "repetido ok" } }); assert.equal(r2.json.jaEstornado, true);
  const c = await chamar("GET", "/admin/conciliacao", { token: "adm" }); assert.equal(c.json.ok, true, JSON.stringify(c.json.divergencias)); assert.equal(c.json.totais.diferencaCentavos, 0);
});
t("estorno depois do saque deixa a carteira negativa (sinalizada) e continua conciliado", async () => {
  const sid = await cenarioPago(); E.avancar(3 * DIA);
  ok(await chamar("GET", "/carteira", { token: "prom1" })); ok(await chamar("POST", "/carteira/saque", { token: "prom1", body: { valorCentavos: 15000 } }));
  mpMock({ "POST /v1/payments/777/refunds": { id: 5 } });
  const r = await chamar("POST", `/admin/pedidos/${sid}/estornar`, { token: "adm", body: { motivo: "Chargeback antecipado" } }); ok(r); assert.equal(r.json.saldoNegativo, true);
  assert.equal((await get("carteiras", "prom1")).disponivelCentavos, -15000);
  const c = await chamar("GET", "/admin/conciliacao", { token: "adm" }); assert.equal(c.json.ok, true); assert.ok(c.json.divergencias.some((d) => d.tipo === "saldo_negativo" && d.informativo));
});
t("webhook: assinatura inválida 401; válida processa; reembolso estorna", async () => {
  await semear({ treinado: true }); const sid = await pedido(); ok(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: sid } })); await executar(sid);
  mpMock({ "GET /v1/payments/777": pgMP(sid), "POST /v1/payments/777/refunds": { id: 9 } });
  const assinar = (id, reqId, ts) => `ts=${ts},v1=${crypto.createHmac("sha256", "segredo-webhook").update(`id:${id};request-id:${reqId};ts:${ts};`).digest("hex")}`;
  const hook = (h) => chamar("POST", "/webhookMP?data.id=777&type=payment", { headers: h, body: {} });
  falha(await hook({ "x-request-id": "r1", "x-signature": "ts=1,v1=00" }), 401, "assinatura-invalida");
  falha(await hook({}), 401, "assinatura-invalida");
  ok(await hook({ "x-request-id": "r1", "x-signature": assinar("777", "r1", "123") })); ok(await hook({ "x-request-id": "r1", "x-signature": assinar("777", "r1", "123") }));
  assert.equal((await get("solicitacoes", sid)).status, "paga"); assert.equal((await get("carteiras", "prom1")).pendenteCentavos, 15000);
  mpMock({ "GET /v1/payments/777": pgMP(sid, { status: "refunded" }) });
  ok(await hook({ "x-request-id": "r2", "x-signature": assinar("777", "r2", "124") }));
  assert.equal((await get("pagamentos_internos", sid)).status, "estornado"); assert.equal((await get("carteiras", "prom1")).pendenteCentavos, 0);
});
t("conciliação detecta saldo adulterado", async () => {
  await cenarioPago(); await ctx.db.collection("carteiras").doc("prom1").set({ pendenteCentavos: 99999 }, { merge: true });
  const c = await chamar("GET", "/admin/conciliacao", { token: "adm" }); assert.equal(c.json.ok, false); assert.ok(c.json.divergencias.some((d) => d.tipo === "saldo_carteira" && d.ref === "prom1"));
});
t("CSV: injeção de fórmula neutralizada, valores negativos preservados, escopo por papel", async () => {
  await cenarioPago(); await set("solicitacoes", "x", { uid: "lojaA", status: "paga", loja: "=HYPERLINK(\"http://x\")", data: dia(1), foco: "Mercearia", promotorNome: "@evil" });
  const r = await chamar("GET", "/loja/exportar.csv", { token: "lojaA" }); ok(r); assert.ok(r.texto.includes("'=HYPERLINK") && r.texto.includes("'@evil")); assert.equal(r.h["Content-Type"], "text/csv; charset=utf-8");
  falha(await chamar("GET", "/loja/exportar.csv", { token: "prom1" }), 403, "sem-permissao");
  const a = await chamar("GET", "/admin/exportar/lancamentos.csv", { token: "adm" }); ok(a); assert.ok(a.texto.includes("150,00") && a.texto.includes("50,00"));
  falha(await chamar("GET", "/admin/exportar/lancamentos.csv", { token: "lojaA" }), 403, "sem-permissao");
});

// =================== 2. IDADE 16+ ===================
t("cadastro: 15 anos recusado; 16 exatos aceitos (com responsável); fronteiras", async () => {
  const body = (n, extra = {}) => ({ termos: true, nascimento: n, cpf: cpf(0), ...extra });
  const hoje = V.hojeSP(), [a, m, d] = hoje.split("-").map(Number), ant = (anos, dd = 0) => { const x = new Date(Date.UTC(a - anos, m - 1, d - dd)); return x.toISOString().slice(0, 10); };
  falha(await chamar("POST", "/cadastro/promotor", { token: "novo", body: body(ant(15, 0)) }), 403, "idade-minima");
  falha(await chamar("POST", "/cadastro/promotor", { token: "novo", body: body(ant(16, -1)) }), 403, "idade-minima");   // faz 16 amanhã
  falha(await chamar("POST", "/cadastro/promotor", { token: "novo", body: body(dia(1)) }), 400, "nascimento-invalido");
  falha(await chamar("POST", "/cadastro/promotor", { token: "novo", body: body("2010-02-31") }), 400, "nascimento-invalido");
  falha(await chamar("POST", "/cadastro/promotor", { token: "novo", body: body("1850-01-01") }), 400, "nascimento-invalido");
  falha(await chamar("POST", "/cadastro/promotor", { token: "novo", body: body("2000-01-01", { nascimento: { $gt: "" } }) }), 400, "nascimento-invalido");  // objeto no lugar de string
  falha(await chamar("POST", "/cadastro/promotor", { token: "novo", body: body(ant(16, 0)) }), 400, "responsavel-obrigatorio");        // 16 exatos, sem responsável
  const resp = { nome: "Maria da Silva", cpf: cpf(1), telefone: "(19) 99999-0000", parentesco: "Mãe" };
  falha(await chamar("POST", "/cadastro/promotor", { token: "novo", body: body(ant(16, 0), { autorizacaoResponsavel: true, responsavel: { ...resp, cpf: cpf(0) } }) }), 400, "responsavel-invalido");
  const r = await chamar("POST", "/cadastro/promotor", { token: "novo", body: body(ant(16, 0), { autorizacaoResponsavel: true, responsavel: resp, telefone: "19988887777" }) });
  ok(r); assert.deepEqual([r.json.idade, r.json.menor, r.json.status], [16, true, "pendente"]);
  assert.equal(E.claimsStore.novo1.role, "promotor");
  const raw = JSON.stringify(await get("profissionais_privado", "novo1")); for (const seg of [cpf(0), "19988887777", "Maria da Silva", ant(16, 0)]) assert.ok(!raw.includes(seg), `dado sensível em texto puro: ${seg}`);
  assert.ok(!JSON.stringify(await get("profissionais", "novo1")).includes("n@x.com"), "e-mail não deve ficar no perfil público");
});
t("cadastro: adulto 18+ dispensa responsável; CPF inválido/duplicado; papéis exclusivos", async () => {
  falha(await chamar("POST", "/cadastro/promotor", { token: "novo", body: { termos: true, nascimento: "1990-03-04", cpf: "111.111.111-11" } }), 400, "cpf-invalido");
  falha(await chamar("POST", "/cadastro/promotor", { token: "novo", body: { nascimento: "1990-03-04", cpf: cpf(0) } }), 400, "termos-obrigatorios");
  const r = await chamar("POST", "/cadastro/promotor", { token: "novo", body: { termos: true, nascimento: "1990-03-04", cpf: cpf(0) } }); ok(r); assert.equal(r.json.menor, false);
  falha(await chamar("POST", "/cadastro/promotor", { token: "novo2", body: { termos: true, nascimento: "1991-03-04", cpf: cpf(0) } }), 409, "cpf-duplicado");
  falha(await chamar("POST", "/cadastro/promotor", { token: "lojaA", body: { termos: true, nascimento: "1990-03-04", cpf: cpf(2) } }), 409, "papel-conflito");
  falha(await chamar("POST", "/cadastro/loja", { token: "prom1", body: { termos: true } }), 409, "papel-conflito");
  ok(await chamar("POST", "/cadastro/loja", { token: "novo2", body: { termos: true } })); assert.equal(E.claimsStore.novo2.role, "loja");
});
t("data de nascimento e CPF ficam travados (não dá para 'rejuvenescer' a conta)", async () => {
  await semear({ nascimento: "1995-05-20" });
  falha(await chamar("PUT", "/perfil/promotor/privado", { token: "prom1", body: { nascimento: "2009-01-01" } }), 409, "dado-travado");
  falha(await chamar("PUT", "/perfil/promotor/privado", { token: "prom1", body: { cpf: cpf(3) } }), 409, "dado-travado");
  ok(await chamar("PUT", "/perfil/promotor/privado", { token: "prom1", body: { telefone: "(19) 91234-5678", status: "ativo", treinamentoOk: true } }));
  assert.equal((await get("profissionais", "prom1")).treinamentoOk, false);
  const p = await chamar("GET", "/perfil/privado", { token: "prom1" }); assert.match(p.json.cpfMascarado, /^\*\*\*\./); assert.equal(p.json.idade >= 30, true);
});
t("conta antiga sem nascimento é bloqueada até informar; 15 anos nunca habilita", async () => {
  await set("profissionais", "prom1", { uid: "prom1", nome: "Antigo", status: "ativo" }); await set("profissionais_privado", "prom1", { uid: "prom1" }); await concluirTreino("prom1");
  const sid = await pedido(); falha(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: sid } }), 403, "idade-nao-verificada");
  const sit = await chamar("GET", "/habilitacao", { token: "prom1" }); assert.ok(sit.json.pendencias.includes("nascimento")); assert.equal(sit.json.habilitado, false);
});
t("16–17 anos: exige responsável, janela diurna e setor permitido; ao fazer 18 as restrições caem", async () => {
  const hoje = V.hojeSP(), [a, m, d] = hoje.split("-").map(Number), ant = (anos) => new Date(Date.UTC(a - anos, m - 1, d - 1)).toISOString().slice(0, 10);
  await semear({ nascimento: ant(17), treinado: true });                                   // 17 anos
  let sid = await pedido(); falha(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: sid } }), 403, "responsavel-pendente");
  await semear({ nascimento: ant(17), treinado: true, responsavel: true });
  falha(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: await pedido({ entrada: "04:00", saida: "08:00" }) } }), 403, "menor-horario");
  falha(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: await pedido({ entrada: "18:00", saida: "22:30" }) } }), 403, "menor-horario");
  falha(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: await pedido({ foco: "Bebidas" }) } }), 403, "menor-setor");
  ok(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: sid } }));
  await semear({ uid: "prom2", nascimento: ant(18), treinado: true, cpfn: 2 });          // 18 anos: sem restrição
  ok(await chamar("POST", "/aceitarTurno", { token: "prom2", body: { solicitacaoId: await pedido({ entrada: "04:00", saida: "08:00", foco: "Bebidas" }) } }));
});

// =================== 3. TREINAMENTO PRATICAMENTE ===================
t("sem treinamento concluído não aceita turno (inclusive com catálogo vazio: falha fechada)", async () => {
  await semear(); const sid = await pedido();
  falha(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: sid } }), 403, "treinamento-pendente");   // nenhum módulo cadastrado
  await modulo();
  falha(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: sid } }), 403, "treinamento-pendente");
  assert.equal((await get("solicitacoes", sid)).status, "aberta");
});
t("progresso é validado no servidor: pular, acelerar e declarar conclusão não funcionam", async () => {
  await semear(); await modulo("m1", 1, 100); await modulo("m2", 2, 60);
  const ping = (b) => chamar("POST", "/treinamento/ping", { token: "prom1", body: b });
  falha(await ping({ moduloId: "m2", posicaoSeg: 0, tocando: true }), 403, "modulo-bloqueado");                      // ordem obrigatória
  ok(await ping({ moduloId: "m1", posicaoSeg: 0, tocando: true }));
  E.avancar(10_000); let r = await ping({ moduloId: "m1", posicaoSeg: 95, tocando: true }); ok(r); assert.equal(r.json.validoSeg, 0, "pulo para o fim não pode creditar");
  E.avancar(1000); falha(await ping({ moduloId: "m1", posicaoSeg: 0, tocando: true }), 429, "ping-rapido");
  E.avancar(10_000); r = await ping({ moduloId: "m1", posicaoSeg: 1, tocando: true }); assert.equal(r.json.validoSeg, 1);   // reinício correto só credita contíguo
  for (let i = 0; i < 8; i++) { E.avancar(10_000); r = await ping({ moduloId: "m1", posicaoSeg: Math.min(99, r.json.validoSeg + 10), tocando: true }); ok(r); }
  assert.equal(r.json.concluido, false, "80 s de reprodução não bastam para 90% de 100 s (limiar 90)");
  E.avancar(10_000); r = await ping({ moduloId: "m1", posicaoSeg: r.json.validoSeg + 10, tocando: true }); assert.equal(r.json.concluido, true); assert.equal(r.json.treinamentoCompleto, false);
  assert.equal((await get("profissionais", "prom1")).treinamentoOk, false, "m2 ainda pendente");
  ok(await ping({ moduloId: "m2", posicaoSeg: 0, tocando: true }));
  let pos = 0; for (let i = 0; i < 7; i++) { E.avancar(10_000); pos += 10; r = await ping({ moduloId: "m2", posicaoSeg: pos, tocando: true }); }
  assert.equal(r.json.concluido, true); assert.equal(r.json.treinamentoCompleto, true);
  assert.equal((await get("profissionais", "prom1")).treinamentoOk, true); assert.equal(E.claimsStore.prom1.treinado, true);
});
t("pausado não credita; completar libera o aceite; novo módulo obrigatório re-bloqueia", async () => {
  await semear(); await modulo("m1", 1, 30);
  const ping = (b) => chamar("POST", "/treinamento/ping", { token: "prom1", body: b });
  ok(await ping({ moduloId: "m1", posicaoSeg: 0, tocando: true })); E.avancar(10_000); let r = await ping({ moduloId: "m1", posicaoSeg: 10, tocando: false }); assert.equal(r.json.validoSeg, 0);
  let pos = 0; E.avancar(5000); await ping({ moduloId: "m1", posicaoSeg: 0, tocando: true }); for (let i = 0; i < 3; i++) { E.avancar(10_000); pos += 10; r = await ping({ moduloId: "m1", posicaoSeg: pos, tocando: true }); }
  assert.equal(r.json.treinamentoCompleto, true);
  const sid = await pedido(); ok(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: sid } }));
  await modulo("m3", 3, 60);
  falha(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: await pedido({ data: dia(5) }) } }), 403, "treinamento-pendente");
  const st = await chamar("GET", "/treinamento", { token: "prom1" }); assert.equal(st.json.completo, false); assert.equal(E.claimsStore.prom1.treinado, false);
});
t("admin cadastra módulos com validação; profissional não", async () => {
  const b = { ordem: 1, titulo: "Boas-vindas PRATICAMENTE", provedor: "youtube", videoRef: "abcdefghijk", duracaoSeg: 300 };
  falha(await chamar("POST", "/admin/treinamento/modulos", { token: "prom1", body: b }), 403, "sem-permissao");
  falha(await chamar("POST", "/admin/treinamento/modulos", { token: "adm", body: { ...b, videoRef: "http://x" } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/admin/treinamento/modulos", { token: "adm", body: { ...b, provedor: "mp4", videoRef: "http://inseguro/v.mp4" } }), 400, "dados-invalidos");
  ok(await chamar("POST", "/admin/treinamento/modulos", { token: "adm", body: b }));
});
t("aprovar cadastro exige dados legais completos; bloquear derruba sessões", async () => {
  await set("profissionais", "prom1", { uid: "prom1", nome: "A", status: "pendente" }); await set("profissionais_privado", "prom1", { uid: "prom1" });
  falha(await chamar("POST", "/admin/promotores/prom1/status", { token: "adm", body: { status: "ativo" } }), 409, "cadastro-incompleto");
  await semear({ status: "pendente" }); ok(await chamar("POST", "/admin/promotores/prom1/status", { token: "adm", body: { status: "ativo" } }));
  ok(await chamar("POST", "/admin/promotores/prom1/status", { token: "adm", body: { status: "bloqueado", motivo: "fraude" } }));
  falha(await chamar("GET", "/habilitacao", { token: "prom1" }), 401, "sessao-invalida");
});

// =================== 4. SEGURANÇA ===================
t("RBAC: cada papel só alcança suas rotas; sem token/e-mail não verificado → 401", async () => {
  falha(await chamar("POST", "/criarPedido", { body: {} }), 401, "nao-autenticado");
  falha(await chamar("POST", "/criarPedido", { token: "prom1", body: {} }), 403, "sem-permissao");
  falha(await chamar("POST", "/aceitarTurno", { token: "lojaA", body: {} }), 403, "sem-permissao");
  falha(await chamar("GET", "/admin/promotores", { token: "lojaA" }), 403, "sem-permissao"); falha(await chamar("GET", "/admin/conciliacao", { token: "prom1" }), 403, "sem-permissao");
  falha(await chamar("GET", "/carteira", { token: "lojaA" }), 403, "sem-permissao");
  falha(await chamar("GET", "/loja/exportar.csv", { token: "nv" }), 401, "sessao-invalida");
  assert.equal((await chamar("POST", "/criarPedido", { headers: { authorization: "Bearer lixo" }, body: {} })).status, 401);
  ok(await chamar("GET", "/admin/promotores", { token: "adm" }));
});
t("MFA de administrador quando ADMIN_EXIGE_MFA=1", async () => {
  C.ADMIN_EXIGE_MFA = true; try { falha(await chamar("GET", "/admin/promotores", { token: "adm" }), 403, "mfa-obrigatorio"); E.tokens.adm1 = undefined; E.tokens.adm = { ...U.adm, firebase: { sign_in_second_factor: "totp" } }; ok(await chamar("GET", "/admin/promotores", { token: "adm" })); } finally { C.ADMIN_EXIGE_MFA = false; E.tokens.adm = U.adm; }
});
t("IDOR: loja B e promotor B não tocam em pedidos alheios (resposta 404, sem confirmar existência)", async () => {
  await semear({ treinado: true }); const sid = await pedido(); ok(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: sid } }));
  await lojaComCartao("lojaB");
  for (const [rota, tk] of [["/cancelarPedido", "lojaB"], ["/criarCobranca", "lojaB"], ["/avaliarServico", "lojaB"], ["/desistirTurno", "prom2"]]) {
    const r = await chamar("POST", rota, { token: tk, body: { solicitacaoId: sid, estrelas: 5 } }); falha(r, 404, "nao-encontrado"); }
  falha(await chamar("POST", "/confirmarPagamento", { token: "lojaB", body: { solicitacaoId: sid, paymentId: "777" } }), 404, "nao-encontrado");
  assert.equal((await get("solicitacoes", sid)).status, "aceita");
  falha(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: { $ne: null } } }), 400, "dados-invalidos");       // injeção NoSQL
});
t("validação de entrada: tipos, datas, setor, mass assignment", async () => {
  await lojaComCartao();
  const base = { loja: "Mercado A — Rua 1", data: dia(2), entrada: "08:00", saida: "12:00", foco: "Mercearia" };
  for (const ruim of [{ foco: "Drop table" }, { data: "2020-01-01" }, { data: dia(200) }, { loja: { $gt: "" } }, { loja: "x" }, { entrada: "25:00" }, { saida: "13:00:00" }, { promotorPreferido: "../x" }])
    assert.ok([400].includes((await chamar("POST", "/criarPedido", { token: "lojaA", body: { ...base, ...ruim } })).status), JSON.stringify(ruim));
  const r = await chamar("POST", "/criarPedido", { token: "lojaA", body: { ...base, status: "paga", uid: "outro", promotorUid: "x" } }); ok(r);
  const p = await get("solicitacoes", r.json.id); assert.deepEqual([p.status, p.uid, p.promotorUid], ["aberta", "lojaA", undefined]);
});
t("regras de aceite: aprovação, limite semanal, conflito de horário, janela de exclusividade", async () => {
  await semear({ status: "pendente", treinado: true }); const s1 = await pedido();
  falha(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: s1 } }), 403, "promotor-inativo");
  await semear({ treinado: true });
  ok(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: s1 } }));
  falha(await chamar("POST", "/aceitarTurno", { token: "prom2", body: { solicitacaoId: s1 } }), 403, "promotor-inativo");
  const s2 = await pedido({ entrada: "10:00", saida: "14:00" }); falha(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: s2 } }), 409, "conflito-horario");
  const s3 = await pedido({ entrada: "13:00", saida: "17:00" }); ok(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: s3 } }));
  const s4 = await pedido({ entrada: "18:00", saida: "22:00" }); ok(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: s4 } }));
  const s5 = await pedido({ entrada: "05:00", saida: "09:00" }); falha(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: s5 } }), 409, "limite-semanal");
  await semear({ uid: "prom2", cpfn: 2, treinado: true }); await lojaComCartao();
  const ex = await chamar("POST", "/criarPedido", { token: "lojaA", body: { loja: "Mercado A — Rua 1", data: dia(9), entrada: "08:00", saida: "12:00", foco: "Mercearia", promotorPreferido: "prom1" } }); ok(ex);
  falha(await chamar("POST", "/aceitarTurno", { token: "prom2", body: { solicitacaoId: ex.json.id } }), 403, "exclusivo");
  E.avancar(6 * 60_000); ok(await chamar("POST", "/aceitarTurno", { token: "prom2", body: { solicitacaoId: ex.json.id } }));
});
t("avaliação: uma vez por serviço pago, só pela loja dona, média do profissional atualizada", async () => {
  const sid = await cenarioPago();
  falha(await chamar("POST", "/avaliarServico", { token: "lojaA", body: { solicitacaoId: sid, estrelas: 6 } }), 400, "dados-invalidos");
  ok(await chamar("POST", "/avaliarServico", { token: "lojaA", body: { solicitacaoId: sid, estrelas: 4, comentario: "ok" } }));
  falha(await chamar("POST", "/avaliarServico", { token: "lojaA", body: { solicitacaoId: sid, estrelas: 5 } }), 409, "ja-avaliado");
  assert.equal((await get("profissionais", "prom1")).ratingMedia, 4);
});
t("cron de liberação exige segredo; rate limit devolve 429", async () => {
  falha(await chamar("POST", "/interno/liberar", { headers: { "x-cron-secret": "errado" } }), 401);
  ok(await chamar("POST", "/interno/liberar", { headers: { "x-cron-secret": "cron-secreto" } }));
  let ultimo; for (let i = 0; i < 14; i++) ultimo = await chamar("POST", "/cadastro/loja", { token: "novo2", body: {}, ip: "7.7.7.7" }); falha(ultimo, 429, "limite-requisicoes");
});
t("middlewares: CSRF/Origin, Content-Type, CORS fechado e cabeçalhos (CSP sem unsafe-inline em scripts)", async () => {
  const origens = Seg.origensPermitidas("https://app.exemplo.com"), csrf = Seg.protecaoCsrf(origens, { isentas: ["/webhookMP"] });
  const rodar = (req) => new Promise((r) => csrf({ method: "POST", path: "/criarPedido", ...req, get: (n) => (req.h || {})[n.toLowerCase()] }, {}, (e) => r(e?.codigo || "ok")));
  assert.equal(await rodar({ h: { origin: "https://evil.com", "content-type": "application/json", "content-length": "2", host: "api" } }), "origem-invalida");
  assert.equal(await rodar({ h: { origin: "https://app.exemplo.com", "content-type": "text/plain", "content-length": "5" } }), "tipo-invalido");
  assert.equal(await rodar({ h: { origin: "https://app.exemplo.com", "content-type": "application/json", "content-length": "5" } }), "ok");
  const c = Seg.opcoesCors(origens); await new Promise((r) => c.origin("https://evil.com", (_, v) => (assert.equal(v, false), r())));
  const hs = {}; Seg.cabecalhos()({}, { setHeader: (k, v) => (hs[k] = v), removeHeader() {} }, () => {});
  const script = hs["Content-Security-Policy"].split(";").find((s) => s.trim().startsWith("script-src")); assert.ok(!script.includes("unsafe-inline") && !script.includes("unsafe-eval"));
  assert.ok(hs["Strict-Transport-Security"] && hs["X-Frame-Options"] === "DENY" && hs["X-Content-Type-Options"] === "nosniff");
});
t("sandbox: contas de teste não existem fora de MODO_TESTE e não acessam rotas de outro papel", async () => {
  const r = await chamar("POST", "/teste/login", { body: { perfil: "promotor" } }); ok(r); assert.equal((await get("profissionais", "teste-promotor")).status, "ativo");
  falha(await chamar("POST", "/teste/pagar", { token: "lojaA", body: { solicitacaoId: "x" } }), 403, "so-teste");
});
t("regras do Firestore: deny-by-default, sem escrita aberta, campos sensíveis protegidos", async () => {
  const fs = require("node:fs"), rules = fs.readFileSync(require("node:path").join(__dirname, "../firestore.rules"), "utf8");
  assert.match(rules, /match \/\{documento=\*\*\} \{ allow read, write: if false; \}/); assert.ok(!/allow [^;]*if true/.test(rules));
  for (const col of ["profissionais_privado", "pagamentos_internos", "carteiras", "lancamentos", "saques", "treinamento_progresso", "habilitacao_categorias", "habilitacao_sessoes", "auditoria"]) assert.ok(new RegExp("match \\/" + col + "\\/\\{\\w+\\}\\s*\\{ allow read, write: if false;").test(rules), col);
  const upd = /match \/profissionais\/\{uid\}[\s\S]*?allow update:[\s\S]*?soMuda\(\[([^\]]*)\]\)/.exec(rules)[1];
  for (const proibido of ["status", "treinamentoOk", "habilitacoes", "role", "ratingMedia", "refCode"]) assert.ok(!upd.includes(`'${proibido}'`), `cliente não pode alterar ${proibido}`);
  assert.match(rules, /treinado\(\) && !banido\(\) && resource\.data\.status == 'aberta'/);
  assert.match(rules, /match \/solicitacoes\/\{id\} \{[\s\S]*?allow write: if false;/);
});

// =================== 8. CURSOS, PERFIL INTELIGENTE E GEOLOCALIZAÇÃO ===================
t("cursos opcionais não bloqueiam nem entram na habilitação; obrigatórios seguem em ordem", async () => {
  await semear();
  await set("treinamento_modulos", "o1", { ordem: 1, titulo: "Obrigatório 1", provedor: "youtube", videoRef: "abcdefghijk", duracaoSeg: 100, ativo: true });
  await set("treinamento_modulos", "c1", { ordem: 2, titulo: "Curso opcional", provedor: "youtube", videoRef: "abcdefghijk", duracaoSeg: 100, ativo: true, obrigatorio: false, categoria: "perdas" });
  await set("treinamento_modulos", "o2", { ordem: 3, titulo: "Obrigatório 2", provedor: "youtube", videoRef: "abcdefghijk", duracaoSeg: 100, ativo: true });
  const r = await chamar("GET", "/treinamento", { token: "prom1" }); ok(r);
  const m = Object.fromEntries(r.json.modulos.map((x) => [x.id, x]));
  assert.equal(m.c1.bloqueado, false, "opcional sempre aberto"); assert.equal(m.c1.categoria, "perdas"); assert.equal(m.c1.obrigatorio, false);
  assert.equal(m.o2.bloqueado, true, "o2 espera o1"); assert.equal(m.o1.categoria, "habilitacao");
  assert.equal(r.json.total, 2, "só obrigatórios contam"); assert.deepEqual(r.json.opcionais, { concluidos: 0, total: 1 });
  await set("treinamento_progresso", "prom1_o1", { uid: "prom1", moduloId: "o1", validoSeg: 100, concluido: true });
  await set("treinamento_progresso", "prom1_o2", { uid: "prom1", moduloId: "o2", validoSeg: 100, concluido: true });
  const f = await chamar("GET", "/treinamento", { token: "prom1" }); assert.equal(f.json.completo, true, "habilitado sem fazer o curso opcional");
});
t("admin cadastra curso opcional por categoria; obrigatório sempre cai em 'habilitacao'; categoria inválida é recusada", async () => {
  const b = { ordem: 5, titulo: "Prevenção de perdas na prática", provedor: "youtube", videoRef: "abcdefghijk", duracaoSeg: 300 };
  const r = await chamar("POST", "/admin/treinamento/modulos", { token: "adm", body: { ...b, obrigatorio: false, categoria: "perdas" } }); ok(r);
  assert.deepEqual([(await get("treinamento_modulos", r.json.id)).obrigatorio, (await get("treinamento_modulos", r.json.id)).categoria], [false, "perdas"]);
  const r2 = await chamar("POST", "/admin/treinamento/modulos", { token: "adm", body: { ...b, categoria: "reposicao" } }); ok(r2);
  assert.equal((await get("treinamento_modulos", r2.json.id)).categoria, "habilitacao");
  falha(await chamar("POST", "/admin/treinamento/modulos", { token: "adm", body: { ...b, obrigatorio: false, categoria: "inventada" } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/admin/treinamento/modulos", { token: "prom1", body: b }), 403, "sem-permissao");
});
t("perfil inteligente: promotor salva experiência+Eneagrama; bio/palavras vão ao perfil público, Eneagrama NÃO", async () => {
  await semear();
  const corpo = { experiencias: [{ area: "Mercearia", anos: 3 }, { area: "Prevenção de perdas", anos: 2, detalhe: "quebras e validade" }], eneagrama: { tipo: 1, asa: 2, instinto: "SP" }, palavrasChave: ["mercearia", "prevenção de perdas", "3+ anos de experiência"], bio: "Profissional de reposição com 3 anos em mercearia.", bioAuto: true };
  ok(await chamar("PUT", "/perfil/promotor/inteligente", { token: "prom1", body: corpo }));
  const pub = await get("profissionais", "prom1");
  assert.equal(pub.bio, corpo.bio); assert.deepEqual(pub.palavrasChave, corpo.palavrasChave); assert.deepEqual(pub.areasExperiencia, ["Mercearia", "Prevenção de perdas"]);
  assert.equal(pub.eneagrama, undefined, "Eneagrama não é público"); assert.equal(pub.status, "ativo");
  const lido = await chamar("GET", "/perfil/promotor/inteligente", { token: "prom1" }); ok(lido); assert.deepEqual(lido.json.eneagrama, { tipo: 1, asa: 2, instinto: "SP" }); assert.equal(lido.json.experiencias.length, 2);
});
t("perfil inteligente: validação rígida (área, asa não vizinha, tipo, palavras, tamanho) e campos extras ignorados", async () => {
  await semear(); const put = (b) => chamar("PUT", "/perfil/promotor/inteligente", { token: "prom1", body: b });
  falha(await put({ experiencias: [{ area: "Hacker", anos: 1 }] }), 400, "dados-invalidos");
  falha(await put({ experiencias: [{ area: "Bebidas", anos: 1 }, { area: "Bebidas", anos: 2 }] }), 400, "dados-invalidos");
  falha(await put({ experiencias: [{ area: "Bebidas", anos: 99 }] }), 400, "dados-invalidos");
  falha(await put({ eneagrama: { tipo: 10 } }), 400, "dados-invalidos"); falha(await put({ eneagrama: { tipo: 1, asa: 5 } }), 400, "dados-invalidos"); falha(await put({ eneagrama: { tipo: 1, instinto: "XX" } }), 400, "dados-invalidos");
  falha(await put({ palavrasChave: ["<script>alert(1)</script>"] }), 400, "dados-invalidos"); falha(await put({ palavrasChave: Array(13).fill("ok x") }), 400, "dados-invalidos");
  falha(await put({ bio: "x".repeat(301) }), 400, "dados-invalidos");
  ok(await put({ experiencias: [], eneagrama: null, bio: "ok", status: "ativo", treinamentoOk: true, ratingMedia: 5 }));
  const p = await get("profissionais", "prom1"); assert.equal(p.treinamentoOk, false); assert.equal(p.ratingMedia, undefined);
  falha(await chamar("PUT", "/perfil/promotor/inteligente", { token: "lojaA", body: {} }), 403, "sem-permissao");
});
t("vaga herda a localização da loja (servidor): local/regiao; campos soltos do cliente são ignorados", async () => {
  await set("contratantes", "lojaA", { uid: "lojaA", razaoSocial: "Mercado A", localizacao: { lat: -22.4358, lng: -46.8231, cidade: "Itapira", uf: "SP" } }); await set("cartoes", "lojaA", { uid: "lojaA", status: "ativo", ultimos4: "1234" });
  const r = await chamar("POST", "/criarPedido", { token: "lojaA", body: { loja: "Mercado A — Rua 1", data: dia(2), entrada: "08:00", saida: "12:00", foco: "Mercearia", lat: 0, lng: 0, cidade: "Outra" } }); ok(r);
  const v = await get("solicitacoes", r.json.id); assert.deepEqual([v.local.lat, v.local.lng, v.regiao.cidade, v.regiao.uf], [-22.4358, -46.8231, "Itapira", "SP"]);
  assert.equal(v.lat, undefined, "coordenadas soltas do cliente não entram no pedido"); assert.equal(v.cidade, undefined);
});
t("loja sem localização cadastrada não consegue pedir (o check-in precisa do ponto exato da loja)", async () => {
  await set("contratantes", "lojaA", { uid: "lojaA", razaoSocial: "Mercado A" }); await set("cartoes", "lojaA", { uid: "lojaA", status: "ativo", ultimos4: "1234" });
  falha(await chamar("POST", "/criarPedido", { token: "lojaA", body: { loja: "Mercado A — Rua 1", data: dia(2), entrada: "08:00", saida: "12:00", foco: "Mercearia" } }), 409, "localizacao-obrigatoria");
});
t("regras do Firestore: loja e promotor NÃO gravam localização nem perfil inteligente direto (só o servidor valida)", async () => {
  const fs = require("node:fs"), rules = fs.readFileSync(require("node:path").join(__dirname, "../firestore.rules"), "utf8");
  const lojaUpd = /match \/contratantes\/\{uid\}[\s\S]*?allow update:[\s\S]*?soMuda\(\[([^\]]*)\]\)/.exec(rules)[1];
  for (const c of ["cidade", "uf", "lat", "lng", "localizacao"]) assert.ok(!lojaUpd.includes(`'${c}'`), `loja não grava ${c} direto`);
  const promUpd = /match \/profissionais\/\{uid\}[\s\S]*?allow update:[\s\S]*?soMuda\(\[([^\]]*)\]\)/.exec(rules)[1];
  for (const c of ["eneagrama", "experiencias", "palavrasChave", "areasExperiencia", "nivel", "vidas"]) assert.ok(!promUpd.includes(`'${c}'`), c);
});
t("conta de marca (B2B) não vira loja/promotor por engano e /sessao a orienta ao painel da marca", async () => {
  await semear(); E.tokens.marca1 = { uid: "marca1", email: "mk1@x.com", email_verified: true }; E.claimsStore.marca1 = { role: "marca" };
  const marca = await chamar("POST", "/sessao", { token: "marca1", body: {} });
  ok(marca); assert.equal(marca.json.estado, "outro-perfil"); assert.equal(marca.json.destino, "/marca.html");
  falha(await chamar("POST", "/cadastro/loja", { token: "marca1", body: { termos: true } }), 409, "papel-conflito");
  falha(await chamar("POST", "/cadastro/promotor", { token: "marca1", body: { termos: true, nascimento: "1990-01-01", cpf: "52998224725" } }), 409, "papel-conflito");
  assert.equal((await get("contratantes", "marca1")), undefined, "nenhum cadastro foi criado");
});
t("cabeçalhos: geolocalização e câmera liberadas só para a própria origem; microfone segue bloqueado", async () => {
  const Seg = ctx.Seg || require("../server/lib/seguranca.js"), hs = {}; Seg.cabecalhos()({}, { setHeader: (k, v) => (hs[k] = v), removeHeader() {} }, () => {});
  const pp = hs["Permissions-Policy"]; assert.match(pp, /geolocation=\(self\)/); assert.match(pp, /camera=\(self\)/); assert.match(pp, /microphone=\(\)/);
});

// =================== 5. MULTI-PERFIL / TROCA DE PORTAL (/sessao) ===================
t("sessão: conta com dois perfis NÃO trava; o portal aberto decide o perfil ativo e nenhum perfil se perde", async () => {
  await set("contratantes", "dual", { uid: "dual", razaoSocial: "Loja Dual" }); await set("profissionais", "dual", { uid: "dual", nome: "Dual", status: "ativo", treinamentoOk: true });
  E.tokens.dual = { uid: "dual", email: "d@x.com", email_verified: true };                       // sem claim algum (conta antiga)
  let r = await chamar("POST", "/sessao", { token: "dual", body: {} }); ok(r);                    // cliente antigo, sem portal → escolher (antes: 409 "Conta com dois perfis")
  assert.equal(r.json.estado, "escolher"); assert.deepEqual(r.json.perfis, ["loja", "promotor"]); assert.equal(E.claimsStore.dual, undefined);
  r = await chamar("POST", "/sessao", { token: "dual", body: { portal: "promotor" } }); ok(r);
  assert.deepEqual([r.json.estado, r.json.role, r.json.atualizarToken], ["ok", "promotor", true]);
  assert.deepEqual([E.claimsStore.dual.role, E.claimsStore.dual.treinado, E.claimsStore.dual.perfis], ["promotor", true, ["loja", "promotor"]]);
  ok(await chamar("GET", "/habilitacao", { token: "dual" }));                                      // rota de promotor liberada
  r = await chamar("POST", "/sessao", { token: "dual", body: { portal: "loja" } }); ok(r);
  assert.deepEqual([r.json.estado, r.json.role, E.claimsStore.dual.role], ["ok", "loja", "loja"]); assert.deepEqual(E.claimsStore.dual.perfis, ["loja", "promotor"]);
  falha(await chamar("GET", "/habilitacao", { token: "dual" }), 403, "sem-permissao");           // com a loja ativa, rota de promotor continua protegida
  r = await chamar("POST", "/sessao", { token: "dual", body: { portal: "loja" } }); assert.equal(r.json.atualizarToken, false);   // idempotente: sem novo token à toa
  r = await chamar("POST", "/sessao", { token: "dual", body: {} }); assert.deepEqual([r.json.estado, r.json.role], ["ok", "loja"]);  // cliente antigo com papel ativo válido
});
t("sessão: perfil errado vira aviso amigável (200 + estado), nunca erro, e não altera o papel", async () => {
  await set("contratantes", "lojaA", { uid: "lojaA" });
  let r = await chamar("POST", "/sessao", { token: "lojaA", body: { portal: "promotor" } }); ok(r);
  assert.deepEqual([r.json.estado, r.json.sugerido, r.json.role, r.json.atualizarToken], ["outro-perfil", "loja", null, false]); assert.equal(E.claimsStore.lojaA.role, "loja");
  await semear({ uid: "prom1" });
  r = await chamar("POST", "/sessao", { token: "prom1", body: { portal: "loja" } }); ok(r); assert.deepEqual([r.json.estado, r.json.sugerido], ["outro-perfil", "promotor"]);
  r = await chamar("POST", "/sessao", { token: "novo", body: { portal: "promotor" } }); ok(r); assert.deepEqual([r.json.estado, r.json.perfis], ["cadastro", []]);
  falha(await chamar("POST", "/sessao", { token: "lojaA", body: { portal: "dono" } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/sessao", { body: { portal: "loja" } }), 401, "nao-autenticado");
});
t("sessão: ninguém se promove a admin pelo portal; admin entra nos portais sem perder o admin", async () => {
  let r = await chamar("POST", "/sessao", { token: "lojaA", body: { portal: "admin" } }); ok(r); assert.equal(r.json.estado, "outro-perfil"); assert.equal(E.claimsStore.lojaA.role, "loja"); assert.ok(!E.claimsStore.lojaA.perfis?.includes("admin"));
  falha(await chamar("GET", "/admin/promotores", { token: "lojaA" }), 403, "sem-permissao");
  E.claimsStore.adm1 = { role: "admin", admin: true };
  r = await chamar("POST", "/sessao", { token: "adm", body: { portal: "promotor" } }); ok(r); assert.deepEqual([r.json.estado, r.json.perfis], ["cadastro", ["admin"]]);   // admin pode criar o próprio perfil
  ok(await chamar("POST", "/cadastro/promotor", { token: "adm", body: { termos: true, nascimento: "1990-03-04", cpf: cpf(0) } }));                                       // antes: 409 "outro perfil"
  assert.deepEqual([E.claimsStore.adm1.role, E.claimsStore.adm1.perfis], ["promotor", ["promotor", "admin"].sort((a, b) => ["loja", "promotor", "admin"].indexOf(a) - ["loja", "promotor", "admin"].indexOf(b))]);
  falha(await chamar("GET", "/admin/promotores", { token: "adm" }), 403, "sem-permissao");         // enquanto o portal do promotor está ativo
  r = await chamar("POST", "/sessao", { token: "adm", body: { portal: "admin" } }); ok(r); assert.deepEqual([r.json.estado, r.json.role], ["ok", "admin"]);
  ok(await chamar("GET", "/admin/promotores", { token: "adm" }));                                  // painel admin de volta
});
t("cadastro: conflito de perfil devolve 409 amigável com a sugestão de painel", async () => {
  await set("contratantes", "lojaA", { uid: "lojaA" });
  const r = await chamar("POST", "/cadastro/promotor", { token: "lojaA", body: { termos: true, nascimento: "1990-03-04", cpf: cpf(2) } });
  falha(r, 409, "papel-conflito"); assert.deepEqual([r.json.detalhe.tem, r.json.detalhe.sugerido], ["loja", "loja"]); assert.match(r.json.erro, /outra conta Google/);
  assert.equal((await get("profissionais", "lojaA")), undefined);
});

// =================== 6. RECADO DO SUPORTE (admin → promotor/loja) ===================
t("recado: admin envia a promotor e loja; motivo de 'voltar p/ análise' vira recado; aprovar limpa; 'entendi' só limpa o próprio", async () => {
  await semear({ status: "ativo" }); await set("contratantes", "lojaA", { uid: "lojaA", razaoSocial: "Loja A" });
  ok(await chamar("POST", "/admin/recado/promotor/prom1", { token: "adm", body: { texto: "Olá! Confira seu CPF e fale com o suporte." } }));
  assert.deepEqual([(await get("profissionais", "prom1")).recado.texto, (await get("profissionais", "prom1")).recado.tipo], ["Olá! Confira seu CPF e fale com o suporte.", "info"]);
  ok(await chamar("POST", "/admin/recado/loja/lojaA", { token: "adm", body: { texto: "Bom dia! Complete os dados fiscais." } })); assert.equal((await get("contratantes", "lojaA")).recado.texto, "Bom dia! Complete os dados fiscais.");
  ok(await chamar("POST", "/admin/promotores/prom1/status", { token: "adm", body: { status: "pendente", motivo: "CPF não confere" } }));
  const p = await get("profissionais", "prom1"); assert.deepEqual([p.status, p.recado.texto, p.recado.tipo], ["pendente", "CPF não confere", "pendente"]);
  ok(await chamar("POST", "/perfil/recado/lido", { token: "lojaA" })); assert.equal((await get("contratantes", "lojaA")).recado, undefined); assert.equal((await get("profissionais", "prom1")).recado.texto, "CPF não confere");
  ok(await chamar("POST", "/admin/promotores/prom1/status", { token: "adm", body: { status: "ativo" } })); assert.equal((await get("profissionais", "prom1")).recado, undefined);
});
t("recado: só admin envia; validação de tipo/tamanho; cadastro inexistente → 404; o cliente não escreve recado (regras)", async () => {
  await semear({ status: "ativo" });
  for (const tk of ["lojaA", "prom1"]) falha(await chamar("POST", "/admin/recado/promotor/prom1", { token: tk, body: { texto: "oi, tudo bem?" } }), 403, "sem-permissao");
  falha(await chamar("POST", "/admin/recado/admin/prom1", { token: "adm", body: { texto: "oi, tudo bem?" } }), 400);
  falha(await chamar("POST", "/admin/recado/promotor/prom1", { token: "adm", body: { texto: "x" } }), 400);
  falha(await chamar("POST", "/admin/recado/promotor/prom1", { token: "adm", body: { texto: "a".repeat(301) } }), 400);
  falha(await chamar("POST", "/admin/recado/promotor/fantasma", { token: "adm", body: { texto: "oi, tudo bem?" } }), 404, "nao-encontrado");
  falha(await chamar("POST", "/perfil/recado/lido", {}), 401, "nao-autenticado");
  const regras = require("node:fs").readFileSync(require("node:path").join(__dirname, "../firestore.rules"), "utf8"); assert.ok(!/'recado'/.test(regras), "recado não pode estar na lista de campos graváveis pelo cliente");
});

// =================== 6. ONBOARDING / ADMIN: CPF duplicado, desbloqueio, edição, exclusão, rotas dos painéis ===================
t("desbloqueio: bloqueado SEM data de nascimento é liberado, mas continua sem aceitar turno; data < 16 conhecida não libera", async () => {
  await set("profissionais", "prom1", { uid: "prom1", nome: "A", status: "bloqueado" }); await set("profissionais_privado", "prom1", { uid: "prom1" });
  ok(await chamar("POST", "/admin/promotores/prom1/status", { token: "adm", body: { status: "ativo" } }));
  assert.equal((await get("profissionais", "prom1")).status, "ativo");
  const h = await chamar("GET", "/habilitacao", { token: "prom1" }); ok(h); assert.equal(h.json.habilitado, false); assert.ok(h.json.pendencias.includes("nascimento"));
  falha(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: "qualquer" } }), 404);          // nem chega a aceitar: pedido inexistente (a trava legal roda no aceite real, ver teste de idade)
  await set("profissionais", "prom1", { uid: "prom1", nome: "A", status: "bloqueado" });
  await set("profissionais_privado", "prom1", { uid: "prom1", nascimentoEnc: enc("prom1", "nascimento", nasc(15)) });
  falha(await chamar("POST", "/admin/promotores/prom1/status", { token: "adm", body: { status: "ativo" } }), 409, "idade-minima");
  await set("profissionais", "prom2", { uid: "prom2", nome: "B", status: "pendente" }); await set("profissionais_privado", "prom2", { uid: "prom2" });
  falha(await chamar("POST", "/admin/promotores/prom2/status", { token: "adm", body: { status: "ativo" } }), 409, "cadastro-incompleto");   // 1ª aprovação continua exigindo o cadastro completo
});
t("CPF duplicado: 409 com dica do e-mail (mascarado); registro órfão (sem perfil) não trava o cadastro", async () => {
  await semear({ status: "ativo" }); await set("usuarios", "prom1", { uid: "prom1", role: "promotor", email: "joao.silva@gmail.com" });
  const r = await chamar("POST", "/cadastro/promotor", { token: "novo", body: { termos: true, nascimento: "1990-03-04", cpf: cpf(0) } });
  falha(r, 409, "cpf-duplicado"); assert.match(r.json.detalhe.emailMascarado, /^j\*+@gmail\.com$/); assert.ok(!JSON.stringify(r.json).includes("joao"));
  await ctx.db.collection("profissionais").doc("prom1").delete();                                                  // perfil removido, privado esquecido = órfão
  ok(await chamar("POST", "/cadastro/promotor", { token: "novo", body: { termos: true, nascimento: "1990-03-04", cpf: cpf(0) } }));
});
t("/sessao devolve o destino do painel certo (loja → /painel-loja, promotor → /painel-promotor, conta de promotor abrindo a loja → painel do promotor)", async () => {
  let r = await chamar("POST", "/sessao", { token: "lojaA", body: { portal: "loja" } }); ok(r); assert.deepEqual([r.json.estado, r.json.destino], ["ok", "/painel-loja"]);
  r = await chamar("POST", "/sessao", { token: "prom1", body: { portal: "promotor" } }); ok(r); assert.deepEqual([r.json.estado, r.json.destino], ["ok", "/painel-promotor"]);
  r = await chamar("POST", "/sessao", { token: "prom1", body: { portal: "loja" } }); ok(r); assert.deepEqual([r.json.estado, r.json.destino], ["outro-perfil", "/painel-promotor"]);
  r = await chamar("POST", "/sessao", { token: "lojaA", body: { portal: "promotor" } }); ok(r); assert.deepEqual([r.json.estado, r.json.destino], ["outro-perfil", "/painel-loja"]);
  r = await chamar("POST", "/sessao", { token: "novo", body: { portal: "loja" } }); ok(r); assert.deepEqual([r.json.estado, r.json.destino], ["cadastro", null]);
});
t("rotas limpas: /painel-loja e /painel-promotor entregam a página certa; barra final redireciona preservando a query", async () => {
  let r = await chamar("GET", "/painel-loja"); ok(r); assert.ok(r.texto.endsWith("index.html"));
  r = await chamar("GET", "/painel-promotor"); ok(r); assert.ok(r.texto.endsWith("promotor.html"));
  r = await chamar("GET", "/painel-loja/?x=1"); assert.equal(r.status, 302); assert.equal(r.h.location, "/painel-loja?x=1");
});
t("admin edita promotor (dados cifrados, CPF único, ≥ 16 anos) e loja (CNPJ válido); só admin; log sem dados pessoais", async () => {
  await semear({ status: "ativo" }); await semear({ uid: "prom2", cpfn: 1 }); await set("contratantes", "lojaA", { uid: "lojaA", razaoSocial: "Loja A" });
  falha(await chamar("PUT", "/admin/promotores/prom1", { token: "lojaA", body: { nome: "X Y" } }), 403, "sem-permissao");
  ok(await chamar("PUT", "/admin/promotores/prom1", { token: "adm", body: { nome: "Novo Nome", cidade: "Itapira", telefone: "(19) 99999-1234", nascimento: "1990-01-02", valorMin: 5000, disponibilidade: { inicio: "07:00", fim: "19:00" } } }));
  const pub = await get("profissionais", "prom1"); assert.deepEqual([pub.nome, pub.cidade, pub.valorMin, pub.editadoPor], ["Novo Nome", "Itapira", 5000, "adm1"]);
  const raw = JSON.stringify(await get("profissionais_privado", "prom1")); for (const seg of ["99999-1234", "19999991234", "1990-01-02"]) assert.ok(!raw.includes(seg), `dado em texto puro: ${seg}`);
  const f = await chamar("GET", "/admin/promotores/prom1", { token: "adm" }); ok(f); assert.deepEqual([f.json.telefone, f.json.nascimento, f.json.nome], ["19999991234", "1990-01-02", "Novo Nome"]);
  falha(await chamar("PUT", "/admin/promotores/prom1", { token: "adm", body: { cpf: cpf(1) } }), 409, "cpf-duplicado");
  ok(await chamar("PUT", "/admin/promotores/prom1", { token: "adm", body: { cpf: cpf(2) } })); assert.equal((await get("profissionais_privado", "prom1")).cpfIdx, Cripto.indiceCego(cpf(2)));
  falha(await chamar("PUT", "/admin/promotores/prom1", { token: "adm", body: { nascimento: nasc(15) } }), 403, "idade-minima");
  falha(await chamar("PUT", "/admin/promotores/prom1", { token: "adm", body: { status: "ativo", treinamentoOk: true } }), 400, "dados-invalidos");   // mass assignment: campos fora da lista são ignorados
  falha(await chamar("PUT", "/admin/promotores/fantasma", { token: "adm", body: { nome: "Zé Ninguém" } }), 404, "nao-encontrado");
  ok(await chamar("PUT", "/admin/lojas/lojaA", { token: "adm", body: { razaoSocial: "Mercado X", documento: "11.222.333/0001-81", telefone: "(19) 3333-4444", email: "x@mercado.com" } }));
  const l = await get("contratantes", "lojaA"); assert.deepEqual([l.razaoSocial, l.documento, l.telefone], ["Mercado X", "11222333000181", "1933334444"]);
  falha(await chamar("PUT", "/admin/lojas/lojaA", { token: "adm", body: { documento: "11.222.333/0001-82" } }), 400, "documento-invalido");
  const logs = [...E.store.entries()].filter(([k]) => k.startsWith("auditoria/")).map(([, v]) => v), ed = logs.find((a) => a.acao === "admin.promotor.editar");
  assert.ok(ed && ed.detalhes.campos.includes("telefone")); assert.ok(!JSON.stringify(logs).includes("99999-1234") && !JSON.stringify(logs).includes("19999991234"));
});
t("admin exclui promotor: apaga dados e credenciais, mantém o ledger, libera o CPF; trava por saldo/turno/saque; protege admin e a si mesmo", async () => {
  await semear({ status: "ativo" }); await set("usuarios", "prom1", { uid: "prom1", role: "promotor", email: "p@x.com" });
  await set("treinamento_progresso", "prom1_m1", { uid: "prom1", moduloId: "m1", concluido: true }); await set("lancamentos", "pg_s1_prof", { carteiraUid: "prom1", tipo: "credito_diaria", dPendente: 15000, dDisponivel: 0 });
  const corpo = { motivo: "Pedido do titular (LGPD)", confirmar: "EXCLUIR" };
  falha(await chamar("POST", "/admin/promotores/prom1/excluir", { token: "prom1", body: corpo }), 403, "sem-permissao");
  falha(await chamar("POST", "/admin/promotores/prom1/excluir", { token: "adm", body: { motivo: "Pedido do titular" } }), 400, "confirmacao-obrigatoria");
  falha(await chamar("POST", "/admin/promotores/prom1/excluir", { token: "adm", body: { confirmar: "EXCLUIR" } }), 400, "dados-invalidos");
  E.tokens.velho = { ...U.adm, auth_time: Math.floor(Date.now() / 1000) - 3600 }; falha(await chamar("POST", "/admin/promotores/prom1/excluir", { token: "velho", body: corpo }), 401, "reautenticar");
  await set("carteiras", "prom1", { uid: "prom1", pendenteCentavos: 15000, disponivelCentavos: 0 });
  falha(await chamar("POST", "/admin/promotores/prom1/excluir", { token: "adm", body: corpo }), 409, "exclusao-bloqueada");
  await set("carteiras", "prom1", { uid: "prom1", pendenteCentavos: 0, disponivelCentavos: 0 });
  await set("solicitacoes", "s1", { uid: "lojaA", promotorUid: "prom1", status: "aceita" });
  falha(await chamar("POST", "/admin/promotores/prom1/excluir", { token: "adm", body: corpo }), 409, "exclusao-bloqueada");
  await set("solicitacoes", "s1", { uid: "lojaA", promotorUid: "prom1", status: "paga" });
  await set("saques", "q1", { uid: "prom1", status: "solicitado", valorCentavos: 5000 });
  falha(await chamar("POST", "/admin/promotores/prom1/excluir", { token: "adm", body: corpo }), 409, "exclusao-bloqueada");
  await set("saques", "q1", { uid: "prom1", status: "pago", valorCentavos: 5000 });
  falha(await chamar("POST", "/admin/lojas/prom1/excluir", { token: "adm", body: corpo }), 404, "nao-encontrado");          // tipo errado
  const r = await chamar("POST", "/admin/promotores/prom1/excluir", { token: "adm", body: corpo }); ok(r);
  for (const [c, id] of [["profissionais", "prom1"], ["profissionais_privado", "prom1"], ["usuarios", "prom1"], ["treinamento_progresso", "prom1_m1"]]) assert.equal(await get(c, id), undefined, `${c} deveria ter sido apagado`);
  assert.ok(E.excluidos.has("prom1") && E.revogados.has("prom1"));
  for (const [c, id] of [["solicitacoes", "s1"], ["lancamentos", "pg_s1_prof"], ["carteiras", "prom1"], ["saques", "q1"]]) assert.ok(await get(c, id), `${c} (histórico financeiro) deve ser mantido`);
  assert.ok([...E.store.values()].some((v) => v?.acao === "admin.promotor.excluir"));
  ok(await chamar("POST", "/cadastro/promotor", { token: "novo", body: { termos: true, nascimento: "1990-03-04", cpf: cpf(0) } }));    // o CPF ficou livre
  falha(await chamar("POST", "/admin/promotores/adm1/excluir", { token: "adm", body: corpo }), 409, "exclusao-proibida");
  E.claimsStore.adm2 = { role: "admin" }; E.tokens.adm2 = undefined; await set("profissionais", "adm2", { uid: "adm2", nome: "Outro Admin", status: "ativo" });
  falha(await chamar("POST", "/admin/promotores/adm2/excluir", { token: "adm", body: corpo }), 409, "exclusao-proibida");
});
t("admin exclui loja: cancela pedidos não pagos, remove cartão e credenciais, mantém notas e pagamentos", async () => {
  await set("contratantes", "lojaA", { uid: "lojaA", razaoSocial: "Loja A" }); await set("usuarios", "lojaA", { uid: "lojaA", role: "loja" });
  await set("cartoes", "lojaA", { status: "ativo", ultimos4: "4242" }); await set("cartoes_privado", "lojaA", { uid: "lojaA", mpCardId: "1" });
  await set("solicitacoes", "sA", { uid: "lojaA", status: "aberta" }); await set("solicitacoes", "sB", { uid: "lojaA", status: "paga" }); await set("notas", "n1", { contratanteUid: "lojaA" }); await set("pagamentos_internos", "sB", { uid: "lojaA", status: "aprovado" });
  const corpo = { motivo: "Loja encerrou as atividades", confirmar: "EXCLUIR" };
  const r = await chamar("POST", "/admin/lojas/lojaA/excluir", { token: "adm", body: corpo }); ok(r); assert.equal(r.json.pedidosCancelados, 1);
  assert.equal((await get("solicitacoes", "sA")).status, "cancelada"); assert.equal((await get("solicitacoes", "sB")).status, "paga");
  for (const [c, id] of [["contratantes", "lojaA"], ["cartoes", "lojaA"], ["cartoes_privado", "lojaA"], ["usuarios", "lojaA"]]) assert.equal(await get(c, id), undefined, `${c} deveria ter sido apagado`);
  for (const [c, id] of [["notas", "n1"], ["pagamentos_internos", "sB"]]) assert.ok(await get(c, id), `${c} deve ser mantido`);
  assert.ok(E.excluidos.has("lojaA"));
});

// =================== TAXAS DINÂMICAS (configuracoes/taxas) ===================
const NOVAS = { diariaCentavos: 25000, comissaoCentavos: 5000, repasseCentavos: 20000, taxaFixaCentavos: 500, horasMin: 2, horasMax: 8, maxSemana: 3 };
const salvarTaxas = (corpo = NOVAS, token = "adm") => chamar("PUT", "/admin/taxas", { token, body: corpo });

t("taxas: sem nada configurado o app recebe o padrão 200/50/150 sem precisar de login", async () => {
  const r = await chamar("GET", "/config/taxas"); ok(r);
  assert.deepEqual(r.json, { diariaCentavos: 20000, comissaoCentavos: 5000, repasseCentavos: 15000, taxaFixaCentavos: 0, horasMin: 4, horasMax: 6, maxSemana: 3, versao: 0 });
});
t("taxas: só o admin lê os metadados e só o admin altera (sem login 401, loja/promotor 403)", async () => {
  falha(await chamar("GET", "/admin/taxas"), 401, "nao-autenticado");
  for (const token of ["lojaA", "prom1"]) { falha(await salvarTaxas(NOVAS, token), 403, "sem-permissao"); falha(await chamar("GET", "/admin/taxas", { token }), 403, "sem-permissao"); }
  falha(await salvarTaxas(NOVAS, null), 401, "nao-autenticado");
  assert.equal((await get("configuracoes", "taxas")), undefined, "nada foi gravado");
  const r = await chamar("GET", "/admin/taxas", { token: "adm" }); ok(r); assert.equal(r.json.origem, "padrao"); assert.ok(r.json.limites && r.json.padrao);
});
t("taxas: admin salva → grava no banco, versão sobe, rota pública reflete na hora e a auditoria guarda antes/depois", async () => {
  const r = await salvarTaxas(); ok(r, "salvar"); assert.equal(r.json.versao, 1); assert.equal(r.json.origem, "banco"); assert.equal(r.json.atualizadoPor, "adm1");
  const doc = await get("configuracoes", "taxas"); assert.equal(doc.diariaCentavos, 25000); assert.equal(doc.versao, 1); assert.equal(doc.atualizadoPor, "adm1");
  const pub = await chamar("GET", "/config/taxas"); ok(pub); assert.deepEqual(pub.json, { ...NOVAS, versao: 1 });
  assert.ok(!("atualizadoPor" in pub.json), "a rota pública não expõe quem alterou");
  const aud = (await ctx.db.collection("auditoria").get()).docs.map((d) => d.data()).find((a) => a.acao === "admin.taxas.salvar");
  assert.ok(aud); assert.equal(aud.detalhes.antes.diariaCentavos, 20000); assert.equal(aud.detalhes.depois.diariaCentavos, 25000);
  assert.equal((await salvarTaxas({ ...NOVAS, maxSemana: 2 })).json.versao, 2);
});
t("taxas: validação rígida (soma, tipos, limites, horas, semana) e campos extras nunca chegam ao banco", async () => {
  const ruins = [
    { ...NOVAS, repasseCentavos: 19000 },                       // comissão + repasse ≠ diária
    { ...NOVAS, diariaCentavos: "25000" },                      // string
    { ...NOVAS, diariaCentavos: 25000.5 }, { ...NOVAS, taxaFixaCentavos: -1 }, { ...NOVAS, comissaoCentavos: -5000, repasseCentavos: 30000 },
    { ...NOVAS, diariaCentavos: 500, comissaoCentavos: 100, repasseCentavos: 400 },                 // diária abaixo do piso
    { ...NOVAS, diariaCentavos: 600000, comissaoCentavos: 100000, repasseCentavos: 500000 },       // acima do teto
    { ...NOVAS, comissaoCentavos: 25000, repasseCentavos: 0 },                                      // repasse zero
    { ...NOVAS, taxaFixaCentavos: 60000 },
    { ...NOVAS, horasMin: 7, horasMax: 6 }, { ...NOVAS, horasMin: 4.3 }, { ...NOVAS, horasMax: 13 }, { ...NOVAS, horasMin: 0 },
    { ...NOVAS, maxSemana: 0 }, { ...NOVAS, maxSemana: 8 }, { ...NOVAS, maxSemana: 2.5 }, { ...NOVAS, maxSemana: undefined },
    { ...NOVAS, horasMax: null }, [], null
  ];
  for (const corpo of ruins) { const r = await salvarTaxas(corpo); assert.equal(r.status, 400, JSON.stringify(corpo)); }
  assert.equal(await get("configuracoes", "taxas"), undefined, "nenhuma proposta inválida foi gravada");
  ok(await salvarTaxas({ ...NOVAS, horasMin: 4.5, horasMax: 5.5, evil: "<script>", atualizadoPor: "hacker" }), "meia hora é aceita");
  const doc = await get("configuracoes", "taxas"); assert.ok(!("evil" in doc)); assert.equal(doc.versao, 1); assert.equal(doc.atualizadoPor, "adm1", "autoria vem do token, não do corpo");
});
t("taxas: mexe em dinheiro, então exige login recente (como estorno e saque)", async () => {
  E.tokens.adm.auth_time = Math.floor(E.clock.now / 1000) - 3600;
  falha(await salvarTaxas(), 401, "reautenticar"); E.tokens.adm.auth_time = undefined;
  assert.equal(await get("configuracoes", "taxas"), undefined);
});
t("taxas: dois admins editando — quem salva com versão velha leva 409 e nada é sobrescrito", async () => {
  ok(await salvarTaxas({ ...NOVAS, versao: 0 }));                                   // admin A salva sobre a v0 → v1
  const r = await salvarTaxas({ ...NOVAS, maxSemana: 5, versao: 0 });               // admin B ainda via a v0
  falha(r, 409, "taxas-desatualizadas"); assert.equal(r.json.detalhe.versaoAtual, 1);
  assert.equal((await get("configuracoes", "taxas")).maxSemana, 3);
  ok(await salvarTaxas({ ...NOVAS, maxSemana: 5, versao: 1 }));
});
t("taxas: criarPedido usa a diária, a taxa fixa e a duração NOVAS (o pedido não depende de nenhuma constante)", async () => {
  await lojaComCartao();
  const body = { loja: "Mercado A — Rua 1", data: dia(2), entrada: "08:00", saida: "10:00", foco: "Mercearia" };
  falha(await chamar("POST", "/criarPedido", { token: "lojaA", body }), 400, "turno-invalido");     // padrão: mínimo 4 h
  ok(await salvarTaxas());
  const r = await chamar("POST", "/criarPedido", { token: "lojaA", body }); ok(r, "2 h agora é válido");
  assert.deepEqual(r.json, { id: r.json.id, valor: 25000, taxaFixa: 500, total: 25500 });
  const sp = (await get("pagamentos_internos", r.json.id)).split;
  assert.deepEqual([sp.total, sp.promotor, sp.app, sp.versaoTaxas], [25500, 20000, 5500, 1]); assert.equal(sp.promotor + sp.app, sp.total);
  assert.equal((await get("solicitacoes", r.json.id)).valorPromotorCentavos, 20000, "o promotor vê o repasse novo");
  const longo = await chamar("POST", "/criarPedido", { token: "lojaA", body: { ...body, saida: "17:00" } }); falha(longo, 400, "turno-invalido"); assert.match(longo.json.erro, /máximo 8 horas/);
});
t("taxas: preço congelado no pedido — o que já foi criado paga/repassa o valor antigo; o novo, o novo", async () => {
  await semear({ treinado: true });
  const antigo = await pedido(); ok(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: antigo } }));
  ok(await salvarTaxas({ ...NOVAS, taxaFixaCentavos: 0, horasMin: 4, horasMax: 6 }));                     // 250/50/200 depois do aceite
  ok(await pagar(antigo)); const a = (await get("pagamentos_internos", antigo)).split;                    // MP cobra R$ 200 (valor visto pela loja)
  assert.deepEqual([a.total, a.promotor, a.app], [20000, 15000, 5000]);
  const novo = await pedido({ data: dia(3) }); ok(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: novo } }));
  falha(await pagar(novo), 400, "valor-divergente");                                                      // R$ 200 não paga um pedido de R$ 250
  ok(await pagar(novo, { transaction_amount: 250, id: 777 })); const n = (await get("pagamentos_internos", novo)).split;
  assert.deepEqual([n.total, n.promotor, n.app], [25000, 20000, 5000]);
  assert.equal((await get("carteiras", "prom1")).pendenteCentavos, 15000 + 20000, "cada crédito segue o split congelado do seu pedido");
});
t("taxas: o limite semanal por loja vem do banco (3 → 1 muda o aceite na hora)", async () => {
  await semear({ treinado: true });
  const p1 = await pedido({ entrada: "08:00", saida: "12:00", data: dia(2) }), p2 = await pedido({ entrada: "13:00", saida: "17:00", data: dia(2) });
  ok(await salvarTaxas({ ...NOVAS, maxSemana: 1 }));
  ok(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: p1 } }));
  falha(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: p2 } }), 409, "limite-semanal");
  ok(await salvarTaxas({ ...NOVAS, maxSemana: 2 }));
  ok(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: p2 } }));
});
t("taxas: se o banco cair, usa a última versão boa; sem cache ou com documento corrompido, 503 (nunca chuta valores)", async () => {
  ok(await salvarTaxas()); await lojaComCartao();
  const orig = ctx.db.collection;
  const quebrar = () => { ctx.db.collection = (c) => (c === "configuracoes" ? { doc: () => ({ get: async () => { throw new Error("firestore fora"); } }) } : orig(c)); };
  try {
    E.avancar(31_000); quebrar();
    const r = await chamar("GET", "/config/taxas"); ok(r); assert.equal(r.json.diariaCentavos, 25000, "serviu a última versão boa");
    ctx.db.collection = orig; ctx.taxas.invalidar(); quebrar();
    falha(await chamar("GET", "/config/taxas"), 503, "taxas-indisponiveis");
    falha(await chamar("POST", "/criarPedido", { token: "lojaA", body: { loja: "Mercado A — Rua 1", data: dia(2), entrada: "08:00", saida: "12:00", foco: "Mercearia" } }), 503, "taxas-indisponiveis");   // sem preço confiável, não nasce pedido
  } finally { ctx.db.collection = orig; }
  await set("configuracoes", "taxas", { diariaCentavos: 1, comissaoCentavos: 1, repasseCentavos: 1, versao: 7 }); ctx.taxas.invalidar();
  falha(await chamar("GET", "/config/taxas"), 503, "taxas-indisponiveis");
});
t("taxas: o cliente não lê nem escreve configuracoes direto (regras negam por padrão); só a API expõe", async () => {
  const rules = require("node:fs").readFileSync(require("node:path").join(__dirname, "../firestore.rules"), "utf8");
  assert.ok(!/match \/configuracoes/.test(rules), "nenhuma regra libera configuracoes: cai no deny-by-default");
});
// =================== 7. CHAT DE SUPORTE + PUSH ===================
const TK = (n) => `token-${n}-`.padEnd(40, "x");
const msgsDe = async (uid) => [...E.store.entries()].filter(([k, v]) => k.startsWith("suporte_mensagens/") && v.uid === uid).sort(([a], [b]) => (a > b ? 1 : -1)).map(([, v]) => v);
t("suporte: conversa completa usuário ↔ equipe, não lidas dos dois lados e histórico em ordem", async () => {
  await set("contratantes", "lojaA", { uid: "lojaA", razaoSocial: "Mercado A" });
  ok(await chamar("POST", "/suporte/mensagem", { token: "lojaA", body: { texto: "Oi, preciso de ajuda com o cadastro." } }));
  let c = await get("suporte_conversas", "lojaA"); assert.deepEqual([c.tipo, c.nome, c.naoLidasSuporte, c.naoLidasUsuario, c.ultimaDe], ["loja", "Mercado A", 1, 0, "usuario"]);
  ok(await chamar("POST", "/admin/suporte/lojaA/mensagem", { token: "adm", body: { texto: "Bom dia! Já vamos ver." } }));
  ok(await chamar("POST", "/admin/suporte/lojaA/mensagem", { token: "adm", body: { texto: "Pode enviar o CNPJ?" } }));
  c = await get("suporte_conversas", "lojaA"); assert.deepEqual([c.naoLidasUsuario, c.naoLidasSuporte, c.ultimaDe, c.ultimaMsg], [2, 1, "suporte", "Pode enviar o CNPJ?"]);
  assert.deepEqual((await msgsDe("lojaA")).map((m) => [m.de, m.texto]), [["usuario", "Oi, preciso de ajuda com o cadastro."], ["suporte", "Bom dia! Já vamos ver."], ["suporte", "Pode enviar o CNPJ?"]]);
  ok(await chamar("POST", "/suporte/lido", { token: "lojaA" })); assert.equal((await get("suporte_conversas", "lojaA")).naoLidasUsuario, 0);
  ok(await chamar("POST", "/admin/suporte/lojaA/lido", { token: "adm" })); assert.equal((await get("suporte_conversas", "lojaA")).naoLidasSuporte, 0);
});
t("suporte: permissões, validação e limites (sem IDOR: o usuário só fala na própria conversa)", async () => {
  await semear({ status: "ativo" }); await set("contratantes", "lojaA", { uid: "lojaA", razaoSocial: "A" });
  falha(await chamar("POST", "/suporte/mensagem", { body: { texto: "oi" } }), 401, "nao-autenticado");
  falha(await chamar("POST", "/suporte/mensagem", { token: "adm", body: { texto: "oi" } }), 403, "sem-permissao");                      // admin responde por /admin/suporte
  for (const tk of ["lojaA", "prom1"]) { falha(await chamar("POST", "/admin/suporte/prom1/mensagem", { token: tk, body: { texto: "oi" } }), 403, "sem-permissao"); falha(await chamar("POST", "/admin/suporte/prom1/lido", { token: tk }), 403, "sem-permissao"); }
  for (const texto of ["", "   ", "a".repeat(1001), { $gt: "" }, 5]) falha(await chamar("POST", "/suporte/mensagem", { token: "lojaA", body: { texto } }), 400);
  falha(await chamar("POST", "/admin/suporte/fantasma/mensagem", { token: "adm", body: { texto: "oi" } }), 404, "nao-encontrado");
  falha(await chamar("POST", "/admin/suporte/a.b/mensagem", { token: "adm", body: { texto: "oi" } }), 400, "dados-invalidos");          // id inválido
  ok(await chamar("POST", "/suporte/mensagem", { token: "lojaA", body: { texto: "<img src=x onerror=alert(1)>" } }));                   // guardado como texto (o front escapa)
  assert.equal((await msgsDe("lojaA")).length, 1); assert.equal((await msgsDe("prom1")).length, 0);
  let ultimo; for (let i = 0; i < 22; i++) ultimo = await chamar("POST", "/suporte/mensagem", { token: "lojaA", body: { texto: "spam " + i } }); falha(ultimo, 429, "limite-requisicoes");
});
t("push: aparelho do usuário recebe resposta da equipe; admins recebem mensagem do usuário; tokens mortos são limpos; sem vazamento entre contas", async () => {
  await semear({ status: "ativo" }); await set("contratantes", "lojaA", { uid: "lojaA", razaoSocial: "A" });
  ok(await chamar("POST", "/push/registrar", { token: "lojaA", body: { token: TK("loja") } })); ok(await chamar("POST", "/push/registrar", { token: "prom1", body: { token: TK("prom") } })); ok(await chamar("POST", "/push/registrar", { token: "adm", body: { token: TK("adm") } }));
  falha(await chamar("POST", "/push/registrar", { token: "lojaA", body: { token: "curto" } }), 400, "dados-invalidos"); falha(await chamar("POST", "/push/registrar", { body: { token: TK("x") } }), 401, "nao-autenticado");
  ok(await chamar("POST", "/admin/suporte/lojaA/mensagem", { token: "adm", body: { texto: "Olá, tudo bem?" } }));
  assert.equal(E.pushes.length, 1); assert.deepEqual(E.pushes[0].tokens, [TK("loja")]); assert.deepEqual([E.pushes[0].data.titulo, E.pushes[0].data.corpo, E.pushes[0].data.url], ["Suporte Abastece Já", "Olá, tudo bem?", "index.html?suporte=1"]);
  ok(await chamar("POST", "/suporte/mensagem", { token: "prom1", body: { texto: "Meu CPF está errado" } }));
  assert.deepEqual(E.pushes[1].tokens, [TK("adm")]); assert.equal(E.pushes[1].data.url, "admin.html#suporte");
  E.mortos.add(TK("loja")); ok(await chamar("POST", "/admin/suporte/lojaA/mensagem", { token: "adm", body: { texto: "de novo" } }));
  assert.equal([...E.store.keys()].filter((k) => k.startsWith("push_tokens/")).length, 2);                                               // o token morto foi apagado
  ok(await chamar("POST", "/push/registrar", { token: "lojaA", body: { token: TK("troca") } })); ok(await chamar("POST", "/push/registrar", { token: "prom1", body: { token: TK("troca") } }));   // mesmo aparelho, outra conta
  E.pushes.length = 0; ok(await chamar("POST", "/admin/suporte/lojaA/mensagem", { token: "adm", body: { texto: "só para a loja" } })); assert.ok(!E.pushes.some((p) => p.tokens.includes(TK("troca"))), "token migrou para a outra conta");
  ok(await chamar("POST", "/push/remover", { token: "lojaA", body: { token: TK("troca") } }));                                          // não é dela mais: não remove
  assert.equal([...E.store.values()].filter((v) => v.token === TK("troca")).length, 1);
  ok(await chamar("POST", "/push/remover", { token: "prom1", body: { token: TK("troca") } })); assert.equal([...E.store.values()].filter((v) => v.token === TK("troca")).length, 0);
});
t("suporte: recado e motivo de status do admin entram no histórico do chat e disparam push", async () => {
  await semear({ status: "ativo" }); ok(await chamar("POST", "/push/registrar", { token: "prom1", body: { token: TK("prom") } }));
  ok(await chamar("POST", "/admin/recado/promotor/prom1", { token: "adm", body: { texto: "Confira seu CPF, por favor." } }));
  ok(await chamar("POST", "/admin/promotores/prom1/status", { token: "adm", body: { status: "pendente", motivo: "CPF não confere" } }));
  assert.deepEqual((await msgsDe("prom1")).map((m) => [m.de, m.texto]), [["suporte", "Confira seu CPF, por favor."], ["suporte", "CPF não confere"]]);
  assert.equal((await get("suporte_conversas", "prom1")).naoLidasUsuario, 2); assert.equal(E.pushes.length, 2); assert.equal(E.pushes[0].data.url, "promotor.html?suporte=1");
});
t("suporte: regras do Firestore — leitura só do dono/admin, nenhuma escrita pelo cliente", async () => {
  const r = require("node:fs").readFileSync(require("node:path").join(__dirname, "../firestore.rules"), "utf8");
  assert.match(r, /match \/suporte_conversas\/\{uid\} \{ allow read: if dono\(uid\) \|\| ehAdmin\(\); allow write: if false; \}/);
  assert.match(r, /match \/suporte_mensagens\/\{id\}\s+\{ allow read: if logado\(\) && \(resource\.data\.uid == request\.auth\.uid \|\| ehAdmin\(\)\); allow write: if false; \}/);
  assert.ok(!/push_tokens/.test(r.replace(/\/\/.*$/gm, "")), "push_tokens fica negado por padrão");
});

// ============================================================
// HABILITAÇÃO POR CATEGORIA (vídeo + timer + questionário 100%)
// ============================================================
const PERGUNTAS = [
  { texto: "Qual é a regra de reposição por validade?", opcoes: ["Novos na frente", "PEPS: vencimento mais próximo na frente", "Tanto faz"], correta: 1 },
  { texto: "Produto com embalagem violada: o que fazer?", opcoes: ["Vender", "Retirar e avisar o responsável", "Esconder", "Devolver à prateleira"], correta: 1 },
  { texto: "Antes de repor, o que conferir?", opcoes: ["Etiqueta de preço correta", "A cor da caixa"], correta: 0 },
  { texto: "Como empilhar delicados?", opcoes: ["Em camadas baixas", "O mais alto possível", "Sob caixas pesadas"], correta: 0 }
];
const conteudo = (over = {}) => ({ descricao: "Treinamento de FLV", provedor: "youtube", videoRef: "abcdefghijk", duracaoSeg: 60, ativo: true, perguntas: PERGUNTAS.slice(0, 3), ...over });
const publicar = async (cat = "flv", over = {}) => ok(await chamar("PUT", `/admin/habilitacoes/categorias/${cat}`, { token: "adm", body: conteudo(over) }), "admin salva categoria");
const HAB = (caminho, body, token = "prom1") => chamar("POST", `/habilitacoes/${caminho}`, { token, body });
/** assiste ao vídeo de verdade: pings de 10 em 10 s com posição contígua, tocando */
async function assistir(cat = "flv", dur = 60) {
  let r; for (let pos = 0; pos <= dur; pos += 10) { r = await HAB("ping", { categoria: cat, posicaoSeg: pos, tocando: true }); ok(r, "ping"); E.avancar(10_000); }
  r = await HAB("ping", { categoria: cat, posicaoSeg: dur, tocando: true }); ok(r); return r.json;
}
/** descobre as respostas certas lendo o gabarito DIRETO do banco (o promotor nunca o vê) e mapeando para a ordem embaralhada */
async function respostasCertas(perguntas, cat = "flv") {
  const c = await get("habilitacao_categorias", cat);
  return perguntas.map((q) => { const orig = c.perguntas.find((p) => p.id === q.id); return q.opcoes.indexOf(orig.opcoes[orig.correta]); });
}
const iniciarEAssistir = async (cat = "flv", dur = 60) => { ok(await HAB("iniciar", { categoria: cat })); return assistir(cat, dur); };

t("admin cadastra conteúdo da categoria com validação; promotor não", async () => {
  falha(await chamar("PUT", "/admin/habilitacoes/categorias/flv", { token: "prom1", body: conteudo() }), 403, "sem-permissao");
  falha(await chamar("PUT", "/admin/habilitacoes/categorias/inexistente", { token: "adm", body: conteudo() }), 400, "dados-invalidos");
  falha(await chamar("PUT", "/admin/habilitacoes/categorias/flv", { token: "adm", body: conteudo({ perguntas: PERGUNTAS.slice(0, 2) }) }), 400, "dados-invalidos");          // mínimo 3
  falha(await chamar("PUT", "/admin/habilitacoes/categorias/flv", { token: "adm", body: conteudo({ perguntas: [...PERGUNTAS, PERGUNTAS[0]] }) }), 400, "dados-invalidos");   // máximo 4
  falha(await chamar("PUT", "/admin/habilitacoes/categorias/flv", { token: "adm", body: conteudo({ perguntas: [{ ...PERGUNTAS[0], correta: 9 }, PERGUNTAS[1], PERGUNTAS[2]] }) }), 400, "dados-invalidos");
  falha(await chamar("PUT", "/admin/habilitacoes/categorias/flv", { token: "adm", body: conteudo({ videoRef: "http://inseguro/v.mp4", provedor: "mp4" }) }), 400, "dados-invalidos");
  await publicar("flv"); const c = await get("habilitacao_categorias", "flv"); assert.equal(c.perguntas.length, 3); assert.equal(c.perguntas[0].id, "q1");
  const lista = await chamar("GET", "/admin/habilitacoes/categorias", { token: "adm" }); ok(lista); assert.equal(lista.json.length, 6); assert.equal(lista.json.find((x) => x.id === "flv").pronta, true);
});

t("categoria sem vídeo/perguntas publicados: ninguém inicia (falha fechada) e o gabarito nunca aparece para o promotor", async () => {
  await semear();
  falha(await HAB("iniciar", { categoria: "frios" }), 409, "categoria-indisponivel");
  await publicar("flv"); await publicar("frios", { ativo: false }); falha(await HAB("iniciar", { categoria: "frios" }), 409, "categoria-indisponivel");
  const l = await chamar("GET", "/habilitacoes", { token: "prom1" }); ok(l); assert.equal(l.json.categorias.length, 6);
  assert.equal(l.json.categorias.find((c) => c.id === "flv").disponivel, true); assert.equal(l.json.categorias.find((c) => c.id === "frios").disponivel, false);
  assert.ok(!JSON.stringify(l.json).includes("\"correta\"") && !JSON.stringify(l.json).includes("videoRef") && !JSON.stringify(l.json).includes("perguntas"), "lista não pode vazar gabarito, perguntas nem vídeo");
  falha(await HAB("iniciar", { categoria: "padaria; drop" }), 400, "dados-invalidos");
});

t("fluxo completo: timer = duração + 3 s, vídeo até o fim, questionário sem gabarito, 100% habilita e libera o aceite do setor", async () => {
  await semear({ treinado: true }); await publicar("flv");
  const sid = await pedido({ foco: "Hortifruti / FLV" });
  falha(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: sid } }), 403, "categoria-pendente");
  const ini = await HAB("iniciar", { categoria: "flv" }); ok(ini);
  assert.equal(ini.json.restanteMs, 63_000, "timer = 60 s de vídeo + 3 s de margem"); assert.equal(ini.json.margemSeg, 3);
  falha(await HAB("questionario", { categoria: "flv" }), 409, "timer-pendente");               // portão fechado: nada de questionário no começo
  let r = await assistir("flv", 60);                                                           // ~70 s de relógio correm durante a reprodução real
  assert.equal(r.videoOk, true); assert.equal(r.restanteMs, 0); assert.equal(r.liberado, true);
  const q = await HAB("questionario", { categoria: "flv" }); ok(q); assert.equal(q.json.perguntas.length, 3);
  assert.ok(q.json.perguntas.every((p) => Object.keys(p).sort().join() === "id,opcoes,texto"), "gabarito não sai do servidor (só id, texto e alternativas)");
  const resp = await HAB("responder", { categoria: "flv", respostas: await respostasCertas(q.json.perguntas) }); ok(resp);
  assert.equal(resp.json.aprovado, true); assert.equal(resp.json.acertos, 3); assert.equal(resp.json.selo.elite, true); assert.equal(resp.json.selo.titulo, "FLV");
  const p = await get("profissionais", "prom1"); assert.ok(p.habilitacoes.flv, "habilitação gravada no perfil"); assert.equal(p.habilitacoes.flv.elite, true); assert.equal(p.habilitacoes.flv.tentativas, 1);
  ok(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: sid } }));  // agora aceita o turno de FLV
  const lista = await chamar("GET", "/habilitacoes", { token: "prom1" }); assert.equal(lista.json.selos.some((s) => s.categoria === "flv" && s.elite), true);
  falha(await HAB("responder", { categoria: "flv", respostas: [0, 0, 0] }), 409, "sem-avaliacao");   // tentativa única: não reenvia depois de aprovado
  falha(await HAB("iniciar", { categoria: "flv" }), 409, "ja-habilitado");
});

t("anti-bypass: pular, pausar, adiantar relógio e declarar 'fim' não liberam o questionário", async () => {
  await semear(); await publicar("flv"); ok(await HAB("iniciar", { categoria: "flv" }));
  let r = await HAB("ping", { categoria: "flv", posicaoSeg: 0, tocando: true }); ok(r);
  E.avancar(10_000); r = await HAB("ping", { categoria: "flv", posicaoSeg: 58, tocando: true }); assert.equal(r.json.validoSeg, 0, "pular para o fim não credita");
  E.avancar(10_000); r = await HAB("ping", { categoria: "flv", posicaoSeg: 10, tocando: false }); assert.equal(r.json.validoSeg, 0, "pausado não credita");
  E.avancar(10_000); r = await HAB("ping", { categoria: "flv", posicaoSeg: 20, tocando: false }); assert.equal(r.json.validoSeg, 0, "pausado → pausado não credita");
  E.avancar(120_000);                                                                           // o timer do SERVIDOR já venceu (relógio, não o do navegador)...
  falha(await HAB("questionario", { categoria: "flv" }), 409, "video-incompleto");              // ...mas o vídeo não foi assistido
  r = await HAB("ping", { categoria: "flv", posicaoSeg: 60, tocando: true }); assert.ok(r.json.validoSeg < 5, "ping tardio só credita o tempo real decorrido (máx. 30 s por ping), nunca o vídeo todo");
  falha(await HAB("questionario", { categoria: "flv" }), 409, "video-incompleto");
  falha(await HAB("responder", { categoria: "flv", respostas: [0, 0, 0] }), 409, "sem-avaliacao");   // não dá para responder sem o questionário liberado
  E.avancar(5000); falha(await HAB("ping", { categoria: "frios", posicaoSeg: 0, tocando: true }), 409, "sessao-inexistente");
});

t("pausa e retomada: ping de play ancora a posição e o crédito segue o tempo real (sem perder nem ganhar)", async () => {
  await semear(); await publicar("flv"); ok(await HAB("iniciar", { categoria: "flv" }));
  const ping = (pos, tocando, evento = false) => HAB("ping", { categoria: "flv", posicaoSeg: pos, tocando, evento });
  E.avancar(7000); ok(await ping(0, true, true));                                                       // apertou play (âncora em 0)
  E.avancar(5000); let r = await ping(5, true); assert.equal(r.json.validoSeg, 5);
  E.avancar(2000); r = await ping(7, false, true); assert.equal(r.json.validoSeg, 7, "pausa credita o trecho já tocado");
  E.avancar(30_000); r = await ping(7, true, true); assert.equal(r.json.validoSeg, 7, "retomar só ancora; os 30 s de pausa não contam");
  E.avancar(5000); r = await ping(12, true); assert.equal(r.json.validoSeg, 12);
  E.avancar(5000); r = await ping(30, true); assert.equal(r.json.validoSeg, 12, "salto de 18 s em 5 s: sem crédito");
  E.avancar(500); r = await ping(30, true, true); assert.equal(r.json.validoSeg, 12, "ping de evento colado (<1 s) é ignorado");
});

t("reprovou (<100%): feedback, sessão encerrada, e é obrigatório assistir de novo com o timer do zero; depois de refazer, não é 'elite'", async () => {
  await semear(); await publicar("flv"); await iniciarEAssistir("flv");
  let q = await HAB("questionario", { categoria: "flv" }); ok(q);
  const certas = await respostasCertas(q.json.perguntas), erradas = certas.map((c, i) => (i === 0 ? (c + 1) % q.json.perguntas[0].opcoes.length : c));   // erra só UMA
  const r1 = await HAB("responder", { categoria: "flv", respostas: erradas }); ok(r1);
  assert.equal(r1.json.aprovado, false); assert.equal(r1.json.acertos, 2); assert.equal(r1.json.total, 3); assert.equal(r1.json.refazer, true);
  assert.equal((await get("profissionais", "prom1")).habilitacoes?.flv, undefined, "98% não habilita");
  falha(await HAB("responder", { categoria: "flv", respostas: certas }), 409, "sem-avaliacao");   // não reaproveita a mesma tentativa
  falha(await HAB("questionario", { categoria: "flv" }), 409, "sessao-encerrada");                // não revê o teste sem rever o vídeo
  const nova = await HAB("iniciar", { categoria: "flv" }); ok(nova);
  assert.equal(nova.json.validoSeg, 0, "vídeo do zero"); assert.equal(nova.json.restanteMs, 63_000, "timer inteiro do zero"); assert.equal(nova.json.reprovacoes, 1);
  falha(await HAB("questionario", { categoria: "flv" }), 409, "timer-pendente");
  await assistir("flv"); q = await HAB("questionario", { categoria: "flv" }); ok(q);
  const r2 = await HAB("responder", { categoria: "flv", respostas: await respostasCertas(q.json.perguntas) }); ok(r2);
  assert.equal(r2.json.aprovado, true); assert.equal(r2.json.selo.elite, false, "aprovado só na 2ª tentativa: habilitado, sem selo de elite");
  assert.equal((await get("profissionais", "prom1")).habilitacoes.flv.tentativas, 2);
});

t("respostas inválidas não gastam a tentativa nem aprovam; questionário vence em 20 min", async () => {
  await semear(); await publicar("flv"); await iniciarEAssistir("flv");
  const q = await HAB("questionario", { categoria: "flv" }); ok(q);
  falha(await HAB("responder", { categoria: "flv", respostas: [0, 0] }), 400, "dados-invalidos");          // faltou responder
  falha(await HAB("responder", { categoria: "flv", respostas: [0, 0, 99] }), 400, "dados-invalidos");
  falha(await HAB("responder", { categoria: "flv", respostas: "tudo certo" }), 400, "dados-invalidos");
  falha(await HAB("responder", { categoria: "flv", respostas: [0, 0, { $ne: 1 }] }), 400, "dados-invalidos");
  const q2 = await HAB("questionario", { categoria: "flv" }); ok(q2); assert.deepEqual(q2.json.perguntas, q.json.perguntas, "reabrir o app devolve o MESMO questionário");
  E.avancar(21 * 60_000); falha(await HAB("responder", { categoria: "flv", respostas: await respostasCertas(q.json.perguntas) }), 409, "quiz-expirado");
  const nova = await HAB("iniciar", { categoria: "flv" }); ok(nova); assert.equal(nova.json.validoSeg, 0);
});

t("conteúdo editado pelo admin invalida sessões em andamento; promotor não forja habilitação pelo perfil", async () => {
  await semear(); await publicar("flv"); await iniciarEAssistir("flv");
  const q = await HAB("questionario", { categoria: "flv" }); ok(q);
  await publicar("flv", { perguntas: PERGUNTAS.slice(1, 4) });                                         // admin troca as perguntas
  falha(await HAB("responder", { categoria: "flv", respostas: [0, 0, 0] }), 409, "conteudo-alterado");
  ok(await chamar("PUT", "/perfil/promotor/privado", { token: "prom1", body: { telefone: "(19) 91234-5678", habilitacoes: { flv: { elite: true } } } }));
  assert.equal((await get("profissionais", "prom1")).habilitacoes?.flv, undefined, "mass assignment: habilitacoes só o servidor escreve");
  falha(await chamar("POST", "/habilitacoes/iniciar", { token: "lojaA", body: { categoria: "flv" } }), 403, "sem-permissao");
  falha(await chamar("GET", "/habilitacoes", {}), 401);
});

t("aceite filtrado por categoria: só os setores em que está habilitado; Bebidas segue Mercearia; menor ainda tem as travas de idade", async () => {
  await semear({ treinado: true });                                                                       // habilitado só em Mercearia
  const merc = await pedido(), frios = await pedido({ foco: "Frios & Laticínios", data: dia(3) }), padaria = await pedido({ foco: "Padaria", data: dia(4) }), beb = await pedido({ foco: "Bebidas", data: dia(5) });
  for (const [sid, cat] of [[frios, "frios"], [padaria, "padaria"]]) { const r = await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: sid } }); falha(r, 403, "categoria-pendente"); assert.equal(r.json.detalhe.categoria, cat); assert.equal((await get("solicitacoes", sid)).status, "aberta"); }
  ok(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: merc } }));
  ok(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: beb } }));            // "Bebidas" é tratado como Mercearia
  const ant = (a) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - a); d.setUTCDate(d.getUTCDate() - 30); return d.toISOString().slice(0, 10); };
  await semear({ uid: "prom2", nascimento: ant(17), treinado: true, responsavel: true, cpfn: 2 });
  await ctx.db.collection("profissionais").doc("prom2").set({ habilitacoes: { padaria: { em: new E.Timestamp(Date.now()), tentativas: 1, elite: true } } }, { merge: true });
  const pad = await chamar("POST", "/aceitarTurno", { token: "prom2", body: { solicitacaoId: padaria } });
  falha(pad, 403, "menor-setor");                                                                          // habilitado em Padaria, mas é vedada a menores de 18
  const sit = await chamar("GET", "/habilitacao", { token: "prom1" }); assert.deepEqual(sit.json.categorias.sort(), ["mercearia"]);
});

// ---------- Prova por módulo (perguntas/alternativas; correção só no servidor) ----------
const PERGS = [{ enunciado: "Qual a regra do PVPS?", alternativas: ["Primeiro a vencer, primeiro a sair", "Último a chegar, primeiro a sair", "Tanto faz"], correta: 0 }, { enunciado: "Ao achar produto vencido você deve?", alternativas: ["Esconder", "Avisar o responsável", "Vender mesmo assim"], correta: 1 }];
async function moduloComProva(extra = {}) { await modulo(); await ctx.db.collection("treinamento_modulos").doc("m1").set({ perguntas: PERGS, notaMinima: 100, ...extra }, { merge: true }); }
t("prova: só depois de assistir; gabarito nunca vai ao promotor; reprova sem revelar; aprova e habilita", async () => {
  await semear({ uid: "prom1" }); await moduloComProva();
  falha(await chamar("GET", "/treinamento/modulos/m1/prova", { token: "prom1" }), 403, "assista-primeiro");
  await set("treinamento_progresso", "prom1_m1", { uid: "prom1", moduloId: "m1", validoSeg: 95, videoOk: true });
  const q = await chamar("GET", "/treinamento/modulos/m1/prova", { token: "prom1" }); ok(q);
  assert.equal(q.json.perguntas.length, 2); assert.ok(!JSON.stringify(q.json).includes("correta"), "o gabarito não pode vazar");
  const tr = await chamar("GET", "/treinamento", { token: "prom1" }); ok(tr); assert.ok(!JSON.stringify(tr.json).includes("correta"));
  assert.equal(tr.json.completo, false, "vídeo visto mas prova pendente: ainda não habilita");
  const ruim = await chamar("POST", "/treinamento/modulos/m1/prova", { token: "prom1", body: { respostas: [1, 1] } }); ok(ruim);
  assert.equal(ruim.json.aprovado, false); assert.equal(ruim.json.erradas, undefined, "não revela quais erraram");
  assert.notEqual(E.claimsStore.prom1.treinado, true);
  falha(await chamar("POST", "/treinamento/modulos/m1/prova", { token: "prom1", body: { respostas: [0] } }), 400, "dados-invalidos");
  const bom = await chamar("POST", "/treinamento/modulos/m1/prova", { token: "prom1", body: { respostas: [0, 1] } }); ok(bom);
  assert.equal(bom.json.aprovado, true); assert.equal(bom.json.treinamentoCompleto, true); assert.equal(E.claimsStore.prom1.treinado, true);
  assert.equal((await chamar("POST", "/treinamento/modulos/m1/prova", { token: "prom1", body: { respostas: [0, 1] } })).json.jaAprovado, true);
});
t("prova: módulo antigo (sem perguntas) segue valendo só com o vídeo; curso opcional não trava a habilitação", async () => {
  await semear({ uid: "prom1" }); await concluirTreino("prom1");
  await set("treinamento_modulos", "c1", { ordem: 2, titulo: "Curso", provedor: "youtube", videoRef: "abcdefghijk", duracaoSeg: 100, ativo: true, obrigatorio: false, categoria: "perdas", perguntas: PERGS });
  const tr = await chamar("GET", "/treinamento", { token: "prom1" }); ok(tr); assert.equal(tr.json.completo, true);
  assert.equal(tr.json.modulos.find((m) => m.id === "c1").temProva, true); assert.equal(tr.json.modulos.find((m) => m.id === "m1").temProva, false);
});
t("prova: o admin cadastra módulo com perguntas e a validação barra dados ruins", async () => {
  const base = { ordem: 3, titulo: "Módulo com prova", provedor: "youtube", videoRef: "abcdefghijk", duracaoSeg: 120, obrigatorio: false, categoria: "atendimento" };
  ok(await chamar("POST", "/admin/treinamento/modulos", { token: "adm", body: { ...base, perguntas: PERGS } }), "admin salva com prova");
  falha(await chamar("POST", "/admin/treinamento/modulos", { token: "adm", body: { ...base, perguntas: [{ enunciado: "Pergunta sem alternativas", alternativas: ["só uma"], correta: 0 }] } }), 400);
  falha(await chamar("POST", "/admin/treinamento/modulos", { token: "adm", body: { ...base, perguntas: [{ enunciado: "Correta fora do intervalo", alternativas: ["a", "b"], correta: 5 }] } }), 400);
  falha(await chamar("POST", "/admin/treinamento/modulos", { token: "prom1", body: { ...base } }), 403);
  const l = await chamar("GET", "/admin/treinamento/modulos", { token: "adm" }); ok(l); assert.ok(l.json.some((m) => m.perguntas?.length === 2 && m.categoria === "atendimento"));
});

// ---------- Check-in / check-out ----------
const spMin = () => { const [h, m] = new Date().toLocaleTimeString("en-GB", { timeZone: "America/Sao_Paulo", hour12: false, hour: "2-digit", minute: "2-digit" }).split(":").map(Number); return (h % 24) * 60 + m; };
const hhmm = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
async function turnoHoje(id, extra = {}) { const ini = Math.max(0, spMin() - 5); await set("solicitacoes", id, { uid: "lojaA", loja: "Loja X", promotorUid: "prom1", status: "aceita", data: V.hojeSP(), entrada: hhmm(ini), saida: hhmm(Math.min(1439, ini + 240)), minutos: 240, ...extra }); }
// (o check-in/out por /turnos foi substituído pelo check-in com geofence e foto de test/jogo.test.cjs)
// ---------- Painel admin: resumo financeiro e auditoria de exportações ----------
t("admin: resumo financeiro (saques parados, sem dados de Pix) e registro de exportação na auditoria", async () => {
  await set("saques", "q1", { uid: "prom1", status: "solicitado", valorCentavos: 5000, criadoEm: new E.Timestamp(Date.now() - 3 * 3600_000), pixEnc: "x" });
  await set("saques", "q2", { uid: "prom2", status: "pago", valorCentavos: 9999, criadoEm: new E.Timestamp(Date.now()) });
  const r = await chamar("GET", "/admin/financeiro/resumo", { token: "adm" }); ok(r);
  assert.equal(r.json.saquesAbertos.qtd, 1); assert.equal(r.json.saquesAbertos.valorCentavos, 5000); assert.ok(r.json.saquesAbertos.maisAntigoEm);
  assert.ok(!JSON.stringify(r.json).includes("pix"), "sem dados de Pix");
  falha(await chamar("GET", "/admin/financeiro/resumo", { token: "prom1" }), 403); falha(await chamar("GET", "/admin/financeiro/resumo", { token: "lojaA" }), 403);
  ok(await chamar("POST", "/admin/auditar-exportacao", { token: "adm", body: { tipo: "missoes", linhas: 42 } }));
  falha(await chamar("POST", "/admin/auditar-exportacao", { token: "adm", body: { tipo: "../../etc/passwd" } }), 400);
  falha(await chamar("POST", "/admin/auditar-exportacao", { token: "prom1", body: { tipo: "missoes" } }), 403);
  const aud = await chamar("GET", "/admin/auditoria?limite=50", { token: "adm" }); ok(aud);
  assert.ok(aud.json.some((a) => a.acao === "admin.exportar" && a.alvo === "missoes"), "a exportação ficou no log");
});

// ---------- Suporte: perfil 360 do atendente ----------
t("suporte: perfil 360 da loja e do promotor (só admin), CPF mascarado, histórico, pré-carga leve sem auditoria", async () => {
  await semear({ uid: "prom1", status: "ativo", treinado: true });
  await set("usuarios", "prom1", { email: "p@x.com" });
  await set("profissionais", "prom1", { uid: "prom1", nome: "Profissional prom1", status: "ativo", cidade: "Itapira", ratingMedia: 4.8 });
  await set("contratantes", "lojaA", { uid: "lojaA", razaoSocial: "Mercado A", documento: "12345678000190", ramo: "Mercado", endereco: "Rua 1", criadoEm: new E.Timestamp(Date.now()) });
  await set("cartoes", "lojaA", { uid: "lojaA", status: "ativo", ultimos4: "1234" });
  await set("solicitacoes", "s1", { uid: "lojaA", promotorUid: "prom1", promotorNome: "Profissional prom1", loja: "Mercado A", status: "concluida", data: dia(-1), foco: "Mercearia", criadoEm: new E.Timestamp(Date.now() - 1000) });
  await set("solicitacoes", "s2", { uid: "lojaA", status: "aberta", data: dia(3), foco: "Bebidas", criadoEm: new E.Timestamp(Date.now()) });
  ok(await chamar("POST", "/suporte/mensagem", { token: "lojaA", body: { texto: "Preciso de ajuda." } }));
  ok(await chamar("POST", "/suporte/mensagem", { token: "prom1", body: { texto: "Não consigo aceitar turno." } }));

  // RBAC: só admin
  falha(await chamar("GET", "/admin/suporte/lojaA/perfil", { token: "lojaA" }), 403); falha(await chamar("GET", "/admin/suporte/prom1/perfil", { token: "prom1" }), 403);
  falha(await chamar("GET", "/admin/suporte/naoexiste/perfil", { token: "adm" }), 404);

  const l = await chamar("GET", "/admin/suporte/lojaA/perfil", { token: "adm" }); ok(l);
  assert.equal(l.json.tipo, "loja"); assert.equal(l.json.cadastro.nome, "Mercado A"); assert.equal(l.json.cadastro.cartao, "ativo");
  assert.equal(l.json.historico.total, 2); assert.equal(l.json.historico.porStatus.concluida, 1); assert.equal(l.json.historico.ultimos[0].status, "aberta", "mais recente primeiro");
  assert.ok(!JSON.stringify(l.json).includes("ultimos4"), "não expõe dados do cartão além do status");

  const p = await chamar("GET", "/admin/suporte/prom1/perfil", { token: "adm" }); ok(p);
  assert.equal(p.json.tipo, "promotor"); assert.equal(p.json.email, "p@x.com"); assert.equal(p.json.cadastro.cidade, "Itapira"); assert.equal(p.json.historico.total, 1);
  assert.ok(p.json.cadastro.cpfMascarado && !p.json.cadastro.cpfMascarado.includes(cpf(0)), "CPF vem mascarado"); assert.equal(p.json.parcial, false);
  assert.equal(p.json.conversa.mensagens, 1);

  const antes = [...E.store.keys()].filter((k) => k.startsWith("auditoria/")).length;
  const leve = await chamar("GET", "/admin/suporte/prom1/perfil?leve=1", { token: "adm" }); ok(leve);
  assert.equal(leve.json.parcial, true); assert.equal(leve.json.cadastro.cpfMascarado, ""); assert.equal(leve.json.cadastro.telefone, "", "pré-carga não decifra dados pessoais");
  assert.equal([...E.store.keys()].filter((k) => k.startsWith("auditoria/")).length, antes, "pré-carga não gera auditoria");
  const aud = [...E.store.values()].filter((v) => v.acao === "admin.suporte.ver_perfil"); assert.equal(aud.length, 2, "abrir o perfil (não a pré-carga) é auditado");
});

t("cadastro de promotor: sem CPF/nascimento → 400; dados já gravados são reaproveitados; conta já cadastrada não dá erro", async () => {
  const corpo = { termos: true, nome: "Fulano", telefone: "19999990000" };
  falha(await chamar("POST", "/cadastro/promotor", { token: "novo", body: corpo }), 400, "dados-invalidos");
  await set("profissionais_privado", "novo1", { uid: "novo1", cpfEnc: enc("novo1", "cpf", cpf(0)), cpfIdx: Cripto.indiceCego(cpf(0)), nascimentoEnc: enc("novo1", "nascimento", "1995-05-20") });   // cadastro interrompido antes
  const r = await chamar("POST", "/cadastro/promotor", { token: "novo", body: corpo }); ok(r, "reaproveita dados gravados");
  assert.equal((await get("profissionais", "novo1")).status, "pendente");
  const r2 = await chamar("POST", "/cadastro/promotor", { token: "novo", body: { termos: true } }); ok(r2); assert.equal(r2.json.jaCadastrado, true);   // sem CPF no corpo, mas já cadastrado
});

// ============================================================
// COMPROVANTE DE SERVIÇO (layout DANFE simplificado)
// ============================================================
const DANFE = require("../server/lib/danfe");
const EMITIR = (id, token = "lojaA") => chamar("POST", `/nota/${id}/emitir`, { token });
const dvChave = (base43) => { let soma = 0, peso = 2; for (let i = 42; i >= 0; i--) { soma += Number(base43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; } const r = soma % 11; return r < 2 ? 0 : 11 - r; };
const chaveValida = (base = "3526040000000000000055001000000123100000123") => base + dvChave(base);
/** decodifica as larguras de volta para texto, conferindo início, parada e dígito verificador (round-trip do código de barras) */
function decodificarBarras(modulos) {
  const sim = []; for (let i = 0; i < modulos.length - 7; i += 6) sim.push(DANFE.PADROES.indexOf(modulos.slice(i, i + 6).join("")));
  assert.equal(modulos.slice(-7).join(""), "2331112", "padrão de parada"); assert.ok(sim.every((c) => c >= 0), "todos os símbolos existem");
  const dv = sim.pop(), soma = sim.reduce((a, c, i) => a + (i === 0 ? c : c * i), 0) % 103; assert.equal(dv, soma, "dígito verificador do Code 128");
  const [ini, ...dados] = sim; return ini === 105 ? dados.map((c) => String(c).padStart(2, "0")).join("") : dados.map((c) => String.fromCharCode(c + 32)).join("");
}
async function notaPaga() { const sid = await cenarioPago(); return { sid, notaId: (await get("solicitacoes", sid)).notaId }; }

t("comprovante: a loja dona emite; itens fecham com o total; documento sem valor fiscal; código de barras decodifica", async () => {
  const { sid, notaId } = await notaPaga(); assert.ok(notaId);
  const r = await EMITIR(notaId); ok(r); const d = r.json;
  assert.equal(d.modo, "comprovante"); assert.equal(d.semValorFiscal, true); assert.equal(d.marcaDagua, "SEM VALOR FISCAL"); assert.equal(d.codigo.rotulo, "CÓDIGO DE VERIFICAÇÃO"); assert.equal(d.via, 1); assert.equal(d.estornado, false);
  assert.equal(d.identificacao.numeroFmt, "000001"); assert.equal(d.identificacao.serie, "A1"); assert.equal(d.emitente.cnpj, "00.000.000/0001-00");
  const nv = (await get("notas", notaId)).valores;
  assert.equal(d.itens.reduce((a, i) => a + i.totalCentavos, 0), d.calculo.totalCentavos); assert.equal(d.calculo.totalCentavos, 20000); assert.deepEqual(d.itens.map((i) => i.totalCentavos), [nv.valor, nv.taxaFixa].filter((v) => v > 0), JSON.stringify(nv));
  assert.equal(d.calculo.valorServicosCentavos + d.calculo.taxaServicoCentavos, d.calculo.totalCentavos); assert.equal(d.pagamento.status, "pago");
  assert.ok(/^\d{24}$/.test(d.codigo.valor), "24 dígitos, nunca 44 (não imita chave de acesso)"); assert.equal(decodificarBarras(d.codigo.barras.modulos), d.codigo.valor);
  assert.equal(d.codigo.barras.total, d.codigo.barras.modulos.reduce((a, b) => a + b, 0)); assert.ok(!/"[a-zA-Z]*[uU]id"/.test(JSON.stringify(d)), "sem campos de uid no documento"); assert.ok(!/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(JSON.stringify(d)), "sem CPF completo");
  assert.match(d.adicionais.join(" "), /NÃO substitui nota fiscal/);
  assert.equal((await EMITIR(notaId)).json.via, 2, "2ª via"); assert.equal((await get("notas", notaId)).emissoes, 2);
  assert.equal((await get("notas", notaId)).valores.total, 20000, "a emissão não altera o snapshot da nota");
  assert.ok((await ctx.db.collection("auditoria").get()).docs.some((x) => x.data().acao === "nota.emitir"), "emissão auditada");
});

t("comprovante: nota alheia = 404, promotor = 403, sem login = 401, admin pode, id inválido = 400", async () => {
  const { notaId } = await notaPaga();
  falha(await EMITIR(notaId, "lojaB"), 404, "nao-encontrado"); falha(await EMITIR(notaId, "prom1"), 403, "sem-permissao"); falha(await chamar("POST", `/nota/${notaId}/emitir`, {}), 401);
  falha(await EMITIR("a$b%20c", "lojaA"), 400); falha(await EMITIR("naoexisteNota123"), 404, "nao-encontrado"); assert.equal((await get("notas", notaId)).emissoes, undefined, "tentativas negadas não contam via");
  const a = await EMITIR(notaId, "adm"); if (a.status === 200) assert.equal(a.json.identificacao.numeroFmt, "000001"); else falha(a, 403, "mfa-obrigatorio");
});

t("comprovante mostra o ESTORNO em tempo real e continua válido na verificação (marcado como estornado)", async () => {
  const { sid, notaId } = await notaPaga(); const antes = (await EMITIR(notaId)).json; mpMock({ "POST /v1/payments/777/refunds": { id: 5 }, "GET /v1/payments/777": pgMP(sid) });
  ok(await chamar("POST", `/admin/pedidos/${sid}/estornar`, { token: "adm", body: { motivo: "teste de estorno" } }));
  const d = (await EMITIR(notaId)).json; assert.equal(d.estornado, true, JSON.stringify(d.pagamento) + JSON.stringify(await get("pagamentos_internos", sid))); assert.equal(d.pagamento.status, "estornado"); assert.equal(d.codigo.valor, antes.codigo.valor, "o código não muda com o estorno");
  const v = await chamar("POST", "/nota/verificar", { body: { id: notaId, codigo: antes.codigo.verificacao } }); ok(v); assert.equal(v.json.valida, true); assert.equal(v.json.estornado, true);
});

t("verificação pública: só o código correto valida; adulteração e entradas estranhas não", async () => {
  const { notaId } = await notaPaga(); const d = (await EMITIR(notaId)).json, V1 = (codigo, id = notaId) => chamar("POST", "/nota/verificar", { body: { id, codigo } });
  let r = await V1(d.codigo.verificacao); ok(r); assert.equal(r.json.valida, true, JSON.stringify({ id: notaId, cod: d.codigo.verificacao })); assert.deepEqual(Object.keys(r.json).sort(), ["emitidaEm", "estornado", "numeroFmt", "serie", "valida"], JSON.stringify(r.json)); assert.equal(r.json.valida, true); assert.equal(r.json.numeroFmt, "000001");
  assert.equal((await V1(d.codigo.valor)).json.valida, true, "aceita com ou sem espaços");
  const trocado = d.codigo.valor.slice(0, 23) + ((Number(d.codigo.valor[23]) + 1) % 10); assert.equal((await V1(trocado)).json.valida, false);
  assert.equal((await V1(d.codigo.valor, "outraNota12345")).json.valida, false); assert.equal((await V1("123")).json.valida, false);
  for (const id of [{ $ne: 1 }, "../x", "", null]) { const x = await chamar("POST", "/nota/verificar", { body: { id, codigo: d.codigo.valor } }); ok(x); assert.equal(x.json.valida, false); }
  await ctx.db.collection("notas").doc(notaId).set({ valores: { valor: 15000, taxaFixa: 5000, total: 25000 } }, { merge: true });          // adulteração no banco
  assert.equal((await V1(d.codigo.valor)).json.valida, false, "valor alterado invalida o código");
  falha(await EMITIR(notaId), 409, "nota-inconsistente");
});

t("documento fiscal: só com chave de 44 dígitos válida + protocolo + data de autorização; senão continua sem valor fiscal", async () => {
  const { notaId } = await notaPaga(), base = (await get("notas", notaId)), chave = chaveValida(); assert.ok(DANFE.chaveAcessoValida(chave)); assert.ok(!DANFE.chaveAcessoValida(chave.slice(0, 43) + ((Number(chave[43]) + 1) % 10)));
  const fisc = (f) => ctx.db.collection("notas").doc(notaId).set({ ...base, fiscal: f ? { documento: f } : { nfse: null } });
  await fisc({ chaveAcesso: chave.slice(0, 43) + ((Number(chave[43]) + 1) % 10), protocolo: "135260000000001", autorizadaEm: new E.Timestamp(Date.now()) }); assert.equal((await EMITIR(notaId)).json.modo, "comprovante", "DV inválido não vira fiscal");
  await fisc({ chaveAcesso: chave, protocolo: "123", autorizadaEm: new E.Timestamp(Date.now()) }); assert.equal((await EMITIR(notaId)).json.modo, "comprovante", "sem protocolo não vira fiscal");
  await fisc({ chaveAcesso: chave, protocolo: "135260000000001" }); assert.equal((await EMITIR(notaId)).json.modo, "comprovante", "sem data de autorização não vira fiscal");
  await fisc({ chaveAcesso: chave, protocolo: "135260000000001", autorizadaEm: new E.Timestamp(Date.now()), ambiente: "producao" });
  let d = (await EMITIR(notaId)).json; assert.equal(d.modo, "fiscal"); assert.equal(d.semValorFiscal, false); assert.equal(d.marcaDagua, ""); assert.equal(d.codigo.rotulo, "CHAVE DE ACESSO"); assert.equal(d.codigo.valor, chave); assert.equal(decodificarBarras(d.codigo.barras.modulos), chave); assert.equal(d.codigo.protocolo, "135260000000001");
  await fisc({ chaveAcesso: chave, protocolo: "135260000000001", autorizadaEm: new E.Timestamp(Date.now()), ambiente: "homologacao" }); d = (await EMITIR(notaId)).json; assert.equal(d.semValorFiscal, true); assert.match(d.marcaDagua, /HOMOLOGAÇÃO/);
});

t("Code 128: tabela íntegra, B e C, e limites", async () => {
  assert.equal(DANFE.PADROES.length, 107); for (const p of DANFE.PADROES.slice(0, 106)) assert.equal(p.split("").reduce((a, b) => a + Number(b), 0), 11); assert.equal(DANFE.PADROES[106].split("").reduce((a, b) => a + Number(b), 0), 13);
  for (const txt of ["12", "123456789012345678901234", "Hello-World 42", "123", "A1b2~"]) assert.equal(decodificarBarras(DANFE.code128(txt).modulos), txt);
  assert.throws(() => DANFE.code128("")); assert.throws(() => DANFE.code128("ação")); assert.throws(() => DANFE.code128("1".repeat(81)));
  assert.equal(DANFE.agrupar("123456789012"), "1234 5678 9012");
});


(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    reset(); const log = console.warn; console.warn = () => {}; const err = console.error; console.error = () => {};
    try { await fn(); console.log = console.log; process.stdout.write(`  ✓ ${nome}\n`); }
    catch (e) { falhas++; process.stdout.write(`  ✗ ${nome}\n      ${String(e.stack || e).split("\n").slice(0, 4).join("\n      ")}\n`); }
    finally { console.warn = log; console.error = err; }
  }
  E.restaurarRelogio(); process.stdout.write(`\n${testes.length - falhas}/${testes.length} testes do backend passaram\n`); process.exit(falhas ? 1 : 0);
})();
