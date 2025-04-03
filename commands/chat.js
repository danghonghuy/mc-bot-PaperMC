// commands/chat.js

/**
 * Xử lý tin nhắn chat thông thường bằng AI.
 * @param {import('mineflayer').Bot} bot
 * @param {string} username
 * @param {string} message
 * @param {import("@google/generative-ai").GenerativeModel} aiModel
 */
async function handleGeneralChat(bot, username, message, aiModel) {
    console.log(`[Chat Cmd] Xử lý chat thông thường.`);
    const chatPrompt = `Bạn là một người chơi Minecraft tên là "${bot.botInGameName}". Người chơi "${username}" vừa nói: "${message}". Hãy trả lời ngắn gọn, thân thiện, tự nhiên như đang chơi game. Đừng nói mình là AI hay bot.`;
  
    console.log(`[AI Chat] Gửi prompt tạo phản hồi...`);
    try {
      const chatResult = await aiModel.generateContent(chatPrompt);
      const aiText = (await chatResult.response.text()).trim();
      console.log(`[AI Chat] Phản hồi: "${aiText}"`);
  
      if (aiText) {
        bot.chat(aiText);
      } else {
        console.log("[AI Chat] Gemini không trả về phản hồi.");
        // Phản hồi dự phòng nếu AI không trả lời
        bot.chat(`${username} ơi, nói lại được không? Hình như tôi nghe không rõ.`);
      }
    } catch (error) {
      console.error("[Chat Cmd] Lỗi khi gọi Gemini để chat:", error);
      bot.chat(`Ui, đầu tôi lag quá ${username} ơi, lỗi rồi!`);
    }
  }
  
  module.exports = {
    handleGeneralChat,
  };