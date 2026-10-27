// Treinamento obrigatório PRATICAMENTE (profissional) — o progresso é validado no servidor.
module.exports = (app, x) => {
  const { auth, envelope, limitar, treinamento, V } = x;
  app.get("/treinamento", auth.exigir("promotor"), envelope(async (req, res) => {
    const est = await treinamento.estado(req.usuario.uid);
    const sync = await treinamento.sincronizar(req.usuario.uid, est.completo, req.usuario);   // mantém flag/claim coerentes
    res.json({ ...est, atualizarToken: sync.claimAtualizada });
  }));
  app.post("/treinamento/ping", limitar({ janelaMs: 60_000, max: 20, nome: "ping", porUsuario: true }), auth.exigir("promotor"), envelope(async (req, res) => {
    const b = req.body || {};
    res.json(await treinamento.ping(req.usuario.uid, { moduloId: b.moduloId, posicaoSeg: b.posicaoSeg, tocando: b.tocando }, req.usuario));
  }));
};
