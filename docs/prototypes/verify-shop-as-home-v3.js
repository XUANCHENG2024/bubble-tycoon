/* v3 原型验收脚本（可选，不属于游戏运行依赖）
 * 用法：npm i jsdom && node verify-shop-as-home-v3.js shop-as-home-v3.html
 * 验 20 项：空闲态不挂热区 / 改造模式 6 个热区 / 点物件换卡 / 改造生效 /
 *          返回清理 / 双对比 / 换章 / 满级保护
 */
/* v3 验证：店铺即主界面（改造模式 / 点物件 / 对比 / 换章） */
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
  console.log('\n=== v3「店铺即主界面」验证 ===\n');
  ok(errors.length === 0, '加载无报错' + (errors.length ? '（' + errors[0] + '）' : ''));

  /* 初始：空闲态，只有三个主入口 */
  ok($('#dockIdle').style.display !== 'none', '初始为空闲态（三个主入口）');
  ok($('#hotLayer').innerHTML.trim() === '', '空闲态不挂热区（不拦截点击）');
  ok($('#envLayer svg') && $('#shopLayer svg'), '环境层与店铺层各 1 个 SVG');

  /* 进入改造模式 */
  click($('#btnRemodel'));
  ok($('#stage').classList.contains('remodel'), '进入改造模式（画面压暗 + 描边提示）');
  const hots = $$('.hot');
  ok(hots.length === 6, `6 个可点热区（实际 ${hots.length}）`);

  /* 点物件 → 底部换成该物件的卡 */
  click(hots[0]);
  ok($('#dockItem').classList.contains('show'), '点物件后底部切换为该物件卡');
  ok($('#itN').textContent.indexOf('门头') >= 0, `卡片显示正确物件（${$('#itN').textContent}）`);
  ok($('#dockIdle').style.display === 'none', '主入口同时隐藏（不重复展示）');

  /* 改造 */
  click($('#btnGo'));
  await wait(80);
  const sign1 = $('#shopLayer').querySelector('[data-part="sign1"]');
  ok(sign1 && !sign1.classList.contains('off'), '改造后招牌升到 Lv.1（灯箱）');
  ok($('#itLv').textContent.indexOf('1') >= 0, `卡片等级同步（${$('#itLv').textContent.trim()}）`);

  /* 返回 */
  click($('#btnBack'));
  ok($('#dockIdle').style.display !== 'none', '返回后回到主入口');
  ok($('#hotLayer').innerHTML.trim() === '', '返回后热区撤掉');

  /* 对比 */
  click($('#btnCmp'));
  ok($('#dockCmp').classList.contains('show'), '对比面板出现');
  click($$('#dockCmp button')[1]);
  ok($('#stage').classList.contains('compare'), '进入对比模式');
  ok($$('#beforeLayer svg').length === 2, '对比层含环境 + 店铺');
  ok($$('.cmp-tag').length === 2, '左右标注各一');

  /* 换章 */
  const before = $('#chapBtn').textContent;
  click($('#chapBtn'));
  await wait(30);
  ok($('#chapBtn').textContent !== before, `换章生效（${before.trim()} → ${$('#chapBtn').textContent.trim()}）`);

  /* 关对比 */
  click($$('#dockCmp button')[0]);
  ok(!$('#stage').classList.contains('compare'), '可关闭对比');

  /* 满级保护：招牌连升到 3 */
  click($('#btnRemodel'));
  click($$('.hot')[0]);
  for (let i = 0; i < 4; i++){
    const b = $('#btnGo');
    if (b.disabled) break;
    click(b);
    await wait(90);
  }
  const s3 = $('#shopLayer').querySelector('[data-part="sign3"]');
  ok(s3 && !s3.classList.contains('off'), '招牌可升到满级（金字招牌）');

  console.log(`\n${fail === 0 ? '✔ 全部通过' : '✘ 有失败项'}（${pass} 通过 / ${fail} 失败）`);
  console.log('告警：', errors.length ? errors.slice(0, 2).join(' | ') : '无');
  process.exit(fail === 0 ? 0 : 1);
})();
