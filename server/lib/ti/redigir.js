// LGPD no servidor: remove dados pessoais e segredos de texto técnico ANTES de gravar em chamado.
// O navegador já faz o mesmo (erros-nucleo.js → redigir), mas o servidor não pode confiar no cliente: aqui é a barreira que vale.
function redigir(texto) {
  return String(texto ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, "Bearer [removido]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[jwt removido]")
    .replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, "[e-mail removido]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf removido]")
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[cnpj removido]")
    .replace(/\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, "[telefone removido]")
    .replace(/([?&](?:token|key|apikey|api_key|access_token|auth|senha|password|code)=)[^&\s)]+/gi, "$1[removido]");
}
module.exports = { redigir };
