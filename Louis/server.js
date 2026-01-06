const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const axios = require('axios');

// ==========================================
// 👇 請確認 JSONBin 設定 👇
const BIN_ID = '695454afd0ea881f404a52bf'; 
const API_KEY = '$2a$10$Ved0Z4ofi5lO5WZ7BG7W9eL3y82JQlNiuyQQYm6qJn6CD5dWZ/Xei';
// ==========================================

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- 權限設定 ---
const DEFAULT_PASS = "Aa12345678"; 
const ALL_ADMINS = ["louis_chen_0705", "louis_chen_0705_1", "louis_chen_0705_2"];
const SUPER_ADMINS = ["louis_chen_0705", "louis_chen_0705_1"];

let users = {};   
let players = {}; 
let winners = {}; // 🔥 新增：已中獎（被刪除）的名單
let gameConfig = { 
    minNumber: 1, 
    maxNumber: 100, 
    selectionCount: 1, 
    digitCount: 0,
    lastWinner: null 
};

async function loadData() {
    try {
        const response = await axios.get(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
            headers: { 'X-Master-Key': API_KEY }
        });
        if (response.data.record) {
            if (response.data.record.users) users = response.data.record.users;
            if (response.data.record.players) players = response.data.record.players;
            if (response.data.record.winners) winners = response.data.record.winners; // 讀取中獎名單
        }
    } catch (error) { console.error('讀取失敗:', error.message); }
}

async function saveData() {
    try {
        await axios.put(`https://api.jsonbin.io/v3/b/${BIN_ID}`, { 
            users, players, winners // 存檔包含 winners
        }, {
            headers: { 'X-Master-Key': API_KEY, 'Content-Type': 'application/json' }
        });
    } catch (error) { console.error('存檔失敗:', error.message); }
}

app.use(express.static(path.join(__dirname, 'public')));

loadData().then(() => {
    io.on('connection', (socket) => {
        socket.emit('configUpdate', gameConfig);

        socket.on('userLogin', (data) => {
            const username = data.username.trim(); 
            const password = data.password.trim();

            if (!username || !password) return socket.emit('loginError', '請輸入帳號密碼！');

            if (users[username] && users[username] === password) {
                const isAdmin = ALL_ADMINS.includes(username);
                const isSuperAdmin = SUPER_ADMINS.includes(username);
                
                // 1. 檢查是否正在遊戲中
                let existingPlayer = Object.values(players).find(p => p.username === username);
                
                // 2. 🔥 檢查是否已經中獎過 (被刪除過)
                let hasWonAlready = winners[username] ? true : false;
                let winNumber = winners[username] || null;

                socket.emit('loginSuccess', { 
                    username, 
                    isAdmin, 
                    isSuperAdmin,
                    isDefaultPass: (password === DEFAULT_PASS),
                    hasSubmitted: !!existingPlayer,
                    submittedNumbers: existingPlayer ? existingPlayer.numbers : [],
                    lastWinner: gameConfig.lastWinner,
                    // 新增狀態
                    isAlreadyWinner: hasWonAlready,
                    winningNumber: winNumber
                });

                if (isAdmin) socket.emit('adminUpdate', players);
            } else {
                socket.emit('loginError', users[username] ? '密碼錯誤！' : '帳號不存在！');
            }
        });

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

        socket.on('submitNumber', (data) => {
            // 如果已經在中獎名單，禁止提交
            if (winners[data.username]) return socket.emit('submitError', '你已經中獎過囉！');

            let { numbers, username } = data; 
            if (!Array.isArray(numbers) || numbers.length !== gameConfig.selectionCount) {
                return socket.emit('submitError', `需填寫 ${gameConfig.selectionCount} 個號碼！`);
            }

            let cleanNumbers = [];
            let allTakenNumbers = [];
            for (let p of Object.values(players)) {
                if (p.username !== username) {
                     const nums = p.numbers || [p.number];
                     allTakenNumbers.push(...nums);
                }
            }

            for (let numStr of numbers) {
                if (gameConfig.digitCount > 0) numStr = numStr.toString().padStart(gameConfig.digitCount, '0');
                const num = parseInt(numStr);
                if (isNaN(num)) return socket.emit('submitError', `包含無效數字`);
                if (num < gameConfig.minNumber || num > gameConfig.maxNumber) 
                    return socket.emit('submitError', `數字 ${num} 超出範圍`);
                if (allTakenNumbers.includes(num)) return socket.emit('submitError', `數字 ${num} 已被選走`);
                if (cleanNumbers.includes(num)) return socket.emit('submitError', `重複填寫 (${num})`);
                cleanNumbers.push(num); 
            }

            players[socket.id] = { id: socket.id, username, numbers: cleanNumbers, weight: 1 };
            socket.emit('submitSuccess', { username, numbers: cleanNumbers });
            io.emit('adminUpdate', players);
            saveData();
        });

        socket.on('adminUpdateWeight', (data) => {
            const { adminName, targetSocketId, newWeight } = data;
            if (SUPER_ADMINS.includes(adminName) && players[targetSocketId]) {
                players[targetSocketId].weight = parseInt(newWeight);
                io.emit('adminUpdate', players);
            }
        });

        // 🔥 修正：刪除玩家時，將其加入 winners 名單
        socket.on('adminDeletePlayer', (targetSocketId) => {
            const player = players[targetSocketId];
            if (player) {
                // 記錄他是贏家，並記下他的號碼 (方便顯示)
                // 這裡簡單記下 username 和 numbers
                // 實際中獎號碼我們可能不知道是哪一個，但沒關係，只要標記他贏了即可
                winners[player.username] = player.numbers; 
                
                delete players[targetSocketId];
                
                // 通知該玩家他被移除了 (這樣如果不重整頁面也能即時反應)
                io.to(targetSocketId).emit('youAreMovedToWinner');

                io.emit('adminUpdate', players);
                saveData();
            }
        });

        socket.on('adminResetGame', () => {
            players = {}; 
            winners = {}; // 重置時也清空贏家名單
            gameConfig.lastWinner = null;
            io.emit('gameReset'); io.emit('adminUpdate', players); saveData();
        });

        socket.on('adminSpin', () => {
            let entries = [];
            for (let p of Object.values(players)) {
                let nums = Array.isArray(p.numbers) ? p.numbers : [p.number];
                for (let n of nums) {
                    entries.push({
                        playerId: p.id,
                        username: p.username,
                        number: n,
                        weight: p.weight || 1
                    });
                }
            }

            if (entries.length === 0) return;

            let totalWeight = entries.reduce((acc, e) => acc + e.weight, 0);
            let random = Math.random() * totalWeight;
            let winnerEntry = null;

            for (let e of entries) {
                random -= e.weight;
                if (random <= 0) {
                    winnerEntry = e;
                    break;
                }
            }

            if (winnerEntry) {
                gameConfig.lastWinner = winnerEntry.username;
                io.emit('spinResult', { 
                    winnerId: winnerEntry.playerId, 
                    winnerName: winnerEntry.username,
                    winningNumber: winnerEntry.number 
                });
            }
        });

        socket.on('adminSetConfig', (config) => {
            gameConfig.minNumber = parseInt(config.min);
            gameConfig.maxNumber = parseInt(config.max);
            gameConfig.selectionCount = parseInt(config.count || 1);
            gameConfig.digitCount = parseInt(config.digits || 0);
            io.emit('configUpdate', gameConfig);
        });
    });

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
});
