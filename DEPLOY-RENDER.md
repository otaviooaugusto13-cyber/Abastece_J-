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
   | `FIREBASE_SERVICE_ACCOUNT` | JSON da conta de serviço do Firebase (Console > Configurações > Contas de serviço > Gerar nova chave). Cole o JSON inteiro |
4. **Mercado Pago Developers > sua aplicação > Redirect URL:**
   `https://abastece-j.onrender.com/mpCallback`  (exatamente assim)
5. **Teste:** abra `https://abastece-j.onrender.com/`. Deve aparecer "API Abastece Já rodando com sucesso no Render!".
   No plano gratuito o serviço dorme; a primeira chamada pode levar ~50 s.
6. `config.js` > `FUNCTIONS_BASE` deve ser `https://abastece-j.onrender.com`.

Nunca coloque a chave da conta de serviço nem o Client Secret no Git.
