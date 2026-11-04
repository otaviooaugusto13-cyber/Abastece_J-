# Sessões independentes, Google, e-mail/senha e identidade visual

## 1. Painel de TI × Painel Admin
**Causa:** todos os painéis usavam o mesmo app do Firebase, portanto a mesma sessão no navegador (`firebase:authUser:<apiKey>:[DEFAULT]`). Entrar no Admin trocava o usuário do painel de TI; o TI recebia "sem permissão" e dava `signOut`, e o Admin via a conta de TI e mostrava "sem acesso".
**Correção (`firebase.js`):** o painel de TI e o Admin agora têm app Firebase próprio (`"ti"` e `"admin"`), logo sessão própria. Detectado por `<meta name="abastece-portal">` (em `ti.html` e `admin.html`) ou pela URL. Loja e promotor seguem compartilhando o app padrão (uma conta pode ter os dois perfis). `admin.js`: conta sem permissão agora faz `signOut` só da sessão do Admin.
**Efeito único:** quem estava logado no TI/Admin precisa entrar uma vez de novo. Use contas diferentes para TI e Admin (o servidor já impede converter uma na outra).

## 2. Login com Google
Não consegui testar o OAuth real (sem rede/credenciais aqui). Mudanças que removem as causas prováveis:
- `entrarComGoogle()` agora tenta **popup** primeiro (não depende do armazenamento entre sites) e só cai no **redirect** se o popup for impossível.
- `config.js`: `authDomain` volta a ser `abastece-ja-240d5.firebaseapp.com` (já autorizado, sem configuração manual). O modo anterior (host do site + proxy `/__/auth/*`) ficou atrás de `USAR_PROXY_AUTH = true`: ele exige cadastrar `https://SEU-HOST/__/auth/handler` no cliente OAuth do Google Cloud e o host nos Domínios autorizados; se o host do Render mudar, todos os botões quebram.
- `sw.js` (v13): não intercepta mais `/__/…` (handler do login) nem `/painel-ti`/`/painel-admin`.
- CSP: `frame-src` ganhou `apis.google.com` e `content.googleapis.com`.
- Mensagens de erro melhores (popup bloqueado, domínio não autorizado, provedor desativado).
**Conferir no Firebase Console:** Authentication › Método de login: **Google** e **E-mail/senha** ativados; Configurações › Domínios autorizados: o domínio do site presente.

## 3. E-mail e senha (Sou loja / Sou promotor)
- Novo `login-email.js` + formulário em `index.html` e `promotor.html` (e-mail, senha, mostrar senha, Entrar/Criar, "Esqueci minha senha", divisor "ou", Google), estilos no fim de `style.css`.
- Em "Criar nova conta": nome, repetir senha (mín. 8), aceite dos Termos (o mesmo do Google) e e-mail de confirmação.
- O servidor só aceita e-mail verificado; por isso, conta sem confirmação vê a tela "Confirme seu e-mail" (`acesso.js › telaVerificarEmail`: já confirmei / reenviar / outra conta). Nenhuma mudança no servidor foi necessária.

## 4. Assets (a partir de `1793453437397_image.png`; só esta imagem foi enviada)
- `assets/brand/abastece-ja-poster.png` (original), `assets/brand/logo-escudo.png` (escudo transparente, usado nas telas de login).
- `icons/icon-192|512.png`, `icons/icon-maskable-512.png`, `icons/apple-touch-icon-180.png`, `icons/favicon-32.png` (+ cópias legadas na raiz). `manifest.json`: `background_color` combinando com o ícone.
- `assets/splash/splash-<L>x<A>.png` (13 tamanhos de iPhone/iPad) ligados por `apple-touch-startup-image` em `index.html` e `promotor.html`. No Android a abertura usa o ícone + `background_color`.
- Tudo regenerável: `python3 scripts/gerar-assets.py` (pillow, numpy, scipy).
