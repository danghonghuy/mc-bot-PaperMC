// commands/hunt.js
const { GoalNear } = require("mineflayer-pathfinder").goals;
// const { Vec3 } = require("vec3"); // Không dùng trực tiếp
const { formatCoords, translateToEnglishId } = require("../utils");
const { equipBestGear } = require("./protect");

// --- TỐI ƯU HÓA mcData ---
// Load mcData một lần khi module được load
// Giả sử bot.version sẽ có sẵn khi các hàm này được gọi
// Nếu không, bạn cần truyền bot.version hoặc mcData vào các hàm cần nó.
// Cách an toàn hơn là load trong startHuntingTask nếu bot.version chưa chắc chắn.
// Tuy nhiên, để đơn giản, ta giả định bot đã kết nối và có version.
let mcData = null; // Sẽ được khởi tạo khi cần lần đầu

const HUNT_SEARCH_RADIUS = 1200;
const HUNT_ATTACK_RANGE = 3.5;
const CHECK_INTERVAL_MS = 500; // Giảm nhẹ interval để phản ứng nhanh hơn chút
const FIND_RETRY_INTERVAL_MS = 3000; // Thời gian chờ khi không tìm thấy mob

// Hàm tìm mob, sử dụng mcData đã load
function findNearbyEntity(bot, entityId, radius, filter = () => true) {
    console.log("<<<<< findNearbyEntity CALLED with new code! >>>>>");

    // 1. Khởi tạo mcData nếu chưa có
    if (!mcData) {
        try {
            mcData = require('minecraft-data')(bot.version);
        } catch (err) {
            console.error("[Hunt] Lỗi khi load mcData:", err);
            return null; // Thoát nếu không load được mcData
        }
    }

    // 2. Lấy thông tin mục tiêu TỪ mcData (ĐẢM BẢO DÒNG NÀY CÓ VÀ ĐÚNG)
    const targetInfo = mcData.entities[entityId];

    // 3. Kiểm tra xem có tìm thấy thông tin không
    if (!targetInfo) {
        // Log warning nếu không tìm thấy thông tin cho ID này
        console.warn(`[FindNearby] Không tìm thấy thông tin trong mcData cho entity ID: ${entityId}`);
        return null; // Thoát nếu không có thông tin
    }

    // 4. Lấy tên mục tiêu từ thông tin đã lấy được
    const targetName = targetInfo.name;
    // console.log(`[FindNearby Debug] Target Name from mcData: ${targetName}`);

    let bestEntity = null;
    let bestDistance = radius;

    // --- Log kiểm tra bot.entities (Giữ lại từ lần sửa trước) ---
    console.log(`[FindNearby Pre-Loop Debug] typeof bot.entities: ${typeof bot.entities}`);
    try {
        console.log(`[FindNearby Pre-Loop Debug] bot.entities keys: ${bot.entities ? JSON.stringify(Object.keys(bot.entities)) : 'null/undefined'}`);
    } catch (e) {
        console.error("[FindNearby Pre-Loop Debug] Error stringifying bot.entities keys:", e.message);
    }
    // ---------------------------------------------------------

    // --- Bọc vòng lặp trong try...catch (Giữ lại từ lần sửa trước) ---
    try {
        const entityCount = bot.entities ? Object.keys(bot.entities).length : 0;
        console.log(`[FindNearby Debug] --- Checking ${entityCount} entities ---`);

        for (const id in bot.entities) {
            const entity = bot.entities[id];

            // --- LOG CHI TIẾT CHO TỪNG ENTITY ---
            const entityName = entity?.name;
            const entityValid = entity?.isValid;
            const entityPosOk = !!entity?.position;
            const isSelf = entity === bot.entity;
            const isKilled = bot.huntTaskDetails && bot.huntTaskDetails.killedEntities.has(entity.id);

            console.log(`[FindNearby Detail] ID: ${id}, Name: "${entityName}" (Target: "${targetName}"), PosOK: ${entityPosOk}, Valid: ${entityValid}, isSelf: ${isSelf}, isKilled: ${isKilled}`);
            // ------------------------------------

            // --- Các điều kiện lọc ---
            if (!entity || !entityPosOk) {
                console.log(`[FindNearby Skip] ID ${id}: No entity or position.`);
                continue;
            }

            // Kiểm tra tên (Quan trọng nhất)
            if (entityName !== targetName) {
                 // Chỉ log nếu nó có vẻ là mob/animal để tránh spam item, etc.
                 if (entity?.type === 'animal' || entity?.type === 'mob' || entity?.type === 'hostile' || entity?.type === 'passive') {
                    console.log(`[FindNearby Skip] ID ${id}: Name mismatch ("${entityName}" !== "${targetName}")`);
                 }
                continue; // Bỏ qua nếu tên không khớp
            }

            // Các kiểm tra còn lại
            if (isSelf) {
                 console.log(`[FindNearby Skip] ID ${id}: Is self.`);
                 continue;
            }
            if (isKilled) {
                 console.log(`[FindNearby Skip] ID ${id}: Already killed.`);
                 continue;
            }
            if (!entityValid) {
                 console.log(`[FindNearby Skip] ID ${id}: Not valid.`);
                 continue;
            }

            // --- LOGIC TÌM KIẾM VỚI DEBUG CỰC KỲ CHI TIẾT ---
            console.log(`[FindNearby PreCompare] ID ${id} ("${entity.name}"): Passed checks. Preparing to compare distance...`); // Log ngay trước khi tính dist
            try {
                const dist = entity.position.distanceTo(bot.entity.position);
                console.log(`[FindNearby CompareVals] ID ${id}: Calculated dist=${dist} (type: ${typeof dist}). Current bestDistance=${bestDistance} (type: ${typeof bestDistance}).`); // Log giá trị và kiểu

                const filterResult = filter(entity);
                console.log(`[FindNearby CompareVals] ID ${id}: Filter result=${filterResult} (type: ${typeof filterResult}).`); // Log kết quả filter

                const comparisonResult = dist < bestDistance;
                console.log(`[FindNearby CompareVals] ID ${id}: Comparison (dist < bestDistance) result=${comparisonResult}.`); // Log kết quả so sánh

                if (comparisonResult && filterResult) { // Kiểm tra rõ ràng từng phần
                    console.log(`[FindNearby Update] ID ${id} ("${entity.name}") at ${dist.toFixed(1)}m is better. Updating best.`);
                    bestDistance = dist;
                    bestEntity = entity;
                } else {
                    let reason = '';
                    if (!comparisonResult) reason += `Distance (${dist?.toFixed(1) ?? 'N/A'}) >= Best (${bestDistance?.toFixed(1) ?? 'N/A'})`;
                    if (!filterResult) reason += (reason ? ' AND ' : '') + 'Filter failed';
                    console.log(`[FindNearby NoUpdate] ID ${id}: Not updating best. Reason: ${reason || 'Comparison/Filter logic failed'}`);
                }
            } catch (compareError) {
                // Bắt lỗi cụ thể trong khối so sánh/cập nhật
                console.error(`[FindNearby Error] Error during distance comparison/update for ID ${id}:`, compareError);
            }
            // --- KẾT THÚC LOGIC TÌM KIẾM ---
        }
        console.log(`[FindNearby Debug] --- Finished checking entities --- Best found: ${bestEntity ? `${bestEntity.name} (ID: ${bestEntity.id}) at ${bestDistance.toFixed(1)}m` : 'None'}`);

    } catch (loopError) {
        console.error("[FindNearby Error] Error during entity loop:", loopError);
    }

    return bestEntity;
};
// --- THÊM LOGIC ĐẾM KILL ---
// Hàm xử lý khi entity chết
function onEntityDead(entity) {
    // Đảm bảo bot đang săn và có task
    if (!this.isHunting || !this.huntTaskDetails) return;

    const task = this.huntTaskDetails;

    // Kiểm tra xem entity chết có phải là mục tiêu hiện tại *hoặc* là loại mob đang săn
    // và chưa được tính kill
    if (entity && task.targetMobId === entity.entityType && !task.killedEntities.has(entity.id)) {
        // Kiểm tra xem có phải bot là người gây sát thương cuối cùng không (nếu cần chính xác hơn)
        // Tuy nhiên, việc này phức tạp, tạm thời chấp nhận kill nếu mob đúng loại chết gần đó.

        // Chỉ tính kill nếu nó là mục tiêu đang nhắm tới HOẶC nếu không có mục tiêu cụ thể nào đang được nhắm
        // và con mob chết này đúng loại mob cần săn. Điều này giúp đếm cả những con bị giết "ké".
        // Quan trọng hơn là kiểm tra ID chưa có trong Set.
        task.kills++;
        task.killedEntities.add(entity.id); // Đánh dấu đã giết
        console.log(`[Hunt] ${entity.name ?? `Mob ID ${entity.entityType}`} (ID: ${entity.id}) đã bị hạ gục. Tiến độ: ${task.kills}/${task.targetKills}`);

        // Nếu entity chết là mục tiêu hiện tại, reset targetEntity để tìm con khác
        if (task.targetEntity && task.targetEntity.id === entity.id) {
            console.log("[Hunt] Mục tiêu hiện tại đã chết, tìm mục tiêu mới.");
            task.targetEntity = null;
            // Không cần gọi huntLoop ngay, vòng lặp tự nhiên sẽ chạy lại và tìm
        }

        // Kiểm tra hoàn thành nhiệm vụ
        if (task.kills >= task.targetKills) {
            finishHunting(this, true, `Đã hoàn thành mục tiêu săn ${task.kills}/${task.targetKills} con ${task.targetMobNameVi}.`);
            // finishHunting sẽ tự gỡ listener
        }
    }
}


async function huntLoop(bot) {
    // Thêm log ngay đầu hàm
    console.log(`[Hunt Loop Debug] Running loop. isHunting=${bot.isHunting}. Task exists=${!!bot.huntTaskDetails}`);

    if (!bot.isHunting || !bot.huntTaskDetails) {
        console.log("[Hunt Loop Debug] Exiting: Not hunting or no task details.");
        return;
    }

    const task = bot.huntTaskDetails;
    console.log(`[Hunt Loop Debug] Task state: TargetEntity=${task.targetEntity?.id ?? 'None'}, Kills=${task.kills}/${task.targetKills}`);

    try {
        if (task.kills >= task.targetKills) {
            console.log("[Hunt Loop Debug] Exiting: Kills reached target.");
            // finishHunting should have been called by onEntityDead
            return;
        }

        let currentTarget = task.targetEntity ? bot.entities[task.targetEntity.id] : null;

        // Kiểm tra mục tiêu hiện tại
        let isTargetInvalid = !currentTarget || !currentTarget.isValid || currentTarget.health <= 0 || task.killedEntities.has(currentTarget.id);
        if (isTargetInvalid) {
            console.log(`[Hunt Loop Debug] Current target invalid/missing/dead (ID: ${currentTarget?.id ?? 'N/A'}). Searching for new target...`);
            currentTarget = null; // Đảm bảo reset
            task.targetEntity = null;

            const newTarget = findNearbyEntity(
                bot,
                task.targetMobId,
                HUNT_SEARCH_RADIUS,
                // --- SỬA LẠI HÀM FILTER ---
                // Bỏ kiểm tra entity.health > 0 vì nó luôn undefined
                entity => entity.isValid && !task.killedEntities.has(entity.id)
                // -------------------------
            );

            // Log kết quả tìm kiếm
            console.log(`[Hunt Loop Debug] findNearbyEntity result: ${newTarget ? `Found ${newTarget.name} (ID: ${newTarget.id})` : 'null'}`);

            if (!newTarget) {
                console.log(`[Hunt Loop] Tạm thời không thấy ${task.targetMobNameVi} nào khác. Waiting ${FIND_RETRY_INTERVAL_MS}ms...`);
                setTimeout(() => huntLoop(bot), FIND_RETRY_INTERVAL_MS);
                return; // Dừng vòng lặp hiện tại, chờ timeout
            }

            // Tìm thấy mục tiêu mới
            task.targetEntity = newTarget;
            currentTarget = newTarget; // Cập nhật currentTarget để sử dụng ngay
            console.log(`[Hunt Loop] Tìm thấy mục tiêu mới: ${currentTarget.name} (ID: ${currentTarget.id}) tại ${formatCoords(currentTarget.position)}`);
        } else {
             console.log(`[Hunt Loop Debug] Current target ${currentTarget.name} (ID: ${currentTarget.id}) is valid.`);
        }


        // --- Đã có mục tiêu hợp lệ (currentTarget) ---
        const distance = bot.entity.position.distanceTo(currentTarget.position);
        console.log(`[Hunt Loop Debug] Distance to ${currentTarget.name}: ${distance.toFixed(1)}m`);

        if (distance > HUNT_ATTACK_RANGE) {
            console.log(`[Hunt Loop Debug] Target out of range. Checking pathfinder...`);
            const currentGoal = bot.pathfinder.goal;
            // Đơn giản hóa kiểm tra isMovingToTargetPos một chút
            const isMoving = bot.pathfinder.isMoving();
            console.log(`[Hunt Loop Debug] Pathfinder isMoving: ${isMoving}`);

            // Chỉ gọi goto nếu không đang di chuyển HOẶC mục tiêu đã thay đổi đáng kể (kiểm tra đơn giản bằng ID)
            // Điều này tránh gọi goto liên tục nếu bot đang đi đúng hướng
            let shouldMove = !isMoving || (task.lastTargetId !== currentTarget.id);

            if (shouldMove) {
                console.log(`[Hunt Loop] Di chuyển đến gần ${currentTarget.name} (cách ${distance.toFixed(1)}m)`);
                const goal = new GoalNear(currentTarget.position.x, currentTarget.position.y, currentTarget.position.z, HUNT_ATTACK_RANGE - 0.5);
                task.lastTargetId = currentTarget.id; // Lưu lại ID mục tiêu đang di chuyển tới
                try {
                    console.log(`[Hunt Loop Debug] Calling bot.pathfinder.goto...`);
                    bot.pathfinder.goto(goal).catch(err => {
                        // Log lỗi pathfinding chi tiết hơn
                        console.error(`[Hunt Loop Error] Pathfinder goto failed for ${currentTarget.name}: ${err.message}`, err);
                        if (bot.isHunting && task.targetEntity === currentTarget && err && !/^(interrupted|goal changed|pathing interrupted|cancelled)/i.test(err.message)) {
                            console.warn(`[Hunt Loop] Lỗi pathfinding không mong muốn. Resetting target.`);
                            task.targetEntity = null;
                            task.lastTargetId = null; // Reset last target
                        } else if (err && /timeout/i.test(err.message)) {
                             console.warn(`[Hunt Loop] Pathfinding timeout. Resetting target.`);
                             task.targetEntity = null;
                             task.lastTargetId = null; // Reset last target
                        }
                        // Không cần làm gì nếu lỗi là do bị ngắt quãng
                    });
                } catch (err) {
                     console.error(`[Hunt Loop Error] Instant error calling goto for ${currentTarget.name}: ${err.message}`, err);
                     task.targetEntity = null; // Reset để tìm lại
                     task.lastTargetId = null; // Reset last target
                }
            } else {
                 console.log(`[Hunt Loop Debug] Already moving or target hasn't changed significantly. Skipping goto call.`);
            }
        } else {
            // Ở đủ gần để tấn công
            console.log(`[Hunt Loop Debug] Target ${currentTarget.name} in attack range.`);
            if (bot.pathfinder.isMoving()) {
                console.log(`[Hunt Loop Debug] Stopping pathfinder as target is in range.`);
                bot.pathfinder.stop();
                task.lastTargetId = null; // Reset last target vì đã dừng
            }
            // Nhìn vào mục tiêu trước khi đánh
            bot.lookAt(currentTarget.position.offset(0, currentTarget.height * 0.8, 0), true);

            // Kiểm tra xem có thể tấn công không
            if (bot.attackTime === undefined || bot.attackTime <= 0) {
                 console.log(`[Hunt Loop] Tấn công ${currentTarget.name} (ID: ${currentTarget.id})`);
                 bot.attack(currentTarget);
            } else {
                 console.log(`[Hunt Loop Debug] Attack on cooldown for ${currentTarget.name}.`);
            }
        }

        // Lên lịch chạy lại vòng lặp chính
        console.log(`[Hunt Loop Debug] Scheduling next loop in ${CHECK_INTERVAL_MS}ms.`);
        setTimeout(() => huntLoop(bot), CHECK_INTERVAL_MS);

    } catch (error) {
        // Log lỗi nghiêm trọng trong vòng lặp
        console.error("[Hunt Loop Critical Error] An unexpected error occurred:", error);
        finishHunting(bot, false, `Gặp lỗi nghiêm trọng khi đang săn ${task?.targetMobNameVi || 'mob'}: ${error.message}`);
    }
}


async function startHuntingTask(bot, username, message, aiModel) {
    console.log(`[Hunt] Xử lý yêu cầu săn bắn từ ${username}: "${message}"`);

    // Khởi tạo mcData nếu chưa có (cần thiết cho translate và kiểm tra mobInfo)
    if (!mcData) {
        try {
            mcData = require('minecraft-data')(bot.version);
        } catch (err) {
            console.error("[Hunt] Lỗi khi load mcData:", err);
            bot.chat(`Xin lỗi ${username}, đã xảy ra lỗi khi tải dữ liệu game.`);
            return;
        }
    }

    if (bot.isFinding || bot.isFollowing || bot.isProtecting || bot.isCollecting || bot.isStripMining || bot.isHunting) {
        let reason = bot.isFinding ? 'tìm đồ' : (bot.isFollowing ? 'đi theo' : (bot.isProtecting ? 'bảo vệ' : (bot.isCollecting ? 'thu thập' : (bot.isStripMining ? 'đào hầm' : 'săn bắn'))));
        bot.chat(`${username}, tôi đang bận ${reason} rồi!`);
        return;
    }

    const extractionPrompt = `Từ tin nhắn "${message}", trích xuất tên loại mob người chơi muốn săn và số lượng cần giết. Nếu không nói số lượng, mặc định là 5. Chỉ trả lời bằng định dạng JSON với hai khóa: "mobName" (string, giữ nguyên tiếng Việt có dấu nếu có) và "quantity" (number). Ví dụ: "giết 10 con bò" -> {"mobName": "bò", "quantity": 10}. JSON:`;
    let mobNameVi = null;
    let quantity = 5;
    try {
        console.log("[Hunt] Gửi prompt trích xuất...");
        const extractResult = await aiModel.generateContent(extractionPrompt);
        const jsonResponse = (await extractResult.response.text()).trim();
        console.log("[Hunt] Phản hồi JSON thô:", jsonResponse);
        let parsedData;
        const jsonMatch = jsonResponse.match(/\{.*\}/s);
        if (jsonMatch) parsedData = JSON.parse(jsonMatch[0]);
        else throw new Error("Không tìm thấy JSON.");

        if (parsedData && parsedData.mobName && typeof parsedData.quantity === 'number') {
            mobNameVi = parsedData.mobName.trim(); // Trim tên mob
            quantity = parseInt(parsedData.quantity, 10);
             if (isNaN(quantity) || quantity <= 0) {
                 console.log(`[Hunt] Số lượng không hợp lệ (${parsedData.quantity}), đặt về mặc định 5.`);
                 quantity = 5;
             } else {
                 quantity = Math.max(1, quantity); // Đảm bảo ít nhất là 1
             }
            console.log(`[Hunt] AI trích xuất: Mob="${mobNameVi}", Số lượng=${quantity}`);
        } else {
            throw new Error("AI không trích xuất được thông tin hợp lệ.");
        }
    } catch (error) {
        console.error("[Hunt] Lỗi trích xuất:", error);
        bot.chat(`Xin lỗi ${username}, tôi không hiểu bạn muốn săn con gì hoặc số lượng bao nhiêu. Vui lòng thử lại, ví dụ: "săn 10 con bò"`);
        return;
    }

    const mobId = translateToEnglishId(mobNameVi); // Hàm này cần mcData hoặc tự load
    if (!mobId) {
        bot.chat(`Xin lỗi ${username}, tôi không biết con "${mobNameVi}" là con gì trong Minecraft.`);
        return;
    }

    const mobInfo = mcData.entitiesByName[mobId];

    if (!mobInfo) {
        bot.chat(`Xin lỗi ${username}, tôi không tìm thấy thông tin về "${mobNameVi}" (${mobId}) trong dữ liệu của mình.`);
        console.error(`[Hunt] Không tìm thấy entity data cho ${mobId}`);
        return;
    }
    // Kiểm tra xem có phải là loại có thể săn được không (ví dụ: không phải item frame, armor stand...)
    // Dựa vào type hoặc category có thể hữu ích
    if (mobInfo.type !== 'mob' && mobInfo.type !== 'animal' && mobInfo.category !== 'Hostile mobs' && mobInfo.category !== 'Passive mobs' && mobInfo.category !== 'Water mobs' && mobInfo.category !== 'Ambient mobs') {
         bot.chat(`Xin lỗi ${username}, tôi không nghĩ mình có thể "săn" ${mobNameVi} (${mobId}). Đó không phải là một loại mob thông thường.`);
         console.warn(`[Hunt] Yêu cầu săn loại entity không phải mob: ${mobId} (Type: ${mobInfo.type}, Category: ${mobInfo.category})`);
         return;
    }
    console.log(`[Hunt] Mục tiêu hợp lệ: ${mobInfo.name} (ID: ${mobInfo.id}), Type: ${mobInfo.type}, Category: ${mobInfo.category}`);


    // --- BỎ KIỂM TRA VŨ KHÍ BẮT BUỘC ---
    // Vẫn cố gắng trang bị vũ khí tốt nhất nếu có, nhưng không dừng lại nếu không có
    try {
        const equipped = await equipBestGear(bot);
        if (equipped) {
            console.log("[Hunt] Đã trang bị vũ khí tốt nhất.");
        } else {
            console.log("[Hunt] Không tìm thấy vũ khí, sẽ dùng tay không.");
            // Không return, tiếp tục chạy
        }
    } catch (equipError) {
        console.error("[Hunt] Lỗi khi cố gắng trang bị vũ khí:", equipError);
        // Không dừng lại, vẫn tiếp tục
    }


    bot.chat(`Ok ${username}, bắt đầu săn ${quantity} con ${mobNameVi}...`);

    bot.isHunting = true;
    bot.huntTaskDetails = {
        username: username,
        targetMobId: mobInfo.id, // Lưu ID loại mob (ví dụ: 93 cho chicken)
        targetMobNameVi: mobNameVi,
        targetKills: quantity,
        kills: 0,
        targetEntity: null, // Entity cụ thể đang nhắm tới
        killedEntities: new Set(), // Lưu ID của các entity đã giết để tránh đếm trùng
    };

    // --- GẮN LISTENER ĐẾM KILL ---
    // Lưu trữ hàm listener vào bot để có thể gỡ bỏ sau này
    bot.huntKillListener = onEntityDead.bind(bot); // Bind(bot) để 'this' trong onEntityDead là bot
    bot.on('entityDead', bot.huntKillListener); // Sử dụng entityDead có vẻ phù hợp hơn
    // Lưu ý: entityGone cũng có thể dùng nhưng sẽ bắt cả despawn. entityDead cụ thể hơn cho việc bị giết.

    // Bắt đầu vòng lặp săn
    huntLoop(bot);
}

function finishHunting(bot, success, message) {
    if (!bot.isHunting) return; // Tránh gọi nhiều lần

    const task = bot.huntTaskDetails;
    const username = task?.username || "bạn"; // Lấy username từ task nếu có
    console.log(`[Hunt Finish] Kết thúc. Thành công: ${success}. Lý do: ${message}`);
    bot.chat(`${username}, ${message}`);

    // --- GỠ LISTENER ĐẾM KILL ---
    if (bot.huntKillListener) {
        bot.off('entityDead', bot.huntKillListener);
        bot.huntKillListener = null; // Xóa tham chiếu
        console.log("[Hunt Finish] Đã gỡ bỏ listener đếm kill.");
    } else {
        console.warn("[Hunt Finish] Không tìm thấy listener đếm kill để gỡ bỏ.");
    }

    // Đặt lại trạng thái
    bot.isHunting = false;
    bot.huntTaskDetails = null;

    // Dừng các hành động hiện tại (nếu có)
    try {
        if (bot.pathfinder.isMoving()) {
            bot.pathfinder.stop();
            console.log("[Hunt Finish] Đã dừng pathfinder.");
        }
        // Không cần bot.attack(null) vì bot.attack chỉ là hành động tức thời
    } catch(e) {
        console.error("[Hunt Finish] Lỗi khi dừng hành động:", e);
    }
}

function stopHunting(bot, username) {
    if (bot.isHunting) {
        console.log(`[Hunt Stop] Người dùng ${username} yêu cầu dừng.`);
        // Gọi finishHunting với trạng thái không thành công và lý do dừng
        finishHunting(bot, false, "Đã dừng săn bắn theo yêu cầu.");
    } else {
        // Có thể thêm tin nhắn nếu người dùng cố dừng khi bot không săn
        // bot.chat(`${username}, tôi đâu có đang săn bắn đâu.`);
    }
}

module.exports = {
    startHuntingTask,
    stopHunting,
    // Không cần export các hàm nội bộ như huntLoop, finishHunting, onEntityDead, findNearbyEntity
};