// --- START OF FILE commands/auto_torch.js ---
const { Vec3 } = require("vec3");
const { sleep } = require("../utils");
const craftCommands = require("./craft");

const TORCH_LIGHT_THRESHOLD = 1;
const PLACEMENT_LIGHT_THRESHOLD = 3;
const CHECK_DISTANCE = 3;
const PLACE_COOLDOWN_MS = 2000;
const MIN_TORCH_DISTANCE = 7; // Khoảng cách tối thiểu giữa các đuốc
const REQUIRED_COAL = 1;
const REQUIRED_STICK = 1;
const TORCH_CRAFT_AMOUNT = 8;

const ENABLE_CREATE_SPOT = true;
const CREATE_SPOT_BLOCK_NAME = "dirt";
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
    console.warn(
      "[Auto Torch] Cảnh báo: aiModel không được cung cấp! Chế tạo tự động sẽ không hoạt động. ⚠️"
    );
  }

  if (ENABLE_MOVE_TO_PLACE) {
    try {
      if (!botInstance.pathfinder) {
        const { pathfinder, Movements } = require("mineflayer-pathfinder");
        botInstance.loadPlugin(pathfinder);
        const defaultMove = new Movements(botInstance);
        botInstance.pathfinder.setMovements(defaultMove);
        console.log(
          "[Auto Torch] Pathfinder đã được load cho chức năng di chuyển."
        );
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
    if (!botInstance || !botInstance.entity) return false; // Bot chưa sẵn sàng

    // Kiểm tra xem có tác vụ di chuyển hoặc nhiệm vụ ưu tiên nào khác đang chạy không
    if (botInstance.isNavigating || // Cờ từ lệnh goto/waypoint
        botInstance.isFollowing ||  // Cờ từ lệnh follow
        botInstance.isStripMining || // Cờ từ lệnh strip_mine (vì nó cũng di chuyển nhiều)
        botInstance.isHunting ||     // Cờ từ lệnh hunt
        botInstance.isCollecting ||  // Cờ từ lệnh collect (nếu có di chuyển)
        botInstance.isDepositing ||  // Cờ từ lệnh deposit (nếu có di chuyển)
        botInstance.isFlattening || // Cờ từ lệnh flatten
        botInstance.isFarmingWheat || // Cờ từ lệnh farm wheat
        botInstance.isBuilding ||    // Cờ từ lệnh build
        botInstance.isProtecting ||  // Đang bảo vệ (có thể di chuyển)
        botInstance.isDefending ||   // Đang tự vệ (chắc chắn di chuyển)
        botInstance.isSleeping       // Đang ngủ
       )
    {
        // console.log("[Auto Torch] Skipping check: Another priority task is active."); // Bỏ comment nếu muốn debug
        return false; // Không chạy auto_torch nếu bot đang bận việc khác
    }
    // <<< KẾT THÚC KIỂM TRA >>>
  if (isProcessingAutoTorch) return false;

  const now = Date.now();
  if (now - lastPlaceTime < PLACE_COOLDOWN_MS) return false;

  const blockAtFeet = botInstance.blockAt(botInstance.entity.position);
  if (!blockAtFeet) return false;

  const lightLevelAtFeet = blockAtFeet.light;
  if (lightLevelAtFeet > TORCH_LIGHT_THRESHOLD) { // Dùng > thay vì >= để đặt khi ánh sáng <= ngưỡng
    return false;
}
   // === BẮT ĐẦU XỬ LÝ ===
   isProcessingAutoTorch = true; // <--- Đặt cờ NGAY LẬP TỨC

   try {
       let torchItem = botInstance.inventory.findInventoryItem(botInstance.registry.itemsByName.torch.id);
       if (!torchItem) {
           console.log("[Auto Torch] Không có đuốc, thử chế tạo...");
           const crafted = await checkAndCraftTorches(); // checkAndCraft đã có log riêng
           if (!crafted) {
               console.log("[Auto Torch] Chế tạo đuốc thất bại hoặc không đủ nguyên liệu.");
               isProcessingAutoTorch = false; // Reset flag
               return false;
           }
           await sleep(500); // Chờ inventory cập nhật
           torchItem = botInstance.inventory.findInventoryItem(botInstance.registry.itemsByName.torch.id);
           if (!torchItem) {
               console.error("[Auto Torch] Lỗi: Đã báo chế tạo nhưng không tìm thấy đuốc!");
               isProcessingAutoTorch = false; // Reset flag
               return false;
           }
           console.log("[Auto Torch] Đã chế tạo đuốc, tiếp tục tìm chỗ đặt.");
       }

       // *** ƯU TIÊN 1: ĐẶT TỨC THỜI ***
       const blockAtHead = botInstance.blockAt(botInstance.entity.position.offset(0, 1, 0));
       if (!blockAtHead || !blockAtHead.position) {
            console.warn("[Auto Torch] Không thể lấy block ở đầu.");
            isProcessingAutoTorch = false; // Reset flag
            return false;
       }
       const immediatePlaceTarget = await findValidTorchPlacementOriginal(blockAtHead.position);
       if (immediatePlaceTarget) {
           console.log(`[Auto Torch] Tìm thấy vị trí tức thời tại ${formatCoords(immediatePlaceTarget.position)}. Thử đặt...`);
           const placed = await validateAndPlaceTorch(immediatePlaceTarget, torchItem);
           if (placed) {
               console.log("[Auto Torch] Đặt đuốc tức thời thành công! ✨");
               lastPlaceTime = Date.now();
               isProcessingAutoTorch = false; // Reset flag
               return true; // <--- Thành công, kết thúc
           } else {
                console.log("[Auto Torch] Đặt đuốc tức thời thất bại (validate/place).");
                // Không return, thử cách khác
           }
       } else {
           // console.log("[Auto Torch] Không tìm thấy vị trí tức thời hợp lệ."); // Log đã có trong hàm tìm
       }

       // *** ƯU TIÊN 2: TẠO KHỐI ***
       if (ENABLE_CREATE_SPOT) {
           console.log("[Auto Torch] Thử tạo khối để đặt đuốc...");
           const createdAndPlaced = await tryCreateAndPlaceTorch(torchItem);
           if (createdAndPlaced) {
               console.log("[Auto Torch] Tạo khối và đặt đuốc thành công! ✨");
               lastPlaceTime = Date.now();
               isProcessingAutoTorch = false; // Reset flag
               return true; // <--- Thành công, kết thúc
           } else {
               // console.log("[Auto Torch] Tạo khối và đặt thất bại."); // Hàm con đã có log lỗi
               // Không return, thử cách khác
           }
       }

       // *** ƯU TIÊN 3: DI CHUYỂN (Cách gọi đã thay đổi) ***
       if (ENABLE_MOVE_TO_PLACE && botInstance.pathfinder) {
           console.log("[Auto Torch] Thử tìm vị trí xa hơn và di chuyển đến...");
           // Gọi hàm mới (nó trả về Promise nhưng chúng ta không await)
           // Nó sẽ trả về false ngay lập tức để checkAndPlaceTorch kết thúc
           // và isProcessingAutoTorch sẽ ngăn chặn lần gọi tiếp theo cho đến khi
           // Promise di chuyển được giải quyết (thành công hoặc thất bại).
           const movePromise = findAndMoveToPlaceTorch(torchItem);

           // Xử lý kết quả của Promise ĐỂ reset cờ isProcessingAutoTorch
           movePromise.then(placedSuccessfully => {
                console.log(`[Auto Torch] Kết quả di chuyển và đặt (Promise): ${placedSuccessfully}`);
                if (placedSuccessfully) {
                    lastPlaceTime = Date.now(); // Cập nhật thời gian nếu thành công
                }
                isProcessingAutoTorch = false; // <<< RESET CỜ Ở ĐÂY KHI PROMISE KẾT THÚC
           }).catch(err => {
               // Hiếm khi xảy ra nếu Promise được cấu trúc đúng để luôn resolve
               console.error("[Auto Torch] Lỗi không mong muốn từ Promise di chuyển:", err);
               isProcessingAutoTorch = false; // <<< RESET CỜ KHI CÓ LỖI KHÔNG MONG MUỐN
           });

            // Quan trọng: Trả về false ngay lập tức cho lần gọi checkAndPlaceTorch này
            // vì hành động di chuyển/đặt đang diễn ra trong nền.
            console.log("[Auto Torch] Đã bắt đầu di chuyển (nếu tìm thấy chỗ). Kết thúc lần kiểm tra này.");
            return false; // <--- Luôn trả về false khi bắt đầu di chuyển

       } else if (ENABLE_MOVE_TO_PLACE && !botInstance.pathfinder) {
            console.warn("[Auto Torch] Đã bật di chuyển nhưng pathfinder không khả dụng.");
       }

       // Nếu đến đây tức là tất cả các cách đều thất bại (hoặc đã bắt đầu di chuyển)
       console.log("[Auto Torch] Không thể đặt đuốc trong lần kiểm tra này.");
       isProcessingAutoTorch = false; // Reset flag nếu không làm gì cả
       return false; // Tất cả thất bại -> Kết thúc

   } catch (err) {
       console.error("[Auto Torch] Lỗi không mong muốn trong checkAndPlaceTorch:", err.message, err.stack);
       if (err.message?.includes('TransactionExpiredError')) {
           console.warn("[Auto Torch] TransactionExpiredError - có thể do lag server.");
       }
       isProcessingAutoTorch = false; // Reset flag nếu có lỗi
       return false;
   }
}
async function checkAndCraftTorches() {
  const coalCount =
    botInstance.inventory.count(botInstance.registry.itemsByName.coal.id) +
    botInstance.inventory.count(botInstance.registry.itemsByName.charcoal.id);
  const stickCount = botInstance.inventory.count(
    botInstance.registry.itemsByName.stick.id
  );

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
    console.log(
      `[Auto Torch] Không đủ nguyên liệu (Cần ${REQUIRED_COAL} coal/charcoal, ${REQUIRED_STICK} stick. Có ${coalCount}, ${stickCount}).`
    );
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
    { face: 5, vector: new Vec3(-1, 0, 0) },
  ];

  const nearbySolidBlocks = botInstance.findBlocks({
    matching: (block) =>
      block &&
      block.boundingBox === "block" &&
      block.name !== "air" &&
      !block.name.includes("torch") &&
      !block.name.includes("sign") &&
      !block.name.includes("door") &&
      !block.name.includes("gate"),
    point: searchPoint,
    maxDistance: CHECK_DISTANCE,
    count: 30,
  });

  let bestPlacement = null;
  let minDistanceSq = CHECK_DISTANCE * CHECK_DISTANCE;

  for (const pos of nearbySolidBlocks) {
    const wallBlock = botInstance.blockAt(pos);
    if (!wallBlock || !wallBlock.position) continue;

    for (const { face, vector } of placeableFacesData) {
      const torchPos = wallBlock.position.plus(vector);
      const blockAtTorchPos = botInstance.blockAt(torchPos);

      if (blockAtTorchPos && blockAtTorchPos.name === "air") {
        if (!botInstance.entity || !botInstance.entity.position) continue;
        const distSq = botInstance.entity.position.distanceSquared(torchPos);

        if (distSq <= 4.5 * 4.5 && distSq < minDistanceSq) {
          // *** KIỂM TRA ĐUỐC GẦN ***
          const nearbyTorches = botInstance.findBlocks({
            point: torchPos,
            matching: (block) =>
              block && (block.name === "torch" || block.name === "wall_torch"),
            maxDistance: MIN_TORCH_DISTANCE,
            count: 1,
          });

          if (Array.isArray(nearbyTorches) && nearbyTorches.length === 0) {
            minDistanceSq = distSq;
            bestPlacement = {
              block: wallBlock,
              faceVector: vector,
              position: torchPos,
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
  if (
    !placeTarget ||
    !placeTarget.position ||
    !placeTarget.block ||
    !placeTarget.faceVector ||
    !torchItem
  ) {
    console.warn("[Auto Torch] Dữ liệu đặt không hợp lệ.");
    return false;
  }

  const potentialTorchPos = placeTarget.position;
  const blockToPlaceOn = placeTarget.block;
  const faceToPlaceOn = placeTarget.faceVector;

  if (!botInstance.entity || !botInstance.entity.position) {
    console.warn(
      "[Auto Torch] Không thể xác định vị trí bot để kiểm tra tầm với."
    );
    return false;
  }
  const distanceSq =
    botInstance.entity.position.distanceSquared(potentialTorchPos);
  if (distanceSq > 5.0 * 5.0) {
    return false;
  }

  const blockAtPlacement = botInstance.blockAt(potentialTorchPos);
  if (!blockAtPlacement) {
    console.warn(
      `[Auto Torch] Không thể lấy thông tin khối tại vị trí đặt ${formatCoords(
        potentialTorchPos
      )}.`
    );
    return false;
  }
  if (blockAtPlacement.light >= PLACEMENT_LIGHT_THRESHOLD) {
    return false;
  }

  // Kiểm tra lại đuốc gần như một lớp bảo vệ cuối cùng (dù không cần thiết nếu tìm kiếm đúng)
  const nearbyTorches = botInstance.findBlocks({
    point: potentialTorchPos,
    matching: (block) =>
      block && (block.name === "torch" || block.name === "wall_torch"),
    maxDistance: MIN_TORCH_DISTANCE,
    count: 1,
  });
  if (Array.isArray(nearbyTorches) && nearbyTorches.length > 0) {
    // Không nên log lỗi ở đây vì hàm tìm kiếm đã lọc rồi, nếu vào đây có thể do race condition
    // console.log(`[Auto Torch] Hủy đặt (Validate): Đã có đuốc khác quá gần tại ${formatCoords(nearbyTorches[0])}.`);
    return false;
  }

  try {
    if (!botInstance.heldItem || botInstance.heldItem.type !== torchItem.type) {
      await botInstance.equip(torchItem, "hand");
      await sleep(200);
    }

    await botInstance.placeBlock(blockToPlaceOn, faceToPlaceOn);
    return true;
  } catch (placeError) {
    if (
      placeError.message.includes("Must be targeting a block") ||
      placeError.message.includes("rejected transaction") ||
      placeError.message.includes("Server misbehaved")
    ) {
      console.warn(
        "[Auto Torch] Lỗi server hoặc mục tiêu không hợp lệ khi đặt đuốc."
      );
    }
    return false;
  }
}

// *** HÀM TẠO KHỐI - GIỮ NGUYÊN ***
async function tryCreateAndPlaceTorch(torchItem) {
  const createBlockInfo =
    botInstance.registry.itemsByName[CREATE_SPOT_BLOCK_NAME];
  if (!createBlockInfo) {
    return false;
  }

  const createBlockItem = botInstance.inventory.findInventoryItem(
    createBlockInfo.id
  );
  if (!createBlockItem) {
    return false;
  }

  const botPos = botInstance.entity.position;
  if (!botPos) return false;

  let placementBaseBlock = null;
  let placePos = null;
  let bestDistSq = 3 * 3;

  const offsets = [
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: -1 },
    { x: 1, z: 1 },
    { x: 1, z: -1 },
    { x: -1, z: 1 },
    { x: -1, z: -1 },
  ];

  for (const offset of offsets) {
    const checkPlacePos = botPos.offset(offset.x, 0, offset.z).floored();
    const checkBasePos = checkPlacePos.offset(0, -1, 0);

    const blockAtPlace = botInstance.blockAt(checkPlacePos);
    const blockAtBase = botInstance.blockAt(checkBasePos);

    if (
      blockAtBase &&
      blockAtBase.boundingBox === "block" &&
      blockAtBase.position &&
      blockAtPlace &&
      blockAtPlace.name === "air"
    ) {
      const distSq = checkPlacePos.distanceSquared(botPos);
      if (distSq <= 4.5 * 4.5 && distSq < bestDistSq) {
        if (blockAtBase.canPlaceOn) {
          try {
            if (
              await botInstance.canPlaceBlock(blockAtBase, new Vec3(0, 1, 0))
            ) {
              placementBaseBlock = blockAtBase;
              placePos = checkPlacePos;
              bestDistSq = distSq;
            }
          } catch (e) {
            /* Bỏ qua lỗi */
          }
        }
      }
    }
  }

  if (!placementBaseBlock || !placePos) {
    return false;
  }

  try {
    if (
      !botInstance.heldItem ||
      botInstance.heldItem.type !== createBlockItem.type
    ) {
      await botInstance.equip(createBlockItem, "hand");
      await sleep(200);
    }
    const placeVector = new Vec3(0, 1, 0);
    await botInstance.placeBlock(placementBaseBlock, placeVector);
    await sleep(400);

    const newBlock = botInstance.blockAt(placePos);
    if (
      !newBlock ||
      newBlock.name !== CREATE_SPOT_BLOCK_NAME ||
      !newBlock.position
    ) {
      return false;
    }
    console.log(
      `[Auto Torch] Đã đặt ${CREATE_SPOT_BLOCK_NAME} thành công. Giờ đặt đuốc lên trên...`
    );

    const torchPlaceTarget = {
      block: newBlock,
      faceVector: new Vec3(0, 1, 0),
      position: newBlock.position.plus(new Vec3(0, 1, 0)),
    };

    // Hàm validate sẽ kiểm tra ánh sáng và đuốc gần (quanh khối mới)
    return await validateAndPlaceTorch(torchPlaceTarget, torchItem);
  } catch (createError) {
    console.error(
      `[Auto Torch] Lỗi khi tạo khối ${CREATE_SPOT_BLOCK_NAME} tại ${formatCoords(
        placePos
      )}:`,
      createError.message
    );
    if (createError.message.includes("Must be targeting a block")) {
      console.warn(
        "[Auto Torch] Lỗi 'Must be targeting a block' khi tạo khối."
      );
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
    { face: 5, vector: new Vec3(-1, 0, 0) },
  ];

  const nearbySolidBlocks = botInstance.findBlocks({
    matching: (block) =>
      block &&
      block.boundingBox === "block" &&
      block.name !== "air" &&
      !block.name.includes("torch") &&
      !block.name.includes("sign") &&
      !block.name.includes("door") &&
      !block.name.includes("gate"),
    point: searchPoint,
    maxDistance: maxDist,
    count: 70,
  });

  let bestPlacement = null;
  let minDistanceSq = maxDist * maxDist;

  for (const pos of nearbySolidBlocks) {
    const wallBlock = botInstance.blockAt(pos);
    if (!wallBlock || !wallBlock.position) continue;

    for (const { face, vector } of placeableFacesData) {
      const torchPos = wallBlock.position.plus(vector);
      const blockAtTorchPos = botInstance.blockAt(torchPos);

      if (blockAtTorchPos && blockAtTorchPos.name === "air") {
        if (!botInstance.entity || !botInstance.entity.position) continue;
        const distSq = botInstance.entity.position.distanceSquared(torchPos);

        if (distSq < minDistanceSq) {
          // *** KIỂM TRA ĐUỐC GẦN ***
          const nearbyTorches = botInstance.findBlocks({
            point: torchPos,
            matching: (block) =>
              block && (block.name === "torch" || block.name === "wall_torch"),
            maxDistance: MIN_TORCH_DISTANCE,
            count: 1,
          });

          if (Array.isArray(nearbyTorches) && nearbyTorches.length === 0) {
            minDistanceSq = distSq;
            bestPlacement = {
              block: wallBlock,
              faceVector: vector,
              position: torchPos,
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
    console.warn(
      "[Auto Torch] Pathfinder không khả dụng, không thể thực hiện di chuyển để đặt đuốc."
    );
    return false; // Trả về false vì không thể di chuyển
  }

  let GoalNear;
  try {
    GoalNear = require("mineflayer-pathfinder").goals.GoalNear;
  } catch (e) {
    console.error("[Auto Torch] Không thể load GoalNear từ pathfinder.");
    return false; // Trả về false vì thiếu goal
  }

  if (!botInstance.entity || !botInstance.entity.position) {
    console.warn(
      "[Auto Torch] Không thể xác định vị trí bot để tìm kiếm xa hơn."
    );
    return false; // Trả về false vì thiếu vị trí bot
  }

  // --- Tìm kiếm vị trí ---
  // Hàm này vẫn dùng await nhưng thường nhanh hơn goto
  const furtherPlaceTarget = await findValidTorchPlacementFurther(
    botInstance.entity.position,
    SEARCH_FURTHER_DISTANCE
  );

  if (
    !furtherPlaceTarget ||
    !furtherPlaceTarget.position ||
    !furtherPlaceTarget.block ||
    !furtherPlaceTarget.faceVector
  ) {
    // Log đã có trong hàm tìm kiếm
    // console.log("[Auto Torch] Không tìm thấy vị trí đặt tiềm năng nào xa hơn hợp lệ.");
    return false; // Trả về false vì không tìm thấy chỗ đặt
  }

  const targetTorchPos = furtherPlaceTarget.position;
  const goal = new GoalNear(
    targetTorchPos.x,
    targetTorchPos.y,
    targetTorchPos.z,
    2
  );

  console.log(
    `[Auto Torch] Tìm thấy vị trí tiềm năng xa hơn tại ${formatCoords(
      targetTorchPos
    )}. Bắt đầu di chuyển...`
  );

  // --- Sử dụng Promise để quản lý kết quả không đồng bộ ---
  return new Promise((resolve) => {
    let moveTimeout; // Timer để hủy nếu di chuyển quá lâu
    let listenersAttached = false;

    // Hàm dọn dẹp listener
    const cleanupListeners = () => {
      if (!listenersAttached) return;
      // console.log("[Auto Torch Move] Cleaning up pathfinder listeners."); // Debug log
      botInstance.pathfinder.removeListener("goal_reached", onGoalReached);
      botInstance.removeListener("path_update", onPathUpdate); // Hoặc sự kiện lỗi khác nếu pathfinder dùng 'error'
      botInstance.removeListener("error", onPathError); // Bắt lỗi chung của bot cũng có thể liên quan
      botInstance.removeListener("path_reset", onPathReset); // Khi path bị reset
      botInstance.removeListener("goal_updated", onGoalUpdated); // Khi mục tiêu bị ghi đè?
      clearTimeout(moveTimeout);
      listenersAttached = false;
    };

    // --- Các hàm xử lý sự kiện ---
    const onGoalReached = async () => {
      console.log(
        `[Auto Torch] Đã đến gần vị trí ${formatCoords(
          targetTorchPos
        )}. Thử đặt đuốc...`
      );
      cleanupListeners();
      await sleep(300); // Chờ ổn định
      const placed = await validateAndPlaceTorch(furtherPlaceTarget, torchItem);
      if (!placed) {
        console.log(
          "[Auto Torch] Đã đến nơi nhưng đặt đuốc thất bại (validate/place)."
        );
      }
      resolve(placed); // Giải quyết Promise với kết quả đặt đuốc
    };

    const onPathUpdate = (results) => {
      // Có thể dùng để kiểm tra nếu path không thể hoàn thành sớm
      if (results.status === "noPath") {
        console.log(
          `[Auto Torch] Không tìm thấy đường đi đến ${formatCoords(
            targetTorchPos
          )} (Path Update).`
        );
        cleanupListeners();
        resolve(false); // Giải quyết Promise là thất bại
      }
    };

    const onPathError = (err) => {
      // Kiểm tra xem lỗi có liên quan đến pathfinding không
      // Điều này hơi khó vì sự kiện 'error' của bot là chung chung
      // Có thể cần kiểm tra err.message hoặc loại lỗi
      if (
        err &&
        (err.message.toLowerCase().includes("path") ||
          err.message.toLowerCase().includes("goal"))
      ) {
        console.error(
          `[Auto Torch] Lỗi Pathfinder khi di chuyển: ${err.message}`
        );
        cleanupListeners();
        resolve(false); // Giải quyết Promise là thất bại
      }
    };

    const onPathReset = (reason) => {
      // Lý do có thể là 'goal_updated', 'move_interrupt', 'block_updated', etc.
      console.log(
        `[Auto Torch] Di chuyển bị đặt lại/gián đoạn. Lý do: ${
          reason || "Không rõ"
        }`
      );
      // Nếu bị gián đoạn bởi thứ khác, coi như thất bại cho auto torch lần này
      cleanupListeners();
      resolve(false);
    };

    const onGoalUpdated = (newGoal) => {
      // Ai đó đã đặt mục tiêu mới cho pathfinder!
      console.warn(
        `[Auto Torch] Mục tiêu di chuyển bị ghi đè! Hủy đặt đuốc tự động.`
      );
      cleanupListeners();
      resolve(false);
    };

    // --- Thiết lập di chuyển và gắn listener ---
    try {
      // Gắn listener TRƯỚC KHI setGoal để không bỏ lỡ sự kiện
      botInstance.pathfinder.once("goal_reached", onGoalReached);
      botInstance.on("path_update", onPathUpdate); // Có thể phát ra nhiều lần
      botInstance.on("error", onPathError); // Lắng nghe lỗi chung
      botInstance.on("path_reset", onPathReset); // Lắng nghe reset
      botInstance.on("goal_updated", onGoalUpdated); // Lắng nghe mục tiêu bị đổi
      listenersAttached = true;
      // console.log("[Auto Torch Move] Listeners attached."); // Debug log

      // Đặt mục tiêu (NON-BLOCKING)
      botInstance.pathfinder.setGoal(goal);

      // Đặt timeout để tránh chờ đợi vô hạn nếu bị kẹt hoặc sự kiện không được kích hoạt
      moveTimeout = setTimeout(() => {
        if (listenersAttached) {
          // Chỉ hủy nếu listener vẫn còn đó
          console.warn(
            `[Auto Torch] Hết thời gian chờ di chuyển đến ${formatCoords(
              targetTorchPos
            )}. Hủy bỏ.`
          );
          cleanupListeners();
          if (botInstance.pathfinder.isMoving()) {
            botInstance.pathfinder.stop(); // Cố gắng dừng nếu đang di chuyển
          }
          resolve(false); // Giải quyết Promise là thất bại
        }
      }, 20000); // Chờ tối đa 20 giây

      // Quan trọng: Hàm này không còn trả về kết quả đặt đuốc trực tiếp nữa
      // Nó trả về một Promise sẽ được giải quyết bởi các listener sự kiện
      // resolve(true); // <-- XÓA DÒNG NÀY, KHÔNG RESOLVE NGAY LẬP TỨC
      // Bản thân hàm findAndMoveToPlaceTorch sẽ kết thúc ngay sau khi setGoal
      // và trả về Promise đang chờ các listener giải quyết nó.
      // Hàm checkAndPlaceTorch sẽ nhận được Promise này nhưng không await nó
      // mà sẽ return false ngay lập tức, vì kết quả chưa có.
    } catch (setupError) {
      console.error(
        `[Auto Torch] Lỗi khi thiết lập di chuyển hoặc listener: ${setupError.message}`
      );
      cleanupListeners(); // Dọn dẹp nếu lỗi ngay từ đầu
      resolve(false); // Giải quyết Promise là thất bại
    }
  }); // Kết thúc new Promise

  // <<< QUAN TRỌNG: Logic mới cho hàm gọi >>>
  // Hàm findAndMoveToPlaceTorch giờ trả về một Promise, nhưng hàm checkAndPlaceTorch
  // không nên await nó vì nó không chặn. checkAndPlaceTorch sẽ coi như việc
  // di chuyển đã bắt đầu và sẽ return false cho lần kiểm tra hiện tại.
  // Kết quả thực sự sẽ được xử lý bởi các listener.
  return false; // <<<< LUÔN TRẢ VỀ FALSE NGAY LẬP TỨC
  // vì việc di chuyển và đặt đuốc sẽ diễn ra trong nền.
  // isProcessingAutoTorch sẽ ngăn lần kiểm tra tiếp theo
  // cho đến khi Promise được giải quyết (dù thành công hay thất bại).
  // Cần đảm bảo isProcessingAutoTorch được reset trong cleanupListeners
  // hoặc sau khi resolve Promise. --> Chỉnh sửa checkAndPlaceTorch
} // Kết thúc hàm findAndMoveToPlaceTorch

// *** HÀM FORMAT COORDS - GIỮ NGUYÊN ***
function formatCoords(pos) {
  if (
    !pos ||
    typeof pos.x !== "number" ||
    typeof pos.y !== "number" ||
    typeof pos.z !== "number"
  ) {
    return "N/A";
  }
  return `(${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`;
}

// *** EXPORTS - GIỮ NGUYÊN ***
module.exports = {
  initializeAutoTorch,
  checkAndPlaceTorch,
  get isProcessingAutoTorch() {
    return isProcessingAutoTorch;
  },
};
// --- END OF FILE commands/auto_torch.js ---
