// =============================================================================
// ABASTECE JÁ — Cloud Functions (pagamento com split + nota)
// Deploy:  firebase deploy --only functions      (plano Blaze)
//
// Fluxo:
//  1. Loja abre pagar.html → criarCobranca cria a preferência no Mercado Pago
//     COM o token do promotor e marketplace_fee = parte do app (20% + taxa fixa).
//  2. Mercado Pago divide sozinho: promotor recebe o líquido, app recebe a fee.
//  3. webhookMP confirma o pagamento direto na API do MP, marca o pedido como
//     "concluida" e emite a NOTA (coleção "notas") — nunca confiamos no navegador.
//
// Secrets (firebase functions:secrets:set NOME):
//   MP_APP_ID, MP_APP_SECRET   → aplicação do APP em mercadopago.com.br/developers
//   MP_WEBHOOK_SECRET          → "Assinatura secreta" do webhook (opcional, recomendado)
// Config no arquivo functions/.env:  SITE_URL=https://seu-dominio.com
// =============================================================================
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;

// ⚠️ Mesmos números de financeiro.js (front). Em CENTAVOS.
const TAXA_PROMOTOR = 0.8;
const TAXA_FIXA_CENTAVOS = 300;
const SECRETS = ["MP_APP_ID", "MP_APP_SECRET", "MP_WEBHOOK_SECRET"];
const SITE = () => (process.env.SITE_URL || "").replace(/\/$/, "");

function calcular(valorReais) {
    const base = Math.round(Number(valorReais) * 100);
    if (!Number.isFinite(base) || base <= 0) throw new Error("valor inválido");
    const promotor = Math.round(base * TAXA_PROMOTOR);
    const comissao = base - promotor;
    return { base, promotor, comissao, fixa: TAXA_FIXA_CENTAVOS, app: comissao + TAXA_FIXA_CENTAVOS, total: base + TAXA_FIXA_CENTAVOS };
}
const reais = (c) => Math.round(c) / 100;
const fail = (res, code, erro) => res.status(code).json({ erro });

// ---------------------------------------------------------------------------
// 1) Cobrança
// ---------------------------------------------------------------------------
exports.criarCobranca = onRequest({ cors: true, secrets: SECRETS }, async (req, res) => {
    try {
        const { solicitacaoId, idToken } = req.body || {};
        if (!solicitacaoId || !idToken) return fail(res, 400, "dados incompletos");
        const user = await admin.auth().verifyIdToken(idToken);
        const ref = db.collection("solicitacoes").doc(String(solicitacaoId));
        const s = (await ref.get()).data();
        if (!s || s.uid !== user.uid) return fail(res, 403, "pedido de outra conta");
        if (s.status === "concluida") return fail(res, 400, "pedido já pago");
        if (s.status !== "aceita") return fail(res, 400, "pedido ainda não foi aceito por um promotor");

        const seg = (await db.collection("segredos").doc(s.promotorChave).get()).data();
        if (!seg?.mpAccessToken) return fail(res, 400, "promotor ainda não conectou o Mercado Pago");

        const v = calcular(s.valor);
        const mp = new MercadoPagoConfig({ accessToken: seg.mpAccessToken });
        const pref = await new Preference(mp).create({ body: {
            items: [
                { id: "turno", title: `Reposição — ${s.loja}`, quantity: 1, unit_price: reais(v.base), currency_id: "BRL" },
                { id: "taxa", title: "Taxa de serviço Abastece Já", quantity: 1, unit_price: reais(v.fixa), currency_id: "BRL" }
            ],
            marketplace_fee: reais(v.app),
            external_reference: ref.id,
            notification_url: `${process.env.FUNCTION_URL_WEBHOOK || ""}?sid=${ref.id}`,
            back_urls: { success: `${SITE()}/nota.html?id=${ref.id}`, pending: `${SITE()}/pagar.html?id=${ref.id}`, failure: `${SITE()}/pagar.html?id=${ref.id}` },
            auto_return: "approved",
            payment_methods: { excluded_payment_types: [{ id: "ticket" }] }
        }});
        await ref.update({ cobrancaCriadaEm: FieldValue.serverTimestamp(), preferenciaId: pref.id, split: v });
        res.json({ init_point: pref.init_point });
    } catch (e) { console.error(e); fail(res, 500, "falha ao criar cobrança"); }
});

// ---------------------------------------------------------------------------
// 2) Webhook: confirma, conclui, emite nota, paga bônus de indicação
// ---------------------------------------------------------------------------
function assinaturaOk(req, paymentId) {
    const secret = process.env.MP_WEBHOOK_SECRET;
    if (!secret) return true; // sem segredo configurado, só a consulta à API do MP protege
    const sig = String(req.get("x-signature") || ""), reqId = String(req.get("x-request-id") || "");
    const ts = (sig.match(/ts=([^,]+)/) || [])[1], v1 = (sig.match(/v1=([^,]+)/) || [])[1];
    if (!ts || !v1) return false;
    const calc = crypto.createHmac("sha256", secret).update(`id:${paymentId};request-id:${reqId};ts:${ts};`).digest("hex");
    try { return crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(v1)); } catch { return false; }
}

exports.webhookMP = onRequest({ secrets: SECRETS }, async (req, res) => {
    try {
        const sid = req.query.sid;
        const paymentId = req.body?.data?.id || req.query["data.id"];
        if (!sid || !paymentId) return res.sendStatus(200);
        if (!assinaturaOk(req, paymentId)) return res.sendStatus(401);

        const ref = db.collection("solicitacoes").doc(String(sid));
        const s = (await ref.get()).data();
        if (!s || s.status === "concluida") return res.sendStatus(200); // idempotente
        const prof = (await db.collection("profissionais").doc(s.promotorChave).get()).data() || {};
        const seg = (await db.collection("segredos").doc(s.promotorChave).get()).data();
        if (!seg?.mpAccessToken) return res.sendStatus(200);

        // Confirma na fonte (API do MP): status, referência e VALOR PAGO
        const pg = await new Payment(new MercadoPagoConfig({ accessToken: seg.mpAccessToken })).get({ id: paymentId });
        const v = calcular(s.valor);
        if (pg.status !== "approved" || pg.external_reference !== ref.id) return res.sendStatus(200);
        if (Math.round(pg.transaction_amount * 100) !== v.total) { console.error("valor divergente", sid); return res.sendStatus(200); }

        await db.runTransaction(async (t) => {
            const atual = (await t.get(ref)).data();
            if (atual.status === "concluida") return;
            const notaRef = db.collection("notas").doc(ref.id);
            t.update(ref, { status: "concluida", pagoEm: FieldValue.serverTimestamp(), paymentId: String(paymentId), notaId: notaRef.id });
            t.set(notaRef, {
                solicitacaoId: ref.id, numero: Date.now().toString().slice(-8),
                contratanteUid: s.uid, contratanteEmail: s.email || "",
                contratanteDoc: s.docNota || "", contratanteNome: s.nomeNota || s.loja,
                promotorChave: s.promotorChave, promotorUid: s.promotorUid || "", promotorNome: s.promotorNome || "",
                loja: s.loja, data: s.data, horario: s.horario, setor: s.foco,
                valorTurno: reais(v.base), repassePromotor: reais(v.promotor), comissaoApp: reais(v.comissao),
                taxaFixa: reais(v.fixa), totalPago: reais(v.total),
                formaPagamento: pg.payment_type_id || "pix", paymentId: String(paymentId),
                tipo: "recibo_servico",        // NÃO é nota fiscal — ver fiscal.emitir abaixo
                emitidaEm: FieldValue.serverTimestamp()
            });
        });

        // Bônus de indicação: 1º turno concluído do promotor → quem indicou ganha a comissão do app desse turno
        if (prof.indicadoPor && !prof.bonusIndicacaoPago) {
            const q = await db.collection("profissionais").where("refCode", "==", prof.indicadoPor).limit(1).get();
            if (!q.empty && q.docs[0].id !== s.promotorChave) {
                await db.collection("indicacoes").add({ para: q.docs[0].id, de: s.promotorChave, valor: reais(v.comissao), solicitacaoId: ref.id, criadoEm: FieldValue.serverTimestamp() });
                await db.collection("profissionais").doc(s.promotorChave).update({ bonusIndicacaoPago: true });
            }
        }
        // 🧾 NOTA FISCAL de verdade (NFS-e): plugue aqui um provedor (eNotas, Focus NFe, PlugNotas...).
        // await fiscal.emitir(notaRef.id)  — exige CNPJ do app + certificado + inscrição municipal.
        res.sendStatus(200);
    } catch (e) { console.error(e); res.sendStatus(500); }
});

// ---------------------------------------------------------------------------
// 3) Conectar a conta Mercado Pago do promotor (OAuth) — é o que habilita o split
// ---------------------------------------------------------------------------
exports.mpConectarUrl = onRequest({ cors: true, secrets: SECRETS }, async (req, res) => {
    try {
        const user = await admin.auth().verifyIdToken(req.body?.idToken || "");
        const chave = String(req.body?.chave || "");
        const prof = (await db.collection("profissionais").doc(chave).get()).data();
        if (!prof || (prof.uid && prof.uid !== user.uid)) return fail(res, 403, "perfil de outra conta");
        const state = crypto.randomBytes(16).toString("hex");
        await db.collection("mpOauthState").doc(state).set({ chave, uid: user.uid, criadoEm: FieldValue.serverTimestamp() });
        const redirect = encodeURIComponent(process.env.FUNCTION_URL_CALLBACK || "");
        res.json({ url: `https://auth.mercadopago.com.br/authorization?client_id=${process.env.MP_APP_ID}&response_type=code&platform_id=mp&state=${state}&redirect_uri=${redirect}` });
    } catch (e) { console.error(e); fail(res, 500, "falha ao iniciar conexão"); }
});

exports.mpCallback = onRequest({ secrets: SECRETS }, async (req, res) => {
    try {
        const { code, state } = req.query;
        const st = await db.collection("mpOauthState").doc(String(state)).get();
        if (!st.exists) return res.status(400).send("Link expirado. Volte ao app e tente de novo.");
        const r = await fetch("https://api.mercadopago.com/oauth/token", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_id: process.env.MP_APP_ID, client_secret: process.env.MP_APP_SECRET, grant_type: "authorization_code", code, redirect_uri: process.env.FUNCTION_URL_CALLBACK })
        });
        const tk = await r.json();
        if (!tk.access_token) { console.error(tk); return res.status(400).send("Mercado Pago recusou a conexão."); }
        // token fica em "segredos" (nenhum cliente lê); no perfil público só vai o "conectado"
        await db.collection("segredos").doc(st.data().chave).set({ mpAccessToken: tk.access_token, mpRefreshToken: tk.refresh_token || "", mpUserId: String(tk.user_id || ""), atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
        await db.collection("profissionais").doc(st.data().chave).set({ mpConectado: true, mpConectadoEm: FieldValue.serverTimestamp() }, { merge: true });
        await st.ref.delete();
        res.redirect(`${SITE()}/promotor.html?mp=ok`);
    } catch (e) { console.error(e); res.status(500).send("Erro ao conectar."); }
});

// ---------------------------------------------------------------------------
// 4) Média de avaliações do promotor (a loja só avalia depois de pagar)
// ---------------------------------------------------------------------------
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
exports.aoAvaliar = onDocumentUpdated("solicitacoes/{id}", async (event) => {
    const antes = event.data.before.data(), depois = event.data.after.data();
    if (antes.avaliacao || !depois.avaliacao || !depois.promotorChave) return;
    const nota = Math.min(5, Math.max(1, Number(depois.avaliacao.nota) || 0));
    if (!nota) return;
    const ref = db.collection("profissionais").doc(depois.promotorChave);
    await db.runTransaction(async (t) => {
        const p = (await t.get(ref)).data() || {};
        const qtd = (p.notaQtd || 0) + 1;
        t.set(ref, { notaQtd: qtd, notaMedia: Math.round((((p.notaMedia || 0) * (qtd - 1) + nota) / qtd) * 100) / 100 }, { merge: true });
    });
});
