/**
 * 界面现状测量 —— 渲染真实 DOM 后测量，而不是凭印象评估。
 *
 * ★ 评估界面最容易犯的错是「凭代码想象界面」：
 *   变量名叫 card-h 就以为它是标题层级、写了 flex 就以为对齐没问题。
 *   实际量一遍（每个面板多高、多少张卡、字号梯队、有没有溢出），
 *   才能说清「问题在哪」。
 *
 * 用法：node tools/diag-ui.js [宽度]
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const { buildH5Env, visibleText } = require('./h5-env');

const WIDTHS = (process.argv[2] || '320,360,390,430').split(',').map(Number);
const env = buildH5Env();
const { window, doc, E } = env;
const $ = id => doc.getElementById(id);

const PANELS = ['manage', 'lab', 'up', 'staff', 'rival', 'ach'];

function boot(tab, diff) {
  const s = E.newGame(diff || 'normal', 0, null);
  /* 造一个「中后期」的 state：面板的实际内容高度取决于有多少条目，
     空局面板看起来永远是「很空」，量不出真实拥挤程度 */
  s.cash = 50000;
  for (const g of E.ING) s.inv[g.id] = 120;
  s.rep = 62;
  s.day = 14;
  for (const n of E.RESEARCH_TREE.filter(x => !x.city).slice(0, 6)) {
    const r = E.recipeById(n.recipe);
    if (r && r.research && !s.recipes.includes(r.recipe)) s.recipes.push(n.recipe);
  }
  /* ★ 不要直接写 `s.shops = 3` —— 那会造出一个「有 3 家店但没走过开店流程」
     的自相矛盾状态（候选池为空、店租没扣、店长名额对不上），
     渲染出来的东西不是玩家真会看到的。
     正确做法是走真实开店流程；现金给足让它能开满。*/
  s.cash = 1e6;
  E.openShopBranch(s);
  E.openShopBranch(s);
  for (let b = 2; b <= 3; b++) {
    const list = (s.mgrCand && s.mgrCand[b]) || [];
    if (list.length) E.hireManager(s, b, 0);
  }
  s.cash = 50000;
  window.S = s;
  window.UI.setTab(tab);
  window.UI.renderAll();
  return s;
}

/*★ 布局测量这段被移除了：jsdom 没有布局引擎，
   getBoundingClientRect() 恒返回 0，据此统计的「卡片数 / 溢出 / 最右边界」
   全是假数据（实测 320px 下最右边界也是 0）。
   要量真实布局需要真浏览器或小游戏端（Canvas 有自己的坐标系统）。
   保留下来的是下面这些**不依赖布局**的测量：字号、配色变量、断点。*/

console.log('\n=============== 字号梯队（H5） ===============');
{
  window.innerWidth = 390;
  boot('manage');
  const sizes = new Map();
  for (const el of doc.querySelectorAll('#screen-game *')) {
    const st = window.getComputedStyle(el);
    const fs = parseFloat(st.fontSize);
    if (!fs || !el.textContent.trim()) continue;
    sizes.set(fs, (sizes.get(fs) || 0) + 1);
  }
  const arr = Array.from(sizes.entries()).sort((a, b) => a[0] - b[0]);
  console.log('  出现的字号（px → 使用次数）：');
  for (const [fs, n] of arr) {
    const flag = fs < 10 ? '  ⚠️过小（中文可读性下限约 10px）' : (fs < 11 ? '  ⚠️偏小' : '');
    console.log(`    ${String(fs).padStart(5)}px → ${String(n).padStart(3)} 处${flag}`);
  }
  const tiny = arr.filter(([fs]) => fs < 10);
  console.log(`  小于 10px 的字号：${tiny.length} 种`);
}

console.log('\n=============== 配色使用统计 ===============');
{
  const css = fs_read();
  const vars = {};
  for (const m of css.matchAll(/var\((--[a-z0-9]+)\)/g)) vars[m[1]] = (vars[m[1]] || 0) + 1;
  const arr = Object.entries(vars).sort((a, b) => b[1] - a[1]);
  console.log('  CSS 变量引用次数：');
  for (const [k, n] of arr.slice(0, 12)) console.log(`    ${k.padEnd(16)} ${n}`);
  const unused = ['--pink', '--purple', '--cyan', '--amber', '--green', '--red']
    .filter(v => !vars[v]);
  console.log(`  定义了但未使用：${unused.length ? unused.join(', ') : '（无）'}`);
  /* 硬编码颜色（绕过变量体系）—— 换主题时会漏改 */
  const hex = (css.match(/#[0-9a-fA-F]{6}\b/g) || []);
  const uniq = new Set(hex);
  console.log(`  硬编码 hex：${uniq.size} 种不同颜色（换肤时需逐个替换）`);
}

function fs_read() {
  return require('fs').readFileSync(require('path').join(__dirname, '..', 'styles.css'), 'utf8');
}

console.log('\n=============== 字号令牌两版一致性 ===============');
{
  /* ★ 守住「两版字号对齐」这条不变量。
     之前 H5 最小 10px、Canvas 最小 8.5px，跨版本切换字号会跳变。
     令牌化之后两版共用同一套分档，但**约定靠注释维持不住** ——
     有人只改一版、或把某个档位调到 11.5，就悄悄漂了。
     所以这条断言直接比两边的数值。*/
  const css = fs_read();
  const cssTok = {};
  for (const m of css.matchAll(/--fs-(\w+):\s*([0-9.]+)px/g)) cssTok[m[1]] = parseFloat(m[2]);
  const mgSrc = require('fs').readFileSync(path.join(root, 'minigame', 'src', 'gfx.js'), 'utf8');
  const mgBlock = mgSrc.match(/var FS = \{([^}]*)\}/);
  const mgTok = {};
  if (mgBlock) {
    for (const m of mgBlock[1].matchAll(/(\w+):\s*([0-9.]+)/g)) mgTok[m[1]] = parseFloat(m[2]);
  }
  const keys = Object.keys(cssTok);
  const mismatch = keys.filter(k => mgTok[k] !== cssTok[k]);
  if (!mgBlock) console.log('  ✘ Canvas 端找不到 FS 常量');
  else if (mismatch.length) {
    console.log(`  ✘ 两版字号令牌不一致：${mismatch.map(k => `${k} H5=${cssTok[k]} Canvas=${mgTok[k]}`).join('；')}`);
  } else {
    console.log(`  ✔ 两版字号令牌完全一致：${keys.map(k => `${k}=${cssTok[k]}`).join(' · ')}`);
  }
  /* ★ 抓「var(--fs-xs)px」这类非法值。
     CSS 里 var() 后面接 px 是**非法声明**，浏览器不报错、直接忽略它 ——
     于是字号静默回落成继承值，页面照常渲染，只是那一处字号不对。
     批量替换字面量时最容易产生（把 '10px' 换成 'var(--fs-xs)' 漏掉 px 后缀），
     实测踩过：42 处。 */
  const badVar = [];
  for (const f of ['js/ui.js', 'styles.css']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const m = src.match(/var\(--[a-z0-9-]+\)\s*px/g);
    if (m) badVar.push(`${f}: ${m.length} 处 ${m[0]}`);
  }
  console.log(badVar.length === 0
    ? '  ✔ 无「var(--x)px」这类非法声明（CSS 会静默忽略，不报错）'
    : `  ✘ 存在非法声明：${badVar.join('；')}`);

  /* H5 端不该再有 <10px 的正文（展示级 Logo 特例除外） */
  const tiny = Array.from(css.matchAll(/font-size:\s*([0-9.]+)px/g))
    .map(m => parseFloat(m[1])).filter(v => v < 10);
  console.log(tiny.length === 0
    ? '  ✔ H5 端无小于 10px 的字号'
    : `  ✘ H5 端仍有 ${tiny.length} 处小于 10px：${[...new Set(tiny)].join(', ')}`);
}

console.log('\n=============== 响应式断点 ===============');
{
  const css = fs_read();
  const mq = css.match(/@media[^{]+/g) || [];
  console.log(`  @media 查询：${mq.length} 处`);
  for (const q of mq) console.log(`    ${q.trim()}`);
  if (!mq.length) console.log('  ⚠️ 没有任何 @media —— 响应式全靠 flex/grid 自适应，'
    + '无针对极端窄屏或大屏的显式调整');
}

console.log('\n=============== 触控目标尺寸 ===============');
{
  window.innerWidth = 390;
  boot('manage');
  const small = [];
  for (const b of doc.querySelectorAll('#screen-game .btn')) {
    const r = b.getBoundingClientRect();
    if (r.width > 0 && (r.height < 24 || r.width < 28)) {
      small.push(`${b.textContent.trim().slice(0, 10)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  }
  console.log(`  经营面板过小的按钮：${small.length} 个`);
  for (const s of small.slice(0, 6)) console.log(`    ${s}`);
  console.log('  参考：Apple HIG 建议最小 44×44pt，微信小程序建议 44px；');
  console.log('        低于 32px 在中低端机上误触率明显上升。');
}

/* ★ 必须显式退出：jsdom 的 window 会保持事件循环，
   Node 不会自然结束（表现为跑完了却卡住不退，exit code 变成 SIGTERM）。
   其他测试工具都有这一行。 */
process.exit(0);
