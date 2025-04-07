const { GoalBlock, GoalNear } = require("mineflayer-pathfinder").goals;
const { Vec3 } = require("vec3");
const { translateToEnglishId, formatCoords, sleep } = require("../utils");

const CRAFTING_TABLE_ID_NAME = 'crafting_table';
const FURNACE_ID_NAME = 'furnace';
const BLAST_FURNACE_ID_NAME = 'blast_furnace';
const SMOKER_ID_NAME = 'smoker';
const ALL_FURNACE_TYPES = [FURNACE_ID_NAME, BLAST_FURNACE_ID_NAME, SMOKER_ID_NAME];
const COBBLESTONE_ID_NAME = 'cobblestone';
const FUEL_TAG = 'minecraft:coals';
const LOGS_TAG = 'minecraft:logs_that_burn';

const MAX_SEARCH_DIST = 32;

const KNOWN_FUEL_ITEM_NAMES = [
    // Nhiên liệu hiệu quả cao
    'coal',
    'charcoal',
    'coal_block',          // <<< Đã thêm
    'dried_kelp_block',    // <<< Đã thêm
    'lava_bucket',
    'blaze_rod',

    // Các loại Gỗ Thường (Log)
    'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',

    // Các loại Thân Gỗ Nether (Stem)
    'crimson_stem',        // <<< Đã thêm
    'warped_stem',         // <<< Đã thêm

    // Các loại Gỗ Đầy Đủ Vỏ (Wood) - 6 mặt vỏ
    'oak_wood', 'spruce_wood', 'birch_wood', 'jungle_wood', 'acacia_wood', 'dark_oak_wood', 'mangrove_wood', 'cherry_wood', // <<< Đã thêm

    // Các loại Thân Gỗ Nether Đầy Đủ Vỏ (Hyphae) - 6 mặt vỏ
    'crimson_hyphae',      // <<< Đã thêm
    'warped_hyphae',       // <<< Đã thêm

    // Các loại Gỗ Thường Đã Tước Vỏ (Stripped Log)
    'stripped_oak_log', 'stripped_spruce_log', 'stripped_birch_log', 'stripped_jungle_log', 'stripped_acacia_log', 'stripped_dark_oak_log', 'stripped_mangrove_log', 'stripped_cherry_log', // <<< Đã thêm

    // Các loại Thân Gỗ Nether Đã Tước Vỏ (Stripped Stem)
    'stripped_crimson_stem', // <<< Đã thêm
    'stripped_warped_stem',  // <<< Đã thêm

    // Các loại Gỗ Đầy Đủ Vỏ Đã Tước (Stripped Wood) - 6 mặt đã tước
    'stripped_oak_wood', 'stripped_spruce_wood', 'stripped_birch_wood', 'stripped_jungle_wood', 'stripped_acacia_wood', 'stripped_dark_oak_wood', 'stripped_mangrove_wood', 'stripped_cherry_wood', // <<< Đã thêm

    // Các loại Thân Gỗ Nether Đầy Đủ Vỏ Đã Tước (Stripped Hyphae) - 6 mặt đã tước
    'stripped_crimson_hyphae', // <<< Đã thêm
    'stripped_warped_hyphae',  // <<< Đã thêm

    // Nhiên liệu tái tạo khác
    'bamboo',
    // 'scaffolding', // Có thể thêm nếu muốn

    // Nhiên liệu kém hiệu quả (chỉ thêm nếu thực sự cần)
    // 'oak_planks', 'spruce_planks', ...
];
async function findNearbyBlock(bot, mcData, blockNames, maxDistance = MAX_SEARCH_DIST) {
    const blockIds = blockNames
        .map(name => mcData.blocksByName[name]?.id)
        .filter(id => id !== undefined);

    if (blockIds.length === 0) {
        console.error(`[FindBlock] Không tìm thấy dữ liệu block cho: ${blockNames.join(', ')}`);
        return null;
    }
    console.log(`[FindBlock] Tìm ${blockNames.join('/')} gần đó (IDs: ${blockIds.join(', ')}, Tối đa: ${maxDistance} blocks)...`);
    try {
        const foundBlocks = await bot.findBlocks({
            matching: blockIds,
            maxDistance: maxDistance,
            count: 5
        });

        if (foundBlocks.length > 0) {
            foundBlocks.sort((a, b) => bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b));
            const closestPos = foundBlocks[0];
            const block = bot.blockAt(closestPos);
            if (block) {
                console.log(`[FindBlock] Tìm thấy ${block.name} gần nhất tại ${formatCoords(block.position)}`);
                return block;
            } else {
                console.warn(`[FindBlock] Tìm thấy vị trí ${formatCoords(closestPos)} nhưng không lấy được block?`);
                return null;
            }
        } else {
            console.log(`[FindBlock] Không tìm thấy ${blockNames.join('/')} nào gần đó.`);
            return null;
        }
    } catch (err) {
        console.error("[FindBlock] Lỗi khi tìm kiếm block:", err);
        return null;
    }
}

async function gotoBlock(bot, targetBlock, reach = 2.5) {
    if (!targetBlock) return false;
    const goal = new GoalNear(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z, reach);
    console.log(`[Goto] Bắt đầu di chuyển đến gần ${targetBlock.name} tại ${formatCoords(targetBlock.position)}...`);
    try {
        await bot.pathfinder.goto(goal);
        console.log(`[Goto] Đã đến gần ${targetBlock.name}.`);
        return true;
    } catch (err) {
        console.error(`[Goto] Lỗi khi di chuyển đến ${targetBlock.name}:`, err.message);
        bot.pathfinder.stop();
        return false;
    }
}

async function ensureCraftingTableInInventory(bot, mcData, username, itemNameVi) {
    const tableItemData = mcData.itemsByName[CRAFTING_TABLE_ID_NAME];
    if (!tableItemData) {
        console.error("[EnsureTable] Không tìm thấy dữ liệu item cho crafting_table!");
        bot.chat(`Lỗi dữ liệu game, không tìm thấy thông tin bàn chế tạo.`);
        return false;
    }
    const tableItemId = tableItemData.id;
    console.log(`[EnsureTable] Kiểm tra BCT (ID: ${tableItemId}) trong túi đồ...`);
    let tableItem = bot.inventory.findInventoryItem(tableItemId, null);
    if (tableItem && tableItem.count > 0) {
        console.log(`[EnsureTable] Tìm thấy ${tableItem.count} BCT trong túi đồ.`);
        return true;
    }
    console.log("[EnsureTable] Không có BCT trong túi đồ. Thử chế tạo...");
    bot.chat(`${username}, tôi không có bàn chế tạo, để tôi thử làm một cái...`);
    const plankItems = mcData.itemsArray.filter(item => item.name.endsWith('_planks'));
    let totalPlanks = 0;
    for (const plank of plankItems) {
        totalPlanks += bot.inventory.count(plank.id, null);
    }
    console.log(`[EnsureTable] Kiểm tra gỗ ván (planks): Có tổng cộng ${totalPlanks}`);
    if (totalPlanks < 4) {
        console.log("[EnsureTable] Không đủ gỗ ván để chế tạo BCT.");
        bot.chat(`Tôi không có đủ gỗ ván (cần 4) để làm bàn chế tạo${itemNameVi ? ` cho ${itemNameVi}`: '.'}`);
        return false;
    }
    const bctRecipes = bot.recipesFor(tableItemId, null, 1, null);
    if (!bctRecipes || bctRecipes.length === 0) {
        console.error("[EnsureTable] Không tìm thấy công thức chế tạo BCT trong bot.recipesFor!");
        bot.chat(`Lạ thật, tôi không biết cách chế tạo bàn chế tạo?`);
        return false;
    }
    const bctRecipe = bctRecipes[0];
    console.log("[EnsureTable] Tìm thấy công thức BCT. Bắt đầu chế tạo...");
    try {
        await bot.craft(bctRecipe, 1, null);
        await bot.waitForTicks(10);
        tableItem = bot.inventory.findInventoryItem(tableItemId, null);
        if (tableItem && tableItem.count > 0) {
            console.log("[EnsureTable] Chế tạo BCT thành công!");
            bot.chat("Tôi đã làm xong bàn chế tạo!");
            return true;
        } else {
            console.error("[EnsureTable] Chế tạo BCT nhưng không thấy trong túi đồ sau đó?");
            bot.chat("Tôi đã thử làm bàn chế tạo nhưng có lỗi gì đó.");
            return false;
        }
    } catch (err) {
        console.error("[EnsureTable] Lỗi khi chế tạo BCT:", err);
        bot.chat(`Tôi gặp lỗi khi cố chế tạo bàn chế tạo: ${err.message}`);
        return false;
    }
}

async function placeBlockFromInventory(bot, mcData, username, blockToPlaceName, ensureFunction) {
    const canPlace = await ensureFunction(bot, mcData, username, blockToPlaceName);
    if (!canPlace) { return null; }

    const blockItemData = mcData.itemsByName[blockToPlaceName];
    const blockItem = bot.inventory.findInventoryItem(blockItemData.id, null);
    if (!blockItem) {
         console.error(`[PlaceBlock] Lỗi logic: Đã đảm bảo có ${blockToPlaceName} nhưng lại không tìm thấy?`);
         bot.chat(`Có lỗi xảy ra, tôi không tìm thấy ${blockToPlaceName} vừa rồi.`);
         return null;
    }

    console.log(`[PlaceBlock] Tìm vị trí thích hợp để đặt ${blockToPlaceName}...`);
    bot.chat(`${username}, tôi sẽ tìm chỗ để đặt ${blockToPlaceName} xuống...`);

    let placedBlock = null;
    const maxPlacementSearchRadius = 3;
    const offsets = [{dx: 0, dz: 0}];
    for (let r = 1; r <= maxPlacementSearchRadius; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                 if (Math.abs(dx) === r || Math.abs(dz) === r) { offsets.push({dx, dz}); }
            }
        }
    }

    for (const offset of offsets) {
        const checkPos = bot.entity.position.floored().offset(offset.dx, 0, offset.dz);
        const refPos = checkPos.offset(0, -1, 0);
        const targetPos = checkPos;
        const referenceBlock = bot.blockAt(refPos);
        const targetBlock = bot.blockAt(targetPos);

        if (referenceBlock && referenceBlock.boundingBox === 'block' &&
            targetBlock && targetBlock.type === 0 && // Check if the target space is air
            bot.entity.position.distanceTo(targetPos.offset(0.5, 0.5, 0.5)) < 4.5) {
            console.log(`[PlaceBlock] Tìm thấy vị trí hợp lệ: Đặt tại ${formatCoords(targetPos)} lên trên ${referenceBlock.name} tại ${formatCoords(refPos)}`);
            try {
                await bot.equip(blockItem, 'hand');
                console.log(`[PlaceBlock] Đã trang bị ${blockToPlaceName}.`);
                await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
                console.log("[PlaceBlock] Lệnh đặt khối đã gửi. Chờ xác nhận...");
                await bot.waitForTicks(20); // Increased wait time slightly
                const verifyBlock = bot.blockAt(targetPos);
                if (verifyBlock && verifyBlock.name === blockToPlaceName) {
                    console.log(`[PlaceBlock] Đặt và xác nhận ${blockToPlaceName} thành công tại ${formatCoords(targetPos)}.`);
                    placedBlock = verifyBlock;
                    break;
                } else {
                    console.warn(`[PlaceBlock] Đã đặt nhưng không xác nhận được ${blockToPlaceName} tại ${formatCoords(targetPos)} (Thấy: ${verifyBlock?.name}). Thử vị trí khác...`);
                    await bot.waitForTicks(5); // Small delay before next attempt
                }
            } catch (err) {
                console.error(`[PlaceBlock] Lỗi khi cố đặt ${blockToPlaceName} tại ${formatCoords(targetPos)}:`, err.message);
                 // Check for specific placement errors if needed
                if (err.message.includes('No block has been placed')) {
                    console.warn('[PlaceBlock] Lỗi không đặt được block, có thể do server lag hoặc vị trí không hợp lệ.');
                }
                await sleep(200); // Wait a bit before trying next location
            }
        }
    }

    if (placedBlock) {
        bot.chat(`Tôi đã đặt ${blockToPlaceName} tại ${formatCoords(placedBlock.position)}.`);
        return placedBlock;
    } else {
        console.error(`[PlaceBlock] Không tìm được vị trí phù hợp nào để đặt ${blockToPlaceName}.`);
        bot.chat(`Xin lỗi ${username}, tôi không tìm được chỗ nào tốt để đặt ${blockToPlaceName} xuống.`);
        return null;
    }
}

async function performManualCheck(bot, mcData, recipe, quantity, isPreliminary) {
    const checkType = isPreliminary ? "Sơ bộ" : "Chi tiết";
    console.log(`[ManualCheck - ${checkType}] Kiểm tra thủ công nguyên liệu...`);
    if (!recipe) {
        console.error(`[ManualCheck - ${checkType}] Lỗi: Không có công thức hợp lệ.`);
        return false;
    }
     if (!recipe.result || !recipe.result.count || recipe.result.count <= 0) {
         console.error(`[ManualCheck - ${checkType}] Lỗi: Công thức không có số lượng kết quả hợp lệ.`);
         return false;
     }

    let craftsNeeded = 1;
    if (!isPreliminary) {
        craftsNeeded = Math.ceil(quantity / recipe.result.count);
        console.log(`[ManualCheck - ${checkType}] Cần ${craftsNeeded} lần craft (mỗi lần tạo ${recipe.result.count}) để có ${quantity} mục tiêu.`);
    } else {
         console.log(`[ManualCheck - ${checkType}] Kiểm tra cho 1 lần craft.`);
    }

    const totalNeeded = {};
    let ingredientsSource = recipe.delta;

     if (!ingredientsSource || ingredientsSource.length === 0) {
        console.log(`[ManualCheck - ${checkType}] Không có delta, thử tính từ ingredients/inShape...`);
        ingredientsSource = [];
        const source = recipe.ingredients || (recipe.inShape ? recipe.inShape.flat() : null);
        if (source) {
            source.forEach(ingredient => {
                let id = null; let count = 1;
                if (ingredient === null || ingredient === -1) return;
                if (typeof ingredient === 'object' && ingredient !== null && !Array.isArray(ingredient)) {
                    if (ingredient.id !== undefined && ingredient.id !== -1) { id = ingredient.id; count = ingredient.count || 1; }
                    else if (ingredient.matching && ingredient.matching.length > 0) { id = ingredient.matching[0]; count = ingredient.count || 1; }
                } else if (typeof ingredient === 'number') { id = ingredient; }
                else if (Array.isArray(ingredient) && ingredient.length > 0) {
                    const firstItem = ingredient.flat()[0];
                    if (typeof firstItem === 'number' && firstItem !== -1) { id = firstItem; }
                }
                if (id !== null) ingredientsSource.push({ id: id, count: -count });
            });
        }
    }

    if (!ingredientsSource || ingredientsSource.length === 0) {
        console.error(`[ManualCheck - ${checkType}] Lỗi: Không xác định được nguyên liệu.`);
        return false;
    }

    console.log(`[ManualCheck - ${checkType}] Phân tích nguyên liệu cần:`, ingredientsSource);

    ingredientsSource.forEach(item => {
        if (item.count < 0) {
             const neededPerCraft = -item.count;
             const ingredientId = item.id;
             if (ingredientId !== null && ingredientId !== undefined && ingredientId !== -1) {
                 totalNeeded[ingredientId] = (totalNeeded[ingredientId] || 0) + (neededPerCraft * craftsNeeded);
             }
        }
    });

    console.log(`[ManualCheck - ${checkType}] Tổng nguyên liệu cần:`, totalNeeded);

    if (Object.keys(totalNeeded).length === 0 && ingredientsSource.some(i => i.count < 0 && i.id !== -1)) {
         console.warn(`[ManualCheck - ${checkType}] Tính toán rỗng dù có vẻ cần?`);
         return true;
    }
     if (Object.keys(totalNeeded).length === 0) {
         console.log(`[ManualCheck - ${checkType}] Công thức không cần nguyên liệu? OK.`);
         return true;
     }

    for (const ingredientIdStr in totalNeeded) {
        const ingredientId = parseInt(ingredientIdStr, 10);
        const requiredCount = totalNeeded[ingredientIdStr];
        const availableCount = bot.inventory.count(ingredientId, null);
        const ingredientData = mcData.items[ingredientId] || mcData.blocks[ingredientId];
        const ingredientName = ingredientData?.displayName || ingredientData?.name || `ID ${ingredientId}`;
        console.log(`[ManualCheck - ${checkType}]   - ${ingredientName} (ID ${ingredientId}): Cần ${requiredCount}, Có ${availableCount}`);
        if (availableCount < requiredCount) {
            console.log(`[ManualCheck - ${checkType}]   -> Không đủ ${ingredientName}!`);
            return false;
        }
    }

    console.log(`[ManualCheck - ${checkType}] Kiểm tra thành công.`);
    return true;
}

async function craftItem(bot, username, message, aiModel, quantityOverride = null) {
    const isSystemRequest = username === "System";
    console.log(`[Craft] === Bắt đầu craft từ ${isSystemRequest ? 'System' : username}: "${message}" ===`);

    let itemNameVi = null;
    let quantity = quantityOverride ?? 1;

    if (!quantityOverride) {
        try {
            console.log("[Craft] Bước 1: Trích xuất tên/số lượng...");
            const extractionPrompt = `Từ tin nhắn "${message}", trích xuất tên vật phẩm muốn chế tạo và số lượng. Mặc định là 1. JSON: {"itemName": "tên vật phẩm", "quantity": số lượng}. Ví dụ: "làm 5 đuốc" -> {"itemName": "đuốc", "quantity": 5}. JSON:`;
            const extractResult = await aiModel.generateContent(extractionPrompt);
            const jsonResponse = (await extractResult.response.text()).trim();
            let parsedData;
             try {
                const jsonMatch = jsonResponse.match(/\{.*\}/s);
                if (jsonMatch && jsonMatch[0]) {
                    parsedData = JSON.parse(jsonMatch[0]);
                } else {
                     const numMatch = message.match(/\d+/);
                     const potentialQuantity = numMatch ? parseInt(numMatch[0], 10) : 1;
                     const potentialName = message.replace(/\d+/, '').replace(/làm|chế tạo|cho|cái/gi, '').trim();
                     if (potentialName) {
                         itemNameVi = potentialName;
                         quantity = potentialQuantity > 0 ? potentialQuantity : 1;
                     } else { throw new Error("Fallback thất bại."); }
                }
            } catch (parseError) {
                 throw new Error(`Parse JSON/fallback lỗi: ${parseError.message}`);
            }
            if (parsedData) {
                itemNameVi = parsedData.itemName;
                quantity = parseInt(parsedData.quantity, 10);
                 if (isNaN(quantity) || quantity <= 0) { quantity = 1; }
            }
            if (!itemNameVi) throw new Error("Không trích xuất được tên.");
            quantity = Math.max(1, quantity);
            console.log(`[Craft] Bước 1: Tên="${itemNameVi}", Số lượng=${quantity}`);
        } catch (error) {
            console.error("[Craft] Lỗi trích xuất:", error);
            if (!isSystemRequest) bot.chat(`Lỗi: ${error.message}`);
            return false;
        }
    } else {
         itemNameVi = message.replace(/\d+/g, '').replace(/chế tạo|làm|craft|make/gi, '').trim();
         quantity = quantityOverride;
         console.log(`[Craft] Bước 1: Yêu cầu hệ thống/Override: Tên="${itemNameVi}", Số lượng=${quantity}`);
    }

    console.log(`[Craft] Bước 2: Dịch "${itemNameVi}" sang ID...`);
    const itemId = translateToEnglishId(itemNameVi);
    if (!itemId) {
        if (!isSystemRequest) bot.chat(`Tôi không biết "${itemNameVi}" là gì.`);
        return false;
    }
    console.log(`[Craft] Bước 2: ID: "${itemId}"`);

    console.log(`[Craft] Bước 3: Tải mcData v${bot.version}...`);
    const mcData = require('minecraft-data')(bot.version);
    if (!mcData) {
        if (!isSystemRequest) bot.chat(`Lỗi tải dữ liệu game.`);
        return false;
    }
    const itemToCraft = mcData.itemsByName[itemId] || mcData.blocksByName[itemId];
    if (!itemToCraft) {
        if (!isSystemRequest) bot.chat(`Không tìm thấy thông tin về "${itemNameVi}" (${itemId}).`);
        return false;
    }
    console.log(`[Craft] Bước 3: Chế tạo: ${itemId} (ID: ${itemToCraft.id}), Số lượng: ${quantity}`);

    console.log(`[Craft] Bước 4: Lấy công thức từ mcData...`);
    const knownRecipes = mcData.recipes[itemToCraft.id];
    if (!knownRecipes || knownRecipes.length === 0) {
        if (itemToCraft.craftingDifficulty === undefined) {
             if (!isSystemRequest) bot.chat(`${itemNameVi} hình như không chế tạo được.`);
        } else {
             if (!isSystemRequest) bot.chat(`Không tìm thấy công thức cho ${itemNameVi}.`);
        }
        return false;
    }
    const firstKnownRecipe = knownRecipes[0];
    let potentialRequiresTable = firstKnownRecipe.requiresTable;
    const itemsDefinitelyNeedingTable = ['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'helmet', 'chestplate', 'leggings', 'boots', 'furnace', 'crafting_table', 'chest', 'barrel', 'smoker', 'blast_furnace', 'shield', 'bow', 'bed', 'piston', 'sticky_piston', 'dispenser', 'dropper', 'repeater', 'comparator', 'observer', 'tnt', 'bookshelf', 'jukebox', 'note_block', 'cake', 'cookie', 'pumpkin_pie', 'beacon', 'enchanting_table', 'ender_chest', 'anvil', 'brewing_stand', 'cauldron', 'item_frame', 'flower_pot', 'armor_stand', 'banner', 'shulker_box', 'concrete', 'glazed_terracotta', 'map'];
    const itemNameLower = itemId.toLowerCase();
    const itemDisplayNameLower = itemToCraft.displayName?.toLowerCase() || '';
    const needsTableOverride = itemsDefinitelyNeedingTable.some(suffix => itemNameLower.endsWith(suffix) || itemDisplayNameLower.endsWith(suffix) || itemNameLower.startsWith(suffix));
    if (needsTableOverride && (potentialRequiresTable === undefined || potentialRequiresTable === false)) potentialRequiresTable = true;
    else if (!needsTableOverride && potentialRequiresTable === undefined) potentialRequiresTable = false;
    else if (potentialRequiresTable === undefined) potentialRequiresTable = false;
    console.log(`[Craft] Bước 4: Công thức ${potentialRequiresTable ? 'CẦN' : 'KHÔNG cần'} bàn.`);

    console.log("[Craft] Bước 5: Kiểm tra nguyên liệu sơ bộ...");
    let preliminaryCheckOK = false;
    for (const recipe of knownRecipes) {
        if (await performManualCheck(bot, mcData, recipe, 1, true)) {
            preliminaryCheckOK = true;
            break;
        }
    }
    if (!preliminaryCheckOK) {
        if (!isSystemRequest) bot.chat(`Không đủ nguyên liệu cơ bản cho ${itemNameVi}.`);
        return false;
    }
    console.log("[Craft] Bước 5: Kiểm tra sơ bộ OK.");

    let craftingTableBlock = null;
    let availableRecipes = null;

    if (potentialRequiresTable) {
        console.log("[Craft] Bước 6a: Tìm/đặt bàn chế tạo...");
        craftingTableBlock = await findNearbyBlock(bot, mcData, [CRAFTING_TABLE_ID_NAME]);
        if (craftingTableBlock) {
            if (!await gotoBlock(bot, craftingTableBlock)) {
                if (!isSystemRequest) bot.chat("Không đến được bàn, thử đặt cái mới.");
                craftingTableBlock = await placeBlockFromInventory(bot, mcData, username, CRAFTING_TABLE_ID_NAME, ensureCraftingTableInInventory);
            }
        } else {
            craftingTableBlock = await placeBlockFromInventory(bot, mcData, username, CRAFTING_TABLE_ID_NAME, ensureCraftingTableInInventory);
        }
        if (!craftingTableBlock) return false;
        console.log(`[Craft] Bước 6a: Dùng bàn tại ${formatCoords(craftingTableBlock.position)}. Lấy công thức khả thi...`);
        availableRecipes = bot.recipesFor(itemToCraft.id, null, 1, craftingTableBlock);
    } else {
        console.log("[Craft] Bước 6b: Không cần bàn. Lấy công thức khả thi...");
        availableRecipes = bot.recipesFor(itemToCraft.id, null, 1, null);
    }

    let recipeToUse = null;
    if (!availableRecipes || availableRecipes.length === 0) {
         if (!isSystemRequest) bot.chat(`Không có công thức phù hợp với nguyên liệu hiện có cho ${itemNameVi}${potentialRequiresTable ? ' (dùng bàn)' : ''}.`);
         return false;
    }
    console.log(`[Craft] Bước 7: Tìm thấy ${availableRecipes.length} công thức khả thi. Kiểm tra chi tiết...`);
    for (const recipe of availableRecipes) {
        if (await performManualCheck(bot, mcData, recipe, quantity, false)) {
            recipeToUse = recipe;
            console.log(`[Craft] Bước 7: Công thức này OK.`);
            break;
        }
    }
    if (!recipeToUse) {
        if (!isSystemRequest) bot.chat(`Không đủ nguyên liệu để làm ${quantity} ${itemNameVi}.`);
        return false;
    }
    console.log(`[Craft] Bước 7: Đã chọn công thức.`);

    if (!recipeToUse.result || !recipeToUse.result.count || recipeToUse.result.count <= 0) {
         if (!isSystemRequest) bot.chat(`Lỗi công thức của ${itemNameVi}.`);
         return false;
    }
    const craftsNeeded = Math.ceil(quantity / recipeToUse.result.count);
    console.log(`[Craft Debug] Cần ${craftsNeeded} lần craft.`);

    console.log(`[Craft] Bước 8: Bắt đầu ${craftsNeeded} lần chế tạo ${itemId}...`);
    if (!isSystemRequest) bot.chat(`Ok ${username}, bắt đầu chế tạo ${quantity} ${itemNameVi}...`);
    let itemBefore = bot.inventory.count(itemToCraft.id, null);
    let craftedSuccessfully = false;
    try {
        await bot.craft(recipeToUse, craftsNeeded, craftingTableBlock);
        console.log(`[Craft Debug] Lệnh craft đã gửi. Chờ ${60} ticks (3 giây) để server xử lý...`); // Thêm log chờ
        await bot.waitForTicks(60); // <<<<< TĂNG THỜI GIAN CHỜ LÊN
        craftedSuccessfully = true; 

        const itemAfter = bot.inventory.count(itemToCraft.id, null);
        const craftedCount = itemAfter - itemBefore;
        console.log(`[Craft Debug] Số lượng ${itemId} sau khi craft: ${itemAfter} (Trước: ${itemBefore})`);
        if (itemAfter >= itemBefore + (craftsNeeded * recipeToUse.result.count)) {
             if (!isSystemRequest) bot.chat(`${username}, đã chế tạo xong ${itemNameVi}! (Hiện có ${itemAfter})`);
        } else if (craftedCount > 0 || (itemAfter >= quantity && itemBefore < quantity)) {
             if (!isSystemRequest) bot.chat(`${username}, đã chế tạo xong ${itemNameVi}! (Hiện có ${itemAfter})`);
        } else if (itemAfter === itemBefore && itemAfter > 0) {
             if (!isSystemRequest) bot.chat(`${username}, đã thử chế tạo ${itemNameVi}, nhưng số lượng không đổi. (Hiện có ${itemAfter})`);
             craftedSuccessfully = false;
        } else {
             if (!isSystemRequest) bot.chat(`Hmm ${username}, đã thử chế tạo ${itemNameVi}, nhưng không chắc nó vào túi đồ chưa.`);
             craftedSuccessfully = false;
        }

    } catch (err) {
        console.error(`[Craft] Lỗi khi gọi bot.craft cho ${itemId}:`, err);
        if (!isSystemRequest) bot.chat(`Lỗi khi chế tạo ${itemNameVi}.`);
        if (err.message) {
            const lowerMsg = err.message.toLowerCase();
            if (lowerMsg.includes('missing') || lowerMsg.includes('not enough')) {
                 if (!isSystemRequest) bot.chat(`(Lỗi: Thiếu nguyên liệu?)`);
            } else if (lowerMsg.includes('no space')) {
                 if (!isSystemRequest) bot.chat(`(Lỗi: Túi đồ đầy.)`);
            } else if (lowerMsg.includes('recipe not found') || lowerMsg.includes('invalid recipe')) {
                 if (!isSystemRequest) bot.chat(`(Lỗi: Công thức không hợp lệ?)`);
            } else {
                 if (!isSystemRequest) bot.chat(`(Lỗi: ${err.message})`);
            }
        }
        craftedSuccessfully = false;
    } finally {
         console.log(`[Craft] === Kết thúc craft cho ${isSystemRequest ? 'System' : username}: "${message}" ===`);
    }
    return craftedSuccessfully;
}


async function ensureFurnaceAvailable(bot, mcData, username, requiredType = FURNACE_ID_NAME) {
    const furnaceItemData = mcData.itemsByName[requiredType];
    if (!furnaceItemData) {
        console.error(`[EnsureFurnace] Không tìm thấy dữ liệu item cho ${requiredType}!`);
        if (username !== "System") bot.chat(`Lỗi dữ liệu game cho ${requiredType}.`);
        return false;
    }
    let furnaceItem = bot.inventory.findInventoryItem(furnaceItemData.id, null);
    if (furnaceItem) {
        console.log(`[EnsureFurnace] Tìm thấy ${furnaceItem.count} ${requiredType} trong túi.`);
        return true;
    }

    if (requiredType === FURNACE_ID_NAME) {
        console.log(`[EnsureFurnace] Không có ${requiredType}, thử chế tạo...`);
        if (username !== "System") bot.chat(`${username}, tôi không có lò nung, để làm một cái...`);

        const cobbleData = mcData.itemsByName[COBBLESTONE_ID_NAME];
        if (!cobbleData) { console.error("[EnsureFurnace] Không tìm thấy cobblestone data!"); return false; }
        const cobbleCount = bot.inventory.count(cobbleData.id, null);
        console.log(`[EnsureFurnace] Đá cuội: ${cobbleCount}`);

        if (cobbleCount < 8) {
            console.log("[EnsureFurnace] Không đủ đá cuội (cần 8).");
            if (username !== "System") bot.chat(`Không đủ đá cuội làm lò nung.`);
            return false;
        }

        console.log("[EnsureFurnace] Yêu cầu chế tạo lò nung...");
        const crafted = await craftItem(bot, "System", `chế tạo ${FURNACE_ID_NAME}`, null, 1);
        if (crafted) {
            console.log("[EnsureFurnace] Chế tạo lò nung thành công!");
            await sleep(500);
            return true;
        } else {
            console.error("[EnsureFurnace] Chế tạo lò nung thất bại.");
            if (username !== "System") bot.chat("Thử làm lò nung thất bại.");
            return false;
        }
    } else {
        console.log(`[EnsureFurnace] Không có ${requiredType} và chưa hỗ trợ craft.`);
        if (username !== "System") bot.chat(`Tôi không có ${requiredType} trong túi.`);
        return false;
    }
}

function findAvailableFuel(bot, mcData) {
    console.log("[FuelCheck] Tìm nhiên liệu...");
    let fuelSource = null;

    // --- Ưu tiên dùng tags nếu có và hợp lệ ---
    if (bot.registry && bot.registry.tags) {
        console.log("[FuelCheck] Thử tìm nhiên liệu bằng tags...");
        try {
            // Lấy danh sách ID từ tags, xử lý nếu tag không tồn tại
            const fuelTagIds = bot.registry.tags[FUEL_TAG] || [];
            const logTagIds = bot.registry.tags[LOGS_TAG] || [];

            // Tạo danh sách item có thể là fuel từ mcData
            const potentialFuelItems = mcData.itemsArray.filter(item =>
                fuelTagIds.includes(item.id) ||
                logTagIds.includes(item.id)
            );

            // Kiểm tra inventory cho các item này
            for (const fuelItem of potentialFuelItems) {
                const count = bot.inventory.count(fuelItem.id, null);
                if (count > 0) {
                    console.log(`[FuelCheck] Tìm thấy ${count} ${fuelItem.name} (từ tag)`);
                    fuelSource = { item: fuelItem, count: count };
                    break; // Tìm thấy fuel tốt từ tag, dừng lại
                }
            }
        } catch (tagError) {
            // Bắt lỗi nếu có vấn đề khi truy cập tags (dù đã kiểm tra bot.registry.tags)
            console.warn("[FuelCheck Warn] Lỗi khi xử lý tags:", tagError.message);
            fuelSource = null; // Reset fuelSource nếu có lỗi
        }
    } else {
        console.log("[FuelCheck] bot.registry.tags không khả dụng.");
    }

    // --- Nếu không tìm thấy từ tag hoặc tag không có/lỗi, tìm item cụ thể ---
    if (!fuelSource) {
        console.log("[FuelCheck] Không tìm thấy fuel từ tag hoặc tag không khả dụng/lỗi, tìm item cụ thể...");
        for (const itemName of KNOWN_FUEL_ITEM_NAMES) {
            const fuelItemData = mcData.itemsByName[itemName];
            if (fuelItemData) {
                const count = bot.inventory.count(fuelItemData.id, null);
                if (count > 0) {
                    console.log(`[FuelCheck] Tìm thấy ${count} ${fuelItemData.name} (cụ thể)`);
                    // Ưu tiên fuel tốt hơn (ví dụ: coal tốt hơn log) - có thể thêm logic sắp xếp nếu muốn
                    fuelSource = { item: fuelItemData, count: count };
                    break; // Tìm thấy fuel, dừng lại (hoặc tiếp tục để tìm fuel tốt hơn)
                }
            }
        }
    }

    // --- Kết quả cuối cùng ---
    if (fuelSource) {
        console.log(`[FuelCheck] Nhiên liệu khả dụng: ${fuelSource.item.name} (Số lượng: ${fuelSource.count})`);
    } else {
        console.log("[FuelCheck] Không tìm thấy nhiên liệu nào.");
    }
    return fuelSource;
}
let manualSmeltingRecipes = {};

function initializeManualRecipes(mcData) {
    // Kiểm tra mcData cơ bản
    if (!mcData || !mcData.itemsByName) {
         console.error("[ManualRecipe Error] Invalid mcData passed to initializeManualRecipes!");
         return;
    }
    // Chỉ khởi tạo một lần trừ khi ép buộc (có thể thêm biến global để debug)
    if (Object.keys(manualSmeltingRecipes).length > 0 /* && !global.forceReloadManualRecipes */) return;

    console.log("[ManualRecipe] Khởi tạo bảng công thức nung thủ công...");
    const recipesToAdd = {
        // Input Name : { outputName, cookTimeTicks (base), furnaceTypes }
        'iron_ore':       { outputName: 'iron_ingot', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME, BLAST_FURNACE_ID_NAME] },
        'raw_iron':       { outputName: 'iron_ingot', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME, BLAST_FURNACE_ID_NAME] },
        'gold_ore':       { outputName: 'gold_ingot', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME, BLAST_FURNACE_ID_NAME] },
        'raw_gold':       { outputName: 'gold_ingot', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME, BLAST_FURNACE_ID_NAME] },
        'copper_ore':     { outputName: 'copper_ingot', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME, BLAST_FURNACE_ID_NAME] },
        'raw_copper':     { outputName: 'copper_ingot', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME, BLAST_FURNACE_ID_NAME] },
        'sand':           { outputName: 'glass', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME] },
        'cobblestone':    { outputName: 'stone', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME] },
        'clay_ball':      { outputName: 'brick', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME] },
        'netherrack':     { outputName: 'nether_brick', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME] },
        'raw_chicken':    { outputName: 'cooked_chicken', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME, SMOKER_ID_NAME] }, // <--- Mục tiêu
        'raw_beef':       { outputName: 'cooked_beef', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME, SMOKER_ID_NAME] },
        'raw_porkchop':   { outputName: 'cooked_porkchop', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME, SMOKER_ID_NAME] },
        'raw_mutton':     { outputName: 'cooked_mutton', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME, SMOKER_ID_NAME] },
        'raw_rabbit':     { outputName: 'cooked_rabbit', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME, SMOKER_ID_NAME] },
        'raw_salmon':     { outputName: 'cooked_salmon', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME, SMOKER_ID_NAME] },
        'raw_cod':        { outputName: 'cooked_cod', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME, SMOKER_ID_NAME] },
        'potato':         { outputName: 'baked_potato', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME, SMOKER_ID_NAME] },
        'kelp':           { outputName: 'dried_kelp', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME, SMOKER_ID_NAME] },
        'cactus':         { outputName: 'green_dye', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME] },
        'wet_sponge':     { outputName: 'sponge', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME] },
        'oak_log':        { outputName: 'charcoal', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME] },
        'spruce_log':     { outputName: 'charcoal', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME] },
        'birch_log':      { outputName: 'charcoal', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME] },
        'jungle_log':     { outputName: 'charcoal', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME] },
        'acacia_log':     { outputName: 'charcoal', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME] },
        'dark_oak_log':   { outputName: 'charcoal', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME] },
        'mangrove_log':   { outputName: 'charcoal', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME] },
        'cherry_log':     { outputName: 'charcoal', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME] },
        'cobbled_deepslate': { outputName: 'deepslate', cookTimeTicks: 200, furnaceTypes: [FURNACE_ID_NAME] },
    };

    manualSmeltingRecipes = {}; // Reset trước khi thêm
    let successCount = 0;
    let skippedCount = 0;

    for (const inputName in recipesToAdd) {
        const outputName = recipesToAdd[inputName].outputName;
        let inputData = mcData.itemsByName[inputName] || mcData.blocksByName[inputName];
        let outputData = mcData.itemsByName[outputName] || mcData.blocksByName[outputName];

        // --- WORKAROUND CHO CÁC ITEM BỊ THIẾU TRONG mcData ---
        if (!inputData) {
            if (inputName === 'raw_chicken') {
                console.warn(`[ManualRecipe Workaround] mcData thiếu '${inputName}'. Sử dụng ID giả định 1039.`);
                inputData = { id: 1039, name: 'raw_chicken', displayName: 'Raw Chicken', stackSize: 64 };
            } else if (inputName === 'raw_beef') {
                 console.warn(`[ManualRecipe Workaround] mcData thiếu '${inputName}'. Sử dụng ID giả định 988.`); // ID thường là 988
                 inputData = { id: 988, name: 'raw_beef', displayName: 'Raw Beef', stackSize: 64 };
            } else if (inputName === 'raw_porkchop') {
                 console.warn(`[ManualRecipe Workaround] mcData thiếu '${inputName}'. Sử dụng ID giả định 959.`); // ID thường là 959
                 inputData = { id: 959, name: 'raw_porkchop', displayName: 'Raw Porkchop', stackSize: 64 };
            } else if (inputName === 'raw_mutton') {
                 console.warn(`[ManualRecipe Workaround] mcData thiếu '${inputName}'. Sử dụng ID giả định 1111.`); // ID thường là 1111
                 inputData = { id: 1111, name: 'raw_mutton', displayName: 'Raw Mutton', stackSize: 64 };
            } else if (inputName === 'raw_rabbit') {
                 console.warn(`[ManualRecipe Workaround] mcData thiếu '${inputName}'. Sử dụng ID giả định 1099.`); // ID thường là 1099
                 inputData = { id: 1099, name: 'raw_rabbit', displayName: 'Raw Rabbit', stackSize: 64 };
            } else if (inputName === 'raw_salmon') {
                 console.warn(`[ManualRecipe Workaround] mcData thiếu '${inputName}'. Sử dụng ID giả định 1014.`); // ID thường là 1014
                 inputData = { id: 1014, name: 'raw_salmon', displayName: 'Raw Salmon', stackSize: 64 };
            } else if (inputName === 'raw_cod') {
                 console.warn(`[ManualRecipe Workaround] mcData thiếu '${inputName}'. Sử dụng ID giả định 1011.`); // ID thường là 1011
                 inputData = { id: 1011, name: 'raw_cod', displayName: 'Raw Cod', stackSize: 64 };
            }
            // Thêm các else if khác cho các item bị thiếu nếu cần
        }
        // Tương tự, kiểm tra và workaround cho outputData nếu cần (ví dụ cooked_chicken đã có nên không cần)
        // if (!outputData && outputName === 'some_missing_output') { ... }

        // --- KẾT THÚC WORKAROUND ---

        if (inputData && outputData) {
            // Kiểm tra lại xem ID có hợp lệ không (phòng trường hợp workaround bị sai)
            if (typeof inputData.id === 'number' && typeof outputData.id === 'number') {
                manualSmeltingRecipes[inputData.id] = {
                    resultId: outputData.id,
                    cookTimeTicks: recipesToAdd[inputName].cookTimeTicks,
                    furnaceTypes: recipesToAdd[inputName].furnaceTypes
                };
                successCount++;
            } else {
                 console.warn(`[ManualRecipe] Bỏ qua công thức (ID không hợp lệ sau workaround?): ${inputName} -> ${outputName}`);
                 skippedCount++;
            }
        } else {
            // Log lý do bỏ qua nếu không phải do workaround xử lý
            let reason = [];
            if (!inputData) reason.push(`không tìm thấy input '${inputName}'`);
            if (!outputData) reason.push(`không tìm thấy output '${outputName}'`);
            console.warn(`[ManualRecipe] Bỏ qua công thức thủ công: ${inputName} -> ${outputName} (${reason.join(' và ')})`);
            skippedCount++;
        }
    }
    console.log(`[ManualRecipe] Đã khởi tạo ${successCount} công thức thủ công, bỏ qua ${skippedCount}.`);
}
async function smeltItem(bot, username, message, aiModel, quantityOverride = null) {
    const isSystemRequest = username === "System";
    console.log(`[Smelt] === Bắt đầu smelt từ ${isSystemRequest ? 'System' : username}: "${message}" ===`);

    let itemToSmeltVi = null;
    let quantity = quantityOverride ?? 1;

    if (!quantityOverride) {
        try {
            console.log("[Smelt] Bước 1: Trích xuất tên/số lượng (nung)...");
             const extractionPrompt = `Từ tin nhắn "${message}", trích xuất tên vật phẩm muốn NUNG/NẤU và số lượng. Mặc định là 1. JSON: {"itemName": "tên vật phẩm", "quantity": số lượng}. Ví dụ: "nung 10 sắt" -> {"itemName": "sắt", "quantity": 10}. JSON:`;
             const extractResult = await aiModel.generateContent(extractionPrompt);
             const jsonResponse = (await extractResult.response.text()).trim();
             let parsedData;
              try {
                 const jsonMatch = jsonResponse.match(/\{.*\}/s);
                 if (jsonMatch && jsonMatch[0]) {
                     parsedData = JSON.parse(jsonMatch[0]);
                 } else {
                      const numMatch = message.match(/\d+/);
                      const potentialQuantity = numMatch ? parseInt(numMatch[0], 10) : 1;
                      const potentialName = message.replace(/\d+/, '').replace(/nung|nấu|smelt|cook/gi, '').trim();
                      if (potentialName) {
                          itemToSmeltVi = potentialName;
                          quantity = potentialQuantity > 0 ? potentialQuantity : 1;
                      } else { throw new Error("Fallback thất bại."); }
                 }
             } catch (parseError) {
                  throw new Error(`Parse JSON/fallback lỗi: ${parseError.message}`);
             }
             if (parsedData) {
                 itemToSmeltVi = parsedData.itemName;
                 quantity = parseInt(parsedData.quantity, 10);
                  if (isNaN(quantity) || quantity <= 0) { quantity = 1; }
             }
             if (!itemToSmeltVi) throw new Error("Không trích xuất được tên.");
             quantity = Math.max(1, quantity);
             console.log(`[Smelt] Bước 1: Nung="${itemToSmeltVi}", Số lượng=${quantity}`);
        } catch (error) {
            console.error("[Smelt] Lỗi trích xuất:", error);
            if (!isSystemRequest) bot.chat(`Lỗi: ${error.message}`);
            return false;
        }
    } else {
         itemToSmeltVi = message.replace(/\d+/g, '').replace(/nung|nấu|smelt|cook/gi, '').trim();
         quantity = quantityOverride;
         console.log(`[Smelt] Bước 1: Yêu cầu hệ thống/Override: Nung="${itemToSmeltVi}", Số lượng=${quantity}`);
    }

    console.log(`[Smelt] Bước 2: Dịch "${itemToSmeltVi}" & tìm công thức nung...`);
    const inputItemId_Name = translateToEnglishId(itemToSmeltVi); // Lấy tên ID tiếng Anh
    if (!inputItemId_Name) {
        if (!isSystemRequest) bot.chat(`Tôi không biết "${itemToSmeltVi}" là gì.`);
        return false;
    }

    const mcData = require('minecraft-data')(bot.version);
    if (!mcData) {
        if (!isSystemRequest) bot.chat(`Lỗi tải dữ liệu game.`);
        return false;
    }
    // Khởi tạo bảng thủ công nếu chưa có
    console.log('[Debug Smelt] Checking mcData before init:', mcData?.itemsByName?.raw_chicken); // Xem nó có tồn tại không
    initializeManualRecipes(mcData);

    // --- BẮT ĐẦU SỬA ĐỔI ---

    // Cố gắng lấy dữ liệu item đầu vào từ mcData
    let inputItemData = mcData.itemsByName[inputItemId_Name] || mcData.blocksByName[inputItemId_Name];
    let inputItemId = null; // Khởi tạo ID là null

    // --- WORKAROUND TRONG SMELTITEM ---
    if (!inputItemData) {
        console.warn(`[Smelt Workaround] mcData thiếu dữ liệu cho '${inputItemId_Name}'. Thử áp dụng workaround...`);
        // Kiểm tra xem có phải là một trong những item bị thiếu đã biết không
        if (inputItemId_Name === 'raw_chicken') {
            inputItemData = { id: 1039, name: 'raw_chicken', displayName: 'Raw Chicken', stackSize: 64 };
        } else if (inputItemId_Name === 'raw_beef') {
            inputItemData = { id: 988, name: 'raw_beef', displayName: 'Raw Beef', stackSize: 64 };
        } else if (inputItemId_Name === 'raw_porkchop') {
            inputItemData = { id: 959, name: 'raw_porkchop', displayName: 'Raw Porkchop', stackSize: 64 };
        } else if (inputItemId_Name === 'raw_mutton') {
            inputItemData = { id: 1111, name: 'raw_mutton', displayName: 'Raw Mutton', stackSize: 64 };
        } else if (inputItemId_Name === 'raw_rabbit') {
            inputItemData = { id: 1099, name: 'raw_rabbit', displayName: 'Raw Rabbit', stackSize: 64 };
        } else if (inputItemId_Name === 'raw_salmon') {
            inputItemData = { id: 1014, name: 'raw_salmon', displayName: 'Raw Salmon', stackSize: 64 };
        } else if (inputItemId_Name === 'raw_cod') {
            inputItemData = { id: 1011, name: 'raw_cod', displayName: 'Raw Cod', stackSize: 64 };
        }
        // Thêm các else if khác nếu cần

        if (inputItemData) {
            console.log(`[Smelt Workaround] Đã áp dụng workaround cho '${inputItemId_Name}' với ID ${inputItemData.id}.`);
            inputItemId = inputItemData.id; // Lấy ID từ workaround
        } else {
            console.warn(`[Smelt Workaround] Không có workaround nào được áp dụng cho '${inputItemId_Name}'.`);
        }
    } else {
        // Nếu tìm thấy trong mcData, lấy ID bình thường
        inputItemId = inputItemData.id;
        console.log(`[Smelt] Tìm thấy dữ liệu cho '${inputItemId_Name}' trong mcData (ID: ${inputItemId}).`);
    }

    // Kiểm tra cuối cùng xem có inputItemData và inputItemId hợp lệ không
    if (!inputItemData || inputItemId === null) {
        if (!isSystemRequest) bot.chat(`Không tìm thấy dữ liệu hợp lệ cho "${itemToSmeltVi}" (${inputItemId_Name}) ngay cả sau khi workaround.`);
        console.error(`[Smelt Error] Không thể lấy dữ liệu/ID cho item đầu vào: ${inputItemId_Name}`);
        return false;
    }
    let recipeData = null;
    // --- Cố gắng tìm công thức trong mcData trước ---
    console.log(`[Smelt] Tìm công thức trong mcData cho ID ${inputItemId}...`);
    let mcDataSmeltingRecipes = [];
    if (mcData.recipes) {
         for (const id in mcData.recipes) {
              const recipesForId = mcData.recipes[id];
              if(Array.isArray(recipesForId)) {
                   recipesForId.forEach(r => {
                       let matchesInput = false;
                       // Kiểm tra input phức tạp hơn để bao gồm nhiều cấu trúc recipe
                       const checkIngredient = (ing) => {
                           if (!ing) return false;
                           if (typeof ing === 'number' && ing === inputItemId) return true;
                           if (typeof ing === 'object' && ing !== null) {
                               if (ing.item && mcData.itemsByName[ing.item.replace('minecraft:','')]?.id === inputItemId) return true;
                               if (ing.tag && bot.registry.tags[ing.tag]?.includes(inputItemId)) return true;
                               if (Array.isArray(ing.matching) && ing.matching.includes(inputItemId)) return true;
                               if (ing.id === inputItemId) return true; // Cấu trúc cũ hơn
                           }
                           return false;
                       };

                       if (r.ingredient && checkIngredient(r.ingredient)) matchesInput = true;
                       if (r.ingredients && Array.isArray(r.ingredients) && r.ingredients.length === 1 && checkIngredient(r.ingredients[0])) matchesInput = true;

                       if(matchesInput && (r.type === 'minecraft:smelting' || r.type === 'minecraft:blasting' || r.type === 'minecraft:smoking')) {
                            let resultObj = {};
                            // Xử lý các cấu trúc result khác nhau
                            const processResult = (res) => {
                                if (!res) return null;
                                let name = null;
                                let count = 1;
                                if (typeof res === 'string') name = res.replace('minecraft:', '');
                                else if (typeof res === 'object') {
                                    name = res.item?.replace('minecraft:', '') || res.id; // Lấy tên hoặc id
                                    count = res.count ?? 1;
                                }
                                const resData = mcData.itemsByName[name] || mcData.blocksByName[name];
                                return resData ? { id: resData.id, count: count } : null;
                            };
                            resultObj = processResult(r.result);

                           if(resultObj) {
                                mcDataSmeltingRecipes.push({ ...r, result: resultObj, inputId: inputItemId });
                           }
                       }
                   });
              }
         }
    }
    console.log(`[Smelt] Tìm thấy ${mcDataSmeltingRecipes.length} công thức trong mcData.`);

    // Phân loại công thức từ mcData
    const blastingRecipe = mcDataSmeltingRecipes.find(r => r.type === 'minecraft:blasting');
    const smokingRecipe = mcDataSmeltingRecipes.find(r => r.type === 'minecraft:smoking');
    const regularRecipe = mcDataSmeltingRecipes.find(r => r.type === 'minecraft:smelting');

    // Ưu tiên chọn công thức từ mcData nếu có
    if (blastingRecipe) {
        recipeData = {
            source: 'mcData', type: 'blasting',
            resultId: blastingRecipe.result.id,
            cookTimeTicks: blastingRecipe.cookingtime ?? 100, // Blast furnace nhanh hơn
            furnaceTypes: [BLAST_FURNACE_ID_NAME, FURNACE_ID_NAME] // Vẫn có thể dùng lò thường (chậm hơn)
        };
    } else if (smokingRecipe) {
        recipeData = {
            source: 'mcData', type: 'smoking',
            resultId: smokingRecipe.result.id,
            cookTimeTicks: smokingRecipe.cookingtime ?? 100, // Smoker nhanh hơn
            furnaceTypes: [SMOKER_ID_NAME, FURNACE_ID_NAME] // Vẫn có thể dùng lò thường (chậm hơn)
        };
    } else if (regularRecipe) {
        recipeData = {
            source: 'mcData', type: 'smelting',
            resultId: regularRecipe.result.id,
            cookTimeTicks: regularRecipe.cookingtime ?? 200,
            furnaceTypes: [FURNACE_ID_NAME]
        };
    }

    // --- Nếu không có công thức từ mcData, thử tìm trong bảng thủ công ---
    if (!recipeData && manualSmeltingRecipes[inputItemId]) {
        console.log(`[Smelt] Không tìm thấy recipe trong mcData, sử dụng công thức thủ công cho ${inputItemData.name} (ID: ${inputItemId})`);
        const manualData = manualSmeltingRecipes[inputItemId];
        recipeData = {
            source: 'manual',
            type: 'manual_smelting', // Đánh dấu là từ bảng thủ công
            resultId: manualData.resultId,
            cookTimeTicks: manualData.cookTimeTicks, // Sẽ điều chỉnh nếu dùng lò nhanh
            furnaceTypes: manualData.furnaceTypes
        };
        // Tự động giảm thời gian nếu có thể dùng lò nhanh (giả định lò nhanh gấp đôi)
        if (recipeData.furnaceTypes.includes(BLAST_FURNACE_ID_NAME) || recipeData.furnaceTypes.includes(SMOKER_ID_NAME)) {
             // Để đơn giản, ta sẽ ưu tiên tìm lò nhanh, nếu tìm thấy sẽ dùng cookTime/2, nếu không sẽ dùng cookTime gốc với lò thường
             // Logic này sẽ xử lý ở bước chọn lò
        }
    }

    // --- Kiểm tra cuối cùng xem có công thức không ---
    if (!recipeData) {
        if (!isSystemRequest) bot.chat(`${itemToSmeltVi} hình như không nung được (không có công thức nào).`);
        console.error(`[Smelt] Không tìm thấy công thức nung cho ${inputItemData.name} (ID: ${inputItemId}) cả trong mcData và thủ công.`);
        return false;
    }

    // --- Lấy thông tin từ recipeData ---
    const outputItemData = mcData.items[recipeData.resultId] || mcData.blocks[recipeData.resultId];
    if (!outputItemData) {
         if (!isSystemRequest) bot.chat(`Lỗi: Không tìm thấy dữ liệu sản phẩm nung (ID: ${recipeData.resultId}).`);
         console.error(`[Smelt] Lỗi dữ liệu: Không tìm thấy item/block cho result ID ${recipeData.resultId}`);
        return false;
    }
    const outputItemId = outputItemData.id;
    const outputItemName = outputItemData.name;
    let cookTimeTicks = recipeData.cookTimeTicks; // Thời gian cơ bản
    const possibleFurnaceTypes = [...recipeData.furnaceTypes]; // Copy để tránh thay đổi bảng gốc

    console.log(`[Smelt] Bước 2 Hoàn tất: Nung ${inputItemData.name} -> ${outputItemName}. Lò khả dụng: ${possibleFurnaceTypes.join('/')}. Time cơ bản: ${cookTimeTicks} ticks. (Nguồn: ${recipeData.source})`);
    console.log("[Smelt] Bước 3: Kiểm tra nguyên liệu đầu vào...");
    const inputAvailable = bot.inventory.count(inputItemData.id, null);
    if (inputAvailable < quantity) {
        if (!isSystemRequest) bot.chat(`Chỉ có ${inputAvailable}/${quantity} ${itemToSmeltVi} để nung.`);
        return false;
    }
    console.log(`[Smelt] Có ${inputAvailable}/${quantity} ${inputItemId}.`);

    console.log("[Smelt] Bước 4: Kiểm tra nhiên liệu...");
    const fuelInfo = findAvailableFuel(bot, mcData);
    if (!fuelInfo) {
        if (!isSystemRequest) bot.chat(`Không có nhiên liệu để nung.`);
        return false;
    }
    console.log(`[Smelt] Có nhiên liệu: ${fuelInfo.item.name} (${fuelInfo.count}).`);

   // --- Bước 5: Tìm/đặt lò phù hợp (Đã sửa đổi) ---
   console.log(`[Smelt] Bước 5: Tìm lò phù hợp (${possibleFurnaceTypes.join('/')})...`);
   // Ưu tiên tìm lò nhanh nếu có trong danh sách
   const preferredOrder = possibleFurnaceTypes.includes(BLAST_FURNACE_ID_NAME) ? [BLAST_FURNACE_ID_NAME, FURNACE_ID_NAME] :
                          possibleFurnaceTypes.includes(SMOKER_ID_NAME) ? [SMOKER_ID_NAME, FURNACE_ID_NAME] :
                          [FURNACE_ID_NAME];
   const searchOrder = preferredOrder.filter(type => possibleFurnaceTypes.includes(type)); // Chỉ tìm các loại có trong possibleFurnaceTypes

   let furnaceBlock = await findNearbyBlock(bot, mcData, searchOrder); // Tìm theo thứ tự ưu tiên
   let actualFurnaceType = null;

   if (furnaceBlock) {
       actualFurnaceType = furnaceBlock.name;
       console.log(`[Smelt] Tìm thấy ${actualFurnaceType} gần đó.`);
       if (!await gotoBlock(bot, furnaceBlock, 2.5)) {
            console.log(`[Smelt] Không đến được ${actualFurnaceType} đã tìm thấy.`);
            furnaceBlock = null; // Reset để thử đặt lò mới
            actualFurnaceType = null;
       }
   }

   // Nếu không tìm thấy hoặc không đến được lò phù hợp
   if (!furnaceBlock) {
       console.log(`[Smelt] Không tìm thấy/đến được lò phù hợp. Thử đặt lò...`);
       // Ưu tiên đặt lò thường vì bot biết cách craft (ensureFurnaceAvailable chỉ hỗ trợ lò thường)
       if (possibleFurnaceTypes.includes(FURNACE_ID_NAME)) {
           console.log(`[Smelt] Cố gắng đặt ${FURNACE_ID_NAME}...`);
           // Sử dụng hàm ensureFurnaceAvailable đã có để đảm bảo có lò thường trong túi
           furnaceBlock = await placeBlockFromInventory(bot, mcData, username, FURNACE_ID_NAME, ensureFurnaceAvailable);
           if (furnaceBlock) {
               actualFurnaceType = FURNACE_ID_NAME;
               console.log(`[Smelt] Đã đặt ${actualFurnaceType}.`);
           } else {
                console.error(`[Smelt] Đặt ${FURNACE_ID_NAME} thất bại.`);
                if (!isSystemRequest) bot.chat(`Tôi không tìm thấy lò nào và cũng không đặt được lò nung mới.`);
                return false;
           }
       } else {
            // Trường hợp này hiếm, vật phẩm chỉ nung được bằng lò chuyên dụng mà không nung được bằng lò thường
            console.error(`[Smelt] Vật phẩm chỉ nung được bằng ${possibleFurnaceTypes.join('/')} và không thể đặt lò thường.`);
            if (!isSystemRequest) bot.chat(`Món này cần lò đặc biệt (${possibleFurnaceTypes.join('/')}) mà tôi không có hoặc không đặt được.`);
            return false;
       }
   }

   // Xác định lại thời gian nung dựa trên lò thực tế sẽ dùng
   if (actualFurnaceType === BLAST_FURNACE_ID_NAME || actualFurnaceType === SMOKER_ID_NAME) {
       // Chỉ giảm thời gian nếu lò này nằm trong danh sách hợp lệ ban đầu
       if (recipeData.furnaceTypes.includes(actualFurnaceType)) {
            cookTimeTicks = Math.round(recipeData.cookTimeTicks / 2); // Giả định nhanh gấp đôi
            console.log(`[Smelt] Sử dụng ${actualFurnaceType}, thời gian nung được điều chỉnh thành ${cookTimeTicks} ticks.`);
       } else {
            // Trường hợp lạ: tìm thấy lò nhanh nhưng công thức gốc không hỗ trợ? Dùng thời gian gốc.
            console.warn(`[Smelt] Tìm thấy ${actualFurnaceType} nhưng công thức gốc (${recipeData.source}) không liệt kê? Dùng thời gian gốc ${cookTimeTicks}.`);
            cookTimeTicks = recipeData.cookTimeTicks;
       }
   } else {
        // Dùng lò thường, sử dụng thời gian gốc
        cookTimeTicks = recipeData.cookTimeTicks;
        console.log(`[Smelt] Sử dụng ${actualFurnaceType}, thời gian nung là ${cookTimeTicks} ticks.`);
   }


   console.log(`[Smelt] Sẵn sàng dùng ${actualFurnaceType} tại ${formatCoords(furnaceBlock.position)}.`);

    if (!isSystemRequest) bot.chat(`Ok ${username}, bắt đầu nung ${quantity} ${itemToSmeltVi}...`);
    let remainingQuantity = quantity;
    let totalSmelted = 0;
    let furnaceWindow = null;
    let success = false;

    try {
        while (remainingQuantity > 0) {
            console.log(`[Smelt Loop] Cần nung: ${remainingQuantity}. Mở lò ${actualFurnaceType}...`);
            // Mở đúng loại lò
            if (actualFurnaceType === BLAST_FURNACE_ID_NAME) furnaceWindow = await bot.openBlastFurnace(furnaceBlock);
            else if (actualFurnaceType === SMOKER_ID_NAME) furnaceWindow = await bot.openSmoker(furnaceBlock);
            else furnaceWindow = await bot.openFurnace(furnaceBlock); // Mặc định là lò thường

            const currentFuel = findAvailableFuel(bot, mcData); // Kiểm tra lại fuel
            if (!currentFuel) {
                console.log("[Smelt Loop] Hết nhiên liệu!");
                if (!isSystemRequest) bot.chat("Hết nhiên liệu rồi!");
                break;
            }
            const currentInput = bot.inventory.count(inputItemId, null);              if (currentInput === 0) {
                 console.log("[Smelt Loop] Hết nguyên liệu đầu vào!");
                 break;
             }

             const amountToPutIn = Math.min(remainingQuantity, currentInput, inputItemData.stackSize);
             const fuelToPutIn = 1; // Nạp 1 fuel mỗi lần
 
             console.log(`[Smelt Loop] Nạp ${amountToPutIn} input (ID ${inputItemId}), ${fuelToPutIn} fuel (ID ${currentFuel.item.id})...`);
             // Nạp fuel trước
             if(!furnaceWindow.fuelItem() || furnaceWindow.fuel < 5) {
                  try {
                      await furnaceWindow.putFuel(currentFuel.item.id, null, fuelToPutIn);
                      await sleep(250); // Chờ server xử lý
                  } catch (fuelErr) { console.error("Lỗi nạp fuel:", fuelErr.message); await sleep(200); }
              }
              // Nạp input
              try {
                 await furnaceWindow.putInput(inputItemId, null, amountToPutIn);
                 await sleep(250); // Chờ server xử lý
              } catch (inputErr) { console.error("Lỗi nạp input:", inputErr.message); await sleep(200); break;}
 
 
             console.log(`[Smelt Loop] Chờ nung ${amountToPutIn} item (khoảng ${Math.ceil(cookTimeTicks / 20 * amountToPutIn)} giây)...`);
             let smeltedInThisBatch = 0;
             const checkInterval = 500; // ms
             // Tính toán thời gian chờ tối đa hợp lý hơn
             const maxWaitTimePerItem = (cookTimeTicks / 20) * 1.1 * 1000; // Time per item (s) * 1.1 buffer * 1000 ms/s
             const maxWaitTime = (maxWaitTimePerItem * amountToPutIn) + 5000; // Total time + 5s buffer
             let waitedTime = 0;
             let lastOutputCheckTime = Date.now();
 
             while (smeltedInThisBatch < amountToPutIn && waitedTime < maxWaitTime) {
                 await sleep(checkInterval);
                 waitedTime += checkInterval;
 
                 // Lấy output định kỳ
                  if (Date.now() - lastOutputCheckTime > 1000) {
                      const outputSlotItem = furnaceWindow.outputItem();
                      // Kiểm tra đúng loại item output
                      if (outputSlotItem && outputSlotItem.type === outputItemId && outputSlotItem.count > 0) {
                          const countInSlot = outputSlotItem.count;
                          console.log(`[Smelt Wait] Có ${countInSlot} ${outputItemName}. Lấy ra...`);
                          try {
                              await furnaceWindow.takeOutput(null);
                              await sleep(150);
                              smeltedInThisBatch += countInSlot;
                              totalSmelted += countInSlot;
                              remainingQuantity = Math.max(0, quantity - totalSmelted); // Cập nhật số lượng còn lại
                              console.log(`[Smelt Wait] Lấy ${countInSlot}. Tổng: ${totalSmelted}. Còn lại: ${remainingQuantity}`);
                              lastOutputCheckTime = Date.now();
                              if (remainingQuantity <= 0) break; // Đã xong
                          } catch (takeErr) {
                              console.error("[Smelt Wait] Lỗi lấy output:", takeErr.message);
                              if (takeErr.message.toLowerCase().includes('space')) {
                                   if (!isSystemRequest) bot.chat("Túi đồ đầy, không lấy đồ nung ra được!");
                                   // Cần thêm logic xử lý túi đầy (ví dụ: dừng lại)
                                   await furnaceWindow.close(); // Đóng lò nếu túi đầy
                                   return false; // Thoát hàm smeltItem
                              }
                              await sleep(500);
                          }
                      } else {
                          lastOutputCheckTime = Date.now(); // Reset timer ngay cả khi không có output
                      }
 
                      // Kiểm tra lò có dừng đột ngột không
                      if (!furnaceWindow.inputItem() && !furnaceWindow.fuelItem() && !furnaceWindow.outputItem() && furnaceWindow.progress === 0) {
                          console.warn("[Smelt Wait] Lò trống và không hoạt động. Dừng chờ batch này.");
                          break;
                      }
                       if (furnaceWindow.fuel === 0 && !furnaceWindow.outputItem() && furnaceWindow.progress === 0 && smeltedInThisBatch < amountToPutIn) {
                            console.warn("[Smelt Wait] Lò hết nhiên liệu giữa chừng batch.");
                            break;
                       }
                  }
                  if (remainingQuantity <= 0) break;
             } // Kết thúc vòng lặp chờ
 
             console.log(`[Smelt Loop] Batch kết thúc. Nung được: ${smeltedInThisBatch}/${amountToPutIn}. Tổng: ${totalSmelted}. Chờ: ${waitedTime}ms / ${maxWaitTime}ms`);
 
             await furnaceWindow.close();
             furnaceWindow = null;
             await sleep(300); // Nghỉ giữa các batch
 
             if (totalSmelted >= quantity) break; // Đã đủ số lượng
             // Kiểm tra lý do dừng batch sớm
             if (smeltedInThisBatch < amountToPutIn && remainingQuantity > 0) {
                  console.warn("[Smelt Loop] Không nung hết batch.");
                  const currentInputAfterBatch = bot.inventory.count(inputItemId, null);
                  const currentFuelAfterBatch = findAvailableFuel(bot, mcData);
                  if (currentInputAfterBatch === 0) {
                      console.log("[Smelt Loop] Xác nhận hết nguyên liệu đầu vào trong túi.");
                      if (!isSystemRequest) bot.chat("Hết nguyên liệu để nung rồi.");
                      break;
                  }
                  if (!currentFuelAfterBatch) {
                      console.log("[Smelt Loop] Xác nhận hết nhiên liệu trong túi.");
                       if (!isSystemRequest) bot.chat("Hết nhiên liệu để nung rồi.");
                      break;
                  }
                  if (waitedTime >= maxWaitTime) {
                      console.warn("[Smelt Loop] Hết giờ chờ tối đa cho batch.");
                       if (!isSystemRequest) bot.chat("Có vẻ lò bị lỗi hoặc chờ quá lâu.");
                      break; // Dừng hẳn nếu hết giờ
                  }
                  // Nếu còn nguyên liệu/fuel và chưa hết giờ, có thể thử lại
                  console.log("[Smelt Loop] Vẫn còn nguyên liệu/nhiên liệu, có thể do lỗi tạm thời. Sẽ thử lại ở batch sau.");
                  await sleep(1000);
             }
 
         } // Kết thúc vòng lặp while (remainingQuantity > 0)
 
         // --- Thông báo kết quả ---
         if (totalSmelted >= quantity) {
              console.log(`[Smelt] Nung thành công ${totalSmelted} ${outputItemName}.`);
              if (!isSystemRequest) bot.chat(`${username}, đã nung xong ${totalSmelted} ${itemToSmeltVi} thành ${outputItemName}!`);
              success = true;
         } else {
              console.log(`[Smelt] Kết thúc. Nung được ${totalSmelted}/${quantity} ${outputItemName}.`);
              if (!isSystemRequest) bot.chat(`${username}, chỉ nung được ${totalSmelted}/${quantity} ${itemToSmeltVi}.`);
              success = totalSmelted > 0; // Thành công nếu nung được ít nhất 1 cái
         }
 
     } catch (err) {
         console.error("[Smelt] Lỗi nghiêm trọng khi nung:", err);
         if (!isSystemRequest) bot.chat(`Lỗi khi nung ${itemToSmeltVi}: ${err.message}`);
         success = false;
     } finally {
         if (furnaceWindow) {
             try { await furnaceWindow.close(); } catch (closeErr) { console.warn("Lỗi đóng lò sót:", closeErr.message); }
         }
         console.log(`[Smelt] === Kết thúc smelt cho ${isSystemRequest ? 'System' : username}: "${message}" ===`);
     }
 
     return success;
 }

module.exports = {
    craftItem,
    smeltItem,
};

// --- END OF FILE craft.js ---