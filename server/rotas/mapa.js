// Mapa de promotores online. O RAIO de atendimento vem do Admin Root (lib/operacao.js; PUT /root/operacao); não há segunda configuração.
//   POST /promotor/online              promotor → { online, lat, lng, rumo?, precisao? }: heartbeat de posição / sair do mapa
//   GET  /loja/promotores-proximos     loja → pins anônimos dentro do raio, a partir da localização CADASTRADA da loja
module.exports = (app, x) => {
  const { db, auth, V, Falha, envelope, limitar, operacao, mapa } = x;
  const por = (nome, max, janelaMs = 60_000) => limitar({ janelaMs, max, nome, porUsuario: true });

  // ---------- promotor: aparece (ou sai) do mapa ----------
  app.post("/promotor/online", auth.exigir("promotor"), por("promotor-online", 30), envelope(async (req, res) => {
    const b = req.body || {}, online = V.booleano(b.online, "online"), uid = req.usuario.uid;
    if (!online) { await mapa.offline(uid); return res.json({ ok: true, online: false }); }
    const r = await mapa.posicao(uid, b);
    if (r.motivo === "nao-habilitado") throw new Falha(403, "Seu cadastro ainda não está liberado para ficar online. Conclua o treinamento e aguarde a aprovação.", "promotor-nao-habilitado");
    res.json({ ok: true, online: true, gravado: r.gravado, motivo: r.motivo || null, raioKm: (await operacao.obter()).raioKm });
  }));

  // ---------- loja: quem está por perto ----------
  app.get("/loja/promotores-proximos", auth.exigir("loja"), por("loja-mapa", 40), envelope(async (req, res) => {
    const cfg = await operacao.obter(), loc = ((await db.collection("contratantes").doc(req.usuario.uid).get()).data() || {}).localizacao;
    // Só a localização CADASTRADA da loja é usada: aceitar coordenadas do navegador permitiria varrer a cidade inteira pedindo posições de qualquer ponto.
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return res.json({ semLocalizacao: true, raioKm: cfg.raioKm, versaoRaio: cfg.versao, total: 0, pins: [] });
    res.json({ ...(await mapa.proximos({ lat: loc.lat, lng: loc.lng, raioKm: cfg.raioKm })), loja: { lat: loc.lat, lng: loc.lng }, versaoRaio: cfg.versao });
  }));
};
