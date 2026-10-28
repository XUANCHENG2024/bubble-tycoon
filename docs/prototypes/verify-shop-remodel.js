/* 原型验收脚本（可选，不属于游戏运行依赖）
 * 用法：npm i jsdom && node verify-shop-remodel.js shop-remodel.html
 * 验 20 项：无报错 / 9 个部件齐全 / 初始态 / 改造升级 / 粒子与飘字 / 对比层 / 满级保护
 */
/* 原型验证：真 DOM（jsdom）加载单文件 HTML，跑一遍完整交互。
 * 验四件事：① 无 JS 报错 ② SVG 部件齐全 ③ 改造能升级并改变视觉 ④ 对比模式能开合
 */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const file = process.argv[2];
const html = fs.readFileSync(file, 'utf8');

const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,       /* 提供 requestAnimationFrame */
  url: 'http://127.0.0.1/',
  beforeParse(w) {
    w.addEventListener('error', e => errors.push('window.error: ' + e.message));
    w.console.warn = (...a) => errors.push('warn: ' + a.join(' '));
  },
});
const w = dom.window, d = w.document;
const $ = s => d.querySelector(s);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✔ ' + m)) : (fail++, console.log('  ✘ ' + m)); };

console.log('\n=== 原型运行时验证 ===\n');

/* ① 无报错 */
ok(errors.length === 0, '加载无 JS 报错' + (errors.length ? '（' + errors[0] + '）' : ''));

/* ② SVG 部件齐全（首屏自检也会 warn，这里再核一遍） */
const need = ['sign0', 'sign1', 'sign2', 'sign3', 'awning', 'seat', 'plant', 'light', 'upper'];
const after = $('.layer.after');
ok(!!after && after.querySelectorAll('svg').length === 1, 'after 层渲染出 1 个 SVG');
const missing = need.filter(k => !after.querySelector('[data-part="' + k + '"]'));
ok(missing.length === 0, missing.length ? '缺部件：' + missing.join(',') : '9 个可改造部件齐全');

/* 初始状态：招牌 Lv.0 亮、其余都 off */
const sign0 = after.querySelector('[data-part="sign0"]');
ok(sign0 && !sign0.classList.contains('off'), '初始招牌 Lv.0 可见');
const awning = after.querySelector('[data-part="awning"]');
ok(awning && awning.classList.contains('off'), '初始雨棚隐藏');

/* ③ 改造：点第一个槽（门头招牌）→ 点改造按钮 */
const slots = d.querySelectorAll('.slot');
ok(slots.length === 6, '6 个改造槽渲染出来');
ok(d.getElementById('goBtn').disabled, '未选中时改造按钮为禁用状态');

slots[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
ok(!d.getElementById('goBtn').disabled, '选中槽位后改造按钮可用');
ok(d.getElementById('barTitle').textContent.indexOf('门头招牌') >= 0, '底部条显示所选项目');

const scoreBefore = d.getElementById('score').textContent;
d.getElementById('goBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

const sign1 = after.querySelector('[data-part="sign1"]');
const sign0b = after.querySelector('[data-part="sign0"]');
ok(sign1 && !sign1.classList.contains('off'), '改造后招牌升到 Lv.1（灯箱可见）');
ok(sign0b && sign0b.classList.contains('off'), '旧的 Lv.0 挂牌已隐藏');
ok(d.querySelectorAll('.spark').length > 0, '改造时有星光粒子生成');
ok(d.querySelectorAll('.float').length > 0, '改造时有飘字反馈');

/* ④ 对比模式 */
d.getElementById('cmpBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const stage = d.getElementById('stage');
ok(stage.classList.contains('compare'), '对比模式已开启');
const before = $('.layer.before');
ok(before && before.querySelectorAll('svg').length === 1, 'before 层渲染出改造前的样子');
const beforeSign1 = before.querySelector('[data-part="sign1"]');
ok(beforeSign1 && beforeSign1.classList.contains('off'), 'before 层仍是改造前的 Lv.0（灯箱隐藏）');

/* 再点一次关闭 */
d.getElementById('cmpBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
ok(!stage.classList.contains('compare'), '对比模式可关闭');
ok($('.layer.before').innerHTML.trim() === '', '关闭后 before 层被清空（不占内存）');

/* ⑤ 满级保护：把招牌连升到 3 级，第 4 次应无效 */
for (let i = 0; i < 4; i++) {
  const s = d.querySelectorAll('.slot')[0];
  s.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const b = d.getElementById('goBtn');
  if (!b.disabled) b.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
}
const sign3 = after.querySelector('[data-part="sign3"]');
ok(sign3 && !sign3.classList.contains('off'), '招牌可升到满级 Lv.3（金字招牌）');
ok(d.querySelectorAll('.slot')[0].classList.contains('maxed'), '满级槽位标记为 maxed');

console.log(`\n${fail === 0 ? '✔ 全部通过' : '✘ 有失败项'}（${pass} 通过 / ${fail} 失败）`);
console.log('控制台告警：', errors.length ? errors.slice(0, 3).join(' | ') : '无');
process.exit(fail === 0 ? 0 : 1);
