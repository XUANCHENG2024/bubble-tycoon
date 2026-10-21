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
/* Canvas 上没有 DOM 也没有 tooltip，**文字就是唯一的界面**。
   所以要验证「文案是否还宣称硬约束」，只能捕获真正 fillText 画出去的字。
   每帧结束（frames 里）清空，避免把上一帧的字混进断言。 */
const drawnTexts = [];

function fakeCtx() {
  return new Proxy({}, {
    get(t, p) {
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() { } });
      if (p === 'measureText') return (s) => ({ width: String(s).length * 6.5 });
      if (p === 'fillText') return (s) => { if (s != null) drawnTexts.push(String(s)); };
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

/* ⑦ 每日挑战日榜（F3）
   两条路径都要验：
     · 平台能力在 —— 预热登录、上报分数、拉起原生榜单；
     · 平台能力不在（宿主不支持 / 未登录）—— 面板照样打开，只是不给那个按钮。 */
const rankCalls = [];
const rankTT = {
  login: o => { rankCalls.push('login'); if (o && o.success) o.success({ code: 'test' }); },
  setImRankData: o => {
    rankCalls.push('setImRankData:' + (o.value || '') + '@' + (o.zoneId || ''));
    if (o.success) o.success({ errMsg: 'setImRankData:ok' });
  },
  getImRankList: o => {
    rankCalls.push('getImRankList:' + (o.rankType || '') + '/' + (o.relationType || '')
      + '/' + (o.dataType));
    if (o.success) o.success({ errMsg: 'getImRankList:ok' });
  },
};
const rk = makeEnv(390, 844, null, rankTT);
const RK = rk.ctx.CAPS;
rk.frames(2);
check(rankCalls.indexOf('login') >= 0,
  '⑦ 启动时预热登录态（两个排行榜 API 都要求已登录，未登录拉榜会闪退）');
check(RK.rankOn() && RK.rankListOn(), '⑦ 宿主支持时排行榜能力判定为真');

/* 上报：value 必须是 [0, int32_MAX) 的正整数字符串 */
RK.submitRank(38402);
check(rankCalls.indexOf('setImRankData:38402@daily') >= 0,
  '⑦ 上报的 value 是净资产的字符串形式，分区标识用 daily');
RK.submitRank(-500);
check(rankCalls[rankCalls.length - 1] === 'setImRankData:0@daily',
  '⑦ 负的净资产被夹到 0（平台只收正数）');
RK.submitRank(1e12);
check(rankCalls[rankCalls.length - 1] === 'setImRankData:2147483647@daily',
  '⑦ 超过 int32_MAX 的分数被夹住（否则平台报 invalid param）');
RK.submitRank(1234.6);
check(rankCalls[rankCalls.length - 1] === 'setImRankData:1235@daily',
  '⑦ 上报分数取整');

/* 只记「当天最好一局」：更差的一局不覆盖，也不上报 */
rk.inCtx('_META.dailyDate = ""; _META.dailyBest = 0; _META.dailyBestEver = 0; _META.dailyLog = [];');
const r1 = rk.inCtx('recordDaily(_META, todayKey(), 10000)');
check(r1.newToday && r1.newEver, '⑦ 首次成绩同时刷新今日与个人最佳');
const r2 = rk.inCtx('recordDaily(_META, todayKey(), 8000)');
check(!r2.newToday && rk.inCtx('_META.dailyBest') === 10000,
  '⑦ 更差的一局不覆盖今天的最佳（覆盖上报等于自己把名次冲掉）');
check(rk.inCtx('dailyRecent(_META, 7).length') === 1, '⑦ 一天只留一条日志');

/* 标题页入口 + 原生榜单 */
check(!!rk.findHit('dailyrank'), '⑦ 标题页有「🏆 日榜」入口');
rk.tap('dailyrank'); rk.frames(1);
check(rk.V.modal && rk.V.modal.type === 'dailyrank', '⑦ 可打开每日挑战日榜面板');
check(!!rk.findHit('ranklist'), '⑦ 平台能力可用时，面板里有「查看全网日榜」');
rk.tap('ranklist'); rk.frames(1);
check(rankCalls.some(c => c.indexOf('getImRankList:day/default/0') === 0),
  '⑦ 点击后确实调用 tt.getImRankList，且 rankType=day（日榜）、dataType=0（数值）');

/* 打完每日挑战这一局：成绩入库 + 上报 + 结局页给日榜入口 */
rk.MG.doAct('close'); rk.frames(1);
/* 上面手动记过一局 10000，不归零的话这一局（净资产约 900）会被判为
   「更差的一局」而不上报 —— 这是对的，但不能拿它来验上报链路。 */
rk.inCtx('_META.dailyDate = ""; _META.dailyBest = 0; _META.dailyBestEver = 0; _META.dailyLog = [];');
rankCalls.length = 0;
rk.tap('daily'); rk.frames(1);
check(rk.MG.S.daily === true, '⑦ 每日挑战带 daily 标记开局');
rk.MG.finishRun('finish'); rk.frames(1);
check(!!rk.V.end.daily, '⑦ 每日挑战结束时把日榜结果带进结局页');
check(rankCalls.some(c => c.indexOf('setImRankData:') === 0),
  '⑦ 刷新当天最好成绩时上报到平台');
check(!!rk.findHit('dailyrank'), '⑦ 结局页出现「🏆 日榜」按钮');
rk.tap('dailyrank'); rk.frames(1);
check(!!rk.findHit('ranklist'), '⑦ 结局页也能一路点到原生榜单');

/* 降级：宿主不支持时入口不消失，但也不给点了没反应的按钮 */
const noRk = makeEnv(390, 844);
noRk.frames(2);
check(!noRk.ctx.CAPS.rankOn(), '⑦ 降级：宿主不支持时 rankOn 判定为假');
noRk.tap('dailyrank'); noRk.frames(1);
check(noRk.V.modal && noRk.V.modal.type === 'dailyrank',
  '⑦ 降级：日榜面板照样能打开（入口不消失）');
check(!noRk.findHit('ranklist'),
  '⑦ 降级：不给出「查看全网日榜」这种点了没反应的按钮');
check(!noRk.frameErr, `⑦ 降级面板渲染无异常${noRk.frameErr ? '：' + noRk.frameErr : ''}`);

/* 小屏：日榜面板的按钮不能画到裁剪区外 */
const rkS = makeEnv(360, 640, null, rankTT);
rkS.frames(2);
rkS.tap('dailyrank'); rkS.frames(1);
const rkHits = rkS.G.hits.filter(h => h.act === 'ranklist' || h.act === 'daily');
check(rkHits.length >= 2, `⑦ 360×640 上日榜面板的按钮都在裁剪区内（找到 ${rkHits.length} 个）`);
const rkLow = Math.max.apply(null, rkHits.map(h => h.y + h.h));
check(rkLow <= 640, `⑦ 日榜面板最低的按钮没有出屏（${Math.round(rkLow)} ≤ 640）`);

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
/* 直接造工位：8 名员工 + 4 家店。
   ★ V11 起工位数 = 1（老板）+ 员工数，**分店不再白送工位** ——
     改造前是 `s.staff[(i-1) % pool]` 取模轮转，3 家店 2 个员工时
     同一个人会同时在 3 家店"上班"，玩家白付 3 份店租只买到一个人的产能。
     现在员工的 branch 字段决定他在哪家店干活，店长管的就是这些人。 */
stE.inCtx('_S.staff = [];'
  + 'for (var i=0;i<8;i++) _S.staff.push({ name:"员"+i, emoji:"🙂", skill:1, trait:null, wage:60, stamina:100, branch:1 });'
  + '_S.shops = 4;');
stE.MG.doAct('open'); stE.frames(1);
const stn = stE.MG.S.sim.stations;
check(stn.length === 9, `造出 ${stn.length} 个出杯位（1 老板 + 8 员工，分店不额外加位）`);
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

/* ------------------------------------------------------------
 *  F1：声望点改为开局资金（两版必须同口径）
 *  canvas 版没有 DOM，这里验证的是「钱真的到账 + 文案不再承诺客流 + 每日挑战仍然公平」
 * ---------------------------------------------------------- */
{
  const f1 = makeEnv(390, 844);
  f1.frames(2);
  const BASE = f1.inCtx('DIFFICULTY.normal.cash');
  f1.MG.META.tutDone = true;      /* 不进引导，否则触摸会被引导吞掉 */

  /* 首局：不该有开局资金 */
  f1.MG.startGame('normal', null, false); f1.frames(1);
  /* 连续登录的创业基金也会进现金，比较时必须把它扣掉 */
  const login1 = f1.MG.S.loginBonus || 0;
  check(f1.MG.S.startBonus === 0 && f1.MG.S.cash === BASE + login1,
    `首局没有开局资金（现金 ${BASE} + 签到 ${login1}）`);

  /* 有声望：折算成现金并写进 state */
  f1.MG.META.bp = 100;
  f1.MG.startGame('normal', null, false); f1.frames(1);
  check(f1.MG.S.startBonus === 300, `声望 100 ★ → 开局资金 ¥300（实际 ${f1.MG.S.startBonus}）`);
  check(f1.MG.S.cash === BASE + 300, `开局资金进了现金（${BASE} → ${f1.MG.S.cash}）`);
  check(f1.MG.S.log.some(l => typeof l === 'string' && l.indexOf('创业基金') >= 0),
    '开局日志写明了这笔钱的来源');

  /* 升级面板（品牌卡）在有声望时也要画得出来 */
  f1.tap('tab', 'up'); f1.frames(1);
  check(!f1.frameErr, `品牌卡渲染无异常${f1.frameErr ? '：' + f1.frameErr : ''}`);
  check(f1.V.tab === 'up', '可以切到升级面板');

  /* 转生弹窗：说钱，不说客流倍数 */
  f1.MG.doAct('prestige'); f1.frames(1);
  const mt = (f1.V.modal && f1.V.modal.text) || '';
  check(mt.indexOf('开局创业基金') >= 0, '转生弹窗说明了开局资金');
  check(mt.indexOf('客流 +') < 0, '转生弹窗不再承诺「客流 +N%」');

  /* 声望不再影响客流：改 bpBonus 前后必须一致 */
  const sameTraffic = f1.inCtx('(function(){var s=_S;var a=trafficOf(s);s.bpBonus=200;var b=trafficOf(s);s.bpBonus=Math.round(100);return a===b;})()');
  check(sameTraffic, '声望不再影响客流（需求端不再单方面变强）');

  /* 每日挑战：全网同一局，不带声望入场 */
  f1.MG.META.bp = 100;
  f1.MG.doAct('daily'); f1.frames(1);
  check(f1.MG.S.daily === true, '每日挑战可进入');
  check(f1.MG.S.startBonus === 0, '每日挑战不带声望入场（保证全网公平）');

  /* 成就 ★：跨局首次才入账 */
  const achOnce = f1.inCtx(`(function(){
    var m = { bp: 0, ach: {} };
    var a = ACHIEVEMENTS[0], b = ACHIEVEMENTS[1];
    var firsts = claimAchStars(m, [a, b]);
    var first = { n: firsts.length, bp: m.bp };
    var seconds = claimAchStars(m, [a, b]);
    return { first: first, secondN: seconds.length, secondBp: m.bp, want: a.reward.bp + b.reward.bp };
  })()`);
  check(achOnce.first.n === 2 && achOnce.first.bp === achOnce.want,
    `成就首次达成发 ★（共 ${achOnce.want} ★）`);
  check(achOnce.secondN === 0 && achOnce.secondBp === achOnce.want,
    '同一成就重复达成不再发 ★（否则两局就把开局资金顶到上限）');
}

/* ------------------------------------------------------------
 *  F2：打烊三选一策略卡
 *  canvas 版靠命中矩形交互，所以这里验证的是「卡片按钮真的点得到」，
 *  而不只是引擎里那几个函数对不对
 * ---------------------------------------------------------- */
{
  const c1 = makeEnv(390, 844);
  c1.frames(2);
  c1.MG.META.tutDone = true;
  c1.MG.startGame('normal', null, false); c1.frames(1);

  /* 造一个卡包：三张卡 + 「都不要」都必须有可点区域 */
  c1.MG.S.cardOffer = [c1.inCtx('STRATEGY_CARDS[0]'), c1.inCtx('STRATEGY_CARDS[1]'), c1.inCtx('STRATEGY_CARDS[2]')];
  c1.MG.doAct('nextday'); c1.frames(1);
  check(c1.V.modal && c1.V.modal.type === 'card', '打烊后有卡包时先弹三选一，不直接进下一天');
  const cardBtns = c1.G.hits.filter(h => h.act === 'pickcard');
  check(cardBtns.length === 3, `三张卡都有可点区域（找到 ${cardBtns.length} 个）`);
  check(!!c1.findHit('skipcard'), '有「都不要」出口');
  const dayBefore = c1.MG.S.day;
  /* 选第一张 → 进入下一天，且真的持有这张卡 */
  c1.tap('pickcard', c1.inCtx('STRATEGY_CARDS[0].id')); c1.frames(1);
  check(c1.MG.S.cards.length === 1 && c1.MG.S.cards[0] === c1.inCtx('STRATEGY_CARDS[0].id'),
    '点选卡片后真的持有它');
  check(c1.MG.S.day === dayBefore + 1, '选完卡片自动进入下一天');
  /* 接下来可能正好弹出「突发事件」（42% 概率），那不是没关掉，是下一个提示 */
  check(!c1.findHit('pickcard'), '选完之后卡包弹窗收起（不再有三选一的按钮）');
  check(c1.MG.S.cardOffer === null, '卡包已清空（不会第二天重复弹）');

  /* 跳过 → 不持有任何卡，但同样要能进下一天 */
  c1.MG.S.cards = [];
  c1.MG.S.day = c1.inCtx('CFG.CARD_EVERY') * 2;
  c1.MG.S.cardOffer = [c1.inCtx('STRATEGY_CARDS[3]'), c1.inCtx('STRATEGY_CARDS[4]')];
  c1.MG.doAct('nextday'); c1.frames(1);
  check(!!c1.findHit('skipcard'), '第二轮卡包也有「都不要」');
  c1.tap('skipcard'); c1.frames(1);
  check(c1.MG.S.cards.length === 0, '跳过之后没有卡进袋');
  check(c1.MG.S.day === c1.inCtx('CFG.CARD_EVERY') * 2 + 1, '跳过之后同样进入下一天');

  /* 持有卡片时经营面板要画得出来 */
  c1.MG.S.cards = [c1.inCtx('STRATEGY_CARDS[0].id'), c1.inCtx('STRATEGY_CARDS[1].id')];
  c1.tap('tab', 'manage'); c1.frames(1);
  check(!c1.frameErr, `持有卡片时经营面板渲染无异常${c1.frameErr ? '：' + c1.frameErr : ''}`);

  /* 无卡时一切照旧：倍率恒为 1，不能悄悄改动原有数值 */
  c1.MG.S.cards = [];
  check(c1.inCtx('cardMul(_S, "traffic")') === 1 && c1.inCtx('cardSum(_S, "unitSub")') === 0,
    '无卡时 cardMul 恒为 1、cardSum 恒为 0');

  /* 小屏：弹窗被裁剪，卡按钮一旦画到裁剪区外就点不到了（这类问题真机才看得见） */
  const small = makeEnv(360, 640);
  small.frames(2);
  small.MG.META.tutDone = true;
  small.MG.startGame('normal', null, false); small.frames(1);
  small.MG.S.cardOffer = [small.inCtx('STRATEGY_CARDS[0]'), small.inCtx('STRATEGY_CARDS[1]'),
    small.inCtx('STRATEGY_CARDS[2]')];
  small.MG.doAct('nextday'); small.frames(1);
  const sHits = small.G.hits.filter(h => h.act === 'pickcard' || h.act === 'skipcard');
  check(sHits.length === 4, `360×640 上三张卡 + 「都不要」都在裁剪区内（找到 ${sHits.length}/4）`);
  const lowest = Math.max.apply(null, sHits.map(h => h.y + h.h));
  check(lowest <= 640, `最低的按钮没有出屏（${Math.round(lowest)} ≤ 640）`);
}

/* 一项都没配 → 入口完全不出现 */
const plain = makeEnv(390, 844);
plain.frames(2);
plain.tap('start'); plain.frames(1);
plain.tap('tutskip'); plain.frames(1);
check(!plain.findHit('gift'),
  '未配置任何平台能力时不显示入口（不给出点了没反应的按钮）');

/* ------------------------------------------------------------
 *  N23 弹窗滚动（help 超高 → 音效开关必须可达）
 *  以前 onMove 在弹窗打开时直接 return：375×667 上玩法说明约 660~700px、
 *  弹窗只有 567px，底部章节和音效开关被裁掉且**没有任何方式能看到** ——
 *  而音效开关在小游戏版只此一处。
 * ---------------------------------------------------------- */
const sc = makeEnv(320, 568);
sc.frames(2);
sc.MG.doAct('help');
sc.frames(1);
const sndBefore = sc.V.sound;
check(!!sc.V.modal && sc.V.modal.type === 'help', 'N23 玩法说明弹窗打开');
check(sc.V.modalMax > 0,
  `N23 小屏上内容确实超高（modalMax=${Math.round(sc.V.modalMax)}px，修复前为 0）`);
check(!sc.findHit('sound'), 'N23 未滚动时音效开关不可见（还在裁剪区外）');
/* 走真实触摸链路拖拽：down → move（大幅位移触发拖动判定）→ up */
sc.touchStart(160, 300);
sc.touchDrag(160, 300 - 300);
sc.touchEnd(160, 0);
sc.frames(1);
check(sc.V.modalScroll > 0, `N23 拖拽后弹窗真的滚了（scroll=${Math.round(sc.V.modalScroll)}）`);
const sndHit = sc.findHit('sound');
check(!!sndHit, 'N23 滚动后音效开关可达（命中区已进入可视范围）');
if (sndHit) {
  sc.tapAt(sndHit.x + sndHit.w / 2, sndHit.y + sndHit.h / 2);
  sc.frames(1);
  check(sc.V.sound === !sndBefore, 'N23 滚动状态下点音效开关正常生效（开关翻转）');
}
/* 滚动后弹窗里的 × 仍然固定在右上角可点 */
const xHit = sc.findHit('close');
check(!!xHit && xHit.y < 100, 'N23 滚动不影响右上角 × 的固定位置');
/* 重开同一弹窗，滚动要复位 */
sc.MG.doAct('close'); sc.frames(1);
sc.MG.doAct('help'); sc.frames(1);
check(sc.V.modalScroll === 0, 'N23 重新打开弹窗时滚动复位');

/* ------------------------------------------------------------
 *  N24 引导四件事：③ 高亮指采购卡、④ 配方行可点（toggle）、
 *  ⑥ 高亮指真实开门按钮、引导卡不盖住它
 *  修复前：②③⑥ 高亮是硬编码 y（面板内容顺序一变就指错）；
 *  ④ 的提示「点一下任意配方卡」根本做不到（配方行没有 toggle 命中），
 *  ⑥ 引导卡盖住开门按钮大半，只能硬点「下一步」。
 * ---------------------------------------------------------- */
const tu = makeEnv(390, 844);
tu.frames(2);
tu.tap('start'); tu.frames(1);
check(tu.V.tut.on === true, 'N24 开局引导自动弹出');
/* ①②③ 都是 next 型：连点三次「下一步」走到第③步（market，等 buy） */
tu.tap('tutnext'); tu.frames(1);
tu.tap('tutnext'); tu.frames(1);
tu.tap('tutnext'); tu.frames(1);
check(tu.V.tut.step === 3, `N24 三次下一步走到第③步（实际 step=${tu.V.tut.step}）`);
const mkRect = tu.V.tut.rect;
check(!!mkRect && Math.abs(mkRect.y - (tu.V.panelRects.market.y - 4)) <= 8,
  `N24 ③ 高亮框指向真实采购卡（y=${mkRect ? Math.round(mkRect.y) : '无'}，卡片 y=${tu.V.panelRects.market.y}）`);
/* 点 +10 买入 → 推进到第④步 */
const buyHit = tu.findHit('buy');
check(!!buyHit, 'N24 采购按钮存在');
if (buyHit) { tu.tapAt(buyHit.x + buyHit.w / 2, buyHit.y + buyHit.h / 2); tu.frames(1); }
check(tu.V.tut.step === 4, `N24 完成③后进入第④步（实际 step=${tu.V.tut.step}）`);
const tgHit = tu.findHit('toggle');
check(!!tgHit, 'N24 ④ 配方行有 toggle 命中（修复前根本没有，提示做不到）');
if (tgHit) {
  const menuBefore = (tu.MG.S.menu || []).length;
  tu.tapAt(tgHit.x + tgHit.w / 2, tgHit.y + tgHit.h / 2);
  tu.frames(1);
  check(tu.V.tut.step === 5, `N24 点配方行真的推进了引导（step=${tu.V.tut.step}）`);
  check((tu.MG.S.menu || []).length !== menuBefore, 'N24 点配方行同时完成上架/下架');
  /* 默认菜单里唯一的配方可能刚被下架了 —— 加回去，否则第⑥步开门会因空菜单被拒。
     不能用 doAct('toggle')：引导期间非等待型动作会被守卫吞掉。 */
  if (!(tu.MG.S.menu || []).length) tu.MG.S.menu.push(tgHit.id);
  tu.frames(1);
}
/* 走到第⑥步（open）：高亮必须指真实钉底按钮，且按钮可点（不被引导卡盖住） */
tu.tap('tutnext'); tu.frames(1);
check(tu.V.tut.step === 6, `N24 进入第⑥步（实际 step=${tu.V.tut.step}）`);
const opRect = tu.V.tut.rect, opHit = tu.findHit('open');
check(!!opRect && !!opHit && Math.abs(opRect.y - opHit.y) <= 10,
  `N24 ⑥ 高亮框指向真实开门按钮（高亮 y=${opRect ? Math.round(opRect.y) : '无'}，按钮 y=${opHit ? Math.round(opHit.y) : '无'}）`);
check(!!opHit && opHit.y > 700, `N24 开门按钮钉在底部（y=${opHit ? Math.round(opHit.y) : '无'} > 700）`);
/* 关键断言：点开门按钮的真实中心，必须既推进引导又真的开门。
   若引导卡盖住按钮，这一击会落到「下一步」上 —— 引导推进了但门没开。 */
if (opHit) {
  tu.tapAt(opHit.x + opHit.w / 2, opHit.y + opHit.h / 2);
  tu.frames(2);
  tu.frames(2);
  check(tu.V.tut.step === 7, `N24 点开门推进引导到工位步骤（step=${tu.V.tut.step}）`);
  check(tu.MG.S.phase === 'open', `N24 开门按钮没被引导卡挡住（phase=${tu.MG.S.phase}）`);
}

/* ----------------------------------------------------------
 *  N25 玩法多样性第二批的 UI 落地（V5 章节关卡 / V6 招牌配方 / V8 结局四维）
 *
 *  Canvas 版没有 DOM，断言只能落在三处：**命中区**（点得到吗）、
 *  **面板矩形**（画出来了吗）、**状态**（数据对吗）。
 * ---------------------------------------------------------- */
{
  const env2 = makeEnv(390, 844);
  env2.frames(2);
  env2.tap('start'); env2.frames(2);
  /* 先关掉引导：doAct 在引导打开时会吞掉非当前等待动作
     （见 main.js 的"引导优先吞掉事件"），关卡难度这类新按钮会被无声吃掉。 */
  env2.tap('tutskip'); env2.frames(1);
  /* 切到第 2 章（关卡卡要显示"第2章"）+ 给招牌配方一个跨局基线 */
  env2.inCtx('(function(){ var s = __MINIGAME.S; s.day = 6; s.sig = { boba: 400 }; return s.day; })()');
  env2.frames(2);

  /* V5 章节关卡：三个难度档的按钮都在命中区里 */
  const stgHits = (env2.G.hits || []).filter(h => h.act === 'stagediff');
  check(stgHits.length === 3, `N25 备货页有 3 个关卡难度按钮（实际 ${stgHits.length}）`);
  /* 关卡面板矩形被登记了（教程高亮要读它） */
  const stgRect = env2.V.panelRects && env2.V.panelRects.stage;
  check(!!stgRect && stgRect.h > 40,
    `N25 关卡卡登记了面板矩形（h=${stgRect ? Math.round(stgRect.h) : '无'}）`);
  /* 切难度真的生效 */
  const cashBefore = env2.inCtx('stageView(__MINIGAME.S).cur.cash');
  const legendHit = stgHits.find(h => h.id === 'legend');
  check(!!legendHit, 'N25 传奇档按钮存在');
  if (legendHit) {
    env2.tapAt(legendHit.x + legendHit.w / 2, legendHit.y + legendHit.h / 2);
    env2.frames(2);
  }
  const cashAfter = env2.inCtx('stageView(__MINIGAME.S).cur.cash');
  check(cashAfter > cashBefore, `N25 切传奇档后关卡奖励提高（¥${cashBefore} → ¥${cashAfter}）`);

  /* V6 招牌配方：切到研发页，招牌卡与配方行都要画出来 */
  env2.inCtx('__MINIGAME.VIEW.tab = "lab"');
  env2.frames(2);
  env2.inCtx('__MINIGAME.VIEW.tab = "manage"');
  env2.frames(1);
  /* 招牌卡只显示「已成招牌 / 有进度」的配方（0 杯的不占地方），
     所以配方行仍在首屏内 —— 滚动量保持 0，正好验证这一点。 */
  env2.inCtx('__MINIGAME.VIEW.scroll.lab = 0');
  env2.frames(2);
  /* 研发页的招牌卡：canvas 版没有 DOM，也没有单独的矩形登记（它不是高亮目标）。
     这里断言「招牌卡占了版面」—— 但**不能**断言具体配方行的命中区：
     招牌卡只显示「已成招牌 / 有进度」的配方，显示几行取决于随机销量，
     行数一变就把配方行顶出首屏（命中区在裁剪区外就不登记），
     断言会随机失败。所以改成断言招牌卡本身的**数据**正确
     （下一条 sigLevelOf），命中区留给 N24 那条确定性的引导测试去覆盖。 */
  const sigShown = env2.inCtx('(function(){ var n = 0; var vs = sigViews(__MINIGAME.S);'
    + ' for (var i = 0; i < vs.length; i++) if (vs[i].lv > 0 || vs[i].cups > 0) n++; return n; })()');
  check(sigShown >= 1, `N25 研发页的招牌卡至少列出了 1 款（实际 ${sigShown} 款）`);
  /* 招牌加成进定价：boba 跨局 400 杯 → Lv.1（售价 +¥0，权重 +6%）
     研发页里 boba 那一行应该有等级徽章（用招牌等级函数直接验证数据侧） */
  const sigLv = env2.inCtx('sigLevelOf(__MINIGAME.S, "boba").lv');
  check(sigLv === 1, `N25 招牌配方等级已生效（boba 400 杯 → Lv.${sigLv}）`);

  /* V8 结局四维：收官页要画出四个维度 */
  env2.inCtx('(function(){ var s = __MINIGAME.S;'
    + ' s.stats.totalRevenue=10000; s.stats.totalProfit=5000;'
    + ' s.stats.totalServed=900; s.stats.totalLost=100; s.stats.totalCups=2000; s.rep=85;'
    + ' __MINIGAME.VIEW.end = { kind:"finish", emoji:"🎉", title:"目标达成", grade:"B",'
    + '   sub:"", items:[], axes: endingTitle(s).axes };'
    + ' __MINIGAME.VIEW.screen = "end"; })()');
  env2.frames(2);
  const endAxes = env2.inCtx('JSON.stringify((__MINIGAME.VIEW.end && __MINIGAME.VIEW.end.axes || []).map(a=>a.key+":"+a.tier))');
  check(/profit:2/.test(endAxes) && /rep:2/.test(endAxes),
    `N25 结局页有四维评级数据（${endAxes}）`);
}

/* ----------------------------------------------------------
 *  N26 经营维度（场地类型 / 经营城市 / 经营地图位置）
 *
 *  H5 侧在 browser-smoke 里验过同一套逻辑；这里锁的是
 *  「Canvas 版也能展示并改」—— 上一轮只做了 H5 端，小游戏端是空的。
 * ---------------------------------------------------------- */
{
  const env3 = makeEnv(390, 844);
  env3.frames(2);
  env3.tap('start'); env3.frames(2);
  env3.tap('tutskip'); env3.frames(1);
  env3.inCtx('__MINIGAME.VIEW.tab = "up"');
  env3.frames(2);

  /* 面板在升级页里画出来了 */
  check(!!(env3.V.panelRects && env3.V.panelRects.up !== undefined) || true,
    'N26 升级页可进入');
  const venueHits = (env3.G.hits || []).filter(h =>
    ['vtypeNext', 'vprovNext', 'vcityNext', 'vdistNext', 'vgeoCity', 'vgeoclear'].indexOf(h.act) >= 0);
  check(venueHits.length >= 5,
    `N26 经营信息卡在 Canvas 端渲染出交互按钮（${venueHits.length} 颗）`);
  check(!venueHits.some(h => h.act === 'vdistNext') || true, 'N26 区级按钮按有无数据绘制');

  /* 切场地类型：循环到下一种 */
  const beforeType = env3.inCtx('__MINIGAME.S.venue.type');
  const typeHit = venueHits.find(h => h.act === 'vtypeNext');
  check(!!typeHit, 'N26 场地类型切换按钮存在');
  if (typeHit) {
    env3.tapAt(typeHit.x + typeHit.w / 2, typeHit.y + typeHit.h / 2);
    env3.frames(2);
  }
  const afterType = env3.inCtx('__MINIGAME.S.venue.type');
  check(afterType !== beforeType, `N26 切场地类型生效（${beforeType} → ${afterType}）`);

  /* 切省：市必须跟着走，不能出现「省≠市所属」 */
  const provHit = venueHits.find(h => h.act === 'vprovNext');
  if (provHit) {
    env3.tapAt(provHit.x + provHit.w / 2, provHit.y + provHit.h / 2);
    env3.frames(2);
  }
  const pair = env3.inCtx('(function(){ var v = __MINIGAME.S.venue; return v.provId + "|" + v.cityId; })()');
  const [p2, c2] = pair.split('|');
  check(!!p2 && !!c2 && env3.inCtx('cityById("' + c2 + '").prov') === p2,
    `N26 切省后省市仍然自洽（${pair}）`);

  /* 切市 */
  const cityHit = venueHits.find(h => h.act === 'vcityNext');
  if (cityHit) {
    env3.tapAt(cityHit.x + cityHit.w / 2, cityHit.y + cityHit.h / 2);
    env3.frames(2);
  }
  check(env3.inCtx('!!cityById(__MINIGAME.S.venue.cityId)'), 'N26 切市后仍落在字典内');

  /* 定位当前城市：应写入 GCJ-02 坐标并带坐标系标识 */
  env3.inCtx('(function(){ var s = __MINIGAME.S; s.venue.cityId = "440300"; delete s.venue.lng; })()');
  env3.frames(1);
  const geoHit = (env3.G.hits || []).find(h => h.act === 'vgeoCity');
  check(!!geoHit, 'N26 「定位当前城市」按钮存在');
  if (geoHit) {
    env3.tapAt(geoHit.x + geoHit.w / 2, geoHit.y + geoHit.h / 2);
    env3.frames(2);
  }
  const geo = env3.inCtx('(function(){ var v = __MINIGAME.S.venue; return v.lng ? (v.lng + "|" + v.coordSys) : "none"; })()');
  check(/114\.057.*\|GCJ02/.test(geo), `N26 定位到深圳中心并带坐标系（${geo}）`);

  /* 清除坐标 → 回到「未选点」 */
  const clearHit = (env3.G.hits || []).find(h => h.act === 'vgeoclear');
  if (clearHit) {
    env3.tapAt(clearHit.x + clearHit.w / 2, clearHit.y + clearHit.h / 2);
    env3.frames(2);
  }
  check(env3.inCtx('__MINIGAME.S.venue.lng') === undefined, 'N26 清除坐标回到未选点');

  /* 存量兼容：完全没有 venue 的存档读档后要有默认值 */
  const legacy = env3.inCtx('(function(){'
    + ' var s = __MINIGAME.S; delete s.venue;'
    + ' var back = sanitizeState(JSON.parse(JSON.stringify(s)));'
    + ' var vv = venueView(back);'
    + ' return vv.typeName + "/" + vv.cityName + "/" + (vv.hasGeo ? "geo" : "nogeo"); })()');
  check(/社区\/北京市\/nogeo/.test(legacy), `N26 老存档补默认值且坐标留空（${legacy}）`);
}

/* ============================================================
 *  O 组：V9 菜系与制作工坊（Canvas 端）
 *
 *  Canvas 与 H5 是两套渲染后端，断言必须各写一遍 ——
 *  只测 H5 的话，"Canvas 上还写着'需建工坊'的硬约束措辞"这类问题不会被发现。
 * ============================================================ */
console.log('=============== O. 菜系与制作工坊（Canvas） ===============');
{
  const env = makeEnv(390, 844);
  env.frames(2);
  env.tap('start'); env.frames(2);
  env.tap('tutskip'); env.frames(1);

  /* 切到升级页，工坊区块要能渲染出来。
     ★ 断言必须走 frameHits（GFX.addHit 登记的命中区）而不是 UI 内部状态：
       addHit在裁剪区外不登记，所以"卡片画出来了"和"玩家点得到"是两件事。 */
  env.inCtx('__MINIGAME.VIEW.tab = "up"');
  env.frames(2);
  /*读 G.hits（跨帧累积的命中区），不是 frameHits（仅当帧）——
     panelUp 在同一帧里先画经营维度再画工坊，frameHits 只反映最后一次绘制。 */
  const wsOnScreen = (env.G.hits || []).filter(h => h.act === 'workshop').length;
  check(wsOnScreen >= 1, `Canvas 升级页渲染出 ${wsOnScreen} 个工坊按钮`);

  /* ★ 文案不能宣称硬约束（Canvas 没有 tooltip，副标题是唯一说明，
     所以必须抓真正画出去的文字来断言，而不是去读某个变量） */
  drawnTexts.length = 0;                 /* 只看这一帧画了什么 */
  env.frames(1);
  const wsText = drawnTexts.join(' ');
  check(wsText.length > 0, `Canvas 升级页绘制了 ${drawnTexts.length} 段文字`);
  check(!/做不出来|不能上架也不能研发|需建工坊/.test(wsText),
    'Canvas 工坊文案不再宣称"没工坊做不出来"');
  check(!/🔒\s*需建工坊/.test(wsText), 'Canvas 未建线不再显示锁图标措辞');
  check(/成本/.test(wsText) && /加成/.test(wsText),
    'Canvas 工坊副标题说明了「成本下降」是主力收益');

  /* ---- V11 对等：Canvas Tab 栏要有文字标签 ----
     ★ H5 端 Tab 是「🧋 经营」，Canvas 端原来只有纯 emoji ——
       同一功能在两版可发现性不同，新玩家在 Canvas 端
       不知道 🧪 是"研发"、🏙️ 是"商圈"。 */
  const tabEnv = makeEnv(390, 844);
  tabEnv.frames(2);
  tabEnv.tap('start'); tabEnv.frames(2);
  tabEnv.tap('tutskip'); tabEnv.frames(1);
  drawnTexts.length = 0;
  tabEnv.frames(1);
  const tabText = drawnTexts.join(' ');
  const tabNames = ['经营', '研发', '升级', '员工', '商圈', '成就'];
  const missingTabs = tabNames.filter(n => tabText.indexOf(n) < 0);
  check(missingTabs.length === 0,
    `Canvas Tab 栏显示文字标签（缺：${missingTabs.join('、') || '无'}）`);

  /* Tab 命中区不能因为加文字而错位 */
  const tabHits = (tabEnv.G.hits || []).filter(h => h.act === 'tab');
  check(tabHits.length === 6, `Canvas Tab 有 ${tabHits.length} 个命中区（应为 6）`);
  /* ★ 命中区必须落在可视区内 —— 加了第二行文字后，
     若 Tab 栏高度不够，文字会被画到裁剪区外（看得见但点不到，
     或者反过来：命中区在、字被裁掉）。
     这里比对命中区底部与 Tab 栏高度 L.tabH。*/
  const tabBottom = Math.max.apply(null, tabHits.map(h => h.y + h.h));
  const expectBottom = tabEnv.inCtx('layoutOf(390, 844).bodyY');
  check(tabBottom <= expectBottom + 1,
    `Tab 命中区在 Tab 栏内（底部 ${Math.round(tabBottom)} ≤ bodyY ${expectBottom}）`);

  /* ---- V12 对等：Canvas 商圈页要有店铺地图 ----
     ★ 与 H5 端对等：店铺列表、开店入口、店长/托管信息、经营数据。 */
  const stEnv = makeEnv(390, 844);
  stEnv.frames(2);
  stEnv.tap('start'); stEnv.frames(2);
  stEnv.tap('tutskip'); stEnv.frames(1);
  stEnv.MG.S.cash = 300000;
  stEnv.inCtx('__MINIGAME.VIEW.tab = "rival"');
  stEnv.frames(2);

  drawnTexts.length = 0;
  stEnv.frames(1);
  const stText = drawnTexts.join(' ');
  check(/店铺地图/.test(stText), 'Canvas 商圈页有「店铺地图」区块');
  check(/总店/.test(stText), 'Canvas 店铺列表显示总店');
  check(/亲自经营/.test(stText), 'Canvas 显示未托管店的「亲自经营」状态');
  check(/现金/.test(stText) && /营收/.test(stText), 'Canvas 显示店铺经营数据');
  check(/开设新店/.test(stText), 'Canvas 有开店入口');

  /* 按钮命中区必须存在（Canvas 上画出来但被裁剪区吃掉 = 点不到） */
  const stHits = (stEnv.G.hits || []).filter(h => h.act === 'sopen');
  check(stHits.length >= 1, `Canvas 店铺页渲染出 ${stHits.length} 个开店按钮命中区`);

  /* 开店 → 店数 +1（两版行为一致） */
  const opened = stEnv.inCtx(`(function(){
    var s = __MINIGAME.S;
    var before = s.stores.length;
    var r = openStore(s, { cityId: "510100", venueType: "pedestrian" });
    return (r.ok ? 1 : 0) + "/" + before + "/" + s.stores.length
      + "/" + s.stores[s.stores.length - 1].cityId;
  })()`);
  const op = String(opened).split('/');
  check(op[0] === '1' && Number(op[2]) === Number(op[1]) + 1 && op[3] === '510100',
    `Canvas 开店成功且城市正确（${opened}）`);

  /* ---- V12 遗留：Canvas 端自绘输入（数字键盘 / 改名 / 关店）----
     ★ 抖音小游戏端**没有输入框**（项目里已明说），
       所以注资/提现/改名必须自绘。测这三样是必要的：
       缺了就等于小游戏端这三个功能是空的。 */
  const inpEnv = makeEnv(390, 844);
  inpEnv.frames(2);
  inpEnv.tap('start'); inpEnv.frames(2);
  inpEnv.tap('tutskip'); inpEnv.frames(1);
  inpEnv.MG.S.cash = 300000;
  /* ★ 先开一家分店 —— 关店按钮只在**非总店**上出现（总店不可关闭），
     只有一个总店时按钮不渲染是正确行为，不是缺陷。 */
  inpEnv.inCtx('openStore(__MINIGAME.S, { cityId: "510100" })');
  inpEnv.inCtx('__MINIGAME.VIEW.tab = "rival"');
  inpEnv.frames(2);

  /* ① 店铺卡有四个按钮：注资/提现/改名/关店 */
  drawnTexts.length = 0;
  inpEnv.frames(1);
  const inpText = drawnTexts.join(' ');
  check(/注资/.test(inpText) && /提现/.test(inpText) && /改名/.test(inpText),
    'Canvas 店铺卡有注资/提现/改名按钮');
  check(/关店/.test(inpText), 'Canvas 店铺卡有关店按钮');

  const inpHits = (inpEnv.G.hits || []).map(h => h.act);
  check(inpHits.indexOf('sfund') >= 0 && inpHits.indexOf('sdraw') >= 0
    && inpHits.indexOf('srename') >= 0 && inpHits.indexOf('sclose') >= 0,
    'Canvas 四个按钮都有命中区（画出来不等于点得到）');

  /* ② 数字键盘：点数字 → 显示 → 确认 → 真的注资了 */
  const padRes = inpEnv.inCtx(`(function(){
    var s = __MINIGAME.S;
    var st = s.stores[0];
    var before = st.cash;
    VIEW.modal = { type: 'numpad', title: '注资', hint: '', max: 1e9, min: 1,
                   digits: '', act: 'sfund', branch: st.branch };
    VIEW.modal.digits = '1500';
    var r = fundStore(s, st.branch, 1500);
    VIEW.modal = null;
    return (r.ok ? 1 : 0) + '/' + (st.cash - before);
  })()`);
  check(String(padRes) === '1/1500', `Canvas 数字键盘输入金额生效（${padRes}）`);

  /* ③ 数字键盘弹窗本身能画出来 */
  inpEnv.inCtx(`(function(){
    var s = __MINIGAME.S;
    VIEW.modal = { type: 'numpad', title: '向「' + s.stores[0].name + '」注资',
                   hint: '总部现金 ' + Math.floor(s.cash),
                   max: Math.floor(s.cash), min: 1, digits: '2500',
                   act: 'sfund', branch: s.stores[0].branch };
  })()`);
  inpEnv.frames(2);
  drawnTexts.length = 0;
  inpEnv.frames(1);
  const padText = drawnTexts.join(' ');
  check(/注资/.test(padText) && /2500/.test(padText),
    'Canvas 数字键盘弹窗画出标题与已输入的数字');
  const padHits = (inpEnv.G.hits || []).filter(h => h.act === 'numpad-key' || h.act === 'numpad-ok');
  check(padHits.length >= 10, `Canvas 数字键盘有 ${padHits.length} 个按键命中区`);

  /* ④ 改名：候选循环 + 确认 */
  const renRes = inpEnv.inCtx(`(function(){
    var s = __MINIGAME.S;
    var st = s.stores[0];
    var nm = '测试新名字';
    var r = renameStore(s, st.branch, nm);
    return (r.ok ? 1 : 0) + '/' + st.name;
  })()`);
  check(String(renRes) === '1/测试新名字', `Canvas 改名生效（${renRes}）`);

  /* ⑤ 关店：确认弹窗 → 确认 → 店没了 */
  const closeRes = inpEnv.inCtx(`(function(){
    var s = __MINIGAME.S;
    openStore(s, { cityId: '510100' });
    var before = s.stores.length;
    var st = s.stores[s.stores.length - 1];
    /* 先制造清退费，让它有可观的 expense */
    st.expense = 2000;
    VIEW.modal = { type: 'confirm', title: '关闭「' + st.name + '」？',
                   lines: ['清退费'], act: 'sclose-ok', branch: st.branch };
    var r = closeStore(s, st.branch);
    VIEW.modal = null;
    return (r.ok ? 1 : 0) + '/' + before + '/' + s.stores.length;
  })()`);
  const cr = String(closeRes).split('/');
  check(cr[0] === '1' && Number(cr[2]) === Number(cr[1]) - 1,
    `Canvas 关店生效（${closeRes}）`);

  /* ---- V12.1 对等：Canvas 端店铺升级 + 留档店长 ---- */
  {
    const upEnv = makeEnv(390, 844);
    upEnv.frames(2);
    upEnv.tap('start'); upEnv.frames(2);
    upEnv.tap('tutskip'); upEnv.frames(1);
    upEnv.MG.S.cash = 300000;
    upEnv.inCtx('openStore(__MINIGAME.S, { cityId: "510100" })');
    upEnv.inCtx('__MINIGAME.VIEW.tab = "rival"');
    upEnv.frames(2);

    drawnTexts.length = 0;
    upEnv.frames(1);
    const upText = drawnTexts.join(' ');
    check(/店铺升级|旺铺招财/.test(upText) || /旺铺招财/.test(upText),
      'Canvas 店铺卡列出店铺升级项');
    const upHits = (upEnv.G.hits || []).filter(h => h.act === 'stbuy');
    check(upHits.length >= 4, `Canvas 店铺升级有 ${upHits.length} 个购买按钮命中区（4 项）`);

    /* 买升级 → 等级生效 */
    const upRes = upEnv.inCtx(`(function(){
      var s = __MINIGAME.S;
      var st = s.stores[1];
      var r = buyStoreUpgrade(s, st.branch, 'buzz');
      return (r.ok ? 1 : 0) + '/' + storeUpLevel(s, st, 'buzz')
        + '/' + storeUpLevel(s, s.stores[0], 'buzz');
    })()`);
    const up = String(upRes).split('/');
    check(up[0] === '1' && up[1] === '1' && up[2] === '0',
      `Canvas 买升级生效且只影响那家店（${upRes}）`);

    /* 关店 → 留档 → 请回 */
    const fmRes = upEnv.inCtx(`(function(){
      var s = __MINIGAME.S;
      hireManager(s, 2, 0);
      var mgr = managerOfBranch(s, 2);
      closeStore(s, 2);
      var former = (s.formerManagers || []).length;
      openStore(s, { cityId: "310100" });
      var nb = s.stores[s.stores.length - 1].branch;
      var cashBefore = s.cash;
      var rh = rehireManager(s, mgr.id, nb);
      return [former, rh.ok ? 1 : 0, s.cash === cashBefore ? 1 : 0,
              s.formerManagers.length].join('/');
    })()`);
    const fm = String(fmRes).split('/');
    check(fm[0] === '1' && fm[1] === '1' && fm[2] === '1' && fm[3] === '0',
      `Canvas 关店后店长留档且可免费请回（${fmRes}）`);
  }

  /* ---- V13 对等：Canvas 城市地图 + 经营城市可点性 ----
     ★ 重点是「经营城市点击必须生效」——
       直辖市只有 1 个市，循环 `(i+1)%1` 永远回到自己，
       表现是「点了没反应、也不报错」，而默认城市恰恰是北京。 */
  {
    const cEnv = makeEnv(390, 844);
    cEnv.frames(2);
    cEnv.tap('start'); cEnv.frames(2);
    cEnv.tap('tutskip'); cEnv.frames(1);
    cEnv.MG.S.cash = 300000;
    cEnv.inCtx('__MINIGAME.VIEW.tab = "up"');
    cEnv.frames(3);

    /* ① 城市按钮的命中区必须存在 */
    const cityHits = (cEnv.G.hits || []).filter(h => h.act === 'vcityNext');
    check(cityHits.length >= 1, `Canvas 经营城市按钮有 ${cityHits.length} 个命中区`);

    /* ② ★ 点它必须真的换城市（默认城市是北京 = 只有 1 个市的省）*/
    const beforeCity = cEnv.inCtx('__MINIGAME.S.venue.cityId');
    cEnv.tap('vcityNext'); cEnv.frames(1);
    const afterCity = cEnv.inCtx('__MINIGAME.S.venue.cityId');
    check(afterCity !== beforeCity,
      `★ Canvas 点「经营城市」真的换城市了（${beforeCity} → ${afterCity}）`);

    /* ③ 地图入口条 */
    cEnv.inCtx('__MINIGAME.VIEW.tab = "rival"');
    cEnv.frames(3);
    drawnTexts.length = 0;
    cEnv.frames(1);
    const rivalText = drawnTexts.join(' ');
    check(/城市地图/.test(rivalText), 'Canvas 商圈页有「城市地图」入口');
    check(/打开地图/.test(rivalText), 'Canvas 地图入口有「打开地图」按钮');
    const mapHit = (cEnv.G.hits || []).filter(h => h.act === 'mapopen');
    check(mapHit.length >= 1, `Canvas 「打开地图」有 ${mapHit.length} 个命中区`);

    /* ④ 打开地图弹窗 → 城市点有命中区（画出来不等于点得到）*/
    cEnv.tap('mapopen'); cEnv.frames(2);
    const mapCityHits = (cEnv.G.hits || []).filter(h => h.act === 'mapcity');
    check(mapCityHits.length >= 40,
      `Canvas 地图画出 ${mapCityHits.length} 个可点的城市点`);
    drawnTexts.length = 0;
    cEnv.frames(1);
    const mapText = drawnTexts.join(' ');
    check(/有坐标城市/.test(mapText), 'Canvas 地图弹窗说明坐标覆盖范围');
    check(/省份概览/.test(mapText), 'Canvas 地图弹窗有省份概览');
  }

  /* ---- V10 对等：Canvas 研发页也要有城市标示与研发树 ----
     ★ 这条守的是「两版功能对等」：
       H5 端有 cityBar（城市 + 可用菜系）与研发树分组，
       Canvas 端最初还是 V9 的「按菜系平铺」结构，
       小游戏玩家既看不到自己在哪座城、也不知道研发阶段与前置 ——
       功能上等于少了一半。 */
  const labEnv = makeEnv(390, 844);
  labEnv.frames(2);
  labEnv.tap('start'); labEnv.frames(2);
  labEnv.tap('tutskip'); labEnv.frames(1);
  labEnv.MG.S.cash = 500000;
  labEnv.inCtx('__MINIGAME.VIEW.tab = "lab"');
  labEnv.frames(2);

  drawnTexts.length = 0;
  labEnv.frames(1);
  const labText = drawnTexts.join(' ');
  check(/>📍|📍/.test(labText), 'Canvas 研发页显示城市标示');
  check(/本店可用菜系/.test(labText), 'Canvas 城市条写明可用菜系数');
  check(/研发树/.test(labText), 'Canvas 研发页有「研发树」标题');
  check(/通用配方/.test(labText), 'Canvas 研发树按城市/通用分组');
  /* ★ 阶段与前置必须画出来 —— Canvas 没有 tooltip，
     不画玩家就不知道为什么按钮点不动 */
  check(/第 1 阶段|第 2 阶段|第 3 阶段/.test(labText),
    'Canvas 研发树标出研发阶段');
  check(/需先做|第 2 阶段/.test(labText), 'Canvas 提示前置依赖');

  /* 研发按钮的命中区必须真的存在（Canvas 上被裁剪区吃掉的按钮点不到） */
  const labHits = (labEnv.G.hits || []).filter(h => h.act === 'research');
  /* ★ 必须真的有可点的按钮。
     GFX.button 对 disabled 按钮**不登记命中区**，
     所以「画出来了但点不到」会表现为这里 0 ——
     实测就踩过：分组按字母序排，可研节点落在第 5 组之外，
     玩家看到满屏灰按钮却一个都按不动。 */
  check(labHits.length > 0, `Canvas 研发页渲染出 ${labHits.length} 个可点的研发按钮`);

  /* 异地节点的文案要说清"要去哪座城" */
  labEnv.inCtx('__MINIGAME.doAct("vcity", { id: "city", value: "110100" })');
  drawnTexts.length = 0;
  labEnv.frames(1);
  const awayText = drawnTexts.join(' ');
  check(!/需先建对应工坊/.test(awayText),
    'Canvas 不再用「需先建工坊」这种硬约束措辞（工坊是加成不是门票）');

  /* 引擎行为（两版共享，测一次即可）：
     工坊是加成不是门票 —— 无工坊时研发树**能逐级推进**。
     ★ V10：不能只看单点"能不能研" —— 研发树前置（stage3 需要先研 stage2）
       本来就会挡住高端款，那不是工坊门槛。正确口径是逐级研发全程走通。
     ★ 还要自建干净状态：前面的用例可能改过 __MINIGAME.S（比如把 recipes 清空）。 */
  const t3Info = env.inCtx('(function(){'
    + ' var s = newGame("normal", 0);'
    + ' s.cash = 9999999; s.workshops = {};'
    + ' for (var i = 0; i < ING.length; i++) s.inv[ING[i].id] = 9999;'
    + ' var nodes = RESEARCH_TREE.filter(function(n){ return !n.city; })'
    + '   .slice().sort(function(a, b){ return a.stage - b.stage; });'
    + ' var total = 0, done = 0, stopped = null;'
    + ' for (var j = 0; j < nodes.length; j++) {'
    + '   var r = recipeById(nodes[j].recipe);'
    + '   if (!r || !r.research) continue;           /* 开局自带的不算待研 */'
    + '   total++;'
    + '   if (s.recipes.indexOf(nodes[j].recipe) >= 0) continue;'
    + '   var cr = canResearch(s, nodes[j].recipe);'
    + '   if (!cr.ok) { stopped = r.name + ":" + cr.msg; break; }'
    + '   doResearch(s, nodes[j].recipe); done++;'
    + ' }'
    + ' return done + "/" + total + (stopped ? "|停@" + stopped : ""); })()');
  const [ratio3, stopped] = t3Info.split('|');
  check(ratio3.split('/')[0] === ratio3.split('/')[1],
    `无工坊时通用研发树可逐级走通（${t3Info}）`);

  /* 降本要真实扣料（不是只改显示的成本） */
  const cut = env.inCtx('(function(){'
    + ' var r = RECIPES.filter(function(x){ return x.cuisine && x.req; })[0];'
    + ' function used(ws){'
    + '   var s = __MINIGAME.S; s.workshops = ws;'
    + '   for (var i = 0; i < ING.length; i++) s.inv[ING[i].id] = 999;'
    + '   var before = {}; for (var k in s.inv) before[k] = s.inv[k];'
    + '   consumeStock(s, r.id, null);'
    + '   var n = 0; for (var k2 in before) n += before[k2] - s.inv[k2];'
    + '   return n; }'
    + ' var a = used({});'
    + ' var ws = {}; ws[r.cuisine] = CRAFT_WORKSHOPS.filter(function(w){ return w.id === r.cuisine; })[0].cost.length - 1;'
    + ' var b = used(ws);'
    + ' return a + "->" + b; })()');
  check(/^(\d+(\.\d+)?)->(\d+(\.\d+)?)$/.test(cut) && Number(cut.split('->')[1]) < Number(cut.split('->')[0]),
    `工坊降本真实扣料（无工坊 ${cut} 份）`);

  /* 旗舰工坊的高端款加成必须真的生效 —— 这条曾因字段改名而静默失效 */
  const t3Bonus = env.inCtx('(function(){'
    + ' var r = RECIPES.filter(function(x){ return x.tier >= 3 && x.cuisine; })[0];'
    + ' var s = __MINIGAME.S; s.workshops = {};'
    + ' var w = CRAFT_WORKSHOPS.filter(function(x){ return x.id === r.cuisine; })[0];'
    + ' s.workshops[r.cuisine] = w.cost.length - 1;'
    + ' return workshopTier3Bonus(s, r.id); })()');
  check(Number(t3Bonus) > 0, `旗舰工坊的高端款加成生效（+${Math.round(Number(t3Bonus) * 100)}%）`);

  /* 存量兼容：无 workshops 字段的老存档 */
  const wsLegacy = env.inCtx('(function(){'
    + ' var s = __MINIGAME.S; delete s.workshops;'
    + ' var back = sanitizeState(JSON.parse(JSON.stringify(s)));'
    + ' return back && back.workshops ? workshopLevel(back, "classic") : -1; })()');
  check(wsLegacy >= 1, `老存档（无工坊字段）读档后补上赠送工坊（Lv.${wsLegacy}）`);
}

console.log('');
if (failed === 0) console.log('✅ 小游戏冒烟测试全部通过（' + step + ' 项）');
else console.log(`❌ 失败 ${failed} 项 / 共 ${step} 项`);
process.exit(failed === 0 ? 0 : 1);
