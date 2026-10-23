/**
 * PWA 检查（V20.6）
 *
 * ★ 为什么要专门写这个检查：
 *   PWA 的失败方式全是**静默**的 ——
 *   · manifest 路径错 → 浏览器不报错，只是不显示安装提示
 *   · SW 注册失败 → console 里一条 warn，页面照常工作
 *   · ★ 最坑的：**Pages 的发布白名单漏了 manifest.json / sw.js**
 *     → 本地一切正常，线上「装到桌面」按钮根本不出现
 *   ★ 这类问题只能靠自动检查守住。
 *
 * 用法：node tools/check-pwa.js [线上地址]
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

let fails = 0, checks = 0;
function check(cond, label) {
  checks++;
  if (cond) { console.log('  ✔ ' + label); return true; }
  fails++;
  console.log('  ✘ ' + label);
  return false;
}

console.log('=== PWA 检查（V20.6）===\n');

/* ---------- ① 文件存在 ---------- */
console.log('--- ① 文件 ---');
const manifestPath = path.join(root, 'manifest.json');
const swPath = path.join(root, 'sw.js');
check(fs.existsSync(manifestPath), 'manifest.json 存在');
check(fs.existsSync(swPath), 'sw.js 存在');

/* ---------- ② manifest 内容 ---------- */
console.log('\n--- ② manifest 内容 ---');
if (fs.existsSync(manifestPath)) {
  let m = null;
  try { m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (e) { /* 下面会判失败 */ }
  check(!!m, 'manifest 是合法 JSON');
  if (m) {
    check(!!m.name, '有 name');
    check(!!m.short_name, '有 short_name（桌面图标下的名字）');
    check(m.display === 'standalone' || m.display === 'fullscreen',
      'display 是 standalone（独立窗口，不是浏览器标签）');
    check(m.start_url && m.start_url.indexOf('./') === 0,
      'start_url 用相对路径（' + (m.start_url || '无') + '）'
      + ' —— Pages 在子目录下，绝对路径会 404');
    check(m.scope && m.scope.indexOf('./') === 0,
      'scope 用相对路径（' + (m.scope || '无') + '）');
    check(Array.isArray(m.icons) && m.icons.length >= 2,
      '至少 2 个图标（' + ((m.icons || []).length) + ' 个）');
    /* ★ 192 与 512 是 Chrome 安装的硬性要求 */
    const sizes = (m.icons || []).map(i => i.sizes);
    check(sizes.indexOf('192x192') >= 0, '含 192x192 图标（Chrome 硬性要求）');
    check(sizes.indexOf('512x512') >= 0, '含 512x512 图标（Chrome 硬性要求）');
    /* 图标文件真的存在吗 */
    const missing = (m.icons || []).filter(i => !fs.existsSync(path.join(root, i.src)));
    check(missing.length === 0,
      '图标文件都存在' + (missing.length ? '（缺 ' + missing.map(i => i.src).join(', ') + '）' : ''));
    /* 背景色与主题色一致 —— 不一致会导致安装时闪白 */
    check(m.background_color === m.theme_color,
      'background_color 与 theme_color 一致（安装时不闪白）');
  }
}

/* ---------- ③ SW 内容 ---------- */
console.log('\n--- ③ Service Worker ---');
if (fs.existsSync(swPath)) {
  const sw = fs.readFileSync(swPath, 'utf8');
  check(/addEventListener\(\s*['"]install['"]/.test(sw), '监听 install');
  check(/addEventListener\(\s*['"]activate['"]/.test(sw), '监听 activate');
  check(/addEventListener\(\s*['"]fetch['"]/.test(sw), '监听 fetch');
  check(/caches\.open/.test(sw), '打开缓存');
  check(/skipWaiting/.test(sw), 'install 时 skipWaiting（新版立即接管）');
  check(/clients\.claim/.test(sw), 'activate 时 clients.claim（接管已打开的页面）');
  /* ★ 版本号：改了缓存内容必须改版本，否则旧缓存不失效 */
  const ver = /const VERSION\s*=\s*'([^']+)'/.exec(sw);
  check(!!ver, '有版本号常量（' + (ver ? ver[1] : '无') + '）');
  /* ★ 缓存清单必须包含所有被 index.html 引用的脚本 */
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  const assetsBlock = /const ASSETS = \[([\s\S]*?)\];/.exec(sw);
  const listed = assetsBlock ? [...assetsBlock[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : [];
  const missingInCache = scripts.filter(s => !listed.some(l => l.indexOf(s) >= 0));
  check(missingInCache.length === 0,
    '缓存清单覆盖所有脚本（缺 ' + (missingInCache.join(', ') || '无') + '）');
}

/* ---------- ④ index.html 引用 ---------- */
console.log('\n--- ④ 页面引用 ---');
{
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  check(/<link rel="manifest" href="manifest\.json">/.test(html),
    '引用了 manifest（相对路径）');
  check(/apple-mobile-web-app-capable/.test(html), '有 apple-mobile-web-app-capable（iOS 全屏）');
  /* ★ SW 注册的三个边界处理 */
  check(/serviceWorker' in navigator/.test(html), 'SW 注册前检查了 API 可用性');
  check(/location\.protocol !== 'https:'/.test(html), 'SW 注册前检查了 HTTPS/localhost');
  check(/isNativePlatform/.test(html), 'SW 注册前排除了 App（Capacitor）环境');
}

/* ---------- ⑤ Pages 发布白名单 ---------- */
console.log('\n--- ⑤ Pages 发布白名单（最容易漏且最难查）---');
{
  const cfgPath = path.join(root, '_config.yml');
  if (!check(fs.existsSync(cfgPath), '_config.yml 存在')) {
    console.log('  （无法继续）');
  } else {
    const cfg = fs.readFileSync(cfgPath, 'utf8');
    const inc = /include:([\s\S]*?)(?:\n\w|\n$)/.exec(cfg);
    const listed = inc ? [...inc[1].matchAll(/-\s+(\S+)/g)].map(m => m[1]) : [];
    for (const f of ['manifest.json', 'sw.js', 'index.html', 'styles.css']) {
      check(listed.indexOf(f) >= 0,
        '发布白名单含 ' + f + (listed.indexOf(f) < 0 ? ' —— 线上会 404！' : ''));
    }
    check(listed.indexOf('js') >= 0, '发布白名单含 js 目录');
    check(listed.indexOf('assets') >= 0, '发布白名单含 assets 目录');
    /* ★ 反向检查：不该发布的目录不能被列进去 */
    for (const f of ['tools', 'docs', 'minigame']) {
      check(listed.indexOf(f) < 0, '发布白名单不含 ' + f + '（内部实现不该公开）');
    }
  }
}

/* ---------- ⑥ 线上（可选） ----------
   ★ 注意：这里用 async IIFE 而不是顶层 await ——
   ★ Node 会因为「同时存在 require() 和顶层 await」而无法判断模块格式
   ★ （ERR_AMBIGUOUS_MODULE_SYNTAX），把整个脚本变成不可用。 */
const online = process.argv[2];
if (online) {
  (async () => {
    console.log('\n--- ⑥ 线上验证：' + online + ' ---');
    const base = online.replace(/\/+$/, '');
    for (const p of ['/manifest.json', '/sw.js', '/index.html']) {
      try {
        const res = await fetch(base + p, { redirect: 'follow' });
        check(res.ok, p + ' → HTTP ' + res.status);
      } catch (e) {
        check(false, p + ' 访问失败：' + e.message);
      }
    }
    finish();
  })();
} else {
  finish();
}

function finish() {
  console.log('');
  if (fails === 0) {
    console.log('✔ PWA 检查全部通过（' + checks + ' 项）');
    setTimeout(() => process.exit(0), 40);
  } else {
    console.log('✘ ' + fails + ' 项有问题 / 共 ' + checks + ' 项');
    setTimeout(() => process.exit(1), 40);
  }
}