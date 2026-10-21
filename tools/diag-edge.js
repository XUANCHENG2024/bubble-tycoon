/**
 * 数值边界与存档深检。
 *
 * ★ 与 diag-coupling 的分工：
 *   coupling 验「系统之间对不对得上」，这里验「单个系统在极端输入下会不会崩」。
 *   脏存档是玩家真的会遇到的（手改存档码、跨版本读档、导出再导入）。
 *
 * 用法：node tools/diag-edge.js
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');

let seed = 424242;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const ctx = {
  console, JSON, Date, Object, Array, String, Number, Boolean, Error, Set, Map,
  isNaN, parseInt, parseFloat,
  Math: Object.assign(Object.create(Math), { random: rnd }),
  /* ★ 必须提供这两个宿主 API：b64encode 依赖 TextEncoder + btoa。
     少了它们，exportSave 会静默走 catch 分支返回空串 ——
     表现为「存档码功能坏了」，而根因是诊断环境缺 API，不是引擎问题。
     （browser-smoke 的 jsdom-loader 早就提供了，这里要自己补。） */
  TextEncoder, TextDecoder,
  btoa: str => Buffer.from(String(str), 'binary').toString('base64'),
  atob: str => Buffer.from(String(str), 'base64').toString('binary'),
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
Object.assign(E, vm.runInContext('({CFG,DIFFICULTY,RECIPES,ING,CUISINES,CITIES,RESEARCH_TREE})', ctx));

const issues = [];
function bad(cat, msg) { issues.push({ cat, msg }); console.log(`  ✘ [${cat}] ${msg}`); }
function okCat(cat, msg) { console.log(`  ✔ [${cat}] ${msg}`); }

const J = v => JSON.parse(JSON.stringify(v));

/* ========== 1. 数值边界：NaN / Infinity / 负数 / 极大值 ========== */
console.log('\n=== 1. 数值边界 ===');
{
  const NASTY = [NaN, Infinity, -Infinity, -1, -1e9, 0, 1e12, 'abc', null, undefined, {}, [], true];
  let crashed = null, cases = 0;
  for (const v of NASTY) {
    for (const field of ['cash', 'rep', 'day', 'shops', 'staff', 'menu', 'recipes', 'managers',
      'up', 'inv', 'stats', 'flags', 'ach', 'venue', 'ratio', 'ratios', 'prices', 'questDay']) {
      cases++;
      try {
        const s = E.newGame('normal', 0, null);
        s[field] = v;
        const c = E.sanitizeState(J(s));
        if (!c) { crashed = `${field}=${String(v)} → sanitizeState 返回 null`; break; }
        /* 关键：清洗后的值必须是"能用"的，不能只是不崩 */
        /* ★ 负现金是**设计意图**，不是脏数据：
             引擎有 debtDays 机制（负债连续 2 天即破产，见 isBankrupt），
             玩家真的可能欠钱。
           所以这里验的是「夹在有限范围内」而不是「非负」——
           把 -1e9 当成要归零的话，会把负债机制一起废掉。 */
        if (field === 'cash' && (!Number.isFinite(c.cash) || Math.abs(c.cash) > 1e12)) {
          crashed = `${field}=${String(v)} → cash=${c.cash}`; break;
        }
        if (field === 'shops' && c.shops < 1) { crashed = `${field}=${String(v)} → shops=${c.shops}`; break; }
        if (field === 'rep' && (c.rep < 0 || c.rep > 100)) { crashed = `${field}=${String(v)} → rep=${c.rep}`; break; }
        if ((field === 'staff' || field === 'menu' || field === 'recipes' || field === 'managers')
          && !Array.isArray(c[field])) { crashed = `${field}=${JSON.stringify(v)} → 非数组`; break; }
      } catch (e) { crashed = `${field}=${String(v)} 抛错：${e.message}`; break; }
    }
    if (crashed) break;
  }
  if (crashed) bad('边界', crashed);
  else okCat('边界', `${cases} 组极端值（NaN/±Infinity/负数/1e12/字符串/对象/数组）均被安全收敛`);
}

/* ========== 2. 存档往返：随机状态 200 次 ========== */
console.log('\n=== 2. 存档往返稳定性 ===');
{
  let mismatch = null;
  for (let i = 0; i < 200 && !mismatch; i++) {
    const s = E.newGame(['easy', 'normal', 'hard'][i % 3], 0, null);
    /* 随机造一个状态 */
    s.cash = Math.floor(rnd() * 1e6);
    s.rep = Math.floor(rnd() * 100);
    s.day = 1 + Math.floor(rnd() * 29);
    s.shops = 1 + Math.floor(rnd() * 3);
    for (const g of E.ING) s.inv[g.id] = Math.floor(rnd() * 300);
    const nStaff = Math.floor(rnd() * 8);
    for (let k = 0; k < nStaff; k++) {
      s.staff.push({
        id: 100 + k, name: 'E' + k, emoji: '🙂', skill: 0.8 + rnd() * 0.6,
        trait: null, wage: 60, stamina: 100,
        branch: 1 + Math.floor(rnd() * s.shops), hiredBy: 'player',
      });
    }
    for (let k = 0; k < Math.floor(rnd() * 3); k++) {
      s.managers.push({
        id: 200 + k, name: 'M' + k, emoji: '🧑‍💼', lv: 1 + Math.floor(rnd() * 5),
        skill: 0.9 + rnd() * 0.6, trait: 'none', wage: 300,
        branch: 2 + Math.floor(rnd() * Math.max(1, s.shops - 1)), days: k,
      });
    }
    s.menu = s.recipes.slice(0, Math.floor(rnd() * 3));
    const before = J(E.sanitizeState(J(s)));
    const after = J(E.sanitizeState(J(before)));
    /* 二次清洗必须幂等 */
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      const keys = Object.keys(before).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
      mismatch = `二次清洗不幂等，字段：${keys.join(',')}`;
    }
  }
  if (mismatch) bad('存档', mismatch);
  else okCat('存档', '200 组随机状态：sanitizeState 二次调用完全幂等');

  /* 导出存档码 → 导入 */
  let expErr = null;
  try {
    const s = E.newGame('normal', 0, null);
    /* ★ 必须在**所有会扣钱的操作之前**取基准现金 ——
       开分店（¥3500）与招店长（¥3000）都会减现金，
       初版在事后用 s.cash ���基准，读到的已是扣完的钱，
       于是"现金变了 ¥6500"被误报成存档缺陷。 */
    E.setVenueCity(s, '510100');
    s.cash = 123456;
    E.openShopBranch(s);
    E.hireManager(s, 2, 0);
    const cashAtSave = s.cash;      /* ← 基准取这里 */
    void cashAtSave;
    /* exportSave 走 snapshotState，要求存档该有的字段都在。
       先设好槽位与时间戳，否则它会返回空串（而 import 空串的报错
       「请先粘贴存档码」看起来像功能坏了，其实是前置缺失）。 */
    E.setSlot(0);
    s.savedAt = Date.now();
    s.lastTime = Date.now();
    const code = E.exportSave(s);
    if (!code) { expErr = 'exportSave 返回空串（前置条件缺失？）'; }
    const back = code ? E.importSave(code) : { ok: false, msg: '（空码）' };
    if (!back.ok) expErr = '导入失败：' + back.msg;
    else {
      if (back.state.managers.length !== 1) expErr = '店长丢了';
      else if (back.state.venue.cityId !== '510100') expErr = '城市丢了';
      else if (back.state.cash !== s.cash) expErr = `现金变了（${back.state.cash} ≠ ${s.cash}）`;
    }
  } catch (e) { expErr = e.message; }
  if (expErr) bad('存档码', expErr);
  else okCat('存档码', '导出 → 导入后店长/城市/现金完整保留');

  /* 非法存档码不该崩 */
  let badCodeErr = null;
  for (const c of ['', 'x', 'null', '{}', '[]', 'not-base64!!', 'eyJvayI6MX0']) {
    try { E.importSave(c); } catch (e) { badCodeErr = `存档码「${c}」抛错：${e.message}`; break; }
  }
  if (badCodeErr) bad('存档码', badCodeErr);
  else okCat('存档码', '7 种非法/畸形存档码均被安全拒绝而非抛错');
}

/* ========== 3. 跨版本兼容：模拟 V9/V10 时代的老存档 ========== */
console.log('\n=== 3. 跨版本老存档 ===');
{
  const cases = {
    'V9 之前（无 venue/workshops/candidates）': (s) => {
      delete s.venue; delete s.workshops; delete s.candidates; delete s.questDay;
      return s;
    },
    'V10 之前（无 managers/citiesVisited）': (s) => {
      delete s.managers; delete s.mgrCand; delete s.nextMgrId;
      delete s.citiesVisited; delete s.stayDays; delete s.stats.lastDayCups;
      return s;
    },
    'V11 之前（staff 无 branch）': (s) => {
      for (const st of s.staff) { delete st.branch; delete st.hiredBy; }
      s.shops = 3;
      return s;
    },
    '只有开局字段的裸对象': () => ({
      v: 2, diff: 'normal', day: 1, cash: 700, rep: 26, menu: ['boba'], recipes: ['boba'],
    }),
  };
  for (const [name, mutate] of Object.entries(cases)) {
    let err = null;
    try {
      const s = mutate(E.newGame('normal', 0, null));
      const c = E.sanitizeState(J(s));
      if (!c) err = '返回 null';
      else {
        if (!Number.isFinite(c.cash)) err = 'cash 非有限数';
        else if (!Array.isArray(c.staff)) err = 'staff 非数组';
        else if (!Array.isArray(c.menu)) err = 'menu 非数组';
        else if (!c.venue || !c.venue.cityId) err = 'venue 未补默认';
        else if (!c.workshops || typeof c.workshops !== 'object') err = 'workshops 未补默认';
        else if (c.staff.length && c.staff.some(st => st.branch < 1)) err = 'staff.branch 未补默认';
        /* 补完的存档必须真能跑起来 */
        else { const r = E.openShop(c); if (!r.ok && r.msg.indexOf('菜单') < 0) err = '补完后开不了店：' + r.msg; }
      }
    } catch (e) { err = e.message; }
    if (err) bad('老存档', `${name} → ${err}`);
    else okCat('老存档', name);
  }
}

/* ========== 4. 不变量：跑完整局后的状态必须是合法的 ========== */
console.log('\n=== 4. 完整一局后的状态不变量 ===');
{
  const problems = [];
  for (let i = 0; i < 12; i++) {
    const s = E.newGame(['easy', 'normal', 'hard'][i % 3], 0, null);
    s.cash = 50000;
    for (const g of E.ING) s.inv[g.id] = 400;
    /* 研发 + 上架 */
    for (const n of E.RESEARCH_TREE.filter(x => !x.city)) {
      if (s.recipes.includes(n.recipe)) continue;
      if (E.canResearch(s, n.recipe).ok) E.doResearch(s, n.recipe);
    }
    for (const rid of s.recipes.slice(0, 4)) E.toggleMenu(s, rid);
    /* 跑 10 天 */
    for (let d = 0; d < 10 && !E.isBankrupt(s); d++) {
      E.autoFill(s);
      if (!E.openShop(s).ok) break;
      let g2 = 0;
      while (s.sim && !s.sim.closing && g2++ < 300) E.tick(s, 0.12);
      E.endDay(s);
      if (s.phase === 'report' && s.day < E.CFG.DAYS) E.nextDay(s);
    }
    /* 不变量检查 */
    if (!Number.isFinite(s.cash) || s.cash < 0) problems.push(`第${i}局 现金 ¥${s.cash}`);
    if (!Number.isFinite(s.rep) || s.rep < 0 || s.rep > 100) problems.push(`第${i}局 口碑 ${s.rep}`);
    if (!Array.isArray(s.menu) || s.menu.length > E.menuSlots(s)) {
      problems.push(`第${i}局 菜单 ${s.menu.length} 款（上限 ${E.menuSlots(s)}）`);
    }
    /* ★ 菜单里不该有"本地买不到原料"的菜 —— 那种菜玩家根本做不出来 */
    const city = E.currentCityId(s);
    for (const rid of s.menu) {
      const r = E.recipeById(rid);
      if (!r) { problems.push(`第${i}局 菜单里有未知配方 ${rid}`); continue; }
      for (const k of Object.keys(r.req || {})) {
        if (!E.ingAvailableAt(k, city)) {
          problems.push(`第${i}局 菜单「${r.name}」需外城原料 ${E.ingById(k).name}`);
        }
      }
    }
    /* 工位总数必须 = 1 + 员工数（V11 起分店不额外加位） */
    if (s.phase === 'report' && s.sim) {
      const expect = 1 + s.staff.length;
      if (s.sim.stations.length !== expect) {
        problems.push(`第${i}局 工位数 ${s.sim.stations.length} ≠ 1+${s.staff.length}`);
      }
    }
    /* 员工的 branch 必须在合法范围 */
    for (const st of s.staff) {
      if (st.branch < 1 || st.branch > s.shops) problems.push(`第${i}局 员工 branch ${st.branch} 越界`);
    }
  }
  if (problems.length) bad('不变量', `${problems.length} 处违反：${problems.slice(0, 3).join('；')}`);
  else okCat('不变量', '12 局完整模拟后：现金/口碑/菜单/工位/分店归属/原料可得性全部合法');
}

console.log('');
if (issues.length === 0) console.log('✅ 数值边界与存档深检全部通过');
else console.log(`❌ 发现 ${issues.length} 个问题：\n` + issues.map(i => `   · [${i.cat}] ${i.msg}`).join('\n'));
process.exit(issues.length === 0 ? 0 : 1);