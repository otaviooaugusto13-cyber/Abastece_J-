// Bateria do módulo CS & B2B: agregações puras (fill rate, vagas, CSAT, pontualidade, ROI, ruptura, churn, faturamento, NPS, setores, escopo),
// exportador (CSV/HTML/PPTX) e as rotas /cs/* (RBAC, ficha, fotos, faturamento, recorrências, NPS, cron, auditoria). Sem rede (ver fake-env.cjs).
const crypto = require("node:crypto");
process.env.AMBIENTE = "teste"; process.env.MODO_TESTE = "1"; process.env.APP_URL = "https://app.exemplo.com";
process.env.MP_ACCESS_TOKEN = "APP_USR-teste"; process.env.MP_WEBHOOK_SECRET = "segredo-webhook"; process.env.CRON_SECRET = "cron-secreto";
process.env.DATA_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString("base64")}`; process.env.DATA_ENCRYPTION_KEY_ID = "1"; process.env.BLIND_INDEX_KEY = crypto.randomBytes(32).toString("base64");
const assert = require("node:assert/strict");
const A = require("../server/lib/cs/agregacao");
const T = require("../server/lib/cs/tipos");
const R = require("../server/lib/cs/relatorio");
const E = require("./fake-env.cjs");
const { ctx, chamar } = E.carregarServidor();

const P = { ...T.PARAMETROS_PADRAO };
const AGORA = A.instanteSP("2026-11-03", "15:00"), HOJE = "2026-11-03";
const ts = (m) => new E.Timestamp(m);
const dia = (n) => A.somaDias(HOJE, n);
let seq = 0;
/** Documento de `solicitacoes` pronto (padrão: turno executado, no prazo, 5 estrelas, gôndola cheia). */
function doc(o = {}) {
  const data = o.data || dia(-2), entrada = o.entrada || "08:00", saida = o.saida || "12:00", ini = A.instanteSP(data, entrada), exec = o.exec !== false;
  return { uid: o.uid || "lojaA", loja: o.loja || "Mercado Alfa", data, entrada, saida, minutos: 240, foco: o.foco || "Mercearia", status: o.status || (exec ? "paga" : "aberta"), tipo: o.tipo || "padrao",
    criadoEm: ts(o.criadoEm ?? ini - 2 * A.DIA), regiao: { cidade: "Campinas", uf: "SP" }, ...(o.marcaId ? { marcaId: o.marcaId, marcaNome: o.marcaNome || "Marca X" } : {}),
    ...(o.promotorUid !== undefined || exec || o.status === "aceita" ? { promotorUid: o.promotorUid || "prom1", promotorNome: o.promotorNome || "Paulo Souza", promotorNivel: "prata", aceitoEm: ts(ini - 3600_000) } : {}),
    ...(exec ? { fase: "executada", checkin: { em: ts(ini + (o.atraso || 0) * 60_000) }, checkinAtrasoMin: o.atraso || 0, checkout: { em: ts(ini + 240 * 60_000), minutosNoLocal: 240, gondola: o.gondola || "cheia" } } : {}),
    ...(exec && o.estrelas !== null ? { avaliacao: { estrelas: o.estrelas || 5, comentario: o.comentario || "", em: ts(ini + 5 * 3600_000) } } : {}), ...(o.expiraEm ? { expiraEm: ts(o.expiraEm) } : {}) };
}
const P1 = (o = {}, total = 20000, rede = null) => A.normalizarPedido(`p${++seq}`, doc(o), total, rede);
const lojaBase = (uid, extra = {}) => ({ lojaUid: uid, nome: `Loja ${uid}`, redeId: null, criadoEm: AGORA - 400 * A.DIA, ativo: true, cidade: "", gerente: "", ...extra });
const base = (extra = {}) => ({ pedidos: [], lojas: [], redes: [], envios: [], lancamentos: [], lojasComAcao: [], params: P, agora: AGORA, truncado: false, ...extra });
const J = A.janelaDe(30, AGORA, P.toleranciaPontualMin);

const testes = []; const t = (nome, fn) => testes.push([nome, fn]);

// ======================= agregações puras =======================
t("Fill rate: denominador = encerradas (sem canceladas/futuras); separa 'sem promotor' de 'aceitou e faltou'; no prazo respeita a tolerância", () => {
  const ps = [...[0, 0, 5, 25, 0, 0].map((a) => P1({ atraso: a })), P1({ exec: false, status: "aceita", promotorUid: "prom1" }), P1({ exec: false, status: "aceita", promotorUid: "prom1" }), P1({ exec: false }), P1({ exec: false }),
    P1({ exec: false, status: "cancelada" }), P1({ exec: false, data: dia(3) })];
  const f = A.fillRate(ps, J, 90);
  assert.equal(f.abertas, 10, "turno futuro está fora do período"); assert.equal(f.encerradas, 10); assert.equal(f.concluidas, 6); assert.equal(f.aceitas, 8);
  assert.equal(f.semPromotor, 2); assert.equal(f.faltaPromotor, 2); assert.equal(f.fillRate, 60); assert.equal(f.noPrazo, 5); assert.equal(f.fillRateNoPrazo, 50); assert.equal(f.taxaAceite, 80);
  assert.equal(f.serie.length, 1); assert.equal(f.serie[0].fillRate, 60);
  assert.equal(A.fillRate([], J, 90).fillRate, null, "sem dados = null, nunca 0%");
});
t("Vagas desatendidas: janela X h, severidade, já iniciadas contam, relâmpago expirado e vagas longe ficam de fora", () => {
  const em = (min) => { const i = AGORA + min * 60_000, d = new Date(i - 3 * 3600_000).toISOString(); return { data: d.slice(0, 10), entrada: d.slice(11, 16), saida: new Date(i - 3 * 3600_000 + 4 * 3600_000).toISOString().slice(11, 16) }; };
  const ps = [P1({ exec: false, ...em(180) }), P1({ exec: false, ...em(90) }), P1({ exec: false, ...em(30) }), P1({ exec: false, ...em(-30) }), P1({ exec: false, ...em(300) }),
    P1({ exec: false, tipo: "ruptura", expiraEm: AGORA - 1000, ...em(20) }), P1({ exec: false, status: "aceita", promotorUid: "prom1", ...em(20) })];
  const v = A.vagasDesatendidas(ps, 4, AGORA);
  assert.deepEqual(v.map((x) => x.severidade), ["critica", "critica", "alta", "media"]); assert.deepEqual(v.map((x) => x.minutosParaInicio), [-30, 30, 90, 180]);
  assert.equal(v[0].urgente, true);
});
t("CSAT: média, % satisfeitos (4–5★), distribuição e baixas; comentários só os preenchidos", () => {
  const ps = [5, 5, 4, 3, 2, 1].map((e, i) => P1({ estrelas: e, comentario: i === 4 ? "Atraso" : "" })), c = A.csat(ps, J, 4.5);
  assert.equal(c.total, 6); assert.equal(c.media, 3.33); assert.equal(c.csatPct, 50); assert.equal(c.baixas, 2); assert.equal(c.distribuicao[0].qtd, 2);
  assert.equal(c.comentarios.length, 1); assert.equal(c.comentarios[0].estrelas, 2);
});
t("Pontualidade: tolerância configurável e ranking de promotores (piores primeiro, mín. 2 check-ins)", () => {
  const ps = [P1({ promotorUid: "a", promotorNome: "Ana Lima", atraso: 0 }), P1({ promotorUid: "a", promotorNome: "Ana Lima", atraso: 30 }), P1({ promotorUid: "b", promotorNome: "Bruno Dias", atraso: 0 }), P1({ promotorUid: "b", promotorNome: "Bruno Dias", atraso: 10 }), P1({ promotorUid: "c", atraso: 60 })];
  const p = A.pontualidade(ps, J);
  assert.equal(p.checkins, 5); assert.equal(p.pontuais, 3); assert.equal(p.pct, 60); assert.equal(p.atrasoMedioMin, 45);
  assert.deepEqual(p.promotores.map((x) => [x.nome, x.pct]), [["Ana L.", 50], ["Bruno D.", 100]]);
  assert.equal(A.pontualidade(ps, A.janelaDe(30, AGORA, 0)).pontuais, 2, "tolerância 0 min é mais rígida");
});
t("ROI: contratados equivalentes pela semana de PICO de cada loja (mín. 1); economia pode ser calculada mês a mês", () => {
  const out = "2026-10";
  const ps = [P1({ data: "2026-10-05" }), P1({ data: "2026-10-06" }), P1({ data: "2026-10-12" }), ...Array.from({ length: 10 }, () => P1({ uid: "lojaB", data: "2026-10-07" }))];
  const r = A.roi(ps, P, AGORA), m = r.meses.find((x) => x.mes === out);
  assert.equal(r.meses.length, A.MESES_ROI); assert.equal(m.parcial, false);
  assert.equal(m.turnos, 13); assert.equal(m.horas, 52); assert.equal(m.lojasAtivas, 2);
  assert.equal(m.contratadosEquivalentes, 3, "A: pico 8h → 1; B: pico 40h/35,2h → 2");
  assert.equal(m.onDemandCentavos, 260000); assert.equal(m.fixoEquivalenteCentavos, 1080000); assert.equal(m.economiaCentavos, 820000); assert.equal(m.economiaPct, 75.9);
  const nov = r.meses.find((x) => x.mes === "2026-11"); assert.equal(nov.parcial, true);
  // loja de uso pesado e contínuo: economia NEGATIVA aparece como é (sem maquiar)
  const pesado = Array.from({ length: 5 }, (_, i) => P1({ data: A.somaDias("2026-09-07", i) }));
  assert.ok(A.roi(pesado.map((p) => ({ ...p, totalCentavos: 90000 })), P, AGORA).acumulado.economiaCentavos < 0);
});
t("Ruptura evitada: confirmadas (relâmpago) + estimadas (taxa × reposições cheias); dinheiro só se a premissa existir", () => {
  const ps = [...Array.from({ length: 3 }, () => P1({ tipo: "ruptura" })), ...Array.from({ length: 6 }, () => P1({})), ...Array.from({ length: 2 }, () => P1({ gondola: "parcial" }))];
  const r = A.ruptura(ps, J, P);
  assert.equal(r.chamadosRelampago, 3); assert.equal(r.evitadasConfirmadas, 3); assert.equal(r.evitadasEstimadas, 2); assert.equal(r.evitadasTotal, 5); assert.equal(r.vendaPreservadaCentavos, null);
  assert.equal(r.horas, 44); assert.equal(r.itensRepostosEst, 6600);
  assert.equal(A.ruptura(ps, J, { ...P, receitaPorRupturaCentavos: 10000 }).vendaPreservadaCentavos, 50000);
});
t("Setores: destaque primeiro (Mercearia, Frios, FLV, Depósito, Padaria) e depois os demais; tempo até o aceite", () => {
  const ps = ["Padaria", "Bebidas", "Mercearia", "Depósito", "Montagem de ilhas"].map((foco) => P1({ foco }));
  const s = A.setores(ps, J);
  assert.deepEqual(s.map((x) => x.setor), ["Mercearia", "Depósito", "Padaria", "Bebidas", "Montagem de ilhas"]);
  assert.equal(s[0].tempoAceiteMin, 2 * 24 * 60 - 60, "criado 2 dias antes, aceito 1 h antes do turno");
});
t("Churn: limiares (60% / 100% / 200% do limite), loja nunca ativada, fora da janela, inativa ignorada, ação aberta", () => {
  const criada = (uid, diasAtras) => P1({ uid, criadoEm: AGORA - diasAtras * A.DIA, data: dia(-diasAtras + 1) });
  const ps = [criada("A", 3), criada("B", 10), criada("C", 16), criada("D", 31)];
  const lojas = ["A", "B", "C", "D"].map((u) => lojaBase(u)).concat([lojaBase("E", { criadoEm: AGORA - 10 * A.DIA }), lojaBase("F"), lojaBase("G", { ativo: false })]);
  const c = A.churn(base({ pedidos: ps, lojas, lojasComAcao: ["C"] }));
  assert.deepEqual(c.resumo, { saudavel: 1, atencao: 2, risco: 1, critico: 2 });
  assert.deepEqual(c.itens.map((i) => [i.lojaUid, i.nivel]).slice(0, 2).map((x) => x[1]), ["critico", "critico"]);
  assert.equal(c.itens.find((i) => i.lojaUid === "F").alemDaJanela, true); assert.equal(c.itens.find((i) => i.lojaUid === "E").semNenhumaMissao, true);
  assert.equal(c.itens.find((i) => i.lojaUid === "C").acaoAberta, true); assert.equal(c.itens.find((i) => i.lojaUid === "C").diasSemMissao, 16);
  assert.ok(!c.itens.some((i) => i.lojaUid === "G"));
  assert.equal(A.churn(base({ pedidos: ps, lojas, params: { ...P, inatividadeDias: 40 } })).resumo.risco, 0, "limite configurável");
});
t("Faturamento: pré-pago (saldo = créditos − consumo − comprometido) e pós-pago (uso do ciclo × limite); só valores da LOJA", () => {
  const redes = [{ id: "R1", nome: "Rede Um", csResponsavel: "", modelo: "prepago", limiteCentavos: 0, cicloDia: 1, inicioApuracaoEm: AGORA - 60 * A.DIA }, { id: "R2", nome: "Rede Dois", csResponsavel: "", modelo: "pospago", limiteCentavos: 100000, cicloDia: 1, inicioApuracaoEm: AGORA - 60 * A.DIA }];
  const mk = (rede, n, o) => Array.from({ length: n }, () => P1(o, 20000, rede));
  const ps = [...mk("R1", 5, { data: dia(-10) }), ...mk("R1", 2, { exec: false, status: "aceita", promotorUid: "p", data: dia(2) }), ...mk("R2", 3, { data: "2026-11-01" }), ...mk("R2", 2, { exec: false, status: "aceita", promotorUid: "p", data: dia(2) })];
  const lanc = [{ id: "l1", redeId: "R1", tipo: "credito", valorCentavos: 1000000, descricao: "Recarga", em: AGORA - 30 * A.DIA, paga: null }, { id: "l0", redeId: "R1", tipo: "credito", valorCentavos: 999999, descricao: "antes da apuração", em: AGORA - 90 * A.DIA, paga: null }];
  const f = A.faturamento(base({ pedidos: ps, redes, lancamentos: lanc }), AGORA - 125 * A.DIA), r1 = f.find((x) => x.redeId === "R1"), r2 = f.find((x) => x.redeId === "R2");
  assert.equal(r1.creditosCentavos, 1000000, "crédito anterior à apuração não entra"); assert.equal(r1.consumoCentavos, 100000); assert.equal(r1.comprometidoCentavos, 40000); assert.equal(r1.saldoDisponivelCentavos, 860000); assert.equal(r1.alerta, "ok");
  assert.equal(r2.consumoCicloCentavos, 100000); assert.equal(r2.usoLimitePct, 100); assert.equal(r2.alerta, "limite_estourado"); assert.equal(r2.proximoFechamento, "2026-12-01");
  const baixo = A.faturamento(base({ pedidos: ps, redes: [redes[0]], lancamentos: [{ ...lanc[0], valorCentavos: 150000 }] }), 0)[0];
  assert.equal(baixo.saldoDisponivelCentavos, 10000); assert.equal(baixo.alerta, "saldo_baixo", "restam <7 dias no ritmo dos últimos 30 dias");
  assert.equal(A.faturamento(base({ pedidos: ps, redes: [redes[0]], lancamentos: [] }), 0)[0].alerta, "saldo_esgotado");
});
t("NPS: promotores − detratores sobre as respostas do período; taxa de resposta; pendentes", () => {
  const env = (nota, st = "respondido", c = "") => ({ id: "e" + ++seq, lojaUid: "x", redeId: null, lojaNome: "Loja X", status: st, criadoEm: AGORA - 5 * A.DIA, respondidoEm: st === "respondido" ? AGORA - 2 * A.DIA : null, nota: st === "respondido" ? nota : null, comentario: c });
  const n = A.nps([10, 10, 9, 9, 8, 7, 6, 5, 10, 3].map((x) => env(x)).concat([env(0, "pendente"), env(0, "pendente")]), J);
  assert.equal(n.nps, 20); assert.equal(n.promotores, 5); assert.equal(n.neutros, 2); assert.equal(n.detratores, 3); assert.equal(n.respostas, 10); assert.equal(n.enviados, 12); assert.equal(n.taxaResposta, 83.3); assert.equal(n.pendentes, 2);
  assert.equal(A.nps([], J).nps, null);
});
t("Contas-chave, marcas e escopo por rede: cada rede enxerga só o seu", () => {
  const redes = [{ id: "R1", nome: "Rede Um", csResponsavel: "Rita", modelo: "prepago", limiteCentavos: 0, cicloDia: 1, inicioApuracaoEm: 0 }];
  const lojas = [lojaBase("L1", { redeId: "R1" }), lojaBase("L2", { redeId: "R1" }), lojaBase("L3")];
  const ps = [P1({ uid: "L1" }, 20000, "R1"), P1({ uid: "L1", marcaId: "m1", marcaNome: "Nestlé" }, 20000, "R1"), P1({ uid: "L2" }, 20000, "R1"), P1({ uid: "L3", status: "aberta", exec: false }, 20000, null)];
  const b = base({ pedidos: ps, lojas, redes }), c = A.contasChave(b, J);
  assert.deepEqual(c.map((x) => x.nome), ["Rede Um", "Lojas avulsas"]); assert.equal(c[0].lojas, 2); assert.equal(c[0].missoes, 3); assert.equal(c[0].porLoja[0].lojaUid, "L1");
  const m = A.marcas(ps, J); assert.equal(m.length, 1); assert.equal(m[0].marca, "Nestlé"); assert.equal(m[0].lojas, 1);
  const painel = A.montarPainel(b, 30, "R1"); assert.equal(painel.fillRate.abertas, 3); assert.equal(painel.escopo.rede, "Rede Um"); assert.equal(A.montarPainel(b, 30, null).fillRate.abertas, 4);
  assert.equal(painel.kpis.fillRate, 100);
});
t("Pedido ilegível (data/hora quebrada) é descartado; Timestamp e número são aceitos", () => {
  assert.equal(A.normalizarPedido("x", { data: "2026-13-45", entrada: "08:00", saida: "12:00" }, 0, null), null);
  const p = A.normalizarPedido("y", { ...doc(), criadoEm: 1234567890000 }, 12345.6, null); assert.equal(p.criadoEm, 1234567890000); assert.equal(p.totalCentavos, 12346);
});
t("Setores do painel de recorrências espelham a config do servidor", () => { assert.deepEqual([...T.SETORES_PEDIDO], ctx.C.SETORES); });
t("Parâmetros: limites cobrem todo o contrato e o padrão respeita os próprios limites", () => {
  for (const [k, [lo, hi]] of Object.entries(T.LIMITES_PARAMETROS)) assert.ok(P[k] >= lo && P[k] <= hi, `padrão fora do limite: ${k}`);
  assert.deepEqual(Object.keys(T.LIMITES_PARAMETROS).sort(), Object.keys(P).sort()); assert.equal(P.inatividadeDias, 15);
});

// ======================= exportador =======================
function dadosRelatorio(aud = "interno", nomeRede = "Rede Um") {
  const redes = [{ id: "R1", nome: nomeRede, csResponsavel: "", modelo: "prepago", limiteCentavos: 0, cicloDia: 1, inicioApuracaoEm: 0 }];
  const b = base({ pedidos: [P1({ uid: "L1" }, 20000, "R1"), P1({ uid: "L1", foco: "Padaria" }, 20000, "R1")], lojas: [lojaBase("L1", { redeId: "R1", nome: "=HYPERLINK(\"http://x\")" })], redes });
  return { painel: A.montarPainel(b, 30, "R1"), contas: A.contasChave(b, J), marcas: [], faturamento: [], audiencia: aud };
}
t("Exportador CSV: BOM + ';' + defesa contra formula injection; cliente não leva churn nem contas", () => {
  const interno = R.gerarCSV(dadosRelatorio("interno", "=cmd|' /C calc'!A0")), cliente = R.gerarCSV(dadosRelatorio("cliente"));
  assert.ok(interno.startsWith("\uFEFF")); assert.ok(interno.includes("'=cmd")); assert.ok(interno.includes("CHURN")); assert.ok(!cliente.includes("CHURN")); assert.ok(!cliente.includes("CONTAS;"));
  assert.ok(interno.includes("Fill rate (%);100"));
});
t("Exportador HTML: escapa tudo que vem de dados e é autossuficiente (sem script/recurso externo)", () => {
  const h = R.gerarHTML(dadosRelatorio("cliente", "<img src=x onerror=alert(1)>"));
  assert.ok(!h.includes("<img src=x") && h.includes("&lt;img")); assert.ok(!/<script|https?:\/\/(?!www\.w3\.org)/.test(h.replace(/http:\/\/x/g, "")), "sem scripts nem URLs externas");
  assert.ok(h.includes("Resumo executivo") && h.includes("Lojas da rede"));
});
t("Exportador PPTX gera um .pptx válido (zip) — pulado se pptxgenjs não estiver instalado", async () => {
  try { require.resolve("pptxgenjs"); } catch { console.log("   (pptxgenjs ausente: teste pulado)"); return; }
  for (const aud of ["interno", "cliente"]) { const b = Buffer.from(await R.gerarPPTX(dadosRelatorio(aud))); assert.equal(b.subarray(0, 2).toString(), "PK"); assert.ok(b.length > 20_000); }
});

// ======================= rotas =======================
const U = { adm: { uid: "adm1", email: "adm@x.com", email_verified: true }, admVelho: { uid: "adm1", email: "adm@x.com", email_verified: true, auth_time: 1000 }, lojaA: { uid: "lojaA", email: "a@x.com", email_verified: true }, lojaB: { uid: "lojaB", email: "b@x.com", email_verified: true }, prom: { uid: "prom1", email: "p@x.com", email_verified: true } };
const set = (c, id, d) => ctx.db.collection(c).doc(id).set(d);
const get = async (c, id) => (await ctx.db.collection(c).doc(id).get()).data();
const todos = async (c) => (await ctx.db.collection(c).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const ok = (r, m = "") => assert.equal(r.status, 200, `${m} esperado 200, veio ${r.status} ${JSON.stringify(r.json)}`);
const falha = (r, status, codigo) => { assert.equal(r.status, status, `esperado ${status}/${codigo}, veio ${r.status} ${JSON.stringify(r.json)}`); if (codigo) assert.equal(r.json.codigo, codigo); };
const agora = () => E.clock.now, hojeReal = () => A.hojeSP(agora());
function reset() {
  E.limpar(); Object.assign(E.tokens, U); E.clock.now = Date.now(); ctx.__reset(); ctx.cs.invalidar();
  E.claimsStore.adm1 = { role: "admin" }; E.claimsStore.lojaA = { role: "loja" }; E.claimsStore.lojaB = { role: "loja" }; E.claimsStore.prom1 = { role: "promotor" };
}
const seedLoja = async (uid, nome, extra = {}) => { await set("contratantes", uid, { uid, nome, email: `${uid}@x.com`, criadoEm: ts(agora() - 200 * A.DIA), localizacao: { lat: -22.9, lng: -47.0, cidade: "Campinas", uf: "SP" }, ...extra }); await set("cartoes", uid, { status: "ativo" }); };
const seedPedido = async (id, o = {}, total = 20000) => { const d = doc({ ...o }); await set("solicitacoes", id, d); await set("solicitacoes_financeiro", id, { uid: d.uid, valor: total, taxaFixa: 0, total, criadoEm: ts(agora() - 3 * A.DIA) }); };
const hoje = () => A.hojeSP(agora());
/** A "data" dos seeds é relativa ao relógio real do teste. */
const dd = (n) => A.somaDias(hoje(), n);
const JPEG = (() => { const b = Buffer.alloc(2600, 7); Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03]).copy(b, 0); b[b.length - 2] = 0xff; b[b.length - 1] = 0xd9; return `data:image/jpeg;base64,${b.toString("base64")}`; })();

t("RBAC: só admin lê o painel de CS; loja/promotor/sem login são barrados; rotas da loja só para loja", async () => {
  reset();
  for (const rota of ["/cs/painel", "/cs/contas", "/cs/redes", "/cs/lojas", "/cs/faturamento", "/cs/marcas", "/cs/nps", "/cs/alertas", "/cs/config", "/cs/exportar?formato=csv"]) {
    falha(await chamar("GET", rota, {}), 401, "nao-autenticado");
    for (const tk of ["lojaA", "prom"]) falha(await chamar("GET", rota, { token: tk }), 403, "sem-permissao");
    ok(await chamar("GET", rota, { token: "adm" }), rota);
  }
  falha(await chamar("GET", "/cs/loja/recorrencias", { token: "adm" }), 403, "sem-permissao"); falha(await chamar("GET", "/cs/loja/recorrencias", { token: "prom" }), 403, "sem-permissao");
  ok(await chamar("GET", "/cs/loja/recorrencias", { token: "lojaA" })); falha(await chamar("POST", "/cs/redes", { token: "lojaA", body: { nome: "Rede Hack" } }), 403, "sem-permissao");
  falha(await chamar("GET", "/cs/painel?dias=999", { token: "adm" }), 400, "dados-invalidos");
  falha(await chamar("GET", "/cs/painel?redeId=nao-existe", { token: "adm" }), 404, "nao-encontrado");
});
t("Painel pela API: números do Firestore → KPIs; escopo por rede; cache invalida após escrita", async () => {
  reset(); await seedLoja("lojaA", "Mercado Alfa"); await seedLoja("lojaB", "Mercado Beta");
  for (let i = 0; i < 4; i++) await seedPedido(`a${i}`, { data: dd(-2 - i), atraso: i === 3 ? 30 : 0, uid: "lojaA" });
  await seedPedido("b0", { uid: "lojaB", data: dd(-3), loja: "Mercado Beta", exec: false });          // aberta, sem ninguém, já passou
  ctx.cs.invalidar();
  const p = (await chamar("GET", "/cs/painel?dias=30", { token: "adm" })).json;
  assert.equal(p.fillRate.encerradas, 5); assert.equal(p.fillRate.concluidas, 4); assert.equal(p.kpis.fillRate, 80); assert.equal(p.kpis.fillRateNoPrazo, 60); assert.equal(p.kpis.csat, 5); assert.equal(p.kpis.pontualidade, 75);
  const r = (await chamar("POST", "/cs/redes", { token: "adm", body: { nome: "Rede Alfa", csResponsavel: "Rita" } })); ok(r);
  ok(await chamar("PUT", `/cs/redes/${r.json.id}/lojas`, { token: "adm", body: { adicionar: ["lojaA"] } }));
  const pr = (await chamar("GET", `/cs/painel?dias=30&redeId=${r.json.id}`, { token: "adm" })).json;
  assert.equal(pr.fillRate.encerradas, 4); assert.equal(pr.kpis.fillRate, 100); assert.equal(pr.escopo.rede, "Rede Alfa");
  const c = (await chamar("GET", "/cs/contas?dias=30", { token: "adm" })).json;
  assert.deepEqual(c.map((x) => x.nome), ["Rede Alfa", "Lojas avulsas"]); assert.equal(c[0].lojas, 1); assert.equal(c[1].lojas, 1);
  falha(await chamar("PUT", `/cs/redes/${r.json.id}/lojas`, { token: "adm", body: { adicionar: ["loja-fantasma"] } }), 404, "nao-encontrado");
  falha(await chamar("PUT", `/cs/redes/${r.json.id}/lojas`, { token: "adm", body: { adicionar: "lojaA" } }), 400, "dados-invalidos");
  ok(await chamar("PUT", `/cs/redes/${r.json.id}/lojas`, { token: "adm", body: { remover: ["lojaA"] } }));
  assert.equal((await get("cs_lojas", "lojaA")).redeId, null);
});
t("Ficha da loja: validação, histórico, fotos (JPEG íntegro, limite 6, só pela API) e interações/ação de churn", async () => {
  reset(); await seedLoja("lojaA", "Mercado Alfa"); await seedPedido("a1", { uid: "lojaA", comentario: "Ótimo" }); ctx.cs.invalidar();
  const ficha = { endereco: { logradouro: "Av. Brasil", numero: "100", bairro: "Centro", cidade: "Campinas", uf: "sp", cep: "13010-000" }, acesso: { instrucoes: "Entrar pela doca", contatoPortaria: "Seu João", horarioRecebimento: "6h–10h" }, gerente: { nome: "Marta", telefone: "(19) 99999-0000", email: "marta@alfa.com" }, observacoes: "Depósito no 2º andar", ativo: true };
  ok(await chamar("PUT", "/cs/lojas/lojaA", { token: "adm", body: ficha }));
  const d = (await chamar("GET", "/cs/lojas/lojaA", { token: "adm" })).json;
  assert.equal(d.endereco.uf, "SP"); assert.equal(d.endereco.cep, "13010000"); assert.equal(d.gerente.telefone, "19999990000"); assert.equal(d.acesso.instrucoes, "Entrar pela doca"); assert.equal(d.missoes.length, 1); assert.equal(d.missoes[0].comentario, "Ótimo"); assert.equal(d.indicadores90d.concluidas, 1);
  falha(await chamar("PUT", "/cs/lojas/lojaA", { token: "adm", body: { endereco: { uf: "XX" } } }), 400, "dados-invalidos");
  falha(await chamar("PUT", "/cs/lojas/lojaA", { token: "adm", body: { gerente: { nome: "M", email: "sem-arroba" } } }), 400, "dados-invalidos");
  falha(await chamar("PUT", "/cs/lojas/lojaA", { token: "adm", body: {} }), 400, "dados-invalidos"); falha(await chamar("PUT", "/cs/lojas/fantasma", { token: "adm", body: { observacoes: "x" } }), 404, "nao-encontrado");
  falha(await chamar("PUT", "/cs/lojas/lojaA", { token: "adm", body: { redeId: "nao-existe" } }), 404, "nao-encontrado");
  // fotos
  falha(await chamar("POST", "/cs/lojas/lojaA/fotos", { token: "adm", body: { foto: "data:image/png;base64,AAAA" } }), 400, "foto-invalida");
  falha(await chamar("POST", "/cs/lojas/lojaA/fotos", { token: "lojaA", body: { foto: JPEG } }), 403, "sem-permissao");
  const f1 = await chamar("POST", "/cs/lojas/lojaA/fotos", { token: "adm", body: { foto: JPEG, descricao: "Fachada" } }); ok(f1);
  const img = await chamar("GET", `/cs/lojas/lojaA/fotos/${f1.json.id}`, { token: "adm" }); ok(img); assert.equal(img.h["Content-Type"], "image/jpeg"); assert.ok(Buffer.isBuffer(img.texto) && img.texto[0] === 0xff);
  falha(await chamar("GET", `/cs/lojas/lojaB/fotos/${f1.json.id}`, { token: "adm" }), 404, "nao-encontrado");
  for (let i = 0; i < 5; i++) ok(await chamar("POST", "/cs/lojas/lojaA/fotos", { token: "adm", body: { foto: JPEG } }));
  falha(await chamar("POST", "/cs/lojas/lojaA/fotos", { token: "adm", body: { foto: JPEG } }), 409, "limite-fotos");
  ok(await chamar("DELETE", `/cs/lojas/lojaA/fotos/${f1.json.id}`, { token: "adm" })); assert.equal((await chamar("GET", "/cs/lojas/lojaA", { token: "adm" })).json.fotos.length, 5);
  // interações + ação de churn
  const a = await chamar("POST", "/cs/lojas/lojaA/interacoes", { token: "adm", body: { tipo: "acao_churn", texto: "Ligar para o gerente e oferecer pacote de reposição" } }); ok(a);
  falha(await chamar("POST", "/cs/lojas/lojaA/interacoes", { token: "adm", body: { tipo: "spam", texto: "xxx" } }), 400, "dados-invalidos");
  assert.equal((await chamar("GET", "/cs/lojas/lojaA", { token: "adm" })).json.interacoes[0].status, "aberta");
  assert.deepEqual((await ctx.cs.base(true)).lojasComAcao, ["lojaA"]); ok(await chamar("PUT", `/cs/interacoes/${a.json.id}/concluir`, { token: "adm" })); assert.deepEqual((await ctx.cs.base(true)).lojasComAcao, []);
  const busca = (await chamar("GET", "/cs/lojas?busca=alfa", { token: "adm" })).json; assert.equal(busca.length, 1); assert.equal((await chamar("GET", "/cs/lojas?busca=zzz", { token: "adm" })).json.length, 0);
});
t("Faturamento B2B: razão (crédito/ajuste/fatura), login recente obrigatório, validação e saldo", async () => {
  reset(); await seedLoja("lojaA", "Mercado Alfa"); const r = (await chamar("POST", "/cs/redes", { token: "adm", body: { nome: "Rede Alfa" } })).json.id;
  await chamar("PUT", `/cs/redes/${r}/lojas`, { token: "adm", body: { adicionar: ["lojaA"] } });
  ok(await chamar("PUT", `/cs/faturamento/${r}`, { token: "adm", body: { inicioApuracao: dd(-30) } }));   // consumo só conta a partir daqui
  await seedPedido("a1", { uid: "lojaA", data: dd(-1) }, 20000); ctx.cs.invalidar();
  falha(await chamar("POST", `/cs/faturamento/${r}/lancamentos`, { token: "admVelho", body: { tipo: "credito", valorCentavos: 100000, descricao: "Recarga" } }), 401, "reautenticar");
  ok(await chamar("POST", `/cs/faturamento/${r}/lancamentos`, { token: "adm", body: { tipo: "credito", valorCentavos: 100000, descricao: "Recarga PIX" } }));
  falha(await chamar("POST", `/cs/faturamento/${r}/lancamentos`, { token: "adm", body: { tipo: "credito", valorCentavos: -5, descricao: "negativo" } }), 400, "dados-invalidos");
  falha(await chamar("POST", `/cs/faturamento/${r}/lancamentos`, { token: "adm", body: { tipo: "ajuste", valorCentavos: 0, descricao: "zero" } }), 400, "dados-invalidos");
  falha(await chamar("POST", `/cs/faturamento/${r}/lancamentos`, { token: "adm", body: { tipo: "credito", valorCentavos: 10.5, descricao: "quebrado" } }), 400, "dados-invalidos");
  falha(await chamar("POST", `/cs/faturamento/${r}/lancamentos`, { token: "adm", body: { tipo: "credito", valorCentavos: 100, descricao: "x" } }), 400, "dados-invalidos");
  ok(await chamar("POST", `/cs/faturamento/${r}/lancamentos`, { token: "adm", body: { tipo: "ajuste", valorCentavos: -10000, descricao: "Estorno acordado" } }));
  const f = (await chamar("GET", `/cs/faturamento?redeId=${r}`, { token: "adm" })).json[0];
  assert.equal(f.modelo, "prepago"); assert.equal(f.creditosCentavos, 90000); assert.equal(f.consumoCentavos, 20000); assert.equal(f.saldoDisponivelCentavos, 70000); assert.equal(f.lancamentos.length, 2);
  ok(await chamar("PUT", `/cs/faturamento/${r}`, { token: "adm", body: { modelo: "pospago", limiteCentavos: 50000, cicloDia: 10 } }));
  falha(await chamar("PUT", `/cs/faturamento/${r}`, { token: "adm", body: { cicloDia: 31 } }), 400, "dados-invalidos"); falha(await chamar("PUT", `/cs/faturamento/${r}`, { token: "adm", body: { modelo: "fiado" } }), 400, "dados-invalidos");
  const f2 = (await chamar("GET", `/cs/faturamento?redeId=${r}`, { token: "adm" })).json[0]; assert.equal(f2.modelo, "pospago"); assert.equal(f2.limiteCentavos, 50000); assert.ok(f2.proximoFechamento);
  const fat = await chamar("POST", `/cs/faturamento/${r}/lancamentos`, { token: "adm", body: { tipo: "fatura", valorCentavos: 30000, descricao: "Fatura outubro" } });
  ok(await chamar("PUT", `/cs/faturamento/${r}/lancamentos/${fat.json.id}/paga`, { token: "adm", body: { paga: true } })); assert.equal((await get("cs_faturamento_lancamentos", fat.json.id)).paga, true);
  falha(await chamar("PUT", `/cs/faturamento/outra/lancamentos/${fat.json.id}/paga`, { token: "adm", body: { paga: true } }), 404, "nao-encontrado");
});
t("Recorrências: loja programa datas/semanal; o cron gera os pedidos reais (idempotente) e respeita cartão e Master Switch; sem IDOR", async () => {
  reset(); await seedLoja("lojaA", "Mercado Alfa"); await seedLoja("lojaB", "Mercado Beta");
  const base_ = { nome: "Natal 2026", setor: "Mercearia", entrada: "08:00", saida: "12:00", tipo: "datas", datas: [dd(3), dd(5), dd(60)] };
  falha(await chamar("POST", "/cs/loja/recorrencias", { token: "lojaA", body: { ...base_, saida: "07:00" } }), 400, "turno-invalido");
  falha(await chamar("POST", "/cs/loja/recorrencias", { token: "lojaA", body: { ...base_, saida: "09:00" } }), 400, "turno-invalido");
  falha(await chamar("POST", "/cs/loja/recorrencias", { token: "lojaA", body: { ...base_, datas: [dd(-1)] } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/cs/loja/recorrencias", { token: "lojaA", body: { ...base_, datas: [] } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/cs/loja/recorrencias", { token: "lojaA", body: { ...base_, setor: "Açougue" } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/cs/loja/recorrencias", { token: "lojaA", body: { ...base_, tipo: "semanal", diasSemana: [1, 9], ate: dd(30) } }), 400, "dados-invalidos");
  const r1 = await chamar("POST", "/cs/loja/recorrencias", { token: "lojaA", body: base_ }); ok(r1);
  const r2 = await chamar("POST", "/cs/loja/recorrencias", { token: "lojaA", body: { ...base_, nome: "Segundas e sextas", tipo: "semanal", diasSemana: [1, 5], ate: dd(9), datas: undefined } }); ok(r2);
  assert.equal((await chamar("GET", "/cs/loja/recorrencias", { token: "lojaB" })).json.length, 0, "cada loja vê só as suas");
  falha(await chamar("DELETE", `/cs/loja/recorrencias/${r1.json.id}`, { token: "lojaB" }), 404, "nao-encontrado");
  // cron: autenticação por segredo
  falha(await chamar("POST", "/interno/cs-manutencao", {}), 401, "nao-autenticado"); falha(await chamar("POST", "/interno/cs-manutencao", { headers: { "x-cron-secret": "errado" } }), 401, "nao-autenticado");
  const cron = { headers: { "x-cron-secret": "cron-secreto" } };
  const c1 = (await chamar("POST", "/interno/cs-manutencao", cron)); ok(c1);
  const ped = (await todos("solicitacoes")).filter((p) => p.recorrenciaId); const datasGeradas = ped.map((p) => p.data).sort();
  assert.ok(datasGeradas.includes(dd(3)) && datasGeradas.includes(dd(5)), "datas dentro do horizonte (14 dias) viraram pedidos"); assert.ok(!datasGeradas.includes(dd(60)), "data longe ainda não");
  assert.ok(ped.every((p) => p.uid === "lojaA" && p.status === "aberta" && p.foco === "Mercearia" && p.exigeExecucao === true && p.minutos === 240));
  assert.ok(ped.some((p) => p.id === `rec_${r1.json.id}_${dd(3)}`)); assert.ok(await get("solicitacoes_financeiro", `rec_${r1.json.id}_${dd(3)}`)); assert.ok(await get("pagamentos_internos", `rec_${r1.json.id}_${dd(3)}`));
  const dow = (iso) => new Date(iso + "T00:00:00Z").getUTCDay(); assert.ok(ped.filter((p) => p.recorrenciaId === r2.json.id).every((p) => [1, 5].includes(dow(p.data)) && p.data <= dd(9)));
  const n1 = ped.length, c2 = await chamar("POST", "/interno/cs-manutencao", cron); assert.equal(c2.json.recorrencias.geradas, 0, "idempotente"); assert.equal((await todos("solicitacoes")).filter((p) => p.recorrenciaId).length, n1);
  // sem cartão: não gera e avisa o CS
  await set("cartoes", "lojaB", { status: "removido" });
  const rb = await chamar("POST", "/cs/loja/recorrencias", { token: "lojaB", body: { ...base_, nome: "Black Friday", datas: [dd(4)] } }); ok(rb);
  const c3 = await chamar("POST", "/interno/cs-manutencao", cron); assert.equal(c3.json.recorrencias.falhas, 1);
  assert.ok((await todos("cs_alertas")).some((a) => a.tipo === "recorrencia_falha" && a.lojaUid === "lojaB")); assert.ok(!(await todos("solicitacoes")).some((p) => p.uid === "lojaB" && p.recorrenciaId));
  // Master Switch desliga a geração
  await set("configuracoes", "operacao", { raioKm: 20, master: { cadastros: true, missoes: false, pagamentos: true }, motivoPausa: "teste", versao: 1, atualizadoEm: ts(agora()), atualizadoPor: "root" }); ctx.operacao.invalidar();
  await seedLoja("lojaB", "Mercado Beta");
  const pausada = await chamar("POST", "/cs/loja/recorrencias", { token: "lojaB", body: { ...base_, nome: "Pausada", datas: [dd(6)] } }); assert.notEqual(pausada.status, 200, "Master Switch bloqueia criar programação");
  await set("cs_recorrencias", "rec-forcada", { lojaUid: "lojaA", lojaNome: "Mercado Alfa", nome: "Forçada", setor: "Mercearia", entrada: "08:00", saida: "12:00", marcaId: null, tipo: "datas", datas: [dd(7)], diasSemana: [], ate: null, ativo: true, geradas: [], ultimaFalha: "", criadoEm: ts(agora()) });
  const pausadoCron = await chamar("POST", "/interno/cs-manutencao", cron); assert.equal(pausadoCron.json.recorrencias.geradas, 0, "cron não gera pedidos com o Master Switch desligado"); assert.ok(!(await get("solicitacoes", `rec_rec-forcada_${dd(7)}`)));
  ok(await chamar("DELETE", `/cs/loja/recorrencias/${r1.json.id}`, { token: "lojaA" })); assert.equal((await get("cs_recorrencias", r1.json.id)).ativo, false);
});
t("NPS B2B: cron dispara 1 pesquisa por loja ativa (respeitando periodicidade); só o dono responde, uma vez; entra no painel", async () => {
  reset(); await seedLoja("lojaA", "Mercado Alfa"); await seedLoja("lojaB", "Mercado Beta"); await seedLoja("lojaC", "Sem uso");
  await seedPedido("a1", { uid: "lojaA", data: dd(-5) }); await seedPedido("b1", { uid: "lojaB", data: dd(-5), loja: "Mercado Beta" }); ctx.cs.invalidar();
  const cron = { headers: { "x-cron-secret": "cron-secreto" } }, c1 = await chamar("POST", "/interno/cs-manutencao", cron); ok(c1); assert.equal(c1.json.npsEnviados, 2, "lojaC não usou a plataforma: não recebe");
  const pend = (await chamar("GET", "/cs/loja/nps/pendente", { token: "lojaA" })).json; assert.ok(pend && pend.id); assert.equal((await chamar("GET", "/cs/loja/nps/pendente", { token: "lojaB" })).json.id !== pend.id, true);
  falha(await chamar("POST", `/cs/loja/nps/${pend.id}/responder`, { token: "lojaB", body: { nota: 10 } }), 404, "nao-encontrado");
  falha(await chamar("POST", `/cs/loja/nps/${pend.id}/responder`, { token: "lojaA", body: { nota: 11 } }), 400, "dados-invalidos"); falha(await chamar("POST", `/cs/loja/nps/${pend.id}/responder`, { token: "lojaA", body: { nota: 7.5 } }), 400, "dados-invalidos");
  ok(await chamar("POST", `/cs/loja/nps/${pend.id}/responder`, { token: "lojaA", body: { nota: 9, comentario: "Equipe ótima" } }));
  falha(await chamar("POST", `/cs/loja/nps/${pend.id}/responder`, { token: "lojaA", body: { nota: 1 } }), 409, "ja-respondida"); assert.equal((await chamar("GET", "/cs/loja/nps/pendente", { token: "lojaA" })).json, null);
  const n = (await chamar("GET", "/cs/nps?dias=30", { token: "adm" })).json; assert.equal(n.nps, 100); assert.equal(n.respostas, 1); assert.equal(n.pendentes, 1); assert.equal(n.comentarios[0].comentario, "Equipe ótima");
  assert.equal((await chamar("POST", "/interno/cs-manutencao", cron)).json.npsEnviados, 0, "periodicidade: não reenvia");
  falha(await chamar("POST", "/cs/nps/disparar", { token: "adm", body: {} }), 400, "dados-invalidos"); falha(await chamar("POST", "/cs/nps/disparar", { token: "lojaA", body: { todas: true } }), 403, "sem-permissao");
  const forcado = await chamar("POST", "/cs/nps/disparar", { token: "adm", body: { todas: true } }); ok(forcado); assert.equal(forcado.json.enviados, 1, "lojaB já tem pendente; lojaA recebe nova; lojaC não usou");
  E.avancar(31 * A.DIA); ctx.cs.invalidar(); const c3 = await chamar("POST", "/interno/cs-manutencao", cron); assert.ok(c3.json.npsExpirados >= 1, "pendentes vencem em 30 dias");
});
t("Alertas do cron: vaga sem promotor perto do início e churn viram alerta único + push aos admins", async () => {
  reset(); await seedLoja("lojaA", "Mercado Alfa"); await set("push_tokens", "t1", { admin: true, token: "tok-admin" });
  const em = (min) => { const i = agora() + min * 60_000, d = new Date(i - 3 * 3600_000).toISOString(); return { data: d.slice(0, 10), entrada: d.slice(11, 16), saida: new Date(i - 3 * 3600_000 + 4 * 3600_000).toISOString().slice(11, 16) }; };
  await seedPedido("vaga1", { uid: "lojaA", exec: false, ...em(90) }); await seedPedido("longe", { uid: "lojaA", exec: false, ...em(600) });
  await seedPedido("velho", { uid: "lojaA", data: dd(-40), criadoEm: agora() - 40 * A.DIA }); ctx.cs.invalidar();
  const cron = { headers: { "x-cron-secret": "cron-secreto" } }, c1 = await chamar("POST", "/interno/cs-manutencao", cron); ok(c1);
  assert.equal(c1.json.vagasNovas, 1); assert.equal(c1.json.churnNovos, 0, "a loja criou missão há 0 dia (a vaga acima): não é churn");
  const al = await todos("cs_alertas"); assert.ok(al.some((a) => a.id === "vaga_vaga1" && a.severidade === "alta")); assert.ok(!al.some((a) => a.id === "vaga_longe"));
  assert.equal(E.pushes.length, 1); assert.match(E.pushes[0].data.titulo, /sem promotor/);
  assert.equal((await chamar("POST", "/interno/cs-manutencao", cron)).json.vagasNovas, 0, "mesmo alerta não repete");
  const lista = (await chamar("GET", "/cs/alertas", { token: "adm" })).json; assert.ok(lista.length >= 1 && lista[0].mensagem);
  const painel = (await chamar("GET", "/cs/painel?dias=7", { token: "adm" })).json; assert.equal(painel.vagas.length, 1); assert.equal(painel.kpis.vagasDesatendidas, 1);
  // churn: loja sem nenhuma missão recente
  reset(); await seedLoja("lojaB", "Mercado Beta"); await seedPedido("old", { uid: "lojaB", data: dd(-20), criadoEm: agora() - 20 * A.DIA, loja: "Mercado Beta" }); ctx.cs.invalidar();
  const c2 = await chamar("POST", "/interno/cs-manutencao", cron); assert.equal(c2.json.churnNovos, 1); assert.ok((await todos("cs_alertas")).some((a) => a.tipo === "churn" && a.lojaUid === "lojaB"));
  assert.equal((await chamar("POST", "/interno/cs-manutencao", cron)).json.churnNovos, 0);
  const ch = (await chamar("GET", "/cs/painel?dias=30", { token: "adm" })).json.churn; assert.equal(ch.itens[0].nivel, "risco"); assert.equal(ch.itens[0].diasSemMissao, 20);
});
t("Parâmetros: validação de limites, persistência e efeito imediato no churn", async () => {
  reset(); await seedLoja("lojaB", "Mercado Beta"); await seedPedido("old", { uid: "lojaB", data: dd(-20), criadoEm: agora() - 20 * A.DIA, loja: "Mercado Beta" }); ctx.cs.invalidar();
  assert.equal((await chamar("GET", "/cs/painel?dias=30", { token: "adm" })).json.churn.resumo.risco, 1);
  falha(await chamar("PUT", "/cs/config", { token: "adm", body: { inatividadeDias: 2 } }), 400, "dados-invalidos"); falha(await chamar("PUT", "/cs/config", { token: "adm", body: { inatividadeDias: 15.5 } }), 400, "dados-invalidos");
  falha(await chamar("PUT", "/cs/config", { token: "adm", body: { desconhecido: 1 } }), 400, "dados-invalidos"); falha(await chamar("PUT", "/cs/config", { token: "lojaA", body: { inatividadeDias: 30 } }), 403, "sem-permissao");
  ok(await chamar("PUT", "/cs/config", { token: "adm", body: { inatividadeDias: 30 } }));
  const p = (await chamar("GET", "/cs/painel?dias=30", { token: "adm" })).json; assert.equal(p.parametros.inatividadeDias, 30); assert.equal(p.churn.resumo.risco, 0); assert.equal(p.churn.resumo.atencao, 1);
});
t("Exportar pela API: cliente exige rede; CSV/HTML com cabeçalhos de download; auditoria registra", async () => {
  reset(); await seedLoja("lojaA", "Mercado Alfa"); await seedPedido("a1", { uid: "lojaA" }); const r = (await chamar("POST", "/cs/redes", { token: "adm", body: { nome: "Rede Alfa" } })).json.id;
  await chamar("PUT", `/cs/redes/${r}/lojas`, { token: "adm", body: { adicionar: ["lojaA"] } }); ctx.cs.invalidar();
  falha(await chamar("GET", "/cs/exportar?formato=html&audiencia=cliente", { token: "adm" }), 400, "dados-invalidos"); falha(await chamar("GET", "/cs/exportar?formato=exe", { token: "adm" }), 400, "dados-invalidos");
  const h = await chamar("GET", `/cs/exportar?formato=html&redeId=${r}`, { token: "adm" }); ok(h); assert.match(h.h["Content-Disposition"], /attachment; filename="abastece-ja-.*\.html"/); assert.ok(h.texto.includes("Rede Alfa") && !h.texto.includes("Contas-chave"));
  const csv = await chamar("GET", "/cs/exportar?formato=csv", { token: "adm" }); ok(csv); assert.match(csv.h["Content-Type"], /text\/csv/); assert.ok(csv.texto.includes("CONTAS"));
  const aud = (await todos("auditoria")).map((a) => a.acao); for (const a of ["cs.rede.criar", "cs.rede.lojas", "cs.exportar"]) assert.ok(aud.includes(a), `auditoria sem ${a}`);
  assert.equal((await todos("auditoria")).find((a) => a.acao === "cs.exportar").uid, "adm1");
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) { try { await fn(); console.log("  ✓", nome); } catch (e) { falhas++; console.log("  ✗", nome, "\n    ", (e && e.stack || e).toString().split("\n").slice(0, 6).join("\n     ")); } }
  console.log(`\n${testes.length - falhas}/${testes.length} testes do módulo CS & B2B passaram.`);
  E.restaurarRelogio(); process.exit(falhas ? 1 : 0);
})();
