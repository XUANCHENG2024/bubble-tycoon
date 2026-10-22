/**
 * 研发界面规范检查（V18）
 *
 * ★ 守的是「这轮打磨的成果不被改回去」：
 *   ① 可访问性：分组头可聚焦 / aria 属性 / 焦点样式
 *   ② 视觉规范：圆角与间距收敛到令牌（裸 px 归零）
 *   ③ 布局：横向溢出保护 / 断点覆盖
 *   ④ 交互状态：空状态 / 禁用态
 *
 * ★ 这条检查的价值在于**它是量化的**：
 *   「视觉更统一了」不可测，「研发界面的裸 px 圆角从 9 降到 0」可测。
 */
const fs = require('fs'), path = require('path');
const { buildH5Env } = require('./h5-env.js');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

let fails = 0, checks = 0;
function check(cond, label) {
  checks++;
  if (cond) { console.log('  ✔ ' + label); return true; }
  fails++;
  console.log('  ✘ ' + label);
  return false;
}

/* ★ vm 查询一律用 Node 侧字符串拼接 ——
   模板字符串的 ${} 会被外层吃掉，静默产出「查了 0 个但通过」的假通过。 */
const q = (sel) => '(function(){var el=document.getElementById("panel-lab");'
  + 'return el ? el.querySelectorAll(' + JSON.stringify(sel) + ').length : -1;})()';

console.log('=== 研发界面规范检查（V18）===\n');

/* ---------- ① 可访问性 ---------- */
console.log('--- ① 可访问性 ---');
{
  const { window } = buildH5Env();
  window.eval('window.S = newGame("normal", 0, null); window.S.cash = 300000;');
  window.eval('UI.setTab("lab"); UI.renderAll();');

  const headBtn = window.eval(q('button.cui-head'));
  const headDiv = window.eval(q('div.cui-head'));
  check(headBtn > 0 && headDiv === 0,
    '分组头是 button（' + headBtn + ' 个，残留 div ' + headDiv + '）');

  /* ★ 关键：所有挂 data-act 的**可点击**元素都必须可聚焦。
     div[data-act] 是这轮之前最大的可访问性缺口。 */
  const unFocusable = window.eval(
    '(function(){var el=document.getElementById("panel-lab");'
    + 'if(!el) return -1;'
    + 'var bad=0;'
    + 'Array.prototype.forEach.call(el.querySelectorAll("[data-act]"), function(n){'
    + '  if (n.tagName==="BUTTON" || n.tagName==="A" || n.tagName==="INPUT"'
    + '      || n.tagName==="SELECT" || n.getAttribute("tabindex")!==null) return;'
    + '  bad++;'
    + '});'
    + 'return bad;})()');
  check(unFocusable === 0,
    '没有不可聚焦的可点击元素（残留 ' + unFocusable + '）');

  check(window.eval(q('[aria-expanded]')) > 0,
    '折叠控件带 aria-expanded（' + window.eval(q('[aria-expanded]')) + ' 个）');
  check(window.eval(q('[aria-controls]')) > 0,
    'aria-controls 指向内容区（' + window.eval(q('[aria-controls]')) + ' 个）');
  check(window.eval(q('[role="tablist"]')) > 0, '导航条有 role=tablist');

  /* 焦点样式 */
  check(/:focus-visible/.test(css), '有 :focus-visible 焦点样式');
  /* ★ 要匹配**全局兜底**那条（`:focus-visible { ... }`），
     而不是 `.rc:focus-within` —— 后者用 box-shadow，
     会让判据误报「焦点样式不含 outline」。
     ★ 用选择器部分只含 :focus-visible 的那条来判。 */
  const globalFocus = css.match(/^\s*:focus-visible\s*\{[^}]*\}/m);
  check(!!globalFocus && /outline/.test(globalFocus[0]),
    '全局焦点样式含 outline'
    + (globalFocus ? '（' + globalFocus[0].replace(/\s+/g, ' ').trim().slice(0, 52) + '）' : ''));
}

/* ---------- ② 视觉规范 ---------- */
console.log('\n--- ② 视觉规范收敛 ---');
{
  /* 圆角令牌必须齐全 */
  const needVars = ['--r-xs', '--r-sm', '--r-md', '--r-lg', '--r-xl', '--r-pill',
    '--sp-1', '--sp-2', '--sp-3', '--sp-4'];
  const missing = needVars.filter(v => !new RegExp('\\' + v + '\\s*:').test(css));
  check(missing.length === 0,
    needVars.length + ' 个设计令牌齐全'
    + (missing.length ? '（缺：' + missing.join('、') + '）' : ''));

  /* ★ 研发界面相关的类里不该再有裸 px圆角。
     这是本轮最核心的量化目标：散落的 7/8/9/99/999px 全部收敛。
     ★ 注意用 [...matchAll] 扫**整条规则**而不是 `[^}]*border-radius`——
       一条规则里可能有多处圆角，只取首个会漏。
       ★ 且要排除 V18 末尾那段「收敛清单」本身 —— 它写的都是 var()，
       所以不影响；但如果以后在那里写裸 px，就会自相矛盾。这里只查裸 px。 */
  const LAB_CLASSES = ['rc', 'cui-head', 'cui-group', 'cui-grid', 'navchip',
    'tree-stage', 'rc-tip', 'labnav', 'ing-link', 'ing-use', 'ing-chip',
    'ach-fold', 'fold-sum', 'rc-tag', 'empty', 'cui-ws'];
  let bare = 0, bareSamples = [];
  for (const c of LAB_CLASSES) {
    const esc = c.replace(/[-]/g, '\\-');
    /* 匹配这些类的所有规则块，再在块内找裸 px圆角 */
    const rules = new RegExp('\\.' + esc + '(?![\\w-])[^{}]*\\{[^{}]*\\}', 'g');
    for (const rm of css.matchAll(rules)) {
      for (const bm of rm[0].matchAll(/border-radius:\s*([0-9]+px)/g)) {
        bare++;
        bareSamples.push(c + ':' + bm[1]);
      }
    }
  }
  check(bare === 0,
    '研发界面圆角已全部收敛到令牌（残留裸 px ' + bare + ' 处'
    + (bareSamples.length ? '：' + [...new Set(bareSamples)].slice(0, 4).join(' ') : '') + '）');

  /* 对比度：研发界面主背景上的文字 */
  const V = {};
  for (const m of css.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) V[m[1]] = m[2];
  const hex = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const lum = ([r, g, b]) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const cr = (a, b) => {
    const l1 = lum(hex(a)), l2 = lum(hex(b));
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const bg = V['--bg1'] || '#22103f';
  const lowContrast = [];
  for (const fg of ['--txt', '--txt2', '--txt3']) {
    if (!V[fg]) continue;
    const r = cr(V[fg], bg);
    if (r < 4.5) lowContrast.push(fg + ' ' + r.toFixed(2) + ':1');
  }
  check(lowContrast.length === 0,
    '研发界面正文对比度全部 ≥4.5:1'
    + (lowContrast.length ? '（不达标：' + lowContrast.join('、') + '）' : ''));
}

/* ---------- ③ 布局与响应式 ---------- */
console.log('\n--- ③ 布局与响应式 ---');
{
  check(/overflow-x:\s*clip/.test(css) || /overflow-x:\s*hidden/.test(css),
    '有横向溢出保护');

  /* ★ min-width 与 max-width 都算断点。
     第一版只匹配 max-width，把 V18 新加的 768/1024（min-width）全漏了，
     于是「缺 768/1024」的报错本身就是误报。 */
  const mqs = [...css.matchAll(/@media\s*\((?:min|max)-width:\s*(\d+)px\)/g)]
    .map(m => Number(m[1]));
  const uniq = [...new Set(mqs)];
  /* 需要「至少有一个断点覆盖这个宽度」：
     min-width:768 覆盖 ≥768；max-width:640 覆盖 ≤640；
     两者之间（641~767）靠基础样式，所以只查关键档。 */
  const covered = (w) => uniq.some(b => b === w) || uniq.some(b => b > w && b < w + 120);
  const NEED = [320, 390, 640, 768, 1024];
  const miss = NEED.filter(w => !covered(w));
  check(miss.length === 0,
    '断点覆盖 ' + NEED.join('/') + '（现有：' + uniq.sort((a, b) => a - b).join('/') + '）'
    + (miss.length ? '，缺 ' + miss.join('/') : ''));

  /* ★ overflow-x: clip 而不是 hidden —— sticky 的祖先不能是 overflow:hidden，
     而研发页的导航条正是 sticky。这个约束要在样式里写明。 */
  const usesClip = /overflow-x:\s*clip/.test(css);
  const hasSticky = /position:\s*sticky/.test(css);
  check(!hasSticky || usesClip,
    hasSticky
      ? '有 sticky 元素且用 overflow-x:clip（hidden 会让 sticky 失效）'
      : '无 sticky 元素');
}

/* ---------- ④ 交互状态 ---------- */
console.log('\n--- ④ 交互状态 ---');
{
  const { window } = buildH5Env();
  window.eval('window.S = newGame("normal", 0, null); window.S.cash = 300000;');
  window.eval('UI.setTab("lab"); UI.renderAll();');

  /* 禁用态：研发页一定有「不能点」的节点（不在本店 / 没解锁） */
  const disabled = window.eval(q('[disabled]'));
  check(disabled > 0, '研发页有禁用态（' + disabled + ' 个 disabled 元素）');

  /* 空状态：渲染代码里要有 */
  const { window: w2 } = buildH5Env();
  w2.eval('window.S = newGame("normal", 0, null);');
  const srcHas = /class="empty"/.test(fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8'));
  check(srcHas, '研发页有空状态标记');

  /* 按下反馈：触屏没有 hover，必须有 :active */
  check(/\.rc:active/.test(css) && /\.navchip:active/.test(css),
    '有按下反馈 :active（触屏必需）');
  check(/prefers-reduced-motion/.test(css), '尊重 prefers-reduced-motion');
}

console.log('');
if (fails === 0) {
  console.log('✔ 研发界面规范全部通过（' + checks + ' 项）');
  setTimeout(() => process.exit(0), 40);
} else {
  console.log('✘ ' + fails + ' 项有问题 / 共 ' + checks + ' 项');
  setTimeout(() => process.exit(1), 40);
}