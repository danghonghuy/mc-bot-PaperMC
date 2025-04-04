// --- START OF FILE commands/auto_defend.js ---
const { goals: { GoalFollow, GoalBlock, GoalXZ, GoalNear, GoalInvert } } = require('mineflayer-pathfinder'); // Thêm GoalInvert
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
const VERY_CLOSE_THRESHOLD_SQ = 16; // 4m*4m = 16
const LIKELY_ATTACKER_RANGE_SQ = 64; // 8m*8m = 64
const DEFEND_TIMEOUT = 20 * 1000;
const FLEE_DISTANCE = 15; // Vẫn dùng cho chạy ngẫu nhiên
const SAFE_DISTANCE = 25; // Khoảng cách an toàn mong muốn khi chạy trốn bằng GoalInvert
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
let lastHurtProcessedTime = 0; // <<< THÊM: Thời gian xử lý sự kiện hurt cuối cùng
const HURT_PROCESS_COOLDOWN = 2000; // <<< THÊM: Cooldown 2 giây cho xử lý hurt

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
    lastHurtProcessedTime = 0; // Reset khi khởi tạo

    botInstance.removeListener('entityHurt', handleEntityHurt);
    botInstance.on('entityHurt', handleEntityHurt);
    console.log("[Auto Defend] Đã khởi tạo và lắng nghe sự kiện bị tấn công.");
}

// Hàm xử lý khi bot bị tấn công
function handleEntityHurt(entity) {
    const now = Date.now();
    if (!botInstance || !botInstance.entity || entity.id !== botInstance.entity.id || isDefending || botInstance.isProtecting) {
        return; // Bỏ qua nếu không phải bot, đang phòng thủ, hoặc đang bảo vệ theo lệnh
    }

    // <<< THÊM KIỂM TRA COOLDOWN >>>
    if (now - lastHurtProcessedTime < HURT_PROCESS_COOLDOWN) {
        // console.log("[Auto Defend Debug] Bỏ qua sự kiện hurt do đang trong cooldown xử lý."); // <<< BỎ LOG DEBUG
        return;
    }
    // <<< KẾT THÚC KIỂM TRA COOLDOWN >>>



    // --- Gộp Quét và Logic Xác Định (Giữ nguyên logic quét) ---
    let potentialAttacker = null;
    let closestHostileInRange = null;
    let closestPlayerInRange = null;
    let minHostileDistSq = HOSTILE_SCAN_RADIUS * HOSTILE_SCAN_RADIUS;
    let minPlayerDistSq = PLAYER_SCAN_RADIUS * PLAYER_SCAN_RADIUS;
    const botPos = botInstance.entity.position;
    // let foundEntitiesLog = []; // <<< BỎ LOG DEBUG

    // console.log(`[Auto Defend Debug] Quét thực thể: Hostiles <= ${HOSTILE_SCAN_RADIUS}m, Players <= ${PLAYER_SCAN_RADIUS}m`); // <<< BỎ LOG DEBUG
    // console.log("--- START NEARBY ENTITY SCAN & LOGIC ---"); // <<< BỎ LOG DEBUG

    for (const entityId in botInstance.entities) {
        const E = botInstance.entities[entityId];
        if (E === botInstance.entity || !E.isValid) continue;

        const distSq = E.position.distanceSquared(botPos);
        // const dist = Math.sqrt(distSq).toFixed(1); // <<< BỎ LOG DEBUG

        // <<< BỎ LOG QUÉT CHI TIẾT >>>
        // if (distSq < HOSTILE_SCAN_RADIUS * HOSTILE_SCAN_RADIUS) {
        //     const kindLower = E.kind ? E.kind.toLowerCase() : 'undefined';
        //     const entityLogInfo = `Found: ${E.name || E.type} | Kind: ${kindLower} | User: ${E.username} | Dist: ${dist}m | Pos: (${Math.floor(E.position.x)}, ${Math.floor(E.position.y)}, ${Math.floor(E.position.z)})`;
        //     console.log(`[ENTITY SCAN] ${entityLogInfo}`);
        //     foundEntitiesLog.push(entityLogInfo);
        // }

        const kindLower = E.kind ? E.kind.toLowerCase() : null;
        const isHostile = kindLower === 'hostile mob' || kindLower === 'hostile mobs';
        const isPlayer = E.type === 'player';

        if (isHostile && distSq < minHostileDistSq) {
            minHostileDistSq = distSq;
            closestHostileInRange = E;
        }
        else if (isPlayer && distSq < minPlayerDistSq) {
            minPlayerDistSq = distSq;
            closestPlayerInRange = E;
        }
    }
    // console.log(`--- END NEARBY ENTITY SCAN & LOGIC (${foundEntitiesLog.length} entities logged) ---`); // <<< BỎ LOG DEBUG

    // *** Logic Ưu Tiên (Giữ nguyên, chỉ bỏ log trùng) ***
    if (closestHostileInRange && minHostileDistSq < VERY_CLOSE_THRESHOLD_SQ) {
        console.log(`[Auto Defend] Ưu tiên mob thù địch RẤT GẦN (<4m): ${closestHostileInRange.displayName}.`);
        potentialAttacker = closestHostileInRange;
    }
    else if (closestHostileInRange && minHostileDistSq < LIKELY_ATTACKER_RANGE_SQ) {
         console.log(`[Auto Defend] Ưu tiên mob thù địch ở gần (<8m): ${closestHostileInRange.displayName}.`);
         potentialAttacker = closestHostileInRange;
    }
    else if (closestHostileInRange) {
        console.log(`[Auto Defend] Ưu tiên mob thù địch ở xa (>8m): ${closestHostileInRange.displayName}.`);
        potentialAttacker = closestHostileInRange;
    }
    else if (closestPlayerInRange) {
        console.log(`[Auto Defend] Không có mob thù địch phù hợp, xét người chơi gần nhất: ${closestPlayerInRange.username}.`);
        potentialAttacker = closestPlayerInRange;
    }

    // Phần còn lại của hàm
    if (potentialAttacker) {
        const OWNER_USERNAME = ".XinhgaiLesbian"; // Thay bằng tên chủ nhân thực tế nếu cần
        if (potentialAttacker.type === 'player' && potentialAttacker.username === OWNER_USERNAME) {
            console.log("[Auto Defend] Kẻ tấn công tiềm năng là chủ nhân. Bỏ qua.");
             
            return; // Không làm gì cả
        }
        const finalDistSq = potentialAttacker.position.distanceSquared(botPos);

        // <<< CẬP NHẬT THỜI GIAN XỬ LÝ >>>
        lastHurtProcessedTime = now; // Ghi lại thời gian xử lý thành công sự kiện hurt này
        // <<< KẾT THÚC CẬP NHẬT >>>

        startDefending(potentialAttacker); // Bắt đầu phòng thủ
    } else {
    }
}


// --- Core Defend Logic ---
function startDefending(attacker) {
    if (isDefending || !attacker || !attacker.isValid) {
        // console.log("[Auto Defend] Không thể bắt đầu phòng thủ (đã đang phòng thủ hoặc mục tiêu không hợp lệ)."); // Có thể bỏ nếu startDefending luôn được gọi sau kiểm tra hợp lệ
        return;
    }

    isDefending = true;
    defendingTarget = attacker;
    botInstance.isDefending = true; // Cập nhật trạng thái bot chính

    console.log(`[Auto Defend] Bắt đầu phòng thủ chống lại ${attacker.username || attacker.displayName}!`); // Dùng displayName cho mob

    console.log("[Auto Defend] Dừng các nhiệm vụ khác...");
    // Gọi hàm stopAllTasks đã được truyền vào khi khởi tạo
    if (stopAllTasksFn) {
        stopAllTasksFn(botInstance, 'Bị tấn công'); // Truyền bot instance và lý do
    } else {
        console.error("[Auto Defend] Lỗi: Hàm stopAllTasks không được cung cấp khi khởi tạo!");
    }

    const bestWeapon = findBestWeapon();

    if (bestWeapon) {
        console.log(`[Auto Defend] Có vũ khí (${bestWeapon.name}). Đánh trả!`);
        startCombatLoop(bestWeapon);
    } else {
        console.log("[Auto Defend] Không có vũ khí phù hợp. Chạy trốn!");
        startFleeing(attacker); // Truyền attacker vào hàm chạy trốn
    }
}

function stopDefending(reason) {
    if (!isDefending) return;
    console.log(`[Auto Defend] Dừng phòng thủ. Lý do: ${reason}`);

    isDefending = false;
    defendingTarget = null;
    botInstance.isDefending = false; // Cập nhật trạng thái bot chính
    clearCombatIntervals();

    // Cố gắng dừng pathfinder một cách an toàn
    try {
        if (botInstance.pathfinder?.isMoving()) {
            botInstance.pathfinder.stop();
            // console.log("[Auto Defend] Đã dừng pathfinder khi kết thúc phòng thủ."); // Có thể bỏ nếu không cần thiết
        }
    } catch (e) {
        console.error("[Auto Defend] Lỗi khi cố dừng pathfinder:", e.message); // Giữ lỗi
    }
    botInstance.clearControlStates(); // Dừng mọi di chuyển/hành động cơ bản
    console.log("[Auto Defend] Đã dừng mọi hành động phòng thủ."); // Giữ xác nhận
}

// --- Combat Loop (Giữ nguyên logic combat, giảm log) ---
function startCombatLoop(weapon) {
    const startTime = Date.now();
    clearCombatIntervals();

    const equipWeapon = async () => {
        try {
            if (!botInstance.heldItem || botInstance.heldItem.type !== weapon.type) {
                // console.log(`[Auto Defend Debug] Equipping ${weapon.name}...`); // <<< BỎ LOG DEBUG
                await botInstance.equip(weapon, 'hand');
                await sleep(100); // Giữ sleep nhỏ này
            }
            return true;
        } catch (err) {
            console.error(`[Auto Defend] Lỗi equip vũ khí ${weapon.name}:`, err.message); // Giữ lỗi
            stopDefending(`Lỗi equip vũ khí: ${err.message}`);
            return false;
        }
    };

    if (!equipWeapon()) return;

    lookInterval = setInterval(() => {
        if (!isDefending || !defendingTarget || !defendingTarget.isValid) return;
        botInstance.lookAt(defendingTarget.position.offset(0, defendingTarget.height * 0.8, 0), true).catch(() => {}); // Không log lỗi lookAt thường xuyên
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
                 botInstance.attack(defendingTarget, true);
                 lastAttackTime = now;
                 // console.log(`[Auto Defend] Tấn công ${defendingTarget.username || defendingTarget.displayName}!`); // <<< Có thể bỏ nếu quá spammy, nhưng cũng hữu ích
                 // Quyết định giữ lại log tấn công này vì nó xác nhận hành động cốt lõi
            } else {
                console.warn("[Auto Defend] Tay không cầm vũ khí dù đang combat. Thử equip lại..."); // Giữ cảnh báo
                if (!await equipWeapon()) return;
            }
        }

        // 2. Di chuyển
        const currentGoal = botInstance.pathfinder.goal;
        const isMovingCorrectly = botInstance.pathfinder.isMoving() && currentGoal instanceof GoalFollow && currentGoal.entity === defendingTarget;

        if (!isMovingCorrectly) {
             if (distance >= COMBAT_DISTANCE && distance < SAFE_DISTANCE) { // Ngoài tầm đánh nhưng chưa quá xa -> đuổi theo
                // console.log("[Auto Defend] Mục tiêu ngoài tầm đánh, đuổi theo..."); // <<< Có thể bỏ nếu quá spammy
                const goal = new GoalFollow(defendingTarget, FOLLOW_DISTANCE);
                botInstance.pathfinder.setGoal(goal, true); // true = dynamic goal
             } else if (distance >= SAFE_DISTANCE) { // Quá xa -> bỏ cuộc
                 console.log("[Auto Defend] Mục tiêu chạy quá xa."); // Giữ log này
                 stopDefending("Mục tiêu quá xa");
             } else { // Đang trong tầm đánh (< COMBAT_DISTANCE) -> dừng di chuyển (nếu đang di chuyển)
                 if(botInstance.pathfinder.isMoving()){
                     botInstance.pathfinder.stop();
                     // console.log("[Auto Defend Debug] Đã trong tầm đánh, dừng pathfinder."); // <<< BỎ LOG DEBUG
                 }
             }
        }

    }, Math.max(LOOK_INTERVAL, ATTACK_INTERVAL));
}


// --- Fleeing Logic (Cải tiến với GoalInvert, giảm log) ---
async function startFleeing(attacker) {
    clearCombatIntervals(); // Dừng các interval nhìn/đánh nếu có
    let fleeGoal = null;
    const botPos = botInstance.entity.position;

    console.log("[Auto Defend] Bắt đầu chạy trốn!"); // Giữ log
     try { botInstance.chat("Á á, chạy thôi!"); } catch(e){}

    // Ưu tiên chạy về nhà nếu có và gần
    const homeWaypoint = botInstance.waypoints ? botInstance.waypoints['home'] : null;
    if (homeWaypoint && botPos.distanceTo(homeWaypoint) < 100) {
        console.log(`[Auto Defend] Ưu tiên chạy về nhà tại ${formatCoords(homeWaypoint)}!`); // Giữ log
        fleeGoal = new GoalBlock(homeWaypoint.x, homeWaypoint.y, homeWaypoint.z);
    }
    // <<< SỬ DỤNG GOALINVERT ĐỂ CHẠY TRỐN KẺ TẤN CÔNG >>>
    else if (attacker && attacker.isValid) {
         console.log(`[Auto Defend] Chạy trốn bằng cách giữ khoảng cách ${SAFE_DISTANCE}m với ${attacker.username || attacker.displayName}.`); // Giữ log
         fleeGoal = new GoalInvert(new GoalFollow(attacker, SAFE_DISTANCE));
    }
    // <<< KẾT THÚC SỬ DỤNG GOALINVERT >>>
    else { // Trường hợp không xác định được attacker hoặc attacker không valid nữa (fallback)
        console.log("[Auto Defend] Không rõ kẻ tấn công/mục tiêu không hợp lệ, chạy theo hướng ngẫu nhiên."); // Giữ log
        let fleeDirection = new Vec3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
        if (fleeDirection.distanceTo(new Vec3(0,0,0)) < 0.1) fleeDirection = new Vec3(1, 0, 0);
        const fleeTargetPos = botPos.plus(fleeDirection.scaled(FLEE_DISTANCE));
        // console.log(`[Auto Defend] Mục tiêu chạy trốn ngẫu nhiên tạm thời: ${formatCoords(fleeTargetPos)}`); // <<< Có thể bỏ
        fleeGoal = new GoalNear(fleeTargetPos.x, fleeTargetPos.y, fleeTargetPos.z, 2);
    }

    if (!fleeGoal) {
         console.error("[Auto Defend] Không thể xác định mục tiêu chạy trốn."); // Giữ lỗi
         stopDefending("Không thể xác định mục tiêu chạy trốn");
         return;
    }

    try {
         console.log("[Auto Defend] Bắt đầu di chuyển đến mục tiêu chạy trốn..."); // Giữ log
         await botInstance.pathfinder.goto(fleeGoal);
         console.log("[Auto Defend] Đã hoàn thành lệnh di chuyển chạy trốn."); // Giữ log chung

         // Kiểm tra lại khoảng cách sau khi goto hoàn thành (nếu attacker còn valid)
         if (attacker && attacker.isValid) {
             const finalDistance = attacker.position.distanceTo(botInstance.entity.position);
             if (finalDistance < SAFE_DISTANCE - 5) {
                 console.log(`[Auto Defend] Hoàn thành chạy trốn nhưng kẻ tấn công vẫn còn quá gần (${finalDistance.toFixed(1)}m < ${SAFE_DISTANCE}m)!`); // Giữ log
                  try { botInstance.chat("Vẫn chưa an toàn!"); } catch(e){}
                 stopDefending("Hoàn thành chạy trốn nhưng chưa đủ an toàn");
             } else {
                 console.log(`[Auto Defend] Hoàn thành chạy trốn và đã ở khoảng cách an toàn (${finalDistance.toFixed(1)}m).`); // Giữ log
                  try { botInstance.chat("Phù, tạm an toàn rồi!"); } catch(e){}
                 stopDefending("Hoàn thành chạy trốn và đã an toàn");
             }
         } else {
             // Attacker không còn valid (có thể đã chết hoặc ra khỏi tầm nhìn)
             console.log("[Auto Defend] Hoàn thành chạy trốn (kẻ tấn công không còn hợp lệ)."); // Giữ log
              try { botInstance.chat("Phù, thoát rồi!"); } catch(e){}
             stopDefending("Hoàn thành chạy trốn (mục tiêu không hợp lệ)");
         }
    } catch (err) {
         console.error(`[Auto Defend] Lỗi trong quá trình thực thi goto khi chạy trốn: ${err.message}`); // Giữ lỗi
         if (err.message.includes("Path was stopped")) {
             console.warn("[Auto Defend] Lệnh chạy trốn bị dừng giữa chừng."); // Giữ cảnh báo
             stopDefending("Lệnh chạy trốn bị dừng");
         } else {
              try { botInstance.chat("Ối, chạy không được!"); } catch(e){}
             stopDefending(`Lỗi pathfinding khi chạy trốn: ${err.message}`);
         }
    }
}


// --- Utility Functions (Giữ nguyên, giảm log) ---
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
     // if(bestWeapon) console.log(`[Auto Defend Debug] Vũ khí tốt nhất tìm thấy: ${bestWeapon.name} (Priority Index: ${bestPriority})`); // <<< BỎ LOG DEBUG
     // else console.log("[Auto Defend Debug] Không tìm thấy vũ khí nào trong danh sách ưu tiên."); // <<< BỎ LOG DEBUG
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
    stopDefending, // Vẫn export hàm stop nếu cần gọi từ bên ngoài (ví dụ: lệnh 'dừng')
};
// --- END OF FILE commands/auto_defend.js ---