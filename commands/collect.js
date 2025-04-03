// --- START OF FILE collect.js ---

const { GoalNear } = require("mineflayer-pathfinder").goals;
const { Vec3 } = require("vec3");
const { translateToEnglishId, formatCoords } = require("../utils");

const MAX_COLLECT_FIND_DISTANCE = 64;
const REACH_BLOCK_DIST = 1.5;
const CHECK_INTERVAL = 500;
const ITEM_PICKUP_WAIT_TICKS = 10;
const ITEM_PICKUP_MAX_ATTEMPTS = 6;

const toolMaterialTier = {
  wooden: 1,
  stone: 2,
  golden: 3,
  iron: 4,
  diamond: 5,
  netherite: 6,
};

function countItemManually(inventory, targetItemId) { // Đổi tên tham số cho rõ ràng
    let total = 0;
    if (targetItemId === null || targetItemId === undefined) {
        console.error("[Count Item] Lỗi: targetItemId không hợp lệ!");
        return 0;
    }
    for (const item of inventory.items()) {
        if (item && item.type === targetItemId) { // So sánh với targetItemId
            total += item.count;
        }
    }
    return total;
}

async function equipBestTool(bot, toolType) {
  console.debug(`[Collect Equip] Bắt đầu tìm công cụ loại '${toolType}'`);
  const mcData = require("minecraft-data")(bot.version);
  let bestTool = null;
  let bestTier = 0;

  const currentTool = bot.heldItem;
  if (currentTool && currentTool.name.includes(toolType)) {
    const material = currentTool.name.split("_")[0];
    bestTier = toolMaterialTier[material] || 0;
    bestTool = currentTool;
    console.debug(`[Collect Equip] Đang cầm: ${currentTool.name} (Tier: ${bestTier})`);
  }

  for (const item of bot.inventory.items()) {
    if (item.name.includes(toolType)) {
      const material = item.name.split("_")[0];
      const tier = toolMaterialTier[material] || 0;
      if (tier > bestTier) {
        bestTier = tier;
        bestTool = item;
        console.debug(`[Collect Equip] Tìm thấy công cụ tốt hơn: ${item.name} (Tier: ${tier})`);
      }
    }
  }

  if (bestTool && bot.heldItem?.name !== bestTool.name) {
    try {
      console.log(`[Collect Equip] Đang trang bị ${bestTool.name}...`);
      await bot.equip(bestTool, "hand");
      console.log(`[Collect Equip] Đã trang bị ${bestTool.name}.`);
      return true;
    } catch (err) {
      console.error(`[Collect Equip] Lỗi khi trang bị ${bestTool.name}:`, err.message);
      bot.chat(`Tôi không thể trang bị ${bestTool.displayName || bestTool.name}!`);
      return false;
    }
  } else if (bestTool) {
    console.debug(`[Collect Equip] Đã cầm sẵn công cụ tốt nhất (${bestTool.name}).`);
    return true;
  } else {
    console.log(`[Collect Equip] Không tìm thấy công cụ loại '${toolType}' nào.`);
    bot.chat(`Tôi không có ${toolType} để đào!`);
    return false;
  }
}

function findNextBlock(bot, taskDetails) {
  const mcData = require("minecraft-data")(bot.version);
  // Tìm khối dựa trên itemType (block info) đã lưu
  const blockType = taskDetails.itemType;
  if (!blockType) {
      console.error(`[Collect Find] Không tìm thấy blockType trong taskDetails cho itemId: ${taskDetails.itemId}`);
      return null;
  }

  console.debug(`[Collect Find] Tìm kiếm khối ${taskDetails.itemId} (ID: ${blockType.id}) gần nhất...`);
  const foundBlock = bot.findBlock({
    matching: blockType.id, // Sử dụng ID khối để tìm
    maxDistance: MAX_COLLECT_FIND_DISTANCE,
    count: 1,
  });

  if (foundBlock) {
    console.log(`[Collect Find] Tìm thấy khối ${taskDetails.itemId} tại ${formatCoords(foundBlock.position)}.`);
    return foundBlock;
  } else {
    console.log(`[Collect Find] Không tìm thấy khối ${taskDetails.itemId} nào khác trong phạm vi ${MAX_COLLECT_FIND_DISTANCE} block.`);
    return null;
  }
}

async function collectionLoop(bot) {
    if (!bot.collectingTaskDetails || !bot.isCollecting) {
        console.log("[Collect Loop] Vòng lặp dừng: Không có nhiệm vụ hoặc isCollecting=false.");
        return;
    }

    const task = bot.collectingTaskDetails;
    const mcData = require("minecraft-data")(bot.version); // Cần mcData để lấy tên item từ ID

    // *** ID QUAN TRỌNG: ID của vật phẩm cần đếm ***
    const countItemId = task.droppedItemId;
    if (countItemId === null || countItemId === undefined) {
         console.error("[Collect Loop] Lỗi nghiêm trọng: task.droppedItemId không hợp lệ!");
         finishCollectingTask(bot, false, `Lỗi hệ thống: Không xác định được ID vật phẩm cần đếm.`);
         return;
    }
    const countItemName = mcData.items[countItemId]?.name || `ID ${countItemId}`; // Lấy tên item để log

    try {
        console.debug(`[Collect Loop] Bắt đầu vòng lặp. Trạng thái: ${task.status}`);

        // *** SỬ DỤNG ID VẬT PHẨM RƠI RA (countItemId) ĐỂ ĐẾM ***
        const currentAmount = countItemManually(bot.inventory, countItemId);
        task.currentQuantity = currentAmount;
        console.debug(`[Collect Loop] Kiểm tra số lượng (thủ công): ${currentAmount}/${task.targetQuantity} ${countItemName} (ID: ${countItemId})`);
        if (currentAmount >= task.targetQuantity) {
            // Sử dụng itemNameVi để thông báo cho người dùng
            finishCollectingTask(bot, true, `Đã thu thập đủ ${currentAmount}/${task.targetQuantity} ${task.itemNameVi}.`);
            return;
        }

        if (bot.inventory.emptySlotCount() === 0) {
            console.warn("[Collect Loop] Túi đồ đầy!");
            finishCollectingTask(bot, false, `Túi đồ đầy! Không thể thu thập thêm ${task.itemNameVi}.`);
            return;
        }

        // Tìm khối vẫn dựa trên ID khối (task.itemType.id)
        if (!task.currentTarget || !bot.blockAt(task.currentTarget.position) || bot.blockAt(task.currentTarget.position).type !== task.itemType.id) {
            console.debug(`[Collect Loop] Mục tiêu hiện tại không hợp lệ (cần khối ID ${task.itemType.id}). Tìm khối mới...`);
            task.currentTarget = findNextBlock(bot, task);
            if (!task.currentTarget) {
                finishCollectingTask(bot, false, `Không tìm thấy thêm khối ${task.itemNameVi} nào để thu thập.`);
                return;
            }
            task.status = 'found_target';
            console.log(`[Collect Loop] Đặt mục tiêu mới: ${task.itemId} (khối ID ${task.itemType.id}) tại ${formatCoords(task.currentTarget.position)}`);
        }

        const targetBlock = task.currentTarget;
        const targetPosition = targetBlock.position;

        // --- Check Tool ---
        if (task.requiredToolType !== 'any' &&
            (task.status === 'idle' || task.status === 'found_target' || task.status === 'reached_target'))
        {
            console.debug("[Collect Loop] Checking/Equipping required tool.");
            const equipped = await equipBestTool(bot, task.requiredToolType);
            if (!equipped) {
                finishCollectingTask(bot, false, `Không có công cụ (${task.requiredToolType}) để thu thập ${task.itemNameVi}.`);
                return;
            }
            console.debug("[Collect Loop] Equip check/process completed. Status remains:", task.status);
        }

        // --- Check Distance & Move ---
        const distance = bot.entity.position.distanceTo(targetPosition.offset(0.5, 0.5, 0.5));
        console.debug(`[Collect Loop] Khoảng cách tới mục tiêu ${formatCoords(targetPosition)}: ${distance.toFixed(1)} blocks. Status: ${task.status}`);

        if (distance > REACH_BLOCK_DIST && task.status !== 'moving') {
            if (task.status === 'idle' || task.status === 'found_target' || task.status === 'reached_target') {
                task.status = 'moving';
                console.log(`[Collect Loop] Cần di chuyển đến ${formatCoords(targetPosition)}.`);
                const goal = new GoalNear(targetPosition.x, targetPosition.y, targetPosition.z, REACH_BLOCK_DIST - 0.5);
                try {
                    await bot.pathfinder.goto(goal);
                    console.log(`[Collect Loop] Đã đến gần ${formatCoords(targetPosition)}.`);
                    task.status = 'reached_target';
                    console.debug("[Collect Loop] Di chuyển xong, đặt status thành reached_target.");
                    setTimeout(() => collectionLoop(bot), CHECK_INTERVAL / 2);
                    return;
                } catch (err) {
                    console.error(`[Collect Loop] Lỗi khi di chuyển đến ${formatCoords(targetPosition)}:`, err.message);
                    task.currentTarget = null;
                    task.status = 'idle';
                    bot.chat(`Không đến được chỗ khối ${task.itemNameVi} này, thử tìm khối khác...`);
                    setTimeout(() => collectionLoop(bot), CHECK_INTERVAL);
                    return;
                }
            } else {
                 console.debug(`[Collect Loop] Too far, but status is ${task.status}, not initiating move.`);
                 setTimeout(() => collectionLoop(bot), CHECK_INTERVAL);
                 return;
            }
        }
        else if (distance <= REACH_BLOCK_DIST && (task.status === 'idle' || task.status === 'found_target' || task.status === 'reached_target')) {
             if (task.status !== 'reached_target') {
                console.debug(`[Collect Loop] Đã ở gần mục tiêu, đặt status thành reached_target.`);
                task.status = 'reached_target';
             }
        } else if (task.status === 'moving') {
             console.debug(`[Collect Loop] Close to target but status is still 'moving'. Waiting for pathfinder.`);
             setTimeout(() => collectionLoop(bot), CHECK_INTERVAL);
             return;
        }


        // --- Dig Block ---
        if (task.status === 'reached_target') {
            task.status = 'collecting';
            // Log ID khối sẽ đào
            console.log(`[Collect Loop] Bắt đầu đào khối ${task.itemId} (ID: ${targetBlock.type}) tại ${formatCoords(targetPosition)}.`);

            const blockNow = bot.blockAt(targetPosition);
            // Kiểm tra ID khối trước khi đào
            if (!blockNow || blockNow.type !== task.itemType.id) {
                console.warn(`[Collect Loop] Khối tại ${formatCoords(targetPosition)} đã thay đổi (hiện là ID ${blockNow?.type}, cần ID ${task.itemType.id}) hoặc biến mất trước khi đào.`);
                task.currentTarget = null;
                task.status = 'idle';
                setTimeout(() => collectionLoop(bot), CHECK_INTERVAL / 2);
                return;
            }

            if (!bot.canDigBlock(targetBlock)) {
                console.error(`[Collect Loop] Không thể đào khối ${task.itemId} (ID: ${targetBlock.type}) tại ${formatCoords(targetPosition)}.`);
                bot.chat(`Tôi không đào được khối ${task.itemNameVi} này!`);
                task.currentTarget = null;
                task.status = 'idle';
                setTimeout(() => collectionLoop(bot), CHECK_INTERVAL);
                return;
            }

            try {
                // *** SỬ DỤNG ID VẬT PHẨM RƠI RA (countItemId) ĐỂ ĐẾM ***
                const amountBeforeDig = countItemManually(bot.inventory, countItemId);
                console.debug(`[Collect Loop] Số lượng ${countItemName} (ID: ${countItemId}) trước khi đào (thủ công): ${amountBeforeDig}`);

                await bot.dig(targetBlock);
                console.log(`[Collect Loop] Đã đào xong khối tại ${formatCoords(targetPosition)}.`);
                task.status = 'waiting_pickup';
                console.debug(`[Collect Loop] Chuyển status sang waiting_pickup.`);

                let pickupSuccess = false;
                let attempts = 0;
                console.debug(`[Collect Loop] Bắt đầu chờ nhặt item ${countItemName} (ID: ${countItemId}) (tối đa ${ITEM_PICKUP_MAX_ATTEMPTS} lần, mỗi lần ${ITEM_PICKUP_WAIT_TICKS} ticks)...`);

                while (attempts < ITEM_PICKUP_MAX_ATTEMPTS) {
                    attempts++;
                    console.debug(`[Collect Loop] Chờ nhặt lần ${attempts}/${ITEM_PICKUP_MAX_ATTEMPTS}...`);
                    await bot.waitForTicks(ITEM_PICKUP_WAIT_TICKS);

                    // *** SỬ DỤNG ID VẬT PHẨM RƠI RA (countItemId) ĐỂ ĐẾM ***
                    const amountAfterWait = countItemManually(bot.inventory, countItemId);
                    console.debug(`[Collect Loop] Số lượng ${countItemName} (ID: ${countItemId}) sau khi chờ lần ${attempts} (thủ công): ${amountAfterWait}`);

                    if (amountAfterWait > amountBeforeDig) {
                        console.log(`[Collect Loop] Xác nhận đã nhặt được ${countItemName}! Số lượng mới (thủ công): ${amountAfterWait}`);
                        task.currentQuantity = amountAfterWait;
                        bot.chat(`Đã thu thập ${task.itemNameVi}. Hiện có: ${amountAfterWait}/${task.targetQuantity}`);
                        pickupSuccess = true;
                        break;
                    } else {
                         console.debug(`[Collect Loop] Số lượng ${countItemName} chưa tăng (${amountAfterWait} <= ${amountBeforeDig}), tiếp tục chờ...`);
                    }
                }

                console.debug('[Collect Loop] Inventory check after wait loop:');
                bot.inventory.items().forEach(item => {
                    if(item) console.debug(`  - Slot ${item.slot}: ${item.count}x ${item.name} (ID: ${item.type}, Meta: ${item.metadata})`);
                });

                if (!pickupSuccess) {
                    console.warn(`[Collect Loop] Không xác nhận được việc nhặt ${countItemName} (ID: ${countItemId}) sau ${ITEM_PICKUP_MAX_ATTEMPTS} lần chờ (kiểm tra thủ công).`);
                    task.currentQuantity = countItemManually(bot.inventory, countItemId); // Vẫn cập nhật lại số lượng cuối
                }

                task.currentTarget = null;
                task.status = 'idle';
                console.debug("[Collect Loop] Đặt lại target và status về idle sau khi đào/chờ.");
                setTimeout(() => collectionLoop(bot), CHECK_INTERVAL / 2);
                return;

            } catch (err) {
                console.error(`[Collect Loop] Lỗi trong quá trình đào hoặc chờ nhặt tại ${formatCoords(targetPosition)}:`, err.message);
                task.currentTarget = null;
                task.status = 'idle';
                bot.chat(`Gặp lỗi khi đào ${task.itemNameVi}: ${err.message}`);
                setTimeout(() => collectionLoop(bot), CHECK_INTERVAL);
                return;
            }
        } else {
             console.debug(`[Collect Loop] Status is ${task.status}, not ready to dig yet. Waiting...`);
             setTimeout(() => collectionLoop(bot), CHECK_INTERVAL);
             return;
        }

    } catch (error) {
        console.error("[Collect Loop] Lỗi không mong muốn trong vòng lặp thu thập:", error);
        const itemName = task?.itemNameVi || 'vật phẩm';
        if (bot.isCollecting) {
             finishCollectingTask(bot, false, `Gặp lỗi hệ thống khi đang thu thập ${itemName}.`);
        }
    }
}

async function startCollectingTask(bot, username, message, aiModel) {
  console.log(`[Collect Cmd] Bắt đầu xử lý yêu cầu thu thập từ ${username}: "${message}"`);

  if (bot.isFinding || bot.isFollowing || bot.isProtecting || bot.isCollecting) {
    let reason = bot.isFinding ? "tìm đồ" : bot.isFollowing ? "đi theo" : bot.isProtecting ? "bảo vệ" : "thu thập";
    bot.chat(`${username}, tôi đang bận ${reason} rồi, không thu thập được!`);
    console.log(`[Collect Cmd] Bị chặn do đang ${reason}.`);
    return;
  }

  // --- Bước 1: Trích xuất --- (Giữ nguyên)
  const extractionPrompt = `Từ tin nhắn "${message}" của người chơi "${username}", trích xuất tên vật phẩm/khối họ muốn thu thập và số lượng. Nếu không nói số lượng, mặc định là 16. Chỉ trả lời bằng định dạng JSON với hai khóa: "itemName" (string, giữ nguyên tiếng Việt nếu có) và "quantity" (number). Ví dụ: "lấy cho tôi 32 cục đá cuội" -> {"itemName": "đá cuội", "quantity": 32}. JSON:`;
  let itemNameVi = null;
  let quantity = 16;
  try {
    console.debug("[Collect Cmd] Bước 1: Gửi prompt trích xuất...");
    const extractResult = await aiModel.generateContent(extractionPrompt);
    const jsonResponse = (await extractResult.response.text()).trim();
    console.debug("[Collect Cmd] Bước 1: Phản hồi JSON thô:", jsonResponse);
    let parsedData;
    try {
      const jsonMatch = jsonResponse.match(/\{.*\}/s);
      if (jsonMatch) parsedData = JSON.parse(jsonMatch[0]);
      else throw new Error("Không tìm thấy JSON.");
    } catch (parseError) {
      console.error("[Collect Cmd] Bước 1: Lỗi parse JSON:", parseError, "Response:", jsonResponse);
      if (!jsonResponse.includes("{") && !jsonResponse.includes(":")) {
        itemNameVi = jsonResponse.trim();
        quantity = 16;
        console.warn(`[Collect Cmd] Bước 1 Fallback: Name="${itemNameVi}", Quantity=${quantity}.`);
      } else {
          bot.chat(`Xin lỗi ${username}, tôi không hiểu yêu cầu của bạn.`);
          return;
      }
    }
    if (parsedData) {
      itemNameVi = parsedData.itemName;
      quantity = parseInt(parsedData.quantity, 10) || 16;
    }
    if (!itemNameVi) throw new Error("AI không trích xuất được tên vật phẩm.");
    quantity = Math.max(1, quantity);
    console.log(`[Collect Cmd] Bước 1: AI trích xuất: Tên="${itemNameVi}", Số lượng=${quantity}`);
  } catch (error) {
    console.error("[Collect Cmd] Bước 1: Lỗi trích xuất:", error);
    bot.chat(`Xin lỗi ${username}, tôi không hiểu bạn muốn thu thập gì hoặc số lượng bao nhiêu.`);
    return;
  }

  // --- Bước 2: Dịch, lấy thông tin khối VÀ vật phẩm rơi ra ---
  let itemId; // Tên tiếng Anh (vd: 'dirt')
  let itemInfo; // Thông tin khối (Block object)
  let droppedItemId = null; // ID của vật phẩm rơi ra (để đếm)
  let mcData;
  try {
    console.debug(`[Collect Cmd] Bước 2: Dịch "${itemNameVi}"...`);
    itemId = translateToEnglishId(itemNameVi);
    if (!itemId) {
      bot.chat(`Xin lỗi ${username}, tôi không biết "${itemNameVi}" là gì.`);
      console.warn(`[Collect Cmd] Bước 2: Không dịch được "${itemNameVi}".`);
      return;
    }
    mcData = require("minecraft-data")(bot.version);
    itemInfo = mcData.blocksByName[itemId]; // Lấy thông tin khối

    if (!itemInfo) {
      // Kiểm tra xem có phải item không phải block không
      if (mcData.itemsByName[itemId]) {
        bot.chat(`Xin lỗi ${username}, tôi chưa biết cách thu thập "${itemNameVi}" (không phải khối). Tôi chỉ biết đào khối thôi.`);
        console.warn(`[Collect Cmd] Bước 2: "${itemId}" là item, không phải block.`);
      } else {
        bot.chat(`Xin lỗi ${username}, "${itemNameVi}" (${itemId}) không phải là khối tôi biết cách thu thập.`);
        console.warn(`[Collect Cmd] Bước 2: "${itemId}" không phải là block hợp lệ.`);
      }
      return;
    }
    console.log(`[Collect Cmd] Bước 2: Mục tiêu là khối "${itemId}" (Block ID: ${itemInfo.id}).`);

    // *** LẤY ID VẬT PHẨM RƠI RA ***
    if (itemInfo.drops && itemInfo.drops.length > 0) {
        // Giả định drop đầu tiên là cái chính cần đếm
        droppedItemId = itemInfo.drops[0];
        console.log(`[Collect Cmd] Bước 2: Khối ${itemId} (ID: ${itemInfo.id}) rơi ra vật phẩm có ID: ${droppedItemId}`);
        // Kiểm tra xem ID vật phẩm này có tồn tại không
        if (!mcData.items[droppedItemId]) {
             console.error(`[Collect Cmd] Lỗi: ID vật phẩm rơi ra ${droppedItemId} không tồn tại trong mcData.items!`);
             bot.chat(`Lỗi: Không tìm thấy thông tin vật phẩm rơi ra từ ${itemNameVi}.`);
             return;
        }
    } else {
        // Fallback: Nếu không có thông tin drops, giả định ID vật phẩm = ID khối
        // Điều này có thể sai với một số khối!
        droppedItemId = itemInfo.id;
        console.warn(`[Collect Cmd] Bước 2: Không tìm thấy thông tin 'drops' cho khối ${itemId}. Giả định ID vật phẩm rơi ra = ID khối = ${droppedItemId}. Điều này có thể không chính xác!`);
        // Kiểm tra xem ID này có tồn tại như một item không
         if (!mcData.items[droppedItemId]) {
             console.error(`[Collect Cmd] Lỗi: ID khối ${droppedItemId} (dùng làm fallback) không tồn tại trong mcData.items!`);
             bot.chat(`Lỗi: Không tìm thấy thông tin vật phẩm tương ứng với khối ${itemNameVi}.`);
             return;
        }
    }
    // *******************************

  } catch (error) {
    console.error("[Collect Cmd] Bước 2: Lỗi khi dịch hoặc kiểm tra mcData:", error);
    bot.chat(`Xin lỗi ${username}, có lỗi khi tìm thông tin về "${itemNameVi}".`);
    return;
  }

  // --- Bước 3: Xác định công cụ --- (Giữ nguyên)
  let requiredTool = "any";
  const harvestTools = itemInfo.harvestTools;
  if (harvestTools) {
    const firstToolId = Object.keys(harvestTools)[0];
    const toolInfo = mcData.items[firstToolId];
    if (toolInfo) {
      if (toolInfo.name.includes("pickaxe")) requiredTool = "pickaxe";
      else if (toolInfo.name.includes("axe")) requiredTool = "axe";
      else if (toolInfo.name.includes("shovel")) requiredTool = "shovel";
    }
  } else if (itemInfo.material) {
    const material = itemInfo.material;
    if (material.includes("rock") || material.includes("iron") || material.includes("stone")) {
      requiredTool = "pickaxe";
    } else if (material.includes("wood")) {
      requiredTool = "axe";
    } else if (material === "dirt" || material === "sand" || material === "gravel") {
      requiredTool = "shovel";
    }
  }
  console.log(`[Collect Cmd] Bước 3: Công cụ yêu cầu: ${requiredTool}`);

  // --- Bước 4: Khởi tạo trạng thái ---
  // *** ĐẾM SỐ LƯỢNG BAN ĐẦU DỰA TRÊN droppedItemId ***
  const initialAmount = countItemManually(bot.inventory, droppedItemId);
  bot.isCollecting = true;
  bot.collectingTaskDetails = {
    username: username,
    itemNameVi: itemNameVi,
    itemId: itemId, // Tên tiếng Anh của khối
    itemType: itemInfo, // Thông tin khối (Block object, chứa block ID)
    droppedItemId: droppedItemId, // *** ID của vật phẩm cần đếm ***
    targetQuantity: quantity,
    currentQuantity: initialAmount,
    requiredToolType: requiredTool,
    sourceType: "block",
    currentTarget: null,
    status: "idle",
  };
  console.log(`[Collect Cmd] Bước 4: Khởi tạo nhiệm vụ. Đếm vật phẩm ID: ${droppedItemId}. Số lượng ban đầu (thủ công): ${initialAmount}/${quantity}.`);
  bot.chat(`Ok ${username}, tôi sẽ bắt đầu thu thập ${quantity} ${itemNameVi}. Hiện có ${initialAmount}.`);

  // --- Bước 5: Bắt đầu vòng lặp ---
  console.log("[Collect Cmd] Bước 5: Bắt đầu vòng lặp thu thập...");
  collectionLoop(bot);
}

function finishCollectingTask(bot, success, message) {
  if (!bot.isCollecting) {
    console.warn("[Collect Finish] Gọi finishCollectingTask nhưng bot.isCollecting đã là false.");
    return;
  }
  const task = bot.collectingTaskDetails;
  const username = task?.username || "bạn";
  console.log(`[Collect Finish] Kết thúc nhiệm vụ cho ${username}. Thành công: ${success}. Lý do: ${message}`);
  bot.chat(`${username}, ${message}`);

  bot.isCollecting = false;
  bot.collectingTaskDetails = null;
  try {
    if (bot.pathfinder?.isMoving()) {
      bot.pathfinder.stop();
      console.log("[Collect Finish] Đã dừng pathfinder.");
    }
  } catch (e) {
    console.error("[Collect Finish] Lỗi khi dừng pathfinder:", e);
  }
}

function stopCollecting(bot, username) {
  if (bot.isCollecting) {
    console.log(`[Collect Stop] Người dùng ${username} yêu cầu dừng thu thập.`);
    const taskName = bot.collectingTaskDetails?.itemNameVi || 'vật phẩm';
    // Cung cấp lý do rõ ràng hơn khi dừng
    finishCollectingTask(bot, false, `Đã dừng thu thập ${taskName} theo yêu cầu của ${username}.`);
  } else {
    console.log(`[Collect Stop] Nhận yêu cầu dừng từ ${username} nhưng không có nhiệm vụ thu thập nào đang chạy.`);
  }
}

module.exports = {
  startCollectingTask,
  stopCollecting,
};

// --- END OF FILE collect.js ---