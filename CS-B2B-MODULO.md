# Módulo CS & B2B — Sucesso do Cliente & Expansão

Painel `/painel-cs` (React + TypeScript + Recharts, dark mode) e API `/cs/*`, na stack existente (Express + Firestore).
Fonte TypeScript em `cs/`; o servidor roda o JS compilado em `server/lib/cs/` (já incluído; recompile com `npm run cs:compilar`).

## Colocar no ar
1. `firebase deploy --only firestore:rules` (9 coleções `cs_*` novas, todas deny-all: só a API acessa). **Não há índice composto novo.**
2. `npm install` (novas deps: `pptxgenjs` em `package.json` e `server/package.json`).
3. Front: `cd cs/web && npm install --include=dev && npm run build` → gera `cs-app/` (o Express serve em `/painel-cs`). Sem esse build a rota `/painel-cs` responde 404.
4. Render: o `render.yaml` ganhou o cron `abastece-cs` (a cada 15 min → `POST /interno/cs-manutencao`, mesmo `CRON_SECRET`/`APP_URL` do cron atual).
5. Acesso: papel **admin** (herda `ADMIN_EXIGE_MFA`). Lojas usam o mesmo `/painel-cs` só para recorrências e NPS.
`npm test` agora roda também `test/cs.test.cjs` (26 testes).

## As 15 funcionalidades
| # | Funcionalidade | Onde |
|---|---|---|
| 1 | Fill rate | Visão geral · `agregacao.fillRate` |
| 2 | Vagas desatendidas (X h) | Operação · alerta persistido + push no cron · `alertaVagaHoras` |
| 3 | CSAT | Visão geral · derivado de `solicitacoes.avaliacao` (sem coleção nova) |
| 4 | Contas-chave | Contas-chave · `cs_redes` + `cs_lojas.redeId` |
| 5 | Economia gerada (ROI) | Visão geral · estimativa (ver premissas) |
| 6 | Ruptura evitada | Visão geral · estimativa (ver premissas) |
| 7 | Solicitações recorrentes | Painel da loja · `cs_recorrencias` → cron cria pedidos reais |
| 8 | Pontualidade | Operação · tolerância `toleranciaPontualMin` |
| 9 | Créditos e faturamento B2B | Faturamento B2B · razão `cs_faturamento_lancamentos` |
| 10 | Marcas parceiras | Marcas · usa `marcaId` dos pedidos |
| 11 | NPS B2B | NPS · cron dispara; loja responde em `/painel-cs` |
| 12 | Ficha da loja | Lojas · endereço, acesso, gerente, fotos (≤6), histórico |
| 13 | Setores | Visão geral · Mercearia, Frios, FLV, Depósito, Padaria + demais |
| 14 | Churn | Retenção · limite `inatividadeDias` (padrão 15) + ação preventiva |
| 15 | Exportador executivo | Exportar · PPTX, HTML (imprime em PDF), CSV |

## Definições (fixas)
- **Fill rate** = concluídas ÷ encerradas. *Encerrada*: turno no período, já terminou, status ≠ cancelada. *Concluída*: check-out feito ou paga. Lacuna = `semPromotor` + `faltaPromotor` (aceitou e não executou). *No prazo*: check-in ≤ tolerância.
- **CSAT**: média 1–5 e % de 4–5★. **NPS** = %9–10 − %0–6.
- **Churn**: ≥ limite = risco; ≥ 2× = crítico; ≥ 60% = atenção. Loja que nunca criou missão entra se o cadastro passou do prazo.
- **Faturamento**: usa só `solicitacoes_financeiro.total` (o que a *loja* paga). Pré-pago: saldo = créditos − consumo − comprometido (missões abertas/aceitas futuras). Pós-pago: uso do ciclo ÷ limite. O razão é imutável: correção = lançamento "ajuste".
- Repasse, comissão e nomes completos de promotores **nunca** entram no painel/relatório do cliente.

## Premissas editáveis (`PUT /cs/config`, defaults em `cs/tipos.ts`) — VALIDE COM O NEGÓCIO
ROI: contratado custa R$ 3.600/mês, 44 h/sem, 80% produtivo; o time fixo é dimensionado pela **semana de pico de cada loja** (mín. 1). Economia pode ficar negativa (uso contínuo alto) e o painel mostra assim.
Ruptura: confirmadas = chamados relâmpago concluídos; estimadas = 25% das reposições regulares com gôndola cheia; 150 itens/h; venda preservada só é calculada se `receitaPorRupturaCentavos > 0`.

## API
Admin: `GET /cs/painel|contas|marcas|faturamento|nps|lojas|lojas/:uid|alertas|config|redes|exportar` · `POST|PUT /cs/redes`, `PUT /cs/redes/:id/lojas` · `PUT /cs/lojas/:uid` · `POST|GET|DELETE /cs/lojas/:uid/fotos` · `POST /cs/lojas/:uid/interacoes`, `PUT /cs/interacoes/:id/concluir` · `PUT /cs/faturamento/:redeId`, `POST …/lancamentos`, `PUT …/lancamentos/:id/paga` (login recente) · `POST /cs/nps/disparar` · `PUT /cs/config`.
Loja: `GET|POST|DELETE /cs/loja/recorrencias` · `GET /cs/loja/nps/pendente`, `POST /cs/loja/nps/:id/responder`.
Cron: `POST /interno/cs-manutencao` (header `x-cron-secret`). Toda escrita do admin vai para `auditoria` (`cs.*`).

## Limites conhecidos
- Cada consulta lê até 20 mil `solicitacoes` (janela de 125 dias, cache de 45 s) e avisa se truncar. Para volume maior, mover para agregados diários como o módulo de TI.
- O faturamento B2B é **visibilidade e razão**: não cobra nem debita. As regras atuais (cartão obrigatório para pedir) continuam valendo; pré/pós-pago real exige decisão de negócio e integração de cobrança.
- Marcas: não há valor de patrocínio modelado, só missões associadas.
- Recorrências nascem ~14 dias antes (parâmetro), exigem cartão ativo e respeitam o Master Switch; falha vira alerta para o CS.
- Testado: agregações, rotas, exportadores (PPTX validado como zip, sem conferência visual) e o app React num navegador real com Recharts *simulado* e API simulada. **Não testado:** `vite build` e Recharts reais (sem rede no ambiente de desenvolvimento).
