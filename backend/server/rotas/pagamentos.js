// Pagamentos via CHECKOUT PRO (preferência + init_point): os dados do cartão/Pix são digitados no ambiente do Mercado Pago,
// então não há tokenização no app (acabou a causa dos erros de recusa/token do Checkout Transparente).
// Todo valor entra na conta Mercado Pago da PLATAFORMA (MP_ACCESS_TOKEN); a divisão (R$ 150 profissional / R$ 50 comissão)
// é lançada no ledger interno no mesmo instante em que o pagamento é confirmado (mesma transação).
// Cliente web: back_urls → /pagar.html. Cliente mobile (Flutter, body.origem = "app"): back_urls HTTPS → /pagamento/retorno/:status,
// que devolve o usuário ao app por deep link (flutter_custom_tabs fecha a aba e o app confirma o pagamento no servidor).
const crypto = require("crypto");

module.exports = (app, x) => {
  const { db, FieldValue, Timestamp, auth, V, C, S, Cripto, Falha, envelope, limitar, carteira, taxas, operacao, mp, reais, visaoLoja, getBaseUrl, urlPublicaHttps, APP_URL, MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET } = x;
  const porUsuario = (nome, max) => limitar({ janelaMs: 60_000, max, nome, porUsuario: true });

  /**
   * O preço NUNCA vem do cliente. Vale o split CONGELADO no momento em que o pedido foi criado (pagamentos_internos, só servidor):
   * é o valor que a loja viu. Mudar as taxas no painel afeta os PRÓXIMOS pedidos. Pedido antigo sem split válido cai nas taxas vigentes.
   * Sobre essa base, a comissão depende do nível do promotor NO ACEITE (congelado no pedido) e o bônus do chamado relâmpago vem do
   * próprio pedido (escrito só pelo servidor). O total que a loja paga não muda com o nível — só a divisão entre promotor e plataforma.
   */
  const splitValido = (p) => p && [p.valor, p.promotor, p.comissao, p.taxaFixa, p.app, p.total].every(Number.isInteger) && p.promotor + p.app === p.total && p.total === p.valor + p.taxaFixa + (Number.isInteger(p.bonus) ? p.bonus : 0) && p.promotor > 0;
  async function splitDoPedido(sid, s) {
    const congelado = (await db.collection("pagamentos_internos").doc(sid).get()).data()?.split;
    const cfg = (splitValido(congelado) && S.cfgDoSplit(congelado)) || await taxas.obter();
    return S.calcularDiaria(cfg, s?.nivelAceite || "bronze", Number.isInteger(s?.bonusCentavos) ? s.bonusCentavos : 0);
  }
  /** Pedidos novos só liberam o pagamento depois do check-out (foto da gôndola). Pedidos antigos (sem a marca `exigeExecucao`) seguem o fluxo antigo. */
  const exigirExecutado = (s) => { if (s?.exigeExecucao && s.fase !== "executada") throw new Falha(409, "O pagamento é liberado quando o promotor finalizar o serviço com a foto da gôndola (check-out).", "execucao-pendente"); };
  x.exigirExecutado = exigirExecutado;

  // ---------- Checkout Pro ----------
  const ESQUEMA_APP = (process.env.APP_DEEP_LINK_SCHEME || "abastecejapay").replace(/[^a-z0-9+.-]/gi, "") || "abastecejapay";
  const STATUS_RETORNO = ["success", "failure", "pending"];
  /** Domínio público HTTPS do serviço (nunca localhost): APP_URL, ou o endereço do próprio Render como reserva. */
  const urlDoApp = (req) => [APP_URL, getBaseUrl(req)].find((u) => urlPublicaHttps(u)) || "";

  app.post("/criarCobranca", porUsuario("cobranca", 20), operacao.exigir("pagamentos"), auth.exigir("loja"), envelope(async (req, res) => {
    const u = req.usuario, sid = V.idDoc(req.body?.solicitacaoId, "solicitacaoId");
    const ref = db.collection("solicitacoes").doc(sid), s = (await ref.get()).data();
    if (!s || s.uid !== u.uid) throw new Falha(404, "Pedido não encontrado.", "nao-encontrado");
    if (s.status === "paga" || s.status === "concluida") throw new Falha(400, "pedido já pago", "ja-pago");
    if (s.status !== "aceita" || !s.promotorUid) throw new Falha(400, "pedido ainda não aceito", "nao-aceito");
    exigirExecutado(s);
    // No Checkout Pro o cartão é informado no Mercado Pago: não exigimos cartão pré-cadastrado (era o que dependia da tokenização).
    const dominio = urlDoApp(req);
    if (!dominio) throw new Falha(500, "APP_URL inválida no servidor (use o domínio HTTPS do Render, ex.: https://abastece-ja.onrender.com).", "mp-nao-configurado");
    const sp = await splitDoPedido(sid, s), base = getBaseUrl(req);
    const doApp = req.body?.origem === "app";
    const q = `id=${encodeURIComponent(sid)}`;
    const back_urls = STATUS_RETORNO.reduce((o, k) => ({ ...o, [k]: doApp ? `${dominio}/pagamento/retorno/${k}?${q}` : `${dominio}/pagar.html?${q}&retorno=${k}` }), {});
    const corpo = {
      items: [{ id: sid, title: `Reposição — ${s.loja}`.slice(0, 120), description: `${s.foco} · ${s.data} ${s.horario}`.slice(0, 200), quantity: 1, currency_id: "BRL", unit_price: reais(sp.total) }],
      external_reference: sid,
      back_urls, auto_return: "approved", statement_descriptor: "ABASTECEJA",
      payment_methods: { excluded_payment_types: [{ id: "ticket" }], installments: 1 },
      // Rastreabilidade da divisão: o dinheiro entra inteiro na conta da plataforma e o repasse/comissão é lançado no ledger ao aprovar.
      // (marketplace_fee só existe no modelo com OAuth do vendedor, que não é o caso aqui.) Valores em reais, só para consulta no painel do MP.
      metadata: { solicitacao_id: sid, origem: doApp ? "app" : "web", nivel: sp.nivel, comissao_plataforma: reais(sp.comissao), repasse_profissional: reais(sp.promotor), bonus: reais(sp.bonus || 0), versao_taxas: sp.versaoTaxas || 0 }
    };
    if (u.email) corpo.payer = { email: u.email };
    if (urlPublicaHttps(base)) corpo.notification_url = `${base}/webhookMP`;
    const pref = await mp("/checkout/preferences", { method: "POST", body: JSON.stringify(corpo) });
    if (!pref.init_point) throw new Falha(502, "O Mercado Pago não devolveu o link de pagamento.", "mp");
    await db.collection("pagamentos_internos").doc(sid).set({ uid: u.uid, split: sp, preferenceId: pref.id, status: "iniciado", origem: doApp ? "app" : "web", iniciadoEm: FieldValue.serverTimestamp() }, { merge: true });
    res.json({ init_point: pref.init_point, preferenceId: pref.id, ...visaoLoja(sp) });
  }));

  /**
   * Retorno do Checkout Pro no mobile (back_url HTTPS válida). Público e sem estado: NÃO confirma nada, só devolve o usuário ao app
   * pelo deep link `abastecejapay://pagamento?...`. O app então consulta /statusPagamento e /confirmarPagamento (verificados no servidor).
   * Sem script: a CSP do app bloqueia JS inline, então usa meta refresh + botão de reserva (gesto do usuário).
   */
  app.get("/pagamento/retorno/:status", (req, res) => {
    const status = STATUS_RETORNO.includes(req.params.status) ? req.params.status : "failure";
    const id = /^[A-Za-z0-9_-]{1,128}$/.test(String(req.query.id || "")) ? String(req.query.id) : "";
    const pid = String(req.query.payment_id || req.query.collection_id || "");
    const qs = new URLSearchParams({ status, ...(id ? { id } : {}), ...(/^\d{3,20}$/.test(pid) ? { payment_id: pid } : {}) }).toString();
    const link = `${ESQUEMA_APP}://pagamento?${qs}`;
    const msg = { success: "Pagamento recebido! Voltando ao app…", pending: "Pagamento pendente. Voltando ao app…", failure: "O pagamento não foi concluído. Voltando ao app…" }[status];
    res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${link}"><title>Abastece Já</title><style>body{font-family:system-ui,sans-serif;background:#07090e;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center}a{display:inline-block;margin-top:18px;padding:14px 22px;border-radius:12px;background:#f5b400;color:#07090e;font-weight:700;text-decoration:none}</style></head><body><main><h1>ABASTECE JÁ</h1><p>${msg}</p><a href="${link}">Voltar ao app</a></main></body></html>`);
  });

  /** Estado do pagamento do pedido, para o app consultar depois do retorno (a loja só vê o próprio pedido). */
  app.get("/statusPagamento", porUsuario("statuspg", 60), auth.exigir("loja"), envelope(async (req, res) => {
    const sid = V.idDoc(req.query?.solicitacaoId, "solicitacaoId");
    const s = (await db.collection("solicitacoes").doc(sid).get()).data();
    if (!s || s.uid !== req.usuario.uid) throw new Falha(404, "Pedido não encontrado.", "nao-encontrado");
    res.json({ solicitacaoId: sid, status: s.status, paga: s.status === "paga" || s.status === "concluida", notaId: s.notaId || null });
  }));

  // ---------- Confirmação (transação única: pedido pago + nota + crédito no ledger) ----------
  async function finalizarPagamento(sid, { paymentId, metodo, taxaMpCentavos = 0, simulado = false, liberaEmMs = 0 }) {
    const ref = db.collection("solicitacoes").doc(sid);
    let sp = null;
    const notaId = await db.runTransaction(async (tx) => {
      const atual = (await tx.get(ref)).data();
      if (!atual) throw new Falha(404, "pedido não encontrado", "nao-encontrado");
      if (atual.status === "paga" || atual.status === "concluida") return atual.notaId || null;
      if (atual.status !== "aceita" || !atual.promotorUid) throw new Falha(409, "Pedido não está em estado de pagamento.", "estado-invalido");
      exigirExecutado(atual);
      sp = await splitDoPedido(sid, atual);
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
    const sp = await splitDoPedido(sid, s);
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
    const tol = Number(process.env.MP_WEBHOOK_TOLERANCIA_MS || 0);   // opcional: rejeita assinaturas antigas (anti-replay); 0 = desligado
    if (tol > 0) { let ts = Number(partes.ts); if (ts < 1e12) ts *= 1000; if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > tol) return false; }
    const manifesto = `id:${String(dataId).toLowerCase()};request-id:${req.get("x-request-id")};ts:${partes.ts};`;
    const esperado = crypto.createHmac("sha256", MP_WEBHOOK_SECRET).update(manifesto).digest("hex");
    return Cripto.igualSeguro(esperado, partes.v1);
  }
  app.post("/webhookMP", limitar({ janelaMs: 60_000, max: 120, nome: "webhook" }), (req, res, next) => { try { res.on("finish", () => { try { x.ti.saude.registrarWebhook({ status: res.statusCode }); } catch { /* telemetria nunca derruba o webhook */ } }); } catch { /* idem */ } next(); }, async (req, res) => {
    const dataId = String(req.query?.["data.id"] || req.body?.data?.id || "");
    try {
      if (!MP_WEBHOOK_SECRET) return res.status(503).json({ erro: "webhook não configurado", codigo: "webhook-nao-configurado" });
      if (!/^\d{3,20}$/.test(dataId) || !assinaturaValida(req, dataId)) return res.status(401).json({ erro: "assinatura inválida", codigo: "assinatura-invalida" });
      const tipo = req.query?.type || req.body?.type || req.query?.topic;
      if (tipo !== "payment") return res.json({ ok: true, ignorado: true });
      const pg = await mp(`/v1/payments/${encodeURIComponent(dataId)}`);
      const sid = pg.external_reference;
      if (typeof sid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(sid)) return res.json({ ok: true, ignorado: true });
      if (pg.status === "approved") {
        // Estorno parcial não impede a finalização (transaction_amount continua sendo o valor cobrado; processarPagamento confere ao centavo).
        await processarPagamento(sid, dataId);
        if (Number(pg.transaction_amount_refunded) > 0) await db.collection("pagamentos_internos").doc(sid).set({ estornoParcialCentavos: Math.round(Number(pg.transaction_amount_refunded) * 100) }, { merge: true });
      } else if (["refunded", "charged_back"].includes(pg.status)) await estornarPagamento({ pedidoId: sid, motivo: pg.status === "charged_back" ? "Chargeback" : "Reembolso no Mercado Pago", ator: "mercadopago", origem: "mercadopago" });
      else if (Number(pg.transaction_amount_refunded) > 0) await db.collection("pagamentos_internos").doc(sid).set({ estornoParcialCentavos: Math.round(Number(pg.transaction_amount_refunded) * 100) }, { merge: true });  // aparece na conciliação
      res.json({ ok: true });
    } catch (e) {
      if (e instanceof Falha && e.status < 500) {
        console.warn("webhook ignorado:", e.codigo);
        // Cobrança aprovada que NÃO casa com o pedido (valor/referência) precisa de revisão humana: registra de forma auditável (o MP não tenta de novo após o 200).
        if (["valor-divergente", "pagamento-invalido"].includes(e.codigo) && /^\d{3,20}$/.test(dataId)) {
          console.error("🛑 pagamento retido para revisão:", dataId, e.codigo);
          try { await db.collection("pagamentos_revisao").doc(dataId).set({ paymentId: dataId, codigo: e.codigo, mensagem: String(e.message || "").slice(0, 300), status: "pendente", ultimaVezEm: FieldValue.serverTimestamp() }, { merge: true }); } catch (e2) { console.error("falha ao registrar revisão:", e2?.message); }
        }
        return res.json({ ok: true, ignorado: true });
      }
      console.error("webhook erro:", e?.message); res.status(500).json({ erro: "erro interno", codigo: "interno" });     // MP tenta de novo
    }
  });
};
