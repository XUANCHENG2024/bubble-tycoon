/* ============================================================
 *  引擎探针（一次性体检 / 回归用）
 *
 *  与四套冒烟的区别：
 *    冒烟验的是「正常路径能不能跑通」，这里验的是「非正常路径会不会崩」。
 *  四类探针：
 *    A. 存档清洗器抗性 —— 喂各种脏数据，输出必须始终可玩
 *    B. 阶段错配 —— 在错误的 phase 调动作，不能崩也不能改坏状态
 *    C. 退化局面 —— 零员工 / 空菜单 / 空库存 / 负现金 / 极端数值
 *    D. 长跑不变量 —— 30 天跑完后，状态里不能有 NaN/Infinity、不能无限增长
 * ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');

function fakeCtx() {
  return new Proxy({}, {
    get(t, p) {
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() { } });
      if (p === 'measureText') return () => ({ width: 10 });
      return () => { };
    },
    set() { return true; },
  });
}
function makeEl(id) {
  return {
    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, children: [],
    getContext: () => fakeCtx(), toDataURL: () => 'data:image/png;base64,AA',
    width: 0, height: 0, select() { },
    classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
    addEventListener() { }, removeEventListener() { },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.push(c); return c; },
    remove() { }, querySelector() { return makeEl('sub'); }, querySelectorAll() { return []; },
    closest() { return this }, getBoundingClientRect() { return { left: 0, top: 0, width: 120, height: 40 }; },
    animate() { return {}; }, focus() { },
  };
}
const els = {};
const store = {};
const ctx = {
  console, Math, JSON, Date, Object, Array, String, Number, Boolean, Error, Set, Map,
  isNaN, parseInt, parseFloat, setTimeout, clearTimeout,
  TextEncoder, TextDecoder,
  btoa: s => Buffer.from(String(s), 'binary').toString('base64'),
  atob: s => Buffer.from(String(s), 'base64').toString('binary'),
  innerHeight: 800, innerWidth: 420,
  performance: { now: () => Date.now() },
  requestAnimationFrame() { return 0; },
  setInterval() { return 0; }, clearInterval() { },
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  },
  document: {
    getElementById(id) { return els[id] || (els[id] = makeEl(id)); },
    querySelectorAll() { return []; }, querySelector() { return makeEl('q'); },
    createElement() { return makeEl('new'); }, addEventListener() { }, hidden: false,
  },
};
ctx.addEventListener = () => { };
ctx.removeEventListener = () => { };
ctx.AudioContext = function () {
  this.currentTime = 0; this.state = 'running'; this.destination = {};
  this.createOscillator = () => ({ frequency: { setValueAtTime() { }, exponentialRampToValueAtTime() { } }, gain: { setValueAtTime() { }, exponentialRampToValueAtTime() { } }, connect() { }, start() { }, stop() { } });
  this.createGain = () => ({ gain: { setValueAtTime() { }, exponentialRampToValueAtTime() { } }, connect() { } });
  this.resume = () => { };
};
ctx.window = ctx; ctx.globalThis = ctx;

const src = ['js/data.js', 'js/engine.js', 'js/ui.js', 'js/main.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n')
  + '\n;globalThis.__D={CFG,ING,RECIPES,UPGRADES,TRAITS,EVENTS,ACHIEVEMENTS,DIFFICULTY,SHOP_COSTS,WEATHERS,NEWS,UI,'
  + 'STAGES,STAGE_DIFFS,STAGE_CHAPTERS,STAGE_DAYS,SIGNATURE_TIERS,SPECIAL_CUSTOMERS,ENDING_AXES,CONTRACTS,CUSTOMER_TYPES,'
  + 'VENUE_TYPES,PROVINCES,CITIES,DISTRICTS,GEO,CITY_CENTERS,VENUE_DEFAULT,CITY_DEFAULT,venueTypeById,cityById,citiesOfProvince,districtsOfCity,normalizeGeo,setGeoToCityCenter,nextVenueType,nextProvince,nextCity,nextDistrict,cityGeoOf,'
  + 'CUISINES,CRAFT_WORKSHOPS,CUISINE_FOCUS,WORKSHOP_START,workshopById,workshopLevel,workshopCost,workshopCostCut,workshopResearchCut,workshopTier3Bonus,cuisineWeightMul,cuisineFocusBonus,cuisineFocusWeight,cuisineById,recipesOfCuisine,cuisineViews,buildWorkshop,reqOf,consumeStock,canListRecipe,canResearch,researchCost,doResearch,'
  + 'RNG,QUEST_RNG,seedFromText,todayKey,pickCustomerType,initRival,rivalShare,rivalAction,updateRival,money,clamp,num,pick,rnd,'
  + 'goalOf,startEndless,togglePause,slotInfo,hasAnySave,getSlot,setSlot,exportSave,importSave,'
  + 'MILESTONE_EVERY,MILESTONE_RATIO,milestoneOf,endlessPressure,prestigeGain,prestigeStartCash,claimAchStars,'
  + 'checkAchievements,trafficOf,claimOffline,isBankrupt,isFinished,netWorth,invUsed,invValue,costOf,priceOf,'
  + 'menuSlots,stationCount,queueCap,patienceOf,storageCap,serviceTimeOf,avgCupsPerOrder,maxCupsFromStock,'
  + 'maxOrdersFromStock,dailyOrderCapacity,dailyClickOrderCapacity,adviceOf,'
  + 'STRATEGY_CARDS,CARD_THEMES,cardById,cardMul,cardSum,cardThemeBonus,drawCards,applyCard,shouldOfferCard,'
  + 'QUESTS,QUEST_COUNT,questById,questPool,questGoalOf,questRewardOf,rollQuests,bumpQuest,closeQuests,questViews,'
  + 'rankScore,recordDaily,dailyRecent,newMeta,loadMeta,saveMeta,pushRunRecord,'
  + 'newGame,sanitizeState,loadGame,saveGame,clearSave,openShop,tick,endDay,nextDay,applyEvent,'
  + 'buyIng,autoFill,toggleMenu,setRatio,doResearch,doUpgrade,openShopBranch,hireStaff,fireStaff,teamBuild,'
  + 'refreshCandidates,refreshMarket,researchCost,canResearch,upgradeCost,shopCost,rushStation,bossSkill,'
  + 'CONTRACTS,contractById,contractView,contractMetrics,rollContract,settleContract,openOps,saleActive,flashSale,pullMenu,'
  + 'loginState,claimLogin,takeLoginBonus,recipeById,ingById,hasStock,consumeStock,pushLog};';
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'bundle.js' });
Object.assign(ctx, ctx.__D);
const E = ctx;

let fails = 0, checks = 0;
function bad(tag, msg) { fails++; console.log(`  ✘ [${tag}] ${msg}`); }
function good(tag, msg) { console.log(`  ✔ [${tag}] ${msg}`); }
function expect(tag, cond, msg) { checks++; if (cond) good(tag, msg); else bad(tag, msg); }

/* 把状态里所有数字走一遍，揪出 NaN / Infinity */
function scanNumbers(o, out, p) {
  out = out || []; p = p || '$';
  if (o === null || o === undefined) return out;
  if (typeof o === 'number') {
    if (!isFinite(o)) out.push(p + '=' + o);
    return out;
  }
  if (typeof o !== 'object') return out;
  if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) scanNumbers(o[i], out, p + '[' + i + ']'); }
  else { for (const k in o) scanNumbers(o[k], out, p + '.' + k); }
  return out;
}

/** 跑一局需要的动作序列，尽量覆盖全部交互 */
function playOneDay(s) {
  E.buyIng(s, 'tea', 20); E.buyIng(s, 'milk', 20); E.buyIng(s, 'pearl', 20);
  E.autoFill(s);
  s.menu = s.recipes.slice(0, E.menuSlots(s));
  for (const r of s.menu) s.ratios[r] = 1.0;
  const r = E.openShop(s);
  if (!r.ok) return r.msg || 'openShop 失败';
  let n = 0;
  while (s.phase === 'open' && n++ < 4000) E.tick(s, 1 / 30);
  return null;
}

console.log('\n=============== A. 存档清洗器抗性 ===============');
{
  /* 每个字段都试一遍「错类型」，sanitizeState 必须产出可玩状态，不能抛 */
  const GARBAGE = [
    undefined, null, 0, 1, '', 'x', true, false, [], {}, [1, 2], { a: 1 },
    NaN, Infinity, -Infinity, 1e308, -1e308, 1e-308,
    '0', '999999999', 'NaN', '{}', '[]', '<script>',
  ];
  let threw = 0, badOut = 0, worst = '';
  const probe = f => {
    for (const g of GARBAGE) {
      const dirty = Object.assign({}, E.newGame('normal', 0));
      dirty[f] = g;
      let out = null;
      try { out = E.sanitizeState(dirty); }
      catch (e) { threw++; worst = `${f}=${String(g)} → ${e.message}`; continue; }
      const nan = scanNumbers(out);
      if (nan.length) { badOut++; worst = `${f}=${String(g)} → ${nan.slice(0, 3).join(',')}`; }
    }
  };
  ['diff', 'day', 'cash', 'rep', 'inv', 'avgCost', 'prices', 'prevPrices', 'recipes', 'menu',
    'ratios', 'up', 'shops', 'shopSpend', 'invested', 'staff', 'candidates', 'nextStaffId',
    'weather', 'trend', 'nextTrend', 'trendKnown', 'news', 'newsFx', 'marketing', 'dayMarketing',
    'eventTrafficMul', 'doneEvents', 'phase', 'sim', 'report', 'pendingEvent', 'debtDays',
    'lastReport', 'prevReport', 'lastMarketing', 'msHit', 'bpBonus', 'startBonus',
    'history', 'endless', 'milestone', 'daily', 'ach', 'cards', 'cardOffer', 'quests', 'rival',
    'log', 'lastTime', 'tut',
  ].forEach(probe);
  expect('A1', threw === 0, `sanitizeState 对 38 个字段 × ${GARBAGE.length} 种脏数据不抛异常${threw ? '（' + threw + ' 次抛出，例如 ' + worst + '）' : ''}`);
  expect('A2', badOut === 0, `清洗后的状态里没有 NaN / Infinity${badOut ? '（' + badOut + ' 例，例如 ' + worst + '）' : ''}`);

  /* 完全空对象、完全非对象 */
  [undefined, null, 42, 'x', [], [1], true].forEach(g => {
    try { const o = E.sanitizeState(g); scanNumbers(o); }
    catch (e) { bad('A3', `sanitizeState(${JSON.stringify(g)}) 抛出：${e.message}`); }
  });
  expect('A3', true, 'sanitizeState 对非对象输入不抛异常');

  /* 洗出来的状态要真的能开局跑一天 */
  const s2 = E.sanitizeState(Object.assign({}, E.newGame('hard', 0), { cash: -99999, rep: -50, day: 999, shops: 999 }));
  try {
    s2.day = 1; s2.cash = 500; s2.shops = 1;
    const err = playOneDay(s2);
    expect('A4', !err, `极端脏数据洗出来的局面仍能跑完一天${err ? '：' + err : ''}`);
  } catch (e) { bad('A4', '极端脏数据洗出来的局面跑一天时抛出：' + e.message); }

  /* 存档往返：导出的码再导入，行为必须一致 */
  const s3 = E.newGame('normal', 0);
  s3.cash = 1234; s3.rep = 40; s3.day = 7;
  const code = E.exportSave(s3);
  const back = E.importSave(code);
  expect('A5', back.ok && Math.abs(back.state.cash - 1234) < 1, '导出 / 导入往返：现金一致');
  expect('A6', !E.importSave('!!!not-a-code!!!').ok, '非法存档码被拒绝');
  expect('A7', !E.importSave('').ok, '空存档码被拒绝');
  expect('A8', !E.importSave('A'.repeat(300000)).ok, '超长存档码被拒绝（不当场卡死主线程）');

  /* 清洗盲区回归：这几组以前是 obj(x) 直接放行，改存档能白嫖成就 / 篡改进价 */
  const evil = Object.assign({}, E.newGame('normal', 0), {
    ach: { a_first: true, __fake1: true, __fake2: true, __fake3: true },
    flags: { perfectDay: true, fiveTypes: true, starMagnet: true, rivalDown: true, __cheat: true },
    newsFx: { tea: 0.01, milk: 9999, __junk: 5 },
    rival: { name: 'x', emoji: '🦑', rep: 40, aggro: 1, proof: 0, cd: { steal: 'abc', pr: NaN, __z: -5 } },
  });
  const cl = E.sanitizeState(evil);
  expect('A9', Object.keys(cl.ach).length === 1 && cl.ach.a_first === true,
    `假成就 id 被过滤（剩 ${Object.keys(cl.ach).length} 个）`);
  expect('A10', !cl.flags.__cheat && cl.flags.perfectDay === true,
    `flags 走白名单，作弊键被丢弃（保留 ${Object.keys(cl.flags).length} 个合法键）`);
  expect('A11', cl.newsFx.tea === 0.5 && cl.newsFx.milk === 1.6 && !('__junk' in cl.newsFx),
    `原料价格乘数夹到 [0.5, 1.6]（tea=${cl.newsFx.tea} milk=${cl.newsFx.milk}）`);
  const cdv = Object.keys(cl.rival.cd).map(k => cl.rival.cd[k]);
  expect('A12', cdv.every(v => Number.isFinite(v) && v >= 0),
    `对手冷却表的脏值被收敛（${JSON.stringify(cl.rival.cd)}）`);

  /* 日报：以前只判 typeof === 'object'，塞 Infinity 会让结算页显示 ¥Infinity */
  const er = E.sanitizeState(Object.assign({}, E.newGame('normal', 0), {
    report: { revenue: Infinity, net: NaN, repAfter: 1e9, sat: 42, typeServed: { evil: -7 } },
  }));
  expect('A13', er.report && isFinite(er.report.revenue) && isFinite(er.report.net)
    && er.report.repAfter <= 100 && er.report.sat <= 1 && er.report.typeServed.evil === 0,
    `日报脏值被逐字段收敛（rev=${er.report && er.report.revenue} rep=${er.report && er.report.repAfter}）`);

  /* 历史曲线：pushHistory 写了 rival，清洗器以前漏了它 */
  const eh = E.sanitizeState(Object.assign({}, E.newGame('normal', 0), {
    history: [{ day: 1, revenue: 100, net: 20, worth: 900, rep: 30, cups: 5, orders: 3, lost: 1, rival: 12 }],
  }));
  expect('A14', eh.history[0] && eh.history[0].rival === 12,
    `历史曲线保留 rival 字段（${eh.history[0] ? eh.history[0].rival : '缺失'}）`);
}

console.log('\n=============== B. 阶段错配 ===============');
{
  /* 在 prep（备货）阶段调用营业阶段才有的动作，不能崩 */
  const s = E.newGame('normal', 0);
  let threw = null;
  try {
    E.rushStation(s, 0);
    E.rushStation(s, 99);
    E.rushStation(s, -1);
    E.bossSkill(s);
    E.togglePause(s);
    E.togglePause(s, true);
    E.togglePause(s, false);
    E.endDay(s);
  } catch (e) { threw = e.message; }
  expect('B1', !threw, `prep 阶段调用营业动作不抛异常${threw ? '：' + threw : ''}`);

  /* 越界 / 非法 id */
  const s2 = E.newGame('normal', 0);
  let threw2 = null;
  try {
    E.buyIng(s2, '不存在的原料', 10);
    E.buyIng(s2, 'tea', -10);
    E.buyIng(s2, 'tea', 0);
    E.buyIng(s2, 'tea', 1e12);
    E.toggleMenu(s2, '不存在的配方');
    E.setRatio(s2, '不存在的配方', 5);
    E.setRatio(s2, 'boba', NaN);
    E.doResearch(s2, '不存在的配方');
    E.doUpgrade(s2, '不存在的升级');
    E.hireStaff(s2, 99);
    E.hireStaff(s2, -1);
    E.fireStaff(s2, 999);
    E.applyCard(s2, '不存在的卡');
    E.rivalAction(s2, '不存在的行动');
  } catch (e) { threw2 = e.message; }
  expect('B2', !threw2, `越界下标 / 非法 id 不抛异常${threw2 ? '：' + threw2 : ''}`);
  expect('B3', scanNumbers(s2).length === 0, '经受一轮非法调用后状态里没有 NaN / Infinity');

  /* 营业中重复开门 / 打烊 */
  const s3 = E.newGame('normal', 0);
  s3.menu = s3.recipes.slice(0, E.menuSlots(s3));
  E.openShop(s3);
  const again = E.openShop(s3);
  expect('B4', again && again.ok === false, '营业中重复开门被拒绝（不会重置当天的营收）');
  let threw3 = null;
  try { while (s3.phase === 'open') E.tick(s3, 1 / 30); } catch (e) { threw3 = e.message; }
  expect('B5', !threw3, `跑到打烊不抛异常${threw3 ? '：' + threw3 : ''}`);
  expect('B6', s3.phase === 'report', '营业结束后停在 report（结算）阶段');
}

console.log('\n=============== C. 退化局面 ===============');
{
  /* 空菜单：所有客人都会因为没货可买而流失，但不能崩 */
  const s = E.newGame('normal', 0);
  s.menu = [];
  let threw = null;
  try {
    E.openShop(s);
    let n = 0;
    while (s.phase === 'open' && n++ < 4000) E.tick(s, 1 / 30);
    E.endDay(s);
  } catch (e) { threw = e.message; }
  expect('C1', !threw, `空菜单开局跑完一天不崩${threw ? '：' + threw : ''}`);
  expect('C2', scanNumbers(s).length === 0, '空菜单局面跑完后没有 NaN / Infinity');

  /* 空库存 */
  const s2 = E.newGame('normal', 0);
  for (const g of E.ING) s2.inv[g.id] = 0;
  s2.cash = 0;
  let threw2 = null;
  try {
    s2.menu = s2.recipes.slice(0, E.menuSlots(s2));
    E.openShop(s2);
    let n = 0;
    while (s2.phase === 'open' && n++ < 4000) E.tick(s2, 1 / 30);
  } catch (e) { threw2 = e.message; }
  expect('C3', !threw2, `零库存零现金跑完一天不崩${threw2 ? '：' + threw2 : ''}`);

  /* 极端数值：招满人 + 开满分店 + 全部升级拉满 */
  const s3 = E.newGame('easy', 0);
  s3.cash = 1e9;
  let threw3 = null;
  try {
    for (const u of Object.keys(s3.up)) for (let i = 0; i < 30; i++) E.doUpgrade(s3, u);
    for (let i = 0; i < 10; i++) E.openShopBranch(s3);
    for (let i = 0; i < 20; i++) { E.refreshCandidates(s3, true); E.hireStaff(s3, 0); }
    for (const r of E.RECIPES) E.doResearch(s3, r.id);
  } catch (e) { threw3 = e.message; }
  expect('C4', !threw3, `升级/分店/招人/研发全部拉满不崩${threw3 ? '：' + threw3 : ''}`);
  expect('C5', scanNumbers(s3).length === 0, '满级局面里没有 NaN / Infinity');
  expect('C6', s3.staff.length <= 20, `员工数没有突破上限（${s3.staff.length}）`);

  /* 负口碑 / 负现金 */
  const s4 = E.newGame('normal', 0);
  s4.rep = -100; s4.cash = -100;
  let threw4 = null;
  try {
    E.trafficOf(s4); E.adviceOf(s4); E.netWorth(s4); E.milestoneOf(s4);
    E.prestigeGain(s4); E.dailyOrderCapacity(s4); E.avgCupsPerOrder(s4);
  } catch (e) { threw4 = e.message; }
  expect('C7', !threw4, `负口碑 / 负现金下的派生计算不崩${threw4 ? '：' + threw4 : ''}`);
  expect('C8', E.trafficOf(s4) >= 0, `负口碑下客流不为负（${E.trafficOf(s4).toFixed(2)}）`);

  /* 无尽模式 + 每日挑战同时为真（理论上互斥，但存档可以被改） */
  const s5 = E.newGame('normal', 0);
  s5.endless = true; s5.daily = true; s5.day = 31; s5.milestone = 40;
  let threw5 = null;
  try {
    E.isFinished(s5); E.goalOf(s5); E.endlessPressure(s5); E.milestoneOf(s5);
    s5.day = 1; s5.endless = false;
    E.isFinished(s5);
  } catch (e) { threw5 = e.message; }
  expect('C9', !threw5, `无尽 / 每日挑战标记冲突时不崩${threw5 ? '：' + threw5 : ''}`);
}

console.log('\n=============== D. 长跑不变量 ===============');
{
  const s = E.newGame('normal', 0);
  let threw = null, days = 0;
  try {
    s.menu = s.recipes.slice(0, E.menuSlots(s));
    while (days < 30 && !E.isFinished(s)) {
      /* 每天：进货 → 开门 → 跑完 → 结算 → 下一天 */
      E.autoFill(s);
      const r = E.openShop(s);
      if (!r.ok) break;
      let n = 0;
      while (s.phase === 'open' && n++ < 4000) E.tick(s, 1 / 30);
      if (s.phase === 'report') { E.endDay(s); E.nextDay(s); }
      days++;
    }
  } catch (e) { threw = e.message; }
  expect('D1', !threw, `连续跑 30 天不崩${threw ? '：' + threw : ''}`);
  expect('D2', scanNumbers(s).length === 0, '30 天后状态里没有 NaN / Infinity');
  expect('D3', days >= 30, `真的跑满了 30 天（${days} 天）`);
  expect('D4', (s.log || []).length <= 60, `店长日志有上限（${(s.log || []).length} ≤ 60）`);
  expect('D5', (s.history || []).length <= 400, `经营曲线数据有上限（${(s.history || []).length} ≤ 400）`);
  expect('D6', (s.cards || []).length <= E.CFG.CARD_MAX, `策略卡不超过上限（${(s.cards || []).length}）`);
  expect('D7', (s.doneEvents || []).length < 100, `已发生事件列表不会无限增长（${(s.doneEvents || []).length}）`);

  /* 跨 3 局累积 */
  const m = E.newMeta();
  let threw2 = null;
  try {
    for (let g = 0; g < 3; g++) {
      const st = E.newGame('normal', m.bp);
      st.menu = st.recipes.slice(0, E.menuSlots(st));
      for (let d = 0; d < 30; d++) {
        E.autoFill(st);
        const r = E.openShop(st);
        if (!r.ok) break;
        let n = 0;
        while (st.phase === 'open' && n++ < 4000) E.tick(st, 1 / 30);
        if (st.phase === 'report') { E.endDay(st); E.nextDay(st); }
      }
      E.pushRunRecord(m, st, 'finish');
      E.recordDaily(m, E.todayKey(), E.netWorth(st));
      m.bp += E.prestigeGain(st);
    }
  } catch (e) { threw2 = e.message; }
  expect('D8', !threw2, `连玩 3 局不崩${threw2 ? '：' + threw2 : ''}`);
  expect('D9', (m.runsTop || []).length <= E.CFG.RUN_TOP_N, `战绩榜跨局不超限（${(m.runsTop || []).length}）`);
  expect('D10', (m.dailyLog || []).length <= E.CFG.DAILY_LOG_MAX, `每日日志跨局不超限（${(m.dailyLog || []).length}）`);
}

console.log('\n=============== E. 结算数字自洽 ===============');
{
  const s = E.newGame('normal', 0);
  s.menu = s.recipes.slice(0, E.menuSlots(s));
  for (const r of s.menu) s.ratios[r] = 1.0;
  E.buyIng(s, 'tea', 30); E.buyIng(s, 'milk', 30); E.buyIng(s, 'pearl', 30);
  /* 故意投一笔营销费：营销为 0 时下面两条断言会「因为没得可扣」而轻易通过，
     等于把账目校验变成了走过场。 */
  s.marketing = 60;
  /* 基准点必须在开门前一刻取：备货（buyIng）本身就会 bumpQuest('restock')
     并发掉一笔任务奖金，取早了会把这笔钱算两次。 */
  const achBefore = Object.assign({}, s.ach);
  const questCash0 = s.stats.questCash || 0;
  const cashBefore = s.cash;
  E.openShop(s);
  let n = 0;
  while (s.phase === 'open' && n++ < 4000) E.tick(s, 1 / 30);
  const rep = s.report || {};
  /* 日报口径：net = revenue - cogs - 工资 - 租金 - 当日营销
     （report.marketing 就是 s.dayMarketing，别重复扣） */
  const wages = 0, rent = Math.round(E.CFG.RENT_PER_SHOP * s.shops + E.CFG.SHOP_UPKEEP * (s.shops - 1));
  const expectNet = (rep.revenue || 0) - (rep.cogs || 0) - wages - rent - (rep.marketing || 0);
  expect('E1', Math.abs((rep.net || 0) - expectNet) <= 1 && (rep.marketing || 0) > 0,
    `日报净利与「营收-成本-工资-租金-营销」对得上（${Math.round(rep.net)} vs ${Math.round(expectNet)}，当日营销 ¥${rep.marketing}）`);
  expect('E2', (rep.served || 0) <= (rep.cups || 0) + 50,
    `卖出杯数与订单数不会互相矛盾（${rep.served} 杯 / ${rep.orders} 单）`);
  /* 现金流是浮点累加（每杯收入带小数），必须用容差比较，不能 ===。
     走 s.cash 却不进 sim.revenue 的共有四笔，全都要算上，否则会误报成对不上账：
       ① 每日任务奖金 ② 成就现金奖励（新档第一天尤其多）③ 事件现金
       ④ 每日合同奖金（V1，达成即到账；失败只扣口碑不影响现金）。
     ④ 漏掉它之后这条对账会**随机**失败 —— 合同抽中且当天达成的那天才差钱。 */
  const questCash = (s.stats.questCash || 0) - questCash0;
  let achCash = 0;
  for (const a of E.ACHIEVEMENTS) {
    if (!achBefore[a.id] && s.ach[a.id]) achCash += (a.reward && a.reward.cash) || 0;
  }
  const contractCash = (rep.contractResult && rep.contractResult.ok) ? rep.contractResult.cash : 0;
  const cashWant = cashBefore - (s.dayMarketing || 0) + (rep.revenue || 0) - rent - wages
    + questCash + achCash + contractCash;
  expect('E3', Math.abs(s.cash - cashWant) < 0.01,
    `当日现金变动与结算一致（实际 ${s.cash.toFixed(2)} vs 期望 ${cashWant.toFixed(2)}；任务 ¥${Math.round(questCash)} / 成就 ¥${Math.round(achCash)} / 合同 ¥${Math.round(contractCash)}）`);

  /* 净资产口径：现金 + 投资回收 + 库存，必须非负 */
  const nw = E.netWorth(s);
  expect('E4', isFinite(nw) && nw >= -1, `净资产是有限值且不为负（${Math.round(nw)}）`);

  /* 历史曲线与日报一致 */
  const last = (s.history || [])[s.history.length - 1] || {};
  expect('E5', Math.abs((last.revenue || 0) - (rep.revenue || 0)) < 1,
    '经营曲线最后一天的数据与当天日报一致');
}

console.log('\n=============== F. 存档槽隔离 ===============');
{
  E.setSlot(0);
  const a = E.newGame('easy', 0); a.cash = 1111;
  E.saveGame(a, 0);
  E.setSlot(1);
  const b = E.newGame('hard', 0); b.cash = 2222;
  E.saveGame(b, 1);
  E.setSlot(0);
  const back0 = E.loadGame(0);
  E.setSlot(1);
  const back1 = E.loadGame(1);
  expect('F1', Math.abs(back0.cash - 1111) < 1 && Math.abs(back1.cash - 2222) < 1,
    `两个槽位互不串档（槽1 ${Math.round(back0.cash)} / 槽2 ${Math.round(back1.cash)}）`);
  expect('F2', back0.diff === 'easy' && back1.diff === 'hard', '槽位难度也各自独立');
  E.setSlot(2);
  expect('F3', E.loadGame(2) === null, '空槽位读出 null（不会凭空造一个局面）');
  E.clearSave(0);
  expect('F4', E.loadGame(0) === null, '清档后该槽位为空');
  /* saveGame 不带槽位参数时应写入当前槽 */
  E.setSlot(1);
  const c = E.newGame('normal', 0); c.cash = 3333;
  E.saveGame(c);
  expect('F5', Math.abs(E.loadGame(1).cash - 3333) < 1, 'saveGame 默认写入当前槽位');
}

console.log('\n=============== G. 转生 / 无尽的跨局一致性 ===============');
{
  const m = E.newMeta();
  const s = E.newGame('normal', 0);
  s.menu = s.recipes.slice(0, E.menuSlots(s));
  for (let d = 0; d < 30; d++) {
    E.autoFill(s);
    const r = E.openShop(s);
    if (!r.ok) break;
    let n = 0;
    while (s.phase === 'open' && n++ < 4000) E.tick(s, 1 / 30);
    if (s.phase === 'report') { E.endDay(s); E.nextDay(s); }
  }
  const gain = E.prestigeGain(s);
  expect('G1', gain > 0 && gain < 60, `一局声望收益在合理区间（+${gain} ★）`);
  m.bp += gain;
  for (const k in s.ach) m.ach[k] = true;
  const s2 = E.newGame('normal', m.bp);
  expect('G2', s2.startBonus === E.prestigeStartCash(m.bp),
    `第二局的开局资金按新声望折算（¥${s2.startBonus}）`);
  expect('G3', s2.cash === E.DIFFICULTY.normal.cash + s2.startBonus,
    '第二局现金 = 难度初始现金 + 开局资金');
  /* 无尽：不能倒退，也不能一次跳太多 */
  const g0 = E.goalOf(s);
  const e = E.startEndless(s);
  expect('G4', E.goalOf(s) > g0, `无尽模式开启后目标上抬（${g0} → ${E.goalOf(s)}）`);
  expect('G5', s.endless === true && s.phase === 'prep', '无尽模式标记与阶段正确');
}

/* ============================================================
 *  H. 跨流程闭环（转生 / 无尽 / 日榜 / 策略卡 / 上限）
 *  前七组各自验一个维度，这里验「几个系统接在一起时还对不对」——
 *  上一轮 26 个修复里有 4 个是这类跨流程 bug（员工上限三处不一致、
 *  day 上界、营业中落盘、rivalShare 把 aggro 削平）。
 * ============================================================ */
console.log('\n=============== H. 跨流程闭环 ===============');
{
  /* --- H1 员工上限：三处必须同一个值，否则「雇满 → 存档 → 读档」会凭空少人 --- */
  const s = E.newGame('normal', 0);
  s.cash = 1e9;
  let hired = 0;
  for (let i = 0; i < 60; i++) {
    E.refreshCandidates(s, true);
    if (!E.hireStaff(s, 0).ok) break;
    hired++;
  }
  expect('H1a', hired === E.CFG.STAFF_MAX, `雇到 ${E.CFG.STAFF_MAX} 人即被拒（实际 ${hired}）`);
  const back = E.importSave(E.exportSave(s));
  expect('H1b', back.ok && back.state.staff.length === E.CFG.STAFF_MAX,
    `存档往返后员工数不变（${back.ok ? back.state.staff.length : '导入失败'}）`);

  /* 挖角是绕过 hireStaff 的第二条进人路径，上限也得一样 */
  const s2 = E.newGame('normal', 0);
  s2.cash = 1e9;
  for (let i = 0; i < 60; i++) { E.refreshCandidates(s2, true); E.hireStaff(s2, 0); }
  s2.rival.rep = 90; s2.rival.cd = {};
  const poach = E.rivalAction(s2, 'poach');
  expect('H1c', poach.ok === false && /上限/.test(poach.msg || ''),
    `满员后挖角被拒（${poach.msg || poach.ok}）`);

  /* --- H2 天数上界：普通局跑满就该收官，脏存档不能当场判定结束 --- */
  const d1 = E.sanitizeState(Object.assign({}, E.newGame('normal', 0), { day: 999 }));
  expect('H2a', d1.day === E.CFG.DAYS, `非无尽 day=999 洗成 ${E.CFG.DAYS}（实际 ${d1.day}）`);
  const d2 = E.sanitizeState(Object.assign({}, E.newGame('normal', 0), { day: 999, endless: true }));
  expect('H2b', d2.day === 999 && d2.endless === true, '无尽模式天数不受普通局上限约束');

  /* --- H3 营业中不落盘（营销费蒸发的修复） --- */
  const s3 = E.newGame('normal', 0);
  s3.marketing = 500;
  expect('H3a', E.autoSave(s3) === true, '备货阶段可以存档');
  s3.phase = 'open'; s3.sim = { t: 1 };
  const before = s3.cash;
  expect('H3b', E.autoSave(s3) === false, '营业中不落盘');
  expect('H3c', s3.cash === before, '营业中存档被拒时不动现金');

  /* --- H4 每日挑战：只记当天最好、换天重置、分数夹到 int32 --- */
  const m = E.newMeta();
  m.dailyDate = '2026-01-01'; m.dailyBest = 5000;
  const worse = E.recordDaily(m, '2026-01-01', 3000);
  const better = E.recordDaily(m, '2026-01-01', 8000);
  expect('H4a', worse.newToday === false && better.newToday === true,
    '更差的一局不上报、更好的一局才覆盖');
  expect('H4b', m.dailyBest === 8000, `当日最好成绩被刷新（${m.dailyBest}）`);
  const next = E.recordDaily(m, '2026-01-02', 100);
  expect('H4c', m.dailyDate === '2026-01-02' && m.dailyBest === 100,
    `换天后当日最好重置（${m.dailyDate} / ${m.dailyBest}）`);
  expect('H4d', E.rankScore(-5) === 0 && E.rankScore(1e12) === E.CFG.RANK_SCORE_MAX,
    '上报分数夹在 [0, int32_MAX]（负数归零、超大封顶）');

  /* --- H5 策略卡：频次、上限、非法 id、同种子可复现 --- */
  const c = E.newGame('normal', 0);
  c.day = 2;
  expect('H5a', E.drawCards(c) === null, `非抽卡日不抽（每 ${E.CFG.CARD_EVERY} 天一次）`);
  c.day = E.CFG.CARD_EVERY;
  const offer = E.drawCards(c);
  expect('H5b', Array.isArray(offer) && offer.length === E.CFG.CARD_OFFER_N
    && new Set(offer.map(x => x.id)).size === offer.length,
    `抽卡日给出 ${E.CFG.CARD_OFFER_N} 张不重复的候选`);
  expect('H5c', E.applyCard(c, '__no_such_card__') === null, '非法卡 id 被拒');
  c.cards = ['takeout', 'premium', 'express', 'member', 'kitchen', 'night'];
  expect('H5d', E.applyCard(c, 'bulk') === null, `持卡满 ${E.CFG.CARD_MAX} 张后不再收`);

  /* --- H6 无尽模式：不触发收官、里程碑与压力递增 --- */
  const e = E.newGame('normal', 0);
  E.startEndless(e);
  const g0 = E.goalOf(e);
  e.day = E.CFG.DAYS + 5;
  expect('H6a', E.isFinished(e) === false, '无尽模式跑过普通局天数也不收官');
  /* 压力与目标都挂在 milestone 上（endDay 里 worth >= goal 时才 +1），
     不是挂在天数上 —— 这里直接把 milestone 推到 endDay 会推到的值。 */
  const p1 = E.endlessPressure(e);
  e.milestone = 5;
  const p2 = E.endlessPressure(e);
  const g2 = E.goalOf(e);
  expect('H6b', p2 > p1, `无尽压力随里程碑递增（${p1.toFixed(2)} → ${p2.toFixed(2)}）`);
  expect('H6c', g2 > g0, `无尽目标随里程碑上抬（${g0} → ${g2}）`);
  /* 真跑一段无尽：钱给足到超过无尽目标（58900），验证 milestone 真的会自己涨。
     注意别给太少 —— 无尽目标比普通局高 55%，40000 现金是摸不到的。 */
  const e2 = E.newGame('normal', 0);
  E.startEndless(e2);
  const ms0 = e2.milestone;
  for (let d = 0; d < 12; d++) {
    e2.cash = Math.max(e2.cash, 120000);
    E.autoFill(e2);
    e2.menu = e2.recipes.slice(0, E.menuSlots(e2));
    for (const r of e2.menu) e2.ratios[r] = 1.0;
    const r = E.openShop(e2);
    if (!r.ok) break;
    let n = 0;
    while (e2.phase === 'open' && n++ < 4000) E.tick(e2, 1 / 30);
    if (e2.phase === 'report') { E.endDay(e2); E.nextDay(e2); }
  }
  expect('H6d', e2.milestone > ms0, `达标后里程碑自己递增（${ms0} → ${e2.milestone}）`);

  /* --- H7 转生曲线：单调、有上限、现金折算一致 --- */
  const bps = [0, 25, 100, 400, 4000];
  const vals = bps.map(b => E.prestigeStartCash(b));
  /* 单调**不减**即可 —— 到顶之后会持平，那不是 bug */
  expect('H7a', vals.every((v, i) => i === 0 || v >= vals[i - 1])
    && vals[vals.length - 1] === E.CFG.BP_START_CAP,
    `转生资金单调递增并封顶（${vals.join(' → ')}）`);
  const sp = E.newGame('normal', 250);
  expect('H7b', sp.cash === E.DIFFICULTY.normal.cash + sp.startBonus
    && sp.startBonus === E.prestigeStartCash(250),
    '新局现金 = 难度初始现金 + 转生资金');
  expect('H7c', sp.recipes.length === 1 && sp.up.speed === 0,
    '新局从零起步（配方与升级都重置，转生只带钱）');

  /* --- H8 长跑不变量：连打多局 + 无尽，状态不腐败 --- */
  let threw = '';
  const m8 = E.newMeta();
  try {
    for (let run = 0; run < 3; run++) {
      const st = E.newGame(run % 2 ? 'hard' : 'normal', run * 40);
      if (run === 2) E.startEndless(st);
      for (let d = 0; d < 40; d++) {
        st.cash = Math.max(st.cash, 2000);
        E.autoFill(st);
        st.menu = st.recipes.slice(0, E.menuSlots(st));
        for (const r of st.menu) st.ratios[r] = 1.0;
        const r = E.openShop(st);
        if (!r.ok) break;
        let n = 0;
        while (st.phase === 'open' && n++ < 4000) E.tick(st, 1 / 30);
        if (st.phase === 'report') { E.endDay(st); E.nextDay(st); }
      }
      E.pushRunRecord(m8, st, st.phase === 'over' ? 'bankrupt' : 'finish');
      m8.bp = Math.min(m8.bp + E.prestigeGain(st), 9999);
    }
  } catch (err) { threw = err.message; }
  expect('H8a', !threw, `连打 3 局（含无尽、含不同难度）不崩${threw ? '：' + threw : ''}`);
  expect('H8b', (m8.runsTop || []).length <= E.CFG.RUN_TOP_N,
    `战绩榜跨局不超限（${(m8.runsTop || []).length}）`);
  expect('H8c', m8.bp >= 0 && m8.bp <= 9999, `声望累积在合理区间（${m8.bp}）`);

  /* --- H9 无尽入口必须把上一段的营业现场清干净 ---
      「打烊后停在 report 阶段就收官 → 继续经营」是一条真实路径：
     finishRun 不推进阶段，phase 仍是 'report'、sim/report 还挂着。
     startEndless 若不清场，openShop 会被「今天的账还没结」挡死，
     而 finishRun 已经 clearSave() 过 —— 重载也救不回来，一局直接没了。 */
  const r9 = E.newGame('normal', 0);
  r9.cash = 1e9;
  E.autoFill(r9);
  r9.menu = r9.recipes.slice(0, E.menuSlots(r9));
  for (const r of r9.menu) r9.ratios[r] = 1.0;
  if (!E.openShop(r9).ok) bad('H9', 'H9 准备局面开门失败');
  let g9 = 0;
  while (r9.phase === 'open' && g9++ < 6000) E.tick(r9, 1 / 30);
  E.endDay(r9);
  expect('H9a', r9.phase === 'report', 'H9 准备局面停在结算阶段');
  E.startEndless(r9);
  expect('H9b', r9.phase === 'prep' && r9.sim === null && r9.report === null,
    `startEndless 清掉上一段的营业现场（phase=${r9.phase} sim=${r9.sim} report=${r9.report}）`);
  expect('H9c', E.openShop(r9).ok === true, '从结算阶段进入无尽后能正常开门');
  /* 正常通关路径也不能被这次改动破坏 */
  const r10 = E.newGame('normal', 0);
  E.startEndless(r10);
  expect('H9d', r10.phase === 'prep' && E.openShop(r10).ok === true,
    '备货阶段进入无尽同样能开门');

  /* --- I. 玩法多样性第一批（V1 合同 / V2 即时决策 / V3 高光 / V4 主题共鸣） --- */
  /* I1 每日合同：备货可见 → 打烊结算 → 次日换新 */
  const i1 = E.newGame('normal', 0);
  expect('I1a', !!i1.contract && E.contractById(i1.contract.id) !== null,
    `新档就有合同（${i1.contract && i1.contract.id}）`);
  const iv = E.contractView(i1);
  expect('I1b', !!iv && typeof iv.desc === 'string' && iv.desc.length > 4,
    `备货页能拿到合同展示（${iv && iv.emoji} ${iv && iv.name} · ${iv && iv.desc}）`);
  i1.cash = 1e9; E.autoFill(i1);
  i1.menu = i1.recipes.slice(0, E.menuSlots(i1));
  for (const r of i1.menu) i1.ratios[r] = 1.0;
  if (i1.menu.length) { E.openShop(i1); }
  /* tick 到打烊时内部会自己调 endDay —— 这里不能再补一次，
     否则第二次 settleContract 返回 null 把结果抹掉（这个坑踩过两次了）。 */
  let gi = 0;
  while (i1.sim && i1.phase === 'open' && gi++ < 6000) E.tick(i1, 1 / 30);
  const cid = i1.contract.id;
  expect('I1c', i1.contractResult && i1.contractResult.id === cid,
    `打烊给出合同结算（${i1.contractResult && (i1.contractResult.ok ? '达成' : '未达成')}）`);
  E.nextDay(i1);
  expect('I1d', i1.contract && i1.contract.id !== cid && i1.contract.done === false,
    `次日换成新合同（${cid} → ${i1.contract && i1.contract.id}）`);

  /* I2 合同的存档清洗必须走白名单 */
  {
    const d1 = E.newGame('normal', 0);
    const dirty = E.sanitizeState(Object.assign({}, JSON.parse(JSON.stringify(d1)), {
      contract: { id: '<img src=x>', done: 'yes' },
      contractLog: ['c_cups', 'evil', 42],
    }));
    expect('I2a', dirty.contract === null, '非法合同 id 被清洗掉');
    expect('I2b', Array.isArray(dirty.contractLog) && dirty.contractLog.every(x => E.contractById(x)),
      'contractLog 只保留白名单内的 id');
    const good = E.sanitizeState(Object.assign({}, JSON.parse(JSON.stringify(d1)),
      { contract: { id: 'c_cups', done: true } }));
    expect('I2c', good.contract && good.contract.id === 'c_cups' && good.contract.done === true,
      '合法合同能往返存档');
  }

  /* I3 营业中两个即时决策：每天各一次，且只在营业中可用 */
  const i3 = E.newGame('normal', 0);
  expect('I3a', E.flashSale(i3).ok === false && E.pullMenu(i3).ok === false,
    '备货阶段不能促销/下架');
  i3.cash = 1e9; E.autoFill(i3);
  i3.menu = i3.recipes.slice(0, E.menuSlots(i3));
  for (const r of i3.menu) i3.ratios[r] = 1.0;
  i3.recipes = i3.recipes.concat(['taro', 'matcha']);
  i3.menu = ['boba', 'taro', 'matcha'];
  E.openShop(i3);
  const saleR = E.flashSale(i3);
  expect('I3b', saleR.ok === true && i3.sim.saleUsed === true, '营业中可触发限时促销');
  expect('I3c', E.flashSale(i3).ok === false, '促销每天只能触发一次');
  expect('I3d', i3.sim.saleCap > i3.sim.traffic, `促销抬高当日客流上限（${i3.sim.traffic} → ${i3.sim.saleCap}）`);
  /* 下架要在**营业中**做：跑满一整天后 phase 已是 report，动作会被正确拒绝 */
  const pullR = E.pullMenu(i3);
  expect('I3f', pullR.ok === true && i3.menu.indexOf(pullR.id) < 0 && !!pullR.name,
    `临时下架生效（下架 ${pullR.name}，今天卖了 ${pullR.sold} 杯）`);
  expect('I3g', E.pullMenu(i3).ok === false, '下架每天只能一次');
  let gj = 0;
  while (i3.sim && i3.phase === 'open' && gj++ < 4000) E.tick(i3, 1 / 30);
  expect('I3e', E.saleActive(i3) === false, '促销到点自动结束');
  const i3b = E.newGame('normal', 0);
  i3b.recipes = ['boba'];
  i3b.menu = ['boba'];
  i3b.cash = 1e9; E.autoFill(i3b); E.openShop(i3b);
  expect('I3h', E.pullMenu(i3b).ok === false, '只剩一款时不能下架（会开不了门）');

  /* I4 每日高光：营业中出现，日报里带出来，最多 3 条 */
  const i4 = E.newGame('normal', 0);
  i4.cash = 1e9; E.autoFill(i4);
  i4.menu = i4.recipes.slice(0, E.menuSlots(i4));
  for (const r of i4.menu) i4.ratios[r] = 1.0;
  E.openShop(i4);
  let gk = 0;
  while (i4.sim && i4.phase === 'open' && gk++ < 6000) {
    E.tick(i4, 1 / 30);
    /* 连点工位制造连击高光 */
    if (i4.sim && i4.sim.stations[0] && i4.sim.stations[0].order && gk % 3 === 0) {
      E.rushStation(i4, 0);
    }
  }
  const hl = (i4.report && i4.report.highlights) || [];
  expect('I4a', Array.isArray(hl) && hl.length > 0, `当天记下了 ${hl.length} 条高光`);
  expect('I4b', hl.length <= 3 && hl.every(x => typeof x.text === 'string' && x.text),
    '高光最多 3 条且都有文案');
  expect('I4c', hl.some(x => x.kind.indexOf('combo') >= 0),
    `连点打出了连击高光（${hl.filter(x => x.kind.indexOf('combo') >= 0).map(x => x.text)[0] || '无'}）`);

  /* I5 策略卡主题共鸣：同主题 2 张 +10%、3 张 +25%，且**只作用于增益键**
   —— 注意 night 的 boost 是 stamina（体力），它的 traffic 0.93 是代价，
     不会跟着共鸣涨；chain 的 boost 是 rent，它压根没有 cogs。
     下面按"哪张卡声明了哪个 boost 键"来断言，而不是笼统地比大小。 */
  {

    const one = (function () { const x = E.newGame('normal', 0); x.cards = ['takeout']; return E.cardMul(x, 'traffic'); })();
    const two = (function () { const x = E.newGame('normal', 0); x.cards = ['takeout', 'night']; return E.cardMul(x, 'traffic'); })();
    /* takeout 的 traffic 是 boost → ×1.10；night 的 traffic 是代价 → 不动 */
    expect('I5a', Math.abs(two - (1.25 * 1.10 * 0.93)) < 0.0001,
      `同主题 2 张 → 增益键 +10%（${one.toFixed(3)} → ${two.toFixed(3)} = 1.25×1.10×0.93）`);
    const three = (function () { const x = E.newGame('normal', 0); x.cards = ['takeout', 'night', 'premium']; return E.cardMul(x, 'traffic'); })();
    /* 第 3 张是溢价主题：它带自己的 traffic 代价 0.92，但引流主题仍是 2 张 */
    expect('I5b', Math.abs(three - (1.25 * 1.10 * 0.93 * 0.92)) < 0.0001,
      `第 3 张属别的主题：只叠它自己的代价，引流倍率仍按 2 张算（${two.toFixed(3)} → ${three.toFixed(3)}）`);
    const cogs3 = (function () { const x = E.newGame('normal', 0); x.cards = ['kitchen', 'bulk', 'chain']; return E.cardMul(x, 'cogs'); })();
    /* kitchen/bulk 的 cogs 是 boost → 各 ×1.25；chain 没有 cogs 这一项 */
    expect('I5c', Math.abs(cogs3 - (0.86 * 1.25 * 0.85 * 1.25)) < 0.0001,
      `同主题 3 张 → 增益键 +25%（cogs=${cogs3.toFixed(4)} = 0.86×1.25×0.85×1.25）`);
    const single = (function () { const x = E.newGame('normal', 0); x.cards = ['takeout']; return E.cardMul(x, 'traffic'); })();
    expect('I5d', Math.abs(single - 1.25) < 0.001, '单张（未达共鸣门槛）不加成');
    /* 代价不跟着涨：加盟模式把每杯收入减 ¥0.6，凑满成本主题也不该变本加厉 */
    const w0 = (function () { const x = E.newGame('normal', 0); x.cards = ['chain']; return E.cardMul(x, 'unitSub'); })();
    const w3 = (function () { const x = E.newGame('normal', 0); x.cards = ['chain', 'kitchen', 'bulk']; return E.cardMul(x, 'unitSub'); })();
    expect('I5e', Math.abs(w0 - w3) < 0.0001, '代价项不参与共鸣（不会因凑主题被反罚）');
  }

  /* I6 主题表与卡表必须一一对应：写了 theme 却没 boost 的卡会让共鸣静默失效 */
  {
    const missing = E.STRATEGY_CARDS.filter(c => !E.CARD_THEMES[c.id]);
    expect('I6a', missing.length === 0,
      missing.length ? `有卡没归主题：${missing.map(c => c.id).join(',')}` : '12 张卡都已归入 4 个主题');
    const noBoost = E.STRATEGY_CARDS.filter(c => !Array.isArray(c.boost) || !c.boost.length);
    expect('I6b', noBoost.length === 0,
      noBoost.length ? `有卡没声明增益键：${noBoost.map(c => c.id).join(',')}` : '每张卡都声明了增益键');
    const badKey = E.STRATEGY_CARDS.filter(c => Array.isArray(c.boost)
      && c.boost.some(k => !c.fx || typeof c.fx[k] !== 'number'));
    expect('I6c', badKey.length === 0,
      badKey.length ? `boost 指向了不存在的 fx 键：${badKey.map(c => c.id).join(',')}` : 'boost 键都对应真实 fx');
  }
}

/* ============================================================
 *  J 组：第二批玩法系统（V5 章节关卡 / V6 招牌配方 / V7 事件型顾客 / V8 结局四维）
 * ============================================================ */
console.log('=============== J. 第二批玩法系统 ===============');
{
  /* ---- J1 章节关卡（V5）---- */
  {
    const s = E.newGame('normal', 0);
    const ch1 = E.chapterStages(s);
    expect('J1a', ch1.length === 3 && ch1.every(x => x.chapter === 1),
      `第 1 章有 3 个关卡（${ch1.map(x => x.name).join('/')}）`);
    expect('J1b', E.chapterOf(s) === 1 && E.currentStage(s) && E.currentStage(s).id === ch1[0].id,
      '新局从第 1 章第 1 关开始');
    /* 章节随天数推进：第 6 天进入第 2 章 */
    s.day = 6;
    expect('J1c', E.chapterOf(s) === 2 && E.chapterStages(s)[0].chapter === 2,
      '第 6 天进入第 2 章');
    s.day = 31;
    /* 章节上限是 6 章（6×5=30 天）。无尽模式继续经营时**复用第 6 章**
       —— 不再往上开新章，否则第 6 章的关卡会永远打不完（一直卡在第 3 关）。 */
    expect('J1d', E.chapterOf(s) === 6 && E.chapterStages(s)[0].chapter === 6,
      '第 31 天仍复用第 6 章（章节数封顶，无尽模式不会开新章）');
    expect('J1d2', E.STAGE_CHAPTERS * E.STAGE_DAYS === E.CFG.DAYS,
      `6 章 × 5 天 = ${E.CFG.DAYS} 天（章节划分正好覆盖一局）`);

    /* 难度档：门槛递增、奖励递增 */
    const s2 = E.newGame('normal', 0);
    const sv = E.stageView(s2);
    expect('J1e', sv.diffs.length === 3
      && sv.diffs[0].goal < sv.diffs[1].goal && sv.diffs[1].goal < sv.diffs[2].goal,
      `三档难度门槛递增（${sv.diffs.map(d => d.goal).join(' < ')}）`);
    expect('J1f', sv.diffs[0].cash < sv.diffs[1].cash && sv.diffs[1].cash < sv.diffs[2].cash,
      `三档难度奖励递增（${sv.diffs.map(d => d.cash).join(' < ')}）`);
    /* 切难度后目标与奖励同步变化 */
    E.setStageDiff(s2, 'legend');
    const sv2 = E.stageView(s2);
    expect('J1g', sv2.cur.goal > sv.cur.goal && sv2.cur.cash > sv.cur.cash,
      `切到传奇档后门槛与奖励都变高（${sv.cur.goal}→${sv2.cur.goal} / ${sv.cur.cash}→${sv2.cur.cash}）`);

    /* 达成 → 发钱 + 记录通关；未达成 → 不发钱、不扣口碑 */
    const s3 = E.newGame('normal', 0);
    s3.day = 1;
    const cashBefore = s3.cash;
    /* 伪造一个必达成的当日：把该关卡指标灌满 */
    const stg = E.currentStage(s3);
    s3.sim = { cups: 9999, orders: 999, revenue: 99999, clicks: 999, lost: 0, trendCups: 999, typeServed: { influencer: 99 } };
    s3.report = { net: 99999, sat: 1 };
    const res = E.settleStage(s3);
    expect('J1h', res && res.ok === true && s3.cash > cashBefore,
      `关卡达成 → 发放奖金（+${res ? Math.round(res.cash) : 0} 元）`);
    expect('J1i', s3.stage && s3.stage.done && s3.stage.done[stg.id] === true,
      '通关的关卡被记录');
    /* 下一关自动成为当前关卡 */
    expect('J1j', E.currentStage(s3).id !== stg.id, '通关后自动推进到下一关');

    /* 失败：没有钱、没有口碑惩罚（这是关卡与合同的关键区别） */
    const s4 = E.newGame('normal', 0);
    s4.day = 1;
    const c4 = s4.cash, r4 = s4.rep;
    s4.sim = { cups: 0, orders: 0, revenue: 0, clicks: 0, lost: 99, trendCups: 0, typeServed: {} };
    s4.report = { net: -100, sat: 0.1 };
    const res4 = E.settleStage(s4);
    expect('J1k', res4 && res4.ok === false && Math.abs(s4.cash - c4) < 0.01,
      '关卡未达成 → 不发钱');
    expect('J1l', Math.abs(s4.rep - r4) < 0.01,
      '关卡未达成 → **不扣口碑**（避免合同违约那种复利死循环）');

    /* 存档清洗：脏的关卡 id / 难度档必须被挡住 */
    const s5 = E.newGame('normal', 0);
    s5.stage = { diff: 'bogus', done: { fake_stage: true, st_cups: true } };
    s5.sig = { boba: 100, fake_recipe: 999 };
    s5.sigRun = { boba: 5, fake_recipe: 7 };
    const clean = E.sanitizeState(s5);
    expect('J1m', clean.stage.diff === 'std' && !clean.stage.done.fake_stage && clean.stage.done.st_cups === true,
      '存档清洗：非法难度档回落到 std，假关卡 id 被丢弃');
    expect('J1n', clean.sig.fake_recipe === undefined && clean.sig.boba === 100
      && clean.sigRun.fake_recipe === undefined && clean.sigRun.boba === 5,
      '存档清洗：招牌进度只认真实配方 id');
  }

  /* ---- J2 招牌配方（V6）---- */
  {
    const s = E.newGame('normal', 0);
    expect('J2a', E.sigCupsOf(s, 'boba') === 0 && E.sigLevelOf(s, 'boba').lv === 0,
      '新局招牌从 0 开始');
    /* 跨局基线：newGame 的第三参带进来的销量立刻生效 */
    const s2 = E.newGame('normal', 0, { boba: 800 });
    expect('J2b', E.sigCupsOf(s2, 'boba') === 800 && E.sigLevelOf(s2, 'boba').lv === 2,
      '跨局基线立刻生效（800 杯 → Lv.2）');
    expect('J2c', E.sigPriceAdd(s2, 'boba') === 1 && E.sigCostCut(s2, 'boba') > 0,
      'Lv.2 给出售价 +¥1 与每杯成本减免');
    /* 未满级的配方没有加成 */
    expect('J2d', E.sigPriceAdd(s, 'boba') === 0 && E.sigSaleMul(s, 'boba') === 1,
      '未成招牌的配方没有任何加成');
    /* 加成确实进了定价与成本 */
    const p0 = E.priceOf(s, 'boba'), p2 = E.priceOf(s2, 'boba');
    expect('J2e', p2 > p0, `招牌售价加成生效（¥${p0} → ¥${p2}）`);
    const c0 = E.costOf(s, 'boba'), c2 = E.costOf(s2, 'boba');
    expect('J2f', c2 < c0, `招牌成本减免生效（¥${c0.toFixed(2)} → ¥${c2.toFixed(2)}）`);
    /* 脏的继承数据（不存在的配方 id）必须被 newGame 挡掉 */
    const s3 = E.newGame('normal', 0, { boba: 100, nope: 500 });
    expect('J2g', s3.sig.nope === undefined && s3.sig.boba === 100,
      '继承数据里不存在的配方 id 被丢弃');
    /* 合并回 META：只加本局新增，不重复累加基线 */
    const m = { sig: { boba: 100 } };
    const s4 = E.newGame('normal', 0, { boba: 100 });
    s4.sigRun = { boba: 30 };
    E.mergeSignature(m, s4);
    expect('J2h', m.sig.boba === 130,
      `合并只加本局新增（100 + 30 = ${m.sig.boba}，不是 100+100+30）`);
    /* 每日挑战不写回（公平性） */
    const m2 = { sig: {} };
    const s5 = E.newGame('normal', 0, null);
    s5.daily = true; s5.sigRun = { boba: 50 };
    E.mergeSignature(m2, s5);
    expect('J2i', !m2.sig.boba, '每日挑战不把招牌进度写回 META（全网同种子要一致）');
  }

  /* ---- J3 事件型顾客（V7）---- */
  {
    /* 特殊顾客必须能被 customerTypeById 查到（completeOrder 靠它取 repMul） */
    expect('J3a', E.SPECIAL_CUSTOMERS.every(t => E.customerTypeById(t.id) === t),
      '3 种特殊顾客都能按 id 查到');
    /* 它们不在常规客群表里 —— 混进去会改变基础客群的权重分布 */
    expect('J3b', E.SPECIAL_CUSTOMERS.every(t => !E.CUSTOMER_TYPES.some(c => c.id === t.id)),
      '特殊顾客不混进常规客群表（客流权重分布不受影响）');
    /* 每天最多 1 位：连续抽 5 次也只能拿到 1 位 */
    const s = E.newGame('normal', 0);
    s.sim = { specialCount: 0, spawned: 0 };
    let got = 0;
    for (let i = 0; i < 5; i++) { if (E.pickSpecialType(s)) got++; }
    expect('J3c', got === 1, `每天最多 1 位特殊顾客（抽 5 次得到 ${got} 位）`);
    /* 1:1 替换：总客流不变（否则 hard 难度会被 +1 位客人抬高 5pp） */
    const s2 = E.newGame('normal', 0);
    s2.menu = ['boba']; s2.ratios.boba = 1; s2.inv = { tea: 999, milk: 999, sugar: 999, pearl: 999, fruit: 999 };
    s2.sim = { specialCount: 0, spawned: 0, queue: [], lost: 0, typeLost: {}, priceLost: 0, floaters: [], typeServed: {}, byRecipe: {} };
    s2.phase = 'open';
    E.spawnCustomer(s2);
    const qn = s2.sim.queue.length;
    expect('J3d', qn === 1, `特殊顾客 1:1 替换常规顾客（队列里 ${qn} 位，总客流不变）`);
    /* 服务特殊顾客给口碑奖励 */
    const s3 = E.newGame('normal', 0);
    s3.sim = { repGain: 0, revenue: 0, orders: 0, cups: 0, trendCups: 0, typeServed: {}, byRecipe: {}, floaters: [], highlights: [] };
    s3.stats = { totalCups: 0, totalRevenue: 0 };
    const before3 = s3.sim.repGain;
    E.completeOrder(s3, { order: { rid: 'boba', cups: 1, price: 20, type: 'critic' } });
    expect('J3e', s3.sim.repGain > before3,
      `服务美食评论家 → 口碑增加（repGain ${before3} → ${s3.sim.repGain.toFixed(2)}）`);
    /* 大单与熟客不扣口碑（repBad = 0）—— 惩罚会连累到产能紧张的难度 */
    expect('J3f', E.SPECIAL_CUSTOMERS.filter(t => t.id !== 'critic').every(t => t.repBad === 0),
      '大单与熟客的 repBad 为 0（不因产能不足而稳定扣口碑）');
  }

  /* ---- J4 结局四维评级（V8）---- */
  {
    const s = E.newGame('normal', 0);
    s.stats = { totalRevenue: 10000, totalProfit: 5000, totalServed: 900, totalLost: 100, totalCups: 2000 };
    s.rep = 85;
    const et = E.endingTitle(s);
    expect('J4a', et.axes.length === 4, '结局有 4 个维度（利润/口碑/服务/经营）');
    const byKey = {};
    for (const a of et.axes) byKey[a.key] = a;
    expect('J4b', byKey.profit.tier === 2 && byKey.rep.tier === 2 && byKey.service.tier === 1,
      `四维评级正确（利润 ${byKey.profit.tier} / 口碑 ${byKey.rep.tier} / 服务 ${byKey.service.tier}）`);
    expect('J4c', !!et.best && et.best.title === byKey.profit.title,
      '综合称号取最高档维度');
    /* 差数据时不该崩，也不该乱给称号 */
    const s2 = E.newGame('normal', 0);
    s2.stats = { totalRevenue: 0, totalProfit: 0, totalServed: 0, totalLost: 0, totalCups: 0 };
    s2.rep = 0;
    const et2 = E.endingTitle(s2);
    expect('J4d', et2.axes.every(a => a.tier === 0 && !a.title),
      '全零数据时四维都没有称号（不虚报）');
    /* 阈值表本身要合法 */
    expect('J4e', E.ENDING_AXES.every(a => a.tiers.length === 2
      && a.tiers[0].need < a.tiers[1].need),
      '每个维度的两档阈值递增');
    /* 经营维度的门槛必须**真的能达到**。
       踩过的坑：早期版本按难度目标归一化（totalCups / (goal/300)），
       normal 下算出「街角名店要 76000 杯」—— 而实测一局才卖 2600 杯，
       这个称号**永远拿不到**，整个维度形同虚设。
       这里锁住「正常发挥的一局能拿到至少一档」。 */
    const s3 = E.newGame('normal', 0);
    s3.stats = { totalRevenue: 30000, totalProfit: 14000, totalServed: 2400, totalLost: 260, totalCups: 2644 };
    s3.rep = 88;
    const et3 = E.endingTitle(s3);
    const sc3 = et3.axes.find(a => a.key === 'scale');
    expect('J4f', sc3 && sc3.tier >= 1,
      `正常发挥（2644 杯）能拿到经营维度的称号（实际 ${sc3 ? sc3.title || '无' : '缺失'}）`);
    /* 门槛也不能低到人人白拿：2600 杯（普通水平）不该直接顶到最高档 */
    expect('J4g', !sc3 || sc3.tier < 2 || sc3.need <= 2644,
      '经营维度最高档不是普通水平就能白拿的');
  }
}

/* ============================================================
 *  K 组：经营维度（场地类型 / 经营城市 / 经营地图位置）
 *
 *  这一组的核心价值是**把校验规则与存量兼容变成可运行的断言** ——
 *  「字段校验」「对已有数据兼容」写成注释不算数，读档跑一遍才算。
 * ============================================================ */
console.log('=============== K. 经营维度 ===============');
{
  /* ---- K0 字典自身要自洽（省市区引用互相对得上）---- */
  {
    const provIds = new Set(E.PROVINCES.map(p => p.id));
    const cityIds = new Set(E.CITIES.map(c => c.id));
    let bad = 0;
    for (const p of E.PROVINCES) for (const cid of p.cities || []) if (!cityIds.has(cid)) bad++;
    /* 每个城市必须恰好被一个省引用，且声明的 prov 与之一致 */
    for (const c of E.CITIES) {
      const owners = E.PROVINCES.filter(p => (p.cities || []).includes(c.id));
      if (owners.length !== 1 || owners[0].id !== c.prov || !provIds.has(c.prov)) bad++;
    }
    for (const cid of Object.keys(E.DISTRICTS || {})) if (!cityIds.has(cid)) bad++;
    expect('K0a', bad === 0, bad ? `字典有 ${bad} 处省市区引用不一致` : `字典自洽（${E.PROVINCES.length} 省 / ${E.CITIES.length} 市）`);
    /* id 唯一性：重复 id 会让按 id 查找返回不确定的那一个 */
    expect('K0b', new Set(E.CITIES.map(c => c.id)).size === E.CITIES.length
      && new Set(E.PROVINCES.map(p => p.id)).size === E.PROVINCES.length
      && new Set(E.VENUE_TYPES.map(v => v.id)).size === E.VENUE_TYPES.length,
      '省 / 市 / 场地类型的 id 均唯一');
    /* 省市区代码形态（GB/T 2260：省 2 位、市 6 位、区 6 位） */
    expect('K0c', E.PROVINCES.every(p => /^\d{2}$/.test(p.id))
      && E.CITIES.every(c => /^\d{6}$/.test(c.id)),
      '省代码 2 位、市代码 6 位（GB/T 2260 形态）');
    /* 默认常量必须指向真实存在的条目。
       踩过的坑：CITIES 改成 6 位后 CITY_DEFAULT 还留着 4 位的 '1101'，
       退默认时 cityById 查不到 → 展示模型 cityName 为空串（K5d 抓到的）。
       这类"常量与数据表形态漂移"只有断言才抓得住，靠肉眼 review 很难发现。 */
    expect('K0c2', !!E.cityById(E.CITY_DEFAULT) && !!E.venueTypeById(E.VENUE_DEFAULT),
      `默认常量指向真实条目（城市 ${E.CITY_DEFAULT} / 场地 ${E.VENUE_DEFAULT}）`);
    expect('K0c3', String(E.CITY_DEFAULT).length === 6,
      '默认城市代码与 CITIES 同为 6 位（形态一致才查得到）');
    /* 城市中心坐标：每一项都必须真的在境内、且能通过引擎校验。
       这里最容易出的错是「占位/写错的值直接被当成合法坐标」——
       玩家点一下「定位当前城市」就会拿到一个假位置，且没有任何报错。
       ⚠️ 这里**不允许 null 占位**：字典里放 null 等于混进假数据，
       断言必须把它当非法项报出来（曾经就留过一条 null 占位，是自己踩的）。 */
    if (E.CITY_CENTERS) {
      const centers = Object.entries(E.CITY_CENTERS);
      const badC = centers.filter(([cid, g]) => {
        if (!g || typeof g.lng !== 'number' || typeof g.lat !== 'number') return true;
        if (!/^\d{6}$/.test(cid)) return true;  /* key 必须是城市代码形态 */
        if (!E.cityById(cid)) return true;       /* key 必须指向真实城市 */
        return !E.normalizeGeo(g);               /* 坐标必须能通过引擎校验（境内 + 有限数） */
      });
      expect('K0c4', badC.length === 0,
        badC.length ? `有 ${badC.length} 个城市中心坐标非法：${badC.map(x => x[0]).join(',')}`
          : `${centers.length} 个城市中心坐标全部合法（且 key 都指向真实城市）`);
    }
    /* 「定位当前城市」必须是**可选**动作：没有中心坐标的城市要明确拒绝，
       而不是写一个假坐标 —— 假坐标会让门店看起来"已经定位在某处"。 */
    {
      const sc0 = E.newGame('normal', 0);
      sc0.venue.cityId = '110100';
      expect('K0c5', E.setGeoToCityCenter(sc0).ok === true
        && sc0.venue.coordSys === E.GEO.COORD_SYS,
        '定位当前城市：已收录的城市能写入 GCJ-02 坐标');
      const sc1 = E.newGame('normal', 0);
      sc1.venue.cityId = '999999';   /* 不存在的城市 */
      expect('K0c6', E.setGeoToCityCenter(sc1).ok === false && sc1.venue.lng === undefined,
        '定位当前城市：城市无效时拒绝，且不写脏坐标');
    }
    /* 中国大陆限定：不含境外 */
    expect('K0d', E.PROVINCES.every(p => !/美国|日本|韩国|新加坡|伦敦|纽约/.test(p.name)),
      '省市字典仅含中国大陆（含台港澳），不含境外地区');
  }

  /* ---- K1 场地类型校验（可配置扩展的白名单语义）---- */
  {
    const s = E.newGame('normal', 0);
    const r1 = E.setVenueType(s, 'office');
    expect('K1a', r1.ok && s.venue.type === 'office', '合法场地类型可设置（写字楼）');
    const r2 = E.setVenueType(s, 'no_such_type');
    expect('K1b', !r2.ok && s.venue.type === 'office',
      '字典外的场地类型被拒绝，且**不改动原值**（不静默回退）');
    /* 扩展性：字典里每一项都应当能直接用（新增一行就能用，无需改逻辑） */
    expect('K1c', E.VENUE_TYPES.every(t => E.setVenueType(s, t.id).ok && s.venue.type === t.id),
      `全部 ${E.VENUE_TYPES.length} 种场地类型均可直接选用（新增类型无需改逻辑）`);
  }

  /* ---- K2 城市三级选择校验 ---- */
  {
    const s = E.newGame('normal', 0);
    const r1 = E.setVenueCity(s, '440300', '440305');
    expect('K2a', r1.ok && s.venue.cityId === '440300' && s.venue.districtId === '440305',
      '深圳市 + 南山区：三级联动可设置');
    /* 区前缀必须匹配城市（否则「市=北京 区=深圳区」会静默通过，三级联动显示不出来） */
    expect('K2b', !E.setVenueCity(s, '110100', '440305').ok,
      '区前缀与城市不匹配 → 拒绝');
    expect('K2c', !E.setVenueCity(s, '999900').ok, '不存在的城市 → 拒绝');
    expect('K2d', !E.setVenueCity(s, '110100', '123').ok, '区代码非 6 位 → 拒绝');
    /* 区级可选 */
    const r5 = E.setVenueCity(s, '110100', '');
    expect('K2e', r5.ok && s.venue.districtId === undefined,
      '区级可留空（只选到市级）');
    /* 未收录区级的城市应能降级而不是报错 */
    const r6 = E.setVenueCity(s, '442000');
    expect('K2f', r6.ok && E.districtsOfCity('442000').length === 0,
      '未收录区级的城市仍可选中（UI 降级为仅到市级）');
    /* 未收录区级时「切区」必须**明确拒绝**，而不是静默改成某个区
       —— 否则玩家点了按钮看到区名没变，会以为按钮坏了。 */
    const s2b = E.newGame('normal', 0);
    E.setVenueCity(s2b, '442000');
    const r6b = E.nextDistrict(s2b);
    expect('K2f2', !r6b.ok && !!r6b.msg,
      `未收录区级的城市切区 → 明确报错（${r6b.msg || '无提示'}）`);
    /* 换城市必须清掉旧坐标，否则会出现「深圳坐标 + 北京城市」的自相矛盾 */
    E.setGeo(s, { lng: 114.057868, lat: 22.543099 }, '440300');
    expect('K2g', s.venue.lng !== undefined, '先给深圳设坐标');
    E.setVenueCity(s, '110100');
    expect('K2h', s.venue.lng === undefined, '换城市后旧坐标被清掉（防自相矛盾）');
  }

  /* ---- K3 地图坐标校验（GCJ-02 + 境内范围）---- */
  {
    const s = E.newGame('normal', 0);
    expect('K3a', E.setGeo(s, { lng: 114.057868, lat: 22.543099 }, '440300').ok,
      '深圳坐标（GCJ-02）可设置');
    expect('K3b', E.setGeo(s, { lng: 116.397428, lat: 39.90923 }, '110100').ok,
      '北京坐标可设置');
    /* 境外：Sydney 必须被拦下 */
    expect('K3c', !E.setGeo(s, { lng: -33.8688, lat: 151.2093 }).ok,
      '境外坐标（悉尼）被拒绝');
    expect('K3d', !E.setGeo(s, { lng: 0, lat: 0 }).ok, '(0,0) 公海被拒绝');
    expect('K3e', !E.setGeo(s, { lng: 139.6917, lat: 35.6895 }).ok,
      '境外坐标（东京）被拒绝');
    /* NaN / Infinity 是最阴的一类：与任何值比较都是 false，会一路穿过去 */
    expect('K3f', !E.setGeo(s, { lng: NaN, lat: 39 }).ok
      && !E.setGeo(s, { lng: 116, lat: NaN }).ok,
      'NaN 坐标被拒绝（NaN 的范围比较恒为 false，必须单独挡）');
    expect('K3g', !E.setGeo(s, { lng: Infinity, lat: 39 }).ok
      && !E.setGeo(s, { lng: 116, lat: -Infinity }).ok,
      'Infinity 坐标被拒绝');
    expect('K3h', !E.setGeo(s, { lng: 'abc', lat: 'xyz' }).ok,
      '字符串非数字被拒绝');
    expect('K3i', !E.setGeo(s, {}).ok && !E.setGeo(s, null).ok,
      '缺字段 / null 被拒绝');
    /* 坐标系标识必须显式存下来 —— 这是「三种坐标系不可混用」的唯一保障 */
    const ok = E.setGeo(s, { lng: 114.0578681, lat: 22.5430999 }, '440300');
    expect('K3j', ok.ok && s.venue.coordSys === E.GEO.COORD_SYS,
      `坐标带坐标系标识（${E.GEO.COORD_SYS}）`);
    expect('K3k', s.venue.lng === 114.057868,
      `经度按 ${E.GEO.PRECISION} 位取整（${s.venue.lng}，超出部分是 GPS 噪声不是精度）`);
    expect('K3l', E.clearGeo(s).ok && s.venue.lng === undefined,
      '可清除坐标回到「未选点」');
    /* 未选点不是 (0,0)，也不是编造一个默认位置 */
    expect('K3m', E.venueView(s).hasGeo === false && E.venueView(s).geo === null,
      '未选点时 geo 为 null（不用 0,0 或默认天安门冒充真实经营地）');
  }

  /* ---- K4 存量数据兼容（本组最重要）---- */
  {
    /* ① 老存档：完全没有 venue 字段（早于本特性） */
    const legacy = E.newGame('normal', 0);
    delete legacy.venue;
    const r1 = E.sanitizeState(JSON.parse(JSON.stringify(legacy)));
    expect('K4a', r1.venue && r1.venue.type === E.VENUE_DEFAULT,
      `老存档（无 venue 字段）→ 补默认场地（${E.VENUE_DEFAULT}）`);
    expect('K4b', r1.venue.cityId === E.CITY_DEFAULT && r1.venue.provId === '11',
      '老存档 → 补默认城市（北京）');
    expect('K4c', r1.venue.lng === undefined && r1.venue.lat === undefined,
      '老存档 → 坐标留空，不编造默认位置');

    /* ② 脏存档：字典外 id + 越界坐标 */
    const dirty = E.newGame('normal', 0);
    dirty.venue = { type: '不存在的类型', provId: '11', cityId: '9999', lng: 999, lat: -500 };
    const r2 = E.sanitizeState(dirty);
    expect('K4d', r2.venue.type === E.VENUE_DEFAULT, '脏存档：非法场地类型 → 退默认');
    expect('K4e', r2.venue.cityId === E.CITY_DEFAULT, '脏存档：非法城市 → 退默认');
    expect('K4f', r2.venue.lng === undefined, '脏存档：越界坐标 → 丢弃');

    /* ③ 省市区错配：省=北京 / 市=深圳。
       城市比省更具体（一个城市只属于一个省），所以**以城市为准**、
       用城市反查省 —— 比整条退默认更精准，用户的数据不白丢。
       关键是最终结果**不会自相矛盾**（不会出现"省=北京 市=深圳"）。 */
    const mis = E.newGame('normal', 0);
    mis.venue = { type: 'mall', provId: '11', cityId: '440300' };
    const rMis = E.sanitizeState(mis);
    expect('K4g', rMis.venue.provId === '44' && rMis.venue.cityId === '440300',
      '脏存档：省市区错配 → 以城市为准并反查省（不留下自相矛盾的组合，也不白丢城市）');

    /* ④ 半截字段：只有城市没有省（老版本可能只存了其中一个） */
    const half = E.newGame('normal', 0);
    half.venue = { type: 'scenic', cityId: '310100' };
    const r4 = E.sanitizeState(half);
    expect('K4h', r4.venue.provId === '31' && r4.venue.cityId === '310100',
      '脏存档：只有城市没有省 → 用城市反查省并补齐（不必整条退默认）');

    /* ⑤ 区级前���合法但城市不同 → 丢弃区级，省市保留 */
    const badD = E.newGame('normal', 0);
    badD.venue = { type: 'campus', provId: '11', cityId: '110100', districtId: '440305' };
    const r5 = E.sanitizeState(badD);
    expect('K4i', r5.venue.districtId === undefined && r5.venue.cityId === '110100',
      '脏存档：区级与城市不匹配 → 只丢区级，省市保留');

    /* ⑥ 存档往返：清洗后的结果再存再读，必须稳定（幂等） */
    const rt = E.sanitizeState(dirty);
    const rt2 = E.sanitizeState(JSON.parse(JSON.stringify(rt)));
    expect('K4j', JSON.stringify(rt.venue) === JSON.stringify(rt2.venue),
      '清洗是幂等的：存档往返后经营维度不变（不会每次读档都漂移）');

    /* ⑦ 存量存档必须仍能通过导入校验（v 号不变，不为新特性升版本） */
    const legacyJson = JSON.parse(JSON.stringify(legacy));
    expect('K4k', legacyJson.v === 2, '老存档的版本号仍是 v2（不因新特性升版本，否则存量直接失效）');
    expect('K4l', E.sanitizeState(legacyJson) !== null,
      '老存档清洗后仍可用（不会被判为损坏）');
  }

  /* ---- K5 展示模型：UI 拿到的必须是已收敛的数据 ---- */
  {
    const s = E.newGame('normal', 0);
    E.setVenueType(s, 'station');
    E.setVenueCity(s, '440300', '440305');
    E.setGeo(s, { lng: 114.057868, lat: 22.543099 }, '440300');
    const v = E.venueView(s);
    expect('K5a', v.typeName === '交通枢纽' && v.typeEmoji === '🚉',
      `展示模型带场地名称（${v.typeName}）`);
    expect('K5b', v.provName === '广东省' && v.cityName === '深圳市' && v.districtName === '南山区',
      '展示模型带省/市/区全名（广东省 / 深圳市 / 南山区）');
    expect('K5c', v.hasGeo && v.geo.coordSys === E.GEO.COORD_SYS,
      '展示模型带坐标与坐标系');
    /* 脏值不能让 UI 拿到 undefined 名称 */
    const bad = E.newGame('normal', 0);
    bad.venue = { type: 'x', provId: '99', cityId: '99', districtId: '999999' };
    const bv = E.venueView(E.sanitizeState(bad));
    expect('K5d', !!bv.typeName && !!bv.cityName && bv.districtId === null,
      '脏存档经清洗后，展示模型仍有可显示的名称（UI 不会出现 undefined）');
  }
}

/* ============================================================
 *  L 组：菜系与制作工坊（V9）
 *
 *  核心价值：把这一轮踩过的坑**变成会失败的断言**，而不是注释里的教训。
 *  凡是"实测证明是错的"设计，都在这里留下一条守卫 ——
 *  将来谁再想把工坊改回硬约束/低收益，探针会立刻拦下。
 * ============================================================ */
console.log('=============== L. 菜系与制作工坊 ===============');
{
  /* ---- L0 数据自洽 ---- */
  {
    const csIds = new Set(E.CUISINES.map(c => c.id));
    const wsIds = new Set(E.CRAFT_WORKSHOPS.map(w => w.id));
    expect('L0a', E.CRAFT_WORKSHOPS.length === E.CUISINES.length
      && E.CRAFT_WORKSHOPS.every(w => csIds.has(w.id)),
      `每个菜系都有一条制作工坊（${E.CRAFT_WORKSHOPS.length} 条）`);
    /* 每条工坊的收益数组长度必须与造价阶梯一致 ——
       不一致会让「是否满级」和「Lv.N 收益」都读错，是静默的数值错位。 */
    const bad = E.CRAFT_WORKSHOPS.filter(w => !w.saleBonus || !w.costCut
      || w.saleBonus.length !== w.cost.length || w.costCut.length !== w.cost.length);
    expect('L0b', bad.length === 0,
      bad.length ? `收益数组长度与造价阶梯不一致：${bad.map(w => w.id).join(',')}`
        : '每条工坊的 saleBonus / costCut 长度都与造价阶梯一致');
    /* 每款配方必须归属一个真实菜系（否则既拿不到工坊收益，也进不了研发分组） */
    const orphan = E.RECIPES.filter(r => !r.cuisine || !csIds.has(r.cuisine));
    expect('L0c', orphan.length === 0,
      orphan.length ? `${orphan.length} 款配方没有有效菜系归属` : `${E.RECIPES.length} 款配方全部归属有效菜系`);
    /* 每个菜系至少要有一款配方，否则工坊开了也没东西可做 */
    const empty = E.CUISINES.filter(c => !E.RECIPES.some(r => r.cuisine === c.id));
    expect('L0d', empty.length === 0,
      empty.length ? `${empty.map(c => c.name).join(',')} 没有任何配方` : '每个菜系都有配方');
    /* 售价要盖得住降本后的成本，否则满级工坊反而是亏的 */
    const s0 = E.newGame('normal', 0);
    const thin = [];
    for (const w of E.CRAFT_WORKSHOPS) {
      s0.workshops[w.id] = w.cost.length - 1;
      for (const r of E.RECIPES.filter(x => x.cuisine === w.id)) {
        if (E.priceOf(s0, r.id) <= E.costOf(s0, r.id) * 1.5) thin.push(r.name);
      }
    }
    expect('L0e', thin.length === 0,
      thin.length ? `满级降本后毛利过薄：${thin.join(',')}` : '满级工坊下每款配方毛利仍健康');
  }

  /* ---- L1 工坊是「加成」而不是「门票」——
     这一条守的是这一轮最贵的教训：曾把高端款设成"没工坊不能做"，
     结果 6 款 tier3 配方解锁率 19/20 → 0/20，整张配方表被锁死。 ---- */
  {
    /* 无工坊时也要能研发，所以现金/库存都要给足——
       否则测的是"钱不够"，把真正的约束（工坊门槛）盖住了。 */
    const s = E.newGame('normal', 0);
    s.cash = 9999999;
    for (const g of E.ING) s.inv[g.id] = 9999;
    s.workshops = {};
    const t3 = E.RECIPES.filter(r => r.tier >= 3 && r.research);
    const blocked = t3.filter(r => !E.canResearch(s, r.id).ok);
    expect('L1a', blocked.length === 0,
      blocked.length
        ? `无工坊时这些高端款不能研发（${blocked.map(r => r.name).join(',')}）—— 工坊成了门票`
        : `无工坊时 ${t3.length} 款高端配方仍可研发（工坊只是加成）`);
    /* 同理：无工坊时配方依然能上架 */
    const s2 = E.newGame('normal', 0);
    s2.workshops = {};
    const notList = E.RECIPES.filter(r => !E.canListRecipe(s2, r.id).ok);
    expect('L1b', notList.length === 0,
      notList.length ? `${notList.length} 款配方在无工坊时无法上架` : '无工坊时所有配方仍可上架');
    /* 满级工坊的第三层收益应该是**加成**，且只对高端款生效。
       等级上限不能写死3，要跟造价阶梯走 —— 工坊等级数是可调的。 */
    const s3 = E.newGame('normal', 0);
    const hi = E.RECIPES.find(r => r.tier >= 3 && r.cuisine);
    const lo = E.RECIPES.find(r => r.tier < 3 && r.cuisine !== hi.cuisine);
    s3.workshops[hi.cuisine] = E.CRAFT_WORKSHOPS.find(w => w.id === hi.cuisine).cost.length - 1;
    expect('L1c', E.workshopTier3Bonus(s3, hi.id) > 0,
      `旗舰工坊让高端款更抢手（+${Math.round(E.workshopTier3Bonus(s3, hi.id) * 100)}%）`);
    expect('L1d', E.workshopTier3Bonus(s3, lo.id) === 0,
      '旗舰加成不外溢到非高端款（否则等于白送一档权重）');
  }

  /* ---- L2 降本必须真的落到"少扣料"上 ----
     踩过的坑：只把 costOf 调低、cogs 仍走原值 —— 菜单毛利数字变好看了，
     结算时库存照扣钱照花，降本成了纸面收益。 ---- */
  {
    /* 必须在**满级**工坊下测，且库存要备足：
       否则测到的是"库存不足扣成 0"，看起来像是降本生效了。 */
    const rid = E.RECIPES.find(r => r.cuisine && r.req);
    const maxLv = E.CRAFT_WORKSHOPS.find(w => w.id === rid.cuisine).cost.length - 1;

    const noWs = E.newGame('normal', 0);
    noWs.workshops = {};
    for (const g of E.ING) noWs.inv[g.id] = 999;
    const costNoWs = E.costOf(noWs, rid.id);
    const inv0 = Object.assign({}, noWs.inv);
    E.consumeStock(noWs, rid.id, null);
    const usedNoWs = Object.keys(inv0).reduce((a, k) => a + inv0[k] - noWs.inv[k], 0);

    const s = E.newGame('normal', 0);
    s.workshops[rid.cuisine] = maxLv;
    for (const g of E.ING) s.inv[g.id] = 999;
    const costWs = E.costOf(s, rid.id);
    const inv1 = Object.assign({}, s.inv);
    const res = E.consumeStock(s, rid.id, null);
    const usedWs = Object.keys(inv1).reduce((a, k) => a + inv1[k] - s.inv[k], 0);
    const reqTotal = Object.values(rid.req).reduce((a, b) => a + b, 0);

    expect('L2a', costWs < costNoWs && res < costNoWs + 0.01,
      `满级降本后单杯成本更低（无工坊 ¥${costNoWs.toFixed(2)} → 满级 ¥${costWs.toFixed(2)}）`);
    /* 扣的料必须比无工坊时少，否则降本没落到真实扣料上 */
    expect('L2b', usedWs < usedNoWs,
      `降本真实扣料（无工坊扣 ${usedNoWs} 份 → 满级扣 ${usedWs} 份，配方需 ${reqTotal} 份）`);
    /* 备货口径必须与扣料一致，否则会"买一样的料、扣得更少"→ 库存积压 */
    const reqWs = E.reqOf(s, rid.id);
    const reqTotalWs = Object.values(reqWs).reduce((a, b) => a + b, 0);
    expect('L2c', Math.abs(reqTotalWs - usedWs) < 1e-6,
      `reqOf（备货/库存校验口径）与 consumeStock 同源（reqOf ${reqTotalWs} 份 vs 实扣 ${usedWs} 份）`);
  }

  /* ---- L3 造价不能高到开不起第一条线（hard 开局现金只有 ¥520）---- */
  {
    const hardCash = E.DIFFICULTY.hard.cash;
    const cheapest = Math.min(...E.CRAFT_WORKSHOPS.map(w => w.cost[1]));
    expect('L3a', cheapest <= hardCash * 0.7,
      `最便宜工坊 ¥${cheapest} ≤ hard 开局现金 ¥${hardCash} 的 70%（掏得出来）`);
    /* 造价必须随等级递增，否则升级没有决策感 */
    const mono = E.CRAFT_WORKSHOPS.every(w =>
      w.cost.every((v, i) => i === 0 || v > w.cost[i - 1]));
    expect('L3b', mono, '每条工坊的造价逐级递增');
    /* 收益也必须递增，否则升了没意义 */
    const gainMono = E.CRAFT_WORKSHOPS.every(w =>
      w.costCut.every((v, i) => i === 0 || v > w.costCut[i - 1])
      && w.saleBonus.every((v, i) => i === 0 || v > w.saleBonus[i - 1]));
    expect('L3c', gainMono, '每条工坊的降本 / 权重收益逐级递增');
    /* 满级工坊的收益不能弱于 Lv1，否则升满级没意义 */
    const maxOk = E.CRAFT_WORKSHOPS.every(w =>
      w.costCut[w.costCut.length - 1] > w.costCut[1]
      && w.saleBonus[w.saleBonus.length - 1] > w.saleBonus[1]);
    expect('L3d', maxOk, '满级工坊收益严格优于 Lv.1（有升满的动力）');
  }

  /* ---- L4 存量兼容：老存档没有这些字段时必须能跑 ---- */
  {
    /* ① 老存档完全没有 venue / workshops */
    const legacy = E.newGame('normal', 0);
    delete legacy.workshops;
    const s1 = E.sanitizeState(JSON.parse(JSON.stringify(legacy)));
    expect('L4a', s1 && s1.workshops && E.workshopLevel(s1, 'classic') >= 1,
      '老存档无 workshops 时补回赠送工坊（不会开局就卡死）');
    /* ② 菜单里有某系配方却没有该系工坊 → 按菜单反推补上
       （这一条是存量兼容的关键：老玩家早就解锁了 fruit 配方，
         若不补工坊，那条线的降本/权重收益永远拿不到） */
    const s2 = E.newGame('normal', 0);
    s2.workshops = { classic: 1 };
    s2.recipes = ['boba', 'passion', 'coco'];        /*含 fruit / coffee */
    s2.menu = ['boba', 'passion', 'coco'];
    const s3 = E.sanitizeState(JSON.parse(JSON.stringify(s2)));
    const revived = ['fruit', 'coffee'].filter(c => E.workshopLevel(s3, c) >= 1);
    expect('L4b', revived.length === 2,
      `老存档菜单里的菜系自动补工坊（补上：${revived.join(',') || '无'}）`);
    /* ③ 脏等级：负数 / 超上限 / 非数字 */
    const s4 = E.newGame('normal', 0);
    s4.workshops = { fruit: -5, coffee: 99, matcha: 'x' };
    const s5 = E.sanitizeState(JSON.parse(JSON.stringify(s4)));
    const clean = E.CRAFT_WORKSHOPS.every(w => {
      const lv = E.workshopLevel(s5, w.id);
      return Number.isInteger(lv) && lv >= 0 && lv <= w.cost.length - 1;
    });
    expect('L4c', clean, '脏工坊等级（负数/超上限/非数字）被清洗到合法区间');
    /* ④ 幂等：清洗两次结果一致（否则每次读档都会漂移）。
       比**键序无关**的规范化形式 —— 清洗会按 CUISINES 顺序重建对象，
       第二次清洗的键序与第一次可能不同，但内容必须完全一样。
       直接比 JSON.stringify 会因为键序不同而误报。 */
    const norm = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
    const once = norm(E.sanitizeState(JSON.parse(JSON.stringify(s4))).workshops);
    const twice = norm(E.sanitizeState(E.sanitizeState(JSON.parse(JSON.stringify(s4)))).workshops);
    expect('L4d', once === twice, `工坊清洗是幂等的（${once}）`);
    /* ⑤ 存档版本号不能变（升版本会让所有老存档走降级提示/被判损坏） */
    const fresh = E.newGame('normal', 0);
    expect('L4e', fresh && fresh.v === 2, `新存档版本号仍是 v2（实际 v${fresh && fresh.v}）`);
  }

  /* ---- L5 展示模型：菜系分组视图要给 UI 足够的决策信息 ---- */
  {
    const s = E.newGame('normal', 0);
    s.recipes = ['boba', 'passion', 'coco'];
    s.menu = ['boba', 'passion'];
    const views = E.cuisineViews(s);
    expect('L5a', views.length === E.CUISINES.length && views.every(v => !!v.name),
      '每个菜系都有展示视图（含名称）');
    const fruit = views.find(v => v.id === 'fruit');
    expect('L5b', fruit && fruit.total > 0 && fruit.unlocked >= 0
      && fruit.cost > 0 && fruit.maxLevel > 0,
      '视图带出「总配方数 / 已解锁 / 当前造价 / 满级数」，玩家能判断值不值得开');
    /* 主打加成要能算出来（深度流 vs 广度流的取舍线） */
    expect('L5c', typeof E.cuisineFocusBonus(s, 'fruit').bonus === 'number',
      '菜系主打加成可计算（深度/广度两条取舍线都成立）');
  }
}

console.log('');
if (fails === 0) console.log(`✅ 引擎探针全部通过（${checks} 项）`);
else console.log(`❌ 探针发现 ${fails} 个问题 / 共 ${checks} 项`);
process.exit(fails === 0 ? 0 : 1);
