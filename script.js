// ==========================================================================
// ABASTECE JÁ — App do contratante (loja)
// ==========================================================================
import { collection, addDoc, doc, setDoc, getDoc, getDocs, updateDoc, query, where, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, db, googleProvider, $, esc, brl, fmtData, hojeLocal, vazio, skeleton, toast, docValido, mascaraDoc, mascaraTel, aplicarMascara, iniciarTema, alternarTema, mensagemErroAuth, notificar, pedirPermissaoNotificar } from "./comum.js";
import { calcularRepasse, TAXA_PROMOTOR, TAXA_APP, TAXA_FIXA_CENTAVOS } from "./financeiro.js";
import { abrirChat } from "./chat.js";

let usuarioAtual = null, perfilLoja = {}, mapRadar, userMarker;
let pedidos = [], notas = [], filtroPedidos = "todos", dataCalendario = new Date();
let cancelarPedidos = null, cancelarNotas = null;
const statusAnterior = new Map();
const ROTULO = { aberta: "Aguardando promotor", aceita: "Aceito", concluida: "Pago ✓", cancelada: "Cancelado" };
const pct = (n) => Math.round(n * 100);

iniciarTema();

// ==========================================================================
// LOGIN / LOGOUT
// ==========================================================================
function setLoginLoading(on) {
    const btn = $("btn-login-aluno"); if (!btn) return;
    btn.dataset.label = btn.dataset.label || btn.innerHTML;
    btn.disabled = on; btn.innerHTML = on ? '<span class="spinner"></span> Entrando...' : btn.dataset.label;
}
async function loginGoogleAluno() {
    if (!$("check-termos-aluno").checked) return toast("Aceite os Termos de Uso para continuar.", "erro");
    setLoginLoading(true);
    try { await signInWithPopup(auth, googleProvider); }
    catch (error) {
        if (error.code === "auth/popup-blocked") { try { await signInWithRedirect(auth, googleProvider); return; } catch (e) { error = e; } }
        const msg = mensagemErroAuth(error); if (msg) toast(msg, "erro");
        setLoginLoading(false);
    }
}
async function logoutAluno() {
    if (!confirm("Deseja sair da conta?")) return;
    cancelarPedidos?.(); cancelarNotas?.();
    try { await signOut(auth); } catch (e) { console.error(e); }
}
getRedirectResult(auth).catch((e) => { const m = mensagemErroAuth(e); if (m) toast(m, "erro"); });

onAuthStateChanged(auth, (user) => user ? mostrarApp(user) : mostrarLogin());

function mostrarLogin() { usuarioAtual = null; setLoginLoading(false); navTo("screen-login"); }

async function mostrarApp(user) {
    usuarioAtual = user;
    const nome = user.displayName || user.email.split("@")[0];
    $("display-name-home").innerText = nome.split(" ")[0];
    $("display-name-profile").innerText = nome;
    $("main-user-avatar").innerText = $("display-avatar-profile").innerText = nome.charAt(0).toUpperCase();
    if (user.photoURL) { const i = $("img-aluno-perfil-preview"); i.src = user.photoURL; i.style.display = "block"; $("display-avatar-profile").style.display = "none"; }
    navTo("screen-main");
    const base = location.origin + location.pathname.replace(/[^/]*$/, "");
    $("input-link-indicacao").value = base + "index.html";
    const d = $("solicitacao-data"); d.min = hojeLocal(); if (!d.value) d.value = hojeLocal();
    $("lista-pedidos").innerHTML = skeleton(3);
    $("lista-personais-reais").innerHTML = skeleton(2);
    await carregarPerfilLoja();
    renderPromotores();
    renderCalendario();
    ouvirPedidos();
    ouvirNotas();
    atualizarResumoValor();
    if (window.google && !mapRadar) initMap();
}

// ==========================================================================
// NAVEGAÇÃO
// ==========================================================================
function navTo(id) { document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active")); $(id).classList.add("active"); window.scrollTo(0, 0); }
function switchTab(tabId, el) {
    document.querySelectorAll(".tab-content").forEach((t) => t.classList.remove("active"));
    $(tabId).classList.add("active");
    document.querySelectorAll(".nav-item").forEach((i) => { i.classList.remove("active"); i.removeAttribute("aria-current"); });
    if (el) { el.classList.add("active"); el.setAttribute("aria-current", "page"); }
    window.scrollTo(0, 0);
    if (tabId === "tab-home" && window.google && !mapRadar) initMap();
}

// ==========================================================================
// FORMULÁRIO DE PEDIDO + PRÉVIA DO SPLIT (80% / 20% + taxa fixa)
// ==========================================================================
function atualizarResumoValor() {
    const r = calcularRepasse(parseFloat($("solicitacao-valor").value) || 0);
    $("rv-prom").textContent = brl(r.promotor); $("rv-taxa").textContent = brl(r.comissao);
    $("rv-fixa").textContent = brl(r.taxaFixa); $("rv-total").textContent = brl(r.totalLoja);
}
function iniciarFormulario() {
    $("setor-grid").addEventListener("click", (e) => {
        const b = e.target.closest(".setor-chip"); if (!b) return;
        document.querySelectorAll("#setor-grid .setor-chip").forEach((c) => { c.classList.remove("sel"); c.setAttribute("aria-checked", "false"); });
        b.classList.add("sel"); b.setAttribute("aria-checked", "true");
        $("solicitacao-foco").value = b.dataset.v;
    });
    $("solicitacao-valor").addEventListener("input", atualizarResumoValor);
    aplicarMascara("pg-doc", mascaraDoc); aplicarMascara("aluno-input-telefone", mascaraTel);
    document.querySelectorAll(".r-pct-prom").forEach((e) => (e.textContent = pct(TAXA_PROMOTOR)));
    document.querySelectorAll(".r-pct-app").forEach((e) => (e.textContent = pct(TAXA_APP)));
    document.querySelectorAll(".r-fixa").forEach((e) => (e.textContent = brl(TAXA_FIXA_CENTAVOS / 100)));
    $("filtros-pedidos").addEventListener("click", (e) => {
        const b = e.target.closest("button[data-f]"); if (!b) return;
        filtroPedidos = b.dataset.f;
        document.querySelectorAll("#filtros-pedidos button").forEach((x) => x.classList.toggle("on", x === b));
        renderPedidos();
    });
    ["lista-pedidos", "lista-agenda", "lista-conversas"].forEach((id) => $(id).addEventListener("click", acaoPedido));
}
document.addEventListener("DOMContentLoaded", iniciarFormulario);

async function enviarSolicitacao(extra = {}) {
    if (!usuarioAtual) return toast("Faça login primeiro.", "erro");
    const local = $("solicitacao-local").value.trim();
    const data = $("solicitacao-data").value, entrada = $("solicitacao-entrada").value, saida = $("solicitacao-saida").value;
    const valor = parseFloat($("solicitacao-valor").value);
    if (!local) { toast("Informe o nome/endereço da loja.", "erro"); return $("solicitacao-local").focus(); }
    if (!data) return toast("Escolha o dia do serviço.", "erro");
    if (data < hojeLocal()) return toast("O dia não pode ser anterior a hoje.", "erro");
    if (!entrada || !saida || saida <= entrada) return toast("A saída precisa ser depois da entrada.", "erro");
    if (!(valor >= 1 && valor <= 5000)) { toast("Informe um valor entre R$ 1 e R$ 5.000.", "erro"); return $("solicitacao-valor").focus(); }
    if (!docValido(perfilLoja.pagamento?.documento)) {
        toast("Cadastre o CNPJ/CPF da loja para que a nota seja emitida.", "erro");
        return abrirOpcaoMenu("pagamento");
    }
    const btn = $("btn-solicitar"); btn.disabled = true;
    try {
        await addDoc(collection(db, "solicitacoes"), {
            uid: usuarioAtual.uid, email: usuarioAtual.email, loja: local,
            docNota: perfilLoja.pagamento.documento, nomeNota: perfilLoja.pagamento.nome || local,
            data, entrada, saida, horario: `${entrada}–${saida}`, valor,
            foco: $("solicitacao-foco").value, status: "aberta", criadoEm: serverTimestamp(), ...extra
        });
        toast("✅ Pedido enviado! Os promotores da região foram avisados.", "ok");
        $("solicitacao-local").value = ""; $("solicitacao-valor").value = ""; atualizarResumoValor();
        switchTab("tab-pedidos", document.querySelectorAll(".nav-item")[1]);
    } catch (e) { console.error(e); toast("Não foi possível enviar o pedido. Tente de novo.", "erro"); }
    btn.disabled = false;
}
const solicitarTreinoModoUber = () => enviarSolicitacao();
const solicitarPromotorEspecifico = (nome) => enviarSolicitacao({ promotorPreferido: nome });

// ==========================================================================
// PEDIDOS EM TEMPO REAL
// ==========================================================================
function ouvirPedidos() {
    cancelarPedidos?.();
    cancelarPedidos = onSnapshot(query(collection(db, "solicitacoes"), where("uid", "==", usuarioAtual.uid)), (snap) => {
        pedidos = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.criadoEm?.seconds || 9e9) - (a.criadoEm?.seconds || 9e9));
        pedidos.forEach((p) => {                                  // avisa quando algo muda sozinho
            const ant = statusAnterior.get(p.id);
            if (ant && ant !== p.status) {
                if (p.status === "aceita") notificar("Promotor a caminho!", `${p.promotorNome || "Um promotor"} aceitou seu pedido.`);
                if (p.status === "concluida") notificar("Pagamento confirmado", "Sua nota já está disponível na Carteira.");
            }
            statusAnterior.set(p.id, p.status);
        });
        renderPedidos(); renderCarteira(); renderConversas(); renderProximo();
        if ($("selected-date-label").dataset.iso) selecionarDia(+$("selected-date-label").dataset.dia);
        renderCalendario();
    }, (e) => { console.warn("Pedidos:", e.code); $("lista-pedidos").innerHTML = vazio("⚠️", "Não foi possível carregar", "Verifique sua conexão e as regras do Firestore."); });
}
function ouvirNotas() {
    cancelarNotas?.();
    cancelarNotas = onSnapshot(query(collection(db, "notas"), where("contratanteUid", "==", usuarioAtual.uid)), (snap) => {
        notas = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.emitidaEm?.seconds || 0) - (a.emitidaEm?.seconds || 0));
        renderCarteira();
    }, (e) => console.warn("Notas:", e.code));
}

function acoesPedido(p) {
    const a = [];
    if (p.status === "aceita") {
        a.push(`<a class="btn-pagar-pedido" href="pagar.html?id=${encodeURIComponent(p.id)}">💳 Pagar ${brl(calcularRepasse(p.valor).totalLoja)}</a>`);
        a.push(`<button class="btn-mini" data-acao="chat" data-id="${p.id}">💬 Chat</button>`);
    }
    if (p.status === "concluida") {
        a.push(`<a class="btn-mini" href="nota.html?id=${encodeURIComponent(p.id)}">🧾 Nota</a>`);
        a.push(`<button class="btn-mini" data-acao="chat" data-id="${p.id}">💬 Chat</button>`);
        if (!p.avaliacao) a.push(`<button class="btn-mini destaque" data-acao="avaliar" data-id="${p.id}">⭐ Avaliar</button>`);
    }
    if (p.status === "aberta" || p.status === "aceita") a.push(`<button class="btn-mini perigo" data-acao="cancelar" data-id="${p.id}">Cancelar</button>`);
    return a.length ? `<div class="pedido-acoes">${a.join("")}</div>` : "";
}
function cartaoPedido(p) {
    const st = p.status || "aberta";
    const etapa = st === "concluida" ? 3 : st === "aceita" ? 2 : st === "cancelada" ? 0 : 1;
    const barra = `<div class="steps-line">${[1, 2, 3].map((n) => `<span class="${etapa >= n ? "on" : ""}"></span>`).join("")}</div>`;
    const quem = p.promotorNome ? ` · ${esc(p.promotorNome)}` : "";
    const estrelas = p.avaliacao ? ` · ${"★".repeat(p.avaliacao.nota)}${"☆".repeat(5 - p.avaliacao.nota)}` : "";
    return `<article class="glass agenda-slot slot-${st === "concluida" ? "concluida" : st === "aberta" ? "livre" : st === "cancelada" ? "cancelada" : "ocupado"}" style="flex-wrap:wrap">
        <div class="pedido-linha"><div class="slot-info-name">${esc(p.loja)}</div>
        <div class="slot-info-desc">${fmtData(p.data)} · ${esc(p.horario)} · ${esc(p.foco)} · ${brl(p.valor)}${quem}${estrelas}</div>${acoesPedido(p)}</div>
        <span class="badge badge-gold">${ROTULO[st] || st}</span>${barra}</article>`;
}
function renderPedidos() {
    const lista = pedidos.filter((p) => filtroPedidos === "todos" || (filtroPedidos === "abertos" ? p.status === "aberta" || p.status === "aceita" : p.status === filtroPedidos));
    $("lista-pedidos").innerHTML = lista.length ? lista.map(cartaoPedido).join("") : vazio("🛒", "Nada por aqui", filtroPedidos === "todos" ? "Solicite um promotor na aba Início e acompanhe o andamento aqui." : "Nenhum pedido neste filtro.");
}
function renderProximo() {
    const s = pedidos.filter((p) => p.status === "aberta" || p.status === "aceita").sort((a, b) => `${a.data}${a.entrada}`.localeCompare(`${b.data}${b.entrada}`))[0];
    $("card-proximo-treino-conteudo").innerHTML = s
        ? `<p style="font-size:14px;font-weight:600">${esc(s.loja)}</p><p class="muted-line">${fmtData(s.data)} · ${esc(s.horario)} · ${s.status === "aceita" ? "com " + esc(s.promotorNome) : "aguardando promotor"}</p>`
        : '<p class="muted-line">Nenhum abastecimento agendado.</p>';
}
function renderConversas() {
    const com = pedidos.filter((p) => p.promotorUid && p.status !== "cancelada");
    $("lista-conversas").innerHTML = com.length ? com.map((p) => `<button class="glass conversa-item" data-acao="chat" data-id="${p.id}"><div class="avatar">${esc((p.promotorNome || "P").charAt(0))}</div><div><strong>${esc(p.promotorNome)}</strong><br><small class="muted-line">${esc(p.loja)} · ${fmtData(p.data)}</small></div><span class="option-arrow">›</span></button>`).join("")
        : vazio("💬", "Nenhuma conversa ainda", "Quando um promotor aceitar sua solicitação, o chat aparece aqui.");
}

async function acaoPedido(e) {
    const b = e.target.closest("[data-acao]"); if (!b) return;
    const p = pedidos.find((x) => x.id === b.dataset.id); if (!p) return;
    if (b.dataset.acao === "chat") return abrirChat(p.id, p.promotorNome || "Promotor", `${p.loja} · ${fmtData(p.data)}`);
    if (b.dataset.acao === "avaliar") return abrirAvaliacao(p);
    if (b.dataset.acao === "cancelar") {
        if (!confirm(p.status === "aceita" ? "O promotor já aceitou este turno. Cancelar mesmo assim?" : "Cancelar este pedido?")) return;
        try { await updateDoc(doc(db, "solicitacoes", p.id), { status: "cancelada", canceladoEm: serverTimestamp() }); toast("Pedido cancelado."); }
        catch (err) { console.error(err); toast("Não foi possível cancelar.", "erro"); }
    }
}

// ---------- avaliação (estrelas) ----------
function abrirAvaliacao(p) {
    let m = $("modal-avaliar");
    if (!m) { m = document.createElement("div"); m.id = "modal-avaliar"; m.className = "app-overlay"; document.body.appendChild(m); }
    let nota = 0;
    m.innerHTML = `<div class="glass modal-box" style="text-align:center"><h3 style="color:var(--gold)">Como foi o turno?</h3><p class="muted-line" style="margin:6px 0 14px">${esc(p.promotorNome)} · ${esc(p.loja)}</p>
        <div class="estrelas" role="radiogroup" aria-label="Nota">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="false" aria-label="${n} estrelas" data-n="${n}">★</button>`).join("")}</div>
        <button class="btn btn-primary" id="av-ok" disabled style="margin-top:16px">Enviar avaliação</button><button class="btn btn-outline" id="av-x" style="margin-top:8px">Agora não</button></div>`;
    m.classList.add("active");
    m.querySelector(".estrelas").onclick = (e) => { const s = e.target.closest("button"); if (!s) return; nota = +s.dataset.n;
        m.querySelectorAll(".estrelas button").forEach((x) => { x.classList.toggle("on", +x.dataset.n <= nota); x.setAttribute("aria-checked", +x.dataset.n === nota); }); $("av-ok").disabled = false; };
    $("av-x").onclick = () => m.classList.remove("active");
    $("av-ok").onclick = async () => {
        try { await updateDoc(doc(db, "solicitacoes", p.id), { avaliacao: { nota, em: hojeLocal() } }); toast("Obrigado pela avaliação! ⭐", "ok"); }
        catch (e) { console.error(e); toast("Não foi possível enviar a avaliação.", "erro"); }
        m.classList.remove("active");
    };
}

// ==========================================================================
// PROMOTORES DISPONÍVEIS
// ==========================================================================
async function renderPromotores() {
    const lista = $("lista-personais-reais"); let ativos = [];
    try { ativos = (await getDocs(query(collection(db, "profissionais"), where("status", "==", "ativo")))).docs.map((d) => d.data()); }
    catch (e) { console.warn("Promotores:", e.code); }
    ativos.sort((a, b) => (b.notaMedia || 0) - (a.notaMedia || 0));
    lista.innerHTML = ativos.length ? ativos.map((p) => `<div class="glass trainer-card card-gold"><div class="trainer-header">
        <div class="avatar-container story-ring"><div class="avatar">${esc((p.nome || "P").charAt(0))}</div></div>
        <div class="trainer-info"><h4>${esc(p.nome)}${p.notaQtd ? ` <span class="nota-chip">★ ${Number(p.notaMedia).toFixed(1)} <small>(${p.notaQtd})</small></span>` : ""}</h4><p>${esc(p.especialidade || "Reposição e abastecimento")}</p>
        <div class="trainer-status status-online"><span class="dot"></span>Disponível</div></div></div>
        <div class="trainer-actions"><button class="btn-action btn-fill" data-nome="${esc(p.nome)}" onclick="solicitarPromotorEspecifico(this.dataset.nome)">Solicitar</button></div></div>`).join("")
        : vazio("🧑‍🔧", "Nenhum promotor ativo ainda", "Faça seu pedido acima: os promotores da região recebem a proposta.");
}

// ==========================================================================
// CARTEIRA + NOTAS
// ==========================================================================
function renderCarteira() {
    $("cart-abertos").innerText = pedidos.filter((p) => p.status === "aberta" || p.status === "aceita").length;
    const pagos = notas.length ? notas : pedidos.filter((p) => p.status === "concluida").map((p) => ({ totalPago: calcularRepasse(p.valor).totalLoja, emitidaEm: p.pagoEm }));
    $("cart-total").innerText = brl(pagos.reduce((s, n) => s + (n.totalPago || 0), 0));
    const agora = new Date();
    $("cart-mes").innerText = brl(pagos.filter((n) => { const d = n.emitidaEm?.toDate?.(); return d && d.getMonth() === agora.getMonth() && d.getFullYear() === agora.getFullYear(); }).reduce((s, n) => s + (n.totalPago || 0), 0));
    $("lista-notas").innerHTML = notas.length ? notas.map((n) => `<a class="glass nota-item" href="nota.html?id=${encodeURIComponent(n.solicitacaoId)}"><div><strong>Nota nº ${esc(n.numero)}</strong><br><small class="muted-line">${esc(n.loja)} · ${fmtData(n.data)}</small></div><div style="text-align:right"><strong>${brl(n.totalPago)}</strong><br><small class="muted-line">ver / imprimir ›</small></div></a>`).join("")
        : '<p class="muted-line" style="text-align:center;padding:10px">As notas dos turnos pagos aparecem aqui.</p>';
    $("btn-exportar").style.display = notas.length ? "block" : "none";
}
function exportarNotasCSV() {
    const cab = ["Numero", "Data do servico", "Loja", "Promotor", "Valor do turno", "Taxa fixa", "Total pago"];
    const linhas = notas.map((n) => [n.numero, n.data, n.loja, n.promotorNome, n.valorTurno, n.taxaFixa, n.totalPago].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";"));
    const blob = new Blob(["\ufeff" + [cab.join(";"), ...linhas].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `notas-abastece-ja-${hojeLocal()}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

// ==========================================================================
// PERFIL / PAGAMENTO / PREFERÊNCIAS
// ==========================================================================
async function carregarPerfilLoja() {
    try {
        const s = await getDoc(doc(db, "contratantes", usuarioAtual.uid));
        if (s.exists()) {
            perfilLoja = s.data();
            if (perfilLoja.ramo) $("aluno-select-objetivo").value = perfilLoja.ramo;
            if (perfilLoja.telefone) $("aluno-input-telefone").value = perfilLoja.telefone;
            if (perfilLoja.pagamento) { $("pg-metodo").value = perfilLoja.pagamento.metodo || "Pix"; $("pg-doc").value = perfilLoja.pagamento.documento || ""; $("pg-nome").value = perfilLoja.pagamento.nome || ""; }
            if (perfilLoja.preferencias) { $("pref-setor").value = perfilLoja.preferencias.setor; $("pref-turno").value = perfilLoja.preferencias.turno; }
        }
    } catch (e) { console.warn("Perfil:", e.code); }
    $("alerta-doc").style.display = docValido(perfilLoja.pagamento?.documento) ? "none" : "flex";
}
async function salvarCampos(dados, msg, subId) {
    try { await setDoc(doc(db, "contratantes", usuarioAtual.uid), { ...dados, atualizadoEm: serverTimestamp() }, { merge: true }); Object.assign(perfilLoja, dados); toast(msg, "ok"); if (subId) fecharSubtela(subId); }
    catch (e) { console.error(e); toast("Não foi possível salvar. Verifique as regras do Firestore.", "erro"); }
    $("alerta-doc").style.display = docValido(perfilLoja.pagamento?.documento) ? "none" : "flex";
}
const salvarPerfilAluno = () => salvarCampos({ nome: usuarioAtual.displayName || "", email: usuarioAtual.email, ramo: $("aluno-select-objetivo").value, telefone: $("aluno-input-telefone").value.trim() }, "✅ Dados da loja salvos!");
function salvarPagamento() {
    const documento = $("pg-doc").value.trim();
    if (!docValido(documento)) return toast("CNPJ ou CPF inválido. Confira os números.", "erro");
    salvarCampos({ pagamento: { metodo: $("pg-metodo").value, documento, nome: $("pg-nome").value.trim() } }, "✅ Dados para a nota salvos!", "subscreen-pagamento");
}
const salvarPreferencias = () => salvarCampos({ preferencias: { setor: $("pref-setor").value, turno: $("pref-turno").value } }, "✅ Preferências salvas!", "subscreen-preferencias");
function atualizarFotoPerfilAluno(ev) {
    const f = ev.target.files[0]; if (!f) return;
    if (f.size > 4e6) return toast("Imagem muito grande (máx. 4 MB).", "erro");
    const r = new FileReader(); r.onload = (e) => { const i = $("img-aluno-perfil-preview"); i.src = e.target.result; i.style.display = "block"; $("display-avatar-profile").style.display = "none"; }; r.readAsDataURL(f);
}

const abrirOpcaoMenu = (n) => { const e = $("subscreen-" + n); if (e) { e.style.display = "block"; e.querySelector("input,select,button")?.focus(); } };
const fecharSubtela = (id) => { $(id).style.display = "none"; };
function copiarLinkIndicacao() { const i = $("input-link-indicacao"); i.select(); navigator.clipboard?.writeText(i.value); toast("📋 Link copiado!", "ok"); }
const compartilharWhatsApp = () => window.open("https://api.whatsapp.com/send?text=" + encodeURIComponent("Conheça o ABASTECE JÁ: promotores e repositores sob demanda para o varejo. " + $("input-link-indicacao").value), "_blank");
const alternarNotificacoes = (el) => { if (el.checked) pedirPermissaoNotificar(); };

// ==========================================================================
// CALENDÁRIO (marca dias com turno)
// ==========================================================================
function renderCalendario() {
    const ano = dataCalendario.getFullYear(), mes = dataCalendario.getMonth(), hoje = new Date();
    $("calendar-month-year").innerText = dataCalendario.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase());
    const primeiro = (new Date(ano, mes, 1).getDay() + 6) % 7, total = new Date(ano, mes + 1, 0).getDate();
    const comTurno = new Set(pedidos.filter((p) => p.status !== "cancelada").map((p) => p.data));
    let html = "<div></div>".repeat(primeiro);
    for (let d = 1; d <= total; d++) {
        const iso = `${ano}-${String(mes + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const ehHoje = d === hoje.getDate() && mes === hoje.getMonth() && ano === hoje.getFullYear();
        html += `<button type="button" class="cal-day${ehHoje ? " today" : ""}${comTurno.has(iso) ? " has-turno" : ""}" onclick="selecionarDia(${d})" aria-label="Dia ${d}${comTurno.has(iso) ? ", com turno" : ""}">${d}</button>`;
    }
    $("calendar-days-grid").innerHTML = html;
}
const mudarMesCalendario = (n) => { dataCalendario = new Date(dataCalendario.getFullYear(), dataCalendario.getMonth() + n, 1); renderCalendario(); };
function selecionarDia(d) {
    const dt = new Date(dataCalendario.getFullYear(), dataCalendario.getMonth(), d);
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const lb = $("selected-date-label"); lb.dataset.iso = iso; lb.dataset.dia = d;
    lb.innerText = "Turnos de " + dt.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    const dia = pedidos.filter((p) => p.data === iso);
    $("lista-agenda").innerHTML = dia.length ? dia.map(cartaoPedido).join("") : vazio("📅", "Nenhum turno neste dia", "Pedidos para esta data aparecem aqui.");
}

// ==========================================================================
// GOOGLE MAPS (radar centrado em você)
// ==========================================================================
function initMap() {
    const el = $("mapa-quadrado");
    if (!el || mapRadar || !window.google || !$("screen-main").classList.contains("active")) return;
    mapRadar = new google.maps.Map(el, { zoom: 14, center: { lat: -22.4389, lng: -46.8258 }, disableDefaultUI: true, styles: [
        { elementType: "geometry", stylers: [{ color: "#1a1a24" }] }, { elementType: "labels.text.stroke", stylers: [{ color: "#1a1a24" }] },
        { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] }, { featureType: "road", elementType: "geometry", stylers: [{ color: "#2c2c38" }] },
        { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] }] });
    navigator.geolocation?.getCurrentPosition((pos) => {
        const eu = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        mapRadar.setCenter(eu);
        userMarker = new google.maps.Marker({ position: eu, map: mapRadar, title: "Você", icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: "#ffd700", fillOpacity: 1, strokeWeight: 2, strokeColor: "#ffffff" } });
    }, () => {});
}

// ==========================================================================
// TERMOS
// ==========================================================================
const abrirModalTermosAluno = () => $("modal-termos-aluno").classList.add("active");
function aceitarTermosAlunoModal() { $("check-termos-aluno").checked = true; $("btn-login-aluno").disabled = false; $("modal-termos-aluno").classList.remove("active"); }
document.addEventListener("DOMContentLoaded", () => $("check-termos-aluno")?.addEventListener("change", (e) => { $("btn-login-aluno").disabled = !e.target.checked; }));

Object.assign(window, { mudarMesCalendario, selecionarDia, abrirOpcaoMenu, fecharSubtela, salvarPagamento, salvarPreferencias, copiarLinkIndicacao, compartilharWhatsApp, toast, initMap,
    loginGoogleAluno, logoutAluno, navTo, switchTab, toggleTheme: alternarTema, solicitarTreinoModoUber, solicitarPromotorEspecifico, salvarPerfilAluno,
    atualizarFotoPerfilAluno, abrirModalTermosAluno, aceitarTermosAlunoModal, exportarNotasCSV, alternarNotificacoes });
if (window.google?.maps) initMap();
