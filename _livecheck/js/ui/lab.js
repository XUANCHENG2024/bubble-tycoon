/* ============================================================
 *  研发树 / 招牌配方 / 原料市场（V20.2 · 从 ui.js 拆出）
 * ============================================================
 *
 * ★ 拆分说明（tools/split-ui.js 自动生成）：
 *   这些函数原本平铺在 ui.js（3714 行 / 72 个顶层函数）里，
 *   按功能分组后搬到独立文件。
 *   ★ **函数体一行未改** —— 调用方也一行未改：
 *     下面用 IIFE 把原函数挂到 window 上原有的名字，
 *     所以 ui.js 与 main.js 里的调用完全不用动。
 *   ★ 为什么用 IIFE 而不是直接 top-level function：
 *     直接声明在浏览器全局作用域会污染 window，
 *     而 window 上已经有几十个同名函数（引擎层的），
 *     裸声明容易撞名。IIFE + 显式挂载更可控。
 *
 * ★ 加载顺序：必须在 js/ui.js **之前**加载 ——
 *   因为 ui.js 里的 PANEL_RENDERERS 会在模块加载时就引用这些函数。
 */
(function (global) {
  'use strict';

/* ---------------- 研发面板 ---------------- */
/** V6 招牌配方卡：10 款配方的跨局累计进度。返回一段 HTML 字符串。 */
function sigCardHtml(s) {
  const sgs = sigViews(s);
  /* ★★ V19：原来 sigViews 返回**全部 57 款配方**（含未解锁的），
     开局实测：玩家已解锁 1 款 → **56 行是玩家根本没见过的配方**。
     那些行的 emoji 和名字玩家根本不认识，进度条全是 0/250 ——
     纯噪音，却占掉研发页 **33% 的体积**（14446 / 44337 字符）。
     ★ 招牌是「已解锁配方卖得越多越强」，
       没解锁的配方根本卖不了，列出来没有意义。*/
  const own = sgs.filter(x => s.recipes.indexOf(x.id) >= 0);
  const locked = sgs.length - own.length;

  const maxed = own.filter(x => x.maxed).length;
  const anyLv = own.filter(x => x.lv > 0).length;

  let h = `<div class="card sig-card">
    <div class="card-h">🏷️ 招牌配方
      <span class="ch-sub">${anyLv}/${own.length} 款已成招牌${maxed ? ` · ${maxed} 满级` : ''}</span></div>
    <div class="sig-desc">累计卖出杯数<b>跨局继承</b>—— 这一局卖得多，下一局该款永久更强。<br>
      专精一款（Lv.3）比铺开十款更划算：招牌加成只对<b>那一款</b>生效。</div>`;

  /* ★ 一行都点不了是最大的浪费：旁边就是研发树，点一下应该能跳过去。
     复用 V16 的 torecipe（统一跳转模式：切页 + 滚动 + 高亮）。*/
  /* ★ 排序：最接近升级的排最前。
     玩家来这个栏是问「我的招牌离下一级还差多少」，
     而不是「按字母序看一遍」。满级的沉到最后。 */
  const sorted = own.slice().sort((a, b) => {
    if (a.maxed !== b.maxed) return a.maxed ? 1 : -1;
    /* ratio 大的在前 —— 越接近升级越该被看见 */
    return b.ratio - a.ratio;
  });

  if (!own.length) {
    h += `<div class="empty">
      <div class="empty-e">🏷️</div>
      <div class="empty-t">还没有可培养的配方</div>
      <div class="empty-d">研发并上架任意一款配方后，<br>它就会出现在这里开始累计销量。</div>
    </div>`;
  } else {
    for (const g of sorted) h += sigRowHtml(g);
  }

  /* ★ 未解锁的不列行，只给一句说明 ——
     省下 56 行，同时告诉玩家「还有多少在前面等着」，
     不至于以为系统漏了东西。*/
  if (locked) {
    h += `<div class="sig-locked">🔒 还有 ${locked} 款配方未解锁，研发后自动出现在这里</div>`;
  }
  h += `</div>`;
  return h;
}

/**
 * 单个招牌行（V19）
 * ★ 改动：
 *   ① 整行可点 → 跳到该配方的研发树节点（V16 的 torecipe）
 *   ② 满级/未成招牌两种状态用不同的视觉层级（别混在一起）
 *   ③ 进度条旁补「还差 N 杯」—— 原来只有 x/N 杯，玩家要自己算
 */
function sigRowHtml(g) {
  const cls = g.maxed ? ' maxed' : (g.lv > 0 ? ' on' : '');
  /* ★ 「还差 N 杯」比「250/250」直接得多：
     前者是玩家要的那个数，后者要心算。 */
  const gap = g.maxed ? '' : ` 还差 ${Math.max(0, g.nextCups - g.cups)} 杯`;
  return `<button type="button" class="sig-row${cls}"
    data-act="torecipe" data-id="${esc(g.id)}"
    title="${esc(g.desc)}（点击跳到研发树）"
    aria-label="${esc(g.name)}，${g.maxed ? '已满级' : (g.lv > 0 ? g.tierName : '未成招牌')}，${g.cups} 杯${gap}">
    <span class="sg-e">${g.emoji}</span>
    <span class="sg-n">${esc(g.name)}</span>
    ${g.lv > 0
      ? `<span class="sg-lv">${g.tierEmoji} ${esc(g.tierName)}</span>`
      : `<span class="sg-lv none">未成招牌</span>`}
    <span class="sg-c">${g.maxed ? '🏆 满级' : `${g.cups}/${g.nextCups} 杯${gap}`}</span>
    <span class="sg-bar"><i style="width:${(g.ratio * 100).toFixed(1)}%"></i></span>
  </button>`;
}

/** 城市条：明确标示当前城市 + 可用菜系 + 专属原料（需求「界面标示当前城市及其可用菜系」） */
/**
 * 已解锁配方的「每杯消耗」行（V16）
 *
 * ★ 为什么已解锁的也要显示：
 *   未解锁时显示的是「研发需要多少」——那是**未来的需求**；
 *   但解锁之后玩家真正关心的是「每杯要烧多少料、库存撑不撑得住」。
 *   原来解锁后这块就没了，玩家只能回到市场自己对照。
 *
 * ★ 缺料时标红但**仍可点**（跳去市场）——
 *   红是提示不是禁用，而且这正是玩家最需要跳转的时刻。
 */
function recipePerCupHtml(s, rid) {
  const ings = ingsOfRecipe(rid).filter(x => x.perCup > 0);
  if (!ings.length) return '';
  const parts = ings.map(x => {
    const need = x.perCup;
    /* 一杯的量太小，说"能做 N 杯"没意义；直接按"够不够做一杯"提示 */
    const have = Math.round(num(s.inv[x.id], 0));
    const ok = have >= need;
    return `<button class="ing-link${ok ? '' : ' short'}"
      data-act="toing" data-id="${esc(x.id)}"
      title="${esc(x.name)}：现有 ${have} 个，每杯需 ${need} 个（点击去市场）">
      ${x.emoji}每杯${need}<span style="color:${
        ok ? 'var(--green)' : 'var(--red)'}">(${have})</span></button>`;
  });
  const short = ings.filter(x => Math.round(num(s.inv[x.id], 0)) < x.perCup);
  return `<div class="rc-tip" style="margin-top:6px">
    每杯消耗 ${parts.join(' ')}
    ${short.length ? `<span style="color:var(--red)"> · ${short.length} 种料不够</span>` : ''}
  </div>`;
}

/**
 * 原料行的「能做什么」面板（V16）
 *
 * ★ 为什么必须有这个（补的是关联链的另一半）：
 *   市场原来只显示「价格 / 库存 / 买入」。玩家看着一堆原料，
 *   **完全不知道该买什么** ——「看到绿色就囤」的教学因此落不了地，
 *   因为囤来的料能做什么，不翻研发树是不知道的。
 *   而研发树里的原料又是纯文本点不了 → 这条链两头都断。
 *
 * ★ 三种状态要分清（混在一起会让玩家误判）：
 *   已解锁且本地能做→ 直接可做，显示「每杯耗 N」
 *   已解锁但城市不对→ 显示原因（换个城市才能做）
 *   未解锁          → 显示「研发需 N 个」（这是**未来的需求**，也值得囤）
 *
 * ★ 默认只展开前 2 条：32 种原料 × 十几道菜，全列出来市场会长到没法看。
 *   更多用「+N」按钮展开（UI.expandUses）。
 *
 * @param {object} s 状态
 * @param {object} g 原料
 * @returns {string} HTML
 */
function marketIngUsesHtml(s, g) {
  const uses = recipesUsingIng(g.id);
  if (!uses.length) {
    return `<div class="ing-uses none">暂无可用配方</div>`;
  }
  const cid = currentCityId(s);
  const have = Math.round(num(s.inv[g.id], 0));

  /* 状态分类 */
  const ready = [], away = [], locked = [];
  for (const u of uses) {
    if (!s.recipes.includes(u.rid)) { locked.push(u); continue; }
    if (u.city && u.city !== cid) { away.push(u); continue; }
    ready.push(u);
  }

  /* 一行小徽章的文案 */
  const one = (u, kind) => {
    if (kind === 'ready') {
      return `<button class="ing-use ok" data-act="inguse" data-rid="${u.rid}"
        title="查看配方">${u.emoji}${esc(u.name)}
        <b>每杯${u.perCup || '-'}</b></button>`;
    }
    if (kind === 'away') {
      const cn = (cityById(u.city) || {}).name || '其他城市';
      return `<span class="ing-use away" title="本地专属菜，需切换经营城市">${u.emoji}${esc(u.name)}
        <i>${esc(cn)}</i></span>`;
    }
    return `<span class="ing-use lock" title="尚未解锁该配方">${u.emoji}${esc(u.name)}
      ${u.rschFor ? `<i>研发需${u.rschFor}</i>` : ''}</span>`;
  };

  const chips = [...ready.map(u => one(u, 'ready')),
    ...away.map(u => one(u, 'away')),
    ...locked.map(u => one(u, 'lock'))];

  /* ★ 库存够不够做一杯：一杯都做不出时给红色提示 ——
     这是玩家最容易踩的坑（囤了一堆结果做不出来）。 */
  const canMakeAny = ready.some(u => have >= u.perCup);
  let warn = '';
  if (ready.length && !canMakeAny) {
    const need = Math.min.apply(null, ready.map(u => u.perCup));
    warn = `<span class="ing-warn">库存不够做一杯（至少需 ${need}）</span>`;
  }

  const EXPAND_N = 2;
  const expanded = UI.expandUses && UI.expandUses[g.id];
  const showN = expanded ? chips.length : Math.min(EXPAND_N, chips.length);
  const more = chips.length > showN
    ? `<button class="ing-more" data-act="ingexpand" data-id="${g.id}">+${
      chips.length - showN}${expanded ? ' 收起' : ''}</button>`
    : '';

  return `<div class="ing-uses">
    <div class="ing-uses-t">能做 <b>${ready.length}</b> 道${
      locked.length ? ` · <i>研发中 ${locked.length}</i>` : ''}${warn}</div>
    <div class="ing-use-list">${chips.slice(0, showN).join('')}${more}</div>
  </div>`;
}

/**
 * 研发树的分组导航条（V17）
 *
 * ★ 为什么需要它：
 *   折叠解决了「默认不铺开」，但引入了一个新问题 ——
 *   玩家想看「杭州有哪几道菜」时，得先在 16 行里找到那行、点开它。
 *   折叠把「长页面」换成了「多点几次」，那不算真的优化。
 *   ★ 所以配一条**常驻的锚点导航**：一眼看到所有分组、
 *     点一下就跳过去。16 个城市缩成一排横向标签。
 *
 * ★ 横向滚动是**导航条内部**的，不是页面的：
 *   `overflow-x: auto` 限在导航条自己身上，
 *   页面主体不横��� —— 窄屏下主体横滚是明确的 bug，
 *   而导航条横滚是常见的移动端模式（分段控件就是这么做的）。
 *   ★ 这点要在 CSS 里写清楚，否则后来者可能误改。
 *
 * @returns {string} HTML
 */
function labFoldNavHtml(s) {
  const tree = researchTree(s);
  if (tree.length <= 1) return '';
  const chips = [];
  for (const g of tree) {
    const isAch = g.cityName.indexOf('成就') >= 0;
    const key = isAch ? 'ach' : (g.city ? ('c' + g.city) : 'univ');
    const folded = UI.collapsed && UI.collapsed[key];
    /* ★ 本店 / 通用 / 成就 用高亮色，非本店用暗色 ——
       玩家一眼知道哪些现在能点，哪些要先换城市。 */
    const cls = g.isHere || !g.city || isAch ? 'here' : 'away';
    const label = isAch ? '🏅 成就' : (!g.city ? '🌐 通用' : g.cityName.replace(/市$/, ''));
    chips.push(`<button type="button" class="navchip ${cls}${folded ? ' fold' : ''}"
      data-act="foldtree" data-id="${key}"
      aria-expanded="${folded ? 'false' : 'true'}"
      title="${esc(g.cityName)}：${g.nodes.length} 道${folded ? '（点击展开）' : ''}">${esc(label)}</button>`);
  }
  /* ★ V18：nav 用 tablist 语义（role 在 div 上）+ 每个 chip 标role=tab */
  return `<div class="labnav">
    <div class="labnav-in" role="tablist" aria-label="研发树分组">${chips.join('')}</div>
  </div>`;
}

function cityBarHtml(s) {
  const cid = currentCityId(s);
  const city = cityById(cid);
  const local = cuisinesOfCity(cid);
  const localIngs = ingsOfCity(cid);
  const avail = availableCuisineIds(s);
  const prov = provinceById((s.venue || {}).provId);
  /* 区级名称走 venueView —— 它已经处理了"没收录区级"的情况（返回空串），
     直接查 districtsOfCity 要多写一遍同样的兜底。 */
  const dist = venueView(s).districtName || '';
  return `<div class="citybar">
    <div class="citybar-main">
      <span class="citybar-emoji">📍</span>
      <div class="citybar-txt">
        <div class="citybar-city">${esc(city ? city.name : cid)}${
    prov ? `<span class="citybar-prov">· ${esc(prov.name)}</span>` : ''}${
    dist ? `<span class="citybar-dist">${esc(dist)}</span>` : ''}</div>
        <div class="citybar-sub">本店可用菜系 <b>${avail.length}</b> 个${
    local.length ? ` · 本地特色：${esc(local.map(c => c.emoji + c.name).join('、'))}` : ' · 本地暂无特色菜系'}</div>
      </div>
    </div>
    ${localIngs.length ? `<div class="citybar-ings">${localIngs.map(g =>
      `<span class="ing-chip">${g.emoji}${esc(g.name)}</span>`).join('')}</div>` : ''}
    <div class="citybar-hint">💡 在「🏙️ 经营信息」里切换城市可研发当地特色菜；已解锁的异地配方会保留，回来还能卖</div>
  </div>`;
}

/** 单个研发树节点卡片 */
function recipeNodeCardHtml(s, n) {
  const r = recipeById(n.recipe);
  if (!r) return '';
  const owned = n.done;
  const isAch = !!r.ach;
  const cls = owned ? 'on' : (n.status === 'open' ? '' : 'locked');
  let needHtml = '';
  if (!owned && r.research) {
    const parts = [];
    for (const k in r.research.ing) {
      const g = ingById(k);
      const need = r.research.ing[k];
      const has = Math.round(s.inv[k] || 0);
      /* ★ V16：原料从**纯文本**变成可点 —— 这是关联链的另一半。
         玩家在研发页看到「🍵3(5)」缺料时，最直接的动作就是「去市场买」，
         让他自己切页再找原料是多餘的动作。
         ★ 缺料时仍然可点（红字但可点）—— 红是提示，不是禁用。 */
      parts.push(`<button class="ing-link${has < need ? ' short' : ''}"
        data-act="toing" data-id="${esc(k)}"
        title="${esc(g.name)}：${has >= need ? '库存充足' : `还差 ${need - has} 个`}（点击去市场）">
        ${g.emoji}${need}<span style="color:${
          has >= need ? 'var(--green)' : 'var(--red)'}">(${has})</span></button>`);
    }
    needHtml = parts.join(' ');
  }
  const canR = (owned || isAch) ? { ok: false, msg: isAch ? '仅通过成就获得' : '' } : canResearch(s, n.recipe);
  const cu = cuisineById(r.cuisine);
  const ownCity = r.city ? (cityById(r.city) || {}).name : '';
  let tip = '';
  if (!owned && !isAch) {
    if (n.status === 'away') tip = `🗺️ 需切换到${esc(ownCity)}才能研发`;
    else if (n.status === 'locked' && n.lockMsg) tip = esc(n.lockMsg);
    else if (!canR.ok && canR.msg) tip = esc(canR.msg);
  }
  return `<div class="rc ${cls}${isAch ? ' ach' : ''}" data-rid="${esc(n.recipe)}">
    <div class="rc-h"><span class="rc-e">${r.emoji}</span><span>${esc(r.name)}</span></div>
    <div class="rc-m">${esc(r.desc)}</div>
    <div class="rc-m">人气 ${r.pop} · 售价 ¥${r.price} · 成本约 ¥${costOf(s, n.recipe).toFixed(1)}</div>
    <div class="rc-tags">
      ${cu ? `<span class="rc-tag cui">${cu.emoji}${esc(cu.name)}</span>` : ''}
      ${r.tags.map(t => `<span class="rc-tag">${TAGS[t].emoji}${TAGS[t].name}</span>`).join('')}
    </div>
    ${owned ? `<div style="margin-top:7px;font-size:var(--fs-md);font-weight:800;color:var(--cyan)">✅ 已解锁</div>
           ${recipePerCupHtml(s, n.recipe)}`
      : isAch ? `<div class="rc-tip">🏅 成就专属 · 不可研发</div>`
        : `${r.city ? `<div class="rc-tip">📍 仅限${esc(ownCity)}</div>` : ''}
           <div style="margin-top:7px;font-size:var(--fs-sm);color:var(--txt3)">需要 ${needHtml}</div>
           <button class="btn btn-sm ${canR.ok ? 'btn-primary' : 'btn-ghost'}" style="width:100%;margin-top:6px"
             data-act="research" data-id="${n.recipe}" ${canR.ok ? '' : 'disabled'}>研发 ${money(n.cost)}</button>
           ${tip ? `<div class="rc-tip">${tip}</div>` : ''}`}
  </div>`;
}

  /* ---- 挂到全局（保持原有调用方式不变）---- */
  global.sigCardHtml = sigCardHtml;
  global.sigRowHtml = sigRowHtml;
  global.recipePerCupHtml = recipePerCupHtml;
  global.marketIngUsesHtml = marketIngUsesHtml;
  global.labFoldNavHtml = labFoldNavHtml;
  global.cityBarHtml = cityBarHtml;
  global.recipeNodeCardHtml = recipeNodeCardHtml;

})(typeof window !== 'undefined' ? window : globalThis);
