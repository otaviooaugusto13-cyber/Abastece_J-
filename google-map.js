// ============================================================
// ABASTECE JÁ — Mapa Google (Maps JavaScript API) para o mapa de promotores da loja.
// • Só é usado quando config.js tem GOOGLE_MAPS_KEY. Sem chave (ou se o Google falhar/recusar a chave), mapa-promotores.js volta sozinho
//   para o mapa OpenStreetMap (dark-map.js): o mapa nunca fica em branco por causa disso.
// • Visual escuro fixo (igual ao do app), zoom à direita, pins de carro girando conforme o rumo, círculo do raio de atendimento.
// • A chave do navegador é pública por natureza: RESTRINJA no Google Cloud (Credenciais › Restrições de aplicativo › Sites) ao domínio do
//   app e limite a API a "Maps JavaScript API". Defina um orçamento/alerta de uso no faturamento.
// • Dependências do navegador entram por parâmetro (doc/janela) para os testes rodarem sem navegador.
// ============================================================
export const ESTILO_ESCURO = [
    { elementType: "geometry", stylers: [{ color: "#1d1d1d" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#8a8a8a" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#1a1a1a" }] },
    { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#3a3a3a" }] },
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
    { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#181818" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#2c2c2c" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#1a1a1a" }] },
    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9a9a9a" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3c3c3c" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f1720" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#4a5a6a" }] }
];
const CALLBACK = "__abasteceGoogleMapsPronto", DOURADO = "#FFD13B", TEMPO_MAX_MS = 12000;
const ouvintesAuth = new Set();

/** Carrega o script do Google uma única vez. Rejeita se a rede/CSP bloquear ou se passar de 12 s. */
export function carregarGoogleMaps(chave, { doc = globalThis.document, janela = globalThis.window } = {}) {
    if (janela?.google?.maps?.Map) return Promise.resolve(janela.google);
    if (!chave) return Promise.reject(new Error("sem-chave"));
    if (janela.__abasteceCarregando) return janela.__abasteceCarregando;
    janela.gm_authFailure = () => { for (const f of [...ouvintesAuth]) f(); };   // o Google chama isto quando a chave é inválida/restrita
    janela.__abasteceCarregando = new Promise((res, rej) => {
        const falhar = (m) => { janela.__abasteceCarregando = null; delete janela[CALLBACK]; rej(new Error(m)); };
        const timer = setTimeout(() => falhar("tempo-esgotado"), TEMPO_MAX_MS);
        janela[CALLBACK] = () => { clearTimeout(timer); delete janela[CALLBACK]; janela.google?.maps?.Map ? res(janela.google) : falhar("indisponivel"); };
        const s = doc.createElement("script");
        s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(chave)}&callback=${CALLBACK}&v=weekly&language=pt-BR&region=BR`;
        s.async = true; s.onerror = () => { clearTimeout(timer); falhar("bloqueado"); };
        doc.head.appendChild(s);
    });
    return janela.__abasteceCarregando;
}

/** SVG do carro girado pelo rumo (graus), como imagem de marcador. `carroSvg` é o <svg> usado no mapa Leaflet. */
export function iconeCarro(carroSvg, rumo = 0) {
    const interno = String(carroSvg).replace(/^\s*<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="30" height="30"><g transform="rotate(${Number(rumo) || 0} 12 12)">${interno}</g></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/**
 * Cria o mapa e devolve o adaptador usado por mapa-promotores.js:
 *   raio(km) · pins(lista) · invalidar() · destruir()
 * @param {HTMLElement} el  @param {{chave:string, centro:{lat:number,lng:number}, carroSvg:string, aoFalhar?:()=>void}} o
 */
export async function criarMapaGoogle(el, { chave, centro, carroSvg, aoFalhar, doc, janela }) {
    const google = await carregarGoogleMaps(chave, { doc, janela }), gm = google.maps;
    const pos = { lat: centro.lat, lng: centro.lng }, pins = new Map(); let kmAtual = null, morto = false;
    const mapa = new gm.Map(el, {
        center: pos, zoom: 12, styles: ESTILO_ESCURO, backgroundColor: "#121212", disableDefaultUI: true,
        zoomControl: true, zoomControlOptions: { position: gm.ControlPosition.RIGHT_CENTER }, gestureHandling: "greedy", clickableIcons: false, keyboardShortcuts: false
    });
    const lojaMarker = new gm.Marker({
        map: mapa, position: pos, clickable: false, zIndex: 500, label: { text: "🏪", fontSize: "17px" },
        icon: { path: gm.SymbolPath.CIRCLE, scale: 16, fillColor: "#1A1A1A", fillOpacity: 1, strokeColor: DOURADO, strokeWeight: 2 }
    });
    const circulo = new gm.Circle({ map: mapa, center: pos, radius: 1000, strokeColor: DOURADO, strokeWeight: 2, strokeOpacity: 1, fillColor: DOURADO, fillOpacity: 0.08, clickable: false });
    const falhou = () => { if (!morto) { morto = true; aoFalhar?.(); } };
    ouvintesAuth.add(falhou);
    const icone = (rumo) => ({ url: iconeCarro(carroSvg, rumo), scaledSize: new gm.Size(30, 30), anchor: new gm.Point(15, 15) });

    return {
        raio(km) {
            if (kmAtual === km) return; kmAtual = km; circulo.setRadius(km * 1000);
            const b = circulo.getBounds?.(); if (b) mapa.fitBounds(b, { top: 120, right: 24, bottom: 140, left: 24 });
        },
        pins(lista) {
            const vivos = new Set();
            for (const p of lista) {
                vivos.add(p.pin); const posP = { lat: p.lat, lng: p.lng }, rumo = Number(p.rumo) || 0, m = pins.get(p.pin);
                if (!m) pins.set(p.pin, { rumo, marcador: new gm.Marker({ map: mapa, position: posP, icon: icone(rumo), title: `Promotor a ${String(p.distKm).replace(".", ",")} km`, optimized: false }) });
                else { m.marcador.setPosition(posP); if (m.rumo !== rumo) { m.rumo = rumo; m.marcador.setIcon(icone(rumo)); } }
            }
            for (const [id, m] of pins) if (!vivos.has(id)) { m.marcador.setMap(null); pins.delete(id); }
        },
        invalidar() { gm.event?.trigger?.(mapa, "resize"); },
        destruir() { morto = true; ouvintesAuth.delete(falhou); for (const m of pins.values()) m.marcador.setMap(null); pins.clear(); circulo.setMap(null); lojaMarker.setMap(null); el.textContent = ""; }
    };
}
