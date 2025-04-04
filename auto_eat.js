// auto_eat.js

const HUNGER_THRESHOLD = 12;
const MIN_FOOD_POINTS = 2; // Giữ nguyên, vì hạt giống nếu bị nhầm cũng không đạt ngưỡng này
const ASK_FOOD_COOLDOWN = 5 * 60 * 1000;
const CHECK_INTERVAL_MS = 5000;

let botInstance = null;
let lastAskTime = 0;
let isEating = false;

// ***** THÊM DANH SÁCH ĐEN *****
// Các vật phẩm KHÔNG BAO GIỜ nên được coi là thức ăn thông thường
const ITEM_BLACKLIST = new Set([
    'wheat_seeds',
    'melon_seeds',
    'pumpkin_seeds',
    'beetroot_seeds',
    'nether_wart', // Mặc dù dùng cho Potion nhưng không phải thức ăn
    'cocoa_beans',
    // Thêm các loại hạt giống hoặc vật phẩm không ăn được khác nếu cần
    // Các món độc hại đã được xử lý bằng cách phạt điểm nặng, nhưng thêm vào đây cũng không sao
    'spider_eye',
    'poisonous_potato',
    'pufferfish',
    'rotten_flesh',
    'chorus_fruit', // Thêm vào đây để chắc chắn loại bỏ dù đã phạt điểm
    'suspicious_stew' // Stew lạ cũng có thể nguy hiểm, loại bỏ luôn
]);
// ******************************

function findBestFood(bot) {
    const mcData = require('minecraft-data')(bot.version);
    let bestFood = null;
    let bestScore = -1;
    console.log("[Auto Eat Debug] Bắt đầu tìm thức ăn trong inventory...");
    // Log kiểm tra mcData giữ nguyên như trước
    console.log(`[Auto Eat Debug] Bot version reported: ${bot.version}`);
    console.log(`[Auto Eat Debug] mcData loaded for version: ${mcData.version?.minecraftVersion}`);
    console.log(`[Auto Eat Debug] Number of food entries in mcData.foods (by ID): ${Object.keys(mcData.foods || {}).length}`);
    console.log(`[Auto Eat Debug] Number of food entries in mcData.foodsByName: ${Object.keys(mcData.foodsByName || {}).length}`);
    // Kiểm tra trực tiếp ID và tên
    // console.log(`[Auto Eat Debug] mcData.foods[912] (porkchop ID):`, mcData.foods ? mcData.foods[912] : 'N/A');
    // console.log(`[Auto Eat Debug] mcData.foods[886] (bread ID):`, mcData.foods ? mcData.foods[886] : 'N/A');
    // console.log(`[Auto Eat Debug] mcData.foodsByName['porkchop']:`, mcData.foodsByName ? mcData.foodsByName['porkchop'] : 'N/A');
    // console.log(`[Auto Eat Debug] mcData.foodsByName['bread']:`, mcData.foodsByName ? mcData.foodsByName['bread'] : 'N/A');


    for (const item of bot.inventory.items()) {
        console.log(`[Auto Eat Debug] Kiểm tra item: ${item.name} (Type: ${item.type})`);

        // ***** THÊM BƯỚC KIỂM TRA BLACKLIST *****
        if (ITEM_BLACKLIST.has(item.name)) {
            console.log(`[Auto Eat Debug] -> Bị loại do nằm trong BLACKLIST.`);
            continue; // Bỏ qua vật phẩm này, chuyển sang vật phẩm tiếp theo
        }
        // ***************************************

        const foodInfoById = mcData.foods ? mcData.foods[item.type] : null;
        const foodInfoByName = mcData.foodsByName ? mcData.foodsByName[item.name] : null;
        const foodInfo = foodInfoById || foodInfoByName;

        // Log kết quả tra cứu giữ nguyên
        // console.log(`[Auto Eat Debug] -> Found by ID (${item.type}): ${!!foodInfoById}, Found by Name (${item.name}): ${!!foodInfoByName}`);

        if (foodInfo) {
            console.log(`[Auto Eat Debug] -> Là thức ăn theo mcData. FoodPoints: ${foodInfo.foodPoints}, Saturation: ${foodInfo.saturation}`);
            if (foodInfo.foodPoints >= MIN_FOOD_POINTS) {
                let score = foodInfo.foodPoints + foodInfo.saturation;
                console.log(`[Auto Eat Debug] -> Điểm cơ bản: ${score.toFixed(1)}`);

                // Logic phạt điểm giữ nguyên
                if (item.name.includes('golden_apple') || item.name.includes('enchanted_golden_apple')) {
                    score -= 50; console.log(`[Auto Eat Debug] -> Phạt (táo vàng): ${score.toFixed(1)}`);
                } else if (item.name.includes('golden_carrot')) {
                    score -= 10; console.log(`[Auto Eat Debug] -> Phạt (cà rốt vàng): ${score.toFixed(1)}`);
                }
                // Lưu ý: Chorus fruit và suspicious stew đã bị loại bởi blacklist ở trên, nhưng để logic phạt ở đây cũng không sao
                // else if (item.name === 'chorus_fruit') {
                //     score -= 20; console.log(`[Auto Eat Debug] -> Phạt (chorus): ${score.toFixed(1)}`);
                // } else if (item.name === 'suspicious_stew') {
                //     score -= 15; console.log(`[Auto Eat Debug] -> Phạt (stew lạ): ${score.toFixed(1)}`);
                // }
                // Các món độc hại cũng đã bị loại bởi blacklist
                // else if (item.name === 'spider_eye' || item.name === 'poisonous_potato' || item.name === 'pufferfish' || item.name === 'rotten_flesh') {
                //     score = -100; console.log(`[Auto Eat Debug] -> Loại bỏ (độc/đói)`);
                // }

                if (score > bestScore) {
                    bestScore = score;
                    bestFood = item;
                    console.log(`[Auto Eat Debug] -> *** Chọn làm thức ăn tốt nhất hiện tại ***`);
                }
            } else {
                 console.log(`[Auto Eat Debug] -> Bị loại (FoodPoints < ${MIN_FOOD_POINTS})`);
            }
        } else {
             console.log(`[Auto Eat Debug] -> Không phải thức ăn theo mcData.`);
        }
    }

    if (bestFood) {
        console.log(`[Auto Eat] Thức ăn tốt nhất tìm thấy: ${bestFood.name} (Score: ${bestScore.toFixed(1)})`);
    } else {
        console.log("[Auto Eat Debug] Không tìm thấy thức ăn nào phù hợp sau khi duyệt inventory.");
    }
    return bestFood;
}


async function checkAndEat() {
    if (!botInstance || isEating) return;

    // Sửa lỗi tiềm ẩn: Đảm bảo botInstance.food tồn tại trước khi so sánh
    if (botInstance.food !== undefined && botInstance.food <= HUNGER_THRESHOLD) {
        console.log(`[Auto Eat] Đói (${botInstance.food}/${HUNGER_THRESHOLD}). Tìm thức ăn...`);
        const food = findBestFood(botInstance);

        if (food) {
            isEating = true;
            console.log(`[Auto Eat] Chuẩn bị ăn ${food.name}...`);
            try {
                 // Kiểm tra xem có đang cầm đúng đồ ăn không
                let currentHeldItem = botInstance.heldItem;
                if (!currentHeldItem || currentHeldItem.type !== food.type) {
                     console.log(`[Auto Eat Debug] Cần đổi đồ ăn trên tay. Đang cầm: ${currentHeldItem?.name ?? 'nothing'}. Cần cầm: ${food.name}`);
                    await botInstance.equip(food, 'hand');
                     // Đợi một chút để server xác nhận việc đổi item
                    await botInstance.waitForTicks(5);
                     console.log(`[Auto Eat Debug] Đã đổi sang ${botInstance.heldItem?.name}`);
                } else {
                    console.log(`[Auto Eat Debug] Đã cầm sẵn ${food.name}.`);
                }

                 // Kiểm tra lại trước khi ăn, phòng trường hợp equip thất bại
                 if (botInstance.heldItem?.type === food.type) {
                    await botInstance.consume();
                    console.log(`[Auto Eat] Đã ăn xong ${food.name}. Mức đói hiện tại: ${botInstance.food}`);
                 } else {
                    console.error(`[Auto Eat] Lỗi: Không thể cầm ${food.name} lên tay để ăn.`);
                 }

            } catch (err) {
                console.error(`[Auto Eat] Lỗi trong quá trình ăn ${food.name}:`, err.message);
                // Thêm log chi tiết lỗi nếu có thể
                 if (err.stack) {
                    console.error(err.stack);
                 }
            } finally {
                isEating = false;
                 console.log("[Auto Eat Debug] Kết thúc lượt kiểm tra ăn uống.");
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
    } else if (botInstance.food === undefined) {
        // Thêm log nếu botInstance.food không xác định
        console.warn("[Auto Eat] Không thể đọc mức độ đói (botInstance.food is undefined). Bỏ qua kiểm tra.");
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

    // Kiểm tra botInstance tồn tại trước khi đặt interval
    if(botInstance){
        botInstance.autoEatInterval = setInterval(() => {
            // Kiểm tra lại botInstance bên trong interval đề phòng trường hợp bot bị disconnect đột ngột
            if (botInstance && botInstance.entity) { // Thêm kiểm tra botInstance.entity
                checkAndEat();
            } else {
                // Nếu bot không còn tồn tại, tự động hủy interval
                console.warn("[Auto Eat] Bot instance không hợp lệ hoặc đã mất kết nối. Dừng auto eat interval.");
                if (botInstance && botInstance.autoEatInterval) { // Kiểm tra lại trước khi clear
                     clearInterval(botInstance.autoEatInterval);
                     botInstance.autoEatInterval = null; // Đặt lại thành null
                 } else if (this && this.autoEatInterval) { // Trường hợp hy hữu this tham chiếu đúng
                     clearInterval(this.autoEatInterval);
                     this.autoEatInterval = null;
                 }
            }
        }, CHECK_INTERVAL_MS);
        console.log("[Auto Eat] Đã khởi tạo và bắt đầu kiểm tra cơn đói (Ngưỡng: " + HUNGER_THRESHOLD + ").");
    } else {
        console.error("[Auto Eat] Lỗi: Không thể khởi tạo vì bot instance không hợp lệ.");
    }
}


module.exports = {
    initializeAutoEat,
    // Có thể export thêm checkAndEat nếu muốn gọi thủ công từ bên ngoài để test
    // checkAndEat
};