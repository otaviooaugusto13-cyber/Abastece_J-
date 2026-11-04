# Unificação final — main_11 + CS & B2B + sessões/login/assets

**Base:** `Abastece_J--main_11` (v17 do service worker: Root, mapa de promotores, roteador de chamados, painel de suporte, TI com SLA, contestação de banido).
**Somado:** módulo CS & B2B da versão `cs-b2b` (TypeScript + JS compilado, PPTX, recorrências que geram pedidos, NPS, cron) e as correções da `main-corrigido` (sessão por painel, login Google por popup, e-mail/senha, assets/splash).

## Decisões de merge
| Tema | Decisão | Motivo |
|---|---|---|
| Duas implementações de CS (`CS-B2B.zip` em `/admin/cs/*` × `cs-b2b.zip` em `/cs/*`) | Mantida só a `cs-b2b` | Mesmas 15 funções, mas com exportador PPTX, recorrências que criam pedidos reais, 26 testes e TypeScript compilado. As duas ocupam `/painel-cs`; não coexistem. |
| `main-corrigido` é de base mais antiga (sw v13, sem Root/mapa/suporte/chamados) | Porte cirúrgico dos trechos, sem trocar arquivos inteiros | Evita regressão: nada da base v17 foi sobrescrito. |
| Tela de login do Admin/TI | Mantida a da base nova (`admin-login.css`) | A da `main-corrigido` era a versão anterior; só foi portada a lógica (meta `abastece-portal`, popup, `signOut` isolado). |
| `config.js` | `USAR_PROXY_AUTH = false` (padrão `firebaseapp.com`) | Funciona sem configurar OAuth no Google Cloud; o proxy `/__/auth/*` continua no servidor e liga-se com um flag. |
| Service worker | v18; regex de "sem cache" unificada (`__/`, painéis, `cs/`) sem parênteses | `test/split.test.js` lê a regex com `[^)]*`. |
| CSP | `style-src`/`img-src` do mapa (base) + `frame-src` do popup Google (corrigido) | Os dois conjuntos são necessários. |

## Preservado da base
Chamado automático por erro de negócio (`CODIGOS_COM_CHAMADO`), aba Chamados, ficha com "Encerrar sessões" e cópia da chave Pix, contestação de conta banida, Master Switch/raio do Root, mapa de promotores, botão central de suporte (WhatsApp ou chat), `style-jogo.css`, taxas com auditoria Root.

## Trazido da main-corrigido
Sessão isolada para TI e Admin (`firebase.js › PORTAIS_ISOLADOS`), `entrarComGoogle` por popup com redirect de reserva, `loginCancelado`, e-mail/senha (`login-email.js`), tela "Confirme seu e-mail", logo/ícones/splash de iPhone/iPad, `scripts/gerar-assets.py`.

## Trazido do CS & B2B
`cs/` (fonte TS + painel React), `server/lib/cs/` (JS compilado, idêntico ao `tsc` da fonte), 9 coleções `cs_*` fechadas em `firestore.rules`, cron `abastece-cs` no `render.yaml`, build do painel no deploy, `test/cs.test.cjs` no `npm test`.

## Verificação
`npm test` passou (288 verificações, incluindo 26 do CS); `npm run verificar` sem críticos e sem alertas novos em relação à base; o `tsc` reproduz byte a byte o JS compilado do CS.
**Não verificado aqui (sem rede/credenciais):** login Google/e-mail reais no Firebase, `npm run build` do painel CS e o deploy no Render.

## Para ligar o CS (uma vez)
1. `firebase deploy --only firestore:rules`
2. Deploy no Render (instala `pptxgenjs` e gera `cs-app/`); o cron `abastece-cs` usa o mesmo `CRON_SECRET`/`APP_URL`.
3. Quem estava logado no TI/Admin entra uma vez de novo (sessões agora são separadas). O `/painel-cs` tem login próprio (papel admin).
