// Mapa de promotores online (visão da LOJA) — estilo "carrinhos" de app de transporte.
//   • Leaflet (carregado sob demanda do cdnjs) + blocos do CARTO/OpenStreetMap; círculo = raio de atendimento definido pelo admin.
//   • Os dados vêm de GET /loja/promotores-proximos (o SERVIDOR filtra por raio e devolve pins anônimos). Atualiza a cada 6 s com a aba visível
//     e SÓ enquanto o cartão está na tela. Quando o raio muda (raio.js), o círculo e os pins se ajustam na hora e a lista é refeita no servidor.
//   • Sem promotores no raio: mensagem clara (sem mapa vazio mudo). Sem localização da loja: botão para definir. Sem Leaflet/rede: só o contador.
//   • Todo texto entra por textContent: nada vindo do servidor vira HTML.
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, consultar } from "./firebase.js";
import { RAIO, EVENTO_RAIO } from "./raio.js";

const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet", A_CADA_MS = 6000;
// CARTO passou a exigir chave de API (os blocos vinham com a marca d'água "API KEY REQUIRED"). Usamos os blocos do OpenStreetMap; no tema escuro o CSS (.mp-escuro) inverte as cores.
// Para tráfego alto, troque por um provedor com chave (MapTiler, Stadia, Mapbox…) e ajuste o img-src em server/lib/seguranca.js.
const TILES = () => "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const CARRO = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M7 3.5h10a2 2 0 0 1 2 2V18a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18V5.5a2 2 0 0 1 2-2z" fill="#f5b301" stroke="#1b1b1b" stroke-width="1.2"/><rect x="7" y="6" width="10" height="4" rx="1" fill="#1b1b1b" opacity=".75"/><rect x="7" y="14.5" width="10" height="3" rx="1" fill="#1b1b1b" opacity=".6"/></svg>';

let carregandoLeaflet = null;
function carregarLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    carregandoLeaflet ||= new Promise((res, rej) => {
        const css = document.createElement("link"); css.rel = "stylesheet"; css.href = `${LEAFLET}.min.css`; document.head.appendChild(css);
        const js = document.createElement("script"); js.src = `${LEAFLET}.min.js`; js.async = true;
        js.onload = () => (window.L ? res(window.L) : rej(new Error("mapa indisponível"))); js.onerror = () => { carregandoLeaflet = null; rej(new Error("mapa indisponível")); };
        document.head.appendChild(js);
    });
    return carregandoLeaflet;
}
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
    raiz.append(topo, area, el("p", "muted small mp-credito", "Posições aproximadas (cerca de 100 m) e sem identificação, por privacidade. Mapa © OpenStreetMap."));

    let L = null, mapa = null, circulo = null, lojaPin = null, ultima = null, kmDesenhado = null, timer = null, noAr = false, emVoo = false, falhaMapa = false;
    const pins = new Map();                                            // id público → marcador Leaflet
    const escuro = () => matchMedia?.("(prefers-color-scheme: dark)").matches || document.documentElement.dataset.tema === "escuro";

    function texto(r) {
        const km = r.raioKm;
        sub.textContent = `Raio de atendimento: ${km} km`;
        if (r.semLocalizacao) { conta.textContent = "Defina onde fica a sua loja"; vazioTxt.textContent = "Para ver os promotores por perto, informe a localização da sua loja (é a mesma usada no check-in)."; vazioBtn.hidden = !aoDefinirLocal; vazio.hidden = false; return; }
        vazioBtn.hidden = true;
        if (r.total === 0) { conta.textContent = `Nenhum promotor online em até ${km} km agora`; vazioTxt.textContent = "Seu pedido continua valendo: ele fica aberto e os promotores habilitados são avisados assim que entrarem online."; vazio.hidden = false; }
        else { conta.textContent = `${plural(r.total)} em até ${km} km`; vazio.hidden = true; }
    }
    async function garantirMapa(loja) {
        if (mapa || falhaMapa) return !!mapa;
        try { L = await carregarLeaflet(); } catch (e) { falhaMapa = true; mapaEl.hidden = true; return false; }
        mapa = L.map(mapaEl, { zoomControl: true, attributionControl: false, scrollWheelZoom: false }).setView([loja.lat, loja.lng], 12);
        mapaEl.classList.toggle("mp-escuro", !!escuro()); L.tileLayer(TILES(), { maxZoom: 19, crossOrigin: true }).addTo(mapa);
        lojaPin = L.marker([loja.lat, loja.lng], { icon: L.divIcon({ className: "mp-loja", html: "<span>🏪</span>", iconSize: [34, 34], iconAnchor: [17, 17] }), keyboard: false, interactive: false, zIndexOffset: 500 }).addTo(mapa);
        circulo = L.circle([loja.lat, loja.lng], { radius: RAIO.raioKm * 1000, color: "#f5b301", weight: 2, fillColor: "#f5b301", fillOpacity: 0.08 }).addTo(mapa);
        setTimeout(() => mapa?.invalidateSize(), 150);
        return true;
    }
    function ajustarRaio(km, loja) {
        if (!circulo || kmDesenhado === km) return;
        circulo.setRadius(km * 1000); kmDesenhado = km;
        mapa.fitBounds(circulo.getBounds(), { padding: [10, 10], animate: true });
    }
    function desenharPins(lista) {
        if (!mapa) return;
        const vivos = new Set();
        for (const p of lista) {
            vivos.add(p.pin); const pos = [p.lat, p.lng]; let m = pins.get(p.pin);
            if (!m) {
                const html = `<span class="mp-carro" style="transform:rotate(${p.rumo ?? 0}deg)">${CARRO}</span>`;
                m = L.marker(pos, { icon: L.divIcon({ className: "mp-pin", html, iconSize: [30, 30], iconAnchor: [15, 15] }), keyboard: false, title: `Promotor a ${String(p.distKm).replace(".", ",")} km` }).addTo(mapa); pins.set(p.pin, m);
            } else {
                m.setLatLng(pos);                                    // o CSS anima o deslocamento (transition em transform)
                const c = m.getElement()?.querySelector(".mp-carro"); if (c && p.rumo != null) c.style.transform = `rotate(${p.rumo}deg)`;
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
    const obs = typeof IntersectionObserver === "function" ? new IntersectionObserver((es) => { noAr = es.some((x) => x.isIntersecting); if (noAr && auth.currentUser) { ligar(); setTimeout(() => mapa?.invalidateSize(), 100); } else parar(); }) : null;
    if (obs) obs.observe(raiz); else noAr = true;
    window.addEventListener(EVENTO_RAIO, aoMudarRaio);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) atualizar(); });
    onAuthStateChanged(auth, (u) => { if (!u) { parar(); } else if (noAr) ligar(); });
    return { parar, atualizar };
}
