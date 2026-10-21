/* 临时诊断：工坊投入 vs 设备投入 —— 看工坊是否挤占了经营投资。
   只读，不改游戏文件。 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const store = {};
const ctx = {
  console, JSON, Date, Object, Array, String, Number, Boolean, Error, Set, Map,
  isNaN, parseInt, parseFloat,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(root, 'js/data.js'), 'utf8') + '\n'
  + fs.readFileSync(path.join(root, 'js/engine.js'), 'utf8') + '\n'
  + fs.readFileSync(path.join(root, 'tools/ai-shared.js'), 'utf8') + '\n'
  + ';globalThis.__D={CFG,DIFFICULTY,RECIPES,CRAFT_WORKSHOPS,ING};', ctx);
const E = ctx;
Object.assign(E, E.__D);
const playSharedAI = vm.runInContext('playSharedAI', ctx);

const DIFF = process.env.DIFF || 'normal';
const N = Number(process.argv[2] || 12);
/* 固定种子的 LCG：两组对照必须走**完全相同**的随机序列，
   否则配对差值混着采样噪声，结论不可信。
   ★ Math.random 也要换 —— 引擎内部（天气 / 事件 / 抽卡）也用它。
     漏掉这一处时，两组的随机源不同，测出的差值完全是假的。 */
let rngState = 12345;
const rnd = () => { rngState = (rngState * 1664525 + 1013904223) >>> 0; return rngState / 4294967296; };

/* 「V9 全关」= 收益归零 + 菜单主打加成 0 + **AI 完全不开线**（AI_NO_WS）。
   ⚠️ 两个曾经的错，都会让差值失真：
     ① 只把造价设 0 → AI 会「免费」开 5 条线，基线不是"没有这个系统"的状态；
     ② 让 AI 照常开线 → 那是"有系统但玩家用不好"，不是"没有系统"。
   正确做法：基线组让 AI 不开线（AI_NO_WS），造价保持不变
   （这样 AI 的决策逻辑在两组里完全一致，只差"系统给不给收益"）。 */
/* ★ 关闭清单在共享模块 tools/v9-off.js 里，本文件不另写一份 ——
   漏关一层基线就不干净（实测漏关 costCut 时，净效应被凭空抹掉十几个 pp），
   而两处各写一份清单必然漂移（实测同一份代码在两个工具里差 13pp）。
   防漂移的第二道防线是 v9OffLeakCheck()：漏关会当场退出码 1。 */

const results = {};
/* ★ 关闭清单来自**共享模块** tools/v9-off.js，不在本文件里另写一份 ——
   两处各写一份时必然漂移，实测因此让同一份代码在两个工具里
   分别报出「+1.5pp」与「−7pp」，差 13pp。
   v9OffPatch 只是拼字符串，不需要引擎，所以用最小引导上下文即可。 */
function ctx0() {
  const c = {
    console, JSON, Date, Object, Array, String, Number, Boolean, Error, Set, Map,
    isNaN, parseInt, parseFloat,
  };
  c.globalThis = c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root, 'tools/v9-off.js'), 'utf8'), c);
  return c;
}
const V9_OFF = vm.runInContext('v9OffPatch(true)', ctx0());
console.log('难度 ' + DIFF + ' · 每档 ' + N + ' 局（固定种子配对）：');
for (const [label, mut] of [['V9 全关（AI 不开线）', V9_OFF], ['V9 全开', null]]) {
  /* 每组都要**全新的 vm context**：mutator 是改数据表常量的，
     上一组改过的会污染下一组。 */
  const store = {};
  const ctx = {
    console, JSON, Date, Object, Array, String, Number, Boolean, Error, Set, Map,
    isNaN, parseInt, parseFloat,
    Math: Object.assign(Object.create(Math), { random: rnd }),
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  let src = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8') + '\n'
    + fs.readFileSync(path.join(root, 'js/engine.js'), 'utf8');
  const sharedSrc = fs.readFileSync(path.join(root, 'tools/ai-shared.js'), 'utf8')
    + '\n' + fs.readFileSync(path.join(root, 'tools/v9-off.js'), 'utf8');
  if (mut) src += '\n' + mut;
  vm.runInContext(src + '\n' + sharedSrc, ctx, { filename: 'bundle.js' });
  const E = ctx;
  Object.assign(E, vm.runInContext('({CFG,DIFFICULTY,RECIPES,CRAFT_WORKSHOPS,ING})', ctx));
  const playSharedAI = vm.runInContext('playSharedAI', ctx);

  /* 基线自检（共享模块）：收益全关后不该有任何一层还留效果。
     漏关一层的现象很隐蔽 —— 净效应被凭空抹掉十几个 pp，
     数字却看起来依然"有结论"，于是错误结论被采信。 */
  if (mut) {
    const leak = vm.runInContext('v9OffLeakCheck()', ctx);
    if (leak.length) {
      console.error('❌ 基线不干净：以下收益层没被关掉 → ' + leak.join(', '));
      console.error('   净效应不可信，先修 tools/v9-off.js 的关闭清单');
      process.exit(1);
    }
  }

  /* 逐款追踪：解锁数下降时，必须知道**少的是哪几款**（按 tier × cuisine 归类），
     否则只能猜。这里记录每款配方被解锁的局数，两组一减就得到差集。 */
  const hit = {};
  let sum = 0, rec = 0, menu = 0, busted = 0, wsN = 0, upAll = 0, shopN = 0;
  for (let k = 0; k < N; k++) {
    rngState = 1000 + k * 7919;   /* 每局重置到固定种子：两组用同一序列 */
    const r = playSharedAI(E, DIFF, 0, null, { rng: rnd, clickRate: 2.5 });
    sum += E.netWorth(r.s); rec += r.s.recipes.length; menu += r.s.menu.length;
    if (r.s.debtDays >= 2) busted++;
    for (const rid of r.s.recipes) hit[rid] = (hit[rid] || 0) + 1;
    let wn = 0; for (const kk in r.s.workshops) if (r.s.workshops[kk] > 0) wn++;
    wsN += wn;
    upAll += (r.s.up.speed || 0) + (r.s.up.menu || 0) + (r.s.up.training || 0) + (r.s.up.decor || 0) + (r.s.up.storage || 0);
    shopN += (r.s.shops || 1);
  }
  const goal = E.DIFFICULTY[DIFF].goal;
  const avg = Math.round(sum / N);
  console.log(label.padEnd(20)
    + ' 净资产 ¥' + String(avg).padStart(6) + ' (' + (avg / goal * 100).toFixed(0) + '% 目标)'
    + ' | 解锁 ' + (rec / N).toFixed(1) + ' 款'
    + ' | 菜单 ' + (menu / N).toFixed(1) + ' 款'
    + ' | 产线 ' + (wsN / N).toFixed(1) + ' 条'
    + ' | 设备 ' + (upAll / N).toFixed(1) + ' 级'
    + ' | 分店 ' + (shopN / N).toFixed(1)
    + ' | 破产 ' + busted + '/' + N);
  results[label] = { hit, avg, rec: rec / N };
}

/* --- 逐款差集：全开组比全关组少解锁的那些 --- */
const off = results['V9 全关（AI 不开线）'], on = results['V9 全开'];
const rows = [];
for (const r of E.RECIPES) {
  const a = off.hit[r.id] || 0, b = on.hit[r.id] || 0;
  rows.push({ r, a, b, d: b - a });
}
rows.sort((x, y) => x.d - y.d || y.a - x.a);
const lost = rows.filter(x => x.d < 0);
const gained = rows.filter(x => x.d > 0);
console.log('\n【解锁局数变化】' + DIFF + ' （共 ' + N + ' 局，负=全开组更少解锁）');
for (const x of lost) {
  console.log('  ' + String(x.d).padStart(3) + '  ' + String(x.a).padStart(3) + '→' + String(x.b).padStart(3)
    + '  T' + x.r.tier + ' ' + pad(x.r.cuisine, 7) + ' ¥' + String(x.r.research ? x.r.research.cash : '-').padStart(5)
    + '  ' + x.r.emoji + ' ' + x.r.name);
}
if (gained.length) {
  console.log('  --- 反而变多的 ---');
  for (const x of gained) console.log('  +' + String(x.d).padStart(3) + '  T' + x.r.tier + ' ' + pad(x.r.cuisine, 7) + ' ' + x.r.name);
}
if (!lost.length && !gained.length) console.log('  （无差异）');
function pad(v, n) { v = String(v || '-'); while (v.length < n) v += ' '; return v; }
