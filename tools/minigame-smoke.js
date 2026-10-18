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
check(V.modal && V.modal.type === 'report', '图标按钮可打开经营报表');
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

/* 裁剪是否真的生效：滚动前「开门营业」在屏幕外，就不该能被点到 */
check(!small.findHit('open'),
  '小屏上未滚动时，屏幕外的「开门营业」不可点（裁剪生效）');

small.touchStart(180, 500);
small.touchDrag(180, 300);
small.touchEnd(180, 300);
small.frames(1);
check(small.V.scroll.manage > 0, `小屏经营面板可滚动（偏移 ${Math.round(small.V.scroll.manage)}px）`);
check(!!small.findHit('open'), '滚动后「开门营业」进入视野且可点（命中区跟随滚动）');

/* 滚动位移后命中区必须跟着移动，否则会出现「点了没反应/点错按钮」 */
const beforeY = small.findHit('open').y;
/* 反向小幅拖 40px：scroll 从 90 回到 50，按钮应跟着往上移回 40px。
   （故意不用大幅拖拽 —— 那样会被夹到 0，坐标反而回到原处，测不出位移。） */
small.touchStart(180, 300);
small.touchDrag(180, 340);
small.touchEnd(180, 340);
small.frames(1);
const afterHit = small.findHit('open');
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
