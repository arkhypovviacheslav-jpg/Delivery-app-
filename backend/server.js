const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');
const { Resend } = require('resend');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.send('DostavaGo Backend is running!');
});

const resend = new Resend(process.env.RESEND_API_KEY || 're_PzFv9bbY_D1Wx5Xopwr7Sae2hgja9ZUVM');

const dbUrl = process.env.DATABASE_URL;
const pool = dbUrl 
  ? new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  : null;

const verificationCodes = {};

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      phone VARCHAR(50) NOT NULL,
      role VARCHAR(50) DEFAULT 'client'
    );
    CREATE TABLE IF NOT EXISTS orders (
      id VARCHAR(50) PRIMARY KEY,
      user_email VARCHAR(255) NOT NULL,
      user_phone VARCHAR(50) NOT NULL,
      user_name VARCHAR(255) NOT NULL,
      items TEXT NOT NULL,
      from_address TEXT,
      to_address TEXT,
      status VARCHAR(50) DEFAULT 'created'
    );
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      order_id VARCHAR(50) NOT NULL,
      sender VARCHAR(255) NOT NULL,
      text TEXT,
      photo_url TEXT
    );
  `);
}
initDb().catch(console.error);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.post('/api/auth/send-email-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Введите Email" });

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  verificationCodes[email] = code;

  try {
    await resend.emails.send({
      from: 'DostavaGo <onboarding@resend.dev>',
      to: email,
      subject: 'Код подтверждения DostavaGo',
      html: `<h3>Ваш код подтверждения:</h3><h1 style="color: #eab308;">${code}</h1>`
    });
    res.json({ success: true, message: "Код отправлен на почту" });
  } catch (err) {
    console.error("Resend error:", err);
    res.status(500).json({ error: "Не удалось отправить письмо" });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { email, code, password, fullName, phone } = req.body;
  if (verificationCodes[email] !== code) {
    return res.status(400).json({ error: "Неверный код из письма!" });
  }

  try {
    if (!pool) {
      delete verificationCodes[email];
      return res.json({ success: true, user: { email, full_name: fullName, phone, role: 'client' } });
    }
    const newUser = await pool.query(
      'INSERT INTO users (email, password, full_name, phone) VALUES ($1, $2, $3, $4) RETURNING *',
      [email, password, fullName, phone]
    );
    delete verificationCodes[email];
    res.json({ success: true, user: newUser.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Ошибка регистрации или такой Email уже есть" });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!pool) {
      return res.json({ success: true, user: { id: 1, email, name: 'Клиент', phone: '', role: 'client' } });
    }
    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND password = $2', [email, password]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Неверный Email или пароль" });
    }
    const u = result.rows[0];
    res.json({ success: true, user: { id: u.id, email: u.email, name: u.full_name, phone: u.phone, role: u.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  const { userEmail, userPhone, userName, items, fromAddress, toAddress } = req.body;
  const orderId = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
  
  const newOrder = { id: orderId, user_email: userEmail, user_phone: userPhone, user_name: userName, items, from_address: fromAddress, to_address: toAddress, status: 'created' };

  try {
    if (pool) {
      const result = await pool.query(
        'INSERT INTO orders (id, user_email, user_phone, user_name, items, from_address, to_address) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
        [orderId, userEmail, userPhone, userName, items, fromAddress, toAddress]
      );
      io.emit('order_created', result.rows[0]);
      return res.json(result.rows[0]);
    }
    io.emit('order_created', newOrder);
    res.json(newOrder);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders/user/:email', async (req, res) => {
  if (!pool) return res.json([]);
  const result = await pool.query('SELECT * FROM orders WHERE user_email = $1', [req.params.email]);
  res.json(result.rows);
});

app.get('/api/orders', async (req, res) => {
  if (!pool) return res.json([]);
  const result = await pool.query('SELECT * FROM orders');
  res.json(result.rows);
});

app.get('/api/messages/:orderId', async (req, res) => {
  if (!pool) return res.json([]);
  const result = await pool.query('SELECT * FROM messages WHERE order_id = $1', [req.params.orderId]);
  res.json(result.rows);
});

io.on('connection', (socket) => {
  socket.on('join_order', (id) => socket.join(id));
  
  socket.on('take_order', async ({ orderId }) => {
    if (pool) await pool.query('UPDATE orders SET status = $1 WHERE id = $2', ['taken', orderId]);
    io.emit('order_status_changed', { orderId, status: 'taken' });
  });

  socket.on('send_message', async ({ orderId, sender, text, photoUrl }) => {
    if (pool) {
      const res = await pool.query(
        'INSERT INTO messages (order_id, sender, text, photo_url) VALUES ($1, $2, $3, $4) RETURNING *',
        [orderId, sender, text || '', photoUrl || null]
      );
      io.to(orderId).emit('new_message', res.rows[0]);
    } else {
      io.to(orderId).emit('new_message', { order_id: orderId, sender, text, photo_url: photoUrl });
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
