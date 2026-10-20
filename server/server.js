// ============================================================
// ABASTECE JÁ — Servidor Node.js / Express (Render - 100% Gratuito)
// ============================================================
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const crypto = require("crypto");
const path = require("path");
const { calcularSplit, VALOR_MINIMO_CENTAVOS, VALOR_MAXIMO_CENTAVOS } = require("./split");

const app = express();
app.set("trust proxy", 1); // o Render fica na frente: confia no x-forwarded-proto
app.use(cors({ origin: true })); // a autenticação é por token Bearer (sem cookies), então origin aberto é seguro
app.use(express.json());

// IMPORTANTE: Diz para o Render servir os arquivos do front-end que estão na raiz do projeto
app.use(express.static(path.join(__dirname, '../')));

// Inicializa o Firebase Admin SDK.
function credencialFirebase() {
  const bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!bruto) return null;
  const texto = bruto.trim().startsWith("{") ? bruto : Buffer.from(bruto, "base64").toString("utf8");
  return admin.credential.cert(JSON.parse(texto));
}
if (!admin.apps.length) {
  const credential = credencialFirebase();
  if (!credential) console.error("⚠️  FIREBASE_SERVICE_ACCOUNT não definida: o acesso ao Firestore vai falhar.");
  admin.initializeApp(credential ? { credential } : undefined);
}
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

// Configuração via variáveis de ambiente (Environment Variables no Render)
const MP_CLIENT_SECRET = process.env.MP_CLIENT_SECRET || "";
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || "";
const MP_CLIENT_ID = process.env.MP_CLIENT_ID || "";
const APP_URL = process.env.APP_URL || "https://SEU-USUARIO.github.io/abastece-ja";
const PORT = process.env.PORT || 3000;

const MP_API = "https://api.mercadopago.com";

// Função utilitária para pegar a URL base do servidor
const getBaseUrl = (req) => {
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "");
  const host = req.get("host");
  const protocol = req.protocol === "https" || req.get("x-forwarded-proto") === "https" ? "https" : "http";
  return `${protocol}://${host}`;
};

const appUrl = () => APP_URL.replace(/\/$/, "");

class Falha extends Error {
  constructor(status, msg, codigo) {
    super(msg);
    this.status = status;
    this.codigo = codigo;
  }
}

// ---------- Utilidades e Autenticação ----------
async function usuario(req) {
  const h = req.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : req.body?.idToken || req.query?.idToken;
  if (!token) throw new Falha(401, "login necessário");
  try {
    return await admin.auth().verifyIdToken(token);
  } catch {
    throw new Falha(401, "sessão inválida");
  }
}

const envelope = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof Falha) {
      return res.status(e.status).json({ erro: e.message, codigo: e.codigo });
    }
    console.error(e);
    res.status(500).json({ erro: "erro interno" });
  }
};

const assinar = (texto) => crypto.createHmac("sha256", MP_CLIENT_SECRET).update(texto).digest("hex");

async function mp(path, token, init = {}) {
  const r = await fetch(MP_API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("MP erro", path, r.status, j);
    throw new Falha(502, "Mercado Pago recusou a operação", "mp");
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
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: MP_CLIENT_ID,
      client_secret: MP_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: t.refreshToken
    })
  });
  const j = await r.json();
  if (!r.ok) {
    console.error("refresh MP", j);
    throw new Falha(400, "Conexão do promotor com o Mercado Pago expirou. Peça para ele reconectar.", "promotor-sem-mp");
  }
  await ref.set(
    { accessToken: j.access_token, refreshToken: j.refresh_token, expiraEm: Timestamp.fromMillis(Date.now() + j.expires_in * 1000) },
    { merge: true }
  );
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
app.all("/mpConectarUrl", envelope(async (req, res) => {
  const { uid } = await usuario(req);

  if (!MP_CLIENT_ID || !MP_CLIENT_SECRET) {
    console.error("MP_CLIENT_ID / MP_CLIENT_SECRET não configurados no Render.");
    throw new Falha(500, "Mercado Pago não configurado no servidor.", "mp-nao-configurado");
  }

  const prof = await db.collection("profissionais").doc(uid).get();
  if (!prof.exists) throw new Falha(403, "cadastro de promotor não encontrado");

  const redirectUri = `${getBaseUrl(req)}/mpCallback`;
  const state = `${uid}.${assinar(uid)}`;
  const url = `https://auth.mercadopago.com.br/authorization?client_id=${MP_CLIENT_ID}&response_type=code&platform_id=mp&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.json({ url });
}));

app.get("/mpCallback", async (req, res) => {
  const volta = (q) => res.redirect(`${appUrl()}/promotor.html?mp=${q}`);
  try {
    const { code, state = "" } = req.query;
    const [uid, sig] = String(state).split(".");
    if (!code || !uid || !sig || assinar(uid) !== sig) return volta("erro");

    const redirectUri = `${getBaseUrl(req)}/mpCallback`;
    const r = await fetch(`${MP_API}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: MP_CLIENT_ID,
        client_secret: MP_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri
      })
    });
    const j = await r.json();
    if (!r.ok) {
      console.error("oauth MP", j);
      return volta("erro");
    }

    await db.collection("mp_tokens").doc(uid).set({
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      mpUserId: j.user_id,
      expiraEm: Timestamp.fromMillis(Date.now() + j.expires_in * 1000),
      conectadoEm: FieldValue.serverTimestamp()
    });
    await db.collection("profissionais").doc(uid).set({ mpConectado: true, mpUserId: String(j.user_id) }, { merge: true });

    volta("ok");
  } catch (e) {
    console.error(e);
    volta("erro");
  }
});

// ============================================================
// 2) COBRANÇA COM SPLIT
// ============================================================
app.post("/criarCobranca", envelope(async (req, res) => {
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

  const pref = await mp("/checkout/preferences", token, {
    method: "POST",
    body: JSON.stringify({
      items: [{
        id: solicitacaoId,
        title: `Reposição — ${s.loja}`.slice(0, 120),
        description: `${s.foco} · ${s.data} ${s.horario}`,
        quantity: 1,
        unit_price: split.total / 100,
        currency_id: "BRL"
      }],
      marketplace_fee: split.app / 100,
      external_reference: solicitacaoId,
      payer: u.email ? { email: u.email } : undefined,
      notification_url: `${getBaseUrl(req)}/webhookMP?sid=${encodeURIComponent(solicitacaoId)}`,
      back_urls: ["success", "failure", "pending"].reduce((o, k) => ({
        ...o,
        [k]: `${appUrl()}/pagar.html?id=${encodeURIComponent(solicitacaoId)}&retorno=${k}`
      }), {}),
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
  const pg = await mp(`/v1/payments/${encodeURIComponent(paymentId)}`, token);

  if (pg.external_reference !== sid) throw new Falha(400, "pagamento não pertence a este pedido");
  if (pg.status !== "approved") return { aprovado: false, status: pg.status };
  if (Math.round(pg.transaction_amount * 100) !== split.total) {
    console.error("valor divergente", { sid, esperado: split.total, recebido: pg.transaction_amount });
    throw new Falha(400, "valor pago diverge do pedido");
  }

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
      numero: proximo,
      numeroFmt: String(proximo).padStart(6, "0"),
      serie: "A1",
      tipo: "nota_servico_plataforma",
      fiscal: { nfse: null },
      solicitacaoId: sid,
      contratanteUid: atual.uid,
      promotorUid: atual.promotorUid,
      tomador: { razaoSocial: c.razaoSocial || atual.loja, documento: c.documento || "", endereco: c.endereco || atual.loja, email: c.email || "" },
      prestador: { nome: p.nome || atual.promotorNome || "", documento: pp.cpf || "" },
      servico: { descricao: `Reposição/abastecimento — ${atual.foco}`, loja: atual.loja, data: atual.data, horario: atual.horario },
      valores: split,
      pagamento: {
        mpPaymentId: String(paymentId),
        metodo: pg.payment_type_id || "",
        taxaMpCentavos: Math.round((pg.fee_details || []).filter((f) => f.type === "mercadopago_fee").reduce((a, f) => a + f.amount, 0) * 100)
      },
      emitidaEm: FieldValue.serverTimestamp()
    });
    tx.update(ref, {
      status: "paga",
      notaId: nRef.id,
      notaNumero: proximo,
      pagaEm: FieldValue.serverTimestamp(),
      pagamento: { status: "aprovado", mpPaymentId: String(paymentId), split, metodo: pg.payment_type_id || "" }
    });
    return nRef.id;
  });

  await bonusIndicacao(sid, s, split).catch((e) => console.error("indicação", e));
  return { aprovado: true, notaId };
}

async function bonusIndicacao(sid, s, split) {
  const pRef = db.collection("profissionais").doc(s.promotorUid);
  const p = (await pRef.get()).data();
  if (!p?.indicadoPor || p.bonusIndicacaoPago) return;
  const q = await db.collection("profissionais").where("refCode", "==", p.indicadoPor).limit(1).get();
  if (q.empty || q.docs[0].id === s.promotorUid) return;
  await db.collection("indicacoes").add({
    para: q.docs[0].id,
    de: s.promotorUid,
    valorCentavos: split.comissaoApp,
    solicitacaoId: sid,
    status: "a_pagar",
    criadoEm: FieldValue.serverTimestamp()
  });
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
  const s = (await db.collection("solicitacoes").doc(solicitacaoId).get()).data();
  if (!s || s.uid !== u.uid) throw new Falha(403, "pedido de outra conta");
  res.json(await processarPagamento(solicitacaoId, paymentId));
}));

// Rota coringa para lidar com rotas de API inexistentes em JSON
app.use((req, res, next) => {
  if (req.path.startsWith('/mpConectarUrl') || req.path.startsWith('/criarCobranca') || req.path.startsWith('/confirmarPagamento') || req.path.startsWith('/webhookMP')) {
    return res.status(404).json({ erro: `rota não encontrada: ${req.method} ${req.path}`, codigo: "rota-inexistente" });
  }
  next();
});

// Inicialização do servidor na porta do Render
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
