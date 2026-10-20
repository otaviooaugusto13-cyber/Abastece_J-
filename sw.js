// Service worker do Abastece Já: o app abre mesmo sem internet (só a "casca"; os dados vêm do Firebase).
// Para forçar atualização depois de mudar arquivos, aumente o número da VERSAO.
const VERSAO = "abasteceja-v2";
const CASCA = ["./", "index.html", "promotor.html", "landing.html", "pagar.html", "nota.html", "style.css", "style-personal.css", "style-landing.css", "polish.css", "melhorias.css",
    "comum.js", "financeiro.js", "chat.js", "script.js", "script-personal.js", "manifest.json", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
    const req = e.request, url = new URL(req.url);
    if (req.method !== "GET" || url.origin !== location.origin) return;       // Firebase, Maps e Mercado Pago sempre vão à rede
    // rede primeiro (sempre a versão mais nova); se estiver offline, usa o cache
    e.respondWith(fetch(req).then((r) => { const copia = r.clone(); caches.open(VERSAO).then((c) => c.put(req, copia)); return r; }).catch(() => caches.match(req).then((r) => r || caches.match("index.html"))));
});
