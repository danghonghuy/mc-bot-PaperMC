// --- START OF FILE farm.js ---

const { GoalNear } = require("mineflayer-pathfinder").goals;
const { Vec3 } = require("vec3");
const { translateToEnglishId, formatCoords } = require("../utils");
const { sleep } = require('../utils'); // Giả sử có hàm sleep

const BREED_SEARCH_RADIUS = 16; // Tăng nhẹ bán kính tìm kiếm
const BREED_INTERACT_DIST = 2.5; // Khoảng cách tương tác
const MAX_PAIR_DISTANCE = 8; // Khoảng cách tối đa chấp nhận được giữa cặp được chọn
const LOVE_MODE_CHECK_DELAY_TICKS = 15; // Số tick chờ trước khi kiểm tra love mode
const FINAL_DISTANCE_CHECK = 6; // Khoảng cách tối đa giữa cặp sau khi cho ăn

// --- Cập nhật animalFoodMap ---
const animalFoodMap = {
    'cow': 'wheat',
    'sheep': 'wheat',
    'pig': ['carrot', 'potato', 'beetroot'],
    'chicken': ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds', 'torchflower_seeds', 'pitcher_pod'],
    // Sói cần thịt để nhân giống (sau khi đã thuần hóa). Xương chỉ để thuần hóa.
    'wolf': ['beef', 'porkchop', 'chicken', 'mutton', 'rabbit', 'rotten_flesh', // Thêm các loại thịt khác nếu cần
             'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton', 'cooked_rabbit'],
    'cat': ['cod', 'salmon'], // Dùng để thuần hóa và nhân giống mèo đã thuần hóa
    'ocelot': ['cod', 'salmon'], // Chỉ để thuần hóa
    'rabbit': ['dandelion', 'carrot', 'golden_carrot'],
    'llama': 'hay_block',
    'fox': ['sweet_berries', 'glow_berries'],
    'panda': 'bamboo',
    'strider': 'warped_fungus',
    'hoglin': 'crimson_fungus',
    'bee': ['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose', 'sunflower', 'lilac', 'rose_bush', 'peony', 'torchflower', 'pitcher_plant'],
    'goat': 'wheat',
    'frog': 'slime_ball',
    'camel': 'cactus',
    'sniffer': 'torchflower_seeds',
    // Ngựa/Lừa cần Táo Vàng/Cà Rốt Vàng để kích hoạt nhân giống (chúng phải được thuần hóa trước).
    // Logic hiện tại không xử lý thuần hóa.
    'horse': ['golden_apple', 'enchanted_golden_apple', 'golden_carrot'],
    'donkey': ['golden_apple', 'enchanted_golden_apple', 'golden_carrot'],
    'mule': [], // Không thể nhân giống
    // Thêm các mob khác nếu cần
};

// --- Hàm trang bị thức ăn (Cải thiện xử lý lỗi) ---
async function equipFood(bot, foodItemNames) {
    const mcData = require('minecraft-data')(bot.version);
    const foodArray = Array.isArray(foodItemNames) ? foodItemNames : [foodItemNames];
    console.log(`[Farm Equip] Tìm kiếm thức ăn: ${foodArray.join('/')} trong túi đồ.`);

    for (const foodName of foodArray) {
        const foodItemData = mcData.itemsByName[foodName];
        if (!foodItemData) {
            console.warn(`[Farm Equip] Không tìm thấy dữ liệu item cho "${foodName}" trong mcData.`);
            continue; // Bỏ qua nếu tên thức ăn không hợp lệ
        }

        const itemInInventory = bot.inventory.findInventoryItem(foodItemData.id, null);
        if (itemInInventory) {
            try {
                console.log(`[Farm Equip] Tìm thấy ${itemInInventory.count} ${foodName}. Đang trang bị...`);
                await bot.equip(itemInInventory, 'hand');
                console.log(`[Farm Equip] Đã trang bị ${foodName}.`);
                return foodItemData; // Trả về item đã trang bị thành công
            } catch (err) {
                console.error(`[Farm Equip] Lỗi nghiêm trọng khi trang bị ${foodName}:`, err.message);
                // Dừng ngay lập tức nếu equip lỗi, không thử loại khác nữa
                return null;
            }
        } else {
             console.log(`[Farm Equip] Không có ${foodName} trong túi đồ.`);
        }
    }
    console.log(`[Farm Equip] Không tìm thấy hoặc không thể trang bị bất kỳ loại thức ăn phù hợp nào (${foodArray.join('/')}).`);
    return null; // Không tìm thấy hoặc không trang bị được
}

// --- Hàm kiểm tra trạng thái yêu đương (Sử dụng metadata với cảnh báo) ---
function isInLove(entity) {
    // CẢNH BÁO: Metadata index có thể không ổn định giữa các phiên bản Minecraft!
    // Index 17 thường là số tick còn lại trong love mode.
    const loveTicks = entity?.metadata?.[17];
    // console.log(`[Farm Debug] Checking love mode for entity ${entity?.id}: metadata[17] = ${loveTicks}`); // Debug log
    return typeof loveTicks === 'number' && loveTicks > 0;
}

// --- Hàm kiểm tra có phải là con non (Sử dụng metadata với cảnh báo) ---
function isBaby(entity) {
    // CẢNH BÁO: Metadata index có thể không ổn định giữa các phiên bản Minecraft!
    // Index 16 thường là tuổi (âm là con non, >= 0 là trưởng thành).
    const age = entity?.metadata?.[16];
     // console.log(`[Farm Debug] Checking age for entity ${entity?.id}: metadata[16] = ${age}`); // Debug log
    return typeof age === 'number' && age < 0;
}

// --- Hàm tìm cặp động vật tốt nhất ---
function findBestPair(bot, candidates) {
    let bestPair = null;
    let minDistanceSq = Infinity;

    console.log(`[Farm FindPair] Tìm cặp tốt nhất từ ${candidates.length} ứng viên...`);
    if (candidates.length < 2) return null;

    for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
            const animal1 = candidates[i];
            const animal2 = candidates[j];
            const distSq = animal1.position.distanceSquared(animal2.position);

            // Ưu tiên cặp gần nhau hơn
            if (distSq < minDistanceSq && distSq <= MAX_PAIR_DISTANCE * MAX_PAIR_DISTANCE) {
                 // Kiểm tra lại xem cả hai có còn trong tầm nhìn/tương tác không (tùy chọn)
                 // if (bot.entity.position.distanceTo(animal1.position) <= BREED_SEARCH_RADIUS &&
                 //     bot.entity.position.distanceTo(animal2.position) <= BREED_SEARCH_RADIUS)
                 // {
                    minDistanceSq = distSq;
                    bestPair = [animal1, animal2];
                 // }
            }
        }
    }

    if (bestPair) {
        console.log(`[Farm FindPair] Tìm thấy cặp tốt nhất: ${bestPair[0].id} và ${bestPair[1].id} (Khoảng cách: ${Math.sqrt(minDistanceSq).toFixed(2)} blocks)`);
    } else {
        console.log(`[Farm FindPair] Không tìm thấy cặp nào đủ gần nhau (trong vòng ${MAX_PAIR_DISTANCE} blocks).`);
    }
    return bestPair;
}

// --- Hàm di chuyển và cho ăn một con vật ---
async function feedAnimal(bot, animal, animalNameVi, requiredFoodName) {
    console.log(`[Farm Feed] Bắt đầu di chuyển đến ${animalNameVi} (ID: ${animal.id}) tại ${formatCoords(animal.position)}`);
    try {
        await bot.pathfinder.goto(new GoalNear(animal.position.x, animal.position.y, animal.position.z, BREED_INTERACT_DIST));
        console.log(`[Farm Feed] Đã đến gần ${animalNameVi} (ID: ${animal.id}). Cho ăn bằng ${requiredFoodName}...`);

        // Kiểm tra lại xem có đang cầm đúng thức ăn không (phòng trường hợp bị đổi tay)
        const heldItem = bot.heldItem;
        if (!heldItem || heldItem.name !== requiredFoodName) {
             console.warn(`[Farm Feed] Tay không cầm ${requiredFoodName} trước khi cho ăn (Đang cầm: ${heldItem?.name}). Thử trang bị lại...`);
             const reEquipSuccess = await equipFood(bot, requiredFoodName);
             if (!reEquipSuccess) {
                 throw new Error(`Không thể trang bị lại ${requiredFoodName} để cho ${animalNameVi} ăn.`);
             }
        }

        await bot.activateEntity(animal);
        console.log(`[Farm Feed] Đã thực hiện hành động cho ăn ${animalNameVi} (ID: ${animal.id}). Chờ ${LOVE_MODE_CHECK_DELAY_TICKS} ticks để kiểm tra...`);
        await bot.waitForTicks(LOVE_MODE_CHECK_DELAY_TICKS);

        // --- Xác nhận Love Mode ---
        // Lấy lại entity mới nhất phòng trường hợp metadata thay đổi
        const updatedAnimal = bot.entityMatching(e => e.id === animal.id, true); // Lấy entity gần nhất có ID khớp
        if (!updatedAnimal) {
             console.warn(`[Farm Feed] Không tìm thấy entity ${animalNameVi} (ID: ${animal.id}) sau khi cho ăn để kiểm tra love mode.`);
             // Có thể coi là thất bại hoặc tiếp tục với rủi ro
             // throw new Error(`Không tìm thấy ${animalNameVi} sau khi cho ăn.`);
             return false; // Coi như thất bại nếu không tìm thấy lại
        }

        if (isInLove(updatedAnimal)) {
            console.log(`[Farm Feed] Xác nhận: ${animalNameVi} (ID: ${updatedAnimal.id}) đã vào trạng thái yêu đương!`);
            return true; // Thành công
        } else {
            console.warn(`[Farm Feed] Cảnh báo: ${animalNameVi} (ID: ${updatedAnimal.id}) không vào trạng thái yêu đương sau khi cho ăn! (Metadata[17]: ${updatedAnimal?.metadata?.[17]})`);
            return false; // Thất bại
        }

    } catch (err) {
        console.error(`[Farm Feed] Lỗi khi di chuyển hoặc cho ăn ${animalNameVi} (ID: ${animal.id}):`, err.message);
        // Dừng pathfinder nếu đang chạy
        try { if (bot.pathfinder?.isMoving()) bot.pathfinder.stop(); } catch(e) { /* Bỏ qua lỗi dừng */ }
        throw err; // Ném lại lỗi để hàm gọi xử lý
    }
}


// --- Hàm chính để nhân giống (Đã sửa đổi) ---
async function breedAnimals(bot, username, message, aiModel) {
    console.log(`[Farm] === Bắt đầu yêu cầu nhân giống từ ${username}: "${message}" ===`);

    // --- Bước 1: Kiểm tra trạng thái Bot ---
    if (bot.isFinding || bot.isFollowing || bot.isProtecting || bot.isCollecting || bot.isDefending || bot.isBuilding || bot.isFlattening || bot.isStripMining || bot.isHunting || bot.isCleaningInventory || bot.isDepositing) {
        let reason = "làm việc khác";
        // (Thêm logic xác định reason chi tiết nếu muốn)
        bot.chat(`${username}, tôi đang bận ${reason} rồi, không đi nhân giống được!`);
        console.log(`[Farm] Bị chặn do đang bận ${reason}.`);
        return;
    }

    // --- Bước 2: Trích xuất tên động vật ---
    const extractionPrompt = `Từ tin nhắn "${message}", trích xuất tên loại động vật mà người chơi muốn nhân giống (ví dụ: bò, cừu, gà). Chỉ trả về tên động vật (tiếng Việt). Nếu không rõ, trả về "UNKNOWN". Tên:`;
    let animalNameVi;
    try {
        console.log("[Farm Extract] Gửi prompt trích xuất tên động vật...");
        const extractResult = await aiModel.generateContent(extractionPrompt);
        animalNameVi = (await extractResult.response.text()).trim();
        if (!animalNameVi || animalNameVi.toUpperCase() === "UNKNOWN" || animalNameVi.length === 0) {
            throw new Error("AI không trích xuất được tên động vật hợp lệ.");
        }
        console.log(`[Farm Extract] AI trích xuất tên: "${animalNameVi}"`);
    } catch (error) {
        console.error("[Farm Extract] Lỗi trích xuất tên động vật:", error);
        bot.chat(`Xin lỗi ${username}, bạn muốn tôi nhân giống con gì vậy? (Ví dụ: nhân giống bò)`);
        return;
    }

    // --- Bước 3: Dịch tên & Kiểm tra thức ăn ---
    const animalId = translateToEnglishId(animalNameVi);
    if (!animalId) {
        bot.chat(`Xin lỗi ${username}, tôi không biết con "${animalNameVi}" là con gì trong Minecraft.`);
        console.log(`[Farm Validate] Không thể dịch "${animalNameVi}" sang ID.`);
        return;
    }

    const requiredFoodNames = animalFoodMap[animalId];
    if (!requiredFoodNames || (Array.isArray(requiredFoodNames) && requiredFoodNames.length === 0)) {
        bot.chat(`Xin lỗi ${username}, tôi không biết cách nhân giống con "${animalNameVi}" (${animalId}), hoặc nó không thể nhân giống được.`);
        console.log(`[Farm Validate] Không tìm thấy thức ăn cho ${animalId} trong map hoặc không thể nhân giống.`);
        return;
    }
    const foodListStr = Array.isArray(requiredFoodNames) ? requiredFoodNames.join('/') : requiredFoodNames;
    console.log(`[Farm Validate] Động vật: ${animalId} (${animalNameVi}), Thức ăn cần: ${foodListStr}`);

    // --- Bước 4: Kiểm tra dữ liệu Entity ---
    const mcData = require('minecraft-data')(bot.version);
    const animalEntityType = mcData.entitiesByName[animalId];
    if (!animalEntityType) {
         bot.chat(`Xin lỗi ${username}, có lỗi khi lấy thông tin về con "${animalNameVi}" (${animalId}).`);
         console.error(`[Farm Validate] Không tìm thấy entity data cho ${animalId}`);
         return;
    }

    // --- Bước 5: Trang bị thức ăn ---
    const foodItemData = await equipFood(bot, requiredFoodNames);
    if (!foodItemData) {
        bot.chat(`Xin lỗi ${username}, tôi không có ${foodListStr} trong túi đồ để nhân giống ${animalNameVi}.`);
        return;
    }
    const equippedFoodName = foodItemData.name; // Lấy tên chính xác của thức ăn đã trang bị

    // --- Bước 6: Tìm ứng viên ---
    console.log(`[Farm Search] Tìm kiếm các con ${animalId} trưởng thành, sẵn sàng trong bán kính ${BREED_SEARCH_RADIUS} blocks...`);
    console.warn(`[Farm Search] Cảnh báo: Việc kiểm tra tuổi và trạng thái yêu đương dựa vào metadata index (16, 17), có thể không ổn định giữa các phiên bản/server.`);
    const nearbyEntities = bot.entities;
    const candidates = [];
    for (const entityId in nearbyEntities) {
        const entity = nearbyEntities[entityId];
        // Điều kiện: Đúng loại, đủ gần, không phải con non, chưa vào love mode
        if (entity.name === animalId &&
            entity.position.distanceTo(bot.entity.position) <= BREED_SEARCH_RADIUS &&
            entity.metadata && // Đảm bảo có metadata
            !isBaby(entity) && // Kiểm tra không phải con non
            !isInLove(entity) // Kiểm tra chưa vào love mode
           )
        {
             // console.log(`[Farm Search Debug] Found candidate: ${entity.id}, AgeMeta: ${entity.metadata[16]}, LoveMeta: ${entity.metadata[17]}`);
             candidates.push(entity);
        }
    }

    if (candidates.length < 2) {
        bot.chat(`Xin lỗi ${username}, tôi chỉ tìm thấy ${candidates.length} con ${animalNameVi} trưởng thành và sẵn sàng gần đây. Cần ít nhất 2 con.`);
        console.log(`[Farm Search] Tìm thấy ${candidates.length} ứng viên ${animalId}, không đủ.`);
        return;
    }
    console.log(`[Farm Search] Tìm thấy ${candidates.length} ứng viên ${animalId} phù hợp.`);

    // --- Bước 7: Chọn cặp tốt nhất ---
    const bestPair = findBestPair(bot, candidates);
    if (!bestPair) {
        bot.chat(`Xin lỗi ${username}, tôi tìm thấy ${candidates.length} con ${animalNameVi} nhưng không có cặp nào đủ gần nhau (trong vòng ${MAX_PAIR_DISTANCE} blocks).`);
        return;
    }

    const [animal1, animal2] = bestPair;
    bot.chat(`Ok ${username}, tìm thấy một cặp ${animalNameVi} gần nhau (ID: ${animal1.id}, ${animal2.id}). Bắt đầu cho ăn...`);

    // --- Bước 8: Cho ăn và xác nhận ---
    let fed1Success = false;
    let fed2Success = false;
    try {
        // Cho ăn con thứ nhất
        fed1Success = await feedAnimal(bot, animal1, animalNameVi, equippedFoodName);
        if (!fed1Success) {
            bot.chat(`Hmm ${username}, tôi đã thử cho con ${animalNameVi} thứ nhất ăn nhưng nó không vào trạng thái yêu đương.`);
            return; // Dừng nếu con đầu tiên thất bại
        }
        await sleep(500); // Chờ thêm chút trước khi đến con thứ hai

        // Cho ăn con thứ hai
        fed2Success = await feedAnimal(bot, animal2, animalNameVi, equippedFoodName);
        if (!fed2Success) {
            bot.chat(`Hmm ${username}, tôi đã cho con thứ nhất ăn thành công, nhưng con thứ hai lại không vào trạng thái yêu đương.`);
            return; // Dừng nếu con thứ hai thất bại
        }

        // --- Bước 9: Kiểm tra khoảng cách cuối cùng ---
        console.log("[Farm Final Check] Kiểm tra khoảng cách giữa cặp sau khi cho ăn...");
        // Lấy lại vị trí mới nhất của chúng
        const finalAnimal1 = bot.entityMatching(e => e.id === animal1.id, true);
        const finalAnimal2 = bot.entityMatching(e => e.id === animal2.id, true);

        if (finalAnimal1 && finalAnimal2) {
            const finalDistance = finalAnimal1.position.distanceTo(finalAnimal2.position);
            console.log(`[Farm Final Check] Khoảng cách cuối cùng: ${finalDistance.toFixed(2)} blocks.`);
            if (finalDistance <= FINAL_DISTANCE_CHECK) {
                bot.chat(`${username}, đã cho cặp ${animalNameVi} ăn xong và chúng đang ở gần nhau!`);
            } else {
                bot.chat(`${username}, đã cho cặp ${animalNameVi} ăn xong, nhưng chúng có vẻ hơi xa nhau (${finalDistance.toFixed(1)} blocks), hy vọng chúng tìm thấy nhau!`);
            }
        } else {
            console.warn("[Farm Final Check] Không thể tìm thấy lại một hoặc cả hai con vật để kiểm tra khoảng cách cuối cùng.");
            bot.chat(`${username}, đã cho cặp ${animalNameVi} ăn xong!`); // Vẫn thông báo hoàn thành cơ bản
        }

    } catch (err) {
        console.error(`[Farm Breed] Lỗi trong quá trình nhân giống ${animalNameVi}:`, err.message);
        bot.chat(`Ối ${username}, tôi gặp lỗi khi đang cố gắng cho ${animalNameVi} ăn: ${err.message}`);
        // Lỗi đã được xử lý (dừng pathfinder) trong feedAnimal
    } finally {
        console.log(`[Farm] === Kết thúc yêu cầu nhân giống cho ${username} ===`);
        // Cân nhắc bỏ trang bị thức ăn nếu muốn
        // try { await bot.unequip('hand'); } catch(e) {}
    }
}

module.exports = {
    breedAnimals,
};
// --- END OF FILE farm.js ---