// event_notifier.js
const { formatCoords } = require("./utils");

const NOTIFY_RADIUS = 32; // Bán kính thông báo mob nguy hiểm

let botInstance = null; // Lưu trữ instance của bot

function handlePlayerJoined(player) {
    if (!botInstance || player.username === botInstance.username) return;
    console.log(`[Event Notify] Người chơi ${player.username} đã vào server.`);
    try {
        botInstance.chat(`> ${player.username} vừa vào server!`);
    } catch (e) { console.error("[Event Notify] Lỗi chat khi player join:", e); }
}

function handlePlayerLeft(player) {
     if (!botInstance || player.username === botInstance.username) return;
    console.log(`[Event Notify] Người chơi ${player.username} đã rời server.`);
     try {
        botInstance.chat(`> ${player.username} đã rời server.`);
    } catch (e) { console.error("[Event Notify] Lỗi chat khi player left:", e); }
}

function handleEntitySpawn(entity) {
    if (!botInstance || entity.type !== 'mob') return;

    const distance = botInstance.entity.position.distanceTo(entity.position);
    let isDangerous = false;
    let message = null;

    // Các mob nguy hiểm cần cảnh báo
    if (entity.name === 'creeper' && distance <= NOTIFY_RADIUS) {
        isDangerous = true;
        message = `> Cẩn thận! Có Creeper gần ${formatCoords(entity.position)}!`;
    } else if (entity.name === 'warden' && distance <= NOTIFY_RADIUS * 2) { // Warden nguy hiểm hơn, tăng bán kính
         isDangerous = true;
         message = `> !!! WARDEN KÌA !!! Ở chỗ ${formatCoords(entity.position)}! Chạy đi!`;
    }
    // Thêm các mob khác nếu muốn (vd: vindicator, evoker, piglin brute...)

    if (isDangerous && message) {
        console.log(`[Event Notify] Phát hiện mob nguy hiểm: ${entity.name} tại ${formatCoords(entity.position)}`);
         try {
            botInstance.chat(message);
        } catch (e) { console.error("[Event Notify] Lỗi chat khi entity spawn:", e); }
    }
}

/**
 * Khởi tạo các listener sự kiện cho bot.
 * Gọi hàm này một lần sau khi bot spawn.
 * @param {import('mineflayer').Bot} bot
 */
function initializeEventNotifier(bot) {
    if (botInstance) {
        // Gỡ listener cũ nếu có (tránh gắn nhiều lần khi bot respawn/relog)
        botInstance.removeListener('playerJoined', handlePlayerJoined);
        botInstance.removeListener('playerLeft', handlePlayerLeft);
        botInstance.removeListener('entitySpawn', handleEntitySpawn);
        console.log("[Event Notify] Đã gỡ listener cũ.");
    }

    botInstance = bot;
    bot.on('playerJoined', handlePlayerJoined);
    bot.on('playerLeft', handlePlayerLeft);
    bot.on('entitySpawn', handleEntitySpawn); // Có thể tốn tài nguyên nếu server đông entity
    console.log("[Event Notify] Đã khởi tạo và gắn listener sự kiện.");
}

module.exports = {
    initializeEventNotifier,
};