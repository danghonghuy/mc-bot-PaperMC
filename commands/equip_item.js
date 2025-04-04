// commands/equip_item.js
const { Vec3 } = require("vec3");
const { translateToEnglishId, formatCoords } = require("../utils");
const mcData = require('minecraft-data'); // Load một lần ở đầu

// Thứ tự ưu tiên vật liệu (để chọn đồ tốt nhất)
const materialTier = {
    leather: 1, wood: 1, stone: 2, chainmail: 3, golden: 3, iron: 4, diamond: 5, netherite: 6
};

function getMaterialTier(itemName) {
    if (!itemName) return 0;
    const name = itemName.toLowerCase();
    for (const material in materialTier) {
        if (name.startsWith(material)) {
            return materialTier[material];
        }
    }
    // Trường hợp đặc biệt không theo tiền tố (ví dụ: shield, elytra)
    if (name === 'shield') return 1;
    if (name === 'elytra') return 4; // Elytra coi như ngang Iron về độ "hiếm"/mong muốn
    return 0; // Không xác định
}

/**
 * Xác định slot trang bị phù hợp cho vật phẩm.
 * @param {object} item - Đối tượng Item từ minecraft-data.
 * @returns {string|null} - Tên slot ('hand', 'off-hand', 'head', 'torso', 'legs', 'feet') hoặc null.
 */
function getDestinationSlot(item) {
    if (!item) return null;
    const name = item.name;

    // Ưu tiên kiểm tra các slot cụ thể trước
    if (name.includes('_helmet')) return 'head';
    if (name.includes('_chestplate') || name === 'elytra') return 'torso'; // mcData dùng 'torso' cho chest slot
    if (name.includes('_leggings')) return 'legs';
    if (name.includes('_boots')) return 'feet';
    if (name === 'shield') return 'off-hand'; // Slot tay phụ
    if (name === 'totem_of_undying') return 'off-hand'; // Thường cầm ở tay phụ

    // Các loại còn lại mặc định vào tay chính
    return 'hand';
}

/**
 * Tìm và trang bị vật phẩm cụ thể.
 * (Giữ nguyên hàm này)
 * @param {import('mineflayer').Bot} bot
 * @param {string} username - Người yêu cầu.
 * @param {string} itemNameVi - Tên vật phẩm tiếng Việt.
 */
async function equipSpecificItem(bot, username, itemNameVi) {
    console.log(`[Equip Cmd] Yêu cầu trang bị vật phẩm cụ thể: "${itemNameVi}"`);
    const mc = mcData(bot.version);
    const itemId = translateToEnglishId(itemNameVi);
    if (!itemId) {
        bot.chat(`Xin lỗi ${username}, tôi không biết "${itemNameVi}" là gì.`);
        return false;
    }
    const itemType = mc.itemsByName[itemId];
    if (!itemType) {
        bot.chat(`Xin lỗi ${username}, "${itemNameVi}" (${itemId}) không phải là vật phẩm hợp lệ.`);
        return false;
    }

    console.debug(`[Equip Cmd] Đã dịch: ${itemNameVi} -> ${itemId} (ID: ${itemType.id})`);

    const itemInInventory = bot.inventory.findInventoryItem(itemType.id, null, false); // Tìm bất kỳ stack nào
    if (!itemInInventory) {
        bot.chat(`Xin lỗi ${username}, tôi không có "${itemNameVi}" trong túi đồ.`);
        console.log(`[Equip Cmd] Không tìm thấy ${itemId} trong inventory.`);
        return false;
    }

    const destination = getDestinationSlot(itemType);
    if (!destination) {
        console.error(`[Equip Cmd] Không thể xác định slot trang bị cho ${itemId}.`);
        bot.chat(`Tôi không chắc nên trang bị "${itemNameVi}" vào đâu.`);
        return false;
    }

    console.log(`[Equip Cmd] Tìm thấy ${itemId}. Đang cố gắng trang bị vào slot: ${destination}`);

    try {
        await bot.equip(itemInInventory, destination);
        console.log(`[Equip Cmd] Đã trang bị thành công ${itemInInventory.name} vào slot ${destination}.`);
        bot.chat(`Ok ${username}, đã trang bị ${itemNameVi}.`);
        return true;
    } catch (err) {
        console.error(`[Equip Cmd] Lỗi khi trang bị ${itemInInventory.name} vào ${destination}:`, err.message);
        if (err.message.toLowerCase().includes('destination slot')) {
             bot.chat(`Tôi không thể trang bị ${itemNameVi} vào vị trí đó.`);
        } else if (err.message.toLowerCase().includes('nothing to equip')) {
             bot.chat(`Lỗi lạ: Tôi không tìm thấy ${itemNameVi} để trang bị dù vừa thấy nó!`);
        } else {
             bot.chat(`Gặp lỗi khi cố gắng trang bị ${itemNameVi}.`);
        }
        return false;
    }
}

// ===== HÀM MỚI THAY THẾ equipBestArmorSet =====
/**
 * Tìm và trang bị món giáp TỐT NHẤT CÓ SẴN cho từng slot.
 * Không yêu cầu đủ bộ, có gì mặc nấy.
 * @param {import('mineflayer').Bot} bot
 * @param {string} username - Người yêu cầu.
 */
async function equipBestAvailableArmor(bot, username) {
    console.log(`[Equip Armor] Yêu cầu trang bị giáp tốt nhất có sẵn (không cần đủ bộ).`);
    const mc = mcData(bot.version);
    if (!mc) {
        console.error("[Equip Armor] Lỗi: Không thể tải mcData cho phiên bản", bot.version);
        bot.chat("Ối, có lỗi với dữ liệu game, không kiểm tra đồ được.");
        return false;
    }

    // ===== BỎ ĐOẠN KIỂM TRA mc.getEquipmentDestSlot ĐI =====
    // if (typeof mc.getEquipmentDestSlot !== 'function') {
    //      console.error("[Equip Armor] Lỗi: mc.getEquipmentDestSlot không phải là một hàm. mcData có thể bị thiếu hoặc không tương thích.");
    //      bot.chat("Lỗi cấu hình dữ liệu game rồi, không trang bị được.");
    //      return false;
    // }
    // ========================================================

    // ***** GIỮ LẠI ĐỊNH NGHĨA NÀY *****
    const armorSlotIndices = {
        head: 5,
        torso: 6,
        legs: 7,
        feet: 8
    };
    // ***** *****

    const armorSlots = ['head', 'torso', 'legs', 'feet']; // Giữ nguyên dùng tên slot để lặp
    const itemsToEquip = {}; // { head: item, torso: item, ... }
    const equippedItemsNames = []; // Lưu tên các món đã mặc thành công

    // 1. Tìm món tốt nhất cho từng slot trong inventory
    // ***** THAY ĐỔI CHỖ NÀY: Lặp qua tên slot *****
    for (const slotName of armorSlots) {
    // ***** *****
        let bestItemForSlot = null;
        let bestTierForSlot = -1;

        // ***** THAY ĐỔI CHỖ NÀY: Sử dụng armorSlotIndices thay vì mc.getEquipmentDestSlot *****
        const slotIndex = armorSlotIndices[slotName]; // Lấy index từ dict đã định nghĩa
        // Bỏ kiểm tra slotIndex vì chúng ta định nghĩa sẵn rồi
        // if (slotIndex === undefined || slotIndex === null) {
        //     console.warn(`[Equip Armor] Không tìm thấy slot index cho '${slotName}' trong định nghĩa thủ công. Bỏ qua slot này.`);
        //     continue;
        // }
        const currentEquipped = bot.inventory.slots[slotIndex]; // Lấy item đang mặc ở slot đó bằng index
        // ***** HẾT SỬA *****

        const currentEquippedTier = currentEquipped ? getMaterialTier(mc.items[currentEquipped.type]?.name) : -1;
        bestTierForSlot = currentEquippedTier;

        for (const item of bot.inventory.items()) {
            if (!item) continue;
            const itemInfo = mc.items[item.type];
            if (!itemInfo) continue;

            // ***** Dùng slotName để kiểm tra *****
            if (getDestinationSlot(itemInfo) === slotName) {
            // ***** *****
                const currentTier = getMaterialTier(itemInfo.name);
                if (currentTier > bestTierForSlot) {
                    bestTierForSlot = currentTier;
                    bestItemForSlot = item;
                    console.debug(`[Equip Armor] Tìm thấy ${itemInfo.name} (Tier ${currentTier}) tốt hơn đồ đang mặc cho slot ${slotName}.`);
                }
            }
        }
        if (bestItemForSlot) {
             // ***** Lưu bằng slotName *****
            itemsToEquip[slotName] = bestItemForSlot;
            // ***** *****
        }
    }

    // 2. Tiến hành trang bị những món đã chọn
    let equipCount = 0;
    if (Object.keys(itemsToEquip).length === 0) {
        bot.chat(`Tôi đã mặc đồ giáp tốt nhất có rồi, ${username}.`);
        console.log("[Equip Armor] Không có gì mới để trang bị.");
        return true;
    }

    console.log(`[Equip Armor] Bắt đầu trang bị các món giáp tốt hơn tìm được...`);
     // ***** Lặp qua slotName *****
    for (const slotName in itemsToEquip) {
    // ***** *****
        const item = itemsToEquip[slotName];
        const itemInfo = mc.items[item.type];
        // Sửa lỗi tiềm ẩn nếu customName không phải JSON hợp lệ
        let itemNameVi = itemInfo?.displayName || item.name; // Mặc định
        if (item.customName) {
            try {
                const customNameData = JSON.parse(item.customName);
                itemNameVi = customNameData.text || itemNameVi; // Lấy text nếu có
            } catch (e) {
                console.warn(`[Equip Armor] Lỗi phân tích customName: ${item.customName}`, e.message);
                // Giữ nguyên itemNameVi mặc định nếu lỗi
            }
        }


        try {
            // ***** Dùng slotName cho bot.equip *****
            console.debug(` - Trang bị ${item.name} (Display: ${itemNameVi}) vào slot ${slotName}...`);
            await bot.equip(item, slotName);
            // ***** *****
            console.debug(`   -> Thành công.`);
            equippedItemsNames.push(itemNameVi);
            equipCount++;
        } catch (err) {
            console.error(`[Equip Armor] Lỗi khi trang bị ${item.name} vào ${slotName}:`, err.message);
            bot.chat(`Gặp lỗi khi cố mặc ${itemNameVi}.`);
        }
    }

    // 3. Thông báo kết quả
    if (equipCount > 0) {
        bot.chat(`Ok ${username}, đã mặc thêm/thay thế: ${equippedItemsNames.join(', ')}.`);
        return true;
    } else {
        bot.chat(`Hmm, tôi tìm thấy đồ tốt hơn nhưng không mặc được món nào cả, ${username}.`);
        return false;
    }
}
/**
 * Tìm và trang bị tool/vũ khí tốt nhất của một loại.
 * (Giữ nguyên hàm này)
 * @param {import('mineflayer').Bot} bot
 * @param {string} username - Người yêu cầu.
 * @param {string} itemTypeName - Loại item (vd: 'sword', 'pickaxe', 'shield', 'torch').
 */
async function equipBestItemType(bot, username, itemTypeName) {
    console.log(`[Equip Cmd] Yêu cầu trang bị loại vật phẩm tốt nhất: "${itemTypeName}"`);
    const mc = mcData(bot.version);
    if (!mc) {
        console.error("[Equip Best Type] Lỗi: Không thể tải mcData cho phiên bản", bot.version);
        bot.chat("Ối, có lỗi với dữ liệu game, không kiểm tra đồ được.");
        return false;
    }

    let bestItem = null;
    let bestTier = -1;

    // Xác định slot đích dựa trên loại item
    let destination = 'hand'; // Mặc định
    // ***** KIỂM TRA CHÍNH XÁC HƠN *****
    if (itemTypeName === 'shield' || itemTypeName === 'totem' || itemTypeName === 'totem_of_undying') { // Thêm totem_of_undying
        destination = 'off-hand';
    }
    // ***** *****
    // (Các loại giáp đã được xử lý bởi equipBestAvailableArmor)

    console.debug(`[Equip Best Type] Tìm kiếm loại '${itemTypeName}', trang bị vào slot '${destination}'`);

    // Kiểm tra đồ đang cầm/mặc trước
    let currentEquippedItem = null;
    let currentTier = -1;
    // ***** THAY ĐỔI CHỖ NÀY *****
    const offHandSlotIndex = 45; // Chỉ số cố định cho slot tay phụ

    if (destination === 'hand') {
        currentEquippedItem = bot.heldItem; // Lấy đồ tay chính
        if (currentEquippedItem) {
            const itemInfo = mc.items[currentEquippedItem.type];
            // Chỉ lấy tier nếu đúng loại item đang tìm
            if (itemInfo && itemInfo.name.includes(itemTypeName)) {
                currentTier = getMaterialTier(itemInfo.name);
            } else {
                currentTier = -1; // Không cầm đúng loại -> coi như tier -1
            }
        } else {
            currentTier = -1; // Không cầm gì -> tier -1
        }
    } else if (destination === 'off-hand') {
        currentEquippedItem = bot.inventory.slots[offHandSlotIndex]; // Lấy đồ tay phụ bằng index
        if (currentEquippedItem) {
            const itemInfo = mc.items[currentEquippedItem.type];
            // Chỉ lấy tier nếu đúng loại item đang tìm
             // Shield/Totem có thể coi là tier 1 hoặc 0 tùy getMaterialTier
            if (itemInfo && (itemInfo.name === itemTypeName || itemInfo.name.includes(itemTypeName))) { // Kiểm tra chính xác hơn
                 currentTier = getMaterialTier(itemInfo.name);
            } else {
                 currentTier = -1; // Không cầm đúng loại -> coi như tier -1
            }
        } else {
             currentTier = -1; // Không cầm gì -> tier -1
        }
    }
    // ***** HẾT THAY ĐỔI *****

    bestTier = currentTier; // Mặc định đồ đang cầm là tốt nhất ban đầu
    // console.debug(`[Equip Best Type] Đồ đang giữ/mặc ở slot ${destination} có tier ${bestTier}.`);


    for (const item of bot.inventory.items()) {
        if (!item) continue;
        const itemInfo = mc.items[item.type];
        if (!itemInfo) continue;

        // Kiểm tra xem item có khớp loại không VÀ CÓ PHẢI SLOT ĐÚNG KHÔNG
        if (itemInfo.name.includes(itemTypeName) && getDestinationSlot(itemInfo) === destination) {
            const itemTierInInventory = getMaterialTier(itemInfo.name);
            // console.debug(` - Tìm thấy trong túi đồ: ${itemInfo.name} (Tier: ${itemTierInInventory})`);
            if (itemTierInInventory > bestTier) {
                bestTier = itemTierInInventory;
                bestItem = item; // Chỉ gán bestItem nếu nó tốt hơn đồ đang cầm/mặc
                console.debug(`   -> Tốt hơn đồ đang trang bị, chọn ${itemInfo.name} làm bestItem.`);
            }
        }
    }

    if (!bestItem) {
        // Nếu không tìm thấy món nào tốt hơn trong túi đồ
        if (currentTier > -1) { // Kiểm tra xem có đang cầm đúng loại đồ không
             bot.chat(`Tôi đang cầm ${itemTypeName} tốt nhất có rồi, ${username}.`);
             console.log(`[Equip Best Type] Đã trang bị ${itemTypeName} tốt nhất.`);
             return true; // Vẫn là thành công vì đã trang bị đồ tốt nhất
        } else {
             bot.chat(`Xin lỗi ${username}, tôi không tìm thấy ${itemTypeName} nào trong túi đồ cả.`);
             console.log(`[Equip Best Type] Không tìm thấy item loại '${itemTypeName}'.`);
             return false;
        }

    }

    // Nếu tìm thấy món tốt hơn trong túi đồ
    console.log(`[Equip Best Type] Vật phẩm tốt nhất tìm thấy: ${bestItem.name}. Đang trang bị vào slot ${destination}...`);
    try {
        await bot.equip(bestItem, destination);
        console.log(`[Equip Best Type] Đã trang bị thành công ${bestItem.name} vào slot ${destination}.`);
        bot.chat(`Ok ${username}, đã trang bị ${bestItem.displayName || bestItem.name}.`);
        return true;
    } catch (err) {
        console.error(`[Equip Best Type] Lỗi khi trang bị ${bestItem.name} vào ${destination}:`, err.message);
        bot.chat(`Gặp lỗi khi cố gắng trang bị ${bestItem.displayName || bestItem.name}.`);
        return false;
    }
}


/**
 * Hàm chính xử lý yêu cầu trang bị.
 * @param {import('mineflayer').Bot} bot
 * @param {string} username - Người yêu cầu.
 * @param {string} message - Tin nhắn gốc.
 * @param {import("@google/generative-ai").GenerativeModel} aiModel - Mô hình AI.
 */
async function startEquipItemTask(bot, username, message, aiModel) {
    console.log(`[Equip Cmd] Xử lý yêu cầu trang bị từ ${username}: "${message}"`);

    // --- Bước 1: Trích xuất vật phẩm hoặc loại chung ---
    // (Giữ nguyên logic trích xuất bằng AI)
    const extractionPrompt = `Từ tin nhắn "${message}" của người chơi "${username}" muốn bot trang bị/cầm/mặc/đeo một vật phẩm, hãy trích xuất TÊN VẬT PHẨM CỤ THỂ (ví dụ: kiếm kim cương, giáp sắt, khiên, đuốc) hoặc LOẠI VẬT PHẨM CHUNG nếu không rõ (ví dụ: kiếm, giáp, cuốc, rìu).
    Ưu tiên tên cụ thể nếu có. Nếu yêu cầu mặc GIÁP CHUNG CHUNG mà không chỉ rõ loại vật liệu, hãy trả về "giáp".

    Chỉ trả lời bằng định dạng JSON với cấu trúc:
    {"itemName": "tên_vật_phẩm_tiếng_việt_hoặc_loại_chung"}

    Ví dụ:
    1. "cầm kiếm sắt đi" -> {"itemName": "kiếm sắt"}
    2. "mặc bộ giáp kim cương vào" -> {"itemName": "giáp kim cương"} // Trả về loại giáp cụ thể
    3. "cầm khiên" -> {"itemName": "khiên"}
    4. "dùng đuốc" -> {"itemName": "đuốc"}
    5. "mặc giáp đi" -> {"itemName": "giáp"} // Loại chung
    6. "cầm kiếm coi" -> {"itemName": "kiếm"} // Loại chung
    7. "trang bị cuốc xịn nhất" -> {"itemName": "cuốc"} // Loại chung
    8. "mặc đồ vô" -> {"itemName": "giáp"} // Coi như mặc giáp chung

    Tin nhắn: "${message}"
    JSON:`;

    let itemNameRequest = null; // Tên tiếng Việt hoặc loại chung

    try {
        console.debug("[Equip Cmd] Bước 1: Gửi prompt trích xuất item/loại...");
        const extractResult = await aiModel.generateContent(extractionPrompt);
        const jsonResponse = (await extractResult.response.text()).trim();
        console.debug("[Equip Cmd] Bước 1: Phản hồi JSON thô:", jsonResponse);
        let parsedData;
        const jsonMatch = jsonResponse.match(/\{.*\}/s);
        if (jsonMatch) parsedData = JSON.parse(jsonMatch[0]);
        else throw new Error("Không tìm thấy JSON.");

        if (!parsedData.itemName) {
            throw new Error("JSON trả về không hợp lệ (thiếu itemName).");
        }
        itemNameRequest = parsedData.itemName.toLowerCase(); // Chuẩn hóa về chữ thường
        console.log(`[Equip Cmd] Bước 1: AI trích xuất yêu cầu: "${itemNameRequest}"`);

    } catch (error) {
        console.error("[Equip Cmd] Bước 1: Lỗi trích xuất hoặc xử lý JSON:", error);
        bot.chat(`Xin lỗi ${username}, tôi không hiểu bạn muốn trang bị gì.`);
        return;
    }

    // --- Bước 2: Phân loại yêu cầu và thực hiện ---
    let success = false;

    // Xử lý các trường hợp loại chung trước
    if (itemNameRequest === 'giáp' || itemNameRequest === 'áo giáp' || itemNameRequest === 'đồ giáp') {
        // ===== THAY ĐỔI CHỖ NÀY =====
        success = await equipBestAvailableArmor(bot, username); // Gọi hàm mới
        // ============================
    } else if (itemNameRequest === 'kiếm') {
        success = await equipBestItemType(bot, username, 'sword');
    } else if (itemNameRequest === 'cuốc' || itemNameRequest === 'cúp') {
        success = await equipBestItemType(bot, username, 'pickaxe');
    } else if (itemNameRequest === 'rìu') {
        success = await equipBestItemType(bot, username, 'axe');
    } else if (itemNameRequest === 'xẻng') {
        success = await equipBestItemType(bot, username, 'shovel');
    } else if (itemNameRequest === 'cuốc đất') { // Phân biệt với cuốc đào đá
        success = await equipBestItemType(bot, username, 'hoe');
    } else if (itemNameRequest === 'khiên') {
        success = await equipBestItemType(bot, username, 'shield'); // Dùng equipBestItemType cho shield để ktra đồ đang cầm
    } else if (itemNameRequest === 'đuốc') {
        success = await equipBestItemType(bot, username, 'torch'); // Dùng equipBestItemType cho torch
    } else if (itemNameRequest === 'totem' || itemNameRequest === 'totem of undying') {
         success = await equipBestItemType(bot, username, 'totem'); // Dùng equipBestItemType cho totem
    }
    // Xử lý trường hợp tên cụ thể (bao gồm cả các món giáp lẻ)
    else {
        // Kiểm tra xem có phải yêu cầu mặc cả bộ giáp cụ thể không (ví dụ: "giáp kim cương")
        let isSpecificArmorSetRequest = false;
        let material = null;
        for (const mat in materialTier) {
            // Phải chứa cả tên vật liệu VÀ chữ "giáp"
            if (itemNameRequest.includes(mat) && (itemNameRequest.includes('giáp') || itemNameRequest.includes('bộ'))) {
                 isSpecificArmorSetRequest = true;
                 material = mat;
                 console.log(`[Equip Cmd] Phát hiện yêu cầu liên quan đến bộ giáp ${material}.`);
                 break;
            }
        }

        if (isSpecificArmorSetRequest) {
             // Nếu yêu cầu bộ giáp cụ thể (vd: "mặc giáp sắt"), ta vẫn dùng logic mặc đồ tốt nhất hiện có
             // Vì việc tìm và mặc *đúng* bộ cụ thể đó khá phức tạp (phải kiểm tra đủ 4 món)
             // và thường người dùng chỉ muốn mặc đồ tốt nhất họ có thuộc loại đó.
             console.warn(`[Equip Cmd] Yêu cầu bộ giáp ${material}, sẽ trang bị đồ tốt nhất hiện có.`);
             // ===== THAY ĐỔI CHỖ NÀY =====
             success = await equipBestAvailableArmor(bot, username); // Vẫn gọi hàm mới
             // ============================
        } else {
             // Nếu không phải loại chung hoặc bộ giáp, coi như tên item cụ thể
             success = await equipSpecificItem(bot, username, itemNameRequest);
        }
    }

    // Log kết quả cuối cùng
    if (success) {
        console.log(`[Equip Cmd] Hoàn thành yêu cầu trang bị "${itemNameRequest}" cho ${username}.`);
    } else {
        console.log(`[Equip Cmd] Không thể hoàn thành yêu cầu trang bị "${itemNameRequest}" cho ${username}.`);
    }
}


module.exports = {
    startEquipItemTask,
    // Không cần export các hàm helper
};