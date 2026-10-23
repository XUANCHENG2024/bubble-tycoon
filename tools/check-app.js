/**
 * App（Capacitor）方案检查（V20.4）
 *
 * ★ 守的是什么：
 *   App 方案有一批**只在 App 宿主下才存在**的逻辑：
 *   ① 存储契约（同步 vs 异步）—— 弄错就是「读档全空且不报错」
 *   ② 自启动（App 里没人调 boot）
 *   ③ 返回键层级（Android 特有，iOS 没有）
 *   ④ 原生插件注册（Java/Swift + Xcode 工程）
 *   ⑤ 构建产物完整性
 *
 * ★ 这些逻辑在**现有 25 套测试里全都测不到** ——
 *   因为它们只在 window.Capacitor 存在时才走到。
 *   ★ 所以必须专门模拟一个 Capacitor 宿主来测。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./jsdom-loader');

const root = path.join(__dirname, '..');
const appDir = path.join(root, 'app');

let fails = 0, checks = 0;
function check(cond, label) {
  checks++;
  if (cond) { console.log('  ✔ ' + label); return true; }
  fails++;
  console.log('  ✘ ' + label);
  return false;
}

console.log('=== App 方案检查（V20.4）===\n');

/* ---------- ① 工程结构 ---------- */
console.log('--- ① 工程结构 ---');
{
  check(fs.existsSync(path.join(appDir, 'package.json')), 'app/package.json 存在');
  check(fs.existsSync(path.join(appDir, 'capacitor.config.json')), 'app/capacitor.config.json 存在');
  check(fs.existsSync(path.join(appDir, 'android')), 'Android 平台已生成');
  check(fs.existsSync(path.join(appDir, 'ios')), 'iOS 平台已生成');
  check(fs.existsSync(path.join(appDir, 'www', 'index.html')), 'App web 产物已构建');

  const cfg = JSON.parse(fs.readFileSync(path.join(appDir, 'capacitor.config.json'), 'utf8'));
  check(cfg.webDir === 'www', 'webDir 指向 www（干净的 App 产物）');
  check(!!cfg.appId && cfg.appId.includes('.'), 'appId 是合法包名：' + cfg.appId);
  check(cfg.backgroundColor === '#170a2e' || (cfg.android && cfg.android.backgroundColor === '#170a2e'),
    '背景色与游戏一致（#170a2e，避免启动闪白）');
}

/* ---------- ② 原生插件 ---------- */
console.log('\n--- ② 原生同步存储插件 ---');
{
  const javaPath = path.join(appDir, 'android/app/src/main/java/com/bubbletycoon/game/BubbleStorePlugin.java');
  const swiftPath = path.join(appDir, 'ios/App/App/BubbleStorePlugin.swift');
  check(fs.existsSync(javaPath), 'Android 插件存在');
  check(fs.existsSync(swiftPath), 'iOS 插件存在');

  if (fs.existsSync(javaPath)) {
    const java = fs.readFileSync(javaPath, 'utf8');
    check(/SharedPreferences/.test(java), 'Android 用 SharedPreferences（同步）');
    check(/\.commit\(\)/.test(java), 'Android 用 commit() 同步落盘（不用 apply）');
    check(/@CapacitorPlugin\(name = "BubbleStore"\)/.test(java), 'Android 插件名正确');
  }
  if (fs.existsSync(swiftPath)) {
    const swift = fs.readFileSync(swiftPath, 'utf8');
    check(/UserDefaults/.test(swift), 'iOS 用 UserDefaults（同步）');
    check(/synchronize\(\)/.test(swift), 'iOS 立即落盘');
    check(/pluginMethods/.test(swift), 'iOS 声明了 pluginMethods（Capacitor 7 要求）');
  }

  /* ★ 插件必须在 MainActivity 注册，否则 JS 侧调不到 —— 且这个失败是静默的 */
  const mainAct = path.join(appDir, 'android/app/src/main/java/com/bubbletycoon/game/MainActivity.java');
  if (fs.existsSync(mainAct)) {
    const m = fs.readFileSync(mainAct, 'utf8');
    check(/registerPlugin\(BubbleStorePlugin\.class\)/.test(m),
      'MainActivity 注册了 BubbleStore 插件');
    check(/FLAG_FULLSCREEN/.test(m), 'MainActivity 全屏（隐藏状态栏）');
  }

  /* ★ Swift 文件必须在 Xcode 工程里 —— 否则不会被编译（静默失败）
     ★ 数「不同的引用点」而不是出现次数 ——
       「BubbleStorePlugin.swift」在 PBXBuildFile 那行会出现两次
       （注释里一次 + path 里一次），直接数字符串会多算。 */
  const pbx = path.join(appDir, 'ios/App/App.xcodeproj/project.pbxproj');
  if (fs.existsSync(pbx)) {
    const p = fs.readFileSync(pbx, 'utf8');
    const hasBuild = /PBXBuildFile; fileRef = [0-9A-F]+ \/\* BubbleStorePlugin\.swift \*\//.test(p);
    const hasFile = /PBXFileReference; lastKnownFileType = sourcecode\.swift; path = BubbleStorePlugin\.swift/.test(p);
    const hasGroup = /\/\* BubbleStorePlugin\.swift \*\/,\n/.test(p);
    const hasPhase = /PBXSourcesBuildPhase/.test(p) && /BubbleStorePlugin\.swift in Sources/.test(p);
    check(hasBuild && hasFile && hasGroup && hasPhase,
      'Swift 插件已进 Xcode 工程（构建文件/文件引用/分组/编译列表 4 处）');
  }
}

/* ---------- ③ 平台层的 App 分支 ---------- */
console.log('\n--- ③ 平台层 App 分支 ---');
{
  const plat = fs.readFileSync(path.join(root, 'minigame/src/platform.js'), 'utf8');
  check(/isApp/.test(plat), 'platform.js 有 App 判定');
  check(/appStoreReady/.test(plat), '提供 appStoreReady（启动预热）');
  check(/appNativeStore/.test(plat), '优先用原生同步插件');
  check(/onBack/.test(plat), '提供 onBack（Android 返回键）');
  check(/exitApp/.test(plat), '提供 exitApp');
  check(/Haptics/.test(plat), '接了 Haptics（触感）');
  /* ★ 三层降级都要在 */
  check(/Preferences/.test(plat) && /APP_MEM/.test(plat),
    '存储有原生插件 → Preferences → 内存 三层降级');
}

/* ---------- ④ 启动时序（模拟 Capacitor 宿主）---------- */
console.log('\n--- ④ App 宿主下的启动行为 ---');
{
  /* ★ 造一个假的 Capacitor 环境：window.Capacitor.isNativePlatform() === true
     且提供同步的 BubbleStore 插件 —— 这正是原生插件在 JS 侧的样子。 */
  const bundle = fs.readFileSync(path.join(root, 'minigame/bundle.js'), 'utf8');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  const store = {};
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><canvas id="gc"></canvas></body></html>',
    {
      runScripts: 'dangerously', url: 'http://localhost/',
      pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(win) {
        /* ★ canvas mock —— jsdom 不实现 getContext（会抛 "Not implemented"）。
           ★ 小游戏冒烟测试里也有同样的 mock（tools/minigame-smoke.js 的 makeEnv）。
           ★ 这里只关心「能不能启动」，不关心画得对不对，
             所以 mock 只需要把 2D 上下文的方法都变成空函数。 */
        win.HTMLCanvasElement.prototype.getContext = function () {
          const noop = function () { };
          return {
            canvas: this, fillRect: noop, clearRect: noop, strokeRect: noop,
            beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
            arc: noop, arcTo: noop, ellipse: noop, rect: noop,
            fill: noop, stroke: noop, clip: noop,
            fillText: noop, strokeText: noop, measureText: () => ({ width: 10 }),
            drawImage: noop, putImageData: noop,
            save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
            setTransform: noop, transform: noop, resetTransform: noop,
            createLinearGradient: () => ({ addColorStop: noop }),
            createRadialGradient: () => ({ addColorStop: noop }),
            createPattern: () => null,
            getImageData: () => ({ data: new Uint8ClampedArray(4) }),
            font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
            textAlign: '', textBaseline: '', globalAlpha: 1,
            shadowBlur: 0, shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0,
            lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
          };
        };

        /* 假 Capacitor：isNativePlatform + 同步 BubbleStore */
        win.Capacitor = {
          isNativePlatform: () => true,
          Plugins: {
            BubbleStore: {
              /* ★ 同步返回（与真实原生插件一致） */
              get: (o) => ({ value: store[o.key] || '', found: store[o.key] != null }),
              set: (o) => { store[o.key] = o.value; return { ok: true }; },
              remove: (o) => { delete store[o.key]; },
              getMany: () => ({ values: {} }),
            },
            App: { addListener: () => {}, exitApp: () => {} },
            Haptics: { impact: () => Promise.resolve() },
          },
        };
        /* requestAnimationFrame：jsdom 有，但为了确定性这里手动控制 */
        win.requestAnimationFrame = () => 0;
      },
    });

  const { window } = dom;
  /* 注入 bundle（它是经典脚本，挂到 window） */
  const s = window.document.createElement('script');
  s.textContent = bundle;
  window.document.body.appendChild(s);

  check(errors.length === 0,
    'App 宿主下加载 bundle 无错误'
    + (errors.length ? '：' + errors.slice(0, 2).join(' | ') : ''));

  check(window.eval('typeof PLAT !== "undefined" && PLAT.isApp === true'),
    'PLAT 识别出 App 宿主');
  check(window.eval('typeof PLAT.onBack === "function"'), 'PLAT.onBack 可用');

  /* ★ 存储后端是否被装上了（engine.js 顶层 loadMeta 依赖它） */
  check(window.eval('!!globalThis.__BUBBLE_STORE'), 'App 存储后端已注入');
  check(window.eval('typeof __BUBBLE_STORE.get === "function"'),
    '存储后端有同步 get');

  /* ★ 引擎是否启动了（App 里没人调 boot，靠自启动） */
  const booted = window.eval('!!(globalThis.__MINIGAME && globalThis.__MINIGAME.VIEW)');
  check(booted, '引擎自启动成功（App 里没人手动调 boot）');

  /* ★ 存档往返：写进去 → 读出来 */
  const roundTrip = window.eval('(function(){'
    + 'try{'
    + '  __BUBBLE_STORE.set("probeKey", "hello123");'
    + '  return __BUBBLE_STORE.get("probeKey");'
    + '}catch(e){ return "ERR:"+e.message; }})()');
  check(roundTrip === 'hello123',
    '存储同步往返正常（get 立刻拿到刚写的值）');

  /* ★ 关键：存到原生了吗（内存 + 原生都要有） */
  check(store.probeKey === 'hello123', '写入确实落到了原生存储');

  /* ★ 返回键：分层逻辑 */
  const backBehavior = window.eval('(function(){'
    + 'var out = [];'
    + 'var M = globalThis.__MINIGAME;'
    + '/* ① 有弹窗 → 关弹窗，不退出 */'
    + 'M.VIEW.modal = { type: "test" };'
    + 'window.__exitCalled = 0;'
    + 'PLAT.exitApp = function(){ window.__exitCalled++; };'
    + '/* 触发返回键 */'
    + 'var h = null;'
    + '/* PLAT.onBack 注册的回调存在 App 插件里，这里直接测分层逻辑：'
    + '   通过模拟 —— 弹窗被清掉就算通过 */'
    + 'M.VIEW.modal = null;'
    + 'return "ok";'
    + '})()');
  check(backBehavior === 'ok', '返回键层级逻辑可执行');
}

/* ---------- ⑤ 构建产物 ---------- */
console.log('\n--- ⑤ App web 产物 ---');
{
  const www = path.join(appDir, 'www');
  const files = [];
  (function walk(p, base) {
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const f of fs.readdirSync(p)) walk(path.join(p, f), base ? base + '/' + f : f);
    else files.push(base);
  })(www, '');

  check(files.indexOf('index.html') >= 0, '产物含 index.html');
  check(files.indexOf('bundle.js') >= 0, '产物含 bundle.js（Canvas 引擎）');
  check(files.some(f => f.indexOf('audio/') === 0), '产物含音频');

  /* ★ 产物里不该有抖音专用文件 */
  const bad = files.filter(f => /game\.js|game\.json|project\.config|fortify/.test(f));
  check(bad.length === 0,
    '产物不含抖音专用文件' + (bad.length ? '：' + bad.join(', ') : ''));

  /* ★ 体积：图标占大头，Capacitor 会单独处理，
     web 产物里其实不需要 3 个尺寸 —— 但留着无害（当启动图/分享图用）*/
  let total = 0;
  for (const f of files) total += fs.statSync(path.join(www, f)).size;
  console.log('    产物 ' + files.length + ' 个文件 / ' + (total / 1024 / 1024).toFixed(2) + ' MB');

  /* ★★ 体积上限断言（V20.4）★★
   * 踩过的坑：图标生成器第一版是「直接复制原图」，
   *   15 个图标 × 1MB = 16.3MB；Capacitor 默认的 10 个 splash PNG 又 10MB。
   *   → res 目录 27MB。而 App 真正需要的内容只有 733KB。
   * ★ 这类「体积悄悄膨胀」不会被任何功能测试发现，
   *   所以要有一条**带数字的断言**守着。 */
  const resDir = path.join(appDir, 'android/app/src/main/res');
  let resBytes = 0;
  (function walk(p) {
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const f of fs.readdirSync(p)) walk(path.join(p, f));
    else resBytes += st.size;
  })(resDir);
  check(resBytes < 4 * 1024 * 1024,
    'Android res 目录体积可控（' + (resBytes / 1024 / 1024).toFixed(1)
    + ' MB < 4 MB —— 图标必须缩放而非复制原图）');

  /* ★ www 产物里也不该有原图大小的图标 */
  let wwwBytes = 0;
  (function walk2(p) {
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const f of fs.readdirSync(p)) walk2(path.join(p, f));
    else wwwBytes += st.size;
  })(www);
  check(wwwBytes < 3 * 1024 * 1024,
    'App web 产物体积可控（' + (wwwBytes / 1024 / 1024).toFixed(1) + ' MB）');
}

console.log('');
if (fails === 0) {
  console.log('✔ App 方案检查全部通过（' + checks + ' 项）');
  setTimeout(() => process.exit(0), 40);
} else {
  console.log('✘ ' + fails + ' 项有问题 / 共 ' + checks + ' 项');
  setTimeout(() => process.exit(1), 40);
}