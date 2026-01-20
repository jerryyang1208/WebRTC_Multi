<div align="right">
  <a href="README.md">中文</a>
</div>

# WebRTC Mesh Multi-Participant Video Conference System
A decentralized multi-participant video conference system based on WebRTC Mesh architecture, supporting real-time audio and video communication.

## Project Introduction
This is a one-to-one video conference application implemented using WebRTC technology with a Mesh architecture. It uses WebSocket as the signaling server and supports real-time audio-video communication among multiple clients (up to four) on the web, either within the same local network or across different networks over the Internet. The project includes a complete front-end interface and back-end signaling server, ready to use out-of-the-box, making it suitable for learning and extending WebRTC-related technologies.

## Features
- 🎥 Supports multi-participant real-time video conferencing using a Mesh network structure, establishing direct P2P connections between participants
- 🎤 Supports audio and video stream transmission and status synchronization, with real-time display of camera and microphone on/off states across clients
- 🔌 WebSocket signaling server manages connections; no central server is required for media forwarding—video streams are transmitted directly between participants
- 📱 Responsive design, compatible with mobile and desktop devices, and supports modern mainstream browsers (Chrome, Edge, Safari)
- 📊 Shows a real-time updated participant list with user IDs regardless of whether the client is currently in a meeting
- 🎯 Clean and intuitive user interface, with the original black background updated to a gradient blue-purple, improving overall layout aesthetics
- 🔄 Automatically handles ICE candidates and SDP negotiation, uses HTTPS and WSS for secure connections to ensure meeting communication security

## Technology Stack
### Front-end
- HTML5 / CSS3 / JavaScript: User interface
- WebRTC API: Real-time audio-video communication
- WebSocket: Signaling transmission
- MediaStream API: Device media access

### Back-end
- Node.js: Server runtime environment
- Express: Web server
- ws: WebSocket server
- HTTPS: Secure connection communication

## Quick Start
### Prerequisites
- Node.js 14.0 or higher
- A modern browser with WebRTC support
- Camera and microphone (optional)

### Configuration Steps
- Install dependencies in terminal: `npm install express ws https fs`
- Generate SSL certificate: `openssl req -nodes -new -x509 -keyout server.key -out server.cert`
- Start the server directly: `node server.js`

### Access the Page
- Local access: Follow the terminal output and open `https://localhost:8081` in your browser
- Within LAN: After server starts, the LAN access address will be shown, e.g., `https://192.168.31.93:8081`
- Cross-network: Use a tunneling tool (e.g., Ngrok, frp) or deploy to a cloud server; the author used Ngrok

### Basic Operations
- First, enter the server address (examples given above 👆 for local, remote, or cross-network access) in the prompt box to connect to the server.
- Once a client successfully loads the page, the "Participants" area will show information of clients currently in the meeting, regardless of whether the viewer has joined.
- Any client can "Join Meeting" without turning on the camera/microphone, and will be displayed with a "shadow overlay + 📷 camera off" state.
- Click the red "OFF" button next to the microphone under "Device Status" to switch it to green "ON" and enable local audio output; simultaneously, the participant list will update the client's ID label from red "Muted" to green "Mic On".
- Click the red "OFF" button next to the camera under "Device Status" to switch it to green "ON" and enable local video output; simultaneously, the "Video Conference" area will replace the shadow overlay with the live video stream.
- Click "Leave Meeting" to exit the meeting room; the "Participants" area will still show information of clients currently in the meeting.

# Contact & Inquiries

Author's blog: https://www.zhihu.com/people/13-73-62-89-19

Personal email: 2022280099@email.szu.edu.cn

This project will continue to be improved with more features and interface interactions. Welcome to raise issues and share suggestions for enhancements!

Thank you for your attention and interest!