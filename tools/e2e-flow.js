/**
 * 端到端主流程验证：连续跑完一整局（30 天），每一步都做真实断言。
 *
 * ★ 为什么已有 7 套测试还不够：
 *   那些测试是**分片**验证的（研发一个、店长一个、城市一个），
 *   但玩家遇到的是**连续流程** —— 开局→备货→营业→结算→次日→…
 *   分片都过、连起来炸的情况很常见：
 *   比如"开了分店但没配人手"这种状态，单看每一步都合法，
 *   串起来就是净亏损。
 *
 * 用法：node tools/e2e-flow.js [难度] [局数]
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const DIFF = process.argv[2] || 'normal';

let fails = 0, step = 0;
function check(ok, label) {
  step++;
  if (ok) console.log(`  ✔ ${step}. ${label}`);
  else { fails++; console.log(`  ✘ ${step}. ${label}`); }
}

/* ---- 载入引擎（固定种子以便复现）---- */
let seed = 20261021;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const ctx = {
  console, JSON, Date, Object, Array, String, Number, Boolean, Error, Set, Map,
  isNaN, parseInt, parseFloat,
  Math: Object.assign(Object.create(Math), { random: rnd }),
  localStorage: {
    _d: {},
    getItem(k) { return k in this._d ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(root, 'js/data.js'), 'utf8') + '\n'
  + fs.readFileSync(path.join(root, 'js/engine.js'), 'utf8'),
  ctx, { filename: 'bundle.js' });
const E = ctx;
Object.assign(E, vm.runInContext('({CFG,DIFFICULTY,RECIPES,ACH_RECIPES,ALL_RECIPES,RESEARCH_TREE,ING,CUISINES,CITIES,MANAGER_RANKS})', ctx));

console.log(`=============== E2E 主流程 · ${DIFF} ===============`);

/* ---- 1. 开局 ---- */
const s = E.newGame(DIFF, 0, null);
check(!!s, '开局：newGame 返回有效 state');
check(s.day === 1 && s.shops === 1, `开局：Day 1 · 1 家店（实际 Day ${s.day} · ${s.shops} 家）`);
check(s.menu.length > 0, `开局：自带 ${s.menu.length} 款菜单`);
check(s.cash >= 0, `开局：现金非负（¥${Math.round(s.cash)}）`);
check(E.staffOfBranch(s, 1).length === s.staff.length, '开局：员工全在总店');

/* ---- 2. 备货（真实玩家会点「一键补货」）---- */
const invBefore = E.invUsed(s);
const af = E.autoFill(s);
check(af.bought > 0, `备货：一键补货进了 ${af.bought} 单位（¥${Math.round(af.spent)}）`);
check(E.invUsed(s) > invBefore, '备货：库存确实增加');
/* ★ 备货不该买本地买不到的原料 */
const cid0 = E.currentCityId(s);
const badBuy = E.ING.filter(g => g.origin && g.origin !== cid0 && (s.inv[g.id] || 0) > 0);
check(badBuy.length === 0,
  `备货：没有买入本地买不到的原料${badBuy.length ? '（' + badBuy.map(g => g.name).join(',') + '）' : ''}`);

/* ---- 3. 研发（按树推进）---- */
let researchErr = '';
try {
  for (let guard = 0; guard < 8; guard++) {
    const nodes = E.RESEARCH_TREE.filter(n => !n.city)
      .slice().sort((a, b) => a.stage - b.stage);
    let progressed = false;
    for (const n of nodes) {
      const r = E.recipeById(n.recipe);
      if (!r || !r.research || s.recipes.includes(n.recipe)) continue;
      s.cash = Math.max(s.cash, E.researchCost(s, n.recipe) + 5000);
      for (const g of E.ING) s.inv[g.id] = Math.max(s.inv[g.id] || 0, 200);
      const can = E.canResearch(s, n.recipe);
      if (can.ok) { E.doResearch(s, n.recipe); progressed = true; break; }
    }
    if (!progressed) break;
  }
} catch (e) { researchErr = e.message; }
check(!researchErr, `研发：按树逐级推进未抛错${researchErr ? '（' + researchErr + '）' : ''}`);
check(s.recipes.length >= 4, `研发：解锁到 ${s.recipes.length} 款配方`);

/* ---- 4. 上架菜单 ---- */
const slots = E.menuSlots(s);
let listed = 0;
for (const rid of s.recipes) {
  if (listed >= slots) break;
  if (E.toggleMenu(s, rid) === '上架') listed++;
}
check(s.menu.length === listed && listed > 0 && s.menu.length <= slots,
  `上架：${s.menu.length}/${slots} 款在架`);

/* ---- 5. 城市绑定：异地配方不可上架 ---- */
/*★ 必须**先确保解锁成功**再断言可上架 ——
     初版写成「研不出来就跳过检查」，结果这条断言永远不执行，
     看起来绿了其实什么都没验。这是"条件式断言"的典型陷阱：
     前置失败时它不报错，只是安静地什么都不做。
     这里改成：研不出来直接算失败。*/
E.setVenueCity(s, '510100');           /* 成都 */
const cdR = E.recipeById('cd_rattancha');
let cdErr = '';
if (!s.recipes.includes(cdR.id)) {
  s.cash = 1e6;
  for (const g of E.ING) s.inv[g.id] = 500;
  const c = E.canResearch(s, cdR.id);
  if (!c.ok) cdErr = '在成都研不出成都菜：' + c.msg;
  else E.doResearch(s, cdR.id);
}
if (!cdErr && !s.recipes.includes(cdR.id)) cdErr = 'doResearch 后仍未解锁';
if (!cdErr && !E.canListRecipe(s, cdR.id).ok) cdErr = '已解锁但不可上架';
check(!cdErr, `城市绑定：成都菜在成都可研可上架${cdErr ? '（' + cdErr + '）' : ''}`);
/* 反向：北京不该能上架成都菜 */
E.setVenueCity(s, '110100');
check(!E.canListRecipe(s, cdR.id).ok, '城市绑定：换到北京后成都菜不可上架');
E.setVenueCity(s, '510100');

/* ---- 6. 开分店 → 店长名额 ---- */
s.cash = 1e6;
const shopsBefore = s.shops;
const op = E.openShopBranch(s);
check(op.ok && s.shops === shopsBefore + 1, `开店：第 ${s.shops} 家分店开业`);
check(E.managerSlotsLeft(s) === 1, `开店：店长名额 +1（剩 ${E.managerSlotsLeft(s)}）`);
check(((s.mgrCand && s.mgrCand[s.shops]) || []).length >= 2,
  `开店：立刻出现 ${((s.mgrCand && s.mgrCand[s.shops]) || []).length} 位候选人`);

/* ---- 7. 招店长 → 派驻 → 店真正开张 ---- */
const hr = E.hireManager(s, s.shops, 0);
check(hr.ok, `招店长：${hr.ok ? hr.manager.name + '（Lv.' + hr.manager.lv + '）' : hr.msg}`);
const activeBefore = E.activeBranchCount(s);
E.refreshCandidates(s, true);
E.hireStaff(s, 0, s.shops);           /* 派一个人过去 */
const activeAfter = E.activeBranchCount(s);
check(activeAfter === activeBefore + 1,
  `派驻：分店有了人，在营店数 ${activeBefore} → ${activeAfter}`);
check(E.staffOfBranch(s, s.shops).length >= 1,
  `派驻：该店有 ${E.staffOfBranch(s, s.shops).length} 名员工`);

/* ★ 关键：空店的客流必须低于有人的店 —— 这是 V11 的核心修正 */
const trafficNow = E.trafficOf(s);
check(trafficNow > 0, `客流：开分店配人后为 ${trafficNow}`);
/* ★ 必须**控制变量**：空店局与总店局要同一天气、同口碑、同营销，
     否则比出来的是天气差异（实测两次 newGame 的天气倍率是 1 vs 1.28，
     客流差 13 vs 16 —— 那是天气不是分店加成）。
     断言的命题是「空店的 activeBranchCount 仍为 1，不拿分店加成」。*/
const mkShop = () => {
  const t = E.newGame(DIFF, 0, null);
  t.weather = { traffic: 1, boom: 'fresh', bust: 'rich', name: '晴', emoji: '☀️' };
  t.rep = 50; t.marketing = 0;
  return t;
};
const emptyShop = mkShop();
emptyShop.cash = 1e6;
E.openShopBranch(emptyShop);          /* 开了店但**不派人** */
const baseShop = mkShop();            /* 只有总店 */
const fullShop = mkShop();            /* 开店 + 派人 */
fullShop.cash = 1e6;
E.openShopBranch(fullShop);
for (const g of E.ING) fullShop.inv[g.id] = 99;
E.refreshCandidates(fullShop, true);
E.hireStaff(fullShop, 0, 2);

check(E.activeBranchCount(emptyShop) === 1,
  `空店不计入在营店数（activeBranchCount = ${E.activeBranchCount(emptyShop)}）`);
check(E.trafficOf(emptyShop) === E.trafficOf(baseShop),
  `空店无客流加成：空店 ${E.trafficOf(emptyShop)} = 纯总店 ${E.trafficOf(baseShop)}（不白送 60%）`);
check(E.trafficOf(fullShop) > E.trafficOf(baseShop),
  `有人分店客流更高：${E.trafficOf(fullShop)} > ${E.trafficOf(baseShop)}`);

/* ---- 8. 完整走完 30 天 ---- */
let days = 0, err = '';
try {
  for (let d = 0; d < 32 && !E.isFinished(s) && !E.isBankrupt(s); d++) {
    /* 每天：补货 → 开门 → 快进营业 → 收工 */
    E.autoFill(s);
    const om = E.openShop(s);
    /* 「账还没结」不是缺陷 —— 那是循环边界（上一轮故意不调 nextDay）。
       其他任何失败才是真问题。*/
    if (!om.ok) {
      if (om.msg.indexOf('账还没结') >= 0) break;
      err = 'Day ' + s.day + ' 开店失败：' + om.msg; break;
    }
    /* 快进：把 sim.t 推到底，让 tick 走完整个营业时段 */
    let guard = 0;
    while (s.sim && !s.sim.closing && guard++ < 400) E.tick(s, 0.12);
    if (s.sim) s.sim.t = s.sim.duration + 1;
    /* 结算 */
    E.endDay(s);
    days++;
    /* 最后一天**不调 nextDay** —— 留出一个「刚收工」的状态。
       玩家点收工时存档记的就是这一刻的天数，
       拿这个时点做存档往返比对才有意义；
       若这里多推一天，就会拿"存档 Day 30"去比"内存 Day 31"，
       是个必然失败的假警报。 */
    if (s.phase === 'report' && s.day < E.CFG.DAYS) E.nextDay(s);
  }
} catch (e) { err = e.message + '\n' + (e.stack || '').split('\n')[1]; }
check(!err, `主循环：连续经营 ${days} 天未抛错${err ? '（' + err.slice(0, 90) + '）' : ''}`);
check(days >= 25, `主循环：跑到自然收官或破产（${days} 天）`);
check(Number.isFinite(s.cash) && s.cash >= 0, `账目：现金是有限非负数（¥${Math.round(s.cash)}）`);

/* ---- 9. 结算账目自洽 ---- */
const rpt = s.lastReport;
let acctErr = '';
if (rpt) {
  const expect = Math.round(rpt.revenue - rpt.cogs - rpt.wages - rpt.rent - (rpt.marketing || 0));
  if (Math.abs(expect - rpt.net) > 2) acctErr = `净利对不上：${expect} vs ${rpt.net}`;
}
check(!acctErr, `账目：营收 − 成本 − 人工 − 租金 = 净利${acctErr ? '（' + acctErr + '）' : ''}`);
/* 店长日薪必须计入人工成本 */
if (s.managers.length) {
  const mgrWage = s.managers.reduce((a, b) => a + b.wage, 0);
  check(mgrWage > 0 && rpt && rpt.wages > 0,
    `账目：店长日薪 ¥${Math.round(mgrWage)}/天 已计入人工成本`);
}

/* ---- 10. 存档往返 ---- */
let saveErr = '';
try {
  E.setSlot(0); E.saveGame(s);
  const back = E.loadGame(0);
  if (!back) saveErr = '读档失败';
  else {
    if (back.staff.length !== s.staff.length) saveErr = `员工数变了 ${s.staff.length}→${back.staff.length}`;
    if ((back.managers || []).length !== (s.managers || []).length) saveErr = '店长数变了';
    if (back.day !== s.day) saveErr = `天数变了 ${s.day}→${back.day}`;
    /* 分店归属必须往返一致 */
    for (let i = 0; i < back.staff.length; i++) {
      if (back.staff[i].branch !== s.staff[i].branch) {
        saveErr = `员工 ${i} 的分店归属变了 ${s.staff[i].branch}→${back.staff[i].branch}`;
        break;
      }
    }
  }
} catch (e) { saveErr = e.message; }
check(!saveErr, `存档：往返后员工/店长/天数/分店归属一致${saveErr ? '（' + saveErr + '）' : ''}`);

/* ---- 11. 脏存档不崩 ---- */
let dirtyErr = '';
try {
  const dirty = JSON.parse(JSON.stringify(s));
  dirty.managers = 'not-an-array';
  dirty.mgrCand = 12345;
  dirty.nextMgrId = -5;
  dirty.shops = 0;
  dirty.cash = NaN;
  dirty.staff = [{ id: 'x', name: '', skill: 'abc', branch: 999, wage: -5 }];
  dirty.venue = { cityId: '999999', provId: 'xx' };
  dirty.recipes = null;
  dirty.menu = 'nope';
  const clean = E.sanitizeState(dirty);
  if (!clean) dirtyErr = 'sanitizeState 返回 null';
  else {
    if (clean.shops < 1) dirtyErr = 'shops 未被夹到 ≥1';
    else if (!Number.isFinite(clean.cash)) dirtyErr = 'cash 仍是 NaN';
    else if (!Array.isArray(clean.managers)) dirtyErr = 'managers 未被清洗为数组';
    else if (!Array.isArray(clean.menu)) dirtyErr = 'menu 未被清洗为数组';
    else if (clean.staff[0].branch < 1) dirtyErr = 'branch 未夹到 ≥1';
    else if (clean.staff[0].wage < 0) dirtyErr = '负工资未归零';
  }
} catch (e) { dirtyErr = e.message; }
check(!dirtyErr, `脏存档：极端脏数据被收敛${dirtyErr ? '（' + dirtyErr + '）' : ''}`);

/* ---- 12. 无尽模式能启动 ---- */
let endlessErr = '';
try {
  const em = E.newGame(DIFF, 0, null);
  E.startEndless(em);
  check(E.isFinished(em) === false || em.endless === true, '无尽模式：可启动且标记正确');
} catch (e) { endlessErr = e.message; }
check(!endlessErr, `无尽模式：启动未抛错${endlessErr ? '（' + endlessErr + '）' : ''}`);

console.log('');
if (fails === 0) console.log(`✅ E2E 主流程全部通过（${step} 项）`);
else console.log(`❌ E2E 发现 ${fails} 个问题 / 共 ${step} 项`);
process.exit(fails === 0 ? 0 : 1);