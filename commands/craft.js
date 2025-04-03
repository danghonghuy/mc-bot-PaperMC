const { GoalBlock } = require("mineflayer-pathfinder").goals;
const { Vec3 } = require("vec3");
const { translateToEnglishId, formatCoords } = require("../utils");

const CRAFTING_TABLE_ID = 'crafting_table';
const MAX_CRAFT_SEARCH_DIST = 16;

async function findNearbyCraftingTable(bot, mcData) {
    const tableBlockData = mcData.blocksByName[CRAFTING_TABLE_ID];
    if (!tableBlockData) {
        console.error("[Craft FindTable] Không tìm thấy dữ liệu block cho crafting_table trong mcData!");
        return null;
    }
    console.log(`[Craft FindTable] Tìm bàn chế tạo gần đó (ID: ${tableBlockData.id}, Tối đa: ${MAX_CRAFT_SEARCH_DIST} blocks)...`);
    const foundTable = await bot.findBlock({
        matching: tableBlockData.id,
        maxDistance: MAX_CRAFT_SEARCH_DIST,
        count: 1
    });
    if (foundTable) {
        console.log(`[Craft FindTable] Tìm thấy bàn chế tạo tại ${formatCoords(foundTable.position)}`);
    } else {
        console.log("[Craft FindTable] Không tìm thấy bàn chế tạo nào gần đó.");
    }
    return foundTable;
}

async function placeCraftingTable(bot, mcData, username, itemNameVi) {
    console.log("[Craft PlaceTable] Kiểm tra bàn chế tạo trong túi đồ...");
    const tableItem = bot.inventory.findInventoryItem(mcData.blocksByName[CRAFTING_TABLE_ID].id, null);
    if (!tableItem) {
        console.log("[Craft PlaceTable] Không có bàn chế tạo trong túi đồ.");
        bot.chat(`Xin lỗi ${username}, tôi cần bàn chế tạo để làm ${itemNameVi} nhưng không tìm thấy cái nào gần đây và cũng không có trong túi đồ.`);
        return null;
    }

    console.log(`[Craft PlaceTable] Tìm thấy ${tableItem.count} bàn chế tạo trong túi đồ. Sẽ thử đặt xuống.`);
    bot.chat(`${username}, tôi không thấy bàn chế tạo gần đây, nhưng tôi có một cái trong túi. Tôi sẽ thử đặt nó xuống.`);
    try {
        console.log("[Craft PlaceTable] Tìm vị trí đặt bàn chế tạo...");
        const referenceBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0));
        if (!referenceBlock) {
            throw new Error("Không tìm thấy khối nào dưới chân bot để đặt bàn lên.");
        }
        console.log(`[Craft PlaceTable] Khối tham chiếu dưới chân: ${referenceBlock.name} tại ${formatCoords(referenceBlock.position)}`);
        const targetPos = referenceBlock.position.offset(0, 1, 0);
        console.log(`[Craft PlaceTable] Vị trí mục tiêu để đặt: ${formatCoords(targetPos)}`);
        const blockAtTarget = bot.blockAt(targetPos);
        if (blockAtTarget && blockAtTarget.type !== 0) {
            throw new Error(`Vị trí ${formatCoords(targetPos)} đã có khối ${blockAtTarget.name}, không thể đặt.`);
        }
        console.log("[Craft PlaceTable] Vị trí đặt hợp lệ. Bắt đầu trang bị và đặt...");
        await bot.equip(tableItem, 'hand');
        console.log("[Craft PlaceTable] Đã trang bị bàn chế tạo.");
        await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
        console.log("[Craft PlaceTable] Lệnh đặt khối đã gửi. Chờ server xác nhận...");
        await bot.waitForTicks(15);
        console.log("[Craft PlaceTable] Kiểm tra lại khối tại vị trí mục tiêu...");
        let placedTable = bot.blockAt(targetPos);
        if (!placedTable || placedTable.name !== CRAFTING_TABLE_ID) {
            console.warn(`[Craft PlaceTable] Khối tại ${formatCoords(targetPos)} không phải bàn chế tạo (${placedTable?.name}). Thử tìm lại gần đó...`);
            placedTable = await findNearbyCraftingTable(bot, mcData);
            if (!placedTable) {
               throw new Error("Đặt bàn chế tạo nhưng không tìm thấy lại được ngay sau đó.");
            }
            console.log(`[Craft PlaceTable] Tìm thấy lại bàn chế tạo tại ${formatCoords(placedTable.position)} sau khi tìm lần hai.`);
        }
        console.log(`[Craft PlaceTable] Đã đặt và xác nhận bàn chế tạo tại ${formatCoords(placedTable.position)}.`);
        return placedTable;

    } catch(err) {
        console.error(`[Craft PlaceTable] Lỗi khi cố gắng đặt bàn chế tạo:`, err);
        bot.chat(`Xin lỗi ${username}, tôi không đặt được bàn chế tạo xuống. (${err.message})`);
        return null;
    }
}

async function performManualCheck(bot, mcData, recipe, quantity, isPreliminary) {
    const checkType = isPreliminary ? "Sơ bộ" : "Chi tiết";
    console.log(`[Craft ManualCheck - ${checkType}] Bước 6: Kiểm tra thủ công nguyên liệu cần thiết...`);
    if (!recipe) {
        console.error(`[Craft ManualCheck - ${checkType}] Lỗi: Không có công thức hợp lệ để kiểm tra.`);
        return false;
    }
     if (!recipe.result || !recipe.result.count || recipe.result.count <= 0) {
         console.error(`[Craft ManualCheck - ${checkType}] Lỗi: Công thức không có thông tin số lượng kết quả hợp lệ.`);
         return false;
     }

    let craftsNeeded = 1;
    if (!isPreliminary) {
        craftsNeeded = Math.ceil(quantity / recipe.result.count);
        console.log(`[Craft ManualCheck - ${checkType}] Cần ${craftsNeeded} lần craft (mỗi lần tạo ${recipe.result.count}) để có đủ ${quantity} mục tiêu.`);
    } else {
         console.log(`[Craft ManualCheck - ${checkType}] Chỉ kiểm tra đủ nguyên liệu cho 1 lần craft.`);
    }

    const totalNeeded = {};
    let ingredientsSource = recipe.delta;

     if (!ingredientsSource && recipe.inShape) {
         console.log(`[Craft ManualCheck - ${checkType}] Không có delta, thử tính từ inShape...`);
         ingredientsSource = [];
         recipe.inShape.flat().forEach(id => {
             if (id !== null) {
                 const itemInfo = mcData.items[id] || mcData.blocks[id];
                 if (itemInfo) ingredientsSource.push({ id: itemInfo.id, count: -1 });
             }
         });
    } else if (!ingredientsSource && recipe.ingredients) {
         console.log(`[Craft ManualCheck - ${checkType}] Không có delta/inShape, thử tính từ ingredients...`);
         ingredientsSource = [];
         recipe.ingredients.forEach(ingredient => {
             const id = Array.isArray(ingredient) ? ingredient[0] : ingredient;
             if (id !== null) {
                 const itemInfo = mcData.items[id] || mcData.blocks[id];
                 if (itemInfo) ingredientsSource.push({ id: itemInfo.id, count: -1 });
             }
         });
    }

    if (!ingredientsSource || ingredientsSource.length === 0) {
        console.error(`[Craft ManualCheck - ${checkType}] Lỗi: Không thể xác định nguyên liệu từ công thức.`);
        return false;
    }

    console.log(`[Craft ManualCheck - ${checkType}] Phân tích nguyên liệu bị trừ đi:`, ingredientsSource);

    ingredientsSource.forEach(item => {
        if (item.count < 0) {
             const neededPerCraft = -item.count;
             const ingredientId = item.id;
             totalNeeded[ingredientId] = (totalNeeded[ingredientId] || 0) + (neededPerCraft * craftsNeeded);
        }
    });

    console.log(`[Craft ManualCheck - ${checkType}] Tổng nguyên liệu cần:`, totalNeeded);

    if (Object.keys(totalNeeded).length === 0) {
         console.warn(`[Craft ManualCheck - ${checkType}] Không tính được nguyên liệu cần thiết? Coi như đủ.`);
         return true;
    }

    for (const ingredientIdStr in totalNeeded) {
        const ingredientId = parseInt(ingredientIdStr, 10);
        const requiredCount = totalNeeded[ingredientIdStr];
        const availableCount = bot.inventory.count(ingredientId, null);
        const ingredientName = mcData.items[ingredientId]?.name || mcData.blocks[ingredientId]?.name || `ID ${ingredientId}`;
        console.log(`[Craft ManualCheck - ${checkType}]   - Kiểm tra ${ingredientName} (ID ${ingredientId}): Cần ${requiredCount}, Có ${availableCount}`);
        if (availableCount < requiredCount) {
            console.log(`[Craft ManualCheck - ${checkType}]   -> Không đủ ${ingredientName}!`);
            return false;
        }
    }

    console.log(`[Craft ManualCheck - ${checkType}] Kiểm tra thủ công thành công, có vẻ đủ nguyên liệu.`);
    return true;
}


async function craftItem(bot, username, message, aiModel) {
    console.log(`[Craft] === Bắt đầu xử lý yêu cầu chế tạo từ ${username}: "${message}" ===`);

    if (bot.isFinding || bot.isFollowing || bot.isProtecting || bot.isCollecting) {
        let reason = bot.isFinding ? 'tìm đồ' : (bot.isFollowing ? 'đi theo' : (bot.isProtecting ? 'bảo vệ' : 'thu thập'));
        bot.chat(`${username}, tôi đang bận ${reason} rồi, không chế tạo được!`);
        console.log(`[Craft] Bị chặn do đang ${reason}. Yêu cầu bị hủy.`);
        return;
    }

    let itemNameVi = null;
    let quantity = 1;
    try {
        console.log("[Craft] Bước 1: Gửi prompt trích xuất tên và số lượng...");
        const extractionPrompt = `Từ tin nhắn "${message}", trích xuất tên vật phẩm người chơi muốn chế tạo và số lượng. Nếu không nói số lượng, mặc định là 1. Chỉ trả lời bằng định dạng JSON với hai khóa: "itemName" (string, giữ nguyên tiếng Việt nếu có) và "quantity" (number). Ví dụ: "làm 5 cái đuốc" -> {"itemName": "đuốc", "quantity": 5}. JSON:`;
        const extractResult = await aiModel.generateContent(extractionPrompt);
        const jsonResponse = (await extractResult.response.text()).trim();
        console.log("[Craft Debug] Phản hồi JSON thô từ AI:", jsonResponse);
        let parsedData;
         try {
            const jsonMatch = jsonResponse.match(/\{.*\}/s);
            if (jsonMatch && jsonMatch[0]) {
                parsedData = JSON.parse(jsonMatch[0]);
                 console.log("[Craft Debug] Parse JSON thành công:", parsedData);
            } else {
                 console.log("[Craft Debug] Không tìm thấy cấu trúc JSON hợp lệ trong phản hồi AI.");
                 if (!jsonResponse.includes('{') && !jsonResponse.includes(':') && jsonResponse.length > 0) {
                    itemNameVi = jsonResponse.trim(); quantity = 1;
                    console.log(`[Craft Debug] Fallback: Sử dụng toàn bộ phản hồi làm tên="${itemNameVi}", Số lượng=1.`);
                 } else throw new Error("Không tìm thấy JSON hoặc không thể fallback.");
            }
        } catch (parseError) {
             console.error("[Craft] Lỗi parse JSON:", parseError.message, "Response:", jsonResponse);
             throw new Error("Không thể phân tích phản hồi từ AI.");
        }
        if (parsedData) {
            itemNameVi = parsedData.itemName;
            quantity = parseInt(parsedData.quantity, 10);
             if (isNaN(quantity) || quantity <= 0) { quantity = 1; }
        }
        if (!itemNameVi) throw new Error("AI không trích xuất được tên vật phẩm.");
        quantity = Math.max(1, quantity);
        console.log(`[Craft] Bước 1: AI trích xuất: Tên="${itemNameVi}", Số lượng=${quantity}`);
    } catch (error) {
        console.error("[Craft] Lỗi trích xuất từ AI:", error);
        bot.chat(`Xin lỗi ${username}, tôi không hiểu bạn muốn chế tạo gì hoặc số lượng bao nhiêu. (${error.message})`);
        return;
    }

    console.log(`[Craft] Bước 2: Dịch tên vật phẩm "${itemNameVi}" sang ID tiếng Anh...`);
    const itemId = translateToEnglishId(itemNameVi);
    if (!itemId) {
        bot.chat(`Xin lỗi ${username}, tôi không biết "${itemNameVi}" là vật phẩm gì trong Minecraft.`);
        console.log(`[Craft] Không thể dịch "${itemNameVi}" sang ID tiếng Anh. Yêu cầu bị hủy.`);
        return;
    }
    console.log(`[Craft] Bước 2: Đã dịch thành ID: "${itemId}"`);

    console.log(`[Craft] Bước 3: Tải dữ liệu Minecraft (mcData) cho phiên bản ${bot.version}...`);
    const mcData = require('minecraft-data')(bot.version);
    const itemToCraft = mcData.itemsByName[itemId] || mcData.blocksByName[itemId];
    if (!itemToCraft) {
        bot.chat(`Xin lỗi ${username}, tôi không tìm thấy thông tin về "${itemNameVi}" (${itemId}) trong dữ liệu game.`);
        console.error(`[Craft] Không tìm thấy item/block data cho ${itemId} trong mcData v${bot.version}. Yêu cầu bị hủy.`);
        return;
    }
    console.log(`[Craft] Bước 3: Xác nhận mục tiêu chế tạo: ${itemId} (ID: ${itemToCraft.id}), Số lượng: ${quantity}`);

    console.log(`[Craft] Bước 4: Lấy định nghĩa công thức trực tiếp từ mcData...`);
    const knownRecipes = mcData.recipes[itemToCraft.id];
    if (!knownRecipes || knownRecipes.length === 0) {
        bot.chat(`Xin lỗi ${username}, tôi không tìm thấy bất kỳ định nghĩa công thức nào cho ${itemNameVi} trong dữ liệu game.`);
        console.log(`[Craft] mcData không có công thức cho ${itemId}. Yêu cầu bị hủy.`);
        return;
    }
    const firstKnownRecipe = knownRecipes[0];
    console.log(`[Craft Debug] mcData có ${knownRecipes.length} công thức. Sử dụng công thức đầu tiên:`, JSON.stringify(firstKnownRecipe, null, 2));

    console.log(`[Craft Debug - Verify] Giá trị của firstKnownRecipe.requiresTable:`, firstKnownRecipe.requiresTable);
    console.log(`[Craft Debug - Verify] Kiểu dữ liệu của firstKnownRecipe.requiresTable:`, typeof firstKnownRecipe.requiresTable);

    let potentialRequiresTable = firstKnownRecipe.requiresTable;

    const itemsDefinitelyNeedingTable = [
        'pickaxe', 'axe', 'shovel', 'hoe', 'sword',
        'helmet', 'chestplate', 'leggings', 'boots',
        'furnace', 'crafting_table', 'chest', 'barrel', 'smoker', 'blast_furnace',
        'shield', 'bow', 'bed', 'piston', 'sticky_piston', 'dispenser', 'dropper',
        'repeater', 'comparator', 'observer'
    ];
    const needsTableOverride = itemsDefinitelyNeedingTable.some(suffix => itemId.endsWith(suffix));

    if (needsTableOverride && (potentialRequiresTable === undefined || potentialRequiresTable === false)) {
        console.warn(`[Craft Debug - Override] Phát hiện ${itemId} thường cần bàn nhưng mcData báo không cần (hoặc thiếu thông tin). Ép requiresTable = true.`);
        potentialRequiresTable = true;
    } else if (!needsTableOverride && potentialRequiresTable === undefined) {
         console.warn(`[Craft Debug - Override] Phát hiện ${itemId} thường KHÔNG cần bàn và mcData thiếu thông tin. Giả định requiresTable = false.`);
         potentialRequiresTable = false;
    }

    console.log(`[Craft Debug] Sau khi kiểm tra/override, xác định công thức ${potentialRequiresTable ? 'YÊU CẦU' : 'KHÔNG yêu cầu'} bàn chế tạo.`);

    let craftingTable = null;
    let recipes = null;

    if (potentialRequiresTable) {
        console.log("[Craft] Bước 5a: Công thức yêu cầu bàn. Thực hiện kiểm tra nguyên liệu sơ bộ...");
        const preliminaryCheckOK = await performManualCheck(bot, mcData, firstKnownRecipe, 1, true);
        if (!preliminaryCheckOK) {
            bot.chat(`Xin lỗi ${username}, tôi kiểm tra sơ bộ thấy không đủ nguyên liệu cơ bản để chế tạo ${itemNameVi}.`);
            console.log(`[Craft] Chế tạo bị hủy do kiểm tra sơ bộ thấy thiếu nguyên liệu.`);
            return;
        }
        console.log("[Craft] Bước 5a: Kiểm tra sơ bộ OK. Tiếp tục xử lý bàn chế tạo...");

        console.log("[Craft] Bước 5b: Tìm hoặc đặt bàn chế tạo...");
        craftingTable = await findNearbyCraftingTable(bot, mcData);
        if (!craftingTable) {
            craftingTable = await placeCraftingTable(bot, mcData, username, itemNameVi);
        }

        if (!craftingTable) {
            console.log(`[Craft] Không thể tìm hoặc đặt bàn chế tạo. Yêu cầu bị hủy.`);
            return;
        }
        console.log(`[Craft] Bước 5b: Đã có bàn chế tạo tại ${formatCoords(craftingTable.position)}. Gọi recipesFor với tham chiếu bàn...`);
        recipes = bot.recipesFor(itemToCraft.id, craftingTable, 1, craftingTable);

    } else {
        console.log("[Craft] Bước 5: Công thức không cần bàn. Gọi recipesFor không cần tham chiếu bàn...");
        recipes = bot.recipesFor(itemToCraft.id, null, 1, null);
    }

    console.log(`[Craft Debug] Kết quả của bot.recipesFor (sau khi xử lý bàn nếu cần):`, recipes);
    if (!recipes || recipes.length === 0) {
         bot.chat(`Xin lỗi ${username}, tôi không tìm thấy công thức nào phù hợp với nguyên liệu tôi đang có để chế tạo ${itemNameVi} (ngay cả khi đã có bàn chế tạo nếu cần).`);
         console.log(`[Craft] bot.recipesFor trả về mảng rỗng mặc dù đã xử lý bàn chế tạo (nếu cần). Có thể do thiếu nguyên liệu HOẶC lỗi recipesFor vẫn tồn tại. Yêu cầu bị hủy.`);
         return;
    }
    console.log(`[Craft] Bước 5: Tìm thấy ${recipes.length} công thức khả thi từ bot.recipesFor.`);

    const recipe = recipes[0];
    console.log("[Craft Debug] Công thức cuối cùng được chọn từ recipesFor:", JSON.stringify(recipe, null, 2));

    const detailedCheckOK = await performManualCheck(bot, mcData, recipe, quantity, false);
    if (!detailedCheckOK) {
        bot.chat(`Xin lỗi ${username}, tôi kiểm tra lại thì thấy không đủ nguyên liệu để chế tạo ${quantity} ${itemNameVi}.`);
        console.log(`[Craft] Chế tạo bị hủy do kiểm tra chi tiết thấy thiếu nguyên liệu cho ${quantity} ${itemId}.`);
        return;
    }

    console.log(`[Craft] Bước 8: Bắt đầu thực hiện chế tạo ${quantity} ${itemId}...`);
    bot.chat(`Ok ${username}, bắt đầu chế tạo ${quantity} ${itemNameVi}...`);
    let itemBefore = 0;
    try {
        const tableArg = potentialRequiresTable ? craftingTable : null;
        itemBefore = bot.inventory.count(itemToCraft.id, null);
        console.log(`[Craft Debug] Số lượng ${itemId} trước khi craft: ${itemBefore}`);

        await bot.craft(recipe, quantity, tableArg);

        console.log(`[Craft] Yêu cầu chế tạo ${quantity} ${itemId} đã gửi. Chờ ${15} ticks để cập nhật kho đồ...`);
        await bot.waitForTicks(15);

        const itemAfter = bot.inventory.count(itemToCraft.id, null);
        const craftedCount = itemAfter - itemBefore;
        console.log(`[Craft Debug] Số lượng ${itemId} sau khi craft và chờ: ${itemAfter}`);

        if (craftedCount > 0) {
            console.log(`[Craft] Bước 8: Kho đồ đã cập nhật. Chế tạo/nhận thành công ~${craftedCount} ${itemId}. (Tổng cộng: ${itemAfter})`);
            bot.chat(`${username}, tôi đã chế tạo xong ${itemNameVi}! (Hiện có ${itemAfter} cái)`);
        } else if (itemAfter >= quantity && itemBefore < quantity) {
             console.log(`[Craft] Bước 8: Kho đồ đã cập nhật. Đã có đủ ${itemAfter} ${itemId}.`);
             bot.chat(`${username}, tôi đã chế tạo xong ${itemNameVi}! (Hiện có ${itemAfter} cái)`);
        } else if (itemAfter === itemBefore && itemAfter > 0) {
             console.warn(`[Craft] Bước 8: Cảnh báo: bot.craft() hoàn thành nhưng số lượng ${itemId} không đổi (${itemAfter}).`);
             bot.chat(`${username}, tôi đã thử chế tạo ${itemNameVi}, nhưng số lượng không thay đổi. (Hiện có ${itemAfter} cái)`);
        } else {
            console.warn(`[Craft] Bước 8: Cảnh báo: bot.craft() hoàn thành cho ${itemId} nhưng số lượng không tăng (Trước: ${itemBefore}, Sau: ${itemAfter}).`);
            bot.chat(`Hmm ${username}, tôi đã thử chế tạo ${itemNameVi}, nhưng không chắc nó đã vào túi đồ chưa.`);
        }

    } catch (err) {
        console.error(`[Craft] Lỗi nghiêm trọng trong quá trình gọi bot.craft cho ${itemId}:`, err);
        bot.chat(`Xin lỗi ${username}, tôi gặp lỗi khi đang chế tạo ${itemNameVi}.`);
        if (err.message) {
            console.error(`[Craft] Chi tiết lỗi: ${err.message}`);
            if (err.message.toLowerCase().includes('missing requirement')) {
                 bot.chat(`(Lỗi: Hình như bị thiếu nguyên liệu giữa chừng.)`);
                 console.log(`[Craft Debug] Lỗi "missing requirement" xảy ra mặc dù đã kiểm tra thủ công.`);
            } else if (err.message.toLowerCase().includes('no space')) {
                 bot.chat(`(Lỗi: Túi đồ của tôi đầy mất rồi.)`);
            } else if (err.message.toLowerCase().includes('pathfinding') || err.message.toLowerCase().includes('timeout')) {
                 bot.chat(`(Lỗi: Tôi gặp vấn đề khi di chuyển đến bàn chế tạo.)`);
            } else {
                 bot.chat(`(Chi tiết lỗi: ${err.message})`);
            }
        }
        console.log("[Craft Debug] Dừng pathfinder (nếu đang chạy) do lỗi chế tạo...");
        try {
            if (bot.pathfinder && bot.pathfinder.isMoving()) {
                bot.pathfinder.stop();
                console.log("[Craft Debug] Pathfinder đã dừng.");
            }
        } catch(e) {
            console.warn("[Craft Debug] Lỗi khi cố gắng dừng pathfinder:", e.message);
        }
    } finally {
         console.log(`[Craft] === Kết thúc xử lý yêu cầu chế tạo cho ${username}: "${message}" ===`);
    }
}

module.exports = {
    craftItem,
};