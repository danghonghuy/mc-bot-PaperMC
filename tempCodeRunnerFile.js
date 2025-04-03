// bot.js
// --- Các phần require ---
require("dotenv").config();
const mineflayer = require("mineflayer");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { pathfinder, Movements } = require("mineflayer-pathfinder"); // Không cần goals ở đây nữa

// --- Require các module lệnh ---
const followCommands = require("./commands/follow");
const coordsCommands = require("./commands/coords");
const chatCommands = require("./commands/chat");
const { roundCoord, formatCoords } = require('./utils'); // <<< THÊM DÒNG NÀY
// --- Cấu hình ---
const SERVER_ADDRESS = "dhhnedhhne.aternos.me"; // !!! THAY ĐỔI
const SERVER_PORT = 21691; // !!! THAY ĐỔI
const BOT_USERNAME = "GeminiBot"; // !!! THAY ĐỔI
const MINECRAFT_VERSION = "1.21.4";

// --- Lấy API Key ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("LỖI: Không tìm thấy GEMINI_API_KEY trong file .env!");
  process.exit(1);
}

// --- Khởi tạo Google Generative AI ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const aiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" }); // Sử dụng model bạn muốn

console.log(`Đang kết nối tới ${SERVER_ADDRESS}:${SERVER_PORT}...`);
console.log(`Tên bot: ${BOT_USERNAME}, Phiên bản: ${MINECRAFT_VERSION}`);

// --- Khởi tạo Bot Mineflayer ---
const bot = mineflayer.createBot({
  host: SERVER_ADDRESS,
  port: SERVER_PORT,
  username: BOT_USERNAME,
  version: MINECRAFT_VERSION,
  hideErrors: true,
  // auth: 'microsoft',
});

// --- Tải plugin Pathfinder ---
bot.loadPlugin(pathfinder);
console.log("Đã tạo bot. Bắt đầu kết nối...");

// --- Biến trạng thái Toàn cục ---
bot.botInGameName = BOT_USERNAME;
bot.defaultMove = null;
bot.followingTarget = null;
bot.isFollowing = false;



// --- Xử lý khi Bot vào Server ---
bot.once("spawn", () => {
    bot.botInGameName = bot.username;
    console.log(`*** Bot (${bot.botInGameName}) đã vào server! ***`);
    console.log(`Vị trí: ${formatCoords(bot.entity.position)}`);
  
    try {
      const mcData = require("minecraft-data")(bot.version);
      bot.defaultMove = new Movements(bot, mcData);
      if (bot.pathfinder) {
          bot.pathfinder.setMovements(bot.defaultMove);
          console.log("[Pathfinder] Đã khởi tạo và thiết lập Movements.");
      } else {
          console.error("[Lỗi Khởi tạo Pathfinder] bot.pathfinder không tồn tại ngay sau khi spawn!");
      }
    } catch (err) {
      console.error("[Lỗi Khởi tạo Pathfinder] Không thể tạo Movements:", err);
    }
  
    setTimeout(() => {
      bot.chat(`Bot AI (${bot.botInGameName}) đã kết nối! Hỏi gì đi nào? :D`);
    }, 1500);
  
    // Chống AFK
    setInterval(() => {
      if (!bot.pathfinder?.isMoving()) {
          bot.chat(".");
      }
    }, 2 * 60 * 1000);
  
    // --- Listener cho Pathfinder Events (Gắn trực tiếp vào 'bot') ---
    console.log("[Pathfinder] Gắn listener sự kiện pathfinder vào đối tượng 'bot'...");
    const pathfinderEvents = ['goal_reached', 'path_update', 'path_reset', 'cannotFindPath', 'interrupted', 'goal_non_reachable'];
    let listenersAttached = 0;
  
    pathfinderEvents.forEach(eventName => {
        try {
            // Gắn listener vào đối tượng bot chính
            bot.on(eventName, (...args) => {
                // Log rõ ràng hơn để biết sự kiện nào được kích hoạt từ 'bot'
                console.log(`[Bot Event - Pathfinder?] Tên sự kiện: ${eventName}`, args.length > 0 ? args : '');
  
                // Xử lý lỗi không tìm thấy đường khi đang follow
                if ((eventName === 'cannotFindPath' || eventName === 'goal_non_reachable') && bot.isFollowing) {
                    const goal = args[0]; // Goal thường là tham số đầu tiên
                    // Kiểm tra xem lỗi này có phải là của mục tiêu follow hiện tại không
                    if (goal && goal.entity && goal.entity === bot.followingTarget) {
                        const targetUsernameActual = bot.followingTarget.username || 'người chơi';
                        console.error(`[Bot Event - Pathfinder?] KHÔNG THỂ TÌM ĐƯỜNG đến ${targetUsernameActual} (Sự kiện: ${eventName})`);
                        bot.chat(`Xin lỗi ${targetUsernameActual}, tôi không tìm được đường đến chỗ bạn! Có gì cản đường không?`);
                    } else {
                        // Log cả trường hợp goal không khớp hoặc không có entity
                        const goalType = goal ? goal.constructor.name : 'N/A';
                        const goalTargetId = goal?.entity?.id;
                        const followingTargetId = bot.followingTarget?.id;
                        console.log(`[Bot Event - Pathfinder?] Lỗi tìm đường (${eventName}) nhưng không liên quan đến việc follow hiện tại (Goal type: ${goalType}, Goal target ID: ${goalTargetId}, Following target ID: ${followingTargetId}).`);
                    }
                } else if (eventName === 'goal_reached' && bot.isFollowing) {
                    const goal = args[0];
                    console.log(`[Bot Event - Pathfinder?] Đã đến đích/gần mục tiêu (Sự kiện: ${eventName}). Goal type: ${goal ? goal.constructor.name : 'N/A'}`);
                }
            });
            listenersAttached++;
        } catch (e) {
            console.error(`[Lỗi] Không thể gắn listener cho sự kiện '${eventName}' trên 'bot':`, e);
        }
    });
  
    if (listenersAttached === pathfinderEvents.length) {
        console.log(`[Pathfinder] Đã gắn ${listenersAttached} listener sự kiện vào đối tượng 'bot'. Hãy theo dõi log '[Bot Event - Pathfinder?]' khi bot di chuyển.`);
    } else {
        console.error(`[Lỗi] Chỉ gắn được ${listenersAttached}/${pathfinderEvents.length} listener vào 'bot'.`);
    }
  
  });

// --- Xử lý tin nhắn đến ---
bot.on("chat", async (username, message) => {
  if (username === bot.username || !message) return;

  const trimmedMessage = message.trim();
  console.log(`[Chat In] <${username}> ${trimmedMessage}`);
  if (!trimmedMessage) return;

  // *** LOGGING ENTITIES (Giữ lại để debug) ***
  // (Code logging entities giữ nguyên như trước)
  console.log(`--- Entities bot sees right when <${username}> chatted ---`);
  // ... (phần log entities) ...
  console.log("--- End of entities list ---");

  try {
    // --- Bước 1: Phân loại ý định bằng AI ---
    const classificationPrompt = `Phân loại ý định của tin nhắn sau từ người chơi "${username}" gửi cho bot "${bot.botInGameName}".
Tin nhắn: "${trimmedMessage}"
Chỉ trả lời bằng MỘT trong các loại sau:
- GET_BOT_COORDS
- GET_ENTITY_COORDS
- FOLLOW_PLAYER
- STOP_FOLLOWING
- GENERAL_CHAT
- IGNORE

Loại ý định là:`;

    console.log(`[AI Intent] Gửi prompt phân loại...`);
    const intentResult = await aiModel.generateContent(classificationPrompt);
    const intentClassification = (await intentResult.response.text()).trim().toUpperCase();
    console.log(`[AI Intent] Phân loại: "${intentClassification}" (Tin nhắn gốc: "${trimmedMessage}")`);

    // --- Bước 2: Gọi module lệnh tương ứng ---
    switch (intentClassification) {
      case "GET_BOT_COORDS":
        coordsCommands.getBotCoords(bot, username);
        break;

      case "GET_ENTITY_COORDS":
        // Truyền aiModel vào để module coords có thể dùng
        await coordsCommands.getEntityCoords(bot, username, trimmedMessage, aiModel);
        break;

      case "FOLLOW_PLAYER":
        followCommands.startFollowing(bot, username);
        break;

      case "STOP_FOLLOWING":
        followCommands.stopFollowing(bot, username);
        break;

      case "GENERAL_CHAT":
        // Truyền aiModel vào để module chat có thể dùng
        await chatCommands.handleGeneralChat(bot, username, trimmedMessage, aiModel);
        break;

      case "IGNORE":
        console.log(`[Action] Bỏ qua tin nhắn từ ${username} theo phân loại AI.`);
        break;

      default:
        console.log(`[Action] Không rõ ý định từ AI: "${intentClassification}".`);
        // Có thể gọi General Chat ở đây như một fallback
        console.log(`[Action] Fallback sang General Chat.`);
        await chatCommands.handleGeneralChat(bot, username, trimmedMessage, aiModel);
        // Hoặc trả lời không hiểu
        // bot.chat(`Hmmm, ${username} nói gì tôi chưa hiểu lắm? :?`);
        break;
    }
  } catch (error) {
    console.error("[AI/Chat Processing] Lỗi nghiêm trọng khi xử lý tin nhắn hoặc gọi Gemini:", error);
    try {
      bot.chat(`Ui, đầu tôi lag quá ${username} ơi, lỗi rồi!`);
    } catch (sendError) {
      console.error("[Chat Error] Lỗi khi gửi tin nhắn báo lỗi:", sendError);
    }
  }
});

// --- Xử lý lỗi và ngắt kết nối ---
// (Giữ nguyên các handler 'error', 'kicked', 'end')
bot.on("error", (err) => {
    console.error("!!! LỖI BOT:", err);
    bot.isFollowing = false;
    bot.followingTarget = null;
});

bot.on("kicked", (reason) => {
  console.log("--- Bot bị kick ---");
  try { console.log("Lý do (JSON):", JSON.parse(reason)); }
  catch { console.log("Lý do:", reason); }
  bot.followingTarget = null;
  bot.isFollowing = false;
});

bot.on("end", (reason) => {
  console.log("--- Kết nối bot kết thúc ---");
  console.log("Lý do:", reason);
  bot.followingTarget = null;
  bot.isFollowing = false;
});


// --- Xử lý Ctrl+C ---
// (Giữ nguyên handler 'SIGINT')
process.on("SIGINT", () => {
  console.log("\nĐang ngắt kết nối bot (Ctrl+C)...");
  const quitMessage = `Bot AI (${bot.botInGameName || BOT_USERNAME}) tạm biệt và thoát game!`;
  try {
      if (bot.pathfinder) {
          try { bot.pathfinder.stop(); } catch(e) {/*ignore*/}
      }
      if (bot.player) {
          bot.chat(quitMessage);
      }
  } catch (e) {
      console.error("Lỗi khi cố gắng dừng/chat khi thoát:", e);
  }

  setTimeout(() => {
      try {
          bot.quit();
      } catch(e) {
          console.error("Lỗi khi gọi bot.quit():", e);
      }
      console.log("Đã ngắt kết nối. Thoát chương trình.");
      process.exit(0);
  }, 500);
});

