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

  /* ★★ 禁止绕过字号令牌 —— P0-2，机制性的防线。
     *
     * 为什么要加这条：上一轮刚把 Canvas 端 66 处 <10px 全部提到 10px，
     * 并建立了 6 档字号令牌体系。但**令牌建好不等于新代码会用它** ——
     * 紧接着写 V12/V13 时，又手写了 4 处 `font-size: 9.5px` / `9px`
     * （全在 js/ui.js 的**内联 style** 里）。
     *
     * ★ 所以光扫 styles.css 是不够的 —— 那个断言当时是绿的，
     *   因为问题在内联 style 里。两处都要扫。
     *
     * ★ 检查范围比「有没有 <10px」更宽：
     *   凡是**该用令牌**的字号（10~22px 区间）都应写成 var(--fs-*)。
     *   允许的例外只有两种：
     *     ① 令牌定义本身（--fs-xs: 10px 这类）
     *     ② 明显超出令牌范围的展示级字号（>22px，如 Logo 74px）
     */
  {
    /* ★ 范围：只卡**新增代码**（V12 段之后 + V12/V13 新增的函数）。
     *
     * 为什么不卡全部：历史遗留有 10 处（19px 的 emoji 图标、14.5px 的表头…），
     *   一次全查 = 断言一上线就是红的 = **等于没有断言**
     *   （大家会习惯性忽略红色，这条防线就废了）。
     *   历史遗留单列在《界面评估与优化建议-第二轮.md》，作为可选清理项。
     *
     * 为什么要卡新增：V12/V13 的 24 处字面量**全部是这两批新代码带来的**，
     *   而它们是在「字号令牌体系已建立」之后写的 ——
     *   说明体系存在 ≠ 会被遵守。所以防线要卡在新增上。
     */
    const V12_MARK = 'V12：店铺地图';           /* styles.css 里的分段标记 */
    const NEW_FUNCS = [                         /* js/ui.js 里 V12/V13 新增的函数 */
      'function cityMapPanelHtml', 'function cityPickerModalHtml',
      'function cityDetailModalHtml', 'function storeUpgradeHtml',
      'function storeFormerHtml', 'function storesPanelHtml',
    ];
    const offenders = [];
    /* styles.css：从 V12 段之后开始 */
    {
      const src = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
      const lines = src.split('\n');
      let from = 0;
      lines.forEach((ln, i) => { if (ln.indexOf(V12_MARK) >= 0) from = i + 1; });
      lines.forEach((ln, i) => {
        if (i + 1 <= from) return;
        if (/--fs-[a-z]+\s*:/.test(ln)) return;
        for (const m of ln.matchAll(/font-size:\s*([0-9.]+)px/g)) {
          /* ★ 判据是「**任何**字面量都不该出现在这里」，
             而不是「小于 10px 的不行」。
             初版写的是 `v >= 10 && v <= 22`（只拦令牌区间内的值）——
             结果 9.5px 被放过了，而 9.5px 恰恰是这次要修的问题本身！
             也就是说那条断言**抓不到自己要抓的东西**。
             正确判据：字面量一律不行，除了 >22px 的展示级特例（Logo 74px 等）。*/
          const v = parseFloat(m[1]);
          if (v <= 22) offenders.push(`styles.css:${i + 1} ${m[1]}`);
        }
      });
    }
    /* js/ui.js：只扫 V12/V13 新增的函数体 */
    {
      const src = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
      const lines = src.split('\n');
      let inNew = false;
      lines.forEach((ln, i) => {
        if (NEW_FUNCS.some(t => ln.indexOf(t) >= 0)) inNew = true;
        else if (inNew && ln.charAt(0) === '}') inNew = false;
        if (!inNew) return;
        for (const m of ln.matchAll(/font-size:\s*([0-9.]+)px/g)) {
          /* 同上：字面量一律不行（>22px 的展示级特例除外） */
          const v = parseFloat(m[1]);
          if (v <= 22) offenders.push(`js/ui.js:${i + 1} ${m[1]}`);
        }
      });
    }
    console.log(offenders.length === 0
      ? '  ✔ 新增代码（V12 段之后 + V12/V13 函数）字号全部走 var(--fs-*)'
      : `  ✘ ${offenders.length} 处字号该用令牌却写了字面量：\n      ${offenders.slice(0, 8).join('\n      ')}`);
  }

  /* ★★ V13.1：防「改完又长回去」的两条不变式。
     *
     * 为什么要加：这轮做了三件「修正界面」的事（P1-1 按钮加高、
     * P1-2 地图收进弹窗、P1-3 硬编码色收敛），
     * 但**没有机制防止下次改代码时又退回去** ——
     * 按钮变矮、地图重新铺开、颜色又硬编码，都是很自然的手滑。
     *
     * ★ 判据都取「可量化的下限」而不是「具体数值」：
     *   ① 触控目标：≥26px（低于 32px 在中低端机上误触率明显上升）
     *   ② 商圈页：城市地图**不得**在页面上铺开（否则又变成 3633 字的巨卡）
     *   ③ 硬编码色：新增段不得出现裸 hex
     */
  {
    const cssNow = fs_read();
    const uiNow = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
    const problems = [];

    /* ① 触控目标下限
       ★ 必须先剥掉注释 —— 否则「被注释掉的 min-height 声明」仍会被正则
         匹配到，防线就漏了（注入验证时踩到过）。 */
    /* ★ 匹配属性前要剥掉注释（被注释掉的 min-height 仍会被正则匹配到，
         防线就漏了 —— 注入验证时踩到过）。
         ★ 但**行号必须按原文算**：剥注释会改变行数，
         若拿剥后的内容找分段标记，标记本身被删掉 → from2=0 →
         整份文件都被当成「新增段」（实测报出 7 处假违规）。 */
    const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '');
    const btnXs = stripComments(cssNow).match(/\.btn-xs\s*\{[^}]*\}/);
    if (!btnXs) problems.push('找不到 .btn-xs 定义');
    else {
      const mh = btnXs[0].match(/min-height:\s*([0-9.]+)px/);
      if (!mh) problems.push('.btn-xs 没有 min-height（触控目标会退回约 20px）');
      else if (parseFloat(mh[1]) < 26) problems.push(`.btn-xs min-height=${mh[1]}px < 26px`);
    }

    /* ② 商圈页不得铺开大地图
       ★ 判据是「renderRival 里调用了哪个函数」而不是「有没有 map-svg 字面量」——
         注入时把 `cityMapPanelHtml(s)` 换成 `cityMapModalHtml(s)`，
         函数体里并没有 map-svg 字符串，按字面量判会漏（注入验证时踩到）。
       ★ 正确做法：rival 页只许调**入口条**函数（cityMapPanelHtml），
         调了**弹窗**函数（cityMapModalHtml）就是回归。 */
    const rivalFn = (uiNow.match(/UI\.renderRival = function[\s\S]*?\n};\n/) || [''])[0];
    if (/cityMapModalHtml/.test(rivalFn)) {
      problems.push('rival 页又直接渲染了完整地图（应只保留入口条 + 弹窗）');
    }

    /* ③ 新增段不得有裸 hex
       ★ 行号按**原文**算 —— 分段标记本身在注释里，
         若拿剥过注释的内容找标记，标记会被删掉 → from2=0 →
         整份文件都被当成「新增段」（实测报出 7 处假违规）。
         匹配时再逐行剥注释。 */
    const lines2 = cssNow.split('\n');
    let from2 = 0;
    lines2.forEach((ln, i) => { if (ln.indexOf('V12：店铺地图') >= 0) from2 = i + 1; });
    const bare = [];
    lines2.forEach((ln, i) => {
      if (i + 1 <= from2) return;
      const clean = ln.replace(/\/\*[\s\S]*?\*\//g, '');   /* 逐行剥注释 */
      if (/--[a-z-]+:\s*#/.test(clean)) return;              /* 变量定义行 */
      if (/gradient|linear-gradient/.test(clean)) return;    /* 渐变端点 */
      const m = clean.match(/(?<![0-9a-zA-Z-])#([0-9a-fA-F]{6})\b/g);
      if (m) bare.push(`styles.css:${i + 1} ${m[0]}`);
    });
    if (bare.length) problems.push(`新增段有 ${bare.length} 处裸 hex：${bare.slice(0, 3).join('、')}`);

    console.log(problems.length === 0
      ? '  ✔ 界面不变式守住：按钮 ≥26px · 商圈页地图收在弹窗 · 新增段无裸 hex'
      : `  ✘ ${problems.length} 项界面不变式被破坏：\n      ${problems.join('\n      ')}`);
  }
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
