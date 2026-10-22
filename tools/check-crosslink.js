/**
 * 原料 ↔ 配方 双向关联检查（V16）
 *
 * ★ 守的是三件事：
 *   ① 反向索引对不对（原料 → 能做哪些菜）
 *   ② 双向跳转真的通（配方卡 → 市场高亮 / 市场徽章 → 研发树高亮）
 *   ③ 状态提示分得清（库存不足 / 配方未解锁 / 城市不对）
 *
 * ★ 尤其不能只测「函数存在」——
 *   这类关联链最容易出现「查询对、UI 没接」或者「UI 接了、id 传错」。
 */
const fs = require('fs'), path = require('path');
const { buildH5Env } = require('./h5-env.js');

let fails = 0, checks = 0;
function check(cond, label) {
  checks++;
  if (cond) { console.log(`  ✔ ${label}`); return true; }
  fails++;
  console.log(`  ✘ ${label}`);
  return false;
}

console.log('=== 原料↔配方双向关联检查（V16）===\n');

const { window, doc } = buildH5Env();

/* 准备一个已开局的局面 */
window.eval('window.S = newGame("normal", 0, null); window.S.cash = 300000;');

/* ---------- ① 反向索引：原料 → 配方 ---------- */
console.log('--- ① 反向索引 ---');
{
  const tea = window.eval('ingById("tea")');
  check(!!tea, `原料 tea 存在（${tea && tea.name}）`);

  const uses = window.eval('recipesUsingIng("tea")');
  check(Array.isArray(uses) && uses.length > 0,
    `tea 能被 ${uses.length} 道配方用`);

  /* ★ 每条都必须带「每杯耗量」与「研发需量」—— 缺一个 UI 就画不出来 */
  const noPerCup = uses.filter(u => !(u.perCup > 0) && !(u.rschFor > 0));
  check(noPerCup.length === 0,
    `每条都带用量${noPerCup.length ? '（缺：' + noPerCup.map(u => u.name).join('、') + '）' : ''}`);

  /* ★ 排序：研发用料优先 —— 那是「现在就要买」的事 */
  const firstLocked = uses.findIndex(u => u.rschFor > 0);
  const firstReady = uses.findIndex(u => u.rschFor === 0 && u.perCup > 0);
  if (firstLocked >= 0 && firstReady >= 0) {
    check(firstLocked < firstReady,
      `研发用料排在前面（idx ${firstLocked} < ${firstReady}）`);
  } else {
    check(true, '本样本只有一种状态的配方（跳过排序检查）');
  }

  /* 正向查询要对得上 */
  const rid = uses[0].rid;
  const ings = window.eval(`ingsOfRecipe(${JSON.stringify(rid)})`);
  const inRecipe = ings.filter(x => x.id === 'tea');
  check(inRecipe.length === 1 && inRecipe[0].perCup === uses[0].perCup,
    `正向↔反向一致（${rid} 的 tea 每杯 ${inRecipe[0] && inRecipe[0].perCup} = 反向的 ${uses[0].perCup}）`);
}

/* ---------- ② 市场行显示「能做什么」 ---------- */
console.log('\n--- ② 市场行显示用途 ---');
{
  window.eval('UI.setTab("manage"); UI.renderAll();');
  const html = doc.getElementById('panel-manage').innerHTML;
  check(/ing-uses/.test(html), '市场行有「能做什么」区块');
  check(/ing-use/.test(html), '用途以徽章形式展示');
  check(/每杯/.test(html), '徽章里显示每杯消耗量');
  check(/能做\s*<b>/.test(html), '显示「能做 N 道」的计数');
  /* ★ 市场行必须带 data-ing —— 跳转高亮靠它定位 */
  check(/data-ing="/.test(html), '市场行带 data-ing（高亮定位用）');
}

/* ---------- ③ 配方卡原料可点 ---------- */
console.log('\n--- ③ 配方卡原料可跳市场 ---');
{
  window.eval('UI.setTab("lab"); UI.renderAll();');
  const html = doc.getElementById('panel-lab').innerHTML;
  check(/data-act="toing"/.test(html), '配方卡的原料是按钮（可点）');
  check(/ing-link/.test(html), '原料带 ing-link 样式');
  check(/data-rid="/.test(html), '配方卡带 data-rid（高亮定位用）');
  /* ★ 反向入口（市场 → 研发树）在**市场页**，不能在研发页找。
     之前这条断言写在 lab 页里查 data-act="inguse" → 永远为 0。
     ★ 断言要问「对的地方问对的问题」。 */
  window.eval('UI.ingFilter = true; UI.nav.kind = null; UI.nav.from = null; UI.setTab("manage"); UI.renderAll();');
  const mktHtml = doc.getElementById('panel-manage').innerHTML;
  check(/data-act="inguse"/.test(mktHtml),
    '市场徽章可点（反向入口，跳回研发树）');
}

/* ---------- ④ 跳转真的通 ---------- */
console.log('\n--- ④ 双向跳转 ---');
{
  /* A. 配方卡 → 市场 */
  window.eval('UI.ingFilter = false; UI.setTab("lab");');
  const ingId = window.eval('ingById("tea").id');
  window.eval(`UI.jumpTo('manage', 'ing', ${JSON.stringify(ingId)});`);
  check(window.eval('UI.tab') === 'manage',
    `跳到经营页（tab=${window.eval('UI.tab')}）`);
  check(window.eval('UI.nav.focus') === ingId,
    `记住了高亮目标（${window.eval('UI.nav.focus')}）`);
  check(window.eval('UI.nav.from') === 'lab',
    `记住了来源（${window.eval('UI.nav.from')}）`);
  check(window.eval('UI.nav.fromLabel') === '研发页',
    `来源中文名正确（${window.eval('UI.nav.fromLabel')}）`);

  /* ★ 跳转后市场应只显示那一项（否则玩家还要在 20 行里找）*/
  const html = doc.getElementById('panel-manage').innerHTML;
  check(/已定位到/.test(html), '市场显示「已定位到…」');
  check(/data-act="ingshowall"/.test(html), '提供「显示全部原料」');

  /* B. 返回 */
  window.eval('UI.navBack();');
  check(window.eval('UI.tab') === 'lab',
    `返回按钮回到来源页（tab=${window.eval('UI.tab')}）`);
  check(window.eval('UI.nav.focus') === null, '返回后清掉高亮目标');

  /* C. 市场 → 研发树 */
  window.eval('UI.setTab("manage");');
  const rid = window.eval('recipesUsingIng("tea")[0].rid');
  window.eval(`UI.jumpTo('lab', 'recipe', ${JSON.stringify(rid)});`);
  check(window.eval('UI.tab') === 'lab', '从市场跳回研发树');
  check(window.eval('UI.nav.focus') === rid, `记住了配方（${window.eval('UI.nav.focus')}）`);
  check(window.eval('UI.nav.from') === 'manage', '来源是经营页');
}

/* ---------- ④b 高亮真的落到DOM 上 ---------- */
console.log('\n--- ④b 高亮定位（跳了要能看见）---');
{
  /* ★ 光有跳转状态不够 —— 必须验证 **DOM 上真的打上了高亮**，
     否则玩家点了跳转还是"自己找"，这一整套改造等于没做。 */
  const rid = window.eval('window.S.recipes[0]');
  window.eval('UI.ingFilter = false; UI.nav.kind = null; UI.nav.from = null; UI.setTab("lab"); UI.renderAll();');
  window.eval(`UI.jumpTo('lab', 'recipe', ${JSON.stringify(rid)});`);
  const okRecipe = window.eval('UI.applyHighlight()');
  const hlEl = doc.querySelector('.jump-hl');
  check(okRecipe === true && !!hlEl,
    `配方高亮落到 DOM（${hlEl ? hlEl.getAttribute('data-rid') : '无'}）`);

  /* 原料侧同理 */
  const ingId = window.eval('ingById("tea").id');
  window.eval(`UI.jumpTo('manage', 'ing', ${JSON.stringify(ingId)});`);
  const okIng = window.eval('UI.applyHighlight()');
  const ingEl = doc.querySelector('.mkt-row.jump-hl');
  check(okIng === true && !!ingEl,
    `原料高亮落到 DOM（${ingEl ? ingEl.getAttribute('data-ing') : '无'}）`);
}

/* ---------- ⑤ 状态提示 ---------- */
console.log('\n--- ⑤ 状态提示分得清 ---');
{
  window.eval('UI.nav.tab = null; UI.nav.kind = null; UI.nav.from = null; UI.ingFilter = true;');
  /* 库存清零 → 应出现「库存不够做一杯」 */
  window.eval('(function(){for(var k in window.S.inv) window.S.inv[k] = 0;})()');
  window.eval('UI.setTab("manage"); UI.renderAll();');
  let html = doc.getElementById('panel-manage').innerHTML;
  check(/库存不够做一杯/.test(html), '库存不足有明确提示');

  /* 未解锁配方的徽章应显示「研发需 N」 */
  check(/研发需/.test(html), '未解锁配方显示「研发需 N」（未来的需求也值得囤）');
  check(/ing-use lock/.test(html), '未解锁用 lock 样式区分');

  /* 备足料 → 提示消失 */
  window.eval('(function(){for(var g of ING) window.S.inv[g.id] = 500;})()');
  window.eval('UI.renderAll();');
  html = doc.getElementById('panel-manage').innerHTML;
  check(!/库存不够做一杯/.test(html), '库存充足时不再报警');
}

/* ---------- ⑥ 不影响既有功能 ---------- */
console.log('\n--- ⑥ 既有功能不受影响 ---');
{
  window.eval('UI.setTab("manage"); UI.renderAll();');
  const html = doc.getElementById('panel-manage').innerHTML;
  /* 买入按钮还在 */
  check(/data-act="buy"/.test(html), '买入按钮仍在');
  check(/data-act="autofill"/.test(html), '一键补货仍在');
  check(/data-act="sell"/.test(html), '清仓按钮仍在（V13.9）');
  /* 研发按钮还在 */
  window.eval('UI.setTab("lab"); UI.renderAll();');
  const lab = doc.getElementById('panel-lab').innerHTML;
  check(/data-act="research"/.test(lab), '研发按钮仍在');
  /* ★ 长列表可被压缩：市场行数应等于当前城市可买原料数 */
  window.eval('UI.ingFilter = false; UI.nav.kind = null; UI.setTab("manage"); UI.renderAll();');
  const m2 = doc.getElementById('panel-manage').innerHTML;
  const shown = (m2.match(/data-ing="/g) || []).length;
  const total = window.eval('ING.filter(function(g){return ingAvailableAt(g.id, currentCityId(window.S));}).length');
  check(shown === total,
    `市场显示全部可买原料（${shown}/${total}）`);
}

console.log('');
if (window && typeof window.close === 'function') window.close();
if (fails === 0) {
  console.log(`✔ 双向关联全部通过（${checks} 项）`);
  setTimeout(() => process.exit(0), 40);
} else {
  console.log(`✘ ${fails} 项有问题 / 共 ${checks} 项`);
  setTimeout(() => process.exit(1), 40);
}