require("dotenv").config();
const mineflayer = require("mineflayer");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
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
const eventNotifierCommands = require("./event_notifier");
const autoEatCommands = require("./auto_eat");

const { roundCoord, formatCoords } = require("./utils");

const SERVER_ADDRESS = "dhhnedhhne.aternos.me";
const SERVER_PORT = 21691;
const BOT_USERNAME = "GeminiBot";
const MINECRAFT_VERSION = "1.21.4";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("LỖI: Không tìm thấy GEMINI_API_KEY trong file .env!");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const aiModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

console.log(`Đang kết nối tới ${SERVER_ADDRESS}:${SERVER_PORT}...`);
console.log(`Tên bot: ${BOT_USERNAME}, Phiên bản: ${MINECRAFT_VERSION}`);

const bot = mineflayer.createBot({
  host: SERVER_ADDRESS,
  port: SERVER_PORT,
  username: BOT_USERNAME,
  version: MINECRAFT_VERSION,
  hideErrors: true,
});

bot.loadPlugin(pathfinder);
console.log("Đã tạo bot. Bắt đầu kết nối...");

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
bot.isCleaningInventory = false; // <<< THÊM
bot.cleaningTaskDetails = null;
bot.waypoints = {};
bot.autoEatInterval = null;

function stopAllTasks(bot, usernameOrReason) {
  let stoppedSomething = false;
  console.log(
    `[Stop All] Received stop request from/reason: ${usernameOrReason}`
  );

  if (bot.isFinding) {
    findCommands.stopFinding(bot);
    stoppedSomething = true;
  }
  if (bot.isFollowing) {
    followCommands.stopFollowing(bot, usernameOrReason);
    stoppedSomething = true;
  }
  if (bot.isProtecting) {
    protectCommands.stopProtecting(bot, usernameOrReason);
    stoppedSomething = true;
  }
  if (bot.isCollecting) {
    collectCommands.stopCollecting(bot, usernameOrReason);
    stoppedSomething = true;
  }
  if (bot.isCleaningInventory) {
    cleanInventoryCommands.stopCleaningInventory(bot, usernameOrReason);
    stoppedSomething = true;
  }
  if (bot.isStripMining) {
    stripMineCommands.stopStripMining(bot, usernameOrReason);
    stoppedSomething = true;
  }
  if (bot.isHunting) {
    huntCommands.stopHunting(bot, usernameOrReason);
    stoppedSomething = true;
  }

  if (bot.isSleeping) {
    try {
      bot.wake();
      console.log("[Stop All] Woke up bot.");
      if (!stoppedSomething) {
        if (
          typeof usernameOrReason === "string" &&
          usernameOrReason !== "Hệ thống" &&
          usernameOrReason !== "Lỗi"
        ) {
          bot.chat(`Ok ${usernameOrReason}, dậy thôi!`);
        } else {
          bot.chat("Dậy thôi!");
        }
      }
      stoppedSomething = true;
    } catch (e) {
      console.error("[Stop All] Error waking up bot:", e);
    }
  }

  if (bot.pathfinder?.isMoving()) {
    try {
      bot.pathfinder.stop();
      console.log("[Stop All] Explicitly stopped pathfinder.");
      if (!stoppedSomething) {
        if (
          typeof usernameOrReason === "string" &&
          usernameOrReason !== "Hệ thống" &&
          usernameOrReason !== "Lỗi"
        ) {
          bot.chat(`Ok ${usernameOrReason}, đã dừng di chuyển.`);
        } else {
          bot.chat("Đã dừng di chuyển.");
        }
      }
      stoppedSomething = true;
    } catch (e) {
      console.error("[Stop All] Error stopping pathfinder:", e);
    }
  }

  if (
    !stoppedSomething &&
    typeof usernameOrReason === "string" &&
    usernameOrReason !== "Hệ thống" &&
    usernameOrReason !== "Lỗi"
  ) {
    bot.chat(`Tôi không đang làm gì để dừng cả ${usernameOrReason}.`);
  } else if (
    stoppedSomething &&
    typeof usernameOrReason === "string" &&
    usernameOrReason !== "Hệ thống" &&
    usernameOrReason !== "Lỗi"
  ) {
    console.log(`[Stop All] Task stopped by ${usernameOrReason}.`);
  }
}

bot.once("spawn", () => {
  bot.botInGameName = bot.username;
  console.log(`*** Bot (${bot.botInGameName}) đã vào server! ***`);
  const startPos = bot.entity.position;
  console.log(`Vị trí: ${formatCoords(startPos)}`);

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
  bot.isCleaningInventory = false; // <<< THÊM
  bot.cleaningTaskDetails = null;
  bot.isHunting = false;
  bot.huntTaskDetails = null;
  bot.waypoints = bot.waypoints || {}; // Giữ lại waypoints nếu bot chỉ relog

  try {
    const mcData = require("minecraft-data")(bot.version);
    bot.defaultMove = new Movements(bot, mcData);
    if (bot.pathfinder) {
      bot.pathfinder.setMovements(bot.defaultMove);
      console.log("[Pathfinder] Đã khởi tạo và thiết lập Movements.");
    } else {
      console.error("[Lỗi Khởi tạo Pathfinder] bot.pathfinder không tồn tại!");
    }
  } catch (err) {
    console.error("[Lỗi Khởi tạo Pathfinder] Không thể tạo Movements:", err);
  }

  eventNotifierCommands.initializeEventNotifier(bot);
  autoEatCommands.initializeAutoEat(bot);

  setTimeout(() => {
    bot.chat(
      `Bot AI (${bot.botInGameName}) đã kết nối! Hỏi gì đi nào? :D (Gõ 'bạn làm được gì?' để xem danh sách lệnh)`
    );
  }, 1500);

  setInterval(() => {
    if (
      !bot.pathfinder?.isMoving() &&
      !bot.isFollowing &&
      !bot.isFinding &&
      !bot.isProtecting &&
      !bot.isCollecting &&
      !bot.isSleeping &&
      !bot.isStripMining &&
      !bot.isHunting &&
      !bot.isCleaningInventory
    ) {
      // <<< THÊM isCleaningInventory
      // bot.chat(".");
    }
  }, 2 * 60 * 1000);
  const pathfinderEvents = [
    "goal_reached",
    "path_update",
    "path_reset",
    "cannotFindPath",
    "interrupted",
    "goal_non_reachable",
  ];
  pathfinderEvents.forEach((eventName) => {
    bot.on(eventName, (...args) => {
      console.log(
        `\n[BOT EVENT RECEIVED] Event: ${eventName}, State: F=${bot.isFinding}, Fl=${bot.isFollowing}, P=${bot.isProtecting}, C=${bot.isCollecting}, S=${bot.isSleeping}, M=${bot.isStripMining}, H=${bot.isHunting}, Cl=${bot.isCleaningInventory}\n`
      ); // <<< THÊM Cl
      if (
        bot.isCleaningInventory &&
        (eventName === "cannotFindPath" ||
          eventName === "goal_non_reachable" ||
          eventName === "interrupted")
      ) {
        const reason = args[0]?.message || eventName;
        console.error(`[CleanInv Pathfinder Error] Reason: ${reason}`);
        cleanInventoryCommands.finishCleaningInventory(
          bot,
          false,
          "Không thể đến được nơi vứt đồ."
        );
      }
      if (bot.isFinding && eventName === "goal_reached") {
        findCommands.handleFindGoalReached(bot);
      } else if (
        bot.isFinding &&
        (eventName === "cannotFindPath" ||
          eventName === "goal_non_reachable" ||
          eventName === "interrupted")
      ) {
        const reason = args[0]?.message || eventName;
        findCommands.handleFindPathError(bot, reason);
      }
    });
  });

  bot.on("sleep", () => {
    console.log("[Event] Bot đã ngủ thành công.");
    bot.chat("Khò khò... Zzzz");
  });

  bot.on("wake", () => {
    console.log("[Event] Bot đã thức dậy.");
    // Không cần chat ở đây vì stopAllTasks sẽ chat nếu người dùng đánh thức
  });

  bot.on("death", () => {
    console.log("!!! BOT ĐÃ CHẾT !!!");
    bot.chat("Ối! Tôi chết mất rồi... :(");
    stopAllTasks(bot, "Bot chết");
  });

  bot.on("health", () => {
    // Có thể thêm logic cảnh báo máu thấp ở đây
    // console.log(`Máu hiện tại: ${bot.health}, Đói: ${bot.food}`);
  });
});

bot.on("chat", async (username, message) => {
  if (username === bot.username || !message) return;

  const trimmedMessage = message.trim();
  const lowerMessage = trimmedMessage.toLowerCase();
  console.log(`[Chat In] <${username}> ${trimmedMessage}`);
  if (!trimmedMessage) return;

  const isBusy =
    bot.isFinding ||
    bot.isFollowing ||
    bot.isProtecting ||
    bot.isCollecting ||
    bot.pathfinder?.isMoving() ||
    bot.isSleeping ||
    bot.isStripMining ||
    bot.isHunting ||
    bot.isCleaningInventory; // <<< THÊM
  const stopKeywords = [
    "dừng",
    "stop",
    "hủy",
    "cancel",
    "thôi",
    "dừng lại",
    "dậy đi",
  ];
  if (isBusy && stopKeywords.some((k) => lowerMessage.includes(k))) {
    console.log(`[Manual Stop] User ${username} requested stop/wake.`);
    stopAllTasks(bot, username);
    return;
  }

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
    ];
    let confirmed = confirmKeywords.some((k) => lowerMessage.includes(k));
    let cancelled =
      !confirmed && cancelKeywords.some((k) => lowerMessage.includes(k));

    if (confirmed) {
      findCommands.proceedToNextTarget(bot);
      return;
    } else if (cancelled) {
      stopAllTasks(bot, username);
      return;
    } else {
      bot.chat(`${username}, nói 'tiếp' để đi tiếp hoặc 'dừng' để hủy nhé.`);
      return;
    }
  }

  try {
    const classificationPrompt = `Phân loại ý định của tin nhắn sau từ người chơi "${username}" gửi cho bot "${bot.botInGameName}".
    Tin nhắn: "${trimmedMessage}"
    
    Phân loại thành MỘT trong các loại sau:
    - GET_BOT_COORDS
    - GET_ENTITY_COORDS
    - FOLLOW_PLAYER
    - FIND_BLOCK: Khi được yều cầu TÌM KIẾM
    - CHECK_INVENTORY
    - GIVE_ITEM
    - PROTECT_PLAYER
    - COLLECT_BLOCK: Khi được yêu cầu thu thập, đào
    - GOTO_COORDS
    - SCAN_ORES
    - SAVE_WAYPOINT
    - GOTO_WAYPOINT
    - LIST_WAYPOINTS: Khi được hỏi đã lưu những chỗ nào rồi
    - DELETE_WAYPOINT
    - BREED_ANIMALS: Khi được yêu cầu nhân giống động vật hoặc cho động vật ăn (Không phải tim kiếm)
    - CRAFT_ITEM
    - GO_TO_SLEEP
    - STRIP_MINE
    - HUNT_MOB: Khi được yêu cầu GIẾT
    - CLEAN_INVENTORY: Yêu cầu dọn dẹp vật phẩm rác trong túi đồ.
    - LIST_CAPABILITIES: Khi được hỏi làm được gì
    - STOP_TASK
    - GENERAL_CHAT
    - IGNORE
    
    Loại ý định là:`;

    console.log(`[AI Intent] Gửi prompt phân loại...`);
    const intentResult = await aiModel.generateContent(classificationPrompt);
    const intentClassification = (await intentResult.response.text())
      .trim()
      .toUpperCase();
    console.log(
      `[AI Intent] Phân loại: "${intentClassification}" (Tin nhắn gốc: "${trimmedMessage}")`
    );

    const informationalIntents = [
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
    if (isBusy && !informationalIntents.includes(intentClassification)) {
      let reason = bot.isFinding
        ? "tìm đồ"
        : bot.isFollowing
        ? "đi theo"
        : bot.isProtecting
        ? "bảo vệ"
        : bot.isCollecting
        ? "thu thập"
        : bot.isSleeping
        ? "ngủ"
        : bot.isStripMining
        ? "đào hầm"
        : bot.isHunting
        ? "săn bắn"
        : bot.isCleaningInventory
        ? "dọn túi đồ" // <<< THÊM
        : "di chuyển";
      bot.chat(
        `${username}, tôi đang bận ${reason} rồi! Nói 'dừng' nếu muốn tôi hủy việc đang làm.`
      );
      console.log(
        `[Action Blocked] Intent ${intentClassification} blocked because bot is busy (${reason}).`
      );
      return;
    }

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
      case "FOLLOW_PLAYER":
        followCommands.startFollowing(bot, username);
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
        break;
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
      case "LIST_CAPABILITIES":
        infoCommands.listCapabilities(bot, username);
        break;
      case "STOP_TASK":
        stopAllTasks(bot, username);
        break;
      case "GENERAL_CHAT":
        await chatCommands.handleGeneralChat(
          bot,
          username,
          trimmedMessage,
          aiModel
        );
        break;
      case "IGNORE":
        console.log(
          `[Action] Bỏ qua tin nhắn từ ${username} theo phân loại AI.`
        );
        break;
      default:
        console.log(
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
    stopAllTasks(bot, "Lỗi hệ thống");
    try {
      bot.chat(`Ui, đầu tôi lag quá ${username} ơi, lỗi rồi!`);
    } catch (sendError) {
      console.error("[Chat Error] Lỗi gửi tin nhắn báo lỗi:", sendError);
    }
  }
});

bot.on("error", (err) => {
  console.error("!!! LỖI BOT:", err);
  stopAllTasks(bot, "Lỗi hệ thống");
});

bot.on("kicked", (reason) => {
  console.log("--- Bot bị kick ---");
  try {
    console.log("Lý do (JSON):", JSON.parse(reason));
  } catch {
    console.log("Lý do:", reason);
  }
  stopAllTasks(bot, "Bị kick");
});

bot.on("end", (reason) => {
  console.log("--- Kết nối bot kết thúc ---");
  console.log("Lý do:", reason);
  stopAllTasks(bot, "Mất kết nối");
  if (bot.autoEatInterval) clearInterval(bot.autoEatInterval);
  if (bot.protectionInterval) clearInterval(bot.protectionInterval);
});

process.on("SIGINT", () => {
  console.log("\nĐang ngắt kết nối bot (Ctrl+C)...");
  stopAllTasks(bot, "Tắt server");

  const quitMessage = `Bot AI (${
    bot.botInGameName || BOT_USERNAME
  }) tạm biệt và thoát game!`;
  try {
    if (bot.player) {
      bot.chat(quitMessage);
    }
  } catch (e) {
    console.error("Lỗi khi cố gắng chat khi thoát:", e);
  }

  setTimeout(() => {
    try {
      bot.quit();
    } catch (e) {
      console.error("Lỗi khi gọi bot.quit():", e);
    }
    console.log("Đã ngắt kết nối. Thoát chương trình.");
    process.exit(0);
  }, 700);
});
