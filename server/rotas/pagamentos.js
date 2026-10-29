// Pagamentos: todo valor entra na conta Mercado Pago da PLATAFORMA; a divisão (R$ 150 profissional / R$ 50 comissão)
// é lançada no ledger interno no mesmo instante em que o pagamento é confirmado (mesma transação).
const crypto = require("crypto");

module.exports = (app, x) => {
  const { db, FieldValue, Timestamp, auth, V, C, S, Cripto, Falha, envelope, limitar, carteira, taxas, mp, reais, visaoLoja, getBaseUrl, urlPublicaHttps, APP_URL, MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET } = x;
  const porUsuario = (nome, max) => limitar({ janelaMs: 60_000, max, nome, porUsuario: true });

  /**
   * O preço NUNCA vem do cliente. Vale o split CONGELADO no momento em que o pedido foi criado (pagamentos_internos, só servidor):
   * é o valor que a loja viu e o líquido que o profissional viu ao aceitar. Mudar as taxas no painel afeta os PRÓXIMOS pedidos.
   * Pedido antigo sem split válido cai nas taxas vigentes.
   */
  const splitValido = (p) => p && [p.valor, p.promotor, p.comissao, p.taxaFixa, p.app, p.total].every(Number.isInteger) && p.promotor + p.app === p.total && p.total === p.valor + p.taxaFixa && p.promotor > 0;
  async function splitDoPedido(sid) {
    const congelado = (await db.collection("pagamentos_internos").doc(sid).get()).data()?.split;
    return splitValido(congelado) ? congelado : S.calcularDiaria(await taxas.obter());
  }

  async function exigirCartao(uid) {
    const c = await db.collection("cartoes").doc(uid).get();
    if (!c.exists || c.data().status !== "ativo") throw new Falha(402, "Cadastre um cartão de crédito válido para solicitar ou pagar serviços.", "cartao-obrigatorio");
  }

  // ---------- Checkout ----------
  app.post("/criarCobranca", porUsuario("cobranca", 20), auth.exigir("loja"), envelope(async (req, res) => {
    const u = req.usuario, sid = V.idDoc(req.body?.solicitacaoId, "solicitacaoId");
    const ref = db.collection("solicitacoes").doc(sid), s = (await ref.get()).data();
    if (!s || s.uid !== u.uid) throw new Falha(404, "Pedido não encontrado.", "nao-encontrado");
    if (s.status === "paga" || s.status === "concluida") throw new Falha(400, "pedido já pago", "ja-pago");
    if (s.status !== "aceita" || !s.promotorUid) throw new Falha(400, "pedido ainda não aceito", "nao-aceito");
    await exigirCartao(u.uid);
    if (!urlPublicaHttps(APP_URL)) throw new Falha(500, "APP_URL inválida no servidor.", "mp-nao-configurado");
    const sp = await splitDoPedido(sid), base = getBaseUrl(req);
    const corpo = {
      items: [{ id: sid, title: `Reposição — ${s.loja}`.slice(0, 120), description: `${s.foco} · ${s.data} ${s.horario}`.slice(0, 200), quantity: 1, currency_id: "BRL", unit_price: reais(sp.total) }],
      external_reference: sid,
      back_urls: ["success", "failure", "pending"].reduce((o, k) => ({ ...o, [k]: `${APP_URL}/pagar.html?id=${encodeURIComponent(sid)}&retorno=${k}` }), {}),
      auto_return: "approved", statement_descriptor: "ABASTECEJA", payment_methods: { excluded_payment_types: [{ id: "ticket" }], installments: 1 }
    };
    if (urlPublicaHttps(base)) corpo.notification_url = `${base}/webhookMP`;
    const pref = await mp("/checkout/preferences", { method: "POST", body: JSON.stringify(corpo) });
    await db.collection("pagamentos_internos").doc(sid).set({ uid: u.uid, split: sp, preferenceId: pref.id, status: "iniciado", iniciadoEm: FieldValue.serverTimestamp() }, { merge: true });
    res.json({ init_point: pref.init_point, ...visaoLoja(sp) });
  }));

  // ---------- Confirmação (transação única: pedido pago + nota + crédito no ledger) ----------
  async function finalizarPagamento(sid, { paymentId, metodo, taxaMpCentavos = 0, simulado = false, liberaEmMs = 0 }) {
    const ref = db.collection("solicitacoes").doc(sid);
    const sp = await splitDoPedido(sid);
    const notaId = await db.runTransaction(async (tx) => {
      const atual = (await tx.get(ref)).data();
      if (!atual) throw new Falha(404, "pedido não encontrado", "nao-encontrado");
      if (atual.status === "paga" || atual.status === "concluida") return atual.notaId || null;
      if (atual.status !== "aceita" || !atual.promotorUid) throw new Falha(409, "Pedido não está em estado de pagamento.", "estado-invalido");
      const contRef = db.collection("contadores").doc("notas");
      const [cont, ctnt, profPriv, prof, estado] = await Promise.all([
        tx.get(contRef), tx.get(db.collection("contratantes").doc(atual.uid)),
        tx.get(db.collection("profissionais_privado").doc(atual.promotorUid)), tx.get(db.collection("profissionais").doc(atual.promotorUid)),
        carteira.lerParaCredito(tx, { pedidoId: sid, promotorUid: atual.promotorUid })
      ]);
      const proximo = (cont.data()?.ultimo || 0) + 1;
      const c = ctnt.data() || {}, pp = profPriv.data() || {}, p = prof.data() || {};
      let cpfMasc = ""; try { cpfMasc = pp.cpfEnc ? V.mascararCPF(Cripto.decifrar(pp.cpfEnc, `profissionais_privado/cpf/${atual.promotorUid}`)) : ""; } catch { cpfMasc = ""; }
      const apos = Math.max(Date.now() + C.LIBERACAO_DIAS * 86_400_000, liberaEmMs);
      tx.set(contRef, { ultimo: proximo });
      const nRef = db.collection("notas").doc();
      tx.set(nRef, {
        numero: proximo, numeroFmt: String(proximo).padStart(6, "0"), serie: "A1", tipo: "nota_servico_plataforma", fiscal: { nfse: null }, status: "emitida",
        solicitacaoId: sid, contratanteUid: atual.uid,
        tomador: { razaoSocial: c.razaoSocial || atual.loja, documento: c.documento || "", endereco: c.endereco || atual.loja, email: c.email || "" },
        prestador: { nome: p.nome || atual.promotorNome || "", documento: cpfMasc },      // CPF só mascarado: a loja não precisa do CPF completo
        servico: { descricao: `Reposição/abastecimento — ${atual.foco}`, loja: atual.loja, data: atual.data, horario: atual.horario },
        valores: visaoLoja(sp), pagamento: { mpPaymentId: String(paymentId), metodo: metodo || "", simulado }, emitidaEm: FieldValue.serverTimestamp()
      });
      tx.update(ref, { status: "paga", notaId: nRef.id, notaNumero: proximo, pagaEm: FieldValue.serverTimestamp() });
      tx.set(db.collection("pagamentos_internos").doc(sid), { uid: atual.uid, promotorUid: atual.promotorUid, split: sp, status: "aprovado", mpPaymentId: String(paymentId), metodo: metodo || "", taxaMpCentavos, simulado, pagoEm: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(db.collection("solicitacoes_financeiro").doc(sid), { status: "pago", pagoEm: FieldValue.serverTimestamp() }, { merge: true });
      carteira.creditarPagamento(tx, estado, { pedidoId: sid, promotorUid: atual.promotorUid, split: sp, liberaEmMs: apos });
      return nRef.id;
    });
    return { aprovado: true, notaId };
  }
  x.finalizarPagamento = finalizarPagamento;

  /** Consulta o pagamento NO Mercado Pago (nunca confia no corpo do webhook) e confere referência, moeda e valor ao centavo. */
  async function processarPagamento(sid, paymentId) {
    const s = (await db.collection("solicitacoes").doc(sid).get()).data();
    if (!s) throw new Falha(404, "pedido não encontrado", "nao-encontrado");
    if (s.status === "paga" || s.status === "concluida") return { jaPago: true, notaId: s.notaId || null };
    const sp = await splitDoPedido(sid);
    const pg = await mp(`/v1/payments/${encodeURIComponent(paymentId)}`);
    if (pg.external_reference !== sid) throw new Falha(400, "pagamento não pertence a este pedido", "pagamento-invalido");
    if (pg.status !== "approved") return { aprovado: false, status: pg.status };
    if (pg.currency_id !== "BRL" || Math.round(Number(pg.transaction_amount) * 100) !== sp.total) throw new Falha(400, "valor pago diferente do valor do pedido", "valor-divergente");
    const taxaMp = Math.round((pg.fee_details || []).filter((f) => f.type === "mercadopago_fee").reduce((a, f) => a + f.amount, 0) * 100);
    const lib = Date.parse(pg.money_release_date || "") || 0;       // a plataforma só libera o saldo depois que o MP libera o dinheiro
    return finalizarPagamento(sid, { paymentId, metodo: pg.payment_type_id, taxaMpCentavos: taxaMp, liberaEmMs: lib });
  }

  app.post("/confirmarPagamento", porUsuario("confirmar", 30), auth.exigir("loja"), envelope(async (req, res) => {
    const sid = V.idDoc(req.body?.solicitacaoId, "solicitacaoId"), paymentId = String(req.body?.paymentId || "");
    if (!/^\d{3,20}$/.test(paymentId)) throw new Falha(400, "dados incompletos", "dados-invalidos");
    const s = (await db.collection("solicitacoes").doc(sid).get()).data();
    if (!s || s.uid !== req.usuario.uid) throw new Falha(404, "Pedido não encontrado.", "nao-encontrado");
    res.json(await processarPagamento(sid, paymentId));
  }));

  // ---------- Estorno: Mercado Pago + ledger ----------
  async function estornarPagamento({ pedidoId, motivo, ator, origem }) {
    const pag = (await db.collection("pagamentos_internos").doc(pedidoId).get()).data();
    if (!pag) throw new Falha(404, "Pagamento não encontrado.", "nao-encontrado");
    if (pag.status === "estornado") return { jaEstornado: true };
    let mpRefundId = null;
    if (!pag.simulado && origem !== "mercadopago") {
      const r = await mp(`/v1/payments/${encodeURIComponent(pag.mpPaymentId)}/refunds`, { method: "POST", body: JSON.stringify({}), headers: { "X-Idempotency-Key": `refund-${pedidoId}` } });
      mpRefundId = String(r.id || "");
    }
    return carteira.estornarPedido({ pedidoId, motivo, origem, ator, mpRefundId });
  }
  x.estornarPagamento = estornarPagamento;

  // ---------- Webhook do Mercado Pago (público, mas só aceita chamadas assinadas) ----------
  function assinaturaValida(req, dataId) {
    if (!MP_WEBHOOK_SECRET) return false;
    const partes = Object.fromEntries(String(req.get("x-signature") || "").split(",").map((p) => p.trim().split("=")).filter((p) => p.length === 2));
    if (!partes.ts || !partes.v1 || !req.get("x-request-id")) return false;
    const manifesto = `id:${String(dataId).toLowerCase()};request-id:${req.get("x-request-id")};ts:${partes.ts};`;
    const esperado = crypto.createHmac("sha256", MP_WEBHOOK_SECRET).update(manifesto).digest("hex");
    return Cripto.igualSeguro(esperado, partes.v1);
  }
  app.post("/webhookMP", limitar({ janelaMs: 60_000, max: 120, nome: "webhook" }), async (req, res) => {
    try {
      const dataId = String(req.query?.["data.id"] || req.body?.data?.id || "");
      if (!MP_WEBHOOK_SECRET) return res.status(503).json({ erro: "webhook não configurado", codigo: "webhook-nao-configurado" });
      if (!/^\d{3,20}$/.test(dataId) || !assinaturaValida(req, dataId)) return res.status(401).json({ erro: "assinatura inválida", codigo: "assinatura-invalida" });
      const tipo = req.query?.type || req.body?.type || req.query?.topic;
      if (tipo !== "payment") return res.json({ ok: true, ignorado: true });
      const pg = await mp(`/v1/payments/${encodeURIComponent(dataId)}`);
      const sid = pg.external_reference;
      if (typeof sid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(sid)) return res.json({ ok: true, ignorado: true });
      if (pg.status === "approved" && !(Number(pg.transaction_amount_refunded) > 0)) await processarPagamento(sid, dataId);
      else if (["refunded", "charged_back"].includes(pg.status)) await estornarPagamento({ pedidoId: sid, motivo: pg.status === "charged_back" ? "Chargeback" : "Reembolso no Mercado Pago", ator: "mercadopago", origem: "mercadopago" });
      else if (Number(pg.transaction_amount_refunded) > 0) await db.collection("pagamentos_internos").doc(sid).set({ estornoParcialCentavos: Math.round(Number(pg.transaction_amount_refunded) * 100) }, { merge: true });  // aparece na conciliação
      res.json({ ok: true });
    } catch (e) {
      if (e instanceof Falha && e.status < 500) { console.warn("webhook ignorado:", e.codigo); return res.json({ ok: true, ignorado: true }); }
      console.error("webhook erro:", e?.message); res.status(500).json({ erro: "erro interno", codigo: "interno" });     // MP tenta de novo
    }
  });
};
