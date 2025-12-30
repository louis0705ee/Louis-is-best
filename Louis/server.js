const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let players = {};

// 遊戲設定 (限制幸運數字的範圍)
let gameConfig = {
    minNumber: 1,
    maxNumber: 100
};

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    socket.emit('configUpdate', gameConfig);

    // 1. 玩家登入 (改為接收座號 seat)
    socket.on('playerLogin', (data) => {
        const num = parseInt(data.number);
        
        // 驗證幸運數字範圍
        if (num < gameConfig.minNumber || num > gameConfig.maxNumber) {
            socket.emit('loginError', `幸運數字必須在 ${gameConfig.minNumber} 到 ${gameConfig.maxNumber} 之間！`);
            return;
        }

        // 驗證座號是否有填
        if (!data.seat) {
            socket.emit('loginError', `請填寫座號！`);
            return;
        }

        players[socket.id] = {
            id: socket.id,
            seat: data.seat,   // 這裡存座號
            number: num        // 這裡存幸運數字
        };
        
        socket.emit('loginSuccess', { seat: data.seat, number: num });
        io.emit('adminUpdate', players);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('adminUpdate', players);
    });

    // 管理員修改設定
    socket.on('adminSetConfig', (newConfig) => {
        gameConfig.minNumber = parseInt(newConfig.min);
        gameConfig.maxNumber = parseInt(newConfig.max);
        io.emit('configUpdate', gameConfig);
    });

    // 管理員發送結果
    socket.on('adminAnnounceWinner', (winnerSocketId) => {
        io.to(winnerSocketId).emit('gameResult', { status: 'win' });
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