// Chat de suporte (equipe ↔ loja/promotor) e registro de aparelhos para notificação push.
// Leitura em tempo real pelo navegador (regras do Firestore); TODA escrita passa por aqui.
module.exports = (app, x) => {
  const { auth, V, Falha, envelope, limitar, suporte } = x;
  const USU = ["loja", "promotor"];
  const limUsuario = limitar({ janelaMs: 60_000, max: 20, nome: "suporte-msg", porUsuario: true });
  const limAdmin = limitar({ janelaMs: 60_000, max: 60, nome: "suporte-adm", porUsuario: true });
  const PAGINA = { loja: "index.html", promotor: "promotor.html" };

  // ---------- lado do usuário ----------
  app.post("/suporte/mensagem", auth.exigir(...USU), limUsuario, envelope(async (req, res) => {
    const texto = V.texto(req.body?.texto, "mensagem", { min: 1, max: 1000 }), uid = req.usuario.uid;
    const { nome } = await suporte.postar({ uid, de: "usuario", texto, autorUid: uid, dica: req.usuario.role });
    await suporte.enviarPush({ admins: true, titulo: `Suporte · ${nome || "nova mensagem"}`, corpo: texto, url: "admin.html#suporte" });
    res.json({ ok: true });
  }));
  app.post("/suporte/lido", auth.exigir(...USU), limUsuario, envelope(async (req, res) => { await suporte.marcarLido(req.usuario.uid, "usuario"); res.json({ ok: true }); }));

  // ---------- lado da equipe ----------
  app.post("/admin/suporte/:uid/mensagem", auth.exigir("admin"), limAdmin, envelope(async (req, res) => {
    const uid = V.idDoc(req.params.uid, "uid"), texto = V.texto(req.body?.texto, "mensagem", { min: 1, max: 1000 });
    const { tipo } = await suporte.postar({ uid, de: "suporte", texto, autorUid: req.usuario.uid });
    await auth.auditar(req, "admin.suporte.responder", uid, { tamanho: texto.length });
    await suporte.enviarPush({ uid, titulo: "Suporte Abastece Já", corpo: texto, url: `${PAGINA[tipo] || "index.html"}?suporte=1` });
    res.json({ ok: true });
  }));
  app.post("/admin/suporte/:uid/lido", auth.exigir("admin"), limAdmin, envelope(async (req, res) => { await suporte.marcarLido(V.idDoc(req.params.uid, "uid"), "suporte"); res.json({ ok: true }); }));

  // ---------- aparelhos (push) ----------
  const tokenValido = (t) => { if (typeof t !== "string" || t.length < 20 || t.length > 4096 || /\s/.test(t)) throw new Falha(400, "Token de notificação inválido.", "dados-invalidos"); return t; };
  app.post("/push/registrar", auth.exigir("loja", "promotor", "admin"), limUsuario, envelope(async (req, res) => {
    await suporte.registrarToken({ uid: req.usuario.uid, token: tokenValido(req.body?.token), admin: req.usuario.role === "admin", ua: req.get("user-agent") });
    res.json({ ok: true });
  }));
  app.post("/push/remover", auth.exigir("loja", "promotor", "admin"), limUsuario, envelope(async (req, res) => {
    await suporte.removerToken({ uid: req.usuario.uid, token: tokenValido(req.body?.token) }); res.json({ ok: true });
  }));
};
