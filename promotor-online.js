// "Aparecer para lojas próximas" (promotor): envia a posição a cada ~10 s enquanto o app está ABERTO e o interruptor ligado.
// O servidor mostra o promotor no mapa das lojas que estão dentro do raio definido pelo admin (pin anônimo, posição aproximada) e o tira do mapa
// sozinho 45 s depois do último sinal (app fechado, sem rede, bateria). A escolha fica salva neste aparelho.
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, chamarFuncao } from "./firebase.js";
import { distanciaM, rumoRad } from "./geo.js";
import { RAIO, EVENTO_RAIO } from "./raio.js";

const CHAVE = "abastece_online_v1", ENVIO_MS = 10_000;
const el = (tag, cls, texto) => { const e = document.createElement(tag); if (cls) e.className = cls; if (texto != null) e.textContent = texto; return e; };
const MSG_GPS = { 1: "Libere a localização deste site nas configurações do navegador para aparecer no mapa.", 2: "Não conseguimos obter sua posição. Vá para um local aberto.", 3: "O GPS demorou para responder. Tentando de novo…" };

export function montarOnline(raiz) {
    if (!raiz) return;
    raiz.className = "card online-card"; raiz.textContent = "";
    const texto = el("div", "grow"), tit = el("strong", null, "Aparecer para lojas próximas"), est = el("p", "muted small"); est.setAttribute("aria-live", "polite"); texto.append(tit, est);
    const sw = el("input", "online-sw"); sw.type = "checkbox"; sw.setAttribute("role", "switch"); sw.setAttribute("aria-label", "Aparecer para lojas próximas"); raiz.append(texto, sw);

    let watch = null, timer = null, fix = null, anterior = null, ligado = false, erro = "";
    const pintar = () => {
        sw.checked = ligado;
        est.textContent = erro || (ligado ? (fix ? `Você está online: lojas em até ${RAIO.raioKm} km veem você no mapa. Mantenha o app aberto.` : "Buscando sua posição…") : "Offline: nenhuma loja vê você no mapa. Ligue para receber chamados mais rápido.");
    };
    async function enviar() {
        if (!ligado || !fix || document.hidden || !auth.currentUser) return;
        try { await chamarFuncao("promotor/online", { online: true, lat: fix.lat, lng: fix.lng, rumo: fix.rumo, precisao: fix.precisao }); erro = ""; }
        catch (e) { if (e.code === "promotor-nao-habilitado") { erro = e.message; parar(false); } else if (e.code !== "rede") erro = ""; }
        pintar();
    }
    function iniciar() {
        if (!("geolocation" in navigator)) { erro = "Este aparelho não oferece geolocalização."; return pintar(); }
        ligado = true; erro = "";
        watch = navigator.geolocation.watchPosition((p) => {
            const atual = { lat: p.coords.latitude, lng: p.coords.longitude, precisao: Math.round(p.coords.accuracy) };
            let rumo = Number.isFinite(p.coords.heading) ? p.coords.heading : null;                                  // sem bússola: calcula pelo deslocamento
            if (rumo === null && anterior && distanciaM(anterior, atual) > 15) rumo = ((rumoRad(anterior, atual) * 180) / Math.PI + 360) % 360;
            if (!anterior || distanciaM(anterior, atual) > 15) anterior = atual;
            fix = { ...atual, rumo: rumo === null ? (fix?.rumo ?? null) : rumo }; erro = ""; pintar();
        }, (e) => { erro = MSG_GPS[e.code] || MSG_GPS[2]; if (e.code === 1) parar(false); pintar(); }, { enableHighAccuracy: false, maximumAge: 5000, timeout: 20000 });
        timer = setInterval(enviar, ENVIO_MS); setTimeout(enviar, 1500); pintar();
    }
    function parar(avisarServidor = true) {
        if (watch !== null) navigator.geolocation.clearWatch(watch); watch = null; clearInterval(timer); timer = null; ligado = false; fix = null; anterior = null;
        if (avisarServidor && auth.currentUser) chamarFuncao("promotor/online", { online: false }).catch(() => {});      // se falhar, o servidor tira o promotor sozinho em 45 s
        pintar();
    }
    sw.addEventListener("change", () => { try { localStorage.setItem(CHAVE, sw.checked ? "1" : "0"); } catch (e) { /* ignora */ } sw.checked ? iniciar() : parar(); });
    window.addEventListener(EVENTO_RAIO, pintar);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) enviar(); });
    onAuthStateChanged(auth, (u) => { if (!u) { parar(false); return; } let salvo = "0"; try { salvo = localStorage.getItem(CHAVE) || "0"; } catch (e) { /* ignora */ } if (salvo === "1" && !ligado) iniciar(); else pintar(); });
    pintar();
}
