const minecraftData = require('minecraft-data');
const version = '1.21.4'; // Phiên bản bot báo cáo
try {
    console.log(`[*] Đang thử tải mcData cho phiên bản: ${version}`);
    const mcData = minecraftData(version);

    if (!mcData) {
        console.error('[!] LỖI: Không thể tải mcData!');
    } else {
        console.log('[+] mcData đã được tải thành công.');
        console.log('--- Kiểm tra ItemsByName ---');
        console.log(`   - itemsByName tồn tại: ${!!mcData.itemsByName}`);
        if (mcData.itemsByName) {
            console.log(`   - Số lượng keys trong itemsByName: ${Object.keys(mcData.itemsByName).length}`);
            console.log(`   - mcData.itemsByName['raw_chicken']:`, mcData.itemsByName['raw_chicken']);
            console.log(`   - mcData.itemsByName['cooked_chicken']:`, mcData.itemsByName['cooked_chicken']);
            console.log(`   - mcData.itemsByName['stone']:`, mcData.itemsByName['stone']);
            console.log(`   - mcData.itemsByName['iron_ore']:`, mcData.itemsByName['iron_ore']);
            console.log(`   - mcData.itemsByName['raw_iron']:`, mcData.itemsByName['raw_iron']);
        } else {
            console.error('[!] LỖI: mcData.itemsByName không tồn tại!');
        }
        console.log('--- Kiểm tra Items (Array) ---');
         console.log(`   - items (array) tồn tại: ${!!mcData.items}`);
         if(mcData.items) {
              const rawChickenById = mcData.itemsArray.find(item => item.name === 'raw_chicken');
              console.log(`   - Tìm thấy raw_chicken trong itemsArray:`, rawChickenById);
         } else {
              console.error('[!] LỖI: mcData.items (array) không tồn tại!');
         }
    }
} catch (err) {
    console.error('[!] LỖI NGHIÊM TRỌNG khi tải mcData:', err);
}