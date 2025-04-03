// commands/scan.js
const { formatCoords } = require("../utils");

const SCAN_RADIUS = 16; // Bán kính quét
const MAX_RESULTS_PER_ORE = 10; // Giới hạn số lượng hiển thị cho mỗi loại quặng

// Danh sách các loại quặng phổ biến (có thể thêm/bớt)
// Lấy tên ID chuẩn từ minecraft-data
const ORE_IDS = [
    'coal_ore', 'deepslate_coal_ore',
    'iron_ore', 'deepslate_iron_ore',
    'copper_ore', 'deepslate_copper_ore',
    'gold_ore', 'deepslate_gold_ore',
    'redstone_ore', 'deepslate_redstone_ore', // Sẽ phát sáng khi tương tác
    'emerald_ore', 'deepslate_emerald_ore',
    'lapis_ore', 'deepslate_lapis_ore',
    'diamond_ore', 'deepslate_diamond_ore',
    'nether_gold_ore',
    'nether_quartz_ore',
    'ancient_debris' // Netherite Scrap
];

/**
 * Quét và báo cáo các khối quặng trong bán kính xung quanh bot.
 * @param {import('mineflayer').Bot} bot
 * @param {string} username
 */
async function scanNearbyOres(bot, username) {
    console.log(`[Scan] ${username} yêu cầu quét khoáng sản gần.`);
    bot.chat(`Ok ${username}, để tôi quét xung quanh xem có gì không... (bán kính ${SCAN_RADIUS} block)`);

    const mcData = require('minecraft-data')(bot.version);
    const foundOres = {};
    let totalFound = 0;

    // Lấy vị trí trung tâm để quét
    const centerPos = bot.entity.position;

    // Tạo danh sách các block ID cần tìm
    const oreBlockTypes = ORE_IDS.map(name => mcData.blocksByName[name]).filter(Boolean); // Lọc bỏ những tên không hợp lệ

    if (oreBlockTypes.length === 0) {
        console.error("[Scan] Không thể lấy thông tin block ID cho các loại quặng.");
        bot.chat(`Xin lỗi ${username}, tôi gặp lỗi khi lấy thông tin quặng.`);
        return;
    }

    try {
        // Tìm tất cả các khối khớp trong bán kính
        // findBlocks có thể chậm nếu bán kính lớn và nhiều loại khối
        const blocks = bot.findBlocks({
            point: centerPos,
            matching: oreBlockTypes.map(b => b.id), // Tìm tất cả các loại cùng lúc
            maxDistance: SCAN_RADIUS,
            count: 1000 // Đặt giới hạn count lớn để lấy nhiều kết quả
        });

        console.log(`[Scan] Tìm thấy tổng cộng ${blocks.length} khối quặng trong phạm vi.`);

        // Nhóm kết quả theo loại quặng
        for (const blockPos of blocks) {
            const block = bot.blockAt(blockPos); // Lấy thông tin chi tiết của khối tại vị trí đó
            if (block && ORE_IDS.includes(block.name)) {
                if (!foundOres[block.name]) {
                    foundOres[block.name] = 0;
                }
                if (foundOres[block.name] < MAX_RESULTS_PER_ORE) { // Chỉ đếm đến giới hạn
                    foundOres[block.name]++;
                    totalFound++;
                }
            }
        }

    } catch (error) {
        console.error("[Scan] Lỗi trong quá trình tìm kiếm khối:", error);
        bot.chat(`Xin lỗi ${username}, tôi gặp lỗi khi đang quét khoáng sản.`);
        return;
    }

    // Thông báo kết quả
    if (totalFound === 0) {
        bot.chat(`${username}, tôi không thấy quặng nào trong vòng ${SCAN_RADIUS} block quanh đây.`);
    } else {
        const oreList = Object.entries(foundOres)
            .map(([name, count]) => `${count}${count >= MAX_RESULTS_PER_ORE ? '+' : ''} ${name.replace('_ore', '').replace('deepslate_', 'ds_')}`) // Rút gọn tên cho dễ đọc
            .join(', ');
        bot.chat(`${username}, quanh đây có: ${oreList}.`);
    }
    console.log(`[Scan] Hoàn tất quét cho ${username}. Kết quả:`, foundOres);
}

module.exports = {
    scanNearbyOres,
};