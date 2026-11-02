// ============================================================
// ABASTECE JÁ — captura GLOBAL de erros + chamado automático + botão "Falar com o TI"
//
// Carregue ESTE arquivo ANTES de qualquer outro script da página (<script type="module" src="erros-globais.js">).
// Ele só depende de erros-nucleo.js e suporte-canais.js (ambos sem Firebase): se o CDN do Firebase cair, o capturador continua de pé.
// firebase.js e suporte.js são carregados sob demanda (import dinâmico) e qualquer falha neles cai em um plano B.
//
// Fluxo, para qualquer erro não tratado (window "error", "unhandledrejection") ou erro 500 da API:
//   1. normaliza e descarta ruído do navegador/extensões; agrupa repetições (mesma "impressão" = um painel só);
//   2. mostra NA HORA o painel tranquilizador ("já abrimos um chamado") enquanto o chamado é criado;
//   3. POST /chamados/automatico → protocolo sequencial (TI-000123) aparece no painel;
//   4. "Falar com o TI" abre o chat e envia o relatório técnico; sem sessão/chat, abre o WhatsApp com o mesmo relatório;
//   5. sem rede/sem login: o relatório fica numa fila local e é enviado sozinho quando houver sessão.
// NADA aqui pode lançar para fora: cada caminho tem try/catch e o app continua funcionando.
// ============================================================
import { normalizar, ehRuido, impressao, montarRelatorio, redigir } from "./erros-nucleo.js";
import { linkWhatsApp } from "./suporte-canais.js";

const VERSAO_APP = "abastece-v15";                 // mantenha igual ao VERSAO do sw.js
const FILA_CHAVE = "abastece_erros_pendentes";
const MAX_PAINEIS_POR_MIN = 3, MAX_FILA = 5, FILA_VALIDADE_MS = 7 * 24 * 3600_000, TEMPO_CHAMADO_MS = 12_000;

const vistos = new Set();                          // impressões já tratadas nesta sessão do navegador
const paineisRecentes = [];                        // timestamps dos últimos painéis (freio contra tempestade de erros)
const trilha = [];                                 // últimas ações do usuário: só seletor do elemento, nunca o texto digitado
let dentro = false, painelAtual = null;

// ---------------- contexto técnico ----------------
const seletor = (n) => (n?.id ? `#${n.id}` : n?.tagName ? `${n.tagName.toLowerCase()}${typeof n.className === "string" && n.className ? "." + n.className.trim().split(/\s+/)[0] : ""}` : "");
try { document.addEventListener("click", (ev) => { const s = seletor(ev.target?.closest?.("button,a,[data-abrir],[data-tab],input,label") || ev.target); if (s) { trilha.push(s.slice(0, 50)); if (trilha.length > 10) trilha.shift(); } }, true); } catch { /* sem DOM: sem trilha */ }

function perfilDaPagina() { const p = location.pathname; return /promotor/i.test(p) ? "promotor" : /painel-loja|index|\/$/i.test(p) ? "loja" : /admin/i.test(p) ? "admin" : "publico"; }
function coletarContexto() {
    const c = { quando: new Date().toISOString(), url: location.href, versao: VERSAO_APP, perfil: perfilDaPagina(), trilha: [...trilha] };
    try { c.tela = document.querySelector(".screen.active")?.id || ""; } catch { /* ignora */ }
    try { c.navegador = navigator.userAgent; c.online = navigator.onLine; c.viewport = `${innerWidth}x${innerHeight}`; c.fuso = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* ignora */ }
    return c;
}

// ---------------- chamado ----------------
const comLimite = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("tempo esgotado"), { code: "tempo" })), ms))]);

/** Abre o chamado no servidor. Devolve { protocolo } ou lança (sem sessão, sem rede, 429…) — quem chama decide o plano B. */
async function abrirChamado({ imp, titulo, descricao }) {
    const fb = await import("./firebase.js");
    await comLimite(fb.aguardarAuth(), 6000);
    if (!fb.auth.currentUser) throw Object.assign(new Error("sem sessão"), { code: "sem-sessao" });
    const r = await comLimite(fb.chamarFuncao("chamados/automatico", { impressao: imp, titulo, descricao }), TEMPO_CHAMADO_MS);
    if (!r?.protocolo) throw new Error("resposta sem protocolo");
    return r;
}

// Fila local: guarda o relatório quando não dá para abrir o chamado agora (sem login/sem rede).
const lerFila = () => { try { const a = JSON.parse(localStorage.getItem(FILA_CHAVE) || "[]"); return Array.isArray(a) ? a.filter((x) => x && Date.now() - x.em < FILA_VALIDADE_MS) : []; } catch { return []; } };
const gravarFila = (a) => { try { localStorage.setItem(FILA_CHAVE, JSON.stringify(a.slice(-MAX_FILA))); } catch { /* storage bloqueado: segue sem fila */ } };
function enfileirar(item) { const f = lerFila(); if (!f.some((x) => x.imp === item.imp)) { f.push({ ...item, em: Date.now() }); gravarFila(f); } }

let enviandoFila = false;
/** Reenvia o que ficou pendente. Silencioso; se houver sucesso, mostra o painel com o protocolo para a pessoa não ficar sem saber. */
async function enviarPendentes() {
    if (enviandoFila) return; enviandoFila = true;
    try {
        const fila = lerFila(); if (!fila.length) return;
        const restantes = []; let ultimo = null;
        for (let i = 0; i < fila.length; i++) {
            try { const r = await abrirChamado(fila[i]); ultimo = { ...fila[i], protocolo: r.protocolo }; }
            catch (e) {
                restantes.push(fila[i]);
                if (e.code === "sem-sessao" || e.code === "rede" || e.code === "tempo") { restantes.push(...fila.slice(i + 1)); break; }   // sem sessão/rede: guarda o resto e tenta depois
            }
        }
        gravarFila(restantes);
        if (ultimo) mostrarPainel({ estado: "aberto", protocolo: ultimo.protocolo, relatorio: relatorioArmazenado(ultimo), posterior: true });
    } catch (e) { console.warn("[erros-globais] fila:", e); } finally { enviandoFila = false; }
}
const relatorioArmazenado = (it) => ({ titulo: it.titulo, descricao: it.descricao, paraChat: (p) => `🛠️ Chamado ${p} aberto automaticamente. Preciso de ajuda do TI.\n\n${it.descricao}`.slice(0, 1000) });

// ---------------- interface ----------------
const el = (tag, cls, texto) => { const e = document.createElement(tag); if (cls) e.className = cls; if (texto != null) e.textContent = texto; return e; };
const ICONE = { ok: "✓", espera: "…", aviso: "!" };

function fecharPainel() { painelAtual?.remove(); painelAtual = null; }

/**
 * Desenha (ou redesenha) o painel. Tudo por textContent/DOM: o texto do erro NUNCA entra como HTML (sem XSS).
 *   estado: "abrindo" | "aberto" | "pendente"
 */
function mostrarPainel({ estado, protocolo = "", relatorio, posterior = false, avisoChat = "" }) {
    fecharPainel();
    const p = el("section", `erro-chamado erro-${estado}`); p.id = "erro-chamado"; p.setAttribute("role", "alert"); p.setAttribute("aria-live", "assertive"); p.setAttribute("aria-labelledby", "erro-titulo");
    const topo = el("div", "erro-topo");
    topo.append(el("span", "erro-ico", estado === "aberto" ? ICONE.ok : estado === "abrindo" ? ICONE.espera : ICONE.aviso));
    const textos = el("div", "erro-textos");
    const h = el("h2", null, estado === "pendente" ? "Anotamos o problema" : "Tivemos um imprevisto — e já estamos cuidando disso"); h.id = "erro-titulo";
    const msg = el("p", "muted small");
    msg.textContent = estado === "abrindo" ? "Abrindo um chamado automaticamente para a equipe de TI…"
        : estado === "aberto" ? (posterior ? "Um erro ocorrido antes agora virou chamado. Você não precisa fazer nada." : "Acabamos de abrir um chamado automaticamente para a equipe de TI. Você não precisa fazer nada — mas, se quiser, pode falar com a gente agora.")
        : "O problema foi registrado neste aparelho. Assim que você estiver conectado e com a conta aberta, o chamado é criado sozinho. Se for urgente, fale com o TI.";
    textos.append(h, msg);
    const x = el("button", "icon-btn erro-fechar", "✕"); x.type = "button"; x.setAttribute("aria-label", "Fechar aviso"); x.addEventListener("click", fecharPainel);
    topo.append(textos, x); p.append(topo);

    if (estado === "abrindo") { const l = el("div", "erro-carregando"); l.setAttribute("aria-hidden", "true"); p.append(l); }
    if (estado === "aberto" && protocolo) {
        const box = el("div", "erro-protocolo"); box.append(el("span", "muted small", "Número do chamado"));
        const linha = el("div", "erro-protocolo-linha"), num = el("strong", "erro-numero", protocolo);
        const cp = el("button", "btn btn-ghost btn-sm", "Copiar"); cp.type = "button";
        cp.addEventListener("click", async () => { try { await navigator.clipboard.writeText(protocolo); cp.textContent = "Copiado ✓"; } catch { cp.textContent = "Selecione e copie"; } setTimeout(() => (cp.textContent = "Copiar"), 2200); });
        linha.append(num, cp); box.append(linha); p.append(box);
    }
    if (avisoChat) p.append(el("p", "small erro-aviso", avisoChat));

    const acoes = el("div", "erro-acoes");
    if (relatorio && estado !== "abrindo") acoes.append(botaoTI(p, relatorio, estado === "aberto" ? protocolo : ""));
    const rec = el("button", "btn btn-ghost", "Recarregar a página"); rec.type = "button"; rec.addEventListener("click", () => location.reload());
    const seguir = el("button", "btn btn-ghost", "Continuar usando"); seguir.type = "button"; seguir.addEventListener("click", fecharPainel);
    acoes.append(rec, seguir); p.append(acoes);

    if (relatorio?.descricao) {   // transparência: a pessoa vê exatamente o que foi enviado
        const d = el("details", "erro-detalhes"); d.append(el("summary", null, "Ver detalhes técnicos"));
        const pre = el("pre"); pre.textContent = relatorio.descricao; d.append(pre); p.append(d);
    }
    document.body.appendChild(p); painelAtual = p;
    p.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharPainel(); });
    return p;
}

/**
 * Botão "Falar com o TI". Com sessão: abre o chat e envia o relatório como primeira mensagem.
 * Sem sessão (ou se o chat falhar): vira um LINK do WhatsApp com o mesmo relatório, que abre em nova aba (target=_blank).
 */
function botaoTI(painel, relatorio, protocolo) {
    const texto = relatorio.paraChat(protocolo);
    const comoLink = (rotulo) => { const a = el("a", "btn btn-primary erro-ti", rotulo); a.href = linkWhatsApp(texto); a.target = "_blank"; a.rel = "noopener noreferrer"; return a; };
    if (!protocolo) return comoLink("Falar com o TI");                            // sem chamado → sem sessão confiável: WhatsApp direto
    const b = el("button", "btn btn-primary erro-ti", "Falar com o TI"); b.type = "button";
    b.addEventListener("click", async () => {
        b.disabled = true; b.textContent = "Abrindo conversa…";
        try {
            const s = await import("./suporte.js");
            if (await s.iniciarConversaTI(texto)) { fecharPainel(); return; }
            throw new Error("chat indisponível");
        } catch (e) {
            console.warn("[erros-globais] chat do TI:", e);
            const a = comoLink("Falar com o TI pelo WhatsApp"); b.replaceWith(a);
            painel.insertBefore(el("p", "small erro-aviso", "Não conseguimos abrir o chat agora. Use o botão abaixo: a mensagem já vai pronta no WhatsApp."), painel.querySelector(".erro-acoes"));
        }
    });
    return b;
}

// ---------------- tratamento central ----------------
/**
 * Ponto único de entrada. Também exposto como window.AbasteceErros.reportar(erro, { origem }) para blocos try/catch do app
 * que queiram transformar uma falha tratada em chamado.
 */
export async function reportarErro(causa, origem = "manual", extra = {}) {
    if (dentro) return; dentro = true;
    let e, imp, rel;
    try {
        e = normalizar(causa, { origem, ...extra });
        if (ehRuido(e)) return;
        imp = impressao(e); if (vistos.has(imp)) return; vistos.add(imp);
        console.error("[erros-globais]", causa);                                      // o console continua mostrando o erro original
        const agora = Date.now(); while (paineisRecentes.length && agora - paineisRecentes[0] > 60_000) paineisRecentes.shift();
        const silencioso = paineisRecentes.length >= MAX_PAINEIS_POR_MIN;             // tempestade de erros: abre o chamado, mas sem empilhar painéis
        if (!silencioso) paineisRecentes.push(agora);
        rel = montarRelatorio(e, coletarContexto());
        if (!silencioso) mostrarPainel({ estado: "abrindo", relatorio: null });
        dentro = false;
        try {
            const r = await abrirChamado({ imp, titulo: rel.titulo, descricao: rel.descricao });
            if (!silencioso) mostrarPainel({ estado: "aberto", protocolo: r.protocolo, relatorio: rel });
        } catch (falha) {
            enfileirar({ imp, titulo: rel.titulo, descricao: rel.descricao });
            console.warn("[erros-globais] chamado adiado:", falha?.code || falha?.message);
            if (!silencioso) mostrarPainel({ estado: "pendente", relatorio: rel });
        }
    } catch (interno) {
        console.error("[erros-globais] falha no próprio tratamento (ignorada):", interno);   // fallback seguro: nunca propaga
    } finally { dentro = false; }
}

// ---------------- ligação global ----------------
try {
    window.addEventListener("error", (ev) => {
        if (ev.target && ev.target !== window) return;                                // falha de <img>/<script>: não é exceção
        reportarErro(ev.error || ev.message, "window.onerror", { arquivo: ev.filename, linha: ev.lineno, coluna: ev.colno });
    });
    window.addEventListener("unhandledrejection", (ev) => { reportarErro(ev.reason, "unhandledrejection"); });
    // firebase.js dispara este evento quando a API responde 500 (erro do nosso servidor). Erros de validação (400/404/429) são esperados e NÃO viram chamado.
    window.addEventListener("abastece:erro-api", (ev) => {
        const d = ev.detail || {}; const err = Object.assign(new Error(`${d.rota || "API"}: ${redigir(d.mensagem || "erro interno")}`), { name: "ApiError", code: d.codigo, status: d.status });
        reportarErro(err, "api");
    });
    window.addEventListener("online", () => setTimeout(enviarPendentes, 1500));
    setTimeout(enviarPendentes, 5000);                                              // depois que o app restaurou a sessão
    window.AbasteceErros = { reportar: reportarErro, enviarPendentes };
} catch (e) { console.error("[erros-globais] não foi possível instalar os handlers:", e); }
