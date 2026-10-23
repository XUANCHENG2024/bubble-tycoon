'use strict';
/* ============================================================
 *  Canvas 绘制基础层
 *
 *  Canvas 没有 DOM 的排版能力 —— 没有换行、没有滚动、没有命中检测。
 *  这套东西必须自己造，否则业务代码里会到处是手算坐标，改一处崩一片。
 *  本文件提供三样东西：
 *    1. 图形原语（圆角矩形 / 卡片 / 进度条 / 渐变）
 *    2. 中文可用的自动换行文本
 *    3. 命中区域登记 + 裁剪栈（滚动列表里点按钮不会穿到列表外面去）
 *  业务层只管「画什么」，坐标与命中都由这里兜住。
 * ============================================================ */

/* 与 H5 版 :root 变量一一对应，保证两版视觉语言一致 */
var T = {
  bg0: '#140726', bg1: '#22103f', bg2: '#2c1450',
  card: 'rgba(255,255,255,.07)', card2: 'rgba(255,255,255,.11)',
  line: 'rgba(255,255,255,.12)', line2: 'rgba(255,255,255,.22)',
  txt: '#f4eeff', txt2: '#c3b6e0', txt3: '#8f82ad',
  pink: '#ff4d9d', purple: '#8b5cff', cyan: '#35e5f0',
  amber: '#ffc247', green: '#4ade80', red: '#ff5f6d',
};

var FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';

/* ------------------------------------------------------------
 *  字号令牌 —— 与 H5 端 styles.css 的 --fs-* 一一对应
 * ------------------------------------------------------------
 *  ★ 为什么 Canvas 端也要令牌：
 *    Canvas 端以前直接写字面量（size: FS.xs / 9 / 9.5 / 10 / 10.5 …），
 *    同一语义在不同文件里字号不同 —— 跨版本切换时字号会跳变。
 *    尤其 8.5/9px 那批已提到 10px（中文可读性下限），
 *    若没有令牌，下次加内容时很容易又写回 9px。
 *
 *  ★ 命名与数值必须与 styles.css 的 :root 完全一致：
 *      --fs-xs: 10px  --fs-sm: 11px  --fs-md: 12px
 *      --fs-lg: 14px  --fs-xl: 16px  --fs-display: 22px
 *    两版共用一套分档，才能保证「同一信息两版同样重」。
 * ------------------------------------------------------------
 *
 *  ★★★★★ V20.8：FS 改为 **getter**，由全局缩放系数驱动 ★★★★★
 *
 *  ★★★ 根因：缩放系数形同虚设 ★★★
 *   V20.7 引入了 L.scale（0.94~1.10）用于「按屏幕宽度缩放字号」，
 *   ★ 但只提供了 `fs(L, key)` 这一个入口，
 *   ★ 而全仓 **361 处**直接写 `FS.xs` / `FS.md`（只有 36 处用了 fs(L,...)）。
 *   ★ 也就是说：**95% 的文字根本没有被缩放**。
 *   ★ 后果：
 *     - 320 宽的小屏上，10px 的字仍然 10px → 一行放不下几个字 → 被截断
 *     - 414 宽的大屏上，字还是 10px → 显得小、留白多
 *   ★ 而 L.scale 这个「看起来做了适配」的参数，
 *     实际效果几乎为零 —— 这是比「没做适配」更糟的：
 *     ★ 它让人误以为已经适配过了。
 *
 *  ★★★ 修法：让 FS 本身就是一个「会缩放的令牌表」 ★★★
 *   · FS 的每个键都变成 getter，读取时乘上当前全局缩放系数
 *   · 新增 GFX.setTextScale(s)：由 layoutOf 在每次布局时调用
 *   · ★ 这样 361 处 `FS.xs` 一行不改就自动跟随缩放 ——
 *     ★ **改一处生效全部**，而不是指望 361 个调用点都记得写 fs(L,...)
 *
 *  ★ 为什么 scale 存在 gfx.js 而不是 ui.js：
 *   layoutOf 在 ui.js 里，而 FS 在 gfx.js 里；
 *   ★ 若 scale 存在 ui.js，gfx.js 就拿不到（gfx 先加载）。
 *   ★ 存在 gfx.js，ui.js 通过 GFX.setTextScale() 写进去 —— 依赖方向单一。
 *
 *  ★ 兼容性：FS.xs 等**读取**接口完全不变，
 *   ★ 只有「重新赋值 FS.xs = 12」这种写法会失效（仓库里没有）。
 */
var _textScale = 1;

/** 设置全局字号缩放系数（由 ui.js 的 layoutOf 调用）。 */
function setTextScale(s) {
  var v = Number(s);
  /* ★ 保护：非法值退回 1。
     ★ 缩放系数一旦变成 0 或 NaN，全屏文字会消失 —— 那是灾难级故障。 */
  if (!isFinite(v) || v <= 0.2 || v > 3) v = 1;
  _textScale = v;
}

/** 取当前全局字号缩放系数。 */
function getTextScale() { return _textScale; }

/* ★ 基础字号（未缩放）—— 数值必须与 styles.css 的 :root 完全一致 */
var FS_BASE = {
  xs: 10, sm: 11, md: 12, lg: 14, xl: 16, display: 22,
};

/* ★ FS 是「会缩放的令牌表」——
   每个键都是 getter，读取时才乘上 _textScale。
   ★ 用 defineProperty 而不是对象字面量的 get 语法，
     是为了让 getter 的 enumerable 保持 true（Object.keys 能列全）。 */
var FS = {};
Object.keys(FS_BASE).forEach(function (k) {
  Object.defineProperty(FS, k, {
    enumerable: true,
    configurable: true,
    get: function () {
      var v = FS_BASE[k] * _textScale;
      /* ★ 取整到 0.5px ——
         *   Canvas 的 font 只接受整数时会四舍五入到整数，
         *   但布局计算（宽度预留）用小数更准。
         *   ★ 取整到 0.5 是为了「字号是整数但不至于太糙」的折中。 */
      return Math.round(v * 2) / 2;
    },
  });
});

/* ------------------------------------------------------------
 *  文本
 *  Canvas 的 measureText 逐字调用很贵，缓存一下。
 *  键里带上字号 —— 同一个字在不同字号下宽度不同。
 * ---------------------------------------------------------- */
var _wCache = Object.create(null);
function textW(ctx, str, size, weight) {
  var key = size + '|' + weight + '|' + str;
  var hit = _wCache[key];
  if (hit !== undefined) return hit;
  ctx.font = (weight || 400) + ' ' + size + 'px ' + FONT;
  var w = ctx.measureText(str).width;
  /* 缓存无上限会让长文本把内存吃穿，到量就整表丢弃（最朴素的策略，够用） */
  if (Object.keys(_wCache).length > 4000) _wCache = Object.create(null);
  _wCache[key] = w;
  return w;
}

/**
 * 剥掉 HTML 标签，返回纯文本。
 * 引擎里 adviceOf() 与 TUTORIAL 的文案是写给 H5 的 innerHTML 的（带 <b> / <br>），
 * 而 Canvas 的 fillText 不认识标签 —— 不剥的话玩家每天都会在「今日建议」和
 * 日报弹窗里看到一串 "</b>" 之类的乱码。三处渲染点共用这一个实现。
 */
function plainText(s) {
  return String(s == null ? '' : s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '');
}

/**
 * 按最大宽度断行。
 * 中文没有空格，必须逐字量；英文/数字则先按空格切词，避免把单词从中间劈开。
 */
function wrapText(ctx, str, size, weight, maxW) {
  str = String(str == null ? '' : str);
  if (!str) return [];
  if (textW(ctx, str, size, weight) <= maxW) return [str];

  var lines = [], cur = '';
  var flush = function () { if (cur) { lines.push(cur); cur = ''; } };

  /* 先按空格切成片段，中文片段会变成单字（因为没有空格可切） */
  var parts = str.split(' ');
  for (var i = 0; i < parts.length; i++) {
    var seg = parts[i];
    var isAscii = /^[\x20-\x7E]*$/.test(seg);
    if (isAscii) {
      var trial = cur ? cur + ' ' + seg : seg;
      if (textW(ctx, trial, size, weight) <= maxW) { cur = trial; }
      else { flush(); cur = seg; }
    } else {
      for (var c = 0; c < seg.length; c++) {
        var ch = seg[c];
        if (textW(ctx, cur + ch, size, weight) > maxW) flush();
        cur += ch;
      }
      if (i < parts.length - 1) {
        var t2 = cur + ' ';
        if (textW(ctx, t2, size, weight) > maxW) flush(); else cur = t2;
      }
    }
  }
  flush();
  return lines.length ? lines : [''];
}

/** 画一段会自动换行的文本，返回实际占用的高度 */
function para(ctx, str, x, y, o) {
  o = o || {};
  var size = o.size || 13;
  var lh = o.lineH || Math.round(size * 1.55);
  var lines = wrapText(ctx, str, size, o.weight || 400, o.maxW || 9999);
  ctx.font = (o.weight || 400) + ' ' + size + 'px ' + FONT;
  ctx.fillStyle = o.color || T.txt2;
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = 'top';
  for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i], x, y + i * lh);
  return lines.length * lh;
}

/** 单行文本（不换行、可截断） */
function text(ctx, str, x, y, o) {
  o = o || {};
  var size = o.size || 13;
  ctx.font = (o.weight || 400) + ' ' + size + 'px ' + FONT;
  ctx.fillStyle = o.color || T.txt;
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = o.baseline || 'top';
  var s = String(str == null ? '' : str);
  /* ★ V20.8 修正：maxW 的存在性判断不能用 `o.maxW &&` ——
   *   maxW=0 时它是 falsy → **完全不截断** → 文字直接画出容器。
   *   （单元测试 tools/test-text-truncate.js 抓到的真实缺陷。）
   *   这里显式区分「没给 maxW」与「maxW 就是一个很小的数」。 */
  var hasMaxW = (o.maxW !== undefined && o.maxW !== null);
  var maxW = hasMaxW ? Math.max(0, Number(o.maxW)) : 0;
  if (hasMaxW && textW(ctx, s, size, o.weight || 400) > maxW) {
    /* ★★ 截断：二分查找最长可容纳的前缀 ★★
     * ★ 原来是从尾部逐字符删（while + slice）——
     *   每次都重新 measureText，一次截断是 O(n²) 次测量；
     *   而且每个中间结果都会进 textW 的缓存（key 含完整字符串），
     *   4000 条上限会被瞬间打满 → 缓存整体失效 → 性能塌方。
     * ★ 二分：O(log n) 次测量，缓存条目也只多 O(log n) 条。
     *
     * ★★★★ V20.8：三处执行顺序修正（这是被单元测试抓到的真缺陷）★★★★
     * ★ 原来的顺序是「①按 maxW 二分 → ②回退到空格 → ③为「…」腾空间再砍尾」
     *   —— 顺序错了：
     *   ★ ③ 从尾部砍字符，把 ② 刚做好的词边界又砍掉了
     *     （"welcome to bubble" 被砍成 "welcome to bubbl…" —— 半个单词）。
     *   ★ 而且 ① 的预算里**没有扣掉「…」的宽度**，
     *     导致结果必然超宽，要靠 ③ 事后补救 → 补救又破坏了 ②。
     * ★ 现在的正确顺序：
     *   ① 先算出「…」占多少宽度，从预算里**先扣掉**
     *   ② 二分找「正文 + …」都能放下的最长前缀
     *   ③ 只有在断点落在英文单词中间、且那个单词很短（≤12 字符）时才回退到空格
     *      —— 回退会丢信息，丢太多（>40%）反而比断词更糟，所以要克制
     */
    var weight = o.weight || 400;
    var ellW = textW(ctx, '\u2026', size, weight);
    /* 连「…」都放不下 → 什么都不画（画半个省略号更糟） */
    if (ellW > maxW) {
      s = '';
    } else {
      /* ★ 预算 = maxW − 「…」宽度（先扣，再二分） */
      var budget = maxW - ellW;
      var lo = 0, hi = s.length - 1, best = 0;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (textW(ctx, s.slice(0, mid), size, weight) <= budget) {
          best = mid; lo = mid + 1;
        } else { hi = mid - 1; }
      }
      var cut = s.slice(0, best);
      /* ★ 词边界回退：只有「断点确实落在英文单词中间」且「被切掉的尾词很短」时才回退。
         ★ 尾词 > 12 字符 → 不回退（宁可断词也别丢掉一大半内容）。 */
      if (cut.length > 0 && cut.charAt(cut.length - 1) !== ' ') {
        var sp = cut.lastIndexOf(' ');
        var tailLen = cut.length - (sp + 1);
        if (sp > 0 && tailLen <= 12) cut = cut.slice(0, sp);
      }
      /* ★ 去掉尾部多余空格（"welcome to " + "…" → "welcome to…"） */
      cut = cut.replace(/\s+$/, '');
      s = cut + '\u2026';
    }
  }
  ctx.fillText(s, x, y);
  return size * 1.4;
}

/* ------------------------------------------------------------
 *  图形原语
 * ---------------------------------------------------------- */
/** roundRect 是较新 API（Chrome 99+/Safari 16.4+），老环境必须降级为直角 */
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  if (r < 0) r = 0;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fillRR(ctx, x, y, w, h, r, fill, stroke) {
  rr(ctx, x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

/** 卡片：本作的视觉基调就是半透明玻璃卡片 */
function card(ctx, x, y, w, h, opt) {
  opt = opt || {};
  fillRR(ctx, x, y, w, h, opt.r || 14, opt.bg || T.card, opt.border || T.line);
}

/** 进度条 / 血条：统一夹在 0~1，脏数值不会撑破布局 */
function bar(ctx, x, y, w, h, v, o) {
  o = o || {};
  var p = Math.max(0, Math.min(1, isFinite(v) ? v : 0));
  fillRR(ctx, x, y, w, h, h / 2, 'rgba(255,255,255,.12)');
  if (p > 0) {
    fillRR(ctx, x, y, Math.max(h, w * p), h, h / 2, o.color || T.cyan);
  }
}

/** 数字胶囊（HUD 里的 DAY / 现金 / 口碑 / 净资产） */
function chip(ctx, x, y, w, h, label, value, color) {
  fillRR(ctx, x, y, w, h, 10, T.card, T.line);
  text(ctx, label, x + 8, y + 4, { size: FS.xs, color: T.txt3 });
  text(ctx, value, x + 8, y + 15, { size: FS.lg, weight: 800, color: color || T.txt, maxW: w - 16 });
}

/* ------------------------------------------------------------
 *  命中区域 + 裁剪栈
 *  滚动列表里的按钮如果不做裁剪，手指点在列表外的位置也会误触。
 * ---------------------------------------------------------- */
var HIT = { list: [], stack: [], offY: 0 };

function hitReset() { HIT.list = []; HIT.stack = []; }

/* 弹窗滚动偏移：内容比弹窗高时（如玩法说明 8 节），drawModal 会
   ctx.translate(0, -scroll) 上移绘制。但 addHit 记录的是绝对坐标，
   translate 对它无效 —— 不跟着偏移的话，滚动后按钮画在 A 处、点 B 处才命中。
   drawModal 在调用弹窗绘制器前后 set / clear 这个值。 */
function setHitOffset(dy) { HIT.offY = dy || 0; }

/** 进入裁剪区（同时压栈，供绘制与命中两侧共同使用） */
function clipPush(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  HIT.stack.push({ x: x, y: y, w: w, h: h });
}
function clipPop(ctx) {
  ctx.restore();
  HIT.stack.pop();
}

function addHit(x, y, w, h, act, id, extra) {
  y += HIT.offY;   /* 弹窗滚动时命中区跟着内容一起走（见 setHitOffset） */
  for (var i = 0; i < HIT.stack.length; i++) {
    var c = HIT.stack[i];
    var nx = Math.max(x, c.x), ny = Math.max(y, c.y);
    var mx = Math.min(x + w, c.x + c.w), my = Math.min(y + h, c.y + c.h);
    if (mx <= nx || my <= ny) return;   /* 完全被裁掉，不登记 */
    x = nx; y = ny; w = mx - nx; h = my - ny;
  }
  HIT.list.push({ x: x, y: y, w: w, h: h, act: act, id: id, extra: extra });
}

function hitAt(px, py) {
  /* 从后往前找：后登记的画在上面，应当优先命中 */
  for (var i = HIT.list.length - 1; i >= 0; i--) {
    var r = HIT.list[i];
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r;
  }
  return null;
}

/* ------------------------------------------------------------
 *  按钮
 * ---------------------------------------------------------- */
var BTN_STYLE = {
  primary: { bg: [T.pink, T.purple], fg: '#fff' },
  amber: { bg: ['#f59e0b', T.amber], fg: '#3a2400' },
  ghost: { bg: null, fg: T.txt },
  rush: { bg: ['#ff8a00', T.amber], fg: '#452200' },
  danger: { bg: [T.red, '#ff8a9c'], fg: '#fff' },
};

/** 画按钮并登记命中。返回按钮矩形，方便调用方接着排下一个元素 */
function button(ctx, x, y, w, h, label, o) {
  o = o || {};
  var st = BTN_STYLE[o.kind || 'ghost'] || BTN_STYLE.ghost;
  var disabled = !!o.disabled;

  if (st.bg && !disabled) {
    var g = ctx.createLinearGradient(x, y, x + w, y);
    g.addColorStop(0, st.bg[0]); g.addColorStop(1, st.bg[1]);
    fillRR(ctx, x, y, w, h, o.r || 11, g);
  } else {
    fillRR(ctx, x, y, w, h, o.r || 11,
      disabled ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.10)',
      disabled ? 'rgba(255,255,255,.06)' : T.line);
  }
  /* 按下态：给一层白色蒙版，手指点下去要有反馈，否则 canvas 界面会显得发死 */
  if (o.pressed) {
    fillRR(ctx, x, y, w, h, o.r || 11, 'rgba(255,255,255,.18)');
  }
  text(ctx, label, x + w / 2, y + (h - (o.size || 13)) / 2 - 1, {
    size: o.size || 13, weight: 700, align: 'center',
    color: disabled ? T.txt3 : (st.fg || T.txt),
    maxW: w - 16,
  });
  /* 命中区垂直兜底：视觉高度不足 30px 的按钮，命中矩形自动扩到 30px
     （上下各补一半）。面板里不少按钮只有 16~24px 高，手指（约 9mm ≈ 34px）
     根本对不准，而把视觉尺寸全改大会牵动布局。只扩命中不扩视觉 = 布局零风险。
     垂直方向行距最小 30px（采购行），上下各补 3px 不会碰到相邻行的命中区。
     水平方向**不做**兜底：采购 +10/+50 之间只有 6px 间隙，扩了会互相重叠。 */
  if (!disabled) {
    var hitH = Math.max(h, 30);
    var hy = y - Math.floor((hitH - h) / 2);
    addHit(x, hy, w, hitH, o.act, o.id, o.extra);
  }
  return { x: x, y: y, w: w, h: h };
}

/** 卡片式按钮：难度选择、存档槽这类带多行内容的 */
function cardBtn(ctx, x, y, w, h, lines, o) {
  o = o || {};
  var on = !!o.on;
  fillRR(ctx, x, y, w, h, o.r || 14,
    on ? 'rgba(53,229,240,.10)' : T.card,
    on ? 'rgba(53,229,240,.55)' : T.line);
  if (o.pressed) fillRR(ctx, x, y, w, h, o.r || 14, 'rgba(255,255,255,.10)');
  var cy = y + (o.center ? h / 2 - (lines.length * 17) / 2 : 9);
  for (var i = 0; i < lines.length; i++) {
    var L = lines[i];
    text(ctx, L.t, x + w / 2, cy, {
      size: L.size || 12, weight: L.weight || 700, align: 'center',
      color: L.color || T.txt, maxW: w - 12,
    });
    cy += (L.size || 12) * 1.6;
  }
  /* hitPad：命中区四边外扩（视觉不变）。给弹窗右上角的 ×（20×20）用的 ——
     那是全游戏最小的关闭目标，且周围是空白，外扩 5px 不会碰到任何东西。 */
  var pad = o.hitPad || 0;
  addHit(x - pad, y - pad, w + pad * 2, h + pad * 2, o.act, o.id, o.extra);
  return h;
}

/* ------------------------------------------------------------
 *  折线图（经营报表）
 *  与 H5 版 SVG 图表是同一套数据（s.history），只是换了个绘制后端。
 * ---------------------------------------------------------- */
function lineChart(ctx, x, y, w, h, series, days) {
  fillRR(ctx, x, y, w, h, 12, 'rgba(0,0,0,.22)', T.line);
  if (!days || !days.length) {
    text(ctx, '暂无数据', x + w / 2, y + h / 2 - 7, { size: FS.md, align: 'center', color: T.txt3 });
    return;
  }
  var pad = { l: 34, r: 10, t: 12, b: 20 };
  var iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  if (iw <= 4 || ih <= 4) return;

  var max = 1;
  for (var s = 0; s < series.length; s++) {
    for (var d = 0; d < days.length; d++) {
      var v = Math.abs(days[d][series[s].key] || 0);
      if (v > max) max = v;
    }
  }

  /* 网格 + 纵轴刻度 */
  ctx.strokeStyle = 'rgba(255,255,255,.07)';
  ctx.lineWidth = 1;
  for (var g = 0; g <= 3; g++) {
    var gy = pad.t + ih * g / 3;
    ctx.beginPath(); ctx.moveTo(x + pad.l, y + gy); ctx.lineTo(x + w - pad.r, y + gy); ctx.stroke();
    text(ctx, shortNum(max * (3 - g) / 3), x + 4, y + gy - 5,
      { size: FS.xs, color: T.txt3, maxW: pad.l - 8 });
  }

  var n = days.length;
  for (var k = 0; k < series.length; k++) {
    var se = series[k];
    ctx.strokeStyle = se.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var i2 = 0; i2 < n; i2++) {
      var px = x + pad.l + (n === 1 ? iw / 2 : iw * i2 / (n - 1));
      var py = y + pad.t + ih - ih * Math.max(0, (days[i2][se.key] || 0)) / max;
      if (i2 === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    var lx = x + pad.l + (n === 1 ? iw / 2 : iw * (n - 1) / (n - 1));
    var ly = y + pad.t + ih - ih * Math.max(0, (days[n - 1][se.key] || 0)) / max;
    ctx.fillStyle = se.color;
    ctx.beginPath(); ctx.arc(lx, ly, 2.5, 0, Math.PI * 2); ctx.fill();
  }

  /* 横轴：首尾两天 */
  text(ctx, 'D' + days[0].day, x + pad.l, y + h - 14, { size: FS.xs, color: T.txt3 });
  text(ctx, 'D' + days[n - 1].day, x + w - pad.r - 20, y + h - 14, { size: FS.xs, color: T.txt3 });
}

/** 1234 → 1.2k，图表纵轴用得到 */
function shortNum(v) {
  v = Math.abs(Math.round(v));
  if (v >= 10000) return (v / 10000).toFixed(1) + 'w';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
  return String(v);
}

/* ------------------------------------------------------------
 *  弹层：遮罩 + 圆角面板
 * ---------------------------------------------------------- */
function sheet(ctx, W, H, top, bottom, o) {
  o = o || {};
  ctx.fillStyle = 'rgba(8,3,18,.78)';
  ctx.fillRect(0, 0, W, H);
  var h = Math.min(bottom - top, H * 0.86);
  var y = top + (bottom - top - h) / 2;
  var w = Math.min(W - 24, 460);
  var x = (W - w) / 2;
  fillRR(ctx, x, y, w, h, 20, T.bg2, T.line2);
  return { x: x, y: y, w: w, h: h };
}

/* 原来这里有一个 closeX()（画 × 并登记 hit）。全仓零调用 —— 弹窗的 × 是用
   GFX.cardBtn 画的（见 ui.js drawModal），留着一个没人用的副本只会让人以为
   有两套关闭按钮实现。已删。 */

if (typeof globalThis !== 'undefined') {
  globalThis.T = T;
  globalThis.GFX = {
    text: text, para: para, wrapText: wrapText, textW: textW, plainText: plainText,
    rr: rr, fillRR: fillRR, card: card, bar: bar, chip: chip,
    button: button, cardBtn: cardBtn, lineChart: lineChart,
    shortNum: shortNum, sheet: sheet,
    /* ★ V20.8：全局字号缩放（见 FS 的注释）*/
    setTextScale: setTextScale, getTextScale: getTextScale,
    hitReset: hitReset, hitAt: hitAt, addHit: addHit, setHitOffset: setHitOffset,
    clipPush: clipPush, clipPop: clipPop,
    get hits() { return HIT.list; },
  };
}
