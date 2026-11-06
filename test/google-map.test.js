// Mapa Google (google-map.js): carregador do script, ícone girado e adaptador (raio, pins, falha de chave) com um `google` simulado.
import assert from "node:assert/strict";
import { carregarGoogleMaps, iconeCarro, criarMapaGoogle, ESTILO_ESCURO } from "../google-map.js";

let n = 0; const t = async (nome, fn) => { await fn(); n++; process.stdout.write(`  ✓ ${nome}\n`); };
const CARRO = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><rect x="7" y="3" width="10" height="18"/></svg>';

function fakeGoogle() {
  const log = [];
  class Marker { constructor(o) { this.o = o; this.map = o.map; log.push(["marker", o]); } setPosition(p) { this.o.position = p; log.push(["pos", p]); } setIcon(i) { this.o.icon = i; log.push(["icon"]); } setMap(m) { this.map = m; if (m === null) log.push(["removido"]); } }
  class Circle { constructor(o) { this.o = o; } setRadius(r) { this.o.radius = r; } getBounds() { return { raio: this.o.radius }; } setMap() {} }
  class MapaG { constructor(el, o) { this.el = el; this.o = o; this.fits = []; } fitBounds(b, pad) { this.fits.push([b, pad]); } }
  const maps = { Map: MapaG, Marker, Circle, Size: class { constructor(w, h) { this.w = w; this.h = h; } }, Point: class { constructor(x, y) { this.x = x; this.y = y; } },
    SymbolPath: { CIRCLE: 0 }, ControlPosition: { RIGHT_CENTER: 9 }, event: { trigger: (m, ev) => log.push(["evento", ev]) } };
  return { google: { maps }, log };
}
const janelaCom = (g) => ({ google: g?.google, document: undefined });

await t("iconeCarro: SVG com rotação do rumo e sem <svg> aninhado", () => {
  const u = iconeCarro(CARRO, 90), svg = decodeURIComponent(u.split(",")[1]);
  assert.match(u, /^data:image\/svg\+xml/); assert.match(svg, /rotate\(90 12 12\)/); assert.equal((svg.match(/<svg/g) || []).length, 1); assert.match(svg, /<rect/);
  assert.match(decodeURIComponent(iconeCarro(CARRO, "x").split(",")[1]), /rotate\(0 12 12\)/);
});
await t("estilo escuro: sem pontos de interesse e sem trânsito", () => {
  assert.ok(ESTILO_ESCURO.some((r) => r.featureType === "poi" && r.stylers[0].visibility === "off"));
  assert.ok(ESTILO_ESCURO.some((r) => r.featureType === "transit"));
});
await t("carregador: sem chave rejeita; com o Google já presente não baixa nada", async () => {
  await assert.rejects(carregarGoogleMaps("", { janela: {}, doc: {} }), /sem-chave/);
  const g = fakeGoogle(); assert.equal(await carregarGoogleMaps("K", { janela: { google: g.google } }), g.google);
});
await t("carregador: injeta o script com a chave, aceita o callback e não duplica", async () => {
  const filhos = []; const doc = { createElement: () => ({}), head: { appendChild: (s) => filhos.push(s) } }, janela = {};
  const p1 = carregarGoogleMaps("CHAVE&x=1", { doc, janela }), p2 = carregarGoogleMaps("CHAVE&x=1", { doc, janela });
  assert.equal(filhos.length, 1, "um único <script>"); assert.match(filhos[0].src, /^https:\/\/maps\.googleapis\.com\/maps\/api\/js\?key=CHAVE%26x%3D1&callback=__abasteceGoogleMapsPronto/);
  assert.equal(typeof janela.gm_authFailure, "function");
  janela.google = fakeGoogle().google; janela.__abasteceGoogleMapsPronto(); assert.equal(await p1, janela.google); assert.equal(await p2, janela.google);
});
await t("carregador: script bloqueado (CSP/rede) rejeita e permite nova tentativa", async () => {
  const filhos = []; const doc = { createElement: () => ({}), head: { appendChild: (s) => filhos.push(s) } }, janela = {};
  const p = carregarGoogleMaps("K", { doc, janela }); filhos[0].onerror(); await assert.rejects(p, /bloqueado/);
  const p2 = carregarGoogleMaps("K", { doc, janela }); assert.equal(filhos.length, 2, "tenta de novo depois de falhar"); filhos[1].onerror(); await assert.rejects(p2);
});
await t("adaptador: círculo + ajuste de zoom só quando o raio muda; pins criados, movidos, girados e removidos", async () => {
  const g = fakeGoogle(), el = { textContent: "x" };
  const mp = await criarMapaGoogle(el, { chave: "K", centro: { lat: -22.4, lng: -46.8 }, carroSvg: CARRO, janela: { google: g.google } });
  mp.raio(5); mp.raio(5); mp.raio(8);
  const marcadoresAntes = g.log.filter((l) => l[0] === "marker").length;
  mp.pins([{ pin: "a", lat: -22.41, lng: -46.81, rumo: 10, distKm: 1.5 }, { pin: "b", lat: -22.42, lng: -46.82, distKm: 2 }]);
  assert.equal(g.log.filter((l) => l[0] === "marker").length - marcadoresAntes, 2);
  mp.pins([{ pin: "a", lat: -22.411, lng: -46.811, rumo: 10, distKm: 1.5 }]);
  assert.equal(g.log.filter((l) => l[0] === "icon").length, 0, "mesmo rumo: não troca o ícone"); assert.equal(g.log.filter((l) => l[0] === "removido").length, 1, "b saiu do raio");
  mp.pins([{ pin: "a", lat: -22.412, lng: -46.812, rumo: 200, distKm: 1.5 }]);
  assert.equal(g.log.filter((l) => l[0] === "icon").length, 1, "rumo mudou: gira o carro");
  mp.invalidar(); assert.ok(g.log.some((l) => l[0] === "evento" && l[1] === "resize"));
  mp.destruir(); assert.equal(el.textContent, "");
});
await t("adaptador: chave recusada pelo Google (gm_authFailure) chama a reserva uma única vez", async () => {
  const g = fakeGoogle(), janela = { google: g.google }; let falhas = 0;
  // simula o que o carregador faz na 1ª carga, já que aqui o Google "já está presente"
  const filhos = []; const doc = { createElement: () => ({}), head: { appendChild: (s) => filhos.push(s) } }, jan2 = {};
  const p = carregarGoogleMaps("K", { doc, janela: jan2 }); jan2.google = g.google; jan2.__abasteceGoogleMapsPronto(); await p;
  await criarMapaGoogle({ textContent: "" }, { chave: "K", centro: { lat: 1, lng: 2 }, carroSvg: CARRO, aoFalhar: () => falhas++, janela: jan2 });
  jan2.gm_authFailure(); jan2.gm_authFailure(); assert.equal(falhas, 1);
});

process.stdout.write(`\n${n} testes do mapa Google passaram\n`);
