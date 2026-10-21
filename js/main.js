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
  const got = checkAchievements(s);
  if (got && got.length) {
    /* ★ 只在跨局首次达成时给，之后重复达成仍有现金但没有 ★ */
    const firsts = claimAchStars(window.META, got);
    if (firsts.length) saveMeta(window.META);
    got.forEach((a, i) => setTimeout(() => {
      UI.toast(`🏅 ${a.emoji} ${a.name}  +${money(a.reward.cash || 0)}`
        + (firsts.indexOf(a.id) >= 0 ? ` ${a.reward.bp}★` : ''), 'gold');
      UI.confetti(22); SFX.ach();
    }, i * 400));
  }
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
  UI.showReport();
}

/** 弹出成就（去掉 s.newAchList 里的已消费项，避免重复） */
function emitAchievements() {
  const s = window.S;
  let got = [];
  if (s.newAchList && s.newAchList.length) { got = s.newAchList; s.newAchList = []; }
  else got = checkAchievements(s);
  if (!got.length) return;
  const firsts = claimAchStars(window.META, got);
  if (firsts.length) saveMeta(window.META);
  got.forEach((a, i) => setTimeout(() => {
    UI.toast(`🏅 ${a.emoji} ${a.name}  +${money(a.reward.cash || 0)}`
      + (firsts.indexOf(a.id) >= 0 ? ` ${a.reward.bp}★` : ''), 'gold');
    UI.confetti(22); SFX.ach();
  }, i * 400));
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
      UI.showScreen('screen-game');
      UI.setTab('manage');
      UI.renderAll();
      UI.toast(`♾️ 无尽模式！新目标 ${money(g)}`, 'gold');
      UI.confetti(50); SFX.up();
      autoSave(s);
      return;
    }
    case 'dlcard': UI.downloadCard(); return;
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
      UI.toast(r.bought ? `补货 ${r.bought} 单位 · -${money(r.spent)}` : '现金或仓位不足', r.bought ? 'ok' : 'err');
      if (r.bought) { SFX.cash(); TUT.notify('buy'); }
      break;
    }
    case 'toggle': {
      const r = toggleMenu(s, id);
      if (r === false) UI.toast(`上架位已满（${menuSlots(s)} 个），去升级「招牌展位」`, 'err');
      else { UI.toast(`${recipeById(id).name} ${r}`, 'ok'); SFX.click(); TUT.notify('toggle'); }
      break;
    }
    /* --- 营销快捷键：原来只有 data-act="mktset"，switch 里没有这个 case，
           点下去一路落到末尾的 pump()，既不改值也不报错 —— 四个按钮全是死键。 --- */
    case 'mktset': {
      s.marketing = clamp(+el.dataset.v || 0, 0, 2000);
      SFX.click();
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
      if (r.ok) { UI.toast(`🏪 第 ${s.shops} 家分店开业！`, 'gold'); UI.confetti(40); SFX.up(); }
      else UI.toast(r.msg, 'err');
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
      if (r.ok) { UI.toast(`👤 ${r.staff.emoji} ${r.staff.name} 加入！出杯位 +1`, 'ok'); SFX.up(); }
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
    else { UI.toast(`已切换到 ${list[0].name}`, 'ok'); SFX.click(); }
    pump();
  } else if (act === 'vcity') {
    const v = s.venue || {};
    /* kind==='city' 是市级下拉；kind==='dist' 是区级下拉（只改区，不动市） */
    const r = kind === 'dist'
      ? setVenueCity(s, v.cityId, val || '')
      : setVenueCity(s, val);
    if (!r.ok) UI.toast(r.msg, 'err');
    else { UI.toast(kind === 'dist' ? '已更新区级' : '已更新经营城市', 'ok'); SFX.click(); }
    pump();
  }
});
document.querySelectorAll('.tab').forEach(b => {
  b.addEventListener('click', () => UI.setTab(b.dataset.tab));
});

$('btnStart').addEventListener('click', () => startGame(chosenDiff));
$('btnContinue').addEventListener('click', () => {
  const s2 = loadGame();
  if (!s2) { UI.toast('当前存档槽是空的', 'err'); return; }
  const off = claimOffline(s2);
  SFX.resume();
  startGame(s2.diff, s2);
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
