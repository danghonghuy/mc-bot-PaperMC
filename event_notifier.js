// event_notifier.js
const { formatCoords } = require("./utils"); // Đảm bảo bạn có file utils.js với hàm formatCoords

// --- Cấu hình ---
const config = {
    // Thông báo gốc
    notifyPlayerJoinLeave: true,
    notifyDangerousMobs: true,
    dangerousMobs: [
        { name: 'creeper', radius: 32, message: '> Cẩn thận! Có Creeper gần {coords}!', cooldown: 1000000 }, // Cooldown 10s cho mỗi loại mob
        { name: 'warden', radius: 64, message: '> !!! WARDEN KÌA !!! Ở chỗ {coords}! Chạy đi!', cooldown: 3000000 }, // Cooldown 30s
        // { name: 'vindicator', radius: 25, message: '> Vindicator đang tới gần {coords}!', cooldown: 10000 }
    ],

    // Thông báo trạng thái Bot
    statusNotifications: {
        enabled: true,
        lowHealth: { enabled: true, threshold: 8, cooldown: 60000, message: '> Cảnh báo! Máu của tôi thấp ({currentHealth}/20)!' }, // Ngưỡng 8 máu, cooldown 1 phút
        lowFood: { enabled: true, threshold: 6, cooldown: 90000, message: '> Cảnh báo! Thức ăn của tôi sắp hết ({currentFood}/20)!' }, // Ngưỡng 6 thức ăn, cooldown 1.5 phút
        lowDurability: { enabled: true, thresholdPercent: 0.15, checkInterval: 10000, cooldown: 120000, message: '> Cảnh báo! {itemName} của tôi sắp hỏng!' }, // 15% độ bền, kiểm tra mỗi 10s, cooldown 2 phút cho mỗi item
        inventoryFull: { enabled: true, cooldown: 180000, message: '> Kho đồ của tôi đã đầy!' } // Cooldown 3 phút
    },

    // Thông báo Môi trường & Sự kiện Thế giới
    worldNotifications: {
        enabled: true,
        timeChange: { enabled: true, notifyDusk: true, notifyDawn: true, duskMessage: '> Trời sắp tối, cẩn thận!', dawnMessage: '> Bình minh rồi!' },
        weatherChange: { enabled: true, rainStartMessage: '> Trời bắt đầu mưa.', rainStopMessage: '> Trời đã tạnh mưa.', thunderStartMessage: '> Có sấm sét!', thunderStopMessage: '> Sấm sét đã dừng.' },
        rareResource: { enabled: false, checkInterval: 45000, radius: 8, blocks: ['diamond_ore', 'ancient_debris'], cooldownPerBlock: 300000, message: '> Hình như có {blockName} gần {coords}!' }, // Tắt mặc định, check mỗi 45s, bán kính 8, cooldown 5 phút/block
        raidWarning: { enabled: true, soundName: 'entity.raid.horn', cooldown: 300000, message: '> Cảnh báo! Có vẻ một cuộc Raid sắp diễn ra gần đây!' } // Cooldown 5 phút
    }
};
// --- Kết thúc Cấu hình ---

let botInstance = null; // Lưu trữ instance của bot

// Biến trạng thái và cooldown
let lowHealthNotified = false;
let lowFoodNotified = false;
let inventoryFullNotified = false;
let previousTimePeriod = null; // 'day', 'dusk', 'night', 'dawn'
let previousWeather = null; // 'clear', 'rain', 'thunder'
const notifiedLowDurabilityItems = new Set(); // Lưu slot của item đã thông báo độ bền thấp
const notifiedRareBlocks = new Map(); // Lưu coordString -> timestamp của block hiếm đã thông báo
const lastNotifyTimes = {
    lowHealth: 0,
    lowFood: 0,
    inventoryFull: 0,
    raidWarning: 0,
    dangerousMobs: {} // Lưu cooldown cho từng loại mob nguy hiểm
};
let durabilityCheckIntervalId = null;
let rareResourceCheckIntervalId = null;

// --- Hàm xử lý sự kiện gốc ---

function handlePlayerJoined(player) {
    if (!botInstance || !config.notifyPlayerJoinLeave || player.username === botInstance.username) return;
    console.log(`[Event Notify] Người chơi ${player.username} đã vào server.`);
    safeChat(`> ${player.username} vừa vào server!`);
}

function handlePlayerLeft(player) {
    if (!botInstance || !config.notifyPlayerJoinLeave || player.username === botInstance.username) return;
    console.log(`[Event Notify] Người chơi ${player.username} đã rời server.`);
    safeChat(`> ${player.username} đã rời server.`);
}

function handleEntitySpawn(entity) {
    if (!botInstance || !config.notifyDangerousMobs || entity.type !== 'mob') return;

    const botPos = botInstance.entity.position;
    const entityPos = entity.position;

    for (const mobInfo of config.dangerousMobs) {
        if (entity.name === mobInfo.name) {
            const distance = botPos.distanceTo(entityPos);
            if (distance <= mobInfo.radius) {
                const now = Date.now();
                const lastNotify = lastNotifyTimes.dangerousMobs[mobInfo.name] || 0;
                if (now - lastNotify > mobInfo.cooldown) {
                    lastNotifyTimes.dangerousMobs[mobInfo.name] = now;
                    const coordsStr = formatCoords(entityPos);
                    const message = mobInfo.message.replace('{coords}', coordsStr).replace('{mobName}', entity.name);
                    console.log(`[Event Notify] Phát hiện mob nguy hiểm: ${entity.name} tại ${coordsStr}`);
                    safeChat(message);
                    // Không break để có thể cảnh báo nhiều loại mob khác nhau nếu chúng spawn cùng lúc và đủ điều kiện
                } else {
                    // console.log(`[Event Notify] Bỏ qua thông báo mob (cooldown): ${entity.name}`);
                }
            }
        }
    }
}

// --- Hàm xử lý sự kiện mới ---

function handleHealthUpdate() {
    if (!botInstance || !config.statusNotifications.enabled || !config.statusNotifications.lowHealth.enabled) return;

    const cfg = config.statusNotifications.lowHealth;
    const currentHealth = botInstance.health;

    if (currentHealth <= cfg.threshold) {
        if (!lowHealthNotified) {
            const now = Date.now();
            if (now - lastNotifyTimes.lowHealth > cfg.cooldown) {
                lastNotifyTimes.lowHealth = now;
                lowHealthNotified = true;
                const message = cfg.message.replace('{currentHealth}', Math.floor(currentHealth));
                console.log(`[Event Notify] Máu thấp: ${Math.floor(currentHealth)}`);
                safeChat(message);
            }
        }
    } else {
        // Reset trạng thái khi máu hồi phục trên ngưỡng
        if (lowHealthNotified) {
            lowHealthNotified = false;
            console.log("[Event Notify] Trạng thái máu thấp đã kết thúc.");
        }
    }
}

function handleFoodUpdate() {
    if (!botInstance || !config.statusNotifications.enabled || !config.statusNotifications.lowFood.enabled) return;

    const cfg = config.statusNotifications.lowFood;
    const currentFood = botInstance.food;

    if (currentFood <= cfg.threshold) {
        if (!lowFoodNotified) {
            const now = Date.now();
            if (now - lastNotifyTimes.lowFood > cfg.cooldown) {
                lastNotifyTimes.lowFood = now;
                lowFoodNotified = true;
                const message = cfg.message.replace('{currentFood}', currentFood);
                console.log(`[Event Notify] Thức ăn thấp: ${currentFood}`);
                safeChat(message);
            }
        }
    } else {
        // Reset trạng thái khi thức ăn trên ngưỡng
        if (lowFoodNotified) {
            lowFoodNotified = false;
            console.log("[Event Notify] Trạng thái thức ăn thấp đã kết thúc.");
        }
    }
}

function checkInventoryStatus() {
    if (!botInstance || !config.statusNotifications.enabled || !config.statusNotifications.inventoryFull.enabled) return;

    const cfg = config.statusNotifications.inventoryFull;
    const isFull = botInstance.inventory.emptySlotCount() === 0;

    if (isFull) {
        if (!inventoryFullNotified) {
            const now = Date.now();
            if (now - lastNotifyTimes.inventoryFull > cfg.cooldown) {
                lastNotifyTimes.inventoryFull = now;
                inventoryFullNotified = true;
                console.log("[Event Notify] Kho đồ đầy.");
                safeChat(cfg.message);
            }
        }
    } else {
        if (inventoryFullNotified) {
            inventoryFullNotified = false;
            console.log("[Event Notify] Kho đồ không còn đầy.");
        }
    }
}

function checkDurability() {
    if (!botInstance || !config.statusNotifications.enabled || !config.statusNotifications.lowDurability.enabled) return;

    const cfg = config.statusNotifications.lowDurability;
    const itemsToCheck = [
        botInstance.heldItem, // Item đang cầm
        ...botInstance.inventory.slots.filter(item => item && item.slot >= 5 && item.slot <= 8) // Giáp (slot 5-8)
    ].filter(Boolean); // Lọc bỏ null/undefined

    const now = Date.now();

    for (const item of itemsToCheck) {
        if (item.maxDurability) { // Chỉ kiểm tra item có độ bền
            const durabilityPercent = 1 - (item.durabilityUsed / item.maxDurability);
            const itemIdentifier = `${item.type}_${item.slot}`; // Định danh duy nhất cho item tại slot đó

            if (durabilityPercent <= cfg.thresholdPercent) {
                if (!notifiedLowDurabilityItems.has(itemIdentifier)) {
                     // Kiểm tra cooldown chung cho thông báo độ bền (tránh spam nếu nhiều item hỏng cùng lúc)
                     // Hoặc có thể làm cooldown riêng cho từng item nếu muốn phức tạp hơn
                    const lastGlobalNotify = lastNotifyTimes.lowDurability || 0;
                    if (now - lastGlobalNotify > cfg.cooldown) {
                        lastNotifyTimes.lowDurability = now; // Cập nhật cooldown chung
                        notifiedLowDurabilityItems.add(itemIdentifier);
                        const itemName = item.displayName || item.name; // Lấy tên hiển thị hoặc tên gốc
                        const message = cfg.message.replace('{itemName}', itemName);
                        console.log(`[Event Notify] Độ bền thấp: ${itemName} (${(durabilityPercent * 100).toFixed(1)}%)`);
                        safeChat(message);
                    }
                }
            } else {
                // Nếu độ bền tăng lên (sửa chữa) hoặc item không còn ở slot đó, xóa khỏi set
                if (notifiedLowDurabilityItems.has(itemIdentifier)) {
                    notifiedLowDurabilityItems.delete(itemIdentifier);
                    console.log(`[Event Notify] Độ bền của ${item.name} tại slot ${item.slot} không còn thấp.`);
                }
            }
        } else {
             // Nếu item không có độ bền mà vẫn còn trong set (ví dụ đổi item khác vào slot), xóa đi
             const itemIdentifier = `${item.type}_${item.slot}`;
             if (notifiedLowDurabilityItems.has(itemIdentifier)) {
                 notifiedLowDurabilityItems.delete(itemIdentifier);
             }
        }
    }

    // Dọn dẹp Set: Xóa các item không còn tồn tại trong inventory/armor slots
    const currentItemIdentifiers = new Set(itemsToCheck.map(item => `${item.type}_${item.slot}`));
    for (const notifiedIdentifier of notifiedLowDurabilityItems) {
        if (!currentItemIdentifiers.has(notifiedIdentifier)) {
            notifiedLowDurabilityItems.delete(notifiedIdentifier);
            // console.log(`[Event Notify] Dọn dẹp item không còn tồn tại khỏi danh sách độ bền thấp: ${notifiedIdentifier}`);
        }
    }
}

function handleTimeUpdate() {
    if (!botInstance || !config.worldNotifications.enabled || !config.worldNotifications.timeChange.enabled) return;

    const cfg = config.worldNotifications.timeChange;
    const timeOfDay = botInstance.time.timeOfDay;
    let currentTimePeriod = 'day'; // Mặc định

    // Xác định giai đoạn trong ngày (có thể cần tinh chỉnh các giá trị này)
    if (timeOfDay >= 6000 && timeOfDay < 12000) currentTimePeriod = 'day';
    else if (timeOfDay >= 12000 && timeOfDay < 13800) currentTimePeriod = 'dusk'; // Chạng vạng
    else if (timeOfDay >= 13800 && timeOfDay < 22200) currentTimePeriod = 'night'; // Đêm
    else if (timeOfDay >= 22200 || timeOfDay < 6000) currentTimePeriod = 'dawn'; // Rạng đông

    if (previousTimePeriod === null) { // Lần chạy đầu tiên
        previousTimePeriod = currentTimePeriod;
        console.log(`[Event Notify] Thời gian ban đầu: ${currentTimePeriod}`);
        return;
    }

    if (currentTimePeriod !== previousTimePeriod) {
        console.log(`[Event Notify] Thời gian thay đổi: ${previousTimePeriod} -> ${currentTimePeriod}`);
        if (currentTimePeriod === 'dusk' && cfg.notifyDusk) {
            safeChat(cfg.duskMessage);
        } else if (currentTimePeriod === 'dawn' && cfg.notifyDawn) {
            safeChat(cfg.dawnMessage);
        }
        previousTimePeriod = currentTimePeriod;
    }
}

function handleWeatherUpdate() {
    if (!botInstance || !config.worldNotifications.enabled || !config.worldNotifications.weatherChange.enabled) return;

    const cfg = config.worldNotifications.weatherChange;
    const currentWeather = botInstance.thunderState > 0 ? 'thunder' : (botInstance.rainState > 0 ? 'rain' : 'clear');

    if (previousWeather === null) { // Lần chạy đầu tiên
        previousWeather = currentWeather;
        console.log(`[Event Notify] Thời tiết ban đầu: ${currentWeather}`);
        return;
    }

    if (currentWeather !== previousWeather) {
        console.log(`[Event Notify] Thời tiết thay đổi: ${previousWeather} -> ${currentWeather}`);
        if (currentWeather === 'rain') safeChat(cfg.rainStartMessage);
        else if (currentWeather === 'thunder') safeChat(cfg.thunderStartMessage);
        else if (previousWeather === 'rain' && currentWeather === 'clear') safeChat(cfg.rainStopMessage);
        else if (previousWeather === 'thunder' && currentWeather === 'clear') safeChat(cfg.thunderStopMessage); // Giả định hết sét là trời quang
        else if (previousWeather === 'thunder' && currentWeather === 'rain') safeChat(cfg.thunderStopMessage); // Sét dừng nhưng vẫn mưa

        previousWeather = currentWeather;
    }
}

// async function checkRareResources() {
//     if (!botInstance || !config.worldNotifications.enabled || !config.worldNotifications.rareResource.enabled) return;

//     const cfg = config.worldNotifications.rareResource;
//     const now = Date.now();

//     // Dọn dẹp các block đã thông báo quá lâu khỏi Map
//     for (const [coordString, timestamp] of notifiedRareBlocks.entries()) {
//         if (now - timestamp > cfg.cooldownPerBlock) {
//             notifiedRareBlocks.delete(coordString);
//         }
//     }

//     try {
//         for (const blockName of cfg.blocks) {
//             const blockType = botInstance.registry.blocksByName[blockName];
//             if (!blockType) {
//                 console.warn(`[Event Notify] Không tìm thấy block type: ${blockName}`);
//                 continue;
//             }

//             const blocksFound = await botInstance.findBlocks({
//                 matching: blockType.id,
//                 maxDistance: cfg.radius,
//                 count: 5 // Giới hạn số lượng tìm thấy để tránh quá tải
//             });

//             if (blocksFound.length > 0) {
//                 for (const blockPos of blocksFound) {
//                     const coordString = `${blockPos.x},${blockPos.y},${blockPos.z}`;
//                     if (!notifiedRareBlocks.has(coordString)) {
//                         notifiedRareBlocks.set(coordString, now); // Lưu thời điểm thông báo
//                         const message = cfg.message
//                             .replace('{blockName}', blockName.replace('_', ' '))
//                             .replace('{coords}', formatCoords(blockPos));
//                         console.log(`[Event Notify] Phát hiện tài nguyên hiếm: ${blockName} tại ${formatCoords(blockPos)}`);
//                         safeChat(message);
//                         // Có thể break nếu chỉ muốn thông báo 1 block mỗi lần check
//                         // break;
//                     }
//                 }
//             }
//         }
//     } catch (err) {
//         console.error("[Event Notify] Lỗi khi tìm kiếm tài nguyên hiếm:", err);
//     }
// }

function handleSoundEffect(soundName, position) {
     if (!botInstance || !config.worldNotifications.enabled || !config.worldNotifications.raidWarning.enabled) return;

     const cfg = config.worldNotifications.raidWarning;
     if (soundName === cfg.soundName) {
         const now = Date.now();
         if (now - lastNotifyTimes.raidWarning > cfg.cooldown) {
             lastNotifyTimes.raidWarning = now;
             console.log(`[Event Notify] Nghe thấy tiếng tù và Raid tại ${formatCoords(position)}`);
             safeChat(cfg.message);
         }
     }
}

// --- Hàm tiện ích ---
function safeChat(message) {
    if (!botInstance || !botInstance.chat) return;
    try {
        botInstance.chat(message);
    } catch (e) {
        console.error("[Event Notify] Lỗi khi gửi tin nhắn chat:", e);
    }
}

function resetState() {
    console.log("[Event Notify] Resetting internal state...");
    lowHealthNotified = false;
    lowFoodNotified = false;
    inventoryFullNotified = false;
    previousTimePeriod = null;
    previousWeather = null;
    notifiedLowDurabilityItems.clear();
    notifiedRareBlocks.clear();
    lastNotifyTimes.lowHealth = 0;
    lastNotifyTimes.lowFood = 0;
    lastNotifyTimes.inventoryFull = 0;
    lastNotifyTimes.raidWarning = 0;
    lastNotifyTimes.dangerousMobs = {};
    lastNotifyTimes.lowDurability = 0; // Reset cooldown chung của độ bền
}

// --- Khởi tạo ---

/**
 * Khởi tạo các listener sự kiện cho bot.
 * Gọi hàm này một lần sau khi bot spawn.
 * @param {import('mineflayer').Bot} bot
 */
function initializeEventNotifier(bot) {
    if (botInstance) {
        // Gỡ listener cũ và dừng interval nếu có
        console.log("[Event Notify] Gỡ bỏ listener và interval cũ...");
        botInstance.removeListener('playerJoined', handlePlayerJoined);
        botInstance.removeListener('playerLeft', handlePlayerLeft);
        botInstance.removeListener('entitySpawn', handleEntitySpawn);
        botInstance.removeListener('health', handleHealthUpdate);
        botInstance.removeListener('food', handleFoodUpdate);
        botInstance.removeListener('playerCollect', checkInventoryStatus); // Kiểm tra kho đồ khi nhặt đồ
        botInstance.removeListener('time', handleTimeUpdate);
        botInstance.removeListener('weather', handleWeatherUpdate);
        botInstance.removeListener('soundEffectHeard', handleSoundEffect);

        if (durabilityCheckIntervalId) {
            clearInterval(durabilityCheckIntervalId);
            durabilityCheckIntervalId = null;
        }
        if (rareResourceCheckIntervalId) {
            clearInterval(rareResourceCheckIntervalId);
            rareResourceCheckIntervalId = null;
        }
        console.log("[Event Notify] Đã gỡ listener và interval cũ.");
    }

    botInstance = bot;
    resetState(); // Reset trạng thái khi khởi tạo hoặc khởi tạo lại

    console.log("[Event Notify] Khởi tạo và gắn listener sự kiện...");

    // Listener gốc
    if (config.notifyPlayerJoinLeave) {
        bot.on('playerJoined', handlePlayerJoined);
        bot.on('playerLeft', handlePlayerLeft);
    }
    if (config.notifyDangerousMobs) {
        bot.on('entitySpawn', handleEntitySpawn);
    }

    // Listener trạng thái Bot
    if (config.statusNotifications.enabled) {
        if (config.statusNotifications.lowHealth.enabled) {
            bot.on('health', handleHealthUpdate);
            handleHealthUpdate(); // Kiểm tra ngay khi khởi tạo
        }
        if (config.statusNotifications.lowFood.enabled) {
            bot.on('food', handleFoodUpdate);
            handleFoodUpdate(); // Kiểm tra ngay khi khởi tạo
        }
        if (config.statusNotifications.inventoryFull.enabled) {
            // Kiểm tra kho đồ khi nhặt đồ và định kỳ (hoặc chỉ khi nhặt đồ)
            bot.on('playerCollect', checkInventoryStatus);
            checkInventoryStatus(); // Kiểm tra ngay khi khởi tạo
        }
        if (config.statusNotifications.lowDurability.enabled) {
            durabilityCheckIntervalId = setInterval(checkDurability, config.statusNotifications.lowDurability.checkInterval);
            checkDurability(); // Kiểm tra ngay khi khởi tạo
        }
    }

    // Listener Môi trường & Sự kiện Thế giới
    if (config.worldNotifications.enabled) {
        if (config.worldNotifications.timeChange.enabled) {
            bot.on('time', handleTimeUpdate);
            handleTimeUpdate(); // Kiểm tra ngay khi khởi tạo
        }
        if (config.worldNotifications.weatherChange.enabled) {
            // Sự kiện 'weather' không tồn tại trực tiếp, phải kiểm tra rainState/thunderState định kỳ hoặc dựa vào sự kiện khác
            // Thay vào đó, ta sẽ dựa vào sự thay đổi state trong bot object, có thể kiểm tra trong 'time' hoặc interval riêng
            // -> Đã tích hợp kiểm tra trong handleWeatherUpdate và gọi từ 'time' hoặc interval (hiện tại gọi từ 'time' là đủ)
             bot.on('time', handleWeatherUpdate); // Tận dụng sự kiện time để kiểm tra thời tiết luôn
             handleWeatherUpdate(); // Kiểm tra ngay
        }
        // if (config.worldNotifications.rareResource.enabled) {
        //     rareResourceCheckIntervalId = setInterval(checkRareResources, config.worldNotifications.rareResource.checkInterval);
        //     checkRareResources(); // Kiểm tra ngay khi khởi tạo
        // }
         if (config.worldNotifications.raidWarning.enabled) {
             bot.on('soundEffectHeard', handleSoundEffect);
         }
    }

    console.log("[Event Notify] Đã khởi tạo và gắn listener sự kiện thành công.");
}

module.exports = {
    initializeEventNotifier,
    // Có thể export config nếu muốn đọc/thay đổi từ bên ngoài
    // config
};