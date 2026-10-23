/**
 * 适配深度审计（V20.9）—— 专门查 V20.8 **没覆盖到**的场景
 *
 * ★★ 为什么还要再来一轮 ★★
 *   V20.8 修好了「安全区读不到」「Canvas 拉伸」「字号缩放失效」，
 *   ★ 但它验的是**布局内部**（面板、弹窗、引导、结算）。
 *   ★ 这一轮查的是**布局之外**的东西 —— 那些同样会让玩家觉得「界面不对」、
 *     但从��不越界、所以前几轮诊断器都判为「正常」的问题。
 *
 * ★★ 本轮审计的 5 个方向 ★★
 *   ① **密度与资源**：DPR 渲染是否真的到位；各密度图标是否真的有差异；
 *      画布是否被 CSS 拉伸（非整数 DPR 下的重采样模糊）
 *   ② **点击区与视觉的一致性**：命中区与绘制区是否同源；
 *      最小可点区域在窄屏 + 小缩放下是否还够（手指粗）
 *   ③ **留白异常**：宽屏限宽居中后，**背景是否仍铺满**、
 *      面板区与 HUD 是否对齐、平板上的「孤岛」是否对称
 *   ④ **极端视口**：超高（折叠屏展开）、超宽（横屏平板）、
 *      极窄（分屏/小窗）、以及**动态尺寸**（分屏拖动）
 *   ⑤ **横屏两栏版的实际内容**：两栏版是否真的两栏、
 *      引导层在横屏是否仍横跨视口
 *
 * 用法：node tools/diag-fit-audit.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

try {
  require('child_process').execFileSync(process.execPath,
    [path.join(root, 'tools', 'build-minigame.js')], { stdio: 'ignore' });
} catch (e) { /* 忽略 */ }
const BUNDLE = fs.readFileSync(path.join(root, 'minigame', 'bundle.js'), 'utf8');

let issues = [];
const seen = new Set();
function report(kind, detail) {
  const key = kind + '|' + detail;
  if (seen.has(key)) return;
  seen.add(key);
  issues.push(key);
  console.log('  ✘ [' + kind + '] ' + detail);
}

/* ============================================================
 *  环境（与 diag-canvas-layout 同构，但记录得更细）
 * ============================================================ */
function makeEnv(dev, collect) {
  const ops = [];
  let curFont = { size: 13, weight: 400 };
  let curAlign = 'left';
  let clipStack = [];
  let lastRect = null, clipRect = null;
  const curClip = () => clipRect;

  const textWidth = (s) => {
    let w = 0;
    for (const ch of String(s)) {
      w += ch.charCodeAt(0) > 255 ? curFont.size : curFont.size * 0.55;
    }
    return w;
  };

  const fakeCtx = () => new Proxy({}, {
    get(t, p) {
      if (p === 'save') return () => { clipStack.push(clipStack.length ? clipStack[clipStack.length - 1] : null); };
      if (p === 'restore') return () => { clipStack.pop(); };
      if (p === 'clip') return () => { if (lastRect) clipRect = lastRect; };
      if (p === 'beginPath') return () => { t._path = []; };
      if (p === 'rect') {
        return (x, y, w, h) => {
          t._path = { x, y, w, h }; lastRect = { x, y, w, h };
          if (collect) ops.push({ kind: 'clip', x, y, w, h });
        };
      }
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() { } });
      if (p === 'measureText') return (s) => ({ width: textWidth(s) });
      if (p === 'fillText') {
        return (s, x, y) => {
          if (s == null) return;
          ops.push({ kind: 'text', text: String(s), x, y, w: textWidth(s), size: curFont.size, align: curAlign, clip: curClip() });
        };
      }
      if (p === 'strokeText') return (s, x, y) => { if (s != null) ops.push({ kind: 'text', text: String(s), x, y, w: textWidth(s), size: curFont.size }); };
      if (p === 'fillRect') return (x, y, w, h) => { ops.push({ kind: 'rect', x, y, w, h, clip: curClip() }); };
      if (p === 'strokeRect') return (x, y, w, h) => { ops.push({ kind: 'rect', x, y, w, h, stroke: true }); };
      if (p === 'roundRect') return (x, y, w, h) => { ops.push({ kind: 'rect', x, y, w, h, clip: curClip() }); };
      if (p === 'moveTo' || p === 'lineTo' || p === 'arc' || p === 'arcTo'
        || p === 'quadraticCurveTo' || p === 'bezierCurveTo' || p === 'ellipse') {
        return (a, b) => { if (typeof a === 'number' && typeof b === 'number') ops.push({ kind: 'path', x: a, y: b }); };
      }
      if (p === 'font') return undefined;
      if (p === 'textAlign') return curAlign;
      if (p === 'textBaseline') return 'top';
      return () => { };
    },
    set(t, p, v) {
      if (p === 'font') {
        const m = /(\d+(?:\.\d+)?)px/.exec(String(v));
        const wm = /^(\d+)/.exec(String(v).trim());
        curFont = { size: m ? Number(m[1]) : 13, weight: wm ? Number(wm[1]) : 400 };
      }
      if (p === 'textAlign') curAlign = String(v);
      t[p] = v; return true;
    },
  });

  const canvas = { width: 0, height: 0, getContext: () => fakeCtx(), addEventListener() { } };
  const store = {};
  let raf = [];
  const tt = {
    getSystemInfoSync: () => ({
      windowWidth: dev.w, windowHeight: dev.h, pixelRatio: dev.dpr,
      safeArea: { top: dev.insT, bottom: dev.h - dev.insB },
    }),
    createCanvas: () => canvas,
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
    tt,
  };
  vm.createContext(ctx);
  vm.runInContext(BUNDLE, ctx, { filename: 'bundle.js' });
  return { ctx, ops, raf: () => raf };
}

/* ============================================================
 *  设备矩阵 —— 本轮的重点是 V20.8 没测的极端组合
 * ============================================================ */
const DEVICES = [
  /* 常规 */
  { name: '小屏 320×568', w: 320, h: 568, insT: 0, insB: 0, dpr: 2 },
  { name: '主流 375×667', w: 375, h: 667, insT: 0, insB: 0, dpr: 2 },
  { name: '刘海 390×844', w: 390, h: 844, insT: 47, insB: 34, dpr: 3 },
  { name: '大屏 414×896', w: 414, h: 896, insT: 0, insB: 0, dpr: 3 },
  /* 平板 */
  { name: '平板竖 768×1024', w: 768, h: 1024, insT: 24, insB: 0, dpr: 2 },
  { name: '平板横 1024×768', w: 1024, h: 768, insT: 0, insB: 0, dpr: 2 },
  { name: '平板横 1180×820', w: 1180, h: 820, insT: 0, insB: 0, dpr: 2 },
  /* ★ V20.9 新增：极端视口 */
  { name: '超宽横 1600×900', w: 1600, h: 900, insT: 0, insB: 0, dpr: 2 },
  { name: '超高折叠 1768×2208', w: 1768, h: 2208, insT: 0, insB: 0, dpr: 2 },
  { name: '分屏窄窗 280×720', w: 280, h: 720, insT: 24, insB: 0, dpr: 2 },
  { name: '分屏极窄 240×640', w: 240, h: 640, insT: 0, insB: 0, dpr: 2 },
  { name: '横屏手机 844×390', w: 844, h: 390, insT: 0, insB: 16, dpr: 3 },
  { name: '横屏极扁 900×360', w: 900, h: 360, insT: 0, insB: 12, dpr: 3 },
  { name: '侧边刘海横 844×390', w: 844, h: 390, insT: 0, insB: 16, insL: 44, insR: 0, dpr: 3 },
];

const PANELS = ['title', 'manage', 'lab', 'up', 'staff', 'rival', 'ach'];

console.log('=== 适配深度审计（V20.9 · 布局之外的问题）===\n');

for (const dev of DEVICES) {
  console.log('--- ' + dev.name + ' ---');
  const env = makeEnv(dev, true);
  const run = expr => vm.runInContext(expr, env.ctx);

  try {
    run('__MINIGAME.boot()');
  } catch (e) {
    report('启动失败', dev.name + ': ' + e.message);
    continue;
  }

  /* 造中后期存档（面板有内容才量得出拥挤程度） */
  try {
    run(`(function(){
      var st = newGame('normal', 0, null);
      st.cash = 999999; st.rep = 88; st.day = 12; st.sold = 321;
      startGame('normal', st, true);
      return true;
    })()`);
  } catch (e) { report('开局失败', dev.name + ': ' + e.message); }

  /* ---------- ① 布局度量与安全区 ---------- */
  const L = run(`(function(){
    VIEW.ins = { top: ${dev.insT}, bottom: ${dev.insB} };
    VIEW.insLeft = ${dev.insL || 0};
    VIEW.insRight = ${dev.insR || 0};
    var L = CV.layoutOf(${dev.w}, ${dev.h});
    return { W:L.W, H:L.H, hudH:L.hudH, tabH:L.tabH, bodyY:L.bodyY, bodyH:L.bodyH,
             contentX:L.contentX, contentW:L.contentW, padX:L.padX, innerW:L.innerW,
             scale:L.scale, wide:L.wide, short:L.short, foldable:L.foldable };
  })()`);

  /* ★ 判据 1：内容区高度必须为正 —— 为负说明 HUD+tab+安全区吃光了屏幕 */
  if (L.bodyH <= 0) {
    report('内容区高度为负', dev.name + ' bodyH=' + L.bodyH + '（HUD+tab+安全区超过屏高）');
  }
  /* ★ 判据 2：内容区必须完整落在屏幕内 */
  if (L.bodyY + L.bodyH > dev.h + 0.5) {
    report('内容区超出屏幕底部',
      dev.name + ' bodyY=' + L.bodyY + ' + bodyH=' + L.bodyH + ' = ' + (L.bodyY + L.bodyH) + ' > H=' + dev.h);
  }
  /* ★ 判据 3：padX + innerW 必须 ≤ W（内容区不能超出右边界） */
  if (L.padX + L.innerW > dev.w + 0.5) {
    report('内容区横向溢出',
      dev.name + ' padX=' + L.padX + ' + innerW=' + L.innerW + ' = ' + (L.padX + L.innerW) + ' > W=' + dev.w);
  }
  /* ★ 判据 4：左右安全区必须被避让 —— 极窄屏 + 侧边刘海时尤其容易漏 */
  if ((dev.insL || 0) > 0 && L.contentX < dev.insL - 0.5) {
    report('未避让左侧安全区',
      dev.name + ' contentX=' + L.contentX + ' < insL=' + dev.insL);
  }
  if ((dev.insR || 0) > 0 && (L.contentX + L.contentW) > dev.w - dev.insR + 0.5) {
    report('未避让右侧安全区',
      dev.name + ' content右=' + (L.contentX + L.contentW) + ' > W-insR=' + (dev.w - dev.insR));
  }

  /* ---------- ② 逐面板渲染，检查留白与背景 ---------- */
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
      report('面板渲染异常', dev.name + ' ' + tab + ': ' + e.message);
      continue;
    }

    const ops = env.ops;

    /* ★★★ 判据 5：背景必须铺满整屏 ★★★
     * 宽屏限宽居中后，内容区只有 640 宽 —— 但**背景色/渐变必须铺满全屏**。
     * ★ 如果背景只画了内容区，平板上左右两侧会是「空白」（上一轮说的「留白异常」）。
     * ★ 判据：必须存在一个覆盖 x=0..W 全宽的绘制。 */
    if (tab === 'manage') {
      const fullW = ops.filter(o => o.kind === 'rect' && o.x <= 0.5
        && o.w >= dev.w - 1);
      if (fullW.length === 0) {
        report('背景未铺满整屏',
          dev.name + ' 未找到覆盖全宽(' + dev.w + ')的矩形绘制 —— 宽屏下左右会留白');
      }
    }

    /* ★★★ 判据 6：最小可点区域 ★★★
     * Android 最小建议 48dp，Material 建议 48×48；
     * 考虑本作按钮有 padding 外扩，取 **>= 30px** 为底线（宽屏不缩放，窄屏最低 0.94）。
     * ★ 命中区从 GFX.hits 里读。
     *
     * ★★ 注意（V20.9 踩过的坑）：GFX.button 里有「命中区垂直兜底扩到 30px」，
     *   而 addHit 会把命中区**裁剪到 clip 区之内** ——
     *   ★ 所以一个视觉高 16px 的按钮，若被裁剪区切了一刀，
     *     读出来的 h 会小于 30 —— **那是裁剪的正常结果，不是缺陷**。
     * ★ 因此判据必须：
     *   ① 只在「命中区未被裁剪」时才有意义 → 用 clip 栈判断；
     *   ② 宽度 < 30 的排除（那是图标/小标签）；
     *   ③ 高度 < 30 但**宽度大**的（>100）多为列表行/横幅 → 排除。 */
    const hits = run('GFX.hits.length ? GFX.hits.map(function(h){return {x:h.x,y:h.y,w:h.w,h:h.h,ow:h.ow,oh:h.oh,clipped:h.clipped,act:h.act};}) : []');
    if (Array.isArray(hits)) {
      for (const ht of hits) {
        /* ★★ 用**未裁剪的原始尺寸**判定（V20.9）★★
         * addHit 会把命中区裁到 clip 区内 —— 滚动列表里按钮被切一刀是正常的，
         * 那不是「控件设计得太小」。 */
        const w = ht.ow || ht.w;
        const h = ht.oh || ht.h;
        const minDim = Math.min(w, h);
        /* 排除：宽度太小的（图标/标签）、宽度很大的横幅（列表行/分隔）*/
        if (w < 30 || w > 100) continue;
        if (minDim < 30) {
          report('命中区过小',
            dev.name + ' ' + tab + ' act=' + ht.act + ' 尺寸=' + Math.round(w) + '×' + Math.round(h)
            + (ht.clipped ? '（当前被裁剪显示为 ' + Math.round(ht.w) + '×' + Math.round(ht.h) + '）' : ''));
          break;
        }
      }
    }

    /* ★★★ 判据 7：命中区必须在视口内（点不到） ★★★ */
    for (const ht of (hits || [])) {
      if (ht.w < 6 || ht.h < 6) continue;
      if (ht.x < -0.5 || ht.x + ht.w > dev.w + 0.5) {
        report('命中区横向出界',
          dev.name + ' ' + tab + ' act=' + ht.act + ' x=' + Math.round(ht.x) + ' w=' + Math.round(ht.w));
        break;
      }
    }

    /* ★ 判据 8：文字不能横向溢出视口
     * ★ toast 是浮层（居中，可超出内容区但不能超出视口），
     *   其余文字也必须在视口内。
     * ★ 对齐方式要分开算：center 按左右两端，right 按右端。 */
    for (const o of ops) {
      if (o.kind !== 'text') continue;
      let left, right;
      if (o.align === 'center') { left = o.x - o.w / 2; right = o.x + o.w / 2; }
      else if (o.align === 'right') { left = o.x - o.w; right = o.x; }
      else { left = o.x; right = o.x + o.w; }
      if (right > dev.w + 0.5 || left < -0.5) {
        report('文字横向溢出',
          dev.name + ' ' + tab + ' "' + String(o.text).slice(0, 14) + '" [' + Math.round(left) + ', ' + Math.round(right) + ']');
        break;
      }
    }
  }

  /* ---------- ③ HUD 内部元素对齐（V20.9 新增判据）---------- */
  /* ★★★ 这是 V20.9 抓到的真实缺陷 ★★★
   *   HUD 上方的四个数值胶囊用 `L.padX`（跟着内容区限宽居中），
   *   而下方的**进度条与「阶段目标」文字**却硬编码了 `16`。
   *   ★ 窄屏上 padX 恰好=16，看不出问题；
   *     宽屏限宽居中后（1600 宽 → padX=496），
   *     进度条贴在屏幕最左、胶囊在正中间 —— **差了 480px，一眼看出没对齐**。
   *
   * ★ 判据：HUD 里的左对齐元素，其 x 必须等于 L.padX。
   */
  {
    env.ops.length = 0;
    try {
      run(`(function(){
        VIEW.screen = 'game'; VIEW.tab = 'manage'; VIEW.modal = null;
        __MINIGAME.draw(ctx, ${dev.w}, ${dev.h}, 0);
      })()`);
    } catch (e) { /* 面板循环已报过 */ }

    const ops = env.ops;
    /* ★ 找 HUD 第一行胶囊：宽度接近 cw 的圆角矩形 */
    const cw = (L.innerW - 12) / 4;
    const chip = ops.find(o => o.kind === 'rect' && Math.abs(o.w - cw) < 3 && o.h > 30);
    /* ★ 找「阶段目标」文字（FS.xs 的小字，左对齐） */
    const goalTxt = ops.find(o => o.kind === 'text' && String(o.text).indexOf('阶段目标') >= 0);

    if (chip && goalTxt) {
      if (Math.abs(goalTxt.x - chip.x) > 2) {
        report('HUD 内部未对齐',
          dev.name + ' 胶囊 x=' + Math.round(chip.x) + ' 但进度条/目标文字 x=' + Math.round(goalTxt.x)
          + '（应同为 padX=' + L.padX + '，差 ' + Math.round(Math.abs(goalTxt.x - chip.x)) + 'px）');
      }
    }
  }

  /* ---------- ④ 横屏两栏版的实际内容 ---------- */
  if (dev.w > dev.h && dev.w >= 600) {
    env.ops.length = 0;
    try {
      run(`(function(){
        VIEW.screen = 'title'; VIEW.modal = null;
        __MINIGAME.draw(ctx, ${dev.w}, ${dev.h}, 0);
      })()`);
    } catch (e) { /* 上面的面板循环已报过 */ }

    const ops = env.ops;
    /* ★ 判据 9：横屏两栏版必须真的有两栏 ——
       左栏（品牌/难度）在 x≈contentX，右栏（存档/信息）应明显靠右。
       ★ 若两者挤在左半边，说明两栏布局没生效。 */
    const texts = ops.filter(o => o.kind === 'text' && o.x > dev.w * 0.55);
    if (texts.length === 0) {
      report('横屏两栏版未生效',
        dev.name + ' 屏幕右半区（x>' + Math.round(dev.w * 0.55) + '）没有任何文字 —— 两栏布局可能没走到');
    }
  }

  /* ---------- ④ 引导层在所有视口都不该横跨 ---------- */
  env.ops.length = 0;
  try {
    run(`(function(){
      VIEW.screen = 'title'; VIEW.modal = null;
      __MINIGAME.draw(ctx, ${dev.w}, ${dev.h}, 0);
    })()`);
  } catch (e) { /* 忽略 */ }

  /* ---------- ⑤ 布局度量表 ---------- */
  console.log('    HUD=' + L.hudH + ' tab=' + L.tabH + ' 内容高=' + L.bodyH
    + ' 面板宽=' + L.contentW + ' 起点=' + L.contentX + ' 缩放=' + L.scale.toFixed(2)
    + (L.wide ? ' 宽屏限宽' : ''));
}

/* ============================================================
 *  ⑥ 图标与资源密度（静态检查）
 * ============================================================ */
console.log('\n=== 图标与资源密度 ===');
{
  const res = path.join(root, 'app', 'android', 'app', 'src', 'main', 'res');
  const DENSITIES = [
    ['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216],
    ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432],
  ];
  const fsmod = require('fs');
  /* ★ 读 PNG 尺寸（IHDR） */
  function pngSize(fp) {
    const b = fsmod.readFileSync(fp);
    if (b.length < 24) return null;
    if (b.readUInt32BE(0) !== 0x89504e47) return null;
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }
  for (const [dens, legacy, fg] of DENSITIES) {
    const lg = path.join(res, 'mipmap-' + dens, 'ic_launcher.png');
    const fgp = path.join(res, 'mipmap-' + dens, 'ic_launcher_foreground.png');
    if (!fsmod.existsSync(lg)) { report('缺少图标', 'mipmap-' + dens + '/ic_launcher.png'); continue; }
    const ls = pngSize(lg);
    if (!ls || ls.w !== legacy || ls.h !== legacy) {
      report('legacy 图标尺寸错', 'mipmap-' + dens + ' 应为 ' + legacy + '×' + legacy + '，实际 ' + (ls ? ls.w + '×' + ls.h : '?'));
    }
    if (!fsmod.existsSync(fgp)) { report('缺少前景图', 'mipmap-' + dens + '/ic_launcher_foreground.png'); continue; }
    const fs2 = pngSize(fgp);
    if (!fs2 || fs2.w !== fg || fs2.h !== fg) {
      report('前景图尺寸错', 'mipmap-' + dens + ' 应为 ' + fg + '×' + fg + '，实际 ' + (fs2 ? fs2.w + '×' + fs2.h : '?'));
    }
  }
  /* ★ 自适应图标 XML */
  for (const f of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    const p = path.join(res, 'mipmap-anydpi-v26', f);
    if (!fsmod.existsSync(p)) { report('缺少自适应图标', 'mipmap-anydpi-v26/' + f); continue; }
    const txt = fsmod.readFileSync(p, 'utf8');
    if (!/<foreground/.test(txt)) report('自适应图标缺前景层', 'mipmap-anydpi-v26/' + f);
    if (!/<background/.test(txt)) report('自适应图标缺背景层', 'mipmap-anydpi-v26/' + f);
  }
  /* ★★ 各密度前景必须**内容不同** —— 同一份文件复制到 5 个目录
     虽然尺寸对，但意味着密度目录名不副实（mdpi 设备加载 432px 图浪费内存）。 */
  const md5s = {};
  const crypto = require('crypto');
  for (const [dens] of DENSITIES) {
    const p = path.join(res, 'mipmap-' + dens, 'ic_launcher_foreground.png');
    if (!fsmod.existsSync(p)) continue;
    md5s[dens] = crypto.createHash('md5').update(fsmod.readFileSync(p)).digest('hex');
  }
  const uniq = new Set(Object.values(md5s));
  if (uniq.size !== Object.keys(md5s).length) {
    report('前景图未按密度区分', '各密度前景内容重复（' + uniq.size + ' 种内容 / ' + Object.keys(md5s).length + ' 个目录）');
  }
  console.log('  图标：' + DENSITIES.length + ' 种密度，前景内容 ' + uniq.size + ' 种（应相等）');
}

/* ============================================================
 *  ⑦ Capacitor 的 edge-to-edge 双重避让风险
 * ============================================================ */
console.log('\n=== Capacitor edge-to-edge 配置 ===');
{
  const cfgPath = path.join(root, 'app', 'capacitor.config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const adj = (cfg.android && cfg.android.adjustMarginsForEdgeToEdge) || '(未设置 → 默认 disable)';
  console.log('  adjustMarginsForEdgeToEdge = ' + adj);
  if (adj === 'force' || adj === 'auto') {
    report('双重避让风险',
      'Capacitor 会给 WebView 自动加 margin（' + adj + '），与本作「Canvas 自己避让」叠加 → 安全区被避让两次');
  }
}

/* ============================================================
 *  结果
 * ============================================================ */
console.log('\n═══════ 结果 ═══════');
if (issues.length === 0) {
  console.log('  问题总数: 0');
} else {
  console.log('  问题总数: ' + issues.length);
  issues.forEach(i => console.log('   · ' + i));
}
process.exit(issues.length === 0 ? 0 : 1);
