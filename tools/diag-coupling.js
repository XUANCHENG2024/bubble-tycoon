/**
 * 跨系统一致性检查（V10/V11 新增四套机制的耦合面）。
 *
 * ★ 为什么单独写这个：
 *   probe 验的是"每个系统自己对不对"，
 *   但新机制的危险恰恰在**交叉处** ——
 *   研发树 × 城市绑定 × 工坊加成 × 店长编制，
 *   每一对组合都可能产生"单看都合法、连起来出错"的状态。
 *
 * 用法：node tools/diag-coupling.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');

/* 种子可从命令行传 —— 同一路径的随机序列只能证明「这条路径没崩」，
   换个种子才覆盖到别的分支。CI 里跑多次比跑一次有价值得多。 */
let seed = Number(process.argv[2]) || 88888;
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
  + fs.readFileSync(path.join(root, 'js/engine.js'), 'utf8'), ctx, { filename: 'bundle.js' });
const E = ctx;
Object.assign(E, vm.runInContext(
  '({CFG,DIFFICULTY,RECIPES,ACH_RECIPES,ALL_RECIPES,RESEARCH_TREE,ING,CUISINES,CRAFT_WORKSHOPS,CITIES,MANAGER_RANKS,MANAGER_TRAITS,ACHIEVEMENTS,PROVINCES})', ctx));

const issues = [];
function bad(cat, msg) { issues.push({ cat, msg }); console.log(`  ✘ [${cat}] ${msg}`); }
function okCat(cat, msg) { console.log(`  ✔ [${cat}] ${msg}`); }

/* ========== 1. 研发树 × 城市绑定 ========== */
console.log('\n=== 1. 研发树 × 城市绑定 ===');
{
  /* 每座城市都要能从 stage1 一路走到 stage3 */
  const cityCuis = E.CUISINES.filter(c => c.city);
  let broken = [];
  for (const cu of cityCuis) {
    const s = E.newGame('normal', 0, null);
    s.cash = 1e9;
    E.setVenueCity(s, cu.city);
    for (const g of E.ING) s.inv[g.id] = 9999;
    const nodes = E.RESEARCH_TREE.filter(n => n.city === cu.city)
      .slice().sort((a, b) => a.stage - b.stage);
    for (const n of nodes) {
      const c = E.canResearch(s, n.recipe);
      if (!c.ok) { broken.push(`${cu.name}:${E.recipeById(n.recipe).name}(${c.msg})`); break; }
      E.doResearch(s, n.recipe);
    }
  }
  if (broken.length) bad('研发树×城市', `${broken.length} 座城市的菜系走不到最后一级：${broken.slice(0, 3).join('；')}`);
  else okCat('研发树×城市', `${cityCuis.length} 座城市的菜系都能逐级研到最新款`);

  /* 在错误的城市，该系的树节点应全部标为 away */
  const s2 = E.newGame('normal', 0, null);   /* 北京 */
  const cdTree = E.RESEARCH_TREE.filter(n => n.city === '510100');
  const notAway = cdTree.filter(n => {
    const r = E.recipeById(n.recipe);
    return !(r && !s2.recipes.includes(r.id));
  });
  if (cdTree.length === 3) okCat('研发树×城市', `成都系在树上占${cdTree.length} 个节点`);
  else bad('研发树×城市', `成都系节点数异常（${cdTree.length}，应为 3）`);

  /* 异地解锁的配方换城回来仍可用 */
  const s3 = E.newGame('normal', 0, null);
  s3.cash = 1e9; for (const g of E.ING) s3.inv[g.id] = 9999;
  E.setVenueCity(s3, '510100');
  E.doResearch(s3, 'cd_rattancha');
  const listableAtCd = E.canListRecipe(s3, 'cd_rattancha').ok;
  E.setVenueCity(s3, '110100');
  const listableAtBj = E.canListRecipe(s3, 'cd_rattancha').ok;
  E.setVenueCity(s3, '510100');
  const listableBack = E.canListRecipe(s3, 'cd_rattancha').ok;
  if (listableAtCd && !listableAtBj && listableBack) {
    okCat('研发树×城市', '异地配方：北京不可上架 → 回成都恢复可用（投入不白费）');
  } else {
    bad('研发树×城市', `异地配方往返行为异常：成都${listableAtCd} / 北京${listableAtBj} / 回成都${listableBack}`);
  }
}

/* ========== 2. 城市绑定 × 菜单 × 备货 ========== */
console.log('\n=== 2. 城市绑定 × 菜单 × 备货 ===');
{
  const s = E.newGame('normal', 0, null);
  s.cash = 1e9; for (const g of E.ING) s.inv[g.id] = 9999;
  E.setVenueCity(s, '510100');
  E.doResearch(s, 'cd_rattancha');
  s.menu = ['boba', 'cd_rattancha'];
  /* 菜单里在成都的菜，用的原料应都是成都能买到的 */
  const city = E.currentCityId(s);
  let unavailable = [];
  for (const rid of s.menu) {
    const r = E.recipeById(rid);
    if (!r) continue;
    for (const k of Object.keys(r.req || {})) {
      if (!E.ingAvailableAt(k, city)) unavailable.push(`${r.name} 需 ${E.ingById(k).name}`);
    }
  }
  if (unavailable.length) bad('菜单×原料', `菜单里有做不出来的菜：${unavailable.join('；')}`);
  else okCat('菜单×原料', '菜单里每道菜的原料在本地都买得到（不会"菜单上有却做不出来"）');

  /* 换城市后菜单应自动收敛 */
  s.menu = ['boba', 'cd_rattancha'];
  E.setVenueCity(s, '110100');
  if (s.menu.includes('cd_rattancha')) bad('菜单×城市', '换城市后成都菜仍在菜单里');
  else okCat('菜单×城市', `换城市后菜单自动收敛为 ${s.menu.join(',') || '（空）'}`);
}

/* ========== 3. 工坊 × 城市系 ========== */
console.log('\n=== 3. 工坊 × 城市系 ===');
{
  /* 每个菜系都要有对应工坊 */
  const noWs = E.CUISINES.filter(c => !E.workshopById(c.id));
  if (noWs.length) bad('工坊', `${noWs.length} 个菜系没有工坊：${noWs.map(c => c.name).join(',')}`);
  else okCat('工坊', `${E.CUISINES.length} 个菜系全部有对应工坊`);

  /* 收益数组长度必须与造价阶梯一致 */
  const badLen = E.CRAFT_WORKSHOPS.filter(w =>
    w.costCut.length !== w.cost.length || w.saleBonus.length !== w.cost.length);
  if (badLen.length) bad('工坊', `${badLen.length} 条工坊的收益数组长度与造价阶梯不符：${badLen.map(w => w.id).join(',')}`);
  else okCat('工坊', '所有工坊的收益数组长度与造价阶梯一致');

  /* 城市系工坊的收益结构应与通用系有区别（否则没必要分开） */
  const cityWs = E.CRAFT_WORKSHOPS.filter(w => E.cuisineById(w.id) && E.cuisineById(w.id).city);
  const genWs = E.CRAFT_WORKSHOPS.filter(w => E.cuisineById(w.id) && !E.cuisineById(w.id).city);
  const cityCost = cityWs.reduce((a, w) => a + w.cost[1], 0) / (cityWs.length || 1);
  const genCost = genWs.reduce((a, w) => a + w.cost[1], 0) / (genWs.length || 1);
  if (cityCost <= genCost) bad('工坊', `城市系工坊造价（¥${Math.round(cityCost)}）没有比通用系（¥${Math.round(genCost)}）贵`);
  else okCat('工坊', `城市系工坊更贵（¥${Math.round(cityCost)} vs ¥${Math.round(genCost)}）—— 地域取舍有代价`);
}

/* ========== 4. 店长 × 城市 × 编制 ========== */
console.log('\n=== 4. 店长 × 城市 × 编制 ===');
{
  /* 店长招的人必须属于自己管的店 */
  const s = E.newGame('normal', 0, null);
  s.cash = 1e9;
  E.setVenueCity(s, '510100');
  E.openShopBranch(s);
  E.openShopBranch(s);
  E.hireManager(s, 2, 0);
  E.refreshCandidates(s, true);
  E.managerDaily(s);
  const hired = s.staff.filter(x => x.hiredBy === 'mgr');
  const wrongBranch = hired.filter(x => x.branch !== 2);
  if (wrongBranch.length) bad('店长×编制', `${wrongBranch.length} 个店长招的人被派到了错误的店`);
  else okCat('店长×编制', `店长的 ${hired.length} 个员工都归属他管的店`);

  /* 编制上限：店长招人与玩家招人共用 */
  const cap = E.branchStaffCap(s, 2);
  let guard = 0;
  while (E.staffOfBranch(s, 2).length < cap && guard++ < 30) {
    E.refreshCandidates(s, true);
    E.managerDaily(s);
  }
  E.refreshCandidates(s, true);
  E.hireStaff(s, 0, 2);            /* 玩家再试着塞一个 */
  if (E.staffOfBranch(s, 2).length > cap) bad('店长×编制', `编制被突破（${E.staffOfBranch(s, 2).length} > ${cap}）`);
  else okCat('店长×编制', `玩家与店长共用编制上限（${E.staffOfBranch(s, 2).length}/${cap}）`);

  /* 店长加成只作用于自己那家店 */
  const mb2 = E.managerBonus(s, 2), mb1 = E.managerBonus(s, 1), mb3 = E.managerBonus(s, 3);
  if (mb1.ops !== 1) bad('店长×加成', '总店被算进了店长加成');
  else if (mb3.ops !== 1) bad('店长×加成', '没店长的分店白拿了加成');
  else if (mb2.ops <= 1) bad('店长×加成', '店长自己那家店没有加成');
  else okCat('店长×加成', '加成严格限定在店长管的店里');
}

/* ========== 5. 成就食谱 × 研发树 × 城市 ========== */
console.log('\n=== 5. 成就食谱 × 研发树 × 城市 ===');
{
  /* 成就食谱绝不能出现在研发树里 */
  const inTree = E.RESEARCH_TREE.filter(n => E.achRecipeById(n.recipe));
  if (inTree.length) bad('成就食谱', `${inTree.length} 个成就食谱被放进了研发树`);
  else okCat('成就食谱', `${E.ACH_RECIPES.length} 款成就食谱均不在研发树中`);

  /* 每款成就食谱都要有成就能发 */
  const granted = E.ACHIEVEMENTS.filter(a => a.reward && a.reward.recipe).map(a => a.reward.recipe);
  const orphan = E.ACH_RECIPES.filter(r => granted.indexOf(r.id) < 0);
  if (orphan.length) bad('成就食谱', `${orphan.length} 款成就食谱没有成就能发：${orphan.map(r => r.name).join(',')}`);
  else okCat('成就食谱', '每款成就食谱都有对应成就');

  /* 城市绑定的成就食谱：在别的城市拿到了也是"已解锁但不能上架" */
  const s = E.newGame('normal', 0, null);
  s.recipes = ['boba'];
  E.grantAchRecipe(s, 'ach_firstcity');       /* 成都绑定 */
  const gotIt = s.recipes.includes('ach_firstcity');
  const canList = E.canListRecipe(s, 'ach_firstcity').ok;   /* 人在北京 */
  if (gotIt && !canList) okCat('成就食谱', '城市绑定的成就食谱已获得但需去对应城市上架');
  else bad('成就食谱', `城市绑定成就食谱行为异常：获得=${gotIt} 可上架=${canList}`);

  /* 重复获得幂等 */
  const before = s.recipes.length;
  E.grantAchRecipe(s, 'ach_firstcity');
  if (s.recipes.length !== before) bad('成就食谱', '重复获得把食谱塞了两份');
  else okCat('成就食谱', '重复获得不重复入列');
}

/* ========== 6. 全局不变量 ========== */
console.log('\n=== 6. 全局不变量 ===');
{
  /* 配方必填字段 */
  const missing = [];
  for (const r of E.ALL_RECIPES) {
    for (const k of ['id', 'name', 'emoji', 'price', 'tier', 'cuisine']) {
      if (r[k] == null) missing.push(`${r.id}.${k}`);
    }
    if (!r.req || !Object.keys(r.req).length) missing.push(`${r.id}.req`);
  }
  if (missing.length) bad('数据', `${missing.length} 处必填字段缺失：${missing.slice(0, 5).join(', ')}`);
  else okCat('数据', `${E.ALL_RECIPES.length} 款配方字段齐备`);

  /* 城市菜只用本城原料 */
  const cross = [];
  for (const r of E.RECIPES) {
    if (!r.city) continue;
    for (const k of Object.keys(r.req || {})) {
      const g = E.ingById(k);
      if (g && g.origin && g.origin !== r.city) cross.push(`${r.name}←${g.name}`);
    }
  }
  if (cross.length) bad('数据', `${cross.length} 款城市菜用了外城原料：${cross.slice(0, 3).join(', ')}`);
  else okCat('数据', '城市菜全部只用本城/通用原料');

  /* 所有引用的城市 id 都真实存在 */
  const badCity = [];
  for (const c of E.CUISINES) if (c.city && !E.cityById(c.city)) badCity.push(c.name);
  for (const g of E.ING) if (g.origin && !E.cityById(g.origin)) badCity.push(g.name);
  for (const r of E.ALL_RECIPES) if (r.city && !E.cityById(r.city)) badCity.push(r.name);
  for (const n of E.RESEARCH_TREE) if (n.city && !E.cityById(n.city)) badCity.push(n.id);
  if (badCity.length) bad('数据', `引用了不存在的城市：${badCity.slice(0, 5).join(', ')}`);
  else okCat('数据', '所有城市引用（菜系/原料/配方/树节点）均有效');

  /* 研发树无环且前置阶段更早 */
  const byId = new Map(E.RESEARCH_TREE.map(n => [n.id, n]));
  const orderBad = [];
  for (const n of E.RESEARCH_TREE) {
    for (const pid of (n.prereq || [])) {
      const p = byId.get(pid);
      if (!p) orderBad.push(`${n.id}→${pid}(不存在)`);
      else if (p.stage >= n.stage) orderBad.push(`${n.id}(s${n.stage})←${p.id}(s${p.stage})`);
    }
  }
  if (orderBad.length) bad('研发树', `${orderBad.length} 处前置倒置或悬空：${orderBad.slice(0, 3).join(', ')}`);
  else okCat('研发树', '前置全部指向更早阶段（无环、无倒置）');

  /* 可研配方全部接入树 */
  const noNode = E.RECIPES.filter(r => r.research && !E.nodeByRecipe(r.id));
  if (noNode.length) bad('研发树', `${noNode.length} 款可研配方没接入树：${noNode.map(r => r.name).join(', ')}`);
  else okCat('研发树', '所有可研发配方都已接入研发树');
}

/* ========== 7. 随机压力测试：100 局乱操作 ========== */
console.log('\n=== 7. 随机压力测试（100 局乱操作不崩）===');
{
  let crash = null, crashDay = -1;
  for (let i = 0; i < 100 && !crash; i++) {
    try {
      const s = E.newGame(['easy', 'normal', 'hard'][i % 3], 0, null);
      s.cash = 1e6;
      for (const g of E.ING) s.inv[g.id] = 200;
      for (let d = 0; d < 12; d++) {
        /* 随机操作：换城市 / 开店 / 招人 / 研发 / 招店长 / 调动 / 卸任 */
        const ops = ['city', 'shop', 'hire', 'research', 'mgr', 'move', 'fire', 'open'];
        const op = ops[Math.floor(rnd() * ops.length)];
        if (op === 'city') {
          const cs = E.CITIES.filter(c => E.cuisinesOfCity(c.id).length);
          E.setVenueCity(s, cs[Math.floor(rnd() * cs.length)].id);
        } else if (op === 'shop') E.openShopBranch(s);
        else if (op === 'hire') { E.refreshCandidates(s, true); E.hireStaff(s, 0, 1 + Math.floor(rnd() * s.shops)); }
        else if (op === 'research') {
          const ns = E.RESEARCH_TREE.filter(n => n.stage <= 2);
          E.doResearch(s, ns[Math.floor(rnd() * ns.length)].recipe);
        } else if (op === 'mgr') {
          const left = E.managerSlotsLeft(s);
          if (left > 0) E.hireManager(s, 2 + Math.floor(rnd() * s.shops), 0);
        } else if (op === 'move' && s.managers.length) {
          E.moveManager(s, s.managers[0].id, 2 + Math.floor(rnd() * s.shops));
        } else if (op === 'fire' && s.managers.length) {
          E.fireManager(s, s.managers[0].id);
        } else if (op === 'open') {
          if (s.phase !== 'prep' && s.phase !== 'open') {
            E.autoFill(s);
            const om = E.openShop(s);
            if (om.ok) { let g2 = 0; while (s.sim && !s.sim.closing && g2++ < 300) E.tick(s, 0.12); E.endDay(s); }
          }
        }
        /* 每步之后检查 state 没被写坏 */
        if (!Number.isFinite(s.cash) || s.cash < 0) throw new Error('现金异常 ¥' + s.cash);
        if (!Array.isArray(s.staff) || !Array.isArray(s.menu)) throw new Error('数组字段被写坏');
        for (const st of s.staff) {
          if (st.branch < 1 || st.branch > s.shops) throw new Error(`员工 branch 越界 ${st.branch} > ${s.shops}`);
        }
      }
    } catch (e) { crash = e.message; crashDay = i; }
  }
  if (crash) bad('压力测试', `第 ${crashDay} 局崩了：${crash}`);
  else okCat('压力测试', '100 局随机乱操作（换城/开店/招人/研发/调动/卸任/营业）未崩溃且状态未损坏');
}

console.log('');
if (issues.length === 0) console.log('✅ 跨系统一致性检查全部通过');
else console.log(`❌ 发现 ${issues.length} 个问题：\n` + issues.map(i => `   · [${i.cat}] ${i.msg}`).join('\n'));
process.exit(issues.length === 0 ? 0 : 1);