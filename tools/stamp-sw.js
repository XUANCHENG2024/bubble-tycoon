#!/usr/bin/env node
/* 把「内容指纹」写进 sw.js 的 ASSETS_HASH。
 *
 * ★ 解决的问题：改了 js/ui.js 却忘了改 VERSION，老访客会一直拿旧缓存。
 *   本轮（V21）这件事发生了两次 —— 第二次还是"改完 ui.js 才想起来"。
 *   靠人记不可行，所以让缓存键跟着内容走：文件一变，CACHE 名就变，旧缓存自动失效。
 *
 * ★ 用法：
 *     node tools/stamp-sw.js          # 计算并写入
 *     node tools/stamp-sw.js --check  # 只校验（CI 用），不写文件
 *
 * ★ 什么时候跑：任何一次改动 ASSETS 里的文件之后。
 *   忘了跑也不要紧 —— check-web 会报"指纹与文件不一致"，CI 直接红。
 */
const fs = require('fs');
const path = require('path');
const { readAssets, contentHash } = require('./lib/sw-assets');

const root = path.join(__dirname, '..');
const swPath = path.join(root, 'sw.js');
const src = fs.readFileSync(swPath, 'utf8');

const list = readAssets(src);
if (!list.length) {
  console.error('✘ sw.js 里没有解析到 ASSETS —— 解析规则可能和文件结构脱节了');
  process.exit(1);
}
const hash = contentHash(root, list);
const cur = (src.match(/const ASSETS_HASH = '([0-9a-f]{8})'/) || [])[1];

const checkOnly = process.argv.includes('--check');

if (checkOnly) {
  if (cur === hash) {
    console.log(`✔ 指纹一致（${hash}，${list.length} 个文件）`);
    process.exit(0);
  }
  console.error(`✘ 指纹不一致：sw.js 里是 ${cur}，实际内容算出 ${hash}`);
  console.error('  → 运行 node tools/stamp-sw.js 更新（改过 ASSETS 里的文件就必须更新）');
  process.exit(1);
}

if (cur === hash) {
  console.log(`· 指纹已是最新（${hash}），无需改动`);
  process.exit(0);
}
const out = src.replace(/const ASSETS_HASH = '[0-9a-f]{8}';/, `const ASSETS_HASH = '${hash}';`);
fs.writeFileSync(swPath, out);
console.log(`✔ 已写入指纹 ${cur} → ${hash}（${list.length} 个文件）`);
