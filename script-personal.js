// ==========================================================================
// ABASTECE JÁ — Portal do promotor
// ==========================================================================
import { collection, doc, setDoc, getDoc, getDocs, updateDoc, runTransaction, query, where, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, db, googleProvider, FUNCOES, $, esc, brl, fmtData, hojeLocal, vazio, skeleton, toast, cpfValido, mascaraDoc, mascaraTel, aplicarMascara, iniciarTema, alternarTema, mensagemErroAuth, notificar, pedirPermissaoNotificar } from "./comum.js";
import { calcularRepasse, TAXA_PROMOTOR } from "./financeiro.js";
import { abrirChat } from "./chat.js";

let user = null, perfilId = "", perfil = {}, privado = {};
let agenda = [], ofertas = [], notas = [];
let valorMinimo = 0, mapaOfertas = null, dataCalendario = new Date(), diaSelecionado = "";
let unsubs = [], primeiraCargaOfertas = true;
const pct = Math.round(TAXA_PROMOTOR * 100);

iniciarTema();

// ---------- indicação (?ref=) ----------
try { const r = new URLSearchParams(location.search).get("ref"); if (r) localStorage.setItem("abastece_ref", r.replace(/[^\w-]/g, "").slice(0, 40)); } catch (e) {}
const refRecebido = () => { try { return localStorage.getItem("abastece_ref") || ""; } catch (e) { return ""; } };
const baseSite = () => location.origin + location.pathname.replace(/[^/]*$/, "");
const novoCodigo = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");

// ==========================================================================
// LOGIN (somente Google: o antigo login por CPF não tinha autenticação)
// ==========================================================================
function validarCheckTermos() { $("btn-google").disabled = !$("check-termos").checked; }
const abrirModalTermos = () => $("modal-termos").classList.add("active");
function aceitarTermosModal() { $("check-termos").checked = true; validarCheckTermos(); $("modal-termos").classList.remove("active"); }

async function loginComGoogle() {
    if (!$("check-termos").checked) return toast("Aceite os Termos de Uso para continuar.", "erro");
    try { await signInWithPopup(auth, googleProvider); }
    catch (error) {
        if (error.code === "auth/popup-blocked") { try { await signInWithRedirect(auth, googleProvider); return; } catch (e) { error = e; } }
        const m = mensagemErroAuth(error); if (m) toast(m, "erro");
    }
}
getRedirectResult(auth).catch((e) => { const m = mensagemErroAuth(e); if (m) toast(m, "erro"); });
onAuthStateChanged(auth, (u) => { if (u) entrar(u); else sair(false); });

async function entrar(u) {
    user = u;
    $("screen-login-personal").classList.remove("active");
    $("screen-dashboard").classList.add("active");
    $("lista-demandas-cards").innerHTML = skeleton(3);
    try {
        let snap = await getDoc(doc(db, "profissionais", u.uid));
        perfilId = u.uid;
        if (!snap.exists()) {                                  // cadastro antigo (id = CPF)? acha pelo e-mail
            const q = await getDocs(query(collection(db, "profissionais"), where("email", "==", u.email)));
            if (!q.empty) { snap = q.docs[0]; perfilId = snap.id; }
        }
        if (!snap.exists()) {
            await setDoc(doc(db, "profissionais", u.uid), { nome: u.displayName || "", email: u.email, uid: u.uid, fotoGoogle: u.photoURL || "", status: "pendente", indicadoPor: refRecebido(), criadoEm: serverTimestamp() });
            snap = await getDoc(doc(db, "profissionais", u.uid));
        }
        perfil = snap.data();
    } catch (e) { console.error("Perfil:", e); toast("Não foi possível carregar seu cadastro. Verifique as regras do Firestore.", "erro"); perfil = { nome: u.displayName || "Promotor", status: "pendente" }; perfilId = u.uid; }
    if (perfil.status === "bloqueado") { toast("❌ Acesso não liberado para esta conta.", "erro"); return sair(true); }
    try { const p = await getDoc(doc(db, "privado", u.uid)); privado = p.exists() ? p.data() : {}; } catch (e) { privado = {}; }
    valorMinimo = Number(perfil.valorMin) || 0;
    preencherFormularios();
    atualizarPerfilTela();
    garantirLinkIndicacao();
    iniciarListeners();
    if (new URLSearchParams(location.search).get("mp") === "ok") { toast("✅ Mercado Pago conectado! Você já pode receber.", "ok"); switchTabPersonal("tab-carteira", document.querySelectorAll("#nav-personal .nav-item")[3]); history.replaceState({}, "", location.pathname); }
}

async function sairModoPessoal() {
    if (!confirm("Deseja realmente sair do portal?")) return;
    try { await signOut(auth); } catch (e) {}
}
function sair() {
    unsubs.forEach((f) => f()); unsubs = []; user = null; primeiraCargaOfertas = true;
    $("screen-dashboard").classList.remove("active"); $("screen-login-personal").classList.add("active");
}

// ==========================================================================
// PERFIL
// ==========================================================================
const ativo = () => perfil.status === "ativo";
function atualizarPerfilTela() {
    const nome = perfil.nome || user.displayName || "Promotor";
    $("perfil-nome-display").innerText = nome;
    $("perfil-cref-display").innerText = ativo() ? "Status: Ativo ✓" : "Status: Em análise";
    $("initials-perfil").innerText = nome.charAt(0).toUpperCase();
    const foto = perfil.fotoGoogle || user.photoURL;
    if (foto) { const i = $("img-perfil-preview"); i.src = foto; i.style.display = "block"; $("initials-perfil").style.display = "none"; }
    $("card-status-analise").style.display = ativo() ? "none" : "block";
    const aviso = document.querySelector("#tab-agenda .glass[style*='border-left']"); if (aviso) aviso.style.display = ativo() ? "none" : "flex";
    $("stat-nota").innerText = perfil.notaQtd ? Number(perfil.notaMedia).toFixed(1) + " ★" : "—";
    renderPerfilCompleto(); renderCarteira(); renderOfertas();
}
function renderPerfilCompleto() {
    const itens = [
        ["Conectar o Mercado Pago", !!perfil.mpConectado, "tab-carteira"], ["Informar seu CPF", cpfValido(privado.cpf), "Perfil"],
        ["Cadastrar telefone/WhatsApp", !!privado.telefone, "tab-menu"], ["Escrever uma bio", !!perfil.bio, "Perfil"], ["Cadastrar chave Pix", !!privado.pix?.chave, "Dados bancários"]];
    const feitos = itens.filter((i) => i[1]).length, falta = itens.filter((i) => !i[1]);
    const el = $("card-perfil-completo");
    el.style.display = falta.length ? "block" : "none";
    el.innerHTML = `<div class="pc-topo"><strong>Perfil ${Math.round((feitos / itens.length) * 100)}% completo</strong><small>Perfis completos pegam mais turnos</small></div>
        <div class="pc-barra"><span style="width:${(feitos / itens.length) * 100}%"></span></div>
        <ul>${falta.map((i) => `<li><a href="#" data-ir="${i[2]}">${i[0]} ›</a></li>`).join("")}</ul>`;
    el.onclick = (e) => { const a = e.target.closest("[data-ir]"); if (!a) return; e.preventDefault(); a.dataset.ir.startsWith("tab-") ? switchTabPersonal(a.dataset.ir, document.querySelector(`#nav-personal .nav-item[onclick*="${a.dataset.ir}"]`)) : abrirOpcaoMenu(a.dataset.ir); };
}
function preencherFormularios() {
    $("perfil-input-nome").value = perfil.nome || user.displayName || "";
    $("perfil-input-cpf").value = privado.cpf ? mascaraDoc(privado.cpf) : "";
    $("perfil-input-nascimento").value = privado.nascimento || "";
    $("perfil-input-naturalidade").value = perfil.cidade || "";
    $("personal-input-bio").value = perfil.bio || "";
    $("promotor-input-telefone").value = privado.telefone || "";
    if (privado.banco) { $("bank-select-banco").value = privado.banco.banco || $("bank-select-banco").value; $("bank-select-tipo-conta").value = privado.banco.tipo || $("bank-select-tipo-conta").value; $("bank-input-agencia").value = privado.banco.agencia || ""; $("bank-input-conta").value = privado.banco.conta || ""; $("bank-input-digito").value = privado.banco.digito || ""; }
    if (privado.pix) { $("bank-select-tipo-pix").value = privado.pix.tipo || $("bank-select-tipo-pix").value; $("bank-input-chave-pix").value = privado.pix.chave || ""; }
    $("pref-valor-min").value = valorMinimo || "";
    if (perfil.disponibilidade) { $("pref-hora-inicio").value = perfil.disponibilidade.inicio || $("pref-hora-inicio").value; $("pref-hora-fim").value = perfil.disponibilidade.fim || $("pref-hora-fim").value; }
}
async function salvarPublico(dados) { await setDoc(doc(db, "profissionais", perfilId), { ...dados, atualizadoEm: serverTimestamp() }, { merge: true }); Object.assign(perfil, dados); }
async function salvarPrivado(dados) { await setDoc(doc(db, "privado", user.uid), { ...dados, atualizadoEm: serverTimestamp() }, { merge: true }); Object.assign(privado, dados); }

async function salvarPerfilProfissionalCompleto() {
    const cpf = $("perfil-input-cpf").value.replace(/\D/g, "");
    if (cpf && !cpfValido(cpf)) return toast("CPF inválido. Confira os 11 dígitos.", "erro");
    try {
        await salvarPublico({ nome: $("perfil-input-nome").value.trim(), cidade: $("perfil-input-naturalidade").value.trim(), bio: $("personal-input-bio").value.trim() });
        await salvarPrivado({ cpf, nascimento: $("perfil-input-nascimento").value });
        atualizarPerfilTela(); toast("✅ Perfil salvo!", "ok"); fecharSubtela("subscreen-perfil-detalhes");
    } catch (e) { console.error(e); toast("Não foi possível salvar o perfil.", "erro"); }
}
async function salvarDadosBancarios() {
    const agencia = $("bank-input-agencia").value.trim(), conta = $("bank-input-conta").value.trim(), chave = $("bank-input-chave-pix").value.trim();
    if (!chave && !(agencia && conta)) return toast("Informe a chave PIX ou agência e conta.", "erro");
    try {
        await salvarPrivado({ banco: { banco: $("bank-select-banco").value, tipo: $("bank-select-tipo-conta").value, agencia, conta, digito: $("bank-input-digito").value.trim() }, pix: { tipo: $("bank-select-tipo-pix").value, chave } });
        toast("✅ Dados bancários salvos!", "ok"); fecharSubtela("subscreen-dados-bancarios"); renderPerfilCompleto();
    } catch (e) { console.error(e); toast("Não foi possível salvar os dados bancários.", "erro"); }
}
async function salvarContato() {
    const tel = $("promotor-input-telefone").value.trim();
    if (tel.replace(/\D/g, "").length < 10) return toast("Informe um telefone com DDD.", "erro");
    try { await salvarPrivado({ telefone: tel }); toast("✅ Contato salvo!", "ok"); renderPerfilCompleto(); } catch (e) { console.error(e); toast("Não foi possível salvar o contato.", "erro"); }
}
async function salvarPrefs() {
    const v = parseFloat($("pref-valor-min").value) || 0;
    try {
        await salvarPublico({ valorMin: v, especialidade: $("pref-estilo").selectedOptions[0].text, disponibilidade: { inicio: $("pref-hora-inicio").value, fim: $("pref-hora-fim").value } });
        valorMinimo = v; toast("✅ Preferências salvas!", "ok"); fecharSubtela("subscreen-preferencias-atendimento"); renderOfertas();
    } catch (e) { console.error(e); toast("Não foi possível salvar as preferências.", "erro"); }
}
function atualizarFotoPerfil(ev) {
    const f = ev.target.files[0]; if (!f) return;
    if (f.size > 4e6) return toast("Imagem muito grande (máx. 4 MB).", "erro");
    const r = new FileReader(); r.onload = (e) => { const i = $("img-perfil-preview"); i.src = e.target.result; i.style.display = "block"; $("initials-perfil").style.display = "none"; }; r.readAsDataURL(f);
}
async function garantirLinkIndicacao() {
    const input = $("input-link-indicacao"); if (!input) return;
    let codigo = perfil.refCode;
    if (!codigo) { codigo = novoCodigo(); try { await salvarPublico({ refCode: codigo }); } catch (e) { console.warn("refCode:", e.code); } }
    input.value = `${baseSite()}promotor.html?ref=${codigo}`;
}

// ==========================================================================
// NAVEGAÇÃO / SUBTELAS
// ==========================================================================
function switchTabPersonal(tabId, el) {
    document.querySelectorAll("#screen-dashboard .tab-content").forEach((t) => t.classList.remove("active"));
    $(tabId).classList.add("active");
    document.querySelectorAll("#nav-personal .nav-item").forEach((i) => { i.classList.remove("active"); i.removeAttribute("aria-current"); });
    if (el) { el.classList.add("active"); el.setAttribute("aria-current", "page"); }
    window.scrollTo(0, 0);
    if (tabId === "tab-ofertas") initMapAlunos();
}
const SUBTELAS = { "Perfil": "subscreen-perfil-detalhes", "Dados bancários": "subscreen-dados-bancarios", "Preferências de Atendimento": "subscreen-preferencias-atendimento", "Convidar Amigos": "subscreen-indicar-amigo", "Notificações": "subscreen-notificacoes", "Ajuda": "subscreen-ajuda" };
function abrirOpcaoMenu(nome) { const id = SUBTELAS[nome]; if (id) $(id).style.display = "block"; }
const fecharSubtela = (id) => { $(id).style.display = "none"; };

// ==========================================================================
// LISTENERS EM TEMPO REAL
// ==========================================================================
function iniciarListeners() {
    unsubs.forEach((f) => f()); unsubs = []; primeiraCargaOfertas = true;
    unsubs.push(onSnapshot(query(collection(db, "solicitacoes"), where("promotorUid", "==", user.uid)), (snap) => {
        agenda = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => `${a.data}${a.entrada}`.localeCompare(`${b.data}${b.entrada}`));
        renderAgenda(); renderCarteira(); renderCalendario(); renderConversas();
    }, (e) => console.warn("Agenda:", e.code)));
    unsubs.push(onSnapshot(query(collection(db, "notas"), where("promotorUid", "==", user.uid)), (snap) => {
        const antes = notas.length;
        notas = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.emitidaEm?.seconds || 0) - (a.emitidaEm?.seconds || 0));
        if (antes && notas.length > antes) notificar("Pagamento recebido! 💰", `+ ${brl(notas[0].repassePromotor)} de ${notas[0].loja}`);
        $("stat-lojas").innerText = notas.length; renderCarteira();
    }, (e) => console.warn("Notas:", e.code)));
    if (ativo()) unsubs.push(onSnapshot(query(collection(db, "solicitacoes"), where("status", "==", "aberta")), (snap) => {
        ofertas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (!primeiraCargaOfertas) snap.docChanges().filter((c) => c.type === "added").forEach((c) => { const x = c.doc.data(); if (x.valor >= valorMinimo) notificar("Nova oferta de reposição", `${x.loja} · você recebe ${brl(calcularRepasse(x.valor).promotor)}`); });
        primeiraCargaOfertas = false;
        renderOfertas();
    }, (e) => { console.warn("Ofertas:", e.code); $("lista-demandas-cards").innerHTML = vazio("⚠️", "Não foi possível carregar", "Verifique sua conexão."); }));
    $("btn-notif").style.display = ("Notification" in window && Notification.permission === "default") ? "block" : "none";
}
async function ativarAvisos() { await pedirPermissaoNotificar(); $("btn-notif").style.display = "none"; toast("🔔 Avisos ativados!", "ok"); }

// ==========================================================================
// OFERTAS
// ==========================================================================
function renderOfertas() {
    const el = $("lista-demandas-cards");
    if (!ativo()) { el.innerHTML = vazio("🔒", "Ofertas liberadas após aprovação", "Estamos analisando seu cadastro. Você será avisado por aqui."); return; }
    const sel = $("filtro-setor"), atual = sel.value;
    const setores = [...new Set(ofertas.map((o) => o.foco))].sort();
    sel.innerHTML = '<option value="">Todos</option>' + setores.map((s) => `<option${s === atual ? " selected" : ""}>${esc(s)}</option>`).join("");
    let lista = ofertas.filter((o) => o.valor >= valorMinimo && o.data >= hojeLocal() && (!atual || o.foco === atual));
    lista.sort($("ordem-ofertas").value === "valor" ? (a, b) => b.valor - a.valor : (a, b) => `${a.data}${a.entrada}`.localeCompare(`${b.data}${b.entrada}`));
    el.innerHTML = lista.length ? lista.map((x) => `<article class="glass agenda-slot slot-livre"><div class="slot-info"><div class="slot-info-name">${esc(x.loja)}</div>
        <div class="slot-info-desc">${fmtData(x.data)} · ${esc(x.entrada)}–${esc(x.saida)} · ${esc(x.foco)}<br>Você recebe <strong>${brl(calcularRepasse(x.valor).promotor)}</strong> <small>(${pct}% de ${brl(x.valor)})</small></div></div>
        <div class="slot-actions"><button class="btn-slot-action btn-qr" data-acao="aceitar" data-id="${x.id}">Aceitar</button></div></article>`).join("")
        : vazio("🛒", "Sem ofertas por enquanto", valorMinimo ? `Nenhuma proposta de ${brl(valorMinimo)} ou mais agora.` : "Novas demandas de reposição na sua região aparecerão aqui.");
}
async function aceitarOferta(id, btn) {
    if (FUNCOES.mpConectarUrl && !perfil.mpConectado) { toast("Conecte seu Mercado Pago na Carteira para receber os pagamentos.", "erro"); return switchTabPersonal("tab-carteira", document.querySelectorAll("#nav-personal .nav-item")[3]); }
    btn.disabled = true;
    try {
        await runTransaction(db, async (t) => {                  // 2 promotores clicando juntos: só um leva
            const r = doc(db, "solicitacoes", id), s = await t.get(r);
            if (!s.exists() || s.data().status !== "aberta") throw new Error("indisponivel");
            t.update(r, { status: "aceita", promotorChave: perfilId, promotorUid: user.uid, promotorNome: perfil.nome || user.displayName || "Promotor", aceitoEm: serverTimestamp() });
        });
        toast("Turno aceito! Ele já está na sua agenda.", "ok");
    } catch (e) { console.warn(e); toast(e.message === "indisponivel" ? "Ops, outro promotor pegou este turno primeiro." : "Não foi possível aceitar o turno.", "erro"); btn.disabled = false; }
}

// ==========================================================================
// AGENDA: check-in, check-out, cobrança
// ==========================================================================
function acoesTurno(x) {
    if (x.status === "concluida") return `<div class="slot-actions"><button class="btn-slot-action" data-acao="chat" data-id="${x.id}">💬</button></div>`;
    if (x.status !== "aceita") return "";
    const b = [];
    if (!x.checkinEm) b.push(`<button class="btn-slot-action btn-qr" data-acao="checkin" data-id="${x.id}">Check-in</button>`);
    else if (!x.checkoutEm) b.push(`<button class="btn-slot-action btn-qr" data-acao="checkout" data-id="${x.id}">Finalizar turno</button>`);
    else b.push(`<button class="btn-slot-action btn-qr" data-acao="qr" data-id="${x.id}">Cobrar (QR)</button>`);
    b.push(`<button class="btn-slot-action" data-acao="chat" data-id="${x.id}" aria-label="Chat">💬</button>`);
    return `<div class="slot-actions">${b.join("")}</div>`;
}
function cartaoTurno(x, acoes = true) {
    const etapa = x.status === "concluida" ? "Pago ✓" : x.checkoutEm ? "Aguardando pagamento" : x.checkinEm ? "Em andamento" : "Agendado";
    return `<article class="glass agenda-slot ${x.status === "concluida" ? "slot-concluida" : "slot-ocupado"}"><div class="slot-time">${esc(x.entrada)}</div>
        <div class="slot-info"><div class="slot-info-name">${esc(x.loja)} <span class="badge badge-gold">${etapa}</span></div>
        <div class="slot-info-desc">${fmtData(x.data)} · ${esc(x.entrada)}–${esc(x.saida)} · ${esc(x.foco)} · você recebe ${brl(calcularRepasse(x.valor).promotor)}</div></div>${acoes ? acoesTurno(x) : ""}</article>`;
}
function renderAgenda() {
    const lista = $("lista-agenda"), resumo = $("lista-agenda-resumo");
    const visiveis = diaSelecionado ? agenda.filter((x) => x.data === diaSelecionado) : agenda.filter((x) => x.status !== "cancelada");
    lista.innerHTML = visiveis.length ? visiveis.map((x) => cartaoTurno(x)).join("") : vazio("📅", diaSelecionado ? "Nenhum turno neste dia" : "Nenhum turno por aqui", "Os turnos que você aceitar nas Ofertas aparecem neste espaço.");
    const hoje = agenda.filter((x) => x.data === hojeLocal() && x.status !== "cancelada");
    resumo.innerHTML = hoje.length ? hoje.map((x) => cartaoTurno(x)).join("") : vazio("☀️", "Nada para hoje", "Quando você tiver turnos hoje, eles aparecem aqui.");
    const prox = agenda.find((x) => x.status === "aceita");
    $("proxima-reposicao").textContent = prox ? `${fmtData(prox.data)} · ${prox.entrada}–${prox.saida} · ${prox.loja}` : "Nenhum turno agendado.";
}
function renderConversas() {
    $("lista-conversas-promotor").innerHTML = agenda.filter((x) => x.status !== "cancelada").map((x) => `<button class="glass conversa-item" data-acao="chat" data-id="${x.id}"><div class="avatar">${esc((x.loja || "L").charAt(0))}</div><div><strong>${esc(x.loja)}</strong><br><small class="muted-line">${fmtData(x.data)} · ${esc(x.foco)}</small></div><span class="option-arrow">›</span></button>`).join("")
        || vazio("💬", "Nenhuma conversa ainda", "Quando você aceitar um turno, o chat com a loja aparece aqui.");
}

async function acaoLista(e) {
    const b = e.target.closest("[data-acao]"); if (!b) return;
    const id = b.dataset.id, a = b.dataset.acao;
    if (a === "aceitar") return aceitarOferta(id, b);
    const x = agenda.find((t) => t.id === id); if (!x) return;
    if (a === "chat") return abrirChat(x.id, x.loja, `${fmtData(x.data)} · ${x.horario}`);
    if (a === "qr") return mostrarQR(x);
    if (a === "checkin" && x.data !== hojeLocal()) return toast("O check-in só pode ser feito no dia do turno.", "erro");
    if (a === "checkin" || a === "checkout") {
        if (a === "checkout" && !confirm("Finalizar o turno e liberar a cobrança para a loja?")) return;
        b.disabled = true;
        try { await updateDoc(doc(db, "solicitacoes", id), { [a === "checkin" ? "checkinEm" : "checkoutEm"]: serverTimestamp() }); toast(a === "checkin" ? "✅ Check-in feito. Bom trabalho!" : "✅ Turno finalizado! Cobre a loja pelo QR Code.", "ok"); }
        catch (err) { console.error(err); toast("Não foi possível registrar. Tente de novo.", "erro"); b.disabled = false; }
    }
}
function mostrarQR(x) {
    const link = `${baseSite()}pagar.html?id=${encodeURIComponent(x.id)}`, r = calcularRepasse(x.valor);
    $("qr-box").innerHTML = "";
    if (window.QRCode) new QRCode($("qr-box"), { text: link, width: 200, height: 200 }); else $("qr-box").textContent = link;
    $("qr-valor").textContent = `A loja paga ${brl(r.totalLoja)}`;
    $("qr-liquido").innerHTML = `Você recebe <b>${brl(r.promotor)}</b> (${pct}% de ${brl(r.base)}) · App: ${brl(r.app)}`;
    let w = $("qr-whats");
    if (!w) { w = document.createElement("button"); w.id = "qr-whats"; w.className = "btn btn-primary"; w.style.marginTop = "12px"; $("qr-liquido").after(w); }
    w.textContent = "Enviar link por WhatsApp";
    w.onclick = () => window.open("https://api.whatsapp.com/send?text=" + encodeURIComponent(`Olá! Segue o link para pagar a reposição de ${x.loja}: ${link}`), "_blank");
    $("modal-qr").classList.add("active");
}
const fecharQR = () => $("modal-qr").classList.remove("active");

// ==========================================================================
// CARTEIRA
// ==========================================================================
function renderCarteira() {
    if (!user) return;
    const recebido = notas.reduce((s, n) => s + (n.repassePromotor || 0), 0);
    const pendentes = agenda.filter((x) => x.status === "aceita");
    const areceber = pendentes.reduce((s, x) => s + calcularRepasse(x.valor).promotor, 0);
    $("cart-recebido").innerText = brl(recebido); $("cart-areceber").innerText = brl(areceber);
    $("valor-recebido").innerText = brl(recebido); $("valor-avulso").innerText = brl(areceber); $("valor-total").innerText = brl(recebido + areceber);
    $("lista-recebimentos").innerHTML = (notas.length || pendentes.length)
        ? pendentes.map((x) => `<div class="glass recebimento pend"><div><strong>${esc(x.loja)}</strong><br><small class="muted-line">${fmtData(x.data)} · aguardando pagamento</small></div><b>${brl(calcularRepasse(x.valor).promotor)}</b></div>`).join("")
          + notas.map((n) => `<div class="glass recebimento"><div><strong>${esc(n.loja)}</strong><br><small class="muted-line">${fmtData(n.data)} · recibo nº ${esc(n.numero)}</small></div><b class="ganho">+ ${brl(n.repassePromotor)}</b></div>`).join("")
        : '<p class="muted-line" style="text-align:center;padding:10px">Seus recebimentos aparecem aqui.</p>';
    $("card-mp").innerHTML = perfil.mpConectado
        ? '<div style="font-size:30px">✅</div><h3 style="font-size:15px;margin:6px 0">Mercado Pago conectado</h3><p class="muted-line">Os pagamentos das lojas caem direto na sua conta Mercado Pago.</p>'
        : '<div style="font-size:30px">💳</div><h3 style="font-size:15px;margin:6px 0">Conecte seu Mercado Pago</h3><p class="muted-line" style="margin-bottom:14px">É por ele que você recebe seus ' + pct + '% automaticamente, sem esperar repasse.</p><button class="btn btn-primary" onclick="conectarMP()">Conectar Mercado Pago</button>';
    $("card-mp").style.borderLeftColor = perfil.mpConectado ? "#28a745" : "#ff3b30";
}
async function conectarMP() {
    if (!FUNCOES.mpConectarUrl) return toast("O recebimento automático ainda não foi ativado pela plataforma.", "erro");
    try {
        const r = await fetch(FUNCOES.mpConectarUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: await user.getIdToken(), chave: perfilId }) });
        const j = await r.json(); if (!j.url) throw new Error(j.erro || "sem url");
        location.href = j.url;
    } catch (e) { console.error(e); toast("Não foi possível abrir o Mercado Pago. Tente de novo.", "erro"); }
}

// ==========================================================================
// CALENDÁRIO
// ==========================================================================
function renderCalendario() {
    const grid = $("calendar-days-grid"); if (!grid) return;
    const ano = dataCalendario.getFullYear(), mes = dataCalendario.getMonth(), hoje = new Date();
    $("calendar-month-year").innerText = dataCalendario.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase());
    const primeiro = (new Date(ano, mes, 1).getDay() + 6) % 7, total = new Date(ano, mes + 1, 0).getDate();
    const comTurno = new Set(agenda.filter((x) => x.status !== "cancelada").map((x) => x.data));
    let html = "<div></div>".repeat(primeiro);
    for (let d = 1; d <= total; d++) {
        const iso = `${ano}-${String(mes + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const ehHoje = d === hoje.getDate() && mes === hoje.getMonth() && ano === hoje.getFullYear();
        html += `<button type="button" class="cal-day${ehHoje ? " today" : ""}${diaSelecionado === iso ? " selected" : ""}${comTurno.has(iso) ? " has-turno" : ""}" onclick="selecionarDia(${d})" aria-label="Dia ${d}${comTurno.has(iso) ? ", com turno" : ""}">${d}</button>`;
    }
    grid.innerHTML = html;
}
const mudarMesCalendario = (n) => { dataCalendario = new Date(dataCalendario.getFullYear(), dataCalendario.getMonth() + n, 1); renderCalendario(); };
function selecionarDia(d) {
    const dt = new Date(dataCalendario.getFullYear(), dataCalendario.getMonth(), d);
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    diaSelecionado = diaSelecionado === iso ? "" : iso;                         // clicar de novo limpa o filtro
    $("selected-date-label").innerText = diaSelecionado ? "Turnos de " + dt.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }) : "Todos os seus turnos";
    renderCalendario(); renderAgenda();
}

// ==========================================================================
// MAPA / INDICAÇÃO
// ==========================================================================
function initMapAlunos() {
    const el = $("mapa-alunos");
    if (!el || !window.google?.maps) return;
    if (!mapaOfertas) {
        mapaOfertas = new google.maps.Map(el, { zoom: 14, center: { lat: -22.4389, lng: -46.8258 }, disableDefaultUI: true, styles: [
            { elementType: "geometry", stylers: [{ color: "#1a1a24" }] }, { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
            { featureType: "road", elementType: "geometry", stylers: [{ color: "#2c2c38" }] }, { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] }] });
        navigator.geolocation?.getCurrentPosition((p) => mapaOfertas.setCenter({ lat: p.coords.latitude, lng: p.coords.longitude }), () => {});
    } else google.maps.event.trigger(mapaOfertas, "resize");
}

window.addEventListener("DOMContentLoaded", () => {
    aplicarMascara("perfil-input-cpf", mascaraDoc); aplicarMascara("promotor-input-telefone", mascaraTel);
    document.querySelectorAll(".r-pct-prom").forEach((e) => (e.textContent = pct));
    ["lista-agenda", "lista-agenda-resumo", "lista-demandas-cards", "lista-conversas-promotor"].forEach((id) => $(id)?.addEventListener("click", acaoLista));
    if (refRecebido() && $("login-sub")) $("login-sub").textContent = "🎁 Você foi convidado por um promotor! Entre com o Google e faça seu primeiro turno.";
    validarCheckTermos();
});

Object.assign(window, { loginComGoogle, validarCheckTermos, abrirModalTermos, aceitarTermosModal, abrirOpcaoMenu, fecharSubtela, salvarPerfilProfissionalCompleto, salvarDadosBancarios,
    atualizarFotoPerfil, sairModoPessoal, switchTabPersonal, mudarMesCalendario, selecionarDia, initMapAlunos, toggleTheme: alternarTema, salvarContato, toast, fecharQR,
    salvarPrefs, renderizarOfertas: renderOfertas, ativarAvisos, conectarMP });
