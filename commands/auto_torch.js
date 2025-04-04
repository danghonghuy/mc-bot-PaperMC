// --- START OF FILE commands/auto_torch.js ---
const { Vec3 } = require('vec3');
const { sleep } = require('../utils'); // Giả sử bạn có hàm sleep trong utils.js
const craftCommands = require('./craft'); // Import module craft để chế tạo

const TORCH_LIGHT_THRESHOLD = 7; // Ngưỡng ánh sáng để đặt đuốc (0-15)
const CHECK_DISTANCE = 4; // Khoảng cách tối đa để tìm tường đặt đuốc
const PLACE_COOLDOWN_MS = 2000; // Chờ ít nhất 2 giây giữa các lần đặt

let botInstance = null;
let lastPlaceTime = 0;
let isPlacingTorch = false; // Cờ để tránh gọi liên tục

// Hàm khởi tạo (lưu bot instance)
function initializeAutoTorch(bot) {
    botInstance = bot;
    console.log("[Auto Torch] Đã khởi tạo.");
}

// Hàm kiểm tra và đặt đuốc
async function checkAndPlaceTorch() {
    if (!botInstance || isPlacingTorch || !botInstance.entity) return false; // Kiểm tra bot và cờ

    const now = Date.now();
    if (now - lastPlaceTime < PLACE_COOLDOWN_MS) {
        // console.log("[Auto Torch Debug] Đang trong thời gian cooldown.");
        return false; // Đang trong cooldown
    }

    const blockAtFeet = botInstance.blockAt(botInstance.entity.position);
    const blockAtHead = botInstance.blockAt(botInstance.entity.position.offset(0, 1, 0));

    if (!blockAtFeet || !blockAtHead) {
        console.log("[Auto Torch Debug] Không thể lấy thông tin block tại vị trí bot.");
        return false;
    }

    // Ưu tiên kiểm tra ánh sáng ở chân trước
    const lightLevel = blockAtFeet.light;
    // console.log(`[Auto Torch Debug] Light level at feet: ${lightLevel}`);

    if (lightLevel < TORCH_LIGHT_THRESHOLD) {
        console.log(`[Auto Torch] Ánh sáng thấp (${lightLevel} < ${TORCH_LIGHT_THRESHOLD}). Cần đặt đuốc.`);
        isPlacingTorch = true; // Đặt cờ đang xử lý

        try {
            // 1. Kiểm tra có đuốc không
            const torchItem = botInstance.inventory.findInventoryItem(botInstance.registry.itemsByName.torch.id);

            if (torchItem) {
                console.log(`[Auto Torch] Tìm thấy ${torchItem.count} đuốc trong túi đồ.`);
                // 2. Tìm vị trí đặt hợp lệ (trên tường gần đó)
                const referenceBlock = botInstance.blockAt(botInstance.entity.position.offset(0, 1, 0)); // Khối ngang tầm mắt
                if (!referenceBlock) {
                    console.error("[Auto Torch] Không tìm thấy khối tham chiếu ngang tầm mắt.");
                    return false; // Trả về false nếu không tìm được chỗ
                }

                const placeTarget = await findValidTorchPlacement(referenceBlock);

                if (placeTarget) {
                    console.log(`[Auto Torch] Tìm thấy vị trí đặt đuốc hợp lệ tại ${formatCoords(placeTarget.position)} trên mặt ${placeTarget.face}.`);
                    await botInstance.equip(torchItem, 'hand');
                    await botInstance.waitForTicks(5); // Chờ đổi item
                    await botInstance.placeBlock(placeTarget.block, placeTarget.faceVector);
                    console.log("[Auto Torch] Đã đặt đuốc thành công.");
                    lastPlaceTime = Date.now(); // Cập nhật thời gian đặt cuối
                    return true; // Đặt thành công
                } else {
                    console.log("[Auto Torch] Không tìm thấy vị trí đặt đuốc hợp lệ gần đó.");
                    return false; // Không tìm được chỗ
                }
            } else {
                console.log("[Auto Torch] Không có đuốc trong túi đồ. Thử chế tạo...");
                // 3. Nếu không có, thử chế tạo
                const crafted = await craftCommands.craftItem(botInstance, botInstance.username, 'chế tạo đuốc', null, 4); // Chế tạo 4 cái đuốc (hoặc nhiều hơn)
                if (crafted) {
                    console.log("[Auto Torch] Chế tạo đuốc thành công. Sẽ thử đặt lại ở lần kiểm tra sau.");
                    // Không cần đặt ngay, lần checkAndPlaceTorch tiếp theo sẽ thấy đuốc
                    return true; // Báo hiệu đã thực hiện hành động (chế tạo)
                } else {
                    console.log("[Auto Torch] Không thể chế tạo đuốc (thiếu nguyên liệu?).");
                    return false; // Không chế tạo được
                }
            }
        } catch (err) {
            console.error("[Auto Torch] Lỗi trong quá trình đặt đuốc:", err.message);
            if (err.message.includes('TransactionExpiredError')) {
                 console.warn("[Auto Torch] TransactionExpiredError - có thể do lag server, thử lại sau.");
            }
            return false; // Có lỗi xảy ra
        } finally {
            isPlacingTorch = false; // Bỏ cờ sau khi hoàn tất (hoặc lỗi)
            console.log("[Auto Torch Debug] Kết thúc lượt kiểm tra đặt đuốc.");
        }
    } else {
        // console.log("[Auto Torch Debug] Ánh sáng đủ.");
        return false; // Ánh sáng đủ
    }
}

// Hàm phụ: Tìm vị trí đặt đuốc hợp lệ trên tường gần bot
async function findValidTorchPlacement(referenceBlock) {
    const mcData = require('minecraft-data')(botInstance.version);
    const placeableFaces = [
        { face: 2, vector: new Vec3(0, 0, 1) }, // South (+Z)
        { face: 3, vector: new Vec3(0, 0, -1) }, // North (-Z)
        { face: 4, vector: new Vec3(1, 0, 0) }, // East (+X)
        { face: 5, vector: new Vec3(-1, 0, 0) } // West (-X)
    ];

    // Tìm các khối rắn xung quanh trong phạm vi CHECK_DISTANCE
    const nearbySolidBlocks = botInstance.findBlocks({
        matching: (block) => block.boundingBox === 'block' && block.name !== 'air' && block.name !== 'torch' && block.name !== 'wall_torch', // Khối rắn, không phải không khí hoặc đuốc
        point: referenceBlock.position,
        maxDistance: CHECK_DISTANCE,
        count: 20 // Giới hạn số lượng block kiểm tra
    });

    console.log(`[Auto Torch Debug] Tìm thấy ${nearbySolidBlocks.length} khối rắn xung quanh.`);

    for (const pos of nearbySolidBlocks) {
        const block = botInstance.blockAt(pos);
        if (!block) continue;

        // Kiểm tra các mặt tường của khối rắn này
        for (const { face, vector } of placeableFaces) {
            // Tính vị trí sẽ đặt đuốc (trên mặt tường đó)
            const torchPos = block.position.plus(vector);
            const blockAtTorchPos = botInstance.blockAt(torchPos);

            // Kiểm tra xem vị trí đặt đuốc có phải là không khí không
            if (blockAtTorchPos && blockAtTorchPos.name === 'air') {
                 // Kiểm tra xem bot có thể "nhìn thấy" và tiếp cận vị trí đặt không
                 // (Mineflayer placeBlock đã bao gồm kiểm tra này ở mức độ nào đó)
                 // Trả về thông tin vị trí hợp lệ đầu tiên tìm thấy
                 console.log(`[Auto Torch Debug] -> Hợp lệ: Đặt trên ${block.name} tại ${formatCoords(block.position)} mặt ${vector}`);
                return {
                    block: block, // Khối tường để đặt lên
                    faceVector: vector, // Hướng đặt (từ tâm khối tường ra ngoài)
                    position: torchPos // Tọa độ thực tế của đuốc sẽ được đặt
                };
            }
        }
    }

    return null; // Không tìm thấy vị trí hợp lệ
}

// Hàm formatCoords (nếu chưa có trong utils.js)
function formatCoords(pos) {
    if (!pos) return 'N/A';
    return `(${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`;
}


module.exports = {
    initializeAutoTorch,
    checkAndPlaceTorch,
};
// --- END OF FILE commands/auto_torch.js ---