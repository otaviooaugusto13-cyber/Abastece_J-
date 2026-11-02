// ============================================================
// ABASTECE JÁ — canais de atendimento (chat da plataforma × WhatsApp) + botão central "Suporte"
//
// Este módulo NÃO importa suporte.js (o chat importa este): quem precisa abrir o chat entrega a função `abrirChat`.
// Assim não há dependência circular e o hub funciona até na tela de login (onde o chat interno ainda não existe).
//
// Parte PURA (sem DOM, testável em Node): CONTEXTOS, mensagemInicial, linkWhatsApp, mensagemDeContinuacao.
// Parte de INTERFACE: abrirEscolhaDeCanal, ligarBotaoSuporte.
// ============================================================
import { WHATSAPP_SUPORTE, NOME_SUPORTE } from "./config.js";

/** Texto inicial do WhatsApp por contexto de quem está pedindo ajuda. */
export const CONTEXTOS = {
    loja: "Olá! Preciso de ajuda no Abastece Já (loja).",
    promotor: "Olá! Preciso de ajuda no Abastece Já (promotor).",
    clinico: "Olá! Sou da área clínica e preciso de atendimento especializado no Abastece Já.",
    login: "Olá! Preciso de ajuda para entrar no Abastece Já.",
    bloqueado: "Olá! Minha conta no Abastece Já está bloqueada. Pode me ajudar?",
    geral: "Olá! Preciso de ajuda no Abastece Já."
};
/** Um link wa.me aceita centenas de caracteres, mas apps e navegadores cortam URLs enormes: o texto é limitado antes de codificar. */
export const LIMITE_TEXTO_WHATSAPP = 1500;

export const mensagemInicial = (contexto = "geral") => CONTEXTOS[contexto] || CONTEXTOS.geral;

/**
 * Link do WhatsApp com a mensagem já preenchida. SEMPRE codificado com encodeURIComponent.
 * Quem usa deve abrir com target="_blank" rel="noopener noreferrer" (nova aba, sem dar acesso à janela de origem).
 */
export function linkWhatsApp(mensagem = CONTEXTOS.geral, numero = WHATSAPP_SUPORTE) {
    const texto = String(mensagem || "").slice(0, LIMITE_TEXTO_WHATSAPP);
    return `https://wa.me/${String(numero).replace(/\D/g, "")}?text=${encodeURIComponent(texto)}`;
}

/** Assuntos do atendimento especializado a clínicos (atendimento-clinicos.html). `v` é o valor técnico; `r` o rótulo mostrado. */
export const ASSUNTOS_CLINICO = [
    { v: "cadastro", r: "Cadastro e habilitação", i: "🪪" }, { v: "agenda", r: "Agenda e turnos", i: "📅" }, { v: "pagamentos", r: "Pagamentos e repasses", i: "💳" },
    { v: "documentos", r: "Documentos e notas", i: "🧾" }, { v: "acesso", r: "Acesso à conta", i: "🔐" }, { v: "outro", r: "Outro assunto", i: "💬" }
];
/** Mensagem do WhatsApp do atendimento a clínicos, com assunto, unidade e detalhe opcionais (texto livre limitado para a URL não estourar). */
export function mensagemClinico({ assunto = "outro", unidade = "", detalhe = "" } = {}) {
    const a = ASSUNTOS_CLINICO.find((x) => x.v === assunto) || ASSUNTOS_CLINICO[ASSUNTOS_CLINICO.length - 1];
    const lim = (t, n) => String(t || "").replace(/\s+/g, " ").trim().slice(0, n);
    const linhas = [CONTEXTOS.clinico, "", `Assunto: ${a.r}`];
    if (lim(unidade, 80)) linhas.push(`Clínica/unidade: ${lim(unidade, 80)}`);
    if (lim(detalhe, 300)) linhas.push(`Detalhes: ${lim(detalhe, 300)}`);
    return linhas.join("\n");
}

/**
 * Ao trocar do chat para o WhatsApp, leva as últimas mensagens da pessoa junto, para ela não repetir tudo.
 * `msgs`: [{ de: "usuario" | "suporte", texto }] em ordem cronológica.
 */
export function mensagemDeContinuacao(msgs, contexto = "geral", maxMsgs = 3) {
    const minhas = (msgs || []).filter((m) => m.de === "usuario" && m.texto).slice(-maxMsgs).map((m) => `• ${String(m.texto).replace(/\s+/g, " ").trim().slice(0, 240)}`);
    if (!minhas.length) return mensagemInicial(contexto);
    return `${mensagemInicial(contexto)}\n\nEstou continuando a conversa do chat do app:\n${minhas.join("\n")}`;
}

// ---------------- interface ----------------
const ICONE_ZAP = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>';
const ICONE_CHAT = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, texto) => { const e = document.createElement(tag); if (cls) e.className = cls; if (texto != null) e.textContent = texto; return e; };

/** Abre/fecha usando a mesma convenção dos outros "sheets" do app (classe .active, aria-hidden, trava de rolagem). */
function abrirFolha(f) { f.classList.add("active"); f.removeAttribute("aria-hidden"); document.body.classList.add("no-scroll"); }
function fecharFolha(f) { f.classList.remove("active"); f.setAttribute("aria-hidden", "true"); if (!document.querySelector(".app-overlay.active")) document.body.classList.remove("no-scroll"); }

/**
 * Folha "Como prefere ser atendido?". Monta uma vez e reaproveita; a cada abertura atualiza o texto do WhatsApp e o estado do chat.
 *   contexto:        chave de CONTEXTOS
 *   abrirChat:       () => boolean — abre o chat da plataforma; devolve false se ele não está disponível (sem login)
 *   chatDisponivel:  () => boolean — para desabilitar a opção do chat ANTES do clique (padrão: considera disponível)
 *   mensagem:        substitui o texto padrão do WhatsApp (ex.: relatório de erro)
 */
export function abrirEscolhaDeCanal({ contexto = "geral", abrirChat = () => false, chatDisponivel = () => true, mensagem } = {}) {
    let f = $("sheet-canal");
    if (!f) {
        f = el("div", "app-overlay"); f.id = "sheet-canal"; f.setAttribute("aria-hidden", "true");
        f.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="canal-titulo"><div class="grab"></div>
            <div class="sub-head"><div style="flex:1"><h2 id="canal-titulo">Suporte da plataforma</h2><p class="muted small" style="margin:2px 0 0">Como você prefere ser atendido?</p></div><button type="button" class="icon-btn" data-canal-fechar aria-label="Fechar">✕</button></div>
            <div class="canal-lista">
                <button type="button" class="canal-opcao" id="canal-chat"><span class="canal-ico canal-ico-chat"></span><span class="canal-txt"><strong>Chat da plataforma</strong><small id="canal-chat-dica"></small></span><span class="seta" aria-hidden="true">›</span></button>
                <a class="canal-opcao" id="canal-zap" target="_blank" rel="noopener noreferrer" href="#"><span class="canal-ico canal-ico-zap"></span><span class="canal-txt"><strong>WhatsApp</strong><small>Abre em outra aba, com a mensagem já escrita.</small></span><span class="seta" aria-hidden="true">↗</span></a>
            </div>
            <p class="muted small center mt">Atendimento por ${NOME_SUPORTE}. Você pode trocar de canal quando quiser.</p></div>`;
        f.querySelector(".canal-ico-chat").innerHTML = ICONE_CHAT; f.querySelector(".canal-ico-zap").innerHTML = ICONE_ZAP;
        document.body.appendChild(f);
        f.addEventListener("click", (e) => { if (e.target === f || e.target.closest("[data-canal-fechar]")) fecharFolha(f); });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape" && f.classList.contains("active")) fecharFolha(f); });
    }
    // Estado dependente da chamada atual (nunca guardado entre aberturas).
    const texto = mensagem || mensagemInicial(contexto);
    const zap = $("canal-zap"), chat = $("canal-chat"), dica = $("canal-chat-dica");
    zap.href = linkWhatsApp(texto);
    zap.onclick = () => fecharFolha(f);                                       // o link abre em nova aba; esta folha fecha
    let disponivel = false;
    try { disponivel = !!chatDisponivel(); } catch { disponivel = false; }
    chat.disabled = !disponivel;
    dica.textContent = disponivel ? "Responde aqui mesmo e avisa você." : "Entre na sua conta para usar o chat.";
    chat.onclick = () => { fecharFolha(f); if (!abrirChat()) window.open(linkWhatsApp(texto), "_blank", "noopener,noreferrer"); };   // sem chat → cai no WhatsApp
    abrirFolha(f); (disponivel ? chat : zap).focus?.({ preventScroll: true });
    return f;
}

/**
 * Liga o botão central flutuante (#btn-suporte-plataforma). Ele substitui o antigo botão verde do WhatsApp:
 * em vez de ir direto para o WhatsApp, abre a escolha entre WhatsApp e chat interno.
 * Devolve a função que abre a folha (útil para outros pontos de entrada, como o item "Ajuda e suporte").
 */
export function ligarBotaoSuporte({ contexto = "geral", abrirChat, chatDisponivel } = {}) {
    const abrir = (ev) => {
        const origem = ev?.currentTarget?.closest?.(".app-overlay.active");   // clicou dentro de outra folha (ex.: Ajuda)? ela fecha: nunca duas abertas
        if (origem) fecharFolha(origem);
        abrirEscolhaDeCanal({ contexto, abrirChat, chatDisponivel });
    };
    for (const b of document.querySelectorAll("[data-suporte-plataforma]")) b.addEventListener("click", abrir);
    return abrir;
}
