// --- START OF FILE bot.js ---

require("dotenv").config();
const mineflayer = require("mineflayer");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const mcData = require("minecraft-data");
const collectBlock = require('mineflayer-collectblock'); 
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
const homeBuilder = require('./commands/home.js'); 
// ***** THÊM IMPORT MODULE MỚI *****
const autoTorch = require("./commands/auto_torch"); // Import module tự đặt đuốc
const autoDefend = require("./commands/auto_defend"); // Import module tự vệ
// **********************************

const { roundCoord, formatCoords, sleep } = require("./utils"); // Đảm bảo có sleep trong utils

// --- Cấu hình ---
const SERVER_ADDRESS = "dhhnedhhne.aternos.me"; // Thay đổi nếu cần
const SERVER_PORT = 21691; // Thay đổi nếu cần
const BOT_USERNAME = "TuiBucBoi"; // Thay đổi nếu cần
const MINECRAFT_VERSION = "1.21.4"; // Đảm bảo đúng phiên bản

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("LỖI: Không tìm thấy GEMINI_API_KEY trong file .env!");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const aiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

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
  // auth: 'microsoft'
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
bot.autoTorchInterval = null; // <<< THÊM TRẠNG THÁI CHO AUTO TORCH INTERVAL
bot.stuckDetectionInterval = null;
bot.badZones = {};
bot.isDefending = false;
bot.chatHistory = [];
const MAX_CHAT_HISTORY = 10;

// --- Hàm Dừng Tất Cả Nhiệm Vụ ---
// --- Hàm Dừng Tất Cả Nhiệm Vụ (Tối ưu) ---
function stopAllTasks(botInstanceRef, usernameOrReason) {
  let stoppedSomething = false; // Cờ để theo dõi nếu có hành động nào thực sự bị dừng
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

  // --- ƯU TIÊN HÀNH ĐỘNG DỪNG CỐT LÕI ---
  // Các lệnh này nên được gọi đầu tiên để cố gắng dừng hoạt động vật lý ngay lập tức.
  try {
    botInstanceRef.clearControlStates(); // Dừng di chuyển/nhảy/đặt/dùng ngay lập tức
    console.log("[Stop All - Optimized] Cleared control states.");
  } catch (e) {
    console.error(
      "[Stop All - Optimized] Error clearing control states:",
      e.message
    );
  }
  try {
    // Chỉ dừng pathfinder nếu nó đang hoạt động
    if (botInstanceRef.pathfinder?.isMoving()) {
      botInstanceRef.pathfinder.stop(); // Hủy bỏ mục tiêu di chuyển hiện tại
      console.log("[Stop All - Optimized] Explicitly stopped pathfinder.");
    } else {
      // console.log("[Stop All - Optimized] Pathfinder was not moving."); // Bỏ comment nếu muốn debug chi tiết
    }
  } catch (e) {
    console.error(
      "[Stop All - Optimized] Error stopping pathfinder:",
      e.message
    );
  }
  try {
    // An toàn để gọi ngay cả khi không đào, sẽ không gây lỗi
    botInstanceRef.stopDigging();
    // console.log("[Stop All - Optimized] Called stopDigging."); // Bỏ comment nếu muốn debug chi tiết
  } catch (e) {
    /* Bỏ qua lỗi nếu không đang đào */
  }
  try {
    // An toàn để gọi ngay cả khi không dùng item
    botInstanceRef.stopUsingItem();
    // console.log("[Stop All - Optimized] Called stopUsingItem."); // Bỏ comment nếu muốn debug chi tiết
  } catch (e) {
    /* Bỏ qua lỗi nếu không dùng item */
  }
  // ---------------------------------------

  // --- XỬ LÝ AUTO DEFEND ---
  // Logic này được ưu tiên và có điều kiện riêng: chỉ dừng nếu lý do không phải là bị tấn công.
  let autoDefendHandled = false;
  if (botInstanceRef.isDefending) {
    if (reasonText !== "Bị tấn công") {
      if (autoDefend && typeof autoDefend.stopDefending === "function") {
        console.log(
          "[Stop All - Optimized] Stopping auto-defend task (reason not 'Bị tấn công')..."
        );
        autoDefend.stopDefending(reasonText); // Hàm này nên tự đặt isDefending = false
        stoppedSomething = true; // Đã dừng một task quan trọng
      } else {
        console.warn(
          "[Stop All - Optimized] autoDefend module/function not found! Manually resetting flag."
        );
        botInstanceRef.isDefending = false; // Reset cờ thủ công
        stoppedSomething = true; // Vẫn coi là đã dừng một task
      }
      autoDefendHandled = true; // Đã xử lý (dừng hoặc cố gắng dừng)
    } else {
      console.log(
        "[Stop All - Optimized] Auto-defend active due to 'Bị tấn công', not stopping it via general stopAllTasks."
      );
      // KHÔNG dừng autoDefend trong trường hợp này, nhưng vẫn đánh dấu là đã xử lý để logic chat biết
      autoDefendHandled = true;
    }
  }

  // --- DỪNG LOGIC CỤ THỂ CỦA TASK & ĐẶT LẠI CỜ ---
  // Các hàm stop... được gọi DƯỚI ĐÂY nên tập trung vào việc đặt cờ is[Task]ing = false,
  // xóa taskDetails, và dọn dẹp các timers/intervals *của riêng nhiệm vụ đó*.
  // Chúng KHÔNG cần gọi lại các lệnh dừng cốt lõi nữa.

  if (botInstanceRef.isFlattening) {
    console.log("[Stop All - Optimized] Stopping flatten task logic...");
    // Đảm bảo stopFlatten đặt botInstanceRef.isFlattening = false
    stopFlatten(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef.isFinding) {
    console.log("[Stop All - Optimized] Stopping find task logic...");
    // Đảm bảo stopFinding đặt botInstanceRef.isFinding = false
    findCommands.stopFinding(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef.isFollowing) {
    console.log("[Stop All - Optimized] Stopping follow task logic...");
    // Đảm bảo stopFollowing đặt botInstanceRef.isFollowing = false
    followCommands.stopFollowing(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef.isProtecting) {
    console.log("[Stop All - Optimized] Stopping protect task logic...");
    // Đảm bảo stopProtecting đặt botInstanceRef.isProtecting = false và xóa interval
    protectCommands.stopProtecting(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef.isCollecting) {
    console.log("[Stop All - Optimized] Stopping collect task logic...");
    // Đảm bảo stopCollecting đặt botInstanceRef.isCollecting = false
    collectCommands.stopCollecting(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef.isCleaningInventory) {
    console.log(
      "[Stop All - Optimized] Stopping clean inventory task logic..."
    );
    // Đảm bảo stopCleaningInventory đặt botInstanceRef.isCleaningInventory = false
    cleanInventoryCommands.stopCleaningInventory(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef.isStripMining) {
    console.log("[Stop All - Optimized] Stopping strip mine task logic...");
    // Đảm bảo stopStripMining đặt botInstanceRef.isStripMining = false
    stripMineCommands.stopStripMining(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef.isHunting) {
    console.log("[Stop All - Optimized] Stopping hunt task logic...");
    // Đảm bảo stopHunting đặt botInstanceRef.isHunting = false
    huntCommands.stopHunting(botInstanceRef, reasonText);
    stoppedSomething = true;
  }
  if (botInstanceRef.isDepositing) {
    console.log("[Stop All - Optimized] Stopping deposit task logic...");
    // Đảm bảo stopDepositTask đặt botInstanceRef.isDepositing = false
    depositCommands.stopDepositTask(botInstanceRef, reasonText);
    stoppedSomething = true;
  }

  // --- Dừng các task không có hàm stop riêng (chỉ cần set cờ) ---
  if (botInstanceRef.isBuilding) {
    console.log(
      "[Stop All - Optimized] Stopping building task logic (setting flag)."
    );
    botInstanceRef.isBuilding = false;
    botInstanceRef.buildingTaskDetails = null;
    stoppedSomething = true;
  }

  // --- ĐÁNH THỨC BOT ---
  if (botInstanceRef.isSleeping) {
    console.log("[Stop All - Optimized] Waking up bot...");
    try {
      botInstanceRef.wake(); // Sự kiện 'wake' sẽ tự động đặt isSleeping = false
      stoppedSomething = true; // Coi như đã dừng task ngủ thành công (hoặc đang dừng)
    } catch (e) {
      console.error("[Stop All - Optimized] Error waking up bot:", e.message);
      // Nếu wake lỗi, vẫn nên reset cờ để đảm bảo trạng thái đúng
      botInstanceRef.isSleeping = false;
      stoppedSomething = true; // Vẫn tính là đã dừng
    }
  }

  // --- PHẢN HỒI CHAT (Logic được tinh chỉnh) ---
  const silentReasons = [
    "Hệ thống",
    "Lỗi hệ thống",
    "Bot chết",
    "Bị kick",
    "Mất kết nối",
    "Bị kẹt",
    "Bị tấn công", // 'Bị tấn công' là lý do im lặng về mặt chat, dù task khác có thể dừng
  ];
  const userInitiatedStop =
    typeof usernameOrReason === "string" &&
    !silentReasons.includes(usernameOrReason) &&
    !usernameOrReason.startsWith("Lỗi");

  // Chỉ gửi tin nhắn chat nếu bot vẫn còn trong game
  if (botInstanceRef.entity) {
    if (stoppedSomething && userInitiatedStop) {
      // Trường hợp: Có task bị dừng VÀ là do người dùng yêu cầu (không phải lý do im lặng)
      console.log(
        `[Stop All - Optimized] Tasks stopped due to user: ${usernameOrReason}.`
      );
      try {
        botInstanceRef.chat(`Ok ${usernameOrReason}, đã dừng việc đang làm.`);
      } catch (e) {
        console.error(
          "[Stop All - Optimized] Error sending 'stopped task' chat:",
          e
        );
      }
    } else if (
      !stoppedSomething &&
      userInitiatedStop &&
      !botInstanceRef.isDefending
    ) {
      // Trường hợp: KHÔNG có task nào bị dừng VÀ là do người dùng yêu cầu VÀ bot KHÔNG đang tự vệ (vì nếu đang tự vệ thì có thể autoDefend không bị dừng do lý do "Bị tấn công")
      console.log(
        `[Stop All - Optimized] No active task found to stop for user: ${usernameOrReason} (and not defending).`
      );
      try {
        botInstanceRef.chat(
          `Tôi không đang làm gì để dừng cả, ${usernameOrReason}.`
        );
      } catch (e) {
        console.error(
          "[Stop All - Optimized] Error sending 'not doing anything' chat:",
          e
        );
      }
    } else if (
      !stoppedSomething &&
      userInitiatedStop &&
      botInstanceRef.isDefending &&
      !autoDefendHandled
    ) {
      // Trường hợp cạnh: Người dùng yêu cầu dừng, không có task nào khác dừng, bot đang phòng thủ, NHƯNG autoDefend không được xử lý (ví dụ: lỗi logic) -> Thông báo không làm gì
      console.log(
        `[Stop All - Optimized] No other task stopped, auto-defend was active but not explicitly handled by stop request for user: ${usernameOrReason}.`
      );
      try {
        botInstanceRef.chat(
          `Tôi không đang làm gì khác ngoài phòng thủ để dừng, ${usernameOrReason}.`
        );
      } catch (e) {
        console.error(
          "[Stop All - Optimized] Error sending 'not doing anything else' chat:",
          e
        );
      }
    } else if (stoppedSomething) {
      // Trường hợp: Có task bị dừng nhưng là do hệ thống/sự kiện (hoặc lý do im lặng)
      console.log(
        `[Stop All - Optimized] Tasks stopped due to system/event: ${reasonText}. (No chat message sent)`
      );
      // Không cần chat trong trường hợp này
    }
  } else {
    console.log(
      "[Stop All - Optimized] Bot entity does not exist. Cannot send chat message."
    );
  }

  console.log("[Stop All - Optimized] Finished processing stop request.");
}

// --- Sự kiện Bot Spawn ---
bot.once("spawn", () => {
  bot.botInGameName = bot.username;
  console.log(`*** Bot (${bot.botInGameName}) đã vào server! ***`);
  const startPos = bot.entity.position;
  console.log(`Vị trí: ${formatCoords(startPos)}`);

  // Reset trạng thái
  bot.isFollowing = false;
  bot.followingTarget = null;
  bot.isFinding = false;
  bot.findingTaskDetails = null;
  bot.isProtecting = false;
  bot.protectingTarget = null;
  if (bot.protectionInterval) clearInterval(bot.protectionInterval);
  bot.protectionInterval = null;
  bot.isCollecting = false;
  bot.collectingTaskDetails = null;
  bot.isStripMining = false;
  bot.stripMineTaskDetails = null;
  bot.isCleaningInventory = false;
  bot.cleaningTaskDetails = null;
  bot.isHunting = false;
  bot.huntTaskDetails = null;
  bot.isDepositing = false;
  bot.depositTaskDetails = null;
  bot.isSleeping = false;
  bot.isBuilding = false;
  bot.buildingTaskDetails = null;
  bot.waypoints = bot.waypoints || {};
  bot.isFlattening = false;
  bot.flattenStopRequested = false;
  bot.flattenTemporaryChests = [];
  if (bot.stuckDetectionInterval) clearInterval(bot.stuckDetectionInterval);
  bot.stuckDetectionInterval = null;
  if (bot.autoTorchInterval) clearInterval(bot.autoTorchInterval);
  bot.autoTorchInterval = null; // <<< RESET AUTO TORCH INTERVAL
  bot.badZones = {};
  bot.isDefending = false;

  // --- Cấu hình Pathfinder & Movements ---
  try {
    const currentMcData = mcData(bot.version);
    if (!currentMcData)
      throw new Error("Không thể tải mcData cho phiên bản này!");

    if (bot.pathfinder) {
      bot.pathfinder.thinkTimeout = 10000;
      console.log(
        `[Pathfinder Config] Set thinkTimeout to ${bot.pathfinder.thinkTimeout}ms.`
      );
    } else {
      console.warn(
        "[Pathfinder Config] bot.pathfinder not available at spawn time for setting thinkTimeout."
      );
    }

    bot.defaultMove = new Movements(bot, currentMcData);
    console.log("[Movements Config] Applying custom settings...");
    bot.defaultMove.allowSprinting = true;
    console.log(`  - allowSprinting: ${bot.defaultMove.allowSprinting}`);
    bot.defaultMove.allowParkour = true;
    console.log(`  - allowParkour: ${bot.defaultMove.allowParkour}`);
    bot.defaultMove.canDig = true;
    console.log(`  - canDig: ${bot.defaultMove.canDig}`);
    bot.defaultMove.maxDropDown = 4;
    console.log(`  - maxDropDown: ${bot.defaultMove.maxDropDown}`);
    bot.defaultMove.allow1by1towers = false;
    console.log(`  - allow1by1towers: ${bot.defaultMove.allow1by1towers}`);
    bot.defaultMove.canPlace = true;
    console.log(`  - canPlace: ${bot.defaultMove.canPlace}`);

    if (!bot.defaultMove.blocksToPlace) {
      console.warn(
        "[Movements Config] bot.defaultMove.blocksToPlace was not initialized. Creating a new Set."
      );
      bot.defaultMove.blocksToPlace = new Set();
    }
    const scaffoldBlocks = [
      "dirt",
      "cobblestone",
      "netherrack",
      "cobbled_deepslate",
      "stone",
      "oak_planks",
      "spruce_planks",
      "birch_planks",
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

    const blocksToAvoidNames = [
      "lava",
      "fire",
      "cactus",
      "sweet_berry_bush",
      "powder_snow",
      "magma_block",
    ];
    if (!bot.defaultMove.blocksToAvoid) {
      bot.defaultMove.blocksToAvoid = new Set();
    }
    blocksToAvoidNames.forEach((name) => {
      const block = currentMcData.blocksByName[name];
      if (block) bot.defaultMove.blocksToAvoid.add(block.id);
    });
    console.log(
      `  - Blocks to avoid IDs: ${[...bot.defaultMove.blocksToAvoid].join(
        ", "
      )}`
    );

    const blocksCantBreakNames = [
      "chest",
      "ender_chest",
      "furnace",
      "blast_furnace",
      "smoker",
      "crafting_table",
      "enchanting_table",
      "anvil",
      "beacon",
      "bed",
      "respawn_anchor",
    ];
    if (!bot.defaultMove.blocksCantBreak) {
      bot.defaultMove.blocksCantBreak = new Set();
    }
    blocksCantBreakNames.forEach((name) => {
      const block = currentMcData.blocksByName[name];
      if (block) bot.defaultMove.blocksCantBreak.add(block.id);
    });
    console.log(
      `  - Blocks cant break IDs: ${[...bot.defaultMove.blocksCantBreak].join(
        ", "
      )}`
    );

    if (bot.pathfinder) {
      bot.pathfinder.setMovements(bot.defaultMove);
      console.log(
        "[Pathfinder] Đã khởi tạo và thiết lập Movements (parkour: true, thinkTimeout: 10s, 1x1towers: false)."
      );
    } else {
      console.error("[Lỗi Khởi tạo Pathfinder] bot.pathfinder không tồn tại!");
    }
  } catch (err) {
    console.error("[Lỗi Khởi tạo Pathfinder/Movements]:", err);
  }

  // --- Phát hiện kẹt ---
  let lastPosStuckCheck = null;
  let stuckCounter = 0;
  const STUCK_THRESHOLD = 0.08;
  const STUCK_TIMEOUT_COUNT = 12;
  bot.stuckDetectionInterval = setInterval(() => {
    if (bot.pathfinder && bot.pathfinder.isMoving() && bot.entity?.position) {
      const currentPos = bot.entity.position;
      if (
        lastPosStuckCheck &&
        currentPos.distanceTo(lastPosStuckCheck) < STUCK_THRESHOLD
      ) {
        stuckCounter++;
        if (stuckCounter >= STUCK_TIMEOUT_COUNT) {
          console.warn(
            `[Stuck Detector] Bot có vẻ bị kẹt tại ${formatCoords(
              currentPos
            )}! Đang dừng nhiệm vụ hiện tại.`
          );
          try {
            bot.chat("Ối, hình như tôi bị kẹt rồi! Đang dừng lại.");
          } catch (e) {
            console.error("Error sending stuck chat:", e);
          }
          stopAllTasks(bot, "Bị kẹt");
          stuckCounter = 0;
          lastPosStuckCheck = null;
        }
      } else {
        stuckCounter = 0;
      }
      lastPosStuckCheck = currentPos.clone();
    } else {
      stuckCounter = 0;
      lastPosStuckCheck = null;
    }
  }, 500);
  console.log(
    `[System] Đã kích hoạt kiểm tra kẹt di chuyển (Threshold: ${STUCK_THRESHOLD}, Timeout: ${
      STUCK_TIMEOUT_COUNT * 500
    }ms).`
  );

  // --- Khởi tạo các module tự động ---
  eventNotifierCommands.initializeEventNotifier(bot);
  autoEatCommands.initializeAutoEat(bot);
  autoTorch.initializeAutoTorch(bot, aiModel);
  autoDefend.initializeAutoDefend(bot, stopAllTasks);

  // <<< BẮT ĐẦU INTERVAL TỰ ĐỘNG ĐẶT ĐUỐC >>>
  if (bot.autoTorchInterval) clearInterval(bot.autoTorchInterval); // Xóa interval cũ nếu có

  const AUTO_TORCH_INTERVAL_MS = 2500; // Kiểm tra mỗi 2.5 giây

  bot.autoTorchInterval = setInterval(async () => {
    // Chỉ chạy nếu bot tồn tại, không ngủ, không phòng thủ, và autoTorch không đang xử lý
    if (
      bot?.entity &&
      !bot.isSleeping &&
      !bot.isDefending &&
      !autoTorch.isPlacingTorch
    ) {
      try {
        // console.log("[Auto Torch Interval] Checking light levels..."); // Bỏ comment nếu muốn debug
        await autoTorch.checkAndPlaceTorch(); // Gọi hàm kiểm tra và đặt đuốc
      } catch (error) {
        console.error(
          "[Auto Torch Interval] Lỗi khi tự động kiểm tra/đặt đuốc:",
          error.message
        );
      }
    }
  }, AUTO_TORCH_INTERVAL_MS);
  console.log(
    `[System] Đã kích hoạt tự động kiểm tra và đặt đuốc (Interval: ${AUTO_TORCH_INTERVAL_MS}ms).`
  );
  // <<< KẾT THÚC INTERVAL TỰ ĐỘNG ĐẶT ĐUỐC >>>

  // Chào hỏi
  setTimeout(() => {
    try {
      bot.chat(
        `Bot AI (${bot.botInGameName}) đã kết nối! Hỏi gì đi nào? :D (Gõ 'bạn làm được gì?' để xem danh sách lệnh)`
      );
    } catch (e) {
      console.error("Error sending initial chat message:", e);
    }
  }, 1500);

  // --- Lắng nghe sự kiện Pathfinder ---
  const pathfinderEvents = [
    "goal_reached",
    "path_reset",
    "cannotFindPath",
    "interrupted",
    "goal_non_reachable",
  ];
  pathfinderEvents.forEach((eventName) => {
    bot.on(eventName, (...args) => {
      const reason = args[0]?.message || args[0] || eventName;
     
    

      const isPathError =
        eventName === "cannotFindPath" ||
        eventName === "goal_non_reachable" ||
        eventName === "interrupted";

      if (isPathError) {
        console.error(`[Pathfinder Error Detected] Reason: ${reason}`);
        // Xử lý lỗi cụ thể cho từng task
        if (bot.isFinding && findCommands.handleFindPathError) {
          findCommands.handleFindPathError(bot, reason);
        } else if (
          bot.isCleaningInventory &&
          cleanInventoryCommands.finishCleaningInventory
        ) {
          cleanInventoryCommands.finishCleaningInventory(
            bot,
            false,
            `Không thể đến nơi vứt đồ: ${reason}`
          );
        } else if (bot.isDepositing && depositCommands.stopDepositTask) {
          depositCommands.stopDepositTask(
            bot,
            `Lỗi di chuyển đến rương: ${reason}`
          );
        } else if (bot.isCollecting && bot.collectingTaskDetails) {
          const targetPos = bot.collectingTaskDetails.currentTarget?.position;
          const currentPos = bot.entity.position;
          if (targetPos && targetPos.y > currentPos.y + 1.5) {
            console.error(
              `[Collect Path Error] Không thể đến khối ${
                bot.collectingTaskDetails.itemNameVi
              } ở trên cao (${formatCoords(
                targetPos
              )}). Lý do: ${reason}. Thử tìm khối khác.`
            );
            try {
              bot.chat(
                `Tôi không lên được chỗ khối ${bot.collectingTaskDetails.itemNameVi} đó, tìm khối khác vậy.`
              );
            } catch (e) {
              console.error("Error sending collect path error chat:", e);
            }
            bot.collectingTaskDetails.currentTarget = null;
            bot.collectingTaskDetails.status = "idle";
          } else {
            console.warn(
              `[Collect Path Error] Lỗi di chuyển khi thu thập: ${reason}. Vòng lặp collect sẽ thử tìm khối khác.`
            );
            bot.collectingTaskDetails.currentTarget = null;
            bot.collectingTaskDetails.status = "idle";
          }
        } else if (bot.isStripMining && stripMineCommands.stopStripMining) {
          stripMineCommands.stopStripMining(
            bot,
            `Lỗi di chuyển khi đào hầm: ${reason}`
          );
        } else if (bot.isHunting && huntCommands.stopHunting) {
          huntCommands.stopHunting(bot, `Lỗi di chuyển khi săn bắn: ${reason}`);
        } else if (bot.isBuilding && homeCommands.handleBuildPathError) {
          homeCommands.handleBuildPathError(bot, reason);
        } else if (bot.isFlattening) {
          console.warn(
            `[Flatten Path Error] Lỗi di chuyển khi làm phẳng: ${reason}. Dừng làm phẳng.`
          );
          stopFlatten(bot, `Lỗi di chuyển: ${reason}`);
        } else if (bot.pathfinder?.isMoving() && !bot.isDefending) {
          // Chỉ dừng nếu *không* đang tự vệ
          console.warn(
            `[Pathfinder Error] Lỗi khi đang di chuyển tự do (không phòng thủ): ${reason}. Dừng di chuyển.`
          );
          stopAllTasks(bot, `Lỗi di chuyển: ${reason}`);
        } else if (bot.isDefending && isPathError) {
          console.warn(
            `[Pathfinder Error] Lỗi di chuyển khi đang phòng thủ: ${reason}. (Auto Defend logic sẽ xử lý)`
          );
        }
      }

      // Xử lý goal_reached cho task finding
      if (
        bot.isFinding &&
        eventName === "goal_reached" &&
        findCommands.handleFindGoalReached
      ) {
        findCommands.handleFindGoalReached(bot);
      }
    });
  });

  // --- Các sự kiện Bot khác ---
  bot.on("sleep", () => {
    console.log("[Event] Bot đã ngủ thành công.");
    bot.isSleeping = true;
    try {
      bot.chat("Khò khò... Zzzz");
    } catch (e) {}
  });
  bot.on("wake", () => {
    console.log("[Event] Bot đã thức dậy.");
    bot.isSleeping = false;
  });
  bot.on("death", () => {
    console.error("!!! BOT ĐÃ CHẾT !!!");
    try {
      bot.chat("Ối! Tôi chết mất rồi... :(");
    } catch (e) {}
    stopAllTasks(bot, "Bot chết");
  });
  bot.on("health", () => {
    /* Có thể log máu/đói */
  });
});

// --- Xử lý Tin nhắn Chat ---
bot.on("chat", async (username, message) => {
  if (username === bot.username || !message) return;
  try {
    const timestamp = new Date().toLocaleTimeString();
    const historyEntry = `[${timestamp}] <${username}> ${message}`;
    bot.chatHistory.push(historyEntry);
    if (bot.chatHistory.length > MAX_CHAT_HISTORY) {
      bot.chatHistory.shift();
    }
  } catch (histError) {
    console.error("Error adding to chat history:", histError);
  }

  const trimmedMessage = message.trim();
  const lowerMessage = trimmedMessage.toLowerCase();
  console.log(`[Chat In] <${username}> ${trimmedMessage}`);
  if (!trimmedMessage) return;

  // --- Kiểm tra lệnh dừng ---
  const isBusy =
    bot.isFinding ||
    bot.isFollowing ||
    bot.isProtecting ||
    bot.isDefending ||
    bot.isCollecting ||
    bot.isSleeping ||
    bot.isStripMining ||
    bot.isHunting ||
    bot.isCleaningInventory ||
    bot.isDepositing ||
    bot.isBuilding ||
    bot.isFlattening;
  const stopKeywords = [
    "dừng",
    "stop",
    "hủy",
    "cancel",
    "thôi",
    "dừng lại",
    "dậy đi",
    "ngừng",
  ];
  if (
    (isBusy || bot.pathfinder?.isMoving()) &&
    stopKeywords.some((k) => lowerMessage.includes(k))
  ) {
    console.log(`[Manual Stop] User ${username} requested stop/wake.`);
    stopAllTasks(bot, username);
    return;
  }

  // --- Xử lý xác nhận cho lệnh Find ---
  if (
    bot.isFinding &&
    bot.findingTaskDetails?.waitingForConfirmation &&
    username === bot.findingTaskDetails.username
  ) {
    const confirmKeywords = [
      "tiếp",
      "ok",
      "oke",
      "có",
      "yes",
      "uh",
      "ừ",
      "di",
      "đi",
      "continue",
      "proceed",
      "tìm tiếp",
    ];
    const cancelKeywords = [
      "dừng",
      "thôi",
      "hủy",
      "stop",
      "cancel",
      "ko",
      "không",
      "no",
      "khong",
      "đủ rồi",
    ];
    let confirmed = confirmKeywords.some((k) => lowerMessage.includes(k));
    let cancelled =
      !confirmed && cancelKeywords.some((k) => lowerMessage.includes(k));
    if (confirmed) {
      findCommands.proceedToNextTarget(bot);
    } else if (cancelled) {
      stopAllTasks(bot, username);
    } else {
      try {
        bot.chat(`${username}, nói 'tiếp' để đi tiếp hoặc 'dừng' để hủy nhé.`);
      } catch (e) {
        console.error("Error sending find confirmation chat:", e);
      }
    }
    return;
  }

  // --- Phân loại ý định và thực thi lệnh ---
  try {
    const classificationPrompt = `**Nhiệm vụ:** Phân loại ý định chính trong tin nhắn của người chơi gửi cho bot Minecraft.\n\n**Ngữ cảnh:**\n*   Người gửi: "${username}"\n*   Người nhận (Bot): "${bot.botInGameName}"\n*   Tin nhắn gốc: "${trimmedMessage}"\n\n**Yêu cầu:**\nChọn MỘT loại ý định phù hợp NHẤT từ danh sách dưới đây cho tin nhắn trên.\n\n**Danh sách các loại ý định:**\n*   GET_BOT_COORDS: Hỏi tọa độ của bot.\n*   GET_ENTITY_COORDS: Hỏi tọa độ của thực thể khác.\n*   FOLLOW_PLAYER: Yêu cầu đi theo người chơi.\n*   FIND_BLOCK: Yêu cầu tìm kiếm block và mob \n*   CHECK_INVENTORY: Yêu cầu liệt kê túi đồ.\n*   GIVE_ITEM: Yêu cầu đưa đồ.\n*   PROTECT_PLAYER: Yêu cầu bảo vệ người chơi.\n*   COLLECT_BLOCK: Yêu cầu thu thập block.\n*   GOTO_COORDS: Yêu cầu đi đến tọa độ.\n*   SCAN_ORES: Yêu cầu quét quặng.\n*   SAVE_WAYPOINT: Yêu cầu lưu điểm.\n*   GOTO_WAYPOINT: Yêu cầu đi đến điểm đã lưu.\n*   FLATTEN_AREA: Yêu cầu làm phẳng khu vực.\n*   LIST_WAYPOINTS: Yêu cầu liệt kê điểm đã lưu.\n*   DELETE_WAYPOINT: Yêu cầu xóa điểm đã lưu.\n*   BREED_ANIMALS: Yêu cầu cho thú giao phối.\n*   CRAFT_ITEM: Yêu cầu chế tạo đồ.\n*   GO_TO_SLEEP: Yêu cầu đi ngủ.\n*   STRIP_MINE: Yêu cầu đào hầm.\n*   HUNT_MOB: Yêu cầu đi săn, đi giết mob (không phải tìm kiếm).\n*   BUILD_HOUSE: Yêu cầu xây nhà.\n*   CLEAN_INVENTORY: Yêu cầu dọn túi đồ.\n*   DEPOSIT_ITEMS: Yêu cầu cất đồ vào rương theo loại.\n*   EQUIP_ITEM: Yêu cầu trang bị/cầm đồ.\n*   LIST_CAPABILITIES: Hỏi khả năng/lệnh.\n*   STOP_TASK: Yêu cầu dừng việc đang làm.\n*   GENERAL_CHAT: Trò chuyện thông thường.\n*   IGNORE: Tin nhắn không rõ nghĩa/không liên quan.\n\n**Phân loại cho tin nhắn sau:**\n"${trimmedMessage}"\n\n**Loại ý định là:**`;

    console.log(`[AI Intent] Gửi prompt phân loại...`);
    const intentResult = await aiModel.generateContent(classificationPrompt);
    const intentClassification = (await intentResult.response.text())
      .trim()
      .toUpperCase()
      .replace(/[^A-Z_]/g, "");
    console.log(
      `[AI Intent] Phân loại: "${intentClassification}" (Tin nhắn gốc: "${trimmedMessage}")`
    );

    // --- Kiểm tra nếu bot đang bận ---
    const nonBlockingIntents = [
      "GET_BOT_COORDS",
      "GET_ENTITY_COORDS",
      "CHECK_INVENTORY",
      "SCAN_ORES",
      "LIST_WAYPOINTS",
      "LIST_CAPABILITIES",
      "GENERAL_CHAT",
      "IGNORE",
      "STOP_TASK",
    ];
    if (isBusy && !nonBlockingIntents.includes(intentClassification)) {
      let reason = bot.isFinding
        ? "tìm đồ"
        : bot.isFollowing
        ? "đi theo"
        : bot.isProtecting
        ? "bảo vệ"
        : bot.isDefending
        ? "phòng thủ"
        : bot.isCollecting
        ? "thu thập"
        : bot.isSleeping
        ? "ngủ"
        : bot.isStripMining
        ? "đào hầm"
        : bot.isHunting
        ? "săn bắn"
        : bot.isCleaningInventory
        ? "dọn túi đồ"
        : bot.isDepositing
        ? "cất đồ"
        : bot.isBuilding
        ? "xây nhà"
        : bot.isFlattening
        ? "làm phẳng"
        : "làm việc khác";
      try {
        bot.chat(
          `${username}, tôi đang bận ${reason} rồi! Nói 'dừng' nếu muốn tôi hủy việc đang làm.`
        );
      } catch (e) {
        console.error("Error sending busy chat:", e);
      }
      console.log(
        `[Action Blocked] Intent ${intentClassification} blocked because bot is busy (${reason}).`
      );
      return;
    }

    // --- Thực thi lệnh ---
    switch (intentClassification) {
      case "GET_BOT_COORDS":
        coordsCommands.getBotCoords(bot, username);
        break;
      case "GET_ENTITY_COORDS":
        await coordsCommands.getEntityCoords(
          bot,
          username,
          trimmedMessage,
          aiModel
        );
        break;
        case "BUILD_HOUSE":
          bot.isBuilding = true;
          try {
            // Bây giờ homeBuilder đã được định nghĩa và có thể gọi hàm
            await homeBuilder.startDefaultHouseBuild(bot, username);
          } catch (buildError) {
             console.error("Lỗi xảy ra khi gọi hàm xây nhà:", buildError);
             bot.chat(`Rất tiếc ${username}, đã có lỗi khi bắt đầu xây nhà: ${buildError.message}`);
             bot.isBuilding = false; // Reset trạng thái nếu có lỗi
          }
          break;
      case "FOLLOW_PLAYER":
        followCommands.startFollowing(bot, username);
        break;
      case "FLATTEN_AREA":
        await flattenArea(bot, username, trimmedMessage, aiModel);
        break;
      case "FIND_BLOCK":
        await findCommands.startFindingTask(
          bot,
          username,
          trimmedMessage,
          aiModel
        );
        break;
      case "CHECK_INVENTORY":
        inventoryCommands.checkInventory(bot, username);
        break;
      case "GIVE_ITEM":
        await inventoryCommands.giveItem(
          bot,
          username,
          trimmedMessage,
          aiModel
        );
        break;
      case "PROTECT_PLAYER":
        await protectCommands.startProtecting(bot, username);
        break;
      case "COLLECT_BLOCK":
        await collectCommands.startCollectingTask(
          bot,
          username,
          trimmedMessage,
          aiModel
        );
        break;
      case "GOTO_COORDS":
        await navigateCommands.goToCoordinates(
          bot,
          username,
          trimmedMessage,
          aiModel
        );
        break;
      case "SCAN_ORES":
        await scanCommands.scanNearbyOres(bot, username);
        break;
      case "SAVE_WAYPOINT":
        await navigateCommands.saveWaypoint(
          bot,
          username,
          trimmedMessage,
          aiModel
        );
        break;
      case "GOTO_WAYPOINT":
        await navigateCommands.goToWaypoint(
          bot,
          username,
          trimmedMessage,
          aiModel
        );
        break;
      case "LIST_WAYPOINTS":
        navigateCommands.listWaypoints(bot, username);
        break;
      case "DELETE_WAYPOINT":
        await navigateCommands.deleteWaypoint(
          bot,
          username,
          trimmedMessage,
          aiModel
        );
        break;
      case "BREED_ANIMALS":
        await farmCommands.breedAnimals(bot, username, trimmedMessage, aiModel);
        break;
      case "CRAFT_ITEM":
        await craftCommands.craftItem(bot, username, trimmedMessage, aiModel);
        break;
      case "GO_TO_SLEEP":
        await sleepCommands.goToSleep(bot, username);
        break;
      case "STRIP_MINE":
        await stripMineCommands.startStripMiningTask(
          bot,
          username,
          trimmedMessage,
          aiModel
        );
        break; // Không cần gọi autoTorch ở đây nữa
      case "HUNT_MOB":
        await huntCommands.startHuntingTask(
          bot,
          username,
          trimmedMessage,
          aiModel
        );
        break;
      case "CLEAN_INVENTORY":
        await cleanInventoryCommands.startCleaningInventory(bot, username);
        break;
      case "DEPOSIT_ITEMS":
        await depositCommands.startDepositTask(
          bot,
          username,
          trimmedMessage,
          aiModel
        );
        break;
      case "EQUIP_ITEM":
        await equipCommands.startEquipItemTask(
          bot,
          username,
          trimmedMessage,
          aiModel
        );
        break;
      case "LIST_CAPABILITIES":
        infoCommands.listCapabilities(bot, username);
        break;
      case "STOP_TASK":
        console.log(
          `[Action] Intent STOP_TASK recognized. Initiating stop via AI fallback for ${username}.`
        ); // Log rõ hơn
        stopAllTasks(bot, username); // <<< THÊM LỆNH GỌI DỪNG Ở ĐÂY
        break; // Kết thúc case      case "GENERAL_CHAT": await chatCommands.handleGeneralChat( bot, username, trimmedMessage, aiModel ); break;
      case "IGNORE":
        console.log(
          `[Action] Bỏ qua tin nhắn từ ${username} theo phân loại AI.`
        );
        break;
      default:
        console.warn(
          `[Action] Không rõ ý định từ AI: "${intentClassification}". Fallback sang General Chat.`
        );
        await chatCommands.handleGeneralChat(
          bot,
          username,
          trimmedMessage,
          aiModel
        );
        break;
    }
  } catch (error) {
    console.error("[AI/Chat Processing] Lỗi nghiêm trọng:", error);
    bot.isBuilding = false;
    bot.isFinding = false;
    bot.isFlattening = false;
    bot.isDefending = false;
    stopAllTasks(bot, "Lỗi hệ thống");
    try {
      bot.chat(
        `Ui, đầu tôi lag quá ${username} ơi, lỗi rồi! (${error.message})`
      );
    } catch (sendError) {
      console.error("[Chat Error] Lỗi gửi tin nhắn báo lỗi:", sendError);
    }
  }
});

// --- Xử lý Lỗi và Kết thúc ---
bot.on("error", (err) => {
  console.error("!!! LỖI BOT:", err);
});
bot.on("kicked", (reason) => {
  console.error("--- Bot bị kick ---");
  try {
    console.error("Lý do (JSON):", JSON.parse(reason));
  } catch {
    console.error("Lý do:", reason);
  }
  stopAllTasks(bot, "Bị kick");
});

// --- Dọn dẹp Interval khi kết thúc ---
bot.on("end", (reason) => {
  console.log("--- Kết nối bot kết thúc ---");
  console.log("Lý do:", reason);
  if (bot.autoEatInterval) clearInterval(bot.autoEatInterval);
  if (bot.protectionInterval) clearInterval(bot.protectionInterval);
  if (bot.stuckDetectionInterval) clearInterval(bot.stuckDetectionInterval);
  if (bot.autoTorchInterval) clearInterval(bot.autoTorchInterval); // <<< DỌN DẸP AUTO TORCH
  bot.autoEatInterval = null;
  bot.protectionInterval = null;
  bot.stuckDetectionInterval = null;
  bot.autoTorchInterval = null; // <<< DỌN DẸP AUTO TORCH
  console.log("Đã dọn dẹp interval timers.");
});

// --- Ghi lại tin nhắn hệ thống vào lịch sử chat ---
bot.on("messagestr", (message, messagePosition, jsonMsg) => {
  if (messagePosition !== "chat") {
    try {
      const timestamp = new Date().toLocaleTimeString();
      const historyEntry = `[${timestamp}] [System] ${message}`;
      bot.chatHistory.push(historyEntry);
      if (bot.chatHistory.length > MAX_CHAT_HISTORY) {
        bot.chatHistory.shift();
      }
    } catch (histError) {
      console.error("Error adding system message to chat history:", histError);
    }
  }
});

// --- Xử lý Ctrl+C ---
process.on("SIGINT", () => {
  console.log("\nĐang ngắt kết nối bot (Ctrl+C)...");

  if (bot.stuckDetectionInterval) clearInterval(bot.stuckDetectionInterval);
  if (bot.autoEatInterval) clearInterval(bot.autoEatInterval);
  if (bot.protectionInterval) clearInterval(bot.protectionInterval);
  if (bot.autoTorchInterval) clearInterval(bot.autoTorchInterval); // <<< DỌN DẸP AUTO TORCH
  bot.stuckDetectionInterval = null;
  bot.autoEatInterval = null;
  bot.protectionInterval = null;
  bot.autoTorchInterval = null; // <<< DỌN DẸP AUTO TORCH
  console.log("[SIGINT] Cleared interval timers.");

  stopAllTasks(bot, "Tắt server");

  const quitMessage = `Bot AI (${
    bot.botInGameName || BOT_USERNAME
  }) tạm biệt và thoát game!`;
  try {
    if (bot.player) {
      bot.chat(quitMessage);
    } else {
      console.log("(Bot không còn trong game để chat)");
    }
  } catch (e) {
    console.error("Lỗi khi cố gắng chat khi thoát:", e.message);
  }

  setTimeout(() => {
    try {
      if (bot?.quit) bot.quit();
    } catch (e) {
      console.error("Lỗi khi gọi bot.quit():", e.message);
    }
    console.log("Đã ngắt kết nối. Thoát chương trình.");
    process.exit(0);
  }, 1000);
});

// --- END OF FILE bot.js ---
