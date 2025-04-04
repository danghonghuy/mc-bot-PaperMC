// --- START OF FILE bot.js ---

require("dotenv").config();
const mineflayer = require("mineflayer");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const mcData = require("minecraft-data");

// Import các module lệnh
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
const farmCommands = require("./commands/farm"); // Giữ lại import
const craftCommands = require("./commands/craft");
const infoCommands = require("./commands/info");
const sleepCommands = require("./commands/sleep");
const stripMineCommands = require("./commands/strip_mine");
const huntCommands = require("./commands/hunt");
const depositCommands = require("./commands/deposit");
const equipCommands = require("./commands/equip_item");
const eventNotifierCommands = require("./event_notifier");
const autoEatCommands = require("./auto_eat");
const { flattenArea, stopFlatten } = require('./commands/flatten_area');
const homeCommands = require("./commands/home"); // Import module xây nhà

// ***** THÊM IMPORT MODULE MỚI *****
const autoTorch = require('./commands/auto_torch'); // Import module tự đặt đuốc
const autoDefend = require('./commands/auto_defend'); // Import module tự vệ
// **********************************

const { roundCoord, formatCoords } = require("./utils");

// --- Cấu hình ---
const SERVER_ADDRESS = "dhhnedhhne.aternos.me";
const SERVER_PORT = 21691;
const BOT_USERNAME = "TuiKhongVui";
// ***** ĐẢM BẢO PHIÊN BẢN ĐÚNG *****
const MINECRAFT_VERSION = "1.21.4"; // Hoặc phiên bản bé đang dùng
// *********************************

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("LỖI: Không tìm thấy GEMINI_API_KEY trong file .env!");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
// ***** CÓ THỂ DÙNG GEMINI FLASH CHO NHANH *****
const aiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" }); // Thử dùng flash
// ******************************************

console.log(`Đang kết nối tới ${SERVER_ADDRESS}:${SERVER_PORT}...`);
console.log(`Tên bot: ${BOT_USERNAME}, Phiên bản: ${MINECRAFT_VERSION}`);

// --- Khởi tạo Bot ---
const bot = mineflayer.createBot({
  host: SERVER_ADDRESS,
  port: SERVER_PORT,
  username: BOT_USERNAME,
  version: MINECRAFT_VERSION,
  hideErrors: false,
  checkTimeoutInterval: 60 * 1000,
  // auth: 'microsoft' // Bỏ comment dòng này nếu dùng tài khoản Microsoft
});

bot.loadPlugin(pathfinder);
console.log("Đã tạo bot. Bắt đầu kết nối...");

// --- Khởi tạo Trạng thái Bot ---
bot.botInGameName = BOT_USERNAME;
bot.defaultMove = null;
bot.followingTarget = null;
bot.isFollowing = false;
bot.isFinding = false;
bot.findingTaskDetails = null;
bot.isProtecting = false; // Trạng thái bảo vệ theo lệnh
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
// ***** THÊM TRẠNG THÁI XÂY DỰNG *****
bot.isBuilding = false;
bot.buildingTaskDetails = null; // Có thể dùng để lưu tiến độ sau này
// ***********************************
bot.waypoints = {};
bot.autoEatInterval = null;
// ***** THÊM TRẠNG THÁI CẢI TIẾN *****
bot.stuckDetectionInterval = null; // Interval để kiểm tra kẹt
bot.badZones = {}; // Lưu trữ các vùng có vấn đề (cần logic xử lý thêm)
// ***** THÊM TRẠNG THÁI TỰ VỆ *****
bot.isDefending = false; // Trạng thái tự vệ khi bị tấn công
// *********************************

// --- Hàm Dừng Tất Cả Nhiệm Vụ ---
// Sử dụng botInstanceRef để đảm bảo đúng scope khi truyền hàm này đi
function stopAllTasks(botInstanceRef, usernameOrReason) {
  let stoppedSomething = false;
  const reasonText =
    typeof usernameOrReason === "string" ? usernameOrReason : "Unknown Reason";
  console.log(`[Stop All] Received stop request. Reason: ${reasonText}`);

  // ***** TÍCH HỢP DỪNG AUTO DEFEND *****
  // Ưu tiên dừng phòng thủ trước
  if (botInstanceRef && botInstanceRef.isDefending && reasonText !== 'Bị tấn công') {
    if (autoDefend && typeof autoDefend.stopDefending === 'function') {
        console.log("[Stop All] Stopping auto-defend task (reason not 'Bị tấn công')...");
        autoDefend.stopDefending(reasonText); // Gọi hàm dừng chuyên dụng
        stoppedSomething = true; // Đánh dấu đã dừng auto-defend
    } else {
        console.warn("[Stop All] autoDefend module or stopDefending function not found! Manually resetting flag.");
        botInstanceRef.isDefending = false; // Reset thủ công nếu không tìm thấy hàm
    }
} else if (botInstanceRef && botInstanceRef.isDefending && reasonText === 'Bị tấn công') {
    // Nếu lý do là 'Bị tấn công', chỉ log rằng auto-defend đang hoạt động, không dừng nó
    console.log("[Stop All] Auto-defend is active due to 'Bị tấn công', not stopping it here.");
    // Không set stoppedSomething = true cho trường hợp này trong stopAllTasks
}
  // ***********************************

  // Các logic dừng task khác giữ nguyên, sử dụng botInstanceRef
  if (botInstanceRef && botInstanceRef.isFlattening) {
    console.log("[Stop All] Stopping flatten task...");
    stopFlatten(botInstanceRef, usernameOrReason); // Gọi hàm dừng chuyên dụng
    botInstanceRef.isFlattening = false;
    botInstanceRef.flattenStopRequested = false; // Đảm bảo reset cờ yêu cầu dừng
    stoppedSomething = true;
  }
  if (botInstanceRef && botInstanceRef.isFinding) {
    findCommands.stopFinding(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef && botInstanceRef.isFollowing) {
    followCommands.stopFollowing(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef && botInstanceRef.isProtecting) {
    protectCommands.stopProtecting(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef && botInstanceRef.isCollecting) {
    collectCommands.stopCollecting(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef && botInstanceRef.isCleaningInventory) {
    cleanInventoryCommands.stopCleaningInventory(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef && botInstanceRef.isStripMining) {
    stripMineCommands.stopStripMining(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef && botInstanceRef.isHunting) {
    huntCommands.stopHunting(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef && botInstanceRef.isDepositing) {
    depositCommands.stopDepositTask(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef && botInstanceRef.isBuilding) {
    console.log("[Stop All] Stopping building task (setting flag).");
    botInstanceRef.isBuilding = false;
    botInstanceRef.buildingTaskDetails = null; // Reset details
    stoppedSomething = true;
  }
  if (botInstanceRef && botInstanceRef.isSleeping) {
    try {
      botInstanceRef.wake();
      console.log("[Stop All] Woke up bot.");
      stoppedSomething = true;
    } catch (e) {
      console.error("[Stop All] Error waking up bot:", e.message);
    }
    botInstanceRef.isSleeping = false; // Reset flag after waking
  }

  // Dừng pathfinder và hành động trên botInstanceRef
  if (botInstanceRef && botInstanceRef.pathfinder?.isMoving()) {
    try {
      botInstanceRef.pathfinder.stop();
      console.log("[Stop All] Explicitly stopped pathfinder.");
    } catch (e) {
      console.error("[Stop All] Error stopping pathfinder:", e.message);
    }
  }

  try {
    if (botInstanceRef) botInstanceRef.stopDigging();
  } catch (e) { /* Ignore */ }
  if (botInstanceRef) botInstanceRef.clearControlStates(); // Dừng mọi di chuyển/hành động cơ bản

  // Thông báo kết quả (Sửa đổi để dùng botInstanceRef để chat)
  const silentReasons = [
      "Hệ thống", "Lỗi hệ thống", "Bot chết", "Bị kick",
      "Mất kết nối", "Bị kẹt", "Bị tấn công" // Thêm lý do tự vệ
  ];
  const userInitiatedStop = typeof usernameOrReason === 'string' && !silentReasons.includes(usernameOrReason) && !usernameOrReason.startsWith("Lỗi");

  if (botInstanceRef) { // Chỉ chat nếu bot còn tồn tại
      if (!stoppedSomething && userInitiatedStop) {
          try { botInstanceRef.chat(`Tôi không đang làm gì để dừng cả, ${usernameOrReason}.`); } catch(e){ console.error("Error sending 'not doing anything' chat:", e); }
      } else if (stoppedSomething && userInitiatedStop) {
          console.log(`[Stop All] Tasks stopped due to: ${usernameOrReason}.`);
           try { botInstanceRef.chat(`Ok ${usernameOrReason}, đã dừng việc đang làm.`); } catch(e){ console.error("Error sending 'stopped task' chat:", e); }
      } else if (stoppedSomething) {
          // Log các lần dừng tự động hoặc do lỗi hệ thống
           console.log(`[Stop All] Tasks stopped due to: ${reasonText}.`);
      }
  } else {
       console.log("[Stop All] Bot instance reference is invalid, cannot send chat message.");
  }
}

// --- Sự kiện Bot Spawn ---
bot.once("spawn", () => {
  bot.botInGameName = bot.username;
  console.log(`*** Bot (${bot.botInGameName}) đã vào server! ***`);
  const startPos = bot.entity.position;
  console.log(`Vị trí: ${formatCoords(startPos)}`);

  // Reset trạng thái giữ nguyên, thêm reset isDefending
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
  // ***** RESET TRẠNG THÁI CẢI TIẾN *****
  if (bot.stuckDetectionInterval) clearInterval(bot.stuckDetectionInterval); // Xóa interval cũ nếu có
  bot.stuckDetectionInterval = null;
  bot.badZones = {}; // Reset vùng nguy hiểm khi spawn
  bot.isDefending = false; // Reset trạng thái tự vệ
  // ************************************

  // --- Cấu hình Pathfinder & Movements ---
  try {
    const currentMcData = mcData(bot.version);
    if (!currentMcData) throw new Error("Không thể tải mcData cho phiên bản này!");

    // ***** CẢI TIẾN: TĂNG TIMEOUT PATHFINDER *****
    if (bot.pathfinder) {
        bot.pathfinder.thinkTimeout = 10000; // Tăng thời gian tính toán lên 10 giây
        console.log(`[Pathfinder Config] Set thinkTimeout to ${bot.pathfinder.thinkTimeout}ms.`);
    } else {
         console.warn("[Pathfinder Config] bot.pathfinder not available at spawn time for setting thinkTimeout.");
    }
    // ******************************************

    bot.defaultMove = new Movements(bot, currentMcData);
    console.log("[Movements Config] Applying custom settings...");
    bot.defaultMove.allowSprinting = true;
    console.log(`  - allowSprinting: ${bot.defaultMove.allowSprinting}`);
    // ***** CẢI TIẾN: BẬT LẠI PARKOUR *****
    bot.defaultMove.allowParkour = true; // Bật lại Parkour
    console.log(`  - allowParkour: ${bot.defaultMove.allowParkour}`); // Cập nhật log
    // *************************************
    bot.defaultMove.canDig = true; // Cho phép đào khi di chuyển
    console.log(`  - canDig: ${bot.defaultMove.canDig}`);
    bot.defaultMove.maxDropDown = 4;
    console.log(`  - maxDropDown: ${bot.defaultMove.maxDropDown}`);
    // ***** CẢI TIẾN: TẮT XÂY TRỤ 1x1 *****
    bot.defaultMove.allow1by1towers = false; // Đặt thành false như yêu cầu
    console.log(`  - allow1by1towers: ${bot.defaultMove.allow1by1towers}`); // Cập nhật log
    // ************************************
    bot.defaultMove.canPlace = true; // Cho phép đặt khối khi di chuyển (vẫn cần cho scaffolding khác)
    console.log(`  - canPlace: ${bot.defaultMove.canPlace}`);

    // Khởi tạo blocksToPlace nếu chưa có
    if (!bot.defaultMove.blocksToPlace) {
      console.warn(
        "[Movements Config] bot.defaultMove.blocksToPlace was not initialized. Creating a new Set."
      );
      bot.defaultMove.blocksToPlace = new Set();
    }
    // Cung cấp các khối xây dựng tạm (scaffolding)
    const scaffoldBlocks = [
      "dirt", "cobblestone", "netherrack", "cobbled_deepslate", "stone",
      "oak_planks", "spruce_planks", "birch_planks" /*Thêm các loại gỗ khác nếu cần*/,
    ];
    scaffoldBlocks.forEach((name) => {
      const block = currentMcData.blocksByName[name];
      if (block) {
        bot.defaultMove.blocksToPlace.add(block.id);
        console.log(`  - Added scaffold block: ${name} (ID: ${block.id})`);
      } else {
        console.warn(`  - Cannot find scaffold block: ${name}`);
      }
    });

    // Khối cần tránh
    const blocksToAvoidNames = [
      "lava", "fire", "cactus", "sweet_berry_bush", "powder_snow", "magma_block",
    ];
    if (!bot.defaultMove.blocksToAvoid) {
      bot.defaultMove.blocksToAvoid = new Set();
    }
    blocksToAvoidNames.forEach((name) => {
      const block = currentMcData.blocksByName[name];
      if (block) bot.defaultMove.blocksToAvoid.add(block.id);
    });
    console.log(
      `  - Blocks to avoid IDs: ${[...bot.defaultMove.blocksToAvoid].join(", ")}`
    );

    // Khối không được phá
    const blocksCantBreakNames = [
      "chest", "ender_chest", "furnace", "blast_furnace", "smoker",
      "crafting_table", "enchanting_table", "anvil", "beacon", "bed", "respawn_anchor",
    ];
    if (!bot.defaultMove.blocksCantBreak) {
      bot.defaultMove.blocksCantBreak = new Set();
    }
    blocksCantBreakNames.forEach((name) => {
      const block = currentMcData.blocksByName[name];
      if (block) bot.defaultMove.blocksCantBreak.add(block.id);
    });
    console.log(
      `  - Blocks cant break IDs: ${[...bot.defaultMove.blocksCantBreak].join(", ")}`
    );

    if (bot.pathfinder) {
      bot.pathfinder.setMovements(bot.defaultMove);
      // Cập nhật log để phản ánh thay đổi
      console.log("[Pathfinder] Đã khởi tạo và thiết lập Movements (parkour: true, thinkTimeout: 10s, 1x1towers: false).");
    } else {
      console.error("[Lỗi Khởi tạo Pathfinder] bot.pathfinder không tồn tại!");
    }
  } catch (err) {
    console.error("[Lỗi Khởi tạo Pathfinder/Movements]:", err);
  }

  // ***** CẢI TIẾN: THÊM LOGIC PHÁT HIỆN KẸT *****
  // (Giữ nguyên code logic phát hiện kẹt như phiên bản trước)
  let lastPosStuckCheck = null; let stuckCounter = 0;
  const STUCK_THRESHOLD = 0.08; const STUCK_TIMEOUT_COUNT = 12;
  bot.stuckDetectionInterval = setInterval(() => {
      if (bot.pathfinder && bot.pathfinder.isMoving() && bot.entity?.position) {
          const currentPos = bot.entity.position;
          if (lastPosStuckCheck && currentPos.distanceTo(lastPosStuckCheck) < STUCK_THRESHOLD) {
              stuckCounter++;
              if (stuckCounter >= STUCK_TIMEOUT_COUNT) {
                  console.warn(`[Stuck Detector] Bot có vẻ bị kẹt tại ${formatCoords(currentPos)}! Đang dừng nhiệm vụ hiện tại.`);
                   try { bot.chat("Ối, hình như tôi bị kẹt rồi! Đang dừng lại."); } catch(e){ console.error("Error sending stuck chat:", e); }
                  stopAllTasks(bot, "Bị kẹt"); // Truyền bot instance
                  stuckCounter = 0; lastPosStuckCheck = null;
              }
          } else { stuckCounter = 0; }
          lastPosStuckCheck = currentPos.clone();
      } else { stuckCounter = 0; lastPosStuckCheck = null; }
  }, 500);
  console.log(`[System] Đã kích hoạt kiểm tra kẹt di chuyển (Threshold: ${STUCK_THRESHOLD}, Timeout: ${STUCK_TIMEOUT_COUNT * 500}ms).`);
  // ********************************************

  // Khởi tạo các module khác
  eventNotifierCommands.initializeEventNotifier(bot);
  autoEatCommands.initializeAutoEat(bot);
  // ***** KHỞI TẠO MODULE MỚI *****
  autoTorch.initializeAutoTorch(bot);
  // Truyền cả bot instance và hàm stopAllTasks (được định nghĩa ở global scope này)
  // Giả sử auto_defend.js đã được sửa để nhận stopAllTasks làm tham số thứ 2
  autoDefend.initializeAutoDefend(bot, stopAllTasks);
  // *******************************

  // Chào hỏi giữ nguyên
  setTimeout(() => {
     try {
        bot.chat(`Bot AI (${bot.botInGameName}) đã kết nối! Hỏi gì đi nào? :D (Gõ 'bạn làm được gì?' để xem danh sách lệnh)`);
     } catch(e) { console.error("Error sending initial chat message:", e);}
  }, 1500);

  // --- Lắng nghe sự kiện Pathfinder (Giữ nguyên logic gốc) ---
  const pathfinderEvents = ["goal_reached", "path_reset", "cannotFindPath", "interrupted", "goal_non_reachable"];
  pathfinderEvents.forEach((eventName) => {
    bot.on(eventName, (...args) => {
      const reason = args[0]?.message || args[0] || eventName; // Lấy lý do lỗi nếu có
      console.log(
        `\n[PATHFINDER EVENT] Event: ${eventName}, Reason/Args: ${reason}`
      );
      // ***** CẬP NHẬT LOG TRẠNG THÁI *****
      console.log(
        `  Current State: Find=${bot.isFinding}, Follow=${bot.isFollowing}, Protect=${bot.isProtecting}, Defend=${bot.isDefending}, Collect=${bot.isCollecting}, Sleep=${bot.isSleeping}, Mine=${bot.isStripMining}, Hunt=${bot.isHunting}, Clean=${bot.isCleaningInventory}, Deposit=${bot.isDepositing}, Build=${bot.isBuilding}, Flatten=${bot.isFlattening}`
      );
      // **********************************

      const isPathError =
        eventName === "cannotFindPath" ||
        eventName === "goal_non_reachable" ||
        eventName === "interrupted";

      if (isPathError) {
        console.error(`[Pathfinder Error Detected] Reason: ${reason}`);
        // Có thể thêm logic ghi nhớ badZones ở đây nếu muốn
        // const errorPosStr = formatCoords(bot.entity.position);
        // bot.badZones[errorPosStr] = (bot.badZones[errorPosStr] || 0) + 1;
        // console.log(`[Bad Zone] Recorded path error at ${errorPosStr}. Count: ${bot.badZones[errorPosStr]}`);

        // Xử lý lỗi cụ thể cho từng task (giữ nguyên logic gốc của bạn)
        if (bot.isFinding && findCommands.handleFindPathError) {
          findCommands.handleFindPathError(bot, reason);
        } else if (bot.isCleaningInventory && cleanInventoryCommands.finishCleaningInventory) {
          cleanInventoryCommands.finishCleaningInventory(bot, false, `Không thể đến nơi vứt đồ: ${reason}`);
        } else if (bot.isDepositing && depositCommands.stopDepositTask) {
          depositCommands.stopDepositTask(bot, `Lỗi di chuyển đến rương: ${reason}`);
        } else if (bot.isCollecting && bot.collectingTaskDetails) {
          const targetPos = bot.collectingTaskDetails.currentTarget?.position;
          const currentPos = bot.entity.position;
          if (targetPos && targetPos.y > currentPos.y + 1.5) {
            console.error(`[Collect Path Error] Không thể đến khối ${bot.collectingTaskDetails.itemNameVi} ở trên cao (${formatCoords(targetPos)}). Lý do: ${reason}. Thử tìm khối khác.`);
            try { bot.chat(`Tôi không lên được chỗ khối ${bot.collectingTaskDetails.itemNameVi} đó, tìm khối khác vậy.`); } catch(e){ console.error("Error sending collect path error chat:", e); }
            bot.collectingTaskDetails.currentTarget = null; // Reset target để tìm lại
            bot.collectingTaskDetails.status = "idle"; // Reset status
          } else {
            console.warn(`[Collect Path Error] Lỗi di chuyển khi thu thập: ${reason}. Vòng lặp collect sẽ thử tìm khối khác.`);
            bot.collectingTaskDetails.currentTarget = null;
            bot.collectingTaskDetails.status = "idle";
          }
        } else if (bot.isStripMining && stripMineCommands.stopStripMining) { // Sử dụng hàm stop như một handler tạm thời
          stripMineCommands.stopStripMining(bot, `Lỗi di chuyển khi đào hầm: ${reason}`);
        } else if (bot.isHunting && huntCommands.stopHunting) { // Sử dụng hàm stop như một handler tạm thời
          huntCommands.stopHunting(bot, `Lỗi di chuyển khi săn bắn: ${reason}`);
        } else if (bot.isBuilding && homeCommands.handleBuildPathError) { // Giả sử home.js có hàm xử lý lỗi path
             homeCommands.handleBuildPathError(bot, reason);
        } else if (bot.isFlattening /* && flattenCommands.handleFlattenPathError */) { // Giả sử flatten.js có hàm xử lý lỗi path (hoặc dùng stopFlatten)
             console.warn(`[Flatten Path Error] Lỗi di chuyển khi làm phẳng: ${reason}. Dừng làm phẳng.`);
             stopFlatten(bot, `Lỗi di chuyển: ${reason}`); // Gọi hàm dừng chuyên dụng
        }
        // !!! QUAN TRỌNG: Không dừng bot nếu nó đang tự vệ và gặp lỗi pathfinding khi đuổi theo
        else if (bot.pathfinder?.isMoving() && !bot.isDefending) { // Chỉ dừng nếu *không* đang tự vệ
          console.warn(`[Pathfinder Error] Lỗi khi đang di chuyển tự do (không phòng thủ): ${reason}. Dừng di chuyển.`);
          stopAllTasks(bot, `Lỗi di chuyển: ${reason}`); // Truyền bot instance
        } else if (bot.isDefending && isPathError) {
            console.warn(`[Pathfinder Error] Lỗi di chuyển khi đang phòng thủ: ${reason}. (Auto Defend logic sẽ xử lý)`);
            // Để logic trong auto_defend.js quyết định có nên dừng phòng thủ hay không
        }
      }

      // Xử lý goal_reached cho task finding (giữ nguyên)
      if (bot.isFinding && eventName === "goal_reached" && findCommands.handleFindGoalReached) {
        findCommands.handleFindGoalReached(bot);
      }
      // Có thể thêm các handler goal_reached cho các task khác ở đây
    });
  });

  // --- Các sự kiện Bot khác (Giữ nguyên) ---
  bot.on("sleep", () => { console.log("[Event] Bot đã ngủ thành công."); bot.isSleeping = true; try{ bot.chat("Khò khò... Zzzz"); } catch(e){} });
  bot.on("wake", () => { console.log("[Event] Bot đã thức dậy."); bot.isSleeping = false; });
  bot.on("death", () => { console.error("!!! BOT ĐÃ CHẾT !!!"); try{ bot.chat("Ối! Tôi chết mất rồi... :("); } catch(e){} stopAllTasks(bot, "Bot chết"); }); // Truyền bot instance
  bot.on("health", () => { /* Có thể log máu/đói */ });
});

// --- Xử lý Tin nhắn Chat ---
bot.on("chat", async (username, message) => {
  if (username === bot.username || !message) return;

  const trimmedMessage = message.trim();
  const lowerMessage = trimmedMessage.toLowerCase();
  console.log(`[Chat In] <${username}> ${trimmedMessage}`);
  if (!trimmedMessage) return;

  // --- Kiểm tra lệnh dừng (Cập nhật isBusy) ---
  // ***** CẬP NHẬT isBusy *****
  const isBusy = bot.isFinding || bot.isFollowing || bot.isProtecting || bot.isDefending || // Thêm isDefending
                 bot.isCollecting || bot.isSleeping || bot.isStripMining || bot.isHunting ||
                 bot.isCleaningInventory || bot.isDepositing || bot.isBuilding || bot.isFlattening;
  // **************************
  const stopKeywords = ["dừng", "stop", "hủy", "cancel", "thôi", "dừng lại", "dậy đi", "ngừng"];
  // Cho phép dừng cả khi đang di chuyển tự do (không có task cụ thể)
  if ((isBusy || bot.pathfinder?.isMoving()) && stopKeywords.some((k) => lowerMessage.includes(k))) {
    console.log(`[Manual Stop] User ${username} requested stop/wake.`);
    stopAllTasks(bot, username); // Truyền bot instance
    return;
  }

  // --- Xử lý xác nhận cho lệnh Find (Giữ nguyên) ---
  if (bot.isFinding && bot.findingTaskDetails?.waitingForConfirmation && username === bot.findingTaskDetails.username) {
    const confirmKeywords = ["tiếp", "ok", "oke", "có", "yes", "uh", "ừ", "di", "đi", "continue", "proceed", "tìm tiếp"];
    const cancelKeywords = ["dừng", "thôi", "hủy", "stop", "cancel", "ko", "không", "no", "khong", "đủ rồi"];
    let confirmed = confirmKeywords.some((k) => lowerMessage.includes(k));
    let cancelled = !confirmed && cancelKeywords.some((k) => lowerMessage.includes(k));
    if (confirmed) {
      findCommands.proceedToNextTarget(bot);
    } else if (cancelled) {
      stopAllTasks(bot, username); // Truyền bot instance
    } else {
       try { bot.chat(`${username}, nói 'tiếp' để đi tiếp hoặc 'dừng' để hủy nhé.`); } catch(e){ console.error("Error sending find confirmation chat:", e); }
    }
    return;
  }

  // --- Phân loại ý định và thực thi lệnh ---
  try {
    // ***** GIỮ NGUYÊN PROMPT AI ĐẦY ĐỦ *****
    const classificationPrompt = `**Nhiệm vụ:** Phân loại ý định chính trong tin nhắn của người chơi gửi cho bot Minecraft.

    **Ngữ cảnh:**
    *   Người gửi: "${username}"
    *   Người nhận (Bot): "${bot.botInGameName}"
    *   Tin nhắn gốc: "${trimmedMessage}"

    **Yêu cầu:**
    Chọn MỘT loại ý định phù hợp NHẤT từ danh sách dưới đây cho tin nhắn trên.

    **Danh sách các loại ý định:**
    *   GET_BOT_COORDS: Hỏi tọa độ hiện tại của bot.
    *   GET_ENTITY_COORDS: Hỏi tọa độ của một thực thể (người chơi khác, mob, vật phẩm...).
    *   FOLLOW_PLAYER: Yêu cầu bot đi theo người chơi.
    *   FIND_BLOCK: Yêu cầu bot tìm một loại block cụ thể gần đó.
    *   CHECK_INVENTORY: Yêu cầu bot liệt kê những gì nó có trong túi đồ.
    *   GIVE_ITEM: Yêu cầu bot đưa một vật phẩm cho người chơi.
    *   PROTECT_PLAYER: Yêu cầu bot bảo vệ người chơi khỏi nguy hiểm (đánh mob).
    *   COLLECT_BLOCK: Yêu cầu bot thu thập (đào/chặt) một số lượng block nhất định.
    *   GOTO_COORDS: Yêu cầu bot đi đến một tọa độ cụ thể.
    *   SCAN_ORES: Yêu cầu bot quét tìm các loại quặng xung quanh.
    *   SAVE_WAYPOINT: Yêu cầu bot lưu tọa độ hiện tại với một cái tên (waypoint).
    *   GOTO_WAYPOINT: Yêu cầu bot đi đến một waypoint đã lưu.
   *   FLATTEN_AREA: Yêu cầu bot làm phẳng một khu vực.
    *   LIST_WAYPOINTS: Yêu cầu bot liệt kê các waypoint đã lưu.
    *   DELETE_WAYPOINT: Yêu cầu bot xóa một waypoint đã lưu.
    *   BREED_ANIMALS: Yêu cầu bot cho các con vật gần đó giao phối.
    *   CRAFT_ITEM: Yêu cầu bot chế tạo một vật phẩm.
    *   GO_TO_SLEEP: Yêu cầu bot tìm giường và đi ngủ.
    *   STRIP_MINE: Yêu cầu bot đào hang, hầm.
    *   HUNT_MOB: Yêu cầu bot đi săn một loại mob cụ thể.
    *   BUILD_HOUSE: Yêu cầu bot xây nhà.
    *   CLEAN_INVENTORY: Yêu cầu bot dọn dẹp túi đồ (vứt bỏ vật phẩm không cần thiết).
    *   DEPOSIT_ITEMS: Yêu cầu bot cất giữ vật phẩm vào một nơi chứa đồ (ví dụ: rương).
    *   EQUIP_ITEM: Yêu cầu bot trang bị/cầm một vật phẩm (vũ khí, công cụ, giáp, khiên...).
    *   LIST_CAPABILITIES: Hỏi bot về những gì nó có thể làm, các lệnh hỗ trợ.
    *   STOP_TASK: Yêu cầu bot dừng hành động đang làm.
    *   GENERAL_CHAT: Tin nhắn trò chuyện thông thường, không phải lệnh cụ thể.
    *   IGNORE: Tin nhắn không rõ nghĩa, không liên quan hoặc yêu cầu bot không làm gì.

    **Phân loại cho tin nhắn sau:**
    "${trimmedMessage}"

    **Loại ý định là:**`; // Để trống cho AI điền vào
    // *************************************

    console.log(`[AI Intent] Gửi prompt phân loại...`);
    const intentResult = await aiModel.generateContent(classificationPrompt);
    const intentClassification = (await intentResult.response.text()).trim().toUpperCase().replace(/[^A-Z_]/g, "");
    console.log(`[AI Intent] Phân loại: "${intentClassification}" (Tin nhắn gốc: "${trimmedMessage}")`);

    // --- Kiểm tra nếu bot đang bận (Cập nhật reason) ---
    const nonBlockingIntents = ["GET_BOT_COORDS", "GET_ENTITY_COORDS", "CHECK_INVENTORY", "SCAN_ORES", "LIST_WAYPOINTS", "LIST_CAPABILITIES", "GENERAL_CHAT", "IGNORE", "STOP_TASK"];
    if (isBusy && !nonBlockingIntents.includes(intentClassification)) {
      // ***** CẬP NHẬT REASON *****
      let reason = bot.isFinding ? "tìm đồ"
                   : bot.isFollowing ? "đi theo"
                   : bot.isProtecting ? "bảo vệ"
                   : bot.isDefending ? "phòng thủ" // Thêm phòng thủ
                   : bot.isCollecting ? "thu thập"
                   : bot.isSleeping ? "ngủ"
                   : bot.isStripMining ? "đào hầm"
                   : bot.isHunting ? "săn bắn"
                   : bot.isCleaningInventory ? "dọn túi đồ"
                   : bot.isDepositing ? "cất đồ"
                   : bot.isBuilding ? "xây nhà"
                   : bot.isFlattening ? "làm phẳng"
                   : "làm việc khác";
      // **************************
       try { bot.chat(`${username}, tôi đang bận ${reason} rồi! Nói 'dừng' nếu muốn tôi hủy việc đang làm.`); } catch(e){ console.error("Error sending busy chat:", e); }
      console.log(`[Action Blocked] Intent ${intentClassification} blocked because bot is busy (${reason}).`);
      return;
    }

    // --- Thực thi lệnh (Switch case giữ nguyên) ---
    // Không cần thêm case mới cho autoTorch hay autoDefend vì chúng là tự động
    switch (intentClassification) {
      case "GET_BOT_COORDS": coordsCommands.getBotCoords(bot, username); break;
      case "GET_ENTITY_COORDS": await coordsCommands.getEntityCoords( bot, username, trimmedMessage, aiModel ); break;
      case "BUILD_HOUSE": bot.isBuilding = true; await homeCommands.startBuildHousePhase2Task(bot, username); break;
      case "FOLLOW_PLAYER": followCommands.startFollowing(bot, username); break;
      case "FLATTEN_AREA": await flattenArea(bot, username, trimmedMessage, aiModel); break;
      case "FIND_BLOCK": await findCommands.startFindingTask( bot, username, trimmedMessage, aiModel ); break;
      case "CHECK_INVENTORY": inventoryCommands.checkInventory(bot, username); break;
      case "GIVE_ITEM": await inventoryCommands.giveItem( bot, username, trimmedMessage, aiModel ); break;
      case "PROTECT_PLAYER": await protectCommands.startProtecting(bot, username); break;
      case "COLLECT_BLOCK": await collectCommands.startCollectingTask( bot, username, trimmedMessage, aiModel ); break;
      case "GOTO_COORDS": await navigateCommands.goToCoordinates( bot, username, trimmedMessage, aiModel ); break;
      case "SCAN_ORES": await scanCommands.scanNearbyOres(bot, username); break;
      case "SAVE_WAYPOINT": await navigateCommands.saveWaypoint( bot, username, trimmedMessage, aiModel ); break;
      case "GOTO_WAYPOINT": await navigateCommands.goToWaypoint( bot, username, trimmedMessage, aiModel ); break;
      case "LIST_WAYPOINTS": navigateCommands.listWaypoints(bot, username); break;
      case "DELETE_WAYPOINT": await navigateCommands.deleteWaypoint( bot, username, trimmedMessage, aiModel ); break;
      case "BREED_ANIMALS": await farmCommands.breedAnimals(bot, username, trimmedMessage, aiModel); break;
      case "CRAFT_ITEM": await craftCommands.craftItem(bot, username, trimmedMessage, aiModel); break;
      case "GO_TO_SLEEP": await sleepCommands.goToSleep(bot, username); break;
      case "STRIP_MINE":
          // Lưu ý: Logic gọi autoTorch.checkAndPlaceTorch() cần nằm trong module strip_mine.js
          await stripMineCommands.startStripMiningTask(bot, username, trimmedMessage, aiModel);
          break;
      case "HUNT_MOB": await huntCommands.startHuntingTask( bot, username, trimmedMessage, aiModel ); break;
      case "CLEAN_INVENTORY": await cleanInventoryCommands.startCleaningInventory(bot, username); break;
      case "DEPOSIT_ITEMS": await depositCommands.startDepositTask( bot, username, trimmedMessage, aiModel ); break;
      case "EQUIP_ITEM": await equipCommands.startEquipItemTask( bot, username, trimmedMessage, aiModel ); break;
      case "LIST_CAPABILITIES": infoCommands.listCapabilities(bot, username); break;
      case "STOP_TASK": console.log("[Action] Intent STOP_TASK recognized (already handled)."); break;
      case "GENERAL_CHAT": await chatCommands.handleGeneralChat( bot, username, trimmedMessage, aiModel ); break;
      case "IGNORE": console.log(`[Action] Bỏ qua tin nhắn từ ${username} theo phân loại AI.`); break;
      default:
        console.warn(`[Action] Không rõ ý định từ AI: "${intentClassification}". Fallback sang General Chat.`);
        await chatCommands.handleGeneralChat( bot, username, trimmedMessage, aiModel );
        break;
    }
  } catch (error) {
    console.error("[AI/Chat Processing] Lỗi nghiêm trọng:", error);
    // Reset các cờ trạng thái quan trọng khi có lỗi lớn
    bot.isBuilding = false; bot.isFinding = false; bot.isFlattening = false; bot.isDefending = false; // Thêm isDefending
    stopAllTasks(bot, "Lỗi hệ thống"); // Truyền bot instance
    try {
       bot.chat(`Ui, đầu tôi lag quá ${username} ơi, lỗi rồi! (${error.message})`);
    } catch (sendError) {
      console.error("[Chat Error] Lỗi gửi tin nhắn báo lỗi:", sendError);
    }
  }
});

// --- Xử lý Lỗi và Kết thúc ---
bot.on("error", (err) => { console.error("!!! LỖI BOT:", err); });
bot.on("kicked", (reason) => {
  console.error("--- Bot bị kick ---");
  try { console.error("Lý do (JSON):", JSON.parse(reason)); } catch { console.error("Lý do:", reason); }
  stopAllTasks(bot, "Bị kick"); // Truyền bot instance
});

// ***** CẢI TIẾN: DỌN DẸP INTERVAL KHI KẾT THÚC *****
// (Giữ nguyên, đã bao gồm stuckDetectionInterval)
bot.on("end", (reason) => {
  console.log("--- Kết nối bot kết thúc ---"); console.log("Lý do:", reason);
  if (bot.autoEatInterval) clearInterval(bot.autoEatInterval);
  if (bot.protectionInterval) clearInterval(bot.protectionInterval);
  if (bot.stuckDetectionInterval) clearInterval(bot.stuckDetectionInterval);
  bot.autoEatInterval = null; bot.protectionInterval = null; bot.stuckDetectionInterval = null;
  console.log("Đã dọn dẹp interval timers.");
});
// *************************************************

// --- Xử lý Ctrl+C ---
// ***** CẢI TIẾN: DỌN DẸP INTERVAL KHI THOÁT *****
// (Giữ nguyên, đã bao gồm stuckDetectionInterval)
process.on("SIGINT", () => {
  console.log("\nĐang ngắt kết nối bot (Ctrl+C)...");

  if (bot.stuckDetectionInterval) clearInterval(bot.stuckDetectionInterval);
  if (bot.autoEatInterval) clearInterval(bot.autoEatInterval);
  if (bot.protectionInterval) clearInterval(bot.protectionInterval);
  bot.stuckDetectionInterval = null; bot.autoEatInterval = null; bot.protectionInterval = null;
  console.log("[SIGINT] Cleared interval timers.");

  stopAllTasks(bot, "Tắt server"); // Truyền bot instance

  const quitMessage = `Bot AI (${bot.botInGameName || BOT_USERNAME}) tạm biệt và thoát game!`;
  try {
    if (bot.player) { bot.chat(quitMessage); }
    else { console.log("(Bot không còn trong game để chat)"); }
  } catch (e) { console.error("Lỗi khi cố gắng chat khi thoát:", e.message); }

  setTimeout(() => {
    try { if (bot?.quit) bot.quit(); } // Kiểm tra bot.quit tồn tại trước khi gọi
    catch (e) { console.error("Lỗi khi gọi bot.quit():", e.message); }
    console.log("Đã ngắt kết nối. Thoát chương trình.");
    process.exit(0);
  }, 1000); // Giữ 1 giây để tin nhắn kịp gửi
});
// ********************************************
// --- END OF FILE bot.js ---