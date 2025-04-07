// commands/inventory.js
const { GoalNear } = require("mineflayer-pathfinder").goals;
const { Vec3 } = require("vec3");
// Import các hàm cần thiết từ utils, bao gồm cả hàm dịch ngược
const { translateToEnglishId, formatCoords, translateToVietnamese, sleep } = require("../utils"); // <<< THÊM , sleep VÀO ĐÂY

const GIVE_ITEM_MAX_DIST = 5; // Khoảng cách tối đa để bot tự ném đồ
const GIVE_ITEM_REACH_DIST = 2; // Khoảng cách bot cần đến gần người chơi

/**
 * Liệt kê các vật phẩm trong túi đồ của bot bằng tiếng Việt (nếu có bản dịch).
 * @param {import('mineflayer').Bot} bot - Instance của bot.
 * @param {string} username - Tên người chơi yêu cầu.
 */
function checkInventory(bot, username) {
    console.log(`[Inv Cmd] ${username} yêu cầu kiểm tra túi đồ.`);
    try {
        const items = bot.inventory.items();

        if (items.length === 0) {
            bot.chat(`${username}, túi đồ của tôi trống rỗng!`);
            return;
        }

        // Nhóm các vật phẩm giống nhau và đếm số lượng, sử dụng tên tiếng Việt
        const itemCounts = items.reduce((acc, item) => {
            if (!item || !item.name) return acc; // Bỏ qua item không hợp lệ

            // Lấy ID tiếng Anh (item.name)
            const englishId = item.name;
            // Dịch sang tiếng Việt, fallback về ID gốc nếu không có bản dịch
            const vietnameseName = translateToVietnamese(englishId);

            // Dùng tên đã dịch (hoặc ID gốc) làm key để nhóm
            acc[vietnameseName] = (acc[vietnameseName] || 0) + item.count;
            return acc;
        }, {});

        // Tạo chuỗi danh sách vật phẩm
        const itemList = Object.entries(itemCounts)
            .map(([name, count]) => `${count} ${name}`) // name ở đây đã là tiếng Việt (hoặc ID gốc)
            .join(', ');

        // Chia nhỏ tin nhắn nếu quá dài để tránh bị cắt
        const MAX_CHAT_LENGTH = 250; // Giới hạn ký tự an toàn cho Minecraft chat
        const messagePrefix = `${username}, trong túi tôi có: `;
        let remainingMessage = itemList;
        let firstMessage = true;

        while (remainingMessage.length > 0) {
            let currentChunk;
            let prefix = firstMessage ? messagePrefix : '';
            let availableLength = MAX_CHAT_LENGTH - prefix.length;

            if (remainingMessage.length <= availableLength) {
                currentChunk = remainingMessage;
                remainingMessage = '';
            } else {
                // Tìm dấu phẩy cuối cùng trong khoảng cho phép để cắt đẹp hơn
                let cutIndex = remainingMessage.lastIndexOf(',', availableLength);
                // Nếu không tìm thấy dấu phẩy hoặc dấu phẩy quá gần đầu, cắt cứng
                if (cutIndex <= 0 || cutIndex < availableLength / 2) {
                    cutIndex = availableLength;
                }
                currentChunk = remainingMessage.substring(0, cutIndex);
                remainingMessage = remainingMessage.substring(cutIndex).trim();
                // Bỏ dấu phẩy thừa ở đầu message tiếp theo nếu có
                if (remainingMessage.startsWith(',')) {
                    remainingMessage = remainingMessage.substring(1).trim();
                }
            }
            bot.chat(prefix + currentChunk);
            firstMessage = false;
        }

        console.log(`[Inv Cmd] Đã liệt kê túi đồ cho ${username} (đã dịch nếu có).`);

    } catch (error) {
        console.error("[Inv Cmd - Check] Lỗi khi kiểm tra túi đồ:", error);
        bot.chat(`Xin lỗi ${username}, tôi gặp lỗi khi xem túi đồ của mình.`);
    }
}

/**
 * Đưa (ném) vật phẩm cho người chơi, xử lý tên tiếng Việt.
 * @param {import('mineflayer').Bot} bot - Instance của bot.
 * @param {string} username - Người yêu cầu.
 * @param {string} message - Tin nhắn gốc của người chơi.
 * @param {import("@google/generative-ai").GenerativeModel} aiModel - Model AI để trích xuất thông tin.
 */
async function giveItem(bot, username, message, aiModel) {
    console.log(`[Give Cmd] Bắt đầu xử lý yêu cầu đưa đồ từ ${username}: "${message}"`);

    if (bot.isFinding || bot.isFollowing || bot.isCollecting || bot.isHunting || bot.isStripMining || bot.isDepositing || bot.isCleaningInventory || bot.isBuilding || bot.isFlattening || bot.isFarmingWheat) {
         const busyReason = bot.isFinding ? 'tìm đồ' :
                           bot.isFollowing ? 'đi theo người khác' :
                           bot.isCollecting ? 'thu thập đồ' :
                           bot.isHunting ? 'săn bắn' :
                           bot.isStripMining ? 'đào hầm' :
                           bot.isDepositing ? 'cất đồ' :
                           bot.isCleaningInventory ? 'dọn túi đồ' :
                           bot.isBuilding ? 'xây dựng' :
                           bot.isFlattening ? 'làm phẳng' :
                           bot.isFarmingWheat ? 'làm ruộng' :
                           'bận việc khác';
        bot.chat(`${username}, tôi đang ${busyReason}, không đưa đồ được!`);
        console.log(`[Give Cmd] Bị chặn do đang ${busyReason}.`);
        return;
    }

    // --- Bước 1: Trích xuất tên và số lượng bằng AI ---
    const extractionPrompt = `Từ tin nhắn "${message}" của người chơi "${username}", trích xuất tên vật phẩm họ muốn nhận và số lượng. Nếu không nói số lượng, mặc định là 1. Chỉ trả lời bằng định dạng JSON với hai khóa: "itemName" (string, giữ nguyên tiếng Việt nếu có) và "quantity" (number). Ví dụ: "cho tao 5 cục đất" -> {"itemName": "cục đất", "quantity": 5}. JSON:`;
    let itemNameVi = null;
    let quantity = 1;
    try {
        console.log("[Give Cmd] Bước 1: Gửi prompt trích xuất...");
        const extractResult = await aiModel.generateContent(extractionPrompt);
        const jsonResponse = (await extractResult.response.text()).trim();
        console.log("[Give Cmd] Bước 1: Phản hồi JSON thô:", jsonResponse);

        let parsedData;
        try {
            // Cố gắng tìm và parse JSON trong phản hồi (có thể có markdown ```json ... ```)
            const jsonMatch = jsonResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                parsedData = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error("Không tìm thấy cấu trúc JSON hợp lệ trong phản hồi.");
            }
        } catch (parseError) {
            console.error("[Give Cmd] Bước 1: Lỗi parse JSON:", parseError, "Response:", jsonResponse);
            // Fallback đơn giản hơn: Nếu không parse được, thử coi cả message là tên item (sau khi loại bỏ số lượng nếu có)
            const potentialItemName = message.replace(/\b\d+\b/g, '').trim(); // Loại bỏ số đứng riêng
             if (potentialItemName && !potentialItemName.includes('{') && !potentialItemName.includes(':')) {
                 itemNameVi = potentialItemName;
                 // Cố gắng tìm số lượng trong message gốc
                 const quantityMatch = message.match(/\b(\d+)\b/);
                 quantity = quantityMatch ? parseInt(quantityMatch[1], 10) : 1;
                 console.log(`[Give Cmd] Bước 1 Fallback: Name="${itemNameVi}", Quantity=${quantity}.`);
             } else {
                 throw new Error("Không thể phân tích phản hồi AI hoặc fallback thất bại.");
             }
        }

        if (parsedData) {
            itemNameVi = parsedData.itemName;
            quantity = parseInt(parsedData.quantity, 10) || 1;
        }

        if (!itemNameVi || typeof itemNameVi !== 'string' || itemNameVi.trim() === '') {
            throw new Error("AI không trích xuất được tên vật phẩm hợp lệ.");
        }
        itemNameVi = itemNameVi.trim(); // Đảm bảo không có khoảng trắng thừa
        quantity = Math.max(1, quantity); // Đảm bảo số lượng ít nhất là 1
        console.log(`[Give Cmd] Bước 1: AI trích xuất: Tên="${itemNameVi}", Số lượng=${quantity}`);
    } catch (error) {
        console.error("[Give Cmd] Bước 1: Lỗi trích xuất:", error);
        bot.chat(`Xin lỗi ${username}, tôi không hiểu bạn muốn lấy vật phẩm gì hoặc số lượng bao nhiêu từ tin nhắn đó.`);
        return;
    }

    // --- Bước 2: Dịch tên vật phẩm tiếng Việt sang ID tiếng Anh ---
    let itemId;
    let mcData;
    try {
        console.log(`[Give Cmd] Bước 2: Dịch "${itemNameVi}"...`);
        // Sử dụng hàm dịch đã được cải tiến trong utils.js
        itemId = translateToEnglishId(itemNameVi);

        if (!itemId) {
            // Nếu dịch thất bại, trả về tên tiếng Việt gốc để người dùng biết
            bot.chat(`Xin lỗi ${username}, tôi không biết vật phẩm "${itemNameVi}" là gì trong Minecraft.`);
            console.log(`[Give Cmd] Bước 2: Không dịch được "${itemNameVi}".`);
            return;
        }
        console.log(`[Give Cmd] Bước 2: Đã dịch thành ID: "${itemId}"`);

        // Kiểm tra xem ID có hợp lệ trong phiên bản Minecraft hiện tại không
        mcData = require('minecraft-data')(bot.version);
        if (!mcData.itemsByName[itemId] && !mcData.blocksByName[itemId]) {
             bot.chat(`Xin lỗi ${username}, hình như "${itemNameVi}" (ID: ${itemId}) không phải là vật phẩm/khối hợp lệ trong phiên bản này.`);
             console.log(`[Give Cmd] Bước 2: ID "${itemId}" không hợp lệ trong minecraft-data version ${bot.version}.`);
             return;
        }

    } catch (error) {
        console.error("[Give Cmd] Bước 2: Lỗi khi dịch hoặc kiểm tra mcData:", error);
        bot.chat(`Xin lỗi ${username}, có lỗi xảy ra khi tìm thông tin về vật phẩm "${itemNameVi}".`);
        return;
    }

    // --- Bước 3: Tìm người chơi yêu cầu ---
    // Thử tìm cả username gốc và username có dấu chấm ở đầu (một số server thêm vào)
    const targetPlayer = bot.players[username]?.entity || bot.players['.' + username]?.entity || bot.nearestEntity(entity =>
        entity.type === 'player' && (entity.username === username || entity.username === '.' + username)
    );

    if (!targetPlayer || !targetPlayer.position) {
        bot.chat(`Ơ ${username}, bạn ở đâu rồi? Tôi không thấy bạn để đưa đồ!`);
        console.log(`[Give Cmd] Bước 3: Không tìm thấy người chơi ${username} hoặc vị trí của họ.`);
        return;
    }
    console.log(`[Give Cmd] Bước 3: Tìm thấy ${targetPlayer.username} tại ${formatCoords(targetPlayer.position)}.`);

    // --- Bước 4: Kiểm tra vật phẩm trong túi đồ ---
    let itemType;
    try {
        // Lấy thông tin item/block từ mcData bằng ID đã dịch
        itemType = mcData.itemsByName[itemId] || mcData.blocksByName[itemId];
        if (!itemType) {
            // Trường hợp này không nên xảy ra nếu Bước 2 thành công, nhưng kiểm tra lại cho chắc
            throw new Error(`Không tìm thấy item data cho ID ${itemId} mặc dù đã kiểm tra ở Bước 2.`);
        }

        // Tính tổng số lượng bot có của vật phẩm này
        const totalAmount = bot.inventory.count(itemType.id, null); // Dùng itemType.id để chắc chắn

        if (totalAmount === 0) {
            // Dùng lại tên tiếng Việt gốc để thông báo cho người dùng
            bot.chat(`Xin lỗi ${username}, tôi không có "${itemNameVi}" trong túi.`);
            console.log(`[Give Cmd] Bước 4: Không tìm thấy ${itemId} (ID: ${itemType.id}) trong túi đồ.`);
            return;
        }

        if (totalAmount < quantity) {
            bot.chat(`Xin lỗi ${username}, tôi chỉ có ${totalAmount} cái "${itemNameVi}", không đủ ${quantity} cái bạn cần.`);
            console.log(`[Give Cmd] Bước 4: Không đủ số lượng (có ${totalAmount}, cần ${quantity}).`);
            return;
        }
        console.log(`[Give Cmd] Bước 4: Tìm thấy ${itemId} (ID: ${itemType.id}) trong túi, có ${totalAmount} (cần ${quantity}).`);

    } catch (error) {
        console.error("[Give Cmd] Bước 4: Lỗi khi kiểm tra túi đồ:", error);
        bot.chat(`Xin lỗi ${username}, tôi gặp lỗi khi kiểm tra túi đồ của mình.`);
        return;
    }

    // --- Bước 5: Di chuyển (nếu cần) và Ném đồ ---
    const currentDistance = bot.entity.position.distanceTo(targetPlayer.position);
    console.log(`[Give Cmd] Bước 5: Khoảng cách tới ${targetPlayer.username}: ${currentDistance.toFixed(2)} blocks.`);

    try {
        // Chỉ di chuyển nếu khoảng cách lớn hơn khoảng cách cần đến cộng thêm một khoảng đệm nhỏ
        if (currentDistance > GIVE_ITEM_REACH_DIST + 0.5) {
             const MAX_TRAVEL_DIST = 64;
             if (currentDistance > MAX_TRAVEL_DIST) { /* ... xử lý quá xa ... */ return; }

            bot.chat(`${username}, bạn đợi chút, tôi đang đi lại gần để đưa đồ...`);
            console.log(`[Give Cmd] Bước 5: Bắt đầu di chuyển đến gần ${GIVE_ITEM_REACH_DIST} blocks...`);

            const goal = new GoalNear(targetPlayer.position.x, targetPlayer.position.y, targetPlayer.position.z, GIVE_ITEM_REACH_DIST);
            await bot.pathfinder.goto(goal);

            // Sau khi goto thành công (resolve)
            const newDistanceSuccess = bot.entity.position.distanceTo(targetPlayer.position);
            console.log(`[Give Cmd] Bước 5: Di chuyển xong (Promise resolved). Khoảng cách mới: ${newDistanceSuccess.toFixed(2)} blocks.`);
            // Kiểm tra lại lần nữa phòng trường hợp người chơi chạy đi xa *sau khi* goto resolve
            if (newDistanceSuccess > GIVE_ITEM_MAX_DIST + 1) {
                console.warn(`[Give Cmd] Bước 5: Đến nơi nhưng người chơi đã quá xa (${newDistanceSuccess.toFixed(1)} blocks).`);
                bot.chat(`${username}, hình như bạn đi đâu mất rồi!`);
                return;
            }
            // Nếu đủ gần -> tiếp tục ném đồ bên dưới

        } else {
             console.log(`[Give Cmd] Bước 5: Đã đủ gần (${currentDistance.toFixed(1)} <= ${GIVE_ITEM_REACH_DIST + 0.5}), không cần di chuyển.`);
        }

        // --- Tiến hành ném đồ (chỉ chạy nếu không return ở trên) ---
        console.log(`[Give Cmd] Bước 5: Chuẩn bị ném ${quantity} ${itemId} (ID: ${itemType.id}) cho ${username}...`);
        await bot.lookAt(targetPlayer.position.offset(0, targetPlayer.height, 0));
        await sleep(100);
        await bot.toss(itemType.id, null, quantity);
        bot.chat(`Của bạn nè ${username}! (${quantity} ${itemNameVi})`);
        console.log(`[Give Cmd] Bước 5: Đã ném thành công.`);

    } catch (error) { // <<< SỬA KHỐI CATCH NÀY
        // Phân biệt lỗi pathfinding và lỗi khác
        if (error.message.toLowerCase().includes('path')) {
             console.error("[Give Cmd] Bước 5: Lỗi khi di chuyển:", error.message);

             // === THÊM KIỂM TRA VỊ TRÍ NGAY ĐÂY ===
             const distAfterError = bot.entity.position.distanceTo(targetPlayer.position);
             const targetReach = GIVE_ITEM_REACH_DIST + 0.5; // Ngưỡng chấp nhận

             if (distAfterError <= targetReach) {
                 console.warn(`[Give Cmd] Lỗi di chuyển (${error.message}) nhưng bot ĐÃ ĐỦ GẦN (${distAfterError.toFixed(2)} <= ${targetReach}). Thử ném đồ luôn.`);
                 try {
                     // Thử ném đồ ngay cả khi di chuyển lỗi nhưng đã đủ gần
                     console.log(`[Give Cmd] Bước 5 (Sau lỗi): Chuẩn bị ném ${quantity} ${itemId}...`);
                     await bot.lookAt(targetPlayer.position.offset(0, targetPlayer.height, 0));
                     await sleep(100);
                     await bot.toss(itemType.id, null, quantity);
                     bot.chat(`Của bạn nè ${username}! (${quantity} ${itemNameVi}) (Dù di chuyển hơi lỗi chút)`);
                     console.log(`[Give Cmd] Bước 5 (Sau lỗi): Đã ném thành công.`);
                     // Không return ở đây nếu muốn finally chạy dọn dẹp pathfinder
                 } catch (tossError) {
                      console.error("[Give Cmd] Bước 5 (Sau lỗi): Lỗi khi ném đồ:", tossError);
                      bot.chat(`Ối ${username}, tôi đến gần được rồi nhưng lại lỗi khi ném đồ! (${tossError.message})`);
                 }
             } else {
                 // Nếu lỗi path và vẫn còn xa
                 bot.chat(`Xin lỗi ${username}, tôi không tìm được đường đến chỗ bạn.`);
             }
             // === KẾT THÚC KIỂM TRA VỊ TRÍ ===

        } else if (error.message.toLowerCase().includes('toss')) { // Lỗi từ bot.toss
             console.error("[Give Cmd] Bước 5: Lỗi khi ném đồ:", error);
             bot.chat(`Ối ${username}, tôi gặp lỗi khi cố gắng ném đồ cho bạn! (${error.message})`);
        } else { // Lỗi không xác định khác
             console.error("[Give Cmd] Bước 5: Lỗi không xác định:", error);
             bot.chat(`Ối ${username}, tôi gặp lỗi không mong muốn khi cố đưa đồ cho bạn!`);
        }
        // Cố gắng dừng pathfinder nếu có lỗi xảy ra trong lúc nó đang chạy
        try {
            if (bot.pathfinder && bot.pathfinder.isMoving()) {
                bot.pathfinder.stop();
                console.log("[Give Cmd] Đã dừng pathfinder do lỗi.");
            }
        } catch (stopError) {
            console.error("[Give Cmd] Lỗi khi cố gắng dừng pathfinder:", stopError);
        }
    }
}

module.exports = {
    checkInventory,
    giveItem,
};