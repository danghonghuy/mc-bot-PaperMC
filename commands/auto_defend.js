// --- START OF FILE commands/auto_defend.js ---
const { goals: { GoalFollow, GoalBlock, GoalXZ, GoalNear, GoalInvert } } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

// --- Configuration ---
const HOSTILE_SCAN_RADIUS = 20;
const PLAYER_SCAN_RADIUS = 5;
const VERY_CLOSE_THRESHOLD_SQ = 16; // 4m*4m = 16
const LIKELY_ATTACKER_RANGE_SQ = 144; // 8m*8m = 64
const DEFEND_TIMEOUT = 20 * 1000; // Tổng thời gian phòng thủ tối đa (cả đánh và chạy)
const FLEE_DISTANCE_RANDOM = 15; // Chỉ dùng khi chạy ngẫu nhiên
const SAFE_DISTANCE = 20; // Khoảng cách an toàn mong muốn khi chạy trốn bằng GoalInvert (giảm chút)
const SAFE_DISTANCE_SQ = SAFE_DISTANCE * SAFE_DISTANCE; // Tính sẵn bình phương
const COMBAT_DISTANCE = 4.5;
const FOLLOW_DISTANCE = 4;
const LOOK_INTERVAL = 250;
const ATTACK_INTERVAL = 300;
const FLEE_CHECK_INTERVAL = 500; // Tần suất kiểm tra khi đang chạy trốn (ms)

const WEAPON_PRIORITY = [
    'netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword',
    'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'
];

// --- State Variables ---
let botInstance = null;
let stopAllTasksFn = null;
let isDefending = false;
let defendingTarget = null; // Kẻ địch đang nhắm tới
let combatInterval = null;  // Interval cho logic chiến đấu
let lookInterval = null;    // Interval để nhìn kẻ địch
let fleeCheckInterval = null; // <<<< MỚI: Interval để kiểm tra khi đang chạy trốn
let defenseStartTime = 0;  // <<<< MỚI: Thời điểm bắt đầu phòng thủ (cho timeout chung)
let lastAttackTime = 0;
let lastHurtProcessedTime = 0;
const HURT_PROCESS_COOLDOWN = 2000;

// --- Utility Functions (Keep formatCoords and findBestWeapon) ---
function formatCoords(pos) {
    if (!pos) return 'N/A';
    return `(${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`;
}

function findBestWeapon() {
    let bestWeapon = null;
    let bestPriority = WEAPON_PRIORITY.length;
    if (!botInstance || !botInstance.inventory) return null;
    for (const item of botInstance.inventory.items()) {
        if (!item || !item.name) continue;
        const priority = WEAPON_PRIORITY.findIndex(namePart => item.name.includes(namePart));
        if (priority !== -1 && priority < bestPriority) {
            bestPriority = priority;
            bestWeapon = item;
        }
    }
    return bestWeapon;
}

function sleep(ms) { // <<< Vẫn cần sleep cho equip
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Initialization ---
function initializeAutoDefend(bot, stopTasksFunction) {
    if (!bot || typeof stopTasksFunction !== 'function') {
        console.error("[Auto Defend] Lỗi khởi tạo: Cần bot instance và hàm stopAllTasks hợp lệ.");
        return;
    }
    botInstance = bot;
    stopAllTasksFn = stopTasksFunction;
    isDefending = false;
    defendingTarget = null;
    clearDefenseIntervals(); // <<<< Đổi tên hàm dọn dẹp
    lastHurtProcessedTime = 0;
    defenseStartTime = 0;

    botInstance.removeListener('entityHurt', handleEntityHurt);
    botInstance.on('entityHurt', handleEntityHurt);
    console.log("[Auto Defend] Đã khởi tạo và lắng nghe sự kiện bị tấn công.");
}

// --- Event Handler ---
function handleEntityHurt(entity) {
    const now = Date.now();
    if (!botInstance || !botInstance.entity || entity.id !== botInstance.entity.id || isDefending || botInstance.isProtecting) {
        return;
    }
    if (now - lastHurtProcessedTime < HURT_PROCESS_COOLDOWN) {
        return;
    }

    // --- Logic tìm kẻ tấn công tiềm năng (Giữ nguyên) ---
    let potentialAttacker = null;
    let closestHostileInRange = null;
    let closestPlayerInRange = null;
    let minHostileDistSq = HOSTILE_SCAN_RADIUS * HOSTILE_SCAN_RADIUS;
    let minPlayerDistSq = PLAYER_SCAN_RADIUS * PLAYER_SCAN_RADIUS;
    const botPos = botInstance.entity.position;

    for (const entityId in botInstance.entities) {
        const E = botInstance.entities[entityId];
        if (E === botInstance.entity || !E.isValid) continue;
        const distSq = E.position.distanceSquared(botPos);
        const kindLower = E.kind ? E.kind.toLowerCase() : null;
        const isHostile = kindLower === 'hostile mob' || kindLower === 'hostile mobs';
        const isPlayer = E.type === 'player';
        if (isHostile && distSq < minHostileDistSq) {
            minHostileDistSq = distSq;
            closestHostileInRange = E;
        } else if (isPlayer && distSq < minPlayerDistSq) {
            minPlayerDistSq = distSq;
            closestPlayerInRange = E;
        }
    }

    if (closestHostileInRange && minHostileDistSq < VERY_CLOSE_THRESHOLD_SQ) potentialAttacker = closestHostileInRange;
    else if (closestHostileInRange && minHostileDistSq < LIKELY_ATTACKER_RANGE_SQ) potentialAttacker = closestHostileInRange;
    else if (closestHostileInRange) potentialAttacker = closestHostileInRange;
    else if (closestPlayerInRange) potentialAttacker = closestPlayerInRange;
    // --- Kết thúc logic tìm kẻ tấn công ---


    if (potentialAttacker) {
        const OWNER_USERNAME = ".XinhgaiLesbian"; // Thay nếu cần
        if (potentialAttacker.type === 'player' && potentialAttacker.username === OWNER_USERNAME) {
            console.log("[Auto Defend] Bỏ qua tấn công từ chủ nhân.");
            return;
        }

        lastHurtProcessedTime = now; // Ghi nhận đã xử lý
        startDefending(potentialAttacker); // Bắt đầu phòng thủ
    }
}

// --- Core Defend Logic ---
function startDefending(attacker) {
    if (isDefending || !attacker || !attacker.isValid) return;

    isDefending = true;
    defendingTarget = attacker;
    botInstance.isDefending = true;
    defenseStartTime = Date.now(); // <<<< Ghi lại thời điểm bắt đầu

    console.log(`[Auto Defend] === BẮT ĐẦU PHÒNG THỦ vs ${attacker.username || attacker.displayName} ===`);

    console.log("[Auto Defend] Dừng các nhiệm vụ khác...");
    if (stopAllTasksFn) {
        stopAllTasksFn(botInstance, 'Bị tấn công');
    } else {
        console.error("[Auto Defend] Lỗi: Hàm stopAllTasks không được cung cấp!");
    }

    // QUAN TRỌNG: Dọn dẹp interval cũ trước khi quyết định đánh hay chạy
    clearDefenseIntervals();

    const bestWeapon = findBestWeapon();
    if (bestWeapon) {
        console.log(`[Auto Defend] Có vũ khí (${bestWeapon.name}). Đánh trả!`);
        startCombatLoop(bestWeapon); // Bắt đầu vòng lặp chiến đấu (non-blocking)
    } else {
        console.log("[Auto Defend] Không có vũ khí phù hợp. Chạy trốn!");
        startFleeing(attacker); // Bắt đầu chạy trốn (non-blocking)
    }
}

function stopDefending(reason) {
    if (!isDefending) return;
    const targetName = defendingTarget?.username || defendingTarget?.displayName || "mục tiêu cũ";
    console.log(`[Auto Defend] === DỪNG PHÒNG THỦ (vs ${targetName}). Lý do: ${reason} ===`);

    isDefending = false;
    defendingTarget = null;
    botInstance.isDefending = false;
    clearDefenseIntervals(); // Dọn dẹp TẤT CẢ interval (combat, look, flee)

    try {
        if (botInstance.pathfinder?.isMoving()) {
            botInstance.pathfinder.stop();
            botInstance.pathfinder.setGoal(null); // Xóa mục tiêu rõ ràng
        }
    } catch (e) {
        console.error("[Auto Defend] Lỗi khi dừng pathfinder:", e.message);
    }
    botInstance.clearControlStates();
}

// --- Combat Loop (Non-Blocking - Dùng setInterval) ---
function startCombatLoop(weapon) {
    // Hàm equip vẫn cần await nhưng chỉ chạy 1 lần đầu hoặc khi cần equip lại
    const equipAndAttack = async () => {
        try {
            // 1. Equip nếu cần
            if (!botInstance.heldItem || botInstance.heldItem.type !== weapon.type) {
                console.log(`[Auto Defend Combat] Trang bị ${weapon.name}...`);
                await botInstance.equip(weapon, 'hand');
                await sleep(100); // Chờ một chút sau khi equip
            }

            // 2. Kiểm tra lại mục tiêu và khoảng cách để tấn công
            if (!isDefending || !defendingTarget || !defendingTarget.isValid) {
                 stopDefending(defendingTarget ? "Mục tiêu không còn hợp lệ khi chuẩn bị đánh" : "Không có mục tiêu khi chuẩn bị đánh");
                 return;
            }
            const distance = botInstance.entity.position.distanceTo(defendingTarget.position);
            const now = Date.now();

            if (distance < COMBAT_DISTANCE && now - lastAttackTime > ATTACK_INTERVAL) {
                if (botInstance.heldItem?.type === weapon.type) {
                    botInstance.attack(defendingTarget, true);
                    lastAttackTime = now;
                    console.log(`[Auto Defend Combat] Tấn công ${defendingTarget.username || defendingTarget.displayName}!`);
                } else {
                     console.warn("[Auto Defend Combat] Không cầm đúng vũ khí khi tấn công!");
                }
            }
        } catch (err) {
            console.error(`[Auto Defend Combat] Lỗi equip/attack:`, err.message);
            stopDefending(`Lỗi equip/attack: ${err.message}`);
        }
    };

    // Chạy equip và tấn công lần đầu (nếu trong tầm)
    equipAndAttack();

    // Bắt đầu các interval kiểm tra và hành động
    lookInterval = setInterval(() => {
        if (!isDefending || !defendingTarget || !defendingTarget.isValid) return;
        botInstance.lookAt(defendingTarget.position.offset(0, defendingTarget.height * 0.8, 0), true).catch(() => {});
    }, LOOK_INTERVAL);

    combatInterval = setInterval(() => {
        if (!isDefending || !defendingTarget || !defendingTarget.isValid) {
            stopDefending(defendingTarget ? "Mục tiêu không còn hợp lệ (Combat Check)" : "Không có mục tiêu (Combat Check)");
            return;
        }

        // Kiểm tra timeout chung
        if (Date.now() - defenseStartTime > DEFEND_TIMEOUT) {
            stopDefending("Hết thời gian phòng thủ (Combat)");
             try { botInstance.chat("Hừ, dai quá, bỏ đi!"); } catch(e){}
            return;
        }

        const distance = botInstance.entity.position.distanceTo(defendingTarget.position);

        // 1. Tấn công (gọi lại hàm equipAndAttack để đảm bảo equip đúng và đánh nếu trong tầm)
        if (distance < COMBAT_DISTANCE) {
            equipAndAttack(); // Hàm này có kiểm tra cooldown tấn công bên trong
        }

        // 2. Di chuyển (non-blocking setGoal)
        const isMoving = botInstance.pathfinder.isMoving();
        const currentGoal = botInstance.pathfinder.goal;
        // Kiểm tra xem có cần cập nhật mục tiêu di chuyển không
        const needsToMove = distance >= COMBAT_DISTANCE && distance < SAFE_DISTANCE;
        const isChasingCorrectly = currentGoal instanceof GoalFollow && currentGoal.entity === defendingTarget;

        if (needsToMove && (!isMoving || !isChasingCorrectly)) {
             console.log(`[Auto Defend Combat] Mục tiêu ngoài tầm (${distance.toFixed(1)}m), đuổi theo...`);
             const goal = new GoalFollow(defendingTarget, FOLLOW_DISTANCE);
             botInstance.pathfinder.setGoal(goal, true); // Bắt đầu đuổi, không await
        } else if (distance >= SAFE_DISTANCE) {
             console.log(`[Auto Defend Combat] Mục tiêu chạy quá xa (${distance.toFixed(1)}m).`);
             stopDefending("Mục tiêu quá xa (Combat)");
        } else if (distance < COMBAT_DISTANCE && isMoving) { // Trong tầm đánh và đang di chuyển -> dừng lại
             botInstance.pathfinder.stop();
             console.log("[Auto Defend Combat] Đã trong tầm đánh, dừng di chuyển.");
        }

    }, Math.max(LOOK_INTERVAL, ATTACK_INTERVAL)); // Chạy kiểm tra thường xuyên
}

// --- Fleeing Logic (Non-Blocking - Dùng setInterval) --- <<<< SỬA ĐỔI LỚN
function startFleeing(attacker) {
    // Đã gọi clearDefenseIntervals() trong startDefending rồi

    let fleeGoal = null;
    const botPos = botInstance.entity.position;

    console.log("[Auto Defend] Bắt đầu CHẠY TRỐN!");
     try { botInstance.chat("Á á, chạy thôi!"); } catch(e){}

    // Xác định mục tiêu chạy (Giữ nguyên logic)
    const homeWaypoint = botInstance.waypoints ? botInstance.waypoints['home'] : null;
    if (homeWaypoint && botPos.distanceTo(homeWaypoint) < 100) {
        console.log(`[Auto Defend Flee] Ưu tiên chạy về nhà tại ${formatCoords(homeWaypoint)}!`);
        fleeGoal = new GoalBlock(homeWaypoint.x, homeWaypoint.y, homeWaypoint.z);
    } else if (attacker && attacker.isValid) {
         console.log(`[Auto Defend Flee] Chạy giữ khoảng cách ${SAFE_DISTANCE}m với ${attacker.username || attacker.displayName}.`);
         fleeGoal = new GoalInvert(new GoalFollow(attacker, SAFE_DISTANCE));
    } else {
        console.log("[Auto Defend Flee] Chạy theo hướng ngẫu nhiên.");
        let fleeDirection = new Vec3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
        if (fleeDirection.distanceTo(new Vec3(0,0,0)) < 0.1) fleeDirection = new Vec3(1, 0, 0);
        const fleeTargetPos = botPos.plus(fleeDirection.scaled(FLEE_DISTANCE_RANDOM));
        fleeGoal = new GoalNear(fleeTargetPos.x, fleeTargetPos.y, fleeTargetPos.z, 2);
    }

    if (!fleeGoal) {
         console.error("[Auto Defend Flee] Không thể xác định mục tiêu chạy trốn.");
         stopDefending("Không thể xác định mục tiêu chạy trốn");
         return;
    }

    try {
         console.log("[Auto Defend Flee] Thiết lập mục tiêu chạy trốn...");
         botInstance.pathfinder.setGoal(fleeGoal); // <<<< NON-BLOCKING: Chỉ đặt mục tiêu
         console.log("[Auto Defend Flee] Mục tiêu đã thiết lập. Bắt đầu kiểm tra định kỳ.");

         // Bắt đầu vòng lặp kiểm tra trạng thái chạy trốn
         fleeCheckInterval = setInterval(() => checkFleeingStatus(attacker), FLEE_CHECK_INTERVAL);

    } catch (err) {
         console.error(`[Auto Defend Flee] Lỗi khi thiết lập mục tiêu chạy trốn: ${err.message}`);
         stopDefending(`Lỗi pathfinding khi bắt đầu chạy trốn: ${err.message}`);
    }
}

// --- Hàm kiểm tra trạng thái chạy trốn định kỳ --- <<<< HÀM MỚI
function checkFleeingStatus(originalAttacker) {
    if (!isDefending) {
        // console.log("[Auto Defend Flee Check] Đã dừng phòng thủ từ bên ngoài."); // Có thể bị gọi nếu stopDefending được gọi bởi lý do khác
        // Không cần gọi stopDefending ở đây vì nó đã được gọi rồi và interval sẽ bị xóa
        return;
    }

    // Kiểm tra timeout chung
    if (Date.now() - defenseStartTime > DEFEND_TIMEOUT) {
        console.log("[Auto Defend Flee Check] Hết thời gian phòng thủ (Flee Check).");
         try { botInstance.chat("Mệt quá, không chạy nữa!"); } catch(e){}
        stopDefending("Hết thời gian phòng thủ (Flee)");
        return;
    }

    // Sử dụng defendingTarget để kiểm tra kẻ địch hiện tại
    const currentTarget = defendingTarget;

    if (!currentTarget || !currentTarget.isValid) {
         console.log("[Auto Defend Flee Check] Kẻ địch không còn hợp lệ. Đã an toàn.");
          try { botInstance.chat("Phù, nó biến mất rồi!"); } catch(e){}
         stopDefending("Kẻ địch biến mất khi đang chạy trốn");
         return;
    }

    const botPos = botInstance.entity.position;
    const targetPos = currentTarget.position;
    const currentDistanceSq = botPos.distanceSquared(targetPos);

    // Kiểm tra đã đạt khoảng cách an toàn chưa
    if (currentDistanceSq >= SAFE_DISTANCE_SQ) {
         console.log(`[Auto Defend Flee Check] Đã đạt khoảng cách an toàn (${Math.sqrt(currentDistanceSq).toFixed(1)}m).`);
          try { botInstance.chat("Phù, tạm an toàn rồi!"); } catch(e){}
         stopDefending("Đạt khoảng cách an toàn khi chạy trốn");
         return;
    }

    // Kiểm tra xem pathfinder có còn đang di chuyển không (có thể bị kẹt)
    if (!botInstance.pathfinder.isMoving()) {
         console.warn(`[Auto Defend Flee Check] Pathfinder không di chuyển dù chưa an toàn (Dist: ${Math.sqrt(currentDistanceSq).toFixed(1)}m). Có thể bị kẹt. Dừng chạy.`);
          try { botInstance.chat("Ối, hình như bị kẹt khi chạy!"); } catch(e){}
         stopDefending("Bị kẹt hoặc pathfinder dừng khi chạy trốn");
         return;
    }

    // Nếu chưa thỏa mãn điều kiện dừng, tiếp tục chạy
    // console.log(`[Auto Defend Flee Check] Vẫn đang chạy trốn... Khoảng cách: ${Math.sqrt(currentDistanceSq).toFixed(1)}m`); // Log nếu cần debug
}

// --- Clean Up Function --- <<<< HÀM DỌN DẸP MỚI
function clearDefenseIntervals() {
    if (combatInterval) clearInterval(combatInterval);
    if (lookInterval) clearInterval(lookInterval);
    if (fleeCheckInterval) clearInterval(fleeCheckInterval); // <<<< Dọn dẹp interval chạy trốn
    combatInterval = null;
    lookInterval = null;
    fleeCheckInterval = null; // <<<< Reset biến
}

// --- Exports ---
module.exports = {
    initializeAutoDefend,
    stopDefending, // Vẫn export để có thể gọi từ bên ngoài nếu cần
    // Không cần export isDefending vì bot chính đã có cờ trạng thái
};
// --- END OF FILE commands/auto_defend.js ---