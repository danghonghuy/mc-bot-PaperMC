const { GoalNear } = require("mineflayer-pathfinder").goals;
const { Vec3 } = require("vec3");
const { translateToEnglishId, formatCoords } = require("../utils");

const BREED_SEARCH_RADIUS = 10;
const BREED_INTERACT_DIST = 2;

const animalFoodMap = {
    'cow': 'wheat',
    'sheep': 'wheat',
    'pig': ['carrot', 'potato', 'beetroot'],
    'chicken': ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds', 'torchflower_seeds', 'pitcher_pod'], // Mảng vì gà ăn nhiều loại hạt
    'horse': ['golden_apple', 'enchanted_golden_apple', 'golden_carrot'], // Chỉ để thuần hóa/hồi máu, cần logic khác để nhân giống (dùng cỏ khô?)
    'donkey': ['golden_apple', 'enchanted_golden_apple', 'golden_carrot'],
    'mule': [], // Không thể nhân giống
    'wolf': 'bone', // Để thuần hóa, nhân giống cần thịt
    'cat': ['cod', 'salmon'], // Để thuần hóa/nhân giống
    'ocelot': ['cod', 'salmon'], // Để thuần hóa
    'rabbit': ['dandelion', 'carrot', 'golden_carrot'],
    'llama': 'hay_block',
    'fox': ['sweet_berries', 'glow_berries'],
    'panda': 'bamboo',
    'strider': 'warped_fungus',
    'hoglin': 'crimson_fungus',
    'bee': ['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose', 'sunflower', 'lilac', 'rose_bush', 'peony', 'torchflower', 'pitcher_plant'], // Hoa
    'goat': 'wheat',
    'frog': 'slime_ball',
    'camel': 'cactus',
    'sniffer': 'torchflower_seeds',
    // Thêm các mob khác nếu cần
};

async function equipFood(bot, foodItemNames) {
    const mcData = require('minecraft-data')(bot.version);
    const foodArray = Array.isArray(foodItemNames) ? foodItemNames : [foodItemNames];

    for (const foodName of foodArray) {
        const foodItem = mcData.itemsByName[foodName];
        if (!foodItem) continue;

        const itemInInventory = bot.inventory.findInventoryItem(foodItem.id, null);
        if (itemInInventory) {
            try {
                console.log(`[Farm Equip] Tìm thấy thức ăn: ${foodName}. Đang trang bị...`);
                await bot.equip(itemInInventory, 'hand');
                console.log(`[Farm Equip] Đã trang bị ${foodName}.`);
                return foodItem; // Trả về item đã trang bị thành công
            } catch (err) {
                console.error(`[Farm Equip] Lỗi khi trang bị ${foodName}:`, err.message);
            }
        }
    }
    console.log(`[Farm Equip] Không tìm thấy thức ăn phù hợp (${foodArray.join('/')}) trong túi đồ.`);
    return null; // Không tìm thấy hoặc không trang bị được
}

async function breedAnimals(bot, username, message, aiModel) {
    console.log(`[Farm] Xử lý yêu cầu nhân giống từ ${username}: "${message}"`);

    if (bot.isFinding || bot.isFollowing || bot.isProtecting || bot.isCollecting) {
        let reason = bot.isFinding ? 'tìm đồ' : (bot.isFollowing ? 'đi theo' : (bot.isProtecting ? 'bảo vệ' : 'thu thập'));
        bot.chat(`${username}, tôi đang bận ${reason} rồi, không đi nhân giống được!`);
        console.log(`[Farm] Bị chặn do đang ${reason}.`);
        return;
    }

    const extractionPrompt = `Từ tin nhắn "${message}", trích xuất tên loại động vật mà người chơi muốn nhân giống (ví dụ: bò, cừu, gà). Chỉ trả về tên động vật (tiếng Việt). Nếu không rõ, trả về "UNKNOWN". Tên:`;
    let animalNameVi;
    try {
        console.log("[Farm] Gửi prompt trích xuất tên động vật...");
        const extractResult = await aiModel.generateContent(extractionPrompt);
        animalNameVi = (await extractResult.response.text()).trim();
        if (!animalNameVi || animalNameVi.toUpperCase() === "UNKNOWN") {
            throw new Error("AI không trích xuất được tên động vật hợp lệ.");
        }
        console.log(`[Farm] AI trích xuất tên: "${animalNameVi}"`);
    } catch (error) {
        console.error("[Farm] Lỗi trích xuất tên động vật:", error);
        bot.chat(`Xin lỗi ${username}, bạn muốn tôi nhân giống con gì?`);
        return;
    }

    const animalId = translateToEnglishId(animalNameVi);
    if (!animalId) {
        bot.chat(`Xin lỗi ${username}, tôi không biết con "${animalNameVi}" là con gì.`);
        return;
    }

    const requiredFoodNames = animalFoodMap[animalId];
    if (!requiredFoodNames || requiredFoodNames.length === 0) {
        bot.chat(`Xin lỗi ${username}, tôi không biết con "${animalNameVi}" (${animalId}) ăn gì để nhân giống, hoặc nó không thể nhân giống.`);
        console.log(`[Farm] Không tìm thấy thức ăn cho ${animalId} trong map hoặc không thể nhân giống.`);
        return;
    }
    console.log(`[Farm] Động vật: ${animalId}, Thức ăn cần: ${Array.isArray(requiredFoodNames) ? requiredFoodNames.join('/') : requiredFoodNames}`);

    const mcData = require('minecraft-data')(bot.version);
    const animalEntityType = mcData.entitiesByName[animalId];
    if (!animalEntityType) {
         bot.chat(`Xin lỗi ${username}, có lỗi khi lấy thông tin về con "${animalNameVi}" (${animalId}).`);
         console.error(`[Farm] Không tìm thấy entity data cho ${animalId}`);
         return;
    }

    const foodItem = await equipFood(bot, requiredFoodNames);
    if (!foodItem) {
        const foodList = Array.isArray(requiredFoodNames) ? requiredFoodNames.join(', ') : requiredFoodNames;
        bot.chat(`Xin lỗi ${username}, tôi không có thức ăn (${foodList}) để nhân giống ${animalNameVi}.`);
        return;
    }

    console.log(`[Farm] Tìm kiếm 2 con ${animalId} trưởng thành gần nhau...`);
    let animal1 = null;
    let animal2 = null;
    const nearbyAnimals = bot.entities; // Lấy tất cả entities bot thấy

    const candidates = [];
    for (const entityId in nearbyAnimals) {
        const entity = nearbyAnimals[entityId];
        if (entity.name === animalId &&
            entity.metadata && typeof entity.metadata[16] === 'number' && entity.metadata[16] >= 0 && // Check if adult (metadata index might vary, 16 is common for age)
            entity.position.distanceTo(bot.entity.position) <= BREED_SEARCH_RADIUS &&
            (!entity.metadata[17] || entity.metadata[17] === 0) // Check love mode ticks (metadata index 17 is common) - 0 or undefined means not in love mode
            )
        {
             candidates.push(entity);
        }
    }

     if (candidates.length < 2) {
        bot.chat(`Xin lỗi ${username}, tôi không tìm thấy đủ 2 con ${animalNameVi} trưởng thành và sẵn sàng để nhân giống gần đây.`);
        console.log(`[Farm] Tìm thấy ${candidates.length} ứng viên ${animalId}.`);
        return;
    }

    // Đơn giản là lấy 2 con đầu tiên tìm được
    animal1 = candidates[0];
    animal2 = candidates[1];
    console.log(`[Farm] Tìm thấy cặp: ${animal1.id} và ${animal2.id}`);
    bot.chat(`Ok ${username}, tìm thấy một cặp ${animalNameVi}. Bắt đầu cho ăn...`);

    try {
        console.log(`[Farm] Đi đến con ${animalId} thứ nhất (ID: ${animal1.id})`);
        await bot.pathfinder.goto(new GoalNear(animal1.position.x, animal1.position.y, animal1.position.z, BREED_INTERACT_DIST));
        console.log(`[Farm] Đã đến gần con thứ nhất. Cho ăn...`);
        await bot.activateEntity(animal1);
        console.log(`[Farm] Đã cho con thứ nhất ăn.`);
        await bot.waitForTicks(10); // Chờ chút

        console.log(`[Farm] Đi đến con ${animalId} thứ hai (ID: ${animal2.id})`);
        await bot.pathfinder.goto(new GoalNear(animal2.position.x, animal2.position.y, animal2.position.z, BREED_INTERACT_DIST));
        console.log(`[Farm] Đã đến gần con thứ hai. Cho ăn...`);
        await bot.activateEntity(animal2);
        console.log(`[Farm] Đã cho con thứ hai ăn.`);

        bot.chat(`${username}, đã cho cặp ${animalNameVi} ăn xong!`);

    } catch (err) {
        console.error(`[Farm] Lỗi khi di chuyển hoặc cho ăn:`, err.message);
        bot.chat(`Ối ${username}, tôi gặp lỗi khi đang cố gắng cho ${animalNameVi} ăn.`);
        // Dừng pathfinder nếu đang chạy
        try { if (bot.pathfinder?.isMoving()) bot.pathfinder.stop(); } catch(e) {}
    } finally {
        // Bỏ trang bị thức ăn (tùy chọn)
        // await bot.unequip('hand');
    }
}


module.exports = {
    breedAnimals,
};