// Admin ROOT: topo da hierarquia. Autoridade = custom claim `is_root: true` (assinada no token; só o servidor a escreve) + papel admin.
// Toda alteração passa por comAuditoria(): grava a INTENÇÃO na trilha antes de mexer (se a trilha falhar, nada muda),
// aplica, e grava o RESULTADO (aplicado/falhou). Trilha = root_auditoria, encadeada por hash (ver lib/ti/auditoria.js):
//   alterar/apagar um registro no banco quebra a cadeia e GET /root/auditoria/verificar acusa.
const crypto = require("crypto");
const { Falha } = require("./erros");
const { criarAuditoria } = require("./ti/auditoria");

function criarRoot({ db, admin, FieldValue, Timestamp, auth }) {
  const auditoria = criarAuditoria({ db, FieldValue, Timestamp, colecao: "root_auditoria", cadeia: "root_auditoria_cadeia" });

  /** Quem age: identidade do token + IP (req.ip respeita `trust proxy`, ou seja, o IP real atrás do Render) + user-agent + rota. */
  const atorDe = (req) => ({ uid: req.usuario?.uid || "", nome: String(req.usuario?.name || ""), email: req.usuario?.email || "", nivel: "root",
    ip: req.ip || "", ua: String(req.get?.("user-agent") || ""), rota: `${req.method} ${req.path}`, reqId: req.reqId || "" });

  const marcarReq = (req, res, next) => { req.reqId = crypto.randomBytes(6).toString("hex"); res.setHeader?.("X-Request-Id", req.reqId); next(); };
  const soRoot = async (req, res, next) => {
    if (req.usuario?.is_root === true) return next();
    await auditoria.registrar(atorDe(req), { acao: "root.acesso.negado", resultado: "negado", resumo: "Administrador sem a flag is_root tentou usar o painel Root." });
    next(new Falha(403, "Apenas o administrador Root pode alterar estes parâmetros.", "sem-root"));
  };
  /** Cadeia de middlewares: login válido (não revogado) → papel admin → is_root. Use com spread: ...root.exigirRoot */
  const exigirRoot = [marcarReq, auth.exigir("admin"), soRoot];

  /**
   * Executa `aplicar()` cercado por auditoria. `antes`/`depois` = proposta (o que está e o que o Root pediu).
   * `aplicar` devolve { resultado, depois? } — o `depois` real (já lido do banco) vai para o registro final.
   */
  async function comAuditoria(req, { acao, alvoId = "", resumo = "", antes = null, depois = null }, aplicar) {
    const ator = atorDe(req);
    const pre = await auditoria.registrar(ator, { acao, alvoTipo: "config", alvoId, resumo, antes, depois, resultado: "solicitado" });
    if (!pre) throw new Falha(503, "A trilha de auditoria está indisponível; por segurança nada foi alterado.", "auditoria-indisponivel");
    try {
      const r = await aplicar();
      await auditoria.registrar(ator, { acao, alvoTipo: "config", alvoId, resumo, antes: r?.antes ?? antes, depois: r?.depois ?? depois, resultado: "aplicado", meta: { solicitadoSeq: pre.seq } });
      return r;
    } catch (e) {
      await auditoria.registrar(ator, { acao, alvoTipo: "config", alvoId, resumo: `${resumo} — recusado: ${e.codigo || e.message}`.slice(0, 300), antes, depois, resultado: "falhou", meta: { solicitadoSeq: pre.seq } });
      throw e;
    }
  }

  /**
   * Promove a conta (JÁ admin, e-mail verificado) a Root, no start do servidor, via ROOT_BOOTSTRAP_EMAIL. Idempotente; nunca lança.
   * Depois do 1º sucesso remova a variável do ambiente. A pessoa precisa sair e entrar de novo para o token receber a claim.
   */
  async function bootstrap(env = process.env) {
    const emails = [...new Set(String(env.ROOT_BOOTSTRAP_EMAIL || "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))], saida = [];
    for (const email of emails) {
      try {
        const u = await admin.auth().getUserByEmail(email), c = u.customClaims || {};
        if (u.emailVerified === false) { saida.push({ email, feito: false, motivo: "email-nao-verificado" }); console.warn(`⚠️  Root: ${email} tem e-mail não verificado; não foi promovido.`); continue; }
        if (!(c.admin === true || c.role === "admin" || (Array.isArray(c.perfis) && c.perfis.includes("admin")))) { saida.push({ email, feito: false, motivo: "nao-e-admin" }); console.warn(`⚠️  Root: ${email} ainda não é administrador (use ADMIN_BOOTSTRAP_EMAIL primeiro).`); continue; }
        if (c.is_root === true) { saida.push({ email, feito: false, motivo: "ja-e-root" }); continue; }
        await admin.auth().setCustomUserClaims(u.uid, { ...c, is_root: true });
        await auditoria.registrar({ uid: "sistema", nome: "Bootstrap (variável de ambiente)", email: "", nivel: "root", ip: "", ua: "", rota: "start", reqId: "" }, { acao: "root.conceder", alvoTipo: "usuario", alvoId: u.uid, resumo: `Flag is_root concedida a ${email}` });
        saida.push({ email, feito: true, uid: u.uid });
        console.log(`✅ Root: ${email} agora é Root. Peça para sair e entrar de novo; depois REMOVA ROOT_BOOTSTRAP_EMAIL do ambiente.`);
      } catch (e) { saida.push({ email, feito: false, motivo: "erro" }); console.error(`⚠️  Root: falha ao promover ${email}: ${e.code || e.message}`); }
    }
    return saida;
  }

  return { exigirRoot, comAuditoria, auditoria, bootstrap, atorDe };
}
module.exports = { criarRoot };
