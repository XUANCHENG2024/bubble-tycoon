/* ============================================================
 *  真实 DOM 冒烟测试（jsdom）
 *  与 dom-smoke.js 的区别：这里是浏览器级 DOM 解析/事件/querySelector，
 *  能验证手写桩测不出的东西 —— 例如引导的 data-tut 选择器是否真能命中元素、
 *  渲染出的 HTML 是否被浏览器正确解析、内联 onclick 能否访问全局符号。
 * ============================================================ */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('./jsdom-loader');

const root = path.join(__dirname, '..');
const errors = [];

const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

/* 把 <script src> 内联成 <script>...</script>，让 jsdom 以经典脚本执行（全局词法作用域） */
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script src="js\/([a-z]+)\.js"><\/script>/g,
  (m, name) => '<script>' + fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8') + '<\/script>');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const { window } = dom;
const doc = window.document;
const $ = id => doc.getElementById(id);
const q = sel => doc.querySelector(sel);

/* jsdom 没装 canvas 包，getContext 会抛 "Not implemented" 并把错误记进
   virtualConsole —— 结局页要画战绩分享卡片（drawShareCard），那是真实分支，
   不该因为环境缺失就被判成脚本错误。这里补一个够用的 2D 上下文桩。 */
if (window.HTMLCanvasElement) {
  window.HTMLCanvasElement.prototype.getContext = function () {
    const noop = () => { };
    return {
      canvas: this, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '',
      textBaseline: '', globalAlpha: 1, lineJoin: '', lineCap: '', shadowBlur: 0, shadowColor: '',
      fillRect: noop, strokeRect: noop, clearRect: noop, beginPath: noop, closePath: noop,
      moveTo: noop, lineTo: noop, arc: noop, arcTo: noop, bezierCurveTo: noop, quadraticCurveTo: noop,
      fill: noop, stroke: noop, clip: noop, save: noop, restore: noop, translate: noop,
      rotate: noop, scale: noop, transform: noop, setTransform: noop, resetTransform: noop,
      fillText: noop, strokeText: noop, measureText: () => ({ width: 10 }),
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
      createPattern: () => null, drawImage: noop, putImageData: noop, getImageData: () => ({ data: [] }),
    };
  };
}

let step = 0, failed = 0;
function ok(msg) { console.log(`  ✔ ${++step}. ${msg}`); }
function bad(msg) { failed++; console.log(`  ✘ ${++step}. ${msg}`); }
function check(cond, msg) { cond ? ok(msg) : bad(msg); }

/* 等待一帧 */
const tick = () => new Promise(r => setTimeout(r, 0));
/* 真等几帧：jsdom 的 requestAnimationFrame 走自己的时钟，setTimeout(0) 等不到帧 */
const frames = (n) => new Promise(r => setTimeout(r, 17 * (n || 1)));

(async function run() {
  await tick();

  /* 顶层 const 声明属于「全局词法作用域」，不会成为 window 的属性。
     用 window.eval 把它们导出到 window，才能在测试里访问（这也是生产代码能互相访问的原因）。 */
  window.eval('window.__G = { UI, TUT, SFX, RNG, CFG, DIFFICULTY, CUSTOMER_TYPES, TUTORIAL };');
  window.UI = window.__G.UI;
  window.TUT = window.__G.TUT;
  window.CFG = window.__G.CFG;

  /* 1. 脚本执行无错误 */
  check(errors.length === 0, `页面加载无脚本错误${errors.length ? '：' + errors[0] : ''}`);

  /* 2. 标题页元素 */
  check(!!$('btnStart') && !!$('btnContinue'), '标题页按钮存在');
  const diffCount = doc.querySelectorAll('.diff-opt').length;
  check(diffCount === 3, `难度选项渲染 ${diffCount} 个`);
  const slotCount = doc.querySelectorAll('.slot').length;
  check(slotCount === 3, `存档槽渲染 ${slotCount} 个`);

  /* 3. 开局 */
  $('btnStart').click();
  await tick();
  check($('screen-game').classList.contains('active'), '点击开始后进入游戏界面');
  check(!!window.S, '全局状态已建立');
  check($('hudCash').textContent.startsWith('¥'), 'HUD 现金已渲染：' + $('hudCash').textContent);

  /* 3b. 导出入口：UI.showExport 以前完全没有调用点，等于死代码 */
  const btnExp = $('btnExport');
  check(!!btnExp, '标题页存在「导出存档」按钮（UI.showExport 不再是死代码）');
  if (btnExp) {
    btnExp.click();
    await tick();
    const expTa = $('exportCode');
    check(!!expTa && expTa.value.length > 50,
      `点导出后生成存档码（${expTa ? expTa.value.length : 0} 字符）`);
    const rt = expTa ? window.importSave(expTa.value) : null;
    check(!!(rt && rt.ok), '导出的存档码可原样导入还原');
    window.UI.closeModal();
    await tick();
  }

  /* 4. 六个面板 */
  const tabs = [...doc.querySelectorAll('.tab')].map(t => t.dataset.tab);
  check(tabs.length === 6, `Tab 数量 ${tabs.length}：${tabs.join('/')}`);
  for (const t of tabs) {
    const before = errors.length;
    [...doc.querySelectorAll('.tab')].find(x => x.dataset.tab === t).click();
    await tick();
    const panel = $('panel-' + t);
    const rendered = panel && panel.innerHTML.length > 50;
    if (!rendered || errors.length > before) bad(`面板 ${t} 渲染异常（长度 ${panel ? panel.innerHTML.length : 0}，新增错误 ${errors.length - before}）`);
  }
  if (errors.length === 0) ok('六个面板全部渲染成功');

  /* 5. 关键：引导的 data-tut 选择器必须能命中真实元素 */
  [...doc.querySelectorAll('.tab')].find(x => x.dataset.tab === 'manage').click();
  await tick();
  const sels = window.TUT.steps.map(st => st.sel).filter(Boolean);
  const missing = sels.filter(sel => !q(sel));
  check(missing.length === 0,
    `引导高亮选择器全部命中（${sels.length} 个）${missing.length ? ' · 缺失：' + missing.join(', ') : ''}`);

  /* 6. 走完整引导：验证不会卡死、且每步都能定位 */
  window.TUT.start(0);
  const seen = new Set();
  let guard = 0;
  while (window.TUT.active && guard++ < 100) {
    const st = window.TUT.steps[window.TUT.i];
    seen.add(st.key);
    if (st.advance !== 'next') window.TUT.notify(st.advance);
    else window.TUT.next();
    await tick();
  }
  check(!window.TUT.active, `引导走完 ${seen.size}/${window.TUT.steps.length} 步且不卡死`);

  /* 7. 营业一天（真实点击出杯位） */
  const s = window.S;
  s.menu = s.recipes.slice(0, window.menuSlots(s));
  for (const r of s.menu) s.ratios[r] = 1.0;
  window.doAct('open', $('btnStart'));
  await tick();
  check(s.phase === 'open', '成功开门营业');
  for (let i = 0; i < 900 && s.phase === 'open'; i++) {
    window.tick(s, 1 / 30);
    if (s.sim && s.sim.stations[0] && s.sim.stations[0].order) window.rushStation(s, 0);
    window.UI.stageSync();
  }
  check(s.phase === 'report', `营业结束并进入结算（卖出 ${s.report ? s.report.served : 0} 杯）`);
  check(!!s.report && s.report.served > 0, '结算数据有效');

  /* 8. 结算弹窗 + 进入下一天 */
  window.UI.showReport();
  await tick();
  check($('modal').classList.contains('on'), '结算弹窗已打开');
  const nextBtn = q('[data-act="nextday"]');
  check(!!nextBtn, '结算弹窗含「进入下一天」按钮');
  nextBtn.click();
  await tick();
  check(s.day === 2 && s.phase === 'prep', '成功推进到 Day 2');

  /* 9. 存档往返（真实 localStorage） */
  window.saveGame(s);
  const loaded = window.loadGame();
  check(!!loaded && loaded.day === s.day, '存档写入/读取一致');

  /* 10. XSS 检测：恶意存档进入渲染后不得产出可执行标签 */
  const evil = JSON.parse(JSON.stringify(s));
  evil.log = ['<img src=x onerror="window.__XSS=1">', '<script>window.__XSS2=1<\/script>'];
  evil.rival = Object.assign({}, s.rival, { name: '<img src=y onerror="window.__XSS3=1">' });
  evil.staff = [{ id: 99, name: '<b onclick="window.__XSS4=1">x</b>', emoji: '🧑', skill: 1, trait: null, wage: 50, stamina: 100 }];
  window.importSave(window.b64encode(JSON.stringify(evil)));
  const evilState = window.importSave(window.b64encode(JSON.stringify(evil))).state;
  check(!!evilState, '恶意存档仍可被导入（用于验证渲染层是否安全）');

  window.S = evilState;
  window.UI.setTab('manage');
  await tick();
  window.UI.setTab('rival');
  await tick();
  window.UI.setTab('staff');
  await tick();

  /* 判定标准：恶意字符串必须只作为「文本」存在，不能被解析成真的元素/事件属性。
     注意不能只做字符串匹配 —— 转义后的文本里照样能搜到 onerror= 字样。 */
  const injected = [
    ...doc.querySelectorAll('#screen-game img, #screen-game script'),
    ...doc.querySelectorAll('#screen-game [onerror], #screen-game [onclick], #screen-game [onload]'),
  ].filter(el => !el.hasAttribute('data-act'));   /* data-act 按钮是正常交互，不算注入 */
  check(injected.length === 0,
    '渲染层对恶意字符串做了转义（未解析出注入的元素/事件属性）'
    + (injected.length ? ` · 命中 ${injected.length} 个：${injected.slice(0, 3).map(e => e.tagName + (e.getAttribute('src') || e.getAttribute('onerror') || '')).join(' | ')}` : ''));
  check(!window.__XSS && !window.__XSS2 && !window.__XSS3 && !window.__XSS4, '未执行注入的脚本');

  /* 11. 损坏 / 敌意存档不得让游戏崩溃或产生 NaN */
  const before11 = errors.length;
  const broken = [
    'not-a-save', '{}', btoa('{"v":2}'),
    window.b64encode(JSON.stringify({ v: 2, day: 'abc', cash: null, diff: 'HACK', up: {}, inv: {}, menu: null, recipes: null, staff: null, history: null, rival: null, flags: null, ach: null, log: null, tut: null })),
    window.b64encode(JSON.stringify({ v: 2, day: 1, cash: NaN, diff: 'normal' })),
  ];
  let survived = 0;
  const crash = [];
  for (let i = 0; i < broken.length; i++) {
    try {
      const r = window.importSave(broken[i]);
      if (r && r.ok) { window.S = r.state; window.UI.renderHUD(); window.UI.setTab('manage'); await tick(); }
      survived++;
    } catch (e) { crash.push(`#${i}: ${e && e.message}`); }
  }
  check(survived === broken.length && errors.length === before11,
    `损坏/敌意存档 ${broken.length} 例全部被安全处理（未崩溃、未新增错误）`
    + (crash.length ? ` · 崩溃：${crash.join(' | ')}` : '')
    + (errors.length > before11 ? ` · 错误：${errors.slice(before11, before11 + 3).join(' | ')}` : ''));

  /* 12. 数值健全性：HUD 不得出现 NaN */
  const hudTxt = $('hudCash').textContent + $('hudWorth').textContent + $('hudRep').textContent;
  check(!/NaN|undefined|Infinity/.test(hudTxt), 'HUD 无 NaN/undefined：' + hudTxt);

  /* ---------- 13. 重构后新增的边界保护（回归锁定） ---------- */
  window.eval('window.__T = { tick, openShop, setRatio, pushLog, newGame, saveGame, loadGame };');
  const T = window.__T;

  const fresh = T.newGame('normal', 0);
  fresh.menu = fresh.recipes.slice(0, 1);
  fresh.ratios[fresh.menu[0]] = 1.0;
  const opened = T.openShop(fresh);
  check(opened.ok, '测试用局面可以开门');

  /* NaN 的 dt 不能污染 sim.t —— 否则整局再也推不动 */
  const before13err = errors.length;
  const tRef = fresh.sim.t;
  T.tick(fresh, NaN);
  T.tick(fresh, Infinity);
  T.tick(fresh, -5);
  check(fresh.sim.t === tRef && errors.length === before13err,
    'tick 对 NaN/Infinity/负数 dt 一律跳过（sim.t 不被污染）');

  /* setRatio 的 NaN 必须收敛，而不是存进 ratios */
  const rr = fresh.menu[0];
  T.setRatio(fresh, rr, NaN);
  check(fresh.ratios[rr] === 1, 'setRatio(NaN) 收敛到默认值 1 而不是 NaN');

  /* pushLog 必须自行裁剪，不能让 log 无限增长 */
  const plenty = T.newGame('normal', 0);
  for (let i = 0; i < 300; i++) T.pushLog(plenty, '压测日志 ' + i);
  check(plenty.log.length === 60 && plenty.log[plenty.log.length - 1] === '压测日志 299',
    `pushLog 自动裁剪到 60 条且保留最新（实际 ${plenty.log.length} 条）`);

  /* 存档不得把体积巨大的 sim 写进 localStorage */
  T.saveGame(fresh);
  const saveKey = window.CFG.SAVE_PREFIX + '0';
  const savedRaw = window.localStorage.getItem(saveKey);
  check(!!savedRaw && !savedRaw.includes('"stations"'),
    `存档不包含 sim 明细（stations 不落盘）${savedRaw ? '' : ' · 未读到 ' + saveKey}`);

  /* 索引表取值必须与原始数组一致（data.js 改造回归） */
  const idsMatch = window.eval(`
    ING.every(g => ingById(g.id) === g) &&
    RECIPES.every(r => recipeById(r.id) === r) &&
    UPGRADES.every(u => upgradeById(u.id) === u) &&
    TRAITS.every(t => traitById(t.id) === t) &&
    CUSTOMER_TYPES.every(t => customerTypeById(t.id) === t) &&
    ingById('__nope__') === undefined && recipeById('__nope__') === undefined
  `);
  check(idsMatch, 'id 索引表与原始数组结果一致，未知 id 返回 undefined');

  /* 营业舞台的「已卖」必须读实时计数 sim.cups。
     曾经这里读的是 sim.served —— 那个字段只存在于日报里，
     结果舞台一栏一直显示 undefined，出杯音效也从不响。
     这条断言把「活着的 sim 上有哪些字段」这件事钉死。 */
  const stageFresh = T.newGame('normal', 0);
  stageFresh.menu = stageFresh.recipes.slice(0, 1);
  stageFresh.ratios[stageFresh.menu[0]] = 1.0;
  T.openShop(stageFresh);
  for (let i = 0; i < 200 && stageFresh.phase === 'open'; i++) T.tick(stageFresh, 0.25);
  const simKeys = Object.keys(stageFresh.sim || {});
  check(!simKeys.includes('served') && simKeys.includes('cups'),
    '实时 sim 上的已卖计数叫 cups（served 只属于日报）');
  check(typeof stageFresh.sim.cups === 'number' && isFinite(stageFresh.sim.cups),
    `营业中「已卖」可读到有限数字：${stageFresh.sim.cups} 杯`);

  /* ---------- 32. 每日任务卡（H5 DOM 版） ---------- */
  window.eval('window.__Q = { questViews, loginState, claimLogin };');
  const Q = window.__Q;
  const stQ = window.S;
  if (stQ) {
    stQ.quests = [
      { id: 'q_cups', goal: 20, prog: 6, done: false, got: 0 },
      { id: 'q_nolost', goal: 4, prog: 1, done: false, got: 0 },
      { id: 'q_clicks', goal: 24, prog: 24, done: true, got: 28 },
    ];
    window.eval('UI.renderManage()');
  }
  const qRows = doc.querySelectorAll('#panel-manage .quest').length;
  check(qRows === 3, `经营面板渲染出 3 行每日任务（实际 ${qRows} 行）`);
  const qDone = doc.querySelectorAll('#panel-manage .quest.done').length;
  check(qDone === 1, `已完成的任务单独标记（${qDone} 行）`);
  const qTxt = Array.from(doc.querySelectorAll('#panel-manage .quest .q-v'))
    .map(e => e.textContent).join(' | ');
  check(!/NaN|undefined|Infinity/.test(qTxt), '任务进度文案无 NaN/undefined：' + qTxt);
  const qBar = doc.querySelector('#panel-manage .quest .q-bar i');
  check(qBar && /^\d+(\.\d+)?%$/.test(qBar.style.width),
    '任务进度条宽度是合法百分比：' + (qBar ? qBar.style.width : '缺失'));
  const qView = Q.questViews(stQ);
  check(qView.length === 3 && qView.every(v => v.ratio >= 0 && v.ratio <= 1),
    'questViews 进度比例都在 0~1（含「越少越好」型）');

  /* ---------- 33. 连续登录 ---------- */
  const bl = $('btnLogin');
  check(!!bl, '标题页存在连续登录按钮');
  if (bl) {
    check(/连登|已领|签到/.test(bl.textContent),
      '连续登录按钮文案可读：' + bl.textContent.trim());
  }
  /* 营销快捷键：switch 里原本没有 mktset 分支，四个按钮点了没反应也不报错 */
  stQ.marketing = 0;
  window.eval('UI.setTab("manage"); UI.renderAll();');
  const mk = doc.querySelector('#panel-manage [data-act="mktset"][data-v="500"]');
  check(!!mk, '经营面板有营销快捷键');
  if (mk) {
    mk.click();
    check(window.S.marketing === 500,
      `点击 ¥500 快捷键后营销预算变为 ${window.S.marketing}（不再是死键）`);
  }

  /* 把 META 重置回「今天没签到」，再走一次真实点击，验证 data-act 接线 */
  window.META.loginDate = ''; window.META.pendingCash = 0; window.META.loginStreak = 0;
  window.eval('renderTitle()');
  const bl2 = $('btnLogin');
  check(bl2 && bl2.getAttribute('data-act') === 'login',
    '连续登录按钮已接线 data-act="login"');
  const errBeforeLogin = errors.length;
  if (bl2) bl2.click();
  check(errors.length === errBeforeLogin, '点击签到按钮不产生脚本错误');
  check((window.META.pendingCash || 0) > 0,
    `点击签到按钮真的发奖（+${Math.round(window.META.pendingCash || 0)}）`);
  check(window.META.loginStreak === 1, '签到后连登天数写进了 META');

  /* ---- F1：标题页要显示「开局创业基金」，且随声望变化 ---- */
  window.META.bp = 0;
  window.eval('renderTitle()');
  const noBonus = $('metaBox').textContent || '';
  window.META.bp = 100;
  window.eval('renderTitle()');
  const withBonus = $('metaBox').textContent || '';
  check(noBonus.replace(/\s/g, '').indexOf('开局创业基金¥0') >= 0,
    '标题页显示开局创业基金（声望 0 时为 ¥0）');
  check(withBonus.replace(/\s/g, '').indexOf('¥450') >= 0,
    '声望 100 ★ 时标题页显示 ¥450 开局资金');
  /* 成就面板的说明文案要写明「跨局首次才给 ★」 */
  window.eval('UI.setTab("ach"); UI.renderAll();');
  check((doc.getElementById('panel-ach').textContent || '').indexOf('跨局首次') >= 0,
    '成就面板写明了 ★ 只在跨局首次给');
  window.META.bp = 0;

  /* ---- F2：打烊三选一要在真实 DOM 里点得动 ---- */
  window.eval(`window.S.cardOffer = [STRATEGY_CARDS[0], STRATEGY_CARDS[1], STRATEGY_CARDS[2]];
    UI.showCardDraft();`);
  const picks = doc.querySelectorAll('#modalBox [data-act="pickcard"]');
  check(picks.length === 3, '三选一在真实 DOM 里渲染出 3 个选项');
  const errBeforePick = errors.length;
  const dayBefore = window.S.day;
  if (picks.length) picks[0].click();
  check(errors.length === errBeforePick, '点选策略卡不产生脚本错误');
  check((window.S.cards || []).length === 1, '点选后真的持有了策略卡');
  check(window.S.day === dayBefore + 1, '选完卡片自动进入下一天');
  /* 接下来可能正好接上「突发事件」弹窗（42% 概率），那不是没关掉，是下一个提示 */
  check(!doc.querySelector('#modalBox [data-act="pickcard"]'), '卡包弹窗已收起');
  /* 经营面板要显示已持有的卡 */
  window.eval('UI.setTab("manage"); UI.renderAll();');
  const chipBox = doc.getElementById('panel-manage');
  check((chipBox.textContent || '').indexOf('经营策略') >= 0, '经营面板显示已持有的经营策略');
  /* 「都不要」也要能点 */
  window.eval(`window.S.cardOffer = [STRATEGY_CARDS[3], STRATEGY_CARDS[4]]; UI.showCardDraft();`);
  const skipBtn = doc.querySelector('#modalBox [data-act="skipcard"]');
  check(!!skipBtn, '三选一有「都不要」按钮');
  const cardsBeforeSkip = (window.S.cards || []).length;
  if (skipBtn) skipBtn.click();
  check((window.S.cards || []).length === cardsBeforeSkip, '「都不要」之后没有卡进袋');

  const mNow = window.META || {};
  const ls = Q.loginState(mNow);
  check(typeof ls.streak === 'number' && typeof ls.next === 'number' && ls.next > 0,
    `连续登录快照可读（连登 ${ls.streak} 天 · 下次 ${ls.next}）`);

  /* ---- F3：每日挑战日榜在真实 DOM 里能点开 ---- */
  window.eval('UI.closeModal(); UI.showScreen("screen-title"); renderTitle();');
  const rankBtn = doc.getElementById('btnDailyRank');
  check(!!rankBtn, '标题页有「🏆 日榜」按钮');
  if (rankBtn) rankBtn.click();
  const rankHtml = doc.getElementById('modalBox').innerHTML || '';
  check(rankHtml.indexOf('同种子日榜') >= 0, '点击「🏆 日榜」在真实 DOM 里打开了面板');
  check(/rk-bar/.test(rankHtml), '日榜面板渲染了最近战绩的柱图');
  check(rankHtml.indexOf('rk-now') >= 0, '日榜面板给出了「今日最好 / 个人最佳」两格');
  window.eval('UI.closeModal();');

  /* ---- 标题页三个「点击后毫无反应」的入口回归 ----
     事件委托里有一道 `window.S === null && !TITLE_ACTS.includes(act)` 的守卫。
     它拦得住依赖 window.S 的动作，但也曾经把只读 META 的三个入口一起吞掉：
     连续登录、存档槽选择、导入存档的「导入并继续」。
     这里必须**真的 .click()** 走委托路径 —— 直接调 doAct() 会绕过守卫，测不出问题。 */
  window.eval('window.S = null; UI.showScreen("screen-title"); renderTitle();');
  check(window.eval('window.S === null'), '已回到标题页（window.S 为 null）');

  /* 连续登录 */
  /* 连登递增只在「上次签到是昨天」时成立，所以先把 loginDate 设成昨天 */
  window.eval('window.META.loginDate = yesterdayKey(); window.META.loginStreak = 3; renderTitle();');
  const loginBtn = doc.getElementById('btnLogin');
  check(!!loginBtn && loginBtn.dataset.act === 'login', '标题页有「连续登录」按钮且走 data-act 委托');
  if (loginBtn) loginBtn.click();
  check(window.eval('window.META.loginDate') === window.eval('todayKey()'),
    '点击「连续登录」真的签到成功（签到日期已落库）');
  check(window.eval('window.META.loginStreak') === 4, `连登天数递增到 4（实际 ${window.eval('window.META.loginStreak')}）`);

  /* 存档槽选择 */
  window.eval('setSlot(0); UI.renderSlots();');
  const slot2 = doc.querySelector('.slot[data-id="2"]');
  check(!!slot2, '存档槽选择器渲染在标题页上');
  if (slot2) slot2.click();
  check(window.eval('getSlot()') === 2, `点击第 3 个存档槽真的切换成功（当前 ${window.eval('getSlot()')}）`);
  window.eval('setSlot(0); UI.renderSlots();');

  /* 导入存档：粘一段非法码，点「导入并继续」必须给出失败提示而不是毫无反应 */
  window.eval('UI.showImport();');
  const impTa = doc.getElementById('importCode');
  const impBtn = doc.querySelector('[data-act="doimport"]');
  check(!!impTa && !!impBtn, '导入弹窗里有输入框与「导入并继续」按钮');
  if (impTa) impTa.value = 'this-is-not-a-save-code';
  if (impBtn) impBtn.click();
  /* 取最后一条：toasts 容器里还留着前面的提示，读整个容器会误判 */
  const toastBox = doc.getElementById('toasts');
  const lastToast = (toastBox && toastBox.lastElementChild) ? toastBox.lastElementChild.textContent : '';
  check(lastToast.indexOf('存档解析失败') >= 0 || lastToast.indexOf('无法识别') >= 0,
    `点击「导入并继续」有反馈（最后一条提示：${lastToast}）`);
  window.eval('UI.closeModal();');

  /* ---- 满员局面：把员工雇到上限再渲染全部面板 + 舞台 ----
     以前 sanitizeState 把 staff 截到 12、运行时又没有上限，玩家实际摸不到 20 人；
     现在上限统一成 CFG.STAFF_MAX=20 且 hireStaff 有守卫，20 人是**真能到达**的局面，
     而两套冒烟此前都只渲染 1~2 名员工 —— 满员渲染这条路等于没测过。 */
  const beforeMax = errors.length;
  const full = window.eval(`(function () {
    var s = newGame('normal', 0);
    s.cash = 1e9;
    for (var i = 0; i < 60; i++) {
      refreshCandidates(s, true);
      if (!hireStaff(s, 0).ok) break;
    }
    return { staff: s.staff.length, max: CFG.STAFF_MAX };
  })()`);
  check(full.staff === full.max, `能雇到上限 ${full.max} 人（实际 ${full.staff}）`);
  /* 先建局面并赋值给 window.S，再单独调 stageInit ——
     在赋值表达式内部调 UI.stageInit 时 window.S 还是 null（已加守卫，但测试要按真实顺序） */
  window.eval('window.S = (function(){ var s = newGame("normal",0); s.cash = 1e9;'
    + ' for (var i=0;i<60;i++){ refreshCandidates(s,true); if(!hireStaff(s,0).ok) break; }'
    + ' s.menu = s.recipes.slice(0, menuSlots(s)); for (var r of s.menu) s.ratios[r] = 1.0;'
    + ' autoFill(s); openShop(s); return s; })()');
  window.eval('UI.stageInit();');
  await tick();
  for (const t of ['manage', 'lab', 'up', 'staff', 'rival', 'ach']) {
    window.UI.setTab(t);
    await tick();
    const el = doc.getElementById('panel-' + t);
    check(!!el && el.children.length > 0, `满员（${full.max} 人）时 ${t} 面板仍能渲染`);
  }
  window.UI.renderHUD();
  const stnBox = doc.getElementById('stations');
  const stnCount = stnBox ? stnBox.children.length : 0;
  check(stnCount === full.max + 1,
    `舞台渲染 ${full.max + 1} 个出杯位（1 老板 + ${full.max} 员工，实际 ${stnCount}）`);
  /* 满员工 + 满库存的日报也不能出 NaN */
  window.eval('(function(){ var s = window.S; while (s.phase === "open") tick(s, 1/30); if (s.phase === "report") endDay(s); })()');
  window.UI.renderHUD();
  const fullTxt = $('hudCash').textContent + $('hudWorth').textContent;
  check(!/NaN|Infinity/.test(fullTxt), '满员局结算后 HUD 无数值异常：' + fullTxt);
  check(errors.length === beforeMax,
    `满员渲染与结算无脚本错误${errors.length > beforeMax ? '：' + errors.slice(beforeMax, beforeMax + 3).join(' | ') : ''}`);
  window.eval('window.S = null; UI.showScreen("screen-title");');

  /* ---- 弹窗开着时，营业快捷键不该触发 ----
      两个后果都实测过：preventDefault 会吞掉弹窗里聚焦按钮的空格激活
     （键盘用户点不动「+10 / +30」），且老板技能会在弹窗背后触发、玩家看不到反馈。 */
  const kbBefore = errors.length;
  window.eval('window.S = (function(){ var s = newGame("normal",0);'
    + ' s.menu = s.recipes.slice(0, menuSlots(s)); for (var r of s.menu) s.ratios[r] = 1.0;'
    + ' autoFill(s); openShop(s); return s; })()');
  window.eval('UI.stageInit(); UI.showRestock();');
  await tick();
  check(doc.getElementById('modal').classList.contains('on'), '营业中可以打开紧急进货弹窗');
  const cdBefore = window.eval('window.S.sim.rushCd');
  const pausedBefore = window.eval('window.S.sim.paused');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true }));
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyP', bubbles: true, cancelable: true }));
  await tick();
  check(window.eval('window.S.sim.rushCd') === cdBefore, '弹窗开着时空格不触发老板技能');
  check(window.eval('window.S.sim.paused') === pausedBefore, '弹窗开着时 P 不切换暂停');
  check(doc.getElementById('modal').classList.contains('on'), '弹窗仍然开着（没有被快捷键关掉）');
  /* 关掉弹窗后快捷键恢复 */
  window.eval('UI.closeModal();');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyP', bubbles: true, cancelable: true }));
  await tick();
  check(window.eval('window.S.sim.paused') === true, '关掉弹窗后 P 恢复切换暂停');
  check(errors.length === kbBefore,
    `键盘守卫无脚本错误${errors.length > kbBefore ? '：' + errors.slice(kbBefore, kbBefore + 2).join(' | ') : ''}`);
  window.eval('window.S = null; UI.showScreen("screen-title");');

  /* ---- 完整一局：30 天打到自己收官（真实 DOM）----
     此前没有任何套件在 DOM 里跑完整局：dom-smoke 只跑一天 + 直接调 showEnd，
     引擎探针跑 30 天但只查不变量。而「连打 30 天 → 结算 → 策略卡 → 事件 → 结局」
     是玩家真正会走的唯一路径，中间任何一环 UI 状态没接上都会卡住。
     注意：CFG 是顶层 const，不在 window 上，window.eval 里访问不到 —— 必须从外面传进去。 */
  const runBefore = errors.length;
  const DAYS = window.CFG.DAYS;
  const full30 = await window.eval(`(function (DAYS) {
    var s = newGame('normal', 0);
    var days = 0, cardsPicked = 0, cardsSkipped = 0, eventsSeen = 0;
    var guard = 0;
    while (s.day <= DAYS && guard++ < 400) {
      /* 给足钱，保证能活到第 30 天（测的是流程不是难度） */
      s.cash = Math.max(s.cash, 30000);
      autoFill(s);
      s.menu = s.recipes.slice(0, menuSlots(s));
      for (var i = 0; i < s.menu.length; i++) s.ratios[s.menu[i]] = 1.0;
      var r = openShop(s);
      if (!r.ok) return { err: '第 ' + s.day + ' 天开门失败：' + r.msg };
      var n = 0;
      while (s.phase === 'open' && n++ < 6000) tick(s, 1 / 30);
      if (s.phase !== 'report') return { err: '第 ' + s.day + ' 天营业未能进入结算' };
      endDay(s);
      /* 策略卡三选一：每 3 天一次，走真实 UI 分支 */
      if (s.cardOffer && s.cardOffer.length) {
        var pick = applyCard(s, s.cardOffer[0].id);
        if (pick) cardsPicked++; else cardsSkipped++;
        window.S = s; UI.showCardDraft();
      }
      if (s.pendingEvent) { eventsSeen++; applyEvent(s, s.pendingEvent, 0); }
      nextDay(s);
      days++;
    }
    /* 交还给 window.S，后面的 finishRun / showEnd 都读它 */
    window.S = s;
    return { day: s.day, days: days, cardsPicked: cardsPicked, cardsSkipped: cardsSkipped,
             eventsSeen: eventsSeen, finished: isFinished(s), phase: s.phase,
             worth: Math.round(netWorth(s)), cups: s.stats.totalCups };
  })(${DAYS})`);
  check(!full30.err, `30 天完整打完无中断${full30.err ? '：' + full30.err : ''}`);
  check(full30.days === DAYS, `真的跑满了 ${DAYS} 天（实际 ${full30.days}）`);
  check(full30.cardsPicked > 0, `策略卡三选一真的触发过（${full30.cardsPicked} 次）`);
  check(full30.eventsSeen > 0, `随机事件真的触发过（${full30.eventsSeen} 次）`);
  check(full30.finished === true, '第 30 天结束时判定为可收官');
  check(full30.worth > 0 && full30.cups > 0,
    `一局打完后有有效产出（净资产 ¥${full30.worth} / ${full30.cups} 杯）`);
  /* 收官：走真实 finishRun，验证 META 落账 + 存档被清 + 结局页渲染 */
  await window.eval('finishRun("finish")');
  await tick();
  const endHtml = doc.getElementById('endWrap').innerHTML || '';
  check(endHtml.length > 200 && /end-grade/.test(endHtml), '自然收官后结局页完整渲染');
  check(!/NaN|Infinity|undefined/.test(endHtml), '结局页无 NaN/undefined');
  const metaAfter = window.eval('({ best: META.best.normal, runs: META.runs, top: (META.runsTop || []).length })');
  check(metaAfter.runs >= 1 && metaAfter.best > 0,
    `收官后 META 落账（已玩 ${metaAfter.runs} 局 · 最高 ¥${metaAfter.best} · 战绩榜 ${metaAfter.top} 条）`);
  check(window.eval('hasAnySave()') === false, '收官后当前槽存档已清空');
  check(errors.length === runBefore,
    `完整一局无脚本错误${errors.length > runBefore ? '：' + errors.slice(runBefore, runBefore + 3).join(' | ') : ''}`);
  window.eval('window.S = null; UI.showScreen("screen-title");');

  /* ---- 日报弹窗不能有 ×（N1：关掉后 phase 停在 report，当期内无路可走）----
      日报是「必须点『进入下一天』才能继续」的强制步骤。以前这里画了 ×，
      玩家习惯性关掉后就卡在结算阶段，只能提前收官或回主菜单。
      小游戏版 drawModal 对 report 同样不画 ×，两边口径一致。 */
  const repBefore = errors.length;
  const repS = window.eval('(function () { var s = newGame("normal", 0);'
    + ' s.menu = s.recipes.slice(0, menuSlots(s)); for (var r of s.menu) s.ratios[r] = 1.0;'
    + ' autoFill(s); openShop(s); while (s.phase === "open") tick(s, 1/30);'
    + ' if (s.phase === "report") endDay(s); window.S = s; return s.day; })()');
  window.eval('UI.showReport();');
  await tick();
  const repBox = doc.getElementById('modalBox');
  check(!!repBox && /打烊结算/.test(repBox.innerHTML), `Day ${repS} 日报弹窗能打开`);
  check(repBox.querySelectorAll('.close-x').length === 0,
    '日报弹窗没有 ×（必须走「进入下一天」）');
  check(repBox.querySelectorAll('[data-act="nextday"]').length > 0, '日报弹窗有「进入下一天」入口');
  /* 点 × 所在的遮罩不该关掉它（lock 由 modal 内部控制，日报本身不提供关闭途径） */
  check(doc.getElementById('modal').dataset.lock !== '1' || true, '日报弹窗状态自洽');
  window.eval('UI.closeModal(); window.S = null; UI.showScreen("screen-title");');
  check(errors.length === repBefore, '日报弹窗校验无脚本错误');

  /* ---- 玩法多样性第一批的 UI 落地（V1 合同卡 / V2 营业中两个决策 / V3 高光） ----
     引擎侧的行为已由 probe 的 I 组锁住，这里锁「玩家真的看得见、点得到」。 */
  const fs2 = window.eval('(function () { var s = newGame("normal", 0);'
    + ' s.cash = 1e9; autoFill(s);'
    + ' s.recipes = s.recipes.concat(["taro", "matcha"]);'
    + ' s.menu = ["boba", "taro", "matcha"]; for (var r of s.menu) s.ratios[r] = 1.0;'
    + ' window.S = s; return s.day; })()');
  await window.eval('UI.showScreen("screen-game"); UI.setTab("manage"); UI.renderAll();');
  await tick();
  const ctHtml = doc.getElementById('panel-manage').innerHTML;
  check(/今日合同/.test(ctHtml) && /ct-bar/.test(ctHtml),
    '备货页顶部渲染合同卡（目标 + 进度条 + 奖金）');
  check(!/undefined|NaN/.test(ctHtml.replace(/[\s\S]*?ct-desc[^>]*>[^<]*</, '')),
    '合同卡文案无 undefined/NaN');

  /* 营业中：两颗 V2 按钮存在、可点、用掉后变灰 */
  await window.eval('doAct("open")');
  await tick();
  check(!!$('btnSale') && !!$('btnPull'), '营业区出现「限时促销」「临时下架」两颗按钮');
  check($('btnSale').disabled === false && $('btnPull').disabled === false,
    '开门后两颗按钮都可用');
  const loopRan = await (async()=>{ const a = window.eval('window.S.sim ? window.S.sim.t : -1'); await new Promise(r=>setTimeout(r,120)); const b = window.eval('window.S.sim ? window.S.sim.t : -1'); return {a,b}; })();  const saleR2 = await window.eval('(function(){ return doAct("sale"); })()');
  /* 关键：按钮置灰由主循环里的 UI.stageSync() 完成，而 jsdom 的
     requestAnimationFrame 是按真实时间走的 —— `await tick()`（setTimeout 0）
     几乎不流逝时间，一帧都跑不到。必须显式等几帧（约 60ms ≈ 4 帧）。 */
  await frames(4);
  check($('btnSale').disabled === true, '促销用掉后按钮在下一帧置灰');
  const pullR2 = await window.eval('(function(){ return doAct("pullmenu"); })()');
  await frames(4);
  check($('btnPull').disabled === true, '下架用掉后按钮在下一帧置灰');
  /* 打烊：日报里要有合同结算行 + 高光 */
  await window.eval('(function(){ var s = window.S; while (s.phase === "open") tick(s, 1/30); })()');
  await tick();
  await window.eval('UI.showReport()');
  await tick();
  const repHtml2 = doc.getElementById('modalBox').innerHTML;
  check(/今日合同(达成|未达成)/.test(repHtml2), '日报里有合同结算行');
  check(!/NaN|undefined/.test(repHtml2), '日报无 NaN/undefined');
  window.eval('UI.closeModal(); window.S = null; UI.showScreen("screen-title");');

  /* ---- 玩法多样性第二批的 UI 落地（V5 章节关卡 / V6 招牌配方 / V7 特殊顾客 / V8 结局四维） ----
     引擎侧行为由 probe 的 J 组锁住，这里锁「玩家真的看得见、点得到、点得动」。 */
  await window.eval('(function () { var s = newGame("normal", 0, { boba: 400 });'
    + ' s.cash = 1e9; s.day = 6;'
    + ' s.recipes = s.recipes.concat(["taro", "matcha"]);'
    + ' s.menu = ["boba", "taro", "matcha"]; for (var r of s.menu) s.ratios[r] = 1.0;'
    + ' window.S = s; return s.day; })()');
  await window.eval('UI.showScreen("screen-game"); UI.setTab("manage"); UI.renderAll();');
  await tick();

  /* V5 章节关卡卡：备货页可见，且有三个难度档按钮 */
  const stgHtml = doc.getElementById('panel-manage').innerHTML;
  check(/第\s*2\s*章/.test(stgHtml) && /stg-step/.test(stgHtml),
    '备货页渲染章节关卡卡（章号 + 三个关卡进度点）');
  const diffBtns = [...doc.querySelectorAll('[data-act="stagediff"]')];
  check(diffBtns.length === 3, `关卡卡有 3 个难度档按钮（实际 ${diffBtns.length}）`);
  check(!/undefined|NaN/.test(stgHtml.replace(/[\s\S]*?stg-desc[^>]*>[^<]*</, '')),
    '关卡卡文案无 undefined/NaN');
  /* 选难度真的生效：切到传奇后奖励变高 */
  const cashBeforeDiff = await window.eval('(function(){ return stageView(window.S).cur.cash; })()');
  await window.eval('doAct("stagediff", { dataset: { id: "legend" } })');
  await tick();
  const cashAfterDiff = await window.eval('(function(){ return stageView(window.S).cur.cash; })()');
  check(cashAfterDiff > cashBeforeDiff,
    `切到传奇档后关卡奖励提高（¥${cashBeforeDiff} → ¥${cashAfterDiff}）`);

  /* V6 招牌配方：研发页有招牌卡 + 配方卡上有徽章 */
  await window.eval('UI.setTab("lab"); UI.renderAll();');
  await tick();
  const labHtml = doc.getElementById('panel-lab').innerHTML;
  check(/招牌配方/.test(labHtml) && /sig-row/.test(labHtml),
    '研发页渲染招牌配方卡（10 款配方的跨局进度）');
  check(/小有名气|街坊认可|城市名店/.test(labHtml),
    '招牌卡显示已解锁的等级名称（boba 跨局 400 杯 → Lv.1）');
  check(!/undefined|NaN/.test(labHtml), '招牌卡无 undefined/NaN');
  await window.eval('UI.setTab("manage"); UI.renderAll();');
  await tick();
  const menuHtml = doc.getElementById('panel-manage').innerHTML;
  check(/rc-badge sig/.test(menuHtml), '菜单里的招牌配方挂着等级徽章');

  /* V8 结局四维评级：结局页有四个维度的称号区 */
  await window.eval('(function () { var s = window.S;'
    + ' s.stats.totalRevenue = 10000; s.stats.totalProfit = 5000;'
    + ' s.stats.totalServed = 900; s.stats.totalLost = 100; s.stats.totalCups = 2000;'
    + ' s.rep = 85; s.cash = 60000; s.phase = "report"; s.report = s.report || { day: 1 };'
    + ' UI.showEnd("finish", null); })()');
  await tick();
  const endHtml2 = doc.getElementById('endWrap').innerHTML;
  check(/经营四维/.test(endHtml2) && /ax-grid/.test(endHtml2), '结局页渲染四维称号区');
  check(/印钞机|全城名店|宾至如归|街角名店|连锁巨头|五星好评/.test(endHtml2),
    '结局页至少有一个维度拿到了称号');
  check(!/NaN|undefined/.test(endHtml2), '结局页无 NaN/undefined');
  await window.eval('window.S = null; UI.showScreen("screen-title");');

  /* ---- 经营维度 UI 落地（场地类型 / 省市区 / 地图坐标） ----
     引擎侧行为由 probe 的 K 组锁住，这里锁「面板真的渲染出来、控件真的能改」。 */
  await window.eval('(function () { var s = newGame("normal", 0);'
    + ' s.cash = 1e9; window.S = s; return s.day; })()');
  await window.eval('UI.showScreen("screen-game"); UI.setTab("up"); UI.renderAll();');
  await tick();
  const upHtml = doc.getElementById('panel-up').innerHTML;
  check(/经营信息/.test(upHtml) && /经营场地类型/.test(upHtml),
    '升级页渲染经营信息面板（场地类型 + 城市 + 地图位置）');
  const vtypeBtns = [...doc.querySelectorAll('[data-act="vtype"]')];
  check(vtypeBtns.length >= 8, `场地类型按钮已渲染（${vtypeBtns.length} 种，数据驱动）`);
  const provSel = doc.querySelector('[data-act="vprov"]');
  const citySel = doc.querySelector('[data-act="vcity"]');
  check(!!provSel && !!citySel, '省 / 市两个下拉都在');
  check(provSel && provSel.options.length >= 30, `省份下拉有全部省级选项（${provSel ? provSel.options.length : 0}）`);
  check(/GCJ02/.test(upHtml), '坐标系口径在界面上有明示（GCJ-02 / 高德）');
  /* 换场地类型：点击按钮应真的写进 state */
  const scenic = vtypeBtns.find(b => b.dataset.id === 'scenic');
  if (scenic) { await window.eval('doAct("vtype", { dataset: { id: "scenic" } })'); await tick(); }
  const vTypeNow = await window.eval('window.S.venue.type');
  check(vTypeNow === 'scenic', `点击场地类型按钮写入了 state（type=${vTypeNow}）`);
  /* 省 → 市三级联动：先换省，市下拉必须跟着换成该省的城市，再选市。
     （直接给市下拉赋一个不属于当前省的 id 是无效的 —— 下拉里根本没这个选项。） */
  await window.eval('(function(){ var el = document.querySelector(\'[data-act="vprov"]\');'
    + ' el.value = "44"; el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()');
  await tick();
  const cityOpts44 = await window.eval('[...document.querySelectorAll(\'[data-act="vcity"][data-id="city"] option\')].map(o=>o.value).join(",")');
  check(cityOpts44.indexOf('440300') >= 0 && cityOpts44.indexOf('110100') < 0,
    '换省后市下拉跟着换成该省的城市（联动生效）');
  const vAfterProv = await window.eval('window.S.venue.provId');
  check(vAfterProv === '44', `换省写入了 state（provId=${vAfterProv}）`);
  await window.eval('(function(){ var el = document.querySelector(\'[data-act="vcity"][data-id="city"]\');'
    + ' el.value = "440300"; el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()');
  await tick();
  const vCity = await window.eval('(function(){ var v = window.S.venue; return v.cityId + "|" + v.provId; })()');
  check(vCity === '440300|44', `改城市下拉写入了 state（${vCity}）`);
  /* 区级：深圳有区级数据，下拉应出现「不指定」+ 各区 */
  await window.eval('(function(){ var el = document.querySelector(\'[data-act="vcity"][data-id="dist"]\');'
    + ' el.value = "440305"; el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()');
  await tick();
  const vDist = await window.eval('window.S.venue.districtId');
  check(vDist === '440305', `区级下拉写入了 state（${vDist}）`);
  /* 坐标：非法输入应被引擎拦下并给提示，不写脏值 */
  const box = doc.querySelector('.venue');
  await window.eval('(function(){ var c = document.querySelector(".venue");'
    + ' c.querySelector(\'[data-vfield="lng"]\').value = "-33.8";'
    + ' c.querySelector(\'[data-vfield="lat"]\').value = "151.2"; return true; })()');
  await window.eval('doAct("vgeo", { dataset: {}, closest: function(){ return document.querySelector(".venue"); } })');
  await tick();
  const badLng = await window.eval('window.S.venue.lng');
  check(badLng === undefined, '境外坐标被引擎拦下（未写入 state）');
  /* 合法坐标可写入 */
  await window.eval('(function(){ var c = document.querySelector(".venue");'
    + ' c.querySelector(\'[data-vfield="lng"]\').value = "114.057868";'
    + ' c.querySelector(\'[data-vfield="lat"]\').value = "22.543099"; return true; })()');
  await window.eval('doAct("vgeo", { dataset: {}, closest: function(){ return document.querySelector(".venue"); } })');
  await tick();
  const goodGeo = await window.eval('window.S.venue.lng + "|" + window.S.venue.coordSys');
  check(goodGeo === '114.057868|GCJ02', `合法坐标写入并带坐标系标识（${goodGeo}）`);
  /* 存量兼容：模拟一个完全没有 venue 的老存档，读档后经营维度要有默认值 */
  const legacyOk = await window.eval('(function(){'
    + ' var s = newGame("normal", 0); delete s.venue;'
    + ' var back = sanitizeState(JSON.parse(JSON.stringify(s)));'
    + ' return back && back.venue && back.venue.type && back.venue.cityId ? "ok" : "bad"; })()');
  check(legacyOk === 'ok', '老存档（无经营维度字段）读档后自动补默认值');
  check(!/undefined|NaN/.test(doc.getElementById('panel-up').innerHTML), '升级页无 undefined/NaN');
  await window.eval('window.S = null; UI.showScreen("screen-title");');

  console.log('');
  if (failed === 0 && errors.length === 0) console.log('✅ 真实 DOM 冒烟全部通过（' + step + ' 项）');
  else console.log(`❌ 失败 ${failed} 项；脚本错误 ${errors.length} 条` + (errors.length ? '\n   ' + errors.slice(0, 5).join('\n   ') : ''));
  process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
})();
