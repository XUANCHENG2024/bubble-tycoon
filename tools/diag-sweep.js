/* 工坊参数扫描 —— 找一组让「开线」在30 天局内真正划算的数值。
 *
 * ★ 为什么要扫参数而不是手工猜：
 *   AI 的开线判据是「净收益 > 造价」的理性算账，和真实玩家一致。
 *   权重是**相对量**（不抬客流总量），所以收益上限有天然天花板 ——
 *   早先实测「产线 1.0 条」说明 AI 一次都没开线，重量级收益根本没被激活，
 *   而唯一生效的研发折扣把 AI 的钱从设备/分店挪到了前期研发（30 天局内是负收益）。
 *   这类"够不够量"的问题只能靠扫描回答，靠直觉容易来回折腾。
 *
 * 每档都是**全新 vm context + 固定种子 LCG**，
 * 基线 = V9 全关（收益归零 + AI 不开线），对照 = 只改 saleBonus/cost。
 * 只动被扫描的那一个维度，其余全部保持一致。
 *
 * 用法：node tools/diag-sweep.js [局数]
 *   env SWEEP_SALE   扫描 saleBonus 三档，如 "0.08,0.20,0.34;0.14,0.28,0.44"
 *   env SWEEP_COST   扫描 cost 三档，如 "0,260,900;0,200,700"
 *   env DIFF         难度，默认 normal
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const DIFF = process.env.DIFF || 'normal';
const N = Number(process.argv[2] || 20);

const dataSrc = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
const engSrc = fs.readFileSync(path.join(root, 'js/engine.js'), 'utf8');
const aiSrc = fs.readFileSync(path.join(root, 'tools/ai-shared.js'), 'utf8');

/* 「V9 全关」= 收益全部归零 + AI 完全不开线（AI_NO_WS），造价保持不变。
   造价不能设 0：那样 AI 会"免费"开 5 条线，基线就不是"没有这个系统"的状态。
   ★ 关闭清单走**共享模块** tools/v9-off.js —— 与 diag-invest.js 同源。
     两处各写一份时必然漂移，实测让同一份代码在本工具与diag-invest 里
     分别报出「产线 2.46 / +1.5pp」与「产线 1.2 / −7pp」，差 13pp。 */
const OFF = vm.runInContext('v9OffPatch(true)', bootstrap());

let rngState = 1;
const rnd = () => { rngState = (rngState * 1664525 + 1013904223) >>> 0; return rngState / 4294967296; };

/** v9OffPatch 只是拼字符串、不需要引擎，用最小引导上下文即可 */
function bootstrap() {
  const c = { console, JSON, Date, Object, Array, String, Number, Boolean, Error, Set, Map, isNaN, parseInt, parseFloat };
  c.globalThis = c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root, 'tools/v9-off.js'), 'utf8'), c);
  return c;
}

/** 跑一档：mut 为 null 表示基线 */
function run(mut) {
  const ctx = {
    console, JSON, Date, Object, Array, String, Number, Boolean, Error, Set, Map,
    isNaN, parseInt, parseFloat,
    Math: Object.assign(Object.create(Math), { random: rnd }),
    localStorage: { getItem: () => null, setItem: () => { }, removeItem: () => { } },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  let src = dataSrc + '\n' + engSrc;
  if (mut) src += '\n' + mut;
  vm.runInContext(src + '\n' + aiSrc + '\n'
    + fs.readFileSync(path.join(root, 'tools/v9-off.js'), 'utf8'), ctx, { filename: 'bundle.js' });
  const E = ctx;
  Object.assign(E, vm.runInContext('({CFG,DIFFICULTY,RECIPES,CRAFT_WORKSHOPS,ING})', ctx));
  const play = vm.runInContext('playSharedAI', ctx);

  /* ★ 基线自检（共享模块）：与 diag-invest.js 用**同一个**检查函数，
     所以"两个工具结论矛盾"这件事不可能再悄悄发生。
     sweep 的基线是 OFF（收益归零）；扫描档只该比它多出**被扫的那一层**。 */
  {
    const leak = vm.runInContext('v9OffLeakCheck()', ctx);
    if (leak.length && !mut) {
      console.error('❌ 基线不干净 → ' + leak.join(', '));
      process.exit(1);
    }
  }

  let sum = 0, wsN = 0, rec = 0, bust = 0, shop = 0, up = 0;
  for (let k = 0; k < N; k++) {
    rngState = 1000 + k * 7919;          /* 每局重置：各档走同一序列 */
    const r = play(E, DIFF, 0, null, { rng: rnd, clickRate: 2.5 });
    sum += E.netWorth(r.s);
    rec += r.s.recipes.length;
    if (r.s.debtDays >= 2) bust++;
    let wn = 0;
    for (const kk in r.s.workshops) if (r.s.workshops[kk] > 0) wn++;
    wsN += wn;
    shop += (r.s.shops || 1);
    up += (r.s.up.speed || 0) + (r.s.up.menu || 0) + (r.s.up.training || 0)
      + (r.s.up.decor || 0) + (r.s.up.storage || 0);
  }
  return {
    avg: Math.round(sum / N), ws: wsN / N, rec: rec / N,
    bust, shop: shop / N, up: up / N,
  };
}

/* 相对量（权重加成）永远不抬客流总量，所以收益封顶；
   要让玩家/AI 愿意开线，需要**降本**这类绝对量收益。 */
/* 扫 costCut（降本，主力层）。
   ★ 传入 'KEEP' 表示「这个维度不扫，保持原表」——
     若连未扫描的维度一起覆盖，就会连工坊等级数一起改掉
     （cost 长度 4→3），测出来的不是当前设计的性质（实测差 13pp）。 */
const KEEP = 'KEEP';
const cutSets = (process.env.SWEEP_CUT
  || '0,0.08,0.14;0,0.11,0.19;0,0.14,0.24;0,0.17,0.30;0,0.20,0.36')
  .split(';');
const saleSets = (process.env.SWEEP_SALE || KEEP).split(';');
const costSets = (process.env.SWEEP_COST || KEEP).split(';');
const DEFAULT_SALE = saleSets[0];
const DEFAULT_COST = costSets[0];

const base = run(OFF);

/* 目标值直接从引擎里取，避免脚本里再抄一份难度表（抄两份必然漂移） */
function goalOf(diff) {
  const c = { console, JSON, Date, Object, Array, String, Number, Boolean, Error, Set, Map, isNaN, parseInt, parseFloat };
  c.globalThis = c; vm.createContext(c);
  vm.runInContext(dataSrc + '\n' + engSrc, c);
  return vm.runInContext('DIFFICULTY.' + diff + '.goal', c);
}
const GOAL = goalOf(DIFF);

console.log('难度 ' + DIFF + ' · 每档 ' + N + ' 局（固定种子配对，目标净资产 ¥' + GOAL + '）\n');
console.log('基线 V9全关 | 净资产 ¥' + String(base.avg).padStart(6)
  + ' (' + (base.avg / GOAL * 100).toFixed(0) + '%)'
  + ' | 产线 ' + base.ws.toFixed(2) + ' 条'
  + ' | 解锁 ' + base.rec.toFixed(1) + ' 款'
  + ' | 设备 ' + base.up.toFixed(1) + ' 级'
  + ' | 分店 ' + base.shop.toFixed(2)
  + ' | 破产 ' + base.bust + '/' + N);

const rows = [];
for (const costSet of costSets) {
  const costArr = costSet === KEEP ? null : costSet.split(',').map(Number);
  for (const cutSet of cutSets) {
    const cutArr = cutSet.split(',').map(Number);
    for (const saleSet of saleSets) {
      const saleArr = saleSet === KEEP ? null : saleSet.split(',').map(Number);
      /* ★ mutator 必须只改**被扫的那一个维度**，其余原样保留 ——
         实测踩过：早期版本同时覆盖 cost / saleBonus，
         把工坊从 4 级砍成 3 级（cost 长度 4→3），
         结果扫出来的「产线 2.46 / +1.5pp」对应的是一个**虚构的 3 级工坊**，
         与真实表（4 级）差了 13pp 结论。
         等级数变了，工坊造价阶梯、AI 的开线判据、"是否满级"全跟着变，
         测出来的不再是当前设计的性质。所以未传的维度一律不覆盖。 */
      const mut = 'CRAFT_WORKSHOPS.forEach(w=>{'
        + (costArr ? 'w.cost=[' + costArr.join(',') + '];' : '')
        + 'w.costCut=[' + cutArr.join(',') + '];'
        + (saleArr ? 'w.saleBonus=[' + saleArr.join(',') + '];' : '')
        + '});';
      const r = run(mut);
      const d = (r.avg - base.avg) / GOAL * 100;
      rows.push({ costArr, cutArr, saleArr, r, d });
      const flag = Math.abs(d) <= 3 ? '✅' : (d > 3 ? '  ' : '⚠️');
      console.log(flag + ' cut[' + cutArr.join(',') + ']'
        + ' | 净资产 ¥' + String(r.avg).padStart(6) + ' (' + (r.avg / GOAL * 100).toFixed(0) + '%)'
        + ' | 差 ' + (d >= 0 ? '+' : '') + d.toFixed(1) + 'pp'
        + ' | 产线 ' + r.ws.toFixed(2)
        + ' | 解锁 ' + r.rec.toFixed(1)
        + ' | 分店 ' + r.shop.toFixed(2)
        + ' | 破产 ' + r.bust + '/' + N);
    }
  }
}

/* 收口建议：净效应落在 ±3pp 内、且产线数 > 1（说明 AI 真愿意开线）的档位里，
   取"产线最多、解锁数没明显下降"的那一档 ——
   玩家用得上比数字好看更重要；开太多线会把研发预算挤掉（解锁数下滑）。 */
const ok = rows.filter(x => Math.abs(x.d) <= 3 && x.r.ws > 1);
if (ok.length) {
  ok.sort((a, b) => (b.r.ws - a.r.ws) || (b.d - a.d));
  const b = ok[0];
  console.log('\n▶ 建议：costCut [' + b.cutArr.join(',') + ']'
    + '  → 产线 ' + b.r.ws.toFixed(2) + ' 条 / 净效应 ' + (b.d >= 0 ? '+' : '') + b.d.toFixed(1)
    + 'pp / 解锁 ' + b.r.rec.toFixed(1) + ' 款');
} else {
  console.log('\n▶ 无合格档位（需产线 > 1 且 |净效应| ≤ 3pp）');
}