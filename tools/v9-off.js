/* ============================================================
 *  V9 配对测量的**共享关闭开关**（diag-invest.js 与 diag-sweep.js 共用）
 *
 *★ 为什么要抽成共享（第二版踩坑的直接原因）：
 *   两个诊断工具各自维护一份「关掉 V9 收益」的清单，于是必然漂移 ——
 *   实测：diag-sweep 关了 costCut，diag-invest 没关，
 *   同一份代码、同一难度、同一 24 局固定种子，
 *   两个工具一个报「产线 2.46 / +1.5pp」，另一个报「产线 1.2 / −7pp」。
 *   差13pp，根源只是两份清单不一致。
 *   结论：**测量代码里的"实验条件"必须和被测系统同源**，
 *   否则测出来的不是系统的性质，是两份清单的差异。
 *
 *  收益层每加一层，这里的清单就必须同步 —— 这是刻意的摩擦：
 *  漏改会被diag-invest.js 的基线自检断言当场抓住（退出码 1），
 *  而不是变成一个看起来很合理的错误结论。
 * ============================================================ */

/**
 * 生成「V9 收益全部归零」的补丁源码。
 * @param {boolean} noAI  是否同时让 AI 完全不开线（真基线必须是"没有这个系统"）
 */
function v9OffPatch(noAI) {
  const parts = [
    'CRAFT_WORKSHOPS.forEach(w=>{',
    '  w.costCut=[0,0,0,0];',      /* ① 降本（主力层）*/
    '  w.saleBonus=[0,0,0,0];',    /* ② 销量权重 */
    '  w.researchCut=0;',          /* ③ 研发折扣 */
    '  delete w.tier3Bonus;',      /* ④ 高端款加成 */
    '});',
    'CUISINE_FOCUS.forEach(f=>{f.need=99;f.bonus=0;});',   /* ⑤ 菜系主打 */
  ];
  if (noAI) parts.push('var AI_NO_WS = true;');
  return parts.join('');
}

/**
 * 基线自检：收益全关后，把工坊假装开满级，**任何一层都不该还有效果**。
 * 返回泄漏的层名数组（空数组 = 干净）。
 *
 * ★ 这条断言是"漏关一层"的唯一防线。
 *   漏关时的现象很隐蔽：净效应被凭空抹掉十几个 pp，
 *   但数字看起来依然"有结论"，于是错误结论被采信。
 */
function v9OffLeakCheck() {
  const bad = [];
  const s = newGame('normal', 0, null);
  s.recipes = RECIPES.map(r => r.id);
  for (const w of CRAFT_WORKSHOPS) {
    s.workshops[w.id] = 3;                       /* 假装满级 */
    const hi = RECIPES.find(r => r.cuisine === w.id && r.tier >= 3);
    const lo = RECIPES.find(r => r.cuisine === w.id && r.tier < 3);
    const probe = (lo || hi).id;
    if (hi && workshopTier3Bonus(s, hi.id) !== 0) bad.push(w.id + ':tier3Bonus');
    if (lo && workshopTier3Bonus(s, lo.id) !== 0) bad.push(w.id + ':tier3Bonus(非高端)');
    if (workshopCostCut(s, w.id) !== 0) bad.push(w.id + ':costCut');
    if (workshopResearchCut(s, w.id) !== 0) bad.push(w.id + ':researchCut');
    if (cuisineWeightMul(s, probe) !== 1) bad.push(w.id + ':saleBonus');
  }
  /* 主打加成：塞满同一菜系也不该有任何加成 */
  const target = CUISINES[0].id;
  for (const rid of RECIPES.filter(r => r.cuisine === target).slice(0, 8)) {
    if (s.menu.indexOf(rid) < 0) { s.menu.push(rid); s.ratios[rid] = 1; }
  }
  if (cuisineFocusBonus(s, target).bonus !== 0) bad.push('CUISINE_FOCUS');
  return bad;
}