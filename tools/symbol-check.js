/* ============================================================
 *  全局符号冲突静态检查
 *
 *  为什么需要单独一个脚本：
 *    H5 端四个 js 文件是**分别求值**的经典脚本，共享同一个全局词法环境。
 *    两个文件里各写一句顶层 `const X = ...`，不是「后者覆盖前者」，
 *    而是让**后加载的那一个文件整份解析失败** —— 页面表现为白屏或若干交互
 *    静默失效，控制台只留一句 "Identifier 'X' has already been declared"。
 *
 *    四个冒烟脚本里只有 dom-smoke 会把它们拼成一整段再求值，
 *    所以只有它会当场抛 SyntaxError；browser / mobile / minigame 三套
 *    顶多是某些断言悄悄不生效，看起来还是绿的。这里统一挡住。
 *
 *  做法：按真实加载顺序拼接，交给 V8 自己解析 —— 零误报，
 *    比正则扫 `^const` 可靠（正则扫不出块级作用域、也分不清字符串里的同名字样）。
 * ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');

const GROUPS = [
  {
    name: 'H5（index.html 的 script 顺序）',
    files: require('./frontend-files.js').H5_FILES,
  },
  {
    name: '抖音小游戏（build-minigame.js 的拼接顺序）',
    files: ['minigame/src/platform.js', 'js/data.js', 'js/engine.js',
      'minigame/src/caps.js', 'minigame/src/gfx.js', 'minigame/src/ui.js', 'minigame/src/main.js'],
  },
];

let bad = 0;
for (const g of GROUPS) {
  const src = g.files.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n;\n');
  try {
    new vm.Script(src, { filename: g.name });
    console.log(`  ✔ ${g.name}：${g.files.length} 个文件，无顶层符号冲突`);
  } catch (e) {
    bad++;
    /* 语法错误里带文件名和行号，截断一下免得刷屏 */
    const msg = String(e.message || e).split('\n').slice(0, 4).join('\n      ');
    console.log(`  ✘ ${g.name}：\n      ${msg}`);
  }
}

console.log('');
if (bad === 0) console.log('✅ 全局符号检查通过');
else console.log(`❌ ${bad} 组存在顶层符号冲突（会导致后加载的文件整份失效）`);
process.exit(bad === 0 ? 0 : 1);
