// ONLINE AUTOMÁTICO (promotor): ao abrir o app, a pessoa já aparece para as lojas próximas — sem interruptor, sem ação.
// Envia a posição a cada ~10 s enquanto o app está ABERTO e visível. O servidor mostra o promotor (pin anônimo, posição aproximada) no mapa das
// lojas dentro do raio definido pelo admin e o tira do mapa sozinho 45 s depois do último sinal (app fechado, sem rede, bateria).
// - Só aparece quem estiver habilitado (cadastro aprovado + treinamento): enquanto não estiver, o servidor recusa e tentamos de novo a cada 60 s,
//   então a pessoa passa a aparecer sozinha assim que for liberada.
// - Se a localização do aparelho estiver bloqueada, nada é exibido aqui (a aba Ofertas já pede/explica a permissão); tentamos de novo ao voltar ao app.
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, chamarFuncao } from "./firebase.js";
import { distanciaM, rumoRad } from "./geo.js";

const ENVIO_MS = 10_000, REPETIR_NAO_HABILITADO_MS = 60_000;

export function montarOnline() {
    let watch = null, timer = null, retomar = null, fix = null, anterior = null, ligado = false;

    async function enviar() {
        if (!ligado || !fix || document.hidden || !auth.currentUser) return;
        try { await chamarFuncao("promotor/online", { online: true, lat: fix.lat, lng: fix.lng, rumo: fix.rumo, precisao: fix.precisao }); }
        catch (e) {
            if (e.code === "promotor-nao-habilitado") { parar(false); retomar = setTimeout(iniciar, REPETIR_NAO_HABILITADO_MS); }   // ainda não liberado: tenta de novo depois
            /* rede/outros: o próximo ciclo tenta de novo; o servidor já esquece o promotor em 45 s */
        }
    }
    function iniciar() {
        if (ligado || !auth.currentUser || !("geolocation" in navigator)) return;
        clearTimeout(retomar); retomar = null; ligado = true;
        try {
            watch = navigator.geolocation.watchPosition((p) => {
                const atual = { lat: p.coords.latitude, lng: p.coords.longitude, precisao: Math.round(p.coords.accuracy) };
                let rumo = Number.isFinite(p.coords.heading) ? p.coords.heading : null;                                  // sem bússola: calcula pelo deslocamento
                if (rumo === null && anterior && distanciaM(anterior, atual) > 15) rumo = ((rumoRad(anterior, atual) * 180) / Math.PI + 360) % 360;
                if (!anterior || distanciaM(anterior, atual) > 15) anterior = atual;
                const primeiro = !fix; fix = { ...atual, rumo: rumo === null ? (fix?.rumo ?? null) : rumo };
                if (primeiro) enviar();                                                                                  // aparece já no primeiro sinal de GPS
            }, (e) => { if (e.code === 1) parar(false); }, { enableHighAccuracy: false, maximumAge: 5000, timeout: 20000 });   // 1 = permissão negada
        } catch (e) { ligado = false; return; }
        timer = setInterval(enviar, ENVIO_MS);
    }
    function parar(avisarServidor = true) {
        if (watch !== null) { try { navigator.geolocation.clearWatch(watch); } catch (e) { /* ignora */ } } watch = null;
        clearInterval(timer); timer = null; clearTimeout(retomar); retomar = null; ligado = false; fix = null; anterior = null;
        if (avisarServidor && auth.currentUser) chamarFuncao("promotor/online", { online: false }).catch(() => {});      // se falhar, o servidor tira o promotor sozinho em 45 s
    }
    document.addEventListener("visibilitychange", () => { if (document.hidden) return; if (!ligado && auth.currentUser) iniciar(); else enviar(); });
    onAuthStateChanged(auth, (u) => { if (!u) parar(false); else iniciar(); });
}
