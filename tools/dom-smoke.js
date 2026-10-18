/* DOM 冒烟测试：用极简 DOM 桩加载全部脚本，跑通渲染 + 一整天营业 + 结算 + 事件 + 结局 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');

/* 假 2D 上下文：让战绩卡片绘制代码跑真实分支 */
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
  const el = {
    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, children: [],
    getContext: () => fakeCtx(), toDataURL: () => 'data:image/png;base64,AA',
    select() { }, width: 0, height: 0,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { f ? this._s.add(c) : this._s.delete(c); } },
      contains(c) { return this._s.has(c); },
    },
    addEventListener() { }, removeEventListener() { },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c, ref) { const i = this.children.indexOf(ref); i < 0 ? this.children.push(c) : this.children.splice(i, 0, c); return c; },
    remove() { }, querySelector() { return makeEl('sub'); }, querySelectorAll() { return []; },
    closest() { return this }, getBoundingClientRect() { return { left: 0, top: 0, width: 120, height: 40 }; },
    animate() { return {}; }, focus() { },
  };
  return el;
}
/* 假 AudioContext：让音效代码走真实分支（浏览器不可用时会静默降级） */
function FakeParam() { this.setValueAtTime = () => { }; this.exponentialRampToValueAtTime = () => { }; }
function FakeNode() {
  this.frequency = new FakeParam(); this.gain = new FakeParam();
  this.type = ''; this.connect = () => { }; this.start = () => { }; this.stop = () => { };
}
function FakeAC() {
  this.currentTime = 0; this.state = 'running'; this.destination = {};
  this.createOscillator = () => new FakeNode();
  this.createGain = () => new FakeNode();
  this.resume = () => { };
}
const els = {};
const store = {};
const ctx = {
  console, Math, JSON, Date, Object, Array, String, Number, Boolean, Error, Set, Map,
  isNaN, parseInt, parseFloat,   setTimeout, clearTimeout,
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
ctx.AudioContext = FakeAC;
ctx.window = ctx; ctx.globalThis = ctx;

const src = ['js/data.js', 'js/engine.js', 'js/ui.js', 'js/main.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n')
  + '\n;globalThis.__D={CFG,ING,RECIPES,UPGRADES,TRAITS,EVENTS,ACHIEVEMENTS,DIFFICULTY,TAGS,SHOP_COSTS,WEATHERS,NEWS,UI,TUT,SFX,'
  + 'adviceOf,maxCupsFromStock,maxOrdersFromStock,dailyOrderCapacity,dailyClickOrderCapacity,avgCupsPerOrder,typeWeightOf,'
  + 'CUSTOMER_TYPES,CUSTOMER_FACES,RIVAL_ACTIONS,RIVAL_NAMES,TYPE_WEATHER_BIAS,isWeekend,endlessGoal,'
  + 'RNG,seedFromText,todayKey,pickCustomerType,initRival,rivalShare,rivalLevel,rivalAction,updateRival,money,clamp,pick,rnd,'
  + 'goalOf,startEndless,togglePause,slotInfo,hasAnySave,getSlot,setSlot,exportSave,importSave};';
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'bundle.js' });
Object.assign(ctx, ctx.__D);

const E = ctx;
const { UI } = E;
const CFGDAYS = E.CFG.DAYS;
let step = 0;
const ok = m => console.log(`  ✔ ${++step}. ${m}`);

/* ---- 动态 HTML 结构校验：抓住多闭合 / 少闭合div 这类静默 bug ---- */
const htmlErr = [];
function checkHTML(name, html) {
  const VOID = new Set(['br', 'img', 'input', 'meta', 'link', 'hr', 'source']);
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  const stack = []; let m;
  while ((m = re.exec(html))) {
    const close = m[1] === '/', tag = m[2].toLowerCase(), self = m[3] === '/';
    if (VOID.has(tag) || self) continue;
    if (!close) stack.push(tag);
    else {
      const top = stack.pop();
      if (top !== tag) htmlErr.push(`${name}: </${tag}> 与 <${top}> 不匹配`);
    }
  }
  if (stack.length) htmlErr.push(`${name}: 存在未闭合标签 ${stack.join(' > ')}`);
}
const checkPanels = () => ['panel-manage', 'panel-lab', 'panel-up', 'panel-staff', 'panel-rival', 'panel-ach']
  .forEach(id => checkHTML(id, E.document.getElementById(id).innerHTML));
const checkModal = name => checkHTML('弹窗:' + name, E.document.getElementById('modalBox').innerHTML);

/* 1. 标题页渲染 */
E.renderTitle();
ok('标题页 / 难度选择渲染');

/* 2. 开局 + 各面板渲染 */
E.startGame('normal');
['manage', 'lab', 'up', 'staff', 'rival', 'ach'].forEach(t => UI.setTab(t));
checkPanels();
ok('六个面板渲染（经营/研发/升级/员工/商圈/成就）');

/* 3. 各种交互动作 */
const s = E.window.S;
E.buyIng(s, 'tea', 20); E.buyIng(s, 'milk', 20); E.buyIng(s, 'pearl', 20); E.buyIng(s, 'fruit', 20);
E.autoFill(s);
E.toggleMenu(s, 'boba');
E.setRatio(s, 'boba', 1.15);
E.doUpgrade(s, 'speed');
E.doUpgrade(s, 'decor');
E.hireStaff(s, 0);
E.teamBuild(s);
E.doResearch(s, 'greentea');
ok('采购 / 菜单 / 定价 / 升级 / 雇佣 / 团建 / 研发');

/* 4. 跑完整一天营业（含顾客类型 / 暂停） */
s.menu = s.recipes.slice(0, E.menuSlots(s));
for (const r of s.menu) s.ratios[r] = 1.0;
const r0 = E.openShop(s);
if (!r0.ok) throw new Error('开门失败: ' + r0.msg);
UI.stageInit();
let n = 0, pauseTested = false;
while (s.phase === 'open' && n++ < 3000) {
  E.tick(s, 1 / 30);
  if (n % 12 === 0) E.rushStation(s, 0);
  if (n % 40 === 0) E.bossSkill(s);
  if (n === 60 && !pauseTested) {
    pauseTested = true;
    const before = s.sim.t;
    E.togglePause(s, true);
    for (let k = 0; k < 30; k++) E.tick(s, 1 / 30);
    if (Math.abs(s.sim.t - before) > 1e-6) throw new Error('暂停后时间仍在推进');
    E.togglePause(s, false);
  }
  UI.stageSync();
}
const rep4 = s.report;
if (!rep4) throw new Error('未产生结算');
if (rep4.served < 1) throw new Error('一天下来一杯都没卖出去');
const ty = Object.keys(rep4.typeServed || {}).length;
if (!ty) throw new Error('顾客类型统计为空');
ok(`营业模拟完成：${rep4.served} 杯 / ${rep4.orders} 单 / ${rep4.lost} 流失 · 客群 ${ty} 类`);

/* 5. 结算（应自动结束新手引导，避免提示卡挡住按钮） */
E.TUT.start(0);
UI.showReport(); checkModal('report');
if (E.TUT.active) throw new Error('结算未结束新手引导');
if (!E.window.META.tutDone) throw new Error('引导完成状态未持久化');
ok('结算弹窗渲染 + 自动结束新手引导');
UI.closeModal();

/* 6. 事件 */
E.nextDay(s);
s.pendingEvent = E.EVENTS[0];
UI.showEvent();
E.applyEvent(s, s.pendingEvent, 0);
ok('随机事件渲染与生效');

/* 7. 其它弹窗 */
UI.showHelp(); checkModal('help'); UI.closeModal();
UI.showRestock(); checkModal('restock'); UI.closeModal();
UI.showOffline({ mins: 90, gain: 640 }); checkModal('offline');
UI.closeModal();
if (htmlErr.length) throw new Error('动态 HTML 结构异常:\n  ' + htmlErr.join('\n  '));
ok('帮助 / 紧急进货 / 离线收益弹窗（含 HTML 结构校验）');

/* 8. 存读档 + 离线收益 */
E.saveGame(s);
const s2 = E.loadGame();
if (!s2) throw new Error('读档失败');
const off = E.claimOffline(s2);
ok(`存读档正常（离线 ${off ? off.gain : 0} 元）`);

/* 9. 结局页 */
E.nextDay(s);
UI.showEnd('finish');
ok('结局页渲染（含评级 / 转生）');

/* 10. 破产分支 */
E.window.S.cash = -999; E.window.S.debtDays = 2;
UI.showEnd('bankrupt');
ok('破产结局分支');

/* 11. 新手指引全流程 */
E.TUT.load();
if (!E.TUT.steps.length) throw new Error('引导步骤为空');
E.TUT.start(0);
if (!E.TUT.active) throw new Error('引导未能启动');
ok(`引导启动：共 ${E.TUT.steps.length} 步`);

const seen = new Set();
let guard = 0;
while (E.TUT.active && guard++ < 200) {
  const st = E.TUT.steps[E.TUT.i];
  seen.add(st.key);
  /* 模拟玩家做出该步要求的动作 + 手动下一步双保险 */
  if (st.advance && st.advance !== 'next') E.TUT.notify(st.advance);
  else E.TUT.next();
}
if (E.TUT.active) throw new Error('引导未正常结束，卡在第 ' + E.TUT.i + ' 步');
ok(`引导走通全部步骤：${seen.size}/${E.TUT.steps.length}`);

/* 12. 引导"抢跑"容错：notify 乱序事件不应卡死 */
E.TUT.start(0);
['boss', 'open', 'rush', 'buy', 'toggle'].forEach(e => E.TUT.notify(e));
if (E.TUT.active && E.TUT.i >= E.TUT.steps.length) E.TUT.stop();
ok('引导事件乱序容错');

/* 13. 智能建议 / 体检数据 */
const s3 = E.window.S;
const adv = E.adviceOf(s3);
if (!Array.isArray(adv)) throw new Error('adviceOf 返回异常');
const ify = [E.maxCupsFromStock(s3), E.maxOrdersFromStock(s3), E.dailyOrderCapacity(s3), E.dailyClickOrderCapacity(s3), E.avgCupsPerOrder(s3)];
if (ify.some(v => typeof v !== 'number' || !isFinite(v))) throw new Error('体检数值异常: ' + ify);
/* 口径断言：库存杯数 ÷ 平均杯数 必须等于 可招待人数；人均杯数应在 1~2.5 之间 */
const avgC = ify[4];
if (avgC < 1 || avgC > 2.5) throw new Error('平均杯数超出合理区间: ' + avgC);
if (Math.abs(Math.floor(ify[0] / avgC) - ify[1]) > 1) throw new Error('库存杯数/人次换算不自洽');
UI.renderManage();
ok(`建议系统：${adv.length} 条 · 库存 ${ify[0]}杯/够${ify[1]}人 · 产能 ${ify[2]}单(手速${ify[3]}) · 人均 ${avgC.toFixed(2)}杯`);

/* 14. 店长日志 */
s3.log.push('🧪 测试日志条目');
UI.renderManage();
ok('店长日志渲染');

/* 15. 音效：开关 + 各音效函数不报错 */
const before = E.SFX.on;
['click', 'coin', 'serve', 'bad', 'up', 'ach', 'bell', 'cash'].forEach(k => E.SFX[k]());
E.doAct('sound', E.document.getElementById('tutSkip'));
if (E.SFX.on === before) throw new Error('音效开关无效');
if (E.window.META.sound !== E.SFX.on) throw new Error('音效偏好未持久化');
E.doAct('sound', E.document.getElementById('tutSkip'));
E.doAct('retut', E.document.getElementById('tutSkip'));
E.SFX.tone(440, .1, 'sine', .1); E.SFX.sweep(300, 900, .2, 'triangle', .1);
ok('音效：8 种音效 + 开关 + 偏好持久化');

/* 17. 顾客类型系统 */
if (E.CUSTOMER_TYPES.length < 5) throw new Error('顾客类型缺失');
for (const t of E.CUSTOMER_TYPES) {
  if (!t.prefer || !t.cups || !t.priceTol) throw new Error(`顾客类型 ${t.id} 字段缺失`);
}
const tseed = E.pickCustomerType(s3);
if (!tseed || !tseed.id) throw new Error('抽取顾客类型失败');
const wsum = E.CUSTOMER_TYPES.reduce((a, t) => a + t.weight, 0);
ok(`顾客类型：${E.CUSTOMER_TYPES.length} 类（权重合计 ${wsum}）· 抽取正常`);

/* 18. 竞争对手 */
const r0s = E.rivalShare(s3);
if (!(r0s >= 0 && r0s < 1)) throw new Error('对手抢流比例异常: ' + r0s);
s3.cash = 99999;
const ra = E.rivalAction(s3, 'diff');
if (!ra.ok) throw new Error('差异化行动失败: ' + ra.msg);
const rivalRepBefore = s3.rival.rep;
E.rivalAction(s3, 'adwar');
if (!(s3.rival.rep < rivalRepBefore)) throw new Error('营销压制未降低对手口碑');
if (E.rivalLevel(s3.rival) < 1) throw new Error('对手等级异常');
UI.setTab('rival'); checkPanels();
ok(`竞争对手：抢流 ${(r0s * 100).toFixed(0)}% · 反制行动生效 · 护城河 Lv.${s3.rival.proof}`);

/* 19. 无尽模式 */
const baseGoal = E.goalOf(s3);
const eg = E.startEndless(s3);
if (!(eg > baseGoal)) throw new Error('无尽模式目标未提升');
if (E.isFinished(s3)) throw new Error('无尽模式下不应判定结束');
s3.endless = false;
ok(`无尽模式：目标 ${E.money(baseGoal)} → ${E.money(eg)}，isFinished 正确放行`);

/* 19b. 无尽模式跨过第 30 天必须能继续（曾因 nd > CFG.DAYS 被误判结束） */
{
  const es = E.newGame('normal', 0);
  E.startEndless(es);
  es.day = CFGDAYS + 1;
  if (E.isFinished(es)) throw new Error('无尽模式在 day>30 时被误判为结束');
  const before31 = es.day;
  E.nextDay(es);
  if (es.day !== before31 + 1) throw new Error('无尽模式无法推进到下一天');
  if (E.isFinished(es)) throw new Error('无尽模式推进后仍被判结束');
  /* 对照：非无尽模式在 day>30 必须结束 */
  const ns = E.newGame('normal', 0);
  ns.day = CFGDAYS + 1;
  if (!E.isFinished(ns)) throw new Error('普通模式 day>30 未判定结束');
  ok(`无尽模式跨天：Day ${before31} → ${es.day} 正常推进，普通模式同期正确结束`);
}

/* 20. 每日挑战：同种子必须完全可复现 */
function playWithSeed(seed) {
  E.RNG.setSeed(seed);
  const a = E.newGame('normal', 0);
  for (let d = 0; d < 5; d++) {
    a.menu = ['boba']; a.ratios.boba = 1;
    E.openShop(a);
    let g = 0;
    while (a.phase === 'open' && g++ < 3000) E.tick(a, 1 / 30);
    E.nextDay(a);
  }
  const out = { worth: Math.round(E.netWorth(a)), rep: Math.round(a.rep), cups: a.stats.totalCups };
  E.RNG.clear();
  return out;
}
const runA = playWithSeed(12345), runB = playWithSeed(12345), runC = playWithSeed(999);
if (JSON.stringify(runA) !== JSON.stringify(runB)) {
  throw new Error(`每日挑战不可复现: ${JSON.stringify(runA)} vs ${JSON.stringify(runB)}`);
}
if (JSON.stringify(runA) === JSON.stringify(runC)) throw new Error('不同种子却产生了相同结果');
ok(`每日挑战：同种子完全可复现（净资产 ${runA.worth} / ${runA.cups} 杯），换种子则不同`);

/* 21. 存档槽 + 导入导出 */
E.setSlot(2);
if (!E.saveGame(s3)) throw new Error('写入槽 2 失败');
const info2 = E.slotInfo(2);
if (!info2) throw new Error('槽 2 摘要读取失败');
if (!E.hasAnySave()) throw new Error('hasAnySave 未检测到存档');
const code = E.exportSave(s3);
if (!code || code.length < 50) throw new Error('导出存档为空');
const imp = E.importSave(code);
if (!imp.ok) throw new Error('导入存档失败: ' + imp.msg);
if (imp.state.day !== s3.day) throw new Error('导入存档天数不一致');
if (E.importSave('这不是存档').ok) throw new Error('非法存档应当被拒绝');
ok(`存档槽：3 槽 + 导出/导入往返一致 + 非法存档被拒`);

/* 22. 经营曲线图 */
if ((s3.history || []).length < 2) s3.history.push({ day: 1, revenue: 100, net: 50, worth: 900, rep: 30, cups: 10, orders: 8, lost: 1, rival: 28 });
const svg = UI.chartSVG(s3);
if (typeof svg !== 'string' || !svg.includes('<svg')) throw new Error('曲线图生成失败');
checkHTML('chartSVG', svg);
UI.showChart(); checkModal('chart'); UI.closeModal();
ok('经营曲线图：SVG 生成 + 报表弹窗');

/* 23. 战绩卡片 */
const card = UI.drawShareCard(s3, 'A', 12345, 'finish');
if (!card) throw new Error('战绩卡片生成失败');
UI.showEnd('finish');
checkHTML('结局页', E.document.getElementById('endWrap').innerHTML);
ok('战绩卡片绘制 + 结局页（含曲线 + 无尽入口）');

console.log('\n✅ 全部冒烟测试通过，无运行时异常');
