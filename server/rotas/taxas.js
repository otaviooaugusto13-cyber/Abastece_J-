// Taxas da plataforma e regras de turno, editáveis pelo admin SEM deploy.
//   GET /config/taxas   público  → o app (loja/promotor/login/termos) busca os valores vigentes
//   GET /admin/taxas    admin    → valores vigentes + metadados (versão, quem alterou, quando) e limites aceitos
//   PUT /admin/taxas    admin    → valida, grava em configuracoes/taxas, audita (antes/depois) e vale NA HORA
module.exports = (app, x) => {
  const { auth, S, Falha, envelope, limitar, taxas, root } = x;
  const ADM = [limitar({ janelaMs: 60_000, max: 120, nome: "admin", porUsuario: true }), auth.exigir("admin")];

  app.get("/config/taxas", limitar({ janelaMs: 60_000, max: 120, nome: "taxas-publicas" }), envelope(async (req, res) => {
    res.json(taxas.visaoPublica(await taxas.obter()));
  }));

  app.get("/admin/taxas", ...ADM, envelope(async (req, res) => {
    res.json({ ...(await taxas.obter()), limites: S.LIMITES, padrao: S.PADRAO });
  }));

  // Só o ROOT (is_root) altera dinheiro. Dois caminhos para o mesmo handler: /admin/taxas (tela antiga do admin) e /root/taxas (painel Root).
  const SALVAR = [...root.exigirRoot, limitar({ janelaMs: 3600_000, max: 30, nome: "taxas-salvar", porUsuario: true })];
  for (const caminho of ["/admin/taxas", "/root/taxas"]) app.put(caminho, ...SALVAR, envelope(async (req, res) => {
    auth.exigirRecente(req.usuario);                                      // mexe em dinheiro: exige login recente, como estorno e saque
    const corpo = req.body || {};
    const { erro, cfg } = S.validarTaxas(corpo);
    if (erro) throw new Falha(400, erro, "taxas-invalidas");
    const versaoEsperada = corpo.versao === undefined ? undefined : Number(corpo.versao);
    if (versaoEsperada !== undefined && !Number.isInteger(versaoEsperada)) throw new Falha(400, "Versão inválida.", "taxas-invalidas");

    const campos = (t) => t && Object.fromEntries(Object.keys(cfg).map((k) => [k, t[k]]));
    const atual = await taxas.obter();
    const { antes, depois } = await root.comAuditoria(req, { acao: "root.taxas.alterar", alvoId: "taxas", resumo: "Taxas da plataforma alteradas pelo Root", antes: campos(atual), depois: cfg },
      async () => { const r = await taxas.salvar(cfg, { ator: req.usuario.uid, versaoEsperada }); return { ...r, antes: campos(r.antes), depois: { ...campos(r.depois), versao: r.depois.versao } }; })
      .then((r) => ({ antes: r.antes, depois: r.depois }));
    await auth.auditar(req, "admin.taxas.salvar", `v${depois.versao}`, { antes, depois });   // log legado (coleção auditoria), mantido por compatibilidade
    res.json({ ok: true, ...(await taxas.obter()), limites: S.LIMITES, padrao: S.PADRAO });
  }));
};
