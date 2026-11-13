# Relatório UAT — Abastece Já (build Abastece_J--main__1_.zip)

**Escopo real executado:** análise estática + suíte automatizada + sondagem das rotas com ambiente falso (sem rede, sem Firebase real, sem navegador/dispositivo). Não foi possível validar sincronia real web×app, tempo real do Firestore nem renderização em celular.

## Resultado da suíte (`test/*`)
Todos os testes existentes passam (backend 97, TI 50, CS 26, vagas 39, jogo 22, perfil 14, mapa 9, roteador 9, etc.). `verificar-integridade`: OK. `auditoria-ui`: 0 críticos, 5 altos, 12 médios.

## Matriz de bugs
| ID | Gravidade | Descrição |
|----|-----------|-----------|
| UAT-01 | **Crítica** (corrigida no HF1) | Envio de RG/CNH sem backend: `documento.js` (front) chama `GET /perfil/documento` e `POST /perfil/documento/:lado`, mas `server/rotas/documento.js` e `server/lib/documento.js` só existiam em `mnt/user-data/outputs/abastece-ux-patch/…` (pasta enviada por engano no zip) e não eram montados em `server.js`. **Passos:** logar como loja/promotor → Conta → enviar documento. **Esperado:** upload aceito e status "em análise". **Obtido:** 404 `rota-inexistente`. Painel Admin de aprovação também sem rota. |
| UAT-02 | **Alta** | `npm test` falha no último passo: `test/documento.test.cjs` não existe. A cobertura do fluxo de documento (upload, auditoria de leitura, decisão do admin) está ausente. |
| UAT-03 | **Média** | Pasta `mnt/user-data/outputs/…` e `alteracoes-em-arquivos-existentes.patch` dentro do pacote: lixo de build que vai para o deploy e é servido por `express.static`. Remover. |
| UAT-04 | Alta | `script-personal.js:179` — `chipNivel(n.id, n.nome)` no `innerHTML` sem `esc()` (risco de XSS se o nome vier de usuário). |
| UAT-05 | Alta | `script-personal.js:932` — `disabled = true` antes de `await` sem `finally`: após falha de rede o botão fica travado até recarregar. |
| UAT-06 | Alta | iOS dá zoom ao focar campos com fonte < 16px: `style-b2b.css:7` (select 13px) e `style.css:116` (input 15px). |
| UAT-07 | Alta | `style-b2b.css:33` — `.tabela` com largura fixa ≥ 600px estoura telas de 360px. |
| UAT-08 | Média | `sw.js`: `admin.js` e `ti.js` fora do precache (sem offline nesses painéis); `ti.html` usa classe `lg-cloud` sem CSS; `setInterval` sem `clearInterval` em `taxas.js:34`; z-index repetidos em vários CSS; vários `catch` vazios sem comentário. |

## Pendente (não testado)
Jornada completa por persona em dispositivo real, sincronia web×mobile em tempo real, regras do Firestore/Storage contra o projeto real, push, pagamento Mercado Pago.

## Hotfix HF1 (`hotfix-HF1-documento.zip`)
- `server/lib/documento.js` e `server/rotas/documento.js`: copiados de `mnt/…/arquivos-novos/`.
- `server/server.js`: `"documento"` adicionado à lista de rotas.
- Verificação: `GET /perfil/documento`, `POST /perfil/documento/frente` e `GET /admin/documentos` passaram de 404 para 401 sem login; backend 97/97 e perfil 14/14 continuam verdes.
