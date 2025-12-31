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

// 核心設定
const DEFAULT_PASS = "Aa12345678"; // 預設密碼
// 這兩個帳號登入後會直接變成管理員
const ADMIN_ACCOUNTS = ["louis_chen_0705_1", "louis_chen_0705_2"]; 

let users = {};   
let players = {}; 
let gameConfig = { minNumber: 1, maxNumber: 100 };

// --- 雲端存檔功能 ---
async function loadData() {
    try {
        console.log('正在從雲端讀取資料...');
        const response = await axios.get(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
            headers: { 'X-Master-Key': API_KEY }
        });
        if (response.data.record) {
            if (response.data.record.users) users = response.data.record.users;
            if (response.data.record.players) players = response.data.record.players;
            console.log(`讀取成功！已註冊帳號: ${Object.keys(users).length} 人`);
        }
    } catch (error) {
        console.error('讀取失敗:', error.message);
    }
}

async function saveData() {
    try {
        await axios.put(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
            users: users,
            players: players
        }, {
            headers: { 'X-Master-Key': API_KEY, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('存檔失敗:', error.message);
    }
}

app.use(express.static(path.join(__dirname, 'public')));

loadData().then(() => {
    
    io.on('connection', (socket) => {
        socket.emit('configUpdate', gameConfig);

        // 登入邏輯
        socket.on('userLogin', (data) => {
            const username = data.username.trim(); 
            const password = data.password.trim();

            if (!username || !password) {
                socket.emit('loginError', '請輸入 IG 帳號和密碼！');
                return;
            }

            // 檢查帳號是否存在
            if (users[username]) {
                if (users[username] === password) {
                    // 密碼正確
                    const isAdmin = ADMIN_ACCOUNTS.includes(username);
                    
                    socket.emit('loginSuccess', { 
                        username: username, 
                        isAdmin: isAdmin, 
                        isDefaultPass: (password === DEFAULT_PASS) 
                    });

                    // 如果是管理員，直接傳送目前名單
                    if (isAdmin) {
                        socket.emit('adminUpdate', players);
                    }

                } else {
                    socket.emit('loginError', '密碼錯誤！');
                }
            } else {
                socket.emit('loginError', '此帳號不在名單內，請聯繫管理員！');
            }
        });

        // 修改密碼 (有限制)
        socket.on('changePassword', (data) => {
            const { username, oldPass, newPass } = data;
            
            // 驗證舊密碼
            if (users[username] && users[username] === oldPass) {
                // 限制：只有當舊密碼是預設密碼時，才允許使用者自己改
                if (oldPass !== DEFAULT_PASS) {
                    socket.emit('changePasswordError', '你已經修改過密碼了！如需重置請找管理員。');
                    return;
                }

                users[username] = newPass;
                saveData();
                socket.emit('changePasswordSuccess');
            } else {
                socket.emit('changePasswordError', '舊密碼輸入錯誤！');
            }
        });

        // 提交數字
        socket.on('submitNumber', (data) => {
            const num = parseInt(data.number);
            const username = data.username;

            if (num < gameConfig.minNumber || num > gameConfig.maxNumber) {
                socket.emit('submitError', `數字必須在 ${gameConfig.minNumber} 到 ${gameConfig.maxNumber} 之間！`);
                return;
            }

            // 重複檢查
            for (let p of Object.values(players)) {
                if (p.number === num) {
                    socket.emit('submitError', `數字 ${num} 已經被別人選走了！`);
                    return;
                }
                // 同一個人不能重複佔位
                if (p.username === username && p.id !== socket.id) {
                     delete players[p.id]; 
                }
            }

            players[socket.id] = { id: socket.id, username: username, number: num };
            
            socket.emit('submitSuccess', { username: username, number: num });
            io.emit('adminUpdate', players); // 廣播給管理員
            saveData();
        });

        // 管理員功能
        socket.on('adminSetConfig', (newConfig) => {
            gameConfig.minNumber = parseInt(newConfig.min);
            gameConfig.maxNumber = parseInt(newConfig.max);
            io.emit('configUpdate', gameConfig);
        });

        socket.on('adminAnnounceWinner', (winnerSocketId) => {
            io.to(winnerSocketId).emit('gameResult', { status: 'win' });
            for (let socketId in players) {
                if (socketId !== winnerSocketId) {
                    io.to(socketId).emit('gameResult', { status: 'lose' });
                }
            }
        });
        
        socket.on('disconnect', () => {});
    });

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`伺服器啟動！埠號: ${PORT}`);
    });
});