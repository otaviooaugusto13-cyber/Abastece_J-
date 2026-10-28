// ============================================================
// ABASTECE JÁ — acesso por portal (loja | promotor | admin) e tratamento amigável de multi-perfil
//
// Uma conta Google = um uid no Firebase Auth, e a sessão é COMPARTILHADA entre index.html, promotor.html e admin.html
// (mesma origem). Por isso abrir o portal "errado" não é erro de login: é só a conta estar com outro perfil.
// Antes, o front fazia signOut() + toast ("Esta conta não tem acesso…" / "Conta com dois perfis. Fale com o suporte.").
// Agora: o servidor (/sessao) diz o que a conta tem, e esta tela oferece o caminho certo — sem derrubar a sessão.
// ============================================================
import { chamarFuncao, renovarToken } from "./firebase.js";
import { esc } from "./core.js";

const PAINEL = {
    loja:     { nome: "loja",          rotulo: "Abrir painel da loja",             href: "index.html" },
    promotor: { nome: "promotor",      rotulo: "Abrir portal do promotor",         href: "promotor.html" },
    admin:    { nome: "administrador", rotulo: "Abrir painel administrativo",      href: "admin.html" }
};
const ID_TELA = "screen-acesso";

/**
 * Pede ao servidor para ativar o perfil do portal aberto.
 * Resolve com { estado: "ok" | "cadastro" | "outro-perfil" | "escolher", role, perfis, sugerido }.
 * Se o perfil ativo mudou, o token é renovado aqui (para as claims novas valerem nas regras do Firestore e na API).
 * Lança em falha de rede/servidor — quem chama decide (ver `telaFalhaTemporaria`).
 */
export async function resolverAcesso(portal) {
    const r = await chamarFuncao("sessao", { portal });
    if (r.atualizarToken) await renovarToken();
    // Compatibilidade: servidor antigo (sem `estado`) só devolvia { role, atualizarToken }.
    if (!r.estado) r.estado = !r.role ? "cadastro" : r.role === portal ? "ok" : "outro-perfil";
    if (r.estado === "outro-perfil" && !r.sugerido && r.role) r.sugerido = r.role;
    r.perfis = Array.isArray(r.perfis) ? r.perfis : (r.role ? [r.role] : []);
    return r;
}

/** Garante o contêiner da tela (usa as mesmas classes das telas de login, então herda tema claro/escuro). */
function garantirTela() {
    let t = document.getElementById(ID_TELA);
    if (!t) {
        t = document.createElement("div"); t.id = ID_TELA; t.className = "screen login-screen";
        t.innerHTML = '<div class="auth-card" role="alertdialog" aria-labelledby="acesso-titulo" aria-describedby="acesso-texto"></div>';
        document.body.appendChild(t);
    }
    return t;
}

/** Mostra a tela de aviso e esconde as demais. `acoes`: [{ rotulo, href?, aoClicar?, tipo?: "primary"|"ghost" }]. */
function mostrar({ titulo, texto, acoes }) {
    const t = garantirTela(), card = t.firstElementChild;
    card.innerHTML = `
        <div class="auth-brand"><h1>ABASTECE<span class="highlight">JÁ</span></h1></div>
        <h2 class="auth-title" id="acesso-titulo">${esc(titulo)}</h2>
        <p class="auth-sub" id="acesso-texto">${esc(texto)}</p>
        <div class="acesso-acoes"></div>`;
    const box = card.querySelector(".acesso-acoes");
    acoes.forEach((a, i) => {
        const el = document.createElement(a.href ? "a" : "button");
        el.className = `btn ${a.tipo === "ghost" ? "btn-ghost" : "btn-primary"} ${i ? "btn-block-gap" : ""}`; el.textContent = a.rotulo;
        if (a.href) { el.href = a.href; el.style.textDecoration = "none"; el.style.display = "flex"; el.style.justifyContent = "center"; } else { el.type = "button"; el.addEventListener("click", a.aoClicar); }
        box.appendChild(el);
    });
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s === t));
    box.querySelector("a,button")?.focus?.({ preventScroll: true });
}

/**
 * Perfil errado para este portal (ou conta com mais de um perfil).
 * Não derruba a sessão: oferece abrir o painel que a conta realmente tem, ou trocar de conta Google.
 *   portal  — onde o usuário está agora ("loja" | "promotor" | "admin")
 *   perfis  — perfis que o servidor confirmou para a conta
 *   email   — só para o texto
 *   trocarConta — async: encerra a sessão e volta para a tela de login do portal atual
 */
export function telaOutroPerfil({ portal, perfis, email, trocarConta }) {
    const tem = (perfis || []).filter((p) => PAINEL[p] && p !== portal);
    const lista = tem.map((p) => PAINEL[p].nome);
    const quem = email ? `A conta ${email}` : "Esta conta Google";
    const so = lista.length ? lista.join(" e ") : "outro tipo de acesso";
    const titulo = lista.length > 1 ? "Esta conta tem mais de um perfil" : `Esta conta é de ${so}`;
    const texto = portal === "admin"
        ? `${quem} não tem permissão de administrador. Você pode abrir o painel que ela já possui ou entrar com outra conta.`
        : `${quem} não tem cadastro de ${PAINEL[portal].nome}; ela é de ${so}. Escolha como quer continuar. Para atuar também como ${PAINEL[portal].nome}, entre com outra conta Google.`;
    mostrar({
        titulo, texto,
        acoes: [
            ...tem.map((p, i) => ({ rotulo: PAINEL[p].rotulo, href: PAINEL[p].href, tipo: i ? "ghost" : "primary" })),
            { rotulo: "Entrar com outra conta Google", aoClicar: trocarConta, tipo: tem.length ? "ghost" : "primary" }
        ]
    });
}

/** Não foi possível confirmar o perfil (rede/servidor fora). Não desloga: deixa tentar de novo. */
export function telaFalhaTemporaria({ tentarDeNovo, trocarConta }) {
    mostrar({
        titulo: "Não conseguimos verificar sua conta",
        texto: "Pode ser a conexão ou uma instabilidade momentânea. Sua conta não foi alterada — tente novamente.",
        acoes: [{ rotulo: "Tentar de novo", aoClicar: tentarDeNovo }, { rotulo: "Sair e usar outra conta", aoClicar: trocarConta, tipo: "ghost" }]
    });
}
