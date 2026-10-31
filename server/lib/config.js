// Constantes de compliance e operação. Valores financeiros ficam em ../split.js.
const PRODUCAO = process.env.AMBIENTE === "producao" || process.env.NODE_ENV === "production";
const inteiro = (v, padrao) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : padrao; };

module.exports = {
  PRODUCAO,

  // Emitente dos comprovantes. Espelho de EMPRESA em ../../config.js (test/split.test.js confere).
  EMPRESA: { razaoSocial: "ABASTECE JÁ INTERMEDIAÇÃO DE SERVIÇOS LTDA", cnpj: "00.000.000/0001-00", cidade: "Itapira / SP", email: "otaviooaugusto13@gmail.com" },

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

  // ---- Cursos (categorias do catálogo de treinamento; "habilitacao" = PRATICAMENTE obrigatório) ----
  CURSO_CATEGORIAS: ["habilitacao", "reposicao", "perdas", "atendimento", "seguranca", "carreira", "geral"],

  // Rótulo exibido no app para cada setor (espelho de SETORES[].label em ../../core.js; test/split.test.js confere).
  SETORES_ROTULO: { "Mercearia": "Mercearia", "Hortifruti / FLV": "Hortifruti", "Frios & Laticínios": "Frios e laticínios", "Bebidas": "Bebidas", "Auditoria / Inventário": "Inventário", "Montagem de ilhas": "Ilhas e displays" },

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
  CONTAS_TESTE: ["teste-loja", "teste-promotor"],   // sandbox (MODO_TESTE): nunca sofrem multa/advertência nem geofence

  // ---- Check-in / check-out (geofencing + foto da gôndola) ----
  GEO: {
    RAIO_METROS: 100,                 // o promotor só inicia o turno a até 100 m da loja
    PRECISAO_MAX_M: 100,              // leitura de GPS pior que isso (±m) é recusada: não prova presença
    FIX_IDADE_MAX_MS: 120_000,        // a leitura de GPS precisa ser recente (idade medida no próprio aparelho)
    CHECKIN_ANTES_MIN: 30,            // check-in abre 30 min antes do início do turno
    CHECKIN_ATE_MIN: 60,              // ...e fecha 60 min depois: sem check-in até aí = falta injustificada
    PERMANENCIA_MIN_PCT: 50,          // check-out só depois de 50% da duração do turno no local (anti "check-in/out relâmpago")
    PERMANENCIA_MIN_RUPTURA_MIN: 30,  // chamado relâmpago: 30 min no local
    FALTA_LOJA_APOS_MIN: 20           // o promotor só pode reportar "loja ausente" depois de 20 min com check-in feito
  },
  FOTO: {
    MAX_BYTES: 560_000,               // JPEG da gôndola (o Firestore limita o documento a 1 MiB, e a imagem vai em base64)
    MIN_BYTES: 8_000, LADO_MIN: 480, LADO_MAX: 4096,
    MINIATURA_MAX_BYTES: 40_000
  },
  GONDOLA: ["cheia", "parcial"],      // declarado pelo promotor no check-out (a loja pode contestar)

  // ---- Reputação: advertências, "vidas", multas e banimento ----
  VIDAS_MAX: 3,                       // 3ª advertência = banimento automático
  CANCELAMENTO_TARDIO_HORAS: 12,      // desistir/cancelar com menos de 12 h do início (ou depois dele) = "em cima da hora"
  MULTAS_CENTAVOS: { desistencia_tardia: 3000, falta_promotor: 5000, cancelamento_tardio_loja: 4000, falta_loja: 5000 },
  INFRACAO_ROTULO: {
    desistencia_tardia: "Desistência de turno em cima da hora",
    falta_promotor: "Falta injustificada em turno aceito",
    cancelamento_tardio_loja: "Cancelamento de pedido em cima da hora",
    falta_loja: "Falta da loja: o promotor chegou ao local e o serviço não foi realizado"
  },
  INFRACAO_PAPEL: { desistencia_tardia: "promotor", falta_promotor: "promotor", cancelamento_tardio_loja: "loja", falta_loja: "loja" },

  // ---- Níveis: inatividade ----
  INATIVIDADE_DIAS: 60,               // 2 meses sem concluir chamados
  INATIVIDADE_MODO: ["resetar", "rebaixar"].includes(process.env.INATIVIDADE_MODO) ? process.env.INATIVIDADE_MODO : "rebaixar",   // rebaixar = cai 1 nível por período inativo; resetar = volta ao Bronze

  // ---- Chamado relâmpago (ruptura) ----
  RUPTURA: {
    BONUS_OPCOES_CENTAVOS: [2000, 3000, 5000],   // bônus de urgência pago pela loja e repassado 100% ao promotor
    EXPIRA_MIN: 30,                              // sem aceite em 30 min o chamado expira (sem multa)
    RAIO_KM: 5,                                  // alcance do disparo
    POSICAO_VALIDADE_H: 24,                      // posição do promotor mais antiga que isso não conta como "perto"
    DURACAO_MIN: 240,
    MAX_ABERTOS_POR_LOJA: 3,
    MAX_PUSH: 200
  },

  // ---- Segurança ----
  AUTH_RECENTE_SEG: 300,       // operações sensíveis exigem login nos últimos 5 min
  ADMIN_EXIGE_MFA: ["1", "true"].includes(String(process.env.ADMIN_EXIGE_MFA || "").toLowerCase()),
  BODY_LIMITE: "20kb",
  BODY_FOTO_LIMITE: "1mb"             // só a rota /checkout (foto da gôndola)
};
