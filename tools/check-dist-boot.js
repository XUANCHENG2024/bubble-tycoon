/**
 * 部署前把关：模拟浏览器加载 dist 并开一局（V20.2）
 *
 * ★ 为什么 200 不够：
 *   HTTP 200 只说明「文件在」，不说明「脚本按顺序跑起来了」。
 *   这轮把 ui.js 拆成了 js/ui/*.js 子目录 ——
 *   ★ 顺序错了（模块在 ui.js 之后）就是**白屏**，
 *     而每个文件都返回 200。
 *   ★ 所以必须真正执行一遍、点进游戏、看有没有运行时错误。
 *
 * 用法：node tools/check-dist-boot.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./jsdom-loader');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

/* 1. dist 必须存在且完整 */
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('✘ dist/index.html 不存在 —— 先跑 node tools/build-dist.js');
  process.exit(1);
}

/* 2. 把 script 内联（与浏览器加载顺序一致） */
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
html = html.replace(/<script src="js\/([\w./-]+)\.js"><\/script>/g,
  (m, name) => '<script>' + fs.readFileSync(path.join(dist, 'js', name + '.js'), 'utf8') + '<\/script>');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const { window } = dom;

let failed = 0;
function check(cond, label) {
  if (cond) { console.log('  ✔ ' + label); return true; }
  failed++;
  console.log('  ✘ ' + label);
  return false;
}

console.log('=== dist 启动自检（模拟浏览器）===\n');

/* 3. 脚本加载阶段不能有错 */
check(errors.length === 0,
  '脚本加载无错误' + (errors.length ? '：' + errors.slice(0, 2).join(' | ') : ''));

/* 4. ★ 拆出去的模块函数必须都在（这是这轮最该验的） */
const MODULES = {
  stores: ['storesPanelHtml', 'cityMapPanelHtml', 'cityPickerModalHtml', 'storeUpgradeHtml'],
  staff: ['regularPanelHtml', 'specialtyHtml', 'managerPanelHtml'],
  lab: ['sigCardHtml', 'recipeNodeCardHtml', 'labFoldNavHtml', 'cityBarHtml'],
  ach: ['isMainAch', 'achTierHtml', 'achRowHtml'],
};
for (const [mod, fns] of Object.entries(MODULES)) {
  const missing = fns.filter(f => window.eval('typeof ' + f) !== 'function');
  check(missing.length === 0,
    'js/ui/' + mod + '.js 的函数已挂载（' + fns.length + ' 个）'
    + (missing.length ? ' 缺：' + missing.join(', ') : ''));
}

/* 5. 核心全局必须在 */
for (const g of ['UI', 'SFX', 'TUT', 'PANEL_RENDERERS']) {
  check(window.eval('typeof ' + g) !== 'undefined', '全局 ' + g + ' 已定义');
}

/* 6. ★ 真正开一局并渲染所有面板 —— 顺序错的话这里会炸 */
try {
  window.eval('window.S = newGame("normal", 0, null); window.S.cash = 300000;');
  window.eval('UI.setTab("manage"); UI.renderAll();');
  check(window.eval('document.getElementById("panel-manage").innerHTML.length') > 1000,
    '经营面板渲染正常');
} catch (e) {
  check(false, '开局失败：' + e.message);
}

/* 7. ★ 跑一天完整流程（开门→营业→打烊）——
   跨模块调用最密集的地方 */
try {
  window.eval('UI.setTab("manage"); UI.renderAll();');
  window.eval('doAct("open", null);');
  const opened = window.eval('!!window.S.phase');
  check(opened, '开门流程正常');
} catch (e) {
  check(false, '开门流程失败：' + e.message);
}

/* 8. 每个面板都能渲染（跨模块引用全在这一步暴露） */
for (const tab of ['manage', 'lab', 'up', 'staff', 'rival', 'ach']) {
  try {
    window.eval('UI.setTab("' + tab + '"); UI.renderAll();');
    const len = window.eval('document.getElementById("panel-' + tab + '").innerHTML.length');
    check(len > 200, '面板 ' + tab + ' 渲染 ' + len + ' 字符');
  } catch (e) {
    check(false, '面板 ' + tab + ' 渲染失败：' + e.message);
  }
}

/* 9. 运行期不能有错 */
check(errors.length === 0,
  '全程无运行时错误' + (errors.length ? '：' + errors.slice(0, 2).join(' | ') : ''));

console.log('');
if (failed === 0) {
  console.log('✔ dist 可以安全部署');
  setTimeout(() => process.exit(0), 40);
} else {
  console.log('✘ ' + failed + ' 项有问题 —— 不要部署');
  setTimeout(() => process.exit(1), 40);
}