/* ============================================================
 *  奶茶星球 · Bubble Tycoon  —— 静态数据层
 * ============================================================ */
'use strict';

/* ---------- 全局常量 ---------- */
const CFG = {
  SAVE_PREFIX: 'bubbleTycoonSaveV3_',
  SAVE_SLOTS: 3,
  META_KEY: 'bubbleTycoonMetaV3',
  DAYS: 30,
  DAY_DURATION: 26,        // 营业阶段实时秒数
  LAST_CALL: 6,            // 打烊清场宽限秒数
  BASE_SERVICE: 1.35,      // 单杯基准耗时（秒）
  MIN_SERVICE: 0.40,
  PACK_COST: 0.6,          // 每杯包装费
  BASE_STORAGE: 420,
  RENT_PER_SHOP: 60,
  SHOP_UPKEEP: 100,
  BASE_QUEUE: 5,           // 基础等位座
  BASE_PATIENCE: 9,
  LOST_REP: -0.28,
  STOCKOUT_REP: -0.55,
  SERVE_REP: 0.12,
  OFFLINE_CAP_MIN: 240,    // 离线收益最多累计 4 小时
  RESTOCK_MARKUP: 1.65,    // 营业中紧急进货加价
  RUSH_BOOST: 0.30,        // 每次点击推进的出杯进度
  RUSH_TIP: 0.055,         // 点击加速产生的小费比例
  BOSS_SKILL_DUR: 8,
  BOSS_SKILL_CD: 26,
};

/* ---------- 原料 ---------- */
const ING = [
  { id: 'tea',   name: '茶叶', emoji: '🍃', base: 1.0, vol: 0.16, color: '#7BD389' },
  { id: 'milk',  name: '牛奶', emoji: '🥛', base: 1.5, vol: 0.20, color: '#9FD8FF' },
  { id: 'sugar', name: '糖浆', emoji: '🍯', base: 0.5, vol: 0.24, color: '#FFD97D' },
  { id: 'pearl', name: '珍珠', emoji: '🫧', base: 1.6, vol: 0.30, color: '#C7A6FF' },
  { id: 'fruit', name: '鲜果', emoji: '🍓', base: 2.4, vol: 0.34, color: '#FF8FB1' },
];

/* ---------- 口味标签 ---------- */
const TAGS = {
  fruity: { name: '果香', emoji: '🍓', color: '#FF8FB1' },
  milky:  { name: '奶香', emoji: '🥛', color: '#9FD8FF' },
  tea:    { name: '茶香', emoji: '🍃', color: '#7BD389' },
  fresh:  { name: '清爽', emoji: '🧊', color: '#6FE3D8' },
  rich:   { name: '浓郁', emoji: '🍮', color: '#FFB26B' },
  sweet:  { name: '甜党', emoji: '🍬', color: '#FFD97D' },
};

/* ---------- 配方 ---------- */
const RECIPES = [
  { id: 'boba', name: '经典珍珠奶茶', emoji: '🧋', tags: ['milky', 'rich'], pop: 100,
    req: { tea: 2, milk: 2, pearl: 1, sugar: 1 }, price: 22, tier: 1, unlocked: true,
    desc: '街边小店的生命线，永远不会错的选择。' },
  { id: 'greentea', name: '芝士奶盖绿茶', emoji: '🍵', tags: ['tea', 'fresh'], pop: 84,
    req: { tea: 3, milk: 1, sugar: 1 }, price: 19, tier: 1,
    research: { cash: 180, ing: { tea: 12, milk: 8 } },
    desc: '低成本入门款，利润空间薄但走量。' },
  { id: 'passion', name: '满杯百香果', emoji: '🥭', tags: ['fruity', 'fresh'], pop: 94,
    req: { tea: 1, fruit: 3, sugar: 1 }, price: 26, tier: 1,
    research: { cash: 260, ing: { fruit: 14, tea: 6 } },
    desc: '夏天的人气王，鲜果便宜时血赚。' },
  { id: 'taro', name: '芋泥波波', emoji: '🍠', tags: ['milky', 'rich'], pop: 90,
    req: { milk: 3, pearl: 2, sugar: 2 }, price: 28, tier: 2,
    research: { cash: 420, ing: { milk: 18, pearl: 12 } },
    desc: '扎实管饱，冬天与寒流天的宠儿。' },
  { id: 'coco', name: '生椰拿铁', emoji: '🥥', tags: ['milky', 'rich'], pop: 98,
    req: { milk: 3, tea: 2 }, price: 24, tier: 2,
    research: { cash: 480, ing: { milk: 20, tea: 14 } },
    desc: '打工人续命水，复购率极高。' },
  { id: 'grape', name: '青提冰茶', emoji: '🍇', tags: ['fruity', 'fresh'], pop: 92,
    req: { fruit: 2, tea: 2, sugar: 1 }, price: 25, tier: 2,
    research: { cash: 460, ing: { fruit: 16, tea: 12 } },
    desc: '清爽解腻，高温天直接起飞。' },
  { id: 'matcha', name: '抹茶奶绿', emoji: '🍡', tags: ['tea', 'milky'], pop: 102,
    req: { tea: 2, milk: 2, sugar: 2 }, price: 26, tier: 2,
    research: { cash: 520, ing: { tea: 20, milk: 16 } },
    desc: '颜值担当，拍照发圈自带流量。' },
  { id: 'brownsugar', name: '黑糖鹿丸', emoji: '🍮', tags: ['sweet', 'rich'], pop: 114,
    req: { pearl: 3, milk: 2, sugar: 2 }, price: 32, tier: 3,
    research: { cash: 900, ing: { pearl: 24, milk: 18, sugar: 14 } },
    desc: '爆款潜质，甜党见了走不动路。' },
  { id: 'sakura', name: '樱花荔枝饮', emoji: '🌸', tags: ['fruity', 'sweet'], pop: 122,
    req: { fruit: 3, milk: 1, sugar: 2 }, price: 34, tier: 3,
    research: { cash: 1050, ing: { fruit: 26, milk: 12, sugar: 12 } },
    desc: '限定颜值款，溢价能力拉满。' },
  { id: 'star', name: '星球特调', emoji: '🌌', tags: ['fruity', 'milky', 'tea', 'fresh', 'rich', 'sweet'], pop: 168,
    req: { tea: 2, milk: 2, fruit: 2, pearl: 1, sugar: 1 }, price: 46, tier: 4,
    research: { cash: 2400, ing: { tea: 20, milk: 20, fruit: 20, pearl: 16, sugar: 12 } },
    desc: '隐藏传说款：通吃所有流行趋势。' },
];

/* ---------- 永久升级 ---------- */
const UPGRADES = [
  { id: 'speed', name: '极速封口机', emoji: '🚀', max: 8, base: 200, mult: 1.55,
    desc: '出杯速度 +20%/级', detail: l => `当前：出杯速度 +${l * 20}%` },
  { id: 'decor', name: '门店装修', emoji: '✨', max: 8, base: 280, mult: 1.62,
    desc: '客流 +15%、等位座 +1/级', detail: l => `当前：客流 +${l * 15}%，等位 ${CFG.BASE_QUEUE + l} 位` },
  { id: 'menu', name: '招牌展位', emoji: '📋', max: 6, base: 260, mult: 1.5,
    desc: '可上架配方 +1/级', detail: l => `当前：可上架 ${2 + l} 款` },
  { id: 'storage', name: '冷链仓库', emoji: '🧊', max: 6, base: 200, mult: 1.5,
    desc: '库存上限 +180/级', detail: l => `当前：上限 ${CFG.BASE_STORAGE + l * 180}` },
  { id: 'training', name: '员工培训', emoji: '🎓', max: 5, base: 320, mult: 1.68,
    desc: '全员效率 +12%/级', detail: l => `当前：全员效率 +${l * 12}%` },
  { id: 'auto', name: '外卖接单', emoji: '🛵', max: 6, base: 450, mult: 1.85,
    desc: '离线收益与自动出杯', detail: l => `当前：离线 ${offlineRate(l)} 元/分钟` },
];

function offlineRate(lv) {
  return Math.round(4 * Math.pow(lv, 1.55));
}

/* ---------- 分店 ---------- */
const SHOP_COSTS = [3500, 9000, 20000];

/* ---------- 员工特质 ---------- */
const TRAITS = [
  { id: 'fast',   name: '手速狂魔', emoji: '⚡', desc: '出杯速度 +16%' },
  { id: 'nice',   name: '社交牛人', emoji: '😊', desc: '每日口碑额外 +0.6' },
  { id: 'thrift', name: '省料大师', emoji: '🧮', desc: '原料消耗 -10%' },
  { id: 'iron',   name: '铁人体质', emoji: '💪', desc: '体力消耗 -35%' },
  { id: 'star',   name: '自带流量', emoji: '🌟', desc: '客流 +7%' },
  { id: 'green',  name: '职场新人', emoji: '🌱', desc: '日薪 -25%，效率 -10%' },
  { id: 'wise',   name: '成本控制', emoji: '📊', desc: '每日本店固定开支 -8%' },
];

const STAFF_NAMES = ['小柠', '阿泽', '朵朵', '大熊', '丸子', '阿岚', '布丁', '老陈',
  '果果', 'KK', '小鹿', '阿泰', '奶盖', '青提', '芋圆', '可乐', '西米', '拿铁',
  '桃桃', '麦麦', '小满', '阿星'];

/* ---------- 天气 ---------- */
const WEATHERS = [
  { id: 'sun',  name: '晴空万里', emoji: '☀️',  traffic: 1.15, weight: 26, boom: 'fresh',  bust: 'rich' },
  { id: 'cloud',name: '多云微风', emoji: '⛅',  traffic: 1.00, weight: 28, boom: null,     bust: null },
  { id: 'rain', name: '阴雨绵绵', emoji: '🌧️', traffic: 0.80, weight: 16, boom: 'milky',  bust: 'fresh' },
  { id: 'hot',  name: '高温酷暑', emoji: '🔥',  traffic: 1.28, weight: 14, boom: 'fresh',  bust: 'rich' },
  { id: 'cold', name: '寒流来袭', emoji: '❄️',  traffic: 0.86, weight: 10, boom: 'rich',   bust: 'fresh' },
  { id: 'storm',name: '台风预警', emoji: '🌪️', traffic: 0.55, weight: 6,  boom: null,     bust: null, priceShock: { fruit: 1.8, milk: 1.25 } },
];

/* ---------- 市场新闻 ---------- */
const NEWS = [
  { id: 'n1', text: '🍃 春茶丰收，茶叶批发价走低', fx: { tea: 0.72 } },
  { id: 'n2', text: '🥛 牧场减产，奶价小幅上扬', fx: { milk: 1.28 } },
  { id: 'n3', text: '🍓 水果大年，鲜果价格跳水', fx: { fruit: 0.68 } },
  { id: 'n4', text: '🫧 木薯涨价，珍珠成本上升', fx: { pearl: 1.35 } },
  { id: 'n5', text: '🍯 糖厂促销，糖浆打折清仓', fx: { sugar: 0.7 } },
  { id: 'n6', text: '📦 物流顺畅，全线原料小幅回落', fx: { tea: .9, milk: .9, sugar: .9, pearl: .92, fruit: .9 } },
  { id: 'n7', text: '📈 原料市场整体看涨', fx: { tea: 1.15, milk: 1.18, sugar: 1.12, pearl: 1.2, fruit: 1.15 } },
  { id: 'n8', text: '🍓 鲜果冷链紧张，价格上浮', fx: { fruit: 1.4 } },
];

/* ---------- 随机事件 ---------- */
/* effect 支持：cash / rep / inv{ing:qty} / trafficMul(当日) / staffHeal / unlockRecipe / repMul */
const EVENTS = [
  { id: 'e1', title: '网红探店', emoji: '📸',
    text: '一位本地探店博主私信你：只要「赞助」一点，就能帮你拍一条视频。',
    options: [
      { label: '砸 ¥800 买推广', desc: '口碑 +9，明日客流大幅提升', effect: { cash: -800, rep: 9, trafficMul: 1.5 } },
      { label: '婉拒，专心做产品', desc: '口碑 +1，省下现金', effect: { rep: 1 } },
      { label: '反向砍价到 ¥300', desc: '口碑 +4，效果一般', effect: { cash: -300, rep: 4, trafficMul: 1.18 } },
    ] },
  { id: 'e2', title: '原料囤积机会', emoji: '🚚',
    text: '供应商急着清仓，愿意打折给你一批货，但你要当场付现金。',
    options: [
      { label: '买下 60 单位鲜果（-¥420）', desc: '库存大增', effect: { cash: -420, inv: { fruit: 60 } } },
      { label: '买下 60 单位茶叶（-¥180）', desc: '库存大增', effect: { cash: -180, inv: { tea: 60 } } },
      { label: '不买，留着现金', desc: '无影响', effect: {} },
    ] },
  { id: 'e3', title: '顾客投诉', emoji: '😡',
    text: '有顾客在社交平台吐槽等位太久，是否需要赔礼道歉？',
    options: [
      { label: '全额退款并送券（-¥260）', desc: '口碑 +6', effect: { cash: -260, rep: 6 } },
      { label: '私信解释，送一杯（-¥60）', desc: '口碑 +2', effect: { cash: -60, rep: 2 } },
      { label: '冷处理', desc: '口碑 -5', effect: { rep: -5 } },
    ] },
  { id: 'e4', title: '员工团建', emoji: '🎉',
    text: '大家最近很累，你要不要请全店喝一杯？',
    options: [
      { label: '包场 KTV（-¥500）', desc: '全员体力回满，效率提升', effect: { cash: -500, staffHeal: 100, rep: 2 } },
      { label: '请顿火锅（-¥200）', desc: '全员体力 +50', effect: { cash: -200, staffHeal: 50 } },
      { label: '画饼：下个月一定', desc: '全员体力 -15', effect: { staffHeal: -15 } },
    ] },
  { id: 'e5', title: '山寨店出现', emoji: '🥷',
    text: '隔壁开了家几乎一模一样的店，还打价格战。',
    options: [
      { label: '升级装修正面硬刚（-¥600）', desc: '装修 +1 级', effect: { cash: -600, upgrade: 'decor' } },
      { label: '请律师发函（-¥350）', desc: '口碑 +2，对方收敛', effect: { cash: -350, rep: 2 } },
      { label: '无视它', desc: '口碑 -4', effect: { rep: -4 } },
    ] },
  { id: 'e6', title: '美食节邀请', emoji: '🎪',
    text: '商圈办美食节，摊位费不便宜，但人流量惊人。',
    options: [
      { label: '租下黄金摊位（-¥1200）', desc: '今日客流 ×2.2', effect: { cash: -1200, trafficMul: 2.2 } },
      { label: '租个小摊位（-¥400）', desc: '今日客流 ×1.4', effect: { cash: -400, trafficMul: 1.4 } },
      { label: '放弃', desc: '无影响', effect: {} },
    ] },
  { id: 'e7', title: '神秘配方师', emoji: '🧙',
    text: '一位退休调配师愿意把秘方卖给你。',
    options: [
      { label: '买下秘方（-¥1500）', desc: '解锁一款随机高价配方', effect: { cash: -1500, unlockRecipe: 'tier3' } },
      { label: '请他当顾问（-¥700）', desc: '解锁一款随机配方', effect: { cash: -700, unlockRecipe: 'tier2' } },
      { label: '婉拒', desc: '无影响', effect: {} },
    ] },
  { id: 'e8', title: '设备检修', emoji: '🔧',
    text: '封口机最近有点异响。',
    options: [
      { label: '立即大修（-¥550）', desc: '出杯速度 +1 级', effect: { cash: -550, upgrade: 'speed' } },
      { label: '凑合着用', desc: '今日客流 ×0.85', effect: { trafficMul: 0.85 } },
    ] },
  { id: 'e9', title: '投资人上门', emoji: '💼',
    text: '有人想投你的店，但要占股。',
    options: [
      { label: '接受投资（+¥2500）', desc: '现金 +2500，口碑 -3（被指“变味”）', effect: { cash: 2500, rep: -3 } },
      { label: '拒绝，保持独立', desc: '口碑 +5', effect: { rep: 5 } },
    ] },
  { id: 'e10', title: '暴雨突袭', emoji: '⛈️',
    text: '气象台发布暴雨预警，今日客流预计惨淡。',
    options: [
      { label: '提前备料，做外卖（-¥300）', desc: '今日客流 ×1.3', effect: { cash: -300, trafficMul: 1.3 } },
      { label: '干脆休息半天', desc: '今日客流 ×0.6，全员体力回满', effect: { trafficMul: 0.6, staffHeal: 100 } },
    ] },
  { id: 'e11', title: '学生党团购', emoji: '🎓',
    text: '附近学校社团想批量团购，但压价很狠。',
    options: [
      { label: '接下 50 杯大单（+¥900）', desc: '现金 +900，口碑 -2（利润薄）', effect: { cash: 900, rep: -2 } },
      { label: '只接 20 杯（+¥460）', desc: '现金 +460，口碑 +1', effect: { cash: 460, rep: 1 } },
      { label: '不接', desc: '无影响', effect: {} },
    ] },
  { id: 'e12', title: '卫生检查', emoji: '🧼',
    text: '市场监管局突击检查。',
    options: [
      { label: '停业大扫除（-¥280）', desc: '口碑 +7', effect: { cash: -280, rep: 7 } },
      { label: '临时应付', desc: '口碑 -6，现金 -120（罚款）', effect: { cash: -120, rep: -6 } },
    ] },
  { id: 'e13', title: '联名机会', emoji: '🤝',
    text: '一个潮牌想和你做联名杯套。',
    options: [
      { label: '出资联名（-¥1000）', desc: '口碑 +10，客流 ×1.35', effect: { cash: -1000, rep: 10, trafficMul: 1.35 } },
      { label: '只做小幅合作（-¥350）', desc: '口碑 +4', effect: { cash: -350, rep: 4 } },
      { label: '拒绝', desc: '无影响', effect: {} },
    ] },
  { id: 'e14', title: '原料变质', emoji: '🦠',
    text: '仓库温度异常，部分鲜果报废了。',
    options: [
      { label: '加装温控（-¥450）', desc: '库存上限 +180（冷链 +1 级）', effect: { cash: -450, upgrade: 'storage' } },
      { label: '认栽', desc: '鲜果库存减半，口碑 -2', effect: { rep: -2, inv: { fruit: -999 } } },
    ] },
  { id: 'e15', title: '同行挖角', emoji: '🥷',
    text: '隔壁新开的店正在高薪挖你的熟手员工。',
    options: [
      { label: '加薪挽留（一次性 -¥600）', desc: '全队留任，口碑 +3', effect: { cash: -600, rep: 3 } },
      { label: '放他走', desc: '随机 1 名员工离职，但获得推荐奖 +¥400', effect: { cash: 400, loseStaff: 1, rep: -1 } },
      { label: '反向加薪到自己身上', desc: '口碑 -2，无损失', effect: { rep: -2 } },
    ] },
  { id: 'e16', title: '短视频爆火', emoji: '📱',
    text: '一条探店视频突然爆了，几百万人看到了你的店。',
    options: [
      { label: '全员加班接住这波流量', desc: '次日客流 ×2.6，全员体力 -30', effect: { trafficMul: 2.6, staffHeal: -30 } },
      { label: '限量发售，稳住口碑', desc: '次日客流 ×1.6，口碑 +6', effect: { trafficMul: 1.6, rep: 6 } },
      { label: '关店休息一天', desc: '次日客流 ×0.5，全员体力回满，口碑 +2', effect: { trafficMul: 0.5, staffHeal: 100, rep: 2 } },
    ] },
  { id: 'e17', title: '老顾客回馈', emoji: '💌',
    text: '常客们自发组织了后援会，还给你做了应援海报。',
    options: [
      { label: '请全场喝一杯（-¥380）', desc: '口碑 +8', effect: { cash: -380, rep: 8 } },
      { label: '把应援海报挂起来', desc: '装修 +1 级', effect: { upgrade: 'decor', rep: 2 } },
      { label: '合影发朋友圈', desc: '口碑 +3', effect: { rep: 3 } },
    ] },
];

/* ---------- 成就 ---------- */
/* check(s) 基于运行时状态；reward: cash / bp(品牌声望点) */
const ACHIEVEMENTS = [
  { id: 'a_first', name: '第一杯', emoji: '🥤', desc: '卖出第 1 杯饮品', reward: { cash: 60, bp: 1 },
    check: s => (s.stats.totalCups >= 1) },
  { id: 'a_100', name: '百杯俱乐部', emoji: '💯', desc: '累计卖出 100 杯', reward: { cash: 300, bp: 2 },
    check: s => (s.stats.totalCups >= 100) },
  { id: 'a_500', name: '排队之王', emoji: '👑', desc: '累计卖出 500 杯', reward: { cash: 900, bp: 4 },
    check: s => (s.stats.totalCups >= 500) },
  { id: 'a_1500', name: '城市传说', emoji: '🌆', desc: '累计卖出 1500 杯', reward: { cash: 2500, bp: 8 },
    check: s => (s.stats.totalCups >= 1500) },
  { id: 'a_day300', name: '小有盈余', emoji: '💰', desc: '单日净利突破 ¥300', reward: { cash: 200, bp: 1 },
    check: s => (s.stats.bestDayProfit >= 300) },
  { id: 'a_day1500', name: '日进斗金', emoji: '🤑', desc: '单日净利突破 ¥1500', reward: { cash: 600, bp: 3 },
    check: s => (s.stats.bestDayProfit >= 1500) },
  { id: 'a_day5000', name: '印钞机', emoji: '🏦', desc: '单日净利突破 ¥5000', reward: { cash: 1500, bp: 6 },
    check: s => (s.stats.bestDayProfit >= 5000) },
  { id: 'a_rep50', name: '小有名气', emoji: '⭐', desc: '口碑达到 50', reward: { cash: 250, bp: 2 },
    check: s => (s.rep >= 50) },
  { id: 'a_rep80', name: '全城打卡', emoji: '🔥', desc: '口碑达到 80', reward: { cash: 800, bp: 4 },
    check: s => (s.rep >= 80) },
  { id: 'a_rep95', name: '奶茶之神', emoji: '🏆', desc: '口碑达到 95', reward: { cash: 1800, bp: 8 },
    check: s => (s.rep >= 95) },
  { id: 'a_research3', name: '研发狂人', emoji: '🧪', desc: '解锁 4 款配方', reward: { cash: 300, bp: 2 },
    check: s => (s.recipes.length >= 4) },
  { id: 'a_research_all', name: '配方全收集', emoji: '📖', desc: '解锁全部 10 款配方', reward: { cash: 3000, bp: 12 },
    check: s => (s.recipes.length >= RECIPES.length) },
  { id: 'a_star', name: '星球特调', emoji: '🌌', desc: '研发出隐藏款「星球特调」', reward: { cash: 1200, bp: 6 },
    check: s => s.recipes.includes('star') },
  { id: 'a_shop', name: '连锁启航', emoji: '🏪', desc: '开设第 2 家分店', reward: { cash: 500, bp: 3 },
    check: s => (s.shops >= 2) },
  { id: 'a_shop4', name: '商业帝国', emoji: '🌐', desc: '开设 4 家分店', reward: { cash: 2000, bp: 8 },
    check: s => (s.shops >= 4) },
  { id: 'a_staff3', name: '招兵买马', emoji: '👥', desc: '同时雇佣 3 名员工', reward: { cash: 300, bp: 2 },
    check: s => (s.staff.length >= 3) },
  { id: 'a_staff6', name: '满编团队', emoji: '🧑‍🍳', desc: '同时雇佣 6 名员工', reward: { cash: 900, bp: 4 },
    check: s => (s.staff.length >= 6) },
  { id: 'a_speed8', name: '极致效率', emoji: '🚀', desc: '封口机升到满级', reward: { cash: 800, bp: 3 },
    check: s => (s.up.speed >= 8) },
  { id: 'a_decor8', name: '网红打卡地', emoji: '✨', desc: '门店装修升到满级', reward: { cash: 800, bp: 3 },
    check: s => (s.up.decor >= 8) },
  { id: 'a_baron', name: '抄底大师', emoji: '📉', desc: '在价格低于基准 30% 时买入原料', reward: { cash: 200, bp: 1 },
    check: s => !!s.flags.bargain },
  { id: 'a_nolost', name: '零流失日', emoji: '🎯', desc: '单日客流 ≥ 12 且 0 流失', reward: { cash: 600, bp: 3 },
    check: s => !!s.flags.perfectDay },
  { id: 'a_trend', name: '潮流捕手', emoji: '🎧', desc: '单日命中流行趋势卖出 20 杯以上', reward: { cash: 400, bp: 2 },
    check: s => !!s.flags.trendMaster },
  { id: 'a_rich', name: '身家过万', emoji: '💎', desc: '净资产突破 ¥10000', reward: { cash: 400, bp: 3 },
    check: s => (netWorth(s) >= 10000) },
  { id: 'a_rich2', name: '奶茶大亨', emoji: '🕶️', desc: '净资产突破 ¥50000', reward: { cash: 2000, bp: 10 },
    check: s => (netWorth(s) >= 50000) },
  { id: 'a_goal', name: '达成目标', emoji: '🎊', desc: '完成本局资产目标', reward: { cash: 0, bp: 15 },
    check: s => !!s.flags.goalHit },

  /* —— 客群 / 竞争 / 无尽 —— */
  { id: 'a_fivetypes', name: '宾客盈门', emoji: '🎪', desc: '单日接待全部 5 类顾客', reward: { cash: 700, bp: 4 },
    check: s => !!s.flags.fiveTypes },
  { id: 'a_bigorder', name: '全家桶', emoji: '🍻', desc: '完成一笔 4 杯的大单', reward: { cash: 300, bp: 2 },
    check: s => !!s.flags.bigOrder },
  { id: 'a_starmagnet', name: '自带流量体质', emoji: '📸', desc: '单日接待 5 位以上网红', reward: { cash: 500, bp: 3 },
    check: s => !!s.flags.starMagnet },
  { id: 'a_poach', name: '挖墙脚', emoji: '🕵️', desc: '从竞争对手处挖来 1 名员工', reward: { cash: 400, bp: 2 },
    check: s => !!s.flags.poached },
  { id: 'a_rivaldown', name: '一条街的王者', emoji: '👊', desc: '把对手口碑压到 10 以下', reward: { cash: 1500, bp: 6 },
    check: s => !!s.flags.rivalDown },
  { id: 'a_moat', name: '护城河', emoji: '🏰', desc: '产品差异化叠到 5 层', reward: { cash: 1200, bp: 5 },
    check: s => !!(s.rival && s.rival.proof >= 5) },
  { id: 'a_endless3', name: '无尽传说', emoji: '♾️', desc: '无尽模式达成第 3 个里程碑', reward: { cash: 3000, bp: 12 },
    check: s => !!(s.endless && (s.milestone || 0) >= 3) },
];

/* ---------- 难度 ---------- */
const DIFFICULTY = {
  easy:   { key: 'easy',   name: '佛系躺赢', emoji: '🌱', cash: 1100, goal: 22000, traffic: 1.15, costMult: 0.88, rentMult: 0.8,
            desc: '现金流宽松，适合先熟悉玩法' },
  normal: { key: 'normal', name: '标准创业', emoji: '🔥', cash: 700, goal: 38000, traffic: 1.0, costMult: 1.0, rentMult: 1.0,
            desc: '推荐首次挑战，需要认真经营' },
  hard:   { key: 'hard',   name: '地狱卷王', emoji: '💀', cash: 520, goal: 48000, traffic: 0.90, costMult: 1.15, rentMult: 1.22,
            desc: '成本高、客流少，建议攒够声望再挑战' },
};

/* ---------- 顾客形象 ---------- */
const CUSTOMER_FACES = ['🧑', '👩', '🧔', '👱‍♀️', '🧑‍🎓', '👩‍💼', '🧑‍🎤', '👧', '🧓', '👨‍🦱',
  '👩‍🦰', '🧑‍🦱', '👨‍🎓', '👩‍🎨', '🧑‍💻', '👩‍🔬', '🕵️', '👮', '🧑‍🍳', '👩‍⚕️'];

/* ============================================================
 *  顾客类型：决定「选哪杯 / 能不能接受这个价 / 等多久 / 买几杯」
 *  priceTol >1 = 对涨价更宽容；patienceMul 越大越有耐心；cups = 单次杯数区间
 * ============================================================ */
const CUSTOMER_TYPES = [
  {
    id: 'student', name: '学生党', emoji: '🧑‍🎓', weight: 30, color: '#FFD97D',
    prefer: ['sweet', 'fruity'], avoid: ['tea'], priceTol: 0.85, patienceMul: 1.3,
    cups: [1, 2], tipMul: 0.6, repMul: 0.8,
    desc: '预算有限、爱甜口，对涨价最敏感，但很有耐心。',
  },
  {
    id: 'worker', name: '打工人', emoji: '👩‍💼', weight: 27, color: '#9FD8FF',
    prefer: ['tea', 'milky'], avoid: ['sweet'], priceTol: 1.25, patienceMul: 0.68,
    cups: [1, 1], tipMul: 1.35, repMul: 1.0,
    desc: '赶时间、不差钱，最没耐心，给小费最爽快。',
  },
  {
    id: 'influencer', name: '网红', emoji: '🧑‍🎤', weight: 10, color: '#FF8FB1',
    prefer: [], avoid: [], priceTol: 1.5, patienceMul: 1.0, popBias: 1.4,
    cups: [1, 3], tipMul: 1.0, repMul: 2.2,
    desc: '只点人气款，几乎不看价，口碑影响力是别人的 2 倍。',
  },
  {
    id: 'family', name: '家庭客', emoji: '👨‍👩‍👧', weight: 15, color: '#7BD389',
    prefer: ['milky', 'fruity'], avoid: [], priceTol: 1.05, patienceMul: 1.45,
    cups: [2, 4], tipMul: 0.9, repMul: 1.2,
    desc: '一次点好几杯，最能等，是走量的主力。',
  },
  {
    id: 'elder', name: '街坊长辈', emoji: '🧓', weight: 18, color: '#C7A6FF',
    prefer: ['tea'], avoid: ['fresh'], priceTol: 0.72, patienceMul: 1.65,
    cups: [1, 1], tipMul: 0.45, repMul: 1.0,
    desc: '只喝传统茶味，价格一涨就走，但极其有耐心。',
  },
];

/* 天气 / 星期对客群权重的修正 */
const TYPE_WEATHER_BIAS = {
  hot: { student: 1.4, worker: 1.1, influencer: 1.0, family: 1.2, elder: 0.7 },
  cold: { student: 0.9, worker: 1.0, influencer: 0.8, family: 0.9, elder: 1.5 },
  rain: { student: 0.8, worker: 0.7, influencer: 0.5, family: 0.6, elder: 1.2 },
  storm: { student: 0.5, worker: 0.5, influencer: 0.4, family: 0.4, elder: 0.8 },
  sun: { student: 1.1, worker: 1.0, influencer: 1.2, family: 1.2, elder: 1.0 },
  cloud: { student: 1.0, worker: 1.0, influencer: 1.0, family: 1.0, elder: 1.0 },
};
function isWeekend(day) { return day % 7 === 0 || day % 7 === 6; }

/* ============================================================
 *  竞争对手
 * ============================================================ */
const RIVAL_NAMES = ['茶霸天', '一杯忘忧', '糖分研究所', '冰摇工坊', '鹿角巷口', '九块九茶铺'];
const RIVAL_ACTIONS = [
  { id: 'poach', name: '挖角对手员工', emoji: '🕵️', cost: 650, cd: 4,
    desc: '挖来一名高技能员工（免聘用费），对手口碑 -5。' },
  { id: 'adwar', name: '营销压制', emoji: '📢', cost: 420, cd: 2,
    desc: '对手口碑 -7，本店口碑 +1。' },
  { id: 'diff', name: '产品差异化', emoji: '💡', cost: 900, cd: 0,
    desc: '建立护城河：被对手抢走的客流永久 -6%（可叠加，上限 5 层）。' },
];

/* ---------- 无尽模式里程碑 ---------- */
function endlessGoal(baseGoal, milestone) {
  return Math.round(baseGoal * (1 + 0.55 * milestone));
}

/* ============================================================
 *  新手引导脚本
 *  sel    : 要高亮的 CSS 选择器（为空则居中顯示）
 *  tab    : 进入该步前自动切到的面板
 *  advance: 'next' 手动下一步 | 其它值 = 等待对应游戏事件自动推进
 *  hint   : 等待事件时的底部提示语
 * ============================================================ */
const TUTORIAL = [
  {
    key: 'welcome', tab: 'manage', sel: '', advance: 'next',
    title: '🎉 欢迎来到奶茶星球',
    text: '你接手了一家街边奶茶小店。<b>30 天</b>内把净资产做到目标金额就通关，<br>现金连续 2 天为负则破产。<br><br>花 30 秒跟我走一遍每天的循环，随时可跳过。',
  },
  {
    key: 'hud', tab: 'manage', sel: '[data-tut="cash"]', advance: 'next',
    title: '① 看懂顶部数据',
    text: '<b>现金</b>能花的钱 · <b>口碑</b>决定明天来多少人 · <b>净资产</b>是通关指标。<br>左上这些数字是你每天要看的第一件事。',
  },
  {
    key: 'advice', tab: 'manage', sel: '[data-tut="advice"]', advance: 'next',
    title: '② 今日建议（作弊条）',
    text: '它每天自动算出<b>库存够不够卖、产能够不够用</b>，还会指出哪种原料正在低价。<br>卡关的时候先看这里。',
  },
  {
    key: 'market', tab: 'manage', sel: '[data-tut="market"]', advance: 'buy',
    hint: '👉 试着点任意原料的 +10 买入',
    title: '③ 低价囤货',
    text: '五种原料价格<b>每天波动</b>。看到 <span style="color:var(--green)">▼ 绿色</span> 就多囤，涨回来就是纯利润。<br>仓库有容量上限，「⬆️ 升级」页可以扩容。',
  },
  {
    key: 'menu', tab: 'manage', sel: '[data-tut="menu"]', advance: 'toggle',
    hint: '👉 试着点一下任意配方卡（上架 / 下架 都算）',
    title: '④ 菜单与定价',
    text: '亮青色边框 = 已上架。<b>定价倍率</b>越高单杯赚得越多，但客人会流失、口碑会掉，<b>0.95~1.1</b> 是甜区。<br>带 🔥 标的是命中今日流行的款，销量 +55%。',
  },
  {
    key: 'grow', tab: 'manage', sel: '#tabs', advance: 'next',
    title: '⑤ 变强的五个方向',
    text: '<b>🧪 研发</b> 高价配方提升毛利<br><b>⬆️ 升级</b> 设备提产能 / 扩客流 / 开分店<br><b>👥 员工</b> 招人 = 直接 +1 出杯位<br><b>🏙️ 商圈</b> 看客群构成、反制竞争对手<br><b>🏅 成就</b> 攒现金与永久声望点',
  },
  {
    key: 'open', tab: 'manage', sel: '[data-tut="open"]', advance: 'open',
    hint: '👉 点「开门营业」开始今天',
    title: '⑥ 开门！',
    text: '营业时长约 26 秒。这半分钟是<b>唯一需要你手速的时刻</b>——<br>自动出杯很慢，产出的差额全靠你点出来。',
  },
  {
    key: 'station', tab: '', sel: '#stations', advance: 'rush',
    hint: '👉 有订单时疯狂点击！连点 5 次试试',
    title: '⑦ 点击加速（核心手感）',
    text: '每个方块是一个<b>出杯位</b>，有订单时<b>狂点它</b>可立即推进 30% 进度。<br>每次点击都有<b>小费</b>，连续点击累积 <b>🔥 连击</b>，小费最高翻倍。<br><br>⚠️ 排队超过等位座或等太久，客人会跑掉并扣口碑；<br>原料不够也会赶客，可用底部「🚚 紧急进货」救场。',
  },
  {
    key: 'boss', tab: '', sel: '#btnRush', advance: 'boss',
    hint: '👉 点「老板上阵」试试（键盘空格同效）',
    title: '⑧ 老板上阵大招',
    text: '8 秒内<b>全员出杯速度翻倍</b>，冷却 26 秒。<br>排队堆起来的时候放它最划算。',
  },
  {
    key: 'finish', tab: 'manage', sel: '[data-tut="goal"]', advance: 'next',
    title: '🎯 最后两件事',
    text: '打烊会结算 <b>营收 / 成本 / 净利 / 口碑</b>。<b>满意率 → 口碑 → 明天客流</b> 就是这个游戏的正循环。<br><br>任何时候都能去「⬆️ 升级」页 <b>♻️ 品牌升级</b>，把净资产换成<b>永久声望点</b>，下一局更快。<br>右下角「📖」可重看本教程。开工吧！',
  },
];

const TIPS = [
  '原料低价时多囤，隔天涨价就是纯利润。',
  '点击出杯位可以加速，手速就是产能。',
  '等位座不够时客人会直接走掉，装修很关键。',
  '定价倍率 0.9 左右最容易兼顾口碑与利润。',
  '员工体力低于 30% 效率会大幅下降。',
  '研发高价配方能显著提高单杯毛利。',
  '命中当日流行趋势，销量直接 +55%。',
  '现金流紧张时优先升「出杯速度」，回本最快。',
];

/* ============================================================
 *  按 id 建索引
 *  这些静态表是只读的，却在渲染、结算、E2E 测试里一遍又一遍地被按 id 线性查找。
 *  建一次 Map 让查找从 O(n) 降到 O(1)，同时把散落在各处的
 *  `XXX.find(x => x.id === id)` 样板收敛成具名取值函数。
 *  依赖：必须在本文件末尾 —— 上面所有静态数组定义完成之后才执行。
 * ============================================================ */
function buildIndex(list, key) {
  const m = new Map();
  for (const it of list) m.set(it[key], it);
  return m;
}
const ING_INDEX = buildIndex(ING, 'id');
const RECIPE_INDEX = buildIndex(RECIPES, 'id');
const UPGRADES_INDEX = buildIndex(UPGRADES, 'id');
const TRAITS_INDEX = buildIndex(TRAITS, 'id');
const WEATHER_INDEX = buildIndex(WEATHERS, 'id');
const EVENT_INDEX = buildIndex(EVENTS, 'id');
const CUSTOMER_TYPE_INDEX = buildIndex(CUSTOMER_TYPES, 'id');
const RIVAL_ACTION_INDEX = buildIndex(RIVAL_ACTIONS, 'id');

/** 取值一律返回 undefined（而不是抛错），调用方按需兜底 —— 与原来的 Array#find 行为一致 */
function ingById(id) { return ING_INDEX.get(id); }
function recipeById(id) { return RECIPE_INDEX.get(id); }
function upgradeById(id) { return UPGRADES_INDEX.get(id); }
function traitById(id) { return TRAITS_INDEX.get(id); }
function weatherById(id) { return WEATHER_INDEX.get(id); }
function eventById(id) { return EVENT_INDEX.get(id); }
function customerTypeById(id) { return CUSTOMER_TYPE_INDEX.get(id); }
function rivalActionById(id) { return RIVAL_ACTION_INDEX.get(id); }

/**
 * 味觉标签列表 → 中文串。
 * 原来只写在 H5 的 ui.js 里，导致小游戏版（Canvas 渲染）用不到、又得复制一份。
 * 这两个函数不依赖任何 DOM，是纯数据变换，放在这里两版共用。
 */
function tagNames(ids) {
  return (ids || []).map(id => (TAGS[id] ? TAGS[id].name : id)).join('/');
}
/** 特质的 emoji：工位 / 员工卡 / 候选人三处共用，未知 id 给空串而不是 undefined */
function traitEmoji(traitId) {
  const tr = traitById(traitId);
  return tr ? tr.emoji : '';
}
