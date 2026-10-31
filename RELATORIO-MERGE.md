# Relatório de unificação — Abastece Já (rodadas 2, 3 e 4)

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

---
## Rodada 4 — pacote "Abastece_Ja_atualizado" (execução com foto, níveis, multas/banimento, relâmpago, B2B)
Linha paralela que descende do **original** (não tinha login por sessão, admin novo, recados, treinamento com provas nem ofertas por GPS). Merge 3-way: original × árvore unificada × pacote. **Tudo foi integrado e está ativo:**

| Recurso | Onde | Observação |
|---|---|---|
| Check-in com geofence (100 m) + check-out com **foto** + **pagamento só após a execução** | `server/rotas/execucao.js`, `promotor-jogo.js`, `camera.js` | Substitui a presença "soft" da v2 (`/turnos/:id/checkin`, removida para não haver atalho sem GPS/foto). A nova grava também os campos legados (`checkinEm`, `checkoutEm`, `trabalhadoMin`, `divergencias`) — o admin continua mostrando atrasos. |
| Níveis (Bronze→Platina), comissão progressiva, vidas | `server/lib/reputacao.js`, `split.js`, `gamificacao-ui.js` | Loja paga sempre R$ 200; promotor R$ 150→180, plataforma R$ 50→20. |
| Multas, advertências e **banimento automático** | `server/rotas/reputacao.js`, admin → *Infrações e multas* | Revogar devolve multa e vida; desbanir zera advertências. Tudo auditado. |
| Chamado **relâmpago** (bônus, raio, push) | `server/rotas/ruptura.js`, `push.js`, cartões ⚡ nas ofertas | Aparece no topo das ofertas com contagem regressiva; expira sozinho. |
| **Painel B2B de marcas** | `marca.html`, `server/rotas/b2b.js`, admin → *Marcas (B2B)* | Cada marca vê só os seus pedidos. |

### Conciliações feitas
- **Localização da vaga:** um modelo só — o do pacote (`contratantes.localizacao` gravada só pelo servidor; vaga com `local` e `regiao`). Removi a minha versão (campos soltos `lat/lng/cidade` gravados pela loja e UI por cidade), porque o check-in de 100 m exige o **GPS exato** da loja. A tela de ofertas do promotor passou a ler `local/regiao` (e mantém o centro da cidade como fallback do **promotor**, não da loja).
- **`geo.js`:** os dois arquivos viraram um (cidades/raio/contadores + `distanciaM`, `lerGPS`, `vigiarGPS`).
- **Admin:** base v2+n3 mantida; abas *Infrações e multas* e *Marcas (B2B)* portadas para o painel novo (`ax-*`).
- **Entrar/sessão/banido:** o bloqueio por banimento entra no fluxo `resolverAcesso` (tela vermelha sem derrubar a sessão).
- **Lacuna fechada:** conta de **marca** que entrasse por engano no portal de loja/promotor podia "criar cadastro" e perder o papel `marca`. Agora `/cadastro/*` responde 409 e `/sessao` orienta para `/marca.html` (teste novo).
- Config do servidor tinha duas chaves `GEO` (a minha e a do pacote); ficou uma. Cabeçalhos: `camera=(self)` + `geolocation=(self)`. `sw.js` v10.

### Resultado dos testes
paridade ✓ · **13** front · **54** backend · **21** funcionalidades avançadas. 4 testes meus foram reescritos para o modelo único de localização; 1 novo (conta de marca).

### Para pôr no ar
1. `firebase deploy --only firestore:rules,firestore:indexes` (coleções `reputacao`, `infracoes`, índice `infracoes(uid, em desc)`).
2. Render: definir `CRON_SECRET` (cron horário chama `POST /interno/manutencao`: libera carência, detecta faltas, expira relâmpagos, aplica inatividade).
3. Push: gerar a chave Web Push no Firebase e preencher `FCM_VAPID_KEY` em `config.js` (sem ela os alertas funcionam só com o app aberto).
4. **Toda loja precisa cadastrar o GPS** (Dados da empresa → localização) antes de pedir; sem isso o pedido responde `localizacao-obrigatoria`.
5. Conferir a margem do Mercado Pago no nível Platina (R$ 20 por diária) e revisar os **termos de uso** para multas/banimento automáticos (com canal de contestação).
**Não testado em navegador/Firestore reais nem em aparelho (câmera, GPS, push).**
