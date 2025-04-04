// --- START OF FILE commands/home.js ---
const { Vec3 } = require("vec3");
const {
  pathfinder,
  Movements,
  goals: { GoalNear, GoalBlock, GoalXZ, GoalY },
} = require("mineflayer-pathfinder");
const mcData = require("minecraft-data");
const { formatCoords } = require("../utils"); // Ensure utils.js has this function exported

// --- Constants ---
const HOUSE_WIDTH = 7;
const HOUSE_DEPTH = 7;
const HOUSE_HEIGHT_F1 = 3; // Floor 1 height (internal space)
const HOUSE_HEIGHT_F2 = 3; // Floor 2 height
const TARGET_FLOOR_Y_OFFSET = -1; // Build floor at Y = bot.pos.y - 1

// --- Target Materials (Cherry Themed) ---
const PRIMARY_LOG_TYPE = "cherry_log";
const PRIMARY_PLANKS_TYPE = "cherry_planks";
const PRIMARY_DOOR_TYPE = "cherry_door";
const PRIMARY_STAIRS_TYPE = "cherry_stairs";
const FENCE_TYPE = "cherry_fence"; // Optional for later
const ROOF_MATERIAL_SLAB = "cobblestone_slab"; // Flat roof using slabs for Phase 2 simplicity
// const ROOF_MATERIAL_STAIRS = 'cobblestone_stairs'; // For sloped roof later
const FLOOR_MATERIAL = PRIMARY_PLANKS_TYPE;
const WALL_MATERIAL = PRIMARY_PLANKS_TYPE;
const WINDOW_MATERIAL = "glass_pane";

// --- Other Essential Materials ---
const CRAFTING_TABLE_TYPE = "crafting_table";
const FURNACE_TYPE = "furnace";
const CHEST_TYPE = "chest";
const COBBLESTONE_TYPE = "cobblestone"; // Or cobbled_deepslate
const COAL_TYPE = "coal";
const CHARCOAL_TYPE = "charcoal";
const SAND_TYPE = "sand";
const GLASS_TYPE = "glass";
const STICK_TYPE = "stick";
const TORCH_TYPE = "torch";

// --- Tools (Priority: Stone > Wood) ---
const WOODEN_AXE = "wooden_axe";
const STONE_AXE = "stone_axe";
const WOODEN_PICKAXE = "wooden_pickaxe";
const STONE_PICKAXE = "stone_pickaxe";
const WOODEN_SHOVEL = "wooden_shovel";
const STONE_SHOVEL = "stone_shovel";
const AXE_PRIORITY = [STONE_AXE, WOODEN_AXE];
const PICKAXE_PRIORITY = [STONE_PICKAXE, WOODEN_PICKAXE];
const SHOVEL_PRIORITY = [STONE_SHOVEL, WOODEN_SHOVEL];

// --- Required Quantities (Estimates - Adjust based on testing) ---
const REQUIRED_PRIMARY_LOGS = 80; // Increased for 7x7, stairs, furniture, fuel buffer
const REQUIRED_COBBLESTONE = 80; // Furnace, stone tools, roof slabs
const REQUIRED_SAND = 24; // Enough for ~12 windows -> ~32 panes
const REQUIRED_COAL_OR_FUEL_UNITS = 30; // Units: 1 coal = 8, 1 log/plank = 1.5. For glass + torches

// --- Other Settings ---
const MAX_RESOURCE_SEARCH_DIST = 128;
const MAX_FUNCTIONAL_BLOCK_SEARCH_DIST = 24; // Search closer for table/furnace/chest
const TORCH_PLACEMENT_INTERVAL = 4; // Place torches every ~4 blocks
const FURNITURE_POSITIONS = {
  // Relative to cornerPos on Floor 1 (Y=0 relative to floor)
  CRAFTING_TABLE: new Vec3(1, 0, 1), // Inner corner
  FURNACE: new Vec3(1, 0, 2), // Next to table
  CHEST_1: new Vec3(HOUSE_WIDTH - 2, 0, 1), // Opposite corner
  CHEST_2: new Vec3(HOUSE_WIDTH - 3, 0, 1), // Next to chest 1
  STAIRS_START: new Vec3(1, 0, HOUSE_DEPTH - 2), // Stairs start pos relative to cornerPos
};
const MAX_PATHFINDING_RETRIES = 2; // Max times to retry pathfinding to a resource

let mc; // Global mcData for this module
let botRef; // Reference to the bot object for helper functions

// =============================================
// HELPER FUNCTIONS (Defined Before Main Task)
// =============================================

// --- Logging Helper ---
function logBuild(message) {
  if (!botRef || !botRef.isBuilding) return; // Only log if building process is active
  console.log(`[Build] ${message}`);
}

// --- Get Item Count ---
function getItemCount(itemName) {
  if (!botRef || !mc) return 0;
  const item = mc.itemsByName[itemName] || mc.blocksByName[itemName];
  if (!item) return 0;
  return botRef.inventory.count(item.id);
}

// --- Equip Item ---
async function equipItem(itemName) {
  if (!botRef || !botRef.isBuilding) return false;
  const item = mc.itemsByName[itemName] || mc.blocksByName[itemName];
  if (!item) {
    logBuild(`Lỗi: Không tìm thấy item '${itemName}' để equip.`);
    return false;
  }
  const itemInInv = botRef.inventory.findInventoryItem(item.id, null);
  if (!itemInInv) {
    /* logBuild(`Không có ${itemName} trong túi để equip.`);*/ return false;
  }
  if (botRef.heldItem && botRef.heldItem.type === item.id) return true; // Already holding
  logBuild(`Trang bị ${itemName}...`);
  try {
    await botRef.equip(itemInInv, "hand");
    await botRef.waitForTicks(2);
    logBuild(`Đã trang bị ${itemName}.`);
    return true;
  } catch (err) {
    logBuild(`Lỗi equip ${itemName}: ${err.message}`);
    return false;
  }
}

// --- Find Nearby Functional Block (Table, Furnace, Chest) ---
async function findNearbyFunctionalBlock(blockName) {
  if (!botRef || !botRef.isBuilding) return null;
  const blockData = mc.blocksByName[blockName];
  if (!blockData) {
    logBuild(`Lỗi: Không có dữ liệu block cho ${blockName}`);
    return null;
  }
  const searchDist = MAX_FUNCTIONAL_BLOCK_SEARCH_DIST;
  // logBuild(`Tìm ${blockName} gần (Tối đa ${searchDist} blocks)...`);
  const foundBlock = await botRef.findBlock({
    matching: blockData.id,
    maxDistance: searchDist,
    count: 1,
  });
  // if (foundBlock) logBuild(`Tìm thấy ${blockName} tại ${formatCoords(foundBlock.position)}`);
  // else logBuild(`Không tìm thấy ${blockName} nào gần đó.`);
  return foundBlock; // Returns Block object or null
}

// --- Place Block Attempt (Improved Reference/Reachability) ---
async function placeBlockAttempt(targetPos, blockName, blockOptions = {}) {
  if (!botRef || !botRef.isBuilding) return false;
  const blockData = mc.blocksByName[blockName];
  if (!blockData) {
    logBuild(`Lỗi: Dữ liệu không hợp lệ cho ${blockName}`);
    return false;
  }
  const blockItem = mc.itemsByName[blockName]; // Need item for checking inventory
  if (!blockItem) {
    logBuild(`Lỗi: Dữ liệu item không hợp lệ cho ${blockName}`);
    return false;
  }

  const existingBlock = botRef.blockAt(targetPos);
  if (existingBlock && existingBlock.type === blockData.id) {
    // logBuild(`Block ${blockName} đã tồn tại tại ${targetPos}`);
    return true;
  }
  // Check if obstructed by non-air/non-liquid block that we shouldn't break
  if (
    existingBlock &&
    existingBlock.type !== 0 &&
    existingBlock.name !== "water" &&
    existingBlock.name !== "lava" &&
    existingBlock.boundingBox === "block"
  ) {
    logBuild(
      `Vị trí ${formatCoords(targetPos)} bị chặn bởi ${existingBlock.name}.`
    );
    return false;
  }
  if (getItemCount(blockName) < 1) {
    logBuild(`Hết ${blockName} trong túi!`);
    return false;
  }

  let referenceBlock = null;
  let faceVector = null;
  let placementPossible = false;
  const maxPlacementDistSq = 4.5 * 4.5; // Max reach distance squared

  // Try finding a valid reference block within reach
  const offsets = [
    [0, -1, 0],
    [0, 1, 0],
    [0, 0, -1],
    [0, 0, 1],
    [-1, 0, 0],
    [1, 0, 0],
  ]; // Order might matter
  for (let i = 0; i < MAX_PATHFINDING_RETRIES + 1; i++) {
    // Allow retries after moving
    if (!botRef.isBuilding) return false;
    referenceBlock = null; // Reset for each attempt/retry
    faceVector = null;

    for (const offset of offsets) {
      const refPos = targetPos.offset(
        offset[0] * -1,
        offset[1] * -1,
        offset[2] * -1
      );
      const block = botRef.blockAt(refPos);

      // Check if block exists, is solid, and the TARGET is within reach from bot's current position
      if (block && block.type !== 0 && block.boundingBox === "block") {
        if (
          botRef.entity.position.distanceSquared(targetPos) < maxPlacementDistSq
        ) {
          const potentialFaceVector = new Vec3(offset[0], offset[1], offset[2]);
          referenceBlock = block;
          faceVector = potentialFaceVector;
          placementPossible = true;
          // logBuild(`Tìm thấy ref ${referenceBlock.name} tại ${referenceBlock.position} cho ${targetPos}`);
          break; // Found a reachable reference
        }
      }
    }

    if (placementPossible) break; // Exit retry loop if placement is possible

    // If no suitable reference found in reach, try moving closer
    if (i < MAX_PATHFINDING_RETRIES) {
      logBuild(
        `Không tìm thấy ref block trong tầm với cho ${formatCoords(
          targetPos
        )}. Thử di chuyển đến gần...`
      );
      try {
        await botRef.pathfinder.goto(
          new GoalNear(targetPos.x, targetPos.y, targetPos.z, 1.5)
        ); // Get closer
        if (!botRef.isBuilding) return false;
        await botRef.waitForTicks(5); // Wait after moving
      } catch (e) {
        logBuild(
          `Lỗi pathfinding khi cố đến gần ${formatCoords(targetPos)}: ${
            e.message
          }`
        );
        // Continue loop to try finding ref again from new pos, or fail after retries
      }
    } else {
      logBuild(
        `Không thể tìm ref block trong tầm với cho ${formatCoords(
          targetPos
        )} sau ${MAX_PATHFINDING_RETRIES} lần thử di chuyển.`
      );
      return false; // Failed after retries
    }
  } // End retry loop

  if (!placementPossible || !referenceBlock || !faceVector) {
    logBuild(
      `Thất bại cuối cùng: Không thể tìm ref block để đặt ${blockName} tại ${formatCoords(
        targetPos
      )}.`
    );
    return false;
  }

  // --- Execute Placement ---
  try {
    if (!(await equipItem(blockName)))
      throw new Error(`Không thể cầm ${blockName}`);
    if (!botRef.isBuilding) return false;

    await botRef.lookAt(targetPos.offset(0.5, 0.5, 0.5), true); // Look at center of target

    // Basic options for now (half for slabs)
    const options = {
      half:
        blockOptions.half ||
        (blockName.endsWith("_slab")
          ? faceVector.y === -1
            ? "top"
            : "bottom"
          : undefined),
    };
    // TODO: Add facing/shape for stairs if implementing sloped roof/complex stairs

    await botRef.placeBlock(referenceBlock, faceVector, options);
    // logBuild(`Đã đặt ${blockName} tại ${formatCoords(targetPos)}.`);
    await botRef.waitForTicks(4); // Wait slightly longer for server confirmation

    // Verification
    const blockAfter = botRef.blockAt(targetPos);
    if (blockAfter && blockAfter.type === blockData.id) {
      return true;
    } else {
      logBuild(
        `Đặt ${blockName} tại ${formatCoords(
          targetPos
        )} nhưng xác nhận thất bại (Block is ${blockAfter?.name})`
      );
      return false;
    }
  } catch (err) {
    logBuild(
      `Lỗi đặt ${blockName} tại ${formatCoords(targetPos)}: ${err.message}`
    );
    // Optional: Wait and re-verify in case of desync
    await botRef.waitForTicks(10);
    const blockAfter = botRef.blockAt(targetPos);
    return blockAfter && blockAfter.type === blockData.id;
  }
}

// --- Internal Crafting Function ---
async function craftItemInternal(itemName, quantity = 1) {
  if (!botRef || !botRef.isBuilding) return false;
  const itemToCraft = mc.itemsByName[itemName] || mc.blocksByName[itemName];
  if (!itemToCraft) {
    logBuild(`Lỗi: Tên item không hợp lệ: ${itemName}`);
    return false;
  }
  logBuild(`Yêu cầu chế tạo nội bộ: ${quantity} x ${itemName}`);

  const knownRecipes = mc.recipes[itemToCraft.id];
  if (!knownRecipes || knownRecipes.length === 0) {
    logBuild(`mcData không có công thức cho ${itemName}.`);
    return false;
  }
  let recipeDefinition =
    knownRecipes.find((r) => !r.requiresTable) || knownRecipes[0];

  let requiresTable = recipeDefinition.requiresTable;
  const itemsDefinitelyNeedingTable = [
    "pickaxe",
    "axe",
    "shovel",
    "hoe",
    "sword",
    "helmet",
    "chestplate",
    "leggings",
    "boots",
    "furnace",
    "chest",
    "barrel",
    "smoker",
    "blast_furnace",
    "shield",
    "bow",
    "bed",
    "piston",
    "sticky_piston",
    "dispenser",
    "dropper",
    "repeater",
    "comparator",
    "observer",
    "door",
    "stairs",
    "glass_pane",
    "torch",
    "crafting_table",
  ]; // Added crafting_table itself
  if (itemsDefinitelyNeedingTable.some((suffix) => itemName.includes(suffix))) {
    requiresTable = true;
    if (!recipeDefinition.requiresTable) {
      recipeDefinition =
        knownRecipes.find((r) => r.requiresTable) || knownRecipes[0];
    }
  }
  // logBuild(`Công thức ${itemName} ${requiresTable ? 'CẦN' : 'KHÔNG cần'} bàn.`);

  let craftingTableBlock = null;
  if (requiresTable) {
    craftingTableBlock = await findNearbyFunctionalBlock(CRAFTING_TABLE_TYPE);
    if (!craftingTableBlock && botRef.isBuilding) {
      logBuild("Không tìm thấy bàn, thử đặt một cái...");
      craftingTableBlock = await placeCraftingTable_Home(); // Call specific place function
    }
    if (!craftingTableBlock && botRef.isBuilding) {
      logBuild(`Không có bàn chế tạo cho ${itemName}.`);
      return false;
    } else if (!botRef.isBuilding) return false;
    // logBuild(`Sử dụng bàn tại ${formatCoords(craftingTableBlock.position)}`);
  }

  // Get Recipe object using bot.recipesFor
  const availableRecipes = botRef.recipesFor(
    itemToCraft.id,
    null,
    null,
    craftingTableBlock
  );
  if (!availableRecipes || availableRecipes.length === 0) {
    logBuild(
      `bot.recipesFor không tìm thấy công thức khả thi cho ${itemName} (Thiếu nguyên liệu?).`
    );
    // Check common ingredients manually for better feedback
    if (recipeDefinition.delta) {
      for (const ing of recipeDefinition.delta) {
        if (ing.count < 0) {
          if (
            getItemCount(mc.items[ing.id]?.name || "unknown") <
            Math.abs(ing.count)
          ) {
            logBuild(
              `-> Có vẻ thiếu: ${mc.items[ing.id]?.name || `ID ${ing.id}`}`
            );
            botRef.chat(
              `Hình như tôi thiếu ${
                mc.items[ing.id]?.displayName || "đồ"
              } để chế ${itemName}.`
            );
            break; // Only report first missing item
          }
        }
      }
    } else {
      botRef.chat(`Tôi không chế được ${itemName}, có thể thiếu đồ.`);
    }
    return false;
  }
  const recipeToUse = availableRecipes[0];

  const yieldPerCraft = recipeToUse.result?.count ?? 1;
  const craftsNeeded = Math.ceil(quantity / yieldPerCraft);
  if (craftsNeeded <= 0) return true; // Already have enough or weird calculation

  logBuild(`Thực hiện ${craftsNeeded} lần craft cho ${itemName}...`);
  let itemBefore = getItemCount(itemName);
  try {
    await botRef.craft(recipeToUse, craftsNeeded, craftingTableBlock);
    logBuild(`Lệnh craft ${itemName} đã gửi. Chờ cập nhật...`);
    await botRef.waitForTicks(10);
    let itemAfter = getItemCount(itemName);
    // Sometimes inventory updates are slow
    if (itemAfter <= itemBefore && botRef.isBuilding) {
      await botRef.waitForTicks(20);
      itemAfter = getItemCount(itemName);
    }

    if (itemAfter > itemBefore || itemAfter >= quantity) {
      logBuild(`Chế tạo thành công ${itemName}. Hiện có: ${itemAfter}`);
      return true;
    } else {
      logBuild(
        `Chế tạo ${itemName} nhưng số lượng (${itemAfter}) không tăng đủ.`
      );
      if (botRef.inventory.emptySlotCount() === 0) botRef.chat("Túi đồ đầy!");
      return false;
    }
  } catch (err) {
    logBuild(`Lỗi khi craft ${itemName}: ${err.message}`);
    if (err.message.toLowerCase().includes("missing"))
      botRef.chat(`Tôi bị thiếu đồ khi đang chế ${itemName}!`);
    else if (err.message.toLowerCase().includes("space"))
      botRef.chat("Túi đồ đầy!");
    return false;
  }
}

// --- Place Crafting Table (Specific logic, including self-crafting) ---
async function placeCraftingTable_Home() {
  if (!botRef || !botRef.isBuilding) return null;
  const tableItemData = mc.itemsByName[CRAFTING_TABLE_TYPE];
  if (!tableItemData) return null;

  let inventoryTable = botRef.inventory.findInventoryItem(
    tableItemData.id,
    null
  );
  if (!inventoryTable) {
    logBuild("Không có bàn chế tạo trong túi. Thử chế tạo...");
    if (!(await craftItemInternal(CRAFTING_TABLE_TYPE, 1))) {
      // Use internal craft
      botRef.chat("Không thể chế tạo bàn chế tạo!");
      return null;
    }
    inventoryTable = botRef.inventory.findInventoryItem(tableItemData.id, null);
    if (!inventoryTable) {
      logBuild("Lỗi: Đã chế tạo bàn nhưng không thấy trong túi?");
      return null;
    }
  }

  logBuild(`Thử đặt bàn chế tạo từ túi đồ...`);
  try {
    // Try placing next to bot first
    const adjacentOffsets = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    for (const offset of adjacentOffsets) {
      if (!botRef.isBuilding) return null;
      const targetPos = botRef.entity.position
        .floored()
        .offset(offset[0], 0, offset[2]);
      const blockAtTarget = botRef.blockAt(targetPos);
      const blockBelowTarget = botRef.blockAt(targetPos.offset(0, -1, 0));

      if (
        blockAtTarget &&
        blockAtTarget.type === 0 &&
        blockBelowTarget &&
        blockBelowTarget.type !== 0 &&
        blockBelowTarget.boundingBox === "block"
      ) {
        logBuild(`Đặt bàn tại vị trí bên cạnh: ${formatCoords(targetPos)}`);
        if (!(await equipItem(CRAFTING_TABLE_TYPE))) continue; // Try next spot if equip fails
        if (!botRef.isBuilding) return null;
        await botRef.placeBlock(blockBelowTarget, new Vec3(0, 1, 0));
        await botRef.waitForTicks(10);
        const placedBlock = botRef.blockAt(targetPos);
        if (placedBlock && placedBlock.name === CRAFTING_TABLE_TYPE) {
          logBuild(`Đã đặt bàn thành công tại ${formatCoords(targetPos)}.`);
          return placedBlock;
        } else {
          logBuild(
            `Đặt bàn tại ${formatCoords(targetPos)} nhưng không xác nhận được.`
          );
          // Continue searching other adjacent spots
        }
      }
    }
    // If placing adjacent failed, try placing at the bot's feet replacement (risky)
    const refBlockFeet = botRef.blockAt(
      botRef.entity.position.offset(0, -1, 0)
    );
    const targetPosFeet = refBlockFeet.position.offset(0, 1, 0);
    if (refBlockFeet && refBlockFeet.type !== 0) {
      const blockAtFeetTarget = botRef.blockAt(targetPosFeet);
      if (blockAtFeetTarget && blockAtFeetTarget.type === 0) {
        logBuild(`Đặt bàn tại vị trí chân bot: ${formatCoords(targetPosFeet)}`);
        if (!(await equipItem(CRAFTING_TABLE_TYPE)))
          throw new Error("Không thể cầm bàn");
        if (!botRef.isBuilding) return null;
        await botRef.placeBlock(refBlockFeet, new Vec3(0, 1, 0));
        await botRef.waitForTicks(10);
        const placedBlockFeet = botRef.blockAt(targetPosFeet);
        if (placedBlockFeet && placedBlockFeet.name === CRAFTING_TABLE_TYPE) {
          logBuild(`Đã đặt bàn thành công tại ${formatCoords(targetPosFeet)}.`);
          return placedBlockFeet;
        }
      }
    }

    throw new Error("Không tìm được vị trí phù hợp gần đó để đặt bàn chế tạo.");
  } catch (err) {
    logBuild(`Lỗi khi đặt bàn chế tạo: ${err.message}`);
    botRef.chat(`Gặp lỗi khi đặt bàn chế tạo: ${err.message}`);
    return null;
  }
}

// --- Ensure Crafted (Calls internal craft) ---
async function ensureCrafted(itemName, quantity = 1) {
  if (!botRef || !botRef.isBuilding) return false;
  const itemData = mc.itemsByName[itemName] || mc.blocksByName[itemName];
  if (!itemData) {
    logBuild(`Lỗi: Dữ liệu không hợp lệ cho ${itemName}`);
    return false;
  }
  const currentCount = getItemCount(itemName);
  if (currentCount >= quantity) return true;
  const needed = quantity - currentCount;
  // logBuild(`Cần chế tạo ${needed} ${itemName}...`);
  return await craftItemInternal(itemName, needed); // Call internal craft
}

// --- Ensure Tool (Calls internal craft) ---
async function ensureTool(toolPriorityList) {
  if (!botRef || !botRef.isBuilding) return false;
  const currentBestTool = toolPriorityList.find(
    (toolName) => getItemCount(toolName) > 0
  );
  if (currentBestTool) return true;
  const toolToCraft = toolPriorityList[toolPriorityList.length - 1]; // Craft lowest tier first
  logBuild(`Chưa có công cụ, thử chế tạo ${toolToCraft}...`);
  const success = await craftItemInternal(toolToCraft, 1); // Call internal craft
  if (success && botRef.isBuilding) {
    logBuild(`Đã chế tạo ${toolToCraft}.`);
    return true;
  } else if (!botRef.isBuilding) return false;
  else {
    logBuild(`Không thể chế tạo ${toolToCraft}.`);
    return false;
  }
}

// --- Resource Collection (Ensure/Find) ---
async function findAndCollectResource(resourceName, needed, toolPriorityList) {
  if (!botRef || !botRef.isBuilding) return false;
  let collectedThisRun = 0;
  const resourceItem =
    mc.itemsByName[resourceName] || mc.blocksByName[resourceName];
  if (!resourceItem) return false;
  const initialCount = getItemCount(resourceName);
  let currentSearchDist = MAX_RESOURCE_SEARCH_DIST / 2; // Bắt đầu tìm gần hơn
  const maxSearchDist = MAX_RESOURCE_SEARCH_DIST * 1.5; // Tăng nhẹ phạm vi tối đa
  let failedFindAttempts = 0; // Đếm số lần tìm mà không thấy gì

  logBuild(
    `Bắt đầu tìm ${needed} ${resourceName} (Phạm vi ban đầu: ${currentSearchDist} blocks)...`
  );

  // Lặp cho đến khi đủ hoặc không thể tìm thấy nữa
  while (getItemCount(resourceName) < initialCount + needed) {
    if (!botRef.isBuilding) return false;

    logBuild(
      `... Tìm ${resourceName} trong phạm vi ${Math.round(
        currentSearchDist
      )} blocks (Thử lần ${failedFindAttempts + 1})...`
    );
    const targetBlock = await botRef.findBlock({
      matching: resourceItem.id,
      maxDistance: currentSearchDist,
      count: 1,
      usePredicate: (block) => {
        const blockBelow = botRef.blockAt(block.position.offset(0, -1, 0));
        return blockBelow && blockBelow.type !== 0; // Có nền bên dưới
      },
    });

    if (!targetBlock) {
      failedFindAttempts++;
      logBuild(
        `Không tìm thấy ${resourceName} trong phạm vi ${Math.round(
          currentSearchDist
        )}.`
      );
      // Mở rộng phạm vi tìm kiếm nếu chưa tối đa
      if (currentSearchDist < maxSearchDist) {
        currentSearchDist = Math.min(currentSearchDist * 1.5, maxSearchDist); // Mở rộng từ từ
        await botRef.waitForTicks(10); // Chờ chút trước khi tìm lại
        continue; // Thử tìm lại với phạm vi rộng hơn
      } else if (failedFindAttempts < 3) {
        // Nếu đã max phạm vi, thử di chuyển ngẫu nhiên một chút rồi tìm lại? (Hơi phức tạp)
        // Tạm thời: Nếu đã tìm max phạm vi mà vẫn ko thấy sau vài lần -> Bỏ cuộc
        logBuild(
          `Đã tìm tối đa ${Math.round(
            maxSearchDist
          )} blocks ${failedFindAttempts} lần mà không thấy ${resourceName}.`
        );
        await botRef.waitForTicks(10);
        continue; // Thử lại thêm vài lần ở phạm vi max
      } else {
        logBuild(
          `Không tìm thấy ${resourceName} sau nhiều lần thử và mở rộng phạm vi.`
        );
        break; // Dừng tìm kiếm
      }
    }

    // --- Nếu tìm thấy targetBlock ---
    failedFindAttempts = 0; // Reset bộ đếm lỗi tìm kiếm
    currentSearchDist = MAX_RESOURCE_SEARCH_DIST / 2; // Reset phạm vi tìm về ban đầu cho lần tìm khối tiếp theo

    logBuild(
      `Tìm thấy ${resourceName} tại ${formatCoords(
        targetBlock.position
      )}. Di chuyển...`
    );
    let pathfinderGoal = new GoalNear(
      targetBlock.position.x,
      targetBlock.position.y,
      targetBlock.position.z,
      1.5
    );
    let currentPathRetries = MAX_PATHFINDING_RETRIES;
    let reached = false;
    while (currentPathRetries > 0 && !reached) {
      if (!botRef.isBuilding) return false;
      try {
        await botRef.pathfinder.goto(pathfinderGoal);
        reached = true; // Assume reached if no error
      } catch (e) {
        logBuild(
          `Pathfinding tới ${resourceName} lần ${
            MAX_PATHFINDING_RETRIES - currentPathRetries + 1
          } lỗi: ${e.message}.`
        );
        currentPathRetries--;
        if (currentPathRetries <= 0)
          logBuild(
            `Bỏ qua khối ${resourceName} này sau ${MAX_PATHFINDING_RETRIES} lần thử.`
          );
        else await botRef.waitForTicks(10); // Wait before retry
      }
    }
    if (!reached) continue; // Skip to next findBlock if pathfinding failed completely
    if (!botRef.isBuilding) return false; // Check again after pathfinding

    logBuild(`Bắt đầu đào ${resourceName}...`);
    const countBeforeDig = getItemCount(resourceName);
    const blockToDig = botRef.blockAt(targetBlock.position); // Re-get block
    if (!blockToDig || blockToDig.type !== resourceItem.id) {
      logBuild(`${resourceName} biến mất?`);
      continue;
    }

    // Equip best tool FOR THIS RESOURCE
    let toolToUse = null;
    if (toolPriorityList && toolPriorityList.length > 0) {
      toolToUse = toolPriorityList.find((tool) => getItemCount(tool) > 0);
    }

    try {
      if (toolToUse) {
        if (!(await equipItem(toolToUse)))
          throw new Error(`Không thể cầm ${toolToUse}`);
      } else {
        const canUseHand =
          resourceName.endsWith("_log") ||
          ["sand", "dirt", "gravel"].includes(resourceName);
        if (!canUseHand && toolPriorityList && toolPriorityList.length > 0)
          throw new Error(`Cần công cụ nhưng không có để đào ${resourceName}`);
        if (botRef.heldItem) await botRef.unequip("hand");
      }
      if (!botRef.isBuilding) return false;
      await botRef.waitForTicks(3);

      await botRef.dig(blockToDig, "ignore", "raycast"); // Use raycast for better reliability potentially
      // Wait dynamically based on tool? Hard. Use fixed delay.
      await botRef.waitForTicks(25); // Slightly longer wait

      const countAfterDig = getItemCount(resourceName);
      let gained = countAfterDig - countBeforeDig;
      if (gained <= 0 && botRef.isBuilding) {
        await botRef.waitForTicks(45);
        gained = getItemCount(resourceName) - countBeforeDig;
      }

      if (gained > 0) collectedThisRun += gained;
      else logBuild(`Không nhặt được ${resourceName}?`);
    } catch (err) {
      logBuild(
        `Lỗi khi đào ${resourceName} tại ${targetBlock.position}: ${err.message}`
      );
      // Check if block is now air, if so, assume dig worked but pickup failed
      const blockAfterDig = botRef.blockAt(targetBlock.position);
      if (!blockAfterDig || blockAfterDig.type === 0) {
        logBuild("-> Block đã biến mất, có thể do lỗi nhặt đồ.");
        // Assume collected '1' conceptually, even if not in inventory yet? Risky.
      }
      await botRef.waitForTicks(10); // Wait before next attempt
    }
  } // End while collecting needed

  logBuild(
    `Kết thúc lượt tìm ${resourceName}: Thu thập thêm ${collectedThisRun}. Hiện có ${getItemCount(
      resourceName
    )}.`
  );
  return getItemCount(resourceName) >= initialCount + needed; // Return true if we reached the target for this call
}

async function ensureResource(resourceName, requiredCount, toolPriorityList) {
  if (!botRef || !botRef.isBuilding) return false;
  const resourceItem =
    mc.itemsByName[resourceName] || mc.blocksByName[resourceName];
  if (!resourceItem) {
    logBuild(`Lỗi: Dữ liệu không hợp lệ cho ${resourceName}`);
    return false;
  }

  let currentCount = getItemCount(resourceName);
  // logBuild(`Kiểm tra ${resourceName}: Cần ${requiredCount}, Có ${currentCount}`);

  while (currentCount < requiredCount) {
    if (!botRef.isBuilding) return false;
    const needed = requiredCount - currentCount;
    botRef.chat(`Cần thêm ${needed} ${resourceName}. Đang tìm...`);

    if (toolPriorityList && toolPriorityList.length > 0) {
      if (!(await ensureTool(toolPriorityList)) && botRef.isBuilding) {
        const canUseHand =
          resourceName.endsWith("_log") ||
          ["sand", "dirt", "gravel"].includes(resourceName);
        if (!canUseHand) {
          botRef.chat(
            `Không có công cụ (${toolPriorityList[0]}) để đào ${resourceName}.`
          );
          return false;
        } else {
          botRef.chat(`Không có công cụ, thử dùng tay lấy ${resourceName}...`);
        }
      } else if (!botRef.isBuilding) return false;
    }

    if (
      !(await findAndCollectResource(resourceName, needed, toolPriorityList))
    ) {
      const finalCount = getItemCount(resourceName);
      if (finalCount < requiredCount) {
        botRef.chat(
          `Không thể tìm/thu thập thêm ${resourceName}. Còn thiếu ${
            requiredCount - finalCount
          }.`
        );
        return false; // Failed to get enough
      } else {
        break;
      } // Exited loop but somehow have enough
    }
    currentCount = getItemCount(resourceName);
    logBuild(`Số lượng ${resourceName} sau thu thập: ${currentCount}`);
  }
  logBuild(`Đã có đủ ${currentCount}/${requiredCount} ${resourceName}.`);
  return true;
}

async function ensureFuel(requiredFuelUnits) {
  if (!botRef || !botRef.isBuilding) return false;
  logBuild("Kiểm tra nhiên liệu...");

  const getFuelUnits = () => {
    const coalCount = getItemCount(COAL_TYPE) + getItemCount(CHARCOAL_TYPE);
    const logCount = mc.itemsArray
      .filter((i) => i.name.endsWith("_log"))
      .reduce((sum, i) => sum + botRef.inventory.count(i.id), 0);
    const plankCount = mc.itemsArray
      .filter((i) => i.name.endsWith("_planks"))
      .reduce((sum, i) => sum + botRef.inventory.count(i.id), 0);
    // Coal=8, Log=1.5, Plank=1.5 (Charcoal=8)
    return coalCount * 8 + (logCount + plankCount) * 1.5;
  };

  let currentFuelUnits = getFuelUnits();
  logBuild(
    `Nhiên liệu hiện có: ~${currentFuelUnits.toFixed(
      1
    )}. Cần: ${requiredFuelUnits}`
  );

  if (currentFuelUnits >= requiredFuelUnits) return true;

  // Try finding coal
  botRef.chat("Cần thêm nhiên liệu. Tìm Than...");
  const coalNeeded = Math.ceil((requiredFuelUnits - currentFuelUnits) / 8);
  if (await findAndCollectResource(COAL_TYPE, coalNeeded, PICKAXE_PRIORITY)) {
    currentFuelUnits = getFuelUnits();
    if (currentFuelUnits >= requiredFuelUnits) {
      logBuild("Đủ nhiên liệu sau khi tìm than.");
      return true;
    }
  }
  if (!botRef.isBuilding) return false;

  // If still not enough, try making charcoal from PRIMARY logs
  botRef.chat("Không đủ than, thử làm Than Củi từ gỗ...");
  const furnaceBlock = await findOrPlaceBlock(
    botRef,
    FURNACE_TYPE,
    FURNITURE_POSITIONS.FURNACE.plus(
      botRef.entity.position
        .floored()
        .offset(2, TARGET_FLOOR_Y_OFFSET - botRef.entity.position.y, 2)
    )
  );
  if (!furnaceBlock) {
    logBuild("Không có lò để làm than củi.");
    return false;
  }

  const remainingUnitsNeeded = requiredFuelUnits - currentFuelUnits;
  const charcoalNeeded = Math.ceil(remainingUnitsNeeded / 8); // How many charcoal needed
  const logsNeededForCharcoal = charcoalNeeded; // 1 log -> 1 charcoal
  const fuelForMakingCharcoal = Math.ceil(charcoalNeeded * 1.5); // Need fuel to make charcoal (use logs/planks)

  // Ensure logs for charcoal itself AND fuel for it
  if (
    !(await ensureResource(
      PRIMARY_LOG_TYPE,
      logsNeededForCharcoal + Math.ceil(fuelForMakingCharcoal / 1.5),
      AXE_PRIORITY
    ))
  ) {
    botRef.chat(`Không đủ ${PRIMARY_LOG_TYPE} để làm than củi.`);
    return false;
  }
  if (!botRef.isBuilding) return false;

  logBuild(`Bắt đầu làm ${charcoalNeeded} than củi...`);
  try {
    const logItem = mc.itemsByName[PRIMARY_LOG_TYPE];
    const fuelItem = logItem; // Use logs as fuel too
    const charcoalItem = mc.itemsByName[CHARCOAL_TYPE];

    // bot.smelt does not directly support log -> charcoal? Requires recipe.
    // Find charcoal recipe that uses logs
    const recipes = botRef.recipesFor(charcoalItem.id, null, null, null);
    const smeltRecipe = recipes.find((r) =>
      r.ingredients?.some((ing) => ing.id === logItem.id)
    );

    if (!smeltRecipe) {
      logBuild(
        "Không tìm thấy công thức smelt log -> charcoal trong bot.recipesFor?"
      );
      // Fallback: Manually interact with furnace? Very complex. Fail for now.
      return false;
    }

    await botRef.smelt(smeltRecipe, charcoalNeeded, furnaceBlock); // Use recipe object
    const waitTicks = charcoalNeeded * 200 + 40;
    logBuild(`Đang làm than củi... Chờ ~${Math.ceil(waitTicks / 20)} giây.`);
    await botRef.waitForTicks(waitTicks);

    if (getItemCount(CHARCOAL_TYPE) >= charcoalNeeded) {
      logBuild("Đã làm xong than củi.");
      currentFuelUnits = getFuelUnits();
      if (currentFuelUnits >= requiredFuelUnits) {
        logBuild("Đủ nhiên liệu sau khi làm than củi.");
        return true;
      }
    } else {
      logBuild(
        `Làm than củi nhưng số lượng (${getItemCount(
          CHARCOAL_TYPE
        )}) chưa đủ ${charcoalNeeded}.`
      );
    }
  } catch (err) {
    logBuild(`Lỗi khi làm than củi: ${err.message}`);
  }

  // Final check
  currentFuelUnits = getFuelUnits();
  if (currentFuelUnits < requiredFuelUnits)
    botRef.chat("Vẫn không đủ nhiên liệu.");
  return currentFuelUnits >= requiredFuelUnits;
}

// --- Ensure Smelted (Glass) ---
async function ensureSmelted(resultItemName, requiredCount, sourceItemName) {
  if (!botRef || !botRef.isBuilding) return false;
  const resultItem = mc.itemsByName[resultItemName];
  const sourceItem = mc.itemsByName[sourceItemName];
  if (!resultItem || !sourceItem) {
    logBuild(`Lỗi dữ liệu: ${resultItemName}/${sourceItemName}`);
    return false;
  }

  const currentCount = getItemCount(resultItemName);
  if (currentCount >= requiredCount) return true;
  const needed = requiredCount - currentCount;
  logBuild(`Cần nấu ${needed} ${resultItemName} từ ${sourceItemName}.`);

  const furnaceBlock = await findOrPlaceBlock(
    botRef,
    FURNACE_TYPE,
    FURNITURE_POSITIONS.FURNACE.plus(
      botRef.entity.position
        .floored()
        .offset(2, TARGET_FLOOR_Y_OFFSET - botRef.entity.position.y, 2)
    )
  );
  if (!furnaceBlock || !botRef.isBuilding) {
    logBuild("Không có lò nung.");
    return false;
  }

  const fuelUnitsNeeded = needed;
  if (!(await ensureFuel(fuelUnitsNeeded))) {
    logBuild("Không đủ nhiên liệu để nấu.");
    return false;
  }
  if (!botRef.isBuilding) return false;

  const sourceNeeded = needed;
  if (!(await ensureResource(sourceItemName, sourceNeeded, SHOVEL_PRIORITY))) {
    // Assume shovel for sand
    botRef.chat(`Không đủ ${sourceItemName} để nấu.`);
    return false;
  }
  if (!botRef.isBuilding) return false;

  logBuild(`Bắt đầu nấu ${needed} ${resultItemName}...`);
  try {
    const smeltRecipe = botRef
      .recipesFor(resultItem.id, null, null, null)
      .find((r) => r.ingredients?.some((ing) => ing.id === sourceItem.id));
    if (!smeltRecipe)
      throw new Error(
        `Không tìm thấy công thức nấu ${resultItemName} từ ${sourceItemName}`
      );

    await botRef.smelt(smeltRecipe, needed, furnaceBlock);
    const waitTicks = needed * 200 + 40;
    logBuild(`Đang nấu... Chờ ~${Math.ceil(waitTicks / 20)} giây.`);
    await botRef.waitForTicks(waitTicks);

    if (getItemCount(resultItemName) >= requiredCount) {
      logBuild(`Đã nấu thành công ${resultItemName}.`);
      return true;
    } else {
      logBuild(
        `Nấu xong nhưng ${resultItemName} (${getItemCount(
          resultItemName
        )}) chưa đủ ${requiredCount}.`
      );
      if (botRef.inventory.emptySlotCount() === 0)
        botRef.chat("Túi đồ đầy, không lấy đồ từ lò!");
      return false;
    }
  } catch (err) {
    logBuild(`Lỗi khi nấu ${resultItemName}: ${err.message}`);
    return false;
  }
}

// =============================================
// BUILDING STRUCTURES - PHASE 2
// =============================================

async function buildFloor(cornerPos, width, depth, materialName) {
  if (!botRef || !botRef.isBuilding) return false;
  logBuild(`Bắt đầu xây sàn ${materialName} tại Y=${cornerPos.y}...`);
  for (let x = 0; x < width; x++) {
    for (let z = 0; z < depth; z++) {
      if (!botRef.isBuilding) return false;
      const placePos = cornerPos.offset(x, 0, z);
      if (!(await placeBlockAttempt(placePos, materialName))) {
        logBuild(`Lỗi đặt sàn ${materialName} tại ${formatCoords(placePos)}`);
        return false;
      }
      await botRef.waitForTicks(1);
    }
  }
  logBuild("Hoàn thành xây sàn.");
  return true;
}

async function buildWalls(
  cornerPos,
  width,
  depth,
  height,
  materialName,
  skipPositions = [],
  windowPositions = []
) {
  if (!botRef || !botRef.isBuilding) return false;
  logBuild(`Bắt đầu xây tường ${materialName}, cao ${height}...`);
  const skipSet = new Set(skipPositions.map((p) => p.toString()));
  const windowSet = new Set(windowPositions.map((p) => p.toString()));

  for (let y = 0; y < height; y++) {
    logBuild(`Xây tường lớp ${y + 1}/${height}...`);
    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        if (x > 0 && x < width - 1 && z > 0 && z < depth - 1) continue; // Skip interior
        if (!botRef.isBuilding) return false;

        const placePos = cornerPos.offset(x, y, z);
        if (skipSet.has(placePos.toString())) continue;
        if (windowSet.has(placePos.toString())) continue;

        if (!(await placeBlockAttempt(placePos, materialName))) {
          logBuild(
            `Lỗi đặt tường ${materialName} tại ${formatCoords(placePos)}`
          );
          return false;
        }
        await botRef.waitForTicks(1);
      }
    }
    await botRef.waitForTicks(3);
  }
  logBuild("Hoàn thành xây tường.");
  return true;
}

// Build flat roof with slabs (simpler for Phase 2)
async function buildRoof(cornerPos, width, depth, materialSlabName) {
  if (!botRef || !botRef.isBuilding) return false;
  logBuild(`Bắt đầu xây mái bằng ${materialSlabName} tại Y=${cornerPos.y}...`);
  const options = { half: "bottom" }; // Place slabs on the bottom half of the block space

  for (let x = 0; x < width; x++) {
    for (let z = 0; z < depth; z++) {
      if (!botRef.isBuilding) return false;
      const placePos = cornerPos.offset(x, 0, z); // Roof is at the Y level of cornerPos
      if (!(await placeBlockAttempt(placePos, materialSlabName, options))) {
        logBuild(
          `Lỗi đặt mái ${materialSlabName} tại ${formatCoords(placePos)}`
        );
        return false;
      }
      await botRef.waitForTicks(1);
    }
  }
  logBuild("Hoàn thành xây mái.");
  return true;
}

function calculateWindowPositions(cornerPos, width, depth, height) {
  const positions = [];
  const windowY = 1; // Eye level relative to floor
  if (height <= windowY) return positions;

  const midX = Math.floor(width / 2);
  const midZ = Math.floor(depth / 2);

  // Front Wall (Z=0), excluding corners and door area
  for (let x = 1; x < width - 1; x++) {
    if (x === midX) continue; // Skip door position
    positions.push(cornerPos.offset(x, windowY, 0));
  }
  // Back Wall (Z=depth-1), excluding corners
  for (let x = 1; x < width - 1; x++) {
    positions.push(cornerPos.offset(x, windowY, depth - 1));
  }
  // Left Wall (X=0), excluding corners
  for (let z = 1; z < depth - 1; z++) {
    positions.push(cornerPos.offset(0, windowY, z));
  }
  // Right Wall (X=width-1), excluding corners
  for (let z = 1; z < depth - 1; z++) {
    positions.push(cornerPos.offset(width - 1, windowY, z));
  }

  return positions;
}

function calculateStairsNeeded(floorHeight) {
  return floorHeight; // For simple straight stairs
}

// Place simple straight stairs
async function placeStairs(cornerPos, width, depth, floorHeight, stairsName) {
  if (!botRef || !botRef.isBuilding) return false;
  logBuild(`Bắt đầu đặt cầu thang ${stairsName}...`);
  const startPosRel = FURNITURE_POSITIONS.STAIRS_START; // Use defined start pos
  const startX = startPosRel.x;
  const startZ = startPosRel.z;

  if (
    startX <= 0 ||
    startX >= width - 1 ||
    startZ <= 0 ||
    startZ >= depth - 1
  ) {
    logBuild("Vị trí cầu thang không hợp lệ (quá gần tường).");
    return false;
  }

  for (let y = 0; y < floorHeight; y++) {
    if (!botRef.isBuilding) return false;
    // Stairs go up and forward (along +X axis in this setup)
    const placePos = cornerPos.offset(startX + y, y, startZ);

    if (startX + y >= width - 1) {
      logBuild("Cầu thang đi ra ngoài tường!");
      return false;
    }

    // Ensure space is clear
    const blockAt = botRef.blockAt(placePos);
    if (blockAt && blockAt.type !== 0) {
      try {
        await botRef.dig(blockAt, "ignore");
        await botRef.waitForTicks(5);
      } catch (e) {
        /* Ignore dig error */
      }
    }
    // Ensure block below exists
    const blockBelow = botRef.blockAt(placePos.offset(0, -1, 0));
    if (!blockBelow || blockBelow.type === 0) {
      logBuild(`Không có nền để đặt cầu thang tại ${formatCoords(placePos)}`);
      // Try placing a scaffold block? Complex. Fail for now.
      return false;
    }

    // Place stair block - Assume facing EAST (+X)
    const options = { facing: "east", half: "bottom" };
    if (!(await placeBlockAttempt(placePos, stairsName, options))) {
      logBuild(`Lỗi đặt cầu thang tại ${formatCoords(placePos)}`);
      return false;
    }
    await botRef.waitForTicks(2);
  }

  // Place landing platform at the top?
  const topLandingPos = cornerPos.offset(
    startX + floorHeight - 1,
    floorHeight,
    startZ
  );
  logBuild(`Đặt sàn đáp cầu thang tại ${formatCoords(topLandingPos)}`);
  if (!(await placeBlockAttempt(topLandingPos, PRIMARY_PLANKS_TYPE))) {
    logBuild("Lỗi đặt sàn đáp cầu thang."); // Non-critical
  }

  logBuild("Hoàn thành đặt cầu thang.");
  return true;
}

async function placeWindows(windowPositions, windowMaterial) {
  if (!botRef || !botRef.isBuilding) return false;
  logBuild(`Bắt đầu đặt cửa sổ ${windowMaterial}...`);
  if (getItemCount(windowMaterial) < windowPositions.length) {
    logBuild(
      `Không đủ ${windowMaterial} (${getItemCount(windowMaterial)}/${
        windowPositions.length
      }) để đặt hết cửa sổ.`
    );
    // Continue placing what we have
  }
  for (const pos of windowPositions) {
    if (!botRef.isBuilding) return false;
    if (getItemCount(windowMaterial) < 1) break; // Stop if out of panes
    if (!(await placeBlockAttempt(pos, windowMaterial))) {
      logBuild(`Lỗi đặt cửa sổ tại ${formatCoords(pos)}`);
      // Continue trying other windows
    }
    await botRef.waitForTicks(2);
  }
  logBuild("Hoàn thành đặt cửa sổ.");
  return true;
}

async function placeDoor(doorBasePos, doorType) {
  if (!botRef || !botRef.isBuilding) return false;
  logBuild(`Bắt đầu đặt cửa ${doorType} tại ${formatCoords(doorBasePos)}...`);
  const blockBelow = botRef.blockAt(doorBasePos.offset(0, -1, 0));
  if (!blockBelow || blockBelow.type === 0) {
    logBuild("Không có nền để đặt cửa!");
    return false;
  }

  // Clear space
  for (let y = 0; y < 2; y++) {
    const blockAt = botRef.blockAt(doorBasePos.offset(0, y, 0));
    if (blockAt && blockAt.type !== 0) {
      try {
        await botRef.dig(blockAt, "ignore");
      } catch (e) {}
    }
  }
  await botRef.waitForTicks(5);

  try {
    if (!(await equipItem(doorType))) throw new Error("Không thể cầm cửa.");
    if (!botRef.isBuilding) return false;
    await botRef.pathfinder.goto(
      new GoalNear(doorBasePos.x, doorBasePos.y, doorBasePos.z, 2)
    );
    if (!botRef.isBuilding) return false;
    await botRef.lookAt(doorBasePos.offset(0.5, 0.5, 0.5), true);

    // Place door - Requires careful options for hinge/facing depending on context
    // Let's try a simple placement first, assuming it faces inwards (+Z from wall Z=0)
    await botRef.placeBlock(blockBelow, new Vec3(0, 1, 0), { facing: 3 }); // facing: 3 might be South (+Z)? Needs testing.
    await botRef.waitForTicks(10);

    const doorBlock = botRef.blockAt(doorBasePos);
    if (doorBlock && doorBlock.name === doorType) {
      logBuild("Đã đặt cửa!");
      return true;
    } else {
      logBuild("Đặt cửa nhưng không xác nhận được.");
      return false;
    }
  } catch (err) {
    logBuild(`Lỗi đặt cửa: ${err.message}`);
    return false;
  }
}

async function placeTorchOnWall(wallPos, torchName, wallNormal) {
  if (!botRef || !botRef.isBuilding) return false;
  if (getItemCount(torchName) < 1) return false;

  const targetPos = wallPos.plus(wallNormal); // Torch appears on the air side
  const wallBlock = botRef.blockAt(wallPos);
  const blockAtTarget = botRef.blockAt(targetPos);

  if (!wallBlock || wallBlock.type === 0 || wallBlock.boundingBox !== "block")
    return false; // Wall must exist and be solid
  if (blockAtTarget && blockAtTarget.type !== 0) return false; // Target space must be air

  try {
    if (!(await equipItem(torchName))) return false;
    if (!botRef.isBuilding) return false;
    await botRef.pathfinder.goto(
      new GoalNear(targetPos.x, targetPos.y, targetPos.z, 3)
    ); // Go near where torch will be
    if (!botRef.isBuilding) return false;
    await botRef.lookAt(targetPos.offset(0.5, 0.5, 0.5), true);

    // Place torch ON the wall block, faceVector is from wall TO torch pos
    await botRef.placeBlock(wallBlock, wallNormal);
    await botRef.waitForTicks(3);
    return true;
  } catch (e) {
    logBuild(`Lỗi đặt đuốc tại ${formatCoords(targetPos)}: ${e.message}`);
    return false;
  }
}

async function placeFurniture(cornerPos, torchesToPlace) {
  if (!botRef || !botRef.isBuilding) return false;
  logBuild("Bắt đầu đặt nội thất và đuốc...");

  // Place functional blocks - Already handled by findOrPlaceBlock in main logic
  // Ensure chests are placed
  const chestBlock1 = await findOrPlaceBlock(
    botRef,
    CHEST_TYPE,
    FURNITURE_POSITIONS.CHEST_1.plus(cornerPos)
  );
  const chestBlock2 = await findOrPlaceBlock(
    botRef,
    CHEST_TYPE,
    FURNITURE_POSITIONS.CHEST_2.plus(cornerPos)
  );
  // Place table/furnace again just to be sure? Might be redundant.
  await findOrPlaceBlock(
    botRef,
    CRAFTING_TABLE_TYPE,
    FURNITURE_POSITIONS.CRAFTING_TABLE.plus(cornerPos)
  );
  await findOrPlaceBlock(
    botRef,
    FURNACE_TYPE,
    FURNITURE_POSITIONS.FURNACE.plus(cornerPos)
  );

  // Place Torches
  let torchesPlacedCount = 0;
  const torchName = TORCH_TYPE;
  if (getItemCount(torchName) < 4) {
    logBuild("Không đủ đuốc để thắp sáng cơ bản.");
    return true;
  } // Continue even without enough torches

  // Place on walls - Floor 1 (Inner walls, eye level)
  const wallY1 = cornerPos.y + 1;
  const wallPositionsF1 = [
    // Simple placement near corners and centers
    { pos: cornerPos.offset(1, wallY1, 1), normal: new Vec3(-1, 0, 0) }, // Inner corner L/F
    {
      pos: cornerPos.offset(1, wallY1, HOUSE_DEPTH - 2),
      normal: new Vec3(-1, 0, 0),
    }, // Inner corner L/B
    {
      pos: cornerPos.offset(HOUSE_WIDTH - 2, wallY1, 1),
      normal: new Vec3(1, 0, 0),
    }, // Inner corner R/F
    {
      pos: cornerPos.offset(HOUSE_WIDTH - 2, wallY1, HOUSE_DEPTH - 2),
      normal: new Vec3(1, 0, 0),
    }, // Inner corner R/B
    {
      pos: cornerPos.offset(Math.floor(HOUSE_WIDTH / 2), wallY1, 1),
      normal: new Vec3(0, 0, -1),
    }, // Mid Front
    {
      pos: cornerPos.offset(
        Math.floor(HOUSE_WIDTH / 2),
        wallY1,
        HOUSE_DEPTH - 2
      ),
      normal: new Vec3(0, 0, 1),
    }, // Mid Back
    {
      pos: cornerPos.offset(1, wallY1, Math.floor(HOUSE_DEPTH / 2)),
      normal: new Vec3(-1, 0, 0),
    }, // Mid Left
    {
      pos: cornerPos.offset(
        HOUSE_WIDTH - 2,
        wallY1,
        Math.floor(HOUSE_DEPTH / 2)
      ),
      normal: new Vec3(1, 0, 0),
    }, // Mid Right
  ];

  for (const wp of wallPositionsF1) {
    if (
      !botRef.isBuilding ||
      torchesPlacedCount >= torchesToPlace ||
      getItemCount(torchName) < 1
    )
      break;
    if (await placeTorchOnWall(wp.pos, torchName, wp.normal)) {
      torchesPlacedCount++;
      await botRef.waitForTicks(2);
    }
  }

  // Place on walls - Floor 2 (Similar logic)
  const wallY2 = cornerPos.y + HOUSE_HEIGHT_F1 + 1;
  const wallPositionsF2 = wallPositionsF1.map((wp) => ({
    pos: wp.pos.offset(0, HOUSE_HEIGHT_F1, 0),
    normal: wp.normal,
  })); // Adjust Y
  for (const wp of wallPositionsF2) {
    if (
      !botRef.isBuilding ||
      torchesPlacedCount >= torchesToPlace ||
      getItemCount(torchName) < 1
    )
      break;
    if (await placeTorchOnWall(wp.pos, torchName, wp.normal)) {
      torchesPlacedCount++;
      await botRef.waitForTicks(2);
    }
  }

  logBuild(`Đã đặt ${torchesPlacedCount} đuốc.`);
  return true;
}

// --- Storage Functions ---
async function findOrPlaceChest(targetPlacementPos) {
  // Wrapper for findOrPlaceBlock specific to chests
  return await findOrPlaceBlock(botRef, CHEST_TYPE, targetPlacementPos);
}

async function depositNonEssentialItems(cornerPos) {
  if (!botRef || !botRef.isBuilding) return false;
  logBuild("Bắt đầu cất đồ không cần thiết...");

  const chestPos1 = FURNITURE_POSITIONS.CHEST_1.plus(cornerPos);
  const chestBlock1 = await findOrPlaceChest(chestPos1);
  if (!chestBlock1) {
    logBuild("Không thể tìm/tạo rương để cất đồ.");
    return false;
  }
  if (!botRef.isBuilding) return false;

  // Define non-essential items
  const nonEssentialNames = [
    "dirt",
    "cobblestone",
    "cobbled_deepslate",
    "granite",
    "diorite",
    "andesite",
    "gravel",
    "sand",
    "flint", // Keep sand if low? No, assume enough was gathered.
    "rotten_flesh",
    "string",
    "spider_eye",
    "gunpowder",
    "bone",
    "arrow", // Keep arrows? Maybe.
    "seeds",
    "wheat_seeds",
    "melon_seeds",
    "pumpkin_seeds",
    "beetroot_seeds",
    "torchflower_seeds",
    "pitcher_pod", // All seeds
    "egg",
    "feather",
    "leather",
    "ink_sac",
    "glow_ink_sac", // Basic mob drops
    // Keep primary building materials, tools, fuel, food, valuable ores, glass/panes, torches, stairs, fences etc.
    // Keep logs/planks (all types for fuel backup maybe?), sticks
  ];
  const keepNames = [
    // Explicitly keep these
    PRIMARY_LOG_TYPE,
    PRIMARY_PLANKS_TYPE,
    PRIMARY_DOOR_TYPE,
    PRIMARY_STAIRS_TYPE,
    ROOF_MATERIAL_SLAB, //ROOF_MATERIAL_STAIRS,
    FLOOR_MATERIAL,
    WALL_MATERIAL,
    WINDOW_MATERIAL,
    CRAFTING_TABLE_TYPE,
    FURNACE_TYPE,
    CHEST_TYPE,
    COBBLESTONE_TYPE, // Keep some for repairs/furnace fuel?
    COAL_TYPE,
    CHARCOAL_TYPE,
    SAND_TYPE,
    GLASS_TYPE,
    STICK_TYPE,
    TORCH_TYPE,
    ...AXE_PRIORITY,
    ...PICKAXE_PRIORITY,
    ...SHOVEL_PRIORITY,
    // Add food items here if bot has auto-eat or needs food
  ];
  const keepIds = new Set(
    keepNames
      .map((name) => mc.itemsByName[name]?.id ?? mc.blocksByName[name]?.id)
      .filter((id) => id !== undefined)
  );

  const itemsToDeposit = botRef.inventory.items().filter((item) => {
    // Skip hotbar? Maybe not, deposit everything non-essential.
    // Skip armor/offhand? Yes.
    const armorSlots = [5, 6, 7, 8]; // Head, Chest, Legs, Feet
    const offhandSlot = 45;
    if (armorSlots.includes(item.slot) || item.slot === offhandSlot)
      return false;
    if (botRef.heldItem && item.slot === botRef.heldItem.slot) return false; // Skip held item

    // Keep items in the keep list
    if (keepIds.has(item.type)) return false;
    // Keep all logs/planks/sticks as they are generally useful
    if (
      item.name.endsWith("_log") ||
      item.name.endsWith("_planks") ||
      item.name === "stick"
    )
      return false;

    // Deposit items in the non-essential list
    return nonEssentialNames.includes(item.name);
  });

  if (itemsToDeposit.length === 0) {
    logBuild("Không có đồ nào cần cất.");
    return true;
  }
  logBuild(
    `Tìm thấy ${itemsToDeposit.length} loại đồ không cần thiết cần cất.`
  );

  let targetChestBlock = chestBlock1;
  let depositedOk = true;

  try {
    await botRef.pathfinder.goto(
      new GoalBlock(
        targetChestBlock.position.x,
        targetChestBlock.position.y,
        targetChestBlock.position.z
      )
    );
    if (!botRef.isBuilding) return false;

    const chestWindow = await botRef.openChest(targetChestBlock);
    logBuild(`Đã mở rương tại ${formatCoords(targetChestBlock.position)}.`);

    for (const item of itemsToDeposit) {
      if (!botRef.isBuilding) {
        depositedOk = false;
        break;
      }
      try {
        logBuild(`Cất ${item.count} x ${item.name}...`);
        await chestWindow.deposit(item.type, null, item.count);
        await botRef.waitForTicks(2);
      } catch (e) {
        logBuild(`Lỗi khi cất ${item.name}: ${e.message}`);
        if (e.message.toLowerCase().includes("chest is full")) {
          logBuild("Rương đầy! Thử mở/đặt rương thứ hai...");
          await chestWindow.close(); // Close current chest
          // Try placing/using the second chest
          const chestPos2 = FURNITURE_POSITIONS.CHEST_2.plus(cornerPos);
          const chestBlock2 = await findOrPlaceChest(chestPos2);
          if (chestBlock2 && botRef.isBuilding) {
            targetChestBlock = chestBlock2; // Switch target
            await botRef.pathfinder.goto(
              new GoalBlock(
                targetChestBlock.position.x,
                targetChestBlock.position.y,
                targetChestBlock.position.z
              )
            );
            if (!botRef.isBuilding) {
              depositedOk = false;
              break;
            }
            const chestWindow2 = await botRef.openChest(targetChestBlock);
            logBuild(
              `Đã mở rương thứ hai tại ${formatCoords(
                targetChestBlock.position
              )}.`
            );
            // Retry depositing the current item and continue with the rest
            logBuild(`Thử cất lại ${item.count} x ${item.name}...`);
            await chestWindow2.deposit(item.type, null, item.count);
            await botRef.waitForTicks(2);
            // Continue depositing remaining items into chest 2 (need to refactor loop or handle state)
            // For simplicity now, just log and stop if second chest fails/fills
            // TODO: Improve loop to handle switching chests mid-deposit
            logBuild("Tiếp tục cất đồ vào rương thứ hai...");
            // Need to continue the loop properly here for remaining items
            await chestWindow2.close(); // Close after attempting retry
            logBuild("Đóng rương thứ hai.");
            // Let the outer loop continue for the next item (might reopen chest 1 or 2)
            // This simplistic approach might fail if chest 2 also fills quickly.
            // break; // Break after trying second chest for now
            continue; // Continue the main loop, hoping chest 1 has space now? Unlikely. Needs better state.
          } else {
            logBuild("Không thể tìm/đặt rương thứ hai.");
            botRef.chat("Rương đầy và không tạo thêm được!");
            depositedOk = false;
            break; // Stop depositing
          }
        } else {
          depositedOk = false; // Other deposit error
          // break; // Stop on other errors? Or try next item? Let's try next.
          continue;
        }
      }
    }

    await botRef.closeWindow(chestWindow); // Close the last opened chest window
    logBuild("Đã đóng rương cuối cùng. Hoàn thành cất đồ.");
    return depositedOk;
  } catch (err) {
    logBuild(`Lỗi khi mở/đóng rương: ${err.message}`);
    try {
      await botRef.closeWindow(botRef.currentWindow);
    } catch (e) {} // Ensure window closed on error
    return false;
  }
}

// =============================================
// CORE TASK FUNCTION DEFINITION (Now at the end)
// =============================================
async function startBuildHousePhase2Task(bot, username) {
  mc = mcData(bot.version);
  if (!mc) {
    bot.chat("Lỗi: Không thể tải mcData.");
    return;
  }
  botRef = bot; // Set global bot reference for helpers

  // --- Initialize Pathfinder ---
  bot.loadPlugin(pathfinder);
  const defaultMove = new Movements(bot, mc);
  // Configure movements (copied from top for clarity)
  defaultMove.allowSprinting = true;
  defaultMove.allowParkour = false;
  defaultMove.canDig = true;
  defaultMove.maxDropDown = 5;
  defaultMove.allow1by1towers = true;
  defaultMove.canPlace = true;
  if (!defaultMove.blocksToPlace) defaultMove.blocksToPlace = new Set();
  const scaffoldBlocks = [
    "dirt",
    "cobblestone",
    "netherrack",
    "cobbled_deepslate",
    "stone",
    PRIMARY_PLANKS_TYPE,
  ];
  scaffoldBlocks.forEach((name) => {
    const block = mc.blocksByName[name];
    if (block) defaultMove.blocksToPlace.add(block.id);
  });
  bot.pathfinder.setMovements(defaultMove);
  // --- End Movement Config ---

  bot.chat(
    `Ok ${username}, bắt đầu Giai đoạn 2: Xây nhà nâng cao! Việc này sẽ mất thời gian...`
  );
  bot.chat("Đang kiểm tra block xung quanh...");
  const nearbyBlocks = bot.findBlocks({
    point: bot.entity.position,
    maxDistance: 5,
    count: 20,
    matching: (block) => block.name.includes("_log"), // Tìm bất kỳ log nào gần đó
  });
  if (nearbyBlocks.length > 0) {
    bot.chat(`Tìm thấy ${nearbyBlocks.length} khúc gỗ gần đây:`);
    nearbyBlocks.forEach((pos) => {
      const block = bot.blockAt(pos);
      if (block) {
        const msg = ` - ${block.name} (ID: ${block.type}) tại ${formatCoords(
          block.position
        )}`;
        console.log(msg);
        bot.chat(msg.substring(0, 90)); // Rút gọn nếu quá dài
      }
    });
  } else {
    bot.chat("Không thấy khúc gỗ nào trong 5 block.");
  }
  await bot.waitForTicks(100); // Chờ bot chat xong
  bot.isBuilding = true; // Set build flag

  try {
    const buildStartTime = Date.now();
    const playerPos = bot.entity.position.floored();
    const cornerPos = playerPos.offset(
      2,
      TARGET_FLOOR_Y_OFFSET - playerPos.y,
      2
    );
    logBuild(`Vị trí góc nhà dự kiến (sàn): ${formatCoords(cornerPos)}`);
    bot.chat(`Bắt đầu xây nhà tại ${formatCoords(cornerPos)}...`);

    // === PHASE 2 STEPS ===

    logBuild("Bước 1: Kiểm tra/Chế tạo công cụ đá...");
    if (!(await ensureTool(PICKAXE_PRIORITY)) || !bot.isBuilding)
      throw new Error("Không thể tạo/có cuốc đá.");
    if (!(await ensureTool(AXE_PRIORITY)) || !bot.isBuilding)
      throw new Error("Không thể tạo/có rìu đá.");
    if (!(await ensureTool(SHOVEL_PRIORITY)) || !bot.isBuilding)
      throw new Error("Không thể tạo/có xẻng đá.");
    logBuild("-> Xong Bước 1: Công cụ đá OK.");
    await bot.waitForTicks(5);
    if (!bot.isBuilding) throw new Error("Bị hủy sau Bước 1.");

    logBuild("Bước 2: Thu thập tài nguyên cơ bản (Gỗ Anh Đào, Đá Cuội)...");
    if (
      !(await ensureResource(
        PRIMARY_LOG_TYPE,
        REQUIRED_PRIMARY_LOGS,
        AXE_PRIORITY
      )) ||
      !bot.isBuilding
    )
      throw new Error(`Không thể thu thập đủ ${PRIMARY_LOG_TYPE}.`);
    if (
      !(await ensureResource(
        COBBLESTONE_TYPE,
        REQUIRED_COBBLESTONE,
        PICKAXE_PRIORITY
      )) ||
      !bot.isBuilding
    )
      throw new Error(`Không thể thu thập đủ ${COBBLESTONE_TYPE}.`);
    logBuild("-> Xong Bước 2: Gỗ/Đá ban đầu OK.");
    await bot.waitForTicks(5);
    if (!bot.isBuilding) throw new Error("Bị hủy sau Bước 2.");

    logBuild("Bước 3: Đảm bảo Bàn chế tạo và Lò nung...");
    const tablePos = FURNITURE_POSITIONS.CRAFTING_TABLE.plus(cornerPos);
    const furnacePos = FURNITURE_POSITIONS.FURNACE.plus(cornerPos);
    if (
      !(await findOrPlaceBlock(CRAFTING_TABLE_TYPE, tablePos)) ||
      !bot.isBuilding
    )
      throw new Error("Không thể đặt bàn chế tạo.");
    if (!(await findOrPlaceBlock(FURNACE_TYPE, furnacePos)) || !bot.isBuilding)
      throw new Error("Không thể đặt lò nung.");
    logBuild("-> Xong Bước 3: Bàn/Lò OK.");
    await bot.waitForTicks(5);
    if (!bot.isBuilding) throw new Error("Bị hủy sau Bước 3.");

    logBuild("Bước 4: Xây dựng cấu trúc tầng 1...");
    if (
      !(await buildFloor(
        cornerPos,
        HOUSE_WIDTH,
        HOUSE_DEPTH,
        FLOOR_MATERIAL
      )) ||
      !bot.isBuilding
    )
      throw new Error("Lỗi xây sàn tầng 1.");
    const windowPositionsF1 = calculateWindowPositions(
      cornerPos,
      HOUSE_WIDTH,
      HOUSE_DEPTH,
      HOUSE_HEIGHT_F1
    );
    const doorPosition = cornerPos.offset(Math.floor(HOUSE_WIDTH / 2), 0, 0);
    if (
      !(await buildWalls(
        cornerPos,
        HOUSE_WIDTH,
        HOUSE_DEPTH,
        HOUSE_HEIGHT_F1,
        WALL_MATERIAL,
        [doorPosition, doorPosition.offset(0, 1, 0)],
        windowPositionsF1
      )) ||
      !bot.isBuilding
    )
      throw new Error("Lỗi xây tường tầng 1.");
    logBuild("-> Xong Bước 4: Khung tầng 1 OK.");
    await bot.waitForTicks(5);
    if (!bot.isBuilding) throw new Error("Bị hủy sau Bước 4.");

    logBuild("Bước 5: Thu thập Cát và Nhiên liệu...");
    if (
      !(await ensureResource(SAND_TYPE, REQUIRED_SAND, SHOVEL_PRIORITY)) ||
      !bot.isBuilding
    )
      throw new Error(`Không thể thu thập đủ ${SAND_TYPE}.`);
    if (!(await ensureFuel(REQUIRED_COAL_OR_FUEL_UNITS)) || !bot.isBuilding)
      throw new Error("Không thể thu thập đủ nhiên liệu.");
    logBuild("-> Xong Bước 5: Cát/Nhiên liệu OK.");
    await bot.waitForTicks(5);
    if (!bot.isBuilding) throw new Error("Bị hủy sau Bước 5.");

    logBuild("Bước 6: Nấu Kính...");
    const glassNeeded = Math.ceil(windowPositionsF1.length / (16 / 6)) + 5; // Estimate: 1 glass block -> 16 panes, need enough for F1 + F2 + buffer
    if (
      !(await ensureSmelted(GLASS_TYPE, glassNeeded, SAND_TYPE)) ||
      !bot.isBuilding
    )
      throw new Error(`Không thể nấu đủ ${GLASS_TYPE}.`);
    logBuild("-> Xong Bước 6: Kính OK.");
    await bot.waitForTicks(5);
    if (!bot.isBuilding) throw new Error("Bị hủy sau Bước 6.");

    logBuild("Bước 7: Chế tạo vật phẩm phụ...");
    const torchesNeeded =
      Math.ceil(
        (HOUSE_WIDTH * HOUSE_DEPTH * 2) /
          (TORCH_PLACEMENT_INTERVAL * TORCH_PLACEMENT_INTERVAL)
      ) + 10; // More torches
    const chestsNeeded = 2;
    const stairsNeeded = calculateStairsNeeded(HOUSE_HEIGHT_F1);
    const glassPanesNeeded = windowPositionsF1.length * 2; // Estimate more panes needed per window pos
    if (!(await ensureCrafted(TORCH_TYPE, torchesNeeded)) || !bot.isBuilding)
      throw new Error(`Không thể chế tạo đủ ${TORCH_TYPE}.`);
    if (!(await ensureCrafted(CHEST_TYPE, chestsNeeded)) || !bot.isBuilding)
      throw new Error(`Không thể chế tạo đủ ${CHEST_TYPE}.`);
    if (
      !(await ensureCrafted(PRIMARY_STAIRS_TYPE, stairsNeeded)) ||
      !bot.isBuilding
    )
      throw new Error(`Không thể chế tạo đủ ${PRIMARY_STAIRS_TYPE}.`);
    if (
      !(await ensureCrafted(WINDOW_MATERIAL, glassPanesNeeded)) ||
      !bot.isBuilding
    )
      throw new Error(`Không thể chế tạo đủ ${WINDOW_MATERIAL}.`);
    logBuild("-> Xong Bước 7: Vật phẩm phụ OK.");
    await bot.waitForTicks(5);
    if (!bot.isBuilding) throw new Error("Bị hủy sau Bước 7.");

    logBuild("Bước 8: Xây dựng cấu trúc tầng 2...");
    const secondFloorCorner = cornerPos.offset(0, HOUSE_HEIGHT_F1, 0);
    if (
      !(await buildFloor(
        secondFloorCorner,
        HOUSE_WIDTH,
        HOUSE_DEPTH,
        FLOOR_MATERIAL
      )) ||
      !bot.isBuilding
    )
      throw new Error("Lỗi xây sàn tầng 2.");
    const windowPositionsF2 = calculateWindowPositions(
      secondFloorCorner,
      HOUSE_WIDTH,
      HOUSE_DEPTH,
      HOUSE_HEIGHT_F2
    );
    if (
      !(await buildWalls(
        secondFloorCorner,
        HOUSE_WIDTH,
        HOUSE_DEPTH,
        HOUSE_HEIGHT_F2,
        WALL_MATERIAL,
        [],
        windowPositionsF2
      )) ||
      !bot.isBuilding
    )
      throw new Error("Lỗi xây tường tầng 2.");
    logBuild("-> Xong Bước 8: Khung tầng 2 OK.");
    await bot.waitForTicks(5);
    if (!bot.isBuilding) throw new Error("Bị hủy sau Bước 8.");

    logBuild("Bước 9: Xây mái nhà (mái bằng slab)...");
    const roofCorner = secondFloorCorner.offset(0, HOUSE_HEIGHT_F2, 0);
    // Ensure enough slabs first (Cobblestone -> Slabs)
    const slabsNeeded = HOUSE_WIDTH * HOUSE_DEPTH;
    if (
      !(await ensureCrafted(ROOF_MATERIAL_SLAB, slabsNeeded)) ||
      !bot.isBuilding
    )
      throw new Error(`Không thể chế tạo đủ ${ROOF_MATERIAL_SLAB}.`);
    if (
      !(await buildRoof(
        roofCorner,
        HOUSE_WIDTH,
        HOUSE_DEPTH,
        ROOF_MATERIAL_SLAB
      )) ||
      !bot.isBuilding
    )
      throw new Error("Lỗi xây mái nhà.");
    logBuild("-> Xong Bước 9: Mái nhà OK.");
    await bot.waitForTicks(5);
    if (!bot.isBuilding) throw new Error("Bị hủy sau Bước 9.");

    logBuild("Bước 10: Lắp đặt Cầu thang, Cửa sổ, Cửa chính...");
    if (
      !(await placeStairs(
        cornerPos,
        HOUSE_WIDTH,
        HOUSE_DEPTH,
        HOUSE_HEIGHT_F1,
        PRIMARY_STAIRS_TYPE
      )) ||
      !bot.isBuilding
    )
      throw new Error("Lỗi đặt cầu thang.");
    if (
      !(await placeWindows(windowPositionsF1, WINDOW_MATERIAL)) ||
      !bot.isBuilding
    )
      throw new Error("Lỗi đặt cửa sổ tầng 1.");
    if (
      !(await placeWindows(windowPositionsF2, WINDOW_MATERIAL)) ||
      !bot.isBuilding
    )
      throw new Error("Lỗi đặt cửa sổ tầng 2.");
    if (!(await placeDoor(doorPosition, PRIMARY_DOOR_TYPE)) || !bot.isBuilding)
      throw new Error("Lỗi đặt cửa chính.");
    logBuild("-> Xong Bước 10: Lắp đặt OK.");
    await bot.waitForTicks(5);
    if (!bot.isBuilding) throw new Error("Bị hủy sau Bước 10.");

    logBuild("Bước 11: Đặt nội thất và thắp đuốc...");
    if (!(await placeFurniture(cornerPos, torchesNeeded)) || !bot.isBuilding)
      throw new Error("Lỗi đặt nội thất/đuốc.");
    logBuild("-> Xong Bước 11: Nội thất/Đuốc OK.");
    await bot.waitForTicks(5);
    if (!bot.isBuilding) throw new Error("Bị hủy sau Bước 11.");

    logBuild("Bước 12: Dọn dẹp túi đồ...");
    if (!(await depositNonEssentialItems(cornerPos)) || !bot.isBuilding)
      console.warn("[Build] Không thể dọn dẹp túi đồ.");
    else logBuild("-> Xong Bước 12: Dọn dẹp OK.");
    await bot.waitForTicks(5);
    if (!bot.isBuilding) throw new Error("Bị hủy sau Bước 12.");

    // --- DONE ---
    const buildEndTime = Date.now();
    const durationMinutes = ((buildEndTime - buildStartTime) / 60000).toFixed(
      1
    );
    bot.chat(
      `*** GIAI ĐOẠN 2 HOÀN THÀNH! *** Ngôi nhà anh đào đã được nâng cấp tại ${formatCoords(
        cornerPos
      )}. (Thời gian: ${durationMinutes} phút)`
    );
  } catch (err) {
    console.error("[Build House Phase 2 Error]", err);
    bot.chat(`Ối, có lỗi nghiêm trọng khi xây nhà GĐ 2: ${err.message}`);
    bot.chat("Dừng tác vụ xây dựng.");
  } finally {
    logBuild("Kết thúc tác vụ xây dựng (dọn dẹp)...");
    botRef.isBuilding = false; // ALWAYS clear flag
    botRef = null; // Clear bot reference
    // Stop any lingering movement
    try {
      if (bot && bot.pathfinder && bot.pathfinder.isMoving())
        bot.pathfinder.stop();
    } catch (e) {}
    try {
      if (bot) bot.clearControlStates();
    } catch (e) {}
    console.log("[Build Phase 2] Tác vụ xây dựng đã dừng hoàn toàn.");
  }
}

// =============================================
// MODULE EXPORT
// =============================================
module.exports = {
  startBuildHousePhase2Task, // Only export the main Phase 2 task
};
// --- END OF FILE commands/home.js ---
