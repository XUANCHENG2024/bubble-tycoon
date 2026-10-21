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

/* ============================================================
 *  顶层符号冲突预防（必须在加载前做）
 *  H5 用经典脚本顺序加载，顶层 const/let 属于**共享的全局词法环境**：
 *  两个文件声明同名顶层 const 不是「后者覆盖前者」，而是让后加载的文件整份
 *  解析失败 —— H5 端表现为白屏，控制台只留一句 "already been declared"。
 *  这类错误加载后再怎么查都只剩白屏，所以先扫一遍源码。
 * ============================================================ */
const FILES = ['js/data.js', 'js/engine.js', 'js/ui.js', 'js/main.js'];
{
  const seen = {};
  for (const f of FILES) {
    const code = fs.readFileSync(path.join(root, f), 'utf8');
    const re = /^(?:const|let)\s+([A-Za-z_$][\w$]*)/gm;
    let m;
    while ((m = re.exec(code))) {
      const name = m[1];
      if (seen[name]) console.log(`  ⚠ 顶层符号 "${name}" 在 ${seen[name]} 与 ${f} 中各声明了一次（会导致白屏）`);
      else seen[name] = f;
    }
  }
}

const src = FILES
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n')
  + '\n;globalThis.__D={CFG,ING,RECIPES,UPGRADES,TRAITS,EVENTS,ACHIEVEMENTS,DIFFICULTY,TAGS,SHOP_COSTS,WEATHERS,NEWS,UI,TUT,SFX,'
  + 'adviceOf,maxCupsFromStock,maxOrdersFromStock,dailyOrderCapacity,dailyClickOrderCapacity,avgCupsPerOrder,typeWeightOf,'
  + 'CUSTOMER_TYPES,CUSTOMER_FACES,RIVAL_ACTIONS,RIVAL_NAMES,TYPE_WEATHER_BIAS,isWeekend,endlessGoal,'
  + 'RNG,QUEST_RNG,seedFromText,todayKey,pickCustomerType,initRival,rivalShare,rivalLevel,rivalAction,updateRival,money,clamp,pick,rnd,'
  + 'QUESTS,QUEST_COUNT,questById,questPool,questGoalOf,questRewardOf,rollQuests,bumpQuest,closeQuests,questViews,'
  + 'goalOf,startEndless,togglePause,slotInfo,hasAnySave,getSlot,setSlot,exportSave,importSave,'
  + 'MILESTONE_EVERY,MILESTONE_RATIO,milestoneOf,endlessPressure,prestigeGain,'
  + 'prestigeStartCash,claimAchStars,checkAchievements,trafficOf,claimOffline,isBankrupt,'
  + 'STRATEGY_CARDS,cardById,cardMul,cardSum,drawCards,applyCard,shouldOfferCard,serviceTimeOf,'
  + 'rankScore,recordDaily,dailyRecent,newMeta,loadMeta,pushRunRecord};';
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
  /* 每日任务走独立随机流，不一起播种就成了「同种子不可复现」 */
  E.QUEST_RNG.setSeed(seed ^ 0x9e3779b9);
  const a = E.newGame('normal', 0);
  for (let d = 0; d < 5; d++) {
    a.menu = ['boba']; a.ratios.boba = 1;
    E.openShop(a);
    let g = 0;
    while (a.phase === 'open' && g++ < 3000) E.tick(a, 1 / 30);
    E.nextDay(a);
  }
  const out = { worth: Math.round(E.netWorth(a)), rep: Math.round(a.rep), cups: a.stats.totalCups };
  E.RNG.clear(); E.QUEST_RNG.clear();
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


/* 24. 每日任务：抽取 / 发奖 / 跨天 / 存档 */
{
  const qs = s3.quests || [];
  if (qs.length !== E.QUEST_COUNT) throw new Error('每日任务数量应为 ' + E.QUEST_COUNT + '，实际 ' + qs.length);
  const ids = new Set(qs.map(q => q.id));
  if (ids.size !== qs.length) throw new Error('同一天抽到了重复任务');
  for (const it of qs) if (!E.questById(it.id)) throw new Error('任务 id 不在池子里: ' + it.id);

  /* 目标随天数上抬，且夹在 [min,max] */
  const g1 = E.questGoalOf(E.questById('q_cups'), { day: 1 });
  const g20 = E.questGoalOf(E.questById('q_cups'), { day: 20 });
  const g99 = E.questGoalOf(E.questById('q_cups'), { day: 99 });
  if (!(g20 > g1)) throw new Error('任务目标没有随天数上抬');
  if (g99 !== E.questById('q_cups').max) throw new Error('任务目标没有封顶');

  /* 达成即时到账 */
  const t = E.newGame('normal', 0);
  t.quests = [{ id: 'q_cups', goal: 5, prog: 0, done: false, got: 0 }];
  t.newQuests = [];
  const cash0 = t.cash;
  const got = E.bumpQuest(t, 'cups', 5);
  if (got.length !== 1) throw new Error('达到目标却没有判定达成');
  if (t.cash - cash0 <= 0) throw new Error('达成任务没有即时到账现金');
  if (!t.quests[0].done) throw new Error('任务未标记完成');
  /* 重复推进不应二次发奖 */
  const cash1 = t.cash;
  if (E.bumpQuest(t, 'cups', 50).length !== 0) throw new Error('已完成任务被重复发奖');
  if (t.cash !== cash1) throw new Error('已完成任务重复加钱');

  /* 越少越好型：达标发、超了不发 */
  const a = E.newGame('normal', 0);
  a.quests = [{ id: 'q_nolost', goal: 3, prog: 1, done: false, got: 0 }];
  if (E.closeQuests(a).length !== 1) throw new Error('流失未超限却没有发奖');
  const b = E.newGame('normal', 0);
  b.quests = [{ id: 'q_nolost', goal: 3, prog: 9, done: false, got: 0 }];
  if (E.closeQuests(b).length !== 0) throw new Error('流失超限却发了奖');

  /* 跨天换血 */
  const c = E.newGame('normal', 0);
  E.nextDay(c);
  if (c.questDay !== c.day) throw new Error('跨天后 questDay 没跟上');
  if ((c.quests || []).some(q => q.prog !== 0 || q.done)) throw new Error('跨天后任务进度没有清零');

  /* 存档往返：进度保留 */
  const d = E.newGame('normal', 0);
  d.quests = [{ id: 'q_trend', goal: 8, prog: 5, done: false, got: 0 },
               { id: 'q_clicks', goal: 20, prog: 1, done: false, got: 0 },
               { id: 'q_cups', goal: 12, prog: 0, done: false, got: 0 }];
  d.questDay = d.day;
  E.setSlot(1); E.saveGame(d);
  const d2 = E.loadGame(1);
  if (d2.quests.length !== 3) throw new Error('任务没有随存档保留');
  const tq = d2.quests.find(q => q.id === 'q_trend');
  if (!tq || tq.prog !== 5) throw new Error('任务进度读档后丢失');

  /* 旧存档（无 quests 字段）自动补一份，不能是空数组 */
  const legacy = E.sanitizeState({ v: 2, day: 1, diff: 'normal', cash: 700, rep: 26 });
  if (!legacy || legacy.quests.length !== E.QUEST_COUNT) throw new Error('旧存档没有补发每日任务');

  /* 脏数据：未知 id / 负数进度 */
  const dirty = E.sanitizeState(Object.assign({}, legacy, {
    quests: [{ id: '不存在', goal: -3, prog: -9, done: true, got: -1 }], questDay: 1,
  }));
  if (dirty.quests.length !== E.QUEST_COUNT) throw new Error('脏任务数据没有被替换');
  if (dirty.quests.some(q => q.prog < 0 || q.goal < 1)) throw new Error('脏任务数据没有被夹到合法区间');

  /* 展示模型 */
  const vs = E.questViews(d);
  if (vs.length !== 3) throw new Error('questViews 条数不对');
  if (vs.some(v => !isFinite(v.ratio) || v.ratio < 0 || v.ratio > 1)) throw new Error('questViews 进度比例越界');
  ok(`每日任务：3 条/天 · 目标随天数上抬并封顶 · 达成即时到账 · 跨天换血 · 存档往返 · 旧档补发`);
}

/* 25. 连续登录 */
{
  const m = E.newMeta();
  if (m.loginDate !== '' || m.loginStreak !== 0) throw new Error('新 Meta 的登录字段不是初始值');

  const r1 = E.claimLogin(m);
  if (!r1 || r1.streak !== 1) throw new Error('首次签到连登天数应为 1，实际 ' + (r1 && r1.streak));
  if (!(r1.cash > 0)) throw new Error('首次签到没有发钱');
  if (E.claimLogin(m) !== null) throw new Error('同一天重复签到竟然成功了');

  /* 断签：把日期改成前天 → 连登重置为 1 */
  const m2 = E.newMeta();
  m2.loginDate = '2000-01-01'; m2.loginStreak = 9; m2.loginBest = 9;
  const r2 = E.claimLogin(m2);
  if (r2.streak !== 1) throw new Error('断签后连登没有重置');
  if (m2.loginBest !== 9) throw new Error('最高连登记录被覆盖了');

  /* 续签：昨天 → +1 */
  const m3 = E.newMeta();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yk = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  m3.loginDate = yk; m3.loginStreak = 4;
  const r3 = E.claimLogin(m3);
  if (r3.streak !== 5) throw new Error('续签没有 +1');
  if (!r3.cont) throw new Error('续签没有标记为连续');

  /* 奖励封顶 */
  if (E.loginCashOf(1) >= E.loginCashOf(30)) throw new Error('连登奖励没有随天数增长');
  if (E.loginCashOf(30) !== E.loginCashOf(99)) throw new Error('连登奖励没有封顶');

  /* 开局到账：没签到自动补签，已签到把 pending 落进这一局 */
  const m4 = E.newMeta();
  const g = E.newGame('normal', 0);
  const cash0 = g.cash;
  const took = E.takeLoginBonus(g, m4);
  if (!took || !(took.cash > 0)) throw new Error('开局没有领到创业基金');
  if (g.cash - cash0 !== took.cash) throw new Error('创业基金没有进现金');
  if (m4.pendingCash !== 0) throw new Error('pendingCash 没有被清掉');
  const again = E.takeLoginBonus(g, m4);
  if (again !== null) throw new Error('同一局重复领取了创业基金');

  /* 只读快照不落盘也不改状态 */
  const snap = E.loginState(m4);
  if (snap.streak !== 1 || !snap.claimed) throw new Error('loginState 快照不对');
  ok(`连续登录：首签 ${r1.cash} 元 · 断签重置 · 续签 +1 · 奖励封顶 · 开局到账且不可重复领`);
}

/* 26. 第一轮 P1 遗留：营销清零提示 / 事件池轮换 / 无尽难度阶梯 / 结算环比 */
{
  /* ① 营销：当日投入打烊后归零，必须留下「昨天投了多少」供 UI 提示 */
  const g = E.newGame('normal', 0);
  g.marketing = 500;
  E.openShop(g);
  if (g.dayMarketing !== 500) throw new Error('开门时没有把营销投入记进当天');
  if (g.marketing !== 0) throw new Error('营销投入后没有归零');
  /* 直接推进到打烊 */
  let n = 0;
  while (g.phase === 'open' && n++ < 5000) E.tick(g, 1 / 30);
  E.nextDay(g);
  if (g.lastMarketing !== 500) throw new Error('跨天后没有保留昨日营销额（UI 无法提示）');
  if (!g.log.some(l => String(l.t || l).indexOf('营销') >= 0)) throw new Error('跨天日志没有说明营销已消耗');
  if (g.dayMarketing !== 0) throw new Error('新的一天营销没有归零');

  /* ② 事件池：抽干之后要重新轮换，不能永久静默 */
  const ev = E.newGame('normal', 0);
  if (!ev.doneEvents) throw new Error('doneEvents 缺失');
  ev.doneEvents = E.EVENTS.map(e => e.id);   /* 假装所有事件都已用过 */
  let rolled = 0;
  for (let i = 0; i < 400; i++) { ev.pendingEvent = null; E.nextDay(ev); if (ev.pendingEvent) rolled++; }
  if (rolled === 0) throw new Error('事件池耗尽后永久不再出事件（应为重新轮换）');
  if (ev.doneEvents.length > E.EVENTS.length) throw new Error('doneEvents 无限增长，轮换没有重置');

  /* ③ 无尽：只抬目标不够，工资与租金要同步上浮 */
  const en = E.newGame('normal', 0);
  if (E.endlessPressure(en) !== 1) throw new Error('非无尽模式不该有成本压力');
  en.endless = true; en.milestone = 1;
  const p1 = E.endlessPressure(en);
  en.milestone = 3;
  const p3 = E.endlessPressure(en);
  if (!(p3 > p1) || p1 !== 1) throw new Error('无尽压力没有随里程碑上升');
  /* 同一局面下开了无尽，固定成本必须真的变高 */
  const base = E.newGame('normal', 0);
  base.staff = [{ name: 'A', emoji: '🙂', skill: 1, trait: null, wage: 100, stamina: 100 }];
  base.shops = 2;
  const hard = JSON.parse(JSON.stringify(base));
  hard.endless = true; hard.milestone = 4;
  for (const st of [base, hard]) {
    st.menu = st.recipes.slice(0, E.menuSlots(st));
    E.openShop(st);
    let k = 0;
    while (st.phase === 'open' && k++ < 5000) E.tick(st, 1 / 30);
  }
  if (!(hard.report.rent + hard.report.wages > base.report.rent + base.report.wages)) {
    throw new Error('无尽里程碑没有真的抬高固定成本');
  }
  if (!(hard.report.pressure > 1)) throw new Error('结算没有带上压力系数，UI 无法展示');

  /* ④ 结算环比：要留一份「前一天」的报告 */
  const rp = E.newGame('normal', 0);
  rp.menu = rp.recipes.slice(0, E.menuSlots(rp));
  E.openShop(rp);
  let a = 0;
  while (rp.phase === 'open' && a++ < 5000) E.tick(rp, 1 / 30);
  if (rp.prevReport) throw new Error('第一天不该有环比基准');
  E.nextDay(rp);
  rp.menu = rp.recipes.slice(0, E.menuSlots(rp));
  E.openShop(rp);
  let b = 0;
  while (rp.phase === 'open' && b++ < 5000) E.tick(rp, 1 / 30);
  if (!rp.prevReport) throw new Error('第二天结算没有留下前一天的报告，环比无从计算');
  if (rp.prevReport.day === rp.report.day) throw new Error('prevReport 指向了自己');
  /* 存档往返 */
  E.setSlot(0); E.saveGame(rp);
  const rp2 = E.loadGame(0);
  if (!rp2.prevReport || rp2.prevReport.day !== rp.prevReport.day) throw new Error('prevReport 没有随存档保留');
  /* 结算页要真的画得出来（环比标签 + 营销提示都在里面） */
  E.window.S = rp;
  UI.showReport();
  checkHTML('结算页(环比)', E.document.getElementById('modalBox').innerHTML);
  ok('P1 遗留：营销提示 · 事件池轮换 · 无尽成本阶梯 · 结算环比（含存档往返）');
}

/* 27. 中期目标：每 5 天一个锚点 */
{
  const n = E.newGame('normal', 0);
  const ms1 = E.milestoneOf(n);
  if (!ms1 || ms1.day !== 5) throw new Error('开局应指向 Day 5 这个锚点');
  const goal = E.goalOf(n);
  if (ms1.worth !== Math.round(goal * E.MILESTONE_RATIO[0])) throw new Error('锚点金额与比例表不一致');

  /* 窗口推进：Day 6 起指向 Day 10 */
  n.day = 6;
  if (E.milestoneOf(n).day !== 10) throw new Error('跨过锚点后没有指向下一个');
  n.day = 30;
  if (E.milestoneOf(n).day !== 30) throw new Error('最后一个锚点应是 Day 30');

  /* 无尽 / 已通关没有中期目标 */
  const en = E.newGame('normal', 0); en.endless = true;
  if (E.milestoneOf(en) !== null) throw new Error('无尽模式不该有中期目标');

  /* 达成只记一次，且兑现成声望点 */
  const w = E.newGame('normal', 0);
  w.cash = 999999;                       /* 直接把净资产顶到锚点之上 */
  const mw = E.milestoneOf(w);
  if (!mw.hit) throw new Error('净资产远高于锚点却判定未达成');
  /* 走一次真实结算来触发记录 */
  w.menu = w.recipes.slice(0, E.menuSlots(w));
  E.openShop(w);
  let k = 0;
  while (w.phase === 'open' && k++ < 5000) E.tick(w, 1 / 30);
  if (!w.msHit || w.msHit.indexOf(5) < 0) throw new Error('结算时没有记下中期目标达成');
  /* 声望 = 净资产折算 + 每个已达成锚点各 +1；不能直接拿「改动前的值 +1」比，
     因为这一天的经营本身也改变了净资产。 */
  const baseBp = Math.max(1, Math.floor(Math.sqrt(Math.max(0, E.netWorth(w)) / 220)));
  if (E.prestigeGain(w) !== baseBp + w.msHit.length) throw new Error('中期目标没有兑现成声望点');
  if (w.msHit.length !== 1) throw new Error('第一天结算只应记下一个锚点，实际 ' + w.msHit.length);
  /* 同一锚点重复结算不能重复记 */
  const cnt = w.msHit.length;
  E.nextDay(w);
  w.menu = w.recipes.slice(0, E.menuSlots(w));
  E.openShop(w);
  let k2 = 0;
  while (w.phase === 'open' && k2++ < 5000) E.tick(w, 1 / 30);
  if (w.msHit.filter(d => d === 5).length !== 1) throw new Error('同一个锚点被重复记账');
  if (w.msHit.length < cnt) throw new Error('msHit 记录丢失');

  /* 存档往返 + 脏数据清洗 */
  E.setSlot(0); E.saveGame(w);
  const w2 = E.loadGame(0);
  if (!w2.msHit || !w2.msHit.length) throw new Error('msHit 没有随存档保留');
  const dirty = E.sanitizeState(Object.assign({}, E.newGame('normal', 0),
    { msHit: [3, 5, 7, 40, -5, 'x'] }));
  if (dirty.msHit.join(',') !== '5') throw new Error('非法锚点天数没有被过滤：' + dirty.msHit.join(','));

  /* 两版都要画得出来 */
  UI.renderManage();
  checkHTML('经营面板(中期目标)', E.document.getElementById('panel-manage').innerHTML);
  ok(`中期目标：每 ${E.MILESTONE_EVERY} 天一个锚点 · 达成记账一次 · 兑现声望 +1 · 存档往返 · 脏数据清洗`);
}

/* 28. 本机战绩榜：跨局保留最好的 5 局 */
{
  const m = E.newMeta();
  if (!Array.isArray(m.runsTop) || m.runsTop.length) throw new Error('新 Meta 的 runsTop 应为空数组');

  /* 用真实局面来记：净资产 = 现金 + 库存 + 已投入，手搓的假对象算不出来 */
  const mk = (cash, day, diff, extra) => {
    const g = E.newGame(diff, 0);
    g.cash = cash; g.day = day;
    Object.assign(g, extra || {});
    return g;
  };
  for (const w of [1000, 9000, 3000, 7000, 5000, 2000, 8000]) {
    E.pushRunRecord(m, mk(w, 30, 'normal'), 'finish');
  }
  if (m.runsTop.length !== E.CFG.RUN_TOP_N) throw new Error('战绩榜没有截断到 ' + E.CFG.RUN_TOP_N + ' 条');
  const ws = m.runsTop.map(r => r.worth);
  for (let i = 1; i < ws.length; i++) {
    if (ws[i] > ws[i - 1]) throw new Error('战绩榜没有按净资产降序：' + ws.join(','));
  }
  /* 输进去比它小的那一局不该留在榜上 */
  if (ws[ws.length - 1] <= 1000) throw new Error('战绩榜把垫底的小成绩也留下了：' + ws.join(','));

  /* 破产局也要记（这里给个足够高的净资产才能进前 5），且能被读出来 */
  E.pushRunRecord(m, mk(9500, 12, 'hard'), 'bankrupt');
  if (!m.runsTop.some(r => r.result === 'bankrupt')) throw new Error('破产局没有被记进战绩榜');

  /* 存读档往返 + 脏数据清洗 */
  E.saveMeta(m);
  const m2 = E.loadMeta();
  if (!m2.runsTop || m2.runsTop.length !== E.CFG.RUN_TOP_N) throw new Error('战绩榜没有随 META 持久化');
  store[E.CFG.META_KEY] = JSON.stringify({
    best: {}, bp: 0, runs: 1, ach: {},
    runsTop: [{ worth: 'x', day: -3, diff: '不存在的难度', result: 5 }, null, 42, { worth: 500 }],
  });
  const m3 = E.loadMeta();
  if (m3.runsTop.length !== 1) throw new Error('脏战绩数据没有被过滤：' + JSON.stringify(m3.runsTop));
  if (m3.runsTop[0].worth !== 500 || m3.runsTop[0].diff !== 'normal' || m3.runsTop[0].day !== 1) {
    throw new Error('脏战绩数据没有被夹到合法值：' + JSON.stringify(m3.runsTop[0]));
  }

  /* 标题页要真的渲染出这块（两版一致） */
  E.window.META = m;
  E.renderTitle();
  checkHTML('标题页(战绩榜)', E.document.getElementById('metaBox').innerHTML);
  ok(`本机战绩榜：按净资产降序保留 ${E.CFG.RUN_TOP_N} 局 · 破产局也记 · 存档往返 · 脏数据清洗`);
}

/* 30. F1：声望点改为开局资金 + 成就 ★ 一次性入账 */
{
  /* --- 折算曲线：√ 增长 + 封顶 --- */
  /* V10 重标定后 rate=30（见 data.js 的 BP_START_RATE 注释）：
     成就 ★ 总量涨到 239，若不改rate，满星玩家会在 239★ 时拿到 ¥695 启动资金，
     比150★ 时代的 ¥550 高出 26%，等于给老玩家一次无声的数值增强。
     新曲线：100★ → ¥300，239★（满星）→ ¥463。 */
  const cases = [[0, 0], [-5, 0], [1, 30], [4, 60], [25, 150], [100, 300], [400, 600], [9000, 900], [239, 463]];
  for (const [bp, want] of cases) {
    const got = E.prestigeStartCash(bp);
    if (got !== want) throw new Error(`prestigeStartCash(${bp}) = ${got}，期望 ${want}`);
  }
  if (E.prestigeStartCash('x') !== 0) throw new Error('非法声望值没有被归零');
  if (E.prestigeStartCash(null) !== 0) throw new Error('null 声望值没有被归零');

  /* --- 开局资金真的落进现金，且能被 UI 读到 --- */
  const rich = E.newGame('normal', 100);
  if (rich.startBonus !== 300) throw new Error('startBonus 没有落进 state：' + rich.startBonus);
  if (rich.cash !== E.DIFFICULTY.normal.cash + 300) throw new Error('开局资金没有加进现金：' + rich.cash);
  if (!rich.log.some(l => typeof l === 'string' && l.indexOf('创业基金') >= 0)) {
    throw new Error('日志里没有说明这笔钱从哪来');
  }
  const poor = E.newGame('normal', 0);
  if (poor.cash !== E.DIFFICULTY.normal.cash || poor.startBonus !== 0) throw new Error('首局不该有开局资金');

  /* --- 声望不再影响客流：改 bpBonus 前后必须完全一致 --- */
  const t0 = E.trafficOf(poor);
  poor.bpBonus = 150;
  if (E.trafficOf(poor) !== t0) throw new Error('声望还在影响客流 —— 这正是会导致「需求涨、供给不涨」的那一刀');
  poor.bpBonus = 0;

  /* --- 声望也不再影响离线收益 --- */
  const off = E.newGame('normal', 0);
  off.up.auto = 3;
  off.lastTime = Date.now() - 60 * 60000;
  const g1 = E.claimOffline(off);
  off.lastTime = Date.now() - 60 * 60000;
  off.bpBonus = 200;
  const g2 = E.claimOffline(off);
  if (!g1 || g1.gain <= 0) throw new Error('离线收益没有算出值，无法做对照');
  if (g1.gain !== g2.gain) throw new Error(`离线收益仍在吃声望加成：${g1.gain} vs ${g2.gain}`);

  /* --- 成就 ★：跨局首次才给，重复达成只给现金 --- */
  const meta = E.newMeta();
  const a0 = E.ACHIEVEMENTS[0], a1 = E.ACHIEVEMENTS[1];
  const f1 = E.claimAchStars(meta, [a0, a1]);
  if (f1.length !== 2) throw new Error('首次达成没有返回全部成就 id');
  if (meta.bp !== (a0.reward.bp + a1.reward.bp)) throw new Error('首次达成没有把 ★ 写进 META.bp：' + meta.bp);
  if (!meta.ach[a0.id] || !meta.ach[a1.id]) throw new Error('首次达成没有在 META.ach 上留痕');
  const f2 = E.claimAchStars(meta, [a0, a1]);
  if (f2.length !== 0 || meta.bp !== (a0.reward.bp + a1.reward.bp)) {
    throw new Error('重复达成又发了一遍 ★ —— 这样两局就会把开局资金顶到上限');
  }
  /* 坏输入不能炸，也不能白给 */
  const before = meta.bp;
  if (E.claimAchStars(null, [a0]).length) throw new Error('meta 为空时不该假装入账');
  E.claimAchStars(meta, null); E.claimAchStars(meta, [null, undefined, { }]);
  if (meta.bp !== before) throw new Error('脏列表改动了声望');
  if (!Array.isArray(E.claimAchStars(undefined, undefined))) throw new Error('claimAchStars 必须始终返回数组');
  /* 成就 ★ 总量是长期目标的上限，写死在这里防止有人手滑改坏了平衡。
     V10 新增 12 条城市/成就食谱成就后由 150 涨到 239，
     已同步把 BP_START_RATE 由 45 降到 30 重新标定资金曲线（见 data.js 注释）。
     ★ 数字改动时必须连带重标 rate，否则新玩家中期会莫名多出几百块启动资金。 */
  const totalBp = E.ACHIEVEMENTS.reduce((n, a) => n + (a.reward && a.reward.bp || 0), 0);
  if (totalBp !== 239) throw new Error('成就 ★ 总量变了（现在 ' + totalBp + '），需同步重标 BP_START_RATE');
  if (meta.maxBpEarned !== meta.bp) throw new Error('maxBpEarned 没有跟着涨');

  /* --- 存档清洗：startBonus 不能被人改存档凭空放大 --- */
  const clean = E.sanitizeState(Object.assign({}, E.newGame('normal', 0), { startBonus: 99999 }));
  if (clean.startBonus !== E.CFG.BP_START_CAP) throw new Error('startBonus 没有被夹到上限：' + clean.startBonus);
  const clean2 = E.sanitizeState(Object.assign({}, E.newGame('normal', 0), { startBonus: 'abc' }));
  if (clean2.startBonus !== 0) throw new Error('字符串 startBonus 没有被归零');
  const clean3 = E.sanitizeState(Object.assign({}, E.newGame('normal', 0), { startBonus: -80 }));
  if (clean3.startBonus !== 0) throw new Error('负数 startBonus 没有被归零');
  /* 存档往返保留 */
  E.setSlot(0); E.saveGame(rich);
  if (E.loadGame(0).startBonus !== 300) throw new Error('startBonus 没有随存档保留');

  /* --- 两版文案都渲染得出来 --- */
  E.window.S = rich; E.window.META = meta;
  UI.renderUp();                     /* 品牌卡在「⬆️ 升级」面板里，不是经营面板 */
  const up = E.document.getElementById('panel-up').innerHTML;
  checkHTML('升级面板(品牌声望)', up);
  if (up.indexOf('声望点永久生效') < 0) throw new Error('品牌面板丢了说明文案');
  if (up.indexOf('+¥300') < 0) {
    const i = up.indexOf('声望点永久生效');
    throw new Error('品牌面板没有显示本局到账的开局资金：' + JSON.stringify(up.slice(i, i + 260)));
  }
  E.renderTitle();
  const box = E.document.getElementById('metaBox').innerHTML;
  checkHTML('标题页(声望)', box);
  if (box.indexOf('开局创业基金') < 0) throw new Error('标题页没有显示开局创业基金');

  ok('F1：声望 → 开局资金（√ 曲线 ¥0~900）· 客流/离线不再吃声望 · 成就 ★ 跨局首次才给 · 存档清洗与往返');
}

/* 31. F2：打烊三选一策略卡 */
{
  /* --- 卡池自检：每张卡必须有好处、有代价、id 唯一、fx 只对得上的键 --- */
  const FX_KEYS = ['traffic', 'speed', 'priceTol', 'patience', 'tip', 'unitSub', 'cogs', 'rent', 'wage', 'stamina', 'repGain'];
  const seen = {};
  for (const c of E.STRATEGY_CARDS) {
    if (!c.id || seen[c.id]) throw new Error('策略卡 id 重复或缺失：' + c.id);
    seen[c.id] = true;
    if (!c.name || !c.emoji || !c.gain || !c.cost) throw new Error(`策略卡 ${c.id} 缺少名称/图标/收益/代价文案`);
    let posCount = 0, negCount = 0;
    for (const k in c.fx) {
      if (FX_KEYS.indexOf(k) < 0) throw new Error(`策略卡 ${c.id} 用了未知效果键 ${k}（engine 不会读它）`);
      /* unitSub 是「每杯扣钱」，越大越坏；其余都是倍率，>1 为好 */
      if (k === 'unitSub') { if (c.fx[k] > 0) negCount++; }
      else if (k === 'cogs' || k === 'rent' || k === 'wage' || k === 'stamina') { if (c.fx[k] < 1) posCount++; }
      else if (c.fx[k] > 1) posCount++;
    }
    for (const k in c.fx) {
      if (k !== 'unitSub' && k !== 'cogs' && k !== 'rent' && k !== 'wage' && k !== 'stamina' && c.fx[k] < 1) negCount++;
      if ((k === 'cogs' || k === 'rent' || k === 'wage' || k === 'stamina') && c.fx[k] > 1) negCount++;
    }
    if (!posCount || !negCount) throw new Error(`策略卡 ${c.id} 不是「有得有失」——纯增益会让最优解变成全都要`);
  }

  /* --- 抽取规则：每 CARD_EVERY 天一次，不重复，上限 CARD_MAX --- */
  const g = E.newGame('normal', 0);
  if (E.cardMul(g, 'traffic') !== 1) throw new Error('无卡时效果必须是 1（不能改变原有数值）');
  g.day = 2;
  if (E.drawCards(g) !== null) throw new Error(`Day 2 不该抽卡（每 ${E.CFG.CARD_EVERY} 天一次）`);
  g.day = E.CFG.CARD_EVERY;
  const offer1 = E.drawCards(g);
  if (!Array.isArray(offer1) || offer1.length !== E.CFG.CARD_OFFER_N) throw new Error('首 must offer three');
  const ids1 = offer1.map(c => c.id);
  if (new Set(ids1).size !== ids1.length) throw new Error('同一次抽卡出现了重复卡');

  /* --- 采纳后效果立刻生效 --- */
  const base = E.trafficOf(g);
  E.applyCard(g, 'takeout');
  if (!g.cards.length || g.cards[0] !== 'takeout') throw new Error('applyCard 没有写进 s.cards');
  if (g.cardOffer !== null) throw new Error('选完之后卡包要清空（否则下一天还会重复弹）');
  const afterCard = E.trafficOf(g);
  /* 期望值从卡配置里读，别写死 —— 一改数值平衡就得改测试，等于把两个真相绑在一起 */
  const want = Math.round(base * E.cardById('takeout').fx.traffic);
  if (Math.abs(afterCard - want) > 1) throw new Error(`外卖平台没有按配置改变客流：${base} → ${afterCard}（期望 ${want}）`);
  /* 同一张不能拿第二次 */
  if (E.applyCard(g, 'takeout') !== null || g.cards.length !== 1) throw new Error('同一张卡被重复持有');
  /* 未知 id 不能混进来 */
  if (E.applyCard(g, '不存在的卡') !== null) throw new Error('非法卡 id 也能采纳');
  /* 速度类 / 绝对值类 */
  const sv0 = E.serviceTimeOf(g, null, null);
  E.applyCard(g, 'express');
  if (!(E.serviceTimeOf(g, null, null) < sv0)) throw new Error('极速出杯没有真的缩短出杯时间');
  E.applyCard(g, 'chain');
  const wantSub = E.cardById('takeout').fx.unitSub + E.cardById('chain').fx.unitSub;
  if (Math.abs(E.cardSum(g, 'unitSub') - wantSub) > 1e-6) throw new Error('unitSub 应当叠加而不是叠乘');
  /* 上限 */
  const capped = E.newGame('normal', 0);
  for (const c of E.STRATEGY_CARDS) E.applyCard(capped, c.id);
  if (capped.cards.length !== E.CFG.CARD_MAX) throw new Error(`持有上限应为 ${E.CFG.CARD_MAX}，实际 ${capped.cards.length}`);
  if (E.drawCards(capped) !== null) throw new Error('满了还继续抽卡');

  /* --- 抽卡必须用 QUEST_RNG：每日挑战靠「同种子同局」，不能被新增的随机调用弄坏 --- */
  const mkDay = () => { const st = E.newGame('normal', 0); st.day = E.CFG.CARD_EVERY; return st; };
  E.QUEST_RNG.setSeed(E.seedFromText('bubble-quest-cardtest'));
  const seedA = (E.drawCards(mkDay()) || []).map(c => c.id).join(',');
  E.QUEST_RNG.setSeed(E.seedFromText('bubble-quest-cardtest'));
  const seedB = (E.drawCards(mkDay()) || []).map(c => c.id).join(',');
  E.QUEST_RNG.clear();
  if (!seedA.length || seedA !== seedB) throw new Error(`同种子抽到的卡不一样：「${seedA}」vs「${seedB}」`);

  /* --- 完整一天：打烊要真的给出三选一 --- */
  const day = E.newGame('normal', 0);
  day.day = E.CFG.CARD_EVERY;      /* 打烊时 day 还没自增，所以直接设成倍数那天 */
  day.menu = day.recipes.slice(0, E.menuSlots(day));
  E.openShop(day);
  let steps = 0;
  while (day.phase === 'open' && steps++ < 5000) E.tick(day, 1 / 30);
  if (!day.cardOffer || !day.cardOffer.length) throw new Error('打烊后没有生成卡包');
  E.nextDay(day);
  if (day.cardOffer !== null) throw new Error('进入下一天后卡包没有作废');

  /* --- 存档：改存档不能凭空加卡 --- */
  const dirty = E.sanitizeState(Object.assign({}, E.newGame('normal', 0),
    { cards: ['takeout', 'takeout', 'hack', null, 42], cardOffer: ['x', 'express'] }));
  if (dirty.cards.join(',') !== 'takeout') throw new Error('脏 smarter 卡片没有被清洗：' + JSON.stringify(dirty.cards));
  if (dirty.cardOffer.join(',') !== 'express') throw new Error('脏卡包没有被清洗：' + JSON.stringify(dirty.cardOffer));
  const many = E.sanitizeState(Object.assign({}, E.newGame('normal', 0),
    { cards: E.STRATEGY_CARDS.map(c => c.id) }));
  if (many.cards.length !== E.CFG.CARD_MAX) throw new Error('超过上限的卡没有被截断');
  E.setSlot(0); E.saveGame(g);
  const loaded = E.loadGame(0);
  if (!loaded.cards || loaded.cards.join(',') !== g.cards.join(',')) throw new Error('策略卡没有随存档保留');

  /* --- 两版都要画得出来 --- */
  E.window.S = g; E.window.META = E.newMeta();
  UI.renderManage();
  checkHTML('经营面板(策略卡)', E.document.getElementById('panel-manage').innerHTML);
  if (E.document.getElementById('panel-manage').innerHTML.indexOf('cd-chip') < 0) {
    throw new Error('经营面板没有显示已持有的策略卡');
  }
  g.cardOffer = E.drawCards(g);
  if (!UI.showCardDraft()) throw new Error('卡包存在时却弹不出三选一');
  const draft = E.document.getElementById('modalBox').innerHTML;
  checkHTML('打烊三选一', draft);
  if (draft.indexOf('data-act="pickcard"') < 0) throw new Error('三选一没有给出选卡按钮：' + draft.slice(0, 200));
  if (draft.indexOf('data-act="skipcard"') < 0) throw new Error('三选一没有「都不要」出口');
  if (draft.indexOf('cd-up') < 0 || draft.indexOf('cd-down') < 0) throw new Error('三选一没有标出收益与代价');

  ok(`F2：12 张「有得有失」策略卡 · 每 ${E.CFG.CARD_EVERY} 天三选一 · 上限 ${E.CFG.CARD_MAX} 张 · 存档清洗与往返`);
}

/* 32. F3：每日挑战「同种子日榜」 */
{
  /* --- 上报分数：平台只收 [0, int32_MAX) 的正整数 --- */
  const MAX = E.CFG.RANK_SCORE_MAX;
  if (E.rankScore(38402) !== 38402) throw new Error('rankScore 不该改变正常值');
  if (E.rankScore(-500) !== 0) throw new Error('净资产为负（破产）必须夹到 0，平台只收正数');
  if (E.rankScore(MAX + 9999) !== MAX) throw new Error('超过 int32_MAX 的分数没有被夹住');
  if (E.rankScore('x') !== 0 || E.rankScore(null) !== 0) throw new Error('非法净资产没有被归零');
  if (E.rankScore(1234.6) !== 1235) throw new Error('上报分数必须是整数');

  /* --- 一天打多局：只记最好的那一局 ---
     日期动态生成：以前这里硬编码 '2026-10-20'，日历翻过午夜后
     「日榜没有显示今日种子日期」就会假失败 —— 和代码无关的坑。
     D2 = 明天：换天分支需要两个不同的日期。 */
  const m = E.newMeta();
  const D1 = E.todayKey();
  const _tm = new Date(); _tm.setDate(_tm.getDate() + 1);
  const D2 = `${_tm.getFullYear()}-${String(_tm.getMonth() + 1).padStart(2, '0')}-${String(_tm.getDate()).padStart(2, '0')}`;
  let r = E.recordDaily(m, D1, 10000);
  if (!r.newToday || !r.newEver) throw new Error('首局应同时刷新今日与个人最佳');
  if (m.dailyBest !== 10000 || m.dailyBestEver !== 10000) throw new Error('成绩没有落进 META');

  r = E.recordDaily(m, D1, 8000);
  if (r.newToday || r.newEver) throw new Error('更差的一局不该刷新纪录');
  if (m.dailyBest !== 10000) throw new Error('更差的一局把今天的最佳覆盖掉了（上报会把名次冲掉）');
  if (m.dailyLog.length !== 1 || m.dailyLog[0].best !== 10000) throw new Error('日志被更差的一局污染');

  r = E.recordDaily(m, D1, 12000);
  if (!r.newToday || !r.newEver) throw new Error('更好的一局没有刷新纪录');
  if (m.dailyBest !== 12000 || m.dailyBestEver !== 12000) throw new Error('更好的一局没有覆盖');
  if (r.prevToday !== 10000) throw new Error('prevToday 没有回传上一局的成绩');
  if (m.dailyLog.length !== 1 || m.dailyLog[0].best !== 12000) throw new Error('同一天应只有一条日志且取最好值');

  /* --- 换天：今日重置，个人最佳保留 --- */
  r = E.recordDaily(m, D2, 5000);
  if (m.dailyDate !== D2 || m.dailyBest !== 5000) throw new Error('换天没有重置今日成绩');
  if (m.dailyBestEver !== 12000) throw new Error('个人最佳被换天清掉了');
  if (r.newEver) throw new Error('更差的一天不该刷新个人最佳');
  if (m.dailyLog.length !== 2 || m.dailyLog[0].d !== D1 || m.dailyLog[1].d !== D2) {
    throw new Error('日志没有按日期升序排列：' + JSON.stringify(m.dailyLog));
  }

  /* --- 日志上限与 recent 取法 --- */
  const m2 = E.newMeta();
  for (let i = 0; i < E.CFG.DAILY_LOG_MAX + 6; i++) {
    E.recordDaily(m2, '2026-01-' + String(i + 1).padStart(2, '0'), 100 + i);
  }
  if (m2.dailyLog.length !== E.CFG.DAILY_LOG_MAX) throw new Error('日志没有截断到 ' + E.CFG.DAILY_LOG_MAX);
  if (m2.dailyLog[0].d !== '2026-01-07') throw new Error('截断时丢的不是最早的那天：' + m2.dailyLog[0].d);
  const rec = E.dailyRecent(m2, 7);
  if (rec.length !== 7) throw new Error('dailyRecent 没有取到 7 天');
  if (rec[6].d !== '2026-01-20') throw new Error('dailyRecent 应返回最近 7 天且按日期升序');
  if (E.dailyRecent(E.newMeta(), 7).length) throw new Error('空记录不该返回任何东西');
  if (E.recordDaily(null, D1, 100).newToday) throw new Error('meta 为空时不该假装入账');

  /* --- 存档：脏数据不能污染日榜 --- */
  E.saveMeta(m);
  const m4 = E.loadMeta();
  if (m4.dailyBest !== 5000 || m4.dailyBestEver !== 12000 || m4.dailyLog.length !== 2) {
    throw new Error('每日成绩没有随 META 持久化');
  }
  store[E.CFG.META_KEY] = JSON.stringify({
    dailyDate: '<script>alert(1)</script>', dailyBest: -99, dailyBestEver: 'x',
    dailyLog: [{ d: 'not-a-date', best: 5 }, null, 42, { d: '2026-02-02', best: -1 }, { d: '2026-02-01', best: 700 }],
  });
  const m5 = E.loadMeta();
  if (m5.dailyDate !== '') throw new Error('非法日期没有被清空：' + m5.dailyDate);
  if (m5.dailyBest !== 0 || m5.dailyBestEver !== 0) throw new Error('非法成绩没有被归零');
  if (m5.dailyLog.length !== 2 || m5.dailyLog[0].d !== '2026-02-01' || m5.dailyLog[1].best !== 0) {
    throw new Error('脏日志没有被清洗：' + JSON.stringify(m5.dailyLog));
  }

  /* --- 面板渲染 --- */
  E.window.META = m;
  UI.showDailyRank();
  const html = E.document.getElementById('modalBox').innerHTML;
  checkHTML('每日挑战日榜', html);
  if (html.indexOf('rk-bars') < 0) throw new Error('日榜面板没有渲染最近 7 天的柱图');
  if (html.indexOf(D1) < 0) throw new Error('日榜没有显示今日种子日期');
  /* 这里必须走 onclick 而不是 data-act：全局委托不会顺手关掉弹窗，
     不先 closeModal 就 startGame 会把日榜面板挂在游戏画面上。 */
  if (html.indexOf("UI.closeModal();doAct('daily')") < 0) throw new Error('日榜面板没有给出挑战入口');
  UI.closeModal();

  /* 标题页按钮：打过就把成绩顶上去 */
  m.dailyDate = E.todayKey(); m.dailyBest = 12345;
  E.renderTitle();
  const br = E.document.getElementById('btnDailyRank');
  if (!br) throw new Error('标题页缺少日榜按钮');
  if (br.textContent.indexOf('12,345') < 0) {
    throw new Error('打过之后日榜按钮没有显示今天的成绩：' + br.textContent);
  }
  checkHTML('标题页(日榜)', E.document.getElementById('metaBox').innerHTML);

  ok('F3：每日挑战日榜（只记当天最好一局 · 近 7 天 · 上报分数夹到 int32 · 存档清洗 · 两版入口）');
}

console.log('\n✅ 全部冒烟测试通过，无运行时异常');
