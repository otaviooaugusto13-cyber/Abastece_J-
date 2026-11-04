// ============================================================
// ABASTECE JÁ — núcleo PURO do tratamento de erros (sem DOM, sem rede): testável em Node.
//   normalizar → ruido → impressao (dedupe) → redigir (LGPD) → montarRelatorio (chamado + chat)
// A interface e os listeners globais ficam em erros-globais.js.
// ============================================================

/** Códigos de erro da API que abrem chamado mesmo sendo 4xx (inconsistência de negócio). Espelhado em firebase.js. */
export const CODIGOS_COM_CHAMADO = ["valor-divergente", "pagamento-invalido", "nota-inconsistente", "estorno-invalido", "loja-sem-localizacao", "dado-travado"];

export const LIMITES = { titulo: 120, descricaoChamado: 2000, mensagemChat: 1000, stackLinhas: 8, mensagemErro: 400 };

/** Qualquer coisa que alguém possa lançar (Error, string, objeto, undefined…) vira { nome, mensagem, stack }. */
export function normalizar(causa, extra = {}) {
    let nome = "Error", mensagem = "", stack = "", codigo = "", status = 0;
    if (causa instanceof Error || (causa && typeof causa === "object" && ("message" in causa || "stack" in causa))) {
        nome = String(causa.name || "Error"); mensagem = String(causa.message ?? ""); stack = String(causa.stack || "");
        if (causa.code) { codigo = String(causa.code).slice(0, 60); mensagem += ` [code=${codigo.slice(0, 40)}]`; }
        if (causa.status) { status = Number(causa.status) || 0; mensagem += ` [status=${String(causa.status).slice(0, 10)}]`; }
    } else if (typeof causa === "string") { mensagem = causa; nome = "Erro"; }
    else if (causa === undefined || causa === null) { mensagem = "Erro sem detalhes"; }
    else { try { mensagem = JSON.stringify(causa); } catch { mensagem = String(causa); } nome = "ErroNaoPadrao"; }
    return { nome, mensagem: mensagem.slice(0, LIMITES.mensagemErro) || "Erro sem mensagem", stack, ...(codigo ? { codigo } : {}), ...(status ? { status } : {}), ...extra };
}

/**
 * Erros que NÃO são problema do app: ruído do navegador ou de extensões. Abrir chamado para eles só entope a fila de TI.
 * (Erros de carregamento de imagem/script de terceiros nem chegam aqui: não são exceções.)
 */
const RUIDO = [
    /ResizeObserver loop/i,                       // aviso inofensivo do Chrome/Safari
    /^Script error\.?$/i,                         // erro de outra origem, sem informação alguma
    /(chrome|moz|safari)-extension:\/\//i,         // código de extensão do navegador
    /AbortError|The user aborted a request|signal is aborted/i,   // fetch cancelado de propósito
    /Load failed$|Failed to fetch$|NetworkError when attempting/i,  // sem internet: o chat de rede já avisa; não há como abrir chamado sem rede
    /^auth\/(popup-closed-by-user|cancelled-popup-request|user-cancelled)/i,   // a pessoa fechou o login do Google
    /sem-sessao|Sua sessão terminou/i              // sessão expirada: fluxo normal de login, não bug
];
export function ehRuido(e) {
    const junto = `${e.nome} ${e.mensagem} ${e.stack || ""} ${e.arquivo || ""}`;
    return RUIDO.some((r) => r.test(e.mensagem) || r.test(junto));   // padrões ancorados (^…$) valem para a mensagem sozinha
}

/** Hash FNV-1a de 32 bits (suficiente para agrupar erros iguais; não é criptográfico). */
function fnv(texto, semente) { let h = semente >>> 0; for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, "0"); }

/**
 * Assinatura estável do erro: mesmo erro → mesma impressão, mesmo que número de linha, ids e valores mudem.
 * Usada no navegador (não repetir painel) e no servidor (reaproveitar o chamado → mesmo protocolo).
 */
export function impressao(e) {
    const msg = String(e.mensagem).replace(/\d+/g, "#").replace(/[0-9a-f]{8,}/gi, "H").slice(0, 200);
    const frame = (String(e.stack || "").split("\n").find((l) => /\bat\b|@/.test(l)) || e.arquivo || "").replace(/[:(]\d+:\d+\)?$/, "").replace(/\?.*$/, "").slice(0, 160);
    const base = `${e.nome}|${msg}|${frame}`;
    return fnv(base, 2166136261) + fnv(base, 0x9747b28c);   // 16 caracteres hex
}

/** Remove dados pessoais e segredos do texto técnico antes de gravar em chamado/chat (LGPD): e-mail, CPF/CNPJ, telefone, tokens, query strings. */
export function redigir(texto) {
    return String(texto ?? "")
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, "Bearer [removido]")
        .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[jwt removido]")
        .replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, "[e-mail removido]")
        .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf removido]")
        .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[cnpj removido]")
        .replace(/\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, "[telefone removido]")
        .replace(/([?&](?:token|key|apikey|api_key|access_token|auth|senha|password|code)=)[^&\s)]+/gi, "$1[removido]");
}

export const PREFIXO_BUG = "[AUTO-BUG]";
const cortar = (s, n) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);
/** URL sem query/hash: o caminho basta para o TI e não vaza parâmetros. */
export const urlSegura = (href) => { try { const u = new URL(href); return `${u.origin}${u.pathname}`; } catch { return String(href || "").split(/[?#]/)[0]; } };

/**
 * Contexto ESTRUTURADO do erro (vai em `contexto` no POST). O servidor trata tudo como não confiável e re-sanitiza;
 * o usuário NÃO vai aqui: o servidor usa o do token. A pilha segue já redigida (LGPD).
 */
export function montarContexto(e, ctx = {}) {
    let rota = ""; try { rota = new URL(ctx.url).pathname; } catch { rota = String(ctx.url || "").split(/[?#]/)[0]; }
    return {
        nome: e.nome, mensagem: redigir(e.mensagem), origem: e.origem || "", rota, versao: ctx.versao || "", perfil: ctx.perfil || "", tela: ctx.tela || "",
        navegador: cortar(String(ctx.navegador || ""), 400), viewport: ctx.viewport || "", online: ctx.online, fuso: ctx.fuso || "",
        arquivo: e.arquivo ? urlSegura(e.arquivo) : "", linha: e.linha || 0,
        stack: redigir(String(e.stack || "").split("\n").slice(0, LIMITES.stackLinhas).map((l) => l.trim()).join("\n"))
    };
}

/**
 * Monta os dois textos a partir do erro e do contexto coletado pelo navegador.
 *   titulo      → título do chamado ("[AUTO-BUG] TypeError: …")
 *   descricao   → relatório completo (≤ 2000 caracteres: limite do chamado)
 *   paraChat(p, setor) → versão compacta com o protocolo (≤ 1000: limite da mensagem do chat); `setor` = departamento que recebeu o chamado (padrão "TI")
 *   erro        → campos estruturados (já sem dados pessoais) para o SERVIDOR classificar e rotear o chamado: TI, ADM/Financeiro ou Suporte
 */
export function montarRelatorio(e, ctx = {}) {
    const pilha = redigir(String(e.stack || "").split("\n").slice(0, LIMITES.stackLinhas).map((l) => l.trim()).join("\n"));
    const trilha = (ctx.trilha || []).slice(-6).join(" > ");
    const campos = [
        ["Erro", `${e.nome}: ${redigir(e.mensagem)}`],
        ["Origem", e.origem || "desconhecida"],
        ["Quando", ctx.quando || new Date().toISOString()],
        ["Página", ctx.url && urlSegura(ctx.url)],
        ["Tela", ctx.tela], ["Perfil", ctx.perfil], ["Versão", ctx.versao],
        ["Navegador", ctx.navegador && cortar(ctx.navegador, 140)],
        ["Viewport", ctx.viewport], ["Online", ctx.online === undefined ? "" : ctx.online ? "sim" : "não"], ["Fuso", ctx.fuso],
        ["Últimas ações", trilha],
        ["Arquivo", e.arquivo && `${urlSegura(e.arquivo)}${e.linha ? `:${e.linha}${e.coluna ? `:${e.coluna}` : ""}` : ""}`]
    ].filter(([, v]) => v);
    const cabecalho = campos.map(([k, v]) => `${k}: ${v}`).join("\n");
    const resumoTitulo = `${PREFIXO_BUG} ${e.nome}: ${redigir(e.mensagem).replace(/\s+/g, " ")}`;   // cabeçalho que a fila de TI filtra e conta
    const titulo = cortar(resumoTitulo, LIMITES.titulo);
    const descricao = cortar(`${cabecalho}${pilha ? `\n\nStack:\n${pilha}` : ""}`, LIMITES.descricaoChamado);
    const erro = { nome: e.nome, mensagem: redigir(e.mensagem), origem: e.origem || "", rota: e.rota || "", status: e.status || 0, codigo: e.codigo || "", arquivo: e.arquivo ? urlSegura(e.arquivo) : "", stack: pilha, tela: ctx.tela || "", perfil: ctx.perfil || "" };
    const paraChat = (protocolo, setor = "TI") => {
        const topo = `🛠️ ${protocolo ? `Chamado ${protocolo} aberto automaticamente.` : "Erro no aplicativo."} Preciso de ajuda do ${setor}.\n\n`;
        const corpo = campos.filter(([k]) => ["Erro", "Origem", "Quando", "Página", "Tela", "Perfil", "Versão"].includes(k)).map(([k, v]) => `${k}: ${v}`).join("\n");
        const resto = LIMITES.mensagemChat - topo.length - corpo.length - 12;
        const pilhaCurta = resto > 60 && pilha ? `\n\nStack:\n${cortar(pilha, resto)}` : "";
        return cortar(`${topo}${corpo}${pilhaCurta}`, LIMITES.mensagemChat);
    };
    return { titulo, descricao, contexto: montarContexto(e, ctx), paraChat, erro };
}
