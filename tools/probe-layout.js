/**
 * 界面体积体检（V17）
 *
 * ★ 为什么先量再改：
 *   「页面太长需要大量滚动」是主观描述 —— 长到什么程度算长？
 *   首屏能看到多少内容？哪些区块该折叠？
 *   没有数字就只能凭感觉改，改完也不知道有没有变好。
 *
 * ★ 量的三件事：
 *   ① 各面板内容总高度（vs 典型手机视口高度）
 *   ② 首屏可见的内容占比（首屏能看多少 = 玩家不用滚就能获取多少）
 *   ③ 横向溢出（有没有出现横向滚动条 —— 那是明确的 bug）
 */
const fs = require('fs'), path = require('path');
const { buildH5Env } = require('./h5-env.js');

const TYPICAL_VIEW_H = 667;   /* iPhone SE 高度：最常见的小屏基准 */
const TYPICAL_VIEW_W = 375;

console.log('=== 界面体积体检（V17）===\n');

const { window, doc } = buildH5Env();
window.eval('window.S = newGame("normal", 0, null); window.S.cash = 500000;');

const PANELS = [
  { key: 'manage', name: '经营页（含原料市场）' },
  { key: 'lab', name: '研发页' },
  { key: 'up', name: '升级页' },
  { key: 'staff', name: '员工页' },
  { key: 'rival', name: '商圈页' },
  { key: 'ach', name: '成就页' },
];

console.log(`基准视口：${TYPICAL_VIEW_W}×${TYPICAL_VIEW_H}（iPhone SE —— 常见小屏）\n`);
console.log('面板'.padEnd(22) + '内容高'.padStart(9) + '屏数'.padStart(7)
  + '首屏占比'.padStart(10) + '横向溢出'.padStart(10));
console.log('─'.repeat(62));

const report = [];
for (const p of PANELS) {
  window.eval(`UI.setTab(${JSON.stringify(p.key)}); UI.renderAll();`);
  const m = window.eval(`(function(){
    var el = document.getElementById('panel-' + ${JSON.stringify(p.key)});
    if (!el) return null;
    var r = el.getBoundingClientRect();
    /* 统计直接子区块，用来定位「谁最占地方」*/
    var kids = Array.prototype.slice.call(el.children);
    var blocks = kids.map(function(k){
      var kr = k.getBoundingClientRect();
      return { cls: (k.className||'').slice(0,26), h: Math.round(kr.height) };
    }).sort(function(a,b){ return b.h - a.h; }).slice(0,3);
    return {
      h: Math.round(r.height),
      kids: kids.length,
      blocks: blocks,
      scrollW: el.scrollWidth, clientW: el.clientWidth,
    };
  })()`);
  if (!m) { console.log(p.name + '  （面板不存在）'); continue; }
  const screens = (m.h / TYPICAL_VIEW_H).toFixed(1);
  const firstScreen = Math.min(100, Math.round(TYPICAL_VIEW_H / m.h * 100));
  const overflowX = m.scrollW > m.clientW + 2
    ? `${m.scrollW - m.clientW}px` : '无';
  console.log(
    p.name.padEnd(20)
    + String(m.h).padStart(9)
    + String(screens + '屏').padStart(8)
    + (firstScreen + '%').padStart(11)
    + overflowX.padStart(11));
  report.push({ key: p.key, name: p.name, ...m, screens, firstScreen, overflowX });
}

console.log('\n各面板最占地方的三级区块：\n');
for (const r of report) {
  console.log(`■ ${r.name}（${r.h}px / ${r.screens}屏）`);
  for (const b of r.blocks) {
    if (b.h < 20) continue;
    console.log(`    ${String(b.h).padStart(6)}px  .${b.cls}`);
  }
  if (r.overflowX !== '无') {
    console.log(`    ⚠ 横向溢出 ${r.overflowX}（出现横向滚动条）`);
  }
}

/* ---------- 横向溢出的具体元素 ---------- */
console.log('\n--- 横向溢出元素定位 ---');
{
  const all = window.eval(`(function(){
    var out = [];
    ['manage','lab','up','staff','rival','ach'].forEach(function(k){
      UI.setTab(k); UI.renderAll();
      var el = document.getElementById('panel-' + k);
      if (!el) return;
      if (el.scrollWidth <= el.clientWidth + 2) return;
      /* 找出比容器还宽的直接子元素 */
      Array.prototype.forEach.call(el.querySelectorAll('*'), function(n){
        var r = n.getBoundingClientRect();
        if (r.width > el.clientWidth + 2 && r.height > 0) {
          out.push(k + ' | ' + (n.className||n.tagName).toString().slice(0,34)
            + ' w=' + Math.round(r.width));
        }
      });
    });
    /* 去重：同类只留一条 */
    var seen = {}, uniq = [];
    out.forEach(function(x){ var k2 = x.split('|')[1].trim().split(' ')[0];
      if(!seen[k2]){ seen[k2]=1; uniq.push(x); } });
    return uniq.slice(0, 12);
  })()`);
  if (!all.length) {
    console.log('  ✔ 没有面板出现横向溢出');
  } else {
    all.forEach(x => console.log('  ⚠ ' + x));
  }
}

/* ---------- 可折叠性评估（研发页）---------- */
console.log('\n--- 研发页：按城市分组的结构 ---');
{
  const groups = window.eval(`(function(){
    UI.setTab('lab'); UI.renderAll();
    var el = document.getElementById('panel-lab');
    return Array.prototype.map.call(el.querySelectorAll('.cui-group'), function(g){
      var hd = g.querySelector('.cui-head');
      return {
        name: hd ? (hd.textContent||'').replace(/\\s+/g,' ').trim().slice(0,24) : '?',
        h: Math.round(g.getBoundingClientRect().height),
        nodes: g.querySelectorAll('.rc').length,
        stages: g.querySelectorAll('.tree-stage').length,
      };
    });
  })()`);
  const total = groups.reduce((n, g) => n + g.h, 0);
  console.log(`  共 ${groups.length} 个城市分组，合计 ${total}px`);
  console.log(`  分组`.padEnd(28) + '高度'.padStart(8) + '配方'.padStart(7) + '阶段'.padStart(7));
  for (const g of groups) {
    console.log('  ' + g.name.padEnd(26) + String(g.h).padStart(8)
      + String(g.nodes).padStart(7) + String(g.stages).padStart(7));
  }
  console.log(`  ★ 当前是**全展开**：${groups.length} 个分组同时铺开，合计 ${total}px。`);
  console.log(`    折叠「非本店」那些能省下 ${groups.filter(g => g.name.indexOf('本店') < 0)
    .reduce((n, g) => n + g.h, 0)}px。`);
}

/* ---------- 成就页结构 ---------- */
console.log('\n--- 成就页：现有分类 ---');
{
  const a = window.eval(`(function(){
    UI.setTab('ach'); UI.renderAll();
    var el = document.getElementById('panel-ach');
    var cats = {};
    Array.prototype.forEach.call(el.querySelectorAll('.ach-cat, .ach-head, .card-h'), function(n){
      var t = (n.textContent||'').replace(/\\s+/g,' ').trim().slice(0,30);
      if (t) cats[t] = Math.round(n.getBoundingClientRect().height);
    });
    return {
      total: Math.round(el.getBoundingClientRect().height),
      cards: el.querySelectorAll('.ach, .rc').length,
      cats: Object.keys(cats).length,
      sample: Object.keys(cats).slice(0,6),
    };
  })()`);
  console.log(`  总高 ${a.total}px · ${a.cards} 张成就卡 · ${a.cats} 个分类头`);
  console.log('  分类样本：' + a.sample.join(' | '));
}

console.log('\n（体检完成 —— 数字用于指导改造，不做断言）');
process.exit(0);