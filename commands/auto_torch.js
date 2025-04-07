// --- START OF FILE commands/auto_torch.js ---
const { Vec3 } = require("vec3");
const { sleep } = require("../utils");
const craftCommands = require("./craft");

// --- Ngưỡng và Cài đặt ---
const TORCH_LIGHT_THRESHOLD = 3;      // Mức ánh sáng tại chân bot để kích hoạt đặt đuốc (<= ngưỡng này sẽ đặt)
const PLACEMENT_LIGHT_THRESHOLD = 7;  // Mức ánh sáng tối đa cho phép tại vị trí SẼ ĐẶT đuốc (đặt nếu < ngưỡng này) - Dùng cho validate
const CHECK_DISTANCE = 3;             // Khoảng cách tìm tường xung quanh để đặt
const PLACE_COOLDOWN_MS = 2000;       // Thời gian chờ tối thiểu giữa 2 lần đặt đuốc
const MIN_TORCH_DISTANCE = 7;         // Khoảng cách tối thiểu giữa các đuốc đã đặt và vị trí mới
const REQUIRED_COAL = 1;
const REQUIRED_STICK = 1;
const TORCH_CRAFT_AMOUNT = 8;         // Số lượng đuốc chế tạo mỗi lần

// --- Tùy chọn hành vi ---
const ENABLE_CREATE_SPOT = true;      // Bật/tắt khả năng tạo khối đất để đặt đuốc
const CREATE_SPOT_BLOCK_NAME = "dirt"; // Loại khối sẽ tạo (cần có trong inventory)
// const ENABLE_MOVE_TO_PLACE = false; // Đã loại bỏ logic này

// --- Biến trạng thái ---
let botInstance = null;
let aiModelInstance = null;
let lastPlaceTime = 0;
let isProcessingAutoTorch = false;

// --- Khởi tạo ---
function initializeAutoTorch(bot, aiModel) {
  botInstance = bot;
  aiModelInstance = aiModel;
  isProcessingAutoTorch = false;
  lastPlaceTime = 0;
  console.log("[Auto Torch] Đã khởi tạo (Chế độ đặt tại chỗ). 🔥");

  if (!aiModelInstance) {
    console.warn(
      "[Auto Torch] Cảnh báo: aiModel không được cung cấp! Chế tạo tự động sẽ không hoạt động. ⚠️"
    );
  }

  // Không cần load pathfinder cho auto_torch nữa nếu chỉ đặt tại chỗ
  // Tuy nhiên, các module khác có thể cần nên tạm thời không xóa phần load
  try {
    if (!botInstance.pathfinder) {
      const { pathfinder, Movements } = require("mineflayer-pathfinder");
      botInstance.loadPlugin(pathfinder);
      const defaultMove = new Movements(botInstance);
      botInstance.pathfinder.setMovements(defaultMove);
      // console.log("[Auto Torch] Pathfinder đã được load (có thể cần cho module khác).");
    }
  } catch (err) {
    // console.error("[Auto Torch] Lỗi load pathfinder:", err.message);
  }


  const createBlock = bot.registry.itemsByName[CREATE_SPOT_BLOCK_NAME];
  if (ENABLE_CREATE_SPOT && !createBlock) {
    console.warn(`[Auto Torch] Khối ${CREATE_SPOT_BLOCK_NAME} không tồn tại trong registry game! Tắt chức năng tạo khối.`);
    // ENABLE_CREATE_SPOT = false; // Hoặc xử lý lỗi khác
  }
}

// --- Hàm kiểm tra và đặt đuốc chính ---
async function checkAndPlaceTorch() {
  if (!botInstance || !botInstance.entity) return false; // Bot chưa sẵn sàng

  // *** KIỂM TRA KHỐI DƯỚI CHÂN ĐỂ TRÁNH LỖI ***
  const posBelowFeet = botInstance.entity.position.offset(0, -0.1, 0).floored(); // Vị trí ngay dưới chân
  const blockBelow = botInstance.blockAt(posBelowFeet);
  // Nếu không có khối dưới chân hoặc là air (đang rơi?), hoặc không phải khối rắn thì bỏ qua
  if (!blockBelow || blockBelow.name === "air" || blockBelow.boundingBox !== 'block') {
    // console.log("[Auto Torch] Bỏ qua: Đang rơi hoặc không có khối rắn dưới chân.");
    return false;
  }

  // Kiểm tra các tác vụ ưu tiên khác đang chạy
  if (
    botInstance.isNavigating || botInstance.isFollowing || botInstance.isStripMining ||
    botInstance.isHunting || botInstance.isCollecting || botInstance.isDepositing ||
    botInstance.isFlattening || botInstance.isFarmingWheat || botInstance.isBuilding ||
    botInstance.isProtecting || botInstance.isDefending || botInstance.isSleeping
  ) {
    // console.log("[Auto Torch] Skipping check: Another priority task is active.");
    return false;
  }

  // Kiểm tra xử lý và cooldown
  if (isProcessingAutoTorch) return false;
  const now = Date.now();
  if (now - lastPlaceTime < PLACE_COOLDOWN_MS) return false;

  // *** KIỂM TRA ÁNH SÁNG TẠI VỊ TRÍ CHÂN BOT ***
  const blockAtFeet = botInstance.blockAt(botInstance.entity.position.floored()); // Lấy khối tại chân (có thể là air)
  if (!blockAtFeet) return false; // Không lấy được thông tin khối

  // Nếu khối tại chân đã là đuốc thì bỏ qua
  if (blockAtFeet.name.includes('torch')) {
    // console.log("[Auto Torch DEBUG] Block at feet is already a torch. Skipping.");
    return false;
  }

  const lightLevelAtFeet = blockAtFeet.light || 0; // Lấy ánh sáng tại chân, mặc định là 0 nếu lỗi

  // --- DEBUG LOG ---
  const currentPos = botInstance.entity.position;
  // console.log(`[Auto Torch DEBUG] Pos: ${formatCoords(currentPos)}, BlockBelow: ${blockBelow.name}(${blockBelow.type}), FeetBlock: ${blockAtFeet.name}(${blockAtFeet.type}), Light@Feet: ${lightLevelAtFeet}, Threshold: ${TORCH_LIGHT_THRESHOLD}`);
  // ---------------

  // Nếu ánh sáng đủ, không cần làm gì cả
  if (lightLevelAtFeet >= TORCH_LIGHT_THRESHOLD) {
    // console.log("[Auto Torch DEBUG] Light OK, skipping.");
    return false;
  }

  // === BẮT ĐẦU XỬ LÝ ĐẶT ĐUỐC ===
  // console.log(`[Auto Torch] Phát hiện ánh sáng thấp (${lightLevelAtFeet}), bắt đầu xử lý đặt đuốc...`);
  isProcessingAutoTorch = true;

  try {
    // 1. Kiểm tra và chế tạo đuốc nếu cần
    let torchItem = botInstance.inventory.findInventoryItem(botInstance.registry.itemsByName.torch.id);
    if (!torchItem) {
      // console.log("[Auto Torch] Không có đuốc, thử chế tạo...");
      const crafted = await checkAndCraftTorches();
      if (!crafted) {
        // console.log("[Auto Torch] Chế tạo đuốc thất bại hoặc không đủ nguyên liệu.");
        isProcessingAutoTorch = false;
        return false;
      }
      await sleep(500); // Chờ inventory cập nhật
      torchItem = botInstance.inventory.findInventoryItem(botInstance.registry.itemsByName.torch.id);
      if (!torchItem) {
        // console.error("[Auto Torch] Lỗi: Đã báo chế tạo nhưng không tìm thấy đuốc!");
        isProcessingAutoTorch = false;
        return false;
      }
      // console.log("[Auto Torch] Đã chế tạo đuốc, tiếp tục tìm chỗ đặt.");
    }

    // *** ƯU TIÊN 1: ĐẶT NGAY DƯỚI CHÂN ***
    // (Sử dụng lại blockBelow và blockAtFeet đã lấy ở trên)
    // console.log(`[DEBUG P1 Check] blockBelow: ${!!blockBelow}, boundingBox: ${blockBelow?.boundingBox}, canPlaceOn: ${blockBelow?.canPlaceOn}, blockAtFeet: ${!!blockAtFeet}, feetNameAir: ${blockAtFeet?.name === 'air'}`);
    if (blockBelow && blockBelow.boundingBox === 'block'  && blockAtFeet && blockAtFeet.name === 'air') {
        // console.log(`[Auto Torch] Thử Ưu tiên 1: Đặt dưới chân lên ${blockBelow.name}...`);
        const placeTargetBelow = {
            block: blockBelow,
            faceVector: new Vec3(0, 1, 0), // Đặt lên mặt trên
            position: blockAtFeet.position, // Vị trí dự kiến của đuốc (tại chân)
        };

        // Kiểm tra ánh sáng và đuốc gần tại vị trí sẽ đặt (chân)
        const canPlaceFloorTorch = await canPlaceFloorTorchCheck(placeTargetBelow.position);
        if (canPlaceFloorTorch) {
            const placed = await validateAndPlaceTorch(placeTargetBelow, torchItem);
            if (placed) {
                console.log("[Auto Torch] Đặt đuốc dưới chân thành công! ✨");
                lastPlaceTime = Date.now();
                isProcessingAutoTorch = false;
                return true; // <-- THÀNH CÔNG, KẾT THÚC
            } else {
                // console.log("[Auto Torch] Đặt dưới chân thất bại (validate/place).");
            }
        } else {
            // console.log("[Auto Torch] Không thể đặt dưới chân (ánh sáng/đuốc gần).");
        }
    }

    // *** ƯU TIÊN 2: ĐẶT TRÊN TƯỜNG GẦN ***
    // console.log("[Auto Torch] Thử Ưu tiên 2: Tìm tường xung quanh...");
    // Tìm kiếm từ vị trí đầu bot để ưu tiên đặt ngang tầm mắt
    const blockAtHead = botInstance.blockAt(botInstance.entity.position.offset(0, 1, 0));
    if (blockAtHead && blockAtHead.position) {
        const immediatePlaceTarget = await findValidTorchPlacementOriginal(blockAtHead.position);
        if (immediatePlaceTarget) {
            // console.log(`[Auto Torch] Tìm thấy tường tại ${formatCoords(immediatePlaceTarget.block.position)}, đặt tại ${formatCoords(immediatePlaceTarget.position)}. Thử đặt...`);
            const placed = await validateAndPlaceTorch(immediatePlaceTarget, torchItem);
            if (placed) {
                console.log("[Auto Torch] Đặt đuốc lên tường thành công! ✨");
                lastPlaceTime = Date.now();
                isProcessingAutoTorch = false;
                return true; // <-- THÀNH CÔNG, KẾT THÚC
            } else {
                // console.log("[Auto Torch] Đặt lên tường thất bại (validate/place).");
            }
        } else {
            // console.log("[Auto Torch] Không tìm thấy tường hợp lệ xung quanh.");
        }
    } else {
        //  console.warn("[Auto Torch] Không thể lấy block ở đầu để tìm tường.");
    }


    // *** ƯU TIÊN 3: TẠO KHỐI VÀ ĐẶT LÊN ***
    if (ENABLE_CREATE_SPOT) {
      // console.log("[Auto Torch] Thử Ưu tiên 3: Tạo khối để đặt đuốc...");
      const createdAndPlaced = await tryCreateAndPlaceTorch(torchItem);
      if (createdAndPlaced) {
        console.log("[Auto Torch] Tạo khối và đặt đuốc thành công! ✨");
        lastPlaceTime = Date.now();
        isProcessingAutoTorch = false;
        return true; // <-- THÀNH CÔNG, KẾT THÚC
      } else {
        // Log lỗi đã có trong hàm con
      }
    }

    // Nếu tất cả các cách trên đều thất bại
    // console.log("[Auto Torch] Không thể đặt đuốc tại chỗ bằng mọi cách.");
    isProcessingAutoTorch = false;
    return false; // Tất cả thất bại

  } catch (err) {
    console.error("[Auto Torch] Lỗi không mong muốn trong checkAndPlaceTorch:", err.message, err.stack);
    if (err.message?.includes('TransactionExpiredError')) {
      console.warn("[Auto Torch] TransactionExpiredError - có thể do lag server.");
    }
    isProcessingAutoTorch = false;
    return false;
  }
}

// --- Hàm phụ trợ ---

// Kiểm tra điều kiện trước khi đặt đuốc dưới sàn
async function canPlaceFloorTorchCheck(potentialTorchPos) {
    if (!potentialTorchPos) return false;

    const blockAtPlacement = botInstance.blockAt(potentialTorchPos);
    if (!blockAtPlacement) {
        // console.warn(`[Auto Torch Floor Check] Không thể lấy thông tin khối tại ${formatCoords(potentialTorchPos)}.`);
        return false;
    }

    // Kiểm tra ánh sáng tại vị trí đặt tiềm năng (dùng PLACEMENT_LIGHT_THRESHOLD để nhất quán)
    if (blockAtPlacement.light >= PLACEMENT_LIGHT_THRESHOLD) {
        // console.log(`[Auto Torch Floor Check] Bỏ qua, ánh sáng tại ${formatCoords(potentialTorchPos)} là ${blockAtPlacement.light} (>= ${PLACEMENT_LIGHT_THRESHOLD})`);
        return false;
    }

    // Kiểm tra đuốc gần vị trí đặt tiềm năng
    const nearbyTorches = botInstance.findBlocks({
        point: potentialTorchPos,
        matching: (block) => block && (block.name === "torch" || block.name === "wall_torch"),
        maxDistance: MIN_TORCH_DISTANCE,
        count: 1,
    });
    if (Array.isArray(nearbyTorches) && nearbyTorches.length > 0) {
        // console.log(`[Auto Torch Floor Check] Bỏ qua, đã có đuốc gần tại ${formatCoords(nearbyTorches[0].position)}`);
        return false;
    }

    return true; // Có thể đặt
}


// Chế tạo đuốc
async function checkAndCraftTorches() {
  const coalCount =
    botInstance.inventory.count(botInstance.registry.itemsByName.coal.id) +
    botInstance.inventory.count(botInstance.registry.itemsByName.charcoal.id);
  const stickCount = botInstance.inventory.count(
    botInstance.registry.itemsByName.stick.id
  );

  if (coalCount >= REQUIRED_COAL && stickCount >= REQUIRED_STICK) {
    if (!aiModelInstance) {
        // console.warn("[Auto Torch] Không có AI Model để thực hiện chế tạo.");
      return false;
    }
    try {
      console.log(`[Auto Torch] Đang yêu cầu AI chế tạo ${TORCH_CRAFT_AMOUNT} đuốc...`);
      const crafted = await craftCommands.craftItem(
        botInstance,
        "System", // Hoặc tên người dùng nếu muốn
        `chế tạo ${TORCH_CRAFT_AMOUNT} đuốc`,
        aiModelInstance,
        TORCH_CRAFT_AMOUNT // Số lượng mong muốn (AI có thể không làm đúng)
      );

      if (crafted) {
        console.log("[Auto Torch] AI báo cáo đã chế tạo đuốc thành công.");
        return true;
      } else {
        // console.log("[Auto Torch] AI báo cáo chế tạo đuốc thất bại.");
        return false;
      }
    } catch (craftError) {
      console.error("[Auto Torch] Lỗi khi gọi hàm craftItem:", craftError);
      return false;
    }
  } else {
    console.log(
      `[Auto Torch] Không đủ nguyên liệu (Cần ${REQUIRED_COAL} coal/charcoal, ${REQUIRED_STICK} stick. Có ${coalCount}, ${stickCount}).`
    );
    return false;
  }
}

// Tìm vị trí đặt trên tường gần
async function findValidTorchPlacementOriginal(searchPoint) {
  if (!botInstance || !botInstance.version || !searchPoint) return null;

  const placeableFacesData = [
    // { face: 0, vector: new Vec3(0, 1, 0) }, // Mặt trên - Không dùng cho tường
    // { face: 1, vector: new Vec3(0, -1, 0) }, // Mặt dưới - Không dùng cho tường
    { face: 2, vector: new Vec3(0, 0, 1) }, // +Z
    { face: 3, vector: new Vec3(0, 0, -1) }, // -Z
    { face: 4, vector: new Vec3(1, 0, 0) }, // +X
    { face: 5, vector: new Vec3(-1, 0, 0) }, // -X
  ];

  const nearbySolidBlocks = botInstance.findBlocks({
    matching: (block) =>
      block &&
      block.boundingBox === "block" && // Phải là khối rắn
      block.name !== "air" &&
      !block.name.includes("torch") &&
      !block.name.includes("sign") &&
      !block.name.includes("button") && // Thêm các khối không nên đặt lên
      !block.name.includes("lever") &&
      !block.name.includes("door") &&
      !block.name.includes("gate") &&
      !block.name.includes("chest") && // Không đặt lên rương
      !block.name.includes("furnace") && // Không đặt lên lò
      !block.name.includes("crafting_table"), // Không đặt lên bàn chế tạo
    point: searchPoint,
    maxDistance: CHECK_DISTANCE,
    count: 30,
  });

  let bestPlacement = null;
  let minDistanceSq = CHECK_DISTANCE * CHECK_DISTANCE; // Tìm điểm gần nhất trong tầm

  for (const pos of nearbySolidBlocks) {
    const wallBlock = botInstance.blockAt(pos);
    if (!wallBlock || !wallBlock.position) continue;

    for (const { face, vector } of placeableFacesData) {
      const torchPos = wallBlock.position.plus(vector); // Vị trí dự kiến của đuốc
      const blockAtTorchPos = botInstance.blockAt(torchPos);

      // Chỉ đặt vào khối air
      if (blockAtTorchPos && blockAtTorchPos.name === "air") {
        if (!botInstance.entity || !botInstance.entity.position) continue; // Cần vị trí bot để tính khoảng cách

        // Tính khoảng cách từ bot đến vị trí đuốc tiềm năng
        const distSq = botInstance.entity.position.distanceSquared(torchPos);

        // Phải đủ gần bot để đặt (tầm với ~4.5) và gần hơn điểm tốt nhất hiện tại
        if (distSq <= 4.5 * 4.5 && distSq < minDistanceSq) {
          // Kiểm tra ánh sáng và đuốc gần tại vị trí sẽ đặt
           const canPlaceWallTorch = await canPlaceWallTorchCheck(torchPos);
           if(canPlaceWallTorch){
                minDistanceSq = distSq;
                bestPlacement = {
                  block: wallBlock, // Khối tường để đặt lên
                  faceVector: vector, // Mặt của khối tường đó
                  position: torchPos, // Tọa độ của khối air nơi đuốc sẽ xuất hiện
                };
           }
        }
      }
    }
  }
  // if (!bestPlacement) console.log("[Auto Torch] Không tìm thấy vị trí tường hợp lệ gần đó.");
  return bestPlacement;
}

// Kiểm tra điều kiện trước khi đặt đuốc lên tường
async function canPlaceWallTorchCheck(potentialTorchPos) {
    if (!potentialTorchPos) return false;

    const blockAtPlacement = botInstance.blockAt(potentialTorchPos);
    if (!blockAtPlacement) {
        // console.warn(`[Auto Torch Wall Check] Không thể lấy thông tin khối tại ${formatCoords(potentialTorchPos)}.`);
        return false;
    }

    // Kiểm tra ánh sáng tại vị trí đặt tiềm năng
    if (blockAtPlacement.light >= PLACEMENT_LIGHT_THRESHOLD) {
        // console.log(`[Auto Torch Wall Check] Bỏ qua, ánh sáng tại ${formatCoords(potentialTorchPos)} là ${blockAtPlacement.light} (>= ${PLACEMENT_LIGHT_THRESHOLD})`);
        return false;
    }

    // Kiểm tra đuốc gần vị trí đặt tiềm năng
    const nearbyTorches = botInstance.findBlocks({
        point: potentialTorchPos,
        matching: (block) => block && (block.name === "torch" || block.name === "wall_torch"),
        maxDistance: MIN_TORCH_DISTANCE,
        count: 1,
    });
    if (Array.isArray(nearbyTorches) && nearbyTorches.length > 0) {
        // console.log(`[Auto Torch Wall Check] Bỏ qua, đã có đuốc gần tại ${formatCoords(nearbyTorches[0].position)}`);
        return false;
    }

    return true; // Có thể đặt
}


// Xác thực và thực hiện đặt đuốc
async function validateAndPlaceTorch(placeTarget, torchItem) {
  if (
    !placeTarget || !placeTarget.position || !placeTarget.block ||
    !placeTarget.faceVector || !torchItem
  ) {
    console.warn("[Auto Torch Validate] Dữ liệu đặt không hợp lệ.");
    return false;
  }

  const potentialTorchPos = placeTarget.position;
  const blockToPlaceOn = placeTarget.block;
  const faceToPlaceOn = placeTarget.faceVector;

  // Kiểm tra tầm với lần cuối (dù logic tìm kiếm đã cố gắng đảm bảo)
  if (!botInstance.entity || !botInstance.entity.position) {
    // console.warn("[Auto Torch Validate] Không thể xác định vị trí bot để kiểm tra tầm với.");
    return false;
  }
  const distanceSq = botInstance.entity.position.distanceSquared(potentialTorchPos);
  // Cho phép xa hơn một chút phòng trường hợp đặt dưới chân hoặc tường hơi xa
  if (distanceSq > 5.0 * 5.0) {
    // console.log(`[Auto Torch Validate] Vị trí đặt ${formatCoords(potentialTorchPos)} quá xa (distSq: ${distanceSq.toFixed(2)}).`);
    return false;
  }

  // Kiểm tra lại ánh sáng và đuốc gần (đã được kiểm tra bởi canPlace... nhưng chắc ăn)
  const blockAtPlacement = botInstance.blockAt(potentialTorchPos);
  if (!blockAtPlacement) {
    // console.warn(`[Auto Torch Validate] Không thể lấy thông tin khối tại vị trí đặt ${formatCoords(potentialTorchPos)}.`);
    return false;
  }
  if (blockAtPlacement.light >= PLACEMENT_LIGHT_THRESHOLD) {
    // console.log(`[Auto Torch Validate] Ánh sáng tại vị trí đặt ${formatCoords(potentialTorchPos)} là ${blockAtPlacement.light}, quá cao.`);
    return false;
  }
  const nearbyTorches = botInstance.findBlocks({
    point: potentialTorchPos,
    matching: (block) => block && (block.name === "torch" || block.name === "wall_torch"),
    maxDistance: MIN_TORCH_DISTANCE,
    count: 1,
  });
  if (Array.isArray(nearbyTorches) && nearbyTorches.length > 0) {
    // console.log(`[Auto Torch Validate] Đã có đuốc khác quá gần tại ${formatCoords(nearbyTorches[0].position)}.`);
    return false;
  }

  // Thực hiện đặt
  try {
    // Đảm bảo đang cầm đuốc
    if (!botInstance.heldItem || botInstance.heldItem.type !== torchItem.type) {
      // console.log("[Auto Torch Validate] Đang trang bị đuốc...");
      await botInstance.equip(torchItem, "hand");
      await sleep(250); // Chờ equip xong
    }

    // Nhìn vào khối sẽ đặt (quan trọng để placeBlock hoạt động ổn định)
    // await botInstance.lookAt(blockToPlaceOn.position.offset(0.5, 0.5, 0.5), true); // Nhìn vào giữa khối
    // await sleep(100); // Chờ nhìn xong

    // Đặt khối
    // console.log(`[Auto Torch Validate] Thực hiện placeBlock lên ${blockToPlaceOn.name} tại ${formatCoords(blockToPlaceOn.position)} với face ${formatCoords(faceToPlaceOn)}`);
    await botInstance.placeBlock(blockToPlaceOn, faceToPlaceOn);
    // console.log("[Auto Torch Validate] Lệnh placeBlock đã gửi.");
    await sleep(150); // Chờ server xử lý đặt block
    return true; // Giả định thành công nếu không có lỗi

  } catch (placeError) {
    console.warn(`[Auto Torch Validate] Lỗi khi đặt đuốc: ${placeError.message}`);
    if ( placeError.message.includes("Must be targeting a block") || placeError.message.includes("rejected transaction") || placeError.message.includes("Server misbehaved") || placeError.message.includes("invalid direction"))
    {
      // Lỗi thường gặp, không cần log stack
    } else {
        console.error(placeError.stack); // Log stack cho lỗi lạ
    }
    return false;
  }
}

// Tạo khối và đặt đuốc lên
async function tryCreateAndPlaceTorch(torchItem) {
  const createBlockInfo = botInstance.registry.itemsByName[CREATE_SPOT_BLOCK_NAME];
  if (!createBlockInfo) {
    // console.warn(`[Auto Torch Create] Không tìm thấy thông tin cho khối ${CREATE_SPOT_BLOCK_NAME}.`);
    return false;
  }

  const createBlockItem = botInstance.inventory.findInventoryItem(createBlockInfo.id);
  if (!createBlockItem) {
    // console.log(`[Auto Torch Create] Không có ${CREATE_SPOT_BLOCK_NAME} trong túi đồ.`);
    return false;
  }

  const botPos = botInstance.entity.position;
  if (!botPos) return false;

  let placementBaseBlock = null; // Khối dưới đất để đặt khối mới lên
  let placePos = null; // Vị trí của khối mới sẽ tạo
  let bestDistSq = 3 * 3; // Tìm vị trí gần nhất trong phạm vi 3x3

  // Các vị trí xung quanh bot (ưu tiên ngang tầm)
  const offsets = [
    { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 },
    { x: 1, z: 1 }, { x: 1, z: -1 }, { x: -1, z: 1 }, { x: -1, z: -1 },
  ];

  // Tìm vị trí tốt nhất để tạo khối
  for (const offset of offsets) {
    const checkPlacePos = botPos.offset(offset.x, 0, offset.z).floored(); // Vị trí ngang tầm bot
    const checkBasePos = checkPlacePos.offset(0, -1, 0); // Vị trí khối ngay dưới đó

    const blockAtPlace = botInstance.blockAt(checkPlacePos); // Khối tại vị trí ngang tầm
    const blockAtBase = botInstance.blockAt(checkBasePos); // Khối dưới đất

    // Cần: Khối dưới đất phải rắn, vị trí ngang tầm phải là air
    if ( blockAtBase && blockAtBase.boundingBox === "block" && blockAtBase.position &&
         blockAtPlace && blockAtPlace.name === "air" )
    {
      const distSq = checkPlacePos.distanceSquared(botPos);
      // Phải đủ gần để đặt (<4.5) và gần hơn điểm tốt nhất hiện tại
      if (distSq <= 4.5 * 4.5 && distSq < bestDistSq) {
        // Kiểm tra xem có thể đặt khối MỚI lên khối base không
        if (blockAtBase.canPlaceOn) {
            try {
                // canPlaceBlock không tin cậy 100%, nhưng vẫn nên thử
                 if (await botInstance.canPlaceBlock(blockAtBase, new Vec3(0, 1, 0))) {
                    placementBaseBlock = blockAtBase;
                    placePos = checkPlacePos; // Lưu vị trí sẽ tạo khối
                    bestDistSq = distSq;
                 }
            } catch (e) { /* Bỏ qua lỗi canPlaceBlock */ }
        }
      }
    }
  }

  // Không tìm được chỗ thích hợp để tạo khối
  if (!placementBaseBlock || !placePos) {
    // console.log("[Auto Torch Create] Không tìm thấy vị trí phù hợp để tạo khối.");
    return false;
  }

  // Tiến hành tạo khối
  try {
    // Cầm khối cần tạo
    if (!botInstance.heldItem || botInstance.heldItem.type !== createBlockItem.type) {
      // console.log(`[Auto Torch Create] Trang bị ${CREATE_SPOT_BLOCK_NAME}...`);
      await botInstance.equip(createBlockItem, "hand");
      await sleep(250);
    }

    // Đặt khối tạo điểm tựa
    const placeVector = new Vec3(0, 1, 0); // Đặt lên trên khối base
    // console.log(`[Auto Torch Create] Đặt ${CREATE_SPOT_BLOCK_NAME} lên ${placementBaseBlock.name} tại ${formatCoords(placementBaseBlock.position)}...`);
    await botInstance.placeBlock(placementBaseBlock, placeVector);
    await sleep(400); // Chờ khối xuất hiện

    // Kiểm tra xem khối đã được tạo thành công chưa
    const newBlock = botInstance.blockAt(placePos);
    if (!newBlock || newBlock.name !== CREATE_SPOT_BLOCK_NAME || !newBlock.position) {
      // console.warn(`[Auto Torch Create] Đã gửi lệnh nhưng không thấy khối ${CREATE_SPOT_BLOCK_NAME} tại ${formatCoords(placePos)}.`);
      return false;
    }
    // console.log(`[Auto Torch Create] Đã tạo ${CREATE_SPOT_BLOCK_NAME} tại ${formatCoords(placePos)}. Giờ đặt đuốc lên trên...`);

    // Chuẩn bị để đặt đuốc lên khối vừa tạo
    const torchPlaceTarget = {
      block: newBlock, // Đặt lên khối mới tạo
      faceVector: new Vec3(0, 1, 0), // Đặt lên mặt trên của nó
      position: newBlock.position.plus(new Vec3(0, 1, 0)), // Vị trí của đuốc
    };

    // Gọi hàm validate để kiểm tra ánh sáng/đuốc gần và đặt
    return await validateAndPlaceTorch(torchPlaceTarget, torchItem);

  } catch (createError) {
    // console.warn(`[Auto Torch Create] Lỗi khi tạo khối ${CREATE_SPOT_BLOCK_NAME} tại ${formatCoords(placePos)}: ${createError.message}`);
    // if (createError.message.includes("Must be targeting a block")) console.warn("[Auto Torch Create] Lỗi 'Must be targeting a block'.");
    return false;
  }
}

// Format tọa độ cho log
function formatCoords(pos) {
  if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number" || typeof pos.z !== "number") {
    return "N/A";
  }
  return `(${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`;
}

// --- Exports ---
module.exports = {
  initializeAutoTorch,
  checkAndPlaceTorch,
  // Getter để kiểm tra trạng thái từ bên ngoài nếu cần
  get isProcessingAutoTorch() {
    return isProcessingAutoTorch;
  },
};
// --- END OF FILE commands/auto_torch.js ---