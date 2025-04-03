// commands/coords.js
const { roundCoord, formatCoords, translateToEnglishId } = require("../utils"); // <<< THÊM: Import translateToEnglishId

const MAX_ENTITY_FIND_DISTANCE = 64;

/**
 * Trả lời tọa độ hiện tại của bot.
 * @param {import('mineflayer').Bot} bot
 * @param {string} username
 */
function getBotCoords(bot, username) {
  const pos = bot.entity.position;
  console.log(`[Coords Cmd] Trả lời tọa độ bot: ${formatCoords(pos)}`);
  bot.chat(`${username}, tôi đang ở ${formatCoords(pos)} nè!`);
}

/**
 * Tìm và trả lời tọa độ của một thực thể (người chơi hoặc mob/item).
 * @param {import('mineflayer').Bot} bot
 * @param {string} username - Người hỏi
 * @param {string} message - Tin nhắn gốc để trích xuất tên
 * @param {import("@google/generative-ai").GenerativeModel} aiModel - Model AI để trích xuất
 */
async function getEntityCoords(bot, username, message, aiModel) {
  console.log(`[Coords Cmd] Bắt đầu xử lý lấy tọa độ thực thể.`);
  const extractionPrompt = `Từ tin nhắn "${message}" của người chơi "${username}", hãy trích xuất tên của người chơi hoặc loại mob hoặc tên vật phẩm/khối mà họ đang hỏi tọa độ. Nếu họ hỏi về chính họ (người gửi tin nhắn), trả về "SELF". Nếu không xác định được tên cụ thể, trả về "UNKNOWN". Chỉ trả về tên thực thể/vật phẩm hoặc SELF hoặc UNKNOWN. Tên:`; // Sửa prompt một chút

  console.log(`[AI Extract] Gửi prompt trích xuất thực thể/vật phẩm...`);
  try {
    const extractResult = await aiModel.generateContent(extractionPrompt);
    let targetNameRaw = (await extractResult.response.text()).trim(); // Tên gốc AI trích xuất (có thể là tiếng Việt)
    console.log(`[AI Extract] Trích xuất được: "${targetNameRaw}"`);

    let targetEntity = null;
    let targetNameForChat = targetNameRaw; // Tên để hiển thị trong chat, mặc định là tên gốc
    let searchName = targetNameRaw; // Tên dùng để tìm kiếm, sẽ được cập nhật nếu dịch được

    if (searchName.toUpperCase() === "UNKNOWN") {
      bot.chat(`Xin lỗi ${username}, bạn muốn hỏi tọa độ của ai/con gì/khối gì thế? Nói rõ hơn được không?`);
      return;
    }

    if (searchName.toUpperCase() === "SELF") {
      // Nếu hỏi về chính mình, dùng username từ sự kiện chat
      targetNameForChat = username;
      searchName = username; // Tìm kiếm bằng username gốc
      const usernameWithDotSelf = '.' + username;
      console.log(`[Entity Find] Tìm chính người hỏi: '${username}' hoặc '${usernameWithDotSelf}'`);
      targetEntity = bot.players[username]?.entity || bot.nearestEntity(entity =>
          entity.type === 'player' && (entity.username === username || entity.username === usernameWithDotSelf)
      );
    } else {
      // <<< THÊM: Cố gắng dịch tên trích xuất sang ID tiếng Anh
      const translatedId = translateToEnglishId(targetNameRaw);
      if (translatedId) {
        console.log(`[Translate] Đã dịch "${targetNameRaw}" thành ID: "${translatedId}"`);
        searchName = translatedId; // Sử dụng ID đã dịch để tìm kiếm
        // Giữ targetNameForChat là tên gốc tiếng Việt để trả lời thân thiện hơn
      } else {
        console.log(`[Translate] Không tìm thấy bản dịch cho "${targetNameRaw}". Sử dụng tên gốc để tìm kiếm.`);
        // searchName vẫn là targetNameRaw
      }
      // >>> KẾT THÚC PHẦN DỊCH

      // Bắt đầu tìm kiếm sử dụng 'searchName' (có thể là tên gốc hoặc ID đã dịch)
      const searchNameWithDot = '.' + searchName;
      console.log(`[Entity Find] Tìm người chơi/thực thể bằng tên/ID: '${searchName}' hoặc '${searchNameWithDot}'`);

      // Ưu tiên tìm người chơi trước bằng searchName (có thể là username hoặc ID đã dịch nhưng trùng username)
      targetEntity = bot.players[searchName]?.entity || bot.nearestEntity(entity =>
          entity.type === 'player' && (entity.username === searchName || entity.username === searchNameWithDot)
      );

      // Nếu không tìm thấy người chơi, tìm thực thể khác (mob, item entity, ...) bằng searchName (thường là ID đã dịch)
      if (!targetEntity) {
        console.log(`[Entity Find] Không tìm thấy người chơi, tìm thực thể khác gần nhất có name/displayName là '${searchName}'`);
        const lowerCaseSearchName = searchName.toLowerCase();
        targetEntity = bot.nearestEntity(entity =>
          entity.type !== 'player' && // Chỉ tìm không phải player
          (entity.name?.toLowerCase() === lowerCaseSearchName || // So sánh ID chuẩn (quan trọng nhất)
           entity.displayName?.toLowerCase() === lowerCaseSearchName) // So sánh tên hiển thị (ít quan trọng hơn cho ID)
        );

        // Nếu tìm thấy thực thể khác, cập nhật tên hiển thị trong chat (vẫn giữ tên gốc tiếng Việt nếu có thể)
        if(targetEntity) {
            console.log(`[Entity Find] Tìm thấy thực thể khác: Type=${targetEntity.type}, Name=${targetEntity.name}, DisplayName=${targetEntity.displayName}`);
            // targetNameForChat vẫn giữ nguyên là targetNameRaw (tên tiếng Việt gốc)
        }
      } else {
          // Nếu tìm thấy người chơi, cập nhật tên để chat là username thực tế
          targetNameForChat = targetEntity.username || targetNameRaw;
          console.log(`[Entity Find] Tìm thấy người chơi: Username=${targetNameForChat}`);
      }
    }

    // Log kết quả cuối cùng
    console.log(`[Entity Find] Kết quả cuối cùng: ${targetEntity ? `Tìm thấy (ID: ${targetEntity.id}, Type: ${targetEntity.type}, Username: ${targetEntity.username}, Name: ${targetEntity.name})` : 'Không tìm thấy'}`);

    if (targetEntity && targetEntity.position) {
        const distance = bot.entity.position.distanceTo(targetEntity.position);
        console.log(`[Entity Find] Khoảng cách tới thực thể: ${distance.toFixed(2)} blocks.`);
        if (distance <= MAX_ENTITY_FIND_DISTANCE) {
            // Trả lời bằng tên gốc tiếng Việt (targetNameForChat) nếu có thể
            bot.chat(`${username}, ${targetNameForChat} đang ở khoảng ${formatCoords(targetEntity.position)}.`);
        } else {
            bot.chat(`${username}, tôi thấy ${targetNameForChat} nhưng họ/nó ở xa quá (${roundCoord(distance)} blocks), không đọc rõ tọa độ!`);
        }
    } else {
      // Thông báo lỗi sử dụng tên gốc mà người dùng hỏi (targetNameRaw)
      bot.chat(`Xin lỗi ${username}, tôi không tìm thấy ai/con gì/khối gì tên là "${targetNameRaw}" ở gần đây cả.`);
    }

  } catch (error) {
    console.error("[Coords Cmd] Lỗi khi trích xuất hoặc tìm thực thể:", error);
    bot.chat(`Xin lỗi ${username}, tôi gặp lỗi khi tìm tọa độ. Bạn thử lại sau nhé.`);
  }
}

module.exports = {
  getBotCoords,
  getEntityCoords,
};