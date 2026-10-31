# Unificação definitiva — Abastece Já (v5)

Merge de 3 vias (git) de **9 pacotes** em um só projeto. Ancestral comum: `unificado-v3`.

| Origem | O que entrou |
|---|---|
| **unificado-v3** (base) | Admin novo, sessão/login, CPF duplicado, edição/exclusão, cursos, perfil inteligente |
| **main_2** | Habilitação por categoria, taxas dinâmicas, suporte (chat + push), prova por módulo, financeiro/auditoria ao vivo |
| **com-módulo-TI** | Painel de TI (`/painel-ti`): operadores, auditoria encadeada por hash, chamados, SLA, presença |
| **suporte-refatorado** | Perfil 360 no atendimento do admin (aplicado sobre main_2) |
| **Correção login/cadastro** | `fmtHoras` (login da loja), campos CPF/nascimento, botão "Criar conta", CPF/nascimento no servidor |
| **teste_eneagrama** | Eneagrama automático (import CSV/JSON, link assinado, `server/lib/eneagrama.js`) |
| **multas (v4)** | Check-in geofence + foto, níveis, vidas/multas/banimento, relâmpago, painel B2B |
| **files** | `scripts/auditoria-ui.mjs` e `docs/PLANO-YOUTUBE-E-QA-UI.md` |

## Conflitos reais e decisões
- **`calcularDiaria`** (taxas dinâmicas × níveis): nova assinatura `calcularDiaria(cfg, nivel, bonus)` no servidor e `calcularDiaria(nivel, bonus)` no navegador (usa `TAXAS`). A comissão do Bronze é a **vigente** (editável no admin); Prata/Ouro/Platina escalam (20/25, 15/25, 10/25). Com o padrão: R$ 50/40/30/20. O split congelado no pedido guarda `comissaoBase` e é reconstruído por `cfgDoSplit` (pagamentos, aceite e desistência).
- **Check-in/out**: vale o novo (GPS 100 m + foto). A rota antiga `/turnos/:id/checkin` foi removida (atalho sem GPS/foto) e seu teste substituído pelos de `jogo.test.cjs`.
- **Segurança**: `autenticarLeve` (presença TI) + `exigirMesmoBanido`; `camera=(self)` e `geolocation=(self)`.
- **Push**: `push.js` exporta `ativarPush/desativarPush` (suporte) e `obterTokenPush` (relâmpago); `sw.js` trata os dois tipos num só handler.
- **Treinamento/categorias**: vale o modelo da linha main_2 (habilitação por categoria, 9 setores). Aceitar turno exige habilitação também nos chamados relâmpago.
- **Rotas/regex/cache**: união nas listas de `server.js` e `sw.js` (versão `abastece-v11`); índices Firestore unidos (+`infracoes`); regras unidas (TI + reputação/execução/marcas).
- **Login/CPF/edição-exclusão/sessão/redirecionamentos**: nenhum desses arquivos foi sobrescrito; correções de todos os pacotes preservadas.

## Verificação
`node --check` em todos os `.js`; sem marcadores de conflito; imports × exports e arquivos referenciados no HTML conferem; testes: split ✓ · perfil 12/12 · backend 84 · TI 26 · jogo 21 · eneagrama 13. A auditoria de UI só acusa ids criados por JS (falsos positivos, idênticos aos da v4).
**Não testado** em navegador, Firestore, Mercado Pago, câmera/GPS/push reais.

## Para subir
1. `firebase deploy --only firestore:rules,firestore:indexes` (índices do TI e de `infracoes` levam minutos).
2. Render: `CRON_SECRET`, `BLIND_INDEX_KEY`; cron horário em `POST /interno/manutencao`; `FCM_VAPID_KEY` em `config.js`.
3. `node scripts/semear-categorias.js`; `node scripts/criar-operador-ti.js "Nome" email gestor`; `node scripts/definir-admin.js`.
4. Toda loja cadastra o GPS antes de pedir; TTL em `eneagrama_resultados.expiraEm`.
5. Revisar mapeamento de setores no Eneagrama, margem do Platina e termos de uso (multas/banimento).
