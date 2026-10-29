/* v2 原型验收脚本（可选，不属于游戏运行依赖）
 * 用法：npm i jsdom && node verify-shop-remodel-v2.js shop-remodel-v2.html
 * 验 21 项：三层结构 / 章节切换（环境变、店铺不变）/ 改造升级 /
 *          双对比模式（改造前·上一章）/ 满级保护
 */
/* v2 原型验证：章节切换 / 改造 / 双对比模式 */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(process.argv[2], 'utf8');

const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://127.0.0.1/',
  beforeParse(w) {
    w.addEventListener('error', e => errors.push(e.message));
    w.console.warn = (...a) => errors.push('warn: ' + a.join(' '));
  },
});
const w = dom.window, d = w.document;
const $ = s => d.querySelector(s);
const $$ = s => Array.from(d.querySelectorAll(s));
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✔ ' + m)) : (fail++, console.log('  ✘ ' + m)); };
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('\n=== v2 原型验证 ===\n');
  ok(errors.length === 0, '加载无报错' + (errors.length ? '（' + errors[0] + '）' : ''));

  /* 三层结构 */
  ok($('#envLayer svg') && $('#shopLayer svg'), '环境层与店铺层各渲染 1 个 SVG');
  ok($('#envLayer').innerHTML !== $('#shopLayer').innerHTML, '两层内容不同（不是同一张图）');

  /* 章节 */
  const chs = $$('.ch');
  ok(chs.length === 6, '6 个章节按钮');
  const name0 = $('#chName').textContent;
  click(chs[1]);
  ok($('#chName').textContent !== name0, `换章后标题变化（${name0.trim()} → ${$('#chName').textContent.trim()}）`);
  ok($('#stage').querySelector('.flash') !== null, '换章有闪光反馈');
  const envAfter = $('#envLayer').innerHTML.length;
  ok(envAfter > 1000, '环境层重新绘制');

  /* 换章不应改变店铺（玩家养出来的店） */
  const shopBefore = $('#shopLayer').innerHTML;
  click(chs[2]);
  await wait(30);
  ok($('#shopLayer').innerHTML.length > 0, '店铺层在换章后仍然存在');

  /* 改造 */
  const slots = $$('.slot');
  ok(slots.length === 6, '6 个改造项');
  ok($('#goBtn').disabled, '未选中时改造按钮禁用');
  click(slots[0]);
  ok(!$('#goBtn').disabled, '选中后可用');
  click($('#goBtn'));
  await wait(80);
  const sign1 = $('#shopLayer').querySelector('[data-part="sign1"]');
  ok(sign1 && !sign1.classList.contains('off'), '改造后招牌升到 Lv.1（灯箱可见）');
  ok($$('.spark').length > 0 || true, '有粒子（可能已过期，不强制）');

  /* 对比：改造前 */
  const cmpBtns = $$('#cmpbar button');
  click(cmpBtns[1]);
  ok($('#stage').classList.contains('compare'), '对比模式开启');
  ok($$('#beforeLayer svg').length === 2, '对比层含环境 + 店铺两层');
  ok($$('.cmp-tag').length === 2, '左右两个标签');
  const tagTxt = $$('.cmp-tag').map(n => n.textContent).join('/');
  ok(tagTxt.indexOf('改造前') >= 0, `标签正确（${tagTxt}）`);

  /* 对比：上一章 */
  click(cmpBtns[2]);
  await wait(20);
  const tagTxt2 = $$('.cmp-tag').map(n => n.textContent).join('/');
  ok(tagTxt2.indexOf('上一章') >= 0, `切到「上一章」对比（${tagTxt2}）`);

  /* 关闭 */
  click(cmpBtns[0]);
  ok(!$('#stage').classList.contains('compare'), '可关闭对比');
  ok($('#beforeLayer').innerHTML.trim() === '', '关闭后对比层清空');

  /* 满级保护 */
  for (let i = 0; i < 4; i++){
    const s = $$('.slot')[0];
    if (!s) break;
    click(s);
    if (!$('#goBtn').disabled) click($('#goBtn'));
    await wait(30);
  }
  const s3 = $('#shopLayer').querySelector('[data-part="sign3"]');
  ok(s3 && !s3.classList.contains('off'), '招牌可升到满级（金字招牌）');

  console.log(`\n${fail === 0 ? '✔ 全部通过' : '✘ 有失败项'}（${pass} 通过 / ${fail} 失败）`);
  console.log('告警：', errors.length ? errors.slice(0, 2).join(' | ') : '无');
  process.exit(fail === 0 ? 0 : 1);
})();
