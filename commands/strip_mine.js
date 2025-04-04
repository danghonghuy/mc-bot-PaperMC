// --- START OF FILE strip_mine.js ---
const { GoalBlock, GoalXZ, GoalNear } = require("mineflayer-pathfinder").goals; // Thêm GoalNear
const { Vec3 } = require("vec3");
const { formatCoords, translateToEnglishId } = require("../utils");

const DEFAULT_Y_LEVEL = -58;
const TUNNEL_LENGTH = 64;
const TUNNEL_HEIGHT = 2; // Chiều cao hầm (đào 2 block)
const TUNNEL_WIDTH = 1; // Chiều rộng hầm (đào 1 block)
const TORCH_INTERVAL = 10; // Đặt đuốc sau mỗi X block đào *ngang*
const CHECK_INTERVAL_MS = 200; // Thời gian nghỉ giữa các bước đào ngang
const TOOL_CHECK_INTERVAL_BLOCKS = 15; // Kiểm tra tool sau mỗi X block đào (ngang+dọc)
const MAX_STAIRCASE_ATTEMPTS_PER_LEVEL = 5; // Giới hạn số lần thử cho mỗi bậc thang
const STAIRCASE_DIRECTION = new Vec3(0, 0, 1); // Hướng đào cầu thang (+Z = South)

// --- Hàm tiện ích: equipBestPickaxe ---
async function equipBestPickaxe(bot) {
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
            bot.chat(`Lỗi khi trang bị ${bestTool.displayName || bestTool.name}`);
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

// --- Hàm tiện ích: placeTorchIfNeeded ---
async function placeTorchIfNeeded(bot, distanceDug) {
     // Chỉ đặt đuốc khi đào ngang và đủ khoảng cách
     if (distanceDug > 0 && distanceDug % TORCH_INTERVAL === 0) {
        const mcData = require('minecraft-data')(bot.version);
        const torchItem = bot.inventory.findInventoryItem(mcData.itemsByName.torch.id, null);
        if (!torchItem) {
            console.log("[Strip Mine] Hết đuốc để đặt!");
            // Không dừng task, chỉ cảnh báo
            return;
        }

        console.log(`[Strip Mine] Đã đào ${distanceDug} block, cần đặt đuốc.`);
        const currentTool = bot.heldItem; // Lưu lại tool đang cầm
        try {
            await bot.equip(torchItem, 'hand');
            // Tìm vị trí đặt đuốc: trên sàn, ngay vị trí bot đang đứng
            const floorBlockPos = bot.entity.position.floored().offset(0, -1, 0);
            const floorBlock = bot.blockAt(floorBlockPos);

            if (floorBlock && floorBlock.boundingBox === 'block' && bot.canSeeBlock(floorBlock)) {
                 console.log(`[Strip Mine] Đặt đuốc xuống sàn tại ${formatCoords(floorBlockPos.offset(0,1,0))}`);
                 // Đặt vào mặt trên của khối sàn (face vector 0,1,0)
                 await bot.placeBlock(floorBlock, new Vec3(0, 1, 0));
                 console.log("[Strip Mine] Đã đặt đuốc.");
                 bot.stripMineTaskDetails.torchesPlaced++; // Cập nhật bộ đếm
                 await bot.waitForTicks(5); // Chờ chút sau khi đặt
            } else {
                  console.log(`[Strip Mine] Không tìm thấy sàn vững chắc (${floorBlock?.name}) hoặc không thấy để đặt đuốc tại ${formatCoords(floorBlockPos)}.`);
            }
        } catch (err) {
            console.error("[Strip Mine] Lỗi khi đặt đuốc:", err.message);
            // Không dừng task, chỉ báo lỗi
        } finally {
             // Luôn cố gắng trang bị lại tool cũ hoặc cuốc tốt nhất
             try {
                if (currentTool && currentTool.name !== torchItem.name) { // Đảm bảo không phải đang cầm đuốc
                    await bot.equip(currentTool, 'hand');
                } else {
                    await equipBestPickaxe(bot); // Nếu không rõ tool cũ, tìm lại cuốc
                }
             } catch (equipError) {
                 console.error("[Strip Mine] Lỗi trang bị lại tool sau khi đặt đuốc:", equipError.message);
                 // Nếu lỗi trang bị lại cuốc thì nên dừng
                 throw new Error("Không thể trang bị lại cuốc sau khi đặt đuốc.");
             }
        }
    }
}

// --- Hàm tiện ích: digBlockIfNotAir ---
async function digBlockIfNotAir(bot, position, task) {
    const block = bot.blockAt(position);
    if (!block) {
        console.warn(`[Strip Mine Dig] Không thể lấy thông tin khối tại ${formatCoords(position)}`);
        return false; // Không thể đào
    }

    // Bỏ qua air, bedrock, và các khối nguy hiểm
    if (block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') return false;
    if (block.name === 'bedrock') {
        console.warn(`[Strip Mine Dig] Gặp bedrock tại ${formatCoords(position)}, không thể đào.`);
        return false;
    }
    if (block.name.includes('lava')) {
        console.error(`[Strip Mine Dig] Phát hiện dung nham tại ${formatCoords(position)}!`);
        throw new Error("Phát hiện dung nham");
    }
    if (block.name.includes('water')) {
        console.warn(`[Strip Mine Dig] Gặp nước tại ${formatCoords(position)}, cố gắng đào...`);
        // Có thể thêm logic xử lý nước phức tạp hơn nếu muốn (vd: đặt block chặn)
    }
    if (block.name.includes('spawner')) {
         console.warn(`[Strip Mine Dig] Gặp spawner tại ${formatCoords(position)}! Bỏ qua...`);
         return false; // Không đào spawner
    }

    // Xử lý sỏi/cát rơi (kiểm tra khối phía trên)
    const checkAbovePos = position.offset(0, 1, 0);
    const blockAbove = bot.blockAt(checkAbovePos);
    if (blockAbove && (blockAbove.name.includes('gravel') || blockAbove.name.includes('sand') || blockAbove.name.includes('concrete_powder'))) {
        console.log(`[Strip Mine Dig] Phát hiện ${blockAbove.name} có thể rơi phía trên tại ${formatCoords(checkAbovePos)}. Đào khối trên trước.`);
        try {
            // Đệ quy để xử lý nhiều lớp sỏi/cát
            const dugAbove = await digBlockIfNotAir(bot, checkAbovePos, task);
            if (dugAbove) {
                await bot.waitForTicks(5); // Chờ khối rơi xuống (nếu có)
                // Sau khi đào khối trên, kiểm tra lại khối hiện tại
                return await digBlockIfNotAir(bot, position, task);
            } else {
                 console.warn(`[Strip Mine Dig] Không thể đào khối ${blockAbove.name} phía trên, tiếp tục đào khối hiện tại.`);
            }
        } catch (err) {
             console.error(`[Strip Mine Dig] Lỗi khi đào khối ${blockAbove.name} phía trên: ${err.message}. Tiếp tục đào khối hiện tại.`);
             // Không throw lỗi ở đây, cố gắng đào khối dưới
        }
    }

    // Đào khối chính
    if (!bot.canDigBlock(block)) {
        console.warn(`[Strip Mine Dig] Không thể đào ${block.name} tại ${formatCoords(position)} (có thể do thiếu tool hoặc bị chặn).`);
        // Cố gắng trang bị lại cuốc xem có phải do thiếu tool không
        if (!await equipBestPickaxe(bot)) {
             throw new Error(`Không có cuốc phù hợp để đào ${block.name}`);
        }
        // Thử lại sau khi trang bị
        if (!bot.canDigBlock(block)) {
             throw new Error(`Vẫn không thể đào ${block.name} sau khi trang bị cuốc.`);
        }
    }

    try {
        console.log(`[Strip Mine Dig] Đào ${block.name} tại ${formatCoords(position)}`);
        await bot.dig(block);
        if (task) task.blocksDugSinceToolCheck++; // Đếm số khối đã đào từ lần kiểm tra tool cuối
        return true; // Đã đào
    } catch (err) {
        console.error(`[Strip Mine Dig] Lỗi khi đào ${block.name} tại ${formatCoords(position)}:`, err.message);
        // Phân tích lỗi cụ thể hơn nếu cần
        if (err.message.includes('interrupt')) {
             console.warn('[Strip Mine Dig] Hành động đào bị gián đoạn.');
             // Có thể thử lại hoặc bỏ qua tùy tình huống
        }
        throw new Error(`Lỗi khi đào ${block.name}`); // Ném lại lỗi để dừng task nếu nghiêm trọng
    }
}

// --- Hàm tiện ích: checkToolDurability ---
async function checkToolDurability(bot, task) {
    if (task.blocksDugSinceToolCheck < TOOL_CHECK_INTERVAL_BLOCKS) {
        return false; // Chưa đến lúc kiểm tra
    }
    task.blocksDugSinceToolCheck = 0; // Reset bộ đếm

    const heldItem = bot.heldItem;
    if (heldItem && heldItem.name.includes('pickaxe')) {
        // Kiểm tra metadata để lấy độ bền (cách này có thể không hoạt động trên mọi server/phiên bản)
        const durability = heldItem.nbt?.value?.Damage?.value;
        const maxDurability = heldItem.maxDurability; // Lấy từ minecraft-data

        if (durability !== undefined && maxDurability !== undefined) {
            const durabilityLeft = maxDurability - durability;
            console.log(`[Strip Mine Tool] Kiểm tra độ bền ${heldItem.name}: ${durabilityLeft}/${maxDurability}`);
            if (durabilityLeft <= 10) { // Ngưỡng cảnh báo/đổi tool
                console.warn(`[Strip Mine Tool] Cuốc ${heldItem.name} sắp hỏng (${durabilityLeft} độ bền)!`);
                if (!await equipBestPickaxe(bot)) {
                    throw new Error("Hết cuốc hoặc cuốc tốt nhất cũng sắp hỏng");
                }
                return true; // Đã đổi tool
            }
        } else {
             console.warn(`[Strip Mine Tool] Không thể đọc độ bền của ${heldItem.name} từ NBT. Bỏ qua kiểm tra độ bền.`);
             // Có thể thêm logic dự phòng dựa trên số block đã đào nếu muốn
        }
    } else if (!heldItem || !heldItem.name.includes('pickaxe')) {
        // Nếu không cầm cuốc vì lý do nào đó
        console.warn("[Strip Mine Tool] Không cầm cuốc. Đang tìm và trang bị...");
        if (!await equipBestPickaxe(bot)) {
            throw new Error("Không có cuốc để tiếp tục đào");
        }
        return true; // Đã đổi tool
    }
    return false; // Tool vẫn ổn hoặc không kiểm tra được
}

// --- HÀM MỚI: Đào cầu thang ---
async function digStaircaseToY(bot, targetY, task) {
    let currentY = Math.floor(bot.entity.position.y);
    const direction = currentY > targetY ? -1 : 1; // -1: xuống, 1: lên
    const dirString = direction === -1 ? "xuống" : "lên";
    console.log(`[Strip Mine Staircase] Bắt đầu đào cầu thang ${dirString} từ Y=${currentY} đến Y=${targetY}`);
    bot.chat(`Đang đào cầu thang ${dirString} đến Y=${targetY}...`);

    // Đảm bảo bot nhìn về hướng đào cầu thang
    await bot.lookAt(bot.entity.position.plus(STAIRCASE_DIRECTION), true);

    while (currentY !== targetY) {
        const startPos = bot.entity.position.floored();
        console.log(`[Strip Mine Staircase] Đang ở Y=${currentY}. Cần đào ${dirString}. Hướng: ${formatCoords(STAIRCASE_DIRECTION)}`);

        let blocksToDig = [];
        let goalPos = null;

        if (direction === -1) { // Đào xuống
            // 1. Khối ngay trước mặt (ngang chân)
            blocksToDig.push(startPos.plus(STAIRCASE_DIRECTION));
            // 2. Khối phía trước và dưới 1 block
            blocksToDig.push(startPos.plus(STAIRCASE_DIRECTION).offset(0, -1, 0));
            // Mục tiêu di chuyển là khối dưới
            goalPos = startPos.plus(STAIRCASE_DIRECTION).offset(0, -1, 0);
        } else { // Đào lên
            // 1. Khối ngay trước mặt (ngang đầu)
            blocksToDig.push(startPos.plus(STAIRCASE_DIRECTION).offset(0, 1, 0));
            // 2. Khối phía trước và trên 2 block (để có không gian)
            blocksToDig.push(startPos.plus(STAIRCASE_DIRECTION).offset(0, 2, 0));
            // Mục tiêu di chuyển là khối ngang đầu
            goalPos = startPos.plus(STAIRCASE_DIRECTION).offset(0, 1, 0);
        }

        console.log(`[Strip Mine Staircase] Các khối cần đào: ${blocksToDig.map(formatCoords).join(', ')}`);
        console.log(`[Strip Mine Staircase] Mục tiêu di chuyển: ${formatCoords(goalPos)}`);

        // Đào các khối cần thiết
        for (const pos of blocksToDig) {
            await digBlockIfNotAir(bot, pos, task);
            // Không cần chờ lâu giữa các lần đào trong cùng 1 bậc thang
        }

        // Kiểm tra tool sau khi đào xong 1 bậc thang
        await checkToolDurability(bot, task);

        // Di chuyển đến vị trí mục tiêu của bậc thang
        let moveAttempts = 0;
        let moved = false;
        while (moveAttempts < MAX_STAIRCASE_ATTEMPTS_PER_LEVEL && !moved) {
            moveAttempts++;
            try {
                console.log(`[Strip Mine Staircase] Di chuyển đến ${formatCoords(goalPos)} (Lần thử ${moveAttempts})`);
                // Sử dụng GoalNear để linh hoạt hơn một chút nếu GoalBlock bị kẹt
                await bot.pathfinder.goto(new GoalNear(goalPos.x, goalPos.y, goalPos.z, 0.5));
                // Chờ bot ổn định
                await bot.waitForTicks(5);
                // Kiểm tra xem đã thực sự đến gần chưa
                if (bot.entity.position.distanceTo(goalPos.offset(0.5, 0.5, 0.5)) < 1.5) {
                    moved = true;
                    console.log(`[Strip Mine Staircase] Đã di chuyển thành công.`);
                } else {
                     console.warn(`[Strip Mine Staircase] Vẫn chưa đến gần mục tiêu sau khi goto kết thúc. Thử lại...`);
                     await bot.waitForTicks(10);
                }
            } catch (moveError) {
                console.error(`[Strip Mine Staircase] Lỗi di chuyển đến ${formatCoords(goalPos)} (Lần thử ${moveAttempts}):`, moveError.message);
                // Nếu lỗi, chờ một chút rồi thử lại
                await bot.waitForTicks(10);
            }
        }

        if (!moved) {
            throw new Error(`Không thể di chuyển đến bậc thang tiếp theo tại ${formatCoords(goalPos)} sau ${MAX_STAIRCASE_ATTEMPTS_PER_LEVEL} lần thử.`);
        }

        // Cập nhật Y hiện tại sau khi di chuyển
        currentY = Math.floor(bot.entity.position.y);

        // Kiểm tra xem có đào đúng hướng không (tránh đào vòng)
        if ((direction === -1 && currentY > startPos.y) || (direction === 1 && currentY < startPos.y)) {
             console.error(`[Strip Mine Staircase] Lỗi logic: Di chuyển sai hướng Y! (Từ ${startPos.y} thành ${currentY})`);
             throw new Error("Lỗi logic đào cầu thang, di chuyển sai hướng Y.");
        }
         // Thoát nếu đã đạt hoặc vượt mục tiêu (cho trường hợp đi lên)
        if ((direction === 1 && currentY >= targetY) || (direction === -1 && currentY <= targetY)) {
             break;
        }

    } // Kết thúc while loop

    // Kiểm tra lại lần cuối xem đã đến đúng Y chưa
    currentY = Math.floor(bot.entity.position.y);
    if (currentY !== targetY) {
         console.warn(`[Strip Mine Staircase] Kết thúc đào cầu thang nhưng Y hiện tại (${currentY}) chưa chính xác là Y mục tiêu (${targetY}). Có thể do địa hình phức tạp.`);
         // Cố gắng di chuyển đến đúng Y lần cuối
         try {
              await bot.pathfinder.goto(new GoalBlock(bot.entity.position.x, targetY, bot.entity.position.z));
              await bot.waitForTicks(5);
              currentY = Math.floor(bot.entity.position.y);
         } catch(finalMoveError) {
              console.error(`[Strip Mine Staircase] Lỗi khi cố gắng di chuyển đến Y cuối cùng: ${finalMoveError.message}`);
         }
    }


    console.log(`[Strip Mine Staircase] Đã hoàn thành đào cầu thang đến Y=${currentY}.`);
}


// --- HÀM ĐÀO NGANG ---
async function digForwardAndMove(bot, task) {
    // Xác định hướng đào dựa trên hướng bot đang nhìn (đã được đặt khi bắt đầu đào ngang)
    const yaw = bot.entity.yaw;
    let dx = 0, dz = 0;
    // Đơn giản hóa hướng thành 4 hướng chính
    if (yaw >= -Math.PI / 4 && yaw < Math.PI / 4) dz = 1;       // South (+Z)
    else if (yaw >= Math.PI / 4 && yaw < 3 * Math.PI / 4) dx = -1; // West (-X)
    else if (yaw >= 3 * Math.PI / 4 || yaw < -3 * Math.PI / 4) dz = -1; // North (-Z)
    else dx = 1;                                                // East (+X)

    const currentPos = bot.entity.position;
    const targetPos1 = currentPos.offset(dx, 0, dz).floored(); // Khối ngang tầm mắt/chân
    const targetPos2 = currentPos.offset(dx, 1, dz).floored(); // Khối trên đầu

    console.log(`[Strip Mine Horizontal] Đào về hướng (${dx}, 0, ${dz})`);

    // Đào 2 khối phía trước
    await digBlockIfNotAir(bot, targetPos1, task);
    await digBlockIfNotAir(bot, targetPos2, task);

    // Kiểm tra tool sau khi đào
    await checkToolDurability(bot, task);

    // Đặt đuốc nếu cần (dựa vào distanceDug)
    await placeTorchIfNeeded(bot, task.distanceDug);

    // Di chuyển tới 1 block bằng pathfinder
    const nextPos = currentPos.offset(dx, 0, dz); // Vị trí mục tiêu để di chuyển tới
    console.log(`[Strip Mine Horizontal] Di chuyển tới ${formatCoords(nextPos)}`);
    try {
        // Sử dụng GoalNear để giữ nguyên Y level và linh hoạt hơn
        await bot.pathfinder.goto(new GoalNear(nextPos.x, task.targetY, nextPos.z, 0.5)); // Giữ Y mục tiêu
        // Chờ ổn định
        await bot.waitForTicks(5);

        // Kiểm tra lại Y level sau khi di chuyển
        if (Math.abs(bot.entity.position.y - task.targetY) > 0.5) { // Cho phép sai số nhỏ
             console.warn(`[Strip Mine Horizontal] Bị lệch Y level sau khi di chuyển! (Hiện tại: ${bot.entity.position.y.toFixed(1)}, Mục tiêu: ${task.targetY}). Đang cố gắng về lại...`);
             try {
                await bot.pathfinder.goto(new GoalBlock(bot.entity.position.x, task.targetY, bot.entity.position.z));
                await bot.waitForTicks(5);
             } catch (fixYError) {
                  console.error(`[Strip Mine Horizontal] Không thể về lại Y mục tiêu: ${fixYError.message}`);
                  // Có thể dừng task ở đây nếu Y level quá quan trọng
             }
        }
        task.distanceDug++; // Chỉ tăng distance khi đào ngang thành công
    } catch(e) {
         console.error("[Strip Mine Horizontal] Lỗi di chuyển tới:", e.message);
         throw new Error("Lỗi di chuyển trong hầm ngang");
    }
}

// --- VÒNG LẶP CHÍNH ĐÀO NGANG ---
async function stripMineLoop(bot) {
    if (!bot.isStripMining || !bot.stripMineTaskDetails) {
        console.log("[Strip Mine Loop] Dừng (không có task hoặc không mining).");
        return;
    }

    const task = bot.stripMineTaskDetails;

    try {
        // Điều kiện dừng
        if (task.distanceDug >= task.targetLength) {
            finishStripMining(bot, true, `Đã đào xong hầm dài ${task.distanceDug} block.`);
            return;
        }
        if (bot.inventory.isFull()) { // Kiểm tra túi đồ đầy hẳn
            finishStripMining(bot, false, "Túi đồ đầy, dừng đào hầm.");
            return;
        }
        if (bot.inventory.emptySlotCount() <= 2) { // Cảnh báo túi đồ gần đầy
             console.warn("[Strip Mine Loop] Túi đồ gần đầy!");
             // Có thể thêm logic quay về hoặc thông báo cho người dùng
        }

        // Thực hiện một bước đào ngang
        await digForwardAndMove(bot, task);

        // Lên lịch cho lần đào tiếp theo
        setTimeout(() => stripMineLoop(bot), CHECK_INTERVAL_MS);

    } catch (error) {
        console.error("[Strip Mine Loop] Gặp lỗi:", error.message);
        finishStripMining(bot, false, `Gặp lỗi khi đào hầm ngang: ${error.message}`);
    }
}

// --- BẮT ĐẦU NHIỆM VỤ ---
async function startStripMiningTask(bot, username, message, aiModel) {
    console.log(`[Strip Mine] Xử lý yêu cầu đào hầm từ ${username}: "${message}"`);

    // Kiểm tra trạng thái bận
    if (bot.isFinding || bot.isFollowing || bot.isProtecting || bot.isCollecting || bot.isStripMining || bot.isHunting) {
        let reason = bot.isFinding ? 'tìm đồ' : (bot.isFollowing ? 'đi theo' : (bot.isProtecting ? 'bảo vệ' : (bot.isCollecting ? 'thu thập' : (bot.isStripMining ? 'đào hầm' : 'săn bắn'))));
        bot.chat(`${username}, tôi đang bận ${reason} rồi!`);
        return;
    }

    // TODO: Trích xuất Y level, chiều dài, loại quặng từ message nếu muốn
    const targetY = DEFAULT_Y_LEVEL;
    const targetLength = TUNNEL_LENGTH;
    const targetOre = "kim cương"; // Hiện tại chỉ để hiển thị

    // Kiểm tra trang bị ban đầu
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

    // Khởi tạo task details sớm để các hàm con có thể truy cập
     bot.isStripMining = true; // Đặt trạng thái trước khi di chuyển/đào
     bot.stripMineTaskDetails = {
        username: username,
        targetY: targetY,
        targetLength: targetLength,
        startPosition: bot.entity.position.clone(),
        blocksDugSinceToolCheck: 0, // Bộ đếm để kiểm tra tool
        distanceDug: 0, // Khoảng cách đào ngang
        torchesPlaced: 0,
    };
    const task = bot.stripMineTaskDetails; // Tham chiếu đến task

    // --- Di chuyển đến Y mục tiêu bằng cầu thang ---
    let currentY = Math.floor(bot.entity.position.y);
    if (currentY !== targetY) {
        try {
            await digStaircaseToY(bot, targetY, task);
            // Sau khi đào xong, đảm bảo bot nhìn về hướng sẽ đào ngang
            // (Có thể đặt hướng cố định hoặc dựa vào hướng cầu thang)
            // Ví dụ: Nếu cầu thang đào về +Z, thì quay lưng lại (-Z) hoặc sang ngang (+X/-X)
            const finalPos = bot.entity.position;
            await bot.lookAt(finalPos.offset(1,0,0), true); // Nhìn về +X (East) để bắt đầu đào ngang
            console.log("[Strip Mine] Đã đào xong cầu thang. Chuẩn bị đào ngang.");

        } catch (err) {
            console.error("[Strip Mine] Lỗi khi đào cầu thang đến Y mục tiêu:", err.message);
            bot.chat(`Xin lỗi ${username}, tôi gặp lỗi khi đào cầu thang: ${err.message}`);
            finishStripMining(bot, false, `Lỗi khi đào cầu thang: ${err.message}`); // Dọn dẹp task
            return;
        }
    } else {
         console.log(`[Strip Mine] Đã ở Y=${targetY}. Bỏ qua đào cầu thang.`);
         // Đảm bảo bot nhìn về hướng đào ngang nếu đã ở đúng Y
         const currentPos = bot.entity.position;
         await bot.lookAt(currentPos.offset(1,0,0), true); // Nhìn về +X (East)
    }
    // --- Kết thúc di chuyển đến Y ---

    // Bắt đầu vòng lặp đào ngang
    console.log("[Strip Mine] Bắt đầu vòng lặp đào ngang...");
    stripMineLoop(bot);
}

// --- KẾT THÚC NHIỆM VỤ ---
function finishStripMining(bot, success, message) {
    if (!bot.isStripMining) return;
    const task = bot.stripMineTaskDetails;
    const username = task?.username || "bạn";
    console.log(`[Strip Mine Finish] Kết thúc. Thành công: ${success}. Lý do: ${message}`);
    bot.chat(`${username}, ${message}`);

    bot.isStripMining = false;
    bot.stripMineTaskDetails = null;
    try {
        // Cố gắng dừng các hành động có thể đang diễn ra
        bot.pathfinder.stop();
        bot.stopDigging(); // Ngừng đào nếu đang đào
        bot.clearControlStates(); // Đảm bảo không còn giữ phím nào
    } catch(e) {
        console.error("[Strip Mine Finish] Lỗi khi dừng hành động:", e);
    }
}

// --- DỪNG NHIỆM VỤ (Bởi người dùng) ---
function stopStripMining(bot, username) {
     if (bot.isStripMining) {
        console.log(`[Strip Mine Stop] Người dùng ${username} yêu cầu dừng.`);
        // Cung cấp lý do rõ ràng hơn
        finishStripMining(bot, false, `Đã dừng đào hầm theo yêu cầu của ${username}.`);
    } else {
         console.log(`[Strip Mine Stop] Nhận yêu cầu dừng từ ${username} nhưng không đào hầm.`);
         // Không cần chat nếu không làm gì
    }
}

module.exports = {
    startStripMiningTask,
    stopStripMining,
};
// --- END OF FILE strip_mine.js ---