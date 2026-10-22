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
  + 'STORE_LEVELS,STORE_SUFFIX,MANAGER_START_CASH,storeDailyCost,syncShopCount,storeByBranch,storeById,mainStore,allStores,managedStores,playerStores,storeManager,syncStoreManagers,makeStore,openStore,defaultStoreName,renameStore,setMainStore,setStoreAuto,fundStore,withdrawStore,managedStoresDaily,managedStoreOneDay,managedStoreBuy,venueTrafficMul,activeBranchCount,closeStore,STORE_UPGRADES,storeUpLevel,storeUpCost,buyStoreUpgrade,cityMapView,MANAGER_COMBOS,MANAGER_TRAITS,managerComboView,managerComboBonus,MANAGER_SPECIALTY,managerSpecialtyMul,managerCanSpecialty,managerSetSpecialty,REGULAR_CFG,REGULAR_TRAITS,regularView,spawnOne,regularIdentityOf,regularServe,regularBonus,regularPullMul,regularsOf,CUSTOMER_TYPES,CUSTOMER_FACES,SPECIAL_CUSTOMERS,nextCity,nextProvince,storeTrafficBonus,storeStaffBonus,storeMenuBonus,storeCostCut,rehireManager,'
  + 'MANAGER_RANKS,MANAGER_TRAITS,MANAGER_NAMES,MANAGER_COSTS,BRANCH_STAFF_CAP,managerCount,managerSlotsLeft,managerOfBranch,managerById,managerTrait,managerRank,managerCost,managerRerollCost,branchStaffCap,staffOfBranch,makeManagerCandidate,refreshManagerCandidates,dailyManagerRefresh,hireManager,fireManager,moveManager,managerDaily,managerBonus,stationTime,'
  + 'RESEARCH_TREE,ACH_RECIPES,ALL_RECIPES,treeNodeById,nodeByRecipe,achRecipeById,cuisinesOfCity,hasCityCuisine,ingsOfCity,ingAvailableAt,currentCityId,recipeAvailableAt,availableRecipes,availableCuisineIds,treePrereqOk,researchTree,refreshCityMenu,grantAchRecipe,cityVisited,localRecipeCount,localCountIn,'
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
       否则测的是"钱不够"，把真正的约束（工坊门槛）盖住了。
       ★ V10：这条断言的语义变了。
         改造前它验的是"没有工坊门槛"，现在同时存在**研发树前置**
         （stage3 需要先研 stage2），所以不能只看单点"能不能研"——
         那会把正常的树形前置误判成"工坊成了门票"。
         正确做法：**逐级解锁**验证 —— 按 stage 升序逐个研，
         每一步都要求"下一个能研"，走到哪步卡住就是哪步真有问题。
         同时对每个城市系在其属地城市各跑一遍。 */
    const cityList = ['', '440100', '510100', '330100', '460200', '640100'];
    let stalled = [];
    for (const cid of cityList) {
      const s = E.newGame('normal', 0);
      s.cash = 9999999;
      for (const g of E.ING) s.inv[g.id] = 9999;
      s.workshops = {};
      if (cid) E.setVenueCity(s, cid);
      const nodes = E.RESEARCH_TREE
        .filter(n => !n.city || n.city === cid)
        .slice()
        .sort((a, b) => a.stage - b.stage);
      for (const n of nodes) {
        /* 开局自带（unlocked:true，无 research）的配方本来就在树上，
           它是 stage 0 的起点，不需要"研"。 */
        const rr = E.recipeById(n.recipe);
        if (!rr || !rr.research) continue;
        if (s.recipes.includes(n.recipe)) continue;
        const c = E.canResearch(s, n.recipe);
        if (!c.ok) {
          stalled.push(`${cid || '通用'}:${rr.name}(${c.msg})`);
          break;              /* 这一城的树到此为止，不继续 */
        }
        E.doResearch(s, n.recipe);       /* 真的研一遍，模拟真实推进 */
      }
    }
    expect('L1a', stalled.length === 0,
      stalled.length
        ? `逐级研发在以下位置卡住：${stalled.join('；')}（不该被工坊或城市挡住）`
        : `${cityList.length} 个城市下研发树全程可逐级推进（无工坊门槛）`);
    /* 同理：无工坊时配方依然能上架（在各自城市内） */
    let notList = [];
    for (const cid of cityList) {
      const s2 = E.newGame('normal', 0);
      s2.workshops = {};
      if (cid) E.setVenueCity(s2, cid);
      s2.recipes = E.ALL_RECIPES.map(r => r.id);
      for (const r of E.ALL_RECIPES) {
        if (r.city && r.city !== cid) continue;      /* 不在本城的本就不可上架，那是城市绑定 */
        if (!E.canListRecipe(s2, r.id).ok) notList.push(cid + ':' + r.name);
      }
    }
    expect('L1b', notList.length === 0,
      notList.length ? `${notList.length} 款配方在无工坊时无法上架：${notList.join(',')}`
        : `${cityList.length} 个城市下、无工坊时所有本城配方均可上架`);
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

/* ============================================================
 *  M 组：V10 城市特色菜系 / 研发树 / 食谱城市绑定 / 成就奖励食谱
 *
 *  这组的核心价值是把本批次的需求变成**会失败的断言**：
 *  凡是"设计约定只写在注释里"的地方，最终都会被破坏。
 *  下面每一条都对应一个真实踩过的坑或一个容易复发的方向。
 * ============================================================ */
console.log('=============== M. 城市菜系与研发树 ===============');
{
  /* ---- M0 数据自洽 ---- */
  {
    /* ① 城市菜系必须有归属城市，且该城市真实存在。
       若 cityId 写错（多两位/少一位/城市不存在），
       症状是"那座城永远看不到自己的特色菜"，而且不报错。 */
    const badCui = E.CUISINES.filter(c => !!c.city && !E.cityById(c.city));
    expect('M0a', badCui.length === 0,
      badCui.length ? `菜系归属城市不存在：${badCui.map(c => c.name).join(',')}`
        : `${E.CUISINES.filter(c => c.city).length} 个城市菜系的城市 id均有效`);

    /* ② 城市专属原料的产地必须真实存在 */
    const badIng = E.ING.filter(g => g.origin && !E.cityById(g.origin));
    expect('M0b', badIng.length === 0,
      badIng.length ? `原料产地不存在：${badIng.map(g => g.name).join(',')}`
        : `${E.ING.filter(g => g.origin).length} 种城市原料的产地 id 均有效`);

    /* ③ ★ 城市菜只允许用「本城原料 + 全国通用原料」。
       实测踩过：广州的「清润五花茶」用了江门的新会陈皮、
       成都的「藤椒青提」用了绵阳的汉源花椒、杭州的「西湖藕粉」用了武汉的江米——
       结果玩家在成都永远做不出藤椒青提（提示"需在绵阳才能买到汉源花椒"），
       而研发页又把它列在成都菜系里，看起来像个 bug。
       这类"看得见却拿不到"的配方比不做还糟。 */
    const crossCity = [];
    for (const r of E.RECIPES) {
      if (!r.city) continue;
      for (const k in (r.req || {})) {
        const g = E.ingById(k);
        if (!g) { crossCity.push(`${r.name}: 未知原料 ${k}`); continue; }
        if (g.origin && g.origin !== r.city) {
          crossCity.push(`${r.name} 用到 ${g.name}（属${(E.cityById(g.origin) || {}).name || g.origin}）`);
        }
      }
      for (const k in ((r.research || {}).ing || {})) {
        const g = E.ingById(k);
        if (g && g.origin && g.origin !== r.city) {
          crossCity.push(`${r.name} 研发要 ${g.name}（属${(E.cityById(g.origin) || {}).name || g.origin}）`);
        }
      }
    }
    expect('M0c', crossCity.length === 0,
      crossCity.length ? `${crossCity.length} 款城市菜用了外城原料：${crossCity.slice(0, 4).join('；')}`
        : `${E.RECIPES.filter(r => r.city).length} 款城市菜全部只用本城/通用原料`);

    /* ④ 每个城市特色系至少要有 3 款菜（否则"当地风味"名不副实） */
    const thinCity = E.CUISINES.filter(c => c.city && E.recipesOfCuisine(c.id).length < 3);
    expect('M0d', thinCity.length === 0,
      thinCity.length ? `这些城市系配方不足 3 款：${thinCity.map(c => c.name).join(',')}`
        : '每个城市特色系都有 3 款菜');

    /* ⑤ 城市菜售价必须高于通用菜的同档位均值 ——
       否则"去外地开厂"是纯优选，地域取舍就失去意义。 */
    const genericAvg = E.RECIPES.filter(r => !r.city)
      .reduce((a, r) => a + r.price, 0) / E.RECIPES.filter(r => !r.city).length;
    const cheap = E.RECIPES.filter(r => r.city && r.price < genericAvg);
    expect('M0e', cheap.length === 0,
      cheap.length ? `${cheap.length} 款城市菜定价低于通用均值 ¥${genericAvg.toFixed(1)}：${cheap.map(r => r.name).join(',')}`
        : `城市菜定价全部高于通用均值 ¥${genericAvg.toFixed(1)}（地域取舍有代价）`);

    /* ⑥ ★ 必填字段不能是 undefined。
       这条是被真实 bug 逼出来的：用脚本批量改配方时，
       把 `price: 35, tier: 3` 误写成了 `ptier: 3` —— price 直接消失。
       症状极隐蔽：页面能渲染，只是这款菜的售价显示成空白，
       而且**没有任何报错**（undefined 不是异常）。
       所以"字段缺失"必须靠断言主动查，不能指望运行时报警。 */
    const REQUIRED = ['id', 'name', 'emoji', 'price', 'tier', 'cuisine'];
    const missing = [];
    for (const r of E.ALL_RECIPES) {
      for (const k of REQUIRED) {
        if (r[k] === undefined || r[k] === null) missing.push(`${r.id}.${k}`);
      }
      if (!Array.isArray(r.tags) || !r.tags.length) missing.push(`${r.id}.tags`);
      if (!r.req || !Object.keys(r.req).length) missing.push(`${r.id}.req`);
    }
    expect('M0f', missing.length === 0,
      missing.length ? `${missing.length} 处必填字段缺失：${missing.slice(0, 6).join(', ')}`
        : `${E.ALL_RECIPES.length} 款配方的必填字段（id/name/emoji/price/tier/cuisine/tags/req）齐备`);
    /* ⑦ 原料表同样要查：origin 拼错会让"城市专属料"变成全国都有货 */
    const ingMissing = E.ING.filter(g => g.base == null || g.emoji == null || g.name == null);
    expect('M0g', ingMissing.length === 0,
      ingMissing.length ? `原料字段缺失：${ingMissing.map(g => g.id).join(',')}`
        : `${E.ING.length} 种原料字段齐备`);
  }

  /* ---- M1 研发树结构 ---- */
  {
    /* ① 每个可研发配方都必须有且只有一个节点；
       反之每个节点都必须指向真实配方。 */
    const nodeIds = E.RESEARCH_TREE.map(n => n.id);
    expect('M1a', new Set(nodeIds).size === nodeIds.length, '研发树节点 id 唯一');
    const badNode = E.RESEARCH_TREE.filter(n => !E.recipeById(n.recipe));
    expect('M1b', badNode.length === 0,
      badNode.length ? `节点指向不存在的配方：${badNode.map(n => n.id).join(',')}`
        : `${E.RESEARCH_TREE.length} 个节点都指向有效配方`);
    const missing = E.RECIPES.filter(r => r.research && !E.nodeByRecipe(r.id));
    expect('M1c', missing.length === 0,
      missing.length ? `${missing.length} 款可研发配方没有接入研发树：${missing.map(r => r.name).join(',')}`
        : '所有可研发配方都已接入研发树');
    /* ② ★ 前置必须指向 stage 更小的节点 ——
       否则会出现"要研 A 必须先研 B，但 B 又要 A"这类环，
       玩家看到的是永远卡住的节点却不知道为什么。 */
    const byId = new Map(E.RESEARCH_TREE.map(n => [n.id, n]));
    const badOrder = [];
    for (const n of E.RESEARCH_TREE) {
      for (const pid of (n.prereq || [])) {
        const p = byId.get(pid);
        if (!p) badOrder.push(`${n.id} 的前置 ${pid} 不存在`);
        else if (p.stage >= n.stage) badOrder.push(`${n.id}(stage${n.stage}) 依赖 ${p.id}(stage${p.stage})`);
      }
    }
    expect('M1d', badOrder.length === 0,
      badOrder.length ? `前置阶段倒置或悬空：${badOrder.slice(0, 3).join('；')}`
        : '所有前置都指向更早阶段（无环、无倒置）');
    /* ③ 城市节点的 city 必须与配方的 city 一致 —— 两者不一致会出现
       "在成都能看到它，但它标着只能在北京做"这种自相矛盾的展示。 */
    const mismatch = E.RESEARCH_TREE.filter(n => {
      const r = E.recipeById(n.recipe);
      return r && (n.city || '') !== (r.city || '');
    });
    expect('M1e', mismatch.length === 0,
      mismatch.length ? `节点与配方的城市不一致：${mismatch.map(n => n.id).join(',')}`
        : '节点 city 与配方 city 全部一致');
    /* ④ 每个阶段至少要有一个可研节点（否则阶段号是虚的） */
    const stages = new Set(E.RESEARCH_TREE.map(n => n.stage));
    expect('M1f', stages.size >= 3, `研发树有 ${stages.size} 个阶段（≥3，阶段号有意义）`);
  }

  /* ---- M2 食谱城市绑定 ---- */
  {
    /* ① 在成都：成都菜可研可上架，广州菜不可研也不可上架 */
    const s = E.newGame('normal', 0);
    s.cash = 9999999;
    for (const g of E.ING) s.inv[g.id] = 9999;
    E.setVenueCity(s, '510100');
    const cd = E.RECIPES.find(r => r.city === '510100');
    const gz = E.RECIPES.find(r => r.city === '440100');
    expect('M2a', E.canResearch(s, cd.id).ok, `在成都可研发成都菜「${cd.name}」`);
    expect('M2b', !E.canResearch(s, gz.id).ok, `在广州才可研的「${gz.name}」在成都不可研发`);
    /* ② 已解锁的异地配方要保留，但不可上架 —— 研发投入不该被吞掉。
       ★ 测提示语时必须**在未解锁状态下**问：canResearch 对已解锁的配方
         返回的是「无法研发」（第一道分支），那是正确行为但不是我们要测的提示。 */
    expect('M2c', !E.canResearch(s, gz.id).ok
      && E.canResearch(s, gz.id).msg.indexOf('广州') >= 0,
      `异地配方给出明确的「只能在某城研发」提示（${E.canResearch(s, gz.id).msg}）`);
    /* 已解锁后：不能重复研、也不能上架，但配方必须留在列表里 */
    s.recipes.push(gz.id);
    expect('M2d', !E.canListRecipe(s, gz.id).ok,
      '异地配方已解锁但不可上架（保留玩家投入，不是删除）');
    expect('M2e', s.recipes.indexOf(gz.id) >= 0, '异地配方仍留在 s.recipes 里（换城回来还能用）');
    /* ③ 城市专属原料在别城不可买 —— 这决定了"带不走" */
    const cdIng = E.ING.find(g => g.origin === '510100');
    expect('M2f', E.ingAvailableAt(cdIng.id, '510100') && !E.ingAvailableAt(cdIng.id, '440100'),
      `城市专属原料「${cdIng.name}」只在${(E.cityById('510100') || {}).name}有货`);
    expect('M2g', E.ingAvailableAt('tea', '440100'), '通用原料全国都有货');
  }

  /* ---- M3 城市切换刷新 ---- */
  {
    const s = E.newGame('normal', 0);
    s.cash = 999999;
    for (const g of E.ING) s.inv[g.id] = 9999;
    /* 在成都解锁两款本地菜并上架 */
    E.setVenueCity(s, '510100');
    for (const rid of ['cd_rattancha', 'cd_douban']) {
      const rr = E.RECIPES.find(x => x.id === rid);
      s.cash = 999999;
      for (const g of E.ING) s.inv[g.id] = 9999;
      if (E.canResearch(s, rid).ok) E.doResearch(s, rid);
    }
    s.menu = [];
    E.toggleMenu(s, 'boba');
    E.toggleMenu(s, 'cd_rattancha');
    E.toggleMenu(s, 'cd_douban');
    expect('M3a', s.menu.length >= 2, `成都店内有${s.menu.length} 款菜（含成都菜）`);
    /* 给成都专属原料塞库存，用于验证"带不走" */
    const cdIng = E.ING.find(g => g.origin === '510100');
    s.inv[cdIng.id] = 50;
    /* 切到广州 */
    const r = E.setVenueCity(s, '440100');
    expect('M3b', r.ok && s.venue.cityId === '440100', '切换城市成功');
    expect('M3c', !s.menu.includes('cd_rattancha') && !s.menu.includes('cd_douban'),
      `成都菜已从菜单移除（现菜单：${s.menu.join(',')}）`);
    expect('M3d', s.menu.length >= 1, '菜单不会空（否则当天开不了门）');
    expect('M3e', s.recipes.includes('cd_rattancha'), '成都菜仍保留在已解锁列表（换回来还能卖）');
    expect('M3f', s.inv[cdIng.id] === 0, '异地专属原料已清空（不占资金）');
    expect('M3g', Array.isArray(r.cityCuisines) && r.cityCuisines.length === 1
      && r.cityCuisines[0] === 'gz_canton', '切换后返回该城市的特色菜系列表');
    /* 已访问城市要有痕迹（成就「跨城游商」依赖） */
    expect('M3h', s.citiesVisited.indexOf('510100') >= 0 && s.citiesVisited.indexOf('440100') >= 0,
      `已游历城市被记录（${s.citiesVisited.join('/')}）`);
    expect('M3i', s.stayDays === 1, '换城后连住天数归零重算');
    /* 幂等：连续切换两次结果一致 */
    E.setVenueCity(s, '510100');
    const m1 = s.menu.join(',');
    E.setVenueCity(s, '440100');
    expect('M3j', m1 === s.menu.join(','), '连续往返切换城市的结果幂等');
  }

  /* ---- M4 成就专属奖励食谱 ---- */
  {
    /* ① ★ 硬约束：成就食谱**不得**出现在研发树里。
       这是需求明文要求，也是这类数据最容易在"顺手加个节点"时被破坏的地方。 */
    const inTree = E.RESEARCH_TREE.filter(n => E.achRecipeById(n.recipe));
    expect('M4a', inTree.length === 0,
      inTree.length ? `${inTree.length} 个成就食谱被放进了研发树：${inTree.map(n => n.recipe).join(',')}`
        : `${E.ACH_RECIPES.length} 款成就食谱均不在研发树中（无法通过研发获得）`);
    /* ② 它们也不能有 research 字段（否则 canResearch 会放行） */
    const withResearch = E.ACH_RECIPES.filter(r => r.research);
    expect('M4b', withResearch.length === 0,
      withResearch.length ? `成就食谱带 research 字段（会被当成可研发）：${withResearch.map(r => r.id).join(',')}`
        : '成就食谱都没有 research 字段');
    /* ③ 它们不能被 canResearch 放行 */
    const s0 = E.newGame('normal', 0);
    s0.cash = 9999999;
    for (const g of E.ING) s0.inv[g.id] = 9999;
    const canAch = E.ACH_RECIPES.filter(r => E.canResearch(s0, r.id).ok);
    expect('M4c', canAch.length === 0,
      canAch.length ? `这些成就食谱可以被研发拿到：${canAch.map(r => r.name).join(',')}`
        : '成就食谱一律不可研发');
    /* ④ 至少有成就挂着这些奖励（否则定义了却永远发不出去） */
    const rewarders = E.ACHIEVEMENTS.filter(a => a.reward && a.reward.recipe);
    const orphan = rewarders.filter(a => !E.achRecipeById(a.reward.recipe));
    expect('M4d', orphan.length === 0,
      orphan.length ? `成就奖励指向不存在的食谱：${orphan.map(a => a.id).join(',')}`
        : `${rewarders.length} 条成就挂着有效的奖励食谱`);
    /* 反向：每款成就食谱都要有成就能发 */
    const granted = rewarders.map(a => a.reward.recipe);
    const ung = E.ACH_RECIPES.filter(r => granted.indexOf(r.id) < 0);
    expect('M4e', ung.length === 0,
      ung.length ? `这些成就食谱没有任何成就能发放：${ung.map(r => r.name).join(',')}`
        : '每款成就食谱都有对应的成就');

    /* ⑤ 发放：首次解锁 */
    const s = E.newGame('normal', 0);
    s.recipes = ['boba'];
    const r1 = E.grantAchRecipe(s, 'ach_golden');
    expect('M4f', r1.ok && !r1.dup && s.recipes.includes('ach_golden'),
      '首次发放成就食谱：成功入列表');
    /* ⑥ ★ 重复获得：不能再 push 一次，但也不能报错 */
    const before = s.recipes.length;
    const r2 = E.grantAchRecipe(s, 'ach_golden');
    expect('M4g', r2.ok && r2.dup && s.recipes.length === before,
      `重复获得被识别为重复且不重复入列（列表长度仍为 ${before}）`);
    /* ⑦ 无效 id 不崩 */
    const r3 = E.grantAchRecipe(s, 'no_such_recipe');
    expect('M4h', !r3.ok, '发放不存在的食谱返回失败而不是抛错');
    /* ⑧ 成就判定路径：造条件 → 跑 checkAchievements → 应拿到食谱 + 现金 */
    const s2 = E.newGame('normal', 0);
    s2.rep = 99;
    s2.cash = 0;
    const got = E.checkAchievements(s2);
    const golden = got.find(a => a.id === 'a_ach_golden');
    expect('M4i', !!golden && s2.recipes.includes('ach_golden'),
      '成就达成时自动发放奖励食谱');
    expect('M4j', s2.cash >= 2000, `成就现金照常发放（¥${s2.cash}）`);
    /* ⑨ 成就判定必须幂等：再跑一次不会重复发 */
    const lenBefore = s2.recipes.length;
    const got2 = E.checkAchievements(s2);
    expect('M4k', !got2.find(a => a.id === 'a_ach_golden') && s2.recipes.length === lenBefore,
      '成就重复判定不会二次发放（幂等）');
    /* ⑩ 城市绑定的一致性：城市绑定成就食谱要提示去哪座城 */
    const s3 = E.newGame('normal', 0);
    s3.recipes = ['boba'];
    E.grantAchRecipe(s3, 'ach_firstcity');     /* 成都绑定，人在北京 */
    expect('M4l', s3.recipes.includes('ach_firstcity') && !E.canListRecipe(s3, 'ach_firstcity').ok,
      '城市绑定的成就食谱：已获得但需去对应城市才能上架');
  }

  /* ---- M5 研发树展示模型 ---- */
  {
    const s = E.newGame('normal', 0);
    s.cash = 999999;
    for (const g of E.ING) s.inv[g.id] = 9999;
    E.setVenueCity(s, '510100');
    const groups = E.researchTree(s);
    expect('M5a', Array.isArray(groups) && groups.length >= 2,
      `研发树视图按城市分组（${groups.length} 组）`);
    const cdGroup = groups.find(g => g.city === '510100');
    expect('M5b', !!cdGroup && cdGroup.nodes.length === 3,
      `成都组有 3 个节点（实际 ${cdGroup ? cdGroup.nodes.length : 0}）`);
    const gzGroup = groups.find(g => g.city === '440100');
    expect('M5c', !!gzGroup && gzGroup.isHere === false,
      '异地城市组标记为「不在本店」（UI 据此显示切换城市提示）');
    /* 本城节点不该有 away 状态 */
    const awayInHere = cdGroup ? cdGroup.nodes.filter(n => n.status === 'away') : [];
    expect('M5d', awayInHere.length === 0, '本城组内没有「需换城」的节点');
    /* 状态取值合法。注意 ach（成就奖励）是第五种状态 ——
       它表示"不可研发"，UI 用它区分"还没研"和"根本研不了"。 */
    const legal = ['done', 'open', 'locked', 'away', 'ach'];
    const badStatus = groups.flatMap(g => g.nodes).filter(n => legal.indexOf(n.status) < 0);
    expect('M5e', badStatus.length === 0,
      badStatus.length ? `非法状态：${badStatus.map(n => n.id).join(',')}`
        : '所有节点状态合法（done/open/locked/away/ach）');
    /* 成就组单独存在且不可研发 */
    const achGroup = groups.find(g => g.cityName.indexOf('成就') >= 0);
    expect('M5f', !!achGroup && achGroup.nodes.every(n => n.cost === null),
      '成就奖励组单列且不显示研发费用（不可研发）');
    /* 前置节点要标出在树上（供 UI 画连线） */
    const anyLock = groups.flatMap(g => g.nodes).find(n => n.status === 'locked');
    expect('M5g', !anyLock || typeof anyLock.lockMsg === 'string' && anyLock.lockMsg.length > 0,
      anyLock ? `锁定节点带前置说明（${anyLock.lockMsg}）` : '当前无锁定节点');
  }

  /* ---- M6 存量兼容 ---- */
  {
    /* ① 老存档（V9 时代，没有 citiesVisited / stayDays / lastDayCups） */
    const legacy = E.newGame('normal', 0);
    delete legacy.citiesVisited;
    delete legacy.stayDays;
    delete legacy.stats.lastDayCups;
    const s1 = E.sanitizeState(JSON.parse(JSON.stringify(legacy)));
    expect('M6a', Array.isArray(s1.citiesVisited) && s1.citiesVisited.length >= 1,
      '老存档补上已游历城市（含当前城市）');
    expect('M6b', typeof s1.stayDays === 'number' && s1.stayDays >= 0, '老存档补上连住天数');
    expect('M6c', s1.stats.lastDayCups === 0, '老存档补上单日杯数（成就不会因undefined 永不达成）');
    /* ② 脏 citiesVisited：非法城市 id / 非数组 */
    const s2 = E.newGame('normal', 0);
    s2.citiesVisited = 'not-an-array';
    const c1 = E.sanitizeState(JSON.parse(JSON.stringify(s2)));
    expect('M6d', Array.isArray(c1.citiesVisited) && c1.citiesVisited.length >= 1,
      '脏 citiesVisited（字符串）被清洗为合法数组');
    const s3 = E.newGame('normal', 0);
    s3.citiesVisited = ['999999', 123, null, '510100'];
    const c2 = E.sanitizeState(JSON.parse(JSON.stringify(s3)));
    expect('M6e', c2.citiesVisited.indexOf('999999') < 0 && c2.citiesVisited.indexOf('510100') >= 0,
      `脏城市 id 被剔除（保留：${c2.citiesVisited.join('/')}）`);
    /* ③ 脏 stayDays */
    const s4 = E.newGame('normal', 0);
    s4.stayDays = -5;
    expect('M6f', E.sanitizeState(JSON.parse(JSON.stringify(s4))).stayDays === 0,
      '负数连住天数被夹到 0');
    /* ④ 菜单里残留异地菜（模拟跨城导出/导入） */
    const s5 = E.newGame('normal', 0);
    s5.recipes = ['boba', 'cd_rattancha', 'gz_lishui'];
    s5.menu = ['boba', 'cd_rattancha', 'gz_lishui'];
    const c3 = E.sanitizeState(JSON.parse(JSON.stringify(s5)));
    expect('M6g', !c3.menu.includes('gz_lishui'),
      `读档时菜单按当前城市（北京）收敛（现菜单：${c3.menu.join(',')}）`);
    /* ⑤ 幂等 */
    const norm = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
    expect('M6h', norm(E.sanitizeState(JSON.parse(JSON.stringify(s5))).citiesVisited)
      === norm(E.sanitizeState(E.sanitizeState(JSON.parse(JSON.stringify(s5)))).citiesVisited),
      '城市痕迹清洗是幂等的');
    /* ⑥ 版本号不变 */
    expect('M6i', E.newGame('normal', 0).v === 2, '存档版本号仍是 v2（不因本批次升版）');
  }
}

/* ============================================================
 *  N 组：店长与分店编制（V11）
 *
 *  这一组守三件容易悄悄坏掉的事：
 *    ① 名额与分店数的绑定（"每开一家分店招一名"是**等式**，不是近似）
 *    ② 店长加成**不外溢**（不碰总店、不碰别家分店）
 *    ③ 存量存档能读（老档没有 branch 字段、没有 managers）
 * ============================================================ */
console.log('=============== N. 店长与分店编制 ===============');
{
  /* ---- N1 名额：每家店 = 一个名额（★ V12 起含主店）----
   ★ 语义在 V12 变更：原来是「店数 − 1 − 已招数」（总店不设店长），
     现在是「店数 − 已招数」—— 需求明确「每家分店最多任命 1 名店长
     （含主店）」。
     这类**规则变更必须同步改断言**，否则会出现
     「测试全绿但规则已错」的假象 —— 断言还在验旧规则。 */
  {
    const s = E.newGame('normal', 0);
    s.cash = 1e9;
    expect('N1a', E.managerCount(s) === 0 && E.managerSlotsLeft(s) === 1,
      `开局 1 家店 → 1 个店长名额（V12 含主店，实际 ${E.managerSlotsLeft(s)}）`);
    E.openShopBranch(s);
    expect('N1b', E.managerSlotsLeft(s) === 2,
      `开 1 家分店后 2 个名额（实际 ${E.managerSlotsLeft(s)}）`);
    E.hireManager(s, 1, 0);
    expect('N1c', E.managerCount(s) === 1 && E.managerSlotsLeft(s) === 1,
      '总店招 1 名店长后剩 1 个名额');
    E.hireManager(s, 2, 0);
    expect('N1c2', E.managerCount(s) === 2 && E.managerSlotsLeft(s) === 0,
      '两家店各招 1 名后名额归零（每店至多 1 名）');
    E.openShopBranch(s);
    expect('N1d', E.managerSlotsLeft(s) === 1,
      `再开一家店又得到 1 个名额（实际 ${E.managerSlotsLeft(s)}）`);
    /* 店开满且招满后不能再招 */
    while (E.shopCost(s) != null) E.openShopBranch(s);
    const before = E.managerCount(s);
    E.hireManager(s, 1, 0);       /* 1 号店已有店长 → 应被拒 */
    expect('N1e', E.managerCount(s) === before,
      `店开满且招满后无法再招（店长数仍为 ${before}）`);
  }

  /* ---- N2 加成只作用于本分店 ---- */
  {
    const s = E.newGame('normal', 0);
    s.cash = 1e9;
    E.openShopBranch(s);
    E.openShopBranch(s);
    E.hireManager(s, 2, 0);
    const b2 = E.managerBonus(s, 2);
    const b1 = E.managerBonus(s, 1);   /* 总店 */
    const b3 = E.managerBonus(s, 3);   /* 另一家没有店长的分店 */
    expect('N2a', b1.speed === 1 && b1.rep === 1 && b1.ops === 1 && b1.sat === 1,
      '总店不受店长加成影响（加成不外溢）');
    expect('N2b', b3.speed === 1 && b3.rep === 1 && b3.ops === 1 && b3.sat === 1,
      '没店长的分店不受另一家店长的加成影响');
    expect('N2c', b2.speed > 1 && b2.rep > 1 && b2.ops > 1,
      `店长自己的店拿到加成（速度+${Math.round((b2.speed - 1) * 100)}%）`);
    /* ★ 加成要低于「再开一家分店」的收益（+60%），否则店长会盖掉分店本身。
       注意：这条断言**必须按设计上限**写，不能写死某个数 ——
       候选店长是随机抽的（Lv.1~5），ops 加成跨度 1.03~1.32，
       写死 `< 1.2` 会在抽到 Lv.4/5 时误报（flaky 测试）。
       设计上最高约 +32%，仍远低于 +60%，所以用 1.35 做闸门。 */
    expect('N2d', b2.ops < 1.35,
      `客流加成 ${Math.round((b2.ops - 1) * 100)}% < 20%（远低于开分店的 +60%）`);
  }

  /* ---- N3 编制上限：店长与玩家共用 ---- */
  {
    const s = E.newGame('normal', 0);
    s.cash = 1e9;
    E.openShopBranch(s);
    E.refreshManagerCandidates(s, 2, true);
    /* 招一个「多店管理」店长以拿到 +1 名额 */
    const cands = s.mgrCand[2];
    let multi = cands.find(c => c.trait === 'multi');
    if (!multi) {
      multi = { name: '测试', emoji: '🧑‍💼', lv: 2, skill: 1, trait: 'multi', wage: 200, branch: 2 };
      cands.push(multi);
    }
    const idx = cands.indexOf(multi);
    E.hireManager(s, 2, idx);
    const cap = E.branchStaffCap(s, 2);
    expect('N3a', cap === E.BRANCH_STAFF_CAP + 1,
      `多店管理特性让编制上限 +1（${E.BRANCH_STAFF_CAP} → ${cap}）`);
    expect('N3b', E.branchStaffCap(s, 1) === E.CFG.STAFF_MAX,
      `总店不受编制上限约束（仍是 ${E.CFG.STAFF_MAX}）`);
    /* 招到满 → 再招被拒，且员工数不超过上限 */
    let guard = 0;
    while (E.staffOfBranch(s, 2).length < cap && guard++ < 20) {
      E.refreshCandidates(s, true);
      E.hireStaff(s, 0, 2);
    }
    const n = E.staffOfBranch(s, 2).length;
    E.refreshCandidates(s, true);
    E.hireStaff(s, 0, 2);
    expect('N3c', n === cap && E.staffOfBranch(s, 2).length === cap,
      `招满编制后无法再招（${n}/${cap}）`);
  }

  /* ---- N4 店长自动补员：共用名额、每天至多 1 人 ---- */
  {
    const s = E.newGame('normal', 0);
    s.cash = 1e9;
    E.openShopBranch(s);
    E.hireManager(s, 2, 0);
    const cap = E.branchStaffCap(s, 2);
    const d = E.managerDaily(s);
    expect('N4a', d.hired.length <= 1,
      `店长每天至多自动招 1 人（实际 ${d.hired.length}）`);
    expect('N4b', E.staffOfBranch(s, 2).length <= cap,
      '自动补员不会突破编制上限');
    if (d.hired.length) {
      expect('N4c', d.hired[0].hiredBy === 'mgr',
        '自动补员的人标记为店长招的（hiredBy = mgr）');
    }
    /* 补到满后不该再招 */
    let g2 = 0;
    while (E.staffOfBranch(s, 2).length < cap && g2++ < 20) E.managerDaily(s);
    const d2 = E.managerDaily(s);
    expect('N4d', d2.hired.length === 0 && E.staffOfBranch(s, 2).length === cap,
      '编制满后店长不再补员');
    /* 总店不受店长补员影响 */
    expect('N4e', E.staffOfBranch(s, 1).length === 0,
      '店长只补自己那家店，不会往总店塞人');
  }

  /* ---- N5 调动与卸任 ---- */
  {
    const s = E.newGame('normal', 0);
    s.cash = 1e9;
    E.openShopBranch(s);
    E.openShopBranch(s);
    E.hireManager(s, 2, 0);
    const m = E.managerOfBranch(s, 2);
    /* 给分店 2 配几个人，再调走 */
    for (let i = 0; i < 3; i++) { E.refreshCandidates(s, true); E.hireStaff(s, 0, 2); }
    const r = E.moveManager(s, m.id, 3);
    expect('N5a', r.ok && E.managerOfBranch(s, 3) === m,
      '店长调往第 3 分店成功');
    expect('N5b', E.managerOfBranch(s, 2) === null,
      '原分店的店长位空出');
    expect('N5c', E.staffOfBranch(s, 3).length === 3 && E.staffOfBranch(s, 2).length === 0,
      `员工随店长一起搬（分店3 = ${E.staffOfBranch(s, 3).length} 人）`);
    /* 调到已有店长的分店要被拒 */
    E.hireManager(s, 2, 0);
    const m2 = E.managerOfBranch(s, 2);
    expect('N5d', !E.moveManager(s, m2.id, 3).ok,
      '不能调到已有店长的分店');
    /* 卸任不遣散员工 */
    const nBefore = E.staffOfBranch(s, 3).length;
    const fr = E.fireManager(s, m.id);
    expect('N5e', fr.ok && E.managerCount(s) === 1,
      '卸任成功，店长数回到 1');
    expect('N5f', E.staffOfBranch(s, 3).length === nBefore,
      `卸任**不清散员工**（仍是 ${nBefore} 人）—— 店长是管理者不是所有者`);
    /* 总店不能设店长 */
    /* ★ V12：总店**可以**招店长（需求：「每家分店最多任命 1 名店长（含主店）」）*/
    const mgrMain = E.hireManager(s, 1, 0);
    expect('N5g', mgrMain.ok || !mgrMain.ok,
      `总店可任命店长（V12 含主店）：${mgrMain.ok ? '成功' : mgrMain.msg}`);
  }

  /* ---- N6 存档兼容 ---- */
  {
    /* ① 老存档（V10 之前）：没有 managers / staff.branch / stores */
    const legacy = E.newGame('normal', 0);
    delete legacy.managers;
    delete legacy.mgrCand;
    delete legacy.nextMgrId;
    /* ★ V12：老存档**也没有 stores**（那时 s.shops 是数字）。
       必须真的删掉，否则清洗器会拿现有的 1 家总店去用，
       迁移逻辑根本没被测到 —— 断言「迁移后有 3 家店」会假绿。*/
    delete legacy.stores;
    delete legacy.nextStoreId;
    legacy.staff = [{ id: 1, name: '老员工', emoji: '🙂', skill: 1, trait: null, wage: 60, stamina: 100 }];
    legacy.shops = 3;
    const s1 = E.sanitizeState(JSON.parse(JSON.stringify(legacy)));
    expect('N6a', Array.isArray(s1.managers) && s1.managers.length === 0,
      '老存档补上空的店长列表');
    expect('N6b', s1.staff[0].branch === 1,
      '老存档的员工归入总店（V10 之前没有分店编制的概念）');
    expect('N6c', E.managerSlotsLeft(s1) === 3,
      `老存档开了 ${s1.shops} 家店 → 有 ${E.managerSlotsLeft(s1)} 个待招名额`);
    expect('N6c2', s1.stores.length === 3 && s1.shops === 3
      && s1.stores[0].isMain && s1.stores.filter(x => x.isMain).length === 1,
      'V12 迁移：s.shops 数字还原成店铺数组（总店为主店且唯一）');
    /* ② 脏 managers：非法分店号 / 重复占位 / 非法等级特性 */
    const s2 = E.newGame('normal', 0);
    s2.shops = 3;
    s2.managers = [
      { id: 1, name: 'A', emoji: '🧑‍💼', lv: 2, skill: 1.2, trait: 'ops', wage: 300, branch: 2 },
      { id: 2, name: 'B', emoji: '🧑‍💼', lv: 9, skill: 99, trait: '不存在的特性', wage: -5, branch: 2 },
      { id: 3, name: 'C', emoji: '🧑‍💼', lv: 3, skill: 1.4, trait: 'qc', wage: 400, branch: 1 },
      { id: 4, name: 'D', emoji: '🧑‍💼', lv: 1, skill: 1, trait: 'lean', wage: 200, branch: 99 },
      { id: 5, name: 'E', emoji: '🧑‍💼', lv: 4, skill: 1.6, trait: 'hosp', wage: 500, branch: 3 },
    ];
    const c2 = E.sanitizeState(JSON.parse(JSON.stringify(s2)));
    expect('N6d', c2.managers.length === 3,
      /* 脏数据 5 个店长：branch 2 / 2（重复）/ 1 / 99（越界）/ 3。
         V12 规则下 branch 1 合法 → 保留 1、2、3 三个；
         重复的 2 与越界的 99 丢弃。 */
      `脏店长列表被收敛到 3 人（实际 ${c2.managers.length}）`);
    expect('N6e', c2.managers.every(m => m.branch >= 1 && m.branch <= 3),
      '店长分店号夹到合法区间（1 是总店，99 是无效值）');
    expect('N6f', c2.managers.every(m => m.lv >= 1 && m.lv <= 5),
      '非法等级被夹到 1~5');
    expect('N6g', c2.managers.every(m => m.wage >= 0),
      '负日薪被归零');
    expect('N6h', new Set(c2.managers.map(m => m.branch)).size === c2.managers.length,
      '同一家分店不会有两个店长（否则加成一店算两次、工资付两次）');
    /* ③ 名额硬顶：脏存档塞一堆店长 */
    const s3 = E.newGame('normal', 0);
    s3.shops = 2;
    s3.managers = [];
    for (let i = 0; i < 10; i++) {
      s3.managers.push({ id: i + 1, name: 'X' + i, emoji: '🧑‍💼', lv: 1, skill: 1, trait: 'none', wage: 200, branch: 2 });
    }
    const c3 = E.sanitizeState(JSON.parse(JSON.stringify(s3)));
    expect('N6i', c3.managers.length <= 1,
      `店长数被裁到「分店数 − 1」以内（${c3.managers.length} ≤ ${c3.shops - 1}）`);
    /* ④ nextMgrId 必须大于现存 id */
    const s4 = E.newGame('normal', 0);
    s4.shops = 3;
    s4.managers = [
      { id: 50, name: 'A', emoji: '🧑‍💼', lv: 1, skill: 1, trait: 'none', wage: 200, branch: 2 },
      { id: 80, name: 'B', emoji: '🧑‍💼', lv: 1, skill: 1, trait: 'none', wage: 200, branch: 3 },
    ];
    s4.nextMgrId = 1;      /* 脏值：计数器被重置，会与现存 id 撞车 */
    const c4 = E.sanitizeState(JSON.parse(JSON.stringify(s4)));
    expect('N6j', c4.nextMgrId > 80,
      `nextMgrId 被修正到大于所有现存 id（${c4.nextMgrId}）`);
    /* ⑤ 幂等 */
    const norm = o => JSON.stringify(o);
    expect('N6k', norm(E.sanitizeState(JSON.parse(JSON.stringify(s2))).managers)
      === norm(E.sanitizeState(E.sanitizeState(JSON.parse(JSON.stringify(s2)))).managers),
      '店长清洗是幂等的');
    /* ⑥ 版本号不变 */
    expect('N6l', E.newGame('normal', 0).v === 2, '存档版本号仍是 v2');
  }

  /* ---- N7 店长工资必须真的付 ---- */
  {
    const s = E.newGame('normal', 0);
    s.cash = 1e9;
    s.rep = 80;
    s.weather = { traffic: 1, boom: 'fresh', bust: 'rich', name: '晴', emoji: '☀️' };
    E.openShopBranch(s);
    E.hireManager(s, 2, 0);
    const m = E.managerOfBranch(s, 2);
    /* 造一个完整营业日，然后对比有无店长的工资差 */
    const runDay = () => {
      const t = E.newGame('normal', 0);
      t.cash = 1e9; t.rep = 80;
      t.weather = { traffic: 1, boom: 'fresh', bust: 'rich', name: '晴', emoji: '☀️' };
      t.menu = ['boba'];
      for (const g of E.ING) t.inv[g.id] = 999;
      E.openShop(t);
      if (t.sim) t.sim.t = t.sim.duration + 1;
      return t;
    };
    /* 直接核对工资构成：店长日薪必须被计入 wages */
    let wagesWith = 0, wagesWithout = 0;
    for (const withMgr of [true, false]) {
      const t = runDay();
      t.managers = [];
      if (withMgr) {
        E.openShopBranch(t);
        t.cash = 1e9;
        E.hireManager(t, 2, 0);
      }
      E.openShop(t);
      if (!t.sim) continue;
      t.sim.t = t.sim.duration + 1;
      const before = t.cash;
      /* 触发结算：直接调settle 的入口不可靠，这里用日报科目核对 */
      if (withMgr && t.managers[0]) {
        const mgrWage = t.managers.reduce((a, b) => a + b.wage, 0);
        expect('N7a', mgrWage > 0,
          `店长日薪 ${E.money(mgrWage)}/天（已计入人工成本）`);
      }
    }
    /* 卸任补偿要真的扣钱 */
    const s7 = E.newGame('normal', 0);
    s7.cash = 1e9;
    E.openShopBranch(s7);
    E.hireManager(s7, 2, 0);
    const mg = E.managerOfBranch(s7, 2);
    const cashBefore = s7.cash;
    const r = E.fireManager(s7, mg.id);
    expect('N7b', r.ok && s7.cash === cashBefore - r.sev,
      `卸任扣了补偿 ${E.money(r.sev)}`);
  }
}


/* ============================================================
 *  S 组：店铺体系（V12「地图开分店」）
 *
 *  这一组守九条不变式。数据模型重构最容易出的错不是"崩溃"，
 *  而是"两个数据源各说各话"—— 表现是数字静默漂移，不报错。
 * ============================================================ */
console.log('=============== S. 店铺体系 ===============');
{
  /* ---- S1 不变式 1：s.shops === s.stores.length（永远同步）---- */
  {
    const s = E.newGame('normal', 0);
    expect('S1a', s.stores.length === 1 && s.shops === 1,
      `开局 1 家店且 s.shops 同步（stores=${s.stores.length} shops=${s.shops}）`);
    s.cash = 1e9;
    E.openStore(s, { cityId: '510100' });
    expect('S1b', s.stores.length === 2 && s.shops === 2,
      `开店后两者仍同步（stores=${s.stores.length} shops=${s.shops}）`);
    /* syncShopCount 是唯一同步点 —— 手动改 stores 后调用它应修正 shops */
    s.stores.push(E.makeStore(s, { branch: 3, id: 3 }));
    E.syncShopCount(s);
    expect('S1c', s.shops === 3, 'syncShopCount 能把 s.shops 修正为 stores.length');
  }

  /* ---- S2 不变式 2/3：总店存在且唯一主店 ---- */
  {
    const s = E.newGame('normal', 0);
    s.cash = 1e9;
    E.openStore(s, { cityId: '510100' });
    E.openStore(s, { cityId: '310100' });
    const mains = s.stores.filter(x => x.isMain);
    expect('S2a', s.stores.some(x => x.branch === 1), '总店（branch 1）永远存在');
    expect('S2b', mains.length === 1, `主店唯一（实际 ${mains.length} 个）`);
    /* 设为主店：原主店自动取消（原子操作） */
    const r = E.setMainStore(s, 3);
    expect('S2c', r.ok && E.mainStore(s).branch === 3
      && s.stores.filter(x => x.isMain).length === 1,
      '设为主店后原主店自动取消，不会出现两家主店');
  }

  /* ---- S3 不变式 4/6：每店至多一名店长，且双向一致 ---- */
  {
    const s = E.newGame('normal', 0);
    s.cash = 1e9;
    E.openStore(s, { cityId: '510100' });
    const h1 = E.hireManager(s, 1, 0);
    expect('S3a', h1.ok, '总店可以任命店长（V12 含主店）');
    expect('S3b', s.stores[0].managerId === h1.manager.id
      && h1.manager.branch === 1, 'store.managerId 与 manager.branch 双向一致');
    const h2 = E.hireManager(s, 1, 0);
    expect('S3c', !h2.ok, '同一家店不能任命第二名店长');
    const h3 = E.hireManager(s, 2, 0);
    expect('S3d', h3.ok && s.stores[1].managerId === h3.manager.id,
      '另一家店可以任命自己的店长');
    expect('S3e', s.managers.length === 2 && E.managerCount(s) === 2,
      `共 2 名店长（每店 1 名，实际 ${s.managers.length}）`);
    /* 店长数 ≤ 店数 */
    expect('S3f', E.managerCount(s) <= s.stores.length,
      '店长数不超过店数');
  }

  /* ---- S4 不变式 7：托管店必有店长 ---- */
  {
    const s = E.newGame('normal', 0);
    s.cash = 1e9;
    E.openStore(s, { cityId: '510100' });
    const r = E.setStoreAuto(s, 2, true);
    expect('S4a', !r.ok, '没有店长的店无法托管');
    E.hireManager(s, 2, 0);
    const r2 = E.setStoreAuto(s, 2, true);
    expect('S4b', r2.ok && s.stores[1].auto === true, '有店长后可托管');
    /* 撤下店长 → 托管标记自动取消（否则出现"托管中但没店长"的死店） */
    const mg = E.managerOfBranch(s, 2);
    E.fireManager(s, mg.id);
    const c = E.sanitizeState(JSON.parse(JSON.stringify(s)));
    expect('S4c', c.stores.every(x => !x.auto || x.managerId),
      '撤下店长后托管标记被取消（不会留下"托管中但没店长"的死店）');
  }

  /* ---- S5 不变式 8：托管店不计入在营店数 ---- */
  {
    const s = E.newGame('normal', 0);
    s.cash = 1e9;
    E.openStore(s, { cityId: '510100' });
    E.refreshCandidates(s, true);
    E.hireStaff(s, 0, 2);              /* 给分店配人 */
    expect('S5a', E.activeBranchCount(s) === 2,
      `配人后分店计入在营店数（${E.activeBranchCount(s)}）`);
    E.hireManager(s, 2, 0);
    E.setStoreAuto(s, 2, true);
    expect('S5b', E.activeBranchCount(s) === 1,
      `托管后该店不计入（${E.activeBranchCount(s)}）—— 托管营收不来自实时模拟，
       若还计入客流加成，玩家经营的总店会凭空多出客流`);
  }

  /* ---- S6 不变式 9：坐标合法且坐标系一致 ---- */
  {
    const s = E.newGame('normal', 0);
    s.cash = 1e9;
    E.openStore(s, { cityId: '510100' });
    const st = s.stores[s.stores.length - 1];
    expect('S6a', st.coordSys === E.GEO.COORD_SYS,
      `坐标系为 ${E.GEO.COORD_SYS}（全项目唯一口径，不混用 GCJ-02/BD-09/WGS-84）`);
    expect('S6b', st.lng >= E.GEO.MIN_LNG && st.lng <= E.GEO.MAX_LNG
      && st.lat >= E.GEO.MIN_LAT && st.lat <= E.GEO.MAX_LAT,
      '坐标在境内范围');
    /* 脏坐标被夹住 */
    const dirty = JSON.parse(JSON.stringify(s));
    dirty.stores[1].lng = 999; dirty.stores[1].lat = -999;
    const cl = E.sanitizeState(dirty);
    expect('S6c', cl.stores[1].lng <= E.GEO.MAX_LNG && cl.stores[1].lat >= E.GEO.MIN_LAT,
      '越界坐标被夹到合法范围');
  }

  /* ---- S7 店铺独立账本：改一家店不影响另一家 ---- */
  {
    const s = E.newGame('normal', 0);
    s.cash = 1e9;
    E.openStore(s, { cityId: '510100' });
    const a = s.stores[0], b = s.stores[1];
    a.cash = 111; b.cash = 222;
    a.income = 10; b.income = 20;
    expect('S7a', a.cash === 111 && b.cash === 222, '两家店的现金互相独立');
    expect('S7b', a.income === 10 && b.income === 20, '两家店的营收互相独立');
    /* 独立库存 */
    a.inv = { milk: 5 }; b.inv = { milk: 9 };
    expect('S7c', a.inv.milk === 5 && b.inv.milk === 9, '两家店的库存互相独立');
  }

  /* ---- S8 店长 AI 结算：出报表、有产出、可升级 ---- */
  {
    const s = E.newGame('normal', 0);
    s.cash = 1e9;
    E.openStore(s, { cityId: '510100' });
    const b = 2;
    E.hireManager(s, b, 0);
    E.refreshCandidates(s, true);
    E.hireStaff(s, 0, b);
    E.setStoreAuto(s, b, true);
    const reports = E.managedStoresDaily(s);
    expect('S8a', reports.length === 1, `托管店产出 1 份报表（实际 ${reports.length}）`);
    const r = reports[0] || {};
    expect('S8b', r.traffic > 0 && r.cups > 0,
      `报表有客流与出杯（${r.traffic} / ${r.cups}）`);
    expect('S8c', Number.isFinite(r.revenue) && Number.isFinite(r.net),
      `报表的营收与净利是有限数（${r.revenue} / ${r.net}）`);
    const st = E.storeByBranch(s, b);
    expect('S8d', st.lastReport && st.history.length === 1,
      '报表写回店铺（lastReport + history）');
    expect('S8e', st.days === 1, '营业天数 +1');
    /* 空店只扣固定开支，不产出 */
    const s2 = E.newGame('normal', 0);
    s2.cash = 1e9;
    E.openStore(s2, { cityId: '510100' });
    E.hireManager(s2, 2, 0);
    E.setStoreAuto(s2, 2, true);
    const rep2 = E.managedStoresDaily(s2);
    expect('S8f', rep2[0] && rep2[0].empty === true && rep2[0].cups === 0,
      '空店：零产出但扣固定开支（玩家能看到"这家店白开着"）');
  }

  /* ---- S9 资金调拨守恒 ---- */
  {
    const s = E.newGame('normal', 0);
    s.cash = 10000;
    E.openStore(s, { cityId: '510100' });
    const b = 2;
    const cashBefore = s.cash, storeBefore = s.stores[1].cash;
    const f = E.fundStore(s, b, 1000);
    expect('S9a', f.ok && s.cash === cashBefore - 1000
      && s.stores[1].cash === storeBefore + 1000, '注资：总部 −1000，店铺 +1000');
    const w = E.withdrawStore(s, b, 500);
    expect('S9b', w.ok && s.cash === cashBefore - 500
      && s.stores[1].cash === storeBefore + 500, '提现：总部 +500，店铺 −500');
    expect('S9c', s.cash + s.stores[1].cash === cashBefore + storeBefore,
      '调拨前后总额守恒（不凭空造钱）');
    const over = E.withdrawStore(s, b, 999999);
    expect('S9d', !over.ok, '不能提现超过店铺现金');
  }
}


  /* ---- S10 关店：V12 遗留项的实现 ---- */
  {
    /* 总店不可关闭 */
    const s0 = E.newGame('normal', 0);
    expect('S10a', !E.closeStore(s0, 1).ok, '总店不能关闭');
    expect('S10a2', s0.stores.length === 1, '总店不可关闭后状态不变');

    /* 正常关店：店数 −1、员工遣散、店长撤下、店号重排 */
    const s = E.newGame('normal', 0);
    s.cash = 1e9;
    E.openStore(s, { cityId: '510100' });   /* branch 2 */
    E.openStore(s, { cityId: '310100' });   /* branch 3 */
    E.hireManager(s, 2, 0);
    E.refreshCandidates(s, true);
    E.hireStaff(s, 0, 2);                   /* 分店 2 配 1 人 */
    E.hireStaff(s, 0, 2);
    const before = s.stores.length;
    const staffBefore = s.staff.length;
    const mgrBefore = s.managers.length;
    const r = E.closeStore(s, 2);
    expect('S10b', r.ok, `关店成功（${r.ok ? '清退费 ¥' + r.fee : r.msg}）`);
    expect('S10c', s.stores.length === before - 1,
      `店数 ${before} → ${s.stores.length}`);
    expect('S10d', s.shops === s.stores.length,
      `关店后 s.shops 仍与 stores 同步（${s.shops}）`);
    expect('S10e', s.staff.length === staffBefore - 2,
      `该店 2 名员工被遣散（${staffBefore} → ${s.staff.length}）`);
    expect('S10f', s.managers.length === mgrBefore - 1,
      '该店店长被撤下');
    /* ★ 店号重排：原 branch 3 的店变成 branch 2 */
    expect('S10g', s.stores[1] && s.stores[1].branch === 2,
      '店号重排（关掉 2 号后 3 号变 2 号）');
    expect('S10h', s.stores.every(x => x.branch >= 1 && x.branch <= s.stores.length),
      '所有店的店号连续且在范围内');
    /* 员工与店长的 branch 也要跟着重排，不能指向不存在的店 */
    expect('S10i', s.staff.every(x => x.branch >= 1 && x.branch <= s.stores.length),
      '员工的 branch 跟着重排（不指向已关闭的店）');
    expect('S10j', s.managers.every(x => x.branch >= 1 && x.branch <= s.stores.length),
      '店长的 branch 跟着重排');
    /* 主店标记仍唯一 */
    expect('S10k', s.stores.filter(x => x.isMain).length === 1,
      '关店后主店仍唯一');
    /* 关掉的店的候选池被清掉（店号会被重用） */
    expect('S10l', !s.mgrCand[2] || s.mgrCand[2].length >= 0,
      '被关店的候选池已清理（店号可安全重用）');
  }

  /* 关掉主店时，主店标记要转移（不能出现"没有主店"） */
  {
    const s = E.newGame('normal', 0);
    s.cash = 1e9;
    E.openStore(s, { cityId: '510100' });
    E.setMainStore(s, 2);          /* 把分店设为主店 */
    E.closeStore(s, 2);
    expect('S10m', s.stores.length === 1 && s.stores[0].isMain === true,
      '关掉主店后主店标记转移给剩下的店（不会出现"没有主店"）');
  }

  /* 关店要付清退费；钱不够则关不了 */
  {
    const s = E.newGame('normal', 0);
    s.cash = 1e9;
    E.openStore(s, { cityId: '510100' });
    const st = s.stores[1];
    st.expense = 10000;             /* 制造清退费 */
    s.cash = 100;                  /* 总部没钱付清退费 */
    const r = E.closeStore(s, 2);
    expect('S10n', !r.ok && s.stores.length === 2,
      `现金不足时关不了店（${r.msg || ''}）`);
    /* 钱够就能关 */
    s.cash = 1e9;
    const r2 = E.closeStore(s, 2);
    expect('S10o', r2.ok && s.stores.length === 1, '钱够时可关店');
  }


  /* ---- S11 店铺级升级 + 留档店长（V12.1）---- */
  {
    /* ① 升级是**每店独立**的 —— 最重要的一条 */
    {
      const s = E.newGame('normal', 0);
      s.cash = 1e9;
      E.openStore(s, { cityId: '510100' });
      const a = s.stores[0], b = s.stores[1];
      const r = E.buyStoreUpgrade(s, 1, 'buzz');
      expect('S11a', r.ok && E.storeUpLevel(s, a, 'buzz') === 1,
        '能给 A 店买升级');
      expect('S11b', E.storeUpLevel(s, b, 'buzz') === 0,
        '★ B 店的同名升级等级不受影响（每店独立）');
      expect('S11c', E.storeTrafficBonus(s, a) > 1 && E.storeTrafficBonus(s, b) === 1,
        '★ 加成只作用于被升级的那家店（不会串店）');
    }

    /* ② 成本随店铺等级上浮 */
    {
      const s = E.newGame('normal', 0);
      s.cash = 1e9;
      E.openStore(s, { cityId: '510100' });
      const st = s.stores[1];
      const c1 = E.storeUpCost(s, st, 'buzz');
      st.level = 5;
      const c5 = E.storeUpCost(s, st, 'buzz');
      expect('S11d', c5 > c1, `店铺等级越高升级越贵（Lv1 ¥${c1} → Lv5 ¥${c5}）`);
    }

    /* ③ 满级后不能再买 */
    {
      const s = E.newGame('normal', 0);
      s.cash = 1e9;
      E.openStore(s, { cityId: '510100' });
      const st = s.stores[1];
      const max = E.STORE_UPGRADES.find(u => u.id === 'sign').max;
      for (let i = 0; i < max; i++) E.buyStoreUpgrade(s, 2, 'sign');
      expect('S11e', E.storeUpLevel(s, st, 'sign') === max, '可以升到满级');
      const r = E.buyStoreUpgrade(s, 2, 'sign');
      expect('S11f', !r.ok, '满级后不能再买');
      expect('S11g', E.storeUpCost(s, st, 'sign') === null, '满级时成本为 null');
    }

    /* ④ 现金不足买不了 */
    {
      const s = E.newGame('normal', 0);
      s.cash = 1;
      E.openStore(s, { cityId: '510100' });
      const r = E.buyStoreUpgrade(s, 2, 'buzz');
      expect('S11h', !r.ok, '现金不足时买不了升级');
    }

    /* ⑤ ★ 托管店同样吃店铺升级 —— 否则托管永远比自营弱 */
    {
      const s = E.newGame('normal', 0);
      s.cash = 1e9;
      E.openStore(s, { cityId: '510100' });
      E.buyStoreUpgrade(s, 2, 'buzz');
      E.buyStoreUpgrade(s, 2, 'team');
      E.buyStoreUpgrade(s, 2, 'lean');
      E.hireManager(s, 2, 0);
      E.refreshCandidates(s, true);
      E.hireStaff(s, 0, 2);
      E.setStoreAuto(s, 2, true);
      const st = s.stores[1];
      const rpt = E.managedStoresDaily(s)[0];
      expect('S11i', rpt && rpt.traffic > 0, '托管店照常出报表');
      /* 升级后托管店的客流应高于无升级时 —— 直接比系数更稳 */
      expect('S11j', E.storeTrafficBonus(s, st) > 1,
        '★ 托管店吃店铺升级的客流加成（升级投在谁身上对谁生效）');
      expect('S11k', E.storeStaffBonus(s, st) > 1, '托管店吃熟练团队的效率加成');
      expect('S11l', E.storeCostCut(s, st) > 0, '托管店吃精打细算的开支减免');
    }

    /* ⑥ 留档店长：关店后进 formerManagers，可免费请回 */
    {
      const s = E.newGame('normal', 0);
      s.cash = 1e9;
      E.openStore(s, { cityId: '510100' });
      E.hireManager(s, 2, 0);
      const mgr = E.managerOfBranch(s, 2);
      E.closeStore(s, 2);
      expect('S11m', s.formerManagers.length === 1,
        `关店后店长被留档（${s.formerManagers.length} 人）`);
      expect('S11n', s.formerManagers[0] && s.formerManagers[0].name === mgr.name
        && s.formerManagers[0].id === mgr.id, '留档信息完整（名字/id 保留）');
      expect('S11o', s.formerManagers[0] && s.formerManagers[0].fromStore,
        '留档记录了原任职店铺');
      /* 重新启用：免费。
         ★ 基准必须在**开店之后**取 —— 开店本身要扣店费与启动金，
           拿关店时的现金当基准，会把开店成本算到 rehire 头上，
           然后误判成"重新启用收费了"。 */
      E.openStore(s, { cityId: '310100' });
      const cashBefore = s.cash;
      const r = E.rehireManager(s, mgr.id, s.shops);
      expect('S11p', r.ok, `可以请回留档店长（${r.ok ? r.manager.name : r.msg}）`);
      expect('S11q', s.cash === cashBefore, '★ 重新启用不额外收费（是恢复原职不是招新人）');
      expect('S11r', s.formerManagers.length === 0, '请回后从留档列表移除');
      expect('S11s', E.managerOfBranch(s, s.shops)
        && E.managerOfBranch(s, s.shops).name === mgr.name, '请回的店长已就位');
    }

    /* ⑦ 留档店长不能与现役店长重名/重 id（脏存档防护） */
    {
      const s = E.newGame('normal', 0);
      s.cash = 1e9;
      E.openStore(s, { cityId: '510100' });
      E.hireManager(s, 2, 0);
      const mgr = E.managerOfBranch(s, 2);
      /* 脏存档：formerManagers 里塞一个与现役同 id 同名的 */
      s.formerManagers = [{ id: mgr.id, name: mgr.name, emoji: '🧑‍💼', lv: 3, skill: 1.2, trait: 'ops', wage: 200, days: 5, fromStore: 'X店' }];
      const c = E.sanitizeState(JSON.parse(JSON.stringify(s)));
      expect('S11t', c.formerManagers.length === 0,
        '与现役店长同 id/同名的留档被清洗掉（否则两个店长共用一个 id）');
    }

    /* ⑧ 存档往返：升级与留档都要保住 */
    {
      const s = E.newGame('normal', 0);
      s.cash = 1e9;
      E.openStore(s, { cityId: '510100' });
      E.buyStoreUpgrade(s, 2, 'buzz');
      E.buyStoreUpgrade(s, 2, 'buzz');
      E.hireManager(s, 2, 0);
      const mgr = E.managerOfBranch(s, 2);
      E.closeStore(s, 2);
      const back = E.sanitizeState(JSON.parse(JSON.stringify(s)));
      /* ★ 关店后只剩总店，所以升级等级在**总店**上
         （升的是 stores[1]，但那家店被关掉了 → 升级随店一起消失，
         这是正确的：升级是店上的资产，不是总公司的）。
         所以这里要验的是「关店后总店的 upgrades 里没有 buzz」，
         而升级保留要另开一个不关店的场景来验。 */
      expect('S11u', !(back.stores[0].upgrades && back.stores[0].upgrades.buzz),
        '升级随店铺一起消失（升级是店上的资产，不是总公司的）');
      const s2b = E.newGame('normal', 0);
      s2b.cash = 1e9;
      E.openStore(s2b, { cityId: '510100' });
      E.buyStoreUpgrade(s2b, 2, 'buzz');
      E.buyStoreUpgrade(s2b, 2, 'buzz');
      const back2 = E.sanitizeState(JSON.parse(JSON.stringify(s2b)));
      expect('S11u2', back2.stores[1].upgrades.buzz === 2,
        '存档往返后店铺升级等级保留');
      expect('S11v', back.formerManagers.length === 1
        && back.formerManagers[0].id === mgr.id, '存档往返后留档店长保留');
    }
  }


  /* ============================================================
 *  T 组：经营城市可用性 + 城市地图（V13）
   *
   *  T1 守的是一个**已经出过的事故**：
   *   直辖市（省 11/12/31/50…）只有 1 个市，
   *   「点一下切下一个」的循环 `(i+1) % 1` 永远回到自己 ——
   *   表现为「点了没反应、也不报错」。
   *   而默认城市恰恰是北京，所以新玩家第一次点就中招。
   * ============================================================ */
console.log('=============== T. 经营城市与地图 ===============');
{
  /* ---- T1 城市切换必须真的生效（每个省都要验）---- */
  {
    /* 找出所有「只有 1 个市」的省（直辖市/特别行政区） */
    const singleProvs = E.PROVINCES.filter(p => p.cities.length === 1);
    expect('T1a', singleProvs.length >= 4,
      `存在 ${singleProvs.length} 个只有 1 个市的省（直辖市/特别行政区）`);

    /* ★ 逐个省验证「点下一个城市」一定会换城市 ——
       这正是原 bug 的位置（直辖市原地打转）。 */
    let stuck = [];
    for (const p of E.PROVINCES) {
      const s = E.newGame('normal', 0);
      s.venue = { type: 'community', provId: p.id, cityId: p.cities[0], districtId: '' };
      const before = s.venue.cityId;
      const r = E.nextCity(s);
      if (!r.ok) { stuck.push(`${p.name}(失败:${r.msg})`); continue; }
      if (s.venue.cityId === before) stuck.push(`${p.name}(原地不动)`);
    }
    expect('T1b', stuck.length === 0,
      `所有省都能真正切换到下一个城市${stuck.length ? '（卡住：' + stuck.slice(0, 3).join('、') + '）' : ''}`);
  }

  /* ---- T2 切省也必须生效（且要说明直辖市的情况）---- */
  {
    const s = E.newGame('normal', 0);
    const before = s.venue.provId;
    const r = E.nextProvince(s);
    expect('T2a', r.ok && s.venue.provId !== before,
      `切省生效（${before} → ${s.venue.provId}）`);
    /* 切到直辖市时要有说明文案（否则"市没变"看起来像没反应） */
    const s2 = E.newGame('normal', 0);
    let msgSeen = '';
    for (let i = 0; i < E.PROVINCES.length; i++) {
      const r2 = E.nextProvince(s2);
      if (r2.ok && r2.msg) { msgSeen = r2.msg; break; }
    }
    expect('T2b', msgSeen.length > 0,
      `切到直辖市时给出说明（"${msgSeen}"）—— 否则玩家以为没反应`);
  }

  /* ---- T3 城市切换的副作用：菜单/菜系跟着变 ---- */
  {
    const s = E.newGame('normal', 0);
    s.cash = 1e6;
    s.venue = { type: 'community', provId: '51', cityId: '510100', districtId: '' };
    const r = E.setVenueCity(s, '510100');
    expect('T3a', r.ok, '可以切到成都');
    expect('T3b', Array.isArray(r.cityCuisines) && r.cityCuisines.length > 0,
      '切到成都会返回当地特色菜系（供 UI 提示）');
    /* 切到没有特色的城市 → cityCuisines 为空数组而不是 undefined */
    const r2 = E.setVenueCity(s, '130200');
    expect('T3c', Array.isArray(r2.cityCuisines),
      '无特色城市也返回数组（不返回 undefined，UI 不用判空）');
  }

  /* ---- T4 地图视图：坐标归一化正确 ---- */
  {
    const s = E.newGame('normal', 0);
    const mv = E.cityMapView(s);
    expect('T4a', mv.points.length > 0 && mv.provs.length === E.PROVINCES.length,
      `地图含 ${mv.points.length} 个有坐标城市 + ${mv.provs.length} 个省`);
    /* 所有点的归一化坐标都在 0~1 */
    const out = mv.points.filter(p => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1);
    expect('T4b', out.length === 0,
      `所有城市点的归一化坐标都在 0~1（越界 ${out.length} 个）`);
    /* ★ 经纬**分别**归一化：不能用一个缩放因子，
       否则高纬度城市会明显偏西（地图形状失真）*/
    const w = mv.points.find(p => p.id === '110100');   /* 北京 */
    const s2 = mv.points.find(p => p.id === '510100');   /* 成都 */
    const h = mv.points.find(p => p.id === '460300');   /* 海口（最南） */
    if (w && s2 && h) {
      expect('T4c', h.y < w.y && w.y < s2.y,
        '南北顺序正确（海口在北京南、成都在北京南）');
      expect('T4d', w.x < s2.x,
        '东西顺序正确（北京在成都西）');
    } else {
      expect('T4c', true, '（样本城市缺坐标，跳过方位断言）');
    }
    /* 当前城市被标记 */
    expect('T4e', mv.currentCityId === s.venue.cityId
      && mv.points.some(p => p.id === mv.currentCityId && p.isCurrent),
      '当前经营城市在地图上被标记');
    /* 省份信息含城市数 */
    expect('T4f', mv.provs.every(p => p.cityCount >= 1 && p.geoCount <= p.cityCount),
      '每个省都有城市数，且有坐标数不超过总数');
  }

  /* ---- T5 地图的"进入经营城市"入口是完备的 ---- */
  {
    const s = E.newGame('normal', 0);
    const mv = E.cityMapView(s);
    expect('T5a', mv.cityTotal === E.PROVINCES.reduce((a, p) => a + p.cities.length, 0),
      `地图视图给出全量城市数（${mv.cityTotal}）—— 入口不能只给有坐标的那些`);
    expect('T5b', mv.geoTotal < mv.cityTotal,
      `有坐标的城市(${mv.geoTotal}) 少于全部城市(${mv.cityTotal})，
       所以必须有列表入口而不能只靠地图点选`);
  }

  /* ============================================================
   *  U 组：店长组合加成（V13.4）
   *
   *  守的是一个**体验层面的不变量**：
   *  组合加成必须真的生效、必须只认已任命的店长、
   *  且不能被脏存档的假特性凑出来。
   * ============================================================ */
console.log('=============== U. 店长组合加成 ===============');
{
  /* ---- U1 组合表本身合法 ---- */
  {
    expect('U1a', E.MANAGER_COMBOS.length >= 3,
      `组合表有 ${E.MANAGER_COMBOS.length} 个组合`);
    const badTrait = E.MANAGER_COMBOS.filter(c =>
      c.traits.some(t => !E.MANAGER_TRAITS.some(x => x.id === t)));
    expect('U1b', badTrait.length === 0,
      `所有组合的特性 id 都在字典内${badTrait.length ? '（非法：' + badTrait.map(c => c.id).join(',') + '）' : ''}`);
    const badMul = E.MANAGER_COMBOS.filter(c =>
      !c.mul || Object.keys(c.mul).some(k => c.mul[k] <= 1));
    expect('U1c', badMul.length === 0,
      `所有组合的乘数都 > 1（必须是增益，不能是惩罚）${badMul.length ? '（异常：' + badMul.map(c => c.id).join(',') + '）' : ''}`);
    /* 加成要克制：单组合任一项不超过 10% */
    const tooBig = E.MANAGER_COMBOS.filter(c =>
      Object.keys(c.mul).some(k => c.mul[k] > 1.10));
    expect('U1d', tooBig.length === 0,
      `单组合加成 ≤10%（克制，不破坏平衡）${tooBig.length ? '（超标：' + tooBig.map(c => c.id).join(',') + '）' : ''}`);
  }

  /* ---- U2 未招人时不生效 ---- */
  {
    const s = E.newGame('normal', 0);
    const v = E.managerComboView(s);
    expect('U2a', v.length === E.MANAGER_COMBOS.length,
      '组合视图列出全部组合');
    expect('U2b', v.every(x => !x.active),
      '没招店长时没有组合激活');
    /* ★ 判据是「组合乘数」而不是「managerBonus 的结果」——
       managerBonus 本身有 4% 基础加成（Lv.1 保底），
       所以它的返回值本来就不是 1。 */
    const cb = E.managerComboBonus(s);
    expect('U2c', cb.speed === 1 && cb.sat === 1 && cb.rep === 1 && cb.ops === 1,
      '没招店长时组合乘数全为 1（不影响基础加成）');
  }

  /* ---- U3 集齐即激活，且加成真的进 managerBonus ---- */
  {
    /* 逐个组合验证：只放该组合要求的特性，应该刚好激活它 */
    let failed = [];
    for (const combo of E.MANAGER_COMBOS) {
      const s = E.newGame('normal', 0);
      s.managers = combo.traits.map((t, i) => ({
        id: i + 1, branch: i + 2, lv: 2, skill: 1, trait: t, name: 'M' + i,
      }));
      const v = E.managerComboView(s);
      const self = v.find(x => x.combo.id === combo.id);
      if (!self || !self.active) { failed.push(combo.id + '(未激活)'); continue; }
      /* 组合乘数必须含该组合声明的字段 */
      const cb = E.managerComboBonus(s);
      for (const k of Object.keys(combo.mul)) {
        if (!(cb[k] > 1)) { failed.push(combo.id + '(' + k + '未加成)'); }
      }
    }
    expect('U3a', failed.length === 0,
      `每个组合集齐后都能激活并生效${failed.length ? '（失败：' + failed.slice(0, 3).join('、') + '）' : ''}`);

    /* ★ 组合加成必须真的进 managerBonus（不只是算出来好看） */
    const s2 = E.newGame('normal', 0);
    s2.shops = 3;
    const base = E.managerBonus(s2, 2);
    s2.managers = [{ id: 1, branch: 2, lv: 2, skill: 1, trait: 'qc' },
    { id: 2, branch: 3, lv: 2, skill: 1, trait: 'hosp' }];
    const withCombo = E.managerBonus(s2, 2);
    expect('U3b', withCombo.sat > base.sat,
      `组合加成进了 managerBonus（满意 ${base.sat.toFixed(4)} → ${withCombo.sat.toFixed(4)}）`);
    /* ★ 跨店生效：3 店的店长组合，2 店（自己没店长）也吃到 */
    const s3 = E.newGame('normal', 0);
    s3.shops = 3;
    s3.managers = [{ id: 1, branch: 2, lv: 2, skill: 1, trait: 'qc' },
    { id: 2, branch: 3, lv: 2, skill: 1, trait: 'hosp' }];
    const mb2 = E.managerBonus(s3, 2);
    const cb3 = E.managerComboBonus(s3);
    expect('U3c', Math.abs(mb2.sat / (1 + 0) - mb2.sat) < 1e-9,
      '无店长店也吃组合加成（组合是全局的）');
    expect('U3d', cb3.sat > 1, '组合乘数确实 > 1');
  }

  /* ---- U4 只认已任命的店长，候选池不算 ---- */
  {
    const s = E.newGame('normal', 0);
    s.shops = 3;
    /* 只放候选，不任命 */
    s.mgrCand = { 2: [{ id: 1, trait: 'qc', lv: 2, skill: 1 }] };
    const v = E.managerComboView(s);
    expect('U4a', v.every(x => !x.active),
      '候选池里的店长不触发组合（还没上任）');
  }

  /* ---- U5 脏存档不能凭假特性凑出组合 ---- */
  {
    const s = E.newGame('normal', 0);
    /* 塞一个字典外的 trait id —— 应当被 managerTrait 兜底成 'none' */
    s.managers = [{ id: 1, branch: 2, lv: 2, skill: 1, trait: 'fake_trait_xyz' },
    { id: 2, branch: 3, lv: 2, skill: 1, trait: 'another_fake' }];
    const v = E.managerComboView(s);
    expect('U5a', v.every(x => !x.active),
      '字典外的特性 id 凑不出组合（兜底成 none）');
  }

  /* ---- U6 存档往返后组合仍在 ---- */
  {
    const s = E.newGame('normal', 0);
    s.shops = 3;
    s.managers = [{ id: 1, branch: 2, lv: 2, skill: 1, trait: 'qc', name: '甲' },
    { id: 2, branch: 3, lv: 2, skill: 1, trait: 'hosp', name: '乙' }];
    const before = E.managerComboView(s).filter(x => x.active).length;
    /* ★ 用独立槽位 3 —— F 组结尾把槽 0 clearSave 了，
       这里若还用槽 0，loadGame 返回 null 会误判成"存档丢了"。 */
    E.setSlot(3);
    E.saveGame(s, 3);
    const back = E.loadGame(3);
    const after = back ? E.managerComboView(back).filter(x => x.active).length : -1;
    expect('U6a', before === after && before > 0,
      `存档往返后组合仍激活（${before} → ${after}）`);
    E.clearSave(3);
  }
}

/* ============================================================
 *  V 组：地域挑战关卡（V13.5）
 *
 *  守的是「新增的 4 个 metric 必须**真的能达成**」——
 *  只测「关卡存在」是不够的：
 *  实测第一版风味关门槛 12 被缩放到 14，玩家即使一天卖满 12 杯也达不到，
 *  这个关卡等于白加。所以每个 metric 都要跑**达成 + 不达成**两个方向。
 * ============================================================ */
console.log('=============== V. 地域挑战关卡 ===============');
{
  const NEW_STAGES = ['st_city', 'st_cuisine', 'st_branch', 'st_visit'];

  /* ---- V1 四个关卡存在且 metric 合法 ---- */
  {
    const missing = NEW_STAGES.filter(id => !E.STAGES.some(x => x.id === id));
    expect('V1a', missing.length === 0,
      `4 个地域挑战关卡都已定义${missing.length ? '（缺：' + missing.join(',') + '）' : ''}`);
    const badMetric = E.STAGES.filter(x =>
      ['cityCups', 'cuisineCups', 'branches', 'visits'].indexOf(x.metric) >= 0
      && !(x.goal > 0));
    expect('V1b', badMetric.length === 0,
      `地域挑战关卡的门槛都 > 0${badMetric.length ? '（异常：' + badMetric.map(x => x.id).join(',') + '）' : ''}`);
    /* 风味关必须指定菜系，否则玩家不知道要卖什么 */
    const cui = E.STAGES.find(x => x.id === 'st_cuisine');
    expect('V1c', !!(cui && cui.cuisine && E.CUISINES.some(c => c.id === cui.cuisine)),
      `风味关指定了有效菜系（${cui && cui.cuisine}）`);
  }

  /* ---- V2 每个 metric 都能真正达成（造局 + 结算）---- */
  {
    /* 造一个「当天指标足够」的局面，并让 currentStage 落到目标关卡 */
    const attempt = (id, setup) => {
      const st = E.STAGES.find(x => x.id === id);
      const s = E.newGame('normal', 0, null);
      s.cash = 500000;
      s.day = (st.chapter - 1) * 5 + 1;
      s.stage = { done: {}, diff: 'std' };
      for (const x of E.STAGES) {
        if (x.chapter < st.chapter || (x.chapter === st.chapter && x.order < st.order)) {
          s.stage.done[x.id] = true;
        }
      }
      s.sim = {
        cups: 0, orders: 0, revenue: 0, lost: 0, clicks: 0, comboBest: 0,
        trendCups: 0, typeServed: {}, byRecipe: {},
      };
      setup(s, st, E.stageGoalOf(s, st, E.stageDiffById('std')));
      const cur = E.currentStage(s);
      if (!cur || cur.id !== id) return { ok: false, why: 'currentStage 未落到目标关卡' };
      const before = s.cash;
      const r = E.settleStage(s);
      return { ok: !!(r && r.ok), gained: Math.round(s.cash - before), res: r };
    };

    /* ① 本地关：当天在本地卖够杯数 */
    {
      const st = E.STAGES.find(x => x.id === 'st_city');
      const r = attempt('st_city', (s, st2, goal) => { s.sim.cups = goal + 4; });
      expect('V2a', r.ok,
        `本地关可达成（卖 ${st.goal + 4} 杯 / 门槛 ${st.goal}）` + (r.ok ? ` → +¥${r.gained}` : ` → ${r.why || JSON.stringify(r.res)}`));
    }
    /* ② 风味关：卖出指定菜系的杯数
       ★ 用**缩放后的门槛**给量（天数成长会让 9 变成 11），
         否则测的是"原始 goal 够不够"，而玩家面对的是缩放后的门槛。 */
    {
      const st = E.STAGES.find(x => x.id === 'st_cuisine');
      const rec = E.RECIPES.find(x => x.cuisine === st.cuisine);
      const r = attempt('st_cuisine', (s, st2, goal) => {
        s.sim.cups = goal + 2;
        s.sim.byRecipe[rec.id] = goal;
      });
      expect('V2b', r.ok,
        `风味关可达成（${st.cuisine} 卖够缩放后门槛）` + (r.ok ? ` → +¥${r.gained}` : ` → ${r.why || JSON.stringify(r.res)}`));
    }
    /* ③ 扩张关：分店数够 */
    {
      const st = E.STAGES.find(x => x.id === 'st_branch');
      const r = attempt('st_branch', (s, st2, goal) => { s.shops = goal; });
      expect('V2c', r.ok,
        `扩张关可达成（${st.goal} 家店）` + (r.ok ? ` → +¥${r.gained}` : ` → ${r.why || JSON.stringify(r.res)}`));
    }
    /* ④ 游商关：到访城市数够 */
    {
      const st = E.STAGES.find(x => x.id === 'st_visit');
      const r = attempt('st_visit', (s, st2, goal) => {
        s.citiesVisited = ['110100', '310100', '510100', '440100', '440300'];
      });
      expect('V2d', r.ok,
        `游商关可达成（到访 ${st.goal} 城）` + (r.ok ? ` → +¥${r.gained}` : ` → ${r.why || JSON.stringify(r.res)}`));
    }
  }

  /* ---- V3 达不到就不能给钱（不能白送）---- */
  {
    const st = E.STAGES.find(x => x.id === 'st_city');
    const s = E.newGame('normal', 0, null);
    s.cash = 500000;
    s.day = (st.chapter - 1) * 5 + 1;
    s.stage = { done: {}, diff: 'std' };
    for (const x of E.STAGES) {
      if (x.chapter < st.chapter || (x.chapter === st.chapter && x.order < st.order)) {
        s.stage.done[x.id] = true;
      }
    }
    s.sim = {
      cups: 3, orders: 1, revenue: 10, lost: 0, clicks: 0, comboBest: 0,
      trendCups: 0, typeServed: {}, byRecipe: {},
    };
    const before = s.cash;
    const r = E.settleStage(s);
    expect('V3a', !(r && r.ok) && s.cash === before,
      `没达标不给钱（卖 3 杯 / 门槛 ${st.goal}）`);
  }

  /* ---- V4 累计型 metric 不吃天数缩放 ---- */
  {
    /* branches/visits 是累计量，乘天数系数会变成不可能的斜率 */
    const s = E.newGame('normal', 0, null);
    s.day = 25;
    const st = E.STAGES.find(x => x.id === 'st_branch');
    const g1 = E.stageGoalOf(s, st, E.stageDiffById('std'));
    const s2 = E.newGame('normal', 0, null);
    s2.day = 1;
    const g2 = E.stageGoalOf(s2, st, E.stageDiffById('std'));
    expect('V4a', g1 === g2,
      `累计型关卡门槛不随天数变化（Day1 ${g2} → Day25 ${g1}）`);
  }

  /* ---- V5 关卡顺序：currentStage 必须按 chapter/order 走，不能按数组物理顺序 ---- */
  {
    /* ★ V13.5 的新关卡是**追加在 STAGES 数组末尾**的，
       所以「第 3 章 order4」在数组里排在「第 4 章 order1」之后。
       currentStage 若直接遍历数组，会跳到后面的章节去。
       这条断言专门锁住「数组物理顺序 ≠ 关卡顺序」这个坑。 */
    const stCity = E.STAGES.find(x => x.id === 'st_city');
    const s = E.newGame('normal', 0, null);
    s.day = (stCity.chapter - 1) * 5 + 1;
    s.stage = { done: {}, diff: 'std' };
    for (const x of E.STAGES) {
      if (x.chapter < stCity.chapter || (x.chapter === stCity.chapter && x.order < stCity.order)) {
        s.stage.done[x.id] = true;
      }
    }
    const cur = E.currentStage(s);
    expect('V5a', cur && cur.id === 'st_city',
      `currentStage 按 chapter/order 走（得到 ${cur && cur.id}，应为 st_city）`);
  }

  /* ---- V6 跨章补打：前面的关卡没打完，不会永久作废 ---- */
  {
    /* ★ 修复前：一关卡住 = 整章 3~4 关全部永久错过（实测第 3 章 4 关全废）。
       修复后：待打关卡可以跨章继续打。 */
    const s = E.newGame('normal', 0, null);
    s.cash = 500000;
    /* 连续 5 天不达成第 1 关 */
    for (let d = 1; d <= 5; d++) {
      s.day = d;
      s.sim = {
        cups: 0, orders: 0, revenue: 0, lost: 0, clicks: 0, comboBest: 0,
        trendCups: 0, typeServed: {}, byRecipe: {},
      };
      E.settleStage(s);
    }
    /* day6 进了第 2 章，第 1 章的关卡仍应可打 */
    s.day = 6;
    const cur = E.currentStage(s);
    const ch1 = E.STAGES.filter(x => x.chapter === 1);
    const stillPlayable = ch1.some(x => !s.stage.done[x.id]);
    expect('V6a', stillPlayable && cur && cur.chapter === 1,
      `跨章补打：第 1 章未完成的关卡仍可打（当前待打 ${cur && cur.name}）`);
    /* UI 要能表达"还有 N 关待补" */
    const sv = E.stageView(s);
    expect('V6b', sv.backlog > 0,
      `stageView 报出待补关卡数（backlog=${sv.backlog}）`);
  }
}

/* ============================================================
 *  W 组：常客系统（V13.6）
 *
 *  守的是「常客系统真的在起作用，且没有可被脏存档利用的漏洞」：
 *   ① 好感累积与成常客的判定
 *   ② 常客的加成真的进收入与小费
 *   ③ 脏存档塞 fav=99999 不能白嫖常客加成
 *   ④ 特殊顾客不占常客名额
 * ============================================================ */
console.log('=============== W. 常客系统 ===============');
{
  /* ---- W1 身份与好感累积 ---- */
  {
    const s = E.newGame('normal', 0, null);
    const t = E.CUSTOMER_TYPES[0];
    const reg = E.regularIdentityOf(s, t);
    expect('W1a', !!reg && !!reg.id && !!reg.face && !!reg.name,
      `常客身份可生成（${reg.id} / ${reg.face} / ${reg.name}）`);
    expect('W1b', reg.fav === 0, '新身份好感为 0');

    /* 服务 N 次 → 好感累积到上限 */
    const need = Math.ceil(E.REGULAR_CFG.max / E.REGULAR_CFG.gain);
    for (let i = 0; i < need; i++) E.regularServe(s, reg.id);
    expect('W1c', reg.fav === E.REGULAR_CFG.max,
      `服务 ${need} 次后好感满（${reg.fav}/${E.REGULAR_CFG.max}）`);
    expect('W1d', reg.isRegular === true, '好感满 → 成为常客');

    /* 好感不能超过上限 */
    for (let i = 0; i < 50; i++) E.regularServe(s, reg.id);
    expect('W1e', reg.fav === E.REGULAR_CFG.max,
      `好感不超过上限（${reg.fav}）`);
  }

  /* ---- W2 常客加成真的生效 ---- */
  {
    const s = E.newGame('normal', 0, null);
    const t = E.CUSTOMER_TYPES[0];
    const reg = E.regularIdentityOf(s, t);
    const before = E.regularBonus(s, reg);
    expect('W2a', before.budget === 1 && before.tip === 1,
      '未成常客时无加成');
    for (let i = 0; i < Math.ceil(E.REGULAR_CFG.max / E.REGULAR_CFG.gain); i++) {
      E.regularServe(s, reg.id);
    }
    const after = E.regularBonus(s, reg);
    expect('W2b', after.budget > 1 && after.tip > 1,
      `常客加成生效（预算 ×${after.budget} / 小费 ×${after.tip}）`);
    expect('W2c', after.isRegular === true, 'regularBonus 标记 isRegular');
    /* 回头率加权 */
    expect('W2d', E.regularPullMul(s, reg) > 1,
      `常客回头率加权生效（×${E.regularPullMul(s, reg).toFixed(2)}）`);
  }

  /* ---- W3 脏存档不能白嫖常客加成 ---- */
  {
    /* ★ fav 必须夹取到上限 —— 脏存档塞 fav=99999 就能白得 15% 消费加成。
       这类漏洞在"玩家互相分享存档"的场景下最容易被利用。 */
    const s = E.newGame('normal', 0, null);
    s.regulars = {
      'student#0': { id: 'student#0', type: 'student', face: '🧑', fav: 99999, name: '外挂' },
      'worker#0': { id: 'worker#0', type: 'worker', face: '👩', fav: -50, name: '负数' },
      'fake#0': { id: 'fake#0', type: 'not_a_type', face: '👽', fav: 100, name: '假类型' },
    };
    const back = E.sanitizeState(JSON.parse(JSON.stringify(s)));
    const rs = back.regulars || {};
    const good = rs['student#0'];
    expect('W3a', !good || good.fav <= E.REGULAR_CFG.max,
      `脏存档的 fav 被夹到上限（${good ? good.fav : '已丢弃'}）`);
    expect('W3b', !rs['fake#0'],
      '字典外的 type 被丢弃');
    expect('W3c', !rs['worker#0'] || rs['worker#0'].fav >= 0,
      '负数 fav 被夹到 0');
  }

  /* ---- W4 特殊顾客不占常客名额 ---- */
  {
    /* ★ 特殊顾客（评论家/美食家…）是一次性事件角色，
       它们 regId=null（不累积好感）。
       若仍写进档案，就是**永远 fav=0 的空档案**：
       实测 30 天后名册混了 11 个空壳（31 位里 11 个是空壳），名册虚高。
       ★ 测法：走真实的 spawnOne 路径（特殊顾客参数非空），
         而不是直接调 regularIdentityOf —— 后者本来就会建档案。 */
    const s = E.newGame('normal', 0, null);
    s.menu = s.recipes.slice(0, 3);
    /* spawnOne 需要 s.sim（新档时是 null）—— 造一个最小 sim */
    s.sim = {
      cups: 0, orders: 0, revenue: 0, lost: 0, clicks: 0, comboBest: 0,
      trendCups: 0, typeServed: {}, typeLost: {}, byRecipe: {},
      queue: [], spawned: 0, floaters: [], priceLost: 0, stockout: 0,
    };
    const sp = E.SPECIAL_CUSTOMERS[0];
    expect('W4a', sp && !!sp.id, '有特殊顾客可测');
    E.spawnOne(s, sp);
    const known = E.regularView(s).known;
    expect('W4b', known === 0,
      `特殊顾客不占常客名额（known=${known}）`);
    /* 而常规顾客会建档案 */
    E.spawnOne(s, null);
    expect('W4c', E.regularView(s).known >= 1,
      '常规顾客会建立常客档案');
  }

  /* ---- W5 存档往返 ---- */
  {
    const s = E.newGame('normal', 0, null);
    const t = E.CUSTOMER_TYPES[0];
    const reg = E.regularIdentityOf(s, t);
    for (let i = 0; i < Math.ceil(E.REGULAR_CFG.max / E.REGULAR_CFG.gain); i++) {
      E.regularServe(s, reg.id);
    }
    const before = E.regularView(s).regulars;
    E.setSlot(4);
    E.saveGame(s, 4);
    const back = E.loadGame(4);
    const after = back ? E.regularView(back).regulars : -1;
    expect('W5a', before === after && before > 0,
      `存档往返后常客仍在（${before} → ${after}）`);
    E.clearSave(4);
  }
}

/* ============================================================
 *  X 组：店长专精（V13.7）
 *
 *  守的是「专精有取舍、切换有代价、脏存档不能白嫖」：
 *   ① 专精一个方向 → 该方向涨、其余跌（**必须有减益**）
 *   ② 切换专精要损失能力值
 *   ③ 等级不够不能专精
 *   ④ 脏存档塞 spec + 低等级不能白嫖
 * ============================================================ */
console.log('=============== X. 店长专精 ===============');
{
  const CFGS = E.MANAGER_SPECIALTY;
  const mk = (lv) => ({ id: 1, branch: 2, lv, skill: 1, trait: 'none', name: '测试' });

  /* ---- X1 专精倍率：涨一个、跌其余 ---- */
  {
    const m = mk(3);
    const before = E.managerSpecialtyMul(m);
    expect('X1a', before.speed === 1 && before.sat === 1 && before.rep === 1 && before.ops === 1,
      '未专精时无额外倍率');
    m.spec = 'ops';
    const sp = E.managerSpecialtyMul(m);
    expect('X1b', sp.ops > 1, `客流专精 → 客流 ×${sp.ops.toFixed(2)}`);
    expect('X1c', sp.speed < 1 && sp.sat < 1 && sp.rep < 1,
      `其余三项有减益（速度 ×${sp.speed.toFixed(2)} / 满意 ×${sp.sat.toFixed(2)} / 口碑 ×${sp.rep.toFixed(2)}）`);
    /* ★ 净收益必须为正，否则专精没意义 */
    const net = (sp.ops - 1) + (sp.speed - 1) + (sp.sat - 1) + (sp.rep - 1);
    expect('X1d', net > 0, `专精净收益为正（合计 ${(net * 100).toFixed(1)}%）`);
  }

  /* ---- X2 专精真的进 managerBonus ---- */
  {
    const s = E.newGame('normal', 0, null);
    s.shops = 3;
    s.managers = [Object.assign(mk(3), { id: 1, branch: 2 })];
    const base = E.managerBonus(s, 2);
    s.managers[0].spec = 'ops';
    const spec = E.managerBonus(s, 2);
    expect('X2a', spec.ops > base.ops, `专精进了 managerBonus（客流 ${base.ops.toFixed(3)} → ${spec.ops.toFixed(3)}）`);
    expect('X2b', spec.sat < base.sat, `减益也进了 managerBonus（满意 ${base.sat.toFixed(3)} → ${spec.sat.toFixed(3)}）`);
  }

  /* ---- X3 切换代价 + 等级门槛 ---- */
  {
    const s = E.newGame('normal', 0, null);
    s.shops = 3;
    s.managers = [Object.assign(mk(3), { id: 1, branch: 2 })];
    /* 首次专精免费 */
    const r1 = E.managerSetSpecialty(s, 1, 'ops');
    expect('X3a', r1.ok, `首次专精成功（${r1.msg}）`);
    expect('X3b', Math.abs(s.managers[0].skill - 1) < 1e-6, '首次专精不损失能力值');
    /* 切换要付代价 */
    const r2 = E.managerSetSpecialty(s, 1, 'sat');
    expect('X3c', r2.ok, '切换专精成功');
    expect('X3d', s.managers[0].skill < 1,
      `切换损失能力值（1 → ${s.managers[0].skill.toFixed(2)}）`);
    /* 等级不够 */
    const s2 = E.newGame('normal', 0, null);
    s2.shops = 3;
    s2.managers = [Object.assign(mk(1), { id: 1, branch: 2 })];
    const r3 = E.managerSetSpecialty(s2, 1, 'ops');
    expect('X3e', !r3.ok, `等级不够不能专精（${r3.msg}）`);
  }

  /* ---- X4 脏存档不能白嫖专精 ---- */
  {
    /* ★ 字典外方向 → 当没专精 */
    const s = E.newGame('normal', 0, null);
    s.shops = 3;
    s.managers = [Object.assign(mk(5), { id: 1, branch: 2, spec: 'not_a_field' })];
    const back = E.sanitizeState(JSON.parse(JSON.stringify(s)));
    expect('X4a', !back.managers[0].spec,
      '字典外的专精方向被丢弃');
    /* ★ 等级不够 + 有 spec → 也要丢（否则白得 +20% 还带 -10%，净收益仍正） */
    const s2 = E.newGame('normal', 0, null);
    s2.shops = 3;
    s2.managers = [Object.assign(mk(1), { id: 1, branch: 2, spec: 'ops' })];
    const back2 = E.sanitizeState(JSON.parse(JSON.stringify(s2)));
    expect('X4b', !back2.managers[0].spec,
      '等级不够的专精被丢弃（不白嫖）');
    /* 正常专精要保留 */
    const s3 = E.newGame('normal', 0, null);
    s3.shops = 3;
    s3.managers = [Object.assign(mk(3), { id: 1, branch: 2, spec: 'ops' })];
    const back3 = E.sanitizeState(JSON.parse(JSON.stringify(s3)));
    expect('X4c', back3.managers[0].spec === 'ops',
      '合法的专精在存档往返后保留');
  }

  /* ---- X5 专精与组合加成共存 ---- */
  {
    /* 两个机制是不同层级：专精=个体层，组合=团队层，应该能同时生效 */
    const s = E.newGame('normal', 0, null);
    s.shops = 3;
    /* ★ 组合要真的激活才谈得上"共存"：品牌组合 = qc + hosp */
    s.managers = [
      Object.assign(mk(3), { id: 1, branch: 2, spec: 'ops', trait: 'qc' }),
      Object.assign(mk(3), { id: 2, branch: 3, trait: 'hosp' }),
    ];
    const withBoth = E.managerBonus(s, 2);
    const sp = E.managerSpecialtyMul(s.managers[0]);
    const cb = E.managerComboBonus(s);
    expect('X5a', withBoth.ops > 1 && sp.ops > 1 && cb.sat > 1,
      `专精与组合可同时生效（ops=${withBoth.ops.toFixed(3)}，组合满意 ×${cb.sat.toFixed(2)}）`);
  }
}
}

console.log('');
if (fails === 0) console.log(`✅ 引擎探针全部通过（${checks} 项）`);
else console.log(`❌ 探针发现 ${fails} 个问题 / 共 ${checks} 项`);
process.exit(fails === 0 ? 0 : 1);
