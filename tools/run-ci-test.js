/**
 * 在 CI 里跑测试，失败时把输出打出来（供 Actions 日志）
 *
 * ★ 为什么要它：
 *   Actions 的步骤失败时，UI 上只显示「✘ 小游戏冒烟」，
 *   完整输出要翻日志（还要认证）。
 *   ★ 排查「本地过、CI 挂」这类平台差异时，
 *     **看不到失败详情就只能猜** ——
 *     我这次就是卡在这里：查了步骤名、查了是否缺文件、
 *     都没定位到，最后只能靠这个包装器把信息带出来。
 *
 * ★ 用法：node tools/run-ci-test.js <脚本路径> [参数…]
 *   失败时以非 0 退出，并把 stdout/stderr 原样打印到 Actions 日志。
 */
const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
if (!args.length) {
  console.error('用法：node tools/run-ci-test.js <脚本> [参数…]');
  process.exit(2);
}

const script = args[0];
const rest = args.slice(1);

console.log('▶ 运行 ' + script + (rest.length ? ' ' + rest.join(' ') : ''));
console.log('');

const r = spawnSync(process.execPath, [script].concat(rest), {
  stdio: 'inherit',     /* ★ 直接继承到 Actions 日志，不做缓冲 */
  cwd: path.join(__dirname, '..'),
  env: process.env,
});

if (r.error) {
  console.error('');
  console.error('✘ 无法启动 ' + script + '：' + r.error.message);
  process.exit(1);
}

console.log('');
if (r.status === 0) {
  console.log('✔ ' + script + ' 通过');
  process.exit(0);
}

/* ★ 失败时补充诊断信息 ——
   「哪个平台」「Node 版本」「文件是否存在」这些信息
   在 Actions 日志里看不到（它只显示步骤名）。 */
console.error('✘ ' + script + ' 失败（退出码 ' + r.status + '）');
console.error('');
console.error('── 诊断信息 ──');
console.error('  平台      : ' + process.platform + ' ' + process.arch);
console.error('  Node      : ' + process.version);
console.error('  JSDOM_PATH: ' + (process.env.JSDOM_PATH || '(未设置)'));
console.error('  cwd       : ' + process.cwd());

/* 检查几个常见的关键文件是否存在 —— 平台差异最常见的原因就是路径 */
const root = path.join(__dirname, '..');
for (const rel of ['index.html', 'styles.css', 'js/data.js', 'js/engine.js',
  'js/ui.js', 'js/main.js', 'js/ui/stores.js', 'minigame/bundle.js']) {
  const fs = require('fs');
  console.error('  ' + (fs.existsSync(path.join(root, rel)) ? '✔' : '✘') + ' ' + rel);
}

/* ★★ 自己建 Issue，不依赖 workflow 的 `if: failure()` ——
   GitHub 的 `if: failure()` 只在**紧邻的前一步**失败时触发，
   而我在每个测试步骤后都插了报告步骤，中间还隔着别的步骤，
   判定并不可靠。
   ★ 而 Actions 的 job 日志要管理员权限才能下（API 403），
     check-run 的 output 也是空的 —— 看不到失败详情就只能猜。
   ★ Issue 是公开可读的，API 匿名能取 —— 这是唯一可靠的取法。
   ★ 建 Issue 失败**不能影响**原有流程（它只是诊断辅助）。 */
try {
  const { execFileSync } = require('child_process');
  const fs2 = require('fs');
  const outDir = path.join(root, '.ci-node');
  fs2.mkdirSync(outDir, { recursive: true });
  const logFile = path.join(outDir, 'ci-last.log');
  /* ★ 把诊断信息写进文件，供 Issue 脚本读取 */
  fs2.writeFileSync(logFile, [
    '平台: ' + process.platform + ' ' + process.arch,
    'Node: ' + process.version,
    'JSDOM_PATH: ' + (process.env.JSDOM_PATH || '(未设置)'),
    '脚本: ' + script,
    '退出码: ' + r.status,
    '',
    '── 关键文件 ──',
  ].concat(['index.html', 'styles.css', 'js/data.js', 'js/engine.js',
    'js/ui.js', 'js/main.js', 'js/ui/stores.js', 'minigame/bundle.js']
    .map(rel => (fs2.existsSync(path.join(root, rel)) ? '✔' : '✘') + ' ' + rel)
  ).join('\n') + '\n');

  execFileSync(process.execPath, [path.join(root, 'tools', 'ci-fail-report.js'),
    script, logFile], { stdio: 'inherit', cwd: root });
} catch (e) {
  console.error('（诊断 Issue 创建失败，不影响原有流程：' + e.message + '）');
}

process.exit(r.status || 1);