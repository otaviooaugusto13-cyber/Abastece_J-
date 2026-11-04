// Mapa de promotores ONLINE (estilo "carrinhos" de app de transporte).
//   promotores_online/{uid}   { uid, lat, lng, rumo, precisaoM, atualizadoMs, expiraEm }  — escrito SÓ pelo servidor (POST /promotor/online)
// Como a loja enxerga: GET /loja/promotores-proximos → o servidor filtra por distância (haversine) até o raio definido pelo admin e devolve
// PINS ANÔNIMOS (sem nome/uid, coordenada arredondada a ~110 m). O navegador da loja nunca lê a coleção: não dá para varrer a frota inteira.
// Escala: o snapshot dos online fica em memória por 3 s e é compartilhado entre todas as lojas que consultam (N lojas = 1 leitura a cada 3 s).
// Para dezenas de milhares de promotores, troque o filtro em memória por geohash (campo `celula`) — a interface deste módulo não muda.
const crypto = require("crypto");
const G = require("./geo");

const MAPA = {
  HEARTBEAT_MIN_MS: 8_000,       // posição mais frequente que isso é ignorada (anti-abuso e economia de escrita)
  JANELA_ONLINE_MS: 45_000,      // "online" = posição recebida nos últimos 45 s (o app envia a cada ~10 s)
  SNAPSHOT_MS: 3_000,            // cache do conjunto de online
  ELEGIVEL_MS: 5 * 60_000,       // quanto tempo vale a checagem "promotor ativo e treinado"
  COORD_DECIMAIS: 3,             // 3 casas ≈ 110 m: o suficiente para o "carrinho" andar no mapa sem entregar o endereço da pessoa
  MAX_PINS: 100,                 // máximo de pins devolvidos (o contador continua exato)
  PRECISAO_MAX_M: 1_000,         // leitura de GPS pior que isso não serve para posicionar
  EXPIRA_MS: 60 * 60_000         // campo `expiraEm`: use uma política de TTL do Firestore nele para limpar docs esquecidos
};
const SAL = process.env.MAPA_SALT || "abastece-mapa-v1";
const arredondar = (n, d = MAPA.COORD_DECIMAIS) => Math.round(n * 10 ** d) / 10 ** d;
/** Identificador público estável (para o carrinho se mover no mesmo pin entre consultas) que NÃO revela o uid. */
const pinPublico = (uid) => crypto.createHmac("sha256", SAL).update(String(uid)).digest("base64url").slice(0, 10);
const rumoValido = (r) => (typeof r === "number" && Number.isFinite(r) && r >= 0 && r < 360 ? Math.round(r) : null);

/**
 * Núcleo geoespacial (PURO, testável): promotores online dentro de `raioKm` da origem, do mais perto para o mais longe.
 *   lista: [{ uid, lat, lng, rumo, atualizadoMs }]    origem: { lat, lng }    → [{ …p, distKm }]
 * Regra: distância (haversine) <= raio. Quem está online mas fora do raio simplesmente não aparece.
 */
function filtrarPorRaio(lista, origem, raioKm, { agora = Date.now(), janelaMs = MAPA.JANELA_ONLINE_MS } = {}) {
  const limiteM = raioKm * 1000, out = [];
  for (const p of lista) {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng) || agora - (p.atualizadoMs || 0) > janelaMs) continue;
    const d = G.distanciaM(origem, p);
    if (d <= limiteM) out.push({ ...p, distKm: d / 1000 });
  }
  return out.sort((a, b) => a.distKm - b.distKm);
}
/** O que a LOJA recebe de cada promotor: nada que identifique a pessoa. */
const pinAnonimo = (p) => ({ pin: pinPublico(p.uid), lat: arredondar(p.lat), lng: arredondar(p.lng), rumo: p.rumo ?? null, distKm: Math.round(p.distKm * 10) / 10 });

function criarMapa({ db, Timestamp }) {
  const COL = "promotores_online";
  const ultimo = new Map();        // uid → ms da última gravação (limite por instância; entre instâncias vale o `atualizadoMs` do documento)
  const elegivel = new Map();      // uid → { ok, ate }
  let snap = null;

  async function podeFicarOnline(uid) {
    const c = elegivel.get(uid); if (c && c.ate > Date.now()) return c.ok;
    const p = (await db.collection("profissionais").doc(uid).get()).data(), ok = !!p && p.status === "ativo" && !!p.treinamentoOk;
    elegivel.set(uid, { ok, ate: Date.now() + MAPA.ELEGIVEL_MS }); return ok;
  }
  /** Registra a posição. Devolve { gravado, motivo? }. `motivo: "nao-habilitado"` quando o cadastro ainda não está ativo/treinado. */
  async function posicao(uid, b) {
    const c = G.coordenadas(b, "posição"), agora = Date.now();
    const prec = Number.isFinite(b?.precisao) ? Math.max(0, Math.round(b.precisao)) : null;
    if (prec !== null && prec > MAPA.PRECISAO_MAX_M) return { gravado: false, motivo: "gps-impreciso" };
    if (agora - (ultimo.get(uid) || 0) < MAPA.HEARTBEAT_MIN_MS) return { gravado: false, motivo: "muito-rapido" };
    if (!(await podeFicarOnline(uid))) return { gravado: false, motivo: "nao-habilitado" };
    ultimo.set(uid, agora);
    await db.collection(COL).doc(uid).set({ uid, lat: c.lat, lng: c.lng, rumo: rumoValido(b?.rumo), precisaoM: prec, atualizadoMs: agora, expiraEm: Timestamp.fromMillis(agora + MAPA.EXPIRA_MS) });
    return { gravado: true };
  }
  async function offline(uid) { ultimo.delete(uid); snap = null; await db.collection(COL).doc(uid).delete(); }

  /** Documentos de quem enviou posição na janela de "online" (cache de 3 s, compartilhado por todas as consultas). */
  async function online() {
    const agora = Date.now(); if (snap && agora - snap.t < MAPA.SNAPSHOT_MS) return snap.lista;
    const s = await db.collection(COL).where("atualizadoMs", ">=", agora - MAPA.JANELA_ONLINE_MS).limit(2000).get();
    const lista = s.docs.map((d) => d.data()); snap = { t: agora, lista }; return lista;
  }
  /** Visão da LOJA: { raioKm, total, pins[] }. `total` é a contagem exata dentro do raio; `pins` é limitado a MAX_PINS (os mais perto). */
  async function proximos({ lat, lng, raioKm }) {
    const dentro = filtrarPorRaio(await online(), { lat, lng }, raioKm);
    return { raioKm, total: dentro.length, pins: dentro.slice(0, MAPA.MAX_PINS).map(pinAnonimo), geradoEm: new Date().toISOString() };
  }
  const contarOnline = async () => (await online()).length;
  return { posicao, offline, online, proximos, contarOnline, limparCache: () => { snap = null; ultimo.clear(); elegivel.clear(); }, MAPA };
}
module.exports = { criarMapa, filtrarPorRaio, pinAnonimo, pinPublico, arredondar, MAPA };
