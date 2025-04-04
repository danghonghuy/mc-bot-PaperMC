// --- START OF FILE collect.js ---

const { GoalNear, GoalBlock, GoalXZ } = require("mineflayer-pathfinder").goals; // Thêm GoalXZ
const { Vec3 } = require("vec3");
const { Movements } = require("mineflayer-pathfinder");
const { translateToEnglishId, formatCoords } = require("../utils");

const MAX_COLLECT_FIND_DISTANCE = 64;
const NEARBY_BLOCK_FIND_RADIUS = 10;
const REACH_BLOCK_DIST = 4.1; // Tăng thêm chút nữa, quan trọng khi đứng dưới đào lên
const REACH_TREE_BASE_DIST = 2.5;
const MAX_VERTICAL_REACH = 4; // Giữ nguyên 4 block chiều cao
const CHECK_INTERVAL = 500;
const SHORT_CHECK_INTERVAL = 100;
const VERY_SHORT_CHECK_INTERVAL = 50;
const ITEM_PICKUP_WAIT_TICKS = 15;
const ITEM_PICKUP_MAX_ATTEMPTS = 10;
const LEAF_CLEAR_RADIUS = 2;
const MAX_PATHFINDER_ERRORS = 3; // Số lần lỗi pathfinder liên tiếp tối đa cho 1 mục tiêu

const toolMaterialTier = {
  wooden: 1,
  stone: 2,
  golden: 3,
  iron: 4,
  diamond: 5,
  netherite: 6,
};
const logSuffixes = ["_log", "_wood", "_stem"];
const groundMaterials = [
  "dirt",
  "grass_block",
  "stone",
  "sand",
  "gravel",
  "podzol",
  "mycelium",
  "coarse_dirt",
  "rooted_dirt",
];
const leafNames = [
  "leaves",
  "wart_block",
  "shroomlight",
  "azalea_leaves",
  "flowering_azalea_leaves",
    "cherry_leaves"
];
const scaffoldBlockNames = [
  "dirt",
  "cobblestone",
  "netherrack",
  "cobbled_deepslate",
  "stone",
]; // Khối để bắc cầu
function isToolOfType(itemName, toolTypeSuffix) {
  if (!itemName || !toolTypeSuffix) return false;
  // Ví dụ: itemName = 'diamond_axe', toolTypeSuffix = 'axe' -> true
  // Ví dụ: itemName = 'diamond_pickaxe', toolTypeSuffix = 'axe' -> false
  return itemName.endsWith(`_${toolTypeSuffix}`);
}
// Riêng cho kéo vì tên nó không có hậu tố _shears
function isShears(itemName) {
  return itemName === "shears";
}
function countItemManually(inventory, targetItemId) {
  if (targetItemId === null || targetItemId === undefined) return 0;
  return inventory.count(targetItemId);
}

// =============================================================================
// SỬA LẠI EQUIPBESTTOOL ĐỂ ƯU TIÊN ĐÚNG LOẠI TOOL
// =============================================================================
async function equipBestTool(bot, toolType /* ví dụ: 'axe', 'pickaxe', 'shovel', 'shears' */, allowDowngrade = false) {
  console.debug(`[Collect Equip] Yêu cầu tool loại '${toolType}'${allowDowngrade ? ' (cho phép cấp thấp)' : ''}`);
  const mcData = require("minecraft-data")(bot.version);

  let bestToolFound = null;
  let highestTier = -1; // Bắt đầu từ -1 để mọi tool tìm thấy đều tốt hơn

  const currentTool = bot.heldItem;
  let currentToolIsCorrectType = false;
  let currentTier = -1;

  // 1. Xác định loại và tier của tool đang cầm
  if (currentTool) {
      if (toolType === 'shears') {
          currentToolIsCorrectType = isShears(currentTool.name);
          // Shears không có tier, coi như tier đặc biệt (ví dụ: 99) để ưu tiên nếu yêu cầu shears
          currentTier = currentToolIsCorrectType ? 99 : -1;
      } else {
          currentToolIsCorrectType = isToolOfType(currentTool.name, toolType);
          if (currentToolIsCorrectType) {
               const material = currentTool.name.split("_")[0];
               currentTier = toolMaterialTier[material] || 0;
          }
      }
      console.debug(`[Collect Equip] Đang cầm: ${currentTool.name}. Có đúng loại '${toolType}' không? ${currentToolIsCorrectType}. Tier: ${currentTier}`);
  } else {
       console.debug(`[Collect Equip] Tay không.`);
  }


  // 2. Tìm tool TỐT NHẤT (tier cao nhất) của ĐÚNG LOẠI trong inventory
  for (const item of bot.inventory.items()) {
      let itemIsCorrectType = false;
      let itemTier = -1;

      if (toolType === 'shears') {
           itemIsCorrectType = isShears(item.name);
           itemTier = itemIsCorrectType ? 99 : -1;
      } else {
           itemIsCorrectType = isToolOfType(item.name, toolType);
           if (itemIsCorrectType) {
               const material = item.name.split("_")[0];
               itemTier = toolMaterialTier[material] || 0;
           }
      }

      // Nếu item này đúng loại và có tier cao hơn tier cao nhất đã tìm thấy
      if (itemIsCorrectType && itemTier > highestTier) {
          highestTier = itemTier;
          bestToolFound = item;
          console.debug(`[Collect Equip] Tìm thấy ứng viên tốt hơn: ${item.name} (Tier: ${itemTier})`);
      }
  }

  // 3. Nếu không tìm thấy tool nào đúng loại VÀ cho phép cấp thấp (allowDowngrade)
  if (!bestToolFound && allowDowngrade) {
       console.debug(`[Collect Equip] Không tìm thấy tool '${toolType}'. Tìm loại mặc định cho tình huống hiện tại (nếu đào block)...`);
       // Logic này phức tạp và dễ sai, tạm thời không dùng.
       // Nếu không tìm thấy tool đúng loại, equipBestTool nên trả về false.
       // Việc quyết định có đào tay hay không nên ở hàm gọi (handleCollection).
       console.warn(`[Collect Equip] Không tìm thấy tool loại '${toolType}'${allowDowngrade ? ' và allowDowngrade=true' : ''}. Sẽ không trang bị gì.`);

  }

  // 4. Quyết định trang bị
  // Có nên trang bị không?
  // - Nếu tìm thấy tool tốt nhất (bestToolFound != null)
  // - VÀ ( Hiện tại đang cầm tay không HOẶC tool đang cầm không phải tool tốt nhất tìm được )
  if (bestToolFound && (!currentTool || currentTool.name !== bestToolFound.name)) {
       try {
          console.log(`[Collect Equip] Trang bị tool tốt nhất tìm được: ${bestToolFound.name}...`);
          await bot.equip(bestToolFound, "hand");
          console.log(`[Collect Equip] Đã trang bị ${bestToolFound.name}.`);
          await bot.waitForTicks(2); // Chờ 2 ticks cho chắc
          return true; // Trang bị thành công
      } catch (err) {
          console.error(`[Collect Equip] Lỗi trang bị ${bestToolFound.name}:`, err.message);
          bot.chat(`Không thể trang bị ${bestToolFound.displayName || bestToolFound.name}!`);
          return false; // Trang bị thất bại
      }
  }
  // Trường hợp đã cầm sẵn tool tốt nhất tìm được (hoặc tool tốt nhất là null)
  else if (bestToolFound && currentTool && currentTool.name === bestToolFound.name) {
       console.debug(`[Collect Equip] Đã cầm sẵn tool phù hợp: ${bestToolFound.name}.`);
       return true; // Đã cầm sẵn, thành công
  }
  // Trường hợp không tìm thấy tool nào (bestToolFound is null)
  else {
      if (currentToolIsCorrectType && allowDowngrade) {
           console.debug(`[Collect Equip] Không tìm thấy tool tốt hơn, nhưng đang cầm tool đúng loại (${currentTool.name}) và allowDowngrade=true. Giữ nguyên.`);
           return true; // Giữ tool đang cầm (dù cấp thấp) cũng coi như thành công trong trường hợp này
      } else {
           console.log(`[Collect Equip] Không tìm thấy tool '${toolType}' phù hợp để trang bị.`);
           return false; // Không tìm thấy tool phù hợp
      }
  }
}

function findNearbyBlock(bot, taskDetails) {
  const mcData = require("minecraft-data")(bot.version);
  const blockType = taskDetails.itemType;
  if (!blockType) return null;
  const blockId = blockType.id;
  console.debug(
    `[Collect Find Nearby] Tìm ${taskDetails.itemId} (ID: ${blockId}) bán kính ${NEARBY_BLOCK_FIND_RADIUS}...`
  );
  const nearbyBlocksPos = bot.findBlocks({
    matching: blockId,
    maxDistance: NEARBY_BLOCK_FIND_RADIUS,
    count: 30,
    useExtraChunks: true,
    point: bot.entity.position.offset(0, 0.1, 0), // Hơi nâng điểm gốc tìm kiếm lên một chút
  });
  if (nearbyBlocksPos.length > 0) {
    nearbyBlocksPos.sort(
      (a, b) =>
        bot.entity.position.distanceSquared(a) -
        bot.entity.position.distanceSquared(b)
    );
    const botY = bot.entity.position.y;
    // Ưu tiên khối gần tầm mắt hơn
    const preferredBlockPos = nearbyBlocksPos.find(
      (pos) => Math.abs(pos.y - (botY + 0.5)) <= 2.5
    );
    const closestBlockPos = preferredBlockPos || nearbyBlocksPos[0];

    const closestBlock = bot.blockAt(closestBlockPos);
    if (closestBlock) {
      console.log(
        `[Collect Find Nearby] Tìm thấy gần nhất tại ${formatCoords(
          closestBlock.position
        )}.`
      );
      return closestBlock;
    }
  }
  console.debug(
    `[Collect Find Nearby] Không tìm thấy ${taskDetails.itemId} gần đó.`
  );
  return null;
}

function findFarBlock(bot, taskDetails) {
  const mcData = require("minecraft-data")(bot.version);
  const blockType = taskDetails.itemType;
  if (!blockType) return null;
  const blockId = blockType.id;
  console.debug(
    `[Collect Find Far] Tìm ${taskDetails.itemId} (ID: ${blockId}) bán kính ${MAX_COLLECT_FIND_DISTANCE}...`
  );
  const foundBlocks = bot.findBlocks({
    matching: blockId,
    maxDistance: MAX_COLLECT_FIND_DISTANCE,
    count: 50,
    useExtraChunks: true,
    point: bot.entity.position.offset(0, 0.1, 0),
  });

  if (foundBlocks.length === 0) {
    console.log(
      `[Collect Find Far] Không tìm thấy ${taskDetails.itemId} nào khác.`
    );
    return null;
  }

  foundBlocks.sort(
    (a, b) =>
      bot.entity.position.distanceSquared(a) -
      bot.entity.position.distanceSquared(b)
  );
  // Ưu tiên khối không quá cao/thấp so với bot
  const botY = bot.entity.position.y;
  const preferredBlockPos = foundBlocks.find(
    (pos) => Math.abs(pos.y - botY) <= 10
  ); // Nới lỏng phạm vi Y
  const targetBlockPos = preferredBlockPos || foundBlocks[0];

  const foundBlock = bot.blockAt(targetBlockPos);
  if (foundBlock) {
    console.log(
      `[Collect Find Far] Tìm thấy xa tại ${formatCoords(foundBlock.position)}.`
    );
    return foundBlock;
  }
  console.log(
    `[Collect Find Far] Không tìm thấy ${taskDetails.itemId} nào khác (lỗi blockAt?).`
  );
  return null;
}

function findTreeBase(bot, startLogBlock) {
  if (
    !startLogBlock ||
    !logSuffixes.some((suffix) => startLogBlock.name.includes(suffix))
  )
    return null;
  const logTypeName = startLogBlock.name;
  let currentPos = startLogBlock.position.clone();
  let basePos = currentPos;
  let attempts = 0;
  const maxCheckDepth = 25;
  console.debug(
    `[Tree Logic] Bắt đầu tìm gốc từ ${formatCoords(startLogBlock.position)}.`
  );

  while (attempts < maxCheckDepth) {
    attempts++;
    const posBelow = currentPos.offset(0, -1, 0);
    const blockBelow = bot.blockAt(posBelow);

    if (
      !blockBelow ||
      blockBelow.name === "air" ||
      blockBelow.name === "cave_air"
    ) {
      console.debug(
        `[Tree Logic] Gặp không khí/không có khối ở ${formatCoords(
          posBelow
        )}. Dừng tìm gốc. Gốc là ${formatCoords(basePos)}.`
      );
      break;
    }

    if (blockBelow.name === logTypeName) {
      basePos = posBelow;
      currentPos = posBelow;
    } else if (groundMaterials.includes(blockBelow.name)) {
      console.debug(
        `[Tree Logic] Tìm thấy đất/nền (${blockBelow.name}) dưới ${formatCoords(
          currentPos
        )}. Gốc là ${formatCoords(basePos)}.`
      );
      break;
    } else {
      console.debug(
        `[Tree Logic] Gặp khối lạ (${blockBelow.name}) dưới ${formatCoords(
          currentPos
        )}. Xem ${formatCoords(basePos)} là gốc.`
      );
      break;
    }
  }

  if (attempts >= maxCheckDepth)
    console.warn(
      `[Tree Logic] Đạt giới hạn (${maxCheckDepth}) tìm gốc cây từ ${formatCoords(
        startLogBlock.position
      )}.`
    );
  const finalBaseBlock = bot.blockAt(basePos);
  if (finalBaseBlock) {
    console.log(
      `[Tree Logic] Xác định gốc ${logTypeName} tại ${formatCoords(
        finalBaseBlock.position
      )}.`
    );
    return finalBaseBlock;
  } else {
    console.error(
      `[Tree Logic] Lỗi: Không thể lấy block gốc tại ${formatCoords(basePos)}.`
    );
    return null;
  }
}

// =============================================================================
// CẢI TIẾN CLEAROBSTRUCTINGLEAVES
// =============================================================================
async function clearObstructingLeaves(bot, targetPos) {
  console.debug(`[Tree Logic] Bắt đầu kiểm tra & dọn lá cây quanh ${formatCoords(targetPos)}`);
  const mcData = require("minecraft-data")(bot.version);
  let clearedSomething = false;
  const originalTool = bot.heldItem; // Lưu lại tool ban đầu
  let equippedToolForClearing = null; // Lưu tên tool đã chủ động trang bị (shears/axe)

  // --- Chọn tool để dọn lá ---
  let toolToUse = null; // Item object
  let toolToUseType = 'hand'; // 'shears', 'axe', 'hand'

  // 1. Ưu tiên Kéo
  const shears = bot.inventory.findInventoryItem(mcData.itemsByName.shears.id, null);
  if (shears) {
      toolToUse = shears;
      toolToUseType = 'shears';
      console.debug("[Tree Logic] Ưu tiên dùng Kéo.");
  } else {
      // 2. Nếu không có kéo, tìm Rìu tốt nhất
      console.debug("[Tree Logic] Không có kéo, tìm rìu...");
      let bestAxe = null;
      let highestAxeTier = -1;
      for (const item of bot.inventory.items()) {
           if (isToolOfType(item.name, 'axe')) { // Kiểm tra chặt chẽ là rìu
               const material = item.name.split("_")[0];
               const tier = toolMaterialTier[material] || 0;
               if (tier > highestAxeTier) {
                   highestAxeTier = tier;
                   bestAxe = item;
               }
           }
      }
      if (bestAxe) {
           toolToUse = bestAxe;
           toolToUseType = 'axe';
           console.debug(`[Tree Logic] Sẽ dùng Rìu tốt nhất: ${bestAxe.name}`);
      } else {
           console.debug("[Tree Logic] Không có rìu. Sẽ dùng tool đang cầm/tay không.");
           // toolToUse vẫn là null, toolToUseType là 'hand'
      }
  }

  // --- Trang bị tool nếu cần ---
  if (toolToUse && (!originalTool || originalTool.name !== toolToUse.name)) {
      try {
          console.log(`[Tree Logic] Trang bị '${toolToUse.name}' để dọn lá...`);
          await bot.equip(toolToUse, 'hand');
          await bot.waitForTicks(2); // Chờ 2 ticks
          equippedToolForClearing = toolToUse.name; // Đánh dấu đã trang bị tool này
          console.log(`[Tree Logic] Đã trang bị ${bot.heldItem?.name} để dọn lá.`);
      } catch (err) {
          console.warn(`[Tree Logic] Lỗi trang bị '${toolToUse.name}': ${err.message}. Sẽ dùng tool đang cầm/tay.`);
          equippedToolForClearing = null; // Trang bị thất bại
          toolToUse = null; // Quay về dùng tay/tool cũ
          toolToUseType = 'hand';
          // Cố gắng equip lại tool ban đầu nếu có thể?
          if (originalTool && bot.heldItem?.name !== originalTool.name) {
               try { await bot.equip(originalTool, 'hand'); await bot.waitForTicks(1); } catch(e){}
          } else if (!originalTool && bot.heldItem) {
               try { await bot.unequip('hand'); await bot.waitForTicks(1); } catch(e){}
          }
      }
  } else if (toolToUse && originalTool && originalTool.name === toolToUse.name) {
      console.debug(`[Tree Logic] Đã cầm sẵn tool phù hợp (${toolToUse.name}).`);
      equippedToolForClearing = toolToUse.name; // Coi như đã "chủ động" dùng tool này
  }

  // --- Quét và phá lá ---
  console.log(`[Tree Logic] Bắt đầu quét lá. Sẽ dùng: ${bot.heldItem?.name || 'tay không'}`);
  for (let dy = LEAF_CLEAR_RADIUS + 1; dy >= 0; dy--) {
      for (let dx = -LEAF_CLEAR_RADIUS; dx <= LEAF_CLEAR_RADIUS; dx++) {
          for (let dz = -LEAF_CLEAR_RADIUS; dz <= LEAF_CLEAR_RADIUS; dz++) {
              const checkPos = targetPos.offset(dx, dy, dz);
              if (checkPos.equals(targetPos)) continue;

              const block = bot.blockAt(checkPos);
              // Kiểm tra cả lá và các loại tương tự
              if (block && leafNames.some(name => block.name.includes(name))) {
                   if (bot.entity.position.distanceTo(checkPos.offset(0.5, 0.5, 0.5)) > REACH_BLOCK_DIST + 0.5) {
                      continue;
                  }

                  // Luôn kiểm tra lại khả năng đào bằng tool đang cầm
                  if (bot.canDigBlock(block)) {
                       // Log chính xác tool đang dùng
                       const currentHeldItemName = bot.heldItem?.name || 'tay không';
                       console.log(`[Tree Logic] Phá lá ${block.name} tại ${formatCoords(checkPos)} bằng ${currentHeldItemName}`);
                      try {
                          await bot.dig(block);
                          await bot.waitForTicks(1); // Chờ sau khi đào
                          clearedSomething = true;
                      } catch (err) {
                          console.warn(`[Tree Logic] Lỗi khi phá lá tại ${formatCoords(checkPos)} bằng ${currentHeldItemName}: ${err.message}`);
                          // Kiểm tra xem có phải lỗi do tool không? Nếu là lỗi tool thì hơi lạ vì canDigBlock=true
                      }
                  } else {
                      console.warn(`[Tree Logic] Không thể phá lá ${block.name} tại ${formatCoords(checkPos)} bằng ${bot.heldItem?.name || 'tay không'} (canDigBlock=false).`);
                  }
              }
          }
      }
  }

  // --- Trang bị lại tool ban đầu ---
  // Chỉ trang bị lại nếu chúng ta đã chủ động trang bị tool khác LÚC BAN ĐẦU
  if (equippedToolForClearing) { // Check nếu chúng ta có trang bị tool mới
       if (originalTool && bot.heldItem?.name !== originalTool.name) { // Và tool hiện tại khác tool gốc
           console.log(`[Tree Logic] Dọn lá xong. Trang bị lại tool ban đầu: ${originalTool.name}`);
           try {
               await bot.equip(originalTool, 'hand');
               await bot.waitForTicks(2); // Chờ 2 ticks
               console.log(`[Tree Logic] Đã trang bị lại ${bot.heldItem?.name}.`);
           } catch (err) {
               console.warn('[Tree Logic] Lỗi trang bị lại tool gốc:', err.message);
           }
       } else if (!originalTool && bot.heldItem) { // Tool gốc là tay không, mà giờ đang cầm tool
           console.log(`[Tree Logic] Dọn lá xong. Bỏ tool '${bot.heldItem.name}' ra khỏi tay.`);
           try {
               await bot.unequip('hand');
               await bot.waitForTicks(2); // Chờ 2 ticks
               console.log(`[Tree Logic] Đã bỏ tool khỏi tay.`);
           } catch (e) { console.warn('[Tree Logic] Lỗi bỏ trang bị tay:', e.message); }
       } else {
            // Trường hợp tool gốc trùng tool trang bị, hoặc tool gốc là tay không và giờ cũng là tay không
            console.debug(`[Tree Logic] Dọn lá xong. Tool hiện tại (${bot.heldItem?.name || 'tay không'}) đã đúng với trạng thái mong muốn.`);
       }
  } else {
      // Nếu không chủ động trang bị tool nào lúc đầu (ví dụ dùng tay hoặc tool đang cầm sẵn)
       console.debug(`[Tree Logic] Dọn lá xong. Không cần đổi lại tool (đã dùng ${bot.heldItem?.name || 'tay không'}).`);
  }


  console.debug(`[Tree Logic] Kết thúc dọn lá. Cleared: ${clearedSomething}`);
  return clearedSomething;
}

async function handleTreeCollection(bot) {
  const task = bot.collectingTaskDetails;
  if (!bot.isCollecting || !task || task.collectionStrategy !== 'tree') {
      if (bot.isCollecting) finishCollectingTask(bot, false, "Lỗi logic: Sai chiến lược cây hoặc task không hợp lệ.");
      return;
  }

  const mcData = require("minecraft-data")(bot.version);
  const targetLogName = task.itemId;
  const countItemId = task.droppedItemId;
  const countItemName = task.droppedItemName;

  try {
      console.debug(`[Tree Logic] Tick >> Status: ${task.status}, Target: ${task.currentTreeLog ? formatCoords(task.currentTreeLog.position) : 'None'}, Base: ${task.currentTreeBaseLog ? formatCoords(task.currentTreeBaseLog.position) : 'None'}, PathErrors: ${task.consecutivePathErrors}`);

      // --- 1. Kiểm tra hoàn thành / dừng ---
      const currentAmount = countItemManually(bot.inventory, countItemId);
      task.currentQuantity = currentAmount;
      if (currentAmount >= task.targetQuantity) {
          finishCollectingTask(bot, true, `Đã đủ ${currentAmount}/${task.targetQuantity} ${task.itemNameVi}.`);
          return;
      }
      if (bot.inventory.emptySlotCount() === 0) {
          finishCollectingTask(bot, false, `Túi đồ đầy khi đang chặt ${task.itemNameVi}! Đã có ${currentAmount}/${task.targetQuantity}.`);
          return;
      }
      if (task.consecutivePathErrors >= MAX_PATHFINDER_ERRORS) {
           console.error(`[Tree Logic] Quá nhiều lỗi pathfinder (${task.consecutivePathErrors}). Bỏ qua mục tiêu.`);
           bot.chat("Gặp lỗi di chuyển liên tục, tôi sẽ tìm cây khác.");
           task.currentTreeBaseLog = null; task.currentTreeLog = null; task.status = 'idle';
           task.consecutivePathErrors = 0;
           setTimeout(() => handleTreeCollection(bot), CHECK_INTERVAL * 2);
           return;
      }

      // --- 2. Tìm cây mới / khúc gỗ tiếp theo nếu cần ---
      let needsNewTarget = false;
      if (!task.currentTreeLog) {
          needsNewTarget = true;
           console.log("[Tree Logic] Không có mục tiêu log hiện tại.");
      } else {
           const currentLogBlockCheck = bot.blockAt(task.currentTreeLog.position);
           if (!currentLogBlockCheck || currentLogBlockCheck.name !== targetLogName) {
               needsNewTarget = true;
               console.log(`[Tree Logic] Log mục tiêu tại ${formatCoords(task.currentTreeLog.position)} không còn hợp lệ (hiện tại: ${currentLogBlockCheck?.name ?? 'không khí/chưa load'}).`);
               const lastPos = task.lastLogPosition;
               task.currentTreeLog = null;

               if ((task.status === 'chopping' || task.status === 'waiting_pickup') && lastPos) {
                    const posAbove = lastPos.offset(0, 1, 0);
                    const blockAbove = bot.blockAt(posAbove);
                    if (blockAbove && blockAbove.name === targetLogName) {
                        console.log(`[Tree Logic] Tìm thấy log tiếp theo trên cao tại ${formatCoords(posAbove)}.`);
                        task.currentTreeLog = blockAbove;
                        task.status = 'approaching_log';
                        needsNewTarget = false;
                        task.consecutivePathErrors = 0;
                    } else {
                         console.log(`[Tree Logic] Không còn log ${targetLogName} phía trên ${formatCoords(lastPos)}. Xong cây này.`);
                         task.currentTreeBaseLog = null;
                    }
               } else if (task.status !== 'idle' && task.status !== 'moving_to_tree') {
                   console.log("[Tree Logic] Mục tiêu biến mất không phải do vừa chặt/chờ nhặt. Coi như xong cây này.");
                   task.currentTreeBaseLog = null;
               }
           }
      }

      if (needsNewTarget) {
          console.log("[Tree Logic] Trạng thái cần tìm mục tiêu mới. Status hiện tại:", task.status);
           task.status = 'idle';
           task.currentTreeLog = null;

           console.log("[Tree Logic] Bắt đầu tìm cây mới...");
           let nextLogTarget = findNearbyBlock(bot, task) || findFarBlock(bot, task);
           if (nextLogTarget) {
               const treeBase = findTreeBase(bot, nextLogTarget);
               if (treeBase && treeBase.name === targetLogName) {
                   task.currentTreeBaseLog = treeBase;
                   task.currentTreeLog = treeBase;
                   task.status = 'moving_to_tree';
                   task.consecutivePathErrors = 0;
                   console.log(`[Tree Logic] Tìm thấy cây ${targetLogName}, gốc tại ${formatCoords(treeBase.position)}. Di chuyển đến gốc...`);
               } else if (nextLogTarget) {
                   console.warn(`[Tree Logic] Không tìm thấy gốc hợp lệ. Thử chặt trực tiếp ${formatCoords(nextLogTarget.position)}.`);
                   task.currentTreeLog = nextLogTarget;
                   task.currentTreeBaseLog = null;
                   task.status = 'approaching_log';
                   task.consecutivePathErrors = 0;
                   console.log(`[Tree Logic] Di chuyển trực tiếp đến log ${formatCoords(nextLogTarget.position)}.`);
               }
           } else {
               finishCollectingTask(bot, false, `Không tìm thấy thêm cây ${task.itemNameVi}. Đã có ${currentAmount}/${task.targetQuantity}.`);
               return;
           }
          setTimeout(() => handleTreeCollection(bot), SHORT_CHECK_INTERVAL);
          return;
      }

      // --- 3. Xử lý theo trạng thái ---
      const currentLogBlock = task.currentTreeLog;
      const currentLogPos = currentLogBlock.position;
      const botPos = bot.entity.position;
      const distToLogCenter = bot.entity.position.distanceTo(currentLogPos.offset(0.5, 0.5, 0.5));
      const canReachLog = distToLogCenter <= REACH_BLOCK_DIST;
      const isLogTooHigh = currentLogPos.y > botPos.y + MAX_VERTICAL_REACH - 0.5;

      switch (task.status) {
          case 'moving_to_tree':
              console.log(`[Tree Logic] Đang di chuyển đến gốc cây tại ${formatCoords(currentLogPos)}`);
              const goalNear = new GoalNear(currentLogPos.x, currentLogPos.y, currentLogPos.z, REACH_TREE_BASE_DIST);
              try {
                  await bot.pathfinder.goto(goalNear);
                  console.log(`[Tree Logic] Đã đến gần gốc cây.`);
                  task.status = 'approaching_log';
                  task.consecutivePathErrors = 0;
                  setTimeout(() => handleTreeCollection(bot), VERY_SHORT_CHECK_INTERVAL);
              } catch (err) {
                  console.error(`[Tree Logic] Lỗi pathfinder đến gốc: ${err.message}. Bỏ qua cây.`);
                  bot.chat("Không đến được gốc cây này, tìm cây khác...");
                  task.currentTreeBaseLog = null; task.currentTreeLog = null; task.status = 'idle';
                  task.consecutivePathErrors++;
                  setTimeout(() => handleTreeCollection(bot), CHECK_INTERVAL);
              }
              return;

          case 'approaching_log':
              console.log(`[Tree Logic] Đang tiếp cận log tại ${formatCoords(currentLogPos)}.`);
              if (isLogTooHigh) {
                  console.warn(`[Tree Logic] Log ${formatCoords(currentLogPos)} quá cao. Bỏ qua cây.`);
                  bot.chat("Khúc gỗ này cao quá, tôi bỏ qua.");
                  task.currentTreeBaseLog = null; task.currentTreeLog = null; task.status = 'idle';
                  setTimeout(() => handleTreeCollection(bot), CHECK_INTERVAL);
                  return;
              }

              if (canReachLog) {
                   console.log(`[Tree Logic] Đã trong tầm với log. Chuyển sang chuẩn bị chặt.`);
                   task.status = 'reached_log';
                   task.consecutivePathErrors = 0;
                   setTimeout(() => handleTreeCollection(bot), VERY_SHORT_CHECK_INTERVAL);
                   return;
              } else {
                   console.log(`[Tree Logic] Chưa đủ gần (${distToLogCenter.toFixed(2)} > ${REACH_BLOCK_DIST}). Di chuyển bằng GoalBlock.`);
                   // Dọn lá có thể cần gọi lại tool logic, nên để sau khi trang bị rìu?
                   // -> Không, nên dọn trước khi pathfinder để nó dễ tìm đường hơn
                   console.debug("[Tree Logic] Dọn lá trước khi di chuyển lại gần...");
                   await clearObstructingLeaves(bot, currentLogPos); // Dọn lá trước pathfind

                   const goalBlock = new GoalBlock(currentLogPos.x, currentLogPos.y, currentLogPos.z);
                   try {
                      await bot.pathfinder.goto(goalBlock);
                      console.log(`[Tree Logic] Đã đến vị trí đào ${formatCoords(currentLogPos)}.`);
                      task.status = 'reached_log';
                      task.consecutivePathErrors = 0;
                      setTimeout(() => handleTreeCollection(bot), VERY_SHORT_CHECK_INTERVAL);
                  } catch (err) {
                      console.error(`[Tree Logic] Lỗi pathfinder đến log ${formatCoords(currentLogPos)}: ${err.message}.`);
                      bot.chat("Không đến được khúc gỗ này...");
                      task.consecutivePathErrors++;
                      task.status = 'approaching_log'; // Thử lại tiếp cận
                      console.log(`[Tree Logic] Lỗi pathfinder (${task.consecutivePathErrors}/${MAX_PATHFINDER_ERRORS}). Sẽ thử lại.`);
                      setTimeout(() => handleTreeCollection(bot), CHECK_INTERVAL);
                  }
                  return;
              }
              break;

          case 'reached_log':
               console.log(`[Tree Logic] Đã đến vị trí log ${formatCoords(currentLogPos)}. Chuẩn bị chặt.`);
               if (!canReachLog) {
                   console.warn(`[Tree Logic] Vừa đến (${task.status}) nhưng lại ngoài tầm? Quay lại approaching_log.`);
                   task.status = 'approaching_log';
                   setTimeout(() => handleTreeCollection(bot), SHORT_CHECK_INTERVAL);
                   return;
               }
               if (isLogTooHigh) {
                  console.warn(`[Tree Logic] Log ${formatCoords(currentLogPos)} lại quá cao? Bỏ qua cây.`);
                  bot.chat("Khúc gỗ này tự nhiên cao lên à? Bỏ qua.");
                  task.currentTreeBaseLog = null; task.currentTreeLog = null; task.status = 'idle';
                  setTimeout(() => handleTreeCollection(bot), CHECK_INTERVAL);
                  return;
               }

               // <<< BƯỚC QUAN TRỌNG: TRANG BỊ RÌU >>>
               if (!(await equipBestTool(bot, 'axe', true))) { // Yêu cầu rìu, cho phép cấp thấp
                   // Không tìm thấy rìu phù hợp trong túi đồ
                   console.error("[Tree Logic] Không tìm thấy RÌU nào trong túi đồ!");
                   // Kiểm tra xem có thể đào tay không (mặc dù chậm)
                   const blockToCheckHand = bot.blockAt(currentLogPos);
                   if (blockToCheckHand && bot.canDigBlock(blockToCheckHand)) {
                       console.warn("[Tree Logic] Không có rìu nhưng có thể chặt tay (sẽ chậm). Tiếp tục...");
                       // Vẫn tiếp tục chặt tay
                   } else {
                       // Không có rìu VÀ không thể chặt tay -> Dừng
                       finishCollectingTask(bot, false, "Không có rìu và không thể chặt cây bằng tay.");
                       return;
                   }
               } else {
                   // Đã trang bị được rìu (hoặc đang cầm sẵn rìu phù hợp)
                    const currentHeld = bot.heldItem;
                    if (!currentHeld || !isToolOfType(currentHeld.name, 'axe')) {
                         // Lỗi cực kỳ lạ: equipBestTool trả về true nhưng không cầm rìu?
                         console.error(`[Tree Logic] LỖI LOGIC! equipBestTool('axe') trả về true nhưng đang cầm ${currentHeld?.name}! Dừng.`);
                          finishCollectingTask(bot, false, "Lỗi logic nghiêm trọng khi trang bị rìu.");
                          return;
                    }
                    console.log(`[Tree Logic] Đã cầm rìu phù hợp: ${currentHeld.name}.`);
               }
               // -> Tại đây, bot hoặc đang cầm rìu, hoặc sẽ chặt bằng tay nếu không có rìu.

               // Kiểm tra lại block
               const blockNow = bot.blockAt(currentLogPos);
               if (!blockNow || blockNow.name !== targetLogName) {
                   console.warn(`[Tree Logic] Khối log biến mất trước khi chặt? Tìm lại...`);
                   task.currentTreeLog = null; task.status = 'idle';
                   setTimeout(() => handleTreeCollection(bot), SHORT_CHECK_INTERVAL);
                   return;
               }

               // Kiểm tra lại khả năng đào bằng tool hiện tại (có thể là rìu hoặc tay)
               if (!bot.canDigBlock(blockNow)) {
                   console.error(`[Tree Logic] Vẫn KHÔNG THỂ ĐÀO ${blockNow.name} bằng ${bot.heldItem?.name || 'tay'} (canDigBlock=false)? Bỏ qua cây.`);
                   bot.chat(`Không hiểu sao không chặt được ${task.itemNameVi} dù đã cố. Bỏ qua cây này.`);
                   task.currentTreeBaseLog = null; task.currentTreeLog = null; task.status = 'idle';
                   setTimeout(() => handleTreeCollection(bot), CHECK_INTERVAL);
                   return;
               }

               // Dọn lá lần cuối (sử dụng tool đang cầm: rìu/kéo/tay)
               console.debug("[Tree Logic] Dọn lá lần cuối trước khi chặt.");
               await clearObstructingLeaves(bot, currentLogPos);

               // Kiểm tra lại block SAU KHI dọn lá
               const blockAfterClear = bot.blockAt(currentLogPos);
               if (!blockAfterClear || blockAfterClear.name !== targetLogName) {
                   console.warn(`[Tree Logic] Khối log biến mất *sau khi* dọn lá?`);
                   task.currentTreeLog = null; task.status = 'idle';
                   setTimeout(() => handleTreeCollection(bot), SHORT_CHECK_INTERVAL);
                   return;
               }
               if (!bot.canDigBlock(blockAfterClear)) {
                   console.error(`[Tree Logic] Không thể đào block ${blockAfterClear.name} SAU KHI DỌN LÁ bằng ${bot.heldItem?.name || 'tay'}? Lỗi lạ. Bỏ qua.`);
                    task.currentTreeBaseLog = null; task.currentTreeLog = null; task.status = 'idle';
                    setTimeout(() => handleTreeCollection(bot), CHECK_INTERVAL);
                    return;
               }

               // Mọi thứ OK -> Chặt
               task.status = 'chopping';
               const toolUsedToChop = bot.heldItem?.name || 'tay không';
               console.log(`[Tree Logic] Bắt đầu chặt log ${targetLogName} tại ${formatCoords(currentLogPos)} bằng ${toolUsedToChop}.`);
               task.lastLogPosition = currentLogPos.clone();

               try {
                   const amountBeforeDig = countItemManually(bot.inventory, countItemId);
                   await bot.dig(blockAfterClear);
                   console.log(`[Tree Logic] Chặt xong ${formatCoords(currentLogPos)}. Chờ nhặt.`);
                   task.status = 'waiting_pickup';
                   task.pickupAttempts = 0;
                   task.amountBeforePickup = amountBeforeDig;
                   setTimeout(() => handleTreeCollection(bot), ITEM_PICKUP_WAIT_TICKS * 50);
                   return;
               } catch (digError) {
                   console.error(`[Tree Logic] Lỗi khi chặt log ${formatCoords(currentLogPos)}: ${digError.message}`);
                   const blockCheckAfterError = bot.blockAt(currentLogPos);
                   if (!blockCheckAfterError || blockCheckAfterError.name !== targetLogName) {
                       console.log("[Tree Logic] Block không còn tồn tại sau lỗi chặt.");
                   } else { bot.chat(`Lỗi khi chặt cây: ${digError.message}.`); }
                   task.currentTreeLog = null; task.status = 'idle';
                   setTimeout(() => handleTreeCollection(bot), CHECK_INTERVAL);
                   return;
               }
               break;

           // ... (các case 'chopping', 'waiting_pickup', 'idle', default giữ nguyên như phiên bản trước) ...
           case 'chopping':
               console.warn("[Tree Logic] Bị kẹt ở trạng thái 'chopping'? Đặt lại thành 'reached_log'.");
               task.status = 'reached_log';
               setTimeout(() => handleTreeCollection(bot), SHORT_CHECK_INTERVAL);
               return;

           case 'waiting_pickup':
              task.pickupAttempts++;
              console.debug(`[Tree Logic] Chờ nhặt lần ${task.pickupAttempts}/${ITEM_PICKUP_MAX_ATTEMPTS}...`);
              const amountAfterWait = countItemManually(bot.inventory, countItemId);

              if (amountAfterWait > task.amountBeforePickup) {
                  const pickedUpCount = amountAfterWait - task.amountBeforePickup;
                  console.log(`[Tree Logic] Xác nhận nhặt được ${pickedUpCount} ${countItemName}! SL: ${amountAfterWait}`);
                  task.currentQuantity = amountAfterWait;
                  bot.chat(`+${pickedUpCount} ${task.itemNameVi}. (${amountAfterWait}/${task.targetQuantity})`);
                  task.currentTreeLog = null;
                  task.status = 'idle';
                  setTimeout(() => handleTreeCollection(bot), VERY_SHORT_CHECK_INTERVAL);
                  return;
              } else if (task.pickupAttempts >= ITEM_PICKUP_MAX_ATTEMPTS) {
                  console.warn(`[Tree Logic] Không xác nhận nhặt ${countItemName} sau ${task.pickupAttempts} lần. Tiếp tục...`);
                  task.currentQuantity = amountAfterWait;
                  task.currentTreeLog = null;
                  task.status = 'idle';
                  setTimeout(() => handleTreeCollection(bot), SHORT_CHECK_INTERVAL);
                  return;
              } else {
                  setTimeout(() => handleTreeCollection(bot), ITEM_PICKUP_WAIT_TICKS * 50);
                  return;
              }
              break;

          case 'idle':
               console.warn("[Tree Logic] Lặp lại ở trạng thái 'idle'? Chờ tìm mục tiêu...");
               setTimeout(() => handleTreeCollection(bot), SHORT_CHECK_INTERVAL);
               return;

          default:
              console.error(`[Tree Logic] Trạng thái không xác định: ${task.status}. Reset về 'idle'.`);
              task.status = 'idle';
               setTimeout(() => handleTreeCollection(bot), CHECK_INTERVAL);
              return;

      }

  } catch(error) {
      console.error("[Tree Logic] Lỗi nghiêm trọng không mong muốn:", error);
      finishCollectingTask(bot, false, `Lỗi hệ thống khi chặt cây ${task.itemNameVi}: ${error.message}`);
  }
}

// =============================================================================
// HÀM LOGIC ĐÀO KHỐI (BLOCK COLLECTION) - Không thay đổi nhiều
// =============================================================================
async function handleBlockCollection(bot) {
  const task = bot.collectingTaskDetails;
  if (!bot.isCollecting || !task || task.collectionStrategy !== "block") {
    if (bot.isCollecting)
      finishCollectingTask(
        bot,
        false,
        "Lỗi logic: Sai chiến lược block hoặc task không hợp lệ."
      );
    return;
  }

  const mcData = require("minecraft-data")(bot.version);
  const countItemId = task.droppedItemId;
  const countItemName = task.droppedItemName;
  const targetBlockId = task.itemType.id;

  try {
    console.debug(
      `[Block Logic] Tick >> Status: ${task.status}, Target: ${
        task.currentTarget ? formatCoords(task.currentTarget.position) : "None"
      }, PathErrors: ${task.consecutivePathErrors}`
    );

    // --- 1. Kiểm tra hoàn thành / dừng ---
    const currentAmount = countItemManually(bot.inventory, countItemId);
    task.currentQuantity = currentAmount;
    if (currentAmount >= task.targetQuantity) {
      finishCollectingTask(
        bot,
        true,
        `Đã đủ ${currentAmount}/${task.targetQuantity} ${task.itemNameVi}.`
      );
      return;
    }
    if (bot.inventory.emptySlotCount() === 0) {
      finishCollectingTask(
        bot,
        false,
        `Túi đồ đầy khi đào ${task.itemNameVi}! Đã có ${currentAmount}/${task.targetQuantity}.`
      );
      return;
    }
    if (task.consecutivePathErrors >= MAX_PATHFINDER_ERRORS) {
      console.error(
        `[Block Logic] Quá nhiều lỗi pathfinder liên tiếp (${task.consecutivePathErrors}). Bỏ qua khối hiện tại.`
      );
      bot.chat("Gặp lỗi di chuyển liên tục, tôi sẽ tìm khối khác.");
      task.currentTarget = null;
      task.status = "idle";
      task.consecutivePathErrors = 0;
      setTimeout(() => handleBlockCollection(bot), CHECK_INTERVAL * 2);
      return;
    }

    // --- 2. Tìm khối mới nếu cần ---
    let needsNewTarget = false;
    if (!task.currentTarget) {
      needsNewTarget = true;
      console.log("[Block Logic] Không có mục tiêu khối hiện tại.");
    } else {
      const currentBlockCheck = bot.blockAt(task.currentTarget.position);
      if (!currentBlockCheck || currentBlockCheck.type !== targetBlockId) {
        // Chỉ cần check type là đủ
        needsNewTarget = true;
        console.log(
          `[Block Logic] Mục tiêu khối tại ${formatCoords(
            task.currentTarget.position
          )} không còn hợp lệ (hiện tại: ${
            currentBlockCheck?.name ?? "không khí/chưa load"
          }).`
        );
        task.currentTarget = null;
      }
    }

    if (needsNewTarget) {
      console.log(
        "[Block Logic] Trạng thái cần tìm khối mới. Status hiện tại:",
        task.status
      );
      task.status = "idle";
      task.currentTarget = null;

      console.log("[Block Logic] Bắt đầu tìm khối mới...");
      let nextTarget = findNearbyBlock(bot, task) || findFarBlock(bot, task);
      if (nextTarget) {
        task.currentTarget = nextTarget;
        const distToNewTarget = bot.entity.position.distanceTo(
          nextTarget.position.offset(0.5, 0.5, 0.5)
        );
        if (distToNewTarget <= REACH_BLOCK_DIST) {
          console.log(
            `[Block Logic] Mục tiêu mới ${formatCoords(
              nextTarget.position
            )} ở gần. Chuyển sang 'reached_target'.`
          );
          task.status = "reached_target";
        } else {
          console.log(
            `[Block Logic] Đặt mục tiêu mới: ${task.itemId} tại ${formatCoords(
              nextTarget.position
            )}. Chuyển sang 'moving'.`
          );
          task.status = "moving";
        }
        task.consecutivePathErrors = 0; // Reset lỗi khi có mục tiêu mới
      } else {
        finishCollectingTask(
          bot,
          false,
          `Không tìm thấy thêm khối ${task.itemNameVi}. Đã có ${currentAmount}/${task.targetQuantity}.`
        );
        return;
      }
      setTimeout(() => handleBlockCollection(bot), SHORT_CHECK_INTERVAL);
      return;
    }

    // --- 3. Xử lý theo trạng thái ---
    const targetBlock = task.currentTarget;
    const targetPosition = targetBlock.position;
    const botPos = bot.entity.position;
    const distToBlockCenter = bot.entity.position.distanceTo(
      targetPosition.offset(0.5, 0.5, 0.5)
    );
    const canReachBlock = distToBlockCenter <= REACH_BLOCK_DIST;
    const isBlockTooHigh =
      targetPosition.y > botPos.y + MAX_VERTICAL_REACH - 0.5;

    switch (task.status) {
      case "moving":
        console.log(
          `[Block Logic] Đang di chuyển đến ${formatCoords(targetPosition)}.`
        );
        if (canReachBlock) {
          console.log(
            `[Block Logic] Đã đến nơi khi đang 'moving'. Chuyển sang 'reached_target'.`
          );
          task.status = "reached_target";
          task.consecutivePathErrors = 0;
          setTimeout(
            () => handleBlockCollection(bot),
            VERY_SHORT_CHECK_INTERVAL
          );
          return;
        }
        if (isBlockTooHigh) {
          console.warn(
            `[Block Logic] Khối ${formatCoords(
              targetPosition
            )} quá cao. Bỏ qua.`
          );
          bot.chat("Khối này cao quá, tôi bỏ qua.");
          task.currentTarget = null;
          task.status = "idle";
          setTimeout(() => handleBlockCollection(bot), CHECK_INTERVAL);
          return;
        }

        const goal = new GoalBlock(
          targetPosition.x,
          targetPosition.y,
          targetPosition.z
        );
        try {
          await bot.pathfinder.goto(goal);
          console.log(
            `[Block Logic] Đã đến vị trí đào ${formatCoords(targetPosition)}.`
          );
          task.status = "reached_target";
          task.consecutivePathErrors = 0;
          setTimeout(
            () => handleBlockCollection(bot),
            VERY_SHORT_CHECK_INTERVAL
          );
        } catch (err) {
          console.error(
            `[Block Logic] Lỗi pathfinder đến ${formatCoords(
              targetPosition
            )}: ${err.message}.`
          );
          bot.chat("Không đến được khối này...");
          task.consecutivePathErrors++;
          // Thử lại ở lần sau thay vì bỏ ngay
          task.status = "moving";
          console.log(
            `[Block Logic] Lỗi pathfinder (${task.consecutivePathErrors}/${MAX_PATHFINDER_ERRORS}). Sẽ thử lại.`
          );
          setTimeout(() => handleBlockCollection(bot), CHECK_INTERVAL);
        }
        return;

      case "reached_target":
        console.log(
          `[Block Logic] Đã đến vị trí khối ${formatCoords(
            targetPosition
          )}. Chuẩn bị đào.`
        );
        if (!canReachBlock) {
          console.warn(
            `[Block Logic] Vừa đến nơi (${task.status}) nhưng lại ngoài tầm? Quay lại 'moving'.`
          );
          task.status = "moving";
          setTimeout(() => handleBlockCollection(bot), SHORT_CHECK_INTERVAL);
          return;
        }
        if (isBlockTooHigh) {
          console.warn(
            `[Block Logic] Khối ${formatCoords(
              targetPosition
            )} lại thành quá cao? Bỏ qua.`
          );
          bot.chat("Khối này tự nhiên cao lên à? Bỏ qua.");
          task.currentTarget = null;
          task.status = "idle";
          setTimeout(() => handleBlockCollection(bot), CHECK_INTERVAL);
          return;
        }

        // <<< TRANG BỊ TOOL >>>
        let toolNeeded = task.requiredToolType !== "any";
        let equippedCorrectTool = true; // Giả sử tool ok hoặc không cần
        if (toolNeeded) {
          if (!(await equipBestTool(bot, task.requiredToolType, true))) {
            equippedCorrectTool = false; // Không tìm thấy/trang bị được
            console.warn(
              `[Block Logic] Không tìm/trang bị được tool '${task.requiredToolType}'.`
            );
            // Sẽ kiểm tra canDigBlock ở dưới
          } else {
            console.log(
              `[Block Logic] Đã trang bị tool phù hợp (${bot.heldItem?.name}).`
            );
          }
        }

        // Kiểm tra lại block và khả năng đào
        const blockToDig = bot.blockAt(targetPosition);
        if (!blockToDig || blockToDig.type !== targetBlockId) {
          console.warn(
            `[Block Logic] Khối ${formatCoords(
              targetPosition
            )} đã thay đổi/biến mất trước khi đào. Tìm khối khác.`
          );
          task.currentTarget = null;
          task.status = "idle";
          setTimeout(() => handleBlockCollection(bot), SHORT_CHECK_INTERVAL);
          return;
        }
        if (!bot.canDigBlock(blockToDig)) {
          if (!equippedCorrectTool && isToolNeededForDrop(blockToDig)) {
            // Không trang bị được tool và tool là bắt buộc -> dừng
            console.error(
              `[Block Logic] Không có tool bắt buộc '${task.requiredToolType}' và không thể đào ${blockToDig.name}.`
            );
            finishCollectingTask(
              bot,
              false,
              `Thiếu công cụ (${task.requiredToolType}) để đào ${task.itemNameVi}.`
            );
            return;
          } else {
            // Hoặc đã trang bị đúng nhưng vẫn ko đào đc (lỗi lạ), hoặc tool ko bắt buộc nhưng vẫn ko đào đc -> dừng
            console.error(
              `[Block Logic] Vẫn KHÔNG THỂ ĐÀO ${blockToDig.name} dù đã (thử) trang bị ${bot.heldItem?.name}. Bỏ qua khối.`
            );
            finishCollectingTask(
              bot,
              false,
              `Không thể đào ${task.itemNameVi}, có thể do quyền hoặc lỗi server.`
            );
            return;
          }
        }

        // Mọi thứ ổn -> Đào
        task.status = "collecting";
        console.log(
          `[Block Logic] Bắt đầu đào ${task.itemId} tại ${formatCoords(
            targetPosition
          )} bằng ${bot.heldItem?.name}.`
        );

        try {
          const amountBeforeDig = countItemManually(bot.inventory, countItemId);
          await bot.dig(blockToDig);
          console.log(
            `[Block Logic] Đào xong ${formatCoords(
              targetPosition
            )}. Chờ nhặt...`
          );
          task.status = "waiting_pickup";
          task.pickupAttempts = 0;
          task.amountBeforePickup = amountBeforeDig;

          setTimeout(
            () => handleBlockCollection(bot),
            ITEM_PICKUP_WAIT_TICKS * 50
          );
          return;
        } catch (digError) {
          console.error(
            `[Block Logic] Lỗi khi đào ${formatCoords(targetPosition)}: ${
              digError.message
            }`
          );
          const blockCheckAfterError = bot.blockAt(targetPosition);
          if (
            !blockCheckAfterError ||
            blockCheckAfterError.type !== targetBlockId
          ) {
            console.log(
              "[Block Logic] Block không còn tồn tại sau lỗi đào. Tìm block khác."
            );
          } else {
            bot.chat(`Lỗi khi đào ${task.itemNameVi}: ${digError.message}`);
          }
          task.currentTarget = null;
          task.status = "idle";
          setTimeout(() => handleBlockCollection(bot), CHECK_INTERVAL);
          return;
        }
        break;

      case "collecting":
        console.warn("[Block Logic] Bị kẹt ở trạng thái 'collecting'? Chờ...");
        setTimeout(() => handleBlockCollection(bot), CHECK_INTERVAL);
        return;

      case "waiting_pickup":
        task.pickupAttempts++;
        console.debug(
          `[Block Logic] Chờ nhặt lần ${task.pickupAttempts}/${ITEM_PICKUP_MAX_ATTEMPTS}...`
        );
        const amountAfterWait = countItemManually(bot.inventory, countItemId);

        if (amountAfterWait > task.amountBeforePickup) {
          const pickedUpCount = amountAfterWait - task.amountBeforePickup;
          console.log(
            `[Block Logic] Xác nhận nhặt được ${pickedUpCount} ${countItemName}! SL: ${amountAfterWait}`
          );
          task.currentQuantity = amountAfterWait;
          bot.chat(
            `+${pickedUpCount} ${task.itemNameVi}. (${amountAfterWait}/${task.targetQuantity})`
          );
          task.currentTarget = null; // Tìm khối mới
          task.status = "idle";
          setTimeout(
            () => handleBlockCollection(bot),
            VERY_SHORT_CHECK_INTERVAL
          );
          return;
        } else if (task.pickupAttempts >= ITEM_PICKUP_MAX_ATTEMPTS) {
          console.warn(
            `[Block Logic] Không xác nhận nhặt ${countItemName} sau ${task.pickupAttempts} lần. Tiếp tục...`
          );
          task.currentQuantity = amountAfterWait;
          task.currentTarget = null; // Tìm khối mới
          task.status = "idle";
          setTimeout(() => handleBlockCollection(bot), SHORT_CHECK_INTERVAL);
          return;
        } else {
          setTimeout(
            () => handleBlockCollection(bot),
            ITEM_PICKUP_WAIT_TICKS * 50
          ); // Chờ tiếp
          return;
        }
        break;

      case "idle":
        console.warn(
          "[Block Logic] Lặp lại ở trạng thái 'idle'? Chờ tìm mục tiêu..."
        );
        setTimeout(() => handleBlockCollection(bot), SHORT_CHECK_INTERVAL);
        return;

      default:
        console.error(
          `[Block Logic] Trạng thái không xác định: ${task.status}. Reset về 'idle'.`
        );
        task.status = "idle";
        setTimeout(() => handleBlockCollection(bot), CHECK_INTERVAL);
        return;
    }
  } catch (error) {
    console.error("[Block Logic] Lỗi nghiêm trọng không mong muốn:", error);
    finishCollectingTask(
      bot,
      false,
      `Lỗi hệ thống khi thu thập ${task.itemNameVi}: ${error.message}`
    );
  }
}

function collectionLoop(bot) {
  if (!bot.collectingTaskDetails || !bot.isCollecting) return;

  const task = bot.collectingTaskDetails;
  if (!task) {
    console.error("[Collect Loop] Task is null. Stopping.");
    if (bot.isCollecting)
      finishCollectingTask(bot, false, "Lỗi: Nhiệm vụ bị hủy.");
    return;
  }

  if (task.collectionStrategy === "tree") {
    handleTreeCollection(bot).catch((err) => {
      console.error("!!! Lỗi chưa xử lý trong handleTreeCollection:", err);
      finishCollectingTask(
        bot,
        false,
        "Lỗi hệ thống nghiêm trọng khi chặt cây."
      );
    });
  } else if (task.collectionStrategy === "block") {
    handleBlockCollection(bot).catch((err) => {
      console.error("!!! Lỗi chưa xử lý trong handleBlockCollection:", err);
      finishCollectingTask(
        bot,
        false,
        "Lỗi hệ thống nghiêm trọng khi đào khối."
      );
    });
  } else {
    console.error(
      `[Collect Loop] Chiến lược không xác định: ${task.collectionStrategy}`
    );
    finishCollectingTask(
      bot,
      false,
      `Lỗi: Không biết cách thu thập loại này (${task.collectionStrategy}).`
    );
  }
}

async function digBlockIfNotAir(bot, position, task = null) {
  const block = bot.blockAt(position);
  if (
    !block ||
    ["air", "cave_air", "void_air", "bedrock", "barrier"].includes(block.name)
  )
    return false;

  // Xử lý khối rơi phía trên
  const checkAbovePos = position.offset(0, 1, 0);
  const blockAbove = bot.blockAt(checkAbovePos);
  if (
    blockAbove &&
    ["sand", "gravel", "red_sand", "concrete_powder"].some((name) =>
      blockAbove.name.includes(name)
    )
  ) {
    console.log(
      `[Dig Util] Phát hiện ${blockAbove.name} phía trên ${formatCoords(
        checkAbovePos
      )}. Đào trên trước.`
    );
    try {
      if (
        bot.entity.position.distanceTo(checkAbovePos.offset(0.5, 0.5, 0.5)) <=
        REACH_BLOCK_DIST
      ) {
        const dugAbove = await digBlockIfNotAir(bot, checkAbovePos, task);
        if (dugAbove) {
          await bot.waitForTicks(5);
          const originalBlockAgain = bot.blockAt(position);
          if (originalBlockAgain && originalBlockAgain.name !== "air") {
            return await digBlockIfNotAir(bot, position, task);
          } else {
            console.debug(
              "[Dig Util] Khối gốc đã biến mất sau khi đào khối trên."
            );
            return true;
          }
        } else {
          throw new Error(
            `Không đào được ${blockAbove.name} che phía trên ${block.name}`
          );
        }
      } else {
        throw new Error(
          `Không với tới ${blockAbove.name} che phía trên ${block.name}`
        );
      }
    } catch (err) {
      console.error(
        `[Dig Util] Lỗi khi xử lý khối rơi phía trên: ${err.message}`
      );
      throw err;
    }
  }

  // Kiểm tra khả năng đào
  let canDig = bot.canDigBlock(block);
  if (!canDig) {
    console.warn(
      `[Dig Util] Báo cáo không thể đào ${block.name}. Thử trang bị tool...`
    );
    const toolToEquip =
      task?.requiredToolType && task.requiredToolType !== "any"
        ? task.requiredToolType
        : getDefaultToolForBlock(block);

    if (toolToEquip !== "any") {
      console.debug(`[Dig Util] Tool đề xuất: ${toolToEquip}`);
      if (await equipBestTool(bot, toolToEquip, true)) {
        canDig = bot.canDigBlock(block);
        if (!canDig) {
          if (!isToolNeededForDrop(block)) {
            console.warn(
              `[Dig Util] Tool ${toolToEquip} không bắt buộc. Thử đào tay...`
            );
            canDig = true; // Cho phép thử đào tay
          } else {
            throw new Error(
              `Vẫn không đào được ${block.name} dù đã trang bị ${toolToEquip}`
            );
          }
        } else {
          console.debug(`[Dig Util] Trang bị ${toolToEquip} thành công.`);
        }
      } else {
        if (!isToolNeededForDrop(block)) {
          console.warn(
            `[Dig Util] Không có tool ${toolToEquip}, nhưng không bắt buộc. Thử đào tay...`
          );
          canDig = true;
        } else {
          throw new Error(
            `Thiếu công cụ bắt buộc (${toolToEquip}) để đào ${block.name}`
          );
        }
      }
    } else {
      canDig = bot.canDigBlock(block); // Kiểm tra lại nếu tool là 'any'
      if (!canDig)
        throw new Error(
          `Không thể đào ${block.name} không rõ lý do (tool 'any').`
        );
      else console.debug(`[Dig Util] Tool là 'any', có thể đào.`);
    }
  }

  if (!canDig)
    throw new Error(
      `Không thể đào ${block.name} tại ${formatCoords(position)}.`
    );

  // Thực hiện đào
  try {
    console.log(`[Dig Util] Đào: ${block.name} tại ${formatCoords(position)}`);
    await bot.dig(block);
    return true;
  } catch (err) {
    console.error(`[Dig Util] Lỗi bot.dig ${block.name}:`, err.message);
    const blockExists = bot.blockAt(position);
    if (!blockExists || blockExists.name === "air") {
      console.log("[Dig Util] Block đã biến mất trong quá trình đào.");
      return true;
    }
    throw err;
  }
}

function isToolNeededForDrop(block) {
  if (!block || !block.harvestTools) return false;
  return Object.keys(block.harvestTools).length > 0;
}

function getDefaultToolForBlock(block) {
  if (!block) return "any";
  const mcData = require("minecraft-data")(bot.version);

  if (block.harvestTools) {
    const toolIds = Object.keys(block.harvestTools).map((id) =>
      parseInt(id, 10)
    );
    for (const toolId of toolIds) {
      const toolInfo = mcData.items[toolId];
      if (toolInfo) {
        if (toolInfo.name.includes("pickaxe")) return "pickaxe";
        if (toolInfo.name.includes("axe")) return "axe";
        if (toolInfo.name.includes("shovel")) return "shovel";
        if (toolInfo.name.includes("hoe")) return "hoe";
        if (toolInfo.name.includes("shear")) return "shears";
      }
    }
  }

  if (logSuffixes.some((suffix) => block.name.includes(suffix))) return "axe";
  if (
    block.material &&
    ["rock", "stone", "iron", "metal"].includes(block.material)
  )
    return "pickaxe";
  if (
    block.material &&
    [
      "dirt",
      "sand",
      "gravel",
      "clay",
      "snow",
      "grass_block",
      "soul_sand",
      "soul_soil",
    ].includes(block.material)
  )
    return "shovel";
  if (
    leafNames.some((name) => block.name.includes(name)) ||
    block.name.includes("web")
  )
    return "shears";
  if (block.name.includes("wool")) return "shears";
  // if (block.material === 'plant' && !logSuffixes.some(s=>block.name.includes(s))) return 'hoe'; // Có thể gây tranh cãi

  return "any";
}

function finishCollectingTask(bot, success, message) {
  if (!bot.isCollecting && !bot.collectingTaskDetails) {
    console.warn("[Collect Finish] Gọi finish nhưng không có task.");
    return;
  }
  const task = bot.collectingTaskDetails;
  const username = task?.username || "bạn";
  const taskName = task?.itemNameVi || "vật phẩm";
  const finalAmount = countItemManually(
    bot.inventory,
    task?.droppedItemId ?? -1
  );
  const targetAmount = task?.targetQuantity ?? "?";
  const duration = task?.startTime
    ? ((Date.now() - task.startTime) / 1000).toFixed(1) + "s"
    : "?s";

  let finalMessage = message;
  if (success) {
    finalMessage = `Đã thu thập xong ${finalAmount}/${targetAmount} ${taskName}. (${duration}) ${message}`;
  } else {
    finalMessage = `Đã dừng thu thập ${taskName}. (${duration}) Lý do: ${message}. Có ${finalAmount}/${targetAmount}.`;
  }

  console.log(
    `[Collect Finish] Task ${username}. Success: ${success}. Message: ${finalMessage}`
  );
  if (finalMessage) {
    bot.chat(`${username}, ${finalMessage}`);
  }

  bot.isCollecting = false;
  bot.collectingTaskDetails = null;

  try {
    if (bot.pathfinder && typeof bot.pathfinder.stop === "function") {
      if (bot.pathfinder.isMoving()) {
        bot.pathfinder.stop();
        console.log("[Collect Finish] Đã dừng pathfinder.");
      }
      bot.pathfinder.setGoal(null);
    }
  } catch (e) {
    console.error("[Collect Finish] Lỗi khi dừng/reset pathfinder:", e.message);
  }
}

function stopCollecting(bot, username) {
  if (bot.isCollecting && bot.collectingTaskDetails) {
    console.log(`[Collect Stop] User ${username} yêu cầu dừng.`);
    finishCollectingTask(bot, false, `Đã dừng theo yêu cầu của bạn`);
  } else {
    console.log(
      `[Collect Stop] User ${username} yêu cầu dừng nhưng không có task đang chạy.`
    );
    bot.chat(`${username}, tôi đâu có đang thu thập gì đâu?`);
  }
}
// =============================================================================
// KHỞI ĐỘNG TASK THU THẬP
// =============================================================================
async function startCollectingTask(bot, username, message, aiModel) {
  console.log(`[Collect Cmd] Yêu cầu từ ${username}: "${message}"`);

  // --- Kiểm tra trạng thái bận ---
  const busyStates = [
    { key: "isFinding", reason: "tìm đồ" },
    { key: "isFollowing", reason: "đi theo" },
    { key: "isProtecting", reason: "bảo vệ" },
    { key: "isCollecting", reason: "thu thập" },
    { key: "isStripMining", reason: "đào hầm" },
    { key: "isHunting", reason: "săn bắn" },
    { key: "isCleaningInventory", reason: "dọn túi đồ" },
    { key: "isDepositing", reason: "cất đồ" },
  ];
  for (const state of busyStates) {
    if (bot[state.key]) {
      bot.chat(`${username}, tôi đang bận ${state.reason} rồi!`);
      console.log(`[Collect Cmd] Bị chặn do đang ${state.reason}.`);
      return;
    }
  }

  const extractionPrompt = `Từ tin nhắn "${message}" của người chơi "${username}", trích xuất tên vật phẩm/khối họ muốn thu thập và số lượng. Nếu không nói số lượng, mặc định là 64. Chỉ trả lời bằng định dạng JSON với hai khóa: "itemName" (string, giữ nguyên tiếng Việt nếu có) và "quantity" (number). Ví dụ: "lấy cho tôi 32 cục đá cuội" -> {"itemName": "đá cuội", "quantity": 32}. Nếu không rõ vật phẩm hoặc số lượng, trả về {"itemName": null, "quantity": 0}. JSON:`;
  let itemNameVi = null;
  let quantity = 64;
  try {
    console.debug("[Collect Cmd] Bước 1: Trích xuất yêu cầu bằng AI...");
    const extractResult = await aiModel.generateContent(extractionPrompt);
    const jsonResponse = (await extractResult.response.text()).trim();
    let parsedData;
    try {
      const jsonMatch = jsonResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsedData = JSON.parse(jsonMatch[0]);
      else throw new Error("Không tìm thấy JSON trong phản hồi AI.");
    } catch (parseError) {
      console.error(
        "[Collect Cmd] Lỗi parse JSON từ AI:",
        parseError.message,
        "| Response:",
        jsonResponse
      );
      if (
        !jsonResponse.includes("{") &&
        !jsonResponse.includes(":") &&
        jsonResponse.length < 50 &&
        jsonResponse.length > 1
      ) {
        itemNameVi = jsonResponse.trim().replace(/[.!?,]$/, "");
        quantity = 64;
        console.warn(
          `[Collect Cmd] Fallback (No JSON): Name="${itemNameVi}", Qty=${quantity}.`
        );
      } else {
        bot.chat(`Xin lỗi ${username}, tôi không hiểu rõ yêu cầu của bạn.`);
        return;
      }
    }
    if (parsedData) {
      itemNameVi = parsedData.itemName;
      quantity = parseInt(parsedData.quantity, 10);
    }

    if (
      !itemNameVi ||
      typeof itemNameVi !== "string" ||
      itemNameVi.trim() === ""
    ) {
      console.error("[Collect Cmd] AI không trích xuất được tên item hợp lệ.");
      bot.chat(
        `Xin lỗi ${username}, tôi không rõ bạn muốn thu thập vật phẩm nào.`
      );
      return;
    }
    if (isNaN(quantity) || quantity <= 0) {
      console.warn(
        `[Collect Cmd] Số lượng không hợp lệ hoặc bằng 0 (${parsedData?.quantity}), mặc định 64.`
      );
      quantity = 64;
    }
    itemNameVi = itemNameVi.trim();
    quantity = Math.max(1, Math.min(quantity, 2304));
    console.log(
      `[Collect Cmd] Trích xuất AI: Tên="${itemNameVi}", Số lượng=${quantity}`
    );
  } catch (error) {
    console.error("[Collect Cmd] Lỗi trong quá trình trích xuất AI:", error);
    bot.chat(
      `Xin lỗi ${username}, đã xảy ra lỗi khi tôi cố gắng hiểu yêu cầu của bạn.`
    );
    return;
  }

  let itemId;
  let itemInfo;
  let droppedItemInfo;
  let droppedItemId = null;
  let mcDataInstance;
  try {
    console.debug(`[Collect Cmd] Bước 2: Dịch & Kiểm tra "${itemNameVi}"...`);
    itemId = translateToEnglishId(itemNameVi);
    if (!itemId) {
      bot.chat(`Xin lỗi ${username}, tôi không biết vật phẩm "${itemNameVi}".`);
      return;
    }
    mcDataInstance = require("minecraft-data")(bot.version);

    itemInfo = mcDataInstance.blocksByName[itemId]; // Ưu tiên khối

    if (itemInfo) {
      console.log(
        `[Collect Cmd] Mục tiêu là khối "${itemId}" (ID: ${itemInfo.id}).`
      );
      if (itemInfo.drops && itemInfo.drops.length > 0) {
        droppedItemId = itemInfo.drops[0];
        droppedItemInfo = mcDataInstance.items[droppedItemId];
        if (!droppedItemInfo) {
          console.error(
            `[Collect Cmd] Lỗi: ID drop ${droppedItemId} từ khối ${itemId} không hợp lệ. Dùng ID khối.`
          );
          droppedItemId = itemInfo.id;
          droppedItemInfo = mcDataInstance.items[droppedItemId];
        }
      } else {
        droppedItemId = itemInfo.id;
        droppedItemInfo = mcDataInstance.items[droppedItemId];
        console.warn(
          `[Collect Cmd] Khối ${itemId} không có 'drops'. Giả định ID drop = ID khối = ${droppedItemId}.`
        );
      }
    } else {
      itemInfo = mcDataInstance.itemsByName[itemId]; // Thử tìm item
      if (itemInfo) {
        const foodInfo = mcDataInstance.foodsByName[itemId];
        if (foodInfo) {
          if (typeof bot.startHuntingTask === "function") {
            console.log(
              `[Collect Cmd] Yêu cầu "${itemNameVi}" là thức ăn -> Săn bắn.`
            );
            bot.startHuntingTask(username, itemId, quantity, aiModel);
            return;
          } else {
            bot.chat(
              `Xin lỗi ${username}, "${itemNameVi}" là thức ăn nhưng tôi chưa biết đi săn.`
            );
            return;
          }
        } else {
          bot.chat(
            `Xin lỗi ${username}, "${itemNameVi}" là vật phẩm, tôi chỉ đào khối/chặt cây thôi.`
          );
          return;
        }
      } else {
        bot.chat(
          `Xin lỗi ${username}, không tìm thấy thông tin về "${itemNameVi}" (${itemId}).`
        );
        return;
      }
    }

    if (!droppedItemInfo) {
      console.error(
        `[Collect Cmd] Lỗi: Không xác định được item drop hợp lệ (ID: ${droppedItemId}) từ "${itemNameVi}".`
      );
      bot.chat(`Lỗi: Không xác định được vật phẩm rơi ra từ ${itemNameVi}.`);
      return;
    }
    console.log(
      `[Collect Cmd] Sẽ đếm: "${droppedItemInfo.name}" (ID: ${droppedItemId}, Display: ${droppedItemInfo.displayName}).`
    );
  } catch (error) {
    console.error("[Collect Cmd] Lỗi dịch/mcData:", error);
    bot.chat(`Xin lỗi ${username}, lỗi tìm thông tin "${itemNameVi}".`);
    return;
  }

  let collectionStrategy = "block";
  let requiredTool = "any";

  if (logSuffixes.some((suffix) => itemInfo.name.includes(suffix))) {
    collectionStrategy = "tree";
    requiredTool = "axe";
  } else {
    collectionStrategy = "block";
    requiredTool = getDefaultToolForBlock(itemInfo);
  }
  console.log(
    `[Collect Cmd] Bước 3: Chiến lược: ${collectionStrategy}. Công cụ mặc định: ${requiredTool}.`
  );

  const initialAmount = countItemManually(bot.inventory, droppedItemId);
  bot.isCollecting = true;
  bot.collectingTaskDetails = {
    username: username,
    startTime: Date.now(),
    itemNameVi: itemNameVi,
    itemId: itemInfo.name,
    itemType: itemInfo,
    droppedItemId: droppedItemId,
    droppedItemName: droppedItemInfo.name,
    targetQuantity: quantity,
    currentQuantity: initialAmount,
    requiredToolType: requiredTool,
    collectionStrategy: collectionStrategy,
    status: "idle",
    currentTarget: null,
    currentTreeBaseLog: null,
    currentTreeLog: null,
    lastLogPosition: null,
    pickupAttempts: 0,
    amountBeforePickup: 0,
    consecutivePathErrors: 0, // Khởi tạo bộ đếm lỗi
    lastErrorTime: 0,
  };
  console.log(
    `[Collect Cmd] Bước 4: Khởi tạo task. Đếm ${droppedItemInfo.displayName} (ID: ${droppedItemId}). Có ${initialAmount}/${quantity}.`
  );
  bot.chat(
    `Ok ${username}, bắt đầu ${
      collectionStrategy === "tree" ? "chặt cây" : "đào"
    } ${quantity} ${itemNameVi}. Hiện có ${initialAmount}.`
  );

  console.log("[Collect Cmd] Bước 5: Cấu hình và bắt đầu vòng lặp...");
  const mc = require("minecraft-data")(bot.version);
  const defaultMove = new Movements(bot, mc);
  defaultMove.canDig = true;
  defaultMove.allowSprinting = true;
  defaultMove.allowParkour = true; // Cho phép parkour có thể hữu ích khi chặt cây
  defaultMove.canPlaceBlocks = true;
  defaultMove.placeBlockRange = 3;
  defaultMove.digCost = 10;
  defaultMove.maxDropDown = 5;

  // Thêm các khối bắc cầu vào danh sách cho phép
  defaultMove.scaffoldBlockNames = [...scaffoldBlockNames]; // Sử dụng danh sách đã định nghĩa ở trên
  console.log(
    "[Movements Setup] Using scaffold blocks:",
    defaultMove.scaffoldBlockNames.join(", ")
  );

  bot.pathfinder.setMovements(defaultMove);

  collectionLoop(bot);
}

module.exports = {
  startCollectingTask,
  stopCollecting,
};

// --- END OF FILE collect.js ---
