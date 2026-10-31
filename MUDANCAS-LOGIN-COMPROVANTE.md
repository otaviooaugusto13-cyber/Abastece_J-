# Mudanças desta versão

## Login (admin e TI)
- Google por **redirect** (`signInWithRedirect` + `getRedirectResult`) em todos os portais; sem popup, sem aviso de COOP. `firebase.js`: `entrarComGoogle()` e `concluirLoginGoogle()` (nunca lança).
- **Proxy de autenticação** `server/lib/auth-proxy.js` (`/__/auth/*` → Firebase) e `authDomain` = host do site em `*.onrender.com` (`config.js`). Necessário para o redirect funcionar em Chrome/Safari.
  - Google Cloud › Credenciais › cliente OAuth Web: adicionar `https://SEU-SERVICO.onrender.com/__/auth/handler` aos URIs de redirecionamento.
  - Firebase › Authentication › Domínios autorizados: incluir `SEU-SERVICO.onrender.com`.
- `admin.html`/`admin.js`: e-mail + senha, **Entrar**, divisor "ou", **Entrar com Google**, mensagens de erro. Reautenticação de ação sensível: senha (diálogo com campo de senha) ou Google.
- Erros do servidor sem texto agora mostram mensagem legível (antes: "falha").
- Tela de login com a **cena split-screen** do painel de TI antigo (`login-cena.css`) em `ti.html` e `admin.html`.

## Admins
- `ADMIN_BOOTSTRAP_EMAIL` já aceitava vários e-mails (vírgula, ponto e vírgula ou espaço). A conta precisa existir, ter e-mail verificado e não ser de TI/marca; reinicie o serviço e peça para sair e entrar de novo.

## Comprovante de serviço (layout DANFE simplificado) — ver NOTA-COMPROVANTE.md
- `server/lib/danfe.js`, `server/rotas/nota.js` (`POST /nota/:id/emitir`, `POST /nota/verificar`), `nota.html`/`nota.js`/`nota.css`, `verificar.html`/`verificar.js`.
- Documento **sem valor fiscal**; código de barras Code 128 de um código de verificação (HMAC, 24 dígitos). Segredo: `NOTA_HMAC_KEY` (ou `BLIND_INDEX_KEY`). Exemplo: `docs/exemplo-comprovante.pdf`.
- `EMPRESA` espelhada em `server/lib/config.js` (conferida em `test/split.test.js`); testes do comprovante em `test/backend.test.cjs`.

## Painel de TI
- Botão **Ver perfil** no chamado (loja/promotor): `GET /ti/solicitantes/:uid/perfil` (CPF mascarado, missões, carteira, habilitação; consulta auditada).
- Não trouxe "online agora" no perfil: a presença do nosso módulo é por instância e anônima.

## Administradores criados pelo painel de TI (nova aba, só gestor)
- Aba **Administradores** no painel de TI: criar conta de admin (e-mail + senha, e-mail já verificado), redefinir senha (encerra sessões) e remover acesso. Tudo auditado e com login recente exigido.
- Backend: `server/lib/ti/admins.js`, rotas `/ti/administradores...`, permissão `admins.gerir` (só gestor). Não converte conta de TI/marca, não mexe na própria conta e sempre deixa ao menos um admin.
- Atenção: com `ADMIN_EXIGE_MFA=1` (padrão do `render.yaml`) as telas do admin falham sem 2º fator, e o painel não tem tela para cadastrá-lo. Se não usa MFA no Firebase, ponha `ADMIN_EXIGE_MFA=0` no Render.
- O painel administrativo ainda não tem tela para o admin trocar a própria senha: defina a senha final ao criar.

## Redefinir senha / excluir sem pedir a senha atual
- Painel de TI (operadores e administradores) e Painel administrativo (operadores de TI): **redefinir senha** e **excluir/remover** não pedem mais a senha atual. Pedem a **nova senha** (opcional; em branco gera temporária) e o **motivo** (obrigatório, mín. 5 caracteres).
- A auditoria registra quem fez (nome, e-mail, IP), o alvo e o motivo. Criar conta, mudar nível e restaurar continuam exigindo login recente.
- Testes ajustados em `test/ti.test.cjs` (motivo obrigatório).
