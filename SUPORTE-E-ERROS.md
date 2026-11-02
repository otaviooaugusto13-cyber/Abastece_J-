# Suporte da plataforma, atendimento a clínicos e erros com chamado automático

## 1. Canais (chat da plataforma × WhatsApp) — `suporte-canais.js`, `suporte.js`
- `linkWhatsApp(mensagem)` monta `https://wa.me/<número>?text=<encodeURIComponent>` (texto limitado a 1500 caracteres). Todos os links usam `target="_blank" rel="noopener noreferrer"`.
- `abrirEscolhaDeCanal()` abre a folha "Como prefere ser atendido?" com **Chat da plataforma** e **WhatsApp**. Sem login, a opção do chat fica desabilitada (com dica) e o WhatsApp continua funcionando.
- Dentro do chat: tela de boas-vindas com "Continuar neste chat" / "Ir para o WhatsApp" e, no rodapé, um atalho "Prefiro o WhatsApp" que **leva as últimas mensagens da pessoa** no texto (calculado no clique).

## 2. Atendimento a clínicos — `atendimento-clinicos.html`, `clinicos.js`, `style-clinicos.css`
Página pública: escolha do assunto (radio acessível), campos opcionais, prévia da mensagem em tempo real, WhatsApp (nova aba) e chat interno (`/painel-loja?suporte=1` ou `/painel-promotor?suporte=1`). Usa os tokens de `style.css` (tema claro/escuro). Acessível pelo botão "Sou da área clínica" na folha de Ajuda.

## 3. Botão flutuante
O `#btn-whatsapp` (verde) virou `#btn-suporte-plataforma` (`.fab-suporte`, dourado, ícone de headset + "Suporte"). Abre a folha de canais; mostra selo de mensagens novas do chat. Na folha de Ajuda, "Falar no WhatsApp" virou "Falar com o suporte" (mesma folha).

## 4. Erros globais + chamado automático — `erros-globais.js`, `erros-nucleo.js`, `POST /chamados/automatico`
- Captura `window.error`, `unhandledrejection` e respostas 500 da API (`abastece:erro-api`, disparado por `firebase.js`). Também: `window.AbasteceErros.reportar(erro)` para `try/catch` do app.
- Ignora ruído (ResizeObserver, extensões, fetch cancelado, sem internet, sessão expirada) e agrupa repetições pela "impressão" do erro.
- Painel calmo: "já abrimos um chamado", protocolo sequencial `TI-000123` (copiável), **Falar com o TI**, recarregar, continuar usando, "ver detalhes técnicos".
- **Falar com o TI**: abre o chat e envia o relatório (≤1000 caracteres). Sem sessão ou com o chat indisponível, vira link do WhatsApp com o mesmo relatório.
- Servidor: `chamados.abrirAutomatico` — categoria `bug`, origem `automatico`; o mesmo erro do mesmo usuário em 1 h reaproveita o protocolo (sem inundar a fila); coleção `chamados_ti_dedupe` (já coberta pela regra de negação padrão do Firestore). Limite: 30/h por usuário.
- Sem sessão/rede: o relatório fica em `localStorage` e é enviado quando houver sessão (o protocolo aparece então).
- Privacidade: e-mail, CPF/CNPJ, telefone, tokens e query strings são removidos do relatório. O texto do erro nunca entra como HTML.

## Decisões e limites
- Erros de validação esperados (400/404/429) e mensagens de toast **não** abrem chamado; só exceções não tratadas e 500.
- `erros-globais.js` está nas páginas da loja e do promotor e na página de clínicos. Para cobrir `pagar.html`, `nota.html` etc., adicione `<script type="module" src="erros-globais.js"></script>` (só funciona onde há sessão do Firebase).
- Ao publicar: o service worker subiu para `abastece-v13`; mantenha `VERSAO_APP` (erros-globais.js) igual a ele.

## Testes
`node test/erros.test.js` (núcleo, LGPD, links WhatsApp), `node test/ti.test.cjs` (endpoint automático: protocolo, dedupe, IDOR, limites). `npm test` roda tudo.
