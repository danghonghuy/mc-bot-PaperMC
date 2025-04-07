require("dotenv").config();
const mineflayer = require("mineflayer");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const mcData = require("minecraft-data");
const collectBlock = require("mineflayer-collectblock");
const { Vec3 } = require("vec3");

// Import các module lệnh
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
const craftCommands = require("./commands/craft"); // Đảm bảo export craftItem & smeltItem
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
const homeBuilder = require("./commands/home.js");
const autoTorch = require("./commands/auto_torch");
const autoDefend = require("./commands/auto_defend");
const farmWheatCommands = require("./commands/farm_wheat");
const translateIdentifyCommands = require("./commands/translate_identify");
// ***** ĐẢM BẢO IMPORT HÀM DỊCH ĐÚNG TỪ UTILS *****
const { roundCoord, formatCoords, sleep, translateToEnglishId } = require("./utils");
// ****************************************************

// --- Cấu hình ---
const SERVER_ADDRESS = "dhhnedhhne.aternos.me";
const SERVER_PORT = 21691;
const BOT_USERNAME = "TuiBucBoi";
const MINECRAFT_VERSION = "1.21.4"; // Cập nhật nếu cần

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("LỖI: Không tìm thấy GEMINI_API_KEY trong file .env!");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const aiModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // Sử dụng model Flash cho tốc độ

console.log(`Đang kết nối tới ${SERVER_ADDRESS}:${SERVER_PORT}...`);
console.log(`Tên bot: ${BOT_USERNAME}, Phiên bản: ${MINECRAFT_VERSION}`);

// --- Khởi tạo Bot ---
const bot = mineflayer.createBot({
  host: SERVER_ADDRESS,
  port: SERVER_PORT,
  username: BOT_USERNAME,
  version: MINECRAFT_VERSION,
  hideErrors: true,
  checkTimeoutInterval: 60 * 1000,
  // auth: 'microsoft' // Bỏ comment nếu dùng tài khoản Microsoft
});

bot.loadPlugin(pathfinder);
bot.loadPlugin(collectBlock.plugin);
console.log("Đã tạo bot. Bắt đầu kết nối...");

// --- Khởi tạo Trạng thái Bot ---
bot.botInGameName = BOT_USERNAME;
bot.defaultMove = null;
bot.followingTarget = null;
bot.isFollowing = false;
bot.isFinding = false;
bot.findingTaskDetails = null;
bot.isProtecting = false;
bot.protectingTarget = null;
bot.protectionInterval = null;
bot.isCollecting = false;
bot.collectingTaskDetails = null;
bot.isStripMining = false;
bot.stripMineTaskDetails = null;
bot.isHunting = false;
bot.huntTaskDetails = null;
bot.isCleaningInventory = false;
bot.cleaningTaskDetails = null;
bot.isDepositing = false;
bot.depositTaskDetails = null;
bot.isSleeping = false;
bot.isFlattening = false;
bot.flattenStopRequested = false;
bot.flattenTemporaryChests = [];
bot.isBuilding = false;
bot.buildingTaskDetails = null;
bot.waypoints = {};
bot.autoEatInterval = null;
bot.autoTorchInterval = null;
bot.stuckDetectionInterval = null;
bot.badZones = {};
bot.isDefending = false;
bot.isFarmingWheat = false;
bot.farmingTaskDetails = null;
bot.isLooting = false;
bot.chatHistory = [];
const MAX_CHAT_HISTORY = 10;

// --- Hàm Dừng Tất Cả Nhiệm Vụ (Tối ưu) ---
function stopAllTasks(botInstanceRef, usernameOrReason) {
  let stoppedSomething = false;
  const reasonText =
    typeof usernameOrReason === "string" ? usernameOrReason : "Unknown Reason";
  console.log(
    `[Stop All - Optimized] Received stop request. Reason: ${reasonText}`
  );

  if (!botInstanceRef) {
    console.error(
      "[Stop All - Optimized] Bot instance reference is invalid! Cannot stop tasks."
    );
    return;
  }

  try {
    botInstanceRef.clearControlStates();
    console.log("[Stop All - Optimized] Cleared control states.");
  } catch (e) {
    console.error(
      "[Stop All - Optimized] Error clearing control states:",
      e.message
    );
  }
  try {
    if (botInstanceRef.pathfinder?.isMoving()) {
      botInstanceRef.pathfinder.stop();
      console.log("[Stop All - Optimized] Explicitly stopped pathfinder.");
    }
  } catch (e) {
    console.error(
      "[Stop All - Optimized] Error stopping pathfinder:",
      e.message
    );
  }
  try {
    botInstanceRef.stopDigging();
  } catch (e) { /* Ignore */ }
  try {
    botInstanceRef.stopUsingItem();
  } catch (e) { /* Ignore */ }

  let autoDefendHandled = false;
  if (botInstanceRef.isDefending) {
    if (reasonText !== "Bị tấn công") {
      if (autoDefend && typeof autoDefend.stopDefending === "function") {
        console.log("[Stop All - Optimized] Stopping auto-defend task...");
        autoDefend.stopDefending(reasonText);
        stoppedSomething = true;
      } else {
        console.warn(
          "[Stop All - Optimized] autoDefend module/function not found! Manually resetting flag."
        );
        botInstanceRef.isDefending = false;
        stoppedSomething = true;
      }
      autoDefendHandled = true;
    } else {
      console.log(
        "[Stop All - Optimized] Auto-defend active due to 'Bị tấn công', not stopping it."
      );
      autoDefendHandled = true;
    }
  }
  if (botInstanceRef.isLooting) {
    console.log("[Stop All - Optimized] Stopping auto-loot task...");
    if (autoLoot && typeof autoLoot.stopAutoLoot === "function") {
        autoLoot.stopAutoLoot(reasonText); // Truyền lý do dừng
        // Không cần đặt stoppedSomething = true vì autoLoot không phải là task chính do người dùng yêu cầu
    } else {
         console.warn("[Stop All - Optimized] autoLoot module/function not found! Manually resetting flag.");
         botInstanceRef.isLooting = false;
    }
     // Không cần đặt stoppedSomething = true ở đây, vì loot là nền
}
  if (botInstanceRef.isFlattening) {
    console.log("[Stop All - Optimized] Stopping flatten task logic...");
    stopFlatten(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef.isFinding) {
    console.log("[Stop All - Optimized] Stopping find task logic...");
    findCommands.stopFinding(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef.isFollowing) {
    console.log("[Stop All - Optimized] Stopping follow task logic...");
    followCommands.stopFollowing(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef.isProtecting) {
    console.log("[Stop All - Optimized] Stopping protect task logic...");
    protectCommands.stopProtecting(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef.isCollecting) {
    console.log("[Stop All - Optimized] Stopping collect task logic...");
    collectCommands.stopCollecting(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef.isCleaningInventory) {
    console.log(
      "[Stop All - Optimized] Stopping clean inventory task logic..."
    );
    cleanInventoryCommands.stopCleaningInventory(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef.isStripMining) {
    console.log("[Stop All - Optimized] Stopping strip mine task logic...");
    stripMineCommands.stopStripMining(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef.isHunting) {
    console.log("[Stop All - Optimized] Stopping hunt task logic...");
    huntCommands.stopHunting(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef.isDepositing) {
    console.log("[Stop All - Optimized] Stopping deposit task logic...");
    depositCommands.stopDepositTask(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef.isFarmingWheat) {
    if (farmWheatCommands?.stopFarmingWheat) {
      farmWheatCommands.stopFarmingWheat(reasonText);
      stoppedSomething = true;
    } else {
      console.warn("farmWheatCommands.stopFarmingWheat not found!");
      botInstanceRef.isFarmingWheat = false;
      stoppedSomething = true;
    }
  }
  if (botInstanceRef.isBuilding) {
    console.log(
      "[Stop All - Optimized] Stopping building task logic (setting flag)."
    );
    botInstanceRef.isBuilding = false;
    botInstanceRef.buildingTaskDetails = null;
    stoppedSomething = true;
  }

  if (botInstanceRef.isSleeping) {
    console.log("[Stop All - Optimized] Waking up bot...");
    try {
      botInstanceRef.wake();
      stoppedSomething = true;
    } catch (e) {
      console.error("[Stop All - Optimized] Error waking up bot:", e.message);
      botInstanceRef.isSleeping = false;
      stoppedSomething = true;
    }
  }

  const silentReasons = [
    "Hệ thống", "Lỗi hệ thống", "Bot chết", "Bị kick", "Mất kết nối",
    "Bị kẹt", "Bị tấn công", "Hoàn thành", "Hoàn thành thu hoạch",
    "Hoàn thành xây ruộng", "Thất bại", "Vòng lặp kết thúc bất thường",
  ];
  const userInitiatedStop = typeof usernameOrReason === "string" &&
    !silentReasons.includes(usernameOrReason) &&
    !usernameOrReason.startsWith("Lỗi");

  if (botInstanceRef.entity) {
    if (stoppedSomething && userInitiatedStop) {
      console.log(
        `[Stop All - Optimized] Tasks stopped due to user: ${usernameOrReason}.`
      );
      try {
        botInstanceRef.chat(`Ok ${usernameOrReason}, đã dừng việc đang làm.`);
      } catch (e) { console.error("[Stop All - Optimized] Error sending 'stopped task' chat:", e); }
    } else if (!stoppedSomething && userInitiatedStop && !botInstanceRef.isDefending) {
      console.log(`[Stop All - Optimized] No active task found to stop for user: ${usernameOrReason} (and not defending).`);
      try {
        botInstanceRef.chat(`Tôi không đang làm gì hết á, ${usernameOrReason}.`);
      } catch (e) { console.error("[Stop All - Optimized] Error sending 'not doing anything' chat:", e); }
    } else if (!stoppedSomething && userInitiatedStop && botInstanceRef.isDefending && !autoDefendHandled) {
      console.log(`[Stop All - Optimized] No other task stopped, auto-defend active but not handled for user: ${usernameOrReason}.`);
      try {
        botInstanceRef.chat(`Tôi không đang làm gì khác ngoài phòng thủ để dừng, ${usernameOrReason}.`);
      } catch (e) { console.error("[Stop All - Optimized] Error sending 'not doing anything else' chat:", e); }
    } else if (stoppedSomething && !userInitiatedStop) {
      console.log(`[Stop All - Optimized] Tasks stopped due to system/event: ${reasonText}. (No chat message sent for this reason)`);
    }
  } else {
    console.log("[Stop All - Optimized] Bot entity does not exist. Cannot send chat message.");
  }

  console.log("[Stop All - Optimized] Finished processing stop request.");
}

// --- Sự kiện Bot Spawn ---
bot.once("spawn", () => {
  bot.botInGameName = bot.username;
  console.log(`*** Bot (${bot.botInGameName}) đã vào server! ***`);
  const startPos = bot.entity.position;
  console.log(`Vị trí: ${formatCoords(startPos)}`);

  // Reset trạng thái (Thêm các trạng thái khác nếu cần)
  bot.isFollowing = false; bot.followingTarget = null;
  bot.isFinding = false; bot.findingTaskDetails = null;
  bot.isProtecting = false; bot.protectingTarget = null;
  if (bot.protectionInterval) clearInterval(bot.protectionInterval); bot.protectionInterval = null;
  bot.isCollecting = false; bot.collectingTaskDetails = null;
  bot.isStripMining = false; bot.stripMineTaskDetails = null;
  bot.isCleaningInventory = false; bot.cleaningTaskDetails = null;
  bot.isHunting = false; bot.huntTaskDetails = null;
  bot.isDepositing = false; bot.depositTaskDetails = null;
  bot.isSleeping = false;
  bot.isBuilding = false; bot.buildingTaskDetails = null;
  bot.waypoints = bot.waypoints || {};
  bot.isFlattening = false; bot.flattenStopRequested = false; bot.flattenTemporaryChests = [];
  if (bot.stuckDetectionInterval) clearInterval(bot.stuckDetectionInterval); bot.stuckDetectionInterval = null;
  if (bot.autoTorchInterval) clearInterval(bot.autoTorchInterval); bot.autoTorchInterval = null;
  bot.badZones = {};
  bot.isDefending = false;
  bot.isFarmingWheat = false; bot.farmingTaskDetails = null;
  bot.isLooting = false;
  try {
    const currentMcData = mcData(bot.version);
    if (!currentMcData) throw new Error("Không thể tải mcData!");
    if(bot.pathfinder) bot.pathfinder.thinkTimeout = 10000;

    bot.defaultMove = new Movements(bot, currentMcData);
    bot.defaultMove.allowSprinting = true;
    bot.defaultMove.allowParkour = true;
    bot.defaultMove.canDig = true;
    bot.defaultMove.maxDropDown = 4;
    bot.defaultMove.allow1by1towers = true;
    bot.defaultMove.canPlace = true;

    if (!bot.defaultMove.blocksToPlace) bot.defaultMove.blocksToPlace = new Set();
    const scaffoldBlocks = ["dirt", "cobblestone", "netherrack", "cobbled_deepslate", "stone", "oak_planks", "spruce_planks", "birch_planks"];
    scaffoldBlocks.forEach(name => {
      const block = currentMcData.blocksByName[name];
      if (block) bot.defaultMove.blocksToPlace.add(block.id);
    });

    if (!bot.defaultMove.blocksToAvoid) bot.defaultMove.blocksToAvoid = new Set();
    const blocksToAvoidNames = ["lava", "fire", "cactus", "sweet_berry_bush", "powder_snow", "magma_block"];
    blocksToAvoidNames.forEach(name => {
      const block = currentMcData.blocksByName[name];
      if (block) bot.defaultMove.blocksToAvoid.add(block.id);
    });

    if (!bot.defaultMove.blocksCantBreak) bot.defaultMove.blocksCantBreak = new Set();
    const blocksCantBreakNames = ["chest", "ender_chest", "furnace", "blast_furnace", "smoker", "crafting_table", "enchanting_table", "anvil", "beacon", "bed", "respawn_anchor"];
    blocksCantBreakNames.forEach(name => {
      const block = currentMcData.blocksByName[name];
      if (block) bot.defaultMove.blocksCantBreak.add(block.id);
    });

    if (bot.pathfinder) {
      bot.pathfinder.setMovements(bot.defaultMove);
      console.log("[Pathfinder] Đã khởi tạo và thiết lập Movements.");
    } else {
      console.error("[Lỗi Khởi tạo Pathfinder] bot.pathfinder không tồn tại!");
    }
  } catch (err) {
    console.error("[Lỗi Khởi tạo Pathfinder/Movements]:", err);
  }
  try {
    const VALUABLE_ITEMS = [ // Danh sách tên item hiếm (tiếng Anh, lấy từ minecraft-data)
        "diamond",
        "emerald",
        "netherite_ingot",
        "netherite_scrap",
        "ancient_debris",
        "nether_star",
        "enchanted_book", // Sách enchant nói chung
        "totem_of_undying",
        "elytra",
        "shulker_shell",
        // Thêm các item khác bạn cho là hiếm vào đây
        // Ví dụ: "dragon_egg", "music_disc_11", "golden_apple" (enchanted)
    ];
    autoLoot.initializeAutoLoot(bot, VALUABLE_ITEMS);
} catch (lootInitError) {
    console.error("[Spawn] Lỗi khởi tạo AutoLoot:", lootInitError);
}

 

  eventNotifierCommands.initializeEventNotifier(bot);
  autoEatCommands.initializeAutoEat(bot);
  autoTorch.initializeAutoTorch(bot, aiModel);
  autoDefend.initializeAutoDefend(bot, stopAllTasks);
  farmWheatCommands.initialize(bot);

  if (bot.autoTorchInterval) clearInterval(bot.autoTorchInterval);
  const AUTO_TORCH_INTERVAL_MS = 2500;
  bot.autoTorchInterval = setInterval(async () => {
    if (bot?.entity && !bot.isSleeping && !bot.isDefending && !autoTorch.isPlacingTorch) {
      try { await autoTorch.checkAndPlaceTorch(); }
      catch (error) { console.error("[Auto Torch Interval] Lỗi:", error.message); }
    }
  }, AUTO_TORCH_INTERVAL_MS);
  console.log(`[System] Đã kích hoạt tự động kiểm tra và đặt đuốc.`);

  setTimeout(() => {
    try { bot.chat(`Bot AI (${bot.botInGameName}) đã kết nối! Hỏi gì đi nào? :D (Gõ 'bạn làm được gì?')`); }
    catch (e) { console.error("Error sending initial chat message:", e); }
  }, 1500);

  const pathfinderEvents = ["goal_reached", "path_reset", "cannotFindPath", "interrupted", "goal_non_reachable"];
  pathfinderEvents.forEach(eventName => {
    bot.on(eventName, (...args) => {
      const reason = args[0]?.message || args[0] || eventName;
      const isPathError = eventName === 'cannotFindPath' || eventName === 'goal_non_reachable' || eventName === 'interrupted';

      if (isPathError) {
        console.error(`[Pathfinder Error Detected] Reason: ${reason}`);
        if (bot.isFinding && findCommands.handleFindPathError) findCommands.handleFindPathError(bot, reason);
        else if (bot.isCleaningInventory && cleanInventoryCommands.finishCleaningInventory) cleanInventoryCommands.finishCleaningInventory(bot, false, `Path error: ${reason}`);
        else if (bot.isDepositing && depositCommands.stopDepositTask) depositCommands.stopDepositTask(bot, `Path error: ${reason}`);
        else if (bot.isCollecting && bot.collectingTaskDetails) { bot.collectingTaskDetails.currentTarget = null; bot.collectingTaskDetails.status = 'idle'; console.warn(`[Collect Path Error] ${reason}. Finding new target.`); }
        else if (bot.isStripMining && stripMineCommands.stopStripMining) stripMineCommands.stopStripMining(bot, `Path error: ${reason}`);
        else if (bot.isHunting && huntCommands.stopHunting) huntCommands.stopHunting(bot, `Path error: ${reason}`);
        else if (bot.isBuilding && homeCommands.handleBuildPathError) homeCommands.handleBuildPathError(bot, reason);
        else if (bot.isFlattening) { console.warn(`[Flatten Path Error] ${reason}. Stopping.`); stopFlatten(bot, `Path error: ${reason}`); }
        else if (bot.isFarmingWheat && bot.pathfinder?.isMoving()) {
            console.warn(`[Farm Wheat Pathfinder Error] ${reason}. Stopping farm task.`);
            if (farmWheatCommands && typeof farmWheatCommands.stopFarmingWheat === 'function') {
                farmWheatCommands.stopFarmingWheat(`Lỗi di chuyển: ${reason}`, true);
            }
        }
        else if (bot.pathfinder?.isMoving() && !bot.isDefending) { console.warn(`[Pathfinder Error] Lỗi khi di chuyển tự do: ${reason}. Dừng.`); stopAllTasks(bot, `Lỗi di chuyển: ${reason}`); }
        else if (bot.isDefending && isPathError) { console.warn(`[Pathfinder Error] Lỗi di chuyển khi phòng thủ: ${reason}. (Auto Defend xử lý)`); }
      }

      if (bot.isFinding && eventName === 'goal_reached' && findCommands.handleFindGoalReached) {
        findCommands.handleFindGoalReached(bot);
      }
    });
  });

  bot.on("sleep", () => { console.log("[Event] Bot đã ngủ."); bot.isSleeping = true; try { bot.chat("Khò khò... Zzzz"); } catch (e) {} });
  bot.on("wake", () => { console.log("[Event] Bot đã thức dậy."); bot.isSleeping = false; });
  bot.on("death", () => { console.error("!!! BOT ĐÃ CHẾT !!!"); try { bot.chat("Ối! Tôi chết mất rồi... :("); } catch (e) {} stopAllTasks(bot, "Bot chết"); });
  bot.on("health", () => { /* Log máu/đói */ });
});

// --- Xử lý Tin nhắn Chat ---
bot.on("chat", async (username, message) => {
  if (username === bot.username || !message) return;
  try {
    const timestamp = new Date().toLocaleTimeString();
    const historyEntry = `[${timestamp}] <${username}> ${message}`;
    bot.chatHistory.push(historyEntry);
    if (bot.chatHistory.length > MAX_CHAT_HISTORY) { bot.chatHistory.shift(); }
  } catch (histError) { console.error("Error adding to chat history:", histError); }

  const trimmedMessage = message.trim();
  const lowerMessage = trimmedMessage.toLowerCase();
  console.log(`[Chat In] <${username}> ${trimmedMessage}`);
  if (!trimmedMessage) return;

  const isBusy = bot.isFinding || bot.isFollowing || bot.isProtecting || bot.isDefending || bot.isCollecting || bot.isSleeping || bot.isStripMining || bot.isHunting || bot.isCleaningInventory || bot.isDepositing || bot.isBuilding || bot.isFlattening || bot.isFarmingWheat;  const stopKeywords = ["dừng", "stop", "hủy", "cancel", "thôi", "dừng lại", "dậy đi", "ngừng"];
  if ((isBusy || bot.pathfinder?.isMoving()) && stopKeywords.some(k => lowerMessage.includes(k))) {
    console.log(`[Manual Stop] User ${username} requested stop/wake.`);
    stopAllTasks(bot, username);
    return;
  }

  const refuseKeywords = ["không", "ko", "no", "đéo", "deo", "k", "kg", "hong", "đếch"];
  const farmDetails = bot.farmingTaskDetails;
  if (bot.isFarmingWheat && farmDetails?.stage === 'begging' && farmDetails?.beggingTarget === username && refuseKeywords.some(k => lowerMessage.includes(k))) {
    console.log(`[Farm Wheat Refusal] User ${username} refused begging request.`);
    if (farmWheatCommands && typeof farmWheatCommands.handleBeggingRefusal === 'function') {
      farmWheatCommands.handleBeggingRefusal(username);
    } else {
      console.warn("Cannot call handleBeggingRefusal - function not found. Stopping farm manually.");
      stopAllTasks(bot, "Người dùng từ chối xin đồ");
    }
    return;
  }

  if (bot.isFinding && bot.findingTaskDetails?.waitingForConfirmation && username === bot.findingTaskDetails.username) {
    const confirmKeywords = ["tiếp", "ok", "oke", "có", "yes", "uh", "ừ", "di", "đi", "continue", "proceed", "tìm tiếp"];
    const cancelKeywords = ["dừng", "thôi", "hủy", "stop", "cancel", "ko", "không", "no", "khong", "đủ rồi"];
    let confirmed = confirmKeywords.some(k => lowerMessage.includes(k));
    let cancelled = !confirmed && cancelKeywords.some(k => lowerMessage.includes(k));
    if (confirmed) { findCommands.proceedToNextTarget(bot); }
    else if (cancelled) { stopAllTasks(bot, username); }
    else { try { bot.chat(`${username}, nói 'tiếp' hoặc 'dừng' nhé.`); } catch (e) { console.error("Error sending find confirm chat:", e); } }
    return;
  }

  try {
    // Prompt phân loại đã được cập nhật ở lần trước, giữ nguyên
    const baseClassificationPrompt = `**Nhiệm vụ:** Phân loại ý định chính của người dùng dựa trên tin nhắn cuối cùng và lịch sử trò chuyện (nếu có).\n\n**Danh sách các loại ý định có thể:**\n*   GET_BOT_COORDS: Hỏi tọa độ hiện tại của bot.\n*   GET_ENTITY_COORDS: Hỏi tọa độ của người chơi hoặc mob khác.\n*   FOLLOW_PLAYER: Yêu cầu bot đi theo người chơi đã nói.\n*   FIND_BLOCK: Tìm kiếm một loại block hoặc mob cụ thể.\n*   CHECK_INVENTORY: Xem các vật phẩm trong túi đồ của bot.\n*   GIVE_ITEM: Yêu cầu bot đưa một vật phẩm cho người chơi.\n*   PROTECT_PLAYER: Bảo vệ người chơi đã nói khỏi quái vật.\n*   COLLECT_BLOCK: Thu thập một số lượng block nhất định.\n*   GOTO_COORDS: Đi đến một tọa độ XYZ cụ thể.\n*   SCAN_ORES: Quét các loại quặng hoặc block đặc biệt xung quanh bot.\n*   SAVE_WAYPOINT: Lưu vị trí hiện tại hoặc tọa độ đã cho với một cái tên.\n*   GOTO_WAYPOINT: Đi đến một điểm đã lưu trước đó.\n*   FLATTEN_AREA: Làm phẳng một khu vực theo bán kính cho trước.\n*   LIST_WAYPOINTS: Liệt kê tất cả các điểm đã lưu.\n*   DELETE_WAYPOINT: Xóa một điểm đã lưu.\n*   BREED_ANIMALS: Cho các con vật (ví dụ: bò, cừu) ăn để chúng giao phối.\n*   CRAFT_ITEM: Chế tạo vật phẩm bằng bàn chế tạo (lò nung cần bàn chế tạo) hoặc trong túi đồ.\n*   SMELT_ITEM: Nung/nấu vật phẩm trong lò (furnace, smoker, blast furnace). **Quan trọng:** Phân loại là SMELT_ITEM cho các vật phẩm cần dùng lò nung trong minecraft \n*   GO_TO_SLEEP: Yêu cầu bot đi ngủ nếu trời tối.\n*   STRIP_MINE: Đào một đường hầm dài để tìm tài nguyên.\n*   HUNT_MOB: Săn một loại mob cụ thể để lấy vật phẩm.\n*   BUILD_HOUSE: Xây một ngôi nhà cơ bản.\n*   CLEAN_INVENTORY: Vứt bỏ các vật phẩm không cần thiết (đá cuội, đất...).\n*   DEPOSIT_ITEMS: Cất đồ vào các rương gần đó.\n*   EQUIP_ITEM: Trang bị vũ khí, công cụ hoặc áo giáp tốt nhất.\n*   FARM_WHEAT: Thu hoạch lúa mì và trồng lại hạt giống trong một khu vực.\n*   IDENTIFY_ITEM: Nhận dạng block/mob/item mà người chơi hỏi nhưng không rõ tên.\n*   LIST_CAPABILITIES: Hỏi bot có thể làm được những gì.\n*   STOP_TASK: Yêu cầu bot dừng ngay lập tức hành động đang làm.\n*   GENERAL_CHAT: Các câu nói, câu hỏi thông thường, không thuộc các loại trên.\n*   IGNORE: Tin nhắn không liên quan, spam, hoặc không cần bot phản hồi.`;

    const recentHistory = bot.chatHistory.slice(-5);
    const formattedHistory = recentHistory.length > 0
        ? `\n\n**Lịch sử trò chuyện gần đây (ngữ cảnh):**\n${recentHistory.join('\n')}`
        : '';

    const classificationPromptWithHistory = `${baseClassificationPrompt}${formattedHistory}\n\n**Dựa vào lịch sử trên (nếu có) và tin nhắn mới nhất dưới đây, hãy phân loại ý định:**\n<${username}> ${trimmedMessage}\n\n**Loại ý định là:**`;

    console.log(`[AI Intent] Gửi prompt phân loại (có lịch sử)...`);
    const intentResult = await aiModel.generateContent(classificationPromptWithHistory);
    const intentClassification = (await intentResult.response.text()).trim().toUpperCase().replace(/[^A-Z_]/g, "");
    console.log(`[AI Intent] Phân loại: "${intentClassification}" (Msg: "${trimmedMessage}")`);

    const nonBlockingIntents = [
      "GET_BOT_COORDS", "GET_ENTITY_COORDS", "CHECK_INVENTORY", "SCAN_ORES",
      "LIST_WAYPOINTS", "LIST_CAPABILITIES", "GENERAL_CHAT", "IGNORE",
      "STOP_TASK", "IDENTIFY_ITEM",
    ];
    if (isBusy && !nonBlockingIntents.includes(intentClassification)) {
      let reason = bot.isFinding ? "tìm đồ" : bot.isFollowing ? "đi theo" : bot.isProtecting ? "bảo vệ" : bot.isDefending ? "phòng thủ" : bot.isCollecting ? "thu thập" : bot.isSleeping ? "ngủ" : bot.isStripMining ? "đào hầm" : bot.isHunting ? "săn bắn" : bot.isCleaningInventory ? "dọn túi đồ" : bot.isDepositing ? "cất đồ" : bot.isBuilding ? "xây nhà" : bot.isFlattening ? "làm phẳng" : bot.isFarmingWheat ? "làm ruộng" : "làm việc khác";
      try { bot.chat(`${username}, tôi đang bận ${reason} rồi! Nói 'dừng' nếu muốn tôi hủy.`); }
      catch (e) { console.error("Error sending busy chat:", e); }
      console.log(`[Action Blocked] Intent ${intentClassification} blocked (busy: ${reason}).`);
      return;
    }

    // --- Thực thi lệnh ---
    switch (intentClassification) {
      case "GET_BOT_COORDS": coordsCommands.getBotCoords(bot, username); break;
      case "GET_ENTITY_COORDS": await coordsCommands.getEntityCoords(bot, username, trimmedMessage, aiModel); break;
      case "BUILD_HOUSE":
        bot.isBuilding = true;
        try { await homeCommands.startSurvivalHouseBuild(bot, username); }
        catch (buildError) { console.error("Lỗi gọi hàm xây nhà:", buildError); bot.chat(`Lỗi khi bắt đầu xây nhà: ${buildError.message}`); bot.isBuilding = false; }
        break;
      case "FOLLOW_PLAYER": followCommands.startFollowing(bot, username); break;
      case "FLATTEN_AREA": await flattenArea(bot, username, trimmedMessage, aiModel); break;
      case "FIND_BLOCK": await findCommands.startFindingTask(bot, username, trimmedMessage, aiModel); break;
      case "CHECK_INVENTORY": inventoryCommands.checkInventory(bot, username); break;
      case "GIVE_ITEM": await inventoryCommands.giveItem(bot, username, trimmedMessage, aiModel); break;
      case "PROTECT_PLAYER": await protectCommands.startProtecting(bot, username); break;
      case "COLLECT_BLOCK": await collectCommands.startCollectingTask(bot, username, message, aiModel); break;
      case "GOTO_COORDS": await navigateCommands.goToCoordinates(bot, username, trimmedMessage, aiModel); break;
      case "SCAN_ORES": await scanCommands.scanNearbyOres(bot, username); break;
      case "SAVE_WAYPOINT": await navigateCommands.saveWaypoint(bot, username, trimmedMessage, aiModel); break;
      case "GOTO_WAYPOINT": await navigateCommands.goToWaypoint(bot, username, trimmedMessage, aiModel); break;
      case "LIST_WAYPOINTS": navigateCommands.listWaypoints(bot, username); break;
      case "DELETE_WAYPOINT": await navigateCommands.deleteWaypoint(bot, username, trimmedMessage, aiModel); break;
      case "BREED_ANIMALS": await farmCommands.breedAnimals(bot, username, trimmedMessage, aiModel); break;
      case "CRAFT_ITEM":
          // ***** SỬA LỖI TYPEERROR Ở ĐÂY *****
          const potentialCraftItemNameVi = trimmedMessage.replace(/chế tạo|làm|craft|make|\d+/gi, '').trim();
          // Dùng hàm dịch đúng từ utils.js (đã import ở đầu file)
          const potentialCraftItemId = translateToEnglishId(potentialCraftItemNameVi); // <<< ĐÃ SỬA
          // ***********************************

          if (potentialCraftItemId && ['cooked_chicken', 'iron_ingot', 'glass', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_salmon', 'cooked_cod', 'dried_kelp', 'smooth_stone', 'charcoal', 'brick', 'nether_brick'].includes(potentialCraftItemId)) {
              console.warn(`[Intent Override] AI classified as CRAFT_ITEM for '${potentialCraftItemId}' which should be smelted. Calling smeltItem instead.`);
              if (craftCommands.smeltItem) {
                  await craftCommands.smeltItem(bot, username, trimmedMessage, aiModel);
              } else {
                  console.error("Lỗi: Hàm smeltItem không được tìm thấy trong craftCommands.");
                  bot.chat("Xin lỗi, tôi chưa biết cách nung đồ.");
              }
          } else {
              await craftCommands.craftItem(bot, username, trimmedMessage, aiModel);
          }
          break;
      case "SMELT_ITEM":
        if (craftCommands.smeltItem) {
          await craftCommands.smeltItem(bot, username, trimmedMessage, aiModel);
        } else {
          console.error("Lỗi: Hàm smeltItem không được tìm thấy trong craftCommands.");
          bot.chat("Xin lỗi, tôi chưa biết cách nung đồ.");
        }
        break;
      case "GO_TO_SLEEP": await sleepCommands.goToSleep(bot, username); break;
      case "STRIP_MINE": await stripMineCommands.startStripMiningTask(bot, username, trimmedMessage, aiModel); break;
      case "HUNT_MOB": await huntCommands.startHuntingTask(bot, username, trimmedMessage, aiModel); break;
      case "CLEAN_INVENTORY": await cleanInventoryCommands.startCleaningInventory(bot, username); break;
      case "DEPOSIT_ITEMS": await depositCommands.startDepositTask(bot, username, trimmedMessage, aiModel); break;
      case "EQUIP_ITEM": await equipCommands.startEquipItemTask(bot, username, trimmedMessage, aiModel); break;
      case "IDENTIFY_ITEM": await translateIdentifyCommands.handleIdentifyRequest(bot, username, trimmedMessage, aiModel); break;
      case "FARM_WHEAT":
        const radiusMatch = trimmedMessage.match(/(\d+)\s*(khối|block|ô|radius|bk)/i);
        const farmRadius = radiusMatch ? parseInt(radiusMatch[1], 10) : 50;
        if (farmWheatCommands && typeof farmWheatCommands.startFarmingWheat === 'function') {
          await farmWheatCommands.startFarmingWheat(username, farmRadius);
        } else {
          console.error("[Farm Wheat] Lỗi: Không tìm thấy hàm startFarmingWheat.");
          bot.chat("Lỗi rồi, tôi không tìm thấy chức năng làm ruộng.");
        }
        break;
      case "LIST_CAPABILITIES": infoCommands.listCapabilities(bot, username); break;
      case "STOP_TASK": console.log(`[Action] Intent STOP_TASK recognized for ${username}.`); stopAllTasks(bot, username); break;
      case "GENERAL_CHAT": await chatCommands.handleGeneralChat(bot, username, trimmedMessage, aiModel); break;
      case "IGNORE": console.log(`[Action] Bỏ qua tin nhắn từ ${username} (AI Classification).`); break;
      default:
        console.warn(`[Action] Unknown AI intent: "${intentClassification}". Fallback to General Chat.`);
        await chatCommands.handleGeneralChat(bot, username, trimmedMessage, aiModel);
        break;
    }
  } catch (error) {
    console.error("[AI/Chat Processing] Lỗi nghiêm trọng:", error);
    stopAllTasks(bot, "Lỗi hệ thống");
    try { bot.chat(`Ui, đầu tôi lag quá ${username} ơi, lỗi rồi! (${error.message})`); }
    catch (sendError) { console.error("[Chat Error] Lỗi gửi tin nhắn báo lỗi:", sendError); }
  }
});

// --- Xử lý Lỗi và Kết thúc ---
bot.on("error", (err) => { console.error("!!! LỖI BOT:", err); });
bot.on("kicked", (reason) => {
  console.error("--- Bot bị kick ---");
  try { console.error("Lý do (JSON):", JSON.parse(reason)); }
  catch { console.error("Lý do:", reason); }
  stopAllTasks(bot, "Bị kick");
});

bot.on("end", (reason) => {
  console.log("--- Kết nối bot kết thúc ---");
  console.log("Lý do:", reason);
  if (autoLoot && typeof autoLoot.stopAutoLoot === "function") {
    autoLoot.stopAutoLoot("Bot connection ended");
}
  if (bot.autoEatInterval) clearInterval(bot.autoEatInterval); bot.autoEatInterval = null;
  if (bot.protectionInterval) clearInterval(bot.protectionInterval); bot.protectionInterval = null;
  if (bot.stuckDetectionInterval) clearInterval(bot.stuckDetectionInterval); bot.stuckDetectionInterval = null;
  if (bot.autoTorchInterval) clearInterval(bot.autoTorchInterval); bot.autoTorchInterval = null;
  console.log("Đã dọn dẹp interval timers.");
});

bot.on("messagestr", (message, messagePosition, jsonMsg) => {
  if (messagePosition !== 'chat') {
      try {
          const timestamp = new Date().toLocaleTimeString();
          const historyEntry = `[${timestamp}] [System] ${message}`;
          bot.chatHistory.push(historyEntry);
          if (bot.chatHistory.length > MAX_CHAT_HISTORY) { bot.chatHistory.shift(); }
      } catch (histError) { console.error("Error adding system message to chat history:", histError); }
  }
});

// --- Xử lý Ctrl+C ---
process.on("SIGINT", () => {
  console.log("\nĐang ngắt kết nối bot (Ctrl+C)...");
  if (bot.stuckDetectionInterval) clearInterval(bot.stuckDetectionInterval); bot.stuckDetectionInterval = null;
  if (bot.autoEatInterval) clearInterval(bot.autoEatInterval); bot.autoEatInterval = null;
  if (bot.protectionInterval) clearInterval(bot.protectionInterval); bot.protectionInterval = null;
  if (bot.autoTorchInterval) clearInterval(bot.autoTorchInterval); bot.autoTorchInterval = null;
  console.log("[SIGINT] Cleared interval timers.");

  stopAllTasks(bot, "Tắt server");

  const quitMessage = `Bot AI (${bot.botInGameName || BOT_USERNAME}) tạm biệt và thoát game!`;
  try {
    if (bot.player) { bot.chat(quitMessage); }
    else { console.log("(Bot không còn trong game để chat)"); }
  } catch (e) { console.error("Lỗi khi cố gắng chat khi thoát:", e.message); }

  setTimeout(() => {
    try { if (bot?.quit) bot.quit(); }
    catch (e) { console.error("Lỗi khi gọi bot.quit():", e.message); }
    console.log("Đã ngắt kết nối. Thoát chương trình.");
    process.exit(0);
  }, 1000);
});

// --- END OF FILE bot.js ---