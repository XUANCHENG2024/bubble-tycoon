/* ============================================================
 *  移动端兼容性验证（Android / iOS · Chrome / Safari）
 *
 *  jsdom 不做真实排版，也不带 canvas 后端，所以这里验证的是「能验证的部分」：
 *    A. 不同 UA + 视口尺寸下，整条游戏链路能否无错跑通
 *    B. iOS 专属代码分支是否正确（<a download> 失效兜底、剪贴板降级、音频解锁）
 *    C. CSS / HTML 里的移动端适配项是否真的存在（静态断言，防回归）
 *  视觉与真机排版需在 Chrome DevTools 设备模拟里肉眼复核。
 * ============================================================ */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('./jsdom-loader');
const { inlineScripts } = require('./inline-scripts.js');

const root = path.join(__dirname, '..');

/* 设备画像：platform / maxTouchPoints 必须一并伪装，
   因为 iPadOS 13+ 的 UA 伪装成 MacIntel，只能靠 maxTouchPoints 分辨 */
const IPHONE = {
  ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  platform: 'iPhone', tp: 5,
};
const IPAD = {
  ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  platform: 'MacIntel', tp: 5,       /* 关键：iPadOS 伪装成 Mac，但支持多点触控 */
};
const MACBOOK = {
  ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  platform: 'MacIntel', tp: 0,       /* 真 Mac：无触控 */
};
const ANDROID = {
  ua: 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  platform: 'Linux armv8l', tp: 5,
};

const rawHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const srcHtml = inlineScripts(root, rawHtml);

let step = 0, failed = 0;
function ok(m) { console.log(`  ✔ ${++step}. ${m}`); }
function bad(m) { failed++; console.log(`  ✘ ${++step}. ${m}`); }
function check(c, m) { c ? ok(m) : bad(m); }

/**
 * 起一个 jsdom 实例。
 * innerWidth / maxTouchPoints 必须在脚本执行前注入（beforeParse），
 * 否则游戏里那些「加载时求值」的常量（如 IS_IOS）拿到的还是默认值。
 */
function boot(device, w, h) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message || String(e)));
  vc.on('error', (...a) => errors.push(a.join(' ')));

  const dom = new JSDOM(srcHtml, {
    runScripts: 'dangerously', url: 'http://localhost/',
    pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      /* jsdom 会忽略构造函数的 userAgent 选项，必须自己 defineProperty。
         同时这也是唯一能在「脚本执行前」把环境伪装好的时机。 */
      Object.defineProperty(window.navigator, 'userAgent', { value: device.ua, configurable: true });
      Object.defineProperty(window.navigator, 'platform', { value: device.platform, configurable: true });
      Object.defineProperty(window.navigator, 'maxTouchPoints', { value: device.tp, configurable: true });
      Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
      if (!window.navigator.clipboard) {
        Object.defineProperty(window.navigator, 'clipboard',
          { value: { writeText: () => Promise.resolve() }, configurable: true });
      }
    },
  });
  return { window: dom.window, errors };
}

/** 把顶层 const 显式挂到 window（它们只在全局词法作用域里，不是 window 的属性） */
const expose = w => w.eval(
  'window.UI = UI; window.SFX = SFX; window.IS_IOS = IS_IOS;');

const tick = () => new Promise(r => setTimeout(r, 0));

/* 假 canvas：jsdom 没装 node-canvas 时 getContext 返回 null，
   用带 toDataURL 的替身把 UI.downloadCard 的逻辑与 canvas 后端解耦 */
function fakeShareCanvas(doc) {
  const el = doc.createElement('div');
  el.id = 'shareCanvas';
  el.toDataURL = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  doc.getElementById('fx').appendChild(el);
  return el;
}

(async function run() {
  /* ---------- A. 五种设备画像下跑完整链路 ---------- */
  const profiles = [
    { name: 'iPhone 15 Safari 竖屏 390×844', d: IPHONE, w: 390, h: 844 },
    { name: 'iPadOS（MacIntel 伪装）820×1180', d: IPAD, w: 820, h: 1180 },
    { name: '小屏安卓 Chrome 360×640', d: ANDROID, w: 360, h: 640 },
    { name: '安卓横屏 844×390', d: ANDROID, w: 844, h: 390 },
    { name: '超窄屏 320×568（iPhone SE1）', d: IPHONE, w: 320, h: 568 },
  ];

  for (const p of profiles) {
    const { window, errors } = boot(p.d, p.w, p.h);
    await tick();
    const doc = window.document;
    expose(window);

    let loopErr = null;
    try {
      doc.getElementById('btnStart').click();
      await tick();
      const s = window.S;
      for (const t of ['manage', 'lab', 'up', 'staff', 'rival', 'ach']) { window.UI.setTab(t); await tick(); }
      window.UI.setTab('manage'); await tick();
      s.menu = s.recipes.slice(0, window.menuSlots(s));
      for (const r of s.menu) s.ratios[r] = 1.0;
      window.doAct('open', doc.getElementById('btnStart'));
      for (let i = 0; i < 900 && s.phase === 'open'; i++) {
        window.tick(s, 1 / 30);
        if (s.sim && s.sim.stations[0] && s.sim.stations[0].order) window.rushStation(s, 0);
        window.UI.stageSync();
      }
      if (s.phase === 'report') { window.UI.showReport(); await tick(); }
    } catch (e) { loopErr = e.message; }

    check(!loopErr && errors.length === 0,
      `${p.name} 全链路无异常${loopErr ? '：' + loopErr : (errors.length ? '：' + errors[0] : '')}`);
    window.close();
  }

  /* ---------- B. iOS 专属分支 ---------- */
  const ios = boot(IPHONE, 390, 844);
  await tick();
  const W = ios.window, D = W.document;
  expose(W);
  check(W.IS_IOS === true, 'iPhone UA 正确识别为 iOS');

  fakeShareCanvas(D);
  W.UI.downloadCard();
  await tick();
  const iosBox = D.getElementById('modalBox').innerHTML;
  check(/长按下方图片/.test(iosBox), 'iOS 战绩卡片走「长按保存」兜底（不会假装下载成功）');
  check(/<img src="data:image\/png/.test(iosBox), 'iOS 兜底弹窗内确实嵌入了图片');
  ios.window.close();

  const ipad = boot(IPAD, 820, 1180);
  await tick();
  expose(ipad.window);
  check(ipad.window.IS_IOS === true, 'iPadOS（MacIntel 伪装）靠 maxTouchPoints 识别为 iOS');
  ipad.window.close();

  const mac = boot(MACBOOK, 1440, 900);
  await tick();
  expose(mac.window);
  check(mac.window.IS_IOS === false, '真 Mac（MacIntel 但无触控）不误判为 iOS');
  mac.window.close();

  const and = boot(ANDROID, 360, 640);
  await tick();
  const A = and.window, AD = A.document;
  expose(A);
  check(A.IS_IOS === false, 'Android UA 不误判为 iOS');
  fakeShareCanvas(AD);
  let clicked = false;
  const origCreate = AD.createElement.bind(AD);
  AD.createElement = tag => {
    const el = origCreate(tag);
    if (String(tag).toLowerCase() === 'a') el.click = () => { clicked = true; };
    return el;
  };
  A.UI.downloadCard();
  await tick();
  check(clicked, 'Android 仍走原生 <a download> 下载');
  AD.createElement = origCreate;
  and.window.close();

  /* iOS 音效解锁：tone() 必须自己 resume，否则玩家首次点出杯位后整局静音 */
  const sfx = boot(IPHONE, 390, 844);
  await tick();
  expose(sfx.window);
  let resumed = 0;
  sfx.window.FAKE_AC = function () {
    this.state = 'suspended';
    this.currentTime = 0;
    this.destination = {};
    this.resume = () => { this.state = 'running'; resumed++; return Promise.resolve(); };
    this.createOscillator = () => ({ type: '', frequency: { setValueAtTime() { } }, connect() { }, start() { }, stop() { } });
    this.createGain = () => ({ gain: { setValueAtTime() { }, exponentialRampToValueAtTime() { } }, connect() { } });
  };
  sfx.window.eval('window.AudioContext = window.FAKE_AC; window.SFX.ac = null; window.SFX.on = true; window.SFX.click();');
  check(resumed > 0, 'iOS 首次发声自动 resume AudioContext（不会整局静音）');
  sfx.window.close();

  check(/pointerdown[\s\S]{0,120}SFX\.resume/.test(fs.readFileSync(path.join(root, 'js/main.js'), 'utf8')),
    '已挂载一次性全局手势解锁音频');

  /* ---------- C. CSS / HTML 移动端适配静态断言 ---------- */
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const must = [
    ['HTML 开启 viewport-fit=cover', /viewport-fit=cover/.test(rawHtml)],
    ['touch-action:manipulation 防双击缩放', /touch-action:\s*manipulation/.test(css)],
    ['100dvh 动态视口（修 iOS/Chrome 工具条遮挡）', /100dvh/.test(css)],
    ['-webkit-fill-available 兜底旧版 iOS', /-webkit-fill-available/.test(css)],
    ['定义 safe-area 变量（避让灵动岛 / Home 键）', /--sat:\s*env\(safe-area-inset-top/.test(css)],
    ['.stage 底部留安全区（暂停按钮不被压）', /\.stage\s*\{[^}]*var\(--sab\)/s.test(css)],
    ['.hud 顶部留安全区（HUD 不被灵动岛压）', /\.hud\s*\{[^}]*var\(--sat\)/s.test(css)],
    /* ★ 断言要锁「**最终计算值**」而不是「写法」——
         这条以前是正则匹配 `font-size:\s*16px`，
         字号令牌化后写法变成 `var(--fs-xl)`，正则就匹配不上了。
         但**需求没变**：iOS Safari 对 font-size < 16px 的输入框
         会强制放大整个页面且失焦不缩回，所以实际值必须 ≥16px。
         现在把 var() 解析成数值再比 —— 写法可换，约束不变。 */
    ['.code-box 字号 ≥16px（防 iOS 聚焦缩放）', (() => {
      const block = css.match(/\.code-box\s*\{([^}]*)\}/s);
      if (!block) return false;
      const m = block[1].match(/font-size:\s*([^;]+)/);
      if (!m) return false;
      let v = m[1].trim();
      const vm = v.match(/var\(--fs-(\w+)\)/);
      if (vm) {
        const tok = css.match(new RegExp('--fs-' + vm[1] + ':\\s*([0-9.]+)px'));
        if (!tok) return false;
        v = tok[1] + 'px';
      }
      return parseFloat(v) >= 16;
    })()],
    ['移动端关闭 backdrop-filter（降 GPU 开销）', /\.modal-mask\s*\{\s*-webkit-backdrop-filter:\s*none/s.test(css)],
    ['触摸目标 ≥44px', /min-height:\s*44px/.test(css)],
    ['-webkit-overflow-scrolling 惯性滚动', /-webkit-overflow-scrolling:\s*touch/.test(css)],
    ['overscroll-behavior:none 关橡皮筋', /overscroll-behavior:\s*none/.test(css)],
    ['横屏适配', /orientation:\s*landscape/.test(css)],
    ['尊重 prefers-reduced-motion', /prefers-reduced-motion/.test(css)],
    ['滑杆 touch-action:none（拖动不误触缩放）', /input\[type=range\][^}]*touch-action:\s*none/s.test(css)],
    ['-webkit-user-select 前缀（旧 iOS 只认它）', /-webkit-user-select:\s*none/.test(css)],
    ['-webkit-touch-callout:none（长按不弹菜单）', /-webkit-touch-callout:\s*none/.test(css)],
  ];
  for (const [label, pass] of must) check(pass, '适配项：' + label);

  console.log('');
  if (failed === 0) console.log('✅ 移动端兼容性验证全部通过（' + step + ' 项）');
  else console.log(`❌ 失败 ${failed} 项 / 共 ${step} 项`);
  process.exit(failed === 0 ? 0 : 1);
})();
