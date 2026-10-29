// Sandbox (MODO_TESTE=1, nunca em produção): contas fictícias e pagamento simulado, sem Google e sem Mercado Pago.
module.exports = (app, x) => {
  const { db, admin, FieldValue, Timestamp, auth, V, Cripto, Falha, envelope, limitar, carteira, C, MODO_TESTE } = x;
  const LOJA = "teste-loja", PROM = "teste-promotor";
  const so = (u) => {
    if (!MODO_TESTE) throw new Falha(404, "Modo de teste desligado neste servidor.", "teste-desligado");
    if (!(u.teste === true && [LOJA, PROM].includes(u.uid))) throw new Falha(403, "Só contas de teste podem usar esta rota.", "so-teste");
  };
  const exigirTeste = (...papeis) => async (req, res, next) => { try { const u = await auth.autenticar(req); if (papeis.length && !papeis.includes(u.role)) throw new Falha(403, "Sem permissão.", "sem-permissao"); so(u); req.usuario = u; next(); } catch (e) { next(e); } };

  app.get("/teste/status", (req, res) => res.json({ ativo: MODO_TESTE }));

  app.post("/teste/login", limitar({ janelaMs: 60_000, max: 20, nome: "teste" }), envelope(async (req, res) => {
    if (!MODO_TESTE) throw new Falha(404, "Modo de teste desligado neste servidor.", "teste-desligado");
    const perfil = req.body?.perfil;
    if (!["loja", "promotor"].includes(perfil)) throw new Falha(400, "perfil inválido");
    const uid = perfil === "loja" ? LOJA : PROM;
    if (perfil === "loja") {
      await db.collection("contratantes").doc(uid).set({ uid, email: "loja.teste@abastece.ja", nome: "Loja Teste", razaoSocial: "Mercadinho Teste Ltda", documento: "11222333000181", endereco: "Rua dos Testes, 100 — Itapira/SP", ramo: "Supermercado", teste: true, termosEm: FieldValue.serverTimestamp() }, { merge: true });
    } else {
      await db.collection("profissionais").doc(uid).set({ uid, nome: "Promotor Teste", email: "promotor.teste@abastece.ja", status: "ativo", treinamentoOk: true, teste: true, especialidade: "Reposição geral", cidade: "Itapira - SP", refCode: "teste01", habilitacoes: { mercearia: { em: FieldValue.serverTimestamp(), tentativas: 1, elite: true }, flv: { em: FieldValue.serverTimestamp(), tentativas: 2, elite: false } }, criadoEm: FieldValue.serverTimestamp() }, { merge: true });
      const e = (campo, v) => Cripto.cifrar(v, `profissionais_privado/${campo}/${uid}`);
      await db.collection("profissionais_privado").doc(uid).set({ uid, cpfEnc: e("cpf", "52998224725"), cpfIdx: Cripto.indiceCego("52998224725"), nascimentoEnc: e("nascimento", "1995-05-20"), telefoneEnc: e("telefone", "19999990000"), pixEnc: e("pix", { tipo: "CPF", chave: "52998224725" }), pixTipo: "CPF" }, { merge: true });
      if (!(await treinamento().modulosAtivos()).length) await db.collection("treinamento_modulos").doc("teste-modulo").set({ ordem: 1, titulo: "Módulo de teste (sandbox)", descricao: "Somente no modo de teste.", provedor: "youtube", videoRef: "aaaaaaaaaaa", duracaoSeg: 60, ativo: true, teste: true });
      for (const m of await treinamento().modulosAtivos()) await db.collection("treinamento_progresso").doc(`${uid}_${m.id}`).set({ uid, moduloId: m.id, validoSeg: m.duracaoSeg, concluido: true });
    }
    await db.collection("usuarios").doc(uid).set({ uid, role: perfil, teste: true }, { merge: true });
    res.json({ customToken: await admin.auth().createCustomToken(uid, { teste: true, perfil, role: perfil === "loja" ? "loja" : "promotor", ...(perfil === "promotor" ? { treinado: true } : {}) }), uid, perfil });
  }));
  const treinamento = () => x.treinamento;

  app.post("/teste/pagar", exigirTeste("loja"), envelope(async (req, res) => {
    const sid = V.idDoc(req.body?.solicitacaoId, "solicitacaoId"), s = (await db.collection("solicitacoes").doc(sid).get()).data();
    if (!s || s.uid !== req.usuario.uid) throw new Falha(404, "Pedido não encontrado.", "nao-encontrado");
    if (s.status === "paga") return res.json({ jaPago: true, notaId: s.notaId || null });
    const c = await db.collection("cartoes").doc(req.usuario.uid).get();
    if (!c.exists || c.data().status !== "ativo") throw new Falha(402, "Cadastre um cartão de crédito válido para solicitar ou pagar serviços.", "cartao-obrigatorio");
    res.json(await x.finalizarPagamento(sid, { paymentId: `TESTE-${Date.now()}`, metodo: "credit_card", simulado: true }));
  }));

  /** Sandbox: pula a carência para testar saque sem esperar dias. */
  app.post("/teste/liberar", exigirTeste("promotor"), envelope(async (req, res) => {
    const s = await db.collection("lancamentos").where("carteiraUid", "==", PROM).where("situacao", "==", "pendente").get();
    for (const d of s.docs) await d.ref.update({ liberaEm: Timestamp.fromMillis(Date.now() - 1000) });
    res.json(await carteira.liberarVencidos({ uid: PROM }));
  }));

  app.post("/teste/resetar", exigirTeste(), envelope(async (req, res) => {
    const ids = new Set();
    for (const [campo, uid] of [["uid", LOJA], ["promotorUid", PROM]]) (await db.collection("solicitacoes").where(campo, "==", uid).get()).docs.forEach((d) => ids.add(d.id));
    const lote = db.batch();
    for (const id of ids) for (const col of ["solicitacoes", "solicitacoes_financeiro", "pagamentos_internos", "estornos", "lancamentos"]) lote.delete(db.collection(col).doc(col === "lancamentos" ? `pg_${id}_prof` : id));
    for (const id of ids) { lote.delete(db.collection("lancamentos").doc(`pg_${id}_com`)); lote.delete(db.collection("lancamentos").doc(`lib_pg_${id}_prof`)); }
    (await db.collection("notas").where("contratanteUid", "==", LOJA).get()).docs.forEach((d) => lote.delete(d.ref));
    (await db.collection("saques").where("uid", "==", PROM).get()).docs.forEach((d) => lote.delete(d.ref));
    lote.delete(db.collection("cartoes").doc(LOJA)); lote.delete(db.collection("carteiras").doc(PROM));
    await lote.commit();
    let p = 0, d = 0; (await db.collection("lancamentos").where("carteiraUid", "==", C.PLATAFORMA_UID).get()).docs.forEach((l) => { p += l.data().dPendente; d += l.data().dDisponivel; });
    await db.collection("carteiras").doc(C.PLATAFORMA_UID).set({ uid: C.PLATAFORMA_UID, pendenteCentavos: p, disponivelCentavos: d }, { merge: true });   // mantém o ledger conciliado
    res.json({ ok: true, pedidosRemovidos: ids.size });
  }));
};
