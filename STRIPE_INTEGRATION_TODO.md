# Stripe — o que falta para o pagamento funcionar

Este arquivo é a fonte única do que ainda precisa ser feito. O código do Stripe já está pronto e não contém nenhuma chave.

## 1. Valores para substituir (arquivo `.env`)

Copie `.env.example` para `.env` e preencha:

| Variável | O que colocar | Onde achar |
|---|---|---|
| `STRIPE_SECRET_KEY` | chave secreta (`sk_test_...`, depois `sk_live_...`) | Stripe Dashboard > Desenvolvedores > Chaves de API |
| `STRIPE_PUBLISHABLE_KEY` | chave publicável (`pk_test_...`, depois `pk_live_...`) | mesmo lugar |
| `DOMAIN` | endereço público do site, sem barra no final (em produção, HTTPS) | seu domínio |
| `PRICE_CENTS` | preço em centavos (800 = R$ 8,00) | já vem 800 |

A chave secreta fica só no servidor (`server.js`). Nunca vai para o navegador nem para o código.

## 2. Parâmetros configurados (não alterar)

Estes valores vêm do Checkout Studio e estão aplicados exatamente como foram fornecidos, em `server.js`:

| Parâmetro | Valor | Onde |
|---|---|---|
| `ui_mode` | `form` | `server.js` (criação da sessão) |
| `mode` | `payment` | `server.js` |
| `return_url` | `${DOMAIN}/obrigado.html?session_id={CHECKOUT_SESSION_ID}` | `server.js` |
| `billing_address_collection` | `auto` | `server.js` |
| `phone_number_collection.enabled` | `false` | `server.js` |
| `automatic_tax.enabled` | `false` | `server.js` |
| `submit_type` | `auto` | `server.js` |
| `integration_identifier` | `custom_embedded_web_0001` | `server.js` |
| `line_items[0].price_data` | `brl`, `unit_amount` = `PRICE_CENTS`, produto "Vida Loka" | `server.js` |
| `metadata.product` | `vida-loka` | `server.js` (usado para validar o pedido) |
| versão da API | `2026-03-25.dahlia` | `server.js` |

No navegador (`public/js/checkout.js`): Stripe.js é carregado direto de `https://js.stripe.com/dahlia/stripe.js` (nunca copie esse arquivo para o projeto), com `initCheckoutFormSdk`, `createForm({ layout: 'expanded' })`, `mount('#checkout-form')`, `loadActions()` e `form.on('confirm', ...)`. A aparência (tema escuro) está no objeto `appearance` do mesmo arquivo.

## 3. Como rodar

1. Instale o Node.js 18 ou mais novo.
2. Na pasta do projeto: `cp .env.example .env` e preencha as chaves.
3. Ponha o `.exe` (e o `.apk`, se tiver) na pasta `downloads/`, ou configure `EXE_URL` (veja a seção 5).
4. `node server.js` e abra `http://localhost:3000`.
5. Teste com o cartão `4242 4242 4242 4242`, validade futura, CVC qualquer, e chaves de TESTE.
6. Só depois troque para as chaves `live` e o `DOMAIN` real em HTTPS.

Pix e boleto só aparecem se estiverem ativados em Stripe Dashboard > Configurações > Métodos de pagamento. Boleto é pago depois: a página "obrigado" fica consultando o Stripe a cada 5 s e libera o download quando o pagamento entrar.

Hospedagem: serve qualquer lugar que rode Node (VPS, Render, Railway, Fly.io). Se ficar atrás de proxy/Cloudflare, ponha `TRUST_PROXY=1`.

## 4. Como funciona o fluxo

1. `index.html` → botão "Comprar Jogo" → `checkout.html`.
2. `checkout.js` pede ao servidor `POST /api/create-checkout-session` e monta o formulário do Stripe na página.
3. O cliente paga; o Stripe redireciona para `obrigado.html?session_id=...`.
4. `obrigado.js` chama `GET /api/order-status`. O servidor consulta o Stripe: só se o pagamento estiver `paid` e a sessão for deste produto, devolve os links.
5. A página inicia os downloads sozinha e mostra "APK E .exe iniciados." (ou ".exe iniciado." se só houver o .exe). Se um arquivo não existir, avisa de forma honesta e não finge que baixou.
6. `GET /api/download/exe` e `/api/download/apk` verificam o pagamento de novo no Stripe a cada pedido. A pasta `downloads/` não é pública.

## 5. Download do .exe (ponto de integração)

Arquivo: `exe-download.js`. Ele já funciona de duas formas, sem editar:

- **A)** colocar o `.exe` em `downloads/`;
- **B)** `EXE_URL=https://...` no `.env` (link direto do arquivo).

Se o `.exe` ficar num serviço com link assinado (S3, R2, GCS), edite só a função dentro de `exe-download.js` e retorne `{ type: 'redirect', url }`. Há um exemplo comentado no arquivo. O prompt pronto para o ChatGPT está em `PROMPT_PARA_CHATGPT.md`.

## 6. Textos que mencionam o .apk

Se for vender só o .exe por enquanto, ajuste estas frases (busque por "apk"): `public/index.html` (placa de preço e seção de compra), `public/checkout.html` (resumo) e `server.js` (descrição do produto no Stripe).

## 7. Estrutura

```
server.js            servidor + API Stripe + downloads protegidos
exe-download.js      PONTO DE INTEGRAÇÃO do .exe
downloads/           .exe e .apk (privada)
public/              site (index, checkout, obrigado, css, js, imagens, trailer)
test/                testes automáticos (usam um Stripe simulado)
.env.example         modelo de configuração
```

## 8. Ajuda

- Suporte Stripe: https://support.stripe.com
- Stripe MCP: https://docs.stripe.com/mcp
