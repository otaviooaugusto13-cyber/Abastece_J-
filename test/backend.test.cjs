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
  E.clock.now = Date.now(); ctx.__reset?.();
}
const set = (col, id, d) => ctx.db.collection(col).doc(id).set(d);
const get = async (col, id) => (await ctx.db.collection(col).doc(id).get()).data();
const ok = (r, msg = "") => assert.equal(r.status, 200, `${msg} esperado 200, veio ${r.status} ${JSON.stringify(r.json)}`);
const falha = (r, status, codigo) => { assert.equal(r.status, status, `esperado ${status}/${codigo}, veio ${r.status} ${JSON.stringify(r.json)}`); if (codigo) assert.equal(r.json.codigo, codigo); };
const Cripto = ctx.Cripto;
const enc = (uid, campo, v) => Cripto.cifrar(v, `profissionais_privado/${campo}/${uid}`);

async function semear({ uid = "prom1", nascimento = "1995-05-20", status = "ativo", responsavel = false, cpfn = 0, treinado = false } = {}) {
  await set("profissionais", uid, { uid, nome: "Profissional " + uid, status, treinamentoOk: false });
  await set("profissionais_privado", uid, { uid, cpfEnc: enc(uid, "cpf", cpf(cpfn)), cpfIdx: Cripto.indiceCego(cpf(cpfn)), nascimentoEnc: enc(uid, "nascimento", nascimento), pixEnc: enc(uid, "pix", { tipo: "CPF", chave: cpf(cpfn) }), pixTipo: "CPF",
    ...(responsavel ? { responsavelEnc: enc(uid, "responsavel", { nome: "Maria Responsável", cpf: cpf(1), telefone: "19999990000", parentesco: "Mãe" }), autorizacaoResponsavelEm: new E.Timestamp(Date.now()) } : {}) });
  if (treinado) await concluirTreino(uid);
}
async function modulo(id = "m1", ordem = 1, dur = 100) { await set("treinamento_modulos", id, { ordem, titulo: "Módulo " + id, provedor: "youtube", videoRef: "abcdefghijk", duracaoSeg: dur, ativo: true }); }
async function concluirTreino(uid) { await modulo(); await set("treinamento_progresso", `${uid}_m1`, { uid, moduloId: "m1", validoSeg: 100, concluido: true }); }
async function lojaComCartao(uid = "lojaA") { await set("contratantes", uid, { uid, razaoSocial: "Mercado " + uid }); await set("cartoes", uid, { uid, status: "ativo", ultimos4: "1234" }); }
async function pedido(over = {}) {
  await lojaComCartao();
  const r = await chamar("POST", "/criarPedido", { token: "lojaA", body: { loja: "Mercado A — Rua 1", data: dia(2), entrada: "08:00", saida: "12:00", foco: "Mercearia", ...over } });
  ok(r, "criarPedido"); return r.json.id;
}
const mpMock = (map) => { global.fetch = async (url, init = {}) => { const k = `${init.method || "GET"} ${String(url).replace("https://api.mercadopago.com", "")}`; const h = map[k] ?? Object.entries(map).find(([p]) => k.startsWith(p))?.[1]; if (!h) return { ok: false, status: 404, json: async () => ({}) }; const v = typeof h === "function" ? h(init) : h; return { ok: true, status: 200, json: async () => v }; }; };
const pgMP = (sid, over = {}) => ({ id: 777, status: "approved", external_reference: sid, currency_id: "BRL", transaction_amount: 200, payment_type_id: "credit_card", fee_details: [{ type: "mercadopago_fee", amount: 7.9 }], ...over });
async function pagar(sid, over = {}) { mpMock({ "GET /v1/payments/777": pgMP(sid, over) }); return chamar("POST", "/confirmarPagamento", { token: "lojaA", body: { solicitacaoId: sid, paymentId: "777" } }); }
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
  await semear({ treinado: true }); const sid = await pedido(); ok(await chamar("POST", "/aceitarTurno", { token: "prom1", body: { solicitacaoId: sid } }));
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
  for (const col of ["profissionais_privado", "pagamentos_internos", "carteiras", "lancamentos", "saques", "treinamento_progresso", "auditoria"]) assert.ok(new RegExp("match \\/" + col + "\\/\\{\\w+\\}\\s*\\{ allow read, write: if false;").test(rules), col);
  const upd = /match \/profissionais\/\{uid\}[\s\S]*?allow update:[\s\S]*?soMuda\(\[([^\]]*)\]\)/.exec(rules)[1];
  for (const proibido of ["status", "treinamentoOk", "role", "ratingMedia", "refCode"]) assert.ok(!upd.includes(`'${proibido}'`), `cliente não pode alterar ${proibido}`);
  assert.match(rules, /treinado\(\) && resource\.data\.status == 'aberta'/);
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
t("vaga herda cidade e coordenadas da loja (servidor); o cliente não consegue forçar coordenadas no pedido", async () => {
  await set("contratantes", "lojaA", { uid: "lojaA", razaoSocial: "Mercado A", cidade: "Itapira", uf: "SP", lat: -22.4358, lng: -46.8231 }); await set("cartoes", "lojaA", { uid: "lojaA", status: "ativo", ultimos4: "1234" });
  const r = await chamar("POST", "/criarPedido", { token: "lojaA", body: { loja: "Mercado A — Rua 1", data: dia(2), entrada: "08:00", saida: "12:00", foco: "Mercearia", lat: 0, lng: 0, cidade: "Outra" } }); ok(r);
  const v = await get("solicitacoes", r.json.id); assert.deepEqual([v.cidade, v.uf, v.lat, v.lng], ["Itapira", "SP", -22.4358, -46.8231]);
});
t("vaga sem localização válida da loja é criada sem coordenadas (coordenada fora do Brasil é descartada)", async () => {
  await set("contratantes", "lojaA", { uid: "lojaA", razaoSocial: "Mercado A", cidade: "Lugar", lat: 48.85, lng: 2.35 }); await set("cartoes", "lojaA", { uid: "lojaA", status: "ativo", ultimos4: "1234" });
  const r = await chamar("POST", "/criarPedido", { token: "lojaA", body: { loja: "Mercado A — Rua 1", data: dia(2), entrada: "08:00", saida: "12:00", foco: "Mercearia" } }); ok(r);
  const v = await get("solicitacoes", r.json.id); assert.equal(v.lat, undefined); assert.equal(v.cidade, undefined);
});
t("regras do Firestore: loja grava localização só com números dentro do Brasil; promotor continua sem poder gravar perfil inteligente", async () => {
  const fs = require("node:fs"), rules = fs.readFileSync(require("node:path").join(__dirname, "../firestore.rules"), "utf8");
  const lojaUpd = /match \/contratantes\/\{uid\}[\s\S]*?allow update:[\s\S]*?soMuda\(\[([^\]]*)\]\)/.exec(rules)[1];
  for (const c of ["cidade", "uf", "lat", "lng"]) assert.ok(lojaUpd.includes(`'${c}'`), c);
  assert.match(rules, /lat is number && request\.resource\.data\.lat >= -34/); assert.match(rules, /lng is number && request\.resource\.data\.lng >= -74/);
  const promUpd = /match \/profissionais\/\{uid\}[\s\S]*?allow update:[\s\S]*?soMuda\(\[([^\]]*)\]\)/.exec(rules)[1];
  for (const c of ["eneagrama", "experiencias", "palavrasChave", "areasExperiencia"]) assert.ok(!promUpd.includes(`'${c}'`), c);
});
t("cabeçalhos: geolocalização liberada só para a própria origem; câmera e microfone seguem bloqueados", async () => {
  const Seg = ctx.Seg || require("../server/lib/seguranca.js"), hs = {}; Seg.cabecalhos()({}, { setHeader: (k, v) => (hs[k] = v), removeHeader() {} }, () => {});
  const pp = hs["Permissions-Policy"]; assert.match(pp, /geolocation=\(self\)/); assert.match(pp, /camera=\(\)/); assert.match(pp, /microphone=\(\)/);
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
