const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let users = {}; // База пользователей
let orders = [];

// 1. Запрос SMS-кода (Имитация отправки SMS)
app.post('/api/auth/send-code', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Укажите номер" });
  
  // В реальном продакшене здесь подключается Twilio/SMS-шлюз.
  // Для тестов код всегда 1111
  console.log(`Код для ${phone}: 1111`);
  res.json({ success: true, message: "Код отправлен (тестовый код: 1111)" });
});

// 2. Подтверждение SMS и вход
app.post('/api/auth/verify', (req, res) => {
  const { phone, code, name, role } = req.body;
  if (code !== '1111') return res.status(400).json({ error: "Неверный код!" });

  if (!users[phone]) {
    users[phone] = { phone, name: name || 'Пользователь', role: role || 'client', active: true };
  }
  
  res.json({ success: true, user: users[phone] });
});

// 3. Создание заказа
app.post('/api/orders', (req, res) => {
  const { clientPhone, clientName, items, fromAddress, toAddress, photoUrl } = req.body;
  const newOrder = {
    id: 'ORD-' + Math.floor(1000 + Math.random() * 9000),
    clientPhone,
    clientName,
    items,
    fromAddress: fromAddress || 'Ближайший магазин/Жабка',
    toAddress,
    photoUrl: photoUrl || null,
    status: 'created', // created -> taken -> delivered
    courierId: null,
    messages: []
  };
  orders.push(newOrder);
  io.emit('order_created', newOrder);
  res.json(newOrder);
});

// 4. Список заказов
app.get('/api/orders', (req, res) => {
  res.json(orders);
});

// 5. Удаление аккаунта
app.post('/api/user/delete', (req, res) => {
  const { phone } = req.body;
  if (users[phone]) {
    delete users[phone];
    return res.json({ success: true });
  }
  res.status(404).json({ error: "Пользователь не найден" });
});

// Сокеты для чата и статусов
io.on('connection', (socket) => {
  socket.on('join_order', (orderId) => socket.join(orderId));

  socket.on('take_order', ({ orderId, courierId }) => {
    const order = orders.find(o => o.id === orderId);
    if (order) {
      order.status = 'taken';
      order.courierId = courierId;
      io.emit('order_status_changed', order);
    }
  });

  socket.on('send_message', ({ orderId, sender, text }) => {
    const order = orders.find(o => o.id === orderId);
    if (order) {
      const msg = { sender, text, time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) };
      order.messages.push(msg);
      io.to(orderId).emit('new_message', msg);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
