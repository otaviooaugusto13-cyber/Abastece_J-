/**
 * DarkMap — mapa Dark Mode minimalista (estilo Uber) para o Abastece Já.
 * Leaflet + blocos do OpenStreetMap escurecidos por filtro CSS (trocável por provedor dark com chave).
 *
 * Uso rápido:
 *   import { DarkMap } from './dark-map.js';
 *   const map = await DarkMap.create(document.getElementById('mapa'), {
 *     center: [-23.5505, -46.6333], zoom: 14,
 *     onMarkerClick: (m) => abrirCard(m),
 *   });
 *   map.setMarkers([{ id: 'p1', lat: -23.55, lng: -46.63, status: 'online', title: 'Carlos' }]);
 *
 * Não precisa de npm: o Leaflet 1.9.4 é carregado do cdnjs se window.L não existir.
 * Se você já carrega o Leaflet por outro meio (npm/bundler), inclua o CSS dele.
 */

const LEAFLET_VERSION = '1.9.4';
const LEAFLET_CSS = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET_VERSION}/leaflet.min.css`;
const LEAFLET_JS = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET_VERSION}/leaflet.min.js`;
// Padrão: blocos do OpenStreetMap (sem chave; já liberados na CSP do projeto) escurecidos por filtro CSS.
// A CARTO passou a exigir chave de API (marca d'água "API KEY REQUIRED"), por isso NÃO é mais o padrão.
// Para um visual dark "de verdade" (ruas claras sobre fundo escuro), passe `tiles` com um provedor de estilo
// escuro e chave (MapTiler, Stadia...) e filter: 'none'. Lembre de liberar o domínio em img-src (server/lib/seguranca.js).
const DEFAULT_TILES = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  labelsUrl: null, // só use se o provedor tiver uma camada separada de rótulos
  subdomains: 'abc',
  maxZoom: 19,
  detectRetina: false,
  filter: 'invert(1) hue-rotate(180deg) grayscale(1) brightness(.85) contrast(.95)',
  labelsFilter: 'grayscale(1) brightness(.6)',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
};

const STATUSES = ['online', 'busy', 'offline'];

/* ------------------------------------------------------------------ */
/* Estilos (injetados uma única vez)                                    */
/* ------------------------------------------------------------------ */
const CSS = `
.dm-root{
  /* Ajuste fino da cor do mapa: mexa nestas duas variáveis até bater com a paleta */
  --dm-bg:#121212; --dm-accent:#FFD13B; --dm-user:#4C9AFF;
  --dm-base-filter:none; --dm-labels-filter:none;
  position:relative; isolation:isolate; background:var(--dm-bg); overflow:hidden;
}
.dm-canvas{position:absolute; inset:0; z-index:0; isolation:isolate; outline:none}
.dm-canvas.leaflet-container{background:var(--dm-bg); font-family:inherit; -webkit-tap-highlight-color:transparent}
.dm-tiles-base{filter:var(--dm-base-filter)}
.dm-tiles-labels{filter:var(--dm-labels-filter); opacity:.9}
.dm-root .leaflet-bar{border:1px solid #333; box-shadow:0 4px 14px rgba(0,0,0,.5)}
.dm-root .leaflet-bar a{background:#1A1A1A; color:#EDEDED; border-bottom:1px solid #333}
.dm-root .leaflet-bar a:hover{background:#262626}

.dm-root .leaflet-control-attribution{background:rgba(18,18,18,.72); color:#757575; font-size:10px; border-radius:6px; margin:6px}
.dm-root .leaflet-control-attribution a{color:#9a9a9a}

/* Pins */
.dm-pin-wrap{background:none; border:0}
.dm-pin{width:32px; height:40px; color:var(--dm-accent); transform-origin:50% 100%; transition:transform .18s ease;
  filter:drop-shadow(0 0 6px rgba(255,209,59,.55)) drop-shadow(0 2px 3px rgba(0,0,0,.7))}
.dm-pin svg{display:block}
.dm-pin--busy{color:#F5A524; filter:drop-shadow(0 0 6px rgba(245,165,36,.45)) drop-shadow(0 2px 3px rgba(0,0,0,.7))}
.dm-pin--offline{color:#5c5c5c; filter:drop-shadow(0 2px 3px rgba(0,0,0,.7))}
.dm-pin--active{transform:scale(1.2)}

/* Tooltip */
.dm-tip.leaflet-tooltip{background:#1A1A1A; color:#EDEDED; border:1px solid #333; border-radius:8px; padding:4px 8px;
  font:600 12px/1.2 system-ui,-apple-system,sans-serif; box-shadow:0 4px 14px rgba(0,0,0,.5)}
.dm-tip.leaflet-tooltip:before{display:none}

/* Rota */
.dm-route{filter:drop-shadow(0 0 5px rgba(255,209,59,.45))}

/* Localização do usuário */
.dm-user-wrap{background:none; border:0}
.dm-user{position:relative; width:18px; height:18px}
.dm-user__pulse{position:absolute; inset:0; border-radius:50%; background:var(--dm-user); opacity:.5; animation:dm-pulse 2s ease-out infinite}
.dm-user__dot{position:absolute; inset:3px; box-sizing:border-box; border-radius:50%; background:var(--dm-user); border:2px solid #fff; box-shadow:0 0 0 1px rgba(0,0,0,.4)}
@keyframes dm-pulse{0%{transform:scale(.6); opacity:.55}100%{transform:scale(3); opacity:0}}

/* Camada de overlays: não bloqueia gestos do mapa; só os filhos recebem toque */
.dm-overlay{position:absolute; inset:0; z-index:1000; pointer-events:none}
.dm-overlay > *{pointer-events:auto}
.dm-fab{position:absolute; right:16px; width:44px; height:44px; border-radius:50%; border:1px solid #333; background:#1A1A1A; color:var(--dm-accent);
  display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 6px 18px rgba(0,0,0,.55);
  bottom:calc(var(--dm-inset-bottom,0px) + 16px + env(safe-area-inset-bottom,0px)); transition:bottom .25s ease, transform .15s ease}
.dm-fab:active{transform:scale(.94)}
.dm-fab:focus-visible{outline:2px solid var(--dm-accent); outline-offset:2px}

/* Estado de carregamento */
.dm-loading{position:absolute; inset:0; z-index:900; display:flex; align-items:center; justify-content:center; background:var(--dm-bg); transition:opacity .4s ease}
.dm-loading--out{opacity:0; pointer-events:none}
.dm-loading__grid{position:absolute; inset:0; opacity:.7; overflow:hidden;
  background-image:linear-gradient(#1c1c1c 1px,transparent 1px),linear-gradient(90deg,#1c1c1c 1px,transparent 1px); background-size:48px 48px}
.dm-loading__grid:after{content:""; position:absolute; inset:0; background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.04) 50%,transparent 70%);
  transform:translateX(-100%); animation:dm-shimmer 1.6s ease-in-out infinite}
.dm-loading__island{position:relative; display:flex; align-items:center; gap:12px; padding:12px 18px; border-radius:999px; background:#1f1f1f;
  border:1px solid #2e2e2e; color:#9a9a9a; font:500 13px system-ui,-apple-system,sans-serif; box-shadow:0 8px 24px rgba(0,0,0,.5)}
.dm-loading__spin{width:14px; height:14px; border-radius:50%; border:2px solid #333; border-top-color:var(--dm-accent); animation:dm-spin .8s linear infinite}
@keyframes dm-spin{to{transform:rotate(360deg)}}
@keyframes dm-shimmer{to{transform:translateX(100%)}}

@media (prefers-reduced-motion:reduce){
  .dm-user__pulse{animation:none; opacity:.25; transform:scale(1.8)}
  .dm-loading__grid:after,.dm-loading__spin{animation:none}
  .dm-pin,.dm-fab{transition:none}
}
`;

function injectStyles() {
  if (document.getElementById('dm-styles')) return;
  const el = document.createElement('style');
  el.id = 'dm-styles';
  el.textContent = CSS;
  document.head.appendChild(el);
}

/* ------------------------------------------------------------------ */
/* Carregamento do Leaflet                                              */
/* ------------------------------------------------------------------ */
let leafletPromise = null;
function ensureLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-dm-leaflet]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = LEAFLET_CSS;
      css.setAttribute('data-dm-leaflet', '');
      document.head.appendChild(css);
    }
    const s = document.createElement('script');
    s.src = LEAFLET_JS;
    s.async = true;
    s.onload = () => resolve(window.L);
    s.onerror = () => {
      leafletPromise = null;
      reject(new Error('Não foi possível carregar o Leaflet (verifique rede/CSP).'));
    };
    document.head.appendChild(s);
  });
  return leafletPromise;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const reduceMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function toLatLng(p) {
  if (Array.isArray(p)) return [p[0], p[1]];
  return [p.lat ?? p.latitude, p.lng ?? p.lon ?? p.longitude];
}

function textEl(text) {
  const d = document.createElement('div');
  d.textContent = text == null ? '' : String(text); // textContent: evita XSS vindo do Firestore
  return d;
}

function pinSvg() {
  return (
    '<svg viewBox="0 0 32 40" width="32" height="40" aria-hidden="true">' +
    '<path d="M16 0C7.2 0 0 7 0 15.6 0 27 16 40 16 40s16-13 16-24.4C32 7 24.8 0 16 0z" fill="currentColor"/>' +
    '<circle cx="16" cy="15" r="6" fill="#121212"/></svg>'
  );
}

/* ------------------------------------------------------------------ */
/* Componente                                                           */
/* ------------------------------------------------------------------ */
export class DarkMap {
  /** Cria o mapa. O container precisa ter altura (ex.: position:fixed; inset:0). */
  static async create(container, options = {}) {
    const L = await ensureLeaflet();
    injectStyles();
    return new DarkMap(L, container, options);
  }

  constructor(L, container, options) {
    this.L = L;
    this.opts = {
      center: [-23.5505, -46.6333],
      zoom: 14,
      minZoom: 3,
      maxZoom: 19,
      attributionPosition: 'topright',
      zoomControl: false, // true = botões +/- do Leaflet (com tema dark)
      scrollWheelZoom: true,
      tiles: {}, // sobrescreve DEFAULT_TILES (url, labelsUrl, filter, attribution...)
      locateButton: true, // botão de recentralizar embutido
      insetBottom: 0, // px cobertos pelo bottom sheet (para centralizar acima dele)
      onMarkerClick: null,
      onMapClick: null,
      onLocationError: null,
      onReady: null,
      ...options,
    };

    this.tiles = { ...DEFAULT_TILES, ...(this.opts.tiles || {}) };
    this.root = container;
    this.root.style.setProperty('--dm-base-filter', this.tiles.filter || 'none');
    this.root.style.setProperty('--dm-labels-filter', this.tiles.labelsFilter || 'none');
    this.root.classList.add('dm-root');
    this.canvas = document.createElement('div');
    this.canvas.className = 'dm-canvas';
    this.root.appendChild(this.canvas);

    // Camada para seus cards/botões por cima do mapa (não bloqueia gestos)
    this.overlay = document.createElement('div');
    this.overlay.className = 'dm-overlay';
    this.root.appendChild(this.overlay);

    this.loadingEl = this._buildLoading();
    this.root.appendChild(this.loadingEl);

    this.markers = new Map(); // id -> { marker, data }
    this.activeId = null;
    this.userLatLng = null;
    this.userMarker = null;
    this.watchId = null;
    this._ready = false;

    const map = (this.map = L.map(this.canvas, {
      zoomControl: this.opts.zoomControl,
      scrollWheelZoom: this.opts.scrollWheelZoom,
      attributionControl: false,
      minZoom: this.opts.minZoom,
      maxZoom: this.opts.maxZoom,
    }));
    map.setView(this.opts.center, this.opts.zoom);
    L.control.attribution({ position: this.opts.attributionPosition, prefix: false }).addTo(map);

    map.createPane('dmLabels');
    map.getPane('dmLabels').style.zIndex = 250;
    map.getPane('dmLabels').style.pointerEvents = 'none';

    const T = this.tiles;
    this.base = L.tileLayer(T.url, {
      subdomains: T.subdomains, maxZoom: T.maxZoom, detectRetina: T.detectRetina,
      attribution: T.attribution, className: 'dm-tiles-base',
    }).addTo(map);
    this.labels = null;
    if (T.labelsUrl) {
      this.labels = L.tileLayer(T.labelsUrl, {
        subdomains: T.subdomains, maxZoom: T.maxZoom, detectRetina: T.detectRetina,
        pane: 'dmLabels', className: 'dm-tiles-labels',
      }).addTo(map);
    }

    this.markersLayer = L.layerGroup().addTo(map);
    this.routeLayer = L.layerGroup().addTo(map);
    this.radiusLayer = L.layerGroup().addTo(map);

    map.on('click', () => {
      this.setActive(null);
      this.opts.onMapClick?.();
    });

    // Loading some quando os tiles visíveis terminam (ou após 8s, para não travar offline)
    this.base.once('load', () => this._markReady());
    this._readyTimer = setTimeout(() => this._markReady(), 8000);

    // Mantém o mapa correto quando o container muda (bottom sheet, teclado, rotação)
    if (typeof ResizeObserver === 'function') {
      this._ro = new ResizeObserver(() => map.invalidateSize());
      this._ro.observe(this.root);
    }

    if (this.opts.locateButton) this._buildLocateButton();
    this.setInsets({ bottom: this.opts.insetBottom });
  }

  /* ---------------- UI interna ---------------- */
  _buildLoading() {
    const el = document.createElement('div');
    el.className = 'dm-loading';
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<div class="dm-loading__grid"></div>' +
      '<div class="dm-loading__island"><span class="dm-loading__spin"></span><span>Carregando mapa…</span></div>';
    return el;
  }

  _markReady() {
    if (this._ready) return;
    this._ready = true;
    clearTimeout(this._readyTimer);
    this.loadingEl.classList.add('dm-loading--out');
    setTimeout(() => this.loadingEl.remove(), 450);
    this.opts.onReady?.(this);
  }

  _buildLocateButton() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dm-fab';
    b.setAttribute('aria-label', 'Centralizar na minha localização');
    b.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>';
    b.addEventListener('click', () => this.centerOnUser());
    this.overlay.appendChild(b);
    this.locateBtn = b;
  }

  /** Informe a altura (px) coberta pelo bottom sheet para o mapa centralizar acima dele. */
  setInsets({ bottom = 0 } = {}) {
    this.opts.insetBottom = bottom;
    this.root.style.setProperty('--dm-inset-bottom', `${bottom}px`);
  }

  /* ---------------- Pins ---------------- */
  _icon(status, active) {
    return this.L.divIcon({
      className: 'dm-pin-wrap',
      html: `<div class="dm-pin dm-pin--${status}${active ? ' dm-pin--active' : ''}">${pinSvg()}</div>`,
      iconSize: [32, 40],
      iconAnchor: [16, 40],
      tooltipAnchor: [0, -36],
    });
  }

  /**
   * Sincroniza a lista de marcadores (adiciona, move e remove por id).
   * Seguro para chamar a cada snapshot do Firestore.
   * Item: { id, lat, lng, status?: 'online'|'busy'|'offline', title?, ...extras }
   */
  setMarkers(list = []) {
    const seen = new Set();
    for (const m of list) {
      const [lat, lng] = toLatLng(m);
      if (!isNum(lat) || !isNum(lng)) continue;
      const id = String(m.id ?? `${lat},${lng}`);
      const status = STATUSES.includes(m.status) ? m.status : 'online';
      seen.add(id);
      const cur = this.markers.get(id);
      if (cur) {
        cur.marker.setLatLng([lat, lng]);
        if (cur.data.status !== status) cur.marker.setIcon(this._icon(status, id === this.activeId));
        cur.marker.setTooltipContent(textEl(m.title));
        cur.data = { ...m, id, lat, lng, status };
      } else {
        const marker = this.L.marker([lat, lng], {
          icon: this._icon(status, false),
          keyboard: true,
          alt: m.title ? String(m.title) : 'Marcador',
        });
        marker.bindTooltip(textEl(m.title), { direction: 'top', className: 'dm-tip', offset: [0, 0] });
        marker.on('click', (e) => {
          this.L.DomEvent.stopPropagation(e);
          this.setActive(id);
          this.opts.onMarkerClick?.(this.markers.get(id).data);
        });
        marker.addTo(this.markersLayer);
        this.markers.set(id, { marker, data: { ...m, id, lat, lng, status } });
      }
    }
    for (const [id, cur] of this.markers) {
      if (seen.has(id)) continue;
      this.markersLayer.removeLayer(cur.marker);
      this.markers.delete(id);
      if (this.activeId === id) this.activeId = null;
    }
  }

  setActive(id) {
    if (this.activeId === id) return;
    const prev = this.markers.get(this.activeId);
    if (prev) { prev.marker.setIcon(this._icon(prev.data.status, false)); prev.marker.setZIndexOffset(0); }
    this.activeId = id;
    const next = this.markers.get(id);
    if (next) { next.marker.setIcon(this._icon(next.data.status, true)); next.marker.setZIndexOffset(1000); }
  }

  /* ---------------- Câmera ---------------- */
  _shift(latlng, zoom) {
    const b = this.opts.insetBottom;
    if (!b) return latlng;
    const p = this.map.project(latlng, zoom).add([0, b / 2]);
    return this.map.unproject(p, zoom);
  }

  /** Anima a câmera até um ponto, já compensando o bottom sheet. */
  flyToPoint(lat, lng, zoom) {
    const z = zoom ?? Math.max(this.map.getZoom(), 15);
    const target = this._shift([lat, lng], z);
    if (reduceMotion()) this.map.setView(target, z, { animate: false });
    else this.map.flyTo(target, z, { duration: 0.8 });
  }

  centerOnMarker(id, zoom) {
    const cur = this.markers.get(String(id));
    if (!cur) return;
    this.setActive(String(id));
    this.flyToPoint(cur.data.lat, cur.data.lng, zoom);
  }

  centerOnUser(zoom) {
    if (this.userLatLng) this.flyToPoint(this.userLatLng[0], this.userLatLng[1], zoom);
    else this.locate({ follow: false, zoom });
  }

  fitToMarkers({ includeUser = true, maxZoom = 16 } = {}) {
    const pts = [...this.markers.values()].map((m) => [m.data.lat, m.data.lng]);
    if (includeUser && this.userLatLng) pts.push(this.userLatLng);
    if (!pts.length) return;
    this._fit(this.L.latLngBounds(pts), maxZoom);
  }

  _fit(bounds, maxZoom = 17) {
    this.map.fitBounds(bounds, {
      paddingTopLeft: [40, 40],
      paddingBottomRight: [40, 40 + (this.opts.insetBottom || 0)],
      maxZoom,
      animate: !reduceMotion(),
    });
  }

  /* ---------------- Localização do usuário ---------------- */
  /** Define a posição manualmente (ex.: se o app já tem o GPS). */
  setUserLocation(lat, lng) {
    if (!isNum(lat) || !isNum(lng)) return;
    this.userLatLng = [lat, lng];
    if (!this.userMarker) {
      const icon = this.L.divIcon({
        className: 'dm-user-wrap',
        html: '<div class="dm-user"><span class="dm-user__pulse"></span><span class="dm-user__dot"></span></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      this.userMarker = this.L.marker(this.userLatLng, {
        icon, interactive: false, keyboard: false, zIndexOffset: 500,
      }).addTo(this.map);
    } else {
      this.userMarker.setLatLng(this.userLatLng);
    }
  }

  /** Pede o GPS e acompanha. follow=true mantém a câmera seguindo o usuário. */
  locate({ follow = false, zoom } = {}) {
    if (!('geolocation' in navigator)) {
      this.opts.onLocationError?.(new Error('Geolocalização indisponível neste dispositivo.'));
      return;
    }
    this.stopLocate();
    let first = true;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        this.setUserLocation(latitude, longitude);
        if (first || follow) this.flyToPoint(latitude, longitude, zoom);
        first = false;
      },
      (err) => this.opts.onLocationError?.(err),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }

  stopLocate() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  /* ---------------- Rota e raio ---------------- */
  /** points: [[lat,lng], ...] ou [{lat,lng}, ...]. Linha sólida amarela de 5px. */
  setRoute(points, { fit = true } = {}) {
    this.routeLayer.clearLayers();
    if (!points || points.length < 2) return;
    const pts = points.map(toLatLng).filter(([a, b]) => isNum(a) && isNum(b));
    if (pts.length < 2) return;
    const base = { lineCap: 'round', lineJoin: 'round', interactive: false };
    this.L.polyline(pts, { ...base, color: '#000', weight: 9, opacity: 0.55 }).addTo(this.routeLayer);
    const line = this.L.polyline(pts, { ...base, color: '#FFD13B', weight: 5, opacity: 1, className: 'dm-route' })
      .addTo(this.routeLayer);
    if (fit) this._fit(line.getBounds());
  }

  clearRoute() { this.routeLayer.clearLayers(); }

  /** Círculo do raio de atendimento (km). km falsy remove. center padrão: usuário ou centro do mapa. */
  setRadius(km, center) {
    this.radiusLayer.clearLayers();
    if (!isNum(km) || km <= 0) return;
    const c = center ? toLatLng(center) : this.userLatLng || this.map.getCenter();
    this.L.circle(c, {
      radius: km * 1000, color: '#FFD13B', weight: 1.5, opacity: 0.6,
      fillColor: '#FFD13B', fillOpacity: 0.05, interactive: false,
    }).addTo(this.radiusLayer);
  }

  /* ---------------- Ciclo de vida ---------------- */
  invalidateSize() { this.map.invalidateSize(); }

  destroy() {
    this.stopLocate();
    clearTimeout(this._readyTimer);
    this._ro?.disconnect();
    this.map.remove();
    this.canvas.remove();
    this.overlay.remove();
    this.loadingEl.remove();
    this.root.classList.remove('dm-root');
    this.markers.clear();
  }
}

export default DarkMap;
