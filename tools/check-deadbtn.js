/**
 * 死按钮检查：UI 里的 data-act 是否真的能点（V17）
 *
 * ★ 这条检查是被一次真 bug 逼出来的：
 *   商圈页有 5 个按钮（smgrh / smgrfire / srename / sfund / stoggleup）
 *   点了**毫无反应** ——
 *   根因是 doAct 从来没取过 `dataset.b`，
 *   而这些 case 里写的是 `+br`（未定义标识符）→ 抛 ReferenceError。
 *   ★ 为什么长期没人发现：它们**能渲染、看得见**，
 *     而 smoke 一直只测「面板能否渲染」，从不测「每个按钮点了会怎样」。
 *
 * ★ 写法刻意保持极简：所有 vm 查询都用 Node 侧拼字符串，
 *   不用模板字符串 —— 两层 ${} 插值会静默产出
 *   「查了 0 个但断言通过」的假通过（文件末尾有详细说明）。
 */
const fs = require('fs'), path = require('path');
const { buildH5Env } = require('./h5-env.js');

let fails = 0, checks = 0;
function check(cond, label) {
  checks++;
  if (cond) { console.log('  ✔ ' + label); return true; }
  fails++;
  console.log('  ✘ ' + label);
  return false;
}

console.log('=== 死按钮检查（V17）===\n');

/* ---------- ① 静态差集 ---------- */
console.log('--- ① 静态：data-act 是否有处理路径 ---');
{
  const root = path.join(__dirname, '..');
  /* ★ V20.2：ui.js 拆成了 ui.js + js/ui/*.js，
     静态分析必须扫**全部**，否则拆出去的 data-act 会被漏掉
     —— 那样「死按钮检查」会漏报（它本该是最严的那道闸）。
     ★ 用 frontend-files 的清单自动跟随，以后再拆文件也不用改这里。 */
  const UI_FILES = require('./frontend-files.js').H5_FILES.filter(f => /js\/ui/.test(f));
  const uiSrc = UI_FILES.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  const mainSrc = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');

  const uiActs = new Set();
  for (const m of uiSrc.matchAll(/data-act="([a-zA-Z0-9_]+)"/g)) uiActs.add(m[1]);

  const caseActs = new Set();
  for (const m of mainSrc.matchAll(/case '([a-zA-Z0-9_]+)':/g)) caseActs.add(m[1]);

  /* ★ 输入框类走 change/input 事件，不经 doAct 委托 —— 不算死按钮 */
  const inputActs = new Set(['mkt', 'ratio', 'scity', 'vcity', 'vprov']);

  const orphans = [...uiActs].filter(a => !caseActs.has(a) && !inputActs.has(a));
  check(orphans.length === 0,
    uiActs.size + ' 个 data-act 全部有处理路径'
    + (orphans.length ? '（孤儿：' + orphans.join('、') + '）' : ''));
  check([...inputActs].every(a => uiActs.has(a)),
    inputActs.size + ' 个输入框类 act 走 change/input（不算死按钮）');
}

/* ---------- ② 动态点击每个按钮 ---------- */
console.log('\n--- ② 动态：逐个真点，不许抛异常 ---');
{
  const { window, doc } = buildH5Env();
  /* ★ 必须先开局 —— renderManage 等函数开头都是 `if (!s) return`，
     没有 S 时面板渲染成空字符串，查出来自然是 0 个按钮。
     ★ 这个坑比「忘写 setTab」更隐蔽：它不报错，只是安静地什么都不做。
     ★ 第三版才补上——前两版都显示「点击 0 个按钮」却报 PASS。 */
  window.eval('window.S = newGame("normal", 0, null); window.S.cash = 300000;');
  window.eval('window.__err = null;');
  window.eval('window.onerror = function (m) { window.__err = String(m); return true; };');

  const TABS = ['manage', 'lab', 'up', 'staff', 'rival', 'ach'];
  /* 不测的 act：输入框（change 事件）与弹窗关闭 */
  const SKIP = ['mkt', 'ratio', 'scity', 'vcity', 'vprov', 'modal-close'];

  let total = 0, broken = [], perTab = {};

  for (const tab of TABS) {
    /* ★ 必须先渲染再查 ——
       未渲染的面板 innerHTML 是空的，查出来自然是 0 个。
       ③ 段能查到 5 个，正是因为那里先调了 setTab + renderAll。 */
    window.eval('UI.setTab("' + tab + '"); UI.renderAll();');
    const q = '(function(){'
      + 'var el = document.getElementById("panel-' + tab + '");'
      + 'if (!el) return [];'
      + 'var out = [];'
      + 'Array.prototype.forEach.call(el.querySelectorAll("[data-act]"), function(n){'
      + '  out.push(n.getAttribute("data-act"));'
      + '});'
      + 'return out;'
      + '})()';
    let acts;
    try {
      acts = window.eval(q) || [];
    } catch (e) {
      broken.push(tab + ': 查询失败 ' + e.message);
      continue;
    }
    acts = [...new Set(acts)].filter(a => SKIP.indexOf(a) < 0);
    perTab[tab] = acts.length;

    for (const a of acts) {
      total++;
      window.eval('window.__err = null;');
      const cq = '(function(){'
        + 'UI.setTab("' + tab + '"); UI.renderAll();'
        + 'var el = document.getElementById("panel-' + tab + '");'
        + 'var n = el && el.querySelector(\'[data-act="' + a + '"]\');'
        + 'if (n) n.click();'
        + '})()';
      try {
        window.eval(cq);
      } catch (e) {
        broken.push(tab + '/' + a + ': ' + e.message);
        continue;
      }
      const err = window.eval('window.__err');
      if (err) broken.push(tab + '/' + a + ': ' + err);
    }
  }

  const detail = Object.keys(perTab).map(k => k + ':' + perTab[k]).join(' ');
  check(total > 0, '按钮查询非空（' + detail + '）');
  check(broken.length === 0,
    '点击 ' + total + ' 个按钮无一抛异常'
    + (broken.length ? '（坏：' + broken.slice(0, 5).join('; ') + '）' : ''));
}

/* ---------- ③ 商圈页专项 ---------- */
console.log('\n--- ③ 商圈页 data-b 传参（V17 修的那个 bug）---');
{
  const { window: w2, doc: d2 } = buildH5Env();
  w2.eval('window.S = newGame("normal", 0, null); window.S.cash = 300000; window.S.shops = 3;');
  w2.eval('window.__err = null;');
  w2.eval('window.onerror = function (m) { window.__err = String(m); return true; };');
  w2.eval('UI.setTab("rival"); UI.renderAll();');

  const btns = w2.eval('(function(){'
    + 'var out = [];'
    + 'Array.prototype.forEach.call('
    + '  document.querySelectorAll("#panel-rival [data-b]"),'
    + '  function(n){ out.push(n.getAttribute("data-act")); });'
    + 'return out;'
    + '})()') || [];

  check(btns.length >= 5, '商圈页 ' + btns.length + ' 个按钮带 data-b');

  let errs = [];
  for (const a of [...new Set(btns)]) {
    w2.eval('window.__err = null;');
    try {
      w2.eval('(function(){'
        + 'UI.setTab("rival"); UI.renderAll();'
        + 'var n = document.querySelector(\'#panel-rival [data-act="' + a + '"]\');'
        + 'if (n) n.click();'
        + '})()');
    } catch (e) { errs.push(a + ': ' + e.message); continue; }
    const e = w2.eval('window.__err');
    if (e) errs.push(a + ': ' + e);
  }
  check(errs.length === 0,
    '商圈页 ' + new Set(btns).size + ' 个 data-b 按钮点击无异常'
    + (errs.length ? '（' + errs.join('; ') + '）' : ''));

  /* 折叠要真的能切 */
  w2.eval('UI.setTab("rival"); UI.renderAll();');
  const l0 = w2.eval('document.querySelectorAll("#panel-rival .store-up-list").length');
  d2.querySelector('#panel-rival [data-act="stoggleup"]').click();
  const l1 = w2.eval('document.querySelectorAll("#panel-rival .store-up-list").length');
  d2.querySelector('#panel-rival [data-act="stoggleup"]').click();
  const l2 = w2.eval('document.querySelectorAll("#panel-rival .store-up-list").length');
  check(l0 !== l1 && l1 !== l2,
    '店铺升级折叠可双向切换（' + l0 + '→' + l1 + '→' + l2 + '）');
}

console.log('\n（写法说明：本文件刻意不用模板字符串查 vm 里的数据 ——');
console.log('  两层 ${} 插值会静默产出「查了 0 个但断言通过」的假通过，');
console.log('  我在这上面栽了两次：第一版查询函数拿不到 tab，第二版 eval 多传了参数。');
console.log('  现在全部用 Node 侧字符串拼接 + __TAB__ 占位替换。）');

console.log('');
if (fails === 0) {
  console.log('✔ 死按钮检查全部通过（' + checks + ' 项）');
  setTimeout(() => process.exit(0), 40);
} else {
  console.log('✘ ' + fails + ' 项有问题 / 共 ' + checks + ' 项');
  setTimeout(() => process.exit(1), 40);
}