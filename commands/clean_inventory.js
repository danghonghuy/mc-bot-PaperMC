// commands/clean_inventory.js
const { GoalNear } = require("mineflayer-pathfinder").goals;
const { Vec3 } = require("vec3");
const { formatCoords } = require("../utils");
const junkItemIds = require('../junk_items'); // Nạp danh sách rác

const DISPOSAL_SEARCH_RADIUS = 32;
const DISPOSAL_REACH_DIST = 3; // Đứng cách xa một chút để an toàn
const MAX_ITEMS_TO_TOSS_PER_CYCLE = 5; // Giới hạn số stack vứt mỗi lần để tránh lag/lỗi

let mcData; // Biến toàn cục cho module để lưu mcData

/**
 * Tìm các vật phẩm rác trong túi đồ.
 * @param {import('mineflayer').Bot} bot
 * @returns {Array<import('prismarine-item').Item>} Danh sách các item rác (đã gộp stack).
 */
function findJunkItems(bot) {
    if (!mcData) mcData = require('minecraft-data')(bot.version);
    const junkItemsFound = [];
    const junkSet = new Set(junkItemIds); // Dùng Set để tra cứu nhanh hơn

    // Chỉ kiểm tra inventory chính, bỏ qua hotbar, giáp, offhand
    const mainInventorySlots = bot.inventory.slots.slice(9, 36 + 9); // Slot 9-44

    for (const item of mainInventorySlots) {
        if (item && junkSet.has(item.name)) {
            // Kiểm tra xem có phải đồ đã đặt tên không (thường không muốn vứt)
            if (!item.customName) {
                 console.log(`[CleanInv] Found junk: ${item.count}x ${item.name}`);
                 junkItemsFound.push(item);
            } else {
                 console.log(`[CleanInv] Skipping named junk item: ${item.customName} (${item.name})`);
            }
        }
    }
    return junkItemsFound;
}

/**
 * Tìm vị trí vứt đồ an toàn (dung nham hoặc xương rồng).
 * @param {import('mineflayer').Bot} bot
 * @returns { {position: Vec3, type: 'lava' | 'cactus'} | null }
 */
function findDisposalLocation(bot) {
    if (!mcData) mcData = require('minecraft-data')(bot.version);
    const lavaBlock = mcData.blocksByName.lava;
    const cactusBlock = mcData.blocksByName.cactus;

    // Ưu tiên tìm dung nham trước
    const lava = bot.findBlock({
        matching: lavaBlock.id,
        maxDistance: DISPOSAL_SEARCH_RADIUS,
        count: 1,
        useExtraInfo: (block) => block.metadata === 0 // Chỉ tìm nguồn dung nham (đứng yên)
    });

    if (lava) {
        console.log(`[CleanInv] Found lava at ${formatCoords(lava.position)}`);
        return { position: lava.position, type: 'lava' };
    }

    // Nếu không có dung nham, tìm xương rồng
    const cactus = bot.findBlock({
        matching: cactusBlock.id,
        maxDistance: DISPOSAL_SEARCH_RADIUS,
        count: 1
    });

    if (cactus) {
        console.log(`[CleanInv] Found cactus at ${formatCoords(cactus.position)}`);
        return { position: cactus.position, type: 'cactus' };
    }

    console.log(`[CleanInv] No suitable disposal location (lava/cactus) found within ${DISPOSAL_SEARCH_RADIUS} blocks.`);
    return null;
}

/**
 * Di chuyển đến gần và vứt các vật phẩm rác.
 * @param {import('mineflayer').Bot} bot
 */
async function disposeItemsLoop(bot) {
    if (!bot.isCleaningInventory || !bot.cleaningTaskDetails) return;

    const task = bot.cleaningTaskDetails;

    if (!task.disposalLocation) {
        console.error("[CleanInv] disposeItemsLoop called without disposalLocation.");
        finishCleaningInventory(bot, false, "Lỗi: Không tìm thấy vị trí vứt đồ.");
        return;
    }
    if (task.itemsToToss.length === 0) {
        finishCleaningInventory(bot, true, "Đã vứt hết đồ rác.");
        return;
    }

    try {
        const disposalPos = task.disposalLocation.position;
        const distance = bot.entity.position.distanceTo(disposalPos);

        // Di chuyển nếu chưa đủ gần
        if (distance > DISPOSAL_REACH_DIST + 1) { // +1 để có khoảng trống
            if (!bot.pathfinder.isMoving()) {
                console.log(`[CleanInv] Moving closer to disposal location ${formatCoords(disposalPos)} (Distance: ${distance.toFixed(1)}m)`);
                const goal = new GoalNear(disposalPos.x, disposalPos.y, disposalPos.z, DISPOSAL_REACH_DIST);
                try {
                    await bot.pathfinder.goto(goal);
                    console.log(`[CleanInv] Reached near disposal location.`);
                    // Gọi lại ngay để bắt đầu vứt
                    disposeItemsLoop(bot);
                    return;
                } catch (err) {
                    console.error(`[CleanInv] Error moving to disposal location: ${err.message}`);
                    finishCleaningInventory(bot, false, "Không thể đến được nơi vứt đồ.");
                    return;
                }
            } else {
                 console.log(`[CleanInv] Already moving to disposal location...`);
                 // Chờ pathfinder hoàn thành, không cần gọi lại loop ngay
                 return;
            }
        }

        // Đủ gần, bắt đầu vứt
        console.log(`[CleanInv] At disposal location. Tossing items... (${task.itemsToToss.length} stacks remaining)`);

        // Nhìn vào vị trí vứt đồ (hơi cao hơn một chút để ném vào)
        const targetLookPos = disposalPos.offset(0.5, 0.8, 0.5); // Nhìn vào giữa và hơi cao lên
        await bot.lookAt(targetLookPos);
        await bot.waitForTicks(5); // Chờ bot quay đầu xong

        let tossedCount = 0;
        while (tossedCount < MAX_ITEMS_TO_TOSS_PER_CYCLE && task.itemsToToss.length > 0) {
            const itemToToss = task.itemsToToss.shift(); // Lấy và xóa item đầu tiên khỏi danh sách
            if (!itemToToss) break;

            // Kiểm tra lại xem item còn trong inventory không (phòng trường hợp bị dùng mất)
            const itemInInv = bot.inventory.findInventoryItem(itemToToss.type, itemToToss.metadata, false);
            if (!itemInInv || itemInInv.count < itemToToss.count) {
                 console.warn(`[CleanInv] Item ${itemToToss.name} count changed or missing. Skipping toss.`);
                 continue; // Bỏ qua nếu số lượng không khớp hoặc item biến mất
            }


            try {
                console.log(`[CleanInv] Tossing ${itemToToss.count}x ${itemToToss.name}...`);
                await bot.toss(itemToToss.type, itemToToss.metadata, itemToToss.count);
                tossedCount++;
                await bot.waitForTicks(3); // Chờ ngắn giữa các lần vứt
            } catch (tossErr) {
                console.error(`[CleanInv] Error tossing ${itemToToss.name}: ${tossErr.message}`);
                // Có thể thử đưa item lại vào danh sách để thử lại sau? Hoặc bỏ qua.
                // Tạm thời bỏ qua để tránh vòng lặp lỗi.
            }
        }

        console.log(`[CleanInv] Tossed ${tossedCount} stacks in this cycle.`);

        // Gọi lại vòng lặp để vứt tiếp nếu còn
        if (task.itemsToToss.length > 0) {
            setTimeout(() => disposeItemsLoop(bot), 500); // Chờ chút trước khi vứt lượt tiếp
        } else {
            finishCleaningInventory(bot, true, "Đã vứt hết đồ rác.");
        }

    } catch (error) {
        console.error("[CleanInv] Unexpected error in disposeItemsLoop:", error);
        finishCleaningInventory(bot, false, "Gặp lỗi không mong muốn khi đang vứt đồ.");
    }
}

/**
 * Bắt đầu nhiệm vụ lọc túi đồ.
 * @param {import('mineflayer').Bot} bot
 * @param {string} username
 */
async function startCleaningInventory(bot, username) {
    console.log(`[CleanInv] ${username} requested inventory cleaning.`);

    if (bot.isFinding || bot.isFollowing || bot.isProtecting || bot.isCollecting || bot.isStripMining || bot.isHunting || bot.isCleaningInventory) {
        let reason = bot.isFinding ? 'tìm đồ'
                   : bot.isFollowing ? 'đi theo'
                   : bot.isProtecting ? 'bảo vệ'
                   : bot.isCollecting ? 'thu thập'
                   : bot.isStripMining ? 'đào hầm'
                   : bot.isHunting ? 'săn bắn'
                   : 'dọn túi đồ';
        bot.chat(`${username}, tôi đang bận ${reason} rồi!`);
        return;
    }

    const junkItems = findJunkItems(bot);

    if (junkItems.length === 0) {
        bot.chat(`${username}, trong túi đồ của tôi không có vật phẩm nào được coi là rác cả.`);
        console.log("[CleanInv] No junk items found.");
        return;
    }

    const junkSummary = junkItems.map(item => `${item.count}x ${item.name}`).join(', ');
    bot.chat(`${username}, tìm thấy đồ rác: ${junkSummary}. Đang tìm chỗ vứt...`);

    const disposalLocation = findDisposalLocation(bot);

    if (!disposalLocation) {
        bot.chat(`${username}, tôi không tìm thấy dung nham hay xương rồng gần đây để vứt đồ.`);
        return;
    }

    bot.chat(`Tìm thấy ${disposalLocation.type} tại ${formatCoords(disposalLocation.position)}. Bắt đầu di chuyển và vứt đồ...`);

    bot.isCleaningInventory = true;
    bot.cleaningTaskDetails = {
        username: username,
        itemsToToss: [...junkItems], // Tạo bản sao danh sách
        disposalLocation: disposalLocation,
    };

    // Bắt đầu vòng lặp di chuyển và vứt
    disposeItemsLoop(bot);
}

/**
 * Kết thúc nhiệm vụ lọc túi đồ.
 * @param {import('mineflayer').Bot} bot
 * @param {boolean} success
 * @param {string} message
 */
function finishCleaningInventory(bot, success, message) {
    if (!bot.isCleaningInventory) return;
    const task = bot.cleaningTaskDetails;
    const username = task?.username || "bạn";
    console.log(`[CleanInv Finish] Kết thúc. Thành công: ${success}. Lý do: ${message}`);
    bot.chat(`${username}, ${message}`);

    bot.isCleaningInventory = false;
    bot.cleaningTaskDetails = null;
    try {
        if (bot.pathfinder.isMoving()) bot.pathfinder.stop();
    } catch(e) {
        console.error("[CleanInv Finish] Lỗi khi dừng pathfinder:", e);
    }
}

/**
 * Dừng nhiệm vụ lọc túi đồ (do người dùng yêu cầu).
 * @param {import('mineflayer').Bot} bot
 * @param {string} usernameOrReason
 */
function stopCleaningInventory(bot, usernameOrReason) {
    if (bot.isCleaningInventory) {
        console.log(`[CleanInv Stop] Yêu cầu dừng từ/lý do: ${usernameOrReason}`);
        finishCleaningInventory(bot, false, "Đã dừng việc dọn túi đồ theo yêu cầu.");
    }
}

module.exports = {
    startCleaningInventory,
    stopCleaningInventory,
};