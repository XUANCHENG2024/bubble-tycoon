'use strict';
/* ============================================================
 *  Canvas 界面层
 *
 *  这是 H5 版 js/ui.js 的对位文件：同一套业务逻辑，不同的绘制后端。
 *  分工与 H5 版一致 —— 只负责「画」和「收集命中区」，任何数值都来自
 *  engine.js，本文件不做任何游戏计算。
 *
 *  与 H5 版的本质区别：
 *    H5 版拼 innerHTML 字符串交给浏览器排版；
 *    这里必须自己算坐标、自己断行、自己裁剪滚动区域。
 *  所以元素一律用「当前 y 游标 + 返回高度」的写法拼装，改一处不会崩一片。
 * ============================================================ */

var VIEW = {
  screen: 'title',          /* title | game | end */
  tab: 'manage',
  modal: null,              /* 弹窗类型 + 附带数据 */
  scroll: { manage: 0, lab: 0, up: 0, staff: 0, rival: 0, ach: 0 },
  toasts: [],
  confetti: [],
  floaters: [],
  pressedAct: null,         /* 当前按下的命中项，用于按下反馈 */
  stageScroll: 0,           /* 出杯位区域的滚动量（员工多到一屏放不下时） */
  stageMax: 0,              /* 出杯位区域的最大滚动量，由 drawStage 每帧回写 */
  modalScroll: 0,           /* 弹窗内容滚动量（内容比弹窗高时，目前只有 help） */
  modalMax: 0,              /* 弹窗内容最大滚动量，由 drawModal 每帧回写 */
  tut: { on: false, step: 0, rect: null },
  tutRush: 0,               /* 引导「点击加速」那一步已点的次数 */
  ins: { top: 0, bottom: 0 },
  lastServed: 0,
  lastLost: 0,
};

/* 每个 Tab 的内容高度，滚动上限据此计算 */
var VIEW_H = 0;

/* ------------------------------------------------------------
 *  背景：与 H5 版同一套深色霓虹调
 * ---------------------------------------------------------- */
function drawBg(ctx, W, H) {
  var g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, T.bg0); g.addColorStop(0.55, T.bg1); g.addColorStop(1, T.bg0);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/* ------------------------------------------------------------
 *  布局：把各区域高度集中定义，改一处全局生效
 * ---------------------------------------------------------- */

/**
 * 视口分类 —— 决定「内容怎么排」。
 *
 * ★ 为什么需要它：
 *   原先只有 `H < 600` 一个断点，而**宽度完全没参与判断**。
 *   于是平板（768/1024 宽）上：
 *   · 面板宽 = 视口宽 − 32 = 736~992px
 *   · 一行文字横跨 736px —— 而中文正常阅读宽度是 30~40 字（约 300~400px）
 *   · 32 个配方按钮排成 8 列 × 4 行，每个只有 80px 宽
 *   ★ 表现就是「在手机上没问题，在平板上像被拉伸的网页」。
 *
 * ★ 三类视口：
 *   narrow  < 600  —— 手机竖屏（主力场景）
 *   wide   ≥ 600  —— 平板 / 横屏 / 折叠屏展开
 *   short  < 620 高 —— 横屏手机（高度紧张）
 */
function viewportClass(W, H) {
  return {
    wide: W >= 600,
    short: H < 620,
    /* ★ 折叠屏展开态：宽但不算平板（673~899 之间）——
       这类设备竖着拿是手机，横着拿是小平板，两种都要能用。 */
    foldable: W >= 600 && W < 900,
  };
}

/**
 * 全局缩放系数 —— 所有字号、间距都乘它。
 *
 * ★ 为什么不是「直接用物理像素」：
 *   固定 px 在 320 宽的小屏上挤（10px 的字太小），
 *   在 768 宽的平板上又显得小（22px 的标题在大屏上不够看）。
 *   ★ 所以按基准宽 375 等比缩放，并**夹在合理区间**里 ——
 *     太小看不清，太大在平板上会挤爆布局。
 */
function scaleOf(W) {
  if (W >= 600) return 1;              /* 宽屏另走「限宽居中」路线，不靠放大字号 */
  return Math.max(0.94, Math.min(1.10, W / 375));
}

function layoutOf(W, H) {
  var ins = VIEW.ins || { top: 0, bottom: 0 };
  var vp = viewportClass(W, H);
  var scale = scaleOf(W);

  /* HUD 分两行：第一行四个数值胶囊，第二行是目标进度条 + 右上角图标按钮。
     图标按钮必须独占第二行 —— 它们以前压在第一行右上角，390 宽时图标区从
     x=228 一直伸到 374，而「净资产」那格占 287~374，等于被整个盖住。 */
  var hudH = Math.round(88 * scale), tabH = Math.round(40 * scale);
  if (vp.short) { hudH = Math.round(80 * scale); tabH = Math.round(36 * scale); }
  /* 顶部给刘海 / 状态栏让出高度，底部给 Home 指示条让出高度。
     Canvas 没有 env(safe-area-inset-*)，这两个值由 platform.js 向宿主问来。 */
  hudH += ins.top;

  /* ★★ 宽屏：内容限宽居中 ★★
   * 平板上把内容限制在 640px 并居中 ——
   * · 一行文字不再横跨 992px（那是「一行太长」的根因）
   * · 卡片宽度有上限，视觉上才像「App」而不是「拉伸的网页」
   * · 左右留白是**有意的**（不是 bug）——
   *   所以底色（drawBg）仍铺满整屏，只有内容居中。
   *
   * ★ 阈值为什么是 600 而不是 640：
   *   折叠屏展开态常见宽度 673~899（Fold 内屏 673、Flip 外屏 720+）。
   *   ★ 673 宽时若不限宽，面板仍有 641px —— 一行 40 个字还是太长。
   *   ★ 所以判定用「宽屏」这个类（≥600），限宽值用 640 ——
   *     673 宽时面板 = min(673, 640) - 32 = 608，正好合适。
   */
  var MAX_CONTENT = 640;
  var contentW = W, contentX = 0;
  if (vp.wide) {
    contentW = Math.min(W, MAX_CONTENT);
    contentX = Math.round((W - contentW) / 2);
  }

  /* ★ 底部安全区：内容区高度必须**减掉**它 ——
     否则「开门营业」这类钉在底部的按钮会被 Home 指示条盖住。 */
  var bodyH = H - hudH - tabH - (ins.bottom || 0);

  return {
    W: W, H: H, hudH: hudH, tabH: tabH,
    bodyY: hudH + tabH,
    bodyH: bodyH,
    padTop: ins.top, padBottom: ins.bottom,
    /* ★ 新增：缩放与视口分类，供各处计算字号与间距 */
    scale: scale,
    wide: vp.wide, short: vp.short, foldable: vp.foldable,
    /* ★ 内容区（宽屏时是居中的那一块） */
    contentX: contentX, contentW: contentW,
    /* ★ 内容区左右留白：宽屏时按内容宽算，窄屏时固定 16 */
    padX: contentX + 16,
    innerW: contentW - 32,
  };
}

/* ------------------------------------------------------------
 *  字号：随缩放系数走
 * ---------------------------------------------------------- */
/**
 * 取缩放后的字号。
 * ★ 原先 FS 是固定 px（xs:10 … display:22），
 *   320 宽的小屏上 10px 偏小、768 宽的平板上 22px 偏小。
 * ★ 现在统一乘 L.scale —— 而 L.scale 只在窄屏上偏离 1，
 *   宽屏靠「限宽居中」而不是「放大字号」，
 *   （放大字号会让 32 个配方按钮在平板上占更多空间，反而更挤）
 */
function fs(L, key) {
  var base = FS[key] || FS.md;
  return Math.round(base * (L && L.scale ? L.scale : 1));
}


/* ============================================================
 *  标题页 · 横屏两栏版（V20.7）
 *
 * ★ 为什么单独一个函数而不是给 drawTitle 加分支：
 *   单列版与两栏版的**元素顺序完全一样**（难度→开始→存档→信息），
 *   只是排布方式不同。分成两个函数后每个都保持线性可读 ——
 *   ★ 而把两套排布塞进一个函数会得到 400 行的 if/else 迷宫。
 *
 * ★ 布局：
 *   左栏：Logo + 副标题 + 难度选择 + 开始营业 + 继续/挑战/日榜
 *   右栏：存档槽 + 元信息 + 战绩榜
 *   底部：签到 / 说明 / 导入 / 导出（横跨两栏）
 * ============================================================ */
function drawTitleWide(ctx, L, m) {
  var H = L.H;
  var gap = 16;
  /* ★ 两栏等宽 */
  var colW = Math.floor((L.innerW - gap) / 2);
  var lx = L.padX, rx = L.padX + colW + gap;
  var ly = 16 + L.padTop;
  var ry = ly;

  /* ─────────── 左栏：品牌 + 难度 + 开始 ─────────── */
  var lcx = lx + colW / 2;
  text(ctx, '\uD83E\uDDCB', lcx, ly, { size: 34, align: 'center' });
  ly += 40;
  text(ctx, '奶茶星球', lcx, ly,
    { size: 24, weight: 900, align: 'center', color: T.txt });
  ly += 28;
  text(ctx, 'BUBBLE TYCOON · 30 天街头奶茶帝国', lcx, ly,
    { size: fs(L, 'sm'), align: 'center', color: T.txt3, maxW: colW });
  ly += 22;

  text(ctx, '选择难度', lcx, ly, { size: fs(L, 'sm'), align: 'center', color: T.txt3 });
  ly += 16;
  var cw = (colW - 16) / 3, ch = 62;
  var ds = Object.keys(DIFFICULTY).map(function (k) { return DIFFICULTY[k]; });
  for (var i = 0; i < ds.length; i++) {
    var d = ds[i];
    GFX.cardBtn(ctx, lx + i * (cw + 8), ly, cw, ch, [
      { t: d.emoji, size: FS.display },
      { t: d.name, size: FS.md, weight: 800 },
      { t: money(d.goal), size: FS.xs, color: T.amber },
    ], { act: 'diff', id: d.key, on: VIEW.diff === d.key, pressed: isPressed('diff', d.key), center: true });
  }
  ly += ch + 12;

  var played = (m.dailyDate === todayKey() && m.dailyBest != null);
  GFX.button(ctx, lx, ly, colW, 44, '\uD83D\uDE80 开始营业',
    { kind: 'primary', act: 'start', size: FS.lg, pressed: isPressed('start') });
  ly += 50;

  /* ★ 「继续存档 / 每日挑战 / 日榜」放左栏底部 */
  if (hasAnySave()) {
    var bwT = (colW - 16) / 3;
    GFX.button(ctx, lx, ly, bwT, 36, '\uD83D\uDCBE 继续',
      { kind: 'ghost', act: 'continue', size: fs(L, 'xs'), pressed: isPressed('continue') });
    GFX.button(ctx, lx + bwT + 8, ly, bwT, 36, '\uD83D\uDCC5 挑战',
      { kind: 'amber', act: 'daily', size: fs(L, 'xs'), pressed: isPressed('daily') });
    GFX.button(ctx, lx + (bwT + 8) * 2, ly, bwT, 36, '\uD83C\uDFC6 日榜',
      { kind: 'ghost', act: 'dailyrank', size: fs(L, 'xs'), pressed: isPressed('dailyrank') });
    ly += 42;
  } else {
    var bw2 = (colW - 10) / 2;
    GFX.button(ctx, lx, ly, bw2, 36, played ? '\uD83D\uDCC5 最佳 ' + money(m.dailyBest) : '\uD83D\uDCC5 每日挑战',
      { kind: 'amber', act: 'daily', size: fs(L, 'xs'), pressed: isPressed('daily') });
    GFX.button(ctx, lx + bw2 + 10, ly, bw2, 36, '\uD83C\uDFC6 日榜',
      { kind: 'ghost', act: 'dailyrank', size: fs(L, 'xs'), pressed: isPressed('dailyrank') });
    ly += 42;
  }

  /* ─────────── 右栏：存档槽 + 元信息 + 战绩榜 ─────────── */
  var lg = loginState(m);
  text(ctx, '\uD83D\uDCBE 存档槽', rx, ry, { size: fs(L, 'sm'), color: T.txt3 });
  ry += 15;
  var sw = (colW - 16) / 3;
  for (var k = 0; k < CFG.SAVE_SLOTS; k++) {
    var info = slotInfo(k);
    var lines = info
      ? [
        { t: '槽 ' + (k + 1) + (getSlot() === k ? ' ✓' : ''), size: fs(L, 'sm'), weight: 800 },
        { t: 'Day ' + info.day + (info.endless ? ' ∞' : ''), size: fs(L, 'xs'), color: T.txt2 },
        { t: money(info.worth), size: fs(L, 'xs'), color: T.amber },
      ]
      : [{ t: '槽 ' + (k + 1), size: fs(L, 'sm'), weight: 800 },
        { t: '空', size: fs(L, 'xs'), color: T.txt3 }];
    GFX.cardBtn(ctx, rx + k * (sw + 8), ry, sw, 50, lines,
      { act: 'slot', id: String(k), on: getSlot() === k, pressed: isPressed('slot', String(k)) });
  }
  ry += 58;

  var rcx = rx + colW / 2;
  text(ctx, '\uD83C\uDF1F 声望 ' + m.bp + ' ★（' + money(prestigeStartCash(m.bp)) + '）',
    rcx, ry, { size: fs(L, 'xs'), align: 'center', color: T.txt2, maxW: colW });
  ry += 15;
  text(ctx, '\uD83C\uDFC6 最高 ' + money(m.best.normal || 0) + ' · \uD83C\uDFAE ' + m.runs + ' 局',
    rcx, ry, { size: fs(L, 'xs'), align: 'center', color: T.txt2, maxW: colW });
  ry += 15;
  text(ctx, lg.claimed
    ? '\uD83D\uDD25 连登 ' + lg.streak + ' 天 · 明日 ' + money(lg.next)
    : '\uD83D\uDD25 连登 ' + lg.streak + ' 天 · 今天还没签到',
    rcx, ry, { size: fs(L, 'xs'), align: 'center', color: lg.claimed ? T.amber : T.txt3, maxW: colW });
  ry += 15;
  if (!STORAGE_OK) {
    text(ctx, '\u26A0\uFE0F 存储不可用', rcx, ry, { size: fs(L, 'xs'), align: 'center', color: T.red });
    ry += 15;
  }

  /* 战绩榜：右栏底部，放得下几行放几行 */
  var top = (m.runsTop || []).filter(Boolean);
  if (top.length) {
    ry += 3;
    text(ctx, '\uD83C\uDFC5 本机战绩榜', rcx, ry, { size: fs(L, 'xs'), align: 'center', color: T.txt3 });
    ry += 14;
    /* ★ 底部那排小按钮要占 42px，所以榜单最多到那之上 */
    var floor = H - 42 - L.padBottom - 6;
    var showN = Math.max(0, Math.min(top.length, Math.floor((floor - ry) / 14)));
    for (var ti = 0; ti < showN; ti++) {
      var tr = top[ti];
      var td = DIFFICULTY[tr.diff] || DIFFICULTY.normal;
      var tres = tr.result === 'bankrupt' ? '\uD83D\uDCB8 破产'
        : (tr.endless ? '∞ ' + num(tr.milestone) + ' 阶'
          : (num(tr.worth) >= num(td.goal, Infinity) ? '\uD83C\uDFAF 达标' : '未达标'));
      text(ctx, ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'][ti] + ' ' + money(num(tr.worth)), rx, ry,
        { size: fs(L, 'xs'), color: T.amber, maxW: colW * 0.4 });
      text(ctx, td.emoji + td.name + ' · ' + tres,
        rx + colW, ry, { size: fs(L, 'xs'), align: 'right', color: T.txt3, maxW: colW * 0.55 });
      ry += 14;
    }
  }

  /* ─────────── 底部一排：横跨两栏 ─────────── */
  var by = H - 40 - L.padBottom;
  var bw3 = (L.innerW - 24) / 4;
  GFX.button(ctx, L.padX, by, bw3, 36,
    !lg.claimed ? '\uD83D\uDD25 签到 ' + money(lg.next) : '\uD83C\uDF81 已签',
    { kind: lg.claimed ? 'ghost' : 'amber', act: 'login', size: fs(L, 'xs'),
      disabled: !!lg.claimed, pressed: isPressed('login') });
  GFX.button(ctx, L.padX + bw3 + 8, by, bw3, 36, '\uD83D\uDCD6 玩法说明',
    { kind: 'ghost', act: 'help', size: fs(L, 'xs'), pressed: isPressed('help') });
  GFX.button(ctx, L.padX + (bw3 + 8) * 2, by, bw3, 36, '\uD83E\uDDE5 导入',
    { kind: 'ghost', act: 'import', size: fs(L, 'xs'), pressed: isPressed('import') });
  GFX.button(ctx, L.padX + (bw3 + 8) * 3, by, bw3, 36, '\uD83E\uDDE4 导出',
    { kind: 'ghost', act: 'export', size: fs(L, 'xs'), pressed: isPressed('export') });

  ctx.textAlign = 'left';
}

/* ============================================================
 *  开始界面
 * ========================================================== */
function drawTitle(ctx, L) {
  var W = L.W, H = L.H;
  var m = META();
  /* ★ 标题页也限宽居中 ——
     宽屏上用视口中心会让标题跑到屏幕正中，而下面的按钮在内容区里，
     两者对不齐（尤其「开始营业」这种大按钮，一眼就能看出歪了）。 */
  var x = L.padX, w = L.innerW;
  /* ★ 居中元素的中心 = 内容区中心（不是视口中心） */
  var cx = L.contentX + L.contentW / 2;
  var y = 34 + L.padTop;

  /* ★★ 横屏（矮屏）用两栏布局 ★★
   * ★ 为什么需要：
   *   标题页是单列纵向流，完整高度约 500px ——
   *   而横屏手机只有 390~414px 高，**放不下**（诊断实测：
   *   「🏆 本机战绩榜」那一段落到 498px，直接超出屏幕）。
   * ★ 做法：竖屏时保持单列（那是主力场景），
   *   横屏时拆成两栏 ——
   *   左栏：Logo + 副标题 + 难度选择 + 开始营业
   *   右栏：存档槽 + 元信息 + 战绩榜
   *   ★ 底部那排小按钮（签到/说明/导入/导出）横跨两栏宽度。
   */
  var twoCol = L.short && L.contentW >= 560;
  if (twoCol) {
    drawTitleWide(ctx, L, m);
    return;
  }

  /* Logo */
  ctx.textAlign = 'center';
  text(ctx, '🧋', cx, y, { size: Math.round(40 * L.scale), align: 'center' });
  y += Math.round(50 * L.scale);
  text(ctx, '奶茶星球', cx, y,
    { size: Math.round(26 * L.scale), weight: 900, align: 'center', color: T.txt });
  y += Math.round(30 * L.scale);
  /* ★ 副标题给 maxW —— 宽屏限宽后它仍按内容宽算，
     而窄屏上 320 宽时这行英文 + 中文会溢出（实测被截成「12 / …」那类）。
     ★ 用 maxW 让它走「截断 + 省略号」而不是画出屏幕。 */
  text(ctx, 'BUBBLE TYCOON · 30 天街头奶茶帝国', cx, y,
    { size: fs(L, 'sm'), align: 'center', color: T.txt3, maxW: w });
  y += 26;

  /* 难度三选一 */
  text(ctx, '选择难度', cx, y, { size: fs(L, 'sm'), align: 'center', color: T.txt3 });
  y += 18;
  var cw = (w - 16) / 3, ch = 72;
  var ds = Object.keys(DIFFICULTY).map(function (k) { return DIFFICULTY[k]; });
  for (var i = 0; i < ds.length; i++) {
    var d = ds[i];
    GFX.cardBtn(ctx, x + i * (cw + 8), y, cw, ch, [
      { t: d.emoji, size: FS.display },
      { t: d.name, size: FS.md, weight: 800 },
      { t: money(d.goal), size: FS.xs, color: T.amber },
    ], { act: 'diff', id: d.key, on: VIEW.diff === d.key, pressed: isPressed('diff', d.key), center: true });
  }
  y += ch + 14;

  /* 主按钮 */
  var bw = (w - 10) / 2;
  GFX.button(ctx, x, y, w, 46, '🚀 开始营业',
    { kind: 'primary', act: 'start', size: FS.lg, pressed: isPressed('start') });
  y += 54;
  /* 原来读 VIEW.dailyPlayed，但这个字段全项目从未被赋值，永远 falsy，
     昨天打过的成绩也就永远显示不出来。直接按 META 判断。 */
  var played = (m.dailyDate === todayKey() && m.dailyBest != null);
  if (hasAnySave()) {
    /* 三等分：「🏆 日榜」和每日挑战在玩法上本就是一件事，放同一行。
       标题页在小屏上没有第 5 个按钮的位置（下面那行已经是四等分了）。 */
    var bwT = (w - 16) / 3;
    GFX.button(ctx, x, y, bwT, 40, '💾 继续存档',
      { kind: 'ghost', act: 'continue', size: FS.sm, pressed: isPressed('continue') });
    GFX.button(ctx, x + bwT + 8, y, bwT, 40, '📅 每日挑战',
      { kind: 'amber', act: 'daily', size: FS.sm, pressed: isPressed('daily') });
    /* 打过就把今天的成绩顶到按钮上，不用点进去也知道自己今天多少分 */
    GFX.button(ctx, x + (bwT + 8) * 2, y, bwT, 40, played ? '🏆 ' + money(m.dailyBest) : '🏆 日榜',
      { kind: 'ghost', act: 'dailyrank', size: FS.sm, pressed: isPressed('dailyrank') });
  } else {
    GFX.button(ctx, x, y, bw, 40, played ? '📅 今日 · 最佳 ' + money(m.dailyBest) : '📅 每日挑战',
      { kind: 'amber', act: 'daily', size: FS.sm, pressed: isPressed('daily') });
    GFX.button(ctx, x + bw + 10, y, bw, 40, '🏆 日榜',
      { kind: 'ghost', act: 'dailyrank', size: FS.sm, pressed: isPressed('dailyrank') });
  }
  y += 48;

  /* 连续登录：和「玩法说明 / 导入存档」挤在同一行做三等分，
     标题页在小屏（640 高）上已经没有余量再单独加一行了。 */
  var lg = loginState(m);
  /* 四等分：导出要和导入成对出现，否则玩家能在小游戏里导入、
     却没法把进度导出去给浏览器版用。小屏没有余量再加一行，只能挤。 */
  var bw3 = (w - 24) / 4;
  GFX.button(ctx, x, y, bw3, 38,
    !lg.claimed ? '🔥 签到 ' + money(lg.next) : '🎁 已签',
    { kind: lg.claimed ? 'ghost' : 'amber', act: 'login', size: FS.xs, disabled: !!lg.claimed, pressed: isPressed('login') });
  GFX.button(ctx, x + bw3 + 8, y, bw3, 38, '📖 玩法说明', { kind: 'ghost', act: 'help', size: FS.xs, pressed: isPressed('help') });
  GFX.button(ctx, x + (bw3 + 8) * 2, y, bw3, 38, '📥 导入', { kind: 'ghost', act: 'import', size: FS.xs, pressed: isPressed('import') });
  GFX.button(ctx, x + (bw3 + 8) * 3, y, bw3, 38, '📤 导出', { kind: 'ghost', act: 'export', size: FS.xs, pressed: isPressed('export') });
  y += 46;

  /* 存档槽 */
  text(ctx, '💾 存档槽', x, y, { size: FS.sm, color: T.txt3 });
  y += 16;
  var sw = (w - 16) / 3;
  for (var k = 0; k < CFG.SAVE_SLOTS; k++) {
    var info = slotInfo(k);
    var lines = info
      ? [
        { t: '槽 ' + (k + 1) + (getSlot() === k ? ' ✓' : ''), size: FS.sm, weight: 800 },
        { t: 'Day ' + info.day + (info.endless ? ' ♾' : ''), size: FS.xs, color: T.txt2 },
        { t: money(info.worth), size: FS.xs, color: T.amber },
      ]
      : [{ t: '槽 ' + (k + 1), size: FS.sm, weight: 800 }, { t: '空', size: FS.xs, color: T.txt3 }];
    GFX.cardBtn(ctx, x + k * (sw + 8), y, sw, 54, lines,
      { act: 'slot', id: String(k), on: getSlot() === k, pressed: isPressed('slot', String(k)) });
  }
  y += 62;

  /* 元信息 */
  text(ctx, '🌟 声望 ' + m.bp + ' ★（开局基金 ' + money(prestigeStartCash(m.bp)) + '）   🏆 最高 '
    + money(m.best.normal || 0) + '   🎮 已玩 ' + m.runs + ' 局',
    cx, y, { size: fs(L, 'sm'), align: 'center', color: T.txt2 });
  y += 17;
  text(ctx, lg.claimed
    ? '🔥 连登 ' + lg.streak + ' 天 · 明日 ' + money(lg.next) + (lg.pending > 0 ? '（' + money(lg.pending) + ' 开局到账）' : '')
    : '🔥 连登 ' + lg.streak + ' 天 · 今天还没签到',
    cx, y, { size: fs(L, 'sm'), align: 'center', color: lg.claimed ? T.amber : T.txt3 });
  y += 18;
  if (!STORAGE_OK) {
    text(ctx, '⚠️ 存储不可用，本局进度无法保存', cx, y,
      { size: FS.sm, align: 'center', color: T.red });
    y += 16;
  }
  /* 本机战绩榜：平台级排行榜要开放数据域 + 云存储（有服务端），
     这里先用本机的，至少给玩家一个「再破一次自己纪录」的理由。
     标题页在小屏上余量很小，所以只画真正放得下的行数。 */
  var top = (m.runsTop || []).filter(Boolean);
  if (top.length) {
    y += 4;
    text(ctx, '🏅 本机战绩榜', cx, y, { size: fs(L, 'xs'), align: 'center', color: T.txt3 });
    y += 15;
    var room = Math.floor((H - 32 - y) / 15);
    var showN = Math.max(0, Math.min(top.length, Math.min(3, room)));
    for (var ti = 0; ti < showN; ti++) {
      var tr = top[ti];
      var td = DIFFICULTY[tr.diff] || DIFFICULTY.normal;
      var tres = tr.result === 'bankrupt' ? '💸 破产'
        : (tr.endless ? '♾️ 第 ' + num(tr.milestone) + ' 阶'
          : (num(tr.worth) >= num(td.goal, Infinity) ? '🎯 达标' : '未达标'));
      text(ctx, ['🥇', '🥈', '🥉'][ti] + ' ' + money(num(tr.worth)), x, y,
        { size: FS.sm, color: T.amber });
      text(ctx, td.emoji + td.name + ' · Day ' + num(tr.day) + ' · ' + tres,
        x + w, y, { size: FS.xs, align: 'right', color: T.txt3, maxW: w * 0.6 });
      y += 15;
    }
  }
  ctx.textAlign = 'left';
  if (y < H - 26) {
    /* ★★★ 底部提示必须避开 Home 指示条 ★★★
     * 原来画在 H - 24 —— 而在有指示条的机型上（844 高 / 指示条 34）
     * 那一行正好落在安全区里，被指示条压着（诊断实测：底边 831 > 安全区底线 810）。
     * ★ 正确做法：减去 padBottom 再往上留一点余量。 */
    var tipY = H - 24 - num(L.padBottom, 0);
    text(ctx, '💡 ' + VIEW.tip, cx, tipY,
      { size: fs(L, 'sm'), align: 'center', color: T.txt3, maxW: w });
  }
}

/* ============================================================
 *  游戏主界面：HUD + Tab + 面板 / 舞台
 * ========================================================== */
function drawGame(ctx, L) {
  var s = S();
  if (!s) { VIEW.screen = 'title'; return; }
  drawHUD(ctx, L, s);
  drawTabs(ctx, L);
  if (s.phase === 'open' && s.sim) drawStage(ctx, L, s);
  else drawPanelArea(ctx, L, s);
  /* 引导跟随滚动：面板画完后才知道高亮目标在哪儿，
     超出可视区就把该 tab 的滚动量调一下（下一帧生效）。
     必须在 drawPanelArea **之后** —— 它要用本帧刚写入的 panelRects。 */
  if (typeof tutFollowScroll === 'function') tutFollowScroll();
}

function drawHUD(ctx, L, s) {
  var W = L.W, hudH = L.hudH;
  var g = ctx.createLinearGradient(0, 0, 0, hudH);
  g.addColorStop(0, 'rgba(30,12,55,.96)'); g.addColorStop(1, 'rgba(30,12,55,.6)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, hudH);
  ctx.strokeStyle = T.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, hudH); ctx.lineTo(W, hudH); ctx.stroke();
  /* ↑ 底色与分隔线铺满整屏（那是背景），但下面的内容居中 —— 这个对比是有意的 */

  var y = 10 + L.padTop;
  /* ★ HUD 也跟着内容区限宽居中 ——
     否则平板上四个胶囊横跨 992px，而下面的进度条与图标挤在右边，
     视觉上完全对不齐。 */
  var hx = L.padX, hw = L.innerW;
  var cw = (hw - 12) / 4;
  GFX.chip(ctx, hx, y, cw, 40,
    'DAY', s.endless ? s.day + ' 无尽' + s.milestone : s.day + ' / ' + CFG.DAYS, T.txt);
  GFX.chip(ctx, hx + cw + 4, y, cw, 40, '现金', money(num(s.cash)),
    num(s.cash) < 0 ? T.red : T.amber);
  GFX.chip(ctx, hx + (cw + 4) * 2, y, cw, 40, '口碑', String(Math.round(num(s.rep))), T.txt);
  GFX.chip(ctx, hx + (cw + 4) * 3, y, cw, 40, '净资产', money(num(netWorth(s))), T.amber);
  y += 44;

  /* 右上角图标按钮：独占第二行右侧，不再压住数值胶囊 */
  var bs = hudH < 84 ? 26 : 28, gap = 6, iy = y;
  var icons = [
    { t: '💾', act: 'save' }, { t: '🏠', act: 'home' },
    { t: '📖', act: 'help' }, { t: '📈', act: 'chart' },
  ];
  var iconW = icons.length * bs + (icons.length - 1) * gap;
  /* ★ 图标区右对齐到**内容区**右缘（不是视口右缘）——
     宽屏限宽居中后，图标若还贴视口右边，会与下面的进度条脱节。 */
  var bx = hx + hw - bs;
  for (var i = 0; i < icons.length; i++) {
    GFX.fillRR(ctx, bx, iy, bs, bs, 9, T.card2, T.line);
    text(ctx, icons[i].t, bx + bs / 2, iy + (bs - 15) / 2, { size: FS.lg, align: 'center' });
    /* 命中比视觉外扩 3px（间隙 6px，正好不与相邻图标重叠）：
       26~28px 的图标是存档/回主页/说明/报表四个常用入口，太小了点不准。 */
    GFX.addHit(bx - 3, iy - 3, bs + 6, bs + 6, icons[i].act, null, null);
    bx -= bs + gap;
  }

/* 目标进度条：宽度让出图标区，文字改到进度条下方左对齐（原来右对齐会顶到图标） */
  var barW = Math.max(60, L.innerW - iconW - 10);
  /* ★ V13.8：负债警示（与 H5 端对等）。
     之前 debtDays 只存在于数据里，两版 UI 都不显示：
     玩家看到红色「¥-450」却不知道还能撑几天、怎么才算过关。

     ★ 位置选择踩了一次坑：
       初版画在「目标文字右侧」，实测 390 宽时 room = 4px —— **根本放不下**
       （barW 已经吃掉了除图标外的全部宽度）。
       所以改成：**负债时把 barW 收窄，给提示腾出一段**。
       只在负债时收窄 —— 平时不浪费那 90px。
     ★ 空间仍然不够（超窄屏）时降级为不画：
       宁可少提示，也不能让文字重叠/溢出（HUD 是固定高度，重叠会盖住 tab 栏）。 */
  var debtDays = num(s.debtDays, 0);
  var dTxt = debtDays >= 1 ? ('⚠ 负债 · 还剩 ' + (2 - debtDays) + ' 天') : '';
  var dW = 0;
  if (dTxt) {
    /* 「⚠ 负债 · 还剩 1 天」在 FS.xs 下约需 104px，留 8px 间隙 */
    dW = 112;
    barW = Math.max(60, barW - dW);
  }
  /* ★★ V14：与 H5 端对等 —— 进度条指向**下一个中期锚点**，
     而不是 30 天都不变的最终目标。
     原来 `netWorth(s) / goal` 的 goal 是常量（38000），
     于是 Day1 就显示 2% ——「开局欠 3 万 4」，中间 29 天零信息。
     ★ 文案也一起改：只改进度条不改文案等于让玩家盯着没意义的百分比。 */
  var gm = nextGoalOf(s);
  GFX.bar(ctx, 16, y + 2, barW, 5, gm.phase, { color: T.cyan });
  /* 分段刻度：让玩家看见全程节奏（6 个锚点） */
  for (var ti = 0; ti < MILESTONE_RATIO.length; ti++) {
    var tx = 16 + barW * MILESTONE_RATIO[ti];
    GFX.fillRR(ctx, tx - 1, y, 2, 9,
      2, ti < gm.idx ? T.green : (ti === gm.idx ? T.amber : 'rgba(255,255,255,.22)'), null);
  }
  var share = num(rivalShare(s));
  var gt = gm.reached
    ? ('✔ 已达第 ' + (gm.idx + 1) + ' 阶段目标 ' + money(gm.value)
      + (gm.nextAt ? ' · 下一阶段 Day' + gm.nextAt : ' · 已是最终目标'))
    : ('阶段目标 ' + money(gm.value) + ' · ' + Math.round(gm.phase * 100) + '%'
      + (gm.nextAt ? ' · 下一阶段 Day' + gm.nextAt : ''));
  if (share >= 0.15) gt += ' · 🦑对手抢 ' + Math.round(share * 100) + '%';
  text(ctx, gt, 16, y + 12, { size: FS.xs, color: T.txt3, maxW: barW });
  if (dTxt && barW >= 60) {
    text(ctx, dTxt, 16 + barW + 8, y + 12,
      { size: FS.xs, weight: 700, color: T.red, maxW: dW - 8 });
  }
}

function drawTabs(ctx, L) {
  var W = L.W, y = L.hudH, h = L.tabH;
  /* ★ 与 H5 端对齐：H5 的 Tab 是「🧋 经营」这种 emoji + 文字，
     Canvas 端原来只有纯 emoji，导致同一功能在两版可发现性不同 ——
     新玩家在 Canvas 端不知道 🧪 是"研发"、🏙️ 是"商圈"。
     390px 屏下每个 tab 宽约 65px，「emoji(14) + 文字(11) ≈ 42px」放得下；
     极窄屏（<340px）时文字会自动省略号截断，不会溢出。*/
  var tabs = [
    { k: 'manage', t: '🧋', n: '经营' }, { k: 'lab', t: '🧪', n: '研发' },
    { k: 'up', t: '⬆️', n: '升级' }, { k: 'staff', t: '👥', n: '员工' },
    { k: 'rival', t: '🏙️', n: '商圈' }, { k: 'ach', t: '🏅', n: '成就' },
  ];
  /* ★ tab 栏也跟着内容区限宽居中 ——
     否则平板上六个 tab 横跨 992px，而 HUD 的胶囊在中间的 640px 里，
     两层对不齐（截图上一眼就能看出来）。 */
  var tx0 = L.contentX, tw_total = L.contentW;
  var w = tw_total / tabs.length;
  for (var i = 0; i < tabs.length; i++) {
    var on = VIEW.tab === tabs[i].k;
    var t = tabs[i];
    /* emoji 与文字分两行：挤在一行时宽度不够，
       分两行后 emoji 12px + 文字 10px 稳稳落在 65px 内。*/
    text(ctx, t.t, tx0 + i * w + w / 2, y + 4, { size: fs(L, 'md'), align: 'center' });
    text(ctx, t.n, tx0 + i * w + w / 2, y + 21, {
      size: fs(L, 'xs'), align: 'center', color: on ? T.pink : T.txt3, maxW: w - 6,
    });
    if (on) {
      ctx.fillStyle = T.pink;
      ctx.fillRect(tx0 + i * w + w * 0.3, y + h - 3, w * 0.4, 2.5);
    }
    /* ★ 命中区必须跟着 tx0 偏移 ——
       ★ 否则平板上「画在中间、点在左边」——
         这正是用户反馈的**点击区域偏移**。
       ★ 绘制与命中必须用同一个 x，否则偏移量永远对不上。 */
    GFX.addHit(tx0 + i * w, y, w, h, 'tab', t.k, null);
  }
}

/* ------------------------------------------------------------
 *  面板区（带滚动与裁剪）
 * ---------------------------------------------------------- */
function drawPanelArea(ctx, L, s) {
  var W = L.W, top = L.bodyY, H = L.H - top;
  /* 备货阶段把「开门营业」钉在底部。
     面板加上任务卡 / 新闻 / 日志之后已经高过一屏，主操作若还留在滚动区最底下，
     玩家就得先滑到底才能开门 —— 这一屏唯一的主操作不该被藏起来。 */
  var pinH = (s.phase === 'prep' && VIEW.tab === 'manage') ? 54 + num(L.padBottom, 0) : 0;
  GFX.clipPush(ctx, 0, top, W, H - pinH);
  var y = top + 10 - (VIEW.scroll[VIEW.tab] || 0);
  /* ★★★ 宽屏：内容限宽居中 ★★★
   * ★ 为什么不能用 ctx.translate 平移：
   *   GFX.addHit 记录的是**绝对坐标**，而 translate 不影响它 ——
   *   于是「画在 A 处、点在 B 处才命中」，正是用户反馈的
   *   **点击区域偏移**。所以必须改 x / w 本身。
   * ★ 平板上内容限宽 640px 居中：
   *   · 一行文字不再横跨 992px（正常阅读宽度 30~40 字）
   *   · 卡片有宽度上限，视觉上像 App 而不是「拉伸的网页」
   *   · 左右留白是有意的（底色仍铺满整屏） */
  var x = L.padX, w = L.innerW;

  var fn = PANELS[VIEW.tab];
  if (fn) y = fn(ctx, x, y, w, s);
  VIEW_H = y - top + (VIEW.scroll[VIEW.tab] || 0) + 16 + pinH;
  GFX.clipPop(ctx);

  if (pinH) {
    var by = L.H - pinH;
    /* ★ 底部那条底板也要限宽 —— 否则宽屏上它横跨全屏，
       与居中的按钮对不上（按钮在中间，底板铺满 → 视觉断裂）。 */
    GFX.fillRR(ctx, L.contentX, by - 8, L.contentW, pinH + 8, 0, 'rgba(30,12,55,.97)', T.line);
    /* 教程第⑥步要高亮这颗按钮：记下真实矩形（以前 TUT_RECT 硬编码
       bodyY+340，指到采购卡去了）。 */
    (VIEW.panelRects = VIEW.panelRects || {}).open = { x: x, y: by + 6, w: w, h: 44 };
    GFX.button(ctx, x, by + 6, w, 44, '🚪 开门营业',
      { kind: 'primary', act: 'open', size: FS.lg, pressed: isPressed('open') });
  }
}

/* ============================================================
 *  面板 1：经营
 * ========================================================== */

/** 店长与分店编制面板（V11·Canvas 端）
 *  与 H5 端 managerPanelHtml 对等。Canvas 上没有 tooltip，
 *  所以**所有关键信息必须画在界面上**：
 *  店长能力值、特性、加成百分比、编制数、候选人的日薪与等级。
 */
/** 组合加成的可读文案（V13.4）—— H5/Canvas 两版共用同一套措辞 */
function comboMulText(combo) {
  var names = { speed: '速度', sat: '满意', rep: '口碑', ops: '客流' };
  return Object.keys(combo.mul).map(function (k) {
    return (names[k] || k) + ' +' + Math.round((combo.mul[k] - 1) * 100) + '%';
  }).join(' · ');
}

function panelManagers(ctx, x, y, w, s) {
  var shops = Math.max(1, num(s.shops, 1));
  var left = managerSlotsLeft(s);
  var hasMgr = managerCount(s) > 0 || shops > 1;

  GFX.card(ctx, x, y, w, 30);
  text(ctx, '🎩 店长与分店编制', x + 10, y + 8, { size: FS.md, weight: 800, color: T.txt });
  text(ctx, managerCount(s) + '/' + (shops - 1) + ' 名店长' + (left > 0 ? ' · 还可招 ' + left + ' 名' : ''),
    x + w - 10, y + 9, { size: FS.xs, align: 'right', color: T.txt3 });
  y += 38;

  if (shops <= 1) {
    text(ctx, '只有总店（你亲自经营）。开设第一家分店后即可招募店长。',
      x + 6, y + 2, { size: FS.xs, color: T.txt3, maxW: w - 12 });
    return y + 22;
  }

  /* ★ V13.4：团队组合加成（与 H5 端同数据、同语义）。
     ★ Canvas 端画得比 H5 紧凑 —— 一屏只有约 600px，
       组合表只画「已激活 + 最接近的一个」，
       否则 5 个组合 × 3 行会把下面的分店列表全推出裁剪区
       （GFX.addHit 在裁剪区外不登记 → 画出来但点不到，
         本项目在招牌卡/研发树/出杯位上都栽过这个）。 */
  {
    var cv = managerComboView(s);
    var act = cv.filter(function (x) { return x.active; });
    var near = cv.filter(function (x) { return !x.active; })
      .sort(function (a, b) { return a.missing.length - b.missing.length; })[0];
    GFX.card(ctx, x, y, w, 30);
    text(ctx, '🧩 团队组合', x + 10, y + 8, { size: FS.md, weight: 800, color: T.txt });
    text(ctx, act.length + '/' + cv.length + ' 已激活 · 跨店生效',
      x + w - 10, y + 9, { size: FS.xs, align: 'right', color: T.cyan });
    y += 34;
    /* 已激活的组合逐个列出 */
    for (var ai = 0; ai < act.length; ai++) {
      var ac = act[ai].combo;
      GFX.card(ctx, x, y, w, 30);
      text(ctx, ac.emoji + ' ' + ac.name, x + 10, y + 5,
        { size: FS.sm, weight: 800, color: T.amber, maxW: w - 90 });
      text(ctx, comboMulText(ac), x + w - 10, y + 6,
        { size: FS.xs, align: 'right', color: T.cyan, maxW: 84 });
      text(ctx, ac.desc, x + 10, y + 17, { size: FS.xs, color: T.txt3, maxW: w - 20 });
      y += 34;
    }
    /* 最接近凑齐的那个（给玩家一个目标） */
    if (near) {
      GFX.card(ctx, x, y, w, 30);
      text(ctx, '🎯 ' + near.combo.name, x + 10, y + 5,
        { size: FS.sm, weight: 700, color: T.txt2, maxW: w - 90 });
      text(ctx, comboMulText(near.combo), x + w - 10, y + 6,
        { size: FS.xs, align: 'right', color: T.txt3, maxW: 84 });
      text(ctx, '还缺：' + near.missing.map(function (t) {
        var tr = MANAGER_TRAITS.filter(function (x) { return x.id === t; })[0];
        return tr ? tr.emoji + tr.name : t;
      }).join('、'), x + 10, y + 17, { size: FS.xs, color: T.txt3, maxW: w - 20 });
      y += 34;
    }
  }

  var fee = managerCost(s);
  for (var b = 2; b <= shops; b++) {
    var mg = managerOfBranch(s, b);
    var staffN = staffOfBranch(s, b).length;
    var cap = branchStaffCap(s, b);
    var ch = mg ? 76 : 0;
    /* ★ V13.7：有店长时若能专精（Lv.3+），要多留一行按钮的空间。
       ★★★ 卡片高度必须跟着涨 —— 否则专精按钮会被画到卡片外，
         而 GFX.addHit 在裁剪区外**不登记** →
         「画出来了但点不到」（Canvas 端的老坑：
         招牌卡/研发树/出杯位/V13 地图/团队组合面板都栽过）。
         minigame-smoke 的「专精按钮已注册命中区」断言就是守这个。 */
    if (mg && managerCanSpecialty(s, mg).ok) ch += 26;
    var cands = (s.mgrCand && s.mgrCand[b]) || [];
    if (!mg && cands.length) ch += 26 + cands.length * 52;
    if (!mg && !cands.length) ch += 22;

    GFX.card(ctx, x, y, w, ch + 26);
    /* 分店标题行 */
    text(ctx, '🏪 第' + b + ' 分店', x + 10, y + 8, { size: FS.sm, weight: 800, color: T.txt });
    text(ctx, '编制 ' + staffN + '/' + cap, x + 96, y + 9, { size: FS.xs, color: T.cyan });
    text(ctx, mg ? ('店长 ' + mg.emoji + ' ' + mg.name) : '无店长',
      x + w - 10, y + 9, { size: FS.xs, align: 'right', color: mg ? T.amber : T.txt3 });
    y += 26;

    if (mg) {
      var tr = managerTrait(mg);
      var mb = managerBonus(s, b);
      text(ctx, mg.emoji + ' ' + mg.name + '  Lv.' + mg.lv + ' ' + managerRank(mg.lv).name,
        x + 10, y + 4, { size: FS.sm, weight: 700, color: T.txt });
      text(ctx, '日薪' + money(mg.wage) + ' · 能力' + Number(mg.skill).toFixed(2),
        x + w - 10, y + 5, { size: FS.xs, align: 'right', color: T.txt2 });
      text(ctx, tr.emoji + ' ' + tr.name + ' · ' + tr.desc,
        x + 10, y + 20, { size: FS.xs, color: T.txt3, maxW: w - 20 });
      text(ctx, '该店加成：客流+' + Math.round((mb.ops - 1) * 100) + '% · 速度+'
        + Math.round((mb.speed - 1) * 100) + '% · 口碑+' + Math.round((mb.rep - 1) * 100) + '%',
        x + 10, y + 34, { size: FS.xs, color: T.cyan, maxW: w - 20 });
      /* 卸任 / 调动按钮 */
      var bw2 = 84, bh2 = 22, by = y + 48;
      /* 调动目标：其他没店长的分店 */
      var moveTo = 0;
      for (var d = 2; d <= shops; d++) {
        if (d !== b && !managerOfBranch(s, d)) { moveTo = d; break; }
      }
      if (moveTo) {
        GFX.button(ctx, x + 10, by, bw2, bh2, '调到第' + moveTo + '店',
          { kind: 'ghost', act: 'mmove', id: mg.id, extra: moveTo, size: FS.xs, r: 7 });
      }
      GFX.button(ctx, x + w - 10 - bw2, by, bw2, bh2, '卸任',
        { kind: 'ghost', act: 'mfire', id: mg.id, size: FS.xs, r: 7 });
      y += 74;
      /* ★ V13.7：专精选项行（Lv.3 起）。
         ★ Canvas 一屏只有约 600px，所以只画 4 个方向按钮（不画说明文字，
           详情靠长按/tooltip）。行高 22px，与上面按钮行同规格。 */
      if (managerCanSpecialty(s, mg).ok) {
        var sf = MANAGER_SPECIALTY.fields;
        var sw = (w - 20 - (sf.length - 1) * 4) / sf.length;
        for (var si = 0; si < sf.length; si++) {
          var on = mg.spec === sf[si].id;
          GFX.button(ctx, x + 10 + si * (sw + 4), by, sw, 22,
            (on ? '✔ ' : '') + sf[si].emoji + sf[si].name.replace('专精', ''),
            { kind: on ? 'primary' : 'ghost', act: 'mspec', id: mg.id, extra: sf[si].id, size: FS.xs, r: 7 });
        }
        y += 26;
      }
    } else if (cands.length) {
      for (var i = 0; i < cands.length; i++) {
        var c = cands[i];
        var ctr = managerTrait(c);
        text(ctx, c.emoji + ' ' + c.name + '  Lv.' + c.lv + ' ' + managerRank(c.lv).name,
          x + 10, y + 4, { size: FS.sm, weight: 700, color: T.txt });
        text(ctx, '日薪' + money(c.wage),
          x + w - 10, y + 5, { size: FS.xs, align: 'right', color: T.txt2 });
        text(ctx, ctr.emoji + ' ' + ctr.name + ' · 能力' + Number(c.skill).toFixed(2),
          x + 10, y + 18, { size: FS.xs, color: T.txt3, maxW: w - 120 });
        GFX.button(ctx, x + 10, y + 30, w - 20, 20,
          s.cash >= fee ? ('招募 · ' + money(fee)) : ('现金不足（' + money(fee) + '）'),
          { kind: s.cash >= fee ? 'primary' : 'ghost', act: 'mhire', id: b, extra: i,
            disabled: s.cash < fee, size: FS.xs, r: 7 });
        y += 52;
      }
      /* 付费刷新：免费刷会让玩家无限刷出金牌店长 */
      var rc = managerRerollCost(s, b);
      GFX.button(ctx, x + 10, y, 118, 20, '🔄 刷新（' + money(rc) + '）',
        { kind: 'ghost', act: 'mcand', id: b, disabled: s.cash < rc, size: FS.xs, r: 7 });
      y += 26;
    } else {
      text(ctx, '暂无候选人（次日刷新）', x + 6, y + 2, { size: FS.xs, color: T.txt3 });
      y += 22;
    }
  }

  /* 总店编制也要画出来 —— 店长只管分店，玩家容易忘总店也要人 */
  GFX.card(ctx, x, y, w, 26);
  text(ctx, '🏠 总店', x + 10, y + 7, { size: FS.sm, weight: 800, color: T.txt });
  text(ctx, '编制 ' + staffOfBranch(s, 1).length + '/' + branchStaffCap(s, 1),
    x + 72, y + 8, { size: FS.xs, color: T.cyan });
  text(ctx, '你亲自经营', x + w - 10, y + 8, { size: FS.xs, align: 'right', color: T.txt3 });
  return y + 34;
}


function panelManage(ctx, x, y, w, s) {
  /* V5 章节关卡：中期目标（跨 5 天推进）。
     位置放在**合同之前**而不是之后：备货页是纵向滚动的，但下方的采购/菜单
     若被推出当前视口，教程第③④步的高亮与命中区就一起失效
     （minigame-smoke 188~193 抓过这个）。关卡卡越小越靠前，越不挤后面的内容。
     高度压到 66px：标题行（关卡名+目标+奖励）+ 难度按钮行。 */
  var sv = stageView(s);
  if (sv) {
    var sh = 66;
    (VIEW.panelRects = VIEW.panelRects || {}).stage = { x: x, y: y, w: w, h: sh };
    GFX.fillRR(ctx, x, y, w, sh, 12, 'rgba(139,92,255,.13)', 'rgba(139,92,255,.45)');
    text(ctx, '🏔️ 第' + sv.chapter + '章', x + 10, y + 8, { size: FS.sm, weight: 800, color: T.purple });
    /* ★ V13.5：跨章补打时，本章可能已通关但更早章节还有关卡没打，
       那个数字要露出来，否则玩家会以为全打完了。 */
    if (sv.backlog > 0) {
      text(ctx, '待补' + sv.backlog + '关', x + 66, y + 8,
        { size: FS.xs, weight: 700, color: T.amber });
    }
    if (sv.cur) {
      text(ctx, sv.cur.emoji + ' ' + sv.cur.desc, x + (sv.backlog > 0 ? 116 : 66), y + 9,
        { size: FS.xs, color: T.txt2, maxW: w - 76 - 52 - (sv.backlog > 0 ? 50 : 0) });
      text(ctx, '+' + money(sv.cur.cash), x + w - 10, y + 8,
        { size: FS.xs, weight: 800, align: 'right', color: T.green });
    } else {
      text(ctx, '✅ 本章已通关 · ' + sv.cleared + '/' + sv.total, x + (sv.backlog > 0 ? 116 : 66), y + 9,
        { size: FS.xs, color: T.green, maxW: w - 76 });
    }
    /* 三个难度档按钮：门槛越高、奖励越丰厚 */
    var dbw = (w - 20 - 16) / 3;
    for (var di = 0; di < sv.diffs.length; di++) {
      var d = sv.diffs[di];
      GFX.button(ctx, x + 10 + di * (dbw + 8), y + 30, dbw, 28, d.emoji + d.name,
        { kind: d.cur ? 'primary' : 'ghost', act: 'stagediff', id: d.id, size: FS.xs, r: 9 });
    }
    y += sh + 10;
  }
  /* 每日合同（V1）：放在最上面 —— 它是"今天要凑什么"的方向盘，
     玩家会照着它改采购、改菜单，所以必须备货页第一眼看到。 */
  var ct = contractView(s);
  if (ct) {
    GFX.card(ctx, x, y, w, 84);
    var done = ct.done;
    text(ctx, '📜 今日合同 · ' + ct.name + (done ? ' ✅' : ''),
      x + 10, y + 9, { size: FS.md, weight: 800, color: done ? T.green : T.amber, maxW: w - 20 });
    var ctSub = ct.prog === null
      ? (done ? '已达成' : '打烊时结算')
      : (ct.prefix || '') + Math.round(ct.prog) + '/' + (ct.prefix || '') + ct.goal + (ct.unit || '');
    if (!done && ct.failRep < 0) ctSub += ' · 未达成扣口碑 ' + ct.failRep;
    text(ctx, ct.desc, x + 10, y + 30, { size: FS.sm, color: T.txt2, maxW: w - 90 });
    text(ctx, (done ? '✅ 已达成' : '+' + money(ct.cash)), x + w - 10, y + 9,
      { size: FS.md, weight: 800, align: 'right', color: done ? T.txt3 : T.green });
    text(ctx, ctSub, x + w - 10, y + 30,
      { size: FS.xs, align: 'right', color: T.txt3, maxW: w * 0.42 });
    GFX.bar(ctx, x + 10, y + 52, w - 20, 6, ct.ratio, { color: done ? T.green : T.cyan });
    y += 94;
  }
  var tag = TAGS[s.trend] || {};
  var nextTag = TAGS[s.nextTrend] || {};

  /* 平台福利入口。
     侧边栏复访是平台必接能力，官方明确要求「礼包入口放在游戏主页面（首页）」——
     经营面板就是进游戏后的第一屏，所以放在最顶上。
     没有任何一项能力可用时（没 tt / 没配广告位 / 没开内购）整块不渲染。 */
  if (CAPS.visible()) {
    GFX.fillRR(ctx, x, y, w, 48, 12, 'rgba(255,194,71,.10)', 'rgba(255,194,71,.38)');
    text(ctx, '🎁', x + 12, y + 13, { size: FS.xl });
    text(ctx, '每日福利', x + 36, y + 9, { size: FS.lg, weight: 800, color: T.amber });
    text(ctx, CAPS.summary() || '侧边栏 · 加桌面 · 开提醒', x + 36, y + 27,
      { size: FS.xs, color: T.txt2, maxW: w - 70 });
    text(ctx, '›', x + w - 18, y + 14, { size: FS.display, weight: 700, color: T.amber });
    GFX.addHit(x, y, w, 48, 'gift', null, null);
    y += 58;
  }

  /* 已持有的经营策略卡（没有则整块不渲染，不占版面） */
  if (Array.isArray(s.cards) && s.cards.length) {
    var rows = Math.ceil(s.cards.length / 2);
    GFX.card(ctx, x, y, w, 22 + rows * 20);
    text(ctx, '🃏 经营策略 ' + s.cards.length + '/' + CFG.CARD_MAX, x + 10, y + 7,
      { size: FS.md, weight: 800 });
    for (var ci = 0; ci < s.cards.length; ci++) {
      var card = cardById(s.cards[ci]); if (!card) continue;
      var colx = x + 10 + (ci % 2) * ((w - 20) / 2);
      var coly = y + 22 + Math.floor(ci / 2) * 20;
      text(ctx, card.emoji + ' ' + card.name, colx, coly,
        { size: FS.xs, color: T.txt2, maxW: (w - 20) / 2 - 4 });
    }
    y += 22 + rows * 20 + 10;
  }

  /* 今日情报 */
  var ih = 66;
  GFX.card(ctx, x, y, w, ih);
  var cw = w / 3;
  intel(ctx, x + 10, y + 8, cw - 10, '天气',
    (s.weather && s.weather.emoji ? s.weather.emoji + ' ' : '') + (s.weather ? s.weather.name : '—'),
    '客流 ×' + (s.weather ? s.weather.traffic : 1));
  intel(ctx, x + cw + 4, y + 8, cw - 10, '今日流行',
    (tag.emoji || '') + ' ' + (tag.name || '—'), '命中销量 +55%');
  intel(ctx, x + cw * 2 + 4, y + 8, cw - 10, '明日预告',
    s.trendKnown ? (nextTag.emoji || '') + ' ' + (nextTag.name || '—') : '❓ 未知');
  /* 调研按钮：H5 在情报卡的「明日预告」下面放了一颗，小游戏原本没有，
     导致 s.trendKnown 永远是 false、「明日预告」永远是 ❓，scout 分支也无处触发。 */
  if (!s.trendKnown) {
    GFX.button(ctx, x + cw * 2 + 4, y + 32, cw - 14, 24, '🔍 调研 ¥150',
      { kind: 'ghost', act: 'scout', size: FS.xs, r: 7, disabled: !canAfford(s, 150), pressed: isPressed('scout') });
  }
  y += ih + 10;

  /* 市场新闻：它会实打实地改原料价格，不显示的话玩家只看到「今天怎么这么贵」。 */
  if (s.news && s.news.text) {
    GFX.fillRR(ctx, x, y - 6, w, 28, 10, 'rgba(255,194,71,.10)', 'rgba(255,194,71,.28)');
    text(ctx, '📰 ' + s.news.text, x + 10, y + 2, { size: FS.sm, color: T.amber, maxW: w - 20 });
    y += 36;
  }

  /* 每日任务：与 H5 版同一张卡，位置也一致（情报下面、采购上面）。
     达成即到账现金，是「再开一天」的具体理由。 */
  var qv = questViews(s);
  if (qv.length) {
    var qh = 30 + qv.length * 30;
    GFX.card(ctx, x, y, w, qh);
    text(ctx, '🎯 今日任务', x + 10, y + 8, { size: FS.md, weight: 800 });
    text(ctx, '达成即到账', x + w - 10, y + 9, { size: FS.xs, align: 'right', color: T.txt3 });
    var qy = y + 30;
    for (var qi = 0; qi < qv.length; qi++) {
      var q = qv[qi];
      text(ctx, q.emoji, x + 12, qy + 6, { size: FS.lg });
      text(ctx, q.name, x + 32, qy + 8, { size: FS.sm, color: q.done ? T.txt3 : T.txt, maxW: 60 });
      GFX.bar(ctx, x + 98, qy + 11, w - 98 - 80, 6, q.ratio, { color: q.done ? T.green : T.cyan });
      var qshow = q.done ? '已达成'
        : (q.dir === 'down'
          /* 越少越好型的数字是「上限」，直接写 x/y 会被读成「已完成 x 个」 */
          ? '剩 ' + Math.max(0, q.goal - Math.round(q.prog)) + q.unit
          : q.prefix + Math.round(q.prog) + '/' + q.prefix + q.goal + q.unit);
      text(ctx, qshow, x + w - 74, qy + 8, { size: FS.xs, color: T.txt3, align: 'right', maxW: 64 });
      text(ctx, (q.done ? '✅ ' : '') + '+' + money(q.reward), x + w - 10, qy + 8,
        { size: FS.xs, weight: 800, align: 'right', color: q.done ? T.green : T.amber });
      qy += 30;
    }
    y += qh + 10;
  }

  /* 采购 */
  var rows = ING.length;
  (VIEW.panelRects = VIEW.panelRects || {}).market = { x: x, y: y, w: w, h: 40 + rows * 30 + 38 };
  GFX.card(ctx, x, y, w, 40 + rows * 30 + 38);
  text(ctx, '🛒 采购', x + 10, y + 9, { size: FS.md, weight: 800 });
  text(ctx, '现金 ' + money(num(s.cash)), x + w - 10, y + 9,
    { size: FS.sm, align: 'right', color: T.amber });
  var ry = y + 30;
  /* ★ V10：只列**当前城市买得到**的原料（与 H5 端同一口径）。
     全部 29 种列出来的话，北京的玩家会看到 20+ 行「藤椒油 ¥3.5」点下去没反应。
     Canvas 上没有 tooltip，缺货的按钮是纯粹的误导。 */
  var mktCity = currentCityId(s);
  var localIngs = ingsOfCity(mktCity);
  var localIds = {};
  for (var li = 0; li < localIngs.length; li++) localIds[localIngs[li].id] = 1;
  if (localIngs.length) {
    var names = [];
    for (var ln = 0; ln < localIngs.length; ln++) names.push(localIngs[ln].emoji + localIngs[ln].name);
    text(ctx, '🗺️ 本地特产：' + names.join('、'), x + 8, ry + 4,
      { size: FS.xs, color: T.amber, maxW: w - 16 });
    ry += 22;
  }
  for (var i = 0; i < ING.length; i++) {
    var g = ING[i];
    if (!ingAvailableAt(g.id, mktCity)) continue;      /* 当地买不到，不显示 */
    var p = s.prices[g.id] || g.base;
    var prev = s.prevPrices[g.id] || g.base;
    var up = p > prev + 0.01, down = p < prev - 0.01;
    var col = up ? T.red : (down ? T.green : T.txt2);
    /* ★ V13.9：与 H5 端对等 ——标出「相对基准价便宜多少」。
       原来只有「比昨天涨/跌」，玩家不知道现在到底便不便宜，
       而「便宜就囤」正是玩法核心之一（H5 教学第③步就教这个）。
       ★ 阈值与「抄底大师」成就共用 CFG.BARGAIN_RATIO，
       徽章亮了却没触发成就会让玩家困惑。 */
    var vsBase = p / g.base;
    var bargain = vsBase <= CFG.BARGAIN_RATIO;
    text(ctx, g.emoji + ' ' + g.name, x + 10, ry + 6, { size: FS.md, color: T.txt });
    text(ctx, '¥' + p.toFixed(1), x + 78, ry + 6, { size: FS.sm, color: bargain ? T.green : col });
    text(ctx, (up ? '▲' : down ? '▼' : '—'), x + 122, ry + 6, { size: FS.xs, color: col });
    /* 相对基准价的百分比（弱化，不与主价格抢视觉） */
    var pct = Math.round((vsBase - 1) * 100);
    text(ctx, (pct > 0 ? '+' : '') + pct + '%', x + 136, ry + 6, { size: FS.xs, color: T.txt3, maxW: 30 });
    if (bargain) {
      text(ctx, '📉抄底', x + 145, ry + 6, { size: FS.xs, weight: 800, color: T.green, maxW: 34 });
    }
    text(ctx, '库存 ' + Math.round(num(s.inv[g.id])), x + (bargain ? 180 : 145), ry + 6, { size: FS.sm, color: T.txt3 });
    /* 三个进货按钮：+10 / +50 / 清仓 */
    /* 只留 +10 / +50。原来第三个「满」传extra 999 给 buyIng()，
       而仓库上限最多 1500 —— 这个按钮 100%撞「仓库装不下了」，点了永远只弹错误。 */
    var bw = 34, bh = 27;
    var bx = x + w - 10 - (bw * 3 + 12);
    GFX.button(ctx, bx, ry + 1, bw, bh, '+10', { kind: 'ghost', act: 'buy', id: g.id, extra: 10, size: FS.xs, r: 7, pressed: isPressed('buy', g.id, 10) });
    GFX.button(ctx, bx + bw + 6, ry + 1, bw, bh, '+50', { kind: 'ghost', act: 'buy', id: g.id, extra: 50, size: FS.xs, r: 7, pressed: isPressed('buy', g.id, 50) });
    /* ★ V13.9：清仓按钮（与 H5 端对等）。
       ★ 没有它就是**玩家无解的死局**：仓库满时买不进需要的料，
         而原来没有任何清理途径；切城后旧城专属料更是买不到也用不上，
         却占着仓位让需要的料进不来。
       ★ 无库存时禁用（而不是隐藏）—— 布局稳定，少一个跳动源。 */
    var hasInv = num(s.inv[g.id]) > 0;
    GFX.button(ctx, bx + (bw + 6) * 2, ry + 1, bw, bh, '清仓',
      { kind: hasInv ? 'ghost' : 'ghost', act: 'sell', id: g.id, size: FS.xs, r: 7, disabled: !hasInv });
    ry += 30;
  }
  GFX.button(ctx, x + 10, ry + 2, w - 20, 30, '🛒 一键补货（按菜单需求配齐）',
    { kind: 'cyan', act: 'autofill', size: FS.sm, r: 9, pressed: isPressed('autofill') });
  ry += 32;
  text(ctx, '按今日菜单的需求买齐（缺口紧急的先买），有余量再补便宜的',
    x + 10, ry, { size: FS.xs, color: T.txt3, maxW: w - 20 });
  ry += 18;
  /* ★ V13.9：清理「本地买不到的料」（与 H5 端对等）。
     切城后旧城专属料留在仓库里，买不到也用不上却占着仓位 ——
     没有这一步就是玩家无解的死局。
     ★ 只在**确实有这类料**时才占高度（常驻一个用不上的按钮是噪音）。 */
  var staleN = 0, staleQty = 0;
  for (var si = 0; si < ING.length; si++) {
    var sg = ING[si];
    var sq = num(s.inv[sg.id]);
    if (sq > 0 && !ingAvailableAt(sg.id, mktCity)) { staleN++; staleQty += sq; }
  }
  if (staleN) {
    text(ctx, '⚠ 有 ' + staleQty + ' 个本地买不到的原料占着仓位',
      x + 10, ry, { size: FS.xs, weight: 700, color: T.amber, maxW: w - 20 });
    ry += 18;
    GFX.button(ctx, x + 10, ry, w - 20, 28, '清掉它们（按 ' + Math.round(CFG.LIQUID_RATE * 100) + '% 回购）',
      { kind: 'ghost', act: 'sellstale', size: FS.sm, r: 8, pressed: isPressed('sellstale') });
    ry += 34;
  }
  /* V13.9：按钮 32 + 说明 18 = 50（原 38）。
     ★ 必须跟着改，否则说明文字会画到「菜单与定价」标题上 —— Canvas
       没有自动流式布局，累加值与实际绘制高度必须手写一致。
★★ 上面若有「清理买不到的料」，还要再加上它的 18 + 34。 */
  y += 40 + rows * 30 + 50 + (staleN ? 52 : 0) + 10;

  /* 菜单与定价 */
  var ms = s.menu || [];
  var mh = 38 + ms.length * 46;
  /* 教程第④步要高亮这块：把真实矩形记下来（TUT_RECT 从这读，
    以前是硬编码 y，面板内容顺序一变高亮就指错地方）。 */
  (VIEW.panelRects = VIEW.panelRects || {}).menu = { x: x, y: y, w: w, h: mh };
  GFX.card(ctx, x, y, w, mh);
  text(ctx, '📝 菜单与定价', x + 10, y + 9, { size: FS.md, weight: 800 });
  text(ctx, '倍率 0.9~1.1 最稳', x + w - 10, y + 10, { size: FS.xs, align: 'right', color: T.txt3 });
  var my = y + 30;
  for (var j = 0; j < ms.length; j++) {
    var rid = ms[j];
    var r = recipeById(rid);
    if (!r) continue;
    var price = priceOf(s, rid), cost = costOf(s, rid), ratio = num(s.ratios[rid], 1);
    /* 点配方行本身 = 上架/下架（± 按钮左边的整片区域）。
       以前 manage 面板只有 ± 倍率可点，教程第④步提示「点一下任意配方卡」
       却根本点不了 —— 引导变成只能硬点「下一步」。现在和 H5 的
       data-act="toggle" 行为对齐。 */
    GFX.addHit(x, my, w - 116, 44, 'toggle', rid);
    text(ctx, r.emoji + ' ' + r.name, x + 10, my + 4, { size: FS.md, color: T.txt });
    text(ctx, '售 ' + money(price) + ' · 本 ¥' + cost.toFixed(1) + ' · 毛利 ' + money(price - cost),
      x + 10, my + 20, { size: FS.xs, color: T.txt3 });
    /* 倍率 - / +：行距 46px，按钮可以放大到 30 高 —— 22px 是全游戏最难点的目标之一 */
    GFX.button(ctx, x + w - 108, my + 3, 30, 30, '−', { kind: 'ghost', act: 'ratio', id: rid, extra: -0.05, size: FS.lg, r: 8 });
    text(ctx, '×' + ratio.toFixed(2), x + w - 63, my + 11, { size: FS.sm, align: 'center', color: T.cyan });
    GFX.button(ctx, x + w - 44, my + 3, 30, 30, '＋', { kind: 'ghost', act: 'ratio', id: rid, extra: 0.05, size: FS.lg, r: 8 });
    my += 46;
  }
  y += mh + 10;

  /* 营销
     这是「当天一次性投入」，打烊后归零 —— 以前这个归零完全静默，
     玩家第二天看到 ¥0 只会以为昨天那笔钱没生效。 */
  GFX.card(ctx, x, y, w, 80);
  text(ctx, '📣 营销投入', x + 10, y + 9, { size: FS.md, weight: 800 });
  text(ctx, '¥' + Math.round(num(s.marketing)) + ' → 客流 ×' + marketingMul(num(s.marketing)).toFixed(2),
    x + w - 10, y + 10, { size: FS.sm, align: 'right', color: T.cyan });
  text(ctx, '预计客流 ' + Math.round(num(trafficOf(s))) + ' 人 · 出杯位 ' + stationCount(s) + ' 个',
    x + 10, y + 28, { size: FS.sm, color: T.txt3 });
  var mks = [0, 200, 500, 1000, 2000];
  var mw = (w - 20 - 8 * (mks.length - 1)) / mks.length;
  /* 16px 高是全游戏最小目标，加到 22；提示文字相应下移到 y+66（卡片高 80 容得下） */
  for (var mi = 0; mi < mks.length; mi++) {
    GFX.button(ctx, x + 10 + mi * (mw + 8), y + 40, mw, 22,
      mks[mi] === 0 ? '不投' : '¥' + mks[mi],
      { kind: 'ghost', act: 'mkt', id: String(mks[mi]), size: FS.xs, r: 6 });
  }
  text(ctx, num(s.lastMarketing) > 0
    ? '📢 昨日投入 ' + money(num(s.lastMarketing)) + ' 已用完，今天要重新投'
    : '营销只在当天生效，打烊后归零',
    x + 10, y + 66,
    { size: FS.xs, maxW: w - 20, color: num(s.lastMarketing) > 0 ? T.amber : T.txt3 });
  y += 90;

  /* 中期目标：30 天只有一个终点太远，中间三周玩家不知道自己是领先还是落后。
     每 5 天给一个锚点，达成记一次声望（在 prestigeGain 里兑现）。 */
  var ms = milestoneOf(s);
  if (ms) {
    GFX.card(ctx, x, y, w, 62);
    text(ctx, '🎯 中期目标', x + 10, y + 8, { size: FS.md, weight: 800 });
    text(ctx, 'Day ' + ms.day + ' 前 ' + money(ms.worth), x + w - 10, y + 9,
      { size: FS.sm, align: 'right', color: T.cyan });
    var mp = Math.max(0, Math.min(1, num(netWorth(s)) / Math.max(1, ms.worth)));
    GFX.bar(ctx, x + 10, y + 30, w - 20, 6, mp, { color: ms.hit ? T.green : T.cyan });
    text(ctx, ms.hit
      ? '✅ 已达成（' + money(netWorth(s)) + '）· 声望 +1 已记账'
      : '还差 ' + money(Math.max(0, ms.gap)) + '（' + money(netWorth(s)) + '，' + Math.round(mp * 100) + '%）',
      x + 10, y + 42,
      { size: FS.sm, maxW: w - 20, color: ms.hit ? T.green : T.txt2 });
    y += 72;
  }

  /* 建议。adviceOf() 返回的是对象数组（最多 4 条），曾经整只数组被直接塞进
     text()，渲染出来是「[object Object],[object Object]」—— 两版不一致里最显眼的一个。 */
  var advs = adviceOf(s) || [];
  if (advs.length) {
    (VIEW.panelRects = VIEW.panelRects || {}).advice = { x: x, y: y, w: w, h: 30 + advs.length * 20 };
    GFX.card(ctx, x, y, w, 30 + advs.length * 20);
    text(ctx, '📌 今日建议', x + 10, y + 8, { size: FS.md, weight: 800, color: T.amber });
    var ay = y + 26;
    for (var ai = 0; ai < advs.length; ai++) {
      var av = advs[ai] || {};
      /* 文案是给 H5 的 innerHTML 写的（带 <b>），Canvas 必须先剥标签，
         否则 "</b>" 会被当成可见字符画出来。 */
      text(ctx, (av.icon || '·') + ' ' + GFX.plainText(av.text || ''), x + 10, ay, {
        size: FS.sm, maxW: w - 20,
        color: av.level === 'warn' ? T.amber : (av.level === 'good' ? T.green : T.txt2),
      });
      ay += 20;
    }
    y += 30 + advs.length * 20 + 10;
  }

  /* 店长日志：H5 有这张卡，小游戏原本不显示 —— pushLog 一直在写、一直进存档，却没人读。 */
  var logs = (s.log || []).slice(-4);
  /* ---------- V11 店长与分店编制 ----------
     放在日志之前：人事信息比流水账重要，日志是最后才看的。 */
  y = panelManagers(ctx, x, y, w, s);

  if (logs.length) {
    GFX.card(ctx, x, y, w, 30 + logs.length * 18);
    text(ctx, '📔 店长日志', x + 10, y + 8, { size: FS.md, weight: 800, color: T.txt3 });
    var ly = y + 26;
    for (var li = 0; li < logs.length; li++) {
      text(ctx, logs[li], x + 10, ly, { size: FS.xs, color: T.txt3, maxW: w - 20 });
      ly += 18;
    }
    y += 30 + logs.length * 18 + 10;
  }

  return y;
}

function intel(ctx, x, y, w, k, v, sub) {
  text(ctx, k, x, y, { size: FS.xs, color: T.txt3 });
  text(ctx, v, x, y + 13, { size: FS.md, weight: 800, color: T.txt, maxW: w });
  if (sub) text(ctx, sub, x, y + 30, { size: FS.xs, color: T.txt3, maxW: w });
}

/* ============================================================
 *  面板 2：研发
 * ========================================================== */
function panelLab(ctx, x, y, w, s) {
  /* V6 招牌配方：跨局继承的成长线。放在研发页最上面 ——
     玩家看到某款已经 142/150 杯，下一局就会想专门练它。 */
  var sgs = sigViews(s);
  var lvN = 0, mxN = 0;
  for (var sg0 = 0; sg0 < sgs.length; sg0++) {
    if (sgs[sg0].lv > 0) lvN++;
    if (sgs[sg0].maxed) mxN++;
  }
  GFX.card(ctx, x, y, w, 34);
  text(ctx, '🏷️ 招牌配方', x + 10, y + 9, { size: FS.md, weight: 800 });
  text(ctx, lvN + '/' + sgs.length + ' 款 · 满级 ' + mxN, x + w - 10, y + 10,
    { size: FS.xs, align: 'right', color: T.cyan });
  y += 34;
  text(ctx, '累计卖出杯数跨局继承 · 专精一款比铺开十款更划算',
    x + 10, y + 2, { size: FS.xs, color: T.txt3, maxW: w - 20 });
  y += 16;
  /* 两列排布（10 款 → 5 行）：单列 10 行会把下面的配方行顶出首屏，
     玩家打开研发页先看到一整屏招牌进度、却看不到任何能点的配方。
     只显示「已成招牌」或「有进度」的配方 —— 0 杯的既看不到信息也占地方。 */
  var cw2 = (w - 8) / 2;
  var shown = [];
  for (var sgi = 0; sgi < sgs.length; sgi++) {
    if (sgs[sgi].lv > 0 || sgs[sgi].cups > 0) shown.push(sgs[sgi]);
  }
  if (!shown.length) {
    text(ctx, '还没有任何配方卖出过 —— 先上架一款吧', x + 10, y + 6,
      { size: FS.xs, color: T.txt3, maxW: w - 20 });
    y += 24;
  } else if (shown.length > 4) {
    /* ★ 招牌进度 > 4 条时**折叠成一行摘要**。
       这是为研发页腾出首屏：招牌卡原本按 2 列铺开，
       5 条就吃掉 150px+，把研发树的按钮全推到裁剪区外 ——
       实测出现过「阶段文字画出来了但0 个研发按钮可点」。
       招牌是长期目标，研发是当次决策，后者更急。 */
    text(ctx, shown.map(function (g) {
      return g.emoji + g.name + ' ' + g.cups + '/' + g.need;
    }).join('　'), x + 10, y + 4, { size: FS.xs, color: T.txt3, maxW: w - 20 });
    y += 20;
  } else {
    for (var sg = 0; sg < shown.length; sg += 2) {
      for (var cc = 0; cc < 2 && sg + cc < shown.length; cc++) {
        var g = shown[sg + cc];
        var gx = x + cc * (cw2 + 8);
        GFX.fillRR(ctx, gx, y, cw2, 26, 8, 'rgba(53,229,240,.07)', null);
        text(ctx, g.emoji, gx + 6, y + 5, { size: FS.lg });
        text(ctx, g.name, gx + 26, y + 6, { size: FS.xs, weight: 700, maxW: cw2 - 78 });
        text(ctx, g.lv > 0 ? g.tierEmoji + g.tierName : '—', gx + cw2 - 50, y + 6,
          { size: FS.xs, color: g.lv > 0 ? T.cyan : T.txt3, maxW: 46 });
        text(ctx, g.cups + (g.maxed ? '' : '/' + g.nextCups), gx + cw2 - 6, y + 6,
          { size: FS.xs, align: 'right', color: T.txt3, maxW: 48 });
        GFX.bar(ctx, gx + 6, y + 19, cw2 - 12, 4, g.ratio, { color: T.cyan });
      }
      y += 30;
    }
  }
  y += 6;

  GFX.card(ctx, x, y, w, 34);
  text(ctx, '🧪 已解锁配方', x + 10, y + 9, { size: FS.md, weight: 800 });
  text(ctx, '菜单位 ' + (s.menu || []).length + '/' + menuSlots(s), x + w - 10, y + 10,
    { size: FS.sm, align: 'right', color: T.txt3 });
  y += 44;

  var unlocked = (s.recipes || []).map(recipeById).filter(Boolean);
  for (var i = 0; i < unlocked.length; i++) {
    var r = unlocked[i];
    var on = (s.menu || []).indexOf(r.id) >= 0;
    /* V6 招牌配方徽章：招牌加成（售价/成本）已算进「基础」后面的数字里，
       这里补一个等级标记，让玩家知道这款已经是自己的招牌。 */
    var sgv = sigLevelOf(s, r.id);
    GFX.card(ctx, x, y, w, 44);
    text(ctx, r.emoji + ' ' + r.name, x + 10, y + 8, { size: FS.md, weight: 700 });
    /* V9 菜系 + 工坊状态：菜系是产品线，玩家需要一眼看出这条线能不能做 */
    var cu2 = cuisineById(r.cuisine);
    var sub2 = (cu2 ? cu2.emoji + cu2.name + ' · ' : '') + tagNames(r.tags) + ' · ' + money(num(r.price, 0));
    text(ctx, sub2, x + 10, y + 25, { size: FS.xs, color: T.txt3, maxW: w - 96 });
    /* V9：工坊是可选深度，不是门槛 —— 提示这条线开了没开 */
    if (r.cuisine) {
      var wsl = workshopLevel(s, r.cuisine);
      text(ctx, wsl > 0 ? ('🏭 Lv.' + wsl + ' · 权重+' + Math.round((workshopById(r.cuisine).saleBonus[wsl] || 0) * 100) + '%')
        : '🏭 未开线 · 研发省' + Math.round((workshopById(r.cuisine).researchCut || 0) * 100) + '%',
        x + 10, y + 36, { size: FS.xs, color: wsl > 0 ? T.cyan : T.txt3 });
    }
    if (sgv.lv > 0) {
      text(ctx, sgv.tier.emoji + ' ' + sgv.tier.name, x + w - 84, y + 8,
        { size: FS.xs, align: 'right', color: T.cyan, maxW: 74 });
    }
    GFX.button(ctx, x + w - 74, y + 10, 64, 24, on ? '✅ 在售' : '上架',
      { kind: on ? 'ghost' : 'primary', act: 'toggle', id: r.id, size: FS.sm, r: 8 });
    y += 52;
  }

  /* ---------- 城市条：V10 要求「界面明确标示当前城市及其可用菜系」 ----------
     H5 端有 cityBarHtml()，Canvas 端原本没有 —— 属功能不对等。
     Canvas 没有 tooltip，所以城市名 / 可用菜系数 / 专属原料都得画出来。 */
  y = cityBar(ctx, x, y, w, s);

  /* ---------- 研发树（V10）：按城市分组 + 阶段 + 前置 ----------
     原实现按 CUISINES 平铺，既没有"阶段"，也没有"这是哪座城的菜"。 */
  var tree = researchTree(s);
  /* ★ 分组排序：**本店城市 → 通用 → 异地**。
     原顺序是 cityName 字母序，玩家一打开研发页先看到三四个
     「需切换城市才能研发」的分组（且它们的按钮全在裁剪区外），
     真正能研的通用配方反而被挤到首屏之外。
     排序不是美观问题 —— 它决定玩家第一眼看到的是"能做的事"还是"做不了的事"。*/
  /* ★ 排序：**有可研节点的组排最前**，其次本店城市、通用、异地。
     起因是一个很难察觉的现象：GFX.button 对 `disabled` 的按钮
     **不登记命中区**（见 gfx.js），而可研节点只有 2 个左右，
     若它们所在分组排在第 5 位，玩家打开研发页会看到
     「满屏按钮、一个都点不动」—— 因为看得见的多数是禁用的。
     所以「能不能点」必须优先于「字母序好不好看」。 */
  var hasOpen = function (g) {
    for (var i = 0; i < g.nodes.length; i++) if (g.nodes[i].status === 'open') return 1;
    return 0;
  };
  tree = tree.slice().sort(function (a, b) {
    var oa = hasOpen(a), ob = hasOpen(b);
    if (oa !== ob) return ob - oa;
    var ka = a.city ? (a.city === currentCityId(s) ? 0 : 2) : 1;
    var kb = b.city ? (b.city === currentCityId(s) ? 0 : 2) : 1;
    if (ka !== kb) return ka - kb;
    return a.cityName < b.cityName ? -1 : 1;
  });
  var doneN = 0;
  for (var tn = 0; tn < RESEARCH_TREE.length; tn++) {
    if ((s.recipes || []).indexOf(RESEARCH_TREE[tn].recipe) >= 0) doneN++;
  }
  GFX.card(ctx, x, y, w, 34);
  text(ctx, '🔬 研发树', x + 10, y + 9, { size: FS.md, weight: 800 });
  text(ctx, doneN + '/' + RESEARCH_TREE.length + ' 节点', x + w - 10, y + 10,
    { size: FS.xs, align: 'right', color: T.cyan });
  y += 40;

  for (var gi = 0; gi < tree.length; gi++) {
    var g = tree[gi];
    var isAch = g.cityName.indexOf('成就') >= 0;
    /* 组标题 */
    text(ctx, (isAch ? '🏅' : (!g.city ? '🌐' : (g.isHere ? '📍' : '🗺️'))) + ' ' + g.cityName,
      x + 4, y + 8, { size: FS.sm, weight: 800, color: g.isHere || isAch || !g.city ? T.txt : T.txt3 });
    text(ctx, isAch ? '只能通过成就获得'
      : (!g.city ? '全国都能做 · 5 条基础菜系'
        : (g.isHere ? (g.nodes.length + ' 道本地菜') : '需切换经营城市才能研发')),
      x + w - 4, y + 8,
      { size: FS.xs, align: 'right', color: g.isHere || isAch || !g.city ? T.txt3 : T.amber });
    y += 20;

    /* 按阶段分组 */
    var byStage = {};
    for (var bi = 0; bi < g.nodes.length; bi++) {
      var stg = g.nodes[bi].stage;
      if (!byStage[stg]) byStage[stg] = [];
      byStage[stg].push(g.nodes[bi]);
    }
    var keys = Object.keys(byStage).map(Number).sort(function (a, b) { return a - b; });
    for (var ki = 0; ki < keys.length; ki++) {
      var st = keys[ki];
      var nodes = byStage[st];
      if (st === 99) {
        text(ctx, '📜 成就专属 · 不在研发树中', x + 8, y + 4,
          { size: FS.xs, color: T.amber, maxW: w - 16 });
        y += 18;
      } else if (st > 0) {
        /* 阶段标题带前置提示 —— Canvas 没有 tooltip，
           「需先做X」这句必须画出来，否则玩家不知道为什么点不动 */
        var pre = [];
        for (var pi = 0; pi < nodes.length; pi++) {
          var pr = nodes[pi].prereq || [];
          for (var pj = 0; pj < pr.length; pj++) {
            var pn = treeNodeById(pr[pj]);
            var pnr = pn && recipeById(pn.recipe);
            if (pnr && pre.indexOf(pnr.name) < 0) pre.push(pnr.name);
          }
        }
        text(ctx, '第 ' + st + ' 阶段' + (pre.length ? ' · 需先做「' + pre.join('、') + '」' : ''),
          x + 8, y + 4, { size: FS.xs, color: T.cyan, maxW: w - 16 });
        y += 18;
      }
      for (var ni = 0; ni < nodes.length; ni++) {
        var nd = nodes[ni];
        var nr = recipeById(nd.recipe);
        if (!nr) continue;
        var canR = (nd.status === 'open') ? { ok: true } : { ok: false, msg: '' };
        var why = '';
        if (nd.status === 'away') {
          var oc = cityById(nr.city);
          why = '需切换到' + ((oc && oc.name) || '该城市') + '才能研发';
        } else if (nd.status === 'locked') {
          why = nd.lockMsg || '前置未满足';
        } else if (nd.status === 'ach') {
          why = '成就专属 · 不可研发';
        } else if (!canR.ok && nd.status === 'open') {
          canR = canResearch(s, nd.recipe);
          why = canR.msg || '';
        }
        GFX.card(ctx, x, y, w, 50);
        text(ctx, nr.emoji + ' ' + nr.name, x + 10, y + 8, { size: FS.md, weight: 700 });
        text(ctx, nr.city ? (nr.city === currentCityId(s) ? '📍本地' : '🗺️' + ((cityById(nr.city) || {}).name || ''))
          : (tagNames(nr.tags)),
        x + 10, y + 26, { size: FS.xs, color: T.txt3, maxW: w - 100 });
        if (why) {
          text(ctx, why, x + 10, y + 26, { size: FS.xs, color: T.amber, maxW: w - 100 });
        }
        GFX.button(ctx, x + w - 84, y + 12, 74, 26,
          nd.status === 'ach' ? '成就获得' : ('研发 ' + money(nd.cost)),
        {
          kind: canR.ok ? 'amber' : 'ghost', act: 'research', id: nd.recipe,
          disabled: !canR.ok, size: FS.xs, r: 8,
        });
        y += 58;
      }
    }
    y += 4;
  }
  return y + 10;
}

/** 城市条（V10·Canvas 端）：当前城市 + 可用菜系数 + 本地特色 + 专属原料。
 *  与 H5 端 cityBarHtml 对等。
 */
function cityBar(ctx, x, y, w, s) {
  var cid = currentCityId(s);
  var city = cityById(cid);
  var local = cuisinesOfCity(cid);
  var localIngs = ingsOfCity(cid);
  var avail = availableCuisineIds(s).length;
  var v = s.venue || {};
  var prov = provinceById(v.provId);

  /* ★ 高度要克制（38~56px）。
     Canvas 首屏只有约 600px，而招牌配方卡已经占了 ~150px、
     城市条再高一点，研发树的按钮就全被推出裁剪区 ——
     GFX.addHit 在裁剪区外**不登记命中区**，于是
     「文字画出来了但一个按钮点不到」，实测就出现过 0 个研发按钮。
     所以城市信息压到两行内，必要时把原料名截断而不是换行。 */
  var h = 38;
  GFX.card(ctx, x, y, w, h);
  text(ctx, '📍', x + 10, y + 9, { size: FS.lg });
  text(ctx, (city ? city.name : cid) + (prov ? '·' + prov.name : ''),
    x + 28, y + 8, { size: FS.md, weight: 800, color: T.txt });
  /* ★ 文案与 H5 端 cityBarHtml 保持一致（「本店可用菜系 N 个」）。
     两版措辞不统一会让玩家怀疑是两个不同的功能。*/
  text(ctx, '本店可用菜系 ' + avail + ' 个' + (local.length ? ' · 本地特色 ' + local.length + ' 系' : ' · 本地暂无特色'),
    x + w - 10, y + 9, { size: FS.xs, align: 'right', color: T.cyan });
  if (localIngs.length) {
    h = 56;
    var names = [];
    for (var i = 0; i < localIngs.length; i++) names.push(localIngs[i].emoji + localIngs[i].name);
    GFX.card(ctx, x, y, w, h);
    text(ctx, '🗺️ ' + names.join('、'), x + 10, y + 40,
      { size: FS.xs, color: T.amber, maxW: w - 20 });
  }
  return y + h + 6;
}

/* ============================================================
 *  经营维度：场地类型 / 经营城市 / 经营地图位置
 *
 *  与 H5 的「🏙️ 经营信息」卡内容对等，但交互按 Canvas 重新设计：
 *    · H5 用 <select> 做省市联动 → 这里改成「点一下切下一个」的循环按钮
 *      （触屏上少一次点击，也不会被弹层遮罩误触）
 *    · H5 的坐标是两个文本框 → 这里用「定位 / 清除」按钮
 *      （Canvas 没有软键盘，文本框体验远差于按钮）
 *  校验一律走引擎，两端口径必须一致。
 * ============================================================ */
function panelVenue(ctx, x, y, w, s) {
  var v = venueView(s);

  GFX.card(ctx, x, y, w, 62);
  text(ctx, '🏙️ 经营信息', x + 10, y + 9, { size: FS.md, weight: 800 });
  text(ctx, v.typeName + ' · ' + [v.provName, v.cityName, v.districtName].filter(Boolean).join(' / '),
    x + w - 10, y + 10, { size: FS.xs, align: 'right', color: T.txt3, maxW: w * 0.55 });
  text(ctx, '场地类型（点按循环切换）', x + 10, y + 26, { size: FS.xs, color: T.txt2 });
  GFX.button(ctx, x + 10, y + 40, 124, 30, v.typeEmoji + ' ' + v.typeName + ' ▸',
    { kind: 'primary', act: 'vtypeNext', size: FS.sm, r: 9 });
  text(ctx, v.typeDesc, x + 144, y + 48, { size: FS.xs, color: T.txt3, maxW: w - 154 });
  y += 72;

  /* 省市：点一下切到下一个值。列表很长时循环是唯一合理的触屏交互 */
  GFX.card(ctx, x, y, w, 96);
  text(ctx, '经营城市', x + 10, y + 9, { size: FS.md, weight: 800 });
  text(ctx, '限中国大陆 · 点按循环', x + w - 10, y + 10, { size: FS.xs, align: 'right', color: T.txt3 });
  var halfW = (w - 30) / 2;
  GFX.button(ctx, x + 10, y + 26, halfW, 30, '省 ' + v.provName + ' ▸',
    { kind: 'ghost', act: 'vprovNext', size: FS.xs, r: 9 });
  GFX.button(ctx, x + 20 + halfW, y + 26, halfW, 30, '市 ' + v.cityName + ' ▸',
    { kind: 'ghost', act: 'vcityNext', size: FS.xs, r: 9 });
  /* 区级是可选粒度：没收录的城市不画这一行，而不是给一颗点了没反应的按钮 */
  if (v.hasDistrictData) {
    GFX.button(ctx, x + 10, y + 60, w - 20, 30, '区 ' + (v.districtName || '（不指定）') + ' ▸',
      { kind: 'ghost', act: 'vdistNext', size: FS.xs, r: 9 });
  } else {
    text(ctx, '该城市暂未收录区级（可选仅到市级）', x + 10, y + 70, { size: FS.xs, color: T.txt3, maxW: w - 20 });
  }
  y += 106;

  /* 地图坐标：Canvas 无软键盘，用「定位 / 清除」 */
  GFX.card(ctx, x, y, w, 74);
  text(ctx, '经营地图位置', x + 10, y + 9, { size: FS.md, weight: 800 });
  text(ctx, GEO.COORD_SYS + '（高德）', x + w - 10, y + 10, { size: FS.xs, align: 'right', color: T.txt3 });
  text(ctx, v.hasGeo ? (v.geo.lng + ', ' + v.geo.lat) : '尚未选点',
    x + 10, y + 30, { size: FS.sm, color: v.hasGeo ? T.cyan : T.txt3, maxW: w - 20 });
  GFX.button(ctx, x + 10, y + 46, 96, 28, v.hasGeo ? '清除坐标' : '定位当前城市',
    { kind: v.hasGeo ? 'ghost' : 'primary', act: v.hasGeo ? 'vgeoclear' : 'vgeoCity', size: FS.xs, r: 9 });
  text(ctx, '境内 ' + GEO.MIN_LAT + '~' + GEO.MAX_LAT + ' / ' + GEO.MIN_LNG + '~' + GEO.MAX_LNG,
    x + 116, y + 63, { size: FS.xs, color: T.txt3, maxW: w - 126 });
  y += 84;
  return y;
}


/* ============================================================
 *  面板 3：升级
 * ========================================================== */
function panelUp(ctx, x, y, w, s) {
  /* 经营维度放在**页面最前面**（设备升级之前），不放末尾：
     Canvas 面板首屏只有约 600px，升级项 6 条就占了 350px —— 放在末尾的话
     经营信息整块会被推出裁剪区（命中区直接不登记，等于这功能在小游戏端不存在）。
     它又是"店铺的静态属性"，本来就该排在花钱升级之前。 */
  y = panelVenue(ctx, x, y, w, s);

  /* V9 制作工坊排在**店铺升级之前**（不是之后）：
     Canvas 面板首屏只有约 600px，6 条升级项就占 348px —— 放在末尾时
     工坊整块会被推出裁剪区，而 GFX.addHit 在裁剪区外**不登记命中区**，
     结果是"卡片画不出来、按钮也点不到"，整个系统在小游戏端等于不存在。
     这与经营维度面板曾经踩的坑是同一个（见panelVenue 的注释）。
     语义上也合理：先决定开哪几条产品线，再谈买设备提速。 */
  /* V9 制作工坊：菜系的生产线，三层收益全是加成（研发折扣 / 销量权重 /
     高端款加成），不做硬约束。放在分店之前 —— 它比开分店更早成为中期决策。 */
  var cvs2 = cuisineViews(s);
  GFX.card(ctx, x, y, w, 34);
  text(ctx, '🏭 制作工坊', x + 10, y + 9, { size: FS.md, weight: 800 });
  text(ctx, cvs2.filter(function (c) { return c.level > 0; }).length + '/' + cvs2.length + ' 条产线',
    x + w - 10, y + 10, { size: FS.xs, align: 'right', color: T.txt3 });
  y += 40;
  text(ctx, '工坊 = 三层加成（成本下降为主力 / 研发更便宜 / 更抢手）；不建也能研发上架',
    x + 4, y + 2, { size: FS.xs, color: T.txt3, maxW: w - 8 });
  y += 18;
  for (var wi = 0; wi < cvs2.length; wi++) {
    var cv2 = cvs2[wi];
    var wsn = workshopById(cv2.id);
    GFX.card(ctx, x, y, w, 58);
    text(ctx, cv2.emoji + ' ' + wsn.name + ' Lv.' + cv2.level + '/' + cv2.maxLevel,
      x + 10, y + 8, { size: FS.sm, weight: 700, maxW: w - 90 });
    text(ctx, cv2.unlocked + '/' + cv2.total + ' 款已研发', x + 10, y + 24,
      { size: FS.xs, color: T.txt3 });
    var focusTxt2 = cv2.focusCount >= 2
      ? ('🔥 主打' + cv2.focusLabel + ' +' + Math.round(cv2.focusBonus * 100) + '%')
      : ('同系满2款触发主打 · 现' + cv2.focusCount + '款');
    text(ctx, focusTxt2, x + 10, y + 40,
      { size: FS.xs, color: cv2.focusCount >= 2 ? T.amber : T.txt3, maxW: w - 100 });
    if (cv2.cost == null) {
      text(ctx, '已满级', x + w - 10, y + 22, { size: FS.xs, align: 'right', color: T.green });
    } else {
      GFX.button(ctx, x + w - 76, y + 16, 66, 26, money(cv2.cost), {
        kind: canAfford(s, cv2.cost) ? 'primary' : 'ghost', act: 'workshop', id: cv2.id,
        disabled: !canAfford(s, cv2.cost), size: FS.xs, r: 8,
      });
    }
    y += 66;
  }

  GFX.card(ctx, x, y, w, 34);
  text(ctx, '⬆️ 店铺升级', x + 10, y + 9, { size: FS.md, weight: 800 });
  y += 44;
  for (var i = 0; i < UPGRADES.length; i++) {
    var u = UPGRADES[i];
    var lv = num(s.up[u.id], 0);
    var cost = upgradeCost(s, u.id);
    var maxed = cost == null;
    GFX.card(ctx, x, y, w, 50);
    text(ctx, u.emoji + ' ' + u.name, x + 10, y + 8, { size: FS.md, weight: 700 });
    text(ctx, u.desc, x + 10, y + 26, { size: FS.xs, color: T.txt3, maxW: w - 120 });
    /* 等级点：数量按各自 max 画。写死 6 的话 speed/decor（max 8）满级也只亮 6 个。 */
    for (var d = 0; d < num(u.max, 6); d++) {
      ctx.fillStyle = d < lv ? T.cyan : 'rgba(255,255,255,.13)';
      ctx.beginPath(); ctx.arc(x + w - 100 + d * 11, y + 15, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    GFX.button(ctx, x + w - 76, y + 22, 66, 22, maxed ? '已满级' : money(cost), {
      kind: maxed ? 'ghost' : 'primary', act: 'upgrade', id: u.id,
      disabled: maxed || !canAfford(s, cost), size: FS.xs, r: 8,
    });
    y += 58;
  }

  /* 开分店。必须用 shopCost()：它带 diffOf(s).costMult，
     直接用 SHOP_COSTS 会把地狱难度的价标少 15%，出现「按钮亮着、点了说钱不够」。 */
  var sc = shopCost(s);
  GFX.card(ctx, x, y, w, 50);
  text(ctx, '🏪 开设分店', x + 10, y + 8, { size: FS.md, weight: 700 });
  text(ctx, '当前 ' + num(s.shops) + ' 家 · 出杯位 +1、客流 +60%', x + 10, y + 26,
    { size: FS.xs, color: T.txt3 });
  GFX.button(ctx, x + w - 76, y + 12, 66, 26, sc != null ? money(sc) : '已满', {
    kind: 'amber', act: 'shop', disabled: sc == null || !canAfford(s, sc), size: FS.xs, r: 8,
  });
  y += 60;

  /* 品牌声望（与 H5 的「🌟 品牌声望」卡对齐：说明钱从哪来、为什么不直接加客流） */
  var mbp = num(META().bp, 0);
  GFX.card(ctx, x, y, w, 62);
  text(ctx, '🌟 品牌声望 ' + mbp + ' ★', x + 10, y + 8, { size: FS.md, weight: 700 });
  text(ctx, '开局创业基金 ' + money(prestigeStartCash(mbp)) + '（封顶 ' + money(CFG.BP_START_CAP) + '）',
    x + w - 10, y + 9, { size: FS.xs, align: 'right', color: T.green });
  text(ctx, '本局已到账 +' + money(num(s.startBonus, 0)) + '，由你决定投去雇人 / 提速 / 开店',
    x + 10, y + 28, { size: FS.xs, color: T.txt3, maxW: w - 20 });
  text(ctx, '声望不再直接加客流（客人多到做不过来只会流失扣口碑）；现在转生 +'
    + prestigeGain(s) + ' ★', x + 10, y + 44, { size: FS.xs, color: T.txt3, maxW: w - 20 });
  y += 72;

  /* 转生 / 收官 */
  GFX.button(ctx, x, y, (w - 10) / 2, 40, '♻️ 品牌升级',
    { kind: 'amber', act: 'prestige', size: FS.md });
  GFX.button(ctx, x + (w - 10) / 2 + 10, y, (w - 10) / 2, 40, '🏁 提前收官',
    { kind: 'ghost', act: 'finish', size: FS.md });
  y += 50;
  return y + 10;
}

/* ============================================================
 *  面板 4：员工
 * ========================================================== */
function panelStaff(ctx, x, y, w, s) {
  GFX.card(ctx, x, y, w, 34);
  text(ctx, '👥 我的员工', x + 10, y + 9, { size: FS.md, weight: 800 });
  text(ctx, '出杯位 ' + stationCount(s) + ' 个', x + w - 10, y + 10,
    { size: FS.sm, align: 'right', color: T.cyan });
  y += 44;

  var st = s.staff || [];
  if (!st.length) {
    GFX.card(ctx, x, y, w, 36);
    text(ctx, '还没有员工，出杯位只有老板 1 个', x + 10, y + 11, { size: FS.sm, color: T.txt3 });
    y += 46;
  }
  for (var i = 0; i < st.length; i++) {
    var p = st[i];
    var tr = traitById(p.trait);
    GFX.card(ctx, x, y, w, 60);
    text(ctx, p.emoji + ' ' + p.name, x + 10, y + 8, { size: FS.md, weight: 700 });
    text(ctx, (tr ? tr.emoji + ' ' + tr.name : '无特质') + ' · 日薪 ' + money(p.wage),
      x + 10, y + 26, { size: FS.xs, color: T.txt2 });
    GFX.bar(ctx, x + 10, y + 44, w - 96, 5, num(p.stamina) / 100, { color: T.green });
    text(ctx, '体力 ' + Math.round(num(p.stamina)), x + w - 84, y + 40, { size: FS.xs, color: T.txt3 });
    GFX.button(ctx, x + w - 44, y + 18, 34, 24, '解雇', { kind: 'danger', act: 'fire', id: String(p.id), size: FS.xs, r: 7 });
    y += 68;
  }
  /* 团建：H5 有这个按钮，小游戏原本没有 —— teamBuild() 成了死代码，
     员工体力只能靠随机事件或过天慢慢回。 */
  if (st.length) {
    var tbc = Math.round(180 * (1 + st.length * 0.4));
    GFX.button(ctx, x, y, w, 38, '🎉 团建（全员体力回满）' + money(tbc),
      { kind: 'amber', act: 'teambuild', size: FS.md, disabled: !canAfford(s, tbc), pressed: isPressed('teambuild') });
    y += 48;
  }

  GFX.card(ctx, x, y, w, 34);
  text(ctx, '📋 候选人', x + 10, y + 9, { size: FS.md, weight: 800 });
  y += 44;
  var cd = s.candidates || [];
  for (var j = 0; j < cd.length; j++) {
    var c = cd[j];
    var ct = traitById(c.trait);
    GFX.card(ctx, x, y, w, 54);
    text(ctx, c.emoji + ' ' + c.name, x + 10, y + 8, { size: FS.md, weight: 700 });
    text(ctx, (ct ? ct.emoji + ' ' + ct.name : '') + ' · 技能 ' + c.skill + ' · 日薪 ' + money(c.wage),
      x + 10, y + 27, { size: FS.xs, color: T.txt2 });
    GFX.button(ctx, x + w - 76, y + 14, 66, 26, '雇佣 ' + money(c.fee), {
      kind: 'primary', act: 'hire', id: String(j),
      /* 只校验聘用费：hireStaff() 也只扣 fee，多算一个 wage 会让能雇的人变灰 */
      disabled: !canAfford(s, c.fee), size: FS.xs, r: 8,
    });
    y += 62;
  }
  return y + 10;
}

/* ============================================================
 *  面板 5：商圈
 * ========================================================== */

/** 店铺地图面板（V12·Canvas 端）
 *  与 H5 端 storesPanelHtml 对等。Canvas 上没有 tooltip，
 *  所以店铺现金/营收/店长/模式等关键信息都得画出来。
 */
/** 城市地图（V13·Canvas 端）
 *  与 H5 端 cityMapPanelHtml 对等：同一份数据（engine.cityMapView），
 *  只是 SVG 换成 ctx 绘制。
 */
function panelCityMap(ctx, x, y, w, s) {
  var mv = cityMapView(s);
  var mh = 200;
  /* 弹窗内容：从 y 开始画（外层由 drawModal 的 sheet 提供） */
  text(ctx, mv.geoTotal + ' 个有坐标城市 · ' + mv.cityTotal + ' 市 · ' + mv.provs.length + ' 省',
    x + 10, y + 8, { size: FS.xs, color: T.txt3, maxW: w - 20 });
  y += 24;

  /* 地图区 */
  var mhH = 168;
  GFX.card(ctx, x, y, w, mhH);
  var pad = 12;
  var iw = w - pad * 2, ih = mhH - pad * 2;
  /* 十字参考线 */
  ctx.fillStyle = 'rgba(255,255,255,.05)';
  ctx.fillRect(x + pad + iw / 2 - 0.5, y + pad, 1, ih);
  ctx.fillRect(x + pad, y + pad + ih / 2 - 0.5, iw, 1);
  /* 城市点 */
  for (var i = 0; i < mv.points.length; i++) {
    var p = mv.points[i];
    var px2 = x + pad + p.x * iw;
    var py2 = y + pad + (1 - p.y) * ih;
    var r = p.isCurrent ? 6 : 3.5;
    ctx.fillStyle = p.isCurrent ? T.amber : T.cyan;
    ctx.globalAlpha = p.isCurrent ? 1 : 0.8;
    ctx.beginPath();
    ctx.arc(px2, py2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (p.isCurrent) {
      ctx.strokeStyle = T.amber; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(px2, py2, 10, 0, Math.PI * 2); ctx.stroke();
    }
    /* 命中区：半径放大到 12px（手指点得中） */
    GFX.addHit(px2 - 12, py2 - 12, 24, 24, 'mapcity', p.id, null);
  }
  y += mhH + 8;

  /* 当前城市信息 */
  var cur = cityById(mv.currentCityId);
  if (cur) {
    GFX.card(ctx, x, y, w, 46);
    text(ctx, '📍 ' + cur.name, x + 10, y + 8, { size: FS.md, weight: 800, color: T.amber });
    var cu = cuisinesOfCity(cur.id);
    text(ctx, cu.length ? '本地特色：' + cu.map(function (id) {
      var c = cuisineById(id); return c ? c.emoji + c.name : id;
    }).join('、') : '暂无本地特色菜系（走通用菜系）',
      x + 10, y + 26, { size: FS.xs, color: T.txt3, maxW: w - 90 });
    GFX.button(ctx, x + w - 80, y + 12, 70, 22, '切换城市', {
      kind: 'primary', act: 'mapgoto', size: FS.xs, r: 7,
    });
    y += 54;
  }

  /* 省份概览（两列） */
  var cols = 2;
  var rows = Math.ceil(mv.provs.length / cols);
  var ph = rows * 15 + 26;
  GFX.card(ctx, x, y, w, ph);
  text(ctx, '省份概览', x + 10, y + 8, { size: FS.sm, weight: 800, color: T.txt3 });
  for (var pi = 0; pi < mv.provs.length; pi++) {
    var pv = mv.provs[pi];
    var col = pi % cols, row = (pi / cols) | 0;
    var tx = x + 10 + col * ((w - 20) / cols);
    var ty = y + 24 + row * 15;
    text(ctx, pv.name, tx, ty, {
      size: FS.xs, color: pv.isCurrent ? T.amber : T.txt3, maxW: (w - 20) / cols - 40,
    });
    text(ctx, pv.cityCount + ' 市', tx + (w - 20) / cols - 42, ty,
      { size: FS.xs, color: T.txt3, opacity: 0.75 });
  }
  return y + ph + 8;
}

function panelStores(ctx, x, y, w, s) {
  var stores = allStores(s);
  var cost = shopCost(s);
  var left = Math.max(0, (SHOP_COSTS.length || 0) + 1 - stores.length);

  GFX.card(ctx, x, y, w, 46);
  text(ctx, '🗺️ 店铺地图', x + 10, y + 8, { size: 12, weight: 800, color: T.txt });
  text(ctx, stores.length + ' 家店 · ' + managerCount(s) + ' 名店长',
    x + w - 10, y + 9, { size: 9.5, align: 'right', color: T.cyan });
  text(ctx, '开店费 ' + money(cost || 0) + '（可开 ' + left + ' 家）',
    x + 10, y + 26, { size: 9.5, color: T.txt3, maxW: w - 20 });
  y += 54;

  for (var i = 0; i < stores.length; i++) {
    var st = stores[i];
    var mg = storeManager(s, st);
    var staffN = staffOfBranch(s, st.branch).length;
    var rpt = st.lastReport;
    var h = 118;
    GFX.card(ctx, x, y, w, h);
    /* 店名 + 主店/托管标记 */
    text(ctx, st.emoji + ' ' + st.name, x + 10, y + 8,
      { size: 12, weight: 800, color: T.txt, maxW: w - 130 });
    if (st.isMain) {
      text(ctx, '⭐主店', x + w - 10, y + 9, { size: 9, align: 'right', color: T.amber });
    } else {
      text(ctx, st.auto ? '🤖托管' : '✋自营', x + w - 10, y + 9,
        { size: 9, align: 'right', color: st.auto ? T.purple : T.green });
    }
    var city = cityById(st.cityId);
    text(ctx, '📍' + (city ? city.name : st.cityId) + ' · Lv.' + st.level
      + ' · 编制 ' + staffN + '/' + branchStaffCap(s, st.branch),
      x + 10, y + 24, { size: 9, color: T.txt3, maxW: w - 20 });
    /* 经营数据 */
    text(ctx, '现金 ' + money(st.cash) + '　营收 ' + money(st.income)
      + '　出杯 ' + st.cups,
      x + 10, y + 40, { size: 9.5, color: T.txt2, maxW: w - 20 });
    /* 店长 */
    text(ctx, mg ? ('店长 ' + mg.emoji + ' ' + mg.name + ' Lv.' + mg.lv + ' ' + managerRank(mg.lv).name)
      : '未指派店长（亲自经营）',
      x + 10, y + 56, { size: 9.5, color: mg ? T.amber : T.txt3, maxW: w - 20 });
    /* 最近报表 */
    var rptTxt = '';
    if (rpt) {
      rptTxt = rpt.empty ? '昨日：空店（无员工），仅扣固定开支'
        : ('昨日：客流 ' + rpt.traffic + ' · 出杯 ' + rpt.cups
          + ' · 净利 ' + money(rpt.net));
    }
    if (rptTxt) {
      text(ctx, rptTxt, x + 10, y + 72, { size: 9, color: T.txt3, maxW: w - 20 });
    }
    /* 操作按钮：两行
       第一行：经营控制（接管/托管、任命/撤下店长、设为主店）
       第二行：资金与设置（注资、提现、改名、关店）
       ★ Canvas 上按钮一多就挤 —— 分两行，每行 3~4 个，
         高度从 92 涨到 118。 */
    var by = y + h - 48;
    var bw = (w - 26) / 3;
    if (mg) {
      GFX.button(ctx, x + 8, by, bw, 26, st.auto ? '我来接管' : '交给店长', {
        kind: 'primary', act: 'stoggle', id: st.branch, extra: st.auto ? 0 : 1, size: 9, r: 7,
      });
      GFX.button(ctx, x + 8 + bw + 5, by, bw, 26, '撤下店长', {
        kind: 'ghost', act: 'smgrfire', id: st.branch, size: 9, r: 7,
      });
    } else {
      GFX.button(ctx, x + 8, by, bw, 26, '任命店长', {
        kind: 'primary', act: 'smgrh', id: st.branch, size: 9, r: 7,
      });
    }
    GFX.button(ctx, x + 8 + (bw + 5) * 2, by, bw, 26, st.isMain ? '主店' : '设为主店', {
      kind: 'ghost', act: 'smain', id: st.branch, disabled: st.isMain, size: 9, r: 7,
    });
    var by2 = by + 26;
    var bw2 = (w - 26) / 4;
    GFX.button(ctx, x + 8, by2, bw2, 26, '💰注资', {
      kind: 'ghost', act: 'sfund', id: st.branch, size: 9, r: 7,
    });
    GFX.button(ctx, x + 8 + bw2 + 4, by2, bw2, 26, '💵提现', {
      kind: 'ghost', act: 'sdraw', id: st.branch, size: 9, r: 7,
    });
    GFX.button(ctx, x + 8 + (bw2 + 4) * 2, by2, bw2, 26, '改名', {
      kind: 'ghost', act: 'srename', id: st.branch, size: 9, r: 7,
    });
    /* 关店只在非总店时出现（总店不可关闭） */
    if (!st.isMain) {
      GFX.button(ctx, x + 8 + (bw2 + 4) * 3, by2, bw2, 26, '关店', {
        kind: 'ghost', act: 'sclose', id: st.branch, size: 9, r: 7,
      });
    }
    /* ---- 店铺级升级（V12.1）----
       Canvas 上没有折叠交互（点标题展开），所以直接列出来。
       每店 4 项 → 4 行 × 22px = 88px，卡片要相应变高。 */
    var upH = 0;
    for (var ui = 0; ui < STORE_UPGRADES.length; ui++) {
      var uu = STORE_UPGRADES[ui];
      var ulv = storeUpLevel(s, st, uu.id);
      var ucost = storeUpCost(s, st, uu.id);
      text(ctx, uu.emoji + ' ' + uu.name, x + 10, y + h + upH + 4,
        { size: 9.5, color: T.txt, maxW: w - 100 });
      text(ctx, 'Lv.' + ulv + '/' + uu.max, x + w - 92, y + h + upH + 4,
        { size: 9, color: T.txt3 });
      if (ucost == null) {
        text(ctx, '已满级', x + w - 10, y + h + upH + 4,
          { size: 9, align: 'right', color: T.amber });
      } else {
        GFX.button(ctx, x + w - 76, y + h + upH - 4, 66, 24, money(ucost), {
          kind: s.cash >= ucost ? 'ghost' : 'ghost', act: 'stbuy',
          id: st.branch, extra: uu.id, disabled: s.cash < ucost, size: 8.5, r: 6,
        });
      }
      upH += 28;
    }
    /* ---- 待聘店长（关店留档，可免费请回）---- */
    var fms = s.formerManagers || [];
    for (var fi = 0; fi < fms.length; fi++) {
      var fm = fms[fi];
      text(ctx, '📋 ' + fm.emoji + ' ' + fm.name, x + 10, y + h + upH + 4,
        { size: 9.5, color: T.purple, maxW: w - 100 });
      text(ctx, '原任职于' + (fm.fromStore || '已关闭店铺'), x + w - 92, y + h + upH + 4,
        { size: 8.5, color: T.txt3, maxW: 74 });
      GFX.button(ctx, x + w - 76, y + h + upH - 4, 66, 24, '请回', {
        kind: 'primary', act: 'smgrre', id: st.branch, extra: fm.id, size: 8.5, r: 6,
      });
      upH += 28;
    }
    h += upH;
    y += h + 8;
  }

  /* 开店入口 */
  GFX.button(ctx, x, y, w, 30, cost == null ? '已达分店上限' : ('🗺️ 开设新店 · ' + money(cost)),
    { kind: cost == null ? 'ghost' : 'primary', act: 'sopen', disabled: cost == null, size: 11, r: 9 });
  return y + 38;
}

function panelRival(ctx, x, y, w, s) {
  /* ★ V13：城市地图入口（**紧凑条**，详细内容进弹窗）。
     ★ 为什么 Canvas 端不能像 H5 那样把地图铺在页面上：
       Canvas 一屏只有约 600px，而「地图(300+) + 店铺列表(每店 118px)」
       必然超出 —— 超出部分被裁剪区切掉，
       下方按钮**画出来了但点不到**（GFX.addHit 在裁剪区外不登记）。
       实测就出现过：地图一加，店铺页的开店/注资/升级按钮命中区全变 0。
       所以 Canvas 端用「入口条 + 弹窗」，H5 端用「直接铺开」（H5 可滚动，没这个问题）。
       —— 两版的**信息与功能对等**，呈现形态按各自平台的约束调整。 */
  var mv0 = cityMapView(s);
  GFX.card(ctx, x, y, w, 44);
  text(ctx, '🗺️ 城市地图', x + 10, y + 8, { size: FS.md, weight: 800, color: T.txt });
  text(ctx, mv0.geoTotal + ' 城 · ' + mv0.provs.length + ' 省', x + 92, y + 9,
    { size: FS.xs, color: T.cyan });
  text(ctx, '当前：' + mv0.currentCityName, x + 10, y + 26,
    { size: FS.xs, color: T.txt3, maxW: w - 110 });
  GFX.button(ctx, x + w - 88, y + 10, 78, 24, '打开地图', {
    kind: 'primary', act: 'mapopen', size: FS.xs, r: 7,
  });
  y += 52;
  /* ★ V12：店铺地图紧随其后 */
  y = panelStores(ctx, x, y, w, s);
  var rv = s.rival || {};
  var share = num(rivalShare(s));
  GFX.card(ctx, x, y, w, 96);
  text(ctx, '🏙️ 商圈争夺', x + 10, y + 9, { size: FS.md, weight: 800 });
  text(ctx, (rv.emoji || '🦑') + ' ' + (rv.name || '竞争对手'), x + 10, y + 28,
    { size: FS.lg, weight: 800, color: T.pink });
  text(ctx, '抢走客流 ' + Math.round(share * 100) + '%', x + w - 10, y + 28,
    { size: FS.sm, align: 'right', color: share > 0.15 ? T.red : T.txt2 });
  GFX.bar(ctx, x + 10, y + 52, w - 20, 8, share / 0.4, { color: T.pink });
  /* rival 上没有 cash 字段（只有 rep / aggro / proof），写上去恒显示 ¥0 */
  text(ctx, '声望 ' + Math.round(num(rv.rep)) + ' · 护城河 Lv.' + num(rv.proof),
    x + 10, y + 68, { size: FS.sm, color: T.txt3 });
  y += 106;

  for (var i = 0; i < RIVAL_ACTIONS.length; i++) {
    var a = RIVAL_ACTIONS[i];
    GFX.card(ctx, x, y, w, 58);
    text(ctx, a.emoji + ' ' + a.name, x + 10, y + 8, { size: FS.md, weight: 700 });
    text(ctx, a.desc, x + 10, y + 27, { size: FS.xs, color: T.txt3, maxW: w - 100 });
    GFX.button(ctx, x + w - 84, y + 16, 74, 26, money(a.cost), {
      kind: 'primary', act: 'rivalact', id: a.id,
      disabled: !canAfford(s, a.cost), size: FS.xs, r: 8,
    });
    y += 66;
  }
  return y + 10;
}

/* ============================================================
 *  面板 6：成就
 * ========================================================== */
function panelAch(ctx, x, y, w, s) {
  var got = 0;
  for (var k = 0; k < ACHIEVEMENTS.length; k++) if (s.ach[ACHIEVEMENTS[k].id]) got++;
  GFX.card(ctx, x, y, w, 34);
  text(ctx, '🏅 成就', x + 10, y + 9, { size: FS.md, weight: 800 });
  text(ctx, got + '/' + ACHIEVEMENTS.length, x + w - 10, y + 10,
    { size: FS.sm, align: 'right', color: T.amber });
  y += 44;
  text(ctx, '本局达成给现金；跨局首次达成额外给 ★（' + achStarText() + '）',
    x + 10, y - 6, { size: FS.xs, color: T.txt3, maxW: w - 20 });

  var cols = 3, cw = (w - 8 * (cols - 1)) / cols;
  for (var i = 0; i < ACHIEVEMENTS.length; i++) {
    var a = ACHIEVEMENTS[i];
    var on = !!s.ach[a.id];
    var cx = x + (i % cols) * (cw + 8);
    var cy = y + Math.floor(i / cols) * 68;
    GFX.fillRR(ctx, cx, cy, cw, 60, 12,
      on ? 'rgba(255,194,71,.14)' : T.card,
      on ? 'rgba(255,194,71,.5)' : T.line);
    text(ctx, a.emoji, cx + cw / 2, cy + 6, { size: FS.display, align: 'center' });
    text(ctx, a.name, cx + cw / 2, cy + 30, { size: FS.xs, weight: 700, align: 'center', color: on ? T.amber : T.txt3, maxW: cw - 6 });
    text(ctx, on ? '+' + a.reward.bp + '★' : a.desc, cx + cw / 2, cy + 44, { size: FS.xs, align: 'center', color: T.txt3, maxW: cw - 6 });
  }
  return y + Math.ceil(ACHIEVEMENTS.length / cols) * 68 + 10;
}

var PANELS = {
  manage: panelManage, lab: panelLab, up: panelUp,
  staff: panelStaff, rival: panelRival, ach: panelAch,
};

/* ============================================================
 *  营业舞台
 *  核心手感就在「点出杯位」上，按钮必须够大、反馈必须即时
 * ========================================================== */

/* 在给定宽高里挑一套能装下 n 个出杯位的网格。
   策略是先加列、后压高度：点击块越大越好点，宁可窄一点也不想变矮。
   返回 null 表示一套都装不下（走滑动兜底）。 */
var STATION_GRIDS = [
  { cols: 2, sh: 76 }, { cols: 3, sh: 76 }, { cols: 4, sh: 76 },
  { cols: 4, sh: 62 }, { cols: 4, sh: 52 },
];
/**
 * 挑一套装得下的工位网格（V15 改成等距口径）
 *
 * ★ 原判定是 `rows * (g.sh + 8) - 8 <= viewH`（矩形占高）。
 *   等距下纵向占高 = maxDepth × (TH/2) + 常数，TH 又由 TW 决定 ——
 *   两套公式的量级不同，用矩形判据会**选错列数**：
 *   9 个工位在 390 屏上，矩形判据说「2 列 3 行 = 252px 装得下」，
 *   而等距实际只占约 170px（装得下却显得空）；
 *   反过来 20 个工位在小屏上，矩形判据偏乐观，选出横向挤爆的列数。
 *
 * ★ 现在按等距占高判：遍历候选网格时用**同款公式**估一遍，
 *   装不下的就往后试（更多列 → 每行更窄）。
 *   TH 用候选 sh 反推（TH ≈ sh*0.5，等距纵向占高的经验比例）。
 */
function pickStationGrid(n, w, viewH) {
  if (!(n > 0)) return { cols: 2, sh: 76 };
  for (var i = 0; i < STATION_GRIDS.length; i++) {
    var g = STATION_GRIDS[i];
    var rows = Math.ceil(n / g.cols);
    /* ★ 真实最大深度（不是最后一行 —— 等距下「最后一个」未必最靠下）*/
    var md = 0;
    for (var q = 0; q < n; q++) {
      var d = (q % g.cols) + Math.floor(q / g.cols);
      if (d > md) md = d;
    }
    /* 等距纵向占高：深度每加 1，屏幕 y 下移 TH/2 */
    var thEst = g.sh * 0.5;
    var isoH = md * (thEst / 2) + thEst * 2.4 + g.sh * 0.5;
    if (Math.max(g.sh, isoH) <= viewH) return g;
  }
  return STATION_GRIDS[STATION_GRIDS.length - 1];
}

/* ============================================================
 *  V15 伪 3D 舞台（等距俯视斜角）
 * ============================================================
 *
 * ★ 改造范围严格限定在**表现层**：
 *   引擎（js/engine.js）、玩法数值、关卡、输入 action 一律没动。
 *   数据结构不变（sim.stations / sim.queue 照旧），
 *   只是把「矩形网格 + 矩形卡片」换成「菱形地面 + 立方体工位」。
 *
 * ★ 为什么工位用**立方体**而不是贴图：
 *   等距视角下手写一张斜角贴图在两种分辨率下都会糊；
 *   而立方体是**参数化**的（TW/TH/TZ），改一个数就适配所有屏幕。
 *   代价只是每个工位多画 3 个面（顶 + 两个侧）。
 *
 * ★ 深度顺序：工位**按 gx+gy 排**（越靠前越晚画）。
 *   等距里「屏幕 y 大的 = 更靠前」，而 y ∝ (gx+gy)。
 *   ★ 同深度按工位序稳定 —— 两个工位斜对着时不会在帧间跳变。
 *
 * ★ 拾取：**不用反投影**，仍给 GFX.addHit 一个矩形。
 *   ★ 为什么：反投影只能给出菱形的**中心归属格**，
 *     而点在立方体侧面（屏幕上偏下偏左）会算到别的格子；
 *     更根本的是「玩家点哪都要有反应」，菱形反投影会漏掉边缘。
 *   ★ 矩形重叠的处理：addHit 的 hitAt 是**从后往前找**（后登记优先，
 *     见 gfx.js:229），所以**按绘制顺序正序登记**即可——
 *     后画的（更靠前的）先被测到，与视觉遮挡一致。
 */

/** 工位的深度排序器（复用数组，不逐帧分配） */
var ISO_STAGE_SORT = isoSorter(48);

/**
 * 画一个工位（立方体 + 顶面信息 + 进度）。
 *
 * @param {object} ctx canvas
 * @param {number} cx,cy 立方体底面中心的屏幕坐标
 * @param {number} w     立方体宽（像素）
 * @param {number} h     立方体高（像素）
 * @param {number} pulse V14.2 的点击脉冲 0~1（0 = 无）
 * @param {boolean} compact 小尺寸模式（省掉次要信息）
 * @param {object} T2 颜色表
 * @returns {{x:number,y:number,w:number,h:number}} 建议的命中区
 */
function drawStationIso(ctx, cx, cy, st, w, h, pulse, compact, T2) {
  var busy = !!st.order;
  var a = w / 2;
  /* ★ 忙碌时立方体更高（"在忙"），空闲时矮 ——
     高度差本身就是状态信号，不用读文字就知道哪个在出杯。 */
  var boxH = (busy ? h * 0.62 : h * 0.34);
  var lift = 1 + 0.18 * pulse;          /* 刚被点击时轻微「弹起」*/
  var topY = cy - boxH * lift;
  var p = a * (1 + 0.18 * pulse);
  var b = ISO.TH * 0.5;

  /* ① 阴影贴地（先画，会被立方体压住一半——这才是正确的层次）*/
  isoShadow(ctx, (cx - ISO.ox) / (ISO.TW / 2), 0, a * 0.95, ISO.TH * 0.40,
    busy ? 0.30 : 0.18);

  /* ② 两个侧面（光从右上来：右面比左面亮）*/
  var col = busy
    ? { top: 'rgba(53,229,240,.30)', right: 'rgba(53,229,240,.22)', left: 'rgba(53,229,240,.12)', edge: 'rgba(53,229,240,.55)' }
    : { top: 'rgba(255,255,255,.10)', right: 'rgba(255,255,255,.05)', left: 'rgba(0,0,0,.22)', edge: T2.line };

  ctx.beginPath();
  ctx.moveTo(cx + p, topY); ctx.lineTo(cx + p, cy);
  ctx.lineTo(cx, cy + b); ctx.lineTo(cx, topY + b);
  ctx.closePath();
  ctx.fillStyle = col.right; ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx - p, topY); ctx.lineTo(cx - p, cy);
  ctx.lineTo(cx, cy + b); ctx.lineTo(cx, topY + b);
  ctx.closePath();
  ctx.fillStyle = col.left; ctx.fill();

  /* ③ 顶面 */
  ctx.beginPath();
  ctx.moveTo(cx, topY - b); ctx.lineTo(cx + p, topY);
  ctx.lineTo(cx, topY + b); ctx.lineTo(cx - p, topY);
  ctx.closePath();
  ctx.fillStyle = col.top; ctx.fill();
  if (col.edge) { ctx.strokeStyle = col.edge; ctx.lineWidth = 1; ctx.stroke(); }

  /* ④ 顶面内容 */
  if (st.order) {
    var rr = recipeById(st.order.rid) || { emoji: '🥤' };
    var n = num(st.order.cups, 1);
    text(ctx, n > 1 ? rr.emoji + '×' + n : rr.emoji,
      cx, topY - b * 0.2, { size: compact ? FS.md : FS.lg, align: 'center' });
  } else {
    var nm = st.isBoss ? '👑' : (st.worker ? st.worker.emoji : '·');
    text(ctx, nm, cx, topY - b * 0.2,
      { size: compact ? FS.md : FS.lg, align: 'center' });
  }

  /* ⑤ 进度条贴在正面偏下，像台面上的出杯进度 */
  if (st.order) {
    var pw = a * 1.5, ph = 4;
    GFX.bar(ctx, cx - pw / 2, cy - boxH * lift * 0.32, pw, ph,
      num(st.order.progress), { color: T2.cyan });
  }

  /* ⑥ 员工名（紧凑模式省略——挤不下）*/
  if (!compact && st.worker) {
    text(ctx, st.worker.name, cx, cy + b + 3,
      { size: FS.xs, align: 'center', color: T2.txt3, maxW: w });
  }

  /* ⑦ 命中区：立方体外接矩形 + 2px 余量 */
  var hitTop = topY - b - 2;
  return { x: cx - p - 2, y: hitTop, w: p * 2 + 4, h: (cy + b) - hitTop + 2 };
}

/**
 * 画一个排队顾客（站在地面上的小人 + 脚下耐心条）。
 *
 * ★ 特殊顾客用**金框**而不是角标 —— 等距小图上角标会糊成一个点。
 */
function drawGuestIso(ctx, cx, cy, c, T2) {
  var r = recipeById(c.rid) || { emoji: '🥤' };
  var face = c.face || '🙂';
  var bob = Math.sin((c.wait || 0) * 3.2) * 1.5;   /* 轻微上下浮动：有等待感 */
  var col = c.special
    ? { body: 'rgba(255,194,71,.30)', edge: 'rgba(255,194,71,.85)', shadow: 0.32 }
    : { body: 'rgba(255,255,255,.16)', edge: T2.line, shadow: 0.26 };
  var hgt = 20 + bob;
  var topY = cy - hgt;
  /* 阴影画在 (cx,cy) 处：用反投影把它换算回世界坐标，
     这样阴影的横向压缩比例与地面一致（看起来是贴在斜面上）。 */
  isoShadow(ctx, (cx - ISO.ox) / (ISO.TW / 2), 0, 11, ISO.TH * 0.24, col.shadow);

  ctx.beginPath();
  ctx.moveTo(cx - 11, topY + ISO.TH * 0.2);
  ctx.lineTo(cx + 11, topY + ISO.TH * 0.2);
  ctx.lineTo(cx + 11, cy);
  ctx.lineTo(cx - 11, cy);
  ctx.closePath();
  ctx.fillStyle = col.body; ctx.fill();
  ctx.strokeStyle = col.edge; ctx.lineWidth = 1; ctx.stroke();

  text(ctx, face, cx, topY - 2, { size: FS.lg, align: 'center' });
  text(ctx, c.special ? r.emoji + ' ★' : r.emoji,
    cx, topY + 12,
    { size: c.special ? FS.xs : FS.sm, align: 'center', color: c.special ? T2.amber : 0 });
  var left = 1 - num(c.wait) / Math.max(0.001, num(c.patience));
  GFX.bar(ctx, cx - 10, cy + 2, 20, 3, left, { color: left < 0.3 ? T2.red : T2.green });
  return { cx: cx, cy: cy, top: topY };
}

function drawStage(ctx, L, s) {
  var W = L.W, top = L.bodyY, H = L.H - top;
  var sim = s.sim;
  /* ★ 舞台也限宽居中 ——
     等距队列是**按列数**排的（ISO.TW 固定），
     宽屏上如果铺满 992px，队列会偏到左边一大片空白。
     ★ 而限宽后队列正好在内容区中间，与 HUD / tab 对齐。 */
  var x = L.padX, w = L.innerW;
  var y = top + 10;

  /* 时间条 */
  GFX.bar(ctx, x, y + 10, w, 7, num(sim.t) / num(sim.duration), { color: T.cyan });
  var tb = sim.paused ? '⏸ 已暂停' : (sim.closing ? '🔔 打烊清场中…'
    : '营业中 ' + Math.max(0, Math.ceil(num(sim.duration) - num(sim.t))) + 's');
  text(ctx, tb, x + w / 2, y - 2, { size: fs(L, 'sm'), align: 'center', color: T.txt2 });
  y += 28;

  /* 四个实时数值 */
  var lw = (w - 18) / 4;
  var live = [
    { k: '已卖', v: String(Math.round(num(sim.cups))), c: T.txt },
    { k: '流失', v: String(Math.round(num(sim.lost))), c: T.red },
    { k: '营收', v: money(num(sim.revenue)), c: T.amber },
    { k: '连击', v: String(Date.now() / 1000 - num(sim.lastClickWall) < 1.1 ? num(sim.combo) : 0), c: T.pink },
  ];
  for (var i = 0; i < 4; i++) {
    GFX.fillRR(ctx, x + i * (lw + 6), y, lw, 38, 10, T.card, T.line);
    text(ctx, live[i].k, x + i * (lw + 6) + lw / 2, y + 4,
      { size: fs(L, 'xs'), align: 'center', color: T.txt3 });
    text(ctx, live[i].v, x + i * (lw + 6) + lw / 2, y + 16,
      { size: fs(L, 'lg'), weight: 800, align: 'center', color: live[i].c, maxW: lw - 6 });
  }
  y += 48;

  /* 队列（V15 等距）
     ★ 队列沿**斜边**排（每往右上一格 = 队伍往后一位），
       这样「队伍往门口走」变成了可见的纵深，而不只是横向一排头像。
       · 斜向单位是 (ISO.TW/2, -ISO.TH/2) —— 与等距的主轴一致
       · 首排贴左下（离观众最近），后排往右上退
     ★ 人数上限沿用原来的「最多 3 排」策略：
       队伍一屏放不下不是问题，玩家要点的是工位而不是队列。 */
  var q = sim.queue || [];
  var QROWS = 3;
  /* 每排的斜向步长：横向 (TW/2)，纵向 -TH/2（即往右上退）*/
  var qStepX = ISO.TW * 0.5;
  var qStepY = -ISO.TH * 0.5;
  var per = Math.max(3, Math.floor(w / Math.max(8, qStepX)) + 1);
  var qShow = Math.min(q.length, per * QROWS);
  text(ctx, '🚶 排队中 ' + q.length + '/' + queueCap(s)
    + (q.length > qShow ? '（下方显示前 ' + qShow + '位）' : ''),
    x, y, { size: FS.sm, color: T.txt3 });
  y += 16;

  /* 画一条「队伍斜带」作为地面引导线 —— 没有它顾客像浮在半空 */
  if (qShow) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    var gx0 = x + 14, gy0 = y + 44;
    ctx.moveTo(gx0, gy0);
    ctx.lineTo(gx0 + (per - 1) * qStepX, gy0 + (per - 1) * qStepY);
    ctx.stroke();
    ctx.restore();
  }

  /* ★ 深度排序：按 (排, 列) 的斜向深度排。
     靠后排（col 小）先画，靠前排（col 大）后画 → 形成正确遮挡。 */
  isoSortReset(ISO_STAGE_SORT);
  for (var qi = 0; qi < qShow; qi++) {
    /* 深度 = 排*per + 列（越大越靠前）*/
    isoSortPush(ISO_STAGE_SORT, qi, qi);
  }
  for (var qk = 0; qk < isoSortLen(ISO_STAGE_SORT); qk++) {
    var qIdx = isoSortAt(ISO_STAGE_SORT, qk).p;
    var cq = q[qIdx];
    var col2 = qIdx % per, row2 = Math.floor(qIdx / per);
    var qx = x + 14 + col2 * qStepX;
    var qy = y + 44 + row2 * 38 + col2 * qStepY;
    drawGuestIso(ctx, qx, qy, cq, T);
  }
  y += 60 + (Math.ceil(qShow / per) - 1) * 38 + (qShow ? 4 : 0);

  /* 出杯位 —— 核心交互区
     旧写法是写死 2 列 + `if (sy + sh > L.H - 96) break;`：
     出杯位 = 老板 + 员工 + 分店，招满人开满分店能到十几个，
     超屏的那部分既不绘制也不登记命中区 —— 玩家看得见订单、却点不到工位，
     加速不了只能眼看客人流失，属于「不修就不能玩」的级别。
     改法：先按可用高度挑一套装得下的网格（优先加列、保留大点击块，
     实在不够再压卡片高度），仍然溢出就让这一区可上下滑动。 */
  var stn = sim.stations || [];
  var btnTop = L.H - 92 - L.padBottom;
  var viewTop = y + 14;
  var viewH = Math.max(72, btnTop - 10 - viewTop);
  var grid = pickStationGrid(stn.length, w, viewH);
  var cols = grid.cols, sh = grid.sh;
  var sw = (w - (cols - 1) * 10) / cols;
  var compact = sh < 68;
  var rows = Math.ceil(stn.length / cols);

  /* ★ V15：等距参数**先定好**，因为滚动量要按实际占高算。
     · TW 由可用宽度决定（格子太宽会横向溢出）
     · 纵向占高按「最后一行 gx+gy 的投影」算 —— 等距下每行往右下斜，
       最后一行的 y 比矩形公式算出来的大。
     ★ 不按实际占高算的后果：**最后一个工位落在可滚动范围之外**，
       玩家看得见却点不到 —— 那正是「不修就不能玩」的级别
       （smoke 的「全部工位可达」断言直接抓到，少 1 个）。 */
  isoSetScale(Math.max(44, Math.min(76, (w / Math.max(2, cols)) - 6)));

  /* ★★★ 等距布局的**横向跨度**是个坑：
     屏幕上 x ∝ (gx - gy)，而 gx∈[0,cols)、gy∈[0,rows)，
     所以 x 的跨度是 (gx_max - gy_min) 与 (gx_min - gy_max) 两端之差
     ≈ (cols + rows) × (TW/2)，**远大于 cols × (TW/2)**。
     9 工位 / 4 列时跨度 ≈ (3+2)×TW/2 = 2.5×TW，而视口只有 cols×(TW/2)=2×TW
     —— 左右各溢出 0.5×TW。
     ★ 而 clipPush 只裁剪**垂直**方向，横向不裁 →
       横向溢出的工位既画出去又被裁掉，玩家看不全也点不到。
     ★ 修法：按**实际跨度**反推 TW，而不是按「每列多宽」定 TW。 */
  var spanG = Math.max(1, Math.max(cols - 1, rows - 1)) + Math.min(cols, stn.length);
  /*★ TW 反推：横向总跨度 = spanG × (TW/2)，要正好等于可用宽度。
     · 跨度系数 spanG 用「gx 与 gy 的极差」而不是 cols+rows ——
       估大了会让 TW 偏小、工位挤成一小团（实测 320 屏 20 工位时
       只用掉 53% 宽度，白白浪费）。
     · 再乘 1.06 的余量：菱形之间留一点缝，不然看起来是连成一片的墙。 */
  var needTW = (w - 12) / Math.max(1, spanG / 2) * 1.06;
  /* ★ 下限 44 而不是更小：
     实测 320×568 + 20 工位时 needTW 约 55，取下限后工位 44px 宽，
     emoji 与进度条都还看得清。
     ★ 取下限的代价是**横向略溢出**，靠上面居中原点吸收；
       纵向多出的高度正好变成 stageScroll 的可滚范围。 */
  isoSetScale(Math.max(44, Math.min(76, needTW)));

  /* ★ 占高要按**真实最大深度**算，不能用「最后一行」的深度。
     矩形的旧假设「最后一个 = 最靠下」在等距下**不成立**：
     9 个工位排 4 列时，si=7 (gx=3,gy=1) 深度 4，
     而最后的 si=8 (gx=0,gy=2) 深度只有 2——
     最靠下的那个是**中间**那个，不是最后一个。
     ★ 算错的后果：占高偏小 → 最后一个工位落在可滚动范围外 →
       玩家看得见却点不到（smoke 的「全部工位可达」断言直接抓到，少 1 个）。 */
  var isoMaxDepth = 0;
  for (var q0 = 0; q0 < stn.length; q0++) {
    var d0 = (q0 % cols) + Math.floor(q0 / cols);
    if (d0 > isoMaxDepth) isoMaxDepth = d0;
  }
  var isoContentH = isoMaxDepth * (ISO.TH / 2) + ISO.TH * 2.4 + sh * 0.5;
  var contentH = Math.max(sh, isoContentH);

  VIEW.stageMax = Math.max(0, contentH - viewH);
  if (!(VIEW.stageScroll > 0)) VIEW.stageScroll = 0;
  if (VIEW.stageScroll > VIEW.stageMax) VIEW.stageScroll = VIEW.stageMax;
  var sc = VIEW.stageScroll;

  text(ctx, '🧋 出杯位 ' + stn.length + ' 个'
    + (VIEW.stageMax > 0 ? '　↕ 可上下滑动' : ''),
    x, y, { size: FS.sm, color: VIEW.stageMax > 0 ? T.cyan : T.txt3 });

GFX.clipPush(ctx, x - 2, viewTop, w + 4, viewH);
  /* ★ V15：工位改为**等距立方体**，并按 (gx+gy) 做深度排序。
     *
     * 坐标：工位从「矩形网格」搬到「菱形地面」上。
     *   列 col → gx = col，  行 row → gy = row
     *   屏幕位置由 isoProject 算出：sx ∝ (gx-gy)，sy ∝ (gx+gy)
     *   → 屏幕位置由 isoProject 算出：sx ∝ (gx-gy)，sy ∝ (gx+gy)
     *   → 同一"行"在屏幕上往右下斜，天然形成 2.5D 的"纵深列"。
     *
     * ★ 深度：直接用 gx+gy。等距里屏幕 y 大的就是更靠前的，
     *   而 y ∝ (gx+gy)，所以按它排即可，不需要额外算。
     *
     * ★ 滚动：stageScroll 沿用原逻辑（纵向滑动看更多工位），
     *   斜角下仍然成立 —— 因为整块地面就是一个 (gx+gy) 的偏移。
     */
  isoSetScale(Math.max(44, Math.min(76, (w / Math.max(2, cols)) - 6)));
  /* ★★ 原点必须按**实际的 x 极值**定位，而不是「网格左上角」。
     x ∝ (gx-gy)，而 gx∈[0,cols)、gy∈[0,rows)：
       · 最左的格子是 (gx=0, gy=rows-1) → 屏幕 x 偏移 = -(rows-1)×TW/2
       · 最右的格子是 (gx=cols-1, gy=0) → 偏移 = +(cols-1)×TW/2
     ★ 所以要把 [-left, +right] 这一段**居中到视口**，
       ISO.ox 就是「这段的中点」在屏幕上的位置：
         ISO.ox = 视口左 + TW/2 - minOffset + 总跨度/2
       ★ 踩过的坑：先按「网格左上角」估 ox，再减一个 span/2，
         结果整块地面被推到右边 —— 实测 320 屏 20 工位时最右工位
         超出视口 62px，那个工位既画出去又被 clipPush 裁掉，
         玩家看不见也点不到（smoke 的「全部可达」断言直接抓到少 1 个）。 */
  var isoOffMin = 0;               /* (gx=0, gy=rows-1) 的偏移 */
  var isoOffMax = (cols - 1) * (ISO.TW / 2);
  if (rows > 1) isoOffMin = -(rows - 1) * (ISO.TW / 2);
  var isoOffMid = (isoOffMin + isoOffMax) / 2;
  ISO.ox = x + (ISO.TW / 2) - isoOffMin + isoOffMid;
  ISO.oy = viewTop + ISO.TH * 1.6 - sc;

  /* ① 地面网格：先铺一层淡淡的菱形，玩家才知道"下面有地板" */
  for (var gg = 0; gg < stn.length; gg++) {
    var tcx = ISO.ox + (gg % cols) * (ISO.TW / 2);
    var tcy = ISO.oy + Math.floor(gg / cols) * (ISO.TH / 2);
    /* ★ 菱形「地板」：颜色极淡，只提供空间暗示，不抢主体 */
    ctx.beginPath();
    ctx.moveTo(tcx, tcy - ISO.TH / 2);
    ctx.lineTo(tcx + ISO.TW / 2, tcy);
    ctx.lineTo(tcx, tcy + ISO.TH / 2);
    ctx.lineTo(tcx - ISO.TW / 2, tcy);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,.035)';
    ctx.fill();
  }

  /* ② 深度排序后绘制（插入排序，复用数组，稳态零分配）*/
  isoSortReset(ISO_STAGE_SORT);
  for (var si0 = 0; si0 < stn.length; si0++) {
    var gx0 = si0 % cols, gy0 = Math.floor(si0 / cols);
    isoSortPush(ISO_STAGE_SORT, gx0 + gy0, si0);
  }
  for (var sk = 0; sk < isoSortLen(ISO_STAGE_SORT); sk++) {
    var si = isoSortAt(ISO_STAGE_SORT, sk).p;
    var st = stn[si];
    var gx = si % cols, gy = Math.floor(si / cols);
    var scx = ISO.ox + (gx - gy) * (ISO.TW / 2);
    var scy = ISO.oy + (gx + gy) * (ISO.TH / 2);
    /* ★ V14.2 的点击脉冲（0~1）*/
    var pulse = 0;
    if (VIEW.hitAt && VIEW.hitAt[si] > 0) pulse = VIEW.hitAt[si] / 0.16;

    var bw2 = ISO.TW * 0.82;
    var bh2 = compact ? ISO.TH * 1.5 : ISO.TH * 2.2;
    var hitBox = drawStationIso(ctx, scx, scy, st, bw2, bh2, pulse, compact, T);
    /* ★ 命中区：画在哪点哪（含顶面与底面）。
       ★ addHit 在裁剪区外会自动放弃登记，所以超出视口的不用自己判。 */
    GFX.addHit(hitBox.x, hitBox.y, hitBox.w, hitBox.h, 'rush', String(si), null);
  }
  GFX.clipPop(ctx);
  /* 右侧一条细滚动条，让玩家知道下面还有工位 */
  if (VIEW.stageMax > 0) {
    var trh = viewH * (viewH / contentH);
    var try0 = viewTop + (viewH - trh) * (sc / VIEW.stageMax);
    /* ★ 滚动条要画在**视口右缘之内**，不能画在内容区右缘 + 2 ——
       ★ 窄屏时 x+w = W-16，+2 刚好在屏内；
         ★ 而宽屏限宽后 x+w 是内容区右缘（离视口右缘还有几百像素），
           +2 会跑到内容区外面（诊断实测：390 宽时右边 394 > 390）。
       ★ 正确做法：**贴视口右缘**，但用 safe-area 避让手势条。 */
    var sbX = W - 5 - L.padBottom * 0;   /* 贴右缘，宽 3px */
    /* ★ 但如果内容区右缘离视口右缘很近（窄屏），就贴着内容区画 ——
       否则滚动条会压在卡片上。 */
    if (W - (x + w) < 12) sbX = x + w - 5;
    GFX.fillRR(ctx, sbX, try0, 3, Math.max(18, trh), 2, 'rgba(53,229,240,.45)');
  }
  y = viewTop + viewH;

  /* 操作按钮 */
  var by = L.H - 136 - L.padBottom;
  var bw = (w - 12) / 2;
  GFX.button(ctx, x, by, bw, 42,
    num(sim.rushCd) > 0 ? '⚡ 大招 (' + Math.ceil(num(sim.rushCd)) + 's)' : '⚡ 老板上阵',
    { kind: 'rush', act: 'boss', disabled: num(sim.rushCd) > 0, size: FS.md });
  GFX.button(ctx, x + bw + 12, by, bw, 42, sim.paused ? '▶ 继续' : '⏸ 暂停',
    { kind: 'ghost', act: 'pause', size: FS.md });
  GFX.button(ctx, x, by + 48, bw, 38, '🚚 紧急进货', { kind: 'ghost', act: 'restock', size: FS.md });
  GFX.button(ctx, x + bw + 12, by + 48, bw, 38, '🔔 提前打烊', { kind: 'ghost', act: 'closeearly', size: FS.md });
  /* 营业中两个即时决策（V2）：每天各一次。用 kind:'ghost' + 文案区分 ——
     Canvas 版没有 H5 那种独立一行的样式，做不到"视觉上不是常规操作"，
     至少保证用掉之后就明确写成「已用 / 已下架」，不会让人反复点。 */
  var ops = openOps(s);
  var saleOn = ops && ops.sale.active;
  var saleLabel = !ops ? '📣 限时促销'
    : (saleOn ? '📣 促销中 ' + ops.sale.left + 's'
      : (ops.sale.used ? '📣 促销已用' : '📣 限时促销'));
  var pullLabel = !ops ? '📥 临时下架' : (ops.pull.used ? '📥 已下架' : '📥 临时下架');
  GFX.button(ctx, x, by + 92, bw, 38, saleLabel,
    { kind: saleOn ? 'cyan' : 'ghost', act: 'sale', size: FS.md, disabled: !!(ops && ops.sale.used) });
  GFX.button(ctx, x + bw + 12, by + 92, bw, 38, pullLabel,
    { kind: 'ghost', act: 'pullmenu', size: FS.md, disabled: !!(ops && ops.pull.used) });
}

/* ============================================================
 *  弹窗
 * ========================================================== */
function drawModal(ctx, L) {
  if (!VIEW.modal) { VIEW.modalMax = 0; return; }
  var W = L.W, H = L.H;
  var m = VIEW.modal;
  var fn = MODALS[m.type];
  if (!fn) return;
  /* 每次打开（VIEW.modal 被赋了新对象）都从头显示；
     用对象身份比较而不是 type —— 关掉再开同一类型也要复位 */
  if (VIEW._modalObj !== m) { VIEW._modalObj = m; VIEW.modalScroll = 0; }
  var box = GFX.sheet(ctx, W, H, 60, H - 40);
  GFX.clipPush(ctx, box.x, box.y, box.w, box.h);
  /* 弹窗滚动：玩法说明 8 节在 375×667 上高约 660~700px，弹窗只有 567px，
     以前 onMove 在弹窗打开时直接 return，底部章节和音效开关被裁掉且
     **没有任何方式能看到** —— 而音效开关在小游戏版只此一处。
     绘制用 translate 上移；命中区用 setHitOffset 同步（见 gfx.js）。 */
  ctx.save();
  ctx.translate(0, -Math.max(0, VIEW.modalScroll || 0));
  GFX.setHitOffset(-Math.max(0, VIEW.modalScroll || 0));
  var yEnd = fn(ctx, box, m);
  GFX.setHitOffset(0);
  ctx.restore();
  /* 绘制器返回内容底边 y 时才有滚动；不返回（大多数弹窗）视为不超高 */
  VIEW.modalMax = (typeof yEnd === 'number')
    ? Math.max(0, yEnd - (box.y + box.h) + 12) : 0;
  if ((VIEW.modalScroll || 0) > VIEW.modalMax) VIEW.modalScroll = VIEW.modalMax;
  GFX.clipPop(ctx);
  /* 超高时给一条提示，玩家才知道能滑 */
  if (VIEW.modalMax > 0) {
    text(ctx, '↕ 上下滑动查看更多', box.x + box.w / 2, box.y + box.h - 12,
      { size: FS.xs, align: 'center', color: T.txt3 });
  }
  /* 事件弹窗不给 ×：step() 每帧都会重建它，给了 × 就是「关掉→下一帧又弹出来」，
     看起来像按钮失灵。H5 的 showEvent() 同样锁死，必须选一个选项。 */
  if (m.type !== 'event' && m.type !== 'report') {
    GFX.cardBtn(ctx, box.x + box.w - 34, box.y + 14, 20, 20, [{ t: '×', size: FS.xl }],
      { act: 'close', r: 10, hitPad: 5 });
  }
}

var MODALS = {};

/* 结算「较昨日」环比。
   没有 prev 或差得可以忽略时返回 null，调用方据此决定画不画。
   inverse = 该指标越小越好（流失），涨跌配色要反过来看。 */
function deltaStr(cur, prev, opt) {
  if (prev == null || !isFinite(num(prev, NaN))) return null;
  var d = num(cur, 0) - num(prev, 0);
  var eps = (opt && opt.eps != null) ? opt.eps : 0.5;
  if (Math.abs(d) < eps) return { t: '持平', c: T.txt3 };
  var up = d > 0;
  var good = (opt && opt.inverse) ? !up : up;
  var a = Math.abs(d);
  var v = a >= 1000 ? Math.round(a) : (a % 1 ? a.toFixed(1) : a);
  return { t: (up ? '▲' : '▼') + ((opt && opt.unit) || '') + v, c: good ? T.green : T.red };
}
/* 一行里每段自带涨跌配色，Canvas 没有富文本，只能自己排 */
function drawDeltas(ctx, x, y, label, items) {
  var cx = x;
  text(ctx, label, cx, y + 1, { size: FS.xs, color: T.txt3 });
  cx += GFX.textW(ctx, label, 10, 400) + 6;
  for (var i = 0; i < items.length; i++) {
    if (i) { text(ctx, '·', cx, y + 1, { size: FS.xs, color: T.txt3 }); cx += 9; }
    text(ctx, items[i].label, cx, y + 1, { size: FS.xs, color: T.txt3 });
    cx += GFX.textW(ctx, items[i].label, 10, 400) + 2;
    text(ctx, items[i].d.t, cx, y, { size: FS.sm, weight: 800, color: items[i].d.c });
    cx += GFX.textW(ctx, items[i].d.t, 11, 800) + 7;
  }
}

/* 经营报表 */
/* ============================================================
 *  Canvas 端输入（V12）
 *
 *  抖音小游戏端没有输入框，所以：
 *  · 金额 → 自绘数字键盘（0-9 / 退格 / 确认 / 取消）
 *  · 文本 → 候选循环（店名从池子里轮）
 * ============================================================ */

/** 打开数字键盘弹窗。返回 {type:'numpad', ...} */
function openNumpad(opts) {
  VIEW.modal = {
    type: 'numpad',
    title: opts.title || '输入金额',
    hint: opts.hint || '',
    max: opts.max == null ? Infinity : opts.max,
    min: opts.min == null ? 1 : opts.min,
    digits: '',
    act: opts.act,          /* 确认时回调：amount */
    branch: opts.branch,
  };
}

/** 数字键盘弹窗绘制 */
MODALS.numpad = function (ctx, b, m) {
  var y = b.y + 26;
  text(ctx, m.title, b.x + 16, y, { size: FS.lg, weight: 800, color: T.txt });
  y += 24;
  if (m.hint) {
    text(ctx, m.hint, b.x + 16, y, { size: FS.xs, color: T.txt3, maxW: b.w - 32 });
    y += 16;
  }
  /* 输入框 */
  GFX.card(ctx, b.x + 16, y, b.w - 32, 40);
  var shown = m.digits === '' ? '0' : m.digits;
  text(ctx, '¥' + shown, b.x + 28, y + 10, { size: FS.xl, weight: 800, color: T.amber });
  if (m.digits === '') {
    text(ctx, '请输入', b.x + b.w - 28, y + 14, { size: FS.xs, align: 'right', color: T.txt3 });
  }
  y += 52;

  /* 键盘：3 列 × 4 行（1-9 / 退格 0 确认） */
  var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
  var kw = (b.w - 32 - 16) / 3, kh = 40;
  for (var i = 0; i < keys.length; i++) {
    var col = i % 3, row = (i / 3) | 0;
    var kx = b.x + 16 + col * (kw + 8), ky = y + row * (kh + 8);
    var k = keys[i];
    var label = k === 'del' ? '⌫' : (k === 'ok' ? '确定' : k);
    GFX.cardBtn(ctx, kx, ky, kw, kh, [{ t: label, size: k === 'ok' ? FS.md : FS.lg }],
      { act: k === 'ok' ? 'numpad-ok' : (k === 'del' ? 'numpad-del' : 'numpad-key'),
        id: k, r: 10, hitPad: 3 });
  }
  y += 4 * (kh + 8) + 4;
  /* 快捷金额 */
  var qw = (b.w - 32 - 16) / 4;
  var quick = [500, 1000, 2000, 5000];
  for (var q = 0; q < quick.length; q++) {
    GFX.cardBtn(ctx, b.x + 16 + q * (qw + 8), y, qw, 28, [{ t: '' + quick[q], size: FS.sm }],
      { act: 'numpad-quick', id: String(quick[q]), r: 9 });
  }
  y += 36;
  GFX.cardBtn(ctx, b.x + 16, y, b.w - 32, 30, [{ t: '取消', size: FS.md }],
    { act: 'close', r: 10 });
  return y + 40;
};

/** 打开改名弹窗（候选循环） */
function openRenameModal(opts) {
  VIEW.modal = {
    type: 'rename',
    title: opts.title || '修改名称',
    branch: opts.branch,
    pool: opts.pool || [],
    idx: 0,
  };
}

MODALS.rename = function (ctx, b, m) {
  var y = b.y + 26;
  text(ctx, m.title, b.x + 16, y, { size: FS.lg, weight: 800, color: T.txt });
  y += 30;
  var cur = m.pool[m.idx] || '';
  GFX.card(ctx, b.x + 16, y, b.w - 32, 44);
  text(ctx, cur, b.x + b.w / 2, y + 12, { size: FS.xl, weight: 800, align: 'center', color: T.txt });
  y += 54;
  text(ctx, '◀ 点下方按钮切换候选 ▶', b.x + b.w / 2, y,
    { size: FS.xs, align: 'center', color: T.txt3 });
  y += 24;
  var bw = (b.w - 32 - 8) / 2;
  GFX.cardBtn(ctx, b.x + 16, y, bw, 34, [{ t: '◀ 上一个', size: FS.md }],
    { act: 'rename-prev', r: 10 });
  GFX.cardBtn(ctx, b.x + 16 + bw + 8, y, bw, 34, [{ t: '下一个 ▶', size: FS.md }],
    { act: 'rename-next', r: 10 });
  y += 44;
  GFX.cardBtn(ctx, b.x + 16, y, b.w - 32, 34, [{ t: '确定', size: FS.md }],
    { act: 'rename-ok', r: 10 });
  y += 40;
  GFX.cardBtn(ctx, b.x + 16, y, b.w - 32, 28, [{ t: '取消', size: FS.sm }],
    { act: 'close', r: 9 });
  return y + 38;
};

/** 通用确认弹窗（Canvas 没有 confirm()） */
MODALS.confirm = function (ctx, b, m) {
  var y = b.y + 30;
  text(ctx, m.title, b.x + 16, y, { size: FS.lg, weight: 800, color: T.txt, maxW: b.w - 32 });
  y += 26;
  for (var i = 0; i < (m.lines || []).length; i++) {
    text(ctx, '· ' + m.lines[i], b.x + 16, y, { size: FS.sm, color: T.txt2, maxW: b.w - 32 });
    y += 18;
  }
  y += 10;
  var bw = (b.w - 32 - 8) / 2;
  GFX.cardBtn(ctx, b.x + 16, y, bw, 32, [{ t: '取消', size: FS.md }],
    { act: 'close', r: 10 });
  GFX.cardBtn(ctx, b.x + 16 + bw + 8, y, bw, 32, [{ t: '确定', size: FS.md }],
    { act: m.act || 'confirm-ok', r: 10 });
  return y + 42;
};

/** 城市详情弹窗（V13·Canvas 端） */
MODALS.cityinfo = function (ctx, b, m) {
  var y = b.y + 28;
  text(ctx, m.title, b.x + 16, y, { size: FS.lg, weight: 800, color: T.txt, maxW: b.w - 32 });
  y += 22;
  if (m.sub) {
    text(ctx, m.sub, b.x + 16, y, { size: FS.xs, color: T.txt3, maxW: b.w - 32 });
    y += 18;
  }
  for (var i = 0; i < (m.lines || []).length; i++) {
    text(ctx, m.lines[i], b.x + 16, y, { size: FS.sm, color: T.txt2, maxW: b.w - 32 });
    y += 20;
  }
  y += 12;
  var bw = (b.w - 32 - 8) / 2;
  GFX.cardBtn(ctx, b.x + 16, y, bw, 32, [{ t: '关闭', size: FS.md }],
    { act: 'close', r: 10 });
  GFX.cardBtn(ctx, b.x + 16 + bw + 8, y, bw, 32,
    [{ t: m.isCur ? '当前城市' : '设为经营城市', size: FS.md }],
    { act: m.isCur ? 'close' : 'cityinfo-ok', r: 10, disabled: m.isCur });
  return y + 42;
};

/** 城市列表弹窗（V13·Canvas 端）：循环切换有坐标的城市 */
MODALS.citylist = function (ctx, b, m) {
  var y = b.y + 28;
  text(ctx, '🗺️ 切换经营城市', b.x + 16, y, { size: FS.lg, weight: 800, color: T.txt });
  y += 24;
  var mvv = cityMapView(__MINIGAME.S);
  var pt = mvv.points[m.idx] || null;
  GFX.card(ctx, b.x + 16, y, b.w - 32, 44);
  text(ctx, pt ? pt.name : '（无）', b.x + b.w / 2, y + 12,
    { size: FS.xl, weight: 800, align: 'center', color: T.txt, maxW: b.w - 40 });
  text(ctx, pt ? pt.provName + ' · ' + pt.lng.toFixed(2) + 'E ' + pt.lat.toFixed(2) + 'N' : '',
    b.x + b.w / 2, y + 30, { size: FS.xs, align: 'center', color: T.txt3 });
  y += 54;
  var bw = (b.w - 32 - 8) / 2;
  GFX.cardBtn(ctx, b.x + 16, y, bw, 30, [{ t: '◀ 上一个', size: FS.sm }],
    { act: 'citylist-next', r: 9 });
  GFX.cardBtn(ctx, b.x + 16 + bw + 8, y, bw, 30, [{ t: '下一个 ▶', size: FS.sm }],
    { act: 'citylist-next', r: 9 });
  y += 38;
  GFX.cardBtn(ctx, b.x + 16, y, b.w - 32, 32, [{ t: '设为经营城市', size: FS.md }],
    { act: 'citylist-ok', r: 10 });
  y += 40;
  text(ctx, '仅列出有精确坐标的 ' + mvv.geoTotal + ' 个城市；完整 ' + mvv.cityTotal + ' 市见「经营信息」',
    b.x + b.w / 2, y, { size: FS.xs, align: 'center', color: T.txt3, maxW: b.w - 32 });
  return y + 20;
};

/** 城市地图弹窗（V13·Canvas 端）
 *  内容由 panelCityMap 画（与 rival 页的入口条共用同一份数据）。
 *  ★ 弹窗可以滚动（drawModal 支持），所以 300px 的地图放得下。
 */
MODALS.map = function (ctx, b, m) {
  var y = b.y + 20;
  text(ctx, '🗺️ 城市地图', b.x + 16, y, { size: FS.lg, weight: 800, color: T.txt });
  y += 26;
  y = panelCityMap(ctx, b.x + 16, y, b.w - 32, __MINIGAME.S);
  y += 6;
  GFX.cardBtn(ctx, b.x + 16, y, b.w - 32, 30, [{ t: '关闭', size: FS.md }],
    { act: 'close', r: 10 });
  return y + 40;
};

MODALS.report = function (ctx, b, m) {
  var s = S();
  var x = b.x + 14, w = b.w - 28;
  var y = b.y + 14;
  text(ctx, '📊 Day ' + m.day + ' 结算', x, y, { size: FS.lg, weight: 900 });
  y += 26;

  var rows = (s.history || []).slice(-14);
  GFX.lineChart(ctx, x, y, w, 116,
    [{ key: 'worth', color: T.cyan }, { key: 'revenue', color: T.amber }], rows);
  y += 124;

  var r = s.lastReport || {};
  var items = [
    { k: '营收', v: money(r.revenue || 0), c: T.amber },
    { k: '成本', v: money(r.cogs || 0), c: T.red },
    { k: '净利', v: money(r.net || 0), c: (r.net || 0) >= 0 ? T.green : T.red },
    { k: '卖出', v: Math.round(r.served || 0) + ' 杯', c: T.txt },
    { k: '流失', v: Math.round(r.lost || 0) + ' 人', c: (r.lost || 0) ? T.red : T.txt2 },
    { k: '口碑', v: Math.round(num(s.rep)) + '', c: T.txt },
  ];
  var cols = 3, cw = (w - 8 * 2) / 3;
  for (var i = 0; i < items.length; i++) {
    var ix = x + (i % cols) * (cw + 8), iy = y + Math.floor(i / cols) * 44;
    GFX.fillRR(ctx, ix, iy, cw, 38, 10, T.card, T.line);
    text(ctx, items[i].k, ix + 8, iy + 5, { size: FS.xs, color: T.txt3 });
    text(ctx, items[i].v, ix + 8, iy + 19, { size: FS.md, weight: 800, color: items[i].c, maxW: cw - 16 });
  }
  y += Math.ceil(items.length / cols) * 44 + 8;

  /* 环比：只给绝对数字，玩家看不出今天是变好还是变差 */
  var pr = s.prevReport;
  if (pr && num(pr.day) !== num(r.day)) {
    var ds = [];
    var mk = function (label, cur, pv, opt) {
      var dt = deltaStr(cur, pv, opt);
      if (dt) ds.push({ label: label, d: dt });
    };
    mk('营收', r.revenue, pr.revenue, { unit: '¥' });
    mk('杯数', r.served, pr.served);
    mk('流失', r.lost, pr.lost, { inverse: true });
    mk('净利', r.net, pr.net, { unit: '¥' });
    if (ds.length) { drawDeltas(ctx, x, y, '📊 较 Day ' + num(pr.day), ds); y += 19; }
  }
  /* 每日高光（V3）+ 合同结算（V1）：日报不再只是一堆数字。
     高光逐行画、合同一行结论 —— 同一段内容 H5 用 .rep-hl / .rep-ct。 */
  var cr2 = r.contractResult;
  if (cr2) {
    text(ctx, (cr2.ok ? '📜 合同达成：' : '📜 合同未达成：') + cr2.emoji + ' ' + cr2.name
      + ' · ' + (cr2.ok ? '+' + money(cr2.cash) : '口碑 ' + num(cr2.rep)),
      x, y, { size: FS.sm, weight: 700, color: cr2.ok ? T.green : T.red, maxW: w });
    y += 17;
  }
  /* V5 章节关卡的结算行：与 H5 的 .rep-ct 同一段内容、同一口径 */
  var sr2 = r.stageResult;
  if (sr2) {
    text(ctx, (sr2.ok ? '🏔️ 关卡达成：' : '🏔️ 关卡未达成：') + sr2.emoji + ' ' + sr2.name
      + ' · ' + sr2.diffEmoji + sr2.diffName + ' · '
      + (sr2.ok ? '+' + money(sr2.cash) : '目标 ' + sr2.desc),
      x, y, { size: FS.sm, weight: 700, color: sr2.ok ? T.green : T.red, maxW: w });
    y += 17;
  }
  var hl = r.highlights || [];
  for (var hi = 0; hi < hl.length; hi++) {
    y += para(ctx, hl[hi].text, x, y, { size: FS.sm, color: T.amber, maxW: w, lineH: 15 });
  }
  if (hl.length) y += 4;

  /* 营销是当日一次性投入，打烊即归零 —— 不说清楚玩家会以为钱白花了 */
  if (num(r.marketing) > 0) {
    text(ctx, '📢 营销 ' + money(r.marketing) + ' 当天有效，明日需重新设置',
      x, y, { size: FS.sm, color: T.amber, maxW: w });
    y += 16;
  }
  if (s.endless && num(r.pressure) > 1) {
    text(ctx, '⚡ 无尽第 ' + num(s.milestone) + ' 阶：工资与租金 ×' + num(r.pressure).toFixed(2),
      x, y, { size: FS.sm, color: T.red, maxW: w });
    y += 16;
  }

  var advs2 = adviceOf(s) || [];
  if (advs2.length) {
    GFX.fillRR(ctx, x, y, w, 34, 10, 'rgba(255,194,71,.10)', 'rgba(255,194,71,.3)');
    text(ctx, '📌 ' + GFX.plainText((advs2[0].icon || '') + ' ' + (advs2[0].text || '')), x + 10, y + 11,
      { size: FS.sm, color: T.amber, maxW: w - 20 });
    y += 44;
  }
  /* 按钮写的是「即将进入的那一天」。写 s.day 会让玩家以为这一天还没过去。 */
  GFX.button(ctx, x, y, w, 40, '🌅 进入 Day ' + (num(s.day) + 1), { kind: 'primary', act: 'nextday', size: FS.lg });
};

/* 经营报表（备货阶段从 HUD 的 📈 进入）。
   必须和 MODALS.report 分开：report 底部固定有一个「进入 Day N」按钮，
   复用它会让「备货时看一眼曲线」直接 nextDay() 跳过整天 —— 不结算房租工资、
   不产生营收，反复点还能一路刷到 Day 31 触发收官。 */
MODALS.chart = function (ctx, b, m) {
  var s = S();
  var x = b.x + 14, w = b.w - 28;
  var y = b.y + 14;
  text(ctx, '📈 经营报表', x, y, { size: FS.lg, weight: 900 });
  text(ctx, 'Day ' + num(s.day) + ' · 净资产 ' + money(netWorth(s)), x + w, y + 2,
    { size: FS.sm, align: 'right', color: T.txt3 });
  y += 28;

  var rows = (s.history || []).slice(-14);
  if (rows.length < 2) {
    text(ctx, '还没有足够的数据 —— 打烊两天后这里就会出现曲线。', x, y + 16,
      { size: FS.md, color: T.txt3, maxW: w });
    return;
  }
  GFX.lineChart(ctx, x, y, w, 132,
    [{ key: 'worth', color: T.cyan }, { key: 'revenue', color: T.amber },
     { key: 'net', color: T.green }], rows);
  y += 140;

  var last = rows[rows.length - 1] || {};
  var items = [
    { k: '当日营收', v: money(last.revenue || 0), c: T.amber },
    { k: '当日净利', v: money(last.net || 0), c: (last.net || 0) >= 0 ? T.green : T.red },
    { k: '卖出', v: Math.round(last.cups || 0) + ' 杯', c: T.txt },
    { k: '流失', v: Math.round(last.lost || 0) + ' 人', c: (last.lost || 0) ? T.red : T.txt2 },
    { k: '口碑', v: Math.round(num(last.rep, 0)) + '', c: T.txt },
    { k: '净资产', v: money(last.worth || 0), c: T.cyan },
  ];
  var cols = 3, cw = (w - 16) / cols;
  for (var i = 0; i < items.length; i++) {
    var ix = x + (i % cols) * (cw + 8), iy = y + Math.floor(i / cols) * 44;
    GFX.fillRR(ctx, ix, iy, cw, 38, 10, T.card, T.line);
    text(ctx, items[i].k, ix + 8, iy + 5, { size: FS.xs, color: T.txt3 });
    text(ctx, items[i].v, ix + 8, iy + 19, { size: FS.md, weight: 800, color: items[i].c, maxW: cw - 16 });
  }
};

/* 随机事件 */
MODALS.event = function (ctx, b, m) {
  var s = S();
  var ev = s.pendingEvent;
  if (!ev) return;
  var x = b.x + 14, w = b.w - 28;
  var y = b.y + 14;
  text(ctx, (ev.emoji || '📌') + ' ' + (ev.title || '突发事件'), x, y, { size: FS.lg, weight: 900 });
  y += 26;
  y += para(ctx, ev.text || '', x, y, { size: FS.md, color: T.txt2, maxW: w, lineH: 18 }) + 10;
  for (var i = 0; i < (ev.options || []).length; i++) {
    var o = ev.options[i];
    GFX.button(ctx, x, y, w, 42, o.label,
      { kind: i === 0 ? 'primary' : 'ghost', act: 'eventopt', id: String(i), size: FS.md });
    y += 50;
  }
};

/* 打烊三选一：与事件弹窗同构 —— 上面标题说明，下面每张卡一行「收益 / 代价」，最后是「都不要」 */
MODALS.card = function (ctx, b, m) {
  var s = S();
  var offer = Array.isArray(s.cardOffer) ? s.cardOffer : [];
  if (!offer.length) return;
  var x = b.x + 14, w = b.w - 28;
  var y = b.y + 14;
  text(ctx, '🃏 经营策略 · 三选一', x, y, { size: FS.lg, weight: 900 });
  y += 24;
  text(ctx, 'Day ' + num(s.day) + ' 打烊 · 选定后在本局内持续生效', x, y, { size: FS.sm, color: T.txt3, maxW: w });
  y += 26;
  for (var i = 0; i < offer.length; i++) {
    var c = offer[i];
    /* 高度按「收益 + 代价」两行算，用 para 换行会被裁掉一半 */
    GFX.fillRR(ctx, x, y, w, 58, 12, T.card2, T.line);
    text(ctx, c.emoji + ' ' + c.name, x + 11, y + 8, { size: FS.md, weight: 800, maxW: w - 90 });
    text(ctx, '↑ ' + c.gain, x + 11, y + 27, { size: FS.xs, color: T.green, maxW: w - 100 });
    text(ctx, '↓ ' + c.cost, x + 11, y + 41, { size: FS.xs, color: T.red, maxW: w - 100 });
    GFX.button(ctx, x + w - 66, y + 16, 56, 26, '选它',
      { kind: i === 0 ? 'primary' : 'ghost', act: 'pickcard', id: c.id, size: FS.sm, r: 8 });
    y += 66;
  }
  GFX.button(ctx, x, y, w, 36, '🚫 都不要（维持现状）', { kind: 'ghost', act: 'skipcard', size: FS.sm });
};

/* 每日挑战日榜（F3）
   平台原生榜单（tt.getImRankList）由平台自己画 UI，这里给的是两版共用的
   本地那一半：今日成绩 / 个人最佳 / 最近 7 天。
   平台那一路不可用时（未登录 / 非抖音端），面板照常显示，只是少一个按钮 ——
   「入口不消失」是 F3 降级的底线。 */
MODALS.dailyrank = function (ctx, b, m) {
  var meta = META() || {};
  var key = todayKey();
  var today = (meta.dailyDate === key) ? Math.max(0, Math.round(num(meta.dailyBest, 0))) : 0;
  var ever = Math.max(0, Math.round(num(meta.dailyBestEver, 0)));
  var recent = dailyRecent(meta, 7);

  var x = b.x + 14, w = b.w - 28;
  var y = b.y + 14;
  text(ctx, '🏆 每日挑战 · 同种子日榜', x, y, { size: FS.lg, weight: 900 });
  y += 24;
  y += para(ctx, '每天全网共用同一个种子：同一张价格表、同一批顾客、同一串事件。'
    + '比的只有经营决策。', x, y, { size: FS.sm, color: T.txt3, maxW: w, lineH: 15 }) + 10;

  var cw = (w - 10) / 2;
  GFX.fillRR(ctx, x, y, cw, 40, 10, T.card2, T.line);
  text(ctx, '今日最好', x + 9, y + 6, { size: FS.xs, color: T.txt3 });
  text(ctx, today ? money(today) : '未挑战', x + 9, y + 20, { size: FS.lg, weight: 800, color: T.amber });
  GFX.fillRR(ctx, x + cw + 10, y, cw, 40, 10, T.card2, T.line);
  text(ctx, '个人最佳', x + cw + 19, y + 6, { size: FS.xs, color: T.txt3 });
  text(ctx, ever ? money(ever) : '—', x + cw + 19, y + 20, { size: FS.lg, weight: 800, color: T.amber });
  y += 50;

  text(ctx, recent.length ? '📈 最近 ' + recent.length + ' 天' : '📈 最近战绩',
    x, y, { size: FS.sm, weight: 800, color: T.txt2 });
  y += 18;
  var bh = 56;
  GFX.fillRR(ctx, x, y, w, bh + 22, 10, 'rgba(0,0,0,.22)', T.line);
  if (!recent.length) {
    text(ctx, '还没有成绩 —— 打一局每日挑战，这里就会出现柱子。',
      x + 10, y + bh / 2, { size: FS.sm, color: T.txt3, maxW: w - 20 });
  } else {
    var peak = 1, i;
    for (i = 0; i < recent.length; i++) if (recent[i].best > peak) peak = recent[i].best;
    var slot = w / recent.length;
    for (i = 0; i < recent.length; i++) {
      var r = recent[i];
      var hgt = Math.max(4, Math.round(r.best / peak * bh));
      var bx = x + i * slot + slot * 0.18, bw2 = slot * 0.64;
      /* 个人最佳那一根换成琥珀色：一眼能看出自己哪天打得最好 */
      GFX.fillRR(ctx, bx, y + 8 + (bh - hgt), bw2, hgt, 3,
        (ever > 0 && r.best >= ever) ? 'rgba(255,194,71,.85)' : 'rgba(53,229,240,.78)');
      text(ctx, String(r.d).slice(5), x + i * slot + slot / 2, y + bh + 10,
        { size: FS.xs, align: 'center', color: T.txt3 });
    }
  }
  y += bh + 30;

  if (CAPS.rankListOn()) {
    GFX.button(ctx, x, y, w, 40, '🌐 查看全网日榜',
      { kind: 'amber', act: 'ranklist', size: FS.md, pressed: isPressed('ranklist') });
    y += 48;
  }
  /* 只有标题页才给「挑战今天这一局」：结局页上点它会把结算画面顶掉 */
  if (VIEW.screen === 'title') {
    GFX.button(ctx, x, y, w, 40, '🚀 挑战今天这一局',
      { kind: 'primary', act: 'daily', size: FS.md, pressed: isPressed('daily') });
  }
};

/* 玩法说明 */
MODALS.help = function (ctx, b, m) {
  var x = b.x + 14, w = b.w - 28;
  var y = b.y + 12;
  text(ctx, '📖 玩法说明', x, y, { size: FS.lg, weight: 900 });
  y += 24;
  var secs = [
    ['🎯 目标', '30 天内把净资产做到目标金额即通关；现金连续 2 天为负则破产。'],
    ['📅 每日挑战', '每天全网共用同一个种子：同一张价格表、同一批顾客、同一串事件，比的只有经营决策。\n一天可以打很多局，「🏆 日榜」记的是当天最好的那一局。'],
    ['🔁 每天流程', '① 进货（原料价格每日波动，低价囤货 = 纯利润）\n② 配菜单与定价（倍率 0.9~1.1 最稳）\n③ 开门营业（26 秒实时经营，点出杯位可加速，还有小费和连击）\n④ 结算（满意率决定口碑，口碑决定客流）\n⑤ 打烊三选一（每 ' + CFG.CARD_EVERY + ' 天抽一次）\n⑥ 投资（升级 / 研发 / 招人 / 开分店）'],
    ['🃏 经营策略卡', '每张卡都有得有失（例：外卖平台 客流 +25% / 每杯收入 -¥0.8），选定后本局内一直生效。\n它改的是收益结构而不是收益总量 —— 抽到什么不重要，怎么围绕它调整才是玩法。\n最多持有 ' + CFG.CARD_MAX + ' 张；手感不对可以选「都不要」。'],
    ['👥 客群', '顾客分 5 类：学生党 / 打工人 / 网红 / 家庭客 / 街坊长辈，口味偏好、价格容忍度、耐心、单次杯数都不同。'],
    ['🏙️ 竞争', '隔壁会抢客流，去「🏙️ 商圈」用挖角 / 营销压制 / 差异化反击。'],
    ['💡 核心策略', '产能与客流的赛跑：客流涨太快而产能不够，客人会流失、口碑暴跌。出杯位 = 员工数 + 分店数 + 1。'],
    ['⌨️ 小技巧', '连点同一出杯位可叠加连击，小费最高翻倍；命中当日流行标签销量 +55%。'],
  ];
  for (var i = 0; i < secs.length; i++) {
    text(ctx, secs[i][0], x, y, { size: FS.md, weight: 800, color: T.amber });
    y += 18;
    y += para(ctx, secs[i][1], x, y, { size: FS.sm, color: T.txt2, maxW: w, lineH: 16 }) + 10;
  }
  /* 音效开关。返回内容底边 y —— drawModal 据此算滚动上限，
     让小屏（375×667）上被裁掉的底部章节和这个开关变得可以滑到。 */
  GFX.button(ctx, x, y, w, 38,
    (VIEW.sound ? '🔊 音效：开' : '🔇 音效：关'),
    { kind: 'ghost', act: 'sound', size: FS.md });
  return y + 44;
};

/* 平台福利中心：侧边栏复访 / 加桌面 / 订阅消息 / 激励广告 / 内购 */
MODALS.gift = function (ctx, b, m) {
  var s = S();
  var x = b.x + 14, w = b.w - 28;
  var y = b.y + 14;
  text(ctx, '🎁 每日福利', x, y, { size: FS.lg, weight: 900 });
  y += 24;
  y += para(ctx, '来自抖音官方能力。未开通的项目不会显示在这里，'
    + '也不会向你要任何与本局无关的权限。', x, y,
    { size: FS.xs, color: T.txt3, maxW: w, lineH: 15 }) + 8;

  var row = function (emoji, title, sub, btn, act, id, kind, off) {
    GFX.fillRR(ctx, x, y, w, 54, 12, T.card, T.line);
    text(ctx, emoji, x + 11, y + 16, { size: FS.display });
    text(ctx, title, x + 38, y + 8, { size: FS.md, weight: 800, maxW: w - 130 });
    text(ctx, sub, x + 38, y + 27, { size: FS.xs, color: T.txt2, maxW: w - 130 });
    if (btn) {
      GFX.button(ctx, x + w - 100, y + 11, 90, 32, btn,
        { kind: kind || 'ghost', act: act, id: id, size: FS.sm, disabled: !!off });
    }
    y += 62;
  };

  /* ③ 侧边栏复访 —— 平台必接，入口必须放在主页面 */
  if (CAPS.sidebarOn()) {
    if (CAPS.sidebarClaimed()) {
      row('🎁', '侧边栏复访', '今日已领取，明天从侧边栏进来还能再领', '已领取', null, null, 'ghost', true);
    } else if (CAPS.fromSidebar()) {
      row('🎁', '侧边栏复访', '补给已到账：现金 ' + money(giftCashOf('sidebar', s)) + ' + 全原料 30 份',
        '领取', 'sidebarclaim', null, 'primary');
    } else {
      row('🎁', '侧边栏复访', '把本游戏放到抖音首页侧边栏，明天从那里进来即可领补给',
        '前往侧边栏', 'sidebar', null, 'amber');
    }
  }

  /* ② 添加到桌面 */
  if (CAPS.cfg.shortcut) {
    if (CAPS.shortcutAdded) {
      row('📱', '添加到桌面', '已添加，下次从桌面一键直达', '已添加', null, null, 'ghost', true);
    } else {
      row('📱', '添加到桌面', '在手机桌面留个入口，回来更方便', '加桌面', 'shortcut', null, 'ghost');
    }
  }

  /* ④ 订阅消息 */
  if ((CAPS.cfg.subscribeTmplIds || []).length) {
    row('🔔', '订阅消息', '上新与活动经抖音「消息 - 游戏通知」提醒你', '开启提醒', 'subscribe', null, 'ghost');
  }

  /* ⑤ 激励广告 */
  if (CAPS.cfg.rewardedAdUnitId) {
    var left = CAPS.adLeft();
    row('📺', '看视频领现金', '完整看完一段短视频可领 ' + money(giftCashOf('ad', s))
      + '，今日剩 ' + left + '/' + CAPS.cfg.adDailyLimit + ' 次',
      left > 0 ? '领 ' + money(giftCashOf('ad', s)) : '今日用完',
      'adreward', null, left > 0 ? 'amber' : 'ghost', left <= 0);
  }

  /* ① 内购 */
  var goods = CAPS.iapList();
  for (var gi = 0; gi < goods.length; gi++) {
    var g = goods[gi];
    row('💎', g.name || '礼包',
      '现金 ' + money(num(g.grantCash)) + ' + 全原料 ' + num(g.grantIng) + ' 份',
      '¥' + (num(g.price) / 100).toFixed(2), 'iapbuy', String(gi), 'primary');
  }
};

/* 紧急进货 */
MODALS.restock = function (ctx, b, m) {
  var s = S();
  var x = b.x + 14, w = b.w - 28;
  var y = b.y + 14;
  text(ctx, '🚚 紧急进货', x, y, { size: FS.lg, weight: 900 });
  text(ctx, '价格 ×' + CFG.RESTOCK_MARKUP.toFixed(2) + '，立即到货', x + w, y + 2,
    { size: FS.xs, align: 'right', color: T.txt3 });
  y += 28;
  for (var i = 0; i < ING.length; i++) {
    var g = ING[i];
    var p = Math.round((num(s.prices[g.id]) || g.base) * CFG.RESTOCK_MARKUP);
    GFX.fillRR(ctx, x, y, w, 38, 10, T.card, T.line);
    text(ctx, g.emoji + ' ' + g.name, x + 10, y + 11, { size: FS.md });
    text(ctx, '¥' + p + '/份', x + 130, y + 12, { size: FS.sm, color: T.amber });
    for (var q = 0; q < 3; q++) {
      var amt = [10, 30, 60][q];
      GFX.button(ctx, x + w - 10 - (2 - q) * 60 - 48, y + 8, 52, 22, '+' + amt,
        { kind: 'ghost', act: 'rbug', id: g.id, extra: amt, size: FS.xs, r: 7 });
    }
    y += 44;
  }
};

/* 确认类 */
MODALS.confirm = function (ctx, b, m) {
  var x = b.x + 14, w = b.w - 28;
  var y = b.y + 16;
  text(ctx, m.title || '确认', x + w / 2, y, { size: FS.xl, weight: 900, align: 'center' });
  y += 28;
  y += para(ctx, m.text || '', x + w / 2 - (w / 2), y,
    { size: FS.md, color: T.txt2, maxW: w, align: 'center', lineH: 18 }) + 8;
  GFX.button(ctx, x, y, (w - 10) / 2, 42, m.okText || '确认',
    { kind: m.okKind || 'amber', act: m.okAct, size: FS.md });
  GFX.button(ctx, x + (w - 10) / 2 + 10, y, (w - 10) / 2, 42, '再想想',
    { kind: 'ghost', act: 'close', size: FS.md });
};

/* 导入存档 */
MODALS.import = function (ctx, b, m) {
  var x = b.x + 14, w = b.w - 28;
  var y = b.y + 14;
  text(ctx, '📥 导入存档', x, y, { size: FS.lg, weight: 900 });
  y += 26;
  y += para(ctx, '抖音小游戏内没有输入框。请先在浏览器版（或备忘录）里复制存档码，'
    + '再回到本页点下方按钮从剪贴板读取。', x, y, { size: FS.sm, color: T.txt2, maxW: w, lineH: 17 }) + 12;
  GFX.button(ctx, x, y, w, 42, '📋 从剪贴板导入', { kind: 'primary', act: 'doimport', size: FS.md });
  y += 52;
  if (VIEW.importMsg) {
    text(ctx, VIEW.importMsg, x, y, { size: FS.sm, color: T.txt2, maxW: w });
  }
};

/* ============================================================
 *  结局页
 * ========================================================== */
function drawEnd(ctx, L) {
  var W = L.W, H = L.H;
  var x = 24, w = W - 48;
  var y = Math.max(40, H * 0.10);
  var m = VIEW.end || {};
  text(ctx, m.emoji || '🎉', W / 2, y, { size: 54, align: 'center' });
  y += 64;
  text(ctx, m.title || '目标达成', W / 2, y, { size: FS.display, weight: 900, align: 'center' });
  y += 34;
  text(ctx, m.grade || 'B', W / 2, y, { size: 44, weight: 900, align: 'center', color: T.amber });
  y += 54;
  y += para(ctx, m.sub || '', x, y, { size: FS.md, color: T.txt2, maxW: w, lineH: 18 }) + 16;

  var its = m.items || [];
  var cw = (w - 8) / 2;
  for (var i = 0; i < its.length; i++) {
    var ix = x + (i % 2) * (cw + 8), iy = y + Math.floor(i / 2) * 40;
    GFX.fillRR(ctx, ix, iy, cw, 34, 10, T.card, T.line);
    text(ctx, its[i].k, ix + 8, iy + 9, { size: FS.xs, color: T.txt3 });
    text(ctx, its[i].v, ix + cw - 8, iy + 9, { size: FS.md, weight: 700, align: 'right', color: T.amber });
  }
  y += Math.ceil(its.length / 2) * 40 + 12;

  /* V8 结局四维称号：同一个 S 级有多种拿法（利润/口碑/服务/经营） */
  var axs = (m.axes || []);
  if (axs.length) {
    GFX.fillRR(ctx, x, y, w, 26 + Math.ceil(axs.length / 2) * 30, 12, T.card, T.line);
    text(ctx, '🏅 经营四维', x + 10, y + 8, { size: FS.md, weight: 800 });
    var axw = (w - 20 - 6) / 2;
    for (var ai = 0; ai < axs.length; ai++) {
      var ax = axs[ai];
      var axx = x + 10 + (ai % 2) * (axw + 6);
      var axy = y + 30 + Math.floor(ai / 2) * 30;
      text(ctx, ax.emoji + ' ' + ax.name + (ax.title ? ' · ' + ax.title : ''),
        axx, axy, { size: FS.xs, weight: 700, color: ax.tier > 0 ? T.amber : T.txt3, maxW: axw });
      text(ctx, GFX.plainText(ax.desc), axx, axy + 13,
        { size: FS.xs, color: T.txt3, maxW: axw });
    }
    y += 26 + Math.ceil(axs.length / 2) * 30 + 10;
  }

  var by = Math.min(H - 108, y + 8);
  /* 无尽入口：H5 在结局页有一张「♾️ 继续经营」卡，小游戏原本没有，
     导致 startEndless() 在这版没有任何调用点 —— 无尽模式彻底不可达。 */
  if ((VIEW.end || {}).kind !== 'bankrupt') {
    GFX.fillRR(ctx, x, by, w, 44, 12, 'rgba(53,229,240,.10)', 'rgba(53,229,240,.34)');
    text(ctx, '♾️ 无尽模式 · 目标持续升级', x + 12, by + 14, { size: FS.md, weight: 800, color: T.cyan });
    GFX.button(ctx, x + w - 96, by + 8, 84, 28, '继续经营',
      { kind: 'cyan', act: 'endless', size: FS.sm, r: 9, pressed: isPressed('endless') });
    by += 52;
  }
  /* 底行按钮：分享是抖音生态里最便宜的拉新手段，也必须是玩家点击直接触发，
     宿主不支持时连按钮都不给，避免「点了没反应」。
     「🏆 日榜」只在每日挑战这一局结束时插进来 —— 玩家刚打完，
     正是最想知道自己在什么位置的时刻；普通局插它就只是挤占宽度。 */
  var rowActs = [];
  if ((VIEW.end || {}).daily) rowActs.push({ t: '🏆 日榜', kind: 'ghost', act: 'dailyrank', size: FS.md });
  if (CAPS.shareOn()) rowActs.push({ t: '📤 分享战绩', kind: 'amber', act: 'share', size: FS.md });
  rowActs.push({ t: '🔄 再来一局', kind: 'primary', act: 'again', size: rowActs.length >= 2 ? 12.5 : 14 });
  var rw = rowActs.length >= 2 ? (w - 10 * (rowActs.length - 1)) / rowActs.length : w;
  for (var bi = 0; bi < rowActs.length; bi++) {
    GFX.button(ctx, x + bi * (rw + 10), by, rw, 44, rowActs[bi].t,
      { kind: rowActs[bi].kind, act: rowActs[bi].act, size: rowActs[bi].size, pressed: isPressed(rowActs[bi].act) });
  }
  GFX.button(ctx, x, by + 52, w, 40, '🏠 回到主菜单', { kind: 'ghost', act: 'home', size: FS.md });
}

/* ============================================================
 *  提示条 / 飘字 / 彩带
 * ========================================================== */
function drawToasts(ctx, L) {
  var W = L.W;
  for (var i = 0; i < VIEW.toasts.length; i++) {
    var t = VIEW.toasts[i];
    var a = Math.min(1, t.life / 300);
    ctx.globalAlpha = a;
    /* 第一条要避开刘海：HUD 的数值胶囊带占了顶部约 54~94px（含 padTop），
       以前写死 60，iPhone 刘海机型（ins.top≈44）下第一条正好压在胶囊上。 */
    var y = Math.max(60, L.padTop + 62) + i * 34;
    ctx.font = '700 12px ' + FONT;
    var tw = ctx.measureText(t.msg).width + 24;
    GFX.fillRR(ctx, (W - tw) / 2, y, tw, 26, 13, 'rgba(38,18,68,.94)', T.line2);
    text(ctx, t.msg, W / 2, y + 7, { size: FS.md, weight: 700, align: 'center', color: 'white' });
    ctx.globalAlpha = 1;
  }
}

function drawFloaters(ctx, L) {
  for (var i = 0; i < VIEW.floaters.length; i++) {
    var f = VIEW.floaters[i];
    ctx.globalAlpha = Math.max(0, f.life / 800);
    text(ctx, f.text, f.x, f.y - (800 - f.life) / 26,
      { size: FS.lg, weight: 800, align: 'center', color: f.kind === 'bad' ? T.red : T.green });
    ctx.globalAlpha = 1;
  }
}

function drawConfetti(ctx, L) {
  for (var i = 0; i < VIEW.confetti.length; i++) {
    var c = VIEW.confetti[i];
    ctx.globalAlpha = Math.max(0, c.life / 1400);
    ctx.fillStyle = c.c;
    ctx.fillRect(c.x, c.y + (1400 - c.life) / 12, c.s, c.s * 1.6);
    ctx.globalAlpha = 1;
  }
}

/* ============================================================
 *  新手引导
 * ========================================================== */
function drawTutorial(ctx, L) {
  if (!VIEW.tut.on) return;
  var step = TUTORIAL[VIEW.tut.step];
  if (!step) return;
  var W = L.W, H = L.H;
  ctx.fillStyle = 'rgba(8,3,18,.72)';
  ctx.fillRect(0, 0, W, H);
  if (VIEW.tut.rect) {
    var r = VIEW.tut.rect;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
    ctx.clip();
    ctx.clearRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
    ctx.restore();
    ctx.strokeStyle = T.cyan; ctx.lineWidth = 2;
    GFX.rr(ctx, r.x - 4, r.y - 4, r.w + 8, r.h + 8, 10);
    ctx.stroke();
  }
  /* 等待型步骤要把「请做什么」明确写出来 ——
     只给正文不说动作，玩家根本不知道这一步要他点哪里。 */
  var hint = (step.advance && step.advance !== 'next') ? (step.hint || '') : '';
  var ch = hint ? 172 : 150;
  var cy = H - ch - 24 - L.padBottom;
  /* 卡片是全不透明的：高亮区在屏幕下半段时（最典型是第⑥步的
     「开门营业」钉在底部），卡片必须上移避开 —— 否则它正好盖住
     正在教玩家点的那颗按钮，只剩底下一条边可点还容易误触「跳过」。 */
  if (VIEW.tut.rect) {
    var hr = VIEW.tut.rect;
    if (hr.y + hr.h > cy + 8) {
      var above = hr.y - ch - 12;
      if (above > (L.hudH || 60) + 40) cy = above;
    }
  }
  GFX.fillRR(ctx, 16, cy, W - 32, ch, 18, T.bg2, T.line2);
  text(ctx, (VIEW.tut.step + 1) + '/' + TUTORIAL.length, 30, cy + 12, { size: FS.xs, color: T.txt3 });
  text(ctx, step.title, 30, cy + 26, { size: FS.lg, weight: 900, color: T.txt, maxW: W - 70 });
  var ty = cy + 48;
  ty += para(ctx, GFX.plainText(step.text), 30, ty,
    { size: FS.md, color: T.txt2, maxW: W - 70, lineH: 17 });
  if (hint) {
    ty += 6;
    ty += para(ctx, hint + (step.advance === 'rush'
      ? '（' + Math.min(3, (VIEW.tutRush || 0) + 1) + '/3）' : ''),
      30, ty, { size: FS.md, weight: 700, color: T.amber, maxW: W - 70, lineH: 16 });
  }
  GFX.button(ctx, 30, cy + ch - 46, (W - 78) / 2, 36, '跳过引导', { kind: 'ghost', act: 'tutskip', size: FS.md });
  GFX.button(ctx, 30 + (W - 78) / 2 + 16, cy + ch - 46, (W - 78) / 2, 36, '下一步 →',
    { kind: 'primary', act: 'tutnext', size: FS.md });
}

/* ============================================================
 *  对外入口
 * ========================================================== */
function draw(ctx, W, H, now) {
  GFX.hitReset();
  var L = layoutOf(W, H);
  drawBg(ctx, W, H);
  if (VIEW.screen === 'title') drawTitle(ctx, L);
  else if (VIEW.screen === 'end') drawEnd(ctx, L);
  else drawGame(ctx, L);
  drawModal(ctx, L);
  drawFloaters(ctx, L);
  drawConfetti(ctx, L);
  drawToasts(ctx, L);
  drawTutorial(ctx, L);
  return L;
}

function isPressed(act, id, extra) {
  var p = VIEW.pressedAct;
  if (!p) return false;
  return p.act === act && (id === undefined || p.id === id) && (extra === undefined || p.extra === extra);
}

function canAfford(s, cost) { return num(s.cash) >= num(cost); }

if (typeof globalThis !== 'undefined') {
  globalThis.VIEW = VIEW;
  globalThis.CV = {
    draw: draw, layoutOf: layoutOf, drawPanelArea: drawPanelArea,
    get contentHeight() { return VIEW_H; },
  };
}
