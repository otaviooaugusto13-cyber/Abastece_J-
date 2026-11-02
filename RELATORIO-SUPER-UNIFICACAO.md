# Abastece Já — Super unificação (v15)

Entradas: `files.zip` (super-unificado **v14**: suporte, clínicos, erros globais, contestação de banimento, Encerrar sessões/Pix) e `Abastece_J-unificado-v7` (cache/no-cache completo, novo login do admin, verificador de integridade).

## Base e decisões
- **Base = v14** (superconjunto funcional: admin.js, tests, suporte, erros, style.css). Os arquivos que só a v7 tinha ou corrigiu foram trazidos por cima.
- v7 e v14 divergiam em 24 arquivos; em 18 a v14 só acrescenta (nada a perder). Os demais foram resolvidos como abaixo.

## O que veio da v7 (e a v14 tinha perdido)
| Arquivo | Mudança |
|---|---|
| `sw.js` | **Regressão da v14**: `sessao`, `aviso`, `ti/`, `chamados`, `presenca`, `turnos` voltaram para o bypass de cache (respostas do TI/sessão podiam ficar no Cache Storage). Mantidos os arquivos novos da v14 no precache + `admin-login.css`. Versão `abastece-v15`. |
| `server/server.js` | Regra `semCache` completa (`sessao`, `turnos`). |
| `test/split.test.js` | Teste que exige que toda rota da API esteja no no-cache do servidor e (GET) no SW. Passa com as rotas novas da v14 (`/chamados/automatico`, `/suporte/*`). |
| `admin.html` + `admin-login.css` | Novo login do admin (split-screen) com e-mail/senha + Google; ids inalterados. |
| `scripts/verificar-integridade.mjs`, `scripts/auditoria-ui.mjs` | Verificador (`npm run verificar`) e auditoria sem falsos críticos. |
| `package.json` | Script `verificar` + `erros.test.js` no `npm test`. |

## Mantido da v14
Canais de suporte (WhatsApp ou chat), atendimento a clínicos, erros globais com chamado automático (`/chamados/automatico`), contestação de banimento (`exigirMesmoBanido` só em `/suporte/mensagem` e `/suporte/lido`), Encerrar sessões, copiar Pix, `style.css`/`suporte.js` novos.
`erros-globais.js`: `VERSAO_APP` = `abastece-v15` (igual ao SW).

## Fluxos conferidos (nenhuma perda)
login e persistência de sessão · retry/renovação de token (`sessao-invalida`) · rotas `/painel-loja` `/painel-promotor` · redirecionamento loja/promotor · CPF duplicado/órfão · editar e excluir usuário no admin · Encerrar sessões · tela de banido + contestação. Verificação por comparação de linhas: nenhuma linha de v7 ou v14 ausente além das substituições intencionais acima.

## Testes (sem rede, ambiente simulado)
split ✓ · perfil 14/14 · backend 90/90 · TI 35/35 · jogo 22/22 · eneagrama 13 · erros 8 · `verificar-integridade` ✓ (sem conflitos, sintaxe/imports/duplicados/JSON/referências OK) · auditoria de UI: 0 críticos.

## Não verificado
Navegador, Firestore, Render, push, GPS e câmera reais — faça deploy em homologação antes de produção.
Depois do deploy: `firebase deploy --only firestore:rules,hosting` e redeploy no Render (o SW `v15` força os clientes a atualizar).
