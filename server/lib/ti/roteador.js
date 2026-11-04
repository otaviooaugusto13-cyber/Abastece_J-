// Roteador inteligente de chamados automáticos: decide, a partir do erro capturado, QUAL equipe recebe o chamado.
//   TI        exceções de código, falhas de API, banco de dados, rede e infraestrutura
//   ADM       pagamento, comissão/repasse/saque, inconsistência de valores e permissões gerenciais (Administrativo / Financeiro)
//   Suporte   questões operacionais (check-in, cadastro, treinamento, turno…) e dúvidas dos usuários (lojistas/promotores)
//
// PURO (sem banco, sem rede, sem relógio): mesma entrada → mesma saída; por isso é testável de ponta a ponta e roda no servidor,
// onde o cliente não consegue forjar o departamento. É uma tabela de regras explicável, não um modelo opaco: toda decisão
// devolve o `motivo` e os `sinais` que a causaram, e fica gravada no chamado (auditável e fácil de ajustar).
//
// Ordem de decisão (a primeira que decidir vence):
//   1. CÓDIGO de erro do servidor ("saldo-insuficiente", "checkin-expirado"…): é o vocabulário que o próprio sistema definiu → alta confiança.
//   2. EXCEÇÃO NATIVA de JavaScript (TypeError, ReferenceError…): defeito de código, sempre TI — mesmo que a mensagem cite "valor" ou "pagamento".
//   3. PONTUAÇÃO por sinais no texto/rota/status; vence quem somar mais; empate resolve por TI > ADM > Suporte.
//   4. SEM SINAL NENHUM: erro capturado → TI (triagem técnica); dúvida de usuário → Suporte. Sempre com confiança "baixa".
// Nomes de arquivo na stack NUNCA votam em ADM/Suporte (`pagar.js` quebrando é bug de código, não problema financeiro).
const K = require("./constantes");

const VERSAO_REGRAS = 1;
const sem = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const corta = (v, n) => String(v ?? "").slice(0, n);

// ---------- 1) códigos de erro conhecidos (server/lib/*.js lança Falha com estes códigos) ----------
// [regex do código, departamento, prioridade, categoria, motivo]
const POR_CODIGO = [
  // Financeiro / gerencial
  [/^(pagamento|ja-pago|estorno|saque|saldo|sem-pix|cartao|comissao|repasse|carteira|conciliacao|multa)/, "adm", "alta", "pagamento", "código de pagamento/financeiro"],
  [/^(valor-divergente|nota-inconsistente)/, "adm", "alta", "pagamento", "inconsistência de valores"],
  [/^taxas-(invalidas|desatualizadas)/, "adm", "media", "pagamento", "configuração de taxas (gerencial)"],
  [/^(mfa-obrigatorio|ultimo-admin|ultimo-gestor)/, "adm", "alta", "acesso", "permissão gerencial"],
  // Técnico
  [/^(interno|mp-rede|mp-nao-configurado|config$|taxas-indisponiveis|stream-|rota-inexistente|json-invalido|tempo$|rede$|unavailable|deadline|firestore)/, "ti", "alta", "infra", "código de falha técnica/infraestrutura"],
  // Operacional (o usuário precisa de orientação, não de conserto)
  [/^(checkin|sem-checkin|checkout|cedo-demais|execucao|permanencia|gps|geo|localizacao|loja-sem|turno|conflito-horario|limite-semanal|fora-do-dia|servico)/, "suporte", "media", "app", "código de operação em campo (check-in/turno/local)"],
  [/^(cadastro|treinamento|categoria|termos|idade|nascimento|cpf|documento|responsavel|menor|timer|assista|quiz|ja-habilitado|ja-avaliado|sem-avaliacao|ja-registrado|nao-aceito|exclusivo)/, "suporte", "baixa", "acesso", "código de cadastro/habilitação"],
  [/^(foto|sem-prova|conta-banida|promotor-inativo|dado-travado|papel-conflito|conta-ti|email-em-uso|aguarde)/, "suporte", "baixa", "outro", "código de conta/operação do usuário"]
];

// ---------- 2) exceções nativas do JavaScript ----------
const EXCECAO_NATIVA = /^(TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|AggregateError)$/;
const MENSAGEM_DE_EXCECAO = /is not a function|is not defined|is not iterable|cannot (read|set) propert(y|ies)|undefined is not|null is not|unexpected (token|end of)|maximum call stack|is not a constructor|cannot destructure/i;

// ---------- 3) pontuação ----------
// onde: "msg" (mensagem), "codigo", "rota", "stack", "ctx" (tela/perfil/origem).  Texto já sem acento e em minúsculas.
const SINAIS = [
  // ---- TI ----
  { id: "banco-de-dados", dep: "ti", peso: 7, onde: ["msg", "codigo", "stack"], re: /firestore|firebase|grpc|failed_precondition|requires an index|deadline_exceeded|resource_exhausted|permission_denied|transaction failed|\bquota\b/, prio: "alta", cat: "dados", motivo: "falha de banco de dados" },
  { id: "rede-infra", dep: "ti", peso: 7, onde: ["msg", "codigo"], re: /econn\w*|etimedout|enotfound|eai_again|socket hang up|network ?error|timeout|time-out|tempo esgotado|gateway|service unavailable|\bcors\b|\bdns\b/, prio: "alta", cat: "infra", motivo: "falha de rede/infraestrutura" },
  { id: "front-recurso", dep: "ti", peso: 6, onde: ["msg", "stack"], re: /chunkloaderror|loading chunk|importing a module script failed|failed to fetch dynamically imported|service ?worker|indexeddb|json\.parse|unexpected token|is not valid json/, prio: "media", cat: "bug", motivo: "falha de carregamento/execução no navegador" },
  { id: "api-5xx", dep: "ti", peso: 5, onde: ["status"], re: /^5\d\d$/, prio: "alta", cat: "infra", motivo: "a API respondeu erro 5xx" },
  { id: "erro-interno", dep: "ti", peso: 4, onde: ["msg", "codigo"], re: /erro interno|internal (server )?error|\binterno\b|nao foi possivel falar com/, prio: "alta", cat: "infra", motivo: "erro interno do servidor" },
  { id: "credencial-integracao", dep: "ti", peso: 8, onde: ["msg"], re: /credencial|nao configurado|token (invalido|expirado)|api ?key/, prio: "alta", cat: "infra", motivo: "integração sem credencial/configuração" },
  { id: "stack-de-codigo", dep: "ti", peso: 2, onde: ["stack"], re: /\bat .+\(.+:\d+:\d+\)|@.+:\d+:\d+|\.js:\d+/, prio: "media", cat: "bug", motivo: "stack trace de código" },
  { id: "exception-generica", dep: "ti", peso: 2, onde: ["nome"], re: /error$|exception$|apierror/, prio: "media", cat: "bug", motivo: "exceção não tratada" },

  // ---- ADM / Financeiro (só texto de mensagem/rota/código; nunca nome de arquivo) ----
  { id: "valor-inconsistente", dep: "adm", peso: 8, onde: ["msg", "codigo"], re: /(valor|valores|total|saldo|taxa|montante)\W+(\w+\W+){0,3}(divergente|inconsistente|incorret\w*|errad\w*|diferente|nao confere|nao bate)|diverg[eê]ncia|inconsist[eê]ncia|nao fecha|soma nao|nao bate/, prio: "alta", cat: "pagamento", motivo: "inconsistência de valores" },
  { id: "recusa-de-pagamento", dep: "adm", peso: 9, onde: ["msg"], re: /recusou a operacao|transacao recusada|pagamento (foi )?recusado|cartao (foi )?recusado|operadora recusou/, prio: "alta", cat: "pagamento", motivo: "pagamento recusado pelo provedor" },
  { id: "pagamento", dep: "adm", peso: 6, onde: ["msg", "codigo"], re: /pagament|\bpix\b|cobranca|cartao|boleto|estorno|reembolso|chargeback|mercado ?pago|\bmp\b|\bpago\b|recusou a operacao|transacao recusada|saldo insuficiente/, prio: "alta", cat: "pagamento", motivo: "erro de pagamento" },
  { id: "comissao-repasse", dep: "adm", peso: 7, onde: ["msg", "codigo"], re: /comiss|repasse|saque|carteira|extrato|conciliac|fatura|lancamento|multa|bonus|split/, prio: "alta", cat: "pagamento", motivo: "falha de comissão/repasse/saque" },
  { id: "permissao-gerencial", dep: "adm", peso: 7, onde: ["msg", "codigo"], re: /(sem permissao|permission|forbidden|acesso negado|nao autorizad\w*|nao tem permissao|papel|privileg\w*).{0,60}(admin|gestor|gerencia\w*|financeir\w*|aprova\w*|painel)|(admin|gestor|gerencia\w*|financeir\w*).{0,60}(sem permissao|forbidden|acesso negado|nao autorizad\w*)/, prio: "alta", cat: "acesso", motivo: "permissão gerencial" },
  { id: "rota-financeira", dep: "adm", peso: 3, onde: ["rota"], re: /pagamentos?|carteira|saques?|financeiro|conciliacao|taxas|estorno|webhook|confirmar|cartao|exportar/, prio: "media", cat: "pagamento", motivo: "rota do módulo financeiro" },
  { id: "rota-admin-negada", dep: "adm", peso: 5, onde: ["rota"], re: /(^|\s)(get|post|put|patch|delete)?\s*\/?admin\//, requer: (e) => e.status === 401 || e.status === 403, prio: "alta", cat: "acesso", motivo: "acesso negado em rota administrativa" },

  // ---- Suporte (operação + dúvidas) ----
  { id: "operacao-campo", dep: "suporte", peso: 6, onde: ["msg", "codigo"], re: /check-?in|check-?out|turno|escala|raio|geofence|gps|localizac\w*|loja fechada|ausencia|falta da loja|expediente/, prio: "media", cat: "app", motivo: "operação em campo (check-in/turno/local)" },
  { id: "cadastro-habilitacao", dep: "suporte", peso: 6, onde: ["msg", "codigo"], re: /cadastr\w*|habilita\w*|treinamento|quiz|documento|\bcpf\b|nascimento|foto (invalida|repetida|grande)|responsavel legal|termos|aprova[cç]ao do cadastro/, prio: "baixa", cat: "acesso", motivo: "cadastro/habilitação" },
  { id: "duvida-usuario", dep: "suporte", peso: 7, onde: ["msg", "ctx"], re: /\bduvida\b|como (eu )?(faco|fazer|funciona)|nao consigo|nao entendi|preciso de ajuda|ajuda com|orienta\w*|\bajuda\b/, prio: "baixa", cat: "outro", motivo: "dúvida/pedido de orientação do usuário" },
  { id: "pedido-operacional", dep: "suporte", peso: 4, onde: ["msg"], re: /pedido|aceit\w+|cancelamento|avalia\w+|promotor|lojista|ruptura|gondola/, prio: "baixa", cat: "app", motivo: "fluxo de pedido/operação" },
  { id: "validacao-4xx", dep: "suporte", peso: 2, onde: ["status"], re: /^4(00|04|09|22)$/, prio: "baixa", cat: "app", motivo: "recusa de regra (4xx) — orientação ao usuário" }
];
const ORDEM_EMPATE = ["ti", "adm", "suporte"];

// ---------- entrada ----------
/** Aceita o que o cliente mandou (campos soltos) e devolve texto limpo e limitado. Nunca lança. */
function preparar(bruto) {
  const b = bruto && typeof bruto === "object" ? bruto : {};
  let mensagem = corta(b.mensagem, 600), codigo = corta(b.codigo, 60).trim().toLowerCase(), status = Number(b.status) || 0;
  let rota = corta(b.rota, 140).trim();
  // o cliente acrescenta " [code=x] [status=n]" à mensagem: devolve para os campos próprios
  mensagem = mensagem.replace(/\s*\[code=([^\]]*)\]/gi, (_, c) => { if (!codigo) codigo = String(c).trim().toLowerCase(); return ""; })
    .replace(/\s*\[status=(\d+)\]/gi, (_, s) => { if (!status) status = Number(s); return ""; });
  // "POST pagamentos/confirmar: erro interno" → rota + mensagem (a rota não pode contar duas vezes no texto)
  const m = /^(GET|POST|PUT|PATCH|DELETE)\s+(\S+?):\s*/i.exec(mensagem);
  if (m) { if (!rota) rota = `${m[1].toUpperCase()} ${m[2]}`; mensagem = mensagem.slice(m[0].length); }
  else if (rota && mensagem.startsWith(`${rota}:`)) mensagem = mensagem.slice(rota.length + 1).trim();
  return { nome: corta(b.nome, 80), mensagem: mensagem.trim(), codigo, status, rota, origem: corta(b.origem, 40), stack: corta(b.stack, 4000), arquivo: corta(b.arquivo, 200),
    perfil: corta(b.perfil, 20), tela: corta(b.tela, 60), tipo: b.tipo === "duvida" ? "duvida" : "erro" };
}

/**
 * Recupera os campos do erro a partir do texto do relatório, para clientes antigos (e filas locais) que só enviam `descricao`.
 * Formato do relatório (erros-nucleo.js): "Erro: Nome: mensagem\nOrigem: …\n…\n\nStack:\n…"
 */
function extrairDaDescricao(descricao) {
  const texto = String(descricao || ""), linhas = texto.split("\n");
  const alvo = (linhas.find((l) => l.startsWith("Erro: ")) || linhas[0] || "").replace(/^Erro:\s*/, "");
  const p = /^([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*)$/.exec(alvo);
  const origem = /^Origem:\s*(.+)$/m.exec(texto)?.[1] || "", tela = /^Tela:\s*(.+)$/m.exec(texto)?.[1] || "", perfil = /^Perfil:\s*(.+)$/m.exec(texto)?.[1] || "";
  const i = texto.indexOf("\nStack:\n");
  return { nome: p ? p[1] : "", mensagem: p ? p[2] : alvo, origem, tela, perfil, stack: i >= 0 ? texto.slice(i + 8) : "" };
}

const campo = (e, onde) => (onde === "msg" ? sem(e.mensagem) : onde === "nome" ? sem(e.nome) : onde === "stack" ? sem(`${e.stack}\n${e.arquivo}`) : onde === "rota" ? sem(e.rota) : onde === "codigo" ? sem(e.codigo)
  : onde === "status" ? String(e.status || "") : onde === "ctx" ? sem(`${e.origem} ${e.tela} ${e.perfil}`) : "");

const maiorPrioridade = (a, b) => ((K.PESO_PRIORIDADE[a] || 0) >= (K.PESO_PRIORIDADE[b] || 0) ? a : b);
const PRIO_PADRAO = { ti: "media", adm: "media", suporte: "baixa" };
const CAT_PADRAO = { ti: "bug", adm: "pagamento", suporte: "outro" };

/**
 * Classifica um erro capturado.
 *   entrada: { nome, mensagem, stack, rota, status, codigo, origem, arquivo, perfil, tela, tipo? }   (tipo: "erro" | "duvida")
 * Devolve { departamento, categoria, prioridade, confianca: "alta"|"media"|"baixa", motivo, sinais: [ids], pontos: {ti, adm, suporte}, versao }.
 * Nunca lança e nunca devolve "crítica": urgência máxima é decisão humana (ver constantes.js).
 */
function classificarErro(bruto) {
  let e;
  try { e = preparar(bruto); } catch { e = preparar({}); }
  const pronto = (departamento, extra) => ({ departamento, categoria: CAT_PADRAO[departamento], prioridade: PRIO_PADRAO[departamento], confianca: "baixa", motivo: "", sinais: [], pontos: { ti: 0, adm: 0, suporte: 0 }, versao: VERSAO_REGRAS, ...extra });

  // 1) código explícito do servidor
  if (e.codigo) {
    const r = POR_CODIGO.find(([re]) => re.test(e.codigo));
    if (r) return pronto(r[1], { prioridade: r[2], categoria: r[3], confianca: "alta", motivo: `${r[4]} (${e.codigo})`, sinais: [`codigo:${e.codigo}`] });
  }
  // 2) exceção nativa = defeito de código
  const nativa = EXCECAO_NATIVA.test(e.nome) || (/^(error|erro|)$/i.test(e.nome) && MENSAGEM_DE_EXCECAO.test(e.mensagem));
  if (nativa) return pronto("ti", { categoria: "bug", prioridade: "media", confianca: "alta", motivo: `exceção de código (${e.nome || "Error"})`, sinais: ["excecao-nativa"] });

  // 3) pontuação
  const pontos = { ti: 0, adm: 0, suporte: 0 }, acertos = { ti: [], adm: [], suporte: [] };
  for (const s of SINAIS) {
    if (s.requer && !s.requer(e)) continue;
    if (s.onde.some((o) => { const txt = campo(e, o); return txt && s.re.test(txt); })) { pontos[s.dep] += s.peso; acertos[s.dep].push(s); }
  }
  if (e.tipo === "duvida") pontos.suporte += 5;                                    // quem pede ajuda (e não reporta falha) é atendimento
  const ranking = ORDEM_EMPATE.map((d) => [d, pontos[d]]).sort((a, b) => b[1] - a[1] || ORDEM_EMPATE.indexOf(a[0]) - ORDEM_EMPATE.indexOf(b[0]));
  const [dep, melhor] = ranking[0], segundo = ranking[1][1];

  // 4) sem nenhum sinal: erro capturado → TI (triagem técnica); dúvida → Suporte
  if (melhor <= 0) {
    const dpt = e.tipo === "duvida" ? "suporte" : "ti";
    return pronto(dpt, { confianca: "baixa", motivo: dpt === "ti" ? "erro sem sinais claros — enviado ao TI para triagem" : "pedido de ajuda sem erro técnico", sinais: ["sem-sinais"], pontos });
  }
  const vencedores = acertos[dep].sort((a, b) => b.peso - a.peso);
  const margem = melhor - segundo;
  if (!vencedores.length) return pronto(dep, { confianca: margem >= 5 ? "alta" : "media", motivo: "pedido de ajuda do usuário (sem erro técnico)", sinais: ["tipo:duvida"], pontos });   // só o bônus de "dúvida" decidiu
  return pronto(dep, {
    categoria: vencedores[0].cat || CAT_PADRAO[dep], prioridade: vencedores.reduce((p, s) => maiorPrioridade(p, s.prio || PRIO_PADRAO[dep]), PRIO_PADRAO[dep]),
    confianca: margem >= 5 ? "alta" : margem >= 2 ? "media" : "baixa", motivo: vencedores[0].motivo, sinais: vencedores.map((s) => s.id), pontos
  });
}

// ---------- mensagem para o usuário ----------
const horas = (min) => (min < 60 ? `${min} minutos` : min === 60 ? "1 hora" : `${Math.round(min / 60)} horas`);
const PRAZO_TEXTO = (prioridade) => `Previsão do primeiro retorno: em até ${horas(K.SLA_MIN[prioridade]?.atend || K.SLA_MIN.media.atend)}.`;
const SETOR_TEXTO = {
  ti: { titulo: "Chamado aberto para o TI", corpo: (p) => `Detectamos uma falha técnica e abrimos o chamado ${p} para o setor de TI, que vai analisar e corrigir o problema. Você não precisa fazer nada.` },
  adm: { titulo: "Chamado aberto para o Administrativo/Financeiro", corpo: (p) => `Identificamos uma questão de pagamento, de valores ou de permissão. O chamado ${p} foi aberto para o setor Administrativo/Financeiro, que vai conferir o seu caso. Guarde o número do protocolo.` },
  suporte: { titulo: "Chamado aberto para o Suporte", corpo: (p) => `Registramos o seu caso no chamado ${p}, que já está com o time de Suporte. Eles vão orientar você pelo chat ou pelo WhatsApp.` }
};
/** Texto que a pessoa vê na tela quando o chamado é aberto. `repetido`: o mesmo erro já tinha chamado aberto (mesmo protocolo). */
function mensagemParaUsuario({ departamento, protocolo, prioridade = "media", repetido = false }) {
  const t = SETOR_TEXTO[departamento] || SETOR_TEXTO.ti;
  return { titulo: t.titulo, setor: K.DEPARTAMENTO_NOME[departamento] || K.DEPARTAMENTO_NOME.ti,
    texto: `${repetido ? `Esse problema já estava registrado: seguimos com o chamado ${protocolo}. ` : ""}${repetido ? "" : t.corpo(protocolo)} ${PRAZO_TEXTO(prioridade)}`.replace(/\s+/g, " ").trim() };
}

module.exports = { classificarErro, extrairDaDescricao, mensagemParaUsuario, preparar, VERSAO_REGRAS };
