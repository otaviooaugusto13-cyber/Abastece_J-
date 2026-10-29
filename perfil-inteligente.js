// Perfil inteligente do promotor — funções puras (sem DOM, sem Firebase; testadas em node: test/perfil.test.js).
//   1) combina EXPERIÊNCIA profissional + ENEAGRAMA (teste PRATICAMENTE) → palavras-chave e bio;
//   2) pontua cada vaga (0–100) cruzando DISTÂNCIA, EXPERIÊNCIA e ENEAGRAMA, com os motivos em texto.
//
// Transparência: é um gerador por regras (determinístico, funciona offline, sem custo e sem "inventar" fatos).
// O Eneagrama aqui é só uma afinidade de estilo de trabalho para sugerir vagas — NÃO é diagnóstico nem critério de aprovação.
import { SETORES } from "./core.js";
import { RAIO_KM } from "./geo.js";

// Ordem FIXA dos 6 setores de reposição usada nas matrizes abaixo (não depende de SETORES, que ganhou Padaria/Depósito/Degustação).
const S = ["Mercearia", "Hortifruti / FLV", "Frios & Laticínios", "Bebidas", "Auditoria / Inventário", "Montagem de ilhas"];
// Setores sem coluna própria nas matrizes herdam a mais parecida (mesmo enquadramento de SETOR_CATEGORIA no servidor).
// DECISÃO DE PRODUTO: revise com a equipe PRATICAMENTE; é só heurística de sugestão de vagas.
export const SETOR_PROXY = { "Padaria": "Mercearia", "Depósito": "Auditoria / Inventário", "Degustação": "Mercearia" };
const colSetor = (setor) => S.indexOf(SETOR_PROXY[setor] || setor);
const NOME_CURTO = Object.fromEntries(SETORES.map((s) => [s.v, s.label.toLowerCase()]));

// ============================================================
// 1) Áreas de experiência (espelho de AREAS_EXPERIENCIA em server/lib/config.js)
//    rel = quanto a experiência ajuda em cada setor, na ordem: Mercearia, Hortifruti, Frios, Bebidas, Inventário, Ilhas
// ============================================================
export const AREAS = [
    { v: "Mercearia", ico: "🛒", nome: "mercearia", tags: ["mercearia", "reposição", "gôndola", "ruptura zero"], entrega: "gôndola abastecida, organizada e sem ruptura", rel: [1, .4, .5, .6, .4, .4] },
    { v: "Hortifruti / FLV", ico: "🍎", nome: "hortifruti", tags: ["hortifruti", "FLV", "frescor", "classificação"], entrega: "hortifruti fresco, bem selecionado e sem desperdício", rel: [.4, 1, .5, .2, .3, .3] },
    { v: "Frios & Laticínios", ico: "🧀", nome: "frios e laticínios", tags: ["frios", "laticínios", "PVPS", "validade"], entrega: "validade controlada (PVPS) e cuidado com a cadeia do frio", rel: [.5, .5, 1, .4, .4, .2] },
    { v: "Bebidas", ico: "🍾", nome: "bebidas", tags: ["bebidas", "reposição ágil", "paletização"], entrega: "reposição ágil de bebidas, com organização e cuidado com a carga", rel: [.6, .2, .4, 1, .4, .4] },
    { v: "Auditoria / Inventário", ico: "🔍", nome: "inventário", tags: ["inventário", "auditoria", "contagem", "acuracidade"], entrega: "contagem precisa e divergências sob controle", rel: [.5, .4, .5, .5, 1, .3] },
    { v: "Montagem de ilhas", ico: "📦", nome: "ilhas e displays", tags: ["ilhas", "displays", "merchandising", "ponto extra"], entrega: "ilhas e displays que chamam atenção e vendem", rel: [.4, .3, .2, .4, .3, 1] },
    { v: "Prevenção de perdas", ico: "🛡️", nome: "prevenção de perdas", tags: ["prevenção de perdas", "quebras", "avarias", "controle de estoque"], entrega: "atenção a quebras, avarias e divergências para reduzir perdas", rel: [.6, .6, .7, .5, .9, .3] },
    { v: "Estoque / Logística", ico: "🏗️", nome: "estoque e logística", tags: ["estoque", "logística", "recebimento", "endereçamento"], entrega: "recebimento e estoque organizados, com giro rápido", rel: [.7, .4, .5, .8, .7, .4] },
    { v: "Caixa / Frente de loja", ico: "🧾", nome: "frente de loja", tags: ["frente de loja", "caixa", "operação"], entrega: "rotina de loja dominada e agilidade na operação", rel: [.3, .3, .3, .3, .3, .5] },
    { v: "Atendimento ao cliente", ico: "🤝", nome: "atendimento", tags: ["atendimento", "cliente", "comunicação"], entrega: "bom trato com clientes e com a equipe da loja", rel: [.3, .4, .3, .3, .2, .6] },
    { v: "Açougue / Padaria", ico: "🥩", nome: "açougue e padaria", tags: ["açougue", "padaria", "higiene", "manipulação"], entrega: "higiene e cuidado com produtos perecíveis", rel: [.4, .5, .8, .3, .3, .3] },
    { v: "Liderança de equipe", ico: "⭐", nome: "liderança", tags: ["liderança", "equipe", "organização de turno"], entrega: "turno bem coordenado e equipe alinhada", rel: [.5, .5, .5, .5, .5, .6] }
];
export const AREA = Object.fromEntries(AREAS.map((a) => [a.v, a]));
export const AREAS_VALIDAS = AREAS.map((a) => a.v);
export const MAX_EXPERIENCIAS = 8, MAX_PALAVRAS = 12, MAX_BIO = 300;

// ============================================================
// 2) Eneagrama (nomes e forças do teste PRATICAMENTE) + afinidade com cada setor (mesma ordem de S)
// ============================================================
export const ENEAGRAMA = {
    1: { nome: "O Perfeccionista", tracos: ["organizado", "criterioso", "confiável"], frase: "alto padrão de qualidade e compromisso com o combinado", kw: ["organização", "atenção a detalhes", "padrão de qualidade"], afin: [.95, .85, .95, .6, .9, .65] },
    2: { nome: "O Ajudador", tracos: ["prestativo", "atencioso", "colaborativo"], frase: "ótimo relacionamento com a equipe e com o cliente", kw: ["trabalho em equipe", "empatia", "bom atendimento"], afin: [.6, .75, .55, .55, .45, .7] },
    3: { nome: "O Realizador", tracos: ["focado em metas", "ágil", "eficiente"], frase: "execução rápida e foco em resultado", kw: ["foco em resultado", "agilidade", "proatividade"], afin: [.7, .7, .65, .8, .65, .85] },
    4: { nome: "O Individualista", tracos: ["criativo", "detalhista", "autêntico"], frase: "olhar estético para a apresentação do que entrego", kw: ["criatividade", "visual merchandising", "olhar estético"], afin: [.45, .6, .45, .45, .55, .9] },
    5: { nome: "O Observador", tracos: ["analítico", "independente", "calmo sob pressão"], frase: "boa compreensão do processo e entrega precisa, com autonomia", kw: ["análise", "autonomia", "precisão"], afin: [.6, .5, .75, .45, .95, .45] },
    6: { nome: "O Lealista", tracos: ["leal", "responsável", "atento a riscos"], frase: "antecipação de problemas e compromisso com o combinado", kw: ["responsabilidade", "confiabilidade", "prevenção de problemas"], afin: [.85, .7, .85, .65, .85, .5] },
    7: { nome: "O Entusiasta", tracos: ["dinâmico", "versátil", "positivo"], frase: "adaptação rápida e energia para manter o ritmo", kw: ["versatilidade", "adaptação", "energia positiva"], afin: [.45, .7, .4, .8, .35, .85] },
    8: { nome: "O Desafiador", tracos: ["determinado", "líder", "resolutivo"], frase: "iniciativa e firmeza para resolver na hora", kw: ["liderança", "iniciativa", "resolutividade"], afin: [.6, .6, .5, .9, .5, .6] },
    9: { nome: "O Pacificador", tracos: ["tranquilo", "colaborativo", "constante"], frase: "rotina estável e bom convívio com todos", kw: ["colaboração", "constância", "bom convívio"], afin: [.8, .75, .65, .65, .55, .55] }
};
export const INSTINTOS = { SP: "Autopreservação", SX: "Sexual", SO: "Social" };
const FECHO = { SP: "Pontual e cuidadoso com a rotina de cada turno.", SO: "Gosto de trabalhar em equipe e de me integrar à loja.", SX: "Dedicação intensa em tudo o que assumo.", "": "Comprometido com cada turno." };

export const asasDoTipo = (t) => [t === 1 ? 9 : t - 1, t === 9 ? 1 : t + 1];

/** Código curto do resultado do teste: { tipo:3, asa:2, instinto:"SO" } → "PM-3w2-SO". */
export const codigoEneagrama = (e) => (e && ENEAGRAMA[e.tipo] ? `PM-${e.tipo}${e.asa ? `w${e.asa}` : ""}${e.instinto ? `-${e.instinto}` : ""}` : "");
/** Lê o código ("PM-3w2-SO", "3w2 SO", "3-2-SO", "tipo 3 asa 2") e devolve { tipo, asa, instinto } válido ou null. */
export function lerCodigoEneagrama(txt) {
    const t = String(txt ?? "").toUpperCase().replace(/^PM[-\s]?/, "");
    const m = t.match(/(?:TIPO\s*)?([1-9])\s*(?:W|ASA|-|\/|\s)?\s*([1-9])?\b(?:\s*[-\/ ]?\s*(SP|SX|SO))?/);
    if (!m) return null;
    const tipo = Number(m[1]); let asa = m[2] ? Number(m[2]) : 0;
    if (asa && !asasDoTipo(tipo).includes(asa)) asa = 0;                       // asa precisa ser vizinha do tipo
    return { tipo, asa, instinto: m[3] || "" };
}
export const eneagramaValido = (e) => !!e && Number.isInteger(e.tipo) && !!ENEAGRAMA[e.tipo] && (!e.asa || asasDoTipo(e.tipo).includes(e.asa)) && (!e.instinto || e.instinto in INSTINTOS);

// ============================================================
// 3) Geração de palavras-chave e bio
// ============================================================
const maiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const unir = (l) => (l.length <= 1 ? l.join("") : `${l.slice(0, -1).join(", ")} e ${l[l.length - 1]}`);
const anosTxt = (n) => (n >= 1 ? `${n} ${n === 1 ? "ano" : "anos"}` : "");

/** Normaliza a lista (áreas válidas, sem repetição, limite) e ordena por tempo de experiência. */
export function normalizarExperiencias(lista) {
    const vistas = new Set(), out = [];
    for (const e of Array.isArray(lista) ? lista : []) {
        if (!e || !AREA[e.area] || vistas.has(e.area)) continue;
        vistas.add(e.area); out.push({ area: e.area, anos: Math.max(0, Math.min(40, Math.floor(Number(e.anos) || 0))), detalhe: String(e.detalhe || "").slice(0, 80) });
    }
    return out.slice(0, MAX_EXPERIENCIAS).sort((a, b) => b.anos - a.anos);
}

export function gerarPalavrasChave({ experiencias, eneagrama } = {}) {
    const exps = normalizarExperiencias(experiencias), kw = [];
    exps.slice(0, 4).forEach((e, i) => { AREA[e.area].tags.slice(0, i === 0 ? 3 : 2).forEach((t) => kw.push(t)); });
    if (exps[0]?.anos >= 1) kw.push(`${exps[0].anos}+ ${exps[0].anos === 1 ? "ano" : "anos"} de experiência`);
    if (eneagramaValido(eneagrama)) { const d = ENEAGRAMA[eneagrama.tipo]; kw.push(...d.kw, d.tracos[0]); }
    const vistos = new Set();
    return kw.filter((k) => { const c = k.toLowerCase(); if (vistos.has(c)) return false; vistos.add(c); return true; }).slice(0, MAX_PALAVRAS);
}

/** Bio de até 300 caracteres, em primeira pessoa, combinando experiência + traços do Eneagrama. */
export function gerarBio({ experiencias, eneagrama } = {}) {
    const exps = normalizarExperiencias(experiencias), en = eneagramaValido(eneagrama) ? ENEAGRAMA[eneagrama.tipo] : null;
    // frase 1 — experiência
    let s1;
    if (exps.length) {
        const partes = exps.slice(0, 2).map((e) => (e.anos >= 1 ? `${anosTxt(e.anos)} em ${AREA[e.area].nome}` : `experiência em ${AREA[e.area].nome}`));
        s1 = `Profissional de reposição com ${unir(partes)}.`;
    } else s1 = "Profissional de reposição focado em aprender rápido e entregar bem.";
    // frase 2 — o que entrego (a partir da maior experiência) + traços
    const principal = exps[0] ? AREA[exps[0].area] : null;
    let s2 = "";
    if (en && principal) s2 = `${maiuscula(unir(en.tracos))}: entrego ${principal.entrega}.`;
    else if (en) s2 = `${maiuscula(unir(en.tracos))}, com ${en.frase}.`;
    else if (principal) s2 = `Entrego ${principal.entrega}.`;
    // frase 3 — complemento do segundo conjunto de experiência / traço de ação
    let s3 = "";
    if (exps[1] && en) s3 = `Somo ${AREA[exps[1].area].nome} ao meu dia a dia, com ${en.frase}.`;
    // fecho
    const fecho = FECHO[eneagrama?.instinto] || FECHO[""];
    // monta e corta por frase inteira até caber
    const blocos = [s1, s2, s3, fecho].filter(Boolean);
    while (blocos.length > 1 && blocos.join(" ").length > MAX_BIO) blocos.splice(blocos.length - (blocos.length > 2 ? 2 : 1), 1);   // tira primeiro s3, depois o fecho
    let bio = blocos.join(" ");
    if (bio.length > MAX_BIO) bio = bio.slice(0, MAX_BIO - 1).replace(/[\s,;:.]+\S*$/, "") + "…";
    return bio;
}

/** Tudo de uma vez (usado no formulário em tempo real). */
export const gerarPerfil = (dados) => ({ palavrasChave: gerarPalavrasChave(dados), bio: gerarBio(dados), experiencias: normalizarExperiencias(dados?.experiencias) });

// ============================================================
// 4) Ranking das ofertas: distância + experiência + Eneagrama
// ============================================================
export const PESOS = { dist: 40, exp: 35, enea: 25 };
const fatorAnos = (a) => (a >= 5 ? 1 : a >= 3 ? .95 : a >= 2 ? .85 : a >= 1 ? .75 : .6);

/** 0–1 (ou null quando o promotor ainda não informou experiências). */
export function afinidadeExperiencia(experiencias, setor) {
    const exps = normalizarExperiencias(experiencias), i = colSetor(setor);
    if (!exps.length || i < 0) return null;
    let melhor = { v: 0, e: null };
    for (const e of exps) { const v = AREA[e.area].rel[i] * fatorAnos(e.anos); if (v > melhor.v) melhor = { v, e }; }
    return { v: Math.max(.1, melhor.v), area: melhor.e?.area, anos: melhor.e?.anos || 0, direta: melhor.e?.area === setor };
}
/** 0–1 (ou null sem Eneagrama): tipo principal pesa 75% e a asa 25%. */
export function afinidadeEneagrama(eneagrama, setor) {
    const i = colSetor(setor);
    if (!eneagramaValido(eneagrama) || i < 0) return null;
    const p = ENEAGRAMA[eneagrama.tipo].afin[i], a = eneagrama.asa ? ENEAGRAMA[eneagrama.asa].afin[i] : p;
    return .75 * p + .25 * a;
}
/** 1 no mesmo ponto → 0 no limite do raio. null quando a distância é desconhecida. */
export const afinidadeDistancia = (km, raio = RAIO_KM) => (Number.isFinite(km) ? Math.max(0, 1 - km / raio) : null);

/**
 * Pontua uma vaga. Fatores desconhecidos (sem GPS, sem experiência, sem Eneagrama) NÃO penalizam: os pesos são redistribuídos.
 * @returns {{score:number|null, partes:{dist,exp,enea}, razoes:string[], nivel:"alto"|"medio"|"baixo"|"nenhum", conhecidos:number}}
 */
export function pontuarOferta(oferta, { distKm = null, experiencias = [], eneagrama = null, raio = RAIO_KM, fmtKm = (k) => `${k.toFixed(1)} km` } = {}) {
    const dist = afinidadeDistancia(distKm, raio), exp = afinidadeExperiencia(experiencias, oferta?.foco), enea = afinidadeEneagrama(eneagrama, oferta?.foco);
    const f = [["dist", dist, PESOS.dist], ["exp", exp?.v ?? null, PESOS.exp], ["enea", enea, PESOS.enea]].filter(([, v]) => v !== null);
    const razoes = [];
    if (dist !== null && dist >= .5) razoes.push(`📍 A ${fmtKm(distKm)} de você`);
    if (exp && exp.v >= .6) razoes.push(exp.direta ? `💼 ${exp.anos >= 1 ? anosTxt(exp.anos) + " de" : "Sua"} experiência em ${NOME_CURTO[oferta.foco] || oferta.foco}` : `💼 Experiência relacionada: ${AREA[exp.area].nome}`);
    if (enea !== null && enea >= .75) razoes.push(`🧠 Seu perfil (${ENEAGRAMA[eneagrama.tipo].tracos[0]}) combina com ${NOME_CURTO[oferta.foco] || oferta.foco}`);
    const partes = { dist, exp: exp?.v ?? null, enea };
    if (!f.length) return { score: null, partes, razoes, nivel: "nenhum", conhecidos: 0 };
    const total = f.reduce((a, [, , p]) => a + p, 0), score = Math.round((f.reduce((a, [, v, p]) => a + v * p, 0) / total) * 100);
    return { score, partes, razoes, nivel: score >= 80 ? "alto" : score >= 60 ? "medio" : "baixo", conhecidos: f.length };
}
/** Pontua e ordena (maior score primeiro; empate: mais perto, depois mais cedo). */
export function ranquearOfertas(ofertas, ctx) {
    return ofertas.map((o) => ({ ...o, match: pontuarOferta(o, { ...ctx, distKm: o.distKm ?? null }) }))
        .sort((a, b) => (b.match.score ?? -1) - (a.match.score ?? -1) || (a.distKm ?? 1e9) - (b.distKm ?? 1e9) || `${a.data}${a.entrada}`.localeCompare(`${b.data}${b.entrada}`));
}
