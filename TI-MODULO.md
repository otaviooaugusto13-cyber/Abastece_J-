# Módulo de TI — painel `/painel-ti`

Painel exclusivo da equipe de TI: **operadores**, **trilha de auditoria à prova de adulteração**, **chamados**, **produtividade** e **usuários online em tempo real**.
Construído na stack existente (Express + Firebase Auth + Firestore). Nada do módulo é legível/gravável pelo navegador no Firestore: tudo passa pela API (`/ti/*`).

## Colocar no ar (4 passos)
1. **Firebase Console → Authentication → Sign-in method → habilite "E-mail/senha".**
2. `firebase deploy --only firestore:rules,firestore:indexes` (regras explícitas + 11 índices novos; os índices levam alguns minutos para ficar prontos).
3. Crie o primeiro gestor: `node scripts/criar-operador-ti.js "Nome Completo" ti@suaempresa.com gestor` (imprime uma senha temporária uma única vez).
4. Abra `/painel-ti`, entre, defina sua senha. Daí em diante tudo é feito pela tela (Operadores).

Sem variáveis de ambiente novas. `npm test` agora também roda `test/ti.test.cjs` (26 testes).

## Papéis
| Nível | Pode |
|---|---|
| **gestor** | tudo: cadastrar/excluir/restaurar operadores, redefinir senhas, mudar nível, ver **toda** a auditoria (+CSV e verificação de integridade), encaminhar chamados |
| **técnico** | ver fila, assumir/atender/resolver os **seus** chamados, comentar, ver dashboard e **apenas a própria** trilha de auditoria |

Papel = custom claim `role: "ti"` (+`tiNivel`), escrita só pelo servidor. A fonte da verdade do status/nível é o documento `ti_operadores/{uid}`, lido a cada requisição (cache de 10 s): excluir ou rebaixar vale na hora, mesmo com token antigo.

## Gestão de operadores
- **Cadastro** (gestor): senha temporária aleatória (16 caracteres, exibida uma vez, nunca gravada) ou senha definida; **primeiro acesso exige trocar** (`trocarSenha` bloqueia todo o resto da API).
- **Política de senha**: ≥12 caracteres, ≥3 dos 4 tipos, sem e-mail/nome, sem repetições, sem lista de senhas óbvias.
- **Alterar a própria senha** / **reset por gestor**: exigem login recente (≤5 min — a tela pede a senha atual) e **revogam todas as sessões**.
- **Exclusão lógica**: motivo obrigatório; marca `status: "excluido"`, **desativa o login** no Firebase Auth, revoga sessões, derruba streams abertos, **devolve à fila os chamados dele**. O documento permanece (auditoria continua apontando para a pessoa). **Restaurar** reativa com nova senha temporária.
- Travas: não exclui/rebaixa a si mesmo; **sempre sobra ≥1 gestor ativo** (checado em transação, vale até com dois gestores se removendo ao mesmo tempo); e-mail já existente no Auth é recusado (conta de loja/promotor nunca vira TI; conta de TI não consegue virar loja/promotor).

## Trilha de auditoria (`ti_auditoria`)
Registra **login/logout, todo cadastro/alteração/exclusão/reset, toda ação em chamados, consultas e exportações da própria auditoria, acessos negados e tentativas recusadas por regra** — com operador, nível, ação, alvo, **antes→depois**, IP, user-agent, rota e id de requisição. Senhas/tokens/CPF/Pix são **omitidos** de `antes/depois/meta` automaticamente.
- **Append-only com hash encadeado**: cada registro guarda `hash = SHA-256(hashAnterior | conteúdo canônico)`; a cabeça da cadeia fica em `ti_auditoria_cadeia/estado`, atualizada na mesma transação. Editar, apagar ou reordenar qualquer registro quebra a cadeia → **Auditoria → Verificar integridade** (ou `GET /ti/auditoria/verificar`) acusa `conteudo-alterado`, `sequencia-com-buraco`, `encadeamento-quebrado` ou `cabeca-divergente`.
- Filtros por operador, ação, alvo, resultado e período; paginação por cursor; exportação CSV (com defesa contra formula injection).
- Limite honesto: quem tem a chave de serviço do Firebase poderia reescrever a cadeia inteira. Para blindar de vez, exporte periodicamente a cabeça (`seq` + `hash`) para um local externo (bucket com retenção/WORM ou e-mail ao jurídico).

## Chamados
Quem abre: loja/promotor/admin (`POST /chamados`, 5 por hora por usuário, só sugerem urgência até "alta") ou a equipe em nome de alguém (`POST /ti/chamados`).
Estados: `aberto → em_atendimento ⇄ aguardando_usuario → resolvido` (reabrível) · `cancelado`. Resolver/cancelar exigem nota. Notas internas nunca chegam ao solicitante (ele só vê a própria linha do tempo pública; chamado alheio devolve 404).
**SLA por prioridade** (primeiro atendimento / resolução): crítica 15 min / 4 h · alta 1 h / 8 h · média 4 h / 24 h · baixa 24 h / 72 h (`server/lib/ti/constantes.js`). O tempo em "aguardando usuário" **não conta** para a resolução.

## Dashboard e métricas
- **Chamados abertos** (fila / em atendimento / aguardando / fora do prazo): contagens por `count()` do próprio Firestore.
- **TMA — tempo médio de atendimento** = abertura → primeira vez que um operador assume. **TMR — tempo médio de resolução** = abertura → resolução, descontando "aguardando usuário". Também % dentro do SLA.
- **Ranking**: mais resolvidos no período (desempate: mais assumidos, menor TMA). Períodos: hoje, 7, 30, 90 dias.
- **Desempenho**: as métricas são **agregadas por dia na mesma transação** de cada mudança (`ti_metricas_dia`, `ti_produtividade`); o dashboard lê no máximo ~90 documentos pequenos, nunca varre chamados. Custo constante, não importa quantos chamados existam.
- **Online agora**: o app (loja, promotor, admin, TI) pinga `POST /presenca/ping` a cada 30 s com a aba visível; online = ping nos últimos 75 s. Ping valida só a assinatura do token (sem ida ao Auth) e fica em memória; cada instância publica 1 documento a cada 20 s e o total é a **união** deles (usuário em 2 instâncias conta 1) — então continua correto ao escalar.
- **Tempo real**: `GET /ti/stream` (SSE; o cliente usa `fetch` com `Authorization`, token nunca na URL). Um único cálculo a cada 5 s é compartilhado por todos os operadores conectados. Fecha sozinho a cada 10 min (reconecta com token novo), máx. 3 por operador, 200 no total; cai para consulta periódica se o stream falhar; pausa com a aba escondida.

## Modelo de dados (Firestore)
| Coleção | Chave | Campos principais |
|---|---|---|
| `ti_operadores` | uid do Auth | nome, email, nivel, status (`ativo`/`excluido`), trocarSenha, criadoEm/Por, ultimoLoginEm, senhaAlteradaEm, excluidoEm/Por, motivoExclusao |
| `ti_auditoria` | seq (10 dígitos) | seq, ord, emMs, acao, resultado, operadorUid/Nome/Email, nivel, alvoTipo, alvoId, resumo, antes, depois, meta, ip, ua, rota, reqId, prevHash, hash |
| `ti_auditoria_cadeia/estado` | — | seq, hash |
| `chamados_ti` | auto | protocolo, titulo, descricao, categoria, prioridade, status, origem, solicitanteUid/Tipo/Nome, atribuidoUid/Nome, criadoMs, atendidoMs, tempoAtendSeg, resolvidoMs, tempoResolSeg, pausadoSeg, slaAtendMs, slaResolMs, reaberturas, resolucao |
| `chamados_ti/{id}/eventos` | tempo_rand | tipo, autor, texto, interno, de, para, emMs |
| `ti_metricas_dia` | YYYY-MM-DD | criados, atendidos, resolvidos, cancelados, somaAtendSeg, somaResolSeg, atendNoPrazo, resolNoPrazo, porPrioridade |
| `ti_produtividade` | YYYY-MM-DD_uid | dia, uid, nome, assumidos, resolvidos, somaAtendSeg, somaResolSeg |
| `presenca_instancias` | id da instância | emMs, ids (hash curto + tipo) |

**Por que não SQL/MongoDB?** O projeto inteiro já roda em Firestore + Firebase Auth; introduzir outro banco dobraria a operação e quebraria as transações que ligam chamado + métricas + auditoria. Se um dia migrar, o mapeamento é direto: cada coleção vira uma tabela (`chamados_ti_eventos` com FK para `chamados_ti`; `ti_auditoria` com `seq BIGINT PRIMARY KEY`, `hash CHAR(64)`, `prev_hash CHAR(64)`, `antes/depois JSONB`; índices em `(operador_uid, ord DESC)`, `(acao, ord DESC)`, `(status, criado_ms)`), e as agregações diárias viram `GROUP BY dia`.

## API (resumo)
`POST /ti/sessao` · `POST /ti/sessao/sair` · `POST /ti/eu/senha` · `GET|POST /ti/operadores` · `PUT /ti/operadores/:uid/nivel` · `POST /ti/operadores/:uid/{senha,excluir,restaurar}` · `GET /ti/auditoria[/exportar|/verificar]` · `GET|POST /ti/chamados` · `GET /ti/chamados/:id` · `POST /ti/chamados/:id/{assumir,atribuir,status,comentarios}` · `PUT /ti/chamados/:id/prioridade` · `GET /ti/dashboard?dias=7` · `GET /ti/stream` · `POST /chamados`, `GET /chamados/meus`, `GET /chamados/:id`, `POST /chamados/:id/responder` (solicitante) · `POST /presenca/ping`.

## Segurança — resumo
Deny-by-default no Firestore (regras explícitas para todas as coleções novas) · RBAC por permissão em cada rota · token verificado **com checagem de revogação** · login recente para ações sensíveis · rate limit por operador · validação estrita de tipo/tamanho/enum (injeção NoSQL → 400) · IDs `^[\w-]{1,128}$` · saída com `esc()` + CSP sem `unsafe-inline` em scripts · respostas `no-store` · IDOR em chamados = 404 · conta TI bloqueada nos fluxos de cadastro de loja/promotor.

## Limitações e próximos passos
- **Tentativas de login com senha errada** acontecem direto no Firebase Auth (que já aplica bloqueio contra força bruta); elas aparecem no Cloud Logging/Identity Platform, **não** na trilha do painel. Login bem-sucedido, logout e tudo depois dele são auditados.
- **MFA** não está implementado na tela de TI (exigiria Identity Platform + fluxo de cadastro do 2º fator). Recomendado antes de dar acesso a muitos operadores; **ative também o Firebase App Check**.
- Rate limit e cache de métricas são em memória por instância (igual ao resto do projeto); com escala horizontal, troque o limitador por Redis. A presença já é multi-instância.
- Lojas/promotores ainda não têm tela para abrir chamados: a API (`/chamados*`) está pronta e a equipe abre em nome deles pelo painel. Notificação push ao solicitante em respostas é um próximo passo simples (`suporte.enviarPush`).
- O ranking conta eventos de resolução; um chamado reaberto e resolvido de novo conta duas vezes.
