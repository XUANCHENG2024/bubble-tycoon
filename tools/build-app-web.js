/**
 * 构建 App 的 Web 产物（Capacitor 的 webDir）
 *
 * ★ 为什么需要单独构建，而不是直接用 minigame/：
 *   minigame/ 里有一堆抖音专用文件 —— game.js / game.json /
 *   project.config.json / code.fortify.config.json / .vscode/
 *   这些进了 App 包是纯粹的死重量（而且会误导人）。
 *   ★ 所以 App 产物 = 干净的 web 目录：
 *     index.html（Capacitor 壳）+ bundle.js（Canvas 引擎）+ audio/
 *
 * ★ 为什么复用 Canvas 版（bundle.js）而不是 H5 版：
 *   H5 版是 DOM 渲染（57 张配方卡全量 innerHTML 重写），
 *   在 WebView 里低端机会卡；Canvas 版纯自绘、无 DOM 开销。
 *   ★ 这正是方案 B 的核心 —— 复用为移动端而生的那套渲染。
 *
 * 用法：node tools/build-app-web.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const out = path.join(root, 'app', 'www');

/* ---------- 1. 确保 bundle 是最新的 ---------- */
console.log('· 打包小游戏 bundle（Canvas 引擎）');
execFileSync(process.execPath, [path.join(root, 'tools', 'build-minigame.js')], {
  stdio: 'inherit', cwd: root,
});

/* ---------- 2. 清空并复制 ---------- */
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

/* bundle.js —— Canvas 引擎（含 data.js + engine.js + 渲染层） */
fs.copyFileSync(path.join(root, 'minigame', 'bundle.js'), path.join(out, 'bundle.js'));

/* 音频（3 个 WAV，合计约 16.5KB） */
const audioSrc = path.join(root, 'minigame', 'audio');
if (fs.existsSync(audioSrc)) {
  fs.cpSync(audioSrc, path.join(out, 'audio'), { recursive: true });
}

/* ★ 图标**不**进 web 产物 ——
   ★ Capacitor 的原生层有各自的图标资源（mipmap/ 与 AppIcon.appiconset），
     而 web 产物里的图标：
       ① 1.5MB 白占体积（三个尺寸 × 三个图标）
       ② 根本不会被用到 —— index.html 不引用它们
     ★ PWA 的 apple-touch-icon 是 H5 版的事，App 不需要。
     ★ 打开 App 时的闪屏由原生层的启动屏负责。 */

/* ---------- 3. 生成 index.html（App 壳）---------- */
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <!-- ★ App 内不需要 user-scalable=no —— 那是给 H5 版的。
       去掉它反而更好：无障碍上允许用户放大。 -->
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#170a2e">
  <title>奶茶星球 · Bubble Tycoon</title>
  <style>
    html, body {
      margin: 0; padding: 0; height: 100%; overflow: hidden;
      background: #170a2e;
      /* touch-action: manipulation —— 去掉 300ms 点击延迟，
         同时禁掉双击缩放（不影响正常游戏操作） */
      touch-action: manipulation;
      -webkit-user-select: none; user-select: none;
      -webkit-touch-callout: none;
      overscroll-behavior: none;
    }
    /* ★ 画布铺满整个可视区。
       100dvh 会随浏览器工具栏收起/展开而变 —— 在 App 里没这个问题，
       但用 dvh 比 vh 稳（App 内嵌 WebView 偶尔有地址栏残留）。 */
    #gc { display: block; width: 100vw; height: 100vh; height: 100dvh; }
    /* ★ 加载遮罩：bundle 有 733KB，首次解析约 100~300ms，
       这段时间是白屏 —— 放个背景色 + 品牌字，别让用户看到空白。 */
    #boot {
      position: fixed; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 14px;
      background: #170a2e; color: #f4eeff; z-index: 99;
      font: 600 16px/1.5 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      transition: opacity .25s ease;
    }
    #boot .t { font-size: 26px; }
    #boot .s { font-size: 13px; opacity: .6; }
    #boot.hide { opacity: 0; pointer-events: none; }
  </style>
</head>
<body>
  <canvas id="gc"></canvas>
  <div id="boot"><div class="t">🧋 奶茶星球</div><div class="s">正在启动…</div></div>
  <script src="./bundle.js"></script>
  <script>
    /* ★ 启动遮罩：bundle 解析完就撤掉。
       ★ 用 load 事件而不是 DOMContentLoaded ——
         bundle.js 是同步解析执行的，load 时它一定已经跑完。 */
    window.addEventListener('load', function () {
      setTimeout(function () {
        var b = document.getElementById('boot');
        if (!b) return;
        b.classList.add('hide');
        setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 300);
      }, 60);
    });
    /* ★ 首屏错误兜底：bundle 若抛错，白屏会很难看。
       给一句人话 + 一个「重试」按钮（App 里用户没法自己刷新）。 */
    window.addEventListener('error', function (e) {
      var b = document.getElementById('boot');
      if (!b || b.dataset.failed) return;
      b.dataset.failed = '1';
      b.innerHTML = '<div class="t">😢</div><div class="s">启动失败：'
        + String(e.message || e).slice(0, 80)
        + '</div><div class="s" style="margin-top:10px">'
        + '<button onclick="location.reload()" '
        + 'style="padding:8px 18px;border-radius:8px;border:none;'
        + 'background:#35e5f0;color:#140726;font-size:14px">重试</button></div>';
    });
  </script>
</body>
</html>
`;
fs.writeFileSync(path.join(out, 'index.html'), html);

/* ---------- 4. 自检 ---------- */
const files = [];
/* ★ 用相对路径记录，不能用 path.join(out, ...) ——
   out 是绝对路径，path.join 会把它当相对段拼进去
   （踩过一次：'D:\\...\\app\\www\\D:\\...\\app\\www\\assets\\x.png'）。 */
function walk(p, base) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const f of fs.readdirSync(p)) {
      walk(path.join(p, f), base ? base + '/' + f : f);
    }
  } else files.push(base);
}
walk(out, '');

let total = 0;
for (const f of files) total += fs.statSync(path.join(out, f)).size;

console.log('');
console.log('✔ App Web 产物构建完成');
console.log('  目录: app/www/');
console.log('  文件 ' + files.length + ' 个 / ' + (total / 1024 / 1024).toFixed(2) + ' MB');
for (const f of files) {
  console.log('    ' + f + '  ' + (fs.statSync(path.join(out, f)).size / 1024).toFixed(1) + ' KB');
}

/* 引用完整性 */
const idx = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const refs = [...idx.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map(m => m[1]).filter(p => !/^https?:/.test(p));
let bad = 0;
for (const r of refs) {
  if (!fs.existsSync(path.join(out, r))) { console.error('  ✘ 缺失: ' + r); bad++; }
}
if (bad) process.exit(1);
console.log('  引用完整（' + refs.length + ' 个资源）');
console.log('');
console.log('★ 下一步：cd app && npx cap sync');