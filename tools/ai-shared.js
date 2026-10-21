/* ============================================================
 *  共享的脚本 AI（sim.js 与 diag-balance.js 共用）
 *
 *  ★ 为什么要抽成共享模块（而不是两处各写一份）：
 *     之前 sim.js 与 diag-balance.js 各有一份 AI，结果**漂移了** ——
 *     diag-balance 还是"只看现金就开线"的旧版，而 sim.js 已改成
 *     "为想研发的新品开线"。于是配对实测测的是「对着旧 AI 的新系统」，
 *     得出的 −16pp 结论完全是假的。
 *     两处 AI 重复实现 = 必然漂移 = 平衡结论不可信。共享一份是唯一可靠解。
 *
 *  用法：两个工具都先加载本文件，再调用 playAI。
 *  依赖：引擎的全局符号（newGame / toggleMenu / canResearch / ...）与
 *        全局 RNG（Math.random 用于点击模拟）。
 * ============================================================ */

/**
 * 跑一局 30 天。
 * @param {object} E       引擎全局（vm context）
 * @param {string} diff    难度
 * @param {number} bp      初始声望点
 * @param {object} sig     跨局招牌基线（可为 null）
 * @param {object} opt     { rng: ()=>number, clickRate: number, day: number }
 */
function playSharedAI(E, diff, bp, sig, opt) {
  const o = opt || {};
  const rnd = o.rng || Math.random;
  const clickRate = o.clickRate == null ? 2.5 : o.clickRate;
  const s = E.newGame(diff, bp || 0, sig || null);
  const log = [];

  while (s.day <= (o.day || E.CFG.DAYS)) {
    /* --- V9 工坊投资 ---
       动机是「有一条够得着的线还没开」，而不是「钱多了就开」——
       后者永远不会触发（钱永远优先花在回报更快的设备上）。
       实测：纯看现金的 AI 一条新线都开不出来，整个工坊系统成了死功能。
       ★ 必须走 buildWorkshop：直接改 s.workshops 会绕过成本，
         测出来的就是"白拿一条产线"，是假的。 */
    if (typeof AI_NO_WS === 'undefined') var AI_NO_WS = false;
    if (!AI_NO_WS) {
      /* ★ 工坊投资的决策要像**理性玩家**，把**每一层收益都算进账**。
         曾经的写法是「看到想研发就开」或「只看现金够不够」—— 前者等于把钱扔进
         一个不影响决策的软约束里，后者会导致一条线都开不出来，整个系统成了死功能。
         现在的判据是**净收益 > 0**：
           收益 = 该系降本省下的钱（绝对量，与销量挂钩）
                + 该系销量权重加成带来的额外销量 × 毛利
           成本 = 造价
         ★ 必须算降本那部分（tools/diag-sweep.js 扫描时发现的）：
           只算权重时 AI 永远算亏 —— 权重是相对量、不抬客流总量，
           收益有天花板；而造价是绝对量。两者形态不匹配，再怎么调数值都不行。
           降本是绝对量、且卖得越多越赚，才撑得起造价。 */
      const DAYS_LEFT = Math.max(0, (o.day || E.CFG.DAYS) - s.day);
      let best = null, bestGain = 0;
      for (const w of E.CRAFT_WORKSHOPS) {
        const lv = E.workshopLevel(s, w.id);
        if (lv >= 3) continue;
        const c = E.workshopCost(s, w.id);
        if (c == null) continue;
        const nxt = lv + 1;
        const nextCut = (w.costCut && w.costCut[nxt]) || 0;
        const curCut = (w.costCut && w.costCut[lv]) || 0;
        const nextBonus = (w.saleBonus && w.saleBonus[nxt]) || 0;
        const curBonus = (w.saleBonus && w.saleBonus[lv]) || 0;
        /* 菜单里该系的每一款，每天的预计销量。
           ★ 必须按 **trafficOf / 该系在菜单里的权重占比** 折算，不能用
             trafficOf / menuSlots：
             客流是**进店人数**，每人只买 1 杯，但出杯率受产能与设备限制 ——
             实测菜单 7 款、日客流 20 时，每款日销约 3 杯而客流折算是 20/7≈2.9，
             看起来接近；问题出在 **trafficOf 低估了真实可达销量**：
             实测终局日销 63~71 杯，而 trafficOf 只有 14~20。
             用 trafficOfl直接除菜单数，会把每款日销低估 2~3 倍，
             于是降本收益被算成 ¥2/天、15 天 ¥33 —— 远低于 ¥300 造价，
             AI 于是永远算亏，一条线都不开。
             修正：用**当天实际卖出的杯数**（lastReport.cups）来摊，
             它是已经发生的真实销量，比"客流预测"可靠得多。 */
        const inMenu = s.menu.filter(rid => (E.recipeById(rid) || {}).cuisine === w.id);
        if (!inMenu.length) continue;        /* 菜单里没这款，开线没用 */
        const share = inMenu.length / Math.max(1, s.menu.length);
        const actualCups = (s.lastReport && s.lastReport.cups)
          || E.trafficOf(s);                /* 没有历史就退回客流估算 */
        let cupsPerDay = 0, cutGain = 0;
        for (const rid of inMenu) {
          const per = actualCups * share;
          cupsPerDay += per;
          /* 降本省下的钱 = 每杯原料成本 × 降本比例 */
          const rc = (E.recipeById(rid).req || {});
          let ing = 0;
          for (const k in rc) ing += rc[k] * (s.avgCost[k] || E.ING.find(g => g.id === k).base);
          cutGain += ing * per * (nextCut - curCut);
        }
        const marginPerCup = 12;            /* 单杯毛利粗估，宁低勿高 */
        const gain = cutGain + (nextBonus - curBonus) * cupsPerDay * marginPerCup;
        const estGain = gain * DAYS_LEFT;
        if (estGain > c && estGain > bestGain) { best = w.id; bestGain = estGain; }
      }
      if (best) {
        const c = E.workshopCost(s, best);
        /* 开线后要留得住周转金，否则直接破产 */
        if (c != null && s.cash - c > 500) E.buildWorkshop(s, best);
      }
    }

    /* --- 菜单 & 定价（先定菜单，才知道要进什么货） ---
       走 toggleMenu 而不是直接写 s.menu：V9 之后工坊影响
       「tier3 配方能不能做」与「该系销量权重」，直接写会绕过这些约束。 */
    s.menu = [];
    for (const rid of s.recipes) {
      if (s.menu.length >= E.menuSlots(s)) break;
      E.toggleMenu(s, rid);
      if (s.menu.includes(rid)) s.ratios[rid] = 1.0;
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
      if (want > 0) {
        E.buyIng(s, g.id, Math.min(want, Math.max(0, Math.floor((s.cash - 200) / s.prices[g.id]))));
      }
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
        else {
          const tc = E.upgradeCost(s, 'training');
          if (tc != null && s.cash > tc * 1.8) { E.doUpgrade(s, 'training'); did = true; }
        }
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
    if (!r.ok) { log.push('Day ' + s.day + ' 无法开门: ' + r.msg); break; }
    let steps = 0;
    while (s.phase === 'open' && steps++ < 5000) {
      E.tick(s, 1 / 30);
      if (s.sim && rnd() < clickRate / 30) {
        const busy = s.sim.stations.map((st, i) => (st.order ? i : -1)).filter(i => i >= 0);
        if (busy.length) E.rushStation(s, busy[Math.floor(rnd() * busy.length)]);
      }
    }
    const rep = s.report;
    log.push({
      ws: Object.assign({}, s.workshops),
      recipes: s.recipes.length,
      day: rep.day, served: rep.cups, orders: rep.orders,
      rev: Math.round(rep.revenue), net: Math.round(rep.net),
      rep: Math.round(rep.repAfter), cash: Math.round(s.cash),
      worth: Math.round(E.netWorth(s)), staff: s.staff.length, shops: s.shops,
    });
    /* 打烊三选一：三种口径对照，验证「卡牌只改收益结构、不改收益总量」 */
    if (o.cards && o.cards !== 'none' && Array.isArray(s.cardOffer) && s.cardOffer.length) {
      if (o.cards === 'random') E.applyCard(s, s.cardOffer[Math.floor(rnd() * s.cardOffer.length)].id);
      else E.applyCard(s, s.cardOffer[0].id);
    }
    if (E.isBankrupt(s)) { log.push('💸 破产于 Day ' + s.day); break; }
    E.nextDay(s);
  }
  return { log, s, sig: s.sigRun || {} };
}
