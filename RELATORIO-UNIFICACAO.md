# Relatório da unificação (versão final)

Sete linhas de trabalho paralelas foram fundidas em **um único projeto**, com merge de três vias (cada arquivo comparado contra o seu ancestral comum, não "o último vence").

## Origem de cada parte

| Versão | O que trouxe (mantido na versão final) |
|---|---|
| **Abastece_J--main (2)** — base | Painel admin novo (dark/glass/mobile), login multi-perfil (`acesso.js`), recados do suporte (`recado.js`), check-in/check-out (`turnos.js`) |
| **Abastece_J-corrigido** | Persistência de sessão e `sairDaConta`, redirecionamentos loja/promotor (`entrada.js`), **CPF duplicado** (`validacao.js`/`habilitacao.js`), **editar/excluir usuário no admin**, `dialogo` (substitui `confirm`) |
| **arquivo_de_atualizacaao_do_amd** | Meu pacote: prova por módulo (perguntas + alternativas), financeiro com filtros/KPIs, **log de auditoria ao vivo (15 s)**, exportações auditadas |
| **chat-push-atualizados** | Chat de suporte (`suporte.js`), notificações push (`push.js`), aba Suporte no admin |
| **Questionário_de_Avaliação** | **Habilitação por categoria**: vídeo + cronômetro no servidor + prova 100%, trava de ofertas por setor, selos, 9 setores (Padaria, Depósito, Degustação) |
| **nterface_do_Admin** (via F) | **Taxas dinâmicas** editáveis no admin (`taxas.js`) |
| **F (unificado anterior)** | Cursos opcionais por categoria, GPS/raio de vagas, perfil inteligente (Eneagrama, match de vagas) |

## Decisões em conflitos reais

1. **Treinamento (3 modelos disputando o mesmo arquivo).** Adotei o modelo do F (obrigatório = habilitação PRATICAMENTE, sequencial; opcional = cursos por categoria) e acrescentei por cima a **prova com perguntas** (opcional em qualquer módulo). As categorias por *setor* que eu tinha criado foram removidas dos módulos, porque o `C` resolve isso melhor em **Habilitações** (regra de negócio no aceite do turno).
2. **Ofertas do promotor.** Ranking por GPS/perfil (F) **e** trava por habilitação (C): ofertas de setor não habilitado vão para o fim, com cadeado e botão "Habilitar-me"; o servidor confere de novo.
3. **Painel admin.** Mantido o painel novo; a aba **Habilitações** do `C` foi portada para ele com o mesmo construtor de perguntas ("+ Adicionar pergunta / alternativa").
4. **`scripts/definir-admin.js`.** O `C` tinha reduzido o arquivo de 149 para 22 linhas; mantive a versão completa.

## Bugs de integração encontrados e corrigidos

- **Matching de vagas quebrado.** O `C` ampliou os setores de 6 para 9; as matrizes do `perfil-inteligente.js` são posicionais e passariam a ler colunas erradas/`undefined`. Fixei a ordem das matrizes e mapeei Padaria→Mercearia, Depósito→Inventário, Degustação→Mercearia (`SETOR_PROXY`). **Decisão de produto: revise esses mapeamentos.**
- **Cache de API.** `/habilitacoes` (plural) não casava com a regex que impede o service worker de guardar respostas pessoais. Corrigido em `server.js` e `sw.js`.
- **Política de links externos.** O botão "suporte" do fluxo de CPF duplicado abria `wa.me`; o teste de segurança só permite `api.whatsapp.com`. Alinhado.
- **Teste de paridade** atualizado para a nova lista de setores.

## Verificação

- `node --check` em **todos** os `.js`/`.cjs`: ok. Importações nomeadas × exports reais: ok. IDs usados no JS × HTML: ok. Sem marcadores de conflito e sem rotas duplicadas.
- `npm test`: split ✓ · perfil 12/12 ✓ · **backend 82/82 ✓** (77 das versões + 5 novos meus: prova, check-in/out, resumo financeiro, auditoria de exportação). Testes novos validados por mutação (quebrei o código de propósito e eles falharam).
- **Não foi possível:** testar no navegador/celular, no Firebase real, no Mercado Pago e no Render. Faça o roteiro abaixo.

## Depois de subir

1. `node scripts/semear-categorias.js` (cria as 6 habilitações **inativas**) → Admin ▸ Habilitações: publique vídeo, duração real e 3–4 perguntas, e marque **ativa**. Enquanto inativa, as vagas daquele setor ficam travadas para todos.
2. Admin ▸ Treinamento: confira que existe ao menos 1 módulo **obrigatório** ativo (senão ninguém aceita turno).
3. Push: preencha `FCM_VAPID_KEY` em `config.js` (Firebase ▸ Cloud Messaging) e faça o deploy das regras (`firebase deploy --only firestore:rules`): há coleções novas (`habilitacao_*`, suporte).
4. Teste ponta a ponta com uma loja e um promotor de teste: cadastro → treino → prova → habilitação → aceitar turno → check-in/out → pagamento → conferir Log e Financeiro.
5. `serviceAccountKey.json` **não** vai no zip e deve continuar só no seu computador (está no `.gitignore`).

## Pendências conhecidas (não implementadas)

Aprovar/suspender **loja**, disputas com congelamento de repasse, e-mail/WhatsApp para avisos, LGPD (exportar/apagar dados), exibir check-in/out no app da loja, e a exibição do aviso global (`GET /aviso`) nos apps.
