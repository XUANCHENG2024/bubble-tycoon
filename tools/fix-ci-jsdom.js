/**
 * 给三个 workflow 插入「装 jsdom + 设 JSDOM_PATH」步骤
 *
 * ★ 用精确替换，不用正则（V20.2 的教训：正则不该用来改结构化代码）。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const STEPS = `      # ★ 装 jsdom —— 四个 DOM 测试需要它
      #   （browser-smoke / mobile-smoke / xss-verify / check-dist-boot）
      # ★ 装到 .ci-node/ 而不是 node_modules/：
      #   项目根刻意保持零依赖（无 package.json），
      #   不想让 clone 的人以为要跑 npm install。
      - name: 安装 jsdom（DOM 测试依赖）
        run: node tools/install-jsdom.js

      # ★ 后续步骤统一读这个变量
      - name: 设置 JSDOM_PATH
        run: echo "JSDOM_PATH=$PWD/.ci-node/node_modules/jsdom" >> $GITHUB_ENV
`;

/** [文件, 锚点字符串] —— 锚点后插入 STEPS */
const TARGETS = [
  ['.github/workflows/quick-check.yml',
    `      - uses: actions/setup-node@v4
        with:
          node-version: '22'
`],
  ['.github/workflows/full-check.yml',
    `      - uses: actions/setup-node@v4
        with:
          node-version: '22'
`],
  ['.github/workflows/pages.yml',
    `      - uses: actions/setup-node@v4
        with:
          node-version: '22'
`],
];

let ok = 0, bad = 0;
for (const [file, anchor] of TARGETS) {
  const p = path.join(root, file);
  let src = fs.readFileSync(p, 'utf8');
  if (src.indexOf('安装 jsdom（DOM 测试依赖）') >= 0) {
    console.log('  · ' + file + '（已插入）');
    ok++;
    continue;
  }
  if (src.indexOf(anchor) < 0) {
    console.log('  ✘ 锚点未匹配：' + file);
    bad++;
    continue;
  }
  src = src.replace(anchor, anchor + '\n' + STEPS);
  fs.writeFileSync(p, src);
  console.log('  ✔ ' + file);
  ok++;
}

console.log('');
console.log(ok + ' 处已插入' + (bad ? '，' + bad + ' 处需人工处理' : ''));
if (bad) process.exit(1);