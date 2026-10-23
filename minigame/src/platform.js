'use strict';
/* ============================================================
 *  平台适配层
 *
 *  抖音小游戏没有 BOM / DOM（官方原话：「没有 window 对象以及其上面的各种属性」），
 *  只有 tt.* 的 JSAPI。而 H5 有 DOM 没有 tt。
 *  本文件把两边抹平成同一组接口，业务代码只认这组接口，不认具体平台。
 *
 *  三个必须抹平的点：
 *    1. 画布  —— tt.createCanvas()  vs  document.createElement('canvas')
 *    2. 存储  —— tt.getStorageSync  vs  localStorage
 *    3. 触摸  —— tt.onTouchStart    vs  pointer 事件
 *
 *  刻意**不**去模拟 DOM：官方 tt-adapter 也只抹平 canvas/audio/image/storage
 *  四项，文档自己写明「仍然比较简陋」。本作是 Canvas 全绘制，用不到 DOM 模拟，
 *  与其引入一份只模拟了一半的垫片，不如只适配真正用到的三项。
 *
 *  ────────────────────────────────────────────────────────────
 *  ★★ V20.4：第三种宿主 —— 原生 App（Capacitor / WebView）
 *  ────────────────────────────────────────────────────────────
 *
 *  为什么加这一支：
 *    App 方案复用**本文件与 Canvas 渲染层**（不是 H5 的 DOM 版）——
 *    Canvas 版纯自绘、不依赖 DOM，在 WebView 里没有 DOM 渲染开销。
 *
 *  ★ 三个宿主的差异矩阵：
 *              tt.*（小游戏）  浏览器/H5   Capacitor App
 *    画布      tt.createCanvas  DOM canvas  DOM canvas（同 H5）
 *    存储      同步 API         localStorage  ★ Capacitor Preferences（异步！）
 *    触摸      tt.onTouchStart  pointer      pointer（同 H5）
 *    音频      WAV 文件         WebAudio     ★ WebAudio（但受原生音频会话管）
 *    震动      tt.vibrateShort  无           ★ Capacitor Haptics
 *    安全区    宿主 API         env()        ★ 宿主 API（更准）
 *    返回键    无               无           ★ ★ Android 物理返回键必须处理！
 *
 *  ★★ 最关键的一条：**存储从同步变异步**。
 *    engine.js 现在的存储契约是**同步**的（get 立刻返回值），
 *    因为小游戏 API 与 localStorage 都是同步的。
 *    ★ 而 Capacitor Preferences 是 Promise 异步的。
 *    ★ 若直接接上，engine.js 里所有 storageGet 都会拿到 undefined ——
 *      读档全空、存档全丢，而且**不报任何错**（最难查的那种）。
 *    ★ 解决办法见下面 makeAppStore()：**启动时一次性把全部存档读进内存**，
 *      之后所有读走内存、写同时更新内存与原生存储。
 *      内存版与原生版语义一致（都是"最后写入者赢"），
 *      唯一的差别是"写盘失败时内存里已经有了"——
 *      而这对游戏是**更好**的行为（不丢进度）。
 * ============================================================ */

var PLAT = (function () {
  var isTT = (typeof tt !== 'undefined');
  /* ★ Capacitor 注入 window.Capacitor；App 宿主判定靠它。
     ★ 不用 userAgent 嗅探 —— 那不靠谱，且 Capacitor 的 UA 也可能不含标记。 */
  var isCap = (typeof window !== 'undefined') && !!window.Capacitor && !!window.Capacitor.isNativePlatform
    && window.Capacitor.isNativePlatform();
  var isApp = isCap;


  /* ---------- 环境信息 ---------- */
  /**
   * 安全区：H5 里有 env(safe-area-inset-*) 可以精确定位刘海与 Home 指示条，
   * Canvas 里没有这东西，只能从宿主 API 问，而且各家返回口径不一。
   * 这里统一夹到 0~60 —— 万一某个 WebView 返回了离谱的值，
   * 最多是上下多留一点边，不会把整屏布局顶坏。
   */
  function clampIns(v) { return Math.max(0, Math.min(60, Math.round(num(v, 0) || 0))); }

  /* ---------- 安全区读取（V20.8 重构）----------
   *
   * ★★★ 三个层级，从权威到兜底 ★★★
   *
   * ① **原生插件**（App/Android 权威来源）
   *   AppInsetsPlugin.java 监听 WindowInsetsCompat，
   *   把 systemBars + displayCutout 换算成 CSS px，
   *   主动推到 `window.__APP_INSETS`。
   *   ★ 同步可读 —— 不等 Promise，首帧布局就能拿到正确 inset。
   *
   * ② **CSS env() 探针**（iOS / 桌面浏览器正确，Android 可能为 0）
   *   `env(safe-area-inset-*)` 是 Apple 定义、WebKit 实现的能力；
   *   Android WebView 直到 Chromium 140 才补上，
   *   更早的版本在 edge-to-edge 下**返回 0**（静默失效）。
   *   ★ 所以它只能当 fallback，不能当唯一来源。
   *
   * ③ **全 0**（都拿不到时的兜底）
   *   布局照常画，只是可能没避开系统栏 —— 至少不会崩。
   *
   * ★★ 为什么 ① 必须在最前面 ★★
   *   V20.7 只做了 ②，那在**多数 Android 设备上等于没做** ——
   *   env() 返回 0，不报错、不告警，底部按钮被手势条盖住，
   *   开发者却以为已经修好了。**静默失效是最坏的失败模式。**
   */
  var _envInsets = null;

  /**
   * 读原生推来的 inset（若宿主是 Capacitor App 且插件已推过值）。
   * ★ 返回 null 表示「没有原生值」，调用方应继续往下 fallback。
   */
  function readNativeInsets() {
    try {
      if (!isApp) return null;
      var v = (typeof window !== 'undefined') ? window.__APP_INSETS : null;
      if (!v || typeof v !== 'object') return null;
      if (!v.ok) return null;
      var top = clampIns(v.top), bottom = clampIns(v.bottom);
      /* ★ 左右也带上（横屏时刘海在侧边）。
         ★ 但左右只在「确实有值」时才用 —— 侧边安全区通常为 0。 */
      var left = Math.max(0, Math.round(num(v.left, 0) || 0));
      var right = Math.max(0, Math.round(num(v.right, 0) || 0));
      return { top: top, bottom: bottom, left: left, right: right, src: 'native' };
    } catch (e) { return null; }
  }

  function readEnvInsets() {
    if (_envInsets) return _envInsets;
    var out = { top: 0, bottom: 0, src: 'none' };
    try {
      if (typeof document !== 'undefined' && document.body) {
        var probe = document.createElement('div');
        probe.style.cssText = [
          'position:fixed', 'top:0', 'left:0', 'width:0', 'height:0',
          'visibility:hidden', 'pointer-events:none', 'z-index:-1',
          'padding-top:env(safe-area-inset-top, 0px)',
          'padding-bottom:env(safe-area-inset-bottom, 0px)',
        ].join(';');
        document.body.appendChild(probe);
        var cs = getComputedStyle(probe);
        out.top = parseFloat(cs.paddingTop) || 0;
        out.bottom = parseFloat(cs.paddingBottom) || 0;
        if (probe.parentNode) probe.parentNode.removeChild(probe);
      }
    } catch (e) { /* 拿不到就用 0 */ }
    out.top = clampIns(out.top);
    out.bottom = clampIns(out.bottom);
    out.src = 'env';
    _envInsets = out;
    return out;
  }

  /**
   * 主动向原生插件拉一次 inset（异步）。
   *
   * ★★ 为什么需要这条异步通道 ★★
   *   原生侧是「主动 push 到 window.__APP_INSETS」，
   *   ★ 但 push 发生在插件 load() 时 —— 那时 WebView **还没加载完页面**，
   *   ★ evaluateJavascript 会打到 about:blank 上，值就丢了。
   *   ★ 而 Capacitor 的插件调用**永远是异步的**（nativePromise），
   *   ★ 没法在同步的 PLAT.info() 里等它。
   *
   * ★ 所以：**首帧先用 env 探针/兜底画出画面，
   *   页面就绪后再异步拉一次真实 inset，拉到就重排。**
   *   ★ 这个「晚一帧的修正」对玩家不可见（布局差异只有几十像素），
   *   ★ 但保证了旋转/系统栏变化后始终是真实值。
   *
   * @param {function} cb 回调 (insets|null)
   */
  function requestInsets(cb) {
    try {
      if (!isApp) { cb(null); return; }
      var C = window.Capacitor;
      if (!C || !C.Plugins || !C.Plugins.AppInsets) { cb(null); return; }
      var p = C.Plugins.AppInsets;
      if (!p || typeof p.get !== 'function') { cb(null); return; }
      Promise.resolve(p.get()).then(function (r) {
        if (!r || !r.ok) { cb(null); return; }
        var ins = {
          top: clampIns(r.top), bottom: clampIns(r.bottom),
          left: Math.max(0, Math.round(num(r.left, 0) || 0)),
          right: Math.max(0, Math.round(num(r.right, 0) || 0)),
          src: 'native',
        };
        /* ★ 写回全局 —— 让后续所有同步的 info() 都能读到它。
           ★ 原生侧的 push 与这里的写入是同一个数据源，值一致。 */
        try { window.__APP_INSETS = ins; } catch (e) { }
        cb(ins);
      }).catch(function () { cb(null); });
    } catch (e) { cb(null); }
  }

  /**
   * ★★ 统一入口：拿当前安全区（V20.8）★★
   * 优先级：原生推送值 → env() 探针 → 全 0。
   * ★ 原生值**不走缓存** —— 它是宿主随时推来的最新值，
   *   而 env 探针的结果在旋转后可能过期，所以缓存只加在 env 上。
   */
  function safeInsets() {
    var nat = readNativeInsets();
    if (nat) return nat;
    var env = readEnvInsets();
    /* ★ env 探针返回 0 时不认为它是「有效来源」——
       记下来是为了让调用方知道「这次是兜底」。 */
    if (env.top === 0 && env.bottom === 0) env.src = 'none';
    return env;
  }

  /** 旋转 / 折叠屏展开后安全区可能变 —— 清缓存让下次 info() 重读 */
  function clearEnvInsetsCache() { _envInsets = null; }

  function info() {
    var w = 375, h = 667, dpr = 2, it = 0, ib = 0, il = 0, ir = 0;
    try {
      if (isTT) {
        var si = tt.getSystemInfoSync() || {};
        w = si.windowWidth || w; h = si.windowHeight || h;
        dpr = si.pixelRatio || dpr;
        if (si.safeArea) {
          it = si.safeArea.top || 0;
          ib = (si.screenHeight || h) - (si.safeArea.bottom || h);
        } else {
          it = si.statusBarHeight || 0;
        }
      } else if (isApp) {
        /* ★ App（Capacitor）：尺寸直接取 WebView 视口。
           ★ WebView resize 后 innerWidth/innerHeight 会更新 ——
             这正是 V20.7 的 resize 处理能拿到新尺寸的依据。 */
        w = window.innerWidth || w; h = window.innerHeight || h;
        dpr = window.devicePixelRatio || dpr;
        /* ★★ 安全区：用 CSS env() 探针读 ★★
         *
         * ★ 原来的写法是读 `--ion-safe-area-top` / `--ion-safe-area-bottom`
         *   —— ★★ 那是 **Ionic 框架**的变量，本项目**没用 Ionic**，
         *   ★★ 所以它永远不存在 → inset 恒为 0 →
         *   ★★ 结果：Android 底部导航栏（手势条/三键）盖住底部按钮，
         *   ★★ 而玩家「暂停 / 开门营业」点不到 —— 而且不报任何错。
         *
         * ★ 正确做法：**CSS env() 探针**。
         *   env() 是函数，不能在 getComputedStyle 里直接读 ——
         *   必须建一个隐藏元素，把 env() 写进 padding，再读它的 computed padding。
         *   ★ index.html 里已有 viewport-fit=cover（必需，否则 env() 全是 0），
         *     Android 15+ (API 35) 强制 edge-to-edge，iOS 一直支持 ——
         *     所以这条路径在两个平台上都有效。
         */
        var ins = safeInsets();
        it = ins.top;
        ib = ins.bottom;
        il = ins.left || 0;
        ir = ins.right || 0;
      } else {
        w = window.innerWidth || w; h = window.innerHeight || h;
        dpr = window.devicePixelRatio || dpr;
      }
    } catch (e) { /* 拿不到就用默认值，保证能起来 */ }
    /* 上限 3：部分安卓机 pixelRatio 报得很高，按 3 倍渲染会白白吃掉显存和帧率 */
    return {
      w: w, h: h, dpr: Math.min(3, Math.max(1, dpr)),
      insTop: clampIns(it), insBottom: clampIns(ib),
      /* ★ 左右安全区（V20.8）——
       *   横屏时刘海/挖孔在**侧边**，内容会被物理遮挡。
       *   ★ 这两个值不夹上限（侧边一般只有 0~40px）。 */
      insLeft: Math.max(0, Math.round(il || 0)),
      insRight: Math.max(0, Math.round(ir || 0)),
    };
  }

  /* ---------- 画布 ---------- */
  function createCanvas() {
    if (isTT) return tt.createCanvas();
    /* 浏览器预览页取页面里现成的 #gc；
       拿不到（比如 Node 冒烟测试里根本没有 document）就现造一个离屏的。 */
    try {
      var el = document.getElementById('gc');
      if (el) return el;
      el = document.createElement('canvas');
      if (document.body) document.body.appendChild(el);
      return el;
    } catch (e) {
      return { width: 0, height: 0, getContext: function () { return null; }, addEventListener: function () { } };
    }
  }

  /* ---------- 存储 ----------
     小游戏是同步 API 且没有容量探测，写入失败会直接抛；
     这里统一成 engine.js 期望的 { get / set / remove } 形状。 */
  function makeTTStore() {
    return {
      get: function (k) { try { return tt.getStorageSync(k) || ''; } catch (e) { return ''; } },
      set: function (k, v) { tt.setStorageSync(k, v); },
      remove: function (k) { try { tt.removeStorageSync(k); } catch (e) { } },
    };
  }
  function installStore() {
    if (typeof globalThis === 'undefined') return;
    if (isTT) { globalThis.__BUBBLE_STORE = makeTTStore(); return; }
    /* App：装内存版存储（下面 makeAppStore 提供）。
       ★ 必须**在** engine.js 加载前装好 ——
         engine.js 在加载阶段就执行 loadMeta()（一句顶层 var 赋值），
         那时若后端还没装，存档读取会拿到 undefined。 */
    if (isApp) { globalThis.__BUBBLE_STORE = makeAppStore(); return; }
    /* 浏览器下 engine.js 自己会去用 localStorage，这里不注入，
       保持 H5 版行为 100% 不变（含隐私模式降级与内存兜底）。 */
  }

  /* ---------- App 存储（Capacitor 原生同步插件）----------
     ★★★ 这里是整个 App 方案最容易埋雷的地方 ★★★

     engine.js 的存储契约是**同步**的：
       storageGet(key) → 立刻返回字符串
     小游戏 API 与 localStorage 都是同步的，所以这个契约一直成立。

     ★ 而 @capacitor/preferences 是 **Promise 异步**的。
       若直接接上：storageGet 全部返回 undefined
       → 读档全空、存档全丢，**而且不报任何错**（最难查的那种）。

     ★★ 解法：写原生插件 BubbleStore，直接调
       Android SharedPreferences / iOS UserDefaults
       —— 它们**本来就是同步的**，是 Capacitor 的异步包装制造了冲突。
       于是**引擎一行都不用改**，契约天然对齐。

     ★ 三层降级（从好到差）：
       ① BubbleStore 原生同步插件 —— 最优，契约完全一致
       ② Preferences 异步 + 启动预热进内存 —— 次优，同步读内存
       ③ 纯内存 —— 兜底，关掉就丢（但游戏照样能玩）
     ★ 有 ① 就别用 ②：② 需要改启动时序，① 不需要。
  */
  var APP_MEM = Object.create(null);
  var APP_READY = false;
  var APP_STORE = null;   /* BubbleStore 插件句柄 */

  /** 取原生同步存储插件（拿不到返回 null） */
  function appNativeStore() {
    if (APP_STORE !== null) return APP_STORE;
    APP_STORE = false;
    try {
      var C = window.Capacitor;
      if (C && C.Plugins && C.Plugins.BubbleStore) {
        APP_STORE = C.Plugins.BubbleStore;
      }
    } catch (e) { APP_STORE = false; }
    return APP_STORE;
  }

  /** 启动时把全部存档读进内存。
   *  ★ 有原生同步插件时其实不必预热（原生 get 本身就是同步的），
   *    但预热一次能让「首次读档」不必跨桥接往返，更快。
   *  ★ 没有原生插件时（降级到 Preferences），
   *    这步是**必须的** —— 否则 engine.js 顶层 loadMeta() 会读到空。 */
  function appStoreReady(keys) {
    if (!isApp) return Promise.resolve();

    var native = appNativeStore();
    if (native) {
      /* 原生同步插件：直接读，不需要等 */
      try {
        var list = keys || [];
        /* ★ 优先用批量接口 getMany —— 一次桥接往返读完所有键，
           逐个 get 是 N 次往返（启动时 4 个键就是 4 次）。
           ★ 但不是所有宿主都实现了 getMany，所以要有回退。
           ★★ keys 传的是**逗号分隔的字符串**而不是数组 ——
              Capacitor 的 getArray 返回可选数组（Swift 侧还要处理
              JSValue 元素），而我**没有 Mac 验证不了编译**。
              只用 getString 是最不容易写错的 API。
              （Java 侧的 getMany 仍收数组，两边都能兼容这个字符串。）*/
        if (typeof native.getMany === 'function' && list.length) {
          var batch = native.getMany({ keys: list.join(',') });
          var vals = batch && batch.values ? batch.values : null;
          if (vals) {
            for (var k in vals) {
              if (Object.prototype.hasOwnProperty.call(vals, k) && vals[k] != null) {
                APP_MEM[k] = String(vals[k]);
              }
            }
          } else {
            /* 批量没返回结果 → 逐个读 */
            for (var i = 0; i < list.length; i++) {
              var r = native.get({ key: list[i] });
              if (r && r.value) APP_MEM[list[i]] = String(r.value);
            }
          }
        } else {
          for (var i2 = 0; i2 < list.length; i2++) {
            var r2 = native.get({ key: list[i2] });
            if (r2 && r2.value) APP_MEM[list[i2]] = String(r2.value);
          }
        }
      } catch (e) { /* 读不到就当没有 */ }
      APP_READY = true;
      return Promise.resolve();
    }

    /* 降级：Capacitor Preferences（异步）*/
    var prefs = null;
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) {
        prefs = window.Capacitor.Plugins.Preferences;
      }
    } catch (e) { /* 拿不到就用内存版 */ }

    if (!prefs) {
      APP_READY = true;
      return Promise.resolve();
    }

    var list2 = keys || [];
    var ps = list2.map(function (k) {
      return Promise.resolve(prefs.get({ key: k }))
        .then(function (r) { if (r && r.value != null) APP_MEM[k] = String(r.value); })
        .catch(function () { });
    });
    return Promise.all(ps).then(function () { APP_READY = true; });
  }

  function makeAppStore() {
    var native = appNativeStore();

    /* ★★ 首选路径：原生同步插件 ★★
       ★ get 是**同步返回**的（Capacitor 的同步插件方法），
         所以这里可以直接拿到 value —— 契约与 localStorage 完全一致。 */
    if (native) {
      return {
        get: function (k) {
          try {
            var r = native.get({ key: k });
            if (r && r.found) return String(r.value);
            /* 原生没有 → 看内存（可能刚写还没落盘） */
            var v = APP_MEM[k];
            return v == null ? '' : v;
          } catch (e) {
            var v2 = APP_MEM[k];
            return v2 == null ? '' : v2;
          }
        },
        set: function (k, v) {
          APP_MEM[k] = String(v);
          try { native.set({ key: k, value: String(v) }); } catch (e) { }
        },
        remove: function (k) {
          delete APP_MEM[k];
          try { native.remove({ key: k }); } catch (e) { }
        },
        isReady: function () { return APP_READY; },
      };
    }

    /* 降级路径：Preferences（异步）+ 内存镜像 */
    var prefs = null;
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) {
        prefs = window.Capacitor.Plugins.Preferences;
      }
    } catch (e) { }

    return {
      get: function (k) {
        var v = APP_MEM[k];
        return v == null ? '' : v;
      },
      set: function (k, v) {
        APP_MEM[k] = String(v);
        if (prefs) {
          try {
            Promise.resolve(prefs.set({ key: k, value: String(v) })).catch(function () { });
          } catch (e) { }
        }
      },
      remove: function (k) {
        delete APP_MEM[k];
        if (prefs) {
          try {
            Promise.resolve(prefs.remove({ key: k })).catch(function () { });
          } catch (e) { }
        }
      },
      isReady: function () { return APP_READY; },
    };
  }

  /* ---------- 触摸 ----------
     统一成 { x, y } 的下压 / 移动 / 抬起三件事。
     多点触摸只取第一根手指：本作核心操作是连点，多指只会带来误触。 */
  function bindTouch(canvas, onDown, onMove, onUp) {
    if (isTT) {
      tt.onTouchStart(function (e) { var t = e.touches[0]; if (t) onDown(t.clientX, t.clientY); });
      tt.onTouchMove(function (e) { var t = e.touches[0]; if (t) onMove(t.clientX, t.clientY); });
      tt.onTouchEnd(function (e) {
        var t = e.changedTouches[0] || e.touches[0];
        if (t) onUp(t.clientX, t.clientY);
      });
      tt.onTouchCancel(function () { onUp(-1, -1); });
      return;
    }
    /* 浏览器：pointer 事件一套通吃鼠标与触摸 */
    var toXY = function (e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    canvas.addEventListener('pointerdown', function (e) {
      var p = toXY(e); onDown(p.x, p.y);
    }, { passive: true });
    canvas.addEventListener('pointermove', function (e) {
      var p = toXY(e); onMove(p.x, p.y);
    }, { passive: true });
    window.addEventListener('pointerup', function (e) {
      var p = toXY(e); onUp(p.x, p.y);
    }, { passive: true });
  }

  /* ---------- 音频 ----------
     浏览器：WebAudio 实时合成，零资源文件。
     小游戏：没有 AudioContext，只能走 tt.createInnerAudioContext() + 真实音频文件。
     音频文件由 tools/gen-sfx.js 离线合成（3 个极短 WAV，合计约 17KB）——
     本作核心手感是「连点出杯位」，点下去没声音，手感就只剩振动一半。
     文件缺失或宿主不支持时整体降级为静音，绝不影响玩法。 */
  var SFX_FILES = { tap: 'audio/tap.wav', up: 'audio/up.wav', down: 'audio/down.wav' };
  function createAudio() {
    if (isTT) {
      var pool = {};
      try {
        if (typeof tt.createInnerAudioContext === 'function') {
          for (var k in SFX_FILES) {
            pool[k] = tt.createInnerAudioContext({ src: SFX_FILES[k], loop: false });
          }
        }
      } catch (e) { pool = {}; }
      var has = false;
      for (var k2 in pool) { has = true; break; }
      return {
        available: has,
        resume: function () { },
        play: function (kind, freq, dur) {
          /* 按频率挑文件：调用方仍然只说「响一下」，不用为每个事件新增常量。
             高频 = 连点出杯（要短促），低频 = 负反馈，其余 = 正向反馈。 */
          var key = freq >= 850 ? 'tap' : (freq < 300 ? 'down' : 'up');
          var a = pool[key] || pool.up;
          if (!a) return;
          try { a.stop(); a.seek(0); a.play(); } catch (e) { /* 音效永远不该影响玩 */ }
        },
      };
    }
    var ac = null;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ac = new AC();
    } catch (e) { ac = null; }
    return {
      available: !!ac,
      resume: function () { if (ac && ac.state === 'suspended') { try { ac.resume(); } catch (e) { } } },
      play: function (kind, freq, dur) {
        if (!ac) return;
        try {
          if (ac.state === 'suspended') ac.resume();
          var o = ac.createOscillator(), g = ac.createGain();
          o.type = kind === 'down' ? 'sawtooth' : 'sine';
          o.frequency.setValueAtTime(freq, ac.currentTime);
          g.gain.setValueAtTime(0.08, ac.currentTime);
          g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + (dur || 0.12));
          o.connect(g); g.connect(ac.destination);
          o.start(); o.stop(ac.currentTime + (dur || 0.12));
        } catch (e) { /* 音效永远不该影响玩 */ }
      },
    };
  }

  /* ---------- App 专用：退出 ---------- */
  var APP_BACK_HANDLER = null;
  function APP_EXIT() {
    try {
      if (isApp && window.Capacitor && window.Capacitor.Plugins
        && window.Capacitor.Plugins.App && window.Capacitor.Plugins.App.exitApp) {
        window.Capacitor.Plugins.App.exitApp();
        return;
      }
    } catch (e) { /* 忽略 */ }
    /* 非 App 宿主：普通网页没有"退出 App"的概念 */
    try { if (window.close) window.close(); } catch (e) { /* 忽略 */ }
  }

  return {
    isTT: isTT,
    isApp: isApp,
    info: info,
    createCanvas: createCanvas,
    installStore: installStore,
    bindTouch: bindTouch,
    createAudio: createAudio,
    /* ★ App 存储启动前要先 appStoreReady() 把存档读进内存 */
    appStoreReady: appStoreReady,
    /* ★ 旋转 / 折叠屏展开后安全区可能变 —— 清缓存让下次 info() 重读 */
    clearEnvInsetsCache: clearEnvInsetsCache,
    /* ★ V20.8：异步向原生拉一次真实 inset（Android）。
       ★ 拿到后回调，调用方应重排一次布局。
       ★ 原因见 requestInsets 的注释 —— 原生 push 可能早于页面加载而丢失。 */
    requestInsets: requestInsets,
    /* 触感反馈。
       本作核心是连点出杯位，这类玩法最吃「按下去有回弹」。
       抖音有 tt.vibrateShort / vibrateLong；浏览器没有对应能力，直接 no-op ——
       触感永远不该影响任何游戏逻辑，调用方也不需要判环境。
       ★ App（Capacitor Haptics）：
         'light' 对应轻触（连点出杯用），
         'heavy' 对应长按（删除/重置这类要确认的操作）。
         ★ iOS 需要 Core Haptics 支持才有两档；
           旧机型只有 'light'/'medium'/'heavy' 的近似映射，
           插件会自动降级 —— 调用方不用管。 */
    vibrate: function (kind) {
      try {
        if (isTT) {
          if (kind === 'long' && typeof tt.vibrateLong === 'function') tt.vibrateLong();
          else if (typeof tt.vibrateShort === 'function') tt.vibrateShort();
          return;
        }
        if (isApp) {
          var H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
          if (!H) return;
          var style = (kind === 'long') ? 'HEAVY' : 'LIGHT';
          var p = (style === 'HEAVY') ? H.impact({ style: style }) : H.impact({ style: style });
          if (p && p.catch) p.catch(function () { });
          return;
        }
        /* 浏览器：无对应能力，no-op */
      } catch (e) { /* 部分机型没有马达，忽略 */ }
    },
    /* ★★ Android 物理返回键（V20.4 新增）★★
       iOS 没有返回键，所以这是**不对称**的能力：
       浏览器与小游戏都不需要处理，原生 App 必须处理。

       为什么必须处理：
         Android 的返回键默认是「关掉当前 Activity」——
         游戏会**直接退出**，玩家刚玩到一半的进度还在（自动存档），
         但体验上像是「莫名其妙被踢出去」。
       正确行为：
         ① 有弹窗 → 关弹窗
         ② 在子页面（研发/升级/员工…）→ 回主页
         ③ 在主页 → 二次确认才退出
       ★ 层级判断交给业务层（它知道当前在哪个面板），
         这里只提供「请求返回」的回调注册与「退出 App」的能力。 */
    onBack: function (handler) {
      if (!isApp) return;
      APP_BACK_HANDLER = handler;
      try {
        var A = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
        if (!A) return;
        /* Capacitor 的 backButton 事件：Android 物理返回键
           （注：Capacitor 7 里事件名是 'backButton'） */
        A.addListener('backButton', function () {
          if (APP_BACK_HANDLER) APP_BACK_HANDLER();
          else APP_EXIT();
        });
      } catch (e) { /* 忽略 */ }
    },
    /* ★ 退出 App（返回键的最终手段） */
    exitApp: function () { APP_EXIT(); },

    /* 复制到剪贴板。
       返回值语义很重要：以前浏览器分支是 fire-and-forget，Promise 被拒时
       也已经 return true 了，于是「📋 已复制」是个**假成功** —— 玩家把码丢了
       还以为复制过，存档直接找不回来。现在浏览器分支只在"能发起写入"时返回
       'pending'，由调用方用回调拿真实结果；TT 分支保持同步 true/false。 */
    copy: function (text, onDone) {
      try {
        if (isTT) {
          tt.setClipboardData({
            data: text,
            success: function () { if (onDone) onDone(true); },
            fail: function () { if (onDone) onDone(false); },
          });
          return 'pending';
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            function () { if (onDone) onDone(true); },
            function () { if (onDone) onDone(false); }
          );
          return 'pending';
        }
      } catch (e) { /* 忽略，落到 false */ }
      return false;
    },
  };
})();

/* 立刻安装存储后端，不等别人来调。
   engine.js 在加载阶段就会执行 loadMeta()（那是一句顶层 var 赋值），
   等到入口文件再 installStore 就晚了 —— 那时后端已经锁成内存版，
   进度只会存在内存里，关掉小游戏就丢。 */
PLAT.installStore();

if (typeof globalThis !== 'undefined') globalThis.PLAT = PLAT;
