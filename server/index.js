require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth.routes');
const movimientosRoutes = require('./routes/movimientos.routes');
const categoriasRoutes = require('./routes/categorias.routes');
const detallesRoutes = require('./routes/detalles.routes');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Autentica cada conexión de socket con el mismo JWT usado en la API REST,
// y asigna al socket a una sala privada por usuario.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('No autenticado'));
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, usuario) => {
    if (err) return next(new Error('Token inválido'));
    socket.usuario = usuario;
    next();
  });
});

app.set('io', io);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/movimientos', movimientosRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/detalles', detallesRoutes);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, mensaje: 'API funcionando correctamente' });
});

io.on('connection', (socket) => {
  const sala = `usuario_${socket.usuario.id}`;
  socket.join(sala);
  console.log(`Cliente conectado: ${socket.id} (usuario ${socket.usuario.username})`);

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

const PORT = process.env.PORT || 3004;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});