// Zero-dependency server (Node 18+). Run: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Minimal .env loader
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch (e) {
  console.warn(`[env] .env file not found or not readable: ${e.message}`);
}

const {
  PORT = 3000,
  BASE_URL = `http://localhost:${PORT}`,
  STRIPE_SECRET_KEY,
  PAYPAL_CLIENT_ID,
  PAYPAL_SECRET,
  PAYPAL_ENV = 'sandbox',
  DOWNLOAD_FILE = 'downloads/Notepad.dmg',
  TOKEN_SECRET = crypto.randomBytes(32).toString('hex'),
} = process.env;

const missingEnv = ['STRIPE_SECRET_KEY', 'PAYPAL_CLIENT_ID', 'PAYPAL_SECRET'].filter((k) => !process.env[k]);
if (missingEnv.length) console.warn(`[env] Missing environment variables: ${missingEnv.join(', ')}`);

// Demo mode: only when no payment keys are set AND the site runs on localhost
const DEMO = !STRIPE_SECRET_KEY && !(PAYPAL_CLIENT_ID && PAYPAL_SECRET) && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE_URL);
const PRICE_CENTS = 500;
const PRICE = '5.00';
const TOKEN_TTL_MS = 24 * 3600 * 1000;
const PAYPAL_API = PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const sign = (data) => crypto.createHmac('sha256', TOKEN_SECRET).update(data).digest('base64url');
function issueToken(paymentId) {
  const body = Buffer.from(JSON.stringify({ p: paymentId, e: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  return `${body}.${sign(body)}`;
}
function verifyToken(token = '') {
  const [body, sig] = token.split('.');
  if (!body || !sig) return false;
  const expected = sign(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()).e > Date.now(); } catch { return false; }
}

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const readJson = (req) => new Promise((resolve) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
});

async function stripe(method, endpoint, params) {
  const r = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? new URLSearchParams(params) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || 'Stripe error');
  return data;
}

async function paypal(method, endpoint, body) {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64');
  const t = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const { access_token } = await t.json();
  if (!access_token) throw new Error('PayPal auth failed');
  const r = await fetch(`${PAYPAL_API}${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || 'PayPal error');
  return data;
}

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  try {
    if (route === 'GET /api/config') {
      return json(res, 200, {
        price: PRICE,
        demo: DEMO,
        stripe: !!STRIPE_SECRET_KEY,
        paypalClientId: PAYPAL_CLIENT_ID && PAYPAL_SECRET ? PAYPAL_CLIENT_ID : null,
      });
    }
    if (route === 'POST /api/demo/pay') {
      if (!DEMO) return json(res, 403, { error: 'Demo mode disabled' });
      return json(res, 200, { token: issueToken('demo') });
    }
    if (route === 'POST /api/stripe/checkout') {
      if (!STRIPE_SECRET_KEY) return json(res, 503, { error: 'Card payments not configured' });
      const s = await stripe('POST', 'checkout/sessions', {
        mode: 'payment',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': String(PRICE_CENTS),
        'line_items[0][price_data][product_data][name]': 'Notepad for macOS',
        'line_items[0][price_data][product_data][tax_code]': 'txcd_10000000',
        success_url: `${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${BASE_URL}/#pricing`,
      });
      return json(res, 200, { url: s.url });
    }
    if (route === 'GET /api/stripe/verify') {
      const id = url.searchParams.get('session_id') || '';
      if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return json(res, 400, { error: 'Bad session' });
      const s = await stripe('GET', `checkout/sessions/${id}`);
      if (s.payment_status === 'paid' && s.amount_subtotal === PRICE_CENTS && s.currency === 'usd') {
        return json(res, 200, { token: issueToken(s.id) });
      }
      return json(res, 402, { error: 'Payment not completed' });
    }
    if (route === 'POST /api/paypal/create-order') {
      const o = await paypal('POST', '/v2/checkout/orders', {
        intent: 'CAPTURE',
        purchase_units: [{ description: 'Notepad for macOS', amount: { currency_code: 'USD', value: PRICE } }],
      });
      return json(res, 200, { id: o.id });
    }
    if (route === 'POST /api/paypal/capture-order') {
      const { orderID } = await readJson(req);
      if (!/^[A-Za-z0-9-]+$/.test(orderID || '')) return json(res, 400, { error: 'Bad order' });
      const o = await paypal('POST', `/v2/checkout/orders/${orderID}/capture`);
      const cap = o.purchase_units?.[0]?.payments?.captures?.[0];
      if (o.status === 'COMPLETED' && cap?.status === 'COMPLETED' && cap.amount?.value === PRICE && cap.amount?.currency_code === 'USD') {
        return json(res, 200, { token: issueToken(cap.id) });
      }
      return json(res, 402, { error: 'Payment not completed' });
    }
    if (route === 'GET /download') {
      if (!verifyToken(url.searchParams.get('token') || '')) {
        res.writeHead(402, { 'Content-Type': 'text/plain' });
        return res.end('Payment required');
      }
      const file = path.resolve(__dirname, DOWNLOAD_FILE);
      if (!fs.existsSync(file)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Installer not found on server. Place it at ' + DOWNLOAD_FILE);
      }
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': fs.statSync(file).size,
        'Content-Disposition': `attachment; filename="${path.basename(file)}"`,
      });
      return fs.createReadStream(file).pipe(res);
    }
    json(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message });
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, BASE_URL);
  if (url.pathname.startsWith('/api/') || url.pathname === '/download') return handleApi(req, res, url);
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname);
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Notepad site on ${BASE_URL}`));
