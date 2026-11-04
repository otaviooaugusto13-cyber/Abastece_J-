# Relatório da unificação — v7 (linha v6)

Entrada: 7 zips (`unificado-v6`, `main (10)`, `admin-root`, `roteador-raio`, `roteador-chamados`, `files` = painel de suporte, `filess_v2` = bugs/saúde/SLA).

## Como as versões se relacionam (descoberto nos arquivos)
- `main (10)` e `admin-root` são **idênticos** → um só ramo: **Admin Root** (`ROOT-ADMIN.md`, `painel-root`, `lib/root.js`, `lib/operacao.js`).
- `files.zip` = `main (10)` + **painel de suporte** (tickets, escalar p/ TI, reputação) — `PAINEL-SUPORTE.md`, `painel-suporte/`.
- `filess_v2.zip` = **bugs / saúde / SLA** (auto-bug com alcance, healthcheck, relatório redigido) + um `.patch` (já aplicado no zip).
- `roteador-chamados` e `roteador-raio` nasceram do mesmo ancestral **sem** o Root (por isso "removem" os arquivos do Root se comparados ao `main (10)` — não é remoção, é que são irmãos). Reconstruí esse ancestral comum (maioria entre os 3 ramos; `server.js` refeito tirando só as linhas do Root) e fiz merge de três vias de cada ramo contra ele.

## O que entrou
| Ramo | Resultado |
|---|---|
| Root + painel de suporte | tronco |
| bugs / saúde / SLA | mesclado (2 conflitos de fiação resolvidos) |
| roteador-chamados | mesclado (roteador, despacho por push/webhook, aba Chamados, transferência entre departamentos) |
| roteador-raio | **parcial, de propósito**: entrou o **mapa de promotores online** + **promotor online** + CSP do Leaflet + abertura de chamado por erro de negócio (`CODIGOS_COM_CHAMADO`). **Não entrou** o roteador dele nem o raio dinâmico próprio (duplicados) |

## Decisões
1. **Dois roteadores de chamados** (raio e chamados) faziam a mesma coisa. Fiquei com o `roteador-chamados` (mais completo: despacho, webhooks, aba de admin, transferência).
2. **Duas configurações de raio** (Root: `configuracoes/operacao`, 1–50 km; raio: `configuracoes/raio`, 1–100 km). Fiquei com a do **Admin Root** (controle de acesso mais forte; o relâmpago já a respeita). O mapa lê o raio de `operacao`. Removidos: `PUT /admin/raio`, `GET /config/raio`, o slider do admin e 3 testes que só testavam isso.
3. **Prioridade do chamado automático** (regras diferentes nos dois ramos): na fila de **TI** vale o classificador de bugs (alcance + fluxo financeiro; "falha tratada" = baixa); em **ADM/Suporte**, a do roteador. O roteador pode elevar a "alta"; o alcance eleva a "crítica" em qualquer fila. **Decisão de produto: confirme.**
4. O selo `[AUTO-BUG]` só aparece na fila de TI.

## Verificação
12 suítes (`npm test`): split, perfil, backend, **ti (50)**, jogo, eneagrama, erros, bugs, roteador, **mapa (adaptado ao Root)**, suporte-escalar, painel-suporte → **todas passam**. Sintaxe, importações × exports, IDs, 0 rotas duplicadas, 0 segredos. Os ramos originais também passavam sozinhos (conferi), então qualquer falha apareceria no merge.
**Não testado:** navegador/celular, Firebase real, Mercado Pago, Render, Leaflet/GPS reais, push, webhooks de chamados.

## NÃO incluído nesta versão
O conteúdo do meu `unificado-v2` (loja-10 funcionalidades, Fase 5, main (6), `termos.html`) **não está na linha do v6**. Para trazê-lo é preciso um merge à parte (3 conflitos de regra com o que o v6 já decidiu: relâmpago × urgência, níveis, check-in).

## Depois de subir
Deploy das regras e dos **índices** do Firestore (`firebase deploy --only firestore:rules,firestore:indexes`); `ROOT_BOOTSTRAP_EMAIL` para o primeiro root; `CHAMADOS_WEBHOOK_ADM` / `CHAMADOS_WEBHOOK_SUPORTE` se quiser aviso por webhook; Leaflet carrega do cdnjs (CSP já ajustada).
