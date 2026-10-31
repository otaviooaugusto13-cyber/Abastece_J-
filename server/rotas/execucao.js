// Execução do turno: CHECK-IN por geofencing (≤ 100 m da loja) e CHECK-OUT com foto da gôndola.
//
//   aceita ──check-in (GPS no raio, na janela)──▶ fase "em_andamento" ──check-out (foto)──▶ fase "executada" ──pagamento──▶ paga
//
// Tudo é decidido aqui: o navegador envia a leitura de GPS e a foto; o servidor calcula distância, janela, permanência e integridade.
// A foto fica no Firestore (fotos_checkout/{pedido}) e só é entregue por esta API, a quem tem direito (loja dona, promotor, admin, marca).
const Img = require("../lib/imagem");

module.exports = (app, x) => {
  const { db, express, FieldValue, Timestamp, auth, V, C, G, Falha, envelope, limitar, reputacao, MODO_TESTE } = x;
  const porUsuario = (nome, max, janelaMs = 60_000) => limitar({ janelaMs, max, nome, porUsuario: true });
  const ehTeste = (u) => MODO_TESTE && u.teste === true && C.CONTAS_TESTE.includes(u.uid);
  const MIN = 60_000, ts = () => FieldValue.serverTimestamp();
  const ms = (t) => (t?.toMillis ? t.toMillis() : 0);
  const hhmm = (m) => V.horaSP(m);
  const jsonFoto = express.json({ limit: C.BODY_FOTO_LIMITE });

  /** Registro imutável de cada tentativa (inclusive as negadas): base da "presença auditada por GPS". */
  const logPresenca = (dados) => db.collection("presencas").doc(dados.id || undefined).set({ ...dados, id: undefined, em: ts() }).catch((e) => console.error("presenca", e.message));

  // ---------- janela do check-in ----------
  function janelaCheckin(s) {
    const inicio = V.instanteSP(s.data, s.entrada);
    return { abre: inicio - C.GEO.CHECKIN_ANTES_MIN * MIN, fecha: inicio + C.GEO.CHECKIN_ATE_MIN * MIN, inicio };
  }
  /** Regras de estado do pedido para check-in (sem GPS). Lança Falha. */
  function exigirPodeCheckin(s, uid, teste, agora) {
    if (!s || s.promotorUid !== uid) throw new Falha(404, "Turno não encontrado.", "nao-encontrado");
    if (s.status !== "aceita") throw new Falha(409, "Este turno não está aceito.", "estado-invalido");
    if (s.fase) throw new Falha(409, s.fase === "executada" ? "Este serviço já foi finalizado." : "Você já fez check-in neste turno.", "checkin-ja-feito");
    if (!s.local || !Number.isFinite(s.local.lat)) throw new Falha(409, "A loja ainda não tem localização cadastrada. Fale com o suporte.", "loja-sem-localizacao");
    if (teste) return;
    const j = janelaCheckin(s);
    if (agora < j.abre) throw new Falha(409, `O check-in abre às ${hhmm(j.abre)} (${C.GEO.CHECKIN_ANTES_MIN} min antes do início).`, "checkin-cedo", { abreEm: new Date(j.abre).toISOString() });
    if (agora > j.fecha) throw new Falha(409, "O prazo de check-in deste turno terminou.", "checkin-expirado", { fechouEm: new Date(j.fecha).toISOString() });
  }

  // ---------- CHECK-IN ----------
  app.post("/checkin", porUsuario("checkin", 15), auth.exigir("promotor"), envelope(async (req, res) => {
    const u = req.usuario, sid = V.idDoc(req.body?.solicitacaoId, "solicitacaoId"), fix = G.lerFix(req.body), teste = ehTeste(u), sRef = db.collection("solicitacoes").doc(sid);
    const agora = Date.now(), pre = (await sRef.get()).data();
    exigirPodeCheckin(pre, u.uid, teste, agora);
    const av = teste ? { ok: true, distanciaM: Math.ceil(G.distanciaM(fix, pre.local)), raioM: pre.raioM || C.GEO.RAIO_METROS, precisaoM: fix.precisaoM } : G.avaliarPresenca({ fix, local: pre.local, raioM: pre.raioM || C.GEO.RAIO_METROS });
    const base = { solicitacaoId: sid, promotorUid: u.uid, lojaUid: pre.uid, marcaId: pre.marcaId || null, lat: fix.lat, lng: fix.lng, precisaoM: fix.precisaoM, distanciaM: av.distanciaM, raioM: av.raioM, simulado: teste };
    if (!av.ok) {                                                                         // tentativa negada: fica registrada
      await logPresenca({ ...base, tipo: "checkin_negado", ok: false, motivo: av.codigo });
      await sRef.set({ checkinNegados: FieldValue.increment(1) }, { merge: true }).catch(() => {});
      throw new Falha(409, av.mensagem, av.codigo, { distanciaM: av.distanciaM, raioM: av.raioM, precisaoM: av.precisaoM });
    }
    await db.runTransaction(async (tx) => {
      const s = (await tx.get(sRef)).data();
      exigirPodeCheckin(s, u.uid, teste, Date.now());
      tx.update(sRef, { fase: "em_andamento", checkinEm: Timestamp.now(), checkinAtrasoMin: Math.max(0, Math.round((Date.now() - janelaCheckin(s).inicio) / MIN)), checkin: { em: Timestamp.now(), lat: fix.lat, lng: fix.lng, precisaoM: fix.precisaoM, distanciaM: av.distanciaM, noRaio: true, simulado: teste } });
      tx.set(db.collection("presencas").doc(`${sid}_in`), { ...base, tipo: "checkin", ok: true, em: ts() });
    });
    res.json({ ok: true, distanciaM: av.distanciaM, raioM: av.raioM });
  }));

  // ---------- CHECK-OUT (foto obrigatória) ----------
  app.post("/checkout", jsonFoto, porUsuario("checkout", 10), auth.exigir("promotor"), envelope(async (req, res) => {
    const u = req.usuario, b = req.body || {}, sid = V.idDoc(b.solicitacaoId, "solicitacaoId"), teste = ehTeste(u);
    const gondola = V.opcao(b.gondola, C.GONDOLA, "estado da gôndola"), observacao = V.texto(b.observacao || "", "observação", { max: 300, obrigatorio: false });
    // 1) a foto: JPEG íntegro, dimensões mínimas e foto nunca usada antes (anti-reaproveitamento)
    const img = Img.jpegDeDataUrl(b.foto, "foto", { min: C.FOTO.MIN_BYTES, max: C.FOTO.MAX_BYTES });
    const mini = Img.jpegDeDataUrl(b.miniatura, "miniatura", { min: 300, max: C.FOTO.MINIATURA_MAX_BYTES });
    const dim = Img.dimensoesJpeg(img);
    if (Math.min(dim.largura, dim.altura) < C.FOTO.LADO_MIN || Math.max(dim.largura, dim.altura) > C.FOTO.LADO_MAX) throw new Falha(400, `A foto precisa ter pelo menos ${C.FOTO.LADO_MIN}px no menor lado.`, "foto-invalida");
    const hash = Img.sha256(img);
    const dup = await db.collection("fotos_checkout").where("sha256", "==", hash).limit(2).get();
    if (dup.docs.some((d) => d.id !== sid)) throw new Falha(409, "Esta foto já foi usada em outro serviço. Tire uma foto nova da gôndola.", "foto-repetida");
    // 2) GPS do check-out (opcional: registrado para auditoria, não bloqueia)
    let fix = null; try { if (b.lat !== undefined) fix = G.lerFix(b); } catch { fix = null; }
    await reputacao.garantir(u.uid, "promotor");

    const sRef = db.collection("solicitacoes").doc(sid), fotoRef = db.collection("fotos_checkout").doc(sid);
    const r = await db.runTransaction(async (tx) => {
      const [sS, repS] = await Promise.all([tx.get(sRef), tx.get(db.collection("reputacao").doc(u.uid))]);
      const s = sS.data(), agora = Date.now();
      if (!s || s.promotorUid !== u.uid) throw new Falha(404, "Turno não encontrado.", "nao-encontrado");
      if (s.status !== "aceita") throw new Falha(409, "Este turno não está aceito.", "estado-invalido");
      if (s.fase === "executada") throw new Falha(409, "Este serviço já foi finalizado.", "checkout-ja-feito");
      if (s.fase !== "em_andamento" || !s.checkin?.em) throw new Falha(409, "Faça o check-in no local antes de finalizar o serviço.", "checkin-pendente");
      const noLocalMs = agora - ms(s.checkin.em);
      const exigidoMin = s.tipo === "ruptura" ? C.GEO.PERMANENCIA_MIN_RUPTURA_MIN : Math.ceil(((s.minutos || 0) * C.GEO.PERMANENCIA_MIN_PCT) / 100);
      if (!teste && noLocalMs < exigidoMin * MIN) throw new Falha(409, `Finalize depois de ${exigidoMin} min no local (faltam ${Math.ceil((exigidoMin * MIN - noLocalMs) / MIN)} min).`, "permanencia-minima", { faltamMin: Math.ceil((exigidoMin * MIN - noLocalMs) / MIN), exigidoMin });
      const dist = fix && s.local ? Math.ceil(G.distanciaM(fix, s.local)) : null;
      const minutosNoLocal = Math.round(noLocalMs / MIN);
      tx.set(fotoRef, { solicitacaoId: sid, promotorUid: u.uid, lojaUid: s.uid, marcaId: s.marcaId || null, regiao: s.regiao || null, bytes: img.length, sha256: hash, mime: "image/jpeg", largura: dim.largura, altura: dim.altura,
        imagem: img.toString("base64"), miniatura: mini.toString("base64"), gondola, observacao, ...(fix ? { lat: fix.lat, lng: fix.lng, precisaoM: fix.precisaoM } : {}), criadoEm: ts() });
      const divergencias = [];   // campos legados (v2) que o painel admin usa para acompanhar atraso e saída antecipada
      if ((s.checkinAtrasoMin || 0) > 15) divergencias.push("atraso");
      if (minutosNoLocal < Math.floor((s.minutos || 0) * 0.8)) divergencias.push("saida-antecipada");
      tx.update(sRef, { fase: "executada", executadaEm: ts(), checkoutEm: Timestamp.now(), trabalhadoMin: minutosNoLocal, divergencias, fotoId: sid,
        checkout: { em: Timestamp.now(), gondola, observacao, minutosNoLocal, fotoSha256: hash, ...(fix ? { lat: fix.lat, lng: fix.lng, precisaoM: fix.precisaoM, distanciaM: dist, noRaio: dist !== null && dist <= (s.raioM || C.GEO.RAIO_METROS) } : { semGps: true }), simulado: teste } });
      tx.set(db.collection("presencas").doc(`${sid}_out`), { solicitacaoId: sid, tipo: "checkout", promotorUid: u.uid, lojaUid: s.uid, marcaId: s.marcaId || null, ok: true, simulado: teste, minutosNoLocal, gondola, ...(fix ? { lat: fix.lat, lng: fix.lng, precisaoM: fix.precisaoM, distanciaM: dist } : {}), em: ts() });
      const nivel = reputacao.concluirChamadoTx(tx, u.uid, repS.data());                 // +1 chamado concluído (possível subida de nível)
      return { nivel, minutosNoLocal };
    });
    res.json({ ok: true, minutosNoLocal: r.minutosNoLocal, nivel: r.nivel });
  }));

  // ---------- Loja ausente (promotor no local, serviço não realizado) ----------
  app.post("/reportarFaltaLoja", porUsuario("faltaloja", 6, 3600_000), auth.exigir("promotor"), envelope(async (req, res) => {
    const u = req.usuario, sid = V.idDoc(req.body?.solicitacaoId, "solicitacaoId"), motivo = V.texto(req.body?.motivo, "motivo", { min: 5, max: 200 }), sRef = db.collection("solicitacoes").doc(sid);
    const s = await db.runTransaction(async (tx) => {
      const o = (await tx.get(sRef)).data();
      if (!o || o.promotorUid !== u.uid) throw new Falha(404, "Turno não encontrado.", "nao-encontrado");
      if (o.status !== "aceita" || o.fase !== "em_andamento" || !o.checkin?.em) throw new Falha(409, "Só é possível reportar a loja depois do check-in e antes do check-out.", "estado-invalido");
      const espera = Date.now() - ms(o.checkin.em);
      if (!ehTeste(u) && espera < C.GEO.FALTA_LOJA_APOS_MIN * MIN) throw new Falha(409, `Aguarde ${C.GEO.FALTA_LOJA_APOS_MIN} min após o check-in antes de reportar a loja (faltam ${Math.ceil((C.GEO.FALTA_LOJA_APOS_MIN * MIN - espera) / MIN)} min).`, "aguarde");
      tx.update(sRef, { status: "cancelada", motivoCancelamento: "falta_loja", canceladoPor: "promotor", canceladoEm: ts(), faltaLoja: { motivo, em: Timestamp.now() } });
      return o;
    });
    const infracao = await reputacao.aplicarInfracao({ uid: s.uid, papel: "loja", tipo: "falta_loja", pedidoId: sid, origem: "reportado_promotor", chave: String(ms(s.aceitoEm)), detalhe: `${s.loja} · ${s.data} ${s.horario || ""} · ${motivo}`.slice(0, 300) });
    await auth.auditar(req, "execucao.falta_loja", sid, { motivo });
    res.json({ ok: true, infracaoId: infracao.id || null });
  }));

  // ---------- Auditoria da foto pela loja ----------
  app.post("/auditarFoto", porUsuario("auditar", 20), auth.exigir("loja"), envelope(async (req, res) => {
    const sid = V.idDoc(req.body?.solicitacaoId, "solicitacaoId"), resultado = V.opcao(req.body?.resultado, ["aprovada", "contestada"], "resultado");
    const comentario = V.texto(req.body?.comentario || "", "comentário", { max: 300, obrigatorio: resultado === "contestada" ? true : false, min: resultado === "contestada" ? 5 : 0 });
    const ref = db.collection("solicitacoes").doc(sid);
    await db.runTransaction(async (tx) => {
      const s = (await tx.get(ref)).data();
      if (!s || s.uid !== req.usuario.uid) throw new Falha(404, "Pedido não encontrado.", "nao-encontrado");
      if (s.fase !== "executada") throw new Falha(409, "O serviço ainda não foi finalizado pelo promotor.", "estado-invalido");
      if (s.auditoriaLoja) throw new Falha(409, "Você já avaliou esta foto.", "ja-auditado");
      tx.update(ref, { auditoriaLoja: { resultado, comentario, em: Timestamp.now() } });
    });
    res.json({ ok: true });
  }));

  // ---------- Entrega da foto (autorizada: loja dona, promotor do turno, admin) ----------
  app.get("/execucao/foto/:id", porUsuario("foto", 60), auth.exigir("loja", "promotor", "admin"), envelope(async (req, res) => {
    const id = V.idDoc(req.params.id, "id"), u = req.usuario, f = (await db.collection("fotos_checkout").doc(id).get()).data();
    const permitido = f && (u.role === "admin" || (u.role === "loja" && f.lojaUid === u.uid) || (u.role === "promotor" && f.promotorUid === u.uid));
    if (!permitido) throw new Falha(404, "Foto não encontrada.", "nao-encontrado");
    res.setHeader("Content-Type", "image/jpeg"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(Buffer.from(req.query.miniatura === "1" ? f.miniatura : f.imagem, "base64"));
  }));

  // ---------- Localização da loja (ponto do geofence) ----------
  app.post("/loja/localizacao", porUsuario("localizacao", 20), auth.exigir("loja"), envelope(async (req, res) => {
    const b = req.body || {}, c = G.coordenadas(b, "loja"), reg = x.regiaoValida(b), fonte = V.opcao(b.fonte || "gps", ["gps", "manual"], "fonte");
    const precisao = Number.isFinite(b.precisao) && b.precisao >= 0 ? Math.round(b.precisao) : null;
    const localizacao = { ...c, ...reg, fonte, precisaoM: precisao, definidaEm: Timestamp.now() };
    await db.collection("contratantes").doc(req.usuario.uid).set({ localizacao }, { merge: true });
    await auth.auditar(req, "loja.localizacao", req.usuario.uid, { fonte, ...c });
    res.json({ ok: true, localizacao: { ...c, ...reg, fonte, precisaoM: precisao } });
  }));
};
