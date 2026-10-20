// ============================================================
// ABASTECE JÁ — portal do PROMOTOR
// ============================================================
import { collection, addDoc, doc, setDoc, getDoc, updateDoc, deleteField, query, where, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, db, googleProvider, chamarFuncao } from "./firebase.js";
import { WHATSAPP_SUPORTE } from "./config.js";
import { brl, calcularSplit, reaisParaCentavos, esc, fmtData, fmtDataHora, hojeLocal, mascaraCPF, mascaraTelefone, cpfValido, soDigitos, estaPago, valorCentavos, SETORES, textoRegra } from "./core.js";
import { $, toast, ok, erro, iniciarTema, alternarTema, ligarMascaras, abrir, fechar, skeleton, vazio, registrarSW, instalarApp, pedirPermissaoNotificacao, notificar, baixarCSV } from "./ui.js";

let usuario = null, pub = {}, priv = {}, ofertas = [], turnos = [], filtroSetor = "", ordem = "valor";
let offUn = null, turnosUn = null, chatUn = null, chatPedido = null, qrAtual = null;
let dataCal = new Date(), diaSel = "", prim = { o: true, t: true };
const vistos = new Set(), statusAnt = new Map();

iniciarTema(); registrarSW();
ligarMascaras({ cpf: mascaraCPF, tel: mascaraTelefone });
const baseSite = () => location.origin + location.pathname.replace(/[^/]*$/, "");
const R = textoRegra();
$("btn-whatsapp").href = `https://wa.me/${WHATSAPP_SUPORTE}`;
$("ajuda-zap").href = `https://wa.me/${WHATSAPP_SUPORTE}?text=${encodeURIComponent("Olá! Preciso de ajuda no Abastece Já (promotor).")}`;
$("benef-split").textContent = `Você fica com ${100 - 20}% de cada turno, sem mensalidade`;
$("ajuda-split").textContent = `${R.curto} ${R.exemplo} O valor cai direto na sua conta Mercado Pago; a taxa do próprio Mercado Pago (Pix/cartão) é descontada por ele.`;
$("nota-taxa-mp").textContent = "Os valores mostrados são o que a plataforma repassa a você (80% do turno). O Mercado Pago pode descontar a taxa de processamento dele (ex.: Pix) do valor recebido.";
$("termos-texto").innerHTML = `<strong>1. Autonomia.</strong> Você é prestador independente; escolhe os turnos que aceita. Não há vínculo empregatício com a plataforma ou com as lojas.<br><br>
  <strong>2. Pagamento e taxas.</strong> ${esc(R.curto)} A divisão é feita automaticamente pelo Mercado Pago no momento do pagamento, direto na sua conta conectada. Taxas de processamento do Mercado Pago são dele.<br><br>
  <strong>3. Aprovação.</strong> Seu cadastro passa por análise antes de liberar as ofertas.<br><br>
  <strong>4. Compromisso.</strong> Aceitou, compareça. Se não puder, use “Desistir” com antecedência para o turno voltar à fila.<br><br>
  <strong>5. Obrigações fiscais.</strong> Seus ganhos podem ter obrigações tributárias (MEI/autônomo). A nota emitida pela plataforma é um comprovante e não substitui NFS-e.`;

// ---------- indicação (?ref=) ----------
try { const r = new URLSearchParams(location.search).get("ref"); if (r) localStorage.setItem("abastece_ref", r.replace(/[^\w-]/g, "").slice(0, 40)); } catch (e) {}
const refRecebido = () => { try { return localStorage.getItem("abastece_ref") || ""; } catch (e) { return ""; } };
const novoCodigo = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
if (refRecebido()) $("login-sub").textContent = "🎁 Você foi convidado por um promotor. Cadastre-se e faça seu primeiro turno!";
{ const m = new URLSearchParams(location.search).get("mp"); if (m) { history.replaceState(null, "", location.pathname); setTimeout(() => (m === "ok" ? ok("Mercado Pago conectado! Agora você recebe direto na sua conta.") : erro("Não foi possível conectar o Mercado Pago. Tente de novo.")), 600); } }

// ---------- login ----------
const msgAuth = (e) => ({ "auth/unauthorized-domain": "Domínio não autorizado no Firebase.", "auth/operation-not-allowed": "Login com Google não está ativado no Firebase.", "auth/network-request-failed": "Sem conexão com a internet." })[e.code] ?? ((e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") ? null : `Falha ao autenticar (${e.code || "erro"}).`);
$("check-termos").addEventListener("change", (e) => ($("btn-login").disabled = !e.target.checked));
$("link-termos").addEventListener("click", (e) => { e.preventDefault(); abrir("sheet-termos"); });
$("btn-aceitar-termos").addEventListener("click", () => { $("check-termos").checked = true; $("btn-login").disabled = false; fechar("sheet-termos"); });
$("btn-login").addEventListener("click", async () => {
    const b = $("btn-login"), html = b.innerHTML; b.disabled = true; b.innerHTML = '<span class="spinner"></span> Entrando…';
    try { await signInWithPopup(auth, googleProvider); }
    catch (e) { if (e.code === "auth/popup-blocked") { try { await signInWithRedirect(auth, googleProvider); return; } catch (e2) { e = e2; } } const m = msgAuth(e); if (m) erro(m); b.disabled = false; b.innerHTML = html; }
});
getRedirectResult(auth).catch((e) => { const m = msgAuth(e); if (m) erro(m); });
$("btn-sair").addEventListener("click", async () => { if (!confirm("Deseja sair do portal?")) return; offUn?.(); turnosUn?.(); chatUn?.(); await signOut(auth); });

onAuthStateChanged(auth, async (u) => {
    usuario = u;
    if (!u) { offUn?.(); turnosUn?.(); document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === "screen-login")); $("btn-login").disabled = !$("check-termos").checked; $("btn-login").innerHTML = $("btn-login").innerHTML.replace(/<span class="spinner"><\/span> Entrando…/, "Continuar com Google"); prim = { o: true, t: true }; return; }
    try { await entrar(u); } catch (e) { console.error(e); erro("Não foi possível carregar seu cadastro. Verifique as regras do Firestore."); }
});

async function entrar(u) {
    const ref = doc(db, "profissionais", u.uid);
    let s = await getDoc(ref);
    if (!s.exists()) {
        await setDoc(ref, { nome: u.displayName || "", email: u.email, uid: u.uid, status: "pendente", indicadoPor: refRecebido(), fotoGoogle: u.photoURL || "", criadoEm: serverTimestamp() });
        s = await getDoc(ref);
    }
    pub = s.data();
    if (pub.status === "bloqueado") { erro("Acesso não liberado para esta conta."); await signOut(auth); return; }
    try { priv = (await getDoc(doc(db, "profissionais_privado", u.uid))).data() || {}; } catch (e) { priv = {}; }
    if (!pub.refCode) { pub.refCode = novoCodigo(); updateDoc(ref, { refCode: pub.refCode }).catch(() => {}); }
    document.querySelectorAll(".screen").forEach((x) => x.classList.toggle("active", x.id === "screen-dashboard"));
    montarSetoresPrefs(); pintarPerfil(); escutar(); window.scrollTo(0, 0);
}

const ativo = () => pub.status === "ativo";
const mpOk = () => !!pub.mpConectado;
const nomeProm = () => pub.nome || usuario.displayName || "Promotor";

// ---------- perfil + onboarding ----------
function pintarPerfil() {
    const nome = nomeProm(), ini = nome[0].toUpperCase();
    $("nome-home").textContent = nome.split(" ")[0]; $("nome-menu").textContent = nome;
    for (const id of ["avatar-home", "avatar-menu"]) { const a = $(id); a.textContent = ini; if (pub.fotoGoogle) a.innerHTML = `<img src="${esc(pub.fotoGoogle)}" alt="" referrerpolicy="no-referrer">`; }
    const b = $("badge-status"); b.textContent = ativo() ? "Ativo ✓" : "Em análise"; b.className = "badge " + (ativo() ? "green" : "");
    $("sub-home").textContent = ativo() ? (mpOk() ? "Tudo pronto para pegar turnos." : "Conecte o Mercado Pago para aceitar turnos.") : "Seu cadastro está em análise.";
    $("i-rating").innerHTML = pub.ratingQtd ? `<span class="stars" style="font-size:20px">★</span> ${pub.ratingMedia.toFixed(1)} <small class="muted" style="font-size:12px">(${pub.ratingQtd})</small>` : "—";
    $("link-indicar").value = `${baseSite()}promotor.html?ref=${pub.refCode || ""}`;
    $("indicar-txt").textContent = `Mande seu link para um amigo promotor. Quando ele concluir o primeiro turno, a comissão da plataforma desse turno (os ${20}%) vira bônus para você. Depois disso, tudo segue o padrão normal.`;
    // onboarding
    const itens = [
        { ok: true, t: "Cadastro criado" },
        { ok: !!(priv.cpf && cpfValido(priv.cpf)), t: "Completar seus dados (CPF)", abrir: "sheet-perfil" },
        { ok: !!priv.pix?.chave, t: "Cadastrar chave Pix", abrir: "sheet-pix" },
        { ok: mpOk(), t: "Conectar o Mercado Pago (para receber)", acao: "mp" },
        { ok: ativo(), t: ativo() ? "Cadastro aprovado" : "Aguardar aprovação da equipe" }
    ];
    const feitos = itens.filter((i) => i.ok).length, pct = Math.round(feitos / itens.length * 100);
    $("card-onboarding").hidden = feitos === itens.length;
    $("ob-pct").textContent = pct + "%"; $("ob-bar").style.width = pct + "%";
    $("ob-lista").innerHTML = itens.map((i) => `<div class="todo ${i.ok ? "feito" : ""}" ${i.abrir ? `data-abrir="${i.abrir}"` : ""} ${i.acao ? `data-acao="${i.acao}"` : ""} role="${i.ok || (!i.abrir && !i.acao) ? "listitem" : "button"}"><span class="c">${i.ok ? "✓" : ""}</span><span>${i.t}</span>${!i.ok && (i.abrir || i.acao) ? '<span class="go">›</span>' : ""}</div>`).join("");
    // sheets
    $("d-nome").value = pub.nome || ""; $("d-cpf").value = priv.cpf ? mascaraCPF(priv.cpf) : ""; $("d-nasc").value = priv.nascimento || ""; $("d-tel").value = priv.telefone || ""; $("d-cidade").value = pub.cidade || ""; $("d-bio").value = pub.bio || "";
    $("x-tipo").value = priv.pix?.tipo || "CPF"; $("x-chave").value = priv.pix?.chave || "";
    if (pub.especialidade) { const o = SETORES.find((s) => s.label === pub.especialidade || s.v === pub.especialidade); if (o) $("pf-esp").value = o.v; }
    $("pf-ini").value = pub.disponibilidade?.inicio || "06:00"; $("pf-fim").value = pub.disponibilidade?.fim || "22:00";
    $("pf-min").value = pub.valorMin ? (pub.valorMin / 100).toFixed(2).replace(".", ",") : "";
}
function montarSetoresPrefs() {
    $("pf-esp").innerHTML = SETORES.map((s) => `<option value="${esc(s.v)}">${esc(s.label)}</option>`).join("");
    $("filtro-setor").innerHTML = `<button class="pill sel" data-s="">Todos</button>` + SETORES.map((s) => `<button class="pill" data-s="${esc(s.v)}">${s.ico} ${esc(s.label)}</button>`).join("");
}

// ---------- dados em tempo real ----------
function escutar() {
    offUn?.(); turnosUn?.();
    $("lista-ofertas").innerHTML = skeleton(3); $("lista-proximos").innerHTML = skeleton(2);
    offUn = onSnapshot(query(collection(db, "solicitacoes"), where("status", "==", "aberta")), (snap) => {
        if (ativo()) snap.docChanges().forEach((c) => { if (c.type === "added" && !prim.o && !vistos.has(c.doc.id) && mpOk()) { const x = c.doc.data(); if (valorFiltro(x)) notificar("Nova oferta 🔔", `${x.loja} · ${brl(calcularSplit(valorCentavos(x)).promotor)} para você`); } vistos.add(c.doc.id); });
        prim.o = false;
        ofertas = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderOfertas();
    }, (e) => { ofertas = []; renderOfertas(); if (e.code !== "permission-denied") console.warn(e.code); });
    turnosUn = onSnapshot(query(collection(db, "solicitacoes"), where("promotorUid", "==", usuario.uid)), (snap) => {
        turnos = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => `${a.data}${a.entrada}`.localeCompare(`${b.data}${b.entrada}`));
        if (!prim.t) turnos.forEach((t) => { const a = statusAnt.get(t.id); if (a === "aceita" && estaPago(t)) notificar("Pagamento recebido 💸", `${t.loja} · ${brl(calcularSplit(valorCentavos(t)).promotor)} na sua conta.`); if (a && a !== "cancelada" && t.status === "cancelada") notificar("Turno cancelado", `${t.loja} cancelou o pedido.`); });
        turnos.forEach((t) => statusAnt.set(t.id, t.status)); prim.t = false;
        renderTudo();
    }, (e) => { turnos = []; renderTudo(); if (e.code === "permission-denied") erro("Sem permissão para ler turnos. Publique as regras do Firestore."); });
}
const valorFiltro = (x) => valorCentavos(x) >= (pub.valorMin || 0);
const meu = (t) => calcularSplit(valorCentavos(t)).promotor;
function renderTudo() { renderProximos(); renderAgenda(); renderCarteira(); renderCalendario(); renderConversas(); if (diaSel) renderDia(); }

// ---------- ofertas ----------
function renderOfertas() {
    const el = $("lista-ofertas");
    if (!usuario) return;
    if (!ativo()) { el.innerHTML = vazio("🔒", "Ofertas liberadas após aprovação", "Estamos analisando seu cadastro. Complete seus dados no Início para agilizar."); $("dot-ofertas").hidden = true; return; }
    let l = ofertas.filter((x) => x.data >= hojeLocal() && valorFiltro(x) && (!filtroSetor || x.foco === filtroSetor));
    l.sort((a, b) => ordem === "valor" ? valorCentavos(b) - valorCentavos(a) : `${a.data}${a.entrada}`.localeCompare(`${b.data}${b.entrada}`));
    $("dot-ofertas").hidden = !l.length; $("dot-ofertas").textContent = l.length;
    const aviso = !mpOk() ? `<div class="banner red mb"><span class="ico">🔗</span><div><strong>Conecte o Mercado Pago para aceitar turnos.</strong><br><span class="muted small">É por ele que você recebe sua parte automaticamente.</span><br><a href="#" data-acao="mp">Conectar agora ›</a></div></div>` : "";
    el.innerHTML = aviso + (l.length ? l.map((x) => {
        const s = calcularSplit(valorCentavos(x)), paraMim = x.promotorPreferido && x.promotorPreferido === nomeProm();
        return `<article class="card pedido oferta"><div class="topo"><div class="grow"><h4>${esc(x.loja)}</h4><div class="meta">${fmtData(x.data)} · ${esc(x.entrada)}–${esc(x.saida)} · ${esc(x.foco)}</div></div>${paraMim ? '<span class="badge green">Pedido para você</span>' : ""}</div>
            <div class="ganho"><span>Você recebe<br><small class="muted">loja paga ${brl(s.valor)}</small></span><strong>${brl(s.promotor)}</strong></div>
            <div class="acoes"><button class="btn btn-primary btn-sm" data-aceitar="${x.id}" ${mpOk() ? "" : "disabled"}>Aceitar turno</button></div></article>`;
    }).join("") : vazio("🛒", "Sem ofertas por enquanto", pub.valorMin ? `Nenhuma proposta de ${brl(pub.valorMin)} ou mais agora. Ajuste o mínimo em Menu → Preferências.` : "Novas demandas da região aparecem aqui na hora."));
}
$("filtro-setor").addEventListener("click", (e) => { const b = e.target.closest(".pill"); if (!b) return; filtroSetor = b.dataset.s; document.querySelectorAll("#filtro-setor .pill").forEach((x) => x.classList.toggle("sel", x === b)); renderOfertas(); });
$("btn-ordenar").addEventListener("click", () => { ordem = ordem === "valor" ? "data" : "valor"; $("btn-ordenar").textContent = ordem === "valor" ? "Maior valor ↓" : "Mais cedo ↑"; renderOfertas(); });

async function aceitar(id, b) {
    b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
    try { await updateDoc(doc(db, "solicitacoes", id), { status: "aceita", promotorUid: usuario.uid, promotorNome: nomeProm(), aceitoEm: serverTimestamp() }); ok("Turno aceito! Ele já está na sua escala."); irPara("tab-agenda"); }
    catch (e) { console.error(e); erro(e.code === "permission-denied" ? "Não foi possível aceitar: outro promotor pode ter pegado, ou falta conectar o Mercado Pago." : "Não foi possível aceitar."); b.disabled = false; b.textContent = "Aceitar turno"; }
}

// ---------- turnos / agenda ----------
function cartaoTurno(t) {
    const st = t.status, pago = estaPago(t), cancel = st === "cancelada";
    const acoes = [];
    if (st === "aceita") acoes.push(`<button class="btn btn-primary btn-sm" data-qr="${t.id}">💳 Cobrar (QR)</button>`, `<button class="btn btn-danger btn-sm" data-desistir="${t.id}">Desistir</button>`);
    if (!cancel) acoes.push(`<button class="btn btn-ghost btn-sm" data-chat="${t.id}">💬 Chat</button>`);
    const rot = cancel ? ["Cancelado", "red"] : pago ? ["Recebido", "green"] : ["Aguardando pagamento", "blue"];
    return `<article class="card pedido ${cancel ? "cancelada" : ""}"><div class="topo"><div class="grow"><h4>${esc(t.loja)}</h4><div class="meta">${fmtData(t.data)} · ${esc(t.entrada)}–${esc(t.saida)} · ${esc(t.foco)}</div></div>
        <div class="center"><div class="valor">${brl(meu(t))}</div><span class="badge ${rot[1]}" style="margin-top:4px">${rot[0]}</span></div></div>
        ${acoes.length ? `<div class="acoes">${acoes.join("")}</div>` : ""}</article>`;
}
function renderProximos() {
    const l = turnos.filter((t) => t.status === "aceita" && t.data >= hojeLocal()).slice(0, 4);
    $("lista-proximos").innerHTML = l.length ? l.map(cartaoTurno).join("") : vazio("📅", "Nenhum turno agendado", "Aceite turnos em Ofertas e eles aparecem aqui.");
}
function renderAgenda() { $("lista-agenda").innerHTML = diaSel ? "" : turnos.filter((t) => t.status !== "cancelada" && !estaPago(t)).map(cartaoTurno).join("") || vazio("📅", "Nenhum turno por aqui", "Os turnos aceitos aparecem neste espaço."); }
function renderCalendario() {
    const ano = dataCal.getFullYear(), mes = dataCal.getMonth(), hoje = hojeLocal();
    $("cal-titulo").textContent = dataCal.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase());
    const ini = (new Date(ano, mes, 1).getDay() + 6) % 7, total = new Date(ano, mes + 1, 0).getDate(), com = new Set(turnos.filter((t) => t.status !== "cancelada").map((t) => t.data));
    let h = "<div></div>".repeat(ini);
    for (let d = 1; d <= total; d++) { const iso = `${ano}-${String(mes + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; h += `<button class="cal-day${iso === hoje ? " today" : ""}${iso === diaSel ? " selected" : ""}${com.has(iso) ? " tem" : ""}" data-dia="${iso}" aria-label="${d}">${d}</button>`; }
    $("cal-grid").innerHTML = h;
}
function renderDia() {
    const l = turnos.filter((t) => t.data === diaSel && t.status !== "cancelada");
    $("cal-label").textContent = "Turnos de " + new Date(diaSel + "T12:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    $("lista-agenda").innerHTML = l.length ? l.map(cartaoTurno).join("") : vazio("📅", "Nenhum turno neste dia", "Escolha outra data ou veja as ofertas.");
}
$("cal-grid").addEventListener("click", (e) => { const b = e.target.closest("[data-dia]"); if (!b) return; diaSel = diaSel === b.dataset.dia ? "" : b.dataset.dia; renderCalendario(); if (diaSel) renderDia(); else { $("cal-label").textContent = "Escolha uma data para ver seus turnos."; renderAgenda(); } });
$("cal-prev").addEventListener("click", () => { dataCal = new Date(dataCal.getFullYear(), dataCal.getMonth() - 1, 1); renderCalendario(); });
$("cal-next").addEventListener("click", () => { dataCal = new Date(dataCal.getFullYear(), dataCal.getMonth() + 1, 1); renderCalendario(); });

// ---------- QR de cobrança ----------
function abrirQR(t) {
    const link = `${baseSite()}pagar.html?id=${encodeURIComponent(t.id)}`, s = calcularSplit(valorCentavos(t)); qrAtual = { link, t };
    $("qr-box").innerHTML = ""; if (window.QRCode) new QRCode($("qr-box"), { text: link, width: 200, height: 200 }); else $("qr-box").textContent = "QR indisponível — use o link.";
    $("qr-total").textContent = `A loja paga ${brl(s.total)}`; $("qr-liquido").textContent = `Você recebe ${brl(s.promotor)} (${100 - s.pct}% do turno de ${brl(s.valor)})`;
    abrir("sheet-qr");
}
$("qr-copiar").addEventListener("click", () => { navigator.clipboard?.writeText(qrAtual.link); ok("Link de pagamento copiado!"); });
$("qr-zap").addEventListener("click", () => window.open("https://api.whatsapp.com/send?text=" + encodeURIComponent(`Serviço de reposição concluído em ${qrAtual.t.loja}. Pague aqui: ${qrAtual.link}`), "_blank", "noopener"));

// ---------- carteira ----------
function renderCarteira() {
    const pagos = turnos.filter(estaPago), aceitos = turnos.filter((t) => t.status === "aceita");
    const recebido = pagos.reduce((a, t) => a + (t.pagamento?.split?.promotor ?? meu(t)), 0), receber = aceitos.reduce((a, t) => a + meu(t), 0);
    $("c-recebido").textContent = $("i-recebido").textContent = brl(recebido); $("c-receber").textContent = $("i-receber").textContent = brl(receber); $("c-qtd").textContent = pagos.length;
    const meses = [], agora = new Date();
    for (let i = 5; i >= 0; i--) { const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1); meses.push({ k: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, rot: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""), v: 0 }); }
    pagos.forEach((t) => { const m = meses.find((x) => x.k === (t.data || "").slice(0, 7)); if (m) m.v += t.pagamento?.split?.promotor ?? meu(t); });
    const max = Math.max(...meses.map((m) => m.v), 1);
    $("c-barras").innerHTML = meses.map((m) => `<div class="b ${m.v ? "" : "zero"}" title="${brl(m.v)}"><span>${m.v ? brl(m.v).replace(/\s?R\$\s?/, "").replace(",00", "") : ""}</span><i style="height:${Math.max(3, m.v / max * 72)}px"></i>${m.rot}</div>`).join("");
    $("c-extrato").innerHTML = pagos.length ? pagos.slice().reverse().map((t) => `<div class="item"><div class="ico">💸</div><div class="grow"><strong>${esc(t.loja)}</strong><div class="muted small">${fmtData(t.data)} · ${esc(t.foco)}${t.avaliacao ? ` · <span class="stars">${"★".repeat(t.avaliacao.estrelas)}</span>` : ""}</div></div><div class="val" style="color:var(--green)">+ ${brl(t.pagamento?.split?.promotor ?? meu(t))}</div></div>`).join("") : vazio("💸", "Seus ganhos aparecem aqui", "Cada turno pago entra neste histórico.");
    $("card-mp").innerHTML = mpOk()
        ? `<div class="row"><div class="avatar" style="background:var(--green-soft);color:var(--green)">✓</div><div class="grow"><h4>Mercado Pago conectado</h4><p class="muted small">Você recebe sua parte direto na sua conta, no momento do pagamento.</p></div></div>`
        : `<div class="row"><div class="avatar" style="background:var(--red-soft);color:var(--red)">!</div><div class="grow"><h4>Conecte o Mercado Pago</h4><p class="muted small">Sem isso não dá para aceitar turnos: é por ele que o pagamento é dividido e cai na sua conta.</p></div></div><button class="btn btn-primary mt" data-acao="mp">🔗 Conectar Mercado Pago</button>`;
}
$("btn-csv").addEventListener("click", () => {
    const pagos = turnos.filter(estaPago); if (!pagos.length) return toast("Ainda não há ganhos para exportar.");
    baixarCSV("abastece-ja-ganhos.csv", [["Data do serviço", "Loja", "Setor", "Valor do turno", "Você recebeu", "Pago em"], ...pagos.map((t) => [fmtData(t.data), t.loja, t.foco, (valorCentavos(t) / 100).toFixed(2).replace(".", ","), ((t.pagamento?.split?.promotor ?? meu(t)) / 100).toFixed(2).replace(".", ","), fmtDataHora(t.pagaEm)])]);
});
async function conectarMP(b) {
    if (b) { b.disabled = true; }
    try { const { url } = await chamarFuncao("mpConectarUrl"); location.href = url; }
    catch (e) { console.error(e); erro(e.code === "backend-nao-configurado" ? "O backend de pagamento ainda não foi publicado (FUNCTIONS_BASE em config.js)." : (e.code === 404 || e.code === "rota-inexistente") ? "O servidor de pagamentos não respondeu (404). Confira se o serviço no Render está no ar." : e.code === "mp-nao-configurado" ? "O Mercado Pago ainda não foi configurado no servidor." : "Não foi possível iniciar a conexão com o Mercado Pago."); if (b) b.disabled = false; }
}

// ---------- chat ----------
function renderConversas() {
    const l = turnos.filter((t) => t.status !== "cancelada");
    $("lista-conversas").innerHTML = l.length ? l.map((t) => `<div class="card conversa" data-chat="${t.id}" role="button" tabindex="0"><div class="avatar">${esc((t.loja || "L")[0])}</div><div class="grow"><h4>${esc(t.loja)}</h4><div class="muted small">${fmtData(t.data)} · ${esc(t.entrada)}–${esc(t.saida)}</div></div><span class="seta muted">›</span></div>`).join("") : vazio("💬", "Nenhuma conversa ainda", "Quando você aceitar um turno, o chat com a loja aparece aqui.");
}
function abrirChat(t) {
    chatPedido = t; $("chat-titulo").textContent = t.loja; $("chat-box").innerHTML = skeleton(1); chatUn?.();
    chatUn = onSnapshot(query(collection(db, "solicitacoes", t.id, "mensagens"), orderBy("criadoEm")), (s) => {
        const box = $("chat-box");
        box.innerHTML = s.docs.length ? s.docs.map((d) => { const m = d.data(), eu = m.de === usuario.uid; return `<div class="msg ${eu ? "msg-me" : "msg-other"}">${esc(m.texto)}<small>${fmtDataHora(m.criadoEm)}</small></div>`; }).join("") : '<p class="muted small center" style="margin:auto">Diga olá 👋 e combine os detalhes.</p>';
        box.scrollTop = box.scrollHeight;
    }, () => { $("chat-box").innerHTML = '<p class="muted small center">Não foi possível carregar a conversa.</p>'; });
    abrir("sheet-chat");
}
$("chat-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const t = $("chat-input").value.trim(); if (!t || !chatPedido) return; $("chat-input").value = "";
    try { await addDoc(collection(db, "solicitacoes", chatPedido.id, "mensagens"), { de: usuario.uid, texto: t, criadoEm: serverTimestamp() }); } catch (err) { erro("Mensagem não enviada."); $("chat-input").value = t; }
});

// ---------- formulários do menu ----------
async function salvar(colecao, dados, msg, sheet) {
    try { await setDoc(doc(db, colecao, usuario.uid), { ...dados, atualizadoEm: serverTimestamp() }, { merge: true }); ok(msg); if (sheet) fechar(sheet); return true; }
    catch (e) { console.error(e); erro("Não foi possível salvar. Verifique as regras do Firestore."); return false; }
}
$("btn-salvar-perfil").addEventListener("click", async () => {
    const cpf = soDigitos($("d-cpf").value); $("e-cpf").textContent = ""; $("d-cpf").classList.remove("invalido");
    if ($("d-nome").value.trim().length < 3) return erro("Informe seu nome completo.");
    if (cpf && !cpfValido(cpf)) { $("e-cpf").textContent = "CPF inválido. Confira os 11 dígitos."; $("d-cpf").classList.add("invalido"); return $("d-cpf").focus(); }
    const a = await salvar("profissionais", { nome: $("d-nome").value.trim(), cidade: $("d-cidade").value.trim(), bio: $("d-bio").value.trim() }, "Dados salvos ✓");
    const b = await salvar("profissionais_privado", { cpf, nascimento: $("d-nasc").value, telefone: $("d-tel").value.trim() }, "Dados salvos ✓", "sheet-perfil");
    if (a && b) { pub.nome = $("d-nome").value.trim(); pub.cidade = $("d-cidade").value.trim(); pub.bio = $("d-bio").value.trim(); priv = { ...priv, cpf, nascimento: $("d-nasc").value, telefone: $("d-tel").value.trim() }; pintarPerfil(); }
});
$("btn-salvar-pix").addEventListener("click", async () => {
    const chave = $("x-chave").value.trim(); if (!chave) return erro("Informe a chave Pix.");
    if (await salvar("profissionais_privado", { pix: { tipo: $("x-tipo").value, chave } }, "Chave Pix salva ✓", "sheet-pix")) { priv.pix = { tipo: $("x-tipo").value, chave }; pintarPerfil(); }
});
$("btn-salvar-prefs").addEventListener("click", async () => {
    const min = reaisParaCentavos($("pf-min").value), esp = SETORES.find((s) => s.v === $("pf-esp").value);
    if (await salvar("profissionais", { valorMin: min, especialidade: esp?.label || "", disponibilidade: { inicio: $("pf-ini").value, fim: $("pf-fim").value } }, "Preferências salvas ✓", "sheet-prefs")) { pub.valorMin = min; pub.especialidade = esp?.label; renderOfertas(); }
});
$("btn-copiar").addEventListener("click", () => { navigator.clipboard?.writeText($("link-indicar").value); ok("Link copiado!"); });
$("btn-zap").addEventListener("click", () => window.open("https://api.whatsapp.com/send?text=" + encodeURIComponent("Quer pegar turnos de reposição e receber direto no Mercado Pago? Cadastre-se no Abastece Já: " + $("link-indicar").value), "_blank", "noopener"));
$("btn-ativar-notif").addEventListener("click", async () => (await pedirPermissaoNotificacao()) ? ok("Avisos ativados neste aparelho.") : toast("Permissão não concedida. Libere nas configurações do navegador."));
$("theme-toggle").addEventListener("change", alternarTema);
$("btn-instalar").addEventListener("click", instalarApp);

// ---------- cliques globais (delegação) ----------
document.addEventListener("click", async (e) => {
    const g = (a) => e.target.closest(`[${a}]`);
    let el;
    if ((el = g("data-aceitar"))) aceitar(el.dataset.aceitar, el);
    else if ((el = g("data-qr"))) { const t = turnos.find((x) => x.id === el.dataset.qr); if (t) abrirQR(t); }
    else if ((el = g("data-chat"))) { const t = turnos.find((x) => x.id === el.dataset.chat); if (t) abrirChat(t); }
    else if ((el = g("data-desistir"))) {
        const t = turnos.find((x) => x.id === el.dataset.desistir); if (!t || !confirm(`Desistir do turno em ${t.loja}? Ele volta para a fila de ofertas.`)) return;
        try { await updateDoc(doc(db, "solicitacoes", t.id), { status: "aberta", promotorUid: deleteField(), promotorNome: deleteField(), aceitoEm: deleteField() }); ok("Você saiu do turno. Ele voltou para a fila."); } catch (err) { erro("Não foi possível desistir agora."); }
    }
    if ((el = g("data-acao")) && el.dataset.acao === "mp") { e.preventDefault(); conectarMP(el.tagName === "BUTTON" ? el : null); }
    if ((el = g("data-abrir"))) { e.preventDefault(); abrir(el.dataset.abrir); }
    if ((el = g("data-fechar"))) fechar(el.dataset.fechar);
    if (e.target.classList?.contains("app-overlay")) fechar(e.target.id);
});
document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("[role=button]")) { e.preventDefault(); e.target.click(); } });

function irPara(id) {
    document.querySelectorAll(".tab-content").forEach((t) => t.classList.toggle("active", t.id === id));
    document.querySelectorAll(".nav-item").forEach((i) => i.classList.toggle("active", i.dataset.tab === id)); window.scrollTo(0, 0);
}
$("nav-personal").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) irPara(b.dataset.tab); });
