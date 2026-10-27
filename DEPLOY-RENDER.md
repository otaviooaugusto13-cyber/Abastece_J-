# Deploy no Render

O servidor (`server/`) serve a API **e** o site; use **Web Service** (não Static Site). O passo a passo completo e as variáveis de ambiente estão em **MUDANCAS.md → "Subir em produção"**; o `render.yaml` já lista todas as variáveis.

Resumo: `rootDir: server` · build `npm install` · start `npm start` · health check `/saude` · defina `AMBIENTE=producao`.
Em `AMBIENTE=producao` o servidor **se recusa a subir** sem `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `APP_URL` e as chaves de criptografia, e recusa `MODO_TESTE`.
Para homologação use `AMBIENTE=homolog` + `MODO_TESTE=1`.
