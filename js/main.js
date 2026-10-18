/* ============================================================
 *  奶茶星球 · Bubble Tycoon  —— 启动 / 事件 / 主循环
 * ============================================================ */
'use strict';

window.META = loadMeta();
SFX.loadOptions(window.META);
window.S = null;
let chosenDiff = 'normal';

/* 标题页（window.S 为 null）也允许触发的动作 */
const TITLE_ACTS = ['diff', 'start', 'continue', 'sound', 'retut'];

/* ---------------- 开始界面 ---------------- */
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
    <span class="mchip">🏆 最高净资产 <b>${money(m.best.normal || 0)}</b></span>
    <span class="mchip">🎮 已玩 <b>${m.runs}</b> 局</span>`;

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
  $('titleTip').textContent = pick(TIPS);
}

/* ---------------- 开局 ---------------- */
/** keepSeed=true 时保留种子随机（每日挑战需要整局可复现） */
function startGame(diff, loaded, keepSeed) {
  if (!loaded && !keepSeed) RNG.clear();
  const s = loaded || newGame(diff, window.META.bp);
  window.S = s;
  if (!loaded) {
    window.META.runs++;
    saveMeta(window.META);
  }
  UI.showScreen('screen-game');
  UI.setTab('manage');
  UI.renderHUD();
  autoSave(s);
  /* 新手指引：首次游玩自动开启；读档则续上未完成的进度 */
  SFX.resume();
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
    got.forEach((a, i) => setTimeout(() => {
      UI.toast(`🏅 ${a.emoji} ${a.name}  +${money(a.reward.cash || 0)} ${a.reward.bp}★`, 'gold');
      UI.confetti(22); SFX.ach();
    }, i * 400));
  }
  UI.renderAll();
  autoSave(s);
}

/* ---------------- 一天结束 ---------------- */
function onDayEnd() {
  const s = window.S;
  UI.stageEnd();
  UI.renderHUD();
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
  got.forEach((a, i) => setTimeout(() => {
    UI.toast(`🏅 ${a.emoji} ${a.name}  +${money(a.reward.cash || 0)} ${a.reward.bp}★`, 'gold');
    UI.confetti(22); SFX.ach();
  }, i * 400));
}

/* ---------------- 收官 ---------------- */
function finishRun(kind) {
  const s = window.S;
  const m = window.META;
  const nw = netWorth(s);
  m.best[s.diff] = Math.max(m.best[s.diff] || 0, Math.round(nw));
  for (const k in s.ach) m.ach[k] = true;
  /* 每日挑战：记录当天最佳 */
  if (s.daily) {
    const key = todayKey();
    if (m.dailyDate !== key || (m.dailyBest || 0) < nw) { m.dailyDate = key; m.dailyBest = Math.round(nw); }
  }
  saveMeta(m);
  clearSave();
  UI.showEnd(kind);
}

/* ---------------- 行为分发 ---------------- */
function doAct(act, el) {
  const s = window.S;
  /* 部分分支可以不带元素调用（如再次送礼），这里兜住避免出现 TypeError */
  const id = (el && el.dataset) ? el.dataset.id : undefined;

  switch (act) {
    /* --- 标题页 --- */
    case 'diff': chosenDiff = el.dataset.id; SFX.click(); renderTitle(); return;
    case 'start': SFX.resume(); startGame(chosenDiff); return;
    case 'continue': {
      const s2 = loadGame();
      if (!s2) { UI.toast('没有可用存档', 'err'); return; }
      const off = claimOffline(s2);
      SFX.resume();
      startGame(s2.diff, s2);
      if (off) { UI.showOffline(off); SFX.coin(); }
      return;
    }

    /* --- 存档槽 --- */
    case 'slot': {
      setSlot(+el.dataset.id);
      UI.renderSlots();
      const info = slotInfo(getSlot());
      UI.toast(info ? `已选择槽 ${getSlot() + 1}（Day ${info.day}）` : `已选择槽 ${getSlot() + 1}（空）`, 'ok');
      return;
    }

    /* --- 每日挑战（日期种子，全网同一局） --- */
    case 'daily': {
      RNG.setSeed(seedFromText('bubble-' + todayKey()));
      const st = newGame('normal', window.META.bp);
      st.daily = true;
      startGame('normal', st, true);
      window.META.runs++;
      saveMeta(window.META);
      UI.toast(`📅 每日挑战 ${todayKey()} · 全网同一局`, 'gold');
      return;
    }

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
    case 'scout': {
      if (s.trendKnown) { UI.toast('已经调研过了', 'err'); break; }
      if (s.cash < 150) { UI.toast('现金不足', 'err'); break; }
      s.cash -= 150; s.trendKnown = true;
      UI.toast(`🔍 明日流行：${TAGS[s.nextTrend].emoji} ${TAGS[s.nextTrend].name}`, 'gold');
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
      const r = doResearch(s, id);
      if (r.ok) { UI.toast(`🧪 解锁 ${r.recipe.emoji} ${r.recipe.name}！`, 'gold'); UI.confetti(30); SFX.up(); }
      else UI.toast(r.msg, 'err');
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
      UI.modal(`<div class="m-title">♻️ 品牌升级</div>
        <div class="m-sub">把 ${money(netWorth(s))} 净资产转化为永久声望</div>
        <div style="text-align:center;font-size:40px;font-weight:900;color:var(--amber);margin:12px 0">+${gain} ★</div>
        <div class="rep-note">转生后本局进度重置，但声望点永久保留。<br>当前共 ${window.META.bp} ★ → <b>${window.META.bp + gain} ★</b>（客流 +${(window.META.bp + gain) * 2}%）</div>
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
    case 'closeearly': {
      if (s.sim) { s.sim.closing = true; UI.toast('🔔 提前打烊', 'ok'); }
      break;
    }

    /* --- 结算 / 事件 --- */
    case 'nextday': {
      UI.closeModal();
      $('modal').dataset.lock = '0';
      const nd = nextDay(s);
      /* 必须用 isFinished：无尽模式下 day 会超过 CFG.DAYS 但仍要继续 */
      if (isFinished(s)) { finishRun('finish'); return; }
      UI.renderAll();
      if (s.pendingEvent) UI.showEvent();
      else UI.toast(`🌅 Day ${s.day} 开始 · ${s.weather.emoji} ${s.weather.name}`, 'ok');
      autoSave(s);
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
      RNG.clear();
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
$('btnImport').addEventListener('click', () => UI.showImport());
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
  autoSave(window.S);
  TUT.stop();
  UI.stageEnd();
  UI.showScreen('screen-title');
  renderTitle();
});
$('btnRush').addEventListener('click', () => doAct('rush', $('btnRush')));
$('btnRestock').addEventListener('click', () => doAct('restock', $('btnRestock')));
$('btnClose').addEventListener('click', () => doAct('closeearly', $('btnClose')));

document.addEventListener('keydown', e => {
  if (!window.S) return;
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
