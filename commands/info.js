// --- START OF FILE info.js ---

const util = require('util');
const setTimeoutPromise = util.promisify(setTimeout);

const CHAT_DELAY = 1500; // Giữ nguyên delay

// ***** CẬP NHẬT DANH SÁCH KHẢ NĂNG *****
const capabilities = [
    // Các khả năng cũ giữ nguyên
    { name: "Xem tọa độ", description: "Cho bạn biết tọa độ hiện tại của tôi.", example: "tọa độ của mày?" },
    { name: "Xem tọa độ khác", description: "Cho bạn biết tọa độ của người chơi/mob/vật thể khác.", example: "con bò ở đâu?" },
    { name: "Đi theo", description: "Đi theo bạn trong một khoảng cách nhất định.", example: "đi theo tao" },
    { name: "Tìm đồ/mob", description: "Tìm và đi đến gần khối hoặc sinh vật bạn yêu cầu.", example: "tìm cho tôi 5 cái bàn chế tạo" },
    { name: "Kiểm tra túi đồ", description: "Liệt kê những gì tôi đang có trong túi.", example: "mày có gì trong túi?" },
    { name: "Cho đồ", description: "Ném vật phẩm tôi có cho bạn.", example: "cho tao 10 cục đá" },
    { name: "Bảo vệ (theo lệnh)", description: "Đi theo và tấn công mob thù địch xung quanh bạn khi được yêu cầu.", example: "bảo vệ tôi" }, // Rõ hơn là theo lệnh
    { name: "Thu thập khối", description: "Đào/chặt khối bạn yêu cầu (ví dụ: đá, gỗ).", example: "lấy 32 gỗ sồi" },
    { name: "Đi đến tọa độ", description: "Di chuyển đến tọa độ X Y Z cụ thể.", example: "đi đến x 100 y 70 z 200" },
    { name: "Quét khoáng sản", description: "Tìm và báo cáo các loại quặng xung quanh.", example: "quanh đây có quặng gì?" },
    { name: "Lưu địa điểm", description: "Lưu vị trí hiện tại với một cái tên.", example: "lưu chỗ này là nhà" },
    { name: "Đến địa điểm", description: "Đi đến một địa điểm đã lưu.", example: "dẫn tôi đến nhà" },
    { name: "Xem địa điểm", description: "Liệt kê tất cả các địa điểm đã lưu.", example: "mày lưu chỗ nào rồi?" },
    { name: "Xóa địa điểm", description: "Xóa một địa điểm đã lưu.", example: "xóa điểm nhà đi" },
    { name: "Nhân giống", description: "Cho 2 động vật cùng loại ăn để chúng sinh sản.", example: "nhân giống bò đi" },
    { name: "Chế tạo", description: "Chế tạo vật phẩm theo công thức (bao gồm cả đuốc nếu thiếu).", example: "làm cho tôi 1 cái cúp sắt" }, // Ghi chú chế tạo đuốc
    { name: "Đi ngủ", description: "Tìm giường gần đó và đi ngủ (nếu là ban đêm/mưa bão).", example: "đi ngủ đi" },
    { name: "Đào hầm", description: "Đào một đường hầm thẳng ở Y-level thấp để tìm khoáng sản.", example: "đào hầm kim cương" },
    { name: "Săn bắn", description: "Tìm và tiêu diệt một số lượng mob cụ thể.", example: "giết 5 con gà" },
    { name: "Dọn túi đồ", description: "Tìm và vứt bỏ các vật phẩm không cần thiết (rác).", example: "dọn rác trong túi đồ đi" },
    { name: "Cất đồ vào rương", description: "Tìm rương gần đó và cất vật phẩm/danh mục bạn yêu cầu vào.", example: "cất hết đá vào rương" },
    { name: "Trang bị đồ", description: "Mặc giáp, cầm vũ khí/công cụ/khiên/đuốc... theo yêu cầu.", example: "mặc giáp sắt đi" },
    // ----- Các chức năng mới được thêm vào từ bot.js -----
    { name: "Làm phẳng khu vực", description: "Dọn cây, đào/lấp đất để làm phẳng một vùng bạn chỉ định.", example: "làm phẳng khu này 10x10" },
    { name: "Xây nhà", description: "Xây một căn nhà cơ bản tại vị trí được chọn (cần có đủ nguyên liệu).", example: "xây nhà ở đây" },
    // ----- Các khả năng tự động (quan trọng cần biết) -----
    { name: "Tự động ăn", description: "Tự động ăn thức ăn tốt nhất trong túi khi đói (dưới 13/20 hunger).", example: "(Tự động)" },
    { name: "Tự động đặt đuốc", description: "Tự động đặt đuốc khi đào mỏ hoặc ở nơi quá tối nếu có sẵn đuốc (hoặc tự chế tạo nếu có nguyên liệu).", example: "(Tự động khi đào mỏ/tối)" },
    { name: "Tự động phòng thủ", description: "Khi bị tấn công (và không đang làm nhiệm vụ khác), tôi sẽ tự đánh trả hoặc chạy trốn.", example: "(Tự động khi bị đánh)" },
    // ----- Các lệnh điều khiển -----
    { name: "Dừng lại", description: "Hủy bỏ mọi hành động tôi đang làm (bao gồm cả thức dậy, tự vệ).", example: "dừng lại" },
    { name: "Trò chuyện", description: "Nói chuyện phiếm với tôi!", example: "khỏe không bot?" },
];
// ********************************************

// Hàm listCapabilities giữ nguyên 100%
async function listCapabilities(bot, username) {
    console.log(`[Info] ${username} yêu cầu liệt kê khả năng.`);
    try {
        await bot.chat(`Chào ${username}, tôi có thể làm những việc sau (${capabilities.length} mục):`);
        await setTimeoutPromise(CHAT_DELAY / 2); // Delay ngắn trước khi bắt đầu liệt kê

        for (let i = 0; i < capabilities.length; i++) {
            const capability = capabilities[i];
            // Chia nhỏ tin nhắn nếu quá dài (Minecraft giới hạn ký tự chat) - Cân nhắc nếu mô tả dài hơn
            const message = `(${i + 1}) ${capability.name}: ${capability.description} (VD: "${capability.example}")`;
            await bot.chat(message);
            console.log(`[Info] Sent capability ${i + 1}: ${capability.name}`);
            // Chỉ delay giữa các tin nhắn, không delay sau tin nhắn cuối
            if (i < capabilities.length - 1) {
                await setTimeoutPromise(CHAT_DELAY);
            }
        }
        console.log(`[Info] Hoàn tất liệt kê khả năng cho ${username}.`);
    } catch (error) {
        console.error(`[Info] Lỗi khi gửi tin nhắn liệt kê khả năng:`, error);
        // Có thể thử gửi tin nhắn báo lỗi cho người dùng nếu cần
        // try { await bot.chat(`Xin lỗi ${username}, tôi gặp lỗi khi liệt kê khả năng.`); } catch(e){}
    }
}

module.exports = {
    listCapabilities,
};
// --- END OF FILE info.js ---