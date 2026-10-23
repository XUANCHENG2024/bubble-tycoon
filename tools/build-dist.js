/**
 * 构建发布目录（H5 版）
 *
 * ★ 为什么要单独构建，而不是直接部署项目根目录：
 *   根目录有 tools/（30 个测试脚本）、docs/、minigame/、.git/ —— 
 *   那些**不该上线**：一是体积（tools 里的探针要读源码文件），
 *   二是暴露内部实现。
 * ★ 产出只含真正需要的 9 个文件，2.2MB，零外部依赖。
 *
 * 用法：node tools/build-dist.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist');

/* ★ 只带这些：静态资源 + 逻辑。不带 tools/docs/minigame/.git */
const INCLUDE = ['index.html', 'styles.css'];
const INCLUDE_DIRS = ['js', 'assets'];
/* ★ V20.2：js/ 现在还有子目录 js/ui/ —— cpSync 递归复制会自动带上，
   不需要单独列出。保留这条注释是为了以后有人改 INCLUDE_DIRS 时知道。 */

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const f of INCLUDE) {
  fs.copyFileSync(path.join(root, f), path.join(out, f));
  console.log('  + ' + f);
}
for (const d of INCLUDE_DIRS) {
  fs.cpSync(path.join(root, d), path.join(out, d), { recursive: true });
  const n = fs.readdirSync(path.join(out, d)).length;
  console.log('  + ' + d + '/  (' + n + ' 个文件)');
}

/* 保留 .gitignore（否则 dist/ 不会进版本库） */
fs.writeFileSync(
  path.join(out, '.gitignore'),
  '# dist 是构建产物（由 tools/build-dist.js 生成），不进版本库。\n'
  + '# 但目录本身需要保留一个文件，否则 git 不会跟踪它。\n*\n!.gitignore\n');

/* 自检：index.html 引用的文件是否都在 */
const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map(m => m[1])
  .filter(p => !/^https?:/.test(p));
let bad = 0;
for (const r of refs) {
  if (!fs.existsSync(path.join(out, r))) { console.error('  ✘ 缺失: ' + r); bad++; }
}
console.log('');
console.log(bad === 0
  ? '✔ dist 构建完成（引用完整，' + refs.length + ' 个资源）'
  : '✘ 有 ' + bad + ' 个缺失');
process.exit(bad === 0 ? 0 : 1);
