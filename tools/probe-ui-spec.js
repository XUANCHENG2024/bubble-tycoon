/**
 * 研发界面规范体检（V18）
 *
 * ★ 目标是找**可量化的规范问题**，而不是审美判断：
 *   「颜色不统一」不可测，「这个色值在别处出现过 7 次」可测。
 *
 * ★ 覆盖五组：
 *   ① 视觉规范：硬编码色值/字号/圆角/间距的散落程度
 *   ② 布局：栅格与断点、溢出风险
 *   ③ 交互：加载态/空状态/禁用态/错误提示是否齐备
 *   ④ 可访问性：对比度、键盘可达、焦点可见、语义标签
 *   ⑤ 可维护性：重复结构
 */
const fs = require('fs'), path = require('path');
const { buildH5Env } = require('./h5-env.js');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const UI_FILES = require('./frontend-files.js').H5_FILES.filter(f => /js\/ui/.test(f));
const uiJs = UI_FILES.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');

/* 研发界面涉及的文件范围 */
const LAB_FUNCS = ['renderLab', 'recipeNodeCardHtml', 'labFoldNavHtml', 'cityBarHtml', 'sigCardHtml'];
function sliceFunc(name) {
  const i = uiJs.indexOf('function ' + name);
  if (i < 0) return '';
  /* 从函数头扫到配平的收尾大括号 */
  let d = 0, started = false;
  for (let j = i; j < uiJs.length; j++) {
    if (uiJs[j] === '{') { d++; started = true; }
    else if (uiJs[j] === '}') { d--; if (started && d === 0) return uiJs.slice(i, j + 1); }
  }
  return uiJs.slice(i, i + 4000);
}
const labSrc = LAB_FUNCS.map(sliceFunc).join('\n');

console.log('=== 研发界面规范体检（V18）===\n');

/* ---------- ① 视觉规范 ---------- */
console.log('--- ① 视觉规范：硬编码散落 ---');
{
  /* ★ 研发界面 JS 里直接写死的颜色/尺寸 */
  const hexInJs = [...labSrc.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0].toLowerCase());
  const rgbaInJs = [...labSrc.matchAll(/rgba\([^)]+\)/g)].map(m => m[0]);
  const pxInJs = [...labSrc.matchAll(/\b\d+px\b/g)].map(m => m[0]);

  const uniq = a => [...new Set(a)];
  const hexUniq = uniq(hexInJs), rgbaUniq = uniq(rgbaInJs);

  console.log(`  JS 内写死的颜色：${hexInJs.length} 处（${hexUniq.length} 个不同色值）/ rgba ${rgbaInJs.length} 处（${rgbaUniq.length} 个）`);
  console.log(`  JS 内写死的尺寸：${pxInJs.length} 处 px`);
  console.log(`  十六进制色值样本：${hexUniq.slice(0, 6).join(' ') || '（无）'}`);

  /* CSS 变量有多少个？研发界面用到几个？ */
  const vars = [...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map(m => m[1]);
  console.log(`  CSS 变量总数：${vars.length}`);
  const labVars = [...labSrc.matchAll(/var\((--[\w-]+)\)/g)].map(m => m[1]);
  console.log(`  研发界面用到的变量：${uniq(labVars).length} 个`);

  /* ★ 内联 style 里的字号 —— 绕过字号规范 */
  const inlineFs = [...labSrc.matchAll(/font-size:\s*([^;"']+)/g)].map(m => m[1].trim());
  console.log(`  内联 font-size：${inlineFs.length} 处`);
  const uniqFs = uniq(inlineFs);
  console.log(`    取值：${uniqFs.slice(0, 8).join(' | ')}`);

  /* ★ 结论：硬编码越多，越难统一 */
  const ratio = hexInJs.length + rgbaInJs.length;
  console.log(`  ★ 硬编码颜色共 ${ratio} 处 —— ${ratio > 30 ? '严重散落，应收敛到令牌' : ratio > 10 ? '偏多' : '可接受'}`);
}

/* ---------- ② 布局与响应式 ---------- */
console.log('\n--- ② 布局：栅格与断点 ---');
{
  /* CSS 里的媒体查询 */
  const mqs = [...css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map(m => Number(m[1]));
  const uniq = [...new Set(mqs)].sort((a, b) => b - a);
  console.log(`  断点（max-width）：${uniq.join(' / ')} px`);

  /* 断点覆盖是否完整：常见机型都要有 */
  const NEED = [320, 360, 390, 414, 768, 1024];
  const missing = NEED.filter(w => !uniq.some(b => b >= w));
  console.log(`  覆盖检查：${missing.length ? '缺 ' + missing.join('/') : '全覆盖'}`);

  /* 研发界面用到的 grid */
  const gridCols = [...css.matchAll(/grid-template-columns:\s*([^;]+);/g)].map(m => m[1].trim());
  const fixed = gridCols.filter(g => /repeat\(\s*\d/.test(g));
  console.log(`  固定列数栅格 ${fixed.length} 处：${[...new Set(fixed)].slice(0, 4).join(' | ')}`);
  console.log(`  ★ 固定列数在窄屏会被挤 —— 应优先用 repeat(auto-fit, minmax(...))`);

  /* overflow-x 保护 */
  const oxGuard = css.includes('overflow-x: hidden') || css.includes('overflow-x:hidden');
  const bodyRule = css.match(/(body|#app)\s*\{[^}]*overflow-x[^}]*\}/);
  console.log(`  横向溢出保护：${bodyRule ? '✔ ' + bodyRule[0].slice(0, 60) : '✘ 未在 body/#app 上设 overflow-x'}`);
}

/* ---------- ③ 交互状态 ---------- */
console.log('\n--- ③ 交互状态齐备度 ---');
{
  const { window, doc } = buildH5Env();
  window.eval('window.S = newGame("normal", 0, null); window.S.cash = 300000;');
  window.eval('UI.setTab("lab"); UI.renderAll();');

  const probe = window.eval('(function(){'
    + 'var el = document.getElementById("panel-lab");'
    + 'return {'
    + '  empty: !!el.querySelector(".empty, .rc-empty, .ach-empty"),'
    + '  disabled: el.querySelectorAll("[disabled]").length,'
    + '  loading: !!el.querySelector(".loading, .spinner, .skeleton"),'
    + '  focusable: el.querySelectorAll("button, [tabindex], a, select, input").length,'
    + '  role: el.querySelectorAll("[role]").length,'
    + '  aria: el.querySelectorAll("[aria-label], [aria-describedby], [aria-live]").length,'
    + '  total: el.querySelectorAll("*").length,'
    + '  imgs: el.querySelectorAll("img").length,'
    + '  divClick: Array.prototype.filter.call(el.querySelectorAll("div"),'
    + '    function(n){ return n.onclick || n.getAttribute("data-act"); }).length'
    + '};'
    + '})()');

  console.log(`  空状态标记：${probe.empty ? '✔' : '✘ 没有（研发树为空时会是白屏）'}`);
  console.log(`  禁用态：${probe.disabled} 个元素带 disabled`);
  console.log(`  加载态：${probe.loading ? '✔' : '✘ 没有'}`);
  console.log(`  可聚焦元素：${probe.focusable} 个`);
  console.log(`  role 属性：${probe.role} 个`);
  console.log(`  aria 属性：${probe.aria} 个`);
  console.log(`  div 上挂 data-act：${probe.divClick} 个${probe.divClick > 0 ? '← 不可聚焦，键盘用户点不到' : ''}`);
  console.log(`  ★ 语义化比例：role+aria ${probe.role + probe.aria} / ${probe.total} 个元素`);
}

/* ---------- ④ 可访问性 ---------- */
console.log('\n--- ④ 可访问性 ---');
{
  /* 焦点样式 */
  const focusStyle = /:focus/.test(css) || /outline\s*:/.test(css);
  const focusDetail = css.match(/\.([\w-]+):focus[^{]*\{[^}]*\}/);
  console.log(`  焦点样式：${focusStyle ? '✔ ' + (focusDetail ? focusDetail[0].slice(0, 70) : '（有 :focus 但内容需确认）') : '✘ 完全没有 :focus 样式'}`);
  const outlineNone = [...css.matchAll(/outline:\s*(none|0)/g)].length;
  console.log(`  outline:none 出现 ${outlineNone} 次${outlineNone > 0 ? '← 可能让键盘用户失去焦点提示' : ''}`);

  /* 颜色对比度：检查常用文字色与背景 */
  const bgVars = {};
  for (const m of css.matchAll(/(--[\w-]+):\s*([^;]+);/g)) bgVars[m[1]] = m[2].trim();
  const hexToRgb = h => {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const lum = ([r, g, b]) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (a, b) => {
    const l1 = lum(hexToRgb(a)), l2 = lum(hexToRgb(b));
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const pairs = [
    ['--txt', '--bg'], ['--txt2', '--bg'], ['--txt3', '--bg'],
    ['--cyan', '--bg'], ['--green', '--bg'], ['--amber', '--bg'], ['--red', '--bg'],
  ];
  console.log('  对比度（WCAG AA 正文需 ≥4.5，大字/图形 ≥3）：');
  for (const [fg, bg] of pairs) {
    const f = bgVars[fg], b = bgVars[bg];
    if (!f || !b) { console.log(`    ${fg} → 未定义，跳过`); continue; }
    /* 只测纯色，rgba/txt3 常是半透明 */
    if (!/^#[0-9a-f]{6}$/i.test(f) || !/^#[0-9a-f]{6}$/i.test(b)) {
      console.log(`    ${fg} vs ${bg}: ${f} / ${b}（非纯色，需实测）`);
      continue;
    }
    const r = contrast(f, b);
    const pass = r >= 4.5 ? 'AA ✔' : (r >= 3 ? 'AA-large ✔' : '✘ 不达标');
    console.log(`    ${fg} vs ${bg}: ${r.toFixed(2)}:1  ${pass}`);
  }
}

/* ---------- ⑤ 可维护性 ---------- */
console.log('\n--- ⑤ 可维护性：重复结构 ---');
{
  /* 研发界面里的重复 HTML 片段 */
  const cardHeads = [...labSrc.matchAll(/<div class="card-h">([^<]{2,30})/g)].map(m => m[1].trim());
  console.log(`  card-h 出现 ${cardHeads.length} 次：${[...new Set(cardHeads)].join(' | ')}`);

  /* 重复的内联 style（同一属性反复出现）*/
  const inlineStyles = [...labSrc.matchAll(/style="([^"]{8,})"/g)].map(m => m[1]);
  const uniqStyles = [...new Set(inlineStyles)];
  console.log(`  内联 style ${inlineStyles.length} 处 / ${uniqStyles.length} 种不同写法`);
  console.log(`    样本：${uniqStyles.slice(0, 3).map(s => s.slice(0, 46)).join(' || ')}`);
  console.log(`  ★ ${uniqStyles.length > 6 ? '内联样式种类偏多，应抽成类' : '尚可'}`);

  /* 重复的圆角值 */
  const radii = [...css.matchAll(/border-radius:\s*([^;]+);/g)].map(m => m[1].trim());
  const radiusCount = {};
  radii.forEach(r => { radiusCount[r] = (radiusCount[r] || 0) + 1; });
  const topR = Object.entries(radiusCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`  圆角取值 ${Object.keys(radiusCount).length} 种，最常用：`);
  topR.forEach(([r, n]) => console.log(`    ${String(n).padStart(3)} 次  ${r}`));
  console.log(`  ★ 圆角种类 ${Object.keys(radiusCount).length} 种 —— 超过 6 种说明缺设计令牌`);
}

console.log('\n（体检完成，数字用于指导改造）');
process.exit(0);