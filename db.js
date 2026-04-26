const { Pool } = require('pg');

const url = process.env.DATABASE_URL || '';
const needsSSL = url.includes('proxy.rlwy.net') || url.includes('sslmode=require') || process.env.PGSSL === 'true';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSSL ? { rejectUnauthorized: false } : false
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id            SERIAL PRIMARY KEY,
  product       TEXT NOT NULL,
  shop          TEXT,
  order_number  TEXT,
  order_date    DATE,
  delivery_date DATE,
  tracking      TEXT,
  status        TEXT NOT NULL DEFAULT 'besteld',
  source        TEXT NOT NULL DEFAULT 'manual',
  gmail_msg_id  TEXT UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);
CREATE INDEX IF NOT EXISTS orders_order_date_idx ON orders(order_date DESC);

CREATE TABLE IF NOT EXISTS gmail_tokens (
  id             INT PRIMARY KEY DEFAULT 1,
  access_token   TEXT,
  refresh_token  TEXT NOT NULL,
  expiry_date    BIGINT,
  scope          TEXT,
  email          TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS processed_messages (
  gmail_msg_id  TEXT PRIMARY KEY,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

async function init() {
  await pool.query(SCHEMA);
  console.log('Database schema ready');
}

async function listOrders() {
  const { rows } = await pool.query(
    `SELECT * FROM orders ORDER BY order_date DESC NULLS LAST, created_at DESC`
  );
  return rows;
}

async function insertOrder(o) {
  const { rows } = await pool.query(
    `INSERT INTO orders (product, shop, order_number, order_date, delivery_date, tracking, status, source, gmail_msg_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (gmail_msg_id) DO NOTHING
     RETURNING *`,
    [
      o.product || 'Onbekend product',
      o.shop || null,
      o.orderNumber || null,
      o.orderDate || null,
      o.deliveryDate || null,
      o.tracking || null,
      o.status || 'besteld',
      o.source || 'manual',
      o.gmailMsgId || null
    ]
  );
  return rows[0];
}

async function updateOrder(id, fields) {
  const allowed = ['product', 'shop', 'order_number', 'order_date', 'delivery_date', 'tracking', 'status'];
  const sets = [];
  const values = [];
  let i = 1;
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) {
      sets.push(`${k} = $${i++}`);
      values.push(v);
    }
  }
  if (sets.length === 0) return null;
  values.push(id);
  const { rows } = await pool.query(
    `UPDATE orders SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0];
}

async function deleteOrder(id) {
  await pool.query(`DELETE FROM orders WHERE id = $1`, [id]);
}

async function saveTokens(tokens, email) {
  await pool.query(
    `INSERT INTO gmail_tokens (id, access_token, refresh_token, expiry_date, scope, email, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, NOW())
     ON CONFLICT (id) DO UPDATE SET
       access_token = COALESCE(EXCLUDED.access_token, gmail_tokens.access_token),
       refresh_token = COALESCE(EXCLUDED.refresh_token, gmail_tokens.refresh_token),
       expiry_date = EXCLUDED.expiry_date,
       scope = COALESCE(EXCLUDED.scope, gmail_tokens.scope),
       email = COALESCE(EXCLUDED.email, gmail_tokens.email),
       updated_at = NOW()`,
    [tokens.access_token, tokens.refresh_token, tokens.expiry_date, tokens.scope, email]
  );
}

async function getTokens() {
  const { rows } = await pool.query(`SELECT * FROM gmail_tokens WHERE id = 1`);
  return rows[0] || null;
}

async function isMessageProcessed(msgId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM processed_messages WHERE gmail_msg_id = $1`,
    [msgId]
  );
  return rows.length > 0;
}

async function markMessageProcessed(msgId) {
  await pool.query(
    `INSERT INTO processed_messages (gmail_msg_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [msgId]
  );
}

module.exports = {
  pool,
  init,
  listOrders,
  insertOrder,
  updateOrder,
  deleteOrder,
  saveTokens,
  getTokens,
  isMessageProcessed,
  markMessageProcessed
};
