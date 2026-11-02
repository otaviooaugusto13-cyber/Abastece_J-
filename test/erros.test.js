// Testes do núcleo de erros e dos canais de atendimento (puros, sem DOM nem rede): node test/erros.test.js
import assert from "node:assert/strict";
import { normalizar, ehRuido, impressao, redigir, montarRelatorio, LIMITES, urlSegura } from "../erros-nucleo.js";
import { linkWhatsApp, mensagemInicial, mensagemDeContinuacao, mensagemClinico, CONTEXTOS, LIMITE_TEXTO_WHATSAPP } from "../suporte-canais.js";
import { WHATSAPP_SUPORTE } from "../config.js";
let n = 0; const t = (nome, fn) => { fn(); n++; console.log("  ✓ " + nome); };

t("normalizar: aceita Error, string, objeto, null e não lança", () => {
    assert.equal(normalizar(new TypeError("x is not a function")).nome, "TypeError");
    assert.equal(normalizar("quebrou").mensagem, "quebrou");
    assert.equal(normalizar(undefined).mensagem, "Erro sem detalhes");
    assert.equal(normalizar({ a: 1 }).nome, "ErroNaoPadrao");
    const circ = {}; circ.eu = circ; assert.ok(normalizar(circ).mensagem.length > 0);        // JSON.stringify falha → cai no String()
    const api = Object.assign(new Error("boom"), { code: "interno", status: 500 }); assert.match(normalizar(api).mensagem, /code=interno.*status=500/);
    assert.ok(normalizar("a".repeat(5000)).mensagem.length <= LIMITES.mensagemErro);
});
t("ruído: ignora ResizeObserver, 'Script error.', extensões, abort e sessão expirada; NÃO ignora erro de verdade", () => {
    for (const m of ["ResizeObserver loop completed with undelivered notifications.", "Script error.", "AbortError: The user aborted a request.", "Failed to fetch", "Sua sessão terminou. Entre novamente."])
        assert.equal(ehRuido(normalizar(new Error(m))), true, m);
    assert.equal(ehRuido(normalizar(new Error("x"), { arquivo: "chrome-extension://abc/content.js" })), true);
    assert.equal(ehRuido(normalizar(new TypeError("Cannot read properties of undefined (reading 'uid')"))), false);
    assert.equal(ehRuido(normalizar(new Error("Erro interno do servidor"))), false);
});
t("impressão: estável para o mesmo erro (ignora números/linhas) e diferente para erros diferentes; 16 hex (aceita pela API)", () => {
    const a = normalizar(Object.assign(new Error("Pedido 123 falhou"), { stack: "Error: Pedido 123 falhou\n    at pagar (https://x.com/pagar.js:10:5)" }));
    const b = normalizar(Object.assign(new Error("Pedido 98765 falhou"), { stack: "Error: Pedido 98765 falhou\n    at pagar (https://x.com/pagar.js:42:9)" }));
    const c = normalizar(Object.assign(new Error("Outra coisa"), { stack: "Error: Outra coisa\n    at pagar (https://x.com/pagar.js:10:5)" }));
    assert.equal(impressao(a), impressao(b)); assert.notEqual(impressao(a), impressao(c)); assert.match(impressao(a), /^[0-9a-f]{16}$/);
});
t("redigir (LGPD): remove e-mail, CPF, CNPJ, telefone, Bearer/JWT e parâmetros sensíveis da URL", () => {
    const r = redigir("erro p/ ana@loja.com cpf 123.456.789-09 cnpj 12.345.678/0001-95 tel (19) 99535-0637 Authorization: Bearer abc123def456ghi789 https://x.com/a?token=SEGREDO&ok=1");
    for (const vazou of ["ana@loja.com", "123.456.789-09", "12.345.678/0001-95", "99535-0637", "abc123def456ghi789", "SEGREDO"]) assert.ok(!r.includes(vazou), `vazou ${vazou}: ${r}`);
    assert.ok(r.includes("ok=1"));
    assert.ok(!redigir("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk").includes("eyJ"));
});
t("urlSegura: tira query e hash", () => { assert.equal(urlSegura("https://app.com/painel-loja?token=1#x"), "https://app.com/painel-loja"); assert.equal(urlSegura("lixo?a=1"), "lixo"); });
t("relatório: respeita 120 (título), 2000 (chamado) e 1000 (chat), inclui protocolo e não vaza dados pessoais", () => {
    const e = normalizar(Object.assign(new TypeError("falha com ana@loja.com " + "x".repeat(3000)), { stack: Array.from({ length: 40 }, (_, i) => `    at fn${i} (https://x.com/app.js:${i}:1)`).join("\n") }), { origem: "window.onerror", arquivo: "https://x.com/app.js?v=1", linha: 7, coluna: 3 });
    const r = montarRelatorio(e, { url: "https://x.com/painel-loja?token=abc", tela: "screen-main", perfil: "loja", versao: "abastece-v13", navegador: "UA".repeat(200), trilha: ["#a", "#b"], online: true });
    assert.ok(r.titulo.length <= LIMITES.titulo && r.titulo.startsWith("Erro automático: TypeError"));
    assert.ok(r.descricao.length <= LIMITES.descricaoChamado); assert.ok(!r.descricao.includes("ana@loja.com") && !r.descricao.includes("token=abc"));
    assert.match(r.descricao, /Tela: screen-main/); assert.match(r.descricao, /Últimas ações: #a > #b/);
    const chat = r.paraChat("TI-000123"); assert.ok(chat.length <= LIMITES.mensagemChat); assert.match(chat, /TI-000123/); assert.match(chat, /TypeError/);
    assert.match(r.paraChat(""), /Erro no aplicativo/);                                    // sem protocolo ainda assim gera texto útil
});
t("WhatsApp: número só com dígitos, texto codificado com encodeURIComponent, limite de tamanho, quebra de linha preservada", () => {
    const url = linkWhatsApp("Olá! Preciso de ajuda & mais\nlinha 2 ✓");
    assert.equal(url, `https://wa.me/${WHATSAPP_SUPORTE}?text=${encodeURIComponent("Olá! Preciso de ajuda & mais\nlinha 2 ✓")}`);
    assert.ok(!url.includes(" ") && !url.includes("\n") && url.includes("%0A") && url.includes("%26"));
    assert.ok(decodeURIComponent(linkWhatsApp("a".repeat(9999)).split("text=")[1]).length === LIMITE_TEXTO_WHATSAPP);
    assert.equal(linkWhatsApp("oi", "+55 (19) 99535-0637"), "https://wa.me/5519995350637?text=oi");
});
t("mensagens: contexto padrão, continuação do chat (só as últimas da pessoa) e atendimento a clínicos", () => {
    assert.equal(mensagemInicial("promotor"), CONTEXTOS.promotor); assert.equal(mensagemInicial("inexistente"), CONTEXTOS.geral);
    assert.equal(mensagemDeContinuacao([], "loja"), CONTEXTOS.loja);
    const c = mensagemDeContinuacao([{ de: "usuario", texto: "um" }, { de: "suporte", texto: "resposta" }, { de: "usuario", texto: "dois" }, { de: "usuario", texto: "três" }, { de: "usuario", texto: "quatro" }], "loja");
    assert.ok(c.includes("• dois") && c.includes("• quatro") && !c.includes("• um") && !c.includes("resposta"));
    const m = mensagemClinico({ assunto: "pagamentos", unidade: "  Clínica   Sol ", detalhe: "x".repeat(900) });
    assert.match(m, /Assunto: Pagamentos e repasses/); assert.match(m, /Clínica\/unidade: Clínica Sol/); assert.ok(m.split("Detalhes: ")[1].length === 300);
    assert.match(mensagemClinico({ assunto: "??" }), /Assunto: Outro assunto/); assert.ok(!mensagemClinico({}).includes("Detalhes"));
});
console.log(`\n${n} testes de erros e canais passaram`);
