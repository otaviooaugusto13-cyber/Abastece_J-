// ==========================================================================
// ABASTECE JÁ — regras financeiras (ÚNICA fonte de verdade no navegador)
// Tudo é calculado em CENTAVOS inteiros para nunca ter erro de arredondamento.
//
// Regra:  valor do turno (V) = o que a loja combinou com o promotor
//   • Promotor recebe  80% de V
//   • Aplicativo fica  20% de V  +  taxa fixa por pedido
//   • Loja paga        V + taxa fixa
//
// ⚠️ Se mudar aqui, mude também em functions/index.js (mesmos 3 números).
// ==========================================================================
export const TAXA_PROMOTOR = 0.80;      // parte do promotor
export const TAXA_APP = 0.20;           // comissão do aplicativo
export const TAXA_FIXA_CENTAVOS = 300;  // custo fixo por pedido: R$ 3,00  ← AJUSTE AQUI

export const emCentavos = (reais) => Math.round((Number(reais) || 0) * 100);
export const emReais = (centavos) => centavos / 100;
export const brl = (reais) => (Number(reais) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** @param {number} valorReais valor do turno digitado pela loja */
export function calcularRepasse(valorReais) {
    const base = emCentavos(valorReais);
    const promotor = Math.round(base * TAXA_PROMOTOR);
    const comissao = base - promotor;                 // o que sobra fica com o app (sem "perder" centavo)
    const fixa = base > 0 ? TAXA_FIXA_CENTAVOS : 0;
    return {
        base: emReais(base),
        promotor: emReais(promotor),
        comissao: emReais(comissao),
        taxaFixa: emReais(fixa),
        app: emReais(comissao + fixa),
        totalLoja: emReais(base + fixa)
    };
}
