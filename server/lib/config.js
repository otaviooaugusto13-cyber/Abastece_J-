// Constantes de compliance e operação. Valores financeiros ficam em ../split.js.
const PRODUCAO = process.env.AMBIENTE === "producao" || process.env.NODE_ENV === "production";
const inteiro = (v, padrao) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : padrao; };

module.exports = {
  PRODUCAO,

  // ---- Setores de reposição (espelho de SETORES em ../../core.js; test/split.test.js confere) ----
  SETORES: ["Mercearia", "Hortifruti / FLV", "Frios & Laticínios", "Padaria", "Depósito", "Degustação", "Bebidas", "Auditoria / Inventário", "Montagem de ilhas"],

  // ---- Habilitação por categoria (vídeo + questionário 100%) ----
  // Cada SETOR de pedido exige a habilitação da sua categoria. Espelho em ../../core.js (CATEGORIAS / SETOR_CATEGORIA); test/split.test.js confere.
  CATEGORIAS: {
    mercearia:  { titulo: "Mercearia",   ico: "🛒" },
    frios:      { titulo: "Frios",       ico: "🧀" },
    padaria:    { titulo: "Padaria",     ico: "🥖" },
    flv:        { titulo: "FLV",         ico: "🍎" },
    deposito:   { titulo: "Depósito",    ico: "📦" },
    degustacao: { titulo: "Degustação",  ico: "🍽️" }
  },
  SETOR_CATEGORIA: {
    "Mercearia": "mercearia", "Hortifruti / FLV": "flv", "Frios & Laticínios": "frios", "Padaria": "padaria", "Depósito": "deposito", "Degustação": "degustacao",
    // setores antigos, sem categoria própria: DECISÃO DE NEGÓCIO (ver resposta). Trocar aqui se preferir outro enquadramento.
    "Bebidas": "mercearia", "Montagem de ilhas": "mercearia", "Auditoria / Inventário": "deposito"
  },
  HAB_MARGEM_SEG: 3,            // timer = duração do vídeo + 3 s
  HAB_FOLGA_SEG: 10,            // distância máxima entre a posição do vídeo e o trecho já validado para continuar creditando
  HAB_PING_EVENTO_MIN_MS: 1000, // pings de play/pause (âncora) podem vir mais rápido que os periódicos
  HAB_TOLERANCIA_FIM_SEG: 4,    // quanto falta para "chegou ao fim" (jitter dos pings)
  HAB_QUIZ_VALIDADE_MS: 20 * 60_000,   // depois de liberado, o questionário vale 20 min; vencido = refazer o treinamento
  HAB_PERGUNTAS_MIN: 3, HAB_PERGUNTAS_MAX: 4, HAB_OPCOES_MIN: 2, HAB_OPCOES_MAX: 5,

  // ---- Perfil inteligente (espelho de AREAS_EXPERIENCIA em ../../perfil-inteligente.js; test/perfil.test.js confere) ----
  AREAS_EXPERIENCIA: [
    "Mercearia", "Hortifruti / FLV", "Frios & Laticínios", "Bebidas", "Auditoria / Inventário", "Montagem de ilhas",
    "Prevenção de perdas", "Estoque / Logística", "Caixa / Frente de loja", "Atendimento ao cliente", "Açougue / Padaria", "Liderança de equipe"
  ],
  ENEAGRAMA_INSTINTOS: ["SP", "SX", "SO"],
  PERFIL_MAX_EXPERIENCIAS: 8,
  PERFIL_MAX_PALAVRAS: 12,

  // ---- Geolocalização das vagas ----
  GEO: { LAT_MIN: -34, LAT_MAX: 6, LNG_MIN: -74, LNG_MAX: -28 },   // caixa do Brasil: rejeita coordenadas absurdas

  // ---- Cursos (categorias do catálogo de treinamento; "habilitacao" = PRATICAMENTE obrigatório) ----
  CURSO_CATEGORIAS: ["habilitacao", "reposicao", "perdas", "atendimento", "seguranca", "carreira", "geral"],

  // ---- Idade ----
  IDADE_MINIMA: 16,            // cadastro permitido a partir dos 16 anos
  IDADE_MAIORIDADE: 18,        // abaixo disso: regras de proteção ao adolescente trabalhador
  IDADE_MAXIMA_PLAUSIVEL: 100, // trava contra datas absurdas (1900-01-01 etc.)

  // ---- Proteções para 16–17 anos (ECA / CLT art. 404-405 e Decreto 6.481/2008). REVISAR COM ADVOGADO TRABALHISTA. ----
  MENOR: {
    JANELA_INICIO: "05:00",    // trabalho noturno (22h–5h) é vedado a menores de 18
    JANELA_FIM: "22:00",
    // Setores que exigem restrição conservadora para menores (carga pesada, exposição a frio/corte, etc.).
    SETORES_VEDADOS: ["Frios & Laticínios", "Padaria", "Depósito", "Bebidas", "Montagem de ilhas"]
  },

  // ---- Treinamento PRATICAMENTE ----
  TREINO_PCT_MINIMO: 90,       // % mínimo do vídeo efetivamente assistido (tempo real validado no servidor)
  TREINO_PING_MAX_SEG: 30,     // um ping nunca credita mais que isso, mesmo que o cliente demore
  TREINO_PING_MIN_INTERVALO_MS: 4000,

  // ---- Carteira ----
  LIBERACAO_DIAS: inteiro(process.env.LIBERACAO_DIAS, 2),          // carência até o saldo ficar sacável
  SAQUE_MINIMO_CENTAVOS: inteiro(process.env.SAQUE_MINIMO_CENTAVOS, 2000),
  SAQUE_MAXIMO_CENTAVOS: inteiro(process.env.SAQUE_MAXIMO_CENTAVOS, 500000),
  PLATAFORMA_UID: "PLATAFORMA",

  // ---- Segurança ----
  AUTH_RECENTE_SEG: 300,       // operações sensíveis exigem login nos últimos 5 min
  ADMIN_EXIGE_MFA: ["1", "true"].includes(String(process.env.ADMIN_EXIGE_MFA || "").toLowerCase()),
  BODY_LIMITE: "20kb"
};
