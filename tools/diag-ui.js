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