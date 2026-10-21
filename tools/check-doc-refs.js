/**
 * 文档交叉引用检查：所有《xxx.md》是否指向真实存在的文件。
 *
 * ★ 为什么需要它：
 *   文档归档进 docs/ 后，裸文件名引用会全部断掉。
 *   而「实施记录」的价值恰恰在于串起相关文档 ——
 *   **断掉的引用比没归档更糟**（后者至少文件还在原地）。
 *   归档当时人工修了 13 处，但下一次加文档还会断。
 *   所以固化成检查项，接进 CI。
 *
 * 用法：node tools/check-doc-refs.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const files = walk(root, []);
const PAT = /《([^《》]*?\.md)》/g;

let total = 0;
const bad = [];

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(root, f);
  const base = path.dirname(f);
  let m;
  PAT.lastIndex = 0;
  while ((m = PAT.exec(src)) !== null) {
    /* 跳过**说明性文字**里的引用格式举例。
       docs/README.md 里写了「统一写成 《相对路径.md》」这句话，
       它是格式说明不是真引用 —— 不跳过就会报假断链，
       而**长期误报的检查会让人习惯性忽略红色**（同 xss-verify 那次教训）。*/
    const ctx = src.slice(Math.max(0, m.index - 30), m.index);
    if (/写成|格式|例如|统一|见：|如下/.test(ctx)) continue;
    total++;
    const target = path.resolve(base, m[1]);
    if (!fs.existsSync(target)) {
      bad.push(`${rel} → 《${m[1]}》`);
    }
  }
}

console.log('共检查 %d 处引用（%d 份文档）', total, files.length);
if (bad.length) {
  console.log('✘ %d 处断链：', bad.length);
  for (const b of bad) console.log('   ', b);
  process.exit(1);
} else {
  console.log('✔ 全部引用有效（零断链）');
}
