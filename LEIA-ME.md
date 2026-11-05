# Abastece Já — Dock flutuante, Home em mapa, Suporte e documento

## Como aplicar (na raiz do projeto)
```bash
patch -p1 < alteracoes-em-arquivos-existentes.patch   # 10 arquivos existentes
cp -r arquivos-novos/* .                              # 6 arquivos novos
npm test                                              # inclui test/documento.test.cjs
```
Depois do deploy, o service worker sobe para `abastece-v19` e os celulares pegam os arquivos novos sozinhos.

## O que mudou
| Arquivo | Mudança |
|---|---|
| `style.css` | Removida a regra `.login-screen ~ .fab-suporte` (causa do Suporte invisível no celular) |
| `style-dock.css` (novo) | Dock flutuante, botão central elevado, Home em mapa, bottom sheet, tela de documento |
| `dock.js` (novo) | `iniciarDock`, `iniciarVistaPedidos`, `iniciarSheetMapa` |
| `index.html` / `script.js` | Loja: Home = mapa + sheet com 3 passos; formulário e "chamado relâmpago" foram para Pedidos |
| `promotor.html` / `script-personal.js` | Promotor: dock com Início, Turnos, Ofertas (central), Saque, Conta |
| `documento.js` + `server/lib/documento.js` + `server/rotas/documento.js` (novos) | Envio de RG/CNH, cifrado em repouso, com rotas de análise para o admin |
| `server/lib/cripto.js` | `cifrarBytes` / `decifrarBytes` (mesma chave e versionamento dos dados sensíveis) |
| `server/server.js` | Registra a rota e libera o limite de corpo só para `/perfil/documento/{frente|verso}` |
| `suporte.js` | Selo de mensagem nova também no cartão Suporte e no ícone Conta |

## Rotas novas
- `GET  /perfil/documento` → `{ tipo, status, motivo, lados }` (loja e promotor)
- `POST /perfil/documento/:lado` (`frente`|`verso`) com `{ tipo: "rg"|"cnh", foto: "data:image/jpeg;base64,…" }`
- `GET  /admin/documentos` → fila de documentos `enviado`
- `GET  /admin/documentos/:uid/:lado` → imagem decifrada (leitura auditada)
- `POST /admin/documentos/:uid/decisao` → `{ status: "aprovado"|"recusado", motivo }` (recusa deixa um recado para o usuário)

## Ainda não feito (decisões suas)
1. **Tela do admin** para revisar documentos: as rotas existem, falta a tela em `admin.html`/`admin.js`.
2. **Bloquear a 1ª aprovação do perfil** sem documento aprovado: seria uma checagem de `documentoStatus` em `POST /admin/promotores/:uid/status`. Não mexi nessa regra de negócio.
3. **Mapa do promotor**: não existe fonte de pins de ofertas com coordenadas. Hoje a Home do promotor continua com os cards e o botão central leva às Ofertas.
4. Mapa e dados reais não rodaram nos testes (sem rede/Firebase aqui): validei o CSS e os módulos no navegador e a lógica do servidor com banco em memória.
