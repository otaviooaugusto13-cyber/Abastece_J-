// Classificação AUTOMÁTICA de criticidade de um AUTO-BUG. Função pura (sem banco, sem relógio): fácil de testar e de ajustar.
// Saídas possíveis: "critica" | "media" | "baixa". ("alta" continua existindo no sistema, mas é decisão humana/urgência sugerida pelo usuário.)
//
// Critérios, em ordem de precedência (o primeiro que casar decide):
//   1. ALCANCE   — o mesmo erro atinge vários usuários ao mesmo tempo → crítica (é incidente, não um caso isolado).
//   2. DINHEIRO  — falha de código no fluxo financeiro (cobrança, checkout, carteira, saque, estorno, webhook) → crítica.
//   3. RUÍDO ÚTIL — falhas tratadas pelo app, páginas públicas, deploy velho (módulo não carregou) e limites do navegador → baixa.
//   4. Demais exceções não tratadas e erros 500 da API → média.
// LIMITE HONESTO: a rota e a origem vêm do navegador. Alguém mal-intencionado pode forjá-las para subir a prioridade de um chamado
// DELE; o dano é limitado (1 chamado por erro/usuário/hora, 30/h por usuário). O critério de ALCANCE usa contagem do servidor e não é forjável.
const LIMITE_AFETADOS = 5;       // usuários distintos, mesmo erro, na janela (1 h)
const LIMITE_OCORRENCIAS = 20;   // repetições do mesmo erro, na janela
const FINANCEIRO = /(^|[\/\s_-])(pagar|pagamento|pagamentos|checkout|criarcobranca|confirmarpagamento|webhookmp|carteira|saque|saques|estorno|cartao|cobranca)(?=$|[\/.\s_:-])/i;
const MODULO_NAO_CARREGOU = /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed|Failed to load module script/i;
const LIMITE_NAVEGADOR = /QuotaExceededError|NotAllowedError|SecurityError.*(storage|localStorage)/i;

function classificarBug({ nome = "", mensagem = "", origem = "", rota = "", perfil = "", afetados = 1, ocorrencias = 1 } = {}) {
  const motivos = [];
  if (afetados >= LIMITE_AFETADOS) return { prioridade: "critica", motivos: [`Atinge ${afetados} usuários ao mesmo tempo`] };
  if (ocorrencias >= LIMITE_OCORRENCIAS) return { prioridade: "critica", motivos: [`Repetiu ${ocorrencias} vezes na última hora`] };
  const alvo = `${rota} ${String(mensagem).slice(0, 120)}`;
  if (origem !== "manual" && FINANCEIRO.test(alvo)) return { prioridade: "critica", motivos: ["Falha de código no fluxo financeiro (pagamento/carteira)"] };
  if (origem === "manual") motivos.push("Falha já tratada pelo app (reportada manualmente)");
  if (perfil === "publico") motivos.push("Página pública, sem login");
  if (MODULO_NAO_CARREGOU.test(`${nome} ${mensagem}`)) motivos.push("Arquivo do app não carregou (provável versão antiga em cache)");
  if (LIMITE_NAVEGADOR.test(`${nome} ${mensagem}`)) motivos.push("Limite/permissão do navegador do usuário");
  if (motivos.length) return { prioridade: "baixa", motivos };
  return { prioridade: "media", motivos: [origem === "api" ? "Erro 500 da API" : "Exceção não tratada no app"] };
}
module.exports = { classificarBug, LIMITE_AFETADOS, LIMITE_OCORRENCIAS };
