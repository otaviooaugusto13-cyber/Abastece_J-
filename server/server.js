// ============================================================
// ABASTECE JÁ — Servidor Node.js / Express (Render)
// Raiz de composição: segurança HTTP + rotas por domínio. A verdade das regras de negócio mora AQUI.
//
//   rotas/conta.js        cadastro (loja/promotor, 16+), dados privados cifrados, habilitação
//   rotas/treinamento.js  treinamento obrigatório PRATICAMENTE
//   rotas/categorias.js   habilitação por categoria (vídeo + timer + questionário 100%)
//   rotas/pedidos.js      pedidos, aceite (com todas as travas), cancelar, desistir, avaliar, cartão
//   rotas/pagamentos.js   checkout (conta da plataforma), webhook assinado, confirmação
//   rotas/nota.js         comprovante de serviço (layout DANFE simplificado, sem valor fiscal) + verificação pública — ver NOTA-COMPROVANTE.md
//   rotas/carteira.js     carteira digital, saque, extrato e CSV (profissional e loja)
//   rotas/taxas.js        taxas e regras de turno editáveis pelo admin (GET /config/taxas público, PUT /admin/taxas)
//   rotas/root.js         Admin Root: raio de atendimento, Master Switch, taxas e trilha de auditoria (flag is_root) — ver ROOT-ADMIN.md
//   rotas/admin.js        aprovação, módulos, estornos, saques, conciliação, auditoria (papel admin)
//   rotas/ti.js           módulo de TI: operadores, trilha de auditoria, chamados, dashboard, tempo real, presença (papel ti) — ver TI-MODULO.md
//   rotas/execucao.js     check-in (geofence 100 m), check-out com foto, falta da loja, auditoria da foto, local da loja
//   rotas/ruptura.js      chamado relâmpago + alertas por proximidade (push)
//   rotas/reputacao.js    níveis/vidas/infrações, admin e cron de manutenção
//   rotas/b2b.js          painel das marcas e administração de marcas
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
const G = require("./lib/geo");
const { criarReputacao } = require("./lib/reputacao");
const { criarCarteira } = require("./lib/carteira");
const { criarTreinamento } = require("./lib/treinamento");
const { criarHabilitacao } = require("./lib/habilitacao");
const { criarTaxas } = require("./lib/taxas");
const { criarMapa } = require("./lib/mapa");
const { criarOperacao } = require("./lib/operacao");
const { criarRoot } = require("./lib/root");
const { criarSuporte } = require("./lib/suporte");
const { criarTickets } = require("./lib/suporte-tickets");
const { criarCategorias } = require("./lib/categorias");
const { criarTI } = require("./lib/ti");
const { criarDespacho } = require("./lib/ti/despacho");
const { criarBootstrapAdmin } = require("./lib/bootstrap-admin");
const { criarAuthProxy } = require("./lib/auth-proxy");

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
const categorias = criarCategorias({ db, FieldValue });
const habilitacao = criarHabilitacao({ db, treinamento, categorias });
const taxas = criarTaxas({ db, FieldValue, S });          // taxas/regras de turno dinâmicas (configuracoes/taxas)
const mapa = criarMapa({ db, Timestamp });                   // promotores online (promotores_online)
const operacao = criarOperacao({ db, FieldValue });             // raio de atendimento + Master Switch (configuracoes/operacao), tempo real
const root = criarRoot({ db, admin, FieldValue, Timestamp, auth }); // Admin Root: flag is_root + auditoria encadeada (root_auditoria)
const suporte = criarSuporte({ db, admin, FieldValue });
const ti = criarTI({ db, admin, FieldValue, Timestamp, V, auth, saudeDeps: { G, mpToken: MP_ACCESS_TOKEN, baseUrl: APP_URL || `http://127.0.0.1:${PORT}`, segredoWebhook: !!MP_WEBHOOK_SECRET, geoUrl: /^https:\/\//.test(process.env.GEO_HEALTH_URL || "") ? process.env.GEO_HEALTH_URL : "" } });   // módulo de TI (operadores, auditoria, chamados, métricas, presença)
const despacho = criarDespacho({ suporte, chamados: ti.chamados, appUrl: () => APP_URL });   // avisa a equipe do departamento (push + webhook de chat) quando o roteador abre um chamado
const tickets = criarTickets({ db, FieldValue, Timestamp, V, suporte, chamados: ti.chamados, habilitacao, K: ti.K });   // protocolo SP-… e escalamento do chat para a fila de TI/gestão
const reputacao = criarReputacao({ db, admin, FieldValue, Timestamp, auth, carteira, taxas });   // níveis, vidas, multas e banimento
const ctx = {
  db, admin, express, FieldValue, Timestamp, S, C, V, G, Cripto, Falha, auth, perfisDasClaims: Seg.perfisDasClaims, PERFIS: Seg.PERFIS, limitar, carteira, treinamento, categorias, habilitacao, taxas, operacao, mapa, root, suporte, tickets, mp, ti, despacho, reputacao,
  envelope: Seg.envelope, MODO_TESTE, MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, CRON_SECRET, APP_URL, getBaseUrl, urlPublicaHttps,
  __reset: () => { limitador._baldes.clear(); ti.limparCaches(); mapa.limparCache(); },   // uso exclusivo dos testes
  hojeSP: V.hojeSP, reais: (c) => Number((c / 100).toFixed(2)),
  visaoLoja: (sp) => ({ valor: sp.valor, taxaFixa: sp.taxaFixa, total: sp.total, ...(sp.bonus ? { bonus: sp.bonus } : {}) })
};

// ---------- Pipeline HTTP ----------
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
const permitidas = Seg.origensPermitidas(APP_URL, process.env.ORIGENS_PERMITIDAS);
app.use(criarAuthProxy({ projectId: process.env.FIREBASE_PROJECT_ID || "abastece-ja-240d5" }));   // /__/auth/* → Firebase (login Google por redirecionamento no mesmo domínio)
app.use(Seg.cabecalhos());
app.use(cors(Seg.opcoesCors(permitidas)));
const jsonPadrao = express.json({ limit: C.BODY_LIMITE });
app.use((req, res, next) => (req.path === "/checkout" ? next() : jsonPadrao(req, res, next)));   // /checkout tem parser próprio (foto da gôndola)
app.use(Seg.protecaoCsrf(permitidas, { isentas: ["/webhookMP"] }));
app.use(limitar({ janelaMs: 60_000, max: 240, nome: "global" }));
app.use(/^\/(saude|cadastro|perfil|habilitacao|habilitacoes|sessao|treinamento|criar|aceitar|cancelar|desistir|avaliar|cartao|confirmar|webhook|carteira|loja|admin|interno|aviso|teste|suporte|push|config\/taxas|config\/operacao|root\/|ti\/|chamados|presenca|nota\/|turnos|checkin|checkout|reportar|auditar|execucao|reputacao|promotor\/|marcas|b2b)/, Seg.semCache);

app.get("/saude", (req, res) => res.json({ ok: true }));

for (const rota of ["conta", "treinamento", "categorias", "pedidos", "pagamentos", "nota", "carteira", "taxas", "root", "mapa", "admin", "suporte", "ti", "execucao", "ruptura", "reputacao", "b2b", "teste"]) require(`./rotas/${rota}`)(app, ctx);


// ---------- Site estático (somente extensões permitidas; nada de código do servidor, regras ou segredos) ----------
const RAIZ = path.join(__dirname, "..");
const BLOQUEADOS = /^\/(server|functions|test|scripts|node_modules|docs)(\/|$)|(^|\/)\./i;
// Rotas limpas dos painéis: a URL pública é /painel-loja e /painel-promotor (as páginas continuam sendo index.html e promotor.html).
// Sem barra final (/painel-loja/ redireciona): os scripts e estilos usam caminhos relativos e quebrariam dentro de uma "pasta".
const PAINEIS = { "painel-loja": "index.html", "painel-promotor": "promotor.html", "painel-admin": "admin.html", "painel-ti": "ti.html" };
app.get(/^\/(painel-loja|painel-promotor|painel-admin|painel-ti)\/?$/, (req, res) => {
  const nome = req.path.replace(/\//g, "");
  if (req.path.endsWith("/")) return res.redirect(302, `/${nome}${req.url.slice(req.path.length)}`);
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(RAIZ, PAINEIS[nome]));
});
app.use((req, res, next) => {
  const p = decodeURIComponent(req.path);
  if (BLOQUEADOS.test(p) || !/^\/([\w.-]+\/)*[\w.-]*$/.test(p)) return res.status(404).send("Not Found");
  if (p !== "/" && !/\.(html|css|js|png|svg|ico|webp|woff2)$/i.test(p) && p !== "/manifest.json") return res.status(404).send("Not Found");
  next();
});
app.use(express.static(RAIZ, { dotfiles: "ignore", index: ["index.html"], maxAge: 0, setHeaders: (res, f) => { if (f.endsWith("sw.js")) res.setHeader("Cache-Control", "no-cache"); } }));
app.use((req, res) => res.status(404).json({ erro: "não encontrado", codigo: "rota-inexistente" }));
app.use(Seg.tratadorErros);

if (require.main === module) {
  criarBootstrapAdmin({ admin, db, FieldValue, auth }).rodar();   // ADMIN_BOOTSTRAP_EMAIL: concede o papel de admin à conta Google informada (sem terminal)
  ti.bootstrapGestor();                                     // 1º gestor de TI via variáveis de ambiente (só se ainda não houver operadores)
  ti.presenca.iniciar();                                    // publica os pings desta instância (contador de usuários online)
  ti.saude.iniciar();                                       // healthcheck em segundo plano (Firebase, Mercado Pago, Webhooks, Geolocalização)
  operacao.iniciar();                                       // raio + Master Switch em tempo real
  root.bootstrap();                                         // ROOT_BOOTSTRAP_EMAIL: concede is_root a um admin existente (sem terminal)
  taxas.iniciar();                                          // listener em tempo real: a mudança do admin vale em milissegundos
  app.listen(PORT, "0.0.0.0", () => console.log(`Servidor rodando na porta ${PORT}${MODO_TESTE ? " — MODO_TESTE ligado" : ""}`));
}
module.exports = { app, ctx };
