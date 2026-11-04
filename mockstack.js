'use strict';
// Sobe a loja + um "Stripe falso" para testar o navegador. Uso: node test/mockstack.js <paid|unpaid|noapk|nokeys>
const http = require('node:http'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { createApp } = require('../server.js');
const mode = process.argv[2] || 'paid';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vlstack-'));
fs.symlinkSync(path.join(__dirname, '..', 'public'), path.join(root, 'public'));
fs.mkdirSync(path.join(root, 'downloads'));
fs.writeFileSync(path.join(root, 'downloads', 'VidaLoka-Setup.exe'), Buffer.from('MZ' + 'e'.repeat(70000)));
if (mode !== 'noapk') fs.writeFileSync(path.join(root, 'downloads', 'VidaLoka.apk'), Buffer.from('PK' + 'a'.repeat(50000)));
const sessions = {}; let n = 0;
const stripe = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
    const send = (st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
      const id = 'cs_test_flow' + (++n) + 'abcdef'; const paid = mode !== 'unpaid';
      sessions[id] = { id, status: paid ? 'complete' : 'open', payment_status: paid ? 'paid' : 'unpaid', metadata: { product: 'vida-loka' } };
      return send(200, { id, client_secret: id + '_secret_xyz' });
    }
    const m = /^\/v1\/checkout\/sessions\/(.+)$/.exec(req.url);
    if (m && sessions[m[1]]) return send(200, sessions[m[1]]);
    send(404, { error: { message: 'No such session' } });
  });
});
stripe.listen(0, '127.0.0.1', () => {
  const env = { STRIPE_API_BASE: 'http://127.0.0.1:' + stripe.address().port, PORT: '0' };
  if (mode !== 'nokeys') { env.STRIPE_SECRET_KEY = 'sk_test_x'; env.STRIPE_PUBLISHABLE_KEY = 'pk_test_PUBLICA123'; }
  const app = http.createServer(createApp({ env, rootDir: root }));
  app.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: app.address().port })));
});
