/* ============================================================
 *  奶茶星球 · Bubble Tycoon  —— 核心引擎（纯逻辑，无 DOM）
 * ============================================================ */
'use strict';

/* ---------------- 种子随机数（每日挑战需要可复现） ---------------- */
const RNG = {
  seeded: false, _s: 0,
  setSeed(seed) { this.seeded = true; this._s = (seed >>> 0) || 1; },
  clear() { this.seeded = false; },
  next() {
    if (!this.seeded) return Math.random();
    this._s = (this._s + 0x6D2B79F5) | 0;
    let t = Math.imul(this._s ^ (this._s >>> 15), 1 | this._s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  },
};
function seedFromText(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* 每日任务专用的第二条随机流（算法与 RNG 完全一致，独立播种）。
 * 为什么不直接用主 RNG：抽任务发生在 newGame / nextDay，多吃几个 next()
 * 会把整局经济（客流、天气、事件、价格）的随机序列整体挤位 —— 结果就是
 * 「加个留存钩子」顺手改掉了关卡难度，而且平衡脚本的 A/B 对照也跟着失效。
 * 独立流只在「每日挑战」时跟主 RNG 一起播种，保证同一局依旧可复现。 */
const QUEST_RNG = {
  seeded: false, _s: 0,
  setSeed(seed) { this.seeded = true; this._s = (seed >>> 0) || 1; },
  clear() { this.seeded = false; },
  next() {
    if (!this.seeded) return Math.random();
    this._s = (this._s + 0x6D2B79F5) | 0;
    let t = Math.imul(this._s ^ (this._s >>> 15), 1 | this._s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  },
};
function keyOfDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayKey() { return keyOfDate(new Date()); }
/** 昨天：连续登录要判断「断没断签」。用 setDate 让 Date 自己处理跨月跨年 */
function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return keyOfDate(d);
}

/* ---------------- 基础工具 ---------------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + RNG.next() * (b - a);
const rndInt = (a, b) => Math.floor(rnd(a, b + 1));
const pick = arr => arr[Math.floor(RNG.next() * arr.length)];
/* + 0 是为了消掉 -0：Math.round(-0.4) 得到 -0，直接格式化会显示成刺眼的「-¥0」
   （IEEE-754 里 -0 + 0 === +0，对其它数值没有副作用）。 */
const money = n => '¥' + (Math.round(n) + 0).toLocaleString('en-US');

function weightedPick(items, weightFn) {
  if (!items || items.length === 0) return undefined;   /* 空列表不该返回 items[0] 这种假结果 */
  let total = 0;
  for (const it of items) total += Math.max(0, weightFn(it));
  if (total <= 0) return items[0];
  let r = RNG.next() * total;
  for (const it of items) {
    r -= Math.max(0, weightFn(it));
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

/* ---------------- 派生数值 ---------------- */
/* recipeById / ingById / upgradeById / traitById 等按 id 取值函数已统一挪到 data.js
   （那里才有原始数组，索引表也建在那）。这里不再重复定义，避免同名函数互相覆盖。 */

/** 难度取值：存档里的 diff 可能是脏数据（导入/手改），一律回落到 normal */
function diffOf(s) { return DIFFICULTY[s && s.diff] || DIFFICULTY.normal; }

/** 数值兜底：脏存档里的 null/undefined/NaN/字符串都收敛成有限数 */
function num(v, dflt) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : (dflt === undefined ? 0 : dflt);
}

/* ---------------- 日志 / 历史写入 ----------------
   原先各处直接 Array#push，裁剪规则只写在别处（history 在 endDay 里 shift，
   log 干脆只在读档净化时裁一次）。规则分散的结果是无尽模式玩久了容易漏：
   一局 Day 几百下来 s.log 会无限增长，拖慢每 5 秒一次的自动存档。
   统一到这两个入口写，顺便把「限长 + 去控制字符」一并做掉
   —— 日志会原样进 innerHTML，控制字符是最容易被忽略的注入面。 */
const MAX_LOG = 60;
const MAX_HISTORY = 400;

/** 写一条店长日志：统一裁剪条数、限长、去控制字符（它会原样进 innerHTML） */
function pushLog(s, text) {
  if (!s) return;
  if (!Array.isArray(s.log)) s.log = [];
  s.log.push(str(text, 120));
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

/** 追加一天经营历史（曲线图数据源），只保留最近 MAX_HISTORY 天 */
function pushHistory(s, row) {
  if (!s) return;
  if (!Array.isArray(s.history)) s.history = [];
  s.history.push(row);
  if (s.history.length > MAX_HISTORY) s.history.splice(0, s.history.length - MAX_HISTORY);
}

function storageCap(s) { return CFG.BASE_STORAGE + s.up.storage * 180; }
function menuSlots(s) { return 2 + s.up.menu; }
function stationCount(s) { return 1 + s.staff.length + (s.shops - 1); }
function queueCap(s) { return CFG.BASE_QUEUE + s.up.decor; }
function patienceOf(s) { return CFG.BASE_PATIENCE + s.up.decor * 0.7; }

/* ---------------- 策略卡效果 ----------------
 * 所有卡的效果都从这里读，结算只有乘法和加法两种：
 *   cardMul  —— 倍率类（客流 / 速度 / 成本），多张叠乘
 *   cardSum  —— 绝对值类（每杯扣多少钱），多张叠加
 * 这样加一张新卡只要写 fx，不用改任何调用点。 */
/* 走 data.js 的索引，不再线性扫卡表。cardMul / cardSum 是热路径：
   serviceTimeOf 每个工位每帧都要跑一次，卡表 12 张 × 在手 6 张 × 20 个工位，
   一帧就是上千次字符串比较。 */
function cardById(id) { return STRATEGY_CARD_INDEX.get(id); }
/** 策略卡主题共鸣（V4）：同主题 2 张 +10%，3 张 +25%。
 *  没有这一层时 12 张卡就是纯数值交换，玩家的选卡逻辑退化成
 *  "算净收益最大的那几张"——单局内唯一的 build 分歧点变成算术题。 */
function cardThemeBonus(s, key) {
  /* key 是 fx 键。先反查"这个增益属于哪个主题"，再数该主题凑了几张。
     增益/代价的归属写在每张卡的 boost 字段里，不靠数值大小猜 ——
     中央厨房的 cogs: 0.86（成本 −14%）是增益却小于 1，
     精品路线的 traffic: 0.92 是代价也小于 1。 */
  let themeKey = null;
  for (const id of (Array.isArray(s.cards) ? s.cards : [])) {
    const c = cardById(id);
    const th = CARD_THEMES[id];
    if (c && th && Array.isArray(c.boost) && c.boost.indexOf(key) >= 0) { themeKey = th.key; break; }
  }
  if (!themeKey) return 1;
  let n = 0;
  for (const id of s.cards) {
    const th = CARD_THEMES[id];
    if (th && th.key === themeKey) n++;
  }
  return n >= 3 ? 1.25 : (n === 2 ? 1.10 : 1);
}
function cardMul(s, key) {
  let m = 1;
  if (!Array.isArray(s.cards)) return m;
  const bonus = cardThemeBonus(s, key);
  for (const id of s.cards) {
    const c = cardById(id);
    if (c && c.fx && typeof c.fx[key] === 'number') {
      /* 只有 boost 声明过的增益键吃共鸣；代价（unitSub/wage/rent…）不跟着涨 */
      m *= (Array.isArray(c.boost) && c.boost.indexOf(key) >= 0) ? c.fx[key] * bonus : c.fx[key];
    }
  }
  return m;
}
function cardSum(s, key) {
  let n = 0;
  if (!Array.isArray(s.cards)) return n;
  for (const id of s.cards) {
    const c = cardById(id);
    if (c && c.fx && typeof c.fx[key] === 'number') n += c.fx[key];
  }
  return n;
}
/** 当前局面是否已经以及结束时该不该抽卡 */
function shouldOfferCard(s) {
  if (!STRATEGY_CARDS.length) return false;
  if ((Array.isArray(s.cards) ? s.cards.length : 0) >= CFG.CARD_MAX) return false;
  /* d 已经用 Math.max(1, …) 兜底了，d > 0 恒为真 —— 留着只会让人以为这里在防什么 */
  const d = Math.max(1, num(s.day, 1));
  return d % Math.max(1, CFG.CARD_EVERY) === 0;
}
/** 抽 CFG.CARD_OFFER_N 张没拿过的卡；池子不够就把剩下的全给 */
function drawCards(s) {
  if (!shouldOfferCard(s)) return null;
  const owned = Array.isArray(s.cards) ? s.cards : [];
  const pool = STRATEGY_CARDS.filter(c => owned.indexOf(c.id) < 0);
  if (!pool.length) return null;
  /* 用 QUEST_RNG 而不是主 RNG：主序列要保证「同种子同经济」，
     不能让抽卡这种新增调用把每日挑战的可复现性弄坏。 */
  const n = Math.min(CFG.CARD_OFFER_N, pool.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(pool.splice(Math.floor(QUEST_RNG.next() * pool.length), 1)[0]);
  }
  return out.length ? out : null;
}
/** 选中一张卡。返回该卡（失败返回 null —— id 不合法或已有这张卡） */
function applyCard(s, id) {
  const c = cardById(id);
  if (!c) return null;
  if (!Array.isArray(s.cards)) s.cards = [];
  if (s.cards.indexOf(id) >= 0) return null;
  if (s.cards.length >= CFG.CARD_MAX) return null;
  s.cards.push(id);
  s.cardOffer = null;
  pushLog(s, `🃏 采纳策略「${c.emoji} ${c.name}」：${c.gain} · 代价 ${c.cost}`);
  return c;
}

/** 某配方按当前库存均价计算的单杯成本 */
function costOf(s, rid) {
  const r = recipeById(rid);
  let c = CFG.PACK_COST;
  /* 用量走 reqOf：与 consumeStock / 备货完全同一口径。
     否则玩家看到的单杯毛利与结算时的 cogs 对不上（"毛利 14 实际只赚 6"）。 */
  const req = reqOf(s, rid);
  for (const k in req) c += req[k] * (s.avgCost[k] || ingById(k).base);
  /* 招牌配方（V6）：等级越高，每杯成本越省（熟练度/规模效应） */
  return Math.max(0.1, c - sigCostCut(s, rid));
}
function priceOf(s, rid) {
  return Math.max(1, Math.round(recipeById(rid).price * (s.ratios[rid] || 1)) + sigPriceAdd(s, rid));
}
function invUsed(s) {
  let n = 0;
  for (const g of ING) n += s.inv[g.id] || 0;
  return n;
}
function invValue(s) {
  let v = 0;
  for (const g of ING) v += (s.inv[g.id] || 0) * (s.avgCost[g.id] || g.base);
  return v;
}
function netWorth(s) {
  /* 投资回收率调高到 0.82/0.9：否则「少投资多囤现金」会成为最优解，
     导致高难度（成本更贵）反而更容易刷净资产。 */
  return s.cash + s.invested * 0.82 + s.shopSpend * 0.9 + invValue(s);
}
function offlinePerMin(s) { return offlineRate(s.up.auto); }

/** 今日预测客流（人） */
function trafficOf(s) {
  const d = diffOf(s);
  let t = 4 + s.rep * 0.36;
  t *= 1 + 0.15 * s.up.decor;
  t *= marketingMul(s.marketing);
  t *= s.weather.traffic;
  t *= 1 + 0.6 * (s.shops - 1);
  /* 这里曾经有一项 `1 + 0.02 * s.bpBonus`：声望点直接乘在客流上，线性且无上限。
     问题是产能（出杯位 / 服务速度）每局都从零起步，只有需求端在涨 ——
     多来的客人接不住 → 排队超时流失 → 扣口碑 → 口碑又反过来压客流，成负反馈。
     实测（tools/sim.js --bp=N，同一 AI、同一套种子）：
       bp 0 → 94% 达标 / 破产 0/8，bp 74（第 5 局）→ 74% 达标 / 破产 7/8。
     所以声望不再动客流，改为折算「开局创业基金」（见 prestigeStartCash）：
     钱怎么变成产能（雇人 / 提速 / 开店）由玩家自己决定，不会单向推高需求。 */
  t *= 1 + 0.01 * s.up.auto;
  t *= cardMul(s, 'traffic');     /* 🃏 策略卡：薄利多销 / 达人探店这类 */
  for (const st of s.staff) if (st.trait === 'star') t *= 1.07;
  t *= d.traffic;
  t *= (s.eventTrafficMul || 1);
  t *= 1 - rivalShare(s);
  return Math.max(3, Math.round(t));
}

/** 单一真相：某类顾客今天的出现权重（天气 / 周末 / 口碑 / 装修） */
function typeWeightOf(s, t) {
  const bias = TYPE_WEATHER_BIAS[s.weather.id] || TYPE_WEATHER_BIAS.cloud;
  let w = t.weight * (bias[t.id] || 1);
  if (isWeekend(s.day)) {
    if (t.id === 'family') w *= 1.9;
    if (t.id === 'worker') w *= 0.65;
  }
  if (t.id === 'influencer') {
    if (s.rep >= 60) w *= 1.8;
    if (s.rep <= 20) w *= 0.5;
    if (s.up.decor >= 4) w *= 1.3;
  }
  return w;
}

/** 按权重抽取顾客类型 */
function pickCustomerType(s) {
  return weightedPick(CUSTOMER_TYPES, t => typeWeightOf(s, t));
}

/** 当天客群的平均「每单杯数」——用于把杯数换算成人次 */
function avgCupsPerOrder(s) {
  let tot = 0, sum = 0;
  for (const t of CUSTOMER_TYPES) {
    const w = typeWeightOf(s, t);
    tot += w;
    sum += w * (t.cups[0] + t.cups[1]) / 2;
  }
  return tot > 0 ? sum / tot : 1;
}
function marketingMul(m) {
  if (m <= 0) return 1;
  return 1 + Math.log(1 + m / 300) * 0.85;
}

/** 员工效率系数 */
function staffMult(s, st) {
  if (!st) return 1;
  let m = st.skill;
  if (st.trait === 'fast') m *= 1.16;
  if (st.trait === 'green') m *= 0.9;
  if (st.stamina < 30) m *= 0.62;
  else if (st.stamina < 60) m *= 0.85;
  return m;
}
function serviceTimeOf(s, worker, sim) {
  let t = CFG.BASE_SERVICE / (1 + 0.20 * s.up.speed) / (1 + 0.12 * s.up.training);
  if (worker) t /= staffMult(s, worker);
  if (sim && sim.rushUntil > sim.t) t *= 0.55;
  t /= cardMul(s, 'speed');       /* 🃏 策略卡：极速出杯更快、自助点单机更慢 */
  return Math.max(CFG.MIN_SERVICE, t);
}

/* ---------------- 新游戏 ---------------- */
/** 品牌声望点 → 开局创业基金。√ 曲线：前 25 点换 ¥225，100 点换 ¥450，400 点触顶 ¥900 */
function prestigeStartCash(bp) {
  const n = Math.max(0, Math.floor(num(bp, 0)));
  if (n <= 0) return 0;
  return Math.min(CFG.BP_START_CAP, Math.floor(CFG.BP_START_RATE * Math.sqrt(n)));
}

/**
 * 开一局新游戏。
 * sigCarry：V6 招牌配方的**跨局基线**（{ 配方 id: 累计卖出杯数 }）。
 *   传 null/省略 = 从零开始（每日挑战就是这种情况：全网同种子必须一样，
 *   继承了招牌加成就没法比了）。传对象 = 把上一局累计的销量带进来。
 */
function newGame(diffKey, bpBonus, sigCarry) {
  const d = DIFFICULTY[diffKey] || DIFFICULTY.normal;
  const startBonus = prestigeStartCash(bpBonus);
  /* 招牌基线：只认真实存在的配方 id，脏数据（可编辑存档）一律归零 */
  const sig = {};
  if (sigCarry && typeof sigCarry === 'object' && !Array.isArray(sigCarry)) {
    for (const rid of Object.keys(sigCarry)) {
      if (recipeById(rid)) sig[rid] = posCap(sigCarry[rid], 0);
    }
  }
  const s = {
    v: 2, diff: d.key, day: 1, cash: d.cash + startBonus, rep: 26,
    inv: { tea: 34, milk: 30, sugar: 24, pearl: 22, fruit: 16 },
    avgCost: {}, prices: {}, prevPrices: {},
    recipes: ['boba'], menu: ['boba'], ratios: { boba: 1.0 },
    up: { speed: 0, decor: 0, menu: 0, storage: 0, training: 0, auto: 0 },
    shops: 1, shopSpend: 0, invested: 0,
    staff: [], candidates: [], nextStaffId: 1,
    weather: WEATHERS[1], trend: 'milky', nextTrend: 'fruity', trendKnown: false,
    news: null, newsFx: null, marketing: 0, dayMarketing: 0, eventTrafficMul: 1,
    doneEvents: [],
    phase: 'prep', sim: null, report: null, pendingEvent: null,
    debtDays: 0, lastReport: null, prevReport: null, lastMarketing: 0, msHit: [],
    bpBonus: bpBonus || 0,
    startBonus: startBonus,
    stats: { totalCups: 0, totalRevenue: 0, totalProfit: 0, bestDayProfit: 0, totalLost: 0, totalServed: 0, clicks: 0, days: 0 },
    flags: {}, ach: {}, log: [], cards: [], cardOffer: null,
    tut: { active: false, step: 0, done: false },
    history: [], endless: false, milestone: 0, daily: false,
    quests: [], questDay: 1, newQuests: [],
    contract: null,           /* 每日合同（V1）：{ id, done }，备货阶段可见 */
    /* V5 章节关卡：{ diff: 难度档 id, done: { 关卡 id: true } } */
    stage: { diff: 'std', done: {} },
    stageResult: null,
    /* V6 招牌配方：s.sig = 跨局继承的累计销量基线，s.sigRun = 本局新增 */
    sig: sig, sigRun: {},
    /* V9 制作工坊：{ 菜系 id: 等级 }。0 = 没建，该系配方不能上架。
       开局赠送 1 条产品线（经典奶茶系 Lv.1）—— 三个难度的开局现金都买不起
       最便宜的工坊，没有它玩家开局一架配方都上架不了（死锁）。
       存量存档（无此字段）读档时由 sanitizeState 补全 —— 见该函数的说明。 */
    workshops: Object.assign({}, WORKSHOP_START),
    /* 经营维度：场地类型 / 城市 / 地图位置。
       三个字段都是**可选**的，老存档读出来时由 sanitizeVenue 补默认值。
       坐标不预置 —— 默认给一个坐标等于替玩家编造经营地，应如实留空。 */
    venue: { type: VENUE_DEFAULT, provId: CITY_DEFAULT.slice(0, 2), cityId: CITY_DEFAULT },
  };
  for (const g of ING) { s.prices[g.id] = g.base; s.prevPrices[g.id] = g.base; s.avgCost[g.id] = g.base; }
  rollWeather(s); rollTrend(s); rollNews(s);
  refreshCandidates(s, true);
  initRival(s);
  rollContract(s);
  rollQuests(s);
  pushLog(s, '🎉 你的第一家奶茶店开张了！');
  pushLog(s, `🏙️ 隔壁开了家「${s.rival.name}」，生意还不错…`);
  if (startBonus > 0) {
    pushLog(s, `🌟 品牌声望 ${Math.floor(bpBonus)} ★ → 创业基金 +${money(startBonus)}`);
  }
  return s;
}

/* ---------------- 竞争对手 ---------------- */
function initRival(s) {
  s.rival = {
    name: pick(RIVAL_NAMES), emoji: pick(['🦑', '🐙', '🦊', '🐺', '🐉', '🦈']),
    rep: Math.round(rnd(22, 34)), aggro: 1, proof: 0, cd: {},
  };
}
function rivalLevel(r) { return 1 + Math.floor((r ? r.rep : 0) / 22); }

/** 被对手抢走的客流比例 */
function rivalShare(s) {
  if (!s.rival) return 0;
  const diff = (s.rival.rep - s.rep) / 100;
  /* 随天数逐步升温，避免开局就被抽血 */
  let share = clamp(0.04 + diff * 0.5 + Math.min(0.07, s.day * 0.004), 0.02, 0.34);
  share *= Math.max(0.4, 1 - 0.06 * (s.rival.proof || 0));
  share *= Math.max(0.5, 1 - 0.035 * s.recipes.length);
  /* 乘 aggro 之前那三项的含义：
     ① 基础份额 0.02~0.34（口碑差 + 天数升温，开局温和、后期升温）
     ② proof 护城河最多砍到 40%（玩家可主动投资对冲）
     ③ 配方数降温：只卖一款时最吃亏，最多砍到 50%
     三项叠完是 0.3281，这**不是**最终值 —— 后面还要乘 aggro。

     最后这个 0.5 只是**防脏数据的兜底**，不是设计上限：
     引擎里 aggro 涨到 1.5 就封顶（updateRival），实战最大 0.3281 × 1.5 ≈ 0.49，
     0.5 完整覆盖得到；而导入的存档允许到 3（清洗器 clamp 到 0.5~3），
     那会算出 0.98 —— 客流几乎清零。兜在 0.5 上，作弊存档最多让客流减半。
     别把它压到 0.34：那样 aggro > 1.04 之后乘了也白乘，"打压对手"整条
     策略线会变成死参数，而 ui 的红色警告（阈值 1.05）恰好在失效点亮起。 */
  return clamp(share * (s.rival.aggro || 1), 0, 0.5);
}
function updateRival(s) {
  const r = s.rival; if (!r) return;
  const gap = (s.rep - r.rep) / 100;
  r.rep = clamp(r.rep + rnd(0.1, 1.4) - gap * 0.85, 5, 100);
  if (r.rep > 82 && RNG.next() < 0.05) r.aggro = Math.min(1.5, (r.aggro || 1) + 0.08);
}
function rivalAction(s, id) {
  const a = rivalActionById(id);
  if (!a || !s.rival) return { ok: false, msg: '未知行动' };
  /* 挖角是**绕过 hireStaff 的第二条进人路径**，上限得在这里也挡一次，
     否则「挖到 21 人 → 存档 → 读档」又会凭空少人。放在扣费之前，不白扣钱。 */
  if (id === 'poach' && s.staff.length >= CFG.STAFF_MAX) {
    return { ok: false, msg: `员工已达上限 ${CFG.STAFF_MAX} 人` };
  }
  const cdKey = 'cd_' + id;
  if (a.cd && (s.rival.cd[cdKey] || 0) > s.day) return { ok: false, msg: `冷却中 · Day ${s.rival.cd[cdKey]} 后可再执行` };
  if (id === 'diff' && (s.rival.proof || 0) >= 5) return { ok: false, msg: '护城河已满级' };
  if (s.cash < a.cost) return { ok: false, msg: '现金不足' };

  s.cash -= a.cost; s.invested += a.cost;
  const msgs = [];
  if (id === 'poach') {
    const skill = Math.round(rnd(1.0, 1.35) * 100) / 100;
    const st = {
      id: s.nextStaffId++, name: pick(STAFF_NAMES), emoji: pick(CUSTOMER_FACES),
      skill, trait: pick(TRAITS).id, wage: Math.round(42 + skill * 32), stamina: 100, fromRival: true,
    };
    s.staff.push(st);
    s.rival.rep = clamp(s.rival.rep - 5, 5, 100);
    s.flags.poached = true;
    msgs.push(`${st.emoji} ${st.name} 跳槽加入！`);
  } else if (id === 'adwar') {
    s.rival.rep = clamp(s.rival.rep - 7, 5, 100);
    s.rep = clamp(s.rep + 1, 0, 100);
    msgs.push('对手口碑 -7，本店 +1');
  } else if (id === 'diff') {
    s.rival.proof = (s.rival.proof || 0) + 1;
    msgs.push(`护城河 Lv.${s.rival.proof}`);
  }
  if (a.cd) s.rival.cd[cdKey] = s.day + a.cd;
  pushLog(s, `🏙️ ${a.emoji} ${a.name}（-${money(a.cost)}）`);
  return { ok: true, msgs, cost: a.cost };
}

/* ---------------- 目标（支持无尽模式滚动里程碑） ---------------- */
function goalOf(s) {
  const d = diffOf(s);
  return s.endless ? endlessGoal(d.goal, s.milestone || 0) : d.goal;
}

/* ---------------- 每日刷新 ---------------- */
function rollWeather(s) {
  s.weather = weightedPick(WEATHERS, w => w.weight);
}
function rollTrend(s) {
  const keys = Object.keys(TAGS);
  s.trend = s.nextTrend || pick(keys);
  let n = pick(keys);
  while (n === s.trend) n = pick(keys);
  s.nextTrend = n;
  s.trendKnown = false;
}
function rollNews(s) {
  if (RNG.next() < 0.45) { s.news = pick(NEWS); s.newsFx = s.news.fx; }
  else { s.news = null; s.newsFx = null; }
}
function refreshMarket(s) {
  for (const g of ING) s.prevPrices[g.id] = s.prices[g.id];
  for (const g of ING) {
    let p = g.base * rnd(0.72, 1.36);
    if (s.newsFx && s.newsFx[g.id]) p *= s.newsFx[g.id];
    if (s.weather.priceShock && s.weather.priceShock[g.id]) p *= s.weather.priceShock[g.id];
    s.prices[g.id] = Math.round(clamp(p, g.base * 0.45, g.base * 2.3) * 100) / 100;
  }
}
function refreshCandidates(s, force) {
  if (!force && RNG.next() < 0.25) return;
  const n = rndInt(2, 3);
  s.candidates = [];
  for (let i = 0; i < n; i++) {
    const skill = Math.round(rnd(0.78, 1.35) * 100) / 100;
    const trait = RNG.next() < 0.72 ? pick(TRAITS).id : null;
    const base = 42 + skill * 32;
    s.candidates.push({
      name: pick(STAFF_NAMES), emoji: pick(CUSTOMER_FACES),
      skill, trait,
      wage: Math.round(base * (trait === 'green' ? 0.75 : 1)),
      fee: Math.round(260 * Math.pow(1.45, s.staff.length) * diffOf(s).costMult),
    });
  }
}

/* ---------------- 采购 / 库存 ---------------- */
function buyIng(s, id, qty, markup) {
  /* 校验必须走在算术前面：qty 为 NaN 时所有比较都是 false，
     会一路放行并把 NaN 写进 s.cash，整局存档就此废掉。 */
  qty = Math.round(num(qty, 0));
  if (!(qty > 0)) return { ok: false, msg: '数量无效' };
  if (!ingById(id)) return { ok: false, msg: '原料不存在' };
  const unit = num(s.prices[id], 0) * (markup || 1);
  const cost = unit * qty;
  if (cost > s.cash) return { ok: false, msg: '现金不足' };
  if (invUsed(s) + qty > storageCap(s)) return { ok: false, msg: '仓库装不下了' };
  const old = s.inv[id] || 0;
  s.avgCost[id] = (s.avgCost[id] * old + unit * qty) / (old + qty);
  s.inv[id] = old + qty;
  s.cash -= cost;
  if (!markup && unit <= ingById(id).base * 0.7) s.flags.bargain = true;
  bumpQuest(s, 'restock', 1);
  return { ok: true, cost, qty };
}
function autoFill(s) {
  let spent = 0, bought = 0;
  const target = Math.min(storageCap(s), 999);
  for (const g of ING) {
    const want = Math.max(0, Math.min(target - invUsed(s) - bought, Math.floor(s.cash * 0.35 / Math.max(0.1, s.prices[g.id]))));
    if (want > 0 && s.cash > 120) {
      const r = buyIng(s, g.id, Math.min(want, 40));
      if (r.ok) { spent += r.cost; bought += r.qty; }
    }
  }
  return { spent, bought };
}
/** 该配方单杯的**实际配方用量**（已含 V9 工坊降本）
 *
 * ★ 降本必须在这里统一收口 —— 所有"要备多少料"的路径都得走它：
 *   hasStock / maxCupsFromStock / UI 的备货建议 / AI 的采购逻辑。
 *   若只有 consumeStock 扣得少，而备货仍按原 req 买，就会变成
 *   「料买得一样多、扣得比以前少」→ 库存越堆越多 → 现金全压在原料上，
 *   降本收益被积压吞掉。实测踩过：产线开了、权重也加了，净效应却是负的。 */
function reqOf(s, rid) {
  const r = recipeById(rid);
  const out = {};
  if (!r || !r.req) return out;
  const cut = workshopCostCut(s, r.cuisine);
  for (const k in r.req) out[k] = Math.max(1, r.req[k] * (1 - cut));
  return out;
}
function hasStock(s, rid, cups) {
  const n = cups || 1;
  const req = reqOf(s, rid);
  for (const k in req) if ((s.inv[k] || 0) < req[k] * n) return false;
  return true;
}
function consumeStock(s, rid, worker) {
  const r = recipeById(rid);
  /* 配方缺失时别把营业流程炸掉：按只算包装费处理 */
  if (!r || !r.req) return CFG.PACK_COST;
  /* 「省料大师」按原料逐项打折：需求 1 时改为概率少耗，避免出现 Math.max(1,…) 抵消折扣 */
  const thrift = worker && worker.trait === 'thrift';
  let cost = CFG.PACK_COST;
  /* 用量统一走 reqOf（含 V9 工坊降本），避免"备货按降后、扣料按降前"两处漂移。
     ★ 降本必须落在**真实扣料**上：最初只改 costOf，cogs 仍走原值——
       菜单毛利数字变好看了，结算时库存照扣、钱照花，降本成了**纸面收益**，
       净效应 ≈ 0。玩家看到毛利 +12%，账上却没多赚一分。 */
  const req = reqOf(s, rid);
  for (const k in req) {
    let need = req[k];
    if (thrift) {
      const saved = need * 0.1;
      need = need - Math.floor(saved);
      if (RNG.next() < saved - Math.floor(saved)) need -= 1;
      need = Math.max(1, need);
    }
    s.inv[k] = Math.max(0, (s.inv[k] || 0) - need);
    cost += need * (s.avgCost[k] || ingById(k).base);
  }
  return cost;
}

/* ---------------- 菜单 ---------------- */
function toggleMenu(s, rid) {
  const i = s.menu.indexOf(rid);
  if (i >= 0) { s.menu.splice(i, 1); return '下架'; }
  if (s.menu.length >= menuSlots(s)) return false;
  /* V9 工坊是**生产资质**：没有对应工坊就做不出该系产品。
     这个硬约束必须在引擎入口拦住 —— 只靠 UI 隐藏按钮的话，
     改存档或直接调函数就能上架做不出的东西。 */
  const cl = canListRecipe(s, rid);
  if (!cl.ok) return cl.msg;
  s.menu.push(rid);
  if (s.ratios[rid] == null) s.ratios[rid] = 1.0;
  return '上架';
}
function setRatio(s, rid, r) { s.ratios[rid] = clamp(num(r, 1), 0.5, 2.0); }

/* ---------------- 研发 ---------------- */
function researchCost(s, rid) {
  const r = recipeById(rid);
  const base = r.research ? r.research.cash : 300;
  /* V9 工坊 Lv.1 起，该系研发费打折（先让这条产品线跑起来） */
  const cut = r.cuisine ? workshopResearchCut(s, r.cuisine) : 0;
  const discounted = base * (1 - clamp(num(cut, 0), 0, 0.5));
  return Math.round(discounted * diffOf(s).costMult);
}
function canResearch(s, rid) {
  const r = recipeById(rid);
  if (!r || s.recipes.includes(rid) || !r.research) return { ok: false, msg: '无法研发' };
  /* ★ 这里**刻意不对 tier3 配方加工坊门槛**。
     曾经加过（先要 Lv.3、后降到 Lv.2），两次都被配对实测证伪 ——
     因为它犯了和「上架硬约束」同一个错误：把新系统变成"能不能玩"的前置。
     逐款诊断（tools/diag-invest.js）给出的证据很直接：
       6 款 tier3 配方（樱花荔枝饮 / 厚乳拿铁 / 抹茶红豆冰 /
       黑糖鹿丸 / 鸭屎香柠檬茶 / 双皮奶冻）在「V9 全开」组里
       解锁局数从 18~19/20 **直接掉到 0/20** ——
       因为理性 AI 在 30 天里根本攒不到第二条线的钱，
       于是这条"门槛"实际效果是**永久锁死 40% 的配方表**。
     门槛下调治不好，因为病根不是门槛高，是"门槛存在"。
     现在高端款一律可做，工坊改为给它**加成**（见 workshopTier3Bonus）：
       工坊满级 → 高端款销量权重 +18%
     与 canListRecipe 保持一致：能不能做是既有玩法，做得好不好才是 V9。 */
  if (s.cash < researchCost(s, rid)) return { ok: false, msg: '现金不足' };
  for (const k in r.research.ing) {
    if ((s.inv[k] || 0) < r.research.ing[k]) return { ok: false, msg: ingById(k).name + '不足' };
  }
  return { ok: true };
}
function doResearch(s, rid) {
  const c = canResearch(s, rid);
  if (!c.ok) return c;
  const r = recipeById(rid);
  s.cash -= researchCost(s, rid);
  s.invested += researchCost(s, rid);
  for (const k in r.research.ing) s.inv[k] -= r.research.ing[k];
  s.recipes.push(rid);
  s.flags['researched'] = (s.flags['researched'] || 0) + 1;
  bumpQuest(s, 'research', 1);
  pushLog(s, `🧪 研发成功：${r.emoji} ${r.name}`);
  return { ok: true, recipe: r };
}

/* ---------------- 升级 / 分店 ---------------- */
function upgradeCost(s, id) {
  const u = upgradeById(id);
  /* 非法 id / 未初始化等级：以前前者会读 u.max 抛异常，
     后者会让 Math.pow(mult, undefined) 算出 NaN 并一路传下去。 */
  if (!u) return null;
  const lv = pos(s.up[id], 0);
  if (lv >= u.max) return null;
  return Math.round(u.base * Math.pow(u.mult, lv) * diffOf(s).costMult);
}
function doUpgrade(s, id) {
  const u = upgradeById(id);
  if (!u) return { ok: false, msg: '没有这项升级' };
  const c = upgradeCost(s, id);
  if (c == null) return { ok: false, msg: '已满级' };
  if (s.cash < c) return { ok: false, msg: '现金不足' };
  s.cash -= c; s.invested += c; s.up[id] = pos(s.up[id], 0) + 1;
  bumpQuest(s, 'upgrade', 1);
  pushLog(s, `⬆️ ${u.emoji} ${u.name} 升至 Lv.${s.up[id]}`);
  return { ok: true, cost: c };
}
function shopCost(s) {
  /* s.shops 被脏存档改成 0 / 负数时，SHOP_COSTS[-1] 是 undefined，
     Math.round(undefined) 会得到 NaN 并一路传到现金里。 */
  const i = pos(s.shops, 1) - 1;
  if (i < 0 || i >= SHOP_COSTS.length) return null;
  return Math.round(SHOP_COSTS[i] * diffOf(s).costMult);
}
function openShopBranch(s) {
  const c = shopCost(s);
  if (c == null) return { ok: false, msg: '已达分店上限' };
  if (s.cash < c) return { ok: false, msg: '现金不足' };
  s.cash -= c; s.shopSpend += c; s.shops++;
  pushLog(s, `🏪 第 ${s.shops} 家分店开业！`);
  return { ok: true, cost: c };
}

/* ---------------- 员工 ---------------- */
function hireStaff(s, idx) {
  const c = s.candidates[idx];
  if (!c) return { ok: false, msg: '候选人不存在' };
  /* 上限守卫：以前这里不查人数，员工可以一直加到存档清洗器截断为止，
     读档时多出来的会无声消失（连遣散费都不退）。 */
  if (s.staff.length >= CFG.STAFF_MAX) return { ok: false, msg: `员工已达上限 ${CFG.STAFF_MAX} 人` };
  if (s.cash < c.fee) return { ok: false, msg: '现金不足' };
  s.cash -= c.fee; s.invested += c.fee;
  const st = { id: s.nextStaffId++, name: c.name, emoji: c.emoji, skill: c.skill, trait: c.trait, wage: c.wage, stamina: 100 };
  s.staff.push(st);
  s.candidates.splice(idx, 1);
  bumpQuest(s, 'hire', 1);
  pushLog(s, `👤 雇佣了 ${st.emoji} ${st.name}`);
  return { ok: true, staff: st };
}
function fireStaff(s, id) {
  const i = s.staff.findIndex(x => x.id === id);
  if (i < 0) return { ok: false, msg: '员工不存在' };
  const st = s.staff[i];
  const sev = Math.round(st.wage * 2);
  if (s.cash < sev) return { ok: false, msg: '现金不足以支付遣散费' };
  s.cash -= sev;
  s.staff.splice(i, 1);
  pushLog(s, `👋 ${st.emoji} ${st.name} 离职（遣散费 ${money(sev)}）`);
  return { ok: true, sev };
}
function teamBuild(s) {
  const cost = Math.round(180 * (1 + s.staff.length * 0.4));
  if (s.staff.length === 0) return { ok: false, msg: '还没有员工' };
  if (s.cash < cost) return { ok: false, msg: '现金不足' };
  s.cash -= cost;
  for (const st of s.staff) st.stamina = 100;
  pushLog(s, `🎉 团建！全员体力回满（-${money(cost)}）`);
  return { ok: true, cost };
}

/* ---------------- 营业模拟 ---------------- */
function openShop(s) {
  /* 阶段守卫放最前面：重复开门会把 s.sim 整个重建，
     等于当天的营收、排队、已服务顾客全被悄悄清零。 */
  if (s.phase === 'open') return { ok: false, msg: '正在营业中' };
  if (s.phase === 'report') return { ok: false, msg: '今天的账还没结，先看看日报' };
  if (s.menu.length === 0) return { ok: false, msg: '至少要上架一款饮品' };
  /* 先校验再动钱。客流算不出来时旧代码已经把营销费扣掉了，
     玩家没开成门却平白少一笔钱，再点一次又少一笔。 */
  if (s.cash < s.marketing) s.marketing = Math.max(0, Math.floor(s.cash));
  const traffic = num(trafficOf(s), 3);
  if (!(traffic > 0)) return { ok: false, msg: '今日客流数据异常，无法开门' };
  s.dayMarketing = s.marketing;
  s.cash -= s.marketing;
  const dur = CFG.DAY_DURATION;
  const stations = [];
  stations.push({ idx: 0, worker: null, order: null, isBoss: true });
  for (let i = 0; i < s.staff.length; i++) stations.push({ idx: i + 1, worker: s.staff[i], order: null, isBoss: false });
  /* 分店工位复用现有员工；没有员工时 Math.max(1,0) 保证不出现 %0（NaN 的另一来源） */
  const pool = Math.max(1, s.staff.length);
  for (let i = 1; i < s.shops; i++) {
    stations.push({
      idx: stations.length,
      worker: s.staff[(i - 1) % pool] || null,
      order: null, isBoss: false, branch: true,
    });
  }

  s.phase = 'open';
  s.sim = {
    t: 0, duration: dur, closing: false,
    traffic, rate: traffic / (dur * 1.19), arrivalAcc: 0, spawned: 0,
    queue: [], stations, paused: false,
    orders: 0, cups: 0, lost: 0, priceLost: 0, stockout: 0,
    revenue: 0, cogs: 0, tips: 0,
    typeServed: {}, typeLost: {}, byRecipe: {},
    repGain: 0, trendCups: 0, clicks: 0, combo: 0, comboBest: 0, lastClick: 0, lastClickWall: 0,
    rushUntil: -99, rushCd: 0,
    highlights: [],           /* 每日高光（V3）：当天值得记住的 3 件事 */
    /* 营业中两个即时决策（V2），每天各一次 */
    saleUntil: -99, saleUsed: false, saleCap: 0, pulled: null,
    /* V7 事件型顾客：今天已出的特殊顾客数（上限 2） */
    specialCount: 0,
    floaters: [],
  };
  s.marketing = 0;
  s.eventTrafficMul = 1;
  return { ok: true };
}

/**
 * 生成一位顾客并入队。
 * type 非空 = 特殊顾客（V7）；为 null = 常规顾客（按客群权重抽）。
 */
function spawnOne(s, type) {
  const sim = s.sim;
  if (!s.menu.length) return;
  const t = type || pickCustomerType(s);

  const r = weightedPick(s.menu, rid => {
    const rec = recipeById(rid);
    let p = rec.pop;
    /* 招牌配方（V6）：等级越高，该款越抢手 —— 跨局累计出来的"招牌效应" */
    p *= sigSaleMul(s, rid);
    /* V9 菜系：工坊等级（销量权重）+ 主打菜系（客流倾斜） */
    p *= cuisineWeightMul(s, rid);
    p *= cuisineFocusWeight(s, rid);
    if (rec.tags.includes(s.trend)) p *= 1.55;
    if (s.weather.boom && rec.tags.includes(s.weather.boom)) p *= 1.25;
    if (s.weather.bust && rec.tags.includes(s.weather.bust)) p *= 0.78;
    for (const tag of rec.tags) {
      if (t.prefer.includes(tag)) p *= 1.75;
      if (t.avoid && t.avoid.includes(tag)) p *= 0.5;
    }
    if (t.popBias) p *= Math.pow(Math.max(0.4, rec.pop / 100), 1.2) * t.popBias;
    return p;
  });

  sim.spawned++;
  /* 等位座满了 → 直接走人 */
  if (sim.queue.length >= queueCap(s)) {
    sim.lost++; sim.repGain += CFG.LOST_REP;
    sim.typeLost[t.id] = (sim.typeLost[t.id] || 0) + 1;
    bumpQuest(s, 'lost', 1);
    return;
  }
  /* 价格接受度：客群容忍度不同，定价过高会被当场劝退。
     🃏 策略卡「精品路线」提高 priceTol —— 可以涨价而不被劝退。 */
  const eff = (s.ratios[r] || 1) / t.priceTol / cardMul(s, 'priceTol');
  const accept = clamp(1.35 - 0.35 * eff, 0.3, 1.5);
  if (RNG.next() > accept) {
    sim.lost++; sim.priceLost++;
    sim.repGain += CFG.LOST_REP * 0.6;
    bumpQuest(s, 'lost', 1);
    sim.typeLost[t.id] = (sim.typeLost[t.id] || 0) + 1;
    sim.floaters.push({ text: '太贵了…', kind: 'bad' });
    return;
  }

  sim.queue.push({
    id: 'c' + sim.spawned + '_' + RNG.next().toString(36).slice(2, 6),
    face: t.emoji, rid: r, type: t.id,
    /* V7：特殊顾客要在队列里一眼认出来（face 不同 + 角标） */
    special: type ? t.id : null,
    cups: rndInt(t.cups[0], t.cups[1]),
    wait: 0,
    /* 🃏 策略卡：会员体系延长耐心、员工入股缩短耐心 */
    patience: patienceOf(s) * t.patienceMul * cardMul(s, 'patience') * rnd(0.85, 1.2),
  });
}

function spawnCustomer(s) {
  const sim = s.sim;
  if (!s.menu.length) return;
  /* V7 事件型顾客：与一位常规顾客**一一替换**（总客流不变）。
     两版方案的取舍（都是 sim 配对实测出来的）：
       ① 「顶替」（初版）—— 特殊顾客挤掉一位常规顾客。easy 掉 11pp：
          挤掉的是本来能服务好的客人，而特殊客人自己又因耐心低而流失，
          等于白丢一单；玩家在 26 秒里也**无法**"优先伺候"谁（工位全并行）。
       ② 「额外到店」—— 特殊顾客多来一位，总客流 +1/天。easy 修好了（+1pp），
          但 hard 涨了 +5pp：hard 目标高（48000），每天多 1 位客人 ≈ 80 元，
          30 天就是 +2400 元 ≈ +5pp —— 客流总量变了就是会改难度。
     现在取③：**1:1 替换**（特殊顾客取代那位常规顾客），客流总量严格不变，
     难度中性；特殊顾客只把"今天这一位是谁"换掉，不改变今天的客流量。
     配合调优后的数值（耐心/口碑系数不低于常规顾客），期望价值不亏。 */
  const sp = pickSpecialType(s);
  spawnOne(s, sp);
}

function assignOrder(s, st, c) {
  const sim = s.sim;
  const cups = c.cups || 1;
  if (!hasStock(s, c.rid, cups)) {
    /* 份数太多时降级为 1 杯，实在没料才赶客 */
    if (cups > 1 && hasStock(s, c.rid, 1)) c.cups = 1;
    else {
      sim.lost++; sim.stockout++; sim.repGain += CFG.STOCKOUT_REP;
      sim.typeLost[c.type] = (sim.typeLost[c.type] || 0) + 1;
      bumpQuest(s, 'lost', 1);
      sim.floaters.push({ text: '缺料!', kind: 'bad' });
      return false;
    }
  }
  const n = c.cups || 1;
  for (let i = 0; i < n; i++) sim.cogs += consumeStock(s, c.rid, st.worker) * cardMul(s, 'cogs');
  st.order = { c, progress: 0, price: priceOf(s, c.rid), rid: c.rid, cups: n, type: c.type };
  return true;
}

function completeOrder(s, st) {
  const sim = s.sim;
  const o = st.order;
  const rec = recipeById(o.rid);
  const cups = o.cups || 1;
  const trendHit = !!(rec && rec.tags && rec.tags.includes(s.trend));
  const type = customerTypeById(o.type) || null;
  /* 🃏 策略卡：外卖平台 / 加盟模式按杯让利 —— 客流赚回来，单杯少赚一点 */
  const sub = cardSum(s, 'unitSub') * cups;
  /* 限时促销（V2）期间每杯再让 ¥2：它换来的是那 8 秒里多来 60% 的客人，
     划不划算取决于当时产能够不够 —— 这正是它作为"决策"的意义。 */
  const saleNow = sim.t < sim.saleUntil;
  const income = Math.max(1, o.price * cups - sub - (saleNow ? CFG.SALE_UNIT_SUB * cups : 0));

  s.cash += income;
  sim.revenue += income;
  sim.orders++;
  sim.cups += cups;
  sim.repGain += CFG.SERVE_REP * (type ? type.repMul : 1) * cups;
  /* V6 招牌配方：累计卖出杯数（跨局继承的成长线） */
  addSigCups(s, o.rid, cups);
  if (trendHit) sim.trendCups += cups;
  s.stats.totalCups += cups;
  s.stats.totalRevenue += income;
  sim.typeServed[o.type] = (sim.typeServed[o.type] || 0) + cups;
  /* 按配方的销量：临时下架（V2）要靠它挑出"今天最不受欢迎的那款" */
  sim.byRecipe[o.rid] = (sim.byRecipe[o.rid] || 0) + cups;
  st.order = null;
  bumpQuest(s, 'cups', cups);
  bumpQuest(s, 'revenue', income);
  if (trendHit) bumpQuest(s, 'trend', cups);
  sim.floaters.push({ text: '+' + money(income), kind: 'good' });
  if (trendHit && sim.trendCups >= 20) s.flags.trendMaster = true;
  if (cups >= 4) s.flags.bigOrder = true;
  /* ---- V7 事件型顾客：服务成功的口碑奖励 ----
     口碑奖惩是**当日生效**的（repGain 在 endDay 统一结算成口碑增减），
     所以特殊顾客的价值当天就能兑现；没接住（走了）走 repBad。 */
  if (type && type.repGood) {
    sim.repGain += num(type.repGood, 0);
    sim.floaters.push({ text: `${type.emoji} ${type.name} +${type.repGood} 口碑`, kind: 'gold' });
    pushHighlight(sim, 'special', `${type.emoji} ${type.name} 满意离店 · 口碑 +${type.repGood}`);
  }
  /* ---- 每日高光（V3）：把"今天发生了什么值得记住的事"记下来 ----
     日报从此不只是 6 个数字。同一类型只记一条（取当天最强的那次），
     最多 3 条 —— 再多日报就变成流水账，反而没人看。 */
  if (cups >= 4 && !hasHighlight(sim, 'bigorder')) {
    pushHighlight(sim, 'bigorder', `🛍️ 一单 ${cups} 杯大单，进账 ${money(income)}`);
  }
  if (type && type.id === 'influencer' && !hasHighlight(sim, 'infl')) {
    pushHighlight(sim, 'infl', `📸 第一位网红顾客下单了（${cups} 杯 ${rec ? rec.name : ''}）`);
  }
  if (trendHit && sim.trendCups >= 8 && !hasHighlight(sim, 'trend')) {
    pushHighlight(sim, 'trend', `🌟 今日流行「${rec.name}」已卖 ${sim.trendCups} 杯`);
  }
}

/* ---- 每日高光（V3）的三个小工具 ---- */
function hasHighlight(sim, kind) {
  return !!(sim.highlights || []).some(h => h.kind === kind);
}
function pushHighlight(sim, kind, text) {
  if (!Array.isArray(sim.highlights)) sim.highlights = [];
  if (sim.highlights.length >= 3) return;
  sim.highlights.push({ kind: kind, text: text });
}

function rushStation(s, idx) {
  const sim = s.sim;
  if (!sim) return null;
  const st = sim.stations[idx];
  if (!st || !st.order) return null;
  const now = sim.t;
  const wall = Date.now() / 1000;
  sim.combo = (wall - sim.lastClickWall < 1.1) ? sim.combo + 1 : 1;
  sim.lastClick = now;
  sim.lastClickWall = wall;
  sim.comboBest = Math.max(sim.comboBest, sim.combo);
  /* 每日高光（V3）：连击里程碑。comboBest 在打烊时还会再补一条兜底，
     这里记的是"当时那一下"——带上杯序和当时的小费，比事后的总数更有画面感。 */
  if (sim.combo === 5 && !hasHighlight(sim, 'combo')) {
    pushHighlight(sim, 'combo', `⚡ 第 ${sim.orders} 单时打出 5 连击`);
  } else if (sim.combo === 10 && !hasHighlight(sim, 'combo10')) {
    pushHighlight(sim, 'combo10', `🔥 第 ${sim.orders} 单时打出 10 连击`);
  }
  const bonus = 1 + Math.min(1.0, sim.combo * 0.05);
  st.order.progress += CFG.RUSH_BOOST * bonus;
  sim.clicks++;
  s.stats.clicks++;
  bumpQuest(s, 'clicks', 1);
  /* 🃏 策略卡：自助点单机提高小费、极速出杯降低小费 */
  const t = st.order.price * CFG.RUSH_TIP * bonus * cardMul(s, 'tip');
  s.cash += t; sim.revenue += t; sim.tips += t;
  /* 小费进了 sim.revenue（结算报表会算），任务进度也该跟着走，
     否则「营业额冲高」的进度条永远比报表少一截。 */
  bumpQuest(s, 'revenue', t);
  if (st.order.progress >= 1) completeOrder(s, st);
  return { combo: sim.combo, tip: t };
}

function bossSkill(s) {
  const sim = s.sim;
  if (!sim || sim.rushCd > 0) return false;
  sim.rushUntil = sim.t + CFG.BOSS_SKILL_DUR;
  sim.rushCd = CFG.BOSS_SKILL_CD;
  return true;
}

/** 暂停 / 恢复营业（切后台时自动暂停，避免回来时间错位） */
function togglePause(s, force) {
  if (!s.sim) return false;
  s.sim.paused = (force == null) ? !s.sim.paused : !!force;
  return s.sim.paused;
}

function tick(s, dt) {
  const sim = s.sim;
  if (!sim || s.phase !== 'open') return;
  if (sim.paused) return;
  /* dt 来自 performance.now() 的帧间差。一旦它变成 NaN/Infinity（某些 WebView 首帧
     会给出异常时间戳、或标签页恢复时计时器跳变），sim.t 就会被永久污染成 NaN，
     整局再也推不动且看不出原因。这里宁可跳过这一帧。 */
  if (!Number.isFinite(dt) || dt <= 0) return;
  dt = Math.min(dt, 0.12);
  sim.t += dt;
  if (sim.rushCd > 0) sim.rushCd -= dt;

  if (!sim.closing) {
    const x = Math.min(1, sim.t / sim.duration);
    const curve = 0.55 + 1.0 * Math.sin(Math.PI * x);
    /* 限时促销（V2）生效中：到达速率 ×1.6，同时把当天的客人上限抬高 ——
       只提速不抬上限的话等于"把后面的客人提前叫来"，玩家反而亏了。 */
    const saleOn = sim.t < sim.saleUntil;
    sim.arrivalAcc += sim.rate * curve * (saleOn ? CFG.SALE_TRAFFIC : 1) * dt;
    const cap = sim.saleCap > 0 ? sim.saleCap : sim.traffic;
    while (sim.arrivalAcc >= 1 && sim.spawned < cap) {
      sim.arrivalAcc -= 1;
      spawnCustomer(s);
    }
    if (sim.t >= sim.duration) sim.closing = true;
  }

  for (let i = sim.queue.length - 1; i >= 0; i--) {
    const c = sim.queue[i];
    c.wait += dt;
    if (c.wait > c.patience) {
      sim.queue.splice(i, 1);
      sim.lost++;
      sim.repGain += CFG.LOST_REP;
      sim.typeLost[c.type] = (sim.typeLost[c.type] || 0) + 1;
      bumpQuest(s, 'lost', 1);
      sim.floaters.push({ text: '走了…', kind: 'bad' });
      /* V7 事件型顾客：没接住特殊顾客要扣口碑（repBad）。
         这是"服务特殊顾客有代价"的一半 —— 只给好处不给代价，
         玩家会无脑忽略其他客人。 */
      if (c.special) {
        const sp = specialById(c.special);
        if (sp && sp.repBad) {
          sim.repGain += num(sp.repBad, 0);
          sim.floaters.push({ text: `${sp.emoji} ${sp.name} 不满离店`, kind: 'bad' });
        }
      }
    }
  }

  for (const st of sim.stations) {
    if (st.worker && st.worker.stamina <= 0) continue;
    if (st.order) {
      const tt = serviceTimeOf(s, st.worker, sim) * (1 + ((st.order.cups || 1) - 1) * 0.35);
      st.order.progress += dt / tt;
      if (st.order.progress >= 1) completeOrder(s, st);
    }
    if (!st.order) {
      const c = sim.queue.shift();
      if (c) assignOrder(s, st, c);
    }
  }

  const done = sim.closing && sim.queue.length === 0 && sim.stations.every(st => !st.order);
  const hardStop = sim.t > sim.duration + CFG.LAST_CALL;
  if (done || hardStop) {
    for (const c of sim.queue) {
      sim.lost++;
      sim.repGain += CFG.LOST_REP * 0.5;
      sim.typeLost[c.type] = (sim.typeLost[c.type] || 0) + 1;
      bumpQuest(s, 'lost', 1);
    }
    sim.queue = [];
    endDay(s);
  }
}

/* ---------------- 结算 ---------------- */
function endDay(s) {
  /* 守卫：sim 只在 openShop 成功后才建。prep / report 阶段（或开门被拒后）
     调进来会直接读 null.revenue 崩掉，而结算是主流程必经的一步。 */
  if (!s || !s.sim) return null;
  const sim = s.sim;
  const d = diffOf(s);
  /* 无尽模式的难度阶梯：只抬目标数字、成本不变，等于难度没变，
     玩家靠时间堆就能过。每上一个里程碑，工资与租金同步上浮，
     逼着他继续提人效 —— 这才是「越来越难」。 */
  const ep = endlessPressure(s);
  const wages = Math.round(s.staff.reduce((a, b) => a + b.wage, 0) * ep * cardMul(s, 'wage'));
  let rentRaw = (CFG.RENT_PER_SHOP * s.shops + CFG.SHOP_UPKEEP * (s.shops - 1)) * d.rentMult * ep * cardMul(s, 'rent');
  for (const st of s.staff) if (st.trait === 'wise') rentRaw *= 0.92;
  const rent = Math.round(rentRaw);
  const net = sim.revenue - sim.cogs - wages - rent - (s.dayMarketing || 0);
  s.cash -= wages + rent;

  const total = (sim.orders || 0) + sim.lost;
  const sat = total > 0 ? (sim.orders || 0) / total : 1;
  let avgRatio = 1;
  if (s.menu.length) {
    let sum = 0;
    for (const r of s.menu) sum += (s.ratios[r] || 1);
    avgRatio = sum / s.menu.length;
  }
  let repDelta = (sat - 0.68) * 10 + (1.0 - avgRatio) * 1.5 + s.up.decor * 0.15;
  for (const st of s.staff) if (st.trait === 'nice') repDelta += 0.6;
  repDelta += sim.repGain * 0.25 * cardMul(s, 'repGain');
  const before = s.rep;
  s.rep = clamp(s.rep + repDelta, 0, 100);

  /* 🃏 策略卡：通宵营业让员工更抗造 */
  const drain = cardMul(s, 'stamina');
  for (const st of s.staff) {
    let cost = 28 * drain;
    if (st.trait === 'iron') cost *= 0.65;
    st.stamina = clamp(st.stamina - cost, 0, 100);
  }

  s.stats.totalProfit += net;
  s.stats.bestDayProfit = Math.max(s.stats.bestDayProfit, net);
  s.stats.totalLost += sim.lost;
  s.stats.totalServed += (sim.orders || 0);
  s.stats.days++;
  /* 零流失日。门槛是 24 杯而不是 12：第 1 天客流只有 10~16 杯、
     单个工位稍微盯一下就能零流失，实测有 53% 的第二天都能白拿这 ¥600，
     而它一项就占了新档首日成就现金的四成以上（首日成就现金平均 ¥773，
     相当于开局资金的 107%）。抬到 24 杯后它变成"经营上轨道之后的好日子"，
     前期不再白送一笔。 */
  if ((sim.cups || 0) >= 24 && sim.lost === 0) s.flags.perfectDay = true;

  const worth = netWorth(s);
  /* 结算页的环比要用「前一天」那份，而下面马上就要覆盖 s.report 了，
     所以先把它留一份 —— 否则永远只能和自己比。 */
  s.prevReport = s.lastReport || null;
  s.report = {
    day: s.day, served: sim.cups || 0, orders: sim.orders || 0, lost: sim.lost,
    priceLost: sim.priceLost || 0, stockout: sim.stockout,
    revenue: sim.revenue, cogs: sim.cogs, wages, rent,
    marketing: s.dayMarketing || 0, net,
    sat, repBefore: before, repAfter: s.rep, repDelta: s.rep - before,
    trendCups: sim.trendCups, clicks: sim.clicks, comboBest: sim.comboBest,
    tips: sim.tips, traffic: sim.traffic,
    typeServed: Object.assign({}, sim.typeServed), typeLost: Object.assign({}, sim.typeLost),
    /* 每日高光（V3）：打烊时补两条"只有看完全天才知道"的 ——
       连击峰值和零流失。营业中记的是"当时那一下"，这里补的是"今天做到了什么"。 */
    contractResult: s.contractResult || null,
    /* V5 章节关卡的结算结果：同样在 report 构建后回填（见 endDay 的说明） */
    stageResult: s.stageResult || null,
    highlights: (function () {
      const out = arr(sim.highlights).map(h => ({ kind: String(h.kind), text: String(h.text) }));
      if (sim.comboBest >= 3 && !out.some(h => h.kind.indexOf('combo') === 0)) {
        out.push({ kind: 'comboBest', text: `⚡ 今天最高 ${sim.comboBest} 连击，小费进账 ${money(sim.tips)}` });
      }
      if (sim.lost === 0 && sim.orders >= 6 && out.length < 3) {
        out.push({ kind: 'nolost', text: '🎯 零流失日 · 一位客人都没跑掉' });
      }
      return out.slice(0, 3);
    })(),
    rivalShare: rivalShare(s), worth,
    pressure: ep, lastMarketing: s.lastMarketing || 0,
  };
  s.lastReport = s.report;
  s.phase = 'report';

  /* 经营历史（供曲线图使用） */
  pushHistory(s, {
    day: s.day, revenue: Math.round(sim.revenue), net: Math.round(net),
    worth: Math.round(worth), rep: Math.round(s.rep),
    cups: sim.cups || 0, orders: sim.orders || 0, lost: sim.lost,
    rival: s.rival ? Math.round(s.rival.rep) : 0,
  });

  if (Object.keys(sim.typeServed || {}).length >= 5) s.flags.fiveTypes = true;
  if ((sim.typeServed && (sim.typeServed.influencer || 0) >= 5)) s.flags.starMagnet = true;
  if (s.rival && s.rival.rep <= 10) s.flags.rivalDown = true;

  /* 净利型任务在此刻才结算得出来，随后统一终判「越少越好」型 */
  bumpQuest(s, 'profit', net);
  closeQuests(s);
  /* 合同也在此刻终判：它看的是当日全部指标（净利/满意率都只有打烊才算得出）。
     放在 checkAchievements 之前 —— 合同失败会扣口碑，而口碑影响当日成就判定。
     注意 s.report 在本函数更早处就已经构建好了（合同要用 report.net / report.sat），
     所以结算结果要**回填**进那个对象，日报才拿得到。只在真的结算出结果时写回：
     endDay 被二次调用时 settleContract 返回 null，直接赋值会把上一份抹掉。 */
  const cr = settleContract(s);
  if (cr) {
    s.contractResult = cr;
    if (s.report) s.report.contractResult = cr;
  }
  /* V5 章节关卡：同样在打烊终判，同样要**回填**进已经构建好的 report。
     放在合同之后、成就之前 —— 关卡奖励也会影响当日现金与成就判定口径。 */
  const sr = settleStage(s);
  if (sr) {
    s.stageResult = sr;
    if (s.report) s.report.stageResult = sr;
  }

  updateRival(s);
  s.newAchList = checkAchievements(s);

  const goal = goalOf(s);
  if (worth >= goal) {
    s.flags.goalHit = true;
    if (s.endless) { s.milestone = (s.milestone || 0) + 1; s.endlessLevelUp = true; }
  }

  /* 中期目标：达成一次记一次，结算成声望点（见 prestigeGain）。
     只在当天达成时记，之后即使净资产回落也不撤销 —— 它是节奏提示，不是持续 buff。 */
  const ms = milestoneOf(s);
  if (ms && ms.hit) {
    if (!Array.isArray(s.msHit)) s.msHit = [];
    if (s.msHit.indexOf(ms.day) < 0) {
      s.msHit.push(ms.day);
      pushLog(s, `🏁 达成中期目标：Day ${ms.day} 前净资产 ${money(ms.worth)} · 声望 +1`);
    }
  }

  if (s.cash < 0) s.debtDays++; else s.debtDays = 0;

  /* 打烊抽卡：每 CARD_EVERY 天给三选一，最多拿 CARD_MAX 张。
     放在这里而不是 nextDay，是为了让「结算 → 选卡 → 新的一天」成一个连续动作，
     玩家看到昨天的报表再决定要不要改路线，而不是新的一天开始后凭记忆选。 */
  s.cardOffer = drawCards(s);
}

/** 中期目标：当前这个 5 天窗口要在净资产上达到的锚点。
    无尽模式与已通关的局面没有中期目标，返回 null。 */
function milestoneOf(s) {
  if (s.endless || isFinished(s)) return null;
  const goal = num(goalOf(s), 0);
  if (!(goal > 0)) return null;
  const d = Math.max(1, num(s.day, 1));
  let idx = Math.ceil(d / MILESTONE_EVERY) - 1;
  idx = Math.max(0, Math.min(MILESTONE_RATIO.length - 1, idx));
  const atDay = Math.min(CFG.DAYS, (idx + 1) * MILESTONE_EVERY);
  const worth = Math.round(goal * MILESTONE_RATIO[idx]);
  const nw = num(netWorth(s), 0);
  return { day: atDay, worth: worth, gap: worth - nw, hit: nw >= worth };
}

/** 无尽模式的成本压力：每上一个里程碑，工资与租金各上浮 12% */
function endlessPressure(s) {
  if (!s.endless) return 1;
  return 1 + 0.12 * Math.max(0, (s.milestone || 1) - 1);
}

/** 无尽模式：30 天后继续经营 */
function startEndless(s) {
  s.endless = true;
  s.milestone = Math.max(1, s.milestone || 0);
  /* 进入无尽 = 从干净的备货状态重新开始一段，必须把上一段的营业现场清掉。
     否则从结算页走「提前收官 → 继续经营」进来时，phase 还停在 'report'、
     s.sim / s.report 还挂着，openShop 会被「今天的账还没结」挡死；
     而 finishRun 已经 clearSave() 过，重载页也救不回来 —— 一局直接没了。 */
  s.phase = 'prep';
  s.sim = null;
  s.report = null;
  s.cardOffer = null;
  pushLog(s, '♾️ 进入无尽模式：目标将持续升级！');
  return goalOf(s);
}

/** 结算后推进到下一天 */
function nextDay(s) {
  s.endlessLevelUp = false;
  s.day++;
  s.cardOffer = null;      /* 抽卡是一次性的，跨天作废（选择发生在 enterNextDay 之前） */
  /* 营销是「当天一次性投入」，开门时扣掉、打烊后归零。
     以前这个归零是完全静默的：玩家第二天看到营销还是 ¥0，
     会以为昨天那笔钱没生效，或者干脆忘了每天都要重新投。
     这里把昨天的投入留一份并写进日志，经营面板也能提示「今日未投放」。 */
  s.lastMarketing = s.dayMarketing || 0;
  if (s.lastMarketing > 0) {
    pushLog(s, `📢 昨日营销投入 ${money(s.lastMarketing)} 已消耗完毕，今天需要重新设置`);
  }
  s.dayMarketing = 0;
  s.phase = 'prep';
  s.sim = null;
  s.report = null;
  rollWeather(s);
  rollTrend(s);
  rollNews(s);
  refreshMarket(s);
  for (const st of s.staff) st.stamina = clamp(st.stamina + 34, 0, 100);
  refreshCandidates(s, false);
  rollQuests(s);
  rollContract(s);   /* 合同每天换一个：备货阶段就要知道"今天要凑什么" */
  if (RNG.next() < 0.42 && !s.pendingEvent) {
    let pool = EVENTS.filter(e => !s.doneEvents || !s.doneEvents.includes(e.id));
    /* 事件抽完之后不能就这么静默地「再也不出事件」：
       30 天里大约会触发 12 次，长局和无尽模式一定会把池子抽干。
       抽干就清空记录重新轮换，保证后期仍有随机性。 */
    if (!pool.length && EVENTS.length) { s.doneEvents = []; pool = EVENTS.slice(); }
    s.pendingEvent = pick(pool) || null;
    (s.doneEvents = s.doneEvents || []).push(s.pendingEvent ? s.pendingEvent.id : '');
  }
  return s.day;
}

function isBankrupt(s) { return s.debtDays >= 2; }
function isFinished(s) { return !s.endless && s.day > CFG.DAYS; }

/* ---------------- 事件 ---------------- */
function applyEvent(s, ev, idx) {
  const opt = (ev && ev.options) ? ev.options[idx] : null;
  if (!opt) { s.pendingEvent = null; return ['（事件已失效，已跳过）']; }
  const e = opt.effect || {};
  const msgs = [];
  if (e.cash) { s.cash += e.cash; msgs.push((e.cash > 0 ? '现金 +' : '现金 ') + money(e.cash)); }
  if (e.rep) { s.rep = clamp(s.rep + e.rep, 0, 100); msgs.push('口碑 ' + (e.rep > 0 ? '+' : '') + e.rep); }
  if (e.inv) {
    for (const k in e.inv) {
      if (e.inv[k] === -999) s.inv[k] = Math.floor((s.inv[k] || 0) / 2);
      else s.inv[k] = Math.max(0, (s.inv[k] || 0) + e.inv[k]);
    }
    msgs.push('库存变动');
  }
  if (e.staffHeal) {
    for (const st of s.staff) st.stamina = clamp(st.stamina + e.staffHeal, 0, 100);
    msgs.push('体力 ' + (e.staffHeal > 0 ? '+' : '') + e.staffHeal);
  }
  /* 事件给的 upgrade id 理论上都来自静态配置，但脏存档/改配置都可能让它对不上，
     取不到就跳过而不是把整局炸掉。 */
  if (e.upgrade) {
    const u = upgradeById(e.upgrade);
    if (u && s.up[e.upgrade] != null) {
      s.up[e.upgrade] = Math.min(u.max, num(s.up[e.upgrade]) + 1);
      msgs.push('升级 +1');
    }
  }
  if (e.unlockRecipe) {
    const tier = e.unlockRecipe === 'tier3' ? 3 : 2;
    const pool = RECIPES.filter(r => r.tier === tier && !s.recipes.includes(r.id));
    if (pool.length) { const r = pick(pool); s.recipes.push(r.id); msgs.push('解锁 ' + r.emoji + r.name); }
    else { s.cash += 500; msgs.push('秘方重复，折现 +¥500'); }
  }
  if (e.loseStaff) {
    for (let i = 0; i < e.loseStaff && s.staff.length; i++) {
      const st = s.staff.splice(Math.floor(RNG.next() * s.staff.length), 1)[0];
      msgs.push(st.emoji + st.name + ' 离职');
    }
  }
  if (e.trafficMul) { s.eventTrafficMul = e.trafficMul; msgs.push('次日客流 ×' + e.trafficMul); }
  pushLog(s, `${ev.emoji} ${ev.title}：${opt.label}`);
  s.pendingEvent = null;
  return msgs;
}

/* ---------------- 成就 ---------------- */
function checkAchievements(s) {
  const got = [];
  for (const a of ACHIEVEMENTS) {
    if (s.ach[a.id]) continue;
    let ok = false;
    try { ok = !!a.check(s); } catch (e) { ok = false; }
    if (ok) {
      s.ach[a.id] = true;
      if (a.reward.cash) s.cash += a.reward.cash;
      got.push(a);
      pushLog(s, `🏅 成就达成：${a.emoji} ${a.name}`);
    }
  }
  return got;
}

/** 成就的 ★ 入账（现金在 checkAchievements 里已经给了，这里只管跨局声望）。
 *  规则：**跨局首次**达成才给 ★，之后再达成只给现金 ——
 *  32 条合计 150 ★，做成「慢慢集齐」的长期目标，而不是每局发一笔、
 *  两局就把开局资金顶到上限（那样第三局起又没东西可追了）。
 *  返回本批次首次达成的成就 id，供 UI 决定要不要在飘字里写 "+N★"。
 *  注意：以前这个 ★ 从来没写进过 META（toast 承诺 "+3★" 却没有兑现），是个静默丢奖励的 bug。 */
function claimAchStars(meta, got) {
  const first = [];
  if (!meta || !Array.isArray(got) || !got.length) return first;
  if (!meta.ach || typeof meta.ach !== 'object') meta.ach = {};
  let add = 0;
  for (const a of got) {
    if (!a || meta.ach[a.id]) continue;
    meta.ach[a.id] = true;
    first.push(a.id);
    add += (a.reward && a.reward.bp) || 0;
  }
  if (add > 0) {
    meta.bp = num(meta.bp, 0) + add;
    meta.maxBpEarned = Math.max(num(meta.maxBpEarned, 0), meta.bp);
  }
  return first;
}

/* ---------------- 转生 ---------------- */
function prestigeGain(s) {
  const nw = Math.max(0, netWorth(s));
  const msBonus = Array.isArray(s.msHit) ? s.msHit.length : 0;
  return Math.max(1, Math.floor(Math.sqrt(nw / 220))) + msBonus;
}

/* ============================================================
 *  每日任务
 *  每天开局刷 QUEST_COUNT 条，达成即时到账现金。
 *  进度只在当天有效：跨天由 rollQuests() 整体换血，不做增量续接。
 * ============================================================ */

/** 目标值随天数线性上抬并夹在 [min, max] —— 后期客流变大，不抬就没有挑战 */
function questGoalOf(q, s) {
  const t = Math.max(0, (s.day || 1) - 1);
  return Math.max(1, Math.round(Math.min(q.max, q.min + q.mul * t)));
}
/** 奖金随天数放大（最多 2 倍），否则第 20 天的几十块毫无吸引力 */
function questRewardOf(q, s) {
  return Math.round(q.reward * (1 + Math.min(1.0, ((s.day || 1) - 1) * 0.045)));
}
/** 当前可抽取的池子：when 不满足的（配方全解锁、没候选人）直接出局 */
function questPool(s) {
  return QUESTS.filter(q => {
    if (!q.when) return true;
    try { return !!q.when(s); } catch (e) { return false; }
  });
}

/**
 * 抽一整天的新任务（无放回）。
 * 只在 newGame / nextDay 里调用 —— 中途重复调用会把玩家已经做出的进度抹掉。
 */
function rollQuests(s) {
  const pool = questPool(s);
  const out = [];
  while (out.length < QUEST_COUNT && pool.length) {
    const q = pool.splice(Math.floor(QUEST_RNG.next() * pool.length), 1)[0];
    out.push({ id: q.id, goal: questGoalOf(q, s), prog: 0, done: false, got: 0 });
  }
  s.quests = out;
  s.questDay = s.day;
  return out;
}

/** 发奖并入账；返回一条可供 UI 弹提示的记录 */
function grantQuest(s, it) {
  const q = questById(it.id);
  if (!q) return null;
  const cash = questRewardOf(q, s);
  s.cash += cash;
  it.got = cash;
  /* questDone（累计完成数）曾在这里累加、清洗器里保留，但全仓没有任何
     读取方 —— 连探针都不用。删掉；questCash 有对账探针要读，必须留。 */
  s.stats.questCash = (s.stats.questCash || 0) + cash;
  pushLog(s, `✅ 每日任务达成：${q.emoji} ${q.name} +${money(cash)}`);
  return { id: q.id, name: q.name, emoji: q.emoji, cash };
}

/**
 * 推进进度并对「越多越好」型即时发奖。
 * 传回来的数组是本轮新达成的任务（可能为空），UI 拿它弹提示。
 */
function bumpQuest(s, metric, n) {
  if (!s.quests || !s.quests.length) return [];
  const add = num(n, 0);
  const got = [];
  for (const it of s.quests) {
    const q = questById(it.id);
    /* 已达成 / 指标不匹配 / 未知 id（旧存档或改过表）一律跳过 */
    if (!q || q.metric !== metric || it.done) continue;
    it.prog = Math.max(0, num(it.prog, 0) + add);
    if (q.dir === 'down') continue;          /* 越少越好型留给 closeQuests 判定 */
    if (it.prog >= it.goal) { it.done = true; got.push(grantQuest(s, it)); }
  }
  if (got.length) s.newQuests = (s.newQuests || []).concat(got);
  return got;
}

/** 打烊时对「越少越好」型（流失人数）做终判，破功就作废 */
function closeQuests(s) {
  const got = [];
  for (const it of (s.quests || [])) {
    const q = questById(it.id);
    if (!q || it.done || q.dir !== 'down') continue;
    if (num(it.prog, 0) <= it.goal) { it.done = true; got.push(grantQuest(s, it)); }
  }
  if (got.length) s.newQuests = (s.newQuests || []).concat(got);
  return got;
}

/** 给 UI 的展示模型：把静态表与当日进度拼成一行行可直接渲染的对象 */
function questViews(s) {
  const list = [];
  for (const it of (s.quests || [])) {
    const q = questById(it.id);
    if (!q) continue;
    const goal = Math.max(1, num(it.goal, 1));
    const prog = Math.max(0, num(it.prog, 0));
    list.push({
      id: q.id, emoji: q.emoji, name: q.name, unit: q.unit || '', prefix: q.prefix || '',
      dir: q.dir, goal, prog,
      /* 越少越好型的进度条按「剩余额度」画，方向反过来才符合直觉 */
      ratio: q.dir === 'down' ? clamp(1 - prog / (goal + 1), 0, 1) : clamp(prog / goal, 0, 1),
      done: !!it.done, reward: it.got || questRewardOf(q, s),
    });
  }
  return list;
}

/* ---------------- 每日合同（V1）----------------
 * 和每日任务的差别只在**决策窗口**：任务打烊后判定（玩家事前不知道），
 * 合同开门前就摆在备货页，玩家能围绕它改采购、改菜单、改定价。
 * 判定框架共用（都在打烊时用当日指标算），换来的是备货阶段的明确目标。
 */
function contractById(id) { return CONTRACTS.find(c => c.id === id) || null; }

/** 当日指标快照：合同的 check 只认这一个对象，加新指标不用改判定式 */
function contractMetrics(s) {
  const sim = s.sim || s.report || {};
  const orders = num(sim.orders, 0);
  const revenue = num(sim.revenue, 0);
  return {
    cups: num(sim.cups, 0),
    orders,
    lost: num(sim.lost, 0),
    revenue,
    net: num((s.report && s.report.net), 0),
    avgPrice: orders > 0 ? revenue / orders : 0,
    sat: num((s.report && s.report.sat), 1),
    clicks: num(sim.clicks, 0),
    comboBest: num(sim.comboBest, 0),
    trendCups: num(sim.trendCups, 0),
    typeServed: Object.assign({}, sim.typeServed || {}),
  };
}

/** 每天开局抽一个合同（备货页可见）；已抽过的优先不重复 */
function rollContract(s) {
  if (!CONTRACTS.length) { s.contract = null; return null; }
  const recent = arr(s.contractLog).slice(-4).map(String);
  const pool = CONTRACTS.filter(c => recent.indexOf(c.id) < 0);
  const from = (pool.length ? pool : CONTRACTS);
  const c = from[Math.floor(rnd(0, from.length))] || from[0];
  s.contract = { id: c.id, done: false };
  s.contractLog = arr(s.contractLog).concat(c.id);
  if (s.contractLog.length > 8) s.contractLog = s.contractLog.slice(-8);
  return s.contract;
}

/** 合同的难度缩放：门槛按难度放宽、失败惩罚按难度减轻。
 *  没有这一步时 hard 的玩家会反复违约 —— 违约扣口碑，而口碑低 → 客流少 →
 *  更完不成 → 口碑更低，是个会自我加速的死循环（实测把 hard 达标率
 *  从 70% 拖到 60%、连玩曲线出现衰减）。 */
function contractScale(s) {
  const d = DIFFICULTY[diffOf(s).key] || DIFFICULTY.normal;
  return {
    goal: num(d.contractGoal, 1),
    penalty: num(d.contractPenalty, 0.6),
  };
}

/** 打烊结算：达成发钱，失败扣口碑（口碑直接决定次日客流，所以失败有真实代价） */
function settleContract(s) {
  const c = s.contract && contractById(s.contract.id);
  if (!c || s.contract.done) return null;
  const sc = contractScale(s);
  const m = contractMetrics(s);
  const g = scaledGoal(c, sc.goal);
  const ok = !!c.check(m, g);
  s.contract.done = ok;
  const repLoss = Math.round(num(c.failRep, -3) * sc.penalty);
  if (ok) {
    s.cash += c.cash;
    pushLog(s, `📜 今日合同达成：${c.emoji} ${c.name} +${money(c.cash)}`);
  } else if (repLoss < 0) {
    s.rep = Math.max(0, num(s.rep, 26) + repLoss);
    pushLog(s, `📜 今日合同未达成：${c.emoji} ${c.name}（口碑 ${repLoss}）`);
  } else {
    pushLog(s, `📜 今日合同未达成：${c.emoji} ${c.name}`);
  }
  return { id: c.id, name: c.name, emoji: c.emoji, ok, cash: ok ? c.cash : 0, rep: ok ? 0 : repLoss };
}

/** 门槛换算：比例类（满意率）不能跟着缩放，否则 0.92×1.22 > 1 永远不可能达成 */
function scaledGoal(c, k) {
  const g = num(c.goal, 1);
  if (c.metric === 'sat') return g;              /* 满意率是比例，难度不该动它 */
  return g * k;
}

/* ---------------- 营业中两个即时决策（V2）----------------
 * 26 秒营业原本只有"点点工位"一种操作 —— 全程看队列移动、点什么加速，
 * 没有任何策略空间。这两个动作各每天一次，给的是**时机判断**：
 *   限时促销：客流 ×1.6 持续 8 秒，代价是那段时间每杯收入 -¥2
 *             （"看客流不对就促销清一波库存"）
 *   临时下架：下架今天卖得最差的那款（"备货押错了，及时止损"）
 */
function saleActive(s) {
  return !!(s.sim && s.sim.t < s.sim.saleUntil);
}
function flashSale(s) {
  if (!s.sim || s.phase !== 'open') return { ok: false, msg: '只有营业中才能促销' };
  if (s.sim.saleUsed) return { ok: false, msg: '今天的促销已经用过了' };
  if (s.sim.closing) return { ok: false, msg: '已经打烊清场，卖不动了' };
  s.sim.saleUsed = true;
  s.sim.saleUntil = s.sim.t + CFG.SALE_SECONDS;
  /* 上限也要抬：只提速不抬总量等于"把后面的客人提前叫来"，玩家白亏 */
  s.sim.saleCap = Math.round(Math.max(s.sim.traffic, num(s.sim.spawned, 0)) * 1.2);
  pushLog(s, `📣 限时促销 ${CFG.SALE_SECONDS} 秒：客流 ×${CFG.SALE_TRAFFIC}，每杯 -${money(CFG.SALE_UNIT_SUB)}`);
  return { ok: true, seconds: CFG.SALE_SECONDS };
}
function pullMenu(s) {
  if (!s.sim || s.phase !== 'open') return { ok: false, msg: '只有营业中才能临时下架' };
  if (s.sim.pulled) return { ok: false, msg: '今天已经下架过一款了' };
  const menu = arr(s.menu);
  if (menu.length <= 1) return { ok: false, msg: '菜单里只剩一款了，不能再撤' };
  const sold = s.sim.byRecipe || {};
  /* 挑今天卖得最少的（没卖过算 0）；并列时取靠后那道，改动更"止损" */
  let worst = null, worstC = Infinity;
  for (const rid of menu) {
    const c = num(sold[rid], 0);
    if (c < worstC) { worstC = c; worst = rid; }
  }
  if (!worst) return { ok: false, msg: '没有可下架的配方' };
  s.menu = menu.filter(r => r !== worst);
  s.sim.pulled = worst;
  const rec = recipeById(worst);
  pushLog(s, `📥 临时下架 ${rec ? rec.emoji + rec.name : worst}（今天只卖了 ${worstC} 杯）`);
  return { ok: true, id: worst, name: rec ? rec.name : worst, emoji: rec ? rec.emoji : '🥤', sold: worstC };
}
/** 营业中 HUD 用：两个按钮的可用状态 */
function openOps(s) {
  if (!s.sim || s.phase !== 'open') return null;
  const on = saleActive(s);
  return {
    sale: { used: !!s.sim.saleUsed, active: on, left: Math.max(0, Math.ceil(s.sim.saleUntil - s.sim.t)) },
    pull: { used: !!s.sim.pulled, id: s.sim.pulled || null },
  };
}

/** 备货页展示用：当前合同 + 实时进度（营业中也能看到自己走到哪了） */
function contractView(s) {
  const c = s.contract && contractById(s.contract.id);
  if (!c) return null;
  const sc = contractScale(s);
  const m = contractMetrics(s);
  const g = scaledGoal(c, sc.goal);
  /* 单指标型合同才能给进度条；双条件型只给完成态 */
  const single = (c.metric === 'cups' || c.metric === 'orders' || c.metric === 'revenue'
    || c.metric === 'clicks' || c.metric === 'trend' || c.metric === 'net');
  const raw = single ? num(m[c.metric === 'trend' ? 'trendCups' : c.metric], 0) : null;
  /* desc 里的数字要跟缩放后的门槛一致，否则备货页写的和实际判定对不上 */
  const shown = c.metric === 'sat' ? c.desc
    : c.desc.replace(String(c.goal), String(Math.round(g * 100) / 100));
  return {
    id: c.id, emoji: c.emoji, name: c.name, desc: shown,
    cash: c.cash, failRep: Math.round(num(c.failRep, -3) * sc.penalty), done: !!s.contract.done,
    goal: c.metric === 'sat' ? c.goal : Math.round(g * 100) / 100,
    unit: c.unit || '', prefix: c.prefix || '',
    prog: raw, ratio: single && g > 0 ? clamp(raw / g, 0, 1) : (s.contract.done ? 1 : 0),
  };
}

/* ============================================================
 *  第二批玩法系统（V5~V8）
 *  数据表在 js/data.js（STAGES / STAGE_DIFFS / SIGNATURE_TIERS /
 *  SPECIAL_CUSTOMERS / ENDING_AXES），这里只放逻辑。
 * ============================================================ */

/* ---------------- V5 章节关卡 ----------------
 * 30 天切成 6 章（每章 5 天），每章 3 个关卡按顺序打通。
 * 与每日合同（V1）的时间尺度不同：合同是「今天凑什么」，一天一换；
 * 关卡是「这一章要闯哪几关」，跨 5 天推进 —— 中期目标。
 *
 * 难度档在**备货阶段**选（开门前就知道），打烊时结算。
 * 失败**不扣口碑**（只扣奖励）—— 这是刻意的：第一批的合同违约扣口碑会复利
 * （违约→口碑跌→客流少→更违约），把 hard 拖进死循环。关卡失败只是
 * 「这一关没过」，没有连锁惩罚，玩家敢挑高难度才有意思。
 */
function stageById(id) { return STAGES.find(x => x.id === id) || null; }
function stageDiffById(id) { return STAGE_DIFFS.find(x => x.id === id) || STAGE_DIFFS[0]; }

/** 当前是第几章（1 起）。第 30 天属于第 6 章。 */
function chapterOf(s) {
  return clamp(Math.floor((num(s.day, 1) - 1) / STAGE_DAYS) + 1, 1, STAGE_CHAPTERS);
}
/** 本章的三个关卡（按 order 升序） */
function chapterStages(s) {
  const ch = chapterOf(s);
  return STAGES.filter(x => x.chapter === ch).sort((a, b) => a.order - b.order);
}
/** 玩家已通过的关卡 id 集合（跨章节累计） */
function stageDoneSet(s) {
  const raw = s.stage && s.stage.done;
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const k of Object.keys(raw)) if (stageById(k)) out[k] = true;
  }
  return out;
}
/** 当前待打的关卡：本章第一个没打通的。全打通了就返回 null（本章已通关） */
function currentStage(s) {
  const done = stageDoneSet(s);
  const list = chapterStages(s);
  for (const st of list) if (!done[st.id]) return st;
  return null;
}
/**
 * 关卡门槛的缩放。
 * 三层：① 难度档（玩家选的）② 游戏难度（easy/normal/hard）③ 天数成长。
 * 比例型指标（sat）**不跟着难度缩放** —— 0.9×1.2 = 1.08 永远不可能达成
 * （第一批合同已经踩过这个坑，见 scaledGoal 的注释）。
 * 「越少越好」型（lost）方向相反：门槛是流失上限，缩放要反向 ——
 * 难度越高，能容忍的流失越少，所以 goal 越缩越小才对（这里用 1/k）。
 */
function stageGoalOf(s, st, diff) {
  if (!st) return 0;
  const d = diffOf(s);
  let g = num(st.goal, 1);
  if (st.metric === 'sat') {
    /* 比例型：只吃难度档的微量加成，且封顶 0.99 */
    g = Math.min(0.99, g + (num(diff.goalMul, 1) - 1) * 0.02);
  } else if (st.metric === 'lost') {
    /* 上限型：难度越高允许流失越少 */
    g = Math.max(0, Math.round(g / Math.max(1, num(diff.goalMul, 1))));
  } else {
    g = g * num(diff.goalMul, 1);
  }
  /* 游戏难度缩放：easy 门槛低、hard 门槛高（但只吃一档，避免 hard 完全打不动） */
  const gd = num(d.stageGoal, 1);
  if (st.metric !== 'sat') g = st.metric === 'lost' ? Math.max(0, Math.round(g / gd)) : g * gd;
  /* 天数成长：越到后期目标越高（一天的量本来就更大） */
  const t = 1 + Math.max(0, num(s.day, 1) - 1) * 0.012;
  if (st.metric !== 'sat') g = g * t;
  return st.metric === 'sat' ? Math.round(g * 1000) / 1000 : Math.max(1, Math.round(g));
}
/**
 * 关卡奖励。
 * **必须压得很低**：关卡每天最多结算一次，30 天 18 关全通也只有
 * 18 × 平均 ~¥110 ≈ ¥2000，摊到每天不到合同的 1/3 —— 合同是「每天都会发的钱」，
 * 关卡是「阶段性的、更难拿到的钱」。如果这里给到和合同同量级，
 * 标准难度的达标率会被悄悄抬上去（第一批的教训 1）。
 */
function stageCashOf(s, st, diff) {
  if (!st) return 0;
  return Math.round(num(st.cash, 0) * num(diff.cashMul, 1));
}

/** 选关卡难度（备货阶段）。只能改难度，不能换关卡 —— 换关卡会让"专精"失去意义。 */
function setStageDiff(s, diffId) {
  const d = stageDiffById(diffId);
  if (!s.stage) s.stage = {};
  s.stage.diff = d.id;
  return { ok: true, diff: d.id };
}

/** 打烊结算关卡：达标发钱，不达标无惩罚。返回结算结果供日报展示。 */
function settleStage(s) {
  const st = currentStage(s);
  if (!st) return null;
  const diff = stageDiffById(s.stage && s.stage.diff);
  const m = contractMetrics(s);
  const g = stageGoalOf(s, st, diff);
  /* 判定口径与合同一致：走同一份当日指标快照 */
  let prog = 0;
  if (st.metric === 'sat') prog = m.sat;
  else if (st.metric === 'lost') prog = m.lost;
  else if (st.metric === 'infl') prog = m.typeServed.influencer || 0;
  else if (st.metric === 'trend') prog = m.trendCups;
  else prog = num(m[st.metric], 0);

  const ok = st.metric === 'lost' ? prog <= g : prog >= g;
  const cash = ok ? stageCashOf(s, st, diff) : 0;
  if (ok) {
    s.cash += cash;
    if (!s.stage) s.stage = {};
    if (!s.stage.done) s.stage.done = {};
    s.stage.done[st.id] = true;
    s.stats.stageCash = (s.stats.stageCash || 0) + cash;
    pushLog(s, `🏔️ 关卡达成：${diff.emoji}${st.name}（${diff.name}） +${money(cash)}`);
  } else {
    pushLog(s, `🏔️ 关卡未达成：${st.name}（${diff.name}） · ${st.desc.replace('{g}', g)}`);
  }
  return {
    id: st.id, name: st.name, emoji: st.emoji, diff: diff.id, diffName: diff.name,
    diffEmoji: diff.emoji, goal: g, prog: Math.round(prog * 100) / 100, ok, cash,
    desc: st.desc.replace('{g}', g),
  };
}

/** 备货页展示用：当前章节 + 待打关卡 + 难度选择 */
function stageView(s) {
  const ch = chapterOf(s);
  const list = chapterStages(s);
  const done = stageDoneSet(s);
  const cur = currentStage(s);
  const diff = stageDiffById(s.stage && s.stage.diff);
  const cleared = list.filter(x => done[x.id]).length;
  /* 本章全通 → 展示"本章已通关"，引导玩家往下一章走 */
  const chapterDone = list.length > 0 && cleared >= list.length;
  return {
    chapter: ch, chapterCount: STAGE_CHAPTERS, cleared, total: list.length,
    chapterDone, chapterProgress: list.length ? cleared / list.length : 0,
    stages: list.map(x => ({
      id: x.id, name: x.name, emoji: x.emoji, desc: x.desc, done: !!done[x.id],
      current: cur && cur.id === x.id,
    })),
    cur: cur ? {
      id: cur.id, name: cur.name, emoji: cur.emoji,
      desc: cur.desc.replace('{g}', stageGoalOf(s, cur, diff)),
      goal: stageGoalOf(s, cur, diff), cash: stageCashOf(s, cur, diff),
      metric: cur.metric, unit: cur.unit || '', prefix: cur.prefix || '',
    } : null,
    diffs: STAGE_DIFFS.map(d => ({
      id: d.id, name: d.name, emoji: d.emoji, star: d.star,
      cur: d.id === diff.id,
      goal: cur ? stageGoalOf(s, cur, d) : 0,
      cash: cur ? stageCashOf(s, cur, d) : 0,
    })),
    diffId: diff.id,
  };
}

/* ---------------- V6 招牌配方 ----------------
 * 某款配方的**累计**卖出杯数跨局继承，逐级解锁永久加成。
 * 累计量存在 META.sig（跨局），本局进度存在 s.sigRun。
 *
 * 为什么不存本局：每局清零就没有"攒"的动机，玩家不会有"这局专门练芋泥"的策略。
 * 跨局累计才让「单品爆款」与「全菜单均衡」成为两条真正不同的路线。
 *
 * 加成是**乘性/小额**的（销量权重 / 售价 / 每杯成本），不额外发钱 ——
 * 这是第一批教训 1 的直接应用：往经济里加"每天都会发的钱"会偷改难度。
 */
function sigTierOf(cups) {
  const n = num(cups, 0);
  let lv = 0, tier = null;
  for (const t of SIGNATURE_TIERS) {
    if (n >= t.cups) { lv = t.lv; tier = t; }
  }
  return { lv, tier };
}
/** 某配方的累计销量（跨局基线 + 本局新增） */
function sigCupsOf(s, rid) {
  const base = (s.sig && s.sig[rid]) || 0;
  const run = (s.sigRun && s.sigRun[rid]) || 0;
  return num(base, 0) + num(run, 0);
}
/** 某配方当前等级 */
function sigLevelOf(s, rid) {
  return sigTierOf(sigCupsOf(s, rid));
}
/** 某配方累计卖出（completeOrder 里调用） */
function addSigCups(s, rid, cups) {
  if (!rid) return;
  if (!s.sigRun) s.sigRun = {};
  s.sigRun[rid] = num(s.sigRun[rid], 0) + num(cups, 0);
}
/** 招牌等级带来的销量权重加成（乘在 pop 上） */
function sigSaleMul(s, rid) {
  const t = sigLevelOf(s, rid).tier;
  return t ? 1 + num(t.saleMul, 0) : 1;
}
/** 招牌等级带来的售价加成（元） */
function sigPriceAdd(s, rid) {
  const t = sigLevelOf(s, rid).tier;
  return t ? num(t.priceAdd, 0) : 0;
}
/** 招牌等级带来的每杯成本减免（元） */
function sigCostCut(s, rid) {
  const t = sigLevelOf(s, rid).tier;
  return t ? num(t.costCut, 0) : 0;
}
/** 备货页 / 研发页展示用：全部配方的招牌进度 */
function sigViews(s) {
  const out = [];
  for (const r of RECIPES) {
    const cups = sigCupsOf(s, r.id);
    const { lv, tier } = sigTierOf(cups);
    const next = SIGNATURE_TIERS.find(t => t.cups > cups) || null;
    out.push({
      id: r.id, name: r.name, emoji: r.emoji, cups: Math.round(cups), lv,
      tierName: tier ? tier.name : '', tierEmoji: tier ? tier.emoji : '',
      desc: tier ? tier.desc : '尚未成为招牌（累计卖出 60 杯解锁）',
      nextCups: next ? next.cups : 0,
      ratio: next ? clamp(cups / next.cups, 0, 1) : 1,
      maxed: !next,
    });
  }
  return out;
}

/* ---------------- V7 事件型顾客 ----------------
 * 现有 5 种顾客只是权重，玩家视角里"都是排队的小人"。这里加 3 种**可识别**的
 * 特殊顾客：营业中随机出现，脸上一眼能认出来，服务他们有明确回报或代价。
 *
 * 概率极低（每天最多来 2 位），稀有款（critic）只在当天第 1 位顾客时判定 ——
 * 不然一天来好几个"评论家"就不稀有了。
 */
function specialById(id) { return SPECIAL_CUSTOMERS.find(x => x.id === id) || null; }

/** 抽一个特殊顾客类型；返回 null 表示今天不出。
 *  配额：每天最多 1 位（specialCount 上限），critic 只可能占这一位。
 *  配额从 2 降到 1 是平衡修正（见 data.js SPECIAL_CUSTOMERS 的说明）：
 *  顶替常规顾客的机制在产能紧张时是净亏，出现的频率越高、伤害越大。
 *
 *  ★ 改成「额外到店」后，critic 的 rare 判定也放宽了：
 *    以前"当天第 1 位顾客"是按常规客流计数，特殊顾客插在前面会占掉这个位置；
 *    现在特殊顾客是**额外**的，判定改用「今天还没出过特殊顾客」——
 *    于是「今天的第 1 位特殊顾客」可以是 critic。 */
function pickSpecialType(s) {
  const sim = s.sim;
  if (!sim) return null;
  if (num(sim.specialCount, 0) >= 1) return null;
  const first = num(sim.specialCount, 0) <= 0;
  const pool = SPECIAL_CUSTOMERS.filter(t => !t.rare || first);
  if (!pool.length) return null;
  const t = weightedPick(pool, x => num(x.weight, 0));
  if (!t) return null;
  sim.specialCount = num(sim.specialCount, 0) + 1;
  return t;
}

/* ---------------- V8 结局四维评级 ----------------
 * 现有结局只看「净资产/目标」一个维度，S 级只有一种拿法。
 * 这里按利润/口碑/服务/经营四维各评一个称号，让「同一个 S 级有多种拿法」。
 *
 * 阈值按**难度目标**归一化（不是写死绝对数）：hard 的目标高、cup 数自然多，
 * 写死绝对阈值会让 hard 永远拿不到「连锁巨头」。
 */
function endingAxes(s) {
  const d = diffOf(s);
  const st = s.stats || {};
  const revenue = num(st.totalRevenue, 0);
  const profit = num(st.totalProfit, 0);
  const served = num(st.totalServed, 0);
  const lost = num(st.totalLost, 0);
  const total = served + lost;
  /* 零样本时满意率取 0 而不是 1 —— 「一个人都没服务过」不等于「五星好评」。
     早期版本兜底成 1，结果破产局（0 单 0 流失）会在结局页拿到
     "服务·五星好评"这种自相矛盾的称号。 */
  const sat = total > 0 ? served / total : 0;
  const goal = num(goalOf(s), 1);
  const values = {
    profit: revenue > 0 ? profit / revenue : 0,
    rep: num(s.rep, 0),
    service: sat,
    /* 经营维度 = 累计卖出杯数（规模）。
       为什么用**固定**杯数而不是按难度归一化：
       实测（tools/sim.js 逐日中位数累加）三档难度的累计总杯数其实很接近 ——
         easy ~2700 / normal ~2644 / hard ~3020
       难度的差异体现在**单杯利润**（目标金额不同）而不是杯数，
       所以按目标金额去缩放杯数门槛是错的方向：
         ① 早期版本按 goal/300 归一化，算出 normal 要 76000 杯 —— 永远达不到
         ② 反过来（难度高门槛低）会让 easy 比 hard 更容易拿"连锁巨头"，也不对
       固定阈值最直观：1500 杯 = 街角名店（约 55% 的玩家能达到），
       3000 杯 = 连锁巨头（约 20~30%，需要认真扩张）。 */
    scale: num(st.totalCups, 0),
  };
  const out = [];
  for (const ax of ENDING_AXES) {
    const v = num(values[ax.key], 0);
    let tier = 0, title = null;
    for (let i = 0; i < ax.tiers.length; i++) {
      if (v >= num(ax.tiers[i].need, Infinity)) { tier = i + 1; title = ax.tiers[i]; }
    }
    out.push({
      key: ax.key, name: ax.name, emoji: ax.emoji, tier, value: v,
      title: title ? title.title : null, desc: title ? title.desc : '未达称号线',
    });
  }
  return out;
}
/** 综合称号：取四维里最高的一档作为主称号 */
function endingTitle(s) {
  const axes = endingAxes(s);
  let best = null;
  for (const a of axes) {
    if (a.tier > 0 && (!best || a.tier > best.tier)) best = a;
  }
  return { axes, best };
}

/* ============================================================
 *  经营维度：场地类型 / 经营城市 / 经营地图位置
 *
 *  与本文件其它"玩家可选属性"的写法保持一致：纯函数 + 返回 {ok,msg}，
 *  UI 决定怎么提示。这里不碰 DOM / storage，小游戏端可直接复用。
 *
 *  校验分三层（与"可配置字典 + 弱地理校验"的定位匹配）：
 *    ① **白名单**：场地类型 / 省市 id 必须存在于字典 —— 挡存档篡改与字典下线
 *    ② **结构**：区级 id 必须是 6 位数字，且其前缀必须等于所属城市 id
 *    ③ **地理**：经纬度必须落在 GEO 的境内包围盒内（弱校验，只挡离谱错值）
 *  坐标系固定 GCJ-02（高德），存/取都不做转换 —— 转换只能在边界层显式发生。
 * ============================================================ */

/** 省市区 id 形态：省 2 位、市 6 位、区 6 位（GB/T 2260 前 2 位为省、中 2 位为市） */
function isRegionId(id, digits) {
  const s = String(id == null ? '' : id);
  if (s.length !== digits || !/^\d+$/.test(s)) return false;
  return true;
}

/** 坐标合法性：必须在境内包围盒内。返回规范化后的 {lng,lat} 或 null */
function normalizeGeo(raw) {
  const src = obj(raw);
  const lng = Number(src.lng), lat = Number(src.lat);
  /* 先判有限数再判范围：NaN / Infinity 会被范围比较放行（NaN 的所有比较都是 false），
     所以必须先单独挡掉，否则 NaN 会一路存进存档。 */
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < GEO.MIN_LNG || lng > GEO.MAX_LNG) return null;
  if (lat < GEO.MIN_LAT || lat > GEO.MAX_LAT) return null;
  /* 保留固定小数位：超过 6 位是 GPS 芯片噪声，不是精度 */
  const r = n => Number(n.toFixed(GEO.PRECISION));
  return { lng: r(lng), lat: r(lat) };
}

/** 经营地图位置（含坐标 + 坐标系标识）。coordSys 是**显式冗余**，防将来混用。 */
function geoView(raw) {
  const g = normalizeGeo(raw);
  return g ? { lng: g.lng, lat: g.lat, coordSys: GEO.COORD_SYS } : null;
}

/** 设置经营坐标。validateCity 可选：传入城市 id 时同时校验「选了城市才允许定位」 */
function setGeo(s, raw, cityId) {
  const g = normalizeGeo(raw);
  if (!g) return { ok: false, msg: `坐标无效：须为 ${GEO.COORD_SYS}（高德）口径，且经度 ${GEO.MIN_LNG}~${GEO.MAX_LNG}、纬度 ${GEO.MIN_LAT}~${GEO.MAX_LAT}` };
  const cid = cityId == null ? (s.venue && s.venue.cityId) : cityId;
  if (cid && !cityById(cid)) return { ok: false, msg: '请先选择有效的经营城市' };
  if (!s.venue) s.venue = {};
  s.venue.lng = g.lng;
  s.venue.lat = g.lat;
  s.venue.coordSys = GEO.COORD_SYS;
  return { ok: true, geo: geoView(g) };
}

/** 清除经营坐标（回到「未选点」） */
function clearGeo(s) {
  if (!s.venue) s.venue = {};
  delete s.venue.lng;
  delete s.venue.lat;
  delete s.venue.coordSys;
  return { ok: true };
}

/**
 * 城市中心坐标（GCJ-02）。给「定位当前城市」用 ——
 * 等价于"先按市中心记一个位置，之后可再用地图选点精确到店"。
 *
 * 未收录的城市返回**空**而不是编一个假坐标：
 * 假坐标会让门店看起来"已经定位在某处"，而实际什么都不知道。
 */
function cityGeoOf(cityId) {
  const c = CITY_CENTERS[cityId];
  if (!c || !Number.isFinite(c.lng) || !Number.isFinite(c.lat)) return null;
  return { lng: c.lng, lat: c.lat };
}

/** 把坐标记成「所选城市的市中心」。城市没有中心坐标时直接拒绝，不写脏值。 */
function setGeoToCityCenter(s) {
  const v = s.venue || {};
  const g = cityGeoOf(v.cityId);
  if (!g) return { ok: false, msg: '该城市暂无中心坐标，请在地图上选点' };
  return setGeo(s, g, v.cityId);
}

/* ---- 「下一项」循环切换（小游戏端触屏交互用，H5 走 <select>）----
 * 列表长（272 个市）时，"点一下切下一个"是触屏上唯一省事的做法：
 * 弹层选择器要多一次点击、还容易被遮罩误触。
 */

/** 场地类型：切到下一种（到末尾回到第一种） */
function nextVenueType(s) {
  const i = VENUE_TYPES.findIndex(t => t.id === ((s.venue || {}).type));
  const t = VENUE_TYPES[(i + 1 + VENUE_TYPES.length) % VENUE_TYPES.length];
  if (!t) return { ok: false, msg: '没有可用的场地类型' };
  setVenueType(s, t.id);
  return { ok: true, type: t.id, name: t.name, emoji: t.emoji };
}

/** 省级：切到下一个省，并把市带成该省第一个市（否则省市区会不一致） */
function nextProvince(s) {
  const i = PROVINCES.findIndex(p => p.id === ((s.venue || {}).provId));
  const p = PROVINCES[(i + 1 + PROVINCES.length) % PROVINCES.length];
  const first = p && citiesOfProvince(p.id)[0];
  if (!p || !first) return { ok: false, msg: '没有可用的城市' };
  const r = setVenueCity(s, first.id);
  return r.ok ? { ok: true, provId: p.id, cityName: first.name } : r;
}

/** 市级：在**当前省内**循环切换 */
function nextCity(s) {
  const v = s.venue || {};
  const list = citiesOfProvince(v.provId);
  if (!list.length) return { ok: false, msg: '该省暂无可选城市' };
  const i = list.findIndex(c => c.id === v.cityId);
  const c = list[(i + 1 + list.length) % list.length];
  const r = setVenueCity(s, c.id);
  return r.ok ? { ok: true, cityId: c.id, cityName: c.name } : r;
}

/** 区级：在**当前市内**循环切换（含「不指定」）。城市没有区级数据时拒绝。 */
function nextDistrict(s) {
  const v = s.venue || {};
  const list = districtsOfCity(v.cityId);
  if (!list.length) return { ok: false, msg: '该城市暂未收录区级（可选仅到市级）' };
  const opts = [{ id: '', name: '不指定' }].concat(list);
  const i = opts.findIndex(d => (d.id || '') === (v.districtId || ''));
  const d = opts[(i + 1 + opts.length) % opts.length];
  const r = setVenueCity(s, v.cityId, d.id || '');
  return r.ok ? { ok: true, districtId: d.id || '', districtName: d.name } : r;
}

/**
 * 设置经营场地类型。
 * 未知 id 一律拒绝（不静默回退）—— 调用方是 UI，回退会让玩家以为自己选中了。
 * 老存档的清洗在 sanitizeVenue 里做（那里**必须**回退，不能拒绝）。
 */
function setVenueType(s, id) {
  const v = venueTypeById(id);
  if (!v) return { ok: false, msg: '未知的场地类型' };
  if (!s.venue) s.venue = {};
  s.venue.type = v.id;
  return { ok: true, type: v.id, name: v.name, emoji: v.emoji };
}

/**
 * 设置经营城市（省市区）。
 * 省与市**都要校验**，且市必须属于所选省 —— 只校验其中一半会让
 * 「省=江苏 / 市=北京」这种组合写进存档，UI 上三级联动会显示不出来。
 * 区级可选：有值才校验，且前缀必须匹配城市 id。
 */
function setVenueCity(s, cityId, districtId) {
  const c = cityById(cityId);
  if (!c) return { ok: false, msg: '请选择有效的经营城市（限中国大陆）' };
  let did = districtId == null || districtId === '' ? null : String(districtId);
  if (did != null) {
    if (!isRegionId(did, 6)) return { ok: false, msg: '区级代码格式不正确' };
    /* 区前缀必须等于城市 id（GB/T 2260：前 4 位是市，前 2 位是省），
       否则「市=北京(1101) / 区=上海某区(3101xx)」这种错配会静默通过 */
    /* 区代码与市代码的关系：市代码 6 位（区代码的前 4 位 + 顺序码 2 位）。
       GB/T 2260 里市代码是 6 位（如 深圳市 440300），而区代码是 6 位，
       两者**前 4 位相同**（4403 = 省44 + 市03）。所以比对前 4 位。
       写成整等比较会因为市代码多两位而永远不匹配 —— 区级会被静默丢弃。 */
    if (did.slice(0, 4) !== c.id.slice(0, 4)) return { ok: false, msg: '区级与所选城市不匹配' };
  }
  if (!s.venue) s.venue = {};
  s.venue.provId = c.prov;
  s.venue.cityId = c.id;
  if (did == null) delete s.venue.districtId;
  else s.venue.districtId = did;
  /* 换城市后旧坐标必然对不上新城区，直接清掉而不是留着自相矛盾 */
  if (s.venue.lng != null) clearGeo(s);
  return { ok: true, provId: c.prov, cityId: c.id, districtId: did };
}

/** 经营维度的展示模型（给 UI 用，含名称与是否已选点） */
function venueView(s) {
  const v = s.venue || {};
  const t = venueTypeById(v.type) || venueTypeById(VENUE_DEFAULT) || null;
  const p = provinceById(v.provId) || null;
  const c = cityById(v.cityId) || cityById(CITY_DEFAULT) || null;
  const d = v.districtId ? (districtsOfCity(c && c.id).find(x => x.id === v.districtId) || null) : null;
  const g = geoView({ lng: v.lng, lat: v.lat });
  return {
    type: t ? t.id : null, typeName: t ? t.name : '', typeEmoji: t ? t.emoji : '🏘️',
    typeDesc: t ? t.desc : '',
    provId: p ? p.id : null, provName: p ? p.name : '',
    cityId: c ? c.id : null, cityName: c ? c.name : '',
    districtId: d ? d.id : null, districtName: d ? d.name : '',
    hasDistrictData: districtsOfCity(c && c.id).length > 0,
    geo: g, hasGeo: !!g,
    coordSys: GEO.COORD_SYS,
  };
}

/**
 * 经营维度的清洗 —— **存量数据兼容的关键入口**。
 *
 * 三种来源都会走到这里：
 *   ① 老存档（v2，早于本特性）—— 三个字段**完全不存在**
 *   ② 玩家手改/导入的脏存档 —— id 不在字典里、坐标越界、字段类型不对
 *   ③ 正常新存档 —— 原样通过
 *
 * 策略是「**缺失→补默认，非法→退默认，不抛错**」：
 *   存档是玩家自己的进度，一个不认识的场地类型不该让他打不开游戏。
 *   代价是丢一点点自定义数据，换来的是老存档 100% 可读 —— 这个取舍必须写明。
 *
 * 注意：这里**不校验版本号**（importSave 认的是 s.v === 2，且不该为此升版本 ——
 * 升版本会让所有存量存档直接失效，正是我们要避免的）。
 */
function sanitizeVenue(raw) {
  const src = obj(raw);
  const out = {};
  // ① 场地类型：不在字典 → 退默认（社区）
  out.type = venueTypeById(src.type) ? String(src.type) : VENUE_DEFAULT;
  // ② 城市：**以城市为准，省只是冗余字段**。
  //    城市更具体（一个城市只属于一个省），所以：
  //      a) 城市有效 → 省直接取城市的 prov。这样「只有城市没有省」的半截字段
  //         能被救回来，而不是像"省市区错配"那样整条退默认 ——
  //         省是冗余的，城市对了省就一定能推出来，没必要丢弃用户数据。
  //      b) 城市无效 → 退默认（北京）。单独存在的省没有意义，无法确定城市。
  const c = cityById(src.cityId);
  if (c) {
    out.provId = c.prov;
    out.cityId = c.id;
  } else {
    out.provId = CITY_DEFAULT.slice(0, 2);
    out.cityId = CITY_DEFAULT;
  }
  // ③ 区级：可选。有值才校验格式 + 前缀；不合法就当没填（不影响省市）
  const did = src.districtId == null || src.districtId === '' ? '' : String(src.districtId);
  if (did && isRegionId(did, 6) && did.slice(0, 4) === out.cityId.slice(0, 4)) out.districtId = did;
  // ④ 坐标：缺失/非法 → 不写 lng/lat（表示"未选点"），而不是写 0（0,0 在公海）
  const g = normalizeGeo({ lng: src.lng, lat: src.lat });
  if (g) {
    out.lng = g.lng;
    out.lat = g.lat;
    out.coordSys = GEO.COORD_SYS;
  }
  return out;
}

/* ============================================================
 *  V9 菜系（Cuisine）与制作工坊（Craft Workshop）
 *
 *  设计要点（与前两批的教训直接相关）：
 *   ① 工坊是**生产资质**而非数值加成 —— 没有工坊，该菜系配方**不能上架**。
 *      硬约束的好处是它**不改经济总量**（不像给全局加成会偷改难度曲线，
 *      第一批教训 1），却照样能形成中期决策。
 *   ② 硬约束必须在**引擎入口**拦住（toggleMenu / canResearch），
 *      不能只靠 UI 隐藏按钮 —— 否则改存档或直接调函数就能上架做不出的东西。
 *   ③ 菜系加成全部走**销量权重**（谁被选中的概率），不动价格与成本，
 *      避免与招牌配方（V6）的加成在同一个维度上叠乘失控。
 * ============================================================ */

/** 该菜系的工坊等级（0 = 没建，做不出该系产品） */
function workshopLevel(s, cuisineId) {
  const ws = s.workshops && s.workshops[cuisineId];
  return clamp(int(ws, 0), 0, 3);
}

/** 升级到下一级工坊的成本；已满级返回 null */
function workshopCost(s, cuisineId) {
  const w = workshopById(cuisineId);
  if (!w) return null;
  const lv = workshopLevel(s, cuisineId);
  if (lv >= w.cost.length - 1) return null;
  const raw = w.cost[lv + 1];
  /* ★ 工坊造价**不跟 difficulty.costMult 走**：
       那个系数是给「进货 / 研发 / 升级」用的 —— 难度高时东西更贵，
       但**工坊带来的收益与难度无关**（同样是 +8% 销量权重、同样解锁一款配方）。
       若也跟着 ×1.15，hard 玩家就是「花更多钱换同样的东西」，
       实测 hard 达标率被拖掉 9pp（78%→69%），等于给最难的难度又加了一道坎。
       这里改用独立的系数：工坊是「扩张」不是「进货」，
       难度高时反而该**便宜些**（hard 现金流本来就紧）。 */
  const d = diffOf(s);
  const scale = d.key === 'hard' ? 0.85 : (d.key === 'easy' ? 0.9 : 1);
  return Math.round(raw * scale);
}

/** 建造/升级工坊。Lv.1 只开线，不附带别的动作。 */
function buildWorkshop(s, cuisineId) {
  const w = workshopById(cuisineId);
  if (!w) return { ok: false, msg: '没有这个工坊' };
  const c = workshopCost(s, cuisineId);
  if (c == null) return { ok: false, msg: '该工坊已满级' };
  if (s.cash < c) return { ok: false, msg: '现金不足' };
  s.cash -= c;
  s.invested += c;
  if (!s.workshops) s.workshops = {};
  s.workshops[cuisineId] = workshopLevel(s, cuisineId) + 1;
  pushLog(s, `🏭 ${w.emoji} ${w.name} 升至 Lv.${s.workshops[cuisineId]}`);
  return { ok: true, level: s.workshops[cuisineId], cost: c };
}

/**
 * 该菜系的研发费折扣（工坊 Lv.1 就有）。
 * 这是工坊的**第一层收益**：先让这条产品线跑起来（研发更便宜）。
 */
function workshopResearchCut(s, cuisineId) {
  const w = workshopById(cuisineId);
  if (!w) return 0;
  const lv = workshopLevel(s, cuisineId);
  if (lv < 1) return 0;
  return num(w.researchCut, 0);
}

/**
 * 该菜系工坊带来的**每杯成本下降比例**（工坊的**第二层收益，也是主力层**）。
 *
 * ★ 为什么必须有这一层（tools/diag-sweep.js 参数扫描给出的结论）：
 *   工坊原本只有「销量权重加成」，而权重是**相对量** —— 它只改变菜单内部
 *   各款的被选比例，不抬客流总量。扫了 8 倍（0.08→0.68），
 *   AI 依然**一次线都没开**（产线恒 1.00 条）：
 *     Day 30 日销约 71 杯，权重 +12% 只能把该系占比从 50% 拉到 56%
 *     （≈ 多卖 4 杯/天 ≈ ¥56/天），而 Lv.2 造价 ¥900 —— 20 天都赚不回来。
 *   成本下降是**绝对量**且**与销量无关**：每杯省 ¥0.7，卖 71 杯就省 ¥50/天。
 *   「加成型收益」配「绝对量成本」，理性玩家永远不会买 —— 这是收益形态
 *   与成本形态不匹配，不是数值没调好。
 *
 * 比例作用在**原料成本**上（不含包装费）：包装是固定支出，产线省不了它。
 */
function workshopCostCut(s, cuisineId) {
  const w = workshopById(cuisineId);
  if (!w || !w.costCut) return 0;
  const lv = workshopLevel(s, cuisineId);
  if (lv < 1) return 0;
  return clamp(num(w.costCut[lv], 0), 0, 0.5);
}

/**
 * 该菜系高端款（tier3+）的销量权重加成 —— 工坊的**第四层收益**。
 *
 * ★ 这层收益改过两次形态，每次都被实测打回，记录在此免得又走回头路：
 *   ① 硬门槛（没工坊 → 不能做高端款）：❌ 6 款 tier3 解锁率 19/20 → 0/20
 *   ② 降门槛（Lv.3 → Lv.2）：❌ 依然 0/20
 *      病根是"门槛"本身 —— 理性玩家 30 天攒不出第二条线的钱，
 *      门槛就等于永久锁死 40% 配方表，且玩家根本不知道自己被锁了。
 *   ③ 纯加成（当前）：高端款一律可做，工坊满级给它 +18% 权重。
 *      「能不能做」归既有玩法，「做得好不好」才是 V9 —— 与 canListRecipe 同原则。
 *
 * 只有工坊 Lv.3（旗舰级，¥2000~2700）才给这层收益：
 * 既然不再把门关上，就必须让满级依然值得，否则没人升到顶。
 */
function workshopTier3Bonus(s, rid) {
  const r = recipeById(rid);
  if (!r || !r.cuisine || r.tier < 3) return 0;
  const w = workshopById(r.cuisine);
  /* ⚠️ 这里必须读 tier3Bonus（不是已改名的旧字段 tier3）——
     漏改过一次：字段从 tier3（所需等级）改成 tier3Bonus（加成数值）时，
     这一行没跟着改，于是旗舰加成恒为 0 —— 第四层收益**静默失效**，
     而所有"能不能做"的断言都照常通过（因为它不再是门槛了）。
     改名时全局搜旧名，比逐处记忆可靠。 */
  if (!w || !w.tier3Bonus) return 0;
  if (workshopLevel(s, r.cuisine) < 3) return 0;
  return num(w.tier3Bonus, 0.18);
}

/**
 * 该配方能不能上架。
 *
 * ★ 这里刻意**不做工坊硬约束**（初版是硬约束：没工坊就不能上架/研发），
 *   实测证明那是错的：
 *     · 硬约束让 11/14 款配方都多一道前置，研发曲线被拉长 ——
 *       玩家原本 Day2-3 就能研 2-3 款，现在要先攒够线 + 料 + 钱才能开第一条线；
 *     · 它让「不玩这个系统」变成**不能玩**（无工坊就没有菜单可上架），
 *       而玩法丰富度应该来自**可选深度**，不是强制门槛；
 *     · 配对实测 hard 难度被拖 11pp（76%→65%）。
 *   现在的设计：工坊是**可选的经营深度** ——
 *     开了 → 该系产品更抢手（销量权重）、能做更高端的款；
 *     不开 → 照常用旧配方，一切照旧。
 *   「能不能做」和「做得好不好」分开，前者是既有玩法，后者才是新维度。
 */
function canListRecipe(s, rid) {
  const r = recipeById(rid);
  if (!r) return { ok: false, msg: '没有这个配方' };
  return { ok: true };
}

/** 该菜系的工坊是否已开（用于 UI 提示：这条线开了没有） */
function hasWorkshop(s, cuisineId) {
  return workshopLevel(s, cuisineId) > 0;
}

/**
 * 菜系主打加成：菜单上同一菜系的配方越多，整体越畅销。
 * 与招牌配方（V6，单品维度）形成两条独立的取舍线：
 *   广度流 —— 每系都开一条线，客群覆盖全
 *   深度流 —— 只做一两个系，销量更集中
 */
function cuisineFocusBonus(s, cuisineId) {
  let n = 0;
  for (const rid of (s.menu || [])) {
    const r = recipeById(rid);
    if (r && r.cuisine === cuisineId) n++;
  }
  let bonus = 0, label = '';
  for (const f of CUISINE_FOCUS) {
    if (n >= f.need) { bonus = f.bonus; label = f.label; }
  }
  return { count: n, bonus, label };
}

/** 某配方的销量权重加成合计（工坊等级 + 菜系主打）
 *
 *  刻意用**加性**而不是乘性叠加：
 *    乘性的话，工坊满级(+30%) × 主打全系(+18%) = ×1.53，
 *    再叠招牌 Lv3(+20%) 就是 ×1.84 —— 单款几乎垄断整个菜单，
 *    玩家精心搭配的菜单结构被一个数字抹平了。
 *    加性叠加的上限是 30% + 18% + 20% = +68%，仍然明显，但不会归零其他款。
 *  另注：权重只改**同菜单内各款的相对被选概率**，不改客流总量 ——
 *    所以它不会抬高营收上限，只改变产品结构（做爆款 vs 走量）。 */
function cuisineWeightMul(s, rid) {
  const r = recipeById(rid);
  if (!r || !r.cuisine) return 1;
  const w = workshopById(r.cuisine);
  let add = 0;
  if (w) {
    const lv = workshopLevel(s, r.cuisine);
    add += (w.saleBonus && w.saleBonus[lv]) || 0;
  }
  /* V9 第三层：旗舰工坊（Lv.3）让高端款更好卖（原先是"没工坊就不能做"，
     已被实测证明是错的设计，见 workshopTier3Bonus 注释）。 */
  add += workshopTier3Bonus(s, rid);
  /* 主打加成单独走 cuisineFocusWeight（客流倾斜），不混进这里的权重 ——
     见该函数的注释：权重是相对量，专注单系时加成会直接归零。 */
  return 1 + add;
}

/**
 * 主打菜系的**客流倾斜**：该系整体吸引更多客人。
 *
 * ★ 为什么主打加成必须作用在【选品权重】而不是【菜单内相对权重】之外的地方：
 *   相对权重有个致命性质 —— 菜单里全是同一菜系时，每款都乘同一个系数，
 *   相对比例完全不变，加成直接**归零**。也就是"专注单一菜系"这条路线
 *   反而拿不到好处，而"菜单多样化"才有 —— 与设计意图正好相反
 *   （实测：专注 classic 净资产 ¥7921 / 破产 4/8，广度 ¥11028 / 破产 0/8）。
 *
 *   正确做法是让主打菜系在**选品池里占更大比重** —— 相当于这条产品线
 *   在门口更显眼。注意它仍然是**概率分配**而非凭空多出客人：
 *   客流总量由 trafficOf 决定，这里改的是「客人进门后选哪一杯」。
 */
function cuisineFocusWeight(s, rid) {
  const r = recipeById(rid);
  if (!r || !r.cuisine) return 1;
  const f = cuisineFocusBonus(s, r.cuisine);
  if (!f.bonus) return 1;
  /* bonus 6% / 12% / 18% → 权重放大 1.6 / 2.2 / 2.8。
     权重与占比的关系是 w/(Σw)，单款权重放大 k 倍 ≈ 该系占比放大 k 倍。
     放大系数要有上限，否则主打一款会把其他菜系彻底挤出菜单。 */
  return 1 + f.bonus * 10;
}

/** 备货页展示用：全部菜系的工坊状态与主打情况 */
function cuisineViews(s) {
  const out = [];
  for (const c of CUISINES) {
    const w = workshopById(c.id);
    const lv = workshopLevel(s, c.id);
    const focus = cuisineFocusBonus(s, c.id);
    const all = recipesOfCuisine(c.id);
    out.push({
      id: c.id, name: c.name, emoji: c.emoji, color: c.color, desc: c.desc,
      level: lv, maxLevel: w ? w.cost.length - 1 : 0,
      cost: workshopCost(s, c.id),
      saleBonus: w && w.saleBonus ? (w.saleBonus[lv] || 0) : 0,
      nextBonus: w && w.saleBonus ? (w.saleBonus[lv + 1] || 0) : 0,
      total: all.length,
      unlocked: all.filter(r => (s.recipes || []).includes(r.id)).length,
      focusCount: focus.count, focusBonus: focus.bonus, focusLabel: focus.label,
    });
  }
  return out;
}

/* ---------------- 存档（3 槽位 + 导入导出 + 降级提示） ---------------- */
let CUR_SLOT = 0;
let STORAGE_OK = true;          // 隐私模式 / 配额满时为 false，供 UI 提示
let STORAGE_ERR = '';

function slotKey(i) { return CFG.SAVE_PREFIX + i; }
/* CUR_SLOT 只经 setSlot 写入、那里已经夹过；这里再夹一次是零成本兜底，
   免得将来有人在别处直接动它。saltKey 拿到越界值会读写到不存在的键上。 */
function getSlot() { return clamp(CUR_SLOT | 0, 0, CFG.SAVE_SLOTS - 1); }
function setSlot(i) { CUR_SLOT = clamp(i | 0, 0, CFG.SAVE_SLOTS - 1); }

/* ============================================================
 *  存储访问层
 *  localStorage 在 iOS 隐私模式、配额写满、被策略禁用时**会抛异常**，
 *  而且每个方法抛的地方还不一样。原先这层保护散落在 saveGame / loadGame /
 *  slotInfo / clearSave / loadMeta / saveMeta 六处各写一遍 try/catch，
 *  还各自遗漏了不同的分支。统一到这里，保证「读写永远不抛，失败有据可查」。
 *
 *  存储后端是可插拔的：抖音小游戏等没有 localStorage 的宿主环境，
 *  在加载 engine.js **之前** 设好 globalThis.__BUBBLE_STORE 即可（见 platform.js）。
 *  这样 H5 版与小游戏版共用同一份 engine.js，不存在两份会漂移的存档逻辑。
 * ============================================================ */
let STORE = null;
function storeBackend() {
  if (STORE) return STORE;
  let injected = null;
  try { injected = globalThis && globalThis.__BUBBLE_STORE; } catch (e) { /* 忽略 */ }
  if (injected) { STORE = injected; return STORE; }

  /* 浏览器：先用一次探针确认真的可用（隐私模式下有对象却会抛） */
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.getItem('__bubble_probe__');
      STORE = {
        get: k => localStorage.getItem(k) || '',
        set: (k, v) => localStorage.setItem(k, v),
        remove: k => localStorage.removeItem(k),
      };
      return STORE;
    }
  } catch (e) { /* 落到内存后端 */ }

  /* 内存后端：进度不跨会话，但至少本局能正常玩，不会崩 */
  const mem = Object.create(null);
  STORE = {
    get: k => (k in mem ? mem[k] : ''),
    set: (k, v) => { mem[k] = String(v); },
    remove: k => { delete mem[k]; },
  };
  return STORE;
}

function markStorageOk() {
  if (!STORAGE_OK) { STORAGE_OK = true; STORAGE_ERR = ''; }
}
function markStorageFail(e) {
  STORAGE_OK = false;
  STORAGE_ERR = (e && e.name) ? e.name : 'unknown';
}
/** 写入：成功 true，失败 false 并记录原因（绝不向外抛） */
function storageSet(key, value) {
  try {
    storeBackend().set(key, value);
    markStorageOk();
    return true;
  } catch (e) {
    markStorageFail(e);
    return false;
  }
}
/** 读取：拿不到就返回 ''（调用方统一用 || 兜底） */
function storageGet(key) {
  try {
    return storeBackend().get(key) || '';
  } catch (e) {
    markStorageFail(e);
    return '';
  }
}
/** 删除：失败不抛，返回值仅供调用方判断 */
function storageRemove(key) {
  try {
    storeBackend().remove(key);
    return true;
  } catch (e) {
    markStorageFail(e);
    return false;
  }
}

function saveGame(s, slot) {
  if (!s) return false;
  if (slot != null) setSlot(slot);
  try {
    /* 原来用 JSON.parse(JSON.stringify(s)) 深拷贝，等于「序列化 + 反序列化 + 再序列化」三趟，
       而 history 最多 400 天、log 60 条 —— 手机上每 5 秒自动存一次能明显感到卡顿。
       改成对象展开做浅拷贝：顺手把体积最大的 s.sim 剔掉（它绝不该进存档），
       只跑一趟 stringify。嵌套对象虽然共享引用，但下一行立刻就序列化了，不存在被改的风险。 */
    return storageSet(slotKey(CUR_SLOT), JSON.stringify(snapshotState(s)));
  } catch (e) {
    markStorageFail(e);
    return false;
  }
}

/* ============================================================
 *  存档净化 —— 所有外部进入的 state 都必须先过这一层
 *  存档能被导出成字符串到处传，也能被手动改坏。不校验会出三类事故：
 *    1) null/undefined 混进算术 → 满屏 NaN，且 NaN 会随存档永久扩散；
 *    2) 类型不对（inv 是字符串、staff 是数字）→ 渲染时直接抛错白屏；
 *    3) 恶意字符串进入 innerHTML → XSS。
 *  这里做类型收敛 + 枚举白名单 + 字符串限长；渲染层另有 esc() 兜底，双保险。
 * ============================================================ */
function str(v, max) {
  if (typeof v !== 'string') v = (v === null || v === undefined) ? '' : String(v);
  v = v.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');   /* 去控制字符 */
  return v.length > max ? v.slice(0, max) : v;
}
function arr(v) { return Array.isArray(v) ? v : []; }
function obj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }

/**
 * 引擎内部拼 HTML 片段时用的转义。
 * 引擎是纯逻辑层，拿不到渲染层的 esc()，但 adviceOf() 这类函数会返回带 <b>
 * 标签的文案、里面还插着来自存档的对手名 —— 渲染层看到 <b> 就整段放行，
 * 于是存档里的 <img onerror> 会原样变成 DOM。这条规则必须和 ui.js 的 esc() 一致。
 */
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escText(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => ESC_MAP[c]);
}
function int(v, dflt) { return Math.round(num(v, dflt)); }
function pos(v, dflt) { return Math.max(0, num(v, dflt)); }

/**
 * 数值上界。脏存档塞 1e300 是「有限」的，num() 照单全收，
 * 于是净资产、客流、成本整套体系被改写得没法看（money() 会渲染成 ¥1e+300）。
 * 正常游戏里最大的数是净资产（几万块），1e12 留了八个数量级的余量。
 */
const NUM_CAP = 1e12;
/** 带上下界的取值：挡住 ±1e300 这类「合法但荒谬」的输入 */
const numCap = (v, dflt) => clamp(num(v, dflt), -NUM_CAP, NUM_CAP);
/** 非负且带上限 —— 绝大多数资源类字段用这个 */
const posCap = (v, dflt) => clamp(pos(v, dflt), 0, NUM_CAP);

/** 引擎会往 s.flags 里写的全部 key。清洗器按这张表做白名单，
 *  两者必须同步维护 —— 新增 flag 时忘了加进来，读档就会被静默丢掉。 */
const FLAG_KEYS = ['poached', 'bargain', 'researched', 'trendMaster', 'bigOrder',
  'perfectDay', 'fiveTypes', 'starMagnet', 'rivalDown', 'goalHit'];
/** 其中唯一一个计数器（其余都是布尔标记） */
const FLAG_COUNTER = 'researched';

/** 原料价格乘数表：只认已知原料 id，值夹到 NEWS 表实际取值（0.68~1.4）再放宽一档 */
function sanitizeFx(raw) {
  const src = obj(raw), out = {};
  for (const g of ING) {
    const v = num(src[g.id], 0);
    if (v > 0) out[g.id] = clamp(v, 0.5, 1.6);
  }
  return out;
}

/**
 * 日报清洗。它只喂给结算页与「较昨日」环比展示，以前只判了 typeof === 'object'
 * 就放行 —— 塞一个 { revenue: 1e300, net: Infinity } 的坏档，结算页就会显示
 * ¥Infinity，环比箭头也算出错方向。这里逐字段收敛，脏值一律落到安全缺省。
 */
function sanitizeReport(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const types = raw => {
    const src = obj(raw), out = {};
    for (const k in src) {
      if (typeof k !== 'string' || k.length > 24) continue;
      out[k] = pos(src[k], 0);
    }
    return out;
  };
  return {
    day: Math.max(1, int(r.day, 1)),
    served: pos(r.served, 0), orders: pos(r.orders, 0), lost: pos(r.lost, 0),
    priceLost: pos(r.priceLost, 0), stockout: pos(r.stockout, 0),
    revenue: num(r.revenue, 0), cogs: num(r.cogs, 0),
    wages: pos(r.wages, 0), rent: pos(r.rent, 0), marketing: pos(r.marketing, 0),
    net: num(r.net, 0),
    sat: clamp(num(r.sat, 1), 0, 1),
    repBefore: clamp(num(r.repBefore, 0), 0, 100), repAfter: clamp(num(r.repAfter, 0), 0, 100),
    repDelta: num(r.repDelta, 0),
    trendCups: pos(r.trendCups, 0), clicks: pos(r.clicks, 0), comboBest: pos(r.comboBest, 0),
    tips: num(r.tips, 0), traffic: pos(r.traffic, 0),
    typeServed: types(r.typeServed), typeLost: types(r.typeLost),
    rivalShare: clamp(num(r.rivalShare, 0), 0, 1), worth: num(r.worth, 0),
    /* 无尽模式的难度压力，下限 0.5、无上限（里程碑可以一直叠） */
    pressure: Math.max(0.5, num(r.pressure, 1)),
    lastMarketing: pos(r.lastMarketing, 0),
  };
}

function sanitizeState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;

  s.v = 2;
  s.diff = DIFFICULTY[s.diff] ? s.diff : 'normal';
  /* 天数上界要分两种：普通局跑满 CFG.DAYS 天就该收官（isFinished 判的是
     day > CFG.DAYS），脏存档把 day 写成 9999 会让读档后当场判定结束；
     无尽模式没有终点，只要挡住荒谬值就行。
     （s.endless 的清洗在下面，这里按同一规则先取一次布尔值即可。） */
  s.day = clamp(int(s.day, 1), 1, s.endless ? 9999 : CFG.DAYS);
  s.cash = numCap(s.cash, 0);
  s.rep = clamp(num(s.rep, 26), 0, 100);
  /* 分店数直接决定租金与工位数，给个硬上限，避免脏值把它顶到几千 */
  s.shops = clamp(int(s.shops, 1), 1, 99);
  s.debtDays = posCap(s.debtDays, 0);
  s.marketing = posCap(s.marketing, 0);
  s.dayMarketing = posCap(s.dayMarketing, 0);
  s.invested = posCap(s.invested, 0);
  s.shopSpend = posCap(s.shopSpend, 0);
  s.bpBonus = posCap(s.bpBonus, 0);
  /* startBonus 只用于 UI 展示（本局开局资金里有多少来自声望），
     脏值一律归零，不能让玩家改存档凭空多出一笔钱（现金本身下面也会夹） */
  s.startBonus = Math.min(pos(s.startBonus, 0), CFG.BP_START_CAP);
  s.loginBonus = posCap(s.loginBonus, 0);
  /* lastTime 是离线收益的时间基准，之前是清洗盲区：
     负数 / -Infinity 会让它一进游戏就领满额离线补贴，
     NaN 则让整个离线功能静默失效。未来时间同样不合理。 */
  s.lastTime = pos(int(s.lastTime, 0), 0);
  if (s.lastTime > Date.now() + 60000) s.lastTime = Date.now();
  /* 客流倍率：脏值填 1e9 会让一天涌进上亿人，整局直接失控 */
  s.eventTrafficMul = clamp(num(s.eventTrafficMul, 1), 0, 10);
  s.endless = !!s.endless;
  s.daily = !!s.daily;
  s.milestone = posCap(s.milestone, 0);
  s.nextStaffId = clamp(int(s.nextStaffId, 1), 1, NUM_CAP);
  s.trendKnown = !!s.trendKnown;

  /* 原料：只认已知 id，负数/非法值归零 */
  const inv = {};
  for (const g of ING) inv[g.id] = posCap(obj(s.inv)[g.id], 0);
  s.inv = inv;
  const prices = {}, prevPrices = {}, avgCost = {};
  for (const g of ING) {
    prices[g.id] = posCap(obj(s.prices)[g.id], g.base);
    prevPrices[g.id] = posCap(obj(s.prevPrices)[g.id], g.base);
    avgCost[g.id] = posCap(obj(s.avgCost)[g.id], g.base);
  }
  s.prices = prices; s.prevPrices = prevPrices; s.avgCost = avgCost;

  /* 配方 / 菜单：白名单去重，保证至少有一个可用配方 */
  const allIds = RECIPES.map(r => r.id);
  s.recipes = [...new Set(arr(s.recipes).filter(id => allIds.indexOf(id) >= 0))];
  if (!s.recipes.length) s.recipes = ['boba'];
  s.menu = [...new Set(arr(s.menu).filter(id => s.recipes.indexOf(id) >= 0))];
  const ratios = {};
  for (const id of s.recipes) ratios[id] = clamp(num(obj(s.ratios)[id], 1), 0.5, 2.5);
  s.ratios = ratios;

  /* 升级等级：按各自的 max 夹取。统一按 8 夹的话脏存档可以把 menu 顶到 7，
     而 menu 的 max 是 6 —— menuSlots() 会算出超过设计上限的菜单位。 */
  const up = {};
  for (const u of UPGRADES) {
    up[u.id] = clamp(int(obj(s.up)[u.id], 0), 0, num(u.max, 8));
  }
  s.up = up;

  /* 员工 / 候选人 */
  const traitIds = TRAITS.map(t => t.id);
  /* 用 CFG.STAFF_MAX 而不是写死 12：以前这里截到 12、而运行时能雇到更多，
     于是「雇满 → 存档 → 读档」会凭空少掉几个员工，遣散费也不会退。 */
  s.staff = arr(s.staff).slice(0, CFG.STAFF_MAX).map((st, i) => ({
    id: int(st && st.id, i + 1),
    name: str(st && st.name, 12) || '员工',
    emoji: str(st && st.emoji, 8) || '🧑',
    skill: clamp(num(st && st.skill, 1), 0.2, 5),
    trait: traitIds.indexOf(st && st.trait) >= 0 ? st.trait : null,
    wage: posCap(st && st.wage, 60),
    stamina: clamp(num(st && st.stamina, 100), 0, 100),
  }));
  s.candidates = arr(s.candidates).slice(0, 6).map(c => ({
    name: str(c && c.name, 12) || '候选人',
    emoji: str(c && c.emoji, 8) || '🧑',
    skill: clamp(num(c && c.skill, 1), 0.2, 5),
    trait: traitIds.indexOf(c && c.trait) >= 0 ? c.trait : null,
    wage: pos(c && c.wage, 60),
    fee: pos(c && c.fee, 260),
  }));

  /* 竞争对手 */
  if (!s.rival || typeof s.rival !== 'object') initRival(s);
  s.rival.name = str(s.rival.name, 16) || '隔壁老王';
  s.rival.emoji = str(s.rival.emoji, 8) || '🦑';
  s.rival.rep = clamp(num(s.rival.rep, 40), 0, 100);
  s.rival.aggro = clamp(num(s.rival.aggro, 1), 0.5, 3);
  s.rival.proof = clamp(int(s.rival.proof, 0), 0, 5);
  /* 对手行动的冷却表。脏值（字符串 / NaN）会让 `(cd[key] || 0) > s.day`
     这个判断失效 —— NaN 比较恒为 false，等于冷却可以无限绕过。 */
  const cd0 = obj(s.rival.cd), cd = {};
  for (const k in cd0) {
    if (typeof k !== 'string' || k.length > 24) continue;
    cd[k] = clamp(int(cd0[k], 0), 0, CFG.DAYS * 4);
  }
  s.rival.cd = cd;

  /* 日志：限条数 + 单条限长，避免超长 payload 与内存膨胀 */
  s.log = arr(s.log).slice(-60).map(l => str(l, 120));

  /* 统计 / 历史 */
  const st0 = obj(s.stats);
  s.stats = {
    totalCups: posCap(st0.totalCups, 0), totalRevenue: posCap(st0.totalRevenue, 0),
    totalProfit: numCap(st0.totalProfit, 0), bestDayProfit: numCap(st0.bestDayProfit, 0),
    totalLost: posCap(st0.totalLost, 0), totalServed: posCap(st0.totalServed, 0),
    clicks: posCap(st0.clicks, 0), days: posCap(st0.days, 0),
    questCash: posCap(st0.questCash, 0),
    /* V5 关卡奖励累计（E3 对账探针要读这个科目） */
    stageCash: posCap(st0.stageCash, 0),
  };
  /* 字段必须和 pushHistory 写入的那一份对齐。
     以前这里漏了 rival，读档后曲线图里整条对手份额线都会变成 undefined。 */
  s.history = arr(s.history).slice(-MAX_HISTORY).map(h => ({
    day: clamp(int(h && h.day, 0), 0, 9999), revenue: numCap(h && h.revenue, 0),
    net: numCap(h && h.net, 0), worth: numCap(h && h.worth, 0), rep: numCap(h && h.rep, 0),
    cups: posCap(h && h.cups, 0), orders: posCap(h && h.orders, 0), lost: posCap(h && h.lost, 0),
    rival: posCap(h && h.rival, 0),
  }));

  /* 成就：key 白名单。以前直接 obj(s.ach) 放行，改存档塞一堆假 id
     就能让「已达成 132/32」—— 两个版本的 UI 都是拿 Object.keys(s.ach).length 算的。 */
  const ach = {};
  for (const a of ACHIEVEMENTS) if (obj(s.ach)[a.id]) ach[a.id] = true;
  s.ach = ach;
  /* flags 直接驱动成就判定（perfectDay / fiveTypes / rivalDown …）。
     不做白名单的话，改存档塞几个 true 就能白嫖成就的现金与 ★，
     成就系统等于形同虚设。注意 researched 是计数器而非布尔。 */
  const fl = obj(s.flags), flags = {};
  for (const k of FLAG_KEYS) {
    if (k === FLAG_COUNTER) flags[k] = pos(fl[k], 0);
    else if (fl[k]) flags[k] = true;
  }
  s.flags = flags;
  /* EVENTS 表只有十来条，事件池却按整个表长度来切片；给它一个硬上限，
     免得脏存档塞几千条让「已发生事件」永远为真、新事件再也抽不出来。 */
  s.doneEvents = arr(s.doneEvents).slice(0, EVENTS.length + 8).map(e => str(e, 40));

  /* 每日任务：只认池子里还存在的 id，进度夹到非负；
     旧存档没有这个字段、或天数对不上（异常数据），直接按当天重抽一份。 */
  /* 合同：只认白名单里的 id，脏数据一律丢掉（存档可被玩家编辑） */
  const cRaw = s.contract;
  s.contract = (cRaw && contractById(cRaw.id))
    ? { id: String(cRaw.id), done: !!cRaw.done } : null;
  s.contractLog = arr(s.contractLog).filter(x => contractById(x)).map(String).slice(-8);
  /* 合同结算结果同理：是上一份报表的快照，读档后不该再冒出来发第二次钱 */
  s.contractResult = null;
  /* V5 章节关卡：难度档只认配置里真有的 id；已通关的关卡只认真实存在的 id。
     脏存档塞一堆假 id 就能"通关"所有关卡 —— 虽然关卡奖励是钱，必须挡住。 */
  const stg = obj(s.stage);
  const stgDone = {};
  const stgDoneRaw = obj(stg.done);
  for (const k of Object.keys(stgDoneRaw)) if (stageById(k)) stgDone[k] = true;
  s.stage = { diff: stageDiffById(stg.diff).id, done: stgDone };
  s.stageResult = null;
  /* V6 招牌配方：跨局基线（s.sig）与本局新增（s.sigRun）分开存 ——
     收官时要把本局新增累加进 META，基线是上一局带进来的，不能重复累加。 */
  const sigRaw = obj(s.sig), sig = {};
  for (const rid of Object.keys(sigRaw)) {
    if (recipeById(rid)) sig[rid] = clamp(num(sigRaw[rid], 0), 0, 1000000);
  }
  s.sig = sig;
  const sigRunRaw = obj(s.sigRun), sigRun = {};
  for (const rid of Object.keys(sigRunRaw)) {
    if (recipeById(rid)) sigRun[rid] = clamp(num(sigRunRaw[rid], 0), 0, 1000000);
  }
  s.sigRun = sigRun;
  /* V9 制作工坊：等级按菜系白名单清洗，夹到 0~3。
     ★ 存量兼容的关键：**按菜单实际内容反推该建哪些工坊**。
       老存档里「满杯百香果」本来就在菜单上（它一直是可上架的免费/可研配方），
       若读档后因为「没有鲜果工坊」而不能上架它 —— 玩家会发现
       「我原本能卖的产品突然卖不了了」，这是**倒退**而不是兼容。
       存量存档里已经上架的配方，其生产线在业务上必然已经存在，
       所以清洗时给这些菜系补 Lv.1 是对现实语义的还原，不是白送。
       字段完全缺失（最老的存档）→ 补开局赠送的那条线。 */
  const wsRaw = obj(s.workshops);
  const ws = {};
  for (const cu of CUISINES) {
    const lv = int(wsRaw[cu.id], 0);
    if (lv > 0) ws[cu.id] = clamp(lv, 1, 3);
  }
  for (const rid of arr(s.menu)) {
    const r = recipeById(rid);
    if (r && r.cuisine && !ws[r.cuisine]) ws[r.cuisine] = 1;
  }
  if (!Object.keys(ws).length) {
    for (const k in WORKSHOP_START) {
      if (cuisineById(k)) ws[k] = clamp(int(WORKSHOP_START[k], 0), 1, 3);
    }
  }
  s.workshops = ws;
  /* 经营维度（场地类型 / 城市 / 地图坐标）：
     老存档**完全没有**这三个字段，脏存档可能塞了字典外的 id 或越界坐标。
     一律在这里收敛：缺失 → 补默认，非法 → 退默认，绝不抛错
     —— 存档是玩家自己的进度，一个不认识的场地类型不该让他打不开游戏。
     详见 sanitizeVenue 的注释（含"为什么不为它升版本号"）。 */
  s.venue = sanitizeVenue(s.venue);

  s.quests = arr(s.quests)
    .filter(it => it && questById(it.id))
    .slice(0, QUEST_COUNT)
    .map(it => ({
      id: it.id,
      goal: Math.max(1, int(it.goal, 1)),
      prog: pos(it.prog, 0),
      done: !!it.done,
      got: pos(it.got, 0),
    }));
  if (s.quests.length !== QUEST_COUNT || int(s.questDay, 0) !== s.day) rollQuests(s);
  else s.questDay = s.day;

  /* 引导状态：读档一律不自动续播，避免指向不存在的元素 */
  /* obj(s.tut) 会原样覆盖默认值，所以每个字段都得自己夹一遍。
     越界 step 虽然被 TUT.start() 的边界判断兜住、不会崩，但会原样污染存档。 */
  const t0 = obj(s.tut);
  s.tut = { active: false, step: clamp(int(t0.step, 0), 0, 9999), done: !!t0.done };

  /* 枚举白名单 */
  s.weather = weatherById(s.weather && s.weather.id) || WEATHERS[1];
  s.trend = TAGS[s.trend] ? s.trend : 'milky';
  s.nextTrend = TAGS[s.nextTrend] ? s.nextTrend : 'fruity';
  s.pendingEvent = (s.pendingEvent && typeof s.pendingEvent.id === 'string')
    ? (eventById(s.pendingEvent.id) || null) : null;
  s.news = (s.news && typeof s.news.text === 'string')
    ? { id: str(s.news.id, 24), text: str(s.news.text, 80), fx: sanitizeFx(s.news.fx) } : null;
  /* newsFx 是原料价格乘数，会直接乘到进货价上。不清洗的话塞 { tea: 0.01 }
     就能用 1% 的价进货。表里正常取值 0.68~1.4，留一档余量。 */
  s.newsFx = sanitizeFx(s.newsFx);

  /* 运行时字段 */
  s.sim = null;
  s.newQuests = [];
  /* 营业中途的存档无法恢复现场，一律退回准备阶段 */
  s.phase = (s.phase === 'report' || s.phase === 'over') ? s.phase : 'prep';
  s.report = sanitizeReport(s.report);
  s.lastReport = sanitizeReport(s.lastReport);
  /* 结算页的「较昨日」环比要用前一天那份；坏档时置空即可，最多是不显示涨跌 */
  s.prevReport = sanitizeReport(s.prevReport);
  s.lastMarketing = pos(s.lastMarketing, 0);
  /* 中期目标达成记录：只认 5 的倍数天数，脏数据直接丢掉 */
  s.msHit = arr(s.msHit).filter(d => d % MILESTONE_EVERY === 0 && d > 0 && d <= CFG.DAYS);
  /* 🃏 策略卡：只认配置里真有的 id，去重、去脏、夹到上限 ——
     改存档凭空加卡等于直接改数值，必须在入口挡住 */
  const cardIds = [];
  for (const raw of arr(s.cards)) {
    const c = cardById(str(raw, 40));
    if (c && cardIds.indexOf(c.id) < 0) cardIds.push(c.id);
  }
  s.cards = cardIds.slice(0, CFG.CARD_MAX);
  const offs = [];
  for (const raw of arr(s.cardOffer)) {
    const c = cardById(str(raw, 40));
    if (c && offs.indexOf(c.id) < 0 && s.cards.indexOf(c.id) < 0) offs.push(c.id);
  }
  s.cardOffer = offs.slice(0, CFG.CARD_OFFER_N);
  return s;
}

/** 读槽位 → 净化后的 state；空槽 / 损坏 / 不可用一律返回 null */
function loadGame(slot) {
  if (slot != null) setSlot(slot);
  const raw = storageGet(slotKey(CUR_SLOT));
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (!s || s.v !== 2) return null;
    return sanitizeState(s);
  } catch (e) { return null; }
}

/* 槽位摘要记忆化：key 是 slotKey(i)，value 是 { raw, val }。
   存档原文没变就不必重新解析 —— 改存档时 raw 一定会变，天然失效。 */
const SLOT_CACHE = {};

/** 槽位摘要（用于选档界面） */
function slotInfo(i) {
  const k = slotKey(i);
  const raw = storageGet(k);
  if (!raw) { delete SLOT_CACHE[k]; return null; }
  /* 小游戏标题页每帧要画三个槽位、hasAnySave() 还要再扫一遍，
     等于每帧六次「JSON.parse + 全量 sanitizeState」—— 整个清洗器被当成了
     渲染循环的一部分。存档内容不变时结果必然相同，按原文缓存即可。
     （storageGet 那一步没法省：不读就不知道内容有没有变。） */
  const hit = SLOT_CACHE[k];
  if (hit && hit.raw === raw) return hit.val;
  let val = null;
  try {
    const s = sanitizeState(JSON.parse(raw));
    if (s) {
      val = {
        day: s.day, diff: s.diff, endless: !!s.endless,
        worth: Math.round(netWorth(s)), rep: Math.round(s.rep),
        shops: s.shops, time: s.savedAt || s.lastTime || 0,
      };
    }
  } catch (e) { val = null; }
  SLOT_CACHE[k] = { raw: raw, val: val };
  return val;
}
function hasAnySave() {
  for (let i = 0; i < CFG.SAVE_SLOTS; i++) if (slotInfo(i)) return true;
  return false;
}
function clearSave(slot) {
  storageRemove(slotKey(slot == null ? CUR_SLOT : slot));
}

/* 导出 / 导入（跨设备搬运存档） */
function b64encode(str) {
  try {
    const bytes = new TextEncoder().encode(str);
    /* 分块，避免 String.fromCharCode.apply 在大数组上爆栈 */
    let bin = '';
    for (let i = 0; i < bytes.length; i += 4096) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
    }
    return btoa(bin);
  } catch (e) {
    try { return btoa(unescape(encodeURIComponent(str))); }
    catch (e2) { return ''; }
  }
}
function b64decode(b64) {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch (e) {
    return decodeURIComponent(escape(atob(b64)));
  }
}
/**
 * 快照一份「可持久化」的状态。
 * 原先 exportSave 与 saveGame 各写了一套「剔掉 sim + 盖时间戳」的逻辑，
 * 同步引擎也要用同一套规则 —— 三处各写一遍迟早不一致，抽出来共用一个。
 *
 * 为什么不用 JSON.parse(JSON.stringify(s)) 深拷贝：
 *   那是「序列化 + 反序列化 + 再序列化」三趟，而 s.sim 体积最大却注定要丢掉。
 *   改成对象展开做浅拷贝，顺手把 sim 摘掉，只跑一趟。
 *   嵌套对象虽然共享引用，但调用方紧接着就 JSON.stringify，不存在被改的风险。
 */
function snapshotState(s) {
  if (!s) return null;
  const { sim, ...rest } = s;
  return Object.assign({}, rest, {
    /* 营业中途的存档无法还原现场（队列、进度、CD），一律退回准备阶段 */
    phase: s.phase === 'open' ? 'prep' : s.phase,
    lastTime: Date.now(),
    savedAt: Date.now(),
  });
}
function exportSave(s) {
  const snap = snapshotState(s);
  return snap ? b64encode(JSON.stringify(snap)) : '';
}
function importSave(b64) {
  try {
    const code = String(b64).trim();
    /* 长度上限：正常存档 < 20KB。不给上限的话，粘贴一大段文本会让
       atob + JSON.parse 直接卡死主线程，等同于一次本地 DoS。 */
    if (!code) return { ok: false, msg: '请先粘贴存档码' };
    if (code.length > 200000) return { ok: false, msg: '存档码过长，疑似不是有效存档' };
    const raw = JSON.parse(b64decode(code));
    if (!raw || raw.v !== 2 || typeof raw.day !== 'number') return { ok: false, msg: '存档格式无法识别' };
    const s = sanitizeState(raw);
    if (!s) return { ok: false, msg: '存档数据损坏，无法读取' };
    return { ok: true, state: s };
  } catch (e) { return { ok: false, msg: '存档解析失败' }; }
}

/* 认识的默认 Meta：原先在 loadMeta 的成功/失败两条分支里各写了一遍，
   改字段时很容易只改一处导致两边行为不一致。提成工厂函数保证唯一来源。 */
function newMeta() {
  return {
    best: {}, bp: 0, runs: 0, ach: {}, maxBpEarned: 0, sound: true, tutDone: false,
    /* 连续登录：跨局数据，跟某一局的进度无关 */
    loginDate: '', loginStreak: 0, loginBest: 0, pendingCash: 0,
    /* 本机战绩榜：跨局保留的最好 5 局。
       平台级排行榜要开放数据域 + 云存储（有服务端），这里先用本机的 ——
       至少让玩家有个「再破一次自己的纪录」的理由。 */
    runsTop: [],
    /* 每日挑战（F3）：这三项原先是 main.js 里用到才临时挂上去的，
       newMeta 里根本没有，于是 loadMeta 读老存档时它们恒为 undefined，
       两版标题页的「今日最佳」判断全靠 undefined 兜底。收进工厂函数，
       让 META 的形状有唯一来源。 */
    dailyDate: '', dailyBest: 0, dailyBestEver: 0, dailyLog: [],
    /* V6 招牌配方：跨局继承的累计销量（{ 配方 id: 杯数 }）。
       这是第二批唯一的"跨局成长线"：这一局卖得多，下一局该款更值钱。
       单独放一个字段而不是塞进 ach —— 它的语义是**可累加的进度**，
       不是"达成就打勾"的布尔。 */
    sig: {},
  };
}

/**
 * 把本局的招牌销量写回 META（跨局继承）。
 * 必须在**收官/转生**时调用 —— 和成就（s.ach → m.ach）是同一套时机。
 *
 * 累加而不是覆盖：s.sig 是上一局带进来的基线，s.sigRun 才是本局新增，
 * 写回时只加 sigRun。搞混了就会把上一局的量重复累加（每局翻一倍）。
 *
 * 每日挑战（s.daily）不写回 —— 全网同种子，继承数据会破坏公平性。
 */
function mergeSignature(meta, s) {
  if (!meta || !s) return meta;
  if (s.daily) return meta;
  if (!meta.sig || typeof meta.sig !== 'object') meta.sig = {};
  const run = s.sigRun || {};
  for (const rid of Object.keys(run)) {
    if (!recipeById(rid)) continue;
    const add = num(run[rid], 0);
    if (add <= 0) continue;
    meta.sig[rid] = num(meta.sig[rid], 0) + add;
  }
  return meta;
}

/** 收官时把这一局记进本机战绩榜（按净资产降序，只留前 RUN_TOP_N 条） */
function pushRunRecord(m, s, result) {
  if (!m || !s) return m;
  if (!Array.isArray(m.runsTop)) m.runsTop = [];
  m.runsTop.push({
    worth: Math.round(num(netWorth(s), 0)),
    day: Math.max(1, num(s.day, 1)),
    diff: s.diff || 'normal',
    endless: !!s.endless,
    milestone: num(s.milestone, 0),
    result: result || 'finish',
  });
  m.runsTop.sort((a, b) => num(b.worth) - num(a.worth));
  if (m.runsTop.length > CFG.RUN_TOP_N) m.runsTop.length = CFG.RUN_TOP_N;
  return m;
}

/* ============================================================
 *  每日挑战 · 同种子日榜（F3）
 *
 *  全网同一天共用同一个种子（RNG.setSeed('bubble-' + todayKey())），
 *  不同玩家打的确实是同一局 —— 这是「日榜」能成立的前提。
 *
 *  这里只管本机这一半：把成绩落进 META，供两版渲染，以及
 *  平台能力不可用时（浏览器预览 / 宿主不支持）的降级展示。
 *  上报与拉榜那一半在 minigame/src/caps.js。
 * ============================================================ */

/** 上报给平台的分数：必须是 [0, int32_MAX) 的正整数（平台会拒掉越界的） */
function rankScore(nw) {
  return clamp(Math.round(num(nw, 0)), 0, CFG.RANK_SCORE_MAX);
}

/**
 * 记录一次每日挑战成绩。
 *
 * 关键点是**只在比今天已有的成绩更好时才覆盖**：一天可以打好几局，
 * 榜单上该显示当天最好的那一局，而不是最后一局。否则玩家用一局
 * 摆烂成绩把自己的名次冲掉了，还会以为榜在乱排。
 *
 * 返回值告诉调用方这次刷新了什么，两版据此决定文案和是否上报。
 */
function recordDaily(m, key, nw) {
  const none = { score: 0, newToday: false, newEver: false, prevToday: 0, prevEver: 0 };
  if (!m) return none;
  const v = rankScore(nw);
  const sameDay = String(m.dailyDate || '') === String(key || '');
  const prevToday = sameDay ? Math.max(0, Math.round(num(m.dailyBest, 0))) : 0;
  const prevEver = Math.max(0, Math.round(num(m.dailyBestEver, 0)));

  if (!sameDay) { m.dailyDate = key; m.dailyBest = v; }
  else if (v > prevToday) { m.dailyBest = v; }
  if (v > prevEver) m.dailyBestEver = v;

  /* 日志：一天一条取当天最好，按日期升序，超上限丢最早的 */
  if (!Array.isArray(m.dailyLog)) m.dailyLog = [];
  let hit = null;
  for (const it of m.dailyLog) { if (it && it.d === key) { hit = it; break; } }
  if (hit) { if (v > num(hit.best, 0)) hit.best = v; }
  else m.dailyLog.push({ d: key, best: v });
  m.dailyLog.sort((a, b) => (String(a.d) < String(b.d) ? -1 : String(a.d) > String(b.d) ? 1 : 0));
  if (m.dailyLog.length > CFG.DAILY_LOG_MAX) {
    m.dailyLog = m.dailyLog.slice(m.dailyLog.length - CFG.DAILY_LOG_MAX);
  }

  return {
    score: v,
    newToday: v > prevToday,
    newEver: v > prevEver,
    prevToday: prevToday,
    prevEver: prevEver,
  };
}

/** 最近 n 天（日期升序）。没打过的日子不补 0 —— 补了会被读成「那天打了 0 分」 */
function dailyRecent(m, n) {
  const log = (m && Array.isArray(m.dailyLog)) ? m.dailyLog : [];
  return log.slice(-Math.max(1, n)).map(it => ({
    d: String((it && it.d) || ''),
    best: Math.max(0, num(it && it.best, 0)),
  }));
}

function loadMeta() {
  const raw = storageGet(CFG.META_KEY);
  if (!raw) return newMeta();
  try {
    const m = JSON.parse(raw);
    /* JSON.parse('null') 是 null、脏数据也可能是数组，这里一并挡掉 */
    if (!m || typeof m !== 'object' || Array.isArray(m)) return newMeta();
    const out = Object.assign(newMeta(), m);
    /* Object.assign 是原样覆盖 —— 上面只挡了「不是对象」，
       字段本身的类型还没收敛。这些数字会直接决定开局资金 / 成就 ★，
       也会被标题页拼进 innerHTML，脏值既会破坏数值也会破坏渲染。 */
    out.bp = clamp(num(out.bp, 0), 0, CFG.BP_MAX || 9999);
    out.runs = pos(int(out.runs, 0), 0);
    out.maxBpEarned = pos(num(out.maxBpEarned, 0), 0);
    out.loginStreak = pos(int(out.loginStreak, 0), 0);
    out.loginBest = pos(int(out.loginBest, 0), 0);
    out.pendingCash = clamp(pos(num(out.pendingCash, 0), 0), 0, LOGIN_CAP_CASH);
    out.ach = obj(out.ach);
    /* V6 招牌配方的跨局累计销量：只认真实存在的配方 id，值夹到合理上界。
       存档可被玩家编辑 —— 不清洗的话塞个 1e9 就能让所有配方直接满级。 */
    const sigRaw = obj(out.sig), sig = {};
    for (const rid of Object.keys(sigRaw)) {
      if (recipeById(rid)) sig[rid] = clamp(num(sigRaw[rid], 0), 0, 1000000);
    }
    out.sig = sig;
    const best = obj(out.best);
    out.best = {};
    for (const k of Object.keys(DIFFICULTY)) out.best[k] = pos(num(best[k], 0), 0);
    /* runsTop 可能来自旧版本或脏数据。Object.assign 会原样覆盖，
       不逐条校验的话战绩榜会渲染出 NaN / undefined。 */
    if (!Array.isArray(out.runsTop)) out.runsTop = [];
    out.runsTop = out.runsTop
      .filter(r => r && typeof r === 'object' && !Array.isArray(r) && num(r.worth, 0) > 0)
      .map(r => ({
        worth: Math.max(0, num(r.worth, 0)),
        day: Math.max(1, num(r.day, 1)),
        diff: DIFFICULTY[r.diff] ? r.diff : 'normal',
        endless: !!r.endless,
        milestone: Math.max(0, num(r.milestone, 0)),
        result: (r.result === 'bankrupt') ? 'bankrupt' : 'finish',
      }))
      .sort((a, b) => b.worth - a.worth)
      .slice(0, CFG.RUN_TOP_N);
    /* 每日挑战三项：老存档没有 dailyBestEver / dailyLog，Object.assign 会把
       它们留成 undefined（日期被写成 undefined 的话，日榜标题会直接显示
       "今日种子 undefined"）。日期格式也一并校验，改存档塞个超长字符串
       会让柱图把布局顶烂。 */
    out.dailyDate = /^\d{4}-\d{2}-\d{2}$/.test(String(out.dailyDate || '')) ? out.dailyDate : '';
    out.dailyBest = clamp(Math.round(num(out.dailyBest, 0)), 0, CFG.RANK_SCORE_MAX);
    out.dailyBestEver = clamp(Math.round(num(out.dailyBestEver, 0)), 0, CFG.RANK_SCORE_MAX);
    if (!Array.isArray(out.dailyLog)) out.dailyLog = [];
    out.dailyLog = out.dailyLog
      .filter(it => it && typeof it === 'object' && !Array.isArray(it)
        && /^\d{4}-\d{2}-\d{2}$/.test(String(it.d || '')))
      .map(it => ({ d: String(it.d), best: clamp(Math.round(num(it.best, 0)), 0, CFG.RANK_SCORE_MAX) }))
      .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
      .slice(-CFG.DAILY_LOG_MAX);
    return out;
  } catch (e) { return newMeta(); }
}
function saveMeta(m) { storageSet(CFG.META_KEY, JSON.stringify(m)); }

/* ============================================================
 *  连续登录
 *  放在 META 而不是存档里：这是「打开游戏」的奖励，开新局、读旧档、
 *  破产重来都该算数，跟某一局的经营进度无关。
 *  奖励是现金而不是声望点 —— 声望点永久加客流，拿来当签到奖励会把
 *  长期玩家的难度悄悄改掉。
 * ============================================================ */
const LOGIN_CAP_CASH = 200;
/** 第 n 天的创业基金：线性上抬，7 天后封顶，避免开局现金被长期玩家堆失控 */
function loginCashOf(streak) {
  return Math.min(LOGIN_CAP_CASH, 30 + 25 * Math.max(1, Math.round(num(streak, 1))));
}
/** 给标题页用的只读快照（不落盘、不改动） */
function loginState(m) {
  m = m || newMeta();
  const claimed = m.loginDate === todayKey();
  const streak = pos(m.loginStreak, 0);
  return {
    streak, best: Math.max(pos(m.loginBest, 0), streak),
    claimed, pending: pos(m.pendingCash, 0),
    /* 下一次签到能拿多少（已签到时 streak 已经加过了，所以是「明日」） */
    next: loginCashOf(streak + 1),
  };
}
/** 签到：一天一次。已签过返回 null（幂等，重复调用不会刷钱） */
function claimLogin(m) {
  if (!m) return null;
  const key = todayKey();
  if (m.loginDate === key) return null;
  const cont = m.loginDate === yesterdayKey();
  m.loginStreak = cont ? pos(m.loginStreak, 0) + 1 : 1;
  m.loginBest = Math.max(pos(m.loginBest, 0), m.loginStreak);
  m.loginDate = key;
  const cash = loginCashOf(m.loginStreak);
  m.pendingCash = pos(m.pendingCash, 0) + cash;
  saveMeta(m);
  return { streak: m.loginStreak, cash, cont };
}
/**
 * 开局时把已签到的创业基金落进这一局。
 * 没签到会顺手补签 —— 玩家都把游戏打开了，不该因为没点那个按钮就少拿钱。
 */
function takeLoginBonus(s, m) {
  if (!s || !m) return null;
  if (m.loginDate !== todayKey()) claimLogin(m);
  const cash = pos(m.pendingCash, 0);
  if (!(cash > 0)) return null;
  m.pendingCash = 0;
  saveMeta(m);
  s.cash += cash;
  s.loginBonus = cash;
  pushLog(s, `🔥 连续登录 ${pos(m.loginStreak, 0)} 天，创业基金 +${money(cash)}`);
  return { streak: pos(m.loginStreak, 0), cash };
}

/* ============================================================
 *  智能建议系统（纯逻辑，给新手与卡关玩家指路）
 * ============================================================ */

/** 按当前库存，今日上架的菜单最多能做多少杯（客流均分估算） */
function maxCupsFromStock(s) {
  if (!s.menu.length) return 0;
  const per = 1 / s.menu.length;
  const need = {};
  for (const rid of s.menu) {
    const req = reqOf(s, rid);
    for (const k in req) need[k] = (need[k] || 0) + req[k] * per;
  }
  let n = Infinity;
  for (const k in need) n = Math.min(n, (s.inv[k] || 0) / need[k]);
  return Math.max(0, Math.floor(isFinite(n) ? n : 0));
}

/**
 * 今日可接待的订单（人）数 —— 与 trafficOf 同口径，判断「忙不忙得过来」必须用这个。
 * 多杯订单耗时更久，所以不能拿 dailyCapacity(杯) 直接比 trafficOf(人)。
 */
function dailyOrderCapacity(s) {
  const base = CFG.BASE_SERVICE / (1 + 0.20 * s.up.speed) / (1 + 0.12 * s.up.training);
  const ct = 1 + (avgCupsPerOrder(s) - 1) * 0.35;   // 多杯订单的时间系数
  const T = CFG.DAY_DURATION;
  const per = w => Math.max(CFG.MIN_SERVICE, base / (w ? staffMult(s, w) : 1)) * ct;
  let n = T / per(null);                            // 老板位
  for (const st of s.staff) n += T / per(st);
  n += (s.shops - 1) * T / per(null);
  return Math.round(n);
}

/** 手速一般时的可达订单数（计入点击加成） */
/** 点击加速能达到的产能上限。
 *  baseCap 可传入调用方已经算好的 dailyOrderCapacity()，省掉一次重复计算
 *  （dailyOrderCapacity 要遍历全体员工，建议列表里两处都要用）。 */
function dailyClickOrderCapacity(s, baseCap) {
  return Math.round((baseCap == null ? dailyOrderCapacity(s) : baseCap) * 1.35 + 8);
}

/** 库存能支撑多少位客人（把杯数换算成人次） */
function maxOrdersFromStock(s) {
  return Math.floor(maxCupsFromStock(s) / Math.max(1, avgCupsPerOrder(s)));
}

/**
 * 今日建议列表。level: 'warn' 危险 / 'good' 机会 / 'tip' 提示
 */
function adviceOf(s) {
  const out = [];
  const predicted = trafficOf(s);                 /* 人 */
  const stockCups = maxCupsFromStock(s);           /* 杯 */
  const stockOrders = maxOrdersFromStock(s);       /* 人 */
  const capOrders = dailyOrderCapacity(s);         /* 单 */
  const avgCups = avgCupsPerOrder(s);

  if (s.menu.length === 0) {
    out.push({ level: 'warn', icon: '📋', text: '你还没有上架任何饮品，先到下面「今日菜单」点一款上架。', act: 'menu' });
  } else if (stockOrders < predicted * 0.75) {
    out.push({
      level: 'warn', icon: '📦',
      text: `库存约 ${stockCups} 杯，按客群平均每人 <b>${avgCups.toFixed(1)}</b> 杯算，只够招待 <b>${stockOrders}</b> 人 —— 而预计客流 <b>${predicted}</b> 人，不补货会大量缺料赶客。`,
      act: 'buy',
    });
  }
  if (predicted > capOrders * 1.15) {
    out.push({
      level: 'warn', icon: '🚀',
      text: `产能约 <b>${capOrders}</b> 单 < 预计客流 <b>${predicted}</b> 人（点击加速可到约 ${dailyClickOrderCapacity(s, capOrders)} 单），忙不过来会流失口碑。去「⬆️ 升级」升封口机，或「👥 员工」招人 +1 出杯位。`,
      act: 'up',
    });
  } else if (predicted < capOrders * 0.6 && s.cash > 500) {
    out.push({ level: 'tip', icon: '📣', text: '产能还有富余，可以适当加投<b>营销</b>把客流拉满。', act: 'mkt' });
  }

  let cheap = null;
  for (const g of ING) {
    if (s.prices[g.id] <= g.base * 0.82 && (!cheap || s.prices[g.id] / g.base < cheap.r)) {
      cheap = { g, r: s.prices[g.id] / g.base };
    }
  }
  if (cheap) {
    out.push({
      level: 'good', icon: '📉',
      text: `${cheap.g.emoji} <b>${cheap.g.name}</b> 正在低价 ¥${s.prices[cheap.g.id].toFixed(2)}（基准 ¥${cheap.g.base}），适合囤货。`,
      act: 'buy',
    });
  }

  const missTrend = s.recipes.filter(rid => recipeById(rid).tags.includes(s.trend) && !s.menu.includes(rid));
  if (missTrend.length) {
    const r = recipeById(missTrend[0]);
    out.push({
      level: 'tip', icon: '🔥',
      text: `今日流行 <b>${TAGS[s.trend].name}</b>，把 ${r.emoji} <b>${r.name}</b> 上架可吃 +55% 销量。`,
      act: 'menu',
    });
  }

  const tired = s.staff.filter(st => st.stamina < 30).length;
  if (tired) {
    out.push({ level: 'warn', icon: '😪', text: `有 <b>${tired}</b> 名员工体力低于 30%，出杯效率大跌，去「👥 员工」页团建。`, act: 'staff' });
  }

  if (s.cash < 300) out.push({ level: 'warn', icon: '⚠️', text: '现金偏低，注意明天还要付房租和工资。', act: null });
  else if (s.cash > 4000) out.push({ level: 'tip', icon: '💰', text: `账上躺着 ${money(s.cash)} 闲置现金，去「⬆️ 升级」或「🧪 研发」投出去才会增值。`, act: 'up' });

  /* 客群覆盖：菜单是否照顾到所有客群的口味 */
  const menuTags = new Set();
  for (const rid of s.menu) for (const t of recipeById(rid).tags) menuTags.add(t);
  const uncovered = CUSTOMER_TYPES.filter(t => t.prefer.length && !t.prefer.some(p => menuTags.has(p)));
  if (uncovered.length) {
    const t = uncovered[0];
    out.push({
      level: 'tip', icon: t.emoji,
      text: `菜单还没照顾到 <b>${t.name}</b>（偏好 ${t.prefer.map(p => TAGS[p].name).join(' / ')}），上架对应口味能多留一波客人。`,
      act: 'menu',
    });
  }

  /* 竞争对手 */
  if (s.rival) {
    const share = rivalShare(s);
    if (share >= 0.2) {
      out.push({
        level: 'warn', icon: '🦑',
        /* 整段文案自带 <b> 标签，不能整体 esc，只能对插值进来的对手名转义 ——
           它来自存档，而且渲染层会被 <b> 骗过，以为这段是可信 HTML。 */
        text: `对手「<b>${escText(s.rival.name)}</b>」抢走了约 <b>${Math.round(share * 100)}%</b> 的客流（它口碑 ${Math.round(s.rival.rep)} vs 你 ${Math.round(s.rep)}），去「🏙️ 商圈」反制。`,
        act: 'rival',
      });
    }
  }

  if (s.stats.clicks < 30 && s.day <= 3) {
    out.push({ level: 'tip', icon: '👆', text: '营业时<b>疯狂点击出杯位</b>能加速出杯并拿小费，实际产能比放着不管高 35% 以上。', act: null });
  }
  return out.slice(0, 4);
}

/* ---------------- 离线收益 ---------------- */
/** 离线收益结算 */
function claimOffline(s) {
  const last = pos(int(s.lastTime, 0), 0);
  if (!(last > 0)) return null;
  const mins = Math.min(CFG.OFFLINE_CAP_MIN, Math.max(0, (Date.now() - last) / 60000));
  if (mins < 1) return null;
  const rate = offlinePerMin(s);
  if (rate <= 0) return null;
  /* 同理不再乘 (1 + bp * 0.02)：声望折算的是开局现金，不是全局收益倍率 */
  const gain = Math.round(rate * mins);
  s.cash += gain;
  s.lastTime = Date.now();
  return { mins: Math.floor(mins), gain };
}
