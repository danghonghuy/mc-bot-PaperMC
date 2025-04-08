// --- START OF FILE commands/auto_defend.js (Final PvP - No Auto-Eat Logic) ---
const {
  goals: { GoalFollow, GoalBlock, GoalNear, GoalInvert },
} = require("mineflayer-pathfinder");
const { Vec3 } = require("vec3");
const {
  formatCoords,
  sleep,
  isBlockSolid,
  isBlockDangerous,
} = require("../utils");

// ====================================
// --- Configuration ---
// ====================================
const ENABLE_SHIELD = true;
const ENABLE_KITING = true;
const ENABLE_RANGED = true;
const ENABLE_STRAFING = true;
const ENABLE_PVP_HEALING = true;
const ENABLE_PVP_AXE_VS_SHIELD = true;
const ENABLE_FLEE_SHOOT = false;

const PVP_FLEE_HEALTH_THRESHOLD = 8;
const FLEE_INSTEAD_OF_FIGHT_HEALTH = 6; // Ngưỡng máu chạy áp dụng cho cả mob
// const FLEE_WHEN_HUNGRY = false; // <<<< ĐÃ XÓA BỎ LOGIC NÀY
// const LOW_FOOD_THRESHOLD = 1;  // <<<< ĐÃ XÓA BỎ LOGIC NÀY
const HEALING_POTION_NAMES = [
  "potion_of_healing",
  "potion_of_regeneration",
  "splash_potion_of_healing",
  "splash_potion_of_regeneration",
];
const HEALING_FOOD_NAMES = ["golden_apple", "enchanted_golden_apple"];
const HEAL_RETREAT_DISTANCE = 3;
const HEAL_TIMEOUT = 1500;

const SHIELD_DETECTION_MISSES = 5;
const CREEPER_FLEE_DISTANCE = 10;
const RANGED_WEAPON_MIN_DIST = 6;
const RANGED_WEAPON_MAX_DIST = 25;
const KITING_BACKUP_DIST = 1.0;
const STRAFE_INTERVAL = 700;
const STRAFE_DURATION = 350;

const HOSTILE_SCAN_RADIUS = 25;
const PLAYER_SCAN_RADIUS = 15;
const VERY_CLOSE_THRESHOLD_SQ = 16;
const LIKELY_ATTACKER_RANGE_SQ = 196;
const DEFEND_TIMEOUT = 30 * 1000;
const SAFE_DISTANCE = 18;
const SAFE_DISTANCE_SQ = SAFE_DISTANCE * SAFE_DISTANCE;
const COMBAT_DISTANCE = 5;
const PVP_FOLLOW_DISTANCE = 5;
const FOLLOW_DISTANCE = 5;
const LOOK_INTERVAL = 150;
const ATTACK_INTERVAL = 500;
const RANGED_ATTACK_INTERVAL = 1500;
const FLEE_CHECK_INTERVAL = 400;

const WEAPON_PRIORITY = [
  "netherite_sword",
  "diamond_sword",
  "iron_sword",
  "stone_sword",
  "wooden_sword",
  "netherite_axe",
  "diamond_axe",
  "iron_axe",
  "stone_axe",
  "wooden_axe",
  "bow",
  "crossbow",
  "trident",
];
const AXE_PRIORITY = WEAPON_PRIORITY.filter((w) => w.includes("_axe"));
const SWORD_PRIORITY = WEAPON_PRIORITY.filter((w) => w.includes("_sword"));
const MELEE_WEAPON_PRIORITY = [...SWORD_PRIORITY, ...AXE_PRIORITY];
const RANGED_PRIORITY = WEAPON_PRIORITY.filter(
  (w) => w.includes("bow") || w.includes("crossbow") || w.includes("trident")
);
const AMMUNITION = ["arrow", "spectral_arrow", "tipped_arrow"];

// --- State Variables ---
let botInstance = null;
let stopAllTasksFn = null;
let isDefending = false;
let defendingTarget = null;
let combatInterval = null;
let lookInterval = null;
let fleeCheckInterval = null;
let strafeInterval = null;
let currentStrafeDir = 0;
let defenseStartTime = 0;
let lastAttackTime = 0;
let lastRangedAttackTime = 0;
let lastHurtProcessedTime = 0;
const HURT_PROCESS_COOLDOWN = 2500;
let isShieldActive = false;
let consecutiveMeleeMisses = 0;
let isAttemptingHeal = false;
let softBlockTypes = new Set();

// --- Utility Functions ---
// (formatCoords, sleep, isBlockSolid, isBlockDangerous được import)

function findBestWeapon(weaponList = WEAPON_PRIORITY) {
  let bestWeapon = null;
  let bestPriority = weaponList.length;
  if (!botInstance?.inventory) return null;
  for (const item of botInstance.inventory.items()) {
    if (!item?.name) continue;
    const priority = weaponList.findIndex(
      (weaponName) => item.name === weaponName
    );
    if (priority !== -1 && priority < bestPriority) {
      bestPriority = priority;
      bestWeapon = item;
    }
  }
  return bestWeapon;
}

function findAmmunition() {
  if (!botInstance?.inventory) return null;
  for (const ammoName of AMMUNITION) {
    const item = botInstance.inventory
      .items()
      .find((i) => i?.name === ammoName);
    if (item) return item;
  }
  return null;
}

async function activateShieldIfNeeded() {
  if (!ENABLE_SHIELD || isShieldActive || !botInstance) return false;
  const shield =
    botInstance.inventory.slots[botInstance.inventory.OFF_HAND_SLOT];
  if (shield && shield.name === "shield") {
    try {
      botInstance.activateShield();
      isShieldActive = true;
      return true;
    } catch {}
  }
  return false;
}

async function deactivateShieldIfNeeded() {
  if (!isShieldActive || !botInstance) return false;
  try {
    botInstance.deactivateShield();
    isShieldActive = false;
    return true;
  } catch {}
  return false;
}

function findBestHealingItem() {
  if (!botInstance?.inventory) return null;
  const inventoryItems = botInstance.inventory.items();
  const enchantedApple = inventoryItems.find(
    (item) => item?.name === "enchanted_golden_apple"
  );
  if (enchantedApple) return enchantedApple;
  const goldenApple = inventoryItems.find(
    (item) => item?.name === "golden_apple"
  );
  if (goldenApple) return goldenApple;
  const healingPotion = inventoryItems.find(
    (item) => item && HEALING_POTION_NAMES.includes(item.name)
  );
  return healingPotion;
}

function checkEnemyShield(target) {
  if (!target || target.type !== "player") return false;
  if (consecutiveMeleeMisses >= SHIELD_DETECTION_MISSES) return true;
  return false;
}

// --- Initialization ---
function initializeAutoDefend(bot, stopTasksFunction) {
  if (!bot || typeof stopTasksFunction !== "function") {
    console.error("Auto Defend Init Failed: Invalid args");
    return;
  }
  botInstance = bot;
  stopAllTasksFn = stopTasksFunction;
  isDefending = false;
  defendingTarget = null;
  clearDefenseIntervals();
  lastHurtProcessedTime = 0;
  defenseStartTime = 0;
  isShieldActive = false;
  currentStrafeDir = 0;
  consecutiveMeleeMisses = 0;
  isAttemptingHeal = false;

  const registry = bot.registry;
  softBlockTypes = new Set();
  [
    "oak_leaves",
    "spruce_leaves",
    "birch_leaves",
    "jungle_leaves",
    "acacia_leaves",
    "dark_oak_leaves",
    "azalea_leaves",
    "flowering_azalea_leaves",
    "cherry_leaves",
    "grass",
    "tall_grass",
    "fern",
    "large_fern",
    "vine",
    "weeping_vines",
    "twisting_vines",
    "snow",
  ].forEach((name) => {
    if (registry.blocksByName[name])
      softBlockTypes.add(registry.blocksByName[name].id);
  });

  botInstance.removeListener("entityHurt", handleEntityHurt);
  botInstance.on("entityHurt", handleEntityHurt);
  console.log("[Auto Defend] Đã khởi tạo (PvP Nâng cao - No Eat Logic).");
}

// --- Event Handler ---
async function handleEntityHurt(entity) {
  const now = Date.now();
  if (
    !botInstance ||
    !botInstance.entity ||
    entity.id !== botInstance.entity.id ||
    isDefending ||
    botInstance.isProtecting
  )
    return;
  if (now - lastHurtProcessedTime < HURT_PROCESS_COOLDOWN) return;

  const botPos = botInstance.entity.position;
  const blockAtFeet = botInstance.blockAt(botPos);
  const blockAtHead = botInstance.blockAt(botPos.offset(0, 1, 0));
  const isSuffocating = blockAtHead && isBlockSolid(blockAtHead);
  const isOnFire = botInstance.entity.onFire;
  const isInDangerousBlock =
    isBlockDangerous(botInstance.registry, blockAtFeet) ||
    isBlockDangerous(botInstance.registry, blockAtHead);
  const hasBadEffect =
    botInstance.entity.effects &&
    Object.values(botInstance.entity.effects).some(
      (e) => e && (e.name === "poison" || e.name === "wither")
    );
  // const isStarving = botInstance.food <= 0 && botInstance.health < botInstance.maxHealth; // <<<< XÓA KIỂM TRA ĐÓI

  if (isSuffocating) {
    console.log("[Auto Defend] Bị ngạt! Thử thoát...");
    lastHurtProcessedTime = now;
    if (stopAllTasksFn) stopAllTasksFn(botInstance, "Bị ngạt");
    await sleep(100);
    try {
      if (
        blockAtHead &&
        softBlockTypes.has(blockAtHead.type) &&
        botInstance.canDigBlock(blockAtHead)
      )
        await botInstance.dig(blockAtHead);
    } catch {}
    return;
  }
  if (isOnFire || isInDangerousBlock) {
    console.log("[Auto Defend] Cháy/Nguy hiểm! Chạy!");
    lastHurtProcessedTime = now;
    if (stopAllTasksFn) stopAllTasksFn(botInstance, "Cháy/Nguy hiểm");
    await sleep(100);
    const water = botInstance.findBlock({
      matching: botInstance.registry.blocksByName.water?.id,
      maxDistance: 10,
    });
    if (water) {
      try {
        botInstance.pathfinder.setGoal(
          new GoalBlock(water.position.x, water.position.y, water.position.z)
        );
      } catch {
        startFleeing(null);
      }
    } else {
      startFleeing(null);
    }
    return;
  }
  if (hasBadEffect /* || isStarving */) {
    // <<<< XÓA KIỂM TRA ĐÓI
    lastHurtProcessedTime = now;
    return;
  }

  // --- Tìm kẻ tấn công ---
  let potentialAttacker = null;
  let closestHostileInRange = null;
  let closestPlayerInRange = null;
  let minHostileDistSq = HOSTILE_SCAN_RADIUS * HOSTILE_SCAN_RADIUS;
  let minPlayerDistSq = PLAYER_SCAN_RADIUS * PLAYER_SCAN_RADIUS;
  for (const entityId in botInstance.entities) {
    const E = botInstance.entities[entityId];
    if (!E || E === botInstance.entity || !E.isValid || !E.position) continue;
    const distSq = E.position.distanceSquared(botPos);
    const entityType = E.type?.toLowerCase();
    const entityKind = E.kind?.toLowerCase();
    const isHostileMob =
      entityType === "hostile" ||
      entityKind === "hostile mobs" ||
      entityKind === "hostile";
    const isPlayer = entityType === "player";
    if (isHostileMob && distSq < minHostileDistSq) {
      minHostileDistSq = distSq;
      closestHostileInRange = E;
    } else if (isPlayer && distSq < minPlayerDistSq) {
      minPlayerDistSq = distSq;
      closestPlayerInRange = E;
    }
  }
  if (closestHostileInRange && minHostileDistSq < VERY_CLOSE_THRESHOLD_SQ)
    potentialAttacker = closestHostileInRange;
  else if (closestHostileInRange && minHostileDistSq < LIKELY_ATTACKER_RANGE_SQ)
    potentialAttacker = closestHostileInRange;
  else if (closestHostileInRange) potentialAttacker = closestHostileInRange;
  else if (closestPlayerInRange) potentialAttacker = closestPlayerInRange;

  if (potentialAttacker) {
    const OWNER_USERNAME = ".XinhgaiLesbian";
    if (
      potentialAttacker.type === "player" &&
      potentialAttacker.username?.toLowerCase() === OWNER_USERNAME.toLowerCase()
    ) {
      lastHurtProcessedTime = now;
      return;
    }
    lastHurtProcessedTime = now;
    startDefending(potentialAttacker);
  } else {
    lastHurtProcessedTime = now;
  }
}

// --- Core Defend Logic ---
function startDefending(attacker) {
  if (isDefending || !attacker?.isValid) return;
  isDefending = true;
  defendingTarget = attacker;
  botInstance.isDefending = true;
  defenseStartTime = Date.now();
  consecutiveMeleeMisses = 0;
  isAttemptingHeal = false;
  const targetName = attacker.username || attacker.displayName || "Kẻ địch";
  console.log(
    `[Auto Defend] === BẮT ĐẦU PHÒNG THỦ vs ${targetName} (Type: ${attacker.type}) ===`
  );
  try {
    botInstance.chat(
      `Gặp ${targetName}! ${
        attacker.type === "player" ? "Chuẩn bị PvP!" : "Xử lý mày!"
      }`
    );
  } catch (e) {}
  if (stopAllTasksFn) stopAllTasksFn(botInstance, "Bị tấn công");
  clearDefenseIntervals();

  // Chỉ kiểm tra máu để quyết định chạy
  const shouldFlee = botInstance.health <= FLEE_INSTEAD_OF_FIGHT_HEALTH;
  const isPlayerTarget = attacker.type === "player";

  if (shouldFlee) {
    console.log(
      `[Auto Defend] Máu thấp (${botInstance.health}). Ưu tiên CHẠY TRỐN!`
    );
    startFleeing(attacker);
  } else {
    const bestAxe =
      ENABLE_PVP_AXE_VS_SHIELD && isPlayerTarget
        ? findBestWeapon(AXE_PRIORITY)
        : null;
    const bestMelee = findBestWeapon(MELEE_WEAPON_PRIORITY);
    const bestRanged = ENABLE_RANGED ? findBestWeapon(RANGED_PRIORITY) : null;
    const hasAmmo = bestRanged && findAmmunition();
    const isCreeper = attacker.name === "creeper";
    let distanceToAttacker = Infinity;
    try {
      distanceToAttacker = botInstance.entity.position.distanceTo(
        attacker.position
      );
    } catch {}

    if (isCreeper && distanceToAttacker < CREEPER_FLEE_DISTANCE) {
      startFleeing(attacker);
    } else if (
      bestRanged &&
      hasAmmo &&
      distanceToAttacker >= RANGED_WEAPON_MIN_DIST &&
      distanceToAttacker <= RANGED_WEAPON_MAX_DIST
    ) {
      startRangedCombatLoop(bestRanged);
    } else if (bestMelee) {
      startMeleeCombatLoop(bestMelee, bestAxe);
    } else {
      startFleeing(attacker);
    }
  }
}

function stopDefending(reason) {
  if (!isDefending) return;
  const targetName =
    defendingTarget?.username || defendingTarget?.displayName || "mục tiêu cũ";
  console.log(
    `[Auto Defend] === DỪNG PHÒNG THỦ (vs ${targetName}). Lý do: ${reason} ===`
  );
  isDefending = false;
  defendingTarget = null;
  botInstance.isDefending = false;
  clearDefenseIntervals();
  try {
    if (botInstance.pathfinder?.isMoving()) {
      botInstance.pathfinder.stop();
      botInstance.pathfinder.setGoal(null);
    }
  } catch {}
  deactivateShieldIfNeeded().catch(() => {});
  botInstance.clearControlStates();
}

// --- Combat Loops ---

function startMeleeCombatLoop(primaryWeapon, bestAxe) {
  let currentWeapon = primaryWeapon; // Sẽ được cập nhật trong interval
  // let tryingToHeal = false; // Đã chuyển thành biến module isAttemptingHeal

  const equipAndPrepare = async () => {
    try {
      if (
        !botInstance.heldItem ||
        botInstance.heldItem.type !== primaryWeapon.type
      ) {
        await botInstance.equip(primaryWeapon, "hand");
        await sleep(100);
      }
      if (ENABLE_SHIELD) await activateShieldIfNeeded();
    } catch {}
  };
  equipAndPrepare();

  lookInterval = setInterval(() => {
    if (isDefending && defendingTarget?.isValid)
      botInstance
        .lookAt(
          defendingTarget.position.offset(0, defendingTarget.height * 0.8, 0),
          true
        )
        .catch(() => {});
  }, LOOK_INTERVAL);

  combatInterval = setInterval(async () => {
    if (!isDefending || !defendingTarget?.isValid) {
      stopDefending("Mục tiêu không hợp lệ (Melee)");
      return;
    }
    if (Date.now() - defenseStartTime > DEFEND_TIMEOUT) {
      stopDefending("Hết thời gian (Melee)");
      return;
    }
    if (isAttemptingHeal) return;

    const isPlayerTarget = defendingTarget.type === "player";
    const botPos = botInstance.entity.position;
    const targetPos = defendingTarget.position;
    let distance = Infinity;
    try {
      distance = botPos.distanceTo(targetPos);
    } catch {}
    const now = Date.now();

    // Kiểm tra hồi máu PvP
    if (
      ENABLE_PVP_HEALING &&
      isPlayerTarget &&
      botInstance.health <= PVP_FLEE_HEALTH_THRESHOLD
    ) {
      const healingItem = findBestHealingItem();
      if (healingItem) {
        isAttemptingHeal = true;
        clearDefenseIntervals();
        botInstance.clearControlStates();
        botInstance.setControlState("back", true);
        await sleep(300);
        botInstance.setControlState("back", false);
        try {
          await botInstance.equip(healingItem, "hand");
          await sleep(100);
          botInstance.activateItem();
          await sleep(HEAL_TIMEOUT);
        } catch {
        } finally {
          isAttemptingHeal = false;
          startDefending(defendingTarget);
        }
        return;
      } else {
        startFleeing(defendingTarget);
        return;
      }
    }
    // Kiểm tra máu chung -> Chạy
    if (botInstance.health <= FLEE_INSTEAD_OF_FIGHT_HEALTH) {
      // <<<< XÓA KIỂM TRA ĐÓI
      console.log(
        `[Auto Defend ${isPlayerTarget ? "PvP" : "Mob"}] Máu thấp. Chạy!`
      );
      startFleeing(defendingTarget);
      return;
    }
    // Xử lý Creeper
    if (
      defendingTarget.name === "creeper" &&
      distance < CREEPER_FLEE_DISTANCE
    ) {
      startFleeing(defendingTarget);
      return;
    }

    // Xác định vũ khí và chiến thuật
    let weaponToUse = primaryWeapon;
    if (
      ENABLE_PVP_AXE_VS_SHIELD &&
      isPlayerTarget &&
      bestAxe &&
      checkEnemyShield(defendingTarget)
    )
      weaponToUse = bestAxe;
    const bestRanged = ENABLE_RANGED ? findBestWeapon(RANGED_PRIORITY) : null;
    const hasAmmo = bestRanged && findAmmunition();
    if (bestRanged && hasAmmo && distance >= RANGED_WEAPON_MIN_DIST) {
      startRangedCombatLoop(bestRanged);
      return;
    }

    // Hành động cận chiến
    if (distance < COMBAT_DISTANCE) {
      if (botInstance.pathfinder.isMoving()) botInstance.pathfinder.stop();
      if (currentStrafeDir === 0) botInstance.clearControlStates();
      let canAttack = false;
      try {
        if (
          !botInstance.heldItem ||
          botInstance.heldItem.type !== weaponToUse.type
        ) {
          await botInstance.equip(weaponToUse, "hand");
          await sleep(50);
        }
        if (botInstance.heldItem?.type === weaponToUse.type) canAttack = true;
      } catch {}
      if (canAttack) await deactivateShieldIfNeeded();

      if (canAttack && now - lastAttackTime > ATTACK_INTERVAL) {
        try {
          botInstance.attack(defendingTarget, true);
          lastAttackTime = now;
          consecutiveMeleeMisses = 0;
          if (ENABLE_KITING) {
            botInstance.setControlState("back", true);
            await sleep(150);
            botInstance.setControlState("back", false);
          }
        } catch {
          consecutiveMeleeMisses++;
        }
      } else if (canAttack) {
        consecutiveMeleeMisses++;
      }
      if (ENABLE_SHIELD) await activateShieldIfNeeded();
    } else if (distance < SAFE_DISTANCE) {
      // Đuổi theo
      await deactivateShieldIfNeeded();
      const followDist = isPlayerTarget ? PVP_FOLLOW_DISTANCE : FOLLOW_DISTANCE;
      const goal = new GoalFollow(defendingTarget, followDist);
      if (
        !botInstance.pathfinder.isMoving() ||
        !(botInstance.pathfinder.goal instanceof GoalFollow) ||
        botInstance.pathfinder.goal.entity !== defendingTarget ||
        botInstance.pathfinder.goal.distance !== followDist
      ) {
        botInstance.pathfinder.setGoal(goal, true);
      }
    } else {
      stopDefending("Mục tiêu quá xa (Melee)");
    }
  }, ATTACK_INTERVAL);

  if (ENABLE_STRAFING) {
    strafeInterval = setInterval(() => {
      if (!isDefending || !defendingTarget?.isValid) {
        clearInterval(strafeInterval);
        strafeInterval = null;
        return;
      }
      let distance = Infinity;
      try {
        distance = botInstance.entity.position.distanceTo(
          defendingTarget.position
        );
      } catch {}
      if (distance < COMBAT_DISTANCE + 1) {
        const nextDir = Math.random() < 0.4 ? -1 : Math.random() < 0.8 ? 1 : 0;
        if (nextDir !== currentStrafeDir) {
          if (currentStrafeDir === -1)
            botInstance.setControlState("left", false);
          else if (currentStrafeDir === 1)
            botInstance.setControlState("right", false);
          currentStrafeDir = nextDir;
          if (currentStrafeDir === -1)
            botInstance.setControlState("left", true);
          else if (currentStrafeDir === 1)
            botInstance.setControlState("right", true);
          setTimeout(() => {
            if (currentStrafeDir === -1)
              botInstance.setControlState("left", false);
            else if (currentStrafeDir === 1)
              botInstance.setControlState("right", false);
            if (currentStrafeDir === nextDir) currentStrafeDir = 0;
          }, STRAFE_DURATION);
        }
      } else {
        if (currentStrafeDir === -1) botInstance.setControlState("left", false);
        else if (currentStrafeDir === 1)
          botInstance.setControlState("right", false);
        currentStrafeDir = 0;
      }
    }, STRAFE_INTERVAL);
  }
}

function startRangedCombatLoop(weapon) {
  const equipAndCheckAmmo = async () => {
    try {
      if (!botInstance.heldItem || botInstance.heldItem.type !== weapon.type)
        await botInstance.equip(weapon, "hand");
      await sleep(100);
      return findAmmunition() !== null;
    } catch {
      return false;
    }
  };

  equipAndCheckAmmo().then((hasAmmo) => {
    if (!hasAmmo) {
      const bestMelee = findBestWeapon(MELEE_WEAPON_PRIORITY);
      if (bestMelee)
        startMeleeCombatLoop(bestMelee, findBestWeapon(AXE_PRIORITY));
      else startFleeing(defendingTarget);
      return;
    }
    lookInterval = setInterval(() => {
      if (isDefending && defendingTarget?.isValid)
        botInstance
          .lookAt(
            defendingTarget.position.offset(0, defendingTarget.height * 0.8, 0),
            true
          )
          .catch(() => {});
    }, LOOK_INTERVAL);

    combatInterval = setInterval(async () => {
      if (!isDefending || !defendingTarget?.isValid) {
        stopDefending("Mục tiêu không hợp lệ (Ranged)");
        return;
      }
      if (Date.now() - defenseStartTime > DEFEND_TIMEOUT) {
        stopDefending("Hết thời gian (Ranged)");
        return;
      }
      if (isAttemptingHeal) return;

      const isPlayerTarget = defendingTarget.type === "player"; // Định nghĩa lại

      // Kiểm tra máu -> chạy
      if (botInstance.health <= FLEE_INSTEAD_OF_FIGHT_HEALTH) {
        // <<<< XÓA KIỂM TRA ĐÓI
        console.log(
          `[Auto Defend ${
            isPlayerTarget ? "PvP" : "Mob"
          }] Máu thấp khi bắn xa. Chạy!`
        );
        startFleeing(defendingTarget);
        return;
      }

      const botPos = botInstance.entity.position;
      const targetPos = defendingTarget.position;
      let distance = Infinity;
      try {
        distance = botPos.distanceTo(targetPos);
      } catch {}
      const now = Date.now();

      if (!findAmmunition()) {
        const bestMelee = findBestWeapon(MELEE_WEAPON_PRIORITY);
        if (bestMelee)
          startMeleeCombatLoop(bestMelee, findBestWeapon(AXE_PRIORITY));
        else startFleeing(defendingTarget);
        return;
      }

      // Chuyển cận chiến
      if (distance < RANGED_WEAPON_MIN_DIST) {
        const bestMelee = findBestWeapon(MELEE_WEAPON_PRIORITY);
        if (bestMelee)
          startMeleeCombatLoop(bestMelee, findBestWeapon(AXE_PRIORITY));
        else startFleeing(defendingTarget);
        return;
      }

      // Bắn
      if (
        distance <= RANGED_WEAPON_MAX_DIST &&
        now - lastRangedAttackTime > RANGED_ATTACK_INTERVAL
      ) {
        if (botInstance.pathfinder.isMoving()) botInstance.pathfinder.stop();
        botInstance.clearControlStates();
        await deactivateShieldIfNeeded();
        try {
          if (
            !botInstance.heldItem ||
            botInstance.heldItem.type !== weapon.type
          )
            await botInstance.equip(weapon, "hand");
          await sleep(50);
          if (botInstance.heldItem?.type === weapon.type) {
            botInstance.activateItem();
            await sleep(800);
            botInstance.deactivateItem();
            lastRangedAttackTime = now;
          }
        } catch {}
      }
      // Giữ khoảng cách / Dừng
      else if (distance > RANGED_WEAPON_MAX_DIST + 2) {
        stopDefending("Mục tiêu quá xa (Ranged)");
      } else if (
        distance >= RANGED_WEAPON_MIN_DIST &&
        distance <= RANGED_WEAPON_MAX_DIST &&
        botInstance.pathfinder.isMoving()
      ) {
        botInstance.pathfinder.stop();
      }
    }, RANGED_ATTACK_INTERVAL / 2);
  });
}

async function startFleeing(attacker) {
  const targetName = attacker?.username || attacker?.displayName || "kẻ địch";
  clearDefenseIntervals();
  await sleep(10);
  if (!isDefending) return;

  let fleeGoal = null;
  const botPos = botInstance.entity.position;
  console.log(
    `[Auto Defend] Bắt đầu CHẠY TRỐN khỏi ${targetName}! (Sau dọn dẹp)`
  );
  try {
    botInstance.chat(`Á á, chạy khỏi ${targetName} thôi!`);
    return;
  } catch (e) {}

  const homeWaypoint = botInstance.waypoints?.home;
  let homePos = null;
  if (
    homeWaypoint &&
    typeof homeWaypoint.x === "number" &&
    typeof homeWaypoint.y === "number" &&
    typeof homeWaypoint.z === "number"
  )
    homePos = new Vec3(homeWaypoint.x, homeWaypoint.y, homeWaypoint.z);

  if (
    homePos &&
    botPos.distanceTo(homePos) < 100 &&
    (!attacker ||
      !attacker.isValid ||
      attacker.position.distanceTo(homePos) > SAFE_DISTANCE + 5)
  ) {
    fleeGoal = new GoalBlock(homePos.x, homePos.y, homePos.z);
  } else if (attacker?.isValid) {
    fleeGoal = new GoalInvert(new GoalFollow(attacker, SAFE_DISTANCE));
  } else {
    let fleeDirection = new Vec3(
      Math.random() - 0.5,
      0,
      Math.random() - 0.5
    ).normalize();
    if (fleeDirection.norm() < 0.1) fleeDirection = new Vec3(1, 0, 0);
    const fleeTargetPos = botPos.plus(fleeDirection.scaled(SAFE_DISTANCE));
    fleeGoal = new GoalNear(
      fleeTargetPos.x,
      fleeTargetPos.y,
      fleeTargetPos.z,
      3
    );
  }

  if (!fleeGoal) {
    stopDefending("Không thể tạo mục tiêu chạy trốn");
    return;
  }
  try {
    botInstance.pathfinder.setGoal(fleeGoal);
    fleeCheckInterval = setInterval(
      () => checkFleeingStatus(attacker),
      FLEE_CHECK_INTERVAL
    );
  } catch (err) {
    stopDefending(`Lỗi pathfinding khi chạy: ${err.message}`);
  }
}

function checkFleeingStatus(originalAttacker) {
  if (!isDefending || !botInstance?.entity) {
    clearDefenseIntervals();
    return;
  }
  if (Date.now() - defenseStartTime > DEFEND_TIMEOUT) {
    stopDefending("Hết thời gian (Flee Check)");
    return;
  }

  const currentTarget = defendingTarget || originalAttacker;
  if (!currentTarget?.isValid) {
    stopDefending("Kẻ địch biến mất khi chạy");
    return;
  }

  const botPos = botInstance.entity.position;
  const targetPos = currentTarget.position;
  let currentDistance = SAFE_DISTANCE + 1;
  try {
    currentDistance = botPos.distanceTo(targetPos);
  } catch {}
  const currentDistanceSq = currentDistance * currentDistance;

  if (currentDistanceSq >= SAFE_DISTANCE_SQ) {
    stopDefending("Đạt khoảng cách an toàn");
    return;
  }

  if (ENABLE_FLEE_SHOOT) {
    const bestRanged = findBestWeapon(RANGED_PRIORITY);
    const hasAmmo = bestRanged && findAmmunition();
    const now = Date.now();
    if (
      bestRanged &&
      hasAmmo &&
      currentDistance >= RANGED_WEAPON_MIN_DIST &&
      currentDistance <= RANGED_WEAPON_MAX_DIST &&
      now - lastRangedAttackTime > RANGED_ATTACK_INTERVAL * 1.5
    ) {
      botInstance
        .lookAt(targetPos.offset(0, currentTarget.height * 0.8, 0), true)
        .catch(() => {});
      (async () => {
        try {
          if (
            !botInstance.heldItem ||
            botInstance.heldItem.type !== bestRanged.type
          )
            await botInstance.equip(bestRanged, "hand");
          await sleep(50);
          if (botInstance.heldItem?.type === bestRanged.type) {
            botInstance.activateItem();
            await sleep(600);
            botInstance.deactivateItem();
            lastRangedAttackTime = now;
          }
        } catch {}
      })();
    }
  }

  if (!botInstance.pathfinder.isMoving() && botInstance.pathfinder.goal) {
    stopDefending("Bị kẹt/Pathfinder dừng khi chạy");
    return;
  }
}

// --- Clean Up Function ---
function clearDefenseIntervals() {
  if (combatInterval) clearInterval(combatInterval);
  combatInterval = null;
  if (lookInterval) clearInterval(lookInterval);
  lookInterval = null;
  if (fleeCheckInterval) clearInterval(fleeCheckInterval);
  fleeCheckInterval = null;
  if (strafeInterval) clearInterval(strafeInterval);
  strafeInterval = null;
  isShieldActive = false;
  currentStrafeDir = 0;
  isAttemptingHeal = false;
}

// --- Exports ---
module.exports = { initializeAutoDefend, stopDefending };
// --- END OF FILE ---
