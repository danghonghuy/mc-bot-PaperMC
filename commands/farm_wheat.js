// commands/farm_wheat.js

const {
  goals: { GoalNear },
} = require("mineflayer-pathfinder");
const { Vec3 } = require("vec3");

let bot = null;
let mcData = null;
let pathfinder = null;
let collectBlock = null;

// --- Trạng thái Module ---
let isFarmingWheat = false;
let farmingTaskDetails = {
  initiatingUsername: null,
  searchRadius: 50,
  buildSearchRadius: 30,
  stopRequested: false,
  stage: "idle",
  targetFieldCoords: null,
  neededItems: {},
  missingItems: {},
  beggingTarget: null,
  beggingTimeoutId: null,
  buildLocation: null,
  buildTargetY: null,
  flatCheckResult: null,
  flatteningAttempts: 0,
  waterPlacementAttempts: 0,
  stats: {
    wheatHarvested: 0,
    seedsPlanted: 0,
    blocksBroken: 0,
    blocksPlaced: 0,
  },
};

// --- Hằng số ---
const DEFAULT_SEARCH_RADIUS = 50;
const DEFAULT_BUILD_SEARCH_RADIUS = 30;
const MAX_HARVEST_BLOCKS_PER_CYCLE = 30;
const BREAK_REACH = 4.5;
const PLANT_REACH = 4.0;
const TILL_REACH = 4.0;
const PLACE_REACH = 4.5;
const COLLECT_RADIUS_FARM = 4;
const REPLANT_DELAY_MS = 800;
const CHECK_INTERVAL_MS = 1500;
const ACTION_DELAY_MS = 200;
const BEGGING_RADIUS = 20;
const BEGGING_TIMEOUT_MS = 60 * 1000;
const BUILD_FARM_LENGTH = 7;
const BUILD_FARM_WIDTH = 3;
const CHECK_AREA_LENGTH = 9;
const CHECK_AREA_WIDTH = 5;
const FARM_AREA = 21;
const SEEDS_NEEDED_FOR_BUILD = 16;
const WATER_CENTER_OFFSET_X = 3;
const WATER_CENTER_OFFSET_Z = 1;
const FARM_HARVEST_SCAN_RADIUS = 15;
const MAX_FLATTENING_BLOCKS = 100;
const MAX_WATER_PLACEMENT_ATTEMPTS = 3;
const FLATNESS_THRESHOLD = 0.1;
// <<< HẰNG SỐ BỊ THIẾU ĐÃ ĐƯỢC THÊM VÀO ĐÂY >>>
const FARM_MOVE_GOAL_DIST = 1.8; // Khoảng cách mục tiêu khi di chuyển trên ruộng
const COLLECT_MOVE_CLOSER_DIST = 1.0; // Khoảng cách để di chuyển lại gần nhặt đồ
// <<< KẾT THÚC PHẦN THÊM >>>

// Item Names
const WHEAT = "wheat";
const WHEAT_SEEDS = "wheat_seeds";
const FARMLAND = "farmland";
const DIRT = "dirt";
const GRASS_BLOCK = "grass_block";
const CRAFTING_TABLE = "crafting_table";
const WATER_BUCKET = "water_bucket";
const WATER = "water";
const AIR = "air";
const HOE_TYPES = [
  "wooden_hoe",
  "stone_hoe",
  "iron_hoe",
  "golden_hoe",
  "diamond_hoe",
  "netherite_hoe",
];
const SHOVEL_TYPES = [
  "wooden_shovel",
  "stone_shovel",
  "iron_shovel",
  "golden_shovel",
  "diamond_shovel",
  "netherite_shovel",
];
const PICKAXE_TYPES = [
  "wooden_pickaxe",
  "stone_pickaxe",
  "iron_pickaxe",
  "golden_pickaxe",
  "diamond_pickaxe",
  "netherite_pickaxe",
];
const SOLID_GROUND_BLOCKS = new Set([
  DIRT,
  GRASS_BLOCK,
  FARMLAND,
  "stone",
  "cobblestone",
  "andesite",
  "diorite",
  "granite",
  "deepslate",
  "cobbled_deepslate",
  "sand",
  "gravel",
]);

// --- Hàm Khởi tạo ---
function initializeFarmWheat(botInstance) {
  bot = botInstance;
  mcData = require("minecraft-data")(bot.version);
  pathfinder = bot.pathfinder;
  collectBlock = bot.collectBlock;
  isFarmingWheat = false;
  resetTaskDetails();
  console.log("[Farm Wheat] Initialized.");
}

// --- Hàm Reset Chi Tiết Task ---
function resetTaskDetails() {
  if (farmingTaskDetails.beggingTimeoutId)
    clearTimeout(farmingTaskDetails.beggingTimeoutId);
  if (bot) bot.removeListener("playerCollect", handleFarmBeggingCollect);
  farmingTaskDetails = {
    initiatingUsername: null,
    searchRadius: DEFAULT_SEARCH_RADIUS,
    buildSearchRadius: DEFAULT_BUILD_SEARCH_RADIUS,
    stopRequested: false,
    stage: "idle",
    targetFieldCoords: null,
    neededItems: {},
    missingItems: {},
    beggingTarget: null,
    beggingTimeoutId: null,
    buildLocation: null,
    buildTargetY: null,
    flatCheckResult: null,
    flatteningAttempts: 0,
    waterPlacementAttempts: 0,
    stats: {
      wheatHarvested: 0,
      seedsPlanted: 0,
      blocksBroken: 0,
      blocksPlaced: 0,
    },
  };
  if (bot) bot.isFarmingWheat = false;
}

// --- Hàm Bắt đầu ---
async function startFarmingWheat(username, radius = DEFAULT_SEARCH_RADIUS) {
  if (isFarmingWheat) {
    bot.chat(`${username}, đang làm ruộng.`);
    return;
  }
  if (!pathfinder || !collectBlock) {
    bot.chat(`${username}, thiếu plugin.`);
    return;
  }
  resetTaskDetails();
  isFarmingWheat = true;
  bot.isFarmingWheat = true;
  farmingTaskDetails.initiatingUsername = username;
  farmingTaskDetails.searchRadius = Math.min(Math.max(radius, 10), 100);
  farmingTaskDetails.stage = "searching_field";
  bot.chat(
    `Ok ${username}, tìm/làm ruộng lúa bk ${farmingTaskDetails.searchRadius}...`
  );
  console.log(
    `[Farm Wheat] Start: ${username}, R=${farmingTaskDetails.searchRadius}.`
  );
  farmLoop();
}

// --- Hàm Dừng ---
function stopFarmingWheat(reason = "Không rõ lý do", silent = false) {
  if (!isFarmingWheat && !bot.isFarmingWheat) return;
  const userInitiated = reason === farmingTaskDetails.initiatingUsername;
  const finalReason = userInitiated ? "Yêu cầu bởi người dùng" : reason;
  console.log(
    `[Farm Wheat] Stopping. Reason: ${finalReason}. Stats: ${JSON.stringify(
      farmingTaskDetails.stats
    )}`
  );
  farmingTaskDetails.stopRequested = true;
  isFarmingWheat = false;
  bot.isFarmingWheat = false;
  if (bot) bot.removeListener("playerCollect", handleFarmBeggingCollect);
  if (farmingTaskDetails.beggingTimeoutId)
    clearTimeout(farmingTaskDetails.beggingTimeoutId);
  farmingTaskDetails.beggingTimeoutId = null;
  farmingTaskDetails.beggingTarget = null;
  const silentReasons = [
    "Hệ thống",
    "Lỗi hệ thống",
    "Bot chết",
    "Bị kick",
    "Mất kết nối",
    "Bị kẹt",
    "Vòng lặp kết thúc bất thường",
    `Thất bại ở giai đoạn: ${reason}`,
  ];
  if (
    bot.entity &&
    !silent &&
    !silentReasons.includes(finalReason) &&
    !userInitiated
  )
    bot.chat(`Đã dừng làm ruộng. Lý do: ${finalReason}`);
  else if (bot.entity && finalReason === "Hoàn thành thu hoạch")
    bot.chat(
      `Thu hoạch xong ${farmingTaskDetails.stats.wheatHarvested} lúa, trồng lại ${farmingTaskDetails.stats.seedsPlanted} hạt.`
    );
  else if (bot.entity && finalReason === "Hoàn thành xây ruộng")
    bot.chat(
      `Xây xong ruộng 7x3, trồng ${farmingTaskDetails.stats.seedsPlanted} hạt.`
    );
  else if (bot.entity && finalReason.startsWith("Thất bại") && !silent)
    bot.chat(`Không thể làm ruộng (${finalReason}).`);
  resetTaskDetails();
}

// --- Vòng lặp Chính (State Machine) ---
async function farmLoop() {
  while (isFarmingWheat && !farmingTaskDetails.stopRequested) {
    const currentStage = farmingTaskDetails.stage;
    if (!isFarmingWheat || !bot.isFarmingWheat) break;
    try {
      console.log(`[Farm Wheat] ----- Stage: ${currentStage} -----`);
      let nextStage = null;
      switch (currentStage) {
        case "searching_field":
          nextStage = await handleSearchFieldStage();
          break;
        case "harvesting":
          nextStage = await handleHarvestingStage();
          break;
        case "checking_build_resources":
          nextStage = await handleCheckBuildResourcesStage();
          break;
        case "crafting_tools":
          nextStage = await handleCraftingToolsStage();
          break;
        case "begging":
          nextStage = await handleBeggingStage();
          break;
        case "finding_build_location":
          nextStage = await handleFindingBuildLocationStage();
          break;
        case "flattening":
          nextStage = await handleFlatteningStage();
          break;
        case "preparing_area":
          nextStage = await handlePreparingAreaStage();
          break;
        case "tilling":
          nextStage = await handleTillingStage();
          break;
        case "placing_water":
          nextStage = await handlePlacingWaterStage();
          break;
        case "planting":
          nextStage = await handlePlantingStage();
          break;
        case "done":
          return;
        case "failed":
          console.log("[Farm Wheat] Reached 'failed' state, ensuring stop.");
          if (isFarmingWheat || bot.isFarmingWheat)
            stopFarmingWheat("Task reached failed state", true);
          return;
        default:
          console.error(`Unknown stage: ${currentStage}`);
          stopFarmingWheat("Lỗi stage", true);
          return;
      }
      if (nextStage === "failed") {
        console.log(`Stage '${currentStage}' returned 'failed'. Stopping NOW.`);
        stopFarmingWheat(`Thất bại ở giai đoạn: ${currentStage}`, true);
        return;
      }
      if (nextStage && nextStage !== currentStage) {
        farmingTaskDetails.stage = nextStage;
      } else if (nextStage === currentStage) {
        await sleep(currentStage === "begging" ? 500 : CHECK_INTERVAL_MS);
      } else if (!nextStage) {
        if (currentStage === "begging") await sleep(500);
        else {
          console.error(
            `Stage '${currentStage}' returned invalid next stage. Failing.`
          );
          stopFarmingWheat(`Lỗi logic stage ${currentStage}`, true);
          return;
        }
      }
    } catch (error) {
      console.error(`UNHANDLED error stage ${currentStage}:`, error);
      stopFarmingWheat(`Lỗi hệ thống (${currentStage})`, true);
      return;
    }
  }
  console.log(
    `[Farm Wheat] farmLoop exited (stopReq=${farmingTaskDetails.stopRequested}, isFarm=${isFarmingWheat}).`
  );
  if (isFarmingWheat || bot.isFarmingWheat) {
    console.warn("[Farm Wheat] Loop exited UNEXPECTEDLY, forcing stop state.");
    stopFarmingWheat("Vòng lặp kết thúc bất thường", true);
  }
}

// --- STAGE HANDLERS ---
async function handleSearchFieldStage() {
  console.log(
    `[Farm Wheat] Searching farmland bk ${farmingTaskDetails.searchRadius}...`
  );
  const farmlandBlocks = await findNearbyBlocks(
    FARMLAND,
    farmingTaskDetails.searchRadius
  );
  if (farmlandBlocks.length > 0) {
    console.log(`[Farm Wheat] Found ${farmlandBlocks.length} farmland.`);
    const nearest = farmlandBlocks.sort(
      (a, b) =>
        a.position.distanceTo(bot.entity.position) -
        b.position.distanceTo(bot.entity.position)
    )[0];
    farmingTaskDetails.targetFieldCoords = nearest.position;
    console.log(
      `[Farm Wheat] Field anchor near ${formatVec3(
        nearest.position
      )}. Harvesting.`
    );
    return "harvesting";
  } else {
    console.log("[Farm Wheat] No farmland found. Build new farm.");
    bot.chat("Không thấy ruộng nào, thử xây ruộng mới 7x3.");
    return "checking_build_resources";
  }
}
async function handleHarvestingStage() {
  const initialAnchorPos = farmingTaskDetails.targetFieldCoords;
  if (!initialAnchorPos) return "failed";
  console.log(
    `[Farm Wheat] Harvest stage. Anchor: ${formatVec3(
      initialAnchorPos
    )}. Scanning nearby...`
  );
  const nearbyFarmland = await findNearbyBlocks(
    FARMLAND,
    FARM_HARVEST_SCAN_RADIUS,
    initialAnchorPos
  );
  if (nearbyFarmland.length === 0) {
    console.log("No farmland near anchor. Build.");
    bot.chat("Đất ruộng biến mất, thử xây mới.");
    return "checking_build_resources";
  }
  const matureWheatToHarvest = [];
  for (const farmBlock of nearbyFarmland) {
    if (farmingTaskDetails.stopRequested) return "failed";
    const wheatPos = farmBlock.position.offset(0, 1, 0);
    const blockAbove = bot.blockAt(wheatPos);
    if (blockAbove?.name === WHEAT && blockAbove.metadata === 7)
      matureWheatToHarvest.push(blockAbove);
  }
  if (matureWheatToHarvest.length === 0) {
    console.log("No mature wheat found.");
    stopFarmingWheat("Hoàn thành thu hoạch", false);
    return "done";
  }
  console.log(
    `[Farm Wheat] Found ${matureWheatToHarvest.length} mature wheat.`
  );
  matureWheatToHarvest.sort(
    (a, b) =>
      a.position.distanceTo(bot.entity.position) -
      b.position.distanceTo(bot.entity.position)
  );
  const wheatToProcess = matureWheatToHarvest.slice(
    0,
    MAX_HARVEST_BLOCKS_PER_CYCLE
  );
  for (const wheatBlock of wheatToProcess) {
    if (farmingTaskDetails.stopRequested || !isFarmingWheat) return "failed";
    const wheatPos = wheatBlock.position;
    const farmlandPos = wheatPos.offset(0, -1, 0);
    if (bot.entity.position.distanceTo(wheatPos) > BREAK_REACH)
      if (!(await goToPosition(wheatPos, FARM_MOVE_GOAL_DIST))) {
        console.warn(`Cannot reach wheat ${formatVec3(wheatPos)}. Skip.`);
        continue;
      }
    const blockToCheck = bot.blockAt(wheatPos);
    if (
      !blockToCheck ||
      blockToCheck.type !== wheatBlock.type ||
      blockToCheck.metadata !== 7
    ) {
      console.log(`Wheat ${formatVec3(wheatPos)} changed. Skip.`);
      continue;
    }
    try {
      await bot.dig(wheatBlock);
      farmingTaskDetails.stats.wheatHarvested++;
      console.log(`Harvested #${farmingTaskDetails.stats.wheatHarvested}`);
      await sleep(REPLANT_DELAY_MS);
      await goToPosition(wheatPos, COLLECT_MOVE_CLOSER_DIST);
      await collectSpecificItemsNear(wheatPos, [WHEAT, WHEAT_SEEDS]);
      const farmlandBlock = bot.blockAt(farmlandPos);
      if (farmlandBlock?.name === FARMLAND) {
        const seedId = mcData.itemsByName[WHEAT_SEEDS].id;
        if (bot.inventory.count(seedId) > 0) {
          try {
            if (bot.entity.position.distanceTo(farmlandPos) > PLANT_REACH)
              if (!(await goToPosition(farmlandPos, FARM_MOVE_GOAL_DIST)))
                continue;
            await bot.equip(seedId, "hand");
            await bot.placeBlock(farmlandBlock, new Vec3(0, 1, 0));
            farmingTaskDetails.stats.seedsPlanted++;
            console.log(`Replanted #${farmingTaskDetails.stats.seedsPlanted}`);
          } catch (pErr) {
            console.error(`Replant error: ${pErr.message}`);
            if (bot.inventory.count(seedId) === 0) {
              bot.chat("Hết hạt khi trồng!");
              return "failed";
            }
          }
        } else {
          bot.chat("Hết hạt để trồng!");
          return "failed";
        }
      } else {
        console.warn(`No farmland ${formatVec3(farmlandPos)}.`);
      }
    } catch (dErr) {
      console.error(`Dig error: ${dErr.message}`);
    }
    await sleep(100);
  }
  return "harvesting";
}
async function handleCheckBuildResourcesStage() {
  console.log("[Farm Wheat] Checking resources for 7x3 farm...");
  const seedsNeeded = SEEDS_NEEDED_FOR_BUILD;
  const maxDirtNeeded = FARM_AREA;
  farmingTaskDetails.neededItems = {
    [HOE_TYPES[0]]: 1,
    [WHEAT_SEEDS]: seedsNeeded,
    [WATER_BUCKET]: 1,
    [DIRT]: maxDirtNeeded,
    [SHOVEL_TYPES[0]]: 1,
    [PICKAXE_TYPES[0]]: 1,
    [CRAFTING_TABLE]: 1,
  };
  farmingTaskDetails.missingItems = {};
  let canCraftHoe = false,
    canCraftBucket = false,
    canCraftTable = false,
    needsCraftingTable = false;
  if (!findBestTool(HOE_TYPES)) {
    if (canCraftItem(HOE_TYPES[1]) || canCraftItem(HOE_TYPES[0])) {
      canCraftHoe = true;
      needsCraftingTable = true;
    } else {
      farmingTaskDetails.missingItems[HOE_TYPES[0]] = 1;
    }
  }
  const seedCount = bot.inventory.count(mcData.itemsByName[WHEAT_SEEDS].id);
  if (seedCount < seedsNeeded)
    farmingTaskDetails.missingItems[WHEAT_SEEDS] = seedsNeeded - seedCount;
  if (bot.inventory.count(mcData.itemsByName[WATER_BUCKET].id) === 0) {
    if (canCraftItem(WATER_BUCKET)) {
      canCraftBucket = true;
      needsCraftingTable = true;
    } else {
      farmingTaskDetails.missingItems[WATER_BUCKET] = 1;
    }
  }
  if (
    needsCraftingTable &&
    bot.inventory.count(mcData.itemsByName[CRAFTING_TABLE].id) === 0 &&
    !bot.findBlock({
      matching: mcData.blocksByName[CRAFTING_TABLE].id,
      maxDistance: 5,
    })
  ) {
    if (canCraftItem(CRAFTING_TABLE)) canCraftTable = true;
    else farmingTaskDetails.missingItems[CRAFTING_TABLE] = 1;
  }
  console.log("[Farm Wheat] Initial resource check done.");
  console.log("Missing (potential):", farmingTaskDetails.missingItems);
  console.log(
    `Can craft: Hoe=${canCraftHoe}, Bucket=${canCraftBucket}, Table=${canCraftTable}`
  );
  const needToCraft = canCraftHoe || canCraftBucket || canCraftTable;
  const hasMissingItemsCannotCraft =
    Object.keys(farmingTaskDetails.missingItems).length > 0;
  if (needToCraft) return "crafting_tools";
  else if (hasMissingItemsCannotCraft) return "begging";
  else return "finding_build_location";
}
async function handleCraftingToolsStage() {
  console.log("[Farm Wheat] Attempting craft...");
  let craftedSomething = false;
  let tableToUse = null;
  const needsHoe =
    !findBestTool(HOE_TYPES) &&
    (canCraftItem(HOE_TYPES[1]) || canCraftItem(HOE_TYPES[0]));
  const needsBucket =
    bot.inventory.count(mcData.itemsByName[WATER_BUCKET].id) === 0 &&
    canCraftItem(WATER_BUCKET);
  const needsTableForTools = needsHoe || needsBucket;
  const needsPlaceTable =
    needsTableForTools &&
    bot.inventory.count(mcData.itemsByName[CRAFTING_TABLE].id) === 0 &&
    !bot.findBlock({
      matching: mcData.blocksByName[CRAFTING_TABLE].id,
      maxDistance: 5,
    });
  const needsCraftTableItem = needsPlaceTable && canCraftItem(CRAFTING_TABLE);
  if (needsTableForTools) {
    tableToUse = bot.findBlock({
      matching: mcData.blocksByName[CRAFTING_TABLE].id,
      maxDistance: 5,
    });
    if (!tableToUse) {
      if (needsCraftTableItem) {
        const r = bot.recipesFor(
          mcData.itemsByName[CRAFTING_TABLE].id,
          null,
          1,
          null
        )[0];
        if (r)
          try {
            await bot.craft(r, 1, null);
            craftedSomething = true;
          } catch (e) {
            console.error(`Craft table fail: ${e.message}`);
          }
      }
      const item = bot.inventory.findInventoryItem(
        mcData.itemsByName[CRAFTING_TABLE].id
      );
      if (item)
        if (await placeBlockNearBot(item)) {
          await sleep(300);
          tableToUse = bot.findBlock({
            matching: mcData.blocksByName[CRAFTING_TABLE].id,
            maxDistance: 3,
          });
          if (tableToUse)
            console.log(`Placed table ${formatVec3(tableToUse.position)}`);
          else console.warn("Placed table but couldn't find.");
        } else console.warn("Fail place table.");
    }
    if (!tableToUse && needsTableForTools) {
      console.warn("No table. Cannot craft.");
      farmingTaskDetails.missingItems = {};
      if (!findBestTool(HOE_TYPES))
        farmingTaskDetails.missingItems[HOE_TYPES[0]] = 1;
      if (bot.inventory.count(mcData.itemsByName[WATER_BUCKET].id) === 0)
        farmingTaskDetails.missingItems[WATER_BUCKET] = 1;
      return "begging";
    }
    if (tableToUse)
      console.log(`Using table ${formatVec3(tableToUse.position)}`);
  }
  if (needsHoe && tableToUse) {
    let r = null;
    if (canCraftItem(HOE_TYPES[1]))
      r = bot.recipesFor(
        mcData.itemsByName[HOE_TYPES[1]].id,
        null,
        1,
        tableToUse
      )[0];
    if (!r && canCraftItem(HOE_TYPES[0]))
      r = bot.recipesFor(
        mcData.itemsByName[HOE_TYPES[0]].id,
        null,
        1,
        tableToUse
      )[0];
    if (r) {
      console.log(`Crafting ${r.result.name}`);
      try {
        await bot.craft(r, 1, tableToUse);
        craftedSomething = true;
      } catch (e) {
        console.error(`Craft hoe fail: ${e.message}`);
      }
    }
  }
  if (needsBucket && tableToUse) {
    const r = bot.recipesFor(
      mcData.itemsByName[WATER_BUCKET].id,
      null,
      1,
      tableToUse
    )[0];
    if (r) {
      console.log("Crafting bucket");
      try {
        await bot.craft(r, 1, tableToUse);
        craftedSomething = true;
      } catch (e) {
        console.error(`Craft bucket fail: ${e.message}`);
      }
    }
  }
  console.log("Finished craft attempts.");
  return "checking_build_resources";
}
async function handleBeggingStage() {
  const checkResultStage = await handleCheckBuildResourcesStage();
  if (checkResultStage !== "begging") return checkResultStage;
  if (Object.keys(farmingTaskDetails.missingItems).length === 0)
    return "finding_build_location";
  if (farmingTaskDetails.beggingTarget) return "begging";
  console.log("Starting begging for:", farmingTaskDetails.missingItems);
  const targetUsername = farmingTaskDetails.initiatingUsername;
  if (!targetUsername) return "failed";
  const playerToBeg = bot.players[targetUsername]?.entity;
  if (
    !playerToBeg ||
    !playerToBeg.isValid ||
    playerToBeg.position.distanceTo(bot.entity.position) > BEGGING_RADIUS
  ) {
    console.log(`${targetUsername} not found/far.`);
    bot.chat(`Không thấy bạn (${targetUsername}) gần đây.`);
    return "failed";
  }
  console.log(`Found ${targetUsername} nearby.`);
  farmingTaskDetails.beggingTarget = targetUsername;
  if (!(await goToPosition(playerToBeg.position, 3))) {
    bot.chat(`Không tới gần ${targetUsername} được.`);
    farmingTaskDetails.beggingTarget = null;
    return "failed";
  }
  let requestMsg = `${targetUsername}, tôi cần làm ruộng 7x3 và thiếu: `;
  const missingList = [];
  for (const itemName in farmingTaskDetails.missingItems) {
    if (farmingTaskDetails.missingItems[itemName] > 0)
      missingList.push(
        `${farmingTaskDetails.missingItems[itemName]} ${itemName.replace(
          /_/g,
          " "
        )}`
      );
    else delete farmingTaskDetails.missingItems[itemName];
  }
  if (missingList.length === 0) {
    farmingTaskDetails.beggingTarget = null;
    return "finding_build_location";
  }
  requestMsg += missingList.join(", ") + ". Giúp được không?";
  bot.chat(requestMsg);
  console.log(`Requested items. Waiting ${BEGGING_TIMEOUT_MS / 1000}s...`);
  bot.on("playerCollect", handleFarmBeggingCollect);
  farmingTaskDetails.beggingTimeoutId = setTimeout(() => {
    if (!farmingTaskDetails.beggingTimeoutId) return;
    console.log("Begging timed out.");
    bot.removeListener("playerCollect", handleFarmBeggingCollect);
    const currentTarget = farmingTaskDetails.beggingTarget;
    farmingTaskDetails.beggingTarget = null;
    farmingTaskDetails.beggingTimeoutId = null;
    if (Object.keys(farmingTaskDetails.missingItems).length > 0) {
      if (currentTarget)
        bot.chat(`${currentTarget}, hết giờ chờ rồi... Thôi vậy.`);
      farmingTaskDetails.stage = "failed";
    } else {
      if (currentTarget) bot.chat(`Cảm ơn ${currentTarget}! Đủ đồ rồi.`);
      farmingTaskDetails.stage = "finding_build_location";
    }
  }, BEGGING_TIMEOUT_MS);
  return "begging";
}
function handleFarmBeggingCollect(collector, collectedEntity) {
  if (
    !farmingTaskDetails.beggingTarget ||
    collector !== bot.entity ||
    collectedEntity.type !== "item"
  )
    return;
  const item = collectedEntity.getDroppedItem();
  if (
    !item ||
    !farmingTaskDetails.missingItems ||
    !farmingTaskDetails.missingItems[item.name]
  )
    return;
  const itemName = item.name;
  const count = item.count || 1;
  console.log(`[Begging] Collected ${count} ${itemName}.`);
  farmingTaskDetails.missingItems[itemName] -= count;
  if (farmingTaskDetails.missingItems[itemName] <= 0) {
    delete farmingTaskDetails.missingItems[itemName];
    console.log(`Req ${itemName} met.`);
  }
  if (Object.keys(farmingTaskDetails.missingItems).length === 0) {
    console.log("All items collected!");
    bot.removeListener("playerCollect", handleFarmBeggingCollect);
    if (farmingTaskDetails.beggingTimeoutId) {
      clearTimeout(farmingTaskDetails.beggingTimeoutId);
      farmingTaskDetails.beggingTimeoutId = null;
    }
    const target = farmingTaskDetails.beggingTarget;
    farmingTaskDetails.beggingTarget = null;
    if (target) bot.chat(`Cảm ơn ${target}! Đủ đồ rồi.`);
    farmingTaskDetails.stage = "finding_build_location";
  }
}
function handleBeggingRefusal(username) {
  if (farmingTaskDetails.beggingTarget === username) {
    console.log(`${username} refused.`);
    bot.removeListener("playerCollect", handleFarmBeggingCollect);
    if (farmingTaskDetails.beggingTimeoutId) {
      clearTimeout(farmingTaskDetails.beggingTimeoutId);
      farmingTaskDetails.beggingTimeoutId = null;
    }
    bot.chat(`Ồ, tiếc quá ${username}. Vậy thôi.`);
    farmingTaskDetails.beggingTarget = null;
    farmingTaskDetails.stage = "failed";
  }
}
async function handleFindingBuildLocationStage() {
    console.log(`[Farm Wheat] Searching for flat ${CHECK_AREA_LENGTH}x${CHECK_AREA_WIDTH} area...`);
    const searchCenter = bot.entity.position; let bestLocation = null; let minScore = Infinity;
    const buildSearchRadius = farmingTaskDetails.buildSearchRadius;
    const potentialAnchors = bot.findBlocks({ point: searchCenter, matching: mcData.blocksByName[GRASS_BLOCK].id, maxDistance: buildSearchRadius, count: 500 })
                           .concat(bot.findBlocks({ point: searchCenter, matching: mcData.blocksByName[DIRT].id, maxDistance: buildSearchRadius, count: 500 }));
    if (potentialAnchors.length === 0) { bot.chat("Không thấy đất/cỏ gần đây để xây."); return 'failed'; }
    console.log(`Evaluating ${potentialAnchors.length} potential anchors...`);
    for (const locVec of potentialAnchors) {
         if(farmingTaskDetails.stopRequested) return 'failed';
        const potentialCenter = locVec.offset(0, 1, 0);
        const {averageY, deviation, needsFlattening} = await checkAreaFlatness(potentialCenter, CHECK_AREA_LENGTH, CHECK_AREA_WIDTH);
        const lightScore = await checkLightLevel(potentialCenter);
        const waterScore = await checkNearbyWater(potentialCenter);
        let score = deviation * 100 + lightScore + waterScore;
        if(deviation > FLATNESS_THRESHOLD * 5) score += 1000;
        if (averageY !== null && score < minScore) {
            minScore = score;
            farmingTaskDetails.buildLocation = locVec.floored().offset(-WATER_CENTER_OFFSET_X, 0, -WATER_CENTER_OFFSET_Z);
            farmingTaskDetails.buildTargetY = Math.round(averageY);
            // Lưu kết quả check sơ bộ (dù không dùng để quyết định stage tiếp theo nữa)
            farmingTaskDetails.flatCheckResult = { needsFlattening, deviation };
        }
    }

    if (farmingTaskDetails.buildLocation && minScore < 1500) { // Vẫn dùng score để chọn vị trí tốt nhất
        console.log(`Found location base ${formatVec3(farmingTaskDetails.buildLocation)} @Y=${farmingTaskDetails.buildTargetY} (Score: ${minScore.toFixed(1)}, InitialCheckNeedsFlatten: ${farmingTaskDetails.flatCheckResult?.needsFlattening}).`);

        // *** THAY ĐỔI QUAN TRỌNG Ở ĐÂY ***
        // Luôn đi tới stage preparing_area để kiểm tra và chuẩn bị kỹ lưỡng
        bot.chat("Tìm được chỗ rồi, đang kiểm tra và chuẩn bị khu vực...");
        return 'preparing_area';
        // **********************************

        /* Bỏ đoạn code cũ quyết định dựa trên needsFlattening
        if (farmingTaskDetails.flatCheckResult?.needsFlattening) {
            bot.chat("Tìm được chỗ rồi, cần dọn dẹp/làm phẳng...");
             farmingTaskDetails.flatteningAttempts = 0;
            return 'flattening'; // Không cần stage flattening riêng nữa nếu prep làm hết
        } else {
             bot.chat("Tìm được chỗ đẹp rồi, chuẩn bị xây!");
            return 'preparing_area';
        }
        */
    } else {
        console.log(`No suitable location found (Min score: ${minScore}).`);
        bot.chat("Không tìm được chỗ nào đủ tốt.");
        return 'failed';
    }
}
async function checkAreaFlatness(centerPos, checkLength, checkWidth) {
  const rL = Math.floor(checkLength / 2);
  const rW = Math.floor(checkWidth / 2);
  let ySum = 0;
  let blockCount = 0;
  let heights = [];
  let needsFlattening = false;
  let minY = Infinity,
    maxY = -Infinity;
  for (let dx = -rL; dx <= rL; dx++) {
    for (let dz = -rW; dz <= rW; dz++) {
      if (farmingTaskDetails.stopRequested)
        return { averageY: null, deviation: Infinity, needsFlattening: true };
      const checkPos = centerPos.offset(dx, -1, dz);
      const block = bot.blockAt(checkPos);
      if (!block)
        return { averageY: null, deviation: Infinity, needsFlattening: true };
      const y = block.position.y;
      heights.push(y);
      ySum += y;
      blockCount++;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const blockAbove = bot.blockAt(checkPos.offset(0, 1, 0));
      if (
        (block.name !== DIRT &&
          block.name !== GRASS_BLOCK &&
          block.boundingBox !== "empty") ||
        (blockAbove &&
          blockAbove.boundingBox !== "empty" &&
          blockAbove.name !== AIR)
      ) {
        needsFlattening = true;
      }
    }
  }
  if (blockCount === 0)
    return { averageY: null, deviation: Infinity, needsFlattening: true };
  const averageY = ySum / blockCount;
  const variance =
    heights.reduce((acc, h) => acc + Math.pow(h - averageY, 2), 0) / blockCount;
  const deviation = Math.sqrt(variance);
  if (deviation > FLATNESS_THRESHOLD || maxY - minY > 1) {
    needsFlattening = true;
  }
  return { averageY, deviation, needsFlattening };
}
async function checkLightLevel(centerPos) {
  const headPos = centerPos.offset(0, 1, 0);
  const blockAtHead = bot.blockAt(headPos);
  if (blockAtHead) {
    const sky = blockAtHead.skyLight ?? 0;
    const blockL = blockAtHead.light ?? 0;
    return sky < 9 && blockL < 9 ? 20 : 0;
  }
  return 20;
}
async function checkNearbyWater(centerPos) {
  const waterNearby = bot.findBlock({
    matching: mcData.blocksByName[WATER].id,
    point: centerPos,
    maxDistance: 4.5,
    count: 1,
  });
  return waterNearby ? 0 : 30;
}
async function handleFlatteningStage() {
  const basePos = farmingTaskDetails.buildLocation;
  const targetY = farmingTaskDetails.buildTargetY;
  if (!basePos || targetY === null) return "failed";
  farmingTaskDetails.flatteningAttempts++;
  console.log(
    `[Farm Wheat] Flattening attempt #${
      farmingTaskDetails.flatteningAttempts
    } for ${CHECK_AREA_LENGTH}x${CHECK_AREA_WIDTH} area at Y=${targetY}, base ${formatVec3(
      basePos
    )}...`
  );
  farmingTaskDetails.missingItems = {};
  if (!findBestTool(SHOVEL_TYPES) && !findBestTool(PICKAXE_TYPES)) {
    farmingTaskDetails.missingItems[SHOVEL_TYPES[0]] = 1;
    farmingTaskDetails.missingItems[PICKAXE_TYPES[0]] = 1;
  }
  if (Object.keys(farmingTaskDetails.missingItems).length > 0) {
    bot.chat("Cần xẻng/cuốc chim để làm phẳng!");
    return "begging";
  }
  if (
    !(await goToPosition(
      basePos.offset(CHECK_AREA_LENGTH / 2, 1, CHECK_AREA_WIDTH / 2),
      3
    ))
  ) {
    bot.chat("Không đến được khu vực cần làm phẳng.");
    return "failed";
  }
  let actionsTaken = 0;
  const rL = Math.floor(CHECK_AREA_LENGTH / 2);
  const rW = Math.floor(CHECK_AREA_WIDTH / 2);
  const centerBuildPos = basePos.offset(
    WATER_CENTER_OFFSET_X,
    0,
    WATER_CENTER_OFFSET_Z
  );
  for (let dx = -rL; dx <= rL; dx++) {
    for (let dz = -rW; dz <= rW; dz++) {
      if (farmingTaskDetails.stopRequested) return "failed";
      if (actionsTaken >= MAX_FLATTENING_BLOCKS) {
        console.log("[Flattening] Action limit reached. Re-evaluating.");
        return "finding_build_location";
      }
      const currentPos = centerBuildPos.offset(dx, 0, dz);
      for (let dy = 5; dy >= 1; dy--) {
        if (farmingTaskDetails.stopRequested) return "failed";
        const checkPosAbove = currentPos.offset(0, dy, 0);
        const blockAbove = bot.blockAt(checkPosAbove);
        if (
          blockAbove &&
          blockAbove.boundingBox !== "empty" &&
          blockAbove.name !== AIR
        ) {
          console.log(
            `[Flatten] Breaking ${blockAbove.name} at ${formatVec3(
              checkPosAbove
            )}`
          );
          try {
            await digBlock(blockAbove);
            farmingTaskDetails.stats.blocksBroken++;
            actionsTaken++;
            await sleep(ACTION_DELAY_MS);
          } catch (e) {
            console.warn(`Break fail: ${e.message}`);
          }
        }
      }
      const blockAtTarget = bot.blockAt(currentPos);
      if (!blockAtTarget) continue;
      const isWaterHole =
        dx >= -WATER_CENTER_OFFSET_X &&
        dx <= WATER_CENTER_OFFSET_X &&
        dz >= -WATER_CENTER_OFFSET_Z &&
        dz <= WATER_CENTER_OFFSET_Z &&
        (Math.abs(dx) + Math.abs(dz) <= 1 || (dx === 0 && dz === 0));
      if (isWaterHole) {
        if (blockAtTarget.name !== AIR) {
          console.log(
            `[Flatten] Breaking water hole ${
              blockAtTarget.name
            } at ${formatVec3(currentPos)}`
          );
          try {
            await digBlock(blockAtTarget);
            farmingTaskDetails.stats.blocksBroken++;
            actionsTaken++;
            await sleep(ACTION_DELAY_MS);
          } catch (e) {
            console.warn(`Break fail: ${e.message}`);
          }
        }
      } else {
        if (
          blockAtTarget.name === AIR ||
          blockAtTarget.boundingBox === "empty"
        ) {
          console.log(
            `[Flatten] Place dirt at ${formatVec3(currentPos)} (was ${
              blockAtTarget.name
            })`
          );
          const dirtId = mcData.itemsByName[DIRT].id;
          if (bot.inventory.count(dirtId) > 0) {
            if (await placeBlockAt(dirtId, currentPos)) {
              farmingTaskDetails.stats.blocksPlaced++;
              actionsTaken++;
              await sleep(ACTION_DELAY_MS);
            } else {
              console.warn("Place fail flatten.");
            }
          } else {
            bot.chat("Hết đất làm phẳng!");
            farmingTaskDetails.missingItems[DIRT] = 1;
            return "begging";
          }
        } else if (
          blockAtTarget.name !== DIRT &&
          blockAtTarget.name !== GRASS_BLOCK &&
          blockAtTarget.name !== FARMLAND
        ) {
          console.log(
            `[Flatten] Break wrong ${blockAtTarget.name} at ${formatVec3(
              currentPos
            )}`
          );
          try {
            await digBlock(blockAtTarget);
            farmingTaskDetails.stats.blocksBroken++;
            actionsTaken++;
            await sleep(ACTION_DELAY_MS);
          } catch (e) {
            console.warn(`Break fail: ${e.message}`);
          }
          console.log(
            `[Flatten] Place dirt after break at ${formatVec3(currentPos)}`
          );
          const dirtId = mcData.itemsByName[DIRT].id;
          if (bot.inventory.count(dirtId) > 0) {
            if (await placeBlockAt(dirtId, currentPos)) {
              farmingTaskDetails.stats.blocksPlaced++;
              actionsTaken++;
              await sleep(ACTION_DELAY_MS);
            } else {
              console.warn("Place fail after break.");
            }
          } else {
            bot.chat("Hết đất làm phẳng!");
            farmingTaskDetails.missingItems[DIRT] = 1;
            return "begging";
          }
        }
      }
      const blockBelow = bot.blockAt(currentPos.offset(0, -1, 0));
      if (!blockBelow) continue;
      if (isWaterHole) {
        if (blockBelow.boundingBox === "empty") {
          console.log(
            `[Flatten] Place foundation for water hole ${formatVec3(
              currentPos.offset(0, -1, 0)
            )}`
          );
          const dirtId = mcData.itemsByName[DIRT].id;
          if (bot.inventory.count(dirtId) > 0) {
            if (await placeBlockAt(dirtId, currentPos.offset(0, -1, 0))) {
              farmingTaskDetails.stats.blocksPlaced++;
              actionsTaken++;
              await sleep(ACTION_DELAY_MS);
            } else {
              console.warn("Place foundation fail.");
            }
          } else {
            bot.chat("Hết đất nền!");
            farmingTaskDetails.missingItems[DIRT] = 1;
            return "begging";
          }
        }
      } else {
        if (blockBelow.boundingBox === "empty") {
          console.log(
            `[Flatten] Place foundation for farm ${formatVec3(
              currentPos.offset(0, -1, 0)
            )}`
          );
          const dirtId = mcData.itemsByName[DIRT].id;
          if (bot.inventory.count(dirtId) > 0) {
            if (await placeBlockAt(dirtId, currentPos.offset(0, -1, 0))) {
              farmingTaskDetails.stats.blocksPlaced++;
              actionsTaken++;
              await sleep(ACTION_DELAY_MS);
            } else {
              console.warn("Place foundation fail.");
            }
          } else {
            bot.chat("Hết đất nền!");
            farmingTaskDetails.missingItems[DIRT] = 1;
            return "begging";
          }
        } else if (blockBelow.position.y > targetY - 1) {
          console.log(
            `[Flatten] Break high foundation ${blockBelow.name} at ${formatVec3(
              blockBelow.position
            )}`
          );
          try {
            await digBlock(blockBelow);
            farmingTaskDetails.stats.blocksBroken++;
            actionsTaken++;
            await sleep(ACTION_DELAY_MS);
          } catch (e) {
            console.warn(`Break fail: ${e.message}`);
          }
        }
      }
    }
  }
  console.log("[Flattening] Cycle complete. Re-evaluating...");
  return "finding_build_location";
}
async function handlePreparingAreaStage() {
  const basePos = farmingTaskDetails.buildLocation;
  if (!basePos) return "failed";
  const targetY = farmingTaskDetails.buildTargetY;
  if (targetY === null) return "failed";
  console.log(
    `[Farm Wheat] Verifying prepared 7x3 area at Y=${targetY}, base ${formatVec3(
      basePos
    )}...`
  );
  if (
    !(await goToPosition(
      basePos.offset(WATER_CENTER_OFFSET_X, 1, WATER_CENTER_OFFSET_Z),
      2
    ))
  )
    return "failed";
  const waterHoleCoords = new Set();
  const centerOffset = new Vec3(
    WATER_CENTER_OFFSET_X,
    0,
    WATER_CENTER_OFFSET_Z
  );
  waterHoleCoords.add(centerOffset.toString());
  waterHoleCoords.add(centerOffset.offset(1, 0, 0).toString());
  waterHoleCoords.add(centerOffset.offset(-1, 0, 0).toString());
  waterHoleCoords.add(centerOffset.offset(0, 0, 1).toString());
  waterHoleCoords.add(centerOffset.offset(0, 0, -1).toString());
  let verificationFailed = false;
  for (let dx = 0; dx < BUILD_FARM_LENGTH; dx++) {
    for (let dz = 0; dz < BUILD_FARM_WIDTH; dz++) {
      if (farmingTaskDetails.stopRequested) return "failed";
      const currentOffset = new Vec3(dx, 0, dz);
      const currentCoordStr = currentOffset.toString();
      const farmBlockPos = basePos.offset(dx, 0, dz);
      const blockAtTargetY = bot.blockAt(farmBlockPos);
      const blockBelowTargetY = bot.blockAt(farmBlockPos.offset(0, -1, 0));
      const blockAboveTargetY = bot.blockAt(farmBlockPos.offset(0, 1, 0));
      if (!blockAtTargetY || !blockBelowTargetY || !blockAboveTargetY) {
        console.error(
          `[Verify] Chunk data missing at ${formatVec3(farmBlockPos)}`
        );
        verificationFailed = true;
        break;
      }
      if (waterHoleCoords.has(currentCoordStr)) {
        if (blockAtTargetY.name !== AIR) {
          console.error(
            `[Verify] Water hole ${formatVec3(farmBlockPos)} not air! (${
              blockAtTargetY.name
            })`
          );
          verificationFailed = true;
          break;
        }
        if (blockBelowTargetY.boundingBox === "empty") {
          console.error(
            `[Verify] Below water hole ${formatVec3(
              farmBlockPos
            )} not solid! (${blockBelowTargetY.name})`
          );
          verificationFailed = true;
          break;
        }
        if (blockAboveTargetY.name !== AIR) {
          console.error(
            `[Verify] Above water hole ${formatVec3(farmBlockPos)} not air! (${
              blockAboveTargetY.name
            })`
          );
          verificationFailed = true;
          break;
        }
      } else {
        if (
          blockAtTargetY.name !== DIRT &&
          blockAtTargetY.name !== GRASS_BLOCK &&
          blockAtTargetY.name !== FARMLAND
        ) {
          console.error(
            `[Verify] Farm block ${formatVec3(
              farmBlockPos
            )} not dirt/grass/farmland! (${blockAtTargetY.name})`
          );
          verificationFailed = true;
          break;
        }
        if (blockBelowTargetY.boundingBox === "empty") {
          console.error(
            `[Verify] Below farm block ${formatVec3(
              farmBlockPos
            )} not solid! (${blockBelowTargetY.name})`
          );
          verificationFailed = true;
          break;
        }
        if (blockAboveTargetY.name !== AIR) {
          console.error(
            `[Verify] Above farm block ${formatVec3(farmBlockPos)} not air! (${
              blockAboveTargetY.name
            })`
          );
          verificationFailed = true;
          break;
        }
      }
    }
    if (verificationFailed) break;
  }
  if (verificationFailed) {
    bot.chat("Chuẩn bị khu vực thất bại!");
    return "failed";
  }
  console.log("[Prep] Area verification successful.");
  return "tilling";
}
async function handleTillingStage() {
  const basePos = farmingTaskDetails.buildLocation;
  if (!basePos) return "failed";
  const hoe = findBestTool(HOE_TYPES);
  if (!hoe) {
    farmingTaskDetails.missingItems = { [HOE_TYPES[0]]: 1 };
    bot.chat("Cần cuốc!");
    return "begging";
  }
  console.log(`Tilling 7x3 using ${hoe.name}...`);
  const waterHoleCoords = new Set();
  const centerOffset = new Vec3(
    WATER_CENTER_OFFSET_X,
    0,
    WATER_CENTER_OFFSET_Z
  );
  waterHoleCoords.add(centerOffset.toString());
  waterHoleCoords.add(centerOffset.offset(1, 0, 0).toString());
  waterHoleCoords.add(centerOffset.offset(-1, 0, 0).toString());
  waterHoleCoords.add(centerOffset.offset(0, 0, 1).toString());
  waterHoleCoords.add(centerOffset.offset(0, 0, -1).toString());
  try {
    await bot.equip(hoe.type, "hand");
    for (let dx = 0; dx < BUILD_FARM_LENGTH; dx++) {
      for (let dz = 0; dz < BUILD_FARM_WIDTH; dz++) {
        if (farmingTaskDetails.stopRequested) return "failed";
        const currentOffset = new Vec3(dx, 0, dz);
        const targetPos = basePos.offset(dx, 0, dz);
        if (waterHoleCoords.has(currentOffset.toString())) continue;
        const blockToTill = bot.blockAt(targetPos);
        if (
          blockToTill &&
          (blockToTill.name === DIRT || blockToTill.name === GRASS_BLOCK)
        ) {
          if (bot.entity.position.distanceTo(targetPos) > TILL_REACH)
            if (!(await goToPosition(targetPos, FARM_MOVE_GOAL_DIST))) continue;
          console.log(`Tilling at ${formatVec3(targetPos)}`);
          await bot.activateBlock(blockToTill);
          await sleep(250);
        } else if (blockToTill?.name === FARMLAND) {
          /* OK */
        } else {
          console.error(
            `[Tilling] Cannot till block at ${formatVec3(targetPos)}: ${
              blockToTill?.name ?? "null"
            }. Fail.`
          );
          bot.chat(`K xới đc đất ${formatVec3(targetPos)}!`);
          return "failed";
        }
      }
    }
  } catch (err) {
    console.error(`Error tilling: ${err.message}`);
    return "failed";
  }
  console.log("Tilling complete. Placing water.");
  return "placing_water";
}
async function handlePlacingWaterStage() {
  const basePos = farmingTaskDetails.buildLocation;
  if (!basePos) return "failed";
  const centerFarmPos = basePos.offset(
    WATER_CENTER_OFFSET_X,
    0,
    WATER_CENTER_OFFSET_Z
  );
  console.log("Placing water source...");
  if (bot.blockAt(centerFarmPos)?.name === WATER) {
    console.log("Water exists.");
    return "planting";
  }
  farmingTaskDetails.waterPlacementAttempts = 0;
  while (
    farmingTaskDetails.waterPlacementAttempts < MAX_WATER_PLACEMENT_ATTEMPTS
  ) {
    if (farmingTaskDetails.stopRequested) return "failed";
    farmingTaskDetails.waterPlacementAttempts++;
    console.log(
      `[Placing Water] Attempt #${farmingTaskDetails.waterPlacementAttempts}...`
    );
    const bucketItem = bot.inventory.findInventoryItem(
      mcData.itemsByName[WATER_BUCKET].id
    );
    if (!bucketItem) {
      farmingTaskDetails.missingItems = { [WATER_BUCKET]: 1 };
      bot.chat("Cần xô nước!");
      return "begging";
    }
    const blockBelowCenter = bot.blockAt(centerFarmPos.offset(0, -1, 0));
    if (!blockBelowCenter || !SOLID_GROUND_BLOCKS.has(blockBelowCenter.name)) {
      console.error(
        `[Placing Water] Block below center not solid! (${blockBelowCenter?.name})`
      );
      bot.chat("Nền giữa ruộng không vững!");
      return "failed";
    }
    if (!(await goToPosition(centerFarmPos, PLACE_REACH - 0.5))) {
      console.warn("Cannot move to center.");
      await sleep(1000);
      continue;
    }
    const centerBlock = bot.blockAt(centerFarmPos);
    if (centerBlock && centerBlock.name !== AIR && centerBlock.name !== WATER) {
      console.log(`Digging center ${centerBlock.name}...`);
      try {
        await digBlock(centerBlock);
        await sleep(400);
      } catch (e) {
        console.error(`Dig center fail: ${e.message}`);
        if (bot.blockAt(centerFarmPos)?.name !== AIR) {
          bot.chat("K phá đc khối giữa!");
          return "failed";
        }
      }
    } else if (centerBlock?.name === WATER) {
      console.log("Center became water. Success.");
      return "planting";
    } else {
      console.log("Center block is air.");
    }
    const finalCheckBelow = bot.blockAt(centerFarmPos.offset(0, -1, 0));
    const finalCheckAt = bot.blockAt(centerFarmPos);
    if (!finalCheckBelow || !SOLID_GROUND_BLOCKS.has(finalCheckBelow.name)) {
      console.error("Below block changed!");
      return "failed";
    }
    if (finalCheckAt?.name !== AIR) {
      console.error(`Target block not air! (${finalCheckAt?.name})`);
      await sleep(1000);
      continue;
    }
    console.log(`Placing water at ${formatVec3(centerFarmPos)}...`);
    try {
      await bot.equip(bucketItem.type, "hand");
      await bot.placeBlock(finalCheckBelow, new Vec3(0, 1, 0));
      await sleep(1000);
      if (bot.blockAt(centerFarmPos)?.name === WATER) {
        console.log("Water placed successfully.");
        return "planting";
      } else {
        console.warn("Water block did not appear. Retrying...");
      }
    } catch (err) {
      console.error(
        `Place water attempt #${farmingTaskDetails.waterPlacementAttempts} fail: ${err.message}`
      );
      if (bot.blockAt(centerFarmPos)?.name !== AIR)
        console.error(
          ` -> Target block was ${bot.blockAt(centerFarmPos)?.name}`
        );
      await sleep(1000);
    }
  }
  console.error(
    `[Placing Water] Failed after ${MAX_WATER_PLACEMENT_ATTEMPTS} attempts.`
  );
  bot.chat("Đặt nước thất bại nhiều lần!");
  return "failed";
}
async function handlePlantingStage() {
  const basePos = farmingTaskDetails.buildLocation;
  if (!basePos) return "failed";
  const seedItemId = mcData.itemsByName[WHEAT_SEEDS].id;
  const seedsNeeded = SEEDS_NEEDED_FOR_BUILD;
  if (bot.inventory.count(seedItemId) < seedsNeeded) {
    farmingTaskDetails.missingItems = {
      [WHEAT_SEEDS]: seedsNeeded - bot.inventory.count(seedItemId),
    };
    bot.chat(
      `Thiếu ${farmingTaskDetails.missingItems[WHEAT_SEEDS]} hạt giống!`
    );
    return "begging";
  }
  console.log("Planting seeds...");
  const waterHoleCoords = new Set();
  const centerOffset = new Vec3(
    WATER_CENTER_OFFSET_X,
    0,
    WATER_CENTER_OFFSET_Z
  );
  waterHoleCoords.add(centerOffset.toString());
  waterHoleCoords.add(centerOffset.offset(1, 0, 0).toString());
  waterHoleCoords.add(centerOffset.offset(-1, 0, 0).toString());
  waterHoleCoords.add(centerOffset.offset(0, 0, 1).toString());
  waterHoleCoords.add(centerOffset.offset(0, 0, -1).toString());
  try {
    await bot.equip(seedItemId, "hand");
    for (let dx = 0; dx < BUILD_FARM_LENGTH; dx++) {
      for (let dz = 0; dz < BUILD_FARM_WIDTH; dz++) {
        if (farmingTaskDetails.stopRequested) return "failed";
        const currentOffset = new Vec3(dx, 0, dz);
        const farmlandPos = basePos.offset(dx, 0, dz);
        if (waterHoleCoords.has(currentOffset.toString())) continue;
        const farmlandBlock = bot.blockAt(farmlandPos);
        const blockAbove = bot.blockAt(farmlandPos.offset(0, 1, 0));
        if (farmlandBlock?.name === FARMLAND && blockAbove?.name === AIR) {
          if (bot.entity.position.distanceTo(farmlandPos) > PLANT_REACH)
            if (!(await goToPosition(farmlandPos, FARM_MOVE_GOAL_DIST)))
              continue;
          if (bot.inventory.count(seedItemId) > 0) {
            console.log(`Planting at ${formatVec3(farmlandPos)}`);
            await bot.placeBlock(farmlandBlock, new Vec3(0, 1, 0));
            farmingTaskDetails.stats.seedsPlanted++;
          } else {
            console.error("Ran out of seeds!");
            return "failed";
          }
          await sleep(150);
        } else {
          if (farmlandBlock?.name !== FARMLAND)
            console.warn(
              `Cannot plant: ${formatVec3(farmlandPos)} is ${
                farmlandBlock?.name ?? "null"
              }`
            );
          else if (blockAbove?.name !== AIR)
            console.warn(
              `Cannot plant: Above ${formatVec3(farmlandPos)} is ${
                blockAbove?.name ?? "null"
              }`
            );
        }
      }
    }
  } catch (err) {
    console.error(`Error planting: ${err.message}`);
    return "failed";
  }
  console.log("Planting complete.");
  stopFarmingWheat("Hoàn thành xây ruộng", false);
  return "done";
}

// --- HELPER FUNCTIONS ---
async function findNearbyBlocks(
  blockName,
  radius,
  point = bot.entity.position,
  matchingFunction = null
) {
  const blockType = mcData.blocksByName[blockName];
  if (!blockType) return [];
  const blocks = bot.findBlocks({
    point: point,
    matching: (b) =>
      b &&
      b.type === blockType.id &&
      (!matchingFunction || matchingFunction(b)),
    maxDistance: radius,
    count: 900,
  });
  return blocks
    .map((p) => bot.blockAt(p))
    .filter((b) => b && b.position.distanceTo(point) <= radius);
}
async function goToPosition(targetPos, distance = 1) {
  if (!(targetPos instanceof Vec3)) {
    console.error(`Invalid targetPos:`, targetPos);
    return false;
  }
  try {
    const goal = new GoalNear(targetPos.x, targetPos.y, targetPos.z, distance);
    await pathfinder.goto(goal);
    return true;
  } catch (err) {
    if (err.message?.includes("Goal reached.")) return true;
    console.error(`Move error to ${formatVec3(targetPos)}: ${err.message}`);
    if (
      bot.entity &&
      bot.entity.position.distanceTo(targetPos) <= distance + 0.8
    ) {
      console.log("Close enough after error.");
      return true;
    }
    return false;
  }
}
async function collectSpecificItemsNear(position, itemNames) {
  if (!collectBlock) return;
  try {
    const entities = [];
    for (const id in bot.entities) {
      const e = bot.entities[id];
      if (
        e.type === "item" &&
        e.isValid &&
        e.position.distanceTo(position) <= COLLECT_RADIUS_FARM
      ) {
        const item = e.getDroppedItem();
        if (item && itemNames.includes(item.name)) entities.push(e);
      }
    }
    if (entities.length > 0) {
      console.log(
        `Collecting ${entities.length} items (${itemNames.join(
          "/"
        )}) near ${formatVec3(position)}...`
      );
      await collectBlock.collect(entities, { ignoreNoPath: true });
      await sleep(150);
    }
  } catch (err) {
    console.error(`Collect error: ${err.message}`);
  }
}
function findBestTool(toolTypes) {
  for (const name of toolTypes.slice().reverse()) {
    const item = bot.inventory.items().find((i) => i.name === name);
    if (item) return item;
  }
  return null;
}
function canCraftItem(itemName) {
  const itemType = mcData.itemsByName[itemName];
  if (!itemType) return false;
  const r1 = bot.recipesFor(itemType.id, null, 1, null) || [];
  const r2 = bot.recipesFor(itemType.id, null, 1, true) || [];
  return r1.length > 0 || r2.length > 0;
}
async function digBlock(blockToDig) {
  if (!blockToDig || blockToDig.boundingBox === "empty") return;
  const tool = bot.pathfinder.bestHarvestTool(blockToDig);
  if (tool) await bot.equip(tool, "hand");
  await bot.dig(blockToDig);
}
async function placeBlockAt(itemId, targetPos) {
  const item = bot.inventory.findInventoryItem(itemId);
  if (!item) {
    console.error(`Item ${itemId} not found.`);
    return false;
  }
  let refBlock = bot.blockAt(targetPos.offset(0, -1, 0));
  let faceVec = new Vec3(0, 1, 0);
  if (!refBlock || !SOLID_GROUND_BLOCKS.has(refBlock.name)) {
    const refs = [
      new Vec3(0, 0, -1),
      new Vec3(0, 0, 1),
      new Vec3(-1, 0, 0),
      new Vec3(1, 0, 0),
      new Vec3(0, 1, 0),
      new Vec3(0, -1, 0),
    ];
    let found = false;
    for (const off of refs) {
      const check = bot.blockAt(targetPos.minus(off));
      if (check?.boundingBox === "block") {
        refBlock = check;
        faceVec = off;
        found = true;
        break;
      }
    }
    if (!found) {
      console.error(`No valid ref block for ${formatVec3(targetPos)}`);
      return false;
    }
  }
  try {
    await bot.equip(item, "hand");
    await bot.placeBlock(refBlock, faceVec);
    return true;
  } catch (err) {
    console.error(
      `Place fail at ${formatVec3(targetPos)} ref ${formatVec3(
        refBlock.position
      )} vec ${formatVec3(faceVec)}: ${err.message}`
    );
    return false;
  }
}
async function placeBlockNearBot(item) {
  const held = bot.heldItem;
  if (!held || held.type !== item.type) {
    await bot.equip(item, "hand");
    await sleep(100);
  }
  const offs = [
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1),
  ];
  for (const off of offs) {
    const tPos = bot.entity.position.plus(off).floored();
    const bBelow = bot.blockAt(tPos.offset(0, -1, 0));
    const bAt = bot.blockAt(tPos);
    if (bBelow?.boundingBox === "block" && bAt?.boundingBox === "empty") {
      try {
        await bot.placeBlock(bBelow, new Vec3(0, 1, 0));
        return true;
      } catch (e) {
        console.warn(`Place near fail ${formatVec3(tPos)}: ${e.message}`);
      }
    }
  }
  return false;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function formatVec3(vec) {
  return vec
    ? `${vec.x.toFixed(1)}, ${vec.y.toFixed(1)}, ${vec.z.toFixed(1)}`
    : "null";
}

module.exports = {
  initialize: initializeFarmWheat,
  startFarmingWheat,
  stopFarmingWheat,
  handleBeggingRefusal,
  getIsFarming: () => isFarmingWheat,
};
