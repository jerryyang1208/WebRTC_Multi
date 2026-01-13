// server.js - 极简稳定版 WebRTC Mesh 信令服务器
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 核心存储：所有连接的客户端（ID -> WebSocket实例）
const clients = new Map();
// 存储所有参会者ID
const participants = new Set();

// 生成唯一客户端ID
function generateClientId() {
    return Math.random().toString(36).substring(2, 10);
}

// 广播消息给所有客户端（排除指定客户端）
function broadcast(message, excludeClient = null) {
    wss.clients.forEach(client => {
        if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// 托管静态文件（确保index.html能访问）
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// WebSocket 核心逻辑
wss.on('connection', (ws) => {
    console.log('✅ 新客户端连接');
    const clientId = generateClientId();
    
    // 1. 存储客户端连接
    clients.set(clientId, ws);
    // 新连接默认不加入会议，等待客户端主动加入
    console.log(`👤 客户端ID: ${clientId}，当前连接数: ${clients.size}`);

    // 2. 给新客户端发送ID
    ws.send(JSON.stringify({
        type: 'client-id',
        id: clientId
    }));

    // 3. 处理客户端消息
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            
            switch (msg.type) {
                // 前端请求全量参与者列表
                case 'get-participants':
                    ws.send(JSON.stringify({
                        type: 'participants-list',
                        participants: Array.from(participants)
                    }));
                    break;
                
                // 加入会议
                case 'join-meeting':
                    if (!participants.has(clientId)) {
                        participants.add(clientId);
                        // 通知所有人有新成员加入
                        broadcast({
                            type: 'user-joined',
                            id: clientId
                        });
                        // 向新加入者发送当前参与者列表
                        ws.send(JSON.stringify({
                            type: 'participants-list',
                            participants: Array.from(participants)
                        }));
                    }
                    break;
                
                // 转发P2P Offer
                case 'offer':
                    const offerTarget = clients.get(msg.target);
                    if (offerTarget && offerTarget.readyState === WebSocket.OPEN) {
                        offerTarget.send(JSON.stringify({
                            type: 'offer',
                            from: clientId,
                            offer: msg.offer
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: `目标用户 ${msg.target} 不存在或已断开`
                        }));
                    }
                    break;
                
                // 转发P2P Answer
                case 'answer':
                    const answerTarget = clients.get(msg.target);
                    if (answerTarget && answerTarget.readyState === WebSocket.OPEN) {
                        answerTarget.send(JSON.stringify({
                            type: 'answer',
                            from: clientId,
                            answer: msg.answer
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: `目标用户 ${msg.target} 不存在或已断开`
                        }));
                    }
                    break;
                
                // 转发ICE候选
                case 'ice-candidate':
                    const iceTarget = clients.get(msg.target);
                    if (iceTarget && iceTarget.readyState === WebSocket.OPEN) {
                        iceTarget.send(JSON.stringify({
                            type: 'ice-candidate',
                            from: clientId,
                            candidate: msg.candidate
                        }));
                    }
                    break;
                
                // 客户端主动离开
                case 'leave-meeting':
                    if (participants.has(clientId)) {
                        participants.delete(clientId);
                        broadcast({
                            type: 'user-left',
                            id: clientId
                        });
                    }
                    break;
            }
        } catch (e) {
            console.error('❌ 解析消息失败:', e);
        }
    });

    // 4. 客户端断开连接处理
    ws.on('close', () => {
        console.log(`❌ 客户端 ${clientId} 断开连接`);
        clients.delete(clientId);
        if (participants.has(clientId)) {
            participants.delete(clientId);
            // 广播用户离开
            broadcast({
                type: 'user-left',
                id: clientId
            });
        }
    });

    // 5. 错误处理
    ws.on('error', (err) => {
        console.error('⚠️ WebSocket错误:', err);
    });
});

// 启动服务器
const PORT = 8081;
server.listen(PORT, () => {
    console.log(`🚀 信令服务器启动成功: http://localhost:${PORT}`);
    // 打印局域网IP（方便多设备访问）
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                console.log(`🌐 局域网访问: http://${net.address}:${PORT}`);
            }
        }
    }
});