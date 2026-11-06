// Mural de Vagas / Banco de Talentos. Regras em ../lib/vagas.js; aqui só HTTP: papel, limite de uso, validação e auditoria.
//   Profissional (promotor): divulgação (opt-in LGPD), currículo em PDF, mural, candidatura em 1 clique, minhas candidaturas.
//   Admin: configuração da fase gratuita/cobrança, empresas (redes parceiras), vagas em nome delas, moderação e candidatos.
//   Empresa (loja): publica e acompanha as próprias vagas — a API está pronta; a tela da loja entra numa próxima etapa.
// Todo acesso a currículo e CPF completo passa por aqui e deixa rastro em `auditoria`. Ver MODULO-VAGAS.md.
module.exports = (app, x) => {
  const { auth, V, envelope, limitar, vagas, express } = x;
  // auth ANTES do limitador: assim o limite é por usuário (e não por IP, que é o que acontece com req.usuario ainda vazio).
  const porUsuario = (nome, max, janelaMs = 60_000) => limitar({ janelaMs, max, nome, porUsuario: true });
  const PROM = (nome, max, janelaMs) => [auth.exigir("promotor"), porUsuario(nome, max, janelaMs)];
  const ADM = [auth.exigir("admin"), porUsuario("admin-vagas", 120)];
  const LOJA = [auth.exigir("loja"), porUsuario("loja-vagas", 60)];
  const uidDe = (req) => req.usuario.uid;
  const enviarPdf = (res, buf) => {
    res.setHeader("Content-Type", "application/pdf"); res.setHeader("Content-Disposition", 'inline; filename="curriculo.pdf"');   // nome fixo: nada do usuário vai para o cabeçalho
    res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Cache-Control", "no-store"); res.send(buf);
  };
  const filtroStatus = (q) => ({ status: q.status ? String(q.status) : undefined, q: q.q ? V.texto(String(q.q), "busca", { max: 80 }) : undefined });

  // =============== Profissional ===============
  /** Situação do perfil para vagas: termo de consentimento (texto + versão), currículo atual, nome/CPF mascarado e o que falta. */
  app.get("/perfil/vagas", ...PROM("vg-perfil", 60), envelope(async (req, res) => res.json(await vagas.situacaoPerfil(uidDe(req)))));

  app.put("/perfil/vagas/consentimento", ...PROM("vg-consent", 20), envelope(async (req, res) => {
    const b = V.somente(req.body, ["aceito", "versao"]);
    await vagas.definirConsentimento(uidDe(req), b.aceito, b.versao);
    await auth.auditar(req, b.aceito ? "vagas.divulgacao.aceitar" : "vagas.divulgacao.revogar", uidDe(req), { versao: b.versao || "" });
    res.json({ ok: true, ...(await vagas.situacaoPerfil(uidDe(req))) });
  }));

  // O PDF viaja em JSON/base64 (a proteção CSRF do app exige application/json). Parser PRÓPRIO e DEPOIS da autenticação:
  // o limite global é de 20 kb, e um corpo de ~7 MB não pode ser lido de quem nem está logado.
  const jsonPdf = express.json({ limit: "7mb" });
  app.put("/perfil/curriculo", ...PROM("vg-pdf", 6, 3_600_000), jsonPdf, envelope(async (req, res) => {
    const b = V.somente(req.body, ["arquivo", "nome"]);
    const r = await vagas.salvarCurriculo(uidDe(req), b.arquivo, b.nome);
    await auth.auditar(req, "vagas.curriculo.enviar", uidDe(req), { bytes: r.bytes });
    res.json({ ok: true, ...(await vagas.situacaoPerfil(uidDe(req))) });
  }));
  app.get("/perfil/curriculo", ...PROM("vg-pdf-ver", 30), envelope(async (req, res) => enviarPdf(res, await vagas.lerCurriculoProprio(uidDe(req)))));
  app.delete("/perfil/curriculo", ...PROM("vg-pdf-del", 10), envelope(async (req, res) => {
    await vagas.apagarCurriculo(uidDe(req));
    await auth.auditar(req, "vagas.curriculo.apagar", uidDe(req));
    res.json({ ok: true, ...(await vagas.situacaoPerfil(uidDe(req))) });
  }));

  app.get("/vagas", ...PROM("vg-feed", 120), envelope(async (req, res) => {
    const q = req.query || {};
    res.json(await vagas.feed(uidDe(req), {
      cidade: q.cidade ? V.texto(String(q.cidade), "cidade", { max: 100, re: /^[a-z0-9-]+$/ }) : "",
      tipo: q.tipo ? V.opcao(String(q.tipo), Object.keys(vagas.TIPOS), "tipo") : "",
      empresaId: q.rede ? V.idDoc(String(q.rede), "rede") : ""
    }));
  }));
  app.get("/vagas/minhas-candidaturas", ...PROM("vg-minhas", 60), envelope(async (req, res) => res.json(await vagas.minhasCandidaturas(uidDe(req)))));
  app.post("/vagas/:id/candidatar", ...PROM("vg-cand", 30, 3_600_000), envelope(async (req, res) => {
    const r = await vagas.candidatar(uidDe(req), V.idDoc(req.params.id, "id"));
    await auth.auditar(req, "vagas.candidatar", r.id, { vagaId: req.params.id });
    res.json({ ok: true, ...r });
  }));

  // =============== Admin ===============
  app.get("/admin/vagas/config", ...ADM, envelope(async (req, res) => { const cfg = await vagas.lerConfig(); res.json({ ...cfg, faseGratuitaAtiva: vagas.faseGratuitaAtiva(cfg) }); }));
  app.put("/admin/vagas/config", ...ADM, envelope(async (req, res) => {
    const antes = await vagas.lerConfig(), cfg = await vagas.salvarConfig(req.body);
    await auth.auditar(req, "vagas.config.alterar", "vagas", { antes, depois: cfg });   // virar a chave de cobrança fica registrado
    res.json({ ...cfg, faseGratuitaAtiva: vagas.faseGratuitaAtiva(cfg) });
  }));

  app.get("/admin/vagas/empresas", ...ADM, envelope(async (req, res) => res.json(await vagas.listarEmpresas())));
  app.post("/admin/vagas/empresas", ...ADM, envelope(async (req, res) => {
    const e = await vagas.criarEmpresa({ nome: req.body?.nome, tipo: req.body?.tipo, uid: uidDe(req) });
    await auth.auditar(req, "vagas.empresa.criar", e.id, { nome: e.nome, tipo: e.tipo }); res.json(e);
  }));
  /** Cobrança manual (enquanto não há checkout): marca a assinatura até uma data e/ou soma/subtrai créditos. */
  app.put("/admin/vagas/empresas/:id/plano", ...ADM, envelope(async (req, res) => {
    const b = V.somente(req.body, ["assinaturaAte", "creditosDelta"]), e = await vagas.ajustarPlano(V.idDoc(req.params.id, "id"), b);
    await auth.auditar(req, "vagas.empresa.plano", req.params.id, b); res.json(e);
  }));

  app.get("/admin/vagas", ...ADM, envelope(async (req, res) => {
    const q = req.query || {};
    res.json(await vagas.listarGestao({
      empresaId: q.empresaId ? V.idDoc(String(q.empresaId), "empresaId") : "",
      status: q.status ? V.opcao(String(q.status), vagas.STATUS_VAGA, "status") : "",
      moderacao: q.moderacao ? V.opcao(String(q.moderacao), vagas.MODERACAO, "moderação") : ""
    }));
  }));
  app.post("/admin/vagas", ...ADM, envelope(async (req, res) => {
    const b = V.somente(req.body, ["empresaId", "titulo", "descricao", "cidade", "uf", "tipo", "apenasMaiores", "expiraEm", "publicar"]);
    const empresa = await vagas.empresaPorId(b.empresaId), publicar = b.publicar === undefined ? false : V.booleano(b.publicar, "publicar");
    const v = await vagas.criarVaga({ empresa, dados: b, origem: "admin", uid: uidDe(req), publicar });
    await auth.auditar(req, "vagas.admin.criar", v.id, { empresaId: empresa.id, publicar }); res.json(v);
  }));
  app.put("/admin/vagas/:id", ...ADM, envelope(async (req, res) => {
    const v = await vagas.atualizarVaga(req.params.id, req.body, { origem: "admin" });
    await auth.auditar(req, "vagas.admin.editar", req.params.id, { campos: Object.keys(V.somente(req.body, ["titulo", "descricao", "cidade", "uf", "tipo", "apenasMaiores", "expiraEm"])) }); res.json(v);
  }));
  app.put("/admin/vagas/:id/status", ...ADM, envelope(async (req, res) => {
    const v = await vagas.mudarStatus(req.params.id, req.body?.status, { origem: "admin", uid: uidDe(req) });
    await auth.auditar(req, "vagas.admin.status", req.params.id, { status: v.status }); res.json(v);
  }));
  app.put("/admin/vagas/:id/moderacao", ...ADM, envelope(async (req, res) => {
    const v = await vagas.moderar(req.params.id, req.body?.estado, req.body?.motivo, uidDe(req));
    await auth.auditar(req, "vagas.admin.moderar", req.params.id, { estado: v.moderacao }); res.json(v);
  }));

  // Candidatos: POST (e não GET) para que o filtro por CPF não vá parar na URL/logs de acesso.
  app.post("/admin/vagas/:id/candidaturas", ...ADM, envelope(async (req, res) => {
    const b = V.somente(req.body, ["status", "q", "cpf"]);
    res.json(await vagas.listarCandidaturas(req.params.id, { status: b.status || undefined, q: b.q ? V.texto(b.q, "busca", { max: 80 }) : undefined, cpf: b.cpf || undefined }));
  }));
  app.put("/admin/vagas/candidaturas/:id/status", ...ADM, envelope(async (req, res) => {
    const r = await vagas.mudarStatusCandidatura(req.params.id, req.body?.status, { uid: uidDe(req) });
    await auth.auditar(req, "vagas.candidatura.status", req.params.id, { de: r.de, para: r.status }); res.json(r);
  }));
  app.get("/admin/vagas/candidaturas/:id/curriculo", ...ADM, envelope(async (req, res) => {
    const buf = await vagas.curriculoDaCandidatura(req.params.id);
    await auth.auditar(req, "vagas.curriculo.ver", req.params.id, { por: "admin" }); enviarPdf(res, buf);
  }));
  /** CPF completo só sob demanda: login recente + rastro. A lista mostra sempre o CPF mascarado. */
  app.post("/admin/vagas/candidaturas/:id/cpf", ...ADM, envelope(async (req, res) => {
    auth.exigirRecente(req.usuario);
    const cpf = await vagas.revelarCpf(req.params.id);
    await auth.auditar(req, "vagas.candidatura.ver_cpf", req.params.id);
    res.json({ cpf, cpfFormatado: `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` });
  }));

  // =============== Empresa (loja) ===============
  const empresaDe = (req) => vagas.empresaDaLoja(uidDe(req));
  app.get("/loja/vagas", ...LOJA, envelope(async (req, res) => {
    const e = await empresaDe(req), cfg = await vagas.lerConfig();
    res.json({ empresa: { id: e.id, nome: e.nome }, plano: { gratuito: vagas.faseGratuitaAtiva(cfg), gratuitoAte: cfg.gratuitoAte, modelo: cfg.modelo, creditos: e.creditos || 0, limiteGratis: cfg.maxVagasAtivasGratis }, vagas: await vagas.listarGestao({ empresaId: e.id }) });
  }));
  app.post("/loja/vagas", ...LOJA, envelope(async (req, res) => {
    const b = V.somente(req.body, ["titulo", "descricao", "cidade", "uf", "tipo", "apenasMaiores", "expiraEm", "publicar"]);
    const e = await empresaDe(req), publicar = b.publicar === undefined ? false : V.booleano(b.publicar, "publicar");
    const v = await vagas.criarVaga({ empresa: e, dados: b, origem: "empresa", uid: uidDe(req), publicar });
    await auth.auditar(req, "vagas.loja.criar", v.id, { publicar }); res.json(v);
  }));
  app.put("/loja/vagas/:id", ...LOJA, envelope(async (req, res) => {
    const e = await empresaDe(req), v = await vagas.atualizarVaga(req.params.id, req.body, { origem: "empresa", empresaId: e.id });
    await auth.auditar(req, "vagas.loja.editar", req.params.id); res.json(v);
  }));
  app.put("/loja/vagas/:id/status", ...LOJA, envelope(async (req, res) => {
    const e = await empresaDe(req), v = await vagas.mudarStatus(req.params.id, req.body?.status, { origem: "empresa", uid: uidDe(req), empresaId: e.id });
    await auth.auditar(req, "vagas.loja.status", req.params.id, { status: v.status }); res.json(v);
  }));
  app.get("/loja/vagas/:id/candidaturas", ...LOJA, envelope(async (req, res) => {
    const e = await empresaDe(req); res.json(await vagas.listarCandidaturas(req.params.id, { empresaId: e.id, ...filtroStatus(req.query || {}) }));
  }));
  app.put("/loja/vagas/candidaturas/:id/status", ...LOJA, envelope(async (req, res) => {
    const e = await empresaDe(req), r = await vagas.mudarStatusCandidatura(req.params.id, req.body?.status, { uid: uidDe(req), empresaId: e.id });
    await auth.auditar(req, "vagas.candidatura.status", req.params.id, { de: r.de, para: r.status, por: "empresa" }); res.json(r);
  }));
  app.get("/loja/vagas/candidaturas/:id/curriculo", ...LOJA, envelope(async (req, res) => {
    const e = await empresaDe(req), buf = await vagas.curriculoDaCandidatura(req.params.id, e.id);
    await auth.auditar(req, "vagas.curriculo.ver", req.params.id, { por: "empresa", empresaId: e.id }); enviarPdf(res, buf);
  }));
};
