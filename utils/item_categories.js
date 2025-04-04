// --- START OF FILE utils/item_categories.js ---

/**
 * Phân loại vật phẩm vào các danh mục chung.
 * Lưu ý: Đây là cách phân loại cơ bản, có thể cần điều chỉnh tùy theo nhu cầu.
 * Một vật phẩm có thể thuộc nhiều danh mục (ví dụ: rìu vừa là tool, vừa là weapon).
 * Ưu tiên các danh mục cụ thể hơn (vd: ore > block).
 */

// Helper function to check name patterns
const nameIncludes = (itemName, patterns) => patterns.some(p => itemName.includes(p));
const nameEquals = (itemName, names) => names.some(n => itemName === n);

function getItemCategory(item) {
    if (!item || !item.name) return 'unknown';
    const name = item.name;

    // Ưu tiên các loại cụ thể trước
    if (nameIncludes(name, ['_sword', 'bow', 'crossbow', 'trident'])) return 'weapon';
    if (nameIncludes(name, ['_pickaxe', '_shovel', '_hoe', 'shears', 'flint_and_steel', 'fishing_rod'])) return 'tool';
    if (nameIncludes(name, ['_axe'])) return 'tool_weapon'; // Rìu đặc biệt
    if (nameIncludes(name, ['_helmet', '_chestplate', '_leggings', '_boots', 'shield', 'elytra'])) return 'armor_equipment';
    if (nameIncludes(name, ['_seeds', '_sapling', 'bone_meal', 'wheat', 'carrot', 'potato', 'beetroot', 'pumpkin', 'melon', 'sugar_cane', 'cocoa_beans', 'nether_wart'])) return 'farming_crop';
    if (nameEquals(name, ['egg', 'feather', 'leather', 'rabbit_hide', 'ink_sac', 'glow_ink_sac'])) return 'farming_mob_drop'; // Tách riêng mob drop từ farm
    if (nameIncludes(name, ['raw_iron', 'raw_gold', 'raw_copper', '_ore', 'ancient_debris', 'coal', 'diamond', 'emerald', 'lapis_lazuli', 'nether_quartz', 'redstone']) && !name.includes('deepslate')) return 'ore_raw_material'; // Loại trừ deepslate ores ở đây
    if (nameIncludes(name, ['deepslate_iron_ore', 'deepslate_gold_ore', 'deepslate_copper_ore', 'deepslate_coal_ore', 'deepslate_diamond_ore', 'deepslate_emerald_ore', 'deepslate_lapis_ore', 'deepslate_redstone_ore'])) return 'ore_raw_material_deepslate'; // Phân loại riêng deepslate nếu cần
    if (nameIncludes(name, ['iron_ingot', 'gold_ingot', 'copper_ingot', 'netherite_ingot', 'netherite_scrap'])) return 'ore_processed';
    if (nameIncludes(name, ['cooked_', 'bread', 'cake', 'cookie', 'pumpkin_pie', 'mushroom_stew', 'rabbit_stew', 'beetroot_soup', 'suspicious_stew', 'baked_potato', 'golden_apple', 'enchanted_golden_apple', 'honey_bottle', 'milk_bucket'])) return 'food_cooked_special';
    if (nameEquals(name, ['apple', 'beef', 'porkchop', 'chicken', 'rabbit', 'mutton', 'cod', 'salmon', 'tropical_fish', 'pufferfish', 'melon_slice', 'glow_berries', 'sweet_berries', 'carrot', 'potato', 'beetroot'])) return 'food_raw_simple'; // Thức ăn chưa chế biến hoặc đơn giản (cà rốt, khoai cũng là food)
    if (nameIncludes(name, ['potion', 'splash_potion', 'lingering_potion', 'experience_bottle', 'dragon_breath'])) return 'potion_magic';
    if (nameIncludes(name, ['redstone', 'repeater', 'comparator', 'piston', 'sticky_piston', 'observer', 'lever', 'button', '_pressure_plate', 'tripwire_hook', 'redstone_torch', 'target', 'dispenser', 'dropper', 'hopper', 'daylight_detector', 'lightning_rod'])) return 'redstone_component';
    if (nameIncludes(name, ['_log', '_wood', 'stripped_'])) return 'wood_raw';
    if (nameIncludes(name, ['_planks', '_slab', '_stairs', '_fence', '_gate', '_door', '_trapdoor', '_sign', 'crafting_table', 'furnace', 'chest', 'barrel', 'bookshelf', 'ladder', 'lectern', 'composter', 'smoker', 'blast_furnace'])) return 'wood_processed_utility';
    if (nameEquals(name, ['stone', 'cobblestone', 'granite', 'diorite', 'andesite', 'deepslate', 'cobbled_deepslate', 'tuff', 'calcite', 'blackstone', 'basalt'])) return 'stone_basic';
    if (nameIncludes(name, ['polished_', 'brick', '_wall', 'chiseled_', 'smooth_'])) return 'stone_processed';
    if (nameEquals(name, ['dirt', 'grass_block', 'podzol', 'mycelium', 'coarse_dirt', 'rooted_dirt', 'sand', 'red_sand', 'gravel', 'clay', 'moss_block'])) return 'natural_ground';
    if (nameIncludes(name, ['_wool', '_carpet', '_bed', 'banner'])) return 'wool_decoration';
    if (nameIncludes(name, ['_glass', '_glass_pane', 'glowstone', 'sea_lantern', 'shroomlight', 'amethyst_block', 'amethyst_cluster'])) return 'light_transparent';
    if (nameIncludes(name, ['_concrete', '_terracotta', 'glazed_terracotta'])) return 'colored_blocks';
    if (nameIncludes(name, ['_flower', '_coral', '_leaves', 'grass', 'fern', 'vine', 'lily_pad', 'cactus', 'spore_blossom', 'hanging_roots'])) return 'plant_decoration';
    if (nameEquals(name, ['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'bone', 'string', 'gunpowder', 'slime_ball', 'phantom_membrane'])) return 'junk_mob_drop'; // Mở rộng junk
    if (nameEquals(name, ['bowl', 'glass_bottle'])) return 'junk_utility'; // Các vật phẩm tiện ích rỗng

    // Danh mục rộng hơn nếu không khớp các loại trên
    if (item.stackSize > 1 && item.category !== 'equipment' && item.category !== 'food') return 'block_stackable'; // Hầu hết các khối không phải đồ ăn/trang bị
    if (item.stackSize === 1) return 'item_unstackable'; // Công cụ, vũ khí, armor...

    return 'unknown';
}

// Định nghĩa các từ khóa người dùng có thể dùng cho từng danh mục (key là tên chuẩn hóa tiếng Anh)
const categoryKeywords = {
    ores: ['ore_raw_material', 'ore_raw_material_deepslate', 'ore_processed'],
    food: ['food_cooked_special', 'food_raw_simple'],
    weapons: ['weapon', 'tool_weapon'],
    tools: ['tool', 'tool_weapon'],
    armor: ['armor_equipment'],
    farming: ['farming_crop', 'farming_mob_drop'],
    wood: ['wood_raw', 'wood_processed_utility'],
    stone: ['stone_basic', 'stone_processed'],
    building_blocks: ['wood_raw', 'wood_processed_utility', 'stone_basic', 'stone_processed', 'natural_ground', 'colored_blocks', 'light_transparent', 'block_stackable'],
    redstone: ['redstone_component'],
    magic_potions: ['potion_magic'],
    decorations: ['wool_decoration', 'plant_decoration', 'light_transparent', 'colored_blocks'], // Mở rộng decorations
    valuables: ['ore_processed', 'diamond', 'emerald', 'netherite_ingot', 'netherite_scrap', 'enchanted_golden_apple'],
    junk: ['junk_mob_drop', 'junk_utility'],
    all: ['all'], // Từ khóa đặc biệt
};

// Tìm danh mục chuẩn hóa (tiếng Anh) dựa trên từ khóa trong tin nhắn
function findCategoryFromKeywords(message) {
    const lowerMessage = message.toLowerCase();
    // Ưu tiên các từ khóa dài hơn hoặc cụ thể hơn trước
    const keywordMapping = {
        'khoáng sản': 'ores',
        'quặng': 'ores',
        'nguyên liệu thô': 'ore_raw_material',
        'đồ ăn': 'food',
        'thức ăn': 'food',
        'vũ khí': 'weapons',
        'đồ đánh nhau': 'weapons',
        'công cụ': 'tools',
        'dụng cụ': 'tools',
        'đồ nghề': 'tools',
        'giáp': 'armor',
        'đồ farm': 'farming',
        'nông sản': 'farming',
        'gỗ': 'wood',
        'đá': 'stone',
        'đất cát sỏi': 'natural_ground', // Cụ thể hơn
        'đất': 'natural_ground',
        'khối xây dựng': 'building_blocks',
        'đồ xây dựng': 'building_blocks',
        'đá đỏ': 'redstone',
        'redstone': 'redstone',
        'thuốc': 'magic_potions',
        'đồ trang trí': 'decorations',
        'đồ quý': 'valuables',
        'đồ giá trị': 'valuables',
        'rác': 'junk',
        'đồ linh tinh': 'junk',
        'tất cả': 'all',
        'hết': 'all',
        'mọi thứ': 'all',
    };

    // Sắp xếp các keyword theo độ dài giảm dần để ưu tiên khớp dài hơn
    const sortedKeywords = Object.keys(keywordMapping).sort((a, b) => b.length - a.length);

    for (const keyword of sortedKeywords) {
        if (lowerMessage.includes(keyword)) {
            return keywordMapping[keyword]; // Trả về tên danh mục chuẩn hóa (tiếng Anh)
        }
    }
    return null; // Không tìm thấy từ khóa danh mục nào
}

module.exports = {
    getItemCategory,
    categoryKeywords,
    findCategoryFromKeywords,
};
// --- END OF FILE utils/item_categories.js ---