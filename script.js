import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, doc, setDoc, getDoc, getDocs, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
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
const lojasDB = []; // sem dados fictícios: só promotores reais

// ==========================================
// UTILITÁRIOS
// ==========================================
const $ = (id) => document.getElementById(id);
const hojeLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

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
    const lk = $("input-link-indicacao"); if (lk) lk.value = location.origin + location.pathname.replace(/[^/]*$/, "") + "index.html";
    const inpData = $("solicitacao-data");
    if (inpData) { inpData.min = hojeLocal(); if (!inpData.value) inpData.value = hojeLocal(); }
    renderPromotores();
    renderConversas();
    renderCalendario();
    carregarPedidos();
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
async function renderPromotores() {
    const lista = $("lista-personais-reais");
    if (!lista) return;
    let ativos = [];
    try {
        const s = await getDocs(query(collection(db, "profissionais"), where("status", "==", "ativo")));
        ativos = s.docs.map((d) => d.data());
    } catch (e) { console.warn("Promotores não carregados:", e.code); }
    lista.innerHTML = ativos.length ? ativos.map((p) => `
        <div class="glass trainer-card card-gold">
            <div class="trainer-header">
                <div class="avatar-container story-ring"><div class="avatar">${esc((p.nome || "P").charAt(0))}</div></div>
                <div class="trainer-info"><h4>${esc(p.nome)}</h4><p>${esc(p.especialidade || "Reposição e abastecimento")}</p>
                <div class="trainer-status status-online"><span class="dot"></span>Disponível</div></div>
            </div>
            <div class="trainer-actions"><button class="btn-action btn-fill" data-nome="${esc(p.nome)}" onclick="solicitarPromotorEspecifico(this.dataset.nome)">Solicitar</button></div>
        </div>`).join("") : vazio("🧑‍🔧", "Nenhum promotor ativo ainda", "Faça seu pedido acima: os promotores da região recebem a proposta.");
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
    const data = $("solicitacao-data").value, entrada = $("solicitacao-entrada").value, saida = $("solicitacao-saida").value;
    const valor = parseFloat($("solicitacao-valor").value);
    if (!local) { toast("Informe o nome/endereço da loja."); $("solicitacao-local").focus(); return; }
    if (!data) { toast("Escolha o dia do serviço."); return; }
    if (data < hojeLocal()) { toast("O dia não pode ser anterior a hoje."); return; }
    if (!entrada || !saida || saida <= entrada) { toast("A saída precisa ser depois da entrada."); return; }
    if (!(valor > 0)) { toast("Informe o valor que deseja pagar."); $("solicitacao-valor").focus(); return; }
    try {
        await addDoc(collection(db, "solicitacoes"), {
            uid: usuarioAtual.uid, email: usuarioAtual.email, loja: local,
            data, entrada, saida, horario: `${entrada}–${saida}`, valor,
            foco: $("solicitacao-foco").value, status: "aberta", criadoEm: serverTimestamp(), ...extra
        });
        toast("✅ Pedido enviado! Promotores com esse valor serão avisados.");
        $("solicitacao-local").value = ""; $("solicitacao-valor").value = "";
        $("rv-prom").textContent = fmtBRL(0); $("rv-taxa").textContent = fmtBRL(0);
        carregarPedidos();
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
// ==========================================
// PEDIDOS / AGENDA / CARTEIRA / MENU
// ==========================================
let pedidos = [];
let dataCalendario = new Date();
const ROTULO = { aberta: "Aguardando promotor", aceita: "Aceito", concluida: "Concluído", cancelada: "Cancelado" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtData = (d) => (d ? d.split("-").reverse().join("/") : "");
const fmtBRL = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const vazio = (i, t, x) => `<div class="empty-state"><div class="empty-icon">${i}</div><h4>${t}</h4><p>${x}</p></div>`;

async function carregarPedidos() {
    try {
        const snap = await getDocs(query(collection(db, "solicitacoes"), where("uid", "==", usuarioAtual.uid)));
        pedidos = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.criadoEm?.seconds || 0) - (a.criadoEm?.seconds || 0));
    } catch (e) { console.warn("Pedidos não carregados:", e.code); pedidos = []; }
    renderPedidos();
    renderCarteira();
    carregarProximoAbastecimento(pedidos.find((p) => p.status === "aberta" || p.status === "aceita"));
}

function cartaoPedido(p) {
    const st = p.status || "aberta";
    const etapa = st === "concluida" ? 3 : st === "aceita" ? 2 : 1;
    const barra = `<div class="steps-line"><span class="${etapa >= 1 ? "on" : ""}"></span><span class="${etapa >= 2 ? "on" : ""}"></span><span class="${etapa >= 3 ? "on" : ""}"></span></div>`;
    const pagar = st === "aceita" ? `<a class="btn-pagar-pedido" href="pagar.html?id=${encodeURIComponent(p.id)}">💳 Pagar com Pix</a>` : "";
    const quem = p.promotorNome ? ` · ${esc(p.promotorNome)}` : "";
    return `<div class="glass agenda-slot slot-${st === "concluida" ? "concluida" : st === "aberta" ? "livre" : "ocupado"}" style="flex-wrap:wrap">
        <div class="pedido-linha"><div class="slot-info-name">${esc(p.loja)}</div>
        <div class="slot-info-desc">${fmtData(p.data)} · ${esc(p.horario)} · ${esc(p.foco)} · ${fmtBRL(p.valor)}${quem}</div>${pagar}</div>
        <span class="badge badge-gold">${ROTULO[st] || st}</span>${barra}</div>`;
}
function renderPedidos() {
    const el = $("lista-pedidos");
    el.innerHTML = pedidos.length ? pedidos.map(cartaoPedido).join("") : vazio("🛒", "Nenhum pedido ainda", "Solicite um promotor na aba Início e acompanhe o andamento aqui.");
    el.style.cssText = "display:flex;flex-direction:column;gap:10px";
}
function renderCarteira() {
    $("cart-abertos").innerText = pedidos.filter((p) => p.status === "aberta" || p.status === "aceita").length;
    const total = pedidos.filter((p) => p.status === "concluida").reduce((s, p) => s + (p.valor || 0), 0);
    $("cart-total").innerText = total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function renderCalendario() {
    const grid = $("calendar-days-grid");
    const ano = dataCalendario.getFullYear(), mes = dataCalendario.getMonth();
    $("calendar-month-year").innerText = dataCalendario.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase());
    const primeiro = (new Date(ano, mes, 1).getDay() + 6) % 7, total = new Date(ano, mes + 1, 0).getDate(), hoje = new Date();
    let html = "<div></div>".repeat(primeiro);
    for (let d = 1; d <= total; d++) {
        const ehHoje = d === hoje.getDate() && mes === hoje.getMonth() && ano === hoje.getFullYear();
        html += `<div class="cal-day${ehHoje ? " today" : ""}" onclick="selecionarDia(${d})">${d}</div>`;
    }
    grid.innerHTML = html;
}
function mudarMesCalendario(n) { dataCalendario = new Date(dataCalendario.getFullYear(), dataCalendario.getMonth() + n, 1); renderCalendario(); }
function selecionarDia(d) {
    const data = new Date(dataCalendario.getFullYear(), dataCalendario.getMonth(), d);
    $("selected-date-label").innerText = "Turnos de " + data.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    const iso = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dia = pedidos.filter((p) => p.data === iso);
    $("lista-agenda").innerHTML = dia.length ? dia.map(cartaoPedido).join("") : vazio("📅", "Nenhum turno neste dia", "Pedidos para esta data aparecem aqui.");
}

const SUB = { pagamento: "pagamento", preferencias: "preferencias", indicar: "indicar", notificacoes: "notificacoes", ajuda: "ajuda" };
function abrirOpcaoMenu(n) { const e = $("subscreen-" + SUB[n]); if (e) e.style.display = "block"; }
function fecharSubtela(id) { $(id).style.display = "none"; }

async function salvarCampos(dados, msg, subId) {
    if (!usuarioAtual) return;
    try {
        await setDoc(doc(db, "contratantes", usuarioAtual.uid), { ...dados, atualizadoEm: serverTimestamp() }, { merge: true });
        toast(msg); fecharSubtela(subId);
    } catch (e) { console.error(e); toast("Não foi possível salvar. Verifique as regras do Firestore."); }
}
function salvarPagamento() { salvarCampos({ pagamento: { metodo: $("pg-metodo").value, documento: $("pg-doc").value.trim() } }, "✅ Forma de pagamento salva!", "subscreen-pagamento"); }
function salvarPreferencias() { salvarCampos({ preferencias: { setor: $("pref-setor").value, turno: $("pref-turno").value } }, "✅ Preferências salvas!", "subscreen-preferencias"); }
function copiarLinkIndicacao() { const i = $("input-link-indicacao"); i.select(); navigator.clipboard?.writeText(i.value); toast("📋 Link copiado!"); }
function compartilharWhatsApp() {
    const t = encodeURIComponent("Conheça o ABASTECE JÁ: promotores e repositores sob demanda para o varejo. " + $("input-link-indicacao").value);
    window.open("https://api.whatsapp.com/send?text=" + t, "_blank");
}

Object.assign(window, {
    mudarMesCalendario, selecionarDia, abrirOpcaoMenu, fecharSubtela, salvarPagamento, salvarPreferencias, copiarLinkIndicacao, compartilharWhatsApp, toast,
    initMap, loginGoogleAluno, logoutAluno, navTo, switchTab, toggleTheme,
    solicitarTreinoModoUber, solicitarPromotorEspecifico, salvarPerfilAluno,
    atualizarFotoPerfilAluno, abrirChatSimples
});

// Se o Maps carregou antes do módulo, inicia agora
if (window.google && window.google.maps) initMap();
