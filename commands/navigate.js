const { GoalNear, GoalBlock } = require("mineflayer-pathfinder").goals;
const { Vec3 } = require("vec3");
const { formatCoords } = require("../utils");

const GOTO_REACH_TOLERANCE = 1.5;

async function goToCoordinates(bot, username, message, aiModel) {
    console.log(`[Navigate] Xử lý yêu cầu đi đến tọa độ từ ${username}: "${message}"`);

    if (bot.isFinding || bot.isFollowing || bot.isProtecting || bot.isCollecting) {
        let reason = bot.isFinding ? 'tìm đồ' : (bot.isFollowing ? 'đi theo' : (bot.isProtecting ? 'bảo vệ' : 'thu thập'));
        bot.chat(`${username}, tôi đang bận ${reason} rồi, không đi được!`);
        console.log(`[Navigate] Bị chặn do đang ${reason}.`);
        return;
    }

    const extractionPrompt = `Từ tin nhắn "${message}", trích xuất tọa độ X, Y, Z mà người chơi muốn đến. Chỉ trả lời bằng định dạng JSON với ba khóa: "x", "y", "z". Nếu không tìm thấy tọa độ hợp lệ, trả về {"x": null, "y": null, "z": null}. Ví dụ: "đến x 100 y 65 z -200" -> {"x": 100, "y": 65, "z": -200}. JSON:`;
    let targetX, targetY, targetZ;
    try {
        console.log("[Navigate] Gửi prompt trích xuất tọa độ...");
        const extractResult = await aiModel.generateContent(extractionPrompt);
        const jsonResponse = (await extractResult.response.text()).trim();
        console.log("[Navigate] Phản hồi JSON thô:", jsonResponse);
        let parsedData;
        const jsonMatch = jsonResponse.match(/\{.*\}/s);
        if (jsonMatch) parsedData = JSON.parse(jsonMatch[0]);
        else throw new Error("Không tìm thấy JSON.");

        if (parsedData && typeof parsedData.x === 'number' && typeof parsedData.y === 'number' && typeof parsedData.z === 'number') {
            targetX = parsedData.x;
            targetY = parsedData.y;
            targetZ = parsedData.z;
            console.log(`[Navigate] AI trích xuất tọa độ: X=${targetX}, Y=${targetY}, Z=${targetZ}`);
        } else {
            throw new Error("AI không trích xuất được tọa độ hợp lệ.");
        }
    } catch (error) {
        console.error("[Navigate] Lỗi trích xuất tọa độ:", error);
        bot.chat(`Xin lỗi ${username}, tôi không hiểu bạn muốn đến tọa độ nào. Vui lòng ghi rõ dạng 'x Y z' nhé.`);
        return;
    }

    const targetPos = new Vec3(targetX, targetY, targetZ);
    const goal = new GoalBlock(targetPos.x, targetPos.y, targetPos.z);

    bot.chat(`Ok ${username}, đang đi đến tọa độ ${formatCoords(targetPos)}...`);
    console.log(`[Navigate] Bắt đầu di chuyển đến ${formatCoords(targetPos)}.`);

    try {
        await bot.pathfinder.goto(goal);
        console.log(`[Navigate] Đã đến đích ${formatCoords(targetPos)}.`);
        bot.chat(`${username}, tôi đã đến nơi (${formatCoords(bot.entity.position)})!`);
    } catch (err) {
        console.error(`[Navigate] Lỗi khi di chuyển đến ${formatCoords(targetPos)}:`, err.message);
        if (err.message.toLowerCase().includes('no path') || err.message.toLowerCase().includes('unreachable')) {
             bot.chat(`Xin lỗi ${username}, tôi không tìm được đường đến ${formatCoords(targetPos)}. Có thể bị chặn hoặc quá xa.`);
        } else if (err.message.toLowerCase().includes('timeout')) {
             bot.chat(`Xin lỗi ${username}, mất quá nhiều thời gian để tìm đường đến ${formatCoords(targetPos)}. Bạn thử lại xem?`);
        } else if (err.message.toLowerCase().includes('goal interrupted')) {
             bot.chat(`Ối, đường đi của tôi đến ${formatCoords(targetPos)} bị gián đoạn rồi ${username}!`);
        }
         else {
            bot.chat(`Xin lỗi ${username}, tôi gặp lỗi khi cố gắng đi đến ${formatCoords(targetPos)}.`);
        }
    }
}

async function saveWaypoint(bot, username, message, aiModel) {
    console.log(`[Waypoint] Xử lý yêu cầu lưu waypoint từ ${username}: "${message}"`);

    // --- SỬA PROMPT VÀ LOGIC TRÍCH XUẤT ---
    const extractionPrompt = `Từ tin nhắn "${message}", trích xuất tên địa điểm mà người chơi muốn lưu.
Chỉ trả lời bằng định dạng JSON với một khóa duy nhất là "name".
Nếu người chơi cung cấp tên (ví dụ: 'lưu đây là nhà', 'đặt tên chỗ này là base'), hãy trích xuất tên đó.
Nếu người chơi KHÔNG cung cấp tên cụ thể (ví dụ: 'lưu chỗ này', 'đánh dấu vị trí'), hãy trả về giá trị null cho khóa "name".

Ví dụ 1: Tin nhắn "lưu chỗ này là nhà chính" -> {"name": "nhà chính"}
Ví dụ 2: Tin nhắn "đánh dấu vị trí này" -> {"name": null}
Ví dụ 3: Tin nhắn "save waypoint base_1" -> {"name": "base_1"}

JSON:`;

    let waypointName = null; // Khởi tạo là null
    try {
        console.log("[Waypoint] Gửi prompt trích xuất tên (JSON)...");
        const extractResult = await aiModel.generateContent(extractionPrompt);
        const jsonResponse = (await extractResult.response.text()).trim();
        console.log("[Waypoint] Phản hồi JSON thô:", jsonResponse);
        let parsedData;
        const jsonMatch = jsonResponse.match(/\{.*\}/s);
        if (jsonMatch) {
            parsedData = JSON.parse(jsonMatch[0]);
            // Kiểm tra xem có khóa 'name' không và giá trị có phải string không (hoặc null)
            if (parsedData && typeof parsedData.name === 'string' && parsedData.name.trim() !== '') {
                waypointName = parsedData.name.trim(); // Lấy tên nếu hợp lệ
            } else if (parsedData && parsedData.name === null) {
                // AI xác nhận không có tên, sẽ yêu cầu người dùng sau
                console.log("[Waypoint] AI xác nhận không có tên được cung cấp.");
            } else {
                 console.warn("[Waypoint] AI trả về JSON nhưng không có tên hợp lệ hoặc name không phải string/null:", parsedData);
                 // Coi như không trích xuất được
            }
        } else {
             console.warn("[Waypoint] Không tìm thấy JSON trong phản hồi AI.");
             // Coi như không trích xuất được
        }

        // Nếu sau khi xử lý mà waypointName vẫn là null, yêu cầu người dùng cung cấp tên
        if (waypointName === null) {
             bot.chat(`Xin lỗi ${username}, bạn muốn lưu vị trí này với tên gì? Vui lòng thử lại với lệnh dạng 'lưu chỗ này là [tên]' nhé.`);
             console.log("[Waypoint] Không trích xuất được tên, yêu cầu người dùng nhập lại.");
             return; // Dừng xử lý
        }

        // Chuẩn hóa tên nếu đã lấy được
        waypointName = waypointName.toLowerCase().replace(/\s+/g, '_');
        console.log(`[Waypoint] Tên waypoint đã xử lý: "${waypointName}"`);

    } catch (error) {
        console.error("[Waypoint] Lỗi trích xuất hoặc xử lý tên waypoint:", error);
        bot.chat(`Xin lỗi ${username}, tôi gặp lỗi khi cố gắng hiểu tên bạn muốn đặt. Bạn thử lại xem?`);
        return;
    }

    if (!bot.waypoints) bot.waypoints = {};

    const currentPos = bot.entity.position.clone();
    bot.waypoints[waypointName] = {
        x: Math.round(currentPos.x),
        y: Math.round(currentPos.y),
        z: Math.round(currentPos.z),
        dimension: bot.game.dimension // Lưu cả dimension
    };

    console.log(`[Waypoint] Đã lưu waypoint "${waypointName}" tại ${formatCoords(currentPos)} (${bot.game.dimension}).`);
    bot.chat(`${username}, đã lưu vị trí "${waypointName}" tại ${formatCoords(currentPos)}.`);
}

function listWaypoints(bot, username) {
    console.log(`[Waypoint] ${username} yêu cầu liệt kê waypoints.`);
    if (!bot.waypoints || Object.keys(bot.waypoints).length === 0) {
        bot.chat(`${username}, tôi chưa lưu địa điểm nào cả.`);
        return;
    }

    const waypointList = Object.entries(bot.waypoints)
        .map(([name, pos]) => `${name} (${formatCoords(pos)}, ${pos.dimension})`)
        .join('; ');

    bot.chat(`${username}, các địa điểm đã lưu: ${waypointList}`);
}

async function deleteWaypoint(bot, username, message, aiModel) {
    console.log(`[Waypoint] Xử lý yêu cầu xóa waypoint từ ${username}: "${message}"`);
    const extractionPrompt = `Từ tin nhắn "${message}", trích xuất tên địa điểm mà người chơi muốn xóa. Chỉ trả về tên địa điểm. Nếu không rõ tên, trả về "UNKNOWN". Tên:`;
    let waypointName;
    try {
        console.log("[Waypoint] Gửi prompt trích xuất tên...");
        const extractResult = await aiModel.generateContent(extractionPrompt);
        waypointName = (await extractResult.response.text()).trim();
         if (!waypointName || waypointName.toUpperCase() === "UNKNOWN") {
            throw new Error("AI không trích xuất được tên waypoint hợp lệ.");
        }
        waypointName = waypointName.toLowerCase().replace(/\s+/g, '_');
        console.log(`[Waypoint] AI trích xuất tên để xóa: "${waypointName}"`);
    } catch (error) {
        console.error("[Waypoint] Lỗi trích xuất tên waypoint:", error);
        bot.chat(`Xin lỗi ${username}, bạn muốn xóa địa điểm tên gì?`);
        return;
    }

    if (!bot.waypoints || !bot.waypoints[waypointName]) {
        bot.chat(`${username}, tôi không tìm thấy địa điểm nào tên là "${waypointName}".`);
        return;
    }

    delete bot.waypoints[waypointName];
    console.log(`[Waypoint] Đã xóa waypoint "${waypointName}".`);
    bot.chat(`${username}, đã xóa địa điểm "${waypointName}".`);
}

async function goToWaypoint(bot, username, message, aiModel) {
    console.log(`[Waypoint] Xử lý yêu cầu đi đến waypoint từ ${username}: "${message}"`);

     if (bot.isFinding || bot.isFollowing || bot.isProtecting || bot.isCollecting) {
        let reason = bot.isFinding ? 'tìm đồ' : (bot.isFollowing ? 'đi theo' : (bot.isProtecting ? 'bảo vệ' : 'thu thập'));
        bot.chat(`${username}, tôi đang bận ${reason} rồi, không đi được!`);
        console.log(`[Waypoint] Bị chặn do đang ${reason}.`);
        return;
    }

    const extractionPrompt = `Từ tin nhắn "${message}", trích xuất tên địa điểm đã lưu mà người chơi muốn đến. Chỉ trả về tên địa điểm. Nếu không rõ tên, trả về "UNKNOWN". Tên:`;
    let waypointName;
    try {
        console.log("[Waypoint] Gửi prompt trích xuất tên...");
        const extractResult = await aiModel.generateContent(extractionPrompt);
        waypointName = (await extractResult.response.text()).trim();
         if (!waypointName || waypointName.toUpperCase() === "UNKNOWN") {
            throw new Error("AI không trích xuất được tên waypoint hợp lệ.");
        }
        waypointName = waypointName.toLowerCase().replace(/\s+/g, '_');
        console.log(`[Waypoint] AI trích xuất tên waypoint: "${waypointName}"`);
    } catch (error) {
        console.error("[Waypoint] Lỗi trích xuất tên waypoint:", error);
        bot.chat(`Xin lỗi ${username}, bạn muốn đến địa điểm đã lưu tên gì?`);
        return;
    }

    if (!bot.waypoints || !bot.waypoints[waypointName]) {
        bot.chat(`${username}, tôi không tìm thấy địa điểm nào tên là "${waypointName}".`);
        return;
    }

    const targetWaypoint = bot.waypoints[waypointName];

    if (bot.game.dimension !== targetWaypoint.dimension) {
         bot.chat(`Xin lỗi ${username}, địa điểm "${waypointName}" ở chiều không gian khác (${targetWaypoint.dimension}), tôi không tự qua đó được.`);
         console.log(`[Waypoint] Không thể đến waypoint do khác dimension (Current: ${bot.game.dimension}, Target: ${targetWaypoint.dimension})`);
         return;
    }

    const targetPos = new Vec3(targetWaypoint.x, targetWaypoint.y, targetWaypoint.z);
    const goal = new GoalBlock(targetPos.x, targetPos.y, targetPos.z);

    bot.chat(`Ok ${username}, đang đi đến địa điểm "${waypointName}" (${formatCoords(targetPos)})...`);
    console.log(`[Waypoint] Bắt đầu di chuyển đến waypoint "${waypointName}" tại ${formatCoords(targetPos)}.`);

    try {
        await bot.pathfinder.goto(goal);
        console.log(`[Waypoint] Đã đến waypoint "${waypointName}".`);
        bot.chat(`${username}, tôi đã đến "${waypointName}" (${formatCoords(bot.entity.position)})!`);
    } catch (err) {
        console.error(`[Waypoint] Lỗi khi di chuyển đến waypoint "${waypointName}":`, err.message);
         if (err.message.toLowerCase().includes('no path') || err.message.toLowerCase().includes('unreachable')) {
             bot.chat(`Xin lỗi ${username}, tôi không tìm được đường đến "${waypointName}". Có thể bị chặn hoặc quá xa.`);
        } else if (err.message.toLowerCase().includes('timeout')) {
             bot.chat(`Xin lỗi ${username}, mất quá nhiều thời gian để tìm đường đến "${waypointName}". Bạn thử lại xem?`);
        } else if (err.message.toLowerCase().includes('goal interrupted')) {
             bot.chat(`Ối, đường đi của tôi đến "${waypointName}" bị gián đoạn rồi ${username}!`);
        }
         else {
            bot.chat(`Xin lỗi ${username}, tôi gặp lỗi khi cố gắng đi đến "${waypointName}".`);
        }
    }
}

module.exports = {
    goToCoordinates,
    saveWaypoint,
    listWaypoints,
    deleteWaypoint,
    goToWaypoint,
};