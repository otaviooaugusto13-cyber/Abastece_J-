// Funções puras (sem DOM, sem Firebase): dinheiro, validação, formatação.
// Testadas em node: `node test/split.test.js`
import { PLATAFORMA_PCT, TAXA_FIXA_CENTAVOS, VALOR_MINIMO_CENTAVOS, VALOR_MAXIMO_CENTAVOS } from "./config.js";

// ---------- Dinheiro (sempre em CENTAVOS inteiros) ----------
export const reaisParaCentavos = (v) => {
    if (typeof v === "string") v = v.replace(/\./g, "").replace(",", ".");
    const n = Math.round(Number(v) * 100);
    return Number.isFinite(n) ? n : 0;
};

/** Divide um turno. valorCentavos = valor combinado do turno (sem a taxa fixa). */
export function calcularSplit(valorCentavos, pct = PLATAFORMA_PCT, taxaFixa = TAXA_FIXA_CENTAVOS) {
    const valor = Math.round(valorCentavos);
    if (!Number.isInteger(valor) || valor <= 0) throw new Error("valor inválido");
    const comissaoApp = Math.round((valor * pct) / 100);
    const promotor = valor - comissaoApp;                 // o promotor fica com o resto: nunca perde centavo por arredondamento
    const app = comissaoApp + taxaFixa;
    const total = valor + taxaFixa;
    return { valor, promotor, comissaoApp, taxaFixa, app, total, pct };
}

export function validarValor(valorCentavos) {
    if (!(valorCentavos > 0)) return "Informe o valor do turno.";
    if (valorCentavos < VALOR_MINIMO_CENTAVOS) return `O valor mínimo por turno é ${brl(VALOR_MINIMO_CENTAVOS)}.`;
    if (valorCentavos > VALOR_MAXIMO_CENTAVOS) return `O valor máximo por turno é ${brl(VALOR_MAXIMO_CENTAVOS)}.`;
    return "";
}

// ---------- Formatação ----------
export const brl = (centavos) => ((Number(centavos) || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const fmtData = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
export const fmtDataHora = (ts) => {
    const d = ts?.toDate ? ts.toDate() : ts?.seconds ? new Date(ts.seconds * 1000) : ts ? new Date(ts) : null;
    return d && !isNaN(d) ? d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
};
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const soDigitos = (s) => String(s ?? "").replace(/\D/g, "");
export const hojeLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const horasEntre = (entrada, saida) => {
    if (!entrada || !saida) return 0;
    const [h1, m1] = entrada.split(":").map(Number), [h2, m2] = saida.split(":").map(Number);
    return Math.max(0, (h2 * 60 + m2 - (h1 * 60 + m1)) / 60);
};

// ---------- Máscaras ----------
export const mascaraCPF = (v) => soDigitos(v).slice(0, 11).replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
export const mascaraCNPJ = (v) => soDigitos(v).slice(0, 14).replace(/(\d{2})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2");
export const mascaraDoc = (v) => (soDigitos(v).length <= 11 ? mascaraCPF(v) : mascaraCNPJ(v));
export const mascaraTelefone = (v) => {
    const d = soDigitos(v).slice(0, 11);
    if (d.length <= 2) return d ? `(${d}` : "";
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

// ---------- Validação de documentos ----------
export function cpfValido(cpf) {
    cpf = soDigitos(cpf);
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    for (let t = 9; t < 11; t++) {
        let soma = 0;
        for (let i = 0; i < t; i++) soma += parseInt(cpf[i]) * (t + 1 - i);
        if (((soma * 10) % 11) % 10 !== parseInt(cpf[t])) return false;
    }
    return true;
}
export function cnpjValido(cnpj) {
    cnpj = soDigitos(cnpj);
    if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
    const calc = (base) => {
        let soma = 0, peso = base.length - 7;
        for (let i = 0; i < base.length; i++) { soma += parseInt(base[i]) * peso--; if (peso < 2) peso = 9; }
        const r = soma % 11;
        return r < 2 ? 0 : 11 - r;
    };
    return calc(cnpj.slice(0, 12)) === parseInt(cnpj[12]) && calc(cnpj.slice(0, 13)) === parseInt(cnpj[13]);
}
export const docValido = (d) => (soDigitos(d).length === 11 ? cpfValido(d) : cnpjValido(d));

// ---------- Pedido ----------
export const ROTULO_STATUS = {
    aberta: "Aguardando promotor",
    aceita: "Aceito · pagar após o serviço",
    paga: "Pago",
    concluida: "Concluído",
    cancelada: "Cancelado"
};
/** Pedido pago = tem nota. Mantém compatível com pedidos antigos que usavam só "concluida". */
export const estaPago = (p) => p.status === "paga" || p.status === "concluida";
/** Valor do pedido em centavos (pedidos antigos guardavam reais em `valor`). */
export const valorCentavos = (p) => (p.valorCentavos ? p.valorCentavos : reaisParaCentavos(p.valor));

// ---------- Setores de reposição (usado por loja e promotor) ----------
export const SETORES = [
    { v: "Mercearia", ico: "🛒", label: "Mercearia" },
    { v: "Hortifruti / FLV", ico: "🍎", label: "Hortifruti" },
    { v: "Frios & Laticínios", ico: "🧀", label: "Frios e laticínios" },
    { v: "Bebidas", ico: "🍾", label: "Bebidas" },
    { v: "Auditoria / Inventário", ico: "🔍", label: "Inventário" },
    { v: "Montagem de ilhas", ico: "📦", label: "Ilhas e displays" }
];

// ---------- Textos que dependem da regra de taxas (nunca ficam desatualizados) ----------
export function textoRegra() {
    const pctApp = PLATAFORMA_PCT, pctProm = 100 - PLATAFORMA_PCT;
    return {
        curto: `${pctProm}% do valor do turno vai para o promotor e ${pctApp}% para a plataforma, mais uma taxa fixa de ${brl(TAXA_FIXA_CENTAVOS)} por turno paga pela loja.`,
        exemplo: (() => { const s = calcularSplit(10000); return `Exemplo: turno de ${brl(s.valor)} → promotor recebe ${brl(s.promotor)}; plataforma fica com ${brl(s.comissaoApp)} + ${brl(s.taxaFixa)} de taxa fixa; a loja paga ${brl(s.total)}.`; })()
    };
}
