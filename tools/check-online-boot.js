/**
 * 用**线上真实文件**做启动自检（V20.3）
 *
 * ★ 为什么需要它：
 *   之前的 check-dist-boot 测的是**本地 dist**。
 *   ★ 但线上是 Jekyll 构建出来的 —— 内容可能被改过
 *     （Liquid 模板处理、front matter 剥离、行尾归一化）。
 *   ★ 「本地能跑」不等于「线上能跑」——
 *     部署验证必须验**线上那份**。
 *
 * ★ 本次实战验证：
 *   线上 js/data.js 比本地少 2473 字节 —— 一度以为是 Jekyll 改坏了文件。
 *   ★ 归一化行尾后比对 → 完全一致 —— 差异只是 CRLF vs LF。
 *   ★ 但这个结论必须由工具得出，不能靠人肉 diff。
 *
 * 用法：node tools/check-online-boot.js [线上根地址]
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./jsdom-loader');

const root = path.join(__dirname, '..');
const BASE = (process.argv[2] || 'https://xuancheng2024.github.io/bubble-tycoon').replace(/\/+$/, '');

let failed = 0, step = 0;
function ok(m) { console.log('  ✔ ' + (++step) + '. ' + m); }
function bad(m) { failed++; console.log('  ✘ ' + (++step) + '. ' + m); }

async function main() {
  console.log('=== 线上启动自检（' + BASE + '）===\n');

  /* ---------- ① 下载线上全部资源 ---------- */
  const RESOURCES = [
    'index.html', 'styles.css',
    'js/data.js', 'js/engine.js', 'js/main.js', 'js/ui.js',
    'js/ui/stores.js', 'js/ui/staff.js', 'js/ui/lab.js', 'js/ui/ach.js',
    'assets/icon-192.png',
  ];

  const tmp = path.join(root, '.ci-node', 'online');
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const r of RESOURCES) {
    const dest = path.join(tmp, r);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      const res = await fetch(BASE + '/' + r);
      if (!res.ok) { bad('下载 ' + r + ' → HTTP ' + res.status); continue; }
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    } catch (e) {
      bad('下载 ' + r + ' 失败：' + e.message);
    }
  }
  ok('下载 ' + RESOURCES.length + ' 个线上资源');

  /* ---------- ② 不该发布的确实没发布 ---------- */
  const NOT_PUBLISHED = [
    'tools/bench.js', 'docs/部署说明.md', 'minigame/src/main.js',
    'legal/privacy.html', 'DEPLOY.md', '.github/workflows/quick-check.yml',
  ];
  for (const p of NOT_PUBLISHED) {
    try {
      const res = await fetch(BASE + '/' + p);
      if (res.status === 404) ok('未发布：/' + p);
      else bad('/' + p + ' 竟然可访问（HTTP ' + res.status + '）—— 发布范围没收紧');
    } catch (e) {
      ok('未发布：/' + p + '（请求异常也算不可访问）');
    }
  }

  /* ---------- ③ 线上内容能跑起来 ---------- */
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  let html = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8');
  html = html.replace(/<script src="js\/([\w./-]+)\.js"><\/script>/g,
    (m, name) => '<script>' + fs.readFileSync(path.join(tmp, 'js', name + '.js'), 'utf8') + '<\/script>');

  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'http://localhost/',
    pretendToBeVisual: true, virtualConsole: vc,
  });
  const { window } = dom;

  if (errors.length === 0) ok('线上脚本加载无错误');
  else bad('线上脚本加载有错：' + errors.slice(0, 2).join(' | '));

  /* 模块函数是否挂载 */
  const MODS = {
    stores: ['storesPanelHtml', 'cityMapPanelHtml'],
    staff: ['regularPanelHtml', 'specialtyHtml'],
    lab: ['sigCardHtml', 'recipeNodeCardHtml'],
    ach: ['isMainAch', 'achRowHtml'],
  };
  for (const [mod, fns] of Object.entries(MODS)) {
    const missing = fns.filter(f => window.eval('typeof ' + f) !== 'function');
    if (missing.length === 0) ok('js/ui/' + mod + '.js 函数已挂载');
    else bad('js/ui/' + mod + '.js 缺：' + missing.join(', '));
  }

  /* ★ 开一局 + 渲染所有面板 —— 跨模块调用最密集的地方 */
  try {
    window.eval('window.S = newGame("normal", 0, null); window.S.cash = 300000;');
    let panels = 0;
    for (const tab of ['manage', 'lab', 'up', 'staff', 'rival', 'ach']) {
      try {
        window.eval('UI.setTab("' + tab + '"); UI.renderAll();');
        const len = window.eval('document.getElementById("panel-' + tab + '").innerHTML.length');
        if (len > 200) panels++;
        else bad('面板 ' + tab + ' 内容过短（' + len + '）');
      } catch (e) {
        bad('面板 ' + tab + ' 渲染失败：' + e.message);
      }
    }
    if (panels === 6) ok('6 个面板全部正常渲染');
  } catch (e) {
    bad('开局失败：' + e.message);
  }

  /* V20 特性在位 */
  const v20 = window.eval('(function(){'
    + 'return (typeof STAGE_GOALS !== "undefined") + "|"'
    + '+ (typeof nextAdvice === "function") + "|"'
    + '+ (typeof UI.serveFeedback === "function");})()');
  const [a1, a2, a3] = v20.split('|');
  if (a1 === 'true' && a2 === 'true' && a3 === 'true') ok('V20 特性在位（难度曲线 / 明日建议 / 出杯反馈）');
  else bad('V20 特性缺失：' + v20);

  /* 运行时无错 */
  if (errors.length === 0) ok('全程无运行时错误');
  else bad('运行期有错：' + errors.slice(0, 2).join(' | '));

  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('');
  if (failed === 0) {
    console.log('✔ 线上可以正常玩');
    setTimeout(() => process.exit(0), 40);
  } else {
    console.log('✘ ' + failed + ' 项有问题');
    setTimeout(() => process.exit(1), 40);
  }
}

main();