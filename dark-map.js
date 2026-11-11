// ============================================================
// ABASTECE JÁ — Mapa de reserva (Leaflet + tiles escuros CARTO/OpenStreetMap).
// Usado por mapa-promotores.js quando não há GOOGLE_MAPS_KEY ou quando o Google recusa a chave.
// O Leaflet carrega sob demanda do cdnjs (já liberado no CSP de server/lib/seguranca.js).
// API usada pelo app: DarkMap.create(el, opts) -> { L, map, destroy() }
// ============================================================
const LEAFLET_VERSAO = "1.9.4";
const BASE = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET_VERSAO}/`;
const TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TEMPO_MAX_MS = 12000;

let carregando = null;

function carregarLeaflet() {
    if (window.L?.map) return Promise.resolve(window.L);
    if (carregando) return carregando;
    carregando = new Promise((res, rej) => {
        const falhar = (m) => { carregando = null; rej(new Error(m)); };
        const timer = setTimeout(() => falhar("tempo-esgotado"), TEMPO_MAX_MS);
        if (!document.querySelector("link[data-leaflet]")) {
            const css = document.createElement("link");
            css.rel = "stylesheet"; css.href = BASE + "leaflet.min.css"; css.dataset.leaflet = "1";
            document.head.appendChild(css);
        }
        const s = document.createElement("script");
        s.src = BASE + "leaflet.min.js"; s.async = true;
        s.onload = () => { clearTimeout(timer); window.L?.map ? res(window.L) : falhar("indisponivel"); };
        s.onerror = () => { clearTimeout(timer); falhar("bloqueado"); };
        document.head.appendChild(s);
    });
    return carregando;
}

export const DarkMap = {
    async create(el, { center = [-23.55, -46.63], zoom = 12, zoomControl = true, scrollWheelZoom = false, attributionPosition = "bottomright" } = {}) {
        const L = await carregarLeaflet();
        el.style.background = "#1e1e24";
        const map = L.map(el, { center, zoom, zoomControl, scrollWheelZoom, attributionControl: false });
        L.control.attribution({ position: attributionPosition, prefix: false }).addTo(map);
        L.tileLayer(TILES, {
            subdomains: "abcd", maxZoom: 19,
            attribution: "© OpenStreetMap © CARTO"
        }).addTo(map);
        return { L, map, destroy() { try { map.remove(); } catch (e) { /* já removido */ } } };
    }
};
