const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// rooms[roomCode] = { players:{socketId:{name}}, driverId, role, spawning, spawnInterval }
const rooms = {};
const ROLES = ['blind', 'deaf', 'mute'];
function pickRole() {
  return ROLES[Math.floor(Math.random() * ROLES.length)];
}

function startSpawning(room) {
  const r = rooms[room];
  if (!r || r.spawning) return;
  r.spawning = true;
  r.spawnInterval = setInterval(() => {
    const lane = Math.random() < 0.5 ? -1.6 : 1.6;
    io.to(room).emit('obstacle-spawn', { id: Date.now() + Math.random(), lane, t: Date.now() });
  }, 1500);
}
function stopSpawning(room) {
  const r = rooms[room];
  if (r && r.spawnInterval) { clearInterval(r.spawnInterval); r.spawning = false; r.spawnInterval = null; }
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join-room', ({ room, name, peerId }) => {
    currentRoom = room;
    socket.join(room);
    if (!rooms[room]) rooms[room] = { players: {}, driverId: null, role: null, spawning: false };
    const r = rooms[room];

    // ابعت لللاعب الجديد بيانات اللاعبين الموجودين (اسم + peerId) عشان يتصل بيهم بالصوت
    const others = Object.entries(r.players).map(([id, p]) => ({ id, name: p.name, peerId: p.peerId }));
    r.players[socket.id] = { name: name || 'لاعب', peerId };

    socket.emit('existing-peers', others);
    socket.emit('driver-set', { driverId: r.driverId, role: r.role });

    io.to(room).emit('players-update', r.players);
    socket.to(room).emit('peer-joined', socket.id);
  });

  socket.on('claim-driver', () => {
    const r = rooms[currentRoom];
    if (!r || r.driverId) return;
    r.driverId = socket.id;
    r.role = pickRole();
    io.to(currentRoom).emit('driver-set', { driverId: r.driverId, role: r.role });
    startSpawning(currentRoom);
  });

  socket.on('car-update', (data) => {
    if (currentRoom) socket.to(currentRoom).emit('car-update', data);
  });

  socket.on('game-over', (data) => {
    const r = rooms[currentRoom];
    if (r) { stopSpawning(currentRoom); r.driverId = null; r.role = null; }
    if (currentRoom) io.to(currentRoom).emit('game-over', data);
  });

  socket.on('reaction', (emoji) => {
    if (currentRoom) socket.to(currentRoom).emit('reaction', { from: socket.id, emoji });
  });

  socket.on('disconnect', () => {
    const r = rooms[currentRoom];
    if (!r) return;
    delete r.players[socket.id];
    if (r.driverId === socket.id) {
      r.driverId = null; r.role = null;
      stopSpawning(currentRoom);
      io.to(currentRoom).emit('driver-set', { driverId: null, role: null });
    }
    io.to(currentRoom).emit('players-update', r.players);
    io.to(currentRoom).emit('peer-left', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
