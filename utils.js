// --- START OF FILE utils.js (Đã bổ sung) ---
const path = require('path');

const translationsPath = path.join(__dirname, 'localization', 'vi_vn.js');
let translations = {};
let reversedTranslations = {};

try {
    translations = require(translationsPath);
    console.log(`[Utils] Đã tải thành công file dịch từ: ${translationsPath}`);
    for (const vietnameseName in translations) {
        const englishId = translations[vietnameseName];
        if (!reversedTranslations[englishId] || vietnameseName.length < reversedTranslations[englishId].length) {
            reversedTranslations[englishId] = vietnameseName;
        }
    }
    console.log(`[Utils] Đã tạo bản đồ dịch ngược với ${Object.keys(reversedTranslations).length} mục.`);
} catch (error) {
    console.error(`[Utils - LỖI] Không thể tải file dịch tại ${translationsPath}. Các chức năng dịch sẽ không hoạt động!`, error);
    translations = {};
    reversedTranslations = {};
}

const roundCoord = (coord) => Math.round(coord);

const formatCoords = (pos) => {
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number' || typeof pos.z !== 'number') return 'N/A';
    return `(${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`; // Sử dụng floor cho nhất quán
};

function translateToEnglishId(term) {
  if (!term || typeof term !== 'string') return null;
  const lowerTerm = term.toLowerCase().trim();
  if (!lowerTerm) return null;
  if (Object.keys(translations).length === 0) return null; // Trả về null nếu không có dữ liệu dịch

  for (const key in translations) {
    if (key.toLowerCase() === lowerTerm) return translations[key];
  }

  const prefixesToRemove = ["cái ", "con ", "khối ", "cục ", "viên ", "thanh ", "miếng ", "hạt ", "bụi "];
  for (const prefix of prefixesToRemove) {
      if (lowerTerm.startsWith(prefix)) {
          const termWithoutPrefix = lowerTerm.substring(prefix.length);
          for (const key in translations) {
              if (key.toLowerCase() === termWithoutPrefix) {
                  // console.log(`[Utils - Translate] Đã dịch "${term}" thành "${translations[key]}" sau khi bỏ tiền tố.`);
                  return translations[key];
              }
          }
      }
  }
  return null;
}

function translateToVietnamese(englishId) {
    if (!englishId || typeof englishId !== 'string') return englishId || '';
    if (Object.keys(reversedTranslations).length === 0) return englishId;
    const vietnameseName = reversedTranslations[englishId];
    return vietnameseName || englishId; // Fallback về ID gốc
}

function sleep(ms) {
  const delay = Math.max(0, ms);
  return new Promise(resolve => setTimeout(resolve, delay));
}

// ==============================================
// === BỔ SUNG CÁC HÀM HELPER KIỂM TRA BLOCK ===
// ==============================================

/**
 * Kiểm tra xem block có phải là khối rắn chắc không (dựa vào boundingBox).
 * @param {import('prismarine-block').Block | null | undefined} block - Đối tượng block cần kiểm tra.
 * @returns {boolean} True nếu là khối rắn, ngược lại là false.
 */
function isBlockSolid (block) {
    return block?.boundingBox === 'block';
}

/**
 * Kiểm tra xem block có phải là một khối nguy hiểm (lava, fire, cactus, magma, berry bush) không.
 * Cần có đối tượng registry từ bot.
 * @param {object} registry - Đối tượng registry từ bot.registry.
 * @param {import('prismarine-block').Block | null | undefined} block - Đối tượng block cần kiểm tra.
 * @returns {boolean} True nếu là khối nguy hiểm, ngược lại là false.
 */
function isBlockDangerous(registry, block) {
    if (!registry || !block) return false;
    // Tạo Set chứa ID các khối nguy hiểm một lần để tối ưu (nếu hàm này được gọi nhiều)
    // Hoặc có thể truyền Set này từ bên ngoài vào nếu muốn linh hoạt hơn
    const dangerousIds = new Set([
        registry.blocksByName.lava?.id,
        registry.blocksByName.fire?.id,
        registry.blocksByName.cactus?.id,
        registry.blocksByName.magma_block?.id,
        registry.blocksByName.sweet_berry_bush?.id,
        // Thêm các khối khác nếu cần (vd: wither_rose)
    ].filter(id => id !== undefined)); // Lọc bỏ các ID không tồn tại

    return dangerousIds.has(block.type);
}

/**
 * Kiểm tra xem block có phải là chất lỏng (nước hoặc lava) không.
 * Cần có đối tượng registry từ bot.
 * @param {object} registry - Đối tượng registry từ bot.registry.
 * @param {import('prismarine-block').Block | null | undefined} block - Đối tượng block cần kiểm tra.
 * @returns {boolean} True nếu là chất lỏng, ngược lại là false.
 */
function isBlockLiquid(registry, block) {
    if (!registry || !block) return false;
    return block.type === registry.blocksByName.water?.id ||
           block.type === registry.blocksByName.lava?.id;
}

// ==============================================
// === KẾT THÚC BỔ SUNG HELPER ===
// ==============================================


module.exports = {
    roundCoord, // Có vẻ không dùng nữa? formatCoords dùng floor
    formatCoords,
    translateToEnglishId,
    translateToVietnamese,
    sleep,
    // === THÊM CÁC HÀM MỚI VÀO EXPORT ===
    isBlockSolid,
    isBlockDangerous,
    isBlockLiquid,
    // ====================================
};
// --- END OF FILE utils.js ---