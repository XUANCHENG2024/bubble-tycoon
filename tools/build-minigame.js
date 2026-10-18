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
 * ============================================================ */
const fs = require('fs'), path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'minigame', 'src');

const PARTS = [
  ['minigame/src/platform.js', path.join(src, 'platform.js')],
  ['js/data.js（与 H5 版共用）', path.join(root, 'js', 'data.js')],
  ['js/engine.js（与 H5 版共用）', path.join(root, 'js', 'engine.js')],
  ['minigame/src/gfx.js', path.join(src, 'gfx.js')],
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

  const dest = path.join(root, 'minigame', 'bundle.js');
  fs.writeFileSync(dest, out);
  const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1);
  console.log('✔ 已生成 minigame/bundle.js  ' + kb + ' KB');
  console.log('  未压缩体积对首屏包很关键：当前为纯文本 JS，gzip 后通常可压到 1/3 左右。');
}

build();
