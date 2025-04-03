const { GoalNear } = require("mineflayer-pathfinder").goals;
const { Vec3 } = require("vec3");
const { formatCoords } = require("../utils");

const SLEEP_SEARCH_RADIUS = 50;
const SLEEP_REACH_DIST = 1.5; // Khoảng cách đủ gần để tương tác với giường

async function findNearestBed(bot) {
    const mcData = require('minecraft-data')(bot.version);
    // Lấy ID của tất cả các loại giường
    const bedBlockIds = mcData.blocksArray
        .filter(block => block.name.endsWith('_bed'))
        .map(block => block.id);

    if (bedBlockIds.length === 0) {
        console.error("[Sleep] Không tìm thấy ID khối giường trong minecraft-data.");
        return null;
    }

    console.log(`[Sleep] Tìm kiếm giường trong bán kính ${SLEEP_SEARCH_RADIUS} block...`);
    return bot.findBlock({
        matching: bedBlockIds,
        maxDistance: SLEEP_SEARCH_RADIUS,
        count: 1
    });
}

async function goToSleep(bot, username) {
    console.log(`[Sleep] ${username} yêu cầu đi ngủ.`);

    if (bot.isSleeping) {
        bot.chat(`Tôi đang ngủ rồi mà ${username}.`);
        return;
    }

    if (bot.isFinding || bot.isFollowing || bot.isProtecting || bot.isCollecting) {
        let reason = bot.isFinding ? 'tìm đồ' : (bot.isFollowing ? 'đi theo' : (bot.isProtecting ? 'bảo vệ' : 'thu thập'));
        bot.chat(`${username}, tôi đang bận ${reason} rồi, không đi ngủ được!`);
        console.log(`[Sleep] Bị chặn do đang ${reason}.`);
        return;
    }

    // Kiểm tra điều kiện ngủ (chỉ ngủ được ở Overworld vào ban đêm hoặc khi có bão)
    const time = bot.time.timeOfDay;
    const isNight = time >= 12541 && time <= 23458; // Khoảng thời gian ban đêm tương đối
    const isRainingOrThundering = bot.isRaining; // Mineflayer coi cả mưa và bão là isRaining
    const canSleepNow = isNight || isRainingOrThundering;
    const currentDimensionName = bot.game.dimension?.toLowerCase() || 'unknown'; // Lấy tên, chuyển về chữ thường, xử lý nếu undefined
    console.log(`[Sleep Debug] Current dimension reported: '${bot.game.dimension}', Processed as: '${currentDimensionName}'`); // Thêm log để debug
    const isOverworld = currentDimensionName.endsWith('overworld'); // Kiểm tra xem tên có kết thúc bằng 'overworld' không

    if (!isOverworld) {
        bot.chat(`Xin lỗi ${username}, tôi chỉ ngủ được ở Overworld thôi.`);
        // Log tên gốc để dễ kiểm tra
        console.log(`[Sleep] Không thể ngủ do đang ở dimension: ${bot.game.dimension} (Processed as: ${currentDimensionName})`);
        return;
    }

    if (!canSleepNow) {
        bot.chat(`Trời vẫn còn sáng ${username}, chưa ngủ được đâu.`);
        console.log(`[Sleep] Chưa thể ngủ: isNight=${isNight}, isRaining=${isRainingOrThundering}`);
        return;
    }

    const bedBlock = await findNearestBed(bot);

    if (!bedBlock) {
        bot.chat(`Xin lỗi ${username}, tôi không tìm thấy cái giường nào trong vòng ${SLEEP_SEARCH_RADIUS} block cả.`);
        console.log(`[Sleep] Không tìm thấy giường.`);
        return;
    }

    console.log(`[Sleep] Tìm thấy giường tại ${formatCoords(bedBlock.position)}.`);
    bot.chat(`Ok ${username}, tìm thấy giường rồi, tôi đang đi đến đó...`);

    try {
        const goal = new GoalNear(bedBlock.position.x, bedBlock.position.y, bedBlock.position.z, SLEEP_REACH_DIST);
        await bot.pathfinder.goto(goal);
        console.log(`[Sleep] Đã đến gần giường tại ${formatCoords(bedBlock.position)}.`);

        await bot.sleep(bedBlock);
        console.log(`[Sleep] Đã gửi lệnh ngủ.`);
        // Bot sẽ tự động chat khi thức dậy (xử lý trong bot.js qua event 'wake')
        // bot.chat(`${username}, tôi đang ngủ... khò khò...`); // Không cần thiết vì có event

    } catch (err) {
        console.error(`[Sleep] Lỗi khi di chuyển hoặc ngủ:`, err.message);
        const errorMsg = err.message.toLowerCase();
        if (errorMsg.includes('too far away')) {
             bot.chat(`Ối ${username}, tôi đến gần giường rồi mà vẫn không ngủ được? Lạ thật.`);
        } else if (errorMsg.includes('occupied')) {
             bot.chat(`Giường này có ai nằm rồi ${username}!`);
        } else if (errorMsg.includes('monsters nearby')) {
             bot.chat(`Có quái vật gần đây ${username}, không ngủ được!`);
        } else if (errorMsg.includes('can only sleep at night or during thunderstorms')) {
             bot.chat(`Ơ? Tưởng ngủ được rồi chứ? ${username}, hình như trời lại sáng rồi.`);
        } else if (errorMsg.includes('no path') || errorMsg.includes('unreachable') || errorMsg.includes('timeout') || errorMsg.includes('interrupted')) {
             bot.chat(`Xin lỗi ${username}, tôi không đến được chỗ cái giường đó.`);
        }
         else {
            bot.chat(`Xin lỗi ${username}, tôi gặp lỗi khi cố gắng đi ngủ.`);
        }
         // Dừng pathfinder nếu đang chạy
        try { if (bot.pathfinder?.isMoving()) bot.pathfinder.stop(); } catch(e) {}
    }
}

module.exports = {
    goToSleep,
};