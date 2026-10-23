/**
 * 难度曲线实测提取（V20）
 *
 * ★ 用途：为「递增阶段目标」提供**实测基线**。
 *   不拍脑袋定锚点，而是先跑模拟，看每个锚点日玩家实际能到多少，
 *   再按倍数（够得着但要努力）反推目标。
 * ★ 原来 easy 的 goal=22000，实测第 14 天就超过 ——
 *   说明目标定得比「无策略卡模拟器」还低，
 *   而真实玩家会用策略卡、做菜系加成，实际更强 → 更早通关。
 *
 * 用法：node tools/probe-curve.js [每档模拟局数]
 */
const { execFileSync } = require('child_process');
const path = require('path');

const N = Number(process.argv[2]) || 6;
const ANCHORS = [5, 10, 15, 20, 25, 30];

function run() {
  const out = execFileSync('node',
    [path.join(__dirname, 'sim.js'), String(N), '-v'],
    { encoding: 'utf8', maxBuffer: 8 << 20 });
  const res = {};
  /* 按「难度 xxx」分段；逐日表的第 9 列是净资产 */
  let cur = null;
  for (const line of out.split('\n')) {
    const m = line.match(/难度\s+(\w+)/);
    if (m) { cur = m[1]; res[cur] = []; continue; }
    if (!cur) continue;
    const dm = line.match(/^\s{1,3}(\d{1,2})\s+(.*)$/);
    if (dm) {
      const day = Number(dm[1]);
      if (day < 1 || day > 30) continue;
      const cols = dm[2].trim().split(/\s+/);
      /* Day 客流 卖出 流失 营收 净利 口碑 现金 净资产 员工 店
         → 前三列是 undefined（占 3 格），净资产在索引 5 */
      const nums = dm[2].trim().match(/-?[\d,]+/g) || [];
      const worth = Number((nums[4] || '0').replace(/,/g, ''));
      if (res[cur][day - 1] === undefined) res[cur][day - 1] = worth;
    }
  }
  return res;
}

const data = run();
const curGoals = { easy: 22000, normal: 38000, hard: 48000 };

console.log('=== 难度曲线实测（每档 ' + N + ' 局取首次模拟）===\n');
for (const k of ['easy', 'normal', 'hard']) {
  const d = data[k];
  if (!d || !d.length) { console.log(k + ': 无数据\n'); continue; }
  const final = d[29] || 0;
  const g = curGoals[k];
  const hitDay = d.findIndex(x => x >= g);

  console.log('【' + k + '】当前目标 ¥' + g);
  console.log('  第 30 天实测净资产 ¥' + final
    + '（是目标的 ' + (final / g).toFixed(2) + ' 倍）');
  console.log('  第 ' + (hitDay + 1) + ' 天就超过目标'
    + (hitDay >= 0 ? ' ← 剩 ' + (30 - hitDay - 1) + ' 天无目标' : ' ← 30 天都到不了'));
  console.log('  锚点日实测 → 建议目标（按 1.20 倍）:');
  const sug = {};
  for (const a of ANCHORS) {
    const actual = d[a - 1] || 0;
    const t = Math.round(actual * 1.2 / 100) * 100;
    sug[a] = t;
    console.log('    Day ' + String(a).padStart(2) + '  实测 ¥' + String(actual).padStart(6)
      + '  →  建议 ¥' + String(t).padStart(6));
  }
  console.log('  ★ 建议最终目标 ¥' + (sug[30] || final)
    + '（当前 ' + g + '，需上调 ' + Math.round((sug[30] / g - 1) * 100) + '%）');
  console.log('');
}

/* 顺带报出中后期塌陷 */
console.log('=== 中后期塌陷检测（营收跌幅 >40% 的日子）===');
for (const k of ['easy', 'normal', 'hard']) {
  const d = data[k];
  if (!d || d.length < 5) continue;
  /* 用净资产的日环比代替营收（sim 输出里营收列前面有 undefined，不可靠）*/
  const drops = [];
  for (let i = 4; i < d.length; i++) {
    const prev = d[i - 1] || 0, cur = d[i] || 0;
    if (prev > 0 && cur < prev * 0.6) {
      drops.push('Day ' + (i + 1) + '（' + prev + ' → ' + cur + '）');
    }
  }
  console.log('  ' + k + ': ' + (drops.length ? drops.join('; ') : '无明显塌陷'));
}
console.log('');
console.log('（数据来自 tools/sim.js，无策略卡。真实玩家会用策略卡与加成，');
console.log('  所以建议目标应再上浮 10~20%。）');