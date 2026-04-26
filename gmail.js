const { google } = require('googleapis');
const db = require('./db');
const { extractOrder } = require('./parser');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email'
];

function makeOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/auth/google/callback`
  );
}

function authUrl() {
  const client = makeOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });
}

async function exchangeCode(code) {
  const client = makeOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();
  const email = data.email;

  await db.saveTokens(tokens, email);
  return { email, tokens };
}

async function getAuthedClient() {
  const stored = await db.getTokens();
  if (!stored) return null;

  const client = makeOAuthClient();
  client.setCredentials({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
    expiry_date: stored.expiry_date ? Number(stored.expiry_date) : undefined,
    scope: stored.scope
  });

  client.on('tokens', async (tokens) => {
    await db.saveTokens(tokens, stored.email);
  });

  return client;
}

function getHeader(headers, name) {
  const h = headers.find(x => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function decodeBody(part) {
  if (!part) return '';
  if (part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf-8');
  }
  if (part.parts) {
    const text = part.parts.find(p => p.mimeType === 'text/plain');
    if (text) return decodeBody(text);
    const html = part.parts.find(p => p.mimeType === 'text/html');
    if (html) return decodeBody(html).replace(/<[^>]+>/g, ' ');
    for (const p of part.parts) {
      const r = decodeBody(p);
      if (r) return r;
    }
  }
  return '';
}

async function scanInbox() {
  const auth = await getAuthedClient();
  if (!auth) {
    console.log('[scan] No tokens stored — skipping');
    return { scanned: 0, added: 0 };
  }

  const gmail = google.gmail({ version: 'v1', auth });
  const query = process.env.GMAIL_QUERY || 'label:bestellingen newer_than:90d';

  let scanned = 0;
  let added = 0;
  let pageToken = undefined;

  do {
    const list = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 50,
      pageToken
    });

    const messages = list.data.messages || [];
    for (const { id } of messages) {
      scanned++;
      if (await db.isMessageProcessed(id)) continue;

      const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const headers = msg.data.payload?.headers || [];
      const subject = getHeader(headers, 'Subject');
      const from = getHeader(headers, 'From');
      const date = getHeader(headers, 'Date');
      const body = decodeBody(msg.data.payload);

      const combined = `From: ${from}\nSubject: ${subject}\nDate: ${date}\n\n${body}`;
      const parsed = extractOrder(combined);

      if (!parsed.shop) {
        const fromMatch = from.match(/@([a-z0-9\-]+)\.(?:nl|com|eu|de|be|co\.uk)/i);
        if (fromMatch) {
          parsed.shop = fromMatch[1].replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        }
      }
      if (!parsed.orderDate && date) {
        const d = new Date(date);
        if (!isNaN(d)) parsed.orderDate = d.toISOString().slice(0, 10);
      }
      if (!parsed.product && subject) {
        parsed.product = subject.replace(/^(re|fwd?):\s*/i, '').slice(0, 200);
      }

      const inserted = await db.insertOrder({
        ...parsed,
        source: 'gmail',
        gmailMsgId: id
      });
      await db.markMessageProcessed(id);
      if (inserted) added++;
    }

    pageToken = list.data.nextPageToken;
  } while (pageToken);

  console.log(`[scan] scanned=${scanned} added=${added}`);
  return { scanned, added };
}

module.exports = {
  authUrl,
  exchangeCode,
  scanInbox,
  hasTokens: async () => !!(await db.getTokens())
};
