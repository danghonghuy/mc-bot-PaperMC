// --- START OF FILE commands/auto_torch.js ---
const { Vec3 } = require('vec3');
const { sleep } = require('../utils');
const craftCommands = require('./craft');

const TORCH_LIGHT_THRESHOLD = 2;
const PLACEMENT_LIGHT_THRESHOLD = 5;
const CHECK_DISTANCE = 5;
const PLACE_COOLDOWN_MS = 2000;
const MIN_TORCH_DISTANCE = 5; // Khoảng cách tối thiểu giữa các đuốc
const REQUIRED_COAL = 1;
const REQUIRED_STICK = 1;
const TORCH_CRAFT_AMOUNT = 8;

const ENABLE_CREATE_SPOT = true;
const CREATE_SPOT_BLOCK_NAME = 'dirt';
const ENABLE_MOVE_TO_PLACE = true;
const SEARCH_FURTHER_DISTANCE = 10;

let botInstance = null;
let aiModelInstance = null;
let lastPlaceTime = 0;
let isProcessingAutoTorch = false;

function initializeAutoTorch(bot, aiModel) {
    botInstance = bot;
    aiModelInstance = aiModel;
    isProcessingAutoTorch = false;
    lastPlaceTime = 0;
    console.log("[Auto Torch] Đã khởi tạo. 🔥");

    if (!aiModelInstance) {
        console.warn("[Auto Torch] Cảnh báo: aiModel không được cung cấp! Chế tạo tự động sẽ không hoạt động. ⚠️");
    }

    if (ENABLE_MOVE_TO_PLACE) {
        try {
            if (!botInstance.pathfinder) {
                const { pathfinder, Movements } = require('mineflayer-pathfinder');
                botInstance.loadPlugin(pathfinder);
                const defaultMove = new Movements(botInstance);
                botInstance.pathfinder.setMovements(defaultMove);
                console.log("[Auto Torch] Pathfinder đã được load cho chức năng di chuyển.");
            }
        } catch (err) {
            console.error(err.message);
        }
    }

    const createBlock = bot.registry.itemsByName[CREATE_SPOT_BLOCK_NAME];
    if (ENABLE_CREATE_SPOT && !createBlock) {
    }
}

async function checkAndPlaceTorch() {
    if (isProcessingAutoTorch) return false;

    const now = Date.now();
    if (now - lastPlaceTime < PLACE_COOLDOWN_MS) return false;

    const blockAtFeet = botInstance.blockAt(botInstance.entity.position);
    if (!blockAtFeet) return false;

    const lightLevelAtFeet = blockAtFeet.light;
    if (lightLevelAtFeet >= TORCH_LIGHT_THRESHOLD) return false;

    isProcessingAutoTorch = true;

    try {
        let torchItem = botInstance.inventory.findInventoryItem(botInstance.registry.itemsByName.torch.id);
        if (!torchItem) {
            const crafted = await checkAndCraftTorches();
            if (!crafted) {
                isProcessingAutoTorch = false;
                return false;
            }
            await sleep(500);
            torchItem = botInstance.inventory.findInventoryItem(botInstance.registry.itemsByName.torch.id);
            if (!torchItem) {
                console.error("[Auto Torch] Lỗi: Đã báo cáo chế tạo thành công nhưng không tìm thấy đuốc trong túi đồ!");
                isProcessingAutoTorch = false;
                return false;
            }
            console.log("[Auto Torch] Đã chế tạo đuốc, tiếp tục tìm chỗ đặt.");
        }

        const blockAtHead = botInstance.blockAt(botInstance.entity.position.offset(0, 1, 0));
        if (!blockAtHead || !blockAtHead.position) {
             isProcessingAutoTorch = false;
             return false;
        }

        const immediatePlaceTarget = await findValidTorchPlacementOriginal(blockAtHead.position); // SỬA HÀM NÀY

        if (immediatePlaceTarget) {
            const placed = await validateAndPlaceTorch(immediatePlaceTarget, torchItem);
            if (placed) {
                console.log("[Auto Torch] Đã đặt đuốc tại vị trí tức thời thành công! ✨");
                lastPlaceTime = Date.now();
               // ... (phần code từ checkAndPlaceTorch trở về trước giữ nguyên) ...

               isProcessingAutoTorch = false; // Reset flag trước khi return
               return true; // Đặt thành công -> Kết thúc
           } else {
                // Không return, tiếp tục thử cách khác
           }
       } else {
           // Log này đã được di chuyển vào hàm tìm kiếm mới
           // console.log("[Auto Torch] Không tìm thấy vị trí đặt tức thời hợp lệ trong tầm với.");
       }

       // *** ƯU TIÊN 2: TẠO KHỐI ***
       if (ENABLE_CREATE_SPOT) {
           const createdAndPlaced = await tryCreateAndPlaceTorch(torchItem);
           if (createdAndPlaced) {
               console.log("[Auto Torch] Đã tạo khối và đặt đuốc thành công! ✨");
               lastPlaceTime = Date.now();
               isProcessingAutoTorch = false; // Reset flag trước khi return
               return true; // Đặt thành công -> Kết thúc
           } else {
               // Không return, tiếp tục thử cách khác
           }
       }

       // *** ƯU TIÊN 3: DI CHUYỂN ***
       if (ENABLE_MOVE_TO_PLACE && botInstance.pathfinder) {
            // Sử dụng hàm tìm kiếm đã sửa: findValidTorchPlacementFurther
            const movedAndPlaced = await findAndMoveToPlaceTorch(torchItem);
            if (movedAndPlaced) {
                console.log("[Auto Torch] Đã di chuyển và đặt đuốc thành công! ✨");
                lastPlaceTime = Date.now();
                isProcessingAutoTorch = false; // Reset flag trước khi return
                return true; // Đặt thành công -> Kết thúc
            } else {
                // Không return, tiếp tục thử cách khác (dù đây là cách cuối)
            }
       }

       isProcessingAutoTorch = false; // Reset flag trước khi return
       return false; // Tất cả thất bại -> Kết thúc

   } catch (err) {
       console.error("[Auto Torch] Lỗi không mong muốn trong checkAndPlaceTorch:", err.message, err.stack);
       if (err.message?.includes('TransactionExpiredError')) {
           console.warn("[Auto Torch] TransactionExpiredError - có thể do lag server.");
       }
       isProcessingAutoTorch = false; // Reset flag nếu có lỗi
       return false;
   }
   // Không cần khối finally nữa
}


async function checkAndCraftTorches() {
   const coalCount = botInstance.inventory.count(botInstance.registry.itemsByName.coal.id) + botInstance.inventory.count(botInstance.registry.itemsByName.charcoal.id);
   const stickCount = botInstance.inventory.count(botInstance.registry.itemsByName.stick.id);

   if (coalCount >= REQUIRED_COAL && stickCount >= REQUIRED_STICK) {
       if (!aiModelInstance) {
           return false;
       }
       try {
           const crafted = await craftCommands.craftItem(
               botInstance,
               "System",
               `chế tạo ${TORCH_CRAFT_AMOUNT} đuốc`,
               aiModelInstance,
               TORCH_CRAFT_AMOUNT
           );

           if (crafted) {
               return true;
           } else {
               return false;
           }
       } catch (craftError) {
            return false;
       }
   } else {
       console.log(`[Auto Torch] Không đủ nguyên liệu (Cần ${REQUIRED_COAL} coal/charcoal, ${REQUIRED_STICK} stick. Có ${coalCount}, ${stickCount}).`);
       return false;
   }
}

// *** HÀM TÌM KIẾM GỐC ĐÃ SỬA - THÊM KIỂM TRA ĐUỐC GẦN ***
async function findValidTorchPlacementOriginal(searchPoint) {
   if (!botInstance || !botInstance.version || !searchPoint) return null;

   const placeableFacesData = [
       { face: 2, vector: new Vec3(0, 0, 1) },
       { face: 3, vector: new Vec3(0, 0, -1) },
       { face: 4, vector: new Vec3(1, 0, 0) },
       { face: 5, vector: new Vec3(-1, 0, 0) }
   ];

   const nearbySolidBlocks = botInstance.findBlocks({
       matching: (block) => block && block.boundingBox === 'block' && block.name !== 'air' && !block.name.includes('torch') && !block.name.includes('sign') && !block.name.includes('door') && !block.name.includes('gate'),
       point: searchPoint,
       maxDistance: CHECK_DISTANCE,
       count: 30
   });

   let bestPlacement = null;
   let minDistanceSq = CHECK_DISTANCE * CHECK_DISTANCE;

   for (const pos of nearbySolidBlocks) {
       const wallBlock = botInstance.blockAt(pos);
       if (!wallBlock || !wallBlock.position) continue;

       for (const { face, vector } of placeableFacesData) {
           const torchPos = wallBlock.position.plus(vector);
           const blockAtTorchPos = botInstance.blockAt(torchPos);

           if (blockAtTorchPos && blockAtTorchPos.name === 'air') {
                if (!botInstance.entity || !botInstance.entity.position) continue;
                const distSq = botInstance.entity.position.distanceSquared(torchPos);

                if (distSq <= 4.5 * 4.5 && distSq < minDistanceSq) {
                    // *** KIỂM TRA ĐUỐC GẦN ***
                    const nearbyTorches = botInstance.findBlocks({
                        point: torchPos,
                        matching: (block) => block && (block.name === 'torch' || block.name === 'wall_torch'),
                        maxDistance: MIN_TORCH_DISTANCE,
                        count: 1
                    });

                    if (Array.isArray(nearbyTorches) && nearbyTorches.length === 0) {
                        minDistanceSq = distSq;
                        bestPlacement = {
                            block: wallBlock,
                            faceVector: vector,
                            position: torchPos
                        };
                    }
                }
           }
       }
   }
   if (!bestPlacement) {
        // Chỉ log nếu thực sự không tìm thấy vị trí nào hợp lệ (kể cả vụ đuốc gần)
   }
   return bestPlacement;
}

// *** HÀM VALIDATE VÀ ĐẶT ĐUỐC - GIỮ NGUYÊN ***
async function validateAndPlaceTorch(placeTarget, torchItem) {
   if (!placeTarget || !placeTarget.position || !placeTarget.block || !placeTarget.faceVector || !torchItem) {
       console.warn("[Auto Torch] Dữ liệu đặt không hợp lệ.");
       return false;
   }

   const potentialTorchPos = placeTarget.position;
   const blockToPlaceOn = placeTarget.block;
   const faceToPlaceOn = placeTarget.faceVector;

   if (!botInstance.entity || !botInstance.entity.position) {
        console.warn("[Auto Torch] Không thể xác định vị trí bot để kiểm tra tầm với.");
        return false;
   }
   const distanceSq = botInstance.entity.position.distanceSquared(potentialTorchPos);
   if (distanceSq > 5.0 * 5.0) {
       return false;
   }

   const blockAtPlacement = botInstance.blockAt(potentialTorchPos);
   if (!blockAtPlacement) {
       console.warn(`[Auto Torch] Không thể lấy thông tin khối tại vị trí đặt ${formatCoords(potentialTorchPos)}.`);
       return false;
   }
   if (blockAtPlacement.light >= PLACEMENT_LIGHT_THRESHOLD) {
       return false;
   }

   // Kiểm tra lại đuốc gần như một lớp bảo vệ cuối cùng (dù không cần thiết nếu tìm kiếm đúng)
   const nearbyTorches = botInstance.findBlocks({
       point: potentialTorchPos,
       matching: (block) => block && (block.name === 'torch' || block.name === 'wall_torch'),
       maxDistance: MIN_TORCH_DISTANCE,
       count: 1
   });
   if (Array.isArray(nearbyTorches) && nearbyTorches.length > 0) {
       // Không nên log lỗi ở đây vì hàm tìm kiếm đã lọc rồi, nếu vào đây có thể do race condition
       // console.log(`[Auto Torch] Hủy đặt (Validate): Đã có đuốc khác quá gần tại ${formatCoords(nearbyTorches[0])}.`);
       return false;
   }

   try {

       if (!botInstance.heldItem || botInstance.heldItem.type !== torchItem.type) {
           await botInstance.equip(torchItem, 'hand');
           await sleep(200);
       }

       await botInstance.placeBlock(blockToPlaceOn, faceToPlaceOn);
       return true;

   } catch (placeError) {
       console.error(`[Auto Torch] Lỗi khi đặt đuốc tại ${formatCoords(potentialTorchPos)}:`, placeError.message);
       if (placeError.message.includes('Must be targeting a block') || placeError.message.includes('rejected transaction') || placeError.message.includes('Server misbehaved')) {
           console.warn("[Auto Torch] Lỗi server hoặc mục tiêu không hợp lệ khi đặt đuốc.");
       }
       return false;
   }
}

// *** HÀM TẠO KHỐI - GIỮ NGUYÊN ***
async function tryCreateAndPlaceTorch(torchItem) {
   const createBlockInfo = botInstance.registry.itemsByName[CREATE_SPOT_BLOCK_NAME];
   if (!createBlockInfo) {
       return false;
   }

   const createBlockItem = botInstance.inventory.findInventoryItem(createBlockInfo.id);
   if (!createBlockItem) {
       return false;
   }

   const botPos = botInstance.entity.position;
   if (!botPos) return false;

   let placementBaseBlock = null;
   let placePos = null;
   let bestDistSq = 3 * 3;

   const offsets = [
       { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 },
       { x: 1, z: 1 }, { x: 1, z: -1 }, { x: -1, z: 1 }, { x: -1, z: -1 }
   ];

   for (const offset of offsets) {
       const checkPlacePos = botPos.offset(offset.x, 0, offset.z).floored();
       const checkBasePos = checkPlacePos.offset(0, -1, 0);

       const blockAtPlace = botInstance.blockAt(checkPlacePos);
       const blockAtBase = botInstance.blockAt(checkBasePos);

       if (blockAtBase && blockAtBase.boundingBox === 'block' && blockAtBase.position &&
           blockAtPlace && blockAtPlace.name === 'air')
       {
           const distSq = checkPlacePos.distanceSquared(botPos);
           if (distSq <= 4.5 * 4.5 && distSq < bestDistSq) {
                if (blockAtBase.canPlaceOn) {
                    try {
                        if (await botInstance.canPlaceBlock(blockAtBase, new Vec3(0, 1, 0))) {
                           placementBaseBlock = blockAtBase;
                           placePos = checkPlacePos;
                           bestDistSq = distSq;
                        }
                    } catch(e){ /* Bỏ qua lỗi */ }
                }
           }
       }
   }

   if (!placementBaseBlock || !placePos) {
       return false;
   }

   try {
       if (!botInstance.heldItem || botInstance.heldItem.type !== createBlockItem.type) {
           await botInstance.equip(createBlockItem, 'hand');
           await sleep(200);
       }
       const placeVector = new Vec3(0, 1, 0);
       await botInstance.placeBlock(placementBaseBlock, placeVector);
       await sleep(400);

       const newBlock = botInstance.blockAt(placePos);
       if (!newBlock || newBlock.name !== CREATE_SPOT_BLOCK_NAME || !newBlock.position) {
            return false;
       }
       console.log(`[Auto Torch] Đã đặt ${CREATE_SPOT_BLOCK_NAME} thành công. Giờ đặt đuốc lên trên...`);

       const torchPlaceTarget = {
           block: newBlock,
           faceVector: new Vec3(0, 1, 0),
           position: newBlock.position.plus(new Vec3(0, 1, 0))
       };

       // Hàm validate sẽ kiểm tra ánh sáng và đuốc gần (quanh khối mới)
       return await validateAndPlaceTorch(torchPlaceTarget, torchItem);

   } catch (createError) {
       console.error(`[Auto Torch] Lỗi khi tạo khối ${CREATE_SPOT_BLOCK_NAME} tại ${formatCoords(placePos)}:`, createError.message);
       if (createError.message.includes('Must be targeting a block')) {
            console.warn("[Auto Torch] Lỗi 'Must be targeting a block' khi tạo khối.");
       }
       return false;
   }
}

// *** HÀM TÌM KIẾM XA HƠN ĐÃ SỬA - THÊM KIỂM TRA ĐUỐC GẦN ***
async function findValidTorchPlacementFurther(searchPoint, maxDist) {
   if (!botInstance || !botInstance.version || !searchPoint) return null;

   const placeableFacesData = [
       { face: 2, vector: new Vec3(0, 0, 1) },
       { face: 3, vector: new Vec3(0, 0, -1) },
       { face: 4, vector: new Vec3(1, 0, 0) },
       { face: 5, vector: new Vec3(-1, 0, 0) }
   ];

   const nearbySolidBlocks = botInstance.findBlocks({
       matching: (block) => block && block.boundingBox === 'block' && block.name !== 'air' && !block.name.includes('torch') && !block.name.includes('sign') && !block.name.includes('door') && !block.name.includes('gate'),
       point: searchPoint,
       maxDistance: maxDist,
       count: 70
   });

   let bestPlacement = null;
   let minDistanceSq = maxDist * maxDist;

   for (const pos of nearbySolidBlocks) {
       const wallBlock = botInstance.blockAt(pos);
       if (!wallBlock || !wallBlock.position) continue;

       for (const { face, vector } of placeableFacesData) {
           const torchPos = wallBlock.position.plus(vector);
           const blockAtTorchPos = botInstance.blockAt(torchPos);

           if (blockAtTorchPos && blockAtTorchPos.name === 'air') {
                if (!botInstance.entity || !botInstance.entity.position) continue;
                const distSq = botInstance.entity.position.distanceSquared(torchPos);

                if (distSq < minDistanceSq) {
                    // *** KIỂM TRA ĐUỐC GẦN ***
                    const nearbyTorches = botInstance.findBlocks({
                        point: torchPos,
                        matching: (block) => block && (block.name === 'torch' || block.name === 'wall_torch'),
                        maxDistance: MIN_TORCH_DISTANCE,
                        count: 1
                    });

                    if (Array.isArray(nearbyTorches) && nearbyTorches.length === 0) {
                        minDistanceSq = distSq;
                        bestPlacement = {
                            block: wallBlock,
                            faceVector: vector,
                            position: torchPos
                        };
                    }
                }
           }
       }
   }
    if (!bestPlacement) {
        // Log nếu không tìm thấy vị trí nào xa hơn hợp lệ
   }
   return bestPlacement;
}

// *** HÀM DI CHUYỂN VÀ ĐẶT - GIỮ NGUYÊN ***
async function findAndMoveToPlaceTorch(torchItem) {
   if (!botInstance.pathfinder) {
       console.warn("[Auto Torch] Pathfinder không khả dụng, không thể thực hiện di chuyển để đặt đuốc.");
       return false;
   }

    let GoalNear;
    try {
       GoalNear = require('mineflayer-pathfinder').goals.GoalNear;
    } catch(e) {
        console.error("[Auto Torch] Không thể load GoalNear từ pathfinder. Đã cài đặt mineflayer-pathfinder chưa?");
        return false;
    }

   if (!botInstance.entity || !botInstance.entity.position) {
       console.warn("[Auto Torch] Không thể xác định vị trí bot để tìm kiếm xa hơn.");
       return false;
   }

   // Hàm này đã được sửa để kiểm tra đuốc gần
   const furtherPlaceTarget = await findValidTorchPlacementFurther(botInstance.entity.position, SEARCH_FURTHER_DISTANCE);

   if (!furtherPlaceTarget || !furtherPlaceTarget.position || !furtherPlaceTarget.block || !furtherPlaceTarget.faceVector) {
       // Log đã được đưa vào hàm tìm kiếm
       // console.log("[Auto Torch] Không tìm thấy vị trí đặt tiềm năng nào xa hơn hợp lệ.");
       return false;
   }

   const targetTorchPos = furtherPlaceTarget.position;


   const goal = new GoalNear(targetTorchPos.x, targetTorchPos.y, targetTorchPos.z, 2);


   try {
       await botInstance.pathfinder.goto(goal);
       await sleep(300);

       return await validateAndPlaceTorch(furtherPlaceTarget, torchItem);

   } catch (moveError) {
       const errorMessage = moveError.message ? moveError.message : String(moveError);
       if (errorMessage.toLowerCase().includes('no path')) {
       } else if (errorMessage.toLowerCase().includes('goal reached')) {
            await sleep(300);
            return await validateAndPlaceTorch(furtherPlaceTarget, torchItem);
       } else if (errorMessage.toLowerCase().includes('cancel')) {
       }
       return false;
   }
}

// *** HÀM FORMAT COORDS - GIỮ NGUYÊN ***
function formatCoords(pos) {
   if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number' || typeof pos.z !== 'number') {
       return 'N/A';
   }
   return `(${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`;
}

// *** EXPORTS - GIỮ NGUYÊN ***
module.exports = {
   initializeAutoTorch,
   checkAndPlaceTorch,
   get isProcessingAutoTorch() { return isProcessingAutoTorch; }
};
// --- END OF FILE commands/auto_torch.js ---