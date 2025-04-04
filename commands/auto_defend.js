// --- START OF FILE commands/auto_defend.js ---
const { goals: { GoalFollow, GoalBlock, GoalXZ, GoalNear } } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

// ***** ĐỊNH NGHĨA SLEEP NẾU KHÔNG CÓ TRONG UTILS *****
// Nếu bạn đã thêm sleep vào utils.js và require nó, hãy xóa/comment đoạn này
function sleep(ms) { // BẮT BUỘC PHẢI CÓ HÀM NÀY
  return new Promise(resolve => setTimeout(resolve, ms));
}
// *****************************************************

// --- Configuration ---
const HOSTILE_SCAN_RADIUS = 16;
const PLAYER_SCAN_RADIUS = 8;
const VERY_CLOSE_THRESHOLD_SQ = 16; // Tăng nhẹ lên 4m*4m = 16
const LIKELY_ATTACKER_RANGE_SQ = 64; // Tăng lên 8m*8m = 64
const DEFEND_TIMEOUT = 20 * 1000;
const FLEE_DISTANCE = 15;
const SAFE_DISTANCE = 25;
const COMBAT_DISTANCE = 3.0;
const FOLLOW_DISTANCE = 1.5;
const LOOK_INTERVAL = 250;
const ATTACK_INTERVAL = 300;

const WEAPON_PRIORITY = [
    'netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword',
    'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'
];

// --- State Variables ---
let botInstance = null;
let stopAllTasksFn = null;
let isDefending = false;
let defendingTarget = null;
let combatInterval = null;
let lookInterval = null;
let lastAttackTime = 0;

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
    clearCombatIntervals();

    botInstance.removeListener('entityHurt', handleEntityHurt);
    botInstance.on('entityHurt', handleEntityHurt);
    console.log("[Auto Defend] Đã khởi tạo và lắng nghe sự kiện bị tấn công.");
}

// Hàm xử lý khi bot bị tấn công
function handleEntityHurt(entity) {
    if (!botInstance || !botInstance.entity || entity.id !== botInstance.entity.id || isDefending || botInstance.isProtecting) {
        return;
    }

    console.log("[Auto Defend] Á! Bị tấn công!");
    try {
        botInstance.chat("Á! Đau! Cắn trộm hả !!!!");
    } catch (e) { console.error("[Auto Defend] Lỗi khi gửi tin nhắn chat bị đánh:", e); }

    // --- Gộp Quét và Logic Xác Định (v3.2) ---
    let potentialAttacker = null;
    let closestHostileInRange = null;
    let closestPlayerInRange = null;
    let minHostileDistSq = HOSTILE_SCAN_RADIUS * HOSTILE_SCAN_RADIUS;
    let minPlayerDistSq = PLAYER_SCAN_RADIUS * PLAYER_SCAN_RADIUS;
    const botPos = botInstance.entity.position;
    const VERY_CLOSE_THRESHOLD_SQ = 16; // 4m*4m
    const LIKELY_ATTACKER_RANGE_SQ = 64; // 8m*8m
    let foundEntitiesLog = []; // Mảng để log debug

    console.log(`[Auto Defend Debug] Quét thực thể: Hostiles <= ${HOSTILE_SCAN_RADIUS}m, Players <= ${PLAYER_SCAN_RADIUS}m`);
    console.log("--- START NEARBY ENTITY SCAN & LOGIC ---");

    for (const entityId in botInstance.entities) {
        const E = botInstance.entities[entityId];
        if (E === botInstance.entity || !E.isValid) continue;

        const distSq = E.position.distanceSquared(botPos);
        const dist = Math.sqrt(distSq).toFixed(1);

        // Log tất cả thực thể trong phạm vi quét lớn nhất (để debug)
        if (distSq < HOSTILE_SCAN_RADIUS * HOSTILE_SCAN_RADIUS) {
            const kindLower = E.kind ? E.kind.toLowerCase() : 'undefined'; // Chuẩn hóa và xử lý null/undefined
            const entityLogInfo = `Found: ${E.name || E.type} | Kind: ${kindLower} | User: ${E.username} | Dist: ${dist}m | Pos: (${Math.floor(E.position.x)}, ${Math.floor(E.position.y)}, ${Math.floor(E.position.z)})`;
            console.log(`[ENTITY SCAN] ${entityLogInfo}`);
            foundEntitiesLog.push(entityLogInfo); // Lưu vào mảng log
        }

        // Áp dụng logic tìm kiếm ứng viên ngay trong vòng lặp này
        // <<< SỬA LỖI KIỂM TRA KIND >>>
        const kindLower = E.kind ? E.kind.toLowerCase() : null;
        const isHostile = kindLower === 'hostile mob' || kindLower === 'hostile mobs'; // Chuẩn hóa và kiểm tra cả 2
        // <<< KẾT THÚC SỬA LỖI >>>
        const isPlayer = E.type === 'player';

        // Xét Mob thù địch
        if (isHostile && distSq < minHostileDistSq) {
            minHostileDistSq = distSq;
            closestHostileInRange = E; // Gán giá trị
        }
        // Xét Người chơi (chỉ trong phạm vi PLAYER_SCAN_RADIUS)
        else if (isPlayer && distSq < minPlayerDistSq) {
            minPlayerDistSq = distSq;
            closestPlayerInRange = E; // Gán giá trị
        }
    }
    console.log(`--- END NEARBY ENTITY SCAN & LOGIC (${foundEntitiesLog.length} entities logged) ---`);

    // *** Logic Ưu Tiên Mới (v3.2 - Dựa trên biến đã gán trong vòng lặp) ***
    if (closestHostileInRange && minHostileDistSq < VERY_CLOSE_THRESHOLD_SQ) {
        console.log(`[Auto Defend] Ưu tiên TUYỆT ĐỐI mob thù địch RẤT GẦN (<4m): ${closestHostileInRange.displayName}.`); // Sử dụng displayName
        potentialAttacker = closestHostileInRange;
    }
    else if (closestHostileInRange && minHostileDistSq < LIKELY_ATTACKER_RANGE_SQ) {
         console.log(`[Auto Defend] Ưu tiên mob thù địch ở gần (<8m): ${closestHostileInRange.displayName}.`);
         potentialAttacker = closestHostileInRange;
    }
    else if (closestHostileInRange) { // Mob thù địch còn lại (xa hơn 8m)
        console.log(`[Auto Defend] Ưu tiên mob thù địch ở xa (>8m): ${closestHostileInRange.displayName}.`);
        potentialAttacker = closestHostileInRange;
    }
    else if (closestPlayerInRange) {
        console.log(`[Auto Defend] Không có mob thù địch nào phù hợp, xét người chơi gần nhất: ${closestPlayerInRange.username}.`);
        potentialAttacker = closestPlayerInRange;
    }
    // *** Kết thúc Logic Ưu Tiên Mới (v3.2) ***

    // Phần còn lại của hàm giữ nguyên
    if (potentialAttacker) {
        const OWNER_USERNAME = ".XinhgaiLesbian";
        if (potentialAttacker.type === 'player' && potentialAttacker.username === OWNER_USERNAME) {
            console.log("[Auto Defend] Kẻ tấn công tiềm năng là chủ nhân. Bỏ qua.");
             try { botInstance.chat("Á! Chủ nhân đánh yêu hả?"); } catch(e){}
            return;
        }
        const finalDistSq = potentialAttacker.position.distanceSquared(botPos);
        console.log(`[Auto Defend] Xác định kẻ tấn công tiềm năng: ${potentialAttacker.username || potentialAttacker.displayName} ở khoảng cách ${Math.sqrt(finalDistSq).toFixed(1)}`); // Dùng displayName cho mob
        startDefending(potentialAttacker);
    } else {
        console.log("[Auto Defend] Không xác định được kẻ tấn công nào phù hợp trong phạm vi quét.");
    }
}


// --- Core Defend Logic ---
function startDefending(attacker) {
    if (isDefending || !attacker || !attacker.isValid) {
        console.log("[Auto Defend] Không thể bắt đầu phòng thủ (đã đang phòng thủ hoặc mục tiêu không hợp lệ).");
        return;
    }

    isDefending = true;
    defendingTarget = attacker;
    botInstance.isDefending = true;

    console.log(`[Auto Defend] Bắt đầu phòng thủ chống lại ${attacker.username || attacker.name}!`);

    console.log("[Auto Defend] Dừng các nhiệm vụ khác...");
    stopAllTasksFn(botInstance, 'Bị tấn công');

    const bestWeapon = findBestWeapon();

    if (bestWeapon) {
        console.log(`[Auto Defend] Có vũ khí (${bestWeapon.name}). Đánh trả!`);
        startCombatLoop(bestWeapon);
    } else {
        console.log("[Auto Defend] Không có vũ khí phù hợp. Chạy trốn!");
        startFleeing(attacker);
    }
}

function stopDefending(reason) {
    if (!isDefending) return;
    console.log(`[Auto Defend] Dừng phòng thủ. Lý do: ${reason}`);

    isDefending = false;
    defendingTarget = null;
    botInstance.isDefending = false;
    clearCombatIntervals();

    botInstance.pathfinder.stop();
    botInstance.clearControlStates();
    console.log("[Auto Defend] Đã dừng mọi hành động phòng thủ.");
}

// --- Combat Loop ---
function startCombatLoop(weapon) {
    const startTime = Date.now();
    clearCombatIntervals();

    const equipWeapon = async () => {
        try {
            // Chỉ equip nếu chưa cầm đúng vũ khí
            if (!botInstance.heldItem || botInstance.heldItem.type !== weapon.type) {
                console.log(`[Auto Defend Debug] Equipping ${weapon.name}...`);
                await botInstance.equip(weapon, 'hand');
                await sleep(100); // Chờ một chút sau khi equip
            }
            return true;
        } catch (err) {
            console.error(`[Auto Defend] Lỗi equip vũ khí ${weapon.name}:`, err.message);
            // Quan trọng: Dừng phòng thủ nếu equip lỗi
            stopDefending(`Lỗi equip vũ khí: ${err.message}`);
            return false;
        }
    };

    // Equip lần đầu
    if (!equipWeapon()) return; // Dừng ngay nếu equip lần đầu lỗi

    lookInterval = setInterval(() => {
        if (!isDefending || !defendingTarget || !defendingTarget.isValid) return;
        botInstance.lookAt(defendingTarget.position.offset(0, defendingTarget.height * 0.8, 0), true).catch(() => {});
    }, LOOK_INTERVAL);

    combatInterval = setInterval(async () => {
        if (!isDefending || !defendingTarget || !defendingTarget.isValid) {
            stopDefending(defendingTarget ? "Mục tiêu không còn hợp lệ" : "Không có mục tiêu");
            return;
        }

        if (Date.now() - startTime > DEFEND_TIMEOUT) {
            stopDefending("Hết thời gian đuổi theo");
             try { botInstance.chat("Hừ, chạy rồi à!"); } catch(e){}
            return;
        }

        const distance = botInstance.entity.position.distanceTo(defendingTarget.position);
        const now = Date.now();

        // 1. Tấn công
        if (distance < COMBAT_DISTANCE && now - lastAttackTime > ATTACK_INTERVAL) {
            if (botInstance.heldItem?.type === weapon.type) {
                 // ***** BỎ KIỂM TRA CANSEE TRƯỚC KHI ĐÁNH *****
                 // Giờ chỉ cần đủ gần là đánh
                 // if (botInstance.canSeeEntity(defendingTarget)) { // XÓA DÒNG NÀY
                    botInstance.attack(defendingTarget, true); // Đánh trực tiếp
                    lastAttackTime = now;
                    console.log(`[Auto Defend] Tấn công ${defendingTarget.username || defendingTarget.displayName}!`); // Dùng displayName

                    if ((defendingTarget.name === 'creeper') && distance < 2.8) { /* ... (né creeper) ... */ }
                 // } else {
                 //      console.log(`[Auto Defend Debug] Đủ gần nhưng không thấy mục tiêu để tấn công.`);
                 // } // XÓA DÒNG NÀY
                 // ***** KẾT THÚC BỎ KIỂM TRA *****
            } else {
                console.warn("[Auto Defend] Tay không cầm vũ khí dù đang combat. Thử equip lại...");
                if (!await equipWeapon()) return; // Dừng nếu equip lại lỗi
            }
        }

        const currentGoal = botInstance.pathfinder.goal;
        // Kiểm tra xem có đang di chuyển không VÀ mục tiêu của goal có phải là thực thể đang phòng thủ không
        const isMovingCorrectly = botInstance.pathfinder.isMoving() && currentGoal instanceof GoalFollow && currentGoal.entity === defendingTarget;

        if (!isMovingCorrectly) { // Nếu chưa di chuyển đúng cách
             if (distance >= COMBAT_DISTANCE && distance < FLEE_DISTANCE) { // Ngoài tầm đánh -> đuổi theo
                console.log("[Auto Defend] Mục tiêu ngoài tầm đánh, đuổi theo...");
                // ***** SỬA LẠI GOAL *****
                const goal = new GoalFollow(defendingTarget, FOLLOW_DISTANCE); // Sử dụng lại GoalFollow
                // ***********************
                botInstance.pathfinder.setGoal(goal, true); // true = dynamic goal
             } else if (distance >= FLEE_DISTANCE) { // Quá xa -> bỏ cuộc
                 console.log("[Auto Defend] Mục tiêu chạy quá xa.");
                 stopDefending("Mục tiêu quá xa");
             } else { // Đang trong tầm đánh (< COMBAT_DISTANCE) -> dừng di chuyển (nếu đang di chuyển)
                 if(botInstance.pathfinder.isMoving()){
                     botInstance.pathfinder.stop();
                     console.log("[Auto Defend Debug] Đã trong tầm đánh, dừng pathfinder.");
                 }
             }
        }

    }, Math.max(LOOK_INTERVAL, ATTACK_INTERVAL));
}


// --- Fleeing Logic ---
async function startFleeing(attacker) {
    clearCombatIntervals();
    let fleeGoal = null;
    const botPos = botInstance.entity.position;

    console.log("[Auto Defend] Bắt đầu chạy trốn!");
     try { botInstance.chat("Á á, chạy thôi!"); } catch(e){}

    const homeWaypoint = botInstance.waypoints ? botInstance.waypoints['home'] : null;
    if (homeWaypoint && botPos.distanceTo(homeWaypoint) < 100) {
        console.log(`[Auto Defend] Ưu tiên chạy về nhà tại ${formatCoords(homeWaypoint)}!`);
        fleeGoal = new GoalBlock(homeWaypoint.x, homeWaypoint.y, homeWaypoint.z);
    } else {
        let fleeDirection;
        if (attacker && attacker.isValid) {
            fleeDirection = botPos.minus(attacker.position).normalize();
             console.log("[Auto Defend] Chạy ngược hướng kẻ tấn công.");
        } else {
            fleeDirection = new Vec3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
             console.log("[Auto Defend] Chạy theo hướng ngẫu nhiên.");
        }
        if (fleeDirection.distanceTo(new Vec3(0,0,0)) < 0.1) fleeDirection = new Vec3(1, 0, 0);
        const fleeTargetPos = botPos.plus(fleeDirection.scaled(FLEE_DISTANCE));
        console.log(`[Auto Defend] Mục tiêu chạy trốn tạm thời: ${formatCoords(fleeTargetPos)}`);
        fleeGoal = new GoalNear(fleeTargetPos.x, fleeTargetPos.y, fleeTargetPos.z, 2);
    }

    try {
         // Sử dụng goto để chờ kết quả chạy trốn (thành công hoặc lỗi)
         await botInstance.pathfinder.goto(fleeGoal);
         console.log("[Auto Defend] Đã đến điểm chạy trốn hoặc bị dừng/lỗi.");
         // Kiểm tra lại khoảng cách sau khi đến nơi (nếu attacker còn valid)
         if (attacker && attacker.isValid && attacker.position.distanceTo(botInstance.entity.position) < SAFE_DISTANCE) {
             console.log("[Auto Defend] Kẻ tấn công vẫn còn quá gần!");
              try { botInstance.chat("Vẫn chưa an toàn!"); } catch(e){}
             // Có thể thử chạy tiếp hoặc dừng tùy logic
             stopDefending("Hoàn thành chạy trốn nhưng chưa an toàn");
         } else {
              try { botInstance.chat("Phù, tạm an toàn rồi!"); } catch(e){}
             stopDefending("Hoàn thành chạy trốn và đã an toàn");
         }
    } catch (err) {
         console.error(`[Auto Defend] Lỗi khi chạy trốn: ${err.message}`);
         stopDefending(`Lỗi khi chạy trốn: ${err.message}`);
    }
}


// --- Utility Functions ---
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
     if(bestWeapon) console.log(`[Auto Defend Debug] Vũ khí tốt nhất tìm thấy: ${bestWeapon.name} (Priority Index: ${bestPriority})`);
     else console.log("[Auto Defend Debug] Không tìm thấy vũ khí nào trong danh sách ưu tiên.");
    return bestWeapon;
}

function clearCombatIntervals() {
    if (combatInterval) clearInterval(combatInterval);
    if (lookInterval) clearInterval(lookInterval);
    combatInterval = null;
    lookInterval = null;
}

function formatCoords(pos) {
    if (!pos) return 'N/A';
    return `(${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`;
}

module.exports = {
    initializeAutoDefend,
    stopDefending,
};
// --- END OF FILE commands/auto_defend.js ---