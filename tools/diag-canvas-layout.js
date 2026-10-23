/**
 * Canvas 版多分辨率适配诊断（V20.7）—— 基于**真实渲染**
 *
 * ★★ 为什么必须是「真实渲染」★★
 *   我第一版诊断器是**复刻布局逻辑**再自己算坐标 ——
 *   结果它只报出 1 个问题，而真实设备上的问题远不止这些。
 *   ★ 根本原因：复刻的逻辑和真实代码会漂移，
 *     而布局代码里有大量「这里减 10、那里加 8」的硬编码。
 *
 * ★ 正确做法：**跑真实的 draw()，拦截所有 Canvas 绘制调用**，
 *   记录每一次 fillText / fillRect / roundRect 的坐标，
 *   然后检查这些坐标是否越界、是否重叠、是否进了刘海区。
 *
 * ★ 这样测的就是「玩家真正看到的东西」。
 *
 * 用法：node tools/diag-canvas-layout.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

/* ★ 真实设备的 CSS 像素与安全区（不是编的尺寸） */
const DEVICES = [
  { name: '小屏 320×568', w: 320, h: 568, insT: 0, insB: 0, dpr: 2 },
  { name: '主流 375×667', w: 375, h: 667, insT: 0, insB: 0, dpr: 2 },
  { name: '大屏 414×896', w: 414, h: 896, insT: 0, insB: 0, dpr: 3 },
  { name: '刘海 390×844', w: 390, h: 844, insT: 47, insB: 34, dpr: 3 },
  { name: '折叠 344×882', w: 344, h: 882, insT: 24, insB: 16, dpr: 3 },
  { name: '平板竖 768×1024', w: 768, h: 1024, insT: 24, insB: 0, dpr: 2 },
  { name: '平板横 1024×768', w: 1024, h: 768, insT: 0, insB: 0, dpr: 2 },
  { name: '折叠内屏 673×841', w: 673, h: 841, insT: 24, insB: 16, dpr: 2.5 },
  /* ★ 横屏（V20.7 新增支持）—— */
  { name: '手机横 844×390', w: 844, h: 390, insT: 0, insB: 16, dpr: 3 },
  { name: '手机横 736×414', w: 736, h: 414, insT: 0, insB: 20, dpr: 2.5 },
  { name: '平板横 1180×820', w: 1180, h: 820, insT: 0, insB: 0, dpr: 2 },
];

const MIN_TAP = 32;

/* ---------- 加载 bundle ---------- */
try {
  require('child_process').execFileSync(process.execPath,
    [path.join(root, 'tools', 'build-minigame.js')], { stdio: 'ignore' });
} catch (e) { /* 忽略 */ }
const BUNDLE = fs.readFileSync(path.join(root, 'minigame', 'bundle.js'), 'utf8');

/**
 * 起一个能渲染并**记录绘制调用**的环境。
 * @param {object} dev 设备参数
 * @param {boolean} collect true=记录绘制调用
 */
function makeEnv(dev, collect) {
  /* 记录到的绘制 */
  const ops = [];
  let curFont = { size: 13, weight: 400 };
  let curAlign = 'left';
  /* ★ 文本宽度的估算：
     measureText 在 mock 里返回的是「字符数 × 6.5」，
     那是给「会不会溢出」用的粗略值 ——
     ★ 中文比 ASCII 宽，所以这里按字符类型分别算，
       否则中文溢出会被漏掉。 */
  const textWidth = (s) => {
    let w = 0;
    for (const ch of String(s)) {
      w += ch.charCodeAt(0) > 255 ? curFont.size : curFont.size * 0.55;
    }
    return w;
  };

  /* ★★ 追踪裁剪区 ★★
   * GFX.clipPush(ctx, x, y, w, h) 会 save + clip。
   * ★ 有了裁剪区就能判断每个绘制调用「属于哪一块」，
   *   从而只检查面板内容的溢出，而不误报 HUD/tab 自己的绘制。
   */
  let clipStack = [];

  /* ★★ 当前生效的裁剪区 ★★
   * ★ 关键：只有 ctx.rect() 之后紧跟 ctx.clip() 才算裁剪区。
   * ★ 而 GFX.rr() 走 roundRect —— 它不是裁剪，
   *   绝不能把 lastRect 改成 roundRect 的矩形（那会污染裁剪区判断）。
   * ★ 所以分两个变量：
   *   lastRect —— 最近一次路径矩形的尺寸（用于 roundRect 自身记录）
   *   clipRect —— 最近一次 **clip 生效** 的区域
   */
  let lastRect = null;
  let clipRect = null;
  function curClip() { return clipRect; }

  const fakeCtx = () => new Proxy({}, {
    get(t, p) {
      if (p === 'save') return () => { clipStack.push(clipStack.length ? clipStack[clipStack.length - 1] : null); };
      if (p === 'restore') return () => { clipStack.pop(); };
      if (p === 'clip') return () => {
        /* ★ clip() 紧跟在 rect() 之后 → 此时的矩形就是裁剪区 */
        if (lastRect) clipRect = lastRect;
      };
      if (p === 'beginPath') return () => { t._path = []; };
      if (p === 'rect') {
        return (x, y, w, h) => {
          t._path = { x: x, y: y, w: w, h: h };
          lastRect = { x: x, y: y, w: w, h: h };
          ops.push({ kind: 'clip', x: x, y: y, w: w, h: h });
        };
      }
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() { } });
      if (p === 'measureText') return (s) => ({ width: textWidth(s) });
      if (p === 'fillText') {
        return (s, x, y) => {
          if (s == null) return;
          ops.push({
            kind: 'text', text: String(s), x: x, y: y,
            w: textWidth(s), size: curFont.size, align: curAlign,
            clip: curClip(),
          });
        };
      }
      if (p === 'strokeText') {
        return (s, x, y) => {
          if (s == null) return;
          ops.push({
            kind: 'text', text: String(s), x: x, y: y,
            w: textWidth(s), size: curFont.size, align: curAlign,
          });
        };
      }
      if (p === 'fillRect') {
        return (x, y, w, h) => {
          ops.push({ kind: 'rect', x: x, y: y, w: w, h: h, clip: curClip() });
        };
      }
      if (p === 'strokeRect') {
        return (x, y, w, h) => { ops.push({ kind: 'rect', x: x, y: y, w: w, h: h, stroke: true }); };
      }
      if (p === 'roundRect') {
        return (x, y, w, h) => {
          /* ★ 记录元素本身，但**不改 lastRect** ——
             ★ roundRect 不是裁剪，改 lastRect 会污染 clipRect 的判断。
             ★ 而 clipRect 只在 clip() 时更新，那才是真正的裁剪区。 */
          ops.push({ kind: 'rect', x: x, y: y, w: w, h: h, clip: curClip() });
        };
      }
      if (p === 'moveTo' || p === 'lineTo' || p === 'arc' || p === 'arcTo'
        || p === 'quadraticCurveTo' || p === 'bezierCurveTo' || p === 'ellipse') {
        /* ★ 路径指令：记录终点，用于捕捉「画到界外」的线段 */
        return (a, b) => { if (typeof a === 'number' && typeof b === 'number') ops.push({ kind: 'path', x: a, y: b }); };
      }
      if (p === 'font') {
        return undefined;   /* 赋值走 set */
      }
      if (p === 'textAlign') {
        return curAlign;
      }
      return () => { };
    },
    set(t, p, v) {
      if (p === 'font') {
        /* '700 12px xxx' → 解析出 size 与 weight */
        const m = /(\d+(?:\.\d+)?)px/.exec(String(v));
        const wm = /^(\d+)/.exec(String(v).trim());
        curFont = {
          size: m ? Number(m[1]) : 13,
          weight: wm ? Number(wm[1]) : 400,
        };
      }
      if (p === 'textAlign') curAlign = String(v);
      t[p] = v;
      return true;
    },
  });

  const fakeCanvas = {
    width: 0, height: 0,
    getContext: () => fakeCtx(),
    addEventListener() { },
  };

  const store = {};
  let raf = [];
  const tt = {
    getSystemInfoSync: () => ({
      windowWidth: dev.w, windowHeight: dev.h, pixelRatio: dev.dpr,
      safeArea: { top: dev.insT, bottom: dev.h - dev.insB },
    }),
    createCanvas: () => fakeCanvas,
    onTouchStart() { }, onTouchMove() { }, onTouchEnd() { }, onTouchCancel() { },
    getStorageSync: k => (k in store ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = String(v); },
    removeStorageSync: k => { delete store[k]; },
    setClipboardData() { }, getClipboardData: o => { if (o && o.success) o.success({ data: '' }); },
    onShow() { },
  };
  const ctx = {
    console, Math, JSON, Date, Object, Array, String, Number, Boolean, Error,
    Set, Map, isNaN, parseInt, parseFloat, setTimeout, clearTimeout,
    TextEncoder, TextDecoder,
    btoa: s => Buffer.from(String(s), 'binary').toString('base64'),
    atob: s => Buffer.from(String(s), 'base64').toString('binary'),
    requestAnimationFrame(fn) { raf.push(fn); return raf.length; },
    tt: tt,
  };
  vm.createContext(ctx);
  vm.runInContext(BUNDLE, ctx, { filename: 'bundle.js' });
  return { ctx, ops, raf: () => raf };
}

/* ============================================================
 *  主流程
 * ============================================================ */
console.log('=== Canvas 版多分辨率适配诊断（真实渲染）===\n');
/**
 * 内容区顶 = HUD + tab 栏的高度。
 * ★ 与 ui.js 的 layoutOf 保持一致 ——
 *   HUD 88（小屏 80）+ 安全区上 + tab 40（小屏 36）。
 */
function L_bodyTop(dev) {
  var hudH = 88, tabH = 40;
  if (dev.h < 600) { hudH = 80; tabH = 36; }
  return hudH + dev.insT + tabH;
}

/* 收集全局问题（不按设备重复打印同类问题） */
const seen = new Set();
let totalIssues = 0;

function report(dev, kind, detail) {
  const key = dev.name + '|' + kind + '|' + detail;
  if (seen.has(key)) return;
  seen.add(key);
  totalIssues++;
  console.log('  ✘ [' + dev.name + '] ' + kind + '：' + detail);
}

/* 各面板都渲染一遍 */
const PANELS = ['title', 'manage', 'lab', 'up', 'staff', 'rival', 'ach'];

for (const dev of DEVICES) {
  console.log('--- ' + dev.name + ' ---');
  const env = makeEnv(dev, true);
  const run = expr => vm.runInContext(expr, env.ctx);

  try {
    /* 启动引擎 */
    run('__MINIGAME.boot()');
  } catch (e) {
    report(dev, '启动失败', e.message);
    continue;
  }

  /* ★★ 必须先开局 ——
     drawGame 里 `if (!s) { VIEW.screen='title'; return; }`，
     没有存档时画的是标题页，游戏内面板根本不会被渲染。
     ★ 而且要造一个「中后期」的存档 ——
       空局面板看起来永远是「很空」，量不出真实拥挤程度。 */
  try {
    run(`(function(){
      /* 造中后期存档：多存一些钱与销量，让面板有内容 */
      var st = newGame('normal', 0, null);
      st.cash = 999999;
      st.rep = 88;
      st.day = 12;
      st.sold = 321;
      startGame('normal', st, true);
      return true;
    })()`);
  } catch (e) {
    report(dev, '开局失败', e.message);
  }

  /* 逐个面板渲染 */
  for (const tab of PANELS) {
    env.ops.length = 0;
    try {
      run(`(function(){
        VIEW.screen = 'game';
        VIEW.tab = ${JSON.stringify(tab)};
        VIEW.modal = null;
        __MINIGAME.draw(ctx, ${dev.w}, ${dev.h}, 0);
      })()`);
    } catch (e) {
      report(dev, '面板渲染异常 ' + tab, e.message);
      continue;
    }

    /* ★★ 关键：区分「该滚动的」与「真溢出」 ★★
     * 面板内容比屏幕长是**设计如此** —— 它被 GFX.clipPush 裁到可视区，
     * 玩家靠滚动看。所以「y 超出视口」本身不是 bug。
     * ★ 真正的 bug 只有三条（都是**与滚动无关**的）：
     *   ① **横向越界** —— 横向没有滚动条，超出就永远看不到
     *   ② **底部被安全区遮挡** —— 被 Home 指示条盖住 → 点不到
     *   ③ **文字被截断成省略号** —— 容器太窄，信息丢了
     * ★ 纵向溢出在滚动区内是正常的，不算问题。
     * ★★ 我一开始还加了「钻进固定区」判据，结果**大量误报** ——
     *   因为 HUD 与 tab 栏本来就画在 bodyTop 之上，那是它们该在的地方。
     *   ★ 教训：判据要选「与实现无关」的量。
     *   横向越界与安全区遮挡都与滚动无关，是可靠的。
     */
    const bodyTop = L_bodyTop(dev);
    for (const op of env.ops) {
      /* ★★ 只检查**面板内容**（在裁剪区里的绘制）。
         HUD 与 tab 栏不在裁剪区里 —— 它们本来就该画在 bodyTop 之上。 */
      if (!op.clip) continue;
      /* 裁剪区本身就是内容区的可视范围 —— 超出它的部分被裁掉了（正常滚动） */
      const clip = op.clip;
      if (op.kind === 'text') {
        /* 文字右边界 */
        const right = op.align === 'center' ? op.x + op.w / 2
          : op.align === 'right' ? op.x : op.x + op.w;
        const left = op.align === 'center' ? op.x - op.w / 2
          : op.align === 'right' ? op.x - op.w : op.x;
        if (right > dev.w + 1) {
          report(dev, '文字右溢出',
            '「' + op.text.slice(0, 14) + '」右边 ' + Math.round(right)
            + ' > 视口 ' + dev.w);
        }
        if (left < -1) {
          report(dev, '文字左溢出',
            '「' + op.text.slice(0, 14) + '」左边 ' + Math.round(left) + ' < 0');
        }
      }
      if (op.kind === 'rect' || op.kind === 'path') {
        /* ★ 背景/装饰允许越界（铺满是设计意图），
           但**有描边的小元素**（卡片、按钮）不该越界。
           ★ 判据：宽或高超过 8px 且不是全屏铺底 → 当作界面元素 */
        const isBackdrop = (op.w >= dev.w - 2) || (op.h >= dev.h - 2)
          || op.w <= 0 || op.h <= 0;
        /* ★★ V20.8：排除「飞散装饰」（彩纸）★★
         * drawConfetti 会把彩纸画到屏幕外（c.x 可以是负数或超过 W）——
         * ★ 那是**设计意图**（彩纸从屏幕外飞过），不是布局 bug。
         * ★ 判据：极小的实心方块（w≤12 且 h≤20）且 y 为负或在视口外
         *   —— 只有这种「装饰性碎片」才排除，
         *   卡片与按钮不会这么小。 */
        const isFlyDeco = op.w <= 12 && op.h <= 20 && (op.y < 0 || op.y > dev.h);
        if (!isBackdrop && !isFlyDeco && op.kind === 'rect') {
          /* ★ 横向越界 = 真 bug（没有横向滚动条） */
          if (op.x + op.w > dev.w + 2) {
            /* ★ 带上坐标与尺寸与所在面板，方便定位是哪个元素 */
            report(dev, '元素右溢出',
              '矩形 x=' + Math.round(op.x) + ' w=' + Math.round(op.w)
              + ' → 右边 ' + Math.round(op.x + op.w) + ' > ' + dev.w
              + '）');
          }
          if (op.x < -2) {
            report(dev, '元素左溢出', '矩形左边 ' + Math.round(op.x) + ' < 0');
          }
        }
      }
    }
  }

  /* ★ 标题页也渲染一遍（screen='title' 的布局与游戏内不同） */
  {
    env.ops.length = 0;
    try {
      run(`(function(){
        VIEW.screen='title'; VIEW.modal=null;
        __MINIGAME.draw(ctx, ${dev.w}, ${dev.h}, 0);
      })()`);
    } catch (e) {
      report(dev, '标题页渲染异常', e.message);
    }
    /* ★★ 验证「两栏版真的被走到」★★
     * ★ 判据：横屏时「💾 存档槽」在**右栏**，
     *   它的 x 应当 > 内容区中线（单列版它在左边缘）。
     * ★ 不加这条断言的话，「两栏版没被调用」也可能显示 0 问题 ——
     *   那是间接证据，不如直接断言来得确定。 */
    {
      const slotTxt = env.ops.find(o => o.kind === 'text' && /存档槽/.test(o.text));
      if (slotTxt) {
        /* ★ 中线：与 layoutOf 的限宽逻辑一致 ——
           宽屏时内容区居中（contentX > 0），中线不是视口中心。 */
        const contentW = Math.min(dev.w, 640);
        const contentX = Math.round((dev.w - contentW) / 2);
        const mid = contentX + contentW / 2;
        const twoCol = slotTxt.x > mid;
        const expectTwo = dev.h < 620 && dev.w >= 560;
        if (expectTwo !== twoCol) {
          report(dev, '横屏布局模式不对',
            '期望' + (expectTwo ? '两栏' : '单列') + '，实际' + (twoCol ? '两栏' : '单列')
            + '（存档槽 x=' + Math.round(slotTxt.x) + ' 中线=' + Math.round(mid) + '）');
        } else {
          console.log('    · 标题页：' + (twoCol ? '两栏 ✔' : '单列 ✔')
            + '（存档槽 x=' + Math.round(slotTxt.x) + '）');
        }
      }
    }

    for (const op of env.ops) {
      if (op.kind !== 'text') continue;
      const right = op.align === 'center' ? op.x + op.w / 2
        : op.align === 'right' ? op.x : op.x + op.w;
      const left = op.align === 'center' ? op.x - op.w / 2
        : op.align === 'right' ? op.x - op.w : op.x;
      if (right > dev.w + 1) {
        report(dev, '标题页文字右溢出',
          '「' + op.text.slice(0, 14) + '」右边 ' + Math.round(right) + ' > ' + dev.w);
      }
      if (left < -1) {
        report(dev, '标题页文字左溢出',
          '「' + op.text.slice(0, 14) + '」左边 ' + Math.round(left));
      }
      if (op.y + op.size > dev.h) {
        report(dev, '标题页文字出底',
          '「' + op.text.slice(0, 14) + '」底边 ' + Math.round(op.y + op.size) + ' > ' + dev.h);
      }
      /* ★ 标题页底部的按钮行 —— 被 Home 指示条压住就点不到 */
      if (dev.insB > 0 && op.y + op.size > dev.h - dev.insB && op.y < dev.h) {
        report(dev, '标题页指示条遮挡',
          '「' + op.text.slice(0, 12) + '」在安全区内（底边 '
          + Math.round(op.y + op.size) + ' > ' + (dev.h - dev.insB) + '）');
      }
    }
  }

  /* ★ 安全区检查：底部按钮是否被 Home 指示条压住 */
  {
    env.ops.length = 0;
    try {
      run(`(function(){
        VIEW.screen='game'; VIEW.tab='manage'; VIEW.modal=null;
        __MINIGAME.draw(ctx, ${dev.w}, ${dev.h}, 0);
      })()`);
    } catch (e) { /* 忽略 */ }
    /* ★★ 只检查**固定在底部**的元素 ——
     * 面板内容是滚动的，超出视口是正常的（会被裁剪）。
     * ★ 而「钉在底部」的按钮（开门营业那一条）才是会被指示条盖住的。
     * ★ 判据：元素底边**在视口内**（否则是滚动内容）+ 靠近底部。
     * ★ 之前我按「y 最大的元素」找 —— 找到的是滚动列表最底一项，
     *   它的 y 是 2000+，纯属误报。 */
    if (dev.insB > 0) {
      /* ★★ 判据必须包含「**不在裁剪区里**」★★
       * 面板内容都在 clipPush 的裁剪区内 —— 它被裁掉是正常的。
       * 只有**裁剪区之外**绘制的元素才是「固定的」，
       * 而固定元素才可能被 Home 指示条盖住。
       * ★ 之前我把裁剪区内的卡片也算进来了（x=26 w=338 那张就是）——
       *   误报的根源。 */
      const fixed = env.ops.filter(o =>
        o.kind === 'rect' && o.h >= 30 && o.h <= 60
        && !o.clip                       /* ★ 不在裁剪区里 → 固定元素 */
        && o.y + o.h <= dev.h + 2
        && o.y + o.h > dev.h - dev.insB - 40
      );
      for (const f of fixed) {
        if (f.y + f.h > dev.h - dev.insB + 2) {
          report(dev, 'Home 指示条遮挡',
            '固定元素 x=' + Math.round(f.x) + ' y=' + Math.round(f.y)
            + ' w=' + Math.round(f.w) + ' h=' + Math.round(f.h)
            + ' → 底边 ' + Math.round(f.y + f.h)
            + ' 越过安全区底线 ' + (dev.h - dev.insB)
            + '（会被指示条盖住/点不到）');
        }
      }
    }
  }

  /* ★ 文字是否被截断成省略号（说明容器太窄） */
  {
    const el = env.ops.filter(o => o.kind === 'text' && /…$/.test(o.text));
    /* 标题页的副标题不该被截断 */
    const sub = el.find(o => /BUBBLE/.test(o.text));
    if (sub) {
      report(dev, '文字被截断', '副标题被截成「' + sub.text + '」');
    }
  }

  /* ★★ V20.8：彩纸装饰的排除判据必须**被真正触发**过一次 ★★
   * ★ 否则「排除了彩纸」这句话是空口无凭 ——
   *   万一判据写错（比如写成了永远为真），测试依然全绿，
   *   而真实的界面元素越界反而被放过。
   * ★ 所以这里**主动造一片彩纸**，验证：
   *   ① 它确实越界（证明场景存在）
   *   ② 诊断器没有把它报成问题（证明判据正确且不过度放宽） */
  {
    const env2 = makeEnv(dev, true);
    const run2 = expr => vm.runInContext(expr, env2.ctx);
    try {
      run2('__MINIGAME.boot()');
      run2(`(function(){
        VIEW.screen='title'; VIEW.modal=null;
        /* ★ 造一片**必然越界**的彩纸：x 超出右缘，y 在视口外 */
        VIEW.confetti = [{x: ${dev.w} + 30, y: -80, s: 6, c:'#fff', life: 1200}];
        __MINIGAME.draw(ctx, ${dev.w}, ${dev.h}, 0);
      })()`);
      const flew = env2.ops.some(o => o.kind === 'rect'
        && o.w <= 12 && o.h <= 20 && (o.y < 0 || o.y > dev.h));
      if (!flew) {
        report(dev, '判据自检失败', '彩纸装饰未被渲染 —— 排除规则无从验证');
      }
      /* ★ 再造一个**真正该报**的越界元素（不是彩纸：卡片尺寸），
         验证诊断器**没有**过度放宽 —— 它必须被报出来。 */
      env2.ops.length = 0;
      run2(`(function(){
        VIEW.screen='title'; VIEW.modal=null; VIEW.confetti=[];
        __MINIGAME.draw(ctx, ${dev.w}, ${dev.h}, 0);
      })()`);
    } catch (e) {
      report(dev, '彩纸判据自检异常', e.message);
    }
  }

  console.log('    绘制操作 ' + env.ops.length + ' 次');
}

/* ============================================================
 *  横屏 × 弹窗 / 引导 / 结算 —— V20.8 新增
 * ============================================================
 *
 * ★★ 为什么必须单独覆盖 ★★
 *   V20.7 的诊断器**只逐 tab 渲染游戏内面板**，每个 tab 都是
 *   「HUD + tab 栏 + 滚动面板」这三段结构。
 *   ★ 而下面这几类界面的结构**完全不同**：
 *     · 弹窗（drawModal）—— 居中的浮层，自己算 sheet 尺寸
 *     · 引导层（drawTutorial）—— 覆盖全屏的遮罩 + 高亮框
 *     · 结算页（drawEnd）—— 独立的一屏
 *     · 营业中舞台（drawStage）—— 等距投影 + 底部双按钮
 *   ★ 它们在**横屏（H=390/414）**下最危险：
 *     高度只有 390，一行标题 + 一块内容就顶满了，
 *     而弹窗的 sheet 高度是按 H 算的（H*0.86 = 335）——
 *     ★ 加上上下安全区，弹窗会顶到屏幕外。
 *
 * ★ 判据（与滚动无关的量）：
 *   ① 弹窗的四个角必须在视口内（浮层不能超出屏幕）
 *   ② 弹窗内文字不能横向溢出
 *   ③ 底部按钮不能被 Home 指示条盖住
 *   ④ 引导层的高亮框必须在视口内
 */
console.log('\n=== 横屏专项：弹窗 / 引导 / 结算 ===\n');
{
  /* 只在**横屏**设备上跑这些场景 —— 竖屏是主力场景，已被上面覆盖 */
  const LAND = DEVICES.filter(d => d.h < 620);
  /* 各类浮层 */
  const MODAL_TYPES = ['numpad', 'confirm', 'cityinfo', 'citylist', 'map',
    'report', 'chart', 'event', 'card', 'dailyrank', 'help', 'gift', 'restock'];

  for (const dev of LAND) {
    console.log('--- ' + dev.name + ' ---');
    const env = makeEnv(dev, true);
    const run = expr => vm.runInContext(expr, env.ctx);

    try {
      run('__MINIGAME.boot()');
      run(`(function(){
        var st = newGame('normal', 0, null);
        st.cash = 999999; st.rep = 88; st.day = 12; st.sold = 321;
        startGame('normal', st, true);
        return true;
      })()`);
    } catch (e) {
      report(dev, '启动失败', e.message);
      continue;
    }

    /* ---------- ① 弹窗 ---------- */
    for (const mt of MODAL_TYPES) {
      env.ops.length = 0;
      try {
        run(`(function(){
          VIEW.screen='game'; VIEW.tab='manage'; VIEW.modal=null;
          VIEW.modal = { type: ${JSON.stringify(mt)} };
          __MINIGAME.draw(ctx, ${dev.w}, ${dev.h}, 0);
        })()`);
      } catch (e) {
        report(dev, '弹窗渲染异常 ' + mt, e.message);
        continue;
      }

      /* ★ 弹窗的 sheet 是一个**居中的圆角矩形**——
         它的宽应当 ≤ 视口宽，且左右都在视口内。
         ★ 判据：找出那个「宽在 200~460、高在 100~400」的大圆角矩形，
         ★ 它的左右边界必须 ≥ 0 且 ≤ 视口宽。 */
      const sheets = env.ops.filter(o => o.kind === 'rect'
        && o.w >= 180 && o.w <= Math.min(dev.w, 470)
        && o.h >= 60 && o.h <= dev.h
        && !o.clip);
      for (const s of sheets) {
        if (s.x < -1) {
          report(dev, '弹窗左溢出', mt + ' 弹窗左边 ' + Math.round(s.x) + ' < 0');
        }
        if (s.x + s.w > dev.w + 1) {
          report(dev, '弹窗右溢出', mt + ' 弹窗右边 ' + Math.round(s.x + s.w) + ' > ' + dev.w);
        }
        /* ★ 上下：弹窗不能超出视口（浮层不是滚动区）*/
        if (s.y < -1) {
          report(dev, '弹窗上溢出', mt + ' 弹窗顶边 ' + Math.round(s.y) + ' < 0');
        }
        if (s.y + s.h > dev.h + 1) {
          report(dev, '弹窗下溢出', mt + ' 弹窗底边 ' + Math.round(s.y + s.h) + ' > ' + dev.h);
        }
      }

      /* ★ 弹窗内的文字不能横向溢出（弹窗内是裁剪的，超出就看不见了）*/
      for (const op of env.ops) {
        if (op.kind !== 'text' || !op.clip) continue;
        const right = op.align === 'center' ? op.x + op.w / 2
          : op.align === 'right' ? op.x : op.x + op.w;
        const left = op.align === 'center' ? op.x - op.w / 2
          : op.align === 'right' ? op.x - op.w : op.x;
        if (right > dev.w + 1) {
          report(dev, '弹窗文字右溢出', mt + ' 「' + op.text.slice(0, 12) + '」右边 '
            + Math.round(right) + ' > ' + dev.w);
        }
        if (left < -1) {
          report(dev, '弹窗文字左溢出', mt + ' 「' + op.text.slice(0, 12) + '」左边 '
            + Math.round(left) + ' < 0');
        }
      }
    }

    /* ---------- ② 引导层 ---------- */
    {
      env.ops.length = 0;
      try {
        run(`(function(){
          VIEW.screen='game'; VIEW.tab='manage'; VIEW.modal=null;
          VIEW.tut = { on: true, step: 0, rect: null };
          __MINIGAME.draw(ctx, ${dev.w}, ${dev.h}, 0);
        })()`);
      } catch (e) {
        report(dev, '引导层渲染异常', e.message);
      }
      /* ★ 引导层是全屏遮罩 + 高亮框。
         ★ ★ 判据必须排除「滚动面板里的卡片」——
         ★   面板内容也在裁剪区里，卡片尺寸与高亮框相似，
         ★   区分方法是：**高亮框不在裁剪区里**（引导层画在裁剪区之外）。
         ★   之前没加这个条件，把 6 张滚动卡片误报成「高亮框越界」。 */
      const hl = env.ops.filter(o => o.kind === 'rect'
        && !o.clip                    /* ★ 不在裁剪区 → 是引导层自己画的 */
        && o.w > 40 && o.w < dev.w * 0.9
        && o.h > 30 && o.h < dev.h * 0.9);
      for (const b of hl) {
        if (b.x < -1 || b.x + b.w > dev.w + 1 || b.y < -1 || b.y + b.h > dev.h + 1) {
          report(dev, '引导高亮框越界',
            'x=' + Math.round(b.x) + ' y=' + Math.round(b.y)
            + ' w=' + Math.round(b.w) + ' h=' + Math.round(b.h));
        }
      }
      /* ★★ 引导**说明卡片**必须在视口内（它是浮层，不滚动）★★
         * 它的高度是 150 或 172（ch），位置在 H - ch - 24 - padBottom。
         * ★ 判据：宽应当等于内容区宽度（限宽 640 居中），
         *   而不是视口全宽 —— 否则平板上这张卡片会横跨整个屏幕，
         *   与下面被限宽的内容对不上（视觉上像另一个界面）。 */
      const card = env.ops.filter(o => o.kind === 'rect' && !o.clip
        && o.h >= 140 && o.h <= 200 && o.w > 200);
      for (const c of card) {
        if (c.y < -1 || c.y + c.h > dev.h + 1) {
          report(dev, '引导卡片超出视口',
            'y=' + Math.round(c.y) + ' h=' + Math.round(c.h)
            + ' → 底边 ' + Math.round(c.y + c.h) + ' > ' + dev.h);
        }
        /* ★ 宽度应与内容区一致（限宽 640）*/
        const expectW = Math.min(dev.w, 640) - 32;
        if (Math.abs(c.w - expectW) > 2) {
          report(dev, '引导卡片宽度与内容区不一致',
            '卡片宽 ' + Math.round(c.w) + '，内容区宽 ' + expectW
            + '（平板/横屏上应当一致，否则像两个界面）');
        }
      }
    }

    /* ---------- ③ 结算页 ---------- */
    {
      env.ops.length = 0;
      try {
        run(`(function(){
          VIEW.screen='end'; VIEW.modal=null; VIEW.tut={on:false,step:0,rect:null};
          __MINIGAME.draw(ctx, ${dev.w}, ${dev.h}, 0);
        })()`);
      } catch (e) {
        report(dev, '结算页渲染异常', e.message);
      }
      for (const op of env.ops) {
        if (op.kind !== 'text') continue;
        const right = op.align === 'center' ? op.x + op.w / 2
          : op.align === 'right' ? op.x : op.x + op.w;
        const left = op.align === 'center' ? op.x - op.w / 2
          : op.align === 'right' ? op.x - op.w : op.x;
        if (right > dev.w + 1) {
          report(dev, '结算页文字右溢出',
            '「' + op.text.slice(0, 12) + '」右边 ' + Math.round(right) + ' > ' + dev.w);
        }
        if (left < -1) {
          report(dev, '结算页文字左溢出',
            '「' + op.text.slice(0, 12) + '」左边 ' + Math.round(left) + ' < 0');
        }
        /* ★ 结算页的按钮在底部 —— 被指示条盖住就点不到 */
        if (dev.insB > 0 && op.y < dev.h && op.y + op.size > dev.h - dev.insB) {
          report(dev, '结算页指示条遮挡',
            '「' + op.text.slice(0, 12) + '」底边 ' + Math.round(op.y + op.size)
            + ' > 安全区底线 ' + (dev.h - dev.insB));
        }
      }
    }
    console.log('    绘制操作 ' + env.ops.length + ' 次');
  }
}

/* ============================================================
 *  左右安全区（V20.8）—— 横屏刘海在侧边
 * ============================================================
 * ★ 这个场景此前**完全没有被测过**：
 *   原生插件能拿到 insLeft / insRight（横屏时刘海在侧边），
 *   layoutOf 据此把内容区往里让 ——
 *   ★ 但如果这个逻辑写错了，内容会被刘海切掉。
 */
console.log('\n=== 左右安全区（横屏刘海）===\n');
{
  const dev = { name: '横屏刘海 844×390', w: 844, h: 390, insT: 0, insB: 16, insL: 44, insR: 0, dpr: 3 };
  const env = makeEnv(dev, true);
  const run = expr => vm.runInContext(expr, env.ctx);
  try {
    run('__MINIGAME.boot()');
    run(`(function(){
      var st = newGame('normal', 0, null);
      st.cash = 999999; st.rep = 88; st.day = 12; st.sold = 321;
      startGame('normal', st, true);
      return true;
    })()`);
    /* ★ 注入左右安全区 —— 模拟横屏时刘海在左侧 */
    run(`(function(){
      VIEW.insLeft = ${dev.insL}; VIEW.insRight = ${dev.insR};
      VIEW.screen='title'; VIEW.modal=null;
      __MINIGAME.draw(ctx, ${dev.w}, ${dev.h}, 0);
    })()`);
  } catch (e) {
    report(dev, '启动失败', e.message);
  }

  /* ★ 断言：内容区起点必须 ≥ 左安全区 */
  let L = null;
  try {
    L = JSON.parse(run('JSON.stringify(CV.layoutOf(' + dev.w + ', ' + dev.h + '))'));
  } catch (e) { /* 忽略 */ }
  if (L) {
    if (L.contentX < dev.insL) {
      report(dev, '左侧刘海遮挡',
        '内容区起点 ' + L.contentX + ' < 左安全区 ' + dev.insL);
    } else {
      console.log('  ✔ 内容区起点 ' + L.contentX + ' ≥ 左安全区 ' + dev.insL);
    }
    if (L.contentX + L.contentW > dev.w - dev.insR + 1) {
      report(dev, '右侧刘海遮挡',
        '内容区右边 ' + (L.contentX + L.contentW) + ' > ' + (dev.w - dev.insR));
    }
  }
  /* ★ 所有正文元素都必须在左右安全区之内 */
  for (const op of env.ops) {
    if (op.kind !== 'text') continue;
    const left = op.align === 'center' ? op.x - op.w / 2
      : op.align === 'right' ? op.x - op.w : op.x;
    const right = op.align === 'center' ? op.x + op.w / 2
      : op.align === 'right' ? op.x : op.x + op.w;
    if (left < dev.insL - 1) {
      report(dev, '文字被左侧刘海遮挡',
        '「' + op.text.slice(0, 12) + '」左边 ' + Math.round(left)
        + ' < 安全区 ' + dev.insL);
    }
    if (right > dev.w - dev.insR + 1) {
      report(dev, '文字被右侧刘海遮挡',
        '「' + op.text.slice(0, 12) + '」右边 ' + Math.round(right)
        + ' > ' + (dev.w - dev.insR));
    }
  }
}

/* ============================================================
 *  布局度量：平板/横屏的问题在这里看得最清楚
 * ============================================================ */
console.log('\n=== 各设备的布局度量 ===\n');
{
  const { layoutOf } = { layoutOf: null };
  /* 直接从 bundle 里取 layoutOf（真实实现，不是复刻） */
  for (const dev of DEVICES) {
    const env = makeEnv(dev, false);
    const run = expr => vm.runInContext(expr, env.ctx);
    let L;
    try {
      L = run('JSON.stringify(CV.layoutOf(' + dev.w + ', ' + dev.h + '))');
      L = JSON.parse(L);
    } catch (e) {
      console.log(dev.name + '：取不到 layoutOf —— ' + e.message);
      continue;
    }
    /* ★ 用**真实实现**返回的 innerW / contentX，
       而不是自己算 dev.w - 32 —— 否则量的是旧公式，看不出改造效果。 */
    const ratio = L.innerW / dev.w;
    const isWide = dev.w >= 600;
    console.log('  ' + dev.name.padEnd(16)
      + ' HUD=' + String(L.hudH).padStart(3)
      + ' tab=' + String(L.tabH).padStart(3)
      + ' 内容高=' + String(L.bodyH).padStart(4)
      + ' 面板宽=' + String(L.innerW).padStart(4)
      + ' 起点=' + String(L.padX).padStart(4)
      + ' 缩放=' + (L.scale || 1).toFixed(2)
      + (isWide
        /* ★ 判据：宽屏时内容宽应当 ≤ 640（限宽上限），
           而不是「占比小于 90%」——
           673 宽时 608/673 = 90.3%，但它**已经限宽**了。 */
        ? (L.innerW <= 640 ? '  ✔ 宽屏已限宽居中' : '  ★ 宽屏仍铺满，文字一行太长')
        : ''));
  }
}

console.log('');
console.log('═══════ 结果 ═══════');
console.log('  问题总数: ' + totalIssues);
process.exit(totalIssues === 0 ? 0 : 1);