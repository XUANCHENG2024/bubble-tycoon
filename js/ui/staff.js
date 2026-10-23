/* ============================================================
 *  员工 / 店长 / 专精（V20.2 · 从 ui.js 拆出）
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

/** 店长与分店编制面板（V11）
 *
 *  ★ 面板放在「原料市场」之后 —— 它是"人事管理"，比"进物料"更靠后，
 *    但仍留在管理页而不是升级页：玩家招完人往往会顺便看一眼编制。
 *
 *  ★ 必须同时展示**总店**的编制：
 *    店长只管分店，玩家很容易忘总店也要人。
 *    只列分店会出现"店长都满了，总店一个人也没有"的荒谬局面。
 */
/**
 * 常客名册（V13.6）
 *
 * ★ 借鉴开罗《创意咖啡厅物语》的「常客度」——
 *   顾客满意度累积到常客度满 100 后，消费预算与出手都会变大。
 *   本作把它做成**个体**：每位熟客有脸、有名字、有好感条。
 *
 * ★ 为什么要让它可见：
 *   常客的加成是「个体层」的（不同于全局口碑），
 *   如果玩家看不到好感条，就不知道服务好有什么用、
 *   也感受不到"这个老顾客越来越爱来了"的进展。
 */
function regularPanelHtml(s) {
  const rv = regularView(s);
  if (!rv.known) {
    return `<div class="card"><div class="card-h">💝 熟客名册
        <span class="ch-sub">还没人认识</span></div>
      <div style="font-size:var(--fs-md);color:var(--txt3);line-height:1.7">
        每天把客人<b>服务好</b>，他们会记住你的店 ——
        好感攒满就会变成<b>常客</b>：出手更阔绰、常来光顾。</div></div>`;
  }
  /* 只显示好感最高的若干位 —— 名册可能有 100 位，全列太长 */
  const top = rv.list.slice(0, 12);
  let h = `<div class="card"><div class="card-h">💝 熟客名册
      <span class="ch-sub">${rv.regulars} 位常客 / 认识 ${rv.known} 位</span></div>
    <div style="font-size:var(--fs-xs);color:var(--txt3);margin-bottom:7px;line-height:1.6">
      好感满 ${rv.max} 就是<b>常客</b>：消费预算 +${Math.round(REGULAR_CFG.budgetBonus * 100)}%、
      小费 +${Math.round(REGULAR_CFG.tipBonus * 100)}%、更常光顾。</div>
    <div class="reg-list">`;
  for (const r of top) {
    const isReg = r.fav >= rv.max;
    const pct = Math.round((r.fav / rv.max) * 100);
    h += `<div class="reg-item${isReg ? ' reg' : ''}">
      <span class="reg-face">${esc(r.face)}</span>
      <div class="reg-info">
        <div class="reg-name">${esc(r.name)}${isReg ? ' 💝' : ''}</div>
        <div class="reg-bar"><i style="width:${pct}%"></i></div>
      </div>
      <span class="reg-fav">${r.fav}</span>
    </div>`;
  }
  if (rv.known > top.length) {
    h += `<div style="font-size:var(--fs-xs);color:var(--txt3);margin-top:4px">
      还有 ${rv.known - top.length} 位只是脸熟…</div>`;
  }
  h += `</div></div>`;
  return h;
}

/**
 * 店长专精选项（V13.7）
 *
 * ★ 借鉴开罗「技能升级有代价、不能随便换来换去」——
 *   切换专精要损失能力值，否则玩家会无脑试最优解，专精就退化成一次点击。
 */
function specialtyHtml(mg) {
  const cfg = MANAGER_SPECIALTY;
  const can = managerCanSpecialty(window.S, mg);
  if (!can.ok) {
    return `<div class="mgr-spec locked">🎯 专精：${can.why}</div>`;
  }
  const cur = mg.spec;
  let h = `<div class="mgr-spec">
    <div class="mgr-spec-h">🎯 专精${cur ? '（切换要损失能力值）' : ''}</div>
    <div class="mgr-spec-opts">`;
  for (const f of cfg.fields) {
    const on = cur === f.id;
    h += `<button class="mgr-spec-b${on ? ' on' : ''}" data-act="mspec" data-id="${mg.id}" data-spec="${f.id}"
      title="${esc(f.desc)}">${f.emoji} ${esc(f.name)}${on ? ' ✔' : ''}</button>`;
  }
  h += `</div></div>`;
  return h;
}

function managerPanelHtml(s) {
  const shops = Math.max(1, pos(s.shops, 1));
  const left = managerSlotsLeft(s);
  let h = `<div class="card"><div class="card-h">🎩 店长与分店编制
    <span class="ch-sub">${managerCount(s)}/${shops - 1} 名店长${left > 0 ? ` · 还可招 ${left} 名` : ''}</span></div>`;

  if (shops <= 1) {
    h += `<div style="font-size:var(--fs-md);color:var(--txt3);line-height:1.6">
      目前只有总店（你亲自经营），不需要店长。<br>
      在「⬆️ 店铺升级」里开设第一家分店后，就能招募一名店长。</div></div>`;
    return h;
  }
  h += `<div style="font-size:var(--fs-md);color:var(--txt3);margin-bottom:9px;line-height:1.6">
    每开一家<b>分店</b>可招一名店长，店长<b>只管自己那家店</b> ——
    加成（客流 / 出杯速度 / 口碑 / 满意）不作用于总店，也不作用于别的分店。<br>
    店长每天会<b>自动补员</b>到该店编制上限（与你手动招聘<b>共用名额</b>），
    代价是每天都要付他日薪。</div>`;

  /* ★ V13.4：团队组合加成面板（放在招募区之前 ——
     玩家要先知道「凑什么组合」才去招人，否则组合成了不可见的加成）。
     借鉴开罗《创意咖啡厅物语》的「技能搭配」与放置类的「羁绊共鸣」：
     单条数值堆叠没有经营「人」的乐趣，**组合本身才是策略**。 */
  {
    const cv = managerComboView(s);
    const activeN = cv.filter(x => x.active).length;
    h += `<div class="mgr-combos">
      <div class="mgr-combos-h">🧩 团队组合 <span class="ch-sub">${activeN}/${cv.length} 已激活 · 跨店生效</span></div>
      <div class="mgr-combos-sub">店长的<b>特性搭配</b>会形成组合加成，所有分店都受益 —— 招什么人、凑什么组合，是经营「人」的核心决策。</div>`;
    for (const c of cv) {
      const cb = c.combo;
      const mulTxt = Object.keys(cb.mul).map(k => {
        const nm = { speed: '速度', sat: '满意', rep: '口碑', ops: '客流' }[k] || k;
        return nm + ' +' + Math.round((cb.mul[k] - 1) * 100) + '%';
      }).join(' · ');
      h += `<div class="mgr-combo${c.active ? ' on' : ''}">
        <span class="mgr-combo-e">${cb.emoji}</span>
        <div class="mgr-combo-info">
          <div class="mgr-combo-n">${esc(cb.name)}${c.active ? ' ✔ 已激活' : ''}</div>
          <div class="mgr-combo-d">${esc(cb.desc)}</div>
          <div class="mgr-combo-m">${esc(mulTxt)}</div>
          ${c.active ? '' : `<div class="mgr-combo-need">还缺：${c.missing.map(t => {
        const tr = MANAGER_TRAITS.find(x => x.id === t);
        return tr ? tr.emoji + tr.name : t;
      }).join('、')}</div>`}
        </div>
      </div>`;
    }
    h += `</div>`;
  }

  const fee = managerCost(s);
  for (let b = 2; b <= shops; b++) {
    const mg = managerOfBranch(s, b);
    const staffN = staffOfBranch(s, b).length;
    const cap = branchStaffCap(s, b);
    const cands = (s.mgrCand && s.mgrCand[b]) || [];
    h += `<div class="mgr-branch">
      <div class="mgr-bhead">
        <span class="mgr-be">🏪</span>
        <span class="mgr-bn">第 ${b} 分店</span>
        <span class="mgr-bs">编制 ${staffN}/${cap}</span>
        <span class="mgr-bm${mg ? '' : ' none'}">${mg ? `店长 ${esc(mg.emoji)} ${esc(mg.name)}` : '无店长'}</span>
      </div>`;

    if (mg) {
      const tr = managerTrait(mg);
      const mb = managerBonus(s, b);
      const bnds = [];
      for (let d = 2; d <= shops; d++) {
        if (d === b || managerOfBranch(s, d)) continue;
        bnds.push(`<button class="btn btn-xs" data-act="mmove" data-id="${mg.id}" data-to="${d}">调到第 ${d} 店</button>`);
      }
      h += `<div class="mgr-card">
        <div class="mgr-row">
          <span class="mgr-e">${esc(mg.emoji)}</span>
          <div class="mgr-info">
            <div class="mgr-name">${esc(mg.name)}<span class="mgr-lv">Lv.${mg.lv} ${esc(managerRank(mg.lv).name)}</span></div>
            <div class="mgr-trait">${tr.emoji} ${esc(tr.name)} · ${esc(tr.desc)}</div>
          </div>
          <div class="mgr-cost">
            <div>日薪 ${money(mg.wage)}</div>
            <div class="mgr-skill">能力 ${Number(mg.skill).toFixed(2)} · 在任 ${mg.days} 天</div>
          </div>
        </div>
        <div class="mgr-bonus">
          该店加成：客流 +${Math.round((mb.ops - 1) * 100)}% ·
          速度 +${Math.round((mb.speed - 1) * 100)}% ·
          口碑 +${Math.round((mb.rep - 1) * 100)}% ·
          满意 +${Math.round((mb.sat - 1) * 100)}%
        </div>
        ${specialtyHtml(mg)}
        <div class="mgr-acts">
          ${bnds.join(' ')}
          <button class="btn btn-xs btn-danger" data-act="mfire" data-id="${mg.id}">卸任（补偿 ${money(Math.round(mg.wage * 3))}）</button>
        </div>
      </div>`;
    } else if (cands.length) {
      h += `<div class="mgr-cands">`;
      for (let i = 0; i < cands.length; i++) {
        h += managerCandidateHtml(cands[i], i, b, fee, s.cash >= fee, 'mhire', '招募');
      }
      h += `</div>`;
    } else {
      h += `<div class="mgr-tip">暂无候选人（次日会刷新）</div>`;
    }
    h += `</div>`;
  }

  /* ---- 总店编制：必须显式展示，否则玩家会忘 ---- */
  h += `<div class="mgr-branch hq">
    <div class="mgr-bhead">
      <span class="mgr-be">🏠</span><span class="mgr-bn">总店</span>
      <span class="mgr-bs">编制 ${staffOfBranch(s, 1).length}/${branchStaffCap(s, 1)}</span>
      <span class="mgr-bm none">你亲自经营</span>
    </div>
  </div>`;
  h += `</div>`;
  return h;
}

  /* ---- 挂到全局（保持原有调用方式不变）---- */
  global.regularPanelHtml = regularPanelHtml;
  global.specialtyHtml = specialtyHtml;
  global.managerPanelHtml = managerPanelHtml;

})(typeof window !== 'undefined' ? window : globalThis);
