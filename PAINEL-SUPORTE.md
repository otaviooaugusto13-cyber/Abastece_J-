# Painel de Suporte ao Cliente (React/Next.js) + escalamento para TI/Gestão

Pasta `painel-suporte/` (front) + `server/lib/suporte-tickets.js` (back). Reaproveita o chat que já existia
(`suporte_conversas`, `suporte_mensagens`, `/admin/suporte/*`) e acrescenta **protocolo SP-…**, **escalamento** e a **ficha lateral**.

## Arquitetura
- **Leitura em tempo real**: listeners `onSnapshot` direto no Firestore (`suporte_conversas`, `suporte_mensagens`, `suporte_tickets`). Regras: só admin lê.
- **Escrita**: sempre pela API (valida, limita, audita, envia push). O navegador nunca escreve no Firestore.
- **Ficha**: `GET /admin/suporte/:uid/perfil` (CPF mascarado, consulta auditada). Pré-carga leve ao passar o mouse na conversa + cache = abre na hora.

## Endpoints novos (admin)
| Rota | O que faz |
|---|---|
| `POST /admin/suporte/:uid/ticket` | Devolve o ticket vigente ou abre um com novo protocolo (idempotente) |
| `POST /admin/suporte/:uid/resolver` | Marca o ticket como resolvido (próxima necessidade abre novo protocolo) |
| `POST /admin/suporte/:uid/escalar` | `{destino:"ti"\|"gestao", motivo, categoria, prioridade, avisarUsuario}` → cria chamado `TI-…` |

O chamado nasce em `chamados_ti` com `origem:"suporte"`, `filaDestino`, `suporteProtocolo`, `conversaUid`. Descrição = dossiê (conta, motivo, últimas mensagens);
a transcrição (até 60 mensagens) vai em **notas internas** (o usuário nunca vê). CPF, CNPJ, e-mail e telefone são ocultados no texto copiado.

## Modelo de dados
Ver `painel-suporte/modelo.ts`. Coleção nova: `suporte_tickets/{uid}` (admin lê; só o servidor escreve) e contador `contadores/suporte`.

## Atalhos
`Enter` envia · `Shift+Enter` quebra linha · `/` abre a busca de macros · `Alt+1…9` insere macro · `Alt+↑/↓` troca de conversa · `Esc` fecha ficha/diálogo.

## Ajustes de negócio (pontos de decisão)
- Textos das macros: `macros.js` (descrevem só o que a plataforma já faz; revise a redação).
- Metas de espera (amarelo 15 min, vermelho 60 min): `LIMITE_ATENCAO_MS` / `LIMITE_CRITICO_MS` em `logica.js`.
- O painel de TI atual (`ti.js`) ainda não mostra a coluna "fila" nem o protocolo SP-…; os dados já vêm em `visaoTI` (`fila`, `suporteProtocolo`).
- Deploy: publique `firestore.rules` (regra de `suporte_tickets`) junto com o servidor.

## Testes
`npm test` (inclui `test/suporte-escalar.test.cjs` e `test/painel-suporte.test.js`).
