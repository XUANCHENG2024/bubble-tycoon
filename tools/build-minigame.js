/* ============================================================
 *  小游戏打包
 *
 *  为什么是「拼接」而不是 require 分文件：
 *    data.js / engine.js 是浏览器经典脚本，顶层 const 属于文件作用域。
 *    拆成 CommonJS 模块就得给 H5 版也改成模块，一旦改口，两版会各自漂移 ——
 *    这正是「同一份引擎，两个渲染后端」最要避免的事。
 *    拼成单文件后，两版加载的是字节级相同的引擎代码。
 *
 *  顺序有讲究：
 *    platform.js 必须先跑（它注入存储后端），engine.js 才能拿到它。
 *    caps.js 放在 engine.js 之后 —— 它运行时要用 CFG / num / todayKey。
 * ============================================================ */
const fs = require('fs'), path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'minigame', 'src');

const PARTS = [
  ['minigame/src/platform.js', path.join(src, 'platform.js')],
  ['js/data.js（与 H5 版共用）', path.join(root, 'js', 'data.js')],
  ['js/engine.js（与 H5 版共用）', path.join(root, 'js', 'engine.js')],
  ['minigame/src/caps.js', path.join(src, 'caps.js')],
  ['minigame/src/gfx.js', path.join(src, 'gfx.js')],
  /* V15 等距投影：依赖 gfx 的绘制习惯，但**不依赖它的任何函数** ——
     放在 gfx 之后、ui 之前，ui.js 与 main.js 都能用。 */
  ['minigame/src/iso.js', path.join(src, 'iso.js')],
  ['minigame/src/ui.js', path.join(src, 'ui.js')],
  ['minigame/src/main.js', path.join(src, 'main.js')],
];

const TAIL = `
/* ---------------- 启动 ----------------
   抖音小游戏：tt 存在、document 不存在。
   浏览器预览页：document 存在且有 #gc 画布。
   Node 冒烟测试：两者都不满足，测试自行调用 __MINIGAME.boot()。 */
if (typeof tt !== 'undefined'
  || (typeof document !== 'undefined' && document.getElementById('gc'))) {
  __MINIGAME.boot();
}
`;

/**
 * 平台配置自检。
 *
 * 踩过的坑：project.config.json 里只写了 appid、没有 setting，
 * 上传时打包器读 setting.es6 直接崩 ——
 *     TypeError: Cannot read properties of undefined (reading 'es6')
 *       at transform (byted-tma-pack_v3/dest/index.js)
 * 报错信息完全没提是哪个文件，排查成本很高。
 * 所以这里在打包前把三个必要文件与 setting 一并校验掉。
 */
function checkConfig() {
  const need = [
    ['game.js', '小游戏入口（平台必需）'],
    ['game.json', '小游戏配置（平台必需）'],
    ['project.config.json', '工程配置（平台必需）'],
  ];
  let bad = 0;
  for (const [f, why] of need) {
    if (!fs.existsSync(path.join(root, 'minigame', f))) {
      console.error(`✘ 缺少 minigame/${f} —— ${why}`);
      bad++;
    }
  }

  const p = path.join(root, 'minigame', 'project.config.json');
  if (fs.existsSync(p)) {
    let c = null;
    try { c = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { console.error('✘ project.config.json 不是合法 JSON：' + e.message); bad++; }

    if (c) {
      if (!c.setting || typeof c.setting.es6 !== 'boolean') {
        console.error('✘ project.config.json 缺少 setting.es6（布尔值）—— '
          + '缺少它上传会报 "Cannot read properties of undefined (reading \'es6\')"');
        bad++;
      }
      if (!c.appid) {
        console.error('✘ project.config.json 未填 appid');
        bad++;
      }
    }
  }
  if (bad) process.exit(1);
  console.log('✔ 平台配置文件校验通过（game.js / game.json / project.config.json）');
}

function build() {
  let out = '';
  for (const [label, file] of PARTS) {
    if (!fs.existsSync(file)) {
      console.error('✘ 缺少源文件：' + file);
      process.exit(1);
    }
    let code = fs.readFileSync(file, 'utf8');
    /* 各文件自带的 'use strict' 放在中间只是个字符串字面量，
       统一剥掉，由拼接后的文件头统一开启。 */
    code = code.replace(/^'use strict';\s*/m, '');
    out += '\n/* ===== ' + label + ' ===== */\n' + code + '\n';
  }
  out = "'use strict';\n" + out + TAIL;

  /* 打包前先自己解析一遍。两个源文件各写一句顶层 `const X` 会让**后加载的那份**
     整段失效（经典脚本共享全局词法环境），打包出来的 bundle 语法上就是坏的。
     在这里挡住，比传到开发者工具里看白屏强。 */
  try {
    new (require('vm').Script)(out, { filename: 'bundle.js' });
  } catch (e) {
    console.error('✘ 拼接后的 bundle 存在语法错误（多半是顶层符号重名）：');
    console.error('  ' + String(e.message || e).split('\n').slice(0, 4).join('\n  '));
    console.error('  单独跑 `node tools/symbol-check.js` 可以看到是哪两个文件冲突。');
    process.exit(1);
  }

  const dest = path.join(root, 'minigame', 'bundle.js');
  fs.writeFileSync(dest, out);
  const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1);
  console.log('✔ 已生成 minigame/bundle.js  ' + kb + ' KB');
  console.log('  未压缩体积对首屏包很关键：当前为纯文本 JS，gzip 后通常可压到 1/3 左右。');
}

/**
 * ★★ V20.3：源文件变更检测
 *
 * ★ 为什么要它：
 *   bundle.js 是构建产物（被 .gitignore 忽略）。
 *   改了 js/engine.js 之后，如果**不重新打包**，
 *   本地 minigame-smoke 测的还是**旧引擎**。
 *
 *   ★★ 这造成了一种极其隐蔽的假象：
 *     本地测旧 bundle → 全过；CI 上没有 bundle.js（gitignore 了）
 *     → 会自动用**新引擎**重新打包 → 测的是新代码 → 挂。
 *     ★ 于是我看到的是「本地过、CI 挂」的**平台差异**假象，
 *       实际上根本不是平台问题，是**版本不一致**。
 *     ★ 我为此绕了一大圈（查行尾、查 ICU、加诊断 workflow），
 *       真正的答案是「先把 bundle 重新构建」。
 *
 *   ★ 检测方式：把源文件的内容哈希写进 bundle 旁边的标记文件，
 *     下次构建时比对 —— 不一致就重建。
 *   ★ 不用 mtime：git checkout 会改 mtime，
 *     而内容可能完全一样（会造成无谓的重建）。
 */
function srcFingerprint() {
  const crypto = require('crypto');
  const h = crypto.createHash('sha1');
  for (const [label, file] of PARTS) {
    h.update(label);
    h.update(fs.readFileSync(file));
  }
  return h.digest('hex');
}

function buildIfNeeded() {
  const stamp = path.join(root, 'minigame', '.bundle-stamp');
  const fp = srcFingerprint();
  const dest = path.join(root, 'minigame', 'bundle.js');
  let old = '';
  try { old = fs.readFileSync(stamp, 'utf8').trim(); } catch (e) { /* 没有就是首次 */ }

  if (old === fp && fs.existsSync(dest)) {
    console.log('· bundle.js 已是最新（源文件未变），跳过重建');
    return;
  }
  console.log('· 源文件已变更（或首次），重建 bundle.js');
  build();
  fs.writeFileSync(stamp, fp);
}

checkConfig();
buildIfNeeded();
