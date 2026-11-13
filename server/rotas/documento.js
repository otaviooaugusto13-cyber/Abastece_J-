// Documento de identificação (RG/CNH): envio pelo usuário e análise pelo admin.
module.exports = (app, x) => {
  const { db, FieldValue, express, auth, V, C, Cripto, Falha, envelope, limitar } = x;
  const Doc = require("../lib/documento")({ db, FieldValue, Cripto, Img: require("../lib/imagem"), Falha, C });
  const jsonFoto = express.json({ limit: C.BODY_FOTO_LIMITE });                  // o parser global (20 kb) pula esta rota: ver server.js
  const USR = auth.exigir("loja", "promotor");
  const limEnvio = limitar({ janelaMs: 3_600_000, max: 20, nome: "documento", porUsuario: true });
  const ADM = [limitar({ janelaMs: 60_000, max: 120, nome: "admin-documento", porUsuario: true }), auth.exigir("admin")];

  app.get("/perfil/documento", USR, envelope(async (req, res) => res.json(await Doc.estado(req.usuario.uid))));

  app.post("/perfil/documento/:lado", jsonFoto, limEnvio, USR, envelope(async (req, res) => {
    const tipo = V.opcao(req.body?.tipo, ["rg", "cnh"], "tipo");
    const r = await Doc.salvarLado({ uid: req.usuario.uid, papel: req.usuario.role, tipo, lado: req.params.lado, dataUrl: req.body?.foto });
    await auth.auditar(req, "documento.enviar", req.usuario.uid, { tipo, lado: req.params.lado, status: r.status });
    res.json(r);
  }));

  // ---------- admin ----------
  app.get("/admin/documentos", ...ADM, envelope(async (req, res) => res.json(await Doc.pendentes())));

  app.get("/admin/documentos/:uid/:lado", ...ADM, envelope(async (req, res) => {
    const uid = V.idDoc(req.params.uid, "uid"), buf = await Doc.ler(uid, req.params.lado);
    await auth.auditar(req, "admin.documento.ver", uid, { lado: req.params.lado });          // toda leitura de documento fica registrada
    res.json({ lado: req.params.lado, imagem: `data:image/jpeg;base64,${buf.toString("base64")}` });
  }));

  app.post("/admin/documentos/:uid/decisao", ...ADM, envelope(async (req, res) => {
    const uid = V.idDoc(req.params.uid, "uid"), status = V.opcao(req.body?.status, ["aprovado", "recusado"], "status");
    const motivo = status === "recusado" ? V.texto(req.body?.motivo, "motivo", { min: 3, max: 300 }) : "";
    const r = await Doc.decidir({ uid, status, motivo, por: req.usuario.uid });
    await auth.auditar(req, `admin.documento.${status}`, uid, { motivo });
    res.json(r);
  }));
};
