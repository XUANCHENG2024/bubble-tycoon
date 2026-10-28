/**
 * 两端口径一致性检查（V20.3）
 *
 * ★ 这条守的是 V20 引入的一个真实缺陷：
 *   V20 把阶段目标从「goal × 比例」改成每档独立的绝对值（STAGE_GOALS），
 *   改了 `milestoneOf`（H5 端用）——
 *   ★ **漏了 `nextGoalOf`**（小游戏 Canvas 端用），
 *     它还在算 `final * MILESTONE_RATIO[idx]`。
 *   ★ 结果：同一局游戏，H5 显示 ¥5200 的阶段目标，
 *     小游戏端显示另一个数 —— 两端口径不一致。
 *   ★ 而且它还导致 CI 在 Linux 上失败
 *     （「Canvas 锚点日显示 ✔ 已达第 N 阶段目标」）。
 *
 * ★ 为什么本地 Windows 全过、Linux 失败：
 *   边界情况下（净资产刚好等于某个锚点），
 *   两个口径算出的 value 不同 → reached 判断不同。
 *   ★ 这类「两处各算一遍同一件事」的隐患，
 *     靠**逐日对比**才能发现 —— 单测各自都过。
 */
const { buildH5Env } = require('./h5-env.js');

let fails = 0, checks = 0;
function check(cond, label) {
  checks++;
  if (cond) { console.log('  ✔ ' + label); return true; }
  fails++;
  console.log('  ✘ ' + label);
  return false;
}

console.log('=== 两端口径一致性（V20.3）===\n');

/* ---------- ① nextGoalOf 与 milestoneOf 必须一致 ---------- */
console.log('--- ① 阶段目标金额一致 ---');
{
  const { window } = buildH5Env();

  for (const diff of ['easy', 'normal', 'hard']) {
    window.eval('window.S = newGame(' + JSON.stringify(diff) + ', 0, null);');
    window.eval('window.S.cash = 300000;');
    const bad = [];
    for (const day of [1, 3, 5, 6, 10, 11, 15, 16, 20, 21, 25, 26, 30]) {
      window.eval('window.S.day = ' + day + ';');
      const pair = window.eval('(function(){'
        + 'var g = nextGoalOf(window.S);'
        + 'var m = milestoneOf(window.S);'
        + 'return g.value + "|" + (m ? m.worth : -1) + "|" + g.idx;})()');
      const [g, m, idx] = pair.split('|');
      if (g !== m) bad.push('Day' + day + '(goal=' + g + ' milestone=' + m + ')');
    }
    check(bad.length === 0,
      diff + ' 档 13 个日点口径一致'
      + (bad.length ? ' —— 不一致：' + bad.join(', ') : ''));
  }
}

/* ---------- ② 锚点日必须真的"已达" ---------- */
console.log('\n--- ② 锚点日的 reached 判定 ---');
{
  const { window } = buildH5Env();
  window.eval('window.S = newGame("normal", 0, null);');

  /* 把净资产设成刚好等于锚点 —— 边界情况最容易两端口径不一致 */
  const edge = window.eval('(function(){'
    + 'var s = window.S; s.day = 5;'
    + 'var ms = milestoneOf(s);'
    + 'var g = nextGoalOf(s);'
    + 'return ms.worth + "|" + g.value;})()');
  const [m, g] = edge.split('|');
  check(m === g, 'Day5 的两个函数给出同一个锚点值（' + m + ' vs ' + g + '）');

  /* 净资产略高于锚点 → 两端都该判"已达" */
  const reached = window.eval('(function(){'
    + 'var s = window.S; s.day = 5;'
    + 'var ms = milestoneOf(s);'
    + '/* 直接构造净资产：净资产 = cash + 库存估值 - 负债，'
    + '   这里用引擎自己的 setter 不方便，改用 cash 逼近（现金是净资产的主要部分）*/'
    + 's.cash = ms.worth + 100000; s.invested = 0;'
    + 'var g2 = nextGoalOf(s); var m2 = milestoneOf(s);'
    + 'return g2.reached + "|" + m2.hit;})()');
  check(reached === 'true|true',
    '净资产超过锚点时两端都判「已达」（' + reached + '）');
}

/* ---------- ③ H5 显示的刻度与小游戏一致 ---------- */
console.log('\n--- ③ 阶段刻度用同一套锚点 ---');
{
  const { window } = buildH5Env();
  window.eval('window.S = newGame("normal", 0, null);');

  /* ★ 刻度位置按比例画（H5 与 Canvas 都用 MILESTONE_RATIO），
     但**判定**必须用绝对值 —— 两者可以共存：
     刻度是「相对位置示意」，判定是「真金额」。
     ★ 这里守的是：刻度表长度与阶段数必须一致，
       否则会出现「有第 6 段但判定只有 5 段」的错位。 */
  const ratioLen = window.eval('MILESTONE_RATIO.length');
  const stageLen = window.eval('MILESTONE_EVERY_COUNT');
  const easyLen = window.eval('STAGE_GOALS.easy.length');
  check(ratioLen === stageLen && stageLen === easyLen,
    '刻度表长度 = 阶段数 = 各档锚点数（'
    + ratioLen + '/' + stageLen + '/' + easyLen + '）');

  /* ★★ V21：长度一致**不够**，刻度位置本身也必须与判定点吻合。
     原来只守长度，于是比例固定写死 [0.09…] 而锚点早已改成绝对值，
     第 5 个刻度错位 22pp —— 玩家看到刻度过了，实际判定还没到。
     这里允许 1.5pp 的取整误差（比例保留三位小数）。 */
  const ratio = JSON.parse(window.eval('JSON.stringify(MILESTONE_RATIO)'));
  const gNormal = JSON.parse(window.eval('JSON.stringify(STAGE_GOALS.normal)'));
  const last = gNormal[gNormal.length - 1];
  const drift = ratio.map((r, i) => Math.abs(r - gNormal[i] / last));
  check(drift.every(d => d <= 0.015),
    '刻度位置与 normal 锚点占比吻合（最大偏差 '
    + (Math.max.apply(null, drift) * 100).toFixed(1) + 'pp ≤ 1.5pp）');
}

console.log('');
if (fails === 0) {
  console.log('✔ 两端口径一致（' + checks + ' 项）');
  setTimeout(() => process.exit(0), 40);
} else {
  console.log('✘ ' + fails + ' 项有问题 / 共 ' + checks + ' 项');
  setTimeout(() => process.exit(1), 40);
}