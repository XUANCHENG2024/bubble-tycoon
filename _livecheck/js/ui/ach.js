/* ============================================================
 *  成就（主线 / 支线）（V20.2 · 从 ui.js 拆出）
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

/**
 * 判定一个成就是主线还是支线（V17）
 * @param {object} a 成就
 * @returns {boolean} true = 主线
 */
function isMainAch(a) {
  if (!a || typeof a.check !== 'function') return false;
  let src;
  try { src = a.check.toString(); } catch (e) { return false; }
  /* ★ 主线判据：**引用了经营推进类的系统**。
     这些字段的变化直接对应「这局在推什么」；
     而 stats/flags 那类多是统计里程碑与一次性挑战（支线）。 */
  return /s\.(st|shop|venue|recipes|rep|up|managers|staff)\b/.test(src);
}

/**
 * 一个 tier 的区块（V17）
 *
 * ★ 真正压缩高度的关键：**已达成的一批折叠起来**。
 *   只做「主线/支线两层」的话，44 行还是一个不少地铺开 ——
 *   分层只是让它们「有顺序」，并没有让页面变短。
 *   而玩家打开成就页的典型场景是「找下一个能做的」，
 *   已达成的对那一刻**没有参考价值**。
 *   ★ 所以：未达成平铺（那是待办），已达成折成一行摘要
 *     （那是成就墙，随时可展开看）。
 *   ★ 这也解释了为什么不能只靠「精简文案」——
 *     文案省不了几行，折叠才省得了。
 */
function achTierHtml(s, tier, list) {
  const got = list.filter(a => s.ach[a.id]);
  const wait = list.filter(a => !s.ach[a.id]);
  const meta = ACH_TIERS[tier];
  /* 玩家手动展开过就一直展开（尊重主动操作） */
  const key = 'ach' + tier;
  const showGot = UI.achShowGot && UI.achShowGot[tier];
  const foldGot = got.length > 0;

  let h = `<div class="card ach-tier ${tier}">
    <div class="card-h">${meta.emoji} ${meta.label}
      <span class="ch-sub">${got.length}/${list.length}</span></div>
    <div class="ach-tier-d">${meta.desc}</div>`;

  /* 待办：平铺 */
  for (const a of wait) h += achRowHtml(s, a);
  if (!wait.length) {
    h += `<div class="ach-all-done">🎉 全部达成</div>`;
  }

  /* 已达成：折叠成一行 */
  if (foldGot) {
    h += `<button class="ach-fold" data-act="achfold" data-id="${tier}">
      <span>✅ 已达成 ${got.length} 个</span>
      <span class="ach-fold-a">${showGot ? '收起 ▴' : '展开 ▾'}</span>
    </button>`;
    if (showGot) for (const a of got) h += achRowHtml(s, a);
  }
  h += `</div>`;
  return h;
}

/**
 * 单个成就的行（V17 精简）
 * ★ 压缩点：原来 desc 是完整一句话，直接占一整行；
 *   现在未达成时 desc 只在 title 里（悬停可见），
 *   行内只留「名字 + 奖励」——玩家扫列表时看的是这两个。
 */
function achRowHtml(s, a) {
  const on = !!s.ach[a.id];
  const reward = (a.reward.cash ? money(a.reward.cash) : '')
    + (a.reward.bp ? (a.reward.cash ? ' · ' : '') + a.reward.bp + '★' : '');
  return `<div class="ach ${on ? 'got' : ''}" title="${esc(a.desc)}">
    <div class="ach-e">${a.emoji}</div>
    <div class="ach-b"><div class="ach-n">${esc(a.name)}</div>
      ${on ? '' : `<div class="ach-d">${esc(a.desc)}</div>`}</div>
    <div class="ach-r">${on ? '✅' : reward}</div>
  </div>`;
}

  /* ---- 挂到全局（保持原有调用方式不变）---- */
  global.isMainAch = isMainAch;
  global.achTierHtml = achTierHtml;
  global.achRowHtml = achRowHtml;

})(typeof window !== 'undefined' ? window : globalThis);
