// commands/protect.js
const { GoalFollow, GoalNear } = require("mineflayer-pathfinder").goals;
const { Vec3 } = require("vec3");
const { formatCoords } = require("../utils"); // Giữ lại nếu bạn có file này

const PROTECT_FOLLOW_DISTANCE = 3;
const PROTECT_RADIUS = 16; // Bán kính tìm mob quanh người chơi
const PROTECT_MOB_MAX_DISTANCE = 20; // Khoảng cách tối đa từ mob đến người chơi được bảo vệ trước khi quay lại
const ATTACK_INTERVAL = 500; // ms
const ATTACK_RANGE = 4.5;
const ENGAGE_RANGE = ATTACK_RANGE - 1.0; // Khoảng cách mục tiêu khi di chuyển đến mob

const armorMaterialTier = { leather: 1, golden: 2, chainmail: 3, iron: 4, diamond: 5, netherite: 6 };
const weaponMaterialTier = { wooden: 1, stone: 2, golden: 3, iron: 4, diamond: 5, netherite: 6 };
let mcData = null;

// Hàm equipBestGear giữ nguyên như code gốc của bạn
async function equipBestGear(bot) {
    if (!mcData) mcData = require('minecraft-data')(bot.version);

    let bestItems = { hand: null, head: null, torso: null, legs: null, feet: null };
    let currentTiers = { hand: 0, head: 0, torso: 0, legs: 0, feet: 0 };
    let equippedWeapon = false;

    const heldItemDirect = bot.heldItem;
    if (heldItemDirect && (heldItemDirect.name.includes('_sword') || heldItemDirect.name.includes('_axe'))) {
        const material = heldItemDirect.name.split('_')[0];
        const tier = weaponMaterialTier[material] || 0;
        if (tier > 0) {
            currentTiers['hand'] = tier;
            bestItems['hand'] = heldItemDirect;
            equippedWeapon = true; // Đã cầm sẵn vũ khí
        }
    }

    for (const slot of ['head', 'torso', 'legs', 'feet']) {
        const equipmentSlotIndex = bot.getEquipmentDestSlot(slot);
        const equippedItem = bot.inventory.slots[equipmentSlotIndex];
        if (equippedItem) {
            const material = equippedItem.name.split('_')[0];
            const tier = armorMaterialTier[material] || 0;
            if (tier > 0) {
                currentTiers[slot] = tier;
                bestItems[slot] = equippedItem;
            }
        }
    }

    for (const item of bot.inventory.items()) {
        const itemName = item.name;
        const itemInfo = mcData.itemsByName[itemName];
        if (!itemInfo) continue;

        const material = itemName.split('_')[0];
        let slot = null;
        let tier = 0;
        let isWeapon = false;

        if (itemInfo.equipment?.includes('hand') && (itemName.includes('_sword') || itemName.includes('_axe'))) {
            slot = 'hand';
            tier = weaponMaterialTier[material] || 0;
            isWeapon = true;
        } else if (itemInfo.equipment?.includes('head')) slot = 'head';
        else if (itemInfo.equipment?.includes('torso')) slot = 'torso';
        else if (itemInfo.equipment?.includes('legs')) slot = 'legs';
        else if (itemInfo.equipment?.includes('feet')) slot = 'feet';

        if (slot && slot !== 'hand') {
             tier = armorMaterialTier[material] || 0;
        }

        if (slot && tier > currentTiers[slot]) {
            currentTiers[slot] = tier;
            bestItems[slot] = item;
            // Không set equippedWeapon ở đây, chỉ set khi thực sự equip hoặc đã cầm sẵn
        }
    }

    // Trang bị vũ khí TỐT NHẤT tìm được nếu nó khác với đồ đang cầm
    if (bestItems['hand'] && (!bot.heldItem || bot.heldItem.type !== bestItems['hand'].type)) {
        try {
            await bot.equip(bestItems['hand'], 'hand');
            equippedWeapon = true; // Đã trang bị thành công
        } catch (err) {
            console.error(`[Protect Equip] Error equipping weapon ${bestItems['hand'].name}:`, err.message);
            // Kiểm tra lại xem có đang cầm vũ khí nào không sau khi lỗi
            const currentHeld = bot.heldItem;
            equippedWeapon = !!(currentHeld && (currentHeld.name.includes('_sword') || currentHeld.name.includes('_axe')));
        }
    } else if (bestItems['hand'] || equippedWeapon) { // Nếu tìm thấy best hand hoặc đã cầm sẵn vũ khí
         equippedWeapon = true;
    }
    // Nếu không tìm thấy vũ khí nào cả (bestItems['hand'] là null) và không cầm sẵn vũ khí, equippedWeapon sẽ là false

    // Trang bị giáp
    for (const slot of ['head', 'torso', 'legs', 'feet']) {
         let currentEquipped = bot.inventory.slots[bot.getEquipmentDestSlot(slot)];
        if (bestItems[slot] && (!currentEquipped || currentEquipped.type !== bestItems[slot].type)) {
            try {
                await bot.equip(bestItems[slot], slot);
            } catch (err) {
                console.error(`[Protect Equip] Error equipping ${bestItems[slot].name} into slot ${slot}:`, err.message);
            }
        }
    }

    return equippedWeapon; // Trả về true nếu bot có vũ khí (đã trang bị hoặc đang cầm)
}


// Hàm getPlayerFollowGoal giữ nguyên, thêm kiểm tra isValid
function getPlayerFollowGoal(bot) {
    if (!bot.protectingTarget) return null;
    // Lấy thực thể mới nhất và kiểm tra
    const targetEntity = bot.entities[bot.protectingTarget.id];
    if (!targetEntity || !targetEntity.isValid) return null;
    return new GoalFollow(targetEntity, PROTECT_FOLLOW_DISTANCE);
}

// Hàm getMobEngageGoal giữ nguyên, thêm kiểm tra isValid
function getMobEngageGoal(mob) {
    if (!mob || !mob.position || !mob.isValid) return null;
    return new GoalNear(mob.position.x, mob.position.y, mob.position.z, ENGAGE_RANGE);
}

// Hàm isGoalEqual giữ nguyên, cải thiện so sánh GoalFollow
function isGoalEqual(goal1, goal2) {
    if (!goal1 || !goal2) return goal1 === goal2;
    if (goal1.constructor !== goal2.constructor) return false;

    if (goal1 instanceof GoalFollow) {
        // So sánh ID thay vì object trực tiếp
        return goal1.entity?.id === goal2.entity?.id && goal1.range === goal2.range;
    }
    if (goal1 instanceof GoalNear) {
        return goal1.x === goal2.x && goal1.y === goal2.y && goal1.z === goal2.z && goal1.range === goal2.range;
    }
    return false;
}

// --- Vòng lặp bảo vệ chính (Đã sửa đổi với logic mới) ---
async function protectionLoop(bot) { // <--- Thêm async
    if (!bot.isProtecting || !bot.protectingTarget) {
        stopProtecting(bot, "Internal Check Failed");
        return;
    }
    if (!mcData) mcData = require('minecraft-data')(bot.version);

    // Lấy thực thể người chơi mới nhất và kiểm tra (quan trọng!)
    const playerTarget = bot.entities[bot.protectingTarget.id];
    if (!playerTarget || !playerTarget.isValid) {
        stopProtecting(bot, "Mục tiêu không hợp lệ");
        return;
    }
    // Cập nhật tham chiếu trong bot nếu thực thể thay đổi (ví dụ respawn)
    bot.protectingTarget = playerTarget;
    const targetPosition = playerTarget.position;

    // Kiểm tra mob đang tấn công
    if (bot.engagingMob && (!bot.engagingMob.isValid || bot.engagingMob.health <= 0)) {
        // Tùy chọn: bot.chat(`Đã hạ gục ${bot.engagingMob.displayName || bot.engagingMob.name}.`);
        bot.engagingMob = null;
    }

    let hostileToEngage = null;

    // Ưu tiên mob đang tấn công nếu còn hợp lệ
    if (bot.engagingMob) {
        hostileToEngage = bot.engagingMob;
    } else {
        // Tìm mob thù địch gần nhất trong bán kính quanh người chơi
        hostileToEngage = bot.nearestEntity(entity => {
            if (!entity || !entity.position || !entity.isValid) return false;
            if (entity.position.distanceTo(targetPosition) > PROTECT_RADIUS) return false; // Khoảng cách từ mob đến người chơi
            if (entity === playerTarget || entity === bot.entity) return false;
            if (entity.type !== 'mob' && entity.type !== 'hostile') return false;
            if (entity.health !== undefined && entity.health <= 0) return false;

            const entityKind = entity.kind;
            const mobData = mcData.entitiesByName[entity.name];
            const mcDataCategory = mobData?.category;
            const isHostile = (entityKind && (entityKind === 'Hostile Mob' || entityKind === 'Hostile mobs')) ||
                              (!entityKind && mcDataCategory === 'Hostile mobs');
            return isHostile;
        });
    }

    // Xử lý nếu tìm thấy mob thù địch
    if (hostileToEngage) {
        const distanceMobToPlayer = hostileToEngage.position.distanceTo(targetPosition);

        // *** KIỂM TRA KHOẢNG CÁCH MOB VỚI NGƯỜI CHƠI ***
        if (distanceMobToPlayer > PROTECT_MOB_MAX_DISTANCE) {
            // Mob quá xa người chơi cần bảo vệ
            if (bot.engagingMob) { // Chỉ thông báo nếu đang dí theo nó
                 bot.chat(`${hostileToEngage.displayName || hostileToEngage.name} đã đi quá xa (${distanceMobToPlayer.toFixed(1)}m), quay lại bảo vệ ${playerTarget.username}!`);
                 if (bot.pathfinder.isMoving()) {
                     bot.pathfinder.stop(); // Dừng di chuyển nếu đang đuổi theo
                 }
                 bot.engagingMob = null; // Dừng dí theo mob này
            }
            // Đặt lại hostileToEngage để logic đi theo người chơi được thực thi ở khối else dưới
            hostileToEngage = null;
        } else {
            // Mob ở trong phạm vi hợp lý, tiếp tục xử lý

            // *** KIỂM TRA NẾU LÀ MOB MỚI ***
            if (hostileToEngage !== bot.engagingMob) {
                bot.chat(`Phát hiện ${hostileToEngage.displayName || hostileToEngage.name}! Đang tiếp cận...`);
                bot.engagingMob = hostileToEngage; // Đặt làm mục tiêu mới

                // *** TRANG BỊ VŨ KHÍ TỐT NHẤT TRƯỚC KHI ĐÁNH ***
                // (Logic tìm và trang bị vũ khí tốt nhất tại chỗ)
                let bestWeapon = null;
                let currentWeaponTier = 0;
                const heldItem = bot.heldItem;

                // Kiểm tra vũ khí đang cầm
                if (heldItem && (heldItem.name.includes('_sword') || heldItem.name.includes('_axe'))) {
                    const material = heldItem.name.split('_')[0];
                    currentWeaponTier = weaponMaterialTier[material] || 0;
                    if (currentWeaponTier > 0) {
                        bestWeapon = heldItem;
                    }
                }

                // Tìm vũ khí tốt hơn trong túi đồ
                for (const item of bot.inventory.items()) {
                    const itemName = item.name;
                    const itemInfo = mcData.itemsByName[itemName];
                    if (!itemInfo) continue;
                    if (itemInfo.equipment?.includes('hand') && (itemName.includes('_sword') || itemName.includes('_axe'))) {
                        const material = itemName.split('_')[0];
                        const tier = weaponMaterialTier[material] || 0;
                        if (tier > currentWeaponTier) {
                            currentWeaponTier = tier;
                            bestWeapon = item;
                        }
                    }
                }

                // Trang bị nếu tìm thấy vũ khí tốt hơn và chưa cầm nó
                if (bestWeapon && (!heldItem || heldItem.type !== bestWeapon.type)) {
                    try {
                        // bot.chat(`Trang bị ${bestWeapon.displayName}...`); // Tùy chọn: thông báo
                        await bot.equip(bestWeapon, 'hand'); // <--- Dùng await
                    } catch (err) {
                        console.error(`[Protect Loop] Lỗi khi trang bị vũ khí ${bestWeapon.name}:`, err.message);
                        // Không cần làm gì thêm, sẽ dùng vũ khí đang cầm (nếu có) hoặc tay không
                    }
                }
                // Nếu không có vũ khí nào hoặc không trang bị được, bot sẽ dùng tay không hoặc vũ khí đang cầm sẵn
            }

            // Hành động: Tấn công hoặc di chuyển đến gần
            const distanceToMob = bot.entity.position.distanceTo(hostileToEngage.position);

            if (distanceToMob <= ATTACK_RANGE) {
                if (bot.pathfinder.isMoving()) {
                    bot.pathfinder.stop();
                }
                // Cố gắng nhìn vào mob trước khi tấn công
                try {
                    // Nhìn vào phần thân trên của mob
                    await bot.lookAt(hostileToEngage.position.offset(0, hostileToEngage.height * 0.8, 0), true); // <--- Dùng await
                } catch(lookErr) {
                    // console.warn("Lỗi khi nhìn mob:", lookErr.message); // Bỏ qua lỗi nhìn nếu không quan trọng
                }
                bot.attack(hostileToEngage);

            } else {
                // Di chuyển đến gần mob hơn
                const mobGoal = getMobEngageGoal(hostileToEngage);
                // Chỉ đặt lại goal nếu goal hiện tại không phải là đến mob này hoặc đang đứng yên
                if (mobGoal && (!isGoalEqual(bot.pathfinder.goal, mobGoal) || !bot.pathfinder.isMoving())) {
                     try {
                         bot.pathfinder.setGoal(mobGoal, false); // Di chuyển đến gần, không cần giữ khoảng cách chính xác
                     } catch (e) {
                         console.error(`[Protect Loop] Error setting mob engage goal:`, e);
                         // Nếu lỗi, có thể dừng dí mob này để thử lại ở vòng lặp sau hoặc quay về người chơi
                         bot.engagingMob = null;
                     }
                }
            }
            // Đã xử lý mob, thoát khỏi hàm loop cho lần này
            return;
        }
    }

    // --- Nếu không có mob nào để tấn công (hoặc mob quá xa) ---
    // Đảm bảo không còn dí theo mob nào nữa (đã xử lý ở trên nếu mob quá xa)
    // if (bot.engagingMob && !hostileToEngage) { // Kiểm tra này có thể dư thừa
    //     bot.engagingMob = null;
    // }

    // Quay lại đi theo người chơi
    const playerGoal = getPlayerFollowGoal(bot);
    // Chỉ đặt lại goal nếu không có goal hoặc goal hiện tại không phải là theo người chơi
    // Hoặc nếu bot không di chuyển (ví dụ vừa dừng dí mob)
    if (playerGoal && (!bot.pathfinder.goal || !isGoalEqual(bot.pathfinder.goal, playerGoal))) {
        // Kiểm tra thêm nếu bot đang đứng yên thì nên đặt lại goal
        if (!bot.pathfinder.isMoving() || !(bot.pathfinder.goal instanceof GoalFollow)) {
            try {
                bot.pathfinder.setGoal(playerGoal, true); // Giữ khoảng cách chính xác
            } catch (e) {
                console.error(`[Protect Loop] Error setting player follow goal:`, e);
                stopProtecting(bot, "Lỗi pathfinder khi theo người chơi"); // Dừng nếu lỗi nghiêm trọng
            }
        }
    } else if (!playerGoal && bot.isProtecting) {
         // Trường hợp không thể tạo goal theo người chơi (target không hợp lệ đã bị miss?)
         console.warn("[Protect Loop] Không thể tạo GoalFollow cho người chơi.");
         stopProtecting(bot, "Lỗi tạo mục tiêu theo dõi");
    }
}

// --- Hàm bắt đầu bảo vệ (Giữ nguyên cách tìm người chơi gốc, gọi async loop) ---
async function startProtecting(bot, username) {
    if (bot.isProtecting) {
        bot.chat(`Tôi đang bảo vệ ${bot.protectingTarget?.username || 'ai đó'} rồi ${username}!`);
        return;
    }
    // Kiểm tra các trạng thái khác (giữ nguyên logic gốc)
    let busyReason = null;
    if (bot.isFinding) busyReason = 'tìm đồ';
    else if (bot.isFollowing) busyReason = 'đi theo';
    else if (bot.isCollecting) busyReason = 'thu thập';
    else if (bot.isStripMining) busyReason = 'đào hầm';
    else if (bot.isHunting) busyReason = 'săn bắn';
    // Thêm các trạng thái khác nếu có

    if (busyReason) {
        bot.chat(`Tôi đang bận ${busyReason}, không bảo vệ được ${username}!`);
        return;
    }

    // *** SỬ DỤNG LẠI LOGIC TÌM NGƯỜI CHƠI GỐC CỦA BẠN ***
    const usernameWithDot = '.' + username;
    const targetPlayer = bot.players[username]?.entity || bot.players[usernameWithDot]?.entity || bot.nearestEntity(entity =>
        entity.type === 'player' && (entity.username === username || entity.username === usernameWithDot) && entity.isValid // Thêm check isValid ở đây nữa cho chắc
    );

    // Kiểm tra targetPlayer kỹ hơn
    if (!targetPlayer || !targetPlayer.position || !targetPlayer.isValid) { // Thêm check isValid
        bot.chat(`Ơ ${username}, bạn ở đâu rồi hoặc không hợp lệ? Tôi không thấy bạn để bảo vệ!`);
        return;
    }

    const actualTargetUsername = targetPlayer.username || username; // Lấy username chuẩn từ entity

    bot.isProtecting = true;
    bot.protectingTarget = targetPlayer; // Lưu trữ thực thể người chơi ban đầu
    bot.engagingMob = null;

    // Trang bị đồ tốt nhất ban đầu (giữ nguyên logic gốc)
    const hasWeapon = await equipBestGear(bot); // equipBestGear đã là async
    if (!hasWeapon) {
        bot.chat(`Ok ${actualTargetUsername}, tôi sẽ đi theo bảo vệ, nhưng tôi không có vũ khí tốt!`);
    } else {
         bot.chat(`Ok ${actualTargetUsername}, tôi sẽ bảo vệ bạn! Đã trang bị đồ tốt nhất.`);
    }

    // Đặt mục tiêu ban đầu là theo người chơi (giữ nguyên logic gốc)
    const initialFollowGoal = getPlayerFollowGoal(bot);
    if (!initialFollowGoal) {
         bot.chat(`Ối ${actualTargetUsername}, không thể bắt đầu theo dõi bạn!`);
         stopProtecting(bot, "Không thể tạo mục tiêu theo dõi ban đầu.");
         return;
    }

    try {
        if (!bot.pathfinder) throw new Error("Pathfinder không khả dụng.");
        bot.pathfinder.setGoal(initialFollowGoal, true);
    } catch (e) {
        console.error(`[Protect Start] LỖI khi gọi bot.pathfinder.setGoal:`, e);
        bot.chat(`Ối ${actualTargetUsername}, hình như tôi bị lỗi hệ thống di chuyển rồi!`);
        stopProtecting(bot, "Lỗi pathfinder");
        return;
    }

    // Xóa interval cũ nếu có và tạo interval mới gọi hàm async
    if (bot.protectionInterval) clearInterval(bot.protectionInterval);
    bot.protectionInterval = setInterval(async () => { // <--- Thêm async ở đây
        // Thêm try...catch để bắt lỗi trong protectionLoop và ngăn dừng interval
        try {
            if (bot.isProtecting) { // Kiểm tra lại trạng thái trước khi chạy loop
                 await protectionLoop(bot); // <--- Dùng await để chờ loop hoàn thành
            } else {
                 // Nếu isProtecting bị tắt bởi lý do khác, dừng interval
                 stopProtecting(bot, "Hệ thống"); // Gọi stop để dọn dẹp interval
            }
        } catch (error) {
            console.error("[Protection Interval] Lỗi trong vòng lặp bảo vệ:", error);
            // Có thể cân nhắc dừng bảo vệ nếu lỗi nghiêm trọng
            // stopProtecting(bot, "Lỗi vòng lặp bảo vệ");
        }
    }, ATTACK_INTERVAL);
}

// Hàm stopProtecting giữ nguyên như code gốc của bạn (hoặc phiên bản cải thiện thông báo)
function stopProtecting(bot, usernameOrReason) {
    const wasProtecting = bot.protectingTarget?.username;
    const wasActive = bot.isProtecting;

    if (bot.protectionInterval) {
        clearInterval(bot.protectionInterval);
        bot.protectionInterval = null;
    }

    try {
        if (bot.pathfinder?.isMoving()) {
            bot.pathfinder.stop();
        }
    } catch (e) {
        console.error(`[StopProtect] Lỗi khi gọi bot.pathfinder.stop():`, e);
    }

    // Dừng tấn công nếu bot đang tấn công
    if(bot.target) { // Giả sử bot.target lưu mục tiêu tấn công
         bot.attack(null); // Gửi packet dừng tấn công
    }
    // Hoặc nếu dùng pvp: if (bot.pvp?.target) bot.pvp.stop();

    bot.protectingTarget = null;
    bot.isProtecting = false;
    bot.engagingMob = null;

    // Cải thiện thông báo một chút
    if (wasActive) {
        if (usernameOrReason === "Mục tiêu không hợp lệ") {
             bot.chat(`Có vẻ ${wasProtecting || 'mục tiêu'} đã đi đâu mất hoặc không hợp lệ. Tôi dừng bảo vệ đây.`);
        } else if (["Internal Check Failed", "Hệ thống", "Lỗi pathfinder", "Lỗi vòng lặp bảo vệ", "Lỗi tạo mục tiêu theo dõi"].includes(usernameOrReason)) {
             console.log(`[Protect Stop] Dừng bảo vệ do: ${usernameOrReason}`);
             bot.chat(`Đã dừng chế độ bảo vệ.`); // Thông báo chung
        } else {
             // Dừng do yêu cầu người chơi
             bot.chat(`Ok ${usernameOrReason}, tôi sẽ dừng bảo vệ ${wasProtecting || 'bạn'}.`);
        }
    } else {
         // Nếu được gọi dừng khi không hoạt động (trừ lý do hệ thống/lỗi)
         if (!["Internal Check Failed", "Hệ thống", "Lỗi pathfinder", "Lỗi vòng lặp bảo vệ", "Mục tiêu không hợp lệ", "Lỗi tạo mục tiêu theo dõi"].includes(usernameOrReason)) {
            bot.chat(`Tôi có đang bảo vệ ai đâu ${usernameOrReason}?`);
         }
    }
}


module.exports = {
    startProtecting,
    stopProtecting,
    // Giữ lại export equipBestGear nếu bạn cần dùng nó ở file khác
    equipBestGear,
};