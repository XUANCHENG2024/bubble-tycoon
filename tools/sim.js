/* 离线平衡测试：用脚本 AI 跑完整 30 天，输出每日报表 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const store = {};
const ctx = {
  console, Math, JSON, Date, Object, Array, String, Number, isNaN, parseInt, parseFloat,
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
  + ';globalThis.__D = { CFG, ING, RECIPES, UPGRADES, TRAITS, EVENTS, ACHIEVEMENTS, DIFFICULTY, TAGS, SHOP_COSTS };';
vm.runInContext(src, ctx, { filename: 'bundle.js' });

const E = ctx;
Object.assign(E, E.__D);

function playAI(diff, seedLabel) {
  const s = E.newGame(diff, 0);
  const log = [];
  while (s.day <= E.CFG.DAYS) {
    /* --- 菜单 & 定价（先定菜单，才知道要进什么货） --- */
    s.menu = [];
    for (const rid of s.recipes) {
      if (s.menu.length >= E.menuSlots(s)) break;
      s.menu.push(rid); s.ratios[rid] = 1.0;
    }
    /* --- 研发：现金充裕时解锁更高价配方 --- */
    for (const r of E.RECIPES) {
      if (s.recipes.includes(r.id)) continue;
      if (E.canResearch(s, r.id).ok && s.cash > E.researchCost(s, r.id) * 2.6) E.doResearch(s, r.id);
    }
    /* --- 营销 --- */
    s.marketing = s.cash > 2500 ? Math.min(1600, Math.floor(s.cash * 0.1)) : 0;
    /* --- 采购：按预测客流备货（多杯订单按 1.6 倍折算），留 200 备用金 --- */
    const need = E.trafficOf(s) * 1.25 * 1.6;
    const per = Math.max(1, Math.round(need / Math.max(1, s.menu.length)));
    for (const g of E.ING) {
      let want = 0;
      for (const rid of s.menu) want += (E.recipeById(rid).req[g.id] || 0) * per;
      want = Math.ceil(want - (s.inv[g.id] || 0));
      if (want > 0) E.buyIng(s, g.id, Math.min(want, Math.max(0, Math.floor((s.cash - 200) / s.prices[g.id]))));
    }
    /* --- 投资：产能不足先补产能，富余再扩张 --- */
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

    /* --- 营业 --- */
    const r = E.openShop(s);
    if (!r.ok) { log.push(`Day ${s.day} 无法开门: ${r.msg}`); break; }
    /* 模拟玩家手速：约 2.5 次点击/秒（真实玩家可到 5+） */
    let steps = 0;
    while (s.phase === 'open' && steps++ < 5000) {
      E.tick(s, 1 / 30);
      if (s.sim && Math.random() < 2.5 / 30) {
        const busy = s.sim.stations.map((st, i) => (st.order ? i : -1)).filter(i => i >= 0);
        if (busy.length) E.rushStation(s, busy[Math.floor(Math.random() * busy.length)]);
      }
    }
    const rep = s.report;
    log.push({
      day: rep.day, served: rep.served, lost: rep.lost, traffic: rep.traffic,
      rev: Math.round(rep.revenue), net: Math.round(rep.net), rep: Math.round(rep.repAfter),
      cash: Math.round(s.cash), worth: Math.round(E.netWorth(s)), staff: s.staff.length, shops: s.shops,
    });
    if (E.isBankrupt(s)) { log.push('💸 破产于 Day ' + s.day); break; }
    E.nextDay(s);
  }
  return { log, s };
}

const RUNS = Number(process.argv[2] || 3);
const verbose = process.argv.includes('-v');
for (const d of ['easy', 'normal', 'hard']) {
  const scores = [], failedRuns = [];
  let last = null;
  for (let k = 0; k < RUNS; k++) {
    const { log, s } = playAI(d);
    scores.push(Math.round(E.netWorth(s)));
    if (log.some(x => typeof x === 'string')) failedRuns.push(k + 1);
    last = { log, s };
  }
  const goal = E.DIFFICULTY[d].goal;
  console.log(`\n=============== 难度 ${d} / 目标 ${goal} / ${RUNS} 次模拟 ===============`);
  if (verbose) {
    const rows = last.log.filter(x => typeof x === 'object');
    console.log('Day  客流 卖出 流失   营收    净利  口碑    现金   净资产 员工 店');
    for (const r of rows) {
      console.log(
        String(r.day).padStart(3), String(r.traffic).padStart(5), String(r.served).padStart(4),
        String(r.lost).padStart(4), String(r.rev).padStart(7), String(r.net).padStart(7),
        String(r.rep).padStart(5), String(r.cash).padStart(8), String(r.worth).padStart(9),
        String(r.staff).padStart(4), String(r.shops).padStart(3));
    }
    last.log.filter(x => typeof x === 'string').forEach(x => console.log(x));
  }
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  console.log(`净资产：${scores.join(' / ')}  平均 ${avg}  达标率 ${(avg / goal * 100).toFixed(0)}%`
    + (failedRuns.length ? `  ⚠️ 破产局次 ${failedRuns.join(',')}` : ''));
}
