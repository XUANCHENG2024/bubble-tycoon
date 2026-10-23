/**
 * 拆分 ui.js（V20.2）
 *
 * ★ 为什么要拆：
 *   ui.js 有 3714 行 / 72 个顶层函数。函数本身按功能分得很清楚
 *   （商圈 / 员工 / 研发 / 成就 / 经营），但**全平铺在一个文件里**——
 *   改一个商圈功能要在 3700 行里定位，改一个研发功能同样。
 *   ★ 这不是「文件太大不好看」的问题，而是**改动的定位成本**：
 *     新人接手要通读全文才敢动手，评审时也看不出边界。
 *
 * ★ 拆分方式（刻意保守）：
 *   不改任何函数体、不改调用方式、不改全局命名。
 *   只是把**连续的一段函数**搬到独立文件，用 IIFE 包起来，
 *   挂到 window 上原有的函数名 —— 调用方一行都不用改。
 *   ★ 理由：零依赖项目没有打包器，拆分不能引入构建步骤；
 *     而「搬文件不改逻辑」是最容易验证正确的拆法。
 *
 * 用法：node tools/split-ui.js [--check]
 *   --check 只报告拆分计划，不写文件
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const uiPath = path.join(root, 'js/ui.js');
const outDir = path.join(root, 'js/ui');

/** 要抽出去的模块：文件后缀 → [函数名…]
 *  ★ 按**连续区间**切，不按函数散落切 —— 散落的函数搬起来
 *    会打乱 ui.js 剩余部分的顺序，diff 会变得难读。 */
const MODULES = [
  {
    file: 'stores.js',
    title: '商圈店铺与城市地图',
    fns: [
      'storesPanelHtml', 'storeUpgradeHtml', 'storeFormerHtml',
      'storeCandidatesHtml', 'managerCandidateHtml', 'openStoreModalHtml',
      'cityMapPanelHtml', 'cityMapModalHtml', 'cityPickerModalHtml',
      'cityDetailModalHtml',
    ],
  },
  {
    file: 'staff.js',
    title: '员工 / 店长 / 专精',
    fns: ['regularPanelHtml', 'specialtyHtml', 'managerPanelHtml'],
  },
  {
    file: 'lab.js',
    title: '研发树 / 招牌配方 / 原料市场',
    fns: [
      'sigCardHtml', 'sigRowHtml', 'recipePerCupHtml', 'marketIngUsesHtml',
      'labFoldNavHtml', 'cityBarHtml', 'recipeNodeCardHtml',
    ],
  },
  {
    file: 'ach.js',
    title: '成就（主线 / 支线）',
    fns: ['isMainAch', 'achTierHtml', 'achRowHtml'],
  },
];

const src = fs.readFileSync(uiPath, 'utf8');
const lines = src.split('\n');

/** 找一个顶层函数的起止行（含其上方的注释块） */
function findBlock(name) {
  /* 找 `function name(` 所在的行 */
  let decl = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('function ' + name + '(')) { decl = i; break; }
  }
  if (decl < 0) return null;

  /* 往上吃紧邻的注释块（块注释或行注释） */
  let start = decl;
  while (start > 0) {
    const prev = lines[start - 1].trim();
    if (prev.startsWith('/*') || prev.startsWith('*') || prev.startsWith('//') || prev === '') {
      /* 空行只在注释块内部才吃 —— 否则会把上一个函数也拖进来 */
      if (prev === '' && !lines[start - 1].trim().startsWith('*')) break;
      start--;
    } else break;
  }
  /* 往上再吃一个连续的 /** 开头的注释头 */
  while (start > 0 && lines[start - 1].trim().endsWith('*/') && !lines[start - 1].trim().startsWith('/**')) {
    start--;
  }

  /* 往下找配平的收尾 */
  let depth = 0, started = false, end = -1;
  for (let i = decl; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') { depth--; if (started && depth === 0) { end = i; break; } }
    }
    if (end >= 0) break;
  }
  if (end < 0) return null;
  return { start, end, name };
}

const check = process.argv.includes('--check');

/* 逐模块处理 */
let srcLines = lines.slice();
const extracted = [];   /* { module, blocks } */
const moveRanges = [];  /* 要从 ui.js 删掉的行区间（含原注释） */

/* 从后往前处理，避免行号漂移 */
for (const m of MODULES) {
  const blocks = [];
  for (const fn of m.fns) {
    const b = findBlock(fn);
    if (!b) {
      console.error('  ✘ 找不到函数：' + fn + '（模块 ' + m.file + '）');
      process.exit(1);
    }
    blocks.push(b);
  }
  /* 合并区间（函数可能在源码里不连续，但每个模块内部按位置排序） */
  blocks.sort((a, b) => a.start - b.start);
  extracted.push({ module: m, blocks });
  for (const b of blocks) moveRanges.push([b.start, b.end]);
}

/* 合并重叠/相邻区间 */
moveRanges.sort((a, b) => a[0] - b[0]);
const merged = [];
for (const r of moveRanges) {
  const last = merged[merged.length - 1];
  if (last && r[0] <= last[1] + 1) { last[1] = Math.max(last[1], r[1]); }
  else merged.push([r[0], r[1]]);
}

const totalLines = merged.reduce((n, r) => n + (r[1] - r[0] + 1), 0);

console.log('=== ui.js 拆分计划 ===\n');
for (const { module, blocks } of extracted) {
  const n = blocks.reduce((acc, b) => acc + (b.end - b.start + 1), 0);
  console.log('  js/ui/' + module.file.padEnd(12)
    + '（' + module.title + '）'
    + String(blocks.length).padStart(3) + ' 个函数'
    + String(n).padStart(6) + ' 行');
}
console.log('\n  ui.js: ' + lines.length + ' → ' + (lines.length - totalLines) + ' 行'
  + '（移出 ' + totalLines + ' 行）');

if (check) {
  console.log('\n（--check：只报告，不写文件）');
  process.exit(0);
}

/* ---------- 真正写文件 ---------- */
fs.mkdirSync(outDir, { recursive: true });

for (const { module, blocks } of extracted) {
  const parts = [];
  for (const b of blocks) {
    parts.push(lines.slice(b.start, b.end + 1).join('\n'));
  }
  const header = `/* ============================================================
 *  ${module.title}（V20.2 · 从 ui.js 拆出）
 * ============================================================
 *
 * ★ 拆分说明（tools/split-ui.js 自动生成）：
 *   这些函数原本平铺在 ui.js（3714 行 / 72 个顶层函数）里，
 *   按功能分组后搬到独立文件。
 *   ★ **函数体一行未改** —— 调用方也一行未改：
 *     下面用 IIFE 把原函数挂到 window 上原有的名字，
 *     所以 ui.js 与 main.js 里的调用完全不用动。
 *   ★ 为什么用 IIFE 而不是直接 top-level function：
 *     直接声明在浏览器全局作用域会污染 window，
 *     而 window 上已经有几十个同名函数（引擎层的），
 *     裸声明容易撞名。IIFE + 显式挂载更可控。
 *
 * ★ 加载顺序：必须在 js/ui.js **之前**加载 ——
 *   因为 ui.js 里的 PANEL_RENDERERS 会在模块加载时就引用这些函数。
 */
(function (global) {
  'use strict';

`;
  const footer = `
})(typeof window !== 'undefined' ? window : globalThis);
`;
  /* 取出函数名，挂到 window */
  const exportsList = module.fns.map(f => '  global.' + f + ' = ' + f + ';').join('\n');
  const body = parts.join('\n\n');
  const file = header + body + '\n\n  /* ---- 挂到全局（保持原有调用方式不变）---- */\n'
    + exportsList + '\n' + footer;
  fs.writeFileSync(path.join(outDir, module.file), file);
  console.log('  ✔ 写出 js/ui/' + module.file);
}

/* 从 ui.js 删除被移走的区间 */
const remove = new Set();
for (const [a, b] of merged) for (let i = a; i <= b; i++) remove.add(i);
const kept = lines.filter((_, i) => !remove.has(i));
fs.writeFileSync(uiPath, kept.join('\n'));
console.log('  ✔ ui.js 精简为 ' + kept.length + ' 行');

console.log('\n完成。记得在 index.html 里加 <script> 标签（见下一步）。');