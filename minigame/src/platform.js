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
 * ============================================================ */

var PLAT = (function () {
  var isTT = (typeof tt !== 'undefined');

  /* ---------- 环境信息 ---------- */
  /**
   * 安全区：H5 里有 env(safe-area-inset-*) 可以精确定位刘海与 Home 指示条，
   * Canvas 里没有这东西，只能从宿主 API 问，而且各家返回口径不一。
   * 这里统一夹到 0~60 —— 万一某个 WebView 返回了离谱的值，
   * 最多是上下多留一点边，不会把整屏布局顶坏。
   */
  function clampIns(v) { return Math.max(0, Math.min(60, Math.round(num(v, 0) || 0))); }

  function info() {
    var w = 375, h = 667, dpr = 2, it = 0, ib = 0;
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
      } else {
        w = window.innerWidth || w; h = window.innerHeight || h;
        dpr = window.devicePixelRatio || dpr;
      }
    } catch (e) { /* 拿不到就用默认值，保证能起来 */ }
    /* 上限 3：部分安卓机 pixelRatio 报得很高，按 3 倍渲染会白白吃掉显存和帧率 */
    return {
      w: w, h: h, dpr: Math.min(3, Math.max(1, dpr)),
      insTop: clampIns(it), insBottom: clampIns(ib),
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
    /* 浏览器下 engine.js 自己会去用 localStorage，这里不注入，
       保持 H5 版行为 100% 不变（含隐私模式降级与内存兜底）。 */
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
     H5：WebAudio 实时合成，零资源文件。
     小游戏：没有 AudioContext。tt.createInnerAudioContext() 需要真实音频文件，
     会撑大首屏包（平台对初始包体积有严格限制）。
     这里做成「接口在、实现空」，音效开关照常记录，后续放入音频文件即可启用，
     不需要改动任何业务代码。 */
  function createAudio() {
    if (isTT) {
      return { available: false, play: function () { }, resume: function () { } };
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

  return {
    isTT: isTT,
    info: info,
    createCanvas: createCanvas,
    installStore: installStore,
    bindTouch: bindTouch,
    createAudio: createAudio,
    /* 复制到剪贴板：小游戏有原生 API，浏览器走异步 Clipboard */
    copy: function (text) {
      try {
        if (isTT) { tt.setClipboardData({ data: text }); return true; }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text); return true;
        }
      } catch (e) { /* 忽略 */ }
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
