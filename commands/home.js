const { Vec3 } = require("vec3");
const {
  pathfinder,
  Movements,
  goals: { GoalNear, GoalBlock, GoalXZ, GoalY, GoalLookAtBlock, GoalPlaceBlock, GoalCompositeAny, GoalInvert, GoalFollow, GoalGetToBlock },
} = require("mineflayer-pathfinder");
const mcData = require("minecraft-data");
const { formatCoords, sleep } = require("../utils");

// --- CONFIGURATION CONSTANTS ---

// House Dimensions (Ensure these match blueprint or adjust logic)
// NOTE: Current blueprint seems 5x5 externally. These constants aren't directly used for blueprint placement sizing anymore.
const HOUSE_WIDTH = 5; // Adjusted to match blueprint observation
const HOUSE_DEPTH = 5; // Adjusted to match blueprint observation
// House Heights (Relative to floor Y=0) - Check blueprint layers
const HOUSE_HEIGHT_F1 = 3; // Ground floor walls seem 3 blocks high (layers 1, 2, 3)
const HOUSE_HEIGHT_ROOF_START = 4; // Roof starts at layer index 4

// Pathfinder & Action Settings
const TARGET_FLOOR_Y_OFFSET = -1; // Build floor 1 block below player's feet when starting
const MAX_RETRIES_PLACE_BLOCK = 3;
const MAX_RETRIES_PATHFINDING = 3;
const MAX_RETRIES_DIG = 3;
const MAX_RESOURCE_SEARCH_DIST = 128;
const MAX_FUNCTIONAL_BLOCK_SEARCH_DIST = 32;
const TORCH_PLACEMENT_INTERVAL = 4; // Place torch every N blocks in walls (if enabled - currently not used)
const INVENTORY_FULL_THRESHOLD = 3; // Slots free before considering inventory full
const MAX_SCAFFOLD_HEIGHT_DIFF = 12;
const SCAFFOLD_MATERIAL_PRIORITY = ["dirt", "cobblestone", "netherrack", "oak_planks"]; // Added planks as fallback
const MAX_NEARBY_MOB_DIST_SQ = 10 * 10;
const PAUSE_ON_MOB_DETECTED_TICKS = 10;
const ESCAPE_DISTANCE = 12;
const PAUSE_BUILDING_AT_NIGHT = false; // Set to true to pause at night
const MAX_TEMP_CHESTS = 5;

// --- MATERIAL CONSTANTS (Aligned with Oak Blueprint) ---
const PRIMARY_LOG_TYPE = "oak_log";
const PRIMARY_PLANKS_TYPE = "oak_planks";
const PRIMARY_DOOR_TYPE = "oak_door";
const PRIMARY_STAIRS_TYPE = "oak_stairs";
const PRIMARY_SLAB_TYPE = "oak_slab"; // Matches blueprint roof
const FENCE_TYPE = "oak_fence"; // Keep consistent, though not in blueprint

// Materials explicitly used in the blueprint or common needs
const ROOF_MATERIAL_SLAB = PRIMARY_SLAB_TYPE;
const FLOOR_MATERIAL = "cobblestone"; // Blueprint uses cobblestone for layer 0
const WALL_CORNER_MATERIAL = PRIMARY_LOG_TYPE; // Oak logs at corners
const WALL_FILL_MATERIAL = PRIMARY_PLANKS_TYPE; // Oak planks for walls
const WINDOW_MATERIAL = "glass_pane";
const FOUNDATION_MATERIAL = "cobblestone"; // Layer 0

// Functional Blocks & Crafting Items
const CRAFTING_TABLE_TYPE = "crafting_table";
const FURNACE_TYPE = "furnace";
const CHEST_TYPE = "chest";
const COBBLESTONE_TYPE = "cobblestone";
const COAL_TYPE = "coal";
const CHARCOAL_TYPE = "charcoal";
const SAND_TYPE = "sand";
const GLASS_TYPE = "glass";
const STICK_TYPE = "stick";
const TORCH_TYPE = "torch";

// Tools & Priority
const WOODEN_AXE = "wooden_axe";
const STONE_AXE = "stone_axe";
const WOODEN_PICKAXE = "wooden_pickaxe";
const STONE_PICKAXE = "stone_pickaxe";
const WOODEN_SHOVEL = "wooden_shovel";
const STONE_SHOVEL = "stone_shovel";
const AXE_PRIORITY = [STONE_AXE, WOODEN_AXE];
const PICKAXE_PRIORITY = [STONE_PICKAXE, WOODEN_PICKAXE];
const SHOVEL_PRIORITY = [STONE_SHOVEL, WOODEN_SHOVEL];

// Furniture Positions (Relative to the build corner, Y=0 is the floor level)
// Note: Blueprint places these directly, this might be redundant or for future use.
// Adjust X/Z based on the 5x5 blueprint structure if needed.
const FURNITURE_POSITIONS = {
  CRAFTING_TABLE: new Vec3(1, 1, 4), // Match blueprint layer 1, pos [4][1] relative to corner(0,0)
  FURNACE: new Vec3(2, 1, 4),        // Match blueprint layer 1, pos [4][2] relative to corner(0,0)
  CHEST_1: new Vec3(3, 2, 4),        // Match blueprint layer 2, pos [4][2] relative to corner(0,0) (assuming double chest)
  CHEST_2: new Vec3(2, 2, 4),        // Match blueprint layer 2, pos [4][3] relative to corner(0,0)
  // STAIRS_START: new Vec3(1, 0, HOUSE_DEPTH - 2), // Not used, stairs are part of blueprint
};

// --- HOUSE BLUEPRINT (5x5 Oak/Cobble Design) ---
const houseBlueprint = [
  // Layer 0 (Y=0 relative to corner) - Foundation/Floor
  [ // Z=0
    ["cobblestone", "cobblestone", "cobblestone", "cobblestone", "cobblestone"], // X=0 to 4
    ["cobblestone", "cobblestone", "cobblestone", "cobblestone", "cobblestone"], // Z=1
    ["cobblestone", "cobblestone", "cobblestone", "cobblestone", "cobblestone"], // Z=2
    ["cobblestone", "cobblestone", "cobblestone", "cobblestone", "cobblestone"], // Z=3
    ["cobblestone", "cobblestone", "cobblestone", "cobblestone", "cobblestone"]  // Z=4
  ],
  // Layer 1 (Y=1) - Walls Base
  [
    ["oak_log",      "oak_planks",   "glass_pane",   "oak_planks",   "oak_log"],      // Z=0
    ["oak_planks",   null,           null,           null,           "oak_planks"],   // Z=1
    ["glass_pane",   null,           null,           null,           {name: PRIMARY_DOOR_TYPE, state: {half: "lower", facing: "west", hinge: "right"}}], // Z=2 (Door on West side)
    ["oak_planks",   null,           null,           null,           "oak_planks"],   // Z=3
    ["oak_log",      "crafting_table", "furnace",    "oak_planks",   "oak_log"]       // Z=4 (Crafting/Furnace on East side)
  ],
  // Layer 2 (Y=2) - Walls Mid
  [
    ["oak_log",      "oak_planks",   "glass_pane",   "oak_planks",   "oak_log"],      // Z=0
    ["oak_planks",   null,           null,           null,           "oak_planks"],   // Z=1
    ["glass_pane",   null,           null,           null,           {name: PRIMARY_DOOR_TYPE, state: {half: "upper", facing: "west", hinge: "right"}}], // Z=2
    ["oak_planks",   null,           null,           null,           "oak_planks"],   // Z=3
    ["oak_log",      "oak_planks",   "chest",        "chest",        "oak_log"]       // Z=4 (Chests on East side)
  ],
  // Layer 3 (Y=3) - Walls Top / Ceiling Base
  [
    ["oak_log",      "oak_planks",   "oak_planks",   "oak_planks",   "oak_log"],      // Z=0
    ["oak_planks",   "oak_planks",   "oak_planks",   "oak_planks",   "oak_planks"],   // Z=1
    ["oak_planks",   "oak_planks",   "oak_planks",   "oak_planks",   "oak_planks"],   // Z=2
    ["oak_planks",   "oak_planks",   "oak_planks",   "oak_planks",   "oak_planks"],   // Z=3
    ["oak_log",      "oak_planks",   "oak_planks",   "oak_planks",   "oak_log"]       // Z=4
  ],
 // Layer 4 (Y=4) - Roof Start (Stairs)
  [
    ["air", {name:PRIMARY_STAIRS_TYPE, state:{facing:"south", shape:"straight", half: "bottom"}}, {name:PRIMARY_STAIRS_TYPE, state:{facing:"south", shape:"straight", half: "bottom"}}, {name:PRIMARY_STAIRS_TYPE, state:{facing:"south", shape:"straight", half: "bottom"}}, "air"], // Z=0, South facing stairs
    [{name:PRIMARY_STAIRS_TYPE, state:{facing:"east", shape:"straight", half: "bottom"}}, "oak_planks", "oak_planks", "oak_planks", {name:PRIMARY_STAIRS_TYPE, state:{facing:"west", shape:"straight", half: "bottom"}}], // Z=1, E/W stairs, planks fill
    [{name:PRIMARY_STAIRS_TYPE, state:{facing:"east", shape:"straight", half: "bottom"}}, "oak_planks", "oak_planks", "oak_planks", {name:PRIMARY_STAIRS_TYPE, state:{facing:"west", shape:"straight", half: "bottom"}}], // Z=2
    [{name:PRIMARY_STAIRS_TYPE, state:{facing:"east", shape:"straight", half: "bottom"}}, "oak_planks", "oak_planks", "oak_planks", {name:PRIMARY_STAIRS_TYPE, state:{facing:"west", shape:"straight", half: "bottom"}}], // Z=3
    ["air", {name:PRIMARY_STAIRS_TYPE, state:{facing:"north", shape:"straight", half: "bottom"}}, {name:PRIMARY_STAIRS_TYPE, state:{facing:"north", shape:"straight", half: "bottom"}}, {name:PRIMARY_STAIRS_TYPE, state:{facing:"north", shape:"straight", half: "bottom"}}, "air"], // Z=4, North facing stairs
 ],
  // Layer 5 (Y=5) - Roof Peak (Slabs)
  [
    ["air", "air", {name:PRIMARY_SLAB_TYPE, state:{type:"bottom"}}, "air", "air"], // Z=0
    ["air", {name:PRIMARY_SLAB_TYPE, state:{type:"bottom"}}, {name:PRIMARY_SLAB_TYPE, state:{type:"bottom"}}, {name:PRIMARY_SLAB_TYPE, state:{type:"bottom"}}, "air"], // Z=1
    [{name:PRIMARY_SLAB_TYPE, state:{type:"bottom"}}, {name:PRIMARY_SLAB_TYPE, state:{type:"bottom"}}, {name:PRIMARY_SLAB_TYPE, state:{type:"bottom"}}, {name:PRIMARY_SLAB_TYPE, state:{type:"bottom"}}, {name:PRIMARY_SLAB_TYPE, state:{type:"bottom"}}], // Z=2 (Full slab line)
    ["air", {name:PRIMARY_SLAB_TYPE, state:{type:"bottom"}}, {name:PRIMARY_SLAB_TYPE, state:{type:"bottom"}}, {name:PRIMARY_SLAB_TYPE, state:{type:"bottom"}}, "air"], // Z=3
    ["air", "air", {name:PRIMARY_SLAB_TYPE, state:{type:"bottom"}}, "air", "air"], // Z=4
  ],
];


// --- STATE VARIABLES ---
let mc; // minecraft-data instance
let botRef; // Reference to the bot object
let temporaryChests = []; // Array of Vec3 positions
let scaffoldBlocksPlaced = []; // Array of Vec3 positions
let isEvading = false; // Flag for mob evasion state

// --- HELPER FUNCTIONS ---

function logBuild(level, message) {
  if (!botRef) return;
  const state = botRef.buildingState || "UNKNOWN";
  const prefix = `[Build][${state}]`;
  if (level === 'error') { console.error(`${prefix} !!! ERROR: ${message}`); }
  else if (level === 'warn') { console.warn(`${prefix} WARN: ${message}`); }
  else { console.log(`${prefix} ${message}`); }
}

function getItemCount(itemName) {
  if (!botRef || !mc) return 0;
  const item = mc.itemsByName[itemName] || mc.blocksByName[itemName];
  if (!item) return 0;
  // Sum across all inventory slots
  return botRef.inventory.items().reduce((count, itemInSlot) => {
      if (itemInSlot.type === item.id) {
          return count + itemInSlot.count;
      }
      return count;
  }, 0);
}

function shouldStopTask() {
    return !botRef || !botRef.isBuilding;
}

// Check for night pause or nearby hostiles
async function checkSafetyAndStop() {
    if (!botRef || !botRef.isBuilding) return true; // Stop if building task is cancelled
    if (isEvading) return true; // Don't interrupt evasion

    // Night Pause Check
    if (PAUSE_BUILDING_AT_NIGHT && botRef.time.isNight && botRef.buildingState !== 'PAUSED_NIGHT') {
        logBuild('warn', "Trời tối, tạm dừng xây dựng...");
        botRef.buildingState = 'PAUSED_NIGHT';
        if (botRef.pathfinder?.isMoving()) botRef.pathfinder.stop();
        botRef.clearControlStates();
        // Optional: Move to a safe spot? For now, just stops.
        return true; // Signal to stop current action
    }
    // Resume from Night Pause
    if (botRef.buildingState === 'PAUSED_NIGHT' && botRef.time.isDay) {
        logBuild('info', "Trời sáng, có thể tiếp tục (cần khởi động lại task hoặc chờ vòng lặp tiếp theo).");
        botRef.buildingState = 'IDLE'; // Reset state, main loop should pick up
        // Don't return true here, let the main loop decide the next action
    }
    // Still paused at night
    if (botRef.buildingState === 'PAUSED_NIGHT') return true;

    // Hostile Mob Check
    const nearestHostile = findNearestHostile();
    if (nearestHostile) {
        isEvading = true;
        const prevState = botRef.buildingState;
        botRef.buildingState = 'EVADING_MOB';
        logBuild('warn', `Phát hiện ${nearestHostile.name}! Cố gắng chạy trốn...`);
        if (botRef.pathfinder?.isMoving()) botRef.pathfinder.stop();
        botRef.clearControlStates();

        const botPos = botRef.entity.position;
        const mobPos = nearestHostile.position;
        // Calculate escape direction away from the mob
        let escapeTargetPos = botPos.plus(botPos.minus(mobPos).normalize().scale(ESCAPE_DISTANCE));

        // Basic check if escape path is blocked directly in front
        const checkAheadPos = botPos.plus(botPos.minus(mobPos).normalize().scale(1.5));
        const blockInFrontHead = botRef.blockAt(checkAheadPos.offset(0,1,0));
        const blockInFrontFeet = botRef.blockAt(checkAheadPos);
        if((blockInFrontHead && blockInFrontHead.boundingBox === 'block') || (blockInFrontFeet && blockInFrontFeet.boundingBox === 'block')){
            logBuild('warn', "Hướng chạy trốn bị chặn, thử chạy sang ngang...");
            const escapeDir = botPos.minus(mobPos).normalize();
            const sideDir = escapeDir.cross(new Vec3(0, 1, 0)).normalize(); // Vector perpendicular to escape direction (horizontal plane)
            escapeTargetPos = botPos.plus(sideDir.scale(ESCAPE_DISTANCE));
        }

        const goal = new GoalNear(escapeTargetPos.x, escapeTargetPos.y, escapeTargetPos.z, 1);
        logBuild('info', `Mục tiêu chạy trốn: ${formatCoords(escapeTargetPos)}`);
        try {
            await botRef.pathfinder.goto(goal);
            logBuild('info', "Đã di chuyển chạy trốn.");
            await sleep(500); // Pause after evading
        } catch (evadeErr) {
            logBuild('warn', `Lỗi khi chạy trốn: ${evadeErr.message}. Tạm dừng tại chỗ.`);
            await sleep(PAUSE_ON_MOB_DETECTED_TICKS * 50); // Use 50ms per tick
        } finally {
            // Crucially, reset evasion flag and state regardless of success
            isEvading = false;
            // Only restore state if it wasn't changed by something else (like night pause)
            if(botRef.buildingState === 'EVADING_MOB') botRef.buildingState = prevState;
        }
        // Return true because an interruption (evasion) occurred.
        // The main loop should re-evaluate the situation after evasion attempt.
        return true;
    }

    // No safety issues found that require stopping
    return false;
}


function findNearestHostile() {
    if (!botRef || !botRef.entities) return null;
    let nearestHostile = null;
    let minDistSq = MAX_NEARBY_MOB_DIST_SQ; // Use squared distance for efficiency

    for (const entityId in botRef.entities) {
        const entity = botRef.entities[entityId];
        // Check if entity is hostile, alive, and not the bot itself
        if (entity.type === 'hostile' && entity.kind === 'Hostile mobs' && entity.isValid && entity !== botRef.entity) {
            const distSq = entity.position.distanceSquared(botRef.entity.position);
            if (distSq < minDistSq) {
                 // Line of sight check (optional but good)
                 const eyePos = botRef.entity.position.offset(0, botRef.entity.height, 0);
                 const targetPos = entity.position.offset(0, entity.height / 2, 0); // Target center mass approx
                 const vector = targetPos.subtract(eyePos);
                 try {
                     // Check slightly beyond the entity to avoid hitting self/close blocks
                     const raycastResult = botRef.world.raycast(eyePos, vector.normalize(), Math.sqrt(distSq) + 1);
                     // If raycast hit nothing or hit the target entity, it's visible
                     if (!raycastResult || raycastResult.entity === entity) {
                          minDistSq = distSq;
                          nearestHostile = entity;
                     }
                 } catch (rayErr) {
                     logBuild('warn', `Raycast error during mob check: ${rayErr.message}`);
                     // Optional: Treat raycast error as potentially visible? Or ignore? For safety, maybe consider it visible.
                     // minDistSq = distSq;
                     // nearestHostile = entity;
                 }
            }
        }
    }
    return nearestHostile;
}


async function equipItem(itemName) {
  if (shouldStopTask()) return false;
  const item = mc.itemsByName[itemName] || mc.blocksByName[itemName];
  if (!item) { logBuild('error', `Item not found in mcData: ${itemName}`); return false; }

  const itemInInv = botRef.inventory.findInventoryItem(item.id, null);
  if (!itemInInv) {
    // logBuild('debug', `Item ${itemName} not in inventory.`); // Too verbose maybe
    return false;
  }

  // Check if already held
  if (botRef.heldItem && botRef.heldItem.type === item.id) {
    // logBuild('debug', `Item ${itemName} already equipped.`);
    return true;
  }

  try {
    // logBuild('debug', `Equipping ${itemName}...`);
    await botRef.equip(itemInInv, "hand");
    await sleep(100); // Small delay for server to register equip
    // Verify equip
    if (botRef.heldItem && botRef.heldItem.type === item.id) {
      // logBuild('debug', `Equipped ${itemName} successfully.`);
      return true;
    } else {
        logBuild('warn', `Tried equipping ${itemName}, but verification failed. Held: ${botRef.heldItem?.name}`);
        await sleep(150); // Extra delay
        return botRef.heldItem?.type === item.id; // Re-check
    }
  } catch (err) {
    logBuild('error', `Equip error for ${itemName}: ${err.message}`);
    return false;
  }
}

async function findNearbyFunctionalBlock(blockName, maxDist = MAX_FUNCTIONAL_BLOCK_SEARCH_DIST) {
  if (shouldStopTask()) return null;
  const blockData = mc.blocksByName[blockName];
  if (!blockData) { logBuild('error', `Invalid block data for search: ${blockName}`); return null; }

  try {
    // logBuild('debug', `Searching for ${blockName} within ${maxDist} blocks...`);
    const block = await botRef.findBlock({
        matching: blockData.id,
        maxDistance: maxDist,
        count: 1
    });
    if (block) {
        logBuild('debug', `Found ${blockName} at ${formatCoords(block.position)}.`);
    } else {
        // logBuild('debug', `No ${blockName} found nearby.`);
    }
    return block;
  } catch (err) {
    // findBlock can sometimes throw if interrupted, treat as not found
    logBuild('warn', `Error during findBlock for ${blockName}: ${err.message}`);
    return null;
  }
}

async function digBlock(targetBlock, toolPriorityList = []) {
    if (shouldStopTask() || !targetBlock) return false;
    const blockInfo = mc.blocks[targetBlock.type];
    if (!blockInfo) { logBuild('warn', `Unknown block type at ${formatCoords(targetBlock.position)}`); return false; }
    // logBuild('info', `Attempting to dig ${blockInfo.name} at ${formatCoords(targetBlock.position)}`);

    if (await checkSafetyAndStop()) return false; // Safety check before interacting

    if (!targetBlock.diggable) {
        logBuild('warn', `${blockInfo.name} at ${formatCoords(targetBlock.position)} is not diggable.`);
        return false;
    }

    // Equip best tool
    let bestToolItem = null; // The actual Item object from inventory
    let toolEquipped = false;
    const availableTools = botRef.inventory.items().filter(i => toolPriorityList.includes(i.name));
    const bestHarvestToolInfo = mc.bestHarvestTool(targetBlock); // Get type ID of best tool

    if (bestHarvestToolInfo) {
        bestToolItem = availableTools.find(t => t.type === bestHarvestToolInfo.id);
    }
    // Fallback: if no specific best tool, just use any tool from the priority list if available
    if (!bestToolItem && availableTools.length > 0) {
        bestToolItem = availableTools[0]; // Pick the first one available from the priority list
    }

    if (bestToolItem) {
        // logBuild('debug', `Best tool for ${blockInfo.name} is ${bestToolItem.name}. Equipping...`);
        if (await equipItem(bestToolItem.name)) {
            toolEquipped = true;
        } else {
            logBuild('warn', `Failed to equip preferred tool ${bestToolItem.name}, attempting to dig without it.`);
        }
    } else if (toolPriorityList.length > 0) {
         // logBuild('debug', `No preferred tool from [${toolPriorityList.join(', ')}] available for ${blockInfo.name}.`);
    }

    // Check if diggable by hand if no tool equipped/needed
    if (!toolEquipped) {
        if (!mc.canDigBlock(targetBlock) || (targetBlock.material && !targetBlock.harvestTools)) {
             // This condition might be too strict, mc.canDigBlock should be enough?
             // Let's rely on bot.dig to fail if it's impossible.
             // logBuild('warn', `No suitable tool equipped and block ${blockInfo.name} might require one.`);
             // If no tool equipped, ensure nothing is held (or held item isn't blocking)
             if (botRef.heldItem) await botRef.unequip('hand');
        } else {
             // logBuild('debug', `Digging ${blockInfo.name} by hand.`);
        }
    }


    for (let attempt = 1; attempt <= MAX_RETRIES_DIG; attempt++) {
        if (shouldStopTask()) return false;
        if (await checkSafetyAndStop()) return false; // Check safety before each dig attempt

        try {
            // Check distance before digging
            const targetCenter = targetBlock.position.offset(0.5, 0.5, 0.5);
            if (botRef.entity.position.distanceTo(targetCenter) > 5.0) { // Standard block reach
                 logBuild('info', `Moving closer to ${blockInfo.name} at ${formatCoords(targetBlock.position)} to dig...`);
                 const goal = new GoalGetToBlock(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z); // Try to stand next to it
                 await botRef.pathfinder.goto(goal);
                 if (await checkSafetyAndStop()) return false; // Check safety after moving
            }

            // logBuild('debug', `Dig attempt ${attempt}/${MAX_RETRIES_DIG} for ${blockInfo.name}`);
            await botRef.dig(targetBlock);
            // Wait slightly longer than theoretical dig time, server lag etc.
            const waitTime = Math.max(300, (targetBlock.digTime(bestToolItem?.type) ?? 3000) * 1.2 + 100); // Add buffer, default 3 sec
            // logBuild('debug', `Waiting ${waitTime}ms for dig completion...`);
            await sleep(waitTime); // Wait for dig to potentially complete
            if (shouldStopTask()) return false;

            // Verify block is gone
            const blockAfter = botRef.blockAt(targetBlock.position);
            if (!blockAfter || blockAfter.type === mc.blocksByName.air.id || blockAfter.name === 'cave_air' || blockAfter.name === 'void_air') {
                logBuild('info', `Successfully dug ${blockInfo.name} at ${formatCoords(targetBlock.position)}.`);
                await sleep(50); // Short pause after successful dig
                return true;
            } else {
                logBuild('warn', `Dig attempt ${attempt} finished, but block ${blockInfo.name} still exists (found ${blockAfter.name}). Retrying...`);
            }
        } catch (err) {
            logBuild('error', `Error digging ${blockInfo.name} on attempt ${attempt}: ${err.message}`);
            // Check if block changed type during dig attempt
            const blockNow = botRef.blockAt(targetBlock.position);
            if (!blockNow || blockNow.type !== targetBlock.type) {
                logBuild('info', `Block at ${formatCoords(targetBlock.position)} changed type during dig attempt. Stopping dig.`);
                return false; // Block changed, don't retry on the original block
            }
        }
        // Wait before retrying
        if (attempt < MAX_RETRIES_DIG) await sleep(200 + attempt * 100);
    }

    logBuild('error', `Failed to dig ${blockInfo.name} at ${formatCoords(targetBlock.position)} after ${MAX_RETRIES_DIG} attempts.`);
    return false;
}

// Basic function to get player facing direction (N, S, E, W)
function getPlayerFacing(yaw) {
    const angle = yaw * 180 / Math.PI;
    // Normalize angle to be between 0 and 360
    const normalizedAngle = (angle % 360 + 360) % 360;
    if (normalizedAngle >= 315 || normalizedAngle < 45) return 'south';
    if (normalizedAngle >= 45 && normalizedAngle < 135) return 'west';
    if (normalizedAngle >= 135 && normalizedAngle < 225) return 'north';
    if (normalizedAngle >= 225 && normalizedAngle < 315) return 'east';
    return 'south'; // Default
}


// Calculate block state based on context (mostly for directional blocks)
// This is simplified, complex state calculations might need more context.
function calculateBlockState(targetPos, blockName, placeContext = {}) {
    const block = mc.blocksByName[blockName];
    if (!block) return null;

    // Use provided state directly if available
    if (placeContext.state) {
        return placeContext.state;
    }

    // Infer state for common blocks if not provided
    const state = {};
    const botYaw = botRef?.entity.yaw ?? 0; // Default to South if botRef not ready

    if (blockName.includes('_stairs')) {
        state.facing = placeContext.facing || getPlayerFacing(botYaw);
        state.half = placeContext.half || 'bottom';
        state.shape = placeContext.shape || 'straight';
        state.waterlogged = placeContext.waterlogged || false;
        return state;
    }
    if (blockName.includes('_slab')) {
        state.type = placeContext.type || 'bottom'; // 'top', 'double'
        state.waterlogged = placeContext.waterlogged || false;
        return state;
    }
     if (blockName.includes('_log') || blockName.includes('_pillar') || blockName.includes('_wood')) { // Covers logs, basalt, wood blocks
        // Axis depends on placement faceVector, difficult to guess without it.
        // Default to Y axis if placed vertically, or guess based on player facing?
        // This needs the faceVector from placeBlockAttempt ideally.
        // Let's default to Y axis for now, placeBlock should handle it better if faceVector is known.
        state.axis = placeContext.axis || 'y'; // 'x', 'y', 'z'
        return state;
    }
    if (blockName.includes('_door')) {
         state.facing = placeContext.facing || getPlayerFacing(botYaw);
        state.half = placeContext.half || 'lower';
        state.hinge = placeContext.hinge || 'left'; // 'right'
        state.open = placeContext.open || false;
        state.powered = placeContext.powered || false;
        return state;
    }
     if (blockName.includes('torch') ) {
         // Torches don't have a facing state in Java usually (wall torches do implicitly)
         // Vanilla Torch ('torch') goes on floor or wall. Wall torch has facing.
         // This might need specific handling based on `blockName` (e.g., 'wall_torch')
         return null; // Let placeBlock handle torch placement implicitly?
     }
    if (blockName.includes('chest')) {
         state.facing = placeContext.facing || getPlayerFacing(botYaw);
         state.type = placeContext.type || 'single'; // 'left', 'right' for double chests
         state.waterlogged = placeContext.waterlogged || false;
         // Note: Double chest logic needs placement check for adjacent chest.
         return state;
    }
     if (blockName === FURNACE_TYPE || blockName === 'blast_furnace' || blockName === 'smoker') {
         state.facing = placeContext.facing || getPlayerFacing(botYaw);
         state.lit = placeContext.lit || false;
         return state;
    }
     if (blockName === CRAFTING_TABLE_TYPE) {
         // Crafting table has no state
         return null;
     }

    // Return null if no specific state logic applies, let mc handle defaults
    return null;
}


async function placeBlockAttempt(targetPos, blockName, placeContext = {}) {
  if (await checkSafetyAndStop()) return false;

  const blockData = mc.blocksByName[blockName];
  const itemData = mc.itemsByName[blockName]; // Item might be different from block for some things

  if (!blockData) { logBuild('error', `Invalid block data for placement: ${blockName}`); return false; }
  if (!itemData) { logBuild('error', `Invalid item data for placement: ${blockName}`); return false; }

  // 1. Ensure Resource Exists
  if (getItemCount(blockName) < 1) {
    logBuild('error', `Out of ${blockName}! Cannot place.`);
    // Try to acquire the resource? Or just fail? For build task, assume resources were gathered.
    return false; // Fail placement if resource isn't present. EnsureResource should handle gathering.
  }

  // 2. Equip the Item
  if (!(await equipItem(blockName))) {
    logBuild('error', `Failed to equip ${blockName} for placement.`);
    return false;
  }
  if (await checkSafetyAndStop()) return false; // Check after equip

  // 3. Placement Loop
  for (let attempt = 1; attempt <= MAX_RETRIES_PLACE_BLOCK; attempt++) {
    if (await checkSafetyAndStop()) return false;
    logBuild('info', `Place attempt ${attempt}/${MAX_RETRIES_PLACE_BLOCK} for ${blockName} at ${formatCoords(targetPos)}`);

    const existingBlock = botRef.blockAt(targetPos);
    const desiredState = calculateBlockState(targetPos, blockName, placeContext); // Get desired state

    // 3a. Check if block already exists correctly
    if (existingBlock && existingBlock.type === blockData.id) {
        let stateMatches = true;
        if (desiredState) {
            for (const key in desiredState) {
                // Check if state exists on the block and compare (converting to string for safety)
                if (existingBlock.state && existingBlock.state[key] !== undefined && String(existingBlock.state[key]) !== String(desiredState[key])) {
                    logBuild('warn', `Existing ${blockName} state mismatch at ${formatCoords(targetPos)}. Key: '${key}' (Got: ${existingBlock.state[key]}, Want: ${desiredState[key]})`);
                    stateMatches = false;
                    break;
                }
            }
        }
        if (stateMatches) {
            logBuild('info', `${blockName} already exists correctly at ${formatCoords(targetPos)}.`);
            return true; // Success, block is already as desired
        } else {
             // Block exists but state is wrong. Try to break and replace?
             logBuild('warn', `Existing ${blockName} at ${formatCoords(targetPos)} has wrong state. Attempting to replace...`);
             if (!await digBlock(existingBlock)) { // Use default dig, no specific tool needed usually
                 logBuild('error', `Cannot replace existing ${existingBlock.name} with wrong state. Placement failed.`);
                 return false; // Failed to clear the spot
             }
             if (await checkSafetyAndStop()) return false; // Check after digging
             // Continue placement attempt after clearing
        }
    }
    // 3b. Check if position is blocked by something else solid
    else if (existingBlock && existingBlock.type !== mc.blocksByName.air.id && !mc.blocks[existingBlock.type]?.canBeReplaced && existingBlock.boundingBox === 'block') {
        logBuild('warn', `Position ${formatCoords(targetPos)} blocked by ${existingBlock.name}. Attempting to clear...`);
        if (!await digBlock(existingBlock)) {
            logBuild('error', `Cannot clear blocking block ${existingBlock.name}. Placement failed.`);
            return false;
        }
        if (await checkSafetyAndStop()) return false; // Check after digging
        // Continue placement attempt after clearing
    }

    // 3c. Find Reference Block and Face Vector
    let referenceBlock = null;
    let faceVector = null;
    // Prioritize placing on block below if possible (most common)
    const possibleRefs = [
        { offset: new Vec3(0, -1, 0), face: new Vec3(0, 1, 0) }, // Place on top of block below
        { offset: new Vec3(0, 1, 0), face: new Vec3(0, -1, 0) }, // Place hanging from block above
        { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) }, // Place on side of block north
        { offset: new Vec3(0, 0, 1), face: new Vec3(0, 0, -1) }, // Place on side of block south
        { offset: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) }, // Place on side of block west
        { offset: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) }, // Place on side of block east
    ];

    for (const refInfo of possibleRefs) {
        const refPos = targetPos.plus(refInfo.offset);
        const block = botRef.blockAt(refPos);
        // Check if the reference block is solid and within reach
        if (block && block.boundingBox === 'block') {
             const refCenter = refPos.offset(0.5, 0.5, 0.5);
             // Check reachability (adjust reach distance as needed)
             if (botRef.entity.position.distanceTo(refCenter) < 5.0) { // Standard player reach
                  referenceBlock = block;
                  faceVector = refInfo.face;
                  // logBuild('debug', `Found reference block ${referenceBlock.name} at ${formatCoords(refPos)} with face ${faceVector}.`);
                  break; // Found a suitable reference
             }
        }
    }

    // If no suitable reference block found from current position
    if (!referenceBlock || !faceVector) {
        logBuild('warn', `No suitable reference block found to place ${blockName} at ${formatCoords(targetPos)} from current position.`);
        // Try to move closer to the target position
        logBuild('info', `Attempting to move closer to ${formatCoords(targetPos)}...`);
        try {
            // Goal slightly offset to avoid standing exactly in the target block
            const goal = new GoalNear(targetPos.x, targetPos.y, targetPos.z, 2.0);
            await botRef.pathfinder.goto(goal);
            await sleep(200); // Wait after moving
            // Retry finding reference block in the next loop iteration
            continue;
        } catch (moveErr) {
            logBuild('error', `Failed to move closer to ${formatCoords(targetPos)}: ${moveErr.message}. Placement likely impossible.`);
            return false; // Cannot reach the location
        }
    }

    // 3d. Perform Placement
    try {
        // Ensure item is still equipped (might have changed during movement/digging)
        if (!(await equipItem(blockName))) {
          logBuild('error', `Failed to re-equip ${blockName} before placing.`);
          continue; // Retry placement attempt
        }
        if (await checkSafetyAndStop()) return false;

        // Look towards the reference block (optional, but can help)
        // await botRef.lookAt(referenceBlock.position.offset(0.5, 0.5, 0.5), true);
        // await sleep(50);

        // Prepare options for placeBlock (currently only uses state)
        const placeOptions = {
            // dx, dy, dz, swingArm, showHand, delta, forceLook
            // We primarily need state if applicable
        };

        // Use placeBlockWithOptions if state is needed, otherwise normal placeBlock
        // Note: As of recent mineflayer, placeBlock itself might accept state implicitly or via options.
        // Let's use the standard placeBlock. We assume mc-data handles state setting based on faceVector correctly for most blocks.
        // If specific state control beyond direction is needed, need more complex logic here.
        await botRef.placeBlock(referenceBlock, faceVector);
        await sleep(250); // Wait for block placement confirmation

        // 3e. Verify Placement
        const blockAfter = botRef.blockAt(targetPos);
        if (blockAfter?.type === blockData.id) {
            // Basic verification passed, check state if needed
             let stateMatches = true;
            if (desiredState) {
                 for (const key in desiredState) {
                      if (blockAfter.state && blockAfter.state[key] !== undefined && String(blockAfter.state[key]) !== String(desiredState[key])) {
                           logBuild('warn', `State mismatch after place: ${key} (Got: ${blockAfter.state[key]}, Want: ${desiredState[key]})`);
                           stateMatches = false;
                           // Don't break here, log all mismatches? Or just the first?
                      }
                 }
            }
             if (stateMatches) {
                 logBuild('info', `Placed & verified ${blockName} at ${formatCoords(targetPos)}.`);
                 return true; // Success!
             } else {
                 logBuild('warn', `Placed ${blockName} but final state is incorrect. Accepting anyway for now.`);
                 // TODO: Optionally, try breaking and replacing again if state is critical?
                 return true; // Consider it placed, even if state is wrong for now
             }
        } else {
            logBuild('warn', `Place ${blockName} attempt ${attempt} failed verification (Block is ${blockAfter?.name ?? "air"})`);
            // Check if inventory decreased - maybe placed but verification failed?
             if (getItemCount(blockName) < (botRef.heldItem?.count ?? 0) ) { // Rough check if held count changed
                logBuild('warn', `Inventory count decreased, assuming placement succeeded despite verification failure.`);
                return true;
            }
        }
    } catch (err) {
        logBuild('error', `Error during placeBlock for ${blockName} attempt ${attempt}: ${err.message}`);
        // Check if the block *did* get placed despite the error
        const blockAfter = botRef.blockAt(targetPos);
        if (blockAfter?.type === blockData.id) {
             logBuild('warn', "Error occurred, but block seems to be placed. Accepting.");
             return true;
        }
    }

    // Wait before retrying placement
    if (attempt < MAX_RETRIES_PLACE_BLOCK) {
         logBuild('info', `Waiting before retry place...`);
         await sleep(300 + attempt * 100);
    }
  } // End of retry loop

  logBuild('error', `Failed all ${MAX_RETRIES_PLACE_BLOCK} attempts to place ${blockName} at ${formatCoords(targetPos)}.`);
  return false;
}

// --- SCAFFOLDING ---

async function buildScaffoldTo(targetPos) {
    // This function is complex and potentially unreliable.
    // Using pathfinder with Movements that allow placing scaffold is often better.
    // This basic version tries direct pathing first, then very simple manual scaffolding.
    if (await checkSafetyAndStop()) return false;
    const botPos = botRef.entity.position;
    const currentPosFloored = botPos.floored();
    const targetPosFloored = targetPos.floored();

    logBuild('info', `Scaffold/Move request: From ${formatCoords(currentPosFloored)} towards ${formatCoords(targetPosFloored)}`);

    if (currentPosFloored.equals(targetPosFloored)) {
        logBuild('debug', "Already at target scaffold position.");
        return true;
    }

    // 1. Try Pathfinder First (with default movements)
    try {
        logBuild('info', `Attempting pathfinding to ${formatCoords(targetPosFloored)}...`);
        const goal = new GoalGetToBlock(targetPosFloored.x, targetPosFloored.y, targetPosFloored.z);
        await botRef.pathfinder.goto(goal);
        logBuild('info', `Pathfinding successful to reach ${formatCoords(targetPosFloored)}.`);
        return true;
    } catch (pathErr) {
        logBuild('warn', `Pathfinding failed to reach ${formatCoords(targetPosFloored)}: ${pathErr.message}. Attempting manual scaffold/bridge (basic)...`);
        // Fall through to manual attempt if pathfinding fails
    }

    // 2. Manual Scaffolding (Very Basic - Prone to issues)
    if (await checkSafetyAndStop()) return false;

    let scaffoldMaterialName = null;
    let scaffoldItemId = -1;
    for (const name of SCAFFOLD_MATERIAL_PRIORITY) {
        if (getItemCount(name) > 0) {
            scaffoldMaterialName = name;
            scaffoldItemId = mc.itemsByName[name]?.id ?? mc.blocksByName[name]?.id;
            break;
        }
    }
    if (!scaffoldMaterialName) { logBuild('error', "Out of scaffold materials! Cannot manually scaffold."); return false; }
    logBuild('info', `Using ${scaffoldMaterialName} for manual scaffolding.`);

    // --- Basic Manual Logic ---
    // This part is highly simplified and likely insufficient for complex terrain.
    // It doesn't handle digging obstacles well, only basic jumping and bridging.
    let currentBuildPos = botRef.entity.position.floored();
    let attempts = 0;
    const maxAttempts = (targetPosFloored.distanceTo(currentBuildPos) * 3) + 10; // Rough estimate

    while (!currentBuildPos.equals(targetPosFloored) && attempts < maxAttempts) {
        attempts++;
        if (await checkSafetyAndStop()) return false;

        const diff = targetPosFloored.minus(currentBuildPos);
        let moveDir = new Vec3(0, 0, 0);

        // Prioritize vertical movement if needed and reasonable
        if (diff.y > 0 && diff.y <= MAX_SCAFFOLD_HEIGHT_DIFF) {
            moveDir.y = 1;
        } else if (diff.y < 0) {
             moveDir.y = -1; // Need to dig down
        } else if (diff.x !== 0) { // Then horizontal
            moveDir.x = Math.sign(diff.x);
        } else if (diff.z !== 0) {
            moveDir.z = Math.sign(diff.z);
        } else {
            break; // Should be at target if diff is zero vector
        }

        const nextPosFeet = currentBuildPos.plus(moveDir);
        const nextPosHead = nextPosFeet.offset(0, 1, 0);
        const blockAtNextFeet = botRef.blockAt(nextPosFeet);
        const blockAtNextHead = botRef.blockAt(nextPosHead);
        const blockBelowNextFeet = botRef.blockAt(nextPosFeet.offset(0, -1, 0));

        // --- Action based on move direction ---

        // Going Up (Pillar Jump)
        if (moveDir.y > 0) {
            const blockBelowCurrent = botRef.blockAt(currentBuildPos.offset(0, -1, 0));
            if (!blockBelowCurrent || blockBelowCurrent.type === mc.blocksByName.air.id) {
                 logBuild('warn', "Cannot jump, no block below current position.");
                 // Try placing scaffold below?
                 if(getItemCount(scaffoldMaterialName) < 1) { logBuild('error', `Out of ${scaffoldMaterialName}!`); return false; }
                 if (!(await equipItem(scaffoldMaterialName))) { logBuild('error',`Cannot equip ${scaffoldMaterialName}.`); return false; }
                 const refBlock = botRef.blockAt(currentBuildPos.offset(0,-2,0)); // Block 2 below
                 if (refBlock && refBlock.boundingBox === 'block') {
                     try {
                          logBuild('info', "Placing scaffold block below to jump...");
                          await botRef.look(botRef.entity.yaw, -Math.PI/2, true); // Look down
                          await sleep(100);
                          await botRef.placeBlock(refBlock, new Vec3(0, 1, 0));
                          await sleep(150);
                          const placed = botRef.blockAt(currentBuildPos.offset(0,-1,0));
                          if (placed?.type === scaffoldItemId) {
                              scaffoldBlocksPlaced.push(placed.position.clone());
                              logBuild('info', "Placed scaffold below. Proceeding with jump.");
                          } else { logBuild('error', `Failed to place scaffold below.`); return false; }
                     } catch (placeErr) { logBuild('error', `Error placing scaffold below: ${placeErr.message}`); return false; }
                 } else { logBuild('error', `No reference block 2 below to place scaffold.`); return false; }
            }
             // Perform Jump
             logBuild('debug', "Attempting jump...");
             botRef.setControlState('jump', true);
             await sleep(100); // Short delay for jump charge
             botRef.setControlState('jump', false);
             await sleep(400); // Wait for jump arc / landing
             currentBuildPos = botRef.entity.position.floored(); // Update position after jump
             logBuild('debug', `New position after jump: ${formatCoords(currentBuildPos)}`);
             continue; // Re-evaluate next move from new position
        }

        // Going Down (Dig)
        else if (moveDir.y < 0) {
            const blockBelow = botRef.blockAt(currentBuildPos.offset(0, -1, 0));
            if (blockBelow && blockBelow.type !== mc.blocksByName.air.id) {
                 logBuild('info', `Digging down: ${blockBelow.name} at ${formatCoords(blockBelow.position)}`);
                 if (!await digBlock(blockBelow)) { // Use default dig
                     logBuild('error', `Cannot dig down through ${blockBelow.name}. Cannot proceed.`); return false;
                 }
                 await sleep(200); // Wait after digging
                 currentBuildPos = botRef.entity.position.floored(); // Update position
            } else {
                 logBuild('debug', "Moving down into air..."); // Should just fall
                 await sleep(300); // Wait for fall
                 currentBuildPos = botRef.entity.position.floored();
            }
            continue; // Re-evaluate next move
        }

        // Horizontal Movement
        else {
            const headBlocked = blockAtNextHead?.boundingBox === 'block';
            const feetBlocked = blockAtNextFeet?.boundingBox === 'block';
            const needBridge = !blockBelowNextFeet || blockBelowNextFeet.type === mc.blocksByName.air.id || blockBelowNextFeet.boundingBox !== 'block';

            // Handle Obstacles (Basic Digging)
            if (headBlocked) {
                 logBuild('warn', `Head blocked at ${formatCoords(nextPosHead)} by ${blockAtNextHead.name}. Trying to dig...`);
                 if (!await digBlock(blockAtNextHead)) { logBuild('error', `Cannot clear head space.`); return false; }
                 await sleep(100); // Wait after dig
                 // Don't move yet, re-evaluate in next loop iteration
            } else if (feetBlocked) {
                 logBuild('warn', `Feet blocked at ${formatCoords(nextPosFeet)} by ${blockAtNextFeet.name}. Trying to dig...`);
                 if (!await digBlock(blockAtNextFeet)) { logBuild('error', `Cannot clear feet space.`); return false; }
                 await sleep(100);
                 // Don't move yet
            }
            // Handle Gaps (Bridging)
            else if (needBridge) {
                 logBuild('info', `Gap detected at ${formatCoords(nextPosFeet)}. Placing bridge block...`);
                 if (getItemCount(scaffoldMaterialName) < 1) { logBuild('error', `Out of ${scaffoldMaterialName} for bridge!`); return false; }
                 if (!(await equipItem(scaffoldMaterialName))) { logBuild('error', `Cannot equip ${scaffoldMaterialName}.`); return false; }

                 const placeTarget = nextPosFeet.offset(0, -1, 0); // Target position for the bridge block
                 const refBlock = botRef.blockAt(currentBuildPos.offset(0,-1,0)); // Block below current pos

                 if (refBlock && refBlock.boundingBox === 'block') {
                     try {
                          // Look towards the block to be placed (approx)
                          await botRef.lookAt(placeTarget.offset(0.5, 0.5, 0.5), true);
                          await sleep(100);
                          // Calculate face vector from reference block to target block
                          const faceVec = placeTarget.minus(refBlock.position);
                          // Place the block
                          await botRef.placeBlock(refBlock, faceVec);
                          await sleep(150); // Wait for placement
                          const placed = botRef.blockAt(placeTarget);
                          if (placed?.type === scaffoldItemId) {
                               logBuild('info', "Placed bridge block.");
                               scaffoldBlocksPlaced.push(placed.position.clone());
                               // Now move onto the newly placed block
                               botRef.setControlState('forward', true); await sleep(250); botRef.clearControlStates(); // Basic move forward
                               await sleep(200);
                               currentBuildPos = botRef.entity.position.floored();
                          } else { logBuild('error', `Failed to place bridge block at ${formatCoords(placeTarget)}.`); return false; }
                     } catch(bridgeErr) { logBuild('error', `Error placing bridge block: ${bridgeErr.message}`); return false; }
                 } else { logBuild('error', `No solid block below (${formatCoords(refBlock?.position)}) to place bridge from.`); return false; }
            }
            // Move Horizontally (If clear)
            else {
                 logBuild('debug', `Moving horizontally to ${formatCoords(nextPosFeet)}...`);
                 // Use basic controls - pathfinder might be better but failed earlier
                 // Determine control state based on moveDir
                 if (moveDir.x > 0) botRef.setControlState('right', true);
                 else if (moveDir.x < 0) botRef.setControlState('left', true);
                 if (moveDir.z > 0) botRef.setControlState('back', true); // Z positive is often backwards in Minecraft's coordinate system relative to player look dir
                 else if (moveDir.z < 0) botRef.setControlState('forward', true);

                 await sleep(250); // Move for a short duration
                 botRef.clearControlStates();
                 await sleep(200); // Settle
                 currentBuildPos = botRef.entity.position.floored();
            }
        }
        await sleep(50); // Small delay between attempts
    } // End manual scaffold loop

    if (!currentBuildPos.equals(targetPosFloored)) {
        logBuild('error', `Failed to reach scaffold target ${formatCoords(targetPosFloored)} after ${attempts} manual attempts. Current pos: ${formatCoords(currentBuildPos)}`);
        return false;
    }

    logBuild('info', `Successfully reached scaffold/move target via manual method: ${formatCoords(targetPosFloored)}.`);
    return true;
}

async function removeScaffold() {
    if (shouldStopTask() || scaffoldBlocksPlaced.length === 0) {
        scaffoldBlocksPlaced = []; // Clear list if empty or task stopped
        return true;
    }
    logBuild('info', `Cleaning up ${scaffoldBlocksPlaced.length} scaffold blocks...`);
    const previousState = botRef.buildingState;
    botRef.buildingState = 'REMOVING_SCAFFOLD';

    // Sort blocks to remove from top to bottom, maybe closest first?
    // Top-down might be safer to avoid breaking support.
    scaffoldBlocksPlaced.sort((a, b) => b.y - a.y);

    let failedRemovals = 0;
    const initialCount = scaffoldBlocksPlaced.length;
    let removedPositionsThisRun = [];

    // Use a copy of the array to iterate while modifying the original
    const blocksToRemove = [...scaffoldBlocksPlaced];
    scaffoldBlocksPlaced = []; // Clear the main list, add back failures if needed

    for (const blockPos of blocksToRemove) {
        if (await checkSafetyAndStop()) {
             // If stopped, put remaining blocks back into the list
             scaffoldBlocksPlaced.push(...blocksToRemove.slice(blocksToRemove.indexOf(blockPos)));
             logBuild('warn', 'Scaffold removal stopped prematurely.');
             botRef.buildingState = previousState;
             return false;
        }

        const block = botRef.blockAt(blockPos);

        // Check if block exists and is a scaffold material
        if (!block || block.type === mc.blocksByName.air.id) {
            logBuild('debug', `Scaffold block at ${formatCoords(blockPos)} already gone.`);
            continue; // Already removed
        }
        if (!SCAFFOLD_MATERIAL_PRIORITY.includes(block.name)) {
             logBuild('warn', `Block at ${formatCoords(blockPos)} is ${block.name}, not expected scaffold. Skipping removal.`);
             continue; // Not a scaffold block we placed (or it changed)
        }

        // Move near the block to dig it
        const goal = new GoalNear(blockPos.x, blockPos.y, blockPos.z, 3.0); // Get within reasonable dig distance
        try {
             // logBuild('debug', `Moving near scaffold ${formatCoords(blockPos)} to remove...`);
             await botRef.pathfinder.goto(goal);
             await sleep(100); // Wait after moving
        } catch(moveErr) {
            logBuild('warn', `Cannot move near scaffold ${formatCoords(blockPos)}: ${moveErr.message}. Trying dig anyway.`);
            // Proceed to dig attempt even if movement fails
        }
        if (await checkSafetyAndStop()) {
            scaffoldBlocksPlaced.push(...blocksToRemove.slice(blocksToRemove.indexOf(blockPos)));
            botRef.buildingState = previousState; return false;
        }

        // Dig the block
        if (await digBlock(block)) { // Use default dig, specific tool usually not needed for scaffold
            removedPositionsThisRun.push(blockPos);
            await sleep(50); // Small pause after digging
        } else {
            logBuild('warn', `Failed to dig scaffold block ${block.name} at ${formatCoords(blockPos)}. Skipping.`);
            failedRemovals++;
            scaffoldBlocksPlaced.push(blockPos); // Add back to list if failed
            if (failedRemovals > Math.max(5, initialCount * 0.2)) { // Stop if too many failures
                 logBuild('error', "Too many scaffold removal failures. Aborting cleanup.");
                 scaffoldBlocksPlaced.push(...blocksToRemove.slice(blocksToRemove.indexOf(blockPos) + 1)); // Add remaining
                 botRef.buildingState = previousState;
                 return false;
            }
        }
    }

    logBuild('info', `Scaffold cleanup finished. Initially: ${initialCount}, Removed: ${removedPositionsThisRun.length}, Failed/Remaining: ${scaffoldBlocksPlaced.length}`);
    botRef.buildingState = previousState;
    return scaffoldBlocksPlaced.length === 0; // Return true only if all were successfully removed
}


// --- INVENTORY MANAGEMENT ---

async function handleInventoryFull() {
    if (await checkSafetyAndStop()) return false;
    if (temporaryChests.length >= MAX_TEMP_CHESTS) {
        logBuild('error', `Inventory full, but reached max temporary chests (${MAX_TEMP_CHESTS}). Cannot place more. BUILDING STOPPED.`);
        // This is a critical failure state - maybe stop the whole build?
        botRef.isBuilding = false; // Stop build process
        return false;
    }
    logBuild('warn', "Inventory almost full! Finding spot for temporary chest...");
    const currentState = botRef.buildingState;
    botRef.buildingState = 'HANDLING_INVENTORY';

    let chestPlacementPos = null;
    const botPos = botRef.entity.position;
    const searchRadius = 5;

    // Find a clear spot nearby on the ground
    for (let r = 1; r <= searchRadius; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                 // Check only blocks on the perimeter of the square for efficiency
                 if (Math.abs(dx) < r && Math.abs(dz) < r) continue;

                 // Check relative to bot's feet position
                 const checkPos = botPos.floored().offset(dx, 0, dz);
                 const blockAt = botRef.blockAt(checkPos);
                 const blockBelow = botRef.blockAt(checkPos.offset(0, -1, 0));
                 const blockAbove = botRef.blockAt(checkPos.offset(0, 1, 0));

                 // Need solid ground below, and air at placement spot and head spot
                 if (blockBelow?.boundingBox === 'block' && blockAt?.type === mc.blocksByName.air.id && blockAbove?.type === mc.blocksByName.air.id) {
                      // Ensure it's not one of the existing temp chests
                      if (!temporaryChests.some(p => p.equals(checkPos))) {
                           chestPlacementPos = checkPos;
                           break;
                      }
                 }
            }
            if (chestPlacementPos) break;
        }
        if (chestPlacementPos) break;
    }

    if (!chestPlacementPos) {
        logBuild('error', "Cannot find suitable spot for temporary chest nearby!");
        botRef.buildingState = currentState;
        // Maybe try a wider search or stop? For now, fail handling.
        return false;
    }

    // Ensure we have a chest to place
    if (getItemCount(CHEST_TYPE) < 1) {
        logBuild('info', "Inventory full and no chest available. Crafting temporary chest...");
        // Ensure ingredients (8 planks) are available before crafting
        if (!(await ensureMaterial(PRIMARY_PLANKS_TYPE, 8))) { // Use ensureMaterial which calls ensureResource/Crafted
             logBuild('error', "Not enough wood to craft a temporary chest.");
             botRef.buildingState = currentState;
             return false;
        }
        if (await checkSafetyAndStop()) return false;
        // Now craft the chest
        if (!(await ensureCrafted(CHEST_TYPE, 1))) { // ensureCrafted handles the actual crafting call
             logBuild('error', "Failed to craft temporary chest.");
             botRef.buildingState = currentState;
             return false;
        }
    }
    if (await checkSafetyAndStop()) return false;

    // Place the chest
    logBuild('info', `Placing temporary chest at ${formatCoords(chestPlacementPos)}...`);
    if (!(await placeBlockAttempt(chestPlacementPos, CHEST_TYPE))) {
        logBuild('error', "Failed to place temporary chest!");
        botRef.buildingState = currentState;
        return false;
    }

    // Verify placement and add to list
    const tempChestBlock = botRef.blockAt(chestPlacementPos);
    if (!tempChestBlock || tempChestBlock.name !== CHEST_TYPE) {
        logBuild('error', "Failed to verify temporary chest placement. Chest might be missing.");
        // Should we retry placement? For now, assume failure.
        botRef.buildingState = currentState;
        return false;
    }
    temporaryChests.push(chestPlacementPos.clone());
    logBuild('info', `Placed temporary chest #${temporaryChests.length} at ${formatCoords(chestPlacementPos)}`);

    // Deposit items into the newly placed chest
    const depositSuccess = await depositNonEssentialItems(null, tempChestBlock); // Pass the block object
    if (!depositSuccess) {
        logBuild('warn', "Failed to fully deposit items into the new temporary chest.");
        // Inventory might still be full...
    } else {
        logBuild('info', "Deposited non-essential items into temporary chest.");
    }

    botRef.buildingState = currentState; // Restore original state
    await sleep(200);
    return true; // Handling attempt finished (might not have fully cleared inventory)
}

async function retrieveFromTemporaryChests() {
    if (shouldStopTask()) return true; // Don't retrieve if task stopped
    if (temporaryChests.length === 0) {
        logBuild('debug', "No temporary chests to retrieve items from.");
        return true;
    }
    logBuild('info', `Retrieving items from ${temporaryChests.length} temporary chests...`);
    const previousState = botRef.buildingState;
    botRef.buildingState = 'RETRIEVING_TEMP';

    let chestsToRemoveFromList = [];
    let allItemsRetrieved = true; // Assume success until failure

    for (const chestPos of temporaryChests) {
        if (await checkSafetyAndStop()) {
            allItemsRetrieved = false;
            break; // Stop retrieval process
        }

        const chestBlock = botRef.blockAt(chestPos);
        if (!chestBlock || chestBlock.name !== CHEST_TYPE) {
            logBuild('warn', `Temporary chest at ${formatCoords(chestPos)} seems to be missing or broken. Skipping.`);
            chestsToRemoveFromList.push(chestPos); // Mark for removal from our list
            continue;
        }

        logBuild('info', `Moving to temporary chest at ${formatCoords(chestPos)}...`);
        let chestWindow = null;
        try {
            // Move to the chest
            await botRef.pathfinder.goto(new GoalBlock(chestPos.x, chestPos.y, chestPos.z)); // Stand next to it
            if (await checkSafetyAndStop()) { allItemsRetrieved = false; break; }

            logBuild('info', `Opening temp chest ${formatCoords(chestPos)} and retrieving all items...`);
            chestWindow = await botRef.openChest(chestBlock);
            const itemsInChest = chestWindow.items();

            if (itemsInChest.length === 0) {
                logBuild('info', `Chest at ${formatCoords(chestPos)} is empty.`);
            } else {
                // Withdraw all items one by one (or use withdrawAll if available/reliable)
                for (const item of itemsInChest) {
                     if (shouldStopTask()) { allItemsRetrieved = false; break; }
                     if (botRef.inventory.emptySlotCount() < 1) {
                          logBuild('error', "Inventory full while retrieving items from temp chest! Stopping retrieval.");
                          allItemsRetrieved = false; // Cannot continue
                          break;
                     }
                     try {
                          // logBuild('debug', `Withdrawing ${item.count} x ${item.name}...`);
                          await chestWindow.withdraw(item.type, null, item.count);
                          await sleep(100); // Small delay between withdrawals
                     } catch (withdrawErr) {
                          logBuild('error', `Error withdrawing ${item.name} (count ${item.count}) from chest ${formatCoords(chestPos)}: ${withdrawErr.message}`);
                          // If inventory full error, stop
                          if (withdrawErr.message.toLowerCase().includes('inventory') && withdrawErr.message.toLowerCase().includes('full')) {
                               allItemsRetrieved = false;
                               break;
                          }
                          // Otherwise, maybe just skip this item? Or retry? For now, log and continue.
                     }
                }
            }

            // Close the chest window
            await chestWindow.close();
            chestWindow = null;
            logBuild('info', `Finished retrieving from chest at ${formatCoords(chestPos)}.`);

            // If retrieval was stopped prematurely (e.g., full inventory), don't break the chest yet
            if (!allItemsRetrieved) {
                 logBuild('warn', `Skipping breaking chest at ${formatCoords(chestPos)} due to incomplete retrieval.`);
                 continue; // Move to the next chest in the list
            }

             // Break the chest after successfully emptying it (if all items were retrieved)
             logBuild('info', `Breaking empty temporary chest at ${formatCoords(chestPos)}...`);
             if (await digBlock(chestBlock)) { // Use default dig
                 logBuild('info', `Successfully broke temporary chest.`);
                 chestsToRemoveFromList.push(chestPos); // Mark for removal from list
             } else {
                 logBuild('warn', `Failed to break temporary chest at ${formatCoords(chestPos)}. It will remain in the world (and in the list).`);
                 // Keep it in the temporaryChests list if breaking failed
             }

        } catch (err) {
            logBuild('error', `Error processing temporary chest at ${formatCoords(chestPos)}: ${err.message}`);
            allItemsRetrieved = false; // Mark as failed if any error occurs
            if (chestWindow) {
                try { await chestWindow.close(); } catch (e) { /* Ignore close error */ }
            }
            // Don't break the chest if there was an error accessing/emptying it
        }

        if (!allItemsRetrieved) break; // Stop processing chests if inventory got full or error occurred

        await sleep(200); // Pause between chests
    } // End loop through temporaryChests

    // Update the global list of temporary chests
    temporaryChests = temporaryChests.filter(pos => !chestsToRemoveFromList.some(removedPos => removedPos.equals(pos)));

    logBuild('info', `Item retrieval finished. Remaining temporary chests in list: ${temporaryChests.length}`);
    botRef.buildingState = previousState; // Restore state
    // Return true if the list is now empty AND all items were retrieved successfully
    return temporaryChests.length === 0 && allItemsRetrieved;
}


// Deposit non-essential items into either temporary chests or main house chests
async function depositNonEssentialItems(cornerPos, targetTempChest = null) {
  if (await checkSafetyAndStop()) return false;

  const depositTargetDesc = targetTempChest ? `temporary chest at ${formatCoords(targetTempChest.position)}` : "main house chests";
  logBuild('info', `Checking for non-essential items to deposit into ${depositTargetDesc}...`);

  // Define items to KEEP (building materials, tools, fuel, etc.)
  const keepNames = [
      PRIMARY_LOG_TYPE, PRIMARY_PLANKS_TYPE, PRIMARY_DOOR_TYPE, PRIMARY_STAIRS_TYPE, PRIMARY_SLAB_TYPE,
      FOUNDATION_MATERIAL, WALL_CORNER_MATERIAL, WALL_FILL_MATERIAL, WINDOW_MATERIAL, GLASS_TYPE,
      CRAFTING_TABLE_TYPE, FURNACE_TYPE, CHEST_TYPE,
      COBBLESTONE_TYPE, COAL_TYPE, CHARCOAL_TYPE, SAND_TYPE, STICK_TYPE, TORCH_TYPE,
      ...(SCAFFOLD_MATERIAL_PRIORITY), // Keep scaffold materials
      ...AXE_PRIORITY, ...PICKAXE_PRIORITY, ...SHOVEL_PRIORITY // Keep tools
  ];
  // Remove duplicates and nulls, convert to Set for faster lookup
  const keepIds = new Set(keepNames.map(name => mc.itemsByName[name]?.id ?? mc.blocksByName[name]?.id).filter(id => id !== undefined));

  // Identify items to deposit (anything NOT in keepIds, excluding armor/offhand/hotbar?)
  // Let's define non-essentials more explicitly for robustness.
  const nonEssentialNames = [
      "dirt", "grass_block", "gravel", "flint", "sandstone", "red_sand", // Common terrain
      "granite", "diorite", "andesite", "deepslate", "cobbled_deepslate", "tuff", // Stone variants
      "rotten_flesh", "string", "spider_eye", "gunpowder", "bone", "arrow", // Mob drops
      "egg", "feather", "leather", // Passive mob drops
      "ink_sac", "glow_ink_sac", // Squid drops
      "wheat_seeds", "melon_seeds", "pumpkin_seeds", "beetroot_seeds", "torchflower_seeds", "pitcher_pod", // Seeds
      // Add more common clutter items as needed
  ];
   const nonEssentialIds = new Set(nonEssentialNames.map(name => mc.itemsByName[name]?.id ?? mc.blocksByName[name]?.id).filter(id => id !== undefined));


  const itemsToDeposit = botRef.inventory.items().filter(item => {
    // Ignore armor slots (5-8) and offhand (45)
    if (item.slot >= 5 && item.slot <= 8) return false;
    if (item.slot === 45) return false;
    // Ignore currently held item
    if (botRef.heldItem && item.slot === botRef.heldItem.slot) return false;
    // Check if item is in the non-essential list
    return nonEssentialIds.has(item.type);
    // OR check if it's NOT in the essential list (more broad)
    // return !keepIds.has(item.type); // Use this if you prefer defining essentials only
  });


  if (itemsToDeposit.length === 0) {
    logBuild('info', "No non-essential items found to deposit.");
    return true; // Nothing to do
  }
  logBuild('info', `Found ${itemsToDeposit.length} stacks of non-essential items to deposit into ${depositTargetDesc}.`);
  const previousState = botRef.buildingState;
  botRef.buildingState = 'DEPOSITING_ITEMS';

  let chestsToUse = [];
  if (targetTempChest) {
      // Ensure the target block is still a chest
      const block = botRef.blockAt(targetTempChest.position);
      if (block && block.name === CHEST_TYPE) {
           chestsToUse.push(block);
      } else {
           logBuild('error', `Target temporary chest at ${formatCoords(targetTempChest.position)} is missing or not a chest.`);
           botRef.buildingState = previousState;
           return false;
      }
  } else if (cornerPos) {
      // Try to find the main chests based on FURNITURE_POSITIONS relative to cornerPos
      const chestPos1 = FURNITURE_POSITIONS.CHEST_1?.plus(cornerPos);
      const chestPos2 = FURNITURE_POSITIONS.CHEST_2?.plus(cornerPos);
      if (chestPos1) {
           const chestBlock1 = botRef.blockAt(chestPos1);
           if (chestBlock1?.name === CHEST_TYPE) chestsToUse.push(chestBlock1);
      }
       if (chestPos2) {
           const chestBlock2 = botRef.blockAt(chestPos2);
           // Avoid adding the same chest twice if positions overlap or are the same
           if (chestBlock2?.name === CHEST_TYPE && !chestsToUse.some(c => c.position.equals(chestPos2))) {
                chestsToUse.push(chestBlock2);
           }
       }
        // If furniture positions aren't set, maybe search nearby? For now, rely on defined positions.
  }

  if (chestsToUse.length === 0) {
      logBuild('error', `No valid chests found for depositing into ${depositTargetDesc}. Cannot deposit.`);
      botRef.buildingState = previousState;
      return false;
  }
  logBuild('info', `Will attempt deposit into ${chestsToUse.length} chest(s).`);


  let depositedOk = true;
  let chestWindow = null;
  let currentChestIndex = 0;

  try {
    for (const item of itemsToDeposit) {
      if (await checkSafetyAndStop()) { depositedOk = false; break; }
      if (item.count === 0) continue; // Skip empty stacks somehow left over

      let depositedItemCompletely = false;
      let initialChestIndex = currentChestIndex; // Track starting chest to detect full loop

      while (!depositedItemCompletely) {
          if (await checkSafetyAndStop()) { depositedOk = false; break; }

          const currentChestBlock = chestsToUse[currentChestIndex];
          if (!currentChestBlock) { // Should not happen if chestsToUse is not empty, but safety check
              logBuild('error', "Internal error: currentChestBlock is null.");
              depositedOk = false; break;
          }

          try {
              // Open chest if not already open or if target changed
              if (!chestWindow || !chestWindow.targetChestPosition || !chestWindow.targetChestPosition.equals(currentChestBlock.position)) {
                  if (chestWindow) { try { await chestWindow.close(); } catch(closeErr){} chestWindow = null; }
                  logBuild('debug', `Moving to and opening chest at ${formatCoords(currentChestBlock.position)}...`);
                  await botRef.pathfinder.goto(new GoalBlock(currentChestBlock.position.x, currentChestBlock.position.y, currentChestBlock.position.z));
                  if (await checkSafetyAndStop()) throw new Error("Stop requested during chest approach");
                  chestWindow = await botRef.openChest(currentChestBlock);
                  chestWindow.targetChestPosition = currentChestBlock.position; // Tag window with position
                  logBuild('debug', `Opened chest ${currentChestIndex + 1}/${chestsToUse.length}.`);
              }

              // Deposit the item stack
              // logBuild('debug', `Depositing ${item.count} x ${item.name} into chest ${currentChestIndex + 1}`);
              await chestWindow.deposit(item.type, null, item.count);
              await sleep(150); // Wait for deposit action
              depositedItemCompletely = true; // Assume full stack deposited if no error

          } catch (e) {
              logBuild('warn', `Error depositing ${item.name} into chest ${currentChestIndex + 1}: ${e.message}`);
              // Close window on error to be safe
              if (chestWindow) { try { await chestWindow.close(); } catch (closeErr) {} chestWindow = null; }

              // Handle specific errors (like chest full)
              if (e.message.toLowerCase().includes("full") || e.message.toLowerCase().includes("space")) {
                  logBuild('info', `Chest ${currentChestIndex + 1} appears full. Trying next chest.`);
                  currentChestIndex = (currentChestIndex + 1) % chestsToUse.length; // Move to next chest index
                  // Check if we've tried all chests and looped back
                  if (currentChestIndex === initialChestIndex) {
                      logBuild('error', "All available chests are full! Cannot deposit remaining items.");
                      depositedOk = false; // Cannot deposit this item or any further items
                      break; // Stop trying to deposit this item
                  }
                  // Continue loop to try the next chest for the *same* item stack
              } else {
                  // Other unexpected error, stop deposit process for safety
                  logBuild('error', `Unexpected error during deposit. Aborting deposit task.`);
                  depositedOk = false;
                  break; // Stop trying to deposit this item
              }
          }
      } // End while loop for single item stack

      if (!depositedOk) break; // Stop processing further items if an error occurred
    } // End for loop through itemsToDeposit

    // Close the last opened chest window if any
    if (chestWindow) {
        try { await chestWindow.close(); } catch (e) { /* Ignore */ }
    }

  } catch (err) {
    // Catch errors from pathfinding or opening chests
    logBuild('error', `Error during deposit item handling: ${err.message}`);
    if (chestWindow) { try { await chestWindow.close(); } catch (e) {} }
    depositedOk = false;
  }

  botRef.buildingState = previousState; // Restore state
  if (depositedOk && itemsToDeposit.length > 0) {
      logBuild('info', "Finished depositing non-essential items.");
  } else if (!depositedOk) {
      logBuild('warn', "Deposit process finished with errors or was interrupted.");
  }
  return depositedOk;
}


// --- RESOURCE ACQUISITION & CRAFTING (REVISED) ---

/**
 * Ensures the bot has a minimum quantity of a given material.
 * Decides whether to gather raw resources or craft the material.
 * This is the primary function to call when needing any item.
 */
async function ensureMaterial(itemName, quantity, allowCraft = true) {
    if (shouldStopTask()) return false;
    const currentCount = getItemCount(itemName);
    if (currentCount >= quantity) {
        // logBuild('debug', `Already have enough ${itemName} (${currentCount}/${quantity}).`);
        return true;
    }

    const itemInfo = mc.itemsByName[itemName] || mc.blocksByName[itemName];
    if (!itemInfo) {
        logBuild('error', `Invalid item name in ensureMaterial: ${itemName}`);
        return false;
    }

    const needed = quantity - currentCount;
    logBuild('info', `Need ${needed} more ${itemName} (Have ${currentCount}, Need ${quantity}).`);

    // Determine if the item can be crafted
    const recipes = mc.recipes[itemInfo.id];
    const isCraftable = allowCraft && recipes && recipes.length > 0;

    // Determine if it's a basic raw material (needs explicit gathering)
    const rawMaterials = [ // List common things obtained by digging/mining/gathering
        "oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log", // Logs
        "cobblestone", "coal", "raw_iron", "raw_copper", "raw_gold", "lapis_lazuli", "diamond", "emerald", // Ores/Stones
        "sand", "dirt", "gravel", "clay_ball", // Terrain
        "netherrack", "soul_sand", "soul_soil", "basalt", "blackstone", // Nether
        // Add other direct-gather items if needed
    ];
    const isRaw = rawMaterials.includes(itemName) || itemName === COBBLESTONE_TYPE; // Cobblestone is special case (mined)

    // Decide action: Craft or Gather
    if (isCraftable && !isRaw) {
        logBuild('info', `${itemName} is craftable. Attempting to craft ${needed}...`);
        return await ensureCraftedRecursive(itemName, needed);
    } else {
        logBuild('info', `${itemName} is treated as raw/gatherable. Attempting to collect ${needed}...`);
        // Determine appropriate tool
        let toolList = [];
        if (itemName.includes('log') || itemName.includes('planks')) toolList = AXE_PRIORITY; // Planks might need logs first
        else if (itemName.includes('ore') || itemName.includes('stone') || itemName === COBBLESTONE_TYPE || itemName === 'deepslate') toolList = PICKAXE_PRIORITY;
        else if ([SAND_TYPE, 'dirt', 'gravel', 'clay', 'soul_sand', 'soul_soil'].includes(itemName)) toolList = SHOVEL_PRIORITY;

        if (toolList.length > 0) {
            if (!await ensureTool(toolList)) {
                logBuild('warn', `Failed to ensure tool for gathering ${itemName}. Will attempt without tool.`);
            }
        }
        return await findAndCollectResource(itemName, needed, toolList);
    }
}

/**
 * Finds and collects raw resources by digging/mining.
 */
async function findAndCollectResource(resourceName, needed, toolPriorityList = []) {
  if (shouldStopTask()) return false;
  const initialCount = getItemCount(resourceName);
  const targetCount = initialCount + needed;
  logBuild('info', `Collecting ${needed} ${resourceName}. Goal: ${targetCount} (Current: ${initialCount})`);

  const resourceItem = mc.itemsByName[resourceName] || mc.blocksByName[resourceName];
  if (!resourceItem) { logBuild('error', `Invalid resource data: ${resourceName}`); return false; }

  let collectedThisRun = 0;
  let failedFindAttempts = 0;
  const MAX_FIND_ATTEMPTS = 3;
  let currentSearchDist = 32; // Start searching nearby first

  while (getItemCount(resourceName) < targetCount) {
    if (shouldStopTask()) return false;
    if (await checkSafetyAndStop()) return false; // Safety check within the loop

    // Check inventory space before searching/collecting more
    if (botRef.inventory.emptySlotCount() < INVENTORY_FULL_THRESHOLD) {
        logBuild('warn', `Inventory full while trying to collect ${resourceName}. Attempting to handle...`);
        if (!await handleInventoryFull()) {
             logBuild('error', `Cannot handle full inventory. Stopping collection of ${resourceName}.`);
             return false; // Critical failure if inventory can't be cleared
        }
        // Re-check count after handling inventory
        if (getItemCount(resourceName) >= targetCount) break;
        if (await checkSafetyAndStop()) return false; // Check again after handling inventory
    }

    // Find the resource block
    logBuild('info', `Searching for ${resourceName} within ${Math.round(currentSearchDist)} blocks (Find Attempt ${failedFindAttempts + 1})...`);
    let targetBlock = null;
    try {
        // Prioritize blocks that are accessible (e.g., not buried deep)
        // This predicate is basic, could be improved (check exposure, etc.)
        const predicate = (block) => {
            if (!block) return false;
            const blockAbove = botRef.blockAt(block.position.offset(0, 1, 0));
            // Basic check: Is the block above air or replaceable? Avoids digging under solid ceilings directly
            return blockAbove && (blockAbove.type === mc.blocksByName.air.id || mc.blocks[blockAbove.type]?.canBeReplaced);
            // More advanced: Check sides for air? Check if pathfinder can reach nearby?
        };

        const blocks = await botRef.findBlocks({ // Use findBlocks to get multiple options
            matching: resourceItem.id,
            maxDistance: currentSearchDist,
            count: 5, // Look for a few options
            // usePredicate: predicate // Predicate might slow down search significantly
         });

        // Choose the closest valid block
        if (blocks && blocks.length > 0) {
             blocks.sort((a, b) => botRef.entity.position.distanceSquared(a) - botRef.entity.position.distanceSquared(b));
             targetBlock = botRef.blockAt(blocks[0]); // Get the full block object for the closest position
        }

    } catch(findErr) { logBuild('warn', `Error during findBlocks for ${resourceName}: ${findErr.message}`); targetBlock = null; }

    // Handle find results
    if (!targetBlock) {
      failedFindAttempts++;
      logBuild('warn', `No suitable ${resourceName} found within ${Math.round(currentSearchDist)} blocks.`);
      if (failedFindAttempts >= MAX_FIND_ATTEMPTS) {
          // Increase search distance after several failures at current distance
          currentSearchDist = Math.min(currentSearchDist * 2, MAX_RESOURCE_SEARCH_DIST);
          failedFindAttempts = 0; // Reset attempts for new distance
          if (currentSearchDist >= MAX_RESOURCE_SEARCH_DIST) {
              logBuild('error', `Could not find ${resourceName} even within max distance (${MAX_RESOURCE_SEARCH_DIST}). Aborting collection.`);
              return false; // Failed to find after extensive search
          }
      }
      await sleep(1000); // Wait before next search attempt
      continue; // Try finding again
    }

    // Found a block, reset find attempts and distance for next search if needed
    failedFindAttempts = 0;
    currentSearchDist = 32; // Reset to smaller search radius after success
    logBuild('info', `Found ${resourceName} at ${formatCoords(targetBlock.position)}. Moving to collect...`);

    // Move to and collect the block
    let reached = false;
    for (let pathRetry = 0; pathRetry < MAX_PATHFINDING_RETRIES; pathRetry++) {
        if (await checkSafetyAndStop()) return false;
        try {
            const goal = new GoalNear(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z, 2.0); // Get within digging range
            await botRef.pathfinder.goto(goal);
            reached = true;
            break; // Pathfinding successful
        } catch (e) {
            logBuild('warn', `Pathfinding attempt ${pathRetry + 1}/${MAX_PATHFINDING_RETRIES} to ${resourceName} failed: ${e.message}.`);
            if (pathRetry >= MAX_PATHFINDING_RETRIES - 1) {
                 logBuild('error', `Skipping target ${resourceName} at ${formatCoords(targetBlock.position)} after pathfinding failures.`);
                 // Optionally: Blacklist this block position?
            } else {
                await sleep(500); // Wait before retrying path
            }
        }
    }

    if (!reached) continue; // Try finding a different block if path failed
    if (shouldStopTask()) return false;

    // Dig the block
    logBuild('info', `Reached ${resourceName} at ${formatCoords(targetBlock.position)}. Digging...`);
    // Verify block is still the correct type before digging
    const blockToDig = botRef.blockAt(targetBlock.position);
    if (!blockToDig || blockToDig.type !== resourceItem.id) {
        logBuild('warn', `${resourceName} at ${formatCoords(targetBlock.position)} changed or disappeared before digging.`);
        continue; // Find a new target
    }

    const digSuccess = await digBlock(blockToDig, toolPriorityList);
    if (digSuccess) {
        await sleep(100); // Small pause to allow item pickup
        const countAfterDig = getItemCount(resourceName);
        const gained = countAfterDig - (initialCount + collectedThisRun);
        if (gained > 0) {
            collectedThisRun += gained;
            logBuild('info', `Collected ${gained} ${resourceName}. Total this run: ${collectedThisRun}. Progress: ${countAfterDig}/${targetCount}`);
        } else {
            // Might happen if item burns, falls into void, or pickup fails
            logBuild('warn', `Dug ${resourceName} but inventory count didn't increase as expected.`);
        }
    } else {
         logBuild('warn', `Failed to dig ${resourceName} at ${formatCoords(targetBlock.position)}.`);
         // Optionally blacklist this specific block?
    }
    // Loop continues until target count is reached or failure occurs
  } // End while loop

  const finalCount = getItemCount(resourceName);
  if (finalCount >= targetCount) {
      logBuild('info', `Successfully collected required ${resourceName}. Total: ${finalCount}`);
      return true;
  } else {
       logBuild('error', `Finished collection loop for ${resourceName}, but only have ${finalCount}/${targetCount}.`);
       return false;
  }
}

/**
 * Ensures a specific tool is available, crafting it if necessary.
 */
async function ensureTool(toolPriorityList) {
  if (shouldStopTask()) return false;
  // Check if any tool from the list is already available
  const currentBestToolName = toolPriorityList.find(name => getItemCount(name) > 0);
  if (currentBestToolName) {
    // logBuild('debug', `Tool already available: ${currentBestToolName}`);
    return true;
  }

  // If no tool available, try crafting the highest priority one first
  logBuild('info', `No tool from [${toolPriorityList.join(', ')}] found. Attempting to craft...`);
  for (const toolToCraft of toolPriorityList) {
      if (shouldStopTask()) return false;
      logBuild('info', `Trying to craft ${toolToCraft}...`);
      // Use ensureMaterial, which handles recursive crafting/gathering
      if (await ensureMaterial(toolToCraft, 1, true)) { // Ensure 1 quantity, allow crafting
          logBuild('info', `Successfully crafted ${toolToCraft}.`);
          return true; // Success
      } else {
          logBuild('warn', `Failed to craft ${toolToCraft}. Trying next priority tool...`);
      }
  }

  logBuild('error', `Failed to craft any required tool from list: [${toolPriorityList.join(', ')}]`);
  return false;
}

/**
 * Recursive function to ensure a craftable item is available.
 * Ensures ingredients are present *before* attempting the craft.
 */
async function ensureCraftedRecursive(itemName, quantity) {
    if (shouldStopTask()) return false;
    const currentCount = getItemCount(itemName);
    if (currentCount >= quantity) return true; // Base case: already have enough

    const needed = quantity - currentCount;
    logBuild('info', `[Crafting] Need to craft ${needed} more ${itemName}.`);
 
    const itemToCraft = mc.itemsByName[itemName] || mc.blocksByName[itemName];
    const recipes = mc.recipes[itemToCraft.id];
    if (!itemToCraft) { logBuild('error', `[Crafting] Invalid item: ${itemName}`); return false; }
 
    // Find a recipe
    // --- SỬA LOGIC CHỌN CÔNG THỨC ---
    let recipe = null;
    for (const r of recipes) {
        // Chấp nhận công thức nếu có ingredients (shaped, cách biểu diễn cũ/khác?)
        // HOẶC có delta (shapeless)
        // HOẶC có inShape (shaped, cách biểu diễn phổ biến cho tool/armor)
        if (r.ingredients || r.delta || r.inShape) { // <-- Thêm || r.inShape
             recipe = r;
             // Có thể thêm ưu tiên ở đây nếu muốn (vd: ưu tiên công thức dùng nguyên liệu tốt hơn?)
             break; // Lấy công thức đầu tiên phù hợp
        }
    }

    if (!recipe) {
        logBuild('error', `[Crafting] No suitable *crafting* recipe format (with ingredients, delta, or inShape) found for ${itemName}.`);
        console.log(`DEBUG Available recipes for ${itemName}:`, JSON.stringify(recipes, null, 2));
        return false;
    }


    logBuild('info', `[Crafting] Recipe for ${itemName} yields ${yieldPerCraft}. Need ${craftsNeeded} craft(s).`);

    // --- Ensure Ingredients ---
    logBuild('info', `[Crafting] Checking ingredients for ${craftsNeeded} craft(s) of ${itemName}...`);
    if (recipe.ingredients) { // Shape-based recipes (e.g., tools)
        const requiredIngredients = {};
        for (const ingredient of recipe.ingredients) {
            if (!ingredient) continue; // Skip null ingredients in recipe shape
            const ingItem = mc.items[ingredient.id] || mc.blocks[ingredient.id];
             if (!ingItem) { logBuild('error', `[Crafting] Unknown ingredient ID ${ingredient.id} for ${itemName}`); return false; }
             requiredIngredients[ingItem.name] = (requiredIngredients[ingItem.name] || 0) + 1;
        }
         for (const ingName in requiredIngredients) {
            const totalIngNeeded = requiredIngredients[ingName] * craftsNeeded;
            logBuild('debug', `[Crafting] -> Requires ${totalIngNeeded} x ${ingName}`);
            if (!(await ensureMaterial(ingName, totalIngNeeded, true))) { // Recursive call
                 logBuild('error', `[Crafting] Failed to ensure ingredient: ${ingName} for ${itemName}.`);
                 return false;
            }
            if (shouldStopTask()) return false;
         }

    } else if (recipe.delta) { // Shapeless recipes (e.g., planks, sticks)
        for (const delta of recipe.delta) {
            if (delta.count < 0) { // Ingredient (count is negative)
                const ingItem = mc.items[delta.id] || mc.blocks[delta.id];
                 if (!ingItem) { logBuild('error', `[Crafting] Unknown ingredient ID ${delta.id} for ${itemName}`); return false; }
                 const totalIngNeeded = Math.abs(delta.count) * craftsNeeded;
                 logBuild('debug', `[Crafting] -> Requires ${totalIngNeeded} x ${ingItem.name}`);
                 if (!(await ensureMaterial(ingItem.name, totalIngNeeded, true))) { // Recursive call
                      logBuild('error', `[Crafting] Failed to ensure ingredient: ${ingItem.name} for ${itemName}.`);
                      return false;
                 }
                 if (shouldStopTask()) return false;
            }
        }
    } else {
        logBuild('error', `[Crafting] Recipe format not recognized for ${itemName}. Cannot ensure ingredients.`);
        return false;
    }
    logBuild('info', `[Crafting] All ingredients for ${itemName} seem available.`);
    if (await checkSafetyAndStop()) return false;

    // --- Ensure Crafting Table if Needed ---
    let craftingTableBlock = null;
    if (recipe.requiresTable) {
        logBuild('info', `[Crafting] Recipe for ${itemName} requires crafting table. Finding/Placing...`);
        craftingTableBlock = await findOrPlaceBlock(CRAFTING_TABLE_TYPE, botRef.entity.position.floored().offset(1, 0, 0)); // Try placing nearby
        if (!craftingTableBlock) {
             logBuild('error', `[Crafting] Crafting table required but unavailable for ${itemName}.`);
             return false;
        }
        if (shouldStopTask()) return false;
         logBuild('info', `[Crafting] Using crafting table at ${formatCoords(craftingTableBlock.position)}.`);
    }

    // --- Perform the Craft ---
    logBuild('info', `[Crafting] Executing ${craftsNeeded} craft(s) for ${itemName}...`);
    try {
        // Ensure inventory has space for the result (approximate check)
        // This is hard to guarantee perfectly due to ingredient consumption vs result yield.
        if (botRef.inventory.emptySlotCount() < Math.ceil(craftsNeeded * yieldPerCraft / (itemToCraft.stackSize || 64)) ) {
            logBuild('warn', `[Crafting] Low inventory space before crafting ${itemName}. Attempting deposit...`);
            if(!await depositNonEssentialItems(botRef.build_cornerPos)){ // Deposit to main chests if possible
                 // If deposit fails, maybe try temp chest? Or just proceed carefully?
                 logBuild('warn', '[Crafting] Failed to deposit items, proceeding with craft attempt carefully.');
            }
            if (await checkSafetyAndStop()) return false;
        }

        await botRef.craft(recipe, craftsNeeded, craftingTableBlock);
        await sleep(200 + craftsNeeded * 20); // Wait for crafting operations

        // Verify craft success
        const countAfterCraft = getItemCount(itemName);
        if (countAfterCraft >= quantity) {
          logBuild('info', `[Crafting] Craft successful: ${itemName}. Have: ${countAfterCraft}`);
          return true;
        } else if (countAfterCraft > currentCount) {
           logBuild('warn', `[Crafting] Crafted ${itemName}, but count (${countAfterCraft}) is less than goal (${quantity}). Continuing if possible.`);
           // Maybe partial success? Check if we still need more.
           return await ensureCraftedRecursive(itemName, quantity); // Retry to craft the remaining amount
        } else {
          logBuild('error', `[Crafting] Crafted ${itemName}, but inventory count did not increase (${currentCount} -> ${countAfterCraft}). Craft failed?`);
          // Check inventory state again
          if (botRef.inventory.emptySlotCount() < INVENTORY_FULL_THRESHOLD) logBuild('warn', "[Crafting] Inventory might be full, causing craft failure.");
          return false;
        }
    } catch (err) {
        logBuild('error', `[Crafting] Crafting error for ${itemName}: ${err.message}`);
        if (err.message.toLowerCase().includes("missing")) logBuild('warn', `-> Craft failed due to missing ingredients (should have been checked?).`);
        else if (err.message.toLowerCase().includes("space") || err.message.toLowerCase().includes("full")) logBuild('warn', "-> Inventory likely full during craft execution.");
        // Check count after error - maybe it partially succeeded?
         if (getItemCount(itemName) > currentCount) {
              logBuild('warn', '[Crafting] Craft error occurred, but some items were crafted. Retrying for remaining.');
              return await ensureCraftedRecursive(itemName, quantity);
         }
        return false;
    }
}

/**
 * Ensures fuel (coal or charcoal) is available. Tries to craft charcoal if needed.
 */
async function ensureFuel(unitsNeeded) {
    if (shouldStopTask()) return false;
    logBuild('info', `Ensuring ${unitsNeeded} fuel units...`);
    // 1 unit = 1 item smelted. Coal/Charcoal = 8 units.
    const itemsNeeded = Math.ceil(unitsNeeded / 8);
    if (itemsNeeded <= 0) return true;

    const currentCoal = getItemCount(COAL_TYPE);
    const currentCharcoal = getItemCount(CHARCOAL_TYPE);
    const currentFuelItems = currentCoal + currentCharcoal;

    if (currentFuelItems >= itemsNeeded) {
        logBuild('info', `Sufficient fuel available (${currentFuelItems} items).`);
        return true;
    }

    const itemsToGet = itemsNeeded - currentFuelItems;
    logBuild('info', `Need ${itemsToGet} more fuel items (Coal or Charcoal).`);

    // Prioritize gathering coal first
    logBuild('info', `Attempting to gather ${itemsToGet} Coal...`);
    if (await ensureMaterial(COAL_TYPE, currentCoal + itemsToGet, false)) { // Try gathering coal first, don't allow crafting coal
         logBuild('info', 'Successfully gathered required Coal.');
         return true;
    } else {
        logBuild('warn', 'Failed to gather enough Coal. Trying to make Charcoal...');
        // Check charcoal again in case some was gathered implicitly
        if (getItemCount(CHARCOAL_TYPE) + getItemCount(COAL_TYPE) >= itemsNeeded) return true;

        const stillNeeded = itemsNeeded - (getItemCount(COAL_TYPE) + getItemCount(CHARCOAL_TYPE));
        if(stillNeeded <= 0) return true;

        logBuild('info', `Attempting to craft ${stillNeeded} Charcoal...`);
        // ensureMaterial for charcoal will trigger ensureSmelted which needs logs & furnace
        if (await ensureMaterial(CHARCOAL_TYPE, getItemCount(CHARCOAL_TYPE) + stillNeeded, true)) {
             logBuild('info', 'Successfully obtained required Charcoal.');
             return true;
        } else {
             logBuild('error', 'Failed to obtain sufficient Coal or Charcoal.');
             return false;
        }
    }
}

/**
 * Ensures an item is smelted from a source material.
 */
async function ensureSmelted(resultItemName, resultQuantity, sourceItemName) {
  if (shouldStopTask()) return false;
  const currentCount = getItemCount(resultItemName);
  if (currentCount >= resultQuantity) {
      // logBuild('debug', `Already have enough smelted ${resultItemName} (${currentCount}/${resultQuantity}).`);
      return true;
  }

  const needed = resultQuantity - currentCount;
  logBuild('info', `Need to smelt ${needed} more ${resultItemName} from ${sourceItemName}.`);

  const resultItem = mc.itemsByName[resultItemName];
  const sourceItem = mc.itemsByName[sourceItemName] || mc.blocksByName[sourceItemName];
  if (!resultItem || !sourceItem) { logBuild('error', `Invalid smelt data: ${resultItemName} or ${sourceItemName}`); return false; }

  // 1. Ensure Furnace is available
  logBuild('info', `Ensuring Furnace is available...`);
  const furnacePos = botRef.build_cornerPos ? FURNITURE_POSITIONS.FURNACE?.plus(botRef.build_cornerPos) : botRef.entity.position.floored().offset(0,0,1); // Fallback pos
  const furnaceBlock = await findOrPlaceBlock(FURNACE_TYPE, furnacePos);
  if (!furnaceBlock || shouldStopTask()) { logBuild('error', "Cannot find or place Furnace. Smelting failed."); return false; }
  logBuild('info', `Using Furnace at ${formatCoords(furnaceBlock.position)}.`);

  // 2. Ensure Enough Fuel
  // Smelting 1 item takes ~10 seconds, 1 coal/charcoal smelts 8 items.
  const fuelUnitsNeeded = needed; // 1 fuel unit per item
  logBuild('info', `Ensuring fuel for ${needed} items...`);
  if (!(await ensureFuel(fuelUnitsNeeded))) { logBuild('error', "Not enough fuel to smelt. Smelting failed."); return false; }
  if (shouldStopTask()) return false;

  // 3. Ensure Enough Source Material
  // Assuming 1 source -> 1 result (usually true for smelting)
  logBuild('info', `Ensuring ${needed} source material (${sourceItemName})...`);
  if (!(await ensureMaterial(sourceItemName, getItemCount(sourceItemName) + needed, true))) { // Allow crafting source if needed (e.g. logs for charcoal)
      logBuild('error', `Not enough ${sourceItemName} to smelt. Smelting failed.`);
      return false;
  }
  if (shouldStopTask()) return false;


  // 4. Perform Smelting
  logBuild('info', `Starting smelt process for ${needed} ${resultItemName}...`);
  let smeltedCount = 0;
  let furnaceWindow = null;
  try {
    if (await checkSafetyAndStop()) return false;

    // Move to furnace
    await botRef.pathfinder.goto(new GoalBlock(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z));
    if (await checkSafetyAndStop()) return false;

    furnaceWindow = await botRef.openFurnace(furnaceBlock);

    // Add source items (up to a stack or amount needed)
    const sourceAvailable = getItemCount(sourceItemName);
    const sourceToAdd = Math.min(sourceAvailable, needed - smeltedCount, sourceItem.stackSize); // Add up to one stack or remaining needed
    if (sourceToAdd > 0) {
        logBuild('debug', `Adding ${sourceToAdd} ${sourceItemName} to furnace input.`);
        await furnaceWindow.putInput(sourceItem.id, null, sourceToAdd);
        await sleep(150);
    } else {
        logBuild('warn', `No ${sourceItemName} available to put in furnace input, though ensureMaterial passed?`);
    }


    // Add fuel items (enough for items added, up to a stack)
    const fuelItemsAvailable = getItemCount(COAL_TYPE) + getItemCount(CHARCOAL_TYPE);
    const fuelItemsNeededNow = Math.ceil(sourceToAdd / 8); // Fuel needed for current batch
    const fuelToAdd = Math.min(fuelItemsAvailable, fuelItemsNeededNow, mc.itemsByName[COAL_TYPE].stackSize);
    if (fuelToAdd > 0) {
        const coalId = mc.itemsByName[COAL_TYPE].id;
        const charcoalId = mc.itemsByName[CHARCOAL_TYPE].id;
        const hasCoal = getItemCount(COAL_TYPE) > 0;
        const fuelId = hasCoal ? coalId : charcoalId;
        const countInInv = hasCoal ? getItemCount(COAL_TYPE) : getItemCount(CHARCOAL_TYPE);
        const actualFuelToAdd = Math.min(fuelToAdd, countInInv); // Cannot add more than available

        if (actualFuelToAdd > 0) {
             logBuild('debug', `Adding ${actualFuelToAdd} ${hasCoal ? COAL_TYPE : CHARCOAL_TYPE} to furnace fuel.`);
             await furnaceWindow.putFuel(fuelId, null, actualFuelToAdd);
             await sleep(150);
        }

    } else {
         logBuild('warn', `No fuel available to put in furnace, though ensureFuel passed?`);
    }


    // Wait for smelting and collect results
    const timePerItemTicks = 200; // 10 seconds per item
    const maxWaitTicks = sourceToAdd * timePerItemTicks + 400; // Wait time based on input + buffer
    const checkIntervalTicks = 40; // Check every 2 seconds
    let waitedTicks = 0;

    logBuild('info', `Waiting for ${sourceToAdd} items to smelt (max ${maxWaitTicks / 20}s)...`);
    while (waitedTicks < maxWaitTicks && getItemCount(resultItemName) < resultQuantity) {
        if (await checkSafetyAndStop()) break; // Check safety during wait

        const outputItem = furnaceWindow.outputItem();
        if (outputItem?.type === resultItem.id && outputItem.count > 0) {
            const count = outputItem.count;
            logBuild('info', `Furnace has ${count} ${resultItemName}. Taking...`);
            try {
                await furnaceWindow.takeOutput();
                smeltedCount += count;
                const currentTotal = getItemCount(resultItemName); // Recheck total after taking
                logBuild('info', `Took ${count}. Total now: ${currentTotal} / ${resultQuantity}`);
                await sleep(200); // Wait after taking item

                 // Check if more source/fuel needed
                 const currentInputCount = furnaceWindow.inputItem()?.count ?? 0;
                 const currentFuelAmount = furnaceWindow.fuelItem()?.count ?? 0; // Approximation
                 const needsMoreInput = currentInputCount === 0 && getItemCount(resultItemName) < resultQuantity;
                 const needsMoreFuel = furnaceWindow.fuel <= 0 && currentInputCount > 0; // Need fuel if input exists but fuel empty

                if(needsMoreInput){
                    const remainingNeeded = resultQuantity - getItemCount(resultItemName);
                    const sourceStillAvailable = getItemCount(sourceItemName);
                    const nextSourceToAdd = Math.min(sourceStillAvailable, remainingNeeded, sourceItem.stackSize);
                     if (nextSourceToAdd > 0) {
                         logBuild('debug', `Adding ${nextSourceToAdd} more ${sourceItemName} to furnace input.`);
                         await furnaceWindow.putInput(sourceItem.id, null, nextSourceToAdd);
                         await sleep(150);
                     }
                }
                if(needsMoreFuel){
                     const fuelStillAvailable = getItemCount(COAL_TYPE) + getItemCount(CHARCOAL_TYPE);
                     const nextFuelToAdd = Math.min(fuelStillAvailable, 10, mc.itemsByName[COAL_TYPE].stackSize); // Add up to 10 fuel items
                      if (nextFuelToAdd > 0) {
                            const coalId = mc.itemsByName[COAL_TYPE].id;
                            const charcoalId = mc.itemsByName[CHARCOAL_TYPE].id;
                            const hasCoal = getItemCount(COAL_TYPE) > 0;
                            const fuelId = hasCoal ? coalId : charcoalId;
                            const countInInv = hasCoal ? getItemCount(COAL_TYPE) : getItemCount(CHARCOAL_TYPE);
                            const actualFuelToAdd = Math.min(nextFuelToAdd, countInInv);
                            if(actualFuelToAdd > 0){
                                 logBuild('debug', `Adding ${actualFuelToAdd} more ${hasCoal ? COAL_TYPE : CHARCOAL_TYPE} to furnace fuel.`);
                                 await furnaceWindow.putFuel(fuelId, null, actualFuelToAdd);
                                 await sleep(150);
                            }
                      }
                }


            } catch (takeErr) {
                logBuild('error', `Error taking ${resultItemName} from furnace: ${takeErr.message}`);
                // Maybe inventory full?
                if (takeErr.message.toLowerCase().includes('full')) {
                     logBuild('error', 'Inventory full while taking smelted items. Aborting smelt.');
                     break;
                }
                 // Otherwise, maybe try again later in the loop? For now, break.
                 break;
            }
        }

        // Wait interval
        await botRef.waitForTicks(checkIntervalTicks);
        waitedTicks += checkIntervalTicks;
    } // End waiting loop

    await furnaceWindow.close();
    furnaceWindow = null;
    logBuild('info', "Closed furnace.");

    const finalCount = getItemCount(resultItemName);
    if (finalCount >= resultQuantity) {
        logBuild('info', `Smelting successful. Have ${finalCount} ${resultItemName}.`);
        return true;
    } else {
        logBuild('warn', `Smelt process finished, but only have ${finalCount}/${resultQuantity} ${resultItemName}.`);
        return false;
    }

  } catch (err) {
    logBuild('error', `Smelting process error: ${err.message}`);
    if (furnaceWindow) { try { await furnaceWindow.close(); } catch(e) {} }
    return false;
  }
}


/**
 * Wrapper for ensureCraftedRecursive to be called externally.
 */
async function ensureCrafted(itemName, quantity = 1) {
  if (shouldStopTask()) return false;
  const itemData = mc.itemsByName[itemName] || mc.blocksByName[itemName];
  if (!itemData) { logBuild('error', `Invalid item to craft: ${itemName}`); return false; }
  const currentCount = getItemCount(itemName);
  if (currentCount >= quantity) return true;

  logBuild('info', `Ensuring ${quantity} of ${itemName} are crafted...`);
  const success = await ensureCraftedRecursive(itemName, quantity); // Call the recursive function

  if (!success && !shouldStopTask()) {
      logBuild('error', `Failed to ensure ${quantity} of ${itemName} were crafted.`);
      return false;
  }
  return success;
}


/**
 * Finds a functional block nearby or places it if not found.
 * Used for Crafting Table, Furnace, etc.
 */
async function findOrPlaceBlock(blockName, preferredPos) {
    if (await checkSafetyAndStop()) return null;
    logBuild('info', `Ensuring ${blockName} is available, prefer near ${formatCoords(preferredPos)}...`);

    // 1. Check preferred position first
    let blockAtPreferred = botRef.blockAt(preferredPos);
    if (blockAtPreferred?.name === blockName) {
        logBuild('info', `${blockName} found at preferred position: ${formatCoords(preferredPos)}.`);
        return blockAtPreferred;
    }

    // 2. Search nearby
    const nearbyBlock = await findNearbyFunctionalBlock(blockName); // Uses default search distance
    if (nearbyBlock) {
        logBuild('info', `Found ${blockName} nearby at ${formatCoords(nearbyBlock.position)}. Using it.`);
        return nearbyBlock;
    }
    if (await checkSafetyAndStop()) return null;

    // 3. Place at preferred position if empty/replaceable
    logBuild('info', `No ${blockName} found nearby. Attempting placement at ${formatCoords(preferredPos)}.`);

    // Ensure the item itself can be crafted/obtained
    if (!(await ensureMaterial(blockName, 1, true))) { // Ensure 1 block, allow crafting it
         logBuild('error', `Failed to ensure the ${blockName} item itself is available.`);
         return null;
    }
    if (await checkSafetyAndStop()) return null;

    // Attempt placement
    if (await placeBlockAttempt(preferredPos, blockName)) {
        logBuild('info', `Placed ${blockName} successfully at ${formatCoords(preferredPos)}.`);
        return botRef.blockAt(preferredPos); // Return the newly placed block
    } else {
        logBuild('error', `Failed to place ${blockName} at preferred position ${formatCoords(preferredPos)}.`);
        // Maybe try placing somewhere else nearby as a last resort?
        // For now, fail if preferred location fails.
        return null;
    }
}


// --- BLUEPRINT PROCESSING & BUILDING ---

/**
 * Calculates raw resources needed based on a blueprint, resolving craft dependencies.
 */
function calculateResourcesFromBlueprint(blueprint) {
    const rawResourcesNeeded = {}; // Final list of raw materials (logs, cobble, sand...)
    const itemsInBlueprint = {}; // Direct items listed in the blueprint

    if (!blueprint || !Array.isArray(blueprint)) {
        logBuild('error', "Invalid blueprint provided for resource calculation.");
        return { resources: {}, craftQueue: {} };
    }

    // 1. Tally items directly from the blueprint
    for (const layer of blueprint) {
        if (!Array.isArray(layer)) continue;
        for (const row of layer) {
             if (!Array.isArray(row)) continue;
             for (const blockData of row) {
                  let blockName = null;
                  if (typeof blockData === 'string') blockName = blockData;
                  else if (typeof blockData === 'object' && blockData?.name) blockName = blockData.name;

                  if (blockName && blockName !== 'air' && blockName !== 'cave_air' && blockName !== 'void_air') {
                       itemsInBlueprint[blockName] = (itemsInBlueprint[blockName] || 0) + 1;
                  }
             }
        }
    }
     logBuild('info', `Blueprint directly contains: ${JSON.stringify(itemsInBlueprint)}`);


    // 2. Resolve crafting dependencies recursively
    let processingQueue = { ...itemsInBlueprint }; // Start with blueprint items
    const processed = new Set(); // Track items already broken down
    const MAX_ITERATIONS = 30; // Safety break for potential infinite loops
    let iterations = 0;

    while (Object.keys(processingQueue).length > 0 && iterations < MAX_ITERATIONS) {
        iterations++;
        let nextQueue = {}; // Items to process in the next iteration

        for (const itemName in processingQueue) {
            const quantity = processingQueue[itemName];
            if (quantity <= 0 || processed.has(itemName)) continue;

            const itemInfo = mc.itemsByName[itemName] || mc.blocksByName[itemName];
            if (!itemInfo) {
                 logBuild('warn', `[ResourceCalc] Unknown item '${itemName}' found in queue. Skipping.`);
                 processed.add(itemName); // Mark as processed to avoid re-checking
                 continue;
            }

            // Check if it's a raw material (no recipe or explicitly raw)
             const recipes = mc.recipes[itemInfo.id];
             const rawMaterialsList = ["oak_log", "cobblestone", "sand", "coal", "dirt", "gravel"]; // Add more if needed
             const isRaw = (!recipes || recipes.length === 0 || rawMaterialsList.includes(itemName));

            if (isRaw) {
                // Add to final raw resource list
                rawResourcesNeeded[itemName] = (rawResourcesNeeded[itemName] || 0) + quantity;
                logBuild('debug', `[ResourceCalc] Added ${quantity} x ${itemName} to raw list.`);
            } else {
                // It's craftable, find recipe and add ingredients to next queue
                const recipe = recipes[0]; // Use first recipe found for calculation
                const yieldPerCraft = recipe.result?.count ?? 1;
                const craftsNeeded = Math.ceil(needed / yieldPerCraft); // 'needed' được tính ở đầu hàm
                if (craftsNeeded <= 0) return true; // Đã đủ số lượng
                logBuild('info', `[Crafting] Recipe for ${itemName} yields ${yieldPerCraft}. Need ${craftsNeeded} craft(s).`);

                // Add ingredients based on recipe type
                 if (recipe.ingredients) { // Shaped
                    const ingredientsCount = {};
                     recipe.ingredients.forEach(ing => {
                         if (!ing) return;
                         const ingItem = mc.items[ing.id] || mc.blocks[ing.id];
                         if(ingItem) ingredientsCount[ingItem.name] = (ingredientsCount[ingItem.name] || 0) + 1;
                     });
                     for (const ingName in ingredientsCount) {
                          const totalIngNeeded = ingredientsCount[ingName] * craftsNeeded;
                          nextQueue[ingName] = (nextQueue[ingName] || 0) + totalIngNeeded;
                          // logBuild('debug', `[ResourceCalc] -> Needs ${totalIngNeeded} x ${ingName}`);
                     }
                 } else if (recipe.delta) { // Shapeless
                      recipe.delta.forEach(delta => {
                          if (delta.count < 0) { // Is an ingredient
                              const ingItem = mc.items[delta.id] || mc.blocks[delta.id];
                              if (ingItem) {
                                   const totalIngNeeded = Math.abs(delta.count) * craftsNeeded;
                                   nextQueue[ingItem.name] = (nextQueue[ingItem.name] || 0) + totalIngNeeded;
                                   // logBuild('debug', `[ResourceCalc] -> Needs ${totalIngNeeded} x ${ingItem.name}`);
                              }
                          }
                      });
                 }
            }
             processed.add(itemName); // Mark this item as processed for this iteration
        }

        // Merge nextQueue into processingQueue for next iteration
        // This handles cases where an item is needed both directly and as an ingredient
        const currentQueueCombined = { ...processingQueue };
         for(const itemName in nextQueue) {
            // Only add if not already processed in *this specific pass* to avoid immediate loops on simple crafts (like log->planks)
            // Actually, we need to add it back to handle multi-step crafts. The `processed` set prevents infinite loops overall.
             currentQueueCombined[itemName] = (currentQueueCombined[itemName] || 0) + nextQueue[itemName];
             // Clear the quantity of items that were just processed in this loop
             if (processed.has(itemName)) {
                 delete currentQueueCombined[itemName]; // Remove processed item
             }
         }
         // Filter out items that were fully processed in this pass from the next iteration
          processingQueue = {};
          for(const itemName in currentQueueCombined){
               if(!processed.has(itemName)){ // Only keep items not processed in this iteration
                    processingQueue[itemName] = currentQueueCombined[itemName];
               }
          }
          // Add the newly discovered ingredients
           for(const itemName in nextQueue){
                processingQueue[itemName] = (processingQueue[itemName] || 0) + nextQueue[itemName];
           }


    } // End while loop

    if(iterations >= MAX_ITERATIONS) logBuild('error', "[ResourceCalc] Max iterations reached during craft resolution. Results might be incomplete.");

    // 3. Calculate Fuel Needs (Approximate)
    let fuelUnits = 0;
    // Fuel for smelting glass from sand
    fuelUnits += rawResourcesNeeded[SAND_TYPE] || 0; // 1 sand = 1 glass = 1 fuel unit
    // Fuel for potential charcoal crafting (assume 1 log -> 1 charcoal -> 8 units, need 1 unit per log)
    // This is complex, let's skip fuel for charcoal for now. EnsureFuel handles it.
    // Fuel for functional furnaces in blueprint? (Maybe for initial lighting?) - Skip for now.
    rawResourcesNeeded['FUEL_UNITS'] = Math.ceil(fuelUnits * 1.1); // Add 10% buffer

    // 4. Apply Buffer to all raw resources
    const bufferFactor = 1.15; // 15% buffer
    for (const key in rawResourcesNeeded) {
        if (key !== 'FUEL_UNITS') {
             rawResourcesNeeded[key] = Math.ceil(rawResourcesNeeded[key] * bufferFactor);
        }
    }


    logBuild('info', `--- Resource Calculation Complete ---`);
    logBuild('info', `Raw Resources Needed (Buffered): ${JSON.stringify(rawResourcesNeeded)}`);
    logBuild('info', `Items Directly in Blueprint: ${JSON.stringify(itemsInBlueprint)}`);
    logBuild('info', `------------------------------------`);

    return { resources: rawResourcesNeeded, craftQueue: itemsInBlueprint }; // Return raw needs and direct items
}


async function buildLayerFromBlueprint(blueprint, layerY, cornerPos) {
    if (await checkSafetyAndStop() || !blueprint || layerY < 0 || layerY >= blueprint.length) {
         logBuild('error', `Cannot build layer ${layerY}: Invalid input or task stopped.`);
         return false;
    }
    const layer = blueprint[layerY];
    if (!Array.isArray(layer)) {
         logBuild('error', `Blueprint data for layer ${layerY} is not an array.`);
         return false;
    }

    const layerAbsY = cornerPos.y + layerY;
    logBuild('info', `--- Starting Blueprint Layer Y=${layerAbsY} (Index ${layerY}) ---`);
    botRef.buildingState = `BUILDING_LAYER_${layerY}`;

    const layerDepth = layer.length; // Number of rows (Z direction)
    const layerWidth = layer[0]?.length || 0; // Number of columns in first row (X direction)

    for (let z = 0; z < layerDepth; z++) {
        if (!Array.isArray(layer[z])) {
             logBuild('warn', `Row Z=${z} in layer ${layerY} is not an array. Skipping row.`);
             continue;
        }
        for (let x = 0; x < layerWidth; x++) {
             if (await checkSafetyAndStop()) {
                  logBuild('warn', `Building stopped during layer ${layerY} at Z=${z}, X=${x}.`);
                  return false;
             }

             const blockData = layer[z][x]; // Get block data from blueprint [Z][X]
             let blockName = null;
             let blockState = {}; // Default empty state

             // Parse block data
             if (typeof blockData === 'string') {
                  blockName = blockData;
             } else if (typeof blockData === 'object' && blockData?.name) {
                  blockName = blockData.name;
                  if (blockData.state) blockState = { ...blockData.state }; // Copy state if provided
             }

             // Skip air or null blocks
             if (!blockName || blockName === 'air' || blockName === 'cave_air' || blockName === 'void_air') {
                  continue;
             }

             // Calculate absolute position to place the block
             const placePos = cornerPos.offset(x, layerY, z);

             // Check inventory space before placing (important for complex blocks)
              if (botRef.inventory.emptySlotCount() < INVENTORY_FULL_THRESHOLD) {
                logBuild('warn', `Inventory full before placing ${blockName} at ${formatCoords(placePos)}. Handling...`);
                if (!await handleInventoryFull()) {
                    logBuild('error', `Cannot handle full inventory. Stopping build at layer ${layerY}.`);
                    return false;
                }
                 if (await checkSafetyAndStop()) return false; // Check again after handling
             }


             // Attempt to place the block using placeBlockAttempt
             logBuild('debug', `Placing ${blockName} at ${formatCoords(placePos)} with state: ${JSON.stringify(blockState)}`);
             const placeContext = { state: blockState }; // Pass state info

             if (!(await placeBlockAttempt(placePos, blockName, placeContext))) {
                  logBuild('error', `Failed to place ${blockName} from blueprint at ${formatCoords(placePos)}. Stopping layer build.`);
                  // Should we try to recover? Or just stop? Stop for now.
                  return false;
             }

             // Small delay between placements can help prevent server issues/rate limiting
             await sleep(75); // 75ms delay

        } // End X loop
         // Optional: log progress after each row?
         // logBuild('debug', `Finished row Z=${z} of layer ${layerY}.`);
    } // End Z loop

    logBuild('info', `--- Finished Blueprint Layer Y=${layerAbsY} (Index ${layerY}) ---`);
    return true; // Layer completed successfully
}


// --- MAIN BUILD TASK ---

async function startBuildFromBlueprintTask(bot, username, blueprintToBuild) {
  mc = mcData(bot.version);
  if (!mc) { bot.chat("Error: Cannot load mcData for bot version. Build failed."); return; }
  if (!blueprintToBuild || !Array.isArray(blueprintToBuild) || blueprintToBuild.length === 0) {
      bot.chat("Error: Invalid or empty blueprint provided. Build failed."); return;
  }
  botRef = bot; // Set global bot reference

  // Reset state variables
  temporaryChests = [];
  scaffoldBlocksPlaced = [];
  isEvading = false;
  bot.blueprint = blueprintToBuild; // Store blueprint on bot object if needed elsewhere

  bot.chat(`Alright ${username}, starting the blueprint build! Let's get this structure up.`);
  bot.isBuilding = true;
  bot.buildingState = 'INITIALIZING';

  try {
    const buildStartTime = Date.now();

    // Determine build corner position
    const playerPos = bot.entity.position.floored();
    // Place corner slightly offset from player, Y level adjusted
    // Blueprint layer 0 will be at playerPos.y + TARGET_FLOOR_Y_OFFSET
    botRef.build_cornerPos = playerPos.offset(2, TARGET_FLOOR_Y_OFFSET, 2); // Offset X=2, Z=2 from player
    const cornerPos = botRef.build_cornerPos; // Use local variable for clarity

    logBuild('info', `Build corner determined: ${formatCoords(cornerPos)} (Floor Y=${cornerPos.y})`);
    bot.chat(`Starting build near ${formatCoords(cornerPos)}.`);
    await sleep(1000);

    // Initial cleanup (in case of previous failed build)
    await removeScaffold(); // Remove any leftover scaffold blocks first

    // --- Phase 1: Resource Calculation & Preparation ---
    botRef.buildingState = 'CALCULATING_RESOURCES';
    logBuild('info', "Step 1: Calculating required resources from blueprint...");
    const { resources: requiredRawResources, craftQueue: itemsToCraftFromBlueprint } = calculateResourcesFromBlueprint(blueprintToBuild);
    if (await checkSafetyAndStop()) throw new Error("Stopped during resource calculation.");
    if (Object.keys(requiredRawResources).length === 0 && Object.keys(itemsToCraftFromBlueprint).length === 0) {
         throw new Error("Blueprint seems empty or resource calculation failed.");
    }

    // --- Phase 2: Ensuring Tools ---
    botRef.buildingState = 'ENSURING_TOOLS';
    logBuild('info', "Step 2: Ensuring necessary tools are available...");
    if (!(await ensureTool(PICKAXE_PRIORITY)) || await checkSafetyAndStop()) throw new Error("Failed to ensure pickaxe.");
    if (!(await ensureTool(AXE_PRIORITY)) || await checkSafetyAndStop()) throw new Error("Failed to ensure axe.");
    if (!(await ensureTool(SHOVEL_PRIORITY)) || await checkSafetyAndStop()) throw new Error("Failed to ensure shovel.");
    logBuild('info', "-> Tools OK.");

    // --- Phase 3: Gathering Raw Resources ---
    botRef.buildingState = 'GATHERING_RESOURCES';
    logBuild('info', "Step 3: Gathering required raw resources...");
    for (const resourceName in requiredRawResources) {
        if (await checkSafetyAndStop()) throw new Error("Stopped during resource gathering.");
        const count = requiredRawResources[resourceName];
        if (count <= 0) continue; // Skip if 0 needed

        if (resourceName === 'FUEL_UNITS') { // Handle fuel separately if needed, ensureFuel handles gathering coal/logs
             logBuild('info', `Ensuring ${count} fuel units are available...`);
             if (!(await ensureFuel(count))) throw new Error(`Failed to ensure sufficient fuel (${count} units).`);
        } else {
            logBuild('info', `Ensuring ${count} x ${resourceName}...`);
            // Use ensureMaterial, which decides gathering vs crafting (but for raw, it gathers)
            if (!(await ensureMaterial(resourceName, count, false))) { // Force gathering, don't allow crafting raw items
                throw new Error(`Failed to gather enough ${resourceName} (${count} needed).`);
            }
        }
         if (await checkSafetyAndStop()) throw new Error(`Stopped after ensuring ${resourceName}.`);
    }
    logBuild('info', "-> Raw Resources Gathered OK.");


    // --- Phase 4: Ensuring Workstations & Pre-Crafting ---
    // Ensure crafting table and furnace exist OR are part of the blueprint/craft queue
    botRef.buildingState = 'ENSURING_WORKSTATIONS';
    logBuild('info', "Step 4: Ensuring workstations (Crafting Table, Furnace)...");
    let tableNeeded = false;
    let furnaceNeeded = (requiredRawResources['FUEL_UNITS'] > 0); // Furnace needed if smelting is required (e.g., for glass, charcoal)

    // Check if any item in the direct blueprint queue requires a table
    for (const itemName in itemsToCraftFromBlueprint) {
         const itemInfo = mc.itemsByName[itemName] || mc.blocksByName[itemName];
         if(itemInfo) {
              const recipes = mc.recipes[itemInfo.id];
              if (recipes?.some(r => r.requiresTable)) {
                   tableNeeded = true;
                   break;
              }
         }
    }
     // Check if Glass needs smelting (implies furnace needed)
     if (itemsToCraftFromBlueprint[GLASS_TYPE] > 0 || itemsToCraftFromBlueprint[WINDOW_MATERIAL] > 0) {
         furnaceNeeded = true;
     }
     // Also check if Charcoal crafting is needed (implies furnace)
     // This check is harder without simulating ensureFuel fully here. Assume furnace needed if fuel units > 0.

     if (tableNeeded && !itemsToCraftFromBlueprint[CRAFTING_TABLE_TYPE]) { // Need table, but not building one
          logBuild('info', "Crafting requires a table, ensuring one exists...");
          if (!(await findOrPlaceBlock(CRAFTING_TABLE_TYPE, cornerPos.offset(-1, 0, 0)))) { // Place nearby
               throw new Error("Failed to find or place a required Crafting Table.");
          }
     }
     if (furnaceNeeded && !itemsToCraftFromBlueprint[FURNACE_TYPE]) { // Need furnace, but not building one
          logBuild('info', "Smelting requires a furnace, ensuring one exists...");
           if (!(await findOrPlaceBlock(FURNACE_TYPE, cornerPos.offset(-1, 0, 1)))) { // Place nearby
               throw new Error("Failed to find or place a required Furnace.");
          }
     }
    logBuild('info', "-> Workstations OK (or will be built).");
    if (await checkSafetyAndStop()) throw new Error("Stopped after ensuring workstations.");


    botRef.buildingState = 'PREPARING_MATERIALS';
    logBuild('info', "Step 5: Preparing crafted materials (smelting, crafting complex items)...");
    // Smelt required glass first (as it's often needed for panes early)
    const glassNeeded = itemsToCraftFromBlueprint[GLASS_TYPE] || 0;
    const panesNeeded = itemsToCraftFromBlueprint[WINDOW_MATERIAL] || 0;
    // Calculate total glass needed: 1 per glass block + 6 per 16 panes (approx 0.375 glass per pane)
    const totalGlassToSmelt = Math.ceil(glassNeeded + (panesNeeded * 6 / 16));

    if (totalGlassToSmelt > 0) {
         logBuild('info', `Need to smelt ${totalGlassToSmelt} Glass from Sand...`);
         if (!(await ensureSmelted(GLASS_TYPE, totalGlassToSmelt, SAND_TYPE))) {
              throw new Error(`Failed to smelt enough ${GLASS_TYPE}.`);
         }
          if (await checkSafetyAndStop()) throw new Error("Stopped after smelting glass.");
    }

    // Pre-craft items listed directly in the blueprint (excluding functional blocks maybe?)
    // Using ensureMaterial ensures dependencies are handled.
    for (const itemName in itemsToCraftFromBlueprint) {
         if (await checkSafetyAndStop()) throw new Error("Stopped during pre-crafting phase.");
         const countNeeded = itemsToCraftFromBlueprint[itemName];
         if (countNeeded <= 0) continue;
         // Skip functional blocks we might have placed already? Or let ensureMaterial handle it?
         // Let ensureMaterial handle it - it checks count first.
         // Skip Glass as we just smelted it.
         if (itemName === GLASS_TYPE) continue;

         logBuild('info', `Ensuring ${countNeeded} x ${itemName} are crafted/available...`);
         if (!(await ensureMaterial(itemName, countNeeded, true))) { // Allow crafting
              throw new Error(`Failed to ensure ${countNeeded} of ${itemName} were available/crafted.`);
         }
         if (await checkSafetyAndStop()) throw new Error(`Stopped after ensuring ${itemName}.`);
    }
    logBuild('info', "-> Material Preparation OK.");


    // --- Phase 5: Building from Blueprint ---
    botRef.buildingState = 'BUILDING_STRUCTURE';
    logBuild('info', "Step 6: Starting structure build from blueprint layers...");
    const blueprintHeight = blueprintToBuild.length;
    for (let y = 0; y < blueprintHeight; y++) {
        if (await checkSafetyAndStop()) throw new Error(`Stopped before starting layer ${y}.`);

        // Build the layer
        if (!(await buildLayerFromBlueprint(blueprintToBuild, y, cornerPos))) {
             // Error occurred during layer build
             throw new Error(`Failed to complete blueprint layer ${y} (Absolute Y: ${cornerPos.y + y}). Build stopped.`);
        }

        logBuild('info', `---> Layer ${y} (Absolute Y: ${cornerPos.y + y}) Complete.`);
        // Optional pause between layers?
        await sleep(200);
    }
    logBuild('info', "-> Structure Build Complete.");

    // --- Phase 6: Final Cleanup ---
    botRef.buildingState = 'FINAL_CLEANUP';
    logBuild('info', "Step 7: Final cleanup phase...");

    // Retrieve items from temporary chests
    if (temporaryChests.length > 0) {
        logBuild('info', "Retrieving items from temporary chests...");
        if (!(await retrieveFromTemporaryChests())) {
             logBuild('warn', "Failed to retrieve all items from temporary chests or break them. Some items/chests may remain.");
        }
    }

     // Deposit remaining non-essential items into main chests (if available)
     logBuild('info', "Depositing any remaining non-essential items into main chests...");
     if (!(await depositNonEssentialItems(cornerPos))) { // Pass cornerPos to find main chests
         logBuild('warn', "Failed to deposit all non-essential items into main chests.");
     }

     // Remove any remaining scaffold blocks
     if (scaffoldBlocksPlaced.length > 0) {
        logBuild('info', "Removing remaining scaffold blocks...");
        if (!(await removeScaffold())) {
            logBuild('warn', "Failed to remove all scaffold blocks. Some may remain.");
        }
     }
    logBuild('info', "-> Cleanup Phase Complete.");


    // --- Completion ---
    const buildEndTime = Date.now();
    const durationMinutes = ((buildEndTime - buildStartTime) / 60000).toFixed(1);
    botRef.buildingState = 'DONE';
    bot.chat(`*** Blueprint Build COMPLETE! *** Structure finished near ${formatCoords(cornerPos)}. (Took ${durationMinutes} minutes)`);

  } catch (err) {
    console.error("[Build From Blueprint Error]", err); // Log full error to console
    bot.chat(`Build failed! Error: ${err.message}`);
    bot.chat("Stopping build task.");
    botRef.buildingState = 'ERROR';

    // Attempt emergency cleanup on error
    logBuild('error', "Attempting emergency cleanup after error...");
    try {
         if (temporaryChests.length > 0) {
             logBuild('error', "Trying to retrieve from temp chests after error...");
             await retrieveFromTemporaryChests();
         }
         if (scaffoldBlocksPlaced.length > 0) {
              logBuild('error', "Trying to remove scaffold after error...");
              await removeScaffold();
         }
    } catch(cleanupErr){
         logBuild('error', `Error during emergency cleanup: ${cleanupErr.message}`);
    }

  } finally {
    // Ensure state is reset regardless of success or failure
    logBuild('info', "Build task function finished.");
    if (botRef) {
        botRef.isBuilding = false;
        if (botRef.buildingState !== 'ERROR') botRef.buildingState = 'IDLE'; // Keep ERROR state if it failed
        botRef.build_cornerPos = null;
        botRef.blueprint = null;
        // Clear potentially stuck states
        try { if (botRef.pathfinder?.isMoving()) botRef.pathfinder.stop(); } catch (e) {}
        try { botRef.clearControlStates(); } catch (e) {}
    }
    // Clear global refs/state? Not strictly needed if bot instance is managed externally.
    // temporaryChests = []; scaffoldBlocksPlaced = []; // Already done in success/error paths mostly
    console.log("[Build Blueprint] Task execution sequence ended.");
  }
}

// Function to start build using the default blueprint defined above
async function startDefaultHouseBuild(bot, username) {
  logBuild('info', "Starting build with default 'houseBlueprint'.");
  return startBuildFromBlueprintTask(bot, username, houseBlueprint);
}

// Export the necessary functions
module.exports = {
  startBuildFromBlueprintTask, // For potentially using other blueprints later
  startDefaultHouseBuild,      // The primary command entry point using the built-in blueprint
  // Optional: Export blueprint if needed externally? Not usually necessary.
  // houseBlueprint
};