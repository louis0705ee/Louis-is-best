const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 玩家資料: { socketId: { name: "小明", number: "88", id: "..." } }
let players = {};

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    // 1. 玩家登入
    socket.on('playerLogin', (data) => {
        players[socket.id] = {
            id: socket.id,
            name: data.name,
            number: data.number
        };
        // 告訴管理員有人加入了
        io.emit('adminUpdate', players);
    });

    // 2. 玩家斷線
    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('adminUpdate', players);
    });

    // 3. 管理員發送結果 (關鍵修改！)
    socket.on('adminAnnounceWinner', (winnerSocketId) => {
        // 通知「贏家」
        io.to(winnerSocketId).emit('gameResult', { status: 'win' });
        
        // 通知「其他所有人」他們輸了 (除了贏家和管理員)
        for (let socketId in players) {
            if (socketId !== winnerSocketId) {
                io.to(socketId).emit('gameResult', { status: 'lose' });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`伺服器啟動！埠號: ${PORT}`);
});