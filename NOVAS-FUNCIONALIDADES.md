# Abastece Já — Camada de execução, níveis, vidas, relâmpago e B2B

Tudo abaixo está integrado ao ecossistema existente (Express + Firestore + claims de papel + ledger). `npm test` roda 52 testes de backend/paridade; os fluxos de tela foram verificados no Chromium com GPS e câmera simulados.

## 1. Check-in / check-out (geofencing + foto)
- `POST /checkin`: o app envia `lat,lng,precisao,idadeFixMs`; **o servidor** calcula a distância (haversine) e só aceita a ≤ **100 m** do ponto da loja, com GPS de precisão ≤ 100 m e leitura com < 2 min. Janela: abre 30 min antes do início e fecha 60 min depois. Tentativas negadas ficam em `presencas` (auditoria).
- `POST /checkout`: **foto obrigatória** (JPEG íntegro, ≥ 480 px, ≤ 560 KB, SHA-256 inédito) + estado da gôndola (`cheia`/`parcial`) + GPS opcional. Exige permanência mínima (50% do turno; 30 min no relâmpago). A foto fica em `fotos_checkout/{pedido}` (base64, miniatura à parte) e só sai pela API para loja dona, promotor, admin e a marca do pedido.
- **Pagamento só depois da execução**: `criarCobranca` e `finalizarPagamento` devolvem `409 execucao-pendente` enquanto `fase !== "executada"`.
- Loja define a localização (GPS ou coordenadas) em `POST /loja/localizacao`; a loja não consegue gravá-la direto no Firestore (regras).
- A loja audita a foto (`/auditarFoto`: aprovada/contestada com comentário).

## 2. Níveis e comissão progressiva
Bronze 25% (início) → Prata 20% (30 chamados) → Ouro 15% (+60 = 90) → Platina 10% (+100 = 190). A loja paga sempre R$ 200; muda só a divisão (R$ 150/160/170/180 ao promotor). A comissão é **fixada no aceite** (`nivelAceite`, `comissaoPct`) e usada no pagamento — subir de nível depois não altera turnos já aceitos. O chamado conta no check-out. **Inatividade:** 60 dias sem concluir ⇒ rebaixa 1 nível por período (`INATIVIDADE_MODO="rebaixar"`; `"resetar"` volta ao Bronze), aplicada ao abrir o app, ao aceitar e pelo cron.

## 3. Vidas, multas e banimento
| Infração | Multa |
|---|---|
| Promotor desiste/cancela com < 12 h do início | R$ 30 |
| Promotor falta (sem check-in até 60 min após o início — detectado sozinho) | R$ 50 |
| Loja cancela com promotor escalado em < 12 h | R$ 40 |
| Loja ausente (reportada pelo promotor no local, após 20 min) | R$ 50 |
Cada infração = advertência + registro em `infracoes` (idempotente) = 1 coração a menos. **3ª ⇒ banimento automático:** claim `banido`, sessões revogadas, `profissionais.status="bloqueado"`, turnos futuros devolvidos à fila; o servidor responde `403 conta-banida` em tudo, exceto `GET /reputacao`, que alimenta a **tela vermelha** com o motivo. Admin revoga infração (devolve multa e vida) e desbane (aba "Infrações"). Multa de promotor é debitada na carteira (ledger); multa de loja fica registrada como `pendente` (cobrança manual — não há débito automático no cartão).

## 4. Chamado relâmpago
`POST /criarRuptura` (loja): bônus R$ 20/30/50 (somado ao total e repassado 100% ao promotor), expira em 30 min sem multa. Destinatários = promotores ativos, treinados, com alertas ligados (`POST /promotor/alertas`), posição ≤ 24 h dentro de 5 km e categoria compatível. Aviso em tempo real no app (Firestore) + push FCM (melhor esforço).

## 5. Painel B2B (`marca.html`)
Papel `marca` vinculado por e-mail no admin (aba "Marcas"). A loja marca o pedido com a marca. `GET /b2b/painel` devolve KPIs, horas por região, % de gôndola cheia, ranking (gôndola cheia 40%, pontualidade 30%, nota 30%), promotores ao vivo, histórico de presença por GPS e fotos de auditoria (lightbox interna). Atualiza a cada 15 s (consulta ao servidor, não listener). Sem UIDs no payload; nomes abreviados.

## 6. Interface
`style-jogo.css` (dark + glassmorphism, corações que "quebram", medalhas, radar de GPS, alerta relâmpago, tela de banimento, `prefers-reduced-motion`), `geo.js`, `camera.js`, `gamificacao-ui.js`, `push.js`, `promotor-jogo.js`, `loja-jogo.js`, `marca.html/js`. Fotos abrem em lightbox interna; navegação toda dentro do app.

## Configuração
- **Cron (Render, a cada hora):** `POST /interno/manutencao` com `x-cron-secret` (libera carência, detecta faltas, expira relâmpagos, aplica inatividade). `/interno/liberar` continua funcionando.
- **Push:** gere a chave Web Push no Firebase (Cloud Messaging) e preencha `FCM_VAPID_KEY` em `config.js`. O app registra o token ao ligar os alertas.
- **Firestore:** `firebase deploy --only firestore:rules,firestore:indexes` (nova coleção `reputacao`, `infracoes`, índice `infracoes(uid, em desc)`).
- **Admin:** `node scripts/definir-admin.js`; depois, em "Marcas (B2B)", crie a marca e vincule o e-mail de quem a acompanha (a pessoa entra uma vez em `marca.html`).

## Limites conhecidos (leia)
1. **GPS pode ser falsificado** no aparelho (apps de mock location). O servidor valida precisão, idade da leitura, raio, janela, permanência e foto inédita, e registra tudo para auditoria — mas não há prova criptográfica de localização no navegador.
2. A **foto** não tem metadados de câmera garantidos (compressão no canvas). A defesa é o hash único, a permanência mínima e a auditoria da loja/marca.
3. **Multa de loja não é cobrada automaticamente** (só registrada); decisão de cobrar no cartão exige regra comercial/termos.
4. **Push FCM não foi testado** com dispositivo real (depende da chave VAPID e do navegador); o aviso em tempo real com o app aberto funciona sem ela.
5. O painel B2B atualiza por **polling (15 s)**, não por stream.
6. O raio de 5 km usa a **última posição informada** pelo promotor (renovada a cada 10 min com o app aberto).
7. Links externos que já existiam (suporte por WhatsApp, vídeo do YouTube do treinamento, CDN do QR) continuam; nada novo abre nova aba.
8. Local de teste: contas de sandbox ignoram advertências e janela de check-in.
