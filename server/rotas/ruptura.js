// Chamado relâmpago (ruptura de gôndola): a loja abre um pedido URGENTE com bônus; o servidor avisa os promotores habilitados
// perto da loja. Aviso = (1) tempo real no app (a oferta aparece na hora, via Firestore) e (2) push (FCM) quando o aparelho
// do promotor está registrado. O bônus é pago pela loja e repassado 100% ao promotor (split.js).
module.exports = (app, x) => {
  const { db, admin, FieldValue, Timestamp, auth, V, C, S, G, Falha, envelope, limitar, visaoLoja, reputacao, taxas } = x;
  const R = C.RUPTURA, ts = () => FieldValue.serverTimestamp();
  const porUsuario = (nome, max, janelaMs = 60_000) => limitar({ janelaMs, max, nome, porUsuario: true });

  // ---------- Promotor: ativa alertas e informa a posição ----------
  app.post("/promotor/alertas", porUsuario("alertas", 30, 3600_000), auth.exigir("promotor"), envelope(async (req, res) => {
    const u = req.usuario, b = req.body || {}, ativo = V.booleano(b.ativo, "ativo");
    const dados = { uid: u.uid, ativo, atualizadoEm: ts() };
    if (ativo) {
      Object.assign(dados, G.coordenadas(b, "posição"), { posEm: Timestamp.now() });
      if (b.fcmToken !== undefined) dados.fcmToken = V.texto(b.fcmToken, "token", { min: 20, max: 4096 });
      const { nascimento } = await x.habilitacao.perfil(u.uid);
      dados.menor = !!nascimento && V.calcularIdade(nascimento) < C.IDADE_MAIORIDADE;
    }
    await db.collection("alertas_promotor").doc(u.uid).set(dados, { merge: true });
    res.json({ ok: true, ativo });
  }));

  // ---------- Quem recebe ----------
  /** Promotores ativos, treinados, com alertas ligados, posição recente dentro do raio e categoria compatível. Mais perto primeiro. */
  async function destinatarios({ lat, lng, setor }) {
    const agora = Date.now(), rotulo = C.SETORES_ROTULO[setor] || setor;
    const docs = (await db.collection("alertas_promotor").where("ativo", "==", true).limit(1000).get()).docs.map((d) => d.data());
    const perto = docs.filter((a) => Number.isFinite(a.lat) && agora - (a.posEm?.toMillis?.() || 0) <= R.POSICAO_VALIDADE_H * 3_600_000 && G.distanciaM({ lat, lng }, a) <= R.RAIO_KM * 1000)
      .filter((a) => !(a.menor && C.MENOR.SETORES_VEDADOS.includes(setor))).map((a) => ({ ...a, km: G.distanciaM({ lat, lng }, a) / 1000 }));
    const out = [];
    for (const a of perto.sort((p, q) => p.km - q.km)) {
      const p = (await db.collection("profissionais").doc(a.uid).get()).data();
      if (!p || p.status !== "ativo" || !p.treinamentoOk) continue;
      const esp = String(p.especialidade || "");
      if (esp && esp !== "Reposição geral" && esp !== rotulo && esp !== setor) continue;          // quem declarou outra especialidade não é acionado
      out.push(a);
    }
    return out;
  }
  async function enviarPush(alvos, dados) {
    const tokens = alvos.map((a) => a.fcmToken).filter(Boolean).slice(0, R.MAX_PUSH);
    if (!tokens.length || typeof admin.messaging !== "function") return 0;
    try {
      const r = await admin.messaging().sendEachForMulticast({ tokens, data: dados, webpush: { headers: { Urgency: "high", TTL: String(R.EXPIRA_MIN * 60) } } });
      r.responses.forEach((x2, i) => { if (!x2.success && /registration-token-not-registered|invalid-registration-token/.test(x2.error?.code || "")) db.collection("alertas_promotor").where("fcmToken", "==", tokens[i]).get().then((s) => s.docs.forEach((d) => d.ref.update({ fcmToken: FieldValue.delete() }))).catch(() => {}); });
      return r.successCount;
    } catch (e) { console.error("push falhou:", e.message); return 0; }            // push é "melhor esforço": nunca derruba o pedido
  }

  // ---------- Loja: abre o chamado ----------
  app.post("/criarRuptura", porUsuario("ruptura", 5, 3600_000), auth.exigir("loja"), envelope(async (req, res) => {
    const u = req.usuario, b = req.body || {};
    await x.exigirCartao(u.uid);
    const foco = V.opcao(b.foco, C.SETORES, "setor"), bonus = V.opcao(b.bonusCentavos, R.BONUS_OPCOES_CENTAVOS, "bônus");
    const obs = V.texto(b.observacao || "", "observação", { max: 200, obrigatorio: false });
    const lojaNome = V.texto(b.loja, "loja", { min: 3, max: 160 });
    const [local, marca] = await Promise.all([x.localDaLoja(u.uid, b.local), x.marcaDoPedido(b.marcaId)]);
    const abertos = (await db.collection("solicitacoes").where("uid", "==", u.uid).where("status", "==", "aberta").get()).docs.filter((d) => d.data().tipo === "ruptura" && d.data().expiraEm?.toMillis() > Date.now());
    if (abertos.length >= R.MAX_ABERTOS_POR_LOJA) throw new Falha(409, `Você já tem ${R.MAX_ABERTOS_POR_LOJA} chamados relâmpago abertos.`, "limite-rupturas");

    const agora = Date.now(), data = V.hojeSP(agora), entrada = V.horaSP(agora);
    const fimMs = Math.min(agora + R.DURACAO_MIN * 60_000, V.instanteSP(data, "23:59")), saida = V.horaSP(fimMs);
    const minutos = Math.max(1, Math.round((fimMs - agora) / 60_000));
    const sp = S.calcularDiaria(await taxas.obter(), "bronze", bonus), ref = db.collection("solicitacoes").doc();
    const alvos = await destinatarios({ lat: local.lat, lng: local.lng, setor: foco });
    const pedido = {
      uid: u.uid, loja: lojaNome, data, entrada, saida, horario: `${entrada} – ${saida}`, minutos, foco, valorPromotorCentavos: sp.promotor, modelo: sp.modelo, status: "aberta", criadoEm: ts(),
      tipo: "ruptura", urgente: true, bonusCentavos: bonus, observacao: obs, expiraEm: Timestamp.fromMillis(agora + R.EXPIRA_MIN * 60_000), raioAlertaKm: R.RAIO_KM,
      exigeExecucao: true, local: { lat: local.lat, lng: local.lng }, regiao: { cidade: local.cidade, uf: local.uf }, raioM: C.GEO.RAIO_METROS, ...(marca || {}), alerta: { destinatarios: alvos.length }
    };
    const lote = db.batch();
    lote.set(ref, pedido);
    lote.set(db.collection("solicitacoes_financeiro").doc(ref.id), { uid: u.uid, ...visaoLoja(sp), criadoEm: ts() });
    lote.set(db.collection("pagamentos_internos").doc(ref.id), { uid: u.uid, split: sp, status: "criado", criadoEm: ts() });
    await lote.commit();
    const push = await enviarPush(alvos, { tipo: "ruptura", pedidoId: ref.id, titulo: "⚡ Chamado relâmpago", corpo: `${lojaNome} · ${C.SETORES_ROTULO[foco] || foco} · bônus de R$ ${(bonus / 100).toFixed(2).replace(".", ",")}`, url: `promotor.html#oferta=${ref.id}` });
    await ref.set({ alerta: { destinatarios: alvos.length, push, em: Timestamp.now() } }, { merge: true });
    res.json({ id: ref.id, ...visaoLoja(sp), destinatarios: alvos.length, push, expiraEmMin: R.EXPIRA_MIN });
  }));

  /** Chamados sem aceite depois de EXPIRA_MIN são encerrados (sem multa para a loja). Usado pelo cron e sob demanda. */
  x.expirarRupturas = async () => {
    let n = 0; const agora = Date.now();
    for (const d of (await db.collection("solicitacoes").where("status", "==", "aberta").get()).docs) {
      const o = d.data(); if (o.tipo !== "ruptura" || !(o.expiraEm?.toMillis() < agora)) continue;
      await db.runTransaction(async (tx) => { const c = (await tx.get(d.ref)).data(); if (c?.status === "aberta") tx.update(d.ref, { status: "cancelada", motivoCancelamento: "expirada", canceladoPor: "sistema", canceladoEm: ts() }); });
      n++;
    }
    return { expiradas: n };
  };
  x.destinatariosRuptura = destinatarios;
};
