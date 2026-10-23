/**
 * 把各测试里的脚本清单统一到 tools/frontend-files.js（V20.2）
 *
 * ★ 为什么要做这件事：
 *   拆分 ui.js 后，脚本清单从 4 个变成 8 个，
 *   而每个测试各有一份自己的副本（实测 6 处硬编码 + 4 处静态分析）。
 *   ★ 手工改 6 处必然漏 —— 我第一次拆完，8 个测试全坏。
 *
 * ★★ 教训（这版与第一版的区别）：
 *   第一版用**正则**替换 `[...]` 数组字面量，
 *   结果把 `GROUPS = [{ files: [...] }, { ... }]` 这种
 *   **嵌套数组**也当成了要替换的整体 ——
 *   把 `files: [...]` 里的内容换掉后，外层结构就散了。
 *   ★ 正则不该用来改**结构化代码**。
 *     这版改成**逐处精确替换**（写死 old/new 字符串），
 *     改完立刻跑该测试验证 —��� 宁可慢，也不批量赌。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const check = process.argv.includes('--check');

/** 精确替换表：old 必须唯一 */
const FIXES = [
  /* ---------- 加载清单 ---------- */
  ['tools/dom-smoke.js',
    "const FILES = ['js/data.js', 'js/engine.js', 'js/ui.js', 'js/main.js'];",
    "const { H5_FILES: FILES } = require('./frontend-files.js');"],

  ['tools/probe.js',
    "const src = ['js/data.js', 'js/engine.js', 'js/ui.js', 'js/main.js']",
    "const src = require('./frontend-files.js').H5_FILES"],

  ['tools/bench.js',
    "const src = ['js/data.js', 'js/engine.js', 'js/ui.js', 'js/main.js']",
    "const src = require('./frontend-files.js').H5_FILES"],

  ['tools/check-dup.js',
    "const FILES = ['js/engine.js', 'js/ui.js', 'js/main.js', 'js/data.js',",
    "const FILES = require('./frontend-files.js').H5_FILES;\nconst FILES_TAIL = [/* 原来数组的其余部分 */"],

  ['tools/online-smoke.js',
    "const files = ['index.html', 'styles.css', 'js/data.js', 'js/engine.js', 'js/ui.js', 'js/main.js'];",
    "const files = ['index.html', 'styles.css'].concat(require('./frontend-files.js').H5_FILES);"],

  ['tools/symbol-check.js',
    "    files: ['js/data.js', 'js/engine.js', 'js/ui.js', 'js/main.js'],",
    "    files: require('./frontend-files.js').H5_FILES,"],

  /* ---------- 静态分析：要扫多个 ui 文件 ---------- */
  ['tools/check-deadbtn.js',
    "  const uiSrc = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');",
    "  /* ★ V20.2：ui.js 拆成了 ui.js + js/ui/*.js，\n"
    + "     静态分析必须扫**全部**，否则拆出去的 data-act 会被漏掉\n"
    + "     —— 那样「死按钮检查」会漏报（它本该是最严的那道闸）。\n"
    + "     ★ 用 frontend-files 的清单自动跟随，以后再拆文件也不用改这里。 */\n"
    + "  const UI_FILES = require('./frontend-files.js').H5_FILES.filter(f => /js\\/ui/.test(f));\n"
    + "  const uiSrc = UI_FILES.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\\n');"],

  ['tools/probe-ui-spec.js',
    "const uiJs = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');",
    "const UI_FILES = require('./frontend-files.js').H5_FILES.filter(f => /js\\/ui/.test(f));\n"
    + "const uiJs = UI_FILES.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\\n');"],
];

let ok = 0, bad = 0;
for (const [file, oldStr, newStr] of FIXES) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) { console.log('  ✘ 文件不存在：' + file); bad++; continue; }
  let src = fs.readFileSync(p, 'utf8');
  if (src.indexOf(oldStr) < 0) {
    /* 可能已经改过了 */
    if (src.indexOf(newStr) >= 0) { console.log('  · ' + file + '（已改过）'); ok++; continue; }
    console.log('  ✘ 未匹配：' + file + ' → ' + oldStr.slice(0, 52));
    bad++;
    continue;
  }
  if (!check) {
    src = src.replace(oldStr, newStr);
    fs.writeFileSync(p, src);
  }
  console.log('  ' + (check ? '·' : '✔') + ' ' + file);
  ok++;
}

console.log('');
console.log((check ? '（--check）' : '完成：')
  + ok + ' 处已统一' + (bad ? '，' + bad + ' 处需人工处理' : ''));

if (bad && !check) process.exit(1);