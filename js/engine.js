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

function storageCap(s) {
  /* ★ V21：每开一家分店 **+CFG.BRANCH_STORAGE(500) 库容**。
     分店原来的收益全在需求端（+60% 客流），而瓶颈在供给端（缺料占流失 82~89%），
     于是"开分店 = 多来客人、没多料可卖" → 实测 −17.3%，扩张是纯亏。
     ★ 用 shops 而不是 activeBranchCount：仓库容量取决于"有没有这家店"，
       跟这家店派没派人无关（派人是出杯的事，不是囤货的事）。 */
  /* ★★ V22：库容起点按难度不同 —— 这是三档唯一被验证有效的结构杠杆。
     （costMult 只压一次性支出，对 30 天总成本影响 <3%；库容是阈值型，
       起点差 150 就等于"要不要先买冷链"这个决策的答案不同。 */
  const d = diffOf(s);
  const base = (d && d.storageBase != null) ? d.storageBase : CFG.BASE_STORAGE;
  return base + s.up.storage * 180
    + CFG.BRANCH_STORAGE * Math.max(0, pos(s.shops, 1) - 1);
}
function menuSlots(s) { return 2 + s.up.menu; }
/** 出杯位数量 = 老板 1 个 + 员工数（V11 起员工按分店归属，
 *  不再额外给每家分店白送一个工位 —— 详见 openShop 的 stations 构建）。 */
function stationCount(s) { return 1 + s.staff.length; }
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
/** 章节机制的乘子（没定义的键返回 1，调用处不用特判）。
 *
 *  ★★ 注意：**不要**在这里另写一个 chapterOf。
 *     引擎里本来就有 `chapterOf(s)`（返回 1~6 的章节序号，供关卡系统用），
 *     同作用域下后定义的函数会**静默覆盖**前面的 —— 我第一版就这么写了，
 *     结果 `chapterOf` 返回数字而不是章节对象，`c[key]` 全是 undefined，
 *     六个章节的乘子全部失效，而没有任何报错。
 *     现在直接复用那个序号：CHAPTERS 与 STAGE_DAYS / STAGE_CHAPTERS 同周期（5 天 × 6 章）。 */
function chapterMul(s, key) {
  const idx = num(chapterOf(s), 1) - 1;
  const c = CHAPTERS[idx];
  const v = c && c[key];
  return typeof v === 'number' ? v : 1;
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
  const afterSig = c - sigCostCut(s, rid);
  /* ★ V21：员工培训降本（取代原来的"出杯速度 +12%/级"）。
     熟练的员工浪费少 —— 这条挂在成本上，和 speed 不再抢同一个分母。 */
  const cut = Math.min(0.4, (num(s.up.training, 0)) * CFG.TRAINING_COST_CUT);
  /* ★ V21：原料成本卡也要算进这里。原来只乘在 sim.cogs 上，
     菜单毛利不体现、现金流也不体现 —— 那张卡就是纯代价（见 buyIng 的注释）。 */
  return Math.max(0.1, afterSig * (1 - cut) * cardMul(s, 'cogs'));
}
function priceOf(s, rid) {
  /* ★ V22：章节客单价乘子。
     ★ 只需改这一处 —— 托管店估算、结算均价（revenue/orders）、
       菜单展示、adviceOf 全都调 priceOf，会自动跟着走。
       （前一轮规格里担心"牵动四处"，核完代码确认是多虑了：
        合同用的 avgPrice 是从**实际营收**算的，不是从菜单价算的。） */
  const raw = recipeById(rid).price * (s.ratios[rid] || 1) * chapterMul(s, 'price');
  return Math.max(1, Math.round(raw) + sigPriceAdd(s, rid));
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
/**
 * 实际在营业的分店数（≥1 名员工）。
 *  只有员工在岗的分店才产生客流与产出 —— 空转的店只付租金，
 *  这正是「开了分店要立刻配人手」的压力来源。
 *
 * ★ V12：托管给店长的店**不计入**。
 *   托管店的营收来自店长 AI 的日结算，不来自实时营业模拟；
 *   若它还计入客流加成，玩家经营的总店会凭空多出客流 ——
 *   相当于「白送一个分店的客流却不用管它」。
 *   这个偏差会让「托管」变成稳赚的偷懒选项，必须排除。
 */
function activeBranchCount(s) {
  let n = 1;                /* 总店永远在营业 */
  for (let b = 2; b <= pos(s.shops, 1); b++) {
    const store = storeByBranch(s, b);
    if (store && store.auto) continue;       /* 托管店不计入 */
    if (staffOfBranch(s, b).length > 0) n++;
  }
  return n;
}
function trafficOf(s) {
  const d = diffOf(s);
  let t = 4 + s.rep * 0.36;
  t *= 1 + 0.15 * s.up.decor;
  t *= marketingMul(s.marketing);
  t *= s.weather.traffic;
  /* ★ V11：客流加成按**实际在营业的分店**数算，不是按"开了几家"。
     改造前是 `1 + 0.6 * (s.shops - 1)` —— 白送 60% 客流，
     哪怕那家分店一个人都没有。配合"分店工位靠取模轮转员工"，
     玩家能只付 3 份店租就把客流拉满，性价比畸高。
     现在分店不再白送工位（员工必须真的在那家店），
     客流必须同步：**开了没人 = 空店 = 没有额外客流**。
     这也让店长与招人真正变成"让分店活起来"的必要投入。 */
  /* ★ V21：0.6 → CFG.BRANCH_TRAFFIC(0.2)。分店的收益挪到库容（见 storageCap），
     客流只保留二成 —— 本作瓶颈是备货，单纯堆客流等于"多来客人没料卖"。
     砍到 0 反而更差（−15.7% vs −3.8%），所以这二成不是装饰，是给扩张的甜头。 */
  t *= 1 + CFG.BRANCH_TRAFFIC * (activeBranchCount(s) - 1);
  /* 这里曾经有一项 `1 + 0.02 * s.bpBonus`：声望点直接乘在客流上，线性且无上限。
     问题是产能（出杯位 / 服务速度）每局都从零起步，只有需求端在涨 ——
     多来的客人接不住 → 排队超时流失 → 扣口碑 → 口碑又反过来压客流，成负反馈。
     实测（tools/sim.js --bp=N，同一 AI、同一套种子）：
       bp 0 → 94% 达标 / 破产 0/8，bp 74（第 5 局）→ 74% 达标 / 破产 7/8。
     所以声望不再动客流，改为折算「开局创业基金」（见 prestigeStartCash）：
     钱怎么变成产能（雇人 / 提速 / 开店）由玩家自己决定，不会单向推高需求。 */
  /* ★ V22：0.01 → 0.025（满级 +15%）。原来只有 +6%，
     配上 450×1.85^n 的成本，实测 ROI -0.24 —— 买完没感觉。 */
  t *= 1 + 0.025 * s.up.auto;
  t *= cardMul(s, 'traffic');     /* 🃏 策略卡：薄利多销 / 达人探店这类 */
  t *= chapterMul(s, 'traffic');  /* 🗺️ 章节：夜市人多、清晨街区人少 */
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
  /* ★ V13.6：常客加权 —— 该类型下常客越多，这个类型越容易被抽中
     （开罗的「常客度 ↑ → 人气 ↑ → 到店顾客 ↑」）。
     只看**已成名常客**（好感满 100）的数量，
     否则好感 2 的人也会贡献权重，稀释了"常客"的意义。 */
  return weightedPick(CUSTOMER_TYPES, t => {
    let w = typeWeightOf(s, t);
    const n = regularCountOf(s, t.id);
    if (n > 0) w *= 1 + n * 0.12;
    return w;
  });
}

/** 某类型下已成常客（好感满）的数量（V13.6） */
function regularCountOf(s, typeId) {
  const rs = regularsOf(s);
  let n = 0;
  for (const id in rs) {
    const rec = rs[id];
    if (rec && rec.type === typeId && num(rec.fav, 0) >= REGULAR_CFG.max) n++;
  }
  return n;
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

/**
 * 店长对**自己那家分店**的运营加成。
 *
 * ★ 为什么加成只作用于一家店（而不是全局）：
 *   全局加成会让「招店长」退化成「花钱买一个总加成」——
 *   玩家会无脑把所有资源砸在同一处，分店之间的经营差异被抹平。
 *   限定到单店之后，"先开哪家店、配什么店长"才是真决策。
 *
 * ★ 数值刻意压得比"再开一家分店"（+60% 客流）低一档：
 *   金牌店长的全额加成约等于 +12% 客流 +8% 效率。
 *   若店长能顶掉开分店的收益，玩家就会停止扩张、分店系统被架空。
 *
 * @param {number} branch 工位所属分店
 * @returns {{speed: number, sat: number, rep: number, ops: number}}
 *   speed 服务速度倍率 | sat 满意度权重 | rep 口碑权重 | ops 客流倍率
 */
function managerBonus(s, branch) {
  const m = managerOfBranch(s, branch);
  if (!m) return { speed: 1, sat: 1, rep: 1, ops: 1 };
  const r = managerRank(m.lv).mult;
  const tr = managerTrait(m).id;
  /* 基础加成随等级线性、按 mult 微调。
     ★ Lv.1 保底给一点点（≈2%），而不是精确的 0 ——
       UI 上写「客流 +0%」会让玩家觉得这店长白招，
       而"招了就有点用"和"完全没区别"在体验上是两件事，
       何况Lv.1 店长的日薪本来就低。 */
  const q = clamp((num(m.skill, 1) - 0.85) * 0.6, 0, 0.35);   /* 能力值微调 */
  const lvBonus = 0.04 + (r - 1) * 0.5 + q;/* 基础 4% + 等级 + 能力 */
  /* ★ V13.4：叠加「组合加成」（团队层面的配合，跨店全局生效）。
     组合是**全局**的 —— 一旦集齐，整个管理团队形成配合，所有店都受益。
     这样两层分工清晰：
       · 单店特性（ops/qc/lean/hosp）→ 只作用于**他那家店**（个人层）
       · 组合加成（brand/leanOps/…） → 所有店都吃到（团队层）
     玩家的决策因此是「**招什么特性**」+「**放谁去哪家店**」两件事。 */
  const cb = managerComboBonus(s);
  /* ★ V13.7：叠加「专精」（个体层面的取舍）。
     专精一个方向 → 该方向 ×(1+up)，其余方向 ×(1-down)。
     ★ 有减益才有决策 —— 全都要等于没专精。
     ★ 与组合加成的关系：组合是**团队层**（跨店全局），
       专精是**个体层**（只对他那家店）。两者相乘，互不冲突。 */
  const sp = managerSpecialtyMul(m);
  return {
    speed: (1 + lvBonus * 0.20 + (tr === 'ops' ? 0.02 : 0)) * cb.speed * sp.speed,
    sat: (1 + lvBonus * 0.30 + (tr === 'qc' ? 0.50 : 0)) * cb.sat * sp.sat,
    rep: (1 + lvBonus * 0.25 + (tr === 'hosp' ? 0.40 : 0)) * cb.rep * sp.rep,
    ops: (1 + lvBonus * 0.28 + (tr === 'ops' ? 0.08 : 0)) * cb.ops * sp.ops,
  };
}

/**
 * 店长专精的倍率（V13.7）
 *
 * ★ 脏存档要防：spec 塞一个字典外的方向 id → 找不到就当没专精，
 *   不能凭乱写就白得 +20%。
 *
 * @param {object} mgr 店长
 * @returns {{speed:number, sat:number, rep:number, ops:number}} 乘数
 */
function managerSpecialtyMul(mgr) {
  const out = { speed: 1, sat: 1, rep: 1, ops: 1 };
  if (!mgr) return out;
  const sid = mgr.spec;
  if (!sid) return out;
  const f = MANAGER_SPECIALTY.fields.find(x => x.id === sid);
  if (!f) return out;                 /* 字典外 → 当作没专精 */
  const cfg = MANAGER_SPECIALTY;
  out[f.field] = 1 + cfg.up;
  for (const k of ['speed', 'sat', 'rep', 'ops']) {
    if (k !== f.field) out[k] = 1 - cfg.down;
  }
  return out;
}

/**
 * 专精可不可用（V13.7）
 * @returns {{ok:boolean, why:string}}
 */
function managerCanSpecialty(s, mgr) {
  if (!mgr) return { ok: false, why: '没有店长' };
  if (num(mgr.lv, 1) < MANAGER_SPECIALTY.minLv) {
    return { ok: false, why: `Lv.${MANAGER_SPECIALTY.minLv} 起才能专精` };
  }
  return { ok: true, why: '' };
}

/**
 * 设置店长的专精方向（V13.7）
 *
 * ★ 切换要付**能力值代价**（switchCost）——
 * 这是"专精有取舍"的关键：不能零成本换来换去。
 * ★ 首次专精免费（还没专精过），切换才收费。
 */
function managerSetSpecialty(s, mgrId, specId) {
  const mgr = managerById(s, mgrId);
  if (!mgr) return { ok: false, msg: '店长不存在' };
  const can = managerCanSpecialty(s, mgr);
  if (!can.ok) return { ok: false, msg: can.why };
  const f = MANAGER_SPECIALTY.fields.find(x => x.id === specId);
  if (!f) return { ok: false, msg: '专精方向不存在' };
  if (mgr.spec === specId) return { ok: false, msg: '已经是这个专精了' };
  /* 切换代价：能力值 -0.1（首次专精免费） */
  if (mgr.spec) {
    const before = num(mgr.skill, 1);
    mgr.skill = clamp(num(mgr.skill, 1) - MANAGER_SPECIALTY.switchCost, 0.5, 2);
    pushLog(s, `🔄 ${mgr.name} 改专精为「${f.name}」（能力 ${before.toFixed(2)} → ${num(mgr.skill).toFixed(2)}）`);
  } else {
    pushLog(s, `🎯 ${mgr.name} 开始专精「${f.name}」`);
  }
  mgr.spec = specId;
  return { ok: true, msg: `已专精「${f.name}」` };
}

/**
 * 组合加成：已任命的店长之间形成的搭配（V13.4）
 *
 * ★ 判定只看**已任命**的店长（s.managers），不含候选池——
 *   候选还没上任，不该触发「团队配合」。
 *
 * ★ 特性用 managerTrait() 的**兜底后** id 判定：
 *   脏存档可能塞了字典外的 trait id，若用原始 id 比对，
 *   一个不存在的特性也可能凑成组合（凭空白送加成）。
 *
 * @returns {{speed:number, sat:number, rep:number, ops:number}} 乘数（默认全 1）
 */
function managerComboBonus(s) {
  const out = { speed: 1, sat: 1, rep: 1, ops: 1 };
  const actives = managerComboView(s);
  for (const c of actives) {
    /* ★★ 必须判 active —— 只判 c.combo 存在的话，
       **没集齐的组合也会被乘上去**（白送加成）。
       这个 bug 是写 U2c 断言时被抓出来的 ——
       「没招店长时组合乘数全为 1」这条判据直接把它照出来了。 */
    if (!c || !c.active || !c.combo) continue;
    if (c.combo.mul.speed) out.speed *= c.combo.mul.speed;
    if (c.combo.mul.sat) out.sat *= c.combo.mul.sat;
    if (c.combo.mul.rep) out.rep *= c.combo.mul.rep;
    if (c.combo.mul.ops) out.ops *= c.combo.mul.ops;
  }
  return out;
}

/**
 * 组合加成视图：哪些组合已激活 / 还差什么（V13.4）
 *
 * @returns 数组，每项：
 *   { combo, active, have, need, missing }
 *   have   —— 已具备的特性 id（去重）
 *   need   —— 组合要求的特性 id 列表
 *   missing—— 还缺哪些
 */
function managerComboView(s) {
  const have = new Set();
  for (const m of (s.managers || [])) {
    if (!m) continue;
    have.add(managerTrait(m).id);
  }
  return MANAGER_COMBOS.map(combo => {
    const need = combo.traits.slice();
    const missing = need.filter(t => !have.has(t));
    return {
      combo,
      active: missing.length === 0,
      have: need.filter(t => have.has(t)),
      need,
      missing,
    };
  });
}

/** 店员效率系数 */
function staffMult(s, st) {
  if (!st) return 1;
  let m = st.skill;
  if (st.trait === 'fast') m *= 1.16;
  if (st.trait === 'green') m *= 0.9;
  if (st.stamina < 30) m *= 0.62;
  else if (st.stamina < 60) m *= 0.85;
  return m;
}
/** 出杯耗时（**未夹下限**）。
 *  ★ V21 拆出来是为了能判断"是否已触底"：
    `serviceTimeOf` 会把结果夹到 MIN_SERVICE(0.4s)，而 `stationTime` 在除完店长加成后
    **又夹了一次** —— 于是只要原始值 ≤0.4，任何后续加成（店长速度、极速出杯卡）
    都会被第二次夹回去，效果恒等于 1。
    症状是"后天加成全部死掉"，而界面上"速度 +18%"还挂着 ——
    玩家花 ¥3000 买的店长一点用没有，也看不出来。
    有了未夹版本，才能回答"这一级买下去还真的更快吗"。 */
function serviceRaw(s, worker, sim) {
  /* ★ V21：training 已不在这里 —— 它改挂"每杯成本"（见 data.js 的 TRAINING_COST_CUT）。
     两个升级抢同一个分母，等于让玩家买两条会互相贬值的东西。 */
  let t = CFG.BASE_SERVICE / (1 + 0.20 * s.up.speed);
  if (worker) t /= staffMult(s, worker);
  if (sim && sim.rushUntil > sim.t) t *= 0.55;
  t /= cardMul(s, 'speed');       /* 🃏 策略卡：极速出杯更快、自助点单机更慢 */
  return t;
}
function serviceTimeOf(s, worker, sim) {
  return Math.max(CFG.MIN_SERVICE, serviceRaw(s, worker, sim));
}

/** 工位上的服务耗时（含店长运营加成）。
 *  ★ 单独一个函数而不是给 serviceTimeOf 加参数：
 *    serviceTimeOf 在很多地方被调（包括不涉及具体工位的预估），
 *    加一个可选参数就会出现"有的调用忘了传"—— 那种 bug 是概率性的，
 *    很难查。工位是明确的、有 branchIdx 的对象，在这里取最稳。 */
function stationTime(s, st, sim) {
  const base = serviceTimeOf(s, st.worker, sim);
  /* ★★ V21：`branchIdx >= 2` → `>= 1`（总店店长也生效），理由见 completeOrder 里那段长注释。
     一句话：名额从 V12 起就把总店算进去了，加成却不给总店，
     等于玩家花 ¥3000+ 日薪买了一个"什么都不做"的店长。 */
  if (!st || !(st.branchIdx >= 1)) return base;
  const mb = managerBonus(s, st.branchIdx);
  /* ★ mb.speed 必须先夹到 >0 再做除法 ——
     原来的写法是 `Math.max(MIN_SERVICE, base / mb.speed)`，
     它防住了「结果太小」但没防住「除数为 0」：
     mb.speed 一旦变成 0（脏存档 / 将来组合带减益 / 专精减益叠加到极限），
       就是 Infinity → `progress += dt / Infinity` → 出杯永远卡住，
       而且**不报错**（Infinity 不抛异常，只是工位再也不出杯）。
     实测当前最小值 0.49（专精 -5%），暂时安全 —— 但那是"恰好安全"不是"设计安全"。
     ★ 所以在除**之前**夹住分母。 */
  const spd = Math.max(0.05, num(mb.speed, 1));
  return Math.max(CFG.MIN_SERVICE, base / spd);
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
    /* ★ V14.4：用 SAVE_VERSION，不再写死 2
       （原来写死 2，往后每次升版本都要记得改这里，漏一次就存出读不回来的档）。 */
    v: SAVE_VERSION, diff: d.key, day: 1, cash: d.cash + startBonus, rep: 26,
    inv: { tea: 34, milk: 30, sugar: 24, pearl: 22, fruit: 16 },
    avgCost: {}, prices: {}, prevPrices: {},
    recipes: ['boba'], menu: ['boba'], ratios: { boba: 1.0 },
    up: { speed: 0, decor: 0, menu: 0, storage: 0, training: 0, auto: 0 },
    shops: 1, shopSpend: 0, invested: 0,
    /* V12 店铺体系：s.stores 是权威（店数/位置/名称/等级/独立账本/托管），
       s.shops 降级为它的派生值（s.stores.length）。
       ★ 初始只有总店（branch 1，主店）。 */
    stores: [], nextStoreId: 1,
    staff: [], candidates: [], nextStaffId: 1,
    candCd: 0,          /* V17 候选人手动刷新冷却（秒）*/
    /* V11 店长系统：已招店长 / 各分店候选池 / 店长 id 计数器 */
    managers: [], mgrCand: {}, nextMgrId: 1,
    /* V13.6：常客档案 id → { id, type, face, fav, name } */
    regulars: {},
    weather: WEATHERS[1], trend: 'milky', nextTrend: 'fruity', trendKnown: false,
    news: null, newsFx: null, marketing: 0, dayMarketing: 0, eventTrafficMul: 1,
    doneEvents: [],
    phase: 'prep', sim: null, report: null, pendingEvent: null,
    debtDays: 0, lastReport: null, prevReport: null, lastMarketing: 0, msHit: [],
    bpBonus: bpBonus || 0,
    startBonus: startBonus,
    stats: { totalCups: 0, totalRevenue: 0, totalProfit: 0, bestDayProfit: 0, totalLost: 0, totalServed: 0, clicks: 0, days: 0, lastDayCups: 0 },
    /* V10 城市经营痕迹：
       citiesVisited —— 已经营过的城市 id（去重）。由 setVenueCity 追加。
       stayDays     —— 在**当前城市**连续经营的天数，换城市归零。
         用途是成就「不打烊的城市」（单局 30 天不换城）。
         ★ 必须真实维护，不能靠成就 check 里现算：
           check 是纯函数、无副作用，算"今天是不是第几天"需要跨天状态，
           放在 check 里就等于每次判定都重算一遍历史，最容易出错。 */
    citiesVisited: [], stayDays: 0,
    flags: {}, ach: {}, log: [], cards: [], cardOffer: null,
    tut: { active: false, step: 0, done: false },
    history: [], endless: false, milestone: 0, daily: false, milestoneHit: false,
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
  /* V10：开局就算去过默认城市（否则「跨城游商」要白换两次城才计数）。 */
  s.citiesVisited = [CITY_DEFAULT];
  for (const g of ING) { s.prices[g.id] = g.base; s.prevPrices[g.id] = g.base; s.avgCost[g.id] = g.base; }
  rollWeather(s); rollTrend(s); rollNews(s);
  refreshCandidates(s, true);
  /* ★ V12：建好总店（branch 1，主店）。
     少了这一步，s.stores 是空数组 → syncShopCount 会把 s.shops 算成 0，
     之后 openStore 开出的第一家店拿到 branch 2（跳过 1），
     表现为「店号与店数错位」：有 1 家店但它叫第 2 家。
     这个 bug 静默发生（不报错），所以必须在这里显式建店。 */
  s.stores.push(makeStore(s, {
    branch: 1, id: 1, isMain: true, name: '总店', emoji: '🏠',
    cityId: (s.venue && s.venue.cityId) || '110100',
  }));
  syncShopCount(s);
  s.nextStoreId = 2;
  /* ★ 总店也可以任命店长（V12），所以开局就要有总店的候选店长，
     否则玩家进游戏看到「1 个名额」却一个候选人都招不了。*/
  refreshManagerCandidates(s, 1, true);
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
/**
 * 最终目标（通关线）—— 不随天数变化。
 *
 * ★ 这是**结算口径**：30 天结束时净资产要达到它才算通关。
 *   UI 不要直接用它 —— 玩家在第 3 天看到「离 38000 还差 34000」毫无意义。
 *   UI 要的是 nextGoalOf()（下一锚点）。
 */
function goalOf(s) {
  const d = diffOf(s);
  return s.endless ? endlessGoal(d.goal, s.milestone || 0) : d.goal;
}

/**
 * 流失归因（V21）
 *
 * ★ 为什么放在引擎层：两版 UI 都要显示，各写一份必然漂移
 *   （历史上口径漂移已经坑过几次，比如「达标率」与「完成度」混用）。
 *
 * ★ 只返回**非零**项并按数量降序：
 *   结算页是一屏信息，玩家不会逐条读。
 *   把「流失 12（等太久 8 · 太贵 3 · 没座 1）」按主因排前面，
 *   他才知道明天该先修哪一个 —— 这是"少想一步"的全部意义。
 *
 * @returns {{k:string, v:number, tip:string}[]}  已排序、已过滤零值
 */
function lostBreakdown(r) {
  if (!r) return [];
  const rows = [
    { k: '等太久', v: num(r.waitLost, 0), tip: '加出杯位 / 升级效率 / 招人' },
    { k: '嫌太贵', v: num(r.priceLost, 0), tip: '调低价格倍率或上架便宜款' },
    { k: '没座位', v: num(r.fullLost, 0), tip: '升级装修扩队列' },
    { k: '缺料', v: num(r.stockout, 0), tip: '备货补足常用料' },
    { k: '没排到', v: num(r.closedLost, 0), tip: '打烊清场时还在排队（产能不足）' },
  ];
  return rows.filter(x => x.v > 0).sort((a, b) => b.v - a.v);
}

/**
 * 下一步经营建议（V20）
 *
 * ★ 为什么需要它：
 *   结算弹窗原来只做**回顾**（今天赚了多少、流失了谁），
 *   玩家看完知道「昨天怎样」，但不知道「明天该干什么」。
 *   ★ 30 天的经营游戏，每天的决策依据应该来自结算 ——
 *     而现在每天结束时游戏什么都不告诉他，
 *     他只能自己回想昨天哪出了问题（而昨天可能已经记不清了）。
 *   ★ 有了阶段目标之后更该有：目标是「Day 20 要到 ¥21400」，
 *     但「怎么到」要靠每天的建议补上。
 *
 * ★ 规则**按严重度排序**，只给一条最该做的：
 *   一次给五条建议等于没给 —— 玩家会全部略过。
 *   严重度顺序：会亏钱 > 会达不到目标 > 效率低 > 一切正常
 *
 * ★ 返回结构化数据而不是字符串：
 *   UI 只负责显示，措辞调整不该动引擎。
 *
 * @returns {{kind:string, icon:string, text:string, prio:number}}
 */
function nextAdvice(s) {
  const r = s.report;
  if (!r) return { kind: 'none', icon: '📋', text: '照常经营', prio: 0 };

  const nw = num(netWorth(s), 0);

  /* ① 亏损 —— 最紧急（会破产） */
  if (num(r.net, 0) < 0) {
    return {
      kind: 'loss', icon: '⚠️', prio: 100,
      text: `今天净亏 ${money(-r.net)}。先降成本：房租日薪减一名，或把客流量调到稳赚的水平。`,
    };
  }

  /* ② 缺料流失 —— 白流失的客人最可惜 */
  if (num(r.stockout, 0) > 0) {
    return {
      kind: 'stockout', icon: '📦', prio: 90,
      text: `${r.stockout} 位顾客因为缺料走了。明天备货时把这几样补足 —— 这是最不该丢的客人。`,
    };
  }

  /* ③ 阶段目标告急 */
  const ms = milestoneOf(s);
  if (ms && !ms.hit) {
    /* ★ 剩余天数用来看紧迫度，而不是看差多少 ——
       差 ¥5000 看着吓人，但还剩 15 天就完全来得及。 */
    const left = Math.max(0, CFG.DAYS - num(s.day, 1));
    /* 按「剩余天数能赚多少」估算可达性：
       实测第 10 天到第 30 天净增约 35000，取日均 1750 做粗估 */
    const reach = left * 1750;
    const gap = -ms.gap;
    if (gap > reach * 0.8 && left <= 15) {
      return {
        kind: 'urgency', icon: '🏁', prio: 80,
        text: `还剩 ${left} 天，阶段目标 ${money(ms.worth)} 还差 ${money(gap)} —— 时间有点紧了，考虑扩产线或加店面。`,
      };
    }
    if (gap > 0) {
      return {
        kind: 'target', icon: '🎯', prio: 40,
        text: `距离阶段目标 ${money(ms.worth)} 还差 ${money(gap)}，还有 ${left} 天，按现在的节奏够得着。`,
      };
    }
  }

  /* ④ 价格劝退 */
  if (num(r.priceLost, 0) > 3 && num(r.priceLost, 0) > num(r.lost, 0) * 0.4) {
    return {
      kind: 'price', icon: '💸', prio: 50,
      text: `${r.priceLost} 位顾客嫌贵走了。把价格倍率调回 1.0 附近，或上架一款便宜些的。`,
    };
  }

  /* ⑤ 员工人均产能过载 —— 该招人了
     ★ 判断用「工位数」而不是客流：stationCount = 1（老板）+ 员工数。
       真正的信号是**员工数是否已经很少而营收在涨**——
       说明玩家没招人却还在赚钱，产能就是瓶颈。
     ★ 之前这里写了一个不存在的 freeStationsOf（又是猜函数名），
       改成下面这个真实可算的条件。 */
  if (num(s.staff.length, 0) <= 1 && num(r.orders, 0) > 40) {
    return {
      kind: 'staff', icon: '🧑‍🍳', prio: 60,
      text: `今天接了 ${r.orders} 位顾客却只有 ${stationCount(s)} 个出杯位，招人能直接提产能。`,
    };
  }

  /* ⑥ 一切正常 */
  return {
    kind: 'ok', icon: '👍', prio: 0,
    text: '今天运转正常。保持节奏，注意别让员工体力掉太低。',
  };
}

/**
 * 当前阶段目标（V14）—— **UI 应该显示的这个**
 *
 * ★★★ 为什么要分两个（这是 V14 最重要的一处改动）：
 *
 *   原来 goalOf() 一个数撑起全部 30 天，导致进度条：
 *     第 1 天  2%（离 38000 差 34000 —— 开局就"欠 3 万 4"）
 *     第 15 天 30%
 *     第 30 天 100%
 *   中间 29 天这条 bar 提供**零信息** —— 数字不动，玩家不知道
 *   「今天是领先还是落后」「下一步该冲多少」。
 *   探针实测：Day1~Day30 目标恒为 38000，一动不动。
 *
 *   而项目**本来就有中期锚点**（MILESTONE_RATIO: 9%→17%→28%→42%→58%→100%），
 *   设计是对的，只是 UI 没把它显示出来。
 *
 *   现在：进度条指向**下一个锚点**，且全程目标降低到第 3 天。
 *   玩家每一天都能回答「今天够不够」—— 这才是仪表盘的作用。
 *
 * @returns {{value:number, final:number, idx:number, atDay:number,
 *            reached:boolean, nextAt:number|null, phase:number}}
 *   value   当前该冲的数（锚点值）
 *   final   最终通关线
 *   idx     当前处在第几个锚点（0-based）
 *   atDay   当前锚点的天数（5/10/…/30）
 *   reached 这个锚点是否已达成
 *   nextAt  下一个锚点的天数（没有则 null = 已到终点）
 *   phase   本阶段进度 0~1（用于把"距下一锚点"折成条）
 */
function nextGoalOf(s) {
  const final = goalOf(s);
  const nw = num(netWorth(s), 0);
  /* 无尽模式只有一个滚动目标，直接返回（里程碑本身就是分段） */
  if (s.endless) {
    return {
      value: final, final, idx: 0, atDay: num(s.day, 1),
      reached: nw >= final, nextAt: null, phase: final > 0 ? nw / final : 0,
    };
  }
  const R = MILESTONE_RATIO;
  const day = clamp(num(s.day, 1), 1, CFG.DAYS);
  /* 当前处于第几个阶段：Day1~5 是第 0 个锚点，Day6~10 是第 1 个… */
  let idx = Math.min(R.length - 1, Math.ceil(day / MILESTONE_EVERY) - 1);
  idx = Math.max(0, idx);
  /* ★★ V20.3：这里原来算 `final * R[idx]`（比例口径），
     而 milestoneOf 已改成每档独立的**绝对值**锚点（STAGE_GOALS）。
     ★ 结果是**两端口径不一致** ——
       H5 端显示绝对值锚点，小游戏端显示比例锚点，
       同一局游戏两个端显示的目标金额不一样。
     ★ 而且它还导致 CI 失败：
       小游戏冒烟的「锚点日显示 ✔ 已达第 N 阶段目标」在 Linux 上失败，
       而本地 Windows 通过 —— 差异来自两端口径不同导致的边界情况。
     ★ 现在统一走 milestoneOf 的口径（绝对值）。 */
  const ms = milestoneOf(s);
  const value = ms ? ms.worth : Math.round(final * R[idx]);
  const atDay = Math.min(CFG.DAYS, (idx + 1) * MILESTONE_EVERY);
  const reached = nw >= value;
  const nextIdx = idx + 1;
  const nextAt = nextIdx < R.length ? Math.min(CFG.DAYS, (nextIdx + 1) * MILESTONE_EVERY) : null;
  /* ★ 阶段进度用「本阶段起点」做分母：
     直接用 value 做分母的话，第 5 天刚过锚点、进度会瞬间从 100% 掉回很低
     （因为分母跳到下一个锚点）—— 视觉上像"倒退"，很泄气。
     所以分母 =本阶段区间宽度，进度条表达的是「这段路走了多少」。 */
  const prevValue = idx > 0 ? Math.round(final * R[idx - 1]) : 0;
  const span = Math.max(1, value - prevValue);
  const phase = clamp((nw - prevValue) / span, 0, 1);
  return { value, final, idx, atDay, reached, nextAt, phase };
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
function refreshCandidates(s, auto) {
  /* ★ V17：手动刷新的冷却。
   * 原来只有 `if (force && RNG.next() < 0.25) return;` ——
   * 也就是说**每天自动刷新有 75% 概率触发**。
   * ★ 一旦给玩家一个「刷新」按钮而没有冷却，
   *   玩家会连点刷到出 SSR（skill 1.35 + 有特质）为止 ——
   *   招聘就变成了「按刷新键直到中奖」，经营决策被瓦解。
   *
   * ★ 参数语义改了（原来叫 force，现在叫 auto）：
   *   auto=true  → 系统行为（每日刷新、店长兜底招人）——
   *                 **不受冷却限制**，否则可能出现
   *                 「冷却中 → 每天不刷 → 店长永远招不到人」
   *   auto=undefined → 玩家手动点刷新 —— 走冷却
   * ★ 改名是必须的：原来那个 force 的字面意思
   *   「强制」会让人以为能绕过一切检查，那是错的。 */
  if (!s) return { ok: false, msg: '无局面' };
  if (!auto) {
    const cd = num(s.candCd, 0);
    if (cd > 0) {
      return { ok: false, msg: `还要等 ${Math.ceil(cd)} 秒`, cd: cd };
    }
  }
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
  /* ★ 只有**手动**刷新才进入冷却。
   ★ 系统刷新（每日自动 / 店长兜底 / 开局初始化）**不设冷却** ——
     否则玩家开局点第一下刷新就看到「还要等 8 秒」，
     而此时玩家根本没刷新过 —— 表现为「按钮是坏的」，
     第一次交互就坏掉是最差的体验。
   ★ 8 秒的取法：
     · 短到不会觉得「按不动」（3 秒以下会像坏了）
     · 长到连点 8 次才能凑出一屏候选（否则就是纯刷运气）
   ★ 冷却期间 hireStaff 仍能招已有候选人 ——
     冷却只限制「换一批」，不该限制「用手上这批」。 */
  if (!auto) s.candCd = CAND_REFRESH_CD;
  return { ok: true, n: s.candidates.length, cd: num(s.candCd, 0) };
}

/** 候选人手动刷新冷却（秒） */
const CAND_REFRESH_CD = 8;

/* ---------------- 采购 / 库存 ---------------- */
function buyIng(s, id, qty, markup) {
  /* 校验必须走在算术前面：qty 为 NaN 时所有比较都是 false，
     会一路放行并把 NaN 写进 s.cash，整局存档就此废掉。 */
  qty = Math.round(num(qty, 0));
  if (!(qty > 0)) return { ok: false, msg: '数量无效' };
  if (!ingById(id)) return { ok: false, msg: '原料不存在' };
  /* ★★ V21：仓库装不下时**不再整单拒绝**，而是买得下多少算多少。
     ★ 原来的写法是 `if (invUsed + qty > cap) return {ok:false,'仓库装不下了'}` ——
       整单失败、一个都不进。于是"手动加料"变成撞墙行为：
       玩家想买 60 个，只剩 20 个位置，结果**一粒都没买进来**，
       还得回去数还剩多少仓位再改数字重试。
     ★ 这也是「手搓口径」比「一键补货」弱一大截的原因之一：
       一键补货自己按剩余仓位算，从不触发这条；手搓则每次都可能被拒。
       一个只会惩罚"手动操作"的规则，等于在教玩家"别动脑，点按钮"。
     ★ 语义上本来也该是部分成交：仓库是容器，装满就是装满，
       不存在"因为你多要了 30 个，所以连能装的 20 个也不给"。
     ★ 现金不足仍保持整单拒绝 —— 那个玩家能直观理解（钱不够就是不够），
       而且部分成交会让"我点了一下怎么没买满"变得难解释。 */
  const room = Math.max(0, storageCap(s) - invUsed(s));
  if (room <= 0) return { ok: false, msg: '仓库已满（清仓或升级冷链）' };
  let capped = false;
  if (qty > room) { qty = room; capped = true; }
  /* ★★ V21：原料成本卡（中央厨房/批发采购）的折扣必须落在**买入价**上。
     ★ 原来 cardMul('cogs') 只乘在 sim.cogs（打烊时的成本统计）上，
       而净利 net 只用于报表 —— 真正的现金是「买入时扣」+「打烊扣工资租金」。
       于是"原料成本 −14%"把报表数字改小，玩家一分钱没少花，
       而同一张卡的代价（工资 +7%/租金 +6%）**是真扣现金的**。
       实测：kitchen/bulk 两张降本卡在 12 局里都是净负，正是这个原因。
     ★ 折扣放在 unit 上，买入即便宜；同时 costOf 也乘同一个系数，
       保证「菜单上的毛利」和「实际花的钱」是同一个数。 */
  const cogMul = cardMul(s, 'cogs');
  const unit = num(s.prices[id], 0) * (markup || 1) * cogMul;
  const cost = unit * qty;
  if (cost > s.cash) return { ok: false, msg: '现金不足' };
  const old = s.inv[id] || 0;
  s.avgCost[id] = (s.avgCost[id] * old + unit * qty) / (old + qty);
  s.inv[id] = old + qty;
  s.cash -= cost;
  /* ★ V13.9：抄底判定改用 CFG.BARGAIN_RATIO（0.78）。
     原代码写死 `base * 0.7`，而日常波动下限就是 0.72 ——
     差一点点，导致 90% 玩家拿不到「抄底大师」。
     阈值与"价格显示为绿色"的染色阈值必须一致，
     否则会出现「界面显示绿色但没算抄底」或反之。 */
  if (!markup && unit <= ingById(id).base * CFG.BARGAIN_RATIO) s.flags.bargain = true;
  bumpQuest(s, 'restock', 1);
  /* capped=true 表示"只买进了仓库放得下的量"，UI 拿它提示玩家，
     否则玩家会以为自己的数量被吞了。 */
  return { ok: true, cost, qty, capped };
}
/**
 * 清仓：按当前市价的一部分回收库存原料（V13.9）
 *
 * ★★ 为什么必须有这个（这是玩家无解的死局）：
 *   仓库满时买不进需要的料，而原来**没有任何清理途径** ——
 *   玩家看着满仓的原料却什么都做不了，只能干等仓库升级。
 *   切城尤其致命：旧城的专属料留在仓库里，新城买不到也用不上，
 *   却占着仓位让需要的料进不来。
 *
 * ★ 为什么是「打折回收」而不是「免费丢弃」：
 *   免费丢弃会让囤货毫无风险（反正丢不掉），
 *   打折回收保留了「囤多了要付代价」的经济压力，
 *   同时给玩家一条**急用钱时变现**的路（这本身也是决策）。
 *   回购价 50%：低于进价的一半才亏，血本无归但不至于伤筋动骨。
 *
 * ★ 不返还声望/口碑、不计「抄底」flag —— 那是买入才有的行为。
 *
 * @param {object} s状态
 * @param {string} id   原料 id
 * @param {number} qty  数量（不传 = 全部）
 * @returns {{ok:boolean, msg?:string, got?:number, qty?:number}}
 */
function sellIng(s, id, qty) {
  const g = ingById(id);
  if (!g) return { ok: false, msg: '原料不存在' };
  const have = Math.floor(num(s.inv[id], 0));
  /* 数量校验与 buyIng 同口径：NaN / 负数 / 非数字都要挡住。
     ★ 用 Math.floor 而不是 Math.round —— 卖掉不该"四舍五入变多"。 */
  let n = qty == null ? have : Math.floor(num(qty, 0));
  if (!(n > 0)) return { ok: false, msg: '数量无效' };
  if (n > have) return { ok: false, msg: '库存不足' };
  const unit = num(s.prices[id], g.base) * CFG.LIQUID_RATE;
  const got = Math.max(0, Math.round(unit * n));
  s.inv[id] = have - n;
  /* ★ avgCost 必须同步下调，否则净资产虚高：
     卖 100 个成本 ¥2 的料、按 ¥1 回收后，
     avgCost 还停在 ¥2 → invValue 把已经卖掉的货也算进资产。 */
  if (s.inv[id] > 0) {
    s.avgCost[id] = num(s.avgCost[id], g.base);
  } else {
    s.avgCost[id] = g.base;   /* 清空后回到基准，避免下次买入被旧均价带偏 */
  }
  s.cash += got;
  return { ok: true, got, qty: n };
}

/**
 * 一键补货（V13.9 重写）
 *
 * ★★★ 为什么重写（原版三个实测出来的问题）：
 *
 * ① **填不满仓库** —— 原版给每种料 `Math.min(want, 40)` 的硬上限，
 *    空仓时 420 的容量只买到 200（48%）。
 *    玩家的体感是「点了没反应」，但控制台里明明花掉了钱——
 *    这是**最像 bug 的体验**，比真的报错更糟。
 *
 * ② **买了菜单用不上的料** —— 原版遍历全部 ING（32 种），
 *    按「剩余仓位平均分」决定买什么。
 *    菜单只用 3 种料时，另外 29 种会白占仓位（实测 5 种里有 1 种是废料），
 *    而真正需要的料反而没买够。
 *
 * ③ **仓位分配不均** —— 原版的 `target - invUsed(s) - bought`
 *    每轮都重算，但 `Math.min(want, 40)` 先把它砍到 40，
 *    所以「剩余仓位」这个信号其实从来没起作用。
 *
 * ★★★ 现在的做法：**按菜单真实需求分配，最后再兜底填满**。
 *   ① 算出每种料「菜单做 N 杯需要多少」—— N 取「够卖一天」，
 *      而不是拍一个常数；
 *   ② 按需求优先级（缺口最大的先买）分配剩余仓位与现金；
 *   ③ 有余量时再按「单价低 + 当前便宜」补满剩余仓位 ——
 *      这一步替代原来的「平摊 32 种料」。
 *
 * @param {object} s 状态
 * @param {object} [opt] { cups: 目标备货杯数 }
 *   不传 = 按一天的预估销量算；传 0 = 只补到菜单需求的 1杯（省着买）
 * @returns {{spent:number, bought:number, kinds:number}}
 */
/** 今日备货需求 —— **单一真相**，autoFill 与界面上的"还差多少"共用这一份。
 *
 *  ★ V21：这段原来只活在 autoFill 里。UI 想显示"这款今天还差多少"时，
 *    只能另写一套估算 —— 两套算法必然漂移（本项目已经因为
 *    "备货按降本后算、扣料按降本前扣"栽过一次）。
 *  ★ 用 reqOf（已含工坊降本），与 maxCupsFromStock 同口径。
 *
 *  返回 { wantCups, need:{ingId:qty}, gap:{ingId:qty} }
 */
function stockNeedOf(s, opt) {
  const wantCups = opt && opt.cups != null
    ? num(opt.cups, 0)
    : Math.max(1, Math.round(trafficOf(s) * avgCupsPerOrder(s) * 1.15));
  const need = {};
  for (const rid of (s.menu || [])) {
    const req = reqOf(s, rid);
    for (const k in req) need[k] = (need[k] || 0) + req[k] * wantCups / Math.max(1, s.menu.length);
  }
  const gap = {};
  for (const k in need) gap[k] = Math.max(0, Math.ceil(need[k] - num(s.inv[k], 0)));
  return { wantCups, need, gap };
}

function autoFill(s, opt) {
  const cid = currentCityId(s);
  const cap = storageCap(s);
  const priceOfIng = (id) => Math.max(0.1, num(s.prices[id], 1));

  /* ---------- ① 目标备货量：按菜单真实需求（见 stockNeedOf） ---------- */
  const { need, gap: gapOf } = stockNeedOf(s, opt);

  /* ---------- ② 按「缺口比例」排优先级 ---------- */
  /* ★ 排的是**缺口占比**而不是绝对缺口：
     缺 1 个茶叶（用量大）和缺 1 个香草（用量小），
     前者更紧急 —— 按绝对值排会把香草排前面。 */
  const plan = [];
  for (const k in need) {
    const gap = gapOf[k] || 0;
    if (gap <= 0) continue;
    const g = ingById(k);
    if (!g) continue;
    plan.push({ g, gap, urgent: gap / Math.max(0.1, need[k]) });
  }
  plan.sort((a, b) => b.urgent - a.urgent);

  let spent = 0, bought = 0, kinds = 0;
  const room = () => Math.max(0, cap - invUsed(s));
  /* ★ 现金预算：留两成周转金。
     原来那句「cash * 0.35 对每种料各算一次」的写法，
     25 种料累加起来会远超 35%，而且没有任何上界。 */
  let budget = Math.max(0, num(s.cash, 0) * 0.6);

  for (const it of plan) {
    if (room() <= 0 || budget <= 0) break;
    if (!ingAvailableAt(it.g.id, cid)) continue;
    const unit = priceOfIng(it.g.id);
    /* 想要买多少：受三个上限约束 —— 缺口、仓位、现金预算 */
    const qty = Math.max(0, Math.min(
      Math.floor(it.gap + 0.999),
      Math.floor(room()),
      Math.floor(budget / unit),
    ));
    if (qty <= 0) continue;
    const r = buyIng(s, it.g.id, qty);
    if (r.ok) {
      spent += r.cost; bought += r.qty; kinds++;
      budget -= r.cost;
    }
  }

  /* ---------- ③ 有余量再补满：优先「便宜且正在低价」的 ---------- */
  /* ★ 替代原来「平摊 32 种料」——
     只买**当前城市有售**的，且按「折扣力度」排序（越便宜越先买），
     这样玩家点完会看到「把便宜的都囤了」，而不是「每种都多了几个」。
     ★ 每种仍有软上限（不把仓位全压在一种上），
       否则会出现「仓库全是茶叶，一杯奶茶都做不了」。 */
  if (room() > 0 && budget > 0) {
    const extra = ING
      .filter(g => ingAvailableAt(g.id, cid))
      .map(g => ({ g, r: priceOfIng(g.id) / g.base }))
      .sort((a, b) => a.r - b.r);
    for (const it of extra) {
      if (room() <= 0 || budget <= 0) break;
      const cur = num(s.inv[it.g.id], 0);
      const softCap = Math.max(need[it.g.id] || 0, Math.ceil(cap * 0.35));
      if (cur >= softCap) continue;
      const unit = priceOfIng(it.g.id);
      const qty = Math.max(0, Math.min(
        Math.floor(softCap - cur),
        Math.floor(room()),
        Math.floor(budget / unit),
      ));
      if (qty <= 0) continue;
      const r = buyIng(s, it.g.id, qty);
      if (r.ok) { spent += r.cost; bought += r.qty; kinds++; budget -= r.cost; }
    }
  }

  return { spent, bought, kinds };
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

/* ---------------- V10：城市绑定与研发树 ---------------- */

/** 当前经营城市 id（老存档可能没有 venue，退回默认城市） */
function currentCityId(s) {
  const c = s.venue && s.venue.cityId;
  return cityById(c) ? c : CITY_DEFAULT;
}

/**
 * 该配方在当前城市**是否可用**（可上架 / 可被菜单引用）。
 *
 * ★ 口径：**已解锁但不在本店城市 = 保留但不可用**。
 *   不删除 s.recipes 里的条目 —— 那是玩家的研发投入，
 *   换个城市回来还能用（研发是跨城市资产）。
 *   这一点是刻意的：若解锁即绑定、换城即失效，
 *   玩家在第 5 天换城市会发现自己前面全白研了，
 *   那是惩罚而不是取舍。
 *
 * @param {boolean} unlockedOnly 只关心"能不能上架"（要求已解锁）
 */
function recipeAvailableAt(s, rid, unlockedOnly) {
  const r = recipeById(rid);
  if (!r) return false;
  if (unlockedOnly && !(s.recipes || []).includes(rid)) return false;
  /* city 为空 = 全国通用 */
  if (!r.city) return true;
  return r.city === currentCityId(s);
}

/** 当前城市可用的配方清单（已解锁 + 在本店城市） */
function availableRecipes(s) {
  return (s.recipes || []).filter(rid => recipeAvailableAt(s, rid, true));
}

/** 当前城市可用的菜系 id 列表：通用 5 系 + 本店城市的特色系 */
function availableCuisineIds(s) {
  const cid = currentCityId(s);
  const out = [];
  for (const c of CUISINES) {
    if (!c.city || c.city === cid) out.push(c.id);
  }
  return out;
}

/**
 * 研发树前置判定：该节点的 prereq 是否都已满足。
 * 前置节点对应的配方在 s.recipes 里即视为满足
 * （成就奖励的配方也算 —— 玩家拿到就是拿到，不该被树卡住）。
 */
function treePrereqOk(s, node) {
  const pre = (node && node.prereq) || [];
  for (const pid of pre) {
    const pn = treeNodeById(pid);
    /* 前置节点不存在 → 视为不满足（数据写错时要能被发现，而不是静默放行） */
    if (!pn) return { ok: false, msg: '前置数据缺失', missing: [pid] };
    if (!(s.recipes || []).includes(pn.recipe)) {
      const pr = recipeById(pn.recipe);
      return { ok: false, msg: `需先研发「${pr ? pr.name : pn.recipe}」`, missing: [pn.recipe] };
    }
  }
  return { ok: true, msg: '' };
}

/**
 * 研发树的展示模型（给 UI 用）。
 * 按「通用 / 各城市」分组，节点带状态：
 *   done    已解锁
 *   open    可研（在本城 + 前置满足）
 *   locked  前置未满足
 *   away    配方属于别的城市（不在本店，需换城）
 *
 * @param {string} cityFilter 空 = 显示全部（研发页默认按当前城市过滤，此处给完整树）
 */
function researchTree(s, cityFilter) {
  const cid = cityFilter === undefined ? currentCityId(s) : (cityFilter || '');
  const groups = [];
  const push = g => {
    const found = groups.find(x => x.city === g.city);
    if (found) return found;
    const city = g.city ? cityById(g.city) : null;
    const created = {
      city: g.city || '',
      cityName: city ? city.name : '通用配方',
      isHere: !g.city || g.city === cid,
      nodes: [],
    };
    groups.push(created);
    return created;
  };
  for (const n of RESEARCH_TREE) {
    const r = recipeById(n.recipe);
    if (!r) continue;
    const node = {
      id: n.id, recipe: n.recipe, stage: n.stage,
      prereq: n.prereq || [], city: n.city || '',
      name: r.name, emoji: r.emoji, cuisine: r.cuisine, price: r.price,
      cost: researchCost(s, n.recipe),
      done: (s.recipes || []).includes(n.recipe),
    };
    if (node.done) node.status = 'done';
    else if (n.city && n.city !== cid) node.status = 'away';
    else {
      const p = treePrereqOk(s, n);
      node.status = p.ok ? 'open' : 'locked';
      node.lockMsg = p.ok ? '' : p.msg;
    }
    push({ city: n.city || '' }).nodes.push(node);
  }
  /* 成就专属食谱单列一组：它们不在树上，要让玩家看见"还有别的东西" */
  const achGroup = {
    city: '', cityName: '成就奖励（不可研发）', isHere: true, nodes: [],
  };
  for (const r of ACH_RECIPES) {
    achGroup.nodes.push({
      id: 'ach_' + r.id, recipe: r.id, stage: 99, prereq: [], city: r.city || '',
      name: r.name, emoji: r.emoji, cuisine: r.cuisine, price: r.price,
      cost: null, done: (s.recipes || []).includes(r.id),
      status: (s.recipes || []).includes(r.id) ? 'done' : 'ach',
    });
  }
  groups.push(achGroup);
  groups.sort((a, b) => {
    if (!a.city) return -1;
    if (!b.city) return 1;
    return a.cityName < b.cityName ? -1 : 1;
  });
  return groups;
}

/* ---------------- 研发 ---------------- */

/**
 * 反向索引：某个原料能被**哪些配方**用（V16）
 *
 * ★ 为什么需要它：
 *   原料市场原来只显示「价格 / 库存 / 买入」——
 *   玩家看着一堆原料，**完全不知道该买什么**。
 *   「五种原料价格每天波动，看到绿色就囤」的教学也因此落不了地：
 *     囤来的料到底能做什么，不看研发树是不知道的。
 *   而研发树里���原料又是**纯文本**（🍵3(5)），点不了。
 *   ★ 两处合起来就是：原料↔配方这条关联链**两头都断**。
 *
 * ★ 返回的每条包含**两套不同的用量**，别混：
 *   perCup  配方 req里写的「每杯消耗」—— 影响毛利与能不能做
 *   rschFor 配方 research.ing 里写的「研发一次需要多少」—— 影响研发进度
 *   同一款配方上这两个数经常不同（研发要得多，做只用一点）。
 *
 * @param {string} ingId 原料 id
 * @returns {Array<{rid, emoji, name, perCup, rschFor, unlocked, available, cuisine}>}
 *   unlocked  = 玩家是否已解锁该配方
 *   available = 当前城市能否做（城市绑定配方在别处做不了）
 */
function recipesUsingIng(ingId) {
  const out = [];
  for (const r of RECIPES) {
    if (!r) continue;
    const perCup = r.req ? num(r.req[ingId], 0) : 0;
    const rschFor = r.research && r.research.ing ? num(r.research.ing[ingId], 0) : 0;
    if (!(perCup > 0) && !(rschFor > 0)) continue;
    /* ★ 这里**不判断**「是否已解锁 / 当前城市能不能做」——
       那是**局面相关**的（要看 s），而本函数是纯数据查询。
       早期版本在这里读全局状态，是错的设计：同一个原料在不同局面下
       答案不同，纯函数给不出正确答案。
       调用方（ui.js）拿到 s 后自己判断即可 —— 见 marketIngUsesHtml。 */
    out.push({
      rid: r.id, emoji: r.emoji, name: r.name,
      perCup, rschFor,
      cuisine: r.cuisine || null,
      city: r.city || null,
    });
  }
  /* ★ 排序：研发用料优先（研发是「现在就要买」的事），
     再按每杯消耗从大到小（用量大的更值得囤）。
     ★ 不按名称排 —— 玩家看的是"哪个更重要"，不是字母序。 */
  out.sort((a, b) => (b.rschFor - a.rschFor) || (b.perCup - a.perCup));
  return out;
}

/**
 * 正向查询：某个配方用哪些原料（V16）
 * @returns {Array<{id, emoji, name, perCup, rschFor, need}>}
 *   need = 研发所需（0 = 不参与研发，仅制作消耗）
 */
function ingsOfRecipe(rid) {
  const r = recipeById(rid);
  if (!r) return [];
  const out = [];
  const seen = {};
  const keys = Object.keys(r.req || {}).concat(Object.keys((r.research && r.research.ing) || {}));
  for (const k of keys) {
    if (seen[k]) continue;
    seen[k] = 1;
    const g = ingById(k);
    if (!g) continue;
    out.push({
      id: k, emoji: g.emoji, name: g.name,
      perCup: r.req ? num(r.req[k], 0) : 0,
      rschFor: (r.research && r.research.ing) ? num(r.research.ing[k], 0) : 0,
    });
  }
  return out;
}

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
  /* ★ V10：城市绑定 —— 只能在配方所属城市研发。
     这是**地域边界**而不是「花钱门槛」，玩家能在研发页按城市分组直接看懂，
     与 V9 实测中被证伪的那种"看不见的锁"性质不同（见 canListRecipe 注释）。 */
  if (r.city && r.city !== currentCityId(s)) {
    const c = cityById(r.city);
    return { ok: false, msg: `只能在${c ? c.name : '该城市'}研发` };
  }
  /* ★ V10：研发树前置。同阶段可并行，跨阶段按prereq 推进。 */
  const node = nodeByRecipe(rid);
  if (node) {
    const p = treePrereqOk(s, node);
    if (!p.ok) return { ok: false, msg: p.msg };
  }
  /* ★ V9 这里**刻意不对 tier3 配方加工坊门槛**。
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
    /* 城市专属原料在本城才有货 —— 否则会出现"要花椒但成都才有"的死锁 */
    if (!ingAvailableAt(k, currentCityId(s))) {
      const g = ingById(k);
      const oc = cityById(g && g.origin);
      return { ok: false, msg: `需在${oc ? oc.name : '原料产地'}才能买到${g ? g.name : k}` };
    }
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
/** 某项升级是否**已经买不出效果**（当前只用于 speed 的出杯下限）。
 *
 *  ★ V21：为什么需要这个判据而不是改 `max`：
 *    `MIN_SERVICE`(0.4s) 是一道硬下限，而触底等级**会随团队成长移动** ——
 *    逐日试算：D1 约 L12 触底（无员工、training 0）、D10 约 L7（招了人、training 上来）、
 *    D30 约 L8~L9。把 max 固定成任何值都会在某一头出错：
 *      固定 14 → D1 时过早封顶（还差 2 级有效）
 *      固定 8  → D10 之后仍卖死货
 *    所以判据必须是**算出来的**，不是常量。
 *  ★ 只做"提示"不做"禁售"：禁售会改变玩家（与模拟 AI）的花钱路径，
 *    而那会让刚标定完的三档目标再次失准。提示不改任何数值。
 */
function upgradeSaturated(s, id) {
  if (!s || id !== 'speed') return false;
  const lv = pos(s.up && s.up.speed, 0);
  /* 用"下一个等级"判断：当前已触底就不再有效果。无员工口径即可 ——
     员工熟练度只会让耗时更小，不影响"是否已经 <= 下限"的判断方向。 */
  const probe = Object.create(s);
  probe.up = Object.assign({}, s.up, { speed: lv + 1 });
  return serviceRaw(probe, null, null) <= CFG.MIN_SERVICE + 1e-9;
}

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
  /* s.shops 被脏存档改成 0 / 负数时，SHOP_COSTS[-1] 是 undefined,
     Math.round(undefined) 会得到 NaN 并一路传到现金里。 */
  const i = pos(s.shops, 1) - 1;
  if (i < 0 || i >= SHOP_COSTS.length) return null;
  return Math.round(SHOP_COSTS[i] * diffOf(s).costMult);
}

/* ============================================================
 *  V12 店铺体系（引擎层）
 *
 *  权威数据：s.stores[]（店数、位置、名称、等级、独立账本、托管标记）
 *  派生数据：s.shops = s.stores.length（保留给既有 19 处使用点）
 *
 *  ★ 同步点只有 syncShopCount() 一个 ——
 *    任何增删店的地方都必须调它。散落着写 s.shops = X 就会漂，
 *    而「店数漂了」的表现是客流/租金/名额全错，且不报错。
 * ============================================================ */

/** 同步 s.shops（派生值）。★ 增删店的唯一入口。 */
function syncShopCount(s) {
  s.shops = Array.isArray(s.stores) ? s.stores.length : 1;
  return s.shops;
}

/** 按 branch 店号取店（branch 1 = 总店） */
function storeByBranch(s, branch) {
  const st = arr(s.stores);
  for (const st0 of st) if (st0 && st0.branch === branch) return st0;
  return null;
}
function storeById(s, id) {
  for (const st of arr(s.stores)) if (st && st.id === id) return st;
  return null;
}
/** 主店（永远存在 —— 总店不可关闭） */
function mainStore(s) {
  const st = arr(s.stores);
  for (const st0 of st) if (st0 && st0.isMain) return st0;
  return st[0] || null;
}
/** 全部店铺（按 branch 升序） */
function allStores(s) {
  return arr(s.stores).slice().sort((a, b) => (a.branch || 0) - (b.branch || 0));
}
/** 托管给店长的店 */
function managedStores(s) {
  return allStores(s).filter(st => st.auto && st.managerId);
}
/** 玩家亲自经营的店（未托管） */
function playerStores(s) {
  return allStores(s).filter(st => !st.auto);
}

/** 店的店长对象（通过 store.managerId 反查） */
function storeManager(s, store) {
  if (!store || !store.managerId) return null;
  return managerById(s, store.managerId);
}

/** 同步 store.managerId ↔ manager.branch 双向一致。
 *  ★ 两处存了同一关系，**必须**有单一同步点。
 *   不一致的后果很具体：managerOfBranch 找到的店长和店里的店长不是同一个，
 *   于是「加成一店算两次、工资付两次」或者「店长管着别人的店」。
 */
function syncStoreManagers(s) {
  const st = arr(s.stores);
  for (const m of arr(s.managers)) {
    const store = storeByBranch(s, m.branch);
    if (store) store.managerId = m.id;
  }
  /* 反向：店长表里没有的，清掉店上的 managerId（脏存档会产生孤儿引用） */
  for (const st0 of st) {
    if (st0.managerId && !managerById(s, st0.managerId)) st0.managerId = null;
    /* 托管标记必须有店长，否则自动经营无从谈起 */
    if (st0.auto && !st0.managerId) st0.auto = false;
  }
}

/** 新建一个店对象 */
function makeStore(s, opts) {
  const o = opts || {};
  const branch = pos(o.branch, 1);
  const cityId = o.cityId || (s.venue && s.venue.cityId) || '110100';
  const geo = cityGeoOf(cityId) || GEO.FALLBACK;
  return {
    id: o.id || (num(s.nextStoreId, 1)),
    branch,
    name: str(o.name, 16) || '新店',
    emoji: o.emoji || '🏪',
    cityId,
    venueType: o.venueType || VENUE_DEFAULT,
    lng: num(o.lng, geo.lng),
    lat: num(o.lat, geo.lat),
    coordSys: GEO.COORD_SYS,
    isMain: !!o.isMain,
    level: pos(o.level, 1),
    exp: pos(o.exp, 0),
    auto: !!o.auto,
    managerId: o.managerId == null ? null : o.managerId,
    cash: pos(o.cash, 0),
    inv: o.inv || {},
    income: 0, expense: 0, cups: 0, days: 0,
    lastReport: null, history: [],
    upgrades: {},
  };
}

/**
 * 开一家新店。
 * @param {object} opts { cityId, venueType, name, lng, lat }
 * @returns {object} { ok, store, cost }
 */
function openStore(s, opts) {
  const o = opts || {};
  const c = shopCost(s);
  if (c == null) return { ok: false, msg: '已达分店上限' };
  if (s.cash < c) return { ok: false, msg: '现金不足' };
  const cityId = o.cityId || (s.venue && s.venue.cityId);
  if (!cityId || !cityById(cityId)) return { ok: false, msg: '请选择一个有效的城市' };
  const vt = o.venueType || VENUE_DEFAULT;
  if (!VENUE_TYPES.some(t => t.id === vt)) return { ok: false, msg: '场地类型无效' };

  const branch = pos(s.shops, 1) + 1;
  const store = makeStore(s, {
    branch,
    id: num(s.nextStoreId, 1),
    cityId, venueType: vt,
    name: str(o.name, 16) || defaultStoreName(s, cityId),
    lng: o.lng, lat: o.lat,
  });
  /* 划启动金：店长 AI 需要本钱才能买料付工资，
     否则托管的店永远是空转（详见 data.js MANAGER_START_CASH 的说明）。*/
  const start = Math.min(MANAGER_START_CASH, s.cash - c);
  store.cash = Math.max(0, start);

  s.stores.push(store);
  s.nextStoreId = num(s.nextStoreId, 1) + 1;
  syncShopCount(s);
  s.cash -= c; s.shopSpend += c;
  /* ★ 新店自带一笔启动金 —— 这笔钱从总部划出。
     若总部的钱不够全额划拨，start 会小于标准值（min 保护），
     店依然开得起来，但店长经营能力会弱一些（玩家能直观感到"钱不够"）。*/
  if (start > 0) s.cash -= start;

  /* V11：新店 → 立刻刷新该店的店长候选（因果链：开店 → 招店长） */
  refreshManagerCandidates(s, branch, true);
  const city = cityById(cityId);
  pushLog(s, `🏪 ${store.name} 在${city ? city.name : '新地'}开业！可招募一名店长`);
  return { ok: true, store, cost: c, startCash: start };
}

/** 默认店名：城市名 + 后缀（避开重名） */
function defaultStoreName(s, cityId) {
  const city = cityById(cityId);
  const base = city ? city.name.replace(/[市省]/g, '') : '新';
  const used = allStores(s).map(st => st.name);
  for (const suf of STORE_SUFFIX) {
    const nm = base + suf;
    if (used.indexOf(nm) < 0) return nm;
  }
  return base + (used.length + 1) + '号店';
}

/** 改名 */
function renameStore(s, branch, name) {
  const st = storeByBranch(s, branch);
  if (!st) return { ok: false, msg: '店铺不存在' };
  const nm = str(name, 16).trim();
  if (!nm) return { ok: false, msg: '店名不能为空' };
  st.name = nm;
  pushLog(s, `✏️ 店铺更名为「${nm}」`);
  return { ok: true, store: st };
}

/** 设为主店（原子操作：原主店自动取消，不会出现两家主店） */
function setMainStore(s, branch) {
  const st = storeByBranch(s, branch);
  if (!st) return { ok: false, msg: '店铺不存在' };
  if (st.isMain) return { ok: false, msg: '已经是主店' };
  for (const other of allStores(s)) other.isMain = false;
  st.isMain = true;
  pushLog(s, `⭐「${st.name}」升为主店`);
  return { ok: true, store: st };
}

/** 玩家接管 / 交给店长 */
function setStoreAuto(s, branch, auto) {
  const st = storeByBranch(s, branch);
  if (!st) return { ok: false, msg: '店铺不存在' };
  if (auto) {
    if (!st.managerId) return { ok: false, msg: '该店还没有店长，无法托管' };
    if (st.managerId && !managerById(s, st.managerId)) {
      st.managerId = null;
      return { ok: false, msg: '该店的店长已不在职' };
    }
  }
  st.auto = !!auto;
  const m = storeManager(s, st);
  pushLog(s, auto
    ? `🤖「${st.name}」交由店长${m ? m.name : ''}自动打理`
    : `✋ 玩家接管「${st.name}」`);
  return { ok: true, store: st, auto: st.auto };
}

/** 注资（总部 → 店）/ 提现（店 → 总部） */
function fundStore(s, branch, amount) {
  const st = storeByBranch(s, branch);
  if (!st) return { ok: false, msg: '店铺不存在' };
  const amt = Math.round(num(amount, 0));
  if (!(amt > 0)) return { ok: false, msg: '金额无效' };
  if (amt > s.cash) return { ok: false, msg: '总部现金不足' };
  s.cash -= amt; st.cash += amt;
  pushLog(s, `💰 向「${st.name}」注资 ${money(amt)}`);
  return { ok: true, store: st, amount: amt };
}
function withdrawStore(s, branch, amount) {
  const st = storeByBranch(s, branch);
  if (!st) return { ok: false, msg: '店铺不存在' };
  const amt = Math.round(num(amount, 0));
  if (!(amt > 0)) return { ok: false, msg: '金额无效' };
  if (amt > st.cash) return { ok: false, msg: '该店现金不足' };
  st.cash -= amt; s.cash += amt;
  pushLog(s, `💵 从「${st.name}」提现 ${money(amt)}`);
  return { ok: true, store: st, amount: amt };
}


/**
 * 打开分店（兼容入口）。
 * ★ V12 起真正的开店是 openStore()（带城市/场地/名称），
 *   但既有代码与测试大量调用 openShopBranch(s)（无参、默认城市），
 *   所以保留这个薄封装，让 19 处既有调用点一行都不用改。
 */
function openShopBranch(s, opts) {
  return openStore(s, opts || {});
}

/* ============================================================
 *  V11 店长系统（引擎层）
 *
 *  数据结构（存档字段）：
 *    s.managers[]    已招募店长 { id, name, emoji, lv, skill, trait, wage, branch, days }
 *    s.mgrCand{}     各分店的候选店长 { [branch]: [候选, ...] }
 *
 *  ★ 分店索引约定：branch 从 1 开始。
 *    branch = 1 是**总店**（玩家自己经营，不设店长）；
 *    branch >= 2 才是真正的分店，每家对应一名店长。
 *    于是"每新开设一家分店即可招募一名店长"=
 *    `managerCount + 1 === s.shops`，
 *    不会出现"开了 1 家店却有 2 个空槽"这种错位。
 * ============================================================ */

/** 已招募店长数 */
function managerCount(s) {
  return Array.isArray(s.managers) ? s.managers.length : 0;
}
/**
 * 还能招几名店长 = 店数 − 已招数。
 *
 * ★ V12 语义变更：原来是 `店数 − 1 − 已招数`（总店不设店长）。
 *   新需求明确「每家分店最多任命 1 名店长（**含主店**）」，
 *   所以总店也占一个名额 —— 店长也可以替玩家打理主店。
 *
 * ★ 连带影响：V11 的 probe N1 组断言的是旧语义（0/1/2…），
 *   必须同步更新，否则会出现「测试全绿但规则已错」的假象。
 *   这是数据模型变更最典型的配套遗漏。
 */
function managerSlotsLeft(s) {
  return Math.max(0, pos(s.shops, 1) - managerCount(s));
}
/** 某家店的店长（★ V12 起总店也可以有店长了） */
function managerOfBranch(s, branch) {
  if (!(branch >= 1)) return null;
  for (const m of (s.managers || [])) if (m.branch === branch) return m;
  return null;
}
function managerById(s, id) {
  for (const m of (s.managers || [])) if (m.id === id) return m;
  return null;
}
/** 店长特性（带兜底：脏存档可能塞了字典外的 trait id） */
function managerTrait(mgr) {
  const t = MANAGER_TRAITS.find(x => x.id === (mgr && mgr.trait));
  return t || MANAGER_TRAITS[MANAGER_TRAITS.length - 1];
}
/** 店长等级对应的能力倍率 */
function managerRank(lv) {
  return MANAGER_RANKS.find(x => x.lv === lv) || MANAGER_RANKS[0];
}
/** 招募费用：按已招店长数递增，再乘难度系数 */
function managerCost(s) {
  const i = managerCount(s);
  const base = MANAGER_COSTS[Math.min(i, MANAGER_COSTS.length - 1)];
  return Math.round(base * diffOf(s).costMult);
}
/**
 * 每家分店的员工编制上限。
 * ★ **总店不受此限** —— 总店沿用 CFG.STAFF_MAX（原设计的 20 人就是给总店的）。
 *   若总店也限6 人，玩家在开第二家店之前就只能雇6 个人，
 *   而 hire / 出杯位 / 存档往返等一大票既有逻辑（与探针 H1 组）都以
 *   "总店能招满20 人"为前提 —— 一起被废掉。
 *   分店限编的意义在于**让店长有存在价值**（店长管的是分店的人手），
 *   而不是给主经营场所加一道天花板。
 */
function branchStaffCap(s, branch) {
  const br = Math.max(1, num(branch, 1));
  if (br === 1) return CFG.STAFF_MAX;      /* 总店：不额外限制 */
  const mg = managerOfBranch(s, br);
  let cap = BRANCH_STAFF_CAP;
  if (mg && managerTrait(mg).id === 'multi') cap += 1;
  return cap;
}
/** 某分店已有员工数 */
function staffOfBranch(s, branch) {
  return (s.staff || []).filter(st => st.branch === branch);
}
/** 随机生成一个店长候选人 */
function makeManagerCandidate(s, branch) {
  /* 能力值跟"资历"挂钩：等级越高skill 越强，
     但**方差更大** —— 金牌店里既有天才也有平庸，
     这样"招到谁"才有惊喜，而不是纯期望值决策。 */
  const lv = weightedPick(MANAGER_RANKS, r => [34, 30, 20, 12, 4][r.lv - 1]).lv;
  const skill = Math.round((0.92 + (lv - 1) * 0.07) * rnd(0.92, 1.08) * 100) / 100;
  const trait = RNG.next() < 0.68
    ? pick(MANAGER_TRAITS.filter(t => t.id !== 'none')).id
    : 'none';
  /* 日薪随等级与能力上涨。店长比店员贵得多（他们管人），
     但**不能贵到离谱** —— 店长不直接干活，
     工资过高会让「招店长」变成纯负担而无人问津。 */
  const wage = Math.round((120 + lv * 55 + skill * 60) * (trait === 'none' ? 1 : 1.06));
  return {
    name: pick(MANAGER_NAMES), emoji: pick(CUSTOMER_FACES),
    lv, skill, trait, wage, branch,
  };
}

/** 刷新某家分店的店长候选（force = 强制刷新，否则按概率） */
function refreshManagerCandidates(s, branch, force) {
  /* ★ V12：branch >= 1（**含总店**）—— 主店现在也可以任命店长了。 */
  if (!(branch >= 1)) return [];
  /* 已经有店长了就别刷 —— 否则玩家招完会发现"还能再招一个"，
     那是名额计算错了。 */
  if (managerOfBranch(s, branch)) {
    delete s.mgrCand[branch];
    return [];
  }
  if (!s.mgrCand) s.mgrCand = {};
  /* ★ 已有候选时，非强制刷新直接跳过（保留玩家正在比较的那批人）。
     若每次都刷，玩家会发现自己盯了半天的候选人被系统悄悄换掉了——
     决策成本凭空增加，而且没有任何提示。 */
  if (!force && s.mgrCand[branch] && s.mgrCand[branch].length) return s.mgrCand[branch];
  const n = rndInt(2, 3);
  s.mgrCand[branch] = [];
  for (let i = 0; i < n; i++) s.mgrCand[branch].push(makeManagerCandidate(s, branch));
  return s.mgrCand[branch];
}

/** 每日刷新：给还没有店长的分店小概率出新候选。
     否则玩家开完分店如果没招，之后就永远只有那 2~3 个候选，
     招不中就一直招不中，通道会"卡死"。 */
function dailyManagerRefresh(s) {
  /* ★ V12：从 branch 1 开始（总店也可以有店长） */
  for (let b = 1; b <= pos(s.shops, 1); b++) {
    if (managerOfBranch(s, b)) continue;
    refreshManagerCandidates(s, b, false);
  }
}

/** 手动刷新候选人的费用（店长专属）。
 *
 * ★ 为什么要收费：不收费的话玩家可以无限刷，
 *   而候选人是随机的 —— 刷到第 30 次必定出金牌店长。
 *   那样"招募决策"就退化成"点刷新直到出金色"，
 *   费用递增正是为了让"再刷一次"成为一个真实的权衡
 *   （花 ¥800 换一次抽卡，还是就用手上的 Lv.2）。
 *
 * 费用随该槽位刷新次数递增，封顶为招募费的一半 ——
 * 封顶的意义是"再刷也不如直接招人"，避免出现无上限的沉没成本。 */
function managerRerollCost(s, branch) {
  const key = 'reroll_' + branch;
  const times = num(s.flags[key], 0);
  const base = Math.round(managerCost(s) * Math.min(0.5, 0.12 + times * 0.06));
  return Math.max(180, base);
}

/** 招募店长（idx = 该分店候选列表下标） */
/**
 * 招募/任命店长到某家店。
 *
 * ★ V12：与 assignManager 合并为一个入口 ——
 *   之前 V11 有 hireManager（招到分店），V12 又加了 assignManager（任命到店），
 *   两个函数做同一件事、规则还不一致（一个不允许总店、一个允许）。
 *   合并后规则只有一处，**不会出现"两个入口规则不同"**这种经典 bug。
 *   旧调用点（hireManager）保留为薄封装。
 *
 * @param {number} branch 目标店（1 = 总店，2+ = 分店）
 * @param {number} idx    候选下标；传 null 表示「撤换现有店长」
 */
function hireManager(s, branch, idx) {
  if (!(branch >= 1)) return { ok: false, msg: '店号无效' };
  if (managerOfBranch(s, branch)) {
    /* 已有店长：换人需要先撤下 */
    if (idx == null) {
      const old = managerById(s, managerOfBranch(s, branch).id);
      if (old) {
        s.managers.splice(s.managers.indexOf(old), 1);
        const st = storeByBranch(s, branch);
        if (st) { st.managerId = null; st.auto = false; }
        syncStoreManagers(s);
        pushLog(s, `🎩 撤下店长 ${old.name}`);
        return { ok: true, removed: old };
      }
    }
    return { ok: false, msg: '该店已有店长（换人请先撤下）' };
  }
  if (managerSlotsLeft(s) <= 0) return { ok: false, msg: '没有空余名额（每家店最多一名店长）' };
  const list = (s.mgrCand && s.mgrCand[branch]) || [];
  const c = list[idx];
  if (!c) return { ok: false, msg: '候选人不存在' };
  const fee = managerCost(s);
  if (s.cash < fee) return { ok: false, msg: `现金不足（需 ${money(fee)}）` };
  s.cash -= fee; s.invested += fee;
  const m = {
    id: s.nextMgrId++, name: c.name, emoji: c.emoji,
    lv: c.lv, skill: c.skill, trait: c.trait, wage: c.wage,
    branch, days: 0,       /* 在任天数，供「长期任职」类成就/加成用 */
  };
  s.managers.push(m);
  list.splice(idx, 1);
  delete s.mgrCand[branch];
  const st = storeByBranch(s, branch);
  if (st) st.managerId = m.id;
  syncStoreManagers(s);
  const stName = st ? st.name : `第 ${branch} 店`;
  pushLog(s, `🎩 招募店长 ${m.emoji} ${m.name}（${managerRank(m.lv).name}）入驻「${stName}」`);
  bumpQuest(s, 'hire', 1);
  return { ok: true, manager: m, fee, store: st };
}

/** 卸任店长（结算 3 倍日薪当补偿） */
function fireManager(s, id) {
  const m = managerById(s, id);
  if (!m) return { ok: false, msg: '店长不存在' };
  const sev = Math.round(m.wage * 3);
  if (s.cash < sev) return { ok: false, msg: `现金不足以支付补偿（${money(sev)}）` };
  s.cash -= sev;
  s.managers.splice(s.managers.indexOf(m), 1);
  /* ★ 卸任**不会遣散**该店的员工 —— 他们本来就是总公司的员工，
     店长只是管理者而非所有者。把人一起清掉是双重惩罚，
     玩家会因此永远不敢卸任（等于被绑架）。 */
  pushLog(s, `🎩 店长 ${m.emoji} ${m.name} 卸任（补偿 ${money(sev)}）`);
  refreshManagerCandidates(s, m.branch, true);
  return { ok: true, sev };
}

/**
 * 店铺级升级（V12.1）
 *
 * ★ 每店独立：`store.upgrades[upgradeId] = level`
 *
 * ★ 与全局升级的关键差异：全局升级只有一份（`s.up`），
 *   店铺升级**每店一份**。所以所有查询函数都要带 store 参数，
 *   不能写成 `s.up.xxx` 那样直接读全局 ——
 *   读错一次就是「A 店的升级加成跑到 B 店」，
 *   表现是玩家买了 A 店的升级却发现 B 店变强了，且无法自查。
 */

/** 某店某项升级的等级 */
function storeUpLevel(s, store, upId) {
  if (!store || !store.upgrades) return 0;
  return pos(store.upgrades[upId], 0);
}
/** 店铺升级的成本（按该店当前等级算） */
function storeUpCost(s, store, upId) {
  const u = STORE_UPGRADES.find(x => x.id === upId);
  if (!u) return null;
  const lv = storeUpLevel(s, store, upId);
  if (lv >= u.max) return null;
  /* 成本随**店铺等级**上浮 —— 大店的升级更贵。
     这让「先开小店练级再做大店」有策略意义，
     也防止玩家把所有店都堆到高等级（那样店铺升级就只是数值膨胀）。*/
  const lvMult = 1 + (Math.max(1, num(store && store.level, 1)) - 1) * 0.22;
  return Math.round(u.base * Math.pow(u.mult, lv) * lvMult);
}
/** 购买店铺升级 */
function buyStoreUpgrade(s, branch, upId) {
  const store = storeByBranch(s, branch);
  if (!store) return { ok: false, msg: '店铺不存在' };
  const u = STORE_UPGRADES.find(x => x.id === upId);
  if (!u) return { ok: false, msg: '升级项不存在' };
  const cost = storeUpCost(s, store, upId);
  if (cost == null) return { ok: false, msg: '该升级已满级' };
  if (s.cash < cost) return { ok: false, msg: '现金不足' };
  s.cash -= cost; s.invested += cost;
  if (!store.upgrades) store.upgrades = {};
  const lv = storeUpLevel(s, store, upId) + 1;
  store.upgrades[upId] = lv;
  pushLog(s, `🏗️「${store.name}」${u.emoji} ${u.name} 升至 Lv.${lv}`);
  return { ok: true, store, upgrade: u, level: lv, cost };
}

/** 店铺升级的客流加成（该店专用） */
function storeTrafficBonus(s, store) {
  return 1 + storeUpLevel(s, store, 'buzz') * 0.12;
}
/** 店铺升级的员工效率加成（该店专用） */
function storeStaffBonus(s, store) {
  return 1 + storeUpLevel(s, store, 'team') * 0.10;
}
/** 店铺升级的可上架数加成（该店专用） */
function storeMenuBonus(s, store) {
  return storeUpLevel(s, store, 'sign');
}
/** 店铺升级的开支减免（该店专用） */
function storeCostCut(s, store) {
  return clamp(storeUpLevel(s, store, 'lean') * 0.10, 0, 0.5);
}

/**
 * 重新启用一位留档的店长（V12.1）。
 *
 * ★ 场景：玩家关掉一家店，店长被留档到 formerManagers；
 *   后来开了新店，想把这位店长请回来。
 *
 * ★ 规则：
 *   · **不额外收费** —— 他本来就是在职时被关停的，
 *     重新启用不是「招新人」而是「恢复原职」，
 *     收一笔招募费等于为同一份履历付两次钱。
 *   · 仍受「每店至多一名店长」与「店长数 ≤ 店数」约束。
 *   · 启用后从留档列表移除（不能反复启用同一人）。
 */
function rehireManager(s, formerId, branch) {
  const fm = arr(s.formerManagers);
  const idx = fm.findIndex(x => x && x.id === formerId);
  if (idx < 0) return { ok: false, msg: '该店长不在待聘列表中' };
  const store = storeByBranch(s, branch);
  if (!store) return { ok: false, msg: '店铺不存在' };
  if (managerOfBranch(s, branch)) return { ok: false, msg: '该店已有店长' };
  if (managerSlotsLeft(s) <= 0) return { ok: false, msg: '没有空余名额' };
  const f = fm[idx];
  /* id 要避开现役店长的 id（否则两者撞 id，加成/工资会算到同一人头上）*/
  let maxId = 0;
  for (const m of arr(s.managers)) if (m.id > maxId) maxId = m.id;
  const m = {
    id: Math.max(s.nextMgrId || 1, maxId + 1),
    name: f.name, emoji: f.emoji,
    lv: f.lv, skill: f.skill, trait: f.trait, wage: f.wage,
    branch, days: f.days || 0,
  };
  s.nextMgrId = m.id + 1;
  s.managers.push(m);
  fm.splice(idx, 1);
  store.managerId = m.id;
  syncStoreManagers(s);
  pushLog(s, `🎩 ${m.emoji} ${m.name} 重新入职「${store.name}」`);
  return { ok: true, manager: m, store };
}

/**
 * 关闭一家分店（V12 遗留项的实现）。
 *
 * ★ 关店与「卸任店长」是**不同的两件事**，规则不能混：
 *   卸任 = 店长离开但店还在 → 员工留下（他们是总公司的，不是店长的）
 *   关店 = 店没了         → 员工必须遣散（没有店就没有工位）
 *   混为一谈会造成「关店后员工凭空消失」或「关店后员工还在无主的店里」。
 *
 * ★ 费用设计：**不退店费，还要付清退费**。
 *   已经投进去的装修、库存、招人成本是沉没成本 ——
 *   若关店能全额退款，玩家就会「开了又关」来试城市，
 *   那不是经营决策，是无成本试错。
 *   退费按「该店累计支出」的一部分收取，让玩家觉得"关店很疼"，
 *   但不至于血本无归到不敢关。
 *
 * ★ 店长：撤下且**不给补偿** —— 店是玩家的，
 *   店长领的是"有店可管"的薪酬，店没了这份工作就没了。
 *
 * ★ 店号重排：关掉 3 号店后 4 号变 3 号（玩家预期如此）。
 *   重排后必须同步 staff.branch / manager.branch / mgrCand 的键，
 *   否则员工会"归属一家不存在的店"。
 *
 * @param {number} branch 要关的店号（1 = 总店，不允许关闭）
 */
function closeStore(s, branch) {
  const st = storeByBranch(s, branch);
  if (!st) return { ok: false, msg: '店铺不存在' };
  /* ★ 总店不可关闭 —— 它是经营的根。 */
  if (st.branch === 1) return { ok: false, msg: '总店不能关闭' };
  if (s.stores.length <= 1) return { ok: false, msg: '至少要保留总店' };

  /* --- 费用：清退费按该店累计支出的一定比例 --- */
  const fee = Math.round(st.expense * 0.35);
  if (s.cash < fee) {
    return { ok: false, msg: `现金不足以支付清退费 ${money(fee)}` };
  }
  s.cash -= fee;

  /* --- 遣散该店员工（他们没有别的地方可去）--- */
  const staff = staffOfBranch(s, branch);
  let sevTotal = 0;
  for (const stf of staff) {
    sevTotal += Math.round(num(stf.wage, 0) * 2);
  }
  /* 遣散费从该店自己的现金里出（不够的部分由总部兜底） */
  const fromStore = Math.min(st.cash, sevTotal);
  st.cash -= fromStore;
  s.cash -= (sevTotal - fromStore);
  s.staff = s.staff.filter(stf => stf.branch !== branch);

  /* --- 撤下该店店长（不给补偿，但**留档**）--- */
  const mgr = managerOfBranch(s, branch);
  if (mgr) {
    s.managers.splice(s.managers.indexOf(mgr), 1);
    /* ★ 店长信息**留档**到 formerManagers。
       不留的话，玩家关掉一家店就永远失去这个店长 ——
       而「关店再开一家、把这位店长请回来」本该是个有意思的经营循环
       （换一个城市用同一位能干的店长）。
       留档后可以「重新启用」，且不额外付费（他本来就是在职时被关停的）。*/
    if (!Array.isArray(s.formerManagers)) s.formerManagers = [];
    s.formerManagers.push({
      id: mgr.id, name: mgr.name, emoji: mgr.emoji,
      lv: mgr.lv, skill: mgr.skill, trait: mgr.trait, wage: mgr.wage,
      days: mgr.days, fromStore: st.name, fromBranch: branch,
    });
  }

  /* --- 移除该店 --- */
  s.stores.splice(s.stores.indexOf(st), 1);
  /* 该店的候选池一并清掉（店号会被重用） */
  delete s.mgrCand[branch];

  /* --- 店号重排：后面的店往前移 --- */
  for (const st2 of s.stores) {
    if (st2.branch > branch) st2.branch -= 1;
  }
  for (const stf of s.staff) {
    if (stf.branch > branch) stf.branch -= 1;
  }
  for (const m of s.managers) {
    if (m.branch > branch) m.branch -= 1;
  }
  /* 候选池的键也要跟着挪（它是按店号存的） */
  const candOld = s.mgrCand;
  s.mgrCand = {};
  for (const k in candOld) {
    const bk = int(k, 0);
    if (bk === branch) continue;               /* 被关掉的店：丢弃 */
    s.mgrCand[bk > branch ? bk - 1 : bk] = candOld[k];
  }
  /* ★ 主店被关时：主店标记必须转给剩下的某一家（总店优先）——
     否则会出现「没有主店」的状态。 */
  if (st.isMain) {
    const newMain = s.stores.find(x => x.branch === 1) || s.stores[0];
    if (newMain) newMain.isMain = true;
  }
  syncShopCount(s);
  syncStoreManagers(s);

  pushLog(s, `🏚️ 关闭了「${st.name}」（清退费 ${money(fee)}，遣散 ${staff.length} 人）`);
  return { ok: true, fee, staffOut: staff.length, managerOut: !!mgr };
}

/**
 * 跨分店调动：店长换一家店管（员工随他一起搬） */
function moveManager(s, id, toBranch) {
  const m = managerById(s, id);
  if (!m) return { ok: false, msg: '店长不存在' };
  if (!(toBranch >= 2 && toBranch <= pos(s.shops, 1))) {
    return { ok: false, msg: '目标分店不存在' };
  }
  if (m.branch === toBranch) return { ok: false, msg: '已经在该分店' };
  if (managerOfBranch(s, toBranch)) return { ok: false, msg: '目标分店已有店长' };
  const from = m.branch;
  const staff = staffOfBranch(s, from);
  /* 顺序要紧：先改 m.branch，再算目标店编制 ——
     多店管理(+1) 的上限是跟着**店长本人**走的，
     先搬人后改 branch 会用旧店的编制上限算出错误结果。 */
  m.branch = toBranch;
  const cap = branchStaffCap(s, toBranch);
  let moved = 0, left = 0;
  for (const st of staff) {
    if (moved >= cap) { left++; continue; }
    st.branch = toBranch; moved++;
  }
  pushLog(s, `🔀 店长 ${m.emoji} ${m.name} 调往第 ${toBranch} 分店（带走 ${moved} 名员工${left ? `，${left} 名留下` : ''}）`);
  refreshManagerCandidates(s, from, true);
  return { ok: true, from, to: toBranch, moved, left };
}

/** 店长每日自动补员。
 *
 * ★ 为什么店长「自己招人」是有意义的机制，而不是纯装饰：
 *   玩家不可能天天盯着每家分店的编制。店长每天在编制有空、
 *   店里现金允许时自己补 1 人，玩家的操作从"逐店盯人"变成"决定要不要放权"。
 *   这也构成一条真实的取舍：**工资是每天都要付的** ——
 *   放权自动补员 = 省心但涨工资；自己盯着招 = 省钱但费神。
 *
 * 规则（刻意保守，避免店长变成"免费劳动力引擎"）：
 *   · 每天最多补 1 人（不是补满编制）
 *   · 要求该店现金（按当日毛估）足够付对方的 3 天工资
 *   · 全公司员工总上限 CFG.STAFF_MAX 依然是硬顶
 *
 * @returns {{hired: object[], skipped: number}} hired 是今天招进来的人
 */
/**
 * 店长 AI：托管店的每日经营结算（V12）
 *
 * ★ 为什么托管店要独立结算，而不是塞进实时营业模拟：
 *   实时模拟需要玩家逐个点出杯位 —— 托管的店玩家不在场，
 *   塞进去的结果就是「玩家不操作它就一天做不了单」。
 *   所以托管店走**日结算模型**：每天算一次客流/营收/成本，出报表。
 *
 * ★ 收益必须与「玩家亲自经营同一规模店」大致可比 ——
 *   否则「托管」就是个亏本买卖，玩家不会用。
 *   所以客流基准用同一套口径（按该店城市/口碑/等级），
 *   店长的能力值提供加成。
 *
 * ★ 托管店不计入 activeBranchCount ——
 *   它的营收不来自实时模拟，若还计入客流加成，
 *   玩家经营的总店会凭空多出客流（凭空得利）。
 *
 * @returns {Array} 每家店一份报表
 */
function managedStoresDaily(s) {
  const reports = [];
  for (const store of managedStores(s)) {
    const mgr = storeManager(s, store);
    if (!mgr) { store.auto = false; continue; }
    const rpt = managedStoreOneDay(s, store, mgr);
    if (rpt) reports.push(rpt);
  }
  return reports;
}

/** 单家托管店的一天 */
function managedStoreOneDay(s, store, mgr) {
  const staff = staffOfBranch(s, store.branch);
  /* ★ 空店不产出：没有人就做不了单，但店租照付（固定开支）。
     记成「空转」而不是跳过 —— 玩家需要看到"这家店白开着"。 */
  if (staff.length === 0) {
    const cost = Math.round(storeDailyCost(store) * (1 - storeCostCut(s, store)));
    store.cash = Math.max(0, store.cash - cost);
    store.expense += cost;
    store.days++;
    const rpt = {
      day: s.day, store: store.branch, name: store.name, empty: true,
      traffic: 0, cups: 0, revenue: 0, cogs: 0, wages: 0, rent: cost, net: -cost,
      msg: '空店：没有员工，扣除固定开支',
    };
    store.lastReport = rpt;
    store.history.unshift(rpt);
    if (store.history.length > 7) store.history.length = 7;
    return rpt;
  }

  /* --- 客流：按该店自身条件算，不用总部的 --- */
  const d = diffOf(s);
  const lvBonus = 1 + (store.level - 1) * 0.12;      /* 店铺等级 */
  const venueMul = venueTrafficMul(store.venueType);
  let traffic = (4 + s.rep * 0.36) * lvBonus * venueMul * d.traffic;
  traffic = traffic * (1 + 0.20 * (store.level - 1));
  /* ★ 店铺级升级（该店专用）：旺铺招财
     托管店**同样吃**这个加成 —— 否则玩家投了升级的托管店
     反而比没升级的自营店弱，「托管」就成了纯损失。 */
  traffic = traffic * storeTrafficBonus(s, store);
  traffic = Math.max(1, Math.round(traffic));

  /* --- 店长能力加成（与玩家经营同一套 managerBonus）--- */
  const mb = managerBonus(s, store.branch);
  traffic = Math.round(traffic * mb.ops);

  /* --- 出杯效率：员工熟练度 × 该店「熟练团队」升级 --- */
  /* ★ 熟练团队（该店专用）：托管店同样吃 ——
     升级投在谁身上就对谁生效，与谁经营无关。 */
  const avgSkill = staff.reduce((a, st) => a + staffMult(s, st), 0) / staff.length
    * storeStaffBonus(s, store);

  /* --- 营收：客单价取该店能卖的平均价 --- */
  /* ★★ V21 修复：客单价必须走 priceOf()（玩家实际定价），不能取配方基准价。
     原来写 recipeById(rid).price —— 那是**出厂价**：
       玩家把自己店里的招牌加价 20%、或整体调到 1.3 倍，
       托管分店的收入一分钱都不涨，自营店却实打实多赚。
     结果是「托管 = 你对这家店的定价完全不生效」，
     而托管恰恰是玩家不亲自盯的那家店，最应该吃定价策略的红利。
     ★ 但不能只换价格：那样「把所有倍率拉满」就成了无风险套利
       （分店客流不受价格影响）。所以同时引入 priceDrag 扣量 ——
       与自营店「嫌贵就走」同一方向，只是用平滑近似
       （托管店不做逐客判定，逐客要靠 26 秒实时模拟，托管没有那个循环）。
     ★ ratio = 1.0 时 priceDrag = 1，**行为与旧版逐字节一致** ——
       这是刻意保留的安全边界：不动定价的玩家不会感到任何数值变化。 */
  const menu = s.menu || [];
  const avgPrice = menu.length
    ? menu.reduce((a, rid) => a + (recipeById(rid) ? priceOf(s, rid) : 20), 0) / menu.length
    : 20;
  const avgRatio = menu.length
    ? menu.reduce((a, rid) => a + num(s.ratios[rid], 1), 0) / menu.length
    : 1;
  const priceDrag = clamp(1 - (avgRatio - 1) * 0.35, 0.55, 1.10);

  /* --- 出杯：员工效率 × 客流 × 定价对量的影响 --- */
  const cups = Math.max(0, Math.round(traffic * 0.72 * avgSkill * mb.speed * priceDrag));

  const revenue = Math.round(cups * avgPrice * 0.92);   /* 0.92：折价与未满座的损耗 */

  /* --- 成本：原料 + 工资 + 固定开支 --- */
  const cogs = Math.round(revenue * 0.34);              /* 原料率约 34% */
  const wages = Math.round(staff.reduce((a, st) => a + num(st.wage, 0), 0)
    + num(mgr.wage, 0));
  /* ★ 精打细算（该店专用）：固定开支减免 */
  const rent = Math.round(storeDailyCost(store) * (1 - storeCostCut(s, store)));

  /* --- 采购：店长自己补料（只买本城能买到的） --- */
  const bought = managedStoreBuy(s, store, cups);

  const net = revenue - cogs - wages - rent;
  store.cash += net;
  if (store.cash < 0) store.cash = 0;      /* 亏空由总部兜底，不让店现金成负数 */
  store.income += revenue;
  store.expense += cogs + wages + rent;
  store.cups += cups;
  store.days++;

  /* --- 升级：累计营收达阈值 --- */
  const nextLv = STORE_LEVELS.find(l => l.lv === store.level + 1);
  let leveled = false;
  if (nextLv && store.income >= nextLv.need) {
    store.level = nextLv.lv;
    leveled = true;
    pushLog(s, `🏆「${store.name}」升级到 Lv.${store.level}！`);
  }

  const rpt = {
    day: s.day, store: store.branch, name: store.name, empty: false,
    traffic, cups, revenue, cogs, wages, rent, net,
    bought: bought.qty, boughtCost: bought.cost,
    manager: mgr.name, leveled, level: store.level,
    msg: leveled ? `升级到 Lv.${store.level}！` : '',
  };
  store.lastReport = rpt;
  store.history.unshift(rpt);
  if (store.history.length > 7) store.history.length = 7;
  return rpt;
}

/** 店长采购：按当天预估销量补料，只买本城能买到的。 */
function managedStoreBuy(s, store, cups) {
  let qty = 0, cost = 0;
  /* 买什么：优先补该店菜单用得上的原料 */
  const need = {};
  for (const rid of (s.menu || [])) {
    const r = recipeById(rid);
    if (!r) continue;
    for (const k of Object.keys(r.req || {})) {
      need[k] = (need[k] || 0) + (r.req[k] || 0);
    }
  }
  const perCup = cups > 0 ? cups * 0.5 : 0;   /* 只备半天的量，剩下的明天再买 */
  for (const k of Object.keys(need)) {
    if (!ingAvailableAt(k, store.cityId)) continue;   /* 本城买不到，跳过 */
    const g = ingById(k);
    if (!g) continue;
    const have = num(store.inv[k], 0);
    const want = Math.ceil(need[k] * perCup);
    const lack = Math.max(0, want - have);
    if (lack <= 0) continue;
    const price = num(s.prices[k], g.base);
    const afford = Math.floor(Math.max(0, store.cash - cost) / Math.max(0.1, price));
    const buy = Math.min(lack, afford, 60);
    if (buy <= 0) continue;
    store.inv[k] = have + buy;
    cost += Math.round(buy * price);
    qty += buy;
  }
  if (cost > 0) store.cash -= cost;
  return { qty, cost };
}

/** 场地类型对客流的影响（不同场地客流特征不同） */
function venueTrafficMul(venueType) {
  switch (venueType) {
    case 'mall': return 1.12;
    case 'pedestrian': return 1.18;
    case 'scenic': return 1.25;
    case 'office': return 1.05;
    case 'community': return 1.00;
    case 'campus': return 1.15;
    case 'station': return 1.30;
    case 'hospital': return 0.95;
    case 'factory': return 0.90;
    case 'rural': return 0.80;
    default: return 1;
  }
}

/**
 * 店长自动补员。
 *
 * ★ V12 变更：补员范围从「branch ≥ 2」扩到**所有有店长的店**（含总店），
 *   因为主店现在也可以有店长了。
 *   其余规则与 V11 相同（每天至多 1 人、要店现金够付 3 天工资、
 *   全局 STAFF_MAX 硬顶、玩家与店长共用编制名额）。
 */
function managerDaily(s) {
  const hired = [];
  let skipped = 0;
  for (const m of (s.managers || [])) {
    m.days = num(m.days, 0) + 1;
    if (staffOfBranch(s, m.branch).length >= branchStaffCap(s, m.branch)) { skipped++; continue; }
    if (s.staff.length >= CFG.STAFF_MAX) { skipped++; continue; }
    /* 店里现金的粗略代理：把总现金按分店数分，
       够付 3 天工资才招 —— 店长不能花光总部的钱。 */
    const shopCash = s.cash / Math.max(1, pos(s.shops, 1));
    const avgWage = s.staff.length
      ? s.staff.reduce((a, b) => a + num(b.wage, 0), 0) / s.staff.length
      : 70;
    if (shopCash < avgWage * 3) { skipped++; continue; }
    /* 优先用候选人池：店长"物色"也是从候选人里挑，
       玩家在总店看到的候选人池是共享的（同一批人，不可能分身）。 */
    if (!s.candidates || !s.candidates.length) { refreshCandidates(s, true); }
    const idx = s.candidates.length - 1;
    const r = hireStaff(s, idx, m.branch);
    if (r.ok) hired.push(r.staff);
    else skipped++;
  }
  return { hired, skipped };
}

/* ---------------- 员工 ---------------- */
/**
 * 雇佣员工到指定分店。
 * @param {number} branch 目标分店（1 = 总店）。省略则回落到玩家手动招聘：
 *   **手动招聘默认进总店** —— 玩家手动招人时通常在想"给我自己店里加个工"，
 *   若默认进某家分店会让人莫名其妙。
 *   店长自动补员走的是同一条路径（branch 明确指定），
 *   两条路径**共用编制名额**，不存在"店长招的和玩家招的不算在一起"的漏洞。
 */
function hireStaff(s, idx, branch) {
  const c = s.candidates[idx];
  if (!c) return { ok: false, msg: '候选人不存在' };
  /* 上限守卫：以前这里不查人数，员工可以一直加到存档清洗器截断为止，
     读档时多出来的会无声消失（连遣散费都不退）。 */
  if (s.staff.length >= CFG.STAFF_MAX) return { ok: false, msg: `员工已达上限 ${CFG.STAFF_MAX} 人` };
  /* V11 每店编制上限：店长招人与玩家招人共用这一条。
     ★ 必须在扣钱之前拦 —— 否则店长把人招进来才发现超编，
       员工已经进了 staff 又立刻被赶走，钱白花。 */
  const br = branch == null ? 1 : num(branch, 1);
  const cap = branchStaffCap(s, br);
  if (staffOfBranch(s, br).length >= cap) {
    const mg = managerOfBranch(s, br);
    return {
      ok: false,
      msg: mg
        ? `第 ${br} 分店编制已满（${cap} 人，店长 ${mg.name} 管不了更多）`
        : `第 ${br} 分店编制已满（${cap} 人）`,
    };
  }
  /* 费用要在**扣钱之前**算完，因为店长的议价会改变最终价 ——
     若先扣原价再退差额，中途现金可能已经扣成负数又弹回来，
     账目会留下一个说不清的中间态。这里改成先算后扣。 */
  const mg = managerOfBranch(s, br);
  let fee = c.fee;
  if (mg) {
    if (managerTrait(mg).id === 'trainer') fee = Math.round(fee * 0.85);
    fee = Math.round(fee * (1 - clamp((num(mg.skill, 1) - 0.9) * 0.08, 0, 0.14)));
  }
  if (s.cash < fee) return { ok: false, msg: '现金不足' };
  s.cash -= fee; s.invested += fee;
  /* ★ 员工费用随所属分店的店长能力浮动：
     店长 trainer 特性（带教能手）→ 该店招人便宜 15%；
     能力值越高，渠道议价能力越强（最多再降 14%）。
     这让"招好店长"和"招便宜人"之间有真实取舍：
     能力强的店长运营加成高，但人力成本也更高。 */
  const st = {
    id: s.nextStaffId++, name: c.name, emoji: c.emoji,
    skill: c.skill, trait: c.trait, wage: c.wage, stamina: 100,
    branch: br, hiredBy: mg ? 'mgr' : 'player',
  };
  s.staff.push(st);
  s.candidates.splice(idx, 1);
  bumpQuest(s, 'hire', 1);
  pushLog(s, mg
    ? `👤 店长 ${mg.name} 招入 ${st.emoji} ${st.name}（第 ${br} 分店）`
    : `👤 雇佣了 ${st.emoji} ${st.name}`);
  return { ok: true, staff: st, fee };
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
  stations.push({ idx: 0, worker: null, order: null, isBoss: true, branchIdx: 1 });
  /* V11：工位按**分店**组织，不再用 `s.staff[(i-1) % pool]` 取模轮转。
     ★ 改造前的问题是"3 家店 2 个员工时，同一个人同时在 3 家店上班"——
       那不是经营，是数学游戏。玩家看不到这件事，但分店成本照收，
       相当于为一份工资买了 N 家店的产能。
     ★ 每家分店的工位数 = 该店员工数（店长不在工位上，他们管人）。
       没有员工的分店工位数 0 —— 那家店今天真的做不了单，
       这是玩家该看到的反馈（"我开了分店却没人，只能干看着"）。 */
  for (let i = 0; i < s.staff.length; i++) {
    const br = Math.max(1, num(s.staff[i].branch, 1));
    stations.push({
      idx: stations.length,
      worker: s.staff[i], order: null, isBoss: false, branchIdx: br,
    });
  }

  s.phase = 'open';
  s.sim = {
    t: 0, duration: dur, closing: false,
    traffic, rate: traffic / (dur * 1.19), arrivalAcc: 0, spawned: 0,
    queue: [], stations, paused: false,
    /* ★ V21：流失必须**分桶**记录，只留总数等于不给信息。
       原来只有一个 lost 总数，结算只写「流失 12 位」——
       玩家知道丢了 12 个人，但不知道是"我不够快"还是"我太贵"还是"我没座"，
       下一天的动作只能靠猜。四类流失对应的修法完全不同：
         等太久 → 加出杯位 / 升效率 / 招人
         嫌太贵 → 调价倍率 / 换便宜款
         没座   → 升装修（扩队列）/ 限流
         缺料   → 备货
       分桶之后「流失 12（等 8 · 贵 3 · 没座 1）」是可以直接指导决策的。 */
    orders: 0, cups: 0, lost: 0, priceLost: 0, stockout: 0,
    waitLost: 0, fullLost: 0, closedLost: 0,
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

/* ============================================================
 *  常客系统（V13.6）—— 借鉴开罗《创意咖啡厅物语》的「常客度」
 *
 * ★ 核心循环（开罗原作）：满意度 ↑ → 常客度 ↑ → 顾客预算 ↑ →
 *   人气 ↑ → 到店顾客 ↑ —— 一个自己会滚的复利。
 *
 * ★ 本作的取舍：**身份 = 类型 + 外观变体**（不是完整个体）。
 *   完整个体要改订单结构/队列/存档清洗，动辄上百行；
 *   而「类型+变体」已经能让玩家感知到「那个戴帽子的老顾客越来越爱来」。
 * ============================================================ */

/** 常客档案表（存档里 s.regulars）：id → { id, type, face, fav, name } */
function regularsOf(s) {
  if (!s.regulars || typeof s.regulars !== 'object') s.regulars = {};
  return s.regulars;
}

/**
 * 给一位顾客分配稳定身份（V13.6）
 *
 * ★ 身份 id = 顾客类型 + 变体序号（如 student#0）。
 *   变体从 CUSTOMER_FACES 里按类型分块取，
 *   所以同类型的顾客长相不同、不同类型不会撞脸。
 *
 * @param {object} s 状态
 * @param {object} t 顾客类型
 * @returns {{id:string, type:string, face:string, fav:number, isRegular:boolean}}
 */
function regularIdentityOf(s, t) {
  const faces = CUSTOMER_FACES;
  const typeIdx = Math.max(0, CUSTOMER_TYPES.findIndex(x => x.id === t.id));
  /* ★ V13.6 修正：每种类型可用**全部 20 个外观** → 5 × 20 = 100 位常客。
     ★ 为什么不是 4 个变体（20 位）：
       实测 30 天总服务 1000+ 单，20 个身份人均被服务 50 次 →
       **全部好感满**（20/20 成常客），
       常客系统就退化成"全员常客"，加成对所有人一样 = 没有区分度。
       100 位身份把人均摊薄到 10 次左右，
       才会出现"有的很熟、有的只是脸熟"的层次。 */
  const v = Math.floor(RNG.next() * faces.length) % faces.length;
  const face = faces[(typeIdx * 4 + v) % faces.length];
  const id = t.id + '#' + v;
  const rs = regularsOf(s);
  if (!rs[id]) {
    rs[id] = { id, type: t.id, face, fav: 0, name: regularNameOf(t.id, v) };
  }
  const rec = rs[id];
  rec.face = face;
  rec.fav = clamp(num(rec.fav, 0), 0, REGULAR_CFG.max);
  rec.isRegular = rec.fav >= REGULAR_CFG.max;
  return rec;
}

/** 常客的昵称（由类型 + 变体派生，跨局稳定） */
function regularNameOf(typeId, v) {
  const t = CUSTOMER_TYPES.find(x => x.id === typeId);
  const base = t ? t.name : '顾客';
  const suffix = ['常客', '老熟客', '回头客', '铁粉'][v % 4];
  return base + suffix;
}

/**
 * 常客的回头率加成（V13.6）
 *
 * ★ 好感越高越常来；满 100（常客）时额外加权。
 * @returns 客流权重乘数
 */
function regularPullMul(s, reg) {
  if (!reg) return 1;
  const fav = num(reg.fav, 0);
  const cfg = REGULAR_CFG;
  if (fav >= cfg.max) return 1 + cfg.pullWeight;
  /* 好感 0~100 线性映射到 1.0~1.45 */
  return 1 + (fav / cfg.max) * 0.45;
}

/**
 * 常客的服务结算（V13.6）：满意服务 → 好感 +gain
 * @param {object} s 状态
 * @param {string} regId 常客 id
 */
function regularServe(s, regId) {
  if (!regId) return;
  const rs = regularsOf(s);
  const rec = rs[regId];
  if (!rec) return;
  const before = rec.fav;
  rec.fav = clamp(num(rec.fav, 0) + REGULAR_CFG.gain, 0, REGULAR_CFG.max);
  rec.isRegular = rec.fav >= REGULAR_CFG.max;
  /* ★ 刚刚成为常客 → 给一条提示（一次性，成就感 + 引导玩家） */
  if (before < REGULAR_CFG.max && rec.fav >= REGULAR_CFG.max) {
    pushLog(s, `💝 ${rec.name} 成了常客！以后消费更舍得花`);
    if (s.sim) s.sim.floaters.push({ text: `💝 ${rec.name} 成了常客`, kind: 'good' });
  }
}

/**
 * 常客好感不再每日衰减（V13.6 修正）
 *
 * ★ 初版有「每天 -1 淡忘」的设计，实测发现**数学死锁**：
 *   顾客 2 天来 1 次 → 每 2 天净 -2 +2 = 0 → 永远卡在 92，满不了；
 *   3 天来 1 次 → 净 -1 → 越攒越少。
 *   30 天实测确实有两位卡在 96 / 92 永远成不了常客。
 *
 * ★ 开罗原作的常客度**不衰减** —— 它是「累积的里程碑」而不是「易变的状态」。
 *   服务过的人记得你，不因为几天没来就忘了。
 *   ★ 所以这里不做衰减，改用别的机制表达"不常来"：
 *     回头率权重（pullWeight）已经让常客更常来，
 *     而没被服务的顾客自然停在低好感（不会突然变常客）。
 *
 * 函数保留（不删）—— 万一日后要加「淡忘」机制，有接口可用；
 * 但**当前实现是空操作**，调用点保留是为了不改动 nextDay 的结构。
 */
function regularDecay(s) {
  /* ★ 当前无衰减：见上方说明（初版的 -1/天 会造成数学死锁） */
}

/** 常客加成：消费预算 / 小费（V13.6） */
function regularBonus(s, reg) {
  if (!reg || num(reg.fav, 0) < REGULAR_CFG.max) return { budget: 1, tip: 1, isRegular: false };
  return {
    budget: 1 + REGULAR_CFG.budgetBonus,
    tip: 1 + REGULAR_CFG.tipBonus,
    isRegular: true,
  };
}

/** 常客名册视图（UI 用）：已认识 / 已成常客的顾客 */
function regularView(s) {
  const rs = regularsOf(s);
  const list = Object.keys(rs).map(k => rs[k]).filter(Boolean);
  list.sort((a, b) => (b.fav || 0) - (a.fav || 0));
  return {
    list,
    known: list.length,
    regulars: list.filter(x => x.fav >= REGULAR_CFG.max).length,
    max: REGULAR_CFG.max,
  };
}

/**
 * 生成一位顾客并入队。
 * type 非空 = 特殊顾客（V7）；为 null = 常规顾客（按客群权重抽）。
 */function spawnOne(s, type) {
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
  /* ★ V13.6 常客：给这位顾客一个**稳定身份**（跨天一致）。
     身份 = 顾客类型 + 外观变体（从 CUSTOMER_FACES 里按类型分块取），
     最多 5 类型 × 4 变体 = 20 位「熟客」。
     ★ 刻意不做完整个体（那要改订单结构/队列/存档清洗），
       但玩家感知上仍是「那个戴帽子的老顾客越来越爱来」。
     ★★ **特殊顾客不分配身份** —— 它们是一次性事件角色（评论家、美食家…），
        不该占常客名额。而且它们 regId 为 null（不累积好感），
        若仍写进档案就是**永远 fav=0 的空档案**：
        实测 30 天后名册里混了 11 个空条目（31 位里 11 个是空壳），
        名册虚高、存档浪费。 */
  const reg = type ? null : regularIdentityOf(s, t);
  /* 常客加权：好感越高越常来（开罗的「常客度 ↑ → 人气 ↑ → 客流 ↑」） */
  const pull = regularPullMul(s, reg);
  /* 等位座满了 → 直接走人 */
  if (sim.queue.length >= queueCap(s)) {
    sim.lost++; sim.fullLost++;
    sim.repGain += CFG.LOST_REP;
    sim.typeLost[t.id] = (sim.typeLost[t.id] || 0) + 1;
    bumpQuest(s, 'lost', 1);
    return;
  }
  /* 价格接受度：客群容忍度不同，定价过高会被当场劝退。
     🃏 策略卡「精品路线」提高 priceTol —— 可以涨价而不被劝退。
     ★ V13.6：常客的预算加成（好感满 100）—— 开罗的「常客度↑ → 预算↑」。 */
  const regB = regularBonus(s, reg);
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
    /* ★ V13.6：常规顾客用**常客身份的外观**（同一类型不同变体长相不同），
       这样玩家能认出「那个戴帽子的老顾客」。特殊顾客保持类型专属表情。 */
    face: type ? t.emoji : reg.face, rid: r, type: t.id,
    /* V7：特殊顾客要在队列里一眼认出来（face 不同 + 角标） */
    special: type ? t.id : null,
    /* ★ V13.6：常客身份（null = 不是常客系统的追踪对象） */
    regId: reg ? reg.id : null,
    /* ★ V13.6：常客的预算加成（好感满 100 时 +15%） */
    budgetMul: regB.budget,
    tipMul: regB.tip,
    isRegular: regB.isRegular,
    cups: rndInt(t.cups[0], t.cups[1]),
    wait: 0,
    /* 🃏 策略卡：会员体系延长耐心、员工入股缩短耐心 */
    patience: patienceOf(s) * t.patienceMul * cardMul(s, 'patience') * chapterMul(s, 'patience') * rnd(0.85, 1.2),
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
  /* ★ V22：闪光客人。标记打在订单上，渲染层据此加光效，
     结算层据此乘收入倍率 —— 两处读同一个字段，不会出现"看着像 VIP、结账不给钱"。 */
  const isVip = rnd(0, 1) < CFG.VIP_CHANCE;
  st.order = {
    c, progress: 0, price: priceOf(s, c.rid), rid: c.rid, cups: n, type: c.type, vip: isVip,
    /* ★ V13.6：常客加成随订单带下来（顾客进店时就算好，
       避免结算时再查一次档案 —— 期间好感可能已被别的订单改过）。 */
    regId: c.regId || null, budgetMul: num(c.budgetMul, 1), tipMul: num(c.tipMul, 1),
  };
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
  /* ★ V13.6：常客的**消费预算加成**（开罗的「常客度↑ → 顾客预算↑」）。
     乘在收入上（不是加固定额）—— 越贵的单子，常客多花的越多。 */
  const bMul = Math.max(1, num(o.budgetMul, 1));
  /* ★ V22：闪光客人收入倍率（唯一的作用点 —— 小费不加，
     因为小费是"点得快"的奖励，不该和"这单值钱"混在一起）。 */
  const vMul = o.vip ? CFG.VIP_INCOME : 1;
  const income = Math.max(1,
    ((o.price * bMul - sub) * cups - (saleNow ? CFG.SALE_UNIT_SUB * cups : 0)) * vMul);

  s.cash += income;
  sim.revenue += income;
  sim.orders++;
  /* ★ V22：闪光客人的高光记在**订单完成时**（rushStation 里没有订单对象 o，
     我第一版插在那儿，直接 ReferenceError）。 */
  if (o.vip) pushHighlight(sim, 'vip', `✨ 第 ${sim.orders} 单是闪光客人（+${Math.round((vMul - 1) * 100)}% 收入）`);
  sim.cups += cups;
  /* ★ V13.6：满意服务 → 好感累积（成常客的那天会推一条日志） */
  if (o.regId) regularServe(s, o.regId);
  /* ★★ V21 修复：总店（branchIdx = 1）**也**享受店长加成。
     ★ 原来这里写 `branchIdx >= 2`，注释给的理由是"加成必须限定在店长管的店，
       否则招店长变成全局加成、玩家无脑堆一家店"。
       但那个理由不成立：`hireManager()` 已经限制了
         ① 每家店至多 1 名店长（按 store.branch 判重）
         ② 名额 = 店数 − 已招数
       所以"把 5 个店长堆进同一家店"在代码里**根本不可能发生** ——
       这个 >=2 防的是一个不存在的场景。
     ★ 它真实造成的后果是"承诺了没兑现"：
       `managerSlotsLeft` 从 V12 起就把总店算进名额（注释明写「含主店」），
       玩家可以在总店招店长、每天照付工资，而速度/口碑加成全部不生效 ——
       付了钱、零收益，且界面上看不出来。
     ★ 保留的约束：加成只作用于**有店长的那家店**（这点没变），
       不涉及全局。 */
  const stMb = (st && st.branchIdx >= 1) ? managerBonus(s, st.branchIdx) : null;
  sim.repGain += CFG.SERVE_REP * (type ? type.repMul : 1) * cups * (stMb ? stMb.rep : 1);
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
  /* ★ V13.6：常客的小费加成（开罗的常客「出手更大方」） */
  const t = st.order.price * CFG.RUSH_TIP * bonus * cardMul(s, 'tip')
    * Math.max(1, num(st.order.tipMul, 1));
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

/**
 * 候选人刷新冷却递减（V17）
 *
 * ★ 为什么单独一个函数而不是塞进 tick()：
 *   tick 只在「营业中且未暂停」时跑 —— 而玩家在**备货阶段**（开门前）
 *   也会看员工页、点刷新。冷却不递减的话，
 *   玩家在备货阶段点一次刷新，接下来一整天都转不出来
 *   —— 表现为「按钮灰了但不知道为什么」。
 *   ★ 所以冷却必须**与阶段无关**地走真实时间。
 *
 * @param {object} s 状态
 * @param {number} dt 秒
 */
function tickCooldowns(s, dt) {
  if (!s) return;
  if (s.candCd > 0) s.candCd = Math.max(0, s.candCd - dt);
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
      sim.lost++; sim.waitLost++;
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
      const tt = stationTime(s, st, sim) * (1 + ((st.order.cups || 1) - 1) * 0.35);
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
      sim.lost++; sim.closedLost++;
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
  /* V11 店长日薪并入工资总额 —— 店长是雇员，不能白拿。
     ★ 计入 wages 而不是另开一个科目：日报上玩家看的是"人工成本"，
       拆成两项会让"招了几个店长"在账目上不可见，
       而看不见的成本就是会被忽略的成本。 */
  const mgrWage = (s.managers || []).reduce((a, b) => a + num(b.wage, 0), 0);
  const wages = Math.round((s.staff.reduce((a, b) => a + b.wage, 0) + mgrWage) * ep * cardMul(s, 'wage'));
  /* ★★ V22：costMult 现在**也作用于日租**。
     原来它只乘在一次性支出（开店/升级）上，对 30 天总成本的影响 <3% ——
     等于"地狱模式"只在头两天贵一点。挂到日租之后，扩张才变成持续压力。 */
  let rentRaw = (CFG.RENT_PER_SHOP * s.shops + CFG.SHOP_UPKEEP * (s.shops - 1)) * d.rentMult * d.costMult * ep * cardMul(s, 'rent') * chapterMul(s, 'rent');
  for (const st of s.staff) if (st.trait === 'wise') rentRaw *= 0.92;
  /* 店长 lean 特性（精打细算）→ 该店租金 -12%，按店长数逐个施加 */
  for (const m of (s.managers || [])) if (managerTrait(m).id === 'lean') rentRaw *= 0.88;
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
  repDelta += sim.repGain * 0.25 * cardMul(s, 'repGain') * chapterMul(s, 'rep');
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
  /* V10：单日杯数（成就「月落之时」判定用）。
     ★ 在**日结算**时写，而不是出杯时累加 —— 出杯时写会被中途结束的
        营业流程（openShop 提前 return）截断，出现"打了烊却没记录"的偏差。 */
  s.stats.lastDayCups = num(sim.cups, 0);
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
    /* V21：流失四类（加上 stockout 共五类），供结算页做归因展示。
       五者之和 == lost（另有极少数边界情况可能不入桶，UI 只显示非零项）。 */
    waitLost: sim.waitLost || 0, fullLost: sim.fullLost || 0,
    closedLost: sim.closedLost || 0,
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
     只在当天达成时记，之后即使净资产回落也不撤销 —— 它是节奏提示，不是持续 buff。
     ★ V14.3：达成时记一个 `milestoneHit` 标记，让 UI 层能放音效 + 提示。
       原来只有一行 pushLog —— 玩家达成 5 天锚点（这是 30 天里少数几个
       "我确实做到了"的时刻）却听不到任何声音，成就感被白白丢掉。
       ★ 引擎层不直接调音效（那属于表现层），只写标记。 */
  /* ★★ 清零必须在**判定之前**：
     初版我把它写在判定后面（下面 debtDays 旁边），结果标记刚置上就被清掉，
     UI 永远收不到 —— 而且 engine 层测试全绿，只有实际点击才知道。
     ★ 「一次性事件标记」的清零要在本次事件的判定**之前**做，
       否则自己把自己清了。 */
  s.milestoneHit = false;
  const ms = milestoneOf(s);
  if (ms && ms.hit) {
    if (!Array.isArray(s.msHit)) s.msHit = [];
    if (s.msHit.indexOf(ms.day) < 0) {
      s.msHit.push(ms.day);
      s.milestoneHit = true;
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
    无尽模式与已通关的局面没有中期目标，返回 null。

    ★ V20：原来算worth = goal × MILESTONE_RATIO[idx]（比例），
      现在改成**每档独立的绝对值** STAGE_GOALS[难度][idx]。
      ★ 换掉比例的原因：比例隐含「所有档位增长曲线同形」的前提，
        而 probe-curve 实测证明不是（easy 爆发型 / hard 平缓型），
        同一组比例套三档必然错配 —— easy 第 14 天就通关，
        hard 反而比 normal 容易。 */
function milestoneOf(s) {
  if (s.endless || isFinished(s)) return null;
  const d = Math.max(1, num(s.day, 1));
  let idx = Math.ceil(d / MILESTONE_EVERY) - 1;
  idx = Math.max(0, Math.min(MILESTONE_EVERY_COUNT - 1, idx));

  /* ★ 取本档的锚点表；缺失时回落到「按比例算旧路径」——
     老存档里 difficulty 可能不存在（或以后新增档位忘了配表），
     此时不能崩，回落行为与旧版一致。
     ★ 用 diffOf(s).key 而不是 s.diff.key —— s.diff 存的是**字符串**
       （实测 S.diff === "easy"），不是对象；写 .key 会得到 undefined
       然后静默走到回落分支，看起来「功能没生效」却没有任何报错。 */
  const key = (diffOf(s) || {}).key || 'normal';
  const table = STAGE_GOALS[key];
  const goal = num(goalOf(s), 0);
  const atDay = Math.min(CFG.DAYS, (idx + 1) * MILESTONE_EVERY);
  const worth = (table && table[idx] != null)
    ? table[idx]
    : Math.round(goal * MILESTONE_RATIO[idx]);
  const nw = num(netWorth(s), 0);
  return { day: atDay, worth: worth, gap: worth - nw, hit: nw >= worth, isLast: idx === MILESTONE_EVERY_COUNT - 1 };
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
  /* ★ V13.6：常客好感每日自然衰减（不常来的会淡忘）。
     已经成常客的（好感满 100）不衰减 —— 那是"铁粉"，不会因为一天没来就忘了。 */
  regularDecay(s);
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
  refreshCandidates(s, true);   /* V17：系统行为，不受手动刷新冷却限制 */
  /* V11 店长日常：新候选补货 + 每日自动补员。
     放在 refreshCandidates 之后 —— 店长招人要用候选人池，
     池子必须先刷新过，否则店长会永远招不到人（候选人被招空后不补）。 */
  dailyManagerRefresh(s);
  managerDaily(s);
  /* V12：托管店的每日结算。放在 managerDaily 之后 ——
     店长先补员，托管店才有员工可经营（否则新托管的店第一天必然是空店）。 */
  managedStoresDaily(s);
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
      /* ★ V10：成就可奖励**稀有食谱**（ACH_RECIPES）。
         这些食谱不在研发树上、只能这样拿。
         重复/已解锁的处理见 grantAchRecipe。 */
      if (a.reward.recipe) grantAchRecipe(s, a.reward.recipe);
      got.push(a);
      pushLog(s, `🏅 成就达成：${a.emoji} ${a.name}`);
    }
  }
  return got;
}

/**
 * 发放成就奖励食谱。
 *
 * ★ 重复获得 / 已解锁的处理（本函数的全部难点）：
 *   成就是**一次性**的（s.ach[a.id] 一旦为true 就不再判定），
 *   但奖励食谱仍需要明确的幂等语义，否则会踩到这几种情况：
 *     ① 已解锁该食谱 → 不能再 push 进 s.recipes（会重复扣槽位、
 *        菜单卡出现两行一样的、成就"配方全收集"计数虚高）
 *     ② 导入的老存档里已经含有该食谱 → 同上
 *     ③ 同一个成就被多路径触发（理论上不该发生，但 get纯函数化更安全）
 *   处理：**已解锁则跳过发放，并把现金奖励照常发**——
 *   不因为"配方重复"而吞掉成就的现金部分（那是玩家应得的另一份奖励）。
 *   额外提示玩家"已拥有"，避免玩家以为自己白拿了一个新菜。
 *
 * @returns {{ok: boolean, dup: boolean, name?: string}}
 */
function grantAchRecipe(s, rid) {
  const r = achRecipeById(rid);
  if (!r) return { ok: false, dup: false };
  if (!s.recipes) s.recipes = [];
  if (s.recipes.includes(rid)) {
    pushLog(s, `📜 成就奖励「${r.name}」你已拥有，奖励现金照常发放`);
    return { ok: true, dup: true, name: r.name };
  }
  s.recipes.push(rid);
  s.flags['achRecipe'] = (s.flags['achRecipe'] || 0) + 1;
  bumpQuest(s, 'research', 1);
  pushLog(s, `📜 成就奖励食谱：${r.emoji} ${r.name}`);
  /* 立刻可用性检查：若当前不在它的城市，要明确告诉玩家"去某城才能上架"，
     否则玩家拿到菜却发现上不了架会以为是 bug。 */
  if (!recipeAvailableAt(s, rid, true)) {
    const c = cityById(r.city);
    pushLog(s, `　　（需前往${c ? c.name : '指定城市'}才能上架）`);
  }
  return { ok: true, dup: false, name: r.name };
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
  /* ★ V21：三条阈值必须从**当前合同**取，不能只写在 check 里。
     原来 c_cheap / c_premium / c_nolost 的 check 读 m.avgCap / m.avgFloor / m.lostCap，
     而这里从没提供过这三个字段 —— `m.avgPrice <= undefined` 恒为 false，
     三条合同**永远不可能达成**，玩家每天白扣 3~4 点口碑（10 条里占 3 条 = 28.9% 的日子）。
     ★ 缺省值是 ±Infinity 而不是 0：
       没设阈值的合同不能被「默认 0」误判失败（lost <= Infinity 恒真）。
       用 ±Infinity 而不是 undefined，判据逻辑本身不需要任何特判。 */
  const c = (s.contract && contractById(s.contract.id)) || {};
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
    /* 合同自带的阈值（缺省不设限） */
    avgCap: c.avgCap == null ? Infinity : num(c.avgCap, Infinity),
    avgFloor: c.avgFloor == null ? -Infinity : num(c.avgFloor, -Infinity),
    lostCap: c.lostCap == null ? Infinity : num(c.lostCap, Infinity),
    /* ★ V13.5 地域维度指标（供「地域挑战」关卡用）。
       全部**只统计当天**（与其它关卡指标同一口径），
       这样「今天在成都卖了多少杯」才是玩家能当场看到、能努力达成的事。
       ★ cuisineCups 需要按配方→菜系聚合：
         sim.byRecipe 记的是配方销量，菜系要从配方反查。 */
    cityCups: num(sim.cups, 0),                       /* 当天总杯数（城市维度关卡用） */
    cuisineCups: cuisineCupsToday(s),                /* 当天指定菜系的杯数 */
    branches: pos(s.shops, 1),                        /* 当前分店数（不是当天量） */
    visits: (s.citiesVisited || []).length,           /* 已到访城市数（累计） */
  };
}

/**
 * 当天某个菜系卖出的杯数（V13.5 地域挑战用）
 *
 * ★ 口径：**当天**（与其它关卡指标一致），
 *   跨天累计会让「今天做 X」这种可当场努力的目标失去意义。
 *
 * @param {string} cuisineId 菜系 id；为空时返回 0
 */
function cuisineCupsToday(s, cuisineId) {
  if (!cuisineId) return 0;
  const sim = s.sim || s.report || {};
  const by = sim.byRecipe || {};
  let n = 0;
  for (const rid in by) {
    const r = recipeById(rid);
    if (r && r.cuisine === cuisineId) n += num(by[rid], 0);
  }
  return n;
}

/** 每天开局抽一个合同（备货页可见）；已抽过的优先不重复 */
function rollContract(s) {
  if (!CONTRACTS.length) { s.contract = null; return null; }
  const recent = arr(s.contractLog).slice(-4).map(String);
  const pool = CONTRACTS.filter(c => recent.indexOf(c.id) < 0);
  const from = (pool.length ? pool : CONTRACTS);
  /* ★★ V22：按章加权 —— 适配当前章的合同出现概率 ×2。
     ★ 目的不是平衡，是**让章节机制被"教到"**：
       夜市出「薄利多销」、车站出「零流失」、商圈出「高端形象」。
       只靠一句过场文案，玩家很难把"这章该换打法"落到操作上；
       每天压在头上的合同是最便宜的教法。
     ★ 权重用"入池两次"实现而不是浮点权重：
       浮点权重要额外算累积和，一个 off-by-one 就会让某条合同永远抽不到。 */
  const chNow = chapterOf(s);
  const bag = [];
  for (const c of from) {
    bag.push(c);
    const fit = Array.isArray(c.fit) ? c.fit : null;
    if (!fit || fit.indexOf(chNow) >= 0) bag.push(c);   /* 适配（或未标注）→ 权重 2 */
  }
  const c = bag[Math.floor(rnd(0, bag.length))] || from[0];
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
  /* ★ V13.5：**跨章**找第一个未完成的关卡。
     原来是「只在本章里找」，而章节是按天硬切的（day 11~15 = 第 3 章），
     关卡又每天只结算一次 ——
     结果是「一关卡住 = 整章 3~4 关全部永久错过」。
     实测：连续 5 天不达成第 1 关，day 16 进第 4 章时，
     第 3 章的 4 关全部作废。
     那是**既有缺陷**，但 V13.5 给每章加了第 4 关（容错从 2 关降到 1 关），
     会让它更容易发生，所以连着一起修。
     修法：待打关卡可以在更早的章节里继续打，
     顺序仍是「先打靠前的章节」（保证玩家按进度推进）。

     ★★ 必须**按 chapter/order 排序**后再找 ——
       STAGES 数组的物理顺序不等于关卡顺序：
       V13.5 把新关卡追加在数组末尾，
       所以「第 3 章 order4」在数组里排在「第 4 章 order1」之后。
       不排序的话 currentStage 会跳到后面的章节去。 */
  const ordered = STAGES.slice().sort((a, b) => (a.chapter - b.chapter) || (a.order - b.order));
  for (const st of ordered) {
    if (!done[st.id]) return st;
  }
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
  /* ★ V13.5：累计型 metric（分店数 / 到访城市数）**不吃天数成长缩放**。
     那些是"你一共开几家店""你去过几个城市"，随天数自然增长 ——
     再乘一遍天数系数会让门槛变成不可能的斜率。
     而且它们的量级很小（3 家 / 4 城），乘上 1.35 会变成 4 / 5.4 这种非整数。 */
  const cum = (st.metric === 'branches' || st.metric === 'visits');
  if (st.metric === 'sat') {
    /* 比例型：只吃难度档的微量加成，且封顶 0.99 */
    g = Math.min(0.99, g + (num(diff.goalMul, 1) - 1) * 0.02);
  } else if (st.metric === 'lost') {
    /* 上限型：难度越高允许流失越少 */
    g = Math.max(0, Math.round(g / Math.max(1, num(diff.goalMul, 1))));
  } else if (!cum) {
    g = g * num(diff.goalMul, 1);
  }
  /* 游戏难度缩放：easy 门槛低、hard 门槛高（但只吃一档，避免 hard 完全打不动） */
  const gd = num(d.stageGoal, 1);
  if (st.metric !== 'sat' && !cum) g = st.metric === 'lost' ? Math.max(0, Math.round(g / gd)) : g * gd;
  /* 天数成长：越到后期目标越高（一天的量本来就更大） */
  if (st.metric !== 'sat' && !cum) {
    const t = 1 + Math.max(0, num(s.day, 1) - 1) * 0.012;
    g = g * t;
  }
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
  /* ★ V13.5 地域挑战的 4 个 metric */
  else if (st.metric === 'cuisineCups') prog = cuisineCupsToday(s, st.cuisine);
  else if (st.metric === 'branches') prog = pos(s.shops, 1);
  else if (st.metric === 'visits') prog = (s.citiesVisited || []).length;
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
  /* ★ V13.5：跨章补打时，本章可能已全通，但**更早的章节**还有关卡没打。
     那些关卡现在仍可补打（currentStage 是全局找第一个未完成的），
     所以 UI 必须让玩家知道"还有 N 关待补"，否则会以为全打完了。 */
  const backlog = STAGES.filter(x => !done[x.id] && x.chapter < ch).length;
  return {
    chapter: ch, chapterCount: STAGE_CHAPTERS, cleared, total: list.length,
    chapterDone, chapterProgress: list.length ? cleared / list.length : 0,
    backlog,
    stages: list.map(x => ({
      id: x.id, name: x.name, emoji: x.emoji, desc: x.desc, done: !!done[x.id],
      current: cur && cur.id === x.id,
    })),
    cur: cur ? {
      id: cur.id, name: cur.name, emoji: cur.emoji,
      desc: cur.desc.replace('{g}', stageGoalOf(s, cur, diff)),
      goal: stageGoalOf(s, cur, diff), cash: stageCashOf(s, cur, diff),
      metric: cur.metric, unit: cur.unit || '', prefix: cur.prefix || '',
      /* ★ V13.5：地域挑战要显示**具体目标** ——
         「卖出特色菜系 12 杯」玩家不知道是哪道菜系，
         得给出名字与图标，否则这个关卡等于没法准备。 */
      cuisine: cur.cuisine ? (CUISINES.find(c => c.id === cur.cuisine) || null) : null,
      cityName: cur.metric === 'cityCups'
        ? ((cityById(s.venue && s.venue.cityId) || {}).name || null)
        : null,
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
  /* ★ 切到直辖市（北京/天津/上海/重庆）时，**市**不会变
     （该省本来就只有这一个市）—— 只提示省份变化会让玩家以为没生效，
     所以明确说清「已切换到 XX 省（该省仅 1 个市）」。*/
  const single = citiesOfProvince(p.id).length === 1;
  return r.ok
    ? { ok: true, provId: p.id, cityName: first.name,
      msg: single ? `已切换到${p.name}（该省仅 1 个市）` : '' }
    : r;
}

/**
 * 市级：在**当前省内**循环切换。
 *
 * ★ 直辖市/特别行政区只有 1 个市（北京、天津、上海、重庆…），
 *   原来的循环 `(i+1) % list.length` 在长度为 1 时**永远回到自己** ——
 *   表现为「点了没反应、也不报错」。
 *   而默认城市恰恰就是北京，所以新玩家第一次点就中招。
 *
 * ★ 修法：省内只有 1 个城市时，**跨省继续找下一个有多个市的省**，
 *   仍然停在同省时给出明确提示（而不是静默无效）。
 */
function nextCity(s) {
  const v = s.venue || {};
  const list = citiesOfProvince(v.provId);
  if (!list.length) return { ok: false, msg: '该省暂无可选城市' };
  if (list.length === 1) {
    /* 该省只有这一个市 → 跨省找下一个「有多个市」的省 */
    for (let k = 1; k <= PROVINCES.length; k++) {
      const pid = PROVINCES[(PROVINCES.findIndex(p => p.id === v.provId) + k) % PROVINCES.length].id;
      const l2 = citiesOfProvince(pid);
      if (l2.length <= 1) continue;
      const c2 = l2[0];
      const r2 = setVenueCity(s, c2.id);
      if (r2.ok) {
        return {
          ok: true, cityId: c2.id, cityName: c2.name,
          msg: `${citiesOfProvince(v.provId)[0].name}是该省唯一城市，已跳到${c2.name}`,
        };
      }
    }
    return { ok: false, msg: '该省只有一个城市，可先切换省份' };
  }
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
  /* 换城市前先记下旧菜单 —— 切换后要把「本店用不上」的款移出菜单 */
  const prevCity = currentCityId(s);
  /* 城市痕迹：已访问列表去重追加 + 连住天数（换城归零）。
     这两项供成就「跨城游商」「不打烊的城市」判定，
     必须在**切 cityId 之前**算，否则 prevCity 会已是新城市。
     ★ 新城市也要记 —— 只记旧城市的话，新城市要等"再换一次"才被计入，
       成就「经营过 3 个城市」会凭空少算一个。 */
  if (!Array.isArray(s.citiesVisited)) s.citiesVisited = [];
  if (s.citiesVisited.indexOf(prevCity) < 0) s.citiesVisited.push(prevCity);
  if (s.citiesVisited.indexOf(c.id) < 0) s.citiesVisited.push(c.id);
  s.stayDays = (prevCity === c.id) ? (num(s.stayDays, 0) + 1) : 1;
  s.venue.provId = c.prov;
  s.venue.cityId = c.id;
  if (did == null) delete s.venue.districtId;
  else s.venue.districtId = did;
  /* 换城市后旧坐标必然对不上新城区，直接清掉而不是留着自相矛盾 */
  if (s.venue.lng != null) clearGeo(s);
  const kept = refreshCityMenu(s, prevCity);
  return {
    ok: true, provId: c.prov, cityId: c.id, districtId: did,
    cityName: c.name, dropped: kept.dropped, kept: kept.kept,
    cityCuisines: cuisinesOfCity(c.id).map(x => x.id),
    cityIngs: ingsOfCity(c.id).map(x => x.id),
  };
}

/**
 * 城市切换后的**数据刷新**（需求 2 的核心）。
 *
 * 要刷新四样东西，少一样就会出"看起来能点但点了没反应"的坑：
 *   ① 菜单：移出本店城市用不上的配方（但保留在 s.recipes 里）
 *   ② 库存：城市专属原料在别城买不到、也用不上，清掉避免占资金
 *   ③ 城市菜系工坊：不在本城的产线等级**保留**（换个城市回来还能用），
 *      但要确保不会出现"有等级却没配方可用"的空产线状态
 *   ④ ratios：被移出菜单的定价保留，重新上架时不用重设
 *
 * @param {string} prevCity 切换前的城市 id
 * @returns {{kept: string[], dropped: string[]}} kept/dropped 是菜单 id 列表
 */
function refreshCityMenu(s, prevCity) {
  s.menu = arr(s.menu);
  const dropped = [];
  const kept = [];
  for (const rid of s.menu) {
    if (recipeAvailableAt(s, rid, true)) kept.push(rid);
    else dropped.push(rid);
  }
  s.menu = kept;
  /* 菜单不能空：至少补一款本店城市能做的（否则当天开不了门） */
  if (!s.menu.length) {
    const pool = availableRecipes(s);
    const prefer = pool.find(rid => {
      const r = recipeById(rid);
      return r && !r.city;                 /* 优先通用菜 */
    }) || pool[0];
    if (prefer) {
      s.menu.push(prefer);
      if (s.ratios[prefer] == null) s.ratios[prefer] = 1.0;
      if (dropped.indexOf(prefer) < 0) dropped.push(prefer);
    }
  }
  /* 城市专属原料在别城是死库存：清掉，把资金还给玩家。
     ★ 必须清 —— 否则玩家在成都囤的藤椒油带到北京，
       占着 inventory 的资金上限却永远用不掉。 */
  const cid = currentCityId(s);
  const freed = {};
  for (const g of ING) {
    if (g.origin && g.origin !== cid && (s.inv[g.id] || 0) > 0) {
      freed[g.name] = s.inv[g.id];
      s.inv[g.id] = 0;
    }
  }
  if (dropped.length) {
    pushLog(s, `📍 换城市：${dropped.length} 款本地菜已下架（配方保留，回来还能卖）`);
  }
  if (Object.keys(freed).length) {
    pushLog(s, `📦 清空异地原料：${Object.keys(freed).join('、')}`);
  }
  if (prevCity && prevCity !== cid) {
    const cn = cityById(cid);
    pushLog(s, `📍 已切换经营城市：${cn ? cn.name : cid}`);
  }
  return { kept: kept.slice(), dropped: dropped.slice() };
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
 * 城市地图视图（V13）
 *
 * ★ 为什么地图只画 **44 个有坐标的城市**：
 *   CITY_CENTERS 只收录了 44 个城市的 GCJ-02 坐标（覆盖 31/34 个省）。
 *   272 个市全画出来需要 272 套坐标 ——
 *   而坐标是**合规数据**（GCJ-02 口径，见 data.js 的说明），
 *   不该用插值/近似值糊弄（那会让「门店定位」落到隔壁街区）。
 *   所以地图 = 「有精确坐标的城市」+「按省聚合的完整信息」。
 *   省份信息是完整的（272 个市都能选），只是**没坐标的不画点**。
 *
 * ★ 投影：经纬度**分别**归一化（不用单一缩放因子）。
 *   中国境内经差约 62°、纬差约 50°，
 *   若按经度等比缩放，高纬度城市会明显偏西 —— 地图形状会失真。
 *
 * @returns 地图视图：省份列表（含聚合信息）+ 城市点列表（含归一化坐标）
 */
function cityMapView(s) {
  const cur = (s.venue && s.venue.cityId) || CITY_DEFAULT;
  const provs = [];
  const points = [];
  /* 收集所有有坐标的城市 */
  for (const p of PROVINCES) {
    let n = 0, withGeo = 0;
    for (const cid of p.cities) {
      const c = cityById(cid);
      if (!c) continue;
      n++;
      const g = cityGeoOf(cid);
      if (!g) continue;
      withGeo++;
      points.push({
        id: cid, name: c.name, provId: p.id, provName: p.name,
        lng: g.lng, lat: g.lat,
        isCurrent: cid === cur,
        hasCuisine: hasCityCuisine(c),
      });
    }
    provs.push({
      id: p.id, name: p.name, cityCount: n, geoCount: withGeo,
      isCurrent: p.id === ((s.venue && s.venue.provId) || ''),
    });
  }
  /* 归一化：经纬各自缩放到 0~1 */
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const pt of points) {
    if (pt.lng < minLng) minLng = pt.lng;
    if (pt.lng > maxLng) maxLng = pt.lng;
    if (pt.lat < minLat) minLat = pt.lat;
    if (pt.lat > maxLat) maxLat = pt.lat;
  }
  const spanLng = Math.max(0.001, maxLng - minLng);
  const spanLat = Math.max(0.001, maxLat - minLat);
  for (const pt of points) {
    pt.x = (pt.lng - minLng) / spanLng;      /* 0=西 1=东 */
    pt.y = 1 - (pt.lat - minLat) / spanLat;  /* 0=南 1=北 */
  }
  /* 排序：西→东，保证绘制顺序稳定（Canvas 上重叠点不闪） */
  points.sort((a, b) => (a.x - b.x) || (a.y - b.y));
  return {
    provs, points,
    bounds: { minLng, maxLng, minLat, maxLat },
    currentCityId: cur,
    currentCityName: (cityById(cur) || {}).name || '',
    geoTotal: points.length,
    cityTotal: provs.reduce((a, p) => a + p.cityCount, 0),
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
 * 注意：这里**不校验版本号** —— 版本差异由 migrateSave 逐级处理（V14.4 起）。
 * 校验版本号当拒绝条件才是问题所在：升一次版本就让所有存量存档失效。
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
  /* ★ V10 城市绑定：解锁了但不在本店城市 → 不能上架。
     必须在**引擎入口**拦住（不能只靠 UI 置灰），
     否则改存档或直接调 toggleMenu 就能上架本地买不到原料的菜，
     而备货逻辑买不到那些原料 —— 表现为"点开不了门"的死局。 */
  if (!recipeAvailableAt(s, rid, true)) {
    const c = cityById(r.city);
    return { ok: false, msg: `该配方只在${c ? c.name : '指定城市'}可用` };
  }
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
/** 写入：成功 true，失败 false 并记录原因（绝不向外抛）
 *
 * ★★ V20：加**备份键**（双写）——
 *   查到的问题：存档损坏时读档直接返回 null，
 *   玩家看到的就是「我的存档没了」，而他不知道发生了什么、
 *   更不知道数据还在本地。
 *   ★ 真会发生的场景：写入过程中浏览器被杀（切后台/低电量/微信退出），
 *     localStorage 里会留下**截断的 JSON**，下次读档必挂。
 *   ★ 现在的做法：每次写都同时写一份到 `.bak` 键。
 *     主档坏了还能从备份恢复 —— 而备份是**上一次成功写入**的完整数据，
 *     最多丢一局进度，而不是丢掉整档。
 *   ★ 读档时主档解析失败会自动尝试备份，并把坏主档挪走
 *     （不删 —— 万一还想人工抢救）。
 */
function storageSet(key, value) {
  const be = storeBackend();
  try {
    be.set(key, value);
    /* ★ 先写主档再写备份：顺序有意义。
       反过来的话，主档写失败而备份已写，会出现「新备份 + 旧主档」——
       恢复时用备份反而会跳回更早的进度。 */
    be.set(key + '_bak', value);
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

/**
 * 存档迁移（V14.4）
 *
 * ★ 为什么需要它：
 *   项目从 v2 一路演到 v14，中途加过招牌基线(V6)、菜系(V9)、
 *   分店(V12)、店长(V12)、常客(V13.5)、milestoneHit(V14)……
 *   每加一个字段，**几周前的老存档里就没有它**。
 *   原来 `s.v = 2` 一行把版本信息抹掉，导致：
 *     · 没有地方判断"这份存档缺什么"
 *     · 缺字段只能靠 sanitizeState 里的默认值兜底
 *     · ★ 而**漏兜一个就是静默丢进度**——
 *       实测 tools/_compat-probe.js：V2 老存档读出来 milestoneHit 直接 undefined。
 *
 * ★ 为什么是「逐级迁移」而不是「一把重建」：
 *   逐级（v1→v2→…→v14）的好处是**每一级只关心自己那一段的变化**，
 *   写完就不用再回头看；一把重建则每次都要把全部历史改动重新梳理一遍。
 *
 * ★ MIGRATIONS 的写法约定：
 *   `MIGRATIONS[n]` 把存档从版本 n 升到 n+1，只处理那一段新增的东西。
 *   只做**补默认值 / 结构补齐**，不要在这里改数值平衡——
 *   老玩家读档后不该因为平衡调整而凭空多钱少钱。
 */
const SAVE_VERSION = 14;

/** 从版本 n升到 n+1 的迁移。缺号不留空位（空位写成 null 占位）。 */
const MIGRATIONS = {
  /* v1 → v2：最早的版本连版本标记都没有，招牌基线（V6）就是这样加的 */
  1(st) {
    if (!st.sig || typeof st.sig !== 'object') st.sig = {};
    if (!st.sigRun || typeof st.sigRun !== 'object') st.sigRun = {};
  },
  /* v2 → v3：菜系系统（V9）—— 工坊与菜系配方 */
  2(st) {
    if (!st.workshops || typeof st.workshops !== 'object') st.workshops = {};
    if (!st.cuisines) st.cuisines = [];
    if (!st.cuiFocus) st.cuiFocus = {};
  },
  /* v3 → v4：分店与店长（V12）*/
  4(st) {
    if (typeof st.shops !== 'number') st.shops = 1;
    if (!st.venue || typeof st.venue !== 'object') {
      st.venue = { provId: '11', cityId: '110100', venueType: 'shop', name: '' };
    }
    if (!Array.isArray(st.managers)) st.managers = [];
    if (!Array.isArray(st.formerManagers)) st.formerManagers = [];
    if (typeof st.nextMgrId !== 'number') st.nextMgrId = 1;
    if (typeof st.activeShop !== 'number') st.activeShop = 1;
  },
  /* v3 → v4：商圈与场地（V10）*/
  3(st) {
    if (typeof st.stores !== 'object' || st.stores === null) st.stores = {};
    if (!st.cityView) st.cityView = null;
    if (typeof st.activeShop !== 'number') st.activeShop = 1;
  },
  /* v4 → v5：常客系统（V13.6）*/
  5(st) {
    if (!st.regulars || typeof st.regulars !== 'object') st.regulars = {};
  },
  /* v5 → v6：店长专精（V13.7）—— spec 挂在店长上，迁移由 sanitize 逐条清洗 */
  6(st) {
    if (!Array.isArray(st.managers)) st.managers = [];
  },
  /* v6 → v7：清仓相关（V13.9）不需要额外状态 */
  7(st) { },
  /* v7 → v8：分段仪表（V14）*/
  8(st) {
    /* milestoneHit 是一次性事件标记，读档时按"未达成"处理即可，
       但**必须显式写出来** —— 靠 sanitizeState 兜底就等于没有迁移链，
       以后再加字段还是同样的坑。 */
    if (typeof st.milestoneHit !== 'boolean') st.milestoneHit = false;
  },
  /* v8 → v9~v13：本次无状态变更（留空位以保持版本号连续可读）*/
  9(st) { }, 10(st) { }, 11(st) { }, 12(st) { }, 13(st) { },
};

/**
 * 按版本逐级迁移。
 * @param {object} st 待迁移的存档（原地修改）
 * @returns {{from:number, to:number, steps:string[]}}
 */
function migrateSave(st) {
  if (!st || typeof st !== 'object') return { from: 0, to: 0, steps: [] };
  /* 缺版本号 = v1（最早的存档连版本标记都没有）*/
  let v = clamp(int(st.v, 1), 1, SAVE_VERSION);
  const from = v;
  const steps = [];
  while (v < SAVE_VERSION) {
    const fn = MIGRATIONS[v];
    if (typeof fn === 'function') {
      try {
        fn(st);
        steps.push(`v${v}→v${v + 1}`);
      } catch (e) {
        /* ★ 迁移失败**不能中断读档**：
           一个坏存档不该让玩家连当天的经营都玩不了。
           记一步日志，继续往下走，后面的清洗会补默认值。 */
        steps.push(`v${v}→v${v + 1} 失败`);
      }
    }
    v++;
  }
  return { from, to: SAVE_VERSION, steps };
}

function sanitizeState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;

  /* ★★ V14.4：存档迁移必须在**清洗之前**做。
   *
   * 原来这里第一行就是 `s.v = 2` —— 无论读进来的是 v1 还是 v99，
   * 版本信息在清洗的**第一秒就被抹掉**，于是版本号只是个装饰：
   * 实测（tools/_compat-probe.js）sanitizeState 与 loadGame 里
   * **都没有任何对 s.v 的判断**，也就是说：
   *   「玩家几周前的存档」与「今天的存档」走的是同一条路，
   *   中间版本加过的字段只能靠「默认值兜底」——
   *   而漏兜一个，玩家就**静默丢进度**（实测 milestoneHit 就是这样丢的）。
   *
   * 现在的流程：读出 → migrateSave()按版本逐级迁移 → 清洗 → 标记为当前版本。
   * 加新字段时，除了在 sanitizeState 里给默认值，**还要在 MIGRATIONS 里加一条**，
   * 并跑 tools/check-save-compat.js 确认老存档能跑（CI 已接入）。 */
  migrateSave(s);

  s.v = SAVE_VERSION;
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

  /* ---------- V12 店铺体系：迁移 + 清洗 ----------
     ★ 这是本次数据模型重构最关键的一段。
       s.stores 是权威数据，老存档只有 s.shops（数字），
       必须在清洗时把数字还原成店铺数组 ——
       否则老存档读档后「店数对但店的信息全空」，
       玩家会看到一家没有名字、没有位置、员工全在总店的分店。
   */
  {
    const shopN = clamp(int(s.shops, 1), 1, 99);
    const rawStores = arr(s.stores);
    const stores = [];
    const seenBranch = new Set();
    const seenId = new Set();
    for (const st0 of rawStores) {
      if (!st0 || typeof st0 !== 'object') continue;
      /* 店号：1..shopN，且不重复（重复会让 staffOfBranch 认错店） */
      let br = clamp(int(st0.branch, 1), 1, shopN);
      if (seenBranch.has(br)) continue;
      seenBranch.add(br);
      const id = int(st0.id, 0);
      if (id > 0 && seenId.has(id)) continue;
      if (id > 0) seenId.add(id);
      const cityId = st0.cityId && cityById(st0.cityId) ? st0.cityId
        : (s.venue && s.venue.cityId) || '110100';
      const geo = cityGeoOf(cityId) || GEO.FALLBACK;
      stores.push({
        id: id > 0 ? id : stores.length + 1,
        branch: br,
        name: str(st0.name, 16) || defaultStoreName(s, cityId),
        emoji: str(st0.emoji, 8) || '🏪',
        cityId,
        venueType: VENUE_TYPES.some(t => t.id === st0.venueType) ? st0.venueType : VENUE_DEFAULT,
        lng: clamp(num(st0.lng, geo.lng), GEO.MIN_LNG, GEO.MAX_LNG),
        lat: clamp(num(st0.lat, geo.lat), GEO.MIN_LAT, GEO.MAX_LAT),
        coordSys: GEO.COORD_SYS,
        isMain: !!st0.isMain,
        level: clamp(int(st0.level, 1), 1, STORE_LEVELS.length),
        exp: posCap(st0.exp, 0),
        auto: !!st0.auto,
        managerId: st0.managerId == null ? null : int(st0.managerId, 0),
        cash: posCap(st0.cash, 0),
        inv: (() => {
          const inv0 = obj(st0.inv), out = {};
          for (const g of ING) {
            const v = posCap(inv0[g.id], 0);
            if (v > 0) out[g.id] = v;
          }
          return out;
        })(),
        income: posCap(st0.income, 0),
        expense: posCap(st0.expense, 0),
        cups: posCap(st0.cups, 0),
        days: posCap(st0.days, 0),
        lastReport: st0.lastReport && typeof st0.lastReport === 'object' ? st0.lastReport : null,
        history: arr(st0.history).slice(0, 7).filter(r => r && typeof r === 'object'),
        upgrades: obj(st0.upgrades),
      });
    }
    /* 老存档迁移：s.stores 为空但 s.shops > 1 → 生成对应数量的店。
       ★ 总店（branch 1）永远存在，且默认是主店。*/
    if (!stores.length) {
      for (let b = 1; b <= shopN; b++) {
        const cityId = (s.venue && s.venue.cityId) || '110100';
        stores.push(makeStore(s, {
          branch: b, id: b, cityId,
          isMain: b === 1,
          name: b === 1 ? '总店' : defaultStoreName(s, cityId),
          emoji: b === 1 ? '🏠' : '🏪',
        }));
      }
    } else {
      /* 有 stores 但缺总店 → 补一个（总店不可缺失）*/
      if (!stores.some(st0 => st0.branch === 1)) {
        const cityId = (s.venue && s.venue.cityId) || '110100';
        stores.unshift(makeStore(s, {
          branch: 1, id: stores.length + 1, cityId, isMain: true,
          name: '总店', emoji: '🏠',
        }));
      }
      /* ★ stores 数量少于 s.shops → 补齐缺失的店号。
         场景：脏存档里 s.shops=3 但 stores 只有 1 家（总店）。
         若不补，店号 2/3 的店长会在后续清洗里被当成"店号越界"丢弃 ——
         表现是「玩家的店长凭空消失」。
         反向（stores 比 s.shops 多）则由 syncShopCount 收口。*/
      const have = new Set(stores.map(st0 => st0.branch));
      for (let b = 1; b <= shopN; b++) {
        if (have.has(b)) continue;
        const cityId = (s.venue && s.venue.cityId) || '110100';
        stores.push(makeStore(s, {
          branch: b, id: stores.length + 1, cityId,
          isMain: false, name: defaultStoreName(s, cityId),
        }));
      }
      stores.sort((a, b) => a.branch - b.branch);
      /* 主店唯一：多个 isMain 时只留第一个 */
      let mainSeen = false;
      for (const st0 of stores) {
        if (st0.isMain) {
          if (mainSeen) st0.isMain = false;
          else mainSeen = true;
        }
      }
      /* 没有任何主店 → 把 branch 最小的那家设为主店 */
      if (!stores.some(st0 => st0.isMain)) {
        stores.reduce((a, b) => (a.branch <= b.branch ? a : b)).isMain = true;
      }
    }
    s.stores = stores;
    /* ★ 店数被 stores 覆盖 —— stores 是权威，s.shops 只是派生。
       这一行是「两个数据源冲突时谁说了算」的唯一答案。*/
    syncShopCount(s);
    s.nextStoreId = Math.max(
      int(s.nextStoreId, 1),
      stores.reduce((a, st0) => Math.max(a, num(st0.id, 0) + 1), 1),
    );
  }

  /* 员工 / 候选人 */
  const traitIds = TRAITS.map(t => t.id);
  /* 用 CFG.STAFF_MAX 而不是写死 12：以前这里截到 12、而运行时能雇到更多，
     于是「雇满 → 存档 → 读档」会凭空少掉几个员工，遣散费也不会退。 */
  /* ★ V11：branch = 员工所属分店（1 = 总店）。
     老存档完全没有这个字段 —— 全部归到总店（branch=1），
     这是**业务语义上正确的还原**：V11 之前根本没有分店编制，
     所有员工本来就是在总店干活。 */
  s.staff = arr(s.staff).slice(0, CFG.STAFF_MAX).map((st, i) => ({
    id: int(st && st.id, i + 1),
    name: str(st && st.name, 12) || '员工',
    emoji: str(st && st.emoji, 8) || '🧑',
    skill: clamp(num(st && st.skill, 1), 0.2, 5),
    trait: traitIds.indexOf(st && st.trait) >= 0 ? st.trait : null,
    wage: posCap(st && st.wage, 60),
    stamina: clamp(num(st && st.stamina, 100), 0, 100),
    /* 分店号夹到 1..shops：脏存档塞个 999 会让员工"属于一家不存在的店"，
       那家店没有店长也永远不会开张，员工就变成了不可见的僵尸。 */
    branch: clamp(int(st && st.branch, 1), 1, Math.max(1, pos(s.shops, 1))),
    hiredBy: (st && st.hiredBy === 'mgr') ? 'mgr' : 'player',
  }));
  s.candidates = arr(s.candidates).slice(0, 6).map(c => ({
    name: str(c && c.name, 12) || '候选人',
    emoji: str(c && c.emoji, 8) || '🧑',
    skill: clamp(num(c && c.skill, 1), 0.2, 5),
    trait: traitIds.indexOf(c && c.trait) >= 0 ? c.trait : null,
    wage: pos(c && c.wage, 60),
    fee: pos(c && c.fee, 260),
  }));

  /* ---------- V11 店长 ---------- */
  const shopN = Math.max(1, pos(s.shops, 1));
  const mgrTraitIds = MANAGER_TRAITS.map(t => t.id);
  const mgrLvIds = MANAGER_RANKS.map(r => r.lv);
  /* ★ V12：店号必须在 1..shopN（**含总店** —— 需求明确「每家分店最多任命
     1 名店长（含主店）」）。
     两条硬约束：
       ① branch >= 1：脏存档把店长挂在 0 或负数号上，会凭空多出一个可用名额
       ② 同一家店不能有两个店长 —— 否则 hireManager 的「该店已有店长」
          守卫与 managerOfBranch 的线性查找会不一致，
          表现为"招了第二个店长，但加成一店算一次、工资付两次" */
  const seenBranch = new Set();
  const mgrs = [];
  for (const m of arr(s.managers)) {
    let br = int(m && m.branch, 1);
    if (!(br >= 1) || br > shopN) br = -1;      /* 无效店号 → 丢弃该店长 */
    if (br < 0 || seenBranch.has(br)) continue;   /* 重复占用同一家店 → 丢弃 */
    seenBranch.add(br);
    mgrs.push({
      id: int(m && m.id, mgrs.length + 1),
      name: str(m && m.name, 12) || '店长',
      emoji: str(m && m.emoji, 8) || '🧑‍💼',
      lv: mgrLvIds.indexOf(int(m && m.lv, 1)) >= 0 ? int(m.lv, 1) : 1,
      skill: clamp(num(m && m.skill, 1), 0.3, 3),
      trait: mgrTraitIds.indexOf(m && m.trait) >= 0 ? m.trait : 'none',
      /* ★ V13.7：专精方向清洗。
         字典外 → null（当没专精）。
         ★ 而且**等级不够时也要丢掉** ——
           脏存档塞 spec='ops' + lv=1 就能白得 +20% 客流/满意（还带 -10% 减益，
           净收益仍为正）—— 所以必须连等级一起校验。 */
      spec: (function () {
        const sid = m && m.spec;
        if (!sid) return null;
        if (!MANAGER_SPECIALTY.fields.some(x => x.id === sid)) return null;
        const lv = mgrLvIds.indexOf(int(m && m.lv, 1)) >= 0 ? int(m.lv, 1) : 1;
        if (lv < MANAGER_SPECIALTY.minLv) return null;
        return sid;
      })(),
      wage: posCap(m && m.wage, 120),
      branch: br,
      days: clamp(int(m && m.days, 0), 0, 9999),
    });
  }
  s.managers = mgrs;
  /* ★ V13.6：常客档案清洗。
     要点：
       ① 必须是对象（老存档没有这个字段）
       ② fav 夹取到 [0, max] —— 脏存档塞 fav=99999 会让所有人立刻成常客
       ③ type 必须在字典内 —— 否则 UI 显示不出名字，且该条目不该计数
       ④ 条数上限 —— 最多 5 类型 × 4 变体 = 20 条，超出的丢弃
     ★ fav 上限必须夹：**脏存档塞一个 fav=9999 就白得 15% 消费加成**，
       这类漏洞在"玩家互相分享存档"的场景下最容易被利用。 */
  {
    const raw = (s.regulars && typeof s.regulars === 'object' && !Array.isArray(s.regulars)) ? s.regulars : {};
    const out = {};
    let n = 0;
    for (const id in raw) {
      if (n >= 40) break;
      const r = raw[id];
      if (!r || typeof r !== 'object') continue;
      if (!CUSTOMER_TYPES.some(t => t.id === r.type)) continue;
      out[String(id).slice(0, 24)] = {
        id: String(id).slice(0, 24),
        type: r.type,
        face: typeof r.face === 'string' ? r.face.slice(0, 8) : '🧑',
        fav: clamp(num(r.fav, 0), 0, REGULAR_CFG.max),
        name: typeof r.name === 'string' ? r.name.slice(0, 16) : '常客',
      };
      n++;
    }
    s.regulars = out;
  }
  /* ★ 名额硬顶：店长数**不可能**超过店数（V12 含主店，故为 shopN）。
     不裁剪的话，脏存档塞 20 个店长进来，
     玩家白得 20 份加成而分店只有 3 家（白嫖是最难查的平衡漏洞）。 */
  if (s.managers.length > shopN) s.managers = s.managers.slice(0, Math.max(0, shopN));
  /* id 计数器必须大于所有现存店长的 id，否则新招的店长会和旧的撞 id */
  let maxMgrId = 0;
  for (const m of s.managers) if (m.id > maxMgrId) maxMgrId = m.id;
  s.nextMgrId = clamp(Math.max(int(s.nextMgrId, 1), maxMgrId + 1), 1, NUM_CAP);
  /* ---------- V12.1：留档店长（formerManagers）----------
     清洗要点：
       ① 必须是数组（老存档没有这个字段）
       ② 字段逐个夹取（脏存档可能塞字符串等级/负工资）
       ③ **不能与现役店长重名同 id** —— 重名会导致
          「两个店长共用一个 id」，于是加成算两次、工资付两次
       ④ 留档数量有上限（否则脏存档能塞 1000 个，白嫖店长） */
  {
    const fm = [];
    const usedIds = new Set(arr(s.managers).map(m => m.id));
    const usedNames = new Set(arr(s.managers).map(m => m.name));
    for (const f of arr(s.formerManagers).slice(0, 12)) {
      if (!f || typeof f !== 'object') continue;
      const fid = int(f.id, 0);
      const fname = str(f.name, 12);
      if (!fname || usedIds.has(fid) || usedNames.has(fname)) continue;
      usedIds.add(fid); usedNames.add(fname);
      fm.push({
        id: fid, name: fname, emoji: str(f.emoji, 8) || '🧑‍💼',
        lv: mgrLvIds.indexOf(int(f.lv, 1)) >= 0 ? int(f.lv, 1) : 1,
        skill: clamp(num(f.skill, 1), 0.3, 3),
        trait: mgrTraitIds.indexOf(f.trait) >= 0 ? f.trait : 'none',
        wage: posCap(f.wage, 120),
        days: clamp(int(f.days, 0), 0, 9999),
        fromStore: str(f.fromStore, 16) || '已关闭店铺',
        fromBranch: clamp(int(f.fromBranch, 1), 1, 99),
      });
    }
    s.formerManagers = fm;
  }
  /* 候选池：只有「尚未开店且确实存在」的分店槽位才保留候选。
     已开分店的候选池清掉 —— 那些槽位已经有店长了。 */
  const cand0 = obj(s.mgrCand), mgrCand = {};
  for (const k in cand0) {
    const br = int(k, 0);
    if (!(br >= 1 && br <= shopN)) continue;
    if (seenBranch.has(br)) continue;
    const list = arr(cand0[k]).slice(0, 4).map(c => ({
      name: str(c && c.name, 12) || '候选人',
      emoji: str(c && c.emoji, 8) || '🧑‍💼',
      lv: mgrLvIds.indexOf(int(c && c.lv, 1)) >= 0 ? int(c.lv, 1) : 1,
      skill: clamp(num(c && c.skill, 1), 0.3, 3),
      trait: mgrTraitIds.indexOf(c && c.trait) >= 0 ? c.trait : 'none',
      wage: posCap(c && c.wage, 120),
      branch: br,
    }));
    if (list.length) mgrCand[br] = list;
  }
  s.mgrCand = mgrCand;
  /* 员工分店号也要与「是否有店长」对齐吗？不需要 ——
     没有店长的分店也能有员工（玩家手动招的），这是允许的状态。 */

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
    /* V10 单日杯数（成就判定用）—— 老存档没有这个字段，补 0。
       不补的话 `undefined >= 120` 是 false，成就永远不达成（静默失效）。 */
    lastDayCups: posCap(st0.lastDayCups, 0),
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

  /* V10 城市经营痕迹清洗。
     ★ 必须放在 sanitizeVenue **之后** —— citiesVisited 里要补当前城市，
       而当前城市只有在 venue 收敛之后才是可信的 id。
       顺序反了的话，脏 venue + 脏 citiesVisited 会互相污染。 */
  {
    const cv = [];
    for (const id of arr(s.citiesVisited)) {
      const cid = String(id);
      if (cityById(cid) && cv.indexOf(cid) < 0) cv.push(cid);
    }
    const curCity = s.venue.cityId || CITY_DEFAULT;
    if (cv.indexOf(curCity) < 0) cv.push(curCity);
    s.citiesVisited = cv;
    s.stayDays = clamp(int(s.stayDays, 0), 0, 999);
  }
  /* V10：菜单必须与城市对齐。
     场景：玩家在城市 A 解锁了城市菜并上架，然后**导出存档**、
     在另一个城市 A 的存档里读档 —— 菜单里留着A 城专属的菜。
     若不刷新，当天的备货会去买买不到的原料，表现为"菜单里有的菜却做不出来"。
     幂等：refreshCityMenu 只做过滤与补位，跑两次结果相同。 */
  refreshCityMenu(s, s.venue.cityId);

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

/** 读槽位 → 净化后的 state；空槽 / 损坏 / 不可用一律返回 null
 *
 * ★★ V20：主档解析失败时自动尝试备份档。
 *   查到的真问题：存档损坏 → 读档返回 null → 玩家只看到「存档没了」，
 *   但数据其实还在本地（是 JSON 坏了，不是数据没了）。
 *   ★ 真会发生的场景：写入过程中浏览器被杀（切后台/低电量/微信退出），
 *     localStorage 里留下截断的 JSON。
 *   ★ 恢复后把坏主档挪到 `.broken` 而不是删掉 ——
 *     万一玩家还想人工抢救，不该由我们替他决定丢弃。
 *   ★ 恢复成功时设 `s.recoveredFromBackup = true`，
 *     UI 层据此提示「已从备份恢复」——
 *     静默恢复会让玩家困惑（「我的进度怎么退回了一点」）。
 */
function loadGame(slot) {
  if (slot != null) setSlot(slot);
  const k = slotKey(CUR_SLOT);
  const raw = storageGet(k);
  if (raw) {
    try {
      const s = JSON.parse(raw);
      if (s && typeof s === 'object') {
        /* ★ 见下面 V14.4 的说明：版本只决定迁移路径，不作为拒绝条件。 */
        return sanitizeState(s);
      }
    } catch (e) { /* 落到备份恢复 */ }
  }

  /* ★ 主档损坏 → 试备份 */
  const bak = storageGet(k + '_bak');
  if (bak) {
    try {
      const s = JSON.parse(bak);
      if (s && typeof s === 'object') {
        const clean = sanitizeState(s);
        if (clean) {
          /* 把坏主档挪走（保留，不删） */
          try { storeBackend().set(k + '_broken', raw || ''); } catch (e2) { /* 忽略 */ }
          clean.recoveredFromBackup = true;
          /* ★ 立刻把备份写回主档位置：
             否则下一次存档前，主档一直是坏的（虽然 loadGame 能兜住，
             但每次读都走一遍异常路径，浪费且脆）。 */
          storageSet(k, bak);
          return clean;
        }
      }
    } catch (e2) { /* 备份也坏了 */ }
  }
  return null;
}

/* 槽位摘要记忆化：key 是 slotKey(i)，value 是 { raw, val }。
   存档原文没变就不必重新解析 —— 改存档时 raw 一定会变，天然失效。 */
const SLOT_CACHE = {};

/** 槽位摘要（用于选档界面） */
function slotInfo(i) {
  const k = slotKey(i);
  /* ★ V20：主档**存在但损坏**时也要能读备份 ——
     原来写成 storageGet(k) || storageGet(k+'_bak')，
     只在主档**为空**时才用备份；
     而真实的损坏形态是「主档有一段坏 JSON」（非空），
     于是走不到备份分支 → 标题页连存档都不显示。
     ★ 正确做法：解析失败时再试备份。 */
  const raw = storageGet(k);
  /* ★ 缓存命中判断（V20.2 修正）：
     原来的兜底路径**不写缓存** ——
     于是「主档损坏」这个状态下，标题页每帧都要
     重解析一次坏 JSON + 一次备份 JSON。
     实测退化 2.6 倍（0.045 → 0.114 ms/次），
     低端机上每帧 6 次 = 6.86ms —— 还在预算内，但白烧。
     ★ 现在缓存**主档与备份两份**的结果，
       任一原文没变就直接复用。 */
  const hit = SLOT_CACHE[k];
  if (hit && hit.mainRaw === raw) {
    if (hit.val) return hit.val;                 /* 主档正常 */
    if (hit.bakRaw !== undefined) {
      const bakNow = storageGet(k + '_bak');
      if (bakNow === hit.bakRaw) return hit.bakVal;  /* 备份也没变 */
    }
  }

  const main = parseSlotRaw(k, raw);
  const bak = main ? '' : storageGet(k + '_bak');
  const bakVal = main ? null : parseSlotRaw(k, bak);
  SLOT_CACHE[k] = { mainRaw: raw, val: main, bakRaw: bak, bakVal: bakVal };
  return main || bakVal || null;
}

/** 解析一段存档原文 → 槽位摘要；解析失败返回 null（不抛） */
function parseSlotRaw(k, raw) {
  if (!raw) return null;
  /* 小游戏标题页每帧要画三个槽位、hasAnySave() 还要再扫一遍，
     等于每帧六次「JSON.parse + 全量 sanitizeState」—— 整个清洗器被当成了
     渲染循环的一部分。存档内容不变时结果必然相同，按原文缓存即可。
     （storageGet 那一步没法省：不读就不知道内容有没有变。）
     ★ V20：缓存键改成 `k + '|' + raw` 的形式不可行（raw 太长），
       改用「只缓存主档的结果」——
       备份是兜底路径，每次重解析的代价可以接受，
       而混在一起缓存会出现「拿到备份的结果却以主档原文为键」，
       主档稍后修好时反而命中了错误缓存。 */
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
  return val;
}
function hasAnySave() {
  for (let i = 0; i < CFG.SAVE_SLOTS; i++) if (slotInfo(i)) return true;
  return false;
}
function clearSave(slot) {
  const k = slotKey(slot == null ? CUR_SLOT : slot);
  storageRemove(k);
  /* ★★ V20：备份键**必须一起删**。
     加了双写之后，清档只删主档会留下两个后果：
       ① slotInfo / hasAnySave 仍认为该槽有存档 —— 玩家删了却还显示着
       ② 更糟：下次 loadGame 主档读不到会**从备份恢复**，
          玩家「删掉的档」又活过来了。
     ★ 这是加备份时最容易漏的一处 ——
       浏览器 smoke 的「清档后该槽位为空」立刻就抓到了它。 */
  storageRemove(k + '_bak');
  /* `_broken` 是坏档留档，刻意**不删**：
     它只在主档损坏时才写入，留着无害，而删掉就没法人工抢救了。 */
  delete SLOT_CACHE[k];
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
    /* ★ V14.4：这里原来写的是 `raw.v !== 2` —— 同样把版本号当拒绝理由。
       后果：版本一升，玩家从别的设备导入旧存档码会直接被判「格式无法识别」。
       改成只校验**结构**（有没有 day），版本交给 migrateSave 处理。 */
    if (!raw || typeof raw !== 'object' || typeof raw.day !== 'number') {
      return { ok: false, msg: '存档格式无法识别' };
    }
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
  const base = CFG.BASE_SERVICE / (1 + 0.20 * s.up.speed);   /* training 见 TRAINING_COST_CUT */
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
