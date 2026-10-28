// ============================================================
// ABASTECE JÁ — Servidor Node.js / Express (Render)
// Raiz de composição: segurança HTTP + rotas por domínio. A verdade das regras de negócio mora AQUI.
//
//   rotas/conta.js        cadastro (loja/promotor, 16+), dados privados cifrados, habilitação
//   rotas/treinamento.js  treinamento obrigatório PRATICAMENTE
//   rotas/pedidos.js      pedidos, aceite (com todas as travas), cancelar, desistir, avaliar, cartão
//   rotas/pagamentos.js   checkout (conta da plataforma), webhook assinado, confirmação
//   rotas/carteira.js     carteira digital, saque, extrato e CSV (profissional e loja)
//   rotas/admin.js        aprovação, módulos, estornos, saques, conciliação, auditoria (papel admin)
//   rotas/teste.js        sandbox (só com MODO_TESTE=1 e fora de produção)
// ============================================================
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");
const S = require("./split");
const C = require("./lib/config");
const { Falha } = require("./lib/erros");
const Seg = require("./lib/seguranca");
const Cripto = require("./lib/cripto");
const V = require("./lib/validacao");
const { criarCarteira } = require("./lib/carteira");
const { criarTreinamento } = require("./lib/treinamento");
const { criarHabilitacao } = require("./lib/habilitacao");

// ---------- Ambiente ----------
const MODO_TESTE = ["1", "true", "sim"].includes(String(process.env.MODO_TESTE || "").trim().toLowerCase());
if (MODO_TESTE && C.PRODUCAO) { console.error("🛑 MODO_TESTE não pode ficar ligado em produção (AMBIENTE=producao). Desligue e reinicie."); process.exit(1); }
const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");
const PORT = process.env.PORT || 3000;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || "";      // conta da PLATAFORMA: todo pagamento entra aqui
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
if (C.PRODUCAO) {
  const faltam = [["MP_ACCESS_TOKEN", MP_ACCESS_TOKEN], ["MP_WEBHOOK_SECRET", MP_WEBHOOK_SECRET], ["APP_URL", APP_URL]].filter(([, v]) => !v).map(([k]) => k);
  if (faltam.length) { console.error(`🛑 Variáveis obrigatórias ausentes em produção: ${faltam.join(", ")}`); process.exit(1); }
}

// ---------- Firebase Admin ----------
function credencialFirebase() {
  let bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!bruto) {
    for (const caminho of [path.join(__dirname, "..", "serviceAccountKey.json"), path.join(__dirname, "serviceAccountKey.json")]) {
      try { if (fs.existsSync(caminho)) { bruto = fs.readFileSync(caminho, "utf8"); break; } } catch (e) { console.error("Erro ao ler credenciais locais:", e.message); }
    }
  }
  if (!bruto) return null;
  const texto = bruto.trim().startsWith("{") ? bruto : Buffer.from(bruto, "base64").toString("utf8");
  return admin.credential.cert(JSON.parse(texto));
}
if (!admin.apps.length) {
  const credential = credencialFirebase();
  if (!credential && !process.env.FIRESTORE_EMULATOR_HOST) console.error("⚠️  FIREBASE_SERVICE_ACCOUNT ausente: o acesso ao Firestore vai falhar.");
  admin.initializeApp({ ...(credential ? { credential } : {}), projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "abastece-ja-240d5" });
}
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

// ---------- Utilidades compartilhadas ----------
const MP_API = "https://api.mercadopago.com";
const getBaseUrl = (req) => {
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "");
  return `${req.get("x-forwarded-proto") === "https" ? "https" : req.protocol}://${req.get("host")}`;
};
const urlPublicaHttps = (u) => /^https:\/\/[^/\s]+\.[^/\s]+/.test(u) && !/localhost|127\.0\.0\.1/.test(u);
async function mp(caminho, init = {}, token = MP_ACCESS_TOKEN) {
  if (!token) throw new Falha(500, "Mercado Pago não configurado no servidor.", "mp-nao-configurado");
  let r;
  try { r = await fetch(MP_API + caminho, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } }); }
  catch (e) { console.error("MP rede", caminho, e.message); throw new Falha(502, "Não foi possível falar com o Mercado Pago agora. Tente novamente.", "mp-rede"); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("MP erro", caminho, r.status, JSON.stringify(j).slice(0, 500));
    throw new Falha(502, r.status === 401 || r.status === 403 ? "O Mercado Pago não aceitou a credencial da plataforma." : r.status === 404 ? "O Mercado Pago não encontrou o recurso pedido." : "Mercado Pago recusou a operação.", "mp", { status: r.status });
  }
  return j;
}

const auth = Seg.criarAuth({ admin, db, FieldValue, modoTeste: MODO_TESTE });
const limitador = Seg.criarLimitador(), { limitar } = limitador;
const carteira = criarCarteira({ db, FieldValue, Timestamp });
const treinamento = criarTreinamento({ db, FieldValue, Timestamp, admin });
const habilitacao = criarHabilitacao({ db, treinamento });
const ctx = {
  db, admin, FieldValue, Timestamp, S, C, V, Cripto, Falha, auth, limitar, carteira, treinamento, habilitacao, mp,
  envelope: Seg.envelope, MODO_TESTE, MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, CRON_SECRET, APP_URL, getBaseUrl, urlPublicaHttps,
  __reset: () => limitador._baldes.clear(),   // uso exclusivo dos testes
  hojeSP: V.hojeSP, reais: (c) => Number((c / 100).toFixed(2)),
  visaoLoja: (sp) => ({ valor: sp.valor, taxaFixa: sp.taxaFixa, total: sp.total })
};

// ---------- Pipeline HTTP ----------
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
const permitidas = Seg.origensPermitidas(APP_URL, process.env.ORIGENS_PERMITIDAS);
app.use(Seg.cabecalhos());
app.use(cors(Seg.opcoesCors(permitidas)));
app.use(express.json({ limit: C.BODY_LIMITE }));
app.use(Seg.protecaoCsrf(permitidas, { isentas: ["/webhookMP"] }));
app.use(limitar({ janelaMs: 60_000, max: 240, nome: "global" }));
app.use(/^\/(saude|cadastro|perfil|habilitacao|treinamento|criar|aceitar|cancelar|desistir|avaliar|cartao|confirmar|webhook|carteira|loja|admin|interno|aviso|turnos|teste)/, Seg.semCache);

app.get("/saude", (req, res) => res.json({ ok: true }));

for (const rota of ["conta", "treinamento", "pedidos", "turnos", "pagamentos", "carteira", "admin", "teste"]) require(`./rotas/${rota}`)(app, ctx);

// ---------- Site estático (somente extensões permitidas; nada de código do servidor, regras ou segredos) ----------
const RAIZ = path.join(__dirname, "..");
const BLOQUEADOS = /^\/(server|functions|test|scripts|node_modules|docs)(\/|$)|(^|\/)\./i;
app.use((req, res, next) => {
  const p = decodeURIComponent(req.path);
  if (BLOQUEADOS.test(p) || !/^\/([\w.-]+\/)*[\w.-]*$/.test(p)) return res.status(404).send("Not Found");
  if (p !== "/" && !/\.(html|css|js|png|svg|ico|webp|woff2)$/i.test(p) && p !== "/manifest.json") return res.status(404).send("Not Found");
  next();
});
app.use(express.static(RAIZ, { dotfiles: "ignore", index: ["index.html"], maxAge: 0, setHeaders: (res, f) => { if (f.endsWith("sw.js")) res.setHeader("Cache-Control", "no-cache"); } }));
app.use((req, res) => res.status(404).json({ erro: "não encontrado", codigo: "rota-inexistente" }));
app.use(Seg.tratadorErros);

if (require.main === module) app.listen(PORT, "0.0.0.0", () => console.log(`Servidor rodando na porta ${PORT}${MODO_TESTE ? " — MODO_TESTE ligado" : ""}`));
module.exports = { app, ctx };
