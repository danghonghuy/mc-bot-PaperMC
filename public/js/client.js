const socket = io();

// DOM Elements
const chatLog = document.getElementById('chat-log');
const chatInputForm = document.getElementById('chat-input-form');
const messageInput = document.getElementById('message-input');
const statusDiv = document.getElementById('status-text');
const healthSpan = document.getElementById('health');
const foodSpan = document.getElementById('food');
const positionSpan = document.getElementById('position');
const viewerContainer = document.getElementById('viewer-container');
const viewerStatus = document.getElementById('viewer-status');
const viewerIframe = document.getElementById('viewer-iframe');
const inventoryDisplay = document.getElementById('inventory-display');
const connectionStatus = document.getElementById('connection-status');
const waypointNameInput = document.getElementById('waypoint-name');

// Movement control variables
const movementKeys = {
    'w': 'forward',
    'a': 'left',
    's': 'back',
    'd': 'right',
    ' ': 'jump',
    'Shift': 'sneak' // Lowercase 'shift' might be needed depending on browser/OS
};
const activeMovements = new Set();
let currentViewMode = 'thirdPerson'; // Default should match server/viewer setting
let isMouseDown = false;
let lastMouseX = 0;
let lastMouseY = 0;
let botUsername = 'Bot'; // Will be updated by server

// Utility functions
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') {
        console.warn("escapeHtml received non-string input:", unsafe);
        return String(unsafe); // Convert to string before escaping
    }
    return unsafe
        .replace(/&/g, "&")
        .replace(/</g, "<")
        .replace(/>/g, ">")
        .replace(/"/g, "")
        .replace(/'/g, "'");
}


function addMessage(type, username, message) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message');

    const safeUsername = username ? escapeHtml(username) : '';
    const safeMessage = escapeHtml(message); // Escape the message content

    switch(type) {
        case 'chat':
            // Use innerHTML carefully only for structure, not user content directly
            messageElement.innerHTML = `<span class="chat-username">${safeUsername}: </span>${safeMessage}`;
            if (username === window.botUsername) { // Use window.botUsername
                messageElement.classList.add('bot-message');
            }
            break;
        case 'system':
            messageElement.classList.add('system-message');
            // Use innerHTML for icon + escaped message
            messageElement.innerHTML = `<i class="fas fa-info-circle"></i> ${safeMessage}`;
            break;
        case 'error':
            messageElement.classList.add('error-message');
            // Use innerHTML for icon + escaped message
            messageElement.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${safeMessage}`;
            break;
        default:
             // Fallback to textContent for safety if type is unknown
            messageElement.textContent = safeMessage;
    }

    chatLog.appendChild(messageElement);
    // Scroll down only if the user isn't scrolled up manually
    if (chatLog.scrollHeight - chatLog.scrollTop <= chatLog.clientHeight + 50) {
         chatLog.scrollTop = chatLog.scrollHeight;
    }
}


// Viewer initialization
function initViewer(port) {
    console.log(`[CLIENT.JS Viewer] Initializing viewer on port ${port}`);
  
    if (!viewerIframe || !viewerStatus) {
      console.error('[CLIENT.JS Viewer] ERROR: Cannot find iframe or viewerStatus element!');
      if (viewerStatus) {
        viewerStatus.innerHTML = `<i class="fas fa-times-circle"></i> Lỗi: Không tìm thấy iframe/status element!`;
        viewerStatus.classList.remove('hidden');
        viewerStatus.classList.add('viewer-error');
      }
      if (viewerIframe) viewerIframe.classList.remove('loaded');
      return;
    }
  
    console.log('[CLIENT.JS Viewer] Setting initial status view.');
    viewerStatus.classList.remove('hidden', 'viewer-error');
    viewerStatus.classList.add('viewer-loading');
    viewerStatus.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Đang kết nối viewer... (cổng ${port})`;
    viewerIframe.classList.remove('loaded');
  
    viewerIframe.onload = () => {
        console.log('✅ [CLIENT.JS Viewer] Iframe finished loading!');
        viewerIframe.classList.add('loaded');
        viewerStatus.classList.add('hidden');
        viewerStatus.classList.remove('viewer-loading', 'viewer-error');
    
        setTimeout(() => {
          const script = viewerIframe.contentWindow.document.createElement('script');
          script.textContent = `
            console.log('[Iframe] Script injected');
            window.addEventListener('message', (event) => {
              console.log('[Iframe] Received:', event.data);
              if (event.data.type === 'changeView' && window.prismarineViewer) {
                window.prismarineViewer.camera.firstPerson = event.data.mode === 'firstPerson';
                console.log('[Iframe] View mode set to:', window.prismarineViewer.camera.firstPerson);
              }
            });
          `;
          viewerIframe.contentWindow.document.head.appendChild(script);
        }, 1000); // Đợi 1 giây để viewer khởi tạo xong
      };
  
    viewerIframe.onerror = (error) => {
      console.error('❌ [CLIENT.JS Viewer] Iframe failed to load:', error);
      viewerStatus.innerHTML = `<i class="fas fa-times-circle"></i> Lỗi kết nối viewer (cổng ${port})`;
      viewerStatus.classList.remove('hidden', 'viewer-loading');
      viewerStatus.classList.add('viewer-error');
      viewerIframe.classList.remove('loaded');
    };
  
    const viewerFullUrl = `http://${window.location.hostname}:${port}`;
    console.log('[CLIENT.JS Viewer] Setting iframe src to:', viewerFullUrl);
    viewerIframe.src = viewerFullUrl;
  }

// Inventory display
function updateInventory(inventory) {
    if (!inventoryDisplay) {
        console.error("Inventory display element not found!");
        return;
    }
    inventoryDisplay.innerHTML = ''; // Clear previous items

    if (!Array.isArray(inventory)) {
        console.warn("Received non-array inventory data:", inventory);
        const emptyMsg = document.createElement('div');
        emptyMsg.textContent = 'Dữ liệu túi đồ không hợp lệ.';
        emptyMsg.style.textAlign = 'center';
        emptyMsg.style.gridColumn = '1 / -1';
        inventoryDisplay.appendChild(emptyMsg);
        return;
    }

    if (inventory.length === 0) {
         const emptyMsg = document.createElement('div');
         emptyMsg.textContent = 'Túi đồ trống.';
         emptyMsg.style.textAlign = 'center';
         emptyMsg.style.gridColumn = '1 / -1';
         inventoryDisplay.appendChild(emptyMsg);
         return;
    }

    inventory.forEach((item) => {
        if (item) {
            const itemElement = document.createElement('div');
            itemElement.className = 'inventory-item';

            const itemName = item.name ? escapeHtml(item.name) : 'unknown_item';
            const displayName = item.displayName ? escapeHtml(item.displayName) : 'Unknown Item';
            const count = typeof item.count === 'number' ? item.count : 1;
            const titleText = `${displayName} x${count}`;

            // ---> SỬ DỤNG LẠI API VERCEL <---
            const imgSrc = `https://minecraft-item-icons.vercel.app/api/item/${itemName}`;

            itemElement.innerHTML = `
                <img src="${imgSrc}"
                     alt="${displayName}"
                     title="${titleText}"
                     onerror="this.onerror=null; this.src='/img/Screenshot 2025-03-27 230012.png';">
                ${count > 1 ? count : ''}</span>
            `;
            inventoryDisplay.appendChild(itemElement);
        }
    });
}

socket.on('change_view_mode', (data) => {
    console.log(`[Socket] Received view mode change: ${data.mode}`);
    if (viewerIframe && viewerIframe.contentWindow) {
      viewerIframe.contentWindow.postMessage(
        { type: 'changeView', mode: data.mode },
        '*'
      );
      currentViewMode = data.mode;
      const icon = document.querySelector('#change-view i');
      if (icon) {
        icon.className = currentViewMode === 'firstPerson' ? 'fas fa-user' : 'fas fa-camera';
      }
    } else {
      console.warn('[Socket] Viewer iframe not available.');
      addMessage('error', null, 'Không thể thay đổi góc nhìn: Viewer chưa sẵn sàng.');
    }
  });
// Movement controls
function setupMovementControls() {
    // Keyboard controls
    document.addEventListener('keydown', (e) => {
        // Ignore input if focus is on chat input or waypoint input
        if (document.activeElement === messageInput || document.activeElement === waypointNameInput) {
            return;
        }
        // Normalize key (Shift, Space, etc.)
        const key = e.key === ' ' ? ' ' : e.key.length === 1 ? e.key.toLowerCase() : e.key; // Handle space and single chars vs modifiers

        if (movementKeys[key] && !activeMovements.has(key)) {
            activeMovements.add(key);
            socket.emit('bot_control', { action: 'start_move', direction: movementKeys[key] });
            e.preventDefault(); // Prevent default browser actions for movement keys (e.g., space scrolling)
        }
    });

    document.addEventListener('keyup', (e) => {
         if (document.activeElement === messageInput || document.activeElement === waypointNameInput) {
            return;
        }
        const key = e.key === ' ' ? ' ' : e.key.length === 1 ? e.key.toLowerCase() : e.key;

        if (movementKeys[key]) {
            activeMovements.delete(key);
            socket.emit('bot_control', { action: 'stop_move', direction: movementKeys[key] });
            e.preventDefault();
        }
    });

    // Button controls
    const movementButtons = {
        'move-forward': 'forward',
        'move-left': 'left',
        'move-back': 'back',
        'move-right': 'right',
        'jump-btn': 'jump',
        'sneak-btn': 'sneak' // Match the key in movementKeys ('Shift' vs 'sneak') - use 'sneak' for consistency
    };

    Object.entries(movementButtons).forEach(([id, direction]) => {
        const btn = document.getElementById(id);
        if (!btn) {
            console.warn(`Movement button not found: ${id}`);
            return;
        }
        // Use pointer events for better touch/mouse compatibility
        btn.addEventListener('pointerdown', (e) => {
             e.preventDefault(); // Prevent focus changes or text selection
            socket.emit('bot_control', { action: 'start_move', direction });
            btn.classList.add('active'); // Visual feedback
        });
        // Add listeners for pointer up and leaving the button area
         const stopAction = (e) => {
             e.preventDefault();
             if (btn.classList.contains('active')) { // Only emit if it was active
                 socket.emit('bot_control', { action: 'stop_move', direction });
                 btn.classList.remove('active');
             }
         };
         btn.addEventListener('pointerup', stopAction);
         btn.addEventListener('pointerleave', stopAction); // Stop if pointer leaves while pressed
         btn.addEventListener('contextmenu', e => e.preventDefault()); // Prevent right-click menu
    });
}


// Mouse controls for viewer
function setupMouseControls() {
    if (!viewerContainer) {
        console.error("Viewer container not found for mouse controls!");
        return;
    }
    viewerContainer.addEventListener('mousedown', (e) => {
        // Only activate look controls with left mouse button
        if (e.button === 0) { // 0 is the left mouse button
            isMouseDown = true;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            viewerContainer.style.cursor = 'grabbing';
            // Optional: Request pointer lock for better control (needs user interaction)
            // viewerContainer.requestPointerLock();
        }
         // Prevent default text selection behavior when dragging
         e.preventDefault();
    });

    // Listen on document to catch mouseup even if cursor leaves the viewer
    document.addEventListener('mouseup', (e) => {
        if (e.button === 0 && isMouseDown) { // Only react to left button mouseup if dragging was active
            isMouseDown = false;
            viewerContainer.style.cursor = 'grab';
             // Optional: Exit pointer lock if it was active
             // if (document.pointerLockElement === viewerContainer) {
             //     document.exitPointerLock();
             // }
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (isMouseDown) {
            // Use movementX/Y if pointer lock is active for raw delta
            // const dx = e.movementX || e.clientX - lastMouseX;
            // const dy = e.movementY || e.clientY - lastMouseY;

            const dx = e.clientX - lastMouseX;
            const dy = e.clientY - lastMouseY;

            lastMouseX = e.clientX;
            lastMouseY = e.clientY;

            // Only send if there's actual movement to reduce traffic
            if (dx !== 0 || dy !== 0) {
                socket.emit('bot_control', {
                    action: 'mouse_move',
                    deltaX: dx,
                    deltaY: dy
                });
            }
        }
    });

     // Prevent context menu on the viewer
     viewerContainer.addEventListener('contextmenu', e => e.preventDefault());
}


// Action controls
function setupActionControls() {
    const actionButtons = {
        'attack-btn': 'attack',
        'mine-btn': 'mine',
        'place-btn': 'place',
        'stop-btn': 'stop' // Use the specific action name 'stop'
    };

    Object.entries(actionButtons).forEach(([id, action]) => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', () => {
                socket.emit('bot_control', { action: action }); // Send the specific action
            });
        } else {
            console.warn(`Action button not found: ${id}`);
        }
    });
}


// View mode controls
function setupViewControls() {
    const changeViewBtn = document.getElementById('change-view');
    if (changeViewBtn) {
        changeViewBtn.addEventListener('click', () => {
            // Toggle the view mode state locally
            currentViewMode = currentViewMode === 'firstPerson' ? 'thirdPerson' : 'firstPerson';

            // Send the command to the server
            socket.emit('bot_control', {
                action: 'change_view',
                mode: currentViewMode
            });

            // Update the button icon based on the new mode
            const icon = changeViewBtn.querySelector('i'); // Find the icon inside the button
             if (icon) {
                 icon.className = currentViewMode === 'firstPerson'
                     ? 'fas fa-user' // Icon for first person
                     : 'fas fa-camera'; // Icon for third person (default)
             }
        });
    } else {
        console.warn("Change view button not found.");
    }


    const resetViewerBtn = document.getElementById('reset-viewer');
    if (resetViewerBtn) {
        resetViewerBtn.addEventListener('click', () => {
            // The actual reset logic might be within the iframe's context.
            // This button could potentially send a message *to* the iframe if needed,
            // or trigger a viewer-specific reset function if exposed globally.
            // For now, we assume Prismarine Viewer might expose a global function
            // or handle a specific event. A simple console log for now.
            console.log("Attempting to reset viewer camera (implementation specific)");
             if (typeof window.resetViewerCamera === 'function') {
                 window.resetViewerCamera(); // Example if viewer exposes such function
             } else if (viewerIframe && viewerIframe.contentWindow) {
                 // Attempt to send a message to the iframe
                 viewerIframe.contentWindow.postMessage({ type: 'resetCamera' }, '*');
                 console.log("Sent resetCamera message to iframe.");
             }
            // Alternatively, send a socket event to the server if the server can control the viewer camera reset
            // socket.emit('bot_control', { action: 'reset_viewer_camera' });
        });
    } else {
         console.warn("Reset viewer button not found.");
    }


    const toggleViewerBtn = document.getElementById('toggle-viewer');
     if (toggleViewerBtn && viewerContainer) {
         toggleViewerBtn.addEventListener('click', () => {
             const isHidden = viewerContainer.style.display === 'none';
             viewerContainer.style.display = isHidden ? 'block' : 'none'; // Toggle display
             // Update icon based on visibility state
             const icon = toggleViewerBtn.querySelector('i');
             if (icon) {
                 icon.className = isHidden ? 'fas fa-eye-slash' : 'fas fa-eye';
             }
         });
     } else {
         console.warn("Toggle viewer button or viewer container not found.");
     }


    const fullscreenBtn = document.getElementById('fullscreen-btn');
     if (fullscreenBtn && viewerIframe) {
         fullscreenBtn.addEventListener('click', () => {
             if (!document.fullscreenElement) {
                 // Request fullscreen on the iframe
                 if (viewerIframe.requestFullscreen) {
                     viewerIframe.requestFullscreen().catch(err => {
                         console.error(`Error attempting fullscreen: ${err.message} (${err.name})`);
                         alert(`Không thể vào chế độ toàn màn hình: ${err.message}`);
                     });
                 } else if (viewerIframe.webkitRequestFullscreen) { /* Safari */
                     viewerIframe.webkitRequestFullscreen();
                 } else if (viewerIframe.msRequestFullscreen) { /* IE11 */
                     viewerIframe.msRequestFullscreen();
                 }
             } else {
                  // Exit fullscreen if already in fullscreen
                  if (document.exitFullscreen) {
                      document.exitFullscreen();
                  } else if (document.webkitExitFullscreen) { /* Safari */
                      document.webkitExitFullscreen();
                  } else if (document.msExitFullscreen) { /* IE11 */
                      document.msExitFullscreen();
                  }
             }
         });
     } else {
         console.warn("Fullscreen button or viewer iframe not found.");
     }
}


// Macro controls - UPDATED WITH ALL MACROS
function setupMacroControls() {
    const macros = {
        // Col 1
        'macro-follow': { command: 'theo tôi' },
        'macro-protect': { command: 'bảo vệ tôi' },
        'macro-find-dia': { command: 'tìm kim cương' },
        'macro-collect-wood': { command: 'thu thập gỗ 64' },
        'macro-check-inv': { command: 'kiểm tra túi đồ' },
        // Col 2
        'macro-strip-mine': { command: 'đào hầm 50' },
        'macro-hunt-cow': { command: 'săn bò' },
        'macro-farm-wheat': { command: 'làm ruộng lúa mì' },
        'macro-build-house': { command: 'xây nhà' },
        'macro-scan-ores': { command: 'quét quặng' },
        // Col 3
        'macro-sleep': { command: 'đi ngủ' },
        'macro-clean-inv': { command: 'dọn túi đồ' },
        'macro-deposit-all': { command: 'cất đồ' },
        'macro-flatten-10': { command: 'làm phẳng 10' },
        'macro-equip-best': { command: 'trang bị tốt nhất' },
        // Col 4
        'macro-breed-cow': { command: 'cho bò ăn' },
        'macro-get-coords': { command: 'tọa độ của tôi' },
        'macro-capabilities': { command: 'bạn làm được gì?' },
        'macro-stop-task': { command: 'dừng' } // Command to stop current task via chat
    };

    Object.entries(macros).forEach(([id, macro]) => {
        const button = document.getElementById(id);
        if (button) {
            button.addEventListener('click', () => {
                // Add visual feedback on click
                 button.classList.add('active');
                 setTimeout(() => button.classList.remove('active'), 150); // Remove after a short delay

                console.log(`[Macro] Sending command: "${macro.command}" for ID: ${id}`);
                socket.emit('sendChat', macro.command);

                 // Optionally unfocus the button after click
                 button.blur();
            });
        } else {
            console.warn(`[Macro Setup] Macro button not found with ID: ${id}`);
        }
    });
}


// Waypoint controls
function setupWaypointControls() {
    const saveBtn = document.getElementById('save-waypoint');
    const gotoBtn = document.getElementById('goto-waypoint');
    const listBtn = document.getElementById('list-waypoints');

    if (saveBtn && waypointNameInput) {
        saveBtn.addEventListener('click', () => {
            const waypointName = waypointNameInput.value.trim();
            if (waypointName) {
                socket.emit('sendChat', `lưu điểm ${waypointName}`);
                waypointNameInput.value = ''; // Clear input after sending
            } else {
                // Optionally provide feedback if name is empty
                waypointNameInput.focus();
                alert("Vui lòng nhập tên điểm cần lưu.");
            }
        });
    } else {
         console.warn("Save waypoint button or input not found.");
    }


    if (gotoBtn && waypointNameInput) {
        gotoBtn.addEventListener('click', () => {
            const waypointName = waypointNameInput.value.trim();
            if (waypointName) {
                socket.emit('sendChat', `đi đến ${waypointName}`);
                waypointNameInput.value = ''; // Clear input after sending
            } else {
                 // Optionally provide feedback if name is empty
                 waypointNameInput.focus();
                 alert("Vui lòng nhập tên điểm cần đi đến.");
            }
        });
    } else {
         console.warn("Goto waypoint button or input not found.");
    }


    if (listBtn) {
        listBtn.addEventListener('click', () => {
            socket.emit('sendChat', 'danh sách điểm');
        });
    } else {
         console.warn("List waypoints button not found.");
    }

    // Allow Enter key in waypoint input to trigger 'goto' action
     if (waypointNameInput) {
         waypointNameInput.addEventListener('keypress', (e) => {
             if (e.key === 'Enter') {
                 e.preventDefault(); // Prevent form submission if it's in a form
                 const waypointName = waypointNameInput.value.trim();
                 if (waypointName) {
                     socket.emit('sendChat', `đi đến ${waypointName}`);
                     waypointNameInput.value = '';
                 } else {
                    // Trigger list if name is empty on Enter? Or just focus?
                    socket.emit('sendChat', 'danh sách điểm');
                 }
             }
         });
     }
}

// Socket.IO Event Handlers
function setupSocketListeners() {
    socket.on('connect', () => {
        console.log('[Socket] Connected to web server.');
        if (statusDiv) statusDiv.textContent = 'Đã kết nối server web';
        if (connectionStatus) connectionStatus.className = 'status-connected';
    });

    socket.on('disconnect', (reason) => {
        console.warn(`[Socket] Disconnected from web server: ${reason}`);
        if (statusDiv) statusDiv.textContent = 'Mất kết nối server web';
        if (connectionStatus) connectionStatus.className = 'status-disconnected';
        if (viewerStatus) {
            viewerStatus.innerHTML = '<i class="fas fa-times-circle"></i> Mất kết nối viewer';
            viewerStatus.classList.remove('hidden', 'viewer-loading');
            viewerStatus.classList.add('viewer-error');
        }
         if (viewerIframe) viewerIframe.classList.remove('loaded');
         // Optionally clear status fields
         if (healthSpan) healthSpan.textContent = 'N/A';
         if (foodSpan) foodSpan.textContent = 'N/A';
         if (positionSpan) positionSpan.textContent = 'N/A';
         if (inventoryDisplay) inventoryDisplay.innerHTML = '<div style="text-align:center; grid-column: 1 / -1;">Mất kết nối</div>';
    });

    socket.on('connect_error', (error) => {
        console.error(`[Socket] Connection Error: ${error.message}`);
        if (statusDiv) statusDiv.textContent = 'Lỗi kết nối server web';
        if (connectionStatus) connectionStatus.className = 'status-disconnected';
        // Add more robust error handling/display if needed
    });


    socket.on('bot_info', (data) => {
        if (data?.username) {
            window.botUsername = data.username; // Store bot username globally
            console.log(`[Socket] Received bot username: ${window.botUsername}`);
             // Maybe update a title or header somewhere?
             // document.title = `Dashboard - ${window.botUsername}`;
        }
    });

    // Handle viewer port information (replaces 'viewer_ready')
    socket.on('viewer_port', (port) => {
         if (typeof port === 'number' && port > 0) {
            console.log(`[Socket] Received viewer port: ${port}. Initializing viewer.`);
            initViewer(port);
         } else {
             console.error(`[Socket] Received invalid viewer port: ${port}`);
              if (viewerStatus) {
                 viewerStatus.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Nhận được cổng viewer không hợp lệ.';
                 viewerStatus.classList.remove('hidden', 'viewer-loading');
                 viewerStatus.classList.add('viewer-error');
             }
             if (viewerIframe) viewerIframe.classList.remove('loaded');
         }
    });

    // Handle specific viewer errors from the server
    socket.on('viewer_error', (message) => {
        console.error(`[Socket] Received viewer error: ${message}`);
         if (viewerStatus) {
             const safeMessage = escapeHtml(message);
             viewerStatus.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Lỗi Viewer: ${safeMessage}`;
             viewerStatus.classList.remove('hidden', 'viewer-loading');
             viewerStatus.classList.add('viewer-error');
         }
         if (viewerIframe) viewerIframe.classList.remove('loaded');
    });

    socket.on('chat', (data) => {
        if (data && data.message) {
             addMessage('chat', data.username, data.message);
        } else {
            console.warn("[Socket] Received invalid chat data:", data);
        }
    });

    socket.on('system_message', (data) => {
         if (data && data.message) {
             addMessage('system', null, data.message);
         } else {
             console.warn("[Socket] Received invalid system message data:", data);
         }
    });

    socket.on('health', (data) => {
        if (healthSpan) {
            healthSpan.textContent = (data?.health !== undefined && data.health !== null) ? data.health.toFixed(1) : 'N/A';
        }
         if (foodSpan) {
             foodSpan.textContent = (data?.food !== undefined && data.food !== null) ? data.food.toString() : 'N/A';
         }
    });

    socket.on('bot_position', (data) => {
         if (positionSpan) {
            if (data && typeof data.x === 'number' && typeof data.y === 'number' && typeof data.z === 'number') {
                positionSpan.textContent = `X:${data.x.toFixed(1)} Y:${data.y.toFixed(1)} Z:${data.z.toFixed(1)}`;
            } else {
                positionSpan.textContent = 'N/A';
            }
         }
    });

    socket.on('bot_status', (message) => {
        console.log(`[Socket] Bot Status Update: ${message}`);
        const safeMessage = escapeHtml(message);
         if (statusDiv) {
             statusDiv.textContent = safeMessage;
         }
         if (connectionStatus) {
            const lowerMessage = message.toLowerCase();
             if (lowerMessage.includes('lỗi') || lowerMessage.includes('chết') || lowerMessage.includes('kick') || lowerMessage.includes('ngắt kết nối')) {
                 connectionStatus.className = 'status-disconnected';
             } else if (lowerMessage.includes('đang kết nối') || lowerMessage.includes('vào server')) {
                 connectionStatus.className = 'status-waiting';
             } else if (lowerMessage.includes('đã vào server') || lowerMessage.includes('đang hoạt động') || lowerMessage.includes('sẵn sàng')) {
                 connectionStatus.className = 'status-connected';
             }
             // Add more conditions based on common status messages if needed
         }
         // Maybe add as a system message too?
         // addMessage('system', null, `Trạng thái Bot: ${message}`);
    });

    socket.on('bot_error', (message) => {
        console.error(`[Socket] Bot Error: ${message}`);
        const safeMessage = escapeHtml(message);
         if (statusDiv) {
             statusDiv.textContent = `Lỗi Bot: ${safeMessage}`;
         }
         if (connectionStatus) {
             connectionStatus.className = 'status-disconnected';
         }
        addMessage('error', null, `Lỗi Bot: ${safeMessage}`); // Show error in chat log
    });

    socket.on('inventory_update', (inventory) => {
        // console.log("[Socket] Received inventory update:", inventory); // Debug log
        updateInventory(inventory);
    });
}

// Chat Form Handler
function setupChatForm() {
    if (!chatInputForm || !messageInput) {
        console.error("Chat form or input element not found!");
        return;
    }
    chatInputForm.addEventListener('submit', (e) => {
        e.preventDefault(); // Prevent page reload
        const message = messageInput.value.trim();
        if (message) {
            console.log(`[Chat] Sending: ${message}`);
            socket.emit('sendChat', message);
            // Don't add user message immediately, wait for server echo via 'chat' event
            // This prevents duplicate messages if server broadcasts back
            // addMessage('chat', 'Bạn', message); // Optional: uncomment if you PREFER local echo immediately
            messageInput.value = ''; // Clear input field
        }
         messageInput.focus(); // Keep focus on input after sending
    });
}

// Initialize all controls and listeners
function initialize() {
    console.log("[Init] Initializing dashboard...");

    // Initial states
    if(statusDiv) statusDiv.textContent = 'Đang kết nối server web...';
    if(connectionStatus) connectionStatus.className = 'status-disconnected'; // Start as disconnected
    if(viewerStatus) {
        viewerStatus.innerHTML = '<i class="fas fa-hourglass-start"></i> Đang chờ cổng viewer...';
        viewerStatus.classList.remove('hidden', 'viewer-error');
        viewerStatus.classList.add('viewer-loading');
    }
    if (healthSpan) healthSpan.textContent = 'N/A';
    if (foodSpan) foodSpan.textContent = 'N/A';
    if (positionSpan) positionSpan.textContent = 'N/A';
    if (inventoryDisplay) inventoryDisplay.innerHTML = '<div style="text-align:center; grid-column: 1 / -1;">Đang chờ dữ liệu...</div>';


    // Setup event listeners and controls
    setupSocketListeners(); // Setup socket listeners first
    setupMovementControls();
    setupMouseControls();
    setupActionControls();
    setupViewControls();
    setupMacroControls(); // Setup updated macros
    setupWaypointControls();
    setupChatForm();

    console.log("[Init] Dashboard initialization complete.");
}

// Start the application when the DOM is ready
document.addEventListener('DOMContentLoaded', initialize);