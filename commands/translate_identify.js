// --- START OF FILE commands/translate_identify.js ---

const vi_vn = require('../localization/vi_vn'); // Import file localization

// Tạo một bản đồ đảo ngược để tra cứu tên tiếng Việt từ ID tiếng Anh
// Chạy một lần khi module được load
const englishToVietnameseMap = {};
for (const [vietnameseName, englishId] of Object.entries(vi_vn)) {
    // Nếu ID tiếng Anh chưa có trong map đảo ngược, hoặc nếu muốn ưu tiên tên nào đó (ở đây lấy tên đầu tiên gặp)
    if (!(englishId in englishToVietnameseMap)) {
        englishToVietnameseMap[englishId] = vietnameseName;
    }
    // Nếu muốn lưu tất cả các tên tiếng Việt cho cùng 1 ID (phức tạp hơn, tạm thời bỏ qua)
    // else {
    //   if (!Array.isArray(englishToVietnameseMap[englishId])) {
    //     englishToVietnameseMap[englishId] = [englishToVietnameseMap[englishId]];
    //   }
    //   englishToVietnameseMap[englishId].push(vietnameseName);
    // }
}
console.log('[Translate Identify] Đã tạo bản đồ tra cứu ngược Anh -> Việt.');

/**
 * Xử lý yêu cầu xác định/dịch tên vật phẩm.
 * @param {import('mineflayer').Bot} bot - Instance của bot.
 * @param {string} username - Tên người chơi yêu cầu.
 * @param {string} message - Tin nhắn gốc của người chơi.
 * @param {import('@google/generative-ai').GenerativeModel} aiModel - Model AI Gemini.
 */
async function handleIdentifyRequest(bot, username, message, aiModel) {
    console.log(`[Translate Identify] Nhận yêu cầu từ ${username}: "${message}"`);

    try {
        // --- Bước 1: Phân tích yêu cầu bằng AI ---
        const analysisPrompt = `
Nhiệm vụ: Phân tích tin nhắn của người chơi để xác định vật phẩm Minecraft họ đang hỏi.
Tin nhắn: "${message}"

Phân tích và trả lời bằng JSON với cấu trúc sau:
{
  "request_type": "description" | "ambiguous_term" | "unknown", // Loại yêu cầu: mô tả, thuật ngữ mơ hồ, không xác định
  "identified_term": string | null, // Thuật ngữ/mô tả chính được xác định (ví dụ: "sắt trắng trắng", "sắt")
  "potential_english_ids": string[] | null // Danh sách các ID tiếng Anh có thể khớp (ví dụ: ["iron_ingot"], ["iron_ingot", "iron_ore"])
}

Ví dụ:
1. Tin nhắn: "ê cái sắt trắng trắng mà nung từ cái quặng sắt là cái gì ý nhỉ?"
   Kết quả JSON: {"request_type": "description", "identified_term": "sắt trắng trắng nung từ quặng sắt", "potential_english_ids": ["iron_ingot"]}
2. Tin nhắn: "cho tui ít sắt đi"
   Kết quả JSON: {"request_type": "ambiguous_term", "identified_term": "sắt", "potential_english_ids": ["iron_ingot", "iron_ore", "deepslate_iron_ore", "raw_iron", "iron_block", "raw_iron_block"]}
3. Tin nhắn: "cái cục tròn tròn xanh xanh lá cây là gì?"
   Kết quả JSON: {"request_type": "description", "identified_term": "cục tròn tròn xanh xanh lá cây", "potential_english_ids": ["slime_ball", "emerald", "lime_dye"]} // AI có thể đoán nhiều thứ
4. Tin nhắn: "con gì kêu meo meo?"
   Kết quả JSON: {"request_type": "description", "identified_term": "con gì kêu meo meo", "potential_english_ids": ["cat", "ocelot"]}
5. Tin nhắn: "hôm nay trời đẹp quá"
   Kết quả JSON: {"request_type": "unknown", "identified_term": null, "potential_english_ids": null}

JSON kết quả phân tích:
`;

        console.debug('[Translate Identify] Gửi prompt phân tích cho AI...');
        const analysisResult = await aiModel.generateContent(analysisPrompt);
        const rawJsonResponse = (await analysisResult.response.text()).trim();
        console.debug('[Translate Identify] Phản hồi thô từ AI:', rawJsonResponse);

        let analysisData;
        try {
            // Cố gắng trích xuất JSON từ phản hồi của AI (có thể có text thừa)
            const jsonMatch = rawJsonResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                analysisData = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error("Không tìm thấy đối tượng JSON hợp lệ trong phản hồi AI.");
            }
        } catch (parseError) {
            console.error("[Translate Identify] Lỗi parse JSON từ AI:", parseError.message);
            bot.chat(`Xin lỗi ${username}, tôi gặp chút trục trặc khi phân tích câu hỏi của bạn.`);
            return;
        }

        console.log('[Translate Identify] Dữ liệu phân tích từ AI:', analysisData);

        // --- Bước 2: Xử lý kết quả phân tích ---
        const { request_type, potential_english_ids } = analysisData;

        if (request_type === 'unknown' || !potential_english_ids || potential_english_ids.length === 0) {
            bot.chat(`Xin lỗi ${username}, tôi không chắc bạn đang hỏi về vật phẩm nào.`);
            return;
        }

        // --- Bước 3: Tra cứu tên tiếng Việt và tạo phản hồi ---
        const matchedVietnameseNames = potential_english_ids
            .map(id => englishToVietnameseMap[id]) // Lấy tên tiếng Việt từ map đảo ngược
            .filter(name => name); // Lọc bỏ những ID không có trong map (hoặc bị lỗi)

        if (matchedVietnameseNames.length === 0) {
            // AI trả về ID nhưng không có trong file vi_vn.js?
            console.warn("[Translate Identify] AI trả về ID nhưng không tìm thấy tên tiếng Việt:", potential_english_ids);
            bot.chat(`Xin lỗi ${username}, tôi tìm thấy vài thứ khớp nhưng không rõ tên tiếng Việt của chúng.`);
            return;
        }

        let replyMessage = "";
        if (request_type === 'description') {
            if (matchedVietnameseNames.length === 1) {
                replyMessage = `À, có phải bạn đang nói đến '${matchedVietnameseNames[0]}' không?`;
            } else {
                // Nối các tên lại
                const nameList = matchedVietnameseNames.map(name => `'${name}'`).join(', ');
                replyMessage = `Hmm, có thể bạn đang nói đến một trong số này: ${nameList}?`;
            }
        } else if (request_type === 'ambiguous_term') {
            if (matchedVietnameseNames.length === 1) {
                // Trường hợp AI xác định mơ hồ nhưng chỉ tìm được 1 kết quả? (hơi lạ)
                 replyMessage = `Ý bạn là '${matchedVietnameseNames[0]}' phải không?`;
            } else {
                const nameList = matchedVietnameseNames.map(name => `'${name}'`).join(', ');
                replyMessage = `Ý bạn là: ${nameList}?`;
            }
        } else {
             // Fallback nếu request_type không hợp lệ nhưng vẫn có ID
             const nameList = matchedVietnameseNames.map(name => `'${name}'`).join(', ');
             replyMessage = `Tôi tìm thấy các kết quả sau liên quan đến câu hỏi của bạn: ${nameList}.`;
        }

        bot.chat(`${username}, ${replyMessage}`);

    } catch (error) {
        console.error("[Translate Identify] Lỗi xử lý yêu cầu:", error);
        bot.chat(`Ui, có lỗi xảy ra khi tôi cố gắng trả lời câu hỏi của bạn, ${username}.`);
    }
}

module.exports = {
    handleIdentifyRequest,
};
// --- END OF FILE commands/translate_identify.js ---