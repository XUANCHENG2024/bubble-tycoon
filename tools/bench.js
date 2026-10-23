/* ============================================================
 *  性能基准（真实测量，不是估算）
 *
 *  前两轮审查里所有性能结论都是静态分析 + 估算（"每帧 N 次"、"低端机必然掉帧"），
 *  没有一个数字是测出来的。这里把热路径逐个计时，用数据说话：
 *    ① tick            —— 营业中每帧必跑，最热
 *    ② sanitizeState   —— slotInfo 的主体，标题页每帧调用的元凶
 *    ③ saveGame        —— 每 5 秒一次自动存档
 *    ④ loadGame        —— 读档
 *    ⑤ 一整天完整模拟  —— 端到端
 *    ⑥ 面板/建议计算   —— 打开面板时
 *
 *  用法：node tools/bench.js [轮数]
 *  数字会随机器变化，**只看相对量级与改动前后的对比**，别当绝对值。
 * ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const ROUNDS = Math.max(1, +(process.argv[2] || 3));

/* 复用 probe 的沙箱装载方式（data + engine + ui + main，桩掉 DOM） */
function makeCtx() {
  const els = {};
  const mk = () => ({
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, children: [],
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() { } }), set: () => true }),
    toDataURL: () => 'data:,', width: 0, height: 0, select() { },
    classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
    addEventListener() { }, removeEventListener() { },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c, r) { const i = this.children.indexOf(r); this.children.splice(i < 0 ? this.children.length : i, 0, c); return c; },
    remove() { }, querySelector() { return mk(); }, querySelectorAll() { return []; },
    closest() { return this; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 40 }),
    animate() { return {}; }, focus() { },
  });
  const store = {};
  const ctx = {
    console, Math, JSON, Date, Object, Array, String, Number, Boolean, Error, Set, Map,
    isNaN, parseInt, parseFloat, setTimeout, clearTimeout, TextEncoder, TextDecoder,
    btoa: s => Buffer.from(String(s), 'binary').toString('base64'),
    atob: s => Buffer.from(String(s), 'binary').toString('binary'),
    innerHeight: 800, innerWidth: 420, performance: { now: () => Date.now() },
    requestAnimationFrame() { return 0; }, setInterval() { return 0; }, clearInterval() { },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    document: {
      getElementById(id) { return els[id] || (els[id] = mk()); },
      querySelectorAll() { return []; }, querySelector() { return mk(); },
      createElement() { return mk(); }, addEventListener() { }, hidden: false,
    },
  };
  ctx.addEventListener = () => { };
  ctx.removeEventListener = () => { };
  ctx.window = ctx; ctx.globalThis = ctx;
  return ctx;
}

const ctx = makeCtx();
/* bundle 是 CommonJS 模块作用域，顶层声明不会挂到 globalThis，
   必须像 probe.js 那样显式导出一份（这也是两套测试能访问引擎的原因）。 */
const src = require('./frontend-files.js').H5_FILES
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n')
  + '\n;globalThis.__D={CFG,DIFFICULTY,ING,RECIPES,UPGRADES,TRAITS,STRATEGY_CARDS,QUESTS,ACHIEVEMENTS,'
  + 'newGame,sanitizeState,openShop,tick,endDay,nextDay,autoFill,menuSlots,stationCount,hireStaff,'
  + 'refreshCandidates,saveGame,loadGame,slotInfo,setSlot,adviceOf,questViews,netWorth,trafficOf,'
  + 'rivalShare,cardMul,dailyOrderCapacity,milestoneOf,exportSave};';
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'bundle.js' });
Object.assign(ctx, ctx.__D);
const E = ctx;

/* ---------- 工具 ---------- */
function ms(fn, n) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) fn(i);
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / 1e6 / n;   // 每次调用平均毫秒
}
const fmt = v => (v < 0.01 ? v.toFixed(4) : v < 1 ? v.toFixed(3) : v.toFixed(2));
const pct = (v, budget) => `${fmt(v)} ms/次 ${v < budget ? '✅' : '⚠️'}`;

/* ---------- 造一个「打了很多天」的真实局面 ---------- */
function makeRealistic() {
  const s = E.newGame('hard', 0);
  s.cash = 1e9;
  for (let d = 0; d < 20; d++) {
    s.cash = Math.max(s.cash, 8000);
    E.autoFill(s);
    s.menu = s.recipes.slice(0, E.menuSlots(s));
    for (const r of s.menu) s.ratios[r] = 1.0;
    if (E.openShop(s).ok) {
      let n = 0;
      while (s.phase === 'open' && n++ < 6000) E.tick(s, 1 / 30);
      if (s.phase === 'report') { E.endDay(s); E.nextDay(s); }
    } else break;
  }
  /* 再塞满员工和卡，让热路径走最重分支 */
  for (let i = 0; i < E.CFG.STAFF_MAX; i++) { E.refreshCandidates(s, true); E.hireStaff(s, 0); }
  s.cards = ['takeout', 'premium', 'express', 'member', 'kitchen', 'night'];
  return s;
}

const rows = [];
function bench(name, fn, n, budget, note) {
  const best = [];
  for (let r = 0; r < ROUNDS; r++) best.push(ms(fn, n));
  const v = Math.min(...best);          // 取最优轮，避开 GC 抖动
  rows.push({ name, v, budget, note });
  console.log(`  ${name.padEnd(26)} ${pct(v, budget).padEnd(18)} ${note || ''}`);
}

console.log(`\n性能基准（每轮 ${ROUNDS} 次取最优，Node ${process.version}）\n`);

/* ① tick：营业中每帧。预算 1ms —— 60fps 有 16.6ms，引擎只占一小部分 */
{
  const s = makeRealistic();
  s.cash = 1e9; E.autoFill(s);
  s.menu = s.recipes.slice(0, E.menuSlots(s));
  for (const r of s.menu) s.ratios[r] = 1.0;
  if (!E.openShop(s).ok) throw new Error('基准开局失败');
  bench('tick（每帧）', () => { E.tick(s, 1 / 30); }, 3000, 1,
    `${E.stationCount(s)} 个出杯位 / ${s.staff.length} 员工`);
  /* 空场景对照：只有老板一个工位，看固定开销 */
  const bare = E.newGame('normal', 0);
  bare.cash = 1e9; E.autoFill(bare);
  bare.menu = bare.recipes.slice(0, 1); bare.ratios[bare.menu[0]] = 1.0;
  E.openShop(bare);
  bench('tick（空店对照）', () => { E.tick(bare, 1 / 30); }, 3000, 1, '1 个工位');
}

/* ② sanitizeState：slotInfo 的主体。标题页每帧 6 次的元凶 */
{
  const s = makeRealistic();
  const raw = JSON.stringify(E.exportSave(s) ? JSON.parse(Buffer.from(E.exportSave(s), 'base64').toString()) : s);
  bench('sanitizeState（20 天局面）', () => { E.sanitizeState(JSON.parse(raw)); }, 200, 2,
    'history ' + s.history.length + ' 条 / log ' + s.log.length + ' 条');
  const tiny = E.newGame('normal', 0);
  bench('sanitizeState（第 1 天）', () => { E.sanitizeState(JSON.parse(JSON.stringify(tiny))); }, 200, 2, '空局面对照');
}

/* ③ slotInfo：含 storageGet + parse + sanitize，标题页每帧 6 次 */
{
  const s = makeRealistic();
  E.setSlot(0); E.saveGame(s);
  bench('slotInfo（含缓存命中）', () => { E.slotInfo(0); }, 2000, 0.5, '记忆化后应接近 0');
  /* 绕过缓存看真实成本：直接测 sanitize + parse */
  const raw = JSON.stringify(s);
  bench('slotInfo 缓存未命中成本', () => { E.sanitizeState(JSON.parse(raw)); }, 200, 2, '≈ sanitizeState');
}

/* ④ 存档往返：每 5 秒一次 */
{
  const s = makeRealistic();
  bench('saveGame（序列化+写入）', () => { E.saveGame(s); }, 200, 3, 'JSON.stringify');
  E.saveGame(s);
  bench('loadGame（读取+清洗）', () => { E.loadGame(0); }, 200, 5, 'parse + sanitizeState');
}

/* ⑤ 一整天端到端 */
{
  const s = makeRealistic();
  s.cash = 1e9;
  bench('一整天（开门→打烊→结算）', () => {
    const c = E.newGame('hard', 0);
    c.cash = 1e9; E.autoFill(c);
    c.menu = c.recipes.slice(0, E.menuSlots(c));
    for (const r of c.menu) c.ratios[r] = 1.0;
    if (!E.openShop(c).ok) return;
    let n = 0;
    while (c.phase === 'open' && n++ < 6000) E.tick(c, 1 / 30);
    if (c.phase === 'report') { E.endDay(c); E.nextDay(c); }
  }, 30, 100, '约 780 tick');
}

/* ⑥ 面板/建议计算：打开面板时各算一次 */
{
  const s = makeRealistic();
  bench('adviceOf（今日建议）', () => { E.adviceOf(s); }, 500, 1, '面板打开时');
  bench('questViews（任务行）', () => { E.questViews(s); }, 1000, 0.5, '面板打开时');
  bench('netWorth（净资产）', () => { E.netWorth(s); }, 2000, 0.2, 'HUD 每帧');
  bench('trafficOf（客流）', () => { E.trafficOf(s); }, 2000, 0.2, '开门时 + 建议');
  bench('rivalShare（对手份额）', () => { E.rivalShare(s); }, 2000, 0.1, 'HUD 每帧');
  bench('cardMul（策略卡倍率）', () => { E.cardMul(s, 'speed'); }, 5000, 0.05, '已索引化');
  bench('dailyOrderCapacity（产能）', () => { E.dailyOrderCapacity(s); }, 1000, 0.5, '建议里');
  bench('milestoneOf（中期目标）', () => { E.milestoneOf(s); }, 2000, 0.2, '面板打开时');
}

/* ---------- 汇总 ---------- */
console.log('\n-------- 汇总 --------');
const over = rows.filter(r => r.v > r.budget);
if (!over.length) console.log('✅ 全部热路径都在预算内');
else {
  console.log(`⚠️ ${over.length} 项超预算：`);
  for (const r of over) console.log(`   ${r.name}: ${fmt(r.v)} ms > ${r.budget} ms（${r.note}）`);
}

/* 标题页每帧 6 次 slotInfo 的真实代价 */
const slot = rows.find(r => r.name.startsWith('slotInfo（含缓存'));
const slotRaw = rows.find(r => r.name.startsWith('slotInfo 缓存未命中'));
if (slot) {
  console.log(`\n标题页每帧 6 次 slotInfo ≈ ${fmt(slot.v * 6)} ms/帧`
    + `（60fps 预算 16.6ms，占 ${(slot.v * 6 / 16.6 * 100).toFixed(2)}%）`);
}
const t = rows.find(r => r.name === 'tick（每帧）');
if (t) {
  console.log(`营业中每帧 tick ≈ ${fmt(t.v)} ms（60fps 预算 16.6ms，占 ${(t.v / 16.6 * 100).toFixed(2)}%）`);
}

/* ---- 低端机推算 ----
   上面是桌面 V8 的数字。低端安卓（骁龙 4 系 / 2GB 内存）实测通常慢 5~10 倍，
   按 10× 折算看哪些项会真正威胁帧率。 */
const SLOW = 10;
console.log(`\n-------- 低端机推算（×${SLOW}）--------`);
const slowRows = rows.map(r => ({ ...r, v: r.v * SLOW }));
const slowOver = slowRows.filter(r => r.v > r.budget);
if (!slowOver.length) {
  console.log(`✅ 即使慢 ${SLOW} 倍也全部在预算内`);
} else {
  console.log(`⚠️ 慢 ${SLOW} 倍后超预算的项：`);
  for (const r of slowOver) console.log(`   ${r.name}: ${fmt(r.v)} ms > ${r.budget} ms（${r.note}）`);
}
/* 逐帧项单独看：只有每帧跑的才直接威胁帧率（"一整天"是一次性成本，不该混进来） */
const perFrame = slowRows.filter(r => /^tick/.test(r.name) || /HUD/.test(r.note));
for (const r of perFrame) {
  const share = r.v / 16.6 * 100;
  console.log(`   逐帧项 ${r.name}: ${fmt(r.v)} ms/帧 = 帧预算的 ${share.toFixed(1)}%`);
}
const day = slowRows.find(r => r.name.startsWith('一整天'));
if (day) console.log(`   一次性项 一整天完整模拟: ${fmt(day.v)} ms（不在帧路径上）`);
if (slot && slotRaw) {
  const raw6 = slotRaw.v * 6 * SLOW;
  console.log(`\n   对照：若 slotInfo 没有记忆化，低端机标题页每帧 ${fmt(raw6)} ms`
    + ` = 帧预算的 ${(raw6 / 16.6 * 100).toFixed(0)}%${raw6 > 16.6 ? ' ⚠️ 会掉帧' : ''}`);
  console.log(`   记忆化把它降到 ${fmt(slot.v * 6 * SLOW)} ms/帧（帧预算的 ${(slot.v * 6 * SLOW / 16.6 * 100).toFixed(2)}%）`);
}
console.log('');
