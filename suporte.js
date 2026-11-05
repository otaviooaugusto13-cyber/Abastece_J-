// ============================================================
// ABASTECE JÁ — chat com o suporte (portais da loja e do promotor)
// Leitura em tempo real (onSnapshot nas coleções suporte_*, protegidas pelas regras); escrita só pela API.
// Notifica dentro do app (toast + selo no botão) e, com push ativo, também com o app fechado.
// ============================================================
import { collection, doc, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db, chamarFuncao } from "./firebase.js";
import { NOME_SUPORTE } from "./config.js";
import { linkWhatsApp, mensagemInicial, mensagemDeContinuacao } from "./suporte-canais.js";
import { esc, fmtDataHora } from "./core.js";
import { $, abrir, fechar, erro, notificar, pedirPermissaoNotificacao } from "./ui.js";
import { ativarPush, pushDisponivel } from "./push.js";

let uid = null, desligar = [], msgs = [], conv = null, anterior = null, aberto = false, enviando = false;

/**
 * Quem abre o chat é o botão central "Suporte" (#btn-suporte-plataforma, ver suporte-canais.js) — ele oferece WhatsApp OU este chat.
 * Aqui só sobram os SELOS de mensagem nova: no botão central e um pontinho no item de menu "Ajuda e suporte".
 */
function pintarSelos(n) {
    const mostrar = n > 0 && !aberto, texto = n > 9 ? "9+" : String(n);
    for (const id of ["fab-badge", "conta-badge", "dock-conta-badge"]) { const e = $(id); if (e) { e.hidden = !mostrar; e.textContent = texto; } }
    document.querySelector('.menu-item[data-abrir="sheet-ajuda"]')?.classList.toggle("com-novidade", mostrar);   // pontinho no menu
}
/** Contexto do WhatsApp conforme quem é a pessoa (a conversa já sabe se é loja ou promotor). */
const contextoAtual = () => (conv?.tipo === "promotor" ? "promotor" : "loja");

function montar() {
    if ($("sheet-suporte")) return;
    const s = document.createElement("div");
    s.id = "sheet-suporte"; s.className = "app-overlay"; s.setAttribute("aria-hidden", "true");
    s.innerHTML = `<div class="sheet" role="dialog" aria-labelledby="sup-titulo"><div class="grab"></div>
        <div class="sub-head"><div style="flex:1"><h2 id="sup-titulo">${esc(NOME_SUPORTE)}</h2><p class="muted small" style="margin:2px 0 0">Respondemos por aqui e avisamos você.</p></div><button type="button" class="icon-btn" id="sup-fechar" aria-label="Fechar">✕</button></div>
        <div id="sup-notif" class="banner mb" hidden><span class="ico">🔔</span><div class="grow">Receba um aviso quando o suporte responder.<br><button type="button" class="btn btn-ghost btn-sm mt" id="sup-ativar">Ativar avisos</button></div></div>
        <div class="chat-box" id="sup-box" aria-live="polite"></div>
        <form class="chat-send" id="sup-form"><input id="sup-input" type="text" maxlength="1000" placeholder="Escreva sua mensagem…" autocomplete="off" aria-label="Mensagem"><button class="btn btn-primary" aria-label="Enviar">➤</button></form>
        <div class="canal-troca" role="group" aria-label="Canal de atendimento"><span class="canal-troca-atual" aria-current="true">💬 Chat da plataforma</span><a id="sup-zap" class="canal-troca-outro" target="_blank" rel="noopener noreferrer" href="#">Prefiro o WhatsApp ↗</a></div></div>`;
    document.body.appendChild(s);
    atualizarLinkZap();
    // O texto do WhatsApp leva as últimas mensagens da pessoa: é calculado NO CLIQUE (o handler roda antes da navegação), então nunca fica velho.
    $("sup-zap").addEventListener("click", atualizarLinkZap);
    $("sup-fechar").addEventListener("click", fecharSuporte);
    s.addEventListener("click", (e) => { if (e.target === s) fecharSuporte(); });
    $("sup-form").addEventListener("submit", enviar);
    $("sup-ativar").addEventListener("click", async () => { if (await pedirPermissaoNotificacao()) { await ativarPush(); } avisoNotif(); });
}

/** Mostra o convite para ativar avisos só quando faz sentido (ainda não decidiu e o navegador suporta). */
function avisoNotif() { $("sup-notif").hidden = !("Notification" in window && Notification.permission === "default"); }

/** Link do WhatsApp (nova aba, URL codificada) com o contexto de quem fala e, se já houve conversa, o resumo dela. */
function atualizarLinkZap() { const a = $("sup-zap"); if (a) a.href = linkWhatsApp(mensagemDeContinuacao(msgs, contextoAtual())); }

/** Primeira tela do chat: acolhe e deixa claro que dá para escolher o canal (continuar aqui ou ir para o WhatsApp). */
function boasVindas() {
    const zap = linkWhatsApp(mensagemInicial(contextoAtual()));
    return `<div class="canal-boasvindas"><p><strong>Olá! Como podemos ajudar?</strong></p><p class="muted small">Escreva sua dúvida aqui embaixo — respondemos neste chat. Se preferir, também atendemos pelo WhatsApp.</p>
        <div class="canal-boasvindas-acoes"><button type="button" class="btn btn-primary btn-sm" data-sup-continuar>Continuar neste chat</button><a class="btn btn-ghost btn-sm" target="_blank" rel="noopener noreferrer" href="${esc(zap)}">Ir para o WhatsApp ↗</a></div></div>`;
}

function pintar() {
    const box = $("sup-box"); if (!box) return;
    atualizarLinkZap();
    box.innerHTML = msgs.length
        ? msgs.map((m) => { const eu = m.de === "usuario"; return `<div class="msg ${eu ? "msg-me" : "msg-other"}">${eu ? "" : `<small style="margin:0 0 3px;font-weight:700">${esc(NOME_SUPORTE)}</small>`}${esc(m.texto).replace(/\n/g, "<br>")}<small>${esc(fmtDataHora(m.criadoEm))}</small></div>`; }).join("")
        : boasVindas();
    box.querySelector("[data-sup-continuar]")?.addEventListener("click", () => $("sup-input")?.focus());
    box.scrollTop = box.scrollHeight;
}

let lendo = false;
async function marcarLido() {
    if (lendo || !(conv?.naoLidasUsuario > 0)) return;
    lendo = true; try { await chamarFuncao("suporte/lido", {}); } catch (e) { console.warn(e); } finally { lendo = false; }
}

async function enviar(e) {
    e.preventDefault();
    const i = $("sup-input"), texto = i.value.trim(); if (!texto || enviando) return;
    enviando = true; i.disabled = true;
    try { await chamarFuncao("suporte/mensagem", { texto }); i.value = ""; }
    catch (err) { erro(err.code === "limite-requisicoes" ? "Muitas mensagens seguidas. Aguarde um instante." : "Mensagem não enviada. Tente de novo."); }
    finally { enviando = false; i.disabled = false; i.focus(); }
}

/** Abre a conversa. Devolve false se o chat ainda não foi iniciado (quem chamou pode cair no WhatsApp). */
export function abrirSuporte(opcoes) {
    if (!uid) return false;
    aberto = true; pintar(); avisoNotif(); abrir("sheet-suporte"); $("sup-box").scrollTop = $("sup-box").scrollHeight; marcarLido();
    // `rascunho` (ex.: contestação de banimento) só PREENCHE o campo, nunca envia sozinho; não sobrescreve o que a pessoa já digitou.
    const rascunho = typeof opcoes?.rascunho === "string" ? opcoes.rascunho : "";
    if (rascunho) { const i = $("sup-input"); if (i && !i.value.trim()) { i.value = rascunho.slice(0, 1000); i.focus(); } }
    return true;
}
function fecharSuporte() { aberto = false; fechar("sheet-suporte"); }

/** O chat só existe depois do login (iniciarSuporte). Usado pelo botão central para habilitar/desabilitar a opção "Chat da plataforma". */
export const chatDisponivel = () => !!uid;

/**
 * Inicia uma conversa com o TI: abre o chat e ENVIA `texto` como mensagem (usado pelo "Falar com o TI" do painel de erro, com o relatório técnico).
 * Devolve true se a mensagem foi enviada; false se não há sessão/chat ou o envio falhou (quem chamou oferece o plano B).
 */
export async function iniciarConversaTI(texto) {
    const t = String(texto || "").trim().slice(0, 1000);    // mesmo limite do servidor (suporte/mensagem)
    if (!uid || !t) return false;
    abrirSuporte();
    try { await chamarFuncao("suporte/mensagem", { texto: t }); return true; }
    catch (err) { console.warn("suporte: envio para o TI falhou", err); erro("Não conseguimos enviar agora. Tente de novo em instantes."); return false; }
}

/** Liga o chat para o usuário logado. Chame uma vez por login (depois que o painel carregou). */
export function iniciarSuporte(u) {
    pararSuporte(); uid = u.uid; msgs = []; conv = null; anterior = null; montar();
    desligar.push(onSnapshot(doc(db, "suporte_conversas", uid), (s) => {
        conv = s.exists() ? s.data() : null;
        const n = conv?.naoLidasUsuario || 0;
        pintarSelos(n);
        if (anterior !== null && n > anterior && !(aberto && !document.hidden)) notificar(NOME_SUPORTE, conv.ultimaMsg || "Nova mensagem");   // 1º snapshot só mostra o selo
        anterior = n;
        if (aberto && !document.hidden) marcarLido();
    }, (e) => console.warn("suporte:", e.code || e)));
    desligar.push(onSnapshot(query(collection(db, "suporte_mensagens"), where("uid", "==", uid)), (s) => {
        msgs = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.id > b.id ? 1 : -1));   // o id começa pelo relógio: ordem cronológica
        if (aberto) pintar();
    }, (e) => console.warn("suporte:", e.code || e)));
    ativarPush();                                                       // se já houver permissão, registra o aparelho
    if (new URLSearchParams(location.search).get("suporte") === "1") { abrirSuporte(); history.replaceState(null, "", location.pathname); }   // veio do clique na notificação
}

/** Desliga tudo (logout/troca de conta). */
export function pararSuporte() {
    desligar.forEach((f) => f()); desligar = []; uid = null; aberto = false; msgs = []; conv = null; anterior = null;
    $("sheet-suporte")?.remove(); pintarSelos(0);
    document.querySelector('.menu-item[data-abrir="sheet-ajuda"]')?.classList.remove("com-novidade");
    document.body.classList.remove("no-scroll");
}
export { pushDisponivel };
