/**
 * 线上冒烟：拉取**已部署**的产物并跑一遍核心流程。
 *
 * ★ 为什么要有这个：
 *   本地测试全绿 ≠ 部署出去的东西能用。
 *   线上可能：资源路径不对（子目录部署）、编码被转、缓存拿到旧版本、
 *   或某个只在真实加载顺序下才暴露的初始化问题。
 *   这个工具直接验证「线上那份」的行为。
 *
 * ★ 也支持本地地址（http://localhost:8080）——
 *   改部署方式（换托管方、改目录、改 CDN）时，先用它验本地产物，
 *   避免"本地过了、线上挂"。
 *
 * 用法：
 *   node tools/online-smoke.js                              # 默认线上地址
 *   node tools/online-smoke.js http://localhost:8080       # 本地服务
 */
const http = require('http');
const https = require('https');
const { JSDOM, VirtualConsole } = require('./jsdom-loader');

const BASE = (process.argv[2] || 'https://xuancheng2024.github.io/bubble-tycoon/')
  .replace(/\/?$/, '/');

/* ★ 本地服务是 http://，线上是 https:// —— 协议必须按实际 URL 选，
   否则会报 ERR_INVALID_PROTOCOL（第一版写死 https 就踩了这个）。 */
const isHttps = BASE.startsWith('https://');
const agent = isHttps ? https : http;

function get(path) {
  return new Promise((resolve, reject) => {
    agent.get(BASE + path, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ code: res.statusCode, body: d }));
    }).on('error', reject);
  });
}

(async () => {
  console.log('=== 产物冒烟 · ' + BASE + ' ===\n');
  const files = ['index.html', 'styles.css'].concat(require('./frontend-files.js').H5_FILES);
  const src = {};
  for (const f of files) {
    const r = await get(f);
    if (r.code !== 200) { console.log('✘ 拉取失败:', f, r.code); process.exit(1); }
    src[f] = r.body;
  }
  console.log('已拉取全部资源（' + files.length + ' 个）');

  /* 内联 script 后用 jsdom 跑（与 browser-smoke 同一套做法） */
  const html = src['index.html'].replace(
    /<script src="js\/([a-z]+)\.js"><\/script>/g,
    (m, name) => '<script>' + src['js/' + name + '.js'] + '<\/script>');

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'http://localhost/',
    pretendToBeVisual: true, virtualConsole: vc,
  });
  const { window } = dom;
  const doc = window.document;

  if (window.HTMLCanvasElement) {
    window.HTMLCanvasElement.prototype.getContext = function () {
      return new Proxy({}, {
        get: (t, p) => (p === 'measureText' ? (s => ({ width: String(s).length * 6.5 })) : (() => { })),
        set: () => true,
      });
    };
  }

  let fail = 0;
  const check = (ok, name) => { console.log((ok ? '  ✔ ' : '  ✘ ') + name); if (!ok) fail++; };

  check(typeof window.eval('newGame') === 'function', '产物引擎可用（newGame）');
  check(typeof window.eval('UI') === 'object', '产物 UI 挂载');

  const s = window.eval('newGame("normal", 0, null)');
  /* ★ 必须挂到 window.S —— UI 的渲染函数都从 window.S 取状态，
     不挂的话 UI.setTab 拿到的 S 是 null，六个 Tab 全渲染异常。 */
  window.S = s;
  check(!!s && s.day === 1 && s.shops === 1, '产物能开局（Day 1 · 1 店）');
  check(Array.isArray(s.stores) && s.stores.length === 1, '产物有店铺数据（stores）');

  window.eval('renderTitle()');
  check((doc.body.textContent || '').indexOf('奶茶星球') >= 0, '标题页渲染正常');

  const tabs = ['manage', 'lab', 'up', 'staff', 'rival', 'ach'];
  const bad = [];
  for (const t of tabs) {
    window.eval('UI.setTab("' + t + '"); UI.renderAll();');
    const el = doc.getElementById('panel-' + t);
    const txt = el ? el.textContent : '';
    if (!txt || /undefined|NaN|\[object Object\]/.test(txt)) bad.push(t);
  }
  check(bad.length === 0, '六个 Tab 全部渲染正常' + (bad.length ? '（异常：' + bad.join(',') + '）' : ''));

  /* V10~V13 的新系统在线上是否可用 */
  const mv = window.eval('cityMapView(window.S)');
  check(mv && mv.points.length === 44, '城市地图可用（44 个有坐标城市）');
  const mc = window.eval('managerCount ? managerCount(window.S) : 0');
  check(typeof mc === 'number', '店长系统可用');

  const day = window.eval(`(function(){
    var s = window.S;
    s.cash = 100000;
    for (var i = 0; i < ING.length; i++) s.inv[ING[i].id] = 300;
    var om = openShop(s);
    if (!om.ok) return 'open-fail:' + om.msg;
    var g = 0;
    while (s.sim && !s.sim.closing && g++ < 400) tick(s, 0.12);
    endDay(s);
    return s.lastReport ? ('ok,cup=' + s.lastReport.served + ',net=' + Math.round(s.lastReport.net)) : 'no-report';
  })()`);
  check(String(day).indexOf('ok') === 0, '能完整走完一天营业：' + day);

  const real = errors.filter(e => !/Not implemented|Could not parse CSS/.test(e));
  check(real.length === 0, '运行无脚本错误' + (real.length ? '：' + real.slice(0, 2).join(' | ') : ''));

  console.log('');
  if (fail === 0) console.log('✅ 产物冒烟全部通过');
  else console.log('❌ 产物冒烟 ' + fail + ' 项异常');
  process.exit(fail === 0 ? 0 : 1);
})();
