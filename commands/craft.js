const { GoalBlock, GoalNear } = require("mineflayer-pathfinder").goals; // Thêm GoalNear
const { Vec3 } = require("vec3");
const { translateToEnglishId, formatCoords } = require("../utils"); // Đảm bảo đường dẫn này đúng

const CRAFTING_TABLE_ID_NAME = 'crafting_table';
const MAX_CRAFT_SEARCH_DIST = 32; // Tăng khoảng cách tìm kiếm
const PLANK_TAG = 'minecraft:planks'; // Sử dụng tag nếu mcData hỗ trợ, nếu không cần điều chỉnh

// --- Hàm tìm bàn chế tạo gần đó ---
async function findNearbyCraftingTable(bot, mcData) {
    const tableBlockData = mcData.blocksByName[CRAFTING_TABLE_ID_NAME];
    if (!tableBlockData) {
        console.error("[Craft FindTable] Không tìm thấy dữ liệu block cho crafting_table!");
        return null;
    }
    console.log(`[Craft FindTable] Tìm bàn chế tạo gần đó (ID: ${tableBlockData.id}, Tối đa: ${MAX_CRAFT_SEARCH_DIST} blocks)...`);
    try {
        const foundTables = await bot.findBlocks({
            matching: tableBlockData.id,
            maxDistance: MAX_CRAFT_SEARCH_DIST,
            count: 5 // Tìm nhiều hơn 1 để có thể chọn cái gần nhất
        });

        if (foundTables.length > 0) {
            // Sắp xếp theo khoảng cách từ bot
            foundTables.sort((a, b) => bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b));
            const closestTablePos = foundTables[0];
            const tableBlock = bot.blockAt(closestTablePos); // Lấy đối tượng block đầy đủ
            if (tableBlock) {
                console.log(`[Craft FindTable] Tìm thấy bàn chế tạo gần nhất tại ${formatCoords(tableBlock.position)}`);
                return tableBlock;
            } else {
                console.warn(`[Craft FindTable] Tìm thấy vị trí ${formatCoords(closestTablePos)} nhưng không lấy được block?`);
                return null;
            }
        } else {
            console.log("[Craft FindTable] Không tìm thấy bàn chế tạo nào gần đó.");
            return null;
        }
    } catch (err) {
        console.error("[Craft FindTable] Lỗi khi tìm kiếm block:", err);
        return null;
    }
}

// --- Hàm di chuyển đến gần block ---
async function gotoBlock(bot, targetBlock, reach = 2.5) {
    if (!targetBlock) return false;
    const goal = new GoalNear(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z, reach);
    console.log(`[Craft Goto] Bắt đầu di chuyển đến gần ${targetBlock.name} tại ${formatCoords(targetBlock.position)}...`);
    try {
        await bot.pathfinder.goto(goal);
        console.log(`[Craft Goto] Đã đến gần ${targetBlock.name}.`);
        return true;
    } catch (err) {
        console.error(`[Craft Goto] Lỗi khi di chuyển đến ${targetBlock.name}:`, err.message);
        // Không chat ở đây, để hàm gọi xử lý ngữ cảnh
        // bot.chat(`Tôi không thể đi đến bàn chế tạo tại ${formatCoords(targetBlock.position)}.`);
        return false;
    }
}

// --- Hàm kiểm tra và chế tạo BCT nếu cần ---
async function ensureCraftingTableInInventory(bot, mcData, username, itemNameVi) {
    const tableItemData = mcData.itemsByName[CRAFTING_TABLE_ID_NAME];
    if (!tableItemData) {
        console.error("[Craft EnsureTable] Không tìm thấy dữ liệu item cho crafting_table!");
        bot.chat(`Lỗi dữ liệu game, không tìm thấy thông tin bàn chế tạo.`);
        return false;
    }
    const tableItemId = tableItemData.id;
    console.log(`[Craft EnsureTable] Kiểm tra BCT (ID: ${tableItemId}) trong túi đồ...`);

    // Debug inventory nếu cần
    // console.log(`[Craft Debug] Tìm kiếm item ID: ${tableItemId}`);
    // console.log("[Craft Debug] Inventory Items:", bot.inventory.items().map(i => `${i.name} (ID: ${i.type}, Count: ${i.count})`).join(', '));

    let tableItem = bot.inventory.findInventoryItem(tableItemId, null);

    if (tableItem && tableItem.count > 0) {
        console.log(`[Craft EnsureTable] Tìm thấy ${tableItem.count} BCT trong túi đồ.`);
        return true; // Đã có sẵn
    }

    console.log("[Craft EnsureTable] Không có BCT trong túi đồ. Thử chế tạo...");
    bot.chat(`${username}, tôi không có bàn chế tạo, để tôi thử làm một cái...`);

    // Kiểm tra nguyên liệu: 4 planks
    const plankItems = mcData.itemsArray.filter(item => item.name.endsWith('_planks'));
    let totalPlanks = 0;
    for (const plank of plankItems) {
        totalPlanks += bot.inventory.count(plank.id, null);
    }
    console.log(`[Craft EnsureTable] Kiểm tra gỗ ván (planks): Có tổng cộng ${totalPlanks}`);

    if (totalPlanks < 4) {
        console.log("[Craft EnsureTable] Không đủ gỗ ván để chế tạo BCT.");
        bot.chat(`Tôi không có đủ gỗ ván (cần 4) để làm bàn chế tạo cho ${itemNameVi}.`);
        return false;
    }

    // Tìm công thức BCT (không cần bàn)
    const bctRecipes = bot.recipesFor(tableItemId, null, 1, null);
    if (!bctRecipes || bctRecipes.length === 0) {
        console.error("[Craft EnsureTable] Không tìm thấy công thức chế tạo BCT trong bot.recipesFor!");
        bot.chat(`Lạ thật, tôi không biết cách chế tạo bàn chế tạo?`);
        return false;
    }
    const bctRecipe = bctRecipes[0];
    console.log("[Craft EnsureTable] Tìm thấy công thức BCT. Bắt đầu chế tạo...");

    try {
        await bot.craft(bctRecipe, 1, null); // Craft 1 lần, không cần bàn
        await bot.waitForTicks(10); // Chờ inventory cập nhật
        tableItem = bot.inventory.findInventoryItem(tableItemId, null); // Kiểm tra lại
        if (tableItem && tableItem.count > 0) {
            console.log("[Craft EnsureTable] Chế tạo BCT thành công!");
            bot.chat("Tôi đã làm xong bàn chế tạo!");
            return true;
        } else {
            console.error("[Craft EnsureTable] Chế tạo BCT nhưng không thấy trong túi đồ sau đó?");
            bot.chat("Tôi đã thử làm bàn chế tạo nhưng có lỗi gì đó.");
            return false;
        }
    } catch (err) {
        console.error("[Craft EnsureTable] Lỗi khi chế tạo BCT:", err);
        bot.chat(`Tôi gặp lỗi khi cố chế tạo bàn chế tạo: ${err.message}`);
        return false;
    }
}

// --- Hàm đặt BCT (Cải tiến tìm vị trí) ---
async function placeCraftingTable(bot, mcData, username, itemNameVi) {
    // Bước 1: Đảm bảo có BCT trong túi đồ (tự chế tạo nếu cần)
    const hasTable = await ensureCraftingTableInInventory(bot, mcData, username, itemNameVi);
    if (!hasTable) {
        return null; // Không có hoặc không chế tạo được BCT
    }

    const tableItemData = mcData.itemsByName[CRAFTING_TABLE_ID_NAME];
    const tableItem = bot.inventory.findInventoryItem(tableItemData.id, null);
    if (!tableItem) {
         console.error("[Craft PlaceTable] Lỗi logic: Đã đảm bảo có BCT nhưng lại không tìm thấy?");
         bot.chat("Có lỗi xảy ra, tôi không tìm thấy bàn chế tạo vừa rồi.");
         return null;
    }

    console.log(`[Craft PlaceTable] Tìm vị trí thích hợp để đặt BCT...`);
    bot.chat(`${username}, tôi sẽ tìm chỗ để đặt bàn chế tạo xuống...`);

    let placedTable = null;
    const maxPlacementSearchRadius = 3; // Tìm trong bán kính 3 block ngang
    const offsets = [];
    // Tạo danh sách các offset ưu tiên gần bot trước
    offsets.push({dx: 0, dz: 0}); // Ngay dưới chân
    for (let r = 1; r <= maxPlacementSearchRadius; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                 if (Math.abs(dx) === r || Math.abs(dz) === r) { // Chỉ lấy các điểm ở rìa của hình vuông
                    offsets.push({dx, dz});
                 }
            }
        }
    }
    // console.log("[Craft PlaceTable] Các offset sẽ thử:", offsets);

    for (const offset of offsets) {
        const checkPos = bot.entity.position.floored().offset(offset.dx, 0, offset.dz);
        const refPos = checkPos.offset(0, -1, 0); // Vị trí khối bên dưới
        const targetPos = checkPos; // Vị trí muốn đặt BCT (ngang tầm chân bot)

        const referenceBlock = bot.blockAt(refPos);
        const targetBlock = bot.blockAt(targetPos);

        // console.log(`[Craft PlaceTable] Thử vị trí: Target=${formatCoords(targetPos)}, Ref=${formatCoords(refPos)}`);

        if (referenceBlock && referenceBlock.boundingBox === 'block' && // Khối bên dưới phải vững chắc
            targetBlock && targetBlock.type === 0 && // Vị trí đặt phải là không khí
            bot.entity.position.distanceTo(targetPos.offset(0.5, 0.5, 0.5)) < 4.5) { // Bot phải với tới được

            console.log(`[Craft PlaceTable] Tìm thấy vị trí hợp lệ: Đặt tại ${formatCoords(targetPos)} lên trên ${referenceBlock.name} tại ${formatCoords(refPos)}`);
            try {
                await bot.equip(tableItem, 'hand');
                console.log("[Craft PlaceTable] Đã trang bị BCT.");
                // Vector từ referenceBlock đến targetPos là (0, 1, 0)
                await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
                console.log("[Craft PlaceTable] Lệnh đặt khối đã gửi. Chờ xác nhận...");
                await bot.waitForTicks(15); // Chờ server xử lý

                const verifyBlock = bot.blockAt(targetPos);
                if (verifyBlock && verifyBlock.name === CRAFTING_TABLE_ID_NAME) {
                    console.log(`[Craft PlaceTable] Đặt và xác nhận BCT thành công tại ${formatCoords(targetPos)}.`);
                    placedTable = verifyBlock;
                    break; // Thoát vòng lặp khi đặt thành công
                } else {
                    console.warn(`[Craft PlaceTable] Đã đặt nhưng không xác nhận được BCT tại ${formatCoords(targetPos)} (Thấy: ${verifyBlock?.name}). Thử vị trí khác...`);
                }
            } catch (err) {
                console.error(`[Craft PlaceTable] Lỗi khi cố đặt BCT tại ${formatCoords(targetPos)}:`, err.message);
                // Không chat lỗi ở đây vội, thử vị trí khác
            }
        }
    } // Kết thúc vòng lặp tìm vị trí

    if (placedTable) {
        bot.chat(`Tôi đã đặt bàn chế tạo tại ${formatCoords(placedTable.position)}.`);
        return placedTable;
    } else {
        console.error("[Craft PlaceTable] Không tìm được vị trí phù hợp nào để đặt BCT.");
        bot.chat(`Xin lỗi ${username}, tôi không tìm được chỗ nào tốt để đặt bàn chế tạo xuống.`);
        return null;
    }
}

// --- Hàm kiểm tra nguyên liệu thủ công ---
async function performManualCheck(bot, mcData, recipe, quantity, isPreliminary) {
    const checkType = isPreliminary ? "Sơ bộ" : "Chi tiết";
    console.log(`[Craft ManualCheck - ${checkType}] Kiểm tra thủ công nguyên liệu...`);
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
    let ingredientsSource = recipe.delta; // Ưu tiên delta

     // Fallback nếu không có delta
     if (!ingredientsSource || ingredientsSource.length === 0) {
        console.log(`[Craft ManualCheck - ${checkType}] Không có delta, thử tính từ ingredients/inShape...`);
        ingredientsSource = [];
        const source = recipe.ingredients || (recipe.inShape ? recipe.inShape.flat() : null);

        if (source) {
            source.forEach(ingredient => {
                let id = null;
                let count = 1; // Mặc định cần 1

                if (ingredient === null || ingredient === -1) return; // Bỏ qua ô trống

                if (typeof ingredient === 'object' && ingredient !== null && !Array.isArray(ingredient)) {
                    // Dạng { id: X, count: Y } hoặc { matching: [id1, id2] }
                    if (ingredient.id !== undefined && ingredient.id !== -1) {
                        id = ingredient.id;
                        count = ingredient.count || 1;
                    } else if (ingredient.matching && ingredient.matching.length > 0) {
                        id = ingredient.matching[0]; // Lấy ID đầu tiên trong danh sách thay thế
                        count = ingredient.count || 1;
                    }
                } else if (typeof ingredient === 'number') {
                    // Dạng số ID
                    id = ingredient;
                } else if (Array.isArray(ingredient) && ingredient.length > 0) {
                    // Dạng mảng [id1, id2] hoặc [[id]]
                    const firstItem = ingredient.flat()[0];
                    if (typeof firstItem === 'number' && firstItem !== -1) {
                        id = firstItem;
                    }
                }

                if (id !== null) {
                    ingredientsSource.push({ id: id, count: -count }); // Lưu dưới dạng delta (số âm)
                }
            });
            console.log(`[Craft ManualCheck - ${checkType}] Nguyên liệu tính từ ingredients/inShape:`, ingredientsSource);
        }
    }


    if (!ingredientsSource || ingredientsSource.length === 0) {
        console.error(`[Craft ManualCheck - ${checkType}] Lỗi: Không thể xác định nguyên liệu từ công thức.`);
        return false;
    }

    console.log(`[Craft ManualCheck - ${checkType}] Phân tích nguyên liệu bị trừ đi:`, ingredientsSource);

    ingredientsSource.forEach(item => {
        if (item.count < 0) { // Chỉ xem xét các item bị trừ đi (nguyên liệu)
             const neededPerCraft = -item.count;
             const ingredientId = item.id;
             // Xử lý trường hợp ID là -1 (không cần thiết?) hoặc null/undefined
             if (ingredientId !== null && ingredientId !== undefined && ingredientId !== -1) {
                 totalNeeded[ingredientId] = (totalNeeded[ingredientId] || 0) + (neededPerCraft * craftsNeeded);
             }
        }
    });

    console.log(`[Craft ManualCheck - ${checkType}] Tổng nguyên liệu cần:`, totalNeeded);

    if (Object.keys(totalNeeded).length === 0 && ingredientsSource.some(i => i.count < 0 && i.id !== -1)) {
         console.warn(`[Craft ManualCheck - ${checkType}] Tính toán nguyên liệu cần thiết ra rỗng dù có vẻ cần? Kiểm tra lại logic phân tích công thức.`);
         // Tạm thời coi như đủ để tránh chặn sai, nhưng cần debug
         return true;
    }
     if (Object.keys(totalNeeded).length === 0) {
         console.log(`[Craft ManualCheck - ${checkType}] Công thức có vẻ không cần nguyên liệu? Coi như đủ.`);
         return true;
     }

    for (const ingredientIdStr in totalNeeded) {
        const ingredientId = parseInt(ingredientIdStr, 10);
        const requiredCount = totalNeeded[ingredientIdStr];
        // *** QUAN TRỌNG: Kiểm tra với metadata=null để đếm tất cả các biến thể ***
        const availableCount = bot.inventory.count(ingredientId, null);
        const ingredientData = mcData.items[ingredientId] || mcData.blocks[ingredientId];
        const ingredientName = ingredientData?.displayName || ingredientData?.name || `ID ${ingredientId}`;
        console.log(`[Craft ManualCheck - ${checkType}]   - Kiểm tra ${ingredientName} (ID ${ingredientId}): Cần ${requiredCount}, Có ${availableCount}`);
        if (availableCount < requiredCount) {
            console.log(`[Craft ManualCheck - ${checkType}]   -> Không đủ ${ingredientName}!`);
            return false; // Thiếu nguyên liệu
        }
    }

    console.log(`[Craft ManualCheck - ${checkType}] Kiểm tra thủ công thành công, có vẻ đủ nguyên liệu.`);
    return true;
}


// --- Hàm craftItem chính (Cập nhật) ---
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
                 // Fallback đơn giản hơn: tìm số đầu tiên làm số lượng, phần còn lại làm tên
                 const numMatch = message.match(/\d+/);
                 const potentialQuantity = numMatch ? parseInt(numMatch[0], 10) : 1;
                 const potentialName = message.replace(/\d+/, '').replace(/làm|chế tạo|cho|cái/gi, '').trim(); // Xóa số và từ khóa phổ biến
                 if (potentialName) {
                     itemNameVi = potentialName;
                     quantity = potentialQuantity > 0 ? potentialQuantity : 1;
                     console.log(`[Craft Debug] Fallback: Sử dụng tên="${itemNameVi}", Số lượng=${quantity}.`);
                 } else {
                     throw new Error("Không thể fallback để trích xuất tên vật phẩm.");
                 }
            }
        } catch (parseError) {
             console.error("[Craft] Lỗi parse JSON hoặc fallback:", parseError.message, "Response:", jsonResponse);
             throw new Error("Không thể phân tích phản hồi từ AI.");
        }
        if (parsedData) {
            itemNameVi = parsedData.itemName;
            quantity = parseInt(parsedData.quantity, 10);
             if (isNaN(quantity) || quantity <= 0) { quantity = 1; }
        }
        if (!itemNameVi) throw new Error("AI không trích xuất được tên vật phẩm.");
        quantity = Math.max(1, quantity);
        console.log(`[Craft] Bước 1: AI trích xuất/Fallback: Tên="${itemNameVi}", Số lượng=${quantity}`);
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
    if (!mcData) {
        console.error(`[Craft] Không thể tải mcData cho phiên bản ${bot.version}!`);
        bot.chat(`Xin lỗi ${username}, tôi gặp sự cố khi tải dữ liệu game.`);
        return;
    }
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
        // Kiểm tra xem có phải là item không thể craft (ví dụ: bedrock)
        if (itemToCraft.craftingDifficulty === undefined) { // Heuristic: items không craft được thường thiếu trường này
             bot.chat(`Xin lỗi ${username}, hình như ${itemNameVi} không thể chế tạo được.`);
        } else {
             bot.chat(`Xin lỗi ${username}, tôi không tìm thấy bất kỳ định nghĩa công thức nào cho ${itemNameVi} trong dữ liệu game.`);
        }
        console.log(`[Craft] mcData không có công thức cho ${itemId}. Yêu cầu bị hủy.`);
        return;
    }
    const firstKnownRecipe = knownRecipes[0]; // Dùng để kiểm tra requiresTable ban đầu
    console.log(`[Craft Debug] mcData có ${knownRecipes.length} công thức. Sử dụng công thức đầu tiên để kiểm tra bàn:`, JSON.stringify(firstKnownRecipe, null, 2));

    // Xác định có cần bàn chế tạo không (potentialRequiresTable)
    console.log(`[Craft Debug - Verify] Giá trị của firstKnownRecipe.requiresTable:`, firstKnownRecipe.requiresTable);
    let potentialRequiresTable = firstKnownRecipe.requiresTable;

    const itemsDefinitelyNeedingTable = [
        'pickaxe', 'axe', 'shovel', 'hoe', 'sword',
        'helmet', 'chestplate', 'leggings', 'boots',
        'furnace', 'crafting_table', 'chest', 'barrel', 'smoker', 'blast_furnace',
        'shield', 'bow', 'bed', 'piston', 'sticky_piston', 'dispenser', 'dropper',
        'repeater', 'comparator', 'observer', 'tnt', 'bookshelf', 'jukebox', 'note_block',
        'cake', 'cookie', 'pumpkin_pie', 'beacon', 'enchanting_table', 'ender_chest',
        'anvil', 'brewing_stand', 'cauldron', 'item_frame', 'flower_pot', 'armor_stand',
        'banner', 'shulker_box', 'concrete', 'glazed_terracotta', 'map' // Thêm các item phổ biến khác
    ];
    // Kiểm tra cả tên ID và tên hiển thị (nếu có) để tăng độ chính xác
    const itemNameLower = itemId.toLowerCase();
    const itemDisplayNameLower = itemToCraft.displayName?.toLowerCase() || '';
    const needsTableOverride = itemsDefinitelyNeedingTable.some(suffix =>
        itemNameLower.endsWith(suffix) || itemDisplayNameLower.endsWith(suffix) || itemNameLower.startsWith(suffix) // Bắt cả tiền tố như 'iron_pickaxe'
    );

    // Logic override dựa trên danh sách và thông tin từ mcData
    if (needsTableOverride && (potentialRequiresTable === undefined || potentialRequiresTable === false)) {
        console.warn(`[Craft Debug - Override] Phát hiện ${itemId} thường cần bàn nhưng mcData báo không cần/thiếu thông tin. Ép requiresTable = true.`);
        potentialRequiresTable = true;
    } else if (!needsTableOverride && potentialRequiresTable === undefined) {
         // Nếu không nằm trong danh sách cần bàn và mcData không nói gì, giả định không cần
         console.warn(`[Craft Debug - Override] Phát hiện ${itemId} thường KHÔNG cần bàn và mcData thiếu thông tin. Giả định requiresTable = false.`);
         potentialRequiresTable = false;
    } else if (potentialRequiresTable === undefined) {
        // Trường hợp không chắc chắn và mcData không nói gì -> Mặc định là không cần để tránh lỗi không cần thiết
        console.warn(`[Craft Debug - Override] Không chắc ${itemId} có cần bàn không và mcData thiếu thông tin. Mặc định requiresTable = false.`);
        potentialRequiresTable = false;
    }

    console.log(`[Craft Debug] Sau khi kiểm tra/override, xác định công thức ${potentialRequiresTable ? 'YÊU CẦU' : 'KHÔNG yêu cầu'} bàn chế tạo.`);

    // --- Logic xử lý bàn chế tạo và lấy công thức ---
    let craftingTableBlock = null; // Block bàn chế tạo sẽ dùng (nếu cần)
    let recipeToUse = null; // Công thức cuối cùng sẽ dùng

    // Bước 5: Kiểm tra nguyên liệu sơ bộ (cho 1 lần craft) TRƯỚC KHI tìm/đặt bàn
    console.log("[Craft] Bước 5: Kiểm tra nguyên liệu sơ bộ...");
    // Sử dụng công thức đầu tiên từ mcData cho kiểm tra sơ bộ này
    const preliminaryCheckOK = await performManualCheck(bot, mcData, firstKnownRecipe, 1, true);
    if (!preliminaryCheckOK) {
        bot.chat(`Xin lỗi ${username}, tôi kiểm tra sơ bộ thấy không đủ nguyên liệu cơ bản để chế tạo ${itemNameVi}.`);
        console.log(`[Craft] Chế tạo bị hủy do kiểm tra sơ bộ thấy thiếu nguyên liệu.`);
        return;
    }
    console.log("[Craft] Bước 5: Kiểm tra sơ bộ OK.");

    // Bước 6: Xử lý bàn chế tạo (nếu cần) và lấy công thức từ bot.recipesFor
    if (potentialRequiresTable) {
        console.log("[Craft] Bước 6a: Công thức yêu cầu bàn. Tìm bàn gần đó...");
        craftingTableBlock = await findNearbyCraftingTable(bot, mcData);

        if (craftingTableBlock) {
            console.log("[Craft] Bước 6a: Tìm thấy bàn. Di chuyển đến đó...");
            const reached = await gotoBlock(bot, craftingTableBlock); // Di chuyển tường minh
            if (!reached) {
                console.log("[Craft] Không thể đến bàn chế tạo đã tìm thấy. Thử đặt bàn mới...");
                bot.chat("Tôi không đến được bàn chế tạo kia, để tôi thử đặt cái mới.");
                craftingTableBlock = await placeCraftingTable(bot, mcData, username, itemNameVi); // Thử đặt nếu không đến được
            }
        } else {
            console.log("[Craft] Bước 6a: Không tìm thấy bàn gần đó. Thử đặt bàn mới...");
            craftingTableBlock = await placeCraftingTable(bot, mcData, username, itemNameVi); // Đặt bàn (hàm này đã bao gồm tự chế tạo nếu cần)
        }

        if (!craftingTableBlock) {
            console.log(`[Craft] Không thể cung cấp bàn chế tạo (tìm, đến hoặc đặt). Yêu cầu bị hủy.`);
            // Chat lỗi đã được thực hiện trong các hàm con
            return;
        }
        console.log(`[Craft] Bước 6a: Đã có bàn chế tạo tại ${formatCoords(craftingTableBlock.position)}. Lấy công thức khả thi...`);
        // Lấy công thức VỚI bàn chế tạo
        const recipes = bot.recipesFor(itemToCraft.id, craftingTableBlock, 1, craftingTableBlock);
        if (recipes && recipes.length > 0) {
            recipeToUse = recipes[0]; // Lấy công thức đầu tiên bot tìm thấy là khả thi
        }

    } else {
        console.log("[Craft] Bước 6b: Công thức không cần bàn. Lấy công thức khả thi...");
        // Lấy công thức KHÔNG cần bàn chế tạo
        const recipes = bot.recipesFor(itemToCraft.id, null, 1, null);
         if (recipes && recipes.length > 0) {
            recipeToUse = recipes[0];
        }
    }

    // Bước 7: Kiểm tra lại công thức và nguyên liệu chi tiết
    if (!recipeToUse) {
         bot.chat(`Xin lỗi ${username}, tôi không tìm thấy công thức nào phù hợp với nguyên liệu tôi đang có để chế tạo ${itemNameVi}${potentialRequiresTable ? ' (dùng bàn chế tạo)' : ''}.`);
         console.log(`[Craft] bot.recipesFor trả về rỗng hoặc không tìm thấy công thức phù hợp. Yêu cầu bị hủy.`);
         return;
    }
    console.log(`[Craft] Bước 7: Tìm thấy công thức khả thi từ bot.recipesFor. Kiểm tra nguyên liệu chi tiết...`);
    console.log("[Craft Debug] Công thức cuối cùng được chọn:", JSON.stringify(recipeToUse, null, 2));

    // Tính số lần craft cần thiết
    if (!recipeToUse.result || !recipeToUse.result.count || recipeToUse.result.count <= 0) {
         console.error("[Craft] Lỗi: Công thức được chọn không có thông tin số lượng kết quả hợp lệ.");
         bot.chat(`Xin lỗi ${username}, có lỗi với công thức của ${itemNameVi}.`);
         return;
    }
    const craftsNeeded = Math.ceil(quantity / recipeToUse.result.count);
    console.log(`[Craft Debug] Cần ${craftsNeeded} lần craft để có ${quantity} ${itemId} (mỗi lần ra ${recipeToUse.result.count})`);

    // Kiểm tra chi tiết với số lượng thực tế cần craft (dùng công thức recipeToUse)
    const detailedCheckOK = await performManualCheck(bot, mcData, recipeToUse, quantity, false);
    if (!detailedCheckOK) {
        bot.chat(`Xin lỗi ${username}, tôi kiểm tra lại thì thấy không đủ nguyên liệu để chế tạo ${quantity} ${itemNameVi}.`);
        console.log(`[Craft] Chế tạo bị hủy do kiểm tra chi tiết thấy thiếu nguyên liệu cho ${quantity} ${itemId}.`);
        return;
    }
    console.log(`[Craft] Bước 7: Kiểm tra nguyên liệu chi tiết OK.`);


    // Bước 8: Thực hiện chế tạo
    console.log(`[Craft] Bước 8: Bắt đầu thực hiện ${craftsNeeded} lần chế tạo ${itemId}...`);
    bot.chat(`Ok ${username}, bắt đầu chế tạo ${quantity} ${itemNameVi}...`);
    let itemBefore = bot.inventory.count(itemToCraft.id, null);
    try {
        // Gọi bot.craft với số lần craft (craftsNeeded) và bàn (nếu cần)
        await bot.craft(recipeToUse, craftsNeeded, craftingTableBlock); // Sử dụng craftsNeeded

        console.log(`[Craft] Yêu cầu ${craftsNeeded} lần chế tạo ${itemId} đã gửi. Chờ ${15 + craftsNeeded * 2} ticks...`); // Tăng thời gian chờ nếu craft nhiều lần
        await bot.waitForTicks(15 + craftsNeeded * 2); // Chờ lâu hơn một chút để inventory chắc chắn cập nhật

        const itemAfter = bot.inventory.count(itemToCraft.id, null);
        const craftedCount = itemAfter - itemBefore;
        console.log(`[Craft Debug] Số lượng ${itemId} sau khi craft: ${itemAfter} (Trước: ${itemBefore})`);

        // Kiểm tra kết quả
        if (itemAfter >= itemBefore + (craftsNeeded * recipeToUse.result.count)) { // Kiểm tra số lượng lý thuyết
             console.log(`[Craft] Bước 8: Chế tạo thành công! Số lượng ${itemId} hiện tại: ${itemAfter}`);
             bot.chat(`${username}, tôi đã chế tạo xong ${itemNameVi}! (Hiện có ${itemAfter} cái)`);
        } else if (craftedCount > 0 || (itemAfter >= quantity && itemBefore < quantity)) { // Ít nhất có tăng hoặc đạt mục tiêu
             console.log(`[Craft] Bước 8: Chế tạo hoàn tất. Số lượng ${itemId} hiện tại: ${itemAfter}`);
             bot.chat(`${username}, tôi đã chế tạo xong ${itemNameVi}! (Hiện có ${itemAfter} cái)`);
        } else if (itemAfter === itemBefore && itemAfter > 0) {
             console.warn(`[Craft] Bước 8: Cảnh báo: Số lượng ${itemId} không đổi (${itemAfter}) sau khi craft.`);
             bot.chat(`${username}, tôi đã thử chế tạo ${itemNameVi}, nhưng số lượng không thay đổi. (Hiện có ${itemAfter} cái)`);
        } else {
            console.warn(`[Craft] Bước 8: Cảnh báo: Số lượng ${itemId} không tăng hoặc về 0 (Trước: ${itemBefore}, Sau: ${itemAfter}). Có thể đã xảy ra lỗi không bắt được.`);
            bot.chat(`Hmm ${username}, tôi đã thử chế tạo ${itemNameVi}, nhưng không chắc nó đã vào túi đồ chưa.`);
        }

    } catch (err) {
        console.error(`[Craft] Lỗi nghiêm trọng trong quá trình gọi bot.craft cho ${itemId}:`, err);
        bot.chat(`Xin lỗi ${username}, tôi gặp lỗi khi đang chế tạo ${itemNameVi}.`);
        if (err.message) {
            console.error(`[Craft] Chi tiết lỗi: ${err.message}`);
            const lowerMsg = err.message.toLowerCase();
            if (lowerMsg.includes('missing requirement') || lowerMsg.includes('not enough')) {
                 bot.chat(`(Lỗi: Hình như bị thiếu nguyên liệu giữa chừng.)`);
                 console.log(`[Craft Debug] Lỗi "missing requirement" xảy ra mặc dù đã kiểm tra thủ công.`);
            } else if (lowerMsg.includes('no space')) {
                 bot.chat(`(Lỗi: Túi đồ của tôi đầy mất rồi.)`);
            } else if (lowerMsg.includes('pathfinding') || lowerMsg.includes('timeout') || lowerMsg.includes('unreachable') || lowerMsg.includes('cannot find path')) {
                 bot.chat(`(Lỗi: Tôi gặp vấn đề khi di chuyển đến bàn chế tạo hoặc tương tác.)`);
            } else if (lowerMsg.includes('recipe not found') || lowerMsg.includes('invalid recipe')) {
                 bot.chat(`(Lỗi: Công thức tôi định dùng có vẻ không hợp lệ?)`);
            }
            else {
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

// --- Export hàm chính ---
module.exports = {
    craftItem,
};