// commands/follow.js
const { GoalFollow } = require("mineflayer-pathfinder").goals;
const { formatCoords } = require("../utils.js"); // Hoặc require("../bot") nếu export từ bot.js

// --- Hằng số ---
const FOLLOW_DISTANCE = 2;

/**
 * Bắt đầu đi theo người chơi đã gửi yêu cầu.
 * @param {import('mineflayer').Bot} bot
 * @param {string} username
 */
function startFollowing(bot, username) {
  console.log(`[Follow Cmd] Bắt đầu xử lý đi theo người chơi: ${username}`);
  const usernameWithDotFollow = '.' + username;

  let targetPlayer = bot.players[username]?.entity;
  console.log(`[Follow Cmd] Tìm trực tiếp (bot.players['${username}']?.entity):`, targetPlayer ? `Tìm thấy (ID: ${targetPlayer.id}, Username: ${targetPlayer.username})` : 'Không');

  if (!targetPlayer) {
    console.log(`[Follow Cmd] Tìm gần nhất tên '${username}' HOẶC '${usernameWithDotFollow}'...`);
    targetPlayer = bot.nearestEntity(entity =>
      entity.type === 'player' && (entity.username === username || entity.username === usernameWithDotFollow)
    );
    console.log(`[Follow Cmd] Tìm gần nhất (bot.nearestEntity):`, targetPlayer ? `Tìm thấy (ID: ${targetPlayer.id}, Username: ${targetPlayer.username})` : 'Không');
  }

  if (targetPlayer) {
    const actualTargetUsername = targetPlayer.username || username;

    if (bot.isFollowing && bot.followingTarget === targetPlayer) {
      console.log(`[Follow Cmd] Đã đang đi theo ${actualTargetUsername}.`);
      bot.chat(`Tôi vẫn đang đi theo bạn mà ${actualTargetUsername}!`);
      return;
    }

    // Kiểm tra targetPlayer.position trước khi dùng
    if (!targetPlayer.position) {
        console.error(`[Follow Cmd] Lỗi: Target player ${actualTargetUsername} không có thông tin vị trí.`);
        bot.chat(`Ơ ${actualTargetUsername}, tôi thấy bạn nhưng không biết bạn ở đâu!`);
        return;
    }

    console.log(`[Follow Cmd] Tìm thấy ${actualTargetUsername} tại ${formatCoords(targetPlayer.position)}.`);
    bot.chat(`Ok ${actualTargetUsername}, tôi sẽ đi theo bạn! Giữ khoảng cách ${FOLLOW_DISTANCE} block nhé.`);

    bot.followingTarget = targetPlayer;
    bot.isFollowing = true;

    const goal = new GoalFollow(bot.followingTarget, FOLLOW_DISTANCE);
    console.log(`[Follow Cmd] Tạo GoalFollow: Target ID=${bot.followingTarget.id}, Distance=${FOLLOW_DISTANCE}`);

    try {
      if (!bot.pathfinder) {
          console.error("[Follow Cmd] LỖI: bot.pathfinder không tồn tại!");
          bot.chat(`Ối ${actualTargetUsername}, hệ thống di chuyển của tôi chưa sẵn sàng!`);
          bot.isFollowing = false;
          bot.followingTarget = null;
          return;
      }
      bot.pathfinder.setGoal(goal, true);
      console.log(`[Follow Cmd] Đã gọi bot.pathfinder.setGoal.`);
    } catch (e) {
      console.error(`[Follow Cmd] LỖI khi gọi bot.pathfinder.setGoal:`, e);
      bot.chat(`Ối ${actualTargetUsername}, hình như tôi bị lỗi hệ thống di chuyển rồi!`);
      bot.isFollowing = false;
      bot.followingTarget = null;
    }
  } else {
    bot.chat(`Ơ ${username}, bạn ở đâu rồi? Tôi không thấy bạn để đi theo!`);
    console.log(`[Follow Cmd] Không tìm thấy người chơi khớp '${username}' hoặc '${usernameWithDotFollow}'.`);
  }
}

/**
 * Dừng việc đi theo mục tiêu hiện tại.
 * @param {import('mineflayer').Bot} bot
 * @param {string} username - Tên người chơi yêu cầu dừng.
 */
function stopFollowing(bot, username) {
  console.log(`[StopFollow Cmd] Xử lý dừng đi theo.`);
  if (bot.isFollowing) {
    const followingUsername = bot.followingTarget?.username || 'ai đó';
    console.log(`[StopFollow Cmd] Đang đi theo ${followingUsername}, thực hiện dừng.`);
    bot.chat(`Ok ${username}, tôi sẽ dừng lại.`);

    try {
      if (bot.pathfinder) {
        bot.pathfinder.stop();
        console.log(`[StopFollow Cmd] Đã gọi bot.pathfinder.stop().`);
      } else {
        console.log("[StopFollow Cmd] bot.pathfinder không tồn tại.");
      }
    } catch(e) {
       console.error(`[StopFollow Cmd] Lỗi khi gọi bot.pathfinder.stop():`, e);
    }

    bot.followingTarget = null;
    bot.isFollowing = false;
  } else {
    console.log(`[StopFollow Cmd] Không có ai để dừng đi theo.`);
    bot.chat(`Tôi có đang đi theo ai đâu ${username}?`);
  }
}

module.exports = {
  startFollowing,
  stopFollowing,
};