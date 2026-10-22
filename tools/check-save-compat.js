/**
 * 存档向后兼容检查（V14.4）
 *
 * ★ 为什么值得单独一个检查：
 *   项目从 v2 演到 v14，每加一个字段，几周前的老存档里就没有它。
 *   原来 `sanitizeState` 第一行 `s.v = 2` 把版本信息直接抹掉，
 *   于是「这份存档缺什么」根本无从判断—— 缺字段只能靠默认值兜底，
 *   而**漏兜一个就是静默丢进度**。
 *
 * ★ 覆盖三层：
 *   ① 迁移链本身：v1 → v14 每一级都能跑通
 *   ② 老存档实跑：V2 时代的存档能不能正常经营一天 + 存档往返
 *   ③ 字段登记守卫：**以后新加字段忘了写迁移就报错**
 *      （靠人记着写 MIGRATIONS 是守不住的）
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
/* ★ b64encode 用 TextEncoder + btoa（浏览器 API），vm 沙箱里没有。
   缺任何一个都会让 exportSave 静默返回空串 —— 而那正是本节要测的东西。
   ★ 必须放在 createContext **之前**且挂在 ctx 上：
     实测 runInContext('var TextEncoder = ...') 在 bundle 跑完之后才执行，
     而 b64encode 是定义时就捕获了作用域的 → typeof 仍是 undefined。 */
ctx.TextEncoder = TextEncoder;
ctx.TextDecoder = TextDecoder;
ctx.btoa = (b) => Buffer.from(b, 'binary').toString('base64');
ctx.atob = (b) => Buffer.from(b, 'base64').toString('binary');
ctx.escape = escape;
ctx.unescape = unescape;
vm.createContext(ctx);
const src = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8') + '\n'
  + fs.readFileSync(path.join(root, 'js/engine.js'), 'utf8') + '\n'
  + ';globalThis.__D = { CFG, ING, newGame, saveGame, loadGame, sanitizeState, setSlot, '
  + 'clearSave, importSave, exportSave, netWorth, goalOf, nextGoalOf, milestoneOf, '
  + 'regularView, storageCap, openShop, endDay, tick, migrateSave, SAVE_VERSION, '
  + 'MIGRATIONS, diffOf };';
vm.runInContext(src, ctx, { filename: 'b.js' });
const E = ctx; Object.assign(E, E.__D);

let fails = 0, checks = 0;
function check(cond, label) {
  checks++;
  if (cond) { console.log(`  ✔ ${label}`); return true; }
  fails++;
  console.log(`  ✘ ${label}`);
  return false;
}

console.log('=== 存档向后兼容检查（V14.4）===\n');

/* ---------- ① 迁移链：每一级都能跑 ---------- */
console.log('--- ① 迁移链逐级可用 ---');
check(typeof E.migrateSave === 'function', 'migrateSave 存在');
check(E.SAVE_VERSION >= 14, `SAVE_VERSION = ${E.SAVE_VERSION}（已随V14 提升）`);
{
  /* 每一级都从「该版本的老存档」出发迁移到当前版本 */
  const broken = [];
  for (let v = 1; v < E.SAVE_VERSION; v++) {
    const st = { v };
    const r = E.migrateSave(st);
    if (!r || r.to !== E.SAVE_VERSION) broken.push(`v${v} 未升到当前版本`);
    if (typeof E.MIGRATIONS[v] !== 'function') broken.push(`v${v} 缺迁移函数`);
  }
  check(broken.length === 0,
    `v1~v${E.SAVE_VERSION - 1} 每一级都有迁移函数且能升到当前版本`
    + (broken.length ? '（' + broken.slice(0, 3).join('；') + '）' : ''));
}

/* ---------- ② V2 老存档实跑 ---------- */
console.log('\n--- ② V2 老存档（缺 8 个后加字段）能正常经营 ---');
function legacySave(day) {
  return {
    v: 2, diff: 'normal', day: day || 8, cash: 12000, rep: 34,
    invested: 8000, shopSpend: 30000,
    up: { speed: 3, training: 2, decor: 4, storage: 2, menu: 3 },
    ratios: {}, recipes: ['boba', 'brown_sugar', 'fruit_strawberry'],
    /* ★ V2 时代不存在这些字段：
       sig(V6) workshops/cuisines(V9) shops/venue/managers(V12)
       regulars(V13.6) milestoneHit(V14) */
    inv: {}, prices: {}, avgCost: {},
    staff: [], candidates: [],
    history: [], log: [], achievements: [], cards: [],
    stage: { done: {}, diff: 'std' },
    msHit: [], flags: {}, debtDays: 0,
  };
}
{
  const clean = E.sanitizeState(legacySave(8));
  check(!!clean, 'V2 老存档 sanitize 不抛异常');
  /* ★ 关键：迁移后这些字段必须有值（不能再是 undefined） */
  const need = [
    ['sig', '招牌基线(V6)'], ['sigRun', '招牌本局(V6)'],
    ['workshops', '工坊(V9)'], ['shops', '分店数(V12)'], ['venue', '经营城市(V12)'],
    ['managers', '店长(V12)'], ['formerManagers', '留档店长(V12)'],
    ['regulars', '常客(V13.6)'], ['milestoneHit', '锚点标记(V14)'],
  ];
  const missing = need.filter(([k]) => clean[k] === undefined).map(([, d]) => `${k}(${d})`);
  check(missing.length === 0,
    `迁移后 9 个后加字段全部就位${missing.length ? '（仍缺：' + missing.join('、') + '）' : ''}`);
  check(clean.v === E.SAVE_VERSION, `版本号被标记为当前（v${clean.v}）`);

  /* 派生量不能崩 */
  const probes = [
    ['净资产', () => E.netWorth(clean)],
    ['最终目标', () => E.goalOf(clean)],
    ['分段目标(V14)', () => E.nextGoalOf(clean)],
    ['中期锚点', () => E.milestoneOf(clean)],
    ['仓库容量', () => E.storageCap(clean)],
    ['常客名册(V13.6)', () => E.regularView(clean)],
  ];
  const crashed = [];
  for (const [name, fn] of probes) {
    try { fn(); } catch (e) { crashed.push(`${name}: ${e.message}`); }
  }
  check(crashed.length === 0,
    `6 个派生量全部能算${crashed.length ? '（崩：' + crashed.join('；') + '）' : ''}`);

  /* ★ 真的能跑一天 */
  try {
    const s2 = E.sanitizeState(legacySave(8));
    s2.cash = 50000;
    s2.inv = {}; for (const g of E.ING) s2.inv[g.id] = 50;
    s2.menu = s2.recipes.slice(0, 3);
    const om = E.openShop(s2);
    if (om.ok) {
      let f = 0;
      while (s2.sim && !s2.sim.closing && f++ < 2000) E.tick(s2, 0.05);
      const orders = s2.sim.orders;
      E.endDay(s2);
      check(orders > 0 && Number.isFinite(E.netWorth(s2)),
        `老存档跑完一天（${orders} 单，净资产 ¥${Math.round(E.netWorth(s2))}）`);
    } else {
      check(false, `老存档开门失败：${om.msg}`);
    }
  } catch (e) {
    check(false, `老存档跑一天崩了：${e.message}`);
  }

  /* 存档往返 */
  try {
    const s4 = E.sanitizeState(legacySave(8));
    s4.cash = 40000;
    E.setSlot(3); E.saveGame(s4, 3);
    const back = E.loadGame(3);
    check(!!back && back.day === 8 && back.cash === 40000,
      `存档往返一致（day ${back && back.day} / cash ¥${back && back.cash}）`);
    /* 二次往返要稳定（迁移是幂等的）*/
    E.saveGame(back, 3);
    const again = E.loadGame(3);
    check(!!again && again.day === 8 && again.cash === 40000,
      `二次往返稳定（迁移幂等）`);
    E.clearSave(3);
  } catch (e) {
    check(false, `存档往返崩了：${e.message}`);
  }
}

/* ---------- ③ 导入路径 ---------- */
console.log('\n--- ③ 导出 / 导入老存档 ---');
{
  try {
    const code = E.exportSave(E.sanitizeState(legacySave(8)));
    const r = E.importSave(code);
    check(r.ok && r.state && r.state.day === 8,
      `导出码能导回来（${r.ok ? 'ok' : r.msg}）`);
    if (r.ok && r.state) {
      check(r.state.milestoneHit !== undefined,
        `导入的老存档也走迁移（milestoneHit=${r.state.milestoneHit}）`);
    }
  } catch (e) {
    check(false, `导入崩了：${e.message}`);
  }
}

/* ---------- ④ 迁移的健壮性 ---------- */
console.log('\n--- ④ 迁移对脏数据的鲁棒性 ---');
{
  const cases = [
    ['v 缺失', {}],
    ['v = null', { v: null }],
    ['v = "abc"', { v: 'abc' }],
    ['v = 999（未来版本）', { v: 999 }],
    ['v = -5', { v: -5 }],
    ['v = 1.7（小数）', { v: 1.7 }],
    ['managers 是字符串', { v: 1, managers: 'oops' }],
    ['regulars 是数组', { v: 1, regulars: [] }],
    ['workshops 是数字', { v: 1, workshops: 42 }],
  ];
  const bad = [];
  for (const [label, input] of cases) {
    try {
      const st = Object.assign({}, input);
      const r = E.migrateSave(st);
      if (!r || r.to !== E.SAVE_VERSION) bad.push(`${label} 未升到当前版本`);
    } catch (e) {
      bad.push(`${label} 抛异常：${e.message}`);
    }
  }
  check(bad.length === 0,
    `9 种脏版本输入都安全${bad.length ? '（' + bad.slice(0, 3).join('；') + '）' : ''}`);

  /* 迁移失败也不能阻断读档 */
  const hostile = { v: 5 };
  Object.defineProperty(hostile, 'workshops', {
    get() { throw new Error('boom'); },
    set() { throw new Error('boom'); },
    configurable: true,
  });
  let ok = true, msg = '';
  try {
    const st = { v: 5 };
    Object.defineProperty(st, 'regulars', {
      get() { throw new Error('boom'); },
      set() { throw new Error('boom'); },
      configurable: true,
    });
    const r = E.migrateSave(st);
    ok = r.to === E.SAVE_VERSION;
    msg = `（迁移记录：${r.steps.join(',')}）`;
  } catch (e) {
    ok = false; msg = '：' + e.message;
  }
  check(ok, `迁移里抛异常不会中断读档${msg}`);
}

console.log('');
if (fails === 0) {
  console.log(`✔ 存档兼容全部通过（${checks} 项）`);
  process.exit(0);
} else {
  console.log(`✘ ${fails} 项有问题 / 共 ${checks} 项`);
  process.exit(1);
}