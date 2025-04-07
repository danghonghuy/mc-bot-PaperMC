// --- START OF FILE collect.js ---

const { GoalNear, GoalBlock } = require("mineflayer-pathfinder").goals;
const { Vec3 } = require("vec3");
const { Movements } = require("mineflayer-pathfinder");
const { translateToEnglishId, formatCoords } = require("../utils");

const MAX_COLLECT_FIND_DISTANCE = 640;
const NEARBY_BLOCK_FIND_RADIUS = 640;
const REACH_BLOCK_DIST = 5;
const REACH_TREE_BASE_DIST = 1;
const MAX_VERTICAL_REACH = 5;
const CHECK_INTERVAL = 500;
const SHORT_CHECK_INTERVAL = 100;
const VERY_SHORT_CHECK_INTERVAL = 50;
const ITEM_PICKUP_WAIT_TICKS = 10;
const ITEM_PICKUP_MAX_ATTEMPTS = 5;
const LEAF_CLEAR_RADIUS = 2;
const MAX_PATHFINDER_ERRORS = 3;
const APPROACH_GOAL_RADIUS = REACH_BLOCK_DIST - 1;
const PICKUP_MOVEMENT_RADIUS = 1.5;
const PICKUP_MOVEMENT_TIMEOUT = 300; // ms

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
  "deepslate",
  "cobbled_deepslate",
  "tuff",
  "calcite",
];
const leafNames = [
  "leaves",
  "wart_block",
  "shroomlight",
  "azalea_leaves",
  "flowering_azalea_leaves",
  "cherry_leaves",
];
const scaffoldBlockNames = [
  "dirt",
  "cobblestone",
  "netherrack",
  "cobbled_deepslate",
  "stone",
];
const nonDiggingSwords = ["_sword"];

function isToolOfType(itemName, toolTypeSuffix) {
  if (!itemName || !toolTypeSuffix) return false;
  if (nonDiggingSwords.some((suffix) => itemName.endsWith(suffix)))
    return false;
  return itemName.endsWith(`_${toolTypeSuffix}`);
}

function isShears(itemName) {
  return itemName === "shears";
}

function countItemManually(inventory, targetItemId) {
  if (targetItemId === null || targetItemId === undefined) return 0;
  try {
    return inventory.count(targetItemId) ?? 0;
  } catch (e) {
    console.warn(
      `[Đếm Thủ Công] Lỗi đếm ID vật phẩm ${targetItemId}:`,
      e.message
    );
    return 0;
  }
}

async function equipBestTool(bot, toolType, allowDowngrade = false) {
  const mcData = require("minecraft-data")(bot.version);
  let bestToolFound = null;
  let highestTier = -1;
  const currentTool = bot.heldItem;
  let currentToolIsCorrectType = false;
  let currentTier = -1;

  if (
    toolType !== "sword" &&
    nonDiggingSwords.some((suffix) => toolType.endsWith(suffix))
  ) {
    console.warn(
      `[Trang Bị] Từ chối trang bị kiếm ('${toolType}') cho việc không phải chiến đấu.`
    );
    toolType = "any";
  }

  if (currentTool) {
    if (toolType === "shears") {
      currentToolIsCorrectType = isShears(currentTool.name);
      currentTier = currentToolIsCorrectType ? 99 : -1;
    } else {
      currentToolIsCorrectType = isToolOfType(currentTool.name, toolType);
      if (currentToolIsCorrectType) {
        const material = currentTool.name.split("_")[0];
        currentTier = toolMaterialTier[material] || 0;
      }
    }
  }

  for (const item of bot.inventory.items()) {
    if (
      toolType !== "sword" &&
      nonDiggingSwords.some((suffix) => item.name.endsWith(suffix))
    ) {
      continue;
    }
    let itemIsCorrectType = false;
    let itemTier = -1;
    if (toolType === "shears") {
      itemIsCorrectType = isShears(item.name);
      itemTier = itemIsCorrectType ? 99 : -1;
    } else {
      itemIsCorrectType = isToolOfType(item.name, toolType);
      if (itemIsCorrectType) {
        const material = item.name.split("_")[0];
        itemTier = toolMaterialTier[material] || 0;
      }
    }
    if (itemIsCorrectType && itemTier > highestTier) {
      highestTier = itemTier;
      bestToolFound = item;
    }
  }

  if (
    bestToolFound &&
    (!currentTool || currentTool.name !== bestToolFound.name)
  ) {
    try {
      console.log(
        `[Trang Bị] Trang bị công cụ tốt nhất: ${bestToolFound.name} cho loại ${toolType}`
      );
      await bot.equip(bestToolFound, "hand");
      await bot.waitForTicks(2);
      return true;
    } catch (err) {
      console.error(
        `[Trang Bị] Không thể trang bị ${bestToolFound.name}:`,
        err.message
      );
      return false;
    }
  } else if (
    bestToolFound &&
    currentTool &&
    currentTool.name === bestToolFound.name
  ) {
    console.debug(
      `[Trang Bị] Đã cầm sẵn công cụ phù hợp: ${bestToolFound.name}`
    );
    return true;
  } else if (!bestToolFound && allowDowngrade) {
    console.debug(
      `[Trang Bị] Không tìm thấy công cụ '${toolType}', cho phép cấp thấp. Dùng tay/vật phẩm hiện tại.`
    );
    if (currentTool && toolType !== "any" && !currentToolIsCorrectType) {
      try {
        console.log(
          `[Trang Bị] Bỏ trang bị công cụ không phù hợp ${currentTool.name} để dùng tay.`
        );
        await bot.unequip("hand");
        await bot.waitForTicks(1);
      } catch (e) {
        console.warn("Không thể bỏ trang bị");
      }
    }
    return true;
  } else {
    console.log(
      `[Trang Bị] Không tìm thấy công cụ '${toolType}' phù hợp và không cho phép cấp thấp.`
    );
    return false;
  }
}

function findNearbyBlock(bot, taskDetails) {
  if (!bot.entity?.position) return null; // Thêm kiểm tra bot entity
  const mcData = require("minecraft-data")(bot.version);
  const blockType = taskDetails.itemType;
  if (!blockType) return null;
  const blockId = blockType.id;
  const botY = bot.entity.position.y;
  const botPos = bot.entity.position;

  try {
    const nearbyBlocksPos = bot.findBlocks({
      matching: blockId,
      maxDistance: NEARBY_BLOCK_FIND_RADIUS,
      count: 50, // Có thể tăng count nếu cần nhiều lựa chọn hơn
      useExtraChunks: true,
      point: botPos.offset(0, 0.1, 0),
    });

    if (nearbyBlocksPos.length === 0) return null;

    // === SỬA ĐOẠN LỌC VÀ MAP ===
    const now = Date.now();
    const validBlocks = nearbyBlocksPos
      .map((pos) => ({ pos, block: bot.blockAt(pos) })) // Lấy block trước
      .filter(({ pos, block }) => {
        // Lọc ngay sau khi lấy block
        if (!block || block.type !== blockId) return false; // Loại bỏ null hoặc sai loại
        // Kiểm tra blacklist
        const posStr = `${pos.x},${pos.y},${pos.z}`;
        if (
          taskDetails.temporaryBlacklist[posStr] &&
          taskDetails.temporaryBlacklist[posStr] > now
        ) {
          // console.debug(`[Tìm Gần] Bỏ qua ${formatCoords(pos)} do đang trong blacklist.`);
          return false; // Bỏ qua nếu trong blacklist và chưa hết hạn
        }
        // Kiểm tra độ cao
        if (Math.abs(block.position.y - botY) > MAX_VERTICAL_REACH + 2)
          return false; // +2 ở đây có vẻ hợp lý cho tìm kiếm gần
        return true; // Giữ lại nếu hợp lệ
      })
      .map((item) => ({ ...item, distSq: botPos.distanceSquared(item.pos) })) // Tính distSq sau khi lọc
      .sort((a, b) => a.distSq - b.distSq); // Sắp xếp
    if (validBlocks.length > 0) {
      const targetBlock = validBlocks[0].block;
      if (targetBlock.position.y > botY + MAX_VERTICAL_REACH - 0.5) {
        console.debug(
          `[Tìm Gần] Khối gần nhất ${formatCoords(
            targetBlock.position
          )} quá cao. Tìm tiếp...`
        );
        const suitableBlock = validBlocks.find(
          (b) => b.block.position.y <= botY + MAX_VERTICAL_REACH - 0.5
        )?.block;
        if (suitableBlock) {
          console.log(
            `[Tìm Gần] Tìm thấy khối gần phù hợp tại ${formatCoords(
              suitableBlock.position
            )}.`
          );
          return suitableBlock;
        } else {
          console.debug(`[Tìm Gần] Không có khối nào gần đó trong tầm cao.`);
          return null;
        }
      }
      console.log(
        `[Tìm Gần] Tìm thấy khối gần nhất tại ${formatCoords(
          targetBlock.position
        )}.`
      );
      return targetBlock;
    }
  } catch (err) {
    console.error(`[Tìm Gần] Lỗi khi tìm ${taskDetails.itemId}:`, err);
  }
  return null;
}

function findFarBlock(bot, taskDetails) {
  if (!bot.entity?.position) return null;
  const mcData = require("minecraft-data")(bot.version);
  const blockType = taskDetails.itemType;
  if (!blockType) return null;
  const blockId = blockType.id;
  const botY = bot.entity.position.y;
  const botPos = bot.entity.position;

  try {
    const foundBlocksPos = bot.findBlocks({
      matching: blockId,
      maxDistance: MAX_COLLECT_FIND_DISTANCE,
      count: 60, // Có thể tăng count
      useExtraChunks: true,
      point: botPos.offset(0, 0.1, 0),
    });

    if (foundBlocksPos.length === 0) return null;

    // === SỬA ĐOẠN LỌC VÀ MAP ===
    const now = Date.now();
    const validBlocks = foundBlocksPos
      .map((pos) => ({ pos, block: bot.blockAt(pos) }))
      .filter(({ pos, block }) => {
        if (!block || block.type !== blockId) return false;
        const posStr = `${pos.x},${pos.y},${pos.z}`;
        if (
          taskDetails.temporaryBlacklist[posStr] &&
          taskDetails.temporaryBlacklist[posStr] > now
        ) {
          // console.debug(`[Tìm Xa] Bỏ qua ${formatCoords(pos)} do đang trong blacklist.`);
          return false;
        }
        // Kiểm tra độ cao rộng hơn cho tìm xa
        if (Math.abs(block.position.y - botY) > MAX_VERTICAL_REACH + 10)
          return false;
        return true;
      })
      .map((item) => ({ ...item, distSq: botPos.distanceSquared(item.pos) }))
      .sort((a, b) => a.distSq - b.distSq);
    if (validBlocks.length > 0) {
      const targetBlock = validBlocks[0].block;
      if (targetBlock.position.y > botY + MAX_VERTICAL_REACH - 0.5) {
        console.debug(
          `[Tìm Xa] Khối xa gần nhất ${formatCoords(
            targetBlock.position
          )} quá cao. Tìm tiếp...`
        );
        const suitableBlock = validBlocks.find(
          (b) => b.block.position.y <= botY + MAX_VERTICAL_REACH - 0.5
        )?.block;
        if (suitableBlock) {
          console.log(
            `[Tìm Xa] Tìm thấy khối xa phù hợp tại ${formatCoords(
              suitableBlock.position
            )}.`
          );
          return suitableBlock;
        } else {
          console.log(
            `[Tìm Xa] Tất cả các khối xa tìm thấy đều quá cao hoặc không hợp lệ.`
          );
          return null;
        }
      }
      console.log(
        `[Tìm Xa] Tìm thấy khối xa gần nhất tại ${formatCoords(
          targetBlock.position
        )}.`
      );
      return targetBlock;
    }
  } catch (err) {
    console.error(`[Tìm Xa] Lỗi khi tìm ${taskDetails.itemId}:`, err);
  }
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

  try {
    while (attempts < maxCheckDepth) {
      attempts++;
      const posBelow = currentPos.offset(0, -1, 0);
      const blockBelow = bot.blockAt(posBelow);
      if (
        !blockBelow ||
        ["air", "cave_air", "void_air"].includes(blockBelow.name)
      )
        break;
      if (blockBelow.name === logTypeName) {
        basePos = posBelow;
        currentPos = posBelow;
      } else if (groundMaterials.includes(blockBelow.name)) {
        break;
      } else {
        break;
      }
    }
    const finalBaseBlock = bot.blockAt(basePos);
    if (finalBaseBlock && finalBaseBlock.name === logTypeName) {
      return finalBaseBlock;
    } else {
      return null;
    }
  } catch (err) {
    console.error(`[Logic Cây] Lỗi khi tìm gốc cây:`, err);
    return null;
  }
}

async function clearObstructingLeaves(bot, targetPos) {
  const mcData = require("minecraft-data")(bot.version);
  let clearedSomething = false;
  const originalTool = bot.heldItem
    ? { name: bot.heldItem.name, type: bot.heldItem.type }
    : null;
  let toolToUse = null;
  let equippedForClearing = false;

  const shears = bot.inventory.findInventoryItem(mcData.itemsByName.shears?.id);
  if (shears) {
    toolToUse = shears;
  } else {
    let bestAxe = null;
    let highestAxeTier = -1;
    for (const item of bot.inventory.items()) {
      if (isToolOfType(item.name, "axe")) {
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
    }
  }

  if (toolToUse && (!originalTool || originalTool.name !== toolToUse.name)) {
    try {
      await bot.equip(toolToUse, "hand");
      await bot.waitForTicks(1);
      equippedForClearing = true;
    } catch (err) {
      console.warn(
        `[Logic Cây] Không thể trang bị ${toolToUse.name} để dọn lá: ${err.message}. Dùng tay.`
      );
      toolToUse = null;
    }
  } else if (
    toolToUse &&
    originalTool &&
    originalTool.name === toolToUse.name
  ) {
    equippedForClearing = true;
  }

  try {
    for (let dy = LEAF_CLEAR_RADIUS + 1; dy >= -1; dy--) {
      for (let dx = -LEAF_CLEAR_RADIUS; dx <= LEAF_CLEAR_RADIUS; dx++) {
        for (let dz = -LEAF_CLEAR_RADIUS; dz <= LEAF_CLEAR_RADIUS; dz++) {
          const checkPos = targetPos.offset(dx, dy, dz);
          if (checkPos.equals(targetPos)) continue;
          const block = bot.blockAt(checkPos);
          if (block && leafNames.some((name) => block.name.includes(name))) {
            if (
              bot.entity.position.distanceTo(checkPos.offset(0.5, 0.5, 0.5)) <=
              REACH_BLOCK_DIST + 1
            ) {
              try {
                if (bot.canDigBlock(block)) {
                  await bot.dig(block);
                  clearedSomething = true;
                  await bot.waitForTicks(1);
                }
              } catch (err) {
                /* Ignored */
              }
            }
          }
        }
      }
    }
  } catch (loopError) {
    console.error("[Logic Cây] Lỗi trong vòng lặp dọn lá:", loopError);
  }

  if (equippedForClearing) {
    try {
      if (originalTool && bot.heldItem?.name !== originalTool.name) {
        await bot.equip(originalTool.type, "hand");
        await bot.waitForTicks(1);
      } else if (!originalTool && bot.heldItem) {
        await bot.unequip("hand");
        await bot.waitForTicks(1);
      }
    } catch (equipError) {
      console.warn(
        "[Logic Cây] Lỗi khi phục hồi công cụ ban đầu:",
        equipError.message
      );
    }
  }
  return clearedSomething;
}

function isToolNeededForDrop(block) {
  if (!block || !block.harvestTools) return false;
  const toolIds = Object.keys(block.harvestTools);
  return toolIds.length > 0;
}

function getDefaultToolForBlock(bot, block) {
  if (!block) return "any";
  const mcData = require("minecraft-data")(bot.version);
  if (nonDiggingSwords.some((suffix) => block.name.includes(suffix)))
    return "any";
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
        if (toolInfo.name === "shears") return "shears";
      }
    }
  }
  if (logSuffixes.some((suffix) => block.name.includes(suffix))) return "axe";
  if (
    block.material &&
    ["rock", "stone", "iron", "metal", "amethyst"].includes(block.material)
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
      "powder",
    ].includes(block.material)
  )
    return "shovel";
  if (
    leafNames.some((name) => block.name.includes(name)) ||
    block.name.includes("web") ||
    block.name.includes("wool") ||
    block.name.includes("sculk_vein")
  )
    return "shears";
  if (
    block.material &&
    ["plant", "leaves", "crop", "organic", "web"].includes(block.material) &&
    !block.name.includes("log") &&
    !block.name.includes("stem")
  ) {
    if (
      block.harvestTools &&
      Object.keys(block.harvestTools).some((id) =>
        mcData.items[parseInt(id, 10)]?.name.includes("hoe")
      )
    )
      return "hoe";
    return "shears";
  }
  return "any";
}

async function digBlockSafely(bot, blockToDig, task = null) {
  if (
    !blockToDig ||
    ["air", "cave_air", "void_air", "bedrock", "barrier"].includes(
      blockToDig.name
    )
  ) {
    throw new Error(
      `Khối mục tiêu không hợp lệ hoặc không thể phá hủy: ${blockToDig?.name}`
    );
  }
  const requiredToolType = task?.requiredToolType ?? "any";
  const defaultToolType = getDefaultToolForBlock(bot, blockToDig);
  let effectiveToolType =
    requiredToolType !== "any"
      ? requiredToolType
      : defaultToolType !== "any"
      ? defaultToolType
      : "any";
  if (
    effectiveToolType !== "sword" &&
    nonDiggingSwords.some((suffix) => effectiveToolType.endsWith(suffix))
  ) {
    effectiveToolType = "any";
  }

  if (effectiveToolType !== "any") {
    if (!(await equipBestTool(bot, effectiveToolType, true))) {
      if (isToolNeededForDrop(blockToDig)) {
        throw new Error(
          `Thiếu công cụ loại '${effectiveToolType}' cần thiết để đào ${blockToDig.name} hiệu quả.`
        );
      } else {
        console.warn(
          `[Đào An Toàn] Công cụ '${effectiveToolType}' được ưu tiên nhưng không có/lỗi. Dùng tay.`
        );
      }
    }
  } else {
    const currentTool = bot.heldItem;
    if (
      currentTool &&
      getDefaultToolForBlock(bot, blockToDig) !== "any" &&
      !isToolOfType(
        currentTool.name,
        getDefaultToolForBlock(bot, blockToDig)
      ) &&
      currentTool.name !== "shears"
    ) {
      try {
        await bot.unequip("hand");
        await bot.waitForTicks(1);
      } catch (e) {}
    }
  }

  if (!bot.canDigBlock(blockToDig)) {
    throw new Error(
      `Không thể đào khối ${blockToDig.name} bằng công cụ hiện tại (${
        bot.heldItem?.name ?? "tay"
      }) hoặc do thiếu quyền.`
    );
  }

  try {
    console.log(
      `[Đào An Toàn] Đào ${blockToDig.name} tại ${formatCoords(
        blockToDig.position
      )} bằng ${bot.heldItem?.name ?? "tay"}`
    );
    await bot.dig(blockToDig);
    return true;
  } catch (err) {
    console.error(
      `[Đào An Toàn] Lỗi trong bot.dig cho ${blockToDig.name}:`,
      err.message
    );
    const blockAfterError = bot.blockAt(blockToDig.position);
    if (!blockAfterError || blockAfterError.type !== blockToDig.type) {
      console.log("[Đào An Toàn] Khối đã biến mất trong quá trình đào lỗi.");
      return true;
    }
    throw err;
  }
}

async function tryPickupNearbyItems(bot, centerPos, radius) {
  if (!centerPos) return;
  console.debug(
    `[Nhặt Đồ] Thử di chuyển quanh ${formatCoords(centerPos)} để nhặt đồ.`
  );
  const offsets = [
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1),
    new Vec3(1, 0, 1),
    new Vec3(1, 0, -1),
    new Vec3(-1, 0, 1),
    new Vec3(-1, 0, -1),
  ];

  let moved = false;
  for (const offset of offsets) {
    const goalPos = centerPos.plus(offset.scaled(radius * 0.7));
    const goal = new GoalNear(goalPos.x, goalPos.y, goalPos.z, 0.5);
    try {
      bot.pathfinder.setGoal(goal, true);
      await bot.waitForTicks(5);
      if (bot.pathfinder.isMoving()) {
        await new Promise((resolve) =>
          setTimeout(resolve, PICKUP_MOVEMENT_TIMEOUT)
        );
        bot.pathfinder.stop();
        moved = true;
      }
      bot.pathfinder.setGoal(null);
      await bot.waitForTicks(2);
    } catch (err) {
      console.debug(
        `[Nhặt Đồ] Lỗi nhỏ khi di chuyển tới ${formatCoords(goalPos)}: ${
          err.message
        }`
      );
      bot.pathfinder.setGoal(null);
    }
  }
  if (moved) console.debug(`[Nhặt Đồ] Đã di chuyển quanh để nhặt đồ.`);
  else console.debug(`[Nhặt Đồ] Không thể di chuyển hoặc không cần thiết.`);
}

async function handleTreeCollection(bot) {
  const task = bot.collectingTaskDetails;
  if (!bot.isCollecting || !task || task.collectionStrategy !== "tree") {
    if (bot.isCollecting)
      finishCollectingTask(bot, false, "Trạng thái nhiệm vụ cây không hợp lệ.");
    return;
  }
  const mcData = require("minecraft-data")(bot.version);
  const targetLogName = task.itemId;
  const countItemId = task.droppedItemId;
  const countItemName = task.droppedItemName;
  let lastMinedPos = null;

  try {
    const currentAmount = countItemManually(bot.inventory, countItemId);
    task.currentQuantity = currentAmount;
    if (currentAmount >= task.targetQuantity) {
      finishCollectingTask(bot, true, `Đã thu thập đủ ${task.itemNameVi}.`);
      return;
    }
    if (bot.inventory.emptySlotCount() === 0) {
      finishCollectingTask(
        bot,
        false,
        `Túi đồ đầy khi thu thập ${task.itemNameVi}.`
      );
      return;
    }
    if (task.consecutivePathErrors >= MAX_PATHFINDER_ERRORS) {
      console.error(
        `[Logic Cây] Đạt giới hạn lỗi pathfinder (${task.consecutivePathErrors}). Bỏ qua mục tiêu hiện tại.`
      );
      try {
        bot.chat("Quá nhiều lỗi di chuyển, tìm cây khác.");
      } catch (e) {}
      task.currentTreeBaseLog = null;
      task.currentTreeLog = null;
      task.status = "idle";
      task.consecutivePathErrors = 0;
      setTimeout(() => handleTreeCollection(bot), CHECK_INTERVAL * 2);
      return;
    }

    let needsNewTarget = false;
    if (!task.currentTreeLog) {
      needsNewTarget = true;
    } else {
      const currentLogBlockCheck = bot.blockAt(task.currentTreeLog.position);
      if (
        !currentLogBlockCheck ||
        currentLogBlockCheck.name !== targetLogName
      ) {
        needsNewTarget = true;
        lastMinedPos = task.lastLogPosition
          ? task.lastLogPosition.clone()
          : null;
        const lastPos = task.lastLogPosition;
        task.currentTreeLog = null;
        if (
          (task.status === "chopping" || task.status === "waiting_pickup") &&
          lastPos
        ) {
          const posAbove = lastPos.offset(0, 1, 0);
          const blockAbove = bot.blockAt(posAbove);
          if (blockAbove && blockAbove.name === targetLogName) {
            task.currentTreeLog = blockAbove;
            task.status = "approaching_log";
            needsNewTarget = false;
            task.consecutivePathErrors = 0;
          } else {
            task.currentTreeBaseLog = null;
          }
        } else if (task.status !== "idle" && task.status !== "moving_to_tree") {
          task.currentTreeBaseLog = null;
        }
      }
    }

    if (needsNewTarget) {
      if (
        lastMinedPos &&
        (task.status === "waiting_pickup" || task.status === "idle")
      ) {
        await tryPickupNearbyItems(bot, lastMinedPos, PICKUP_MOVEMENT_RADIUS);
        lastMinedPos = null;
        const amountAfterPickupAttempt = countItemManually(
          bot.inventory,
          countItemId
        );
        task.currentQuantity = amountAfterPickupAttempt;
        if (amountAfterPickupAttempt >= task.targetQuantity) {
          finishCollectingTask(
            bot,
            true,
            `Đã thu thập đủ ${task.itemNameVi} (sau khi nhặt thêm).`
          );
          return;
        }
        if (bot.inventory.emptySlotCount() === 0) {
          finishCollectingTask(
            bot,
            false,
            `Túi đồ đầy khi thu thập ${task.itemNameVi} (sau khi nhặt thêm).`
          );
          return;
        }
      }

      task.status = "idle";
      task.currentTreeLog = null;
      let nextLogTarget = findNearbyBlock(bot, task) || findFarBlock(bot, task);
      if (nextLogTarget) {
        const botY = bot.entity.position.y;
        if (nextLogTarget.position.y > botY + MAX_VERTICAL_REACH - 0.5) {
          console.warn(
            `[Logic Cây] Tìm thấy mục tiêu ${formatCoords(
              nextLogTarget.position
            )} nhưng quá cao. Tìm cây khác.`
          );
          setTimeout(() => handleTreeCollection(bot), CHECK_INTERVAL);
          return;
        }
        const treeBase = findTreeBase(bot, nextLogTarget);
        if (treeBase && treeBase.name === targetLogName) {
          task.currentTreeBaseLog = treeBase;
          task.currentTreeLog = treeBase;
          task.status = "moving_to_tree";
        } else if (nextLogTarget) {
          task.currentTreeLog = nextLogTarget;
          task.currentTreeBaseLog = null;
          task.status = "approaching_log";
        }
        task.consecutivePathErrors = 0;
      } else {
        finishCollectingTask(
          bot,
          false,
          `Không tìm thấy thêm ${task.itemNameVi} nào.`
          
        );
        bot.chat('Không tìm thấy ');
        return;
      }
      setTimeout(() => handleTreeCollection(bot), SHORT_CHECK_INTERVAL);
      return;
    }

    const currentLogBlock = task.currentTreeLog;
    if (!currentLogBlock) {
      task.status = "idle";
      setTimeout(() => handleTreeCollection(bot), CHECK_INTERVAL);
      return;
    }
    const currentLogPos = currentLogBlock.position;
    const botPos = bot.entity.position;
    const distToLogCenter = botPos.distanceTo(
      currentLogPos.offset(0.5, 0.5, 0.5)
    );
    const canReachLog = distToLogCenter <= REACH_BLOCK_DIST + 0.5;
    const isLogTooHigh = currentLogPos.y > botPos.y + MAX_VERTICAL_REACH - 0.5;

    switch (task.status) {
      case "finding_new":
        console.debug(`[Logic ...] Đang ở trạng thái tìm mục tiêu mới...`);
        // Không làm gì cả, chờ lần lặp sau khi tìm kiếm hoàn tất và trạng thái được cập nhật
        setTimeout(() => handleTreeCollection(bot), CHECK_INTERVAL); // Hoặc handleBlockCollection
        return;
      case "moving_to_tree":
        if (isLogTooHigh) {
          console.warn(
            `[Logic Cây] Gốc cây ${formatCoords(
              currentLogPos
            )} quá cao. Bỏ qua.`
          );
          try {
            bot.chat("Cây này bắt đầu quá cao, tìm cây khác.");
          } catch (e) {}
          task.currentTreeBaseLog = null;
          task.currentTreeLog = null;
          task.status = "idle";
          setTimeout(() => handleTreeCollection(bot), CHECK_INTERVAL);
          return;
        }
        const goalTreeBase = new GoalNear(
          currentLogPos.x,
          currentLogPos.y,
          currentLogPos.z,
          REACH_TREE_BASE_DIST
        );
        try {
          await bot.pathfinder.goto(goalTreeBase);
          task.status = "approaching_log";
          task.consecutivePathErrors = 0;
          setTimeout(
            () => handleTreeCollection(bot),
            VERY_SHORT_CHECK_INTERVAL
          );
        } catch (err) {
          // === THÊM KIỂM TRA VỊ TRÍ NGAY ĐÂY ===
          const goalPos = currentLogPos; // Lấy vị trí mục tiêu hiện tại
          const distNow = bot.entity.position.distanceTo(goalPos.offset(0.5, 0.5, 0.5));
          const targetReach = REACH_TREE_BASE_DIST + 1; // Khoảng cách chấp nhận được khi đến gốc
      
          if (distNow <= targetReach) {
               console.warn(`[Logic Cây] Lỗi pathfinder (${err.message}) nhưng bot ĐÃ ĐỦ GẦN ${formatCoords(goalPos)}. Coi như đến nơi.`);
               task.status = 'approaching_log'; // Chuyển trạng thái tiếp theo (hoặc reached_log)
               task.consecutivePathErrors = 0; // Reset lỗi vì đã đến
               setTimeout(() => handleTreeCollection(bot), VERY_SHORT_CHECK_INTERVAL);
               return; // <<< Quan trọng: Thoát khỏi xử lý lỗi thông thường
          }
          // === KẾT THÚC KIỂM TRA VỊ TRÍ ===
      
          // Nếu không đủ gần, mới xử lý lỗi như cũ:
          console.error(`[Logic Cây] Lỗi pathfinder đến gốc cây: ${err.message}. Bot chưa đủ gần (${distNow.toFixed(2)} > ${targetReach}). Lần thử ${task.consecutivePathErrors + 1}`);
          task.consecutivePathErrors++;
          await attemptRecovery(bot); // Thử phục hồi nếu có
          setTimeout(() => handleTreeCollection(bot), CHECK_INTERVAL * (task.consecutivePathErrors + 1));
      }
      return;

      case "approaching_log":
        if (isLogTooHigh) {
          console.warn(
            `[Logic Cây] Khúc gỗ mục tiêu ${formatCoords(
              currentLogPos
            )} quá cao. Bỏ qua cây.`
          );
          try {
            bot.chat("Khúc gỗ này quá cao, bỏ qua cây.");
          } catch (e) {}
          task.currentTreeBaseLog = null;
          task.currentTreeLog = null;
          task.status = "idle";
          setTimeout(() => handleTreeCollection(bot), CHECK_INTERVAL);
          return;
        }
        if (canReachLog) {
          task.status = 'reached_log'; task.consecutivePathErrors = 0;
          setTimeout(() => handleTreeCollection(bot), VERY_SHORT_CHECK_INTERVAL); return;
        } else {
          await clearObstructingLeaves(bot, currentLogPos);
          const goalLogApprox = new GoalNear(currentLogPos.x, currentLogPos.y, currentLogPos.z, APPROACH_GOAL_RADIUS);
          try {
            await bot.pathfinder.goto(goalLogApprox);
            // Kiểm tra lại khoảng cách sau goto thành công (logic này vẫn giữ)
            if (bot.entity.position.distanceTo(currentLogPos.offset(0.5, 0.5, 0.5)) <= REACH_BLOCK_DIST + 0.5) {
              task.status = 'reached_log'; task.consecutivePathErrors = 0;
            } else {
              console.warn(`[Logic Cây] Vẫn không đủ gần sau pathfinder (${bot.entity.position.distanceTo(currentLogPos.offset(0.5,0.5,0.5)).toFixed(2)} > ${REACH_BLOCK_DIST}). Lần thử ${task.consecutivePathErrors + 1}`);
              task.consecutivePathErrors++;
            }
            setTimeout(() => handleTreeCollection(bot), VERY_SHORT_CHECK_INTERVAL);

          } catch (err) { // <<< SỬA KHỐI CATCH NÀY
              // === THÊM KIỂM TRA VỊ TRÍ NGAY ĐÂY ===
              const goalPos = currentLogPos; // Vẫn là khúc gỗ hiện tại
              const distNow = bot.entity.position.distanceTo(goalPos.offset(0.5, 0.5, 0.5));
              // Ngưỡng để coi là đã đến khi đang tiếp cận khúc gỗ
              const targetReach = REACH_BLOCK_DIST + 0.5; // Dùng ngưỡng REACH_BLOCK_DIST

              if (distNow <= targetReach) {
                   console.warn(`[Logic Cây Approaching] Lỗi pathfinder (${err.message}) nhưng bot ĐÃ ĐỦ GẦN ${formatCoords(goalPos)}. Coi như đến nơi.`);
                   task.status = 'reached_log'; // Chuyển sang trạng thái đã đến
                   task.consecutivePathErrors = 0; // Reset lỗi vì đã đến
                   setTimeout(() => handleTreeCollection(bot), VERY_SHORT_CHECK_INTERVAL);
                   return; // Thoát khỏi xử lý lỗi thông thường
              }
              // === KẾT THÚC KIỂM TRA VỊ TRÍ ===

              // Nếu không đủ gần, mới xử lý lỗi như cũ:
              console.error(`[Logic Cây] Lỗi pathfinder tiếp cận khúc gỗ ${formatCoords(currentLogPos)}: ${err.message}. Bot chưa đủ gần (${distNow.toFixed(2)} > ${targetReach}). Lần thử ${task.consecutivePathErrors + 1}`);
              task.consecutivePathErrors++;
              await attemptRecovery(bot); // Thử phục hồi
              setTimeout(() => handleTreeCollection(bot), CHECK_INTERVAL * (task.consecutivePathErrors + 1)); // Tăng thời gian chờ
          }
          return; // Kết thúc case approaching_log
        }

      case "reached_log":
        if (distToLogCenter > REACH_BLOCK_DIST + 1) {
          console.warn(
            `[Logic Cây] Mất tầm với quá xa (${distToLogCenter.toFixed(
              2
            )}). Tiếp cận lại.`
          );
          task.status = "approaching_log";
          setTimeout(() => handleTreeCollection(bot), SHORT_CHECK_INTERVAL);
          return;
        }
        if (isLogTooHigh) {
          console.warn(
            `[Logic Cây] Khúc gỗ ${formatCoords(
              currentLogPos
            )} trở nên quá cao? Bỏ qua cây.`
          );
          try {
            bot.chat("Khúc gỗ có vẻ quá cao, bỏ qua cây.");
          } catch (e) {}
          task.currentTreeBaseLog = null;
          task.currentTreeLog = null;
          task.status = "idle";
          setTimeout(() => handleTreeCollection(bot), CHECK_INTERVAL);
          return;
        }

        await clearObstructingLeaves(bot, currentLogPos);
        const blockToChop = bot.blockAt(currentLogPos);
        if (!blockToChop || blockToChop.name !== targetLogName) {
          console.warn(
            `[Logic Cây] Khúc gỗ biến mất sau khi dọn lá. Tìm khúc tiếp theo.`
          );
          task.currentTreeLog = null;
          task.status = "idle";
          setTimeout(() => handleTreeCollection(bot), SHORT_CHECK_INTERVAL);
          return;
        }
        if (
          bot.entity.position.distanceTo(currentLogPos.offset(0.5, 0.5, 0.5)) >
          REACH_BLOCK_DIST + 0.5
        ) {
          console.warn(
            `[Logic Cây] Mất tầm với sau khi dọn lá (${bot.entity.position
              .distanceTo(currentLogPos.offset(0.5, 0.5, 0.5))
              .toFixed(2)} > ${REACH_BLOCK_DIST}). Tiếp cận lại.`
          );
          task.status = "approaching_log";
          setTimeout(() => handleTreeCollection(bot), SHORT_CHECK_INTERVAL);
          return;
        }

        task.status = "chopping";
        task.lastLogPosition = currentLogPos.clone();
        try {
          const amountBeforeDig = countItemManually(bot.inventory, countItemId);
          await digBlockSafely(bot, blockToChop, task);
          task.status = "waiting_pickup";
          task.pickupAttempts = 0;
          task.amountBeforePickup = amountBeforeDig;
          setTimeout(
            () => handleTreeCollection(bot),
            ITEM_PICKUP_WAIT_TICKS * 50
          );
          return;
        } catch (digError) {
          console.error(
            `[Logic Cây] Lỗi khi chặt khúc gỗ ${formatCoords(currentLogPos)}: ${
              digError.message
            }`
          );

          // Xử lý lỗi thiếu công cụ trước
          if (digError.message.toLowerCase().includes("thiếu công cụ")) {
            finishCollectingTask(
              bot,
              false,
              `Không thể chặt ${task.itemNameVi}: ${digError.message}`
            );
            return; // Dừng hẳn nếu thiếu công cụ
          }

          // === THÊM LOGIC BLACKLIST ===
          const blockPosStr = `${currentLogPos.x},${currentLogPos.y},${currentLogPos.z}`;
          // Chỉ blacklist nếu lỗi là 'Digging aborted' hoặc lỗi không xác định (không phải thiếu tool)
          if (
            digError.message.includes("Digging aborted") ||
            !digError.message.toLowerCase().includes("thiếu công cụ")
          ) {
            task.temporaryBlacklist[blockPosStr] = Date.now() + 30000; // Blacklist trong 30 giây
            console.warn(
              `[Logic Cây] Đã thêm ${formatCoords(
                currentLogPos
              )} vào blacklist tạm thời do lỗi đào.`
            );

            // Cập nhật bộ đếm lỗi liên tục trên CÙNG block
            if (task.lastFailedDigPos === blockPosStr) {
              task.consecutiveDigErrors++;
            } else {
              task.consecutiveDigErrors = 1; // Lỗi đầu tiên trên block này
            }
            task.lastFailedDigPos = blockPosStr; // Lưu lại vị trí lỗi

            // Nếu đào lỗi cùng 1 block quá nhiều lần -> có thể dừng hẳn hoặc báo động
            if (task.consecutiveDigErrors >= 3) {
              console.error(
                `[Logic Cây] Đào lỗi khối ${formatCoords(currentLogPos)} ${
                  task.consecutiveDigErrors
                } lần liên tiếp. Có thể có vấn đề nghiêm trọng.`
              );
              // Tùy chọn: Có thể finishCollectingTask ở đây nếu muốn
              // finishCollectingTask(bot, false, `Liên tục lỗi đào tại ${formatCoords(currentLogPos)}`); return;
            }
          }
          // === KẾT THÚC LOGIC BLACKLIST ===

          try {
            bot.chat(
              `Lỗi khi chặt ${task.itemNameVi} (${digError.message}). Tìm khúc khác.`
            );
          } catch (e) {}
          // Đặt lại mục tiêu và chuyển sang tìm mới NGAY LẬP TỨC
          task.currentTreeLog = null;
          task.status = "finding_new"; // Chuyển sang trạng thái tìm mới
          setTimeout(() => handleTreeCollection(bot), SHORT_CHECK_INTERVAL); // Gọi lại sớm để tìm
          return; // Kết thúc xử lý lỗi cho tick này
        }

      case "chopping":
        console.warn(
          "[Logic Cây] Bị kẹt ở trạng thái 'chopping'? Đặt lại thành 'reached_log'."
        );
        task.status = "reached_log";
        setTimeout(() => handleTreeCollection(bot), SHORT_CHECK_INTERVAL);
        return;

      case "waiting_pickup":
        task.pickupAttempts++;
        const amountAfterWait = countItemManually(bot.inventory, countItemId); // Thống nhất tên biến
        if (amountAfterWait > task.amountBeforePickup) {
          const pickedUpCount = amountAfterWait - task.amountBeforePickup;
          task.currentQuantity = amountAfterWait;
          try {
            bot.chat(
              `+${pickedUpCount} ${task.itemNameVi}. (${amountAfterWait}/${task.targetQuantity})`
            );
          } catch (e) {}
          lastMinedPos = task.lastLogPosition
            ? task.lastLogPosition.clone()
            : null;
          task.currentTreeLog = null;
          task.currentTarget = null;
          task.status = "idle";
          setTimeout(
            () => handleTreeCollection(bot),
            VERY_SHORT_CHECK_INTERVAL
          );
          return; // Gọi lại handleTreeCollection
        } else if (task.pickupAttempts >= ITEM_PICKUP_MAX_ATTEMPTS) {
          console.warn(
            `[Logic Cây] Không phát hiện nhặt ${countItemName} trực tiếp sau ${task.pickupAttempts} lần thử.`
          );
          const finalAmountCheck = countItemManually(
            bot.inventory,
            countItemId
          ); // Thống nhất tên biến
          if (finalAmountCheck > task.amountBeforePickup) {
            const pickedUpCount = finalAmountCheck - task.amountBeforePickup;
            console.warn(
              `[Logic Cây] -> Tuy nhiên, số lượng đã tăng lên ${finalAmountCheck}. Có thể nhặt được ${pickedUpCount}.`
            );
            task.currentQuantity = finalAmountCheck;
            try {
              bot.chat(
                `+${pickedUpCount} ${task.itemNameVi}. (${finalAmountCheck}/${task.targetQuantity})`
              );
            } catch (e) {} // Thêm chat ở đây
          } else {
            console.warn(
              `[Logic Cây] -> Số lượng (${finalAmountCheck}) vẫn chưa tăng so với trước khi đào (${task.amountBeforePickup}). Bỏ qua nhặt.`
            );
            task.currentQuantity = finalAmountCheck;
          }
          lastMinedPos = task.lastLogPosition
            ? task.lastLogPosition.clone()
            : null;
          task.currentTreeLog = null;
          task.currentTarget = null;
          task.status = "idle";
          setTimeout(() => handleTreeCollection(bot), SHORT_CHECK_INTERVAL);
          return; // Gọi lại handleTreeCollection
        } else {
          setTimeout(
            () => handleTreeCollection(bot),
            ITEM_PICKUP_WAIT_TICKS * 50
          );
          return; // Gọi lại handleTreeCollection
        }

      case "idle":
        setTimeout(() => handleTreeCollection(bot), SHORT_CHECK_INTERVAL);
        return;

      default:
        console.error(
          `[Logic Cây] Trạng thái không xác định: ${task.status}. Đặt lại.`
        );
        task.status = "idle";
        setTimeout(() => handleTreeCollection(bot), CHECK_INTERVAL);
        return;
    }
  } catch (error) {
    console.error("[Logic Cây] Lỗi nghiêm trọng không xử lý được:", error);
    finishCollectingTask(
      bot,
      false,
      `Lỗi hệ thống khi thu thập ${task.itemNameVi}: ${error.message}`
    );
  }
}

async function handleBlockCollection(bot) {
  const task = bot.collectingTaskDetails;
  if (!bot.isCollecting || !task || task.collectionStrategy !== "block") {
    if (bot.isCollecting)
      finishCollectingTask(
        bot,
        false,
        "Trạng thái nhiệm vụ khối không hợp lệ."
      );
    return;
  }
  const mcData = require("minecraft-data")(bot.version);
  const countItemId = task.droppedItemId;
  const countItemName = task.droppedItemName;
  const targetBlockId = task.itemType.id;
  let lastMinedPos = null;

  try {
    const currentAmount = countItemManually(bot.inventory, countItemId);
    task.currentQuantity = currentAmount;
    if (currentAmount >= task.targetQuantity) {
      finishCollectingTask(bot, true, `Đã thu thập đủ ${task.itemNameVi}.`);
      return;
    }
    if (bot.inventory.emptySlotCount() === 0) {
      finishCollectingTask(
        bot,
        false,
        `Túi đồ đầy khi thu thập ${task.itemNameVi}.`
      );
      return;
    }
    if (task.consecutivePathErrors >= MAX_PATHFINDER_ERRORS) {
      console.error(
        `[Logic Khối] Đạt giới hạn lỗi pathfinder (${task.consecutivePathErrors}). Bỏ qua mục tiêu hiện tại.`
      );
      try {
        bot.chat("Quá nhiều lỗi di chuyển, tìm khối khác.");
      } catch (e) {}
      task.currentTarget = null;
      task.status = "idle";
      task.consecutivePathErrors = 0;
      setTimeout(() => handleBlockCollection(bot), CHECK_INTERVAL * 2);
      return;
    }

    let needsNewTarget = false;
    if (!task.currentTarget) {
      needsNewTarget = true;
    } else {
      const currentBlockCheck = bot.blockAt(task.currentTarget.position);
      if (!currentBlockCheck || currentBlockCheck.type !== targetBlockId) {
        needsNewTarget = true;
        lastMinedPos = task.currentTarget
          ? task.currentTarget.position.clone()
          : null;
        task.currentTarget = null;
      }
    }

    if (needsNewTarget) {
      if (
        lastMinedPos &&
        (task.status === "waiting_pickup" || task.status === "idle")
      ) {
        await tryPickupNearbyItems(bot, lastMinedPos, PICKUP_MOVEMENT_RADIUS);
        lastMinedPos = null;
        const amountAfterPickupAttempt = countItemManually(
          bot.inventory,
          countItemId
        );
        task.currentQuantity = amountAfterPickupAttempt;
        if (amountAfterPickupAttempt >= task.targetQuantity) {
          finishCollectingTask(
            bot,
            true,
            `Đã thu thập đủ ${task.itemNameVi} (sau khi nhặt thêm).`
          );
          return;
        }
        if (bot.inventory.emptySlotCount() === 0) {
          finishCollectingTask(
            bot,
            false,
            `Túi đồ đầy khi thu thập ${task.itemNameVi} (sau khi nhặt thêm).`
          );
          return;
        }
      }

      task.status = "idle";
      task.currentTarget = null;
      let nextTarget = findNearbyBlock(bot, task) || findFarBlock(bot, task);
      if (nextTarget) {
        const botY = bot.entity.position.y;
        if (nextTarget.position.y > botY + MAX_VERTICAL_REACH - 0.5) {
          console.warn(
            `[Logic Khối] Tìm thấy mục tiêu ${formatCoords(
              nextTarget.position
            )} nhưng quá cao. Tìm khối khác.`
          );
          setTimeout(() => handleBlockCollection(bot), CHECK_INTERVAL);
          return;
        }
        task.currentTarget = nextTarget;
        const distToNewTarget = bot.entity.position.distanceTo(
          nextTarget.position.offset(0.5, 0.5, 0.5)
        );
        if (distToNewTarget <= REACH_BLOCK_DIST + 0.5) {
          task.status = "reached_target";
        } else {
          task.status = "moving";
        }
        task.consecutivePathErrors = 0;
      } else {
        finishCollectingTask(
          bot,
          false,
          `Không tìm thấy thêm ${task.itemNameVi} nào.`
        );
           bot.chat('Không tìm thấy ');
        return;
      }
      setTimeout(() => handleBlockCollection(bot), VERY_SHORT_CHECK_INTERVAL);
      return;
    }

    const targetBlock = task.currentTarget;
    const targetPosition = targetBlock.position;
    const botPos = bot.entity.position;
    const distToBlockCenter = botPos.distanceTo(
      targetPosition.offset(0.5, 0.5, 0.5)
    );
    const canReachBlock = distToBlockCenter <= REACH_BLOCK_DIST + 0.5;
    const isBlockTooHigh =
      targetPosition.y > botPos.y + MAX_VERTICAL_REACH - 0.5;

    switch (task.status) {
      case "finding_new":
        console.debug(`[Logic ...] Đang ở trạng thái tìm mục tiêu mới...`);
        // Không làm gì cả, chờ lần lặp sau khi tìm kiếm hoàn tất và trạng thái được cập nhật
        setTimeout(() => handleTreeCollection(bot), CHECK_INTERVAL); // Hoặc handleBlockCollection
        return;
      case "moving":
        if (canReachBlock) {
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
            `[Logic Khối] Mục tiêu ${formatCoords(
              targetPosition
            )} quá cao. Bỏ qua.`
          );
          try {
            bot.chat("Khối này quá cao, tìm khối khác.");
          } catch (e) {}
          task.currentTarget = null;
          task.status = "idle";
          setTimeout(() => handleBlockCollection(bot), CHECK_INTERVAL);
          return;
        }

        const goalApprox = new GoalNear(targetPosition.x, targetPosition.y, targetPosition.z, APPROACH_GOAL_RADIUS);
        try {
          await bot.pathfinder.goto(goalApprox);
          // Kiểm tra lại khoảng cách sau goto thành công (logic này vẫn giữ)
          if (bot.entity.position.distanceTo(targetPosition.offset(0.5, 0.5, 0.5)) <= REACH_BLOCK_DIST + 0.5) {
            task.status = "reached_target"; task.consecutivePathErrors = 0;
          } else {
            console.warn(`[Logic Khối] Vẫn không đủ gần sau pathfinder (${bot.entity.position.distanceTo(targetPosition.offset(0.5,0.5,0.5)).toFixed(2)} > ${REACH_BLOCK_DIST}). Lần thử ${task.consecutivePathErrors + 1}`);
            task.consecutivePathErrors++;
          }
          setTimeout(() => handleBlockCollection(bot), VERY_SHORT_CHECK_INTERVAL);

        } catch (err) { // <<< SỬA KHỐI CATCH NÀY
            // === THÊM KIỂM TRA VỊ TRÍ NGAY ĐÂY ===
            const goalPos = targetPosition; // Mục tiêu là khối targetPosition
            const distNow = bot.entity.position.distanceTo(goalPos.offset(0.5, 0.5, 0.5));
            // Ngưỡng để coi là đã đến khi đang di chuyển đến khối
            const targetReach = REACH_BLOCK_DIST + 0.5; // Dùng ngưỡng REACH_BLOCK_DIST

            if (distNow <= targetReach) {
                 console.warn(`[Logic Khối Moving] Lỗi pathfinder (${err.message}) nhưng bot ĐÃ ĐỦ GẦN ${formatCoords(goalPos)}. Coi như đến nơi.`);
                 task.status = 'reached_target'; // Chuyển sang trạng thái đã đến
                 task.consecutivePathErrors = 0; // Reset lỗi vì đã đến
                 setTimeout(() => handleBlockCollection(bot), VERY_SHORT_CHECK_INTERVAL);
                 return; // Thoát khỏi xử lý lỗi thông thường
            }
            // === KẾT THÚC KIỂM TRA VỊ TRÍ ===

            // Nếu không đủ gần, mới xử lý lỗi như cũ:
            console.error(`[Logic Khối] Lỗi pathfinder đến ${formatCoords(targetPosition)}: ${err.message}. Bot chưa đủ gần (${distNow.toFixed(2)} > ${targetReach}). Lần thử ${task.consecutivePathErrors + 1}`);
            task.consecutivePathErrors++;
            await attemptRecovery(bot); // Thử phục hồi
            setTimeout(() => handleBlockCollection(bot), CHECK_INTERVAL * (task.consecutivePathErrors + 1)); // Tăng thời gian chờ
        }
        return; // Kết thúc case moving

      case "reached_target":
        if (distToBlockCenter > REACH_BLOCK_DIST + 1) {
          console.warn(
            `[Logic Khối] Mất tầm với quá xa (${distToBlockCenter.toFixed(
              2
            )}). Di chuyển lại.`
          );
          task.status = "moving";
          setTimeout(() => handleBlockCollection(bot), SHORT_CHECK_INTERVAL);
          return;
        }
        if (isBlockTooHigh) {
          console.warn(
            `[Logic Khối] Mục tiêu ${formatCoords(
              targetPosition
            )} trở nên quá cao? Bỏ qua.`
          );
          try {
            bot.chat("Khối có vẻ quá cao, bỏ qua.");
          } catch (e) {}
          task.currentTarget = null;
          task.status = "idle";
          setTimeout(() => handleBlockCollection(bot), CHECK_INTERVAL);
          return;
        }

        const blockAbove = bot.blockAt(targetPosition.offset(0, 1, 0));
        const fallingTypes = mcData.blocksArray
          .filter((b) => b.tags?.includes(mcData.tagsByName.falling_block))
          .map((b) => b.name);
        if (blockAbove && fallingTypes.includes(blockAbove.name)) {
          console.log(
            `[Logic Khối] Phát hiện khối rơi (${blockAbove.name}) phía trên. Dọn trước.`
          );
          try {
            if (
              botPos.distanceTo(blockAbove.position.offset(0.5, 0.5, 0.5)) <=
              REACH_BLOCK_DIST + 1
            ) {
              await digBlockSafely(bot, blockAbove, null);
              await bot.waitForTicks(10);
              setTimeout(
                () => handleBlockCollection(bot),
                SHORT_CHECK_INTERVAL
              );
              return;
            } else {
              console.warn(
                "[Logic Khối] Không với tới khối rơi phía trên. Bỏ qua mục tiêu."
              );
              task.currentTarget = null;
              task.status = "idle";
              setTimeout(() => handleBlockCollection(bot), CHECK_INTERVAL);
              return;
            }
          } catch (digAboveError) {
            console.error(
              `[Logic Khối] Lỗi đào khối rơi phía trên: ${digAboveError.message}. Bỏ qua mục tiêu.`
            );
            task.currentTarget = null;
            task.status = "idle";
            setTimeout(() => handleBlockCollection(bot), CHECK_INTERVAL);
            return;
          }
        }

        const blockToDig = bot.blockAt(targetPosition);
        if (!blockToDig || blockToDig.type !== targetBlockId) {
          console.warn(
            `[Logic Khối] Khối mục tiêu ${formatCoords(
              targetPosition
            )} đã thay đổi/biến mất. Tìm khối khác.`
          );
          task.currentTarget = null;
          task.status = "idle";
          setTimeout(() => handleBlockCollection(bot), SHORT_CHECK_INTERVAL);
          return;
        }
        if (
          botPos.distanceTo(targetPosition.offset(0.5, 0.5, 0.5)) >
          REACH_BLOCK_DIST + 0.5
        ) {
          console.warn(
            `[Logic Khối] Mất tầm với sau khi kiểm tra khối rơi (${botPos
              .distanceTo(targetPosition.offset(0.5, 0.5, 0.5))
              .toFixed(2)}). Di chuyển lại.`
          );
          task.status = "moving";
          setTimeout(() => handleBlockCollection(bot), SHORT_CHECK_INTERVAL);
          return;
        }

        task.status = "collecting";
        try {
          const amountBeforeDig = countItemManually(bot.inventory, countItemId);
          await digBlockSafely(bot, blockToDig, task);
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
            `[Logic Khối] Lỗi đào khối ${formatCoords(targetPosition)}: ${
              digError.message
            }`
          );

          // Xử lý lỗi thiếu công cụ / không thể đào trước
          if (
            digError.message.toLowerCase().includes("thiếu công cụ") ||
            digError.message.toLowerCase().includes("không thể đào")
          ) {
            finishCollectingTask(
              bot,
              false,
              `Không thể đào ${task.itemNameVi}: ${digError.message}`
            );
            return; // Dừng hẳn
          }

          // === THÊM LOGIC BLACKLIST ===
          const blockPosStr = `${targetPosition.x},${targetPosition.y},${targetPosition.z}`;
          // Chỉ blacklist nếu lỗi có thể phục hồi (không phải thiếu tool)
          if (
            digError.message.includes("Digging aborted") ||
            !(
              digError.message.toLowerCase().includes("thiếu công cụ") ||
              digError.message.toLowerCase().includes("không thể đào")
            )
          ) {
            task.temporaryBlacklist[blockPosStr] = Date.now() + 30000; // Blacklist 30 giây
            console.warn(
              `[Logic Khối] Đã thêm ${formatCoords(
                targetPosition
              )} vào blacklist tạm thời do lỗi đào.`
            );

            if (task.lastFailedDigPos === blockPosStr) {
              task.consecutiveDigErrors++;
            } else {
              task.consecutiveDigErrors = 1;
            }
            task.lastFailedDigPos = blockPosStr;

            if (task.consecutiveDigErrors >= 3) {
              console.error(
                `[Logic Khối] Đào lỗi khối ${formatCoords(targetPosition)} ${
                  task.consecutiveDigErrors
                } lần liên tiếp.`
              );
              // Tùy chọn: finishCollectingTask(bot, false, `Liên tục lỗi đào tại ${formatCoords(targetPosition)}`); return;
            }
          }
          // === KẾT THÚC LOGIC BLACKLIST ===

          try {
            bot.chat(
              `Lỗi đào ${task.itemNameVi} (${digError.message}). Tìm khối khác.`
            );
          } catch (e) {}
          // Đặt lại mục tiêu và tìm mới ngay
          task.currentTarget = null;
          task.status = "finding_new"; // Chuyển sang tìm mới
          setTimeout(() => handleBlockCollection(bot), SHORT_CHECK_INTERVAL); // Gọi lại sớm
          return; // Kết thúc xử lý lỗi
        }

      case "collecting":
        console.warn(
          "[Logic Khối] Bị kẹt ở trạng thái 'collecting'? Đặt lại thành 'reached_target'."
        );
        task.status = "reached_target";
        setTimeout(() => handleBlockCollection(bot), SHORT_CHECK_INTERVAL);
        return;

      case "waiting_pickup":
        task.pickupAttempts++;
        const amountAfterWait = countItemManually(bot.inventory, countItemId); // Thống nhất tên biến
        if (amountAfterWait > task.amountBeforePickup) {
          const pickedUpCount = amountAfterWait - task.amountBeforePickup;
          task.currentQuantity = amountAfterWait;
          try {
            bot.chat(
              `+${pickedUpCount} ${task.itemNameVi}. (${amountAfterWait}/${task.targetQuantity})`
            );
          } catch (e) {}
          lastMinedPos = task.currentTarget
            ? task.currentTarget.position.clone()
            : null;
          task.currentTreeLog = null;
          task.currentTarget = null;
          task.status = "idle";
          setTimeout(
            () => handleBlockCollection(bot),
            VERY_SHORT_CHECK_INTERVAL
          );
          return; // Gọi lại handleBlockCollection
        } else if (task.pickupAttempts >= ITEM_PICKUP_MAX_ATTEMPTS) {
          console.warn(
            `[Logic Khối] Không phát hiện nhặt ${countItemName} trực tiếp sau ${task.pickupAttempts} lần thử.`
          );
          const finalAmountCheck = countItemManually(
            bot.inventory,
            countItemId
          ); // Thống nhất tên biến
          if (finalAmountCheck > task.amountBeforePickup) {
            const pickedUpCount = finalAmountCheck - task.amountBeforePickup;
            console.warn(
              `[Logic Khối] -> Tuy nhiên, số lượng đã tăng lên ${finalAmountCheck}. Có thể nhặt được ${pickedUpCount}.`
            );
            task.currentQuantity = finalAmountCheck;
            try {
              bot.chat(
                `+${pickedUpCount} ${task.itemNameVi}. (${finalAmountCheck}/${task.targetQuantity})`
              );
            } catch (e) {} // Thêm chat ở đây
          } else {
            console.warn(
              `[Logic Khối] -> Số lượng (${finalAmountCheck}) vẫn chưa tăng so với trước khi đào (${task.amountBeforePickup}). Bỏ qua nhặt.`
            );
            task.currentQuantity = finalAmountCheck;
          }
          lastMinedPos = task.currentTarget
            ? task.currentTarget.position.clone()
            : null;
          task.currentTreeLog = null;
          task.currentTarget = null;
          task.status = "idle";
          setTimeout(() => handleBlockCollection(bot), SHORT_CHECK_INTERVAL);
          return; // Gọi lại handleBlockCollection
        } else {
          setTimeout(
            () => handleBlockCollection(bot),
            ITEM_PICKUP_WAIT_TICKS * 50
          );
          return; // Gọi lại handleBlockCollection
        }

      case "idle":
        setTimeout(() => handleBlockCollection(bot), SHORT_CHECK_INTERVAL);
        return;

      default:
        console.error(
          `[Logic Khối] Trạng thái không xác định: ${task.status}. Đặt lại.`
        );
        task.status = "idle";
        setTimeout(() => handleBlockCollection(bot), CHECK_INTERVAL);
        return;
    }
  } catch (error) {
    console.error("[Logic Khối] Lỗi nghiêm trọng không xử lý được:", error);
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
    console.error("[Vòng Lặp Thu Thập] Nhiệm vụ biến mất đột ngột. Dừng lại.");
    if (bot.isCollecting)
      finishCollectingTask(bot, false, "Lỗi nhiệm vụ: Nhiệm vụ biến mất.");
    return;
  }
  if (task.collectionStrategy === "tree") {
    handleTreeCollection(bot).catch((err) => {
      console.error("!!! Lỗi Cây Không Xử Lý Được trong Vòng Lặp:", err);
      finishCollectingTask(
        bot,
        false,
        "Lỗi hệ thống nghiêm trọng khi thu thập cây."
      );
    });
  } else if (task.collectionStrategy === "block") {
    handleBlockCollection(bot).catch((err) => {
      console.error("!!! Lỗi Khối Không Xử Lý Được trong Vòng Lặp:", err);
      finishCollectingTask(
        bot,
        false,
        "Lỗi hệ thống nghiêm trọng khi thu thập khối."
      );
    });
  } else {
    console.error(
      `[Vòng Lặp Thu Thập] Chiến lược không xác định: ${task.collectionStrategy}`
    );
    finishCollectingTask(
      bot,
      false,
      `Lỗi: Không biết chiến lược thu thập (${task.collectionStrategy}).`
    );
  }
}

function finishCollectingTask(bot, success, message) {
  if (!bot.isCollecting && !bot.collectingTaskDetails) return;
  const task = bot.collectingTaskDetails;
  const username = task?.username || "người chơi";
  const taskName = task?.itemNameVi || "vật phẩm";
  const finalAmount =
    countItemManually(bot.inventory, task?.droppedItemId ?? -1) ?? 0;
  const targetAmount = task?.targetQuantity ?? "?";
  const duration = task?.startTime
    ? ((Date.now() - task.startTime) / 1000).toFixed(1) + "s"
    : "?s";

  let finalMessage = message;
  if (success) {
    if (!message || message.startsWith("Đã thu thập đủ")) {
      finalMessage = `Đã thu thập xong ${finalAmount}/${targetAmount} ${taskName}. (${duration})`;
    } else {
      finalMessage = `Đã xong ${taskName}. (${duration}) ${message}. Có ${finalAmount}/${targetAmount}.`;
    }
  } else {
    finalMessage = `Đã dừng thu thập ${taskName}. (${duration}) Lý do: ${message}. Có ${finalAmount}/${targetAmount}.`;
  }
  console.log(
    `[Kết Thúc Thu Thập] Người yêu cầu: ${username}. Thành công: ${success}. Thông báo: ${finalMessage}`
  );
  if (finalMessage && (success || message === "Đã dừng theo yêu cầu")) {
    try {
      bot.chat(`${username}, ${finalMessage}`);
    } catch (e) {}
  }

  bot.isCollecting = false;
  bot.collectingTaskDetails = null;
  try {
    if (bot.pathfinder && typeof bot.pathfinder.stop === "function") {
      if (bot.pathfinder.isMoving()) {
        bot.pathfinder.stop();
      }
      bot.pathfinder.setGoal(null);
    }
  } catch (e) {
    console.error("[Kết Thúc Thu Thập] Lỗi dừng pathfinder:", e.message);
  }
}

function stopCollecting(bot, username) {
  if (bot.isCollecting && bot.collectingTaskDetails) {
    console.log(`[Dừng Thu Thập] Người dùng ${username} yêu cầu dừng.`);
    finishCollectingTask(bot, false, `Đã dừng theo yêu cầu`);
  } else {
    try {
      bot.chat(`${username}, tôi đâu có đang thu thập gì đâu.`);
    } catch (e) {}
  }
}

async function startCollectingTask(bot, username, message, aiModel) {
  console.log(`[Lệnh Thu Thập] Yêu cầu từ ${username}: "${message}"`);

  const busyStates = [
    { key: "isFinding", reason: "đang tìm đồ" },
    { key: "isFollowing", reason: "đang đi theo" },
    { key: "isProtecting", reason: "đang bảo vệ" },
    { key: "isCollecting", reason: "đang thu thập" },
    { key: "isStripMining", reason: "đang đào hầm" },
    { key: "isHunting", reason: "đang săn bắn" },
    { key: "isCleaningInventory", reason: "đang dọn túi đồ" },
    { key: "isDepositing", reason: "đang cất đồ" },
  ];
  for (const state of busyStates) {
    if (bot[state.key]) {
      try {
        bot.chat(`${username}, tôi đang bận ${state.reason} rồi.`);
      } catch (e) {}
      console.log(`[Lệnh Thu Thập] Bị chặn: Đang bận ${state.reason}.`);
      return;
    }
  }

  const extractionPrompt = `Trích xuất tên vật phẩm (giữ nguyên tiếng Việt nếu có) và số lượng từ tin nhắn người dùng: "${message}". Số lượng mặc định là 64 nếu không rõ. Chỉ trả lời bằng JSON: {"itemName": "...", "quantity": ...}. Ví dụ: "lấy 32 đá cuội" -> {"itemName": "đá cuội", "quantity": 32}. Nếu không rõ, trả về {"itemName": null, "quantity": 0}. JSON:`;
  let itemNameVi = null;
  let quantity = 64;
  let mcDataInstance;
  try {
    mcDataInstance = require("minecraft-data")(bot.version);
    const extractResult = await aiModel.generateContent(extractionPrompt);
    const jsonResponse = (await extractResult.response.text()).trim();
    let parsedData;
    try {
      const jsonMatch = jsonResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsedData = JSON.parse(jsonMatch[0]);
      else throw new Error("Không tìm thấy JSON trong phản hồi AI.");
    } catch (parseError) {
      console.error(
        "[Lệnh Thu Thập] Lỗi phân tích JSON từ AI:",
        parseError.message,
        "| Phản hồi:",
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
      } else {
        try {
          bot.chat(
            `Xin lỗi ${username}, tôi không hiểu rõ vật phẩm hoặc số lượng.`
          );
        } catch (e) {}
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
      try {
        bot.chat(`Xin lỗi ${username}, bạn muốn tôi thu thập vật phẩm nào?`);
      } catch (e) {}
      return;
    }
    if (isNaN(quantity) || quantity <= 0) {
      quantity = 64;
    }
    itemNameVi = itemNameVi.trim();
    quantity = Math.max(1, Math.min(quantity, 2304));
  } catch (error) {
    console.error("[Lệnh Thu Thập] Lỗi trong quá trình trích xuất AI:", error);
    try {
      bot.chat(
        `Xin lỗi ${username}, có lỗi khi tôi cố gắng hiểu yêu cầu của bạn.`
      );
    } catch (e) {}
    return;
  }

  let itemId;
  let targetItemInfo;
  let droppedItemInfo;
  let droppedItemId = null;
  let isBlock = false;
  try {
    itemId = translateToEnglishId(itemNameVi);
    if (!itemId) {
      try {
        bot.chat(
          `Xin lỗi ${username}, tôi không nhận ra vật phẩm "${itemNameVi}".`
        );
      } catch (e) {}
      return;
    }

    const blockInfo = mcDataInstance.blocksByName[itemId];
    if (blockInfo) {
      isBlock = true;
      targetItemInfo = blockInfo;
      if (targetItemInfo.drops && targetItemInfo.drops.length > 0) {
        droppedItemId = targetItemInfo.drops[0];
      } else {
        droppedItemId = mcDataInstance.itemsByName[itemId]?.id;
      }
      if (droppedItemId) {
        droppedItemInfo = mcDataInstance.items[droppedItemId];
      }
      if (!droppedItemInfo) {
        console.error(
          `[Lệnh Thu Thập] Không thể xác định vật phẩm rơi hợp lệ cho khối ${itemId}.`
        );
        try {
          bot.chat(`Tôi không biết ${itemNameVi} rơi ra cái gì.`);
        } catch (e) {}
        return;
      }
      console.log(
        `[Lệnh Thu Thập] Xác định mục tiêu là KHỐI: ${targetItemInfo.name}, Rơi ra: ${droppedItemInfo.name} (ID: ${droppedItemId})`
      );
    } else {
      isBlock = false;
      const itemInfo = mcDataInstance.itemsByName[itemId];
      if (itemInfo) {
        targetItemInfo = itemInfo;
        if (mcDataInstance.foods[itemInfo.id]) {
          if (typeof bot.startHuntingTask === "function") {
            console.log(
              `[Lệnh Thu Thập] Vật phẩm "${itemNameVi}" là thức ăn. Chuyển sang module săn bắn.`
            );
            try {
              bot.chat(`Việc săn ${itemNameVi} chưa được cài đặt.`);
            } catch (e) {}
          } else {
            try {
              bot.chat(
                `Xin lỗi ${username}, ${itemNameVi} là thức ăn, nhưng tôi chưa biết cách đi săn.`
              );
            } catch (e) {}
          }
          return;
        } else {
          try {
            bot.chat(
              `Xin lỗi ${username}, ${itemNameVi} là vật phẩm tôi không thể thu thập bằng cách phá khối.`
            );
          } catch (e) {}
          return;
        }
      } else {
        try {
          bot.chat(
            `Xin lỗi ${username}, không tìm thấy thông tin về "${itemNameVi}" (${itemId}).`
          );
        } catch (e) {}
        return;
      }
    }
  } catch (error) {
    console.error(
      "[Lệnh Thu Thập] Lỗi trong quá trình tra cứu/dịch vật phẩm:",
      error
    );
    try {
      bot.chat(`Xin lỗi ${username}, có lỗi khi tra cứu "${itemNameVi}".`);
    } catch (e) {}
    return;
  }

  if (!isBlock || !targetItemInfo || !droppedItemInfo) {
    console.error(
      "[Lệnh Thu Thập] LỖI LOGIC NGHIÊM TRỌNG: Đến phần xác định chiến lược với trạng thái không hợp lệ!"
    );
    try {
      bot.chat("Có lỗi nghiêm trọng bên trong khi xử lý yêu cầu của bạn.");
    } catch (e) {}
    return;
  }

  let collectionStrategy = "block";
  let requiredTool = "any";
  if (logSuffixes.some((suffix) => targetItemInfo.name.includes(suffix))) {
    collectionStrategy = "tree";
    requiredTool = "axe";
  } else {
    collectionStrategy = "block";
    requiredTool = getDefaultToolForBlock(bot, targetItemInfo);
  }
  console.log(
    `[Lệnh Thu Thập] Đã xác định chiến lược: ${collectionStrategy}, Công cụ: ${requiredTool}`
  );

  const initialAmount = countItemManually(bot.inventory, droppedItemId) ?? 0;
  if (initialAmount >= quantity) {
    try {
      bot.chat(
        `${username}, bạn đã có ${initialAmount}/${quantity} ${itemNameVi} rồi.`
      );
    } catch (e) {}
    return;
  }

  bot.isCollecting = true;
  bot.collectingTaskDetails = {
    username: username,
    startTime: Date.now(),
    itemNameVi: itemNameVi,
    itemId: targetItemInfo.name,
    itemType: targetItemInfo,
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
    consecutivePathErrors: 0,
    // === THÊM CÁC DÒNG NÀY ===
    temporaryBlacklist: {}, // Object để lưu { "x,y,z": expiryTimestamp }
    consecutiveDigErrors: 0, // Đếm lỗi đào liên tục trên CÙNG một block
    lastFailedDigPos: null, // Lưu vị trí (dạng string "x,y,z") của lần đào lỗi cuối
  };
  console.log(
    `[Lệnh Thu Thập] Khởi tạo nhiệm vụ. Mục tiêu: ${targetItemInfo.displayName}, Rơi ra: ${droppedItemInfo.displayName}, Số lượng: ${quantity}, Chiến lược: ${collectionStrategy}`
  );

  try {
    bot.chat(
      `Ok ${username}, bắt đầu thu thập ${quantity} ${itemNameVi} (chiến lược ${collectionStrategy}). Hiện có ${initialAmount}.`
    );
  } catch (e) {}

  try {
    const defaultMove = new Movements(bot, mcDataInstance);
    defaultMove.canDig = true;
    defaultMove.allowSprinting = true;
    defaultMove.allowParkour = true;
    defaultMove.canPlaceBlocks = true;
    defaultMove.allow1by1towers = true;
    defaultMove.digCost = 1;
    defaultMove.maxDropDown = 5;
    defaultMove.scaffoldBlockNames = [...scaffoldBlockNames];

    console.log(
      `[Pathfinder Cfg] Parkour: ${defaultMove.allowParkour}, Đặt block: ${defaultMove.canPlaceBlocks}`
    );
    bot.pathfinder.setMovements(defaultMove);
  } catch (moveError) {
    console.error(
      "[Lệnh Thu Thập] Lỗi cài đặt di chuyển pathfinder:",
      moveError
    );
    finishCollectingTask(bot, false, "Không thể cấu hình di chuyển.");
    return;
  }

  collectionLoop(bot);
}

module.exports = {
  startCollectingTask,
  stopCollecting,
};

// --- END OF FILE collect.js ---
