// ==========================================================================
// ABASTECE JÁ — base compartilhada (Firebase + utilitários)
// Antes a config e os helpers eram copiados em 3 arquivos; agora é um só.
// ==========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

export const firebaseConfig = {
    apiKey: "AIzaSyA0Z1SEkqrtXuAjtFntv1WRvkKIuY1zilY",
    authDomain: "abastece-ja-240d5.firebaseapp.com",
    projectId: "abastece-ja-240d5",
    storageBucket: "abastece-ja-240d5.firebasestorage.app",
    messagingSenderId: "1061248119348",
    appId: "1:1061248119348:web:90d82ea266683086a39061",
    measurementId: "G-8XFZ5ZGK4L"
};
// URL das Cloud Functions (cole aqui depois do deploy). Vazio = pagamento ainda não conectado.
export const FUNCOES = {
    criarCobranca: "",   // ex: https://southamerica-east1-abastece-ja-240d5.cloudfunctions.net/criarCobranca
    mpConectarUrl: ""    // ex: .../mpConectarUrl
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// ---------- DOM / formatação ----------
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const brl = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const fmtData = (d) => (d ? d.split("-").reverse().join("/") : "");
export const hojeLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const vazio = (i, t, x) => `<div class="empty-state"><div class="empty-icon">${i}</div><h4>${t}</h4><p>${x}</p></div>`;
export const skeleton = (n = 3) => Array.from({ length: n }, () => '<div class="skeleton sk-card" aria-hidden="true"></div>').join("");

// ---------- toast acessível (leitor de tela anuncia) ----------
export function toast(msg, tipo = "") {
    let t = $("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); document.body.appendChild(t); }
    t.textContent = msg;
    t.className = "show " + tipo;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 4000);
}

// ---------- validadores ----------
const soDigitos = (v) => String(v || "").replace(/\D/g, "");
export function cpfValido(v) {
    const c = soDigitos(v);
    if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
    for (let t = 9; t < 11; t++) {
        let s = 0; for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i);
        if (((s * 10) % 11) % 10 !== +c[t]) return false;
    }
    return true;
}
export function cnpjValido(v) {
    const c = soDigitos(v);
    if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
    const dv = (n) => { let p = n - 7, s = 0; for (let i = 0; i < n; i++) { s += +c[i] * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return dv(12) === +c[12] && dv(13) === +c[13];
}
export const docValido = (v) => { const n = soDigitos(v).length; return n === 11 ? cpfValido(v) : n === 14 ? cnpjValido(v) : false; };

// ---------- máscaras (digitar e já formatar) ----------
export const mascaraDoc = (v) => {
    const d = soDigitos(v).slice(0, 14);
    return d.length <= 11
        ? d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2")
        : d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
};
export const mascaraTel = (v) => {
    const d = soDigitos(v).slice(0, 11);
    return d.length > 10 ? d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3") : d.length > 6 ? d.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3") : d.length > 2 ? d.replace(/(\d{2})(\d+)/, "($1) $2") : d;
};
export function aplicarMascara(id, fn) { const el = $(id); if (el) el.addEventListener("input", () => { el.value = fn(el.value); }); }

// ---------- tema: respeita o do aparelho na 1ª visita ----------
export function iniciarTema() {
    let claro = false;
    try {
        const s = localStorage.getItem("abastece_tema");
        claro = s ? s === "claro" : window.matchMedia?.("(prefers-color-scheme: light)").matches;
    } catch (e) {}
    document.body.classList.toggle("light-theme", claro);
    const tg = $("theme-toggle"); if (tg) tg.checked = claro;
}
export function alternarTema() {
    const claro = $("theme-toggle").checked;
    document.body.classList.toggle("light-theme", claro);
    try { localStorage.setItem("abastece_tema", claro ? "claro" : "escuro"); } catch (e) {}
}

export function mensagemErroAuth(error) {
    switch (error.code) {
        case "auth/unauthorized-domain": return "Domínio não autorizado no Firebase (Authentication → Settings → Domínios autorizados).";
        case "auth/operation-not-allowed": return "Login com Google não está ativado no Firebase.";
        case "auth/popup-closed-by-user":
        case "auth/cancelled-popup-request": return null;
        case "auth/network-request-failed": return "Sem conexão com a internet. Tente novamente.";
        default: return "Não foi possível entrar com o Google. (" + (error.code || "erro") + ")";
    }
}

// ---------- notificações do navegador (nova oferta, pedido aceito…) ----------
export async function pedirPermissaoNotificar() {
    try { if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission(); } catch (e) {}
}
export function notificar(titulo, corpo) {
    toast(`🔔 ${titulo}${corpo ? " — " + corpo : ""}`);
    try { if ("Notification" in window && Notification.permission === "granted" && document.hidden) new Notification(titulo, { body: corpo, icon: "icon-192.png" }); } catch (e) {}
}

// ---------- PWA: registra o service worker ----------
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

// ---------- acessibilidade: itens clicáveis (<div>) funcionam com teclado/leitor de tela ----------
window.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".nav-item, .menu-option-item, .menu-shortcut-card").forEach((el) => { el.setAttribute("role", "button"); el.tabIndex = 0; });
});
document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".nav-item, .menu-option-item, .menu-shortcut-card")) { e.preventDefault(); e.target.click(); }
});
