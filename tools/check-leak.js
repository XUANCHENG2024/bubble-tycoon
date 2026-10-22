/**
 * 检查「源码注释泄漏到界面」。
 *
 * ★ 问题模式：
 *   模板字符串（反引号包裹）**内部**的 / 星号-斜杠 只是字面文本，
 *   会被原样输出到 HTML，玩家直接在界面上看到源码注释。
 *
 *   h += `<div>
 *     /* 这不是注释，这是字面文本，会渲染到页面上 * /
 *     ${x}
 *   </div>`;
 *
 * ★ 真实案例：V12 引入的「news.text 转义」注释就写在 h += 反引号模板内部，
 *   从 V12 起一直泄漏到「备货页」的今日情报卡片下方。玩家截图反馈才发现。
 *
 * ★★ 为什么用「渲染后的 DOM」而不是静态扫源码：
 *   第一版想静态扫（正则找模板内的注释），结果**103 处误报** ——
 *   因为 JS 里字符串/模板/插值/IIFE 交织，手写状态机必然出错：
 *     · 插值 ${ cond ? (() => { 合法注释 })() : '' } 里的注释是**代码**不是泄漏
 *     · 普通字符串里的内容不该被当模板
 *     · 嵌套模板的切换极易漏
 *   ★ **教训：要检查「运行时表现」就不要静态猜，要真的跑一遍看结果。**
 *
 * ★ 判据：页面上出现了「源码特征」就算泄漏。
 *   特征选得很具体（注释起始符 + 代码味词汇），
 *   避免把游戏正常文案（比如「存档」这个词）误判。
 *
 * 用法：node tools/check-leak.js
 */
const { buildH5Env } = require('./h5-env.js');

/* 源码特征：注释起始符是极强的信号 —— 游戏文案里不会出现 */
const PATTERNS = [
  /\/\s*\*/,           // 注释起始符
  /\$\{[a-zA-Z_]/,      // 模板插值 ${xxx}
  /esc\(/,             // 代码里的函数调用
  /function\s*\(/,
  /=>\s*\{/,           // 箭头函数
];

/* 这些词只在源码注释里出现，游戏正文不会有 */
const CODE_WORDS = /news\.text|formerManagers|check-escape|check-doc-refs|storeUpLevel|managerOfBranch/;

const PANELS = ['manage', 'lab', 'up', 'staff', 'rival', 'ach'];

/** 走一遍所有可达界面 */
function scanAll() {
  const { window, doc, E } = buildH5Env();
  const s = E.newGame('normal', 0, null);
  s.cash = 300000;
  window.S = s;
  /* 造一份「字段都齐全」的存档，把所有分支都渲染到 */
  window.eval(`(function(){
    var s = window.S;
    openStore(s, { cityId: '510100' });
    openStore(s, { cityId: '310100' });
    if (!s.formerManagers) s.formerManagers = [];
    s.formerManagers.push({ id: 9001, name: '老王', emoji: '🧑‍💼', lv: 2, skill: 1.1,
      trait: 'ops', wage: 200, days: 5, fromStore: '老店' });
    var st = s.stores[1];
    hireManager(s, st.branch, 0);
    setStoreAuto(s, st.branch, true);
    s.news = { text: '今日客流不错' };
    if (!s.contract) { var om = openShop(s); if (om.ok) {} }
  })()`);

  const hits = [];
  for (const p of PANELS) {
    window.eval(`UI.setTab('${p}'); UI.renderAll();`);
    const el = doc.getElementById('panel-' + p);
    if (!el) continue;
    const txt = el.textContent || '';
    /* 逐行找 —— 泄漏的是整段注释，会占好几行 */
    for (const raw of txt.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      /* ★ 判据（第一版太严，注入测试抓不到）：
         只要行首是注释起始符就判定泄漏 ——
         游戏文案里**绝不会**出现「/*」开头的内容，
         所以这个信号可以单独成立，不必再叠加其它条件。
         ★ 注入验证：把一行注释放回模板内 → 必须被抓到。 */
      if (/^\/\s*\*/.test(line)) {
        hits.push({ panel: p, line: line.slice(0, 80) });
      }
    }
  }
  return hits;
}

console.log('=== 源码注释泄漏检查（扫渲染后的 DOM）===\n');
const hits = scanAll();

if (hits.length === 0) {
  console.log('✔ 6 个面板均无源码泄漏');
  process.exit(0);
}

console.log('✘ 发现 ' + hits.length + ' 行源码泄漏到界面：\n');
for (const h of hits) {
  console.log('   [' + h.panel + '] ' + h.line);
}
console.log('');
console.log('修法：把注释放到模板字符串**外面**。');
console.log('  const xHtml = `...`;    // 注释写在等号与模板之间');
console.log('  h += `<div>${xHtml}</div>`;');
process.exit(1);