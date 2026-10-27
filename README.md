# Abastece Já

Marketplace B2B que conecta supermercados/varejo a promotores autônomos (a partir de 16 anos) para turnos de reposição.

- **Modelo:** diária de **R$ 200,00** → **R$ 50,00** de comissão da plataforma + **R$ 150,00** na carteira digital do profissional.
- **Stack:** HTML/CSS/JS (módulos ES) + Firebase Auth/Firestore + servidor Node/Express (Render) + Mercado Pago.
- **Regras de negócio e dinheiro vivem no servidor** (`server/`). O navegador só exibe.

```
server/  server.js (composição + hardening) · split.js (modelo financeiro) · lib/ (cripto, validação, carteira, treinamento, habilitação, segurança) · rotas/
*.html + *.js   loja (index), profissional (promotor), admin, pagar, nota, landing
firestore.rules · firestore.indexes.json · scripts/ (definir-admin, gerar-chaves, migrar-dados) · test/
```

```bash
npm install --prefix server
npm test                      # paridade navegador×servidor + 31 testes de backend (sem rede)
MODO_TESTE=1 npm start        # sandbox local: contas fictícias e pagamento simulado (proibido em produção)
```

Leia **MUDANCAS.md** (decisões e deploy) e **SEGURANCA.md** (modelo de ameaças, OWASP, checklist de pentest).
