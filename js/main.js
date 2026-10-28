/* ============================================================
 *  奶茶星球 · Bubble Tycoon  —— 启动 / 事件 / 主循环
 * ============================================================ */
'use strict';

window.META = loadMeta();
SFX.loadOptions(window.META);
window.S = null;
let chosenDiff = 'normal';

/* 标题页（window.S 为 null）也允许触发的动作 */
/* 还没开局时也允许的动作。放进来的前提是：该分支**不读 window.S**。
   'dailyrank' 在这里是刻意的：日榜面板只读 META 不读 S，入口就摆在标题页上。
   另外三个同理 —— login 读 META、slot 读 slotInfo、doimport 先 importSave 再
   交给 startGame 去建局。它们曾经漏在这里，于是标题页上「连续登录」按钮、
   存档槽选择、以及导入弹窗的「导入并继续」点了全都没反应，而且没有任何报错，
   看起来就像按钮坏了。新增标题页动作时务必回来同步这张表。 */
/* 还没开局时也允许的动作。放进来的前提是：该分支**不读 window.S**。
   'dailyrank' 在这里是刻意的：日榜面板只读 META 不读 S，且入口就摆在标题页上。
   另外三个同理 —— login 读 META、slot 读 slotInfo、doimport 先 importSave 再
   交给 startGame 去建局。它们曾经漏在这里，于是标题页上「连续登录」按钮、
   存档槽选择、以及导入弹窗的「导入并继续」点了全都没反应，而且没有任何报错，
   看起来就像按钮坏了。新增标题页动作时务必回来同步这张表。
   注意：**开始营业 / 继续存档 / 导出存档不在这张表里** —— 那三个按钮是直接
   addEventListener 绑定的，根本不走委托，写进来反而是死项。 */
const TITLE_ACTS = ['diff', 'sound', 'retut', 'dailyrank', 'login', 'slot', 'doimport'];

/* ---------------- 开始界面 ---------------- */

/** 本机战绩榜：平台级排行榜要开放数据域 + 云存储（有服务端），
 *  这里先用本机的，至少给玩家一个「再破一次自己纪录」的理由。 */
function topRunsHtml(m) {
  const top = (m && Array.isArray(m.runsTop)) ? m.runsTop.filter(Boolean) : [];
  if (!top.length) return '';
  const rows = top.map((r, i) => {
    const d = DIFFICULTY[r.diff] || DIFFICULTY.normal;
    const res = r.result === 'bankrupt' ? '💸 破产'
      : (r.endless ? `♾️ 第 ${r.milestone} 阶` : (r.worth >= (d.goal || Infinity) ? '🎯 达标' : '未达标'));
    return `<div class="tr-row">
      <span class="tr-i">${['🥇', '🥈', '🥉', '4', '5'][i] || (i + 1)}</span>
      <span class="tr-w">${money(r.worth)}</span>
      <span class="tr-d">${d.emoji}${d.name}</span>
      <span class="tr-r">Day ${r.day} · ${res}</span>
    </div>`;
  }).join('');
  return `<div class="top-runs"><div class="tr-h">🏅 本机战绩榜（前 ${CFG.RUN_TOP_N}）</div>${rows}</div>`;
}

function renderTitle() {
  const dp = $('diffPick');
  dp.innerHTML = Object.values(DIFFICULTY).map(d => `
    <div class="diff-opt ${d.key === chosenDiff ? 'on' : ''}" data-act="diff" data-id="${d.key}">
      <div class="do-e">${d.emoji}</div>
      <div class="do-n">${d.name}</div>
      <div class="do-d">${d.desc}</div>
      <div class="do-g">目标 ${money(d.goal)}</div>
    </div>`).join('');

  const m = window.META;
  $('metaBox').innerHTML = `
    <span class="mchip">🌟 声望 <b>${m.bp}</b> ★</span>
    <span class="mchip">💼 开局创业基金 <b>${money(prestigeStartCash(m.bp))}</b></span>
    <span class="mchip">🏆 最高净资产 <b>${money(m.best.normal || 0)}</b></span>
    <span class="mchip">🎮 已玩 <b>${m.runs}</b> 局</span>
    ${topRunsHtml(m)}`;

  const hasSave = hasAnySave();
  $('btnContinue').style.display = hasSave ? '' : 'none';
  UI.renderSlots();
  /* 每日挑战 */
  const key = todayKey();
  const played = m.dailyDate === key && m.dailyBest != null;
  const bd = $('btnDaily');
  if (bd) {
    bd.textContent = played ? `📅 今日挑战 · 最佳 ${money(m.dailyBest)}` : '📅 每日挑战';
    bd.classList.toggle('btn-ghost', played);
    bd.classList.toggle('btn-amber', !played);
  }
  /* 日榜：今天打过就把成绩顶到按钮上，玩家不用点进去也知道自己今天多少分。
     没打过时按钮只显示「🏆 日榜」，入口不消失 —— 这是 F3 的降级底线。 */
  const br = $('btnDailyRank');
  if (br) {
    br.textContent = played ? `🏆 日榜 ${money(m.dailyBest)}` : '🏆 日榜';
    br.classList.toggle('btn-amber', played);
    br.classList.toggle('btn-ghost', !played);
  }
  /* 连续登录 */
  const lg = loginState(m);
  const bl = $('btnLogin');
  if (bl) {
    bl.textContent = !lg.claimed
      ? `🔥 连登 ${lg.streak} 天 · 签到领 ${money(lg.next)}`
      : (lg.pending > 0 ? `🎁 已领 ${money(lg.pending)} · 开局到账`
        : `🔥 连登 ${lg.streak} 天 · 明日 ${money(lg.next)}`);
    bl.classList.toggle('btn-amber', !lg.claimed);
    bl.classList.toggle('btn-ghost', lg.claimed);
    bl.disabled = !!lg.claimed;
  }
  $('titleTip').textContent = pick(TIPS);
}

/* ---------------- 开局 ---------------- */
/** keepSeed=true 时保留种子随机（每日挑战需要整局可复现） */
function startGame(diff, loaded, keepSeed) {
  if (!loaded && !keepSeed) { RNG.clear(); QUEST_RNG.clear(); }
  /* V6 招牌配方：把跨局累计销量带进这一局（keepSeed 的每日挑战除外 ——
     全网同种子必须完全一致，带了继承数据就没法比了）。 */
  const s = loaded || newGame(diff, window.META.bp, keepSeed ? null : window.META.sig);
  window.S = s;
  /* ★ V13.8：换局面必须作废 HUD 脏检查缓存 ——
     否则新局面的 HUD 会停留在旧值（renderHUD 靠「值相同就不写」省开销，
     缓存没清就会漏更新）。 */
  UI.resetHUDCache();
  if (!loaded) {
    window.META.runs++;
    saveMeta(window.META);
  }
  /* 连续登录的创业基金在这里落进这一局（没签到会自动补签） */
  const lb = takeLoginBonus(s, window.META);
  UI.showScreen('screen-game');
  UI.setTab('manage');
  UI.renderHUD();
  autoSave(s);
  /* 读档可能停在 report（结算弹窗开着时关了页面）。不补弹的话玩家既看不到结算
     也没有「进入下一天」，只能重开当天 —— 而重开会让营收/工资/stats 重复计一次。 */
  if (s.phase === 'report') UI.showReport();
  /* 新手指引：首次游玩自动开启；读档则续上未完成的进度 */
  SFX.resume();
  if (lb) {
    UI.toast(`🔥 连续登录 ${lb.streak} 天，创业基金 +${money(lb.cash)}`, 'gold');
    SFX.coin();
  }
  if (!loaded && s.startBonus > 0) {
    UI.toast(`🌟 声望 ${Math.round(s.bpBonus)} ★ → 创业基金 +${money(s.startBonus)}`, 'gold');
  }
  setTimeout(() => {
    if (loaded) {
      if (s.tut && !s.tut.done && s.tut.step > 0 && s.tut.step < TUT.steps.length) TUT.start(s.tut.step);
    } else if (!window.META.tutDone) {
      TUT.start(0);
    }
  }, 260);
}

/** 存档的统一入口：首次失败时明确告知玩家，避免"静默丢进度" */
let storageWarned = false;
function autoSave(s) {
  /* 营业中途不落盘。清洗器会把 phase 退回 'prep'（现场恢复不了），
     而开门时扣掉的营销费已经进了 s.dayMarketing、重开门又会被覆盖掉 ——
     那笔钱既没退回现金、也没进任何一天的日报，等于凭空蒸发。
     守卫放在这里，比在每个调用点各判一次 phase 可靠。 */
  if (!s || s.phase === 'open') return false;
  const ok = saveGame(s);
  if (!ok && !storageWarned) {
    storageWarned = true;
    UI.toast('⚠️ 浏览器存储不可用（隐私模式/空间已满），本局进度将无法保存', 'err');
  }
  return ok;
}

/** 每次操作后即时结算成就 / 标记教程完成（不再等到打烊） */
function pump() {
  const s = window.S;
  /* ★ V13.8：成就弹出走showAchBatch（与 emitAchievements 同一份实现） */
  showAchBatch(checkAchievements(s));
  emitQuests();
  UI.renderAll();
  autoSave(s);
}

/** 弹出每日任务达成提示。s.newQuests 由引擎在达成时写入，这里消费掉避免重复弹 */
function emitQuests() {
  const s = window.S;
  if (!s || !s.newQuests || !s.newQuests.length) return;
  const got = s.newQuests; s.newQuests = [];
  got.forEach((q, i) => setTimeout(() => {
    UI.toast(`🎯 ${q.emoji} ${q.name} 达成  +${money(q.cash)}`, 'ok');
    SFX.coin();
  }, i * 340));
}

/* ---------------- 一天结束 ---------------- */
function onDayEnd() {
  const s = window.S;
  UI.stageEnd();
  UI.renderHUD();
  emitQuests();          /* 打烊时结算的「越少越好」型任务在这里弹 */
  emitAchievements();
  autoSave(s);

  if (isBankrupt(s)) { finishRun('bankrupt'); return; }
  if (isFinished(s)) { finishRun('finish'); return; }
  if (s.endlessLevelUp) UI.toast(`🏆 里程碑达成！新目标 ${money(goalOf(s))}`, 'gold');
  /* ★ V14.3：中期锚点达成 —— 30 天里少数几个"我确实做到了"的时刻，
     原来只有一行 pushLog（玩家要翻日志才看得到），没有任何即时反馈。
     现在给三层：专属音效 + toast + 撒彩带。
     ★ 引擎层只写 s.milestoneHit 标记，音效与彩带属于表现层，
       两版（H5/Canvas）都能各自决定怎么呈现。 */
  if (s.milestoneHit) {
    SFX.reach();
    UI.toast('🏁 中期目标达成！声望 +1', 'gold');
    UI.confetti(40);
  }
  UI.showReport();
}

/**
 * 把经营城市切到指定城市（V13.8 抽取）
 *
 * ★ 为什么要抽：
 *   `mapset`（地图详情里点）与 `mappick`（城市选择器里选）两个 action
 *   做的是**同一件事**，14 行一模一样（check-dup.js 扫出来的）。
 *   它们存在的意义是**入口不同**（一个是地图卡片，一个是选择器列表），
 *   行为必须一致 —— 抽出来才能保证「两个入口的结果永远相同」。
 *
 * ★ 提示里包含「下架了几款本地菜」+「当地特色是哪几道」——
 *   切城不是纯粹的好事（旧城特色菜会下架），必须让玩家知道代价，
 *   否则会以为是 bug。
 *
 * @param {string} cityId 目标城市 id
 */
function doSetVenueCity(cityId) {
  const s = window.S;
  const r = setVenueCity(s, cityId);
  if (!r.ok) { UI.toast(r.msg, 'err'); return; }
  UI.closeModal();
  const parts = [`已切换到${r.cityName || cityId}`];
  if (r.dropped && r.dropped.length) parts.push(`${r.dropped.length} 款本地菜下架`);
  if (r.cityCuisines && r.cityCuisines.length) {
    parts.push('当地特色：' + r.cityCuisines.map(cid => {
      const c = cuisineById(cid);
      return c ? c.name : cid;
    }).join('、'));
  }
  UI.toast(parts.join(' · '), 'ok');
  SFX.click();
  pump();
}

/**
 * 弹出一组成就提示（V13.8 抽取）
 *
 * ★ 为什么要抽：
 *   这段「领★ → 存 meta → 逐条 toast（带间隔）→ 撒彩带 → 播音效」
 *   原本在 pump() 和 emitAchievements() 里**各写了一份**，8 行一模一样。
 *   风险不是"多写了些"，而是将来改 toast 文案/加音效/调节奏时只改一处 ——
 *   玩家会看到"操作后弹的成就"和"打烊后弹的成就"长得不一样。
 *
 * @param {Array} got 已达成的成就数组
 */
function showAchBatch(got) {
  if (!got || !got.length) return;
  /* ★ 只在跨局首次达成时给，之后重复达成仍有现金但没有 ★ */
  const firsts = claimAchStars(window.META, got);
  if (firsts.length) saveMeta(window.META);
  got.forEach((a, i) => setTimeout(() => {
    UI.toast(`🏅 ${a.emoji} ${a.name}  +${money(a.reward.cash || 0)}`
      + (firsts.indexOf(a.id) >= 0 ? ` ${a.reward.bp}★` : ''), 'gold');
    UI.confetti(22); SFX.ach();
  }, i * 400));
}

/** 弹出成就（去掉 s.newAchList 里的已消费项，避免重复） */
function emitAchievements() {
  const s = window.S;
  let got = [];
  if (s.newAchList && s.newAchList.length) { got = s.newAchList; s.newAchList = []; }
  else got = checkAchievements(s);
  if (!got.length) return;
  showAchBatch(got);
}

/* ---------------- 收官 ---------------- */
/** 「进入下一天」的统一出口：抽卡（如果有）走完以后都会回到这里 */
function enterNextDay() {
  const s = window.S;
  nextDay(s);
  /* 必须用 isFinished：无尽模式下 day 会超过 CFG.DAYS 但仍要继续 */
  if (isFinished(s)) { finishRun('finish'); return; }
  UI.renderAll();
  if (s.pendingEvent) UI.showEvent();
  else UI.toast(`🌅 Day ${s.day} 开始 · ${s.weather.emoji} ${s.weather.name}`, 'ok');
  autoSave(s);
}

function finishRun(kind) {
  const s = window.S;
  const m = window.META;
  const nw = netWorth(s);
  m.best[s.diff] = Math.max(m.best[s.diff] || 0, Math.round(nw));
  for (const k in s.ach) m.ach[k] = true;
  /* V6 招牌配方：本局卖出的累计销量写回 META，下一局继承 */
  mergeSignature(m, s);
  pushRunRecord(m, s, kind);
  /* 每日挑战：只在刷新当天最好成绩时覆盖（判定在引擎的 recordDaily 里）。
     榜单按 value 从大到小排、每次上报是覆盖，拿一局摆烂成绩盖上去
     等于自己把自己的名次冲掉。newToday 为 false 时小游戏端也不上报。 */
  const daily = s.daily ? recordDaily(m, todayKey(), nw) : null;
  saveMeta(m);
  clearSave();
  UI.showEnd(kind, daily);
}

/* ---------------- 行为分发 ---------------- */
function doAct(act, el) {
  const s = window.S;
  /* 部分分支可以不带元素调用（如再次送礼），这里兜住避免出现 TypeError */
  const id = (el && el.dataset) ? el.dataset.id : undefined;
  /* ★ V17 修商圈页「点了没反应」的根因：
     商圈页有一批按钮用 `data-b="门店号"` 传参
     （smgrh / smgrfire / srename / sfund / stoggleup），
     而这里**从来没取过 dataset.b**——
     于是一旦某个分支里写 `+br`，读到的就是一个**未定义标识符**，
     直接抛 ReferenceError。表现为：按钮存在、能看见、点了毫无反应。
     ★ 为什么会长期没人发现：这些 case 从没被自动化点过
       （smoke 只测「面板能否渲染」，不测「每个按钮点了会怎样」）。
     ★ 这里补上就一次修好全部 5 个，不必逐个改 case。 */
  const br = (el && el.dataset) ? el.dataset.b : undefined;

  switch (act) {
    /* --- 标题页 ---
       开始营业 / 继续存档 / 导出存档这三个按钮是直接 addEventListener 绑定的
       （见文件末尾的启动段），不走 data-act 委托，所以这里没有对应分支 ——
       以前那三个 case 是死的，永远不会被点到，已删。 */
    case 'diff': chosenDiff = el.dataset.id; SFX.click(); renderTitle(); return;

    /* --- 存档槽 --- */
    case 'slot': {
      setSlot(+el.dataset.id);
      UI.renderSlots();
      const info = slotInfo(getSlot());
      UI.toast(info ? `已选择槽 ${getSlot() + 1}（Day ${info.day}）` : `已选择槽 ${getSlot() + 1}（空）`, 'ok');
      return;
    }

    /* --- 连续登录签到 --- */
    case 'login': {
      const r = claimLogin(window.META);
      if (!r) { UI.toast('今天已经签过啦，明天再来', 'ok'); return; }
      SFX.coin(); UI.confetti(18);
      UI.toast(`🔥 连续登录 ${r.streak} 天，创业基金 +${money(r.cash)}（开局到账）`, 'gold');
      renderTitle();
      return;
    }

    /* --- 每日挑战（日期种子，全网同一局） --- */
    case 'daily': {
      RNG.setSeed(seedFromText('bubble-' + todayKey()));
      QUEST_RNG.setSeed(seedFromText('bubble-quest-' + todayKey()));
      /* 声望（含本次奖励）不参与每日挑战：全网同一局，开局资金也要一样，否则榜单不公平 */
      const st = newGame('normal', 0);
      st.daily = true;
      startGame('normal', st, true);
      window.META.runs++;
      saveMeta(window.META);
      UI.toast(`📅 每日挑战 ${todayKey()} · 全网同一局`, 'gold');
      return;
    }

    /* --- 每日挑战日榜（F3） --- */
    case 'dailyrank': UI.showDailyRank(); return;

    /* --- 无尽模式 --- */
    case 'endless': {
      const g = startEndless(s);
      window.S = s;
      UI.resetHUDCache();   /* ★ V13.8：同上，进无尽模式也要清 HUD 缓存 */

      UI.showScreen('screen-game');
      UI.setTab('manage');
      UI.renderAll();
      UI.toast(`♾️ 无尽模式！新目标 ${money(g)}`, 'gold');
      UI.confetti(50); SFX.up();
      autoSave(s);
      return;
    }
    case 'dlcard': UI.downloadCard(); return;
    /* 分享战绩（V21）：只在网页版有意义 —— App 里没有可分享的地址。
       降级链在 UI.shareResult 里：微信内置浏览器 → 引导右上角 ···；
       支持 Web Share 的 → 分享战绩图；桌面 → 复制文案。 */
    case 'share': UI.shareResult(s); return;
    case 'doimport': {
      const ta = $('importCode');
      const r = importSave(ta ? ta.value : '');
      if (!r.ok) { UI.toast(r.msg, 'err'); return; }
      UI.closeModal();
      startGame(r.state.diff, r.state);
      UI.toast('📥 存档导入成功', 'ok');
      return;
    }

    /* --- 设置（标题页也可用） --- */
    case 'sound': {
      SFX.on = !SFX.on;
      if (SFX.on) SFX.resume();
      window.META.sound = SFX.on; saveMeta(window.META);
      UI.showHelp();
      if (SFX.on) SFX.click();
      return;
    }
    case 'retut': {
      if (!s) { UI.toast('先开始一局再看教程', 'err'); return; }
      UI.closeModal();
      setTimeout(() => TUT.start(0), 260);
      return;
    }

    /* --- 经营 --- */
    case 'buy': {
      const r = buyIng(s, id, +el.dataset.q);
      if (r.ok) { UI.toast(`买入 ${ingById(id).emoji}${r.qty} · -${money(r.cost)}`, 'ok'); SFX.cash(); TUT.notify('buy'); }
      else UI.toast(r.msg, 'err');
      break;
    }
    case 'autofill': {
      const r = autoFill(s);
      UI.toast(r.bought ? `补货 ${r.bought} 单位（${r.kinds} 种）· -${money(r.spent)}` : '现金或仓位不足', r.bought ? 'ok' : 'err');
      if (r.bought) { SFX.cash(); TUT.notify('buy'); }
      break;
    }
    case 'sell': {
      /* ★ V13.9：单种原料清仓。
         ★ 卖完等于亏损（按 50% 回购），所以 toast 要把「亏了多少」说清楚 ——
           玩家点了按钮才知道代价，比事后发现净资产掉了好。 */
      const have = Math.floor(num(s.inv[id], 0));
      const unit = num(s.prices[id], 0) * CFG.LIQUID_RATE;
      const r = sellIng(s, id);
      if (!r.ok) { UI.toast(r.msg, 'err'); break; }
      const lost = Math.max(0, Math.round((num(s.avgCost[id], unit) - unit) * r.qty));
      UI.toast(`清仓 ${r.qty} 个 ${ingById(id).name} · +${money(r.got)}`
        + (lost > 0 ? `（比成本少 ${money(lost)}）` : ''), lost > 0 ? 'gold' : 'ok');
      SFX.cash();
      break;
    }
    case 'sellstale': {
      /* ★ V13.9：一键清理「本地买不到」的原料 ——
         切城后的救命功能：没有它，满仓的旧城料会让玩家彻底卡死。 */
      const cid = currentCityId(s);
      const stale = ING.filter(g => (s.inv[g.id] || 0) > 0 && !ingAvailableAt(g.id, cid));
      if (!stale.length) { UI.toast('没有本地买不到的原料', 'err'); break; }
      let got = 0, qty = 0;
      for (const g of stale) {
        const r = sellIng(s, g.id);
        if (r.ok) { got += r.got; qty += r.qty; }
      }
      UI.toast(`清理 ${qty} 个本地买不到的原料 · +${money(got)}`, 'gold');
      SFX.cash();
      pump();
      break;
    }
    case 'toggle': {
      const r = toggleMenu(s, id);
      if (r === false) UI.toast(`上架位已满（${menuSlots(s)} 个），去升级「招牌展位」`, 'err');
      else { UI.toast(`${recipeById(id).name} ${r}`, 'ok'); SFX.deal(); TUT.notify('toggle'); }
      break;
    }
    /* --- 营销快捷键：原来只有 data-act="mktset"，switch 里没有这个 case，
           点下去一路落到末尾的 pump()，既不改值也不报错 —— 四个按钮全是死键。 --- */
    case 'mktset': {
      s.marketing = clamp(+el.dataset.v || 0, 0, 2000);
      SFX.deal();
      UI.toast(`📣 营销预算设为 ${money(s.marketing)}`, 'ok');
      break;
    }
    case 'scout': {
      if (s.trendKnown) { UI.toast('已经调研过了', 'err'); break; }
      if (s.cash < 150) { UI.toast('现金不足', 'err'); break; }
      s.cash -= 150; s.trendKnown = true;
      UI.toast(`🔍 明日流行：${TAGS[s.nextTrend].emoji} ${TAGS[s.nextTrend].name}`, 'gold');
      break;
    }
    /* --- 经营维度：场地类型 / 地图坐标 --- */
    case 'vtype': {
      const r = setVenueType(s, id);
      if (!r.ok) UI.toast(r.msg, 'err');
      else { UI.toast(`${r.emoji} 经营场地：${r.name}`, 'ok'); SFX.click(); }
      break;
    }
    case 'vgeo': {
      /* 从两个输入框取值 —— 这里只负责收集，真正的范围/坐标系校验在引擎里 */
      const card = el && el.closest ? el.closest('.venue') : null;
      const get = f => {
        const inp = card ? card.querySelector(`[data-vfield="${f}"]`) : null;
        return inp ? String(inp.value).trim() : '';
      };
      const lngRaw = get('lng'), latRaw = get('lat');
      if (!lngRaw || !latRaw) { UI.toast('请同时填写经度与纬度', 'err'); break; }
      const r = setGeo(s, { lng: Number(lngRaw), lat: Number(latRaw) });
      if (!r.ok) UI.toast(r.msg, 'err');
      else { UI.toast(`📍 已记录坐标 ${r.geo.lng}, ${r.geo.lat}（${r.geo.coordSys}）`, 'ok'); SFX.coin(); }
      break;
    }
    case 'vgeoclear': {
      clearGeo(s);
      UI.toast('已清除地图坐标', 'ok');
      SFX.click();
      break;
    }
    case 'open': {
      const r = openShop(s);
      if (!r.ok) { UI.toast(r.msg, 'err'); return; }
      UI.stageInit();
      TUT.notify('open');
      UI.toast(`🔔 开门！预计 ${s.sim.traffic} 位客人`, 'ok');
      SFX.bell();
      if (s.day <= 2) {
        setTimeout(() => UI.toast('💡 疯狂点击「出杯位」可以加速，还有小费和连击！', 'gold'), 900);
        setTimeout(() => UI.toast('⚡ 空格键 = 老板上阵大招（8 秒全员加速）', 'gold'), 3200);
      }
      return;
    }

    /* --- 研发 --- */
    case 'achfold': {
      /* ★ V17：展开/收起「已达成」那批成就。
         折叠不是为了省体积，是为了**对焦**：玩家打开成就页
         是来找下一个能做的，已达成的那一屏对那一刻没参考价值。 */
      UI.achShowGot = UI.achShowGot || {};
      UI.achShowGot[id] = !UI.achShowGot[id];
      UI.renderPanel(UI.tab);
      SFX.click();
      break;
    }
    case 'stoggleup': {
      /* ★ V17 修 bug：商圈页「店铺升级」的折叠箭头以前点了没反应。
         根因：UI 画了箭头，但没有 case 分支也没有收起逻辑 —— 做了一半。
         ★ 状态放 UI.storeUpOpen（按门店号），不存档：
           折叠是临时浏览状态，不该占存档位。 */
      UI.storeUpOpen = UI.storeUpOpen || {};
      const cur = UI.storeUpOpen[br];
      /* 没记录过就按「有没有投入」定初值：
         有投入默认展开（刚买完要看得见），没投入默认收起（不占版面）。 */
      const store = storeByBranch(s, +br);
      const had = store && STORE_UPGRADES.some(u => storeUpLevel(s, store, u.id) > 0);
      UI.storeUpOpen[br] = cur === undefined ? !had : !cur;
      UI.renderPanel(UI.tab);
      SFX.click();
      break;
    }
    case 'candrefresh': {
      /* ★ V17：手动刷新候选人。
         冷却检查在引擎侧（candCd）—— UI 只是把结果说出来。
         ★ 冷却期间按钮在 UI 层已 disabled，这里仍要兜一层：
           事件可能被合成派发绕过 disabled（也为了脏存档安全）。 */
      const r = refreshCandidates(s);
      if (r && r.ok) {
        SFX.coin();
        UI.toast(`🔄 换到 ${r.n} 位新候选人`, 'ok');
      } else {
        UI.toast((r && r.msg) || '暂时不能刷新', 'err');
      }
      UI.renderPanel(UI.tab);
      break;
    }
    case 'foldtree': {
      /* ★ V17：研发树分组折叠。
         体检实测研发页 HTML 体积 93669 字符 / 1839 标签，是第二名的 3.5 倍；
         而其中 14 个分组是非本店的 —— 提示就写着「需切换经营城市」，
         把它们全展开等于让玩家滚过不能点的内容。 */
      UI.collapsed = UI.collapsed || {};
      UI.collapsed[id] = !UI.collapsed[id];
      UI.renderPanel(UI.tab);
      SFX.click();
      break;
    }
    case 'toing': {
      /* ★ V16：配方卡上的原料 →跳到原料市场并高亮。
         ★ 目标可能在市场列表的中后段（20+ 行），
           所以不只是切 tab，还要滚动 + 闪烁定位（UI.jumpTo 统一处理）。 */
      if (!ingById(id)) { UI.toast('原料不存在', 'err'); break; }
      UI.jumpTo('manage', 'ing', id);
      SFX.click();
      break;
    }
    case 'torecipe': {
      /* ★ V16：跳到某款配方（前置配方链）。
         ★ 同页跳转也走 UI.jumpTo —— 统一模式，
           玩家不需要记「哪些跳转会切页、哪些不会」。 */
      if (!recipeById(id)) { UI.toast('配方不存在', 'err'); break; }
      UI.jumpTo('lab', 'recipe', id);
      SFX.click();
      break;
    }
    case 'inguse': {
      /* ★ V16：市场行的配方徽章 → 跳到研发树并高亮那款配方。 */
      if (!recipeById(id)) { UI.toast('配方不存在', 'err'); break; }
      UI.jumpTo('lab', 'recipe', id);
      SFX.click();
      break;
    }
    case 'ingexpand': {
      /* ★ V16：展开「+N」—— 32 种原料 × 十几道菜，全列出来市场会长到没法看。 */
      UI.toggleIngUses(id);
      SFX.click();
      break;
    }
    case 'ingshowall': {
      /* ★ V16：取消跳转过滤，回到完整市场列表。 */
      UI.ingFilter = false;
      UI.nav.tab = null; UI.nav.focus = null; UI.nav.kind = null;
      UI.nav.from = null; UI.nav.fromLabel = null;
      UI.renderPanel(UI.tab);
      SFX.click();
      break;
    }
    case 'navback': {
      /* ★ V16：统一的返回方式（所有跳转共用这一个按钮）。 */
      UI.navBack();
      SFX.click();
      break;
    }
    case 'research': {
      /* V9：先问「能不能研」再研 —— 无工坊时给出**具体原因**
         （缺工坊 / 缺钱 / 缺原料），而不是笼统的"无法研发"。 */
      const canR = canResearch(s, id);
      if (!canR.ok) { UI.toast(canR.msg, 'err'); break; }
      const r = doResearch(s, id);
      if (r.ok) { UI.toast(`🧪 解锁 ${r.recipe.emoji} ${r.recipe.name}！`, 'gold'); UI.confetti(30); SFX.up(); }
      else UI.toast(r.msg, 'err');
      break;
    }

    /* --- V9 制作工坊：建造/升级一条产品线 --- */
    case 'workshop': {
      const r = buildWorkshop(s, id);
      if (r.ok) {
        const w = workshopById(id);
        UI.toast(`🏭 ${w.emoji} ${w.name} 升至 Lv.${r.level}（-${money(r.cost)}）`, 'gold');
        SFX.up();
      } else UI.toast(r.msg, 'err');
      break;
    }

    /* --- 升级 --- */
    case 'upgrade': {
      const r = doUpgrade(s, id);
      if (r.ok) { UI.toast(`⬆️ ${upgradeById(id).name} Lv.${s.up[id]}`, 'ok'); SFX.up(); }
      else UI.toast(r.msg, 'err');
      break;
    }
    case 'shop': {
      const r = openShopBranch(s);
      if (r.ok) {
        /* V11：开分店后店长名额 +1，把这件事说清楚，
           否则玩家不知道"开了店为什么能招人了"。 */
        UI.toast(`🏪 第 ${r.branch} 家分店开业！可招募一名店长`, 'gold');
        UI.confetti(40); SFX.up();
      } else UI.toast(r.msg, 'err');
      break;
    }
    /* ---------- V11 店长 ---------- */
    /* ---------- V12 店铺系统 ---------- */
    case 'sopen': {
      /* 开店流程：先看能不能开（有上限 / 钱不够就别开弹窗） */
      const c = shopCost(s);
      if (c == null) { UI.toast('已达分店上限', 'err'); break; }
      if (s.cash < c) { UI.toast(`现金不足（需 ${money(c)}）`, 'err'); break; }
      UI.modal(openStoreModalHtml(s));
      break;
    }
    case 'sopenok': {
      const provId = ($('sProv') && $('sProv').value) || (s.venue && s.venue.provId);
      const cityId = ($('sCity') && $('sCity').value) || (s.venue && s.venue.cityId);
      const name = ($('sName') && $('sName').value) || '';
      const vt = window.__sVenue || VENUE_DEFAULT;
      const r = openStore(s, { cityId, venueType: vt, name: name.trim() });
      if (r.ok) {
        UI.closeModal();
        UI.toast(`🗺️「${r.store.name}」开业！可任命一名店长`, 'gold');
        UI.confetti(40); SFX.up();
        UI.setTab('rival');
      } else { UI.toast(r.msg, 'err'); }
      break;
    }
    case 'svenue': {
      /* 场地类型：弹窗内的按钮组（不入 state，选中后再点确认才生效） */
      window.__sVenue = id;
      const box = document.querySelectorAll('#modal .vtype');
      box.forEach(b => b.classList.toggle('on', b.dataset.id === id));
      break;
    }
    case 'sprov': {
      /* 换省 → 市列表跟着换（与现有 vprov 同款交互） */
      const v = $('sProv') ? $('sProv').value : (s.venue && s.venue.provId);
      const opts = citiesOfProvince(v).map(c =>
        `<option value="${c.id}">${esc(c.name)}</option>`).join('');
      if ($('sCity')) $('sCity').innerHTML = opts;
      break;
    }
    case 'stoggle': {
      /* 玩家接管 ⇄ 交给店长 */
      const r = setStoreAuto(s, +br, el.dataset.auto === '1');
      if (r.ok) {
        UI.toast(r.auto ? '🤖 该店已交由店长自动打理' : '✋ 你已接管该店', 'ok');
        SFX.click();
      } else UI.toast(r.msg, 'err');
      break;
    }
    case 'smgrh': {
      /* 任命店长：弹窗里挑候选人 */
      const b = +br;
      UI.modal(`<div class="m-title">🎩 任命店长</div>
        <div class="m-sub">${esc((storeByBranch(s, b) || {}).name || '')} · 每家店至多一名店长</div>
        <div style="margin-top:10px" id="sCandBox">${storeCandidatesHtml(s, b)}</div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn btn-ghost" style="flex:1" data-act="modal-close">关闭</button>
        </div>`);
      break;
    }
    case 'smgrpick': {
      const r = hireManager(s, +br, +id);
      if (r.ok) {
        UI.closeModal();
        const st = storeByBranch(s, +br);
        UI.toast(`🎩 ${r.manager.name} 入驻「${st ? st.name : ''}」`, 'ok');
        SFX.hire();
      } else UI.toast(r.msg, 'err');
      break;
    }
    case 'smgrfire': {
      /* 撤下店长（不遣散员工 —— 店长是管理者不是所有者） */
      const st = storeByBranch(s, +br);
      const m = st ? managerById(s, st.managerId) : null;
      if (!m) { UI.toast('该店没有店长', 'err'); break; }
      const r = fireManager(s, m.id);
      if (r.ok) { UI.toast('🎩 店长已撤下，该店员工留在原编制', 'ok'); SFX.lose(); }
      else UI.toast(r.msg, 'err');
      break;
    }
    case 'smain': {
      const r = setMainStore(s, +br);
      if (r.ok) { UI.toast(`⭐「${r.store.name}」升为主店`, 'gold'); SFX.up(); }
      else UI.toast(r.msg, 'err');
      break;
    }
    case 'srename': {
      const st = storeByBranch(s, +br);
      const nm = prompt('店铺名称（最多 16 字）', st ? st.name : '');
      if (nm == null) break;                    /* 取消 */
      const r = renameStore(s, +br, nm);
      if (r.ok) { UI.toast('✏️ 店名已更新', 'ok'); SFX.click(); }
      else UI.toast(r.msg, 'err');
      break;
    }
    case 'sfund': {
      const st = storeByBranch(s, +br);
      const amt = prompt(`向「${st ? st.name : ''}」注资多少？（总部现金 ${money(s.cash)}）`, '2000');
      if (amt == null) break;
      const r = fundStore(s, +br, parseFloat(amt));
      if (r.ok) { UI.toast(`💰 已注资 ${money(r.amount)}`, 'ok'); SFX.deal(); }
      else UI.toast(r.msg, 'err');
      break;
    }
    /* ---------- V13 城市地图 ---------- */
    case 'mapopen': {
      /* V13.1：打开城市地图弹窗（完整地图 + 省份概览） */
      UI.modal(cityMapModalHtml(s));
      break;
    }
    case 'mapcity': {
      /* 地图上点城市 → 弹出详情（不直接切换，避免误触） */
      UI.modal(cityDetailModalHtml(s, id));
      break;
    }
    case 'mapcitylist': {
      UI.modal(cityDetailModalHtml(s, id));
      break;
    }
    case 'mapset': {
      /* 从地图详情设为经营城市 */
      doSetVenueCity(id);
      break;
    }
    case 'mapgoto': {
      /* 「切换经营城市」→ 打开城市选择器。
         ★ 为什么不是直接切：地图只画 44 个有精确坐标的城市，
           而 272 个市都能经营 —— 地图上的点只是「有坐标的那些」，
           入口必须给全量城市，否则玩家会以为"只能在这 44 个城市里选"。 */
      UI.modal(cityPickerModalHtml(s));
      break;
    }
    case 'mappick': {
      /* 从城市选择器里选定一个城市 */
      doSetVenueCity(id);
      break;
    }
    case 'stbuy': {
      /* 店铺级升级（每店独立） */
      const r = buyStoreUpgrade(s, +br, id);
      if (r.ok) {
        UI.toast(`🏗️「${r.store.name}」${r.upgrade.emoji} ${r.upgrade.name} Lv.${r.level}`, 'ok');
        SFX.up();
      } else UI.toast(r.msg, 'err');
      break;
    }
    case 'smgrre': {
      /* 重新启用留档店长（免费） */
      const r = rehireManager(s, +id, +br);
      if (r.ok) {
        UI.toast(`🎩 ${r.manager.name} 重新入职「${r.store.name}」`, 'ok');
        SFX.up();
      } else UI.toast(r.msg, 'err');
      break;
    }
    case 'sclose': {
      /* 关店：不可撤销，且要付清退费 —— 所以必须二次确认。
         ★ 二次确认不是"怕玩家手滑"，而是这个操作**不可逆**：
           店没了、员工遣散、店费沉没。误触一次就是真损失。*/
      const st = storeByBranch(s, +br);
      if (!st) { UI.toast('店铺不存在', 'err'); break; }
      if (st.branch === 1) { UI.toast('总店不能关闭', 'err'); break; }
      const fee = Math.round(st.expense * 0.35);
      const staffN = staffOfBranch(s, st.branch).length;
      if (!confirm(`确定关闭「${st.name}」？\n\n· 不退还开店费\n· 清退费 ${money(fee)}\n· ${staffN} 名员工将被遣散\n\n此操作不可撤销。`)) break;
      const r = closeStore(s, +br);
      if (r.ok) {
        UI.toast(`🏚️「${st.name}」已关闭（遣散 ${r.staffOut} 人）`, 'gold');
        SFX.lose();
      } else UI.toast(r.msg, 'err');
      break;
    }
    case 'sdraw': {
      const st = storeByBranch(s, +br);
      const amt = prompt(`从「${st ? st.name : ''}」提现多少？（店铺现金 ${money(st ? st.cash : 0)}）`, '1000');
      if (amt == null) break;
      const r = withdrawStore(s, +br, parseFloat(amt));
      if (r.ok) { UI.toast(`💵 已提现 ${money(r.amount)}`, 'ok'); SFX.lose(); }
      else UI.toast(r.msg, 'err');
      break;
    }

    case 'mhire': {
      const r = hireManager(s, +br || 2, +id || 0);
      if (r.ok) {
        const m = r.manager;
        UI.toast(`🎩 ${m.name}（Lv.${m.lv} ${managerRank(m.lv).name}）入职第 ${m.branch} 分店`, 'ok');
        SFX.hire();
      } else UI.toast(r.msg, 'err');
      break;
    }
    case 'mfire': {
      const r = fireManager(s, +id);
      if (r.ok) { UI.toast('🎩 店长已卸任，该店员工留在原编制', 'ok'); SFX.lose(); }
      else UI.toast(r.msg, 'err');
      break;
    }
    case 'mspec': {
      /* ★ V13.7：设置店长专精方向 */
      const r = managerSetSpecialty(s, +id, el.dataset.spec);
      if (r.ok) { UI.toast('🎯 ' + r.msg, 'ok'); SFX.click(); }
      else UI.toast(r.msg, 'err');
      break;
    }
    case 'mmove': {
      const r = moveManager(s, +id, +el.dataset.to);
      if (r.ok) {
        UI.toast(`🔀 店长调往第 ${r.to} 分店（带走 ${r.moved} 名员工${r.left ? `，${r.left} 名留下` : ''}）`, 'ok');
        SFX.hire();
      } else UI.toast(r.msg, 'err');
      break;
    }
    case 'prestige': {
      const gain = prestigeGain(s);
      const mb = window.META.bp;
      UI.modal(`<div class="m-title">♻️ 品牌升级</div>
        <div class="m-sub">把 ${money(netWorth(s))} 净资产转化为永久声望</div>
        <div style="text-align:center;font-size:40px;font-weight:900;color:var(--amber);margin:12px 0">+${gain} ★</div>
        <div class="rep-note">转生后本局进度重置，但声望点永久保留。<br>当前共 ${mb} ★ → <b>${mb + gain} ★</b>：
          开局创业基金 <b style="color:var(--green)">${money(prestigeStartCash(mb))}</b> → <b style="color:var(--green)">${money(prestigeStartCash(mb + gain))}</b>（封顶 ${money(CFG.BP_START_CAP)}）。<br>
          这笔钱由你自己决定投到哪（雇人 / 提速 / 开店），声望不再直接加客流 —— 那样会让客人多到来不及做，反而更亏。</div>
        <div class="m-btns"><button class="btn btn-amber" data-act="prestige2">确认转生</button>
        <button class="btn btn-ghost" onclick="UI.closeModal()">再想想</button></div>`);
      return;
    }
    case 'prestige2': {
      const gain = prestigeGain(s);
      const m = window.META;
      m.bp += gain; m.maxBpEarned = Math.max(m.maxBpEarned || 0, m.bp);
      m.best[s.diff] = Math.max(m.best[s.diff] || 0, Math.round(netWorth(s)));
      for (const k in s.ach) m.ach[k] = true;
      /* V6 招牌配方：转生后立刻开新局，本局的招牌进度必须先写回，
         否则新局继承的是旧基线，这一局卖的量就白卖了。 */
      mergeSignature(m, s);
      saveMeta(m);
      clearSave();
      UI.closeModal();
      UI.toast(`🌟 转生成功！声望 ${m.bp} ★`, 'gold');
      UI.confetti(60);
      startGame(s.diff);
      return;
    }
    case 'finish': {
      UI.modal(`<div class="m-title">🏁 提前收官？</div>
        <div class="m-sub">以当前净资产 ${money(netWorth(s))} 结束本局</div>
        <div class="m-btns"><button class="btn btn-primary" data-act="finish2">确认收官</button>
        <button class="btn btn-ghost" onclick="UI.closeModal()">继续经营</button></div>`);
      return;
    }
    case 'finish2': UI.closeModal(); finishRun('finish'); return;

    /* --- 员工 --- */
    case 'hire': {
      const r = hireStaff(s, +el.dataset.i);
      if (r.ok) { UI.toast(`👤 ${r.staff.emoji} ${r.staff.name} 加入！出杯位 +1`, 'ok'); SFX.hire(); }
      else UI.toast(r.msg, 'err');
      break;
    }
    case 'fire': {
      const r = fireStaff(s, +id);
      /* 原先这里漏了 else 分支：现金不够付遣散费时点了没反应、也没有任何提示，
         玩家会以为是卡了。与其他 action 的错误反馈保持一致。 */
      if (r.ok) UI.toast(`已解雇，遣散费 ${money(r.sev)}`, 'ok');
      else UI.toast(r.msg || '无法解雇', 'err');
      break;
    }
    /* --- 商圈反制 --- */
    case 'rivalact': {
      const r = rivalAction(s, id);
      if (r.ok) { UI.toast('🏙️ ' + r.msgs.join('，'), 'ok'); SFX.up(); }
      else UI.toast(r.msg, 'err');
      break;
    }
    case 'teambuild': {
      const r = teamBuild(s);
      if (r.ok) UI.toast(`🎉 团建完成，全员体力回满！-${money(r.cost)}`, 'ok');
      else UI.toast(r.msg, 'err');
      break;
    }

    /* --- 营业中 --- */
    case 'rush': {
      if (bossSkill(s)) { UI.toast('⚡ 老板亲自上阵！全员加速', 'gold'); SFX.up(); TUT.notify('boss'); }
      break;
    }
    case 'pause': {
      const p = togglePause(s);
      UI.toast(p ? '⏸ 已暂停' : '▶ 继续营业', 'ok');
      return;
    }
    case 'restock': UI.showRestock(); return;
    case 'rbug': {
      const r = buyIng(s, id, +el.dataset.q, CFG.RESTOCK_MARKUP);
      if (r.ok) UI.toast(`紧急进货 ${ingById(id).emoji}${r.qty} · -${money(r.cost)}`, 'ok');
      else UI.toast(r.msg, 'err');
      UI.showRestock();
      return;
    }
    /* V5 章节关卡：选难度档（备货阶段，打烊时结算） */
    case 'stagediff': {
      const r = setStageDiff(s, id);
      if (r.ok) {
        const sv = stageView(s);
        const d = sv.diffs.find(x => x.id === r.diff);
        UI.toast(`🏔️ 关卡难度：${d.emoji}${d.name} · 目标 ${d.goal} · 奖励 ${money(d.cash)}`, 'ok');
        SFX.click();
      }
      break;
    }
    /* 营业中两个即时决策（V2） */
    case 'sale': {
      const r = flashSale(s);
      if (r.ok) {
        UI.toast(`📣 限时促销 ${r.seconds} 秒：客流大涨，每杯 -${money(CFG.SALE_UNIT_SUB)}`, 'gold');
        SFX.up();
      } else UI.toast(r.msg, 'err');
      return;
    }
    case 'pullmenu': {
      const r = pullMenu(s);
      if (r.ok) {
        UI.toast(`📥 已下架 ${r.emoji} ${r.name}（今天只卖了 ${r.sold} 杯）`, 'gold');
        UI.renderHUD();
        SFX.click();
      } else UI.toast(r.msg, 'err');
      return;
    }
    case 'closeearly': {
      if (s.sim) { s.sim.closing = true; UI.toast('🔔 提前打烊', 'ok'); }
      break;
    }

    /* --- 结算 / 事件 --- */
    case 'nextday': {
      UI.closeModal();
      $('modal').dataset.lock = '0';
      /* 打烊三选一：有卡包就先选，选完再进下一天 */
      if (s.cardOffer && s.cardOffer.length) { UI.showCardDraft(); autoSave(s); return; }
      enterNextDay();
      return;
    }
    case 'pickcard': {
      const card = applyCard(s, id);
      UI.closeModal();
      $('modal').dataset.lock = '0';
      if (card) {
        UI.toast(`🃏 采纳「${card.emoji} ${card.name}」${card.gain} · 代价 ${card.cost}`, 'gold');
        SFX.up();
      }
      enterNextDay();
      return;
    }
    case 'skipcard': {
      UI.closeModal();
      $('modal').dataset.lock = '0';
      s.cardOffer = null;
      UI.toast('🚫 这次都不采纳（保留现有经营路线）', 'ok');
      enterNextDay();
      return;
    }
    case 'eventopt': {
      const msgs = applyEvent(s, s.pendingEvent, +el.dataset.i);
      UI.closeModal();
      $('modal').dataset.lock = '0';
      UI.toast('📌 ' + (msgs.join('，') || '已处理'), 'ok');
      UI.renderAll();
      autoSave(s);
      return;
    }

    /* --- 结局页 --- */
    case 'again': {
      const d = s ? s.diff : chosenDiff;
      clearSave();
      RNG.clear(); QUEST_RNG.clear();
      startGame(d);
      return;
    }
    case 'home': {
      UI.closeModal();
      UI.stageEnd();
      UI.showScreen('screen-title');
      renderTitle();
      return;
    }
  }
  pump();
}

/* iOS/Safari 的 AudioContext 必须由「用户手势」解锁，且必须在手势的同步调用栈里。
   这里在任何可能的手势入口挂一次性解锁，保证玩家怎么点都能出声。
   passive:true 避免拖慢滚动；capture 保证不被 stopPropagation 拦掉。 */
['pointerdown', 'touchstart', 'click'].forEach(evt => {
  document.addEventListener(evt, () => SFX.resume(), { capture: true, passive: true, once: true });
});

/* ---------------- 事件绑定 ---------------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'ratio' || act === 'mkt') return;
  SFX.resume();
  /* 还没开局（停在标题页）时，只允许标题页自己的几个操作。
     其余动作都要依赖 window.S，放过去只会在 doAct 里炸。 */
  if (window.S === null && !TITLE_ACTS.includes(act)) return;
  doAct(act, el);
});

document.addEventListener('input', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !window.S) return;
  const s = window.S;
  if (el.dataset.act === 'ratio') {
    const rid = el.dataset.id;
    setRatio(s, rid, +el.value / 100);
    const rc = el.closest('.rc');
    const r = recipeById(rid);
    const price = priceOf(s, rid), cost = costOf(s, rid);
    rc.querySelector('.pv').textContent = '×' + s.ratios[rid].toFixed(2);
    rc.querySelector('.rc-m').innerHTML =
      `售价 <b style="color:var(--amber)">¥${price}</b> · 成本 ¥${cost.toFixed(1)} · 毛利 ¥${(price - cost).toFixed(1)}`;
  } else if (el.dataset.act === 'mkt') {
    s.marketing = +el.value;
    const card = el.closest('.card');
    card.querySelector('.ch-sub').textContent = `投入 ¥${s.marketing} → 客流 ×${marketingMul(s.marketing).toFixed(2)}`;
    const f = $('mktForecast');
    if (f) f.innerHTML = `预计客流 <b style="color:var(--cyan)">${trafficOf(s)} 人</b> · 出杯位 <b style="color:var(--cyan)">${stationCount(s)} 个</b> · 单杯耗时 ${(CFG.BASE_SERVICE / (1 + .2 * s.up.speed) / (1 + .12 * s.up.training)).toFixed(2)}s`;
  }
});


/* 经营维度的下拉（省 / 市 / 区）走 change 而不是 input：
   下拉只在选中项变化时触发一次，而 input 在键盘操作时会连续触发，
   每次都重渲染面板反而会把下拉自己关掉。
   校验一律调引擎（setVenueCity），这里不复制任何规则 —— 两端口径必须一致。 */
document.addEventListener('change', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !window.S) return;
  const s = window.S;
  const act = el.dataset.act;
  const kind = el.dataset.id;
  const val = el.value;
  if (act === 'vprov') {
    /* 换省：取该省第一个城市（省列表按数据顺序一定有值，除非该省 cities 为空） */
    const list = citiesOfProvince(val);
    if (!list.length) { UI.toast('该省暂无可选城市', 'err'); return; }
    const r = setVenueCity(s, list[0].id);
    if (!r.ok) UI.toast(r.msg, 'err');
    else {
      /* 与 vcity 保持一致的口径：切换城市会影响菜单与可研菜系，必须说清楚 */
      const parts = [`已切换到${r.cityName || list[0].name}`];
      if (r.dropped && r.dropped.length) parts.push(`${r.dropped.length} 款本地菜下架`);
      if (r.cityCuisines && r.cityCuisines.length) {
        parts.push(`当地特色：${r.cityCuisines.map(id => {
          const c = cuisineById(id);
          return c ? c.name : id;
        }).join('、')}`);
      }
      UI.toast(parts.join(' · '), 'ok');
      SFX.click();
    }
    pump();
  } else if (act === 'vcity') {
    const v = s.venue || {};
    /* kind==='city' 是市级下拉；kind==='dist' 是区级下拉（只改区，不动市） */
    const r = kind === 'dist'
      ? setVenueCity(s, v.cityId, val || '')
      : setVenueCity(s, val);
    if (!r.ok) UI.toast(r.msg, 'err');
    else if (kind === 'dist') { UI.toast('已更新区级', 'ok'); SFX.click(); }
    else {
      /* ★ V10：切换城市有**实质影响**，必须告诉玩家结果 ——
         哪些本地菜下架了、当地有什么特色菜系、专属原料能不能买。
         只弹一句"已切换"的话，玩家会以为菜单卡消失了是 bug。 */
      const parts = [`已切换到${r.cityName || '新城市'}`];
      if (r.dropped && r.dropped.length) {
        parts.push(`${r.dropped.length} 款本地菜下架（配方已保留，换回来还能卖）`);
      }
      if (r.cityCuisines && r.cityCuisines.length) {
        parts.push(`当地特色：${r.cityCuisines.map(id => {
          const c = cuisineById(id);
          return c ? c.name : id;
        }).join('、')}`);
      }
      if (r.cityIngs && r.cityIngs.length) {
        parts.push(`专属原料：${r.cityIngs.length} 种`);
      }
      UI.toast(parts.join(' · '), 'ok');
      SFX.click();
    }
    pump();
  }
});
document.querySelectorAll('.tab').forEach(b => {
  b.addEventListener('click', () => UI.setTab(b.dataset.tab));
});

$('btnStart').addEventListener('click', () => startGame(chosenDiff));
$('btnContinue').addEventListener('click', () => {
  const s2 = loadGame();
  if (!s2) {
    /* ★ V20：区分「槽位本来就是空的」与「存档坏了但已尽力恢复」。
       原来的提示只有「当前存档槽是空的」——
       而存档损坏时玩家看到的也是这句，他会以为进度没了。 */
    const anySave = hasAnySave();
    UI.toast(anySave ? '存档读取失败，可尝试「导入存档」恢复'
      : '当前存档槽是空的', 'err');
    return;
  }
  const off = claimOffline(s2);
  SFX.resume();
  startGame(s2.diff, s2);
  if (s2.recoveredFromBackup) {
    /* ★ 必须告诉玩家：静默恢复会让他以为进度莫名倒退。 */
    UI.toast('⚠️ 主存档损坏，已从备份恢复（进度可能少一点）', 'err');
  }
  if (off) { UI.showOffline(off); SFX.coin(); }
});
$('btnDaily').addEventListener('click', () => doAct('daily', $('btnDaily')));
$('btnDailyRank').addEventListener('click', () => doAct('dailyrank', $('btnDailyRank')));
$('btnImport').addEventListener('click', () => UI.showImport());
$('btnExport').addEventListener('click', () => UI.showExport());
$('btnChart').addEventListener('click', () => { SFX.click(); UI.showChart(); });
$('btnPause').addEventListener('click', () => doAct('pause', $('btnPause')));
$('btnHelp').addEventListener('click', () => { SFX.resume(); UI.showHelp(); });
$('btnHelp2').addEventListener('click', () => { SFX.resume(); UI.showHelp(); });
$('btnSave').addEventListener('click', () => {
  const okSave = autoSave(window.S);
  if (okSave) UI.toast(`💾 已保存到槽 ${getSlot() + 1}`, 'ok');
  else UI.toast('⚠️ 保存失败：浏览器存储不可用', 'err');
  SFX.click();
  UI.renderSlots();
});
$('btnQuit').addEventListener('click', () => {
  /* 主循环只看 phase==='open' 就继续 tick。退出前不停掉营业，回到标题页后
     这一天照样打完，随后结算弹窗会盖在标题页上；存档里 phase 还会被写成 'prep'，
     和内存里的 'open' 不一致。 */
  if (window.S && window.S.phase === 'open' && window.S.sim) togglePause(window.S, true);
  autoSave(window.S);
  TUT.stop();
  UI.stageEnd();
  UI.showScreen('screen-title');
  renderTitle();
});
$('btnRush').addEventListener('click', () => doAct('rush', $('btnRush')));
$('btnRestock').addEventListener('click', () => doAct('restock', $('btnRestock')));
$('btnClose').addEventListener('click', () => doAct('closeearly', $('btnClose')));
/* 营业中两个即时决策（V2） */
$('btnSale').addEventListener('click', () => doAct('sale', $('btnSale')));
$('btnPull').addEventListener('click', () => doAct('pullmenu', $('btnPull')));

document.addEventListener('keydown', e => {
  if (!window.S) return;
  /* 弹窗开着时不触发营业快捷键，两个原因：
     ① preventDefault 会吞掉弹窗里聚焦按钮的空格激活 —— 键盘用户
        （桌面端 + 外接键盘）点不动补货弹窗里的「+10 / +30」；
     ② 老板技能 / 暂停会在弹窗背后触发，玩家看不到任何反馈，
        只会以为「按键坏了」。 */
  if ($('modal').classList.contains('on')) return;
  if (e.code === 'Space' && window.S.phase === 'open') {
    e.preventDefault();
    SFX.resume();
    doAct('rush', $('btnRush'));
  }
  if (e.code === 'KeyP' && window.S.phase === 'open') { e.preventDefault(); doAct('pause', $('btnPause')); }
});

/* ---------------- 主循环 ---------------- */
let lastT = performance.now();
function loop(now) {
  /* 先续帧再干活：把 requestAnimationFrame 放在末尾的话，
     任何一帧抛异常都会让整条 rAF 链断掉 —— 画面静止、点击无反应，
     控制台只留一条报错。（小游戏版已经修过同一处，这里保持一致。） */
  requestAnimationFrame(loop);

  const dt = (now - lastT) / 1000;
  lastT = now;
  const s = window.S;
  /* ★ V17：候选人刷新冷却**必须与阶段无关**地递减 ——
     放在 `if (phase==='open')` 外面的话，
     玩家在备货阶段点了刷新，冷却永远不减 ——
     表现为「按钮一直灰着但不知道为什么」。 */
  if (s) tickCooldowns(s, dt);
  if (s && s.phase === 'open' && s.sim) {
    tick(s, dt);
    UI.stageSync();
    UI.renderHUD();
    /* 出杯/流失是在 tick 里发生的，不走 doAct，所以营业中途达成的任务要在这里补弹 */
    emitQuests();
    if (s.phase === 'report') onDayEnd();
  }
}
requestAnimationFrame(loop);

/* ---------------- 自动保存 ---------------- */
setInterval(() => { if (window.S && window.S.phase !== 'open') autoSave(window.S); }, 5000);

/* iOS Safari 上 beforeunload 基本不触发（用户从后台上滑关掉页面时完全丢失），
   pagehide 才是 iOS 唯一可靠的离场信号。两者都挂，谁先到算谁。 */
function saveOnLeave() { if (window.S && window.S.phase !== 'open') autoSave(window.S); }
window.addEventListener('beforeunload', saveOnLeave);
window.addEventListener('pagehide', saveOnLeave);

document.addEventListener('visibilitychange', () => {
  if (!window.S) return;
  if (document.hidden) {
    /* 营业中切后台 → 自动暂停，回来不会发现时间被吃掉 */
    if (window.S.phase === 'open' && window.S.sim) {
      togglePause(window.S, true);
      UI.toast('⏸ 已自动暂停（切回页面可继续）', 'ok');
    }
    if (window.S.phase !== 'open') autoSave(window.S);
  }
});

/* ---------------- 启动 ---------------- */
TUT.load();
renderTitle();
setInterval(() => { $('titleTip').textContent = pick(TIPS); }, 6000);
