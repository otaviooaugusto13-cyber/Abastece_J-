# Mural de Vagas / Banco de Talentos

Parceiros anunciam vagas; profissionais autorizam a divulgação, enviam o currículo em PDF e se candidatam em 1 clique. O TI/Admin cadastra
(inclusive em nome de redes, como a Rede São Vicente), modera e vê os candidatos com o PDF. A cobrança futura já tem a chave pronta.

> **Decisão de arquitetura.** O briefing falava em Supabase/PostgreSQL e React, mas este projeto é **Firebase (Auth + Firestore + Cloud Storage) + Express + HTML/JS (módulos ES)**.
> Em vez de abrir um segundo banco, o módulo foi feito **na stack real**, com o mesmo modelo de dados e as mesmas garantias (tabela `SQL` ↔ coleção abaixo).
> O que o RLS do Postgres faria aqui é feito por *deny-all* nas regras + rotas do servidor que conferem papel, consentimento e auditoria.

## 1. Modelo de dados (equivalência com o briefing)

| Briefing (SQL) | Aqui (Firestore) | Observações |
|---|---|---|
| `job_postings` | `vagas/{id}` | `empresaId` (company_id), `titulo`, `descricao`, `cidade`, `uf`, `tipo` (`degustacao`/`promotor`/`repositor` = job_type), `status` (`rascunho`/`ativa`/`encerrada` = draft/active/closed), `gratuita` (**is_free_tier**), `criadoEm`, `expiraEm`. Extras: `moderacao`, `apenasMaiores`, `origem`, `cobranca`, `candidaturasTotal`, `cidadeChave` |
| companies | `vagas_empresas/{id}` | rede/loja/marca/outra + `creditos` e `assinaturaAte` (cobrança). A loja vira empresa sozinha (`loja_{uid}`) |
| `job_applications` | `vagas_candidaturas/{vagaId}_{uid}` | id composto = **uma candidatura por pessoa por vaga**. `status`: `pendente`/`em_analise`/`aceita`/`recusada`. `criadoEm` = applied_at |
| `profiles.accepts_job_disclosure` | `profissionais_privado/{uid}.aceitaDivulgacaoVagas` | + `aceitaDivulgacaoEm`, `aceitaDivulgacaoVersao` (prova do aceite) |
| `profiles.resume_url` | `profissionais_privado/{uid}.curriculo.path` | **caminho** no bucket privado, nunca URL pública. + `sha256`, `bytes`, `nomeArquivo` |
| `full_name`, `cpf` | `profissionais/{uid}.nome` e `profissionais_privado/{uid}.cpfEnc` | já existiam. CPF é cifrado (AES-256-GCM) |
| config da cobrança | `configuracoes/vagas` | a chave "gratuito → pago" (§5) |

Sem índices compostos novos: as consultas são por um campo e o resto é filtrado em memória (≤ 300 vagas ativas). Para escalar, criar índices em `firestore.indexes.json` e paginar com cursor.

## 2. Armazenamento seguro do PDF (`resumes`)

* Bucket **privado**; `storage.rules` = *deny all* (nenhum cliente lê/grava). Só o servidor (Admin SDK).
* Upload: `PUT /perfil/curriculo` (JSON/base64, parser próprio de 7 MB **depois** do login; 6 envios/hora). O servidor valida o **conteúdo**: assinatura `%PDF-`, `%%EOF`, 512 B–5 MiB, e recusa PDF com `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/Encrypt`… (inclusive nomes ofuscados `#xx`). *É checagem por padrões, não antivírus* — para risco maior, passe por ClamAV/re-renderização antes de liberar.
* Objeto: `curriculos/{uid}/{sha256}.pdf` (nome = hash: imutável, sem texto do usuário). A candidatura guarda o caminho **da versão enviada**: trocar o PDF depois não muda o que a empresa recebeu; a versão antiga só é apagada se nenhuma candidatura a usa.
* Leitura: só por rota autenticada (`GET /admin/vagas/candidaturas/:id/curriculo`, `GET /loja/vagas/candidaturas/:id/curriculo`, `GET /perfil/curriculo`), **revalidando o consentimento a cada abertura** e gravando em `auditoria`. Empresa só abre de candidato da **própria** vaga (404 nas demais).

## 3. LGPD

* Opt-in explícito, **desligado por padrão**; o texto exibido vem do servidor com **versão** (`2026-11`). Aceitar grava versão+data; se o texto mudar, o app é obrigado a reaceitar (`termo-desatualizado`).
* Retirar o aceite **bloqueia na hora** o PDF para admin e empresas e impede novas candidaturas. Apagar o currículo remove todas as versões do bucket e marca as candidaturas (`removidoEm`).
* **CPF**: o cruzamento Nome+CPF acontece no servidor e vira instantâneo na candidatura **cifrado** (amarrado ao id) + `cpfMascarado`. Listas (admin e empresa) mostram só o mascarado. Admin vê o completo sob demanda (`POST …/cpf`: login recente + auditoria, sem o CPF no log). A busca por CPF usa índice cego (HMAC) por **POST**, para o CPF não ir à URL/log. *Decisão de produto:* empresas nunca recebem CPF completo; se precisarem, é uma regra a mais em `curriculoDaCandidatura`/`revelarCpf`.
* **16–17 anos:** vagas nascem `apenasMaiores: true`. Só aceitam menores se o admin desmarcar. *(Revisar com o jurídico, como o resto das regras de menor do projeto.)*

## 4. API

**Profissional** (`promotor`): `GET /perfil/vagas` · `PUT /perfil/vagas/consentimento {aceito, versao}` · `PUT|GET|DELETE /perfil/curriculo` · `GET /vagas?cidade=&tipo=&rede=` · `GET /vagas/minhas-candidaturas` · `POST /vagas/:id/candidatar`
**Admin**: `GET|PUT /admin/vagas/config` · `GET|POST /admin/vagas/empresas` · `PUT /admin/vagas/empresas/:id/plano` · `GET|POST /admin/vagas` · `PUT /admin/vagas/:id` (+`/status`, `/moderacao`) · `POST /admin/vagas/:id/candidaturas` · `PUT …/candidaturas/:id/status` · `GET …/candidaturas/:id/curriculo` · `POST …/candidaturas/:id/cpf`
**Empresa** (`loja`, **só API — a tela da loja não foi feita**): `GET|POST /loja/vagas` · `PUT /loja/vagas/:id` (+`/status`) · `GET /loja/vagas/:id/candidaturas` · `PUT|GET /loja/vagas/candidaturas/:id/(status|curriculo)`

Candidatura (`POST /vagas/:id/candidatar`): exige vaga `ativa` + `aprovada` + dentro da validade; nome completo (≥2 palavras), CPF válido, aceite e PDF — senão **409 `perfil-incompleto`** com `detalhe.falta` (o app abre o modal "complete seu perfil"). Duplicada → 409 `ja-candidatou` (transação; cliques simultâneos não duplicam). Conta `bloqueado` não candidata; `pendente` pode.

## 5. Transição monetária (a chave)

`configuracoes/vagas`, editável em **Admin › Vagas › Cobrança** (cada mudança vai para a auditoria com antes/depois):

| Campo | Padrão | Efeito |
|---|---|---|
| `faseGratuita` | `true` | lançamento: parceiros publicam de graça |
| `gratuitoAte` | `null` | data limite; a fase **acaba sozinha** nesse dia |
| `modelo` | `mensalidade` | o que vale depois: `mensalidade` (empresa precisa de `assinaturaAte` vigente) ou `creditos` (1 por publicação, consumo atômico) |
| `mensalidadeCentavos` / `creditoCentavos` | 0 | preços (informativos até haver checkout) |
| `maxVagasAtivasGratis` | 10 | teto por empresa na fase gratuita (anti-abuso) |
| `validadeDiasPadrao` | 30 | validade ao publicar; o cron encerra as vencidas |
| `moderacaoLojas` | `true` | vagas de lojas entram em moderação; editar o texto depois de aprovada volta à moderação |

Regras: o gatilho é **publicar** (rascunho/encerrada → ativa). `gratuita` é gravado na vaga (**is_free_tier**): vagas publicadas de graça continuam grátis até vencer. Despublicar e republicar é nova publicação. **Vagas do admin nunca são cobradas** (onboarding de redes). Falta de plano → **402 `plano-necessario`** com modelo e valor.
*Falta construir:* o checkout (Mercado Pago já existe no projeto). Hoje assinatura e créditos são lançados à mão em **Admin › Vagas › Empresas**; o checkout deve chamar a mesma função (`ajustarPlano`).

## 6. Telas

* **App do profissional** (`promotor.html`, `vagas.js`, `style-vagas.css`): menu *Conta* → **Mural de vagas** (filtros cidade/tipo/rede, "Candidatar-se", "Minhas candidaturas") e **Divulgação e currículo** (switch de consentimento, escolher PDF → *Confirmar e enviar* com "Conferir", ver/apagar). O preview abre em outra aba (a CSP do app não permite `<iframe>` de blob). Sem aceite/PDF, o clique abre o modal de conclusão.
* **Admin** (`admin.html`, `admin-vagas.js`): item **Vagas** com abas Vagas (criar/publicar/moderar), Candidatos (filtros, CPF mascarado, "Abrir PDF"), Empresas e Cobrança.

## 7. Deploy

1. Console Firebase › **Storage** › criar o bucket (privado).
2. Render › env **`FIREBASE_STORAGE_BUCKET`** (ex.: `meu-projeto.firebasestorage.app`). Sem ela, só o *upload* responde 503 `armazenamento-indisponivel`; o resto funciona. A conta de serviço precisa de *Storage Object Admin*.
3. `firebase deploy --only firestore:rules,storage` (regras novas: `vagas*` e `storage.rules`).
4. Deploy do servidor/site (o service worker foi para `abastece-v21`; `vagas` entrou na lista de bypass de cache).
5. Em Admin › Vagas › Empresas, cadastrar as redes (ex.: Rede São Vicente) e publicar as primeiras vagas.

## 8. Testes

`node test/vagas.test.cjs` (39: PDF, LGPD, candidatura, moderação, isolamento entre empresas, cobrança, regras) e `node test/vagas-ui.test.js` (9: front). O `split.test.js` existente também vigia o cache do service worker.

## 9. Não incluído / próximos passos

Tela da loja (API pronta) · checkout da assinatura/créditos · antivírus no upload · notificação ao profissional quando o status muda (hoje ele vê em *Minhas candidaturas*) · paginação com cursor acima de ~300 vagas · retirada de candidatura pelo profissional · exportação CSV de candidatos.
