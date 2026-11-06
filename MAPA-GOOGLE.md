# Mapa Google Dark (`GoogleDarkMap`)

Substitui o antigo `dark-map.js` (Leaflet + OpenStreetMap, removido).

| Arquivo | Papel |
|---|---|
| `google-dark-map.js` | Motor (JS puro). Exporta `GoogleDarkMap`, `DARK_MAP_STYLE` e `loadGoogleMaps`. |
| `GoogleDarkMap.jsx` | Wrapper React `<GoogleDarkMap />` (para o painel Next/React). |
| `mapa-promotores.js` | Home da loja: usa o motor (círculo de raio, carrinhos que "andam", pin da loja). |
| `config.js` → `GOOGLE_MAPS_KEY` | Chave da Maps JavaScript API. **Precisa ser preenchida.** |

## Ativar
1. Google Cloud → ative **Maps JavaScript API** e o faturamento do projeto.
2. Crie uma chave de API e restrinja: *Sites (HTTP referrers)* com os domínios do app (`https://SEU-HOST/*`, `http://localhost:*/*`) e *API* = só Maps JavaScript API.
3. Cole em `GOOGLE_MAPS_KEY` (`config.js`). Sem chave/chave recusada, o mapa some e a tela mostra só o contador.

## Estilo
`DARK_MAP_STYLE` é o JSON dark (sem POIs, trânsito e ícones). Usa o estilo clássico (sem `mapId`); por isso os pins são HTML sobre `OverlayView`.
Não associe um `mapId` ao mapa: com `mapId` o Google ignora `styles`.

## API do motor
`create(container, opts)` · `setMarkers(list)` · `addHtmlMarker(o)` · `setRadius(km, centro, {fit})` · `setRoute(pts)` · `setUserLocation` / `locate` ·
`flyToPoint` / `centerOnMarker` / `fitToMarkers` · `setInsets({bottom})` · `setStyles(arr)` · `invalidateSize` · `destroy`.

## Atenção
- O logotipo/atribuição do Google fica no canto do container e **não pode ser coberto** (termos de uso). Na home, `style-dock.css` faz o mapa terminar acima do sheet recolhido.
- CSP (`server/lib/seguranca.js`) liberada para `maps.googleapis.com`, `*.gstatic.com`, `*.ggpht.com` e `worker-src blob:`. O exemplo do Google inclui `'unsafe-eval'` no `script-src`; **não** foi adicionado (o teste de segurança do projeto o proíbe). Se o console do navegador acusar bloqueio por eval, é a decisão a revisar.
