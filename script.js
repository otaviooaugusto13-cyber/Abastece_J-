import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
    getAuth, signInWithPopup, signInWithRedirect, getRedirectResult,
    GoogleAuthProvider, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyA0Z1SEkqrtXuAjtFntv1WRvkKIuY1zilY",
    authDomain: "abastece-ja-240d5.firebaseapp.com",
    projectId: "abastece-ja-240d5",
    storageBucket: "abastece-ja-240d5.firebasestorage.app",
    messagingSenderId: "1061248119348",
    appId: "1:1061248119348:web:90d82ea266683086a39061",
    measurementId: "G-8XFZ5ZGK4L"
};

// ==========================================
// FIREBASE (antes não era inicializado — causa nº 1 do login quebrado)
// ==========================================
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

let usuarioAtual = null;
let mapRadar;
let userMarker;

// Banco de lojas/promotores (demonstração)
const lojasDB = [
    { nome: "Carlos Silva", especialidade: "Reposição de Gôndolas & Limpeza", lat: -22.4350, lng: -46.8220, elementId: "dist-0", nota: "4,9" },
    { nome: "Mariana Lima", especialidade: "Hortifrúti & Estoque", lat: -22.4430, lng: -46.8310, elementId: "dist-1", nota: "4,8" }
];

// ==========================================
// UTILITÁRIOS
// ==========================================
const $ = (id) => document.getElementById(id);

function toast(msg) {
    let t = $("toast");
    if (!t) {
        t = document.createElement("div");
        t.id = "toast";
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 3500);
}

function setLoginLoading(loading) {
    const btn = $("btn-login-aluno");
    if (!btn) return;
    btn.disabled = loading;
    btn.classList.toggle("loading", loading);
    btn.dataset.label = btn.dataset.label || btn.innerHTML;
    if (loading) btn.innerHTML = '<span class="spinner"></span> Entrando...';
    else btn.innerHTML = btn.dataset.label;
}

function mensagemErroAuth(error) {
    switch (error.code) {
        case "auth/unauthorized-domain":
            return "Domínio não autorizado no Firebase. Adicione este endereço em Authentication → Settings → Domínios autorizados.";
        case "auth/operation-not-allowed":
            return "Login com Google não está ativado no Firebase (Authentication → Sign-in method).";
        case "auth/popup-closed-by-user":
        case "auth/cancelled-popup-request":
            return null; // usuário fechou, sem alerta
        case "auth/network-request-failed":
            return "Sem conexão com a internet. Tente novamente.";
        default:
            return "Não foi possível entrar com o Google. (" + (error.code || "erro") + ")";
    }
}

// ==========================================
// LOGIN / LOGOUT
// ==========================================
async function loginGoogleAluno() {
    const termos = $("check-termos-aluno");
    if (termos && !termos.checked) {
        toast("Aceite os Termos de Uso para continuar.");
        return;
    }
    setLoginLoading(true);
    try {
        await signInWithPopup(auth, googleProvider);
        // onAuthStateChanged cuida do resto
    } catch (error) {
        if (error.code === "auth/popup-blocked") {
            // Celulares/navegadores que bloqueiam popup: usa redirecionamento
            try { await signInWithRedirect(auth, googleProvider); return; } catch (e) { error = e; }
        }
        console.error("Erro no login Google:", error);
        const msg = mensagemErroAuth(error);
        if (msg) toast(msg);
        setLoginLoading(false);
    }
}

async function logoutAluno() {
    try { await signOut(auth); } catch (e) { console.error(e); }
}

function mostrarApp(user) {
    usuarioAtual = user;
    const nome = user.displayName || user.email.split("@")[0];

    $("display-name-home").innerText = nome.split(" ")[0];
    $("display-name-profile").innerText = nome;

    const inicial = nome.charAt(0).toUpperCase();
    $("main-user-avatar").innerText = inicial;
    $("display-avatar-profile").innerText = inicial;

    if (user.photoURL) {
        const img = $("img-aluno-perfil-preview");
        img.src = user.photoURL;
        img.style.display = "block";
        $("display-avatar-profile").style.display = "none";
    }

    navTo("screen-main");
    renderPromotores();
    renderConversas();
    carregarPerfilLoja();
    carregarProximoAbastecimento();
    if (window.google && !mapRadar) initMap();
}

function mostrarLogin() {
    usuarioAtual = null;
    setLoginLoading(false);
    navTo("screen-login");
}

onAuthStateChanged(auth, (user) => {
    if (user) mostrarApp(user);
    else mostrarLogin();
});

getRedirectResult(auth).catch((error) => {
    const msg = mensagemErroAuth(error);
    if (msg) toast(msg);
});

// ==========================================
// NAVEGAÇÃO
// ==========================================
function navTo(screenId) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    $(screenId).classList.add("active");
    window.scrollTo(0, 0);
}

function switchTab(tabId, navElement) {
    document.querySelectorAll(".tab-content").forEach((t) => t.classList.remove("active"));
    $(tabId).classList.add("active");
    document.querySelectorAll(".nav-item").forEach((i) => i.classList.remove("active"));
    if (navElement) navElement.classList.add("active");
    window.scrollTo(0, 0);
}

function toggleTheme() {
    const claro = $("theme-toggle").checked;
    document.body.classList.toggle("light-theme", claro);
    try { localStorage.setItem("abastece_tema", claro ? "claro" : "escuro"); } catch (e) {}
}

try {
    if (localStorage.getItem("abastece_tema") === "claro") {
        document.body.classList.add("light-theme");
        const tg = $("theme-toggle");
        if (tg) tg.checked = true;
    }
} catch (e) {}

// ==========================================
// LISTAS (PROMOTORES / CONVERSAS)
// ==========================================
function renderPromotores() {
    const lista = $("lista-personais-reais");
    if (!lista) return;
    lista.innerHTML = lojasDB.map((p, i) => `
        <div class="glass trainer-card card-gold">
            <div class="trainer-header">
                <div class="avatar-container story-ring"><div class="avatar">${p.nome.charAt(0)}</div></div>
                <div class="trainer-info">
                    <h4>${p.nome} <span class="badge badge-gold">★ ${p.nota}</span></h4>
                    <p>${p.especialidade}</p>
                    <div class="trainer-status status-online"><span class="dot"></span>Disponível · <span id="${p.elementId}">calculando...</span></div>
                </div>
            </div>
            <div class="trainer-actions">
                <button class="btn-action btn-outline" onclick="abrirChatSimples('${p.nome}')">Mensagem</button>
                <button class="btn-action btn-fill" onclick="solicitarPromotorEspecifico('${p.nome}')">Solicitar</button>
            </div>
        </div>`).join("");
}

function renderConversas() {
    const el = $("lista-conversas");
    if (!el) return;
    el.innerHTML = `<div class="empty-state">
        <div class="empty-icon">💬</div>
        <h4>Nenhuma conversa ainda</h4>
        <p>Quando um promotor aceitar sua solicitação, o chat aparecerá aqui.</p>
    </div>`;
}

function abrirChatSimples(nome) {
    toast("Chat com " + nome + " estará disponível após a solicitação ser aceita.");
}

// ==========================================
// SOLICITAÇÕES (Firestore)
// ==========================================
async function enviarSolicitacao(extra = {}) {
    if (!usuarioAtual) { toast("Faça login primeiro."); return; }
    const local = $("solicitacao-local").value.trim();
    if (!local) { toast("Informe o nome/endereço da loja."); $("solicitacao-local").focus(); return; }

    try {
        await addDoc(collection(db, "solicitacoes"), {
            uid: usuarioAtual.uid,
            email: usuarioAtual.email,
            loja: local,
            horario: $("solicitacao-horario").value,
            foco: $("solicitacao-foco").value,
            status: "aberta",
            criadoEm: serverTimestamp(),
            ...extra
        });
        toast("✅ Solicitação enviada! Avisaremos quando um promotor aceitar.");
        $("solicitacao-local").value = "";
        carregarProximoAbastecimento({ loja: local, horario: $("solicitacao-horario").value });
    } catch (e) {
        console.error(e);
        toast("Não foi possível enviar. Verifique as regras do Firestore.");
    }
}

function solicitarTreinoModoUber() { enviarSolicitacao(); }
function solicitarPromotorEspecifico(nome) { enviarSolicitacao({ promotorPreferido: nome }); }

function carregarProximoAbastecimento(s) {
    const el = $("card-proximo-treino-conteudo");
    if (!el) return;
    if (!s) {
        el.innerHTML = '<p class="muted-line">Nenhum abastecimento agendado.</p>';
        return;
    }
    el.innerHTML = `<p style="font-size:14px;font-weight:600">${s.loja}</p>
                    <p class="muted-line">${s.horario} · aguardando promotor</p>`;
}

// ==========================================
// PERFIL DA LOJA
// ==========================================
async function carregarPerfilLoja() {
    try {
        const snap = await getDoc(doc(db, "contratantes", usuarioAtual.uid));
        if (snap.exists()) {
            const d = snap.data();
            if (d.ramo) $("aluno-select-objetivo").value = d.ramo;
            if (d.telefone) $("aluno-input-telefone").value = d.telefone;
        }
    } catch (e) { console.warn("Perfil não carregado:", e.code); }
}

async function salvarPerfilAluno() {
    if (!usuarioAtual) return;
    try {
        await setDoc(doc(db, "contratantes", usuarioAtual.uid), {
            nome: usuarioAtual.displayName || "",
            email: usuarioAtual.email,
            ramo: $("aluno-select-objetivo").value,
            telefone: $("aluno-input-telefone").value.trim(),
            atualizadoEm: serverTimestamp()
        }, { merge: true });
        toast("✅ Dados da loja salvos!");
    } catch (e) {
        console.error(e);
        toast("Erro ao salvar. Verifique as regras do Firestore.");
    }
}

function atualizarFotoPerfilAluno(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = $("img-aluno-perfil-preview");
        img.src = e.target.result;
        img.style.display = "block";
        $("display-avatar-profile").style.display = "none";
    };
    reader.readAsDataURL(file);
}

// ==========================================
// GOOGLE MAPS
// ==========================================
function initMap() {
    const el = $("mapa-quadrado");
    if (!el || mapRadar || !window.google) return;
    // Só cria o mapa com a tela visível (container oculto tem tamanho 0)
    if (!$("screen-main").classList.contains("active")) return;

    const pontoInicial = { lat: -22.4389, lng: -46.8258 };
    mapRadar = new google.maps.Map(el, {
        zoom: 14,
        center: pontoInicial,
        disableDefaultUI: true,
        styles: [
            { elementType: "geometry", stylers: [{ color: "#1a1a24" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#1a1a24" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
            { featureType: "road", elementType: "geometry", stylers: [{ color: "#2c2c38" }] },
            { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212123" }] },
            { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] }
        ]
    });

    const marcarLojas = (origem) => {
        lojasDB.forEach((loja) => {
            const m = new google.maps.Marker({ position: { lat: loja.lat, lng: loja.lng }, map: mapRadar, title: loja.nome });
            let texto = "Aprox. 1,2 km de você";
            if (origem) {
                const metros = google.maps.geometry.spherical.computeDistanceBetween(
                    new google.maps.LatLng(origem.lat, origem.lng),
                    new google.maps.LatLng(loja.lat, loja.lng)
                );
                texto = metros < 1000 ? `${Math.round(metros)} m de você` : `${(metros / 1000).toFixed(1)} km de você`;
            }
            const info = new google.maps.InfoWindow({
                content: `<div style="color:#000;font-weight:bold;padding:2px">${loja.nome}<br><span style="font-weight:normal;font-size:11px">📍 ${texto}</span></div>`
            });
            m.addListener("click", () => info.open(mapRadar, m));
            const elem = $(loja.elementId);
            if (elem) elem.innerText = texto;
        });
    };

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const eu = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                mapRadar.setCenter(eu);
                userMarker = new google.maps.Marker({
                    position: eu, map: mapRadar, title: "Você",
                    icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: "#ffd700", fillOpacity: 1, strokeWeight: 2, strokeColor: "#ffffff" }
                });
                marcarLojas(eu);
            },
            () => marcarLojas(null)
        );
    } else {
        marcarLojas(null);
    }
}

// ==========================================
// EXPORTS PARA O HTML (onclick="...")
// Módulos ES não expõem funções ao escopo global automaticamente.
// ==========================================
Object.assign(window, {
    initMap, loginGoogleAluno, logoutAluno, navTo, switchTab, toggleTheme,
    solicitarTreinoModoUber, solicitarPromotorEspecifico, salvarPerfilAluno,
    atualizarFotoPerfilAluno, abrirChatSimples
});

// Se o Maps carregou antes do módulo, inicia agora
if (window.google && window.google.maps) initMap();
