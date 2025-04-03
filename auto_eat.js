// auto_eat.js

const HUNGER_THRESHOLD = 12;
const MIN_FOOD_POINTS = 2;
const ASK_FOOD_COOLDOWN = 5 * 60 * 1000;
const CHECK_INTERVAL_MS = 5000;

let botInstance = null;
let lastAskTime = 0;
let isEating = false;

function findBestFood(bot) {
    const mcData = require('minecraft-data')(bot.version);
    let bestFood = null;
    let bestScore = -1;
    console.log("[Auto Eat Debug] Bắt đầu tìm thức ăn trong inventory...");
    // <<< THÊM LOG KIỂM TRA mcData >>>
    console.log(`[Auto Eat Debug] Bot version reported: ${bot.version}`);
    console.log(`[Auto Eat Debug] mcData loaded for version: ${mcData.version?.minecraftVersion}`);
    console.log(`[Auto Eat Debug] Number of food entries in mcData.foods (by ID): ${Object.keys(mcData.foods || {}).length}`);
    console.log(`[Auto Eat Debug] Number of food entries in mcData.foodsByName: ${Object.keys(mcData.foodsByName || {}).length}`);
    // Kiểm tra trực tiếp ID và tên
    console.log(`[Auto Eat Debug] mcData.foods[912] (porkchop ID):`, mcData.foods ? mcData.foods[912] : 'N/A');
    console.log(`[Auto Eat Debug] mcData.foods[886] (bread ID):`, mcData.foods ? mcData.foods[886] : 'N/A');
    console.log(`[Auto Eat Debug] mcData.foodsByName['porkchop']:`, mcData.foodsByName ? mcData.foodsByName['porkchop'] : 'N/A');
    console.log(`[Auto Eat Debug] mcData.foodsByName['bread']:`, mcData.foodsByName ? mcData.foodsByName['bread'] : 'N/A');
    // <<< KẾT THÚC LOG KIỂM TRA mcData >>>

    for (const item of bot.inventory.items()) {
        const foodInfoById = mcData.foods ? mcData.foods[item.type] : null; // Tra cứu bằng ID
        const foodInfoByName = mcData.foodsByName ? mcData.foodsByName[item.name] : null; // Tra cứu bằng tên
        const foodInfo = foodInfoById || foodInfoByName; // Ưu tiên ID, nếu không có thì thử tên

        console.log(`[Auto Eat Debug] Kiểm tra item: ${item.name} (Type: ${item.type})`);
        console.log(`[Auto Eat Debug] -> Found by ID (${item.type}): ${!!foodInfoById}, Found by Name (${item.name}): ${!!foodInfoByName}`); // Log kết quả tra cứu

        if (foodInfo) {
            console.log(`[Auto Eat Debug] -> Là thức ăn. FoodPoints: ${foodInfo.foodPoints}, Saturation: ${foodInfo.saturation}`);
            if (foodInfo.foodPoints >= MIN_FOOD_POINTS) {
                let score = foodInfo.foodPoints + foodInfo.saturation;
                console.log(`[Auto Eat Debug] -> Điểm cơ bản: ${score.toFixed(1)}`);

                if (item.name.includes('golden_apple') || item.name.includes('enchanted_golden_apple')) {
                    score -= 50; console.log(`[Auto Eat Debug] -> Phạt (táo vàng): ${score.toFixed(1)}`);
                } else if (item.name.includes('golden_carrot')) {
                    score -= 10; console.log(`[Auto Eat Debug] -> Phạt (cà rốt vàng): ${score.toFixed(1)}`);
                } else if (item.name === 'chorus_fruit') {
                    score -= 20; console.log(`[Auto Eat Debug] -> Phạt (chorus): ${score.toFixed(1)}`);
                } else if (item.name === 'suspicious_stew') {
                    score -= 15; console.log(`[Auto Eat Debug] -> Phạt (stew lạ): ${score.toFixed(1)}`);
                } else if (item.name === 'spider_eye' || item.name === 'poisonous_potato' || item.name === 'pufferfish' || item.name === 'rotten_flesh') {
                    score = -100; console.log(`[Auto Eat Debug] -> Loại bỏ (độc/đói)`);
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestFood = item;
                    console.log(`[Auto Eat Debug] -> *** Chọn làm thức ăn tốt nhất hiện tại ***`);
                }
            } else {
                 console.log(`[Auto Eat Debug] -> Bị loại (FoodPoints < ${MIN_FOOD_POINTS})`);
            }
        } else {
             console.log(`[Auto Eat Debug] -> Không phải thức ăn theo mcData (ID: ${item.type}, Name: ${item.name}).`);
        }
    }

    if (bestFood) {
        console.log(`[Auto Eat] Thức ăn tốt nhất tìm thấy: ${bestFood.name} (Score: ${bestScore.toFixed(1)})`);
    } else {
        console.log("[Auto Eat Debug] Không tìm thấy thức ăn nào phù hợp sau khi duyệt inventory.");
    }
    return bestFood;
}

// Hàm checkAndEat và initializeAutoEat giữ nguyên như phiên bản trước

async function checkAndEat() {
    if (!botInstance || isEating) return;

    if (botInstance.food <= HUNGER_THRESHOLD) {
        console.log(`[Auto Eat] Đói (${botInstance.food}/${HUNGER_THRESHOLD}). Tìm thức ăn...`);
        const food = findBestFood(botInstance);

        if (food) {
            isEating = true;
            console.log(`[Auto Eat] Chuẩn bị ăn ${food.name}...`);
            try {
                if (botInstance.heldItem?.type !== food.type) {
                    await botInstance.equip(food, 'hand');
                    await botInstance.waitForTicks(5);
                }
                await botInstance.consume();
                console.log(`[Auto Eat] Đã ăn xong ${food.name}. Mức đói hiện tại: ${botInstance.food}`);
            } catch (err) {
                console.error(`[Auto Eat] Lỗi khi ăn ${food.name}:`, err.message);
            } finally {
                isEating = false;
            }
        } else {
            console.log("[Auto Eat] Không tìm thấy thức ăn phù hợp trong túi đồ.");
            const now = Date.now();
            if (now - lastAskTime > ASK_FOOD_COOLDOWN) {
                console.log("[Auto Eat] Đã đủ thời gian cooldown, xin người chơi...");
                 try {
                    botInstance.chat("Đói quá mà hết đồ ăn rồi! Ai có gì cho tôi xin với!");
                    lastAskTime = now;
                } catch (e) { console.error("[Auto Eat] Lỗi chat xin ăn:", e); }
            } else {
                 console.log("[Auto Eat] Chưa đủ thời gian cooldown để xin ăn lại.");
            }
        }
    }
}

function initializeAutoEat(bot) {
     if (botInstance && botInstance.autoEatInterval) {
        clearInterval(botInstance.autoEatInterval);
        console.log("[Auto Eat] Đã dừng interval cũ.");
    }
    botInstance = bot;
    isEating = false;
    lastAskTime = 0;
    botInstance.autoEatInterval = setInterval(() => {
        if (botInstance) {
            checkAndEat();
        } else {
            if (this.autoEatInterval) clearInterval(this.autoEatInterval);
        }
    }, CHECK_INTERVAL_MS);
    console.log("[Auto Eat] Đã khởi tạo và bắt đầu kiểm tra cơn đói (Ngưỡng: " + HUNGER_THRESHOLD + ").");
}


module.exports = {
    initializeAutoEat,
};