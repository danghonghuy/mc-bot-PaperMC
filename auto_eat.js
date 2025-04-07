// auto_eat.js

const { goals } = require('mineflayer-pathfinder');
const { GoalBlock } = require('mineflayer-pathfinder').goals; // Cần cho nhặt đồ nếu không dùng collectBlock

const HUNGER_THRESHOLD = 10; // 50% hunger (20 max)
const MIN_FOOD_POINTS = 2;
const LOW_HEALTH_THRESHOLD = 10; // 50% health (20 max)
const TARGET_HEALTH_THRESHOLD = 14; // 70% health
const REGEN_FOOD_THRESHOLD = 18; // Food level required for natural regen
const ASK_FOOD_COOLDOWN = 0.5 * 60 * 1000;
const BEGGING_TIMEOUT = 30 * 1000;
const BEGGING_RADIUS = 20;
const HUNTING_RADIUS = 500;
const CHECK_INTERVAL_MS = 3000;
const REGEN_WAIT_MS = 4000; // Giãn cách giữa các lần ăn KHẨN CẤP
const COLLECT_RADIUS = 5; // Bán kính nhặt đồ sau khi săn
const COLLECT_WAIT_MS = 1000; // Chờ 1 giây cho đồ rơi ra

const ITEM_BLACKLIST = new Set([
    'wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds',
    'nether_wart', 'cocoa_beans', 'string', 'spider_eye',
    'poisonous_potato', 'pufferfish', 'rotten_flesh', 'chorus_fruit',
    'suspicious_stew', 'wheat', 'feather', 'glow_ink_sac'
]);

const HUNTABLE_FOOD_MOBS = new Set(['cow', 'pig', 'sheep', 'chicken', 'rabbit']);
const WEAPON_NAMES = new Set(['sword', 'axe']);

let botInstance = null;
let mcData = null;
let pathfinder = null;
let collectBlock = null; // Thêm biến cho plugin collectBlock
let lastAskTime = 0;
let isEating = false;
let isBusy = false; // Flag chung cho các hành động kéo dài (ăn, xin, săn, nhặt đồ)
let isBegging = false;
let beggingTargetUsername = null;
let receivedFoodFromBegging = false;
let lastEmergencyEatTime = 0;
let beggingTimeoutId = null; // ID để hủy setTimeout xin ăn

// --- Các hàm tìm thức ăn, kiểm tra mcData giữ nguyên ---
function findBestFood(bot, prioritizeSaturation = false) {
    if (!mcData) {
         try { mcData = require('minecraft-data')(bot.version); } catch (e) { console.error("[Auto Eat] Failed to load mcData in findBestFood"); return null; }
    }
    if (!mcData || !mcData.foods || !mcData.foodsByName) { console.error("[Auto Eat] Lỗi: Không thể tải mcData hoặc dữ liệu thức ăn."); return null; }

    let bestFood = null;
    let bestScore = -1;

    for (const item of bot.inventory.items()) {
        if (ITEM_BLACKLIST.has(item.name)) continue;
        const foodInfo = mcData.foods[item.type] ?? mcData.foodsByName[item.name];
        if (foodInfo && foodInfo.foodPoints >= MIN_FOOD_POINTS) {
            let score = prioritizeSaturation ? (foodInfo.saturation * 1.5 + foodInfo.foodPoints) : (foodInfo.foodPoints + foodInfo.saturation);
            if (item.name.includes('golden_apple') || item.name.includes('enchanted_golden_apple')) score -= 50;
            else if (item.name.includes('golden_carrot')) score -= 10;
            if (score > bestScore) { bestScore = score; bestFood = item; }
        }
    }
    return bestFood;
}

async function performEat(food) {
     if (!botInstance || !botInstance.entity || !food || isEating) return false;
     isEating = true;
     let success = false;
     const originalBusyState = isBusy; // Lưu trạng thái busy trước khi ăn
     isBusy = true; // Đánh dấu busy khi đang ăn

     try {
         let currentHeldItem = botInstance.heldItem;
         if (!currentHeldItem || currentHeldItem.type !== food.type) {
             await botInstance.equip(food, 'hand');
             await botInstance.waitForTicks(5);
         }
         if (botInstance.heldItem?.type === food.type) {
             await botInstance.consume();
             success = true;
             console.log(`[Auto Eat] Đã ăn ${food.name}. Health: ${botInstance.health.toFixed(1)}, Food: ${botInstance.food}`);
         } else {
             console.error(`[Auto Eat] Lỗi: Không thể cầm ${food.name} lên tay để ăn sau khi equip.`);
         }
     } catch (err) {
         console.error(`[Auto Eat] Lỗi trong quá trình ăn ${food.name}:`, err.message);
     } finally {
         isEating = false;
         isBusy = originalBusyState; // Khôi phục trạng thái busy trước đó

         // *** THAY ĐỔI: Xử lý cảm ơn SAU KHI ĂN thành công nếu đang xin ***
         if (success && receivedFoodFromBegging && beggingTargetUsername) {
             const target = beggingTargetUsername; // Lưu tên lại phòng trường hợp bị reset ngay sau đó
             console.log(`[Auto Eat] Đã ăn sau khi nhận đồ từ ${target}. Gửi lời cảm ơn.`);
             botInstance.chat(`Cảm ơn ${target} nhiều nha! :>`);
             receivedFoodFromBegging = false; // Reset cờ *sau khi* đã cảm ơn
             // isBegging và beggingTargetUsername sẽ được reset bởi logic gọi (handlePlayerCollect)
         }
         // Nếu ăn không thành công nhưng cờ begging vẫn bật, không làm gì cả, chờ timeout hoặc thử lại
     }
     return success;
}

async function checkAndEat() {
    // Kiểm tra bot và trạng thái cơ bản
    if (!botInstance || !botInstance.entity || !botInstance.inventory || isEating || isBusy) return; // Thêm kiểm tra inventory

    const health = botInstance.health;
    const foodLevel = botInstance.food;
    const now = Date.now();

    // ----- ƯU TIÊN 1: MÁU THẤP -----
    if (health < LOW_HEALTH_THRESHOLD) {
        const needsToReachTargetHealth = health < TARGET_HEALTH_THRESHOLD;
        const needsToReachRegenFood = foodLevel < REGEN_FOOD_THRESHOLD;
        const canEatAfterCooldown = (now - lastEmergencyEatTime > REGEN_WAIT_MS);

        if ((needsToReachTargetHealth || needsToReachRegenFood) && canEatAfterCooldown) {
            const emergencyFood = findBestFood(botInstance, true);
            if (emergencyFood) {
                console.log(`[Auto Eat] Khẩn cấp: Máu ${health.toFixed(1)}. Ăn ${emergencyFood.name}.`);
                // isBusy sẽ được set trong performEat
                const ate = await performEat(emergencyFood);
                if (ate) {
                    lastEmergencyEatTime = now;
                }
                // isBusy sẽ được reset trong performEat
                return;
            } else {
                console.log(`[Auto Eat] Khẩn cấp: Máu thấp (${health.toFixed(1)}) nhưng hết thức ăn!`);
                if (now - lastAskTime > ASK_FOOD_COOLDOWN && !isBegging) { // Chỉ xin/săn nếu chưa làm
                    lastAskTime = now;
                    await handleNoFood(); // isBusy sẽ được quản lý trong handleNoFood/tryHunting
                }
                return;
            }
        }
        return; // Đang chờ cooldown hoặc tự hồi phục
    }

    // ----- ƯU TIÊN 2: ĐÓI BÌNH THƯỜNG -----
    if (foodLevel <= HUNGER_THRESHOLD) {
         const normalFood = findBestFood(botInstance, false);
         if (normalFood) {
             console.log(`[Auto Eat] Bình thường: Đói ${foodLevel}. Ăn ${normalFood.name}.`);
             // isBusy sẽ được set trong performEat
             await performEat(normalFood);
             // isBusy sẽ được reset trong performEat
             return;
         } else {
             console.log(`[Auto Eat] Bình thường: Đói (${foodLevel}) nhưng hết thức ăn!`);
             if (now - lastAskTime > ASK_FOOD_COOLDOWN && !isBegging) { // Chỉ xin/săn nếu chưa làm
                  lastAskTime = now;
                  await handleNoFood(); // isBusy sẽ được quản lý trong handleNoFood/tryHunting
             }
             return;
         }
    }
    // ----- TRƯỜNG HỢP 3: ỔN -----
    // Không làm gì
}


async function handleNoFood() {
    if (isBusy) return; // Nếu đang bận việc khác thì không bắt đầu xin/săn

    // 1. Ưu tiên tìm người chơi để xin
    const nearestPlayerEntity = botInstance.nearestEntity(entity =>
        entity.type === 'player' &&
        entity.username !== botInstance.username &&
        entity.isValid &&
        entity.position.distanceTo(botInstance.entity.position) <= BEGGING_RADIUS
    );

    if (nearestPlayerEntity && pathfinder) { // Cần pathfinder để đi tới
         console.log(`[Auto Eat] Hết thức ăn. Thấy ${nearestPlayerEntity.username} gần đó, đi tới xin...`);
         isBusy = true; // Đánh dấu bận khi bắt đầu quá trình xin
         isBegging = true;
         beggingTargetUsername = nearestPlayerEntity.username;
         receivedFoodFromBegging = false; // Reset cờ
         if (beggingTimeoutId) clearTimeout(beggingTimeoutId); // Xóa timeout cũ nếu có

         const goal = new goals.GoalFollow(nearestPlayerEntity, 3);
         try {
             await pathfinder.goto(goal);
             botInstance.chat(`${nearestPlayerEntity.username} ơi, mình hết đồ ăn rồi, bạn cho mình xin ít được không?`);
             // Đặt hẹn giờ MỚI để kiểm tra kết quả xin
             beggingTimeoutId = setTimeout(checkBeggingResult, BEGGING_TIMEOUT);
             // isBusy vẫn là true, chờ timeout hoặc nhận đồ
         } catch (err) {
             console.error(`[Auto Eat] Không thể đi tới ${nearestPlayerEntity.username}: ${err.message}. Thử đi săn.`);
             isBegging = false; // Hủy trạng thái xin
             beggingTargetUsername = null;
             if (beggingTimeoutId) clearTimeout(beggingTimeoutId); // Xóa timeout
             beggingTimeoutId = null;
             isBusy = false; // Hết bận việc xin (thất bại)
             await tryHunting(); // Chuyển sang thử săn (sẽ set isBusy nếu thành công)
         }
    } else {
        // Không có người chơi gần HOẶC không có pathfinder
        if (!pathfinder) {
             console.log("[Auto Eat] Hết thức ăn, không có người chơi gần hoặc thiếu pathfinder. Chat xin chung.");
             botInstance.chat("Đói quá mà hết đồ ăn rồi! Ai có gì cho tôi xin với!");
             // Không thể làm gì hơn
        } else {
             console.log("[Auto Eat] Hết thức ăn, không có người chơi nào gần để xin. Thử đi săn...");
             await tryHunting(); // isBusy sẽ được quản lý trong tryHunting
        }
    }
}

// Hàm này CHỈ được gọi bởi setTimeout khi HẾT GIỜ chờ xin
function checkBeggingResult() {
    beggingTimeoutId = null; // Đánh dấu timeout đã chạy

    // Nếu không còn trong trạng thái xin (ví dụ đã nhận đồ và hủy timeout), thì không làm gì cả
    if (!isBegging || !beggingTargetUsername) {
         // isBusy có thể đã được reset bởi handlePlayerCollect hoặc vẫn là true nếu có lỗi khác
         return;
    }

    const target = beggingTargetUsername; // Lưu lại tên
    console.log(`[Auto Eat] Hết thời gian chờ, không nhận được thức ăn từ ${target}. Chuyển sang đi săn.`);

    // Reset trạng thái xin
    isBegging = false;
    beggingTargetUsername = null;
    receivedFoodFromBegging = false; // Đảm bảo reset
    isBusy = false; // Kết thúc trạng thái bận của việc XIN

    // Thử đi săn
    tryHunting(); // Hàm này sẽ quản lý isBusy nếu bắt đầu săn
}

// Xử lý khi bot nhặt đồ
function handlePlayerCollect(collector, collected) {
     // Chỉ xử lý nếu: đang xin, người nhặt là bot, có mục tiêu xin
     if (isBegging && collector === botInstance?.entity && beggingTargetUsername) {
          // Kiểm tra mcData và loại vật phẩm
          if (!mcData) return; // Cần mcData để check
          const item = collected.getDroppedItem(); // Lấy thông tin item từ entity
          if (!item || !mcData.items[item.type]) return;

          const itemInfo = mcData.items[item.type];
          const isFood = mcData.foods[itemInfo.id] || mcData.foodsByName[itemInfo.name];
          const isNotBlacklisted = !ITEM_BLACKLIST.has(itemInfo.name);

          if (isFood && isNotBlacklisted) {
                console.log(`[Auto Eat] Phát hiện nhặt được thức ăn (${itemInfo.name}) khi đang xin ${beggingTargetUsername}.`);
                receivedFoodFromBegging = true; // Đánh dấu đã nhận

                // Hủy timeout chờ đợi, vì đã có kết quả (nhận được đồ)
                if (beggingTimeoutId) {
                    clearTimeout(beggingTimeoutId);
                    beggingTimeoutId = null;
                    console.log("[Auto Eat] Đã hủy timeout xin ăn do nhặt được đồ.");
                }

                // Reset trạng thái xin ngay lập tức và trạng thái busy
                // isBegging = false; // Tạm thời chưa reset ở đây, để performEat còn biết mà cảm ơn
                // beggingTargetUsername = null; // Tạm thời chưa reset
                isBusy = false; // Không còn bận RÓNG chờ nữa, nhưng có thể sẽ bận ĂN ngay sau đây

                // Kích hoạt kiểm tra ăn ngay lập tức
                // Dùng setTimeout 0 để đảm bảo nó chạy sau khi event hiện tại hoàn tất xử lý
                setTimeout(checkAndEat, 0);

                // Lưu ý: Lời cảm ơn sẽ được thực hiện trong performEat sau khi ăn thành công.
                // isBegging và beggingTargetUsername sẽ được reset trong performEat sau khi cảm ơn,
                // hoặc nếu ăn không thành công thì cần cơ chế dọn dẹp khác (có thể trong checkAndEat nếu cờ bật lâu mà không ăn được?)
                // -> Sửa lại: Reset isBegging ở đây luôn cho an toàn, performEat sẽ check receivedFoodFromBegging thôi.
                isBegging = false;
                // beggingTargetUsername vẫn giữ lại để performEat biết cảm ơn ai, rồi reset sau.
          }
     }
}

async function tryHunting() {
     // Nếu đang bận việc khác (ăn, xin...) thì không đi săn
     if (isBusy) {
          console.log("[Auto Eat] Đang bận việc khác, không thể bắt đầu săn.");
          return;
     }
     // Kiểm tra pathfinder và collectBlock
     if (!pathfinder) {
          console.log("[Auto Eat] Không thể săn vì thiếu pathfinder.");
          return;
     }
     if (!collectBlock) {
         console.warn("[Auto Eat] Thiếu plugin collectBlock. Sẽ không thể nhặt đồ sau khi săn!");
         // Có thể thêm logic tự path tới item nhưng phức tạp hơn
     }

     // Tìm vũ khí
     const weapon = botInstance.inventory.items().find(item => {
         const itemName = item.name;
         const lastUnderscore = itemName.lastIndexOf('_');
         const baseName = lastUnderscore === -1 ? itemName : itemName.substring(lastUnderscore + 1);
         return WEAPON_NAMES.has(baseName);
     });

     if (!weapon) {
         console.log("[Auto Eat] Không có vũ khí (kiếm/rìu) để săn.");
         return; // Không săn được
     }

     // Tìm mob phù hợp gần nhất
     const targetMob = botInstance.nearestEntity(entity =>
         HUNTABLE_FOOD_MOBS.has(entity.name) &&
         entity.position.distanceTo(botInstance.entity.position) <= HUNTING_RADIUS &&
         entity.isValid
     );

     if (targetMob) {
         console.log(`[Auto Eat] Tìm thấy ${targetMob.name} để săn. Vũ khí: ${weapon.name}.`);
         isBusy = true; // Bắt đầu bận rộn với việc săn
         let mobKilled = false;
         let lastMobPosition = null; // Lưu vị trí cuối của mob

         try {
             // Equip vũ khí nếu cần
             if (!botInstance.heldItem || botInstance.heldItem.type !== weapon.type) {
                 await botInstance.equip(weapon, 'hand');
                 await botInstance.waitForTicks(5);
             }
             // Chỉ tấn công nếu đang cầm đúng vũ khí
             if (botInstance.heldItem?.type !== weapon.type) {
                 throw new Error("Không thể trang bị vũ khí để tấn công.");
             }

             // *** Vòng lặp Di chuyển & Tấn công ***
             // Sử dụng bot.pathfinder.goto thay vì đuổi theo liên tục để tránh lỗi
             // hoặc dùng bot.pvp.attack(targetMob) nếu có mineflayer-pvp
             // Cách đơn giản: đi tới gần rồi đánh
             while (targetMob.isValid && botInstance.entity.position.distanceTo(targetMob.position) < HUNTING_RADIUS * 1.5) { // Giới hạn khoảng cách đuổi
                 lastMobPosition = targetMob.position.clone(); // Cập nhật vị trí cuối
                 pathfinder.setGoal(new goals.GoalFollow(targetMob, 1), true); // Đuổi theo dynamic

                 await botInstance.waitForTicks(5); // Chờ bot di chuyển chút

                 const distance = botInstance.entity.position.distanceTo(targetMob.position);

                 if (distance < 3.5) { // Trong tầm đánh
                     botInstance.attack(targetMob);
                     await botInstance.waitForTicks(10); // Chờ cooldown đánh + mob phản ứng
                 } else if (distance > HUNTING_RADIUS) { // Nếu mob chạy quá xa thì bỏ cuộc
                     console.log(`[Auto Eat] Mục tiêu ${targetMob.name} chạy quá xa. Hủy săn.`);
                     pathfinder.stop(); // Dừng di chuyển
                     break; // Thoát vòng lặp
                 }
                 // Nếu không trong tầm đánh nhưng không quá xa, vòng lặp sẽ tiếp tục pathfind

                 // Cập nhật lại targetMob entity phòng trường hợp nó thay đổi
                 // targetMob = botInstance.entities[targetMob.id]; // Dòng này có thể gây lỗi nếu id không còn tồn tại
                 const updatedMob = botInstance.entities[targetMob.id];
                 if (!updatedMob || !updatedMob.isValid) break; // Mob chết hoặc biến mất
                 // targetMob = updatedMob; // Không cần gán lại vì targetMob là tham chiếu object
             }

             pathfinder.stop(); // Dừng di chuyển khi vòng lặp kết thúc

             // Kiểm tra xem mob có còn hợp lệ không sau vòng lặp
             if (!targetMob.isValid) {
                  mobKilled = true; // Giả định là đã giết được nếu nó không còn valid
                  console.log(`[Auto Eat] Đã tiêu diệt ${targetMob.name}.`);
             } else {
                  console.log(`[Auto Eat] Kết thúc tấn công ${targetMob.name} (có thể do chạy xa hoặc lỗi).`);
             }

             // *** Logic Nhặt Đồ (MỚI) ***
             if (mobKilled && lastMobPosition && collectBlock) {
                  console.log("[Auto Eat] Chờ và tìm vật phẩm rơi ra...");
                  await botInstance.waitForTicks(Math.round(COLLECT_WAIT_MS / 50)); // Chờ đồ rơi (1 tick = 50ms)

                  // Tìm các item gần vị trí mob chết
                  const itemsToCollect = [];
                  for (const entityId in botInstance.entities) {
                       const entity = botInstance.entities[entityId];
                       if (entity.type === 'item' && entity.position.distanceTo(lastMobPosition) <= COLLECT_RADIUS) {
                            const item = entity.getDroppedItem();
                            if (item && !ITEM_BLACKLIST.has(item.name)) { // Chỉ nhặt đồ không trong blacklist
                                itemsToCollect.push(entity);
                            }
                       }
                  }

                  if (itemsToCollect.length > 0) {
                       console.log(`[Auto Eat] Tìm thấy ${itemsToCollect.length} vật phẩm để nhặt.`);
                       try {
                            // collectBlock.collect sẽ tự động xử lý việc đi tới và nhặt
                            await collectBlock.collect(itemsToCollect, { ignoreNoPath: true }); // Thêm ignoreNoPath để tránh lỗi nếu item kẹt
                            console.log("[Auto Eat] Đã nhặt xong vật phẩm (hoặc cố gắng nhặt).");
                       } catch (collectErr) {
                            console.error("[Auto Eat] Lỗi khi nhặt vật phẩm:", collectErr.message);
                       }
                  } else {
                       console.log("[Auto Eat] Không tìm thấy vật phẩm nào để nhặt gần đó.");
                  }
             } else if (mobKilled && !collectBlock) {
                 console.warn("[Auto Eat] Mob đã bị giết nhưng không thể nhặt đồ do thiếu collectBlock.");
             }

         } catch (err) {
              console.error(`[Auto Eat] Lỗi trong quá trình săn ${targetMob?.name || 'mob'}: ${err.message}`);
              pathfinder.stop(); // Đảm bảo dừng pathfinder nếu có lỗi
         } finally {
              isBusy = false; // Kết thúc trạng thái bận rộn của việc săn/nhặt đồ
              console.log("[Auto Eat] Kết thúc phiên săn bắn.");
              // Có thể thêm logic equip lại tool cũ ở đây nếu cần
         }
     } else {
          console.log(`[Auto Eat] Không tìm thấy mob phù hợp để săn trong bán kính ${HUNTING_RADIUS}.`);
          // Không cần set isBusy = false vì nó chưa bao giờ được set là true trong trường hợp này
     }
}

// Khởi tạo
function initializeAutoEat(bot) {
    // Dọn dẹp interval/listener cũ
    if (botInstance && botInstance.autoEatInterval) clearInterval(botInstance.autoEatInterval);
    if (botInstance) botInstance.removeListener('playerCollect', handlePlayerCollect);
    if (beggingTimeoutId) clearTimeout(beggingTimeoutId);

    // Reset trạng thái
    botInstance = bot;
    isEating = false;
    isBusy = false;
    isBegging = false;
    beggingTargetUsername = null;
    receivedFoodFromBegging = false;
    lastAskTime = 0;
    lastEmergencyEatTime = 0;
    beggingTimeoutId = null;
    mcData = null; // Reset để load lại
    pathfinder = null;
    collectBlock = null; // Reset collectBlock

    // Load mcData
    try {
         mcData = require('minecraft-data')(bot.version);
         if (!mcData || !mcData.foods) throw new Error("Dữ liệu food không hợp lệ.");
    } catch (e) {
         console.error("[Auto Eat] Lỗi nghiêm trọng khi tải mcData:", e.message);
         return; // Không tiếp tục nếu lỗi
    }

    // Gán pathfinder và collectBlock (nếu có)
    if (botInstance) {
         if (botInstance.pathfinder) {
             pathfinder = botInstance.pathfinder;
             console.log("[Auto Eat] Pathfinder đã được kích hoạt.");
         } else {
             console.warn("[Auto Eat] Pathfinder không có sẵn. Tính năng Xin/Săn sẽ bị hạn chế.");
         }
         // Kiểm tra và gán collectBlock
         try {
             // Thường collectBlock được nạp ở file bot chính, nhưng có thể thử require ở đây nếu cần
             if (botInstance.collectBlock) { // Kiểm tra xem nó đã được gắn vào bot chưa
                 collectBlock = botInstance.collectBlock;
                 console.log("[Auto Eat] CollectBlock đã được kích hoạt.");
             } else {
                 console.warn("[Auto Eat] Plugin CollectBlock không tìm thấy trên bot instance. Sẽ không tự nhặt đồ sau khi săn.");
             }
         } catch (e) {
             console.warn("[Auto Eat] Lỗi khi kiểm tra/gán CollectBlock:", e.message);
         }


         // Đăng ký listener và interval
         botInstance.on('playerCollect', handlePlayerCollect);
         botInstance.autoEatInterval = setInterval(() => {
             if (botInstance && botInstance.entity && botInstance.health !== undefined && botInstance.food !== undefined) {
                 checkAndEat();
             } else {
                 console.warn("[Auto Eat] Bot không hợp lệ/đã ngắt kết nối. Dừng Auto Eat.");
                 if (botInstance && botInstance.autoEatInterval) clearInterval(botInstance.autoEatInterval);
                 if (botInstance) botInstance.removeListener('playerCollect', handlePlayerCollect);
                 if (beggingTimeoutId) clearTimeout(beggingTimeoutId);
                 // Reset biến toàn cục
                 botInstance = null; mcData = null; pathfinder = null; collectBlock = null; isEating = false; isBusy = false; isBegging = false; beggingTargetUsername = null; receivedFoodFromBegging = false; lastAskTime = 0; lastEmergencyEatTime = 0; beggingTimeoutId = null;
             }
         }, CHECK_INTERVAL_MS);
         console.log("[Auto Eat] Đã khởi tạo với logic xin/săn/nhặt đồ được cập nhật.");
    } else {
        console.error("[Auto Eat] Lỗi: Không thể khởi tạo vì bot instance không hợp lệ.");
    }
}

module.exports = {
    initializeAutoEat,
};