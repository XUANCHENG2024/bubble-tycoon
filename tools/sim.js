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
  return playSharedAI(E, diff, bp, sig, {
    rng: Math.random, clickRate: 2.5, cards: CARDS,
    /* ★ V21：`--days=N` 让「截到第 N 天」成为一等能力。
      用途：复核「末段空转」时不能只看 30 天的终值 —— 要把一局砍到第 20 天，
      看那一刻手里握着多少现金、有没有东西可买。原来只能改代码或用 -v 目测，
      而 -v 打的是流水、不是"第 20 天的持仓结构"。
      ai-shared 早就支持 o.day 这个参数（它同时用于 DAYS_LEFT 的合同缩放），
      只是 sim.js 一直没把它接出来。 */
    day: STOP_DAY || undefined,
    /* ★ V21：采购口径（`--buy=autoFill|manual`）。
       默认 autoFill = 产品里「🛒 一键补货」按钮的算法（教程明确教玩家用），
       是本标定的**上界**；manual = 手搓配额，是**下界**（比真人笨三成）。
       目标应当定在两者之间：让自动补货的玩家过得舒服、手动精算的玩家仍有挑战。
       之前所有标定都只跑了 manual，等于拿一个偏弱的 bot 当基准，目标被系统性低估。 */
    buy: BUY_MODE,
  });
}

const RUNS = Number(process.argv[2] || 3);
const verbose = process.argv.includes('-v');
const chain = Number(argVal('chain', 0));
const BP = Number(argVal('bp', 0));
const CARDS = (argVal('cards', 'none') || 'none').toLowerCase();
/* --nosig：连玩曲线里关掉 V6 招牌配方的跨局继承，做 A/B 对照。
   招牌是唯一的跨局成长线，必须能单独测出它对留存曲线的影响。 */
const NOSIG = process.argv.includes('--nosig');
/* --days=N：把这局截到第 N 天（默认跑满 30 天）。配合 --dump 用来复核"末段空转"：
   看第 20 天手里握着多少现金、还有没有可买的出口，而不是只看 30 天的终值。 */
const STOP_DAY = Number(argVal('days', 0)) || 0;
/* 采购口径：autoFill（默认，= 产品里的一键补货）｜manual（手搓，下界） */
const BUY_MODE = (argVal('buy', 'autoFill') || 'autoFill').toLowerCase() === 'manual' ? 'manual' : 'autoFill';
/* --dump：跑完打印最后一局的**第 N 天快照**（持仓结构，不是流水）。
   ★★ 快照必须取在 endDay 之后（本文件读的是 playSharedAI 返回后的 s，
      此时最后一次循环已走完 endDay，phase 已是 'report'）。
      若改成在循环中途打，会拿到 phase==='open' 的营业中状态 ——
      能跑通、JSON 也正常、渲染也不报错，但看到的备货页和玩家看到的不是一个
      （drawPanelArea 的 pinH 只在 phase==='prep' 时生效）。这种"能跑但画面不对"
      比崩溃更难发现，所以这里绝不插入循环内部。 */
const DUMP = process.argv.includes('--dump');

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
  /* ★ V21：分店**托管**覆盖率。
     ⚠️ 这里最初写的是「分店营收恒为 0 ⇒ 模拟只覆盖主店」，那个判断是错的：
        自营分店的员工就是同一场 sim 里、带 branchIdx 的出杯位，
        收益记进**主店日报**，分店自身账本字段保持 0 是正常的。
        我按分店账本读，于是把"字段没写"误读成"没有产出"。
     ★ 正确的盲区只有一处：**托管店**（auto + managerId）走独立的
       managedStoreDaily 结算，与实时 sim 无关；而 AI 从不雇店长，
       所以托管这条路径确实测不到。文案只声称这一点，不再外推。 */
  let branchRuns = 0, branchRevSum = 0, storeSum = 0;
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
    /* 分店统计：只数"非主店且累计营收 > 0"的，才是真的在贡献经济 */
    const stores = s.stores || [];
    storeSum += stores.length;
    for (const st of stores) {
      if (!st || st.main) continue;
      const rev = E.num(st.revTotal != null ? st.revTotal : st.revenue, 0);
      if (rev > 0) { branchRuns++; branchRevSum += rev; break; }
    }
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
  /* ★ V21：自检 —— 完整局 + 未跑完的局 必须等于总局数。
     这条断言是因为**真的出过一次自相矛盾**：同一行输出里
     「达标 11/11 局（100%）」与「破产 10」并存，而只跑了 12 局。
     数字对不上时最危险的不是崩溃，而是它看起来仍然像个结论。
     宁可吵，也不要让一个不可能的组合被当成数据引用。 */
  {
    const seen = new Set([...bustRuns, ...stuckRuns]);
    const accounted = fullScores.length + seen.size;
    if (accounted !== RUNS) {
      console.log(`  ⚠️ 口径自检失败：完整 ${fullScores.length} 局 + 未跑完 ${seen.size} 局`
        + ` ≠ 总 ${RUNS} 局 —— 本次的破产/达标数字**不可引用**，先修统计`);
    }
  }
  const avgStores = (storeSum / RUNS).toFixed(2);
  /* --dump：最后一局的持仓快照。只打事实，不下结论 —— 结论由看的人下。 */
  if (DUMP && last && last.s) {
    const s = last.s;
    const invVal = E.invValue(s);
    const upTxt = Object.keys(s.up || {}).map(k => k + ':' + s.up[k]).join(' ');
    console.log('  ── 快照（Day ' + s.day + ' · phase=' + s.phase + '）──');
    console.log('     现金 ¥' + Math.round(s.cash) + ' · 库存估值 ¥' + Math.round(invVal)
      + ' · 投资 ¥' + Math.round(s.invested || 0) + ' · 净资产 ¥' + Math.round(E.netWorth(s)));
    console.log('     升级 ' + upTxt);
    console.log('     员工 ' + (s.staff || []).length + ' 人 · 店 ' + (s.stores || []).length + ' 家'
      + ' · 已解锁配方 ' + (s.recipes || []).length + ' 款 · 在售 ' + (s.menu || []).length + ' 款');
    console.log('     期间现金峰值（本局快照不可得，仅当前）——需逐日流水请用 -v');
  }
  /* ★ 样本量提示：n<20 时过关率的 95% 区间宽达 ±20pp。
     本轮真实踩过：同一份代码 normal 在不同批次里 50% 与 73% 都出现过，
     差点据此把一个本来正确的目标改坏。
     CI 判阈值用「完成度」（方差极小），人做设计判断看「过关率」（必须 n≥100）。 */
  if (RUNS < 20) {
    const p = fullScores.length ? passN / fullScores.length : 0;
    /* ★ p 恰好等于 0 或 1 时标准误公式给 0 —— 那不是"精度极高"，
       而是"全部落在同一侧"，真实区间反而最宽。别再打印 ±0pp 误导人。 */
    const se = (p > 0 && p < 1 && fullScores.length) ? Math.sqrt(p * (1 - p) / fullScores.length) : NaN;
    const band = isNaN(se) ? '无法估计（全对或全错）' : '约 ±' + (1.96 * se * 100).toFixed(0) + 'pp';
    console.log(`  · 样本提示：n=${fullScores.length}，过关率 95% 区间 ${band}`
      + ' —— 别用它微调目标（判阈值请看「完成度」）');
  }
  if (branchRuns === 0) {
    console.log(`  ⚠️ 托管店覆盖 0/${RUNS} 局（平均 ${avgStores} 家店）—— `
      + '本次数字**不含托管结算路径**（AI 从不雇店长）；自营分店的产出已计入主店营收');
  } else {
    console.log(`  · 托管店有产出的局 ${branchRuns}/${RUNS}（平均 ${avgStores} 家店）`
      + ` · 托管营收 ¥${Math.round(branchRevSum)}`);
  }
}
