// ⚠️ LEGADO — NÃO USE. O backend oficial agora é server/server.js (Render).
// Esta versão (Cloud Functions) ainda usa o modelo antigo de 80/20 e NÃO tem as regras novas
// (6 h, 3x/semana, cartão, royalty 3%, R$ 35/h). Mantida só como referência.
// ============================================================
// ABASTECE JÁ — Cloud Functions (Firebase, plano Blaze)
//
// O que este arquivo faz:
//  1. mpConectarUrl / mpCallback  → promotor conecta a conta Mercado Pago dele (OAuth)
//  2. criarCobranca               → cria o checkout com SPLIT AUTOMÁTICO (80% promotor / 20% app + taxa fixa)
//  3. webhookMP / confirmarPagamento → confirma o pagamento direto na API do MP, marca "paga" e emite a NOTA
//  4. onAvaliacao                 → recalcula a nota média do promotor
//
// Regra de ouro: NENHUM valor vem do navegador. O servidor lê o pedido no Firestore,
// calcula o split (split.js) e só aceita o pagamento se o valor bater ao centavo.
// ============================================================
const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret, defineString } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const crypto = require("crypto");
const { calcularSplit, VALOR_MINIMO_CENTAVOS, VALOR_MAXIMO_CENTAVOS } = require("./split");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

// Configuração (firebase functions:secrets:set / functions/.env)
const MP_CLIENT_SECRET = defineSecret("MP_CLIENT_SECRET");
const MP_WEBHOOK_SECRET = defineSecret("MP_WEBHOOK_SECRET"); // opcional (assinatura do webhook)
const MP_CLIENT_ID = defineString("MP_CLIENT_ID");
const APP_URL = defineString("APP_URL", { default: "https://SEU-USUARIO.github.io/abastece-ja" }); // onde o site está hospedado
const REGION = "southamerica-east1";
const opts = { region: REGION, cors: true, secrets: [MP_CLIENT_SECRET, MP_WEBHOOK_SECRET] };

const MP_API = "https://api.mercadopago.com";
const funcUrl = (nome) => `https://${REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/${nome}`;
const appUrl = () => APP_URL.value().replace(/\/$/, "");

class Falha extends Error { constructor(status, msg, codigo) { super(msg); this.status = status; this.codigo = codigo; } }

// ---------- utilidades ----------
async function usuario(req) {
  const h = req.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : req.body?.idToken;
  if (!token) throw new Falha(401, "login necessário");
  try { return await admin.auth().verifyIdToken(token); } catch { throw new Falha(401, "sessão inválida"); }
}
const envelope = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e instanceof Falha) return res.status(e.status).json({ erro: e.message, codigo: e.codigo });
    logger.error(e); res.status(500).json({ erro: "erro interno" });
  }
};
const assinar = (texto) => crypto.createHmac("sha256", MP_CLIENT_SECRET.value()).update(texto).digest("hex");

async function mp(path, token, init = {}) {
  const r = await fetch(MP_API + path, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { logger.error("MP erro", path, r.status, j); throw new Falha(502, "Mercado Pago recusou a operação", "mp"); }
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
    body: JSON.stringify({ client_id: MP_CLIENT_ID.value(), client_secret: MP_CLIENT_SECRET.value(), grant_type: "refresh_token", refresh_token: t.refreshToken })
  });
  const j = await r.json();
  if (!r.ok) { logger.error("refresh MP", j); throw new Falha(400, "Conexão do promotor com o Mercado Pago expirou. Peça para ele reconectar.", "promotor-sem-mp"); }
  await ref.set({ accessToken: j.access_token, refreshToken: j.refresh_token, expiraEm: Timestamp.fromMillis(Date.now() + j.expires_in * 1000) }, { merge: true });
  return j.access_token;
}

/** Valor do pedido em centavos, validado. */
function valorDoPedido(s) {
  const c = Number.isInteger(s.valorCentavos) ? s.valorCentavos : Math.round(Number(s.valor) * 100);
  if (!(c >= VALOR_MINIMO_CENTAVOS && c <= VALOR_MAXIMO_CENTAVOS)) throw new Falha(400, "valor do pedido fora do permitido");
  return c;
}

// ============================================================
// 1) CONECTAR MERCADO PAGO (OAuth do promotor)
// ============================================================
exports.mpConectarUrl = onRequest(opts, envelope(async (req, res) => {
  const u = await usuario(req);
  const prof = await db.collection("profissionais").doc(u.uid).get();
  if (!prof.exists) throw new Falha(403, "cadastro de promotor não encontrado");
  const state = `${u.uid}.${assinar(u.uid)}`;
  const url = `https://auth.mercadopago.com.br/authorization?client_id=${MP_CLIENT_ID.value()}&response_type=code&platform_id=mp&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(funcUrl("mpCallback"))}`;
  res.json({ url });
}));

exports.mpCallback = onRequest({ region: REGION, secrets: [MP_CLIENT_SECRET] }, async (req, res) => {
  const volta = (q) => res.redirect(`${appUrl()}/promotor.html?mp=${q}`);
  try {
    const { code, state = "" } = req.query;
    const [uid, sig] = String(state).split(".");
    if (!code || !uid || !sig || assinar(uid) !== sig) return volta("erro");
    const r = await fetch(`${MP_API}/oauth/token`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: MP_CLIENT_ID.value(), client_secret: MP_CLIENT_SECRET.value(), grant_type: "authorization_code", code, redirect_uri: funcUrl("mpCallback") })
    });
    const j = await r.json();
    if (!r.ok) { logger.error("oauth MP", j); return volta("erro"); }
    await db.collection("mp_tokens").doc(uid).set({
      accessToken: j.access_token, refreshToken: j.refresh_token, mpUserId: j.user_id,
      expiraEm: Timestamp.fromMillis(Date.now() + j.expires_in * 1000), conectadoEm: FieldValue.serverTimestamp()
    });
    await db.collection("profissionais").doc(uid).set({ mpConectado: true, mpUserId: String(j.user_id) }, { merge: true });
    volta("ok");
  } catch (e) { logger.error(e); volta("erro"); }
});

// ============================================================
// 2) COBRANÇA COM SPLIT
// ============================================================
exports.criarCobranca = onRequest(opts, envelope(async (req, res) => {
  const u = await usuario(req);
  const { solicitacaoId } = req.body || {};
  if (!solicitacaoId) throw new Falha(400, "pedido não informado");
  const ref = db.collection("solicitacoes").doc(solicitacaoId);
  const s = (await ref.get()).data();
  if (!s || s.uid !== u.uid) throw new Falha(403, "pedido de outra conta");
  if (s.status === "paga" || s.status === "concluida") throw new Falha(400, "pedido já pago", "ja-pago");
  if (s.status !== "aceita" || !s.promotorUid) throw new Falha(400, "pedido ainda não foi aceito por um promotor");

  const split = calcularSplit(valorDoPedido(s));
  const token = await tokenDoPromotor(s.promotorUid);

  // O token do PROMOTOR cria a cobrança; marketplace_fee é a parte do app (comissão + taxa fixa).
  // Assim o Mercado Pago já divide no ato do pagamento: o promotor recebe direto na conta dele.
  const pref = await mp("/checkout/preferences", token, {
    method: "POST",
    body: JSON.stringify({
      items: [{ id: solicitacaoId, title: `Reposição — ${s.loja}`.slice(0, 120), description: `${s.foco} · ${s.data} ${s.horario}`, quantity: 1, unit_price: split.total / 100, currency_id: "BRL" }],
      marketplace_fee: split.app / 100,
      external_reference: solicitacaoId,
      payer: u.email ? { email: u.email } : undefined,
      notification_url: `${funcUrl("webhookMP")}?sid=${encodeURIComponent(solicitacaoId)}`,
      back_urls: ["success", "failure", "pending"].reduce((o, k) => ({ ...o, [k]: `${appUrl()}/pagar.html?id=${encodeURIComponent(solicitacaoId)}&retorno=${k}` }), {}),
      auto_return: "approved",
      statement_descriptor: "ABASTECEJA",
      payment_methods: { excluded_payment_types: [{ id: "ticket" }], installments: 1 }
    })
  });
  await ref.update({ pagamento: { preferenceId: pref.id, status: "iniciado", split, iniciadoEm: FieldValue.serverTimestamp() } });
  res.json({ init_point: pref.init_point, split });
}));

// ============================================================
// 3) CONFIRMAÇÃO + NOTA
// ============================================================
async function processarPagamento(sid, paymentId) {
  const ref = db.collection("solicitacoes").doc(sid);
  const s = (await ref.get()).data();
  if (!s) throw new Falha(404, "pedido não encontrado");
  if (s.status === "paga" || s.status === "concluida") return { jaPago: true, notaId: s.notaId || null };
  if (!s.promotorUid) throw new Falha(400, "pedido sem promotor");

  const split = calcularSplit(valorDoPedido(s));
  const token = await tokenDoPromotor(s.promotorUid);
  const pg = await mp(`/v1/payments/${encodeURIComponent(paymentId)}`, token);   // fonte da verdade: API do MP

  if (pg.external_reference !== sid) throw new Falha(400, "pagamento não pertence a este pedido");
  if (pg.status !== "approved") return { aprovado: false, status: pg.status };
  if (Math.round(pg.transaction_amount * 100) !== split.total) {
    logger.error("valor divergente", { sid, esperado: split.total, recebido: pg.transaction_amount });
    throw new Falha(400, "valor pago diverge do pedido");
  }

  // Transação: garante UMA nota por pagamento mesmo se webhook e retorno chegarem juntos.
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
      numero: proximo, numeroFmt: String(proximo).padStart(6, "0"), serie: "A1",
      tipo: "nota_servico_plataforma",            // NÃO é NFS-e. Ver README (integração fiscal).
      fiscal: { nfse: null },                      // ← aqui entra o retorno de eNotas/Focus NFe/PlugNotas, se contratar
      solicitacaoId: sid, contratanteUid: atual.uid, promotorUid: atual.promotorUid,
      tomador: { razaoSocial: c.razaoSocial || atual.loja, documento: c.documento || "", endereco: c.endereco || atual.loja, email: c.email || "" },
      prestador: { nome: p.nome || atual.promotorNome || "", documento: pp.cpf || "" },
      servico: { descricao: `Reposição/abastecimento — ${atual.foco}`, loja: atual.loja, data: atual.data, horario: atual.horario },
      valores: split,
      pagamento: { mpPaymentId: String(paymentId), metodo: pg.payment_type_id || "", taxaMpCentavos: Math.round((pg.fee_details || []).filter((f) => f.type === "mercadopago_fee").reduce((a, f) => a + f.amount, 0) * 100) },
      emitidaEm: FieldValue.serverTimestamp()
    });
    tx.update(ref, {
      status: "paga", notaId: nRef.id, notaNumero: proximo, pagaEm: FieldValue.serverTimestamp(),
      pagamento: { status: "aprovado", mpPaymentId: String(paymentId), split, metodo: pg.payment_type_id || "" }
    });
    return nRef.id;
  });

  await bonusIndicacao(sid, s, split).catch((e) => logger.error("indicação", e));
  return { aprovado: true, notaId };
}

/** 1º turno pago de um promotor indicado: a comissão do app desse turno vira crédito de quem indicou. */
async function bonusIndicacao(sid, s, split) {
  const pRef = db.collection("profissionais").doc(s.promotorUid);
  const p = (await pRef.get()).data();
  if (!p?.indicadoPor || p.bonusIndicacaoPago) return;
  const q = await db.collection("profissionais").where("refCode", "==", p.indicadoPor).limit(1).get();
  if (q.empty || q.docs[0].id === s.promotorUid) return;
  await db.collection("indicacoes").add({ para: q.docs[0].id, de: s.promotorUid, valorCentavos: split.comissaoApp, solicitacaoId: sid, status: "a_pagar", criadoEm: FieldValue.serverTimestamp() });
  await pRef.update({ bonusIndicacaoPago: true });
}

function assinaturaValida(req, dataId) {
  const secret = MP_WEBHOOK_SECRET.value();
  if (!secret) return true; // sem segredo configurado: a verificação na API do MP continua protegendo
  const sig = req.get("x-signature") || "", reqId = req.get("x-request-id") || "";
  const ts = /ts=([^,]+)/.exec(sig)?.[1], v1 = /v1=([^,]+)/.exec(sig)?.[1];
  if (!ts || !v1) return false;
  const esperado = crypto.createHmac("sha256", secret).update(`id:${String(dataId).toLowerCase()};request-id:${reqId};ts:${ts};`).digest("hex");
  return esperado.length === v1.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(v1));
}

exports.webhookMP = onRequest(opts, async (req, res) => {
  try {
    const sid = req.query.sid;
    const dataId = req.body?.data?.id || req.query["data.id"] || req.query.id;
    const tipo = req.body?.type || req.query.type || req.query.topic;
    if (!sid || !dataId || (tipo && tipo !== "payment")) return res.sendStatus(200);
    if (!assinaturaValida(req, dataId)) return res.sendStatus(401);
    await processarPagamento(String(sid), String(dataId));
    res.sendStatus(200);
  } catch (e) {
    logger.error("webhook", e);
    res.sendStatus(e instanceof Falha && e.status < 500 ? 200 : 500); // 5xx faz o MP tentar de novo
  }
});

/** A página pagar.html chama isto ao voltar do checkout (não depende de o webhook já ter chegado). */
exports.confirmarPagamento = onRequest(opts, envelope(async (req, res) => {
  const u = await usuario(req);
  const { solicitacaoId, paymentId } = req.body || {};
  if (!solicitacaoId || !paymentId) throw new Falha(400, "dados incompletos");
  const s = (await db.collection("solicitacoes").doc(solicitacaoId).get()).data();
  if (!s || s.uid !== u.uid) throw new Falha(403, "pedido de outra conta");
  res.json(await processarPagamento(solicitacaoId, paymentId));
}));

// ============================================================
// 4) AVALIAÇÃO → nota média do promotor
// ============================================================
exports.onAvaliacao = onDocumentUpdated({ document: "solicitacoes/{id}", region: REGION }, async (ev) => {
  const antes = ev.data.before.data(), depois = ev.data.after.data();
  const est = depois?.avaliacao?.estrelas;
  if (!(est >= 1 && est <= 5) || antes?.avaliacao?.estrelas || !depois.promotorUid) return; // só conta a 1ª avaliação (as regras já impedem edição)
  const ref = db.collection("profissionais").doc(depois.promotorUid);
  await db.runTransaction(async (tx) => {
    const p = (await tx.get(ref)).data() || {};
    const qtd = (p.ratingQtd || 0) + 1, soma = (p.ratingSoma || 0) + est;
    tx.set(ref, { ratingQtd: qtd, ratingSoma: soma, ratingMedia: Math.round((soma / qtd) * 10) / 10 }, { merge: true });
  });
});
