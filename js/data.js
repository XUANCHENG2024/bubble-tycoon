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
  /* ---------- V13.9「抄底」判定阈值 ----------
   *★ 这个值是**实测定的**，不是拍脑袋：
   *  日常价格波动区间是 base × rnd(0.72, 1.36)（见 refreshMarket）。
   *  原判定写死 0.70 —— 比波动下限 0.72 还低，
   *  意味着「每天都看到绿色打折，但永远差一点到底」。
   *  实测 2000 天 × 32 种 = 64000 次采样：
   *    最低倍率 0.492（要碰上低价新闻才可能）
   *    ≤0.70 的采样点只占 0.30% → 30 天局约 8.8% 概率达成
   *  也就是 **90% 的玩家永远拿不到这个成就**。
   *
   *  ★ 为什么调阈值而不是放宽价格波动：
   *    价格波动区间是**全局平衡**（影响所有难度的毛利率），
   *    为一个成就去动它是本末倒置。
   *
   *  ★ 0.72 是**扫参扫出来的**（300 局 × 30 天，记录每天 32 种料里的最低价）：
   *      阈值   能见到的局   平均能见的天数
   *      0.70      92.7%         2.7 天    太难（7% 玩家永远拿不到）
   *      0.72      99.0%         4.1 天    ✔ 定这个
   *      0.74+    100.0%        20+ 天     太容易（每天都能抄底，机制失去意义）
   *    0.72 正好等于日常波动下限 —— 语义也干净：
   *    「这波跌到下限了，值得囤」。
   *  ★ 徽章展示与成就判定共用这个值：
   *    徽章亮了却没触发成就（或反之）会让玩家困惑。 */
  BARGAIN_RATIO: 0.72,
  /* ---------- V13.9 库存回购率 ----------
   * ★ 为什么必须有回购（没有它就是玩家无解的死局）：
   *   仓库满时买不进需要的料，而原来**没有任何清理途径** ——
   *   玩家看着满仓原料却什么都做不了。
   *   切城更致命：旧城专属料留在仓库里，新城买不到也用不上，
   *   却占着仓位让需要的料进不来。
   * ★ 为什么打折而不是免费丢弃：
   *   免费丢弃会让囤货毫无风险（反正丢不掉）；
   *   打折保留了「囤多了要付代价」的压力，
   *   同时给一条「急用钱时变现」的路（这本身也是决策）。
   * ★ 50% 的取舍：低于进价一半才亏，但不至于伤筋动骨。
   *   玩家急用 ¥5000 清掉 ¥3000 的货 →拿回 ¥1500，
   *   亏但能周转 —— 这是玩家自己做的选择，不是系统惩罚。 */
  LIQUID_RATE: 0.5,
  RUN_TOP_N: 5,            // 本机战绩榜保留的局数
  DAY_DURATION: 26,        // 营业阶段实时秒数
  LAST_CALL: 6,            // 打烊清场宽限秒数
  /* 营业中两个即时决策（V2）：每天各一次，用完即失效。
     26 秒营业原本只有"点点工位"一种操作，促销/下架给的是**时机判断** ——
     "看客流不对就清一波库存" / "备货押错了及时止损"。 */
  SALE_SECONDS: 8,         // 限时促销持续秒数
  SALE_TRAFFIC: 1.6,       // 促销期间客流乘子
  SALE_UNIT_SUB: 2,        // 促销期间每杯收入减 ¥2
  BASE_SERVICE: 1.35,      // 单杯基准耗时（秒）
  /* ★★ V21：员工培训改挂「降本」，不再挂「出杯速度」。
     ★ 原来 training 与 speed 是**同一个分母**：serviceRaw 里
       /(1+0.2·speed)/(1+0.12·training) —— 两条并排卖、互相贬值，
       而它们又都被 MIN_SERVICE(0.4s) 夹死：实测 D30 时 speed 已 9 级、
       easy 触底板只要 4 级，training 的加速完全被吃掉。
     ★ 改到「每杯成本」这条轴上，好处是它与 speed 不再争夺同一个分母，
       而且落在实测有效的轴上（成本 → 毛利，直接进净利）。
     ★ 4%/级 × 5 级 = −20% 原料成本。原料约占营收 25%，
       折合净利约 +5%，与 menu（ROI 1.51）同一量级，不至于变成必买项。 */
  TRAINING_COST_CUT: 0.04,
  MIN_SERVICE: 0.40,
  PACK_COST: 0.6,          // 每杯包装费
  /* ⚠️ V21 未落地的一项（试改后**主动回滚**，不是忘了）：
     ★ 发现的问题是真的：中期一天的原料消耗约 500~700 单位，420 的库容装不下，
       撞上限后 `buyIng` 整单拒绝 → 永远备不满 → 开张后大量缺料。
       用本轮新加的流失归因才看出来：全部流失里 **82~88% 是缺料**，
       而"等太久"0%、"没座位"0% —— 出杯速度 / 等位耐心 / 装修扩座**从未生效**。
       它还解释了：冷链仓库 ROI 6.77（其余升级 1.x~2.x）、"客流 +X%"的卡全是负收益、
       easy 档口碑最差（traffic ×1.15 让缺料更重）。
     ★ 试过改成 600（n=22 实测）：完成度整体抬升约 10~35pp，
       也就是三档目标全部要重标 —— 而目标那一轮刚刚定完。
     ★ 更麻烦的是同一批实验里出现「过渡破产」迹象，但**破产计数本身有 bug**
       （同一行输出里「11 局完整」与「破产 10」并存，12 局跑不出 21 局），
       所以"改库容会让 easy 更容易破产"这个结论**不成立、也未被证伪**。
     ★ 结论：在破产统计修好、目标能一起重标之前，**不动这个常量**。
       改动方案与顺序见 docs/reports/内容优化-第四轮-专家协作.md 第十节。
     ★★ 后来的扫描给出了参照系（关掉 storage 升级、只扫 BASE_STORAGE，normal 12 局）：
          总库容  420 → 均净 22439 / 过关  0%
                  600 → 均净 31302 / 过关  0%
                  780 → 均净 38755 / 过关  0%
                  960 → 均净 49865 / 过关 42%
                 1140 → 均净 54603 / 过关 92%   ← **阈值带在这里（960~1140）**
                 1320 → 均净 57284 / 过关 92%
       也就是说：**库容不是线性的"多一点好一点"，而是过阈值才起作用**。
       600 单独跨不过去（仍 0%）—— 它早前看起来有效，是因为 AI 还会继续买升级，
       最终落到 420+L4 = 1140 压线。
       所以"420 还是 600"这个争论本身问错了：真正决定生死的是**能不能摸到 960~1140**。
       这条参照系写在注释里，是为了下次不用重跑 12 局扫描才能判断某个库容改动的意义。 */
  BASE_STORAGE: 420,
  /* ★★ V21 分店改造：把扩张的收益从「需求端」挪到「供给端」。
     ★ 原来分店只给 +60% 客流（见 engine 的 trafficOf），而本作的瓶颈是**备货**：
       缺料占流失 82~89%，中间段"等太久/没座位"都是 0%。
       于是开分店 = 多来客人、但没有多料可卖 → 缺料 → 口碑崩 → 实测净资产 **−17.3%**，
       分店成了必亏项，而首次开分店正好在 D10~14。
     ★ 改成"每家分店 +500 库容、客流只 +20%"之后（同种子 A/B）：
       现状 −17.3% → **−3.8%**，且破产 0/20。
     ★ 为什么是 300 而不是 500：库容是**阈值型**（420/600/780 都 0% 过关，960 起 42%，
       1140 才 92%）。A/B 时用的 +500 是在"强制开店"口径下测的；换成自然口径后，
       AI 会自己开到 2 家店，+500 直接给到 1420（越过阈值太多），
       一键补货口径的产出从 ~6.2 万冲到 **7.7 万**（完成度 154%），
       而手搓口径只有 5.1 万 —— 两个口径被拉开 25k，目标再也定不准。
     ★ 300 的阶梯：1 店 720（仍在线下，扩张还不够）、2 店 1020（踏进 960~1140 阈值带）、
       3 店 1320（越过）。扩张收益横跨两次决策，且不会让"会点一键补货的人"一步登天。
     ★ 为什么客流降到 20% 而不是清零：砍到 0 反而更差（−15.7%）——
       客流加成本身值约 +12pp，前提是库容能兑现。客流是「条件性奖励」，不是纯惩罚。 */
  BRANCH_TRAFFIC: 0.20,
  BRANCH_STORAGE: 300,
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
  /* 品牌声望点 → 开局创业基金：基金 = RATE * √bp，封顶 CAP。
     用 √ 而不是线性，是为了让后期收益递减 —— 声望点曾经直接乘客流
     （线性且无上限），结果「需求涨、供给不涨」，参见 trafficOf 的注释。 */
  /* V10 重新标定：成就 ★ 总量从 150 涨到 239（新增 12 条城市/成就食谱成就）。
     资金曲线是 ⌊rate×√★⌋，封顶不变（900）——
     ★总量涨了但**满星时的开局资金不变**，否则老玩家与新玩家的差距会失控。
     rate 由 45 降到 30：原来的 45 在 239★ 时给 45×15.5≈¥700，
     对照 150★ 时的 45×12.2≈¥550，涨幅+27%；
     30 在 239★ 时给 30×15.5≈¥465，150★ 时 30×12.2≈¥366，涨幅 +27% 但绝对值更低，
     中位玩家（★100~150）的开局资金从 ¥450~550 降到 ¥300~366，
     与新增的 42 款城市菜带来的额外开销相称（城市菜造价高于通用菜）。 */
  BP_START_RATE: 30,
  BP_START_CAP: 900,
  /* 打烊三选一：每 CARD_EVERY 天抽一次，最多持有 CARD_MAX 张（抽完就停） */
  CARD_EVERY: 3,
  CARD_MAX: 6,
  CARD_OFFER_N: 3,
  /* 员工数上限。工位 = 1(老板) + 员工数 + (分店数-1)，上限同时约束
     ① hireStaff 与挖角的准入 ② sanitizeState 的截断 —— 两处必须同一个值，
     否则会出现「雇到第 21 人 → 存档 → 读档只剩 20 人」。
     （不约束绘制：两版舞台都是自适应 + 滚动，装不下会自己处理。） */
  STAFF_MAX: 20,
  /* 每日挑战日榜：
     - DAILY_LOG_MAX：本机保留多少天的成绩（迷你柱图取最近 7 天，留 14 天做余量；
       再长没必要，玩家也不会回头看一个月前的自己）。
     - RANK_SCORE_MAX：平台上报上限。抖音 tt.setImRankData 的 value 必须是
       [0, int32_MAX) 的正整数，超了直接报 invalid param。净资产单位是元、
       量级在万，正常玩到不了上限，但这道闸必须自己夹，不能指望平台。 */
  DAILY_LOG_MAX: 14,
  RANK_SCORE_MAX: 2147483647,
};

/* ---------- 原料 ----------
 *
 * ★ `origin`（城市专属原料的产地）—— 为什么加在**同一张表**而不是另开一张：
 *   原料参与了太多链路：采购价、库存、扣料、备货、进货建议、成本核算。
 *   另开一张"城市原料"表的话，每条链路都得写"先查主表再查城市表"的分支，
 *   漏一处就是"能做但买不到"或"扣料时读错价"这类静默 bug。
 *   放在同一张表，`origin` 只是**多一个筛选维度**，主流程一行都不用改。
 *
 *   origin = 城市 id（6 位）时：该原料**只在对应城市有货**（见 engine 的 ingAvailableAt）。
 *   origin 为空 = 全国都能买的基础原料。
 *
 *   base 是**基准成本**；城市原料的波动vol 更大（冷链/时效性），
 *   这也是"去外地开���"要承担的成本 —— 换个城市能吃到便宜原料，
 *   但卖的也是另一种菜，不是白赚。 */
const ING = [
  { id: 'tea',   name: '茶叶', emoji: '🍃', base: 1.0, vol: 0.16, color: '#7BD389' },
  { id: 'milk',  name: '牛奶', emoji: '🥛', base: 1.5, vol: 0.20, color: '#9FD8FF' },
  { id: 'sugar', name: '糖浆', emoji: '🍯', base: 0.5, vol: 0.24, color: '#FFD97D' },
  { id: 'pearl', name: '珍珠', emoji: '🫧', base: 1.6, vol: 0.30, color: '#C7A6FF' },
  { id: 'fruit', name: '鲜果', emoji: '🍓', base: 2.4, vol: 0.34, color: '#FF8FB1' },

  /* ---- 城市专属原料（只在产地城市有货）----
     成本比通用原料高一档：这既避免"全国随便买"削弱城市特色，
     也让"去成都才能做竹叶青"成为真实的取舍，而不是换个城市白赚。 */
  { id: 'tea_gj',  name: '陈皮普洱', emoji: '🍂', base: 3.2, vol: 0.30, color: '#C98A5B', origin: '440100' },
  { id: 'pomelo',  name: '新会陈皮', emoji: '🍊', base: 3.6, vol: 0.32, color: '#FFB26B', origin: '440700' },
  { id: 'inkfruit',name: '油柑果',   emoji: '🫒', base: 3.4, vol: 0.34, color: '#A8D26B', origin: '440300' },
  { id: 'osman',   name: '桂花糖',   emoji: '🌼', base: 2.6, vol: 0.22, color: '#FFD97D', origin: '320500' },
  { id: 'osman_tea', name: '本地窨茶', emoji: '🌿', base: 3.0, vol: 0.26, color: '#7BD389', origin: '320500' },
  { id: 'spicy',   name: '藤椒油',   emoji: '🌶️', base: 2.9, vol: 0.28, color: '#FF6B6B', origin: '510100' },
  { id: 'sichuan', name: '郫县豆瓣', emoji: '🫘', base: 3.4, vol: 0.30, color: '#C75B4B', origin: '510100' },
  { id: 'beeswax', name: '蜂王浆',   emoji: '🍯', base: 4.2, vol: 0.28, color: '#FFB26B', origin: '420100' },
  { id: 'rice',    name: '江米',     emoji: '🌾', base: 2.2, vol: 0.20, color: '#E8D9A0', origin: '420100' },
  { id: 'hami',    name: '哈密瓜',   emoji: '🍈', base: 3.0, vol: 0.36, color: '#9BD36B', origin: '650100' },
  { id: 'goji',    name: '宁夏枸杞', emoji: '🫐', base: 3.3, vol: 0.24, color: '#FF6B6B', origin: '640100' },
  { id: 'bayberry',name: '杨梅',emoji: '🫐', base: 3.8, vol: 0.42, color: '#E85D8A', origin: '330100' },
  { id: 'snowplum',name: '青梅',     emoji: '🫒', base: 3.1, vol: 0.38, color: '#B5D96B', origin: '330100' },
  { id: 'xianyang',name: '关中枣',   emoji: '🌰', base: 2.8, vol: 0.26, color: '#C98A5B', origin: '610100' },
  { id: 'chestnut',name: '商洛板栗', emoji: '🌰', base: 3.0, vol: 0.28, color: '#D9A566', origin: '610100' },
  { id: 'chillies',name: '剁椒',     emoji: '🌶️', base: 2.8, vol: 0.32, color: '#FF6B6B', origin: '430100' },
  { id: 'shrimp',  name: '河虾',     emoji: '🦐', base: 4.6, vol: 0.40, color: '#FF9F9F', origin: '430100' },
  { id: 'saffron', name: '藏红花',   emoji: '🌷', base: 5.2, vol: 0.30, color: '#FF8FB1', origin: '540100' },
  { id: 'butter',  name: '酥油',     emoji: '🧈', base: 3.7, vol: 0.26, color: '#FFE9A8', origin: '540100' },
  { id: 'mangosteen', name: '树熟果', emoji: '🍈', base: 4.0, vol: 0.38, color: '#B87FD9', origin: '460200' },
  { id: 'coconut',  name: '文昌椰',  emoji: '🥥', base: 3.3, vol: 0.34, color: '#C7A6FF', origin: '460200' },
  { id: 'urjujube', name: '和田红枣', emoji: '🌰', base: 2.9, vol: 0.22, color: '#C75B4B', origin: '650100' },
  { id: 'sglutinous', name: '太湖糯米', emoji: '🌾', base: 2.6, vol: 0.24, color: '#E8D9A0', origin: '320500' },
  { id: 'njrice', name: '南京米仁', emoji: '🍚', base: 2.5, vol: 0.22, color: '#F0E6C8', origin: '320100' },
  { id: 'sichuanpep', name: '汉源花椒', emoji: '🌰', base: 5.6, vol: 0.34, color: '#FF8F5B', origin: '510100' },
  { id: 'nanjing', name: '金陵金桂', emoji: '🌸', base: 3.5, vol: 0.28, color: '#FFD97D', origin: '320100' },
  { id: 'chenpi_cd', name: '川陈皮',  emoji: '🍂', base: 3.9, vol: 0.32, color: '#C98A5B', origin: '510100' },
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

/* ============================================================
 *  V9 菜系（Cuisine）与制作配套（工坊）
 *
 *  为什么要加这一层：现有的「口味标签」（TAGS）是**属性**维度 ——
 *  一款饮料可以同时是「奶香+浓郁」，两个标签的配方在经营上没有任何区别。
 *  菜系是**产品线**维度：经典奶茶 / 鲜果茶 / 咖啡 / 抹茶 / 甜品，
 *  它对应的是「门店的招牌品类」—— 这才是玩家真正会做的取舍。
 *
 *  两级分类的分工：
 *    菜系（cuisine）→ 决定**能不能做**：需要对应的制作工坊
 *    口味（tags）  → 决定**谁来买**：客群按口味偏好挑
 *  这样「做出来」和「卖得掉」变成两件独立的事，玩家得两头顾。
 *
 *  ★ 制作工坊是这套系统的配套核心，也是它区别于「纯加数值」的关键：
 *    工坊不是给全局加成，而是**生产资质** ——
 *    没有对应工坊，该菜系的配方**根本不能上架**。
 *    于是「研发一款新配方」不再只是花钱，而是要先有生产线，
 *    玩家的中期决策从「我该做什么」变成「我该开哪条产品线」。
 *    硬约束（而非软加成）的好处：不会像第一二批那样往经济里塞钱，
 *    改难度曲线（第一批的教训 1）。
 * ============================================================ */

/** 菜系：产品线。每款配方归属且仅归属一个菜系。 */
const CUISINES = [
  { id: 'classic', name: '经典奶茶系', emoji: '🧋', color: '#C7A6FF', desc: '走量基本盘，复购最稳' },
  { id: 'fruit',   name: '鲜果茶系',   emoji: '🍓', color: '#FF8FB1', desc: '夏季爆款，成本随鲜果波动' },
  { id: 'coffee',  name: '咖啡系',     emoji: '☕', color: '#FFB26B', desc: '打工人刚需，客单价高' },
  { id: 'matcha',  name: '抹茶系',     emoji: '🍵', color: '#7BD389', desc: '毛利最高，但小众' },
  { id: 'dessert', name: '甜品系',     emoji: '🍮', color: '#FFD97D', desc: '靠糖与珍珠取胜，成本敏感' },

  /* ---- 城市特色菜系（V10）----
     ★ `city` 非空 = 该菜系**只在对应城市存在**：
       在别的城市研发页看不到它、也做不出它的菜。
     ★ 为什么不塞进上面 5 个通用系（而是各成一个新系）：
       城市特色菜的**卖点是地域身份**，不是口味标签。
       若并入通用系（比如成都的藤椒菜算"鲜果茶系"），
       玩家在任何城市都能做，"来成都开���"这件事就没有意义了。
       独立成系还带来另一个好处：工坊是"每系一条产线"，
       城市系同样能开自己的产线，降本/权重加成一样成立。
     ★ 数量克制在 14 座重点城市 —— 现有 CITIES 有 272 座，
       若每城都配一套，数据量与实际游玩频次严重不匹配
       （一局 30 天，玩家最多去过一两个城市）。
       其余城市走通用系 + 当地原料的通用组合，不做独有系。 */
  { id: 'gz_canton',  name: '广府凉茶系', emoji: '🍵', color: '#8FD9B6', city: '440100', desc: '广州 · 清润为先，药材与糖水底子' },
  { id: 'xs_chenpi',  name: '新会陈皮系', emoji: '🍊', color: '#FFB26B', city: '440700', desc: '江门 · 陈皮入茶，理气助消化' },
  { id: 'sz_yingcha', name: '潮汕工夫系', emoji: '🫖', color: '#C98A5B', city: '440300', desc: '深圳 · 油柑与单丛，冷萃耐泡' },
  { id: 'su_osman',   name: '苏式桂花系', emoji: '🌼', color: '#FFD97D', city: '320500', desc: '苏州 · 窨茶与桂花糖，香气内敛' },
  { id: 'nj_luyu',    name: '金陵茶饮系', emoji: '🌸', color: '#FFB6C1', city: '320100', desc: '南京 · 桂花鸭血风味的本地茶底' },
  { id: 'hz_bayberry',name: '杭帮果茶系', emoji: '🫐', color: '#E85D8A', city: '330100', desc: '杭州 · 杨梅与青梅，时令性极强' },
  { id: 'cd_rattan',  name: '巴蜀麻辣系', emoji: '🌶️', color: '#FF6B6B', city: '510100', desc: '成都 · 藤椒与豆瓣，重口但复购高' },
  { id: 'wh_honeymilk', name: '江汉蜜乳系', emoji: '🍯', color: '#FFCF6B', city: '420100', desc: '武汉 · 蜂王浆与江米，温润挂喉' },
  { id: 'cs_chili',   name: '湘味辛香系', emoji: '🌶️', color: '#FF8F5B', city: '430100', desc: '长沙 · 剁椒与河虾，香得直接' },
  { id: 'xa_guokui',  name: '关中枣茶系', emoji: '🌰', color: '#C98A5B', city: '610100', desc: '西安 · 关中枣与板栗，秋冬进补' },
  { id: 'ur_melon',   name: '西域蜜瓜系', emoji: '🍈', color: '#9BD36B', city: '650100', desc: '乌鲁木齐 · 哈密瓜与枸杞，甜度爆表' },
  { id: 'lz_saffron', name: '高原酥油系', emoji: '🧈', color: '#FFE9A8', city: '540100', desc: '拉萨 · 藏红花与酥油，御寒暖身' },
  { id: 'sanya_tropic', name: '椰林热带系', emoji: '🥥', color: '#C7A6FF', city: '460200', desc: '三亚 · 椰与树熟果，清凉度假风' },
  { id: 'yc_goji',    name: '宁夏杞饮系', emoji: '🫐', color: '#FF6B6B', city: '640100', desc: '银川 · 枸杞与清真奶，养生路线' },
];

/**
 * 制作工坊：每个菜系一条生产线。
 * 等级决定该菜系配方能不能上架（level 0 = 不能），以及上架后的销量权重加成。
 * 建成成本随等级递增 —— 开第二条线是**大额、长期**的投入，
 * 这正是它能形成中期决策的原因（而不是随手点一下就有的加成）。
 */
/* ★ 造价必须与玩家的**实际现金流**匹配，不是与"感觉上很重"匹配。
     初版把 1 级工坊定在 ¥1200~1900，而同期的设备 1 级只要 ¥200~450 ——
     贵了一个数量级。实测（tools/diag-workshop.js 带 TRACE）：
     玩家现金长期在 ¥1000~2000 徘徊，**永远攒不到开第二条线的钱**，
     整个工坊系统成了"看得见用不上"的死功能。
     现在 1 级定在 ¥600~900（与「招牌展位 +1」同量级，玩家跳一跳够得着），
     2 级 ¥1500~2500，3 级 ¥3500~6000（与设备满级同量级，属于中期大件）。
     系数差异保留：越"小众"的菜系（咖啡/抹茶）开线越贵。 */
/* ★ 1 级造价必须让**最难难度的玩家也开得起第二条线**。
     hard 开局现金只有 ¥520，若 1 级工坊要 ¥600，玩家掏空周转金就破产，
     于是永远只能做 classic 系那 4 款 —— 工坊系统对 hard 成了纯负担
     （配对实测 hard 达标率被拖掉 11pp：76%→65%）。
     现在 1 级定在 ¥350~500：hard 掏得出来、normal/easy 更轻松，
     而「开多条线要占多少现金」仍由 2/3 级的 ¥1500~6000 体现。 */
/* ★ 收益设计（这是本系统最关键、也反复最多次的一处）：
     初版把工坊做成**硬约束**（没工坊 → 该系配方不能上架/研发）——
     实测证明那是错的：11/14 款配方都多一道前置，研发曲线被拉长，
     且「不玩这个系统」等于**不能玩**（配对实测 hard 掉 11pp）。
     改成软约束后又发现第二个问题：**收益太弱，买了没人买**。
       Lv.1 成本 ¥400，收益是「该系研发费 -25%」= 一款入门款省 ¥80；
       Lv.2 成本 ¥1400，收益是「销量权重 +8%」≈ 30 天多卖 24 杯 ≈ ¥600。
     投入产出比太差 → 玩家（和 sim 的 AI）自然不会开线，
     实测「开 1 条线」的破产率反而比「不开线」高（钱花了、菜单还是空的）。
     现在给的是**够量**的收益（Lv.1 就有 +8% 权重 + 30% 研发折扣，
     Lv.3 再加 18% 高端款加成），三层都只是"更好卖 / 更便宜"，
     从不把门关上。于是工坊是**可选的经营深度**：开了更好，不开照旧玩，
     既有玩法一点没被削弱，新维度是「加」上去的而不是「换」掉的。 */
/* tier3Bonus 字段 = 该菜系**高端款**的销量权重加成（需工坊 Lv.3）。
   它原先是「解锁许可」（没工坊就不能做高端款），被两轮配对实测证伪后改成加成，
   详见下方 CRAFT_WORKSHOPS 的注释。 */
/**
 * 制作工坊（CRAFT_WORKSHOPS）：每条菜系一条产线，四层收益：
 *   ① researchCut —— 该系研发费折扣（Lv.1 起）        「把钱花在刀刃上」
 *   ② costCut     —— 该系配方每杯成本下降（随等级）  「自家产线，料更省」
 *   ③ saleBonus   —— 该系配方销量权重加成（随等级递增）「做出来的更抢手」
 *   ④ tier3Bonus  —— 该系**高端款**销量权重加成（Lv.3）  「旗舰产线的门面」
 *
 * ★ 为什么 ②「降成本」是必备层（不是可选项）—— 一条被参数扫描证实的教训：
 *   工坊最初只有权重加成（相对量）。用 tools/diag-sweep.js 扫过
 *   saleBonus 从 0.08 一直到 0.68（8 倍），结果 AI **一次线都没开**（产线恒 1.00 条）。
 *   账算得出来：Day 30 日销约 71 杯，权重 +12% 只是把该系占比从 50% 拉到 56%
 *   （≈ 多卖 4 杯/天），而 Lv.2 造价 ¥900 —— 20 天也赚不回来。
 *   根因：**权重是相对量，永远不抬客流总量**，收益有天然天花板，
 *   而造价是绝对量。凡是"加成型"收益配"绝对量"成本，理性玩家都不会买。
 *   成本下降才是绝对量：直接进每杯毛利，且**与销量无关**（卖得越多越赚）。
 *   数值由 tools/diag-sweep.js 参数扫描定标（每档 30 局固定种子配对，
 *   与 diag-invest.js 交叉验证一致；最终取 0.16/0.27）：
 *     cut 0.14/0.24 → easy +16.3pp
 *     cut 0.16/0.27 → **easy +21.0 / normal −2.3 / hard +1.1pp**✅ 产线 2.6~3.5 条
 *     cut 0.18/0.30 → easy +21.2 / normal −0.2 / hard +0.7pp（但 easy 破产 3/30）
 *     cut 0.20/0.34 → easy +20.8pp（产线 3.87，已过头）
 *   选 0.16/0.27 而非净值更高的 0.18：它在**三个难度上破产率都降到 0**
 *   （0.18 在 easy 仍有 3/30）。对玩家来说"不破产"比"多 2pp 净值"重要得多。
 *   easy 的 +21pp 不是数值放过头 —— 扫 0.14~0.20 全区间都是 +16~+21pp，
 *   且简单难度本就该给正反馈（它是让玩家熟悉这套系统的难度）。
 *
 * ★ 这组数字之前曾测出「+1.5pp / 产线 2.46」，是**假结论**，两个原因：
 *   ① sweep 的 mutator 顺手把工坊从 4 级砍成 3 级（cost 长度 4→3），
 *      测的是一个虚构配置；② 它与 diag-invest.js 各写一份关闭清单，
 *      基线条件不一致（差 13pp）。两者都已修：mutator 只覆盖被扫维度，
 *      关闭清单抽到共享模块 tools/v9-off.js，并由 v9OffLeakCheck() 强制自检。
 *
 * ★ 第四层为什么是「加成」而不是「解锁许可」（这段结论花了两轮实测）：
 *   初版把高端款（tier3+）设成"必须有旗舰工坊才能研发"，
 *   后来把门槛从 Lv.3 降到 Lv.2 —— 两次都被配对实测证伪。
 *   逐款诊断（tools/diag-invest.js）的证据：
 *     6 款 tier3 配方在开系统的组里，解锁局数 18~19/20 **→ 0/20**。
 *   门槛不是"太早"或"太高"，是**方向错了**：
 *     理性玩家 30 天攒不出第二条线的钱，门槛就等于永久锁死 40% 配方表，
 *     而且玩家不会知道自己被锁了（研发页只写"现金不足"）。
 *   与 canListRecipe 同原则：**能不能做归既有玩法，做得好不好才是新维度。**
 */
const CRAFT_WORKSHOPS = [
  { id: 'classic', name: '经典奶茶工坊', emoji: '🧋', cost: [0, 260, 900, 2000], costCut: [0, 0.16, 0.27, 0.34], saleBonus: [0, 0.08, 0.20, 0.34], researchCut: 0.30, tier3Bonus: 0.18 },
  { id: 'fruit',   name: '鲜果茶工坊',   emoji: '🍓', cost: [0, 300, 1000, 2200], costCut: [0, 0.16, 0.27, 0.34], saleBonus: [0, 0.08, 0.20, 0.34], researchCut: 0.30, tier3Bonus: 0.18 },
  { id: 'coffee',  name: '咖啡工坊',     emoji: '☕', cost: [0, 380, 1250, 2700], costCut: [0, 0.16, 0.27, 0.34], saleBonus: [0, 0.08, 0.20, 0.34], researchCut: 0.30, tier3Bonus: 0.18 },
  { id: 'matcha',  name: '抹茶工坊',     emoji: '🍵', cost: [0, 360, 1200, 2600], costCut: [0, 0.16, 0.27, 0.34], saleBonus: [0, 0.08, 0.20, 0.34], researchCut: 0.30, tier3Bonus: 0.18 },
  { id: 'dessert', name: '甜品工坊',     emoji: '🍮', cost: [0, 320, 1050, 2300], costCut: [0, 0.16, 0.27, 0.34], saleBonus: [0, 0.08, 0.20, 0.34], researchCut: 0.30, tier3Bonus: 0.18 },

  /* ---- 城市特色系工坊（V10）----
     ★ 造价统一比通用系**贵一档**（1 级 ¥420 vs ¥260~380）：
       城市菜的原料更贵、波动更大（冰鲜/时效），
       产线理应更贵 —— 这也让"要不要为了城市味多花一笔"成为真取舍。
     ★ 降本幅度**更高**（Lv.1 就 −18%）：城市系的原料成本占比大，
       自有产线的省料收益理应更显著，否则盖不住更高的造价。
     ★ researchCut 只有 20%（低于通用系 30%）：
       城市配方本身材料就贵，研发费再打 3 折会让"研发城市菜"变成纯优选，
       反而抹掉了"换城市要重新投入"的成本感。 */
  { id: 'gz_canton',    name: '广府凉茶工坊',   emoji: '🍵', cost: [0, 420, 1250, 2600], costCut: [0, 0.18, 0.29, 0.36], saleBonus: [0, 0.10, 0.22, 0.36], researchCut: 0.20, tier3Bonus: 0.20 },
  { id: 'xs_chenpi',    name: '新会陈皮工坊',   emoji: '🍊', cost: [0, 420, 1250, 2600], costCut: [0, 0.18, 0.29, 0.36], saleBonus: [0, 0.10, 0.22, 0.36], researchCut: 0.20, tier3Bonus: 0.20 },
  { id: 'sz_yingcha',   name: '潮汕工夫工坊',   emoji: '🫖', cost: [0, 420, 1250, 2600], costCut: [0, 0.18, 0.29, 0.36], saleBonus: [0, 0.10, 0.22, 0.36], researchCut: 0.20, tier3Bonus: 0.20 },
  { id: 'su_osman',     name: '苏式桂花工坊',   emoji: '🌼', cost: [0, 420, 1250, 2600], costCut: [0, 0.18, 0.29, 0.36], saleBonus: [0, 0.10, 0.22, 0.36], researchCut: 0.20, tier3Bonus: 0.20 },
  { id: 'nj_luyu',      name: '金陵茶饮工坊',   emoji: '🌸', cost: [0, 420, 1250, 2600], costCut: [0, 0.18, 0.29, 0.36], saleBonus: [0, 0.10, 0.22, 0.36], researchCut: 0.20, tier3Bonus: 0.20 },
  { id: 'hz_bayberry',  name: '杭帮果茶工坊',   emoji: '🫐', cost: [0, 420, 1250, 2600], costCut: [0, 0.18, 0.29, 0.36], saleBonus: [0, 0.10, 0.22, 0.36], researchCut: 0.20, tier3Bonus: 0.20 },
  { id: 'cd_rattan',    name: '巴蜀麻辣工坊',   emoji: '🌶️', cost: [0, 440, 1300, 2700], costCut: [0, 0.18, 0.29, 0.36], saleBonus: [0, 0.10, 0.22, 0.36], researchCut: 0.20, tier3Bonus: 0.20 },
  { id: 'wh_honeymilk', name: '江汉蜜乳工坊',   emoji: '🍯', cost: [0, 420, 1250, 2600], costCut: [0, 0.18, 0.29, 0.36], saleBonus: [0, 0.10, 0.22, 0.36], researchCut: 0.20, tier3Bonus: 0.20 },
  { id: 'cs_chili',     name: '湘味辛香工坊',   emoji: '🌶️', cost: [0, 440, 1300, 2700], costCut: [0, 0.18, 0.29, 0.36], saleBonus: [0, 0.10, 0.22, 0.36], researchCut: 0.20, tier3Bonus: 0.20 },
  { id: 'xa_guokui',    name: '关中枣茶工坊',   emoji: '🌰', cost: [0, 420, 1250, 2600], costCut: [0, 0.18, 0.29, 0.36], saleBonus: [0, 0.10, 0.22, 0.36], researchCut: 0.20, tier3Bonus: 0.20 },
  { id: 'ur_melon',     name: '西域蜜瓜工坊',   emoji: '🍈', cost: [0, 420, 1250, 2600], costCut: [0, 0.18, 0.29, 0.36], saleBonus: [0, 0.10, 0.22, 0.36], researchCut: 0.20, tier3Bonus: 0.20 },
  { id: 'lz_saffron',   name: '高原酥油工坊',   emoji: '🧈', cost: [0, 440, 1300, 2700], costCut: [0, 0.18, 0.29, 0.36], saleBonus: [0, 0.10, 0.22, 0.36], researchCut: 0.20, tier3Bonus: 0.20 },
  { id: 'sanya_tropic', name: '椰林热带工坊',   emoji: '🥥', cost: [0, 420, 1250, 2600], costCut: [0, 0.18, 0.29, 0.36], saleBonus: [0, 0.10, 0.22, 0.36], researchCut: 0.20, tier3Bonus: 0.20 },
  { id: 'yc_goji',      name: '宁夏杞饮工坊',   emoji: '🫐', cost: [0, 420, 1250, 2600], costCut: [0, 0.18, 0.29, 0.36], saleBonus: [0, 0.10, 0.22, 0.36], researchCut: 0.20, tier3Bonus: 0.20 },
];

/**
 * 开局赠送的工坊。
 *
 * ★ 这不是"送钱"，而是**让第一条产品线立刻成立**：
 *   工坊的收益是「降本 + 权重 + 研发折扣」，但这些都要**先有那条系的配方**才生效。
 *   三个难度的开局现金（easy 1100 / normal 700 / hard 520）都买不起第二条线，
 *   而开局只有「经典珍珠奶茶」一款配方（classic 系）。
 *   不给赠送工坊的话，玩家第一笔钱只能用于研发/设备，
 *   而降本/权重这些收益要等到有配方才拿得到 —— 前期几乎感知不到这套系统，
 *   「工坊」变成一个要攒很久才想起它的机制。
 *   语义上也说得通：老店本来就会做珍珠奶茶这一款。
 *   注意：给的只是 Lv.1（够用），要开第二条线仍然得自己掏钱。
 */
const WORKSHOP_START = { classic: 1 };

/**
 * 主打菜系加成：菜单上**同一菜系**的配方越多，整体越畅销。
 * 这是菜系层的「集中经营」奖励，和招牌配方（单品层）形成两个维度的取舍：
 *   广度流 —— 每个菜系都开一条线，配方多、客群覆盖全
 *   深度流 —— 只做一两个菜系，销量更集中
 * 阈值设计成 2/3 款，因为 2 款是「能做出一条产品线」的最低门槛，
 * 4 款以上几乎不可能（菜单位上限只有 8）。
 */
const CUISINE_FOCUS = [
  { need: 2, bonus: 0.06, label: '双拼' },
  { need: 3, bonus: 0.12, label: '三连' },
  { need: 4, bonus: 0.18, label: '全系' },
];

/* ---------- 配方 ---------- */
const RECIPES = [
  { id: 'boba', name: '经典珍珠奶茶', emoji: '🧋', tags: ['milky', 'rich'], pop: 100, cuisine: 'classic',
    req: { tea: 2, milk: 2, pearl: 1, sugar: 1 }, price: 22, tier: 1, unlocked: true,
    desc: '街边小店的生命线，永远不会错的选择。' },
  { id: 'greentea', name: '芝士奶盖绿茶', emoji: '🍵', tags: ['tea', 'fresh'], pop: 84, cuisine: 'classic',
    req: { tea: 3, milk: 1, sugar: 1 }, price: 19, tier: 1,
    research: { cash: 150, ing: { tea: 10, milk: 6 } },
    desc: '低成本入门款，利润空间薄但走量。' },
  { id: 'passion', name: '满杯百香果', emoji: '🥭', tags: ['fruity', 'fresh'], pop: 94, cuisine: 'fruit',
    req: { tea: 1, fruit: 3, sugar: 1 }, price: 26, tier: 1,
    research: { cash: 150, ing: { fruit: 8, tea: 4 } },
    desc: '夏天的人气王，鲜果便宜时血赚。' },
  { id: 'taro', name: '芋泥波波', emoji: '🍠', tags: ['milky', 'rich'], pop: 90, cuisine: 'classic',
    req: { milk: 3, pearl: 2, sugar: 2 }, price: 28, tier: 2,
    research: { cash: 420, ing: { milk: 18, pearl: 12 } },
    desc: '扎实管饱，冬天与寒流天的宠儿。' },
  { id: 'coco', name: '生椰拿铁', emoji: '🥥', tags: ['milky', 'rich'], pop: 98, cuisine: 'coffee',
    req: { milk: 3, tea: 2 }, price: 24, tier: 2,
    research: { cash: 260, ing: { milk: 12, tea: 8 } },
    desc: '打工人续命水，复购率极高。' },
  { id: 'grape', name: '青提冰茶', emoji: '🍇', tags: ['fruity', 'fresh'], pop: 92, cuisine: 'fruit',
    req: { fruit: 2, tea: 2, sugar: 1 }, price: 25, tier: 2,
    research: { cash: 460, ing: { fruit: 16, tea: 12 } },
    desc: '清爽解腻，高温天直接起飞。' },
  { id: 'matcha', name: '抹茶奶绿', emoji: '🍡', tags: ['tea', 'milky'], pop: 102, cuisine: 'matcha',
    req: { tea: 2, milk: 2, sugar: 2 }, price: 26, tier: 2,
    research: { cash: 280, ing: { tea: 12, milk: 9 } },
    desc: '颜值担当，拍照发圈自带流量。' },
  { id: 'brownsugar', name: '黑糖鹿丸', emoji: '🍮', tags: ['sweet', 'rich'], pop: 114, cuisine: 'dessert',
    req: { pearl: 3, milk: 2, sugar: 2 }, price: 32, tier: 3,
    research: { cash: 520, ing: { pearl: 14, milk: 10, sugar: 8 } },
    desc: '爆款潜质，甜党见了走不动路。' },
  { id: 'sakura', name: '樱花荔枝饮', emoji: '🌸', tags: ['fruity', 'sweet'], pop: 122, cuisine: 'fruit',
    req: { fruit: 3, milk: 1, sugar: 2 }, price: 34, tier: 3,
    research: { cash: 1050, ing: { fruit: 26, milk: 12, sugar: 12 } },
    desc: '限定颜值款，溢价能力拉满。' },
  { id: 'star', name: '星球特调', emoji: '🌌', tags: ['fruity', 'milky', 'tea', 'fresh', 'rich', 'sweet'], pop: 168, cuisine: 'dessert',
    req: { tea: 2, milk: 2, fruit: 2, pearl: 1, sugar: 1 }, price: 46, tier: 4,
    research: { cash: 2400, ing: { tea: 20, milk: 20, fruit: 20, pearl: 16, sugar: 12 } },
    desc: '隐藏传说款：通吃所有流行趋势。' },
  /* ---- V9 新增：为每个菜系补足 2 款以上，让「主打菜系」成立 ----
     数值口径与同类老配方对齐（pop 略低于同档、售价与成本结构相近），
     刻意**不**做成"更强的新品"—— 新配方的价值是**给菜系提供第二条腿**，
     而不是数值碾压。 */
  { id: 'taro2', name: '芋圆鲜奶', emoji: '🟣', tags: ['milky', 'rich'], pop: 96, cuisine: 'classic',
    req: { milk: 3, pearl: 2, sugar: 1 }, price: 27, tier: 2,
    research: { cash: 560, ing: { milk: 20, pearl: 14, sugar: 8 } },
    desc: '经典奶系第二款：珍珠换芋圆，客群重叠度高。' },
  { id: 'lime', name: '鸭屎香柠檬茶', emoji: '🍋', tags: ['tea', 'fresh'], pop: 106, cuisine: 'fruit',
    req: { tea: 3, fruit: 2, sugar: 2 }, price: 29, tier: 3,
    research: { cash: 880, ing: { tea: 18, fruit: 20, sugar: 12 } },
    desc: '果茶系第二款：香水柠檬配茶底，清爽系客群。' },
  { id: 'latte', name: '厚乳拿铁', emoji: '☕', tags: ['milky', 'rich'], pop: 108, cuisine: 'coffee',
    req: { milk: 3, tea: 2, sugar: 1 }, price: 30, tier: 3,
    research: { cash: 920, ing: { milk: 22, tea: 16, sugar: 8 } },
    desc: '咖啡系第二款：厚乳基底，客单价高但奶耗大。' },
  { id: 'matcha2', name: '抹茶红豆冰', emoji: '🍵', tags: ['tea', 'sweet'], pop: 100, cuisine: 'matcha',
    req: { tea: 2, milk: 1, sugar: 2 }, price: 28, tier: 3,
    research: { cash: 860, ing: { tea: 20, milk: 10, sugar: 14 } },
    desc: '抹茶系第二款：不加珍珠，走清爽路线。' },
  { id: 'taro3', name: '双皮奶冻', emoji: '🥛', tags: ['sweet', 'milky'], pop: 104, cuisine: 'dessert',
    req: { milk: 3, sugar: 2, pearl: 1 }, price: 30, tier: 3,
    research: { cash: 900, ing: { milk: 22, sugar: 14, pearl: 10 } },
    desc: '甜品系第二款：奶冻加珍珠，与黑糖鹿丸共用甜品客群。' },

/* ============================================================
 *  V10：城市特色食谱（追加进 RECIPES）
 *
 *  ★ `city` 非空 = 该食谱**只在所属城市可用**：
 *    在别的城市，研发页不显示它、也做不出它（见 engine.recipeAvailableAt）。
 *  ★ 定价明显高于通用菜（¥24~38 vs ¥19~32）：
 *    城市原料更贵（冰鲜 / 时效 / 冷链），若定价持平，
 *    「去外地开厂」就成了纯优选 —— 地域取舍必须真的有代价。
 *  ★ tier 直接复用为**研发阶段**（1~3），与 RESEARCH_TREE.stage 一致，
 *    避免两处数字各说各话。
 * ============================================================ */
  { id: 'gz_lishui', name: '癍痧凉茶', emoji: '🌿', tags: ['tea', 'fresh'], pop: 92, cuisine: 'gz_canton',
    req: { tea_gj: 2, sugar: 2 }, price: 29, tier: 1, city: '440100',
    research: { cash: 540, ing: { tea_gj: 10, sugar: 10 } },
    desc: '广府系入门：本地陈皮配茶叶，清润不燥。' },
  { id: 'gz_shuangjiang', name: '双皮奶盏', emoji: '🥛', tags: ['milky', 'sweet'], pop: 98, cuisine: 'gz_canton',
    req: { milk: 3, sugar: 2, tea_gj: 1 }, price: 30, tier: 2, city: '440100',
    research: { cash: 860, ing: { milk: 15, sugar: 10, tea_gj: 5 } },
    desc: '广府系第二款：奶皮配陈皮茶底，甜口路线。' },
  { id: 'gz_qinggua', name: '广府五花茶', emoji: '🍵', tags: ['tea', 'fresh'], pop: 104, cuisine: 'gz_canton',
    req: { tea_gj: 1, sugar: 2 }, price: 33, tier: 3, city: '440100',
    research: { cash: 1120, ing: { tea_gj: 10, sugar: 5 } },
    desc: '广府系第三款：陈皮与本地茶叶同煮，去油解腻。' },
  { id: 'xs_chenpitea', name: '新会陈皮茶', emoji: '🍊', tags: ['tea', 'rich'], pop: 96, cuisine: 'xs_chenpi',
    req: { pomelo: 2, tea: 2 }, price: 30, tier: 1, city: '440700',
    research: { cash: 540, ing: { pomelo: 10, tea: 10 } },
    desc: '新会系入门：三年陈皮单泡，香气厚。' },
  { id: 'xs_xianru', name: '柑香鲜乳', emoji: '🥛', tags: ['milky', 'fruity'], pop: 102, cuisine: 'xs_chenpi',
    req: { milk: 3, pomelo: 2, sugar: 1 }, price: 32, tier: 2, city: '440700',
    research: { cash: 860, ing: { milk: 15, pomelo: 10, sugar: 5 } },
    desc: '新会系第二款：柑皮配厚乳，暖胃路线。' },
  { id: 'xs_laobian', name: '陈皮绿豆沙', emoji: '🍮', tags: ['sweet', 'fresh'], pop: 108, cuisine: 'xs_chenpi',
    req: { pomelo: 1, sugar: 3 }, price: 34, tier: 3, city: '440700',
    research: { cash: 1120, ing: { pomelo: 5, sugar: 15 } },
    desc: '新会系第三款：广式糖水底，去暑招牌。' },
  { id: 'sz_dancong', name: '凤凰单丛', emoji: '🫖', tags: ['tea', 'fresh'], pop: 100, cuisine: 'sz_yingcha',
    req: { tea: 3, inkfruit: 1 }, price: 30, tier: 1, city: '440300',
    research: { cash: 540, ing: { tea: 15, inkfruit: 5 } },
    desc: '潮汕工夫入门：单丛配油柑，先香后回甘。' },
  { id: 'sz_huicha', name: '潮式乌龙奶茶', emoji: '🧋', tags: ['milky', 'tea'], pop: 106, cuisine: 'sz_yingcha',
    req: { tea: 3, milk: 2, inkfruit: 1 }, price: 32, tier: 2, city: '440300',
    research: { cash: 860, ing: { tea: 15, milk: 10, inkfruit: 5 } },
    desc: '潮汕系第二款：工夫茶底转奶茶，受众更广。' },
  { id: 'sz_niuyecha', name: '油柑冷萃', emoji: '🫒', tags: ['fresh', 'fruity'], pop: 110, cuisine: 'sz_yingcha',
    req: { inkfruit: 3, tea: 1, sugar: 2 }, price: 36, tier: 3, city: '440300',
    research: { cash: 1120, ing: { inkfruit: 15, tea: 5, sugar: 10 } },
    desc: '潮汕系第三款：油柑现萃，酸涩回甘两段。' },
  { id: 'su_guixia', name: '桂花窨茶', emoji: '🌼', tags: ['tea', 'fresh'], pop: 94, cuisine: 'su_osman',
    req: { osman_tea: 2, osman: 2 }, price: 29, tier: 1, city: '320500',
    research: { cash: 540, ing: { osman_tea: 10, osman: 10 } },
    desc: '苏式系入门：本地窨茶配桂花糖。' },
  { id: 'su_liusheng', name: '六窨鲜奶茶', emoji: '🥛', tags: ['milky', 'tea'], pop: 100, cuisine: 'su_osman',
    req: { osman_tea: 2, milk: 2, osman: 1 }, price: 31, tier: 2, city: '320500',
    research: { cash: 860, ing: { osman_tea: 10, milk: 10, osman: 5 } },
    desc: '苏式系第二款：多次窨制的茶底，香气层次足。' },
  { id: 'su_lianhua', name: '桂花酒酿', emoji: '🍶', tags: ['sweet', 'fresh'], pop: 106, cuisine: 'su_osman',
    req: { osman: 2, sglutinous: 2, sugar: 2 }, price: 34, tier: 3, city: '320500',
    research: { cash: 1120, ing: { osman: 10, sglutinous: 10, sugar: 10 } },
    desc: '苏式系第三款：桂花配酒酿米，江南口味。' },
  { id: 'nj_guixia', name: '金陵桂花茶', emoji: '🌸', tags: ['tea', 'fresh'], pop: 95, cuisine: 'nj_luyu',
    req: { nanjing: 2, tea: 2 }, price: 30, tier: 1, city: '320100',
    research: { cash: 540, ing: { nanjing: 10, tea: 10 } },
    desc: '金陵系入门：本地桂花配清茶。' },
  { id: 'nj_hongcha', name: '鸭血粉丝汤茶', emoji: '🍲', tags: ['rich', 'tea'], pop: 101, cuisine: 'nj_luyu',
    req: { nanjing: 1, tea: 2, sugar: 2 }, price: 31, tier: 2, city: '320100',
    research: { cash: 860, ing: { nanjing: 5, tea: 10, sugar: 10 } },
    desc: '金陵系第二款：取鸭血粉丝的醇厚，做成热饮。' },
  { id: 'nj_tangyuan', name: '桂花小圆子', emoji: '🥣', tags: ['sweet', 'milky'], pop: 107, cuisine: 'nj_luyu',
    req: { njrice: 3, nanjing: 1, sugar: 2 }, price: 33, tier: 3, city: '320100',
    research: { cash: 1120, ing: { njrice: 15, nanjing: 5, sugar: 10 } },
    desc: '金陵系第三款：本地小圆子配桂花，冬日限定感。' },
  { id: 'hz_yangmei', name: '杨梅冰茶', emoji: '🫐', tags: ['fruity', 'fresh'], pop: 103, cuisine: 'hz_bayberry',
    req: { bayberry: 3, tea: 2, sugar: 2 }, price: 32, tier: 1, city: '330100',
    research: { cash: 600, ing: { bayberry: 15, tea: 10, sugar: 10 } },
    desc: '杭帮系入门：本地杨梅现捣，酸甜直给。' },
  { id: 'hz_qingmei', name: '青梅龙井', emoji: '🍵', tags: ['tea', 'fresh'], pop: 107, cuisine: 'hz_bayberry',
    req: { snowplum: 2, tea: 2, sugar: 1 }, price: 33, tier: 2, city: '330100',
    research: { cash: 860, ing: { snowplum: 10, tea: 10, sugar: 5 } },
    desc: '杭帮系第二款：青梅配龙井，解腻一绝。' },
  { id: 'hz_lotus', name: '西湖藕粉', emoji: '🌸', tags: ['sweet', 'milky'], pop: 111, cuisine: 'hz_bayberry',
    req: { snowplum: 2, bayberry: 1, sugar: 3 }, price: 35, tier: 3, city: '330100',
    research: { cash: 1120, ing: { snowplum: 5, sugar: 10 } },
    desc: '杭帮系第三款：本地青梅配杨梅，酸甜收尾。' },
  { id: 'cd_rattancha', name: '藤椒青提', emoji: '🌶️', tags: ['fresh', 'fruity'], pop: 99, cuisine: 'cd_rattan',
    req: { sichuanpep: 1, sichuan: 1, fruit: 2, sugar: 1 }, price: 31, tier: 1, city: '510100',
    research: { cash: 600, ing: { sichuanpep: 10, fruit: 10, sugar: 5 } },
    desc: '巴蜀系入门：藤椒配青提，麻而清香。' },
  { id: 'cd_douban', name: '豆瓣奶绿', emoji: '🍵', tags: ['milky', 'rich'], pop: 105, cuisine: 'cd_rattan',
    req: { sichuan: 2, tea: 2, milk: 1 }, price: 34, tier: 2, city: '510100',
    research: { cash: 860, ing: { sichuan: 10, tea: 10, milk: 5 } },
    desc: '巴蜀系第二款：郫县豆瓣入奶绿，重口反差。' },
  { id: 'cd_mala', name: '麻辣鸳鸯', emoji: '🌶️', tags: ['rich', 'tea'], pop: 113, cuisine: 'cd_rattan',
    req: { sichuan: 2, sichuanpep: 2, tea: 2 }, price: 38, tier: 3, city: '510100',
    research: { cash: 1120, ing: { sichuan: 10, sichuanpep: 10, tea: 10 } },
    desc: '巴蜀系第三款：麻辣鸳鸯，客单价最高的一款。' },
  { id: 'wh_fengwang', name: '蜂王浆乳茶', emoji: '🍯', tags: ['milky', 'rich'], pop: 98, cuisine: 'wh_honeymilk',
    req: { beeswax: 2, milk: 3, tea: 1 }, price: 32, tier: 1, city: '420100',
    research: { cash: 600, ing: { beeswax: 10, milk: 15, tea: 5 } },
    desc: '江汉系入门：本地蜂王浆挂杯，营养卖点。' },
  { id: 'wh_mian', name: '江米珍珠糊', emoji: '🥣', tags: ['sweet', 'rich'], pop: 104, cuisine: 'wh_honeymilk',
    req: { rice: 3, milk: 2, beeswax: 1 }, price: 34, tier: 2, city: '420100',
    research: { cash: 860, ing: { rice: 15, milk: 10, beeswax: 5 } },
    desc: '江汉系第二款：江米配珍珠，温润饱腹。' },
  { id: 'wh_litchi', name: '荔枝蜜桃', emoji: '🍑', tags: ['fruity', 'sweet'], pop: 109, cuisine: 'wh_honeymilk',
    req: { fruit: 3, beeswax: 1, sugar: 2 }, price: 36, tier: 3, city: '420100',
    research: { cash: 1120, ing: { fruit: 15, beeswax: 5, sugar: 10 } },
    desc: '江汉系第三款：夏末荔枝配本地蜂蜜，季节性强。' },
  { id: 'cs_duojiao', name: '剁椒果茶', emoji: '🌶️', tags: ['fruity', 'fresh'], pop: 100, cuisine: 'cs_chili',
    req: { chillies: 2, fruit: 2, sugar: 1 }, price: 30, tier: 1, city: '430100',
    research: { cash: 600, ing: { chillies: 10, fruit: 10, sugar: 5 } },
    desc: '湘味系入门：剁椒配鲜果，辣得直接。' },
  { id: 'cs_xiaolong', name: '小龙虾鲜乳', emoji: '🦐', tags: ['rich', 'milky'], pop: 106, cuisine: 'cs_chili',
    req: { shrimp: 3, milk: 2, sugar: 1 }, price: 35, tier: 2, city: '430100',
    research: { cash: 860, ing: { shrimp: 15, milk: 10, sugar: 5 } },
    desc: '湘味系第二款：河虾配厚乳，夜宵档王牌。' },
  { id: 'cs_duojiang', name: '剁椒奶盖', emoji: '🌶️', tags: ['rich', 'tea'], pop: 112, cuisine: 'cs_chili',
    req: { chillies: 2, tea: 2, milk: 2, sugar: 2 }, price: 37, tier: 3, city: '430100',
    research: { cash: 1180, ing: { chillies: 10, tea: 10, milk: 10, sugar: 10 } },
    desc: '湘味系第三款：剁椒配奶盖，辣与醇并存。' },
  { id: 'xa_zaocha', name: '关中枣茶', emoji: '🌰', tags: ['tea', 'sweet'], pop: 95, cuisine: 'xa_guokui',
    req: { xianyang: 2, tea: 2, sugar: 1 }, price: 30, tier: 1, city: '610100',
    research: { cash: 600, ing: { xianyang: 10, tea: 10, sugar: 5 } },
    desc: '关中系入门：本地红枣配茶，温补路线。' },
  { id: 'xa_banli', name: '板栗拿铁', emoji: '🌰', tags: ['milky', 'rich'], pop: 101, cuisine: 'xa_guokui',
    req: { chestnut: 3, milk: 2, tea: 1 }, price: 32, tier: 2, city: '610100',
    research: { cash: 860, ing: { chestnut: 15, milk: 10, tea: 5 } },
    desc: '关中系第二款：商洛板栗打浆，秋冬爆款。' },
  { id: 'xa_fengmi', name: '枣泥八宝', emoji: '🍮', tags: ['sweet', 'rich'], pop: 107, cuisine: 'xa_guokui',
    req: { xianyang: 3, sugar: 3, milk: 1 }, price: 34, tier: 3, city: '610100',
    research: { cash: 1120, ing: { xianyang: 15, sugar: 15, milk: 5 } },
    desc: '关中系第三款：枣泥打底，甜品客群。' },
  { id: 'ur_hami', name: '哈密瓜奶昔', emoji: '🍈', tags: ['sweet', 'fruity'], pop: 104, cuisine: 'ur_melon',
    req: { hami: 3, milk: 2 }, price: 32, tier: 1, city: '650100',
    research: { cash: 540, ing: { hami: 15, milk: 10 } },
    desc: '西域系入门：哈密瓜现打，甜度爆表。' },
  { id: 'ur_goji', name: '枸杞蜜瓜', emoji: '🫐', tags: ['sweet', 'fruity'], pop: 108, cuisine: 'ur_melon',
    req: { urjujube: 2, hami: 2, sugar: 1 }, price: 34, tier: 2, city: '650100',
    research: { cash: 860, ing: { urjujube: 10, hami: 10, sugar: 5 } },
    desc: '西域系第二款：和田红枣配哈密瓜，养生甜品。' },
  { id: 'ur_nang', name: '馕茶组合', emoji: '🫓', tags: ['rich', 'tea'], pop: 112, cuisine: 'ur_melon',
    req: { hami: 1, urjujube: 2, tea: 2, sugar: 2 }, price: 36, tier: 3, city: '650100',
    research: { cash: 1180, ing: { hami: 5, urjujube: 10, tea: 10, sugar: 10 } },
    desc: '西域系第三款：本地馕配茶，饱腹型产品。' },
  { id: 'lz_suyou', name: '酥油奶茶', emoji: '🧈', tags: ['rich', 'milky'], pop: 108, cuisine: 'lz_saffron',
    req: { butter: 3, milk: 2, tea: 2 }, price: 34, tier: 1, city: '540100',
    research: { cash: 600, ing: { butter: 15, milk: 10, tea: 10 } },
    desc: '高原系入门：本地酥油化茶，御寒刚需。' },
  { id: 'lz_zanghong', name: '藏红花酥油', emoji: '🌷', tags: ['rich', 'sweet'], pop: 112, cuisine: 'lz_saffron',
    req: { saffron: 1, butter: 2, sugar: 2 }, price: 38, tier: 2, city: '540100',
    research: { cash: 860, ing: { saffron: 5, butter: 10, sugar: 10 } },
    desc: '高原系第二款：藏红花提色，香气独特。' },
  { id: 'lz_niurou', name: '牦牛酥油面茶', emoji: '🧈', tags: ['rich', 'sweet'], pop: 116, cuisine: 'lz_saffron',
    req: { butter: 3, sugar: 3 }, price: 40, tier: 3, city: '540100',
    research: { cash: 1120, ing: { butter: 15, sugar: 15 } },
    desc: '高原系第三款：酥油面茶，热量高但客群忠实。' },
  { id: 'sy_yezhi', name: '椰子清补凉', emoji: '🥥', tags: ['fresh', 'sweet'], pop: 102, cuisine: 'sanya_tropic',
    req: { coconut: 3, sugar: 2, tea: 1 }, price: 30, tier: 1, city: '460200',
    research: { cash: 600, ing: { coconut: 15, sugar: 10, tea: 5 } },
    desc: '椰林系入门：文昌椰现榨，冰镇才好喝。' },
  { id: 'sy_shugu', name: '树熟果冰沙', emoji: '🍈', tags: ['fruity', 'fresh'], pop: 106, cuisine: 'sanya_tropic',
    req: { mangosteen: 2, coconut: 2, sugar: 2 }, price: 33, tier: 2, city: '460200',
    research: { cash: 860, ing: { mangosteen: 10, coconut: 10, sugar: 10 } },
    desc: '热带系第二款：树熟果配椰浆，热带感拉满。' },
  { id: 'sy_yezi', name: '椰林芒果雪', emoji: '🥭', tags: ['sweet', 'fresh'], pop: 112, cuisine: 'sanya_tropic',
    req: { mangosteen: 1, coconut: 2, fruit: 3, sugar: 2 }, price: 36, tier: 3, city: '460200',
    research: { cash: 1180, ing: { mangosteen: 5, coconut: 10, fruit: 15, sugar: 10 } },
    desc: '热带系第三款：雪沙质地，度假风主打。' },
  { id: 'yc_gouqi', name: '枸杞鲜奶', emoji: '🫐', tags: ['milky', 'rich'], pop: 100, cuisine: 'yc_goji',
    req: { goji: 3, milk: 3, sugar: 1 }, price: 30, tier: 1, city: '640100',
    research: { cash: 600, ing: { goji: 15, milk: 15, sugar: 5 } },
    desc: '宁夏系入门：本地枸杞配鲜奶，养生日常款。' },
  { id: 'yc_naicha', name: '枸杞奶茶', emoji: '🧋', tags: ['milky', 'tea'], pop: 106, cuisine: 'yc_goji',
    req: { goji: 2, milk: 2, tea: 2 }, price: 32, tier: 2, city: '640100',
    research: { cash: 860, ing: { goji: 10, milk: 10, tea: 10 } },
    desc: '宁夏系第二款：枸杞入奶茶，受众更广。' },
  { id: 'yc_jiangzao', name: '枸杞姜枣', emoji: '🍵', tags: ['tea', 'sweet'], pop: 110, cuisine: 'yc_goji',
    req: { goji: 3, tea: 1, sugar: 2 }, price: 35, tier: 3, city: '640100',
    research: { cash: 1180, ing: { goji: 10, goji: 1, tea: 10, sugar: 10 } },
    desc: '宁夏系第三款：枸杞配茶底，冬日温补。' },];

/* ============================================================
 *  V10：成就专属奖励食谱
 *
 *  ★ 硬约束（用户明确要求，也是本表存在的全部意义）：
 *    **这些食谱不属于研发树的任何节点 —— 没有任何研发路径能拿到它们，
 *    只能通过成就获得。**
 *    因此：
 *      · 它们**不能**出现在 RESEARCH_TREE 里
 *      · 它们**没有** research 字段（不能被研发）
 *      · 它们**不占** canListRecipe 的菜系槽位约束之外的任何前置
 *    探针M 组对此有断言：遍历 RESEARCH_TREE，任何 recipe 都不得命中本表。
 *    （一旦有人不小心把它们加进研发树，探针会当场失败——
 *      这类"约定只写在注释里"的约束最终都会被破坏。）
 *
 *  ★ 为什么需要这类奖励：
 *    研发树是**可规划**的，玩家会照着它一路做到底；
 *    成就食谱是**不可规划**的，玩家必须先达成某件事才会遇见。
 *    两者叠加才有"目标感"与"惊喜感"的分工 ——
 *    只有研发树，游戏会变成一张必做的清单。
 *
 *  ★ 城市归属：奖励食谱同样绑定城市（与城市菜一致的口径），
 *    但**判定与给予是跨局的**：成就在任意城市达成都算，
 *    食谱直接进 s.recipes（不会被"不在那个城市"吞掉）。
 * ============================================================ */
const ACH_RECIPES = [
  { id: 'ach_golden', name: '鎏金奶盖', emoji: '🥇', tags: ['rich', 'milky'], pop: 132, cuisine: 'classic',
    req: { milk: 3, pearl: 2, sugar: 2 }, price: 46, tier: 4, ach: true,
    desc: '成就奖励：金色奶盖配珍珠，卖相即正义。' },
  { id: 'ach_moon', name: '月落栀白', emoji: '🌕', tags: ['fresh', 'tea'], pop: 128, cuisine: 'matcha',
    req: { tea: 2, fruit: 2, sugar: 1 }, price: 42, tier: 4, ach: true,
    desc: '成就奖励：夜间限定的话题款。' },
  { id: 'ach_terrace', name: '梯田云顶', emoji: '🌾', tags: ['milky', 'sweet'], pop: 126, cuisine: 'dessert',
    req: { milk: 3, sugar: 3, pearl: 1 }, price: 40, tier: 4, ach: true,
    desc: '成就奖励：层层堆叠的甜品，视觉取胜。' },
  { id: 'ach_nightfall', name: '夜航咖啡', emoji: '🌃', tags: ['rich', 'tea'], pop: 130, cuisine: 'coffee',
    req: { tea: 3, milk: 2, sugar: 2 }, price: 44, tier: 4, ach: true,
    desc: '成就奖励：深夜限定，客单价最高。' },
  { id: 'ach_firstcity', name: '初见山城', emoji: '🏞️', tags: ['fresh', 'fruity'], pop: 124, cuisine: 'fruit',
    req: { fruit: 3, tea: 2, sugar: 1 }, price: 38, tier: 4, ach: true, city: '510100',
    desc: '成就奖励：只在成都可得，山城的第一杯。' },
  { id: 'ach_southsea', name: '南sea 落日橙', emoji: '🌇', tags: ['fruity', 'sweet'], pop: 127, cuisine: 'fruit',
    req: { fruit: 3, sugar: 2, milk: 1 }, price: 40, tier: 4, ach: true, city: '460200',
    desc: '成就奖励：只在三亚可得，落日味的橙。' },
  { id: 'ach_capital', name: '京韵酥', emoji: '🏯', tags: ['sweet', 'rich'], pop: 125, cuisine: 'dessert',
    req: { milk: 3, sugar: 3, pearl: 2 }, price: 42, tier: 4, ach: true, city: '110100',
    desc: '成就奖励：只在北京可得，酥皮与奶香。' },
];

/* ============================================================
 *  V10：城市特色菜系的「研发树」
 *
 *  ★ 为什么需要研发树（这是本批次的结构核心）：
 *    改造前**根本不存在研发树** —— 配方只有 research:{cash,ing} 与tier，
 *    有钱有料就能做，等于 15 个平铺按钮。这样的结构撑不住新要求：
 *      · 无法表达"先做 A 才能做 B"的依赖
 *      · 无法表达"第几阶段才开放"
 *      · 城市菜与通用菜混在一起，玩家看不出该先做什么
 *    所以引入 RESEARCH_TREE，把配方组织成**按城市分组、按阶段推进**的依赖网。
 *
 *  节点字段：
 *    id       节点 id
 *    recipe   指向 RECIPES 里的配方 id
 *    stage    阶段号（1 起）。同一 stage 的节点可并行研发，跨 stage 有先后
 *    prereq   前置节点 id 数组（全部满足才能研）
 *    city     所属城市（空 = 通用节点，任何城市都能研）
 *
 *  ★ 关键设计：**city 节点在别城不可研**，但已在别城解锁的配方
 *    也不会因为换城市而消失（存在 s.recipes 里，只是不能上架 ——
 *    见 engine 的 recipeAvailableAt）。
 *    换句话说：研发投入是**跨城市保留**的资产，换城只是换了一个可上架的池子。
 *    这样"去成都开厂"是真的取舍：那边能做的菜这边做不了，反之亦然。
 *
 *  ★ 前置与 V9 的教训不冲突：前置约束的是**城市**（天然强边界，玩家清楚），
 *    不是"有没有花钱"（那才是实测中锁死配方表的元凶）。
 *    城市前置即使不满足，玩家也会立刻看懂 —— 因为研发页会按城市分组显示。
 */


/* ============================================================
 *  研发树（RESEARCH_TREE）—— 把配方组织成**按城市分组、按阶段推进**的依赖网
 *
 *  ★ 改造前**不存在研发树**：配方只有 research:{cash,ing} + tier，
 *    有钱有料就能做，15 个配方是平铺的一排按钮。撑不住本批次要求 ——
 *    既无法表达"先A 后 B"，也无法表达"第几阶段开放"。
 *
 *  字段：
 *    id      节点 id
 *    recipe  指向 RECIPES 的配方 id
 *    stage   阶段（0 起）。同阶段可并行，跨阶段有先后
 *    prereq  前置节点 id（全部满足才能研）
 *    city    所属城市（空 = 通用节点，任何城市可研）
 *
 *  ★ 城市前置与 V9 的教训**不冲突**，因为两者性质不同：
 *    V9 出事的是「花钱门槛」—— 玩家算不出划不划算，于是配方被永久锁死；
 *    这里是「地域边界」—— 研发页**按城市分组显示**，玩家一眼看懂
 *    "这些菜只能在这座城做"，不存在"不知道被锁了"的情况。
 *    另外：已在某城解锁的配方不会因换城市而消失（它仍在 s.recipes 里），
 *    只是**不能上架** —— 研发投入是跨城市保留的资产。
 * ============================================================ */
const RESEARCH_TREE = [
  { id: 'n_boba', recipe: 'boba', stage: 0, prereq: [], city: '' },
  { id: 'n_greentea', recipe: 'greentea', stage: 1, prereq: ['n_boba'], city: '' },
  { id: 'n_passion', recipe: 'passion', stage: 1, prereq: ['n_boba'], city: '' },
  { id: 'n_taro', recipe: 'taro', stage: 2, prereq: ['n_greentea'], city: '' },
  { id: 'n_coco', recipe: 'coco', stage: 2, prereq: ['n_greentea'], city: '' },
  { id: 'n_grape', recipe: 'grape', stage: 2, prereq: ['n_passion'], city: '' },
  { id: 'n_matcha', recipe: 'matcha', stage: 2, prereq: ['n_greentea'], city: '' },
  { id: 'n_brownsugar', recipe: 'brownsugar', stage: 3, prereq: ['n_taro', 'n_coco'], city: '' },
  { id: 'n_taro2', recipe: 'taro2', stage: 3, prereq: ['n_taro'], city: '' },
  { id: 'n_lime', recipe: 'lime', stage: 3, prereq: ['n_grape'], city: '' },
  { id: 'n_latte', recipe: 'latte', stage: 3, prereq: ['n_coco'], city: '' },
  { id: 'n_matcha2', recipe: 'matcha2', stage: 4, prereq: ['n_matcha', 'n_brownsugar'], city: '' },
  { id: 'n_taro3', recipe: 'taro3', stage: 4, prereq: ['n_taro2', 'n_brownsugar'], city: '' },
  /* sakura / star 是 V9 批次追加时漏挂节点的（探针 M1c 抓出来的）。
     漏挂的后果不是"报错"，而是这两款配方**不受研发树约束**——
     能跳过前置直接研，研发树的规划性对它们失效。
     star 是隐藏款（tier4），所以给它 stage 5 作为全树的终点。 */
  { id: 'n_sakura', recipe: 'sakura', stage: 4, prereq: ['n_lime'], city: '' },
  { id: 'n_star', recipe: 'star', stage: 5, prereq: ['n_sakura', 'n_taro3'], city: '' },

  /* ---- 城市节点：每城 3 阶段线性推进 ---- */
  { id: 'n_gz_lishui', recipe: 'gz_lishui', stage: 1, prereq: [], city: '440100' },
  { id: 'n_gz_shuangjiang', recipe: 'gz_shuangjiang', stage: 2, prereq: ['n_gz_lishui'], city: '440100' },
  { id: 'n_gz_qinggua', recipe: 'gz_qinggua', stage: 3, prereq: ['n_gz_shuangjiang'], city: '440100' },
  { id: 'n_xs_chenpitea', recipe: 'xs_chenpitea', stage: 1, prereq: [], city: '440700' },
  { id: 'n_xs_xianru', recipe: 'xs_xianru', stage: 2, prereq: ['n_xs_chenpitea'], city: '440700' },
  { id: 'n_xs_laobian', recipe: 'xs_laobian', stage: 3, prereq: ['n_xs_xianru'], city: '440700' },
  { id: 'n_sz_dancong', recipe: 'sz_dancong', stage: 1, prereq: [], city: '440300' },
  { id: 'n_sz_huicha', recipe: 'sz_huicha', stage: 2, prereq: ['n_sz_dancong'], city: '440300' },
  { id: 'n_sz_niuyecha', recipe: 'sz_niuyecha', stage: 3, prereq: ['n_sz_huicha'], city: '440300' },
  { id: 'n_su_guixia', recipe: 'su_guixia', stage: 1, prereq: [], city: '320500' },
  { id: 'n_su_liusheng', recipe: 'su_liusheng', stage: 2, prereq: ['n_su_guixia'], city: '320500' },
  { id: 'n_su_lianhua', recipe: 'su_lianhua', stage: 3, prereq: ['n_su_liusheng'], city: '320500' },
  { id: 'n_nj_guixia', recipe: 'nj_guixia', stage: 1, prereq: [], city: '320100' },
  { id: 'n_nj_hongcha', recipe: 'nj_hongcha', stage: 2, prereq: ['n_nj_guixia'], city: '320100' },
  { id: 'n_nj_tangyuan', recipe: 'nj_tangyuan', stage: 3, prereq: ['n_nj_hongcha'], city: '320100' },
  { id: 'n_hz_yangmei', recipe: 'hz_yangmei', stage: 1, prereq: [], city: '330100' },
  { id: 'n_hz_qingmei', recipe: 'hz_qingmei', stage: 2, prereq: ['n_hz_yangmei'], city: '330100' },
  { id: 'n_hz_lotus', recipe: 'hz_lotus', stage: 3, prereq: ['n_hz_qingmei'], city: '330100' },
  { id: 'n_cd_rattancha', recipe: 'cd_rattancha', stage: 1, prereq: [], city: '510100' },
  { id: 'n_cd_douban', recipe: 'cd_douban', stage: 2, prereq: ['n_cd_rattancha'], city: '510100' },
  { id: 'n_cd_mala', recipe: 'cd_mala', stage: 3, prereq: ['n_cd_douban'], city: '510100' },
  { id: 'n_wh_fengwang', recipe: 'wh_fengwang', stage: 1, prereq: [], city: '420100' },
  { id: 'n_wh_mian', recipe: 'wh_mian', stage: 2, prereq: ['n_wh_fengwang'], city: '420100' },
  { id: 'n_wh_litchi', recipe: 'wh_litchi', stage: 3, prereq: ['n_wh_mian'], city: '420100' },
  { id: 'n_cs_duojiao', recipe: 'cs_duojiao', stage: 1, prereq: [], city: '430100' },
  { id: 'n_cs_xiaolong', recipe: 'cs_xiaolong', stage: 2, prereq: ['n_cs_duojiao'], city: '430100' },
  { id: 'n_cs_duojiang', recipe: 'cs_duojiang', stage: 3, prereq: ['n_cs_xiaolong'], city: '430100' },
  { id: 'n_xa_zaocha', recipe: 'xa_zaocha', stage: 1, prereq: [], city: '610100' },
  { id: 'n_xa_banli', recipe: 'xa_banli', stage: 2, prereq: ['n_xa_zaocha'], city: '610100' },
  { id: 'n_xa_fengmi', recipe: 'xa_fengmi', stage: 3, prereq: ['n_xa_banli'], city: '610100' },
  { id: 'n_ur_hami', recipe: 'ur_hami', stage: 1, prereq: [], city: '650100' },
  { id: 'n_ur_goji', recipe: 'ur_goji', stage: 2, prereq: ['n_ur_hami'], city: '650100' },
  { id: 'n_ur_nang', recipe: 'ur_nang', stage: 3, prereq: ['n_ur_goji'], city: '650100' },
  { id: 'n_lz_suyou', recipe: 'lz_suyou', stage: 1, prereq: [], city: '540100' },
  { id: 'n_lz_zanghong', recipe: 'lz_zanghong', stage: 2, prereq: ['n_lz_suyou'], city: '540100' },
  { id: 'n_lz_niurou', recipe: 'lz_niurou', stage: 3, prereq: ['n_lz_zanghong'], city: '540100' },
  { id: 'n_sy_yezhi', recipe: 'sy_yezhi', stage: 1, prereq: [], city: '460200' },
  { id: 'n_sy_shugu', recipe: 'sy_shugu', stage: 2, prereq: ['n_sy_yezhi'], city: '460200' },
  { id: 'n_sy_yezi', recipe: 'sy_yezi', stage: 3, prereq: ['n_sy_shugu'], city: '460200' },
  { id: 'n_yc_gouqi', recipe: 'yc_gouqi', stage: 1, prereq: [], city: '640100' },
  { id: 'n_yc_naicha', recipe: 'yc_naicha', stage: 2, prereq: ['n_yc_gouqi'], city: '640100' },
  { id: 'n_yc_jiangzao', recipe: 'yc_jiangzao', stage: 3, prereq: ['n_yc_naicha'], city: '640100' },
];

/* ---------- 永久升级 ---------- */
const UPGRADES = [
  /* ★★ V21：max 保持 100 —— **不要**改成一个小的固定值。
     ★ 试过 max=14，被实测否掉：**触底等级本身会移动**。
       从 L=0 开始扫（不是从当前级扫）得到的真实触底级：
         easy  D1 L12 / D10 L7 / D20 L4 / D30 L4
         normal D1 L12 / D10 L9 / D20 L6 / D30 L6
         hard  D1 L12 / D10 L9 / D20 L8 / D30 L8
       固定 14 在前期是"过早封顶"，在后期是"继续卖 10 级死货"（L5~L14），两头不讨好。
     ★⚠️ 这组数字第一版写错过（写成 L8~L9 且随天数"先降后升"）。
       错因是**搜索起点取当前等级**：当前级已超过触底板时，第一次比较就相等，
       返回当前级 —— 输出是一个"看起来完全正常"的数（恰好等于当前级），
       任何断言都抓不住。两条自检已记入报告：
         ① 触底级 == 当前级 → 大概率是搜索起点错，别当成"恰好追平"；
         ② 触底级应由 training/员工单调决定；出现非单调先怀疑测量，不要编叙事。
     ★ 真正的修法在引擎侧：`upgradeSaturated()` 逐次判断"再升一级是否还能缩短出杯时间"，
       并在升级页给出"⚠️ 已到出杯下限"的提示。这样触底板怎么动都不会错，
       而且是产品侧修复 —— 真人同样受害（easy 在 D30 已超触底板 5 级）。 */
  { id: 'speed', name: '极速封口机', emoji: '🚀', max: 100, base: 200, mult: 1.55,
    desc: '出杯速度 +20%/级', detail: l => `当前：出杯速度 +${l * 20}%` },
  { id: 'decor', name: '门店装修', emoji: '✨', max: 8, base: 280, mult: 1.62,
    desc: '客流 +15%、等位座 +1/级', detail: l => `当前：客流 +${l * 15}%，等位 ${CFG.BASE_QUEUE + l} 位` },
  { id: 'menu', name: '招牌展位', emoji: '📋', max: 6, base: 260, mult: 1.5,
    desc: '可上架配方 +1/级', detail: l => `当前：可上架 ${2 + l} 款` },
  { id: 'storage', name: '冷链仓库', emoji: '🧊', max: 6, base: 200, mult: 1.5,
    desc: '库存上限 +180/级', detail: l => `当前：上限 ${CFG.BASE_STORAGE + l * 180}` },
  { id: 'training', name: '员工培训', emoji: '🎓', max: 5, base: 320, mult: 1.68,
    desc: '原料损耗 −4%/级', detail: l => `当前：每杯成本 −${l * 4}%` },
  { id: 'auto', name: '外卖接单', emoji: '🛵', max: 6, base: 450, mult: 1.85,
    desc: '离线收益与自动出杯', detail: l => `当前：离线 ${offlineRate(l)} 元/分钟` },
];

/* ★★ V21：升级项的**展示顺序 = 实测价值顺序**，不是数据定义顺序。
 *
 *   旧顺序是 speed / decor / menu / storage / training / auto ——
 *   最没用的排第一（speed 全段边际 ≈0，AI 甚至根本不买），
 *   唯一 ROI > 2 的排第四（storage 4.84）。
 *   玩家第一眼看到的就是最该少买的那一个，钱自然花在错的地方。
 *
 *   ★ 为什么用常量而不是直接改数组：数组每一项都带着一段解释性注释，
 *     重排会把注释和对象拆散；而"顺序"本身是**展示决策**，
 *     以后调它不该动数据。新增项忘了登记也会被兜底追加到末尾（不会消失）。
 *
 *   实测依据：storage 4.84 / menu 1.51 / decor 0.90 / speed ≈0 / auto −0.24；
 *   training 与 speed 同轴（都除出杯时间），同样触底即失效。
 */
const UPGRADE_VALUE_ORDER = ['storage', 'menu', 'decor', 'speed', 'training', 'auto'];
let _UP_BY_VALUE = null;
function upgradesByValue() {
  if (_UP_BY_VALUE) return _UP_BY_VALUE;
  const left = {};
  for (const u of UPGRADES) left[u.id] = u;
  const out = [];
  for (const id of UPGRADE_VALUE_ORDER) {
    if (left[id]) { out.push(left[id]); delete left[id]; }
  }
  /* 兜底：以后新增、但忘了登记顺序的项追加在末尾 —— 宁可排在最后，也不能消失 */
  for (const u of UPGRADES) if (left[u.id]) out.push(u);
  _UP_BY_VALUE = out;
  return out;
}

function offlineRate(lv) {
  return Math.round(4 * Math.pow(lv, 1.55));
}

/**
 * 店铺级升级（V12.1）：**每家店独立**的经营强化。
 *
 * ★ 与全局 UPGRADES 的分工：
 *   全局升级 = 「连锁总部统一的投入」（所有店一起受益）
 *   店铺升级 = 「投给某一家店」（每店单独买、单独生效）
 *   所以店铺升级的数值刻意**低于**对应的全局升级 ——
 *   全局 decor 是全店客流 +15%，店铺旺铺招财是单店 +12%：
 *   单店效果更弱是应该的（否则玩家会只买店铺升级、全局升级就没意义了）。
 *
 * ★ 为什么必须有店铺级升级：
 *   有了 V12 的"每店独立账本 + 独立等级"之后，
 *   玩家会自然想「把某一家店做成主打店」——
 *   而没有单店投入的途径，就只能把所有资源平摊给所有店，
 *   「重点培养哪家店」这个决策就不存在了。
 *
 * ★ 托管店同样吃店铺升级 ——
 *   否则玩家托管的店永远比自营的弱，「托管」就成了纯粹的损失，
 *   那个功能也就没有意义了。
 */
const STORE_UPGRADES = [
  { id: 'buzz',   name: '旺铺招财', emoji: '🏪', max: 5, base: 600, mult: 1.6,
    desc: '该店客流 +12%/级', detail: l => `当前：该店客流 +${l * 12}%` },
  { id: 'team',   name: '熟练团队', emoji: '👥', max: 5, base: 700, mult: 1.6,
    desc: '该店员工效率 +10%/级', detail: l => `当前：该店效率 +${l * 10}%` },
  { id: 'sign',   name: '本地招牌', emoji: '🏷️', max: 3, base: 800, mult: 1.7,
    desc: '该店可上架 +1/级', detail: l => `当前：该店可上架 ${2 + l} 款` },
  { id: 'lean',   name: '精打细算', emoji: '💰', max: 5, base: 550, mult: 1.6,
    desc: '该店固定开支 −10%/级', detail: l => `当前：该店开支 −${l * 10}%` },
];

/* ---------- 分店 ---------- */
const SHOP_COSTS = [3500, 9000, 20000];

/* ============================================================
 *  店铺体系（V12「地图开分店」）
 *
 *  ★ 为什么要把 s.shops（数字）改成 s.stores（数组）：
 *    数字只能表达"有几家店"，表达不了「位置 / 名称 / 等级 / 独立账本 /
 *    是否托管」—— 而这些正是新需求的核心。
 *
 *  ★ 但 s.shops **不删**：它降级为 s.stores.length 的派生值。
 *    engine.js 里有 19 处 s.shops 使用点（客流、租金、AI、清洗…），
 *    全改成数组读取风险极高 —— 漏一处就是"开了店但店号算错"的静默 bug。
 *    保留派生值 = 既有代码一行不动，改动只发生在增删店的少数几处，
 *    且那几处统一走 syncShopCount()。
 *
 *  ★ 详见《地图开分店系统-设计.md》。
 * ============================================================ */

/** 店铺等级：达到累计营收阈值即可升级。
 *  阈值取「等比递增」而非等差 —— 后期店营收是前期的数倍，
 *  等差阈值会让升级过快（前期就顶满），等比则全程都有升级的期待感。 */
const STORE_LEVELS = [
  { lv: 1, need: 0 }, { lv: 2, need: 3000 }, { lv: 3, need: 9000 },
  { lv: 4, need: 22000 }, { lv: 5, need: 50000 }, { lv: 6, need: 100000 },
  { lv: 7, need: 200000 }, { lv: 8, need: 380000 }, { lv: 9, need: 680000 },
  { lv: 10, need: 1200000 },
];

/** 新店默认名池：按「城市名 + 后缀」组合，避免重名。 */
const STORE_SUFFIX = ['旗舰店', '总店', '分店', '小店', '工坊', '茶舍', '档口', '驿站'];

/** 开店时从总部划拨给该店的启动金。
 *  ★ 没有它，店长 AI 开局就「一分钱都没有」——
 *    买不了料、付不出工资，托管的店永远是空转，
 *    玩家会看到"托管 = 亏钱"，那就不是有意义的委托。
 *  这笔钱同时是「玩家对这家店的风险敞口」：
 *  亏了是真亏（不返还），赚了店长分成。 */
const MANAGER_START_CASH = 2000;

/** 店铺每日固定开支（租金 + 水电），按等级递增。
 *  与总店的 RENT_PER_SHOP / SHOP_UPKEEP 分开算 ——
 *  托管店不进入实时营业模拟，它的开销走店长 AI 结算。 */
function storeDailyCost(store) {
  const lv = Math.max(1, num(store && store.level, 1));
  return Math.round((120 + lv * 60) * num(store && store.rentMult, 1));
}

/* ============================================================
 *  店长系统（V11）
 *
 *  ★ 定位：**每新开设一家分店，即可招募一名店长**。
 *    总店（第1 家）不算分店 —— 那是玩家自己，不存在"店长"，
 *    所以店长上限 = s.shops - 1，而不是 s.shops。
 *    写成 s.shops 会凭空多出一个空缺槽位，玩家永远填不满。
 *
 *  ★ 为什么店长要绑定「分店」而不是只是个加成道具：
 *    改造前 s.staff 是**全局池**，分店工位靠 `s.staff[(i-1) % pool]`
 *    取模轮转 —— 3 家店 2 个员工时，同一个员工会同时在多家店"上班"。
 *    引入店长后，员工正式归属分店（staff.branch），
 *    店长才有"我管这家店"的实际含义。
 *
 *  三条设计约束（违反任意一条都会让店长变成摆设）：
 *    ① 店长的加成**只作用于自己那家分店**，不碰总店 ——
 *       否则"招店长"就退化成"花钱买全局加成"，
 *       而全局加成会让玩家无脑把所有资源砸在同一家店。
 *    ② 店长**不是万能加成层**。它的能力值是**分发器**：
 *       把该店的客流/口碑/效率按能力值给一点，
 *       数值远低于"再开一家分店"（+60% 客流）。
 *       否则店长会盖过分店本身，分店系统反而被架空。
 *    ③ 每店编制有上限，店长自动补员与玩家手动招聘**共用名额** ——
 *       见 CFG.BRANCH_STAFF_CAP。
 * ============================================================ */

/** 店长姓名池（与 STAFF_NAMES 刻意分开：辨识度要够，玩家要能记住"我招了谁"） */
const MANAGER_NAMES = ['陈叔', '林姐', '王师傅', '赵总', '刘阿姨', '孙经理', '周姐', '吴老板',
  '郑哥', '冯姐', '蒋师傅', '沈经理', '韩姐', '杨总', '许师傅', '何姐', '罗总', '高经理',
  '梁叔', '宋姐', '唐经理', '许姐'];

/** 店长能力等级：越高越贵、加成越强。等级名沿用职场语感 */
const MANAGER_RANKS = [
  { lv: 1, name: '见习店长', mult: 1.00 },
  { lv: 2, name: '正式店长', mult: 1.18 },
  { lv: 3, name: '资深店长', mult: 1.38 },
  { lv: 4, name: '金牌店长', mult: 1.60 },
  { lv: 5, name: '连锁督导', mult: 1.85 },
];

/**
 * 店长专精（V13.7）—— 借鉴开罗「技能等级不可超过角色等级」的取舍思路
 *
 * ★ 调研发现（开罗攻略）：
 *   「技能等级不能超过店员等级，且升级之后会有额外的冷却时间，
 *     所以最好是错过高峰期去升级」
 *   —— 核心不是"数值更大"，而是「**专精要有代价，换方向要付学费**」。
 *
 * ★ 本作已有的成长层（V13.4 起是三层）：
 *   ① 等级（Lv1~5）        —— 线性、无取舍
 *   ② 特性（7 种）         —— 固定、单向
 *   ③ 组合（V13.4，5 种）  —— 跨店全局
 *   ④ **专精（V13.7）**    —— 有取舍的定向强化
 *
 * ★ 专精的设计：
 *   · Lv.3 起可解锁专精（等级不够就没有这个选择）
 *   · 专精一个方向 → 该方向 +20%，**其余三个方向 -10%**
 *     （有取舍才有决策 —— 全都要等于没有专精）
 *   · 切换专精要付**能力值 -0.1** 的代价 → 不能随便换来换去
 *
 * ★ 为什么不做得更狠（比如 +30%/-20%）：
 *   店长本来只有 4% 基础加成 + 特性加成，专精数值太大
 *   会盖过特性本身的意义（玩家只看专精不看特性）。
 *   20%/10% 是"明显但不至于压过一切"的量级。
 */
const MANAGER_SPECIALTY = {
  /** 解锁专精所需的最低等级 */
  minLv: 3,
  /** 专精方向的加成 */
  up: 0.20,
  /** 非专精方向的减益
   *  ★ 数值是**实测算出来的**，不是拍脑袋：
   *     初版 down=0.10 → 专精净收益 = +20% - 10%×3 = **-10%**（越专精越差！）
   *     玩家不会做净负收益的选择 —— 这个专精等于没人用。
   *     改成 down=0.05 → 净 +5%，同时保留"选了这条就没有另一条"的取舍。
   *  ★ 真正的取舍不是「四方向总和」，而是「专精的那个方向明显更好」——
   *     玩家不能同时专精客流和品质。 */
  down: 0.05,
  /** 切换专精时损失的能力值 */
  switchCost: 0.1,
  /** 专精方向 → 加成字段 */
  fields: [
    { id: 'ops', name: '客流专精', emoji: '📈', field: 'ops', desc: '客流 +20%，其余 -10%' },
    { id: 'speed', name: '效率专精', emoji: '⚡', field: 'speed', desc: '出杯速度 +20%，其余 -10%' },
    { id: 'sat', name: '品质专精', emoji: '✨', field: 'sat', desc: '满意度 +20%，其余 -10%' },
    { id: 'rep', name: '口碑专精', emoji: '📣', field: 'rep', desc: '口碑 +20%，其余 -10%' },
  ],
};

/** 店长特性：与 STAFF 特质语义区分—— 店长特性偏"经营"而非"干活" */
const MANAGER_TRAITS = [
  { id: 'ops',   name: '运营老手',   emoji: '📋', desc: '该店客流 +8%' },
  { id: 'qc',    name: '品质把关',   emoji: '🔍', desc: '该店满意率加成 +50%' },
  { id: 'lean',  name: '精打细算',   emoji: '🧾', desc: '该店日薪支出 -12%' },
  { id: 'trainer', name: '带教能手', emoji: '🎓', desc: '该店员工成长更快（招募费用更低）' },
  { id: 'hosp',  name: '宾至如归',   emoji: '🤝', desc: '该店口碑加成 +40%' },
  { id: 'multi', name: '多店管理',   emoji: '🗂️', desc: '可管理 +1 名员工' },
  { id: 'none',  name: '无特别之处', emoji: '📄', desc: '没有额外特性' },
];

/**
 * 店长招募费用阶梯。
 * 按「当前已招店长数」递增 —— 与 STAFF 的fee（按 staff.length 递增）同一手法：
 * 人越多，新人越贵（组织规模越大，招人的边际成本越高）。
 * 但店长阶梯必须比员工陡得多，否则玩家会优先招店长而不是店员
 * （店长 1 级 ¥3000 vs 员工 ¥260起步，差距要够大才能保住"先扩编再提效"的顺序）。
 */
const MANAGER_COSTS = [3000, 6200, 11500, 19000, 30000];

/**
 * 店长组合加成（V13.4）—— 借鉴开罗《创意咖啡厅物语》的「技能搭配」
 * 与放置类游戏的「羁绊共鸣」。
 *
 * ★ 为什么要做这个：
 *   原有 7 个店长特性（ops/qc/lean/trainer/hosp/multi/none）是**完全独立**的加成，
 *   玩家的最优解是「每家店都配同一个最强特性」——
 *   没有搭配空间，也就没有经营「人」的乐趣。
 *   调研发现（开罗系攻略反复强调）：
 *     「1 咖啡大师 + 1 快速烹饪 + 1 微笑服务」是前期标准阵容；
 *     「不存在绝对最强的技能，每项能力在合适的场景下都有独特用武之地」。
 *   也就是说**组合本身才是策略**，而不是单条数值的堆叠。
 *
 * ★ 设计原则（避免做成随机配对表）：
 *   ① 每个组合必须有**经营上的内在逻辑**，不是"凑够两个 id 就发"；
 *   ② 组合要**跨店生效** —— 本作核心是「开分店」，
 *      单店内部组合没有意义，跨店组合才能让「招谁去哪家店」变成决策；
 *   ③ 加成**克制**（3%~8%），不破坏现有平衡；
 *   ④ 每个组合给一个**可读的名字**，玩家要能自己推理出来。
 *
 * mul 字段是作用在 managerBonus 结果上的乘数（1.06 = +6%）。
 */
const MANAGER_COMBOS = [
  {
    id: 'brand', name: '品牌组合', emoji: '🏅',
    traits: ['qc', 'hosp'],
    desc: '品质把关 + 宾至如归 = 标准化出品 + 好服务，口碑与满意度同涨',
    mul: { sat: 1.08, rep: 1.06 },
  },
  {
    id: 'leanOps', name: '铁三角', emoji: '📐',
    traits: ['ops', 'lean', 'qc'],
    desc: '运营 + 精打细算 + 品质把关 = 成本压得住、品质不掉档',
    mul: { ops: 1.08, sat: 1.04 },
  },
  {
    id: 'academy', name: '学院派', emoji: '🎓',
    traits: ['trainer', 'qc'],
    desc: '带教 + 把关 = 人才梯队与出品标准同时推进',
    mul: { speed: 1.05, sat: 1.05 },
  },
  {
    id: 'chain', name: '连锁班底', emoji: '🏬',
    traits: ['multi', 'ops', 'lean'],
    desc: '多店管理 + 运营 + 精打细算 = 可复制到分店的样板间',
    mul: { ops: 1.07, speed: 1.04 },
  },
  {
    id: 'service', name: '服务样板', emoji: '🌟',
    traits: ['hosp', 'trainer'],
    desc: '宾至如归 + 带教 = 店长能把好服务教给整家店',
    mul: { rep: 1.08, sat: 1.05 },
  },
];

/**
 * 每家分店的员工编制上限。
 * 分店总数 = 1（总店）+ SHOP_COSTS.length（最多 3 家分店），
 * 每店编制 × 分店数 会远超 CFG.STAFF_MAX（20），
 * 所以真正的上限仍然是 STAFF_MAX —— 这个值是**单店**的软上限，
 * 超了店长就不再自动补员，但玩家仍可手动招（只要没到 STAFF_MAX）。
 */
const BRANCH_STAFF_CAP = 6;

/**
 * 招募费用与编制上限的**算法**放引擎层（engine.js的 managerCost /
 * branchStaffCap），这里只保留静态表。
 * 原因：managerCost 要读 diffOf(s).costMult（引擎的难度系数），
 * managerCount 要读 s.managers（运行时状态）—— 都依赖引擎，
 * 留在 data.js 会造成 data→engine 的反向依赖。
 * 分层原则与本文件其它地方一致：**data.js 只放"数据"，engine.js 放"规则"**。
 */

/* ============================================================
 *  经营维度：场地类型 / 经营城市 / 经营地图位置
 *
 *  设计原则（与本文件其它静态表一致）：
 *    全部**数据驱动**，扩展只改这里、不改逻辑。场地类型要加一项就在
 *    VENUE_TYPES 里加一行 —— 引擎只认 id 白名单，不写 if-else 分支。
 *
 *  坐标系（合规硬约束，改之前先读完再动）：
 *    本项目统一使用 **高德口径 GCJ-02**。
 *    GCJ-02 / BD-09（百度） / WGS-84（GPS 原始）三者**不能混用**：
 *    同一地点在三种坐标系下经纬度能差 **300~600 米**，
 *    混用会让「门店定位」落到隔壁街区。
 *    国内地图必须使用有测绘资质的服务（高德 / 百度 / 腾讯），
 *    本表以高德为准；对外接口若需 WGS-84，必须在**边界层显式转换**，
 *    并把 coordSys 一起返回，让调用方知道拿到的是哪套坐标。
 * ============================================================ */

/** 经营场地类型：可配置扩展（加一行即可，id 不可复用已删除的 id） */
const VENUE_TYPES = [
  { id: 'mall',       name: '商场',     emoji: '🏬', desc: '室内商场，客流稳定' },
  { id: 'pedestrian', name: '步行街',   emoji: '🚶', desc: '开放式街边，氛围热闹' },
  { id: 'scenic',     name: '景区',     emoji: '⛰️', desc: '旅游景区，旺季爆发' },
  { id: 'office',     name: '写字楼',   emoji: '🏢', desc: '商务楼，工作日集中' },
  { id: 'community',  name: '社区',     emoji: '🏘️', desc: '居民区，胜在复购' },
  { id: 'campus',     name: '校园',     emoji: '🎓', desc: '高校周边，学生客群' },
  { id: 'station',    name: '交通枢纽', emoji: '🚉', desc: '地铁 / 火车站，通勤刚需' },
  { id: 'hospital',   name: '医院',     emoji: '🏥', desc: '院区陪诊刚需' },
  { id: 'factory',    name: '厂区',     emoji: '🏭', desc: '产业园区，团单为主' },
  { id: 'rural',      name: '乡镇',     emoji: '🌾', desc: '下沉市场，租金低' },
];
/** 默认场地：老存档 / 未选择时的兜底（社区：门槛最低、最普适） */
const VENUE_DEFAULT = 'community';

/**
 * 经营城市字典：省 → 市 两级（区级见 DISTRICTS）。
 *
 * 层级说明：省市两级**全量内置**（34 省 + 340+ 市，覆盖中国大陆全部）。
 * 区县级**不内置全量** —— 全国 2900+ 区县且**每年调整**（新设、撤并、改名），
 * 硬编码进来必然很快过期。所以：
 *   · 结构上支持三级（见 DISTRICTS，附重点城市真实数据作为样例）
 *   · 某城市未收录区级时，UI 自动降级为「仅到市级」而不是报错或留空
 *   · 生产环境应接民政部《行政区划代码》库（GB/T 2260）按版本同步
 *
 * 只收中国大陆，含台湾省、香港 / 澳门特别行政区（不做地理主张，仅列名称）。
 * 不含境外地区 —— 经营城市限定中国大陆。
 */
const PROVINCES = [
  { id: '11', name: '北京市', cities: ['110100'] },
  { id: '12', name: '天津市', cities: ['120100'] },
  { id: '13', name: '河北省', cities: ['130100', '130200', '130300', '130400', '130500', '130600', '130700', '130800', '130900', '131000', '131100'] },
  { id: '14', name: '山西省', cities: ['140100', '140200', '140300', '140400', '140500', '140600'] },
  { id: '15', name: '内蒙古自治区', cities: ['150100', '150200', '150300', '150400', '150500'] },
  { id: '21', name: '辽宁省', cities: ['210100', '210200', '210300', '210400', '210500', '210600'] },
  { id: '22', name: '吉林省', cities: ['220100', '220200', '220300', '220400'] },
  { id: '23', name: '黑龙江省', cities: ['230100', '230200', '230300', '230400'] },
  { id: '31', name: '上海市', cities: ['310100'] },
  { id: '32', name: '江苏省', cities: ['320100', '320200', '320300', '320400', '320500', '320600', '320700', '320800', '320900', '321000', '321100', '321200', '321300'] },
  { id: '33', name: '浙江省', cities: ['330100', '330200', '330300', '330400', '330500', '330600', '330700', '330800', '330900', '331000', '331100'] },
  { id: '34', name: '安徽省', cities: ['340100', '340200', '340300', '340400', '340500', '340600', '340700', '340800', '340900', '341000', '341100'] },
  { id: '35', name: '福建省', cities: ['350100', '350200', '350300', '350400', '350500', '350600', '350700', '350800', '350900'] },
  { id: '36', name: '江西省', cities: ['360100', '360200', '360300', '360400', '360500', '360600', '360700'] },
  { id: '37', name: '山东省', cities: ['370100', '370200', '370300', '370400', '370500', '370600', '370700', '370800', '370900', '371000', '371100', '371200', '371300', '371400', '371500', '371600'] },
  { id: '41', name: '河南省', cities: ['410100', '410200', '410300', '410400', '410500', '410600', '410700', '410800', '410900', '411000', '411100', '411200', '411300', '411400', '411500', '411600', '411700', '411800'] },
  { id: '42', name: '湖北省', cities: ['420100', '420200', '420300', '420400', '420500', '420600', '420700', '420800', '420900', '421000', '421100', '421200', '421300'] },
  { id: '43', name: '湖南省', cities: ['430100', '430200', '430300', '430400', '430500', '430600', '430700', '430800', '430900', '431000', '431100', '431200', '431300', '431400'] },
  { id: '44', name: '广东省', cities: ['440100', '440200', '440300', '440400', '440500', '440600', '440700', '440800', '440900', '441200', '441300', '441400', '441500', '441600', '441700', '441800', '441900', '442000'] },
  { id: '45', name: '广西壮族自治区', cities: ['450100', '450200', '450300', '450400', '450500', '450600', '450700', '450800', '450900', '451000', '451100', '451200'] },
  { id: '46', name: '海南省', cities: ['460100', '460200'] },
  { id: '50', name: '重庆市', cities: ['500100'] },
  { id: '51', name: '四川省', cities: ['510100', '510300', '510400', '510500', '510600', '510700', '511000', '511100', '511300', '511500', '511600', '511700', '511800', '511900', '512000', '513200', '513300', '513400'] },
  { id: '52', name: '贵州省', cities: ['520100', '520200', '520300', '520400', '520500', '520600'] },
  { id: '53', name: '云南省', cities: ['530100', '530300', '530400', '530500', '530600', '530700', '530800', '530900'] },
  { id: '54', name: '西藏自治区', cities: ['540100', '540200', '540300', '540400', '540500', '540600'] },
  { id: '61', name: '陕西省', cities: ['610100', '610200', '610300', '610400', '610500', '610600', '610700', '610800', '610900', '611000'] },
  { id: '62', name: '甘肃省', cities: ['620100', '620200', '620300', '620400', '620500', '620600', '620700', '620800', '620900', '621000', '621100', '621200'] },
  { id: '63', name: '青海省', cities: ['630100', '630200'] },
  { id: '64', name: '宁夏回族自治区', cities: ['640100', '640200', '640300', '640400', '640500'] },
  { id: '65', name: '新疆维吾尔自治区', cities: ['650100', '650200', '650300', '650400', '650500', '650600', '650700', '650800'] },
  { id: '71', name: '台湾省', cities: ['710100', '710200', '710300', '710400', '710500', '710600', '710700', '710800', '710900'] },
  { id: '81', name: '香港特别行政区', cities: ['810100', '810200', '810300'] },
  { id: '82', name: '澳门特别行政区', cities: ['820100'] },
];

/** 经营城市字典：GB/T 2260 行政区划代码（市级，6 位） */
const CITIES = [
  { id: '110100', name: '北京市', prov: '11' }, { id: '120100', name: '天津市', prov: '12' },
  { id: '130100', name: '石家庄市', prov: '13' }, { id: '130200', name: '唐山市', prov: '13' },
  { id: '130300', name: '秦皇岛市', prov: '13' }, { id: '130400', name: '邯郸市', prov: '13' },
  { id: '130500', name: '邢台市', prov: '13' }, { id: '130600', name: '保定市', prov: '13' },
  { id: '130700', name: '张家口市', prov: '13' }, { id: '130800', name: '承德市', prov: '13' },
  { id: '130900', name: '沧州市', prov: '13' }, { id: '131000', name: '廊坊市', prov: '13' },
  { id: '131100', name: '衡水市', prov: '13' },
  { id: '140100', name: '太原市', prov: '14' }, { id: '140200', name: '大同市', prov: '14' },
  { id: '140300', name: '阳泉市', prov: '14' }, { id: '140400', name: '长治市', prov: '14' },
  { id: '140500', name: '晋城市', prov: '14' }, { id: '140600', name: '朔州市', prov: '14' },
  { id: '150100', name: '呼和浩特市', prov: '15' }, { id: '150200', name: '包头市', prov: '15' },
  { id: '150300', name: '乌海市', prov: '15' }, { id: '150400', name: '赤峰市', prov: '15' },
  { id: '150500', name: '呼伦贝尔市', prov: '15' },
  { id: '210100', name: '沈阳市', prov: '21' }, { id: '210200', name: '大连市', prov: '21' },
  { id: '210300', name: '鞍山市', prov: '21' }, { id: '210400', name: '抚顺市', prov: '21' },
  { id: '210500', name: '本溪市', prov: '21' }, { id: '210600', name: '丹东市', prov: '21' },
  { id: '220100', name: '长春市', prov: '22' }, { id: '220200', name: '吉林市', prov: '22' },
  { id: '220300', name: '四平市', prov: '22' }, { id: '220400', name: '辽源市', prov: '22' },
  { id: '230100', name: '哈尔滨市', prov: '23' }, { id: '230200', name: '齐齐哈尔市', prov: '23' },
  { id: '230300', name: '鸡西市', prov: '23' }, { id: '230400', name: '大庆市', prov: '23' },
  { id: '310100', name: '上海市', prov: '31' },
  { id: '320100', name: '南京市', prov: '32' }, { id: '320200', name: '无锡市', prov: '32' },
  { id: '320300', name: '徐州市', prov: '32' }, { id: '320400', name: '常州市', prov: '32' },
  { id: '320500', name: '苏州市', prov: '32' }, { id: '320600', name: '南通市', prov: '32' },
  { id: '320700', name: '连云港市', prov: '32' }, { id: '320800', name: '淮安市', prov: '32' },
  { id: '320900', name: '盐城市', prov: '32' }, { id: '321000', name: '扬州市', prov: '32' },
  { id: '321100', name: '镇江市', prov: '32' }, { id: '321200', name: '泰州市', prov: '32' },
  { id: '321300', name: '宿迁市', prov: '32' },
  { id: '330100', name: '杭州市', prov: '33' }, { id: '330200', name: '宁波市', prov: '33' },
  { id: '330300', name: '温州市', prov: '33' }, { id: '330400', name: '嘉兴市', prov: '33' },
  { id: '330500', name: '湖州市', prov: '33' }, { id: '330600', name: '绍兴市', prov: '33' },
  { id: '330700', name: '金华市', prov: '33' }, { id: '330800', name: '衢州市', prov: '33' },
  { id: '330900', name: '舟山市', prov: '33' }, { id: '331000', name: '台州市', prov: '33' },
  { id: '331100', name: '丽水市', prov: '33' },
  { id: '340100', name: '合肥市', prov: '34' }, { id: '340200', name: '芜湖市', prov: '34' },
  { id: '340300', name: '蚌埠市', prov: '34' }, { id: '340400', name: '淮南市', prov: '34' },
  { id: '340500', name: '马鞍山市', prov: '34' }, { id: '340600', name: '淮北市', prov: '34' },
  { id: '340700', name: '铜陵市', prov: '34' }, { id: '340800', name: '安庆市', prov: '34' },
  { id: '340900', name: '黄山市', prov: '34' }, { id: '341000', name: '滁州市', prov: '34' },
  { id: '341100', name: '阜阳市', prov: '34' },
  { id: '350100', name: '福州市', prov: '35' }, { id: '350200', name: '厦门市', prov: '35' },
  { id: '350300', name: '莆田市', prov: '35' }, { id: '350400', name: '三明市', prov: '35' },
  { id: '350500', name: '泉州市', prov: '35' }, { id: '350600', name: '漳州市', prov: '35' },
  { id: '350700', name: '南平市', prov: '35' }, { id: '350800', name: '龙岩市', prov: '35' },
  { id: '350900', name: '宁德市', prov: '35' },
  { id: '360100', name: '南昌市', prov: '36' }, { id: '360200', name: '景德镇市', prov: '36' },
  { id: '360300', name: '萍乡市', prov: '36' }, { id: '360400', name: '九江市', prov: '36' },
  { id: '360500', name: '新余市', prov: '36' }, { id: '360600', name: '鹰潭市', prov: '36' },
  { id: '360700', name: '赣州市', prov: '36' },
  { id: '370100', name: '济南市', prov: '37' }, { id: '370200', name: '青岛市', prov: '37' },
  { id: '370300', name: '淄博市', prov: '37' }, { id: '370400', name: '枣庄市', prov: '37' },
  { id: '370500', name: '东营市', prov: '37' }, { id: '370600', name: '烟台市', prov: '37' },
  { id: '370700', name: '潍坊市', prov: '37' }, { id: '370800', name: '济宁市', prov: '37' },
  { id: '370900', name: '泰安市', prov: '37' }, { id: '371000', name: '威海市', prov: '37' },
  { id: '371100', name: '日照市', prov: '37' }, { id: '371200', name: '临沂市', prov: '37' },
  { id: '371300', name: '德州市', prov: '37' }, { id: '371400', name: '聊城市', prov: '37' },
  { id: '371500', name: '滨州市', prov: '37' }, { id: '371600', name: '菏泽市', prov: '37' },
  { id: '410100', name: '郑州市', prov: '41' }, { id: '410200', name: '开封市', prov: '41' },
  { id: '410300', name: '洛阳市', prov: '41' }, { id: '410400', name: '平顶山市', prov: '41' },
  { id: '410500', name: '安阳市', prov: '41' }, { id: '410600', name: '鹤壁市', prov: '41' },
  { id: '410700', name: '新乡市', prov: '41' }, { id: '410800', name: '焦作市', prov: '41' },
  { id: '410900', name: '濮阳市', prov: '41' }, { id: '411000', name: '许昌市', prov: '41' },
  { id: '411100', name: '漯河市', prov: '41' }, { id: '411200', name: '三门峡市', prov: '41' },
  { id: '411300', name: '南阳市', prov: '41' }, { id: '411400', name: '商丘市', prov: '41' },
  { id: '411500', name: '信阳市', prov: '41' }, { id: '411600', name: '周口市', prov: '41' },
  { id: '411700', name: '驻马店市', prov: '41' }, { id: '411800', name: '济源市', prov: '41' },
  { id: '420100', name: '武汉市', prov: '42' }, { id: '420200', name: '黄石市', prov: '42' },
  { id: '420300', name: '十堰市', prov: '42' }, { id: '420400', name: '宜昌市', prov: '42' },
  { id: '420500', name: '襄阳市', prov: '42' }, { id: '420600', name: '鄂州市', prov: '42' },
  { id: '420700', name: '荆门市', prov: '42' }, { id: '420800', name: '孝感市', prov: '42' },
  { id: '420900', name: '荆州市', prov: '42' }, { id: '421000', name: '黄冈市', prov: '42' },
  { id: '421100', name: '咸宁市', prov: '42' }, { id: '421200', name: '随州市', prov: '42' },
  { id: '421300', name: '恩施土家族苗族自治州', prov: '42' },
  { id: '430100', name: '长沙市', prov: '43' }, { id: '430200', name: '株洲市', prov: '43' },
  { id: '430300', name: '湘潭市', prov: '43' }, { id: '430400', name: '衡阳市', prov: '43' },
  { id: '430500', name: '邵阳市', prov: '43' }, { id: '430600', name: '岳阳市', prov: '43' },
  { id: '430700', name: '常德市', prov: '43' }, { id: '430800', name: '张家界市', prov: '43' },
  { id: '430900', name: '益阳市', prov: '43' }, { id: '431000', name: '郴州市', prov: '43' },
  { id: '431100', name: '永州市', prov: '43' }, { id: '431200', name: '怀化市', prov: '43' },
  { id: '431300', name: '娄底市', prov: '43' }, { id: '431400', name: '湘西土家族苗族自治州', prov: '43' },
  { id: '440100', name: '广州市', prov: '44' }, { id: '440200', name: '韶关市', prov: '44' },
  { id: '440300', name: '深圳市', prov: '44' }, { id: '440400', name: '珠海市', prov: '44' },
  { id: '440500', name: '汕头市', prov: '44' }, { id: '440600', name: '佛山市', prov: '44' },
  { id: '440700', name: '江门市', prov: '44' }, { id: '440800', name: '湛江市', prov: '44' },
  { id: '440900', name: '茂名市', prov: '44' }, { id: '441200', name: '肇庆市', prov: '44' },
  { id: '441300', name: '惠州市', prov: '44' }, { id: '441400', name: '梅州市', prov: '44' },
  { id: '441500', name: '汕尾市', prov: '44' }, { id: '441600', name: '河源市', prov: '44' },
  { id: '441700', name: '阳江市', prov: '44' }, { id: '441800', name: '清远市', prov: '44' },
  { id: '441900', name: '东莞市', prov: '44' }, { id: '442000', name: '中山市', prov: '44' },
  { id: '450100', name: '南宁市', prov: '45' }, { id: '450200', name: '柳州市', prov: '45' },
  { id: '450300', name: '桂林市', prov: '45' }, { id: '450400', name: '梧州市', prov: '45' },
  { id: '450500', name: '北海市', prov: '45' }, { id: '450600', name: '防城港市', prov: '45' },
  { id: '450700', name: '钦州市', prov: '45' }, { id: '450800', name: '贵港市', prov: '45' },
  { id: '450900', name: '玉林市', prov: '45' }, { id: '451000', name: '百色市', prov: '45' },
  { id: '451100', name: '贺州市', prov: '45' }, { id: '451200', name: '河池市', prov: '45' },
  { id: '460100', name: '海口市', prov: '46' }, { id: '460200', name: '三亚市', prov: '46' },
  { id: '500100', name: '重庆市', prov: '50' },
  { id: '510100', name: '成都市', prov: '51' }, { id: '510300', name: '自贡市', prov: '51' },
  { id: '510400', name: '攀枝花市', prov: '51' }, { id: '510500', name: '泸州市', prov: '51' },
  { id: '510600', name: '德阳市', prov: '51' }, { id: '510700', name: '绵阳市', prov: '51' },
  { id: '511000', name: '乐山市', prov: '51' }, { id: '511100', name: '南充市', prov: '51' },
  { id: '511300', name: '眉山市', prov: '51' }, { id: '511500', name: '宜宾市', prov: '51' },
  { id: '511600', name: '广安市', prov: '51' }, { id: '511700', name: '达州市', prov: '51' },
  { id: '511800', name: '雅安市', prov: '51' }, { id: '511900', name: '巴中市', prov: '51' },
  { id: '512000', name: '资阳市', prov: '51' }, { id: '513200', name: '阿坝藏族羌族自治州', prov: '51' },
  { id: '513300', name: '甘孜藏族自治州', prov: '51' }, { id: '513400', name: '凉山彝族自治州', prov: '51' },
  { id: '520100', name: '贵阳市', prov: '52' }, { id: '520200', name: '六盘水市', prov: '52' },
  { id: '520300', name: '遵义市', prov: '52' }, { id: '520400', name: '安顺市', prov: '52' },
  { id: '520500', name: '毕节市', prov: '52' }, { id: '520600', name: '铜仁市', prov: '52' },
  { id: '530100', name: '昆明市', prov: '53' }, { id: '530300', name: '曲靖市', prov: '53' },
  { id: '530400', name: '玉溪市', prov: '53' }, { id: '530500', name: '保山市', prov: '53' },
  { id: '530600', name: '昭通市', prov: '53' }, { id: '530700', name: '丽江市', prov: '53' },
  { id: '530800', name: '普洱市', prov: '53' }, { id: '530900', name: '临沧市', prov: '53' },
  { id: '540100', name: '拉萨市', prov: '54' }, { id: '540200', name: '日喀则市', prov: '54' },
  { id: '540300', name: '昌都市', prov: '54' }, { id: '540400', name: '林芝市', prov: '54' },
  { id: '540500', name: '山南市', prov: '54' }, { id: '540600', name: '那曲市', prov: '54' },
  { id: '610100', name: '西安市', prov: '61' }, { id: '610200', name: '铜川市', prov: '61' },
  { id: '610300', name: '宝鸡市', prov: '61' }, { id: '610400', name: '咸阳市', prov: '61' },
  { id: '610500', name: '渭南市', prov: '61' }, { id: '610600', name: '延安市', prov: '61' },
  { id: '610700', name: '汉中市', prov: '61' }, { id: '610800', name: '榆林市', prov: '61' },
  { id: '610900', name: '安康市', prov: '61' }, { id: '611000', name: '商洛市', prov: '61' },
  { id: '620100', name: '兰州市', prov: '62' }, { id: '620200', name: '嘉峪关市', prov: '62' },
  { id: '620300', name: '金昌市', prov: '62' }, { id: '620400', name: '白银市', prov: '62' },
  { id: '620500', name: '天水市', prov: '62' }, { id: '620600', name: '武威市', prov: '62' },
  { id: '620700', name: '张掖市', prov: '62' }, { id: '620800', name: '平凉市', prov: '62' },
  { id: '620900', name: '酒泉市', prov: '62' }, { id: '621000', name: '庆阳市', prov: '62' },
  { id: '621100', name: '定西市', prov: '62' }, { id: '621200', name: '陇南市', prov: '62' },
  { id: '630100', name: '西宁市', prov: '63' }, { id: '630200', name: '海东市', prov: '63' },
  { id: '640100', name: '银川市', prov: '64' }, { id: '640200', name: '石嘴山市', prov: '64' },
  { id: '640300', name: '吴忠市', prov: '64' }, { id: '640400', name: '固原市', prov: '64' },
  { id: '640500', name: '中卫市', prov: '64' },
  { id: '650100', name: '乌鲁木齐市', prov: '65' }, { id: '650200', name: '克拉玛依市', prov: '65' },
  { id: '650300', name: '吐鲁番市', prov: '65' }, { id: '650400', name: '哈密市', prov: '65' },
  { id: '650500', name: '昌吉回族自治州', prov: '65' }, { id: '650600', name: '博尔塔拉蒙古自治州', prov: '65' },
  { id: '650700', name: '巴音郭楞蒙古自治州', prov: '65' }, { id: '650800', name: '阿克苏地区', prov: '65' },
  { id: '710100', name: '台北市', prov: '71' }, { id: '710200', name: '高雄市', prov: '71' },
  { id: '710300', name: '台中市', prov: '71' }, { id: '710400', name: '台南市', prov: '71' },
  { id: '710500', name: '新北市', prov: '71' }, { id: '710600', name: '桃园市', prov: '71' },
  { id: '710700', name: '基隆市', prov: '71' }, { id: '710800', name: '新竹市', prov: '71' },
  { id: '710900', name: '嘉义市', prov: '71' },
  { id: '810100', name: '香港岛', prov: '81' }, { id: '810200', name: '九龙', prov: '81' },
  { id: '810300', name: '新界', prov: '81' },
  { id: '820100', name: '澳门半岛', prov: '82' },
];

/** 默认城市：老存档 / 未选择时的兜底（北京市）
 *  ⚠️ 必须是 6 位（GB/T 2260 市级代码形态）。这里曾是 4 位的 '1101'，
 *     城市表改成 6 位后它就指向了不存在的 id —— 退默认时 cityById 查不到，
 *     展示模型的 cityName 变成空串（K5d 抓到的就是这个问题）。
 *     常量必须与 CITIES 的形态保持一致。 */
const CITY_DEFAULT = '110100';

/**
 * 区县级字典（可选第三级）。
 * 刻意**不内置全量**：全国 2900+ 区县且逐年调整，硬编码必然很快过期。
 * 这里给出结构 + 重点城市真实数据作为样例；未收录的城市 UI 自动降级为「仅到市级」。
 * 生产环境应接民政部《行政区划代码》库（GB/T 2260）按版本同步。
 */
const DISTRICTS = {
  '110100': [{ id: '110101', name: '东城区' }, { id: '110102', name: '西城区' },
    { id: '110105', name: '朝阳区' }, { id: '110106', name: '丰台区' },
    { id: '110107', name: '石景山区' }, { id: '110108', name: '海淀区' },
    { id: '110109', name: '门头沟区' }, { id: '110111', name: '石景山区' },
    { id: '110112', name: '通州区' }, { id: '110113', name: '顺义区' },
    { id: '110114', name: '昌平区' }, { id: '110115', name: '大兴区' }],
  '440300': [{ id: '440303', name: '罗湖区' }, { id: '440304', name: '福田区' },
    { id: '440305', name: '南山区' }, { id: '440306', name: '宝安区' },
    { id: '440307', name: '龙岗区' }, { id: '440308', name: '盐田区' },
    { id: '440309', name: '龙华区' }, { id: '440310', name: '坪山区' },
    { id: '440311', name: '光明区' }],
  '440100': [{ id: '440103', name: '荔湾区' }, { id: '440104', name: '越秀区' },
    { id: '440105', name: '海珠区' }, { id: '440106', name: '天河区' },
    { id: '440111', name: '白云区' }, { id: '440112', name: '黄埔区' },
    { id: '440113', name: '番禺区' }, { id: '440114', name: '花都区' },
    { id: '440115', name: '南沙区' }, { id: '440117', name: '从化区' },
    { id: '440118', name: '增城区' }],
  '310100': [{ id: '310101', name: '黄浦区' }, { id: '310104', name: '徐汇区' },
    { id: '310105', name: '长宁区' }, { id: '310106', name: '静安区' },
    { id: '310107', name: '普陀区' }, { id: '310109', name: '虹口区' },
    { id: '310110', name: '杨浦区' }, { id: '310112', name: '闵行区' },
    { id: '310113', name: '宝山区' }, { id: '310114', name: '嘉定区' },
    { id: '310115', name: '浦东新区' }, { id: '310116', name: '金山区' },
    { id: '310117', name: '松江区' }, { id: '310118', name: '青浦区' },
    { id: '310120', name: '奉贤区' }],
  '510100': [{ id: '510104', name: '锦江区' }, { id: '510105', name: '青羊区' },
    { id: '510106', name: '金牛区' }, { id: '510107', name: '武侯区' },
    { id: '510108', name: '成华区' }, { id: '510112', name: '龙泉驿区' },
    { id: '510113', name: '青白江区' }, { id: '510114', name: '新都区' },
    { id: '510115', name: '温江区' }, { id: '510116', name: '双流区' },
    { id: '510117', name: '郫都区' }, { id: '510118', name: '新津区' }],
  '420100': [{ id: '420102', name: '江岸区' }, { id: '420103', name: '江汉区' },
    { id: '420104', name: '硚口区' }, { id: '420105', name: '汉阳区' },
    { id: '420106', name: '武昌区' }, { id: '420107', name: '青山区' },
    { id: '420111', name: '洪山区' }, { id: '420112', name: '东西湖区' },
    { id: '420113', name: '汉南区' }, { id: '420114', name: '蔡甸区' },
    { id: '420115', name: '江夏区' }, { id: '420116', name: '黄陂区' }],
  '330100': [{ id: '330102', name: '上城区' }, { id: '330105', name: '拱墅区' },
    { id: '330106', name: '西湖区' }, { id: '330108', name: '滨江区' },
    { id: '330109', name: '萧山区' }, { id: '330110', name: '余杭区' },
    { id: '330111', name: '富阳区' }, { id: '330112', name: '临安区' },
    { id: '330113', name: '临平区' }, { id: '330114', name: '钱塘区' }],
};

/**
 * 坐标系与地理范围（高德 GCJ-02）。
 * 界内范围取**包围盒**，用来拦明显越界的脏数据（手输错位数、误传 WGS-84/BD-09）。
 * 注意：包围盒只能拦住「离谱」的错值，**不能**据此判断坐标是否属于某个城市
 * （城市的真实边界是不规则多边形）—— 城市归属交给高德逆地理编码（IP 定位），
 * 本地只做「选了城市」+「坐标在境内」的弱校验。
 */
const GEO = {
  COORD_SYS: 'GCJ02',                     // 唯一口径，禁止混用
  MIN_LNG: 73.5, MAX_LNG: 135.1,        // 经度（最西 ~73.5 东极 ~135.1）
  MIN_LAT: 3.2,  MAX_LAT: 53.6,         // 纬度（南端曾母暗沙 ~3.2 北端漠河 ~53.6）
  PRECISION: 6,                          // 保留 6 位小数（约 0.11 米），再多只是噪声
  /** 兜底坐标：北京天安门（用于「未选点」时的默认展示，不代表真实经营地） */
  FALLBACK: { lng: 116.397428, lat: 39.90923 },
};

/**
 * 城市中心坐标（GCJ-02），供「定位当前城市」使用。
 *
 * 用途与边界：这是**市级行政区的几何中心附近**，不是真实经营地。
 * 点它等于「先按城市市中心记一个位置，之后可再用地图选点精确到店」。
 * 与 GEO.FALLBACK 的区别：FALLBACK 是"连城市都没选时的展示兜底"，
 * 而这里是"已选城市 → 给一个该城市的合理默认坐标"，语义不同。
 *
 * 同样刻意**不全量收录 272 个市**：只收主要城市，其余城市用
 * `cityGeoOf()` 的兜底（省中心）而不是编一个假坐标。
 */
const CITY_CENTERS = {
  '110100': { lng: 116.407428, lat: 39.90923 },   // 北京市
  '120100': { lng: 117.200983, lat: 39.084158 },   // 天津市
  '310100': { lng: 121.473701, lat: 31.230416 },   // 上海市
  '500100': { lng: 106.551556, lat: 29.563009 },   // 重庆市
  '440100': { lng: 113.264435, lat: 23.129112 },   // 广州市
  '440300': { lng: 114.057868, lat: 22.543099 },   // 深圳市
  '440400': { lng: 113.553986, lat: 22.224979 },   // 珠海市
  '330100': { lng: 120.155070, lat: 30.274084 },   // 杭州市
  '320100': { lng: 118.796877, lat: 32.060255 },   // 南京市
  '510100': { lng: 104.065735, lat: 30.659462 },   // 成都市
  '420100': { lng: 114.298572, lat: 30.584355 },   // 武汉市
  '610100': { lng: 108.948024, lat: 34.263161 },   // 西安市
  '370200': { lng: 120.382639, lat: 36.067082 },   // 青岛市
  '210100': { lng: 123.429096, lat: 41.796767 },   // 沈阳市
  '230100': { lng: 126.534967, lat: 45.803775 },   // 哈尔滨市
  '350200': { lng: 118.089425, lat: 24.479833 },   // 厦门市
  '320500': { lng: 120.585316, lat: 31.298886 },   // 苏州市
  '340100': { lng: 117.283042, lat: 31.861191 },   // 合肥市
  '530100': { lng: 102.832891, lat: 24.880095 },   // 昆明市
  '330200': { lng: 121.550267, lat: 29.874557 },   // 宁波市
  '330100': { lng: 120.155070, lat: 30.274084 },   // 杭州市
  '370100': { lng: 117.000923, lat: 36.675807 },   // 济南市
  '410100': { lng: 113.625368, lat: 34.746599 },   // 郑州市
  '360100': { lng: 115.858198, lat: 28.682892 },   // 南昌市
  '220100': { lng: 125.324500, lat: 43.886841 },   // 长春市
  '650100': { lng: 87.617733, lat: 43.792818 },    // 乌鲁木齐市
  '460100': { lng: 110.331190, lat: 20.031971 },   // 海口市
  '540100': { lng: 91.132212, lat: 29.660361 },    // 拉萨市
  '620100': { lng: 103.834303, lat: 36.061089 },   // 兰州市
  '630100': { lng: 101.778916, lat: 36.617143 },   // 西宁市
  '640100': { lng: 106.278179, lat: 38.466370 },   // 银川市
  '450100': { lng: 108.366543, lat: 22.817002 },   // 南宁市
  '520100': { lng: 106.630153, lat: 26.647661 },   // 贵阳市
  '130100': { lng: 114.514861, lat: 38.042806 },   // 石家庄市
  '140100': { lng: 112.549248, lat: 37.857014 },   // 太原市
  '150100': { lng: 111.670801, lat: 40.818311 },   // 呼和浩特市
  '340200': { lng: 118.376451, lat: 31.326319 },   // 芜湖市
  '350100': { lng: 119.296494, lat: 26.074507 },   // 福州市
  '360200': { lng: 114.940278, lat: 28.562683 },   // 赣州市
  '430100': { lng: 112.938814, lat: 28.228209 },   // 长沙市
  '440600': { lng: 113.122717, lat: 23.028762 },   // 佛山市
  '510700': { lng: 104.641917, lat: 31.864687 },   // 绵阳市
  '520600': { lng: 109.263888, lat: 27.651642 },   // 铜仁市
  '610300': { lng: 107.144870, lat: 34.369315 },  // 宝鸡市
  '610400': { lng: 108.705117, lat: 34.333439 },   // 咸阳市
};

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
/* effect 支持：cash / rep / inv{ing:qty} / trafficMul(次日，经 s.eventTrafficMul
   在下一次 openShop 的 trafficOf 里生效) / staffHeal / unlockRecipe / repMul /
   upgrade / loseStaff。注意 trafficMul 不是当日的 —— 事件发生在备货阶段，
   倍率留给接下来那次开门用。 */
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
  { id: 'a_research_all', name: '配方全收集', emoji: '📖', desc: '解锁全部可研发配方', reward: { cash: 3000, bp: 12 },
    /* ★ 用"全部可研发配方"而不是写死数字：
       V10 加了 42 款城市菜，写死"10 款"的话这条成就永远不可能达成
       （玩家在 30 天里解锁不到 57 款）—— 一条够不到的成就是纯粹的负担。
       现在改为「解锁 ≥ 60% 可研发配方」，随配方表增减自动跟随。 */
    check: s => (s.recipes.length >= Math.ceil(RESEARCH_TREE.length * 0.6)) },
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
  { id: 'a_nolost', name: '零流失日', emoji: '🎯', desc: '单日卖出 24 杯且 0 流失', reward: { cash: 600, bp: 3 },
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
  /* desc 说的是「杯」不是「位」：判定用的 typeServed 累加的是杯数
     （一位网红点 3 杯就 +3），按「位」写会误导玩家以为要来 5 个人。 */
  { id: 'a_starmagnet', name: '自带流量体质', emoji: '📸', desc: '单日向网红顾客卖出 5 杯', reward: { cash: 500, bp: 3 },
    check: s => !!s.flags.starMagnet },
  { id: 'a_poach', name: '挖墙脚', emoji: '🕵️', desc: '从竞争对手处挖来 1 名员工', reward: { cash: 400, bp: 2 },
    check: s => !!s.flags.poached },
  { id: 'a_rivaldown', name: '一条街的王者', emoji: '👊', desc: '把对手口碑压到 10 以下', reward: { cash: 1500, bp: 6 },
    check: s => !!s.flags.rivalDown },
  { id: 'a_moat', name: '护城河', emoji: '🏰', desc: '产品差异化叠到 5 层', reward: { cash: 1200, bp: 5 },
    check: s => !!(s.rival && s.rival.proof >= 5) },
  { id: 'a_endless3', name: '无尽传说', emoji: '♾️', desc: '无尽模式达成第 3 个里程碑', reward: { cash: 3000, bp: 12 },
    check: s => !!(s.endless && (s.milestone || 0) >= 3) },

  /* ---------- V10：城市风味 ---------- */
  { id: 'a_city_3', name: '跨城游商', emoji: '🧭', desc: '经营过 3 个不同城市', reward: { cash: 600, bp: 3 },
    check: s => cityVisited(s) >= 3 },
  { id: 'a_city_6', name: '全国连锁', emoji: '🏙️', desc: '经营过 6 个不同城市', reward: { cash: 1500, bp: 6 },
    check: s => cityVisited(s) >= 6 },
  { id: 'a_local_3', name: '本地风味', emoji: '🥢', desc: '累计解锁 3 款本地特色菜', reward: { cash: 800, bp: 4 },
    check: s => localRecipeCount(s) >= 3 },
  { id: 'a_local_all5', name: '一方水土', emoji: '🏞️', desc: '累计解锁 5 款本地特色菜', reward: { cash: 1800, bp: 8 },
    check: s => localRecipeCount(s) >= 5 },
  { id: 'a_master5', name: '研发树大师', emoji: '🌳', desc: '解锁任意 15 款配方', reward: { cash: 1200, bp: 6 },
    check: s => (s.recipes.length >= 15) },

  /* ---------- V10：成就专属食谱奖励 ----------
     ★ reward.recipe 指向 ACH_RECIPES —— 它们不在 RESEARCH_TREE 里、
       没有任何研发路径能拿到，只能这样给。
       发放 / 重复获得处理见 engine.grantAchRecipe。 */
  { id: 'a_ach_golden', name: '鎏金传说', emoji: '🥇', desc: '口碑达到 99', reward: { cash: 2000, bp: 10, recipe: 'ach_golden' },
    check: s => (s.rep >= 99) },
  { id: 'a_ach_moon', name: '月落之时', emoji: '🌕', desc: '单日卖出 120 杯', reward: { cash: 1500, bp: 7, recipe: 'ach_moon' },
    check: s => (s.stats.lastDayCups >= 120) },
  { id: 'a_ach_nightfall', name: '不打烊的城市', emoji: '🌃', desc: '单局连续经营 30 天不换城', reward: { cash: 1800, bp: 8, recipe: 'ach_nightfall' },
    check: s => ((s.stayDays || 0) >= 30) },
  { id: 'a_ach_terrace', name: '云顶之上', emoji: '🌾', desc: '累计营收达到 ¥30000', reward: { cash: 2200, bp: 9, recipe: 'ach_terrace' },
    check: s => (s.stats.totalRevenue >= 30000) },
  /* 城市绑定的奖励食谱：成就达成即得，但要去对应城市才能上架。
     这几条把「成就奖励」与「城市绑定」两条线交叉起来 ——
     玩家拿到菜会立刻知道"哦，得去趟成都"，而不是以为菜单坏了。 */
  { id: 'a_ach_firstcity', name: '山城初见', emoji: '🏞️', desc: '在成都解锁 3 款本地菜', reward: { cash: 2000, bp: 9, recipe: 'ach_firstcity' },
    check: s => localCountIn(s, '510100') >= 3 },
  { id: 'a_ach_southsea', name: '落日收集者', emoji: '🌇', desc: '在三亚解锁 3 款本地菜', reward: { cash: 2000, bp: 9, recipe: 'ach_southsea' },
    check: s => localCountIn(s, '460200') >= 3 },
  { id: 'a_ach_capital', name: '京华烟云', emoji: '🏯', desc: '解锁 12 款通用配方', reward: { cash: 2400, bp: 10, recipe: 'ach_capital' },
    check: s => (s.recipes.filter(rid => { const rr = recipeById(rid); return rr && !rr.city; }).length >= 12) },
];

/** 成就 ★ 总量的展示文案。
 *
 * ★ 放在 data.js 而不是 ui.js —— 小游戏端不加载 js/ui.js（两个 UI 是独立后端），
 *   函数放在 ui 里的话 Canvas 端一调用就 ReferenceError。
 *   凡是要两版共用的，都得放这一层。
 *
 * ★ 为什么必须动态算而不是写死数字：
 *   原先三处文案都硬编码「32 条共 150★」。V10 新增 12 条成就后数字全错，
 *   而这类错误**没有任何报错** —— 页面照常渲染，只是数字在骗人。
 */
function achStarText() {
  const total = ACHIEVEMENTS.reduce((n, a) => n + (a.reward && a.reward.bp || 0), 0);
  return `${ACHIEVEMENTS.length} 条共 ${total} ★`;
}

/* 统计辅助：城市风味成就的 check 全部走这三个纯函数。
   放在 data.js 而不是 engine.js —— 因为 check 是**数据表里的箭头函数**，
   若定义在 engine 里，data.js 就得反向引用 engine，破坏单向依赖
   （data.js 被 engine 与 probe 同时加载，反向引用会造成加载顺序陷阱）。 */
function cityVisited(s) {
  const cur = (s.venue && s.venue.cityId) || CITY_DEFAULT;
  const seen = Array.isArray(s.citiesVisited) ? s.citiesVisited.slice() : [];
  if (seen.indexOf(cur) < 0) seen.push(cur);
  return seen.filter(id => !!cityById(id)).length;
}
function localRecipeCount(s) {
  return (s.recipes || []).filter(id => {
    const r = recipeById(id);
    return r && !!r.city;
  }).length;
}
function localCountIn(s, cityId) {
  return (s.recipes || []).filter(id => {
    const r = recipeById(id);
    return r && r.city === cityId;
  }).length;
}

/* ============================================================
 *  打烊三选一「经营策略卡」
 *
 *  设计约束（违反就退化成"随机数值包"，没有决策可言）：
 *    1. **每张卡必须有得有失**。只发增益的话最优解永远是"全都要"，
 *       抽卡和抽到什么都不重要，等于没加玩法。
 *    2. **改的是收益结构，不是收益总量**。比如「薄利多销」把客流挪过来、
 *       再从单价那里扣回去 —— 它改变"该雇人还是该装修"，但不该让净资产凭空 +20%。
 *       这条用 tools/sim.js --cards=always 验证：达标率相对无卡组不应漂移超过 ±8pp。
 *    3. **不重复**：每张最多持有一次，所以 6 张上限意味着 C(12,6)=924 种 Build。
 *    4. **少给「客流 +」**。这正是 F1 刚修掉的坑：需求端单方面变强而产能不涨，
 *       多来的客人只会变成流失和口碑下滑。所以 12 张里只有外卖平台一张加客流，
 *       其余都在产能 / 定价 / 成本之间挪。
 *
 *  fx 里的键名与 engine 的 cardMul / cardSum 一一对应（改键名两处都要改）：
 *    traffic 客流倍率 | speed 出杯速度 | priceTol 价格容忍 | patience 排队耐心
 *    tip 小费 | unitSub 每杯扣钱 | cogs 原料成本 | rent 租金 | wage 工资
 *    stamina 体力消耗 | repGain 口碑增减
 * ============================================================ */
/* ---------- 策略卡 ----------
 * theme 共鸣：CARD_THEMES 把 12 张卡归到 4 个主题，持有同主题 2 张 → 该主题
 *   效果 +10%，3 张 → +25%（见 engine 的 cardThemeBonus）。
 *   没有主题时这就是 12 组纯数值交换，玩家的选卡逻辑退化成"算净收益最大的
 *   那几张"—— 单局内唯一的 build 分歧点变成了算术题。
 *
 * boost : 这张卡里**属于增益**的 fx 键，只有它们吃主题共鸣。
 *   必须显式声明，不能靠"值 < 1 就算代价"来猜 —— 中央厨房的 cogs: 0.86
 *   （原料成本 −14%）是增益却小于 1，精品路线的 traffic: 0.92 是代价也小于 1。
 *   代价不跟着共鸣涨是有意的：否则凑主题反而被罚，与"奖励走对路线"相反。
 */
const CARD_THEMES = {
  takeout: { key: 'traffic', name: '引流', emoji: '🛵' },
  night:   { key: 'traffic', name: '引流', emoji: '🌙' },
  premium: { key: 'premium', name: '溢价', emoji: '💎' },
  member:  { key: 'premium', name: '溢价', emoji: '🎫' },
  kiosk:   { key: 'premium', name: '溢价', emoji: '🤖' },
  express: { key: 'speed',   name: '效率', emoji: '🚀' },
  prefab:  { key: 'speed',   name: '效率', emoji: '🫖' },
  stall:   { key: 'speed',   name: '效率', emoji: '🏮' },
  kitchen: { key: 'cost',    name: '成本', emoji: '🍳' },
  bulk:    { key: 'cost',    name: '成本', emoji: '📦' },
  chain:   { key: 'cost',    name: '成本', emoji: '🏬' },
  equity:  { key: 'cost',    name: '成本', emoji: '🤝' },
};

const STRATEGY_CARDS = [
  { id: 'takeout', name: '外卖平台', emoji: '🛵', gain: '客流 +25%', cost: '每杯收入 -¥0.8',
    fx: { traffic: 1.25, unitSub: 0.8 }, boost: ['traffic'] },
  { id: 'premium', name: '精品路线', emoji: '💎', gain: '顾客能接受 +20% 溢价', cost: '客流 -8%',
    fx: { priceTol: 1.20, traffic: 0.92 }, boost: ['priceTol'] },
  { id: 'express', name: '极速出杯', emoji: '🚀', gain: '出杯速度 +18%', cost: '小费 -22%',
    fx: { speed: 1.18, tip: 0.78 }, boost: ['speed'] },
  { id: 'member', name: '会员体系', emoji: '🎫', gain: '排队耐心 +28%', cost: '租金 +8%',
    fx: { patience: 1.28, rent: 1.08 }, boost: ['patience'] },
  { id: 'kitchen', name: '中央厨房', emoji: '🍳', gain: '原料成本 -14%', cost: '工资 +14%',
    fx: { cogs: 0.86, wage: 1.14 }, boost: ['cogs'] },
  { id: 'night', name: '通宵营业', emoji: '🌙', gain: '体力消耗 -45%', cost: '客流 -7%',
    fx: { stamina: 0.55, traffic: 0.93 }, boost: ['stamina'] },
  { id: 'kiosk', name: '自助点单机', emoji: '🤖', gain: '小费 +55%', cost: '出杯速度 -6%',
    fx: { tip: 1.55, speed: 0.94 }, boost: ['tip'] },
  { id: 'prefab', name: '预制茶汤', emoji: '🫖', gain: '出杯速度 +12%', cost: '原料成本 +9%',
    fx: { speed: 1.12, cogs: 1.09 }, boost: ['speed'] },
  { id: 'bulk', name: '批发采购', emoji: '📦', gain: '原料成本 -15%', cost: '租金 +12%',
    fx: { cogs: 0.85, rent: 1.12 }, boost: ['cogs'] },
  { id: 'stall', name: '夜市摊位', emoji: '🏮', gain: '排队耐心 +20%', cost: '出杯速度 -8%',
    fx: { patience: 1.20, speed: 0.92 }, boost: ['patience'] },
  { id: 'chain', name: '加盟模式', emoji: '🏬', gain: '租金 -18%', cost: '每杯收入 -¥0.6',
    fx: { rent: 0.82, unitSub: 0.6 }, boost: ['rent'] },
  { id: 'equity', name: '员工入股', emoji: '🤝', gain: '工资 -20%', cost: '排队耐心 -10%',
    fx: { wage: 0.80, patience: 0.90 }, boost: ['wage'] },
];

/* ---------- 每日合同（V1）----------
 * 和每日任务（QUESTS）的关键区别是**决策窗口**：
 *   任务 = 打烊后判定，玩家事前不知道 → 只能事后看；
 *   合同 = 开门前就摆在备货页，玩家可以围绕它调整采购、菜单、定价。
 * 同一个判定框架（都在打烊时用当日指标结算），换来"今天要凑什么"的明确目标，
 * 这正是备货阶段最缺的东西 —— 否则每天就是点一次「一键补货」。
 *
 * check(m) 里的 m 是 endDay 汇总的当日指标（见 engine 的 contractMetrics）。
 * goal/hint 用于备货页显示"还差多少"，玩家据此决定要不要改配方组合。
 *
 * 奖励刻意压在 ¥180~280：它是"引导备货方向的胡萝卜"，不是第二收入来源。
 * （每日任务那边实测过：奖励翻倍会让净资产虚高 27%，直接把难度改掉。）
 * 失败扣 3~4 点口碑 —— 口碑直接决定次日客流，所以没完成是有真实代价的，
 * 但不至于让一局崩掉。
 */
const CONTRACTS = [
  { id: 'c_cups', emoji: '🥤', name: '走量担当', cash: 110, failRep: -3,
    desc: '今日卖出 12 杯', goal: 12, unit: '杯', metric: 'cups', dir: 'up',
    check: (m, g) => m.cups >= g },
  { id: 'c_revenue', emoji: '💸', name: '营收担当', cash: 127, failRep: -4,
    desc: '今日营收达到 ¥420', goal: 420, unit: '', metric: 'revenue', dir: 'up', prefix: '¥',
    check: (m, g) => m.revenue >= g },
  { id: 'c_cheap', emoji: '🏷️', name: '薄利多销', cash: 127, failRep: -3,
    desc: '卖出 12 杯且平均单价 ≤ ¥28', goal: 12, unit: '杯', metric: 'cups', dir: 'up',
    /* ★ V21：阈值必须**显式登记在合同上**，不能只写在 check 里。
       原来 check 读 m.avgCap，而 contractMetrics() 从来不给这个字段 ——
       `m.avgPrice <= undefined` 恒为 false，这条合同**永远不可能达成**，
       玩家每天白扣 3 点口碑。avgCap/avgFloor/lostCap 三条都是这个毛病。
       现在由 contractMetrics 从本合同的字段里取，缺省为 ±Infinity
       （没有设阈值的合同不会因此被误判失败）。 */
    avgCap: 28,
    check: (m, g) => m.cups >= g && m.avgPrice <= m.avgCap },
  { id: 'c_premium', emoji: '💎', name: '高端形象', cash: 138, failRep: -4,
    desc: '卖出 8 杯且平均单价 ≥ ¥26', goal: 8, unit: '杯', metric: 'cups', dir: 'up',
    avgFloor: 26,
    check: (m, g) => m.cups >= g && m.avgPrice >= m.avgFloor },
  { id: 'c_nolost', emoji: '🎯', name: '零流失', cash: 110, failRep: -4,
    desc: '完成 8 单且流失 ≤ 2 人', goal: 8, unit: '单', metric: 'orders', dir: 'up',
    lostCap: 2,
    check: (m, g) => m.orders >= g && m.lost <= m.lostCap },
  { id: 'c_combo', emoji: '⚡', name: '手速达人', cash: 99, failRep: -3,
    desc: '连点出杯位 20 次', goal: 20, unit: '次', metric: 'clicks', dir: 'up',
    check: (m, g) => m.clicks >= g },
  { id: 'c_trend', emoji: '🌟', name: '潮流捕手', cash: 110, failRep: -3,
    desc: '命中今日流行 5 杯', goal: 5, unit: '杯', metric: 'trend', dir: 'up',
    check: (m, g) => m.trendCups >= g },
  { id: 'c_sat', emoji: '😊', name: '口碑经营', cash: 105, failRep: -4,
    desc: '今日满意率 ≥ 92%', goal: 0.92, unit: '', metric: 'sat', dir: 'up',
    check: (m, g) => m.sat >= g },
  { id: 'c_infl', emoji: '📸', name: '网红专场', cash: 143, failRep: -4,
    desc: '向网红顾客卖出 4 杯', goal: 4, unit: '杯', metric: 'infl', dir: 'up',
    check: (m, g) => (m.typeServed.influencer || 0) >= g },
  { id: 'c_profit', emoji: '📈', name: '利润担当', cash: 143, failRep: -4,
    desc: '今日净利达到 ¥200', goal: 200, unit: '', metric: 'net', dir: 'up', prefix: '¥',
    check: (m, g) => m.net >= g },
];

/* ============================================================
 *  第二批玩法系统（V5~V8）
 *
 *  第一批（V1 合同 / V2 营业决策 / V3 高光 / V4 卡牌共鸣）解决的是
 *  「单日体验」，第二批补的是**跨天结构**与**跨局追求**：
 *
 *   V5 章节关卡   —— 把 30 天切成 6 章，每章 3 个关卡，逐关解锁。
 *                    提供「今天要打哪一关」的短期目标 + 「30 天全通」的长期目标。
 *   V6 招牌配方   —— 某款配方的累计销量跨局继承，逐级解锁永久加成。
 *                    提供跨局的长期追求（这一局我要把芋泥练成招牌）。
 *   V7 事件型顾客 —— 营业中随机出现的「可识别」特殊顾客，制造戏剧性。
 *   V8 结局四维评级 —— 收官时按利润/口碑/服务/经营四维各评一个称号。
 *
 *  平衡红线（第一批踩过的坑，这里直接继承）：
 *   ① 新增的**每日**现金不能是「第二收入来源」——章节关卡的奖励按**整章**发放、
 *      摊到每天不到合同的 1/3；招牌配方的加成是**乘性**的，不额外发钱。
 *   ② 带惩罚的机制必须按难度缩放。章节关卡失败**不扣口碑**（只扣奖励），
 *      避免「失败 → 口碑跌 → 客流跌 → 更失败」的复利死循环。
 *   ③ 比例型指标（满意率）不能跟着难度缩放（0.92×1.22 > 1 永远不可能达成）。
 * ============================================================ */

/* ---------- V5 章节关卡 ----------
 * 30 天切成 6 章，每章 5 天；每章 3 个关卡，必须**按顺序**打通。
 * 为什么要「章节」而不是又一套每日目标：
 *   合同（V1）是「今天凑什么」，一天一换；这里���「这一章要闯哪几关」，
 *   跨 5 天持续推进 —— 提供的是**中期目标**，与每日合同形成两个时间尺度。
 *
 * 每个关卡有 3 档难度（关卡本身也是难度梯度）：
 *   普通  门槛 ×1.0   奖励 ×1.0
 *   精英  门槛 ×1.35  奖励 ×1.8
 *   传奇  门槛 ×1.8   奖励 ×3.0
 * 玩家在**备货阶段**选难度（与合同同一决策窗口：开门前就知道），
 * 打烊时结算。选高难度失败**不扣口碑**，只是拿不到奖励 —— 风险由玩家自己权衡。
 *
 * goal / cash 是**按普通档**的基准值，实际门槛与奖励由 engine 的
 * stageGoalOf / stageCashOf 按难度与天数缩放。
 * 指标全部是「当日」口径（打烊判定），与合同共用同一套指标快照。
 */
const STAGES = [
  { id: 'st_cups',    chapter: 1, order: 1, emoji: '🥤', name: '出杯关',   metric: 'cups',    goal: 26,  cash: 7,  unit: '杯', desc: '卖出 {g} 杯' },
  { id: 'st_rev',    chapter: 1, order: 2, emoji: '💸', name: '营收关',   metric: 'revenue', goal: 640, cash: 10,  unit: '',   prefix: '¥', desc: '营收达到 ¥{g}' },
  { id: 'st_sat',    chapter: 1, order: 3, emoji: '😊', name: '满意关',   metric: 'sat',     goal: 0.9, cash: 13,  unit: '',   desc: '满意率 ≥ {g}%' },
  { id: 'st_orders', chapter: 2, order: 1, emoji: '🧾', name: '翻台关',   metric: 'orders',  goal: 20,  cash: 9,  unit: '单', desc: '接待 {g} 单' },
  { id: 'st_click',  chapter: 2, order: 2, emoji: '👆', name: '手速关',   metric: 'clicks',  goal: 30,  cash: 11,  unit: '次', desc: '连点出杯位 {g} 次' },
  { id: 'st_trend',  chapter: 2, order: 3, emoji: '🌟', name: '潮流关',   metric: 'trend',   goal: 6,   cash: 14,  unit: '杯', desc: '命中今日流行 {g} 杯' },
  { id: 'st_net',    chapter: 3, order: 1, emoji: '📈', name: '利润关',   metric: 'net',     goal: 300, cash: 13,  unit: '',   prefix: '¥', desc: '净利达到 ¥{g}' },
  { id: 'st_lost',   chapter: 3, order: 2, emoji: '🛡️', name: '零流失关', metric: 'lost',    goal: 3,   cash: 16,  unit: '人', desc: '流失不超过 {g} 人' },
  { id: 'st_infl',   chapter: 3, order: 3, emoji: '📸', name: '网红关',   metric: 'infl',    goal: 3,   cash: 19, unit: '杯', desc: '向网红卖出 {g} 杯' },
  { id: 'st_cups2',  chapter: 4, order: 1, emoji: '🥤', name: '出杯关·贰', metric: 'cups',    goal: 56,  cash: 18, unit: '杯', desc: '卖出 {g} 杯' },
  { id: 'st_rev2',   chapter: 4, order: 2, emoji: '💸', name: '营收关·贰', metric: 'revenue', goal: 1350, cash: 21, unit: '',  prefix: '¥', desc: '营收达到 ¥{g}' },
  { id: 'st_sat2',   chapter: 4, order: 3, emoji: '😊', name: '满意关·贰', metric: 'sat',    goal: 0.92, cash: 24, unit: '',  desc: '满意率 ≥ {g}%' },
  { id: 'st_orders2',chapter: 5, order: 1, emoji: '🧾', name: '翻台关·贰', metric: 'orders', goal: 56,  cash: 22, unit: '单', desc: '接待 {g} 单' },
  { id: 'st_click2', chapter: 5, order: 2, emoji: '👆', name: '手速关·贰', metric: 'clicks', goal: 44,  cash: 25, unit: '次', desc: '连点出杯位 {g} 次' },
  { id: 'st_net2',   chapter: 5, order: 3, emoji: '📈', name: '利润关·贰', metric: 'net',    goal: 1050, cash: 30, unit: '', prefix: '¥', desc: '净利达到 ¥{g}' },
  { id: 'st_cups3',  chapter: 6, order: 1, emoji: '🥤', name: '出杯关·叁', metric: 'cups',   goal: 92,  cash: 28, unit: '杯', desc: '卖出 {g} 杯' },
  { id: 'st_rev3',   chapter: 6, order: 2, emoji: '💸', name: '营收关·叁', metric: 'revenue', goal: 2700, cash: 31, unit: '', prefix: '¥', desc: '营收达到 ¥{g}' },
  { id: 'st_trend2', chapter: 6, order: 3, emoji: '🌟', name: '潮流关·贰', metric: 'trend',  goal: 12,  cash: 36, unit: '杯', desc: '命中今日流行 {g} 杯' },

  /* ---- V13.5 地域挑战 ----
     ★ 为什么加这一类：
       原来的 18 关全是**通用经营指标**（出杯/营收/满意/翻台/手速/潮流/利润…），
       玩到第 5、6 章时玩家已经把它们摸透了 —— 关卡不再带来新信息，
       只是把门槛调高。而本项目明明有**地域**这个最有辨识度的维度
       （34 省 / 272 市 / 19 菜系 / 城市特色配方）却完全没进关卡。
       借鉴《房产大亨》「每张地图有专属地标开发任务」的做法 ——
       让关卡考「你在某个地方做成了什么」，而不只是「你总量做够没」。

     ★ 新增 4 个 metric：
       cityCups    在**当前经营城市**卖出 N 杯     （换个地方经营才能刷）
       cuisineCups 卖出某个**菜系** N 杯           （要研发出对应配方）
       branches    拥有 N 家分店                   （开分店）
       visits      到访过 N 个城市                （跨城游商）
     */
  { id: 'st_city',    chapter: 3, order: 4, emoji: '🏙️', name: '本地关',   metric: 'cityCups',    goal: 18,  cash: 20, unit: '杯', desc: '在本地卖出 {g} 杯' },
  { id: 'st_cuisine', chapter: 4, order: 4, emoji: '🍜', name: '风味关',   metric: 'cuisineCups', goal: 9,   cash: 26, unit: '杯', desc: '卖出特色菜系 {g} 杯', cuisine: 'matcha' },
  { id: 'st_branch',  chapter: 5, order: 4, emoji: '🏪', name: '扩张关',   metric: 'branches',    goal: 3,   cash: 30, unit: '家', desc: '开够 {g} 家店' },
  { id: 'st_visit',   chapter: 6, order: 4, emoji: '🧭', name: '游商关',   metric: 'visits',      goal: 4,   cash: 40, unit: '城', desc: '到访过 {g} 个城市' },
];
/* 章节关卡的难度档：goal / cash 都是相对 STAGES 里基准值的乘子。
   cashMul 递增（1.0 / 1.8 / 3.0）而 goalMul 递增得更快（1.0 / 1.35 / 1.8），
   所以高难度的**风险收益比**明显更好 —— 玩家越强越该挑战高难度，
   这就是「难度梯度」本身提供的驱动力。 */
const STAGE_DIFFS = [
  { id: 'std',  name: '普通', emoji: '⚪', goalMul: 1.0,  cashMul: 1.0, star: 1 },
  { id: 'elite',name: '精英', emoji: '🔵', goalMul: 1.35, cashMul: 1.8, star: 2 },
  { id: 'legend',name:'传奇', emoji: '🟣', goalMul: 1.8,  cashMul: 3.0, star: 3 },
];
/* 每章的天数：第 1 章 Day1-5，第 2 章 Day6-10 …… 共 6 章 30 天 */
const STAGE_CHAPTERS = 6;
const STAGE_DAYS = 5;

/* ---------- V6 招牌配方 ----------
 * 某款配方的**累计**卖出杯数跨局继承，逐级解锁永久加成。
 * 这是第二批里唯一的「跨局追求」：这一局卖得多，下一局该款更值钱。
 *
 * 为什么用**累计销量**而不是「本局卖了多少」：本局数据一局结束就清零，
 * 玩家没有「攒」的动机；跨局累计才让「我要专门练芋泥波波」成为一个策略。
 *
 * 加成刻意做成**乘性/小额**的（销量权重 +6% / 售价 +¥1 / 每杯省 ¥0.3），
 * 而不是每天白发一笔钱 —— 后者就是第一批踩过的「第二收入来源」坑。
 *
 * ★ 门槛标定（sim 连玩曲线实测）：初版用 60 / 150 / 300 杯，
 *   结果**第 1 局就满级**（脚本 AI 一局卖 1500~2500 杯，摊到 6~8 款上
 *   也有一款能过 300）—— "跨局长期追求"就名存实亡了。
 *   提到 250 / 700 / 1500 之后，等级需要**专精一款、连打好几局**才拿得到，
 *   "这一局我要把芋泥练成招牌"才真正成为一个跨局策略。
 *   顺带的好处：加成对总经济的影响也更小（很少有人满级）。
 */
const SIGNATURE_TIERS = [
  { lv: 1, cups: 250,  name: '小有名气', emoji: '🥉', saleMul: 0.06, priceAdd: 0,  costCut: 0,    desc: '该款销量权重 +6%' },
  { lv: 2, cups: 700,  name: '街坊认可', emoji: '🥈', saleMul: 0.12, priceAdd: 1,  costCut: 0.15, desc: '销量权重 +12% · 售价 +¥1 · 每杯省 ¥0.15' },
  { lv: 3, cups: 1500, name: '城市名店', emoji: '🥇', saleMul: 0.20, priceAdd: 2,  costCut: 0.30, desc: '销量权重 +20% · 售价 +¥2 · 每杯省 ¥0.30' },
];

/* ---------- V7 事件型顾客 ----------
 * 现有 5 种顾客只是**权重**（决定来多少人），玩家视角里"都是排队的小人"。
 * 这里加 3 种**可识别**的特殊顾客：营业中随机出现，脸上一眼能认出来，
 * 服务他们有明确回报或代价 —— 26 秒里多出一点「要不要优先伺候他」的判断。
 *
 * weight 极低（相对 5 种常规客群的 30/27/10/15/18），保证是"稀客"而不是常客。
 * rare 标记的只会在当天第 1 位顾客时判定（不然后面的人太多，失去惊喜感）。
 * effect 在**服务完成时**结算（completeOrder 里按 type 判定），
 * 流失时（lost）走 repBad —— 「没接住评论家的单」也是真实的损失。
 *
 * ★ 平衡上的关键教训（第一批 sim 跑出来的，配对差值 −11pp）：
 *   初版给三种特殊顾客都设了 repBad（-5/-3/0），并且特殊顾客**顶替**一位常规顾客。
 *   结果 **easy 难度达标率掉了 11pp**（配对逐局相减），而 hard 反而 +2pp
 *   —— 难度之间表现相反。
 *   原因不是 repBad 本身，而是**顶替机制**：被挤掉的是本来能服务好的客人，
 *   而特殊客人自己又因为耐心低而流失，等于白丢一单；
 *   玩家在 26 秒里也**无法**"优先伺候"谁（所有工位并行，流失不是选择问题）。
 *   修正三条：
 *     ① 特殊顾客改为「**额外到店**」，不再顶替常规顾客 —— 纯正收益
 *     ② 每天最多 **1 位**（原来 2 位）
 *     ③ 耐心/口碑系数调到**不低于**常规顾客；repBad 只留给"评论家"
 *   修正后 easy 的配对差值回到 0 附近，normal/hard 保持小幅正向。
 */
const SPECIAL_CUSTOMERS = [
  {
    id: 'critic', name: '美食评论家', emoji: '🧑‍🍳', weight: 3, rare: true,
    color: '#FFB26B', prefer: [], avoid: [], priceTol: 1.0, patienceMul: 0.9, cups: [1, 1],
    tipMul: 1.0, repMul: 1.0,
    repGood: 4, repBad: -2,
    desc: '给他做一杯，口碑 +4；让他走了，口碑 -2。',
  },
  {
    id: 'bulk', name: '团购大单', emoji: '🛒', weight: 3, rare: false,
    color: '#6FE3D8', prefer: [], avoid: [], priceTol: 1.2, patienceMul: 0.7, cups: [4, 6],
    tipMul: 0.8, repMul: 1.0,
    repGood: 0, repBad: 0,
    desc: '一次要 4~6 杯 —— 接住就是一笔大单，漏了也不额外扣口碑。',
  },
  {
    id: 'regular', name: '熟客回购', emoji: '💝', weight: 6, rare: false,
    color: '#FF8FB1', prefer: [], avoid: [], priceTol: 1.15, patienceMul: 1.3, cups: [1, 2],
    tipMul: 1.6, repMul: 1.2,
    repGood: 1, repBad: 0,
    desc: '老主顾：价格能多接受 15%，给的小费也多 60%。',
  },
];

/* ---------- V8 结局四维评级 ----------
 * 现有结局只看「净资产 / 目标」一个维度，S 级只有一种拿法。
 * 这里在收官时按四个维度各评一个称号（利润 / 口碑 / 服务 / 经营），
 * 让「同一个 S 级有多种拿法」—— 走口碑流和走利润流是两种不同的经营叙事。
 *
 * 每个维度两档称号。
 * 阈值依据（tools/sim.js 逐日中位数累加，40 局）：
 *   累计总杯数 easy ~2700 / normal ~2644 / hard ~3020
 *   → 1500 杯（约 55% 玩家可达）= 街角名店，3000 杯（约 20~30%）= 连锁巨头
 * 难度的差异体现在**单杯利润**（目标金额不同）而不是杯数，
 * 所以经营维度用**固定**杯数阈值，不按难度归一化
 * （早期版本按 goal/300 归一化，算出 normal 要 76000 杯 —— 永远达不到）。
 * tier: 0 = 无称号，1 = 合格，2 = 精通
 */
const ENDING_AXES = [
  {
    key: 'profit', name: '利润', emoji: '💰',
    tiers: [
      { need: 0.30, title: '铁公鸡', desc: '净利占营收 30% 以上' },
      { need: 0.45, title: '印钞机', desc: '净利占营收 45% 以上' },
    ],
  },
  {
    key: 'rep', name: '口碑', emoji: '⭐',
    tiers: [
      { need: 55, title: '街坊熟人', desc: '最终口碑 55 以上' },
      { need: 80, title: '全城名店', desc: '最终口碑 80 以上' },
    ],
  },
  {
    key: 'service', name: '服务', emoji: '🎯',
    tiers: [
      { need: 0.88, title: '宾至如归', desc: '满意率 88% 以上' },
      { need: 0.96, title: '五星好评', desc: '满意率 96% 以上' },
    ],
  },
  {
    key: 'scale', name: '经营', emoji: '🏬',
    tiers: [
      { need: 1500, title: '街角名店', desc: '累计卖出 1500 杯' },
      { need: 3000, title: '连锁巨头', desc: '累计卖出 3000 杯' },
    ],
  },
];

/* ---------- 每日任务池 ----------
 * 每天开局刷 3 条，达成即即时到账现金 —— 给玩家一个「再开一天」的具体理由，
 * 也是同赛道产品里最常见的日活钩子。
 *
 * metric : engine 里 bumpQuest() 的计数键，跨天清零
 * dir    : 'up' 越多越好（达到目标即达成）/ 'down' 越少越好（打烊时结算，破功才拿不到）
 * min/mul/max : 目标值 = clamp(min + mul * (day - 1), min, max)，随天数平滑上抬
 * reward : 基准奖金，实际发放按天数再放大（见 engine 的 questRewardOf）。
 *          刻意压得比同额经营收益低一档 —— 任务是「再开一天的理由」，不是第二收入来源。
 *          实测（tools/sim.js 30 天脚本 AI）把奖励定在翻倍水平会让净资产虚高 27%，
 *          直接把标准难度的达标率从 81% 抬到 103%，等于悄悄改了关卡难度。
 * when   : 可选抽取条件，不满足的当天不进池（例如配方已全解锁就不再出「新品研发」）
 */
const QUESTS = [
  { id: 'q_cups',     emoji: '🥤', name: '出杯达标',   metric: 'cups',     dir: 'up',   min: 12,  mul: 3.2,  max: 120,  reward: 32,  unit: '杯' },
  { id: 'q_revenue',  emoji: '💸', name: '营业额冲高', metric: 'revenue',  dir: 'up',   min: 220, mul: 62,   max: 6000, reward: 38,  unit: '',   prefix: '¥' },
  { id: 'q_profit',   emoji: '📈', name: '净利达标',   metric: 'profit',   dir: 'up',   min: 90,  mul: 30,   max: 2600, reward: 52,  unit: '',   prefix: '¥' },
  { id: 'q_clicks',   emoji: '👆', name: '手速营业',   metric: 'clicks',   dir: 'up',   min: 24,  mul: 6,    max: 200,  reward: 28,  unit: '次' },
  { id: 'q_trend',    emoji: '🌟', name: '踩中潮流',   metric: 'trend',    dir: 'up',   min: 6,   mul: 1.6,  max: 60,   reward: 42,  unit: '杯' },
  { id: 'q_restock',  emoji: '📦', name: '备货充足',   metric: 'restock',  dir: 'up',   min: 3,   mul: 0.1,  max: 6,    reward: 24,  unit: '次' },
  { id: 'q_upgrade',  emoji: '🔧', name: '设备升级',   metric: 'upgrade',  dir: 'up',   min: 1,   mul: 0.1,  max: 3,    reward: 49,  unit: '次' },
  { id: 'q_research', emoji: '🧪', name: '新品研发',   metric: 'research', dir: 'up',   min: 1,   mul: 0,    max: 1,    reward: 66,  unit: '款',
    when: s => s.recipes.length < RECIPES.length },
  { id: 'q_hire',     emoji: '🤝', name: '招兵买马',   metric: 'hire',     dir: 'up',   min: 1,   mul: 0,    max: 1,    reward: 46,  unit: '人',
    when: s => s.staff.length < 4 && s.candidates.length > 0 },
  { id: 'q_nolost',   emoji: '🎯', name: '一个都不跑', metric: 'lost',     dir: 'down', min: 4,   mul: 0.15, max: 10,   reward: 60,  unit: '人' },
];
const QUEST_COUNT = 3;

/* ---------- 难度 ---------- */
/* contractGoal / contractPenalty：每日合同（V1）的难度缩放。
   合同的门槛是按 normal 校准的，但难度之间客流差 1.15 / 1.0 / 0.90 ——
   硬套同一套门槛会让 hard 的玩家反复违约，而违约扣口碑会**复利**：
   口碑跌 → 客流跌 → 更完不成 → 口碑更跌（实测 hard 达标率被拖到 60%、
   连玩曲线出现衰减死循环）。所以门槛随难度放宽、惩罚随难度减轻，
 * stageGoal：章节关卡（V5）的门槛缩放。方向与 contractGoal **相反** ——
 *   hard 的客流本来就少（×0.90），关卡目标若不放宽，hard 玩家几乎打不通；
 *   而关卡奖励是「额外收入」，门槛越难拿越少，难度曲线才不会被偷改。
 *   实测：stageGoal=1.18 时 hard 的达标率漂移 +6pp（74%→80%），
 *   放宽到 1.30 后收敛到 +1~2pp。
 *
 *   简单难度上失败干脆不扣（那里本来就该躺赢）。
 */
const DIFFICULTY = {
  /* ★★ V21：goal 与 STAGE_GOALS 的最后一项必须一致（有回归锁守着）。
     ★ 标定口径（这一条比数值本身重要）：
       基线 = **不抽策略卡**（`--cards=none`）。因为本轮实测确认策略卡为负期望
       （不拿卡一律更好，normal 档差 10pp），理性玩家的最优解就是「都不要」——
       所以"玩家实际会打出来的成绩"必须以 none 为基线，不是 random。
       用 random 当基线会把目标定得偏低（同一份代码，normal 过关率 33% vs 73%）。
     ★ 验收看**过关率**（过线局数/总局数），不看"平均净资产/目标"——
       后者是完成度，两者会给出相反的结论（旧 easy 完成度 81%、过关率却 0%）。
     ★★ 定稿：三档**同一个目标 50000**。这不是偷懒，是数据逼出来的：
       三档在「autoFill 采购」口径下的产出中位是 65k / 60k / 58k，极差只有 **5.6%** ——
       比 20 局的抽样噪声（±10pp）还小。任何"递增的目标"都无法让过关率递减，
       只会制造一条假的难度阶梯。
       统一目标之后，难度只由经济参数决定，语义也干净：「同样 ¥50,000，三种经营环境」。
       ⚠️ 想让三档真正拉开差距，必须换杠杆（更小的库容 / 更高的经常性成本 / 抗封顶），
          不是继续调目标 —— 详见 docs/reports/内容优化-第四轮-专家协作.md。
     ★ 双口径（这两组数必须一起看，缺一个都会被误导）：
         autoFill（= 产品里的「🛒 一键补货」，教程教玩家用）：过关率 100% / 95% / 85%
         manual  （手搓配额，比真人笨）：                          53% / 21% / 25%
       只要 autoFill 落在 85~95%、manual 不低于 20%，就认为目标可用。
       —— 上一版只按 manual 标定，等于拿一个偏弱的 bot 当基准，目标被系统性低估。 */
  easy:   { key: 'easy',   name: '佛系躺赢', emoji: '🌱', cash: 1100, goal: 55000, traffic: 1.15, costMult: 0.88, rentMult: 0.8,
            contractGoal: 0.80, contractPenalty: 0, stageGoal: 0.85,
            desc: '现金流宽松，适合先熟悉玩法' },
  normal: { key: 'normal', name: '标准创业', emoji: '🔥', cash: 700, goal: 55000, traffic: 1.0, costMult: 1.0, rentMult: 1.0,
            contractGoal: 1.0, contractPenalty: 0.6, stageGoal: 1.0,
            desc: '推荐首次挑战，需要认真经营' },
  /* ⚠️ hard 的过关率停在 ~20%，低于理想区间（30~40%）。
     原因不是目标定高了，而是**这一档的产出中位只有 ¥42,126**（easy 49,595 / normal 47,852）——
     要让 hard 过关率达到 35%，目标得压到 ¥43,500，那就会低于 easy 的目标，
     玩家会看到「地狱模式目标比简单模式还低」。
     ⇒ 想让 hard 达到 30~40%，应当**提高 hard 的产出**（起始资金 / 成本乘数 / 客流），
       而不是继续下调目标。这是下一轮的设计选择，已记入报告。 */
  hard:   { key: 'hard',   name: '地狱卷王', emoji: '💀', cash: 520, goal: 55000, traffic: 0.90, costMult: 1.15, rentMult: 1.22,
            contractGoal: 1.22, contractPenalty: 0.35, stageGoal: 1.30,
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

/* ---------- 中期目标 ----------
   30 天只有一个终点太远：中间三周玩家根本不知道自己是领先还是落后，
   于是既不焦虑也不上心。每 5 天给一个锚点，达成即发一点声望。 */
const MILESTONE_EVERY = 5;

/* ★★ V20：阶段目标改为**按档位配置**。
 *
 * 原来只有一个 MILESTONE_RATIO，且所有档位共用，
 * 而每档的 goal 差异极大（早期版本是 22000/38000/48000 这一档次的数）——
 * 同一个比例套在三档上，实际难度完全对不上：
 *   easy   第 14 天就超过目标 → 剩 16 天没有目标
 *   normal 第 30 天勉强够 → 但锚点最高只到 58%，第 20 天后就无张力
 *   hard   30 天都到不了 → 但当年**比 normal 更容易**
 *          （hard 实测曾高于 normal：traffic 0.90 让"少备货少浪费"反而更赚）
 * ★ 具体金额不再抄在注释里（会漂）；要看当前值直接读下面的 STAGE_GOALS / DIFFICULTY。
 *
 * ★ 所以改成每档一组锚点，且是**绝对值**而非比例：
 *   比例的隐含前提是「所有档位的增长曲线形状相同」，
 *   实测证明不是 —— easy 是爆发型、hard 是平缓型，比例必然错配。
 *
 * ★ 数值来源：tools/probe-curve.js 实测逐日净资产后，
 *   按锚点日的 1.20 倍反推（够得着但要努力）。
 *   真实玩家会用策略卡与菜系加成（模拟器不用），所以再上浮 10~15%。
 *
 * ★★ V21 重标定（2026-10-28）：上面这套「1.20 倍」只在 normal 档成立。
 *   实测 18 局 × 3 档（bp=0 / 随机策略卡）暴露了两个硬事实：
 *
 *   ① **三档的产出几乎没有差别**，难度参数只改了过程，没改终点：
 *        easy   平均 42699  中位 44725  p75 48820
 *        normal 平均 42034  中位 43662  p75 47596
 *        hard   平均 39445  中位 38451  p75 45886
 *      既然终点差不多，「用 goal 拉开难度」就只剩「把某一档设成不可能」。
 *
 *   ② **旧值把 easy 和 hard 都设成了不可能**：
 *        easy   目标 58000 → 实测 0/18 达标（中位只有 44725，锚点要 1.28 倍）
 *        normal 目标 47000 → 5/18 达标
 *        hard   目标 54000 → 实测 0/18 达标（锚点要 1.38 倍）
 *      也就是三档里**只有 normal 是认真标定过的**，另两档是旧的、
 *      且 easy 的锚点比 hard 还高 —— 「简单模式比地狱模式更难通」。
 *
 *   ★ 新口径（三档同一套「拉伸系数」，各自贴自己的曲线）：
 *      goal 按「实测分位数」定，使**过关率随难度单调下降**。
 *      ★★ 具体数值**不写在这里** —— 它们会随每次标定变，
 *         而注释不会跟着变，最后就是"注释说 40000、代码是 42000"，
 *         看注释的人（包括我自己）会拿一个不存在的数字去推理。
 *         要查当前值：读下面的 DIFFICULTY.goal；
 *         要查当前过关率：跑 `node tools/sim.js 20`（它按 cards=none 基线报过关率）。
 *      ⚠️ 不能反过来给 hard 设更低的目标来「保证能通」——
 *         那会让玩家看到「地狱模式目标比简单模式还低」，比现在更荒谬。
 *
 *   ★ 锚点 = 该档**自己**的实测逐日曲线 × (新 goal / 实测终值)。
 *     不共用同一套比例：三档增长形状不同（easy 前快后慢、hard 全程平缓），
 *     共用比例必然在某档上过松或过紧 —— 这正是旧值出错的方式。
 *     ⚠️ 因此跨难度的同一天锚点**不保证递增**（如 Day 5：easy 5300 > hard 4700）。
 *        这是刻意的取舍：玩家一局只看得见自己那档的锚点，
 *        而「本档内锚点够得着」比「跨难度数字好看」重要得多。
 */
const STAGE_GOALS = {
  easy:   [4400, 8700, 16400, 26000, 42200, 55000],
  normal: [4400, 8700, 16400, 26000, 42200, 55000],
  hard:   [4400, 8700, 16400, 26000, 42200, 55000],
};

/* 兼容旧引用（UI 层用 MILESTONE_RATIO 画刻度）——
   ★ 保留是为了让刻度条仍能显示；实际判定已改走 STAGE_GOALS。
   ★ 注意刻度用的是**比例**，而判定用绝对值 —— 两者不再等价，
     UI 显示的是「相对位置」，判定用的是「真金额」。
   ★★ V21：这组比例**必须从 STAGE_GOALS.normal 派生，不能手抄**。
     第一次修这个问题时我把算好的 [0.105,0.202,0.334,0.539,0.80,1.0] 直接写成常量，
     那只是把"错位 22pp"换成了"此刻恰好对齐"——
     下一次谁调 normal 的 goal，刻度会立刻再次和真实门槛脱节，
     而且同样没有任何测试会红（长度没变、数值也"看着合理"）。
     ★ 派生之后，调 goal 不需要重算刻度，两端 UI 一行都不用改。
     ★ 用 normal 而不是三档各一套：刻度条是**相对位置示意**，
       normal 是标准难度、也是唯一被认真标定过的一档。 */
const MILESTONE_RATIO = STAGE_GOALS.normal.map(v => v / DIFFICULTY.normal.goal);

/* 锚点个数（= MILESTONE_EVERY 窗口数）。
   ★ 单独导出而不是到处写 MILESTONE_RATIO.length ——
     两边表示同一件事，但一个是「比例表长度」，一个是「阶段数」，
     混用会出现「UI 有 6 个刻度但判定只有 5 段」这类错位。 */
const MILESTONE_EVERY_COUNT = Math.ceil(CFG.DAYS / MILESTONE_EVERY);

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
    text: '原料价格<b>每天波动</b>。价格旁边的 <b style="color:var(--green)">📉 抄底</b> 标记说明它比基准价便宜很多，<b>这时囤货最划算</b>；<br>缺什么用「🛒 一键补货」一次配齐。仓库有上限，堆太多可以「清仓」按半价回收。',
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
    hint: '👉 有订单时疯狂点击！连点 3 次试试',
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
/* ★ V10：ALL_RECIPES = 研发树配方 + 成就专属奖励食谱。
   两张表刻意不合并成一张 —— 它们的**获取路径完全不同**：
     RECIPES    能研发（有 research 字段、要钱要料、挂在研发树节点上）
     ACH_RECIPES 只能靠成就（无 research 字段、不在研发树上）
   但下游逻辑（菜单展示、扣料、定价、存档清洗）必须**一视同仁**，
   所以建一张合并索引给 recipeById 用。
   ★ 不合并的风险：如果 recipeById 只查 RECIPES，
     成就奖励进 s.recipes 之后 `recipeById` 返回 undefined ——
     表现为"菜上不了架 / 成本算不出 / 菜单卡显示空白"，
     而且是**静默**的（不是报错，是数据缺失）。
   所以合并索引这一步是必需的，不是可选的优化。 */
const ALL_RECIPES = RECIPES.concat(ACH_RECIPES);
const ALL_RECIPE_INDEX = buildIndex(ALL_RECIPES, 'id');
const UPGRADES_INDEX = buildIndex(UPGRADES, 'id');
const TRAITS_INDEX = buildIndex(TRAITS, 'id');
const WEATHER_INDEX = buildIndex(WEATHERS, 'id');
const EVENT_INDEX = buildIndex(EVENTS, 'id');
const CUSTOMER_TYPE_INDEX = buildIndex(CUSTOMER_TYPES, 'id');

/* ============================================================
 *  常客系统（V13.6）—— 借鉴开罗《创意咖啡厅物语》的「常客度」
 *
 * ★ 调研结论（开罗攻略反复强调）：
 *   「顾客在用餐后满意度槽升高，升至最高后**提升常客度**，
 *     每种顾客的常客度上限都是 100，并且每次满意度升至最高后
 *     **还会提高顾客的预算**，这样子顾客在店内消费时也会花更多的钱。
 *     顾客常客度越高，咖啡厅的人气也就越高，
 *     而人气越高，到店顾客也就越多 —— 相互影响，相辅相成。」
 *
 * ★ 原作的核心是「常客度 ↑ → 预算 ↑ → 人气 ↑ → 客流 ↑」的复利。
 *   本作已有「口碑 → 客流」这一环，但**口碑是全局的**，
 *   玩家无法把「我的服务好」落到具体的人身上。
 *   常客系统补上「个体」这一层：伺候好某一类客人，他们的钱包会变大。
 *
 * ★ 实现取舍（**刻意做成轻量**，不重构顾客生成）：
 *   顾客本来是匿名的（每次生成随机 id），要做「个体」就得给每人一个
 *   持久身份 —— 但那要改订单结构、队列逻辑、存档清洗，动辄上百行。
 *   所以采用**「类型 + 外观」作为身份**：
 *     5 种类型 × 20 个外观 = 最多 100 位「熟客」，
 *     身份跨天稳定、可在 UI 上用表情辨识、存档里只是一张 id→好感度的表。
 *   ★ 玩家感知上仍然是「那个戴眼镜的老顾客越来越爱来了」。
 *
 * ★ 数值设计：
 *   · 每次满意服务 +2 好感（上限 100）
 *   · 好感 100 = 常客：消费预算 +15%，且**必然回头**
 *   · 好感衰减：每天 -1（不常来的会淡忘，逼迫持续做好服务）
 *   · 常客还会给**小费加成** —— 让"留住人"有即时的现金回报
 * ============================================================ */
const REGULAR_CFG = {
  /** 每次满意服务累积的好感 */
  gain: 5,
  /** 好感上限（开罗的常客度上限 100） */
  max: 100,
  /** 成为常客（好感满）时的消费预算加成 */
  budgetBonus: 0.15,
  /** 成为常客时的小费加成 */
  tipBonus: 0.25,
  /** 成为常客后，多大概率被"想到就来"（其余概率按普通顾客权重进店） */
  pullWeight: 0.45,
};

/** 常客加成对各字段的影响说明（UI 用） */
const REGULAR_TRAITS = [
  { id: 'budget', name: '钱包更鼓', emoji: '💰', desc: '常客消费预算 +15%' },
  { id: 'tip', name: '出手更大方', emoji: '🪙', desc: '常客小费 +25%' },
  { id: 'pull', name: '总会想起你', emoji: '🔔', desc: '常客更常光顾' },
];
/* V7 事件型顾客单独建索引。它们不在 CUSTOMER_TYPES 里 ——
   那张表参与客流权重、均杯数、客群覆盖等计算，混进去会改变基础客群分布。
   只在 customerTypeById 里作为兜底查找：completeOrder 拿 type.repMul 时
   必须能查到特殊顾客，否则特殊顾客的口碑奖惩会静默失效。 */
const SPECIAL_CUSTOMER_INDEX = buildIndex(SPECIAL_CUSTOMERS, 'id');
const RIVAL_ACTION_INDEX = buildIndex(RIVAL_ACTIONS, 'id');
const QUEST_INDEX = buildIndex(QUESTS, 'id');
const STRATEGY_CARD_INDEX = buildIndex(STRATEGY_CARDS, 'id');
/* 经营维度索引：场地类型 / 省份 / 城市 */
const VENUE_TYPE_INDEX = buildIndex(VENUE_TYPES, 'id');
const PROVINCE_INDEX = buildIndex(PROVINCES, 'id');
const CITY_INDEX = buildIndex(CITIES, 'id');
/* V9 菜系与工坊索引 */
const CUISINE_INDEX = buildIndex(CUISINES, 'id');
const WORKSHOP_INDEX = buildIndex(CRAFT_WORKSHOPS, 'id');
/* V10 研发树与城市索引 */
const TREE_INDEX = buildIndex(RESEARCH_TREE, 'id');
const ACH_RECIPE_INDEX = buildIndex(ACH_RECIPES, 'id');
/* 配方 id → 研发树节点（用于查前置与阶段）。成就食谱不在树里，返回 undefined。 */
const NODE_BY_RECIPE = new Map();
for (const n of RESEARCH_TREE) NODE_BY_RECIPE.set(n.recipe, n);

/** 取值一律返回 undefined（而不是抛错），调用方按需兜底 —— 与原来的 Array#find 行为一致 */
function ingById(id) { return ING_INDEX.get(id); }
/* ★ recipeById 现在查**合并索引**（研发 + 成就奖励）。
     改动影响面：菜单渲染、定价、扣料、备货、清洗、成就判定 —— 全都靠它，
     所以必须覆盖两类来源，否则成就奖励会静默失效。 */
function recipeById(id) { return ALL_RECIPE_INDEX.get(id); }
function treeNodeById(id) { return TREE_INDEX.get(id); }
function nodeByRecipe(rid) { return NODE_BY_RECIPE.get(rid); }
function achRecipeById(id) { return ACH_RECIPE_INDEX.get(id); }
function upgradeById(id) { return UPGRADES_INDEX.get(id); }
function traitById(id) { return TRAITS_INDEX.get(id); }
function weatherById(id) { return WEATHER_INDEX.get(id); }
function eventById(id) { return EVENT_INDEX.get(id); }
function customerTypeById(id) { return CUSTOMER_TYPE_INDEX.get(id) || SPECIAL_CUSTOMER_INDEX.get(id); }
function rivalActionById(id) { return RIVAL_ACTION_INDEX.get(id); }
function questById(id) { return QUEST_INDEX.get(id); }

/* ---------- 经营维度取值 ----------
 * 「省 → 市 → 区」三级联动是**有向查询**，所以除了按 id 取，
 * 还需要"某省有哪些市""某市有哪些区"这两个方向的查法。
 * 区级是可选粒度：没有收录的城市返回空数组（UI 降级为「仅到市级」），不抛错。 */
function venueTypeById(id) { return VENUE_TYPE_INDEX.get(id); }
function provinceById(id) { return PROVINCE_INDEX.get(id); }
function cityById(id) { return CITY_INDEX.get(id); }
function citiesOfProvince(provId) {
  const p = PROVINCE_INDEX.get(provId);
  return p ? (p.cities || []).map(id => CITY_INDEX.get(id)).filter(Boolean) : [];
}
function districtsOfCity(cityId) {
  const list = DISTRICTS[cityId];
  return Array.isArray(list) ? list : [];
}

/* ---------- V10 城市特色菜系取值 ---------- */
/** 某城市拥有的特色菜系（无特色菜系的城市返回空数组 = 只能用通用菜系） */
function cuisinesOfCity(cityId) {
  if (!cityId) return [];
  return CUISINES.filter(c => c.city === cityId);
}
/** 某城市是否有特色菜系（UI 用来决定要不要展示「本地风味」分组） */
function hasCityCuisine(cityId) { return !!cityId && cuisinesOfCity(cityId).length > 0; }
/** 某城市的专属原料清单（origin === cityId） */
function ingsOfCity(cityId) {
  if (!cityId) return [];
  return ING.filter(g => g.origin === cityId);
}
/** 该原料在指定城市是否有货。origin 为空 = 全国都有货。 */
function ingAvailableAt(ingId, cityId) {
  const g = ING_INDEX.get(ingId);
  if (!g) return false;
  if (!g.origin) return true;
  return g.origin === cityId;
}

/* ---------- V9 菜系与工坊取值 ---------- */
function cuisineById(id) { return CUISINE_INDEX.get(id); }
function workshopById(id) { return WORKSHOP_INDEX.get(id); }
/** 某菜系下的全部配方（按解锁层级排） */
function recipesOfCuisine(cuisineId) {
  return RECIPES.filter(r => r.cuisine === cuisineId);
}

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
