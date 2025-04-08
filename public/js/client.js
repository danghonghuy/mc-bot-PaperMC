const socket = io();

// DOM Elements
const chatLog = document.getElementById('chat-log');
const chatInputForm = document.getElementById('chat-input-form');
const messageInput = document.getElementById('message-input');
const statusDiv = document.getElementById('status');
const healthSpan = document.getElementById('health');
const foodSpan = document.getElementById('food');
const positionSpan = document.getElementById('position');
const viewerContainer = document.getElementById('viewer-container');
const viewerStatus = document.getElementById('viewer-status');

let botUsername = null;

// Utility functions
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function addMessage(type, username, message) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message');

    const safeUsername = username ? escapeHtml(username) : '';

    switch(type) {
        case 'chat':
            const usernameSpan = document.createElement('span');
            usernameSpan.classList.add('chat-username');
            usernameSpan.innerHTML = safeUsername + ': ';
            messageElement.appendChild(usernameSpan);
            messageElement.appendChild(document.createTextNode(message));
            
            if (botUsername && username === botUsername) {
                messageElement.classList.add('bot-message');
            }
            break;
        case 'system':
            messageElement.classList.add('system-message');
            messageElement.textContent = message;
            break;
        case 'error':
            messageElement.classList.add('error-message');
            messageElement.textContent = `LỖI: ${message}`;
            break;
        default:
            messageElement.textContent = message;
    }

    chatLog.appendChild(messageElement);
    chatLog.scrollTop = chatLog.scrollHeight;
}

// Viewer Implementation
function initViewer(port) {
    viewerContainer.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.src = `http://${window.location.hostname}:${port}`;
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    viewerContainer.appendChild(iframe);
    viewerStatus.textContent = `Viewer đã kết nối (cổng ${port})`;
    viewerStatus.style.color = 'green';
}

// Socket.IO Event Handlers
socket.on('connect', () => {
    statusDiv.textContent = 'Đã kết nối tới server web';
    console.log('Socket.IO connected');
});

socket.on('disconnect', () => {
    statusDiv.textContent = 'Đã mất kết nối tới server web';
    viewerStatus.textContent = 'Mất kết nối viewer';
    viewerStatus.style.color = 'red';
});

socket.on('bot_info', (data) => {
    if (data?.username) {
        botUsername = data.username;
        console.log(`Received bot username: ${botUsername}`);
    }
});

socket.on('viewer_ready', (data) => {
    console.log(`Viewer ready at port ${data.port}`);
    initViewer(data.port);
});

socket.on('viewer_error', (message) => {
    console.error("Viewer error:", message);
    viewerStatus.textContent = `Lỗi Viewer: ${message}`;
    viewerStatus.style.color = 'red';
});

socket.on('chat', (data) => addMessage('chat', data.username, data.message));
socket.on('system_message', (data) => addMessage('system', null, data.message));
socket.on('health', (data) => {
    healthSpan.textContent = data.health?.toFixed(1) ?? 'N/A';
    foodSpan.textContent = data.food ?? 'N/A';
});
socket.on('bot_position', (data) => {
    positionSpan.textContent = data ? `X: ${data.x.toFixed(1)}, Y: ${data.y.toFixed(1)}, Z: ${data.z.toFixed(1)}` : 'N/A';
});
socket.on('bot_status', (message) => statusDiv.textContent = message);
socket.on('bot_error', (message) => {
    statusDiv.textContent = `Lỗi: ${message}`;
    addMessage('error', null, message);
});

// Chat Form Handler
chatInputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = messageInput.value.trim();
    if (message) {
        socket.emit('sendChat', message);
        messageInput.value = '';
    }
});
function initViewer(port) {
    const iframe = document.getElementById('viewer-iframe');
    iframe.src = `http://${window.location.hostname}:${port}`;
    document.getElementById('viewer-status').textContent = `Viewer đã kết nối (cổng ${port})`;
    document.getElementById('viewer-status').style.color = 'green';
    
    // Thêm hàm reset góc nhìn
    window.resetViewerCamera = function() {
        iframe.contentWindow.postMessage({ type: 'resetView' }, '*');
    };
}
function initViewer(port) {
    console.log(`Đang khởi tạo viewer trên cổng ${port}`);
    const iframe = document.getElementById('viewer-iframe');
    const statusDiv = document.getElementById('viewer-status');
    
    iframe.style.display = 'block';
    iframe.src = `http://localhost:${port}`;
    
    iframe.onload = function() {
        statusDiv.textContent = `✅ Viewer đã sẵn sàng (cổng ${port})`;
        statusDiv.style.color = 'lightgreen';
    };
    
    iframe.onerror = function() {
        statusDiv.textContent = `❌ Lỗi kết nối viewer`;
        statusDiv.style.color = 'red';
    };
    
    // Hàm reset góc nhìn
    window.resetViewer = function() {
        if (iframe.contentWindow) {
            iframe.contentWindow.postMessage({ type: 'resetView' }, '*');
        }
    };
}
// Initialization
console.log("Client script loaded.");
statusDiv.textContent = 'Đang kết nối tới server web...';
viewerStatus.textContent = 'Đang chờ viewer...';
viewerStatus.style.color = 'orange';