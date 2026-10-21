/* ============================================================
 *  平衡诊断：逐个关掉新系统，量化各自对达标率的贡献。
 *
 *  用法：node tools/diag-balance.js [局数]   （默认 12，建议 ≥30）
 *
 *  为什么要有这个工具：sim 的脚本 AI 对**现金余额**是离散响应的 ——
 *  它的营销/投资判断写死在 `cash > 2500` / `cash > cost*1.6` 这类阈值上，
 *  多给几百块钱就可能让整条经营路径分叉，收益被放大好几倍。
 *  所以"新增系统让达标率涨了 8pp"这句话**不能**直接采信 ——
 *  要先用本工具区分：这是"多了一笔收入"本身的影响，
 *  还是 AI 的阈值响应造成的假象。
 *
 *  做法是**配对比较**：所有对照组共用同一套伪随机序列（LCG + 固定种子），
 *  再加一组"每日固定补贴"的对照 —— 后者与被测系统完全无关，
 *  它的漂移幅度就是这台测速器的**噪声底**。
 *
 *  只读，不改任何游戏文件。
 * ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');

function run(mutator, runs) {
  const store = {};
  /* 配对比较的关键：所有对照组必须用**完全相同**的随机序列。
     原来的 Math.random() 每次都不一样，12 局采样的噪声就有 ±6pp，
     根本分不清「关卡奖励带来 +6pp」和「随机波动带来 +6pp」。
     这里换成可复现的 LCG，并用 runIndex 作种子 —— 对照组之间只差被测系统本身。 */
  let rngState = 12345;
  const rnd = () => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
  };
  const ctx = {
    console, JSON, Date, Object, Array, String, Number, isNaN, parseInt, parseFloat,
    /* Math.random 换成可复现的 LCG（配对比较的前提） */
    Math: Object.assign(Object.create(Math), { random: rnd }),
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  let src = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8') + '\n'
    + fs.readFileSync(path.join(root, 'js/engine.js'), 'utf8')
    + '\n;globalThis.__D = { CFG, DIFFICULTY, STAGE_DIFFS, SPECIAL_CUSTOMERS, RECIPES, ING, CUISINES, CRAFT_WORKSHOPS, CUISINE_FOCUS };';
  /* 共享的脚本 AI —— 与 tools/sim.js **同一份**。
     之前这里写的是自己的副本，结果与 sim.js 漂移了（一边是"只看现金开线"、
     一边是"为想研发的新品开线"），配对实测因此测的是「对着旧 AI 的新系统」，
     得出的 −16pp 完全是假的。两处 AI 重复实现 = 必然漂移 = 结论不可信。
     加载顺序：引擎 → ai-shared（含 AI_NO_WS 开关）→ mutator。 */
  const sharedSrc = fs.readFileSync(path.join(root, 'tools/ai-shared.js'), 'utf8');
  if (mutator) src += '\n' + mutator;
  vm.runInContext(src + '\n' + sharedSrc, ctx, { filename: 'bundle.js' });
  const E = ctx;
  Object.assign(E, E.__D);
  const playSharedAI = vm.runInContext('playSharedAI', ctx);
  let curSeed = 0;

  /* 局索引 → 随机种子：每一局用不同的序列（否则 30 局其实是同一局重复 30 次），
     但**所有对照组用同一个索引就同一个种子** —— 这才是配对比较。 */
  let runIndex = 0;
  function playAI(diff) {
    rngState = 1000 + runIndex * 7919;
    runIndex++;
    /* 共享 AI 返回 { log, s, sig }；本工具原本用 days 变量，改用 log。 */
    const r = playSharedAI(E, diff, 0, null, { rng: rnd, clickRate: 2.5 });
    r.days = r.log;
    return r;
  }

  const out = {};
  for (const diff of ['easy', 'normal', 'hard']) {
    const worths = [], stageTotals = [];
    for (let k = 0; k < runs; k++) {
      curSeed = 1000 + k * 7919;
      rngState = curSeed;
      const { s, days } = playAI(diff);
      worths.push(Math.round(E.netWorth(s)));
      stageTotals.push(days.length ? days[days.length - 1].stageCash : 0);
    }
    const avg = Math.round(worths.reduce((a, b) => a + b, 0) / worths.length);
    out[diff] = { avg, pct: Math.round(avg / E.DIFFICULTY[diff].goal * 100), stageAvg: Math.round(stageTotals.reduce((a, b) => a + b, 0) / stageTotals.length) };
  }
  return out;
}

const RUNS = Number(process.argv[2] || 12);
/* 每日固定补贴：与关卡机制**完全无关**，只在 endDay 末尾无条件加钱。
   用来回答一个关键问题：新系统带来的达标率变化，究竟是
     ① 「多了一笔收入」本身的影响，还是
     ② sim 的脚本 AI 对现金余额的**离散阈值响应**
       （它的营销/投资判断写死在 `cash > 2500` / `cash > cost*1.6` 这类阈值上，
        多几百块钱就可能整条路径分叉，收益被放大好几倍）。
   若两者漂移幅度接近 → 说明 ② 是主因，新系统的收入设计本身是安全的。 */
const FIXED_SUB = `
  const _origEndDay = endDay;
  endDay = function (s) {
    const r = _origEndDay(s);
    if (r) s.cash += 14;
    return r;
  };
`;
/* V9 关掉工坊与菜系的对照：工坊造价是硬成本（¥1200 起），
   会挤压研发与经营 —— 它的影响必须单独量出来，不能混在别的新系统里。 */
/* 「V9 全关」= 收益归零 + 菜单主打加成 0 + **AI 完全不开线**（AI_NO_WS）。
   ⚠️ 两个曾经的错，都会让差值失真：
     ① 只把造价设 0 → AI 会「免费」开 5 条线，基线不是"没有这个系统"的状态；
     ② 让 AI 照常开线 → 那是"有系统但玩家用不好"，不是"没有系统"。
   正确做法：基线组让 AI 不开线（AI_NO_WS），造价保持不变
   （这样 AI 的决策逻辑在两组里完全一致，只差"系统给不给收益"）。 */
const WORKSHOP_OFF = 'STAGE_DIFFS.forEach(d=>{d.cashMul=0;}); SPECIAL_CUSTOMERS.length=0;';
/* ★ 每一组只动**一个**变量 —— 这是配对比较的前提。
     之前的 case 定义是第二批遗留的（"仅关卡奖励"/"仅特殊顾客"），
     我把 V9 塞进 "仅 V9 工坊与菜系" 那格时，顺手把 V7 特殊顾客也关了
     （`SPECIAL_CUSTOMERS.length=0`）—— 而基线组里 V7 是开着的。
     于是测的是「V7+V9 一起关」vs「全开」，差值混进了 V7 的贡献，
     得出的 −12pp 是假的。 */
/* ⚠️ 这个工具是给**第二批（V5-V8）**写的：它的基线是「第二批判定全关」，
   测的是关卡奖励 / 特殊顾客 / 章节关卡对达标率的影响。
   测 V9（菜系与工坊）请用 tools/diag-invest.js ——
   它的 case 定义是围绕 V9 的，把 V9 塞进这里的 case 会得到**语义错位**的结论
   （这正是之前反复测出 −12pp 假象的原因：case 名与实际变量对不上）。
   两边现在共用 tools/ai-shared.js 的同一份 AI，行为一致。 */
const CASES = [
  ['基线（第二批判定全关）', WORKSHOP_OFF],
  ['基线 + 每日固定 +14 元（噪声底）', WORKSHOP_OFF + FIXED_SUB],
  ['仅关卡奖励', 'SPECIAL_CUSTOMERS.length=0;'],
  ['仅特殊顾客', 'STAGE_DIFFS.forEach(d=>{d.cashMul=0;});'],
  ['全开（当前）', null],
];
for (const [name, mut] of CASES) {
  const r = run(mut, RUNS);
  console.log(`${name.padEnd(22)} easy ${String(r.easy.pct).padStart(4)}%  normal ${String(r.normal.pct).padStart(4)}%  hard ${String(r.hard.pct).padStart(4)}%   (关卡奖金 ${r.normal.stageAvg})`);
}
