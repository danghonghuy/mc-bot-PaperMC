// public/client.js
const socket = io();

// Lấy các element trên trang
const chatLog = document.getElementById('chat-log');
const chatInputForm = document.getElementById('chat-input-form'); // Sửa ID form
const messageInput = document.getElementById('message-input');
const statusDiv = document.getElementById('status');
const healthSpan = document.getElementById('health');
const foodSpan = document.getElementById('food');
const positionSpan = document.getElementById('position'); // Element mới cho vị trí
const viewerCanvas = document.getElementById('viewer-canvas');
const viewerStatus = document.getElementById('viewer-status');

let viewerInstance = null;
let botUsername = 'Bot'; // Tên mặc định, có thể cập nhật sau

// --- Hàm tiện ích ---
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') {
         try { unsafe = String(unsafe); } catch (e) { return ''; }
    }
    return unsafe
         .replace(/&/g, "&")
         .replace(/</g, "<")
         .replace(/>/g, ">")
         .replace(/"/g, "")
         .replace(/'/g, "'");
}

// Hàm addMessage - KHÔNG dùng safeMessage nữa
function addMessage(type, username, message) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message');

    // Chỉ escape username nếu cần hiển thị an toàn ở đâu đó
    const safeUsername = escapeHtml(username);
    // const safeMessage = escapeHtml(message); // <<<--- XÓA DÒNG NÀY

    switch(type) {
        case 'chat':
            const usernameSpan = document.createElement('span');
            usernameSpan.classList.add('chat-username');
            usernameSpan.textContent = safeUsername + ': '; // Dùng username đã escape (nếu cần)
            messageElement.appendChild(usernameSpan);
            // Dùng message gốc với createTextNode, trình duyệt tự xử lý < > &
            messageElement.appendChild(document.createTextNode(message));
            break;
        case 'system':
            messageElement.classList.add('system-message');
            messageElement.textContent = message; // textContent an toàn
            break;
        case 'error':
            messageElement.classList.add('error-message');
            messageElement.textContent = `LỖI: ${message}`; // textContent an toàn
            break;
        default:
            messageElement.textContent = message; // textContent an toàn
    }

    chatLog.appendChild(messageElement);
    const isScrolledToBottom = chatLog.scrollHeight - chatLog.clientHeight <= chatLog.scrollTop + 30;
    if (isScrolledToBottom) {
        chatLog.scrollTop = chatLog.scrollHeight;
    }
}

// --- Xử lý Viewer ---
socket.on('viewer_port', (port) => {
    if (!viewerCanvas) {
        console.error("Canvas element #viewer-canvas not found!");
        viewerStatus.textContent = "Lỗi: Không tìm thấy canvas!";
        viewerStatus.style.color = 'red';
        return;
    }
    if (typeof Viewer === 'undefined') {
         console.error("Prismarine Viewer client library (index.js) not loaded!");
         viewerStatus.textContent = "Lỗi: Thư viện Viewer chưa tải!";
         viewerStatus.style.color = 'red';
         return;
    }
    if (viewerInstance) {
        console.log("Viewer đã được khởi tạo, bỏ qua.");
        return; // Tránh khởi tạo lại
    }

    console.log(`Received viewer port: ${port}. Initializing viewer...`);
    viewerStatus.textContent = `Đang kết nối tới viewer (cổng ${port})...`;
    viewerStatus.style.color = 'orange';

    try {
        // Lấy phiên bản MC từ server nếu có, nếu không dùng mặc định
        const mcVersion = bot?.version || "1.21.4"; // Cần cách lấy version từ server hoặc đặt cố định
        viewerInstance = new Viewer(viewerCanvas, mcVersion);

        const viewerUrl = `ws://${window.location.hostname}:${port}`;
        console.log(`Connecting viewer to: ${viewerUrl}`);
        viewerInstance.connect(viewerUrl);

        viewerInstance.on('connect', () => {
             console.log("Viewer connected!");
             viewerStatus.textContent = "Viewer đã kết nối";
             viewerStatus.style.color = 'lime';
        });
         viewerInstance.on('error', (err) => {
             console.error("Viewer Error:", err);
             viewerStatus.textContent = `Lỗi Viewer: ${err.message || err}`;
             viewerStatus.style.color = 'red';
             viewerInstance = null; // Reset để có thể thử kết nối lại
         });
         viewerInstance.on('close', () => {
             console.log("Viewer connection closed.");
             viewerStatus.textContent = "Viewer đã ngắt kết nối";
             viewerStatus.style.color = 'orange';
             viewerInstance = null; // Reset
         });

    } catch (error) {
        console.error("Error initializing or connecting viewer:", error);
        viewerStatus.textContent = `Lỗi khởi tạo Viewer: ${error.message || error}`;
        viewerStatus.style.color = 'red';
        viewerInstance = null; // Reset
    }
});

socket.on('viewer_error', (message) => {
    console.error("Viewer error from server:", message);
    viewerStatus.textContent = `Lỗi Viewer Server: ${message}`;
    viewerStatus.style.color = 'red';
});


// --- Lắng nghe sự kiện từ Server ---
socket.on('connect', () => {
    statusDiv.textContent = 'Đã kết nối tới server web';
    console.log('Socket.IO connected');
});

socket.on('disconnect', () => {
    statusDiv.textContent = 'Đã mất kết nối tới server web';
    console.log('Socket.IO disconnected');
    viewerStatus.textContent = "Đã ngắt kết nối server";
    viewerStatus.style.color = 'red';
    healthSpan.textContent = 'N/A';
    foodSpan.textContent = 'N/A';
    positionSpan.textContent = 'N/A';
});

socket.on('chat', (data) => {
    addMessage('chat', data.username, data.message);
});

socket.on('system_message', (data) => {
    addMessage('system', null, data.message);
});

socket.on('health', (data) => {
    healthSpan.textContent = data.health?.toFixed(1) ?? 'N/A';
    foodSpan.textContent = data.food ?? 'N/A';
});

socket.on('bot_position', (data) => { // Lắng nghe sự kiện vị trí
    if (data && typeof data.x === 'number') {
        positionSpan.textContent = `X: ${data.x.toFixed(1)}, Y: ${data.y.toFixed(1)}, Z: ${data.z.toFixed(1)}`;
    } else {
        positionSpan.textContent = 'N/A';
    }
});


socket.on('bot_status', (message) => {
    statusDiv.textContent = message;
    // Không thêm mọi status vào chat log nữa để tránh spam
    // addMessage('system', null, `Trạng thái bot: ${message}`);
});

socket.on('bot_error', (message) => {
    statusDiv.textContent = `Lỗi: ${message}`;
    addMessage('error', null, message); // Thêm lỗi vào chat log
});


// --- Gửi sự kiện tới Server ---
chatInputForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const message = messageInput.value.trim();
    if (message) {
        socket.emit('sendChat', message);
        // Không hiển thị tin nhắn của mình ở đây nữa, chờ server gửi lại qua 'chat'
        messageInput.value = '';
    }
});

console.log("Client script loaded.");
statusDiv.textContent = 'Đang kết nối tới server web...';
viewerStatus.textContent = 'Đang chờ thông tin viewer...'; // Trạng thái ban đầu của viewer