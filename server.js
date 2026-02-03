const express = require('express');
const https = require('https');  // 改为 https
const fs = require('fs');        // 添加文件系统模块
const WebSocket = require('ws');
const os = require('os');

// 读取 SSL 证书和私钥
const sslOptions = {
  key: fs.readFileSync('server.key'),
  cert: fs.readFileSync('server.cert')
};

const app = express();
const server = https.createServer(sslOptions, app);  // 改为 HTTPS 服务器
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

// 添加一个简单的状态检查接口
app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    clients: clients.size,
    meetingMembers: meetingMembers.size,
    uptime: process.uptime()
  });
});

// WebSocket连接处理
wss.on('connection', (ws) => {
  const clientId = generateId();
  console.log(`📱 客户端连接: ${clientId} (HTTPS)`);
  
  // 存储连接
  clients.set(clientId, { ws, isInMeeting: false });
  
  // 发送ID给客户端
  sendToClient(clientId, 'id', { id: clientId });
  
  // 发送当前会议成员列表给新连接的用户
  if (meetingMembers.size > 0) {
      sendToClient(clientId, 'members', { 
          members: Array.from(meetingMembers)
      });
  }
  
  // 消息处理
  ws.on('message', (data) => {
    try {
        const msg = JSON.parse(data);
        
        switch (msg.type) {
            case 'join':
                if (!clients.get(clientId).isInMeeting) {
                    clients.get(clientId).isInMeeting = true;
                    meetingMembers.add(clientId);
                    
                    // 通知所有连接的客户端有人加入
                    broadcastToAll('user-join', { id: clientId });
                    
                    // 发送当前成员列表给所有客户端
                    broadcastToAll('members', { 
                        members: Array.from(meetingMembers)
                    });
                    
                    console.log(`✅ ${clientId} 加入会议，当前成员: ${meetingMembers.size}`);
                }
                break;
                
            case 'leave':
                if (clients.get(clientId).isInMeeting) {
                    clients.get(clientId).isInMeeting = false;
                    meetingMembers.delete(clientId);
                    
                    // 通知所有连接的客户端有人离开
                    broadcastToAll('user-leave', { id: clientId });
                    
                    // 发送更新后的成员列表给所有客户端
                    broadcastToAll('members', { 
                        members: Array.from(meetingMembers)
                    });
                    
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
          
          case 'device-status':
            // 转发设备状态消息给会议中的其他成员
            if (msg.userId && meetingMembers.has(clientId)) {
                forwardToMeeting('device-status', {
                    userId: msg.userId,
                    cameraOn: msg.cameraOn,
                    micOn: msg.micOn,
                    sequence: msg.sequence
                }, clientId);
            }
            break;
      }
    } catch (err) {
      console.error('消息解析错误:', err);
    }
  });

  // 添加广播函数
function broadcastToAll(type, data, excludeId = null) {
  const message = JSON.stringify({ type, ...data });
  
  clients.forEach((client, clientId) => {
      if (clientId === excludeId) return;
      
      if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(message);
      }
  });
}
  
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

// 启动 HTTPS 服务器
const PORT = 8081;
server.listen(PORT, () => {
    console.log(`🚀 HTTPS 信令服务器启动成功: https://localhost:${PORT}`);
    console.log(`🔐 使用 HTTPS 安全连接`);
    
    // 打印局域网 HTTPS 地址
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                console.log(`🌐 局域网 HTTPS 访问: https://${net.address}:${PORT}`);
            }
        }
    }
    
    console.log('\n📝 重要提示:');
    console.log('1. 首次访问可能需要接受自签名证书');
    console.log('2. Chrome: 点击"高级" → "继续访问"');
    console.log('3. Safari: 点击"显示详细信息" → "访问此网站"');
});
