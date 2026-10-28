// ============================================================
// ABASTECE JÁ — portal do PROMOTOR / FREELANCER (a partir dos 16 anos)
// Dados sensíveis, dinheiro, treinamento e status só trafegam pela API do servidor; o Firestore é lido, quase nunca escrito.
// ============================================================
import { collection, addDoc, doc, setDoc, getDoc, query, where, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, reauthenticateWithPopup } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, db, googleProvider, chamarFuncao, consultar, baixarCSVProtegido, renovarToken, testeAtivo, loginDeTeste, contaDeTeste } from "./firebase.js";
import { resolverAcesso, telaOutroPerfil, telaFalhaTemporaria } from "./acesso.js";
import { WHATSAPP_SUPORTE, REPASSE_PROFISSIONAL_CENTAVOS, HORAS_MIN_TURNO, HORAS_MAX_TURNO, MAX_VEZES_SEMANA_LOJA, IDADE_MINIMA, MENOR_JANELA_INICIO, MENOR_JANELA_FIM, MENOR_SETORES_VEDADOS } from "./config.js";
import { brl, reaisParaCentavos, esc, fmtData, fmtDataHora, hojeLocal, mascaraCPF, mascaraTelefone, cpfValido, soDigitos, estaPago, valorPromotor, validarNascimento, limitesNascimento, SETORES, textoTermos } from "./core.js";
import { $, toast, ok, erro, iniciarTema, alternarTema, ligarMascaras, abrir, fechar, skeleton, vazio, registrarSW, instalarApp, pedirPermissaoNotificacao, notificar } from "./ui.js";

let usuario = null, pub = {}, priv = {}, hab = { habilitado: false, pendencias: [], treinamento: { concluidos: 0, total: 0, completo: false } }, treino = null, carteiraDados = null;
let ofertas = [], turnos = [], filtroSetor = "", ordem = "valor";
let offUn = null, turnosUn = null, chatUn = null, chatPedido = null, qrAtual = null;
let dataCal = new Date(), diaSel = "", prim = { o: true, t: true };
const vistos = new Set(), statusAnt = new Map();

iniciarTema(); registrarSW();
ligarMascaras({ cpf: mascaraCPF, tel: mascaraTelefone });
const baseSite = () => location.origin + location.pathname.replace(/[^/]*$/, "");
$("btn-whatsapp").href = `https://wa.me/${WHATSAPP_SUPORTE}`;
$("ajuda-zap").href = `https://wa.me/${WHATSAPP_SUPORTE}?text=${encodeURIComponent("Olá! Preciso de ajuda no Abastece Já (promotor).")}`;
$("benef-split").textContent = `Receba ${brl(REPASSE_PROFISSIONAL_CENTAVOS)} por diária (turnos de ${HORAS_MIN_TURNO} a ${HORAS_MAX_TURNO} horas), sem mensalidade`;
$("ajuda-split").textContent = `Você recebe ${brl(REPASSE_PROFISSIONAL_CENTAVOS)} por diária, creditados na sua carteira digital depois do pagamento da loja. O saldo fica alguns dias em carência e depois você saca por Pix. Cada turno tem de ${HORAS_MIN_TURNO} a ${HORAS_MAX_TURNO} horas e você pode fazer até ${MAX_VEZES_SEMANA_LOJA} turnos por semana na mesma loja. Para aceitar turnos é preciso concluir o treinamento PRATICAMENTE.`;
$("nota-taxa-mp").textContent = "Pagamentos estornados ou contestados pela loja são descontados da carteira.";
$("termos-texto").innerHTML = textoTermos("promotor");

// ---------- indicação (?ref=) ----------
try { const r = new URLSearchParams(location.search).get("ref"); if (r) localStorage.setItem("abastece_ref", r.replace(/[^\w-]/g, "").slice(0, 40)); } catch (e) {}
const refRecebido = () => { try { return localStorage.getItem("abastece_ref") || ""; } catch (e) { return ""; } };
if (refRecebido()) $("login-sub").textContent = "🎁 Você foi convidado por um promotor. Cadastre-se e faça seu primeiro turno!";

// ---------- login ----------
const msgAuth = (e) => ({ "auth/unauthorized-domain": "Domínio não autorizado no Firebase.", "auth/operation-not-allowed": "Login com Google não está ativado no Firebase.", "auth/network-request-failed": "Sem conexão com a internet." })[e.code] ?? ((e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") ? null : `Falha ao autenticar (${e.code || "erro"}).`);
$("check-termos").addEventListener("change", (e) => ($("btn-login").disabled = !e.target.checked));
const abrirTermos = (e) => { e.preventDefault(); abrir("sheet-termos"); };
$("link-termos").addEventListener("click", abrirTermos); $("link-termos2").addEventListener("click", abrirTermos);
$("btn-aceitar-termos").addEventListener("click", () => { $("check-termos").checked = true; $("c-termos").checked = true; $("btn-login").disabled = false; fechar("sheet-termos"); });
$("btn-login").addEventListener("click", async () => {
    const b = $("btn-login"), html = b.innerHTML; b.disabled = true; b.innerHTML = '<span class="spinner"></span> Entrando…';
    try { await signInWithPopup(auth, googleProvider); }
    catch (e) { if (e.code === "auth/popup-blocked") { try { await signInWithRedirect(auth, googleProvider); return; } catch (e2) { e = e2; } } const m = msgAuth(e); if (m) erro(m); b.disabled = false; b.innerHTML = html; }
});
testeAtivo().then((a) => { $("bloco-teste").hidden = !a; });
$("btn-login-teste").addEventListener("click", async () => {
    const b = $("btn-login-teste"); b.disabled = true;
    try { await loginDeTeste("promotor"); } catch (e) { console.error(e); erro("Não foi possível entrar no modo de teste."); b.disabled = false; }
});
getRedirectResult(auth).catch((e) => { const m = msgAuth(e); if (m) erro(m); });
const sair = async () => { offUn?.(); turnosUn?.(); chatUn?.(); pararPings(); await signOut(auth); };
$("btn-sair").addEventListener("click", async () => { if (confirm("Deseja sair do portal?")) await sair(); });
$("btn-cadastro-sair").addEventListener("click", sair);

const tela = (id) => document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
onAuthStateChanged(auth, async (u) => {
    usuario = u;
    if (!u) { offUn?.(); turnosUn?.(); pararPings(); tela("screen-login"); $("btn-login").disabled = !$("check-termos").checked; $("btn-login").innerHTML = $("btn-login").innerHTML.replace(/<span class="spinner"><\/span> Entrando…/, "Continuar com Google"); prim = { o: true, t: true }; return; }
    try { await entrar(u); } catch (e) { console.error(e); erro("Não foi possível carregar seu cadastro. Tente novamente."); }
});

/**
 * O perfil ativo é decidido pelo SERVIDOR (/sessao) para o portal aberto — nunca pelo navegador.
 * Perfil errado ou conta com vários perfis NÃO derruba a sessão: mostra a tela de escolha (painel certo / outra conta).
 */
const trocarConta = async () => { await sair(); };
const mostrarOutroPerfil = (r) => telaOutroPerfil({ portal: "promotor", perfis: r?.perfis, email: usuario?.email, trocarConta });
async function entrar(u) {
    let r;
    try { r = await resolverAcesso("promotor"); }
    catch (e) { console.warn(e); return telaFalhaTemporaria({ tentarDeNovo: () => entrar(u), trocarConta }); }
    if (r.estado === "outro-perfil" || r.estado === "escolher") return mostrarOutroPerfil(r);
    if (r.estado === "cadastro") return abrirCadastro(false);
    const s = await getDoc(doc(db, "profissionais", u.uid));
    if (!s.exists()) return abrirCadastro(false);
    pub = s.data();
    if (pub.status === "bloqueado") { erro("Acesso não liberado para esta conta."); return sair(); }
    await Promise.all([carregarPrivado(), carregarHabilitacao()]);
    if (!priv.nascimento || !priv.temCpf || (priv.menor && !priv.autorizacaoResponsavel)) return abrirCadastro(true);   // conta antiga ou dados faltando
    tela("screen-dashboard");
    $("btn-teste-reset").hidden = !(await contaDeTeste());
    montarSetoresPrefs(); pintarPerfil(); escutar(); carregarCarteira(); carregarTreino();
    window.scrollTo(0, 0);
}
const carregarPrivado = async () => { try { priv = await consultar("perfil/privado"); } catch (e) { priv = {}; } };
const carregarHabilitacao = async () => { try { hab = await consultar("habilitacao"); } catch (e) { console.warn(e); } };

// ---------- cadastro (primeiro acesso) e conclusão de dados ----------
let modoCompletar = false;
function abrirCadastro(completar) {
    modoCompletar = completar; tela("screen-cadastro");
    const lim = limitesNascimento(); $("c-nasc").min = lim.min; $("c-nasc").max = lim.max;
    $("c-nasc-dica").textContent = `Cadastro permitido a partir dos ${IDADE_MINIMA} anos.`;
    $("c-nasc").value = priv.nascimento || ""; $("c-nasc").readOnly = !!priv.nascimento;
    $("c-cpf").value = priv.cpfMascarado || ""; $("c-cpf").readOnly = !!priv.temCpf;
    $("c-tel").value = priv.telefone ? mascaraTelefone(priv.telefone) : "";
    $("c-termos").checked = $("check-termos").checked; $("c-termos").closest(".check-line").hidden = completar;
    $("btn-cadastrar").textContent = completar ? "Salvar e continuar" : "Concluir cadastro"; atualizarBlocoResp();
}
function atualizarBlocoResp() { const v = validarNascimento($("c-nasc").value); $("bloco-resp").hidden = !(v.menor && !(priv.autorizacaoResponsavel)); }
$("c-nasc").addEventListener("input", atualizarBlocoResp);
$("btn-cadastrar").addEventListener("click", async () => {
    document.querySelectorAll("#screen-cadastro .msg-erro").forEach((x) => (x.textContent = ""));
    let falhou = false; const e = (id, m) => { $(id).textContent = m; falhou = true; };
    const nasc = $("c-nasc").value, cpf = soDigitos($("c-cpf").value), tel = soDigitos($("c-tel").value), vn = validarNascimento(nasc);
    if (vn.erro) e("e-c-nasc", vn.erro);
    if (!priv.temCpf && !cpfValido(cpf)) e("e-c-cpf", "CPF inválido. Confira os 11 dígitos.");
    if (tel.length < 10 || tel.length > 11) e("e-c-tel", "Informe DDD + número.");
    let responsavel;
    if (vn.menor && !priv.autorizacaoResponsavel) {
        const rc = soDigitos($("c-resp-cpf").value), rt = soDigitos($("c-resp-tel").value), rn = $("c-resp-nome").value.trim();
        if (rn.length < 5) e("e-c-resp-nome", "Informe o nome completo do responsável.");
        if (!cpfValido(rc)) e("e-c-resp-cpf", "CPF do responsável inválido."); else if (rc === cpf) e("e-c-resp-cpf", "Deve ser diferente do seu CPF.");
        if (rt.length < 10) e("e-c-resp-tel", "Telefone inválido.");
        if (!$("c-resp-ok").checked) { erro("Confirme a autorização do responsável."); falhou = true; }
        responsavel = { nome: rn, cpf: rc, telefone: rt, parentesco: $("c-resp-par").value };
    }
    if (!modoCompletar && !$("c-termos").checked) { erro("Aceite os Termos de Uso para continuar."); falhou = true; }
    if (falhou) return;
    const b = $("btn-cadastrar"), html = b.innerHTML; b.disabled = true; b.innerHTML = '<span class="spinner"></span> Salvando…';
    try {
        const corpo = { ...(priv.nascimento ? {} : { nascimento: nasc }), ...(priv.temCpf ? {} : { cpf }), telefone: tel, ...(responsavel ? { responsavel, autorizacaoResponsavel: true } : {}) };
        if (modoCompletar) await chamarFuncao("perfil/promotor/privado", corpo, "PUT");
        else await chamarFuncao("cadastro/promotor", { ...corpo, termos: true, nome: usuario.displayName || "", indicadoPor: refRecebido() });
        await renovarToken(); await entrar(usuario);
    } catch (err) {
        console.error(err);
        if (err.code === "papel-conflito") return mostrarOutroPerfil({ perfis: [err.detalhe?.tem || err.detalhe?.sugerido].filter(Boolean) });   // corrida: a conta já tem o outro perfil
        const m = { "idade-minima": `É preciso ter pelo menos ${IDADE_MINIMA} anos para se cadastrar.`, "cpf-duplicado": err.message, "dado-travado": err.message, "limite-requisicoes": err.message }[err.code];
        erro(m || err.message || "Não foi possível concluir o cadastro.");
    } finally { b.disabled = false; b.innerHTML = html; }
});

// ---------- estado derivado ----------
const ativo = () => pub.status === "ativo";
const habilitado = () => hab.habilitado === true;
const nomeProm = () => pub.nome || usuario.displayName || "Promotor";
const PENDENCIA = { aprovacao: "aguardar a aprovação do cadastro", nascimento: "informar a data de nascimento", "idade-minima": `ter ${IDADE_MINIMA} anos ou mais`, responsavel: "enviar a autorização do responsável legal", treinamento: "concluir o treinamento PRATICAMENTE" };
const textoPendencias = () => (hab.pendencias || []).map((p) => PENDENCIA[p] || p).join(", ");

// ---------- perfil + onboarding ----------
function pintarPerfil() {
    const nome = nomeProm(), ini = nome[0].toUpperCase();
    $("nome-home").textContent = nome.split(" ")[0]; $("nome-menu").textContent = nome;
    for (const id of ["avatar-home", "avatar-menu"]) { const a = $(id); a.textContent = ini; if (pub.fotoGoogle) a.innerHTML = `<img src="${esc(pub.fotoGoogle)}" alt="" referrerpolicy="no-referrer">`; }
    const b = $("badge-status"); b.textContent = ativo() ? "Ativo ✓" : "Em análise"; b.className = "badge " + (ativo() ? "green" : "");
    $("sub-home").textContent = habilitado() ? "Tudo pronto para pegar turnos." : `Para liberar os turnos: ${textoPendencias() || "aguarde"}.`;
    $("i-rating").innerHTML = pub.ratingQtd ? `<span class="stars" style="font-size:20px">★</span> ${pub.ratingMedia.toFixed(1)} <small class="muted" style="font-size:12px">(${pub.ratingQtd})</small>` : "—";
    $("link-indicar").value = `${baseSite()}promotor.html?ref=${pub.refCode || ""}`;
    $("indicar-txt").textContent = `Mande seu link para um amigo promotor. Quando ele concluir o primeiro turno, você ganha um bônus de indicação. Depois disso, tudo segue o padrão normal.`;
    const t = hab.treinamento || { concluidos: 0, total: 0, completo: false };
    const itens = [
        { ok: true, t: "Cadastro criado" },
        { ok: !!priv.nascimento && !!priv.temCpf, t: "Dados pessoais (nascimento e CPF)", abrir: "sheet-perfil" },
        ...(priv.menor ? [{ ok: !!priv.autorizacaoResponsavel, t: "Autorização do responsável legal" }] : []),
        { ok: !!priv.pix, t: "Cadastrar chave Pix (para sacar)", abrir: "sheet-pix" },
        { ok: t.completo, t: t.total ? `Treinamento PRATICAMENTE (${t.concluidos}/${t.total})` : "Treinamento PRATICAMENTE", ir: "tab-treino" },
        { ok: ativo(), t: ativo() ? "Cadastro aprovado" : "Aguardar aprovação da equipe" }
    ];
    const feitos = itens.filter((i) => i.ok).length, pct = Math.round((feitos / itens.length) * 100);
    $("card-onboarding").hidden = feitos === itens.length;
    $("ob-pct").textContent = pct + "%"; $("ob-bar").style.width = pct + "%";
    $("ob-lista").innerHTML = itens.map((i) => `<div class="todo ${i.ok ? "feito" : ""}" ${i.abrir ? `data-abrir="${i.abrir}"` : ""} ${i.ir ? `data-ir="${i.ir}"` : ""} role="${i.ok || (!i.abrir && !i.ir) ? "listitem" : "button"}" ${!i.ok && (i.abrir || i.ir) ? 'tabindex="0"' : ""}><span class="c">${i.ok ? "✓" : ""}</span><span>${esc(i.t)}</span>${!i.ok && (i.abrir || i.ir) ? '<span class="go">›</span>' : ""}</div>`).join("");
    // "Meus dados": CPF e nascimento, uma vez gravados, só o suporte altera
    $("d-nome").value = pub.nome || ""; $("d-nome").readOnly = pub.status !== "pendente";
    $("d-cpf").value = priv.cpfMascarado || ""; $("d-cpf").readOnly = true; $("d-cpf-dica").textContent = priv.temCpf ? "Para alterar o CPF, fale com o suporte." : "";
    const lim = limitesNascimento(); $("d-nasc").min = lim.min; $("d-nasc").max = lim.max; $("d-nasc").value = priv.nascimento || ""; $("d-nasc").readOnly = true; $("d-nasc-dica").textContent = priv.nascimento ? "Para alterar, fale com o suporte." : "";
    $("d-tel").value = priv.telefone ? mascaraTelefone(priv.telefone) : ""; $("d-cidade").value = pub.cidade || ""; $("d-bio").value = pub.bio || "";
    $("x-atual").textContent = priv.pix ? `Chave atual: ${priv.pix.tipo} ${priv.pix.chaveMascarada}` : "Nenhuma chave cadastrada.";
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
    offUn?.(); turnosUn?.(); prim = { o: true, t: true };
    $("lista-ofertas").innerHTML = skeleton(3); $("lista-proximos").innerHTML = skeleton(2);
    // Ofertas abertas só são legíveis para quem concluiu o treinamento (regra do Firestore + claim "treinado")
    if (hab.treinamento?.completo) {
        offUn = onSnapshot(query(collection(db, "solicitacoes"), where("status", "==", "aberta")), (snap) => {
            if (habilitado()) snap.docChanges().forEach((c) => { if (c.type === "added" && !prim.o && !vistos.has(c.doc.id)) { const x = c.doc.data(); if (valorFiltro(x) && podeVer(x)) notificar("Nova oferta 🔔", `${x.loja} · ${brl(valorPromotor(x))} para você`); } vistos.add(c.doc.id); });
            prim.o = false;
            ofertas = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderOfertas();
        }, (e) => { ofertas = []; renderOfertas(); if (e.code !== "permission-denied") console.warn(e.code); });
    } else { ofertas = []; renderOfertas(); }
    turnosUn = onSnapshot(query(collection(db, "solicitacoes"), where("promotorUid", "==", usuario.uid)), (snap) => {
        turnos = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => `${a.data}${a.entrada}`.localeCompare(`${b.data}${b.entrada}`));
        if (!prim.t) turnos.forEach((t) => { const a = statusAnt.get(t.id); if (a === "aceita" && estaPago(t)) { notificar("Pagamento recebido 💸", `${t.loja} · ${brl(valorPromotor(t))} entram na sua carteira.`); carregarCarteira(); } if (a && a !== "cancelada" && t.status === "cancelada") notificar("Turno cancelado", `${t.loja} cancelou o pedido.`); if (a && estaPago({ status: a }) && t.status === "estornada") carregarCarteira(); });
        turnos.forEach((t) => statusAnt.set(t.id, t.status)); prim.t = false;
        renderTudo();
    }, (e) => { turnos = []; renderTudo(); if (e.code === "permission-denied") erro("Sem permissão para ler turnos."); });
}
const valorFiltro = (x) => valorPromotor(x) >= (pub.valorMin || 0);
/** Menores de 18: esconde o que o servidor recusaria (turno noturno e setores vedados). */
const podeVer = (x) => !priv.menor || (x.entrada >= MENOR_JANELA_INICIO && x.saida <= MENOR_JANELA_FIM && !MENOR_SETORES_VEDADOS.includes(x.foco));
const meu = (t) => valorPromotor(t);   // líquido do promotor: único valor exibido neste portal
function renderTudo() { renderProximos(); renderAgenda(); renderCarteira(); renderCalendario(); renderConversas(); if (diaSel) renderDia(); }

// ---------- ofertas ----------
function renderOfertas() {
    const el = $("lista-ofertas");
    if (!usuario) return;
    if (!habilitado()) {
        $("dot-ofertas").hidden = true;
        el.innerHTML = vazio("🔒", "Ofertas liberadas após os requisitos", `Falta: ${textoPendencias() || "concluir seu cadastro"}.`, !hab.treinamento?.completo ? '<button class="btn btn-primary mt" data-ir="tab-treino">Ir para o treinamento</button>' : "");
        return;
    }
    let l = ofertas.filter((x) => x.data >= hojeLocal() && valorFiltro(x) && podeVer(x) && (!filtroSetor || x.foco === filtroSetor));
    l.sort((a, b) => ordem === "valor" ? valorPromotor(b) - valorPromotor(a) : `${a.data}${a.entrada}`.localeCompare(`${b.data}${b.entrada}`));
    $("dot-ofertas").hidden = !l.length; $("dot-ofertas").textContent = l.length;
    el.innerHTML = (priv.menor ? `<div class="banner mb"><span class="ico">🌞</span><div class="small">Como você tem menos de 18 anos, aparecem só turnos diurnos (${MENOR_JANELA_INICIO}–${MENOR_JANELA_FIM}) em setores permitidos.</div></div>` : "") + (l.length ? l.map((x) => {
        const paraMim = x.promotorPreferido && x.promotorPreferido === usuario.uid;
        return `<article class="card pedido oferta"><div class="topo"><div class="grow"><h4>${esc(x.loja)}</h4><div class="meta">${fmtData(x.data)} · ${esc(x.entrada)}–${esc(x.saida)} · ${esc(x.foco)}</div></div>${paraMim ? '<span class="badge green">Pedido para você</span>' : ""}</div>
            <div class="ganho"><span>Você recebe<br><small class="muted">diária${x.minutos ? ` · ${String(Math.round(x.minutos / 6) / 10).replace(".", ",")} h` : ""}</small></span><strong>${brl(valorPromotor(x))}</strong></div>
            <div class="acoes"><button class="btn btn-primary btn-sm" data-aceitar="${esc(x.id)}">Aceitar turno</button></div></article>`;
    }).join("") : vazio("🛒", "Sem ofertas por enquanto", pub.valorMin ? `Nenhuma proposta de ${brl(pub.valorMin)} ou mais agora. Ajuste o mínimo em Menu → Preferências.` : "Novas demandas da região aparecem aqui na hora."));
}
$("filtro-setor").addEventListener("click", (e) => { const b = e.target.closest(".pill"); if (!b) return; filtroSetor = b.dataset.s; document.querySelectorAll("#filtro-setor .pill").forEach((x) => x.classList.toggle("sel", x === b)); renderOfertas(); });
$("btn-ordenar").addEventListener("click", () => { ordem = ordem === "valor" ? "data" : "valor"; $("btn-ordenar").textContent = ordem === "valor" ? "Maior valor ↓" : "Mais cedo ↑"; renderOfertas(); });

async function aceitar(id, b) {
    b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
    try { await chamarFuncao("aceitarTurno", { solicitacaoId: id }); ok("Turno aceito! Ele já está na sua escala."); irPara("tab-agenda"); }
    catch (e) {
        console.error(e);
        const m = { "limite-semanal": e.message, "turno-indisponivel": e.message, "conflito-horario": e.message, exclusivo: e.message, "promotor-inativo": "Seu cadastro ainda não foi aprovado.", "treinamento-pendente": "Conclua o treinamento PRATICAMENTE para aceitar turnos.", "idade-nao-verificada": "Informe sua data de nascimento para continuar.", "responsavel-pendente": "Falta a autorização do responsável legal.", "menor-horario": e.message, "menor-setor": e.message }[e.code];
        erro(m || "Não foi possível aceitar o turno. Tente de novo.");
        if (["treinamento-pendente", "promotor-inativo", "idade-nao-verificada", "responsavel-pendente"].includes(e.code)) { await carregarHabilitacao(); pintarPerfil(); renderOfertas(); }
        b.disabled = false; b.textContent = "Aceitar turno";
    }
}

// ---------- turnos / agenda ----------
function cartaoTurno(t) {
    const st = t.status, pago = estaPago(t), cancel = st === "cancelada";
    const acoes = [];
    if (st === "aceita") acoes.push(`<button class="btn btn-primary btn-sm" data-qr="${t.id}">💳 Cobrar (QR)</button>`, `<button class="btn btn-danger btn-sm" data-desistir="${t.id}">Desistir</button>`);
    if (!cancel && t.data === hojeLocal() && (st === "aceita" || pago)) { if (!t.checkinEm) acoes.push(`<button class="btn btn-green btn-sm" data-checkin="${t.id}">📍 Check-in</button>`); else if (!t.checkoutEm) acoes.push(`<button class="btn btn-green btn-sm" data-checkout="${t.id}">🏁 Check-out</button>`); }
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
    const link = `${baseSite()}pagar.html?id=${encodeURIComponent(t.id)}`; qrAtual = { link, t };
    $("qr-box").innerHTML = ""; if (window.QRCode) new QRCode($("qr-box"), { text: link, width: 200, height: 200 }); else $("qr-box").textContent = "QR indisponível — use o link.";
    $("qr-total").textContent = `Serviço em ${t.loja}`; $("qr-liquido").textContent = `Você recebe ${brl(valorPromotor(t))}`;
    abrir("sheet-qr");
}
$("qr-copiar").addEventListener("click", () => { navigator.clipboard?.writeText(qrAtual.link); ok("Link de pagamento copiado!"); });
$("qr-zap").addEventListener("click", () => window.open("https://api.whatsapp.com/send?text=" + encodeURIComponent(`Serviço de reposição concluído em ${qrAtual.t.loja}. Pague aqui: ${qrAtual.link}`), "_blank", "noopener"));

// ---------- carteira digital ----------
async function carregarCarteira() { try { carteiraDados = await consultar("carteira"); } catch (e) { console.warn(e); carteiraDados = null; } renderCarteira(); }
function renderCarteira() {
    const d = carteiraDados || { pendenteCentavos: 0, disponivelCentavos: 0, extrato: [], saques: [], liberacaoDias: 2 };
    const pagos = turnos.filter(estaPago), aceitos = turnos.filter((t) => t.status === "aceita");
    $("c-disponivel").textContent = brl(d.disponivelCentavos); $("c-pendente").textContent = brl(d.pendenteCentavos);
    $("c-receber").textContent = $("i-receber").textContent = brl(aceitos.reduce((a, t) => a + meu(t), 0));
    $("i-recebido").textContent = brl(pagos.reduce((a, t) => a + meu(t), 0));
    $("c-carencia").textContent = `Cada pagamento fica ${d.liberacaoDias} dia(s) em carência antes de ficar disponível para saque.`;
    $("btn-sacar").disabled = d.disponivelCentavos < (d.saqueMinimoCentavos || 1);
    const ico = { credito_diaria: "💸", liberacao: "🔓", saque: "🏦", saque_devolvido: "↩️", estorno: "⚠️" };
    $("c-extrato").innerHTML = d.extrato.length ? d.extrato.map((l) => { const net = l.dPendente + l.dDisponivel, v = net || Math.abs(l.dDisponivel);
        return `<div class="item"><div class="ico">${ico[l.tipo] || "•"}</div><div class="grow"><strong>${esc(l.rotulo)}</strong><div class="muted small">${esc(l.descricao || "")} · ${fmtDataHora(l.em)}</div></div><div class="val" style="color:${net > 0 ? "var(--green)" : net < 0 ? "var(--red)" : "var(--muted)"}">${net > 0 ? "+ " : net < 0 ? "− " : "↔ "}${brl(Math.abs(v))}</div></div>`; }).join("") : '<p class="muted small center">Seus ganhos aparecem aqui depois do primeiro pagamento.</p>';
    const rot = { solicitado: "Em análise", pago: "Pago", rejeitado: "Devolvido" };
    $("c-saques").innerHTML = d.saques.length ? d.saques.map((s) => `<div class="item"><div class="ico">🏦</div><div class="grow"><strong>Saque ${esc(rot[s.status] || s.status)}</strong><div class="muted small">${fmtDataHora(s.em)}</div></div><div class="val">${brl(s.valorCentavos)}</div></div>`).join("") : '<p class="muted small center">Nenhum saque ainda.</p>';
}
$("btn-csv").addEventListener("click", async () => { try { await baixarCSVProtegido("carteira/exportar.csv", "abastece-ja-carteira.csv"); } catch (e) { erro(e.code === "limite-requisicoes" ? "Aguarde um instante e tente de novo." : "Não foi possível exportar agora."); } });

/** Ações sensíveis exigem login recente: se o servidor pedir, confirma com o Google e repete uma vez. */
async function comReautenticacao(fn) {
    try { return await fn(); }
    catch (e) {
        if (e.code !== "reautenticar") throw e;
        try { await reauthenticateWithPopup(auth.currentUser, googleProvider); } catch (e2) { throw Object.assign(new Error("Não foi possível confirmar sua identidade."), { code: "reauth-falhou" }); }
        await renovarToken(); return fn();
    }
}
$("btn-sacar").addEventListener("click", () => {
    const d = carteiraDados; if (!d) return;
    if (!priv.pix) { toast("Cadastre sua chave Pix primeiro."); return abrir("sheet-pix"); }
    $("sq-info").textContent = `Disponível: ${brl(d.disponivelCentavos)} · mínimo ${brl(d.saqueMinimoCentavos)} · Pix: ${priv.pix.tipo} ${priv.pix.chaveMascarada}`;
    $("sq-valor").value = ""; $("e-sq-valor").textContent = ""; abrir("sheet-saque");
});
$("sq-tudo").addEventListener("click", () => { $("sq-valor").value = ((carteiraDados?.disponivelCentavos || 0) / 100).toFixed(2).replace(".", ","); });
$("sq-confirmar").addEventListener("click", async () => {
    const v = reaisParaCentavos($("sq-valor").value); $("e-sq-valor").textContent = "";
    if (!(v > 0)) return ($("e-sq-valor").textContent = "Informe o valor.");
    const b = $("sq-confirmar"); b.disabled = true;
    try { await comReautenticacao(() => chamarFuncao("carteira/saque", { valorCentavos: v })); ok("Saque solicitado! Você receberá por Pix após a análise."); fechar("sheet-saque"); await carregarCarteira(); }
    catch (e) { $("e-sq-valor").textContent = e.message || "Não foi possível solicitar o saque."; }
    finally { b.disabled = false; }
});

// ---------- treinamento PRATICAMENTE ----------
async function carregarTreino() {
    const tinhaCompleto = !!hab.treinamento?.completo;
    try { treino = await consultar("treinamento"); if (treino.atualizarToken) await renovarToken(); } catch (e) { console.warn(e); treino = null; }
    await carregarHabilitacao(); renderTreino(); pintarPerfil();
    if (!tinhaCompleto && hab.treinamento?.completo) escutar(); else renderOfertas();   // passa a ler as ofertas assim que o claim "treinado" chega
}
function renderTreino() {
    const t = treino; if (!t) { $("lista-treino").innerHTML = vazio("🎓", "Treinamento indisponível", "Tente novamente em instantes."); return; }
    $("tr-pct").textContent = `${t.concluidos}/${t.total}`; $("tr-bar").style.width = (t.total ? (t.concluidos / t.total) * 100 : 0) + "%";
    $("tr-aviso").textContent = t.completo ? "Treinamento concluído ✓ Você já pode aceitar turnos assim que seu cadastro for aprovado." : t.total ? "Assista cada vídeo do começo ao fim, na ordem. O avanço só conta quando o vídeo está tocando." : "O treinamento ainda não foi publicado pela equipe. Assim que estiver disponível, ele aparece aqui.";
    $("lista-treino").innerHTML = t.modulos.length ? t.modulos.map((m) => {
        const pct = m.concluido ? 100 : Math.min(99, Math.round((m.validoSeg / m.limiarSeg) * 100)), rot = m.concluido ? ["Concluído ✓", "green"] : m.bloqueado ? ["Bloqueado 🔒", ""] : m.validoSeg ? ["Em andamento", "blue"] : ["Não iniciado", ""];
        return `<article class="card pedido"><div class="topo"><div class="grow"><h4>${m.ordem}. ${esc(m.titulo)}</h4><div class="meta">${esc(m.descricao || "")} · ${Math.round(m.duracaoSeg / 60)} min</div></div><span class="badge ${rot[1]}">${rot[0]}</span></div>
            <div class="progress mt"><i style="width:${pct}%"></i></div>
            <div class="acoes">${m.bloqueado ? '<span class="muted small">Conclua o módulo anterior.</span>' : `<button class="btn ${m.concluido ? "btn-ghost" : "btn-primary"} btn-sm" data-video="${esc(m.id)}">${m.concluido ? "Rever" : m.validoSeg ? "Continuar" : "Assistir"}</button>`}</div></article>`;
    }).join("") : vazio("🎓", "Nenhum vídeo publicado", "A equipe ainda vai publicar os vídeos do PRATICAMENTE.");
}

let leitor = null, pingTimer = null, moduloAtual = null, ytPronto = null;
const carregarYT = () => (ytPronto ||= new Promise((res) => { if (window.YT?.Player) return res(); const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; window.onYouTubeIframeAPIReady = res; document.head.appendChild(s); }));
async function montarPlayer(m) {
    const box = $("vd-player"); box.innerHTML = ""; leitor = null;
    if (m.provedor === "mp4") {
        const v = document.createElement("video"); v.src = m.videoRef; v.controls = true; v.playsInline = true; v.setAttribute("controlsList", "nodownload noplaybackrate"); v.style.cssText = "width:100%;height:100%";
        v.addEventListener("loadedmetadata", () => { v.currentTime = m.validoSeg || 0; }); v.addEventListener("ratechange", () => { if (v.playbackRate !== 1) v.playbackRate = 1; });   // sem acelerar
        box.appendChild(v); leitor = { pos: () => v.currentTime, tocando: () => !v.paused && !v.ended, ir: (s) => { v.currentTime = s; }, parar: () => { v.pause(); v.removeAttribute("src"); v.load(); } };
        return;
    }
    await carregarYT(); const alvo = document.createElement("div"); box.appendChild(alvo);
    const p = new window.YT.Player(alvo, { videoId: m.videoRef, width: "100%", height: "100%", playerVars: { rel: 0, modestbranding: 1, playsinline: 1, origin: location.origin, start: Math.floor(m.validoSeg || 0) }, events: { onPlaybackRateChange: () => { if (p.getPlaybackRate() !== 1) p.setPlaybackRate(1); } } });
    leitor = { pos: () => p.getCurrentTime?.() || 0, tocando: () => p.getPlayerState?.() === 1, ir: (s) => p.seekTo(s, true), parar: () => p.destroy?.() };
}
function pararPings() { clearInterval(pingTimer); pingTimer = null; try { leitor?.parar?.(); } catch (e) {} leitor = null; moduloAtual = null; }
async function abrirVideo(id) {
    const m = treino?.modulos.find((x) => x.id === id); if (!m || m.bloqueado || !m.videoRef) return;
    pararPings(); moduloAtual = m; $("vd-titulo").textContent = m.titulo; $("vd-bar").style.width = Math.min(100, (m.validoSeg / m.limiarSeg) * 100) + "%"; abrir("sheet-video");
    await montarPlayer(m); pingTimer = setInterval(enviarPing, 10_000);
}
async function enviarPing() {
    if (!leitor || !moduloAtual) return;
    const m = moduloAtual, pos = Math.floor(leitor.pos()), tocando = leitor.tocando();
    try {
        const r = await chamarFuncao("treinamento/ping", { moduloId: m.id, posicaoSeg: pos, tocando });
        if (moduloAtual !== m) return;
        $("vd-bar").style.width = Math.min(100, (r.validoSeg / r.limiarSeg) * 100) + "%";
        if (!r.concluido && pos > r.validoSeg + 3) leitor.ir(r.validoSeg);              // não deixa pular: volta ao ponto já validado
        if (r.concluido) { fechar("sheet-video"); pararPings(); ok(r.treinamentoCompleto ? "Treinamento PRATICAMENTE concluído! 🎓" : "Módulo concluído ✓"); await carregarTreino(); }
    } catch (e) { if (e.code !== "ping-rapido") console.warn(e); }
}
$("vd-fechar").addEventListener("click", () => { pararPings(); carregarTreino(); });

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
/** Só campos públicos (bio, cidade, preferências) vão direto ao Firestore; as regras impedem qualquer outro campo. */
async function salvarPublico(dados, msg, sheet) {
    try { await setDoc(doc(db, "profissionais", usuario.uid), dados, { merge: true }); Object.assign(pub, dados); ok(msg); if (sheet) fechar(sheet); return true; }
    catch (e) { console.error(e); erro("Não foi possível salvar."); return false; }
}
$("btn-salvar-perfil").addEventListener("click", async () => {
    const tel = soDigitos($("d-tel").value), nome = $("d-nome").value.trim(); $("e-cpf").textContent = "";
    if (nome.length < 3) return erro("Informe seu nome completo.");
    if (tel && (tel.length < 10 || tel.length > 11)) return erro("Telefone inválido.");
    const dados = { cidade: $("d-cidade").value.trim(), bio: $("d-bio").value.trim(), ...(pub.status === "pendente" && nome !== pub.nome ? { nome } : {}) };
    if (!(await salvarPublico(dados, "Dados salvos ✓"))) return;
    if (tel && tel !== soDigitos(priv.telefone || "")) { try { await chamarFuncao("perfil/promotor/privado", { telefone: tel }, "PUT"); await carregarPrivado(); } catch (e) { return erro(e.message || "Não foi possível salvar o telefone."); } }
    fechar("sheet-perfil"); pintarPerfil();
});
$("btn-salvar-pix").addEventListener("click", async () => {
    const chave = $("x-chave").value.trim(), tipo = $("x-tipo").value; if (!chave) return erro("Informe a chave Pix.");
    const b = $("btn-salvar-pix"); b.disabled = true;
    try { await comReautenticacao(() => chamarFuncao("perfil/promotor/pix", { tipo, chave }, "PUT")); ok("Chave Pix salva ✓ (saques ficam bloqueados por 24 h por segurança)"); $("x-chave").value = ""; fechar("sheet-pix"); await carregarPrivado(); pintarPerfil(); }
    catch (e) { erro(e.message || "Não foi possível salvar a chave Pix."); }
    finally { b.disabled = false; }
});
$("btn-salvar-prefs").addEventListener("click", async () => {
    const min = reaisParaCentavos($("pf-min").value), esp = SETORES.find((s) => s.v === $("pf-esp").value);
    if (await salvarPublico({ valorMin: Math.max(0, Math.min(100000, min)), especialidade: esp?.label || "", disponibilidade: { inicio: $("pf-ini").value, fim: $("pf-fim").value } }, "Preferências salvas ✓", "sheet-prefs")) renderOfertas();
});
$("btn-copiar").addEventListener("click", () => { navigator.clipboard?.writeText($("link-indicar").value); ok("Link copiado!"); });
$("btn-zap").addEventListener("click", () => window.open("https://api.whatsapp.com/send?text=" + encodeURIComponent("Quer pegar turnos de reposição e receber por Pix? Cadastre-se no Abastece Já: " + $("link-indicar").value), "_blank", "noopener"));
$("btn-ativar-notif").addEventListener("click", async () => (await pedirPermissaoNotificacao()) ? ok("Avisos ativados neste aparelho.") : toast("Permissão não concedida. Libere nas configurações do navegador."));
$("btn-teste-reset").addEventListener("click", async () => {
    if (!confirm("Apagar os pedidos, notas e o cartão das contas de teste?")) return;
    try { const r = await chamarFuncao("teste/resetar"); ok(`Dados de teste zerados (${r.pedidosRemovidos} pedido(s)).`); } catch (e) { erro("Não foi possível zerar os dados de teste."); }
});
$("theme-toggle").addEventListener("change", alternarTema);
$("btn-instalar").addEventListener("click", instalarApp);

// ---------- check-in / check-out (horário gravado pelo servidor; localização é opcional) ----------
async function ponto(id, tipo) {
    const t = turnos.find((x) => x.id === id); if (!t) return;
    if (tipo === "checkout" && !confirm(`Encerrar o turno em ${t.loja}?`)) return;
    const pos = await new Promise((r) => { if (!navigator.geolocation) return r(null); navigator.geolocation.getCurrentPosition((p) => r({ lat: p.coords.latitude, lng: p.coords.longitude, prec: Math.round(p.coords.accuracy) }), () => r(null), { enableHighAccuracy: true, timeout: 8000 }); });
    try {
        const r = await chamarFuncao(`turnos/${encodeURIComponent(id)}/${tipo}`, pos || {});
        ok(tipo === "checkin" ? (r.atrasoMin > 15 ? `Check-in registrado (${r.atrasoMin} min de atraso).` : "Check-in registrado ✓") : "Check-out registrado ✓");
    } catch (e) { erro(e.message || "Não foi possível registrar agora."); }
}

// ---------- cliques globais (delegação) ----------
document.addEventListener("click", async (e) => {
    const g = (a) => e.target.closest(`[${a}]`);
    let el;
    if ((el = g("data-aceitar"))) aceitar(el.dataset.aceitar, el);
    else if ((el = g("data-qr"))) { const t = turnos.find((x) => x.id === el.dataset.qr); if (t) abrirQR(t); }
    else if ((el = g("data-chat"))) { const t = turnos.find((x) => x.id === el.dataset.chat); if (t) abrirChat(t); }
    else if ((el = g("data-checkin"))) ponto(el.dataset.checkin, "checkin");
    else if ((el = g("data-checkout"))) ponto(el.dataset.checkout, "checkout");
    else if ((el = g("data-desistir"))) {
        const t = turnos.find((x) => x.id === el.dataset.desistir); if (!t || !confirm(`Desistir do turno em ${t.loja}? Ele volta para a fila de ofertas.`)) return;
        try { await chamarFuncao("desistirTurno", { solicitacaoId: t.id }); ok("Você saiu do turno. Ele voltou para a fila."); } catch (err) { erro("Não foi possível desistir agora."); }
    }
    if ((el = g("data-video"))) abrirVideo(el.dataset.video);
    if ((el = g("data-ir"))) { e.preventDefault(); irPara(el.dataset.ir); if (el.dataset.ir === "tab-treino") carregarTreino(); }
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
