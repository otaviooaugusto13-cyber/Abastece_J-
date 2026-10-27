// Funções puras (sem DOM, sem Firebase): dinheiro, validação, formatação.
// Testadas em node: `node test/split.test.js`
import { VALOR_DIARIA_CENTAVOS, COMISSAO_PLATAFORMA_CENTAVOS, REPASSE_PROFISSIONAL_CENTAVOS, TAXA_FIXA_CENTAVOS, HORAS_MIN_TURNO, HORAS_MAX_TURNO, MAX_VEZES_SEMANA_LOJA, IDADE_MINIMA, IDADE_MAIORIDADE } from "./config.js";

// ---------- Dinheiro (sempre em CENTAVOS inteiros) ----------
export const reaisParaCentavos = (v) => {
    if (typeof v === "string") v = v.replace(/\./g, "").replace(",", ".");
    const n = Math.round(Number(v) * 100);
    return Number.isFinite(n) ? n : 0;
};

export const minutosEntre = (entrada, saida) => {
    const ok = (h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || ""));
    if (!ok(entrada) || !ok(saida)) return 0;
    const [h1, m1] = entrada.split(":").map(Number), [h2, m2] = saida.split(":").map(Number);
    return Math.max(0, h2 * 60 + m2 - (h1 * 60 + m1));
};
/** Divisão da diária (inteiros; comissão + repasse === total). O servidor repete este cálculo — o navegador só exibe. */
export function calcularDiaria() {
    return { valor: VALOR_DIARIA_CENTAVOS, promotor: REPASSE_PROFISSIONAL_CENTAVOS, comissao: COMISSAO_PLATAFORMA_CENTAVOS, royalty: COMISSAO_PLATAFORMA_CENTAVOS, taxaFixa: TAXA_FIXA_CENTAVOS,
        app: COMISSAO_PLATAFORMA_CENTAVOS + TAXA_FIXA_CENTAVOS, total: VALOR_DIARIA_CENTAVOS + TAXA_FIXA_CENTAVOS, pct: 100 - (REPASSE_PROFISSIONAL_CENTAVOS * 100) / VALOR_DIARIA_CENTAVOS, modelo: "diaria-v1" };
}
/** Compatível com o código antigo: o preço é a diária fixa, independente da duração. */
export function calcularTurno(minutos) {
    const m = Math.round(minutos);
    if (!Number.isInteger(m) || m <= 0) throw new Error("duração inválida");
    return { ...calcularDiaria(), minutos: m, horas: m / 60, liquidoPromotor: REPASSE_PROFISSIONAL_CENTAVOS };
}
/** "" se o horário é válido; senão a mensagem de erro. */
export function validarTurno(entrada, saida) {
    const m = minutosEntre(entrada, saida);
    if (m <= 0) return "A saída precisa ser depois da entrada.";
    if (m < HORAS_MIN_TURNO * 60) return `O turno precisa ter no mínimo ${HORAS_MIN_TURNO} horas.`;
    if (m > HORAS_MAX_TURNO * 60) return `O turno pode ter no máximo ${HORAS_MAX_TURNO} horas.`;
    return "";
}

// ---------- Semana (segunda a domingo) e frequência por loja ----------
export const STATUS_QUE_CONTAM = ["aceita", "paga", "concluida"];
const paraUTC = (iso) => { const [a, m, d] = String(iso).split("-").map(Number); return new Date(Date.UTC(a, m - 1, d)); };
const deUTC = (dt) => dt.toISOString().slice(0, 10);
export function limitesSemana(iso) {
    const dt = paraUTC(iso), dow = (dt.getUTCDay() + 6) % 7;
    const ini = new Date(dt); ini.setUTCDate(dt.getUTCDate() - dow);
    const fim = new Date(ini); fim.setUTCDate(ini.getUTCDate() + 6);
    return { inicio: deUTC(ini), fim: deUTC(fim) };
}
export function vezesNaSemana(historico, lojaUid, dataIso, ignorarId = "") {
    const { inicio, fim } = limitesSemana(dataIso);
    return historico.filter((t) => t.id !== ignorarId && t.uid === lojaUid && STATUS_QUE_CONTAM.includes(t.status) && t.data >= inicio && t.data <= fim).length;
}

// ---------- O que cada lado pode VER (privacidade de valores) ----------
/** Loja: valor cobrado pelo serviço + taxa de serviço fixa. Nunca repasse, royalty ou margem. */
export const visaoLoja = (s) => ({ valor: s.valor, taxaFixa: s.taxaFixa, total: s.total });
/** Promotor: apenas o líquido que ele recebe. Nunca o total pago pela loja. */
export const visaoPromotor = (s) => ({ liquido: s.promotor });
/** Líquido do promotor de um pedido (pedidos antigos, sem o campo novo, caem no cálculo). */
export const valorPromotor = (p) => {
    return Number.isInteger(p.valorPromotorCentavos) ? p.valorPromotorCentavos : REPASSE_PROFISSIONAL_CENTAVOS;
};

// ---------- Idade (espelho do servidor; o servidor decide) ----------
export const dataIsoValida = (iso) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return false; const d = new Date(iso + "T00:00:00Z"); return !isNaN(d) && d.toISOString().slice(0, 10) === iso; };
export function calcularIdade(nascIso, refIso = hojeLocal()) {
    const [a, m, d] = nascIso.split("-").map(Number), [ra, rm, rd] = refIso.split("-").map(Number);
    return ra - a - (rm < m || (rm === m && rd < d) ? 1 : 0);
}
/** "" se ok; senão a mensagem. `menor` indica 16–17 anos (pede dados do responsável). */
export function validarNascimento(iso) {
    if (!dataIsoValida(iso)) return { erro: "Informe uma data de nascimento válida.", menor: false };
    if (iso > hojeLocal()) return { erro: "A data de nascimento não pode estar no futuro.", menor: false };
    const idade = calcularIdade(iso);
    if (idade < IDADE_MINIMA) return { erro: `É preciso ter pelo menos ${IDADE_MINIMA} anos para se cadastrar.`, menor: false, idade };
    if (idade > 100) return { erro: "Data de nascimento inválida.", menor: false };
    return { erro: "", menor: idade < IDADE_MAIORIDADE, idade };
}
/** Limites do campo <input type=date>: do mais velho possível ao que completa 16 hoje. */
export function limitesNascimento() {
    const [a, m, d] = hojeLocal().split("-").map(Number), f = (anos) => new Date(Date.UTC(a - anos, m - 1, d)).toISOString().slice(0, 10);
    return { min: f(100), max: f(IDADE_MINIMA) };
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

// ---------- Textos ----------
// A discriminação de taxas/comissões aparece SOMENTE nos Termos de Uso ("Li e concordo").
// Telas, checkout, resumos e nota mostram apenas o que cada lado precisa ver.
export function textoTermos(perfil) {
    const diaria = brl(VALOR_DIARIA_CENTAVOS), com = brl(COMISSAO_PLATAFORMA_CENTAVOS), rep = brl(REPASSE_PROFISSIONAL_CENTAVOS);
    const comuns = `<strong>Remuneração e comissão.</strong> A diária padrão é de ${diaria} por turno. A plataforma retém automaticamente ${com} de comissão e repassa ${rep} ao profissional, creditados na carteira digital dele. O repasse fica em carência por alguns dias antes de poder ser sacado e pode ser estornado em caso de reembolso ou contestação do pagamento.<br><br>
  <strong>Limites de turno.</strong> Cada turno tem de ${HORAS_MIN_TURNO} a ${HORAS_MAX_TURNO} horas, e o mesmo promotor pode trabalhar no máximo ${MAX_VEZES_SEMANA_LOJA} vezes por semana (segunda a domingo) na mesma loja.`;
    if (perfil === "promotor") return `<strong>1. Autonomia.</strong> Você é prestador independente; escolhe os turnos que aceita. Não há vínculo empregatício com a plataforma ou com as lojas.<br><br>
  <strong>2.</strong> ${comuns}<br><br>
  <strong>3. Idade.</strong> O cadastro é permitido a partir dos ${IDADE_MINIMA} anos. De ${IDADE_MINIMA} a ${IDADE_MAIORIDADE - 1} anos é obrigatória a autorização de um responsável legal, e há restrições de horário (apenas diurno) e de setores.<br><br>
  <strong>4. Treinamento obrigatório.</strong> Para aceitar turnos é preciso concluir todos os vídeos de capacitação do projeto PRATICAMENTE.<br><br>
  <strong>5. Aprovação.</strong> Seu cadastro passa por análise antes de liberar as ofertas.<br><br>
  <strong>6. Compromisso.</strong> Aceitou, compareça. Se não puder, use “Desistir” com antecedência para o turno voltar à fila.<br><br>
  <strong>7. Obrigações fiscais.</strong> Seus ganhos podem ter obrigações tributárias. A nota emitida pela plataforma é um comprovante da loja e não substitui NFS-e.<br><br>
  <strong>8. Dados pessoais.</strong> CPF, nascimento, telefone e chave Pix são guardados cifrados e usados apenas para cadastro, pagamento e obrigações legais.`;
    return `<strong>1. O serviço.</strong> A plataforma conecta a sua loja a promotores autônomos. Eles não têm vínculo empregatício com a plataforma nem com a loja.<br><br>
  <strong>2.</strong> ${comuns}<br><br>
  <strong>3. Cartão de crédito.</strong> Para solicitar ou pagar um serviço é obrigatório manter um cartão de crédito válido cadastrado.<br><br>
  <strong>4. Pagamento.</strong> Você só paga depois do serviço, por Pix ou cartão, pelo Mercado Pago.<br><br>
  <strong>5. Cancelamento.</strong> Pode cancelar sem custo enquanto o pedido não foi pago.<br><br>
  <strong>6. Nota.</strong> A cada pagamento a plataforma emite uma nota de serviço em nome da sua empresa. Ela é um comprovante e não substitui NFS-e.`;
}
