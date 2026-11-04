'use strict';
// Testes do servidor contra um "Stripe falso" (servidor HTTP local que imita a API REST do Stripe).
// Rodar:  node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server.js');

function listen(handler) {
  return new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve({ s, port: s.address().port })); });
}
async function setup() {
  // pasta temporária com public/ (copiada) e downloads/ de teste
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-'));
  fs.mkdirSync(path.join(root, 'public'));
  fs.writeFileSync(path.join(root, 'public', 'index.html'), '<h1>ola</h1>');
  fs.writeFileSync(path.join(root, 'public', 'video.mp4'), Buffer.from('0123456789abcdef'));
  fs.writeFileSync(path.join(root, 'secret.txt'), 'segredo');
  fs.mkdirSync(path.join(root, 'downloads'));
  const exe = Buffer.from('MZ-exe-de-teste-' + 'x'.repeat(5000));
  const apk = Buffer.from('PK-apk-de-teste-' + 'y'.repeat(3000));
  fs.writeFileSync(path.join(root, 'downloads', 'VidaLoka-Setup.exe'), exe);
  fs.writeFileSync(path.join(root, 'downloads', 'VidaLoka.apk'), apk);

  const calls = []; const sessions = {};
  const stripeMock = await listen((req, res) => {
    let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
      calls.push({ method: req.method, url: req.url, headers: req.headers, body });
      const send = (st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.headers.authorization !== 'Bearer sk_test_ok') return send(401, { error: { message: 'Invalid API Key provided' } });
      if (req.method === 'POST' && req.url === '/v1/checkout/sessions') return send(200, { id: 'cs_test_novo123456', client_secret: 'cs_test_novo123456_secret_abc', status: 'open' });
      const m = /^\/v1\/checkout\/sessions\/(.+)$/.exec(req.url);
      if (req.method === 'GET' && m && sessions[m[1]]) return send(200, sessions[m[1]]);
      return send(404, { error: { message: 'No such checkout.session' } });
    });
  });
  const env = { STRIPE_SECRET_KEY: 'sk_test_ok', STRIPE_PUBLISHABLE_KEY: 'pk_test_ok', STRIPE_API_BASE: `http://127.0.0.1:${stripeMock.port}`, DOMAIN: 'https://loja.exemplo.com', PORT: '3999' };
  const app = await listen(createApp({ env, rootDir: root }));
  const base = `http://127.0.0.1:${app.port}`;
  return { root, exe, apk, calls, sessions, base, env, close: () => { app.s.close(); stripeMock.s.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('config entrega só a chave pública', async () => {
  const t = await setup();
  const r = await fetch(t.base + '/api/config'); const j = await r.json();
  assert.equal(r.status, 200); assert.deepEqual(j, { publishableKey: 'pk_test_ok' });
  assert.ok(!JSON.stringify(j).includes('sk_'));
  t.close();
});

test('create-checkout-session manda exatamente os parâmetros esperados ao Stripe', async () => {
  const t = await setup();
  const r = await fetch(t.base + '/api/create-checkout-session', { method: 'POST' }); const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.client_secret, 'cs_test_novo123456_secret_abc');
  const c = t.calls[0]; assert.equal(c.method, 'POST'); assert.equal(c.url, '/v1/checkout/sessions');
  assert.equal(c.headers['stripe-version'], '2026-03-25.dahlia');
  assert.equal(c.headers['content-type'], 'application/x-www-form-urlencoded');
  const p = new URLSearchParams(c.body); const got = Object.fromEntries(p.entries());
  assert.deepEqual(got, {
    ui_mode: 'form', mode: 'payment',
    'line_items[0][price_data][currency]': 'brl', 'line_items[0][price_data][unit_amount]': '800',
    'line_items[0][price_data][product_data][name]': 'Vida Loka',
    'line_items[0][price_data][product_data][description]': 'Jogo completo para Windows (.exe) e Android (.apk)',
    'line_items[0][quantity]': '1',
    return_url: 'https://loja.exemplo.com/obrigado.html?session_id={CHECKOUT_SESSION_ID}',
    billing_address_collection: 'auto', 'phone_number_collection[enabled]': 'false', 'automatic_tax[enabled]': 'false',
    submit_type: 'auto', integration_identifier: 'custom_embedded_web_0001', 'metadata[product]': 'vida-loka',
  });
  assert.ok(!('payment_method_collection' in got)); // só para assinatura
  t.close();
});

test('chave do Stripe errada vira erro claro (e não vaza a chave)', async () => {
  const t = await setup(); t.close();
  const t2 = await (async () => { const x = await setup(); return x; })();
  // recria o app com chave inválida
  const { createApp: mk } = require('../server.js');
  const bad = await listen(mk({ env: Object.assign({}, t2.env, { STRIPE_SECRET_KEY: 'sk_test_errada' }), rootDir: t2.root }));
  const r = await fetch(`http://127.0.0.1:${bad.port}/api/create-checkout-session`, { method: 'POST' }); const j = await r.json();
  assert.equal(r.status, 502); assert.match(j.error, /Invalid API Key/); assert.ok(!JSON.stringify(j).includes('sk_test_errada'));
  bad.s.close(); t2.close();
});

test('sem chaves no .env: respostas de erro explicam o que falta', async () => {
  const t = await setup();
  const { createApp: mk } = require('../server.js');
  const bare = await listen(mk({ env: { PORT: '3999' }, rootDir: t.root }));
  const a = await fetch(`http://127.0.0.1:${bare.port}/api/config`); assert.equal(a.status, 500); assert.match((await a.json()).error, /STRIPE_PUBLISHABLE_KEY/);
  const b = await fetch(`http://127.0.0.1:${bare.port}/api/create-checkout-session`, { method: 'POST' }); assert.equal(b.status, 500); assert.match((await b.json()).error, /STRIPE_SECRET_KEY/);
  const c = await fetch(`http://127.0.0.1:${bare.port}/`); assert.equal(c.status, 200); // o site abre mesmo assim
  bare.s.close(); t.close();
});

test('order-status e download: só liberam depois de pago', async () => {
  const t = await setup();
  const paid = 'cs_test_pago123456', open = 'cs_test_aberto123456', outro = 'cs_test_outroproduto1';
  t.sessions[paid] = { id: paid, status: 'complete', payment_status: 'paid', metadata: { product: 'vida-loka' } };
  t.sessions[open] = { id: open, status: 'open', payment_status: 'unpaid', metadata: { product: 'vida-loka' } };
  t.sessions[outro] = { id: outro, status: 'complete', payment_status: 'paid', metadata: { product: 'outra-coisa' } };

  let r = await fetch(`${t.base}/api/order-status?session_id=${paid}`); let j = await r.json();
  assert.equal(r.status, 200); assert.deepEqual(j, { status: 'complete', paid: true, files: { exe: true, apk: true } });
  r = await fetch(`${t.base}/api/order-status?session_id=${open}`); j = await r.json(); assert.equal(j.paid, false);

  // pago -> baixa o arquivo certo, com os bytes certos
  r = await fetch(`${t.base}/api/download/exe?session_id=${paid}`);
  assert.equal(r.status, 200); assert.match(r.headers.get('content-disposition'), /attachment; filename="VidaLoka-Setup\.exe"/);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), t.exe);
  r = await fetch(`${t.base}/api/download/apk?session_id=${paid}`);
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/vnd.android.package-archive');
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), t.apk);

  // não pago / outro produto / inválido / sem id -> nada de download
  r = await fetch(`${t.base}/api/download/exe?session_id=${open}`); assert.equal(r.status, 402); assert.ok(!(await r.text()).includes('MZ-exe'));
  r = await fetch(`${t.base}/api/download/exe?session_id=${outro}`); assert.equal(r.status, 404);
  r = await fetch(`${t.base}/api/download/exe?session_id=cs_test_naoexiste1234`); assert.equal(r.status, 404);
  r = await fetch(`${t.base}/api/download/exe?session_id=../../etc/passwd`); assert.equal(r.status, 400);
  r = await fetch(`${t.base}/api/download/exe`); assert.equal(r.status, 400);
  r = await fetch(`${t.base}/api/download/zip?session_id=${paid}`); assert.equal(r.status, 404);
  // a pasta downloads/ nunca é servida como arquivo estático
  r = await fetch(`${t.base}/downloads/VidaLoka-Setup.exe`); assert.equal(r.status, 404);
  r = await fetch(`${t.base}/..%2fdownloads%2fVidaLoka-Setup.exe`); assert.ok([403, 404].includes(r.status));
  t.close();
});

test('arquivo ausente: pago mas sem .apk -> avisa em vez de quebrar', async () => {
  const t = await setup(); fs.unlinkSync(path.join(t.root, 'downloads', 'VidaLoka.apk'));
  const id = 'cs_test_pago123456'; t.sessions[id] = { id, status: 'complete', payment_status: 'paid', metadata: { product: 'vida-loka' } };
  let r = await fetch(`${t.base}/api/order-status?session_id=${id}`); let j = await r.json(); assert.deepEqual(j.files, { exe: true, apk: false });
  r = await fetch(`${t.base}/api/download/apk?session_id=${id}`); assert.equal(r.status, 404); assert.match((await r.json()).error, /apk/);
  t.close();
});

test('site estático: páginas, Range de vídeo e proteção contra ../', async () => {
  const t = await setup();
  let r = await fetch(t.base + '/'); assert.equal(r.status, 200); assert.equal(await r.text(), '<h1>ola</h1>');
  r = await fetch(t.base + '/video.mp4', { headers: { Range: 'bytes=2-5' } });
  assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), 'bytes 2-5/16'); assert.equal(await r.text(), '2345');
  r = await fetch(t.base + '/video.mp4', { headers: { Range: 'bytes=-4' } }); assert.equal(r.status, 206); assert.equal(await r.text(), 'cdef');
  r = await fetch(t.base + '/video.mp4', { headers: { Range: 'bytes=99-' } }); assert.equal(r.status, 416);
  r = await fetch(t.base + '/nao-existe.html'); assert.equal(r.status, 404);
  for (const p of ['/..%2fsecret.txt', '/%2e%2e/secret.txt', '/..%5csecret.txt', '/%00']) {
    const x = await fetch(t.base + p); assert.ok(x.status >= 400, p + ' -> ' + x.status); assert.ok(!(await x.text()).includes('segredo'));
  }
  r = await fetch(t.base + '/index.html', { method: 'POST' }); assert.equal(r.status, 405);
  t.close();
});

test('limite de pedidos: a 21ª sessão em 10 min é recusada', async () => {
  const t = await setup(); let last;
  for (let i = 0; i < 21; i++) last = await fetch(t.base + '/api/create-checkout-session', { method: 'POST' });
  assert.equal(last.status, 429); t.close();
});

test('ponto de integração do .exe: EXE_URL redireciona só depois de pago', async () => {
  const t = await setup();
  const { createApp: mk } = require('../server.js');
  const ext = await listen(mk({ env: Object.assign({}, t.env, { EXE_URL: 'https://arquivos.exemplo.com/VidaLoka.exe' }), rootDir: t.root }));
  const base = `http://127.0.0.1:${ext.port}`;
  const paid = 'cs_test_pago123456', open = 'cs_test_aberto123456';
  t.sessions[paid] = { id: paid, status: 'complete', payment_status: 'paid', metadata: { product: 'vida-loka' } };
  t.sessions[open] = { id: open, status: 'open', payment_status: 'unpaid', metadata: { product: 'vida-loka' } };
  let r = await fetch(`${base}/api/download/exe?session_id=${paid}`, { redirect: 'manual' });
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), 'https://arquivos.exemplo.com/VidaLoka.exe');
  r = await fetch(`${base}/api/download/exe?session_id=${open}`, { redirect: 'manual' });
  assert.equal(r.status, 402); assert.equal(r.headers.get('location'), null); // link nunca aparece antes do pagamento
  r = await fetch(`${base}/api/order-status?session_id=${open}`); assert.deepEqual((await r.json()).files, { exe: false, apk: false });
  // link inseguro (http fora do localhost) é recusado
  const bad = await listen(mk({ env: Object.assign({}, t.env, { EXE_URL: 'http://site-qualquer.com/a.exe' }), rootDir: t.root }));
  fs.unlinkSync(path.join(t.root, 'downloads', 'VidaLoka-Setup.exe'));
  r = await fetch(`http://127.0.0.1:${bad.port}/api/download/exe?session_id=${paid}`, { redirect: 'manual' }); assert.equal(r.status, 404);
  ext.s.close(); bad.s.close(); t.close();
});

test('ponto de integração do .exe: função resolveExe personalizada (ex.: link assinado) é usada', async () => {
  const t = await setup();
  const { createApp: mk } = require('../server.js');
  const seen = [];
  const app = await listen(mk({ env: t.env, rootDir: t.root, resolveExe: async (ctx) => { seen.push(ctx.session.id); return { type: 'redirect', url: 'https://assinado.exemplo.com/x.exe?sig=abc' }; } }));
  const id = 'cs_test_pago123456'; t.sessions[id] = { id, status: 'complete', payment_status: 'paid', metadata: { product: 'vida-loka' } };
  const r = await fetch(`http://127.0.0.1:${app.port}/api/download/exe?session_id=${id}`, { redirect: 'manual' });
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), 'https://assinado.exemplo.com/x.exe?sig=abc'); assert.deepEqual(seen, [id]);
  app.s.close(); t.close();
});

test('pedido inexistente devolve mensagem em português', async () => {
  const t = await setup();
  const r = await fetch(`${t.base}/api/order-status?session_id=cs_test_naoexiste1234`); const j = await r.json();
  assert.equal(r.status, 404); assert.equal(j.error, 'Pedido não encontrado.'); t.close();
});
