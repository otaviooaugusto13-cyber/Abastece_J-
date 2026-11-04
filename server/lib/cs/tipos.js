"use strict";
/**
 * CS & B2B — SCHEMAS COMPARTILHADOS (servidor + painel React). Fonte única da verdade.
 *
 * Dinheiro: sempre em CENTAVOS (inteiros). Datas de turno: "YYYY-MM-DD" (fuso America/Sao_Paulo). Instantes: ms desde a época.
 * Nada aqui é lido pelo navegador direto do Firestore (regras: deny-all); tudo passa por /cs/*.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIMITES_PARAMETROS = exports.PARAMETROS_PADRAO = exports.SETORES_DESTAQUE = exports.SETORES_PEDIDO = exports.COLECOES = void 0;
// ───────────────────────── Coleções novas (Firestore) ─────────────────────────
exports.COLECOES = {
    redes: "cs_redes", // grupo/rede de supermercados (conta-chave) + modelo de faturamento
    lojas: "cs_lojas", // FICHA da loja (doc id = uid da loja em `contratantes`)
    fotos: "cs_lojas_fotos", // fotos da ficha (JPEG em base64; serve só pela API)
    interacoes: "cs_interacoes", // histórico de atendimentos do CS (ligação, visita, ação de churn…)
    lancamentos: "cs_faturamento_lancamentos", // razão de créditos/ajustes/faturas por rede
    recorrencias: "cs_recorrencias", // demandas programadas pelas lojas (datas comemorativas, picos)
    nps: "cs_nps", // pesquisa NPS B2B: um doc por envio (pendente → respondido)
    alertas: "cs_alertas", // alertas persistidos (vaga desatendida, churn, falha de recorrência) — id determinístico = sem duplicar
    config: "cs_config" // cs_config/parametros
};
/** Setores aceitos em pedidos (espelho de SETORES em server/lib/config.js; test/cs.test.cjs confere). */
exports.SETORES_PEDIDO = ["Mercearia", "Hortifruti / FLV", "Frios & Laticínios", "Padaria", "Depósito", "Degustação", "Bebidas", "Auditoria / Inventário", "Montagem de ilhas"];
/** Setores em destaque nos relatórios (os demais setores existentes aparecem depois). */
exports.SETORES_DESTAQUE = ["Mercearia", "Frios & Laticínios", "Hortifruti / FLV", "Depósito", "Padaria"];
exports.PARAMETROS_PADRAO = {
    alertaVagaHoras: 4, inatividadeDias: 15, toleranciaPontualMin: 10, metaFillRatePct: 90, metaCsat: 4.5, npsPeriodicidadeDias: 90,
    antecedenciaRecorrenciaDias: 14, custoMensalFixoCentavos: 360000, horasSemanaFixo: 44, ocupacaoFixaPct: 80,
    itensPorHora: 150, taxaRupturaEvitadaPct: 25, receitaPorRupturaCentavos: 0
};
/** [min, max, inteiro?] — validação no servidor e limites dos campos no painel. */
exports.LIMITES_PARAMETROS = {
    alertaVagaHoras: [1, 72, true], inatividadeDias: [5, 90, true], toleranciaPontualMin: [0, 60, true], metaFillRatePct: [50, 100, false],
    metaCsat: [1, 5, false], npsPeriodicidadeDias: [30, 365, true], antecedenciaRecorrenciaDias: [1, 90, true],
    custoMensalFixoCentavos: [100_000, 2_000_000, true], horasSemanaFixo: [10, 44, true], ocupacaoFixaPct: [30, 100, false],
    itensPorHora: [10, 1000, true], taxaRupturaEvitadaPct: [0, 100, false], receitaPorRupturaCentavos: [0, 10_000_000, true]
};
