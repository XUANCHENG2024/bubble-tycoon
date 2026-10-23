/**
 * 全局字号缩放专项测试（V20.8）—— GFX.setTextScale() + FS getter
 *
 * ★★ 为什么必须有这个测试 ★★
 *   V20.8 把 `FS` 从「固定字面量对象」改成了「带 getter 的令牌表」，
 *   ★ 由 layoutOf 调 GFX.setTextScale(scale) 驱动全局缩放。
 *
 *   ★ 这套机制改动的不是某一个函数，而是**全仓 361 处 `FS.xs` 读取** ——
 *     它要么全部生效（好），要么全部失效（回到原样），
 *     而且失效时**界面看上去完全正常**，只是字号没变。
 *   ★ V20.7 就是这么翻车的：L.scale 存在但几乎没效果，
 *     「看起来做了适配」比「没做适配」更危险。
 *   ★ 所以必须有一个测试**直接断言字号确实变了**。
 *
 * ★★ 测什么 ★★
 *   ① 缩放真的生效：FS.xs/sm/md/lg/xl/display 按比例变化
 *   ② 非法值安全：0 / NaN / Infinity / 负数 / 5 → 一律退回 1
 *      （缩放系数一旦变成 0，全屏文字会消失 —— 灾难级故障）
 *   ③ **不重复缩放**：fs(L, key) 必须等于 FS[key]，
 *      320 屏上 FS.xs 必须是 9.5 而不是 10×0.94×0.94 = 8.8
 *   ④ layoutOf 会自动把缩放写进 gfx（不然 361 处 FS 全是 1 倍）
 *   ⑤ 缩放是**纯函数式**的：改一次不影响其它键，不缓存脏值
 *   ⑥ 取整到 0.5px（布局计算要小数，绘制要整数，折中）
 *
 * 用法：node tools/test-text-scale.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

/* ---------- 加载 bundle ---------- */
try {
  require('child_process').execFileSync(process.execPath,
    [path.join(root, 'tools', 'build-minigame.js')], { stdio: 'ignore' });
} catch (e) { /* 忽略 */ }
const BUNDLE = fs.readFileSync(path.join(root, 'minigame', 'bundle.js'), 'utf8');

const ctxObj = {
  console, Math, JSON, Date, Object, Array, String, Number, Boolean, Error,
  Set, Map, isNaN, parseInt, parseFloat, setTimeout, clearTimeout,
  TextEncoder, TextDecoder,
  requestAnimationFrame() { return 0; },
};
vm.createContext(ctxObj);
vm.runInContext(BUNDLE, ctxObj, { filename: 'bundle.js' });

const run = expr => vm.runInContext(expr, ctxObj);

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; }
  else {
    fail++;
    failures.push(name + (detail ? ' —— ' + detail : ''));
    console.log('  ✘ ' + name + (detail ? '\n      ' + detail : ''));
  }
}

const KEYS = ['xs', 'sm', 'md', 'lg', 'xl', 'display'];
const BASE = { xs: 10, sm: 11, md: 12, lg: 14, xl: 16, display: 22 };

/** 读当前 FS 各键的值 */
function readFS() {
  const out = {};
  for (const k of KEYS) out[k] = run('FS.' + k);
  return out;
}

console.log('=== 全局字号缩放专项测试（FS getter + setTextScale）===\n');

/* ============================================================
 *  ① 默认状态：缩放 = 1，FS 等于基准值
 * ============================================================ */
console.log('--- ① 默认应为 1 倍缩放 ---');
{
  run('GFX.setTextScale(1)');
  const v = readFS();
  for (const k of KEYS) {
    ok(v[k] === BASE[k], '默认 FS.' + k + ' = ' + BASE[k], '实际=' + v[k]);
  }
  ok(run('GFX.getTextScale()') === 1, '默认 getTextScale() = 1',
    '实际=' + run('GFX.getTextScale()'));
}

/* ============================================================
 *  ② 缩放真的生效
 * ============================================================ */
console.log('\n--- ② 缩放系数必须真的改变字号 ---');
{
  for (const s of [0.94, 0.9, 1.1, 1.25]) {
    run('GFX.setTextScale(' + s + ')');
    const v = readFS();
    for (const k of KEYS) {
      const expect = Math.round(BASE[k] * s * 2) / 2;
      ok(v[k] === expect,
        'scale=' + s + ' 时 FS.' + k + ' = ' + expect,
        '实际=' + v[k] + '（基准 ' + BASE[k] + '）');
    }
    ok(run('GFX.getTextScale()') === s, 'getTextScale() 应回报 ' + s,
      '实际=' + run('GFX.getTextScale()'));
  }
}

/* ============================================================
 *  ③ 非法值必须安全退回 1
 * ============================================================ */
console.log('\n--- ③ 非法缩放值必须退回 1（防止全屏文字消失）---');
{
  const bad = [0, -1, -0.5, NaN, Infinity, -Infinity, 5, 100, 'abc', null, undefined, {}, [], true];
  for (const b of bad) {
    const lit = typeof b === 'number' && !isFinite(b)
      ? String(b)
      : JSON.stringify(b);
    run('GFX.setTextScale(' + lit + ')');
    const got = run('GFX.getTextScale()');
    ok(got === 1, 'setTextScale(' + lit + ') 应退回 1', '实际=' + got);
    const v = readFS();
    ok(v.xs === BASE.xs, '退回后 FS.xs 应恢复 ' + BASE.xs, '实际=' + v.xs);
  }
  /* ★ 边界值：0.2 与 3 之内有效 */
  run('GFX.setTextScale(0.2)');
  ok(run('GFX.getTextScale()') === 1, 'scale=0.2 属于非法（太极端）应退回 1',
    '实际=' + run('GFX.getTextScale()'));
  run('GFX.setTextScale(3)');
  ok(run('GFX.getTextScale()') === 3, 'scale=3 属于有效上限', '实际=' + run('GFX.getTextScale()'));
  run('GFX.setTextScale(1)');
}

/* ============================================================
 *  ④ ★ 不重复缩放（V20.7 的核心 bug）
 * ============================================================ */
console.log('\n--- ④ fs(L,key) 不得与 FS[key] 重复相乘 ---');
{
  /* ★ V20.7：FS.xs 是固定 10px，fs(L,'xs') 返回 10 * L.scale。
   * ★ V20.8：FS.xs 本身已经是 10 * scale，fs(L,'xs') 必须**原样返回**。
   * ★ 若 fs() 里还乘一次 → 320 屏上 10 × 0.94 × 0.94 = 8.83 → 中文糊成一片。 */
  run('GFX.setTextScale(0.94)');
  const direct = run('FS.xs');
  ok(direct === 9.5, '320 屏上 FS.xs 应为 9.5（10 × 0.94）', '实际=' + direct);
  ok(direct !== 10 * 0.94 * 0.94, 'FS.xs 不应被缩放两次（8.8 是错值）',
    '实际=' + direct);

  /* ★ 用真实的 layoutOf 走一遍，验证 fs() 与 FS 一致 */
  const r = run(`(function(){
    var L = CV.layoutOf(320, 568);
    return { scale: L.scale, fsXs: fs(L, 'xs'), fsMd: fs(L, 'md'), fsDisplay: fs(L, 'display'),
             directXs: FS.xs, directMd: FS.md, directDisplay: FS.display };
  })()`);
  ok(Math.abs(r.scale - 0.94) < 1e-9, '320 宽的 scale 应为 0.94', '实际=' + r.scale);
  ok(r.fsXs === r.directXs, 'fs(L,"xs") 应等于 FS.xs',
    'fs=' + r.fsXs + ' vs FS=' + r.directXs);
  ok(r.fsMd === r.directMd, 'fs(L,"md") 应等于 FS.md',
    'fs=' + r.fsMd + ' vs FS=' + r.directMd);
  ok(r.fsDisplay === r.directDisplay, 'fs(L,"display") 应等于 FS.display',
    'fs=' + r.fsDisplay + ' vs FS=' + r.directDisplay);
  ok(r.fsXs === 9.5, '320 屏上 fs(L,"xs") 应为 9.5（不是 8.8）', '实际=' + r.fsXs);
}

/* ============================================================
 *  ⑤ layoutOf 必须自动推送缩放
 * ============================================================ */
console.log('\n--- ⑤ layoutOf 必须把缩放写进 gfx ---');
{
  const widths = [320, 375, 414, 600, 768, 1024];
  for (const w of widths) {
    run('CV.layoutOf(' + w + ', 800)');
    const s = run('GFX.getTextScale()');
    const expect = w >= 600 ? 1 : Math.max(0.94, Math.min(1.10, w / 375));
    ok(Math.abs(s - expect) < 1e-9,
      '宽度 ' + w + ' 时 getTextScale() 应为 ' + expect.toFixed(4),
      '实际=' + s);
  }
  /* ★ 关键：layoutOf 跑完后，FS.xs 必须**已经**是缩放后的值，
     而不是因为「先读了 FS 才调 layoutOf」才生效。 */
  run('GFX.setTextScale(1)');
  run('CV.layoutOf(320, 568)');
  ok(run('FS.xs') === 9.5, 'layoutOf(320) 后 FS.xs 应立即为 9.5',
    '实际=' + run('FS.xs'));
  /* ★ 切回大屏应恢复 */
  run('CV.layoutOf(1024, 768)');
  ok(run('FS.xs') === 10, 'layoutOf(1024) 后 FS.xs 应恢复 10',
    '实际=' + run('FS.xs'));
}

/* ============================================================
 *  ⑥ getter 的性质：可枚举、无副作用、赋值不生效
 * ============================================================ */
console.log('\n--- ⑥ FS getter 的性质 ---');
{
  const keys = run('Object.keys(FS).sort().join(",")');
  ok(keys === KEYS.slice().sort().join(','),
    'FS 的键应可枚举且完整（Object.keys 能列全）', '实际=' + keys);
  /* ★ getter 是纯的：连续读两次结果一致 */
  run('GFX.setTextScale(0.94)');
  const a = run('FS.xs'), b = run('FS.xs');
  ok(a === b, 'FS.xs 连续读取应一致（getter 无副作用）', a + ' vs ' + b);
  /* ★ 改缩放后应立刻变 */
  run('GFX.setTextScale(1.2)');
  ok(run('FS.xs') !== a, '改缩放后 FS.xs 应立刻变化',
    '之前=' + a + ' 现在=' + run('FS.xs'));
  /* ★ 赋值不应生效（避免有人写 FS.xs = 12 造成困惑） */
  run('FS.xs = 99');
  ok(run('FS.xs') !== 99, 'FS.xs 赋值不应生效（应保持 getter 语义）',
    '实际=' + run('FS.xs'));
  run('GFX.setTextScale(1)');
}

/* ============================================================
 *  ⑦ 全局副作用检查：缩放会影响所有读取点
 * ============================================================ */
console.log('\n--- ⑦ 缩放是全局的（不是只影响 fs()）---');
{
  /* ★ 这是 V20.8 相对 V20.7 的核心价值：
     361 处 `FS.xs` 这种**直接读取**也必须跟随缩放。
     ★ 用 bundle 里的真实读取点验证，而不是复刻逻辑。 */
  run('GFX.setTextScale(1)');
  const before = run('FS.md');
  run('GFX.setTextScale(0.94)');
  const after = run('FS.md');
  ok(before === 12 && after === 11.5,
    '直接读取 FS.md 也应随缩放变化（11.5 ≠ 12×0.94=11.28）',
    '之前=' + before + ' 现在=' + after);
  /* ★ 0.5px 取整 */
  ok(after === 11.5, '缩放后应取整到 0.5px', '实际=' + after);
  run('GFX.setTextScale(1)');
}

/* ============================================================
 *  结果
 * ============================================================ */
console.log('\n=== 结果 ===');
if (fail === 0) {
  console.log('✔ 全部通过（' + pass + ' 项）');
  process.exit(0);
} else {
  console.log('✘ 失败 ' + fail + ' 项 / 通过 ' + pass + ' 项');
  failures.forEach(f => console.log('  · ' + f));
  process.exit(1);
}
