/**
 * 把 workflow 里的测试步骤改用 run-ci-test.js 包装（带诊断信息）
 *
 * ★ 为什么改：
 *   Actions 步骤失败时 UI 只显示「✘ 小游戏冒烟」，
 *   完整输出要翻日志（还要认证）。
 *   ★ 排查「本地过 / CI 挂」这类平台差异时，
 *     **看不到失败详情就只能猜** ——
 *     我这次就卡了很久：查步骤名、查缺文件，都没定位到。
 *   ★ 包装器会在失败时额外打印：平台 / Node 版本 / 关键文件是否存在。
 *
 * ★ 用精确替换，不用正则（V20.2 的教训）。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

/** [文件, 旧 run 行, 新 run 行] */
const FIXES = [
  ['.github/workflows/quick-check.yml',
    '        run: node tools/minigame-smoke.js',
    '        run: node tools/run-ci-test.js tools/minigame-smoke.js'],
  ['.github/workflows/quick-check.yml',
    '        run: node tools/mobile-smoke.js',
    '        run: node tools/run-ci-test.js tools/mobile-smoke.js'],
  ['.github/workflows/quick-check.yml',
    '        run: node tools/browser-smoke.js',
    '        run: node tools/run-ci-test.js tools/browser-smoke.js'],
  ['.github/workflows/quick-check.yml',
    '        run: node tools/xss-verify.js',
    '        run: node tools/run-ci-test.js tools/xss-verify.js'],
  ['.github/workflows/full-check.yml',
    '        run: node tools/minigame-smoke.js',
    '        run: node tools/run-ci-test.js tools/minigame-smoke.js'],
  ['.github/workflows/full-check.yml',
    '        run: node tools/mobile-smoke.js',
    '        run: node tools/run-ci-test.js tools/mobile-smoke.js'],
  ['.github/workflows/full-check.yml',
    '        run: node tools/browser-smoke.js',
    '        run: node tools/run-ci-test.js tools/browser-smoke.js'],
  ['.github/workflows/full-check.yml',
    '        run: node tools/xss-verify.js',
    '        run: node tools/run-ci-test.js tools/xss-verify.js'],
];

let ok = 0, bad = 0;
for (const [file, oldStr, newStr] of FIXES) {
  const p = path.join(root, file);
  let src = fs.readFileSync(p, 'utf8');
  if (src.indexOf(newStr) >= 0) { ok++; continue; }
  if (src.indexOf(oldStr) < 0) {
    console.log('  ✘ 未匹配：' + file + ' → ' + oldStr.trim());
    bad++;
    continue;
  }
  src = src.replace(oldStr, newStr);
  fs.writeFileSync(p, src);
  console.log('  ✔ ' + file + ' → ' + newStr.trim());
  ok++;
}

console.log('');
console.log(ok + ' 处已改' + (bad ? '，' + bad + ' 处未匹配' : ''));
if (bad) process.exit(1);