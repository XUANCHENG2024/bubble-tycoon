/* ============================================================
 *  等距投影（isometric）基础模块 —— V15
 * ============================================================
 *
 * ★ 为什么单独一个模块：
 *   伪 3D 的难点不在「把方块画歪」，而在**坐标 ↔ 屏幕的双向转换**与
 *   **深度顺序**。这两件事必须有一份唯一的实现 ——
 *   画的时候用一套坐标、点的时候用另一套，偏移一点点就会点不中。
 *   放在独立文件里，画与拾取都从这里取，才不会出现「画在一处、点在另一处」。
 *
 * ★ 投影约定（2:1 等距，即「像素游戏」最经典的角度）：
 *
 *        世界坐标 (gx, gy) —— 地面格子，x 向右、y 向下
 *              │
 *              │  project()
 *              ▼
 *        屏幕 (sx, sy) —— sx = ox + (gx-gy)*TW/2
 *                              sy = oy + (gx+gy)*TH/2 - gz*TZ
 *
 *     ┌─────┐
 *      \  y │    · (1,0) 往右下
 *       \   │   · (0,1) 往左下
 *        └───┘
 *   TW/2：沿 x 的水平偏移；TH/2：沿 x 的垂直偏移（TH = TW*0.5，即 2:1）
 *   TZ：每单位高度的屏幕位移（立方体越高越往上）
 *
 * ★ 为什么选 2:1 而不是 26.57°（真正的等距）：
 *   2:1 的每个方向都落在**整数或半整数像素**上，描边不糊、纹理不抖；
 *   26.57° 会让斜边落在无理数上，低端机上肉眼可见锯齿抖动。
 *
 * ★ 深度（z-order）：
 *   地面上 (gx,gy) 的深度 = gx + gy（越靠近屏幕下方越"靠前"）。
 *   物体自身还要按**底面深度**排 —— 底面在前的物体整块都要画在前，
 *   哪怕它顶部伸得比后面的物体更高（那才是正确的遮挡关系）。
 *   ★ 不按「顶部深度」排：那样一个高箱子会盖住它后面矮箱子的下半部分，
 *     视觉上是错的（真实世界里后面的东西被前面高的部分挡住是对的，
 *     但前面的东西不会因为自己高就往后让）。
 *
 * ★ 性能：深度排序**不逐帧重排**。
 *   本作的场景是「静态布局 + 少量动态元素」，每帧全量 sort 在
 *   工位十几个 + 顾客十几人的规模下也不是瓶颈，但会成为将来扩场景的
 *   隐患。这里用**插入排序**（近似有序，实测比 sort 快且零分配）
 *   + 显式的**脏标记**（布局没变就跳过排序）。
 */

/* ---------- 投影参数（可随屏幕尺寸缩放） ---------- */
var ISO = {
  /** 地面格子宽（屏幕像素）。真实 2:1 时 TH = TW/2 */
  TW: 72,
  /** 地面格子高 */
  TH: 36,
  /** 每单位 z（高度）的屏幕位移 */
  TZ: 26,
  /** 原点（世界 0,0 投影到的屏幕位置） */
  ox: 0,
  oy: 0,
  /** 深度排序的脏标记：布局变了置 true */
  dirty: true,
  /** 统计：上次排序的元素数与耗时（调试用） */
  lastCount: 0,
};

/** 按格子宽重算其余参数（保持 2:1 与 TZ 的比例） */
function isoSetScale(tw) {
  ISO.TW = tw;
  ISO.TH = Math.round(tw * 0.5);
  /* TZ 不跟 TW 严格同比：太扁会让立方体失去立体感，
     太小又看不出高度。经验值是 TH 的 0.7~0.75。 */
  ISO.TZ = Math.round(ISO.TH * 0.72);
}

/**
 * 世界坐标 → 屏幕坐标。
 * @param {number} gx 地面格 x
 * @param {number} gy 地面格 y
 * @param {number} gz 高度（0 = 地面）
 * @returns {{x:number, y:number}} 屏幕像素（y 已减去高度位移）
 */
function isoProject(gx, gy, gz) {
  return {
    x: ISO.ox + (gx - gy) * (ISO.TW / 2),
    y: ISO.oy + (gx + gy) * (ISO.TH / 2) - (gz || 0) * ISO.TZ,
  };
}

/** 只取 x（省一次对象分配，热路径用） */
function isoProjectX(gx, gy) {
  return ISO.ox + (gx - gy) * (ISO.TW / 2);
}
/** 只取 y（含高度） */
function isoProjectY(gx, gy, gz) {
  return ISO.oy + (gx + gy) * (ISO.TH / 2) - (gz || 0) * ISO.TZ;
}

/**
 * 屏幕坐标 → 地面世界坐标（**只取地面 z=0**）。
 * 用于点击拾取：玩家点在屏幕某处，反算它落在哪一格。
 *
 * ★ 数学：正向是
 *     sx = ox + (gx-gy)*a
 *     sy = oy + (gx+gy)*b        （a=TW/2, b=TH/2）
 *   解出gx、gy：
 *     gx = ((sx-ox)/a + (sy-oy)/b) / 2
 *     gy = ((sy-oy)/b - (sx-ox)/a) / 2
 *
 * @param {number} sx 屏幕 x
 * @param {number} sy 屏幕 y
 * @returns {{gx:number, gy:number}} 世界坐标（**未取整**，要取整用 floor）
 */
function isoUnproject(sx, sy) {
  var a = ISO.TW / 2, b = ISO.TH / 2;
  var dx = (sx - ISO.ox) / a;
  var dy = (sy - ISO.oy) / b;
  return { gx: (dx + dy) / 2, gy: (dy - dx) / 2 };
}

/**
 * 屏幕坐标 → 落在哪一格（取整后）。
 *
 * ★★ 这里踩过一个坑，值得写清楚：
 *   初版写的是 `Math.floor(p.gx + 0.5)`（四舍五入）。
 *   但格 (gx,gy) 的**中心**在世界坐标是 (gx+0.5, gy+0.5)，
 *   反投影回来正好是 x.5 —— 再四舍五入就**进位了一整格**。
 *   实测 49 个格子的中心全部点错（(0,0)→(1,1)）。
 *   ★ 格 (gx,gy) 的世界矩形范围是 [gx, gx+1) × [gy, gy+1)，
 *   所以判定「落在哪一格」就是直接 **floor**（代表该格左下角的那一半），
 *   不该做四舍五入。四舍五入是给「离散点找最近格」用的，不是「找所在格」。
 *
 * @returns {{gx:number, gy:number}} 整数格坐标
 */
function isoCellAt(sx, sy) {
  var p = isoUnproject(sx, sy);
  return { gx: Math.floor(p.gx), gy: Math.floor(p.gy) };
}

/* ============================================================
 *  深度排序
 * ============================================================ */

/**
 * 创建一个可复用��排序器。
 *
 * ★ 为什么要「复用」而不是每帧 sort：
 *   sort 会分配新数组（每帧一次 GC 压力），而本作每帧要排两次
 *   （队列一次、工位一次）。用模块级缓冲 + 插入排序，
 *   稳态下**零分配**。
 * ★ 插入排序的依据：每帧只有少数元素的深度会变（顾客进队/出队、
 *   脉冲状态变化），数组整体近似有序，插入排序是 O(n) 而非 O(n log n)。
 *
 * @param {number} cap 容量上限（超出就丢弃多余的并计数）
 */
function isoSorter(cap) {
  return { list: [], n: 0, cap: cap || 64, drops: 0 };
}

/** 清空（保留数组内存，稳态零分配） */
function isoSortReset(sr) {
  sr.n = 0;
  sr.drops = 0;
}

/**
 * 加入一个元素。
 * @param {object} sr   isoSorter 返回的排序器
 * @param {number} depth 深度键（越小越靠后 → 先画）
 * @param {any} payload 附带数据（通常是绘制所需的上下文）
 */
function isoSortPush(sr, depth, payload) {
  if (sr.n >= sr.cap) { sr.drops++; return false; }
  var i = sr.n++;
  sr.list[i] = { d: depth, p: payload };
  /* ★ 插入排序：往前挪直到不大于前一个。
     这样「深度小的新元素」会插到正确位置，而**已在正确相对顺序的元素不动**
     —— 每帧只有一两个元素位置变，代价接近 O(1)。 */
  while (i > 0 && sr.list[i - 1].d > sr.list[i].d) {
    var t = sr.list[i - 1];
    sr.list[i - 1] = sr.list[i];
    sr.list[i] = t;
    i--;
  }
  return true;
}

/** 取第 i 个（已按深度排好） */
function isoSortAt(sr, i) { return sr.list[i]; }
function isoSortLen(sr) { return sr.n; }

/* ============================================================
 *  绘制图元
 * ============================================================ */

/**
 * 画一个等距立方体（底面在 (gx,gy)，高度 h 单位）。
 *
 * ★ 只画**三个可见面**（顶 + 两个侧面）：
 *   俯视 2:1 时背面被自身挡住，画了纯属浪费 —— 三个面就够。
 * ★ 面的明暗是立体感的主要来源：
 *   顶面最亮、右侧中等、左侧最暗（假设光从右上来）。
 *
 * @param {object} ctx   canvas 上下文
 * @param {number} gx,gy 底面格坐标
 * @param {number} h     高度（格数）
 * @param {object} col   { top, left, right, edge } 颜色
 * @param {object} [opt] { inset: 每面的内缩像素（做间隙用） }
 */
function isoBox(ctx, gx, gy, h, col, opt) {
  var inset = (opt && opt.inset) || 0;
  var a = ISO.TW / 2 - inset, b = ISO.TH / 2 - inset;
  var cx = ISO.ox + (gx - gy) * (ISO.TW / 2);
  var cy = ISO.oy + (gx + gy) * (ISO.TH / 2);
  var tz = ISO.TZ;
  var c = col || {};

  ctx.beginPath();
  /* 顶面菱形（中心在 cy - h*tz）*/
  var ty = cy - h * tz;
  ctx.moveTo(cx, ty - b);
  ctx.lineTo(cx + a, ty);
  ctx.lineTo(cx, ty + b);
  ctx.lineTo(cx - a, ty);
  ctx.closePath();
  ctx.fillStyle = c.top || 'rgba(255,255,255,.12)';
  ctx.fill();

  /* 右侧面：顶面右下 → 底面右下 */
  ctx.beginPath();
  ctx.moveTo(cx + a, ty);
  ctx.lineTo(cx + a, cy);
  ctx.lineTo(cx, cy + b);
  ctx.lineTo(cx, ty + b);
  ctx.closePath();
  ctx.fillStyle = c.right || 'rgba(0,0,0,.22)';
  ctx.fill();

  /* 左侧面 */
  ctx.beginPath();
  ctx.moveTo(cx - a, ty);
  ctx.lineTo(cx - a, cy);
  ctx.lineTo(cx, cy + b);
  ctx.lineTo(cx, ty + b);
  ctx.closePath();
  ctx.fillStyle = c.left || 'rgba(0,0,0,.34)';
  ctx.fill();

  /* 描边：可选。有描边时立体感更强，代价是多 3 次 stroke。 */
  if (c.edge) {
    ctx.strokeStyle = c.edge;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/**
 * 画地面格（一个扁平的菱形）。
 * 用它铺「地板」，玩家才有空间感 —— 没有地面的等距物体是悬空的。
 */
function isoTile(ctx, gx, gy, col, opt) {
  var a = ISO.TW / 2, b = ISO.TH / 2;
  var cx = ISO.ox + (gx - gy) * a;
  var cy = ISO.oy + (gx + gy) * b;
  ctx.beginPath();
  ctx.moveTo(cx, cy - b);
  ctx.lineTo(cx + a, cy);
  ctx.lineTo(cx, cy + b);
  ctx.lineTo(cx - a, cy);
  ctx.closePath();
  ctx.fillStyle = col || 'rgba(255,255,255,.04)';
  ctx.fill();
}

/**
 * 画椭圆阴影（贴在地面）。
 *
 * ★ 阴影是「物体离地」的强信号 —— 没有阴影的等距物体看起来是贴纸。
 * ★ 用椭圆而不是菱形：等距投影下圆形地面的投影是椭圆，
 *   画菱形会让人以为那是方块。
 */
function isoShadow(ctx, gx, gy, rx, ry, alpha) {
  var cx = ISO.ox + (gx - gy) * (ISO.TW / 2);
  var cy = ISO.oy + (gx + gy) * (ISO.TH / 2);
  ctx.save();
  ctx.globalAlpha = alpha == null ? 0.28 : alpha;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse
    ? ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    /* 老环境没有 ellipse 的退化路径 */
    : (function () {
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(rx, ry);
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.restore();
    })();
  ctx.fill();
  ctx.restore();
}

/**
 * 画"站在地面上"的角色（阴影 + 本体）。
 *
 * ★ 本体是矩形（不是菱形）—— 角色是竖直的，
 *   在等距里竖直物体的正面仍然投影成矩形。
 *   只有**底面**是菱形（它贴着地面）。
 */
function isoActor(ctx, gx, gy, w, h, col) {
  var cx = ISO.ox + (gx - gy) * (ISO.TW / 2);
  var cy = ISO.oy + (gx + gy) * (ISO.TH / 2);
  var top = cy - h - ISO.TZ;
  var c = col || {};
  /* 阴影 */
  isoShadow(ctx, gx, gy, w * 0.42, ISO.TH * 0.24, c.shadow == null ? 0.3 : c.shadow);
  /* 本体（竖直矩形）*/
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, top + ISO.TH * 0.25);
  ctx.lineTo(cx + w / 2, top + ISO.TH * 0.25);
  ctx.lineTo(cx + w / 2, cy + ISO.TH * 0.1);
  ctx.lineTo(cx - w / 2, cy + ISO.TH * 0.1);
  ctx.closePath();
  ctx.fillStyle = c.body || 'rgba(255,255,255,.2)';
  ctx.fill();
  if (c.edge) { ctx.strokeStyle = c.edge; ctx.lineWidth = 1; ctx.stroke(); }
  return { cx: cx, cy: cy, top: top };
}

/**
 * 某个矩形是否与等距地面有交叠（判断要不要绘制）。
 *
 * ★ 斜角下简单的「y 比较」不再可靠 ——
 *   屏幕上一个矩形可能横跨多个地面格子。
 *   所以要把矩形四角反投影成世界坐标，取包围盒判断。
 */
function isoRectVisible(sx, sy, w, h, gx0, gy0, gx1, gy1) {
  /* 保守判断：屏幕矩形投影回世界后的包围盒与场景有交叠即绘制 */
  var p0 = isoUnproject(sx, sy);
  var p1 = isoUnproject(sx + w, sy + h);
  var minX = Math.min(p0.gx, p1.gx), maxX = Math.max(p0.gx, p1.gx);
  var minY = Math.min(p0.gy, p1.gy), maxY = Math.max(p0.gy, p1.gy);
  return maxX >= gx0 && minX <= gx1 && maxY >= gy0 && minY <= gy1;
}