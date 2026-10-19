/* ============================================================
 *  小游戏冒烟测试
 *
 *  直接模拟抖音小游戏的宿主环境：有 tt、没有 document / window / localStorage。
 *  与 H5 的 jsdom 测试互补 —— 这里验证的是「无 DOM 时能不能跑通」，
 *  交互全部走「触摸坐标 → 命中检测 → 行为分发」这条路。
 *
 *  所以命中检测是重点测试对象：canvas 界面没有 DOM 兜底，
 *  命中矩形算错就是点了没反应，而这类错误在真机上极难发现。
 * ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');

let step = 0, failed = 0;
function ok(m) { console.log(`  ✔ ${++step}. ${m}`); }
function bad(m) { failed++; console.log(`  ✘ ${++step}. ${m}`); }
function check(c, m) { c ? ok(m) : bad(m); }

/* 假 2D 上下文：让绘制代码走真实分支 */
function fakeCtx() {
  return new Proxy({}, {
    get(t, p) {
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() { } });
      if (p === 'measureText') return (s) => ({ width: String(s).length * 6.5 });
      return () => { };
    },
    set() { return true; },
  });
}

/* bundle 是构建产物，源码改了必须先重打。
   忘记打包时自己补一步，别让使用者拿到一个莫名其妙的 ENOENT。 */
const BUNDLE_PATH = path.join(root, 'minigame', 'bundle.js');
if (!fs.existsSync(BUNDLE_PATH)) {
  console.log('  · 未找到 minigame/bundle.js，先自动打包…');
  require('child_process').execFileSync(process.execPath,
    [path.join(root, 'tools', 'build-minigame.js')], { stdio: 'inherit' });
}
const BUNDLE = fs.readFileSync(BUNDLE_PATH, 'utf8');

/**
 * 起一个独立的小游戏运行环境。
 * 刻意不提供 document / window / localStorage ——
 * 一旦业务代码里漏出半个 DOM 引用，这里就会直接炸出来。
 */
function makeEnv(screenW, screenH, sysOverride, extraTT) {
  const store = {};
  const raf = [];
  const touch = { start: null, move: null, end: null, cancel: null };
  const fakeCanvas = { width: 0, height: 0, getContext: () => fakeCtx(), addEventListener() { } };
  let showCb = null;

  const sys = Object.assign(
    { windowWidth: screenW, windowHeight: screenH, pixelRatio: 2 },
    sysOverride || {});
  const tt = Object.assign({
    getSystemInfoSync: () => sys,
    createCanvas: () => fakeCanvas,
    onTouchStart: fn => { touch.start = fn; },
    onTouchMove: fn => { touch.move = fn; },
    onTouchEnd: fn => { touch.end = fn; },
    onTouchCancel: fn => { touch.cancel = fn; },
    getStorageSync: k => (k in store ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = String(v); },
    removeStorageSync: k => { delete store[k]; },
    getClipboardData: o => { if (o && o.success) o.success({ data: '' }); },
    setClipboardData: () => { },
    /* 侧边栏复访靠它拿最新启动参数，基础环境也提供，方便测试注入 */
    onShow: fn => { showCb = fn; },
  }, extraTT || {});

  const ctx = {
    console, Math, JSON, Date, Object, Array, String, Number, Boolean, Error, Set, Map,
    isNaN, parseInt, parseFloat, setTimeout, clearTimeout,
    TextEncoder, TextDecoder,
    btoa: s => Buffer.from(String(s), 'binary').toString('base64'),
    atob: s => Buffer.from(String(s), 'base64').toString('binary'),
    requestAnimationFrame(fn) { raf.push(fn); return raf.length; },
    tt: tt,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  let loadErr = null;
  try { vm.runInContext(BUNDLE, ctx, { filename: 'bundle.js' }); }
  catch (e) { loadErr = e.message; }

  /* bundle 是 CommonJS 模块作用域：顶层 const / 函数声明都不在 ctx 对象上，
     但同一 context 的全局词法环境是共享的，所以要在「上下文里求值」才拿得到。
     这与浏览器经典脚本的顶层 const 是两套机制，容易踩坑。 */
  const inCtx = expr => vm.runInContext(expr, ctx);
  const MG = ctx.__MINIGAME, G = ctx.GFX, V = ctx.VIEW;
  const frameHits = [];
  let frameErr = null;

  function frames(n) {
    for (let i = 0; i < n; i++) {
      /* 必须拷贝：直接拿引用再清空，队列和待跑的那一批会一起被清空 */
      const q = raf.slice(); raf.length = 0;
      for (const fn of q) {
        try { fn(Date.now() + i * 16); } catch (e) { if (!frameErr) frameErr = e.message; }
      }
      frameHits.push(G.hits.length);
    }
  }
  function findHit(act, id) {
    for (const h of (G.hits || [])) {
      if (h.act === act && (id === undefined || h.id === id)) return h;
    }
    return null;
  }
  /* 触摸三件套：命名与语义必须一一对应。
     曾经把「拖拽」写成了一个内部做「按下+抬起」的 tapAt，
     结果手势序列变成了 down → down+up → up，滚动自然永远不生效。 */
  function touchStart(x, y) { touch.start({ touches: [{ clientX: x, clientY: y }] }); }
  function touchDrag(x, y) { touch.move({ touches: [{ clientX: x, clientY: y }] }); }
  function touchEnd(x, y) { touch.end({ changedTouches: [{ clientX: x, clientY: y }] }); }
  /** 在某个按钮的几何中心点一下 */
  function tapAt(x, y) { touchStart(x, y); touchEnd(x, y); frames(1); }
  /** 走真实触摸链路点某个行为按钮 */
  function tap(act, id) {
    const h = findHit(act, id);
    if (!h) return false;
    tapAt(h.x + h.w / 2, h.y + h.h / 2);
    return true;
  }

  return {
    ctx, MG, G, V, store, touch, frames, findHit, tap,
    touchStart, touchDrag, touchEnd, tapAt,
    inCtx,
    /** 模拟宿主回调 onShow（用来造「从侧边栏回来」的场景） */
    show: op => { if (showCb) showCb(op || {}); },
    get frameErr() { return frameErr; },
    get frameHits() { return frameHits; },
    get loadErr() { return loadErr; },
  };
}

/* ---------- 主环境：390×844 ---------- */
const env = makeEnv(390, 844);
const { ctx, MG, G, V, store, touchHandlers, frames, tap, findHit, inCtx } = Object.assign(
  { touchHandlers: env.touch }, env);

let loadErr = env.loadErr;
check(!loadErr, `bundle 在无 DOM 环境加载并自动启动${loadErr ? '：' + loadErr : ''}`);
if (loadErr) { console.log('\n❌ 无法继续'); process.exit(1); }

frames(3);
check(!env.frameErr, `主循环绘制 3 帧无异常${env.frameErr ? '：' + env.frameErr : ''}`);
check(env.frameHits[0] > 0, `每帧都登记了命中区（首帧 ${env.frameHits[0]} 个）`);

/* 不做裁剪的话，滚动出屏的按钮也会登记进来，数量会随内容无限增长 */
check(env.frameHits[0] === env.frameHits[1] && env.frameHits[1] === env.frameHits[2],
  `同名界面命中区数量稳定（${env.frameHits.slice(0, 3).join('/')}），没有累积泄漏`);

check(V.screen === 'title', '初始停在开始界面');
check(!!findHit('start'), '标题页「开始营业」有可点区域');
check(!!findHit('diff', 'hard'), '难度选项有可点区域');

/* 难度切换 → 开局 */
tap('diff', 'hard');
check(V.diff === 'hard', '点击难度卡片后选中项跟随变化');

tap('start');
frames(1);
check(V.screen === 'game', '点击「开始营业」进入游戏界面');
check(!!MG.S && MG.S.diff === 'hard', '开局难度与所选一致：' + (MG.S ? MG.S.diff : '无'));

/* 新手指引：首次开局自动弹起，且在结束前必须挡住其它操作
   （否则玩家在引导里乱点会把局面点坏） */
check(V.tut.on === true, '首次开局自动弹起新手引导');
const tutTab = V.tab;
tap('tab', 'lab');
check(V.tab === tutTab, '引导进行中会挡住背后的操作（不会误触）');
tap('tutskip');
frames(1);
check(V.tut.on === false, '点击「跳过引导」可退出引导');

/* 六个 Tab */
for (const t of ['lab', 'up', 'staff', 'rival', 'ach', 'manage']) {
  const h = findHit('tab', t);
  if (!h) { bad('Tab ' + t + ' 没有命中区'); break; }
  const cx = h.x + h.w / 2, cy = h.y + h.h / 2;
  touchHandlers.start({ touches: [{ clientX: cx, clientY: cy }] });
  touchHandlers.end({ changedTouches: [{ clientX: cx, clientY: cy }] });
  frames(1);
  if (V.tab !== t) { bad('切到 Tab ' + t + ' 失败（实际 ' + V.tab + '）'); break; }
}
if (process.env.MG_DEBUG) {
  console.log('    [debug] tab=' + V.tab + ' scroll=' + V.scroll[V.tab]
    + ' hits=' + G.hits.length + ' frameErr=' + frameErr
    + ' → ' + G.hits.map(h => h.act + (h.id ? ':' + h.id : '')).join(' '));
}
check(V.tab === 'manage', '六个 Tab 全部可切换并回到经营面板');

/* 采购真的会扣钱加库存 */
const cash0 = MG.S.cash, inv0 = MG.S.inv.tea;
check(!!findHit('buy', 'tea'), '采购「+10」有可点区域');
if (tap('buy', 'tea')) {
  check(MG.S.inv.tea === inv0 + 10 && MG.S.cash < cash0,
    `采购生效：茶叶 ${inv0} → ${MG.S.inv.tea}，现金 ${Math.round(cash0)} → ${Math.round(MG.S.cash)}`);
} else { bad('采购按钮点击未命中'); }

/* 出杯位命中必须在营业阶段才出现 */
const s = MG.S;
check(!findHit('rush', '0'), '未开门时不存在出杯位的命中区');
s.menu = s.recipes.slice(0, inCtx('menuSlots')(s));
for (const r of s.menu) s.ratios[r] = 1.0;
tap('open');
frames(1);
check(s.phase === 'open' && !!s.sim, '点击「开门营业」进入营业阶段');
check(!!findHit('rush', '0'), '开门后出杯位可点（核心手感：连点加速）');

/* 跑完整天 */
let guard = 0;
while (s.phase === 'open' && guard++ < 4000) {
  MG.step(1 / 30);
  if (s.sim && s.sim.stations[0]) MG.doAct('rush', '0');
}
check(s.phase === 'report', `一天营业跑完并进入结算（${guard} 帧）`);
check(s.sim.cups > 0, `当天确有出杯：${s.sim.cups} 杯`);

/* 结算 → 次日 */
frames(1);
check(V.modal && V.modal.type === 'report', '结算后自动弹出经营报表');
tap('nextday');
frames(1);
check(MG.S.day === 2, `进入 Day ${MG.S.day}`);

/* 存档必须落进 tt.setStorageSync，而不是 localStorage */
const saveKey = inCtx('CFG.SAVE_PREFIX') + '0';
const wrote = inCtx('saveGame')(MG.S);
check(wrote && !!store[saveKey], `存档确实落进 tt.setStorageSync（键 ${saveKey}）`
  + (wrote && !store[saveKey] ? ' · 写入「成功」但键不存在，说明用了内存后端' : ''));

const again = inCtx('loadGame')();
check(!!again && again.day === 2, `存档读回一致：Day ${again ? again.day : '—'}`);

/* 弹窗 */
MG.doAct('chart'); frames(1);
check(V.modal && V.modal.type === 'chart', '图标按钮可打开经营报表（独立的 chart 弹窗）');
/* 回归锁定：报表弹窗绝不能是 report —— 它底部固定带「进入 Day N」，
   备货阶段点一下就会跳过整天（不结算房租工资、不产生营收）。 */
check(!V.modal || !findHit('nextday'), '报表弹窗里没有「进入下一天」按钮（不会误跳天）');
tap('close'); frames(1);
/* 当天若触发了随机事件，关掉报表后事件弹窗会立刻接上（与 H5 版一致）。
   所以这里不能断言「没有任何弹窗」，而要看报表本身是否已关。 */
check(!V.modal || V.modal.type === 'event',
  '结算报表可关闭（关闭后若有随机事件自动接上）');
if (V.modal && V.modal.type === 'event') {
  check(!!findHit('eventopt', '0'), '随机事件弹窗给出了可选项');
  tap('eventopt', '0');
  frames(1);
}
check(!V.modal, '随机事件处理后弹窗清空');

MG.doAct('help'); frames(1);
check(V.modal && V.modal.type === 'help', '可打开玩法说明');
tap('close'); frames(1);
check(!V.modal, '玩法说明可关闭');

/* 拖拽结束不应被误判成点击 */
const modalBefore = V.modal;
touchHandlers.start({ touches: [{ clientX: 195, clientY: 400 }] });
touchHandlers.move({ touches: [{ clientX: 195, clientY: 250 }] });
touchHandlers.end({ changedTouches: [{ clientX: 195, clientY: 250 }] });
frames(1);
check(V.modal === modalBefore, '拖拽手势不会被误判为点击（不会误开弹窗）');

/* ------------------------------------------------------------
 *  小屏（360×640，最常见的安卓尺寸）：内容必然溢出，滚动才真正发生
 * ---------------------------------------------------------- */
const small = makeEnv(360, 640);
small.frames(2);
small.tap('start');
small.frames(1);
small.tap('tutskip');
small.frames(1);
check(small.V.tab === 'manage', '小屏开局默认停在经营面板');

/* 备货阶段的主操作「开门营业」现在是钉在底部的，不随面板滚动 ——
   面板加上任务卡 / 新闻 / 日志后已经高过一屏，主操作不能藏进滚动区。
   所以这里改为断言：未滚动时它在，滚动后它还在，且 y 不变。 */
check(!!small.findHit('open'),
  '小屏备货阶段「开门营业」钉在底部，未滚动即可点');

/* 裁剪是否真的生效：用面板里的「+10 采购」按钮替代 —— 它在滚动区里。 */
const tinyHit0 = small.findHit('buy', 'tea');
check(!!tinyHit0, '小屏经营面板里的采购按钮可点');

small.touchStart(180, 500);
small.touchDrag(180, 300);
small.touchEnd(180, 300);
small.frames(1);
check(small.V.scroll.manage > 0, `小屏经营面板可滚动（偏移 ${Math.round(small.V.scroll.manage)}px）`);
check(!!small.findHit('open'), '滚动后「开门营业」依然钉在原位（y 不随滚动变化）');

/* 滚动位移后命中区必须跟着移动，否则会出现「点了没反应/点错按钮」 */
const beforeY = (small.findHit('buy', 'tea') || {}).y;
/* 反向小幅拖 40px：scroll 从 90 回到 50，按钮应跟着往上移回 40px。
   （故意不用大幅拖拽 —— 那样会被夹到 0，坐标反而回到原处，测不出位移。） */
small.touchStart(180, 300);
small.touchDrag(180, 340);
small.touchEnd(180, 340);
small.frames(1);
const afterHit = small.findHit('buy', 'tea');
check(!!afterHit && afterHit.y === beforeY + 40,
  `反向滚动时命中区同步位移（${beforeY} → ${afterHit ? afterHit.y : '不可见'}）`);

small.touchStart(180, 300);
small.touchDrag(180, 700);
small.touchEnd(180, 700);
small.frames(1);
check(small.V.scroll.manage === 0, '滚到顶部后被夹住，不会露出内容区上方的空白');

/* ------------------------------------------------------------
 *  刘海机型：Canvas 没有 env(safe-area-inset-*)，安全区只能向宿主问
 * ---------------------------------------------------------- */
check(V.ins.top === 0 && V.ins.bottom === 0, '普通机型安全区为 0（不会凭空多留边）');

const notch = makeEnv(390, 844, {
  windowWidth: 390, windowHeight: 844, screenHeight: 844, pixelRatio: 3,
  statusBarHeight: 47, safeArea: { top: 47, bottom: 810, left: 0, right: 390 },
});
notch.frames(2);
check(notch.V.ins.top === 47 && notch.V.ins.bottom === 34,
  `刘海机型读出安全区（上 ${notch.V.ins.top} / 下 ${notch.V.ins.bottom}）`);

notch.tap('start');
notch.frames(1);
notch.tap('tutskip');
notch.frames(1);
/* HUD 的四个数值胶囊必须整体落进安全区以内，否则会被挖孔吃掉 */
const hudYs = notch.G.hits.filter(h => h.act === 'tab').map(h => h.y);
check(hudYs.length > 0 && Math.min.apply(null, hudYs) >= 47,
  `刘海机型上 HUD 与 Tab 未被状态栏遮挡（最小 y=${Math.min.apply(null, hudYs)}）`);

/* 营业中的四个操作按钮必须落在 Home 指示条之上 */
const ns = notch.MG.S;
ns.menu = ns.recipes.slice(0, notch.inCtx('menuSlots')(ns));
for (const r of ns.menu) ns.ratios[r] = 1.0;
notch.tap('open');
notch.frames(1);
const stageBtns = notch.G.hits.filter(h => ['boss', 'pause', 'restock', 'closeearly'].indexOf(h.act) >= 0);
check(stageBtns.length === 4 && Math.max.apply(null, stageBtns.map(h => h.y + h.h)) <= 844 - 34,
  '刘海机型上营业按钮避开了 Home 指示条');

/* 返回主菜单 → 结局页 */
MG.doAct('home'); frames(1);
check(V.screen === 'title', '可返回主菜单');

MG.startGame('normal', null, false); frames(1);
MG.finishRun('finish'); frames(1);
check(V.screen === 'end', '可进入结局页');
check(!!V.end && !!V.end.grade, `结局页有评级：${V.end ? V.end.grade : '—'}`);
check(!!findHit('again'), '结局页「再来一局」有可点区域');
tap('again'); frames(1);
check(V.screen === 'game' && MG.S.day === 1, '「再来一局」可重开新的一局');

/* ------------------------------------------------------------
 *  抖音平台能力：侧边栏复访 / 加桌面 / 订阅消息 / 广告 / 内购
 *
 *  基础环境的 tt 只有 6 个 API，这里补一套「完整 tt」来验证：
 *    1. 能力全开时入口真的出现、按钮真的调到了对应官方 API
 *    2. 一项都没配时入口完全不出现（不能给玩家一个点了没反应的按钮）
 * ---------------------------------------------------------- */
const capCalls = [];
const adBox = { rewarded: null };
const capTT = {
  checkScene: o => { capCalls.push('checkScene'); if (o.success) o.success({ isExist: true }); },
  navigateToScene: o => {
    capCalls.push('navigateToScene:' + o.scene);
    if (o.success) o.success({ code: 0, errMsg: 'navigateToScene:ok' });
  },
  checkShortcut: o => { capCalls.push('checkShortcut'); if (o.success) o.success({ exist: false }); },
  addShortcut: o => { capCalls.push('addShortcut'); if (o.success) o.success({ errMsg: 'addShortcut:ok' }); },
  requestSubscribeMessage: o => {
    capCalls.push('subscribe:' + (o.tmplIds || []).length);
    const r = { errMsg: 'requestSubscribeMessage:ok' };
    (o.tmplIds || []).forEach(id => { r[id] = 'accept'; });
    if (o.success) o.success(r);
  },
  createRewardedVideoAd: o => {
    capCalls.push('createRewardedVideoAd');
    adBox.rewarded = {
      _close: null,
      onLoad() { }, onError() { }, offError() { }, load() { },
      onClose(fn) { this._close = fn; },
      show() { capCalls.push('rewardedShow'); return Promise.resolve(); },
      /* 测试专用：模拟「用户完整看完」 */
      fire(isEnded) { if (this._close) this._close({ isEnded: isEnded !== false }); },
    };
    return adBox.rewarded;
  },
  createInterstitialAd: o => {
    capCalls.push('createInterstitialAd');
    return { onClose() { }, show() { return Promise.resolve(); } };
  },
  shareAppMessage: o => { capCalls.push('share:' + (o.title || '')); if (o.success) o.success({}); },
  requestGamePayment: o => {
    capCalls.push('pay:' + o.buyQuantity);
    if (o.success) o.success({});
  },
  openAwemeCustomerService: o => {
    capCalls.push('payIos:' + o.orderAmount);
    if (o.success) o.success({});
  },
};

const cap = makeEnv(390, 844, null, capTT);
const C = cap.ctx.CAPS;
C.cfg.rewardedAdUnitId = 'test-rewarded';
C.cfg.interstitialAdUnitId = 'test-interstitial';
C.cfg.subscribeTmplIds = ['MSG_TEST_1'];
C.cfg.iap = true;
C.cfg.iapGoods = [{ id: 'pearl60', name: '60 珍珠', qty: 60, price: 600, grantCash: 1200, grantIng: 60 }];

cap.frames(2);
check(capCalls.indexOf('checkScene') >= 0, '启动时即调用 tt.checkScene 探测侧边栏支持情况');

cap.tap('start'); cap.frames(1);
cap.tap('tutskip'); cap.frames(1);
check(!!cap.findHit('gift'), '能力可用时，经营面板首屏出现「每日福利」入口');

cap.tap('gift'); cap.frames(1);
check(cap.V.modal && cap.V.modal.type === 'gift', '可打开福利中心');

/* ③ 侧边栏：未从侧边栏进来时，按钮应是「前往侧边栏」 */
check(!!cap.findHit('sidebar'), '③ 侧边栏复访有入口（平台必接项）');
cap.tap('sidebar'); cap.frames(1);
check(capCalls.indexOf('navigateToScene:sidebar') >= 0,
  '③ 点击后确实调用了 tt.navigateToScene({scene:"sidebar"})');

/* ② 添加到桌面 */
check(!!cap.findHit('shortcut'), '② 添加到桌面有入口');
cap.tap('shortcut'); cap.frames(1);
check(capCalls.indexOf('addShortcut') >= 0, '② 点击后确实调用了 tt.addShortcut');

/* ④ 订阅消息 */
check(!!cap.findHit('subscribe'), '④ 订阅消息有入口');
cap.tap('subscribe'); cap.frames(1);
check(capCalls.indexOf('subscribe:1') >= 0, '④ 点击后确实调用了 tt.requestSubscribeMessage');

/* ⑤ 激励广告：看完才发奖 */
check(!!cap.findHit('adreward'), '⑤ 激励视频有入口');
const cashBeforeAd = cap.MG.S.cash;
cap.tap('adreward'); cap.frames(1);
check(capCalls.indexOf('rewardedShow') >= 0, '⑤ 点击后调用了激励视频的 show()');
cap.frames(1);
if (adBox.rewarded) adBox.rewarded.fire(true);
cap.frames(1);
check(cap.MG.S.cash > cashBeforeAd,
  `⑤ 完整看完广告后发放奖励（现金 ${Math.round(cashBeforeAd)} → ${Math.round(cap.MG.S.cash)}）`);

/* ① 内购（领完广告奖励后弹窗会关掉，这里要重新打开） */
cap.MG.doAct('gift'); cap.frames(1);
check(cap.V.modal && cap.V.modal.type === 'gift', '领奖后福利中心可重新打开');
check(!!cap.findHit('iapbuy', '0'), '① 内购商品有入口');
const cashBeforePay = cap.MG.S.cash;
cap.tap('iapbuy', '0'); cap.frames(1);
check(capCalls.indexOf('pay:60') >= 0, '① 点击后调用了支付下单接口');
check(cap.MG.S.cash >= cashBeforePay + 1200,
  `① 支付成功后发放道具（现金 +${Math.round(cap.MG.S.cash - cashBeforePay)}）`);

/* ⑥ 分享：结局页入口 + 点击同步调用 tt.shareAppMessage */
check(C.shareOn(), '⑥ 宿主支持分享时入口判定为真');
cap.V.screen = 'end'; cap.V.end = { kind: 'finish' }; cap.frames(1);
check(!!cap.findHit('share'), '⑥ 结局页有「分享战绩」按钮');
cap.tap('share'); cap.frames(1);
const shareCall = capCalls.filter(c => c.indexOf('share:') === 0).pop() || '';
check(shareCall.length > 6, '⑥ 点击后确实调用了 tt.shareAppMessage');
check(/¥/.test(shareCall) && !/\{/.test(shareCall),
  '⑥ 分享标题已把净资产填进模板（没有留下 {worth} 占位符）：' + shareCall.slice(6));
cap.V.screen = 'game'; cap.frames(1);

/* 侧边栏复访完整链路：从侧边栏启动 → 可领奖 → 只能领一次 */
cap.MG.doAct('gift'); cap.frames(1);
check(!cap.findHit('sidebarclaim'),
  '未从侧边栏进入时，不出现「领取奖励」按钮（不能白送）');

cap.show({ launch_from: 'homepage', location: 'sidebar_card' });
cap.MG.doAct('gift'); cap.frames(1);
check(!!cap.findHit('sidebarclaim'), '从侧边栏启动后出现「领取奖励」按钮');

const cashBeforeClaim = cap.MG.S.cash;
cap.tap('sidebarclaim'); cap.frames(1);
check(cap.MG.S.cash > cashBeforeClaim,
  `领取复访补给后现金增加（${Math.round(cashBeforeClaim)} → ${Math.round(cap.MG.S.cash)}）`);

cap.MG.doAct('gift'); cap.frames(1);
check(!cap.findHit('sidebarclaim'), '同一天不能重复领取（按钮变为「已领取」）');

/* ⑤ 插屏：只在「打烊结算 → 进入下一天」这个自然断点上触发 */
cap.V.modal = null; cap.frames(1);
cap.MG.doAct('nextday'); cap.frames(1);
check(capCalls.indexOf('createInterstitialAd') >= 0, '⑤ 进入下一天时触发插屏广告（自然断点）');

/* 每日任务（Canvas 版）：面板画得出来 + 达成即到账 + 有提示气泡 */
const qe = makeEnv(390, 844);
qe.frames(2);
qe.tap('start'); qe.frames(1);
qe.tap('tutskip'); qe.frames(1);
const qS = qe.MG.S;
check((qS.quests || []).length === 3,
  `开局抽到 3 条每日任务（${(qS.quests || []).map(q => q.id).join('/')}）`);
const qHits = qe.frameHits[qe.frameHits.length - 1];
check(qHits > 0, `经营面板（含任务卡）绘制出 ${qHits} 个命中区，无异常`);
/* 造一条必定达成的任务，走「引擎发奖 → step 消费 → 弹提示」的完整链路 */
qS.quests = [{ id: 'q_cups', goal: 1, prog: 0, done: false, got: 0 }];
qS.newQuests = [];
const qCash0 = qS.cash;
qe.inCtx('bumpQuest(_S, "cups", 1)');
qe.frames(1);
check(qS.cash > qCash0, `每日任务达成即时到账（+${Math.round(qS.cash - qCash0)}）`);
check(qS.quests[0].done, '任务被标记为已完成');
check((qe.V.toasts || []).some(t => (t.msg || '').indexOf('🎯') >= 0),
  '达成后弹出了任务提示气泡');
check(!qe.frameErr, `绘制任务卡后主循环仍无异常${qe.frameErr ? '：' + qe.frameErr : ''}`);

/* 连续登录：标题页签到 → 开局结转 */
const le = makeEnv(390, 844);
le.frames(2);
check(!!le.findHit('login'), '标题页「连续登录」有可点区域');
check(!!le.findHit('export'), '标题页「导出」有可点区域（与导入成对，不再只能进不能出）');
const cashPend0 = le.MG.META.pendingCash || 0;
le.tap('login'); le.frames(1);
const pend = le.MG.META.pendingCash || 0;
check(pend > cashPend0, `签到后创业基金入账（+${Math.round(pend - cashPend0)}）`);
check(le.MG.META.loginStreak === 1, '首次签到连登天数为 1');
check(!le.findHit('login'), '签过之后按钮不再登记命中（不能重复领）');
le.tap('start'); le.frames(1);
le.tap('tutskip'); le.frames(1);
check(le.MG.META.pendingCash === 0, '开局后创业基金已结转（pendingCash 清零）');
check(le.MG.S.loginBonus === pend, `创业基金落进本局现金（+${Math.round(pend)}）`);

/* 第二轮复查修复项的回归锁定：两版一致性 */
const f2 = makeEnv(390, 844);
f2.frames(2);
f2.tap('start'); f2.frames(1);
f2.tap('tutskip'); f2.frames(1);
f2.MG.S.cash = 8000;

/* 调研：小游戏原本没有入口，s.trendKnown 永远 false、明日预告永远是 ❓ */
check(!!f2.findHit('scout'), '情报卡有「🔍 调研」按钮');
const cashBeforeScout = f2.MG.S.cash;
f2.tap('scout'); f2.frames(1);
check(f2.MG.S.trendKnown === true, '调研后明日趋势可见（不再永远是 ❓）');
check(f2.MG.S.cash === cashBeforeScout - 150, '调研扣了 ¥150');

/* 团建：teamBuild() 原本是死代码 */
f2.tap('tab', 'staff'); f2.frames(1);
f2.tap('hire', '0'); f2.frames(1);
check((f2.MG.S.staff || []).length > 0, '雇佣成功（为团建测试做准备）');
check(!!f2.findHit('teambuild'), '员工面板有团建按钮（teamBuild 不再是死代码）');
for (let i = 0; i < (f2.MG.S.staff || []).length; i++) f2.MG.S.staff[i].stamina = 20;
f2.tap('teambuild'); f2.frames(1);
check((f2.MG.S.staff || []).every(p => p.stamina > 20), '团建后体力的确回满了');

/* 一键补货：原来那颗「满」按钮传 999，100% 撞仓库上限，永远只弹错误 */
f2.tap('tab', 'manage'); f2.frames(1);
const invBeforeFill = f2.inCtx('invUsed(_S)');
check(!!f2.findHit('autofill'), '经营面板有「一键补货」按钮，且没有那颗必然失败的「满」');
/* findHit 只按 act+id 匹配，extra 得自己去命中表里查 */
const has999 = (f2.G.hits || []).some(h => h.act === 'buy' && h.extra === 999);
check(!has999, '不存在 extra=999 的采购按钮（那颗「满」必然撞仓库上限而失败）');
f2.tap('autofill'); f2.frames(1);
check(f2.inCtx('invUsed(_S)') > invBeforeFill,
  `一键补货真的进了货（${Math.round(invBeforeFill)} → ${Math.round(f2.inCtx('invUsed(_S)'))}）`);

/* 离线弹窗文案：claimOffline 返回 mins/gain，读 hours/income 会永远显示 0 */
const ot = f2.inCtx('offText({ mins: 125, gain: 300 })');
check(/2 小时 5 分/.test(ot) && /300/.test(ot), '离线弹窗文案用了 mins/gain：' + ot);

/* 平台补给不得越过仓库上限（越界后所有进货都会返回「仓库装不下了」） */
const capT = Math.round(f2.inCtx('storageCap(_S)'));
f2.inCtx('for (var i=0;i<ING.length;i++) _S.inv[ING[i].id] = 0; _S.inv[ING[0].id] = storageCap(_S);');
f2.inCtx('grantIng(_S, 30)');
check(Math.round(f2.inCtx('invUsed(_S)')) === capT,
  `仓库已满时补给不越界（上限 ${capT}）`);

/* 无尽模式在小游戏必须可达（原来 startEndless 没有任何调用点） */
f2.MG.doAct('endless'); f2.frames(1);
check(f2.MG.S.endless === true, '「无尽模式」在小游戏有可达入口');

/* 音效：小游戏没有 WebAudio，只能走 tt.createInnerAudioContext + 音频文件。
   文件缺失 / 宿主不支持时必须静默降级，绝不能影响玩法。 */
const sfxCalls = [];
const sfxTT = {
  createInnerAudioContext: o => {
    sfxCalls.push('create:' + o.src);
    return {
      src: o.src,
      stop() { }, seek() { }, play() { sfxCalls.push('play:' + o.src); },
      onError() { }, destroy() { },
    };
  },
};
const sfx = makeEnv(390, 844, null, sfxTT);
sfx.frames(2);
check(sfx.MG.audio && sfx.MG.audio.available === true,
  '宿主提供 createInnerAudioContext 时音效可用（不再是永久静音）');
check(sfxCalls.filter(c => c.indexOf('create:audio/') === 0).length === 3,
  '加载了 3 个音效文件：' + sfxCalls.filter(c => c.indexOf('create:') === 0).map(c => c.slice(7)).join(' / '));
sfx.MG.audio.play('up', 880, 0.07);     /* 连点出杯：高频 → tap */
sfx.MG.audio.play('up', 660, 0.12);     /* 升级：中频 → up */
sfx.MG.audio.play('down', 140, 0.16);   /* 负反馈：低频 → down */
const played = sfxCalls.filter(c => c.indexOf('play:') === 0).map(c => c.slice(5));
check(played.join(',') === 'audio/tap.wav,audio/up.wav,audio/down.wav',
  '按频率挑对了音效文件：' + played.join(' / '));
/* 没有音频 API 的宿主：静默降级，不报错 */
const mute = makeEnv(390, 844);
mute.frames(2);
check(mute.MG.audio && mute.MG.audio.available === false,
  '浏览器/无音频宿主下静默降级为静音（不抛错、不开开关）');
check(mute.V.sound === false, '不可用时音效开关自动关闭（不给一个点了没反应的开关）');

/* 本机战绩榜：跨局保留最好的 5 局，两版一致 */
const lb = makeEnv(390, 844);
lb.frames(2);
lb.tap('start'); lb.frames(1);
lb.tap('tutskip'); lb.frames(1);
lb.inCtx('pushRunRecord(_META, _S, "finish")');
check((lb.MG.META.runsTop || []).length === 1, '小游戏收官也会记进本机战绩榜');
for (let i = 0; i < 8; i++) lb.inCtx('pushRunRecord(_META, _S, "finish")');
check((lb.MG.META.runsTop || []).length === lb.inCtx('CFG.RUN_TOP_N'),
  `战绩榜截断到 ${lb.inCtx('CFG.RUN_TOP_N')} 条（不会无限增长）`);
lb.V.screen = 'title'; lb.frames(1);
check(!lb.frameErr, `标题页绘制战绩榜无异常${lb.frameErr ? '：' + lb.frameErr : ''}`);
lb.V.screen = 'game';

/* N22 出杯位超屏：旧写法 `if (sy + sh > L.H - 96) break;` 会让超屏工位
   既不绘制也不登记命中区，玩家看得见订单却点不到工位，加速不了只能眼看客人流失。 */
const stE = makeEnv(390, 844);
stE.frames(2);
stE.tap('start'); stE.frames(1);
stE.tap('tutskip'); stE.frames(1);
stE.MG.S.cash = 300000;
/* 直接造工位：8 名员工 + 4 家店 = 1 + 8 + 3 = 12 个出杯位 */
stE.inCtx('_S.staff = [];'
  + 'for (var i=0;i<8;i++) _S.staff.push({ name:"员"+i, emoji:"🙂", skill:1, trait:null, wage:60, stamina:100 });'
  + '_S.shops = 4;');
stE.MG.doAct('open'); stE.frames(1);
const stn = stE.MG.S.sim.stations;
check(stn.length === 12, `造出 ${stn.length} 个出杯位（1 老板 + 8 员工 + 3 分店）`);
const firstScreen = (stE.G.hits || []).filter(h => h.act === 'rush').length;
check(firstScreen >= 8, `自适应网格让首屏能点到 ${firstScreen} 个工位（旧写法固定 2 列 76 高）`);
/* 逐个工位验证可达性：在 0 → stageMax 之间扫一遍，id 必须全部出现过 */
const seen = new Set();
const STEPS = 24;
for (let k = 0; k <= STEPS; k++) {
  stE.V.stageScroll = (stE.V.stageMax * k) / STEPS;
  stE.frames(1);
  (stE.G.hits || []).forEach(h => { if (h.act === 'rush') seen.add(h.id); });
}
check(seen.size === stn.length,
  `滑动过程中 ${stn.length} 个工位全部可达（实际可达 ${seen.size} 个，旧写法会漏掉超屏的）`);
check(!stE.frameErr, `超屏工位绘制无异常${stE.frameErr ? '：' + stE.frameErr : ''}`);

/* 小屏上必须真的走滑动兜底（自适应装不下 → 压高度 → 仍装不下 → 可滑动） */
const stS = makeEnv(320, 568);
stS.frames(2);
stS.tap('start'); stS.frames(1);
stS.tap('tutskip'); stS.frames(1);
stS.MG.S.cash = 300000;
stS.inCtx('_S.staff = [];'
  + 'for (var i=0;i<16;i++) _S.staff.push({ name:"员"+i, emoji:"🙂", skill:1, trait:null, wage:60, stamina:100 });'
  + '_S.shops = 4;');
stS.MG.doAct('open'); stS.frames(1);
check(stS.V.stageMax > 0,
  `320×568 小屏上 20 个工位装不下时开启滑动（stageMax=${Math.round(stS.V.stageMax)}）`);
const seenS = new Set();
for (let k = 0; k <= STEPS; k++) {
  stS.V.stageScroll = (stS.V.stageMax * k) / STEPS;
  stS.frames(1);
  (stS.G.hits || []).forEach(h => { if (h.act === 'rush') seenS.add(h.id); });
}
check(seenS.size === stS.MG.S.sim.stations.length,
  `小屏滑动后 ${stS.MG.S.sim.stations.length} 个工位全部可达（实际 ${seenS.size} 个）`);

/* 装得下时不该出现滑动（不能为了修 bug 把正常情况也改坏） */
const stF = makeEnv(390, 844);
stF.frames(2);
stF.tap('start'); stF.frames(1);
stF.tap('tutskip'); stF.frames(1);
stF.MG.S.cash = 3000;
stF.MG.doAct('open'); stF.frames(1);
const stnF = stF.MG.S.sim.stations.length;
check(stF.V.stageMax === 0, `只有 ${stnF} 个工位时不开启滑动（stageMax=0，手感不变）`);
check((stF.G.hits || []).filter(h => h.act === 'rush').length === stnF,
  `工位少时 ${stnF} 个全部直接可点`);

/* N24 引导自动推进：等待型步骤做出对应动作后应自动前进，
   以前小游戏一律吞掉事件，玩家只能靠「下一步」把引导硬念完。 */
const tg = makeEnv(390, 844);
tg.frames(2);
tg.tap('start'); tg.frames(1);
check(tg.V.tut.on, '开局自动进入引导');
/* 手动推到「③ 低价囤货」那一步（advance: 'buy'） */
let tgGuard = 0;
while (tg.V.tut.on && tg.inCtx('TUTORIAL[VIEW.tut.step].advance') !== 'buy' && tgGuard++ < 20) {
  tg.tap('tutnext'); tg.frames(1);
}
const buyStep = tg.V.tut.step;
check(tg.inCtx('TUTORIAL[VIEW.tut.step].advance') === 'buy',
  `已推到等待「买入」的引导步骤（第 ${buyStep + 1} 步）`);
/* 非目标动作仍然要被吞掉，不能在引导里误触 */
const cashBeforeGuard = tg.MG.S.cash;
tg.tap('tab', 'staff'); tg.frames(1);
check(tg.V.tut.step === buyStep && tg.V.tab === 'manage',
  '引导进行中误触的其它按钮仍被拦截（不会乱切面板）');
/* 目标动作放行 + 自动推进 */
check(!!tg.findHit('buy', 'tea'), '等待「买入」时原料按钮放行了（否则玩家做不出动作）');
tg.MG.S.cash = 5000;
tg.tap('buy', 'tea'); tg.frames(1);
check(tg.V.tut.step === buyStep + 1,
  `买入成功后引导自动前进到第 ${tg.V.tut.step + 1} 步（无需点「下一步」）`);
check(tg.V.tutRush === 0, '推进时连点计数已复位');
check(!tg.frameErr, `引导自动推进无异常${tg.frameErr ? '：' + tg.frameErr : ''}`);

/* 一项都没配 → 入口完全不出现 */
const plain = makeEnv(390, 844);
plain.frames(2);
plain.tap('start'); plain.frames(1);
plain.tap('tutskip'); plain.frames(1);
check(!plain.findHit('gift'),
  '未配置任何平台能力时不显示入口（不给出点了没反应的按钮）');

console.log('');
if (failed === 0) console.log('✅ 小游戏冒烟测试全部通过（' + step + ' 项）');
else console.log(`❌ 失败 ${failed} 项 / 共 ${step} 项`);
process.exit(failed === 0 ? 0 : 1);
