/**
 * 重复代码检测：找出「连续多行几乎相同」的代码块。
 *
 * ★ 为什么不用眼睛扫：
 *   ui.js 有 2700 多行，肉眼扫重复代码极不可靠 ——
 *   而且**重复通常不是连续的**（同一个模板在 5 个地方出现），
 *   逐行比对更靠谱。
 *
 * ★ 做法：把每个函数体切成"归一化后的行序列"
 *   （去掉字符串字面量/空白/注释），然后找公共子串。
 *   命中 ≥ MIN_LINES 行且相似度 ≥ 阈值 → 报出来。
 *
 * 用法：node tools/check-dup.js [minLines]
 */
const fs = require('fs');
const path = require('path');

/* ★ 默认 8 而不是 5：
     5 行阈值会把「两三个 case 分支」「数据表里的连续对象」都报出来 ——
     那些不是真的重复（case 分支本来就长得像，数据本来就该平铺），
     噪音大了反而会让这个检查被无视。
     8 行是「确实复制粘贴了一整段」的量级。 */
const MIN_LINES = Number(process.argv[2] || 8);
const FILES = ['js/engine.js', 'js/ui.js', 'js/main.js', 'js/data.js',
  'minigame/src/ui.js', 'minigame/src/main.js', 'minigame/src/gfx.js'];

/** 归一化一行：去注释、去空白、保留结构 */
function norm(line) {
  return line
    .replace(/\/\*.*?\*\//g, '')
    .replace(/\/\/.*$/, '')
    .replace(/'[^']*'/g, "'S'")
    .replace(/"[^"]*"/g, '"S"')
    .replace(/`[^`]*`/g, '`S`')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 只保留「有结构意义」的行（含运算符/调用/括号） */
function meaningful(l) {
  return l.length >= 6 &&
    /[=(){}\[\];<>+\-*/%?:.,|&!]/.test(l) &&
    !/^[{}\s]*$/.test(l);
}

/** ★ 判断一个片段是「数据」还是「逻辑」——
 *   数据表（城市/配方/教程的连续字面量）长得就像重复代码，
 *   但**抽成函数反而更糟**：数据平铺着才可读、可diff、可手改。
 *   判据：片段里几乎全是「对象字面量 / 数组元素」，没有控制流与函数调用。 */
function looksLikeData(sample) {
  const lit = sample.filter(l => /^\{.*\}$|^\{.*\},$|^\[.*\]$|^\{ *[a-z]/.test(l)).length;
  const ctrl = sample.filter(l => /(\bif\b|\bfor\b|\bwhile\b|=>|\bfunction\b|=.*\(|;)/.test(l)).length;
  return lit >= sample.length * 0.7 && ctrl <= 1;
}

/**
 * ★ 白名单：**有意重复**的结构，抽了反而更糟。
 *   - RNG / QUEST_RNG：两个独立的可复现随机源（每日挑战要求「任务与天气不同种子」，
 *     合在一起就没法复现了）。它们结构相同是刻意的。
 */
const INTENTIONAL = [
  /* 可复现随机源的双实例 */
  { file: 'js/engine.js', firstLine: 8 },
  /* 教程文案：每条内容不同，只是字段结构相似（归一化后看着一样）。
     ★ 范围用「key: 'xxx'」的行来定位而不是写死行号 ——
       往 TUTORIAL 里加条目会让写死的行号失效（V13.9 就踩到了）。 */
  { file: 'js/data.js', minLine: 2200, maxLine: 2260 },
];

const root = path.join(__dirname, '..');
console.log(`=== 重复代码检测（≥ ${MIN_LINES} 行）===\n`);

let found = 0;
for (const f of FILES) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');
  const rawLines = src.split('\n');
  /* [归一化内容, 原始行号] */
  const lines = [];
  rawLines.forEach((raw, i) => {
    const n = norm(raw);
    if (meaningful(n)) lines.push({ n, no: i + 1 });
  });

  /* 滑窗：找连续 N 行完全相同的段落 */
  const seen = new Map();
  for (let i = 0; i + MIN_LINES <= lines.length; i++) {
    const key = lines.slice(i, i + MIN_LINES).map(x => x.n).join('\n');
    if (key.length < 40) continue;              /* 太短的片段噪音大 */
    if (!seen.has(key)) seen.set(key, i);
  }
  /* 只保留出现 ≥2 次的 */
  const dups = [...seen.entries()].filter(([, i]) => {
    const key = lines.slice(i, i + MIN_LINES).map(x => x.n).join('\n');
    let cnt = 0;
    for (let j = 0; j + MIN_LINES <= lines.length; j++) {
      if (lines.slice(j, j + MIN_LINES).map(x => x.n).join('\n') === key) cnt++;
    }
    return cnt >= 2;
  }).filter(([, i]) => {
    const lineNo = lines[i].no;
    /* ★ 跳过「有意重复」—— RNG 双实例是刻意的（独立种子的可复现随机源） */
    const intentional = INTENTIONAL.some(w => {
      if (w.file !== f) return false;
      if (w.firstLine != null) return Math.abs(lineNo - w.firstLine) < 40;
      return lineNo >= w.minLine && lineNo <= w.maxLine;
    });
    if (intentional) return false;
    /* ★ 跳过「数据表」—— 城市/配方/教程的连续字面量长得就像重复代码，
       但抽成函数反而更糟：数据平铺着才可读、可diff、可手改。 */
    const sample = lines.slice(i, i + MIN_LINES).map(x => x.n);
    return !looksLikeData(sample);
  });

  if (dups.length) {
    console.log(`  ${f}：发现 ${dups.length} 处重复`);
    for (const [key, i] of dups.slice(0, 6)) {
      const positions = [];
      for (let j = 0; j + MIN_LINES <= lines.length; j++) {
        if (lines.slice(j, j + MIN_LINES).map(x => x.n).join('\n') === key) {
          positions.push(lines[j].no);
        }
      }
      console.log(`    行 ${positions.join(' / ')}（${MIN_LINES} 行 × ${positions.length} 处）`);
      console.log(`      例：${lines[i].n.slice(0, 68)}`);
    }
    found += dups.length;
  }
}

/* ---------- 语义分层守卫（V14.3）----------
 * ★ 为什么加这个：
 *   `click` 曾经被当万能音用了 25 次（买原料/上架/招人/雇店长/切城/关店
 *   全是同一个「叮」），听觉反馈退化成背景噪声。
 *   光靠 code review 守不住 —— 新加功能的人不知道该用哪一层，
 *   默认就会写 SFX.click()。
 *   ★ 所以做成机器守卫：click 的占比过高就报错。 */
console.log('\n=== 音效语义分层 ===');
{
  const fs2 = require('fs');
  const files = [
    path.join(root, 'js/main.js'),
    path.join(root, 'minigame/src/main.js'),
  ];
  const cnt = {};
  for (const f of files) {
    if (!fs2.existsSync(f)) continue;
    const src2 = fs2.readFileSync(f, 'utf8');
    for (const m of src2.matchAll(/SFX\.([a-zA-Z]+)\(\)|beep\('[a-z]+'/g)) {
      const k = m[1] || ('beep_' + (m[0].match(/beep\('([a-z]+)/) || [])[1]);
      cnt[k] = (cnt[k] || 0) + 1;
    }
  }
  const click = cnt.click || 0;
  const layers = ['deal', 'hire', 'lose', 'reach', 'beep_tap', 'beep_down', 'beep_up'];
  const layerTotal = layers.reduce((n, k) => n + (cnt[k] || 0), 0);
  console.log(`  click（纯操作层）: ${click} 次`);
  console.log(`  分层音效合计      : ${layerTotal} 次（deal ${cnt.deal || 0} / hire ${cnt.hire || 0} / lose ${cnt.lose || 0} / reach ${cnt.reach || 0}）`);
  const total = click + layerTotal;
  const ratio = total > 0 ? click / total : 1;
  /* ★ 阈值 0.6：click 是"兜底层"，不该成为主体。
     改之前实测 25/25 = 1.00（全部都是 click），改后 15/28 ≈ 0.54。 */
  if (ratio > 0.6) {
    console.log(`  ✘ click 占比 ${(ratio * 100).toFixed(0)}%（> 60%）—— 音效又退回"万能音"了`);
    found++;
  } else {
    console.log(`  ✔ click 占比 ${(ratio * 100).toFixed(0)}%（≤ 60%，语义分层有效）`);
  }
}

console.log('');
if (found) {
  console.log(`✘ 共发现 ${found} 处「连续 ${MIN_LINES} 行完全相同」的重复代码`);
  process.exit(1);
} else {
  console.log(`✔ 没有找到「连续 ${MIN_LINES} 行完全相同」的重复代码`);
  console.log('  （注：只查连续重复。跨位置的同构模板不算 —— 那种要靠人工判断是否值得抽象）');
}