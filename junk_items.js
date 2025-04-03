// junk_items.js
// Danh sách các ID vật phẩm được coi là "rác" và sẽ bị vứt bỏ.
// Thêm hoặc bớt các ID tùy theo nhu cầu.
// Lấy ID từ tên tiếng Anh chuẩn (ví dụ: 'cobblestone', 'dirt').

const junkItemIds = [
    // Đá và Đất phổ biến
    'cobblestone',
    'dirt',
    'gravel',
    'sand',
    'granite',
    'diorite',
    'andesite',
    'deepslate', // Deepslate thường
    'cobbled_deepslate',
    'tuff',

    // Đồ rơi từ Mob Zombie/Skeleton (thường không dùng nhiều)
    'rotten_flesh',
    // 'bone', // Xương có thể hữu ích cho bột xương, cân nhắc giữ lại
    // 'arrow', // Tên có thể hữu ích, cân nhắc giữ lại

    // Hạt giống (trừ những loại hiếm/quan trọng)
    'wheat_seeds',
    'melon_seeds',
    'pumpkin_seeds',
    'beetroot_seeds',
    // 'torchflower_seeds', // Giữ lại hạt hiếm
    // 'pitcher_pod', // Giữ lại hạt hiếm

    // Đồ linh tinh khác
    'poisonous_potato',
    'spider_eye', // Có thể dùng làm thuốc, nhưng thường thừa
    'gunpowder', // Có thể hữu ích, cân nhắc giữ lại
    'string', // Có thể hữu ích, cân nhắc giữ lại
    'flint', // Có thể hữu ích, cân nhắc giữ lại

    // Có thể thêm các loại hoa, cây con không cần thiết...
    'poppy',
    'dandelion',
    'oak_sapling',
    'spruce_sapling',
    'birch_sapling',
    // ... thêm các loại khác nếu muốn

];

module.exports = junkItemIds;