const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let orders = [];

// Создание заказа
app.post('/api/orders', (req, res) => {
  const { clientPhone, clientName, items, address } = req.body;
  const newOrder = {
    id: 'ORD-' + Math.floor(1000 + Math.random() * 9000),
    clientPhone,
    clientName,
    items,
    address,
    status: 'created',
    courierId: null,
    messages: []
  };
  orders.push(newOrder);
  io.emit('order_created', newOrder);
  res.json(newOrder);
});

// Список всех заказов
app.get('/api/orders', (req, res) => {
  res.json(orders);
});

// Сокеты: чат и статусы
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
      const msg = { sender, text, time: new Date().toLocaleTimeString() };
      order.messages.push(msg);
      io.to(orderId).emit('new_message', msg);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
