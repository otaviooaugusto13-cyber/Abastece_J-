# Checkout Pro mobile — Abastece Já

## Backend (copie por cima, mesmos caminhos do repositório)
- `backend/server/rotas/pagamentos.js` — /criarCobranca (preferência + back_urls HTTPS + metadata da divisão), GET /pagamento/retorno/:status (volta ao app por deep link), GET /statusPagamento
- `backend/server/rotas/pedidos.js` — cartão pré-cadastrado deixa de ser obrigatório (EXIGE_CARTAO_CADASTRADO=1 religa)
- `backend/server/server.js` — rotas novas sem cache
- `backend/pagar.js` — página web não bloqueia mais o pagamento por falta de cartão
- `backend/render.yaml` — novas variáveis de ambiente

## Render (variáveis)
- APP_URL = https://abastece-ja.onrender.com  (o domínio real do seu serviço; o render.yaml chama o serviço de "abastece-j")
- MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET (já existentes)
- No painel do Mercado Pago: webhook apontando para https://SEU-DOMINIO/webhookMP (evento Pagamentos)

## Flutter (novos arquivos — o zip enviado não continha o projeto Flutter)
- `flutter/lib/pagamento/pagamento_service.dart`, `tela_pagamento.dart`, `exemplo_uso.dart`
- `flutter/pubspec_trecho.yaml`, `android/AndroidManifest_trecho.xml`, `ios/Info_plist_trecho.xml`
