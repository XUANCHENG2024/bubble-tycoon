'use strict';
/* ============================================================
 *  抖音平台能力接入层
 *
 *  对应平台提审清单里的五项能力：
 *    ③ 侧边栏复访 —— 必接。不接会被审核拒绝，且平台明确要求「必须使用
 *                     tt.navigateToScene 调用」。
 *    ② 添加到桌面 —— 有广告投放的小游戏不接，拿不到广告金优惠政策。
 *    ④ 订阅消息   —— 同上。
 *    ⑤ 广告（插屏 / 激励）—— 需软著资质。
 *    ① 内购       —— 需版号资质 + 已开通虚拟支付。
 *    ⑥ 分享       —— 无需后台配置，宿主支持就显示。
 *    ⑦ 每日挑战日榜 —— 无需后台配置（分区标识自定义），默认开。
 *                    用 tt.setImRankData / tt.getImRankList 这对原生 API，
 *                    不碰开放数据域 —— 详见 ⑦ 那一节的注释。
 *
 *  三条贯穿全文件的原则：
 *
 *  1. 没有 tt 就全部 no-op。
 *     浏览器预览页与 Node 冒烟测试里不能冒出半个报错，否则本地验证会被
 *     一堆假故障淹没，真出问题反而看不出来。
 *
 *  2. 受后台配置约束的能力（广告位 id / 订阅模板 id / 版号）一律走开关。
 *     没配就自动隐藏入口 —— 宁可不显示，也不要「点了没反应」。
 *
 *  3. 必须由用户点击触发的 API（tt.addShortcut / tt.requestSubscribeMessage）
 *     只能在触摸回调里同步调用。本作的 doAct 正是由 tt.onTouchEnd 直接驱动
 *     （platform.js → onUp → doAct），所以这里绝不能包 setTimeout / Promise，
 *     否则真机会报 must be invoked by user gesture。
 * ============================================================ */

var CAPS = (function () {
  var isTT = (typeof tt !== 'undefined');

  /* ============================================================
   *  配置：需要你在「抖音开放平台 → 小游戏控制台」配好后填进来
   *
   *  没配的项保持默认即可，对应入口会自动隐藏，不会影响其余玩法。
   * ============================================================ */
  var CFG = {
    /* ③ 侧边栏复访：平台必接，默认开。宿主不支持时会自动隐藏入口。 */
    sidebar: true,

    /* ② 添加到桌面：无需后台配置，默认开。 */
    shortcut: true,

    /* ④ 订阅消息模板 id：控制台「运营 → 运营能力 → 订阅消息」获取。
       平台限制一次最多传 3 个，且一次性模板与长期模板不能混用。 */
    subscribeTmplIds: [],

    /* ⑤ 广告位 id：控制台「运营 → 变现 → 广告位」新建后获取。
       注意：广告位默认是「未启用」状态，必须手动切到启用才拉得到广告。 */
    rewardedAdUnitId: '',
    interstitialAdUnitId: '',
    interstitialCooldown: 120,   /* 插屏最小间隔（秒）：太密会被玩家当成打扰 */
    adDailyLimit: 3,             /* 激励视频每日可领次数 */

    /* ① 内购：需要版号 + 已开通虚拟支付。没有版号请保持 false。
       iapGoods 的 qty 是「游戏币数量」，必须与控制台设置的币价对齐，
       否则下单会被拒（平台校验 数量 × 单价 = 限定价格等级）。 */
    iap: false,
    iapZoneId: '1',

    /* ⑥ 分享：无需后台配置，宿主支持就显示入口。
       抖音的分享卡片取的是 screenshot 或 imageUrl，这里只给标题与文案。 */
    share: true,
    /* {worth} 会被 money() 的结果替换（自带 ¥），别在这里再加一个 ¥ */
    shareTitle: '我在奶茶星球第 {day} 天做到了净资产 {worth}，你能超过我吗？',
    shareDesc: '🧋 低价囤货、招人扩产能、连点加速出杯 —— 来开一家奶茶店',

    /* ⑦ 每日挑战日榜
       与微信那套不同：抖音这里不需要在后台把 key 配成「排行榜标识」，
       分区标识（zoneId）直接自定义即可，所以默认就是开的。
       宿主不支持时两个 API 都不存在，会自动降级到本机记录。 */
    rank: true,
    /* 每个小游戏除 default / test 外最多 10 个分区，
       「每日挑战」单独占一个，不与默认分区混用。 */
    rankZoneId: 'daily',
    /* day / week / month / all。日榜正好对应「全网同一天打同一局」 */
    rankType: 'day',
    rankTitle: '每日挑战 · 净资产榜',
    /* 分数后缀。净资产单位是元，标题里已经写了，这里留空免得显示成「38402 分」 */
    rankSuffix: '',
    iapGoods: [
      /* 示例，按需改：
      { id: 'pearl60',  name: '60 珍珠',  qty: 60,  price: 600,  grantCash: 1200, grantIng: 60 },
      { id: 'pearl300', name: '300 珍珠', qty: 300, price: 2800, grantCash: 8000, grantIng: 200 },
      */
    ],
  };

  /* 每日限额的落盘键。刻意独立于存档槽 ——
     换槽/删档不该让玩家「今天又能领一次」。 */
  var CAPS_KEY = 'bubbleTycoonCapsV1';
  var today = { key: '', sidebarClaimed: false, adCount: 0 };
  var lastInter = 0;

  function loadToday() {
    var k = todayKey();
    if (today.key === k) return today;
    var raw = {};
    try { raw = JSON.parse(storageGet(CAPS_KEY) || '{}') || {}; } catch (e) { raw = {}; }
    today = {
      key: k,
      sidebarClaimed: raw.key === k ? !!raw.sidebarClaimed : false,
      adCount: raw.key === k ? num(raw.adCount, 0) : 0,
    };
    return today;
  }
  function saveToday() {
    try { storageSet(CAPS_KEY, JSON.stringify(today)); } catch (e) { /* 限额丢失不影响玩 */ }
  }

  /* ============================================================
   *  ③ 侧边栏复访
   * ============================================================ */
  var scene = { supported: false, from: false, launchFrom: '', location: '' };

  /**
   * 官方口径：从侧边栏进入时，onShow 回调里 launch_from='homepage'、
   * location='sidebar_card'。
   * 必须用 onShow 的**最新**返回值判断 —— 用启动参数判断的话，
   * 玩家从侧边栏热启动回来时判定不到，会「明明按要求进了却领不到奖」。
   */
  function onShowInfo(op) {
    op = op || {};
    scene.launchFrom = String(op.launch_from || '');
    scene.location = String(op.location || '');
    scene.from = scene.launchFrom === 'homepage' && scene.location === 'sidebar_card';
  }

  function checkScene() {
    scene.supported = false;
    if (!isTT || !CFG.sidebar || typeof tt.checkScene !== 'function') return;
    try {
      tt.checkScene({
        scene: 'sidebar',
        success: function (r) { scene.supported = !!(r && r.isExist); },
        fail: function () { scene.supported = false; },
      });
    } catch (e) { scene.supported = false; }
  }

  function init() {
    if (!isTT) return;
    /* onShow 必须在启动时就挂上：官方原话是「若时机太晚收不到回调，
       会导致用户按操作从侧边栏返回游戏后无法领取奖励，引发用户投诉」。
       放在 bundle 加载期最保险（等价于 game.js 运行时机）。 */
    if (typeof tt.onShow === 'function') tt.onShow(function (op) { onShowInfo(op); });
    if (typeof tt.getLaunchOptionsSync === 'function') {
      try { onShowInfo(tt.getLaunchOptionsSync()); } catch (e) { /* 拿不到就算了 */ }
    }
    try {
      var si = tt.getSystemInfoSync() || {};
      sysPlatform = String(si.platform || '').toLowerCase();
    } catch (e) { sysPlatform = ''; }
    checkScene();
    if (CFG.shortcut) checkShortcut();
    /* ⑦ 登录态预热：放在这里而不是等到上报/拉榜时才补，
       是为了让 openRank 在触摸回调里能同步走到 getImRankList。 */
    if (CFG.rank) ensureLogin();
  }

  function sidebarOn() { return isTT && CFG.sidebar && scene.supported; }
  function fromSidebar() { return sidebarOn() && scene.from; }
  function sidebarClaimed() { return loadToday().sidebarClaimed; }

  /** 领取侧边栏复访奖励。返回是否发放成功（重复领取会返回 false） */
  function claimSidebar() {
    var t = loadToday();
    if (!fromSidebar() || t.sidebarClaimed) return false;
    t.sidebarClaimed = true;
    saveToday();
    return true;
  }

  /** 跳转侧边栏。onOk(ok, reason)：reason = 'notsupported' 真不支持 /
      'cancelled' 玩家取消 / 'failed' 接口报错。以前三种都只说"环境不支持"，
      玩家明明是自己按了返回，却被提示成游戏问题。 */
  function gotoSidebar(onOk) {
    if (!sidebarOn() || typeof tt.navigateToScene !== 'function') {
      if (onOk) onOk(false, 'notsupported');
      return false;
    }
    try {
      tt.navigateToScene({
        scene: 'sidebar',
        success: function (r) {
          /* 成功回调里 code=0 表示跳转成功，1 表示用户取消 */
          var cancelled = !!(r && r.code === 1);
          if (onOk) onOk(!cancelled, cancelled ? 'cancelled' : undefined);
        },
        fail: function () { if (onOk) onOk(false, 'failed'); },
      });
      return true;
    } catch (e) { if (onOk) onOk(false, 'failed'); return false; }
  }

  /* ============================================================
   *  ② 添加到桌面
   * ============================================================ */
  var shortcutAdded = null;   /* null = 还没问出来 */

  function checkShortcut() {
    if (!isTT || !CFG.shortcut || typeof tt.checkShortcut !== 'function') {
      shortcutAdded = false; return;
    }
    try {
      tt.checkShortcut({
        success: function (r) { shortcutAdded = !!(r && r.exist); },
        fail: function () { shortcutAdded = false; },
      });
    } catch (e) { shortcutAdded = false; }
  }

  /** 只能在触摸回调里同步调用，见文件头第 3 条 */
  function addShortcut(onOk) {
    if (!isTT || !CFG.shortcut || typeof tt.addShortcut !== 'function') {
      if (onOk) onOk(false); return false;
    }
    try {
      tt.addShortcut({
        success: function () { shortcutAdded = true; if (onOk) onOk(true); },
        fail: function () { if (onOk) onOk(false); },
      });
      return true;
    } catch (e) { if (onOk) onOk(false); return false; }
  }

  /* ============================================================
   *  ④ 订阅消息
   * ============================================================ */
  function subscribe(onOk) {
    var ids = (CFG.subscribeTmplIds || []).slice(0, 3);
    if (!isTT || !ids.length || typeof tt.requestSubscribeMessage !== 'function') {
      if (onOk) onOk(false); return false;
    }
    try {
      tt.requestSubscribeMessage({
        tmplIds: ids,
        success: function (r) {
          /* 两种返回形态都要认：
             新版本把结果塞在 templateSettings 里，老版本直接挂在返回值上。 */
          var got = false;
          var set = r && r.templateSettings;
          if (set) {
            for (var k in set) {
              var v = set[k];
              if (String(v && v.status ? v.status : v) === 'accept') got = true;
            }
          } else if (r) {
            for (var k2 in r) if (String(r[k2]) === 'accept') got = true;
          }
          if (onOk) onOk(got);
        },
        fail: function () { if (onOk) onOk(false); },
      });
      return true;
    } catch (e) { if (onOk) onOk(false); return false; }
  }

  /* ============================================================
   *  ⑤ 广告
   * ============================================================ */
  var rewarded = null;

  /** 兜住 show() 的返回值：老版本返回 undefined，直接 .catch 会炸 */
  function thenable(p, onFail) {
    if (p && typeof p.catch === 'function') p.catch(function () { onFail(); });
  }

  function ensureRewarded() {
    if (!isTT || !CFG.rewardedAdUnitId) return null;
    if (typeof tt.createRewardedVideoAd !== 'function') return null;
    if (rewarded) return rewarded;
    try {
      rewarded = tt.createRewardedVideoAd({ adUnitId: CFG.rewardedAdUnitId });
    } catch (e) { rewarded = null; return null; }
    if (!rewarded) return null;
    try {
      /* 拉不到广告就把实例丢掉，下次重造 —— 否则会一直 show 一个空实例 */
      rewarded.onError(function () { rewarded = null; });
      rewarded.load();
    } catch (e) { /* 有些版本没有 load()，show() 会自己拉 */ }
    return rewarded;
  }

  /** 播激励视频。onEnd(ok, reason)：ok=false 时 reason 说明是哪种失败 ——
      调用方要按原因给文案，不能一律说"环境不支持"（拉取失败 / 用户中途关掉 /
      今天次数用完是三回事，混成一句玩家会以为游戏坏了）。 */
  function showRewarded(onEnd) {
    if (!isTT || !CFG.rewardedAdUnitId) { if (onEnd) onEnd(false, 'unconfigured'); return false; }
    if (adLeft() <= 0) { if (onEnd) onEnd(false, 'exhausted'); return false; }
    var ad = ensureRewarded();
    if (!ad) { if (onEnd) onEnd(false, 'loadfail'); return false; }
    var done = false;
    var finish = function (ok, why) { if (done) return; done = true; if (onEnd) onEnd(ok, why); };
    try {
      /* 官方：每个激励实例只能 show 一次，播完即释放，必须重新创建 */
      ad.onClose(function (res) {
        rewarded = null;
        /* isEnded===false = 用户中途关掉；其它情况算看完（含正常播完） */
        finish(!(res && res.isEnded === false), res && res.isEnded === false ? 'aborted' : undefined);
      });
      thenable(ad.show(), function () { rewarded = null; finish(false, 'loadfail'); });
    } catch (e) { rewarded = null; finish(false, 'loadfail'); }
    return true;
  }

  function adLeft() {
    var t = loadToday();
    return Math.max(0, num(CFG.adDailyLimit, 3) - num(t.adCount, 0));
  }
  function markAd() { var t = loadToday(); t.adCount = num(t.adCount, 0) + 1; saveToday(); }

  /** 插屏广告：只在自然断点的位置调（打烊结算后），并带冷却 */
  function showInterstitial() {
    if (!isTT || !CFG.interstitialAdUnitId) return false;
    if (typeof tt.createInterstitialAd !== 'function') return false;
    var now = Date.now() / 1000;
    if (now - lastInter < num(CFG.interstitialCooldown, 120)) return false;
    lastInter = now;
    try {
      var ad = tt.createInterstitialAd({ adUnitId: CFG.interstitialAdUnitId });
      if (!ad) return false;
      thenable(ad.show(), function () { /* 拉不到就静默跳过，不打扰玩家 */ });
      return true;
    } catch (e) { return false; }
  }

  /* ============================================================
   *  ① 内购
   * ============================================================ */
  var sysPlatform = '';

  function iapList() { return (CFG.iap && isTT) ? (CFG.iapGoods || []) : []; }

  /**
   * 下单。Android / PC 走 tt.requestGamePayment，iOS 走 tt.openAwemeCustomerService
   * （官方示例就是这两个分支）。
   * 注意：金额与数量的合法性由后台配置决定，前端只负责如实透传。
   */
  function pay(goods, onOk) {
    if (!goods || !CFG.iap || !isTT) { if (onOk) onOk(false); return false; }
    var hasPay = typeof tt.requestGamePayment === 'function';
    var hasIos = typeof tt.openAwemeCustomerService === 'function';
    if (!hasPay && !hasIos) { if (onOk) onOk(false); return false; }

    /* customId 必须唯一，否则平台会拒单；
       它也会出现在服务端支付回调里，用来对账。 */
    var order = 'bt' + Date.now() + '' + Math.floor(Math.random() * 1000);
    var ios = sysPlatform === 'ios' && hasIos;
    try {
      if (ios) {
        tt.openAwemeCustomerService({
          zoneId: CFG.iapZoneId || '1',
          customId: order,
          goodsId: goods.id,
          goodType: 3,
          orderAmount: num(goods.price, 0),
          goodName: String(goods.name || '').slice(0, 10),
          extraInfo: JSON.stringify({ goods: goods.id, qty: num(goods.qty, 0) }),
          success: function () { if (onOk) onOk(true); },
          fail: function () { if (onOk) onOk(false); },
        });
      } else {
        tt.requestGamePayment({
          mode: 'game',
          env: 0,
          currencyType: 'CNY',
          platform: sysPlatform === 'windows' ? 'windows' : 'android',
          buyQuantity: num(goods.qty, 0),
          zoneId: CFG.iapZoneId || '1',
          customId: order,
          extraInfo: JSON.stringify({ goods: goods.id, qty: num(goods.qty, 0) }),
          success: function () { if (onOk) onOk(true); },
          fail: function () { if (onOk) onOk(false); },
        });
      }
      return true;
    } catch (e) { if (onOk) onOk(false); return false; }
  }

  /* ============================================================
   *  ⑦ 每日挑战日榜
   *
   *  为什么用 tt.setImRankData / tt.getImRankList，
   *  而不是 tt.setUserCloudStorage + 开放数据域：
   *  后者是微信的做法 —— key 要在后台配成「排行榜标识」，而且自定义 UI
   *  必须走开放数据域（一个独立子包，只能往 sharedCanvas 上渲染）。
   *  抖音这边有省得多的原生路径：
   *    上报  tt.setImRankData({ dataType: 0, value: '38402', zoneId })
   *    拉榜  tt.getImRankList({ rankType: 'day', ... })  —— 平台直接画出原生榜单
   *  只有想自定义 UI 才需要 getImRankData，而它必须在开放数据域里调用。
   *  对当前「单 bundle 拼接」的架构，开放数据域是实打实的成本，不做。
   *
   *  两条硬约束（踩了是静默失败，不会报错）：
   *  1. 必须先 tt.login。两个 API 的错误码里都有 21101 / 10601 not login，
   *     拉榜未登录还会闪退 —— 所以在 init 里就预热一次。
   *  2. value 是字符串，且必须是 [0, int32_MAX) 的正整数。
   * ============================================================ */
  var logged = false;
  var rankShowing = false;
  var lastSubmitted = -1;

  /**
   * 登录态预热。
   * 已登录时同步回调 —— openRank 是在触摸回调里被调用的，
   * 一旦这里走了异步，getImRankList 就脱离了手势上下文。
   */
  function ensureLogin(cb) {
    if (!isTT || !CFG.rank) { if (cb) cb(false); return; }
    if (logged) { if (cb) cb(true); return; }
    if (typeof tt.login !== 'function') { if (cb) cb(false); return; }
    try {
      tt.login({
        success: function () { logged = true; if (cb) cb(true); },
        fail: function () { if (cb) cb(false); },
      });
    } catch (e) { if (cb) cb(false); }
  }

  /** 能上报才算「日榜可用」：拉得到 UI 却写不进分数是没有意义的 */
  function rankOn() {
    return !!(isTT && CFG.rank && typeof tt.setImRankData === 'function');
  }
  function rankListOn() {
    return !!(isTT && CFG.rank && typeof tt.getImRankList === 'function');
  }

  /**
   * 上报净资产。
   * 只在「刷新了当天最好成绩」时调用（判定在引擎的 recordDaily 里）——
   * 榜单按 value 从大到小排、每次上报是覆盖，拿一局摆烂成绩盖上去
   * 等于自己把自己的名次冲掉。
   */
  function submitRank(score, onOk) {
    if (!rankOn()) { if (onOk) onOk(false); return false; }
    /* 钳制直接复用引擎的 rankScore()（engine.js 排在本文件之前装载）。
       注意：这里的 CFG 是**本模块自己的平台配置**（IIFE 内的 var CFG 遮蔽了
       data.js 的那份），里面没有 RANK_SCORE_MAX —— 引用它会得到 undefined、
       Math.min 出 NaN，上报直接变成 "NaN"。常量的唯一来源在 data.js。 */
    var v = rankScore(score);
    ensureLogin(function (okLogin) {
      if (!okLogin) { if (onOk) onOk(false); return; }
      try {
        tt.setImRankData({
          dataType: 0,
          value: String(v),
          priority: 0,
          zoneId: CFG.rankZoneId || 'daily',
          success: function () { lastSubmitted = v; if (onOk) onOk(true); },
          fail: function () { if (onOk) onOk(false); },
        });
      } catch (e) { if (onOk) onOk(false); }
    });
    return true;
  }

  /**
   * 拉起平台原生榜单 UI。
   * relationType: 'default' = 同时给好友榜和总榜，切页由平台组件自己做。
   */
  /* onOk(ok, reason)：ok=false 时 reason 说明原因，调用方据此给文案。
     reason: 'notlogin' 未登录 / 'notsupported' 真不支持 / 'showing' 正在展示中 */
  function openRank(onOk) {
    if (!rankListOn()) { if (onOk) onOk(false, 'notsupported'); return false; }
    /* 21105 rank list is showing：已经在展示了还去拉会直接报错 */
    if (rankShowing) { if (onOk) onOk(false, 'showing'); return false; }
    rankShowing = true;
    ensureLogin(function (okLogin) {
      if (!okLogin) { rankShowing = false; if (onOk) onOk(false, 'notlogin'); return; }
      try {
        tt.getImRankList({
          relationType: 'default',
          dataType: 0,
          rankType: CFG.rankType || 'day',
          suffix: CFG.rankSuffix || '',
          rankTitle: CFG.rankTitle || '',
          zoneId: CFG.rankZoneId || 'daily',
          success: function () { rankShowing = false; if (onOk) onOk(true); },
          fail: function () { rankShowing = false; if (onOk) onOk(false, 'loadfail'); },
          complete: function () { rankShowing = false; },
        });
      } catch (e) { rankShowing = false; if (onOk) onOk(false, 'loadfail'); }
    });
    return true;
  }

  /* ============================================================
   *  入口显隐：任一能力可用才显示福利卡
   * ============================================================ */
  function visible() {
    if (!isTT) return false;
    return sidebarOn()
      || (CFG.shortcut && typeof tt.addShortcut === 'function')
      || ((CFG.subscribeTmplIds || []).length > 0)
      || !!CFG.rewardedAdUnitId
      || iapList().length > 0;
  }

  /* ============================================================
   *  ⑥ 分享
   *  tt.shareAppMessage 与 addShortcut 同属「必须由用户点击同步触发」的 API，
   *  只能在触摸回调里调（doAct 正是由 tt.onTouchEnd 直接驱动），不能包异步，
   *  否则真机会报 must be invoked by user gesture。
   * ========================================================== */
  function shareOn() {
    return !!(isTT && CFG.share && typeof tt.shareAppMessage === 'function');
  }
  /** vars 用来把净资产之类的数字填进标题模板 */
  function share(vars) {
    if (!shareOn()) return false;
    var v = vars || {};
    var title = String(CFG.shareTitle || '')
      .replace('{worth}', v.worth != null ? v.worth : '')
      .replace('{day}', v.day != null ? v.day : '');
    try {
      tt.shareAppMessage({
        title: title,
        desc: CFG.shareDesc || '',
        query: '',
        success: function () { },
        fail: function () { },
      });
      return true;
    } catch (e) { return false; }
  }

  /** 福利卡副标题：一眼看清今天还剩什么可领 */
  function summary() {
    var bits = [];
    if (sidebarOn()) bits.push(sidebarClaimed() ? '侧边栏已领' : (fromSidebar() ? '🎁 可领奖励' : '前往侧边栏'));
    if (CFG.shortcut && typeof tt.addShortcut === 'function') {
      bits.push(shortcutAdded ? '已加桌面' : '加桌面');
    }
    if ((CFG.subscribeTmplIds || []).length) bits.push('开提醒');
    if (CFG.rewardedAdUnitId) bits.push('广告 ×' + adLeft());
    if (iapList().length) bits.push('充值');
    return bits.join(' · ');
  }

  return {
    cfg: CFG,
    init: init,
    visible: visible,
    summary: summary,
    /* ③ */
    sidebarOn: sidebarOn, fromSidebar: fromSidebar,
    sidebarClaimed: sidebarClaimed, claimSidebar: claimSidebar, gotoSidebar: gotoSidebar,
    /* ② */
    get shortcutAdded() { return shortcutAdded; },
    addShortcut: addShortcut,
    /* ④ */
    subscribe: subscribe,
    /* ⑤ */
    showRewarded: showRewarded, showInterstitial: showInterstitial,
    adLeft: adLeft, markAd: markAd,
    /* ① */
    iapList: iapList, pay: pay,
    /* ⑥ */
    shareOn: shareOn, share: share,
    /* ⑦ */
    rankOn: rankOn, rankListOn: rankListOn,
    submitRank: submitRank, openRank: openRank,
    get rankSubmitted() { return lastSubmitted; },
    /* 测试用：注入启动参数，模拟「从侧边栏回来」 */
    _onShow: onShowInfo,
  };
})();

/* 与 platform.js 的 installStore 同理：不等别人来调。
   onShow 注册晚了就收不到回调，玩家从侧边栏回来会领不到奖。 */
CAPS.init();

if (typeof globalThis !== 'undefined') globalThis.CAPS = CAPS;
