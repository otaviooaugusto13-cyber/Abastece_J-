// Painel do ADMIN ROOT. Tudo aqui exige login válido + papel admin + claim is_root (ver lib/root.js).
//   GET /config/operacao        público   → raio + interruptores (o app consulta/exibe; o tempo real vem de config_publica/operacao)
//   GET /root/painel            root      → operação + taxas vigentes (com limites e padrão) para montar a tela
//   PUT /root/operacao          root      → { raioKm, versao }                      raio de atendimento 1–50 km
//   PUT /root/master            root      → { cadastros?, missoes?, pagamentos?, motivo, versao }   Master Switch / kill-switch
//   PUT /root/taxas             root      → mesmo contrato de PUT /admin/taxas (ver rotas/taxas.js)
//   GET /root/auditoria         root      → trilha encadeada (filtros: acao, cursor, limite)
//   GET /root/auditoria/verificar root    → confere a cadeia de hashes
module.exports = (app, x) => {
  const { auth, S, Falha, envelope, limitar, taxas, operacao, root } = x;
  const OP = require("../lib/operacao");
  const LER = [...root.exigirRoot, limitar({ janelaMs: 60_000, max: 120, nome: "root", porUsuario: true })];
  const ESCREVER = [...root.exigirRoot, limitar({ janelaMs: 3600_000, max: 60, nome: "root-salvar", porUsuario: true })];
  const versaoDe = (b) => { if (b.versao === undefined) return undefined; const v = Number(b.versao); if (!Number.isInteger(v)) throw new Falha(400, "Versão inválida.", "operacao-invalida"); return v; };

  app.get("/config/operacao", limitar({ janelaMs: 60_000, max: 120, nome: "operacao-publica" }), envelope(async (req, res) => { res.json(operacao.visaoPublica(await operacao.obter())); }));

  app.get("/root/painel", ...LER, envelope(async (req, res) => {
    const [op, tx] = await Promise.all([operacao.obter(), taxas.obter()]);
    res.json({ eu: { uid: req.usuario.uid, email: req.usuario.email || "" }, operacao: op, limitesOperacao: { raioKm: OP.LIMITES.raioKm }, taxas: { ...tx, limites: S.LIMITES, padrao: S.PADRAO } });
  }));

  app.put("/root/operacao", ...ESCREVER, envelope(async (req, res) => {
    auth.exigirRecente(req.usuario);
    const corpo = req.body || {}, { erro, patch } = OP.validarAlteracao({ raioKm: corpo.raioKm });
    if (erro) throw new Falha(400, erro, "operacao-invalida");
    const versaoEsperada = versaoDe(corpo), antes = await operacao.obter();
    const r = await root.comAuditoria(req, { acao: "root.raio.alterar", alvoId: "operacao", resumo: `Raio de atendimento ${antes.raioKm} km → ${patch.raioKm} km`, antes: { raioKm: antes.raioKm }, depois: { raioKm: patch.raioKm } },
      async () => { const o = await operacao.salvar(patch, { ator: req.usuario.uid, versaoEsperada }); return { ...o, antes: { raioKm: o.antes.raioKm }, depois: { raioKm: o.depois.raioKm, versao: o.depois.versao } }; });
    res.json({ ok: true, operacao: r.depois && (await operacao.obter()) });
  }));

  app.put("/root/master", ...ESCREVER, envelope(async (req, res) => {
    const corpo = req.body || {}, { erro, patch } = OP.validarAlteracao({ cadastros: corpo.cadastros, missoes: corpo.missoes, pagamentos: corpo.pagamentos, motivo: corpo.motivo });
    if (erro) throw new Falha(400, erro, "operacao-invalida");
    // Pausar é a direção segura e urgente (botão de pânico): não exige login recente. Religar exige, como qualquer ação de risco.
    if (Object.values(patch.master).includes(true)) auth.exigirRecente(req.usuario);
    const versaoEsperada = versaoDe(corpo), antes = await operacao.obter();
    const resumo = Object.entries(patch.master).map(([k, v]) => `${k}: ${antes.master[k] ? "ligado" : "PAUSADO"} → ${v ? "ligado" : "PAUSADO"}`).join("; ");
    const r = await root.comAuditoria(req, { acao: "root.master.alterar", alvoId: "operacao", resumo, antes: { master: antes.master, motivoPausa: antes.motivoPausa }, depois: { master: { ...antes.master, ...patch.master }, motivo: patch.motivo || "" } },
      async () => { const o = await operacao.salvar(patch, { ator: req.usuario.uid, versaoEsperada }); return { ...o, antes: { master: o.antes.master, motivoPausa: o.antes.motivoPausa }, depois: { master: o.depois.master, motivoPausa: o.depois.motivoPausa, versao: o.depois.versao } }; });
    res.json({ ok: true, operacao: await operacao.obter(), alterado: r.depois.master });
  }));

  app.get("/root/auditoria", ...LER, envelope(async (req, res) => {
    const q = req.query || {};
    res.json(await root.auditoria.listar({ acao: typeof q.acao === "string" ? q.acao.slice(0, 60) : undefined, resultado: typeof q.resultado === "string" ? q.resultado.slice(0, 20) : undefined, limite: q.limite, cursor: typeof q.cursor === "string" && /^\d{13}_\d{10}$/.test(q.cursor) ? q.cursor : undefined }));
  }));
  app.get("/root/auditoria/verificar", ...LER, envelope(async (req, res) => { res.json(await root.auditoria.verificar({ limite: req.query?.limite })); }));
};
