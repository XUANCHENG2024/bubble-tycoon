/**
 * 把 4 处重复的「内联 script」逻辑统一到 tools/inline-scripts.js（V20.2）
 *
 * ★ 精确替换，逐处验证。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const check = process.argv.includes('--check');

const OLD = `html.replace(/<script src="js\\/([a-z]+)\\.js"><\\/script>/g,
  (m, name) => '<script>' + fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8') + '<\\/script>');`;

const OLD2 = `html.replace(/<script src="js\\/([a-z]+)\\.js"><\\/script>/g,
    (m, name) => '<script>' + fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8') + '<\\/script>');`;

const OLD3 = `srcHtml.replace(/<script src="js\\/([a-z]+)\\.js"><\\/script>/g,
  (m, n) => '<script>' + fs.readFileSync(path.join(root, 'js', n + '.js'), 'utf8') + '<\\/script>');`;

const OLD4 = `rawHtml.replace(/<script src="js\\/([a-z]+)\\.js"><\\/script>/g,
  (m, n) => '<script>' + fs.readFileSync(path.join(root, 'js', n + '.js'), 'utf8') + '<\\/script>');`;

/** [文件, 旧串, 新串] */
const FIXES = [
  ['tools/browser-smoke.js', OLD,
    "html = inlineScripts(root, html);"],
  ['tools/h5-env.js', OLD,
    "html = inlineScripts(root, html);"],
  ['tools/mobile-smoke.js', OLD3,
    "const srcHtml = inlineScripts(root, rawHtml);"],
  ['tools/dom-smoke.js', OLD2, null],  /* 已经是 FILES 方式，不改 */
];

let ok = 0, bad = 0;
for (const [file, oldStr, newStr] of FIXES) {
  if (!newStr) continue;
  const p = path.join(root, file);
  let src = fs.readFileSync(p, 'utf8');
  if (src.indexOf(oldStr) < 0) {
    if (src.indexOf('inlineScripts') >= 0) { console.log('  · ' + file + '（已改）'); ok++; continue; }
    console.log('  ✘ 未匹配：' + file);
    bad++;
    continue;
  }
  if (!check) {
    src = src.replace(oldStr, newStr);
    /* 加 require —— 放在文件已有的 require 之后 */
    if (src.indexOf("require('./inline-scripts.js')") < 0) {
      const anchor = "const path = require('path');";
      if (src.indexOf(anchor) >= 0) {
        src = src.replace(anchor, anchor + "\nconst { inlineScripts } = require('./inline-scripts.js');");
      } else {
        const a2 = "require('fs');";
        src = src.replace(a2, a2 + "\nconst { inlineScripts } = require('./inline-scripts.js');");
      }
    }
    fs.writeFileSync(p, src);
  }
  console.log('  ' + (check ? '·' : '✔') + ' ' + file);
  ok++;
}

console.log('');
console.log((check ? '（--check）' : '完成：') + ok + ' 处' + (bad ? '，' + bad + ' 处未匹配' : ''));
if (bad && !check) process.exit(1);