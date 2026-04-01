const express = require('express');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const os = require('os');

// 读取 SSL 证书和私钥
const sslOptions = {
    key: fs.readFileSync('server.key'),
    cert: fs.readFileSync('server.cert')
};

const app = express();
app.use(express.json());

const server = https.createServer(sslOptions, app);
const wss = new WebSocket.Server({ server });

// 存储连接
const clients = new Map(); // id -> {ws, isInMeeting, isAlive}
const meetingMembers = new Set();

// 会话记录
let currentSessionId = null;
const sessions = new Map(); // sessionId -> { startTime, members: Map<id, {report}>, lastActivity: number }
let pendingSummaryTimer = null;

// ==================== 定期清理过期会话 (内存泄漏保护) ====================
setInterval(() => {
    const now = Date.now();
    sessions.forEach((session, id) => {
        // 如果会话超过 2 小时无活动，则清理（防止意外内存泄漏）
        if (now - (session.lastActivity || session.startTime) > 2 * 60 * 60 * 1000) {
            console.log(`🧹 清理超时会话: ${id}`);
            sessions.delete(id);
        }
    });
}, 30 * 60 * 1000); // 每 30 分钟执行一次

function getOrCreateSession() {
    if (!currentSessionId) {
        currentSessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        sessions.set(currentSessionId, { 
            startTime: Date.now(), 
            lastActivity: Date.now(),
            members: new Map() 
        });
        console.log(`🎬 会议会话开始: ${currentSessionId}`);
    }
    return currentSessionId;
}

function generateId() {
    return Math.random().toString(36).substr(2, 8);
}

function getFormattedTime() {
    const now = new Date();
    // 将 ISO 格式 2026-03-27T16:26:08.804Z 转换为 2026.03.27-16:26:08:804ms-UTC
    const iso = now.toISOString();
    const parts = iso.split('T');
    const datePart = parts[0].replace(/-/g, '.');
    const timePart = parts[1].replace('.', ':').replace('Z', 'ms-UTC');
    return `${datePart}-${timePart}`;
}

// ==================== QoS 汇总输出 ====================
function outputQoSSummary(sessId) {
    const session = sessions.get(sessId);
    if (!session) return;

    const duration = Math.round((Date.now() - session.startTime) / 1000);
    console.log(`\n🏁 会议结束 | 会话: ${sessId} | 时长: ${duration}s`);
    console.log(`📊 QoS汇总 | 参会人数: ${session.members.size}`);

    session.members.forEach((record, id) => {
        if (record.report) {
            const lat = record.report.avgLatency === -1 ? 'N/A' : `${record.report.avgLatency}ms`;
            console.log(`   👤 ${id} | 延迟: ${lat} | 丢包: ${record.report.avgPacketLoss}% | 连接成功率: ${record.report.connectionSuccessRate}%`);
        } else {
            console.log(`   👤 ${id} | (未获取到 QoS 报告)`);
        }
    });

    const validReports = Array.from(session.members.values())
        .map(m => m.report)
        .filter(r => r !== null && r.avgLatency !== -1); // 过滤掉无效数据

    if (validReports.length > 0) {
        const n = validReports.length;
        const avgLatency = Math.round(validReports.reduce((s, r) => s + r.avgLatency, 0) / n);
        const avgLoss = (validReports.reduce((s, r) => s + r.avgPacketLoss, 0) / n).toFixed(1);
        const avgSuccess = (validReports.reduce((s, r) => s + r.connectionSuccessRate, 0) / n).toFixed(1);
        console.log(`   📈 均值(${n}人) | 延迟: ${avgLatency}ms | 丢包: ${avgLoss}% | 连接成功率: ${avgSuccess}%`);

        // 找到瞬时延迟最高的客户端
        let peakClient = null;
        let maxPeakLatency = -1;

        // 1. 先找到全局绝对最高延迟
        session.members.forEach((record) => {
            if (record.report && record.report.maxLatency > maxPeakLatency) {
                maxPeakLatency = record.report.maxLatency;
            }
        });

        // 2. 在所有报告了接近该最高延迟的客户端中，选择平均延迟最高的那个（即真正的瓶颈节点）
        let maxAvgOfPeaks = -1;
        session.members.forEach((record, id) => {
            if (record.report) {
                // 如果该客户端的峰值达到全局峰值的 90% 以上，将其列为候选
                if (record.report.maxLatency >= maxPeakLatency * 0.9) {
                    if (record.report.avgLatency > maxAvgOfPeaks) {
                        maxAvgOfPeaks = record.report.avgLatency;
                        peakClient = id;
                    }
                }
            }
        });

        if (peakClient) {
            console.log(`   🔥 峰值延迟 | 客户端: ${peakClient} | 瞬时最高延迟: ${maxPeakLatency}ms`);
        }
    }
    console.log('');

    sessions.delete(sessId);
    currentSessionId = null;
    pendingSummaryTimer = null;
}

// 会议空了后等 2s（给 beacon 留时间），然后输出汇总
function scheduleSummary(sessId) {
    if (pendingSummaryTimer) clearTimeout(pendingSummaryTimer);
    pendingSummaryTimer = setTimeout(() => outputQoSSummary(sessId), 2000);
}

// ==================== 统一成员离开处理 ====================
function handleMemberLeave(clientId, reason = 'unknown') {
    if (!meetingMembers.has(clientId)) return;

    meetingMembers.delete(clientId);
    broadcastToAll('user-leave', { id: clientId });
    broadcastToAll('members', { members: Array.from(meetingMembers) });
    console.log(`❌ [${getFormattedTime()}] ${clientId} 离开会议(${reason})，剩余成员: ${meetingMembers.size}`);

    if (meetingMembers.size === 0 && currentSessionId) {
        scheduleSummary(currentSessionId);
        // 彻底清理会议成员状态，防止旧状态残留
        meetingMembers.clear();
    }
}

// 转发消息（仅转发给会议成员）
function forwardToMeeting(type, data, excludeId = null) {
    const message = JSON.stringify({ type, ...data });
    
    meetingMembers.forEach(memberId => {
        if (memberId === excludeId) return;
        const client = clients.get(memberId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(message);
        }
    });
}

// 广播给所有连接的客户端
function broadcastToAll(type, data, excludeId = null) {
    const message = JSON.stringify({ type, ...data });
    
    clients.forEach((client, clientId) => {
        if (clientId === excludeId) return;
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(message);
        }
    });
}

// 发送给指定客户端
function sendToClient(clientId, type, data) {
    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type, ...data }));
    }
}

// 静态文件
app.use(express.static(__dirname));
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/status', (req, res) => {
    res.json({
        status: 'running',
        clients: clients.size,
        meetingMembers: meetingMembers.size,
        uptime: process.uptime()
    });
});

// sendBeacon QoS 上报端点
app.post('/qos-beacon', (req, res) => {
    const data = req.body;
    if (!data?.clientId) return res.status(400).end();

    const report = {
        connectionSuccessRate: data.connectionSuccessRate || 0,
        avgLatency: data.avgLatency || 0,
        maxLatency: data.maxLatency || 0,
        avgPacketLoss: data.avgPacketLoss || 0
    };

    // 写入会话成员记录（beacon 可能在 ws close 之后到达，currentSessionId 此时仍有效）
    if (currentSessionId && sessions.has(currentSessionId)) {
        const memberRecord = sessions.get(currentSessionId).members.get(data.clientId);
        if (memberRecord) memberRecord.report = report;
    }

    res.status(204).end();
});

// WebSocket连接处理
wss.on('connection', (ws) => {
    const clientId = generateId();
    
    clients.set(clientId, { ws, isInMeeting: false, isAlive: true, missedHeartbeats: 0 });
    
    sendToClient(clientId, 'id', { id: clientId });
    
    if (meetingMembers.size > 0) {
        sendToClient(clientId, 'members', { members: Array.from(meetingMembers) });
    }
    
    // 心跳检测
    ws.on('pong', () => {
        const client = clients.get(clientId);
        if (client) client.isAlive = true;
    });
    
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            
            switch (msg.type) {
                case 'join': {
                    const client = clients.get(clientId);
                    if (!client) break;
                    
                    if (client.isInMeeting && meetingMembers.has(clientId)) {
                        sendToClient(clientId, 'members', { members: Array.from(meetingMembers) });
                        break;
                    }
                    
                    client.isInMeeting = true;
                    meetingMembers.add(clientId);
                    
                    const sessId = getOrCreateSession();
                    sessions.get(sessId).members.set(clientId, { report: null });
                    
                    broadcastToAll('user-join', { id: clientId });
                    broadcastToAll('members', { members: Array.from(meetingMembers) });
                    
                    console.log(`✅ [${getFormattedTime()}] ${clientId} 加入会议，当前成员: ${meetingMembers.size}`);
                    break;
                }
                
                case 'leave':
                    if (clients.get(clientId)?.isInMeeting) {
                        clients.get(clientId).isInMeeting = false;
                        handleMemberLeave(clientId, 'normal');
                    }
                    break;
                
                case 'performance-report': {
                    if (currentSessionId) {
                        const session = sessions.get(currentSessionId);
                        if (session) {
                            session.lastActivity = Date.now();
                            const memberRecord = session.members.get(clientId);
                            if (memberRecord) memberRecord.report = {
                                connectionSuccessRate: msg.connectionSuccessRate,
                                avgLatency: msg.avgLatency,
                                maxLatency: msg.maxLatency,
                                avgPacketLoss: msg.avgPacketLoss
                            };
                        }
                    }
                    break;
                }
                
                case 'signal':
                    if (msg.target && clients.has(msg.target)) {
                        sendToClient(msg.target, 'signal', {
                            from: clientId,
                            data: msg.data
                        });
                    }
                    break;
                
                case 'device-status':
                    if (msg.userId && meetingMembers.has(clientId)) {
                        forwardToMeeting('device-status', {
                            userId: msg.userId,
                            cameraOn: msg.cameraOn,
                            micOn: msg.micOn,
                            sequence: msg.sequence
                        }, clientId);
                    }
                    break;
                
                case 'chat-message':
                    if (msg.senderId && meetingMembers.has(clientId)) {
                        forwardToMeeting('chat-message', {
                            senderId: msg.senderId,
                            message: msg.message,
                            timestamp: msg.timestamp
                        }, clientId);
                        console.log(`💬 ${clientId}: ${msg.message.substring(0, 50)}`);
                    }
                    break;
                
                case 'file-message':
                    if (msg.senderId && meetingMembers.has(clientId)) {
                        forwardToMeeting('file-message', {
                            senderId: msg.senderId,
                            fileId: msg.fileId,
                            fileName: msg.fileName,
                            fileType: msg.fileType,
                            fileSize: msg.fileSize,
                            fileData: msg.fileData,
                            timestamp: msg.timestamp || new Date().toISOString()
                        }, clientId);
                        console.log(`📎 ${clientId} 发送文件: ${msg.fileName}`);
                    }
                    break;
            }
        } catch (err) {
            console.error('消息解析错误:', err);
        }
    });
    
    ws.on('close', () => {
        if (clients.get(clientId)?.isInMeeting) {
            clients.get(clientId).isInMeeting = false;
            handleMemberLeave(clientId, 'ws-close');
        }
        clients.delete(clientId);
    });
    
    ws.on('error', (err) => {
        console.error(`WebSocket错误 [${clientId}]:`, err);
    });
});

// 启动服务器
const PORT = 8888;
server.listen(PORT, () => {
    console.log(`🚀 HTTPS 信令服务器启动: https://localhost:${PORT}`);
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                console.log(`🌐 局域网访问: https://${net.address}:${PORT}`);
            }
        }
    }
});

// 心跳检测 (针对移动端优化，延长超时时间)
const heartbeatInterval = setInterval(() => {
    clients.forEach((client, clientId) => {
        if (client.missedHeartbeats >= 3) { // 连续 3 次未响应才断开
            console.log(`💀 心跳超时 (${client.missedHeartbeats}次)，断开死连接: ${clientId}`);
            if (client.isInMeeting) {
                client.isInMeeting = false;
                handleMemberLeave(clientId, 'heartbeat-timeout');
            }
            client.ws.terminate();
            clients.delete(clientId);
            return;
        }
        
        if (!client.isAlive) {
            client.missedHeartbeats = (client.missedHeartbeats || 0) + 1;
        } else {
            client.missedHeartbeats = 0;
            client.isAlive = false;
        }
        
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.ping();
        }
    });
}, 10000); // 10 秒检查一次，累计 30 秒超时断联

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});
