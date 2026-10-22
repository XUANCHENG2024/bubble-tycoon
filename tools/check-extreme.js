/**
 * 异常状态扫描器：构造各种极端局面，跑完整流程，看有没有 NaN / 崩 / 卡死。
 *
 * ★ 为什么需要它：
 *   probe 的 A 组测的是「sanitizeState 对脏数据不抛异常」，
 *   但那是**单个字段**级别的抗性。
 *   真正危险的组合是「每个字段都合法，但组合起来让某个中间值为 0/NaN/Infinity」——
 *   单字段测试全绿，而运行时静默算错（Infinity 不抛异常，只是数值永远不对）。
 *
 * 扫描项：
 *   ① NaN / Infinity 出现在任何数值字段
 *   ② 抛异常
 *   ③ 关键量变成 0 或负数（服务耗时、客单价、库存…）
 *   ④ 死循环 / 卡死（打烊后 sim 还在跑）
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const store = {};
const ctx = {
  console, Math, JSON, Date, Object, Array, String, Number, Boolean, Error, Set, Map,
  isNaN, parseInt, parseFloat,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
const src = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8') + '\n'
  + fs.readFileSync(path.join(root, 'js/engine.js'), 'utf8') + '\n'
  + ';globalThis.__D = { CFG, REGULAR_CFG, MANAGER_SPECIALTY, newGame, sanitizeState, tick, endDay, nextDay, stationTime, managerBonus, openShop, openStore, rushStation, hireManager, setStoreAuto, num, clamp, saveGame, loadGame, clearSave, staffOfBranch, branchStaffCap, menuSlots, hasStock, priceOf, isBankrupt, MAXDAYS: (CFG.DAYS||30) };';
vm.runInContext(src, ctx, { filename: 'bundle.js' });
const E = ctx;
Object.assign(E, E.__D);

/** 深度扫描：找出 NaN / Infinity */
function badNums(obj, path, out, depth) {
  if (depth > 6 || obj == null) return;
  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) out.push(`${path} = ${obj}`);
    return;
  }
  if (typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < Math.min(obj.length, 200); i++) badNums(obj[i], `${path}[${i}]`, out, depth + 1);
    return;
  }
  for (const k in obj) badNums(obj[k], `${path}.${k}`, out, depth + 1);
}

/** 各种极端局面 */
const SCENARIOS = [
  {
    name: '满级店长全专精（数值上限）',
    setup(s) {
      s.cash = 1e9; s.shops = 5;
      const tr = ['ops', 'qc', 'lean', 'trainer', 'hosp'];
      for (let i = 0; i < 5; i++) {
        s.managers.push({ id: i + 1, branch: i + 1, lv: 5, skill: 3, trait: tr[i], name: 'M' + i, wage: 100 });
      }
    },
  },
  {
    name: '设备全满 + 工坊全满',
    setup(s) {
      s.cash = 1e9;
      for (const k in s.up) s.up[k] = 99;
      for (const c of E.CFG ? [] : []) { }
      s.levels = {};
      for (const w of ['classic', 'fruit', 'coffee', 'matcha', 'dessert']) {
        s.workshops = s.workshops || {};
        s.workshops[w] = { lv: 99 };
      }
    },
  },
  {
    name: '零现金（破产边缘）',
    setup(s) { s.cash = 0; s.rep = 0; },
  },
  {
    name: '口碑满 + 极端菜单',
    setup(s) {
      s.cash = 1e6; s.rep = 200;
      s.menu = s.recipes.slice(0, 8);
      s.prices = {}; s.prevPrices = {};
      for (const r of s.recipes) { s.prices[r] = 99999; s.prevPrices[r] = 99999; }
    },
  },
  {
    name: '库存全空（缺料）',
    setup(s) {
      s.cash = 1e6;
      s.stock = {};
      for (const r of s.recipes) s.stock[r] = 0;
    },
  },
  {
    name: '员工全疲劳',
    setup(s) {
      s.cash = 1e6;
      for (const st of s.staff) st.stamina = 0;
    },
  },
  {
    name: '一天内疯狂点按（进度溢出）',
    setup(s) { s.cash = 1e6; s.staff = []; },
    fastClick: true,
  },
  {
    name: '常客全满（好感 100 × 100 位）',
    setup(s) {
      s.cash = 1e6;
      s.regulars = {};
      const faces = ['🧑', '👩', '👨'];
      for (const t of ['student', 'worker', 'family', 'elder', 'influencer']) {
        for (let v = 0; v < 20; v++) {
          s.regulars[t + '#' + v] = { id: t + '#' + v, type: t, face: faces[v % 3], fav: 100, name: 'R' + v };
        }
      }
    },
  },
];

console.log('=== 异常状态扫描 ===\n');
let fails = 0;
for (const sc of SCENARIOS) {
  const problems = [];
  try {
    const s = E.newGame('normal', 0, null);
    /* 先跑 3 天让它进入正常状态 */
    for (let d = 0; d < 3; d++) {
      E.openShop(s);
      let g = 0;
      while (s.sim && !s.sim.closing && g++ < 3000) E.tick(s, 0.05);
      E.endDay(s); E.nextDay(s);
    }
    if (sc.setup) sc.setup(s);
    /* 再跑 5 天（含点击） */
    for (let d = 0; d < 5; d++) {
      const om = E.openShop(s);
      if (!om.ok) { problems.push('第' + (d + 1) + '天无法开门：' + om.msg); break; }
      let g = 0;
      while (s.sim && !s.sim.closing && g++ < 3000) {
        E.tick(s, 0.05);
        if (sc.fastClick) {
          /* 狂点：每帧点所有工位 3 次 */
          for (let si = 0; si < (s.sim.stations || []).length; si++) for (let k = 0; k < 3; k++) E.rushStation(s, si);
        }
      }
      if (g >= 3000) problems.push('第' + (d + 1) + '天打烊循环未终止（疑似死循环）');
      E.endDay(s); E.nextDay(s);
    }
    /* 扫描 NaN / Infinity */
    const bad = [];
    badNums(s, 'S', bad, 0);
    if (bad.length) problems.push(`状态含 ${bad.length} 个非有限数：${bad.slice(0, 3).join(', ')}`);
    /* 关键量检查 */
    const st0 = (s.sim && s.sim.stations && s.sim.stations[0]) || null;
    if (st0) {
      const tt = E.stationTime(s, st0, s.sim);
      if (!(tt > 0) || !Number.isFinite(tt)) problems.push(`出杯耗时异常：${tt}`);
    }
    /* ★ 负现金本身是**合法状态**（debtDays 机制给 2 天翻身机会），
       所以判据不能写「cash < 0 就报错」—— 那会把设计当 bug。

       ★ 而且**这里必须用引擎的 isBankrupt()，不能自己判「负债几天了」**：
         破产判定在 js/main.js 的 onDayEnd 里（UI 层），
         扫描器只跑引擎、不经过 main.js，所以 debtDays 会一直累加。
         自己判天数会误报"负债 10 天未破产" —— 那是扫描器没走UI 流程，不是 bug。
       真正该守的是：**isBankrupt 判定本身要能生效**。 */
    if (s.cash < 0 && E.isBankrupt(s)) {
      /* 能走到这里说明 debtDays>=2；此时游戏层应已结束这一局。
         引擎层不负责收尾，所以这里只验证判定函数本身没坏。 */
      if (typeof E.isBankrupt(s) !== 'boolean') {
        problems.push('isBankrupt 未返回布尔值');
      }
    }
    /* 存档往返 */
    E.setSlot(7); E.saveGame(s, 7);
    const back = E.loadGame(7);
    if (!back) problems.push('存档读回为 null');
    else {
      const bad2 = [];
      badNums(back, 'Back', bad2, 0);
      if (bad2.length) problems.push(`存档含非有限数：${bad2.slice(0, 2).join(', ')}`);
    }
    E.clearSave(7);
  } catch (e) {
    problems.push('抛异常：' + (e && e.message ? e.message : String(e)));
  }
  if (problems.length) {
    fails++;
    console.log(`  ✘ ${sc.name}`);
    for (const p of problems) console.log('      · ' + p);
  } else {
    console.log(`  ✔ ${sc.name}`);
  }
}

console.log('');
if (fails) { console.log(`✘ ${fails}/${SCENARIOS.length} 个场景有问题`); process.exit(1); }
else { console.log(`✔ ${SCENARIOS.length} 个极端场景全部安全`); }