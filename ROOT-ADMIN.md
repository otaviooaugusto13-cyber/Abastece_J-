# Admin Root

Topo da hierarquia: só quem tem a custom claim **`is_root: true`** (e papel admin) altera raio de atendimento, Master Switch e taxas. Admin comum continua lendo, mas **não escreve** (403 `sem-root`).

## Dados (Firestore)
| Coleção/doc | Quem lê | Quem escreve | Conteúdo |
|---|---|---|---|
| `configuracoes/operacao` | ninguém (só API) | só servidor | `raioKm` (1–50), `master{cadastros,missoes,pagamentos}` (`true` = ligado), `motivoPausa`, `versao`, `atualizadoEm/Por` |
| `config_publica/operacao` | qualquer logado | só servidor | espelho: `raioKm`, `cadastros`, `missoes`, `pagamentos`, `versao`. Gravado **na mesma transação** que a fonte |
| `configuracoes/taxas` | ninguém (só API) | só servidor | já existia (centavos; comissão + repasse = diária) |
| `root_auditoria/{seq}` + `root_auditoria_cadeia/estado` | ninguém (só API) | só servidor | trilha append-only encadeada por hash |

Tipos TypeScript: `painel-root/tipos.ts`.

## API (todas exigem token válido não revogado + admin + `is_root`)
- `GET /root/painel` — operação + taxas (com limites/padrão)
- `PUT /root/operacao` `{ raioKm, versao }` — exige login recente
- `PUT /root/master` `{ cadastros?, missoes?, pagamentos?, motivo, versao }` — **pausar** não exige login recente (botão de pânico); **religar** exige. Pausar exige `motivo` (≥ 5 caracteres)
- `PUT /root/taxas` (e o antigo `PUT /admin/taxas`, agora também só Root) — mesmo contrato de antes, em centavos; exige login recente
- `GET /root/auditoria?acao=&resultado=&limite=&cursor=` · `GET /root/auditoria/verificar`
- `GET /config/operacao` — público (sem motivo nem autor)

## Tempo real
Servidor: `lib/operacao.js` mantém cache por `onSnapshot` (ms) + TTL de 30 s de garantia; `operacao.exigir("cadastros"|"missoes"|"pagamentos")` barra a rota com **503 `operacao-pausada`**.
Cliente: `script-personal.js` assina `config_publica/operacao`; `geo.js` exporta `RAIO_KM` como *live binding* (`definirRaioKm`), então "Perto de mim" e o radar se redesenham sem recarregar.

## O que cada interruptor barra
- **cadastros**: `POST /cadastro/loja`, `POST /cadastro/promotor`
- **missoes**: `POST /criarPedido`, `POST /criarRuptura`
- **pagamentos**: `POST /criarCobranca`, `POST /carteira/saque`
- **Não barra de propósito**: `/webhookMP` e `/confirmarPagamento` (dinheiro que o Mercado Pago já moveu precisa ser registrado; barrar faria a notificação se perder). Se preferir, adicione `operacao.exigir("pagamentos")` nessas rotas.
- Rotas do Root e do admin nunca são barradas (o Root não pode ficar trancado para fora).

## Raio — onde vale
- App do **promotor**: lista "Perto de mim" e radar (cliente, em tempo real).
- **Chamado relâmpago**: alcance do push = `min(5 km, raio)`: o Root só pode apertar, nunca passar de 5 km.
- Limite honesto: o filtro da lista é de cliente (como já era com os 20 km fixos). O servidor não sabe onde o promotor está na hora de aceitar; para impor no servidor seria preciso enviar a posição em `/aceitarTurno`. O app da **loja** deste repositório não tem mapa de promotores, então não há o que filtrar ali; `GET /config/operacao` está disponível para quando houver.

## Auditoria
Cada alteração grava **antes** (`solicitado`, com antes/depois propostos) e **depois** (`aplicado` ou `falhou`). Se a trilha estiver fora do ar, **nada é alterado** (503 `auditoria-indisponivel`). Cada registro leva uid, e-mail, nome, **IP** (`req.ip`, real atrás do Render), user-agent, rota, request-id, timestamp do servidor e `hash = sha256(hashAnterior | conteúdo)`. Adulterar/apagar um registro quebra a cadeia: `GET /root/auditoria/verificar`.
Limite honesto: o servidor (credencial admin do Firebase) tecnicamente consegue reescrever o banco; a cadeia **detecta**, não impede. Para imutabilidade de fato, exporte periodicamente para um bucket com *retention lock* (ou guarde o hash da cabeça da cadeia fora do Firestore).

## Como virar Root
1. Conta já admin (`ADMIN_BOOTSTRAP_EMAIL`), e-mail verificado.
2. No Render: `ROOT_BOOTSTRAP_EMAIL=seu@email` → reiniciar → sair e entrar de novo no painel → **remover a variável**.
3. Revogar Root: remova `is_root` das claims dessa conta (Firebase Admin `setCustomUserClaims`) e `revokeRefreshTokens`.

## Testes
`node test/backend.test.cjs` (97/97; 7 testes novos de Root). `npm test` roda todas as suítes.

## Front React
`painel-root/RootAdminPanel.jsx` (Tailwind). Não é servido pelo Express (só serve .html/.js/.css…): copie para o seu app Next/Vite e passe `getToken`, `apiBase` e, opcionalmente, `onReautenticar`. Se o app Next ficar em outro domínio, adicione a origem em `ORIGENS_PERMITIDAS`.
