# Atualização 2 — Vagas na loja + mapa Google (sobre o Abastece Já 3)

Descompacte **por cima** da pasta do projeto (substitui os arquivos de mesmo nome). Inclui tudo da atualização anterior (Mural de Vagas),
então **este zip substitui o anterior**. Nenhum CSS existente foi alterado: só entram estilos novos, em `style-vagas.css`.

## 1. Vagas no app da LOJA (novo)
- `index.html` › aba **Conta** › **Vagas da minha loja** (módulo `loja-vagas.js`).
- A loja cria vaga (rascunho ou publicar), publica/encerra, vê os candidatos de cada vaga (CPF mascarado), marca *Em análise / Aceitar / Recusar*
  e abre o currículo em PDF. Plano, moderação e consentimento do candidato continuam valendo só no servidor.
- Onde ver as vagas no **promotor**: `promotor.html` › aba **Menu** (último ícone) › *Mural de vagas* e *Divulgação e currículo*.
- O mural do promotor fica vazio até alguém publicar vagas (Admin › Vagas, ou a própria loja).

## 2. Mapa do Google (novo, opcional)
1. Google Cloud › APIs e serviços › ative **Maps JavaScript API** › Credenciais › criar **chave de API**.
2. **Restrinja a chave**: Restrições de aplicativo › Sites › `https://SEU-DOMINIO/*`; Restrição de API › só *Maps JavaScript API*.
3. Faturamento: o Google exige conta de faturamento, mas tem uso gratuito mensal; crie um **alerta de orçamento**.
4. Cole a chave em `config.js` → `export const GOOGLE_MAPS_KEY = "...";` e faça o deploy.
- Sem chave (`""`), o mapa continua OpenStreetMap, como hoje. Se o Google recusar a chave ou falhar, o app volta sozinho para o OpenStreetMap.
- A CSP (`server/lib/seguranca.js`) já libera `maps.googleapis.com`, `maps.gstatic.com`, `*.ggpht.com` e workers por `blob:`.
- Visual escuro igual ao atual; zoom no meio da direita; carros giram pelo rumo; círculo do raio como antes.

## ⚠️ Se o mapa continua sem aparecer
O mapa só é desenhado se a loja tiver **localização cadastrada** (Conta › *Localização da loja*). Sem ela a tela mostra só o aviso
"Defina onde fica a sua loja". Trocar de provedor não resolve isso. Se a loja já tem localização, abra o Console do navegador (F12) e procure erro de CSP/rede.

## Deploy
1. `firebase deploy --only firestore:rules,storage` · bucket do Storage criado · `FIREBASE_STORAGE_BUCKET` no Render (ver `MODULO-VAGAS.md`).
2. Deploy do servidor/site. Service worker agora é **`abastece-v23`** (força o app a baixar os arquivos novos).

## Arquivos
Novos: `loja-vagas.js`, `google-map.js`, `test/loja-vagas-ui.test.js`, `test/google-map.test.js` (+ os do Vagas anterior).
Alterados nesta rodada: `index.html`, `script.js`, `mapa-promotores.js`, `config.js`, `server/lib/seguranca.js`, `sw.js`, `style-vagas.css`, `package.json`, `MODULO-VAGAS.md`.

## Verificação
`npm test`: tudo passa (inclui 17 testes novos: 10 da tela da loja e 7 do mapa Google, com `google` simulado) e a sintaxe de todos os `.js` está ok.
**Não testado aqui** (sem rede/chave/navegador): o mapa Google real com a sua chave, as telas no navegador e o upload real de PDF.
**Já existia no 3:** o `npm test` termina com erro porque `package.json` chama `test/documento.test.cjs`, que não existe em nenhum dos zips.
