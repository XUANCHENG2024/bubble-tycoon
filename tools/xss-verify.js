/* XSS / 脏存档 专项验证：确认恶意字符串只作为文本存在，不会被解析成元素或事件属性 */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('./jsdom-loader');

const root = path.join(__dirname, '..');
const vc = new VirtualConsole(); const errors = [];
vc.on('jsdomError', e => errors.push(e.message));

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script src="js\/([a-z]+)\.js"><\/script>/g,
  (m, n) => '<script>' + fs.readFileSync(path.join(root, 'js', n + '.js'), 'utf8') + '<\/script>');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom, doc = window.document;

setTimeout(() => {
  window.eval('window.__G = { UI, sanitizeState, importSave, b64encode, newGame };');
  const G = window.__G;
  const s = window.newGame('normal', 0);
  s.log = ['<img src=x onerror="window.__PWN=1">', '<script>window.__PWN2=1<\/script>', '<svg onload=alert(1)>'];
  s.rival.name = '<img src=y onerror="window.__PWN3=1">';
  s.staff = [{ id: 9, name: '<b onclick="window.__PWN4=1">evil</b>', emoji: '<svg>', skill: 1, trait: null, wage: 50, stamina: 100 }];
  window.S = s;
  G.UI.setTab('manage'); G.UI.setTab('staff'); G.UI.setTab('rival');

  const pm = doc.getElementById('panel-manage');
  console.log('--- 日志区实际 HTML ---');
  console.log(((pm.innerHTML.match(/jrow[\s\S]{0,110}/) || [''])[0]).replace(/\n\s*/g, ' '));
  console.log('--- 解析结果 ---');
  for (const id of ['panel-manage', 'panel-staff', 'panel-rival']) {
    const el = doc.getElementById(id);
    console.log(`  ${id}: img=${el.querySelectorAll('img').length} script=${el.querySelectorAll('script').length} [onerror]=${el.querySelectorAll('[onerror]').length} [onclick]=${el.querySelectorAll('[onclick]').length}`);
  }
  console.log('注入是否得逞(__PWN*):', !!(window.__PWN || window.__PWN2 || window.__PWN3 || window.__PWN4));
  console.log('payload 以纯文本保留:', pm.textContent.includes('onerror="window.__PWN=1"'));
  console.log('脚本错误:', errors.length ? errors.slice(0, 3) : '无');

  /* 再走一遍「导出→导入→渲染」全链路 */
  const evil = Object.assign({}, s, { v: 2, day: 3 });
  const r = G.importSave(G.b64encode(JSON.stringify(evil)));
  console.log('导入成功:', !!r.ok);
  if (r.ok) {
    window.S = r.state;
    G.UI.setTab('manage'); G.UI.setTab('rival'); G.UI.renderHUD();
    const el = doc.getElementById('panel-manage');
    console.log('导入后 img/script/[onerror]:',
      el.querySelectorAll('img').length, el.querySelectorAll('script').length, el.querySelectorAll('[onerror]').length);
    console.log('HUD:', doc.getElementById('hudCash').textContent + doc.getElementById('hudRep').textContent + doc.getElementById('hudWorth').textContent);
  }
  console.log('注入是否得逞(导入后):', !!(window.__PWN || window.__PWN2 || window.__PWN3 || window.__PWN4));
  console.log('脚本错误:', errors.length ? errors.slice(0, 3) : '无');
  process.exit(errors.length ? 1 : 0);
}, 60);
