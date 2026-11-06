/**
 * GoogleDarkMap — mapa Google Maps com tema Dark Minimalista, pensado como camada de fundo (background layer) do Abastece Já.
 *
 * Uso rápido:
 *   import { GoogleDarkMap } from './google-dark-map.js';
 *   const map = await GoogleDarkMap.create(document.getElementById('mapa'), {
 *     apiKey: GOOGLE_MAPS_KEY,                    // config.js
 *     center: [-23.5505, -46.6333], zoom: 14,
 *     onMarkerClick: (m) => abrirCard(m),
 *   });
 *   map.setMarkers([{ id: 'p1', lat: -23.55, lng: -46.63, status: 'online', title: 'Carlos' }]);
 *
 * Em React use o wrapper <GoogleDarkMap /> (GoogleDarkMap.jsx).
 *
 * Decisões de projeto:
 *  • Estilo: array JSON clássico (DARK_MAP_STYLE) — funciona SEM mapId. Por isso os marcadores são HTML sobre OverlayView
 *    (AdvancedMarkerElement exige mapId, e com mapId o `styles` é ignorado; google.maps.Marker está em descontinuação).
 *  • O container precisa ter altura (ex.: position:fixed; inset:0). O logotipo "Google" fica dentro do container e NÃO pode ficar
 *    escondido atrás de dock/sheet (termos de uso): deixe o container terminar acima do que o cobre.
 *  • Sem chave, chave inválida ou sem rede: create() rejeita / onError dispara — o chamador decide o plano B.
 */

/** Estilo dark minimalista (sem POIs, sem trânsito, sem ícones, rótulos discretos). */
export const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1e1e24' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#74788d' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1e1e24' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#2a2d3d' }] },
  { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c2f40' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8a8d9b' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#383c51' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#121318' }] },
];

const BG = '#1e1e24';
const ACCENT = '#FFD13B';
const STATUSES = ['online', 'busy', 'offline'];

/* ------------------------------------------------------------------ */
/* Estilos (injetados uma única vez)                                    */
/* ------------------------------------------------------------------ */
const CSS = `
.gdm-root{--gdm-bg:${BG}; --gdm-accent:${ACCENT}; --gdm-user:#4C9AFF; position:relative; isolation:isolate; overflow:hidden; background:var(--gdm-bg)}
.gdm-canvas{position:absolute; inset:0; z-index:0; outline:none}

/* Pins de status */
.gdm-pin{position:relative; width:32px; height:40px; color:var(--gdm-accent); transform-origin:50% 100%; transition:transform .18s ease; cursor:pointer; outline:none;
  filter:drop-shadow(0 0 6px rgba(255,209,59,.55)) drop-shadow(0 2px 3px rgba(0,0,0,.7))}
.gdm-pin svg{display:block}
.gdm-pin--busy{color:#F5A524; filter:drop-shadow(0 0 6px rgba(245,165,36,.45)) drop-shadow(0 2px 3px rgba(0,0,0,.7))}
.gdm-pin--offline{color:#5c5c5c; filter:drop-shadow(0 2px 3px rgba(0,0,0,.7))}
.gdm-pin--active{transform:scale(1.2)}
.gdm-pin:focus-visible{outline:2px solid var(--gdm-accent); outline-offset:2px; border-radius:6px}
.gdm-tip{position:absolute; left:50%; bottom:100%; margin-bottom:4px; transform:translateX(-50%); white-space:nowrap; pointer-events:none; opacity:0; transition:opacity .12s ease;
  background:#1A1A1A; color:#EDEDED; border:1px solid #333; border-radius:8px; padding:4px 8px; font:600 12px/1.2 system-ui,-apple-system,sans-serif; box-shadow:0 4px 14px rgba(0,0,0,.5)}
.gdm-pin:hover .gdm-tip,.gdm-pin:focus-visible .gdm-tip{opacity:1}
.gdm-tip:empty{display:none}

/* Localização do usuário */
.gdm-user{position:relative; width:18px; height:18px}
.gdm-user__pulse{position:absolute; inset:0; border-radius:50%; background:var(--gdm-user); opacity:.5; animation:gdm-pulse 2s ease-out infinite}
.gdm-user__dot{position:absolute; inset:3px; box-sizing:border-box; border-radius:50%; background:var(--gdm-user); border:2px solid #fff; box-shadow:0 0 0 1px rgba(0,0,0,.4)}
@keyframes gdm-pulse{0%{transform:scale(.6); opacity:.55}100%{transform:scale(3); opacity:0}}

/* Camada de overlays: não bloqueia gestos do mapa; só os filhos recebem toque */
.gdm-overlay{position:absolute; inset:0; z-index:10; pointer-events:none}
.gdm-overlay > *{pointer-events:auto}
.gdm-fab{position:absolute; right:16px; width:44px; height:44px; border-radius:50%; border:1px solid #333; background:#1A1A1A; color:var(--gdm-accent);
  display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 6px 18px rgba(0,0,0,.55); bottom:calc(16px + env(safe-area-inset-bottom,0px)); transition:transform .15s ease}
.gdm-fab:active{transform:scale(.94)}
.gdm-fab:focus-visible,.gdm-zoom button:focus-visible{outline:2px solid var(--gdm-accent); outline-offset:2px}
.gdm-zoom{position:absolute; right:12px; top:var(--gdm-zoom-top,calc(12px + env(safe-area-inset-top,0px))); display:flex; flex-direction:column; border:1px solid #333; border-radius:12px; overflow:hidden; box-shadow:0 4px 14px rgba(0,0,0,.5)}
.gdm-zoom button{width:40px; height:40px; border:0; background:#1A1A1A; color:#EDEDED; font:500 20px/1 system-ui,sans-serif; cursor:pointer; touch-action:manipulation}
.gdm-zoom button + button{border-top:1px solid #333}
.gdm-zoom button:hover{background:#262626}
.gdm-zoom button:active{background:#2e2e2e}

/* Carregamento / erro */
.gdm-loading{position:absolute; inset:0; z-index:20; display:flex; align-items:center; justify-content:center; background:var(--gdm-bg); transition:opacity .4s ease}
.gdm-loading--out{opacity:0; pointer-events:none}
.gdm-loading__grid{position:absolute; inset:0; opacity:.7; overflow:hidden; background-image:linear-gradient(#25252c 1px,transparent 1px),linear-gradient(90deg,#25252c 1px,transparent 1px); background-size:48px 48px}
.gdm-loading__grid:after{content:""; position:absolute; inset:0; background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.04) 50%,transparent 70%); transform:translateX(-100%); animation:gdm-shimmer 1.6s ease-in-out infinite}
.gdm-loading__island{position:relative; display:flex; align-items:center; gap:12px; padding:12px 18px; border-radius:999px; background:#26262d; border:1px solid #34343d; color:#9a9dae;
  font:500 13px system-ui,-apple-system,sans-serif; box-shadow:0 8px 24px rgba(0,0,0,.5)}
.gdm-loading__spin{width:14px; height:14px; border-radius:50%; border:2px solid #3a3a45; border-top-color:var(--gdm-accent); animation:gdm-spin .8s linear infinite}
.gdm-loading--error .gdm-loading__spin,.gdm-loading--error .gdm-loading__grid:after{display:none}
@keyframes gdm-spin{to{transform:rotate(360deg)}}
@keyframes gdm-shimmer{to{transform:translateX(100%)}}

@media (prefers-reduced-motion:reduce){
  .gdm-user__pulse{animation:none; opacity:.25; transform:scale(1.8)}
  .gdm-loading__grid:after,.gdm-loading__spin{animation:none}
  .gdm-pin,.gdm-fab,.gdm-tip{transition:none}
}
`;

function injectStyles() {
  if (document.getElementById('gdm-styles')) return;
  const el = document.createElement('style');
  el.id = 'gdm-styles';
  el.textContent = CSS;
  document.head.appendChild(el);
}

/* ------------------------------------------------------------------ */
/* Carregamento da Maps JavaScript API                                  */
/* ------------------------------------------------------------------ */
let mapsPromise = null;
let authFailed = false;
const authListeners = new Set();

/** Carrega (uma única vez) a Maps JS API com o loader assíncrono oficial e devolve `google.maps` já com a biblioteca "maps". */
export function loadGoogleMaps({ apiKey, language = 'pt-BR', region = 'BR', version = 'weekly' } = {}) {
  if (authFailed) return Promise.reject(new Error('Chave do Google Maps recusada.'));
  if (window.google?.maps?.importLibrary) return window.google.maps.importLibrary('maps').then(() => window.google.maps);
  if (mapsPromise) return mapsPromise;
  if (!apiKey) return Promise.reject(new Error('Chave do Google Maps não configurada (GOOGLE_MAPS_KEY em config.js).'));

  // Chamado pelo Google quando a chave é inválida / restrita ao domínio errado / API não ativada.
  window.gm_authFailure = () => {
    authFailed = true;
    mapsPromise = null;
    for (const fn of authListeners) fn(new Error('Google Maps recusou a chave de API (verifique a chave, as restrições de domínio e se a Maps JavaScript API está ativada).'));
  };

  mapsPromise = new Promise((resolve, reject) => {
    window.__gdmInit = () => {
      window.google.maps.importLibrary('maps').then(() => resolve(window.google.maps), reject);
    };
    const s = document.createElement('script');
    const q = new URLSearchParams({ key: apiKey, v: version, language, region, loading: 'async', callback: '__gdmInit' });
    s.src = `https://maps.googleapis.com/maps/api/js?${q}`;
    s.async = true;
    s.onerror = () => {
      mapsPromise = null;
      s.remove();
      reject(new Error('Não foi possível carregar o Google Maps (verifique rede/CSP).'));
    };
    document.head.appendChild(s);
  });
  return mapsPromise;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function toLatLng(p) {
  if (Array.isArray(p)) return [p[0], p[1]];
  return [p.lat ?? p.latitude, p.lng ?? p.lon ?? p.longitude];
}

// Projeção Web Mercator (mesma do Google) — usada só para deslocar a câmera acima do bottom sheet.
const project = (lat, lng, z) => {
  const s = 256 * 2 ** z, sin = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s];
};
const unproject = (x, y, z) => {
  const s = 256 * 2 ** z, n = Math.PI - (2 * Math.PI * y) / s;
  return [(180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), (x / s) * 360 - 180];
};

function pinSvg() {
  return (
    '<svg viewBox="0 0 32 40" width="32" height="40" aria-hidden="true">' +
    '<path d="M16 0C7.2 0 0 7 0 15.6 0 27 16 40 16 40s16-13 16-24.4C32 7 24.8 0 16 0z" fill="currentColor"/>' +
    `<circle cx="16" cy="15" r="6" fill="${BG}"/></svg>`
  );
}

/* ------------------------------------------------------------------ */
/* Marcador HTML (OverlayView) — criado sob demanda, pois estende uma   */
/* classe que só existe depois que a API carrega                         */
/* ------------------------------------------------------------------ */
function buildHtmlMarkerClass(maps) {
  return class HtmlMarker extends maps.OverlayView {
    /**
     * o: { lat, lng, element?|html?, className?, size:[w,h], anchor:[x,y], zIndex?, interactive?, moveMs?, onClick? }
     * `html` deve ser markup ESTÁTICO do app (nunca texto vindo do servidor/Firestore); para conteúdo dinâmico use `element`.
     */
    constructor(map, o) {
      super();
      this.o = o;
      this.pos = new maps.LatLng(o.lat, o.lng);
      const [w, h] = o.size || [32, 40];
      this.anchor = o.anchor || [w / 2, h];
      const el = (this.el = document.createElement('div'));
      el.className = o.className || '';
      Object.assign(el.style, { position: 'absolute', left: '0', top: '0', width: `${w}px`, height: `${h}px`, willChange: 'transform', zIndex: String(o.zIndex ?? 0) });
      if (o.element) el.appendChild(o.element);
      else if (o.html) el.innerHTML = o.html;
      if (o.interactive === false) el.style.pointerEvents = 'none';
      else {
        maps.OverlayView.preventMapHitsAndGesturesFrom(el); // tocar no pin não inicia arrasto do mapa
        if (o.onClick) el.addEventListener('click', (e) => { e.stopPropagation(); o.onClick(e); });
      }
      this.setMap(map);
    }

    onAdd() { this.getPanes().overlayMouseTarget.appendChild(this.el); }
    draw() { this._place(0); }
    onRemove() { this.el.remove(); }

    _place(ms) {
      const pt = this.getProjection()?.fromLatLngToDivPixel(this.pos);
      if (!pt) return;
      this.el.style.transition = ms > 0 ? `transform ${ms}ms linear` : 'none'; // só anima quando o DADO muda; pan/zoom nunca "arrastam" o pin
      this.el.style.transform = `translate3d(${Math.round(pt.x - this.anchor[0])}px,${Math.round(pt.y - this.anchor[1])}px,0)`;
    }

    /** Move o pin; com moveMs>0 ele "anda" até a nova posição em vez de pular. */
    setPosition(lat, lng, moveMs = this.o.moveMs || 0) {
      this.pos = new maps.LatLng(lat, lng);
      this._place(reduceMotion() ? 0 : moveMs);
    }

    get element() { return this.el; }
    setZIndex(z) { this.el.style.zIndex = String(z); }
    remove() { this.setMap(null); }
  };
}

/* ------------------------------------------------------------------ */
/* Componente                                                           */
/* ------------------------------------------------------------------ */
export class GoogleDarkMap {
  /** Cria o mapa. O container precisa ter altura (ex.: position:fixed; inset:0). */
  static async create(container, options = {}) {
    const maps = await loadGoogleMaps(options);
    injectStyles();
    return new GoogleDarkMap(maps, container, options);
  }

  constructor(maps, container, options) {
    this.maps = maps;
    this.HtmlMarker = buildHtmlMarkerClass(maps);
    this.opts = {
      center: [-23.5505, -46.6333],
      zoom: 14,
      minZoom: 3,
      maxZoom: 20,
      zoomControl: false, // botões +/- no tema dark (os padrão do Google ficam desligados)
      scrollWheelZoom: true,
      gestureHandling: 'greedy', // mapa de fundo: um dedo já move o mapa (use 'cooperative' se ele estiver dentro de uma página que rola)
      styles: DARK_MAP_STYLE,
      locateButton: true, // botão de recentralizar embutido
      insetBottom: 0, // px cobertos pelo bottom sheet (para centralizar acima dele)
      onMarkerClick: null,
      onMapClick: null,
      onLocationError: null,
      onReady: null,
      onError: null,
      ...options,
    };

    this.root = container;
    this.root.classList.add('gdm-root');
    this.canvas = document.createElement('div');
    this.canvas.className = 'gdm-canvas';
    this.root.appendChild(this.canvas);

    // Camada para seus cards/botões por cima do mapa (não bloqueia gestos)
    this.overlay = document.createElement('div');
    this.overlay.className = 'gdm-overlay';
    this.root.appendChild(this.overlay);

    this.loadingEl = this._buildLoading();
    this.root.appendChild(this.loadingEl);

    this.markers = new Map(); // id -> { marker, data }
    this.activeId = null;
    this.userLatLng = null;
    this.userMarker = null;
    this.watchId = null;
    this.circle = null;
    this.routeLines = [];
    this._ready = false;
    this._destroyed = false;

    const [clat, clng] = this.opts.center;
    const map = (this.map = new maps.Map(this.canvas, {
      center: { lat: clat, lng: clng },
      zoom: this.opts.zoom,
      minZoom: this.opts.minZoom,
      maxZoom: this.opts.maxZoom,
      styles: this.opts.styles,
      backgroundColor: BG,
      disableDefaultUI: true,
      clickableIcons: false,
      keyboardShortcuts: false,
      gestureHandling: this.opts.gestureHandling,
      scrollwheel: this.opts.scrollWheelZoom,
      mapTypeId: 'roadmap',
      tilt: 0,
    }));

    map.addListener('click', () => {
      this.setActive(null);
      this.opts.onMapClick?.();
    });

    // Loading some quando os tiles visíveis terminam (ou após 8s, para não travar offline)
    maps.event.addListenerOnce(map, 'tilesloaded', () => this._markReady());
    this._readyTimer = setTimeout(() => this._markReady(), 8000);

    // Chave recusada depois do carregamento
    this._onAuthFail = (err) => this._fail(err);
    authListeners.add(this._onAuthFail);

    // Mantém o mapa correto quando o container muda (bottom sheet, teclado, rotação, aba que volta a ficar visível)
    if (typeof ResizeObserver === 'function') {
      this._ro = new ResizeObserver(() => this.invalidateSize());
      this._ro.observe(this.root);
    }

    if (this.opts.zoomControl) this._buildZoomControl();
    if (this.opts.locateButton) this._buildLocateButton();
    this.setInsets({ bottom: this.opts.insetBottom });
  }

  /* ---------------- UI interna ---------------- */
  _buildLoading() {
    const el = document.createElement('div');
    el.className = 'gdm-loading';
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<div class="gdm-loading__grid"></div>' +
      '<div class="gdm-loading__island"><span class="gdm-loading__spin"></span><span class="gdm-loading__msg">Carregando mapa…</span></div>';
    return el;
  }

  _markReady() {
    if (this._ready || this._destroyed) return;
    this._ready = true;
    clearTimeout(this._readyTimer);
    this.loadingEl.classList.add('gdm-loading--out');
    setTimeout(() => this.loadingEl.remove(), 450);
    this.opts.onReady?.(this);
  }

  _fail(err) {
    if (this._destroyed) return;
    this._ready = true; // não esconde o aviso de erro
    clearTimeout(this._readyTimer);
    this.loadingEl.classList.remove('gdm-loading--out');
    this.loadingEl.classList.add('gdm-loading--error');
    this.loadingEl.querySelector('.gdm-loading__msg').textContent = 'Mapa indisponível no momento';
    this.opts.onError?.(err);
  }

  _buildZoomControl() {
    const box = document.createElement('div');
    box.className = 'gdm-zoom';
    const mk = (txt, label, d) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = txt;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', () => this.map.setZoom((this.map.getZoom() ?? this.opts.zoom) + d));
      return b;
    };
    box.append(mk('+', 'Aproximar', 1), mk('−', 'Afastar', -1));
    this.overlay.appendChild(box);
    this.zoomBox = box;
  }

  _buildLocateButton() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gdm-fab';
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
    this.root.style.setProperty('--gdm-inset-bottom', `${bottom}px`);
    if (this.locateBtn) this.locateBtn.style.bottom = `calc(${bottom}px + 16px + env(safe-area-inset-bottom,0px))`;
  }

  /** Troca o estilo do mapa em tempo de execução (ex.: DARK_MAP_STYLE ↔ outro array). */
  setStyles(styles) { this.map.setOptions({ styles }); }

  /** Adiciona um marcador HTML livre (ex.: pin da loja, carrinho). Devolve { setPosition(lat,lng,ms?), element, remove() }. */
  addHtmlMarker(o) { return new this.HtmlMarker(this.map, o); }

  /* ---------------- Pins de status ---------------- */
  _pinEl(status, title, active) {
    const pin = document.createElement('div');
    pin.className = `gdm-pin gdm-pin--${status}${active ? ' gdm-pin--active' : ''}`;
    pin.innerHTML = pinSvg();
    const tip = document.createElement('span');
    tip.className = 'gdm-tip';
    tip.textContent = title == null ? '' : String(title); // textContent: evita XSS vindo do Firestore
    pin.appendChild(tip);
    pin.tabIndex = 0;
    pin.setAttribute('role', 'button');
    pin.setAttribute('aria-label', title ? String(title) : 'Marcador');
    return pin;
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
        cur.marker.setPosition(lat, lng);
        const pin = cur.marker.element.firstChild;
        if (cur.data.status !== status) pin.className = `gdm-pin gdm-pin--${status}${id === this.activeId ? ' gdm-pin--active' : ''}`;
        if (cur.data.title !== m.title) {
          pin.querySelector('.gdm-tip').textContent = m.title == null ? '' : String(m.title);
          pin.setAttribute('aria-label', m.title ? String(m.title) : 'Marcador');
        }
        cur.data = { ...m, id, lat, lng, status };
      } else {
        const pin = this._pinEl(status, m.title, false);
        const click = () => {
          this.setActive(id);
          this.opts.onMarkerClick?.(this.markers.get(id).data);
        };
        pin.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(); } });
        const marker = this.addHtmlMarker({ lat, lng, element: pin, size: [32, 40], anchor: [16, 40], onClick: click });
        this.markers.set(id, { marker, data: { ...m, id, lat, lng, status } });
      }
    }
    for (const [id, cur] of this.markers) {
      if (seen.has(id)) continue;
      cur.marker.remove();
      this.markers.delete(id);
      if (this.activeId === id) this.activeId = null;
    }
  }

  setActive(id) {
    if (this.activeId === id) return;
    const prev = this.markers.get(this.activeId);
    if (prev) { prev.marker.element.firstChild.classList.remove('gdm-pin--active'); prev.marker.setZIndex(0); }
    this.activeId = id;
    const next = this.markers.get(id);
    if (next) { next.marker.element.firstChild.classList.add('gdm-pin--active'); next.marker.setZIndex(1000); }
  }

  /* ---------------- Câmera ---------------- */
  _shift([lat, lng], zoom) {
    const b = this.opts.insetBottom;
    if (!b) return [lat, lng];
    const [x, y] = project(lat, lng, zoom);
    return unproject(x, y + b / 2, zoom);
  }

  /** Anima a câmera até um ponto, já compensando o bottom sheet. */
  flyToPoint(lat, lng, zoom) {
    const z = zoom ?? Math.max(this.map.getZoom() ?? 0, 15);
    const [tlat, tlng] = this._shift([lat, lng], z);
    const target = { lat: tlat, lng: tlng };
    if (reduceMotion()) { this.map.setCenter(target); this.map.setZoom(z); return; }
    this.map.panTo(target);
    if (this.map.getZoom() !== z) this.map.setZoom(z);
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
    if (pts.length === 1) return this.flyToPoint(pts[0][0], pts[0][1], Math.min(maxZoom, 15));
    const b = new this.maps.LatLngBounds();
    for (const [lat, lng] of pts) b.extend({ lat, lng });
    this._fit(b, maxZoom);
  }

  _fit(bounds, maxZoom = 17, pad = 40) {
    const { maps, map } = this;
    map.fitBounds(bounds, { top: pad, left: pad, right: pad, bottom: pad + (this.opts.insetBottom || 0) });
    // fitBounds do Google não tem maxZoom: limitamos depois que a câmera assenta
    maps.event.addListenerOnce(map, 'idle', () => { if ((map.getZoom() ?? 0) > maxZoom) map.setZoom(maxZoom); });
  }

  /* ---------------- Localização do usuário ---------------- */
  /** Define a posição manualmente (ex.: se o app já tem o GPS). */
  setUserLocation(lat, lng) {
    if (!isNum(lat) || !isNum(lng)) return;
    this.userLatLng = [lat, lng];
    if (!this.userMarker) {
      this.userMarker = this.addHtmlMarker({
        lat, lng, size: [18, 18], anchor: [9, 9], interactive: false, zIndex: 500,
        html: '<div class="gdm-user"><span class="gdm-user__pulse"></span><span class="gdm-user__dot"></span></div>',
      });
    } else {
      this.userMarker.setPosition(lat, lng, 0);
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
  /** points: [[lat,lng], ...] ou [{lat,lng}, ...]. Linha sólida amarela de 5px sobre um halo escuro. */
  setRoute(points, { fit = true } = {}) {
    this.clearRoute();
    if (!points || points.length < 2) return;
    const path = points.map(toLatLng).filter(([a, b]) => isNum(a) && isNum(b)).map(([lat, lng]) => ({ lat, lng }));
    if (path.length < 2) return;
    const base = { map: this.map, path, clickable: false, zIndex: 1 };
    this.routeLines = [
      new this.maps.Polyline({ ...base, strokeColor: '#000', strokeOpacity: 0.55, strokeWeight: 9 }),
      new this.maps.Polyline({ ...base, strokeColor: ACCENT, strokeOpacity: 1, strokeWeight: 5, zIndex: 2 }),
    ];
    if (fit) {
      const b = new this.maps.LatLngBounds();
      path.forEach((p) => b.extend(p));
      this._fit(b);
    }
  }

  clearRoute() {
    for (const l of this.routeLines) l.setMap(null);
    this.routeLines = [];
  }

  /**
   * Círculo do raio de atendimento (km). km falsy remove. center padrão: usuário ou centro do mapa.
   * { fit: true } enquadra o círculo na tela.
   */
  setRadius(km, center, { fit = false, padding = 10, strokeWeight = 2, fillOpacity = 0.08 } = {}) {
    if (!isNum(km) || km <= 0) {
      this.circle?.setMap(null);
      this.circle = null;
      return;
    }
    const [lat, lng] = center ? toLatLng(center) : this.userLatLng || [this.map.getCenter().lat(), this.map.getCenter().lng()];
    const opts = { center: { lat, lng }, radius: km * 1000, strokeWeight, fillOpacity };
    if (this.circle) this.circle.setOptions(opts);
    else {
      this.circle = new this.maps.Circle({
        ...opts, map: this.map, clickable: false, strokeColor: ACCENT, strokeOpacity: 0.7, fillColor: ACCENT, zIndex: 1,
      });
    }
    if (fit) this.map.fitBounds(this.circle.getBounds(), padding);
  }

  /* ---------------- Ciclo de vida ---------------- */
  /** Chame quando o container mudar de tamanho/visibilidade (já é automático via ResizeObserver). */
  invalidateSize() {
    if (this._destroyed) return;
    const c = this.map.getCenter();
    this.maps.event.trigger(this.map, 'resize');
    if (c) this.map.setCenter(c);
  }

  destroy() {
    this._destroyed = true;
    this.stopLocate();
    authListeners.delete(this._onAuthFail);
    clearTimeout(this._readyTimer);
    this._ro?.disconnect();
    for (const cur of this.markers.values()) cur.marker.remove();
    this.markers.clear();
    this.userMarker?.remove();
    this.clearRoute();
    this.circle?.setMap(null);
    this.maps.event.clearInstanceListeners(this.map);
    this.canvas.remove();
    this.overlay.remove();
    this.loadingEl.remove();
    this.root.classList.remove('gdm-root');
  }
}

export default GoogleDarkMap;
