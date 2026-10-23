/**
 * 文本截断专项测试（V20.8）—— GFX.text() 的 maxW 截断路径
 *
 * ★★ 为什么必须有这个测试 ★★
 *   V20.7 把 `text()` 的截断从「从尾部逐字符删」改成了「二分查找」，
 *   ★ 但**从头到尾没有任何一个测试覆盖它**。
 *   ★ 这是很危险的状态：截断是「文字不被截断」这条诉求的最后一道防线，
 *     一旦它坏了，界面上会到处出现「半个词」或「省略号糊在边上」。
 *
 * ★★ 测什么 ★★
 *   ① 硬约束：截断后的**实际绘制宽度 ≤ maxW**（含「…」本身占的宽度）
 *      —— 这是唯一真正重要的不变量。
 *   ② 二分查找的**最优性**：不能比理论最优解少 2 个字符以上
 *      （少 1 个字符是「…」预留导致的，可接受）。
 *   ③ 英文断词：切点必须落在**空格边界**，不能把单词劈成两半。
 *   ④ 中文逐字断开：中文没有空格，必须按字符断，且不能丢字。
 *   ⑤ 极端边界：maxW 极小 / 字符串极短 / 空串 / 单字符
 *      —— 不能抛异常、不能返回 undefined、不能画出屏幕外的字。
 *
 * 用法：node tools/test-text-truncate.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

/* ---------- 加载 bundle（跑真实代码，不是复刻） ---------- */
try {
  require('child_process').execFileSync(process.execPath,
    [path.join(root, 'tools', 'build-minigame.js')], { stdio: 'ignore' });
} catch (e) { /* 忽略 */ }
const BUNDLE = fs.readFileSync(path.join(root, 'minigame', 'bundle.js'), 'utf8');

/**
 * 起一个最小环境，只提供 GFX.text 需要的 ctx。
 * ★ 文本宽度模型与 diag-canvas-layout.js 保持一致：
 *   中文/全角 = 1 × size，ASCII = 0.55 × size。
 *   ★ 为什么要区分：若一律按 0.55 算，中文会显得很窄，
 *     「会不会溢出」就测不准了。
 */
function makeCtx() {
  let curSize = 13;
  const drawn = [];
  const fakeCtx = new Proxy({}, {
    get(t, p) {
      if (p === 'measureText') {
        return (s) => ({ width: textWidth(String(s), curSize) });
      }
      if (p === 'fillText') {
        return (s, x, y) => { drawn.push({ text: String(s), x, y, size: curSize }); };
      }
      if (p === 'strokeText') return () => { };
      if (p === 'font') return undefined;
      if (p === 'textAlign') return 'left';
      if (p === 'textBaseline') return 'top';
      return () => { };
    },
    set(t, p, v) {
      if (p === 'font') {
        const m = /(\d+(?:\.\d+)?)px/.exec(String(v));
        curSize = m ? Number(m[1]) : 13;
      }
      t[p] = v;
      return true;
    },
  });
  return { fakeCtx, drawn };
}

function textWidth(s, size) {
  let w = 0;
  for (const ch of String(s)) {
    w += ch.charCodeAt(0) > 255 ? size : size * 0.55;
  }
  return w;
}

const ctxObj = {
  console, Math, JSON, Date, Object, Array, String, Number, Boolean, Error,
  Set, Map, isNaN, parseInt, parseFloat, setTimeout, clearTimeout,
  TextEncoder, TextDecoder,
  requestAnimationFrame() { return 0; },
};
vm.createContext(ctxObj);
vm.runInContext(BUNDLE, ctxObj, { filename: 'bundle.js' });

/* ============================================================
 *  断言工具
 * ============================================================ */
let pass = 0, fail = 0;
const failures = [];

function ok(cond, name, detail) {
  if (cond) { pass++; }
  else {
    fail++;
    failures.push(name + (detail ? ' —— ' + detail : ''));
    console.log('  ✘ ' + name + (detail ? '\n      ' + detail : ''));
  }
}

/** 跑一次 GFX.text，返回实际绘制的字符串与宽度 */
function drawText(str, maxW, size) {
  const { fakeCtx, drawn } = makeCtx();
  vm.runInContext(
    `GFX.text(ctx, ${JSON.stringify(str)}, 10, 20, { size: ${size || 12}, maxW: ${maxW == null ? 'null' : maxW} })`,
    Object.assign(ctxObj, { ctx: fakeCtx })
  );
  const d = drawn[drawn.length - 1];
  if (!d) return { text: '', w: 0, size: size || 12 };
  return { text: d.text, w: textWidth(d.text, d.size), size: d.size };
}

/** 暴力求「不考虑断词」时的理论最优前缀长度（含 …） */
function bruteOptLen(s, maxW, size) {
  let best = 0;
  for (let k = 0; k <= s.length; k++) {
    if (textWidth(s.slice(0, k) + '…', size) <= maxW) best = k;
    else break;
  }
  return best;
}

console.log('=== 文本截断专项测试（GFX.text maxW）===\n');

/* ============================================================
 *  ① 硬约束：绘制宽度 ≤ maxW
 * ============================================================ */
console.log('--- ① 截断后宽度不得超过 maxW（含「…」占位）---');
{
  const cases = [
    { s: '欢迎来到泡泡大亨经营模拟器', maxW: 120, size: 12 },
    { s: 'Hello wonderful world of bubble tycoon', maxW: 140, size: 12 },
    { s: '超长文本'.repeat(30), maxW: 200, size: 14 },
    { s: '短', maxW: 100, size: 12 },
    { s: '刚好', maxW: 24, size: 12 },
  ];
  for (const c of cases) {
    const r = drawText(c.s, c.maxW, c.size);
    ok(r.w <= c.maxW + 0.001,
      '宽度约束 ' + JSON.stringify(c.s.slice(0, 12)) + ' maxW=' + c.maxW,
      '实际宽 ' + r.w.toFixed(2) + ' > ' + c.maxW + '，绘制文本=' + JSON.stringify(r.text));
  }
}

/* ============================================================
 *  ② 二分查找最优性
 * ============================================================ */
console.log('\n--- ② 二分查找不应明显短于最优解 ---');
{
  /* ★ 分两类断言，因为「断词」本身就会牺牲字符：
   *   · 无空格文本（中文/连续符号）→ 必须严格接近理论最优
   *   · 有空格文本（英文）→ 允许为「不在单词中间断开」而牺牲，
   *     但牺牲必须有界（不超过尾词长度）—— 否则就成了「只显示前几个字」。
   */
  const noSpace = [
    { s: 'abcdefghijklmnopqrstuvwxyz0123456789', maxW: 120, size: 12 },
    { s: '欢迎来到泡泡大亨经营模拟器今天天气不错', maxW: 150, size: 12 },
    { s: 'Mixed中英文mixedcontent混合内容测试用例', maxW: 160, size: 12 },
  ];
  for (const c of noSpace) {
    const r = drawText(c.s, c.maxW, c.size);
    const opt = bruteOptLen(c.s, c.maxW, c.size);
    /* 实际输出的前缀长度（去掉末尾的 …） */
    const cut = r.text.endsWith('…') ? r.text.length - 1 : r.text.length;
    ok(cut >= opt - 1,
      '最优性(无空格) ' + JSON.stringify(c.s.slice(0, 12)),
      '实际保留 ' + cut + ' 字符，理论最优 ' + opt + ' 字符（差 ' + (opt - cut) + '）');
  }

  /* 有空格的：断词代价有界 */
  const withSpace = [
    { s: 'Mixed 中英文 mixed content 混合内容测试用例', maxW: 160, size: 12 },
    { s: 'welcome to bubble tycoon world', maxW: 120, size: 12 },
  ];
  for (const c of withSpace) {
    const r = drawText(c.s, c.maxW, c.size);
    const opt = bruteOptLen(c.s, c.maxW, c.size);
    const cut = r.text.endsWith('…') ? r.text.length - 1 : r.text.length;
    /* 断词只会砍掉「尾部那一个单词」，代价 ≤ 该单词长度 + 1 */
    const lastSp = c.s.lastIndexOf(' ', opt);
    const tail = c.s.slice(lastSp + 1, opt);   /* 被牺牲的尾词 */
    const loss = opt - cut;
    ok(loss <= tail.length + 1,
      '断词代价有界 ' + JSON.stringify(c.s.slice(0, 12)),
      '保留 ' + cut + '/' + opt + ' 字符，牺牲 ' + loss + '，尾词="' + tail + '"');
  }
}

/* ============================================================
 *  ③ 英文断词：切点必须在空格边界
 * ============================================================ */
console.log('\n--- ③ 英文应在空格处断词，不劈开单词 ---');
{
  const s = 'welcome to bubble tycoon world';
  const r = drawText(s, 120, 12);
  ok(r.text.endsWith('…'), '英文截断应带省略号', '实际=' + JSON.stringify(r.text));
  const body = r.text.slice(0, -1);
  ok(body.length === 0 || body.endsWith(' ') || s[body.length] === ' ',
    '英文切点应落在空格边界',
    '实际=' + JSON.stringify(r.text) + '，切点后字符=' + JSON.stringify(s[body.length]));
  /* ★ 「不劈开单词」的精确判据：
   *   输出正文的**最后一个单词**，在原文里必须是一个完整单词
   *   （即它的后面在原文中紧跟空格或已到文末）。
   *   ★ 不能用「末尾是字母 + …」来判 —— "welcome to…" 结尾是字母，
   *     但 "to" 是完整单词，那是**正确**的断词结果。 */
  const lastWord = (body.match(/[^\s]+$/) || [''])[0];
  const idx = s.indexOf(lastWord);
  const after = idx >= 0 ? s[idx + lastWord.length] : '?';
  ok(lastWord !== '' && (after === ' ' || idx + lastWord.length >= s.length),
    '不应出现「半个单词+…」',
    '输出=' + JSON.stringify(r.text) + '，末词="' + lastWord + '"，其后字符=' + JSON.stringify(after));
  /* ★ 被丢掉的部分不应残留半个词在画面上（宽度已断言，这里只查语义） */
  ok(r.text.indexOf('…') === r.text.length - 1, '省略号应在末尾且只有一个',
    '实际=' + JSON.stringify(r.text));
}

/* ============================================================
 *  ④ 中文逐字断开
 * ============================================================ */
console.log('\n--- ④ 中文应按字符断开且不丢字 ---');
{
  const s = '一二三四五六七八九十一二三四五六七八九十';
  const r = drawText(s, 100, 12);
  ok(r.text.endsWith('…'), '中文截断应带省略号', '实际=' + JSON.stringify(r.text));
  const body = r.text.slice(0, -1);
  ok(s.indexOf(body) === 0, '中文截断应是原文的前缀（不能丢字/换字）',
    '实际=' + JSON.stringify(r.text));
  /* 纯中文不应出现「空格边界」逻辑的副作用 */
  ok(!/\s/.test(body), '纯中文截断不应引入空格', '实际=' + JSON.stringify(r.text));
}

/* ============================================================
 *  ⑤ 极端边界
 * ============================================================ */
console.log('\n--- ⑤ 极端边界不崩、不溢出 ---');
{
  /* maxW = 0 / 负数 / 极小 */
  for (const mw of [0, -10, 0.5, 1]) {
    let threw = null, r = null;
    try { r = drawText('测试文本', mw, 12); } catch (e) { threw = e; }
    ok(!threw, 'maxW=' + mw + ' 不应抛异常', threw ? threw.message : '');
    if (r) {
      ok(typeof r.text === 'string' && r.text.length >= 0,
        'maxW=' + mw + ' 应返回字符串', '实际=' + JSON.stringify(r.text));
      /* ★ 宽度可能超过 maxW（连「…」都放不下时）——
         这是物理上无解的，允许，但必须**有界**：不能画出整段原文 */
      ok(r.text.length <= 2, 'maxW=' + mw + ' 时应几乎不绘制内容',
        '实际绘制 ' + JSON.stringify(r.text) + '（' + r.text.length + ' 字符）');
    }
  }

  /* 空串 */
  {
    const r = drawText('', 100, 12);
    ok(r.text === '', '空串应绘制空字符串', '实际=' + JSON.stringify(r.text));
  }
  /* null / undefined */
  {
    let threw = null, r = null;
    try { r = drawText(null, 100, 12); } catch (e) { threw = e; }
    ok(!threw && r && r.text === '', 'null 应安全降级为空串',
      threw ? threw.message : '实际=' + JSON.stringify(r && r.text));
  }
  /* 单字符 */
  {
    const r = drawText('A', 100, 12);
    ok(r.text === 'A', '不超长时不应被截断', '实际=' + JSON.stringify(r.text));
  }
  /* 单字符但极窄 → 只剩 … */
  {
    const r = drawText('A', 1, 12);
    ok(r.text === '…' || r.text === '', '极窄时单字符应退化为省略号',
      '实际=' + JSON.stringify(r.text));
  }
  /* maxW 缺失 → 完全不截断 */
  {
    const long = 'x'.repeat(200);
    const r = drawText(long, null, 12);
    ok(r.text === long, '未给 maxW 时不应截断', '长度=' + r.text.length);
  }
}

/* ============================================================
 *  ⑥ 无 maxW 时不发生多余测量（性能守卫）
 * ============================================================ */
console.log('\n--- ⑥ 性能：截断不应退化为 O(n²) 测量 ---');
{
  /* ★ V20.7 之前的实现是「从尾部逐字符删 + 每次重新 measureText」，
   *   而 textW 的缓存 key 含完整字符串 ——
   *   一次截断会往缓存里塞进 O(n) 条不同 key。
   * ★ 现在二分只产生 O(log n) 条。断言「测量次数有上界」。
   */
  let count = 0;
  const fakeCtx = new Proxy({}, {
    get(t, p) {
      if (p === 'measureText') return (s) => { count++; return { width: textWidth(String(s), 12) }; };
      if (p === 'fillText') return () => { };
      if (p === 'font') return undefined;
      return () => { };
    },
    set(t, p, v) { t[p] = v; return true; },
  });
  const s = 'a'.repeat(400);
  vm.runInContext(`GFX.text(ctx, ${JSON.stringify(s)}, 0, 0, { size: 12, maxW: 100 })`,
    Object.assign(ctxObj, { ctx: fakeCtx }));
  /* 400 字符的最优解是 15 个字符 → 二分约 9 次测量 + 预留调整；
     逐字符删则是几百次。阈值取 60 足以区分「O(log n)」与「O(n)」。 */
  ok(count < 60, '400 字符截断的测量次数应远小于 n（O(log n)）',
    '实际 measureText 调用 ' + count + ' 次');
}

/* ============================================================
 *  结果
 * ============================================================ */
console.log('\n=== 结果 ===');
if (fail === 0) {
  console.log('✔ 全部通过（' + pass + ' 项）');
  process.exit(0);
} else {
  console.log('✘ 失败 ' + fail + ' 项 / 通过 ' + pass + ' 项');
  failures.forEach(f => console.log('  · ' + f));
  process.exit(1);
}
