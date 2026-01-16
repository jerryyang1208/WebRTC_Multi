// server.js - 优化精简版 WebRTC Mesh 信令服务器
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const os = require('os'); 

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 存储连接
const clients = new Map(); // id -> {ws, isInMeeting}
const meetingMembers = new Set();

// 生成短ID
function generateId() {
  return Math.random().toString(36).substr(2, 8);
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

// WebSocket连接处理
wss.on('connection', (ws) => {
  const clientId = generateId();
  console.log(`📱 客户端连接: ${clientId}`);
  
  // 存储连接
  clients.set(clientId, { ws, isInMeeting: false });
  
  // 发送ID给客户端
  sendToClient(clientId, 'id', { id: clientId });
  
  // 消息处理
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      
      switch (msg.type) {
        case 'join':
          if (!clients.get(clientId).isInMeeting) {
            clients.get(clientId).isInMeeting = true;
            meetingMembers.add(clientId);
            
            // 通知所有成员有人加入
            forwardToMeeting('user-join', { id: clientId });
            
            // 发送当前成员列表给新加入者
            sendToClient(clientId, 'members', { 
              members: Array.from(meetingMembers)
            });
            
            console.log(`✅ ${clientId} 加入会议，当前成员: ${meetingMembers.size}`);
          }
          break;
          
        case 'leave':
          if (clients.get(clientId).isInMeeting) {
            clients.get(clientId).isInMeeting = false;
            meetingMembers.delete(clientId);
            
            // 通知所有成员有人离开
            forwardToMeeting('user-leave', { id: clientId });
            console.log(`❌ ${clientId} 离开会议`);
          }
          break;
          
        case 'signal':
          // 转发信令消息
          if (msg.target && clients.has(msg.target)) {
            sendToClient(msg.target, 'signal', {
              from: clientId,
              data: msg.data
            });
          }
          break;
      }
    } catch (err) {
      console.error('消息解析错误:', err);
    }
  });
  
  // 连接关闭
  ws.on('close', () => {
    console.log(`📴 客户端断开: ${clientId}`);
    
    // 如果是在会议中，通知其他成员
    if (clients.get(clientId)?.isInMeeting) {
      meetingMembers.delete(clientId);
      forwardToMeeting('user-leave', { id: clientId });
    }
    
    clients.delete(clientId);
  });
  
  // 错误处理
  ws.on('error', (err) => {
    console.error(`WebSocket错误 [${clientId}]:`, err);
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
