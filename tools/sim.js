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
  + ';globalThis.__D = { CFG, ING, RECIPES, UPGRADES, TRAITS, EVENTS, ACHIEVEMENTS, DIFFICULTY, TAGS, SHOP_COSTS, num, SIGNATURE_TIERS };';
vm.runInContext(src, ctx, { filename: 'bundle.js' });

const E = ctx;
Object.assign(E, E.__D);

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
  const s = E.newGame(diff, bp || 0, sig || null);
  const log = [];
  while (s.day <= E.CFG.DAYS) {
    /* --- 菜单 & 定价（先定菜单，才知道要进什么货） --- */
    s.menu = [];
    for (const rid of s.recipes) {
      if (s.menu.length >= E.menuSlots(s)) break;
      s.menu.push(rid); s.ratios[rid] = 1.0;
    }
    /* --- 研发：现金充裕时解锁更高价配方 --- */
    for (const r of E.RECIPES) {
      if (s.recipes.includes(r.id)) continue;
      if (E.canResearch(s, r.id).ok && s.cash > E.researchCost(s, r.id) * 2.6) E.doResearch(s, r.id);
    }
    /* --- 营销 --- */
    s.marketing = s.cash > 2500 ? Math.min(1600, Math.floor(s.cash * 0.1)) : 0;
    /* --- 采购：按预测客流备货（多杯订单按 1.6 倍折算），留 200 备用金 --- */
    const need = E.trafficOf(s) * 1.25 * 1.6;
    const per = Math.max(1, Math.round(need / Math.max(1, s.menu.length)));
    for (const g of E.ING) {
      let want = 0;
      for (const rid of s.menu) want += (E.recipeById(rid).req[g.id] || 0) * per;
      want = Math.ceil(want - (s.inv[g.id] || 0));
      if (want > 0) E.buyIng(s, g.id, Math.min(want, Math.max(0, Math.floor((s.cash - 200) / s.prices[g.id]))));
    }
    /* --- 投资：产能不足先补产能，富余再扩张 --- */
    const lost = s.lastReport ? s.lastReport.lost : 0;
    const shortCapacity = lost >= 3;
    let guard = 0;
    while (guard++ < 14) {
      let did = false;
      if (shortCapacity) {
        const sc = E.upgradeCost(s, 'speed');
        if (sc != null && s.cash > sc * 1.6) { E.doUpgrade(s, 'speed'); did = true; }
        else if (s.staff.length < 6 && s.candidates.length && s.cash > s.candidates[0].fee * 1.6) { E.hireStaff(s, 0); did = true; }
        else { const tc = E.upgradeCost(s, 'training'); if (tc != null && s.cash > tc * 1.8) { E.doUpgrade(s, 'training'); did = true; } }
      }
      if (!did && s.cash > 1200) {
        const sc2 = E.shopCost(s);
        if (sc2 != null && s.cash > sc2 * 1.5) { E.openShopBranch(s); did = true; }
      }
      if (!did) for (const id of ['decor', 'menu', 'storage', 'auto']) {
        const c = E.upgradeCost(s, id);
        if (c != null && s.cash > c * 2.2) { E.doUpgrade(s, id); did = true; }
      }
      if (!did) break;
    }

    /* --- 营业 --- */
    const r = E.openShop(s);
    if (!r.ok) { log.push(`Day ${s.day} 无法开门: ${r.msg}`); break; }
    /* 模拟玩家手速：约 2.5 次点击/秒（真实玩家可到 5+） */
    let steps = 0;
    while (s.phase === 'open' && steps++ < 5000) {
      E.tick(s, 1 / 30);
      if (s.sim && Math.random() < 2.5 / 30) {
        const busy = s.sim.stations.map((st, i) => (st.order ? i : -1)).filter(i => i >= 0);
        if (busy.length) E.rushStation(s, busy[Math.floor(Math.random() * busy.length)]);
      }
    }
    const rep = s.report;
    log.push({
      day: rep.day, served: rep.served, lost: rep.lost, traffic: rep.traffic,
      rev: Math.round(rep.revenue), net: Math.round(rep.net), rep: Math.round(rep.repAfter),
      cash: Math.round(s.cash), worth: Math.round(E.netWorth(s)), staff: s.staff.length, shops: s.shops,
    });
    /* 打烊三选一：三种口径对照，验证「卡牌只改收益结构、不改收益总量」 */
    if (CARDS !== 'none' && Array.isArray(s.cardOffer) && s.cardOffer.length) {
      if (CARDS === 'random') E.applyCard(s, s.cardOffer[Math.floor(Math.random() * s.cardOffer.length)].id);
      else E.applyCard(s, s.cardOffer[0].id);      /* first：永远拿第一张（最粗糙的策略） */
    }
    if (E.isBankrupt(s)) { log.push('💸 破产于 Day ' + s.day); break; }
    E.nextDay(s);
  }
  /* 本局新增的招牌销量（V6）：连玩时累加进下一局的跨局基线 */
  return { log, s, sig: s.sigRun || {} };
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
  const scores = [], failedRuns = [];
  let last = null;
  for (let k = 0; k < RUNS; k++) {
    const { log, s } = playAI(d, undefined, BP);
    scores.push(Math.round(E.netWorth(s)));
    if (log.some(x => typeof x === 'string')) failedRuns.push(k + 1);
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
  console.log(`净资产：${scores.join(' / ')}  平均 ${avg}  达标率 ${(avg / goal * 100).toFixed(0)}%`
    + (failedRuns.length ? `  ⚠️ 破产局次 ${failedRuns.join(',')}` : ''));
}
