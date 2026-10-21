// ============================================================
// ABASTECE JÁ — Servidor Node.js / Express (Render)
//
//  Pedidos e regras de negócio (a verdade mora AQUI, não no navegador):
//    POST /criarPedido       loja: exige cartão, turno ≤ 6 h, calcula valores
//    POST /aceitarTurno      promotor: máx. 3 vezes/semana por loja
//    POST /cartao/registrar  loja: cadastra/valida o cartão de crédito
//  Mercado Pago:
//    /mpConectarUrl, /mpCallback  OAuth do promotor
//    POST /criarCobranca          checkout com split automático
//    /webhookMP, POST /confirmarPagamento
//  Sandbox (só com MODO_TESTE=1): /teste/status, /teste/login, /teste/pagar, /teste/resetar
//  Diagnóstico: GET /saude, GET /diagnostico
// ============================================================
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const crypto = require("crypto");
const path = require("path");
const S = require("./split");

const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: true })); // autenticação por token Bearer (sem cookies): origin aberto é seguro
app.use(express.json());

// ---------- Firebase Admin ----------
function credencialFirebase() {
  const bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!bruto) return null;
  const texto = bruto.trim().startsWith("{") ? bruto : Buffer.from(bruto, "base64").toString("utf8");
  return admin.credential.cert(JSON.parse(texto));
}
if (!admin.apps.length) {
  const credential = credencialFirebase();
  if (!credential && !process.env.FIRESTORE_EMULATOR_HOST) console.error("⚠️  FIREBASE_SERVICE_ACCOUNT não definida: o acesso ao Firestore vai falhar.");
  admin.initializeApp({ ...(credential ? { credential } : {}), projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "abastece-ja-240d5" });
}
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

// ---------- Configuração (Environment no Render) ----------
const MP_CLIENT_SECRET = process.env.MP_CLIENT_SECRET || "";
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || "";
const MP_CLIENT_ID = process.env.MP_CLIENT_ID || "";
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || ""; // token da conta da PLATAFORMA (cadastro de cartões)
const APP_URL = process.env.APP_URL || "";
const MODO_TESTE = ["1", "true", "sim"].includes(String(process.env.MODO_TESTE || "").toLowerCase());
const PORT = process.env.PORT || 3000;
const MP_API = "https://api.mercadopago.com";
const TESTE_LOJA = "teste-loja", TESTE_PROMOTOR = "teste-promotor";

const getBaseUrl = (req) => {
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "");
  const proto = req.get("x-forwarded-proto") === "https" ? "https" : req.protocol;
  return `${proto}://${req.get("host")}`;
};
const appUrl = () => (APP_URL || "").replace(/\/$/, "");
const urlPublicaHttps = (u) => /^https:\/\/[^/\s]+\.[^/\s]+/.test(u) && !/localhost|127\.0\.0\.1/.test(u);
const reais = (c) => Number((c / 100).toFixed(2));
const hojeSP = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const agoraSP = () => new Date().toLocaleTimeString("sv-SE", { timeZone: "America/Sao_Paulo", hour12: false }).slice(0, 5);

class Falha extends Error {
  constructor(status, msg, codigo, detalhe) { super(msg); this.status = status; this.codigo = codigo; this.detalhe = detalhe; }
}

// ---------- Autenticação ----------
async function usuario(req) {
  const h = req.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : req.body?.idToken || req.query?.idToken;
  if (!token) throw new Falha(401, "login necessário");
  try { return await admin.auth().verifyIdToken(token); }
  catch { throw new Falha(401, "sessão inválida"); }
}
/** Conta de teste legítima: só vale com MODO_TESTE ligado no servidor E o claim emitido por /teste/login. */
const ehTeste = (u) => MODO_TESTE && u.teste === true && [TESTE_LOJA, TESTE_PROMOTOR].includes(u.uid);
function exigirTeste(u) {
  if (!MODO_TESTE) throw new Falha(404, "Modo de teste desligado neste servidor.", "teste-desligado");
  if (!ehTeste(u)) throw new Falha(403, "Só contas de teste podem usar esta rota.", "so-teste");
}

const envelope = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e instanceof Falha) return res.status(e.status).json({ erro: e.message, codigo: e.codigo, detalhe: e.detalhe });
    console.error(e);
    res.status(500).json({ erro: "erro interno", codigo: "interno" });
  }
};

const assinar = (texto) => crypto.createHmac("sha256", MP_CLIENT_SECRET).update(texto).digest("hex");

// ---------- Chamada ao Mercado Pago (com diagnóstico do erro) ----------
async function mp(caminho, token, init = {}) {
  let r;
  try {
    r = await fetch(MP_API + caminho, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  } catch (e) {
    console.error("MP rede", caminho, e.message);
    throw new Falha(502, "Não foi possível falar com o Mercado Pago agora. Tente novamente.", "mp-rede");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const motivo = j.message || j.error || j.cause?.[0]?.description || `HTTP ${r.status}`;
    console.error("MP erro", caminho, r.status, JSON.stringify(j));
    const amigavel = r.status === 401 || r.status === 403 ? "O Mercado Pago não aceitou a credencial. O promotor precisa reconectar a conta."
      : r.status === 404 ? "O Mercado Pago não encontrou o recurso pedido."
      : `Mercado Pago recusou a operação: ${motivo}`;
    throw new Falha(502, amigavel, "mp", { status: r.status, motivo });
  }
  return j;
}

/** Token do promotor, renovando se estiver perto de vencer. */
async function tokenDoPromotor(uid) {
  const ref = db.collection("mp_tokens").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new Falha(400, "O promotor ainda não conectou o Mercado Pago.", "promotor-sem-mp");
  const t = snap.data();
  if (t.expiraEm && t.expiraEm.toMillis() - Date.now() > 3600_000) return t.accessToken;
  const r = await fetch(`${MP_API}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: MP_CLIENT_ID, client_secret: MP_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: t.refreshToken })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("refresh MP", j); throw new Falha(400, "Conexão do promotor com o Mercado Pago expirou. Peça para ele reconectar.", "promotor-sem-mp"); }
  await ref.set({ accessToken: j.access_token, refreshToken: j.refresh_token, expiraEm: Timestamp.fromMillis(Date.now() + j.expires_in * 1000) }, { merge: true });
  return j.access_token;
}

function configMP() {
  if (!MP_CLIENT_ID || !MP_CLIENT_SECRET) throw new Falha(500, "Mercado Pago não configurado no servidor (MP_CLIENT_ID / MP_CLIENT_SECRET).", "mp-nao-configurado");
}

// ---------- Cálculo autoritativo ----------
/** Recalcula SEMPRE no servidor, a partir do horário gravado no pedido. Nada vem do navegador. */
function splitDoPedido(s) {
  const m = Number.isInteger(s.minutos) && s.minutos > 0 ? s.minutos : S.minutosEntre(s.entrada, s.saida);
  if (m > 0) {
    const e = S.validarTurno(s.entrada, s.saida);
    if (e) throw new Falha(400, e, "turno-invalido");
    return S.calcularTurno(m);
  }
  // pedidos antigos (antes do modelo por hora): valor combinado, em centavos
  const c = Number.isInteger(s.valorCentavos) ? s.valorCentavos : Math.round(Number(s.valor) * 100);
  if (!(c >= S.VALOR_MINIMO_CENTAVOS && c <= S.VALOR_MAXIMO_CENTAVOS)) throw new Falha(400, "valor do pedido fora do permitido");
  return S.calcularSplit(c);
}
const visaoLoja = (sp) => ({ valor: sp.valor, taxaFixa: sp.taxaFixa, total: sp.total });

async function exigirCartao(uid) {
  const c = await db.collection("cartoes").doc(uid).get();
  if (!c.exists || c.data().status !== "ativo") throw new Falha(402, "Cadastre um cartão de crédito válido para solicitar ou pagar serviços.", "cartao-obrigatorio");
}

// ============================================================
// SAÚDE / DIAGNÓSTICO
// ============================================================
app.get("/saude", (req, res) => res.json({ ok: true, modoTeste: MODO_TESTE }));
app.get("/diagnostico", (req, res) => {
  const base = getBaseUrl(req);
  const problemas = [];
  if (!MP_CLIENT_ID) problemas.push("MP_CLIENT_ID ausente");
  if (!MP_CLIENT_SECRET) problemas.push("MP_CLIENT_SECRET ausente");
  if (!urlPublicaHttps(appUrl())) problemas.push("APP_URL ausente ou inválida (precisa ser https público, sem barra no fim)");
  if (!process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.FIRESTORE_EMULATOR_HOST) problemas.push("FIREBASE_SERVICE_ACCOUNT ausente");
  res.json({
    ok: problemas.length === 0, problemas, modoTeste: MODO_TESTE,
    redirectUrlParaCadastrarNoMercadoPago: `${base}/mpCallback`,
    variaveis: { MP_CLIENT_ID: !!MP_CLIENT_ID, MP_CLIENT_SECRET: !!MP_CLIENT_SECRET, MP_WEBHOOK_SECRET: !!MP_WEBHOOK_SECRET, MP_ACCESS_TOKEN: !!MP_ACCESS_TOKEN, APP_URL: appUrl() || null, FIREBASE_SERVICE_ACCOUNT: !!process.env.FIREBASE_SERVICE_ACCOUNT }
  });
});

// ============================================================
// 0) SANDBOX — login de teste + pagamento simulado (só com MODO_TESTE=1)
// ============================================================
app.get("/teste/status", (req, res) => res.json({ ativo: MODO_TESTE }));

app.post("/teste/login", envelope(async (req, res) => {
  if (!MODO_TESTE) throw new Falha(404, "Modo de teste desligado neste servidor.", "teste-desligado");
  const perfil = req.body?.perfil;
  if (!["loja", "promotor"].includes(perfil)) throw new Falha(400, "perfil inválido (loja ou promotor)");
  const uid = perfil === "loja" ? TESTE_LOJA : TESTE_PROMOTOR;
  if (perfil === "loja") {
    await db.collection("contratantes").doc(uid).set({
      uid, email: "loja.teste@abastece.ja", nome: "Loja Teste", razaoSocial: "Mercadinho Teste Ltda", documento: "11222333000181",
      endereco: "Rua dos Testes, 100 — Itapira/SP", ramo: "Supermercado", teste: true, termosEm: FieldValue.serverTimestamp()
    }, { merge: true });
  } else {
    await db.collection("profissionais").doc(uid).set({
      uid, nome: "Promotor Teste", email: "promotor.teste@abastece.ja", status: "ativo", mpConectado: true, teste: true,
      especialidade: "Reposição geral", cidade: "Itapira - SP", refCode: "teste01", criadoEm: FieldValue.serverTimestamp()
    }, { merge: true });
    await db.collection("profissionais_privado").doc(uid).set({ cpf: "52998224725", telefone: "(19) 99999-0000", pix: { tipo: "CPF", chave: "52998224725" } }, { merge: true });
  }
  const customToken = await admin.auth().createCustomToken(uid, { teste: true, perfil });
  res.json({ customToken, uid, perfil });
}));

/** Zera o cenário de teste: pedidos, cartão e notas das duas contas fictícias. */
app.post("/teste/resetar", envelope(async (req, res) => {
  const u = await usuario(req); exigirTeste(u);
  const ids = new Set();
  for (const [campo, uid] of [["uid", TESTE_LOJA], ["promotorUid", TESTE_PROMOTOR]]) {
    (await db.collection("solicitacoes").where(campo, "==", uid).get()).docs.forEach((d) => ids.add(d.id));
  }
  const lote = db.batch();
  for (const id of ids) for (const col of ["solicitacoes", "solicitacoes_financeiro", "pagamentos_internos"]) lote.delete(db.collection(col).doc(id));
  (await db.collection("notas").where("contratanteUid", "==", TESTE_LOJA).get()).docs.forEach((d) => lote.delete(d.ref));
  lote.delete(db.collection("cartoes").doc(TESTE_LOJA));
  await lote.commit();
  res.json({ ok: true, pedidosRemovidos: ids.size });
}));

// ============================================================
// 1) CARTÃO DE CRÉDITO (obrigatório para a loja)
// ============================================================
app.post("/cartao/registrar", envelope(async (req, res) => {
  const u = await usuario(req);
  const b = req.body || {};
  let cartao;
  if (b.simulado) {
    // Sandbox: o navegador valida o número (Luhn) e envia só bandeira/últimos 4/validade. O número completo NUNCA chega aqui.
    exigirTeste(u);
    const ultimos4 = String(b.ultimos4 || "").replace(/\D/g, "");
    const mes = Number(b.mes), ano = Number(b.ano);
    if (ultimos4.length !== 4) throw new Falha(400, "cartão inválido", "cartao-invalido");
    if (!(mes >= 1 && mes <= 12) || !(ano >= 2000)) throw new Falha(400, "validade inválida", "cartao-invalido");
    const agora = new Date(); if (ano < agora.getFullYear() || (ano === agora.getFullYear() && mes < agora.getMonth() + 1)) throw new Falha(400, "cartão vencido", "cartao-vencido");
    cartao = { bandeira: String(b.bandeira || "cartão").slice(0, 20), ultimos4, mes, ano, simulado: true };
  } else {
    // Produção: o navegador gera um token com o MercadoPago.js (o número nunca passa por aqui); o servidor guarda o cartão no cliente do MP.
    if (!MP_ACCESS_TOKEN) throw new Falha(500, "Cadastro de cartão não configurado no servidor (MP_ACCESS_TOKEN).", "mp-nao-configurado");
    if (!b.cardToken || typeof b.cardToken !== "string") throw new Falha(400, "token do cartão ausente", "cartao-invalido");
    const email = u.email || `${u.uid}@abastece.ja`;
    const busca = await mp(`/v1/customers/search?email=${encodeURIComponent(email)}`, MP_ACCESS_TOKEN);
    const clienteId = busca.results?.[0]?.id || (await mp("/v1/customers", MP_ACCESS_TOKEN, { method: "POST", body: JSON.stringify({ email }) })).id;
    const c = await mp(`/v1/customers/${clienteId}/cards`, MP_ACCESS_TOKEN, { method: "POST", body: JSON.stringify({ token: b.cardToken }) });
    cartao = { bandeira: c.payment_method?.name || c.payment_method?.id || "cartão", ultimos4: c.last_four_digits, mes: c.expiration_month, ano: c.expiration_year, mpCustomerId: String(clienteId), mpCardId: String(c.id), simulado: false };
  }
  await db.collection("cartoes").doc(u.uid).set({ ...cartao, uid: u.uid, status: "ativo", atualizadoEm: FieldValue.serverTimestamp() });
  res.json({ ok: true, cartao: { bandeira: cartao.bandeira, ultimos4: cartao.ultimos4, mes: cartao.mes, ano: cartao.ano } });
}));
app.post("/cartao/remover", envelope(async (req, res) => {
  const u = await usuario(req);
  await db.collection("cartoes").doc(u.uid).delete();
  res.json({ ok: true });
}));

// ============================================================
// 2) PEDIDO (loja) — regras: cartão, turno ≤ 6 h, valor por hora
// ============================================================
app.post("/criarPedido", envelope(async (req, res) => {
  const u = await usuario(req);
  await exigirCartao(u.uid);
  const b = req.body || {};
  const loja = String(b.loja || "").trim(), data = String(b.data || ""), entrada = String(b.entrada || ""), saida = String(b.saida || "");
  const foco = String(b.foco || "").trim().slice(0, 60);
  if (loja.length < 3 || loja.length > 160) throw new Falha(400, "Informe o nome e o endereço da loja.", "dados-invalidos");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data < hojeSP()) throw new Falha(400, "Escolha hoje ou uma data futura.", "dados-invalidos");
  if (!foco) throw new Falha(400, "Escolha o setor.", "dados-invalidos");
  const erroTurno = S.validarTurno(entrada, saida);              // ← trava de 6 horas
  if (erroTurno) throw new Falha(400, erroTurno, "turno-invalido");
  if (data === hojeSP() && saida <= agoraSP()) throw new Falha(400, "Esse horário já passou hoje.", "dados-invalidos");

  const sp = S.calcularTurno(S.minutosEntre(entrada, saida));
  const ref = db.collection("solicitacoes").doc();
  const pedido = {
    uid: u.uid, loja, data, entrada, saida, horario: `${entrada} – ${saida}`, minutos: sp.minutos, foco,
    valorPromotorCentavos: sp.promotor,                           // único valor que o promotor enxerga
    status: "aberta", criadoEm: FieldValue.serverTimestamp()
  };
  if (b.promotorPreferido) pedido.promotorPreferido = String(b.promotorPreferido).slice(0, 80);
  const lote = db.batch();
  lote.set(ref, pedido);
  lote.set(db.collection("solicitacoes_financeiro").doc(ref.id), { uid: u.uid, ...visaoLoja(sp), criadoEm: FieldValue.serverTimestamp() }); // o que a LOJA enxerga
  lote.set(db.collection("pagamentos_internos").doc(ref.id), { uid: u.uid, split: sp, criadoEm: FieldValue.serverTimestamp() });        // só o servidor lê
  await lote.commit();
  res.json({ id: ref.id, ...visaoLoja(sp) });
}));

// ============================================================
// 3) ACEITE (promotor) — máx. 3 vezes por semana na mesma loja
// ============================================================
app.post("/aceitarTurno", envelope(async (req, res) => {
  const u = await usuario(req);
  const { solicitacaoId } = req.body || {};
  if (!solicitacaoId) throw new Falha(400, "pedido não informado");
  const profRef = db.collection("profissionais").doc(u.uid);
  const sRef = db.collection("solicitacoes").doc(String(solicitacaoId));

  await db.runTransaction(async (tx) => {
    const [prof, snap, meus] = await Promise.all([tx.get(profRef), tx.get(sRef), tx.get(db.collection("solicitacoes").where("promotorUid", "==", u.uid))]);
    const p = prof.data();
    if (!p || p.status !== "ativo") throw new Falha(403, "Seu cadastro ainda não foi aprovado.", "promotor-inativo");
    if (!p.mpConectado && !ehTeste(u)) throw new Falha(403, "Conecte o Mercado Pago para aceitar turnos.", "promotor-sem-mp");
    const s = snap.data();
    if (!s) throw new Falha(404, "Pedido não encontrado.", "nao-encontrado");
    if (s.status !== "aberta") throw new Falha(409, "Outro promotor já pegou este turno (ou ele foi cancelado).", "turno-indisponivel");
    if (s.data < hojeSP()) throw new Falha(409, "Este turno já passou.", "turno-indisponivel");

    const historico = meus.docs.map((d) => ({ id: d.id, ...d.data() }));
    const vezes = S.vezesNaSemana(historico, s.uid, s.data, snap.id);
    if (vezes >= S.MAX_VEZES_SEMANA_LOJA) {
      const { inicio, fim } = S.limitesSemana(s.data);
      throw new Falha(409, `Limite atingido: no máximo ${S.MAX_VEZES_SEMANA_LOJA} turnos por semana na mesma loja (semana de ${inicio.split("-").reverse().join("/")} a ${fim.split("-").reverse().join("/")}).`, "limite-semanal");
    }
    tx.update(sRef, { status: "aceita", promotorUid: u.uid, promotorNome: p.nome || u.name || "Promotor", aceitoEm: FieldValue.serverTimestamp() });
  });
  res.json({ ok: true });
}));

// ============================================================
// 4) MERCADO PAGO — OAuth do promotor
// ============================================================
app.all("/mpConectarUrl", envelope(async (req, res) => {
  const { uid } = await usuario(req);
  configMP();
  const prof = await db.collection("profissionais").doc(uid).get();
  if (!prof.exists) throw new Falha(403, "cadastro de promotor não encontrado");
  const redirectUri = `${getBaseUrl(req)}/mpCallback`;
  const state = `${uid}.${assinar(uid)}`;
  // platform_id=mp é exigido pelo fluxo de marketplace (estava faltando nesta versão do servidor)
  const url = `https://auth.mercadopago.com.br/authorization?client_id=${encodeURIComponent(MP_CLIENT_ID)}&response_type=code&platform_id=mp&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.json({ url, redirectUri });
}));

app.get("/mpCallback", async (req, res) => {
  const volta = (q) => res.redirect(`${appUrl() || ""}/promotor.html?mp=${q}`);
  try {
    configMP();
    const { code, state = "" } = req.query;
    const [uid, sig] = String(state).split(".");
    if (!code || !uid || !sig || assinar(uid) !== sig) return volta("erro");
    const redirectUri = `${getBaseUrl(req)}/mpCallback`;
    const r = await fetch(`${MP_API}/oauth/token`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: MP_CLIENT_ID, client_secret: MP_CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: redirectUri })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.error("oauth MP", r.status, j); return volta("erro"); }
    await db.collection("mp_tokens").doc(uid).set({ accessToken: j.access_token, refreshToken: j.refresh_token, mpUserId: j.user_id, expiraEm: Timestamp.fromMillis(Date.now() + j.expires_in * 1000), conectadoEm: FieldValue.serverTimestamp() });
    await db.collection("profissionais").doc(uid).set({ mpConectado: true, mpUserId: String(j.user_id) }, { merge: true });
    volta("ok");
  } catch (e) { console.error(e); volta("erro"); }
});

// ============================================================
// 5) COBRANÇA COM SPLIT (Checkout Pro / marketplace)
// ============================================================
app.post("/criarCobranca", envelope(async (req, res) => {
  const u = await usuario(req);
  const { solicitacaoId } = req.body || {};
  if (!solicitacaoId) throw new Falha(400, "pedido não informado");
  const ref = db.collection("solicitacoes").doc(String(solicitacaoId));
  const s = (await ref.get()).data();
  if (!s || s.uid !== u.uid) throw new Falha(403, "pedido de outra conta");
  if (s.status === "paga" || s.status === "concluida") throw new Falha(400, "pedido já pago", "ja-pago");
  if (s.status !== "aceita" || !s.promotorUid) throw new Falha(400, "pedido ainda não foi aceito por um promotor");
  await exigirCartao(u.uid);
  configMP();
  if (!urlPublicaHttps(appUrl())) throw new Falha(500, "APP_URL não configurada no servidor (precisa ser a URL https pública do site).", "app-url-invalida");

  const sp = splitDoPedido(s);
  const token = await tokenDoPromotor(s.promotorUid);
  const base = getBaseUrl(req);
  const corpo = {
    items: [{ id: String(solicitacaoId), title: `Reposição — ${s.loja}`.slice(0, 120), description: `${s.foco} · ${s.data} ${s.horario}`.slice(0, 200), quantity: 1, currency_id: "BRL", unit_price: reais(sp.total) }],
    marketplace_fee: reais(sp.app),
    external_reference: String(solicitacaoId),
    back_urls: ["success", "failure", "pending"].reduce((o, k) => ({ ...o, [k]: `${appUrl()}/pagar.html?id=${encodeURIComponent(solicitacaoId)}&retorno=${k}` }), {}),
    auto_return: "approved",
    statement_descriptor: "ABASTECEJA",
    payment_methods: { excluded_payment_types: [{ id: "ticket" }], installments: 1 }
  };
  if (urlPublicaHttps(base)) corpo.notification_url = `${base}/webhookMP?sid=${encodeURIComponent(solicitacaoId)}`; // MP recusa notification_url local/http
  const pref = await mp("/checkout/preferences", token, { method: "POST", body: JSON.stringify(corpo) });

  await db.collection("pagamentos_internos").doc(ref.id).set({ uid: u.uid, split: sp, preferenceId: pref.id, status: "iniciado", iniciadoEm: FieldValue.serverTimestamp() }, { merge: true });
  res.json({ init_point: pref.init_point, ...visaoLoja(sp) });
}));

// ============================================================
// 6) CONFIRMAÇÃO + NOTA (real e simulada passam pelo mesmo caminho)
// ============================================================
async function finalizarPagamento(sid, { paymentId, metodo, taxaMpCentavos = 0, simulado = false }) {
  const ref = db.collection("solicitacoes").doc(sid);
  const s = (await ref.get()).data();
  if (!s) throw new Falha(404, "pedido não encontrado");
  const sp = splitDoPedido(s);

  const notaId = await db.runTransaction(async (tx) => {
    const atual = (await tx.get(ref)).data();
    if (atual.status === "paga" || atual.status === "concluida") return atual.notaId || null;
    const contRef = db.collection("contadores").doc("notas");
    const proximo = ((await tx.get(contRef)).data()?.ultimo || 0) + 1;
    tx.set(contRef, { ultimo: proximo });
    const [ctnt, profPriv, prof] = await Promise.all([
      tx.get(db.collection("contratantes").doc(atual.uid)),
      tx.get(db.collection("profissionais_privado").doc(atual.promotorUid)),
      tx.get(db.collection("profissionais").doc(atual.promotorUid))
    ]);
    const c = ctnt.data() || {}, pp = profPriv.data() || {}, p = prof.data() || {};
    const nRef = db.collection("notas").doc();
    tx.set(nRef, {
      numero: proximo, numeroFmt: String(proximo).padStart(6, "0"), serie: "A1", tipo: "nota_servico_plataforma", fiscal: { nfse: null },
      solicitacaoId: sid, contratanteUid: atual.uid,                      // só a loja lê a nota; nada de repasse/comissão aqui
      tomador: { razaoSocial: c.razaoSocial || atual.loja, documento: c.documento || "", endereco: c.endereco || atual.loja, email: c.email || "" },
      prestador: { nome: p.nome || atual.promotorNome || "", documento: pp.cpf || "" },
      servico: { descricao: `Reposição/abastecimento — ${atual.foco}`, loja: atual.loja, data: atual.data, horario: atual.horario },
      valores: visaoLoja(sp),
      pagamento: { mpPaymentId: String(paymentId), metodo: metodo || "", simulado },
      emitidaEm: FieldValue.serverTimestamp()
    });
    tx.update(ref, { status: "paga", notaId: nRef.id, notaNumero: proximo, pagaEm: FieldValue.serverTimestamp() });
    tx.set(db.collection("pagamentos_internos").doc(sid), { uid: atual.uid, split: sp, status: "aprovado", mpPaymentId: String(paymentId), metodo: metodo || "", taxaMpCentavos, simulado, pagoEm: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(db.collection("solicitacoes_financeiro").doc(sid), { status: "pago", pagoEm: FieldValue.serverTimestamp() }, { merge: true });
    return nRef.id;
  });
  await bonusIndicacao(sid, s, sp).catch((e) => console.error("indicação", e));
  return { aprovado: true, notaId };
}

async function processarPagamento(sid, paymentId) {
  const ref = db.collection("solicitacoes").doc(sid);
  const s = (await ref.get()).data();
  if (!s) throw new Falha(404, "pedido não encontrado");
  if (s.status === "paga" || s.status === "concluida") return { jaPago: true, notaId: s.notaId || null };
  if (!s.promotorUid) throw new Falha(400, "pedido sem promotor");
  const sp = splitDoPedido(s);
  const token = await tokenDoPromotor(s.promotorUid);
  const pg = await mp(`/v1/payments/${encodeURIComponent(paymentId)}`, token);
  if (pg.external_reference !== sid) throw new Falha(400, "pagamento não pertence a este pedido");
  if (pg.status !== "approved") return { aprovado: false, status: pg.status };
  if (Math.round(pg.transaction_amount * 100) !== sp.total) {
    console.error("valor divergente", { sid, esperado: sp.total, recebido: pg.transaction_amount });
    throw new Falha(400, "valor pago diverge do pedido");
  }
  const taxaMp = Math.round((pg.fee_details || []).filter((f) => f.type === "mercadopago_fee").reduce((a, f) => a + f.amount, 0) * 100);
  return finalizarPagamento(sid, { paymentId, metodo: pg.payment_type_id, taxaMpCentavos: taxaMp });
}

async function bonusIndicacao(sid, s, sp) {
  const pRef = db.collection("profissionais").doc(s.promotorUid);
  const p = (await pRef.get()).data();
  if (!p?.indicadoPor || p.bonusIndicacaoPago) return;
  const q = await db.collection("profissionais").where("refCode", "==", p.indicadoPor).limit(1).get();
  if (q.empty || q.docs[0].id === s.promotorUid) return;
  await db.collection("indicacoes").add({ para: q.docs[0].id, de: s.promotorUid, valorCentavos: sp.royalty, solicitacaoId: sid, status: "a_pagar", criadoEm: FieldValue.serverTimestamp() });
  await pRef.update({ bonusIndicacaoPago: true });
}

function assinaturaValida(req, dataId) {
  if (!MP_WEBHOOK_SECRET) return true;
  const sig = req.get("x-signature") || "", reqId = req.get("x-request-id") || "";
  const ts = /ts=([^,]+)/.exec(sig)?.[1], v1 = /v1=([^,]+)/.exec(sig)?.[1];
  if (!ts || !v1) return false;
  const esperado = crypto.createHmac("sha256", MP_WEBHOOK_SECRET).update(`id:${String(dataId).toLowerCase()};request-id:${reqId};ts:${ts};`).digest("hex");
  return esperado.length === v1.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(v1));
}

app.all("/webhookMP", async (req, res) => {
  try {
    const sid = req.query.sid;
    const dataId = req.body?.data?.id || req.query["data.id"] || req.query.id;
    const tipo = req.body?.type || req.query.type || req.query.topic;
    if (!sid || !dataId || (tipo && tipo !== "payment")) return res.sendStatus(200);
    if (!assinaturaValida(req, dataId)) return res.sendStatus(401);
    await processarPagamento(String(sid), String(dataId));
    res.sendStatus(200);
  } catch (e) {
    console.error("webhook", e);
    res.sendStatus(e instanceof Falha && e.status < 500 ? 200 : 500);
  }
});

app.post("/confirmarPagamento", envelope(async (req, res) => {
  const u = await usuario(req);
  const { solicitacaoId, paymentId } = req.body || {};
  if (!solicitacaoId || !paymentId) throw new Falha(400, "dados incompletos");
  const s = (await db.collection("solicitacoes").doc(String(solicitacaoId)).get()).data();
  if (!s || s.uid !== u.uid) throw new Falha(403, "pedido de outra conta");
  res.json(await processarPagamento(String(solicitacaoId), String(paymentId)));
}));

/** SANDBOX: aprova um pagamento fictício, sem tocar no Mercado Pago. Gera nota normalmente. */
app.post("/teste/pagar", envelope(async (req, res) => {
  const u = await usuario(req); exigirTeste(u);
  const { solicitacaoId } = req.body || {};
  const s = (await db.collection("solicitacoes").doc(String(solicitacaoId || "x")).get()).data();
  if (!s || s.uid !== u.uid) throw new Falha(403, "pedido de outra conta");
  if (s.status === "paga") return res.json({ jaPago: true, notaId: s.notaId || null });
  if (s.status !== "aceita") throw new Falha(400, "pedido ainda não foi aceito por um promotor");
  await exigirCartao(u.uid);
  res.json(await finalizarPagamento(String(solicitacaoId), { paymentId: `TESTE-${Date.now()}`, metodo: "credit_card", simulado: true }));
}));

// ============================================================
// SITE ESTÁTICO (o Render serve o front junto) — sem expor código do servidor
// ============================================================
const RAIZ = path.join(__dirname, "..");
app.use((req, res, next) => {
  if (/^\/(server|functions|test|node_modules|\.git)(\/|$)/i.test(req.path) || /\.(md|rules|yaml|yml|json)$/i.test(req.path) && !/manifest\.json$/i.test(req.path)) return res.status(404).send("Not Found");
  next();
});
app.use(express.static(RAIZ, { dotfiles: "ignore" }));

// Rotas de API inexistentes respondem JSON (o front mostra mensagem clara em vez de "Not Found")
app.use((req, res) => {
  if (req.method !== "GET" || /^\/(mp|criar|aceitar|confirmar|webhook|cartao|teste)/.test(req.path)) return res.status(404).json({ erro: `rota não encontrada: ${req.method} ${req.path}`, codigo: "rota-inexistente" });
  res.status(404).send("Not Found");
});

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => console.log(`Servidor rodando na porta ${PORT}${MODO_TESTE ? " — MODO_TESTE ligado" : ""}`));
}
module.exports = { app, finalizarPagamento };
