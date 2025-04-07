// auto_loot.js
const { goals } = require("mineflayer-pathfinder");
const { Vec3 } = require("vec3");
const mcData = require("minecraft-data");

let bot = null;
let valuableItemIds = new Set(); // Set chứa ID các vật phẩm hiếm
let checkInterval = null;
let isCheckingOrLooting = false; // Cờ để tránh chạy nhiều lần cùng lúc
let currentTargetItem = null; // Item đang nhắm tới
const CHECK_RADIUS = 24; // Bán kính quét
const CHECK_INTERVAL_MS = 200000; // Quét mỗi 3 giây
const MIN_DISTANCE_TO_LOOT = 1.5; // Khoảng cách đủ gần để nhặt

function initializeAutoLoot(_bot, itemsConfig) {
    bot = _bot;
    const data = mcData(bot.version);
    if (!data) {
        console.error("[AutoLoot] Không thể tải mcData!");
        return;
    }

    // Chuyển tên item thành ID và thêm vào Set
    itemsConfig.forEach(itemName => {
        const item = data.itemsByName[itemName];
        if (item) {
            valuableItemIds.add(item.id);
            console.log(`[AutoLoot] Added valuable item: ${itemName} (ID: ${item.id})`);
        } else {
            console.warn(`[AutoLoot] Không tìm thấy item tên '${itemName}' trong mcData.`);
        }
    });

    if (valuableItemIds.size === 0) {
        console.warn("[AutoLoot] Không có item hiếm nào được cấu hình. Tính năng sẽ không hoạt động.");
        return;
    }

    console.log(`[AutoLoot] Đã khởi tạo với ${valuableItemIds.size} item hiếm. Bán kính quét: ${CHECK_RADIUS} blocks.`);
    startChecking();
}

function stopAutoLoot(reason = "Unknown reason") {
    console.log(`[AutoLoot] Dừng quét và nhặt đồ. Lý do: ${reason}`);
    if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
    }
    // Nếu đang di chuyển đến item, dừng lại
    if (isCheckingOrLooting && bot.pathfinder && bot.pathfinder.isMoving()) {
        bot.pathfinder.stop();
        console.log("[AutoLoot] Đã dừng di chuyển.");
    }
    isCheckingOrLooting = false;
    currentTargetItem = null;
    // Cập nhật trạng thái chính của bot nếu cần (sẽ làm ở bot.js)
    if (bot) bot.isLooting = false;
}

function startChecking() {
    if (checkInterval) {
        clearInterval(checkInterval); // Đảm bảo chỉ có 1 interval chạy
    }
    checkInterval = setInterval(scanAndLoot, CHECK_INTERVAL_MS);
    console.log(`[AutoLoot] Bắt đầu quét vật phẩm hiếm mỗi ${CHECK_INTERVAL_MS / 1000} giây.`);
}

async function scanAndLoot() {
    // Điều kiện không quét/nhặt
    if (!bot || !bot.entity || isCheckingOrLooting || bot.isSleeping || bot.isDefending || bot.isUsingHeldItem || bot.isDigging || bot.isBuilding || bot.isFlattening || bot.isFarmingWheat /* || thêm các trạng thái bận khác nếu cần */) {
        // console.log("[AutoLoot] Bỏ qua quét (bot bận hoặc không hợp lệ).");
        return;
    }

    // Chỉ quét nếu bot không di chuyển theo lệnh khác (trừ khi đang loot)
    if (bot.pathfinder && bot.pathfinder.isMoving() && !bot.isLooting) {
        // console.log("[AutoLoot] Bỏ qua quét (bot đang di chuyển cho việc khác).");
        return;
    }

    isCheckingOrLooting = true; // Đánh dấu bắt đầu kiểm tra
    bot.isLooting = true; // Đặt trạng thái trên bot chính

    try {
        const nearbyItems = findValuableItemsNearby();

        if (nearbyItems.length > 0) {
            // Sắp xếp theo khoảng cách, ưu tiên item gần nhất
            nearbyItems.sort((a, b) => a.distance - b.distance);
            const targetItem = nearbyItems[0]; // Lấy item gần nhất

            // Kiểm tra xem có đang nhắm item này chưa
            if (currentTargetItem && currentTargetItem.id === targetItem.entity.id) {
                 // console.log(`[AutoLoot] Vẫn đang di chuyển tới item ${targetItem.name}.`);
                 isCheckingOrLooting = false; // Cho phép quét lại ở lần sau
                 bot.isLooting = true; // Vẫn đang trong trạng thái loot
                 return; // Đang xử lý item này rồi, không cần làm gì thêm
            }

            // Nếu đang nhắm item khác hoặc chưa nhắm, chuyển mục tiêu
            if (bot.pathfinder.isMoving()) {
                bot.pathfinder.stop(); // Dừng di chuyển cũ nếu có
            }

            currentTargetItem = targetItem.entity; // Lưu entity của item mục tiêu
            const itemName = targetItem.name;
            const itemPos = targetItem.entity.position;
            const distance = targetItem.distance;

            console.log(`[AutoLoot] Phát hiện item hiếm: ${itemName} tại ${itemPos.toString()} (cách ${distance.toFixed(1)} blocks). Đang chạy tới nhặt!`);
            try {
                bot.chat(`Ố! Thấy ${itemName} rơi kìa! Để tôi chạy lại nhặt!`);
            } catch (chatErr) {
                console.warn("[AutoLoot] Lỗi gửi tin nhắn chat:", chatErr.message);
            }

            const goal = new goals.GoalNear(itemPos.x, itemPos.y, itemPos.z, MIN_DISTANCE_TO_LOOT);
            await bot.pathfinder.goto(goal);

            // Khi đến nơi (hoặc thất bại/bị ngắt)
            console.log(`[AutoLoot] Đã đến gần vị trí ${itemName} hoặc dừng di chuyển.`);
            // Kiểm tra xem item còn tồn tại không (có thể đã bị người khác nhặt hoặc despawn)
             const finalCheckItem = bot.entities[currentTargetItem.id];
             if (finalCheckItem) {
                 console.log(`[AutoLoot] Đã nhặt ${itemName} (hoặc đến rất gần).`);
                 // Mineflayer thường tự nhặt, không cần hành động thêm
             } else {
                 console.log(`[AutoLoot] Item ${itemName} đã biến mất trước khi nhặt được.`);
             }

        } else {
            // console.log("[AutoLoot] Không tìm thấy item hiếm nào xung quanh.");
            // Nếu không còn item nào và đang trong trạng thái looting (có thể là do item cũ đã mất), reset lại
            if(bot.isLooting && !currentTargetItem) { // Chỉ reset nếu không có mục tiêu cụ thể nào
                 // console.log("[AutoLoot] Resetting state as no items found and was looting previously without specific target.");
                 bot.isLooting = false;
            }
        }

    } catch (error) {
        console.error("[AutoLoot] Lỗi trong quá trình quét và nhặt:", error);
        if (bot.pathfinder && bot.pathfinder.isMoving()) {
            bot.pathfinder.stop(); // Dừng di chuyển nếu có lỗi
        }
    } finally {
        // Rất quan trọng: reset cờ sau khi xử lý xong hoặc lỗi
        isCheckingOrLooting = false;
        // Chỉ reset bot.isLooting nếu không còn mục tiêu nào nữa
        if (!currentTargetItem || !bot.entities[currentTargetItem.id]) {
             currentTargetItem = null;
             bot.isLooting = false; // Reset trạng thái chính
            // console.log("[AutoLoot] Reset target and bot state.");
        } else {
            // Nếu target vẫn còn, giữ trạng thái isLooting để lần quét sau biết là đang nhắm tới nó
            // console.log("[AutoLoot] Target item still exists, keeping bot.isLooting state.");
             bot.isLooting = true; // Ensure it stays true
        }
    }
}

function findValuableItemsNearby() {
    const valuableFound = [];
    const data = mcData(bot.version); // Lấy data để lấy tên item

    for (const id in bot.entities) {
        const entity = bot.entities[id];

        // Kiểm tra xem có phải là item rơi ra không ('object' và objectType 'Item')
        if (entity.type === 'object' && entity.objectType === 'Item' && entity.position && entity.itemId) {
            // entity.itemId là ID dạng số của item (vd: 264 cho kim cương trong bản cũ)
            // Cần kiểm tra xem ID này có trong danh sách item hiếm không
            if (valuableItemIds.has(entity.itemId)) {
                const distance = bot.entity.position.distanceTo(entity.position);
                if (distance <= CHECK_RADIUS) {
                    const itemInfo = data.items[entity.itemId]; // Lấy thông tin item từ ID
                    valuableFound.push({
                        entity: entity,
                        name: itemInfo ? itemInfo.displayName : `Item ID ${entity.itemId}`, // Lấy tên hiển thị
                        distance: distance
                    });
                }
            }
        }
        // Cần kiểm tra thêm các phiên bản mới hơn, metadata có thể khác
        // Ví dụ kiểm tra metadata nếu entity.itemId không tồn tại trực tiếp
        else if (entity.type === 'object' && entity.objectType === 'Item' && entity.position && entity.metadata) {
             // Cấu trúc metadata có thể thay đổi, cần kiểm tra kỹ với phiên bản MC cụ thể
             // Thử tìm metadata chứa thông tin item (thường là index cuối hoặc gần cuối)
             const itemMeta = entity.metadata.find(meta => meta && typeof meta === 'object' && meta.itemId !== undefined); // Tìm phần tử metadata có itemId
             if (itemMeta && valuableItemIds.has(itemMeta.itemId)) {
                 const distance = bot.entity.position.distanceTo(entity.position);
                 if (distance <= CHECK_RADIUS) {
                    const itemInfo = data.items[itemMeta.itemId];
                    valuableFound.push({
                         entity: entity,
                         name: itemInfo ? itemInfo.displayName : `Item ID ${itemMeta.itemId}`,
                         distance: distance
                    });
                 }
             }
        }
    }
    return valuableFound;
}

module.exports = {
    initializeAutoLoot,
    stopAutoLoot,
    // Không cần export startChecking và scanAndLoot vì chúng được gọi nội bộ
};