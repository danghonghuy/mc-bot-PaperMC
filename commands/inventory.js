// commands/inventory.js
const { GoalNear } = require("mineflayer-pathfinder").goals;
const { Vec3 } = require("vec3");
const { translateToEnglishId, formatCoords } = require("../utils");

const GIVE_ITEM_MAX_DIST = 5; // Khoảng cách tối đa để bot tự ném đồ
const GIVE_ITEM_REACH_DIST = 2; // Khoảng cách bot cần đến gần người chơi

/**
 * Liệt kê các vật phẩm trong túi đồ của bot.
 * @param {import('mineflayer').Bot} bot
 * @param {string} username
 */
function checkInventory(bot, username) {
    console.log(`[Inv Cmd] ${username} yêu cầu kiểm tra túi đồ.`);
    const items = bot.inventory.items();

    if (items.length === 0) {
        bot.chat(`${username}, túi đồ của tôi trống rỗng!`);
        return;
    }

    // Nhóm các vật phẩm giống nhau và đếm số lượng
    const itemCounts = items.reduce((acc, item) => {
        const name = item.displayName || item.name; // Ưu tiên displayName
        acc[name] = (acc[name] || 0) + item.count;
        return acc;
    }, {});

    // Tạo chuỗi danh sách vật phẩm
    const itemList = Object.entries(itemCounts)
        .map(([name, count]) => `${count} ${name}`)
        .join(', ');

    bot.chat(`${username}, trong túi tôi có: ${itemList}.`);
    console.log(`[Inv Cmd] Đã liệt kê túi đồ cho ${username}.`);
}

/**
 * Đưa (ném) vật phẩm cho người chơi.
 * @param {import('mineflayer').Bot} bot
 * @param {string} username - Người yêu cầu
 * @param {string} message - Tin nhắn gốc
 * @param {import("@google/generative-ai").GenerativeModel} aiModel
 */
async function giveItem(bot, username, message, aiModel) {
    console.log(`[Give Cmd] Bắt đầu xử lý yêu cầu đưa đồ từ ${username}: "${message}"`);

    if (bot.isFinding || bot.isFollowing) {
        bot.chat(`${username}, tôi đang bận việc khác (${bot.isFinding ? 'tìm đồ' : 'đi theo người khác'}), không đưa đồ được!`);
        console.log(`[Give Cmd] Bị chặn do đang ${bot.isFinding ? 'tìm đồ' : 'đi theo'}.`);
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
            const jsonMatch = jsonResponse.match(/\{.*\}/s);
            if (jsonMatch) parsedData = JSON.parse(jsonMatch[0]);
            else throw new Error("Không tìm thấy JSON.");
        } catch (parseError) {
             console.error("[Give Cmd] Bước 1: Lỗi parse JSON:", parseError, "Response:", jsonResponse);
             // Fallback đơn giản: coi cả chuỗi là tên item nếu không parse được JSON
             if (!jsonResponse.includes('{') && !jsonResponse.includes(':')) {
                 itemNameVi = jsonResponse.trim(); quantity = 1;
                 console.log(`[Give Cmd] Bước 1 Fallback: Name="${itemNameVi}", Quantity=1.`);
             } else throw new Error("Không thể phân tích phản hồi AI.");
        }
        if (parsedData) {
            itemNameVi = parsedData.itemName;
            quantity = parseInt(parsedData.quantity, 10) || 1;
        }
        if (!itemNameVi) throw new Error("AI không trích xuất được tên vật phẩm.");
        quantity = Math.max(1, quantity); // Đảm bảo số lượng ít nhất là 1
        console.log(`[Give Cmd] Bước 1: AI trích xuất: Tên="${itemNameVi}", Số lượng=${quantity}`);
    } catch (error) {
        console.error("[Give Cmd] Bước 1: Lỗi trích xuất:", error);
        bot.chat(`Xin lỗi ${username}, tôi không hiểu bạn muốn lấy gì hoặc số lượng bao nhiêu.`);
        return;
    }

    // --- Bước 2: Dịch tên vật phẩm sang ID ---
    let itemId;
    let mcData;
    try {
        console.log(`[Give Cmd] Bước 2: Dịch "${itemNameVi}"...`);
        itemId = translateToEnglishId(itemNameVi);
        if (!itemId) {
            bot.chat(`Xin lỗi ${username}, tôi không biết "${itemNameVi}" là vật phẩm gì.`);
            console.log(`[Give Cmd] Bước 2: Không dịch được "${itemNameVi}".`);
            return;
        }
        mcData = require('minecraft-data')(bot.version);
        if (!mcData.itemsByName[itemId] && !mcData.blocksByName[itemId]) { // Kiểm tra xem ID có hợp lệ không
             bot.chat(`Xin lỗi ${username}, hình như "${itemNameVi}" (${itemId}) không phải là vật phẩm tôi có thể cầm.`);
             console.log(`[Give Cmd] Bước 2: ID "${itemId}" không hợp lệ trong minecraft-data.`);
             return;
        }
        console.log(`[Give Cmd] Bước 2: Đã dịch thành ID: "${itemId}"`);
    } catch (error) {
        console.error("[Give Cmd] Bước 2: Lỗi khi dịch hoặc kiểm tra mcData:", error);
        bot.chat(`Xin lỗi ${username}, có lỗi khi tìm thông tin vật phẩm "${itemNameVi}".`);
        return;
    }

    // --- Bước 3: Tìm người chơi yêu cầu ---
    const usernameWithDot = '.' + username;
    const targetPlayer = bot.players[username]?.entity || bot.nearestEntity(entity =>
        entity.type === 'player' && (entity.username === username || entity.username === usernameWithDot)
    );

    if (!targetPlayer || !targetPlayer.position) {
        bot.chat(`Ơ ${username}, bạn ở đâu rồi? Tôi không thấy bạn để đưa đồ!`);
        console.log(`[Give Cmd] Bước 3: Không tìm thấy người chơi ${username} hoặc vị trí.`);
        return;
    }
    console.log(`[Give Cmd] Bước 3: Tìm thấy ${targetPlayer.username} tại ${formatCoords(targetPlayer.position)}.`);

    // --- Bước 4: Kiểm tra vật phẩm trong túi đồ ---
    let itemType;
    try {
        itemType = mcData.itemsByName[itemId] || mcData.blocksByName[itemId]; // Lấy thông tin item/block
        if (!itemType) throw new Error(`Không tìm thấy item data cho ID ${itemId}`);

        const itemsInInventory = bot.inventory.findInventoryItem(itemType.id, null, false); // Tìm item trong inventory (không cần full stack)

        if (!itemsInInventory) {
            bot.chat(`Xin lỗi ${username}, tôi không có "${itemNameVi}" trong túi.`);
            console.log(`[Give Cmd] Bước 4: Không tìm thấy ${itemId} trong túi đồ.`);
            return;
        }

        // Tính tổng số lượng bot có
        const totalAmount = bot.inventory.count(itemType.id, null);

        if (totalAmount < quantity) {
            bot.chat(`Xin lỗi ${username}, tôi chỉ có ${totalAmount} cái "${itemNameVi}", không đủ ${quantity} cái.`);
            console.log(`[Give Cmd] Bước 4: Không đủ số lượng (có ${totalAmount}, cần ${quantity}).`);
            return;
        }
        console.log(`[Give Cmd] Bước 4: Tìm thấy ${itemId} trong túi, có ${totalAmount} (cần ${quantity}).`);

    } catch (error) {
        console.error("[Give Cmd] Bước 4: Lỗi khi kiểm tra túi đồ:", error);
        bot.chat(`Xin lỗi ${username}, tôi gặp lỗi khi kiểm tra túi đồ.`);
        return;
    }

    // --- Bước 5: Di chuyển (nếu cần) và Ném đồ ---
    const distance = bot.entity.position.distanceTo(targetPlayer.position);
    console.log(`[Give Cmd] Bước 5: Khoảng cách tới ${targetPlayer.username}: ${distance.toFixed(2)} blocks.`);

    try {
        if (distance > GIVE_ITEM_MAX_DIST) {
            bot.chat(`${username}, bạn đứng xa quá (${distance.toFixed(0)} blocks), lại gần đây (khoảng ${GIVE_ITEM_REACH_DIST}-${GIVE_ITEM_MAX_DIST} blocks) tôi đưa cho!`);
            console.log(`[Give Cmd] Bước 5: Người chơi quá xa, yêu cầu lại gần.`);
            // Tùy chọn: Có thể thêm logic pathfinder ở đây nếu muốn bot tự đi lại gần
            // await bot.pathfinder.goto(new GoalNear(targetPlayer.position.x, targetPlayer.position.y, targetPlayer.position.z, GIVE_ITEM_REACH_DIST));
            // console.log(`[Give Cmd] Bước 5: Đã đến gần ${targetPlayer.username}.`);
            // Sau khi đến gần cần kiểm tra lại khoảng cách trước khi ném
            // const newDistance = bot.entity.position.distanceTo(targetPlayer.position);
            // if (newDistance > GIVE_ITEM_MAX_DIST) { ... xử lý lỗi ... }
            return; // Dừng lại ở đây nếu dùng cách yêu cầu người chơi lại gần
        }

        // Đủ gần, tiến hành ném
        console.log(`[Give Cmd] Bước 5: Đủ gần, chuẩn bị ném ${quantity} ${itemId}...`);
        await bot.toss(itemType.id, null, quantity);
        bot.chat(`Của bạn nè ${username}! (${quantity} ${itemNameVi})`);
        console.log(`[Give Cmd] Bước 5: Đã ném thành công ${quantity} ${itemId} cho ${username}.`);

    } catch (error) {
        console.error("[Give Cmd] Bước 5: Lỗi khi di chuyển hoặc ném đồ:", error);
        bot.chat(`Ối ${username}, tôi gặp lỗi khi cố gắng đưa đồ cho bạn! (${error.message})`);
        // Cố gắng dừng pathfinder nếu có lỗi xảy ra trong lúc nó đang chạy (nếu bạn thêm logic pathfinder)
        // try { if (bot.pathfinder?.isMoving()) bot.pathfinder.stop(); } catch (e) {}
    }
}

module.exports = {
    checkInventory,
    giveItem,
};