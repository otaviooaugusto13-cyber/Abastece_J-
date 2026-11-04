// ============================================================
// ABASTECE JÁ — login por E-MAIL e SENHA nas telas "Sou loja" e "Sou promotor" (mesmo padrão do painel de TI: e-mail, senha, Entrar, "ou", Google)
//   entrar → signInWithEmailAndPassword
//   criar  → createUserWithEmailAndPassword + e-mail de confirmação (o servidor só aceita e-mail verificado; ver acesso.js › telaVerificarEmail)
// Compartilha com o botão do Google o seletor Entrar × Criar e o aceite dos Termos (#check-termos).
// ============================================================
import { $, abrir } from "./ui.js";
import { entrarComEmail, criarContaComEmail, recuperarSenha } from "./firebase.js";
import { gravarModo, gravarTermos } from "./entrada.js";

const EMAIL_OK = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export const msgEmail = (e, criando = false) => {
    const c = String(e?.code || "");
    if (/invalid-credential|wrong-password|user-not-found|invalid-login-credentials/.test(c)) return "E-mail ou senha incorretos. Se você se cadastrou com o Google, use o botão “Entrar com Google”.";
    if (/email-already-in-use/.test(c)) return "Este e-mail já tem cadastro. Use “Entrar na minha conta”, “Esqueci minha senha” ou entre com o Google.";
    if (/weak-password/.test(c)) return "Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.";
    if (/invalid-email/.test(c)) return "E-mail inválido.";
    if (/too-many-requests/.test(c)) return "Muitas tentativas. Aguarde alguns minutos.";
    if (/network-request-failed/.test(c)) return "Sem conexão com a internet.";
    if (/user-disabled/.test(c)) return "Esta conta foi desativada. Fale com o suporte.";
    if (/operation-not-allowed/.test(c)) return "O login por e-mail e senha não está ativado no Firebase (Authentication › Método de login › E-mail/senha).";
    if (/unauthorized-domain/.test(c)) return "Este endereço não está autorizado no Firebase (Authentication › Configurações › Domínios autorizados).";
    return criando ? "Não foi possível criar a conta agora. Tente de novo." : "Não foi possível entrar agora. Tente de novo.";
};

/** modoAtual: () => "entrar" | "criar" (do seletor de modo da página). */
export function ligarLoginEmail({ modoAtual }) {
    const form = $("form-email"); if (!form) return;
    let aguardandoTermos = false;
    const erro = (t = "") => { $("em-erro").textContent = t; $("em-ok").hidden = true; };
    const ok = (t) => { $("em-erro").textContent = ""; $("em-ok").textContent = t; $("em-ok").hidden = false; };
    const ocupar = (v) => { $("btn-email").disabled = v; $("btn-esqueci").disabled = v; $("btn-email-txt").textContent = v ? "Aguarde…" : rotulo(); };
    const rotulo = () => (modoAtual() === "criar" ? "Criar conta com e-mail" : "Entrar com e-mail");
    function aplicar() {
        const criando = modoAtual() === "criar";
        $("em-nome-wrap").hidden = !criando; $("em-senha2-wrap").hidden = !criando; $("btn-esqueci").hidden = criando;
        $("em-senha").autocomplete = criando ? "new-password" : "current-password";
        $("btn-email-txt").textContent = rotulo(); erro();
    }
    document.addEventListener("abastece:modo", aplicar); aplicar();

    $("em-ver").addEventListener("click", () => {
        const ver = $("em-senha").type === "password";
        for (const id of ["em-senha", "em-senha2"]) $(id).type = ver ? "text" : "password";
        $("em-ver").textContent = ver ? "Ocultar" : "Mostrar"; $("em-ver").setAttribute("aria-pressed", String(ver));
    });

    form.addEventListener("submit", async (ev) => {
        ev.preventDefault(); erro();
        const criando = modoAtual() === "criar", email = $("em-email").value.trim(), senha = $("em-senha").value, nome = $("em-nome").value.trim();
        if (!EMAIL_OK.test(email)) return erro("Digite um e-mail válido.");
        if (!senha) return erro("Digite a senha.");
        if (criando) {
            if (nome.length < 3) return erro("Digite seu nome completo.");
            if (senha.length < 8) return erro("A senha precisa ter pelo menos 8 caracteres.");
            if (senha !== $("em-senha2").value) return erro("As senhas não conferem.");
            if (!$("check-termos").checked) { aguardandoTermos = true; abrir("sheet-termos"); return; }   // mesmo aceite dos Termos do botão do Google
        }
        ocupar(true); gravarModo(modoAtual()); gravarTermos(criando);
        try { await (criando ? criarContaComEmail({ email, senha, nome }) : entrarComEmail(email, senha)); $("em-senha").value = ""; $("em-senha2").value = ""; }   // a sessão chega pelo onAuthStateChanged da página
        catch (e) { console.warn(e.code || e); erro(msgEmail(e, criando)); }
        finally { ocupar(false); }
    });
    $("btn-aceitar-termos")?.addEventListener("click", () => { if (!aguardandoTermos) return; aguardandoTermos = false; $("check-termos").checked = true; setTimeout(() => form.requestSubmit(), 0); });

    $("btn-esqueci").addEventListener("click", async () => {
        erro(); const email = $("em-email").value.trim();
        if (!EMAIL_OK.test(email)) return erro("Digite seu e-mail no campo acima para receber o link de nova senha.");
        ocupar(true);
        try { await recuperarSenha(email); ok("Se existir uma conta com este e-mail, enviamos um link para criar uma nova senha. Olhe também o spam."); }
        catch (e) { console.warn(e.code || e); erro(msgEmail(e)); }
        finally { ocupar(false); }
    });
}
