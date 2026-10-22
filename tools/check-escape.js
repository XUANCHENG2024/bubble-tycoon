/**
 * 存档可控字段的转义检查。
 *
 * ★ 为什么要有这个：
 *   V12/V13 新增了 store.name/emoji、manager.name/emoji、
 *   formerManagers[].name/emoji/fromStore 这些**存档可控**字段，
 *   其中 3 个 `emoji` 字段漏了 esc() —— 而同对象上的 `name` 转义了。
 *   **同一个对象里只转义一半，肉眼极难发现**（review 时会以为「name 都转了」）。
 *
 * ★ 为什么「唯一一处漏掉 esc()」那句注释本身是个隐患：
 *   它描述的是**当时**的情况。V12 之后已经不成立，
 *   而后来人读到它会误以为「除了 news 其它都安全」——
 *   于是新加字段时不自觉地不转义。所以改成机器检查。
 *
 * 用法：node tools/check-escape.js
 */
const { buildH5Env } = require('./h5-env.js');

const PAYLOAD = '<img src=x onerror="window.__PWN=1">';

/* 每个字段配一段「如何污染它」的代码 —— 每次只污染一个，定位精确 */
const FIELDS = [
  ['store.name', 'st.name = P'],
  ['store.emoji', 'st.emoji = P'],
  ['store.cityId', 'st.cityId = P'],
  ['store.venueType', 'st.venueType = P'],
  ['manager.name', 'managerOfBranch(s, st.branch).name = P'],
  ['manager.emoji', 'managerOfBranch(s, st.branch).emoji = P'],
  ['formerManager.name', 's.formerManagers[0].name = P'],
  ['formerManager.emoji', 's.formerManagers[0].emoji = P'],
  ['formerManager.fromStore', 's.formerManagers[0].fromStore = P'],
  ['news.text', 's.news = { text: P }'],
];

const PANELS = ['manage', 'lab', 'up', 'staff', 'rival', 'ach'];

let failed = 0;
const bad = [];

console.log('=== 存档可控字段转义检查 ===\n');

for (const [label, code] of FIELDS) {
  const { window, doc, E } = buildH5Env();
  const s = E.newGame('normal', 0, null);
  s.cash = 300000;
  window.S = s;
  window.eval(`(function(){
    var P = ${JSON.stringify(PAYLOAD)};
    var s = window.S;
    openStore(s, { cityId: '510100' });
    var st = s.stores[1];
    hireManager(s, st.branch, 0);
    if (!s.formerManagers) s.formerManagers = [];
    s.formerManagers.push({ id: 9001, name: 'x', emoji: 'x', lv: 2, skill: 1,
      trait: 'ops', wage: 100, days: 1, fromStore: 'x' });
    ${code.replace(/P/g, JSON.stringify(PAYLOAD))}
  })()`);

  const hits = [];
  for (const p of PANELS) {
    window.eval(`UI.setTab('${p}'); UI.renderAll();`);
    const el = doc.getElementById('panel-' + p);
    /* 只看真实的注入元素：<img> 且带 onerror */
    const n = Array.from(el.querySelectorAll('img'))
      .filter(img => img.getAttribute('onerror')).length;
    if (n) hits.push(p + '(' + n + ')');
  }
  if (hits.length) {
    failed++;
    bad.push(label + ' → ' + hits.join(','));
    console.log('  ✘ ' + label + ' → 注入成功：' + hits.join(', '));
  } else {
    console.log('  ✔ ' + label + ' → 已转义');
  }
}

console.log('');
if (failed) {
  console.log('✘ ' + failed + ' 个字段未转义：');
  for (const b of bad) console.log('   ', b);
  console.log('');
  console.log('修法：渲染时用 esc() 包住字段，例如 ${esc(st.emoji)}');
} else {
  console.log('✔ 全部 ' + FIELDS.length + ' 个存档可控字段均已转义');
}
process.exit(failed ? 1 : 0);
