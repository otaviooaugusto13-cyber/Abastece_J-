// Testes do roteador de chamados (puro, sem rede): node test/roteador.test.cjs
const assert = require("node:assert/strict");
const { classificarErro: c, extrairDaDescricao, mensagemParaUsuario } = require("../server/lib/ti/roteador");
const { criarDespacho } = require("../server/lib/ti/despacho");
let n = 0; const t = (nome, fn) => { fn(); n++; console.log("  ✓ " + nome); };
const dep = (e) => c(e).departamento;

t("TI: exceções de código (mesmo citando valor/pagamento), 5xx, banco, rede e timeout", () => {
  assert.equal(dep({ nome: "TypeError", mensagem: "Cannot read properties of undefined (reading 'valor')", stack: "at pagar (https://x/pagar.js:1:2)" }), "ti");
  assert.equal(dep({ nome: "Error", mensagem: "x is not a function" }), "ti");
  assert.equal(dep({ nome: "ApiError", mensagem: "POST pagamentos/confirmar: erro interno [code=interno] [status=500]" }), "ti");   // 500 genérico em rota financeira continua sendo técnico
  assert.equal(dep({ nome: "ApiError", mensagem: "9 FAILED_PRECONDITION: The query requires an index", status: 500 }), "ti");
  assert.equal(dep({ nome: "Error", mensagem: "read ECONNRESET" }), "ti");
  assert.equal(dep({ nome: "Error", mensagem: "tempo esgotado", codigo: "tempo" }), "ti");
  assert.equal(dep({ nome: "ApiError", mensagem: "O Mercado Pago não aceitou a credencial da plataforma.", codigo: "mp", status: 502 }), "ti");
});
t("ADM: pagamento, comissão/repasse/saque, valores inconsistentes e permissão gerencial", () => {
  assert.equal(dep({ nome: "Error", mensagem: "Saldo insuficiente", codigo: "saldo-insuficiente" }), "adm");
  assert.equal(dep({ nome: "Error", mensagem: "O valor do repasse está divergente do total do pedido" }), "adm");
  assert.equal(dep({ nome: "Error", mensagem: "Falha ao calcular comissão do promotor" }), "adm");
  assert.equal(dep({ nome: "ApiError", mensagem: "POST criar: Mercado Pago recusou a operação", codigo: "mp", status: 502 }), "adm");
  assert.equal(dep({ nome: "ApiError", mensagem: "GET admin/saques: sem acesso", status: 403, rota: "GET admin/saques" }), "adm");
  assert.equal(dep({ nome: "Error", mensagem: "Acesso negado: apenas gestor financeiro pode aprovar" }), "adm");
  assert.equal(dep({ nome: "Error", mensagem: "x", codigo: "nota-inconsistente" }), "adm");
});
t("Suporte: operação em campo, cadastro e dúvidas; nunca 'crítica'", () => {
  assert.equal(dep({ nome: "ApiError", mensagem: "A janela de check-in expirou", codigo: "checkin-expirado", status: 409 }), "suporte");
  assert.equal(dep({ nome: "Error", mensagem: "x", codigo: "treinamento-pendente" }), "suporte");
  assert.equal(dep({ nome: "Erro", mensagem: "Como faço para alterar meu turno?", tipo: "duvida" }), "suporte");
  for (const e of [{ codigo: "interno" }, { codigo: "pagamento-invalido" }, { nome: "TypeError", mensagem: "x is not a function" }]) assert.notEqual(c(e).prioridade, "critica");
});
t("sem sinais: erro capturado vai ao TI (confiança baixa); dúvida vai ao Suporte; entrada lixo não lança", () => {
  const r = c({ nome: "Erro", mensagem: "algo estranho aconteceu" }); assert.equal(r.departamento, "ti"); assert.equal(r.confianca, "baixa");
  assert.equal(c({ mensagem: "oi", tipo: "duvida" }).departamento, "suporte");
  for (const lixo of [null, undefined, 42, "texto", [], { mensagem: { a: 1 }, stack: 5 }]) assert.ok(["ti", "adm", "suporte"].includes(c(lixo).departamento));
});
t("saída explicável e determinística: motivo, sinais, categoria válida", () => {
  const e = { nome: "Error", mensagem: "Falha de pagamento Pix" }, a = c(e), b = c(e);
  assert.deepEqual(a, b); assert.ok(a.motivo && a.sinais.length); assert.ok(["bug", "infra", "dados", "pagamento", "acesso", "app", "outro"].includes(a.categoria));
});
t("extrairDaDescricao: recupera nome, mensagem, origem e stack do relatório (clientes antigos)", () => {
  const d = extrairDaDescricao("Erro: ApiError: POST x/y: erro interno [code=interno] [status=500]\nOrigem: api\nTela: screen-main\n\nStack:\nat a (f.js:1:1)");
  assert.equal(d.nome, "ApiError"); assert.equal(d.origem, "api"); assert.equal(d.tela, "screen-main"); assert.match(d.stack, /at a/);
  assert.equal(dep({ ...d }), "ti");
});
t("mensagem ao usuário: setor, protocolo e prazo por departamento; repetido reaproveita o protocolo", () => {
  const a = mensagemParaUsuario({ departamento: "adm", protocolo: "ADM-000045", prioridade: "alta" });
  assert.match(a.texto, /ADM-000045/); assert.match(a.texto, /Administrativo\/Financeiro/); assert.match(a.texto, /1 hora/); assert.equal(a.setor, "Administrativo / Financeiro");
  assert.match(mensagemParaUsuario({ departamento: "suporte", protocolo: "SUP-000001" }).texto, /Suporte/);
  assert.match(mensagemParaUsuario({ departamento: "ti", protocolo: "TI-000009", repetido: true }).texto, /já estava registrado/);
});
(async () => {
  // despacho: payload segmentado e entrega
  const chamado = (departamento) => ({ id: "abc123", protocolo: departamento === "adm" ? "ADM-000045" : "TI-000007", departamento, prioridade: "alta", titulo: "Erro automático: ApiError", categoria: "pagamento", status: "aberto", origem: "automatico",
    criadoMs: 1, slaAtendMs: 2, solicitanteTipo: "loja", solicitanteNome: "Loja Sol", classificacao: { motivo: "inconsistência de valores", confianca: "alta", sinais: ["valor-inconsistente"] },
    logsTecnicos: { nome: "ApiError", mensagem: "valor divergente", rota: "POST pagamentos/confirmar", status: 409, codigo: "valor-divergente", stack: "at a (f.js:1:1)\nat b (f.js:2:2)", arquivo: "https://x/f.js" } });
  const chamadas = [], notas = [];
  const d = criarDespacho({ suporte: { enviarPush: async () => 2 }, chamados: { anotar: async (id, txt) => notas.push(txt) }, appUrl: () => "https://app.exemplo.com",
    env: () => ({ CHAMADOS_WEBHOOK_ADM: "https://hooks.slack.com/services/T/B/X", CHAMADOS_WEBHOOK_TI: "https://discord.com/api/webhooks/1/abc", CHAMADOS_WEBHOOK_SEGREDO: "s" }),
    fetchFn: async (url, op) => { chamadas.push({ url, op, corpo: JSON.parse(op.body) }); return { ok: true, status: 200 }; } });
  const adm = await d.notificar(chamado("adm")), ti = await d.notificar(chamado("ti"));
  assert.equal(adm.payload.departamento, "adm"); assert.ok(!("stack" in adm.payload.erro) && !("arquivo" in adm.payload.erro));   // ADM/Suporte: sem stack
  assert.match(ti.payload.erro.stack, /at a/); assert.equal(ti.payload.links.painel, "https://app.exemplo.com/painel-ti?chamado=abc123");
  assert.equal(adm.payload.links.painel, "https://app.exemplo.com/painel-admin?chamado=abc123#chamados");
  assert.ok(!JSON.stringify(adm.payload).includes("uid"));
  assert.equal(chamadas[0].url, "https://hooks.slack.com/services/T/B/X"); assert.deepEqual(Object.keys(chamadas[0].corpo), ["text"]); assert.match(chamadas[0].corpo.text, /ADM-000045 → Administrativo \/ Financeiro/);
  assert.deepEqual(Object.keys(chamadas[1].corpo).sort(), ["content", "username"]);                                            // Discord
  assert.match(chamadas[0].op.headers["X-Abastece-Assinatura"], /^sha256=[0-9a-f]{64}$/);
  assert.equal(adm.canais.find((x) => x.canal === "push").aparelhos, 2); assert.equal(ti.canais.find((x) => x.canal === "push").motivo, "nao-se-aplica");
  assert.ok(notas.length === 2 && /Roteado para Administrativo/.test(notas[0])); n++; console.log("  ✓ despacho: payload por departamento, formato por chat, assinatura, push só ADM/Suporte, nota interna");
  // robustez: webhook fora do ar / http inseguro / sem configuração nunca lançam
  const quebrado = criarDespacho({ suporte: null, chamados: { anotar: async () => {} }, env: () => ({ CHAMADOS_WEBHOOK_URL: "https://x.exemplo.com/h" }), fetchFn: async () => { throw new Error("rede caiu"); } });
  const r = await quebrado.notificar(chamado("adm")); assert.equal(r.canais.find((x) => x.canal === "webhook").ok, false);
  const http = criarDespacho({ suporte: null, chamados: { anotar: async () => {} }, env: () => ({ CHAMADOS_WEBHOOK_URL: "http://inseguro.com/h" }), fetchFn: async () => { throw new Error("não devia chamar"); } });
  assert.equal((await http.notificar(chamado("ti"))).canais.find((x) => x.canal === "webhook").motivo, "nao-configurado"); n++; console.log("  ✓ despacho: falha de rede e URL http são tratadas sem lançar");
  console.log(`\n${n} testes do roteador passaram`);
})().catch((e) => { console.error(e); process.exit(1); });
