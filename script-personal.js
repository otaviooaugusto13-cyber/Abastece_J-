import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, getDocs, doc, setDoc, getDoc, updateDoc, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyA0Z1SEkqrtXuAjtFntv1WRvkKIuY1zilY",
    authDomain: "abastece-ja-240d5.firebaseapp.com",
    projectId: "abastece-ja-240d5",
    storageBucket: "abastece-ja-240d5.firebasestorage.app",
    messagingSenderId: "1061248119348",
    appId: "1:1061248119348:web:90d82ea266683086a39061",
    measurementId: "G-8XFZ5ZGK4L"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

const $ = (id) => document.getElementById(id);

let dadosPerfil = { nome: "Promotor", cpf: "", cref: "", uid: "", status: "pendente", fotoUrl: null };
let agendaDeHoje = [];
let ganhosAvulsos = 0;
let mapaOfertas = null;
let dataCalendario = new Date();
let diaSelecionado = null;

// ==========================================
// UTILITÁRIOS
// ==========================================
function toast(msg) {
    let t = $("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 3500);
}

function cpfValido(cpf) {
    cpf = (cpf || "").replace(/\D/g, "");
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    for (let t = 9; t < 11; t++) {
        let soma = 0;
        for (let i = 0; i < t; i++) soma += parseInt(cpf[i]) * (t + 1 - i);
        const dig = ((soma * 10) % 11) % 10;
        if (dig !== parseInt(cpf[t])) return false;
    }
    return true;
}

function setLoading(on) {
    $("login-loader").style.display = on ? "block" : "none";
    $("btn-login").style.display = on ? "none" : "block";
}

function mensagemErroAuth(error) {
    switch (error.code) {
        case "auth/unauthorized-domain": return "Domínio não autorizado no Firebase (Authentication → Settings → Domínios autorizados).";
        case "auth/operation-not-allowed": return "Login com Google não está ativado no Firebase.";
        case "auth/popup-closed-by-user":
        case "auth/cancelled-popup-request": return null;
        case "auth/network-request-failed": return "Sem conexão com a internet.";
        default: return "Falha ao autenticar com o Google. (" + (error.code || "erro") + ")";
    }
}

// ==========================================
// TERMOS (antes: funções não existiam → botão ficava desabilitado para sempre)
// ==========================================
function validarCheckTermos() {
    const ok = $("check-termos").checked;
    const btn = $("btn-login");
    btn.disabled = !ok;
    btn.style.opacity = ok ? "1" : "0.5";
    btn.style.cursor = ok ? "pointer" : "not-allowed";
}
function abrirModalTermos() { $("modal-termos").classList.add("active"); }
function aceitarTermosModal() {
    $("check-termos").checked = true;
    validarCheckTermos();
    $("modal-termos").classList.remove("active");
}

// ==========================================
// LOGIN POR CPF
// ==========================================
async function validarProfissional() {
    const nome = $("input-nome").value.trim();
    const cpf = $("input-cpf").value.replace(/\D/g, "");
    const cref = $("input-cref").value.trim();
    const lembreme = $("check-remember").checked;

    if (!nome || !cpf) { toast("Preencha nome e CPF."); return; }
    // Antes: exigia 14 dígitos (CNPJ), mas o campo aceita só 11 → login sempre falhava
    if (!cpfValido(cpf)) { toast("CPF inválido. Confira os 11 dígitos."); return; }

    setLoading(true);
    let status = "pendente";
    try {
        const ref = doc(db, "profissionais", cpf);
        const snap = await getDoc(ref);
        if (snap.exists()) {
            status = snap.data().status || "pendente";
            if (status === "bloqueado") { toast("❌ Acesso não liberado para este CPF."); setLoading(false); return; }
        } else {
            await setDoc(ref, { nome, cpf, cref, status: "pendente", criadoEm: serverTimestamp() });
        }
    } catch (e) {
        console.error("Firestore:", e);
        toast("Sem acesso ao banco agora. Entrando em modo offline (em análise).");
    }
    setLoading(false);
    finalizarLogin({ lembreme, nome, cpf, cref, status });
}

// ==========================================
// LOGIN GOOGLE
// ==========================================
async function acharProfissionalPorEmail(email) {
    const q = query(collection(db, "profissionais"), where("email", "==", email));
    const snap = await getDocs(q);
    return snap.empty ? null : snap.docs[0].data();
}

async function loginComGoogle() {
    if (!$("check-termos").checked) { toast("Aceite os Termos de Uso para continuar."); return; }
    try {
        const { user } = await signInWithPopup(auth, googleProvider);
        await processarUsuarioGoogle(user, true);
    } catch (error) {
        if (error.code === "auth/popup-blocked") {
            try { await signInWithRedirect(auth, googleProvider); return; } catch (e) { error = e; }
        }
        console.error(error);
        const msg = mensagemErroAuth(error);
        if (msg) toast(msg);
    }
}

async function processarUsuarioGoogle(user, interativo) {
    dadosPerfil.uid = user.uid;
    dadosPerfil.fotoUrl = user.photoURL;

    let prof = null;
    let erroBanco = false;
    try { prof = await acharProfissionalPorEmail(user.email); }
    catch (e) { erroBanco = true; console.error("Firestore (consulta profissionais):", e.code, e.message); }

    if (prof) {
        if (prof.status === "bloqueado") { toast("❌ Acesso não liberado para este e-mail."); return; }
        finalizarLogin({ lembreme: false, nome: prof.nome || user.displayName, cpf: prof.cpf || "", cref: prof.cref || "", status: prof.status || "pendente" });
        return;
    }
    // Restauração automática de sessão sem cadastro de promotor: fica na tela de login
    if (!interativo) return;

    // Primeiro acesso: cria o cadastro como "pendente" e ENTRA (sem prompt, que alguns navegadores bloqueiam).
    // O CPF pode ser preenchido depois em Menu → Perfil.
    if (!erroBanco) {
        try {
            await setDoc(doc(db, "profissionais", user.uid), {
                nome: user.displayName || "", email: user.email, uid: user.uid, cpf: "", cref: "",
                fotoGoogle: user.photoURL || "", status: "pendente", criadoEm: serverTimestamp()
            });
        } catch (e) {
            erroBanco = true;
            console.error("Firestore (criar cadastro):", e.code, e.message);
        }
    }
    if (erroBanco) toast("Entrou, mas o banco recusou a leitura/gravação. Ajuste as regras do Firestore.");
    finalizarLogin({ lembreme: false, nome: user.displayName || user.email, cpf: "", cref: "", status: "pendente" });
}

onAuthStateChanged(auth, (user) => { if (user) processarUsuarioGoogle(user, false); });
getRedirectResult(auth).then((r) => { if (r && r.user) processarUsuarioGoogle(r.user, true); }).catch((e) => {
    const msg = mensagemErroAuth(e); if (msg) toast(msg);
});

// ==========================================
// SESSÃO / DASHBOARD
// ==========================================
window.addEventListener("DOMContentLoaded", () => {
    try {
        const salvo = JSON.parse(localStorage.getItem("abastece_ja_promotor") || "null");
        if (salvo) { $("input-nome").value = salvo.nome || ""; $("check-remember").checked = true; }
    } catch (e) {}
});

function finalizarLogin({ lembreme, nome, cpf, cref, status }) {
    dadosPerfil = { ...dadosPerfil, nome: nome || "Promotor", cpf, cref, status };

    try {
        // Guarda só o nome (CPF no localStorage é dado pessoal exposto)
        if (lembreme) localStorage.setItem("abastece_ja_promotor", JSON.stringify({ nome }));
        else localStorage.removeItem("abastece_ja_promotor");
    } catch (e) {}

    atualizarExibicaoPerfil();
    const aprovado = status === "ativo";
    $("card-status-analise").style.display = aprovado ? "none" : "block";
    const aviso = document.querySelector("#tab-agenda .glass[style*='border-left']");
    if (aviso) aviso.style.display = aprovado ? "none" : "flex";

    $("screen-login-personal").classList.remove("active");
    $("screen-dashboard").classList.add("active");
    carregarAgendaDoBanco();
    renderizarCalendario();
    renderizarOfertas();
}

async function sairModoPessoal() {
    if (!confirm("Deseja realmente sair do portal?")) return;
    try { await signOut(auth); } catch (e) {}
    $("screen-dashboard").classList.remove("active");
    $("screen-login-personal").classList.add("active");
}

function atualizarExibicaoPerfil() {
    const inicial = (dadosPerfil.nome || "P").charAt(0).toUpperCase();
    $("perfil-nome-display").innerText = dadosPerfil.nome;
    $("perfil-cref-display").innerText = dadosPerfil.status === "ativo" ? "Status: Ativo ✓" : "Status: Em análise";
    $("initials-perfil").innerText = inicial;
    if (dadosPerfil.fotoUrl) {
        const img = $("img-perfil-preview");
        img.src = dadosPerfil.fotoUrl;
        img.style.display = "block";
        $("initials-perfil").style.display = "none";
    }
    if ($("perfil-input-nome")) $("perfil-input-nome").value = dadosPerfil.nome;
    if ($("perfil-input-cpf") && dadosPerfil.cpf) $("perfil-input-cpf").value = dadosPerfil.cpf;
}

// ==========================================
// NAVEGAÇÃO
// ==========================================
function switchTabPersonal(tabId, navElement) {
    document.querySelectorAll("#screen-dashboard .tab-content").forEach((t) => t.classList.remove("active"));
    $(tabId).classList.add("active");
    document.querySelectorAll("#nav-personal .nav-item").forEach((i) => i.classList.remove("active"));
    if (navElement) navElement.classList.add("active");
    window.scrollTo(0, 0);
    if (tabId === "tab-ofertas") initMapAlunos();
}

const SUBTELAS = {
    "Perfil": "subscreen-perfil-detalhes",
    "Dados bancários": "subscreen-dados-bancarios",
    "Preferências de Atendimento": "subscreen-preferencias-atendimento",
    "Convidar Amigos": "subscreen-indicar-amigo",
    "Notificações": "subscreen-notificacoes",
    "Ajuda": "subscreen-ajuda"
};
function abrirOpcaoMenu(nome) {
    const id = SUBTELAS[nome];
    if (id) $(id).style.display = "block";
}
function fecharSubtela(id) { $(id).style.display = "none"; }

// ==========================================
// PERFIL / BANCO / PREFERÊNCIAS
// ==========================================
async function salvarMerge(dados) {
    const chave = dadosPerfil.cpf || dadosPerfil.uid;
    if (!chave) { toast("Faça login para salvar."); return; }
    await setDoc(doc(db, "profissionais", chave), { ...dados, atualizadoEm: serverTimestamp() }, { merge: true });
}

async function salvarPerfilProfissionalCompleto() {
    try {
        await salvarMerge({
            nome: $("perfil-input-nome").value.trim(),
            nascimento: $("perfil-input-nascimento").value,
            cidade: $("perfil-input-naturalidade").value.trim(),
            bio: $("personal-input-bio").value.trim()
            // Fotos de documento/selfie exigem Firebase Storage — ver orientações
        });
        dadosPerfil.nome = $("perfil-input-nome").value.trim() || dadosPerfil.nome;
        atualizarExibicaoPerfil();
        toast("✅ Perfil salvo!");
        fecharSubtela("subscreen-perfil-detalhes");
    } catch (e) { console.error(e); toast("Não foi possível salvar o perfil."); }
}

async function salvarDadosBancarios() {
    const agencia = $("bank-input-agencia").value.trim();
    const conta = $("bank-input-conta").value.trim();
    const pix = $("bank-input-chave-pix").value.trim();
    if (!pix && !(agencia && conta)) { toast("Informe a chave PIX ou agência e conta."); return; }
    try {
        await salvarMerge({
            banco: { banco: $("bank-select-banco").value, tipo: $("bank-select-tipo-conta").value, agencia, conta, digito: $("bank-input-digito").value.trim() },
            pix: { tipo: $("bank-select-tipo-pix").value, chave: pix }
        });
        toast("✅ Dados bancários salvos!");
        fecharSubtela("subscreen-dados-bancarios");
    } catch (e) { console.error(e); toast("Não foi possível salvar os dados bancários."); }
}

function atualizarFotoPerfil(event) {
    const file = event.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = (e) => { dadosPerfil.fotoUrl = e.target.result; atualizarExibicaoPerfil(); };
    r.readAsDataURL(file);
}

// ==========================================
// AGENDA / CALENDÁRIO
// ==========================================
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtBRL = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (d) => (d ? d.split("-").reverse().join("/") : "");
const chavePromotor = () => dadosPerfil.cpf || dadosPerfil.uid;
let valorMinimo = 0;

async function carregarAgendaDoBanco() {
    agendaDeHoje = [];
    try {
        const chave = chavePromotor();
        if (chave) {
            const snap = await getDocs(query(collection(db, "solicitacoes"), where("promotorChave", "==", chave)));
            agendaDeHoje = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => `${a.data}${a.entrada}`.localeCompare(`${b.data}${b.entrada}`));
        }
    } catch (e) { console.warn("Agenda não carregada:", e.code); }
    ganhosAvulsos = agendaDeHoje.filter((x) => x.status === "concluida").reduce((t, x) => t + x.valor * 0.85, 0);
    atualizarFinanceiro();
    renderizarAgenda();
}

function estadoVazio(icone, titulo, texto) {
    return `<div class="empty-state"><div class="empty-icon">${icone}</div><h4>${titulo}</h4><p>${texto}</p></div>`;
}

function renderizarAgenda() {
    atualizarProximaReposicao();
    const lista = $("lista-agenda"), resumo = $("lista-agenda-resumo");
    if (!agendaDeHoje.length) {
        const v = estadoVazio("📅", "Nenhum turno por aqui", "Os turnos que você aceitar nas Ofertas aparecem neste espaço.");
        lista.innerHTML = v; resumo.innerHTML = v; return;
    }
    const card = (x, acao) => `<div class="glass agenda-slot ${x.status === "concluida" ? "slot-concluida" : "slot-ocupado"}">
        <div class="slot-time">${esc(x.entrada)}</div>
        <div class="slot-info"><div class="slot-info-name">${esc(x.loja)}</div>
        <div class="slot-info-desc">${fmtData(x.data)} · ${esc(x.entrada)}–${esc(x.saida)} · ${esc(x.foco)} · você recebe ${fmtBRL(x.valor * 0.85)}</div></div>${acao}</div>`;
    lista.innerHTML = agendaDeHoje.map((x, i) => card(x, x.status === "aceita" ? `<div class="slot-actions"><button class="btn-slot-action btn-qr" onclick="mostrarQR(${i})">Cobrar (QR)</button></div>` : "")).join("");
    resumo.innerHTML = agendaDeHoje.map((x) => card(x, "")).join("");
}

function mostrarQR(i) {
    const x = agendaDeHoje[i];
    const base = location.origin + location.pathname.replace(/[^/]*$/, "");
    $("qr-box").innerHTML = "";
    if (window.QRCode) new QRCode($("qr-box"), { text: `${base}pagar.html?id=${encodeURIComponent(x.id)}`, width: 200, height: 200 });
    $("qr-valor").textContent = `Valor da loja: ${fmtBRL(x.valor)}`;
    $("qr-liquido").textContent = `Plataforma 15% (${fmtBRL(x.valor * 0.15)}) · Você recebe 85% (${fmtBRL(x.valor * 0.85)})`;
    $("modal-qr").classList.add("active");
}
function fecharQR() { $("modal-qr").classList.remove("active"); }

function atualizarFinanceiro() {
    const fmt = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    $("valor-avulso").innerText = fmt(ganhosAvulsos);
    $("valor-total").innerText = fmt(ganhosAvulsos);
}

function renderizarCalendario() {
    const grid = $("calendar-days-grid");
    if (!grid) return;
    const ano = dataCalendario.getFullYear(), mes = dataCalendario.getMonth();
    $("calendar-month-year").innerText = dataCalendario.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase());

    const primeiro = (new Date(ano, mes, 1).getDay() + 6) % 7; // semana começa na segunda
    const total = new Date(ano, mes + 1, 0).getDate();
    const hoje = new Date();
    let html = "";
    for (let i = 0; i < primeiro; i++) html += "<div></div>";
    for (let d = 1; d <= total; d++) {
        const ehHoje = d === hoje.getDate() && mes === hoje.getMonth() && ano === hoje.getFullYear();
        const sel = diaSelecionado === `${ano}-${mes}-${d}`;
        html += `<div class="cal-day${ehHoje ? " today" : ""}${sel ? " selected" : ""}" onclick="selecionarDia(${d})">${d}</div>`;
    }
    grid.innerHTML = html;
}
function mudarMesCalendario(delta) {
    dataCalendario = new Date(dataCalendario.getFullYear(), dataCalendario.getMonth() + delta, 1);
    renderizarCalendario();
}
function selecionarDia(d) {
    diaSelecionado = `${dataCalendario.getFullYear()}-${dataCalendario.getMonth()}-${d}`;
    const data = new Date(dataCalendario.getFullYear(), dataCalendario.getMonth(), d);
    $("selected-date-label").innerText = "Turnos de " + data.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    renderizarCalendario();
}

// ==========================================
// OFERTAS + MAPA
// ==========================================
async function renderizarOfertas() {
    const el = $("lista-demandas-cards");
    if (dadosPerfil.status !== "ativo") {
        el.innerHTML = estadoVazio("🔒", "Ofertas liberadas após aprovação", "Estamos analisando seu cadastro. Você será avisado por aqui.");
        return;
    }
    let lista = [];
    try {
        const chave = chavePromotor();
        if (chave) {
            const perfil = await getDoc(doc(db, "profissionais", chave));
            valorMinimo = Number(perfil.data()?.valorMin) || 0;
            if ($("pref-valor-min")) $("pref-valor-min").value = valorMinimo || "";
        }
        const snap = await getDocs(query(collection(db, "solicitacoes"), where("status", "==", "aberta")));
        lista = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.valor >= valorMinimo);
    } catch (e) { console.warn("Ofertas não carregadas:", e.code); }
    el.innerHTML = lista.length ? lista.map((x) => `<div class="glass agenda-slot slot-livre">
        <div class="slot-info"><div class="slot-info-name">${esc(x.loja)}</div>
        <div class="slot-info-desc">${fmtData(x.data)} · ${esc(x.entrada)}–${esc(x.saida)} · ${esc(x.foco)}<br>Você recebe <strong>${fmtBRL(x.valor * 0.85)}</strong> (loja paga ${fmtBRL(x.valor)})</div></div>
        <div class="slot-actions"><button class="btn-slot-action btn-qr" onclick="aceitarOferta('${x.id}')">Aceitar</button></div></div>`).join("")
        : estadoVazio("🛒", "Sem ofertas por enquanto", valorMinimo ? `Nenhuma proposta de ${fmtBRL(valorMinimo)} ou mais na região agora.` : "Novas demandas de reposição na sua região aparecerão aqui.");
}

async function aceitarOferta(id) {
    try {
        await updateDoc(doc(db, "solicitacoes", id), { status: "aceita", promotorChave: chavePromotor(), promotorNome: dadosPerfil.nome, aceitoEm: serverTimestamp() });
        toast("Turno aceito! Ele já está na sua agenda.");
        carregarAgendaDoBanco(); renderizarOfertas();
    } catch (e) { console.error(e); toast("Não foi possível aceitar. Outro promotor pode ter pegado."); }
}

async function salvarPrefs() {
    const v = parseFloat($("pref-valor-min").value) || 0;
    try {
        await salvarMerge({ valorMin: v, especialidade: $("pref-estilo").selectedOptions[0].text, disponibilidade: { inicio: $("pref-hora-inicio").value, fim: $("pref-hora-fim").value } });
        valorMinimo = v;
        toast("✅ Preferências salvas!");
        fecharSubtela("subscreen-preferencias-atendimento");
        renderizarOfertas();
    } catch (e) { console.error(e); toast("Não foi possível salvar as preferências."); }
}

function initMapAlunos() {
    const el = $("mapa-alunos");
    if (!el || !window.google || !window.google.maps) return;
    if (!mapaOfertas) {
        mapaOfertas = new google.maps.Map(el, {
            zoom: 14, center: { lat: -22.4389, lng: -46.8258 }, disableDefaultUI: true,
            styles: [
                { elementType: "geometry", stylers: [{ color: "#1a1a24" }] },
                { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
                { featureType: "road", elementType: "geometry", stylers: [{ color: "#2c2c38" }] },
                { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] }
            ]
        });
    } else {
        google.maps.event.trigger(mapaOfertas, "resize");
    }
}

// ==========================================
// CADASTRO DE LOJA, CHAT, PREFERÊNCIAS
// ==========================================
function abrirModalCadastrarAluno() { $("modal-cadastrar-aluno").classList.add("active"); }
function fecharModalCadastrarAluno() {
    $("modal-cadastrar-aluno").classList.remove("active");
    ["cpf", "nome", "objetivo", "preco", "dias", "horario", "frequencia"].forEach((k) => { const e = $("cad-aluno-" + k); if (e) e.value = ""; });
}
function confirmarCadastroAluno() {
    const nome = $("cad-aluno-nome").value.trim();
    if (!nome) { toast("Informe o nome da loja."); return; }
    agendaDeHoje.push({ hora: $("cad-aluno-horario").value.trim() || "12:00", loja: nome, setor: $("cad-aluno-objetivo").value.trim() || "Geral", status: "ocupado", valor: parseFloat($("cad-aluno-preco").value) || 100 });
    renderizarAgenda();
    fecharModalCadastrarAluno();
    toast("✅ Loja vinculada à sua escala!");
}

function fecharConversaModal() { $("modal-chat-flutuante").classList.remove("active"); }
function enviarMensagemChat() {
    const input = $("input-chat-msg");
    const texto = input.value.trim();
    if (!texto) return;
    const box = $("chat-box");
    const m = document.createElement("div");
    m.className = "msg msg-sent";
    m.textContent = texto;
    box.appendChild(m);
    input.value = "";
    box.scrollTop = box.scrollHeight;
}
function enviarPropostaPersonal() { toast("Orçamento enviado à loja."); }

function toggleDiaTrabalho(btn) { /* mantido no HTML inline */ }

Object.assign(window, {
    validarProfissional, loginComGoogle, validarCheckTermos, abrirModalTermos, aceitarTermosModal,
    abrirOpcaoMenu, fecharSubtela, salvarPerfilProfissionalCompleto, salvarDadosBancarios,
    atualizarFotoPerfil, sairModoPessoal, switchTabPersonal, mudarMesCalendario, selecionarDia,
    fazerCheckin, cancelarTurno, aceitarTurno, abrirModalCadastrarAluno, fecharModalCadastrarAluno,
    confirmarCadastroAluno, fecharConversaModal, enviarMensagemChat, enviarPropostaPersonal, initMapAlunos
});


// ==========================================
// PARIDADE COM O APP DO CONTRATANTE
// ==========================================
function toggleTheme() {
    const claro = $("theme-toggle").checked;
    document.body.classList.toggle("light-theme", claro);
    try { localStorage.setItem("abastece_tema", claro ? "claro" : "escuro"); } catch (e) {}
}
try {
    if (localStorage.getItem("abastece_tema") === "claro") {
        document.body.classList.add("light-theme");
        window.addEventListener("DOMContentLoaded", () => { const t = $("theme-toggle"); if (t) t.checked = true; });
    }
} catch (e) {}

async function salvarContato() {
    const tel = $("promotor-input-telefone").value.trim();
    if (!tel) { toast("Informe seu telefone ou WhatsApp."); return; }
    try { await salvarMerge({ telefone: tel }); toast("✅ Contato salvo!"); }
    catch (e) { console.error(e); toast("Não foi possível salvar o contato."); }
}

function atualizarProximaReposicao() {
    const el = $("proxima-reposicao");
    const prox = agendaDeHoje.find((x) => x.status === "aceita");
    if (el) el.textContent = prox ? `${fmtData(prox.data)} · ${prox.entrada}–${prox.saida} · ${prox.loja}` : "Nenhum turno agendado.";
}

window.addEventListener("DOMContentLoaded", () => {
    const c = $("lista-conversas-promotor");
    if (c) c.innerHTML = estadoVazio("💬", "Nenhuma conversa ainda", "Quando você aceitar um turno, o chat com a loja aparece aqui.");
});

Object.assign(window, { toggleTheme, salvarContato, toast, mostrarQR, fecharQR, aceitarOferta, salvarPrefs });
