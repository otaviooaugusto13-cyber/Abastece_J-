// Contexto técnico de um AUTO-BUG: tudo o que o navegador mandou é tratado como NÃO CONFIÁVEL.
// Cada campo é reduzido a texto curto, passa por redação (LGPD) e só então é gravado em `chamados_ti.bug`.
// O usuário (uid/tipo) NUNCA vem do corpo: é o do token verificado — o cliente não consegue acusar outra pessoa.
const { redigir, cortar } = require("./redacao");

const txt = (v, n) => (typeof v === "string" ? cortar(redigir(v).replace(/[\u0000-\u001f\u007f]+/g, " ").trim(), n) : "");
/** Texto de várias linhas (stack trace): mantém \n, troca os demais caracteres de controle e limita o tamanho. */
const txtLinhas = (v, n) => (typeof v === "string" ? cortar(redigir(v).replace(/\r/g, "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").replace(/[ \t]{2,}/g, " ").trim(), n) : "");
const ORIGENS = ["window.onerror", "unhandledrejection", "api", "manual"];
const PERFIS = ["loja", "promotor", "admin", "publico"];

/** Só o caminho (sem host, query ou hash): parâmetros de URL podem carregar token ou dado pessoal. */
function rotaSegura(v) {
  if (typeof v !== "string") return "";
  let p = v.trim(); try { p = new URL(p, "http://x").pathname; } catch { p = p.split(/[?#]/)[0]; }
  return txt(p, 120);
}

/** Tipo, sistema operacional e navegador a partir do user-agent (heurística simples; não é fingerprint). */
function dispositivoDe(ua) {
  ua = typeof ua === "string" ? ua.slice(0, 400) : "";
  const tipo = /iPad|Tablet|Android(?!.*Mobile)/i.test(ua) ? "tablet" : /Mobi|iPhone|Android/i.test(ua) ? "celular" : ua ? "computador" : "desconhecido";
  const so = /Windows NT/i.test(ua) ? "Windows" : /Android\s([\d.]+)/i.test(ua) ? `Android ${/Android\s([\d.]+)/i.exec(ua)[1]}` : /iPhone OS ([\d_]+)|iPad.*OS ([\d_]+)/i.test(ua) ? `iOS ${(/OS ([\d_]+)/i.exec(ua)?.[1] || "").replace(/_/g, ".")}`.trim() : /Mac OS X/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "desconhecido";
  const nav = /Edg\/([\d]+)/.exec(ua) ? `Edge ${/Edg\/(\d+)/.exec(ua)[1]}` : /OPR\/(\d+)/.exec(ua) ? `Opera ${/OPR\/(\d+)/.exec(ua)[1]}` : /(?:Chrome|CriOS)\/(\d+)/.exec(ua) ? `Chrome ${/(?:Chrome|CriOS)\/(\d+)/.exec(ua)[1]}` : /(?:Firefox|FxiOS)\/(\d+)/.exec(ua) ? `Firefox ${/(?:Firefox|FxiOS)\/(\d+)/.exec(ua)[1]}` : /Version\/(\d+).*Safari/.exec(ua) ? `Safari ${/Version\/(\d+)/.exec(ua)[1]}` : "desconhecido";
  return { tipo, so, navegador: nav };
}

/**
 * Normaliza o `contexto` enviado pelo app. Nunca lança: contexto malformado vira campos vazios — o erro JÁ aconteceu,
 * e recusar o relatório (400) por causa de um campo ruim faria o TI perder justamente o chamado.
 */
function sanitizarContexto(c, { uid, tipo, impressao, stack }) {
  const o = c && typeof c === "object" && !Array.isArray(c) ? c : {};
  const n = (v, max) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(Number(v), max)) : null);
  return {
    impressao,
    nome: txt(o.nome, 60),
    mensagem: txt(o.mensagem, 300),
    rota: rotaSegura(o.rota),
    versao: txt(o.versao, 40),
    origem: ORIGENS.includes(o.origem) ? o.origem : "",
    perfil: PERFIS.includes(o.perfil) ? o.perfil : "",
    tela: txt(o.tela, 60),
    dispositivo: dispositivoDe(o.navegador),
    navegador: txt(o.navegador, 160),
    viewport: /^\d{2,5}x\d{2,5}$/.test(String(o.viewport || "")) ? String(o.viewport) : "",
    online: typeof o.online === "boolean" ? o.online : null,
    fuso: txt(o.fuso, 40),
    arquivo: o.arquivo ? `${rotaSegura(o.arquivo)}${n(o.linha, 1e6) ? `:${n(o.linha, 1e6)}` : ""}` : "",
    stack: txtLinhas(o.stack || stack, 1500),
    usuario: { uid, tipo }   // sempre do token verificado
  };
}
module.exports = { sanitizarContexto, dispositivoDe, rotaSegura };
