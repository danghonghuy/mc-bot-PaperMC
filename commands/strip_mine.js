// commands/strip_mine.js
const { GoalBlock, GoalXZ } = require("mineflayer-pathfinder").goals; // Thêm GoalXZ
const { Vec3 } = require("vec3");
const { formatCoords, translateToEnglishId } = require("../utils");

const DEFAULT_Y_LEVEL = -58;
const TUNNEL_LENGTH = 64;
const TUNNEL_HEIGHT = 2;
const TUNNEL_WIDTH = 1;
const TORCH_INTERVAL = 10;
const CHECK_INTERVAL_MS = 200;
const TOOL_CHECK_INTERVAL = 20;
const MAX_VERTICAL_MOVE_ATTEMPTS = 5; // Giới hạn số lần thử di chuyển thẳng đứng

async function equipBestPickaxe(bot) {
    // ... (Giữ nguyên hàm này) ...
    console.log(`[Strip Mine Equip] Tìm cuốc tốt nhất...`);
    const toolMaterialTier = { wooden: 1, stone: 2, golden: 3, iron: 4, diamond: 5, netherite: 6 };
    let bestTool = null;
    let bestTier = 0;

    const currentTool = bot.heldItem;
    if (currentTool && currentTool.name.includes('pickaxe')) {
        const material = currentTool.name.split('_')[0];
        bestTier = toolMaterialTier[material] || 0;
        bestTool = currentTool;
    }

    for (const item of bot.inventory.items()) {
        if (item.name.includes('pickaxe')) {
            const material = item.name.split('_')[0];
            const tier = toolMaterialTier[material] || 0;
            if (tier > bestTier) {
                bestTier = tier;
                bestTool = item;
            }
        }
    }

    if (bestTool && bot.heldItem?.name !== bestTool.name) {
        try {
            console.log(`[Strip Mine Equip] Trang bị ${bestTool.name}...`);
            await bot.equip(bestTool, 'hand');
            console.log(`[Strip Mine Equip] Đã trang bị ${bestTool.name}.`);
            return true;
        } catch (err) {
            console.error(`[Strip Mine Equip] Lỗi trang bị ${bestTool.name}:`, err.message);
            return false;
        }
    } else if (bestTool) {
        console.log(`[Strip Mine Equip] Đã cầm sẵn cuốc tốt nhất (${bestTool.name}).`);
        return true;
    } else {
        console.log(`[Strip Mine Equip] Không tìm thấy cuốc nào.`);
        return false;
    }
}

async function placeTorchIfNeeded(bot, blocksDug) {
    // ... (Giữ nguyên hàm này) ...
     if (blocksDug % TORCH_INTERVAL === 0 && blocksDug > 0) {
        const mcData = require('minecraft-data')(bot.version);
        const torchItem = bot.inventory.findInventoryItem(mcData.itemsByName.torch.id, null);
        if (!torchItem) {
            console.log("[Strip Mine] Hết đuốc để đặt!");
            return;
        }

        try {
            const currentPickaxe = bot.heldItem; // Lưu lại cuốc đang cầm
            await bot.equip(torchItem, 'hand');
            const torchPlacePos = bot.entity.position.floored();
            const floorBlock = bot.blockAt(torchPlacePos.offset(0,-1,0));
            if(floorBlock && floorBlock.boundingBox === 'block') {
                 console.log(`[Strip Mine] Đặt đuốc xuống sàn tại ${formatCoords(torchPlacePos)}`);
                 await bot.placeBlock(floorBlock, new Vec3(0, 1, 0));
                 console.log("[Strip Mine] Đã đặt đuốc.");
                 await bot.waitForTicks(5);
            } else {
                  console.log("[Strip Mine] Không tìm thấy sàn để đặt đuốc.");
            }
            // Trang bị lại cuốc nếu có
            if (currentPickaxe && currentPickaxe.name.includes('pickaxe')) {
                 await bot.equip(currentPickaxe, 'hand');
            } else {
                 await equipBestPickaxe(bot); // Nếu không rõ cuốc cũ, tìm lại cái tốt nhất
            }
        } catch (err) {
            console.error("[Strip Mine] Lỗi khi đặt đuốc:", err.message);
            await equipBestPickaxe(bot); // Đảm bảo cầm lại cuốc dù lỗi
        }
    }
}

async function digBlockIfNotAir(bot, position) {
    const block = bot.blockAt(position);
    if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air' && block.name !== 'bedrock') {
        if (block.name.includes('lava')) throw new Error("Phát hiện dung nham");
        if (block.name.includes('water')) throw new Error("Phát hiện nước");

        // Xử lý sỏi/cát (đào từ trên xuống khi đào ngang)
        if (block.name.includes('gravel') || block.name.includes('sand')) {
             let abovePos = position.offset(0, 1, 0);
             let aboveBlock = bot.blockAt(abovePos);
             while(aboveBlock && (aboveBlock.name.includes('gravel') || aboveBlock.name.includes('sand'))) {
                 console.log(`[Strip Mine] Xử lý ${aboveBlock.name} phía trên tại ${formatCoords(abovePos)}`);
                 try {
                     await bot.dig(aboveBlock);
                     await bot.waitForTicks(2);
                 } catch(e) {
                     console.error(`[Strip Mine] Lỗi đào sỏi/cát phía trên: ${e.message}`);
                     // Không throw lỗi ở đây, cố gắng đào tiếp khối dưới
                 }
                 abovePos = abovePos.offset(0,1,0);
                 aboveBlock = bot.blockAt(abovePos);
             }
        }

        // Đào khối chính
        try {
            console.log(`[Strip Mine] Đào ${block.name} tại ${formatCoords(position)}`);
            await bot.dig(block);
            return true; // Đã đào
        } catch (err) {
            console.error(`[Strip Mine] Lỗi khi đào ${block.name} tại ${formatCoords(position)}:`, err.message);
            throw new Error(`Lỗi khi đào ${block.name}`);
        }
    }
    return false; // Không đào (là air hoặc bedrock)
}


async function checkToolDurability(bot) {
    const heldItem = bot.heldItem;
    if (heldItem && heldItem.name.includes('pickaxe')) {
        const durabilityLeft = heldItem.maxDurability - heldItem.durabilityUsed;
        if (durabilityLeft <= 10) { // Ngưỡng cảnh báo/đổi tool
            console.warn(`[Strip Mine] Cuốc ${heldItem.name} sắp hỏng (${durabilityLeft} độ bền)!`);
            if (!await equipBestPickaxe(bot)) {
                throw new Error("Hết cuốc hoặc cuốc sắp hỏng");
            }
            return true; // Đã đổi tool
        }
    } else if (!heldItem || !heldItem.name.includes('pickaxe')) {
        // Nếu không cầm cuốc vì lý do nào đó
        if (!await equipBestPickaxe(bot)) {
            throw new Error("Không có cuốc để đào");
        }
        return true; // Đã đổi tool
    }
    return false; // Tool vẫn ổn
}


async function digForwardAndMove(bot, task) {
    // Xác định hướng đào dựa trên hướng bot đang nhìn
    const yaw = bot.entity.yaw;
    let dx = 0, dz = 0;
    // Đơn giản hóa hướng thành 4 hướng chính
    if (yaw >= -Math.PI / 4 && yaw < Math.PI / 4) dz = 1;       // South
    else if (yaw >= Math.PI / 4 && yaw < 3 * Math.PI / 4) dx = -1; // West
    else if (yaw >= 3 * Math.PI / 4 || yaw < -3 * Math.PI / 4) dz = -1; // North
    else dx = 1;                                                // East

    const currentPos = bot.entity.position;
    const targetPos1 = currentPos.offset(dx, 0, dz).floored(); // Khối ngang tầm mắt
    const targetPos2 = currentPos.offset(dx, 1, dz).floored(); // Khối trên đầu

    let dug1 = await digBlockIfNotAir(bot, targetPos1);
    let dug2 = await digBlockIfNotAir(bot, targetPos2);
    if (dug1) task.blocksDug++;
    if (dug2) task.blocksDug++;

    // Kiểm tra tool sau khi đào
    await checkToolDurability(bot);

    // Di chuyển tới 1 block bằng pathfinder
    const nextPos = currentPos.offset(dx, 0, dz); // Vị trí mục tiêu để di chuyển tới
    console.log(`[Strip Mine] Di chuyển tới ${formatCoords(nextPos)}`);
    try {
        // Sử dụng GoalXZ để giữ nguyên Y level
        await bot.pathfinder.goto(new GoalXZ(nextPos.x, nextPos.z));
        // Kiểm tra lại Y level sau khi di chuyển
        if (Math.abs(bot.entity.position.y - task.targetY) > 1) {
             console.warn(`[Strip Mine] Bị lệch Y level sau khi di chuyển! (Hiện tại: ${bot.entity.position.y.toFixed(1)}, Mục tiêu: ${task.targetY}). Đang cố gắng về lại...`);
             await bot.pathfinder.goto(new GoalBlock(bot.entity.position.x, task.targetY, bot.entity.position.z));
        }
        task.distanceDug++;
    } catch(e) {
         console.error("[Strip Mine] Lỗi di chuyển tới:", e.message);
         throw new Error("Lỗi di chuyển tới");
    }
}

async function stripMineLoop(bot) {
    if (!bot.isStripMining || !bot.stripMineTaskDetails) {
        console.log("[Strip Mine Loop] Dừng (không có task hoặc không mining).");
        return;
    }

    const task = bot.stripMineTaskDetails;

    try {
        if (task.distanceDug >= task.targetLength) {
            finishStripMining(bot, true, `Đã đào xong hầm dài ${task.distanceDug} block.`);
            return;
        }
        if (bot.inventory.emptySlotCount() <= 2) {
            finishStripMining(bot, false, "Túi đồ gần đầy, dừng đào hầm.");
            return;
        }

        await placeTorchIfNeeded(bot, task.blocksDug);
        await digForwardAndMove(bot, task);

        setTimeout(() => stripMineLoop(bot), CHECK_INTERVAL_MS);

    } catch (error) {
        console.error("[Strip Mine Loop] Gặp lỗi:", error.message);
        finishStripMining(bot, false, `Gặp lỗi khi đào hầm: ${error.message}`);
    }
}

async function startStripMiningTask(bot, username, message, aiModel) {
    console.log(`[Strip Mine] Xử lý yêu cầu đào hầm từ ${username}: "${message}"`);

    if (bot.isFinding || bot.isFollowing || bot.isProtecting || bot.isCollecting || bot.isStripMining || bot.isHunting) {
        let reason = bot.isFinding ? 'tìm đồ' : (bot.isFollowing ? 'đi theo' : (bot.isProtecting ? 'bảo vệ' : (bot.isCollecting ? 'thu thập' : (bot.isStripMining ? 'đào hầm' : 'săn bắn'))));
        bot.chat(`${username}, tôi đang bận ${reason} rồi!`);
        return;
    }

    const targetY = DEFAULT_Y_LEVEL;
    const targetLength = TUNNEL_LENGTH;
    const targetOre = "kim cương";

    if (!await equipBestPickaxe(bot)) {
        bot.chat(`Xin lỗi ${username}, tôi không có cuốc để đào hầm.`);
        return;
    }
    const mcData = require('minecraft-data')(bot.version);
    if (!bot.inventory.findInventoryItem(mcData.itemsByName.torch.id, null)) {
         bot.chat(`Xin lỗi ${username}, tôi không có đuốc để thắp sáng hầm.`);
         return;
    }

    bot.chat(`Ok ${username}, bắt đầu đào hầm tìm ${targetOre} ở Y=${targetY}, dài ${targetLength} block.`);

    // --- SỬA LOGIC DI CHUYỂN THẲNG ĐỨNG ---
    let currentY = Math.floor(bot.entity.position.y);
    if (currentY !== targetY) {
        console.log(`[Strip Mine] Cần di chuyển từ Y=${currentY} đến Y=${targetY}`);
        bot.chat(`Tôi đang di chuyển xuống/lên Y=${targetY}...`);
        try {
            const dir = currentY > targetY ? -1 : 1; // -1: xuống, 1: lên
            let attempts = 0;

            while (Math.abs(currentY - targetY) > 0 && attempts < MAX_VERTICAL_MOVE_ATTEMPTS * Math.abs(currentY - targetY)) { // Giới hạn tổng số lần thử
                attempts++;
                const currentPos = bot.entity.position;
                let blockToDigPos = null;
                let goalPos = null;

                if (dir === -1) { // Đi xuống
                    blockToDigPos = currentPos.offset(0, -1, 0).floored();
                    goalPos = blockToDigPos; // Mục tiêu là đi vào khối vừa đào
                } else { // Đi lên
                    blockToDigPos = currentPos.offset(0, 1, 0).floored(); // Khối ngay trên đầu
                    const blockAboveHeadPos = currentPos.offset(0, 2, 0).floored(); // Khối cao hơn nữa để đảm bảo không gian
                    goalPos = blockToDigPos; // Mục tiêu là đi vào khối vừa đào ở y+1

                    // Đào khối trên cao hơn trước nếu cần
                    await digBlockIfNotAir(bot, blockAboveHeadPos);
                }

                console.log(`[Strip Mine Vertical] Attempt ${attempts}: Đào tại ${formatCoords(blockToDigPos)}`);
                await digBlockIfNotAir(bot, blockToDigPos);
                await checkToolDurability(bot); // Kiểm tra tool sau mỗi lần đào

                console.log(`[Strip Mine Vertical] Di chuyển đến ${formatCoords(goalPos)}`);
                try {
                    await bot.pathfinder.goto(new GoalBlock(goalPos.x, goalPos.y, goalPos.z));
                    // Chờ bot ổn định vị trí
                    await bot.waitForTicks(5);
                } catch (moveError) {
                     console.warn(`[Strip Mine Vertical] Lỗi di chuyển đến ${formatCoords(goalPos)}: ${moveError.message}. Thử lại...`);
                     // Có thể thêm logic xử lý kẹt ở đây nếu muốn
                     await bot.waitForTicks(10); // Chờ lâu hơn chút nếu lỗi
                }

                currentY = Math.floor(bot.entity.position.y); // Cập nhật Y hiện tại
                console.log(`[Strip Mine Vertical] Hiện tại ở Y=${currentY}`);
            }

            if (Math.abs(currentY - targetY) > 0) { // Nếu vẫn chưa đến đích sau nhiều lần thử
                 throw new Error(`Không thể đến Y=${targetY} sau ${attempts} lần thử.`);
            }

            console.log(`[Strip Mine] Đã đến Y=${targetY}.`);
            bot.chat(`Đã đến Y=${targetY}. Bắt đầu đào ngang.`);

        } catch (err) {
            console.error("[Strip Mine] Lỗi khi di chuyển đến Y mục tiêu:", err.message);
            bot.chat(`Xin lỗi ${username}, tôi gặp lỗi khi cố gắng đến Y=${targetY}: ${err.message}`);
            return;
        }
    }
    // --- KẾT THÚC SỬA LOGIC DI CHUYỂN ---

    bot.isStripMining = true;
    bot.stripMineTaskDetails = {
        username: username,
        targetY: targetY,
        targetLength: targetLength,
        startPosition: bot.entity.position.clone(),
        blocksDug: 0,
        distanceDug: 0,
        torchesPlaced: 0,
    };

    stripMineLoop(bot);
}

function finishStripMining(bot, success, message) {
    // ... (Giữ nguyên hàm này) ...
    if (!bot.isStripMining) return;
    const task = bot.stripMineTaskDetails;
    const username = task?.username || "bạn";
    console.log(`[Strip Mine Finish] Kết thúc. Thành công: ${success}. Lý do: ${message}`);
    bot.chat(`${username}, ${message}`);

    bot.isStripMining = false;
    bot.stripMineTaskDetails = null;
    try {
        bot.stopDigging();
        bot.clearControlStates();
        if (bot.pathfinder.isMoving()) bot.pathfinder.stop();
    } catch(e) {
        console.error("[Strip Mine Finish] Lỗi khi dừng hành động:", e);
    }
}

function stopStripMining(bot, username) {
    // ... (Giữ nguyên hàm này) ...
     if (bot.isStripMining) {
        console.log(`[Strip Mine Stop] Người dùng ${username} yêu cầu dừng.`);
        finishStripMining(bot, false, "Đã dừng đào hầm theo yêu cầu.");
    }
}

module.exports = {
    startStripMiningTask,
    stopStripMining,
};