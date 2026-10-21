[DEPLOY-RENDER.md](https://github.com/user-attachments/files/33765873/DEPLOY-RENDER.md)
# Publicar o servidor de pagamentos no Render

O site (HTML/JS/CSS) continua onde já está hospedado. O que roda no Render é só a pasta `server/`.

1. **Tipo de serviço:** Web Service (não Static Site).
2. **Root Directory:** `server` · **Build:** `npm install` · **Start:** `npm start`
   (ou use o `render.yaml` da raiz: New > Blueprint).
3. **Variáveis de ambiente (Environment):**
   | Nome | O que é |
   |---|---|
   | `MP_CLIENT_ID` | Client ID da aplicação no Mercado Pago Developers |
   | `MP_CLIENT_SECRET` | Client Secret (Credenciais de produção) |
   | `MP_WEBHOOK_SECRET` | Chave secreta do webhook (opcional) |
   | `APP_URL` | URL onde o site está hospedado, sem `/` no final |
   | `MP_ACCESS_TOKEN` | (opcional) Access Token da conta da plataforma, para cadastrar cartões em produção; no front, preencha `MP_PUBLIC_KEY` em `config.js` |
   | `MODO_TESTE` | `1` liga o sandbox (login de teste, cartão e pagamento simulados). **Nunca deixe ligado em produção.** |
   | `FIREBASE_SERVICE_ACCOUNT` | JSON da conta de serviço do Firebase (Console > Configurações > Contas de serviço > Gerar nova chave). Cole o JSON inteiro |
4. **Mercado Pago Developers > sua aplicação > Redirect URL:**
   `https://abastece-j.onrender.com/mpCallback`  (exatamente assim)
5. **Teste:** abra `https://abastece-j.onrender.com/`. Deve aparecer "API Abastece Já rodando com sucesso no Render!".
   No plano gratuito o serviço dorme; a primeira chamada pode levar ~50 s.
6. `config.js` > `FUNCTIONS_BASE` deve ser `https://abastece-j.onrender.com`.

Nunca coloque a chave da conta de serviço nem o Client Secret no Git.

## Diagnóstico do erro "Not Found" no Mercado Pago
Abra `https://SEU-SERVICO.onrender.com/diagnostico`: lista variáveis faltando e mostra a **Redirect URL exata** para cadastrar no Mercado Pago. Causas mais prováveis, nesta ordem:
1. `FUNCTIONS_BASE` apontava para `abastece-ja.onrender.com`, mas o serviço (render.yaml) é `abastece-j`. Agora o app usa a mesma origem quando aberto em `*.onrender.com`.
2. Redirect URL no Mercado Pago diferente da mostrada em `/diagnostico`.
3. Serviço criado como Static Site, ou Root Directory errado.
4. `APP_URL` vazia/inválida (o checkout exige back_urls https).
5. `platform_id=mp` ausente no link de autorização (corrigido).

## Sandbox (testar sem Mercado Pago)
1. No Render, defina `MODO_TESTE=1` e faça o deploy.
2. Abra o app: aparece o bloco **Modo de teste** com "Entrar como Loja/Promotor (teste)".
3. Loja: cadastre o cartão de teste (4509 9535 6623 3704, validade futura, CVV 123) → solicite turno (máx. 6 h) → Promotor (outra aba anônima): aceite (4º turno na semana na mesma loja é barrado) → Loja: Pagar → "Simular pagamento aprovado" → nota.
4. Menu → "Zerar dados de teste" reinicia o cenário.
Local: `npm i && cd server && npm i`, `firebase emulators:start --only auth,firestore`, e em outro terminal `FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 MODO_TESTE=1 APP_URL=http://localhost:3000 npm start`; abra `http://localhost:3000/?emulador=1`.
Depois publique as regras: `firebase deploy --only firestore:rules`.
