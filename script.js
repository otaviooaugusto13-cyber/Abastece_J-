// ============================================================
// ABASTECE JÁ — painel da LOJA (contratante)
// Mesmo padrão do script-personal.js: firebase.js + core.js + ui.js + config.js
// ============================================================
import { collection, doc, addDoc, setDoc, getDoc, query, where, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, db, googleProvider, chamarFuncao, baixarCSVProtegido, renovarToken, testeAtivo, loginDeTeste, contaDeTeste } from "./firebase.js";
import { resolverAcesso, telaOutroPerfil, telaFalhaTemporaria } from "./acesso.js";
import { WHATSAPP_SUPORTE, VALOR_DIARIA_CENTAVOS, HORAS_MIN_TURNO, HORAS_MAX_TURNO, MP_PUBLIC_KEY } from "./config.js";
import { brl, calcularDiaria, calcularTurno, visaoLoja, validarTurno, minutosEntre, esc, fmtData, fmtDataHora, hojeLocal, mascaraDoc, mascaraTelefone, docValido, soDigitos, estaPago, valorCentavos, SETORES, textoTermos } from "./core.js";
import { $, toast, ok, erro, iniciarTema, alternarTema, ligarMascaras, abrir, fechar, skeleton, vazio, registrarSW, instalarApp, pedirPermissaoNotificacao, notificar, baixarCSV } from "./ui.js";

// ---------- estado ----------
let usuario = null, perfil = {}, pedidos = [], promotores = [], cartaoLoja = null, ehTeste = false;
const fin = new Map();   // valores que a LOJA enxerga (valor + taxa fixa + total), por pedido
let filtro = "ativos", setorSel = SETORES[0].v, preferido = "", dataCal = new Date(), diaSel = "";
let pedidosUn = null, promUn = null, cartaoUn = null, finUn = null, chatUn = null, chatPedido = null, avPedido = null, avEstrelas = 0, primeira = true;
const statusAnt = new Map();
const baseSite = () => location.origin + location.pathname.replace(/[^/]*$/, "");
const btnLoginHtml = $("btn-login").innerHTML;

iniciarTema(); registrarSW();
ligarMascaras({ doc: mascaraDoc, tel: mascaraTelefone });

// ---------- textos que dependem da regra de taxas (nunca desatualizam) ----------
$("btn-whatsapp").href = `https://wa.me/${WHATSAPP_SUPORTE}`;
$("ajuda-zap").href = `https://wa.me/${WHATSAPP_SUPORTE}?text=${encodeURIComponent("Olá! Preciso de ajuda no Abastece Já (loja).")}`;
$("ajuda-split").textContent = `Cada turno custa ${brl(VALOR_DIARIA_CENTAVOS)} (diária padrão), pagos só depois do serviço, por Pix ou cartão. O turno tem de ${HORAS_MIN_TURNO} a ${HORAS_MAX_TURNO} horas. Os detalhes estão nos Termos de Uso.`;
$("termos-texto").innerHTML = textoTermos("loja");

// ============================================================
// LOGIN / LOGOUT
// ============================================================
const msgAuth = (e) => ({
    "auth/unauthorized-domain": "Domínio não autorizado no Firebase (Authentication → Settings → Domínios autorizados).",
    "auth/operation-not-allowed": "Login com Google não está ativado no Firebase.",
    "auth/network-request-failed": "Sem conexão com a internet.",
    "auth/popup-closed-by-user": null, "auth/cancelled-popup-request": null
})[e.code] ?? `Não foi possível entrar com o Google. (${e.code || "erro"})`;

const resetarLogin = () => { const b = $("btn-login"); b.innerHTML = btnLoginHtml; b.disabled = !$("check-termos").checked; };
$("check-termos").addEventListener("change", (e) => ($("btn-login").disabled = !e.target.checked));
$("link-termos").addEventListener("click", (e) => { e.preventDefault(); abrir("sheet-termos"); });
$("btn-aceitar-termos").addEventListener("click", () => { $("check-termos").checked = true; $("btn-login").disabled = false; fechar("sheet-termos"); });
$("btn-login").addEventListener("click", async () => {
    const b = $("btn-login"); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Entrando…';
    try { await signInWithPopup(auth, googleProvider); }
    catch (e) {
        if (e.code === "auth/popup-blocked") { try { await signInWithRedirect(auth, googleProvider); return; } catch (e2) { e = e2; } }
        const m = msgAuth(e); if (m) erro(m);
        resetarLogin();
    }
});
testeAtivo().then((a) => { $("bloco-teste").hidden = !a; });
$("btn-login-teste").addEventListener("click", async () => {
    const b = $("btn-login-teste"); b.disabled = true;
    try { await loginDeTeste("loja"); } catch (e) { console.error(e); erro("Não foi possível entrar no modo de teste."); b.disabled = false; }
});
getRedirectResult(auth).catch((e) => { const m = msgAuth(e); if (m) erro(m); resetarLogin(); });
$("btn-sair").addEventListener("click", async () => { if (confirm("Deseja sair da conta?")) { parar(); await signOut(auth); } });

const tela = (id) => document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
function parar() { pedidosUn?.(); promUn?.(); cartaoUn?.(); finUn?.(); chatUn?.(); pedidosUn = promUn = cartaoUn = finUn = chatUn = null; primeira = true; statusAnt.clear(); fin.clear(); cartaoLoja = null; }

onAuthStateChanged(auth, async (u) => {
    usuario = u;
    if (!u) { parar(); perfil = {}; pedidos = []; tela("screen-login"); resetarLogin(); return; }
    let seguiu = false;
    try { seguiu = await carregarPerfil(u); } catch (e) { console.error(e); erro("Não foi possível carregar seu cadastro. Tente novamente."); return; }
    if (!seguiu) return;                                    // tela de aviso/falha já está na tela; a sessão continua de pé
    ehTeste = await contaDeTeste(); $("btn-teste-reset").hidden = !ehTeste; $("cartao-teste-dica").hidden = !ehTeste;
    pintarPerfil(); iniciarFormulario(); tela("screen-main"); escutar();
});

const trocarConta = async () => { parar(); await signOut(auth); };
const mostrarOutroPerfil = (r) => telaOutroPerfil({ portal: "loja", perfis: r?.perfis, email: usuario?.email, trocarConta });

/**
 * O perfil ativo vem do SERVIDOR (/sessao) para o portal aberto — nunca do navegador.
 * Devolve true se a loja pode abrir o painel; false se uma tela de aviso/falha foi mostrada (sem derrubar a sessão).
 */
async function carregarPerfil(u) {
    let r;
    try { r = await resolverAcesso("loja"); }
    catch (e) { console.warn(e); telaFalhaTemporaria({ tentarDeNovo: () => location.reload(), trocarConta }); return false; }
    if (r.estado === "outro-perfil" || r.estado === "escolher") { mostrarOutroPerfil(r); return false; }
    if (r.estado === "cadastro") {                                  // primeiro acesso: o aceite dos Termos já foi marcado na tela de login
        try { await chamarFuncao("cadastro/loja", { termos: true }); await renovarToken(); }
        catch (e) { if (e.code === "papel-conflito") { mostrarOutroPerfil({ perfis: [e.detalhe?.tem].filter(Boolean) }); return false; } throw e; }
    }
    const ref = doc(db, "contratantes", u.uid), s = await getDoc(ref);
    perfil = s.exists() ? s.data() : { uid: u.uid, email: u.email || "", nome: u.displayName || "" };
    return true;
}

function pintarPerfil() {
    const nome = perfil.razaoSocial || usuario.displayName || (usuario.email || "loja").split("@")[0];
    $("nome-home").textContent = nome.split(" ")[0]; $("nome-menu").textContent = nome;
    for (const id of ["avatar-home", "avatar-menu"]) {
        const a = $(id); a.textContent = nome.charAt(0).toUpperCase();
        if (usuario.photoURL) a.innerHTML = `<img src="${esc(usuario.photoURL)}" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;border-radius:inherit;object-fit:cover">`;
    }
    $("aviso-fiscal").hidden = !!(perfil.razaoSocial && perfil.documento);
    $("f-razao").value = perfil.razaoSocial || ""; $("f-doc").value = perfil.documento ? mascaraDoc(perfil.documento) : "";
    $("f-end").value = perfil.endereco || ""; $("f-email").value = perfil.email || usuario.email || "";
    $("f-tel").value = perfil.telefone ? mascaraTelefone(perfil.telefone) : ""; if (perfil.ramo) $("f-ramo").value = perfil.ramo;
    $("pref-setor").innerHTML = SETORES.map((s) => `<option value="${esc(s.v)}">${esc(s.label)}</option>`).join("");
    if (perfil.prefs?.setor) $("pref-setor").value = perfil.prefs.setor;
    $("pref-entrada").value = perfil.prefs?.entrada || "08:00"; $("pref-saida").value = perfil.prefs?.saida || "12:00";
    $("link-indicar").value = baseSite() + "landing.html";
}

// ============================================================
// DADOS EM TEMPO REAL
// ============================================================
function escutar() {
    parar();
    $("lista-pedidos").innerHTML = skeleton(3); $("lista-promotores").innerHTML = skeleton(2);
    pedidosUn = onSnapshot(query(collection(db, "solicitacoes"), where("uid", "==", usuario.uid)), (snap) => {
        pedidos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (!primeira) pedidos.forEach((p) => {
            const a = statusAnt.get(p.id);
            if (a === "aberta" && p.status === "aceita") notificar("Promotor confirmado 🎉", `${p.promotorNome || "Um promotor"} aceitou o pedido em ${p.loja}.`);
            if (a && !estaPago({ status: a }) && estaPago(p)) notificar("Pagamento confirmado ✓", `A nota do pedido em ${p.loja} já está disponível.`);
        });
        pedidos.forEach((p) => statusAnt.set(p.id, p.status)); primeira = false;
        renderTudo();
    }, (e) => { pedidos = []; renderTudo(); if (e.code === "permission-denied") erro("Sem permissão para ler os pedidos. Publique as regras do Firestore."); else console.warn(e); });
    cartaoUn = onSnapshot(doc(db, "cartoes", usuario.uid), (d) => { cartaoLoja = d.exists() && d.data().status === "ativo" ? d.data() : null; renderCartao(); }, () => { cartaoLoja = null; renderCartao(); });
    finUn = onSnapshot(query(collection(db, "solicitacoes_financeiro"), where("uid", "==", usuario.uid)), (snap) => { fin.clear(); snap.docs.forEach((d) => fin.set(d.id, d.data())); renderTudo(); }, () => {});
    promUn = onSnapshot(query(collection(db, "profissionais"), where("status", "==", "ativo")), (snap) => {
        promotores = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderPromotores();
    }, () => { promotores = []; renderPromotores(); });
}

// O que a LOJA enxerga de um pedido: valor do serviço + taxa fixa + total. Nunca repasse nem royalty.
const sp = (p) => {
    const f = fin.get(p.id); if (f && Number.isInteger(f.total)) return visaoLoja(f);
    return visaoLoja(calcularDiaria());
};
const ordemData = (a, b) => `${a.data}${a.entrada}`.localeCompare(`${b.data}${b.entrada}`);
function renderTudo() { renderHome(); renderPedidos(); renderCalendario(); diaSel ? renderDia() : renderAgenda(); renderCarteira(); renderConversas(); }

// ============================================================
// NOVO PEDIDO
// ============================================================
function montarSetores() {
    $("setor-grid").innerHTML = SETORES.map((s) => `<button type="button" class="chip${s.v === setorSel ? " sel" : ""}" role="radio" aria-checked="${s.v === setorSel}" data-setor="${esc(s.v)}"><span class="ico">${s.ico}</span>${esc(s.label)}</button>`).join("");
}
function iniciarFormulario() {
    $("p-data").min = hojeLocal(); if (!$("p-data").value || $("p-data").value < hojeLocal()) $("p-data").value = hojeLocal();
    $("p-entrada").value = perfil.prefs?.entrada || "08:00"; $("p-saida").value = perfil.prefs?.saida || "12:00";
    if (perfil.prefs?.setor) setorSel = perfil.prefs.setor;
    montarSetores(); atualizarSplit();
}
$("setor-grid").addEventListener("click", (e) => { const b = e.target.closest("[data-setor]"); if (b) { setorSel = b.dataset.setor; montarSetores(); } });

const limparErros = () => document.querySelectorAll(".msg-erro").forEach((e) => (e.textContent = ""));
const fmtHoras = (m) => { const h = Math.floor(m / 60), mm = m % 60; return mm ? `${h} h ${String(mm).padStart(2, "0")} min` : `${h} h`; };
/** Resumo ao vivo: o valor sai do horário (nunca digitado). Mostra só valor do serviço + taxa fixa + total. */
function atualizarSplit() {
    const entrada = $("p-entrada").value, saida = $("p-saida").value, m = minutosEntre(entrada, saida), e = m ? validarTurno(entrada, saida) : "";
    $("dica-valor").textContent = m ? `Turno de ${fmtHoras(m)} · diária de ${brl(VALOR_DIARIA_CENTAVOS)}` : `Turnos de ${HORAS_MIN_TURNO} a ${HORAS_MAX_TURNO} horas`;
    $("e-saida").textContent = m && e ? e : "";
    const valido = m > 0 && !e;
    $("split-card").hidden = !valido;
    if (!valido) return;
    const v = visaoLoja(calcularTurno(m));
    $("sc-horas").textContent = fmtHoras(m); $("sc-valor").textContent = brl(v.valor); $("sc-total").textContent = brl(v.total);
}
["p-entrada", "p-saida"].forEach((id) => $(id).addEventListener("input", atualizarSplit));

function definirPreferido(id, nome) {
    preferido = id || ""; $("banner-preferido").hidden = !preferido; $("nome-preferido").textContent = nome || "";
    if (preferido) { irPara("tab-home"); $("form-pedido").scrollIntoView({ behavior: "smooth", block: "start" }); }
}
$("rm-preferido").addEventListener("click", () => definirPreferido(""));

$("btn-enviar").addEventListener("click", async () => {
    limparErros();
    const loja = $("p-local").value.trim(), data = $("p-data").value, entrada = $("p-entrada").value, saida = $("p-saida").value;
    let falhou = false; const e = (id, m) => { $(id).textContent = m; falhou = true; };
    if (!cartaoLoja) { abrir("sheet-cartao"); return toast("Cadastre um cartão de crédito para solicitar um promotor.", "erro"); }
    if (loja.length < 3) e("e-local", "Informe o nome e o endereço da loja.");
    if (!data || data < hojeLocal()) e("e-data", "Escolha hoje ou uma data futura.");
    const et = validarTurno(entrada, saida); if (et) e("e-saida", et);        // trava de 6 h também no navegador
    else if (data === hojeLocal() && saida <= new Date().toTimeString().slice(0, 5)) e("e-saida", "Esse horário já passou hoje.");
    if (falhou) return erro("Confira os campos destacados.");

    const b = $("btn-enviar"), html = b.innerHTML; b.disabled = true; b.innerHTML = '<span class="spinner"></span> Enviando…';
    try {
        await chamarFuncao("criarPedido", { loja, data, entrada, saida, foco: setorSel, promotorPreferido: preferido || undefined });   // o servidor valida tudo de novo
        ok("Pedido enviado! Avisamos quando um promotor aceitar.");
        $("p-local").value = ""; definirPreferido(""); atualizarSplit();
        filtro = "ativos"; marcarFiltro(); irPara("tab-pedidos");
        if (!(perfil.razaoSocial && perfil.documento)) setTimeout(() => toast("Dica: complete os dados da empresa para a nota sair no seu nome."), 1800);
    } catch (err) {
        console.error(err);
        if (err.code === "cartao-obrigatorio") { abrir("sheet-cartao"); erro(err.message); }
        else if (err.code === "turno-invalido") { $("e-saida").textContent = err.message; erro(err.message); }
        else if (err.code === "backend-nao-configurado") erro("O servidor ainda não está configurado (FUNCTIONS_BASE em config.js).");
        else if (err.code === 404 || err.code === "rota-inexistente") erro("O servidor não respondeu (404). Confira o endereço do serviço no Render.");
        else erro(err.message && err.message !== "falha" ? err.message : "Não foi possível enviar o pedido. Tente de novo.");
    }
    finally { b.disabled = false; b.innerHTML = html; }
});

function repetir(p) {
    setorSel = p.foco || setorSel; montarSetores();
    $("p-local").value = p.loja || ""; $("p-entrada").value = p.entrada || "08:00"; $("p-saida").value = p.saida || "12:00";
    $("p-data").value = hojeLocal(); atualizarSplit();
    irPara("tab-home"); $("form-pedido").scrollIntoView({ behavior: "smooth" }); toast("Dados copiados. Escolha o dia e envie.", "ok");
}

// ============================================================
// PROMOTORES DISPONÍVEIS
// ============================================================
function renderPromotores() {
    const l = promotores.slice().sort((a, b) => (b.ratingMedia || 0) - (a.ratingMedia || 0) || (b.ratingQtd || 0) - (a.ratingQtd || 0)).slice(0, 12);
    $("lista-promotores").innerHTML = l.length ? l.map((p) => {
        const nome = p.nome || "Promotor", foto = p.fotoGoogle ? `<img src="${esc(p.fotoGoogle)}" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;border-radius:inherit;object-fit:cover">` : esc(nome[0].toUpperCase());
        const nota = p.ratingQtd ? `<span class="stars">★ ${String(p.ratingMedia).replace(".", ",")}</span> <span class="muted small">(${p.ratingQtd})</span>` : '<span class="muted small">Novo na plataforma</span>';
        return `<article class="card conversa"><div class="avatar">${foto}</div><div class="grow"><h4>${esc(nome)}</h4><div class="small">${nota}</div><div class="muted small">${esc(p.especialidade || "Reposição geral")}${p.cidade ? " · " + esc(p.cidade) : ""}</div></div><button class="btn btn-ghost btn-sm" data-chamar="${esc(p.uid || p.id)}" data-nome="${esc(nome)}">Chamar</button></article>`;
    }).join("") : vazio("👷", "Nenhum promotor cadastrado ainda", "Envie o pedido mesmo assim: ele aparece para todos os promotores aprovados da região.");
}

// ============================================================
// INÍCIO / PEDIDOS
// ============================================================
function renderHome() {
    const aPagar = pedidos.filter((p) => p.status === "aceita").length;
    $("dot-pedidos").hidden = !aPagar; $("dot-pedidos").textContent = aPagar;
    const prox = pedidos.filter((p) => (p.status === "aceita" || p.status === "aberta") && p.data >= hojeLocal()).sort(ordemData)[0], el = $("card-proximo");
    el.hidden = !prox; if (!prox) return;
    el.innerHTML = `<div class="lbl">Próximo turno</div><div class="row between"><div><h4>${esc(prox.loja)}</h4><div class="muted small">${fmtData(prox.data)} · ${esc(prox.horario || "")} · ${esc(prox.foco)}</div></div>${selo(prox)}</div>
        <div class="muted small mt">${prox.status === "aceita" ? `👷 ${esc(prox.promotorNome || "Promotor")} confirmado.` : "Aguardando um promotor aceitar."}</div>`;
}
const selo = (p) => { const [t, c] = p.status === "cancelada" ? ["Cancelado", "red"] : estaPago(p) ? ["Pago ✓", "green"] : p.status === "aceita" ? ["Aceito · pagar", "blue"] : ["Aguardando promotor", ""]; return `<span class="badge ${c}">${t}</span>`; };
function linhaTempo(p) {
    const idx = estaPago(p) ? 2 : p.status === "aceita" ? 1 : 0, nomes = ["Pedido", "Aceito", "Pago"];
    return `<div class="timeline">${nomes.map((n, i) => `<div class="passo ${i < idx || (idx === 2 && i === 2) ? "ok" : i === idx ? "on" : ""}"><div class="bola"></div>${n}</div>${i < 2 ? `<div class="fio ${i < idx ? "on" : ""}"></div>` : ""}`).join("")}</div>`;
}
function cartao(p) {
    const s = sp(p), pago = estaPago(p), cancel = p.status === "cancelada", acoes = [];
    if (p.status === "aceita") acoes.push(`<a class="btn btn-primary btn-sm" href="pagar.html?id=${encodeURIComponent(p.id)}">💳 Pagar agora</a>`);
    if (pago && p.notaId) acoes.push(`<a class="btn btn-primary btn-sm" href="nota.html?id=${encodeURIComponent(p.notaId)}">🧾 Ver nota</a>`);
    if (p.status === "paga" && !p.avaliacao) acoes.push(`<button class="btn btn-ghost btn-sm" data-avaliar="${p.id}">⭐ Avaliar</button>`);
    if (p.promotorUid && !cancel) acoes.push(`<button class="btn btn-ghost btn-sm" data-chat="${p.id}">💬 Chat</button>`);
    if (pago || cancel) acoes.push(`<button class="btn btn-ghost btn-sm" data-repetir="${p.id}">🔁 Repetir</button>`);
    if (p.status === "aberta" || p.status === "aceita") acoes.push(`<button class="btn btn-danger btn-sm" data-cancelar="${p.id}">Cancelar</button>`);
    return `<article class="card pedido ${cancel ? "cancelada" : ""}"><div class="topo"><div class="grow"><h4>${esc(p.loja)}</h4><div class="meta">${fmtData(p.data)} · ${esc(p.horario || "")} · ${esc(p.foco)}</div>${p.promotorNome ? `<div class="meta">👷 ${esc(p.promotorNome)}${p.avaliacao ? ` · <span class="stars">${"★".repeat(p.avaliacao.estrelas)}</span>` : ""}</div>` : ""}</div>
        <div class="center"><div class="valor">${brl(s.total)}</div>${selo(p)}</div></div>${cancel ? "" : linhaTempo(p)}${acoes.length ? `<div class="acoes">${acoes.join("")}</div>` : ""}</article>`;
}
function marcarFiltro() { document.querySelectorAll("#filtro-pedidos .pill").forEach((b) => b.classList.toggle("sel", b.dataset.f === filtro)); }
$("filtro-pedidos").addEventListener("click", (e) => { const b = e.target.closest(".pill"); if (b) { filtro = b.dataset.f; marcarFiltro(); renderPedidos(); } });
function renderPedidos() {
    let l = pedidos.slice();
    if (filtro === "ativos") l = l.filter((p) => p.status === "aberta" || p.status === "aceita").sort(ordemData);
    else { if (filtro === "pagos") l = l.filter(estaPago); l.sort((a, b) => ordemData(b, a)); }
    $("lista-pedidos").innerHTML = l.length ? l.map(cartao).join("") : vazio("📋", filtro === "pagos" ? "Nenhum pagamento ainda" : "Nenhum pedido por aqui", filtro === "pagos" ? "Os pedidos pagos e suas notas aparecem aqui." : "Faça seu primeiro pedido na aba Início.", filtro === "pagos" ? "" : '<button class="btn btn-primary" data-ir="tab-home">Solicitar promotor</button>');
}

// ============================================================
// AGENDA
// ============================================================
function renderCalendario() {
    const ano = dataCal.getFullYear(), mes = dataCal.getMonth(), hoje = hojeLocal();
    $("cal-titulo").textContent = dataCal.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase());
    const ini = (new Date(ano, mes, 1).getDay() + 6) % 7, total = new Date(ano, mes + 1, 0).getDate(), com = new Set(pedidos.filter((p) => p.status !== "cancelada").map((p) => p.data));
    let h = "<div></div>".repeat(ini);
    for (let d = 1; d <= total; d++) { const iso = `${ano}-${String(mes + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; h += `<button class="cal-day${iso === hoje ? " today" : ""}${iso === diaSel ? " selected" : ""}${com.has(iso) ? " tem" : ""}" data-dia="${iso}" aria-label="${d}">${d}</button>`; }
    $("cal-grid").innerHTML = h;
}
function renderAgenda() {
    $("cal-label").textContent = "Escolha uma data para ver os turnos.";
    const l = pedidos.filter((p) => (p.status === "aberta" || p.status === "aceita") && p.data >= hojeLocal()).sort(ordemData);
    $("lista-agenda").innerHTML = l.length ? l.map(cartao).join("") : vazio("📅", "Agenda livre", "Os turnos pedidos aparecem aqui, em ordem de data.");
}
function renderDia() {
    const l = pedidos.filter((p) => p.data === diaSel && p.status !== "cancelada").sort(ordemData);
    $("cal-label").textContent = "Turnos de " + new Date(diaSel + "T12:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    $("lista-agenda").innerHTML = l.length ? l.map(cartao).join("") : vazio("📅", "Nenhum turno neste dia", "Escolha outra data ou faça um novo pedido.");
}
$("cal-grid").addEventListener("click", (e) => { const b = e.target.closest("[data-dia]"); if (!b) return; diaSel = diaSel === b.dataset.dia ? "" : b.dataset.dia; renderCalendario(); diaSel ? renderDia() : renderAgenda(); });
$("cal-prev").addEventListener("click", () => { dataCal = new Date(dataCal.getFullYear(), dataCal.getMonth() - 1, 1); renderCalendario(); });
$("cal-next").addEventListener("click", () => { dataCal = new Date(dataCal.getFullYear(), dataCal.getMonth() + 1, 1); renderCalendario(); });

// ============================================================
// CARTEIRA
// ============================================================
function renderCarteira() {
    const pagos = pedidos.filter(estaPago).sort((a, b) => ordemData(b, a)), aceitos = pedidos.filter((p) => p.status === "aceita");
    $("c-total").textContent = brl(pagos.reduce((a, p) => a + sp(p).total, 0));
    $("c-pendente").textContent = brl(aceitos.reduce((a, p) => a + sp(p).total, 0)); $("c-qtd").textContent = pagos.length;
    const meses = [], agora = new Date();
    for (let i = 5; i >= 0; i--) { const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1); meses.push({ k: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, rot: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""), v: 0 }); }
    pagos.forEach((p) => { const m = meses.find((x) => x.k === (p.data || "").slice(0, 7)); if (m) m.v += sp(p).total; });
    const max = Math.max(...meses.map((m) => m.v), 1);
    $("c-barras").innerHTML = meses.map((m) => `<div class="b ${m.v ? "" : "zero"}" title="${brl(m.v)}"><span>${m.v ? brl(m.v).replace(/\s?R\$\s?/, "").replace(",00", "") : ""}</span><i style="height:${Math.max(3, (m.v / max) * 72)}px"></i>${m.rot}</div>`).join("");
    $("c-extrato").innerHTML = pagos.length ? pagos.map((p) => {
        const corpo = `<div class="ico">🧾</div><div class="grow"><strong>${esc(p.loja)}</strong><div class="muted small">${fmtData(p.data)} · ${esc(p.foco)}${p.notaNumero ? ` · Nota ${String(p.notaNumero).padStart(6, "0")}` : ""}</div></div><div class="val">− ${brl(sp(p).total)}</div>`;
        return p.notaId ? `<a class="item" href="nota.html?id=${encodeURIComponent(p.notaId)}" style="color:inherit;text-decoration:none">${corpo}</a>` : `<div class="item">${corpo}</div>`;
    }).join("") : vazio("🧾", "Suas notas aparecem aqui", "Cada pedido pago gera uma nota para a sua contabilidade.");
}
$("btn-csv").addEventListener("click", async () => {
    if (!pedidos.some(estaPago)) return toast("Ainda não há pagamentos para exportar.");
    try { await baixarCSVProtegido("loja/exportar.csv", "abastece-ja-pagamentos.csv"); } catch (e) { erro(e.code === "limite-requisicoes" ? "Aguarde um instante e tente de novo." : "Não foi possível exportar agora."); }
});

// ============================================================
// CHAT
// ============================================================
function renderConversas() {
    const l = pedidos.filter((p) => p.promotorUid && p.status !== "cancelada").sort((a, b) => ordemData(b, a));
    $("lista-conversas").innerHTML = l.length ? l.map((p) => `<div class="card conversa" data-chat="${p.id}" role="button" tabindex="0"><div class="avatar">${esc((p.promotorNome || "P")[0].toUpperCase())}</div><div class="grow"><h4>${esc(p.promotorNome || "Promotor")}</h4><div class="muted small">${esc(p.loja)} · ${fmtData(p.data)}</div></div><span class="seta muted">›</span></div>`).join("")
        : vazio("💬", "Nenhuma conversa ainda", "Quando um promotor aceitar seu pedido, o chat com ele aparece aqui.");
}
function pararChat() { chatUn?.(); chatUn = null; chatPedido = null; }
function abrirChat(p) {
    pararChat(); chatPedido = p; $("chat-titulo").textContent = p.promotorNome || "Promotor"; $("chat-box").innerHTML = skeleton(1);
    chatUn = onSnapshot(query(collection(db, "solicitacoes", p.id, "mensagens"), orderBy("criadoEm")), (s) => {
        const box = $("chat-box");
        box.innerHTML = s.docs.length ? s.docs.map((d) => { const m = d.data(); return `<div class="msg ${m.de === usuario.uid ? "msg-me" : "msg-other"}">${esc(m.texto)}<small>${fmtDataHora(m.criadoEm)}</small></div>`; }).join("") : '<p class="muted small center" style="margin:auto">Diga olá 👋 e combine os detalhes do turno.</p>';
        box.scrollTop = box.scrollHeight;
    }, () => { $("chat-box").innerHTML = '<p class="muted small center">Não foi possível carregar a conversa.</p>'; });
    abrir("sheet-chat");
}
$("chat-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const t = $("chat-input").value.trim(); if (!t || !chatPedido) return; $("chat-input").value = "";
    try { await addDoc(collection(db, "solicitacoes", chatPedido.id, "mensagens"), { de: usuario.uid, texto: t, criadoEm: serverTimestamp() }); }
    catch (err) { console.error(err); erro("Mensagem não enviada."); $("chat-input").value = t; }
});

// ============================================================
// AVALIAÇÃO
// ============================================================
function pintarEstrelas() { $("av-stars").innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" class="${n <= avEstrelas ? "on" : ""}" data-e="${n}" role="radio" aria-checked="${n === avEstrelas}" aria-label="${n} estrela${n > 1 ? "s" : ""}">★</button>`).join(""); }
function abrirAvaliacao(p) { avPedido = p; avEstrelas = 0; $("av-texto").value = ""; $("av-sub").textContent = `Como foi o serviço com ${p.promotorNome || "o promotor"}?`; pintarEstrelas(); abrir("sheet-avaliar"); }
$("av-stars").addEventListener("click", (e) => { const b = e.target.closest("[data-e]"); if (b) { avEstrelas = Number(b.dataset.e); pintarEstrelas(); } });
$("btn-enviar-av").addEventListener("click", async () => {
    if (!avEstrelas) return erro("Escolha de 1 a 5 estrelas.");
    const b = $("btn-enviar-av"); b.disabled = true;
    try { await chamarFuncao("avaliarServico", { solicitacaoId: avPedido.id, estrelas: avEstrelas, comentario: $("av-texto").value.trim() }); ok("Obrigado pela avaliação!"); fechar("sheet-avaliar"); }
    catch (err) { console.error(err); erro("Não foi possível enviar a avaliação."); }
    finally { b.disabled = false; }
});

// ============================================================
// MENU: dados da empresa, preferências, indicação, notificações
// ============================================================
async function salvarPerfil(dados, msg, sheet) {
    try { await setDoc(doc(db, "contratantes", usuario.uid), { ...dados, atualizadoEm: serverTimestamp() }, { merge: true }); perfil = { ...perfil, ...dados }; ok(msg); if (sheet) fechar(sheet); pintarPerfil(); return true; }
    catch (e) { console.error(e); erro("Não foi possível salvar. Verifique as regras do Firestore."); return false; }
}
$("btn-salvar-fiscal").addEventListener("click", async () => {
    $("e-doc").textContent = ""; $("f-doc").classList.remove("invalido");
    const razao = $("f-razao").value.trim(), documento = soDigitos($("f-doc").value), email = $("f-email").value.trim();
    if (razao.length < 3) return erro("Informe a razão social ou o nome da empresa.");
    if (!docValido(documento)) { $("e-doc").textContent = "CNPJ ou CPF inválido. Confira os dígitos."; $("f-doc").classList.add("invalido"); return $("f-doc").focus(); }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return erro("E-mail inválido.");
    await salvarPerfil({ razaoSocial: razao, documento, endereco: $("f-end").value.trim(), email, telefone: soDigitos($("f-tel").value), ramo: $("f-ramo").value }, "Dados da empresa salvos ✓", "sheet-fiscal");
});
$("btn-salvar-prefs").addEventListener("click", async () => {
    if (await salvarPerfil({ prefs: { setor: $("pref-setor").value, entrada: $("pref-entrada").value, saida: $("pref-saida").value } }, "Preferências salvas ✓", "sheet-prefs")) { setorSel = $("pref-setor").value; iniciarFormulario(); }
});
$("btn-copiar").addEventListener("click", () => { navigator.clipboard?.writeText($("link-indicar").value); ok("Link copiado!"); });
$("btn-zap").addEventListener("click", () => window.open("https://api.whatsapp.com/send?text=" + encodeURIComponent("Precisa de promotor ou repositor? Peça pelo Abastece Já e pague só depois do serviço: " + $("link-indicar").value), "_blank", "noopener"));
$("btn-ativar-notif").addEventListener("click", async () => ((await pedirPermissaoNotificacao()) ? ok("Avisos ativados neste aparelho.") : toast("Permissão não concedida. Libere nas configurações do navegador.")));
$("theme-toggle").addEventListener("change", alternarTema);
$("btn-instalar").addEventListener("click", instalarApp);

// ============================================================
// CARTÃO DE CRÉDITO (obrigatório para solicitar/pagar)
// ============================================================
const luhn = (n) => { let soma = 0, alt = false; for (let i = n.length - 1; i >= 0; i--) { let d = +n[i]; if (alt) { d *= 2; if (d > 9) d -= 9; } soma += d; alt = !alt; } return n.length >= 13 && soma % 10 === 0; };
const bandeira = (n) => /^4/.test(n) ? "Visa" : /^(5[1-5]|2[2-7])/.test(n) ? "Mastercard" : /^3[47]/.test(n) ? "Amex" : /^(636368|438935|504175|451416|636297|5067|4576|4011|506699)/.test(n) ? "Elo" : /^606282|^3841/.test(n) ? "Hipercard" : "Cartão";
function renderCartao() {
    $("aviso-cartao").hidden = !!cartaoLoja;
    $("menu-cartao").textContent = cartaoLoja ? `· ${cartaoLoja.bandeira} •••• ${cartaoLoja.ultimos4}` : "· não cadastrado";
    const box = $("cartao-atual"); box.hidden = !cartaoLoja; $("btn-remover-cartao").hidden = !cartaoLoja;
    if (cartaoLoja) box.innerHTML = `<div class="row"><div class="avatar" style="background:var(--green-soft);color:var(--green)">✓</div><div class="grow"><h4>${esc(cartaoLoja.bandeira)} •••• ${esc(cartaoLoja.ultimos4)}</h4><p class="muted small">Validade ${String(cartaoLoja.mes).padStart(2, "0")}/${String(cartaoLoja.ano).slice(-2)}${cartaoLoja.simulado ? " · cartão de teste" : ""}</p></div></div>`;
}
$("k-num").addEventListener("input", (e) => { e.target.value = soDigitos(e.target.value).slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 "); });
$("k-val").addEventListener("input", (e) => { const d = soDigitos(e.target.value).slice(0, 4); e.target.value = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; });
$("k-cvv").addEventListener("input", (e) => { e.target.value = soDigitos(e.target.value).slice(0, 4); });
let mpSdk = null;
async function tokenDoCartao(c) {
    if (!MP_PUBLIC_KEY) throw Object.assign(new Error("O cadastro de cartão ainda não foi habilitado (falta MP_PUBLIC_KEY em config.js)."), { code: "sem-public-key" });
    if (!window.MercadoPago) await new Promise((ok2, err2) => { const sc = document.createElement("script"); sc.src = "https://sdk.mercadopago.com/js/v2"; sc.onload = ok2; sc.onerror = () => err2(Object.assign(new Error("Não foi possível carregar o Mercado Pago."), { code: "sdk" })); document.head.appendChild(sc); });
    mpSdk = mpSdk || new window.MercadoPago(MP_PUBLIC_KEY, { locale: "pt-BR" });
    const doc = soDigitos(perfil.documento || "");
    const t = await mpSdk.createCardToken({ cardNumber: c.numero, cardholderName: c.nome, cardExpirationMonth: String(c.mes).padStart(2, "0"), cardExpirationYear: String(c.ano), securityCode: c.cvv, identificationType: doc.length === 14 ? "CNPJ" : "CPF", identificationNumber: doc || undefined });
    return t.id;
}
$("btn-salvar-cartao").addEventListener("click", async () => {
    ["e-k-num", "e-k-val", "e-k-cvv"].forEach((i) => ($(i).textContent = ""));
    const numero = soDigitos($("k-num").value), nome = $("k-nome").value.trim(), cvv = $("k-cvv").value;
    const [mm, aa] = $("k-val").value.split("/"), mes = Number(mm), ano = 2000 + Number(aa), agora = new Date();
    let falhou = false; const e = (id, m) => { $(id).textContent = m; falhou = true; };
    if (!luhn(numero)) e("e-k-num", "Número de cartão inválido. Confira os dígitos.");
    if (!(mes >= 1 && mes <= 12) || !(ano >= 2000) || ano < agora.getFullYear() || (ano === agora.getFullYear() && mes < agora.getMonth() + 1)) e("e-k-val", "Validade inválida ou cartão vencido.");
    if (cvv.length < 3) e("e-k-cvv", "CVV inválido.");
    if (nome.length < 3) { falhou = true; erro("Informe o nome impresso no cartão."); }
    if (falhou) return;
    const b = $("btn-salvar-cartao"), html = b.innerHTML; b.disabled = true; b.innerHTML = '<span class="spinner"></span> Validando…';
    try {
        // Sandbox: manda só bandeira/últimos 4/validade. Produção: manda um TOKEN gerado pelo Mercado Pago (o número nunca passa pelo nosso servidor).
        const corpo = ehTeste ? { simulado: true, bandeira: bandeira(numero), ultimos4: numero.slice(-4), mes, ano } : { cardToken: await tokenDoCartao({ numero, nome, mes, ano, cvv }) };
        await chamarFuncao("cartao/registrar", corpo);
        ["k-num", "k-val", "k-cvv", "k-nome"].forEach((i) => ($(i).value = ""));
        ok("Cartão validado e cadastrado ✓"); fechar("sheet-cartao");
    } catch (err) { console.error(err); erro(err.message && err.message !== "falha" ? err.message : "Não foi possível validar o cartão. Confira os dados."); }
    finally { b.disabled = false; b.innerHTML = html; }
});
$("btn-remover-cartao").addEventListener("click", async () => {
    if (!confirm("Remover o cartão? Sem cartão cadastrado não é possível solicitar nem pagar serviços.")) return;
    try { await chamarFuncao("cartao/remover"); toast("Cartão removido."); } catch (e) { erro("Não foi possível remover o cartão."); }
});
$("btn-teste-reset").addEventListener("click", async () => {
    if (!confirm("Apagar os pedidos, notas e o cartão das contas de teste?")) return;
    try { const r = await chamarFuncao("teste/resetar"); ok(`Dados de teste zerados (${r.pedidosRemovidos} pedido(s)).`); } catch (e) { erro("Não foi possível zerar os dados de teste."); }
});

// ============================================================
// NAVEGAÇÃO E CLIQUES (delegação)
// ============================================================
function irPara(id) {
    document.querySelectorAll(".tab-content").forEach((t) => t.classList.toggle("active", t.id === id));
    document.querySelectorAll(".nav-item").forEach((i) => i.classList.toggle("active", i.dataset.tab === id));
    window.scrollTo(0, 0);
}
$("bottom-nav").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) irPara(b.dataset.tab); });

document.addEventListener("click", async (e) => {
    const g = (a) => e.target.closest(`[${a}]`), achar = (id) => pedidos.find((p) => p.id === id);
    let el;
    if ((el = g("data-abrir"))) { e.preventDefault(); abrir(el.dataset.abrir); }
    else if ((el = g("data-fechar"))) { fechar(el.dataset.fechar); if (el.dataset.fechar === "sheet-chat") pararChat(); }
    else if (e.target.classList?.contains("app-overlay")) { fechar(e.target.id); if (e.target.id === "sheet-chat") pararChat(); }
    else if ((el = g("data-ir"))) irPara(el.dataset.ir);
    else if ((el = g("data-chamar"))) definirPreferido(el.dataset.chamar, el.dataset.nome);
    else if ((el = g("data-chat"))) { const p = achar(el.dataset.chat); if (p) abrirChat(p); }
    else if ((el = g("data-avaliar"))) { const p = achar(el.dataset.avaliar); if (p) abrirAvaliacao(p); }
    else if ((el = g("data-repetir"))) { const p = achar(el.dataset.repetir); if (p) repetir(p); }
    else if ((el = g("data-cancelar"))) {
        const p = achar(el.dataset.cancelar); if (!p) return;
        if (!confirm(p.status === "aceita" ? `Cancelar o pedido em ${p.loja}? O promotor que já aceitou será avisado.` : `Cancelar o pedido em ${p.loja}?`)) return;
        el.disabled = true;
        try { await chamarFuncao("cancelarPedido", { solicitacaoId: p.id }); ok("Pedido cancelado."); }
        catch (err) { console.error(err); erro("Não foi possível cancelar. Se já foi pago, fale com o suporte."); el.disabled = false; }
    }
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") pararChat();
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("[role=button]")) { e.preventDefault(); e.target.click(); }
});
