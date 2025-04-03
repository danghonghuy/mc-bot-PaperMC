// commands/info.js
const util = require('util');
const setTimeoutPromise = util.promisify(setTimeout);

const CHAT_DELAY = 1500; // Thời gian chờ giữa các tin nhắn (ms)

// Danh sách khả năng đã cập nhật
const capabilities = [
    { name: "Xem tọa độ", description: "Cho bạn biết tọa độ hiện tại của tôi.", example: "tọa độ của mày?" },
    { name: "Xem tọa độ khác", description: "Cho bạn biết tọa độ của người chơi/mob/vật thể khác.", example: "con bò ở đâu?" },
    { name: "Đi theo", description: "Đi theo bạn trong một khoảng cách nhất định.", example: "đi theo tao" },
    { name: "Tìm đồ/mob", description: "Tìm và đi đến gần khối hoặc sinh vật bạn yêu cầu.", example: "tìm cho tôi 5 cái bàn chế tạo" },
    { name: "Kiểm tra túi đồ", description: "Liệt kê những gì tôi đang có trong túi.", example: "mày có gì trong túi?" },
    { name: "Cho đồ", description: "Ném vật phẩm tôi có cho bạn.", example: "cho tao 10 cục đá" },
    { name: "Bảo vệ", description: "Đi theo và tấn công mob thù địch xung quanh bạn.", example: "bảo vệ tôi" },
    { name: "Thu thập khối", description: "Đào/chặt khối bạn yêu cầu (ví dụ: đá, gỗ).", example: "lấy 32 gỗ sồi" },
    { name: "Đi đến tọa độ", description: "Di chuyển đến tọa độ X Y Z cụ thể.", example: "đi đến x 100 y 70 z 200" },
    { name: "Quét khoáng sản", description: "Tìm và báo cáo các loại quặng xung quanh.", example: "quanh đây có quặng gì?" },
    { name: "Lưu địa điểm", description: "Lưu vị trí hiện tại với một cái tên.", example: "lưu chỗ này là nhà" },
    { name: "Đến địa điểm", description: "Đi đến một địa điểm đã lưu.", example: "dẫn tôi đến nhà" },
    { name: "Xem địa điểm", description: "Liệt kê tất cả các địa điểm đã lưu.", example: "mày lưu chỗ nào rồi?" },
    { name: "Xóa địa điểm", description: "Xóa một địa điểm đã lưu.", example: "xóa điểm nhà đi" },
    { name: "Nhân giống", description: "Cho 2 động vật cùng loại ăn để chúng sinh sản.", example: "nhân giống bò đi" },
    { name: "Chế tạo", description: "Chế tạo vật phẩm theo công thức.", example: "làm cho tôi 1 cái cúp sắt" },
    { name: "Đi ngủ", description: "Tìm giường gần đó và đi ngủ (nếu là ban đêm/mưa bão).", example: "đi ngủ đi" },
    { name: "Đào hầm", description: "Đào một đường hầm thẳng ở Y-level thấp để tìm khoáng sản.", example: "đào hầm kim cương" }, // <<< THÊM
    { name: "Săn bắn", description: "Tìm và tiêu diệt một số lượng mob cụ thể.", example: "giết 5 con gà" }, // <<< THÊM
    { name: "Dọn túi đồ", description: "Tìm và vứt bỏ các vật phẩm không cần thiết (rác).", example: "dọn rác trong túi đồ đi" }, // <<< THÊM
    { name: "Dừng lại", description: "Hủy bỏ mọi hành động tôi đang làm (bao gồm cả thức dậy).", example: "dừng lại" },
    { name: "Trò chuyện", description: "Nói chuyện phiếm với tôi!", example: "khỏe không bot?" }
];

async function listCapabilities(bot, username) {
    console.log(`[Info] ${username} yêu cầu liệt kê khả năng.`);
    try {
        await bot.chat(`Chào ${username}, tôi có thể làm những việc sau (${capabilities.length} mục):`);
        await setTimeoutPromise(CHAT_DELAY / 2); // Chờ ngắn hơn chút trước khi bắt đầu

        for (let i = 0; i < capabilities.length; i++) {
            const capability = capabilities[i];
            // Chia thành 2 tin nhắn nếu quá dài? Hoặc giữ nguyên.
            const message = `(${i + 1}) ${capability.name}: ${capability.description} (VD: "${capability.example}")`;
            await bot.chat(message);
            console.log(`[Info] Sent capability ${i + 1}: ${capability.name}`);
            if (i < capabilities.length - 1) {
                await setTimeoutPromise(CHAT_DELAY);
            }
        }
        console.log(`[Info] Hoàn tất liệt kê khả năng cho ${username}.`);
    } catch (error) {
        console.error(`[Info] Lỗi khi gửi tin nhắn liệt kê khả năng:`, error);
    }
}

module.exports = {
    listCapabilities,
};