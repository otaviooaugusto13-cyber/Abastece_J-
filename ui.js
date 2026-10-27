// Utilidades de interface compartilhadas: toast, tema, máscaras, modal, service worker.
import { esc } from "./core.js";

export const $ = (id) => document.getElementById(id);

export function toast(msg, tipo = "info") {
    let box = $("toast-area");
    if (!box) {
        box = document.createElement("div");
        box.id = "toast-area";
        box.setAttribute("role", "status");
        box.setAttribute("aria-live", "polite");
        document.body.appendChild(box);
    }
    const t = document.createElement("div");
    t.className = `toast toast-${tipo}`;
    const ico = { ok: "✓", erro: "!", info: "i" }[tipo] || "i";
    t.innerHTML = `<span class="toast-ico">${ico}</span><span>${esc(msg)}</span>`;
    box.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, tipo === "erro" ? 5500 : 3500);
}
export const ok = (m) => toast(m, "ok");
export const erro = (m) => toast(m, "erro");

// ---- Tema: segue o sistema por padrão; escolha manual fica salva ----
export function iniciarTema() {
    let t = null;
    try { t = localStorage.getItem("abastece_tema"); } catch (e) {}
    const claro = t ? t === "claro" : window.matchMedia?.("(prefers-color-scheme: light)").matches;
    document.body.classList.toggle("light-theme", !!claro);
    const cb = $("theme-toggle"); if (cb) cb.checked = !!claro;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", claro ? "#f6f7fb" : "#07090e");
}
export function alternarTema() {
    const claro = $("theme-toggle").checked;
    document.body.classList.toggle("light-theme", claro);
    try { localStorage.setItem("abastece_tema", claro ? "claro" : "escuro"); } catch (e) {}
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", claro ? "#f6f7fb" : "#07090e");
}

// ---- Máscaras: <input data-mask="cpf|cnpj|doc|tel"> ----
export function ligarMascaras(mapa) {
    document.querySelectorAll("input[data-mask]").forEach((el) => {
        const fn = mapa[el.dataset.mask];
        if (fn) el.addEventListener("input", () => { el.value = fn(el.value); });
    });
}

// ---- Modal/subtela acessível ----
export function abrir(id) { const e = $(id); if (!e) return; e.classList.add("active"); e.removeAttribute("aria-hidden"); e.querySelector("input,select,textarea,button")?.focus?.({ preventScroll: true }); document.body.classList.add("no-scroll"); }
export function fechar(id) { const e = $(id); if (!e) return; e.classList.remove("active"); e.setAttribute("aria-hidden", "true"); if (!document.querySelector(".app-overlay.active")) document.body.classList.remove("no-scroll"); }
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") document.querySelectorAll(".app-overlay.active").forEach((e) => fechar(e.id)); });

// ---- Skeletons e estados vazios ----
export const skeleton = (n = 3) => Array.from({ length: n }, () => '<div class="skeleton"></div>').join("");
export const vazio = (icone, titulo, texto, acao = "") => `<div class="empty-state"><div class="empty-icon">${icone}</div><h4>${esc(titulo)}</h4><p>${esc(texto)}</p>${acao}</div>`;

// ---- PWA ----
export function registrarSW() {
    if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
let promptInstalar = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); promptInstalar = e; document.querySelectorAll(".btn-instalar").forEach((b) => (b.hidden = false)); });
export async function instalarApp() { if (!promptInstalar) return toast("Use o menu do navegador → “Adicionar à tela inicial”."); promptInstalar.prompt(); promptInstalar = null; }

// ---- Notificação do navegador (quando o pedido muda de estado) ----
export async function pedirPermissaoNotificacao() {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
}
export function notificar(titulo, corpo) {
    toast(`${titulo} — ${corpo}`, "ok");
    try { if ("Notification" in window && Notification.permission === "granted" && document.hidden) new Notification(titulo, { body: corpo, icon: "icons/icon-192.png" }); } catch (e) {}
    try { navigator.vibrate?.(120); } catch (e) {}
}

export function baixarCSV(nome, linhas) {
    const csv = "﻿" + linhas.map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
