# Correções aplicadas (revisão de 06/11/2026)

## Login
- **Botão "Entrar com Google" parado (painel da loja):** `mapa-promotores.js` importava `./dark-map.js`, arquivo que não existe mais; o 404 derrubava o `script.js` inteiro e nenhum clique era ligado. Agora o import é sob demanda e a chamada do mapa está protegida (`script.js`).
- Botão flutuante "Suporte" cobria o botão do Google na tela de login: agora é só o ícone e a página ganha espaço no fim (`mobile.css`).

## Pagamentos (`server/rotas/pagamentos.js`, `server/split.js`, `firestore.rules`)
- Pagamento aprovado com valor/referência divergente deixa de sumir em silêncio: grava em `pagamentos_revisao/{paymentId}` + log de erro.
- Pagamento aprovado com estorno parcial agora é finalizado (antes ficava sem baixa).
- Anti-replay opcional do webhook: variável `MP_WEBHOOK_TOLERANCIA_MS` (ex.: 600000). Padrão: desligado.
- Exportações duplicadas removidas de `split.js`.

## Mobile (novo `mobile.css`, ligado em TODAS as páginas HTML)
Medido em Chromium com 320, 360, 390 e 412 px (telas de login/entrada; telas internas exigem login):
- alvos de toque menores que 40 px: **72 → 0**
- campos com fonte de 15 px (iPhone dá zoom ao tocar): **48 → 0** (agora 16 px)
- páginas com rolagem horizontal: 0 → 0
- sem atraso/flash de toque (`touch-action: manipulation`), `overscroll-behavior` nos sheets, safe-area (iPhone com notch), paisagem baixa, blur desligado em celular fraco, listas longas com `content-visibility`.
- Campos com `inputmode`/`autocomplete`/`autocapitalize`/`enterkeyhint` corretos (e-mail, telefone, CPF/CNPJ, cartão, Pix, chat).
- `sw.js`: versão `abastece-v24` (força os celulares a pegarem a versão nova) e `mobile.css` no cache.
- `server/server.js`: imagens, ícones e fontes com cache de 7 dias (menos dados em rede móvel).

## Não verificado
- `test/backend.test.cjs` e demais testes do servidor (exigem `npm install`, sem rede aqui). Rode: `cd server && npm i && node ../test/backend.test.cjs`.
- Telas internas (pós-login) em celular real; a auditoria automática só alcança as telas de entrada.

## Painel do promotor (revisão especial)
Testado em Chromium (360 px, tema escuro) com Firebase e API simulados, em dois cenários: cadastro aprovado e cadastro pendente.
- **Ofertas "carregando" para sempre / calendário em branco / "Próximos turnos" vazio:** `renderOfertas` usava o elemento `#dot-ofertas`, que não existia no `promotor.html`; o erro abortava a função antes de desenhar a lista. Agora o selo existe no botão central do dock e o código não quebra se ele faltar. `renderTudo` passou a desenhar cada seção isoladamente (uma falha não apaga as outras).
- **Cards fantasmas deslizando para fora da tela:** dois `@keyframes` com o mesmo nome (`brilho`, `pulso`) em arquivos CSS diferentes; o último sobrescrevia o primeiro. Renomeados (`brilho-barra`, `pulso-ruptura`, `pulso-hab`).
- **Chips de categoria sobrepostos:** corrigido (não encolhem mais; rolam na horizontal).
- **"Aparecer para lojas próximas" removido.** O promotor agora fica online automaticamente ao abrir o app (`promotor-online.js`): envia a posição a cada ~10 s com o app aberto; só aparece quem está habilitado (se ainda não estiver, tenta de novo a cada 60 s); se o GPS estiver bloqueado, não mostra nada. O servidor tira o promotor do mapa 45 s após o último sinal.
- Filtros de setor ficam ocultos enquanto as ofertas estão bloqueadas (cadastro pendente).
- Carteira e selos toleram resposta incompleta do servidor.
