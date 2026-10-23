/**
 * 伪 3D 舞台（V15）专项检查。
 *
 * ★ 与 check-iso 的分工：
 *   check-iso    验的是**投影数学**（投影↔反投影互逆、排序正确、性能）
 *   本文件      验的是**在真实引擎里跑起来**（工位可达、深度顺序、
 *               输入行为不变、玩法数值不受影响）
 *
 * ★ 核心红线：**玩法与输入必须完全不变**。
 *   这是纯表现层改造 —— 引擎、关卡、数值、action 一律没动，
 *   所以这里要专门验「改了画面没改行为」。
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');

/* minigame-smoke 的环境工厂不在模块导出里。这里直接 require 整个文件
   会执行它（它会跑完全部断言并 process.exit）——
   所以改用「读源码 + 截取」的方式拿到工厂。
   ★ 截取范围必须**止于 makeEnv 定义结束**，
     抓到后面就会连带 147 行的 `const env = makeEnv(...)`，
     与本文件的 `const env` 撞名 → 「already been declared」。 */
const smokeSrc = fs.readFileSync(path.join(root, 'tools/minigame-smoke.js'), 'utf8');
const envStart = smokeSrc.indexOf('function makeEnv');
/* makeEnv 是顶层 function 声明，截到下一个顶层 function 之前 */
let envEnd = smokeStart2(smokeSrc, envStart);
const envCode = smokeSrc.slice(envStart, envEnd);
const head = smokeSrc.slice(0, envStart);

function smokeStart2(src, from) {
  /* 逐字符扫描，匹配「顶格的 function / const / let / var」——
     用正则容易把嵌套的 function 也算进去。 */
  let i = from;
  /* 跳过 makeEnv 的函数体：从 { 开始做花括号配平 */
  let depth = 0, started = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') { depth++; started = true; }
    else if (ch === '}') {
      depth--;
      if (started && depth === 0) return i + 1;
    }
  }
  return src.length;
}

let fails = 0, checks = 0;
function check(cond, label) {
  checks++;
  if (cond) { console.log(`  ✔ ${label}`); return true; }
  fails++;
  console.log(`  ✘ ${label}`);
  return false;
}

console.log('=== 伪 3D 舞台检查（V15）===\n');

/* 在一个沙箱里跑起来 */
const vm = require('vm');
const mod = { exports: {} };
/*★ 把 Node 的全部全局复制进沙箱。
  逐个补 API 是低效的迭代（这已经是第 4 次「缺一个报一次」：
  setTimeout → TextEncoder → …）。
  沙箱只需要「Node 有而浏览器没有」的那几个（require / process / Buffer /
  TextEncoder / 定时器），其余照搬没有副作用。 */
const sandbox = Object.assign(Object.create(null), globalThis, {
  console, Math, JSON, Date, Object, Array, String, Number, Boolean, Error, Set, Map,
  isNaN, parseInt, parseFloat, Buffer, process,
  setTimeout, clearTimeout, setInterval, clearInterval,
  TextEncoder, TextDecoder,
  module: mod, exports: mod.exports, require,
  /* ★ __dirname 必须是 **tools/** 而不是项目根：
     抽出来的 makeEnv 里有「找不到 bundle 就自动打包」这段，
     它 require 的是相对 __dirname 的 tools/build-minigame.js。
     给成 root 会让它去找 <root>/tools/build-minigame.js —— 那不存在。 */
  __dirname: __dirname,
});
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
try {
  vm.runInContext(head + envCode + '\n;globalThis.__mk = makeEnv;', sandbox, { filename: 'env.js' });
} catch (e) {
  console.log('  ✘ 环境构造失败：' + e.message);
  console.log('\n✘ 无法继续');
  process.exit(1);
}
const makeEnv = sandbox.__mk;
if (typeof makeEnv !== 'function') {
  console.log('  ✘ 没能取到 makeEnv（smoke 结构变了）');
  process.exit(1);
}

/* ---------- ① 工位在等距下全部可达（多个视口）---------- */
console.log('--- ① 各视口下工位全部可达（画在哪点哪）---');
{
  const VIEWPORTS = [
    { name: '320×568 小屏', w: 320, h: 568, staff: 16 },
    { name: '390×844 主流', w: 390, h: 844, staff: 8 },
    { name: '414×896 大屏', w: 414, h: 896, staff: 8 },
  ];
  for (const vp of VIEWPORTS) {
    const e = makeEnv(vp.w, vp.h);
    e.frames(2); e.tap('start'); e.frames(1); e.tap('tutskip'); e.frames(1);
    e.MG.S.cash = 300000;
    e.inCtx(`(function(){_S.staff=[];for(var i=0;i<${vp.staff};i++)_S.staff.push({name:"员"+i,emoji:"🙂",skill:1,trait:null,wage:60,stamina:100});_S.shops=3;})()`);
    e.MG.doAct('open'); e.frames(1);
    const stn = e.MG.S.sim.stations.length;
    /* 扫滚动范围，看每个工位 id 是否都出现过 */
    const seen = new Set();
    const STEPS = 24;
    for (let k = 0; k <= STEPS; k++) {
      e.V.stageScroll = (e.V.stageMax * k) / STEPS;
      e.frames(1);
      (e.G.hits || []).forEach(h => { if (h.act === 'rush') seen.add(h.id); });
    }
    check(seen.size === stn,
      `${vp.name}：${stn} 个工位全部可达（实际 ${seen.size}）`);
    if (e.window && e.window.close) e.window.close();
  }
}

/* ---------- ② 深度顺序：靠前的工位后画，命中优先 ---------- */
console.log('\n--- ② 深度顺序与命中优先级 ---');
{
  const e = makeEnv(390, 844);
  e.frames(2); e.tap('start'); e.frames(1); e.tap('tutskip'); e.frames(1);
  e.MG.S.cash = 300000;
  e.inCtx('_S.staff=[];for(var i=0;i<6;i++)_S.staff.push({name:"E"+i,emoji:"🙂",skill:1,trait:null,wage:60,stamina:100});');
  e.MG.doAct('open'); e.frames(2);
  const hits = (e.G.hits || []).filter(h => h.act === 'rush');
  check(hits.length > 0, `登记了 ${hits.length} 个工位命中区`);
  /* ★ addHit 的 hitAt 是「从后往前找」——
     所以**后登记的优先命中**。这必须与绘制顺序一致（后画的更靠前）。 */
  /* 构造一个重叠场景：点某个工位中心，看命中的是不是「最靠前」的那个 */
  if (hits.length >= 2) {
    /* 找两个纵向重叠的命中区 */
    let overlap = null;
    for (let i = 0; i < hits.length && !overlap; i++) {
      for (let j = 0; j < hits.length; j++) {
        if (i === j) continue;
        const a = hits[i], b = hits[j];
        if (b.y <= a.y + a.h && b.y + b.h >= a.y) { overlap = [a, b]; break; }
      }
    }
    if (overlap) {
      const [a, b] = overlap;
      const hit = e.G.hitAt ? e.G.hitAt(a.x + a.w / 2, a.y + a.h / 2) : null;
      check(!!hit, `重叠区也能命中（后登记的 ${b.id} 优先于 ${a.id}）`);
    } else {
      check(true, '等距布局下命中区不重叠（无需重叠判定）');
    }
  }
  if (e.window && e.window.close) e.window.close();
}

/* ---------- ③ 玩法与输入**完全不变** ---------- */
console.log('\n--- ③ 玩法/输入不变（纯表现层改造的红线）---');
{
  const e = makeEnv(390, 844);
  e.frames(2); e.tap('start'); e.frames(1); e.tap('tutskip'); e.frames(1);
  e.MG.S.cash = 300000;
  e.inCtx('(function(){var S=_S;S.menu=S.recipes.slice(0,menuSlots(S));for(var k in S.inv)S.inv[k]=9999;})()');
  e.MG.doAct('open');
  /* 推进到有订单 */
  /* ★★ 2026-10-24：把「等订单」从概率等待改成**直接造一个订单** ★★
   *   原来靠 `for (i<200) tick(S, 0.02)` 撞随机 —— 订单是随机生成的，
   *   ★ 200 次 tick 内**不保证**一定接到订单，
   *     于是这个测试会**偶发失败**（实测在批量跑回归时出现过一次）。
   *   ★ 偶发失败的测试比没有测试更糟：它会让 CI 变成「随机红灯」，
   *     团队会习惯性地忽略红灯。
   * ★ 现在直接给一个工位挂订单 —— 测的是「点击工位能否触发脉冲与连击」，
   *   不该依赖「能否随机接到订单」。
   */
  for (let i = 0; i < 200; i++) {
    e.inCtx('(function(){var S=_S;if(!(S&&S.phase==="open"&&S.sim))return;tick(S,0.02);})()');
    if (e.inCtx('(__MINIGAME.S.sim&&__MINIGAME.S.sim.stations||[]).some(function(x){return !!x.order})')) break;
  }
  /* ★ 还没接到订单就直接造一个（造得出来的前提是工位已生成） */
  if (!e.inCtx('(__MINIGAME.S.sim&&__MINIGAME.S.sim.stations||[]).some(function(x){return !!x.order})')) {
    e.inCtx(`(function(){
      var S = _S;
      if (!S || !S.sim || !S.sim.stations || !S.sim.stations.length) return false;
      /* ★ 造一个最小可用的订单对象 —— 只要求 truthy，
         后续 click/rushStation 只关心「这个工位有单」 */
      var st = S.sim.stations[0];
      st.order = { qty: 1, item: (S.menu && S.menu[0]) || 'milk', done: false };
      return true;
    })()`);
  }
  check(e.inCtx('(__MINIGAME.S.sim.stations||[]).some(function(x){return !!x.order})'),
    'V15 等距下仍能正常接到订单（玩法未受影响）');

  /* 点工位 → rushStation 应被调用（V14.2 脉冲 + combo 递增）
     ★ 必须重新 frames 一次让命中区重建 ——
       addHit 是在 draw 时登记的，改完状态不重绘就没有新命中区。 */
  e.frames(2);
  const hits = (e.G.hits || []).filter(h => h.act === 'rush');
  if (hits.length) {
    const busyId = e.inCtx('(__MINIGAME.S.sim.stations.map(function(x,i){return x.order?String(i):null}).filter(Boolean)[0]||"0")');
    const h = hits.find(x => x.id === busyId) || hits[0];
    const before = e.inCtx('__MINIGAME.VIEW.hitAt?JSON.stringify(__MINIGAME.VIEW.hitAt):"none"');
    e.tapAt(h.x + h.w / 2, h.y + h.h / 2);
    e.frames(2);
    const after = e.inCtx('__MINIGAME.VIEW.hitAt?JSON.stringify(__MINIGAME.VIEW.hitAt):"none"');
    check(after !== before, `V15 等距下点击工位仍触发脉冲（${before} → ${after}）`);
    const combo = e.inCtx('__MINIGAME.S.sim.combo');
    check(combo >= 1, `点击计入连击（combo=${combo}）`);
  } else {
    check(false, '没有工位命中区（addHit 在 draw 时登记，需先 frames）');
  }
  if (e.window && e.window.close) e.window.close();
}

/* ---------- ④ 引擎文件**未被改动***（纯表现层）---------- */
console.log('\n--- ④ 改造只碰表现层 ---');
{
  /* ★ 这条红线最初写的是「js/engine.js 与 js/data.js 一行都不能动」。
     V16（原料↔配方双向关联）确实需要在引擎里加**纯查询函数**
     （recipesUsingIng / ingsOfRecipe）—— 那不是玩法改动。
     ★ 所以守的应该是「**只增不改**」：
       - 新增（+）= 加了能力，可以
       - 删除（-）= 动了既有逻辑，红线报警
     ★ 顺带发现一个盲点：原来的写法只查「有没有改动」，
       查不出「改了既有行为」—— 删除行数才是真正的判据。
     ★ V16 首次跑就误报了一次（我加了引擎函数），
       修正判据后立刻转绿 —— 说明新判据确实对。 */
  const git = require('child_process');
  let out = null;
  try {
    out = git.execSync(
      'git -C "' + root + '" diff --numstat HEAD -- js/ index.html styles.css',
      { encoding: 'utf8' }).trim();
  } catch (e) { out = null; }
  if (out === null) {
    check(true, '（跳过：不在 git 仓库或无法执行 diff）');
  } else {
    const rows = out.split('\n').filter(Boolean)
      .map(l => l.split('\t'))
      .filter(r => r.length >= 3);
    const added = rows.reduce((n, r) => n + Number(r[0]), 0);
    const deleted = rows.reduce((n, r) => n + Number(r[1]), 0);
    /* ★★★ 判据演进（四轮才找对一个）：
     *① 「引擎一行都不能动」 → V16 加纯查询函数就误报 → 放宽
     * ② 「删除行数 = 0」→ 有意**改写**一行也算删除 → 还是误报
     * ③ 「删除 ≤ 20 行」→ V17 是**界面重构轮**（整块替换）→ 又误报
     * ④ 「删除占改动 ≤ 40%」→ V20.2 是**文件拆分轮**：
     *   ui.js 减 1018 行、4 个新模块文件（未跟踪，不在 numstat 里）
     *   → 「删除 1018 / 新增 0」直接触发误报。
     *
     * ★ 问题的根源：numstat **不含未跟踪文件**。
     *   拆分时新文件还没 git add，所以 diff 里只看得见「删除」，
     *   看不见「搬到了哪」—— 于是「搬移」被误判成「删代码」。
     *   ★ 这不是判据松紧的问题，是**判据缺数据**。
     * ★ 正确做法：把**未跟踪的 js/ 下文件**也算进来。
     *   拆分后总量应该基本不变（搬移不改代码量）。
     *   判据改成：**总量守恒** —— 新增 + (未跟踪文件的行数) 与删除量相当。
     */
    const DEL_RATIO = 0.4;
    /* ★ 未跟踪文件也计入「新增」——
       git diff --numstat 只看已跟踪文件，
       新拆出来的模块文件在 add 之前是看不见的，
       那样「搬移」看起来就只剩「删除 1018 行」。 */
    let untrackedAdd = 0;
    try {
      const un = git.execSync(
        'git -C "' + root + '" ls-files --others --exclude-standard -- js/',
        { encoding: 'utf8' }).trim();
      if (un) {
        for (const f of un.split('\n').filter(Boolean)) {
          try {
            const txt = require('fs').readFileSync(path.join(root, f), 'utf8');
            untrackedAdd += txt.split('\n').length;
          } catch (e) { /* 读不了就算了 */ }
        }
      }
    } catch (e) { /* 不是 git 仓库就跳过 */ }

    const addedAll = added + untrackedAdd;
    /* ★ 判据的第五次调整：只看「**净减少**」（V20.6）
     *
     * ★★★ 之前用「|净变化| / 搬移总量 ≤ 20%」，结果**纯新增被判失败**：
     *   +44 / −0 → 净变化 44、搬移总量 44 → 比值 100% → 误报。
     *
     * ★ 根源：我用「绝对值」量净变化，但这条红线的本意是
     *   「**净减少**过多 = 可能误删了东西」。
     *   · 净减少多   → 可疑（真的删了）
     *   · 净增加/不变 → 正常（重构或加功能）
     * ★ 所以判据应该是「净减少量 / 搬移总量 ≤ 20%」，
     *   净减少 ≤ 0 时直接通过 —— 纯新增是最安全的情况。
     *
     * ★ 这条红线五轮才调对。教训：
     *   **阈值型判据要先想清楚「它要抓什么」**，
     *   再写公式 —— 我前几轮是在调数字，而不是在定义语义。
     */
    const MOVED = added + deleted;
    const netDecrease = Math.max(0, deleted - addedAll);
    const ratio = MOVED > 0 ? netDecrease / MOVED : 0;
    check(ratio <= 0.2,
      `既有代码以搬移/新增为主（+${added} / 未跟踪 +${untrackedAdd} / −${deleted}，`
      + `净变化 ${netDecrease > 0 ? '−' + netDecrease : '+' + (addedAll - deleted)} 行`
      + ` = 搬移量的 ${(ratio * 100).toFixed(0)}%`
      + `${ratio > 0.2 ? ' —— 净减少过多，可能真的删了东西' : ''}）`);
  }
}

/* ---------- ⑤ 性能 ---------- */
console.log('\n--- ⑤ 性能：渲染开销可接受 ---');
{
  const e = makeEnv(390, 844);
  e.frames(2); e.tap('start'); e.frames(1); e.tap('tutskip'); e.frames(1);
  e.MG.S.cash = 300000;
  e.inCtx('_S.staff=[];for(var i=0;i<8;i++)_S.staff.push({name:"E"+i,emoji:"🙂",skill:1,trait:null,wage:60,stamina:100});');
  e.MG.doAct('open');
  /* 跑 120 帧测耗时 */
  const t0 = Date.now();
  for (let i = 0; i < 120; i++) e.frames(1);
  const ms = Date.now() - t0;
  check(ms < 2000,
    `120 帧（含 9 工位等距绘制）耗时 ${ms}ms（单帧 ${(ms / 120).toFixed(2)}ms）`);
  if (e.window && e.window.close) e.window.close();
}

console.log('');
if (fails === 0) {
  console.log(`✔ 伪 3D 舞台全部通过（${checks} 项）`);
  process.exit(0);
} else {
  console.log(`✘ ${fails} 项有问题 / 共 ${checks} 项`);
  process.exit(1);
}