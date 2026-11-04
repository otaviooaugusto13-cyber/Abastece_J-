// Redação de dados pessoais e segredos em texto técnico (LGPD). Espelha redigir() de erros-nucleo.js:
// o navegador já redige, mas o SERVIDOR não confia nisso (um cliente adulterado poderia mandar CPF, token ou e-mail no relatório).
const REGRAS = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, "Bearer [removido]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[jwt removido]"],
  [/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, "[e-mail removido]"],
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf removido]"],
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[cnpj removido]"],
  [/\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, "[telefone removido]"],
  [/([?&](?:token|key|apikey|api_key|access_token|auth|senha|password|code)=)[^&\s)]+/gi, "$1[removido]"]
];
const redigir = (texto) => REGRAS.reduce((t, [re, sub]) => t.replace(re, sub), String(texto ?? ""));
const cortar = (s, n) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);
module.exports = { redigir, cortar };
