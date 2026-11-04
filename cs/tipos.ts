/**
 * CS & B2B — SCHEMAS COMPARTILHADOS (servidor + painel React). Fonte única da verdade.
 *
 * Dinheiro: sempre em CENTAVOS (inteiros). Datas de turno: "YYYY-MM-DD" (fuso America/Sao_Paulo). Instantes: ms desde a época.
 * Nada aqui é lido pelo navegador direto do Firestore (regras: deny-all); tudo passa por /cs/*.
 */

// ───────────────────────── Coleções novas (Firestore) ─────────────────────────
export const COLECOES = {
  redes: "cs_redes",                    // grupo/rede de supermercados (conta-chave) + modelo de faturamento
  lojas: "cs_lojas",                    // FICHA da loja (doc id = uid da loja em `contratantes`)
  fotos: "cs_lojas_fotos",              // fotos da ficha (JPEG em base64; serve só pela API)
  interacoes: "cs_interacoes",          // histórico de atendimentos do CS (ligação, visita, ação de churn…)
  lancamentos: "cs_faturamento_lancamentos", // razão de créditos/ajustes/faturas por rede
  recorrencias: "cs_recorrencias",      // demandas programadas pelas lojas (datas comemorativas, picos)
  nps: "cs_nps",                        // pesquisa NPS B2B: um doc por envio (pendente → respondido)
  alertas: "cs_alertas",                // alertas persistidos (vaga desatendida, churn, falha de recorrência) — id determinístico = sem duplicar
  config: "cs_config"                   // cs_config/parametros
} as const;

/** Setores aceitos em pedidos (espelho de SETORES em server/lib/config.js; test/cs.test.cjs confere). */
export const SETORES_PEDIDO = ["Mercearia", "Hortifruti / FLV", "Frios & Laticínios", "Padaria", "Depósito", "Degustação", "Bebidas", "Auditoria / Inventário", "Montagem de ilhas"] as const;

/** Setores em destaque nos relatórios (os demais setores existentes aparecem depois). */
export const SETORES_DESTAQUE = ["Mercearia", "Frios & Laticínios", "Hortifruti / FLV", "Depósito", "Padaria"] as const;

// ───────────────────────── Parâmetros editáveis (cs_config/parametros) ─────────────────────────
export interface ParametrosCS {
  alertaVagaHoras: number;              // alerta quando faltam ≤ X h para o início e não há promotor
  inatividadeDias: number;              // loja sem criar missão há ≥ N dias = churn (padrão do negócio: 15)
  toleranciaPontualMin: number;         // check-in até N min depois do início ainda é "pontual"
  metaFillRatePct: number;
  metaCsat: number;                     // 1–5
  npsPeriodicidadeDias: number;         // intervalo mínimo entre pesquisas por loja
  antecedenciaRecorrenciaDias: number;  // quantos dias à frente a recorrência vira pedido real
  // premissas do ROI (ESTIMATIVA — ver CS-B2B-MODULO.md)
  custoMensalFixoCentavos: number;      // custo total mensal de 1 repositor CLT (salário + encargos + benefícios)
  horasSemanaFixo: number;              // jornada semanal do contratado
  ocupacaoFixaPct: number;              // % da jornada realmente produtiva (férias, faltas, ociosidade)
  // premissas de ruptura evitada (ESTIMATIVA)
  itensPorHora: number;                 // itens repostos por hora de promotor
  taxaRupturaEvitadaPct: number;        // % das reposições regulares com gôndola cheia que evitam uma ruptura
  receitaPorRupturaCentavos: number;    // venda preservada por ruptura evitada; 0 = não estimar dinheiro
}
export const PARAMETROS_PADRAO: ParametrosCS = {
  alertaVagaHoras: 4, inatividadeDias: 15, toleranciaPontualMin: 10, metaFillRatePct: 90, metaCsat: 4.5, npsPeriodicidadeDias: 90,
  antecedenciaRecorrenciaDias: 14, custoMensalFixoCentavos: 360000, horasSemanaFixo: 44, ocupacaoFixaPct: 80,
  itensPorHora: 150, taxaRupturaEvitadaPct: 25, receitaPorRupturaCentavos: 0
};
/** [min, max, inteiro?] — validação no servidor e limites dos campos no painel. */
export const LIMITES_PARAMETROS: Record<keyof ParametrosCS, [number, number, boolean]> = {
  alertaVagaHoras: [1, 72, true], inatividadeDias: [5, 90, true], toleranciaPontualMin: [0, 60, true], metaFillRatePct: [50, 100, false],
  metaCsat: [1, 5, false], npsPeriodicidadeDias: [30, 365, true], antecedenciaRecorrenciaDias: [1, 90, true],
  custoMensalFixoCentavos: [100_000, 2_000_000, true], horasSemanaFixo: [10, 44, true], ocupacaoFixaPct: [30, 100, false],
  itensPorHora: [10, 1000, true], taxaRupturaEvitadaPct: [0, 100, false], receitaPorRupturaCentavos: [0, 10_000_000, true]
};

// ───────────────────────── 1) LOJA B2B (ficha) — cs_lojas/{lojaUid} ─────────────────────────
export interface EnderecoLoja { logradouro: string; numero: string; bairro: string; cidade: string; uf: string; cep: string }
export interface LojaB2B {
  lojaUid: string;                      // = id do doc em `contratantes` (a conta que cria as missões)
  nome: string;
  redeId: string | null;                // vínculo com a conta-chave (cs_redes/{id}); null = loja avulsa
  endereco: EnderecoLoja;
  acesso: { instrucoes: string; contatoPortaria: string; horarioRecebimento: string };   // como o promotor entra
  gerente: { nome: string; telefone: string; email: string };
  observacoes: string;
  csResponsavel: string;                // quem do CS cuida da conta
  ativo: boolean;
  fotosQtd: number;                     // máx. 6 (as imagens vêm de /cs/lojas/:uid/fotos/:id)
  atualizadoEm: number | null;
}
export interface RedeB2B {
  id: string; nome: string; csResponsavel: string;
  modelo: ModeloFaturamento; limiteCentavos: number; cicloDia: number;   // pós-pago: limite de crédito e dia de fechamento (1–28)
  inicioApuracaoEm: number;             // saldo/consumo contam a partir daqui
  lojasQtd: number;
}
export type ModeloFaturamento = "prepago" | "pospago";

// ───────────────────────── 2) AVALIAÇÃO CSAT — derivada de solicitacoes.avaliacao ─────────────────────────
/** Não há coleção nova: a nota que o gerente dá em POST /avaliarServico (1–5 + comentário) É o CSAT do turno. */
export interface AvaliacaoCSAT {
  pedidoId: string; lojaUid: string; lojaNome: string; redeId: string | null; setor: string;
  estrelas: 1 | 2 | 3 | 4 | 5; comentario: string; em: number;
}

// ───────────────────────── 3) MÉTRICA DE FILL RATE ─────────────────────────
/**
 * Definições (fixas, auditáveis):
 *  - ABERTA     = missão criada pela loja com turno no período e status ≠ cancelada.
 *  - ENCERRADA  = aberta cujo turno já terminou (só ela entra no denominador: missão futura ainda pode ser preenchida).
 *  - ACEITA     = encerrada que teve promotor (status ≠ aberta).      → taxaAceite
 *  - CONCLUÍDA  = encerrada com check-out feito (fase "executada") ou status paga/concluida.  → fillRate
 *  - NO PRAZO   = concluída com check-in até `toleranciaPontualMin` após o início.             → fillRateNoPrazo
 * fillRate = concluídas / encerradas. Lacuna = semPromotor (ninguém aceitou) + faltaPromotor (aceitou e não executou).
 */
export interface MetricaFillRate {
  periodo: { desde: string; ate: string; dias: number };
  abertas: number; encerradas: number; aceitas: number; concluidas: number; noPrazo: number;
  semPromotor: number; faltaPromotor: number;
  taxaAceite: number | null; fillRate: number | null; fillRateNoPrazo: number | null; metaPct: number;
  serie: { dia: string; encerradas: number; concluidas: number; noPrazo: number; fillRate: number | null }[];
}

// ───────────────────────── Saídas das agregações (contrato das APIs /cs/*) ─────────────────────────
export type Severidade = "critica" | "alta" | "media";
export interface VagaDesatendida {
  pedidoId: string; lojaUid: string; lojaNome: string; redeId: string | null; setor: string; data: string; entrada: string;
  minutosParaInicio: number; severidade: Severidade; urgente: boolean;
}
export interface Indicadores {
  missoes: number; encerradas: number; concluidas: number; horas: number; gastoCentavos: number;
  fillRate: number | null; fillRateNoPrazo: number | null; csat: number | null; avaliacoes: number; pontualidade: number | null; gondolaCheiaPct: number | null;
}
export interface MetricaCsat {
  media: number | null; total: number; csatPct: number | null; metaMedia: number;
  distribuicao: { estrelas: number; qtd: number }[];
  serie: { semana: string; media: number | null; qtd: number }[];
  comentarios: { pedidoId: string; loja: string; estrelas: number; comentario: string; em: number }[];
  baixas: number;                       // avaliações ≤ 2 estrelas
}
export interface MetricaPontualidade {
  tolMin: number; checkins: number; pontuais: number; pct: number | null; atrasoMedioMin: number | null;
  serie: { semana: string; pct: number | null; checkins: number }[];
  promotores: { nome: string; nivel: string; checkins: number; pct: number; atrasoMedioMin: number }[];   // piores primeiro, mín. 2 check-ins
}
export interface MesRoi {
  mes: string; parcial: boolean; horas: number; turnos: number; lojasAtivas: number;
  onDemandCentavos: number; fixoEquivalenteCentavos: number; economiaCentavos: number; economiaPct: number | null; contratadosEquivalentes: number;
}
export interface MetricaRoi { meses: MesRoi[]; acumulado: { onDemandCentavos: number; fixoEquivalenteCentavos: number; economiaCentavos: number; economiaPct: number | null }; premissas: Pick<ParametrosCS, "custoMensalFixoCentavos" | "horasSemanaFixo" | "ocupacaoFixaPct"> }
export interface MetricaRuptura {
  reposicoes: number; horas: number; itensRepostosEst: number; gondolasCheias: number; chamadosRelampago: number;
  evitadasConfirmadas: number; evitadasEstimadas: number; evitadasTotal: number; vendaPreservadaCentavos: number | null;
  serie: { mes: string; evitadas: number; itens: number }[];
}
export interface LinhaSetor extends Indicadores { setor: string; tempoAceiteMin: number | null }
export type NivelChurn = "saudavel" | "atencao" | "risco" | "critico";
export interface LojaChurn {
  lojaUid: string; nome: string; redeId: string | null; redeNome: string; nivel: NivelChurn;
  diasSemMissao: number; alemDaJanela: boolean; semNenhumaMissao: boolean; ultimaMissaoEm: number | null;
  missoes90d: number; gasto90dCentavos: number; acaoAberta: boolean;
}
export interface MetricaChurn {
  limiteDias: number; janelaDias: number; itens: LojaChurn[];
  resumo: { saudavel: number; atencao: number; risco: number; critico: number }; receitaEmRiscoCentavos: number;
}
export interface ContaChave extends Indicadores {
  redeId: string | null; nome: string; csResponsavel: string; lojas: number; lojasAtivas: number; lojasEmChurn: number; nps: number | null;
  porLoja: (Indicadores & { lojaUid: string; nome: string; nivelChurn: NivelChurn })[];
}
export interface LinhaMarca extends Indicadores { marcaId: string; marca: string; lojas: number; regioes: string[]; auditoriasContestadas: number }
export type AlertaFaturamento = "ok" | "saldo_baixo" | "saldo_esgotado" | "limite_proximo" | "limite_estourado";
export interface LinhaFaturamento {
  redeId: string; rede: string; modelo: ModeloFaturamento; alerta: AlertaFaturamento;
  creditosCentavos: number; consumoCentavos: number; comprometidoCentavos: number;     // comprometido = missões abertas/aceitas ainda não executadas
  saldoDisponivelCentavos: number | null; diasDeSaldo: number | null;                  // pré-pago
  limiteCentavos: number | null; consumoCicloCentavos: number | null; usoLimitePct: number | null; proximoFechamento: string | null;   // pós-pago
  apuracaoParcial: boolean;
  lancamentos: { id: string; tipo: TipoLancamento; valorCentavos: number; descricao: string; em: number; paga: boolean | null }[];
}
export type TipoLancamento = "credito" | "ajuste" | "fatura";
export interface MetricaNps {
  nps: number | null; respostas: number; enviados: number; taxaResposta: number | null; pendentes: number;
  promotores: number; neutros: number; detratores: number;
  serie: { mes: string; nps: number | null; respostas: number }[];
  comentarios: { loja: string; nota: number; comentario: string; em: number }[];
}
export interface KpisCS {
  fillRate: number | null; fillRateNoPrazo: number | null; csat: number | null; nps: number | null; pontualidade: number | null;
  economiaCentavos: number; vagasDesatendidas: number; lojasEmChurn: number; rupturasEvitadas: number;
}
export interface PainelCS {
  geradoEm: number; periodo: { desde: string; ate: string; dias: number };
  escopo: { redeId: string | null; rede: string };
  parametros: ParametrosCS; truncado: boolean;
  kpis: KpisCS; fillRate: MetricaFillRate; vagas: VagaDesatendida[]; csat: MetricaCsat; pontualidade: MetricaPontualidade;
  roi: MetricaRoi; ruptura: MetricaRuptura; setores: LinhaSetor[]; churn: MetricaChurn; nps: MetricaNps;
}

// ───────────────────────── Recorrências e NPS (escritas) ─────────────────────────
export type TipoRecorrencia = "datas" | "semanal";
export interface Recorrencia {
  id: string; lojaUid: string; lojaNome: string; nome: string; setor: string; entrada: string; saida: string; marcaId: string | null;
  tipo: TipoRecorrencia; datas: string[]; diasSemana: number[]; ate: string | null;   // diasSemana: 0=domingo … 6=sábado
  ativo: boolean; geradas: string[]; ultimaFalha: string; criadoEm: number;
}
export interface EnvioNps { id: string; lojaUid: string; redeId: string | null; lojaNome: string; status: "pendente" | "respondido" | "expirado"; criadoEm: number; respondidoEm: number | null; nota: number | null; comentario: string }
export type TipoInteracao = "ligacao" | "visita" | "email" | "whatsapp" | "nota" | "acao_churn";
export interface Interacao { id: string; lojaUid: string; tipo: TipoInteracao; texto: string; autorNome: string; em: number; status: "aberta" | "concluida" | null }   // status só em acao_churn
