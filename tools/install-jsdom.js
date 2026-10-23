/**
 * 在 CI 里安装 jsdom（供 GitHub Actions 使用）
 *
 * ★ 为什么要这个文件：
 *   browser-smoke / mobile-smoke / xss-verify / check-dist-boot
 *   四个脚本都需要真实 DOM（jsdom）——
 *   而 CI 环境**从来没有安装过它**。
 *   ★ 后果：Quick Check 从第 7 步「真实 DOM 冒烟」开始失败，
 *     后面 18 个步骤全部 skipped ——
 *     **CI 长期处于红灯状态，而我一直以为它是绿的**
 *     （因为本地 25 套全绿，而我没看 CI 结果）。
 *   ★ 这类「本地绿 / CI 红」的漏洞只有在**真看 CI 结果**时才能发现。
 *
 * ★ 为什么不写进 package.json：
 *   本项目刻意保持零依赖（纯静态站点，无 node_modules）。
 *   加 package.json 会让 clone 的人以为要跑 npm install。
 *   ★ jsdom 只在 CI 与开发机上需要 —— 那就只在 CI 里装。
 *
 * 用法：node tools/install-jsdom.js
 */
const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

/* ★ 版本锁定：
   jsdom 30.x 要求 Node ^22.22.2 —— CI 的 node-version: '22'
   可能装到 22.0.x（不满足）。
   26.x 对 Node 18+ 都友好，作为稳妥的选择。 */
const JSDOM_VER = process.env.JSDOM_VERSION || '26.1.0';

console.log('安装 jsdom@' + JSDOM_VER + ' 到 .ci-node/（不污染项目根）…');

/* ★ 装到项目内的 .ci-node/（被 .gitignore 忽略）——
   这样 CI 里的相对路径与本地一致，
   不用为「Windows 路径 vs Linux 路径」写两套逻辑。
   ★ 项目根仍**没有** package.json / node_modules ——
     零依赖的约定不被破坏。 */
const tmp = path.join(root, '.ci-node');
try {
  /* ★ Windows 上 npm 是 npm.cmd —— 直接 execFileSync('npm') 会 ENOENT。
     ★ 这不是「本地特例」，而是**平台差异**：
       CI 是 Linux（npm 可执行），本地是 Windows（需要 .cmd）。
       ★ 所以两种都要试，否则脚本在某个平台上必然失败。 */
  const isWin = process.platform === 'win32';
  const npmCmd = isWin ? 'npm.cmd' : 'npm';
  try {
    execFileSync(npmCmd, ['install', '--no-save', '--prefix', tmp, 'jsdom@' + JSDOM_VER], {
      stdio: 'inherit',
      cwd: root,
    });
  } catch (e) {
    /* Windows 下 .cmd 可能仍不可用（某些环境的 PATHEXT 缺 .CMD），
       退回直接调 shell。 */
    execFileSync('npm', ['install', '--no-save', '--prefix', tmp, 'jsdom@' + JSDOM_VER], {
      stdio: 'inherit',
      cwd: root,
      shell: true,
    });
  }
} catch (e) {
  console.error('');
  console.error('✘ jsdom 安装失败（CI 的 DOM 测试将无法运行）');
  console.error('  手动安装：npm i --prefix .ci-node jsdom@' + JSDOM_VER);
  process.exit(1);
}

console.log('');
console.log('✔ jsdom 已安装到 .ci-node/');
console.log('  CI 里需要设 JSDOM_PATH=.ci-node/node_modules/jsdom');
