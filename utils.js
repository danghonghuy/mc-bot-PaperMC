  // utils.js
  // SỬA ĐƯỜNG DẪN Ở ĐÂY: từ '../localization/vi_vn.js' thành './localization/vi_vn.js' (ĐÃ SỬA THEO GHI CHÚ CỦA BẠN)
  const translations = require('./localization/vi_vn.js'); // Giữ nguyên đường dẫn đã sửa

  /**
   * Làm tròn tọa độ.
   * @param {number} coord Tọa độ cần làm tròn.
   * @returns {number} Tọa độ đã làm tròn.
   */
  const roundCoord = (coord) => Math.round(coord);

  /**
   * Định dạng đối tượng vị trí thành chuỗi "x: Y: z:".
   * @param {object} pos Đối tượng vị trí (có x, y, z).
   * @returns {string} Chuỗi tọa độ đã định dạng hoặc 'N/A'.
   */
  const formatCoords = (pos) => {
      if (!pos) return 'N/A';
      // Sửa lại định dạng theo code gốc của bạn là x:Y:z: (không có khoảng trắng)
      return `x:${roundCoord(pos.x)} y:${roundCoord(pos.y)} z:${roundCoord(pos.z)}`;
  };

  /**
   * Dịch một thuật ngữ tiếng Việt sang ID Minecraft tiếng Anh chuẩn.
   * @param {string} term Thuật ngữ tiếng Việt cần dịch.
   * @returns {string | null} ID tiếng Anh tương ứng hoặc null nếu không tìm thấy.
   */
  function translateToEnglishId(term) {
    if (!term) return null;
    const lowerTerm = term.toLowerCase().trim(); // Chuẩn hóa về chữ thường và loại bỏ khoảng trắng thừa

    // Ưu tiên tìm kiếm chính xác trước
    if (translations[lowerTerm]) {
      return translations[lowerTerm];
    }

    // Có thể thêm logic tìm kiếm mềm dẻo hơn ở đây nếu muốn (ví dụ: bỏ dấu, kiểm tra chứa từ khóa)
    // Ví dụ đơn giản: thử bỏ "cái", "con"
    const prefixesToRemove = ["cái ", "con "];
    for (const prefix of prefixesToRemove) {
        if (lowerTerm.startsWith(prefix)) {
            const termWithoutPrefix = lowerTerm.substring(prefix.length);
            if (translations[termWithoutPrefix]) {
                return translations[termWithoutPrefix];
            }
        }
    }

    return null; // Không tìm thấy bản dịch phù hợp
  }

  // ***** THÊM HÀM SLEEP *****
  /**
   * Tạm dừng thực thi trong một khoảng thời gian nhất định.
   * @param {number} ms Thời gian tạm dừng (miliseconds).
   * @returns {Promise<void>} Một Promise sẽ được resolve sau khi hết thời gian.
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  // **************************

  module.exports = {
      roundCoord,
      formatCoords,
      translateToEnglishId,
      sleep, // ***** THÊM SLEEP VÀO EXPORT *****
  };