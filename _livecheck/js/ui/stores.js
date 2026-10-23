/* ============================================================
 *  商圈店铺与城市地图（V20.2 · 从 ui.js 拆出）
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

/** 店铺地图面板（V12）
 *
 *  ★ 为什么叫「地图」但不画地图：
 *    现有「经营信息」面板已定调「不内嵌地图 SDK」（静态托管的离线包
 *    拉不到瓦片，空白区比没有地图更糟）。这里沿用同一原则 ——
 *    用「城市选择 + 场地类型」来定位，位置取自城市表自带的 GCJ-02 坐标。
 *    340+ 城市可选，等于"任意位置"。
 *
 *  ★ 面板承担四件事（需求 4）：
 *    ① 开店流程：选城市 / 场地 / 店名 → 确认
 *    ② 店铺列表与切换入口：每店一卡，显示状态
 *    ③ 店长任命 / 更换 / 撤下
 *    ④ 店铺信息与收益：现金、累计营收、支出、出杯、等级、最近报表
 */
function storesPanelHtml(s) {
  const stores = allStores(s);
  const main = mainStore(s);
  let h = `<div class="card"><div class="card-h">🗺️ 店铺地图
    <span class="ch-sub">${stores.length} 家店 · ${managerCount(s)} 名店长</span></div>`;

  h += `<div style="font-size:var(--fs-md);color:var(--txt3);line-height:1.6;margin-bottom:10px">
    开设分店需支付 <b>${money(shopCost(s) || 0)}</b>（可开 ${Math.max(0, (SHOP_COSTS.length || 0) + 1 - stores.length)} 家）。
    店铺拥有<b>独立的资金、库存与经营数据</b>；指派店长后该店可交给店长自动打理，
    未指派店长的店由你亲自经营。</div>`;

  /* ---------- 店铺列表 ---------- */
  for (const st of stores) {
    const mg = storeManager(s, st);
    const isMain = st.isMain;
    const rpt = st.lastReport;
    const staffN = staffOfBranch(s, st.branch).length;
    h += `<div class="store-card${st.auto ? ' auto' : ''}${isMain ? ' main' : ''}">
      <div class="store-head">
        <span class="store-e">${esc(st.emoji)}</span>
        <div class="store-title">
          <div class="store-name">${esc(st.name)}
            ${isMain ? '<span class="store-badge main">⭐ 主店</span>' : ''}
            <span class="store-badge">Lv.${st.level}</span>
          </div>
          <div class="store-sub">📍${esc((cityById(st.cityId) || {}).name || st.cityId)}
            · ${esc((VENUE_TYPES.find(t => t.id === st.venueType) || {}).name || st.venueType)}
            · 编制 ${staffN}/${branchStaffCap(s, st.branch)}</div>
        </div>
        <div class="store-mode">${st.auto
      ? '<span class="store-badge auto">🤖 托管中</span>'
      : '<span class="store-badge play">✋ 亲自经营</span>'}</div>
      </div>

      <div class="store-grid">
        <div class="store-kv"><span>店铺现金</span><b>${money(st.cash)}</b></div>
        <div class="store-kv"><span>累计营收</span><b class="up">${money(st.income)}</b></div>
        <div class="store-kv"><span>累计支出</span><b class="down">${money(st.expense)}</b></div>
        <div class="store-kv"><span>累计出杯</span><b>${st.cups}</b></div>
      </div>

      <div class="store-mgr">
        ${mg
      ? `店长：<b>${esc(mg.emoji)} ${esc(mg.name)}</b>
             <span class="store-mgr-lv">Lv.${mg.lv} ${esc(managerRank(mg.lv).name)}</span>
             <span class="store-mgr-tr">${managerTrait(mg).emoji} ${esc(managerTrait(mg).name)}</span>
             <span class="store-mgr-w">日薪 ${money(mg.wage)}</span>`
      : '<span class="store-none">未指派店长（由你亲自经营）</span>'}
      </div>

      ${rpt ? `<div class="store-rpt">${st.auto
        ? `昨日：${rpt.empty
          ? '空店（无员工），仅扣固定开支'
          : `客流 ${rpt.traffic} · 出杯 ${rpt.cups} · 营收 ${money(rpt.revenue)} · 净利 <b class="${rpt.net >= 0 ? 'up' : 'down'}">${money(rpt.net)}</b>`}`
        : `本店累计净利 <b class="${st.income - st.expense >= 0 ? 'up' : 'down'}">${money(st.income - st.expense)}</b>`}</div>` : ''}

      <div class="store-acts">
        ${mg
        ? `<button class="btn btn-xs" data-act="stoggle" data-b="${st.branch}" data-auto="${st.auto ? 0 : 1}">
             ${st.auto ? '✋ 我来接管' : '🤖 交给店长'}</button>
           <button class="btn btn-xs" data-act="smgrfire" data-b="${st.branch}">撤下店长</button>`
        : `<button class="btn btn-xs btn-primary" data-act="smgrh" data-b="${st.branch}">🎩 任命店长</button>`}
        ${!isMain ? `<button class="btn btn-xs" data-act="smain" data-b="${st.branch}">设为主店</button>` : ''}
        <button class="btn btn-xs" data-act="sfund" data-b="${st.branch}">💰 注资</button>
        <button class="btn btn-xs" data-act="sdraw" data-b="${st.branch}">💵 提现</button>
        <button class="btn btn-xs" data-act="srename" data-b="${st.branch}">✏️ 改名</button>
        ${!isMain ? `<button class="btn btn-xs btn-danger" data-act="sclose" data-b="${st.branch}">🏚️ 关店</button>` : ''}
      </div>

      ${storeUpgradeHtml(s, st)}
      ${!mg ? storeFormerHtml(s, st) : ''}
    </div>`;
  }

  /* ---------- 开店入口 ---------- */
  const cost = shopCost(s);
  h += `<div style="margin-top:10px">
    <button class="btn btn-cyan" style="width:100%" data-act="sopen" ${cost == null ? 'disabled' : ''}>
      ${cost == null ? '已达分店上限' : '🗺️ 开设新店 · ' + money(cost)}</button>
  </div></div>`;
  return h;
}

/** 店铺级升级区（V12.1）
 *
 * ★ 折叠默认收起：4 个升级项 × 每店一张卡 = 页面会很长。
 *   默认只显示一行「🏗️ 店铺升级 Lv.x」，点开才展开明细 ——
 *   玩家需要时能找到，但不主动占版面。
 */
function storeUpgradeHtml(s, store) {
  const ups = STORE_UPGRADES;
  const anyBought = ups.some(u => storeUpLevel(s, store, u.id) > 0);
  const totalLv = ups.reduce((a, u) => a + storeUpLevel(s, store, u.id), 0);
  /* ★ V17 修 bug：这个折叠箭头**以前点了没反应**。
     排查方式是把 UI 里所有 data-act 与 main.js 的 case 做差集：
       `stoggleup` 是唯一真正没有处理分支的按钮
       （mkt/ratio/scity/vcity/vprov 走的是 change/input 事件，不是死按钮）。
     ★ 根因：只画了箭头与折叠样式，但没有「收起时隐藏列表」的逻辑，
       也没有 case 分支 —— 属于**做了一半的功能**。
     ★ 现在补上：展开态存 UI.storeUpOpen（按门店号），
       已有投入时默认展开（玩家刚买了东西，得看得见），
       没投入时默认收起（不然每家店都摊开一长串，占满商圈页）。 */
  const open = UI.storeUpOpen
    ? (UI.storeUpOpen[store.branch] !== undefined
      ? !!UI.storeUpOpen[store.branch] : anyBought)
    : anyBought;
  let h = `<div class="store-up${open ? ' open' : ''}"
    data-act="stoggleup" data-b="${store.branch}">
    <span class="store-up-t">🏗️ 店铺升级</span>
    <span class="store-up-s">${anyBought ? `已投入 ${totalLv} 级` : '未升级'}</span>
    <span class="store-up-arrow">${open ? '▾' : '›'}</span>
  </div>`;
  /* ★ 收起时**不渲染列表** —— 靠 CSS 隐藏不够（DOM 还在，仍可被 tab 聚焦到） */
  if (!open) return h;
  h += `<div class="store-up-list">`;
  for (const u of ups) {
    const lv = storeUpLevel(s, store, u.id);
    const cost = storeUpCost(s, store, u.id);
    h += `<div class="store-up-row">
      <span class="store-up-e">${u.emoji}</span>
      <div class="store-up-info">
        <div class="store-up-n">${esc(u.name)} <span class="store-up-lv">Lv.${lv}/${u.max}</span></div>
        <div class="store-up-d">${esc(u.detail ? u.detail(lv) : u.desc)}</div>
      </div>
      ${cost == null
      ? '<span class="store-up-max">已满级</span>'
      : `<button class="btn btn-xs" data-act="stbuy" data-b="${store.branch}" data-id="${u.id}"
           ${s.cash >= cost ? '' : 'disabled'}>${money(cost)}</button>`}
    </div>`;
  }
  h += `</div>`;
  return h;
}

/** 待聘店长区（V12.1）：关过店的店长留档，可免费请回 */
function storeFormerHtml(s, store) {
  const fm = (s.formerManagers || []).filter(f => f && f.name);
  if (!fm.length) return '';
  let h = `<div class="store-former"><div class="store-former-t">📋 待聘店长（关店留档，可免费请回）</div>`;
  for (const f of fm) {
    const tr = managerTrait({ trait: f.trait });
    h += `<div class="store-up-row">
      <span class="store-up-e">${esc(f.emoji)}</span>
      <div class="store-up-info">
        <div class="store-up-n">${esc(f.name)}
          <span class="store-up-lv">Lv.${f.lv} ${esc(managerRank(f.lv).name)}</span></div>
        <div class="store-up-d">${tr.emoji} ${esc(tr.name)} · 原任职于「${esc(f.fromStore || '已关闭店铺')}」</div>
      </div>
      <button class="btn btn-xs btn-primary" data-act="smgrre" data-b="${store.branch}" data-id="${f.id}">请回</button>
    </div>`;
  }
  h += `</div>`;
  return h;
}

/** 店长候选列表（任命用） */
function storeCandidatesHtml(s, branch) {
  const cands = (s.mgrCand && s.mgrCand[branch]) || [];
  if (!cands.length) {
    return `<div style="font-size:11.5px;color:var(--txt3);padding:8px 0">
      暂无候选人（次日刷新，或在经营页用「刷新」付费重抽）</div>`;
  }
  const fee = managerCost(s);   /* ★ managerCost 是**全局**费用（按已招店长数递增），不按门店 */
  let h = `<div style="font-size:11.5px;color:var(--txt3);margin-bottom:8px">
    任命费用 ${money(fee)} · 每家店至多一名店长</div>`;
  for (let i = 0; i < cands.length; i++) {
    h += managerCandidateHtml(cands[i], i, branch, fee, s.cash >= fee, 'smgrpick', '任命');
  }
  return h;
}

/**
 * 店长候选人卡片（V13.8 抽取）
 *
 * ★ 为什么要抽：
 *   这段卡片原本在两处**几乎完全重复**（V11 招店长弹窗 + V12 管理页编制区），
 *   18 行一样、只差缩进。check-dup.js 扫出来的第一处。
 *   两份拷贝的真实风险不是"多写了些"，而是**将来改一处漏一处** ——
 *   比如给候选人加上专精提示，改了弹窗忘了改管理页，
 *   玩家会看到"同一个候选人在两个页面显示不同"。
 *
 * ★ 两处原本有**两处真实差异**（所以要参数化，不能强行统一）：
 *   ① data-act不同：smgrpick（弹窗里挑）vs mhire（管理页招募）
 *   ② 按钮文案不同：「任命」vs「招募」
 *   —— 它们是两个不同的 action，接的是 main.js 里两个分支，
 *   强行合并会破坏「同一个候选人在两处行为一致」的预期。
 *
 * @param {object} c        候选人
 * @param {number} idx      在候选数组里的下标（用于 data-i）
 * @param {number} branch   所属分店号
 * @param {number} fee      当前任命费用
 * @param {boolean} afford  是否付得起（付不起时按钮禁用）
 * @param {string} act      data-act 值（smgrpick / mhire）
 * @param {string} label    按钮文案
 */
function managerCandidateHtml(c, idx, branch, fee, afford, act, label) {
  const tr = managerTrait(c);
  return `<div class="mgr-cand">
      <div class="mgr-row">
        <span class="mgr-e">${esc(c.emoji)}</span>
        <div class="mgr-info">
          <div class="mgr-name">${esc(c.name)}<span class="mgr-lv">Lv.${c.lv} ${esc(managerRank(c.lv).name)}</span></div>
          <div class="mgr-trait">${tr.emoji} ${esc(tr.name)} · ${esc(tr.desc)}</div>
        </div>
        <div class="mgr-cost">
          <div>日薪 ${money(c.wage)}</div>
          <div class="mgr-skill">能力 ${Number(c.skill).toFixed(2)}</div>
        </div>
      </div>
      <button class="btn btn-sm btn-primary" style="width:100%;margin-top:6px"
        data-act="${act}" ${act === 'mhire' ? `data-br="${branch}"` : `data-b="${branch}"`} data-i="${idx}"
        ${afford ? '' : 'disabled'}>${label} · ${money(fee)}</button>
    </div>`;
}

/** 开店流程弹窗内容 */
function openStoreModalHtml(s) {
  const v = s.venue || {};
  const provId = v.provId || '11';
  const cityId = v.cityId || '110100';
  const cities = citiesOfProvince(provId);
  const provOpts = PROVINCES.map(p =>
    `<option value="${p.id}" ${p.id === provId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const cityOpts = cities.map(c =>
    `<option value="${c.id}" ${c.id === cityId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const venueBtns = VENUE_TYPES.map(t =>
    `<button class="vtype ${t.id === VENUE_DEFAULT ? 'on' : ''}" data-act="svenue" data-id="${t.id}"
      title="${esc(t.desc)}"><span class="vt-e">${t.emoji}</span><span class="vt-n">${esc(t.name)}</span></button>`).join('');
  const cost = shopCost(s);
  return `<div class="m-title">🗺️ 开设新店</div>
    <div class="m-sub">开店费 ${money(cost || 0)} · 开店后立刻可以任命店长</div>
    <div style="margin:12px 0">
      <div class="vlabel">所在城市<span class="vhint">位置自动取该城市坐标（GCJ-02）</span></div>
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <select id="sProv" class="vsel" data-act="sprov" style="flex:1">
          ${provOpts}
        </select>
        <select id="sCity" class="vsel" data-act="scity" style="flex:1">
          ${cityOpts}
        </select>
      </div>
      <div class="vlabel">场地类型</div>
      <div class="vgrid">${venueBtns}</div>
      <div class="vlabel">店名<span class="vhint">留空则自动命名</span></div>
      <input id="sName" class="vinp" maxlength="16" placeholder="例如：成都旗舰店" />
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn-ghost" style="flex:1" data-act="modal-close">取消</button>
      <button class="btn btn-primary" style="flex:2" data-act="sopenok"
        ${cost == null ? 'disabled' : ''}>确认开店 · ${money(cost || 0)}</button>
    </div>`;
}

/** 城市地图面板（V13·H5 端）
 *
 *  ★ 布局：地图本体 + 右侧/下方的省份信息列表。
 *    地图用 SVG 画散点（按经纬度归一化后的坐标），
 *    当前经营城市高亮并放大，可点击直接切换经营城市。
 *
 *  ★ 地图只画 44 个**有精确坐标**的城市（见 engine.cityMapView 的说明），
 *    但省份信息是完整的 34 个 —— 玩家从地图上能看���全貌，
 *    没有坐标的城市仍可从省份列表进入（列表里有城市按钮）。
 */
function cityMapPanelHtml(s) {
  /* ★ V13.1：商圈页只留**入口条**，完整地图进弹窗。
     实测：地图卡 3633 字占 rival 页 64%，而核心的「竞争对手」只有 269 字 ——
     辅助信息比核心信息重 13.5 倍，层级完全倒了。
     改成入口条后，商圈页回归「主功能在前」的层级。
     ★ 同时与 Canvas 端形态统一（那边本来就是入口条 + 弹窗），
       两版交互一致，玩家跨端不用重新学。 */
  const mv = cityMapView(s);
  return `<div class="card"><div class="card-h">🗺️ 城市地图
      <span class="ch-sub">${mv.geoTotal} 城 · ${mv.cityTotal} 市 · ${mv.provs.length} 省</span></div>
    <div class="map-bar">
      <div class="map-bar-info">
        <div class="map-bar-cur">📍 ${esc(mv.currentCityName)}</div>
        <div class="map-bar-sub">点城市看详情，可切换经营城市</div>
      </div>
      <button class="btn btn-sm btn-primary" data-act="mapopen">🗺️ 打开地图</button>
    </div>
  </div>`;
}

/** 城市地图弹窗内容（V13.1）：完整地图 + 省份概览 + 城市选择入口 */
function cityMapModalHtml(s) {
  const mv = cityMapView(s);
  const W = 320, H = 240;      /* viewBox 尺寸（会等比缩放到容器宽） */
  const pad = 16;
  const px = x => pad + x * (W - pad * 2);
  const py = y => pad + y * (H - pad * 2);

  /* --- 城市点 --- */
  let dots = '';
  for (const p of mv.points) {
    const cx = px(p.x), cy = py(p.y);
    const r = p.isCurrent ? 7 : 4.5;
    const cls = p.isCurrent ? 'map-dot cur' : 'map-dot';
    const dish = p.hasCuisine ? '🍜' : '';
    dots += `<g class="${cls}" data-act="mapcity" data-id="${p.id}" tabindex="0"
      role="button" aria-label="${esc(p.name)}">
      <title>${esc(p.name)}（${esc(p.provName)}）${p.hasCuisine ? ' · 有本地特色' : ''}</title>
      ${p.isCurrent ? `<circle class="map-halo" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="11"/>` : ''}
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}"/>
      ${dish ? `<text class="map-dish" x="${cx.toFixed(1)}" y="${(cy - 8).toFixed(1)}" text-anchor="middle" aria-hidden="true">${dish}</text>` : ''}
    </g>`;
  }

  /* --- 当前城市信息卡 --- */
  const cur = cityById(mv.currentCityId);
  const curCuis = cur ? hasCityCuisine(cur) : null;
  const curProv = cur ? provinceById(cur.prov) : null;
  let info = '';
  if (cur) {
    const cuList = curCuis ? cuisinesOfCity(cur.id) : [];
    info = `<div class="map-info">
      <div class="map-info-n">📍 ${esc(cur.name)}${curProv ? ' · ' + esc(curProv.name) : ''}</div>
      <div class="map-info-s">${cuList.length
      ? '本地特色：' + cuList.map(id => {
        const c = cuisineById(id);
        return c ? c.emoji + c.name : id;
      }).join('、')
      : '该城市暂无本地特色菜系（走通用菜系）'}</div>
      <div class="map-info-a">
        <button class="btn btn-xs" data-act="mapcitylist" data-id="${cur.id}">查看详情</button>
        <button class="btn btn-xs btn-primary" data-act="mapgoto">🗺️ 切换城市</button>
      </div>
    </div>`;
  }

  /* --- 省份列表 --- */
  let provList = '';
  for (const p of mv.provs) {
    const cu = p.geoCount > 0;
    provList += `<div class="map-prov${p.isCurrent ? ' cur' : ''}">
      <span class="map-prov-n">${esc(p.name)}</span>
      <span class="map-prov-s">${p.cityCount} 市${cu ? '' : '（无精确坐标）'}</span>
    </div>`;
  }

  return `<div class="m-title">🗺️ 城市地图</div>
    <div class="m-sub">${mv.geoTotal} 个有精确坐标 · ${mv.cityTotal} 市 · ${mv.provs.length} 省</div>
    <div class="map-wrap">
      <svg class="map-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"
        role="group" aria-label="全国城市分布地图">
        <rect class="map-bg" x="0" y="0" width="${W}" height="${H}" rx="12"/>
        <line class="map-grid" x1="${W / 2}" y1="0" x2="${W / 2}" y2="${H}"/>
        <line class="map-grid" x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}"/>
        ${dots}
      </svg>
    </div>
    ${info}
    <div class="map-legend">
      <span><i class="map-lg cur"></i>当前经营城市</span>
      <span><i class="map-lg"></i>可切换城市</span>
      <span><i class="map-lg dish"></i>有本地特色菜系</span>
    </div>
    <div class="map-provs">${provList}</div>
    <div style="margin-top:10px">
      <button class="btn btn-cyan" style="width:100%" data-act="mapgoto">🗺️ 切换经营城市（全 ${mv.cityTotal} 市）</button>
    </div>`;
}

/** 城市选择器弹窗（V13）
 *
 *  ★ 为什么地图之外还要这个列表：
 *    地图只画 44 个**有精确坐标**的城市，而 272 个市都能经营。
 *    只给地图当入口，玩家会以为"只能在这 44 个城市里选"——
 *    而实际上去成都、拉萨、三亚都能开。
 *    所以地图是"可视化入口"，列表才是"完整入口"。
 *
 *  ★ 按省份分组：272 个市平铺要找很久，
 *    分组后即使不知道在哪个省，也能顺着省名找。
 */
function cityPickerModalHtml(s) {
  const cur = (s.venue && s.venue.cityId) || '';
  let h = `<div class="m-title">🗺️ 选择经营城市</div>
    <div class="m-sub">${PROVINCES.length} 省 · ${PROVINCES.reduce((a, p) => a + p.cities.length, 0)} 个市</div>
    <div class="cp-list">`;
  /* ★ V13.1（P2-1）：**当前省份排最前**。
     272 个市按省序平铺，找到目标城市要滚很久；
     而大多数时候玩家就是想「在当前省换个市」或「看看邻省」——
     把当前省提到最前，省下的滚动是实打实的。 */
  const curProv = (s.venue && s.venue.provId) || '';
  const provOrder = PROVINCES.slice().sort((a, b) => {
    if (a.id === curProv) return -1;
    if (b.id === curProv) return 1;
    return 0;
  });
  for (const p of provOrder) {
    h += `<div class="cp-prov">${esc(p.name)}</div><div class="cp-cities">`;
    for (const cid of p.cities) {
      const c = cityById(cid);
      if (!c) continue;
      const cu = hasCityCuisine(c);
      /* ★ P2-4：🍜 是纯装饰标记（"该城市有本地特色"），
         但屏幕阅读器会把它读出来 —— 加 aria-hidden 让它只对眼睛可见。 */
      h += `<button class="cp-city${cid === cur ? ' cur' : ''}" data-act="mappick" data-id="${cid}">
        ${esc(c.name)}${cu ? '<i aria-hidden="true">🍜</i>' : ''}</button>`;
    }
    h += `</div>`;
  }
  h += `</div>`;
  return h;
}

/** 城市详情弹窗内容 */
function cityDetailModalHtml(s, cityId) {
  const c = cityById(cityId);
  if (!c) return '<div class="m-title">城市不存在</div>';
  const p = provinceById(c.prov);
  const g = cityGeoOf(cityId);
  const cu = cuisinesOfCity(cityId);
  const ings = ingsOfCity(cityId);
  const cur = (s.venue && s.venue.cityId) === cityId;
  return `<div class="m-title">📍 ${esc(c.name)}</div>
    <div class="m-sub">${p ? esc(p.name) : ''}${g ? ` · ${g.lng.toFixed(2)}E ${g.lat.toFixed(2)}N（${GEO.COORD_SYS}）` : ' · 暂无精确坐标'}</div>
    <div style="margin:12px 0;font-size:var(--fs-md);line-height:1.8;color:var(--txt2)">
      <div>本地菜系：${cu.length ? cu.map(id => {
    const cc = cuisineById(id);
    return cc ? cc.emoji + cc.name : id;
  }).join('、') : '<span style="color:var(--txt3)">暂无（走通用菜系）</span>'}</div>
      <div>本地原料：${ings.length ? ings.map(x => x.emoji + x.name).join('、') : '<span style="color:var(--txt3)">暂无</span>'}</div>
      <div>区级：${districtsOfCity(cityId).length ? '已收录' : '未收录（可选到市级）'}</div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-ghost" style="flex:1" data-act="modal-close">关闭</button>
      ${cur ? '<button class="btn btn-primary" style="flex:1" disabled>当前经营城市</button>'
      : `<button class="btn btn-primary" style="flex:1" data-act="mapset" data-id="${cityId}">设为经营城市</button>`}
    </div>`;
}

  /* ---- 挂到全局（保持原有调用方式不变）---- */
  global.storesPanelHtml = storesPanelHtml;
  global.storeUpgradeHtml = storeUpgradeHtml;
  global.storeFormerHtml = storeFormerHtml;
  global.storeCandidatesHtml = storeCandidatesHtml;
  global.managerCandidateHtml = managerCandidateHtml;
  global.openStoreModalHtml = openStoreModalHtml;
  global.cityMapPanelHtml = cityMapPanelHtml;
  global.cityMapModalHtml = cityMapModalHtml;
  global.cityPickerModalHtml = cityPickerModalHtml;
  global.cityDetailModalHtml = cityDetailModalHtml;

})(typeof window !== 'undefined' ? window : globalThis);
