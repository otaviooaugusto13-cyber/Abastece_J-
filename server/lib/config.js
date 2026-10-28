// Constantes de compliance e operação. Valores financeiros ficam em ../split.js.
const PRODUCAO = process.env.AMBIENTE === "producao" || process.env.NODE_ENV === "production";
const inteiro = (v, padrao) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : padrao; };

module.exports = {
  PRODUCAO,

  // ---- Setores de reposição (espelho de SETORES em ../../core.js; test/split.test.js confere) ----
  SETORES: ["Mercearia", "Hortifruti / FLV", "Frios & Laticínios", "Bebidas", "Auditoria / Inventário", "Montagem de ilhas"],

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
    SETORES_VEDADOS: ["Frios & Laticínios", "Bebidas", "Montagem de ilhas"]
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
