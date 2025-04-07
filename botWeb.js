// server_web.js (FINAL - FULL BOT LOGIC + WEB INTERFACE + VIEWER ENABLED - COMPLETE CODE)

// --- Requires Section ---
require("dotenv").config();
const mineflayer = require("mineflayer");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const mcData = require("minecraft-data");
const collectBlock = require("mineflayer-collectblock");
const { Vec3 } = require("vec3");
const http = require('http');
const express = require('express');
const { Server } = require("socket.io");
const path = require('path');
const { mineflayer: viewer } = require('prismarine-viewer'); // VIEWER IS ENABLED

// --- Import ALL Command and Auto Modules ---
const autoLoot = require("./auto_loot");
const cleanInventoryCommands = require("./commands/clean_inventory");
const followCommands = require("./commands/follow");
const coordsCommands = require("./commands/coords");
const chatCommands = require("./commands/chat");
const findCommands = require("./commands/find");
const inventoryCommands = require("./commands/inventory");
const protectCommands = require("./commands/protect");
const collectCommands = require("./commands/collect");
const navigateCommands = require("./commands/navigate");
const scanCommands = require("./commands/scan");
const farmCommands = require("./commands/farm");
const craftCommands = require("./commands/craft");
const infoCommands = require("./commands/info");
const sleepCommands = require("./commands/sleep");
const stripMineCommands = require("./commands/strip_mine");
const huntCommands = require("./commands/hunt");
const depositCommands = require("./commands/deposit");
const equipCommands = require("./commands/equip_item");
const eventNotifierCommands = require("./event_notifier");
const autoEatCommands = require("./auto_eat");
const { flattenArea, stopFlatten } = require("./commands/flatten_area");
const homeCommands = require("./commands/home");
// const homeBuilder = require("./commands/home.js"); // Assuming homeCommands is sufficient
const autoTorch = require("./commands/auto_torch");
const autoDefend = require("./commands/auto_defend");
const farmWheatCommands = require("./commands/farm_wheat");
const translateIdentifyCommands = require("./commands/translate_identify");
const { roundCoord, formatCoords, sleep, translateToEnglishId } = require("./utils");

// --- Configuration ---
const SERVER_ADDRESS = process.env.SERVER_ADDRESS || "dhhnedhhne.aternos.me";
const SERVER_PORT = parseInt(process.env.SERVER_PORT || "21691", 10);
const BOT_USERNAME = process.env.BOT_USERNAME || "TuiBucBoi_WebFinal"; // Use a distinct name
const MINECRAFT_VERSION = process.env.MINECRAFT_VERSION || "1.21.4";
const WEB_SERVER_PORT = process.env.WEB_PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) { console.error("LỖI: Không tìm thấy GEMINI_API_KEY!"); process.exit(1); }
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const aiModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

console.log(`[Final Bot] Bot sẽ kết nối tới ${SERVER_ADDRESS}:${SERVER_PORT} version ${MINECRAFT_VERSION}`);
console.log(`[Final Bot] Giao diện web sẽ chạy tại http://localhost:${WEB_SERVER_PORT}`);

// --- Web Server Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'node_modules', 'prismarine-viewer', 'public'))); // Serve viewer files

// --- Bot Initialization ---
const bot = mineflayer.createBot({
    host: SERVER_ADDRESS,
    port: SERVER_PORT,
    username: BOT_USERNAME,
    version: MINECRAFT_VERSION,
    hideErrors: false,
    checkTimeoutInterval: 60 * 1000,
});

// --- Load Plugins ---
bot.loadPlugin(pathfinder);
bot.loadPlugin(collectBlock.plugin);
try {
    bot.loadPlugin(viewer); // Load viewer
    console.log("[Final Bot] Loaded viewer plugin.");
} catch(e) {
    console.error("[Final Bot] ERROR loading viewer plugin:", e);
}

console.log("[Final Bot] Đã tạo bot instance. Bắt đầu quá trình kết nối...");

// --- Initialize Bot State Variables ---
bot.botInGameName = BOT_USERNAME;
bot.defaultMove = null;
bot.followingTarget = null; bot.isFollowing = false;
bot.isFinding = false; bot.findingTaskDetails = null;
bot.isProtecting = false; bot.protectingTarget = null; bot.protectionInterval = null;
bot.isCollecting = false; bot.collectingTaskDetails = null;
bot.isStripMining = false; bot.stripMineTaskDetails = null;
bot.isHunting = false; bot.huntTaskDetails = null;
bot.isCleaningInventory = false; bot.cleaningTaskDetails = null;
bot.isDepositing = false; bot.depositTaskDetails = null;
bot.isSleeping = false;
bot.isFlattening = false; bot.flattenStopRequested = false; bot.flattenTemporaryChests = [];
bot.isBuilding = false; bot.buildingTaskDetails = null;
bot.waypoints = {};
bot.autoEatInterval = null;
bot.autoTorchInterval = null;
bot.stuckDetectionInterval = null;
bot.badZones = {};
bot.isDefending = false;
bot.isFarmingWheat = false; bot.farmingTaskDetails = null;
bot.isLooting = false;
bot.positionUpdateInterval = null;
bot.chatHistory = [];
const MAX_CHAT_HISTORY = 10;

// --- stopAllTasks Function ---
function stopAllTasks(botInstanceRef, usernameOrReason) {
    let stoppedSomething = false;
    const reasonText = typeof usernameOrReason === "string" ? usernameOrReason : "Unknown Reason";
    console.log(`[Stop All - Final Bot] Received stop request. Reason: ${reasonText}`);
    io.emit('bot_status', `Dừng nhiệm vụ: ${reasonText}`);

    if (!botInstanceRef) {
        console.error("[Stop All - Final Bot] Invalid bot instance!");
        return;
    }
    try { botInstanceRef.clearControlStates(); console.log("[Stop All Final] Cleared control states."); } catch (e) { console.error("[Stop All Final] Error clearing states:", e.message); }
    try { if (botInstanceRef.pathfinder?.isMoving()) { botInstanceRef.pathfinder.stop(); console.log("[Stop All Final] Stopped pathfinder."); } } catch (e) { console.error("[Stop All Final] Error stopping pathfinder:", e.message); }
    try { botInstanceRef.stopDigging(); } catch (e) { /* Ignore */ }
    try { botInstanceRef.stopUsingItem(); } catch (e) { /* Ignore */ }

    let autoDefendHandled = false;
    if (botInstanceRef.isDefending && reasonText !== "Bị tấn công") {
        if (autoDefend?.stopDefending) { autoDefend.stopDefending(reasonText); stoppedSomething = true; }
        else { console.warn("[Stop All Final] autoDefend.stopDefending not found!"); botInstanceRef.isDefending = false; stoppedSomething = true; }
        autoDefendHandled = true;
    } else if (botInstanceRef.isDefending && reasonText === "Bị tấn công") {
         console.log("[Stop All Final] Auto-defend active, not stopping it.");
         autoDefendHandled = true;
    }

    if (botInstanceRef.isLooting && autoLoot?.stopAutoLoot) {
        console.log("[Stop All Final] Stopping auto-loot task...");
        autoLoot.stopAutoLoot(reasonText);
    } else if (botInstanceRef.isLooting) {
        console.warn("[Stop All Final] autoLoot.stopAutoLoot not found!");
        botInstanceRef.isLooting = false;
    }

    if (botInstanceRef.isFlattening) { console.log("[Stop All Final] Stopping flatten task..."); stopFlatten(botInstanceRef, reasonText); stoppedSomething = true; }
    if (botInstanceRef.isFinding) { console.log("[Stop All Final] Stopping find task..."); findCommands.stopFinding(botInstanceRef, reasonText); stoppedSomething = true; }
    if (botInstanceRef.isFollowing) { console.log("[Stop All Final] Stopping follow task..."); followCommands.stopFollowing(botInstanceRef, reasonText); stoppedSomething = true; }
    if (botInstanceRef.isProtecting) { console.log("[Stop All Final] Stopping protect task..."); protectCommands.stopProtecting(botInstanceRef, reasonText); stoppedSomething = true; }
    if (botInstanceRef.isCollecting) { console.log("[Stop All Final] Stopping collect task..."); collectCommands.stopCollecting(botInstanceRef, reasonText); stoppedSomething = true; }
    if (botInstanceRef.isCleaningInventory) { console.log("[Stop All Final] Stopping clean inventory task..."); cleanInventoryCommands.stopCleaningInventory(botInstanceRef, reasonText); stoppedSomething = true; }
    if (botInstanceRef.isStripMining) { console.log("[Stop All Final] Stopping strip mine task..."); stripMineCommands.stopStripMining(botInstanceRef, reasonText); stoppedSomething = true; }
    if (botInstanceRef.isHunting) { console.log("[Stop All Final] Stopping hunt task..."); huntCommands.stopHunting(botInstanceRef, reasonText); stoppedSomething = true; }
    if (botInstanceRef.isDepositing) { console.log("[Stop All Final] Stopping deposit task..."); depositCommands.stopDepositTask(botInstanceRef, reasonText); stoppedSomething = true; }
    if (botInstanceRef.isFarmingWheat) {
        console.log("[Stop All Final] Stopping farm wheat task...");
        if (farmWheatCommands?.stopFarmingWheat) { farmWheatCommands.stopFarmingWheat(reasonText); stoppedSomething = true; }
        else { console.warn("farmWheatCommands.stopFarmingWheat not found!"); botInstanceRef.isFarmingWheat = false; stoppedSomething = true; }
    }
    if (botInstanceRef.isBuilding) { console.log("[Stop All Final] Stopping building task..."); botInstanceRef.isBuilding = false; botInstanceRef.buildingTaskDetails = null; stoppedSomething = true; }
    if (botInstanceRef.isSleeping) { console.log("[Stop All Final] Waking up bot..."); try { botInstanceRef.wake(); stoppedSomething = true; } catch (e) { console.error("[Stop All Final] Error waking up:", e.message); botInstanceRef.isSleeping = false; stoppedSomething = true; } }

    const silentReasons = ["Hệ thống", "Lỗi hệ thống", "Bot chết", "Bị kick", "Mất kết nối", "Bị kẹt", "Bị tấn công", "Hoàn thành", "Hoàn thành thu hoạch", "Hoàn thành xây ruộng", "Thất bại", "Vòng lặp kết thúc bất thường"];
    const userInitiatedStop = typeof usernameOrReason === "string" && !silentReasons.includes(reasonText) && !reasonText.startsWith("Lỗi");
    if (botInstanceRef.entity) {
        if (stoppedSomething && userInitiatedStop) {
            console.log(`[Stop All Final] Tasks stopped by user: ${usernameOrReason}.`);
            try { botInstanceRef.chat(`Ok ${usernameOrReason}, đã dừng.`); } catch (e) { console.error("[Stop All Final] Error sending chat:", e); }
        } else if (!stoppedSomething && userInitiatedStop && !botInstanceRef.isDefending) {
            console.log(`[Stop All Final] No task to stop for user: ${usernameOrReason}.`);
            try { botInstanceRef.chat(`Tôi không đang làm gì, ${usernameOrReason}.`); } catch (e) { console.error("[Stop All Final] Error sending chat:", e); }
        } else if (!stoppedSomething && userInitiatedStop && botInstanceRef.isDefending && !autoDefendHandled) {
             console.log(`[Stop All Final] Not stopping active defense for user: ${usernameOrReason}.`);
             try { botInstanceRef.chat(`Tôi đang phòng thủ, không dừng được, ${usernameOrReason}.`); } catch (e) { console.error("[Stop All Final] Error sending chat:", e); }
        } else if (stoppedSomething && !userInitiatedStop) {
            console.log(`[Stop All Final] Tasks stopped by system/event: ${reasonText}.`);
        }
    } else {
        console.log("[Stop All Final] Bot not in game, cannot chat.");
    }
    console.log("[Stop All - Final Bot] Finished processing stop request.");
}

// --- 'spawn' Event Handler ---
bot.once("spawn", () => {
    bot.botInGameName = bot.username;
    console.log(`[Final Bot Spawn] *** Bot (${bot.botInGameName}) đã vào server! ***`);
    io.emit('bot_status', 'Đã vào server');
    const startPos = bot.entity.position;
    // Gửi vị trí ban đầu ngay lập tức (sử dụng roundCoord)
    console.log(`[Final Bot Spawn] Initial Position: ${formatCoords(startPos)}`);
    io.emit('bot_position', { x: roundCoord(startPos.x), y: roundCoord(startPos.y), z: roundCoord(startPos.z) });

    // Full State Reset
    console.log("[Final Bot Spawn] Resetting full state...");
    bot.isFollowing = false; bot.followingTarget = null; bot.isFinding = false; bot.findingTaskDetails = null; bot.isProtecting = false; bot.protectingTarget = null; if (bot.protectionInterval) clearInterval(bot.protectionInterval); bot.protectionInterval = null; bot.isCollecting = false; bot.collectingTaskDetails = null; bot.isStripMining = false; bot.stripMineTaskDetails = null; bot.isCleaningInventory = false; bot.cleaningTaskDetails = null; bot.isHunting = false; bot.huntTaskDetails = null; bot.isDepositing = false; bot.depositTaskDetails = null; bot.isSleeping = false; bot.isBuilding = false; bot.buildingTaskDetails = null; bot.waypoints = bot.waypoints || {}; bot.isFlattening = false; bot.flattenStopRequested = false; bot.flattenTemporaryChests = []; if (bot.stuckDetectionInterval) clearInterval(bot.stuckDetectionInterval); bot.stuckDetectionInterval = null; if (bot.autoTorchInterval) clearInterval(bot.autoTorchInterval); bot.autoTorchInterval = null; bot.badZones = {}; bot.isDefending = false; bot.isFarmingWheat = false; bot.farmingTaskDetails = null; bot.isLooting = false;
    // Đảm bảo biến interval vị trí cũng được reset
    if (bot.positionUpdateInterval) {
        clearInterval(bot.positionUpdateInterval);
        bot.positionUpdateInterval = null;
    }

    // Initialize Movements
    console.log("[Final Bot Spawn] Initializing Movements...");
    try {
        const currentMcData = mcData(bot.version);
        if (!currentMcData) throw new Error("Cannot load mcData!");
        if (bot.pathfinder) bot.pathfinder.thinkTimeout = 10000;
        bot.defaultMove = new Movements(bot, currentMcData);
        bot.defaultMove.allowSprinting = true; bot.defaultMove.allowParkour = true; bot.defaultMove.canDig = true; bot.defaultMove.maxDropDown = 4; bot.defaultMove.allow1by1towers = true; bot.defaultMove.canPlace = true;
        if (!bot.defaultMove.blocksToPlace) bot.defaultMove.blocksToPlace = new Set(); const scaffoldBlocks = ["dirt", "cobblestone", "netherrack", "cobbled_deepslate", "stone", "oak_planks", "spruce_planks", "birch_planks"]; scaffoldBlocks.forEach(name => { const block = currentMcData.blocksByName[name]; if (block) bot.defaultMove.blocksToPlace.add(block.id); });
        if (!bot.defaultMove.blocksToAvoid) bot.defaultMove.blocksToAvoid = new Set(); const blocksToAvoidNames = ["lava", "fire", "cactus", "sweet_berry_bush", "powder_snow", "magma_block"]; blocksToAvoidNames.forEach(name => { const block = currentMcData.blocksByName[name]; if (block) bot.defaultMove.blocksToAvoid.add(block.id); });
        if (!bot.defaultMove.blocksCantBreak) bot.defaultMove.blocksCantBreak = new Set(); const blocksCantBreakNames = ["chest", "ender_chest", "furnace", "blast_furnace", "smoker", "crafting_table", "enchanting_table", "anvil", "beacon", "bed", "respawn_anchor"]; blocksCantBreakNames.forEach(name => { const block = currentMcData.blocksByName[name]; if (block) bot.defaultMove.blocksCantBreak.add(block.id); });
        if (bot.pathfinder) { bot.pathfinder.setMovements(bot.defaultMove); console.log("[Final Bot Spawn] Pathfinder Movements set."); }
        else { console.error("[Final Bot Spawn] Pathfinder not found!"); io.emit('bot_error', 'Lỗi: Pathfinder không khởi tạo!'); }
    } catch (err) { console.error("[Final Bot Spawn] Error initializing Movements:", err); io.emit('bot_error', `Lỗi Movements: ${err.message}`); }

    // Initialize ALL Auto Modules
    console.log("[Final Bot Spawn] Initializing Auto Modules...");
    try { const VALUABLE_ITEMS = ["diamond", "emerald", "netherite_ingot", "netherite_scrap", "ancient_debris", "nether_star", "enchanted_book", "totem_of_undying", "elytra", "shulker_shell"]; autoLoot.initializeAutoLoot(bot, VALUABLE_ITEMS); } catch (e) { console.error("[Final Bot Spawn] Error initializing AutoLoot:", e); }
    try { eventNotifierCommands.initializeEventNotifier(bot); } catch(e) { console.error("[Final Bot Spawn] Error initializing EventNotifier:", e); } // Modify to use io
    try { autoEatCommands.initializeAutoEat(bot); } catch(e) { console.error("[Final Bot Spawn] Error initializing AutoEat:", e); }
    try { autoTorch.initializeAutoTorch(bot, aiModel); } catch(e) { console.error("[Final Bot Spawn] Error initializing AutoTorch:", e); } // Modify to use io
    try { autoDefend.initializeAutoDefend(bot, stopAllTasks); } catch(e) { console.error("[Final Bot Spawn] Error initializing AutoDefend:", e); }
    try { farmWheatCommands.initialize(bot); } catch(e) { console.error("[Final Bot Spawn] Error initializing FarmWheat:", e); } // Modify to use io

    // Start Auto Torch Interval
    console.log("[Final Bot Spawn] Starting AutoTorch Interval...");
    if (bot.autoTorchInterval) clearInterval(bot.autoTorchInterval);
    const AUTO_TORCH_INTERVAL_MS = 2500;
    bot.autoTorchInterval = setInterval(async () => { if (bot?.entity && !bot.isSleeping && !bot.isDefending && !autoTorch.isPlacingTorch) { try { await autoTorch.checkAndPlaceTorch(); } catch (error) { console.error("[Auto Torch Interval Final] Lỗi:", error.message); } } }, AUTO_TORCH_INTERVAL_MS);
    console.log(`[Final Bot Spawn] AutoTorch Interval started.`);

    // --- START: Thêm đoạn code gửi vị trí định kỳ ---
    console.log("[Final Bot Spawn] Starting Position Update Interval...");
    // Xóa interval cũ nếu có (đã làm ở phần reset state, nhưng để đây cho chắc)
    if (bot.positionUpdateInterval) {
        clearInterval(bot.positionUpdateInterval);
        bot.positionUpdateInterval = null;
    }

    const POSITION_UPDATE_INTERVAL_MS = 1500; // Gửi vị trí mỗi 1.5 giây (có thể điều chỉnh)

    bot.positionUpdateInterval = setInterval(() => {
        // Chỉ gửi nếu bot vẫn còn trong game và có entity
        if (bot && bot.entity) {
            const pos = bot.entity.position;
            // Gửi tọa độ đã làm tròn cho gọn
            io.emit('bot_position', {
                x: roundCoord(pos.x), // Sử dụng hàm tiện ích đã có
                y: roundCoord(pos.y),
                z: roundCoord(pos.z)
            });
        } else {
            // Nếu bot không còn entity (ví dụ: bị ngắt kết nối), dừng interval này
            if (bot.positionUpdateInterval) {
                clearInterval(bot.positionUpdateInterval);
                bot.positionUpdateInterval = null;
                console.log("[Position Update] Bot entity not found, stopping interval.");
            }
        }
    }, POSITION_UPDATE_INTERVAL_MS);

    console.log(`[Final Bot Spawn] Position update interval started (${POSITION_UPDATE_INTERVAL_MS}ms).`);
    // --- END: Thêm đoạn code gửi vị trí định kỳ ---

    // Send welcome message
    console.log("[Final Bot Spawn] Setting welcome message timeout...");
    setTimeout(() => { try { bot.chat(`Bot AI (${bot.botInGameName}) đã kết nối! Hỏi gì đi nào? :D (Gõ 'bạn làm được gì?')`); } catch (e) { console.error("Error sending initial chat message:", e); } }, 1500);

    // Pathfinder event listeners
    console.log("[Final Bot Spawn] Adding Pathfinder Listeners...");
    const pathfinderEvents = ["goal_reached", "path_reset", "cannotFindPath", "interrupted", "goal_non_reachable"];
    pathfinderEvents.forEach(eventName => {
        bot.on(eventName, (...args) => {
            const reason = args[0]?.message || args[0] || eventName;
            const isPathError = eventName === 'cannotFindPath' || eventName === 'goal_non_reachable' || eventName === 'interrupted';
            console.log(`[Pathfinder Event Final] Event: ${eventName}, Reason: ${reason}`);
            if (isPathError) {
                io.emit('bot_error', `Lỗi di chuyển: ${reason}`);
                // --- Full path error handling ---
                if (bot.isFinding && findCommands.handleFindPathError) findCommands.handleFindPathError(bot, reason);
                else if (bot.isCleaningInventory && cleanInventoryCommands.finishCleaningInventory) cleanInventoryCommands.finishCleaningInventory(bot, false, `Path error: ${reason}`);
                else if (bot.isDepositing && depositCommands.stopDepositTask) depositCommands.stopDepositTask(bot, `Path error: ${reason}`);
                else if (bot.isCollecting && bot.collectingTaskDetails) { bot.collectingTaskDetails.currentTarget = null; bot.collectingTaskDetails.status = 'idle'; console.warn(`[Collect Path Error Final] ${reason}. Finding new target.`); }
                else if (bot.isStripMining && stripMineCommands.stopStripMining) stripMineCommands.stopStripMining(bot, `Path error: ${reason}`);
                else if (bot.isHunting && huntCommands.stopHunting) huntCommands.stopHunting(bot, `Path error: ${reason}`);
                else if (bot.isBuilding && homeCommands.handleBuildPathError) homeCommands.handleBuildPathError(bot, reason);
                else if (bot.isFlattening) { console.warn(`[Flatten Path Error Final] ${reason}. Stopping.`); stopFlatten(bot, `Path error: ${reason}`); }
                else if (bot.isFarmingWheat && bot.pathfinder?.isMoving()) { if (farmWheatCommands?.stopFarmingWheat) { farmWheatCommands.stopFarmingWheat(`Lỗi di chuyển: ${reason}`, true); } }
                else if (bot.pathfinder?.isMoving() && !bot.isDefending) { console.warn(`[Pathfinder Error Final] Lỗi khi di chuyển tự do: ${reason}. Dừng.`); stopAllTasks(bot, `Lỗi di chuyển: ${reason}`); }
                else if (bot.isDefending && isPathError) { console.warn(`[Pathfinder Error Final] Lỗi di chuyển khi phòng thủ: ${reason}. (Auto Defend xử lý)`); }
            }
             if (bot.isFinding && eventName === 'goal_reached' && findCommands.handleFindGoalReached) { findCommands.handleFindGoalReached(bot); }
        });
    });
    console.log("[Final Bot Spawn] Pathfinder Listeners Added.");

    // Gửi trạng thái máu/thức ăn ban đầu
    io.emit('health', { health: bot.health, food: bot.food });
    console.log("[Final Bot Spawn] Spawn handler complete.");
});

// --- 'chat' Event Handler ---
bot.on("chat", async (username, message) => {
    io.emit('chat', { username, message });
    if (username === bot.username || !message) return;

    // Full basic chat logic
    console.log("[Final Bot Chat] Processing basic chat logic...");
    try { const timestamp = new Date().toLocaleTimeString(); const historyEntry = `[${timestamp}] <${username}> ${message}`; bot.chatHistory.push(historyEntry); if (bot.chatHistory.length > MAX_CHAT_HISTORY) { bot.chatHistory.shift(); } } catch (histError) { console.error("Error adding to chat history:", histError); }
    const trimmedMessage = message.trim(); const lowerMessage = trimmedMessage.toLowerCase();
    console.log(`[Chat In Final Bot] <${username}> ${trimmedMessage}`); if (!trimmedMessage) return;
    const isBusy = bot.isFinding || bot.isFollowing || bot.isProtecting || bot.isDefending || bot.isCollecting || bot.isSleeping || bot.isStripMining || bot.isHunting || bot.isCleaningInventory || bot.isDepositing || bot.isBuilding || bot.isFlattening || bot.isFarmingWheat; const stopKeywords = ["dừng", "stop", "hủy", "cancel", "thôi", "dừng lại", "dậy đi", "ngừng"];
    if ((isBusy || bot.pathfinder?.isMoving()) && stopKeywords.some(k => lowerMessage.includes(k))) { console.log(`[Manual Stop Final Bot] User ${username} requested stop.`); stopAllTasks(bot, username); return; }
    const refuseKeywords = ["không", "ko", "no", "đéo", "deo", "k", "kg", "hong", "đếch"]; const farmDetails = bot.farmingTaskDetails;
    if (bot.isFarmingWheat && farmDetails?.stage === 'begging' && farmDetails?.beggingTarget === username && refuseKeywords.some(k => lowerMessage.includes(k))) { console.log(`[Farm Wheat Refusal Final Bot] User ${username} refused.`); if (farmWheatCommands?.handleBeggingRefusal) { farmWheatCommands.handleBeggingRefusal(username); } else { stopAllTasks(bot, "Người dùng từ chối xin đồ"); } return; }
    if (bot.isFinding && bot.findingTaskDetails?.waitingForConfirmation && username === bot.findingTaskDetails.username) { const confirmKeywords = ["tiếp", "ok", "oke", "có", "yes", "uh", "ừ", "di", "đi", "continue", "proceed", "tìm tiếp"]; const cancelKeywords = ["dừng", "thôi", "hủy", "stop", "cancel", "ko", "không", "no", "khong", "đủ rồi"]; let confirmed = confirmKeywords.some(k => lowerMessage.includes(k)); let cancelled = !confirmed && cancelKeywords.some(k => lowerMessage.includes(k)); if (confirmed) { findCommands.proceedToNextTarget(bot); } else if (cancelled) { stopAllTasks(bot, username); } else { try { bot.chat(`${username}, nói 'tiếp' hoặc 'dừng'.`); } catch (e) {} } return; }
    console.log("[Final Bot Chat] Basic chat logic passed.");

    // Full AI Classification and Command Execution
    console.log("[Final Bot Chat] Starting AI Classification...");
    try {
        const baseClassificationPrompt = `**Nhiệm vụ:** Phân loại ý định chính của người dùng dựa trên tin nhắn cuối cùng và lịch sử trò chuyện (nếu có).\n\n**Danh sách các loại ý định có thể:**\n*   GET_BOT_COORDS: Hỏi tọa độ hiện tại của bot.\n*   GET_ENTITY_COORDS: Hỏi tọa độ của người chơi hoặc mob khác.\n*   FOLLOW_PLAYER: Yêu cầu bot đi theo người chơi đã nói.\n*   FIND_BLOCK: Tìm kiếm một loại block hoặc mob cụ thể.\n*   CHECK_INVENTORY: Xem các vật phẩm trong túi đồ của bot.\n*   GIVE_ITEM: Yêu cầu bot đưa một vật phẩm cho người chơi.\n*   PROTECT_PLAYER: Bảo vệ người chơi đã nói khỏi quái vật.\n*   COLLECT_BLOCK: Thu thập một số lượng block nhất định.\n*   GOTO_COORDS: Đi đến một tọa độ XYZ cụ thể.\n*   SCAN_ORES: Quét các loại quặng hoặc block đặc biệt xung quanh bot.\n*   SAVE_WAYPOINT: Lưu vị trí hiện tại hoặc tọa độ đã cho với một cái tên.\n*   GOTO_WAYPOINT: Đi đến một điểm đã lưu trước đó.\n*   FLATTEN_AREA: Làm phẳng một khu vực theo bán kính cho trước.\n*   LIST_WAYPOINTS: Liệt kê tất cả các điểm đã lưu.\n*   DELETE_WAYPOINT: Xóa một điểm đã lưu.\n*   BREED_ANIMALS: Cho các con vật (ví dụ: bò, cừu) ăn để chúng giao phối.\n*   CRAFT_ITEM: Chế tạo vật phẩm bằng bàn chế tạo (lò nung cần bàn chế tạo) hoặc trong túi đồ.\n*   SMELT_ITEM: Nung/nấu vật phẩm trong lò (furnace, smoker, blast furnace). **Quan trọng:** Phân loại là SMELT_ITEM cho các vật phẩm cần dùng lò nung trong minecraft \n*   GO_TO_SLEEP: Yêu cầu bot đi ngủ nếu trời tối.\n*   STRIP_MINE: Đào một đường hầm dài để tìm tài nguyên.\n*   HUNT_MOB: Săn một loại mob cụ thể để lấy vật phẩm.\n*   BUILD_HOUSE: Xây một ngôi nhà cơ bản.\n*   CLEAN_INVENTORY: Vứt bỏ các vật phẩm không cần thiết (đá cuội, đất...).\n*   DEPOSIT_ITEMS: Cất đồ vào các rương gần đó.\n*   EQUIP_ITEM: Trang bị vũ khí, công cụ hoặc áo giáp tốt nhất.\n*   FARM_WHEAT: Thu hoạch lúa mì và trồng lại hạt giống trong một khu vực.\n*   IDENTIFY_ITEM: Nhận dạng block/mob/item mà người chơi hỏi nhưng không rõ tên.\n*   LIST_CAPABILITIES: Hỏi bot có thể làm được những gì.\n*   STOP_TASK: Yêu cầu bot dừng ngay lập tức hành động đang làm.\n*   GENERAL_CHAT: Các câu nói, câu hỏi thông thường, không thuộc các loại trên.\n*   IGNORE: Tin nhắn không liên quan, spam, hoặc không cần bot phản hồi.`;
        const recentHistory = bot.chatHistory.slice(-5); const formattedHistory = recentHistory.length > 0 ? `\n\nLịch sử:\n${recentHistory.join('\n')}` : ''; const classificationPromptWithHistory = `${baseClassificationPrompt}${formattedHistory}\n\nTin nhắn mới:\n<${username}> ${trimmedMessage}\n\nLoại ý định:`;
        console.log(`[AI Intent Final Bot] Prompting...`); const intentResult = await aiModel.generateContent(classificationPromptWithHistory); const intentClassification = (await intentResult.response.text()).trim().toUpperCase().replace(/[^A-Z_]/g, ""); console.log(`[AI Intent Final Bot] Classified: "${intentClassification}"`);
        const nonBlockingIntents = ["GET_BOT_COORDS", "GET_ENTITY_COORDS", "CHECK_INVENTORY", "SCAN_ORES", "LIST_WAYPOINTS", "LIST_CAPABILITIES", "GENERAL_CHAT", "IGNORE", "STOP_TASK", "IDENTIFY_ITEM"];
        if (isBusy && !nonBlockingIntents.includes(intentClassification)) { let reason = bot.isFinding ? "tìm đồ" : bot.isFollowing ? "đi theo" : bot.isProtecting ? "bảo vệ" : bot.isDefending ? "phòng thủ" : bot.isCollecting ? "thu thập" : bot.isSleeping ? "ngủ" : bot.isStripMining ? "đào hầm" : bot.isHunting ? "săn bắn" : bot.isCleaningInventory ? "dọn túi đồ" : bot.isDepositing ? "cất đồ" : bot.isBuilding ? "xây nhà" : bot.isFlattening ? "làm phẳng" : bot.isFarmingWheat ? "làm ruộng" : "làm việc khác"; try { bot.chat(`${username}, đang bận ${reason}!`); } catch (e) {} console.log(`[Action Blocked Final] Intent ${intentClassification} blocked.`); return; }

        // --- Execute Command ---
        // !!! MODIFY COMMAND FUNCTIONS TO ACCEPT 'io' !!!
        console.log(`[Final Bot Chat] Executing: ${intentClassification}`);
        switch (intentClassification) {
            case "GET_BOT_COORDS": coordsCommands.getBotCoords(bot, username, io); break;
            case "GET_ENTITY_COORDS": await coordsCommands.getEntityCoords(bot, username, trimmedMessage, aiModel, io); break;
            case "BUILD_HOUSE": bot.isBuilding = true; try { await homeCommands.startSurvivalHouseBuild(bot, username, io); } catch (e) { console.error("Build error:", e); bot.chat(`Lỗi xây nhà: ${e.message}`); bot.isBuilding = false; io.emit('bot_error', `Lỗi xây nhà: ${e.message}`); } break;
            case "FOLLOW_PLAYER": followCommands.startFollowing(bot, username, io); break;
            case "FLATTEN_AREA": await flattenArea(bot, username, trimmedMessage, aiModel, io); break;
            case "FIND_BLOCK": await findCommands.startFindingTask(bot, username, trimmedMessage, aiModel, io); break;
            case "CHECK_INVENTORY": inventoryCommands.checkInventory(bot, username, io); break;
            case "GIVE_ITEM": await inventoryCommands.giveItem(bot, username, trimmedMessage, aiModel, io); break;
            case "PROTECT_PLAYER": await protectCommands.startProtecting(bot, username, io); break;
            case "COLLECT_BLOCK": await collectCommands.startCollectingTask(bot, username, message, aiModel, io); break;
            case "GOTO_COORDS": await navigateCommands.goToCoordinates(bot, username, trimmedMessage, aiModel, io); break;
            case "SCAN_ORES": await scanCommands.scanNearbyOres(bot, username, io); break;
            case "SAVE_WAYPOINT": await navigateCommands.saveWaypoint(bot, username, trimmedMessage, aiModel, io); break;
            case "GOTO_WAYPOINT": await navigateCommands.goToWaypoint(bot, username, trimmedMessage, aiModel, io); break;
            case "LIST_WAYPOINTS": navigateCommands.listWaypoints(bot, username, io); break;
            case "DELETE_WAYPOINT": await navigateCommands.deleteWaypoint(bot, username, trimmedMessage, aiModel, io); break;
            case "BREED_ANIMALS": await farmCommands.breedAnimals(bot, username, trimmedMessage, aiModel, io); break;
            case "CRAFT_ITEM": const potentialCraftItemNameVi = trimmedMessage.replace(/chế tạo|làm|craft|make|\d+/gi, '').trim(); const potentialCraftItemId = translateToEnglishId(potentialCraftItemNameVi); if (potentialCraftItemId && ['cooked_chicken', 'iron_ingot', 'glass', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_salmon', 'cooked_cod', 'dried_kelp', 'smooth_stone', 'charcoal', 'brick', 'nether_brick'].includes(potentialCraftItemId)) { console.warn(`[Intent Override Final]...`); if (craftCommands.smeltItem) { await craftCommands.smeltItem(bot, username, trimmedMessage, aiModel, io); } else { console.error("Lỗi: Hàm smeltItem..."); bot.chat("..."); } } else { await craftCommands.craftItem(bot, username, trimmedMessage, aiModel, io); } break;
            case "SMELT_ITEM": if (craftCommands.smeltItem) { await craftCommands.smeltItem(bot, username, trimmedMessage, aiModel, io); } else { console.error("Lỗi: Hàm smeltItem..."); bot.chat("..."); } break;
            case "GO_TO_SLEEP": await sleepCommands.goToSleep(bot, username, io); break;
            case "STRIP_MINE": await stripMineCommands.startStripMiningTask(bot, username, trimmedMessage, aiModel, io); break;
            case "HUNT_MOB": await huntCommands.startHuntingTask(bot, username, trimmedMessage, aiModel, io); break;
            case "CLEAN_INVENTORY": await cleanInventoryCommands.startCleaningInventory(bot, username, io); break;
            case "DEPOSIT_ITEMS": await depositCommands.startDepositTask(bot, username, trimmedMessage, aiModel, io); break;
            case "EQUIP_ITEM": await equipCommands.startEquipItemTask(bot, username, trimmedMessage, aiModel, io); break;
            case "IDENTIFY_ITEM": await translateIdentifyCommands.handleIdentifyRequest(bot, username, trimmedMessage, aiModel, io); break;
            case "FARM_WHEAT": const radiusMatch = trimmedMessage.match(/(\d+)\s*(khối|block|ô|radius|bk)/i); const farmRadius = radiusMatch ? parseInt(radiusMatch[1], 10) : 50; if (farmWheatCommands?.startFarmingWheat) { await farmWheatCommands.startFarmingWheat(username, farmRadius, io); } else { console.error("[Farm Wheat Final] Lỗi: Không tìm thấy hàm..."); bot.chat("..."); } break;
            case "LIST_CAPABILITIES": infoCommands.listCapabilities(bot, username, io); break;
            case "STOP_TASK": console.log(`[Action Final] Intent STOP_TASK recognized for ${username}.`); stopAllTasks(bot, username); break;
            case "GENERAL_CHAT": await chatCommands.handleGeneralChat(bot, username, trimmedMessage, aiModel, io); break;
            case "IGNORE": console.log(`[Action Final] Ignoring message from ${username}.`); break;
            default: console.warn(`[Action Final] Unknown intent: "${intentClassification}". Fallback.`); await chatCommands.handleGeneralChat(bot, username, trimmedMessage, aiModel, io); break;
        }
        console.log(`[Final Bot Chat] Finished execution for: ${intentClassification}`);
    } catch (error) { console.error("[AI/Chat Processing Final] Error:", error); io.emit('bot_error', `Lỗi AI/Chat: ${error.message}`); stopAllTasks(bot, "Lỗi hệ thống"); try { bot.chat(`Lỗi AI: ${error.message}`); } catch (e) {} }
});

// --- Other Bot Event Handlers ---
bot.on("sleep", () => { console.log("[Final Event] Bot sleeping."); bot.isSleeping = true; io.emit('bot_status', 'Đang ngủ Zzzz'); try { bot.chat("Zzzz"); } catch (e) {} });
bot.on("wake", () => { console.log("[Final Event] Bot woke up."); bot.isSleeping = false; io.emit('bot_status', 'Đã thức dậy'); });
bot.on("death", () => { console.error("[Final Event] !!! BOT DIED !!!"); io.emit('bot_status', '!!! ĐÃ CHẾT !!!'); try { bot.chat(":( Tôi chết rồi!"); } catch (e) {} stopAllTasks(bot, "Bot chết"); });
bot.on("health", () => { io.emit('health', { health: bot.health, food: bot.food }); });
bot.on("messagestr", (message, messagePosition, jsonMsg) => { if (messagePosition === 'system' || messagePosition === 'game_info') { console.log(`[System Msg Final] ${message}`); io.emit('system_message', { message }); } if (messagePosition !== 'chat') { try { const ts = new Date().toLocaleTimeString(); const entry = `[${ts}] [Sys] ${message}`; bot.chatHistory.push(entry); if (bot.chatHistory.length > MAX_CHAT_HISTORY) bot.chatHistory.shift(); } catch (e) {} } });
bot.on("kicked", (reason) => { console.error("[Final Event] Kicked!"); try { console.error("Reason:", JSON.parse(reason)); } catch { console.error("Reason:", reason); } io.emit('bot_status', `Bị kick: ${reason}`); stopAllTasks(bot, "Bị kick"); });
bot.on("error", (err) => { console.error("[Final Event] Bot Error:", err); io.emit('bot_error', `Lỗi bot: ${err.message || err}`); });
bot.on("end", (reason) => { console.log("[Final Event] Disconnected. Reason:", reason); io.emit('bot_status', `Đã ngắt kết nối: ${reason}`); if (autoLoot?.stopAutoLoot) autoLoot.stopAutoLoot("Bot connection ended"); if (bot.autoEatInterval) clearInterval(bot.autoEatInterval); bot.autoEatInterval = null; if (bot.protectionInterval) clearInterval(bot.protectionInterval); bot.protectionInterval = null; if (bot.stuckDetectionInterval) clearInterval(bot.stuckDetectionInterval); bot.stuckDetectionInterval = null; if (bot.autoTorchInterval) clearInterval(bot.autoTorchInterval); bot.autoTorchInterval = null; console.log("[Final Event] Cleaned timers."); });

// --- Socket.IO Connection Handler ---
io.on('connection', (socket) => {
    console.log('[Final Bot] Web client connected.');
    socket.emit('bot_status', bot.entity ? 'Đang hoạt động' : 'Đang kết nối...');
    if (bot.entity) { socket.emit('health', { health: bot.health, food: bot.food }); }
    socket.on('sendChat', (message) => { if (bot?.chat) { bot.chat(message); } });
    socket.on('disconnect', () => { console.log('[Final Bot] Web client disconnected.'); });

    // Send viewer port
    const sendViewerPort = () => {
        if (bot.viewer) {
            const viewerPort = bot.viewer.port;
            if (viewerPort) {
                console.log(`[Final Bot] Viewer websocket running on port: ${viewerPort}`);
                socket.emit('viewer_port', viewerPort);
            } else {
                 console.error("[Final Bot] Viewer port is undefined, waiting...");
                 setTimeout(sendViewerPort, 1000);
            }
        } else {
            console.error("[Final Bot] bot.viewer does not exist!");
            socket.emit('viewer_error', 'Viewer not loaded on server.');
        }
    };
    if (bot.viewer?.port) { sendViewerPort(); }
    else {
        const checkAndSend = () => { if(bot.viewer?.port) { sendViewerPort(); } else { console.warn("inject_allowed fired, but viewer port still not available."); socket.emit('viewer_error', 'Viewer init failed.'); } }
        if (bot.viewer) { bot.once('inject_allowed', checkAndSend); }
        else { console.warn("[Final Bot] Viewer plugin not loaded, cannot send port."); socket.emit('viewer_error', 'Viewer plugin not loaded.'); }
    }
});

// --- Start Web Server ---
server.listen(WEB_SERVER_PORT, () => {
    console.log(`[Final Bot] Web server listening on port ${WEB_SERVER_PORT}`);
    console.log(`[Final Bot] Access: http://localhost:${WEB_SERVER_PORT}`);
});

// --- Graceful Shutdown (SIGINT Handler) ---
process.on("SIGINT", () => {
    console.log("\n[Final Bot] Shutting down...");
    if (bot.stuckDetectionInterval) clearInterval(bot.stuckDetectionInterval); bot.stuckDetectionInterval = null; if (bot.autoEatInterval) clearInterval(bot.autoEatInterval); bot.autoEatInterval = null; if (bot.protectionInterval) clearInterval(bot.protectionInterval); bot.protectionInterval = null; if (bot.autoTorchInterval) clearInterval(bot.autoTorchInterval); bot.autoTorchInterval = null; console.log("[SIGINT Final] Cleared interval timers.");
    stopAllTasks(bot, "Tắt server");
    const quitMessage = `Bot AI (${bot.botInGameName || BOT_USERNAME}) offline.`; try { if (bot.player) bot.chat(quitMessage); } catch (e) {}
    io.close();
    server.close(() => {
        console.log("[Final Bot] Web server closed.");
        setTimeout(() => {
            try { if (bot?.quit) bot.quit(); } catch (e) {}
            console.log("[Final Bot] Exiting.");
            process.exit(0);
        }, 500);
    });
    setTimeout(() => { console.error("Force exiting..."); process.exit(1); }, 5000);
});

console.log("[Final Bot] Server script initialization complete. Waiting for connections...");