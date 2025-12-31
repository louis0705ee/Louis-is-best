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

// 設定
const DEFAULT_PASS = "Aa12345678"; 
const ADMIN_ACCOUNTS = ["louis_chen_0705_1", "louis_chen_0705_2"]; 

let users = {};   
let players = {}; 
let gameConfig = { 
    minNumber: 1, 
    maxNumber: 100,
    lastWinner: null // 紀錄最後一位贏家
};

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
        await axios.put(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
            users: users,
            players: players
        }, { headers: { 'X-Master-Key': API_KEY, 'Content-Type': 'application/json' } });
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

            if (users[username]) {
                if (users[username] === password) {
                    const isAdmin = ADMIN_ACCOUNTS.includes(username);
                    
                    // 檢查玩家是否已經在名單內 (是否已投過票)
                    // 我們透過遍歷 players 來找這個 username
                    let existingPlayer = null;
                    for(let pid in players) {
                        if(players[pid].username === username) {
                            existingPlayer = players[pid];
                            break;
                        }
                    }

                    socket.emit('loginSuccess', { 
                        username: username, 
                        isAdmin: isAdmin, 
                        isDefaultPass: (password === DEFAULT_PASS),
                        hasSubmitted: !!existingPlayer, // 告訴前端是否已提交過
                        submittedNumber: existingPlayer ? existingPlayer.number : null,
                        lastWinner: gameConfig.lastWinner
                    });

                    if (isAdmin) socket.emit('adminUpdate', players);

                } else {
                    socket.emit('loginError', '密碼錯誤！');
                }
            } else {
                socket.emit('loginError', '此帳號不在名單內！');
            }
        });

        // 修改密碼
        socket.on('changePassword', (data) => {
            const { username, oldPass, newPass } = data;
            if (users[username] && users[username] === oldPass) {
                if (oldPass !== DEFAULT_PASS) {
                    return socket.emit('changePasswordError', '已修改過密碼，重置請找 Louis。');
                }
                users[username] = newPass;
                saveData();
                socket.emit('changePasswordSuccess');
            } else {
                socket.emit('changePasswordError', '舊密碼錯誤！');
            }
        });

        // 提交數字 (防止重複)
        socket.on('submitNumber', (data) => {
            const num = parseInt(data.number);
            const username = data.username;

            if (num < gameConfig.minNumber || num > gameConfig.maxNumber) {
                return socket.emit('submitError', `數字必須在 ${gameConfig.minNumber} ~ ${gameConfig.maxNumber} 之間`);
            }

            // 全局檢查：數字是否重複
            for (let p of Object.values(players)) {
                if (p.number === num) return socket.emit('submitError', `數字 ${num} 已經被別人選走了！`);
                if (p.username === username) return socket.emit('submitError', `你已經選過數字了 (${p.number})，不能再改！`);
            }

            // 新增玩家 (預設權重 1)
            players[socket.id] = { 
                id: socket.id, 
                username: username, 
                number: num,
                weight: 1 
            };
            
            socket.emit('submitSuccess', { username: username, number: num });
            io.emit('adminUpdate', players);
            saveData();
        });

        // --- 管理員功能 ---

        // 1. 更新權重
        socket.on('adminUpdateWeight', (data) => {
            const { targetSocketId, newWeight } = data;
            if (players[targetSocketId]) {
                players[targetSocketId].weight = parseInt(newWeight);
                io.emit('adminUpdate', players); // 更新給管理員看
            }
        });

        // 2. 重置遊戲 (清空名單)
        socket.on('adminResetGame', () => {
            players = {}; // 清空
            gameConfig.lastWinner = null; // 清空贏家
            io.emit('gameReset'); // 通知所有人
            io.emit('adminUpdate', players);
            saveData();
        });

        // 3. 開始旋轉 (後端計算結果)
        socket.on('adminSpin', () => {
            const playerList = Object.values(players);
            if (playerList.length === 0) return;

            // 計算總權重
            let totalWeight = 0;
            playerList.forEach(p => totalWeight += (p.weight || 1));

            // 隨機抽選
            let random = Math.random() * totalWeight;
            let winner = null;
            
            for (let p of playerList) {
                random -= (p.weight || 1);
                if (random <= 0) {
                    winner = p;
                    break;
                }
            }

            if (winner) {
                gameConfig.lastWinner = winner.username;
                // 廣播結果：告訴前端「贏家是誰」，前端負責動畫轉過去
                io.emit('spinResult', { winnerId: winner.id, winnerName: winner.username });
            }
        });

        socket.on('adminSetConfig', (newConfig) => {
            gameConfig.minNumber = parseInt(newConfig.min);
            gameConfig.maxNumber = parseInt(newConfig.max);
            io.emit('configUpdate', gameConfig);
        });
        
        socket.on('disconnect', () => {});
    });

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT}`);
    });
});