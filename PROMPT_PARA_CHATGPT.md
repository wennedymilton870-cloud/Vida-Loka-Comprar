# Prompt para colar no ChatGPT (download do .exe depois do pagamento)

Copie tudo abaixo da linha e cole no ChatGPT junto com o arquivo `exe-download.js` (e, se quiser, `server.js`).

---

Tenho uma loja em Node.js (sem dependências, Node 18+) que vende um jogo via Stripe Checkout. Depois que o Stripe confirma o pagamento, o servidor chama a função `resolveExe(ctx)` do arquivo `exe-download.js`. Preciso que o download do **.exe do Windows** funcione do jeito que eu descrever abaixo. Só o .exe; ignore o .apk.

**Onde meu .exe está hospedado:** [DESCREVA: ex. GitHub Releases privado / S3 / Cloudflare R2 / Google Drive / no próprio servidor]

**Contrato da função (não mude a assinatura):**

```js
module.exports = async function resolveExe(ctx) { ... }
```

- `ctx.session`: sessão do Stripe já verificada e paga (`ctx.session.id`, `ctx.session.customer_details`...).
- `ctx.env`: variáveis do `.env`.
- `ctx.downloadsDir`: caminho absoluto da pasta `downloads/`.
- `ctx.localFile('exe')`: acha um `.exe` em `downloads/` e retorna `{ name, full }` ou `null`.

**Deve retornar um destes:**
- `{ type: 'file', path: '/caminho/absoluto/Jogo.exe', name: 'Jogo.exe' }` — o servidor envia o arquivo (com suporte a Range).
- `{ type: 'redirect', url: 'https://...' }` — o navegador é levado a esse link (use link assinado com validade curta, 5 minutos).
- `null` — .exe indisponível (a página mostra um aviso honesto).

**Regras:**
1. Edite só `exe-download.js`. Não altere a verificação do Stripe em `server.js`.
2. Nunca exponha o link/arquivo do .exe antes do pagamento. Essa função só é chamada depois de confirmado.
3. Não coloque chaves no código; leia tudo de `ctx.env` (e me diga quais variáveis novas devo pôr no `.env`).
4. Sem dependências novas, a menos que seja inevitável. Se precisar (ex.: SDK da AWS), diga o comando `npm i` e crie o `package.json` necessário.
5. Para links externos, o arquivo deve baixar (não abrir no navegador): use `Content-Disposition: attachment` quando o provedor permitir.
6. Me entregue o arquivo `exe-download.js` completo e um passo a passo curto para testar.

---
