// commands/flatten_area.js
const { GoalNear, GoalBlock, GoalXZ, GoalY } = require("mineflayer-pathfinder").goals;
const { Movements } = require("mineflayer-pathfinder");
const { Vec3 } = require("vec3");
const { translateToEnglishId, formatCoords } = require("../utils");

const MAX_FLATTEN_WIDTH = 32;
const MAX_FLATTEN_DEPTH = 32;
const MAX_FLATTEN_VOLUME = 10000;
const DEFAULT_FLATTEN_SIZE = 16;
const DEFAULT_FILL_MATERIAL = 'dirt';
const SCAN_HEIGHT_ABOVE = 30;
const SCAN_DEPTH_BELOW = 5;
const MAX_CHEST_PLACE_ATTEMPTS = 5;
const MAX_INTERACTION_RETRIES = 2; // Reduce retries slightly for faster operation
const WAIT_TICKS_AFTER_ACTION = 1; // Reduce wait slightly
const WAIT_TICKS_BETWEEN_LAYERS = 3; // Reduce wait slightly

const IGNORED_BLOCKS_BREAK = new Set(['air', 'cave_air', 'void_air', 'water', 'lava']);
const IGNORED_BLOCKS_FILL = new Set(['air', 'cave_air', 'void_air', 'water', 'lava', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'vine', 'snow', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant']);
const VALUABLE_BLOCKS = new Set(['diamond_ore', 'deepslate_diamond_ore', 'emerald_ore', 'deepslate_emerald_ore', 'gold_ore', 'deepslate_gold_ore', 'ancient_debris', 'chest', 'trapped_chest', 'ender_chest', 'barrel', 'shulker_box', 'furnace', 'blast_furnace', 'smoker', 'enchanting_table', 'anvil', 'chipped_anvil', 'damaged_anvil', 'beacon', 'spawner']);
const GRAVITY_BLOCKS = new Set(['sand', 'red_sand', 'gravel', 'dragon_egg', 'suspicious_sand', 'suspicious_gravel', 'concrete_powder']);
const WOOD_LOGS = new Set();
const LEAVES = new Set();
const REPLACEABLE_PLANTS = new Set(['grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'vine', 'snow', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'pink_petals', 'short_grass']);
const FILL_MATERIAL_ALTERNATIVES = ['dirt', 'cobblestone', 'stone', 'sand', 'gravel', 'andesite', 'diorite', 'granite', 'deepslate', 'cobbled_deepslate', 'tuff'];
const SCAFFOLD_MATERIALS = ['dirt', 'cobblestone', 'netherrack', 'cobbled_deepslate']; // Materials bot can use for temporary scaffolding

async function flattenArea(bot, username, message, aiModel) {
    if (bot.isFlattening) {
        bot.chat(`${username}, tôi đang bận làm phẳng rồi, không thể bắt đầu cái mới.`);
        return;
    }

    bot.isFlattening = true;
    bot.flattenStopRequested = false;
    bot.flattenTemporaryChests = [];
    console.log(`[Flatten Cmd] ${username} yêu cầu làm phẳng: "${message}"`);

    const mcData = require('minecraft-data')(bot.version);
    if (!mcData) {
        bot.chat("Lỗi: Không thể tải dữ liệu Minecraft.");
        bot.isFlattening = false;
        return;
    }
    fillBlockSets(mcData);

    try {
        bot.chat(`${username}, nhận được yêu cầu. Đang phân tích...`);
        const parsedArgs = parseFlattenArguments_NonAI(bot, mcData, username, message);
        if (!parsedArgs) {
            throw new Error("Phân tích tham số thất bại.");
        }
        const { minCorner, maxCorner, targetY, fillEnabled, fillMaterialId, playerEntity, sizeString } = parsedArgs;
        console.log(`[Flatten Cmd] Parsed: Area[${formatCoords(minCorner)}->${formatCoords(maxCorner)}], TargetY=${targetY}, Fill=${fillEnabled}, FillMat=${fillMaterialId}, Player=${playerEntity?.username}`);

        const width = maxCorner.x - minCorner.x + 1;
        const depth = maxCorner.z - minCorner.z + 1;
        const scanHeight = maxCorner.y - minCorner.y + 1;
        const volume = width * depth * scanHeight;
        if (width > MAX_FLATTEN_WIDTH || depth > MAX_FLATTEN_DEPTH || volume > MAX_FLATTEN_VOLUME) {
            bot.chat(`${username}, khu vực yêu cầu (${width}x${depth}x${scanHeight}) quá lớn (Tối đa: ${MAX_FLATTEN_WIDTH}x${MAX_FLATTEN_DEPTH}, ${MAX_FLATTEN_VOLUME} khối quét).`);
            throw new Error("Khu vực quá lớn");
        }

        bot.chat(`${username}, đang quét khu vực ${sizeString} quanh bạn (Y=${targetY})...`);
        const scanResult = await scanAreaComprehensive(bot, mcData, minCorner, maxCorner, targetY, fillEnabled, fillMaterialId);
        if (!scanResult) throw new Error("Quét khu vực thất bại.");
        if (scanResult.abortReason) {
            bot.chat(`${username}, không thể làm phẳng: ${scanResult.abortReason}`);
            throw new Error(scanResult.abortReason);
        }

        const blocksToBreakSafe = scanResult.blocksToBreak || [];
        const positionsToFillSafe = scanResult.positionsToFill || [];
        const treesSafe = scanResult.trees || [];
        const liquidsSafe = scanResult.liquids || [];

        console.log(`[Flatten Cmd] Scan: Break=${blocksToBreakSafe.length}, Fill=${positionsToFillSafe.length}, Trees=${treesSafe.length}, Liquids=${liquidsSafe.length}`);

        if (blocksToBreakSafe.length === 0 && positionsToFillSafe.length === 0 && treesSafe.length === 0) {
            bot.chat(`${username}, khu vực này có vẻ đã ổn rồi!`);
            throw new Error("Khu vực đã phẳng/sạch");
        }

        const requiredTools = checkRequiredTools(bot, mcData, blocksToBreakSafe, treesSafe);
        if (!hasSufficientTools(bot, requiredTools)) {
            const missing = Object.entries(requiredTools)
                .filter(([_, needed]) => needed && !hasToolType(bot, _))
                .map(([toolType, _]) => toolType)
                .join(', ');
            bot.chat(`${username}, tôi thiếu dụng cụ cần thiết (${missing}) để hoàn thành công việc.`);
            throw new Error("Thiếu công cụ cần thiết");
        }

        let initialFillCount = 0;
        if (fillEnabled) {
            initialFillCount = bot.inventory.count(fillMaterialId, null);
            const estimatedFillNeededSafe = scanResult.estimatedFillNeeded || 0;
            if (initialFillCount < estimatedFillNeededSafe && initialFillCount < 10) {
                const fillMatName = mcData.items[fillMaterialId]?.displayName || 'vật liệu lấp';
                bot.chat(`${username}, tôi có rất ít ${fillMatName} (${initialFillCount}). Tôi sẽ cố dùng đồ đào được, nhưng có thể không đủ.`);
            } else if (initialFillCount > 0) {
                 const fillMatName = mcData.items[fillMaterialId]?.displayName || 'vật liệu lấp';
                 console.log(`[Flatten Cmd] Có ${initialFillCount} ${fillMatName} để bắt đầu lấp.`);
            }
        }

        bot.chat(`${username}, bắt đầu làm phẳng! (${blocksToBreakSafe.length} khối phá, ${positionsToFillSafe.length} chỗ lấp, ${treesSafe.length} cây). Dùng 'stop flatten' để dừng.`);
        await executeSmartFlatteningLayered(
            bot, mcData, scanResult, targetY, fillEnabled, fillMaterialId, username
        );

        if (bot.flattenStopRequested) {
             bot.chat(`${username}, đã dừng làm phẳng theo yêu cầu.`);
        } else {
            bot.chat(`${username}, đã làm phẳng xong khu vực!`);
            if (bot.flattenTemporaryChests.length > 0) {
                bot.chat(`Tôi đã đặt ${bot.flattenTemporaryChests.length} rương tạm chứa đồ tại: ${bot.flattenTemporaryChests.map(formatCoords).join(', ')}`);
            }
        }

    } catch (error) {
        console.error(`[Flatten Cmd] Lỗi: ${error.message}`);
        if (!error.message.includes("đã phẳng/sạch") && !error.message.includes("Phân tích tham số thất bại") && !error.message.includes("Khu vực quá lớn") && !error.message.includes("Thiếu công cụ") && !error.message.includes("đã dừng")) {
            bot.chat(`${username}, có lỗi khi làm phẳng: ${error.message}`);
        }
        try { if (bot.pathfinder?.isMoving()) bot.pathfinder.stop(); } catch (e) { }

    } finally {
        bot.isFlattening = false;
        bot.flattenStopRequested = false;
        console.log("[Flatten Cmd] Kết thúc xử lý.");
    }
}

function parseFlattenArguments_NonAI(bot, mcData, username, message) {
    console.log(`[Flatten Parse] Bắt đầu phân tích cho username: "${username}"`);
    let playerEntity = null;
    let foundUsername = null;
    const usernameWithDot = username.startsWith('.') ? username : '.' + username;
    const usernameWithoutDot = username.startsWith('.') ? username.substring(1) : username;

    if (bot.players[usernameWithDot]) {
        playerEntity = bot.players[usernameWithDot].entity;
        foundUsername = usernameWithDot;
        console.log(`[Flatten Parse] Tìm thấy trực tiếp với dấu chấm: ${foundUsername}`);
    } else if (bot.players[usernameWithoutDot]) {
        playerEntity = bot.players[usernameWithoutDot].entity;
        foundUsername = usernameWithoutDot;
        console.log(`[Flatten Parse] Tìm thấy trực tiếp không có dấu chấm: ${foundUsername}`);
    } else {
        console.log("[Flatten Parse] Không tìm thấy trực tiếp, thử tìm không phân biệt hoa/thường...");
        const lowerUsernameWithDot = usernameWithDot.toLowerCase();
        const lowerUsernameWithoutDot = usernameWithoutDot.toLowerCase();
        for (const pName in bot.players) {
            const lowerPName = pName.toLowerCase();
            if (lowerPName === lowerUsernameWithDot || lowerPName === lowerUsernameWithoutDot) {
                playerEntity = bot.players[pName]?.entity;
                foundUsername = pName;
                console.log(`[Flatten Parse] Tìm thấy không phân biệt hoa/thường: ${foundUsername}`);
                break;
            }
        }
    }

    if (!playerEntity) {
        bot.chat(`${username}, tôi không tìm thấy bạn ở đâu cả! Bạn có ở gần đây không?`);
        console.error(`[Flatten Parse] Không tìm thấy thực thể người chơi cho username: ${username}`);
        return null;
    }

    console.log(`[Flatten Parse] Sử dụng thực thể của người chơi: ${foundUsername}`);
    const playerPos = playerEntity.position.floored();
    let basePos = playerPos;

    let size = DEFAULT_FLATTEN_SIZE;
    let targetY = basePos.y - 1;
    let fillEnabled = true;
    let fillMaterialId = mcData.itemsByName[DEFAULT_FILL_MATERIAL]?.id;
    if (!fillMaterialId) {
         console.error(`Lỗi: Không tìm thấy ID cho vật liệu lấp mặc định '${DEFAULT_FILL_MATERIAL}'`);
         fillMaterialId = mcData.itemsByName['dirt']?.id;
    }

    let sizeString = `${size}x${size}`;
    let minCorner, maxCorner;

    const sizeMatch = message.match(/(\d+)\s*x\s*(\d+)/i) || message.match(/(\d+)/);
    const coordsMatch = message.match(/(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/);
    const yMatch = message.match(/tại y\s*(-?\d+)/i);
    const noFillMatch = message.match(/không lấp/i);
    const fillMatMatch = message.match(/lấp bằng\s+(.+)/i);

    if (coordsMatch) {
        const [_, x1, y1, z1, x2, y2, z2] = coordsMatch.map(Number);
        minCorner = new Vec3(Math.min(x1, x2), Math.min(y1, y2), Math.min(z1, z2));
        maxCorner = new Vec3(Math.max(x1, x2), Math.max(y1, y2), Math.max(z1, z2));
        targetY = Math.floor((y1 + y2) / 2);
        sizeString = `${maxCorner.x - minCorner.x + 1}x${maxCorner.z - minCorner.z + 1}`;
        console.log("[Flatten Parse] Sử dụng tọa độ tuyệt đối.");
    } else if (sizeMatch) {
        const w = parseInt(sizeMatch[1], 10);
        const d = sizeMatch[2] ? parseInt(sizeMatch[2], 10) : w;
        size = Math.max(w, d);
        sizeString = `${w}x${d}`;
        const halfW = Math.floor(w / 2);
        const halfD = Math.floor(d / 2);
        minCorner = basePos.offset(-halfW, 0, -halfD);
        maxCorner = basePos.offset(w - halfW - 1, 0, d - halfD - 1);
        console.log(`[Flatten Parse] Sử dụng kích thước tương đối ${sizeString} quanh ${formatCoords(basePos)}.`);
    } else {
        const halfSize = Math.floor(size / 2);
        minCorner = basePos.offset(-halfSize, 0, -halfSize);
        maxCorner = basePos.offset(size - halfSize - 1, 0, size - halfSize - 1);
        console.log(`[Flatten Parse] Sử dụng kích thước mặc định ${sizeString} quanh ${formatCoords(basePos)}.`);
    }

    if (yMatch) {
        targetY = parseInt(yMatch[1], 10);
        console.log(`[Flatten Parse] Sử dụng Y mục tiêu = ${targetY}.`);
    } else if (!coordsMatch) {
         targetY = basePos.y - 1;
         console.log(`[Flatten Parse] Sử dụng Y mục tiêu mặc định = ${targetY} (dưới chân người chơi).`);
    }

    minCorner.y = targetY - SCAN_DEPTH_BELOW;
    maxCorner.y = Math.max(targetY, maxCorner.y) + SCAN_HEIGHT_ABOVE;

    if (noFillMatch) {
        fillEnabled = false;
        console.log("[Flatten Parse] Chức năng lấp bị tắt.");
    }
    if (fillMatMatch) {
        const materialNameVi = fillMatMatch[1].trim();
        const materialId = translateToEnglishId(materialNameVi);
        const itemData = mcData.itemsByName[materialId] || mcData.blocksByName[materialId];
        if (itemData && mcData.blocks[itemData.id]) {
            fillMaterialId = itemData.id;
            fillEnabled = true;
            console.log(`[Flatten Parse] Sử dụng vật liệu lấp: ${materialNameVi} (ID: ${fillMaterialId}).`);
        } else {
            bot.chat(`Tôi không biết vật liệu "${materialNameVi}" là gì hoặc không thể dùng để lấp.`);
            console.warn(`[Flatten Parse] Không tìm thấy vật liệu lấp "${materialNameVi}", dùng mặc định.`);
        }
    }

    return { minCorner, maxCorner, targetY, fillEnabled, fillMaterialId, playerEntity, sizeString };
}

async function scanAreaComprehensive(bot, mcData, minC, maxC, targetY, fillEnabled, fillMatId) {
    console.log(`[Flatten Scan] Bắt đầu quét từ ${formatCoords(minC)} đến ${formatCoords(maxC)}, TargetY=${targetY}`);
    const blocksToBreak = [];
    const positionsToFill = [];
    const trees = new Map();
    const liquids = [];
    const valuablesFound = [];
    let estimatedFillNeeded = 0;
    let maxYFound = minC.y;
    const world = bot.world;

    for (let y = maxC.y; y >= minC.y; y--) {
        for (let x = minC.x; x <= maxC.x; x++) {
            for (let z = minC.z; z <= maxC.z; z++) {
                const pos = new Vec3(x, y, z);
                const block = await world.getBlock(pos);

                if (!block) continue;

                maxYFound = Math.max(maxYFound, y);

                if (block.name === 'lava') {
                    liquids.push({ pos: pos, type: 'lava' });
                    if (y >= targetY - 1) {
                        for (let dx = -1; dx <= 1; dx++) {
                            for (let dz = -1; dz <= 1; dz++) {
                                if (dx === 0 && dz === 0) continue;
                                const checkX = x + dx;
                                const checkZ = z + dz;
                                if (checkX >= minC.x && checkX <= maxC.x && checkZ >= minC.z && checkZ <= maxC.z) {
                                    console.warn(`[Flatten Scan] Phát hiện dung nham tại ${formatCoords(pos)} gần khu vực làm việc!`);
                                    return { abortReason: `Phát hiện dung nham nguy hiểm gần ${formatCoords(pos)}` };
                                }
                            }
                        }
                         if (y === targetY) {
                              console.warn(`[Flatten Scan] Phát hiện dung nham tại ${formatCoords(pos)} ngay tại Y mục tiêu!`);
                              return { abortReason: `Phát hiện dung nham nguy hiểm tại ${formatCoords(pos)} (Y=${targetY})` };
                         }
                    }
                } else if (block.name === 'water') {
                    liquids.push({ pos: pos, type: 'water' });
                }

                if (VALUABLE_BLOCKS.has(block.name)) {
                    valuablesFound.push(block);
                    continue;
                }

                if (WOOD_LOGS.has(block.name)) {
                    let baseLogPos = pos;
                    while (true) {
                        const blockBelow = await world.getBlock(baseLogPos.offset(0, -1, 0));
                        if (blockBelow && WOOD_LOGS.has(blockBelow.name)) {
                            baseLogPos = baseLogPos.offset(0, -1, 0);
                        } else {
                            break;
                        }
                    }
                    const baseKey = formatCoords(baseLogPos);
                    if (!trees.has(baseKey)) {
                        trees.set(baseKey, { logs: [], leaves: [], basePos: baseLogPos });
                    }
                    if (trees.get(baseKey)) {
                         if (!Array.isArray(trees.get(baseKey).logs)) trees.get(baseKey).logs = [];
                         trees.get(baseKey).logs.push(block);
                    }
                    continue;
                }
                if (LEAVES.has(block.name)) {
                    let closestTreeKey = null;
                    let minDistSq = 100;
                    for (const [key, treeData] of trees.entries()) {
                        if (treeData && treeData.basePos) {
                            const distSq = pos.distanceSquared(treeData.basePos);
                            if (distSq < minDistSq) {
                                minDistSq = distSq;
                                closestTreeKey = key;
                            }
                        }
                    }
                    if (closestTreeKey) {
                        const treeEntry = trees.get(closestTreeKey);
                        if (treeEntry) {
                            if (!Array.isArray(treeEntry.leaves)) treeEntry.leaves = [];
                            treeEntry.leaves.push(block);
                        }
                    }
                }

                if (y > targetY) {
                    if (!IGNORED_BLOCKS_BREAK.has(block.name) && !LEAVES.has(block.name) && !WOOD_LOGS.has(block.name)) {
                        blocksToBreak.push({ pos, block });
                    }
                } else if (fillEnabled && y <= targetY) {
                    if (IGNORED_BLOCKS_FILL.has(block.name) || REPLACEABLE_PLANTS.has(block.name)) {
                        if (!valuablesFound.some(vb => vb.position.equals(pos))) {
                            positionsToFill.push(pos);
                            estimatedFillNeeded++;
                        }
                    }
                }
            }
        }
        if (y % 10 === 0) await bot.waitForTicks(1);
    }

    const treeBlocks = new Set();
    const treeDataArray = [];
    for (const tree of trees.values()) {
        if (tree && Array.isArray(tree.logs) && Array.isArray(tree.leaves)) {
            tree.logs.forEach(b => { if (b?.position) treeBlocks.add(formatCoords(b.position)); });
            tree.leaves.forEach(b => { if (b?.position) treeBlocks.add(formatCoords(b.position)); });
            treeDataArray.push(tree);
        }
    }

    let finalBlocksToBreak = blocksToBreak.filter(item => item?.pos && !treeBlocks.has(formatCoords(item.pos)));

     for (let y = maxYFound; y > targetY; y--) {
         for (let x = minC.x; x <= maxC.x; x++) {
             for (let z = minC.z; z <= maxC.z; z++) {
                 const pos = new Vec3(x, y, z);
                 const posKey = formatCoords(pos);
                 if (treeBlocks.has(posKey) || finalBlocksToBreak.some(b => b.pos.equals(pos))) continue;

                 const block = await world.getBlock(pos);
                 if (block && LEAVES.has(block.name) && !VALUABLE_BLOCKS.has(block.name)) {
                      finalBlocksToBreak.push({pos, block});
                 }
                 else if (block && REPLACEABLE_PLANTS.has(block.name) && !VALUABLE_BLOCKS.has(block.name)) {
                     finalBlocksToBreak.push({pos, block});
                 }
             }
         }
     }

    console.log(`[Flatten Scan] Quét hoàn tất. Y cao nhất tìm thấy: ${maxYFound}`);
    return {
        blocksToBreak: finalBlocksToBreak,
        positionsToFill,
        trees: treeDataArray,
        liquids,
        valuablesFound,
        estimatedFillNeeded,
        maxYFound,
        abortReason: null
    };
}

function checkRequiredTools(bot, mcData, blocksToBreak, trees) {
    const tools = { pickaxe: false, axe: false, shovel: false, shears: false };
    blocksToBreak = blocksToBreak || [];
    trees = trees || [];

    const blocks = blocksToBreak
        .filter(item => item && typeof item === 'object' && item.block && typeof item.block === 'object')
        .map(item => item.block);

    let needsShears = false;

    if (trees.length > 0) {
        tools.axe = true;
        if (trees.some(tree => tree && typeof tree === 'object' && Array.isArray(tree.leaves) && tree.leaves.length > 0)) {
            needsShears = true;
        }
    }
    if (blocks.some(b => b && typeof b === 'object' && typeof b.name === 'string' && LEAVES.has(b.name))) {
        needsShears = true;
    }
    if (blocks.some(b => b && typeof b === 'object' && typeof b.name === 'string' && (b.name.includes('vine') || b.name.includes('petals')))) {
        needsShears = true;
    }

    if (needsShears && hasToolType(bot, 'shears')) {
        tools.shears = true;
    }

    for (const block of blocks) {
        if (tools.pickaxe && tools.axe && tools.shovel) break;

        const harvestTools = block.harvestTools;
        if (!harvestTools || typeof harvestTools !== 'object') continue;

        for (const toolId in harvestTools) {
            const id = parseInt(toolId, 10);
            if (isNaN(id)) continue;
            const tool = mcData.items[id];
            if (!tool || typeof tool !== 'object' || typeof tool.name !== 'string') continue;

            if (tool.name.includes('pickaxe')) tools.pickaxe = true;
            else if (tool.name.includes('axe')) tools.axe = true;
            else if (tool.name.includes('shovel')) tools.shovel = true;
        }
    }
    const shovelMaterials = ['dirt', 'grass_block', 'sand', 'gravel', 'clay', 'soul_sand', 'soul_soil', 'mycelium', 'podzol'];
    if (!tools.shovel && blocks.some(b => b && typeof b === 'object' && typeof b.name === 'string' && shovelMaterials.includes(b.name))) {
        tools.shovel = true;
    }

    console.log('[Flatten Tools] Công cụ cần thiết:', tools);
    return tools;
}

function hasSufficientTools(bot, requiredTools) {
    for (const toolType in requiredTools) {
        if (requiredTools[toolType] && !hasToolType(bot, toolType)) {
            if (toolType === 'shears') {
                console.warn("[Flatten Tools] Thiếu kéo (shears), việc phá lá/cây cỏ sẽ chậm hơn.");
                continue;
            }
            return false;
        }
    }
    return true;
}

function hasToolType(bot, toolType) {
    return bot.inventory.items().some(item => item && typeof item.name === 'string' && item.name.includes(toolType));
}

async function executeSmartFlatteningLayered(bot, mcData, scanResult, targetY, fillEnabled, fillMaterialId, username) {
    let blocksToBreak = scanResult.blocksToBreak || [];
    let positionsToFill = scanResult.positionsToFill || [];
    let trees = scanResult.trees || [];
    let maxYFound = scanResult.maxYFound;

    let currentFillMaterialId = fillMaterialId;
    let availableFillCount = fillEnabled ? bot.inventory.count(currentFillMaterialId, null) : 0;

    const originalThinkTimeout = bot.pathfinder.thinkTimeout;
    const originalTickTimeout = bot.pathfinder.tickTimeout;
    bot.pathfinder.thinkTimeout = 8000;
    bot.pathfinder.tickTimeout = 80;
    console.log(`[Pathfinder Timeout] Tăng tạm thời: think=${bot.pathfinder.thinkTimeout}, tick=${bot.pathfinder.tickTimeout}`);

    const movements = new Movements(bot, mcData);
    movements.allowFreeMotion = true;
    movements.canDig = true;
    movements.allowSprinting = true;
    movements.allowParkour = false;
    movements.maxDropDown = 4;
    movements.allow1by1towers = true;
    movements.canPlace = true;
    bot.pathfinder.setMovements(movements);

    const processedTreeBlocks = new Set();

    try {
        if (trees.length > 0) {
            bot.chat(`Tìm thấy ${trees.length} cây, đang xử lý...`);
            trees.sort((a, b) => {
                const posA = a?.basePos ?? bot.entity.position;
                const posB = b?.basePos ?? bot.entity.position;
                return bot.entity.position.distanceSquared(posA) - bot.entity.position.distanceSquared(posB);
            });

            for (const tree of trees) {
                if (bot.flattenStopRequested) throw new Error("Đã dừng bởi người dùng.");
                if (tree?.basePos) {
                    console.log(`[Flatten Exec] Xử lý cây tại ${formatCoords(tree.basePos)}`);
                    await processTree(bot, mcData, tree, processedTreeBlocks);
                    await ensureInventorySpace(bot, mcData);
                } else {
                    console.warn("[Flatten Exec] Bỏ qua cây không hợp lệ trong danh sách.");
                }
            }
            bot.chat("Xử lý cây hoàn tất.");
        }

        const remainingBlocksToBreak = blocksToBreak.filter(item => item?.pos && !processedTreeBlocks.has(formatCoords(item.pos)));
        if (remainingBlocksToBreak.length > 0) {
            bot.chat(`Bắt đầu phá ${remainingBlocksToBreak.length} khối còn lại theo lớp...`);
            const validYCoords = remainingBlocksToBreak.map(b => b?.pos?.y).filter(y => typeof y === 'number');
            const actualMaxY = validYCoords.length > 0 ? Math.max(targetY + 1, ...validYCoords) : targetY + 1;
            let brokenCount = 0;

            for (let y = actualMaxY; y > targetY; y--) {
                if (bot.flattenStopRequested) throw new Error("Đã dừng bởi người dùng.");
                const blocksOnLayer = remainingBlocksToBreak.filter(item => item?.pos?.y === y);
                if (blocksOnLayer.length === 0) continue;

                bot.chat(`Đang xử lý lớp Y=${y} (${blocksOnLayer.length} khối)...`);
                sortBlocksByXZDistance(blocksOnLayer, bot.entity.position);

                for (const blockData of blocksOnLayer) {
                    const { pos, block } = blockData || {};
                    if (!pos || !block || bot.flattenStopRequested) continue;

                    const currentBlock = bot.blockAt(pos);
                    if (!currentBlock || currentBlock.type !== block.type || VALUABLE_BLOCKS.has(currentBlock.name)) {
                        continue;
                    }

                    console.log(`[Flatten Exec] Mục tiêu: ${block.name} tại ${formatCoords(pos)}`);

                    console.log(`[Flatten Exec] Thử di chuyển đến gần ${block.name}...`);
                    const reachedNear = await gotoNear(bot, pos, 4.0);

                    if (!reachedNear) {
                         if (canReachBlock(bot, pos, 4.5)) {
                              console.log(`[Flatten Exec] gotoNear thất bại nhưng đã trong tầm với ${block.name}.`);
                         } else {
                              console.warn(`[Flatten Exec] Không thể đến gần ${block.name} tại ${formatCoords(pos)} và ngoài tầm với. Bỏ qua.`);
                              await bot.waitForTicks(2);
                              continue;
                         }
                    } else {
                         console.log(`[Flatten Exec] Đã đến gần ${block.name}.`);
                    }

                    console.log(`[Flatten Exec] Thử đào ${block.name}...`);
                    await ensureInventorySpace(bot, mcData);
                    if (await safeDig(bot, mcData, currentBlock)) {
                        brokenCount++;
                        console.log(`[Flatten Exec] Đào thành công ${block.name} tại ${formatCoords(pos)}.`);
                        await bot.waitForTicks(WAIT_TICKS_AFTER_ACTION);
                    } else {
                        console.warn(`[Flatten Exec] safeDig thất bại cho ${block.name} tại ${formatCoords(pos)} ở lớp ${y}.`);
                        try { await bot.lookAt(pos.offset(0.5, 0.5, 0.5), true); } catch(e) {}
                        await bot.waitForTicks(3);
                    }
                }
                await bot.waitForTicks(WAIT_TICKS_BETWEEN_LAYERS);
            }
            bot.chat(`Phá khối theo lớp hoàn tất (${brokenCount} khối).`);
        } else {
             console.log("[Flatten Exec] Không còn khối nào cần phá sau khi xử lý cây.");
        }

        if (fillEnabled && positionsToFill.length > 0) {
             bot.chat(`Bắt đầu lấp ${positionsToFill.length} vị trí theo lớp...`);
             const validFillYCoords = positionsToFill.map(p => p?.y).filter(y => typeof y === 'number');
             const minYToFill = validFillYCoords.length > 0 ? Math.min(...validFillYCoords) : targetY;
             const maxYToFill = targetY;
             let filledCount = 0;

             console.log(`[Flatten Fill] Lấp từ Y=${minYToFill} đến Y=${maxYToFill}`);

             for (let y = minYToFill; y <= maxYToFill; y++) {
                 if (bot.flattenStopRequested) throw new Error("Đã dừng bởi người dùng.");
                 const positionsOnLayer = positionsToFill.filter(pos => pos?.y === y);
                 if (positionsOnLayer.length === 0) continue;

                 bot.chat(`Đang lấp lớp Y=${y} (${positionsOnLayer.length} vị trí)...`);
                 sortPositionsByXZDistance(positionsOnLayer, bot.entity.position);

                 for (const pos of positionsOnLayer) {
                     if (!pos || bot.flattenStopRequested) continue;

                     const currentBlock = bot.blockAt(pos);
                     if (!currentBlock || (!IGNORED_BLOCKS_FILL.has(currentBlock.name) && !REPLACEABLE_PLANTS.has(currentBlock.name))) {
                         console.log(`[Flatten Fill] Bỏ qua ${formatCoords(pos)} (không cần lấp).`);
                         continue;
                     }

                     const materialInfo = await findOrSwitchFillMaterial(bot, mcData, currentFillMaterialId, availableFillCount);
                     if (!materialInfo) {
                         bot.chat("Đã hết vật liệu lấp phù hợp. Sẽ không lấp nữa.");
                         fillEnabled = false;
                         break;
                     }
                     currentFillMaterialId = materialInfo.id;
                     availableFillCount = materialInfo.count;

                     console.log(`[Flatten Fill] Thử lấp tại ${formatCoords(pos)} bằng ${mcData.items[currentFillMaterialId]?.name}`);

                     let placeSuccess = false;
                     const blockBelow = bot.blockAt(pos.offset(0, -1, 0));

                     if (blockBelow && blockBelow.boundingBox === 'block' && !IGNORED_BLOCKS_FILL.has(blockBelow.name)) {
                         console.log(`[Flatten Fill] Ưu tiên 1: Đặt lên trên khối dưới (${blockBelow.name}).`);
                         if (await safePlaceSimple(bot, mcData, pos, currentFillMaterialId, blockBelow, new Vec3(0, 1, 0))) {
                             placeSuccess = true;
                         } else {
                              console.warn(`[Flatten Fill] Đặt lên trên khối dưới thất bại.`);
                         }
                     }

                     if (!placeSuccess) {
                         const placeOptions = findPlacementReferenceHorizontal(bot, pos);
                         if (placeOptions) {
                             console.log(`[Flatten Fill] Ưu tiên 2: Đặt vào mặt bên của (${placeOptions.referenceBlock.name}).`);
                             if (await safePlaceSimple(bot, mcData, pos, currentFillMaterialId, placeOptions.referenceBlock, placeOptions.faceVector)) {
                                 placeSuccess = true;
                             } else {
                                  console.warn(`[Flatten Fill] Đặt vào mặt bên thất bại.`);
                             }
                         }
                     }

                     if (!placeSuccess) {
                         console.log(`[Flatten Fill] Ưu tiên 3: Thử đặt khối tạm (scaffolding) cho ${formatCoords(pos)}.`);
                         const scaffoldResult = await placeWithScaffold(bot, mcData, pos, currentFillMaterialId);
                         if (scaffoldResult) {
                             placeSuccess = true;
                         } else {
                             console.error(`[Flatten Fill] Đặt khối tạm thất bại cho ${formatCoords(pos)}.`);
                         }
                     }

                     if (placeSuccess) {
                         availableFillCount--;
                         filledCount++;
                         console.log(`[Flatten Fill] Lấp thành công tại ${formatCoords(pos)}.`);
                         await bot.waitForTicks(WAIT_TICKS_AFTER_ACTION);
                     } else {
                         console.error(`[Flatten Fill] Không thể lấp vị trí ${formatCoords(pos)} sau khi thử các cách.`);
                         await bot.waitForTicks(3);
                     }
                 }
                  if (!fillEnabled) break;
                 await bot.waitForTicks(WAIT_TICKS_BETWEEN_LAYERS);
             }
              if (fillEnabled) {
                  bot.chat(`Lấp vị trí theo lớp hoàn tất (${filledCount} khối).`);
              }
        } else if (!fillEnabled) {
            console.log("[Flatten Exec] Bỏ qua bước lấp (đã tắt hoặc hết vật liệu).");
        } else {
            console.log("[Flatten Exec] Không có vị trí nào cần lấp.");
        }

        console.log("[Flatten Exec] Thực thi hoàn tất.");

    } finally {
        bot.pathfinder.thinkTimeout = originalThinkTimeout;
        bot.pathfinder.tickTimeout = originalTickTimeout;
        console.log(`[Pathfinder Timeout] Đã khôi phục giá trị gốc.`);
    }
}

async function processTree(bot, mcData, tree, processedTreeBlocks) {
    if (!tree?.basePos || !Array.isArray(tree.logs) || !Array.isArray(tree.leaves)) {
        console.warn("[Process Tree] Dữ liệu cây không hợp lệ, bỏ qua.");
        return;
    }

    const { logs, leaves, basePos } = tree;
    const validLogs = logs.filter(l => l?.position);
    const validLeaves = leaves.filter(l => l?.position);

    if (validLogs.length === 0) return;

    validLogs.sort((a, b) => a.position.y - b.position.y);

    console.log(`[Process Tree] Di chuyển đến cây tại ${formatCoords(basePos)}...`);
    if (!await gotoNear(bot, basePos, 3.5)) {
        console.warn(`[Process Tree] Không thể đến gần gốc cây tại ${formatCoords(basePos)}`);
        if (!canReachBlock(bot, basePos, 4.0)) {
             console.error(`[Process Tree] Ngoài tầm với gốc cây, không thể xử lý cây này.`);
             return;
        }
        console.log("[Process Tree] Đã đủ gần gốc cây dù gotoNear lỗi.");
    }

    const axe = findBestTool(bot, mcData, 'axe');
    console.log(`[Process Tree] Chặt ${validLogs.length} gỗ...`);
    for (const log of validLogs) {
        if (bot.flattenStopRequested) return;
        const currentBlock = bot.blockAt(log.position);
        if (!currentBlock || !WOOD_LOGS.has(currentBlock.name)) continue;

        console.log(`[Process Tree] Thử đào gỗ tại ${formatCoords(log.position)}`);
        if (await safeDig(bot, mcData, currentBlock, axe)) {
             processedTreeBlocks.add(formatCoords(log.position));
             console.log(`[Process Tree] Đào thành công gỗ tại ${formatCoords(log.position)}`);
             await bot.waitForTicks(WAIT_TICKS_AFTER_ACTION);
        } else {
             console.warn(`[Process Tree] Không thể chặt khối gỗ tại ${formatCoords(log.position)}`);
             break;
        }
    }

    if (validLeaves.length > 0) {
        console.log(`[Process Tree] Dọn ${validLeaves.length} lá...`);
        const shears = findBestTool(bot, mcData, 'shears');
        const leafTool = shears || findBestTool(bot, mcData, 'hoe') || findBestTool(bot, mcData, 'shovel');

        const sortedLeaves = validLeaves.sort((a, b) => b.position.y - a.position.y);

        for (const leaf of sortedLeaves) {
             if (bot.flattenStopRequested) return;
             const currentBlock = bot.blockAt(leaf.position);
             if (!currentBlock || !LEAVES.has(currentBlock.name)) continue;

             console.log(`[Process Tree] Thử phá lá tại ${formatCoords(leaf.position)}`);
             if (await safeDig(bot, mcData, currentBlock, leafTool)) {
                  processedTreeBlocks.add(formatCoords(leaf.position));
                  console.log(`[Process Tree] Phá thành công lá tại ${formatCoords(leaf.position)}`);
                  await bot.waitForTicks(1);
             } else {
                  console.warn(`[Process Tree] Không thể phá lá tại ${formatCoords(leaf.position)}`);
             }
        }
    }
    console.log(`[Process Tree] Xử lý cây tại ${formatCoords(basePos)} hoàn tất.`);
}

function canReachBlock(bot, blockPos, maxDistance = 4.5) {
    if (!blockPos) return false;
    try {
        const headPos = bot.entity.position.offset(0, bot.entity.height, 0);
        const blockCenter = blockPos.offset(0.5, 0.5, 0.5);
        return headPos.distanceTo(blockCenter) <= maxDistance;
    } catch (e) {
        console.error(`[canReachBlock] Error calculating distance to ${formatCoords(blockPos)}: ${e.message}`);
        return false;
    }
}

async function safeDig(bot, mcData, blockToDig, preferredTool = null) {
    if (!blockToDig?.position || !blockToDig?.name) {
        console.warn("[Safe Dig] Invalid blockToDig provided.");
        return false;
    }
    const blockName = blockToDig.name;
    const blockPos = blockToDig.position;
    let retries = 0;
    const isBreakablePlant = REPLACEABLE_PLANTS.has(blockName) && !LEAVES.has(blockName);
    const isLeaf = LEAVES.has(blockName);
    const MAX_RETRIES_SAFE_DIG = (isLeaf || isBreakablePlant) ? 1 : MAX_INTERACTION_RETRIES;

    while (retries < MAX_RETRIES_SAFE_DIG) {
        if (bot.flattenStopRequested) return false;

        const currentBlock = bot.blockAt(blockPos);
        if (!currentBlock || currentBlock.type !== blockToDig.type) {
            console.log(`[Safe Dig] Khối ${blockName} tại ${formatCoords(blockPos)} đã thay đổi hoặc biến mất.`);
            return true;
        }

        const blockAbove = bot.blockAt(blockPos.offset(0, 1, 0));
        if (blockAbove && GRAVITY_BLOCKS.has(blockAbove.name)) {
            console.log(`[Safe Dig] Phát hiện khối trọng lực (${blockAbove.name}) phía trên ${blockName}. Đào khối đó trước.`);
            const gravityTool = findBestTool(bot, mcData, blockAbove);
            if (!await safeDig(bot, mcData, blockAbove, gravityTool)) {
                console.warn(`[Safe Dig] Không thể đào khối trọng lực phía trên. Bỏ qua khối gốc ${blockName}.`);
                return false;
            }
            console.log(`[Safe Dig] Đào xong khối trọng lực, kiểm tra lại ${blockName}...`);
            await bot.waitForTicks(3);
            continue;
        }

        let canCurrentlyReach = canReachBlock(bot, blockPos, 4.5);

        if (!canCurrentlyReach) {
            console.log(`[Safe Dig] Ngoài tầm với ${blockName}, thử di chuyển nội bộ...`);
            if (await gotoNear(bot, blockPos, 4.0)) {
                 console.log(`[Safe Dig] Di chuyển nội bộ thành công.`);
                 canCurrentlyReach = canReachBlock(bot, blockPos, 4.5);
            } else {
                 console.warn(`[Safe Dig] Di chuyển nội bộ thất bại.`);
            }
        }

        if (canCurrentlyReach) {
            try {
                await bot.lookAt(blockPos.offset(0.5, 0.5, 0.5), true);
            } catch (lookError) { console.warn(`[Safe Dig] Lỗi lookAt ${blockName}: ${lookError.message}`); }

            let toolToEquip = null;
            if (isLeaf) {
                toolToEquip = findBestTool(bot, mcData, 'shears') || findBestTool(bot, mcData, 'hoe') || findBestTool(bot, mcData, 'shovel');
            } else if (isBreakablePlant) {
                 toolToEquip = findBestTool(bot, mcData, 'hoe') || findBestTool(bot, mcData, 'shovel') || findBestTool(bot, mcData, 'axe');
            } else {
                toolToEquip = preferredTool || findBestTool(bot, mcData, currentBlock);
            }

            if (toolToEquip) {
                try {
                    if (!bot.heldItem || bot.heldItem.type !== toolToEquip.type) {
                        await bot.equip(toolToEquip, 'hand');
                        await bot.waitForTicks(1);
                    }
                } catch (equipError) {
                    console.error(`[Safe Dig] Lỗi trang bị ${toolToEquip.name}: ${equipError.message}`);
                }
            }

            let canActuallyDig = bot.canDigBlock(currentBlock);
            console.log(`[Safe Dig] Kiểm tra ${blockName}: canReach=${canCurrentlyReach}, canDigBlock=${canActuallyDig}`);

            if (canActuallyDig) {
                console.log(`[Safe Dig] Thực hiện đào ${blockName}...`);
                try {
                    await bot.dig(currentBlock);
                    return true;
                } catch (digError) {
                    console.warn(`[Safe Dig] Lỗi khi đào ${blockName} (lần ${retries + 1}): ${digError.message}`);
                    const blockAfterError = bot.blockAt(blockPos);
                    if (!blockAfterError || blockAfterError.type !== currentBlock.type) {
                        console.log(`[Safe Dig] Khối ${blockName} đã biến mất sau lỗi đào.`);
                        return true;
                    }
                }
            } else {
                 console.warn(`[Safe Dig] Không thể đào ${blockName} (canDigBlock trả về false).`);
                 try { await bot.lookAt(blockPos.offset(0.5, 0.5, 0.5), true); } catch(e) {}
            }
        } else {
             console.warn(`[Safe Dig] Vẫn ngoài tầm với ${blockName} sau khi thử di chuyển.`);
        }

        retries++;
        console.log(`[Safe Dig] Thử lại đào ${blockName} lần ${retries}/${MAX_RETRIES_SAFE_DIG}...`);
        await bot.waitForTicks((isLeaf || isBreakablePlant) ? 2 : 3 * (retries + 1));

    }

    console.error(`[Safe Dig] Đào thất bại ${blockName} tại ${formatCoords(blockPos)} sau ${MAX_RETRIES_SAFE_DIG} lần thử.`);
    return false;
}

async function safePlaceSimple(bot, mcData, targetPos, materialId, referenceBlock, faceVector) {
     if (!targetPos || !materialId || !referenceBlock || !faceVector) {
          console.error("[Safe Place Simple] Thiếu tham số đầu vào.");
          return false;
     }
    let retries = 0;
    const MAX_RETRIES_SIMPLE = 2;

    while (retries < MAX_RETRIES_SIMPLE) {
        if (bot.flattenStopRequested) return false;

        if (!await gotoNear(bot, referenceBlock.position, 4.0)) {
             if (!canReachBlock(bot, referenceBlock.position, 4.5)) {
                console.warn(`[Safe Place Simple] Không thể đến gần tham chiếu ${referenceBlock.name}.`);
                return false;
             }
        }

        try {
            const lookTarget = referenceBlock.position.offset(0.5 + faceVector.x * 0.5, 0.5 + faceVector.y * 0.5, 0.5 + faceVector.z * 0.5);
            await bot.lookAt(lookTarget, true);
        } catch (lookError) { console.warn(`[Safe Place Simple] Lỗi lookAt: ${lookError.message}`);}

        const materialItem = bot.inventory.findInventoryItem(materialId, null);
        if (!materialItem) {
            console.error(`[Safe Place Simple] Lỗi logic: Không tìm thấy vật liệu ${materialId}.`);
            return false;
        }
        try {
             if (!bot.heldItem || bot.heldItem.type !== materialItem.type) {
                await bot.equip(materialItem, 'hand');
                await bot.waitForTicks(1);
             }
        } catch (equipError) {
            console.error(`[Safe Place Simple] Lỗi trang bị vật liệu ${materialId}: ${equipError.message}`);
            retries++;
            await bot.waitForTicks(3 * (retries + 1));
            continue;
        }

        try {
            const targetBlockNow = bot.blockAt(targetPos);
            if (!targetBlockNow || (!IGNORED_BLOCKS_FILL.has(targetBlockNow.name) && !REPLACEABLE_PLANTS.has(targetBlockNow.name))) {
                 console.warn(`[Safe Place Simple] Vị trí ${formatCoords(targetPos)} không còn hợp lệ ngay trước khi đặt.`);
                 return false;
            }
            await bot.placeBlock(referenceBlock, faceVector);
            return true;
        } catch (placeError) {
            console.warn(`[Safe Place Simple] Lỗi khi đặt tại ${formatCoords(targetPos)} (lần ${retries + 1}): ${placeError.message}`);
            retries++;
            const blockAfterError = bot.blockAt(targetPos);
            if (blockAfterError && !IGNORED_BLOCKS_FILL.has(blockAfterError.name) && !REPLACEABLE_PLANTS.has(blockAfterError.name)) {
                 console.log("[Safe Place Simple] Vị trí đã bị chiếm sau lỗi đặt.");
                 return false;
            }
            await bot.waitForTicks(3 * (retries + 1));
        }
    }
    console.error(`[Safe Place Simple] Đặt thất bại tại ${formatCoords(targetPos)} sau ${MAX_RETRIES_SIMPLE} lần thử.`);
    return false;
}

function findPlacementReferenceHorizontal(bot, targetPos) {
    const searchOffsets = [
        { offset: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) },
        { offset: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) },
        { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) },
        { offset: new Vec3(0, 0, 1), face: new Vec3(0, 0, -1) },
    ];

    for (const { offset, face } of searchOffsets) {
        const refPos = targetPos.plus(offset);
        const refBlock = bot.blockAt(refPos);
        if (refBlock && refBlock.boundingBox === 'block' && !IGNORED_BLOCKS_FILL.has(refBlock.name) && !REPLACEABLE_PLANTS.has(refBlock.name)) {
             const blockAtTarget = bot.blockAt(targetPos);
             if (blockAtTarget && (IGNORED_BLOCKS_FILL.has(blockAtTarget.name) || REPLACEABLE_PLANTS.has(blockAtTarget.name))) {
                 return { referenceBlock: refBlock, faceVector: face };
             }
        }
    }
    return null;
}

function findTemporaryMaterial(bot, mcData) {
    for (const matName of SCAFFOLD_MATERIALS) {
        const itemData = mcData.itemsByName[matName];
        if (itemData) {
            const item = bot.inventory.findInventoryItem(itemData.id, null);
            if (item) {
                return item;
            }
        }
    }
    return null; // No suitable scaffold material found
}

function findScaffoldPlacementSpot(bot, targetPos) {
    const horizontalOffsets = [
        { offset: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) }, // Place scaffold to the East, place fill from West
        { offset: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) }, // Place scaffold to the West, place fill from East
        { offset: new Vec3(0, 0, 1), face: new Vec3(0, 0, -1) }, // Place scaffold to the South, place fill from North
        { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) }, // Place scaffold to the North, place fill from South
    ];

    for (const { offset, face } of horizontalOffsets) {
        const scaffoldPos = targetPos.plus(offset);
        const blockAtScaffold = bot.blockAt(scaffoldPos);
        const blockBelowScaffold = bot.blockAt(scaffoldPos.offset(0, -1, 0));

        // Scaffold position must be air/replaceable, and block below it must be solid
        if (blockAtScaffold && (IGNORED_BLOCKS_FILL.has(blockAtScaffold.name) || REPLACEABLE_PLANTS.has(blockAtScaffold.name)) &&
            blockBelowScaffold && blockBelowScaffold.boundingBox === 'block' && !IGNORED_BLOCKS_FILL.has(blockBelowScaffold.name))
        {
            // Return the position to place the scaffold, the block to place it ON, and the face vector TO the target
            return {
                scaffoldPos: scaffoldPos,
                refBlockBelow: blockBelowScaffold, // Block to place scaffold ON
                placeOnFace: new Vec3(0, 1, 0),    // Face to place scaffold ON (always up)
                fillFace: face                     // Face vector from scaffold TOWARDS targetPos
            };
        }
    }
    return null; // No suitable spot found
}

async function placeWithScaffold(bot, mcData, targetPos, fillMaterialId) {
    console.log(`[Scaffold] Attempting scaffold placement for ${formatCoords(targetPos)}`);

    // 1. Find temporary material
    const scaffoldMaterialItem = findTemporaryMaterial(bot, mcData);
    if (!scaffoldMaterialItem) {
        console.error("[Scaffold] Không tìm thấy vật liệu tạm (dirt, cobblestone...).");
        return false;
    }
    console.log(`[Scaffold] Using ${scaffoldMaterialItem.name} as temporary material.`);

    // 2. Find a place to put the scaffold block
    const scaffoldSpotInfo = findScaffoldPlacementSpot(bot, targetPos);
    if (!scaffoldSpotInfo) {
        console.error(`[Scaffold] Không tìm thấy vị trí phù hợp để đặt khối tạm xung quanh ${formatCoords(targetPos)}.`);
        return false;
    }
    const { scaffoldPos, refBlockBelow, placeOnFace, fillFace } = scaffoldSpotInfo;
    console.log(`[Scaffold] Found spot at ${formatCoords(scaffoldPos)}, placing on ${refBlockBelow.name} at ${formatCoords(refBlockBelow.position)}.`);

    // 3. Place the scaffold block
    console.log(`[Scaffold] Placing temporary ${scaffoldMaterialItem.name} at ${formatCoords(scaffoldPos)}...`);
    if (!await safePlaceSimple(bot, mcData, scaffoldPos, scaffoldMaterialItem.type, refBlockBelow, placeOnFace)) {
        console.error(`[Scaffold] Đặt khối tạm thất bại.`);
        return false; // Failed to place scaffold
    }
    console.log(`[Scaffold] Placed temporary block.`);
    await bot.waitForTicks(2); // Wait for block update

    // 4. Place the actual fill block using the scaffold as reference
    const scaffoldBlock = bot.blockAt(scaffoldPos);
    if (!scaffoldBlock || scaffoldBlock.type !== scaffoldMaterialItem.type) {
        console.error(`[Scaffold] Khối tạm không xuất hiện hoặc sai loại tại ${formatCoords(scaffoldPos)}!`);
        // Attempt to break whatever is there just in case
        if(scaffoldBlock && scaffoldBlock.type !==0) await safeDig(bot, mcData, scaffoldBlock);
        return false;
    }

    console.log(`[Scaffold] Placing fill material at ${formatCoords(targetPos)} using scaffold...`);
    let fillPlaceSuccess = false;
    if (await safePlaceSimple(bot, mcData, targetPos, fillMaterialId, scaffoldBlock, fillFace)) {
        console.log(`[Scaffold] Placed fill material successfully.`);
        fillPlaceSuccess = true;
    } else {
        console.error(`[Scaffold] Đặt khối lấp chính thức thất bại sau khi đặt khối tạm.`);
        // Still need to break the scaffold block even if fill failed
    }

    // 5. Break the scaffold block
    console.log(`[Scaffold] Breaking temporary block at ${formatCoords(scaffoldPos)}...`);
    const scaffoldTool = findBestTool(bot, mcData, scaffoldBlock); // Find appropriate tool
    if (await safeDig(bot, mcData, scaffoldBlock, scaffoldTool)) {
        console.log(`[Scaffold] Broke temporary block successfully.`);
    } else {
        console.error(`[Scaffold] Không thể phá khối tạm tại ${formatCoords(scaffoldPos)}! Có thể cần can thiệp thủ công.`);
        // Don't return false here, the main goal (placing fill block) might have succeeded
    }

    return fillPlaceSuccess; // Return true only if the *fill* block placement was successful
}


async function ensureInventorySpace(bot, mcData) {
    // Check if inventory has 0 empty slots
    if (bot.inventory.emptySlotCount() === 0) {
        bot.chat("Túi đồ đầy, đang tìm chỗ đặt rương tạm...");
        console.log("[Inventory] Túi đồ đầy.");

        let chestPos = null;
        let placeAttempts = 0;
        while (!chestPos && placeAttempts < MAX_CHEST_PLACE_ATTEMPTS) {
            placeAttempts++;
            const searchRadius = 2 + placeAttempts;
            const potentialPos = await findSafePlacementSpot(bot, bot.entity.position, searchRadius);
            if (potentialPos) {
                chestPos = potentialPos;
            } else {
                await bot.waitForTicks(10);
            }
        }

        if (!chestPos) {
            bot.chat("Không tìm được chỗ an toàn để đặt rương tạm!");
            console.error("[Inventory] Không thể tìm vị trí đặt rương.");
            throw new Error("Không thể đặt rương tạm khi túi đồ đầy.");
        }

        console.log(`[Inventory] Tìm thấy vị trí đặt rương tại ${formatCoords(chestPos)}.`);

        let craftingTable = await findNearbyBlock(bot, mcData, 'crafting_table', 5);
        if (!craftingTable) {
            console.log("[Inventory] Không có bàn chế tạo gần, thử chế tạo...");
            if (await ensureItem(bot, mcData, 'crafting_table', 1, null)) {
                 const tableItem = bot.inventory.findInventoryItem(mcData.itemsByName['crafting_table'].id, null);
                 const tablePos = await findSafePlacementSpot(bot, chestPos, 3);
                 if (tablePos && tableItem) {
                     const refBlock = bot.blockAt(tablePos.offset(0,-1,0));
                     if (refBlock && refBlock.boundingBox === 'block') {
                          try {
                               await bot.equip(tableItem, 'hand');
                               await bot.placeBlock(refBlock, new Vec3(0, 1, 0));
                               craftingTable = bot.blockAt(tablePos);
                               console.log(`[Inventory] Đã đặt bàn chế tạo tại ${formatCoords(tablePos)}.`);
                               await bot.waitForTicks(5);
                          } catch(e) {console.error("Lỗi đặt bàn chế tạo:", e);}
                     }
                 }
            }
        }
        if (!craftingTable) {
             craftingTable = await findNearbyBlock(bot, mcData, 'crafting_table', 5);
             if (!craftingTable) {
                  bot.chat("Tôi không có bàn chế tạo và không làm được, không thể tạo rương!");
                  throw new Error("Thiếu bàn chế tạo để làm rương.");
             }
        }

        if (!await ensureItem(bot, mcData, 'chest', 1, craftingTable)) {
            bot.chat("Tôi không làm được rương (thiếu gỗ?).");
            throw new Error("Không thể chế tạo rương.");
        }

        const chestItem = bot.inventory.findInventoryItem(mcData.itemsByName['chest'].id, null);
        const chestRefBlock = bot.blockAt(chestPos.offset(0, -1, 0));
        if (!chestItem || !chestRefBlock || chestRefBlock.boundingBox !== 'block') {
             console.error(`[Inventory] Cannot place chest: Item=${!!chestItem}, RefBlock=${!!chestRefBlock}, RefType=${chestRefBlock?.name}`);
             throw new Error("Không thể đặt rương (không có item hoặc vị trí không hợp lệ).");
        }
        try {
            await gotoNear(bot, chestRefBlock.position, 3);
            await bot.equip(chestItem, 'hand');
            await bot.placeBlock(chestRefBlock, new Vec3(0, 1, 0));
            console.log(`[Inventory] Đã đặt rương tạm tại ${formatCoords(chestPos)}.`);
            bot.flattenTemporaryChests.push(chestPos);
            await bot.waitForTicks(10);
        } catch (placeError) {
            console.error("[Inventory] Lỗi khi đặt rương:", placeError);
            throw new Error("Không thể đặt rương tạm.");
        }

        const chestBlock = bot.blockAt(chestPos);
        if (!chestBlock || !chestBlock.name.includes('chest')) {
             await bot.waitForTicks(20);
             const chestBlockAgain = bot.blockAt(chestPos);
             if (!chestBlockAgain || !chestBlockAgain.name.includes('chest')) {
                  console.error(`[Inventory] Không tìm thấy rương vừa đặt tại ${formatCoords(chestPos)}? Found: ${chestBlockAgain?.name}`);
                  throw new Error("Không tìm thấy rương vừa đặt?");
             }
        }

        try {
            console.log(`[Inventory] Mở rương tại ${formatCoords(chestPos)}...`);
            const chestToOpen = bot.blockAt(chestPos);
            if (!chestToOpen) throw new Error("Rương biến mất trước khi mở?");
            const chestWindow = await bot.openChest(chestToOpen);
            console.log("[Inventory] Đang đổ đồ vào rương tạm...");
            const itemsToKeep = new Set();
            bot.inventory.items().forEach(item => {
                 if (item.name.includes('_axe') || item.name.includes('_pickaxe') || item.name.includes('_shovel') || item.name.includes('shears')) {
                      itemsToKeep.add(item.type);
                 }
            });
            if (fillEnabled && currentFillMaterialId) { // Use global currentFillMaterialId if available
                 itemsToKeep.add(currentFillMaterialId);
            }

            const itemsToDeposit = bot.inventory.items().filter(item => !itemsToKeep.has(item.type));

            for (const item of itemsToDeposit) {
                try {
                    if (chestWindow.emptySlotCount() === 0) {
                         console.warn("[Inventory] Rương tạm đã đầy.");
                         break;
                    }
                    await chestWindow.deposit(item.type, item.metadata, item.count);
                    await bot.waitForTicks(1);
                } catch (depositError) {
                    console.warn(`[Inventory] Lỗi khi deposit ${item.name}: ${depositError.message}`);
                    if (depositError.message.includes('full')) break;
                    await bot.waitForTicks(2);
                }
            }
            await chestWindow.close();
            console.log("[Inventory] Đổ đồ vào rương tạm hoàn tất.");
            bot.chat("Đã đặt rương tạm và đổ bớt đồ.");
        } catch (openError) {
            console.error("[Inventory] Lỗi khi mở/đóng rương:", openError);
            bot.chat("Gặp lỗi khi dùng rương tạm, tôi sẽ cố tiếp tục.");
        }
    }
}

async function findSafePlacementSpot(bot, centerPos, radius) {
    for (let r = 1; r <= radius; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (r > 1 && Math.abs(dx) < r && Math.abs(dz) < r) continue;

                const checkPos = centerPos.floored().offset(dx, 0, dz);
                const blockAt = bot.blockAt(checkPos);
                const blockBelow = bot.blockAt(checkPos.offset(0, -1, 0));
                const blockAbove = bot.blockAt(checkPos.offset(0, 1, 0));
                const blockTwoAbove = bot.blockAt(checkPos.offset(0, 2, 0));

                if (blockAt && blockAt.type === 0 &&
                    blockBelow && blockBelow.boundingBox === 'block' &&
                    blockAbove && blockAbove.type === 0 &&
                    blockTwoAbove && blockTwoAbove.type === 0) {
                    let safe = true;
                    for (let ox = -1; ox <= 1; ox++) {
                         for (let oz = -1; oz <= 1; oz++) {
                              for (let oy = -1; oy <= 1; oy++) {
                                   if (ox === 0 && oy === 0 && oz === 0) continue;
                                   const nearBlock = bot.blockAt(checkPos.offset(ox, oy, oz));
                                   if (nearBlock && (nearBlock.name === 'lava' || nearBlock.name === 'water' || nearBlock.name === 'fire' || nearBlock.name === 'cactus')) {
                                        safe = false; break;
                                   }
                              }
                              if (!safe) break;
                         }
                          if (!safe) break;
                    }
                    if (safe) return checkPos;
                }
            }
        }
        await bot.waitForTicks(1);
    }
    return null;
}

async function ensureItem(bot, mcData, itemName, quantity = 1, craftingTable = null) {
    const itemData = mcData.itemsByName[itemName];
    if (!itemData) return false;

    if (bot.inventory.count(itemData.id, null) >= quantity) {
        return true;
    }

    const recipes = bot.recipesFor(itemData.id, null, 1, craftingTable);
    if (!recipes || recipes.length === 0) {
        console.warn(`[Ensure Item] Không tìm thấy công thức cho ${itemName}.`);
        return false;
    }
    const recipe = recipes[0];

    const currentInvCount = bot.inventory.count(itemData.id, null);
    const needed = quantity - currentInvCount;
    if (needed <= 0) return true;

    const craftsNeeded = Math.ceil(needed / recipe.result.count);

    if (recipe.delta) {
        let canProceed = true;

        for (const item of recipe.delta) {
            if (item.count < 0) {
                const requiredCount = -item.count * craftsNeeded;
                const currentCount = bot.inventory.count(item.id, null);

                if (currentCount < requiredCount) {
                    const requiredItemData = mcData.items[item.id];
                    console.warn(`[Ensure Item] Thiếu nguyên liệu (${requiredItemData?.name ?? `ID ${item.id}`}). Cần: ${requiredCount}, Có: ${currentCount} cho ${itemName}`);

                    let subCraftAttempted = false;
                    if (requiredItemData?.name.includes('_planks') && !itemName.includes('_planks')) {
                        subCraftAttempted = true;
                        console.log(`[Ensure Item] Thử chế tạo ván gỗ (${requiredItemData.name}) từ gỗ...`);
                        if (await ensureItem(bot, mcData, requiredItemData.name, requiredCount - currentCount, craftingTable)) {
                             if (bot.inventory.count(item.id, null) >= requiredCount) {
                                  console.log(`[Ensure Item] Chế tạo ván gỗ thành công.`);
                             } else {
                                  console.warn(`[Ensure Item] Chế tạo ván gỗ thất bại hoặc không đủ sau khi thử.`);
                                  canProceed = false;
                                  break;
                             }
                        } else {
                             console.warn(`[Ensure Item] Lỗi khi gọi ensureItem cho ván gỗ.`);
                             canProceed = false;
                             break;
                        }
                    }

                    if (!subCraftAttempted && bot.inventory.count(item.id, null) < requiredCount) {
                         console.error(`[Ensure Item] Không thể chế tạo phụ và vẫn thiếu ${requiredItemData?.name ?? `ID ${item.id}`}.`);
                         canProceed = false;
                         break;
                    }
                     else if (subCraftAttempted && bot.inventory.count(item.id, null) < requiredCount) {
                          // Handled by break above
                     }
                }
            }
        }

        if (!canProceed) {
            console.error(`[Ensure Item] Không thể tiếp tục chế tạo ${itemName} do thiếu nguyên liệu.`);
            return false;
        }

    } else {
         console.warn(`[Ensure Item] Công thức ${itemName} không có delta, không thể kiểm tra nguyên liệu.`);
         return false;
    }

    try {
        console.log(`[Ensure Item] Bắt đầu chế tạo ${craftsNeeded} lần ${itemName}...`);
        if (recipe.requiresTable && !craftingTable) {
             craftingTable = await findNearbyBlock(bot, mcData, 'crafting_table', 4);
             if (!craftingTable) {
                  console.error("[Ensure Item] Cần bàn chế tạo nhưng không tìm thấy gần đó!");
                  return false;
             }
             console.log(`[Ensure Item] Sử dụng bàn chế tạo tại ${formatCoords(craftingTable.position)}`);
        }
        await bot.craft(recipe, craftsNeeded, craftingTable);
        await bot.waitForTicks(5);
        if (bot.inventory.count(itemData.id, null) >= quantity) {
            console.log(`[Ensure Item] Chế tạo ${itemName} thành công.`);
            return true;
        } else {
             console.warn(`[Ensure Item] Chế tạo ${itemName} nhưng số lượng không đủ sau đó? Có: ${bot.inventory.count(itemData.id, null)}, Cần: ${quantity}`);
             return false;
        }
    } catch (craftError) {
        console.error(`[Ensure Item] Lỗi khi chế tạo ${itemName}: ${craftError.message}`);
        try { await bot.closeWindow(bot.currentWindow || bot.inventory); } catch(e) {}
        return false;
    }
}

async function findOrSwitchFillMaterial(bot, mcData, currentMatId, currentCount) {
    if (currentCount > 0) return { id: currentMatId, count: currentCount };

    for (const matName of FILL_MATERIAL_ALTERNATIVES) {
        const altItemData = mcData.itemsByName[matName];
        if (!altItemData || altItemData.id === currentMatId) continue;

        const count = bot.inventory.count(altItemData.id, null);
        if (count > 0) {
            const altName = altItemData.displayName || altItemData.name;
            bot.chat(`Hết vật liệu cũ, chuyển sang dùng ${altName}.`);
            console.log(`[Fill Material] Chuyển sang dùng ${altName} (ID: ${altItemData.id}), có ${count}.`);
            return { id: altItemData.id, count: count };
        }
    }
    console.log("[Fill Material] Không tìm thấy vật liệu lấp thay thế nào trong túi đồ.");
    return null;
}

function findBestTool(bot, mcData, blockOrType) {
    let requiredType = null;
    let blockId = null;
    let blockName = null;
    let blockMaterial = null;

    if (typeof blockOrType === 'string') {
        requiredType = blockOrType;
    } else if (blockOrType?.type) {
        blockId = blockOrType.type;
        blockName = blockOrType.name;
        blockMaterial = blockOrType.material;
    } else {
        return null;
    }

    let bestTool = null;
    let highestScore = -1;

    for (const item of bot.inventory.items()) {
        if (!item?.name) continue;

        let score = 0;
        let isCorrectCategory = false;

        if (requiredType) {
            isCorrectCategory = item.name.includes(requiredType);
        }
        else if (blockId) {
            const harvestTools = mcData.blocks[blockId]?.harvestTools;
            if (harvestTools && harvestTools[item.type]) {
                isCorrectCategory = true;
            }
            if (!isCorrectCategory) {
                if ((blockMaterial === 'web' || LEAVES.has(blockName) || blockName?.includes('vine') || blockName?.includes('petals')) && item.name.includes('shears')) {
                    isCorrectCategory = true;
                    score += 50;
                } else if ((REPLACEABLE_PLANTS.has(blockName) || blockMaterial === 'plant') && item.name.includes('hoe')) {
                     isCorrectCategory = true;
                     score += 5;
                }
            }
        }

        if (isCorrectCategory) {
            if (item.name.includes('netherite_')) score += 5;
            else if (item.name.includes('diamond_')) score += 4;
            else if (item.name.includes('iron_')) score += 3;
            else if (item.name.includes('stone_')) score += 2;
            else if (item.name.includes('wooden_') || item.name.includes('gold_')) score += 1;

            if (item.nbt?.value?.Enchantments?.value?.value) {
                 const efficiency = item.nbt.value.Enchantments.value.value.find(e => e?.id?.value === 'minecraft:efficiency');
                 if (efficiency?.lvl?.value) {
                      score += efficiency.lvl.value * 0.5;
                 }
            }

            if (score > highestScore) {
                highestScore = score;
                bestTool = item;
            }
        }
    }
    return bestTool;
}

async function findNearbyBlock(bot, mcData, blockName, maxDistance = 16) {
    const blockData = mcData.blocksByName[blockName];
    if (!blockData) return null;
    try {
        const blocks = await bot.findBlocks({
            matching: blockData.id,
            maxDistance: maxDistance,
            count: 1
        });
        if (blocks.length > 0) {
            return bot.blockAt(blocks[0]);
        }
    } catch (e) {
        console.error(`[findNearbyBlock] Error finding ${blockName}: ${e.message}`);
    }
    return null;
}

function fillBlockSets(mcData) {
    WOOD_LOGS.clear();
    LEAVES.clear();
    mcData.blocksArray.forEach(block => {
        if (!block || !block.name) return;
        if (block.material === 'wood' && (block.name.includes('_log') || block.name.includes('_wood') || block.name.includes('stem') || block.name.includes('hyphae'))) {
             if (!block.name.includes('stripped_') && !block.name.includes('planks')) {
                 WOOD_LOGS.add(block.name);
             }
        } else if (block.material === 'leaves' || block.name.includes('_leaves')) {
            LEAVES.add(block.name);
        }
    });
}

function sortBlocksByXZDistance(blocks, botPos) {
    if (!Array.isArray(blocks)) return;
    blocks.sort((a, b) => {
        const posA = a?.pos ?? botPos;
        const posB = b?.pos ?? botPos;
        const distA = Math.pow(posA.x - botPos.x, 2) + Math.pow(posA.z - botPos.z, 2);
        const distB = Math.pow(posB.x - botPos.x, 2) + Math.pow(posB.z - botPos.z, 2);
        return distA - distB;
    });
}

function sortPositionsByXZDistance(positions, botPos) {
     if (!Array.isArray(positions)) return;
     positions.sort((a, b) => {
        const posA = a ?? botPos;
        const posB = b ?? botPos;
        const distA = Math.pow(posA.x - botPos.x, 2) + Math.pow(posA.z - botPos.z, 2);
        const distB = Math.pow(posB.x - botPos.x, 2) + Math.pow(posB.z - botPos.z, 2);
        return distA - distB;
    });
}

async function gotoNear(bot, targetPos, distance) {
     if (!targetPos) {
          console.warn("[gotoNear] Invalid targetPos provided.");
          return false;
     }
    try {
        const goal = new GoalNear(targetPos.x, targetPos.y, targetPos.z, distance);
        await bot.pathfinder.goto(goal);
        return true;
    } catch (err) {
        try {
            const currentDistance = bot.entity.position.distanceTo(targetPos);
            if (currentDistance <= distance + 0.5) {
                try { if (bot.pathfinder.isMoving()) bot.pathfinder.stop(); } catch(e){}
                return true;
            }
        } catch (distError) {
             console.error(`[gotoNear] Error calculating distance after path fail: ${distError.message}`);
        }
        return false;
    }
}

function stopFlatten(bot, username) {
    if (bot.isFlattening && !bot.flattenStopRequested) {
        bot.flattenStopRequested = true;
        bot.chat(`${username}, OK, đang yêu cầu dừng việc làm phẳng...`);
        console.log(`[Flatten Cmd] Nhận lệnh dừng từ ${username}.`);
        try { if (bot.pathfinder?.isMoving()) bot.pathfinder.stop(); } catch (e) { }
    } else if (bot.flattenStopRequested) {
         bot.chat(`${username}, tôi đang dừng rồi.`);
    } else {
        bot.chat(`${username}, tôi không đang làm phẳng.`);
    }
}

module.exports = {
    flattenArea,
    stopFlatten,
};