# Relatório de unificação — Abastece Já (rodadas 2 e 3)

**Base comum:** repositório original. **Versões unificadas:**
- **v2** — acesso/sessão, admin novo (`ax-*`), check-in/out, recados, `definir-admin`.
- **"corrigido" (n3)** — v2 + `entrada.js` (tela Entrar × Criar conta), CPF duplicado com opções, edição/exclusão e rótulos no admin, ajustes de sessão/regras.
- **pacote do admin (n2)** — treinamento com trilhas por categoria e **provas com nota mínima**, financeiro com KPIs/filtros/paginação, **auditoria ao vivo** e auditoria de exportações. *(O zip "Abastece_J--main (2) (1)" era idêntico à v2 — nada a mesclar.)*
- **B (minha rodada anterior)** — Cursos, perfil Eneagrama, ofertas por GPS/20 km.

**Resultado:** paridade ✓ · **12/12** front · **53/53** backend (31 originais + 8 da B + 6 da v2 + 7 do n3 + 1 novo de prova; 2 testes meus de cursos reescritos para o motor do n2).

## Decisões
| Área | Decisão |
|---|---|
| Treinamento (servidor) | **Motor do n2 vence** (superset: categoria, obrigatório, provas). Reaplicado: lista única de categorias em `config.js`, resumo `opcionais`, `obrigatorio` na resposta do ping. Meu esquema "habilitacao/forçar categoria" foi descartado. |
| Categorias | Taxonomia única (`CURSO_CATEGORIAS`): **geral, mercearia, hortifruti, padaria, frios, deposito** (n2) + **perdas, atendimento, seguranca, carreira** (B, aditivas). `cursos.js`, admin e servidor usam a mesma lista (teste de paridade). |
| Admin | Base = v2+n3 (recados, edição/exclusão, sessão). Portados do n2: editor de treinamento com provas, financeiro (KPIs, filtros, "saque parado"), auditoria ao vivo (auto-atualiza a cada 15 s) e registro de exportações; rotas `POST /admin/auditar-exportacao` e `GET /admin/financeiro/resumo` adicionadas ao servidor. Rótulos de auditoria completados (recado, editar/excluir, perfil inteligente). |
| Promotor | Aba Treinamento = módulos obrigatórios por categoria; **Menu → Cursos** = tudo por categoria. Os dois usam o mesmo cartão (`cartaoCurso`) com status da prova; modal `sheet-prova` do n2. |
| Check-in/out | v2 e n2 tinham o mesmo código; mantido **uma** cópia (sem duplicar). |
| Entrar/Criar conta, CPF duplicado | n3 integral; botão "Falar com suporte" abre WhatsApp por ação explícita (teste de links externos ajustado para aceitar `wa.me`). |
| `sw.js` | Lista unida (inclui `entrada.js`, `geo.js`, `perfil-inteligente.js`, `cursos.js`); versão `abastece-v9`. |
| Segurança | `geolocation=(self)` mantido (necessário para ofertas e check-in). |

## Correção feita durante o merge
Um `=======` solto no `style.css` (resto de conflito) invalidaria a regra seguinte — removido; chaves balanceadas (348/348).

## Conferência dos pontos críticos
Login/sessão/redirecionamento, CPF duplicado, edição/exclusão no admin: código do v2+n3 intacto e testado. Todos os `.js` passam em `node --check`; IDs do JS existem nos HTMLs (promotor, loja, admin); zero marcadores de conflito.

## Pendências suas
Publicar regras (`firebase deploy --only firestore:rules`); lojas preencherem a cidade; revisar tabela de cidades e afinidade do Eneagrama; conferir no admin os cursos que já existem (módulos antigos viram categoria `geral`, obrigatórios — comportamento anterior); decisões jurídicas do `MUDANCAS.md`. **Não testado em navegador/Firestore reais.**

---
## Rodada 3 — dois zips novos (`Abastece_J--main (4)` e `(4) (1)`)
Os dois descendem da **minha primeira unificação** (72 arquivos idênticos a ela); só o admin mudou:
- **`(4)`** trazia `admin.html`/`admin.js` **idênticos ao admin original** (o mais simples: `prompt()`, sem recados, edição, exclusão, KPIs ou provas). Aplicar isso seria **regressão** → descartado, mantido o admin unificado.
- **`(4) (1)`** trazia o admin unificado da v2 com **duas melhorias novas**, ambas portadas:
  1. **Encerrar sessões** (botão na ficha de promotor e de loja → `POST /admin/usuarios/:uid/revogar-sessoes`, que já existia no servidor e grava na auditoria).
  2. **Tocar na chave Pix copia** (aba Saques) + estilo em `admin.css`.
- Portadas sobre o admin atual (com edição/exclusão, recados, provas, financeiro, auditoria ao vivo), sem sobrescrevê-lo. Novo teste de ligação front↔servidor. **13/13 front · 53/53 backend.**
