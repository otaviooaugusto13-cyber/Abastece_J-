// Cursos do promotor: categorias e agrupamento (puro, testável). Os vídeos vêm de GET /treinamento (servidor).
// "habilitacao" = PRATICAMENTE obrigatório (libera os turnos). As demais categorias são opcionais e sempre abertas.
export const CATEGORIAS = [
    { id: "habilitacao", ico: "🎓", titulo: "Habilitação PRATICAMENTE", desc: "Obrigatório para aceitar turnos. Assista na ordem." },
    { id: "reposicao", ico: "🛒", titulo: "Reposição e mercearia", desc: "Gôndola, PVPS, ruptura e abastecimento." },
    { id: "perdas", ico: "🛡️", titulo: "Prevenção de perdas", desc: "Quebras, avarias, validade e inventário." },
    { id: "atendimento", ico: "🤝", titulo: "Atendimento e postura", desc: "Relacionamento com loja, equipe e cliente." },
    { id: "seguranca", ico: "🦺", titulo: "Segurança e saúde", desc: "Ergonomia, carga e cuidados no turno." },
    { id: "carreira", ico: "🚀", titulo: "Carreira e finanças", desc: "Organização, metas e renda." },
    { id: "geral", ico: "📚", titulo: "Outros cursos", desc: "Conteúdos extras da equipe." }
];
export const CATEGORIA = Object.fromEntries(CATEGORIAS.map((c) => [c.id, c]));

/** Agrupa módulos por categoria (na ordem de CATEGORIAS; categorias vazias somem). */
export function agruparCursos(modulos = []) {
    const g = new Map(CATEGORIAS.map((c) => [c.id, []]));
    for (const m of modulos) (g.get(CATEGORIA[m.categoria] ? m.categoria : (m.obrigatorio === false ? "geral" : "habilitacao")) || g.get("geral")).push(m);
    return CATEGORIAS.map((c) => {
        const itens = (g.get(c.id) || []).sort((a, b) => a.ordem - b.ordem);
        return { ...c, itens, concluidos: itens.filter((m) => m.concluido).length, total: itens.length };
    }).filter((c) => c.total);
}
export const statusCurso = (m) => (m.concluido ? { t: "Concluído ✓", cor: "green" } : m.bloqueado ? { t: "Bloqueado 🔒", cor: "" } : m.validoSeg ? { t: "Em andamento", cor: "blue" } : { t: "Não iniciado", cor: "" });
