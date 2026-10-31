// Pedidos de turno. Toda mudança de estado acontece AQUI (transações); o navegador só lê.
module.exports = (app, x) => {
  const { db, FieldValue, Timestamp, auth, V, C, S, G, Falha, envelope, limitar, habilitacao, taxas, reputacao, hojeSP, visaoLoja, MODO_TESTE } = x;
  const porUsuario = (nome, max, janelaMs = 60_000) => limitar({ janelaMs, max, nome, porUsuario: true });
  const ehTeste = (u) => MODO_TESTE && u.teste === true && ["teste-loja", "teste-promotor"].includes(u.uid);

  async function exigirCartao(uid) {
    const c = await db.collection("cartoes").doc(uid).get();
    if (!c.exists || c.data().status !== "ativo") throw new Falha(402, "Cadastre um cartão de crédito válido para solicitar ou pagar serviços.", "cartao-obrigatorio");
  }
  x.exigirCartao = exigirCartao;
  const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
  /** Cidade/UF: base das métricas por região do painel B2B. */
  const regiaoValida = (b) => ({ cidade: V.texto(b?.cidade, "cidade", { min: 2, max: 80 }), uf: V.opcao(String(b?.uf || "").toUpperCase(), UFS, "UF") });
  /** Local da loja (lat/lng + região): o do pedido, se enviado; senão o salvo no perfil. É o ponto do geofence do check-in. */
  async function localDaLoja(uid, override) {
    if (override && typeof override === "object") return { ...G.coordenadas(override, "loja"), ...regiaoValida(override) };
    const l = ((await db.collection("contratantes").doc(uid).get()).data() || {}).localizacao;
    if (!l || !Number.isFinite(l.lat) || !Number.isFinite(l.lng)) throw new Falha(409, "Defina a localização da sua loja (GPS) antes de pedir um promotor: é ela que valida o check-in.", "localizacao-obrigatoria");
    return { lat: l.lat, lng: l.lng, cidade: l.cidade || "", uf: l.uf || "" };
  }
  /** Marca/indústria (opcional) a que o serviço se refere: alimenta o painel B2B daquela marca. */
  async function marcaDoPedido(id) {
    if (id === undefined || id === null || id === "") return null;
    const mid = V.idDoc(id, "marcaId"), m = (await db.collection("marcas").doc(mid).get()).data();
    if (!m || m.ativo === false) throw new Falha(400, "Marca não encontrada.", "dados-invalidos");
    return { marcaId: mid, marcaNome: String(m.nome || "").slice(0, 80) };
  }
  x.localDaLoja = localDaLoja; x.marcaDoPedido = marcaDoPedido; x.regiaoValida = regiaoValida; x.UFS = UFS;
  const somaDias = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  // ---------- Cartão (loja) ----------
  app.post("/cartao/registrar", porUsuario("cartao", 10), auth.exigir("loja"), envelope(async (req, res) => {
    const u = req.usuario, b = req.body || {};
    let cartao, privado = {};
    if (b.simulado === true) {
      if (!ehTeste(u)) throw new Falha(403, "Só contas de teste podem usar esta rota.", "so-teste");
      const ultimos4 = V.soDigitos(b.ultimos4);
      if (ultimos4.length !== 4) throw new Falha(400, "cartão inválido", "cartao-invalido");
      cartao = { bandeira: V.texto(b.bandeira || "cartão", "bandeira", { max: 20, obrigatorio: false }), ultimos4, mes: V.inteiro(Number(b.mes), "mes", { min: 1, max: 12 }), ano: V.inteiro(Number(b.ano), "ano", { min: 2000, max: 2100 }), simulado: true };
    } else {
      if (!x.MP_ACCESS_TOKEN) throw new Falha(500, "Cadastro de cartão não configurado no servidor.", "mp-nao-configurado");
      const token = V.texto(b.cardToken, "token do cartão", { min: 8, max: 200 });
      const email = u.email || `${u.uid}@abastece.ja`;
      const busca = await x.mp(`/v1/customers/search?email=${encodeURIComponent(email)}`);
      const clienteId = busca.results?.[0]?.id || (await x.mp("/v1/customers", { method: "POST", body: JSON.stringify({ email }) })).id;
      const c = await x.mp(`/v1/customers/${clienteId}/cards`, { method: "POST", body: JSON.stringify({ token }) });
      cartao = { bandeira: c.payment_method?.name || "cartão", ultimos4: String(c.last_four_digits), mes: c.expiration_month, ano: c.expiration_year, simulado: false };
      privado = { mpCustomerId: String(clienteId), mpCardId: String(c.id) };
    }
    const lote = db.batch();
    lote.set(db.collection("cartoes").doc(u.uid), { ...cartao, uid: u.uid, status: "ativo", atualizadoEm: FieldValue.serverTimestamp() });      // só dados de exibição
    if (Object.keys(privado).length) lote.set(db.collection("cartoes_privado").doc(u.uid), { uid: u.uid, ...privado });                          // IDs do gateway: só servidor
    await lote.commit();
    res.json({ ok: true, cartao: { bandeira: cartao.bandeira, ultimos4: cartao.ultimos4, mes: cartao.mes, ano: cartao.ano } });
  }));
  app.post("/cartao/remover", porUsuario("cartao", 10), auth.exigir("loja"), envelope(async (req, res) => {
    await db.collection("cartoes").doc(req.usuario.uid).set({ status: "removido", atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
    await db.collection("cartoes_privado").doc(req.usuario.uid).delete();
    res.json({ ok: true });
  }));

  // ---------- Criar pedido (loja) ----------
  app.post("/criarPedido", porUsuario("pedido", 20), auth.exigir("loja"), envelope(async (req, res) => {
    const u = req.usuario, b = req.body || {};
    await exigirCartao(u.uid);
    const loja = V.texto(b.loja, "loja", { min: 3, max: 160 });
    const data = b.data, entrada = String(b.entrada || ""), saida = String(b.saida || "");
    if (!V.dataIsoValida(data) || data < hojeSP() || data > somaDias(hojeSP(), 90)) throw new Falha(400, "Escolha hoje ou uma data nos próximos 90 dias.", "dados-invalidos");
    const foco = V.opcao(b.foco, C.SETORES, "setor");
    const cfg = await taxas.obter();                                    // taxas vigentes AGORA (editáveis pelo admin)
    const erroTurno = S.validarTurno(entrada, saida, cfg);
    if (erroTurno) throw new Falha(400, erroTurno, "turno-invalido");
    const sp = S.calcularTurno(S.minutosEntre(entrada, saida), cfg);   // diária fixa: o cliente NUNCA define o preço. Fica congelada neste pedido (pagamentos_internos.split)
    const [local, marca] = await Promise.all([localDaLoja(u.uid, b.local), marcaDoPedido(b.marcaId)]);
    const ref = db.collection("solicitacoes").doc();
    const pedido = {
      uid: u.uid, loja, data, entrada, saida, horario: `${entrada} – ${saida}`, minutos: sp.minutos, foco,
      valorPromotorCentavos: sp.promotor, modelo: sp.modelo, status: "aberta", criadoEm: FieldValue.serverTimestamp(),
      tipo: "padrao", exigeExecucao: true, local: { lat: local.lat, lng: local.lng }, regiao: { cidade: local.cidade, uf: local.uf }, raioM: C.GEO.RAIO_METROS, ...(marca || {})
    };
    if (b.promotorPreferido) {
      const pid = V.idDoc(b.promotorPreferido, "promotorPreferido"), pp = (await db.collection("profissionais").doc(pid).get()).data();
      if (!pp || pp.status !== "ativo") throw new Falha(400, "Profissional indisponível para pedido direto.", "dados-invalidos");
      pedido.promotorPreferido = pid; pedido.promotorPreferidoNome = String(pp.nome || "").slice(0, 100);
      pedido.exclusivoAte = Timestamp.fromMillis(Date.now() + 5 * 60 * 1000);
    }
    const lote = db.batch();
    lote.set(ref, pedido);
    lote.set(db.collection("solicitacoes_financeiro").doc(ref.id), { uid: u.uid, ...visaoLoja(sp), criadoEm: FieldValue.serverTimestamp() });
    lote.set(db.collection("pagamentos_internos").doc(ref.id), { uid: u.uid, split: sp, status: "criado", criadoEm: FieldValue.serverTimestamp() });
    await lote.commit();
    res.json({ id: ref.id, ...visaoLoja(sp) });
  }));

  // ---------- Aceitar turno (profissional) ----------
  app.post("/aceitarTurno", porUsuario("aceite", 30), auth.exigir("promotor"), envelope(async (req, res) => {
    const u = req.usuario, sid = V.idDoc(req.body?.solicitacaoId, "solicitacaoId");
    const sRef = db.collection("solicitacoes").doc(sid), profRef = db.collection("profissionais").doc(u.uid);
    const previa = (await sRef.get()).data();
    if (!previa) throw new Falha(404, "Pedido não encontrado.", "nao-encontrado");
    // TRAVAS DE HABILITAÇÃO (aprovação, idade, responsável, treinamento PRATICAMENTE, regras de menor)
    await habilitacao.exigirPodeAceitar(u.uid, previa);
    const cfg = await taxas.obter();
    await reputacao.varrerFaltas({ uid: u.uid });                   // quem faltou a um turno anterior é punido ANTES de pegar outro
    const nivel = await reputacao.nivelParaAceite(u.uid);           // a comissão do turno fica "congelada" no nível de agora

    await db.runTransaction(async (tx) => {
      const [prof, snap, meus, pgSnap] = await Promise.all([tx.get(profRef), tx.get(sRef), tx.get(db.collection("solicitacoes").where("promotorUid", "==", u.uid)), tx.get(db.collection("pagamentos_internos").doc(sid))]);
      const p = prof.data(), s = snap.data();
      if (!p || p.status !== "ativo") throw new Falha(403, "Seu cadastro ainda não foi aprovado.", "promotor-inativo");
      if (!s) throw new Falha(404, "Pedido não encontrado.", "nao-encontrado");
      if (s.status !== "aberta") throw new Falha(409, "Turno indisponível ou já aceito.", "turno-indisponivel");
      if (s.tipo === "ruptura" && s.expiraEm && s.expiraEm.toMillis() < Date.now()) throw new Falha(409, "Este chamado relâmpago expirou.", "turno-expirado");
      if (s.data < hojeSP()) throw new Falha(409, "Este turno já passou.", "turno-indisponivel");
      if (s.exclusivoAte && s.exclusivoAte.toMillis() > Date.now() && s.promotorPreferido && s.promotorPreferido !== u.uid) throw new Falha(403, "Este turno está sob janela de exclusividade para outro profissional.", "exclusivo");
      const historico = meus.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (S.vezesNaSemana(historico, s.uid, s.data, snap.id || sid) >= cfg.maxSemana) throw new Falha(409, `Limite atingido: máximo de ${cfg.maxSemana} turnos por semana nesta loja.`, "limite-semanal");
      const conflito = historico.some((t) => t.id !== sid && S.STATUS_QUE_CONTAM.includes(t.status) && t.data === s.data && !(t.saida <= s.entrada || t.entrada >= s.saida));
      if (conflito) throw new Falha(409, "Você já tem um turno neste horário.", "conflito-horario");
      const sp = S.calcularDiaria(S.cfgDoSplit(pgSnap.data()?.split) || cfg, nivel.id, s.bonusCentavos || 0);   // taxas congeladas no pedido + comissão do nível de agora
      tx.update(sRef, { status: "aceita", promotorUid: u.uid, promotorNome: String(p.nome || "Promotor").slice(0, 100), aceitoEm: FieldValue.serverTimestamp(),
        promotorNivel: nivel.id, nivelAceite: nivel.id, comissaoPct: nivel.comissaoPct, valorPromotorCentavos: sp.promotor });
    });
    res.json({ ok: true });
  }));

  // ---------- Cancelar (loja) / Desistir (profissional) ----------
  /** "Em cima da hora" = faltam menos de CANCELAMENTO_TARDIO_HORAS para o início do turno (ou ele já começou). */
  const emCimaDaHora = (s, agora = Date.now()) => !!s?.data && !!s?.entrada && V.instanteSP(s.data, s.entrada) - agora < C.CANCELAMENTO_TARDIO_HORAS * 3_600_000;

  app.post("/cancelarPedido", porUsuario("cancelar", 20), auth.exigir("loja"), envelope(async (req, res) => {
    const sid = V.idDoc(req.body?.solicitacaoId, "solicitacaoId"), ref = db.collection("solicitacoes").doc(sid);
    const { tardio, s: pedido } = await db.runTransaction(async (tx) => {
      const s = (await tx.get(ref)).data();
      if (!s || s.uid !== req.usuario.uid) throw new Falha(404, "Pedido não encontrado.", "nao-encontrado");      // 404 (não 403): não confirma existência a terceiros (IDOR)
      if (!["aberta", "aceita"].includes(s.status)) throw new Falha(409, "Este pedido não pode mais ser cancelado.", "estado-invalido");
      if (s.fase) throw new Falha(409, "O promotor já está no local: o serviço não pode mais ser cancelado. Fale com o suporte se houver problema.", "servico-em-andamento");
      tx.update(ref, { status: "cancelada", canceladoEm: FieldValue.serverTimestamp(), canceladoPor: "loja" });
      return { tardio: s.status === "aceita" && emCimaDaHora(s), s };       // com promotor escalado e em cima da hora = infração
    });
    let infracao = null;
    if (tardio) infracao = await reputacao.aplicarInfracao({ uid: req.usuario.uid, papel: "loja", tipo: "cancelamento_tardio_loja", pedidoId: sid, chave: String(pedido.aceitoEm?.toMillis?.() || ""), detalhe: `${pedido.loja} · ${pedido.data} ${pedido.horario || ""}`.trim() });
    res.json({ ok: true, infracao });
  }));
  app.post("/desistirTurno", porUsuario("desistir", 20), auth.exigir("promotor"), envelope(async (req, res) => {
    const sid = V.idDoc(req.body?.solicitacaoId, "solicitacaoId"), ref = db.collection("solicitacoes").doc(sid);
    const { tardio, s: pedido } = await db.runTransaction(async (tx) => {
      const s = (await tx.get(ref)).data();
      if (!s || s.promotorUid !== req.usuario.uid) throw new Falha(404, "Turno não encontrado.", "nao-encontrado");
      if (s.status !== "aceita") throw new Falha(409, "Não é possível desistir deste turno.", "estado-invalido");
      if (s.fase) throw new Falha(409, "Você já fez check-in neste turno. Finalize o serviço (check-out) ou fale com o suporte.", "servico-em-andamento");
      const congeladoPg = (await tx.get(db.collection("pagamentos_internos").doc(sid))).data()?.split;
      tx.update(ref, { status: "aberta", promotorUid: FieldValue.delete(), promotorNome: FieldValue.delete(), aceitoEm: FieldValue.delete(), promotorNivel: FieldValue.delete(), nivelAceite: FieldValue.delete(), comissaoPct: FieldValue.delete(),
        valorPromotorCentavos: S.calcularDiaria(S.cfgDoSplit(congeladoPg) || S.PADRAO, "bronze", s.bonusCentavos || 0).promotor });
      return { tardio: emCimaDaHora(s), s };
    });
    let infracao = null;
    if (tardio) infracao = await reputacao.aplicarInfracao({ uid: req.usuario.uid, papel: "promotor", tipo: "desistencia_tardia", pedidoId: sid, chave: String(pedido.aceitoEm?.toMillis?.() || ""), detalhe: `${pedido.loja} · ${pedido.data} ${pedido.horario || ""}`.trim() });
    res.json({ ok: true, infracao });
  }));

  // ---------- Avaliação (loja → profissional), uma por serviço pago ----------
  app.post("/avaliarServico", porUsuario("avaliar", 20), auth.exigir("loja"), envelope(async (req, res) => {
    const sid = V.idDoc(req.body?.solicitacaoId, "solicitacaoId"), estrelas = V.inteiro(req.body?.estrelas, "estrelas", { min: 1, max: 5 });
    const comentario = V.texto(req.body?.comentario || "", "comentário", { max: 300, obrigatorio: false });
    const ref = db.collection("solicitacoes").doc(sid);
    await db.runTransaction(async (tx) => {
      const s = (await tx.get(ref)).data();
      if (!s || s.uid !== req.usuario.uid) throw new Falha(404, "Pedido não encontrado.", "nao-encontrado");
      if (s.status !== "paga" && s.status !== "concluida") throw new Falha(409, "Só é possível avaliar serviços pagos.", "estado-invalido");
      if (s.avaliacao) throw new Falha(409, "Este serviço já foi avaliado.", "ja-avaliado");
      const pRef = db.collection("profissionais").doc(s.promotorUid), p = (await tx.get(pRef)).data() || {};
      const qtd = (p.ratingQtd || 0) + 1, media = ((p.ratingMedia || 0) * (p.ratingQtd || 0) + estrelas) / qtd;
      tx.update(ref, { avaliacao: { estrelas, comentario, em: FieldValue.serverTimestamp() } });
      tx.set(pRef, { ratingQtd: qtd, ratingMedia: Math.round(media * 100) / 100 }, { merge: true });
    });
    res.json({ ok: true });
  }));
};
