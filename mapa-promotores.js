// Mapa de promotores online (visão da LOJA) — estilo "carrinhos" de app de transporte.
//   • GoogleDarkMap (google-dark-map.js: Google Maps + tema dark minimalista); círculo = raio de atendimento definido pelo admin.
//   • Os dados vêm de GET /loja/promotores-proximos (o SERVIDOR filtra por raio e devolve pins anônimos). Atualiza a cada 6 s com a aba visível
//     e SÓ enquanto o cartão está na tela. Quando o raio muda (raio.js), o círculo e os pins se ajustam na hora e a lista é refeita no servidor.
//   • Sem promotores no raio: mensagem clara (sem mapa vazio mudo). Sem localização da loja: botão para definir. Sem chave do Google Maps/rede: só o contador.
//   • Todo texto entra por textContent: nada vindo do servidor vira HTML.
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, consultar } from "./firebase.js";
import { RAIO, EVENTO_RAIO } from "./raio.js";
import { GoogleDarkMap } from "./google-dark-map.js";
import { GOOGLE_MAPS_KEY } from "./config.js";

const A_CADA_MS = 6000;
// O mapa, os marcadores e o tema escuro vêm do GoogleDarkMap (google-dark-map.js). A chave está em config.js (GOOGLE_MAPS_KEY).
const CARRO = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M7 3.5h10a2 2 0 0 1 2 2V18a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18V5.5a2 2 0 0 1 2-2z" fill="#FFD13B" stroke="#1b1b1b" stroke-width="1.2"/><rect x="7" y="6" width="10" height="4" rx="1" fill="#1b1b1b" opacity=".75"/><rect x="7" y="14.5" width="10" height="3" rx="1" fill="#1b1b1b" opacity=".6"/></svg>';

const el = (tag, cls, texto) => { const e = document.createElement(tag); if (cls) e.className = cls; if (texto != null) e.textContent = texto; return e; };
const plural = (n) => (n === 1 ? "1 promotor online" : `${n} promotores online`);

export function montarMapaPromotores(raiz, { aoDefinirLocal } = {}) {
    if (!raiz) return { parar() {} };
    raiz.textContent = "";
    const topo = el("div", "mp-topo"), tit = el("div", "mp-tit"), conta = el("strong", "mp-conta", "Procurando promotores…"), sub = el("span", "muted small mp-sub");
    conta.setAttribute("aria-live", "polite"); tit.append(el("span", "mp-ico", "🚗"), conta); topo.append(tit, sub);
    const area = el("div", "mp-area"), mapaEl = el("div", "mp-mapa"), vazio = el("div", "mp-vazio"); mapaEl.setAttribute("role", "region"); mapaEl.setAttribute("aria-label", "Mapa dos promotores online por perto");
    const vazioTxt = el("p", "small"), vazioBtn = el("button", "btn btn-primary btn-sm", "Definir localização da loja"); vazioBtn.type = "button"; vazioBtn.hidden = true;
    vazioBtn.addEventListener("click", () => aoDefinirLocal?.()); vazio.append(vazioTxt, vazioBtn); vazio.hidden = true; area.append(mapaEl, vazio);
    raiz.append(topo, area, el("p", "muted small mp-credito", "Posições aproximadas (cerca de 100 m) e sem identificação, por privacidade."));

    let dm = null, lojaPin = null, ultima = null, kmDesenhado = null, timer = null, noAr = false, emVoo = false, falhaMapa = false;
    const pins = new Map();                                            // id público → marcador do mapa

    function texto(r) {
        const km = r.raioKm;
        sub.textContent = `Raio de atendimento: ${km} km`;
        if (r.semLocalizacao) { conta.textContent = "Defina onde fica a sua loja"; vazioTxt.textContent = "Para ver os promotores por perto, informe a localização da sua loja (é a mesma usada no check-in)."; vazioBtn.hidden = !aoDefinirLocal; vazio.hidden = false; return; }
        vazioBtn.hidden = true;
        if (r.total === 0) { conta.textContent = `Nenhum promotor online em até ${km} km agora`; vazioTxt.textContent = "Seu pedido continua valendo: ele fica aberto e os promotores habilitados são avisados assim que entrarem online."; vazio.hidden = false; }
        else { conta.textContent = `${plural(r.total)} em até ${km} km`; vazio.hidden = true; }
    }
    /** Chave ausente/recusada ou sem rede: some o mapa e ficam só o contador e os avisos. */
    function semMapa(e) {
        console.warn("[Mapa] indisponível:", e?.message || e);          // o motivo real (chave vazia/recusada, CSP, rede) aparece no console do navegador
        falhaMapa = true; mapaEl.hidden = true; pins.clear(); dm?.destroy(); dm = null; lojaPin = null;
        area.classList.add("mp-sem-mapa"); if (!area.querySelector(".mp-aviso-mapa")) area.prepend(el("p", "small muted mp-aviso-mapa", "Mapa indisponível no momento."));
    }
    async function garantirMapa(loja) {
        if (dm || falhaMapa) return !!dm;
        try { dm = await GoogleDarkMap.create(mapaEl, { apiKey: GOOGLE_MAPS_KEY, center: [loja.lat, loja.lng], zoom: 12, zoomControl: true, scrollWheelZoom: false, locateButton: false, onError: semMapa }); }
        catch (e) { semMapa(e); return false; }
        lojaPin = dm.addHtmlMarker({ lat: loja.lat, lng: loja.lng, className: "mp-loja", html: "<span>🏪</span>", size: [34, 34], anchor: [17, 17], interactive: false, zIndex: 500 });
        return true;
    }
    function ajustarRaio(km, loja) {
        if (!dm || kmDesenhado === km) return;
        dm.setRadius(km, [loja.lat, loja.lng], { fit: true, padding: 10 }); kmDesenhado = km;
    }
    function desenharPins(lista) {
        if (!dm) return;
        const vivos = new Set();
        for (const p of lista) {
            vivos.add(p.pin); let m = pins.get(p.pin); const rumo = Number.isFinite(p.rumo) ? p.rumo : 0;
            if (!m) {
                const carro = el("span", "mp-carro"); carro.innerHTML = CARRO; carro.style.transform = `rotate(${rumo}deg)`;   // CARRO é constante do app; o ângulo é sempre número
                m = dm.addHtmlMarker({ lat: p.lat, lng: p.lng, className: "mp-pin", element: carro, size: [30, 30], anchor: [15, 15], interactive: false, moveMs: A_CADA_MS - 1000 });
                m.element.title = `Promotor a ${String(p.distKm).replace(".", ",")} km`; pins.set(p.pin, m);
            } else {
                m.setPosition(p.lat, p.lng);                         // o marcador "anda" até a nova posição (transition em transform)
                const c = m.element.querySelector(".mp-carro"); if (c && Number.isFinite(p.rumo)) c.style.transform = `rotate(${p.rumo}deg)`;
            }
        }
        for (const [id, m] of pins) if (!vivos.has(id)) { m.remove(); pins.delete(id); }
    }
    async function desenhar(r) {
        ultima = r; texto(r);
        if (r.semLocalizacao || !r.loja) return;
        if (await garantirMapa(r.loja)) { ajustarRaio(r.raioKm, r.loja); desenharPins(r.pins || []); }
    }
    /** Efeito imediato quando o admin muda o raio: ajusta o círculo e esconde quem ficou de fora, antes mesmo da resposta do servidor. */
    function aoMudarRaio() {
        if (!ultima || ultima.semLocalizacao) return atualizar();
        const km = RAIO.raioKm, dentro = (ultima.pins || []).filter((p) => p.distKm <= km);
        desenhar({ ...ultima, raioKm: km, pins: dentro, total: dentro.length < (ultima.pins || []).length ? dentro.length : ultima.total });
        atualizar();
    }
    async function atualizar() {
        if (emVoo || document.hidden || !noAr || !auth.currentUser) return; emVoo = true;
        try { await desenhar(await consultar("loja/promotores-proximos")); }
        catch (e) { if (e.status === 403) return parar(); if (!ultima) { conta.textContent = "Não foi possível carregar o mapa agora"; sub.textContent = ""; } }
        finally { emVoo = false; }
    }
    function ligar() { if (timer) return; atualizar(); timer = setInterval(atualizar, A_CADA_MS); }
    function parar() { clearInterval(timer); timer = null; }
    const obs = typeof IntersectionObserver === "function" ? new IntersectionObserver((es) => { noAr = es.some((x) => x.isIntersecting); if (noAr && auth.currentUser) { ligar(); setTimeout(() => dm?.invalidateSize(), 100); } else parar(); }) : null;
    if (obs) obs.observe(raiz); else noAr = true;
    window.addEventListener(EVENTO_RAIO, aoMudarRaio);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) atualizar(); });
    onAuthStateChanged(auth, (u) => { if (!u) { parar(); } else if (noAr) ligar(); });
    return { parar, atualizar };
}
