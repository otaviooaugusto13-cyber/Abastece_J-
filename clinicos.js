// ============================================================
// ABASTECE JÁ — página de atendimento especializado a clínicos (atendimento-clinicos.html)
// Monta o assunto, atualiza em tempo real a mensagem do WhatsApp (sempre com encodeURIComponent via linkWhatsApp)
// e aponta o chat interno para o painel (?suporte=1 já abre o chat quando a pessoa entra).
// ============================================================
import { ASSUNTOS_CLINICO, mensagemClinico, linkWhatsApp } from "./suporte-canais.js";
import { ROTAS } from "./config.js";
import { iniciarTema, alternarTema } from "./ui.js";

const $ = (id) => document.getElementById(id);
const estado = { assunto: "", unidade: "", detalhe: "" };

iniciarTema(); $("theme-toggle")?.addEventListener("change", alternarTema);

// Ícones dos canais (os mesmos do hub de suporte, para o visual ficar idêntico)
$("cli-ico-chat").innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
$("cli-ico-zap").innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0012.05 0zm5.8 16.9c-.25.7-1.45 1.34-2 1.4-.51.08-1.16.11-1.87-.12-.43-.14-.98-.32-1.69-.63-2.98-1.29-4.93-4.29-5.08-4.49-.15-.2-1.21-1.61-1.21-3.07 0-1.46.77-2.18 1.04-2.48.27-.3.6-.37.79-.37h.57c.18.01.43-.07.67.51.25.6.84 2.06.92 2.21.07.15.12.32.02.52-.1.2-.15.32-.3.5-.15.17-.31.38-.45.51-.15.15-.3.3-.13.6.17.3.76 1.25 1.63 2.03 1.12 1 2.06 1.3 2.36 1.45.3.15.47.12.64-.07.18-.2.74-.86.94-1.16.2-.3.4-.25.67-.15.27.1 1.73.82 2.03.97.3.15.5.22.57.35.07.12.07.72-.18 1.42z"/></svg>';

// Assuntos: botões "radio" acessíveis (role=radio + setas do teclado)
const grupo = $("cli-assuntos");
grupo.innerHTML = "";
ASSUNTOS_CLINICO.forEach((a, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "cli-assunto"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", "false"); b.dataset.v = a.v; b.tabIndex = i === 0 ? 0 : -1;
    const ico = document.createElement("span"); ico.className = "cli-assunto-ico"; ico.setAttribute("aria-hidden", "true"); ico.textContent = a.i;
    b.append(ico, document.createTextNode(a.r));
    b.addEventListener("click", () => escolher(a.v));
    grupo.appendChild(b);
});
grupo.addEventListener("keydown", (e) => {
    const bs = [...grupo.querySelectorAll("[role=radio]")], i = bs.indexOf(document.activeElement);
    if (i < 0 || !["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return;
    e.preventDefault(); const prox = bs[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : bs.length - 1)) % bs.length]; prox.focus(); escolher(prox.dataset.v);
});
function escolher(v) {
    estado.assunto = v;
    grupo.querySelectorAll("[role=radio]").forEach((b) => { const on = b.dataset.v === v; b.setAttribute("aria-checked", String(on)); b.classList.toggle("sel", on); b.tabIndex = on ? 0 : -1; });
    atualizar();
}

/** Recalcula a mensagem e todos os links. Chamado a cada alteração: o href nunca fica desatualizado, nem para quem abre com clique do meio. */
function atualizar() {
    const msg = mensagemClinico(estado);
    $("cli-previa").textContent = msg;
    $("cli-zap").href = linkWhatsApp(msg);                       // nova aba (target=_blank no HTML) + encodeURIComponent
    const loja = `${ROTAS.loja}?suporte=1`, prom = `${ROTAS.promotor}?suporte=1`;
    $("cli-chat-loja").href = loja; $("cli-chat-prom").href = prom; $("cli-chat").href = loja;
}
$("cli-unidade").addEventListener("input", (e) => { estado.unidade = e.target.value; atualizar(); });
$("cli-detalhe").addEventListener("input", (e) => { estado.detalhe = e.target.value; $("cli-contador").textContent = `${e.target.value.length}/300`; atualizar(); });

escolher("cadastro");
