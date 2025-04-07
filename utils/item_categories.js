// --- START OF FILE utils/item_categories.js ---

/**
 * Phân loại vật phẩm Minecraft vào các danh mục chi tiết hơn.
 * Mục tiêu: Cung cấp cách phân loại đủ chi tiết cho việc lọc và sắp xếp kho đồ.
 * Một vật phẩm có thể được xem xét thuộc nhiều nhóm (vd: rìu là tool & weapon),
 * nhưng hàm này chỉ trả về MỘT danh mục chính xác nhất/ưu tiên nhất.
 * Logic ưu tiên: Cụ thể -> Chung chung.
 */

// Helper functions (có thể tối ưu bằng regex nếu cần)
const nameIncludes = (itemName, patterns) => patterns.some(p => itemName.includes(p));
const nameEndsWith = (itemName, suffixes) => suffixes.some(s => itemName.endsWith(s));
const nameStartsWith = (itemName, prefixes) => prefixes.some(p => itemName.startsWith(p));
const nameEquals = (itemName, names) => names.some(n => itemName === n);

function getItemCategory(item) {
    // Luôn kiểm tra item và item.name trước
    if (!item || typeof item.name !== 'string' || item.name === '') return 'unknown';
    const name = item.name.toLowerCase(); // Chuẩn hóa tên về chữ thường

    // --- Danh mục Ưu tiên Cao (Rất cụ thể) ---
    if (nameEndsWith(name, ['_spawn_egg'])) return 'spawn_egg';
    if (nameStartsWith(name, ['music_disc_'])) return 'music_disc';
    if (nameEndsWith(name, ['_banner_pattern'])) return 'banner_pattern';
    if (nameEquals(name, ['enchanted_golden_apple'])) return 'food_cooked_special'; // Ưu tiên Gapple Enchanted
    if (nameEquals(name, ['nether_star', 'dragon_egg', 'dragon_head'])) return 'trophy_rare'; // Vật phẩm đặc biệt, hiếm
    if (nameEquals(name, ['elytra', 'trident', 'shield'])) return 'equipment_special'; // Trang bị đặc biệt
    if (nameEquals(name, ['totem_of_undying'])) return 'magic_utility';
    if (nameEquals(name, ['heart_of_the_sea', 'nautilus_shell'])) return 'magic_component'; // Nguyên liệu chế tạo conduit
    if (nameEquals(name, ['experience_bottle'])) return 'magic_utility';
    if (nameEquals(name, ['debug_stick'])) return 'special_debug'; // Công cụ debug đặc biệt

    // --- Vũ khí (Weapons) ---
    if (nameEndsWith(name, ['_sword', 'trident'])) return 'weapon_melee'; // Trident cũng tính là melee? Có thể tách riêng.
    if (nameEquals(name, ['bow', 'crossbow'])) return 'weapon_ranged';
    if (nameEndsWith(name, ['arrow', 'tipped_arrow', 'spectral_arrow'])) return 'ammo';

    // --- Công cụ (Tools) ---
    if (nameEndsWith(name, ['_pickaxe', '_shovel', '_hoe'])) return 'tool_mining_farming';
    if (nameEquals(name, ['shears', 'brush'])) return 'tool_utility';
    if (nameEquals(name, ['flint_and_steel', 'fire_charge'])) return 'tool_fire';
    if (nameEquals(name, ['fishing_rod'])) return 'tool_fishing';
    if (nameEquals(name, ['spyglass', 'compass', 'clock', 'recovery_compass'])) return 'tool_navigation';
    if (nameEquals(name, ['lead', 'name_tag'])) return 'tool_mob_interaction';

    // --- Rìu (Tool & Weapon) ---
    if (nameEndsWith(name, ['_axe'])) return 'tool_weapon_axe'; // Tách riêng rìu nếu cần phân biệt rõ

    // --- Giáp (Armor) ---
    if (nameEndsWith(name, ['_helmet', '_chestplate', '_leggings', '_boots'])) return 'armor';
    if (nameEquals(name, ['turtle_helmet'])) return 'armor'; // Giáp đặc biệt
    if (nameEndsWith(name, ['_horse_armor'])) return 'armor_horse';

    // --- Thức ăn (Food) ---
    // Ưu tiên đồ ăn chế biến/đặc biệt
    if (nameStartsWith(name, ['cooked_']) || nameEquals(name, ['bread', 'cake', 'cookie', 'pumpkin_pie', 'mushroom_stew', 'rabbit_stew', 'beetroot_soup', 'suspicious_stew', 'baked_potato', 'golden_apple', 'honey_bottle', 'glow_berries'])) return 'food_cooked_special';
    // Đồ ăn đơn giản/nguyên liệu
    if (nameEquals(name, ['apple', 'beef', 'porkchop', 'chicken', 'rabbit', 'mutton', 'cod', 'salmon', 'tropical_fish', 'melon_slice', 'sweet_berries', 'carrot', 'potato', 'beetroot', 'chorus_fruit'])) return 'food_raw_simple';
    // Đồ ăn có thể gây hại
    if (nameEquals(name, ['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish'])) return 'food_harmful'; // Pufferfish cũng dùng pha thuốc

    // --- Thuốc & Phép thuật (Potions & Magic) ---
    if (nameIncludes(name, ['potion', 'splash_potion', 'lingering_potion'])) return 'potion';
    if (nameEquals(name, ['glass_bottle'])) return 'potion_ingredient'; // Chai rỗng
    if (nameEquals(name, ['dragon_breath', 'ghast_tear', 'phantom_membrane', 'fermented_spider_eye', 'blaze_powder', 'magma_cream', 'glistering_melon_slice', 'golden_carrot', 'rabbit_foot', 'pufferfish', 'sugar', 'redstone', 'glowstone_dust', 'gunpowder', 'nether_wart'])) return 'potion_ingredient'; // Nguyên liệu pha thuốc (một số có thể thuộc nhóm khác nữa)

    // --- Nông nghiệp & Cây trồng (Farming & Crops) ---
    if (nameEndsWith(name, ['_seeds', '_sapling', 'propagule'])) return 'farming_seed_sapling';
    if (nameEquals(name, ['wheat', 'carrot', 'potato', 'beetroot', 'pumpkin', 'melon', 'sugar_cane', 'cocoa_beans', 'nether_wart', 'cactus', 'bamboo', 'kelp', 'sea_pickle', 'glow_berries', 'sweet_berries'])) return 'farming_crop_product'; // Sản phẩm cây trồng (một số là food)
    if (nameEquals(name, ['bone_meal'])) return 'farming_utility';
    if (nameEquals(name, ['hay_block', 'dried_kelp_block'])) return 'farming_storage'; // Khối lưu trữ nông sản

    // --- Mob Drops ---
    // Từ farm thụ động (gà, bò, cừu, thỏ...)
    if (nameEquals(name, ['egg', 'feather', 'leather', 'rabbit_hide', 'ink_sac', 'glow_ink_sac', 'wool', 'scute'])) return 'farming_mob_drop'; // Wool cũng có thể từ farm -> để đây
    // Từ mob thù địch (phổ biến)
    if (nameEquals(name, ['bone', 'string', 'gunpowder', 'slime_ball', 'rotten_flesh', 'spider_eye'])) return 'hostile_mob_drop';
    // Từ mob đặc biệt/hiếm/hữu ích
    if (nameEquals(name, ['ender_pearl', 'blaze_rod', 'ghast_tear', 'phantom_membrane', 'shulker_shell', 'magma_cream', 'rabbit_foot'])) return 'special_mob_drop'; // Một số cũng là potion ingredient

    // --- Khoáng sản & Nguyên liệu thô (Ores & Raw Materials) ---
    // Ưu tiên Deepslate
    if (nameStartsWith(name, ['deepslate_']) && nameEndsWith(name, ['_ore'])) return 'ore_raw_material_deepslate';
    if (nameStartsWith(name, ['raw_'])) return 'ore_raw_material'; // Raw iron, gold, copper
    if (nameEndsWith(name, ['_ore']) && !nameStartsWith(name, ['deepslate_'])) return 'ore_raw_material';
    if (nameEquals(name, ['coal', 'diamond', 'emerald', 'lapis_lazuli', 'nether_quartz', 'ancient_debris', 'amethyst_shard'])) return 'ore_raw_material'; // Gems và các loại khác

    // --- Khoáng sản đã xử lý (Processed Ores / Ingots / Gems) ---
    if (nameEndsWith(name, ['_ingot', '_nugget'])) return 'ore_processed_metal';
    if (nameEquals(name, ['diamond', 'emerald', 'lapis_lazuli', 'nether_quartz', 'coal', 'amethyst_shard'])) return 'ore_processed_gem_mineral'; // Gems/minerals cũng là dạng "processed" khi dùng
    if (nameEquals(name, ['netherite_scrap'])) return 'ore_processed_special';
    if (nameEndsWith(name, ['_block']) && nameIncludes(name, ['iron', 'gold', 'copper', 'emerald', 'diamond', 'lapis', 'netherite', 'coal', 'raw_'])) return 'ore_storage_block'; // Khối kim loại/khoáng sản

    // --- Gỗ (Wood) ---
    if (nameEndsWith(name, ['_log', '_wood', 'hyphae']) && nameStartsWith(name, ['stripped_'])) return 'wood_raw_stripped';
    if (nameEndsWith(name, ['_log', '_wood', 'hyphae']) && !nameStartsWith(name, ['stripped_'])) return 'wood_raw_log';
    if (nameEndsWith(name, ['_planks', '_slab', '_stairs', '_fence', '_fence_gate'])) return 'wood_processed_building';
    if (nameEndsWith(name, ['_door', '_trapdoor', '_pressure_plate', '_button', '_sign', 'hanging_sign'])) return 'wood_processed_functional';
    if (nameEndsWith(name, ['_boat', '_chest_boat'])) return 'transportation_water'; // Thuyền gỗ

    // --- Đá & Khối xây dựng vô cơ (Stone & Inorganic Blocks) ---
    // Đá cơ bản
    if (nameEquals(name, ['stone', 'cobblestone', 'granite', 'diorite', 'andesite', 'deepslate', 'cobbled_deepslate', 'tuff', 'calcite', 'dripstone_block'])) return 'stone_basic_natural';
    // Đá Nether
    if (nameEquals(name, ['netherrack', 'soul_sand', 'soul_soil', 'magma_block', 'basalt', 'smooth_basalt', 'blackstone', 'cobbled_blackstone'])) return 'nether_block_natural';
    // Đá End
    if (nameEquals(name, ['end_stone'])) return 'end_block_natural';
    // Đá đã xử lý (polished, bricks, chiseled, smooth...)
    if (nameStartsWith(name, ['polished_', 'smooth_', 'chiseled_', 'cut_']) || nameEndsWith(name, ['_bricks', '_tiles', '_pillar'])) return 'stone_processed_building';
    if (nameEndsWith(name, ['_stairs', '_slab', '_wall', '_pressure_plate', '_button'])) return 'stone_processed_functional'; // Slab, stairs cũng có thể coi là functional
    // Khối đất/cát/sỏi tự nhiên
    if (nameEquals(name, ['dirt', 'grass_block', 'podzol', 'mycelium', 'coarse_dirt', 'rooted_dirt', 'farmland', 'dirt_path', 'mud', 'packed_mud', 'mud_bricks'])) return 'natural_ground_dirt';
    if (nameEquals(name, ['sand', 'red_sand', 'sandstone', 'red_sandstone', 'suspicious_sand'])) return 'natural_ground_sand'; // Sandstone cũng gần nhóm này
    if (nameEquals(name, ['gravel', 'suspicious_gravel', 'clay'])) return 'natural_ground_other';
    if (nameEquals(name, ['moss_block', 'moss_carpet'])) return 'natural_plant_block'; // Khối rêu

    // --- Khối màu & Trang trí (Colored & Decoration Blocks) ---
    if (nameEndsWith(name, ['_wool'])) return 'colored_wool';
    if (nameEndsWith(name, ['_carpet'])) return 'colored_carpet';
    if (nameEndsWith(name, ['_bed'])) return 'colored_bed';
    if (nameEndsWith(name, ['_banner'])) return 'colored_banner';
    if (nameEndsWith(name, ['_concrete', '_concrete_powder'])) return 'colored_concrete';
    if (nameEndsWith(name, ['_terracotta', 'glazed_terracotta'])) return 'colored_terracotta';
    if (nameEndsWith(name, ['_stained_glass', '_stained_glass_pane'])) return 'colored_glass';
    if (nameEquals(name, ['glass', 'glass_pane', 'tinted_glass'])) return 'transparent_glass';
    if (nameEquals(name, ['glowstone', 'sea_lantern', 'shroomlight', 'ochre_froglight', 'pearlescent_froglight', 'verdant_froglight', 'end_rod', 'torch', 'soul_torch', 'lantern', 'soul_lantern', 'redstone_lamp'])) return 'light_source';
    if (nameEquals(name, ['amethyst_block', 'amethyst_cluster', 'budding_amethyst'])) return 'crystal_block';
    if (nameEndsWith(name, ['_candle'])) return 'light_decoration';

    // --- Thực vật trang trí (Plant Decoration) ---
    if (nameEndsWith(name, ['_leaves', '_flower', '_sapling', 'spore_blossom', 'azalea', 'flowering_azalea', 'mangrove_propagule'])) return 'plant_decoration_flora';
    if (nameIncludes(name, ['coral', 'coral_block', 'coral_fan'])) return 'plant_decoration_coral';
    if (nameEquals(name, ['grass', 'tall_grass', 'fern', 'large_fern', 'vine', 'twisting_vines', 'weeping_vines', 'lily_pad', 'small_dripleaf', 'big_dripleaf', 'hanging_roots', 'pitcher_plant', 'torchflower'])) return 'plant_decoration_greenery';

    // --- Redstone ---
    if (nameEquals(name, ['redstone', 'redstone_block', 'redstone_torch', 'repeater', 'comparator', 'target', 'lightning_rod'])) return 'redstone_signal'; // Dây, khối, nguồn/dẫn tín hiệu
    if (nameIncludes(name, ['piston', 'observer', 'dispenser', 'dropper', 'hopper', 'daylight_detector', 'sculk_sensor', 'calibrated_sculk_sensor'])) return 'redstone_mechanism'; // Khối cơ chế
    if (nameIncludes(name, ['lever', 'button', '_pressure_plate', 'tripwire_hook', 'weighted_pressure_plate'])) return 'redstone_activator'; // Khối kích hoạt

    // --- Khối chức năng & Tiện ích (Utility Blocks & Items) ---
    if (nameEquals(name, ['crafting_table', 'furnace', 'smoker', 'blast_furnace', 'cartography_table', 'fletching_table', 'smithing_table', 'loom', 'stonecutter', 'grindstone'])) return 'utility_block_crafting';
    if (nameEquals(name, ['enchanting_table', 'bookshelf', 'lectern', 'brewing_stand', 'cauldron', 'composter', 'beacon'])) return 'utility_block_magic_storage';
    if (nameEquals(name, ['anvil', 'chipped_anvil', 'damaged_anvil'])) return 'utility_block_repair';
    if (nameEquals(name, ['chest', 'trapped_chest', 'ender_chest', 'barrel', 'shulker_box'])) return 'container'; // Khối chứa đồ
    if (nameEndsWith(name, ['_shulker_box'])) return 'container'; // Đảm bảo shulker box vào đây
    if (nameEquals(name, ['ladder', 'scaffolding', 'item_frame', 'glow_item_frame', 'painting', 'armor_stand', 'flower_pot', 'end_crystal'])) return 'utility_decoration'; // Tiện ích / trang trí khác

    // --- Vật phẩm tiện ích (Utility Items) ---
    if (nameEquals(name, ['bucket', 'water_bucket', 'lava_bucket', 'powder_snow_bucket', 'milk_bucket', 'axolotl_bucket', 'fish_bucket', 'tadpole_bucket'])) return 'utility_item_bucket'; // Milk bucket cũng là food
    if (nameEquals(name, ['book', 'writable_book', 'written_book', 'knowledge_book', 'paper', 'map', 'empty_map'])) return 'utility_item_paper';
    if (nameEndsWith(name, ['_dye'])) return 'dye';
    if (nameEquals(name, ['bundle'])) return 'utility_item_storage';
    if (nameEquals(name, ['saddle'])) return 'equipment_special'; // Yên ngựa có thể xếp vào đây

    // --- Vận chuyển (Transportation) ---
    if (nameEndsWith(name, ['_minecart'])) return 'transportation_rail';
    if (nameEquals(name, ['rail', 'powered_rail', 'detector_rail', 'activator_rail'])) return 'transportation_rail_block';

    // --- Vật phẩm linh tinh/ít dùng (Junk/Misc) ---
    // Giữ lại những thứ thực sự ít giá trị hoặc chỉ dùng 1 lần
    if (nameEquals(name, ['bowl', 'poisonous_potato', 'stick'])) return 'junk_misc'; // Stick thực ra rất hữu dụng, nhưng lẻ tẻ
    if (nameEquals(name, ['flint', 'charcoal', 'brick', 'nether_brick'])) return 'crafting_material_simple'; // Nguyên liệu chế tạo cơ bản khác

    // --- Các loại khối chưa phân loại cụ thể ---
    // Kiểm tra cuối cùng cho các khối có thể xếp chồng
    if (item && typeof item.stackSize === 'number' && item.stackSize > 1) {
        // Có thể thêm logic kiểm tra xem có phải là 'block' dựa trên registry name của Minecraft nếu có thông tin đó
        // Tạm thời coi các item stack > 1 mà chưa được phân loại là khối chung
        return 'block_generic';
    }

    // --- Các vật phẩm không xếp chồng chưa phân loại ---
    if (item && typeof item.stackSize === 'number' && item.stackSize === 1) {
        // Thường là công cụ, vũ khí, giáp đã được xử lý, nhưng có thể còn sót
        return 'item_unstackable_misc';
    }

    // Không xác định được
    return 'unknown';
}

// --- Định nghĩa các Nhóm Danh mục Lớn hơn ---
// Key: Tên nhóm chuẩn hóa (tiếng Anh) dùng trong logic code
// Value: Array các danh mục chi tiết (từ getItemCategory) thuộc nhóm này
const categoryKeywords = {
    // Nhóm cơ bản
    ores: ['ore_raw_material', 'ore_raw_material_deepslate', 'ore_processed_metal', 'ore_processed_gem_mineral', 'ore_processed_special', 'ore_storage_block'],
    food: ['food_cooked_special', 'food_raw_simple', 'food_harmful'],
    weapons: ['weapon_melee', 'weapon_ranged', 'ammo', 'tool_weapon_axe'],
    tools: ['tool_mining_farming', 'tool_utility', 'tool_fire', 'tool_fishing', 'tool_navigation', 'tool_mob_interaction', 'tool_weapon_axe'],
    armor: ['armor', 'armor_horse'],
    equipment: ['equipment_special', 'armor', 'armor_horse'], // Bao gồm cả giáp và đồ đặc biệt

    // Nhóm nông nghiệp & tự nhiên
    farming: ['farming_seed_sapling', 'farming_crop_product', 'farming_utility', 'farming_storage', 'farming_mob_drop', 'tool_mining_farming', 'tool_mob_interaction'], // Mở rộng farming
    mob_drops: ['farming_mob_drop', 'hostile_mob_drop', 'special_mob_drop'], // Nhóm tất cả mob drops
    wood: ['wood_raw_log', 'wood_raw_stripped', 'wood_processed_building', 'wood_processed_functional'],
    stone: ['stone_basic_natural', 'stone_processed_building', 'stone_processed_functional'],
    natural_blocks: ['natural_ground_dirt', 'natural_ground_sand', 'natural_ground_other', 'natural_plant_block', 'stone_basic_natural', 'nether_block_natural', 'end_block_natural', 'wood_raw_log', 'wood_raw_stripped'], // Khối tự nhiên rộng
    nether_items: ['nether_block_natural', 'nether_wart', 'blaze_rod', 'ghast_tear', 'magma_cream', 'nether_brick', 'netherite_scrap', 'netherite_ingot', 'netherite_block'], // Các vật phẩm liên quan Nether
    end_items: ['end_block_natural', 'ender_pearl', 'chorus_fruit', 'shulker_shell', 'elytra', 'dragon_egg', 'dragon_head', 'end_rod'], // Các vật phẩm liên quan End

    // Nhóm xây dựng & trang trí
    building_blocks: [
        'wood_raw_log', 'wood_raw_stripped', 'wood_processed_building', 'wood_processed_functional',
        'stone_basic_natural', 'stone_processed_building', 'stone_processed_functional',
        'natural_ground_dirt', 'natural_ground_sand', 'natural_ground_other',
        'nether_block_natural', 'end_block_natural', 'ore_storage_block', 'farming_storage',
        'colored_wool', 'colored_carpet', 'colored_concrete', 'colored_terracotta', 'colored_glass',
        'transparent_glass', 'light_source', 'crystal_block', 'block_generic', 'redstone_lamp'
    ], // Nhóm rất rộng
    decorations: [
        'plant_decoration_flora', 'plant_decoration_coral', 'plant_decoration_greenery',
        'colored_wool', 'colored_carpet', 'colored_bed', 'colored_banner', 'banner_pattern',
        'colored_terracotta', 'colored_glass', 'light_source', 'light_decoration', 'crystal_block',
        'utility_decoration', 'music_disc', 'trophy_rare', 'flower_pot', 'item_frame', 'painting', 'armor_stand'
    ],
    colored_blocks: ['colored_wool', 'colored_carpet', 'colored_bed', 'colored_banner', 'colored_concrete', 'colored_terracotta', 'colored_glass', '_dye'], // Bao gồm cả thuốc nhuộm
    light_sources: ['light_source', 'light_decoration'],

    // Nhóm chức năng & đặc biệt
    redstone: ['redstone_signal', 'redstone_mechanism', 'redstone_activator', 'redstone_lamp'],
    magic_potions: ['potion', 'potion_ingredient', 'magic_utility', 'magic_component'],
    utility_blocks: ['utility_block_crafting', 'utility_block_magic_storage', 'utility_block_repair', 'container', 'utility_decoration'],
    utility_items: ['utility_item_bucket', 'utility_item_paper', 'utility_item_storage', 'tool_utility', 'junk_misc'], // Bao gồm cả tool tiện ích
    transportation: ['transportation_water', 'transportation_rail', 'transportation_rail_block', 'saddle', 'lead', 'elytra'], // Mở rộng transportation
    containers: ['container', 'utility_item_storage'], // Nhóm đồ chứa
    valuables: ['ore_processed_metal', 'ore_processed_gem_mineral', 'ore_processed_special', 'ore_storage_block', 'diamond', 'emerald', 'netherite_ingot', 'netherite_scrap', 'nether_star', 'enchanted_golden_apple', 'beacon'], // Các vật phẩm giá trị cao
    junk: ['junk_misc', 'food_harmful', 'poisonous_potato', 'bowl'], // Thu hẹp lại junk

    // Đặc biệt
    all: ['all'], // Từ khóa đặc biệt để lấy tất cả
};

// Tìm danh mục chuẩn hóa (tiếng Anh) dựa trên từ khóa trong tin nhắn (tiếng Việt)
function findCategoryFromKeywords(message) {
    const lowerMessage = message.toLowerCase().trim();
    if (!lowerMessage) return null;

    // Ưu tiên các từ khóa dài hơn hoặc cụ thể hơn trước
    // Mapping: Vietnamese Keyword -> Standardized English Category Key (from categoryKeywords)
    const keywordMapping = {
        // Cụ thể nhất trước
        'nguyên liệu làm thuốc': 'magic_potions',
        'đồ pha thuốc': 'magic_potions',
        'khoáng sản đã xử lý': 'ores', // Có thể cần cụ thể hơn?
        'nguyên liệu thô': 'ores', // Có thể cần cụ thể hơn? 'ore_raw_material'
        'quặng thô': 'ores',
        'đồ ăn nấu chín': 'food',
        'đồ ăn chế biến': 'food',
        'đồ ăn sống': 'food',
        'vũ khí cận chiến': 'weapons',
        'vũ khí tầm xa': 'weapons',
        'công cụ đào': 'tools',
        'công cụ farm': 'tools',
        'đồ nghề câu cá': 'tools',
        'giáp ngựa': 'armor',
        'đồ từ mob farm': 'farming_mob_drop', // Cụ thể hơn farming
        'đồ từ quái': 'mob_drops',
        'đồ quái vật': 'mob_drops',
        'gỗ thô': 'wood',
        'gỗ đã xử lý': 'wood',
        'gỗ chế biến': 'wood',
        'đá tự nhiên': 'stone',
        'đá đã xử lý': 'stone',
        'đá chế biến': 'stone',
        'khối màu': 'colored_blocks',
        'khối bê tông': 'colored_blocks',
        'khối đất nung': 'colored_blocks',
        'khối len': 'colored_wool', // Cụ thể hơn
        'khối kính màu': 'colored_glass', // Cụ thể hơn
        'đồ trang trí cây cỏ': 'decorations',
        'đồ trang trí san hô': 'decorations',
        'đồ redstone': 'redstone',
        'đá đỏ': 'redstone',
        'khối chức năng': 'utility_blocks',
        'bàn chế tạo': 'utility_blocks',
        'lò nung': 'utility_blocks',
        'đồ tiện ích': 'utility_items',
        'đồ dùng': 'utility_items',
        'xô nước': 'utility_items',
        'xô lava': 'utility_items',
        'xô sữa': 'utility_items',
        'đồ di chuyển': 'transportation',
        'xe mỏ': 'transportation',
        'thuyền': 'transportation',
        'đường ray': 'transportation',
        'rương': 'containers',
        'hòm': 'containers',
        'hộp shulker': 'containers',
        'đồ giá trị': 'valuables',
        'đồ quý hiếm': 'valuables',
        'kim cương': 'valuables', // Cụ thể
        'ngọc lục bảo': 'valuables', // Cụ thể
        'netherite': 'valuables', // Cụ thể
        'đồ nether': 'nether_items',
        'đồ end': 'end_items',
        'trứng mob': 'spawn_egg',
        'trứng spawn': 'spawn_egg',
        'đĩa nhạc': 'music_disc',
        'thuốc nhuộm': 'dye',

        // Chung chung hơn (để sau các từ khóa cụ thể)
        'khoáng sản': 'ores',
        'quặng': 'ores',
        'thức ăn': 'food',
        'đồ ăn': 'food',
        'vũ khí': 'weapons',
        'đồ đánh nhau': 'weapons',
        'công cụ': 'tools',
        'dụng cụ': 'tools',
        'đồ nghề': 'tools',
        'giáp': 'armor',
        'đồ farm': 'farming',
        'nông sản': 'farming',
        'gỗ': 'wood',
        'đá': 'stone', // "Đá" sẽ khớp sau "đá đỏ", "đá tự nhiên",...
        'đất cát sỏi': 'natural_blocks',
        'đất': 'natural_blocks', // "Đất" chung hơn
        'khối xây dựng': 'building_blocks',
        'đồ xây dựng': 'building_blocks',
        'thuốc': 'magic_potions', // Thuốc nói chung
        'đồ trang trí': 'decorations',
        'đồ quý': 'valuables',
        'rác': 'junk',
        'đồ linh tinh': 'junk', // hoặc 'utility_items'/'misc'?
        'đèn': 'light_sources',
        'khối sáng': 'light_sources',
        'kính': 'transparent_glass', // Kính nói chung

        // Đặc biệt
        'tất cả': 'all',
        'hết': 'all',
        'mọi thứ': 'all',
    };

    // Sắp xếp các keyword theo độ dài giảm dần để ưu tiên khớp dài hơn
    const sortedKeywords = Object.keys(keywordMapping).sort((a, b) => b.length - a.length);

    for (const keyword of sortedKeywords) {
        // Sử dụng regex để đảm bảo khớp từ nguyên vẹn (word boundary) nếu cần
        // Ví dụ: const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        // if (regex.test(lowerMessage)) { ... }
        // Tạm thời dùng includes cho đơn giản
        if (lowerMessage.includes(keyword)) {
            console.log(`[Debug] Matched keyword: "${keyword}" to category: "${keywordMapping[keyword]}" in message: "${message}"`); // Thêm log để debug
            return keywordMapping[keyword]; // Trả về tên danh mục chuẩn hóa (tiếng Anh)
        }
    }

    console.log(`[Debug] No keyword matched in message: "${message}"`); // Thêm log để debug
    return null; // Không tìm thấy từ khóa danh mục nào
}

module.exports = {
    getItemCategory,
    categoryKeywords,
    findCategoryFromKeywords,
};
// --- END OF FILE utils/item_categories.js ---