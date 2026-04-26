require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const path = require('path');
const db = require('./db');
const gmail = require('./gmail');
const { extractOrder } = require('./parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(express.json({ limit: '500kb' }));
app.use(cookieSession({
  name: 'tracker_session',
  keys: [process.env.SESSION_SECRET || 'dev-only-change-me'],
  maxAge: 30 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production'
}));

function requireAuth(req, res, next) {
  if (req.session?.email && req.session.email === process.env.ALLOWED_EMAIL) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Niet ingelogd' });
  }
  res.redirect('/login');
}

app.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><title>Login</title>
    <style>body{font-family:system-ui;background:#f5f3ef;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
    .box{background:white;padding:40px;border-radius:12px;border:1px solid #e8e4dd;text-align:center;max-width:400px}
    h1{font-size:22px;margin:0 0 8px}p{color:#6b6b6b;margin:0 0 24px;font-size:14px}
    a{display:inline-block;background:#2a2a2a;color:white;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px}</style>
    </head><body><div class="box"><h1>Bestellingen Tracker</h1>
    <p>Log in met het bestellingen-Gmail-account om door te gaan.</p>
    <a href="/auth/google">Inloggen met Google</a></div></body></html>`);
});

app.get('/auth/google', (req, res) => {
  res.redirect(gmail.authUrl());
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Geen autorisatiecode ontvangen');

    const { email } = await gmail.exchangeCode(code);
    if (email !== process.env.ALLOWED_EMAIL) {
      return res.status(403).send(
        `<p>Dit account (${email}) heeft geen toegang. Log in met ${process.env.ALLOWED_EMAIL}.</p>`
      );
    }

    req.session.email = email;
    res.redirect('/');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('Inloggen mislukt: ' + err.message);
  }
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const tokens = await db.getTokens();
  res.json({
    email: req.session.email,
    gmailConnected: !!tokens,
    gmailEmail: tokens?.email || null
  });
});

app.get('/api/orders', requireAuth, async (req, res) => {
  const orders = await db.listOrders();
  res.json(orders);
});

app.post('/api/orders', requireAuth, async (req, res) => {
  try {
    const order = await db.insertOrder({ ...req.body, source: 'manual' });
    res.json(order);
  } catch (err) {
    console.error('Insert error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders/parse', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Geen tekst meegegeven' });
  const parsed = extractOrder(text);
  const order = await db.insertOrder({ ...parsed, source: 'paste' });
  res.json(order);
});

app.patch('/api/orders/:id', requireAuth, async (req, res) => {
  try {
    const order = await db.updateOrder(parseInt(req.params.id, 10), req.body);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/orders/:id', requireAuth, async (req, res) => {
  await db.deleteOrder(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

app.post('/api/scan', requireAuth, async (req, res) => {
  try {
    const result = await gmail.scanInbox();
    res.json(result);
  } catch (err) {
    console.error('Scan error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.use(requireAuth, express.static(path.join(__dirname, 'public')));

const intervalMin = parseInt(process.env.SCAN_INTERVAL_MINUTES || '15', 10);
async function startScanLoop() {
  if (!await gmail.hasTokens()) {
    console.log('[scan] Gmail not yet connected — skipping background scan');
    return;
  }
  try {
    await gmail.scanInbox();
  } catch (err) {
    console.error('[scan] error:', err.message);
  }
}

(async () => {
  try {
    await db.init();
  } catch (err) {
    console.error('DB init failed:', err.message, err.code, err.stack);
  }

  setTimeout(startScanLoop, 30_000);
  setInterval(startScanLoop, intervalMin * 60 * 1000);

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Scan interval: ${intervalMin} minutes`);
  });
})();
