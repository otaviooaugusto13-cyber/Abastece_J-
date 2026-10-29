# Relatório de unificação — Abastece Já

**Base comum:** repositório original · **Versão A (v2):** zip "Abastece_J--main (2)" (acesso/sessão, admin novo, check-in/out, recados, definir-admin) · **Versão B:** Cursos + perfil Eneagrama + ofertas por GPS/20 km.
**Resultado:** `npm test` → paridade ✓ · 12/12 front · **45/45 backend** (31 originais + 8 da versão B + 6 da v2).

## Arquivos e decisão
| Arquivo | Origem | Decisão |
|---|---|---|
| `acesso.js`, `recado.js`, `admin.css`, `server/rotas/turnos.js`, `server/definir-admin.js`, `scripts/definir-admin.js`, `server/rotas/admin.js`, `server/server.js` | v2 | Mantidos integralmente (só a v2 mexeu). |
| `geo.js`, `perfil-inteligente.js`, `cursos.js`, `INTEGRACAO.md`, `test/perfil.test.js`, `server/lib/treinamento.js`, `server/lib/config.js`, `server/rotas/pedidos.js`, `firestore.rules`, `style.css`, `promotor.html`, `index.html`, `config.js` | B | Mantidos integralmente (só a B mexeu). |
| `admin.html`, `admin.js` | **conflito** | v2 vence (reescrita completa, abas e KPIs). Reaplicado sobre ela o que a B precisava: categoria do curso, "obrigatório", coluna "Tipo" (ids `t-cat`, `t-obrig`). |
| `script-personal.js` | **conflito (2)** | Imports somados (v2: `acesso.js`, `recado.js`, sem `papelAtual`; B: geo/perfil/cursos/config). Bloco de Cursos/Eneagrama + bloco de check-in/out convivem. Fluxo `entrar()` da v2 preservado; chamadas da B (`carregarPerfilIA`, `iniciarGeo`) acrescentadas ao final dele. |
| `script.js` (loja) | automático | v2 (acesso/recado) + B (cidade/GPS da loja). |
| `server/rotas/conta.js` | **conflito** | As duas rotas novas coexistem: `PUT/GET /perfil/promotor/inteligente` (B) e `POST /perfil/recado/lido` (v2). |
| `server/lib/seguranca.js` | automático | v2 + `geolocation=(self)` (B). Corrige de quebra o check-in da v2, que usa GPS e estava bloqueado por `geolocation=()`. |
| `sw.js` | **conflito** | Lista de pré-cache unida (`geo.js`, `perfil-inteligente.js`, `cursos.js`, `acesso.js`, `recado.js`); versão `abastece-v7` (invalida o cache antigo). |
| `test/backend.test.cjs` | **conflito** | Testes das duas versões somados. |

## Itens críticos que você pediu — conferência
- **Login, sessão e redirecionamento loja/promotor:** `resolverAcesso("promotor"|"loja")`, tela de escolha de perfil e falha temporária (v2) intactos em `script.js` e `script-personal.js`; testes de `/sessao` da v2 passando.
- **CPF duplicado, edição/exclusão no admin:** vêm da v2 sem alteração (`server/rotas/admin.js`, `server/rotas/conta.js`, `admin.js`); testes da v2 passando.
- **Sem variáveis/imports duplicados:** todos os `.js` passam em `node --check`; nenhum marcador de conflito restou.

## Pendências suas (inalteradas)
Publicar regras (`firebase deploy --only firestore:rules`); lojas preencherem a cidade; revisar tabela de cidades e a afinidade do Eneagrama; decisões jurídicas/comissão listadas no `MUDANCAS.md` da v2. Não testado em navegador/Firestore reais.
