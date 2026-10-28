// Painel administrativo (papel "admin"). O papel é uma custom claim assinada, concedida só por scripts/definir-admin.js.
// Toda ação sensível é auditada; operações de dinheiro exigem login recente.
const { paraCSV, dinheiro, dataBR } = require("../lib/csv");

module.exports = (app, x) => {
  const { db, admin, FieldValue, auth, V, C, S, Cripto, Falha, envelope, limitar, carteira, treinamento, habilitacao, mp, CRON_SECRET } = x;
  const ADM = [limitar({ janelaMs: 60_000, max: 120, nome: "admin", porUsuario: true }), auth.exigir("admin")];
  const iso = (ts) => { const d = ts?.toDate ? ts.toDate() : null; return d ? d.toISOString() : null; };
  const cx = (campo, uid) => `profissionais_privado/${campo}/${uid}`;
  const tentar = (fn) => { try { return fn(); } catch { return null; } };

  // ---------- Profissionais ----------
  app.get("/admin/promotores", ...ADM, envelope(async (req, res) => {
    const status = V.opcao(req.query.status || "pendente", ["pendente", "ativo", "bloqueado"], "status");
    const s = await db.collection("profissionais").where("status", "==", status).limit(200).get();
    res.json(s.docs.map((d) => { const p = d.data(); return { uid: d.id, nome: p.nome || "", cidade: p.cidade || "", status: p.status, treinamentoOk: !!p.treinamentoOk, ratingMedia: p.ratingMedia || null, criadoEm: iso(p.criadoEm) }; }));
  }));

  /** Ficha para análise de cadastro (inclui dados do responsável de menores). A leitura é auditada. */
  app.get("/admin/promotores/:uid", ...ADM, envelope(async (req, res) => {
    const uid = V.idDoc(req.params.uid, "uid"), { pub, priv, nascimento } = await habilitacao.perfil(uid);
    if (!pub) throw new Falha(404, "Profissional não encontrado.", "nao-encontrado");
    const cpf = tentar(() => Cripto.decifrar(priv.cpfEnc, cx("cpf", uid))), resp = tentar(() => Cripto.decifrar(priv.responsavelEnc, cx("responsavel", uid)));
    const idade = nascimento ? V.calcularIdade(nascimento) : null;
    await auth.auditar(req, "admin.promotor.ver_ficha", uid);
    res.json({
      uid, nome: pub.nome, email: (await db.collection("usuarios").doc(uid).get()).data()?.email || "", status: pub.status, cidade: pub.cidade || "", idade, menor: idade !== null && idade < C.IDADE_MAIORIDADE,
      nascimento: nascimento || null, cpfMascarado: cpf ? V.mascararCPF(cpf) : "", telefone: tentar(() => Cripto.decifrar(priv.telefoneEnc, cx("telefone", uid))) || "",
      responsavel: resp ? { nome: resp.nome, parentesco: resp.parentesco, cpfMascarado: V.mascararCPF(resp.cpf), telefone: resp.telefone } : null, autorizacaoEm: iso(priv.autorizacaoResponsavelEm),
      treinamento: await treinamento.estado(uid), habilitacao: await habilitacao.situacao(uid)
    });
  }));

  /** Recado do suporte para um promotor ou uma loja, sem mudar status (ex.: "confira seu CPF e fale com o suporte"). */
  app.post("/admin/recado/:tipo/:uid", ...ADM, envelope(async (req, res) => {
    const tipo = V.opcao(req.params.tipo, ["loja", "promotor"], "tipo"), uid = V.idDoc(req.params.uid, "uid");
    const texto = V.texto(req.body?.texto, "mensagem", { min: 3, max: 300 });
    const ref = db.collection(tipo === "loja" ? "contratantes" : "profissionais").doc(uid);
    if (!(await ref.get()).exists) throw new Falha(404, "Cadastro não encontrado.", "nao-encontrado");
    await ref.set({ recado: { texto, tipo: "info", por: "suporte", em: FieldValue.serverTimestamp() } }, { merge: true });
    await auth.auditar(req, "admin.recado.enviar", uid, { tipo, texto });
    res.json({ ok: true });
  }));

  app.post("/admin/promotores/:uid/status", ...ADM, envelope(async (req, res) => {
    const uid = V.idDoc(req.params.uid, "uid"), status = V.opcao(req.body?.status, ["ativo", "pendente", "bloqueado"], "status");
    const motivo = V.texto(req.body?.motivo || "", "motivo", { max: 300, obrigatorio: false });
    const { pub, priv, nascimento } = await habilitacao.perfil(uid);
    if (!pub) throw new Falha(404, "Profissional não encontrado.", "nao-encontrado");
    if (status === "ativo") {                                                    // aprovar exige cadastro legalmente completo
      if (!nascimento) throw new Falha(409, "Não é possível aprovar: data de nascimento ausente.", "cadastro-incompleto");
      const idade = V.calcularIdade(nascimento);
      if (idade < C.IDADE_MINIMA) throw new Falha(409, `Não é possível aprovar: menor de ${C.IDADE_MINIMA} anos.`, "idade-minima");
      if (idade < C.IDADE_MAIORIDADE && !(priv.responsavelEnc && priv.autorizacaoResponsavelEm)) throw new Falha(409, "Não é possível aprovar: falta autorização do responsável legal.", "responsavel-pendente");
    }
    // O motivo vira um recado visível para o próprio promotor (ao aprovar, o recado antigo some).
    const recado = motivo && status !== "ativo" ? { texto: motivo, tipo: status, por: "suporte", em: FieldValue.serverTimestamp() } : FieldValue.delete();
    await db.collection("profissionais").doc(uid).set({ status, statusMotivo: motivo, statusPor: req.usuario.uid, statusEm: FieldValue.serverTimestamp(), recado }, { merge: true });
    if (status === "bloqueado") await admin.auth().revokeRefreshTokens(uid);   // derruba as sessões do bloqueado
    await auth.auditar(req, "admin.promotor.status", uid, { status, motivo });
    res.json({ ok: true, status });
  }));

  app.post("/admin/usuarios/:uid/revogar-sessoes", ...ADM, envelope(async (req, res) => {
    const uid = V.idDoc(req.params.uid, "uid"); await admin.auth().revokeRefreshTokens(uid);
    await auth.auditar(req, "admin.sessoes.revogar", uid); res.json({ ok: true });
  }));

  // ---------- Catálogo de treinamento PRATICAMENTE ----------
  app.get("/admin/treinamento/modulos", ...ADM, envelope(async (req, res) => res.json(await treinamento.listarTodos())));
  app.post("/admin/treinamento/modulos", ...ADM, envelope(async (req, res) => { const r = await treinamento.salvarModulo(null, req.body || {}); await auth.auditar(req, "admin.treinamento.criar", r.id); res.json(r); }));
  app.put("/admin/treinamento/modulos/:id", ...ADM, envelope(async (req, res) => { const r = await treinamento.salvarModulo(V.idDoc(req.params.id), req.body || {}); await auth.auditar(req, "admin.treinamento.editar", r.id); res.json(r); }));

  // ---------- Pagamentos / estornos ----------
  app.get("/admin/pagamentos", ...ADM, envelope(async (req, res) => {
    const s = await db.collection("pagamentos_internos").where("status", "in", ["aprovado", "estornado"]).limit(300).get();
    res.json(s.docs.map((d) => ({ id: d.id, ...resumoPag(d.data()) })).sort((a, b) => String(b.pagoEm).localeCompare(String(a.pagoEm))));
  }));
  const resumoPag = (p) => ({ status: p.status, totalCentavos: p.split?.total, repasseCentavos: p.split?.promotor, comissaoCentavos: p.split?.app, mpPaymentId: p.mpPaymentId || "", metodo: p.metodo || "", simulado: !!p.simulado, pagoEm: iso(p.pagoEm), estornoParcialCentavos: p.estornoParcialCentavos || 0, promotorUid: p.promotorUid || "" });

  app.post("/admin/pedidos/:id/estornar", limitar({ janelaMs: 3600_000, max: 20, nome: "estorno", porUsuario: true }), auth.exigir("admin"), envelope(async (req, res) => {
    auth.exigirRecente(req.usuario);
    const id = V.idDoc(req.params.id, "id"), motivo = V.texto(req.body?.motivo, "motivo", { min: 5, max: 200 });
    const r = await x.estornarPagamento({ pedidoId: id, motivo, ator: req.usuario.uid, origem: "admin" });
    await auth.auditar(req, "admin.pagamento.estornar", id, { motivo, resultado: r });
    res.json({ ok: true, ...r });
  }));

  // ---------- Saques ----------
  app.get("/admin/saques", ...ADM, envelope(async (req, res) => {
    const status = V.opcao(req.query.status || "solicitado", ["solicitado", "pago", "rejeitado"], "status");
    const s = await db.collection("saques").where("status", "==", status).limit(200).get();
    const lista = s.docs.map((d) => ({ id: d.id, ...d.data() })).map((q) => {
      const pix = q.status === "solicitado" ? tentar(() => Cripto.decifrar(q.pixEnc, cx("pix", q.uid))) : null;   // chave Pix só aparece para quem vai pagar
      return { id: q.id, uid: q.uid, valorCentavos: q.valorCentavos, status: q.status, em: iso(q.criadoEm), pagoEm: iso(q.pagoEm), comprovante: q.comprovante || "", pix: pix ? { tipo: pix.tipo, chave: pix.chave } : null };
    });
    if (status === "solicitado") await auth.auditar(req, "admin.saques.listar_com_pix", "", { qtd: lista.length });
    res.json(lista);
  }));
  app.post("/admin/saques/:id/pagar", limitar({ janelaMs: 60_000, max: 30, nome: "saque-admin", porUsuario: true }), auth.exigir("admin"), envelope(async (req, res) => {
    auth.exigirRecente(req.usuario);
    const id = V.idDoc(req.params.id, "id"), comprovante = V.texto(req.body?.comprovante, "comprovante", { min: 3, max: 120 });
    const r = await carteira.resolverSaque({ saqueId: id, aprovar: true, adminUid: req.usuario.uid, comprovante });
    await auth.auditar(req, "admin.saque.pagar", id, { comprovante }); res.json({ ok: true, ...r });
  }));
  app.post("/admin/saques/:id/rejeitar", limitar({ janelaMs: 60_000, max: 30, nome: "saque-admin", porUsuario: true }), auth.exigir("admin"), envelope(async (req, res) => {
    auth.exigirRecente(req.usuario);
    const id = V.idDoc(req.params.id, "id"), motivo = V.texto(req.body?.motivo, "motivo", { min: 3, max: 200 });
    const r = await carteira.resolverSaque({ saqueId: id, aprovar: false, adminUid: req.usuario.uid, motivo });
    await auth.auditar(req, "admin.saque.rejeitar", id, { motivo }); res.json({ ok: true, ...r });
  }));

  // ---------- Conciliação / liberação / auditoria ----------
  const mpConferir = async (id) => { const p = await mp(`/v1/payments/${encodeURIComponent(id)}`); return { status: p.status, valorCentavos: Math.round(Number(p.transaction_amount) * 100) }; };
  app.get("/admin/conciliacao", limitar({ janelaMs: 60_000, max: 6, nome: "conciliar", porUsuario: true }), auth.exigir("admin"), envelope(async (req, res) => {
    const r = await carteira.conciliar({ mpConferir: req.query.mp === "1" ? mpConferir : null });
    await auth.auditar(req, "admin.conciliacao", "", { ok: r.ok, divergencias: r.divergencias.length }); res.json(r);
  }));
  app.post("/admin/liberar-saldos", ...ADM, envelope(async (req, res) => { const r = await carteira.liberarVencidos({ limite: 500 }); await auth.auditar(req, "admin.liberar_saldos", "", r); res.json(r); }));
  // Agendador externo (Render Cron): POST com o cabeçalho x-cron-secret
  app.post("/interno/liberar", limitar({ janelaMs: 60_000, max: 10, nome: "cron" }), envelope(async (req, res) => {
    if (!CRON_SECRET || !Cripto.igualSeguro(req.get("x-cron-secret") || "", CRON_SECRET)) throw new Falha(401, "não autorizado", "nao-autenticado");
    res.json(await carteira.liberarVencidos({ limite: 500 }));
  }));
  app.get("/admin/auditoria", ...ADM, envelope(async (req, res) => {
    const s = await db.collection("auditoria").orderBy("em", "desc").limit(Math.min(Number(req.query.limite) || 100, 300)).get();
    res.json(s.docs.map((d) => ({ id: d.id, ...d.data(), em: iso(d.data().em) })));
  }));

  // ---------- Aviso global (exibido aos usuários via GET /aviso) ----------
  const AVISO = () => db.collection("configuracoes").doc("aviso");
  app.get("/admin/aviso", ...ADM, envelope(async (req, res) => { const d = (await AVISO().get()).data() || {}; res.json({ ativo: !!d.ativo, nivel: d.nivel || "info", texto: d.texto || "" }); }));
  app.put("/admin/aviso", ...ADM, envelope(async (req, res) => {
    const texto = V.texto(req.body?.texto || "", "texto", { max: 280, obrigatorio: false }), nivel = V.opcao(req.body?.nivel || "info", ["info", "alerta"], "nivel"), ativo = !!req.body?.ativo && !!texto;
    await AVISO().set({ ativo, nivel, texto, porUid: req.usuario.uid, em: FieldValue.serverTimestamp() });
    await auth.auditar(req, "admin.aviso.salvar", "", { ativo, nivel }); res.json({ ok: true, ativo });
  }));
  app.get("/aviso", limitar({ janelaMs: 60_000, max: 60, nome: "aviso" }), envelope(async (req, res) => { const d = (await AVISO().get()).data() || {}; res.json(d.ativo ? { ativo: true, nivel: d.nivel || "info", texto: d.texto } : { ativo: false }); }));

  // ---------- Exportações CSV ----------
  app.get("/admin/exportar/:tipo", limitar({ janelaMs: 60_000, max: 6, nome: "csv", porUsuario: true }), auth.exigir("admin"), envelope(async (req, res) => {
    const tipo = V.opcao(String(req.params.tipo).replace(/\.csv$/, ""), ["lancamentos", "pagamentos", "saques", "estornos", "conciliacao"], "tipo");
    const linhas = []; let cab;
    if (tipo === "lancamentos") {
      cab = ["Data", "Carteira", "Tipo", "Descrição", "Pedido", "Saque", "Carência (R$)", "Disponível (R$)", "Situação"];
      for await (const docs of carteira.paginas("lancamentos")) for (const d of docs) { const l = d.data(); linhas.push([dataBR(l.criadoEm), l.carteiraUid, l.tipo, l.descricao, l.pedidoId || "", l.saqueId || "", dinheiro(l.dPendente), dinheiro(l.dDisponivel), l.situacao || ""]); }
    } else if (tipo === "pagamentos") {
      cab = ["Pedido", "Status", "Total (R$)", "Repasse (R$)", "Comissão (R$)", "Taxa MP (R$)", "ID Mercado Pago", "Método", "Pago em", "Simulado"];
      for await (const docs of carteira.paginas("pagamentos_internos")) for (const d of docs) { const p = d.data(); if (!["aprovado", "estornado"].includes(p.status)) continue; linhas.push([d.id, p.status, dinheiro(p.split.total), dinheiro(p.split.promotor), dinheiro(p.split.app), dinheiro(p.taxaMpCentavos || 0), p.mpPaymentId || "", p.metodo || "", dataBR(p.pagoEm), p.simulado ? "sim" : "não"]); }
    } else if (tipo === "saques") {
      cab = ["Saque", "Profissional", "Valor (R$)", "Status", "Solicitado em", "Pago em", "Comprovante"];
      for await (const docs of carteira.paginas("saques")) for (const d of docs) { const q = d.data(); linhas.push([d.id, q.uid, dinheiro(q.valorCentavos), q.status, dataBR(q.criadoEm), dataBR(q.pagoEm), q.comprovante || ""]); }
    } else if (tipo === "estornos") {
      cab = ["Pedido", "Valor (R$)", "Motivo", "Origem", "Profissional", "ID reembolso MP", "Data"];
      for await (const docs of carteira.paginas("estornos")) for (const d of docs) { const e = d.data(); linhas.push([e.pedidoId, dinheiro(e.valorCentavos), e.motivo, e.origem, e.promotorUid, e.mpRefundId || "", dataBR(e.criadoEm)]); }
    } else {
      const r = await carteira.conciliar();
      cab = ["Tipo", "Referência", "Esperado", "Encontrado", "Descrição", "Informativo"];
      for (const d of r.divergencias) linhas.push([d.tipo, d.ref, JSON.stringify(d.esperado), JSON.stringify(d.encontrado), d.descricao, d.informativo ? "sim" : "não"]);
      linhas.push(["TOTAIS", "", "", "", `recebido líquido ${r.totais.recebidoLiquidoCentavos} | saldos ${r.totais.saldosCentavos} | saques ${r.totais.saquesSolicitadosCentavos + r.totais.saquesPagosCentavos} | diferença ${r.totais.diferencaCentavos} (centavos)`, ""]);
    }
    await auth.auditar(req, "admin.exportar", tipo, { linhas: linhas.length });
    x.enviarCSV(res, `abastece-ja-${tipo}-${V.hojeSP()}.csv`, paraCSV(cab, linhas));
  }));
};
