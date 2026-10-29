# O que mudou nesta versão (e o que você precisa decidir)

## ⚠️ Pontos que exigem sua decisão
1. **"R$ 150 (80%)" não fecha.** R$ 150 ÷ R$ 200 = **75%** (comissão de **25%**). Implementei os **valores em reais** (200 / 50 / 150) como fonte da verdade. Se o certo for 80%, o repasse é R$ 160 e a comissão R$ 40: altere 3 constantes em `server/split.js` e `config.js` (o teste de paridade avisa se divergirem).
2. **Menores de 16–17 anos — jurídico.** O código implementa travas técnicas (autorização do responsável registrada, só turnos 05h–22h, setores vedados: *Frios & Laticínios, Bebidas, Montagem de ilhas*). **Isso não substitui parecer trabalhista**: a CLT/ECA e o Decreto 6.481/2008 (lista TIP) restringem trabalho de menores (noturno, insalubre, cargas pesadas, câmara fria), e um menor atuar como "autônomo" é juridicamente delicado. Revise a lista em `server/lib/config.js` → `MENOR` e `config.js` com seu advogado.
3. **Carteira própria = a plataforma custodia dinheiro de terceiros.** Troquei o *split* do Mercado Pago (o MP cobra a taxa dele do vendedor, então o profissional nunca receberia exatamente R$ 150) por **recebimento na conta da plataforma + carteira/ledger interno**. Isso pode exigir enquadramento regulatório (BCB/instituição de pagamento) ou uso de conta de pagamento de um parceiro. Consulte seu contador/jurídico.
4. **Turno mínimo de 4 h** foi uma suposição minha (diária fixa precisa de piso). Ajuste `HORAS_MIN_TURNO`/`HORAS_MAX_TURNO` (hoje 4–6 h).
5. **Carência de saque = 2 dias** (`LIBERACAO_DIAS`) e nunca antes da liberação do dinheiro pelo Mercado Pago.
6. **Vídeos do PRATICAMENTE:** não tenho os links/durações. Cadastre-os em **Admin → Treinamento** (YouTube ou URL https de mp4). Enquanto não houver módulo ativo, **ninguém aceita turno** (falha fechada, intencional).

## Requisitos → entrega
| Requisito | Entrega |
|---|---|
| Diária R$ 200 / R$ 50 / R$ 150 | `server/split.js` (+ espelho `config.js`/`core.js`), preço **nunca** vem do cliente |
| Carteira, conciliação, estornos, CSV | `server/lib/carteira.js`; rotas `/carteira`, `/carteira/saque`, `/admin/*`; CSV de profissional, loja e admin |
| Cadastro a partir de 16 anos | `lib/validacao.js` (servidor) + `core.js`/`promotor.html` (campo com `min/max`) |
| Treinamento PRATICAMENTE obrigatório | `lib/treinamento.js` + `lib/habilitacao.js` + claim `treinado` + regras do Firestore |
| Segurança / RBAC / criptografia | ver `SEGURANCA.md` |

## Fluxo do dinheiro
`Loja paga R$ 200 → (mesma transação) pedido "paga" + nota + [profissional +R$150 em carência] + [plataforma +R$50] → após carência: disponível → saque Pix (admin paga e registra comprovante) → estorno desfaz R$150 e R$50 (carteira pode ficar negativa, sinalizada)`.

## Arquivos
- **Novos:** `server/lib/*` (config, cripto, validacao, csv, seguranca, carteira, treinamento, habilitacao), `server/rotas/*`, `admin.html/js`, `pagar.js`, `nota.js`, `landing.js`, `firestore.indexes.json`, `scripts/*`, `test/backend.test.cjs`, `test/fake-env.cjs`, `SEGURANCA.md`.
- **Reescritos:** `server/server.js`, `server/split.js`, `firestore.rules`, `config.js`, `core.js`, `firebase.js`, `script-personal.js`, `promotor.html`, partes de `script.js`/`index.html`/`landing.html`.
- **Removidos:** `functions/`, `index.js`, `split.js`, `split.test.js` da raiz (cópias legadas e divergentes do backend, com lógica antiga e sem as defesas). O fluxo OAuth do Mercado Pago do profissional também saiu.

## Subir em produção (ordem)
1. `npm run gerar-chaves` → colar as variáveis no Render (**guarde backup das chaves**). Definir `AMBIENTE=producao`, `MP_ACCESS_TOKEN` (conta da plataforma), `MP_WEBHOOK_SECRET`, `APP_URL`, `CRON_SECRET`, `FIREBASE_SERVICE_ACCOUNT`.
2. Mercado Pago → Webhooks: URL `https://SEU-APP/webhookMP`, evento **Pagamentos**; copiar a assinatura secreta para `MP_WEBHOOK_SECRET`.
3. `firebase deploy --only firestore:rules,firestore:indexes` (**antes** de subir o app).
4. `npm run migrar` (simulação) → conferir → `npm run migrar -- --executar` (cifra dados antigos, concede papéis).
5. `node scripts/definir-admin.js seu@email.com`; ativar MFA no Firebase Auth (Identity Platform) e `ADMIN_EXIGE_MFA=1`.
6. Entrar em `/admin.html` → cadastrar os módulos do PRATICAMENTE → aprovar profissionais.
7. Render Cron (a cada hora): `POST /interno/liberar` com cabeçalho `x-cron-secret` (também libera sob demanda quando o profissional abre a carteira).
8. Rodar `npm test` e o checklist de pentest de `SEGURANCA.md`. Pedidos abertos do modelo antigo serão cobrados pela diária nova — feche-os antes do deploy.

---
## Correção de onboarding, sessão e admin (esta entrega)
| Problema | Causa encontrada | Correção |
|---|---|---|
| CPF duplicado trava o cadastro | só havia mensagem de erro; registros órfãos (perfil apagado, CPF indexado) também travavam | modal "Este CPF já possui uma conta. Deseja fazer login com ela?" (entrar / corrigir CPF / suporte) com dica do e-mail mascarado; órfãos ignorados (`habilitacao.cpfEmUso`) |
| Loop loja ↔ promotor | tela intermediária "Abrir painel…" + sessão perdida entre páginas | `/sessao` devolve `destino`; o front redireciona DIRETO (`irParaPainel`) com trava anti-loop; rotas `/painel-loja` e `/painel-promotor` |
| Relogin constante | persistência implícita; `currentUser` nulo na 1ª chamada; token velho/cold start do Render viravam erro; bloqueado era deslogado em loop; `mesmaOrigem` só reconhecia um host | `initializeAuth` com persistência local; `chamarFuncao` espera a sessão, renova token 1x e repete GET/`/sessao`; tela fixa de conta bloqueada; qualquer `*.onrender.com` é mesma origem |
| Botões misturados | um único "Continuar com Google" | abas "Entrar na minha conta" / "Criar nova conta" (`entrada.js`); "Entrar" nunca cria cadastro sozinho; "Criar" exige Termos |
| Desbloqueio sem nascimento / admin sem controle | `/admin/promotores/:uid/status` exigia nascimento até para reativar | desbloqueio não exige; aceitar turno segue exigindo tudo (`exigirPodeAceitar`); `PUT /admin/promotores/:uid`, `PUT /admin/lojas/:uid`, `POST …/excluir` + modais no painel |

Exclusão: apaga dados pessoais e a credencial do Auth; **mantém** pedidos, notas, pagamentos, lançamentos, saques e auditoria. Bloqueia se o promotor tiver saldo, saque pendente ou turno aceito sem pagamento; cancela pedidos não pagos da loja. Não exclui admin nem a si mesmo; exige login recente + digitar EXCLUIR + motivo.
Não editável pelo admin: chave Pix, saldos e e-mail de login (Google).
Firebase Hosting: `firebase.json` ganhou os rewrites das rotas limpas. Hospedagem estática sem rewrites: `ROTAS_LIMPAS = false` em `config.js`.

---
# Habilitação por categoria (vídeo + cronômetro + questionário 100%)
- **Categorias:** Mercearia, Frios, Padaria, FLV, Depósito, Degustação (`server/lib/config.js` → `CATEGORIAS`, espelho em `core.js`). Setores novos de pedido: Padaria, Depósito, Degustação.
- **Servidor:** `server/lib/categorias.js` + `server/rotas/categorias.js` (`/habilitacoes`, `/iniciar`, `/ping`, `/questionario`, `/responder`). Gabarito e cronômetro só no servidor. Aprovado → `profissionais/{uid}.habilitacoes[categoria]`.
- **Aceite:** `habilitacao.exigirPodeAceitar` exige a categoria do setor do turno (código `categoria-pendente`).
- **Admin → Habilitações:** vídeo, duração real e 3–4 perguntas por categoria. `node scripts/semear-categorias.js` cria as 6 com perguntas-modelo, **inativas**, para você revisar.
- **Decisões suas:** (1) Bebidas e Montagem de ilhas contam como Mercearia; Inventário como Depósito (`SETOR_CATEGORIA`). (2) Padaria e Depósito entram na lista de setores vedados a menores de 18 (`MENOR.SETORES_VEDADOS`): revisar com advogado. (3) "Selo de Elite" = aprovado de primeira. (4) O treinamento PRATICAMENTE continua obrigatório.
- **Deploy:** `firebase deploy --only firestore:rules` antes de subir o app.
