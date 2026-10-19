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
  tut: { on: false, step: 0, rect: null },
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
function layoutOf(W, H) {
  var ins = VIEW.ins || { top: 0, bottom: 0 };
  /* HUD 分两行：第一行四个数值胶囊，第二行是目标进度条 + 右上角图标按钮。
     图标按钮必须独占第二行 —— 它们以前压在第一行右上角，390 宽时图标区从
     x=228 一直伸到 374，而「净资产」那格占 287~374，等于被整个盖住。 */
  var hudH = 88, tabH = 40;
  if (H < 600) { hudH = 80; tabH = 36; }
  /* 顶部给刘海 / 状态栏让出高度，底部给 Home 指示条让出高度。
     Canvas 没有 env(safe-area-inset-*)，这两个值由 platform.js 向宿主问来。 */
  hudH += ins.top;
  return {
    W: W, H: H, hudH: hudH, tabH: tabH,
    bodyY: hudH + tabH,
    padTop: ins.top, padBottom: ins.bottom,
  };
}

/* ============================================================
 *  开始界面
 * ========================================================== */
function drawTitle(ctx, L) {
  var W = L.W, H = L.H;
  var m = META();
  var x = 16, w = W - 32;
  var y = 34 + L.padTop;

  /* Logo */
  ctx.textAlign = 'center';
  text(ctx, '🧋', W / 2, y, { size: 40, align: 'center' });
  y += 50;
  text(ctx, '奶茶星球', W / 2, y, { size: 26, weight: 900, align: 'center', color: T.txt });
  y += 30;
  text(ctx, 'BUBBLE TYCOON · 30 天街头奶茶帝国', W / 2, y,
    { size: 11, align: 'center', color: T.txt3 });
  y += 26;

  /* 难度三选一 */
  text(ctx, '选择难度', W / 2, y, { size: 11, align: 'center', color: T.txt3 });
  y += 18;
  var cw = (w - 16) / 3, ch = 72;
  var ds = Object.keys(DIFFICULTY).map(function (k) { return DIFFICULTY[k]; });
  for (var i = 0; i < ds.length; i++) {
    var d = ds[i];
    GFX.cardBtn(ctx, x + i * (cw + 8), y, cw, ch, [
      { t: d.emoji, size: 20 },
      { t: d.name, size: 12, weight: 800 },
      { t: money(d.goal), size: 10, color: T.amber },
    ], { act: 'diff', id: d.key, on: VIEW.diff === d.key, pressed: isPressed('diff', d.key), center: true });
  }
  y += ch + 14;

  /* 主按钮 */
  var bw = (w - 10) / 2;
  GFX.button(ctx, x, y, w, 46, '🚀 开始营业',
    { kind: 'primary', act: 'start', size: 15, pressed: isPressed('start') });
  y += 54;
  if (hasAnySave()) {
    GFX.button(ctx, x, y, bw, 40, '💾 继续存档',
      { kind: 'ghost', act: 'continue', pressed: isPressed('continue') });
    GFX.button(ctx, x + bw + 10, y, bw, 40,
      /* 原来读 VIEW.dailyPlayed，但这个字段全项目从未被赋值，永远 falsy，
         昨天打过的成绩也就永远显示不出来。直接按 META 判断。 */
      (m.dailyDate === todayKey() && m.dailyBest != null)
        ? '📅 今日挑战 · 最佳 ' + money(m.dailyBest) : '📅 每日挑战',
      { kind: 'amber', act: 'daily', size: 11, pressed: isPressed('daily') });
  } else {
    GFX.button(ctx, x, y, w, 40, '📅 每日挑战',
      { kind: 'amber', act: 'daily', pressed: isPressed('daily') });
  }
  y += 48;

  /* 连续登录：和「玩法说明 / 导入存档」挤在同一行做三等分，
     标题页在小屏（640 高）上已经没有余量再单独加一行了。 */
  var lg = loginState(m);
  var bw3 = (w - 16) / 3;
  GFX.button(ctx, x, y, bw3, 38,
    !lg.claimed ? '🔥 签到 ' + money(lg.next) : '🎁 已签',
    { kind: lg.claimed ? 'ghost' : 'amber', act: 'login', size: 10.5, disabled: !!lg.claimed, pressed: isPressed('login') });
  GFX.button(ctx, x + bw3 + 8, y, bw3, 38, '📖 玩法说明', { kind: 'ghost', act: 'help', size: 10.5, pressed: isPressed('help') });
  GFX.button(ctx, x + (bw3 + 8) * 2, y, bw3, 38, '📥 导入存档', { kind: 'ghost', act: 'import', size: 10.5, pressed: isPressed('import') });
  y += 46;

  /* 存档槽 */
  text(ctx, '💾 存档槽', x, y, { size: 11, color: T.txt3 });
  y += 16;
  var sw = (w - 16) / 3;
  for (var k = 0; k < CFG.SAVE_SLOTS; k++) {
    var info = slotInfo(k);
    var lines = info
      ? [
        { t: '槽 ' + (k + 1) + (getSlot() === k ? ' ✓' : ''), size: 11, weight: 800 },
        { t: 'Day ' + info.day + (info.endless ? ' ♾' : ''), size: 10, color: T.txt2 },
        { t: money(info.worth), size: 10, color: T.amber },
      ]
      : [{ t: '槽 ' + (k + 1), size: 11, weight: 800 }, { t: '空', size: 10, color: T.txt3 }];
    GFX.cardBtn(ctx, x + k * (sw + 8), y, sw, 54, lines,
      { act: 'slot', id: String(k), on: getSlot() === k, pressed: isPressed('slot', String(k)) });
  }
  y += 62;

  /* 元信息 */
  text(ctx, '🌟 声望 ' + m.bp + ' ★   🏆 最高 ' + money(m.best.normal || 0) + '   🎮 已玩 ' + m.runs + ' 局',
    W / 2, y, { size: 10.5, align: 'center', color: T.txt2 });
  y += 17;
  text(ctx, lg.claimed
    ? '🔥 连登 ' + lg.streak + ' 天 · 明日 ' + money(lg.next) + (lg.pending > 0 ? '（' + money(lg.pending) + ' 开局到账）' : '')
    : '🔥 连登 ' + lg.streak + ' 天 · 今天还没签到',
    W / 2, y, { size: 10.5, align: 'center', color: lg.claimed ? T.amber : T.txt3 });
  y += 18;
  if (!STORAGE_OK) {
    text(ctx, '⚠️ 存储不可用，本局进度无法保存', W / 2, y,
      { size: 10.5, align: 'center', color: T.red });
    y += 16;
  }
  ctx.textAlign = 'left';
  if (y < H - 26) {
    text(ctx, '💡 ' + VIEW.tip, W / 2, H - 24, { size: 10.5, align: 'center', color: T.txt3, maxW: W - 40 });
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
}

function drawHUD(ctx, L, s) {
  var W = L.W, hudH = L.hudH;
  var g = ctx.createLinearGradient(0, 0, 0, hudH);
  g.addColorStop(0, 'rgba(30,12,55,.96)'); g.addColorStop(1, 'rgba(30,12,55,.6)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, hudH);
  ctx.strokeStyle = T.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, hudH); ctx.lineTo(W, hudH); ctx.stroke();

  var y = 10 + L.padTop;
  var cw = (W - 32 - 12) / 4;
  var goal = Math.max(1, num(goalOf(s), 1));
  GFX.chip(ctx, 16, y, cw, 40,
    'DAY', s.endless ? s.day + ' 无尽' + s.milestone : s.day + ' / ' + CFG.DAYS, T.txt);
  GFX.chip(ctx, 16 + cw + 4, y, cw, 40, '现金', money(num(s.cash)),
    num(s.cash) < 0 ? T.red : T.amber);
  GFX.chip(ctx, 16 + (cw + 4) * 2, y, cw, 40, '口碑', String(Math.round(num(s.rep))), T.txt);
  GFX.chip(ctx, 16 + (cw + 4) * 3, y, cw, 40, '净资产', money(num(netWorth(s))), T.amber);
  y += 44;

  /* 右上角图标按钮：独占第二行右侧，不再压住数值胶囊 */
  var bs = hudH < 84 ? 26 : 28, gap = 6, iy = y;
  var icons = [
    { t: '💾', act: 'save' }, { t: '🏠', act: 'home' },
    { t: '📖', act: 'help' }, { t: '📈', act: 'chart' },
  ];
  var iconW = icons.length * bs + (icons.length - 1) * gap;
  var bx = W - 16 - bs;
  for (var i = 0; i < icons.length; i++) {
    GFX.fillRR(ctx, bx, iy, bs, bs, 9, T.card2, T.line);
    text(ctx, icons[i].t, bx + bs / 2, iy + (bs - 15) / 2, { size: 15, align: 'center' });
    GFX.addHit(bx, iy, bs, bs, icons[i].act, null, null);
    bx -= bs + gap;
  }

  /* 目标进度条：宽度让出图标区，文字改到进度条下方左对齐（原来右对齐会顶到图标） */
  var barW = Math.max(60, W - 32 - iconW - 10);
  GFX.bar(ctx, 16, y + 2, barW, 5, num(netWorth(s)) / goal, { color: T.cyan });
  var share = num(rivalShare(s));
  var gt = '目标 ' + money(goal) + ' · ' + Math.round(num(netWorth(s)) / goal * 100) + '%'
    + (share >= 0.15 ? ' · 🦑对手抢 ' + Math.round(share * 100) + '%' : '');
  text(ctx, gt, 16, y + 12, { size: 9.5, color: T.txt3, maxW: barW });
}

function drawTabs(ctx, L) {
  var W = L.W, y = L.hudH, h = L.tabH;
  var tabs = [
    { k: 'manage', t: '🧋' }, { k: 'lab', t: '🧪' }, { k: 'up', t: '⬆️' },
    { k: 'staff', t: '👥' }, { k: 'rival', t: '🏙️' }, { k: 'ach', t: '🏅' },
  ];
  var w = W / tabs.length;
  for (var i = 0; i < tabs.length; i++) {
    var on = VIEW.tab === tabs[i].k;
    text(ctx, tabs[i].t, i * w + w / 2, y + 6, { size: 15, align: 'center' });
    if (on) {
      ctx.fillStyle = T.pink;
      ctx.fillRect(i * w + w * 0.3, y + h - 3, w * 0.4, 2.5);
    }
    GFX.addHit(i * w, y, w, h, 'tab', tabs[i].k, null);
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
  var x = 16, w = W - 32;

  var fn = PANELS[VIEW.tab];
  if (fn) y = fn(ctx, x, y, w, s);
  VIEW_H = y - top + (VIEW.scroll[VIEW.tab] || 0) + 16 + pinH;
  GFX.clipPop(ctx);

  if (pinH) {
    var by = L.H - pinH;
    GFX.fillRR(ctx, 0, by - 8, W, pinH + 8, 0, 'rgba(30,12,55,.97)', T.line);
    GFX.button(ctx, x, by + 6, w, 44, '🚪 开门营业',
      { kind: 'primary', act: 'open', size: 15, pressed: isPressed('open') });
  }
}

/* ============================================================
 *  面板 1：经营
 * ========================================================== */
function panelManage(ctx, x, y, w, s) {
  var tag = TAGS[s.trend] || {};
  var nextTag = TAGS[s.nextTrend] || {};

  /* 平台福利入口。
     侧边栏复访是平台必接能力，官方明确要求「礼包入口放在游戏主页面（首页）」——
     经营面板就是进游戏后的第一屏，所以放在最顶上。
     没有任何一项能力可用时（没 tt / 没配广告位 / 没开内购）整块不渲染。 */
  if (CAPS.visible()) {
    GFX.fillRR(ctx, x, y, w, 48, 12, 'rgba(255,194,71,.10)', 'rgba(255,194,71,.38)');
    text(ctx, '🎁', x + 12, y + 13, { size: 17 });
    text(ctx, '每日福利', x + 36, y + 9, { size: 13, weight: 800, color: T.amber });
    text(ctx, CAPS.summary() || '侧边栏 · 加桌面 · 开提醒', x + 36, y + 27,
      { size: 10, color: T.txt2, maxW: w - 70 });
    text(ctx, '›', x + w - 18, y + 14, { size: 18, weight: 700, color: T.amber });
    GFX.addHit(x, y, w, 48, 'gift', null, null);
    y += 58;
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
      { kind: 'ghost', act: 'scout', size: 10, r: 7, disabled: !canAfford(s, 150), pressed: isPressed('scout') });
  }
  y += ih + 10;

  /* 市场新闻：它会实打实地改原料价格，不显示的话玩家只看到「今天怎么这么贵」。 */
  if (s.news && s.news.text) {
    GFX.fillRR(ctx, x, y - 6, w, 28, 10, 'rgba(255,194,71,.10)', 'rgba(255,194,71,.28)');
    text(ctx, '📰 ' + s.news.text, x + 10, y + 2, { size: 10.5, color: T.amber, maxW: w - 20 });
    y += 36;
  }

  /* 每日任务：与 H5 版同一张卡，位置也一致（情报下面、采购上面）。
     达成即到账现金，是「再开一天」的具体理由。 */
  var qv = questViews(s);
  if (qv.length) {
    var qh = 30 + qv.length * 30;
    GFX.card(ctx, x, y, w, qh);
    text(ctx, '🎯 今日任务', x + 10, y + 8, { size: 12.5, weight: 800 });
    text(ctx, '达成即到账', x + w - 10, y + 9, { size: 10, align: 'right', color: T.txt3 });
    var qy = y + 30;
    for (var qi = 0; qi < qv.length; qi++) {
      var q = qv[qi];
      text(ctx, q.emoji, x + 12, qy + 6, { size: 14 });
      text(ctx, q.name, x + 32, qy + 8, { size: 11, color: q.done ? T.txt3 : T.txt, maxW: 60 });
      GFX.bar(ctx, x + 98, qy + 11, w - 98 - 80, 6, q.ratio, { color: q.done ? T.green : T.cyan });
      var qshow = q.done ? '已达成'
        : (q.dir === 'down'
          /* 越少越好型的数字是「上限」，直接写 x/y 会被读成「已完成 x 个」 */
          ? '剩 ' + Math.max(0, q.goal - Math.round(q.prog)) + q.unit
          : q.prefix + Math.round(q.prog) + '/' + q.prefix + q.goal + q.unit);
      text(ctx, qshow, x + w - 74, qy + 8, { size: 9.5, color: T.txt3, align: 'right', maxW: 64 });
      text(ctx, (q.done ? '✅ ' : '') + '+' + money(q.reward), x + w - 10, qy + 8,
        { size: 10, weight: 800, align: 'right', color: q.done ? T.green : T.amber });
      qy += 30;
    }
    y += qh + 10;
  }

  /* 采购 */
  var rows = ING.length;
  GFX.card(ctx, x, y, w, 40 + rows * 30 + 38);
  text(ctx, '🛒 采购', x + 10, y + 9, { size: 12.5, weight: 800 });
  text(ctx, '现金 ' + money(num(s.cash)), x + w - 10, y + 9,
    { size: 11, align: 'right', color: T.amber });
  var ry = y + 30;
  for (var i = 0; i < ING.length; i++) {
    var g = ING[i];
    var p = s.prices[g.id] || g.base;
    var prev = s.prevPrices[g.id] || g.base;
    var up = p > prev + 0.01, down = p < prev - 0.01;
    var col = up ? T.red : (down ? T.green : T.txt2);
    text(ctx, g.emoji + ' ' + g.name, x + 10, ry + 6, { size: 11.5, color: T.txt });
    text(ctx, '¥' + p.toFixed(1), x + 78, ry + 6, { size: 11, color: col });
    text(ctx, (up ? '▲' : down ? '▼' : '—'), x + 122, ry + 6, { size: 10, color: col });
    text(ctx, '库存 ' + Math.round(num(s.inv[g.id])), x + 145, ry + 6, { size: 10.5, color: T.txt3 });
    /* 三个进货按钮：+10 / +50 / 满仓 */
    /* 只留 +10 / +50。原来第三个「满」传 extra 999 给 buyIng()，
       而仓库上限最多 1500 —— 这个按钮 100% 撞「仓库装不下了」，点了永远只弹错误。 */
    var bw = 34, bh = 24;
    var bx = x + w - 10 - (bw * 2 + 6);
    GFX.button(ctx, bx, ry + 1, bw, bh, '+10', { kind: 'ghost', act: 'buy', id: g.id, extra: 10, size: 10, r: 7, pressed: isPressed('buy', g.id, 10) });
    GFX.button(ctx, bx + bw + 6, ry + 1, bw, bh, '+50', { kind: 'ghost', act: 'buy', id: g.id, extra: 50, size: 10, r: 7, pressed: isPressed('buy', g.id, 50) });
    ry += 30;
  }
  GFX.button(ctx, x + 10, ry + 2, w - 20, 30, '🛒 一键补货（按今日客流配齐）',
    { kind: 'cyan', act: 'autofill', size: 11, r: 9, pressed: isPressed('autofill') });
  ry += 38;
  y += 40 + rows * 30 + 38 + 10;

  /* 菜单与定价 */
  var ms = s.menu || [];
  var mh = 38 + ms.length * 46;
  GFX.card(ctx, x, y, w, mh);
  text(ctx, '📝 菜单与定价', x + 10, y + 9, { size: 12.5, weight: 800 });
  text(ctx, '倍率 0.9~1.1 最稳', x + w - 10, y + 10, { size: 10, align: 'right', color: T.txt3 });
  var my = y + 30;
  for (var j = 0; j < ms.length; j++) {
    var rid = ms[j];
    var r = recipeById(rid);
    if (!r) continue;
    var price = priceOf(s, rid), cost = costOf(s, rid), ratio = num(s.ratios[rid], 1);
    text(ctx, r.emoji + ' ' + r.name, x + 10, my + 4, { size: 11.5, color: T.txt });
    text(ctx, '售 ' + money(price) + ' · 本 ¥' + cost.toFixed(1) + ' · 毛利 ' + money(price - cost),
      x + 10, my + 20, { size: 10, color: T.txt3 });
    /* 倍率 - / + */
    GFX.button(ctx, x + w - 106, my + 2, 26, 22, '−', { kind: 'ghost', act: 'ratio', id: rid, extra: -0.05, size: 13, r: 7 });
    text(ctx, '×' + ratio.toFixed(2), x + w - 66, my + 6, { size: 11, align: 'center', color: T.cyan });
    GFX.button(ctx, x + w - 42, my + 2, 26, 22, '＋', { kind: 'ghost', act: 'ratio', id: rid, extra: 0.05, size: 13, r: 7 });
    my += 46;
  }
  y += mh + 10;

  /* 营销 */
  GFX.card(ctx, x, y, w, 62);
  text(ctx, '📣 营销投入', x + 10, y + 9, { size: 12.5, weight: 800 });
  text(ctx, '¥' + Math.round(num(s.marketing)) + ' → 客流 ×' + marketingMul(num(s.marketing)).toFixed(2),
    x + w - 10, y + 10, { size: 10.5, align: 'right', color: T.cyan });
  text(ctx, '预计客流 ' + Math.round(num(trafficOf(s))) + ' 人 · 出杯位 ' + stationCount(s) + ' 个',
    x + 10, y + 28, { size: 10.5, color: T.txt3 });
  var mks = [0, 200, 500, 1000, 2000];
  var mw = (w - 20 - 8 * (mks.length - 1)) / mks.length;
  for (var mi = 0; mi < mks.length; mi++) {
    GFX.button(ctx, x + 10 + mi * (mw + 8), y + 44, mw, 16,
      mks[mi] === 0 ? '不投' : '¥' + mks[mi],
      { kind: 'ghost', act: 'mkt', id: String(mks[mi]), size: 9.5, r: 6 });
  }
  y += 72;

  /* 建议。adviceOf() 返回的是对象数组（最多 4 条），曾经整只数组被直接塞进
     text()，渲染出来是「[object Object],[object Object]」—— 两版不一致里最显眼的一个。 */
  var advs = adviceOf(s) || [];
  if (advs.length) {
    GFX.card(ctx, x, y, w, 30 + advs.length * 20);
    text(ctx, '📌 今日建议', x + 10, y + 8, { size: 11.5, weight: 800, color: T.amber });
    var ay = y + 26;
    for (var ai = 0; ai < advs.length; ai++) {
      var av = advs[ai] || {};
      text(ctx, (av.icon || '·') + ' ' + (av.text || ''), x + 10, ay, {
        size: 10.5, maxW: w - 20,
        color: av.level === 'warn' ? T.amber : (av.level === 'good' ? T.green : T.txt2),
      });
      ay += 20;
    }
    y += 30 + advs.length * 20 + 10;
  }

  /* 店长日志：H5 有这张卡，小游戏原本不显示 —— pushLog 一直在写、一直进存档，却没人读。 */
  var logs = (s.log || []).slice(-4);
  if (logs.length) {
    GFX.card(ctx, x, y, w, 30 + logs.length * 18);
    text(ctx, '📔 店长日志', x + 10, y + 8, { size: 11.5, weight: 800, color: T.txt3 });
    var ly = y + 26;
    for (var li = 0; li < logs.length; li++) {
      text(ctx, logs[li], x + 10, ly, { size: 10, color: T.txt3, maxW: w - 20 });
      ly += 18;
    }
    y += 30 + logs.length * 18 + 10;
  }

  return y;
}

function intel(ctx, x, y, w, k, v, sub) {
  text(ctx, k, x, y, { size: 9.5, color: T.txt3 });
  text(ctx, v, x, y + 13, { size: 12, weight: 800, color: T.txt, maxW: w });
  if (sub) text(ctx, sub, x, y + 30, { size: 9, color: T.txt3, maxW: w });
}

/* ============================================================
 *  面板 2：研发
 * ========================================================== */
function panelLab(ctx, x, y, w, s) {
  GFX.card(ctx, x, y, w, 34);
  text(ctx, '🧪 已解锁配方', x + 10, y + 9, { size: 12.5, weight: 800 });
  text(ctx, '菜单位 ' + (s.menu || []).length + '/' + menuSlots(s), x + w - 10, y + 10,
    { size: 10.5, align: 'right', color: T.txt3 });
  y += 44;

  var unlocked = (s.recipes || []).map(recipeById).filter(Boolean);
  for (var i = 0; i < unlocked.length; i++) {
    var r = unlocked[i];
    var on = (s.menu || []).indexOf(r.id) >= 0;
    GFX.card(ctx, x, y, w, 44);
    text(ctx, r.emoji + ' ' + r.name, x + 10, y + 8, { size: 12, weight: 700 });
    text(ctx, tagNames(r.tags) + ' · 基础 ' + money(num(r.price, 0)), x + 10, y + 25,
      { size: 10, color: T.txt3 });
    GFX.button(ctx, x + w - 74, y + 10, 64, 24, on ? '✅ 在售' : '上架',
      { kind: on ? 'ghost' : 'primary', act: 'toggle', id: r.id, size: 10.5, r: 8 });
    y += 52;
  }

  GFX.card(ctx, x, y, w, 34);
  text(ctx, '🔬 可研发', x + 10, y + 9, { size: 12.5, weight: 800 });
  y += 44;
  for (var j = 0; j < RECIPES.length; j++) {
    var rr = RECIPES[j];
    if ((s.recipes || []).indexOf(rr.id) >= 0) continue;
    var cr = canResearch(s, rr.id);
    var cost = researchCost(s, rr.id);
    GFX.card(ctx, x, y, w, 50);
    text(ctx, rr.emoji + ' ' + rr.name, x + 10, y + 8, { size: 12, weight: 700 });
    text(ctx, tagNames(rr.tags), x + 10, y + 26, { size: 10, color: T.txt3 });
    GFX.button(ctx, x + w - 84, y + 12, 74, 26, '研发 ' + money(cost), {
      kind: cr.ok ? 'amber' : 'ghost', act: 'research', id: rr.id,
      disabled: !cr.ok, size: 10, r: 8,
    });
    y += 58;
  }
  return y + 10;
}

/* ============================================================
 *  面板 3：升级
 * ========================================================== */
function panelUp(ctx, x, y, w, s) {
  GFX.card(ctx, x, y, w, 34);
  text(ctx, '⬆️ 店铺升级', x + 10, y + 9, { size: 12.5, weight: 800 });
  y += 44;
  for (var i = 0; i < UPGRADES.length; i++) {
    var u = UPGRADES[i];
    var lv = num(s.up[u.id], 0);
    var cost = upgradeCost(s, u.id);
    var maxed = cost == null;
    GFX.card(ctx, x, y, w, 50);
    text(ctx, u.emoji + ' ' + u.name, x + 10, y + 8, { size: 12, weight: 700 });
    text(ctx, u.desc, x + 10, y + 26, { size: 10, color: T.txt3, maxW: w - 120 });
    /* 等级点：数量按各自 max 画。写死 6 的话 speed/decor（max 8）满级也只亮 6 个。 */
    for (var d = 0; d < num(u.max, 6); d++) {
      ctx.fillStyle = d < lv ? T.cyan : 'rgba(255,255,255,.13)';
      ctx.beginPath(); ctx.arc(x + w - 100 + d * 11, y + 15, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    GFX.button(ctx, x + w - 76, y + 22, 66, 22, maxed ? '已满级' : money(cost), {
      kind: maxed ? 'ghost' : 'primary', act: 'upgrade', id: u.id,
      disabled: maxed || !canAfford(s, cost), size: 10, r: 8,
    });
    y += 58;
  }

  /* 开分店。必须用 shopCost()：它带 diffOf(s).costMult，
     直接用 SHOP_COSTS 会把地狱难度的价标少 15%，出现「按钮亮着、点了说钱不够」。 */
  var sc = shopCost(s);
  GFX.card(ctx, x, y, w, 50);
  text(ctx, '🏪 开设分店', x + 10, y + 8, { size: 12, weight: 700 });
  text(ctx, '当前 ' + num(s.shops) + ' 家 · 出杯位 +1、客流 +60%', x + 10, y + 26,
    { size: 10, color: T.txt3 });
  GFX.button(ctx, x + w - 76, y + 12, 66, 26, sc != null ? money(sc) : '已满', {
    kind: 'amber', act: 'shop', disabled: sc == null || !canAfford(s, sc), size: 10, r: 8,
  });
  y += 60;

  /* 转生 / 收官 */
  GFX.button(ctx, x, y, (w - 10) / 2, 40, '♻️ 品牌升级',
    { kind: 'amber', act: 'prestige', size: 12 });
  GFX.button(ctx, x + (w - 10) / 2 + 10, y, (w - 10) / 2, 40, '🏁 提前收官',
    { kind: 'ghost', act: 'finish', size: 12 });
  y += 50;
  return y + 10;
}

/* ============================================================
 *  面板 4：员工
 * ========================================================== */
function panelStaff(ctx, x, y, w, s) {
  GFX.card(ctx, x, y, w, 34);
  text(ctx, '👥 我的员工', x + 10, y + 9, { size: 12.5, weight: 800 });
  text(ctx, '出杯位 ' + stationCount(s) + ' 个', x + w - 10, y + 10,
    { size: 10.5, align: 'right', color: T.cyan });
  y += 44;

  var st = s.staff || [];
  if (!st.length) {
    GFX.card(ctx, x, y, w, 36);
    text(ctx, '还没有员工，出杯位只有老板 1 个', x + 10, y + 11, { size: 11, color: T.txt3 });
    y += 46;
  }
  for (var i = 0; i < st.length; i++) {
    var p = st[i];
    var tr = traitById(p.trait);
    GFX.card(ctx, x, y, w, 60);
    text(ctx, p.emoji + ' ' + p.name, x + 10, y + 8, { size: 12, weight: 700 });
    text(ctx, (tr ? tr.emoji + ' ' + tr.name : '无特质') + ' · 日薪 ' + money(p.wage),
      x + 10, y + 26, { size: 10, color: T.txt2 });
    GFX.bar(ctx, x + 10, y + 44, w - 96, 5, num(p.stamina) / 100, { color: T.green });
    text(ctx, '体力 ' + Math.round(num(p.stamina)), x + w - 84, y + 40, { size: 10, color: T.txt3 });
    GFX.button(ctx, x + w - 44, y + 18, 34, 24, '解雇', { kind: 'danger', act: 'fire', id: String(p.id), size: 10, r: 7 });
    y += 68;
  }
  /* 团建：H5 有这个按钮，小游戏原本没有 —— teamBuild() 成了死代码，
     员工体力只能靠随机事件或过天慢慢回。 */
  if (st.length) {
    var tbc = Math.round(180 * (1 + st.length * 0.4));
    GFX.button(ctx, x, y, w, 38, '🎉 团建（全员体力回满）' + money(tbc),
      { kind: 'amber', act: 'teambuild', size: 11.5, disabled: !canAfford(s, tbc), pressed: isPressed('teambuild') });
    y += 48;
  }

  GFX.card(ctx, x, y, w, 34);
  text(ctx, '📋 候选人', x + 10, y + 9, { size: 12.5, weight: 800 });
  y += 44;
  var cd = s.candidates || [];
  for (var j = 0; j < cd.length; j++) {
    var c = cd[j];
    var ct = traitById(c.trait);
    GFX.card(ctx, x, y, w, 54);
    text(ctx, c.emoji + ' ' + c.name, x + 10, y + 8, { size: 12, weight: 700 });
    text(ctx, (ct ? ct.emoji + ' ' + ct.name : '') + ' · 技能 ' + c.skill + ' · 日薪 ' + money(c.wage),
      x + 10, y + 27, { size: 10, color: T.txt2 });
    GFX.button(ctx, x + w - 76, y + 14, 66, 26, '雇佣 ' + money(c.fee), {
      kind: 'primary', act: 'hire', id: String(j),
      /* 只校验聘用费：hireStaff() 也只扣 fee，多算一个 wage 会让能雇的人变灰 */
      disabled: !canAfford(s, c.fee), size: 10, r: 8,
    });
    y += 62;
  }
  return y + 10;
}

/* ============================================================
 *  面板 5：商圈
 * ========================================================== */
function panelRival(ctx, x, y, w, s) {
  var rv = s.rival || {};
  var share = num(rivalShare(s));
  GFX.card(ctx, x, y, w, 96);
  text(ctx, '🏙️ 商圈争夺', x + 10, y + 9, { size: 12.5, weight: 800 });
  text(ctx, (rv.emoji || '🦑') + ' ' + (rv.name || '竞争对手'), x + 10, y + 28,
    { size: 13, weight: 800, color: T.pink });
  text(ctx, '抢走客流 ' + Math.round(share * 100) + '%', x + w - 10, y + 28,
    { size: 11, align: 'right', color: share > 0.15 ? T.red : T.txt2 });
  GFX.bar(ctx, x + 10, y + 52, w - 20, 8, share / 0.4, { color: T.pink });
  /* rival 上没有 cash 字段（只有 rep / aggro / proof），写上去恒显示 ¥0 */
  text(ctx, '声望 ' + Math.round(num(rv.rep)) + ' · 护城河 Lv.' + num(rv.proof),
    x + 10, y + 68, { size: 10.5, color: T.txt3 });
  y += 106;

  for (var i = 0; i < RIVAL_ACTIONS.length; i++) {
    var a = RIVAL_ACTIONS[i];
    GFX.card(ctx, x, y, w, 58);
    text(ctx, a.emoji + ' ' + a.name, x + 10, y + 8, { size: 12, weight: 700 });
    text(ctx, a.desc, x + 10, y + 27, { size: 10, color: T.txt3, maxW: w - 100 });
    GFX.button(ctx, x + w - 84, y + 16, 74, 26, money(a.cost), {
      kind: 'primary', act: 'rivalact', id: a.id,
      disabled: !canAfford(s, a.cost), size: 10, r: 8,
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
  text(ctx, '🏅 成就', x + 10, y + 9, { size: 12.5, weight: 800 });
  text(ctx, got + '/' + ACHIEVEMENTS.length, x + w - 10, y + 10,
    { size: 11, align: 'right', color: T.amber });
  y += 44;

  var cols = 3, cw = (w - 8 * (cols - 1)) / cols;
  for (var i = 0; i < ACHIEVEMENTS.length; i++) {
    var a = ACHIEVEMENTS[i];
    var on = !!s.ach[a.id];
    var cx = x + (i % cols) * (cw + 8);
    var cy = y + Math.floor(i / cols) * 68;
    GFX.fillRR(ctx, cx, cy, cw, 60, 12,
      on ? 'rgba(255,194,71,.14)' : T.card,
      on ? 'rgba(255,194,71,.5)' : T.line);
    text(ctx, a.emoji, cx + cw / 2, cy + 6, { size: 20, align: 'center' });
    text(ctx, a.name, cx + cw / 2, cy + 30, { size: 10, weight: 700, align: 'center', color: on ? T.amber : T.txt3, maxW: cw - 6 });
    text(ctx, on ? '+' + a.reward.bp + '★' : a.desc, cx + cw / 2, cy + 44, { size: 8.5, align: 'center', color: T.txt3, maxW: cw - 6 });
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
function drawStage(ctx, L, s) {
  var W = L.W, top = L.bodyY, H = L.H - top;
  var sim = s.sim;
  var x = 16, w = W - 32;
  var y = top + 10;

  /* 时间条 */
  GFX.bar(ctx, x, y + 10, w, 7, num(sim.t) / num(sim.duration), { color: T.cyan });
  var tb = sim.paused ? '⏸ 已暂停' : (sim.closing ? '🔔 打烊清场中…'
    : '营业中 ' + Math.max(0, Math.ceil(num(sim.duration) - num(sim.t))) + 's');
  text(ctx, tb, x + w / 2, y - 2, { size: 11, align: 'center', color: T.txt2 });
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
    text(ctx, live[i].k, x + i * (lw + 6) + lw / 2, y + 4, { size: 9, align: 'center', color: T.txt3 });
    text(ctx, live[i].v, x + i * (lw + 6) + lw / 2, y + 16,
      { size: 14, weight: 800, align: 'center', color: live[i].c, maxW: lw - 6 });
  }
  y += 48;

  /* 队列 */
  text(ctx, '🚶 排队中 ' + (sim.queue || []).length + '/' + queueCap(s), x, y, { size: 11, color: T.txt3 });
  y += 18;
  var q = sim.queue || [];
  var qw = 46, per = Math.max(1, Math.floor((w + 6) / (qw + 6)));
  for (var qi = 0; qi < q.length; qi++) {
    var c = q[qi];
    var cx = x + (qi % per) * (qw + 6);
    var cy = y + Math.floor(qi / per) * 58;
    var r = recipeById(c.rid) || { emoji: '🥤' };
    GFX.fillRR(ctx, cx, cy, qw, 50, 10, T.card, T.line);
    text(ctx, c.face || '🙂', cx + qw / 2, cy + 2, { size: 17, align: 'center' });
    text(ctx, r.emoji, cx + qw / 2, cy + 24, { size: 11, align: 'center' });
    var left = 1 - num(c.wait) / Math.max(0.001, num(c.patience));
    GFX.bar(ctx, cx + 4, cy + 42, qw - 8, 4, left, { color: left < 0.3 ? T.red : T.green });
  }
  y += Math.ceil(q.length / per) * 58 + (q.length ? 6 : 0);

  /* 出杯位 —— 核心交互区 */
  var stn = sim.stations || [];
  var cols = 2;
  var sw = (w - 10) / cols;
  var sh = 76;
  for (var si = 0; si < stn.length; si++) {
    var st = stn[si];
    var sx = x + (si % cols) * (sw + 10);
    var sy = y + Math.floor(si / cols) * (sh + 8);
    if (sy + sh > L.H - 96) break;
    var busy = !!st.order;
    GFX.fillRR(ctx, sx, sy, sw, sh, 12,
      busy ? 'rgba(53,229,240,.10)' : T.card,
      busy ? 'rgba(53,229,240,.4)' : T.line);
    var nm = st.isBoss ? '👑 老板' : (st.branch ? '🏪 分店位'
      : (st.worker ? st.worker.emoji + ' ' + st.worker.name : '空位'));
    text(ctx, nm, sx + 8, sy + 6, { size: 10.5, weight: 700, color: T.txt, maxW: sw - 16 });
    if (st.order) {
      var rr = recipeById(st.order.rid) || { emoji: '🥤', tags: [] };
      var n = num(st.order.cups, 1);
      text(ctx, n > 1 ? rr.emoji + '×' + n : rr.emoji, sx + sw / 2, sy + 22, { size: 17, align: 'center' });
      GFX.bar(ctx, sx + 8, sy + 46, sw - 16, 6, num(st.order.progress), { color: T.cyan });
      var hit = (rr.tags || []).indexOf(s.trend) >= 0;
      text(ctx, '¥' + Math.round(num(st.order.price) * n) + (hit ? ' 🔥' : ''),
        sx + sw / 2, sy + 56, { size: 10, align: 'center', color: hit ? T.amber : T.txt2 });
    } else {
      text(ctx, '—', sx + sw / 2, sy + 24, { size: 15, align: 'center', color: T.txt3 });
      text(ctx, st.worker && num(st.worker.stamina) <= 0 ? '😴 累瘫' : '空闲',
        sx + sw / 2, sy + 46, { size: 10, align: 'center', color: T.txt3 });
    }
    /* 整个出杯位都是可点区域：手指不需要瞄准小控件 */
    GFX.addHit(sx, sy, sw, sh, 'rush', String(si), null);
  }
  y += Math.ceil(stn.length / cols) * (sh + 8);

  /* 操作按钮 */
  var by = L.H - 92 - L.padBottom;
  var bw = (w - 12) / 2;
  GFX.button(ctx, x, by, bw, 42,
    num(sim.rushCd) > 0 ? '⚡ 大招 (' + Math.ceil(num(sim.rushCd)) + 's)' : '⚡ 老板上阵',
    { kind: 'rush', act: 'boss', disabled: num(sim.rushCd) > 0, size: 12 });
  GFX.button(ctx, x + bw + 12, by, bw, 42, sim.paused ? '▶ 继续' : '⏸ 暂停',
    { kind: 'ghost', act: 'pause', size: 12 });
  GFX.button(ctx, x, by + 48, bw, 38, '🚚 紧急进货', { kind: 'ghost', act: 'restock', size: 11.5 });
  GFX.button(ctx, x + bw + 12, by + 48, bw, 38, '🔔 提前打烊', { kind: 'ghost', act: 'closeearly', size: 11.5 });
}

/* ============================================================
 *  弹窗
 * ========================================================== */
function drawModal(ctx, L) {
  if (!VIEW.modal) return;
  var W = L.W, H = L.H;
  var m = VIEW.modal;
  var fn = MODALS[m.type];
  if (!fn) return;
  var box = GFX.sheet(ctx, W, H, 60, H - 40);
  GFX.clipPush(ctx, box.x, box.y, box.w, box.h);
  fn(ctx, box, m);
  GFX.clipPop(ctx);
  /* 事件弹窗不给 ×：step() 每帧都会重建它，给了 × 就是「关掉→下一帧又弹出来」，
     看起来像按钮失灵。H5 的 showEvent() 同样锁死，必须选一个选项。 */
  if (m.type !== 'event' && m.type !== 'report') {
    GFX.cardBtn(ctx, box.x + box.w - 34, box.y + 14, 20, 20, [{ t: '×', size: 16 }],
      { act: 'close', r: 10 });
  }
}

var MODALS = {};

/* 经营报表 */
MODALS.report = function (ctx, b, m) {
  var s = S();
  var x = b.x + 14, w = b.w - 28;
  var y = b.y + 14;
  text(ctx, '📊 Day ' + m.day + ' 结算', x, y, { size: 15, weight: 900 });
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
    text(ctx, items[i].k, ix + 8, iy + 5, { size: 9.5, color: T.txt3 });
    text(ctx, items[i].v, ix + 8, iy + 19, { size: 12.5, weight: 800, color: items[i].c, maxW: cw - 16 });
  }
  y += Math.ceil(items.length / cols) * 44 + 8;

  var advs2 = adviceOf(s) || [];
  if (advs2.length) {
    GFX.fillRR(ctx, x, y, w, 34, 10, 'rgba(255,194,71,.10)', 'rgba(255,194,71,.3)');
    text(ctx, '📌 ' + (advs2[0].icon || '') + ' ' + (advs2[0].text || ''), x + 10, y + 11,
      { size: 10.5, color: T.amber, maxW: w - 20 });
    y += 44;
  }
  /* 按钮写的是「即将进入的那一天」。写 s.day 会让玩家以为这一天还没过去。 */
  GFX.button(ctx, x, y, w, 40, '🌅 进入 Day ' + (num(s.day) + 1), { kind: 'primary', act: 'nextday', size: 13 });
};

/* 经营报表（备货阶段从 HUD 的 📈 进入）。
   必须和 MODALS.report 分开：report 底部固定有一个「进入 Day N」按钮，
   复用它会让「备货时看一眼曲线」直接 nextDay() 跳过整天 —— 不结算房租工资、
   不产生营收，反复点还能一路刷到 Day 31 触发收官。 */
MODALS.chart = function (ctx, b, m) {
  var s = S();
  var x = b.x + 14, w = b.w - 28;
  var y = b.y + 14;
  text(ctx, '📈 经营报表', x, y, { size: 15, weight: 900 });
  text(ctx, 'Day ' + num(s.day) + ' · 净资产 ' + money(netWorth(s)), x + w, y + 2,
    { size: 10.5, align: 'right', color: T.txt3 });
  y += 28;

  var rows = (s.history || []).slice(-14);
  if (rows.length < 2) {
    text(ctx, '还没有足够的数据 —— 打烊两天后这里就会出现曲线。', x, y + 16,
      { size: 11.5, color: T.txt3, maxW: w });
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
    text(ctx, items[i].k, ix + 8, iy + 5, { size: 9.5, color: T.txt3 });
    text(ctx, items[i].v, ix + 8, iy + 19, { size: 12.5, weight: 800, color: items[i].c, maxW: cw - 16 });
  }
};

/* 随机事件 */
MODALS.event = function (ctx, b, m) {
  var s = S();
  var ev = s.pendingEvent;
  if (!ev) return;
  var x = b.x + 14, w = b.w - 28;
  var y = b.y + 14;
  text(ctx, (ev.emoji || '📌') + ' ' + (ev.title || '突发事件'), x, y, { size: 15, weight: 900 });
  y += 26;
  y += para(ctx, ev.text || '', x, y, { size: 12, color: T.txt2, maxW: w, lineH: 18 }) + 10;
  for (var i = 0; i < (ev.options || []).length; i++) {
    var o = ev.options[i];
    GFX.button(ctx, x, y, w, 42, o.label,
      { kind: i === 0 ? 'primary' : 'ghost', act: 'eventopt', id: String(i), size: 12 });
    y += 50;
  }
};

/* 玩法说明 */
MODALS.help = function (ctx, b, m) {
  var x = b.x + 14, w = b.w - 28;
  var y = b.y + 12;
  text(ctx, '📖 玩法说明', x, y, { size: 15, weight: 900 });
  y += 24;
  var secs = [
    ['🎯 目标', '30 天内把净资产做到目标金额即通关；现金连续 2 天为负则破产。'],
    ['🔁 每天流程', '① 进货（原料价格每日波动，低价囤货 = 纯利润）\n② 配菜单与定价（倍率 0.9~1.1 最稳）\n③ 开门营业（26 秒实时经营，点出杯位可加速，还有小费和连击）\n④ 结算（满意率决定口碑，口碑决定客流）\n⑤ 投资（升级 / 研发 / 招人 / 开分店）'],
    ['👥 客群', '顾客分 5 类：学生党 / 打工人 / 网红 / 家庭客 / 街坊长辈，口味偏好、价格容忍度、耐心、单次杯数都不同。'],
    ['🏙️ 竞争', '隔壁会抢客流，去「🏙️ 商圈」用挖角 / 营销压制 / 差异化反击。'],
    ['💡 核心策略', '产能与客流的赛跑：客流涨太快而产能不够，客人会流失、口碑暴跌。出杯位 = 员工数 + 分店数 + 1。'],
    ['⌨️ 小技巧', '连点同一出杯位可叠加连击，小费最高翻倍；命中当日流行标签销量 +55%。'],
  ];
  for (var i = 0; i < secs.length; i++) {
    text(ctx, secs[i][0], x, y, { size: 12, weight: 800, color: T.amber });
    y += 18;
    y += para(ctx, secs[i][1], x, y, { size: 11, color: T.txt2, maxW: w, lineH: 16 }) + 10;
  }
  /* 音效开关 */
  GFX.button(ctx, x, y, w, 38,
    (VIEW.sound ? '🔊 音效：开' : '🔇 音效：关'),
    { kind: 'ghost', act: 'sound', size: 12 });
};

/* 平台福利中心：侧边栏复访 / 加桌面 / 订阅消息 / 激励广告 / 内购 */
MODALS.gift = function (ctx, b, m) {
  var s = S();
  var x = b.x + 14, w = b.w - 28;
  var y = b.y + 14;
  text(ctx, '🎁 每日福利', x, y, { size: 15, weight: 900 });
  y += 24;
  y += para(ctx, '来自抖音官方能力。未开通的项目不会显示在这里，'
    + '也不会向你要任何与本局无关的权限。', x, y,
    { size: 10, color: T.txt3, maxW: w, lineH: 15 }) + 8;

  var row = function (emoji, title, sub, btn, act, id, kind, off) {
    GFX.fillRR(ctx, x, y, w, 54, 12, T.card, T.line);
    text(ctx, emoji, x + 11, y + 16, { size: 18 });
    text(ctx, title, x + 38, y + 8, { size: 12.5, weight: 800, maxW: w - 130 });
    text(ctx, sub, x + 38, y + 27, { size: 10, color: T.txt2, maxW: w - 130 });
    if (btn) {
      GFX.button(ctx, x + w - 100, y + 11, 90, 32, btn,
        { kind: kind || 'ghost', act: act, id: id, size: 11, disabled: !!off });
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
  text(ctx, '🚚 紧急进货', x, y, { size: 15, weight: 900 });
  text(ctx, '价格 ×' + CFG.RESTOCK_MARKUP.toFixed(2) + '，立即到货', x + w, y + 2,
    { size: 10, align: 'right', color: T.txt3 });
  y += 28;
  for (var i = 0; i < ING.length; i++) {
    var g = ING[i];
    var p = Math.round((num(s.prices[g.id]) || g.base) * CFG.RESTOCK_MARKUP);
    GFX.fillRR(ctx, x, y, w, 38, 10, T.card, T.line);
    text(ctx, g.emoji + ' ' + g.name, x + 10, y + 11, { size: 11.5 });
    text(ctx, '¥' + p + '/份', x + 130, y + 12, { size: 10.5, color: T.amber });
    for (var q = 0; q < 3; q++) {
      var amt = [10, 30, 60][q];
      GFX.button(ctx, x + w - 10 - (2 - q) * 60 - 48, y + 8, 52, 22, '+' + amt,
        { kind: 'ghost', act: 'rbug', id: g.id, extra: amt, size: 10, r: 7 });
    }
    y += 44;
  }
};

/* 确认类 */
MODALS.confirm = function (ctx, b, m) {
  var x = b.x + 14, w = b.w - 28;
  var y = b.y + 16;
  text(ctx, m.title || '确认', x + w / 2, y, { size: 16, weight: 900, align: 'center' });
  y += 28;
  y += para(ctx, m.text || '', x + w / 2 - (w / 2), y,
    { size: 12, color: T.txt2, maxW: w, align: 'center', lineH: 18 }) + 8;
  GFX.button(ctx, x, y, (w - 10) / 2, 42, m.okText || '确认',
    { kind: m.okKind || 'amber', act: m.okAct, size: 12.5 });
  GFX.button(ctx, x + (w - 10) / 2 + 10, y, (w - 10) / 2, 42, '再想想',
    { kind: 'ghost', act: 'close', size: 12.5 });
};

/* 导入存档 */
MODALS.import = function (ctx, b, m) {
  var x = b.x + 14, w = b.w - 28;
  var y = b.y + 14;
  text(ctx, '📥 导入存档', x, y, { size: 15, weight: 900 });
  y += 26;
  y += para(ctx, '抖音小游戏内没有输入框。请先在浏览器版（或备忘录）里复制存档码，'
    + '再回到本页点下方按钮从剪贴板读取。', x, y, { size: 11, color: T.txt2, maxW: w, lineH: 17 }) + 12;
  GFX.button(ctx, x, y, w, 42, '📋 从剪贴板导入', { kind: 'primary', act: 'doimport', size: 12.5 });
  y += 52;
  if (VIEW.importMsg) {
    text(ctx, VIEW.importMsg, x, y, { size: 11, color: T.txt2, maxW: w });
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
  text(ctx, m.title || '目标达成', W / 2, y, { size: 24, weight: 900, align: 'center' });
  y += 34;
  text(ctx, m.grade || 'B', W / 2, y, { size: 44, weight: 900, align: 'center', color: T.amber });
  y += 54;
  y += para(ctx, m.sub || '', x, y, { size: 12, color: T.txt2, maxW: w, lineH: 18 }) + 16;

  var its = m.items || [];
  var cw = (w - 8) / 2;
  for (var i = 0; i < its.length; i++) {
    var ix = x + (i % 2) * (cw + 8), iy = y + Math.floor(i / 2) * 40;
    GFX.fillRR(ctx, ix, iy, cw, 34, 10, T.card, T.line);
    text(ctx, its[i].k, ix + 8, iy + 9, { size: 9.5, color: T.txt3 });
    text(ctx, its[i].v, ix + cw - 8, iy + 9, { size: 11.5, weight: 700, align: 'right', color: T.amber });
  }
  y += Math.ceil(its.length / 2) * 40 + 12;

  var by = Math.min(H - 108, y + 8);
  /* 无尽入口：H5 在结局页有一张「♾️ 继续经营」卡，小游戏原本没有，
     导致 startEndless() 在这版没有任何调用点 —— 无尽模式彻底不可达。 */
  if ((VIEW.end || {}).kind !== 'bankrupt') {
    GFX.fillRR(ctx, x, by, w, 44, 12, 'rgba(53,229,240,.10)', 'rgba(53,229,240,.34)');
    text(ctx, '♾️ 无尽模式 · 目标持续升级', x + 12, by + 14, { size: 12, weight: 800, color: T.cyan });
    GFX.button(ctx, x + w - 96, by + 8, 84, 28, '继续经营',
      { kind: 'cyan', act: 'endless', size: 11, r: 9, pressed: isPressed('endless') });
    by += 52;
  }
  GFX.button(ctx, x, by, w, 44, '🔄 再来一局', { kind: 'primary', act: 'again', size: 14 });
  GFX.button(ctx, x, by + 52, w, 40, '🏠 回到主菜单', { kind: 'ghost', act: 'home', size: 12.5 });
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
    var y = 60 + i * 34;
    ctx.font = '700 12px ' + FONT;
    var tw = ctx.measureText(t.msg).width + 24;
    GFX.fillRR(ctx, (W - tw) / 2, y, tw, 26, 13, 'rgba(38,18,68,.94)', T.line2);
    text(ctx, t.msg, W / 2, y + 7, { size: 12, weight: 700, align: 'center', color: 'white' });
    ctx.globalAlpha = 1;
  }
}

function drawFloaters(ctx, L) {
  for (var i = 0; i < VIEW.floaters.length; i++) {
    var f = VIEW.floaters[i];
    ctx.globalAlpha = Math.max(0, f.life / 800);
    text(ctx, f.text, f.x, f.y - (800 - f.life) / 26,
      { size: 13, weight: 800, align: 'center', color: f.kind === 'bad' ? T.red : T.green });
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
  var ch = 150;
  var cy = H - ch - 24 - L.padBottom;
  GFX.fillRR(ctx, 16, cy, W - 32, ch, 18, T.bg2, T.line2);
  text(ctx, (VIEW.tut.step + 1) + '/' + TUTORIAL.length, 30, cy + 12, { size: 10, color: T.txt3 });
  text(ctx, step.title, 30, cy + 26, { size: 14, weight: 900, color: T.txt, maxW: W - 70 });
  para(ctx, step.text.replace(/<br>/g, ' ').replace(/<[^>]+>/g, ''), 30, cy + 48,
    { size: 11.5, color: T.txt2, maxW: W - 70, lineH: 17 });
  GFX.button(ctx, 30, cy + ch - 46, (W - 78) / 2, 36, '跳过引导', { kind: 'ghost', act: 'tutskip', size: 11.5 });
  GFX.button(ctx, 30 + (W - 78) / 2 + 16, cy + ch - 46, (W - 78) / 2, 36, '下一步 →',
    { kind: 'primary', act: 'tutnext', size: 11.5 });
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
