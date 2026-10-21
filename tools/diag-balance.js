/* ============================================================
 *  平衡诊断：逐个关掉新系统，量化各自对达标率的贡献。
 *
 *  用法：node tools/diag-balance.js [局数]   （默认 12，建议 ≥30）
 *
 *  为什么要有这个工具：sim 的脚本 AI 对**现金余额**是离散响应的 ——
 *  它的营销/投资判断写死在 `cash > 2500` / `cash > cost*1.6` 这类阈值上，
 *  多给几百块钱就可能让整条经营路径分叉，收益被放大好几倍。
 *  所以"新增系统让达标率涨了 8pp"这句话**不能**直接采信 ——
 *  要先用本工具区分：这是"多了一笔收入"本身的影响，
 *  还是 AI 的阈值响应造成的假象。
 *
 *  做法是**配对比较**：所有对照组共用同一套伪随机序列（LCG + 固定种子），
 *  再加一组"每日固定补贴"的对照 —— 后者与被测系统完全无关，
 *  它的漂移幅度就是这台测速器的**噪声底**。
 *
 *  只读，不改任何游戏文件。
 * ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');

function run(mutator, runs) {
  const store = {};
  /* 配对比较的关键：所有对照组必须用**完全相同**的随机序列。
     原来的 Math.random() 每次都不一样，12 局采样的噪声就有 ±6pp，
     根本分不清「关卡奖励带来 +6pp」和「随机波动带来 +6pp」。
     这里换成可复现的 LCG，并用 runIndex 作种子 —— 对照组之间只差被测系统本身。 */
  let rngState = 12345;
  const rnd = () => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
  };
  const ctx = {
    console, JSON, Date, Object, Array, String, Number, isNaN, parseInt, parseFloat,
    /* Math.random 换成可复现的 LCG（配对比较的前提） */
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
    + fs.readFileSync(path.join(root, 'js/engine.js'), 'utf8')
    + '\n;globalThis.__D = { CFG, DIFFICULTY, STAGE_DIFFS, SPECIAL_CUSTOMERS, RECIPES, ING };';
  if (mutator) src += '\n' + mutator;
  vm.runInContext(src, ctx, { filename: 'bundle.js' });
  const E = ctx;
  Object.assign(E, E.__D);
  let curSeed = 0;

  function playAI(diff) {
    const s = E.newGame(diff, 0);
    const days = [];
    while (s.day <= E.CFG.DAYS) {
      s.menu = [];
      for (const rid of s.recipes) {
        if (s.menu.length >= E.menuSlots(s)) break;
        s.menu.push(rid); s.ratios[rid] = 1.0;
      }
      for (const r of E.RECIPES) {
        if (s.recipes.includes(r.id)) continue;
        if (E.canResearch(s, r.id).ok && s.cash > E.researchCost(s, r.id) * 2.6) E.doResearch(s, r.id);
      }
      s.marketing = s.cash > 2500 ? Math.min(1600, Math.floor(s.cash * 0.1)) : 0;
      const need = E.trafficOf(s) * 1.25 * 1.6;
      const per = Math.max(1, Math.round(need / Math.max(1, s.menu.length)));
      for (const g of E.ING) {
        let want = 0;
        for (const rid of s.menu) want += (E.recipeById(rid).req[g.id] || 0) * per;
        want = Math.ceil(want - (s.inv[g.id] || 0));
        if (want > 0) E.buyIng(s, g.id, Math.min(want, Math.max(0, Math.floor((s.cash - 200) / s.prices[g.id]))));
      }
      const lost = s.lastReport ? s.lastReport.lost : 0;
      const shortCapacity = lost >= 3;
      let guard = 0;
      while (guard++ < 14) {
        let did = false;
        if (shortCapacity) {
          const sc = E.upgradeCost(s, 'speed');
          if (sc != null && s.cash > sc * 1.6) { E.doUpgrade(s, 'speed'); did = true; }
          else if (s.staff.length < 6 && s.candidates.length && s.cash > s.candidates[0].fee * 1.6) { E.hireStaff(s, 0); did = true; }
          else { const tc = E.upgradeCost(s, 'training'); if (tc != null && s.cash > tc * 1.8) { E.doUpgrade(s, 'training'); did = true; } }
        }
        if (!did && s.cash > 1200) {
          const sc2 = E.shopCost(s);
          if (sc2 != null && s.cash > sc2 * 1.5) { E.openShopBranch(s); did = true; }
        }
        if (!did) for (const id of ['decor', 'menu', 'storage', 'auto']) {
          const c = E.upgradeCost(s, id);
          if (c != null && s.cash > c * 2.2) { E.doUpgrade(s, id); did = true; }
        }
        if (!did) break;
      }
      const r = E.openShop(s);
      if (!r.ok) break;
      let steps = 0;
      while (s.phase === 'open' && steps++ < 5000) {
        E.tick(s, 1 / 30);
        if (s.sim && Math.random() < 2.5 / 30) {
          const busy = s.sim.stations.map((st, i) => (st.order ? i : -1)).filter(i => i >= 0);
          if (busy.length) E.rushStation(s, busy[Math.floor(Math.random() * busy.length)]);
        }
      }
      days.push({ stageCash: s.stats.stageCash || 0, rep: s.report.repAfter, lost: s.report.lost });
      if (E.isBankrupt(s)) break;
      E.nextDay(s);
    }
    return { s, days };
  }

  const out = {};
  for (const diff of ['easy', 'normal', 'hard']) {
    const worths = [], stageTotals = [];
    for (let k = 0; k < runs; k++) {
      curSeed = 1000 + k * 7919;
      rngState = curSeed;
      const { s, days } = playAI(diff);
      worths.push(Math.round(E.netWorth(s)));
      stageTotals.push(days.length ? days[days.length - 1].stageCash : 0);
    }
    const avg = Math.round(worths.reduce((a, b) => a + b, 0) / worths.length);
    out[diff] = { avg, pct: Math.round(avg / E.DIFFICULTY[diff].goal * 100), stageAvg: Math.round(stageTotals.reduce((a, b) => a + b, 0) / stageTotals.length) };
  }
  return out;
}

const RUNS = Number(process.argv[2] || 12);
/* 每日固定补贴：与关卡机制**完全无关**，只在 endDay 末尾无条件加钱。
   用来回答一个关键问题：新系统带来的达标率变化，究竟是
     ① 「多了一笔收入」本身的影响，还是
     ② sim 的脚本 AI 对现金余额的**离散阈值响应**
       （它的营销/投资判断写死在 `cash > 2500` / `cash > cost*1.6` 这类阈值上，
        多几百块钱就可能整条路径分叉，收益被放大好几倍）。
   若两者漂移幅度接近 → 说明 ② 是主因，新系统的收入设计本身是安全的。 */
const FIXED_SUB = `
  const _origEndDay = endDay;
  endDay = function (s) {
    const r = _origEndDay(s);
    if (r) s.cash += 14;
    return r;
  };
`;
const CASES = [
  ['基线（新系统全关）', 'STAGE_DIFFS.forEach(d=>{d.cashMul=0;}); SPECIAL_CUSTOMERS.length=0;'],
  ['仅每日固定 +14 元', 'STAGE_DIFFS.forEach(d=>{d.cashMul=0;}); SPECIAL_CUSTOMERS.length=0;' + FIXED_SUB],
  ['仅关卡奖励', 'SPECIAL_CUSTOMERS.length=0;'],
  ['仅特殊顾客', 'STAGE_DIFFS.forEach(d=>{d.cashMul=0;});'],
  ['全开（当前）', null],
];
for (const [name, mut] of CASES) {
  const r = run(mut, RUNS);
  console.log(`${name.padEnd(22)} easy ${String(r.easy.pct).padStart(4)}%  normal ${String(r.normal.pct).padStart(4)}%  hard ${String(r.hard.pct).padStart(4)}%   (关卡奖金 ${r.normal.stageAvg})`);
}
