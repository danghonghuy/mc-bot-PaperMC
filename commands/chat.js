// commands/chat.js
const fs = require('fs'); // Import module fs
const path = require('path'); // Import module path để xử lý đường dẫn file

// Đường dẫn đến file info.js (điều chỉnh nếu cần)
const infoFilePath = path.join(__dirname, 'info.js'); // Giả sử info.js cùng thư mục commands

/**
 * Đọc nội dung file info.js (chỉ đọc một lần khi module được load)
 */
let infoFileContent = '';
try {
    infoFileContent = fs.readFileSync(infoFilePath, 'utf8');
    console.log("[Chat Cmd] Đã đọc thành công nội dung file info.js.");
    // Có thể xử lý cắt bớt phần không cần thiết nếu file quá lớn hoặc chỉ lấy mảng capabilities
} catch (err) {
    console.error(`[Chat Cmd] Lỗi khi đọc file info.js tại ${infoFilePath}:`, err);
    infoFileContent = "Lỗi: Không thể đọc file mô tả khả năng.";
}


/**
 * Xử lý tin nhắn chat thông thường bằng AI, có thêm ngữ cảnh lịch sử và khả năng.
 * @param {import('mineflayer').Bot} bot
 * @param {string} username
 * @param {string} message
 * @param {import("@google/generative-ai").GenerativeModel} aiModel
 * @param {string[]} chatHistory - Mảng chứa lịch sử chat gần nhất
 */
async function handleGeneralChat(bot, username, message, aiModel, chatHistory = []) { // Thêm tham số chatHistory
    console.log(`[Chat Cmd] Xử lý chat thông thường với ngữ cảnh.`);

    // Chuẩn bị chuỗi lịch sử chat
    const historyString = chatHistory.length > 0
        ? `\n**Lịch sử chat gần đây (tối đa ${chatHistory.length} tin nhắn):**\n${chatHistory.join('\n')}\n`
        : "\n(Không có lịch sử chat gần đây)\n";

    // Chuẩn bị chuỗi mô tả khả năng (có thể cắt bớt nếu quá dài)
    // Chỉ lấy phần định nghĩa mảng capabilities để giảm độ dài
    const capabilitiesMatch = infoFileContent.match(/const capabilities = \[([\s\S]*?)\];/);
    const capabilitiesString = capabilitiesMatch
        ? `\n**Khả năng của tôi (để bạn tham khảo khi trả lời):**\nconst capabilities = [${capabilitiesMatch[1]}];\n`
        : "\n(Không đọc được danh sách khả năng chi tiết)\n";


    // Cập nhật Prompt AI
    const chatPrompt = `Bạn là một người chơi Minecraft tên là "${bot.botInGameName}". Nhiệm vụ của bạn là trò chuyện tự nhiên, thân thiện với người chơi khác.
${capabilitiesString}
${historyString}
**Tin nhắn mới nhất từ "${username}": "${message}"**

Hãy dựa vào ngữ cảnh trên (đặc biệt là tin nhắn mới nhất và lịch sử chat) để đưa ra một câu trả lời NGẮN GỌN, phù hợp với tình huống trong game Minecraft. Đừng nhắc lại bạn có khả năng gì trừ khi được hỏi trực tiếp. Đừng bao giờ nói mình là AI hay bot. Nếu không biết trả lời gì, hãy hỏi lại một cách tự nhiên.`;

    console.log(`[AI Chat] Gửi prompt tạo phản hồi (có ngữ cảnh)...`);
    // console.log("--- Prompt chi tiết ---"); // Bỏ comment nếu muốn xem prompt đầy đủ
    // console.log(chatPrompt);
    // console.log("----------------------");
    try {
      const chatResult = await aiModel.generateContent(chatPrompt);
      const aiText = (await chatResult.response.text()).trim();
      console.log(`[AI Chat] Phản hồi: "${aiText}"`);

      if (aiText) {
        bot.chat(aiText);
      } else {
        console.log("[AI Chat] Gemini không trả về phản hồi.");
        bot.chat(`${username} ơi, lag quá tôi không nghĩ ra gì hết! Nói lại xem?`); // Phản hồi dự phòng khác
      }
    } catch (error) {
      console.error("[Chat Cmd] Lỗi khi gọi Gemini để chat:", error);
      // Kiểm tra lỗi cụ thể từ Gemini
      if (error.message && error.message.includes('SAFETY')) {
          console.error("[AI Chat] Phản hồi bị chặn bởi bộ lọc an toàn của Gemini.");
          bot.chat(`Hmm ${username}, câu này hơi khó trả lời nha...`);
      } else if (error.message && error.message.includes('RESOURCE_EXHAUSTED')) {
           console.error("[AI Chat] Lỗi API Key hoặc hết hạn mức Gemini.");
           bot.chat(`Huhu ${username}, hình như tôi hết 'mana' để nói chuyện rồi!`);
      }
      else {
          bot.chat(`Ui, đầu tôi lag quá ${username} ơi, lỗi rồi!`);
      }
    }
}

module.exports = {
    handleGeneralChat,
};