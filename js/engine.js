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
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---------------- 基础工具 ---------------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + RNG.next() * (b - a);
const rndInt = (a, b) => Math.floor(rnd(a, b + 1));
const pick = arr => arr[Math.floor(RNG.next() * arr.length)];
const money = n => '¥' + Math.round(n).toLocaleString('en-US');

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

/** 某配方按当前库存均价计算的单杯成本 */
function costOf(s, rid) {
  const r = recipeById(rid);
  let c = CFG.PACK_COST;
  for (const k in r.req) c += (r.req[k] || 0) * (s.avgCost[k] || ingById(k).base);
  return c;
}
function priceOf(s, rid) {
  return Math.max(1, Math.round(recipeById(rid).price * (s.ratios[rid] || 1)));
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
  t *= 1 + 0.02 * s.bpBonus + 0.01 * s.up.auto;
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
  return Math.max(CFG.MIN_SERVICE, t);
}

/* ---------------- 新游戏 ---------------- */
function newGame(diffKey, bpBonus) {
  const d = DIFFICULTY[diffKey] || DIFFICULTY.normal;
  const s = {
    v: 2, diff: d.key, day: 1, cash: d.cash, rep: 26,
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
    debtDays: 0, lastReport: null,
    bpBonus: bpBonus || 0,
    stats: { totalCups: 0, totalRevenue: 0, totalProfit: 0, bestDayProfit: 0, totalLost: 0, totalServed: 0, clicks: 0, days: 0 },
    flags: {}, ach: {}, log: [],
    tut: { active: false, step: 0, done: false },
    history: [], endless: false, milestone: 0, daily: false,
  };
  for (const g of ING) { s.prices[g.id] = g.base; s.prevPrices[g.id] = g.base; s.avgCost[g.id] = g.base; }
  rollWeather(s); rollTrend(s); rollNews(s);
  refreshCandidates(s, true);
  initRival(s);
  pushLog(s, '🎉 你的第一家奶茶店开张了！');
  pushLog(s, `🏙️ 隔壁开了家「${s.rival.name}」，生意还不错…`);
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
  return share * (s.rival.aggro || 1);
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
function hasStock(s, rid, cups) {
  const r = recipeById(rid);
  const n = cups || 1;
  for (const k in r.req) if ((s.inv[k] || 0) < r.req[k] * n) return false;
  return true;
}
function consumeStock(s, rid, worker) {
  const r = recipeById(rid);
  /* 配方缺失时别把营业流程炸掉：按只算包装费处理 */
  if (!r || !r.req) return CFG.PACK_COST;
  /* 「省料大师」按原料逐项打折：需求 1 时改为概率少耗，避免出现 Math.max(1,…) 抵消折扣 */
  const thrift = worker && worker.trait === 'thrift';
  let cost = CFG.PACK_COST;
  for (const k in r.req) {
    let need = r.req[k];
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
  s.menu.push(rid);
  if (s.ratios[rid] == null) s.ratios[rid] = 1.0;
  return '上架';
}
function setRatio(s, rid, r) { s.ratios[rid] = clamp(num(r, 1), 0.5, 2.0); }

/* ---------------- 研发 ---------------- */
function researchCost(s, rid) {
  const r = recipeById(rid);
  return Math.round((r.research ? r.research.cash : 300) * diffOf(s).costMult);
}
function canResearch(s, rid) {
  const r = recipeById(rid);
  if (!r || s.recipes.includes(rid) || !r.research) return { ok: false, msg: '无法研发' };
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
  pushLog(s, `🧪 研发成功：${r.emoji} ${r.name}`);
  return { ok: true, recipe: r };
}

/* ---------------- 升级 / 分店 ---------------- */
function upgradeCost(s, id) {
  const u = upgradeById(id);
  const lv = s.up[id];
  if (lv >= u.max) return null;
  return Math.round(u.base * Math.pow(u.mult, lv) * diffOf(s).costMult);
}
function doUpgrade(s, id) {
  const c = upgradeCost(s, id);
  if (c == null) return { ok: false, msg: '已满级' };
  if (s.cash < c) return { ok: false, msg: '现金不足' };
  s.cash -= c; s.invested += c; s.up[id]++;
  const u = upgradeById(id);
  pushLog(s, `⬆️ ${u.emoji} ${u.name} 升至 Lv.${s.up[id]}`);
  return { ok: true, cost: c };
}
function shopCost(s) {
  const i = s.shops - 1;
  if (i >= SHOP_COSTS.length) return null;
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
  if (s.cash < c.fee) return { ok: false, msg: '现金不足' };
  s.cash -= c.fee; s.invested += c.fee;
  const st = { id: s.nextStaffId++, name: c.name, emoji: c.emoji, skill: c.skill, trait: c.trait, wage: c.wage, stamina: 100 };
  s.staff.push(st);
  s.candidates.splice(idx, 1);
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
  if (s.menu.length === 0) return { ok: false, msg: '至少要上架一款饮品' };
  if (s.cash < s.marketing) s.marketing = Math.max(0, Math.floor(s.cash));
  s.dayMarketing = s.marketing;
  s.cash -= s.marketing;
  const traffic = num(trafficOf(s), 3);
  if (!(traffic > 0)) return { ok: false, msg: '今日客流数据异常，无法开门' };
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
    typeServed: {}, typeLost: {},
    repGain: 0, trendCups: 0, clicks: 0, combo: 0, comboBest: 0, lastClick: 0, lastClickWall: 0,
    rushUntil: -99, rushCd: 0, trafficMul: s.eventTrafficMul || 1,
    floaters: [],
  };
  s.marketing = 0;
  s.eventTrafficMul = 1;
  return { ok: true };
}

function spawnCustomer(s) {
  const sim = s.sim;
  if (!s.menu.length) return;
  const type = pickCustomerType(s);

  const r = weightedPick(s.menu, rid => {
    const rec = recipeById(rid);
    let p = rec.pop;
    if (rec.tags.includes(s.trend)) p *= 1.55;
    if (s.weather.boom && rec.tags.includes(s.weather.boom)) p *= 1.25;
    if (s.weather.bust && rec.tags.includes(s.weather.bust)) p *= 0.78;
    for (const tag of rec.tags) {
      if (type.prefer.includes(tag)) p *= 1.75;
      if (type.avoid && type.avoid.includes(tag)) p *= 0.5;
    }
    if (type.popBias) p *= Math.pow(Math.max(0.4, rec.pop / 100), 1.2) * type.popBias;
    return p;
  });

  sim.spawned++;
  /* 等位座满了 → 直接走人 */
  if (sim.queue.length >= queueCap(s)) {
    sim.lost++; sim.repGain += CFG.LOST_REP;
    sim.typeLost[type.id] = (sim.typeLost[type.id] || 0) + 1;
    return;
  }
  /* 价格接受度：客群容忍度不同，定价过高会被当场劝退 */
  const eff = (s.ratios[r] || 1) / type.priceTol;
  const accept = clamp(1.35 - 0.35 * eff, 0.3, 1.5);
  if (RNG.next() > accept) {
    sim.lost++; sim.priceLost++;
    sim.repGain += CFG.LOST_REP * 0.6;
    sim.typeLost[type.id] = (sim.typeLost[type.id] || 0) + 1;
    sim.floaters.push({ text: '太贵了…', kind: 'bad' });
    return;
  }

  sim.queue.push({
    id: 'c' + sim.spawned + '_' + RNG.next().toString(36).slice(2, 6),
    face: type.emoji, rid: r, type: type.id,
    cups: rndInt(type.cups[0], type.cups[1]),
    wait: 0,
    patience: patienceOf(s) * type.patienceMul * rnd(0.85, 1.2),
  });
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
      sim.floaters.push({ text: '缺料!', kind: 'bad' });
      return false;
    }
  }
  const n = c.cups || 1;
  for (let i = 0; i < n; i++) sim.cogs += consumeStock(s, c.rid, st.worker);
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
  const income = o.price * cups;

  s.cash += income;
  sim.revenue += income;
  sim.orders++;
  sim.cups += cups;
  sim.repGain += CFG.SERVE_REP * (type ? type.repMul : 1) * cups;
  if (trendHit) sim.trendCups += cups;
  s.stats.totalCups += cups;
  s.stats.totalRevenue += income;
  sim.typeServed[o.type] = (sim.typeServed[o.type] || 0) + cups;
  st.order = null;
  sim.floaters.push({ text: '+' + money(income), kind: 'good' });
  if (trendHit && sim.trendCups >= 20) s.flags.trendMaster = true;
  if (cups >= 4) s.flags.bigOrder = true;
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
  const bonus = 1 + Math.min(1.0, sim.combo * 0.05);
  st.order.progress += CFG.RUSH_BOOST * bonus;
  sim.clicks++;
  s.stats.clicks++;
  const t = st.order.price * CFG.RUSH_TIP * bonus;
  s.cash += t; sim.revenue += t; sim.tips += t;
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
    sim.arrivalAcc += sim.rate * curve * dt;
    while (sim.arrivalAcc >= 1 && sim.spawned < sim.traffic) {
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
      sim.floaters.push({ text: '走了…', kind: 'bad' });
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
    }
    sim.queue = [];
    endDay(s);
  }
}

/* ---------------- 结算 ---------------- */
function endDay(s) {
  const sim = s.sim;
  const d = diffOf(s);
  const wages = s.staff.reduce((a, b) => a + b.wage, 0);
  let rentRaw = (CFG.RENT_PER_SHOP * s.shops + CFG.SHOP_UPKEEP * (s.shops - 1)) * d.rentMult;
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
  repDelta += sim.repGain * 0.25;
  const before = s.rep;
  s.rep = clamp(s.rep + repDelta, 0, 100);

  for (const st of s.staff) {
    let cost = 28;
    if (st.trait === 'iron') cost *= 0.65;
    st.stamina = clamp(st.stamina - cost, 0, 100);
  }

  s.stats.totalProfit += net;
  s.stats.bestDayProfit = Math.max(s.stats.bestDayProfit, net);
  s.stats.totalLost += sim.lost;
  s.stats.totalServed += (sim.orders || 0);
  s.stats.days++;
  if ((sim.cups || 0) >= 12 && sim.lost === 0) s.flags.perfectDay = true;

  const worth = netWorth(s);
  s.report = {
    day: s.day, served: sim.cups || 0, orders: sim.orders || 0, lost: sim.lost,
    priceLost: sim.priceLost || 0, stockout: sim.stockout,
    revenue: sim.revenue, cogs: sim.cogs, wages, rent,
    marketing: s.dayMarketing || 0, net,
    sat, repBefore: before, repAfter: s.rep, repDelta: s.rep - before,
    trendCups: sim.trendCups, clicks: sim.clicks, comboBest: sim.comboBest,
    tips: sim.tips, traffic: sim.traffic,
    typeServed: Object.assign({}, sim.typeServed), typeLost: Object.assign({}, sim.typeLost),
    rivalShare: rivalShare(s), worth,
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

  updateRival(s);
  s.newAchList = checkAchievements(s);

  const goal = goalOf(s);
  if (worth >= goal) {
    s.flags.goalHit = true;
    if (s.endless) { s.milestone = (s.milestone || 0) + 1; s.endlessLevelUp = true; }
  }

  if (s.cash < 0) s.debtDays++; else s.debtDays = 0;
}

/** 无尽模式：30 天后继续经营 */
function startEndless(s) {
  s.endless = true;
  s.milestone = Math.max(1, s.milestone || 0);
  pushLog(s, '♾️ 进入无尽模式：目标将持续升级！');
  return goalOf(s);
}

/** 结算后推进到下一天 */
function nextDay(s) {
  s.endlessLevelUp = false;
  s.day++;
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
  if (RNG.next() < 0.42 && !s.pendingEvent) {
    s.pendingEvent = pick(EVENTS.filter(e => !s.doneEvents || !s.doneEvents.includes(e.id))) || null;
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

/* ---------------- 转生 ---------------- */
function prestigeGain(s) {
  const nw = Math.max(0, netWorth(s));
  return Math.max(1, Math.floor(Math.sqrt(nw / 220)));
}

/* ---------------- 存档（3 槽位 + 导入导出 + 降级提示） ---------------- */
let CUR_SLOT = 0;
let STORAGE_OK = true;          // 隐私模式 / 配额满时为 false，供 UI 提示
let STORAGE_ERR = '';

function slotKey(i) { return CFG.SAVE_PREFIX + i; }
function getSlot() { return CUR_SLOT; }
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
function int(v, dflt) { return Math.round(num(v, dflt)); }
function pos(v, dflt) { return Math.max(0, num(v, dflt)); }

function sanitizeState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;

  s.v = 2;
  s.diff = DIFFICULTY[s.diff] ? s.diff : 'normal';
  s.day = Math.max(1, int(s.day, 1));
  s.cash = num(s.cash, 0);
  s.rep = clamp(num(s.rep, 26), 0, 100);
  s.shops = Math.max(1, int(s.shops, 1));
  s.debtDays = pos(s.debtDays, 0);
  s.marketing = pos(s.marketing, 0);
  s.dayMarketing = pos(s.dayMarketing, 0);
  s.invested = pos(s.invested, 0);
  s.shopSpend = pos(s.shopSpend, 0);
  s.bpBonus = pos(s.bpBonus, 0);
  s.eventTrafficMul = num(s.eventTrafficMul, 1);
  s.endless = !!s.endless;
  s.daily = !!s.daily;
  s.milestone = pos(s.milestone, 0);
  s.nextStaffId = Math.max(1, int(s.nextStaffId, 1));
  s.trendKnown = !!s.trendKnown;

  /* 原料：只认已知 id，负数/非法值归零 */
  const inv = {};
  for (const g of ING) inv[g.id] = pos(obj(s.inv)[g.id], 0);
  s.inv = inv;
  const prices = {}, prevPrices = {}, avgCost = {};
  for (const g of ING) {
    prices[g.id] = pos(obj(s.prices)[g.id], g.base);
    prevPrices[g.id] = pos(obj(s.prevPrices)[g.id], g.base);
    avgCost[g.id] = pos(obj(s.avgCost)[g.id], g.base);
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

  /* 升级等级 0..8 */
  const up = {};
  for (const k of ['speed', 'decor', 'menu', 'storage', 'training', 'auto']) {
    up[k] = clamp(int(obj(s.up)[k], 0), 0, 8);
  }
  s.up = up;

  /* 员工 / 候选人 */
  const traitIds = TRAITS.map(t => t.id);
  s.staff = arr(s.staff).slice(0, 12).map((st, i) => ({
    id: int(st && st.id, i + 1),
    name: str(st && st.name, 12) || '员工',
    emoji: str(st && st.emoji, 8) || '🧑',
    skill: clamp(num(st && st.skill, 1), 0.2, 5),
    trait: traitIds.indexOf(st && st.trait) >= 0 ? st.trait : null,
    wage: pos(st && st.wage, 60),
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
  s.rival.cd = obj(s.rival.cd);

  /* 日志：限条数 + 单条限长，避免超长 payload 与内存膨胀 */
  s.log = arr(s.log).slice(-60).map(l => str(l, 120));

  /* 统计 / 历史 */
  const st0 = obj(s.stats);
  s.stats = {
    totalCups: pos(st0.totalCups, 0), totalRevenue: pos(st0.totalRevenue, 0),
    totalProfit: num(st0.totalProfit, 0), bestDayProfit: num(st0.bestDayProfit, 0),
    totalLost: pos(st0.totalLost, 0), totalServed: pos(st0.totalServed, 0),
    clicks: pos(st0.clicks, 0), days: pos(st0.days, 0),
  };
  s.history = arr(s.history).slice(-400).map(h => ({
    day: int(h && h.day, 0), revenue: num(h && h.revenue, 0), net: num(h && h.net, 0),
    worth: num(h && h.worth, 0), rep: num(h && h.rep, 0),
    cups: pos(h && h.cups, 0), orders: pos(h && h.orders, 0), lost: pos(h && h.lost, 0),
  }));

  s.ach = obj(s.ach);
  s.flags = obj(s.flags);
  s.doneEvents = arr(s.doneEvents).map(e => str(e, 40));

  /* 引导状态：读档一律不自动续播，避免指向不存在的元素 */
  s.tut = Object.assign({ active: false, step: 0, done: false }, obj(s.tut));
  s.tut.active = false;

  /* 枚举白名单 */
  s.weather = weatherById(s.weather && s.weather.id) || WEATHERS[1];
  s.trend = TAGS[s.trend] ? s.trend : 'milky';
  s.nextTrend = TAGS[s.nextTrend] ? s.nextTrend : 'fruity';
  s.pendingEvent = (s.pendingEvent && typeof s.pendingEvent.id === 'string')
    ? (eventById(s.pendingEvent.id) || null) : null;
  s.news = (s.news && typeof s.news.text === 'string')
    ? { id: str(s.news.id, 24), text: str(s.news.text, 80), fx: obj(s.news.fx) } : null;
  s.newsFx = (s.newsFx && typeof s.newsFx === 'object') ? s.newsFx : null;

  /* 运行时字段 */
  s.sim = null;
  /* 营业中途的存档无法恢复现场，一律退回准备阶段 */
  s.phase = (s.phase === 'report' || s.phase === 'over') ? s.phase : 'prep';
  s.report = (s.report && typeof s.report === 'object') ? s.report : null;
  s.lastReport = (s.lastReport && typeof s.lastReport === 'object') ? s.lastReport : null;
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

/** 槽位摘要（用于选档界面） */
function slotInfo(i) {
  const raw = storageGet(slotKey(i));
  if (!raw) return null;
  try {
    const s = sanitizeState(JSON.parse(raw));
    if (!s) return null;
    return {
      day: s.day, diff: s.diff, endless: !!s.endless,
      worth: Math.round(netWorth(s)), rep: Math.round(s.rep),
      shops: s.shops, time: s.savedAt || s.lastTime || 0,
    };
  } catch (e) { return null; }
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
  return { best: {}, bp: 0, runs: 0, ach: {}, maxBpEarned: 0, sound: true, tutDone: false };
}
function loadMeta() {
  const raw = storageGet(CFG.META_KEY);
  if (!raw) return newMeta();
  try {
    const m = JSON.parse(raw);
    /* JSON.parse('null') 是 null、脏数据也可能是数组，这里一并挡掉 */
    if (!m || typeof m !== 'object' || Array.isArray(m)) return newMeta();
    return Object.assign(newMeta(), m);
  } catch (e) { return newMeta(); }
}
function saveMeta(m) { storageSet(CFG.META_KEY, JSON.stringify(m)); }

/* ============================================================
 *  智能建议系统（纯逻辑，给新手与卡关玩家指路）
 * ============================================================ */

/** 按当前库存，今日上架的菜单最多能做多少杯（客流均分估算） */
function maxCupsFromStock(s) {
  if (!s.menu.length) return 0;
  const per = 1 / s.menu.length;
  const need = {};
  for (const rid of s.menu) {
    const r = recipeById(rid);
    for (const k in r.req) need[k] = (need[k] || 0) + r.req[k] * per;
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
function dailyClickOrderCapacity(s) { return Math.round(dailyOrderCapacity(s) * 1.35 + 8); }

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
      text: `产能约 <b>${capOrders}</b> 单 < 预计客流 <b>${predicted}</b> 人（点击加速可到约 ${dailyClickOrderCapacity(s)} 单），忙不过来会流失口碑。去「⬆️ 升级」升封口机，或「👥 员工」招人 +1 出杯位。`,
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
        text: `对手「<b>${s.rival.name}</b>」抢走了约 <b>${Math.round(share * 100)}%</b> 的客流（它口碑 ${Math.round(s.rival.rep)} vs 你 ${Math.round(s.rep)}），去「🏙️ 商圈」反制。`,
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
  const last = s.lastTime || 0;
  if (!last) return null;
  const mins = Math.min(CFG.OFFLINE_CAP_MIN, Math.max(0, (Date.now() - last) / 60000));
  if (mins < 1) return null;
  const rate = offlinePerMin(s);
  if (rate <= 0) return null;
  const gain = Math.round(rate * mins * (1 + (s.bpBonus || 0) * 0.02));
  s.cash += gain;
  s.lastTime = Date.now();
  return { mins: Math.floor(mins), gain };
}
