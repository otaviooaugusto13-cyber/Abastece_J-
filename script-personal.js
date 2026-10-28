// ============================================================
// ABASTECE JÁ — portal do PROMOTOR / FREELANCER (a partir dos 16 anos)
// Dados sensíveis, dinheiro, treinamento e status só trafegam pela API do servidor; o Firestore é lido, quase nunca escrito.
// ============================================================
import { collection, addDoc, doc, setDoc, getDoc, query, where, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, reauthenticateWithPopup } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, db, googleProvider, chamarFuncao, consultar, baixarCSVProtegido, renovarToken, testeAtivo, loginDeTeste, contaDeTeste } from "./firebase.js";
import { resolverAcesso, telaOutroPerfil, telaFalhaTemporaria } from "./acesso.js";
import { pintarRecado } from "./recado.js";
import { RAIO_KM_OFERTAS, LOCAL_MOVIMENTO_MIN_KM, ENEAGRAMA_TESTE_URL, ENEAGRAMA_TESTE_ORIGEM, WHATSAPP_SUPORTE, REPASSE_PROFISSIONAL_CENTAVOS, HORAS_MIN_TURNO, HORAS_MAX_TURNO, MAX_VEZES_SEMANA_LOJA, IDADE_MINIMA, MENOR_JANELA_INICIO, MENOR_JANELA_FIM, MENOR_SETORES_VEDADOS } from "./config.js";
import { brl, reaisParaCentavos, esc, fmtData, fmtDataHora, hojeLocal, mascaraCPF, mascaraTelefone, cpfValido, soDigitos, estaPago, valorPromotor, validarNascimento, limitesNascimento, SETORES, textoTermos } from "./core.js";
import { CIDADES, RAIO_KM, acharCidade, rotuloCidade, distanciaKm, cidadeMaisProxima, cidadeDaVaga, pontoDaVaga, contarPorCidade, filtrarPorRaio, fmtKm, rumoRad, observarPosicao } from "./geo.js";
import { AREAS, AREA, ENEAGRAMA, INSTINTOS, MAX_EXPERIENCIAS, asasDoTipo, codigoEneagrama, lerCodigoEneagrama, eneagramaValido, normalizarExperiencias, gerarPerfil, pontuarOferta, ranquearOfertas } from "./perfil-inteligente.js";
import { agruparCursos, statusCurso } from "./cursos.js";
import { $, toast, ok, erro, iniciarTema, alternarTema, ligarMascaras, abrir, fechar, skeleton, vazio, registrarSW, instalarApp, pedirPermissaoNotificacao, notificar } from "./ui.js";

let usuario = null, pub = {}, priv = {}, hab = { habilitado: false, pendencias: [], treinamento: { concluidos: 0, total: 0, completo: false } }, treino = null, carteiraDados = null;
let ofertas = [], turnos = [], filtroSetor = "", ordem = "match";
let perfilIA = { experiencias: [], eneagrama: null, palavrasChave: [], bioAuto: true };
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
const sair = async () => { offUn?.(); turnosUn?.(); chatUn?.(); pararPings(); pararDeAcompanhar(); pos = null; posFonte = ""; await signOut(auth); };
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
    if (pub.status === "bloqueado") { erro("Acesso não liberado para esta conta." + (pub.recado?.texto ? ` ${pub.recado.texto}` : "")); return sair(); }
    await Promise.all([carregarPrivado(), carregarHabilitacao()]);
    if (!priv.nascimento || !priv.temCpf || (priv.menor && !priv.autorizacaoResponsavel)) return abrirCadastro(true);   // conta antiga ou dados faltando
    tela("screen-dashboard");
    $("btn-teste-reset").hidden = !(await contaDeTeste());
    montarSetoresPrefs(); montarFormIA(); pintarPerfil(); escutar(); carregarCarteira(); carregarTreino(); carregarPerfilIA();
    if (abaOfertasAtiva()) iniciarGeo();
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
    pintarRecado($("sub-home").closest(".page-head"), pub.recado);
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

// ---------- ofertas: geolocalização em tempo real, contadores por cidade, raio de 20 km e ranking ----------
const CHAVE_CIDADE = "abastece_cidade_manual";
let pos = null, posFonte = "", geoEstado = "idle", geoErro = "", pararGeo = null, modo = "perto", filtroCidade = "", ofertasVistas = new Map();
const ORDENS = ["match", "perto", "valor", "data"], ROT_ORDEM = { match: "Melhor match ✨", perto: "Mais perto 📍", valor: "Maior valor ↓", data: "Mais cedo ↑" };
const cidadeManual = () => { try { return localStorage.getItem(CHAVE_CIDADE) || ""; } catch (e) { return ""; } };
const cidadeFallback = () => acharCidade(cidadeManual()) || acharCidade(pub.cidade);
const abaOfertasAtiva = () => $("tab-ofertas").classList.contains("active");

function definirPosicao(p, fonte) {
    const mudou = !pos || fonte !== posFonte || distanciaKm(pos, p) >= LOCAL_MOVIMENTO_MIN_KM;   // não redesenha a cada microvariação do GPS
    pos = p; posFonte = fonte;
    if (mudou) renderOfertas(); else desenharGeo();
}
/** Chamado ao abrir "Ofertas": pede a posição (o navegador mostra o aviso de permissão) e acompanha em tempo real. */
function iniciarGeo() {
    if (pararGeo || !habilitado()) return;
    if (!pos) geoEstado = "buscando"; desenharGeo();
    pararGeo = observarPosicao(
        (p) => { geoEstado = "gps"; geoErro = ""; definirPosicao(p, "gps"); },
        (e) => {
            if (e.code === "tempo" && pos) return;                      // falha momentânea com posição já conhecida: ignora
            pararGeo?.(); pararGeo = null; geoErro = e.message; geoEstado = e.code === "negado" ? "negado" : "indisponivel";
            const c = posFonte === "gps" ? null : cidadeFallback();
            if (c) definirPosicao({ lat: c.lat, lng: c.lng }, "cidade");
            else if (!pos) { modo = "cidades"; atualizarSeg(); renderOfertas(); }
            else desenharGeo();
        });
}
function pararDeAcompanhar() { pararGeo?.(); pararGeo = null; if (geoEstado === "buscando") geoEstado = "idle"; }
const reiniciarGeo = () => { pararDeAcompanhar(); geoEstado = "buscando"; if (posFonte === "cidade") { pos = null; posFonte = ""; } iniciarGeo(); };

function desenharGeo() {
    const el = $("geo-status"); if (!el) return;
    const perto = pos ? cidadeMaisProxima(pos, 25) : null, nomePerto = perto ? rotuloCidade(perto) : "";
    const seletor = `<select id="geo-cidade" aria-label="Escolher cidade manualmente"><option value="">Escolher outra cidade…</option>${CIDADES.map((c) => `<option value="${esc(rotuloCidade(c))}">${esc(rotuloCidade(c))}</option>`).join("")}</select>`;
    let h;
    if (geoEstado === "buscando" && !pos) h = `<div class="linha"><span class="geo-pulso warn"></span><div class="grow"><strong>Buscando sua localização…</strong><br><span class="muted">Permita o acesso quando o navegador perguntar.</span></div></div>`;
    else if (posFonte === "gps") h = `<div class="linha"><span class="geo-pulso"></span><div class="grow"><strong>Localização em tempo real</strong>${nomePerto ? ` · ${esc(nomePerto)}` : ""}<br><span class="muted">Mostrando vagas em até ${RAIO_KM} km de você.</span></div><button class="btn btn-ghost btn-sm" data-geo="atualizar">Atualizar</button></div>`;
    else if (posFonte === "cidade") h = `<div class="linha"><span class="geo-pulso warn"></span><div class="grow"><strong>Usando ${esc(nomePerto || "sua cidade")}</strong><br><span class="muted">${esc(geoErro || "Sem GPS.")} Ative o GPS para ver as vagas ao seu redor.</span></div><button class="btn btn-ghost btn-sm" data-geo="atualizar">Ativar GPS</button></div>${seletor}`;
    else h = `<div class="linha"><span class="geo-pulso off"></span><div class="grow"><strong>Localização desligada</strong><br><span class="muted">${esc(geoErro || "Ative para ver vagas perto de você.")}${geoEstado === "negado" ? " Libere em Configurações do navegador → Localização (cadeado ao lado do endereço)." : ""}</span></div><button class="btn btn-ghost btn-sm" data-geo="atualizar">Tentar de novo</button></div>${seletor}`;
    el.innerHTML = h;
}
function atualizarSeg() { document.querySelectorAll("#seg-modo button").forEach((b) => { const on = b.dataset.modo === modo; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); }); }

const ofertasBase = () => ofertas.filter((x) => x.data >= hojeLocal() && valorFiltro(x) && podeVer(x));
function desenharChips(base) {
    const c = contarPorCidade(base), todas = modo === "cidades" && !filtroCidade;
    $("chips-cidades").innerHTML = `<button class="pill city${todas ? " sel" : ""}" data-cidade="">Todas<b>${base.length}</b></button>` + c.map((x) => `<button class="pill city${modo === "cidades" && filtroCidade === x.cidade ? " sel" : ""}" data-cidade="${esc(x.cidade)}">${esc(x.cidade.replace(/ - [A-Z]{2}$/, ""))}<b>${x.vagas}</b><small>${x.vagas === 1 ? "vaga" : "vagas"}</small></button>`).join("");
}
function cartaoOferta(x, compacto = false) {
    const m = x.match, paraMim = x.promotorPreferido && x.promotorPreferido === usuario.uid, cid = cidadeDaVaga(x);
    const local = cid || x.distKm != null ? `<span class="dist-tag">📍 ${esc(cid)}${x.distKm != null && Number.isFinite(x.distKm) ? `${cid ? " · " : ""}${fmtKm(x.distKm)}` : ""}</span>` : "";
    const anel = m?.score != null ? `<div class="match ${m.nivel}" style="--p:${m.score}" title="Compatibilidade com você"><b>${m.score}%</b><span>match</span></div>` : "";
    if (compacto) return `<article class="card sug-card" data-det="${esc(x.id)}" role="button" tabindex="0"><div class="sug-top">${anel || "<span></span>"}<strong style="color:var(--green)">${brl(valorPromotor(x))}</strong></div><h4>${esc(x.loja)}</h4><div class="meta">${fmtData(x.data)} · ${esc(x.entrada)}–${esc(x.saida)} · ${esc(x.foco)}</div>${local}</article>`;
    return `<article class="card pedido oferta"><div class="topo"><div class="grow"><h4>${esc(x.loja)}</h4><div class="meta">${fmtData(x.data)} · ${esc(x.entrada)}–${esc(x.saida)} · ${esc(x.foco)}</div>${local}${paraMim ? ' <span class="badge green">Pedido para você</span>' : ""}</div>${anel}</div>
        ${m?.razoes?.length ? `<div class="razoes">${m.razoes.map((r) => `<span>${esc(r)}</span>`).join("")}</div>` : ""}
        <div class="ganho"><span>Você recebe<br><small class="muted">diária${x.minutos ? ` · ${String(Math.round(x.minutos / 6) / 10).replace(".", ",")} h` : ""}</small></span><strong>${brl(valorPromotor(x))}</strong></div>
        <div class="acoes"><button class="btn btn-ghost btn-sm" data-det="${esc(x.id)}">Detalhes</button><button class="btn btn-primary btn-sm" data-aceitar="${esc(x.id)}">Aceitar turno</button></div></article>`;
}
function renderOfertas() {
    const el = $("lista-ofertas");
    if (!usuario) return;
    if (!habilitado()) {
        $("dot-ofertas").hidden = true; $("sugestoes").hidden = true; $("chips-cidades").innerHTML = ""; $("geo-status").hidden = true; $("seg-modo").hidden = true;
        el.innerHTML = vazio("🔒", "Ofertas liberadas após os requisitos", `Falta: ${textoPendencias() || "concluir seu cadastro"}.`, !hab.treinamento?.completo ? '<button class="btn btn-primary mt" data-ir="tab-treino">Ir para o treinamento</button>' : "");
        return;
    }
    $("geo-status").hidden = false; $("seg-modo").hidden = false; atualizarSeg();
    const base = ofertasBase(); desenharChips(base); desenharGeo();
    let l = base.filter((x) => !filtroSetor || x.foco === filtroSetor);
    if (modo === "perto") l = pos ? filtrarPorRaio(l, pos) : [];
    else {
        if (filtroCidade) l = l.filter((x) => cidadeDaVaga(x) === filtroCidade);
        l = l.map((x) => { const d = pos ? distanciaKm(pos, pontoDaVaga(x)) : Infinity; return Number.isFinite(d) ? { ...x, distKm: d } : x; });
    }
    let rk = ranquearOfertas(l, { experiencias: perfilIA.experiencias, eneagrama: perfilIA.eneagrama, fmtKm });
    if (ordem === "perto") rk.sort((a, b) => (a.distKm ?? 1e9) - (b.distKm ?? 1e9));
    else if (ordem === "valor") rk.sort((a, b) => valorPromotor(b) - valorPromotor(a) || (b.match.score ?? -1) - (a.match.score ?? -1));
    else if (ordem === "data") rk.sort((a, b) => `${a.data}${a.entrada}`.localeCompare(`${b.data}${b.entrada}`));
    ofertasVistas = new Map(rk.map((o) => [o.id, o]));
    $("dot-ofertas").hidden = !rk.length; $("dot-ofertas").textContent = rk.length;
    // "Sugeridas para você": as melhores do ranking (só com pelo menos 2 sinais conhecidos, senão o score não diz nada)
    const top = ordem === "match" ? rk.filter((o) => o.match.nivel === "alto" && o.match.conhecidos >= 2).slice(0, 3) : [];
    $("sugestoes").hidden = !top.length || rk.length < 2;
    if (top.length) $("sugestoes").innerHTML = `<div class="section-title" style="margin-top:0">✨ Sugeridas para você</div><div class="sug-row">${top.map((o) => cartaoOferta(o, true)).join("")}</div>`;
    const semPerfil = !perfilIA.experiencias.length && !perfilIA.eneagrama;
    const aviso = (priv.menor ? `<div class="banner mb"><span class="ico">🌞</span><div class="small">Como você tem menos de 18 anos, aparecem só turnos diurnos (${MENOR_JANELA_INICIO}–${MENOR_JANELA_FIM}) em setores permitidos.</div></div>` : "")
        + (semPerfil ? `<div class="banner mb"><span class="ico">🧠</span><div class="grow small"><strong>Receba vagas com a sua cara.</strong><br>Informe sua experiência e seu Eneagrama para ver a compatibilidade de cada vaga.<br><button class="btn btn-ghost btn-sm mt" data-abrir="sheet-perfil">Completar perfil</button></div></div>` : "");
    let vz = "";
    if (!rk.length) {
        if (modo === "perto" && !pos) vz = vazio("📍", "Precisamos da sua localização", geoErro || "Ative a localização para ver as vagas em até 20 km.", '<button class="btn btn-primary mt" data-geo="atualizar">Ativar localização</button>');
        else if (modo === "perto") vz = vazio("📍", `Nenhuma vaga em ${RAIO_KM} km`, "Veja as vagas das outras cidades.", '<button class="btn btn-primary mt" data-modo="cidades">Ver por cidade</button>');
        else vz = vazio("🛒", "Sem ofertas por enquanto", pub.valorMin ? `Nenhuma proposta de ${brl(pub.valorMin)} ou mais agora. Ajuste o mínimo em Menu → Preferências.` : "Novas demandas da região aparecem aqui na hora.");
    }
    el.innerHTML = aviso + (rk.length ? rk.map((x) => cartaoOferta(x)).join("") : vz);
}
$("filtro-setor").addEventListener("click", (e) => { const b = e.target.closest(".pill"); if (!b) return; filtroSetor = b.dataset.s; document.querySelectorAll("#filtro-setor .pill").forEach((x) => x.classList.toggle("sel", x === b)); renderOfertas(); });
$("btn-ordenar").addEventListener("click", () => { ordem = ORDENS[(ORDENS.indexOf(ordem) + 1) % ORDENS.length]; $("btn-ordenar").textContent = ROT_ORDEM[ordem]; renderOfertas(); });
$("seg-modo").addEventListener("click", (e) => { const b = e.target.closest("[data-modo]"); if (!b) return; modo = b.dataset.modo; if (modo === "perto") filtroCidade = ""; renderOfertas(); });
$("chips-cidades").addEventListener("click", (e) => { const b = e.target.closest("[data-cidade]"); if (!b) return; modo = "cidades"; filtroCidade = b.dataset.cidade; renderOfertas(); });
$("geo-status").addEventListener("change", (e) => {
    if (e.target.id !== "geo-cidade" || !e.target.value) return;
    const c = acharCidade(e.target.value); if (!c) return;
    try { localStorage.setItem(CHAVE_CIDADE, rotuloCidade(c)); } catch (err) {}
    pararDeAcompanhar(); geoErro = "Cidade escolhida por você."; geoEstado = "idle"; modo = "perto"; definirPosicao({ lat: c.lat, lng: c.lng }, "cidade");
});
// economiza bateria: para de acompanhar quando o app vai para segundo plano e retoma ao voltar
document.addEventListener("visibilitychange", () => { if (document.hidden) pararDeAcompanhar(); else if (usuario && abaOfertasAtiva()) iniciarGeo(); });

// ---------- detalhe da vaga (modal interno — nada abre fora do app) ----------
function radarSVG(x) {
    const p = pos && pontoDaVaga(x); if (!p) return "";
    const d = distanciaKm(pos, p), r = Math.min(88, (d / RAIO_KM) * 88), a = rumoRad(pos, p), cx = 100 + r * Math.sin(a), cy = 100 - r * Math.cos(a), fora = d > RAIO_KM;
    return `<svg class="radar" viewBox="0 0 200 200" role="img" aria-label="Vaga a ${fmtKm(d)} de você"><circle cx="100" cy="100" r="88" fill="none" stroke="var(--line-strong)"/><circle cx="100" cy="100" r="44" fill="none" stroke="var(--line)" stroke-dasharray="3 4"/><line x1="100" y1="12" x2="100" y2="188" stroke="var(--line)"/><line x1="12" y1="100" x2="188" y2="100" stroke="var(--line)"/><text x="100" y="9" text-anchor="middle" font-size="9" fill="var(--muted)">N</text><text x="${100 + 88 - 2}" y="${100 - 4}" text-anchor="end" font-size="8" fill="var(--muted)">${RAIO_KM} km</text><circle cx="100" cy="100" r="5" fill="var(--blue)"/><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7" fill="${fora ? "var(--muted)" : "var(--green)"}" stroke="var(--bg)" stroke-width="2"/></svg>`;
}
function abrirDetalhe(id) {
    const x = ofertasVistas.get(id) || ofertas.find((o) => o.id === id); if (!x) return;
    const m = x.match || pontuarOferta(x, { distKm: pos ? distanciaKm(pos, pontoDaVaga(x)) : null, experiencias: perfilIA.experiencias, eneagrama: perfilIA.eneagrama, fmtKm });
    const d = x.distKm ?? (pos ? distanciaKm(pos, pontoDaVaga(x)) : Infinity), cid = cidadeDaVaga(x);
    const barra = (rot, v) => `<div class="bar3"><div class="row"><span>${rot}</span><span>${v === null ? "—" : Math.round(v * 100) + "%"}</span></div><div class="progress"><i style="width:${v === null ? 0 : Math.round(v * 100)}%"></i></div></div>`;
    $("of-titulo").textContent = x.loja;
    $("of-corpo").innerHTML = `<div class="row between"><div class="muted small">📍 ${esc(cid || "Localização não informada")}${Number.isFinite(d) ? ` · ${fmtKm(d)} de você` : ""}</div>${m.score != null ? `<span class="badge ${m.nivel === "alto" ? "green" : m.nivel === "medio" ? "" : "blue"}">${m.score}% de match</span>` : ""}</div>
        ${radarSVG(x)}
        <div class="of-info"><div><small>Data</small><strong>${fmtData(x.data)}</strong></div><div><small>Horário</small><strong>${esc(x.entrada)}–${esc(x.saida)}</strong></div><div><small>Setor</small><strong>${esc(x.foco)}</strong></div><div><small>Você recebe</small><strong style="color:var(--green)">${brl(valorPromotor(x))}</strong></div></div>
        <div class="card flat mb"><h4 class="highlight mb">Por que combina com você</h4>${barra("Proximidade", m.partes.dist)}${barra("Experiência", m.partes.exp)}${barra("Perfil (Eneagrama)", m.partes.enea)}
        ${m.razoes.length ? `<div class="razoes">${m.razoes.map((r) => `<span>${esc(r)}</span>`).join("")}</div>` : '<p class="muted small">Complete sua experiência e seu perfil para ver os motivos.</p>'}
        ${m.conhecidos < 3 ? '<button class="btn btn-ghost btn-sm mt" data-fechar="sheet-oferta" data-abrir="sheet-perfil">Completar perfil</button>' : ""}</div>
        <button class="btn btn-primary" data-aceitar="${esc(x.id)}">Aceitar turno</button>`;
    abrir("sheet-oferta");
}

async function aceitar(id, b) {
    b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
    try { await chamarFuncao("aceitarTurno", { solicitacaoId: id }); ok("Turno aceito! Ele já está na sua escala."); fechar("sheet-oferta"); irPara("tab-agenda"); }
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
    renderCursos();
    const obrig = t.modulos.filter((m) => m.obrigatorio !== false);
    $("lista-treino").innerHTML = obrig.length ? obrig.map((m) => {
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
        if (r.concluido) { fechar("sheet-video"); pararPings(); ok(r.obrigatorio !== false && r.treinamentoCompleto ? "Treinamento PRATICAMENTE concluído! 🎓" : r.obrigatorio === false ? "Curso concluído ✓" : "Módulo concluído ✓"); await carregarTreino(); }
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
    const dados = { cidade: $("d-cidade").value.trim(), ...(pub.status === "pendente" && nome !== pub.nome ? { nome } : {}) };
    if (!(await salvarPublico(dados, "Dados salvos ✓"))) return;
    if (!(await salvarIA())) return;               // experiência, Eneagrama, palavras-chave e bio (o servidor revalida)
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

// ---------- perfil inteligente: experiência + Eneagrama → palavras-chave e bio ----------
const CHAVE_ENEA = "abastece_eneagrama";
const ANOS_ROT = (n) => (n < 1 ? "menos de 1 ano" : n === 1 ? "1 ano" : n >= 12 ? "mais de 10 anos" : n >= 8 ? "6 a 10 anos" : `${n} anos`);
let formIA = { experiencias: [], eneagrama: null, bioAuto: true }, kwAtual = [];

async function carregarPerfilIA() {
    try { const r = await consultar("perfil/promotor/inteligente"); perfilIA = { experiencias: normalizarExperiencias(r.experiencias), eneagrama: eneagramaValido(r.eneagrama) ? r.eneagrama : null, palavrasChave: r.palavrasChave || [], bioAuto: r.bioAuto !== false }; }
    catch (e) { console.warn(e); }
    pintarFormIA(); renderOfertas();
    // resultado do teste recebido por link (?eneagrama=PM-3w2-SO) e ainda não salvo no perfil
    let salvo = null; try { salvo = lerCodigoEneagrama(localStorage.getItem(CHAVE_ENEA) || ""); } catch (e) {}
    if (salvo && eneagramaValido(salvo) && !perfilIA.eneagrama) aplicarEneagrama(salvo, true);
}
function montarFormIA() {
    $("exp-area").innerHTML = AREAS.map((a) => `<option value="${esc(a.v)}">${a.ico} ${esc(a.v)}</option>`).join("");
    $("en-tipo").innerHTML = `<option value="">—</option>` + Object.entries(ENEAGRAMA).map(([t, d]) => `<option value="${t}">${t} · ${esc(d.nome.replace(/^O /, ""))}</option>`).join("");
    $("btn-teste-enea").hidden = !ENEAGRAMA_TESTE_URL;
}
function desenharExp() {
    $("exp-lista").innerHTML = formIA.experiencias.map((e) => `<div class="exp-item"><span>${AREA[e.area].ico}</span><div class="grow"><strong>${esc(e.area)}</strong><small>${ANOS_ROT(e.anos)}</small></div><button type="button" data-exp-rm="${esc(e.area)}" aria-label="Remover ${esc(e.area)}">✕</button></div>`).join("");
}
function desenharEnea() {
    const e = formIA.eneagrama;
    $("en-tipo").value = e ? String(e.tipo) : "";
    $("en-asa").innerHTML = `<option value="">—</option>` + (e ? asasDoTipo(e.tipo).map((a) => `<option value="${a}">${a}</option>`).join("") : "");
    $("en-asa").value = e?.asa ? String(e.asa) : ""; $("en-asa").disabled = !e;
    $("en-inst").value = e?.instinto || ""; $("en-inst").disabled = !e;
    const r = $("en-resumo"); r.hidden = !e;
    if (e) { const d = ENEAGRAMA[e.tipo]; r.innerHTML = `<strong>Tipo ${e.tipo} — ${esc(d.nome)}</strong>${e.asa ? ` · asa ${e.asa}` : ""}${e.instinto ? ` · ${INSTINTOS[e.instinto]}` : ""}<br><span class="muted">Pontos fortes no trabalho: ${esc(d.tracos.join(", "))}.</span><br><span class="muted small">Código: ${esc(codigoEneagrama(e))}</span>`; }
}
function pintarKw(l) { kwAtual = l; $("kw-chips").innerHTML = l.map((k) => `<span>${esc(k)}</span>`).join(""); }
const contarBio = () => { $("bio-cont").textContent = `(${$("d-bio").value.length}/300)`; };
function regenerar({ forcarBio = false } = {}) {
    const g = gerarPerfil(formIA); pintarKw(g.palavrasChave);
    if (formIA.bioAuto || forcarBio) { $("d-bio").value = g.bio; contarBio(); }
}
function pintarFormIA() {
    if ($("sheet-perfil").classList.contains("active")) return;      // não sobrescreve o que a pessoa está editando
    formIA = { experiencias: [...perfilIA.experiencias], eneagrama: perfilIA.eneagrama, bioAuto: perfilIA.bioAuto };
    $("bio-auto").checked = formIA.bioAuto; desenharExp(); desenharEnea();
    if (perfilIA.palavrasChave.length) pintarKw(perfilIA.palavrasChave); else regenerar();
    if (!$("d-bio").value && (formIA.experiencias.length || formIA.eneagrama)) regenerar({ forcarBio: true });
    contarBio();
}
function aplicarEneagrama(en, salvarAgora = false) {
    formIA.eneagrama = en; perfilIA.eneagrama = salvarAgora ? en : perfilIA.eneagrama; desenharEnea(); regenerar();
    try { localStorage.setItem(CHAVE_ENEA, codigoEneagrama(en)); } catch (e) {}
    if (salvarAgora) salvarIA({ silencioso: true }).then((okk) => okk && toast("Resultado do teste aplicado ao seu perfil ✓"));
}
/** Envia ao servidor (que revalida e atualiza o perfil público: bio, palavras-chave e áreas). */
async function salvarIA({ silencioso = false } = {}) {
    const corpo = { experiencias: formIA.experiencias, eneagrama: formIA.eneagrama ? { tipo: formIA.eneagrama.tipo, asa: formIA.eneagrama.asa || 0, instinto: formIA.eneagrama.instinto || "" } : null, palavrasChave: kwAtual, bio: $("d-bio").value.trim(), bioAuto: formIA.bioAuto };
    try {
        const r = await chamarFuncao("perfil/promotor/inteligente", corpo, "PUT");
        perfilIA = { experiencias: r.experiencias, eneagrama: r.eneagrama, palavrasChave: r.palavrasChave, bioAuto: r.bioAuto }; Object.assign(pub, { bio: r.bio, palavrasChave: r.palavrasChave });
        renderOfertas(); return true;
    } catch (e) { console.error(e); if (!silencioso) erro(e.message || "Não foi possível salvar seu perfil."); return false; }
}
$("exp-add").addEventListener("click", () => {
    const area = $("exp-area").value, anos = Number($("exp-anos").value);
    if (formIA.experiencias.length >= MAX_EXPERIENCIAS) return erro(`Máximo de ${MAX_EXPERIENCIAS} experiências.`);
    if (formIA.experiencias.some((e) => e.area === area)) return toast("Essa área já está na lista. Remova para trocar o tempo.");
    formIA.experiencias = normalizarExperiencias([...formIA.experiencias, { area, anos }]); desenharExp(); regenerar();
});
$("exp-lista").addEventListener("click", (e) => { const b = e.target.closest("[data-exp-rm]"); if (!b) return; formIA.experiencias = formIA.experiencias.filter((x) => x.area !== b.dataset.expRm); desenharExp(); regenerar(); });
const lerEneaForm = () => {
    const t = Number($("en-tipo").value); if (!t) return null;
    const asa = Number($("en-asa").value) || 0;
    return { tipo: t, asa: asasDoTipo(t).includes(asa) ? asa : 0, instinto: $("en-inst").value };
};
$("en-tipo").addEventListener("change", () => { const t = Number($("en-tipo").value); formIA.eneagrama = t ? { tipo: t, asa: 0, instinto: $("en-inst").value } : null; desenharEnea(); regenerar(); });
$("en-asa").addEventListener("change", () => { formIA.eneagrama = lerEneaForm(); desenharEnea(); regenerar(); });
$("en-inst").addEventListener("change", () => { formIA.eneagrama = lerEneaForm(); desenharEnea(); regenerar(); });
$("en-aplicar").addEventListener("click", () => {
    const en = lerCodigoEneagrama($("en-codigo").value); $("e-en-codigo").textContent = "";
    if (!en || !eneagramaValido(en)) return ($("e-en-codigo").textContent = "Código inválido. Exemplo: PM-3w2-SO");
    $("en-codigo").value = ""; aplicarEneagrama(en);
});
$("bio-auto").addEventListener("change", (e) => { formIA.bioAuto = e.target.checked; if (formIA.bioAuto) regenerar({ forcarBio: true }); });
$("d-bio").addEventListener("input", () => { if (formIA.bioAuto) { formIA.bioAuto = false; $("bio-auto").checked = false; } contarBio(); });   // editou à mão: para de sobrescrever
$("btn-regerar").addEventListener("click", () => { formIA.bioAuto = true; $("bio-auto").checked = true; regenerar({ forcarBio: true }); });
// teste do Eneagrama dentro do app (iframe) — o teste avisa o resultado por postMessage
$("btn-teste-enea").addEventListener("click", () => { $("enea-frame").src = ENEAGRAMA_TESTE_URL; abrir("sheet-teste-enea"); });
$("enea-fechar").addEventListener("click", () => { $("enea-frame").src = "about:blank"; });
window.addEventListener("message", (ev) => {
    if (!ENEAGRAMA_TESTE_ORIGEM || ev.origin !== ENEAGRAMA_TESTE_ORIGEM) return;         // só a origem configurada
    const d = ev.data; if (!d || d.evento !== "eneagrama") return;
    const en = { tipo: Number(d.tipo), asa: Number(d.asa) || 0, instinto: String(d.instinto || "") };
    if (!eneagramaValido(en)) return;
    fechar("sheet-teste-enea"); $("enea-frame").src = "about:blank"; aplicarEneagrama(en, true);
});
try { const q = new URLSearchParams(location.search).get("eneagrama"); const en = q && lerCodigoEneagrama(q); if (en && eneagramaValido(en)) localStorage.setItem(CHAVE_ENEA, codigoEneagrama(en)); } catch (e) {}

// ---------- cursos por categoria (modal interno) ----------
function renderCursos() {
    const t = treino, box = $("cursos-lista");
    if (!t) { $("cursos-resumo").innerHTML = ""; box.innerHTML = vazio("📚", "Cursos indisponíveis", "Tente novamente em instantes."); return; }
    const abertos = new Set([...box.querySelectorAll("details[open]")].map((d) => d.dataset.cat)), primeira = !box.children.length;
    const grupos = agruparCursos(t.modulos), opc = t.opcionais || { concluidos: 0, total: 0 };
    $("cursos-resumo").innerHTML = `<div class="linha"><span style="font-size:24px">📚</span><div class="grow"><strong>${t.concluidos}/${t.total} da habilitação</strong>${opc.total ? ` · ${opc.concluidos}/${opc.total} opcionais` : ""}<br><span class="muted">${t.completo ? "Habilitação concluída ✓" : "Conclua a habilitação para liberar os turnos."}</span></div></div>`;
    $("menu-cursos-badge").hidden = !t.modulos.length; $("menu-cursos-badge").textContent = t.modulos.length;
    box.innerHTML = grupos.length ? grupos.map((g, i) => `<details class="cat" data-cat="${g.id}" ${(primeira ? i === 0 : abertos.has(g.id)) ? "open" : ""}><summary><span class="ico">${g.ico}</span><div class="grow"><h4>${esc(g.titulo)}</h4><p>${esc(g.desc)}</p></div><span class="badge ${g.concluidos === g.total ? "green" : "gray"}">${g.concluidos}/${g.total}</span><span class="seta">›</span></summary>
        <div class="cat-corpo">${g.itens.map((m) => {
            const st = statusCurso(m), pct = m.concluido ? 100 : Math.min(99, Math.round((m.validoSeg / m.limiarSeg) * 100));
            return `<div class="curso"><div class="topo"><div class="grow"><h5>${m.obrigatorio ? m.ordem + ". " : ""}${esc(m.titulo)}</h5><div class="meta">${esc(m.descricao || "")}${m.descricao ? " · " : ""}${Math.round(m.duracaoSeg / 60)} min</div></div><span class="badge ${st.cor}">${st.t}</span></div><div class="progress"><i style="width:${pct}%"></i></div>${m.bloqueado ? '<span class="muted small">Conclua o módulo anterior da habilitação.</span>' : `<button class="btn ${m.concluido ? "btn-ghost" : "btn-primary"} btn-sm" data-video="${esc(m.id)}">${m.concluido ? "Rever" : m.validoSeg ? "Continuar" : "Assistir"}</button>`}</div>`;
        }).join("")}</div></details>`).join("") : vazio("📚", "Nenhum curso publicado", "A equipe ainda vai publicar os cursos. Volte em breve.");
}

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
    if ((el = g("data-det")) && !e.target.closest("[data-aceitar]")) abrirDetalhe(el.dataset.det);
    if ((el = g("data-geo"))) reiniciarGeo();
    if ((el = g("data-modo")) && !el.closest("#seg-modo")) { modo = el.dataset.modo; renderOfertas(); }
    if ((el = g("data-abrir")) && el.dataset.abrir === "sheet-cursos") carregarTreino();
    if ((el = g("data-ir"))) { e.preventDefault(); irPara(el.dataset.ir); if (el.dataset.ir === "tab-treino") carregarTreino(); }
    if ((el = g("data-abrir"))) { e.preventDefault(); abrir(el.dataset.abrir); }
    if ((el = g("data-fechar"))) fechar(el.dataset.fechar);
    if (e.target.classList?.contains("app-overlay")) fechar(e.target.id);
});
document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("[role=button]")) { e.preventDefault(); e.target.click(); } });

function irPara(id) {
    document.querySelectorAll(".tab-content").forEach((t) => t.classList.toggle("active", t.id === id));
    document.querySelectorAll(".nav-item").forEach((i) => i.classList.toggle("active", i.dataset.tab === id)); window.scrollTo(0, 0);
    if (id === "tab-ofertas") iniciarGeo(); else pararDeAcompanhar();          // GPS só liga enquanto a pessoa está vendo as ofertas
}
$("nav-personal").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) irPara(b.dataset.tab); });
