const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const axios = require('axios');

// ==========================================
// 👇 請將這裡換成你 JSONBin 的資料 👇
const BIN_ID = '695454afd0ea881f404a52bf'; 
const API_KEY = '$2a$10$Ved0Z4ofi5lO5WZ7BG7W9eL3y82JQlNiuyQQYm6qJn6CD5dWZ/Xei';
// ==========================================

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- 權限設定 ---
const DEFAULT_PASS = "Aa12345678"; 

// 這些帳號是管理員 (可以看到後台)
const ALL_ADMINS = ["louis_chen_0705", "louis_chen_0705_1", "louis_chen_0705_2"];

// 只有這些帳號是「最高管理員」 (可以調權重)
const SUPER_ADMINS = ["louis_chen_0705", "louis_chen_0705_1"];

let users = {};   
let players = {}; 
let gameConfig = { minNumber: 1, maxNumber: 100, lastWinner: null };

async function loadData() {
    try {
        const response = await axios.get(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
            headers: { 'X-Master-Key': API_KEY }
        });
        if (response.data.record) {
            if (response.data.record.users) users = response.data.record.users;
            if (response.data.record.players) players = response.data.record.players;
        }
    } catch (error) { console.error('讀取失敗:', error.message); }
}

async function saveData() {
    try {
        await axios.put(`https://api.jsonbin.io/v3/b/${BIN_ID}`, { users, players }, {
            headers: { 'X-Master-Key': API_KEY, 'Content-Type': 'application/json' }
        });
    } catch (error) { console.error('存檔失敗:', error.message); }
}

app.use(express.static(path.join(__dirname, 'public')));

loadData().then(() => {
    io.on('connection', (socket) => {
        socket.emit('configUpdate', gameConfig);

        // 登入
        socket.on('userLogin', (data) => {
            const username = data.username.trim(); 
            const password = data.password.trim();

            if (!username || !password) return socket.emit('loginError', '請輸入帳號密碼！');

            if (users[username] && users[username] === password) {
                const isAdmin = ALL_ADMINS.includes(username);
                const isSuperAdmin = SUPER_ADMINS.includes(username); // 判斷是否為最高管理員
                
                let existingPlayer = Object.values(players).find(p => p.username === username);

                socket.emit('loginSuccess', { 
                    username, 
                    isAdmin, 
                    isSuperAdmin, // 傳送最高權限標記給前端
                    isDefaultPass: (password === DEFAULT_PASS),
                    hasSubmitted: !!existingPlayer,
                    submittedNumber: existingPlayer ? existingPlayer.number : null,
                    lastWinner: gameConfig.lastWinner
                });

                if (isAdmin) socket.emit('adminUpdate', players);
            } else {
                socket.emit('loginError', users[username] ? '密碼錯誤！' : '帳號不存在！');
            }
        });

        // 修改密碼
        socket.on('changePassword', (data) => {
            const { username, oldPass, newPass } = data;
            if (users[username] === oldPass) {
                if (oldPass !== DEFAULT_PASS && !SUPER_ADMINS.includes(username)) {
                    return socket.emit('changePasswordError', '已修改過，重置請找 Louis。');
                }
                users[username] = newPass;
                saveData();
                socket.emit('changePasswordSuccess');
            } else {
                socket.emit('changePasswordError', '舊密碼錯誤！');
            }
        });

        // 提交數字
        socket.on('submitNumber', (data) => {
            const { number, username } = data;
            const num = parseInt(number);

            if (num < gameConfig.minNumber || num > gameConfig.maxNumber) 
                return socket.emit('submitError', `請輸入 ${gameConfig.minNumber}~${gameConfig.maxNumber}`);

            for (let p of Object.values(players)) {
                if (p.number === num) return socket.emit('submitError', `數字 ${num} 已被選走！`);
                if (p.username === username) return socket.emit('submitError', `你已選過 (${p.number})！`);
            }

            players[socket.id] = { id: socket.id, username, number: num, weight: 1 };
            socket.emit('submitSuccess', { username, number: num });
            io.emit('adminUpdate', players);
            saveData();
        });

        // --- 管理員功能 ---
        
        // 只有最高管理員能改權重
        socket.on('adminUpdateWeight', (data) => {
            const { adminName, targetSocketId, newWeight } = data;
            // 後端再次驗證權限，防止有人繞過前端
            if (SUPER_ADMINS.includes(adminName) && players[targetSocketId]) {
                players[targetSocketId].weight = parseInt(newWeight);
                io.emit('adminUpdate', players);
            }
        });

        socket.on('adminResetGame', () => {
            players = {}; gameConfig.lastWinner = null;
            io.emit('gameReset'); io.emit('adminUpdate', players); saveData();
        });

        socket.on('adminSpin', () => {
            const list = Object.values(players);
            if (!list.length) return;
            
            let total = list.reduce((acc, p) => acc + (p.weight || 1), 0);
            let random = Math.random() * total;
            let winner = null;
            
            for (let p of list) {
                random -= (p.weight || 1);
                if (random <= 0) { winner = p; break; }
            }
            if (winner) {
                gameConfig.lastWinner = winner.username;
                io.emit('spinResult', { winnerId: winner.id, winnerName: winner.username });
            }
        });

        socket.on('adminSetConfig', (config) => {
            gameConfig.minNumber = parseInt(config.min);
            gameConfig.maxNumber = parseInt(config.max);
            io.emit('configUpdate', gameConfig);
        });
    });

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
});
