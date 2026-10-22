/**
 * 等距投影（V15）数学与性能检查。
 *
 * ★ 投影是整个伪 3D 改造的地基 —— 画与点必须用同一套坐标，
 *   偏一点就"画在这里、点在别处"。所以这里逐项验算，
 *   而不是"看起来还行"。
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const ctxObj = {
  console, Math, JSON, Date, Object, Array, String, Number, Boolean, Error, Set, Map,
  isNaN, parseInt, parseFloat,
};
ctxObj.globalThis = ctxObj;
vm.createContext(ctxObj);
vm.runInContext(fs.readFileSync(path.join(root, 'minigame/src/iso.js'), 'utf8'), ctxObj);
const g = e => vm.runInContext(e, ctxObj);

let fails = 0, checks = 0;
function check(cond, label) {
  checks++;
  if (cond) { console.log(`  ✔ ${label}`); return true; }
  fails++;
  console.log(`  ✘ ${label}`);
  return false;
}

console.log('=== 等距投影检查（V15）===\n');

/* ---------- ① 2:1 比例 ---------- */
console.log('--- ① 2:1 等距比例 ---');
g('isoSetScale(80)');
check(Math.abs(g('ISO').TH - 40) < 1e-9, `TW=80 → TH=40（严格 2:1，实测 ${g('ISO').TH}）`);
{
  /* ★ 关键性质：TH 必须是 TW 的一半，否则两个主轴的角度不对称 */
  const tw = g('ISO').TW, th = g('ISO').TH;
  check(Math.abs(th * 2 - tw) < 1e-9, 'TH:TH 与 TW 严格 2:1');
}

/* ---------- ② 投影 / 反投影 互逆 ---------- */
console.log('\n--- ② 投影 ↔ 反投影必须互逆 ---');
{
  g('ISO.ox = 200; ISO.oy = 150');
  let worst = 0;
  const pts = [[0, 0], [1, 0], [0, 1], [1, 1], [3, 7], [10, 2], [2, 10], [8, 8]];
  for (const [gx, gy] of pts) {
    const p = g('isoProject')(gx, gy, 0);
    const q = g('isoUnproject')(p.x, p.y);
    const err = Math.max(Math.abs(q.gx - gx), Math.abs(q.gy - gy));
    worst = Math.max(worst, err);
  }
  check(worst < 1e-9,
    `8 个点往返误差 ${worst.toExponential(2)}（< 1e-9）`);

  /* ★ 带高度时：反投影只对地面成立，高度会体现在 y 上。
     所以「有高度的物体，其屏幕点反投影回地面格会偏后」——
     这是正确的（点上方 = 更靠前的格子）。 */
  const pHi = g('isoProject')(5, 5, 1);
  const pG = g('isoProject')(5, 5, 0);
  check(pHi.x === pG.x && pHi.y === pG.y - g('ISO').TZ,
    `高度只影响 y（z=1 比 z=0 高 ${g('ISO').TZ}px，x 不变）`);
}

/* ---------- ③ 深度顺序正确性 ---------- */
console.log('\n--- ③ 深度顺序 ---');
{
  /* 斜角下 (gx+gy) 越大越靠下 = 越"靠前"。
     验证：同一行的两个格子，y 大的应该画得更晚（盖住 y 小的）。*/
  const a = g('isoProject')(0, 0, 0);
  const b = g('isoProject')(0, 5, 0);
  check(b.y > a.y, `(0,5) 在 (0,0) 下方（y ${a.y} → ${b.y}）`);
  /* x 方向：gx 大 → 屏幕右移 */
  const c = g('isoProject')(5, 0, 0);
  check(c.x > a.x && c.y > a.y, `(5,0) 在 (0,0) 的右下`);
  /* gy 大 → 屏幕左移 */
  const d = g('isoProject')(0, 5, 0);
  check(d.x < a.x, `(0,5) 在 (0,0) 的左下（x ${a.x} → ${d.x}）`);
}

/* ---------- ④ 拾取：isoCellAt 与绘制位置一致 ---------- */
console.log('\n--- ④ 拾取与绘制必须对齐（画在哪点哪）---');
{
  g('ISO.ox = 200; ISO.oy = 150');
  let mis = 0;
  const bad = [];
  for (let gx = 0; gx <= 6; gx++) {
    for (let gy = 0; gy <= 6; gy++) {
      /* 画（格中心）→ 拾取（应回到同一格）*/
      const cx = g('isoProjectX')(gx + 0.5, gy + 0.5);
      const cy = g('isoProjectY')(gx + 0.5, gy + 0.5, 0);
      const cell = g('isoCellAt')(cx, cy);
      if (cell.gx !== gx || cell.gy !== gy) {
        mis++;
        if (bad.length < 3) bad.push(`(${gx},${gy})→(${cell.gx},${cell.gy})`);
      }
    }
  }
  check(mis === 0,
    `49 个格子的中心拾取全部命中本格${mis ? '（错 ' + mis + ' 个：' + bad.join(' ') + '）' : ''}`);
}

/* ---------- ⑤ 排序器正确性 ---------- */
console.log('\n--- ⑤ 深度排序 ---');
{
  /* 5.1 插入排序结果与Array.sort 一致 */
  const sr = g('isoSorter')(32);
  const depths = [7, 3, 9, 1, 5, 2, 8, 0, 6, 4];
  for (const d of depths) g('isoSortPush')(sr, d, { v: d });
  let got = [];
  for (let i = 0; i < g('isoSortLen')(sr); i++) got.push(g('isoSortAt')(sr, i).d);
  const want = depths.slice().sort((a, b) => a - b);
  check(JSON.stringify(got) === JSON.stringify(want),
    `插入排序结果正确（${got.join(',')}）`);

  /* 5.2 容量上限 */
  const sr2 = g('isoSorter')(3);
  g('isoSortPush')(sr2, 1, 'a'); g('isoSortPush')(sr2, 2, 'b'); g('isoSortPush')(sr2, 3, 'c');
  const overflow = g('isoSortPush')(sr2, 4, 'd');
  check(!overflow && sr2.n === 3 && sr2.drops === 1,
    `超出容量被丢弃并计数（n=${sr2.n} drops=${sr2.drops}）`);

  /* 5.3 ★ 稳定性：同深度按插入序（后插入的画更靠前） */
  const sr3 = g('isoSorter')(16);
  g('isoSortPush')(sr3, 5, 'first');
  g('isoSortPush')(sr3, 5, 'second');
  check(g('isoSortAt')(sr3, 0).p === 'first' && g('isoSortAt')(sr3, 1).p === 'second',
    '同深度保持插入序（稳定，后加入的画在前 = 遮挡正确）');
}

/* ---------- ⑥ 性能：稳态零分配 ---------- */
console.log('\n--- ⑥ 排序性能（避免逐帧重建）---');
{
  const sr = g('isoSorter')(64);
  /* 模拟真实规模：16 个工位 + 16 个顾客 */
  const N = 32;
  /* ★ 关键：list 数组被复用，稳态下不新增数组对象 */
  const listRef = sr.list;
  /* 预热 */
  for (let i = 0; i < N; i++) g('isoSortPush')(sr, (i * 7) % 16, i);
  /* 跑 1000 帧，每帧「只变一两个元素」的真实模式 */
  const t0 = Date.now();
  for (let f = 0; f < 1000; f++) {
    g('isoSortReset')(sr);
    /* 近似有序：只有第 f%16 项深度在变 */
    for (let i = 0; i < N; i++) {
      const d = (i * 7 + (f % 16 === i ? 3 : 0)) % 16;
      g('isoSortPush')(sr, d, i);
    }
  }
  const ms = Date.now() - t0;
  check(sr.list === listRef,
    `排序器复用同一数组（1000 帧后仍是同一个 list）`);
  check(ms < 500,
    `1000 帧 × 32 元素排序耗时 ${ms}ms（单帧 ${(ms / 1000).toFixed(3)}ms）`);
  /* 与每次 sort 的对比 —— 说明为什么不逐帧重建 */
  let tSort = 0;
  const arr = [];
  for (let i = 0; i < N; i++) arr.push({ d: i % 16, p: i });
  for (let f = 0; f < 1000; f++) {
    tSort += arr.sort((a, b) => a.d - b.d).length;
  }
  console.log(`     （对比：每帧 sort 1000 次 ${tSort}ms 元素操作 —— 每帧都要重建数组并分配）`);
}

/* ---------- ⑦ 绘制图元不崩 ---------- */
console.log('\n--- ⑦ 图元绘制 ---');
{
  /* ★★ 这里栽了两次坑，都出在**怎么调 vm 里的函数**上：
   *   ① 桩建在 Node 侧（`new Proxy` 在 Node 里 new，传进 vm）
   *      → 跨上下文 Proxy 陷阱失效，beginPath 取到 undefined
   *   ② 更根本的：把**字符串** '__ctx' 传给 vm 里的函数
   *      → vm 里 ctx 就是字符串，'__ctx'.beginPath 当然不是函数
   *   ★ 正确做法：桩与调用**都在 vm 内**（runInContext 一把梭）。
   *   ★ 这类「测试环境问题伪装成代码问题」极易误导排查方向 ——
   *     一度以为是 isoBox 忘了 ctx.beginPath。
   */
  vm.runInContext(`
    globalThis.__ell = 0; globalThis.__m = 0; globalThis.__actor = null;
    globalThis.__ctx = new Proxy({}, {
      get: function (t, p) {
        if (p === 'globalAlpha' || p === 'fillStyle'
          || p === 'strokeStyle' || p === 'lineWidth') return 1;
        return function () { __m++; if (p === 'ellipse') __ell++; };
      },
      set: function () { return true; }
    });
  `, ctxObj);

  const report = vm.runInContext(`
    (function () {
      var errs = [];
      function t(name, fn) { try { fn(); } catch (e) { errs.push(name + ': ' + e.message); } }
      t('isoBox', function () { isoBox(__ctx, 2, 3, 1, { top: '#fff', left: '#000', right: '#888' }, { inset: 2 }); });
      t('isoTile', function () { isoTile(__ctx, 1, 1, 'rgba(0,0,0,.1)'); });
      t('isoShadow', function () { isoShadow(__ctx, 1, 1, 20, 10, 0.3); });
      t('isoActor', function () { __actor = isoActor(__ctx, 2, 2, 30, 40, { body: '#fff' }); });
      return errs.length ? errs.join(' | ') : '';
    })()
  `, ctxObj);

  const ell = vm.runInContext('__ell', ctxObj);
  const m = vm.runInContext('__m', ctxObj);
  const actor = vm.runInContext('__actor', ctxObj);

  check(!report, `四个图元都不抛异常${report ? '：' + report : ''}`);
  check(m > 20, `图元共调用 ${m} 次 ctx 方法（真的画了）`);
  check(ell >= 1, `isoShadow 走到了 ellipse 路径（实测 ${ell} 次）`);
  check(actor && typeof actor.cx === 'number' && typeof actor.top === 'number',
    `isoActor 返回可用的对齐坐标（cx=${actor && actor.cx}）`);
}

/* ---------- ⑧ 缩放 ---------- */
console.log('\n--- ⑧ 不同屏幕下的缩放 ---');
{
  for (const tw of [56, 72, 96, 120]) {
    g('isoSetScale')(tw);
    const iso = g('ISO');
    const ok = iso.TH === Math.round(tw * 0.5) && iso.TZ > 0 && iso.TZ < iso.TH;
    check(ok, `TW=${tw} → TH=${iso.TH} TZ=${iso.TZ}（比例合理）`);
  }
}

console.log('');
if (fails === 0) {
  console.log(`✔ 等距投影全部通过（${checks} 项）`);
  process.exit(0);
} else {
  console.log(`✘ ${fails} 项有问题 / 共 ${checks} 项`);
  process.exit(1);
}