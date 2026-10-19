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

let step = 0, failed = 0;
function ok(msg) { console.log(`  ✔ ${++step}. ${msg}`); }
function bad(msg) { failed++; console.log(`  ✘ ${++step}. ${msg}`); }
function check(cond, msg) { cond ? ok(msg) : bad(msg); }

/* 等待一帧 */
const tick = () => new Promise(r => setTimeout(r, 0));

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

  const mNow = window.META || {};
  const ls = Q.loginState(mNow);
  check(typeof ls.streak === 'number' && typeof ls.next === 'number' && ls.next > 0,
    `连续登录快照可读（连登 ${ls.streak} 天 · 下次 ${ls.next}）`);

  console.log('');
  if (failed === 0 && errors.length === 0) console.log('✅ 真实 DOM 冒烟全部通过（' + step + ' 项）');
  else console.log(`❌ 失败 ${failed} 项；脚本错误 ${errors.length} 条` + (errors.length ? '\n   ' + errors.slice(0, 5).join('\n   ') : ''));
  process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
})();
