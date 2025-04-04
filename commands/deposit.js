// --- START OF FILE commands/deposit.js ---

const { GoalNear } = require("mineflayer-pathfinder").goals;
const { Vec3 } = require("vec3");
// Sửa đường dẫn import cho phù hợp với vị trí file commands/deposit.js
const { translateToEnglishId, formatCoords } = require("../utils"); // Đi lên 1 cấp rồi vào utils
const { getItemCategory, categoryKeywords, findCategoryFromKeywords } = require("../utils/item_categories"); // Đi lên 1 cấp rồi vào utils/item_categories

const MAX_CHEST_FIND_DISTANCE = 10;
const REACH_CHEST_DIST = 2.5;
const DEPOSIT_DELAY_TICKS = 3;
const MAX_DEPOSIT_ATTEMPTS_PER_ITEM = 2;

// --- findNearestChest ---
async function findNearestChest(bot) {
    console.log(`[Deposit Find] Tìm rương thường gần nhất (trong ${MAX_CHEST_FIND_DISTANCE} block)...`);
    const mcData = require('minecraft-data')(bot.version);
    const chestType = mcData.blocksByName.chest;
    if (!chestType) {
        console.error("[Deposit Find] Không tìm thấy ID cho 'chest' trong mcData!");
        return null;
    }

    const chest = bot.findBlock({
        matching: chestType.id,
        maxDistance: MAX_CHEST_FIND_DISTANCE,
        useExtraInfo: (block) => {
            const trappedChestType = mcData.blocksByName.trapped_chest;
            return !trappedChestType || block.type !== trappedChestType.id;
        }
    });

    if (chest) {
        console.log(`[Deposit Find] Tìm thấy rương tại ${formatCoords(chest.position)}.`);
        return chest;
    } else {
        console.log("[Deposit Find] Không tìm thấy rương nào gần đây.");
        return null;
    }
}

// --- startDepositTask ---
async function startDepositTask(bot, username, message, aiModel) {
    console.log(`[Deposit Cmd] Xử lý yêu cầu cất đồ từ ${username}: "${message}"`);

    if (bot.isFinding || bot.isFollowing || bot.isProtecting || bot.isCollecting || bot.isStripMining || bot.isHunting || bot.isCleaningInventory || bot.isDepositing) {
        let reason = bot.isFinding ? 'tìm đồ' : (bot.isFollowing ? 'đi theo' : (bot.isProtecting ? 'bảo vệ' : (bot.isCollecting ? 'thu thập' : (bot.isStripMining ? 'đào hầm' : (bot.isHunting ? 'săn bắn' : (bot.isCleaningInventory ? 'dọn túi đồ' : 'cất đồ'))))));
        bot.chat(`${username}, tôi đang bận ${reason} rồi!`);
        return;
    }

    // --- Bước 1: Trích xuất vật phẩm hoặc danh mục ---
    const extractionPrompt = `Từ tin nhắn "${message}" của người chơi "${username}" muốn cất đồ vào rương, xác định xem họ muốn cất một LOẠI VẬT PHẨM CỤ THỂ (kèm số lượng nếu có, mặc định là tất cả) hay một DANH MỤC VẬT PHẨM (ví dụ: khoáng sản, đồ ăn, vũ khí, công cụ, đồ farm, gỗ, đá, khối xây dựng, đá đỏ, thuốc, đồ trang trí, đồ quý, rác) hay TẤT CẢ mọi thứ.
    Ưu tiên xác định DANH MỤC nếu có từ khóa như 'khoáng sản', 'đồ ăn', 'vũ khí', 'công cụ', 'đồ farm', 'gỗ', 'đá', 'khối xây dựng', 'đá đỏ', 'thuốc', 'đồ trang trí', 'đồ quý', 'rác', 'tất cả', 'hết', 'mọi thứ'.
    Nếu không có danh mục, hãy trích xuất TÊN VẬT PHẨM CỤ THỂ và SỐ LƯỢNG (nếu không nói số lượng hoặc nói 'hết', dùng "all").

    Chỉ trả lời bằng định dạng JSON với cấu trúc:
    - Nếu là danh mục: {"depositType": "category", "value": "tên_danh_mục_tiếng_anh"} (ví dụ: {"depositType": "category", "value": "ores"}, {"depositType": "category", "value": "food"}, {"depositType": "category", "value": "all"})
    - Nếu là vật phẩm cụ thể: {"depositType": "item", "value": "tên_vật_phẩm_tiếng_việt", "quantity": số_lượng_hoặc_"all"} (ví dụ: {"depositType": "item", "value": "đá cuội", "quantity": 32}, {"depositType": "item", "value": "gỗ sồi", "quantity": "all"})

    Ví dụ:
    1. "cất hết khoáng sản vào rương" -> {"depositType": "category", "value": "ores"}
    2. "cất đồ ăn đi" -> {"depositType": "category", "value": "food"}
    3. "cất 32 đá cuội" -> {"depositType": "item", "value": "đá cuội", "quantity": 32}
    4. "cất hết gỗ sồi vào đây" -> {"depositType": "item", "value": "gỗ sồi", "quantity": "all"}
    5. "cất hết đồ vào rương" -> {"depositType": "category", "value": "all"}
    6. "dọn rác đi" -> {"depositType": "category", "value": "junk"}

    Tin nhắn: "${message}"
    JSON:`;

    let depositRequest = { type: null, value: null, quantity: null };

    try {
        console.debug("[Deposit Cmd] Bước 1: Gửi prompt trích xuất loại/danh mục...");
        const extractResult = await aiModel.generateContent(extractionPrompt);
        const jsonResponse = (await extractResult.response.text()).trim();
        console.debug("[Deposit Cmd] Bước 1: Phản hồi JSON thô:", jsonResponse);
        let parsedData;
        const jsonMatch = jsonResponse.match(/\{.*\}/s);
        if (jsonMatch) parsedData = JSON.parse(jsonMatch[0]);
        else throw new Error("Không tìm thấy JSON.");

        if (!parsedData.depositType || !parsedData.value) {
            throw new Error("JSON trả về không hợp lệ (thiếu depositType hoặc value).");
        }

        depositRequest.type = parsedData.depositType;
        depositRequest.value = parsedData.value;

        if (depositRequest.type === 'item') {
            depositRequest.quantity = parsedData.quantity === "all" ? "all" : (parseInt(parsedData.quantity, 10) || "all");
            if (typeof depositRequest.quantity === 'number' && depositRequest.quantity <= 0) depositRequest.quantity = "all";
            console.log(`[Deposit Cmd] Bước 1: AI trích xuất: Loại=item, Tên="${depositRequest.value}", Số lượng=${depositRequest.quantity}`);
        } else if (depositRequest.type === 'category') {
             console.log(`[Deposit Cmd] Bước 1: AI trích xuất: Loại=category, Danh mục="${depositRequest.value}"`);
             const validCategories = Object.keys(categoryKeywords);
             if (!validCategories.includes(depositRequest.value)) {
                  console.warn(`[Deposit Cmd] AI trả về danh mục không xác định: ${depositRequest.value}. Thử tìm lại bằng từ khóa...`);
                  const foundCategory = findCategoryFromKeywords(message);
                  if (foundCategory) {
                      console.log(`[Deposit Cmd] Tìm thấy danh mục bằng từ khóa: ${foundCategory}`);
                      depositRequest.value = foundCategory;
                  } else {
                      throw new Error(`AI trả về danh mục không hợp lệ '${depositRequest.value}' và không tìm thấy từ khóa phù hợp.`);
                  }
             }
        } else {
            throw new Error(`AI trả về depositType không hợp lệ: ${depositRequest.type}`);
        }

    } catch (error) {
        console.error("[Deposit Cmd] Bước 1: Lỗi trích xuất hoặc xử lý JSON:", error);
        bot.chat(`Xin lỗi ${username}, tôi không hiểu yêu cầu cất đồ của bạn.`);
        return;
    }

    // --- Bước 2: Lọc danh sách vật phẩm cần cất ---
    const mcData = require("minecraft-data")(bot.version);
    let itemsToDepositList = [];

    if (depositRequest.type === 'item') {
        const itemNameVi = depositRequest.value;
        const quantity = depositRequest.quantity;
        // *** SỬ DỤNG HÀM DỊCH MỚI TỪ UTILS.JS ***
        const itemId = translateToEnglishId(itemNameVi);
        if (!itemId) {
            // Hàm translateToEnglishId đã chuẩn hóa và thử bỏ tiền tố
            bot.chat(`Xin lỗi ${username}, tôi không biết "${itemNameVi}" là gì.`);
            console.warn(`[Deposit Cmd] Không dịch được "${itemNameVi}" bằng hàm mới.`);
            return;
        }
        const itemType = mcData.itemsByName[itemId];
        if (!itemType) {
            // Trường hợp này ít xảy ra nếu localization file đầy đủ
            bot.chat(`Xin lỗi ${username}, "${itemNameVi}" (${itemId}) không phải là vật phẩm hợp lệ trong dữ liệu game.`);
            console.error(`[Deposit Cmd] Lỗi: ID "${itemId}" từ bản dịch không tồn tại trong mcData.itemsByName.`);
            return;
        }

        const totalAmountInInventory = bot.inventory.count(itemType.id, null);
        if (totalAmountInInventory === 0) {
            bot.chat(`Xin lỗi ${username}, tôi không có "${itemNameVi}" nào trong túi đồ cả.`);
            return;
        }

        let amountToDeposit = 0;
        if (quantity === "all") {
            amountToDeposit = totalAmountInInventory;
        } else {
            if (totalAmountInInventory < quantity) {
                bot.chat(`Tôi chỉ có ${totalAmountInInventory} ${itemNameVi}, không đủ ${quantity}. Tôi sẽ cất hết ${totalAmountInInventory} cái nhé.`);
                amountToDeposit = totalAmountInInventory;
            } else {
                amountToDeposit = quantity;
            }
        }

        if (amountToDeposit > 0) {
            const itemInfo = mcData.items[itemType.id];
            itemsToDepositList.push({
                id: itemType.id,
                metadata: null,
                count: amountToDeposit,
                name: itemId,
                nameVi: itemInfo?.displayName || itemNameVi
            });
            console.log(`[Deposit Cmd] Bước 2: Sẽ cất ${amountToDeposit} ${itemId} (ID: ${itemType.id})`);
        } else {
             bot.chat(`Số lượng ${itemNameVi} cần cất không hợp lệ.`);
             return;
        }

    } else if (depositRequest.type === 'category') {
        const categoryName = depositRequest.value;
        console.log(`[Deposit Cmd] Bước 2: Lọc vật phẩm thuộc danh mục '${categoryName}'...`);
        let totalItemsInCategory = 0;

        const targetCategoryIds = categoryName === 'all'
            ? Object.values(categoryKeywords).flat().filter(c => c !== 'all')
            : categoryKeywords[categoryName];

        if (!targetCategoryIds && categoryName !== 'all') {
             console.error(`[Deposit Cmd] Danh mục '${categoryName}' không được định nghĩa trong categoryKeywords.`);
             bot.chat(`Tôi không hiểu danh mục '${categoryName}'.`);
             return;
        }

        console.debug(`[Deposit Cmd] Danh mục ID mục tiêu: ${targetCategoryIds ? targetCategoryIds.join(', ') : 'Tất cả (có lọc)'}`);

        for (const item of bot.inventory.items()) {
            if (!item) continue;
            const itemFullInfo = mcData.items[item.type];
            if (!itemFullInfo) {
                console.warn(`[Deposit Cmd] Không tìm thấy thông tin cho item ID ${item.type} trong mcData.`);
                continue;
            }

            const itemCat = getItemCategory(itemFullInfo);
            console.debug(`  - Kiểm tra: ${item.count}x ${item.name} (ID: ${item.type}, Meta: ${item.metadata}), Category: ${itemCat}`);

            let shouldDeposit = false;
            if (categoryName === 'all') {
                const isArmor = getItemCategory(itemFullInfo) === 'armor_equipment';
                const isToolWeapon = getItemCategory(itemFullInfo) === 'tool' || getItemCategory(itemFullInfo) === 'weapon' || getItemCategory(itemFullInfo) === 'tool_weapon';
                const isHeld = bot.heldItem && bot.heldItem.slot === item.slot;
                const isFood = getItemCategory(itemFullInfo).startsWith('food');
                if (!isHeld && !isArmor && !isToolWeapon && !isFood) {
                    shouldDeposit = true;
                    console.debug(`    -> Thuộc loại 'all' (đã lọc).`);
                } else {
                    console.debug(`    -> Bị loại khỏi 'all' (held=${isHeld}, armor=${isArmor}, tool/weapon=${isToolWeapon}, food=${isFood}).`);
                }
            } else if (targetCategoryIds.includes(itemCat)) {
                shouldDeposit = true;
                 console.debug(`    -> Thuộc danh mục '${categoryName}'.`);
            } else {
                 console.debug(`    -> Không thuộc danh mục '${categoryName}'.`);
            }

            if (shouldDeposit) {
                console.log(`    -> Thêm vào danh sách cất: ${item.count}x ${item.name}`);
                itemsToDepositList.push({
                    id: item.type,
                    metadata: item.metadata,
                    count: item.count,
                    name: item.name,
                    nameVi: itemFullInfo.displayName
                });
                totalItemsInCategory += item.count;
            }
        }

        if (itemsToDepositList.length === 0) {
            bot.chat(`Tôi không tìm thấy vật phẩm nào thuộc danh mục '${categoryName}' ${categoryName === 'all' ? '(sau khi lọc)' : ''} trong túi đồ để cất cả.`);
            return;
        }
        console.log(`[Deposit Cmd] Bước 2: Tìm thấy ${itemsToDepositList.length} stack (${totalItemsInCategory} vật phẩm) thuộc danh mục '${categoryName}' cần cất.`);

    } else {
        console.error(`[Deposit Cmd] depositType không xác định: ${depositRequest.type}`);
        return;
    }

    // --- Bước 3: Tìm rương ---
    const targetChest = await findNearestChest(bot);
    if (!targetChest) {
        bot.chat(`Xin lỗi ${username}, tôi không tìm thấy cái rương nào gần đây để cất đồ.`);
        return;
    }

    // --- Bước 4: Khởi tạo task ---
    bot.isDepositing = true;
    bot.depositTaskDetails = {
        username: username,
        targetChest: targetChest,
        itemsToDeposit: itemsToDepositList,
        currentItemIndex: 0,
        status: 'finding_chest',
    };

    const depositSummary = depositRequest.type === 'item'
        ? `${itemsToDepositList[0].count} ${itemsToDepositList[0].nameVi}`
        : `các vật phẩm thuộc danh mục '${depositRequest.value}'`;
    bot.chat(`Ok ${username}, tôi sẽ cất ${depositSummary} vào rương ở ${formatCoords(targetChest.position)}.`);

    // --- Bước 5: Bắt đầu quá trình cất đồ ---
    depositItemsProcess(bot);
}

// --- depositItemsProcess ---
async function depositItemsProcess(bot) {
    if (!bot.isDepositing || !bot.depositTaskDetails) {
        console.log("[Deposit Process] Dừng: Không có task hoặc không depositing.");
        return;
    }
    const task = bot.depositTaskDetails;
    const chestBlock = task.targetChest;

    try {
        // --- Di chuyển đến rương ---
        if (task.status !== 'moving' && task.status !== 'opening' && task.status !== 'depositing' && task.status !== 'closing') {
            task.status = 'moving';
            console.log(`[Deposit Process] Di chuyển đến rương tại ${formatCoords(chestBlock.position)}`);
            const goal = new GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, REACH_CHEST_DIST);
            await bot.pathfinder.goto(goal);
            console.log(`[Deposit Process] Đã đến gần rương.`);
            task.status = 'reached_chest';
        }

        // --- Mở rương ---
        let chestWindow = bot.currentWindow;
        if (!chestWindow || chestWindow.type !== 'minecraft:chest') {
             if (task.status !== 'opening') {
                task.status = 'opening';
                console.log(`[Deposit Process] Mở rương tại ${formatCoords(chestBlock.position)}...`);
                await bot.lookAt(chestBlock.position.offset(0.5, 0.5, 0.5), true);
                try {
                    chestWindow = await bot.openChest(chestBlock);
                    console.log(`[Deposit Process] Đã mở rương (Title: ${chestWindow.title}).`);
                } catch (openError) {
                     console.error(`[Deposit Process] Lỗi khi mở rương: ${openError.message}`);
                     throw new Error(`Không thể mở rương: ${openError.message}`);
                }
             } else {
                  console.debug("[Deposit Process] Đang ở trạng thái opening, chờ mở xong...");
                  setTimeout(() => depositItemsProcess(bot), 500);
                  return;
             }
        } else {
             console.debug("[Deposit Process] Rương đã được mở.");
        }

        // --- Cất vật phẩm ---
        task.status = 'depositing';
        let chestFull = false;
        let depositedSomething = false;
        let failedItemsSummary = [];

        console.log(`[Deposit Process] Bắt đầu quá trình cất ${task.itemsToDeposit.length - task.currentItemIndex} loại vật phẩm còn lại...`);

        while (task.currentItemIndex < task.itemsToDeposit.length && !chestFull) {
            const item = task.itemsToDeposit[task.currentItemIndex];
            console.log(`[Deposit Process] Chuẩn bị cất item ${task.currentItemIndex + 1}/${task.itemsToDeposit.length}: ${item.count}x ${item.name} (ID: ${item.id}, Meta: ${item.metadata})`);

            const currentItemCount = bot.inventory.count(item.id, item.metadata);
            if (currentItemCount < item.count) {
                 console.warn(`  -> Số lượng ${item.name} trong túi đồ (${currentItemCount}) ít hơn dự kiến (${item.count}). Chỉ cất số lượng hiện có.`);
                 item.count = currentItemCount;
            }

            if (item.count <= 0) {
                 console.log(`  -> Không còn ${item.name} để cất. Bỏ qua.`);
                 task.currentItemIndex++;
                 continue;
            }

            let attempts = 0;
            let depositSuccess = false;
            while (attempts < MAX_DEPOSIT_ATTEMPTS_PER_ITEM && !depositSuccess) {
                attempts++;
                try {
                    console.debug(`  -> Thử cất lần ${attempts}...`);
                    await chestWindow.deposit(item.id, item.metadata, item.count);
                    console.log(`  -> Đã cất thành công ${item.count}x ${item.name} (Lần thử ${attempts}).`);
                    depositSuccess = true;
                    depositedSomething = true;
                    await bot.waitForTicks(DEPOSIT_DELAY_TICKS);
                } catch (depositError) {
                    console.warn(`  -> Lỗi khi cất ${item.name} (Lần thử ${attempts}):`, depositError.message);
                    if (depositError.message.toLowerCase().includes('full') || depositError.message.toLowerCase().includes('overflow')) {
                        console.error("[Deposit Process] Rương đầy! Dừng cất thêm.");
                        chestFull = true;
                        break;
                    }
                    await bot.waitForTicks(DEPOSIT_DELAY_TICKS * 2);
                }
            }

            if (!depositSuccess && !chestFull) {
                 console.error(`[Deposit Process] Không thể cất ${item.count}x ${item.name} sau ${MAX_DEPOSIT_ATTEMPTS_PER_ITEM} lần thử (không phải lỗi đầy).`);
                 failedItemsSummary.push(`${item.count} ${item.nameVi || item.name}`);
            }

            task.currentItemIndex++;
        }

        // --- Đóng rương ---
        task.status = 'closing';
        console.log(`[Deposit Process] Đã xử lý xong danh sách. Đóng rương...`);
        await chestWindow.close();
        console.log(`[Deposit Process] Đã đóng rương.`);

        // --- Thông báo kết quả ---
        if (chestFull) {
            let message = `Đã cất một số đồ nhưng rương bị đầy.`;
            let remainingItems = [];
            for (let i = task.currentItemIndex; i < task.itemsToDeposit.length; i++) {
                 const item = task.itemsToDeposit[i];
                 remainingItems.push(`${item.count} ${item.nameVi || item.name}`);
            }
            if (remainingItems.length > 0) {
                 message += ` Còn lại trong túi: ${remainingItems.join(', ')}.`;
            }
             finishDepositTask(bot, false, message);
        } else if (failedItemsSummary.length > 0) {
             finishDepositTask(bot, false, `Đã cất xong nhưng gặp lỗi không rõ nguyên nhân với: ${failedItemsSummary.join(', ')}.`);
        } else if (depositedSomething) {
             finishDepositTask(bot, true, `Đã cất xong các vật phẩm yêu cầu vào rương.`);
        } else {
             finishDepositTask(bot, false, `Không cất được vật phẩm nào vào rương (có thể do lỗi hoặc không có gì phù hợp).`);
        }

    } catch (error) {
        console.error("[Deposit Process] Lỗi nghiêm trọng trong quá trình cất đồ:", error.message, error.stack);
        try {
            if (bot.currentWindow && bot.currentWindow.type === 'minecraft:chest') {
                await bot.closeWindow(bot.currentWindow);
                console.log("[Deposit Process] Đã đóng rương sau lỗi nghiêm trọng.");
            }
        } catch (closeError) {
             console.error("[Deposit Process] Lỗi khi đóng rương sau lỗi nghiêm trọng:", closeError.message);
        }
        finishDepositTask(bot, false, `Gặp lỗi hệ thống khi đang cất đồ: ${error.message}`);
    }
}

// --- finishDepositTask ---
function finishDepositTask(bot, success, message) {
    if (!bot.isDepositing) {
        console.debug("[Deposit Finish] Called finishDepositTask but bot is not depositing.");
        return;
    }
    const task = bot.depositTaskDetails;
    const username = task?.username || "bạn";
    console.log(`[Deposit Finish] Kết thúc nhiệm vụ cho ${username}. Thành công: ${success}. Lý do: ${message}`);
    bot.chat(`${username}, ${message}`);

    bot.isDepositing = false;
    bot.depositTaskDetails = null;
    try {
        if (bot.pathfinder.isMoving()) {
            console.log("[Deposit Finish] Stopping pathfinder.");
            bot.pathfinder.stop();
        }
    } catch(e) {
        console.error("[Deposit Finish] Lỗi khi dừng pathfinder:", e);
    }
}

// --- stopDepositTask ---
function stopDepositTask(bot, usernameOrReason) {
     if (bot.isDepositing) {
        console.log(`[Deposit Stop] Yêu cầu dừng từ: ${usernameOrReason}`);
        const currentWindow = bot.currentWindow;
        if (currentWindow && currentWindow.type === 'minecraft:chest') {
             console.log("[Deposit Stop] Đang mở rương, cố gắng đóng lại...");
             try {
                 bot.closeWindow(currentWindow);
                 console.log("[Deposit Stop] Đã gửi lệnh đóng rương.");
             } catch (closeError) {
                  console.error("[Deposit Stop] Lỗi khi gửi lệnh đóng rương:", closeError.message);
             }
        }
        const reasonMessage = typeof usernameOrReason === 'string'
            ? `Đã dừng việc cất đồ theo yêu cầu của ${usernameOrReason}.`
            : `Đã dừng việc cất đồ.`;
        finishDepositTask(bot, false, reasonMessage);
    } else {
         console.debug("[Deposit Stop] Called stopDepositTask but bot is not depositing.");
    }
}

module.exports = {
    startDepositTask,
    stopDepositTask,
};
// --- END OF FILE commands/deposit.js ---