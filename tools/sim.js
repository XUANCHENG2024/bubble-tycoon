/* 离线平衡测试：用脚本 AI 跑完整 30 天，输出每日报表 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const store = {};
const ctx = {
  console, Math, JSON, Date, Object, Array, String, Number, isNaN, parseInt, parseFloat,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
const src = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8') + '\n'
  + fs.readFileSync(path.join(root, 'js/engine.js'), 'utf8') + '\n'
  + ';globalThis.__D = { CFG, ING, RECIPES, UPGRADES, TRAITS, EVENTS, ACHIEVEMENTS, DIFFICULTY, TAGS, SHOP_COSTS, num, SIGNATURE_TIERS, CUISINES, CRAFT_WORKSHOPS, MANAGER_RANKS, MANAGER_TRAITS, MANAGER_RANKS, MANAGER_TRAITS, MANAGER_COSTS, BRANCH_STAFF_CAP, staffOfBranch, managerOfBranch, managerSlotsLeft, managerCost, refreshManagerCandidates, hireManager, managerBonus, branchStaffCap, activeBranchCount };';
vm.runInContext(src, ctx, { filename: 'bundle.js' });

const E = ctx;
Object.assign(E, E.__D);
/* 共享的脚本 AI（与 diag-balance.js 同一份，避免两处漂移）。
   注意它在 **vm context 的词法环境**里（不是 Node 模块作用域），
   所以要用 runInContext 求值一次，把函数挂到 ctx 上再调用。 */
vm.runInContext(fs.readFileSync(path.join(root, 'tools/ai-shared.js'), 'utf8'), ctx, { filename: 'ai-shared.js' });
const playSharedAI = vm.runInContext('playSharedAI', ctx);

/* 参数：node tools/sim.js [局数] [--bp=45] [--chain=N] [--cards=none|first|random] [-v]
 *   --bp=N     指定初始声望点（默认 0）。用来验证跨局成长会不会把难度带偏。
 *   --chain=N  连续多局：每局结束按 prestigeGain 累积声望，模拟真实玩家的连玩曲线
 *   --cards    策略卡口径对照。**改完任何一张卡都必须跑这三种口径**：
 *              none（不抽卡）/ first（永远拿第一张）/ random（随机拿一张）
 *              三者的达标率应当互相接近（±8pp 内）—— 差得多说明某张卡是纯增益或纯负收益。
 *   -v         打印最后一局的逐日流水 */
function argVal(name, dflt) {
  const p = process.argv.find(a => a.startsWith('--' + name + '='));
  return p ? p.split('=')[1] : dflt;
}

/* sig：V6 招牌配方的跨局基线（{ 配方 id: 累计杯数 }）。
   传 null = 不继承（每日挑战那种「全网同种子」的情况）。
   招牌是第二批唯一的跨局成长线 —— 连玩曲线必须把它算进去，
   否则测出来的「越玩越强 / 越玩越弱」是失真的。 */
function playAI(diff, seedLabel, bp, sig) {
  /* AI 逻辑在 tools/ai-shared.js（与 diag-balance.js 共用同一份）——
     两处各写一份必然漂移，平衡结论会失真。 */
  return playSharedAI(E, diff, bp, sig, { rng: Math.random, clickRate: 2.5, cards: CARDS });
}

const RUNS = Number(process.argv[2] || 3);
const verbose = process.argv.includes('-v');
const chain = Number(argVal('chain', 0));
const BP = Number(argVal('bp', 0));
const CARDS = (argVal('cards', 'none') || 'none').toLowerCase();
/* --nosig：连玩曲线里关掉 V6 招牌配方的跨局继承，做 A/B 对照。
   招牌是唯一的跨局成长线，必须能单独测出它对留存曲线的影响。 */
const NOSIG = process.argv.includes('--nosig');

if (chain > 0) {
  /* 连玩曲线：第 N 局的声望 = 前面每局 prestigeGain 的累积。
     这是判断「越玩越好还是越玩越糟」的唯一口径。
     V6 招牌配方（跨局继承）也在这条曲线上：每局卖出的累计销量会
     累加进下一局的基线。--nosig 可关掉它做对照。 */
  console.log(`\n########## 连玩 ${chain} 局（每局结束时转生，声望累积继承） ##########`);
  for (const d of ['normal']) {
    const goal = E.DIFFICULTY[d].goal;
    console.log(`\n难度 ${d} / 目标 ${goal} / 每格 ${RUNS} 局取平均`);
    console.log('第N局   声望  开局基金   平均净资产   达标率   破产   招牌Lv');
    let bp = 0;
    /* 跨局招牌基线：每款配方的累计卖出杯数 */
    let sig = {};
    for (let round = 1; round <= chain; round++) {
      const worths = []; let busted = 0, gainSum = 0;
      const sigRuns = [];
      for (let k = 0; k < RUNS; k++) {
        const { log, s, sig: sigRun } = playAI(d, undefined, bp, NOSIG ? null : sig);
        worths.push(Math.round(E.netWorth(s)));
        gainSum += E.prestigeGain(s);
        sigRuns.push(sigRun);
        if (log.some(x => typeof x === 'string')) busted++;
      }
      /* 下一局的招牌基线 = 本局平均新增（与声望同一套取平均口径）。
         要遍历**本局新增的配方**（sigRuns 的并集），不是上一局基线的 key ——
         上一局基线为空时（第一局）会一个都遍历不到，招牌永远是 Lv.0。 */
      if (!NOSIG) {
        const next = {};
        const rids = new Set();
        for (const sr of sigRuns) for (const rid of Object.keys(sr || {})) rids.add(rid);
        for (const rid of rids) {
          const add = sigRuns.reduce((a, sr) => a + E.num(sr && sr[rid], 0), 0) / sigRuns.length;
          if (add > 0) next[rid] = E.num(sig[rid], 0) + add;
        }
        sig = next;
      }
      /* 当前招牌等级：取基线里最高的一档。
         阈值必须读引擎的 SIGNATURE_TIERS —— 写死一份副本的话，
         改门槛后这里会静默显示旧等级（实测踩过：门槛已提到 250/700/1500，
         显示却还是按 60/150/300 算的，第 1 局就报 Lv.3）。 */
      let sigLv = 0;
      if (!NOSIG) {
        for (const rid of Object.keys(sig)) {
          const cups = E.num(sig[rid], 0);
          let lv = 0;
          for (const t of E.SIGNATURE_TIERS) if (cups >= t.cups) lv = t.lv;
          if (lv > sigLv) sigLv = lv;
        }
      }
      const avg = Math.round(worths.reduce((a, b) => a + b, 0) / worths.length);
      console.log(String(round).padStart(4), String(bp).padStart(7),
        String(E.prestigeStartCash(bp)).padStart(8), String(avg).padStart(11),
        String((avg / goal * 100).toFixed(0) + '%').padStart(8), String(busted + '/' + RUNS).padStart(7),
        String('Lv.' + sigLv).padStart(8));
      bp += Math.round(gainSum / RUNS);   /* 下一局的声望 = 本局平均转生收益的累积 */
    }
  }
}

for (const d of ['easy', 'normal', 'hard']) {
  const scores = [], bustRuns = [], stuckRuns = [], fullScores = [];
  let last = null;
  for (let k = 0; k < RUNS; k++) {
    const { log, s } = playAI(d, undefined, BP);
    const w = Math.round(E.netWorth(s));
    scores.push(w);
    /* ★ V21：把"这一局是怎么结束的"分清楚，原来全塞进一个 failedRuns。
       实测后果：某档打出「达标 6/6 局（100%）」的同时报「⚠️ 破产局次 3」——
       两条结论互相打脸，因为那个 3 其实大多是「无法开门」而不是破产。
       ★ 而且**提前中断的局不该参与达标统计**：
         它在 Day N 就停了，净资产是"半局成绩"，
         拿它去和 30 天的目标比，既高估达标率也污染平均值。
         所以额外维护一份"完整局"的分数（fullScores），达标率按它算。 */
    let broke = false;
    for (const x of log) {
      if (typeof x !== 'string') continue;
      if (x.indexOf('破产') >= 0) { bustRuns.push(k + 1); broke = true; }
      else if (x.indexOf('无法开门') >= 0) { stuckRuns.push(k + 1); broke = true; }
    }
    if (!broke) fullScores.push(w);
    last = { log, s };
  }
  const goal = E.DIFFICULTY[d].goal;
  console.log(`\n=============== 难度 ${d} / 目标 ${goal} / ${RUNS} 次模拟`
    + (BP ? ` / 声望 ${BP}★（开局基金 ${E.prestigeStartCash(BP)}）` : '')
    + (CARDS !== 'none' ? ` / 策略卡 ${CARDS}` : ' / 无策略卡') + ' ===============');
  if (verbose) {
    const rows = last.log.filter(x => typeof x === 'object');
    console.log('Day  客流 卖出 流失   营收    净利  口碑    现金   净资产 员工 店');
    for (const r of rows) {
      console.log(
        String(r.day).padStart(3), String(r.traffic).padStart(5), String(r.served).padStart(4),
        String(r.lost).padStart(4), String(r.rev).padStart(7), String(r.net).padStart(7),
        String(r.rep).padStart(5), String(r.cash).padStart(8), String(r.worth).padStart(9),
        String(r.staff).padStart(4), String(r.shops).padStart(3));
    }
    last.log.filter(x => typeof x === 'string').forEach(x => console.log(x));
  }
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  let wsTot = 0, recTot = 0, n = 0;
  for (const r of last.log) { if (r && r.ws) { n++; for (const k in r.ws) if (r.ws[k] > 0) wsTot++; recTot += r.recipes || 0; } }
  /* ★ V21：两个数值必须分开报，不能再合并成一句「达标率」。
     原实现只有 `avg / goal`，标签却叫「达标率」——
     那不是达标**概率**，是**平均完成度**。
     实测教训：easy 报「达标率 90%」，但 18 局里一局都没到 58000
     （中位 44725）—— 完成度 77%、真实达标率 0%。
     两个数字混为一谈会让「这档到底能不能通」永远看不出来。 */
  const passN = fullScores.filter(x => x >= goal).length;
  const fullAvg = fullScores.length
    ? Math.round(fullScores.reduce((a, b) => a + b, 0) / fullScores.length) : 0;
  console.log(`净资产：${scores.join(' / ')}  平均 ${avg}`);
  console.log(`  达标 ${passN}/${fullScores.length || 0} 局（${fullScores.length ? (passN / fullScores.length * 100).toFixed(0) : '-'}%）`
    + ` · 完整局平均 ${fullAvg} · 完成度 ${fullScores.length ? (fullAvg / goal * 100).toFixed(0) : '-'}%`
    + (n ? `  | 末局平均产线 ${(wsTot / n).toFixed(1)} 条 · 解锁配方 ${(recTot / n).toFixed(1)} 款` : ''));
  if (bustRuns.length || stuckRuns.length) {
    console.log('  ⚠️ 未跑完的局：'
      + (bustRuns.length ? `破产 ${bustRuns.join(',')}` : '')
      + (bustRuns.length && stuckRuns.length ? ' · ' : '')
      + (stuckRuns.length ? `无法开门 ${stuckRuns.join(',')}` : ''));
  }
}
