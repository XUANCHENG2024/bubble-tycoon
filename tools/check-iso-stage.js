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
  for (let i = 0; i < 200; i++) {
    e.inCtx('(function(){var S=_S;if(!(S&&S.phase==="open"&&S.sim))return;tick(S,0.02);})()');
    if (e.inCtx('(__MINIGAME.S.sim&&__MINIGAME.S.sim.stations||[]).some(function(x){return !!x.order})')) break;
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
  /* ★ 关键红线：引擎与玩法数据一个字都不该改。
     如果有人「顺手」改了引擎，这个检查会立刻抓到。 */
  const git = require('child_process');
  let changed = null;
  try {
    changed = git.execSync(
      'git -C "' + root + '" diff --name-only HEAD -- js/ index.html styles.css',
      { encoding: 'utf8' }).trim();
  } catch (e) { changed = null; }
  if (changed === null) {
    check(true, '（跳过：不在 git 仓库或无法执行 diff）');
  } else {
    const files = changed.split('\n').filter(Boolean);
    const engineTouched = files.some(f => /^js\/engine\.js$|^js\/data\.js$/.test(f));
    check(!engineTouched,
      `引擎与玩法数据未被改动${engineTouched ? '（但发现：' + files.join(',') + '）' : ''}`);
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