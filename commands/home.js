// --- START OF FILE commands/home.js ---
const { GoalNear, GoalBlock } = require("mineflayer-pathfinder").goals;
const { Vec3 } = require("vec3");
const { sleep, formatCoords, translateToEnglishId } = require("../utils");
const collectCmd = require("./collect");
const craftCmd = require("./craft"); // Giả sử có file craft.js cơ bản

let mcData;
let botRef;
let houseMaterials = {}; // Sẽ được khởi tạo

const HOUSE_WIDTH_DEFAULT = 7;
const HOUSE_DEPTH_DEFAULT = 9;
const HOUSE_HEIGHT_PER_FLOOR_DEFAULT = 3;
const TOTAL_FLOORS_DEFAULT = 2;
const FOUNDATION_HEIGHT_DEFAULT = 1;

const MAT_FOUNDATION_DEFAULT = 'cobblestone';
const MAT_WALL_DEFAULT = 'oak_planks';
const MAT_FLOOR_DEFAULT = 'oak_planks';
const MAT_ROOF_DEFAULT = 'oak_stairs';
const MAT_ROOF_EDGE_DEFAULT = 'oak_slab';
const MAT_WINDOW_DEFAULT = 'glass_pane';
const MAT_DOOR_DEFAULT = 'oak_door';
const MAT_FENCE_DEFAULT = 'oak_fence';
const MAT_GATE_DEFAULT = 'oak_fence_gate';
const MAT_TORCH_DEFAULT = 'torch';
const MAT_BED_DEFAULT = 'white_bed';
const MAT_CHEST_DEFAULT = 'chest';
const MAT_FURNACE_DEFAULT = 'furnace';
const MAT_CRAFTING_TABLE_DEFAULT = 'crafting_table';
const MAT_STAIRS_INTERIOR_DEFAULT = 'oak_stairs';
const MAT_SCAFFOLD_DEFAULT = 'dirt'; // Khối để bắc giàn giáo tạm

const WINDOW_POSITIONS = [ // Ví dụ vị trí cửa sổ (y=1 so với sàn tầng)
    { side: 'front', offset: 2 }, { side: 'front', offset: 4 },
    { side: 'back', offset: 2 }, { side: 'back', offset: 4 },
    { side: 'left', offset: 3 }, { side: 'left', offset: 6 },
    { side: 'right', offset: 3 }, { side: 'right', offset: 6 }
];
const INTERIOR_ITEMS_POS = { // Vị trí tương đối trong nhà (x,z so với góc basePos)
    crafting_table: { x: 1, z: 1 },
    furnace1: { x: 1, z: 2 },
    furnace2: { x: 1, z: 3 },
    chest1: { x: HOUSE_WIDTH_DEFAULT - 2, z: 1 },
    chest2: { x: HOUSE_WIDTH_DEFAULT - 3, z: 1 },
    bed_head: { x: 1, z: HOUSE_DEPTH_DEFAULT - 2 }, // Đầu giường
};
const TORCH_POSITIONS_RELATIVE = [ // (x, y, z) tương đối so với basePos
    { x: 1, y: 1, z: -1 }, // Trên cửa trước
    { x: HOUSE_WIDTH_DEFAULT - 2, y: 1, z: -1 },
    { x: 1, y: 1, z: HOUSE_DEPTH_DEFAULT }, // Tường sau
    { x: HOUSE_WIDTH_DEFAULT - 2, y: 1, z: HOUSE_DEPTH_DEFAULT },
    { x: -1, y: 1, z: 2 }, // Tường trái
    { x: -1, y: 1, z: HOUSE_DEPTH_DEFAULT - 3 },
    { x: HOUSE_WIDTH_DEFAULT, y: 1, z: 2 }, // Tường phải
    { x: HOUSE_WIDTH_DEFAULT, y: 1, z: HOUSE_DEPTH_DEFAULT - 3 },
    // Tầng 2? Thêm nếu cần
];

const BUILD_REACH = 4.5;
const FENCE_OFFSET = 2;
const PEN_SIZE = 5;
const SAFE_PLACEMENT_RETRIES = 3;
const RESOURCE_GATHER_TIMEOUT = 15 * 60 * 1000; // 15 phút tối đa cho mỗi lần thu thập


function initializeConstants(width, depth, heightPerFloor, totalFloors) {
     const w = width || HOUSE_WIDTH_DEFAULT;
     const d = depth || HOUSE_DEPTH_DEFAULT;
     const h = heightPerFloor || HOUSE_HEIGHT_PER_FLOOR_DEFAULT;
     const f = totalFloors || TOTAL_FLOORS_DEFAULT;

     houseMaterials = { // Sử dụng biến toàn cục hoặc truyền vào taskDetails
        HOUSE_WIDTH: w, HOUSE_DEPTH: d, HOUSE_HEIGHT_PER_FLOOR: h, TOTAL_FLOORS: f, FOUNDATION_HEIGHT: FOUNDATION_HEIGHT_DEFAULT,
        MAT_FOUNDATION: MAT_FOUNDATION_DEFAULT, MAT_WALL: MAT_WALL_DEFAULT, MAT_FLOOR: MAT_FLOOR_DEFAULT,
        MAT_ROOF: MAT_ROOF_DEFAULT, MAT_ROOF_EDGE: MAT_ROOF_EDGE_DEFAULT, MAT_WINDOW: MAT_WINDOW_DEFAULT,
        MAT_DOOR: MAT_DOOR_DEFAULT, MAT_FENCE: MAT_FENCE_DEFAULT, MAT_GATE: MAT_GATE_DEFAULT,
        MAT_TORCH: MAT_TORCH_DEFAULT, MAT_BED: MAT_BED_DEFAULT, MAT_CHEST: MAT_CHEST_DEFAULT,
        MAT_FURNACE: MAT_FURNACE_DEFAULT, MAT_CRAFTING_TABLE: MAT_CRAFTING_TABLE_DEFAULT,
        MAT_STAIRS_INTERIOR: MAT_STAIRS_INTERIOR_DEFAULT, MAT_SCAFFOLD: MAT_SCAFFOLD_DEFAULT
    };
}

function calculateRequiredResources(mats) {
    const required = {};
    const recipes = mcData?.recipes; // Cần mcData đã được khởi tạo

    const addItem = (name, count) => {
        required[name] = (required[name] || 0) + Math.max(0, Math.ceil(count));
    };

    // Foundation
    addItem(mats.MAT_FOUNDATION, mats.HOUSE_WIDTH * mats.HOUSE_DEPTH * mats.FOUNDATION_HEIGHT);

    // Walls (tính gần đúng, bỏ qua góc/cửa/cửa sổ chi tiết)
    const wallPerimeter = (mats.HOUSE_WIDTH + mats.HOUSE_DEPTH) * 2;
    addItem(mats.MAT_WALL, wallPerimeter * mats.HOUSE_HEIGHT_PER_FLOOR * mats.TOTAL_FLOORS);
    addItem(mats.MAT_WINDOW, WINDOW_POSITIONS.length * mats.TOTAL_FLOORS); // Ước tính cửa sổ
    addItem(mats.MAT_DOOR, 1); // 1 cửa chính

    // Floors (Chỉ tầng trên)
    addItem(mats.MAT_FLOOR, mats.HOUSE_WIDTH * mats.HOUSE_DEPTH * (mats.TOTAL_FLOORS - 1));

    // Roof (Ước tính rất thô cho mái dốc)
    const roofArea = (mats.HOUSE_WIDTH + 2) * (mats.HOUSE_DEPTH + 2);
    addItem(mats.MAT_ROOF, roofArea * 0.8); // Ước tính 80% là cầu thang
    addItem(mats.MAT_ROOF_EDGE, roofArea * 0.2); // 20% là phiến đá

    // Fence
    const fencePerimeter = (mats.HOUSE_WIDTH + FENCE_OFFSET * 2 + PEN_SIZE) * 2 + (mats.HOUSE_DEPTH + FENCE_OFFSET * 2 + PEN_SIZE) * 2; // Bao gồm cả nhà và chuồng
    addItem(mats.MAT_FENCE, fencePerimeter);
    addItem(mats.MAT_GATE, 2); // Cổng nhà + chuồng

    // Interior
    addItem(mats.MAT_TORCH, TORCH_POSITIONS_RELATIVE.length);
    addItem(mats.MAT_BED, 1);
    addItem(mats.MAT_CHEST, Object.keys(INTERIOR_ITEMS_POS).filter(k => k.includes('chest')).length);
    addItem(mats.MAT_FURNACE, Object.keys(INTERIOR_ITEMS_POS).filter(k => k.includes('furnace')).length);
    addItem(mats.MAT_CRAFTING_TABLE, 1);
    addItem(mats.MAT_STAIRS_INTERIOR, 10); // Ước tính cầu thang lên tầng

    // Expand requirements based on recipes (Simplified)
     const checkCrafting = (itemName, count) => {
          const itemData = mcData.itemsByName[itemName] || mcData.blocksByName[itemName];
          if (!itemData) return;

         // Nếu là sản phẩm chế tạo, thêm nguyên liệu
         if (itemName.includes('_planks')) {
              const logType = itemName.replace('_planks', '_log'); // VD: oak_planks -> oak_log
             addItem(logType, count / 4); // 1 log -> 4 planks
         } else if (itemName.includes('_stairs')) {
             const baseMat = itemName.replace('_stairs', '_planks'); // Thường làm từ planks
              if (mcData.itemsByName[baseMat]) addItem(baseMat, count * 6 / 4); // 6 planks -> 4 stairs -> 1.5 planks/stair
         } else if (itemName.includes('_slab')) {
              const baseMat = itemName.replace('_slab', '_planks');
              if (mcData.itemsByName[baseMat]) addItem(baseMat, count * 3 / 6); // 3 planks -> 6 slabs -> 0.5 planks/slab
         } else if (itemName.includes('_fence')) {
              if (!itemName.includes('gate')) { // Fence thường cần stick + plank
                   const baseMat = itemName.replace('_fence', '_planks');
                   if (mcData.itemsByName[baseMat]) addItem(baseMat, count * 4 / 3); // 4 plank + 2 stick -> 3 fence
                  addItem('stick', count * 2 / 3);
              } else { // Gate cần stick + plank
                  const baseMat = itemName.replace('_fence_gate', '_planks');
                   if (mcData.itemsByName[baseMat]) addItem(baseMat, count * 2); // 2 plank + 4 stick -> 1 gate
                   addItem('stick', count * 4);
               }
          } else if (itemName === mats.MAT_CHEST) {
              addItem(mats.MAT_WALL, count * 8); // Cần 8 planks (giả định cùng loại tường)
          } else if (itemName === mats.MAT_CRAFTING_TABLE) {
              addItem(mats.MAT_WALL, count * 4);
          } else if (itemName === mats.MAT_FURNACE) {
              addItem(mats.MAT_FOUNDATION, count * 8); // Cần 8 đá cuội (giả định nền là đá cuội)
          } else if (itemName === mats.MAT_BED) {
               addItem(mats.MAT_WALL, count * 3); // 3 planks
               addItem('white_wool', count * 3); // Cụ thể white_wool cho giường trắng
          } else if (itemName === mats.MAT_TORCH) {
               addItem('coal', count / 4); // 1 than -> 4 đuốc
               addItem('stick', count / 4); // 1 que -> 4 đuốc
          } else if (itemName === mats.MAT_WINDOW) { // glass_pane
               addItem('glass', count * 6 / 16); // 6 glass -> 16 panes
          }
     };

     let currentKeys = Object.keys(required);
     for (let i = 0; i < 5; i++) { // Lặp vài lần để phân giải nguyên liệu
         let newItemsAdded = false;
         const keysToProcess = [...currentKeys]; // Process keys found in this iteration
         currentKeys = []; // Reset for next iteration
         for (const item of keysToProcess) {
              checkCrafting(item, required[item]);
         }
          // Update currentKeys for the next potential iteration if new items were added
         const nextKeys = Object.keys(required);
         if (nextKeys.length > keysToProcess.length) { // Crude check if new base materials were added
             currentKeys = nextKeys.filter(k => !keysToProcess.includes(k));
              if(currentKeys.length === 0) break; // Stop if no new *base* materials are derived
         } else {
              break; // Stop if no new items were added at all
          }
      }

     // Check derived items like sticks
     if (required.stick) {
         addItem(mats.MAT_WALL, required.stick / 4); // 2 planks -> 4 sticks -> 0.5 plank/stick
     }
      // Check glass needs sand and fuel
      if (required.glass) {
          addItem('sand', required.glass);
          addItem('coal', required.glass / 8); // 1 coal smelts 8 items
      }

      // Loại bỏ các giá trị 0 hoặc âm
     for (const key in required) {
         if (required[key] <= 0) {
             delete required[key];
         } else {
             required[key] = Math.ceil(required[key]); // Làm tròn lên
         }
     }


    return required;
}

async function checkAndGatherResources(bot, requiredItems) {
    let missing = {};
    let needsCrafting = {}; // Items that need crafting after gathering raw mats
    let needsSmelting = {}; // Items that need smelting

     // Phase 1: Check current inventory vs final required items
    for (const itemName in requiredItems) {
        const requiredCount = requiredItems[itemName];
        const itemData = mcData.itemsByName[itemName] || mcData.blocksByName[itemName];
        if (!itemData) {
            console.warn(`[Res Check] Không tìm thấy dữ liệu Minecraft cho: ${itemName}`);
            continue;
        }
        const currentCount = bot.inventory.count(itemData.id);
        if (currentCount < requiredCount) {
            const needed = requiredCount - currentCount;
            missing[itemName] = needed;
        }
    }

     if (Object.keys(missing).length === 0) {
          bot.chat("Đã có đủ tất cả tài nguyên!");
          return { success: true, stillMissing: {} };
     }

     // Phase 2: Identify craftable/smeltable items and check base materials
    const baseMaterialsToCollect = {};
    let potentiallyCraftable = true; // Assume we can craft until proven otherwise

    for (const itemName in missing) {
         const neededCount = missing[itemName];
         // Logic phân giải ngược (tương tự calculateRequiredResources nhưng chỉ kiểm tra, không cộng dồn)
         // VD: Thiếu oak_stairs -> kiểm tra oak_planks -> kiểm tra oak_log
         // Nếu thiếu nguyên liệu gốc -> thêm vào baseMaterialsToCollect
         // Tạm thời đơn giản hóa: Nếu là sản phẩm (planks, stairs, furnace, ...) thì đánh dấu cần chế tạo/nấu và kiểm tra thô.
          if (itemName.includes('_planks') || itemName.includes('_stairs') || itemName.includes('_slab') || itemName.includes('_fence') || itemName.includes('chest') || itemName.includes('furnace') || itemName.includes('crafting_table') || itemName.includes('bed') || itemName.includes('door') || itemName.includes('pane')) {
              needsCrafting[itemName] = neededCount;
               // Kiểm tra sơ bộ nguyên liệu gốc (vd: furnace -> cobblestone)
               if(itemName === houseMaterials.MAT_FURNACE && bot.inventory.count(mcData.itemsByName[houseMaterials.MAT_FOUNDATION]?.id) < neededCount * 8) {
                   baseMaterialsToCollect[houseMaterials.MAT_FOUNDATION] = (baseMaterialsToCollect[houseMaterials.MAT_FOUNDATION] || 0) + neededCount * 8;
               } else if (itemName === houseMaterials.MAT_CRAFTING_TABLE && bot.inventory.count(mcData.itemsByName[houseMaterials.MAT_WALL]?.id) < neededCount * 4) {
                   baseMaterialsToCollect[houseMaterials.MAT_WALL] = (baseMaterialsToCollect[houseMaterials.MAT_WALL] || 0) + neededCount * 4;
               } // Thêm các kiểm tra khác nếu cần...
           } else if (itemName === 'glass') {
               needsSmelting[itemName] = neededCount;
                if(bot.inventory.count(mcData.itemsByName['sand']?.id) < neededCount) {
                     baseMaterialsToCollect['sand'] = (baseMaterialsToCollect['sand'] || 0) + neededCount;
                }
                if(bot.inventory.count(mcData.itemsByName['coal']?.id) < neededCount / 8 && bot.inventory.count(mcData.itemsByName['charcoal']?.id) < neededCount / 8) {
                     baseMaterialsToCollect['coal'] = (baseMaterialsToCollect['coal'] || 0) + Math.ceil(neededCount / 8);
                }
           } else {
               // Là nguyên liệu thô còn thiếu -> thêm vào danh sách cần thu thập
               baseMaterialsToCollect[itemName] = (baseMaterialsToCollect[itemName] || 0) + neededCount;
           }
     }


     // Phase 3: Collect missing base materials
     if (Object.keys(baseMaterialsToCollect).length > 0) {
          bot.chat("Tôi cần đi kiếm thêm một số nguyên liệu...");
          console.log("[Res Gather] Vật liệu thô cần thu thập:", baseMaterialsToCollect);

         const collectionOrder = ['_log', 'cobblestone', 'coal', 'sand', 'wool', 'stick']; // Ưu tiên gỗ, đá, than...
         const sortedMaterials = Object.keys(baseMaterialsToCollect).sort((a, b) => {
              const idxA = collectionOrder.findIndex(suffix => a.includes(suffix));
              const idxB = collectionOrder.findIndex(suffix => b.includes(suffix));
              if (idxA !== -1 && idxB !== -1) return idxA - idxB;
              if (idxA !== -1) return -1;
              if (idxB !== -1) return 1;
              return a.localeCompare(b); // Sắp xếp theo tên nếu không có trong danh sách ưu tiên
         });

          for (const baseMat of sortedMaterials) {
              if (bot.buildingTaskDetails?.stopRequested) return { success: false, stillMissing: missing };
              const countNeeded = baseMaterialsToCollect[baseMat];
              const currentHave = bot.inventory.count(mcData.itemsByName[baseMat]?.id || mcData.blocksByName[baseMat]?.id);
              const actualNeeded = countNeeded - currentHave; // Chỉ cần thu thập phần còn thiếu thực sự

              if (actualNeeded > 0) {
                   let collectItemNameForMsg = baseMat.replace(/_/g, ' ');
                   let collectItemId = baseMat; // Giả định tên vật liệu thô là ID tiếng Anh luôn

                   // Cố gắng thu thập
                    bot.chat(`Đang đi kiếm ${Math.ceil(actualNeeded)} ${collectItemNameForMsg}...`);
                    console.log(`[Res Gather] Calling collect for ${Math.ceil(actualNeeded)} ${collectItemId}`);

                   try {
                        const collectionPromise = collectCmd.startCollectingTask(
                             botRef, // Sử dụng botRef đã lưu
                             "System",
                             `thu thập ${Math.ceil(actualNeeded)} ${collectItemId}`,
                             null // AI không cần thiết
                        );
                        // Thêm timeout cho việc thu thập
                         const result = await Promise.race([
                              collectionPromise,
                              new Promise((_, reject) => setTimeout(() => reject(new Error('Collection Timeout')), RESOURCE_GATHER_TIMEOUT))
                         ]);

                        console.log(`[Res Gather] Kết quả thu thập ${collectItemId}:`, result);
                        // Sau khi thu thập xong một loại, cập nhật lại 'missing' list một phần
                        const collectedAmount = result?.finalAmount || bot.inventory.count(mcData.itemsByName[collectItemId]?.id || mcData.blocksByName[collectItemId]?.id);
                        if(collectedAmount < currentHave + actualNeeded) {
                             // Nếu thu thập không đủ
                             bot.chat(`Không kiếm đủ ${collectItemNameForMsg}.`);
                             missing[baseMat] = requiredItems[baseMat] - collectedAmount; // Cập nhật lại số lượng thiếu
                             return { success: false, stillMissing: missing }; // Dừng lại nếu không đủ nguyên liệu cơ bản
                        } else {
                              // Xóa hoặc giảm bớt trong missing nếu đủ
                             if(missing[baseMat] && collectedAmount >= requiredItems[baseMat]){
                                 delete missing[baseMat];
                             } else if (missing[baseMat]) {
                                  missing[baseMat] = requiredItems[baseMat] - collectedAmount;
                             }
                         }

                    } catch (collectError) {
                         console.error(`[Res Gather] Lỗi khi thu thập ${collectItemId}:`, collectError);
                         bot.chat(`Gặp lỗi khi đi kiếm ${collectItemNameForMsg}: ${collectError.message}`);
                          missing[baseMat] = requiredItems[baseMat] - bot.inventory.count(mcData.itemsByName[baseMat]?.id || mcData.blocksByName[baseMat]?.id); // Cập nhật lại số thiếu
                         return { success: false, stillMissing: missing }; // Dừng nếu có lỗi thu thập
                    }
               } else {
                     // Nếu kiểm tra lại thấy đã đủ -> xóa khỏi missing
                      if(missing[baseMat]) delete missing[baseMat];
                }
          }
     }


     // Phase 4: Attempt crafting needed items
    let craftedSomething = false;
    // --- Đảm bảo có Bàn Chế Tạo ---
    const tableId = mcData.itemsByName[houseMaterials.MAT_CRAFTING_TABLE]?.id;
    let tableRef = bot.findBlock({ matching: tableId, maxDistance: 5 });
    if (needsCrafting[houseMaterials.MAT_CRAFTING_TABLE] || (Object.keys(needsCrafting).length > 0 && !tableRef && bot.inventory.count(tableId) === 0)) {
         console.log("[Res Craft] Cần bàn chế tạo...");
         if(bot.inventory.count(tableId) === 0){
              const plankId = mcData.itemsByName[houseMaterials.MAT_WALL]?.id; // Giả sử tường là planks
              if(plankId && bot.inventory.count(plankId) >= 4) {
                    bot.chat("Đang chế bàn chế tạo...");
                    try {
                         await craftCmd.craftItem(botRef, "System", `chế tạo 1 ${houseMaterials.MAT_CRAFTING_TABLE}`, null);
                         console.log("[Res Craft] Chế bàn CT thành công.");
                         if (missing[houseMaterials.MAT_CRAFTING_TABLE]) delete missing[houseMaterials.MAT_CRAFTING_TABLE];
                         craftedSomething = true;
                          await sleep(300); // Chờ inventory update
                         // Cố gắng đặt bàn ra gần đó
                          tableRef = bot.findBlock({ matching: tableId, maxDistance: 5 });
                          if(!tableRef) { /* Logic đặt bàn... (bỏ qua để đơn giản) */ }

                     } catch(craftError) {
                          console.error("[Res Craft] Chế bàn CT thất bại:", craftError);
                          bot.chat("Chế bàn chế tạo thất bại!");
                          if(Object.keys(needsCrafting).length > 0) return { success: false, stillMissing: missing }; // Không thể chế các thứ khác
                     }
               } else {
                    console.error("[Res Craft] Không đủ ván để làm bàn CT.");
                    bot.chat("Không đủ ván làm bàn chế tạo!");
                     return { success: false, stillMissing: missing }; // Lỗi nghiêm trọng
               }
          } else { // Đã có bàn trong túi
                if (missing[houseMaterials.MAT_CRAFTING_TABLE]) delete missing[houseMaterials.MAT_CRAFTING_TABLE];
                if (!tableRef) { /* Logic đặt bàn từ inventory nếu cần... (bỏ qua) */ }
                else { console.log("[Res Craft] Đã có bàn chế tạo gần đó."); }
          }
    }

    // --- Đảm bảo có Lò Nung (nếu cần nấu hoặc thiếu lò) ---
     const furnaceId = mcData.itemsByName[houseMaterials.MAT_FURNACE]?.id;
     const needsFurnaceNow = needsCrafting[houseMaterials.MAT_FURNACE] || Object.keys(needsSmelting).length > 0;
     let furnaceRef = bot.findBlock({ matching: furnaceId, maxDistance: 5});
      if(needsFurnaceNow && !furnaceRef && bot.inventory.count(furnaceId) === 0) {
           console.log("[Res Craft] Cần lò nung...");
           const cobbleId = mcData.itemsByName[houseMaterials.MAT_FOUNDATION]?.id;
            if(cobbleId && bot.inventory.count(cobbleId) >= 8) {
                if (tableRef) { // Cần bàn CT để làm lò
                      bot.chat("Đang chế lò nung...");
                      try{
                            await craftCmd.craftItem(botRef, "System", `chế tạo 1 ${houseMaterials.MAT_FURNACE}`, null);
                           console.log("[Res Craft] Chế lò nung thành công.");
                            if (missing[houseMaterials.MAT_FURNACE]) delete missing[houseMaterials.MAT_FURNACE];
                            craftedSomething = true;
                           await sleep(300);
                            furnaceRef = bot.findBlock({ matching: furnaceId, maxDistance: 5});
                           if(!furnaceRef) { /* Logic đặt lò ... (bỏ qua) */}
                       } catch (craftError) {
                             console.error("[Res Craft] Chế lò nung thất bại:", craftError);
                             bot.chat("Chế lò nung thất bại!");
                             if(Object.keys(needsSmelting).length > 0) return { success: false, stillMissing: missing };
                       }
                 } else {
                       console.error("[Res Craft] Không có bàn CT để làm lò nung.");
                       bot.chat("Không có bàn chế tạo để làm lò nung!");
                       return { success: false, stillMissing: missing };
                 }
            } else {
                 console.error("[Res Craft] Không đủ đá cuội làm lò nung.");
                  bot.chat("Không đủ đá cuội làm lò nung!");
                 return { success: false, stillMissing: missing };
            }
       } else { // Đã có lò hoặc không cần
            if(missing[houseMaterials.MAT_FURNACE]) delete missing[houseMaterials.MAT_FURNACE];
             if(needsFurnaceNow && !furnaceRef) { /* Logic đặt lò từ inventory nếu cần ... (bỏ qua) */}
       }

     // --- Thực hiện Nấu (Smelting) ---
    if (Object.keys(needsSmelting).length > 0) {
         console.warn("[Res Smelt] Yêu cầu nấu chảy chưa được triển khai đầy đủ.");
         bot.chat("Tôi cần nấu một số thứ nhưng chưa biết cách làm!");
         // Tạm thời coi như không nấu được -> báo thiếu
         // Chỉ báo thiếu nếu vật phẩm cần nấu không phải là glass (glass có thể được chế từ glass_pane)
         for(const itemToSmelt in needsSmelting) {
              if(itemToSmelt !== 'glass') potentiallyCraftable = false;
         }
         if (!potentiallyCraftable) {
              return { success: false, stillMissing: missing };
         }
    }

    // --- Thử chế tạo các vật phẩm còn lại ---
     if (tableRef) { // Chỉ chế tạo nếu có bàn
         const craftOrder = ['_planks', 'stick', '_door', 'chest', 'bed', '_stairs', '_slab', '_fence', 'pane']; // Thứ tự chế tạo hợp lý
         const sortedCraftItems = Object.keys(needsCrafting).sort((a, b) => {
              const idxA = craftOrder.findIndex(suffix => a.includes(suffix));
              const idxB = craftOrder.findIndex(suffix => b.includes(suffix));
              if (idxA !== -1 && idxB !== -1) return idxA - idxB;
              if (idxA !== -1) return -1;
              if (idxB !== -1) return 1;
              return a.localeCompare(b);
         });

          for (const itemName of sortedCraftItems) {
              if (bot.buildingTaskDetails?.stopRequested) return { success: false, stillMissing: missing };
               const itemData = mcData.itemsByName[itemName] || mcData.blocksByName[itemName];
               const countNeededToCraft = missing[itemName]; // Số lượng đang thiếu

              if (itemData && countNeededToCraft > 0) {
                   // Kiểm tra nguyên liệu cho món này (Logic kiểm tra chi tiết hơn có thể cần)
                    let canCraft = true; // Giả sử có thể
                    // ... (Thêm logic kiểm tra nguyên liệu cụ thể ở đây) ...

                   if(canCraft) {
                       bot.chat(`Đang chế tạo ${itemName}...`);
                        try {
                              await craftCmd.craftItem(botRef, "System", `chế tạo ${countNeededToCraft} ${itemName}`, null);
                              console.log(`[Res Craft] Chế tạo ${itemName} thành công (yêu cầu ${countNeededToCraft}).`);
                              craftedSomething = true;
                              await sleep(300);
                             const finalHave = bot.inventory.count(itemData.id);
                             if(finalHave >= requiredItems[itemName]){
                                 delete missing[itemName];
                             } else {
                                 missing[itemName] = requiredItems[itemName] - finalHave;
                             }
                         } catch(craftError){
                               console.error(`[Res Craft] Chế tạo ${itemName} thất bại:`, craftError);
                                bot.chat(`Chế tạo ${itemName} thất bại!`);
                               // Không dừng hẳn, có thể thiếu nguyên liệu cho món này nhưng đủ cho món khác
                               potentiallyCraftable = false; // Đánh dấu là có thể không craft được hết
                         }
                    } else {
                         console.log(`[Res Craft] Không đủ nguyên liệu cho ${itemName}.`);
                         potentiallyCraftable = false;
                    }
              } else if (itemData && missing[itemName]) { // Nếu đã có đủ trong lúc chờ / sau khi thu thập
                   delete missing[itemName];
              }
         }
     } else if (Object.keys(needsCrafting).length > 0){
          console.error("[Res Craft] Thiếu bàn chế tạo.");
          potentiallyCraftable = false; // Không thể chế tạo nếu thiếu bàn
     }


     // Final Check
     if (Object.keys(missing).length > 0) {
          let finalMissingMsg = "Tôi vẫn còn thiếu: ";
          finalMissingMsg += Object.entries(missing).map(([name, count]) => `${count} ${name.replace(/_/g, ' ')}`).join(', ');
          bot.chat(finalMissingMsg);
          console.log("[Res Check Final] Vẫn còn thiếu:", missing);
          return { success: false, stillMissing: missing };
     } else {
          bot.chat("OK, có vẻ đủ đồ rồi. Bắt đầu xây dựng thôi!");
          return { success: true, stillMissing: {} };
     }
}


async function findSafePlacementSpot(bot, centerPos, radius = 3, requireSolidBelow = true) {
    for (let r = 1; r <= radius; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (Math.abs(dx) < r && Math.abs(dz) < r) continue; // Chỉ kiểm tra viền ngoài của bán kính

                const checkPos = centerPos.offset(dx, 0, dz);
                const blockAbove = bot.blockAt(checkPos.offset(0, 1, 0));
                const blockAt = bot.blockAt(checkPos);
                const blockBelow = bot.blockAt(checkPos.offset(0, -1, 0));

                if (blockAt && blockAt.name === 'air' && (!blockAbove || blockAbove.name === 'air')) {
                    if (requireSolidBelow) {
                         if (blockBelow && blockBelow.boundingBox === 'block') {
                              return checkPos; // Vị trí tốt: trống ở trên và tại chỗ, rắn ở dưới
                         }
                    } else {
                         return checkPos; // Chỉ cần trống
                    }
                }
            }
        }
    }
    return null; // Không tìm thấy vị trí phù hợp
}

async function gotoNear(bot, targetPos, distance) {
    if (!targetPos) return false;
    if (bot.entity.position.distanceTo(targetPos) <= distance + 0.5) return true;

     const goal = new GoalNear(targetPos.x, targetPos.y, targetPos.z, distance);
    try {
        await bot.pathfinder.goto(goal);
         await sleep(50); // Chờ một chút sau khi đến
        return bot.entity.position.distanceTo(targetPos) <= distance + 1.0; // Nới lỏng kiểm tra sau khi tới
    } catch (err) {
         console.warn(`[Helper] Lỗi pathfinder đến ${formatCoords(targetPos)}: ${err.message.split('\n')[0]}`);
        return bot.entity.position.distanceTo(targetPos) <= distance + 1.5; // Nới lỏng hơn nữa sau lỗi
    }
}

async function safePlace(bot, materialId, targetPos, referenceBlock, faceVector, placeOptions = {}, scaffoldIfNeeded = false) {
    if (!materialId || !targetPos || !referenceBlock || !faceVector || bot.buildingTaskDetails?.stopRequested) return false;

    const materialItem = bot.inventory.findInventoryItem(materialId);
    if (!materialItem) {
         console.warn(`[Place] Thiếu vật liệu: ${mcData.items[materialId]?.name}`);
         bot.chat(`Hết ${mcData.items[materialId]?.displayName} mất rồi!`);
         // Yêu cầu dừng xây dựng nếu hết vật liệu quan trọng
         bot.buildingTaskDetails.stopRequested = true;
         bot.emit('buildTaskError', new Error(`Thiếu vật liệu ${mcData.items[materialId]?.name}`));
         return false;
    }

    const blockAtTarget = bot.blockAt(targetPos);
    if (blockAtTarget && blockAtTarget.type === materialId) return true; // Đã có sẵn
     if (blockAtTarget && blockAtTarget.type !== 0 && !mcData.blocks[blockAtTarget.type]?.canBeReplaced) {
          console.log(`[Place] Vị trí ${formatCoords(targetPos)} đã bị chặn bởi ${blockAtTarget.name}`);
         return false; // Bị chặn bởi khối không thể thay thế
     }


     for (let attempt = 1; attempt <= SAFE_PLACEMENT_RETRIES; attempt++) {
         if (bot.buildingTaskDetails?.stopRequested) return false;

        const canReach = bot.entity.position.distanceTo(targetPos.offset(0.5, 0.5, 0.5)) <= BUILD_REACH;
         if (!canReach) {
              if (!await gotoNear(bot, targetPos, BUILD_REACH - 1.0)) {
                   // Thử bắc giàn giáo nếu không tới được
                   if (scaffoldIfNeeded && attempt === 1) { // Chỉ thử bắc giàn 1 lần
                        console.log(`[Place] Không tới được ${formatCoords(targetPos)}, thử đặt giàn giáo...`);
                       const scaffoldId = mcData.itemsByName[houseMaterials.MAT_SCAFFOLD]?.id;
                       if(scaffoldId && bot.inventory.count(scaffoldId) > 0){
                            let currentPos = bot.entity.position.floored();
                            let targetScaffoldPos = targetPos.offset(0, -1, 0); // Đặt dưới chân vị trí cần xây
                             while(currentPos.distanceTo(targetScaffoldPos) > 2 && currentPos.y < targetScaffoldPos.y + 10){
                                 // Logic tìm đường đi bằng giàn giáo đơn giản...
                                  const nextStep = currentPos.offset(0,1,0); // Đi lên trước
                                  const ref = bot.blockAt(nextStep.offset(0,-1,0));
                                  if (ref && ref.boundingBox === 'block') {
                                       await safePlace(bot, scaffoldId, nextStep, ref, new Vec3(0,1,0), {}, false); // Không đệ quy scaffold
                                      currentPos = nextStep;
                                       await gotoNear(bot, currentPos.offset(0.5,0,0.5), 0.5);
                                       await sleep(100);
                                   } else break; // Không thể đặt lên
                              }
                            // Thử lại gotoNear sau khi đặt giàn giáo
                            if (!await gotoNear(bot, targetPos, BUILD_REACH - 1.0)){
                                 console.warn(`[Place] Vẫn không tới được ${formatCoords(targetPos)} sau khi thử đặt giàn giáo.`);
                                if(attempt === SAFE_PLACEMENT_RETRIES) return false; // Bỏ qua nếu vẫn không tới được
                            }
                       } else {
                            console.warn(`[Place] Không có giàn giáo (${houseMaterials.MAT_SCAFFOLD}) để bắc tới ${formatCoords(targetPos)}.`);
                           if(attempt === SAFE_PLACEMENT_RETRIES) return false; // Bỏ qua
                        }
                   } else {
                         console.warn(`[Place] Không thể đến gần ${formatCoords(targetPos)} để đặt khối (Lần ${attempt})`);
                         if(attempt === SAFE_PLACEMENT_RETRIES) return false;
                         await sleep(300 * attempt);
                         continue; // Thử lại gotoNear
                   }
               }
          }


         try {
              // Trang bị đúng item
             if (!bot.heldItem || bot.heldItem.type !== materialId) {
                 await bot.equip(materialItem, 'hand');
                 await sleep(VERY_SHORT_CHECK_INTERVAL * 2); // Chờ tay đổi
                  if (!bot.heldItem || bot.heldItem.type !== materialId) {
                      console.warn(`[Place] Trang bị ${materialItem.name} nhưng không thành công.`);
                      if(attempt === SAFE_PLACEMENT_RETRIES) return false; // Không trang bị được
                      continue;
                  }
              }

              // Nhìn vào vị trí đặt (chính xác hơn)
              // Thử nhìn vào tâm khối sẽ được đặt
              await bot.lookAt(targetPos.offset(0.5, 0.5, 0.5), true);
             await sleep(50); // Đợi bot quay đầu

              await bot.placeBlock(referenceBlock, faceVector, placeOptions);
              await sleep(150); // Chờ block update server/client

              const placedBlockCheck = bot.blockAt(targetPos);
             if (placedBlockCheck && placedBlockCheck.type === materialId) {
                  // Kiểm tra thêm block state nếu cần (ví dụ: hướng cầu thang)
                  // let stateMatch = true;
                  // if (placeOptions.shape) { ... check block state ... }
                  // if (stateMatch) return true;
                  return true; // Đặt thành công
              } else {
                   console.warn(`[Place] Đã đặt tại ${formatCoords(targetPos)} nhưng kiểm tra lại không thấy khối ${mcData.items[materialId]?.name} (Thấy: ${placedBlockCheck?.name}) (Lần ${attempt})`);
              }

         } catch (e) {
              // Lỗi ECONNRESET hoặc đã bị chặn có thể không phải lỗi nghiêm trọng
              if (!e.message?.includes('ECONNRESET') && !e.message?.includes('blocked')) {
                   console.warn(`[Place] Lỗi khi đặt ${materialItem.name} tại ${formatCoords(targetPos)} (Lần ${attempt}): ${e.message.split('\n')[0]}`);
              }
              // Kiểm tra xem block có tự xuất hiện do lag không
               await sleep(250 * attempt);
               const blockAfterError = bot.blockAt(targetPos);
               if (blockAfterError && blockAfterError.type === materialId) {
                    console.log(`[Place] Block ${materialItem.name} đã xuất hiện sau lỗi đặt.`);
                    return true;
               }
         }
          await sleep(300 * attempt);
     }

     console.error(`[Place] Đặt thất bại ${mcData.items[materialId]?.name} tại ${formatCoords(targetPos)} sau ${SAFE_PLACEMENT_RETRIES} lần.`);
     return false;
}


// --- Main Build Function ---

async function startSurvivalHouseBuild(bot, username) {
    botRef = bot;
     if (!mcData) mcData = require('minecraft-data')(bot.version);

     initializeConstants(); // Dùng kích thước mặc định

    

     bot.isBuilding = true;
     bot.buildingTaskDetails = {
          username,
          type: 'survival_house',
          stage: 'initializing',
          stopRequested: false,
          basePos: null,
          materials: houseMaterials, // Lưu thông số nhà vào task
          requiredResources: null,
          promiseControls: null, // Để chứa resolve/reject cho toàn bộ task xây nhà (nếu cần)
     };
     const task = bot.buildingTaskDetails; // Tham chiếu đến task hiện tại

     console.log(`[Survival House] Bắt đầu xây nhà cho ${username}`);
     bot.chat(`Ok ${username}, tôi sẽ thử xây một ngôi nhà cơ bản. Việc này có thể mất nhiều thời gian và yêu cầu nhiều tài nguyên...`);

    // Tạo một promise bao bọc toàn bộ quá trình xây dựng
     return new Promise(async (resolve, reject) => {
        task.promiseControls = { resolve, reject };

        try {
            // 1. Tính toán & Kiểm tra tài nguyên
             task.stage = 'resource_calculation';
             task.requiredResources = calculateRequiredResources(task.materials);
             console.log("[Survival House] Tài nguyên ước tính cần:", task.requiredResources);

             task.stage = 'resource_gathering';
            const gatherResult = await checkAndGatherResources(botRef, task.requiredResources);

            if (!gatherResult.success) {
                throw new Error(`Thiếu tài nguyên xây nhà. Còn thiếu: ${Object.keys(gatherResult.stillMissing).join(', ')}`);
            }
            bot.chat("Đã kiểm tra xong tài nguyên.");


             // 2. Tìm vị trí
             task.stage = 'finding_location';
             bot.chat("Đang tìm chỗ xây...");
              const requiredWidth = task.materials.HOUSE_WIDTH + FENCE_OFFSET * 2 + 1;
              const requiredDepth = task.materials.HOUSE_DEPTH + FENCE_OFFSET * 2 + 1;
             // Hàm findBuildSite cần được triển khai hoặc đơn giản hóa
              task.basePos = await findBuildSite(botRef, requiredWidth, requiredDepth); // Giả định hàm này tồn tại và trả về Vec3 hoặc null
              if (!task.basePos) {
                   throw new Error("Không tìm thấy vị trí xây dựng phù hợp.");
               }
             bot.chat(`OK, tìm thấy vị trí có vẻ ổn tại ${formatCoords(task.basePos)}. Sẽ bắt đầu xây từ góc đó.`);
             await gotoNear(botRef, task.basePos.offset(task.materials.HOUSE_WIDTH / 2, 0, -2), 5); // Đến gần khu vực


             // Các bước xây dựng (Foundation, Walls, Floor, Roof, etc.)
             const basePos = task.basePos; // Góc tọa độ (x nhỏ nhất, z nhỏ nhất) của nền móng
             const m = task.materials; // Viết tắt cho materials

             // --- XÂY NỀN MÓNG ---
             task.stage = 'building_foundation';
             bot.chat("Bắt đầu làm nền móng...");
              const foundationMatId = mcData.itemsByName[m.MAT_FOUNDATION]?.id;
              if (!foundationMatId) throw new Error(`Không tìm thấy ID cho ${m.MAT_FOUNDATION}`);
             for (let i = 0; i < m.HOUSE_WIDTH; i++) {
                 for (let j = 0; j < m.HOUSE_DEPTH; j++) {
                     if (task.stopRequested) throw new Error("Đã dừng bởi người dùng");
                      const targetPos = basePos.offset(i, -1, j);
                     const refBlock = bot.blockAt(targetPos.offset(0, -1, 0)); // Đặt lên block dưới đất
                      if (!refBlock || refBlock.name === 'air') {
                          // Cố gắng đặt vào khối hiện tại dựa vào hàng xóm nếu nền bị thủng
                           const blockAtTargetFoundation = bot.blockAt(targetPos);
                           if(blockAtTargetFoundation && blockAtTargetFoundation.name === 'air') {
                                let placedFoundation = false;
                                const neighbors = [ {ref: targetPos.offset(-1,0,0), face: new Vec3(1,0,0)}, {ref: targetPos.offset(0,0,-1), face: new Vec3(0,0,1)}];
                                 for(const n of neighbors) {
                                      const neighborBlock = bot.blockAt(n.ref);
                                      if(neighborBlock && neighborBlock.name !== 'air' && neighborBlock.boundingBox === 'block') {
                                           if(await safePlace(bot, foundationMatId, targetPos, neighborBlock, n.face)){ placedFoundation=true; break;}
                                      }
                                 }
                                if (!placedFoundation) console.warn(`Không thể vá nền tại ${formatCoords(targetPos)}`);
                            }
                           continue; // Bỏ qua nếu không có nền cứng bên dưới
                       }
                     await safePlace(bot, foundationMatId, targetPos, refBlock, new Vec3(0, 1, 0));
                  }
             }

             // --- XÂY TƯỜNG ---
              const wallMatId = mcData.itemsByName[m.MAT_WALL]?.id;
              const windowMatId = mcData.itemsByName[m.MAT_WINDOW]?.id;
              const doorMatId = mcData.itemsByName[m.MAT_DOOR]?.id;
             if (!wallMatId || !windowMatId || !doorMatId) throw new Error("Không tìm thấy ID vật liệu tường/cửa sổ/cửa.");
              const doorPlacePos = basePos.offset(Math.floor(m.HOUSE_WIDTH / 2), 0, -1); // Vị trí đặt cửa (tham chiếu block nền)

              for (let f = 0; f < m.TOTAL_FLOORS; f++) {
                   task.stage = `building_walls_floor_${f+1}`;
                   bot.chat(`Xây tường tầng ${f+1}...`);
                   const floorBaseY = f * (m.HOUSE_HEIGHT_PER_FLOOR + 1); // Y của sàn tầng này

                   for (let y = 0; y < m.HOUSE_HEIGHT_PER_FLOOR; y++) {
                        const currentY = floorBaseY + y;
                       console.log(`[Build Wall] Tầng ${f+1}, lớp Y=${currentY}`);
                       for (let i = 0; i < m.HOUSE_WIDTH; i++) {
                           for (let j = 0; j < m.HOUSE_DEPTH; j++) {
                               if (task.stopRequested) throw new Error("Đã dừng bởi người dùng");
                                // Chỉ xây viền tường ngoài
                               if (i > 0 && i < m.HOUSE_WIDTH - 1 && j > 0 && j < m.HOUSE_DEPTH - 1) continue;

                               const targetPos = basePos.offset(i, currentY, j);
                               const refBlock = bot.blockAt(targetPos.offset(0, -1, 0)); // Tham chiếu là khối ngay dưới nó

                               // Bỏ qua vị trí cửa (tầng 1, y=0 và y=1)
                               if (f === 0 && y < 2 && i === Math.floor(m.HOUSE_WIDTH / 2) && j === 0) {
                                   continue;
                               }

                                let materialToPlace = wallMatId;
                                // Xác định vị trí cửa sổ
                               if (y === 1 && windowMatId) { // Cửa sổ thường ở y=1
                                    if (j===0 && i > 0 && i < m.HOUSE_WIDTH-1 && i%2 === 0) materialToPlace = windowMatId; // Tường trước
                                     else if (j===m.HOUSE_DEPTH-1 && i > 0 && i < m.HOUSE_WIDTH-1 && i%2 === 0) materialToPlace = windowMatId; // Tường sau
                                     else if (i===0 && j > 0 && j < m.HOUSE_DEPTH-1 && j%3 === 1) materialToPlace = windowMatId; // Tường trái
                                     else if (i===m.HOUSE_WIDTH-1 && j > 0 && j < m.HOUSE_DEPTH-1 && j%3 === 1) materialToPlace = windowMatId; // Tường phải
                               }

                               if (refBlock && refBlock.boundingBox === 'block') {
                                     // Cần bắc giàn giáo nếu xây tầng cao
                                    const needScaffold = currentY > basePos.y + 1;
                                    if (!await safePlace(bot, materialToPlace, targetPos, refBlock, new Vec3(0, 1, 0), {}, needScaffold)) {
                                          console.warn(`Đặt tường thất bại tại ${formatCoords(targetPos)}`);
                                          // Có thể cần xử lý lỗi nghiêm trọng hơn ở đây
                                     }
                                } else if (currentY > basePos.y -1) { // Chỉ log lỗi nếu không phải đang xây nền
                                     console.warn(`Thiếu tham chiếu dưới cho tường tại ${formatCoords(targetPos)} (Ref: ${refBlock?.name})`);
                                }
                            }
                       }
                       await sleep(100); // Nghỉ giữa các lớp tường
                  }

                 // Xây sàn tầng trên (nếu chưa phải tầng cuối)
                 if (f < m.TOTAL_FLOORS - 1) {
                      task.stage = `building_floor_${f+2}`;
                      bot.chat(`Xây sàn tầng ${f+2}...`);
                      const floorY = floorBaseY + m.HOUSE_HEIGHT_PER_FLOOR;
                      const floorMatId = mcData.itemsByName[m.MAT_FLOOR]?.id;
                     if(!floorMatId) throw new Error(`Không tìm thấy ID cho ${m.MAT_FLOOR}`);
                      for (let i = 0; i < m.HOUSE_WIDTH; i++) {
                          for (let j = 0; j < m.HOUSE_DEPTH; j++) {
                              if (task.stopRequested) throw new Error("Đã dừng bởi người dùng");
                              // Chừa lỗ cầu thang (Ví dụ: góc nhà)
                              // if (i >= m.HOUSE_WIDTH - 2 && j >= m.HOUSE_DEPTH - 2) continue;
                              const targetPos = basePos.offset(i, floorY, j);
                              const refBlock = bot.blockAt(targetPos.offset(0, -1, 0)); // Tham chiếu tường tầng dưới
                               if(refBlock && refBlock.boundingBox === 'block'){
                                   await safePlace(bot, floorMatId, targetPos, refBlock, new Vec3(0,1,0));
                               } else {
                                    // Thử đặt dựa vào khối sàn bên cạnh
                                   let placedFloor = false;
                                   const neighbors = [{ref: targetPos.offset(-1,0,0), face: new Vec3(1,0,0)}, {ref: targetPos.offset(0,0,-1), face: new Vec3(0,0,1)}];
                                   for(const n of neighbors){
                                        const nBlock = bot.blockAt(n.ref);
                                        if(nBlock && nBlock.type === floorMatId){
                                            if(await safePlace(bot, floorMatId, targetPos, nBlock, n.face)){placedFloor = true; break;}
                                        }
                                    }
                                   if (!placedFloor) console.warn(`Thiếu tham chiếu cho sàn tại ${formatCoords(targetPos)}`);
                               }
                           }
                      }
                 }
             }


            // --- XÂY MÁI ---
             task.stage = 'building_roof';
             bot.chat("Bắt đầu lợp mái...");
              const roofBaseY = (m.TOTAL_FLOORS * (m.HOUSE_HEIGHT_PER_FLOOR + 1)) - 1; // Y của lớp tường cuối cùng
              const roofMatId = mcData.itemsByName[m.MAT_ROOF]?.id; // Stairs
              const roofEdgeMatId = mcData.itemsByName[m.MAT_ROOF_EDGE]?.id; // Slabs
              if (!roofMatId || !roofEdgeMatId) throw new Error("Không tìm thấy ID vật liệu mái.");

              // Mái dốc đơn giản hai bên theo chiều rộng (Width)
              const roofLevels = Math.ceil(m.HOUSE_WIDTH / 2);
              for (let level = 0; level < roofLevels; level++) {
                   const currentRoofY = roofBaseY + level + 1; // Y của lớp mái hiện tại
                  const x1 = level; // Vị trí X bên trái
                  const x2 = m.HOUSE_WIDTH - 1 - level; // Vị trí X bên phải

                  for (let j = -1; j <= m.HOUSE_DEPTH; j++) { // Chạy dọc chiều sâu, bao gồm diềm mái
                       if (task.stopRequested) throw new Error("Đã dừng bởi người dùng");

                        // --- Đặt mái bên trái ---
                       const targetPosLeft = basePos.offset(x1, currentRoofY, j);
                       const refBlockLeft = bot.blockAt(targetPosLeft.offset(0, -1, 0)); // Tham chiếu dưới nó
                        if (refBlockLeft && refBlockLeft.boundingBox === 'block') {
                            // shape: thẳng, half: bottom, facing: +X (quay mặt sang phải)
                            const placeOpts = { half: 'bottom', shape: 'straight', facing: 'east' };
                           await safePlace(bot, roofMatId, targetPosLeft, refBlockLeft, new Vec3(0, 1, 0), placeOpts, true);
                       } else if (level > 0 || j === -1 || j === m.HOUSE_DEPTH){ // Thử đặt dựa vào hàng xóm nếu không có block dưới (cho diềm/lớp trên)
                            let placedLeft = false;
                            const neighborsLeft = [{ref: targetPosLeft.offset(-1,0,0), face: new Vec3(1,0,0)}, {ref: targetPosLeft.offset(0,0,-1), face: new Vec3(0,0,1)}];
                            for(const n of neighborsLeft){
                               const nBlock = bot.blockAt(n.ref);
                               if(nBlock?.name.includes('stairs') || nBlock?.name.includes('slab')){ // Đặt cạnh mái khác
                                     if(await safePlace(bot, roofMatId, targetPosLeft, nBlock, n.face, { half: 'bottom', shape: 'straight', facing: 'east' }, true)){placedLeft = true; break;}
                               }
                           }
                          if(!placedLeft) console.warn(`Không có tham chiếu cho mái trái tại ${formatCoords(targetPosLeft)}`);
                        }

                        // --- Đặt mái bên phải (tránh đặt trùng nếu width lẻ) ---
                        if (x1 < x2) {
                           const targetPosRight = basePos.offset(x2, currentRoofY, j);
                           const refBlockRight = bot.blockAt(targetPosRight.offset(0, -1, 0));
                            if (refBlockRight && refBlockRight.boundingBox === 'block') {
                                // shape: thẳng, half: bottom, facing: -X (quay mặt sang trái)
                               const placeOpts = { half: 'bottom', shape: 'straight', facing: 'west' };
                                await safePlace(bot, roofMatId, targetPosRight, refBlockRight, new Vec3(0, 1, 0), placeOpts, true);
                            } else if (level > 0 || j === -1 || j === m.HOUSE_DEPTH) {
                                 let placedRight = false;
                                 const neighborsRight = [{ref: targetPosRight.offset(1,0,0), face: new Vec3(-1,0,0)}, {ref: targetPosRight.offset(0,0,-1), face: new Vec3(0,0,1)}];
                                 for(const n of neighborsRight){
                                     const nBlock = bot.blockAt(n.ref);
                                    if(nBlock?.name.includes('stairs') || nBlock?.name.includes('slab')){
                                        if(await safePlace(bot, roofMatId, targetPosRight, nBlock, n.face, { half: 'bottom', shape: 'straight', facing: 'west' }, true)){placedRight = true; break;}
                                    }
                                }
                               if(!placedRight) console.warn(`Không có tham chiếu cho mái phải tại ${formatCoords(targetPosRight)}`);
                            }
                        }
                    }
                  await sleep(100); // Nghỉ giữa các lớp mái
               }

            // Đặt nóc mái (slab)
            if (m.HOUSE_WIDTH % 2 !== 0) { // Chỉ cần nếu chiều rộng lẻ
                const topX = Math.floor(m.HOUSE_WIDTH / 2);
                const topY = roofBaseY + roofLevels + 1;
                 for(let j = -1; j <= m.HOUSE_DEPTH; j++){
                      if (task.stopRequested) throw new Error("Đã dừng bởi người dùng");
                      const targetPosTop = basePos.offset(topX, topY, j);
                      const refBlockTop = bot.blockAt(targetPosTop.offset(0,-1,0));
                      if (refBlockTop && refBlockTop.name.includes('stairs')){ // Đặt lên lớp cầu thang cuối
                            await safePlace(bot, roofEdgeMatId, targetPosTop, refBlockTop, new Vec3(0,1,0), {type: 'bottom'}, true);
                      } else {
                          console.warn(`Không có tham chiếu cho nóc mái tại ${formatCoords(targetPosTop)}`);
                      }
                 }
             }


             // --- ĐẶT CỬA ---
             task.stage = 'placing_door';
             bot.chat("Đặt cửa chính...");
             const doorItem = bot.inventory.findInventoryItem(doorMatId);
             const doorTargetPos = basePos.offset(Math.floor(m.HOUSE_WIDTH / 2), 0, 0); // Vị trí không khí nơi cửa sẽ đứng
             const doorRefBlockActual = bot.blockAt(doorTargetPos.offset(0, -1, 0)); // Khối nền dưới cửa
              if(doorItem && doorRefBlockActual && doorRefBlockActual.boundingBox === 'block') {
                    if(await gotoNear(botRef, doorTargetPos.offset(0.5, 0, -1.5), BUILD_REACH -1)) { // Đứng ngoài nhìn vào
                          try {
                              await bot.equip(doorItem, 'hand');
                               await bot.lookAt(doorTargetPos.offset(0.5, 0.5, 0.5), true);
                               await sleep(150);
                               // Metadata/State cho cửa Oak quay mặt Nam (z+) khi đặt từ phía Bắc (z-)
                               // Facing=south, hinge=left, open=false, powered=false, half=lower
                              await bot.placeBlock(doorRefBlockActual, new Vec3(0,1,0), { facing: 'south', hinge: 'left'});
                              console.log(`[Build] Đã đặt cửa tại ${formatCoords(doorTargetPos)}`);
                               await sleep(200); // Chờ cửa update (2 block)
                          } catch(e){ console.error(`Lỗi đặt cửa: ${e.message}`); }
                    } else { console.warn("Không đến gần được để đặt cửa."); }
              } else { console.warn("Không tìm thấy cửa hoặc vị trí đặt cửa không phù hợp."); }


             // --- NỘI THẤT ---
             task.stage = 'interior_furnishing';
             bot.chat("Đặt một vài đồ đạc cơ bản...");
             const interiorY = basePos.y; // Đặt trên nền tầng 1
             // ... (Logic đặt Bàn CT, Lò, Rương tương tự dùng safePlace với refBlock là nền nhà)
              await placeInteriorItem(m.MAT_CRAFTING_TABLE, INTERIOR_ITEMS_POS.crafting_table, interiorY);
              await placeInteriorItem(m.MAT_FURNACE, INTERIOR_ITEMS_POS.furnace1, interiorY);
              await placeInteriorItem(m.MAT_FURNACE, INTERIOR_ITEMS_POS.furnace2, interiorY);
              await placeInteriorItem(m.MAT_CHEST, INTERIOR_ITEMS_POS.chest1, interiorY);
              await placeInteriorItem(m.MAT_CHEST, INTERIOR_ITEMS_POS.chest2, interiorY);

              // Đặt giường
              const bedHeadPos = basePos.offset(INTERIOR_ITEMS_POS.bed_head.x, interiorY, INTERIOR_ITEMS_POS.bed_head.z);
              const bedFootPos = bedHeadPos.offset(1,0,0); // Giả sử giường đặt dọc theo trục X
              const bedMatId = mcData.itemsByName[m.MAT_BED]?.id;
              const bedItem = bedMatId ? bot.inventory.findInventoryItem(bedMatId) : null;
              const bedRefBlock = bot.blockAt(bedHeadPos.offset(0,-1,0));
               if(bedItem && bedRefBlock?.boundingBox === 'block' && bot.blockAt(bedHeadPos)?.name === 'air' && bot.blockAt(bedFootPos)?.name === 'air'){
                   if(await gotoNear(botRef, bedHeadPos.offset(0, 0.5, -1), BUILD_REACH -1)){ // Đứng phía trước giường
                        try {
                            await bot.equip(bedItem, 'hand');
                             // Nhìn về hướng chân giường (footPos) khi đặt ở đầu (headPos) -> quay mặt east (+X)
                            await bot.lookAt(bedFootPos.offset(0.5, 0.5, 0.5), true);
                             await sleep(150);
                             // State: facing=east, part=head
                            await bot.placeBlock(bedRefBlock, new Vec3(0,1,0), {facing: 'east', part: 'head'});
                            console.log(`[Build] Đã đặt giường tại ${formatCoords(bedHeadPos)}`);
                            await sleep(200);
                        } catch(e){ console.error(`Lỗi đặt giường: ${e.message}`);}
                   }
               } else { console.warn("Không thể đặt giường (thiếu item, vật cản hoặc nền).");}

               // Đặt đuốc
               const torchMatId = mcData.itemsByName[m.MAT_TORCH]?.id;
               if (torchMatId) {
                    const torchItem = bot.inventory.findInventoryItem(torchMatId);
                   if(torchItem && torchItem.count >= TORCH_POSITIONS_RELATIVE.length) {
                       for (const posRel of TORCH_POSITIONS_RELATIVE) {
                            if(task.stopRequested) break;
                            const torchTargetPos = basePos.offset(posRel.x, posRel.y, posRel.z);
                            // Xác định tường để gắn đuốc
                             let torchRefBlock = null;
                             let faceVec = null;
                             const possibleRefs = [
                                  { block: bot.blockAt(torchTargetPos.offset(0,0,-1)), face: new Vec3(0,0,1) }, // Tường phía sau (Bắc)
                                  { block: bot.blockAt(torchTargetPos.offset(0,0,1)), face: new Vec3(0,0,-1) }, // Tường phía trước (Nam)
                                  { block: bot.blockAt(torchTargetPos.offset(-1,0,0)), face: new Vec3(1,0,0) }, // Tường bên trái (Tây)
                                  { block: bot.blockAt(torchTargetPos.offset(1,0,0)), face: new Vec3(-1,0,0) }, // Tường bên phải (Đông)
                                 // { block: bot.blockAt(torchTargetPos.offset(0,-1,0)), face: new Vec3(0,1,0) }, // Đặt trên sàn? (Ít phổ biến)
                             ];
                            for (const pRef of possibleRefs) {
                                 if(pRef.block && pRef.block.boundingBox === 'block') {
                                      torchRefBlock = pRef.block;
                                      faceVec = pRef.face;
                                      break;
                                 }
                            }

                           if(torchRefBlock && faceVec && bot.blockAt(torchTargetPos)?.name === 'air') {
                               await safePlace(bot, torchMatId, torchTargetPos, torchRefBlock, faceVec);
                           } else { console.warn(`Không tìm thấy tường phù hợp để đặt đuốc tại ~${formatCoords(posRel)}`); }
                       }
                   } else { console.warn(`Không đủ đuốc (${torchItem?.count || 0}/${TORCH_POSITIONS_RELATIVE.length}).`); }
               }


             // --- HÀNG RÀO & CHUỒNG ---
             // ... (Tương tự logic xây tường nhưng dùng fence/gate và y = basePos.y)
             task.stage = 'building_fence_pen';
              bot.chat("Xây hàng rào và chuồng...");
              // ... Code xây hàng rào và chuồng thú tương tự, dùng MAT_FENCE và MAT_GATE ...
              await buildFenceAndPen(basePos, m);


             // --- HOÀN THÀNH ---
             task.stage = 'done';
             bot.chat(`${username}, tôi đã cố gắng xây xong ngôi nhà! Mời bạn kiểm tra.`);
              console.log("[Survival House] Nhiệm vụ xây nhà hoàn thành.");
             // Resolve promise báo thành công
             if (task.promiseControls?.resolve) task.promiseControls.resolve({ success: true, message: "Xây nhà hoàn thành." });

         } catch (error) {
             console.error("[Survival House] Lỗi nghiêm trọng trong quá trình xây:", error);
             bot.chat(`Xin lỗi ${username}, tôi gặp lỗi khi đang xây nhà (${task.stage}): ${error.message}`);
              task.stage = 'failed';
             // Reject promise báo lỗi
              if (task.promiseControls?.reject) task.promiseControls.reject(error);

         } finally {
              bot.isBuilding = false;
              bot.buildingTaskDetails = null;
              console.log("[Survival House] Kết thúc nhiệm vụ.");
              try { if (botRef.pathfinder?.isMoving()) botRef.pathfinder.stop(); botRef.pathfinder?.setGoal(null); } catch(e) {}
              // Giải phóng tham chiếu resolve/reject nếu có
               if(task && task.promiseControls){ task.promiseControls = null; }
          }
     }); // Kết thúc Promise bao bọc
}

// Hàm helper để đặt nội thất
async function placeInteriorItem(itemIdStr, posRel, floorY) {
    if (botRef.buildingTaskDetails?.stopRequested) return;
    const itemId = mcData.itemsByName[itemIdStr]?.id;
    if (!itemId) { console.warn(`Không tìm thấy ID cho nội thất: ${itemIdStr}`); return; }
    const targetPos = botRef.buildingTaskDetails.basePos.offset(posRel.x, floorY, posRel.z);
    const refBlock = botRef.blockAt(targetPos.offset(0,-1,0));
    if (refBlock && refBlock.boundingBox === 'block') {
         if (await safePlace(botRef, itemId, targetPos, refBlock, new Vec3(0,1,0))){
             //console.log(`Đặt ${itemIdStr} thành công.`);
         } else {
             console.warn(`Đặt nội thất ${itemIdStr} thất bại tại ${formatCoords(targetPos)}.`);
         }
    } else {
         console.warn(`Không có nền đặt nội thất ${itemIdStr} tại ${formatCoords(targetPos.offset(0,-1,0))}`);
    }
    await sleep(50); // Chờ chút giữa các món đồ
}

// Hàm helper xây hàng rào và chuồng
async function buildFenceAndPen(basePos, m){
    const fenceMatId = mcData.itemsByName[m.MAT_FENCE].id;
    const gateMatId = mcData.itemsByName[m.MAT_GATE].id;
     if (!fenceMatId || !gateMatId) { console.error("Không tìm thấy ID hàng rào/cổng"); return;}

    const fenceY = basePos.y; // Cùng độ cao với nền nhà

    // Xây hàng rào quanh nhà
    const fenceMinX = basePos.x - FENCE_OFFSET;
    const fenceMaxX = basePos.x + m.HOUSE_WIDTH - 1 + FENCE_OFFSET;
    const fenceMinZ = basePos.z - FENCE_OFFSET;
    const fenceMaxZ = basePos.z + m.HOUSE_DEPTH - 1 + FENCE_OFFSET;
    const houseGatePosX = basePos.x + Math.floor(m.HOUSE_WIDTH / 2);
    const houseGatePosZ = fenceMinZ; // Cổng ở mặt trước

    for (let x = fenceMinX; x <= fenceMaxX; x++) {
        for (let z = fenceMinZ; z <= fenceMaxZ; z++) {
            if (botRef.buildingTaskDetails?.stopRequested) return;
            if (x === fenceMinX || x === fenceMaxX || z === fenceMinZ || z === fenceMaxZ) {
                 const targetPos = new Vec3(x, fenceY, z);
                 const isGate = (x === houseGatePosX && z === houseGatePosZ);
                 const matId = isGate ? gateMatId : fenceMatId;
                 const refBlock = botRef.blockAt(targetPos.offset(0, -1, 0));
                if (refBlock && refBlock.boundingBox === 'block') {
                     // Cổng có thể cần facing='south' nếu đặt từ bắc vào
                    const opts = isGate ? {facing: 'south'} : {};
                     await safePlace(botRef, matId, targetPos, refBlock, new Vec3(0, 1, 0), opts);
                 } else { console.warn(`Thiếu nền rào tại ${formatCoords(targetPos)}`); }
            }
        }
    }
    await sleep(100);

    // Xây chuồng
     const penBaseX = basePos.x + m.HOUSE_WIDTH + FENCE_OFFSET ; // Đặt bên phải nhà
     const penBaseZ = basePos.z;
     const penGateX = penBaseX + Math.floor(PEN_SIZE/2);
     const penGateZ = penBaseZ -1; // Cổng quay ra ngoài

    for(let i = 0; i < PEN_SIZE; i++){
        for (let j = 0; j < PEN_SIZE; j++) {
            if (botRef.buildingTaskDetails?.stopRequested) return;
             if (i === 0 || i === PEN_SIZE - 1 || j === 0 || j === PEN_SIZE - 1) {
                 const targetPos = new Vec3(penBaseX + i, fenceY, penBaseZ + j);
                  const isGate = (i === Math.floor(PEN_SIZE / 2) && j === 0); // Cổng ở mặt gần nhà
                 const matId = isGate ? gateMatId : fenceMatId;
                  const refBlock = botRef.blockAt(targetPos.offset(0,-1,0));
                  if (refBlock && refBlock.boundingBox === 'block') {
                       const opts = isGate ? {facing: 'north'} : {}; // Cổng quay về phía bắc
                      await safePlace(botRef, matId, targetPos, refBlock, new Vec3(0, 1, 0), opts);
                  } else { console.warn(`Thiếu nền chuồng tại ${formatCoords(targetPos)}`); }
              }
         }
    }
    bot.chat("Xây hàng rào và chuồng xong.");
}

// --- Helper Find Build Site (Simplified) ---
async function findBuildSite(bot, width, depth, maxDistance = 64) {
     console.log(`Đang tìm khu vực ${width}x${depth} để xây...`);
     const center = bot.entity.position;
     const checkRadius = maxDistance / 2;

    let bestSite = null;
     let minVariance = Infinity;

    // Quét theo vòng tròn xoắn ốc
    for(let r = 5; r < checkRadius; r += 5) {
         for (let dx = -r; dx <= r; dx += 5){
              for (let dz = -r; dz <= r; dz += 5){
                   if (Math.abs(dx) < r && Math.abs(dz) < r) continue; // Chỉ kiểm tra viền

                    const cornerPos = center.offset(dx, 0, dz).floored();
                    // Kiểm tra độ phẳng tại khu vực này
                   let heights = [];
                   let obstacles = 0;
                   let canBuild = true;
                    for (let i = 0; i < width; i++){
                        for (let j = 0; j < depth; j++){
                             const checkPos = cornerPos.offset(i, 0, j);
                             const blockAt = bot.blockAt(checkPos);
                              const blockBelow = bot.blockAt(checkPos.offset(0,-1,0));
                             if (!blockBelow || blockBelow.name === 'air') { // Không có nền?
                                   canBuild = false; break;
                             }
                              heights.push(checkPos.y); // Ghi nhận y của block *có nền*
                             if(blockAt && blockAt.name !== 'air' && !mcData.blocks[blockAt.type]?.canBeReplaced){
                                 obstacles++; // Có vật cản không khí?
                             }
                              // Kiểm tra block dưới nước/lava? (Tạm bỏ qua)
                         }
                         if (!canBuild) break;
                    }

                    if(canBuild && heights.length === width * depth && obstacles < 5){ // Đủ điểm, ít vật cản
                          const avgHeight = heights.reduce((a,b) => a+b, 0) / heights.length;
                         const variance = heights.reduce((a,b) => a + Math.abs(b - avgHeight), 0) / heights.length;
                          if(variance < minVariance && variance < 0.5){ // Tìm nơi phẳng nhất (độ lệch dưới 0.5 block)
                              minVariance = variance;
                              bestSite = cornerPos.offset(0, Math.round(avgHeight) - cornerPos.y, 0); // Chọn Y trung bình
                          }
                     }
                     await sleep(10); // Giảm tải CPU
               }
                if (bestSite) break; // Dừng nếu tìm thấy chỗ khá tốt ở bán kính gần
          }
          if (bestSite) break; // Dừng vòng lặp bán kính
      }

      if (bestSite) {
           console.log(`Tìm thấy vị trí tiềm năng tại ${formatCoords(bestSite)} với độ phẳng ${minVariance.toFixed(2)}`);
       } else {
           console.warn("Không tìm thấy vị trí đủ lớn và phẳng.");
       }
      return bestSite; // Trả về Vec3 hoặc null
 }


function stopBuilding(bot, username){
     if (bot.isBuilding && bot.buildingTaskDetails) {
          bot.buildingTaskDetails.stopRequested = true;
          console.log(`[Build Stop] User ${username} yêu cầu dừng xây dựng.`);
          bot.chat("Ok, dừng xây dựng theo yêu cầu.");
           // Promise sẽ tự reject trong vòng lặp xây dựng hoặc khi checkAndGatherResources
      } else {
          console.log(`[Build Stop] User ${username} yêu cầu dừng nhưng không đang xây.`);
          bot.chat("Tôi đâu có đang xây gì đâu?");
      }
 }


module.exports = {
    startSurvivalHouseBuild,
    stopBuilding,
};
// --- END OF FILE commands/home.js ---