# Plano de ação — Lançamento no YouTube (amanhã) + Caça a bugs de UI

Data-base: quinta, 29/10/2026. Duas frentes independentes; a Frente B (QA) pode rodar em paralelo à Frente A, mas **o app que aparece no vídeo precisa estar corrigido antes da gravação final**. Se o vídeo já está gravado, trate só os bugs que aparecem em tela.

---

# FRENTE A — Publicação no YouTube

> Limites e recursos do YouTube mudam. Os números abaixo são os praticados hoje; **confirme no YouTube Studio** na hora de publicar.

## A1. Linha do tempo

| Quando | Entrega | Dono |
|---|---|---|
| **Hoje à tarde** | Corte final aprovado, thumbnail pronta, metadados escritos (A3–A5) | você |
| **Hoje à noite** | Upload com visibilidade **Privado** + legendas + capítulos + cards. Deixar processar em HD (leva de minutos a horas) | você |
| **Hoje, antes de dormir** | Assistir o vídeo privado **do começo ao fim no celular**, com fone, em tela cheia | você |
| **Amanhã, 1h antes** | Trocar para **Agendado** (ou Público) no horário escolhido; conferir link/UTM | você |
| **Amanhã, hora H** | Publicar, fixar comentário, divulgar (A7) | você |
| **Amanhã, 0–2h** | Responder todos os comentários; observar CTR e retenção iniciais | você |
| **D+1 a D+7** | Leitura de métricas e ajustes de título/thumbnail (A8) | você |

Horário: use os relatórios "Quando seu público está no YouTube" do Studio. Sem histórico, publique em horário em que sua audiência já te vê (para B2B de supermercado: início da manhã ou fim de tarde em dia útil é um palpite razoável, não regra).

## A2. Roteiro do vídeo (modelo para técnico/comercial, 6–10 min)

| Tempo | Bloco | O que fazer |
|---|---|---|
| 0:00–0:15 | **Gancho** | Comece pelo problema ou pelo resultado, nunca pelo logotipo. Ex.: "Repor uma gôndola vazia custa vendas todo dia. Em 30 segundos mostro como pedir um promotor." |
| 0:15–0:40 | **Promessa + credibilidade** | O que a pessoa vai levar e por que acreditar (número real, cliente, demonstração ao vivo). |
| 0:40–2:00 | **Problema** | Cenário do cliente, com a dor em linguagem dele. |
| 2:00–6:00 | **Demonstração** | Tela real, 3 a 4 funcionalidades no máximo, cada uma com "antes → clique → resultado". Zoom na parte importante, cortes a cada 20–40 s. |
| 6:00–7:00 | **Prova** | Resultado, depoimento, comparação, números. |
| 7:00–7:40 | **Chamada para ação única** | **Uma** ação (ex.: "teste grátis pelo link da descrição"). Várias ações diluem todas. |
| 7:40–end | **Tela final** | 5 a 20 s para end screen apontando o próximo vídeo. |

Regras de retenção:
- Corte pausas, "então...", repetições e qualquer cena em que nada muda na tela por mais de ~5 s.
- Mostre o resultado antes de explicar o caminho; mantenha a promessa do título cumprida nos primeiros minutos.
- Áudio é mais importante que imagem: ruído e volume irregular derrubam a retenção. Normalize (alvo comum: cerca de −14 LUFS) e escute no celular.
- Legenda queimada ou destaque visual nos termos-chave: muita gente assiste sem som.
- Não prometa o que o app não faz. Em vídeo comercial, mostre só o que está em produção.

## A3. Título (SEO e clique)

- Até 100 caracteres, mas **a parte que decide fica nos primeiros ~60** (o resto é cortado em muitas telas).
- Palavra-chave principal **no começo**, benefício concreto depois, sem caixa-alta total nem clickbait que o vídeo não cumpre (retenção ruim derruba o alcance mais do que o título ajuda).
- Um título = uma promessa.

Fórmulas (substitua pelo seu tema):
1. `[Resultado] em [prazo]: [como]` → *Reposição de gôndola em 30 segundos: como pedir promotor pelo app*
2. `Como [fazer X] sem [dor]` → *Como contratar promotor para supermercado sem pagar adiantado*
3. `[Ferramenta]: [para quem] + [diferencial]` → *Abastece Já: app de promotores para supermercados, com aceite digital*

Teste 2 ou 3 versões. Se seu canal tiver o recurso **Testar e comparar** (miniatura/título) no Studio, use; senão troque manualmente após 48–72 h de dados.

## A4. Descrição

Até 5.000 caracteres. **Só as 2–3 primeiras linhas aparecem antes do "mais"**: coloque ali a promessa e o link.

```
[Linha 1: o que o vídeo resolve, com a palavra-chave principal]
[Linha 2: chamada única + link com UTM]  →  https://SEU-SITE/?utm_source=youtube&utm_medium=video&utm_campaign=lancamento

Neste vídeo:
0:00 O problema
0:40 [Funcionalidade 1]
2:10 [Funcionalidade 2]
4:00 [Funcionalidade 3]
6:00 Resultados
7:00 Como começar

[2–3 parágrafos naturais com os termos que seu cliente pesquisa: reposição de gôndola,
 promotor de vendas, supermercado, gestão de equipe terceirizada... sem repetir em lista.]

Links úteis: site · WhatsApp · documentação
Contato comercial: [e-mail]
#hashtag1 #hashtag2 #hashtag3   (use no máximo 3; aparecem acima do título)
```

- **Capítulos**: o primeiro tem que ser `0:00`, mínimo 3, e cada um com pelo menos 10 s.
- Escreva para quem lê, não para robô: o YouTube entende contexto; lista de palavras soltas não ajuda e parece spam.
- Link com UTM para medir no seu analytics quanto o vídeo realmente converte.

## A5. Tags, idioma e configurações

- **Tags**: papel pequeno (o próprio YouTube diz que ajudam principalmente em grafias comuns erradas). Use 5–10, o termo principal primeiro. Limite de 500 caracteres no total.
- Idioma do vídeo: **Português (Brasil)**; localização de títulos só se for traduzir de verdade.
- **Feito para crianças**: Não.
- **Conteúdo alterado/sintético**: se usar voz ou imagem gerada por IA que pareça real, marque a divulgação que o Studio pede.
- **Promoção paga**: marque se houver patrocínio/parceria. Divulgar produto próprio não é "paga", mas seja transparente.
- Categoria: Ciência e tecnologia, ou Educação/Negócios conforme o tom.
- Licença: padrão. Comentários: ligados (filtro de links ativo). Contagem de curtidas visível.
- Playlist: adicione a uma playlist temática (segura o espectador na sessão).

## A6. Miniatura (a maior alavanca de clique)

- 1280×720 (16:9), JPG/PNG, mantenha abaixo de 2 MB.
- **Uma ideia, 3–4 palavras no máximo**, fonte grande, alto contraste, rosto ou elemento humano ajuda.
- Precisa ser legível em **tamanho de selo** (veja reduzida a ~120 px de largura).
- Não repita o título: complemente (título = o quê; miniatura = a emoção/o resultado).
- Teste no tema claro e no escuro do YouTube.

## A7. Checklist de publicação (marque antes de clicar)

**Conteúdo**
- [ ] Assisti inteiro no celular, com fone, em tela cheia
- [ ] Nenhum dado real de cliente, e-mail, CPF, token, URL interna ou chave aparece em tela (pause os trechos de demonstração e confira)
- [ ] Gancho nos primeiros 15 s; promessa do título cumprida cedo
- [ ] Áudio sem ruído, volume uniforme
- [ ] Música/imagens com direito de uso (evita bloqueio e desmonetização)
- [ ] CTA único e claro, falado e escrito

**Metadados**
- [ ] Título ≤ 60 caracteres úteis, palavra-chave no início
- [ ] Descrição com promessa + link nas 2 primeiras linhas
- [ ] Capítulos (0:00, ≥ 3, ≥ 10 s cada)
- [ ] Tags, idioma, "feito para crianças: não", divulgações marcadas
- [ ] Miniatura enviada e testada em tamanho pequeno
- [ ] Legenda em português enviada (SRT) ou revisada a automática
- [ ] Playlist definida; cards nos pontos certos; **tela final** nos últimos 5–20 s

**Técnico**
- [ ] Processamento em HD concluído antes de publicar
- [ ] "Verificação" do Studio sem alertas de direitos autorais
- [ ] Link da descrição testado (abre, leva ao lugar certo, UTM registrando)
- [ ] Horário agendado no fuso certo (America/Sao_Paulo)

**Depois de publicar (primeira hora)**
- [ ] Comentário fixado com a CTA e o link
- [ ] Compartilhar em WhatsApp (grupos de clientes/parceiros), LinkedIn, Instagram, e-mail para base
- [ ] Responder todos os comentários nas primeiras 2 horas
- [ ] Postagem na aba Comunidade (se disponível)

## A8. Métricas e ajustes (D+1 a D+7)

| Métrica (Studio → Análises) | Leitura | Se estiver ruim |
|---|---|---|
| **CTR de impressões** | Mede título + miniatura. Faixas variam muito por nicho e canal; compare com **seus** vídeos anteriores, não com um número mágico | Troque miniatura primeiro, depois título |
| **Retenção** (gráfico) | Queda brusca nos primeiros 30 s = gancho fraco; queda em um ponto = trecho cortável | Reedite cortando o trecho; no próximo, mude a abertura |
| **Tempo médio de visualização** | Sinal de qualidade do conteúdo | Encurtar, tirar introdução |
| **Origens de tráfego** | Pesquisa × sugeridos × externo | Pesquisa baixa → revisar palavras-chave do título/descrição |
| **Conversão no seu site** (UTM) | O objetivo comercial real | Revisar CTA e página de destino |

Não troque título e miniatura ao mesmo tempo (você não saberá o que funcionou) e espere pelo menos 48–72 h de dados.

---

# FRENTE B — Caça a bugs de UI (Bug Hunting)

## B0. Princípio

Sua auditoria visual é a **fonte da verdade**: ela vê o que o código não mostra. A varredura automática acha a classe de erro que o olho não vê. O processo une as duas, e **nenhum bug é "corrigido" sem reprodução e sem verificação depois**.

## B1. Rodada 1 — Triagem da sua auditoria (hoje, 1–2 h)

Converta cada observação em um ticket com este modelo. Sem passo a passo, não é bug, é impressão:

```
ID:            UI-001
Tela / rota:   /painel-loja · aba Pedidos
Perfil:        loja | promotor | admin
Dispositivo:   iPhone 13 Safari 17 · tema escuro · rede 4G
Passos:        1) ...  2) ...  3) ...
Esperado:      ...
Obtido:        ...  (print/vídeo anexado)
Frequência:    sempre | às vezes (quando?) | uma vez
Severidade:    P0 quebra fluxo/dinheiro · P1 bug visível · P2 acabamento · P3 ideia
```

Classifique em **cinco baldes**, porque cada um tem um jeito diferente de caçar:
1. **Travas e cliques mortos** (botão não responde, fica desabilitado, modal que não fecha)
2. **Renderização** (layout quebrado, texto cortado, sobreposição, scroll horizontal, piscar de tela)
3. **Estado velho** (lista duplicada, dado de outra conta, tela não atualiza)
4. **Lixo de interface** (texto técnico/erro cru, placeholder esquecido, rótulo inconsistente, ícone sem função)
5. **Silenciosos** (erro só no Console, requisição 4xx/5xx, falha que o usuário não percebe)

Ordem de ataque: **P0 → P1 em fluxos de dinheiro e cadastro → P1 restantes → P2 → P3.**

## B2. Rodada 2 — Varredura automática (hoje, 15 min + correção)

O script `scripts/auditoria-ui.mjs` (sem dependências) analisa HTML/JS/CSS:

```bash
node scripts/auditoria-ui.mjs .          # relatório legível; sai com código 1 se houver CRITICO
node scripts/auditoria-ui.mjs . --json   # para CI
```

Adicione ao `package.json`: `"audit:ui": "node scripts/auditoria-ui.mjs ."` e rode no CI/pré-commit. Ele cobre:

| Regra | Bug que evita |
|---|---|
| `id-duplicado`, `id-do-js-inexistente`, `alvo-inexistente` | Botão que "não faz nada"; tela que trava sem erro |
| `listener-em-funcao-repetida` | Clique que dispara 2, 3, 4× depois de reabrir a tela |
| `botao-fica-travado` | Botão morto após falha de rede (falta `finally`) |
| `onSnapshot-sem-cancelar` | Lista duplicando ao trocar de conta; custo de leituras crescendo |
| `innerHTML-sem-escape` | Nome com aspas/`<` quebrando o layout (e XSS) |
| `ios-zoom-no-foco` | iPhone dá zoom ao tocar no campo e não volta |
| `100vh-mobile`, `alvo-de-toque-pequeno`, `largura-fixa` | Rodapé escondido, botão difícil de tocar, barra horizontal |
| `transition-all`, `reduced-motion` | Engasgo em aparelho fraco |
| `recurso-inexistente`, `sw-cache-inexistente`, `manifest-icone` | 404s; service worker que não instala (app nunca atualiza) |
| `lixo-debug`, `catch-vazio`, `css-morto`, `classe-sem-css` | Lixo e erro engolido |

**Precisão importa mais que volume.** A 1ª versão deste script acusou 233 itens, a maioria falsos positivos (`?.` seguro, elementos criados em JS, `<style>` inline, `finally` fora da janela). Calibrei até ficar útil e **confirmei cada achado alto à mão**. Teste de sanidade: num projeto de exemplo com um bug plantado por regra principal (id duplicado, ouvinte repetido, botão sem `finally`, fonte de 14 px, `100vh`...), ele acusou todos.

### Resultado real no código que você enviou

Rodei no zip `Abastece_J--main.zip`: **0 críticos, 1 alto, 6 médios**. Verificados manualmente:

| # | Achado | Veredito | Correção |
|---|---|---|---|
| 1 | `style.css:116` — `input, select, textarea` com `font-size: 15px` | **Bug real (ALTO).** No Safari do iPhone, campo com fonte < 16 px dá zoom automático ao focar e a tela fica "pulada/desalinhada". É o tipo de micro-trava que o usuário sente e não sabe descrever | `font-size: 16px` em `input, select, textarea` (se quiser visual de 15 px, reduza só o texto fora dos campos) |
| 2 | `index.html:254`, `promotor.html:374` — `#chat-input` só com placeholder | Real (acessibilidade) | `aria-label="Mensagem"` |
| 3 | `.btn-sm` ≈ 37 px, `.pill` ≈ 35 px, `.icon-btn` 38 px de altura | Real (toque) | Subir para ≥ 44 px de área clicável (pode ser com `min-height: 44px` ou padding invisível `::after`) |
| 4 | `style.css:489` — `transition: all` | Menor | Listar só `color, background, transform, opacity` |
| 5 | `taxas.js:34` — `setInterval` a cada 5 min sem pausar com a aba oculta | Menor, não é leak (a função é iniciada 1× por página) | Pular a chamada quando `document.hidden` |
| 6 | `botao-fica-travado` em `script.js:229`, `script-personal.js:170, 613` | **Falso positivo, verificado**: os dois primeiros têm `finally` (linhas 244 e 182); `hb-avaliar` é controlado por estado | nenhuma |
| 7 | `listener-em-render` em `recado.js`, `ui.js`, `script.js:376`, `admin.js` | **Falso positivo**: o ouvinte é registrado em elemento recém-criado ou fora da função | nenhuma |

Conclusão honesta: **estaticamente o código está limpo; os bugs que você viu nas telas vêm de comportamento em execução** (estado, rede, aparelho), e para eles a Rodada 3 é essencial.

## B3. Rodada 3 — Varredura manual com matriz (amanhã cedo ou hoje à noite, 2–3 h)

**Matriz mínima** (cada tela principal × cada linha):

| Eixo | Valores |
|---|---|
| Aparelho | iPhone Safari (375 px) · Android Chrome (360 px) · desktop 1366 · tablet |
| Tema | escuro · claro · trocar o tema com a tela aberta |
| Perfil | loja · promotor · admin |
| Estado dos dados | **vazio** · carregando · 1 item · 50 itens · erro de rede · offline |
| Texto | nome longo (60+ caracteres) · aspas `"` e `<b>` no nome · emoji · acento · campo vazio |
| Conexão | rápida · Slow 3G (DevTools) · cair a rede no meio do envio |

**Telas e fluxos obrigatórios** (ordem de risco):
1. Login/cadastro (entrar × criar, CPF duplicado, conta bloqueada)
2. Criar pedido → aceitar → pagar → nota (fluxo de dinheiro, repetir 2× rápido: não pode duplicar)
3. Chat e fotos; avaliação; cancelamento
4. Carteira, saque, extrato
5. Admin: aprovar/bloquear/editar/excluir
6. Instalar como app (PWA), abrir offline, atualizar versão

**Em cada tela, verifique:**
- [ ] Console limpo (0 erros e 0 warnings) e Network sem 4xx/5xx inesperado
- [ ] Nada de texto técnico/inglês/código de erro cru ao usuário
- [ ] Estados: vazio mostra mensagem útil; carregando mostra skeleton; erro mostra o que fazer
- [ ] Clique duplo rápido em qualquer botão de ação não duplica o efeito
- [ ] Voltar do navegador, recarregar (F5) e trocar de aba não perdem nem duplicam dados
- [ ] Teclado do celular não cobre o campo em foco nem o botão de enviar
- [ ] Rolagem: sem barra horizontal; modal aberto trava o fundo e **destrava** ao fechar
- [ ] Tocar fora/ESC fecha modais; foco volta ao botão que abriu
- [ ] Trocar de conta (sair → entrar com outra) não mostra dado da anterior
- [ ] Rodapé/botões fixos não ficam atrás da barra do iPhone (safe-area)
- [ ] Tema: sem "piscar" claro→escuro ao abrir a página
- [ ] Datas/horas na timezone certa (o servidor usa America/Sao_Paulo)
- [ ] Lighthouse (celular): Acessibilidade ≥ 90, Boas práticas ≥ 90; CLS < 0.1

**Ferramentas do navegador (DevTools):**
- *Rendering → Layout Shift Regions* e *Paint flashing*: mostram piscadas e saltos de layout.
- *Performance* → gravar abrir/fechar uma tela 5×: procure "Long tasks" e crescimento de ouvintes/nós.
- *Console → `getEventListeners(document)`* antes e depois de abrir/fechar uma tela 5×: se o número cresce, há ouvinte vazando.
- *Application → Service Workers*: "Update on reload" ligado nos testes; "Unregister" + limpar storage para testar primeiro acesso.
- *Network → Offline / Slow 3G*: reproduz a maioria das "travas".

## B4. Classes de bug mais prováveis neste app (onde olhar)

| Sintoma que o usuário vê | Causa provável | Onde olhar |
|---|---|---|
| Lista duplica ou mostra dado de outra conta | `onSnapshot` não cancelado ao sair | `parar()` em `script.js` e o `sair()` equivalente em `script-personal.js` |
| Botão "morre" depois de um erro | `disabled = true` sem `finally` | todo handler com `await` (o script detecta) |
| Tela "pula" ao tocar no campo (iPhone) | fonte < 16 px no campo | `style.css:116` (confirmado) |
| Modal aberto e página não rola mais | `no-scroll` no `body` não removido | `ui.js` `abrir`/`fechar`/`dialogo` |
| Toast/modal "atrás" de outro | `z-index` empatado | `style.css` (valores 40, 50, 200, 400, 9999) |
| Tela pisca do escuro para o claro ao abrir | tema aplicado só depois do JS carregar | `ui.js` `iniciarTema` (CSP bloqueia script inline; use `<meta name="color-scheme">` + classe no `<html>` o mais cedo possível) |
| Pedido "para hoje" com horário que já passou é aceito, ou o aviso aparece/some errado perto da meia-noite | a hora é comparada com o **relógio do aparelho** (`script.js:226`, `toTimeString()`); o servidor só confere a **data** (`hojeSP()` em America/Sao_Paulo), não a hora do dia | validar também a hora no servidor em `criarPedido` e deixar o front apenas como aviso rápido |
| App não atualiza depois do deploy | service worker preso em cache antigo | `sw.js` (`VERSAO`); subir a versão a cada release |
| Primeira chamada falha e depois funciona | Render "dormindo" (plano gratuito) | tela de carregamento com tentativa automática |

## B5. Como corrigir sem criar bug novo

1. **Reproduza** (ticket B1) antes de mexer; se não reproduz, não "corrija".
2. **Uma correção por commit**, mensagem com o ID do ticket.
3. **Teste de regressão** quando for lógica (`npm test`); para visual, anexe antes/depois (print).
4. Rode `npm run audit:ui` e `npm test` a cada correção.
5. **Reteste na matriz** (B3) só a tela alterada + a vizinha.
6. Não misture refatoração com correção de bug na véspera de publicar.

## B6. Critério de pronto ("congelar")

- [ ] Zero P0 e zero P1 em fluxo de dinheiro/cadastro
- [ ] `audit:ui` sem CRITICO e sem ALTO não justificado (por escrito)
- [ ] Console limpo nas 6 telas principais, em 2 aparelhos
- [ ] Fluxo completo gravável do início ao fim **sem cortes por causa de bug** (se for aparecer no vídeo)
- [ ] Versão do service worker incrementada e deploy conferido em aba anônima

## B7. Cronograma sugerido

| Janela | Entrega |
|---|---|
| Hoje, 1ª hora | Triagem dos achados da sua auditoria (B1) |
| Hoje, 2ª hora | Rodar `audit:ui`, corrigir os ALTOS (item 1 acima leva minutos) |
| Hoje, tarde | Varredura manual das telas que aparecem no vídeo (B3) |
| Hoje à noite | Congelar versão, deploy, reteste em aba anônima |
| Pós-lançamento | Demais P1/P2 por ordem de impacto; incluir `audit:ui` no CI |

---

## Limites desta entrega

- Eu **não vi suas telas nem seu vídeo**: não sei o tema do vídeo, o canal, nem os bugs que você observou na auditoria visual. Os modelos de título/roteiro são exemplos para você adaptar, e a Frente B parte do código enviado, não das suas anotações. Se você me passar a lista do que viu, eu transformo em tickets e procuro a causa no código.
- O script é **análise estática**: não executa o app. Ele reduz o risco, mas não substitui a Rodada 3.
- Números de YouTube (limites, tamanhos) podem ter mudado: confirme no Studio.
