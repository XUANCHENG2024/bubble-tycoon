/* ============================================================
 *  XSS / 脏存档 专项验证
 *
 *  判定口径很重要：早期版本靠 `window.__PWN` 这个 onerror 回调来判断，
 *  但 jsdom 默认**不加载外部资源**（img src=x 根本不会发起请求），
 *  onerror 永远不触发 —— 那条断言恒为 false，看着像"很安全"，其实是虚假安全感。
 *  真正可靠的判据是：payload 有没有被浏览器**解析成元素或事件属性**。
 *  所以这里统一数 img / script / [onerror] / [onload] 的个数。
 * ============================================================ */
const fs = require('fs'), path = require('path');
const { inlineScripts } = require('./inline-scripts.js');
const { JSDOM, VirtualConsole } = require('./jsdom-loader');

const root = path.join(__dirname, '..');
const vc = new VirtualConsole(); const errors = [];
vc.on('jsdomError', e => errors.push(e.message));

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = inlineScripts(root, html);
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom, doc = window.document;

let failed = 0;
function check(cond, msg) {
  console.log(`  ${cond ? '✔' : '✘'} ${msg}`);
  if (!cond) failed++;
}
/* 有没有被解析成真正的元素 / 事件属性
   ★ V13：城市地图用 <svg> 绘制（可点、不失真），
     而攻击 payload 里恰好也有 '<svg onload=alert(1)>' ——
     原来的检测器统计**所有** <svg> 元素，
     于是把**我们自己画的地图**误判成注入（假阳性）。

   ★ 修法不能是「排除所有 svg」—— 那会让真的 <svg onload=...> 注入漏过。
     精确判据：只统计**没有 class 的** svg（注入的 payload 是裸 <svg>，
     我们自己的地图 svg 一定带 class="map-svg"），
     且**任何带事件属性的 svg 都算注入**（不管有没有 class）。 */
function evilCount(el) {
  const q = s => el.querySelectorAll(s).length;
  const allSvg = el.querySelectorAll('svg');
  let bareSvg = 0;
  for (const sv of allSvg) {
    if (!sv.getAttribute('class')) bareSvg++;
  }
  return {
    img: q('img'), script: q('script'), svg: bareSvg,
    onerror: q('[onerror]'), onload: q('[onload]'),
  };
}
function total(c) { return c.img + c.script + c.svg + c.onerror + c.onload; }

/* 覆盖所有会进 innerHTML 的玩家可控字符串：
   日志、员工/候选人名、对手名、新闻文案、成就与任务文案 */
const PAYLOADS = [
  '<img src=x onerror="window.__PWN=1">',
  '<script>window.__PWN2=1<\/script>',
  '<svg onload=alert(1)>',
  '"><b onclick="window.__PWN3=1">evil</b>',
];

setTimeout(() => {
  window.eval('window.__G = { UI, sanitizeState, importSave, b64encode, newGame };');
  const G = window.__G;

  const s = window.newGame('normal', 0);
  s.log = PAYLOADS.slice();
  s.rival.name = '<img src=y onerror="window.__PWN4=1">';
  s.news = { id: 'evil', text: '<img src=z onerror="window.__PWN5=1">📰 新闻', fx: {} };
  s.staff = [{ id: 9, name: '<b onclick="window.__PWN6=1">evil</b>', emoji: '<svg>', skill: 1, trait: null, wage: 50, stamina: 100 }];
  s.candidates = [{ name: '<img src=c onerror="window.__PWN7=1">', emoji: '🧑', skill: 1, trait: null, wage: 60, fee: 260 }];
  window.S = s;
  G.UI.setTab('manage'); G.UI.setTab('staff'); G.UI.setTab('rival'); G.UI.setTab('lab');
  G.UI.renderHUD();

  console.log('--- 直接把脏状态塞给渲染层 ---');
  for (const id of ['panel-manage', 'panel-staff', 'panel-rival', 'panel-lab', 'hudDay', 'hudCash']) {
    const el = doc.getElementById(id);
    if (!el) { check(false, `${id} 面板不存在`); continue; }
    const c = evilCount(el);
    check(total(c) === 0, `${id}：payload 未被解析成元素/事件属性（img=${c.img} script=${c.script} svg=${c.svg} onerror=${c.onerror} onload=${c.onload}）`);
  }
  const pm = doc.getElementById('panel-manage');
  check(pm.textContent.includes('onerror="window.__PWN=1"'), 'payload 以纯文本原样保留（说明转义生效）');

  /* 再走一遍「导出 → 导入 → 渲染」全链路：这是玩家真正能拿到别人存档的路径 */
  console.log('--- 导出 → 导入 → 渲染（真实的外部存档入口）---');
  const evil = Object.assign({}, s, { v: 2, day: 3 });
  const r = G.importSave(G.b64encode(JSON.stringify(evil)));
  check(!!r.ok, '恶意存档能被导入（清洗器放行，但必须已净化）');
  if (r.ok) {
    window.S = r.state;
    G.UI.setTab('manage'); G.UI.setTab('rival'); G.UI.setTab('lab'); G.UI.renderHUD();
    for (const id of ['panel-manage', 'panel-rival', 'panel-lab']) {
      const el = doc.getElementById(id);
      const c = evilCount(el);
      check(total(c) === 0, `${id}：导入后 payload 仍未变成元素（${JSON.stringify(c)}）`);
    }
  }

  /* 引擎内部拼 HTML 的地方（adviceOf 带 <b> 标签，渲染层会整段放行） */
  console.log('--- 引擎生成的 HTML 片段 ---');
  const adv = window.eval('(function(){ var s2 = newGame("normal",0); s2.rival.name = "<img src=q onerror=window.__PWN8=1>"; s2.rival.rep = 80; s2.rep = 20; var box = document.createElement("div"); box.innerHTML = adviceOf(s2).map(function(a){return a.text;}).join(""); return box.querySelectorAll("img").length + "|" + box.querySelectorAll("[onerror]").length; })()');
  check(adv === '0|0', `adviceOf 里的对手名已转义（img|[onerror] = ${adv}）`);

  check(errors.length === 0, `无脚本错误${errors.length ? '：' + errors.slice(0, 3).join(' / ') : ''}`);

  console.log('');
  if (failed === 0) console.log('✅ 注入未得逞：' + PAYLOADS.length + ' 组 payload 均作为纯文本存在');
  else console.log(`❌ 有 ${failed} 项被成功注入`);
  process.exit(failed === 0 ? 0 : 1);
}, 60);
