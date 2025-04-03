// commands/find.js
const { GoalNear } = require("mineflayer-pathfinder").goals;
const { Vec3 } = require("vec3");
const { translateToEnglishId, formatCoords } = require("../utils");

const MAX_FIND_DISTANCE = 128;
const GOTO_RANGE = 1;

async function startFindingTask(bot, username, message, aiModel) {
    console.log(`[Find Cmd Check State] Trước khi kiểm tra: isFinding=${bot.isFinding}, isFollowing=${bot.isFollowing}`);
    if (bot.isFinding) {
        console.log("[Find Cmd Check State] Bị chặn bởi bot.isFinding = true");
        bot.chat(`${username}, tôi đang bận tìm thứ khác rồi! (isFinding=true)`);
        return;
    }
    if (bot.isFollowing) {
        console.log("[Find Cmd Check State] Bị chặn bởi bot.isFollowing = true");
        bot.chat(`${username}, tôi đang đi theo người khác, không tìm được. (isFollowing=true)`);
        return;
    }

    console.log(`[Find Cmd] Bắt đầu xử lý yêu cầu tìm kiếm từ ${username}: "${message}"`);

    const extractionPrompt = `Phân tích yêu cầu tìm kiếm từ tin nhắn "${message}" của người chơi "${username}".
    Trích xuất tên vật phẩm/khối/sinh vật (giữ nguyên tiếng Việt nếu có) và số lượng cần tìm.
    Nếu không nói số lượng, mặc định là 1.
    Chỉ trả lời bằng định dạng JSON với hai khóa: "itemName" (string) và "quantity" (number).
    Ví dụ 1: Tin nhắn "tìm 5 cái bàn chế tạo" -> {"itemName": "bàn chế tạo", "quantity": 5}
    Ví dụ 2: Tin nhắn "kiếm cho tôi đá cuội" -> {"itemName": "đá cuội", "quantity": 1}
    Ví dụ 3: Tin nhắn "đi tìm 2 con rùa" -> {"itemName": "con rùa", "quantity": 2}
    JSON:`;
    let itemNameVi = null; let quantity = 1;
    try {
        console.log("[Find Cmd] Bước 1: Gửi prompt trích xuất...");
        const extractResult = await aiModel.generateContent(extractionPrompt);
        const jsonResponse = (await extractResult.response.text()).trim();
        console.log("[Find Cmd] Bước 1: Phản hồi JSON thô:", jsonResponse);
        let parsedData;
        try {
            const jsonMatch = jsonResponse.match(/\{.*\}/s);
            if (jsonMatch) parsedData = JSON.parse(jsonMatch[0]);
            else throw new Error("Không tìm thấy JSON.");
        } catch (parseError) {
             console.error("[Find Cmd] Bước 1: Lỗi parse JSON:", parseError, "Response:", jsonResponse);
             if (!jsonResponse.includes('{') && !jsonResponse.includes(':')) {
                 itemNameVi = jsonResponse.trim(); quantity = 1;
                 console.log(`[Find Cmd] Bước 1 Fallback: Name="${itemNameVi}", Quantity=1.`);
             } else throw new Error("Không thể phân tích phản hồi AI.");
        }
        if (parsedData) {
            itemNameVi = parsedData.itemName;
            quantity = parseInt(parsedData.quantity, 10) || 1;
        }
        if (!itemNameVi) throw new Error("AI không trích xuất được tên.");
        quantity = Math.max(1, quantity);
        console.log(`[Find Cmd] Bước 1: AI trích xuất: Tên="${itemNameVi}", Số lượng=${quantity}`);
    } catch (error) {
        console.error("[Find Cmd] Bước 1: Lỗi trích xuất:", error);
        bot.chat(`Xin lỗi ${username}, tôi không hiểu bạn muốn tìm gì/số lượng.`);
        bot.isFinding = false;
        bot.findingTaskDetails = null;
        return;
    }

    let targetId;
    try {
        console.log("[Find Cmd] Bước 2: Dịch tên...");
        targetId = translateToEnglishId(itemNameVi);
        if (!targetId) {
            console.log(`[Find Cmd] Bước 2: Không dịch được "${itemNameVi}".`);
            bot.chat(`Xin lỗi ${username}, tôi không biết "${itemNameVi}" là gì.`);
            bot.isFinding = false; bot.findingTaskDetails = null; return;
        }
        console.log(`[Find Cmd] Bước 2: Đã dịch "${itemNameVi}" thành ID: "${targetId}"`);
    } catch (error) {
         console.error("[Find Cmd] Bước 2: Lỗi khi dịch:", error);
         bot.chat(`Xin lỗi ${username}, có lỗi khi dịch tên.`);
         bot.isFinding = false; bot.findingTaskDetails = null; return;
    }

    let mcData; let targetType = null; let blockInfo = null; let entityInfo = null;
    try {
        console.log("[Find Cmd] Bước 3: Xác định loại mục tiêu...");
        mcData = require('minecraft-data')(bot.version);
        blockInfo = mcData.blocksByName[targetId];
        entityInfo = mcData.entitiesByName[targetId];
        if (blockInfo) targetType = 'block';
        else if (entityInfo) targetType = 'entity';
        else if (bot.players[targetId] || bot.players['.' + targetId]) targetType = 'player';
        else throw new Error(`Không tìm thấy thông tin cho ID "${targetId}"`);
        console.log(`[Find Cmd] Bước 3: Loại mục tiêu: ${targetType}`);
    } catch (error) {
        console.error("[Find Cmd] Bước 3: Lỗi khi kiểm tra mcData:", error);
        bot.chat(`Xin lỗi ${username}, có lỗi khi tìm thông tin về "${itemNameVi}".`);
        bot.isFinding = false; bot.findingTaskDetails = null; return;
    }

    let foundObjects = [];
    try {
        console.log("[Find Cmd] Bước 4: Tìm kiếm đối tượng trong game...");
        if (targetType === 'block') {
            foundObjects = bot.findBlocks({ matching: blockInfo.id, maxDistance: MAX_FIND_DISTANCE, count: quantity });
        } else {
            let count = 0; const foundEntityIds = new Set();
            for (const entityId in bot.entities) {
                if (count >= quantity) break;
                const entity = bot.entities[entityId];
                if (!entity || foundEntityIds.has(entity.id) || bot.entity.position.distanceTo(entity.position) > MAX_FIND_DISTANCE) continue;
                let match = false;
                if (targetType === 'player') { if (entity.type === 'player' && (entity.username === targetId || entity.username === '.' + targetId)) match = true; }
                else { if (entity.name === targetId) match = true; }
                if (match) { foundObjects.push(entity); foundEntityIds.add(entity.id); count++; }
            }
        }
        console.log(`[Find Cmd] Bước 4: Tìm thấy ${foundObjects.length} đối tượng.`);
    } catch (error) {
        console.error("[Find Cmd] Bước 4: Lỗi khi tìm kiếm:", error);
        bot.chat(`Xin lỗi ${username}, tôi gặp lỗi khi tìm kiếm.`);
        bot.isFinding = false; bot.findingTaskDetails = null; return;
    }
    if (foundObjects.length === 0) {
        console.log(`[Find Cmd] Bước 4: Không tìm thấy đối tượng nào.`);
        bot.chat(`Xin lỗi ${username}, tôi không tìm thấy ${targetType === 'block' ? 'khối' : (targetType === 'player' ? 'người chơi' : 'con')} "${itemNameVi}" nào gần đây.`);
        bot.isFinding = false; bot.findingTaskDetails = null; return;
    }

    console.log("[Find Cmd] Bước 5: Khởi tạo trạng thái và bắt đầu di chuyển...");
    bot.isFinding = true;
    console.log("[Find Cmd State Change] bot.isFinding được đặt thành TRUE");
    bot.findingTaskDetails = {
        username: username, targetNameVi: itemNameVi, targetId: targetId,
        targetType: targetType, neededCount: quantity, locationsOrEntities: foundObjects,
        foundCount: 0, currentIndex: 0, waitingForConfirmation: false,
        lastReachedTargetDescription: null
    };

    const firstObjectName = targetType === 'block' ? `khối "${itemNameVi}"` : (foundObjects[0].username || `con "${itemNameVi}"`);
    bot.chat(`Tìm thấy ${foundObjects.length} ${targetType === 'block' ? 'khối' : 'đối tượng'}. Bắt đầu đi đến ${firstObjectName} đầu tiên...`);
    navigateToNextTarget(bot);
}

function navigateToNextTarget(bot) {
    const task = bot.findingTaskDetails;
    if (!task || !bot.isFinding || task.waitingForConfirmation) return;

    if (task.currentIndex >= task.locationsOrEntities.length || task.foundCount >= task.neededCount) {
        const message = task.foundCount >= task.neededCount
            ? `Đã tìm đủ ${task.foundCount}/${task.neededCount} ${task.targetType === 'block' ? 'khối' : 'con'} "${task.targetNameVi}".`
            : `Đã đi đến tất cả ${task.foundCount} vị trí/đối tượng tìm thấy.`;
        finishFindingTask(bot, true, message);
        return;
    }

    const currentTarget = task.locationsOrEntities[task.currentIndex];
    const targetIndex = task.currentIndex + 1;
    let goal;
    let targetDescription;
    let targetPosition;

    try {
        if (!bot.pathfinder) throw new Error("Pathfinder không khả dụng.");

        if (task.targetType === 'block') {
            targetPosition = currentTarget;
            targetDescription = `khối "${task.targetNameVi}" thứ ${targetIndex} tại ${formatCoords(targetPosition)}`;
            console.log(`[Find Nav] Chuẩn bị đi đến KHỐI: ${formatCoords(targetPosition)}`);
        } else {
            const entityTarget = currentTarget;
            targetDescription = `${entityTarget.username || `con "${task.targetNameVi}"`} thứ ${targetIndex} (ID: ${entityTarget.id})`;
            if (!bot.entities[entityTarget.id]) {
                 console.warn(`[Find Nav] Thực thể ${targetDescription} không còn tồn tại. Bỏ qua.`);
                 bot.chat(`Có vẻ ${targetDescription} đã biến mất! Bỏ qua...`);
                 task.currentIndex++;
                 navigateToNextTarget(bot);
                 return;
            }
            targetPosition = entityTarget.position;
            console.log(`[Find Nav] Chuẩn bị đi đến VỊ TRÍ của thực thể: ${targetDescription} tại ${formatCoords(targetPosition)}`);
        }

        goal = new GoalNear(targetPosition.x, targetPosition.y, targetPosition.z, GOTO_RANGE);
        task.lastReachedTargetDescription = targetDescription;
        bot.chat(`Đang đi đến ${targetDescription}...`);
        bot.pathfinder.setGoal(goal);
        console.log("[Find Nav] Đã đặt mục tiêu di chuyển (GoalNear).");

    } catch (error) {
        console.error("[Find Nav] Lỗi khi đặt mục tiêu:", error);
        bot.chat(`Xin lỗi ${task.username}, tôi gặp lỗi khi cố gắng đi đến ${targetDescription}.`);
        finishFindingTask(bot, false, "Lỗi hệ thống di chuyển.");
    }
}

function handleFindGoalReached(bot) {
    console.log("[Find Event] handleFindGoalReached ENTERED.");
    if (!bot.isFinding || !bot.findingTaskDetails) {
        console.log(`[Find Event] handleFindGoalReached SKIPPED (Not finding or no details). isFinding=${bot.isFinding}`);
        return;
    }
    if (bot.findingTaskDetails.waitingForConfirmation) {
        console.log(`[Find Event] handleFindGoalReached SKIPPED (Already waiting for confirmation).`);
        return;
    }

    const task = bot.findingTaskDetails;
    task.foundCount++;
    const targetDescription = task.lastReachedTargetDescription || `mục tiêu thứ ${task.foundCount}`;

    console.log(`[Find Event] Đã đến ${targetDescription}. Đã tìm ${task.foundCount}/${task.neededCount}.`);
    bot.chat(`Đã đến ${targetDescription}. (${task.foundCount}/${task.neededCount})`);

    const hasMoreTargets = task.currentIndex + 1 < task.locationsOrEntities.length;
    const needsMore = task.foundCount < task.neededCount;

    if (needsMore && hasMoreTargets) {
        task.waitingForConfirmation = true;
        console.log("[Find Event] Đang chờ xác nhận từ người dùng để đi tiếp...");
        bot.chat(`${task.username}, bạn muốn tôi đi đến mục tiêu tiếp theo không? (nói 'tiếp', 'ok', 'có' hoặc 'dừng', 'hủy', 'thôi')`);
    } else {
        const message = needsMore
            ? `Không còn mục tiêu nào khác để tìm.`
            : `Đã tìm đủ ${task.foundCount}/${task.neededCount} ${task.targetType === 'block' ? 'khối' : 'con'} "${task.targetNameVi}".`;
        finishFindingTask(bot, true, message);
    }
}

function proceedToNextTarget(bot) {
    if (!bot.isFinding || !bot.findingTaskDetails || !bot.findingTaskDetails.waitingForConfirmation) return;
    const task = bot.findingTaskDetails;
    console.log(`[Find Confirm] Người dùng ${task.username} xác nhận đi tiếp.`);
    task.waitingForConfirmation = false;
    task.currentIndex++;
    navigateToNextTarget(bot);
}

function handleFindPathError(bot, reason) {
    if (!bot.isFinding || !bot.findingTaskDetails || bot.findingTaskDetails.waitingForConfirmation) return;
    const task = bot.findingTaskDetails;
    const targetIndex = task.currentIndex + 1;
    const currentTarget = task.locationsOrEntities[task.currentIndex];
    const targetDescription = task.targetType === 'block'
        ? `vị trí khối "${task.targetNameVi}" thứ ${targetIndex}`
        : `${currentTarget?.username || `con "${task.targetNameVi}"`} thứ ${targetIndex}`;
    console.error(`[Find Event] Lỗi di chuyển (${reason}) khi đang đi đến ${targetDescription}.`);
    bot.chat(`Ối! Không thể đến được ${targetDescription}. Lý do: ${reason}.`);
    task.currentIndex++;
    bot.chat(`Đang thử đi đến mục tiêu tiếp theo (nếu có)...`);
    navigateToNextTarget(bot);
}

function finishFindingTask(bot, success, message) {
    if (!bot.isFinding) {
        console.log("[Find Finish] Gọi finishFindingTask nhưng bot.isFinding đã là false.");
        return;
    }
    const task = bot.findingTaskDetails;
    const username = task?.username || "bạn";
    console.log(`[Find Finish] Kết thúc. Thành công: ${success}. Lý do: ${message}`);
    bot.chat(`${username}, ${message}`);
    console.log("[Find Cmd State Change] bot.isFinding sẽ được đặt thành FALSE");
    bot.isFinding = false;
    bot.findingTaskDetails = null;
    try {
        if (bot.pathfinder?.isMoving()) {
            bot.pathfinder.stop();
            console.log("[Find Finish] Đã dừng pathfinder.");
        }
    } catch (e) {
        console.error("[Find Finish] Lỗi dừng pathfinder:", e);
    }
}

function stopFinding(bot) {
    if (bot.isFinding) {
        console.log("[Find Stop] Nhận yêu cầu dừng tìm kiếm.");
        finishFindingTask(bot, false, `Đã dừng tìm kiếm theo yêu cầu.`);
    } else {
        console.log("[Find Stop] Nhận yêu cầu dừng nhưng bot không trong trạng thái isFinding.");
    }
}

module.exports = {
    startFindingTask,
    handleFindGoalReached,
    handleFindPathError,
    stopFinding,
    proceedToNextTarget,
};