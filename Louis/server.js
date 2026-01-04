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
let gameConfig = { 
    minNumber: 1, 
    maxNumber: 100, 
    selectionCount: 1, // 新增：每人要選幾個號碼 (預設1個)
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

        socket.on('userLogin', (data) => {
            const username = data.username.trim(); 
            const password = data.password.trim();

            if (!username || !password) return socket.emit('loginError', '請輸入帳號密碼！');

            if (users[username] && users[username] === password) {
                const isAdmin = ALL_ADMINS.includes(username);
                const isSuperAdmin = SUPER_ADMINS.includes(username);
                
                let existingPlayer = Object.values(players).find(p => p.username === username);

                socket.emit('loginSuccess', { 
                    username, 
                    isAdmin, 
                    isSuperAdmin,
                    isDefaultPass: (password === DEFAULT_PASS),
                    hasSubmitted: !!existingPlayer,
                    // 注意：這裡回傳的是 numbers (複數)
                    submittedNumbers: existingPlayer ? existingPlayer.numbers : [],
                    lastWinner: gameConfig.lastWinner
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

        // 提交數字 (支援多個)
        socket.on('submitNumber', (data) => {
            // data.numbers 是一個陣列，例如 [5, 20, 99]
            const { numbers, username } = data; 
            
            // 1. 檢查數量是否正確
            if (!Array.isArray(numbers) || numbers.length !== gameConfig.selectionCount) {
                return socket.emit('submitError', `系統設定需填寫 ${gameConfig.selectionCount} 個號碼！`);
            }

            // 2. 檢查每個數字的範圍與重複性
            let cleanNumbers = [];
            
            // 取得目前場上「所有已經被選走的數字」
            let allTakenNumbers = [];
            for (let p of Object.values(players)) {
                // 排除自己 (如果是更新的話)，但目前邏輯是一次定生死
                if (p.username !== username) {
                     // 相容舊資料：如果 p.numbers 存在用它，不然用舊的 p.number
                     const nums = p.numbers || [p.number];
                     allTakenNumbers.push(...nums);
                }
            }

            // 檢查這次提交的每一個數字
            for (let numStr of numbers) {
                const num = parseInt(numStr);
                
                if (isNaN(num)) return socket.emit('submitError', `包含無效數字`);
                if (num < gameConfig.minNumber || num > gameConfig.maxNumber) 
                    return socket.emit('submitError', `數字 ${num} 超出範圍 (${gameConfig.minNumber}~${gameConfig.maxNumber})`);
                
                // 檢查是否跟別人重複
                if (allTakenNumbers.includes(num)) {
                    return socket.emit('submitError', `數字 ${num} 已經被別人選走了！`);
                }
                
                // 檢查自己有沒有重複填寫 (例如填了兩個 5)
                if (cleanNumbers.includes(num)) {
                    return socket.emit('submitError', `你不能重複填寫相同的數字 (${num})`);
                }

                cleanNumbers.push(num);
            }

            // 檢查通過，寫入資料
            players[socket.id] = { 
                id: socket.id, 
                username, 
                numbers: cleanNumbers, // 存陣列
                weight: 1 
            };
            
            socket.emit('submitSuccess', { username, numbers: cleanNumbers });
            io.emit('adminUpdate', players);
            saveData();
        });

        // --- 管理員功能 ---
        socket.on('adminUpdateWeight', (data) => {
            const { adminName, targetSocketId, newWeight } = data;
            if (SUPER_ADMINS.includes(adminName) && players[targetSocketId]) {
                players[targetSocketId].weight = parseInt(newWeight);
                io.emit('adminUpdate', players);
            }
        });

        socket.on('adminDeletePlayer', (targetSocketId) => {
            if (players[targetSocketId]) {
                delete players[targetSocketId];
                io.emit('adminUpdate', players);
                saveData();
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
            gameConfig.selectionCount = parseInt(config.count || 1);
            io.emit('configUpdate', gameConfig);
        });
    });

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
});
