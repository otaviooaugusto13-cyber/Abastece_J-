// Cloud Function (Firebase) — cria a cobrança no Mercado Pago com split de 15%.
// Deploy: firebase deploy --only functions   (plano Blaze necessário)
// Depois cole a URL gerada em PAGAMENTO_ENDPOINT dentro de pagar.html.
//
// REQUISITOS (não dá para pular):
//  1. Conta Mercado Pago do APLICATIVO com aplicação criada em mercadopago.com.br/developers
//  2. Cada promotor precisa conectar a conta Mercado Pago dele (OAuth). O token dele fica em
//     profissionais/{chave}.mpAccessToken (gravado por outra função, nunca pelo navegador).
//  3. Secrets: firebase functions:secrets:set MP_APP_TOKEN
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { MercadoPagoConfig, Preference } = require("mercadopago");
admin.initializeApp();
const db = admin.firestore();
const TAXA = 0.15;

exports.criarCobranca = onRequest({ cors: true, secrets: ["MP_APP_TOKEN"] }, async (req, res) => {
  try {
    const { solicitacaoId, idToken } = req.body;
    const user = await admin.auth().verifyIdToken(idToken);
    const ref = db.collection("solicitacoes").doc(solicitacaoId);
    const s = (await ref.get()).data();
    if (!s || s.uid !== user.uid) return res.status(403).json({ erro: "pedido de outra conta" });
    if (s.status !== "aceita") return res.status(400).json({ erro: "pedido não está aceito" });

    const prof = (await db.collection("profissionais").doc(s.promotorChave).get()).data();
    if (!prof?.mpAccessToken) return res.status(400).json({ erro: "promotor sem Mercado Pago conectado" });

    // O token do PROMOTOR cria a cobrança; marketplace_fee é a parte do app (15%).
    const mp = new MercadoPagoConfig({ accessToken: prof.mpAccessToken });
    const valor = Number(s.valor);
    const pref = await new Preference(mp).create({ body: {
      items: [{ title: `Reposição — ${s.loja}`, quantity: 1, unit_price: valor, currency_id: "BRL" }],
      marketplace_fee: Math.round(valor * TAXA * 100) / 100,
      external_reference: solicitacaoId,
      notification_url: "https://SUA-REGIAO-SEU-PROJETO.cloudfunctions.net/webhookMP",
      payment_methods: { excluded_payment_types: [{ id: "ticket" }] }
    }});
    res.json({ init_point: pref.init_point });
  } catch (e) { console.error(e); res.status(500).json({ erro: "falha ao criar cobrança" }); }
});

// Mercado Pago avisa aqui quando o pagamento é aprovado -> marca o pedido como concluído.
exports.webhookMP = onRequest(async (req, res) => {
  try {
    const id = req.body?.data?.id || req.query["data.id"];
    if (!id) return res.sendStatus(200);
    // INDICAÇÃO: ao aprovar o pagamento, se for o 1º turno concluído do promotor e ele tiver "indicadoPor",
    // os 15% da plataforma viram crédito do promotor que indicou:
    //   const prom = (await db.collection("profissionais").doc(s.promotorChave).get()).data();
    //   if (prom.indicadoPor && !prom.bonusIndicacaoPago) {
    //     const q = await db.collection("profissionais").where("refCode", "==", prom.indicadoPor).limit(1).get();
    //     if (!q.empty && q.docs[0].id !== s.promotorChave) {
    //       await db.collection("indicacoes").add({ para: q.docs[0].id, de: s.promotorChave, valor: s.valor * 0.15, solicitacaoId: id, criadoEm: admin.firestore.FieldValue.serverTimestamp() });
    //       await db.collection("profissionais").doc(s.promotorChave).update({ bonusIndicacaoPago: true });
    //     }
    //   }
    // Confirme o pagamento consultando a API do MP (com o token do promotor) antes de marcar.
    // Exemplo resumido: após validar status === "approved":
    //   await db.collection("solicitacoes").doc(external_reference).update({ status: "concluida", pagoEm: admin.firestore.FieldValue.serverTimestamp() });
    res.sendStatus(200);
  } catch (e) { console.error(e); res.sendStatus(500); }
});
