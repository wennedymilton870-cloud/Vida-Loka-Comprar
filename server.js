'use strict';
/*
 * Vida Loka — servidor da loja
 *  - serve o site (pasta public/)
 *  - cria a sessão de pagamento do Stripe Checkout (formulário embutido, ui_mode "form")
 *  - libera o download do .exe e do .apk SOMENTE depois que o Stripe confirma o pagamento
 *
 * Não tem dependências: precisa só do Node.js 18 ou superior. Rode com:  node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const resolveExeDefault = require('./exe-download.js');

const STRIPE_API_VERSION = '2026-03-25.dahlia';
const PRODUCT_ID = 'vida-loka';

// ---------- .env (leitor mínimo, sem dotenv) ----------
function loadEnvFile(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch (e) { return; }
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

// ---------- codificação de formulário do Stripe (a[b][0][c]=d) ----------
function encodeForm(obj, prefix, out) {
  out = out || [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((item, i) => {
      if (item !== null && typeof item === 'object') encodeForm(item, `${key}[${i}]`, out);
      else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
    });
    else if (typeof v === 'object') encodeForm(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function createApp(opts) {
  opts = opts || {};
  const env = opts.env || process.env;
  const rootDir = opts.rootDir || __dirname;
  const publicDir = path.join(rootDir, 'public');
  const downloadsDir = path.join(rootDir, 'downloads');
  const fetchFn = opts.fetch || globalThis.fetch;
  const resolveExe = opts.resolveExe || resolveExeDefault;
  const apiBase = (env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, '');
  const port = Number(env.PORT) || 3000;
  const domain = (env.DOMAIN || `http://localhost:${port}`).replace(/\/+$/, '');
  const priceCents = Number(env.PRICE_CENTS) || 800;

  // ----- Stripe (API REST direta) -----
  async function stripe(method, pathname, params) {
    const key = env.STRIPE_SECRET_KEY;
    if (!key) { const e = new Error('Stripe não configurado: falta STRIPE_SECRET_KEY no arquivo .env'); e.status = 500; throw e; }
    const headers = { Authorization: `Bearer ${key}`, 'Stripe-Version': STRIPE_API_VERSION };
    const init = { method, headers };
    if (method === 'POST') { headers['Content-Type'] = 'application/x-www-form-urlencoded'; init.body = encodeForm(params || {}).join('&'); }
    const r = await fetchFn(apiBase + pathname, init);
    let j = null;
    try { j = await r.json(); } catch (e) { /* resposta sem JSON */ }
    if (!r.ok) {
      const e = new Error(r.status === 404 ? 'Pedido não encontrado.' : ((j && j.error && j.error.message) || `Erro do Stripe (${r.status})`));
      e.status = r.status === 404 ? 404 : 502; e.stripe = j && j.error; throw e;
    }
    return j;
  }

  function createSession() {
    // Parâmetros "fixed_by_ui" do Checkout Studio + mode/line_items do produto
    return stripe('POST', '/v1/checkout/sessions', {
      ui_mode: 'form',
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'brl',
          unit_amount: priceCents,
          product_data: { name: 'Vida Loka', description: 'Jogo completo para Windows (.exe) e Android (.apk)' },
        },
        quantity: 1,
      }],
      return_url: `${domain}/obrigado.html?session_id={CHECKOUT_SESSION_ID}`,
      billing_address_collection: 'auto',
      phone_number_collection: { enabled: false },
      automatic_tax: { enabled: false },
      submit_type: 'auto',
      integration_identifier: 'custom_embedded_web_0001',
      metadata: { product: PRODUCT_ID },
    });
  }

  // ----- arquivos do jogo (pasta privada downloads/) -----
  function findDownload(kind) {
    const ext = '.' + kind;
    const wanted = kind === 'exe' ? env.DOWNLOAD_EXE : env.DOWNLOAD_APK;
    let names = [];
    try { names = fs.readdirSync(downloadsDir); } catch (e) { return null; }
    let pick = null;
    if (wanted) pick = names.find((n) => n === path.basename(wanted));
    else pick = names.find((n) => n.toLowerCase().endsWith(ext));
    if (!pick) return null;
    const full = path.join(downloadsDir, pick);
    try { if (!fs.statSync(full).isFile()) return null; } catch (e) { return null; }
    return { name: pick, full };
  }

  // devolve { type:'file'|'redirect', ... } ou null. O .exe passa pelo ponto de integração (exe-download.js)
  async function resolveDownload(kind, session) {
    if (kind === 'exe') {
      const r = await resolveExe({ session, env, downloadsDir, localFile: findDownload });
      if (r && r.type === 'redirect' && /^https?:\/\//i.test(r.url || '')) return r;
      if (r && r.type === 'file' && r.path) return { type: 'file', full: r.path, name: r.name || path.basename(r.path) };
      return null;
    }
    const f = findDownload('apk');
    return f ? { type: 'file', full: f.full, name: f.name } : null;
  }

  // ----- limite simples de pedidos por IP -----
  const hits = new Map();
  function limited(req, max, windowMs) {
    const xf = env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
    const ip = xf || req.socket.remoteAddress || '?';
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    arr.push(now); hits.set(ip, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return arr.length > max;
  }

  // ----- respostas -----
  function json(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  }

  function sendFile(req, res, full, headers) {
    let st;
    try { st = fs.statSync(full); } catch (e) { return json(res, 404, { error: 'Arquivo não encontrado.' }); }
    const h = Object.assign({ 'Accept-Ranges': 'bytes' }, headers);
    let start = 0, end = st.size - 1, status = 200;
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range && (range[1] || range[2])) {
      if (range[1] === '') { start = Math.max(0, st.size - Number(range[2])); }
      else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      status = 206; h['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    h['Content-Length'] = end - start + 1;
    res.writeHead(status, h);
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(full, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  function serveStatic(req, res, pathname) {
    let rel;
    try { rel = decodeURIComponent(pathname); } catch (e) { return json(res, 400, { error: 'Endereço inválido.' }); }
    if (rel.includes('\0')) return json(res, 400, { error: 'Endereço inválido.' });
    if (rel.endsWith('/')) rel += 'index.html';
    const full = path.resolve(publicDir, '.' + path.sep + rel.replace(/^\/+/, ''));
    if (full !== publicDir && !full.startsWith(publicDir + path.sep)) return json(res, 403, { error: 'Acesso negado.' });
    let st; try { st = fs.statSync(full); } catch (e) { st = null; }
    if (!st || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><meta charset="utf-8"><title>Página não encontrada</title><body style="font-family:system-ui;background:#15110e;color:#f3ead8;padding:48px"><h1>Página não encontrada</h1><p><a style="color:#ffc93c" href="/">Voltar para a loja</a></p>');
    }
    const ext = path.extname(full).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const cache = ext === '.html' ? 'no-cache' : 'public, max-age=3600';
    sendFile(req, res, full, { 'Content-Type': type, 'Cache-Control': cache });
  }

  // ----- verificação de pagamento -----
  const SESSION_RE = /^cs_[A-Za-z0-9_]{8,200}$/;
  async function verifiedSession(sessionId) {
    if (!SESSION_RE.test(sessionId || '')) { const e = new Error('Código do pedido inválido.'); e.status = 400; throw e; }
    const s = await stripe('GET', `/v1/checkout/sessions/${sessionId}`);
    if (!s || !s.metadata || s.metadata.product !== PRODUCT_ID) { const e = new Error('Pedido não encontrado.'); e.status = 404; throw e; }
    return s;
  }
  const isPaid = (s) => s.payment_status === 'paid';

  async function handleApi(req, res, url) {
    const p = url.pathname;
    if (p === '/api/config' && req.method === 'GET') {
      if (!env.STRIPE_PUBLISHABLE_KEY) return json(res, 500, { error: 'Stripe não configurado: falta STRIPE_PUBLISHABLE_KEY no arquivo .env' });
      return json(res, 200, { publishableKey: env.STRIPE_PUBLISHABLE_KEY });
    }
    if (p === '/api/create-checkout-session' && req.method === 'POST') {
      if (limited(req, 20, 10 * 60 * 1000)) return json(res, 429, { error: 'Muitas tentativas. Aguarde alguns minutos.' });
      const session = await createSession();
      return json(res, 200, { client_secret: session.client_secret });
    }
    if (p === '/api/order-status' && req.method === 'GET') {
      const s = await verifiedSession(url.searchParams.get('session_id'));
      const paid = isPaid(s);
      // só informa o que existe depois de pago (não revela nada antes)
      const files = paid ? { exe: !!(await resolveDownload('exe', s)), apk: !!(await resolveDownload('apk', s)) } : { exe: false, apk: false };
      return json(res, 200, { status: s.status, paid, files });
    }
    const dl = /^\/api\/download\/(exe|apk)$/.exec(p);
    if (dl && (req.method === 'GET' || req.method === 'HEAD')) {
      const s = await verifiedSession(url.searchParams.get('session_id'));
      if (!isPaid(s)) return json(res, 402, { error: 'Pagamento ainda não confirmado.' });
      const f = await resolveDownload(dl[1], s);
      if (!f) return json(res, 404, { error: `O arquivo .${dl[1]} ainda não está disponível.` });
      if (f.type === 'redirect') { res.writeHead(302, { Location: f.url, 'Cache-Control': 'no-store' }); return res.end(); }
      const type = dl[1] === 'apk' ? 'application/vnd.android.package-archive' : 'application/octet-stream';
      const safeName = f.name.replace(/[^\w.\- ]/g, '_');
      return sendFile(req, res, f.full, {
        'Content-Type': type, 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      });
    }
    return json(res, 404, { error: 'Rota não encontrada.' });
  }

  return async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (e) { return json(res, 400, { error: 'Endereço inválido.' }); }
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Método não permitido.' });
      return serveStatic(req, res, url.pathname);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[erro]', req.method, url.pathname, '-', err.message);
      if (!res.headersSent) return json(res, status, { error: err.message });
      res.destroy();
    }
  };
}

module.exports = { createApp, encodeForm };

if (require.main === module) {
  loadEnvFile(path.join(__dirname, '.env'));
  const port = Number(process.env.PORT) || 3000;
  const handler = createApp();
  http.createServer(handler).listen(port, () => {
    console.log(`Vida Loka: loja rodando em http://localhost:${port}`);
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PUBLISHABLE_KEY) console.warn('AVISO: crie o arquivo .env com STRIPE_SECRET_KEY e STRIPE_PUBLISHABLE_KEY (veja .env.example). O site abre, mas o pagamento não funciona sem elas.');
    const dir = path.join(__dirname, 'downloads');
    const have = (ext) => { try { return fs.readdirSync(dir).some((n) => n.toLowerCase().endsWith(ext)); } catch (e) { return false; } };
    if (!have('.exe')) console.warn('AVISO: não há nenhum .exe em downloads/ — coloque o arquivo do Windows lá.');
    if (!have('.apk')) console.warn('AVISO: não há nenhum .apk em downloads/ — coloque o arquivo do Android lá.');
  });
}
