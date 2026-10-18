'use strict';
/* ============================================================
 *  小游戏主控：画布 / 主循环 / 输入 / 行为分发
 *
 *  与 H5 版 js/main.js 是同构的：同一套行为分发、同一个游戏流程，
 *  区别只在「拿不到 DOM」这件事带来的三处差异：
 *    1. 命中检测代替了 [data-act] + closest()
 *    2. 滚动要自己算（惯性 + 边界），事件换成触摸流
 *    3. 音频在无 WebAudio 的环境里静默降级
 * ============================================================ */

/* 引擎层用 window.S 存当前局面；小游戏没有 window，这里用模块内变量顶上，
   engine.js 本身从不碰 window.S（那是 UI 层的约定），所以不影响复用。 */
var _S = null;
var _META = loadMeta();
function S() { return _S; }
function META() { return _META; }

/* ---------------- 画布 ---------------- */
var canvas = null, ctx = null, CW = 375, CH = 667;

function setupCanvas() {
  canvas = PLAT.createCanvas();
  var i = PLAT.info();
  CW = i.w; CH = i.h;
  /* 安全区内边距全局只在这里读一次，之后所有布局都从 VIEW.ins 取。
     刘海机型上顶部 HUD 会被挖孔压住，底部按钮会被 Home 指示条盖住，
     没有这一层，营业中「暂停 / 提前打烊」根本点不到。 */
  VIEW.ins = { top: i.insTop || 0, bottom: i.insBottom || 0 };
  var dpr = i.dpr;
  canvas.width = Math.round(CW * dpr);
  canvas.height = Math.round(CH * dpr);
  ctx = canvas.getContext('2d');
  /* 之后所有绘制都用 CSS 像素坐标，DPR 只在这一行体现 ——
     否则业务代码里会到处乘除 dpr，改一处漏一处。 */
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* ---------------- 反馈层 ---------------- */
function toast(msg) {
  VIEW.toasts.push({ msg: msg, life: 1900 });
  if (VIEW.toasts.length > 4) VIEW.toasts.shift();
}
function floater(x, y, txt, kind) {
  VIEW.floaters.push({ x: x, y: y, text: txt, kind: kind || 'good', life: 800 });
}
function confetti(n) {
  var colors = [T.pink, T.purple, T.cyan, T.amber, T.green];
  /* 手机 GPU 扛不住几十个同时动的节点，窄屏减半 */
  var count = Math.round((n || 40) * (CW < 500 ? 0.45 : 1));
  for (var i = 0; i < count; i++) {
    VIEW.confetti.push({
      x: Math.random() * CW, y: -10 - Math.random() * 120,
      c: colors[Math.floor(Math.random() * colors.length)],
      s: 3 + Math.random() * 4, life: 1400,
    });
  }
}

var AUDIO = null;
function beep(kind, freq, dur) {
  if (!VIEW.sound || !AUDIO) return;
  AUDIO.play(kind, freq, dur);
}

/* ---------------- 主循环 ---------------- */
var lastT = 0;
function loop(now) {
  /* 先续帧，再干活。
     把 requestAnimationFrame 放在末尾的话，任何一帧抛异常都会让整条 rAF 链断掉 ——
     画面从此静止、触摸再无反应，而控制台只留一条报错。
     先续帧能保证「最坏情况只是丢一帧」，而不是整局卡死。 */
  requestAnimationFrame(loop);

  var dt = lastT ? (now - lastT) / 1000 : 0;
  lastT = now;
  /* 切后台回来时 dt 会是个巨大值，必须夹住，否则一天瞬间烧完 */
  if (!isFinite(dt) || dt < 0) dt = 0;
  if (dt > 0.1) dt = 0.1;

  step(dt);
  draw(ctx, CW, CH, now);
}

function step(dt) {
  var ms = dt * 1000;

  /* 营业推进 */
  var s = _S;
  if (s && s.phase === 'open' && s.sim) {
    tick(s, dt);
    syncStageFeel(s);
    if (s.phase === 'report') onDayEnd();
  }
  if (s && s.phase === 'prep' && s.pendingEvent && !VIEW.modal) {
    VIEW.modal = { type: 'event' };
  }

  /* 反馈层衰减 */
  var i;
  for (i = VIEW.toasts.length - 1; i >= 0; i--) {
    VIEW.toasts[i].life -= ms;
    if (VIEW.toasts[i].life <= 0) VIEW.toasts.splice(i, 1);
  }
  for (i = VIEW.floaters.length - 1; i >= 0; i--) {
    VIEW.floaters[i].life -= ms;
    if (VIEW.floaters[i].life <= 0) VIEW.floaters.splice(i, 1);
  }
  for (i = VIEW.confetti.length - 1; i >= 0; i--) {
    VIEW.confetti[i].life -= ms;
    if (VIEW.confetti[i].life <= 0) VIEW.confetti.splice(i, 1);
  }

  /* 提示语轮播 */
  VIEW.tipT = (VIEW.tipT || 0) + ms;
  if (VIEW.tipT > 6000) {
    VIEW.tipT = 0;
    VIEW.tip = pick(TIPS);
  }
}

/** 出杯 / 流失的即时反馈：音效 + 飘字。模拟「点一下有反应」的手感来源 */
function syncStageFeel(s) {
  if (!s.sim) return;
  var served = Math.round(num(s.sim.cups));
  if (served !== VIEW.lastServed) {
    if (served > VIEW.lastServed) {
      beep('up', 660, 0.09);
      for (var k = 0; k < served - VIEW.lastServed; k++) {
        floater(40 + Math.random() * (CW - 80), CH * 0.42, '+', 'good');
      }
    }
    VIEW.lastServed = served;
  }
  var lost = Math.round(num(s.sim.lost));
  if (lost !== VIEW.lastLost) {
    if (lost > VIEW.lastLost) beep('down', 140, 0.16);
    VIEW.lastLost = lost;
  }
}

/* ---------------- 输入 ---------------- */
var down = { x: 0, y: 0, t: 0, hit: null, dragging: false, scroll0: 0, y0: 0 };

function onDown(x, y) {
  if (AUDIO) AUDIO.resume();
  down.x = x; down.y = y; down.y0 = y; down.t = Date.now();
  down.dragging = false;
  down.hit = GFX.hitAt(x, y);
  down.scroll0 = VIEW.scroll[VIEW.tab] || 0;
  VIEW.pressedAct = down.hit ? { act: down.hit.act, id: down.hit.id, extra: down.hit.extra } : null;
}

function onMove(x, y) {
  /* 注意这里不能要求「起手必须落在某个按钮上」：
     面板上大片区域是文本和卡片空白，手指落在那里才是常态。
     如果只有按在按钮上才能滑，玩家会以为列表卡住了。 */
  var dy = y - down.y0;
  if (!down.dragging && Math.abs(dy) > 6) down.dragging = true;
  if (!down.dragging) return;
  /* 只有面板区才滚；舞台和弹窗不滚 */
  if (VIEW.modal || VIEW.tut.on) return;
  var s = _S;
  if (s && s.phase === 'open') return;
  var L = CV.layoutOf(CW, CH);
  var max = Math.max(0, CV.contentHeight - (CH - L.bodyY));
  VIEW.scroll[VIEW.tab] = Math.max(0, Math.min(max, down.scroll0 - dy));
}

function onUp(x, y) {
  var held = Date.now() - down.t;
  var moved = Math.abs(y - down.y0) + Math.abs(x - down.x);
  var hit = down.hit;
  VIEW.pressedAct = null;
  down.hit = null;
  if (down.dragging || moved > 12 || held > 700) { down.dragging = false; return; }
  if (!hit) return;
  doAct(hit.act, hit.id, hit.extra);
}

/* ---------------- 行为分发 ---------------- */
function doAct(act, id, extra) {
  var s = _S;

  /* 引导优先吞掉事件，避免玩家在引导里误触到后面的按钮 */
  if (VIEW.tut.on) {
    if (act === 'tutnext') { tutNext(); return; }
    if (act === 'tutskip') { tutStop(); return; }
    return;
  }

  /* --- 标题页 --- */
  if (act === 'diff') { VIEW.diff = id; beep('up', 520, 0.06); return; }
  if (act === 'start') { beep('up', 700, 0.1); startGame(VIEW.diff, null, false); return; }
  if (act === 'continue') {
    var s2 = loadGame();
    if (!s2) { toast('当前存档槽是空的'); return; }
    beep('up', 700, 0.1);
    var off = claimOffline(s2);
    startGame(s2.diff, s2, false);
    if (off) { VIEW.modal = { type: 'confirm', title: '🕐 离线收益', text: offText(off), okText: '收下', okKind: 'amber', okAct: 'close' }; }
    return;
  }
  if (act === 'daily') {
    RNG.setSeed(seedFromText('bubble-' + todayKey()));
    var ds = newGame('normal', _META.bp);
    ds.daily = true;
    _META.runs++;
    saveMeta(_META);
    startGame('normal', ds, true);
    toast('📅 每日挑战 ' + todayKey() + ' · 全网同一局');
    return;
  }
  if (act === 'import') { VIEW.modal = { type: 'import' }; return; }
  if (act === 'doimport') {
    /* 小游戏里没有文本输入框，只能从剪贴板读 */
    var got = null;
    try {
      if (typeof tt !== 'undefined' && tt.getClipboardData) {
        got = tt.getClipboardData({ success: function (r) { doImportText(r.data); } });
      }
    } catch (e) { got = null; }
    if (!got) {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText) {
          navigator.clipboard.readText().then(doImportText);
        }
      } catch (e) { /* 读不到就提示玩家 */ }
    }
    return;
  }
  if (act === 'slot') { setSlot(clamp(+id | 0, 0, CFG.SAVE_SLOTS - 1)); beep('up', 520, 0.06); return; }

  /* --- 弹窗通用 --- */
  if (act === 'close') { VIEW.modal = null; return; }
  if (act === 'sound') {
    VIEW.sound = !VIEW.sound;
    _META.sound = VIEW.sound; saveMeta(_META);
    toast(VIEW.sound ? '🔊 音效已开' : '🔇 音效已关');
    return;
  }

  /* 标题页只放行上面这些 */
  if (!s) return;

  /* --- 全局 --- */
  if (act === 'tab') { VIEW.tab = id; VIEW.scroll[id] = 0; beep('up', 560, 0.05); return; }
  if (act === 'help') { VIEW.modal = { type: 'help' }; return; }
  if (act === 'chart') { VIEW.modal = { type: 'report', day: s.day }; return; }
  if (act === 'save') { autoSave(s); toast('💾 已保存到槽 ' + (getSlot() + 1)); return; }
  if (act === 'home') { autoSave(s); VIEW.screen = 'title'; VIEW.modal = null; return; }
  if (act === 'nextday') {
    VIEW.modal = null;
    nextDay(s);
    if (isFinished(s)) { finishRun('finish'); return; }
    autoSave(s);
    toast('🌅 Day ' + s.day + ' 开始 · ' + (s.weather ? s.weather.emoji + ' ' + s.weather.name : ''));
    return;
  }
  if (act === 'eventopt') {
    var msgs = applyEvent(s, s.pendingEvent, +id);
    VIEW.modal = null;
    toast('📌 ' + (msgs.join('，') || '已处理'));
    autoSave(s);
    return;
  }

  /* --- 经营面板 --- */
  if (act === 'buy') {
    var r = buyIng(s, id, num(extra, 10));
    if (r.ok) beep('up', 600, 0.06); else toast(r.msg);
    return;
  }
  if (act === 'ratio') {
    var rid = id;
    setRatio(s, rid, num(s.ratios[rid], 1) + num(extra, 0.05));
    return;
  }
  if (act === 'mkt') { s.marketing = num(id, 0); return; }
  if (act === 'toggle') {
    var ix = (s.menu || []).indexOf(id);
    if (ix >= 0) s.menu.splice(ix, 1);
    else if ((s.menu || []).length < menuSlots(s)) s.menu.push(id);
    else toast('菜单位不足，先升级「菜单位」');
    return;
  }
  if (act === 'research') {
    var cr = canResearch(s, id);
    if (!cr.ok) { toast(cr.msg); return; }
    doResearch(s, id);
    beep('up', 720, 0.12);
    toast('🧪 新配方解锁！');
    return;
  }
  if (act === 'upgrade') {
    var ur = doUpgrade(s, id);
    if (ur.ok) { beep('up', 760, 0.12); toast('⬆️ ' + UPGRADES.filter(function (u) { return u.id === id; })[0].name + ' 升级！'); }
    else toast(ur.msg);
    return;
  }
  if (act === 'shop') {
    var os = openShopBranch(s);
    if (os.ok) { beep('up', 780, 0.14); toast('🏪 第 ' + s.shops + ' 家分店开张！'); }
    else toast(os.msg);
    return;
  }
  if (act === 'hire') {
    var hr = hireStaff(s, +id);
    if (hr.ok) { beep('up', 700, 0.1); toast('👤 ' + hr.staff.name + ' 加入，出杯位 +1'); }
    else toast(hr.msg);
    return;
  }
  if (act === 'fire') {
    var fr = fireStaff(s, +id);
    if (fr.ok) toast('已解雇，遣散费 ' + money(fr.sev)); else toast(fr.msg || '无法解雇');
    return;
  }
  if (act === 'rivalact') {
    var ar = rivalAction(s, id);
    toast('🏙️ ' + (ar.msg || '行动完成'));
    return;
  }
  if (act === 'prestige') {
    var gain = prestigeGain(s);
    VIEW.modal = {
      type: 'confirm', title: '♻️ 品牌升级',
      text: '把 ' + money(netWorth(s)) + ' 净资产转化为 +' + gain + ' ★ 永久声望。'
        + '转生后本局进度重置，但声望永久保留（客流 +'
        + (_META.bp + gain) * 2 + '%）。',
      okText: '确认转生', okKind: 'amber', okAct: 'prestige2',
    };
    return;
  }
  if (act === 'prestige2') {
    var g2 = prestigeGain(s);
    _META.bp += g2;
    _META.maxBpEarned = Math.max(_META.maxBpEarned || 0, _META.bp);
    _META.best[s.diff] = Math.max(_META.best[s.diff] || 0, Math.round(netWorth(s)));
    for (var k in s.ach) _META.ach[k] = true;
    saveMeta(_META);
    clearSave();
    VIEW.modal = null;
    toast('🌟 转生成功！声望 ' + _META.bp + ' ★');
    confetti(60);
    startGame(s.diff, null, false);
    return;
  }
  if (act === 'finish') {
    VIEW.modal = {
      type: 'confirm', title: '🏁 提前收官？',
      text: '以当前净资产 ' + money(netWorth(s)) + ' 结束本局。',
      okText: '确认收官', okKind: 'primary', okAct: 'finish2',
    };
    return;
  }
  if (act === 'finish2') { VIEW.modal = null; finishRun('finish'); return; }

  /* --- 营业中 --- */
  if (act === 'open') {
    var op = openShop(s);
    if (!op.ok) { toast(op.msg); return; }
    VIEW.lastServed = 0; VIEW.lastLost = 0;
    beep('up', 660, 0.12);
    return;
  }
  if (act === 'rush') {
    var rx = rushStation(s, +id);
    if (rx) {
      beep('up', 880, 0.07);
      floater(CW / 2, CH * 0.45, '+¥' + rx.tip.toFixed(1), 'good');
      if (rx.combo >= 5) toast('🔥 ' + rx.combo + ' 连击！');
    }
    return;
  }
  if (act === 'boss') {
    if (bossSkill(s)) { beep('up', 900, 0.18); toast('⚡ 老板亲自上阵！全员加速'); }
    return;
  }
  if (act === 'pause') { var p = togglePause(s); toast(p ? '⏸ 已暂停' : '▶ 继续营业'); return; }
  if (act === 'restock') { VIEW.modal = { type: 'restock' }; return; }
  if (act === 'closeearly') {
    if (s.sim) { s.sim.closing = true; toast('🔔 提前打烊'); }
    return;
  }
  if (act === 'rbug') {
    var br = buyIng(s, id, num(extra, 10), CFG.RESTOCK_MARKUP);
    if (br.ok) toast('紧急进货 ' + ingById(id).emoji + br.qty + ' · -' + money(br.cost));
    else toast(br.msg);
    return;
  }

  /* --- 结局页 --- */
  if (act === 'again') {
    var d = s ? s.diff : VIEW.diff;
    clearSave();
    RNG.clear();
    startGame(d, null, false);
    return;
  }
}

function doImportText(text) {
  var t = String(text || '').trim();
  var r = importSave(t);
  if (!r || !r.ok) { VIEW.importMsg = '存档码无效或已损坏'; return; }
  VIEW.modal = null;
  VIEW.importMsg = '';
  startGame(r.state.diff, r.state, false);
  toast('📥 存档导入成功');
}

function offText(o) {
  return '离线 ' + (o.hours || 0) + ' 小时，外卖带来 ' + money(o.income || 0) + ' 收入。';
}

/* ---------------- 流程 ---------------- */
function startGame(diff, loaded, keepSeed) {
  if (!loaded && !keepSeed) RNG.clear();
  var s = loaded || newGame(diff, _META.bp);
  _S = s;
  if (!loaded) { _META.runs++; saveMeta(_META); }
  VIEW.screen = 'game';
  VIEW.tab = 'manage';
  VIEW.scroll = { manage: 0, lab: 0, up: 0, staff: 0, rival: 0, ach: 0 };
  VIEW.modal = null;
  autoSave(s);
  /* 首次游玩自动开引导；读档则续上未完成的进度 */
  if (loaded && s.tut && !s.tut.done && s.tut.step > 0 && s.tut.step < TUTORIAL.length) {
    tutStart(s.tut.step);
  } else if (!loaded && !_META.tutDone) {
    tutStart(0);
  }
}

function autoSave(s) {
  var ok = saveGame(s);
  if (!ok && !VIEW.storageWarned) {
    VIEW.storageWarned = true;
    toast('⚠️ 存储不可用，本局进度无法保存');
  }
  return ok;
}

function onDayEnd() {
  var s = _S;
  VIEW.modal = null;
  emitAchievements(s);
  autoSave(s);
  if (isBankrupt(s)) { finishRun('bankrupt'); return; }
  if (isFinished(s)) { finishRun('finish'); return; }
  if (s.endlessLevelUp) toast('🏆 里程碑达成！新目标 ' + money(goalOf(s)));
  VIEW.modal = { type: 'report', day: s.day };
}

function emitAchievements(s) {
  var got = [];
  if (s.newAchList && s.newAchList.length) { got = s.newAchList; s.newAchList = []; }
  else got = checkAchievements(s);
  if (!got.length) return;
  for (var i = 0; i < got.length; i++) {
    toast('🏅 ' + got[i].emoji + ' ' + got[i].name + '  +' + money(got[i].reward.cash || 0) + ' ' + got[i].reward.bp + '★');
  }
  confetti(24);
}

function finishRun(kind) {
  var s = _S;
  var nw = netWorth(s);
  _META.best[s.diff] = Math.max(_META.best[s.diff] || 0, Math.round(nw));
  for (var k in s.ach) _META.ach[k] = true;
  if (s.daily) {
    var key = todayKey();
    if (_META.dailyDate !== key || (_META.dailyBest || 0) < nw) {
      _META.dailyDate = key; _META.dailyBest = Math.round(nw);
    }
  }
  saveMeta(_META);
  clearSave();

  var ratio = nw / Math.max(1, num(goalOf(s), 1));
  var e = '🎉', tt = '目标达成', g = 'B';
  if (kind === 'bankrupt') { e = '💸'; tt = '资金链断裂'; g = 'F'; }
  else if (ratio >= 2) { e = '👑'; tt = '奶茶帝国！'; g = 'S'; }
  else if (ratio >= 1.35) { e = '🏆'; tt = '连锁巨头'; g = 'A'; }
  else if (ratio >= 1) { g = 'B'; }
  else if (ratio >= 0.6) { e = '🌱'; tt = '小有起色'; g = 'C'; }
  else { e = '😵'; tt = '创业未遂'; g = 'D'; }

  var st = s.stats || {};
  VIEW.end = {
    emoji: e, title: tt, grade: g,
    sub: kind === 'bankrupt'
      ? '你在 Day ' + s.day + ' 破产了，店铺被房东收回。'
      : (ratio >= 1 ? '净资产 ' + money(nw) + '，超额完成目标！'
        : '净资产 ' + money(nw) + '，距离目标还差 ' + money(Math.max(0, num(goalOf(s)) - nw)) + '。'),
    items: [
      { k: '最终净资产', v: money(nw) },
      { k: '经营天数', v: st.days + ' 天' },
      { k: '累计卖出', v: st.totalCups + ' 杯' },
      { k: '累计营收', v: money(st.totalRevenue) },
    ],
  };
  VIEW.screen = 'end';
  confetti(60);
}

/* ---------------- 新手引导 ---------------- */
var TUT_RECT = {
  hud: function () { return { x: 16, y: 8, w: CW - 32, h: 52 }; },
  advice: function () { var L = CV.layoutOf(CW, CH); return { x: 16, y: L.bodyY + 300, w: CW - 32, h: 60 }; },
  market: function () { var L = CV.layoutOf(CW, CH); return { x: 16, y: L.bodyY + 220, w: CW - 32, h: 60 }; },
  menu: function () { var L = CV.layoutOf(CW, CH); return { x: 16, y: L.bodyY + 100, w: CW - 32, h: 60 }; },
  grow: function () { var L = CV.layoutOf(CW, CH); return { x: 0, y: L.bodyY, w: CW, h: L.tabH }; },
  open: function () { var L = CV.layoutOf(CW, CH); return { x: 16, y: L.bodyY + 340, w: CW - 32, h: 48 }; },
  station: function () { return { x: 16, y: CH * 0.42, w: CW - 32, h: 76 }; },
  boss: function () { return { x: 16, y: CH - 92, w: (CW - 44) / 2, h: 42 }; },
  finish: function () { var L = CV.layoutOf(CW, CH); return { x: 0, y: L.hudH, w: CW, h: L.tabH }; },
};

function tutStart(step) {
  VIEW.tut = { on: true, step: step || 0, rect: null };
  if (_S) _S.tut = { active: true, step: VIEW.tut.step, done: false };
  tutSync();
}
function tutSync() {
  var st = TUTORIAL[VIEW.tut.step];
  if (!st) { VIEW.tut.rect = null; return; }
  var f = TUT_RECT[st.key];
  /* 按步骤切到对应 Tab，玩家才看得懂在讲什么 */
  if (st.tab && PANELS[st.tab] && VIEW.screen === 'game') VIEW.tab = st.tab;
  VIEW.tut.rect = f ? f() : null;
}
function tutNext() {
  VIEW.tut.step++;
  if (VIEW.tut.step >= TUTORIAL.length) { tutStop(); return; }
  if (_S) _S.tut = { active: true, step: VIEW.tut.step, done: false };
  tutSync();
}
function tutStop() {
  VIEW.tut = { on: false, step: 0, rect: null };
  _META.tutDone = true; saveMeta(_META);
  if (_S) _S.tut = { active: false, step: 0, done: true };
  toast('🎓 教程完成，祝你生意兴隆！');
}

/* ---------------- 启动 ---------------- */
function boot() {
  setupCanvas();
  VIEW.diff = 'normal';
  VIEW.sound = _META.sound !== false;
  VIEW.tip = pick(TIPS);
  AUDIO = PLAT.createAudio();
  if (!AUDIO.available) {
    /* 小游戏没有 WebAudio：接口在、实现空，玩家不会看到报错 */
    VIEW.sound = false;
  }
  PLAT.bindTouch(canvas, onDown, onMove, onUp);
  requestAnimationFrame(loop);
}

if (typeof globalThis !== 'undefined') {
  globalThis.__MINIGAME = {
    boot: boot, doAct: doAct, startGame: startGame, finishRun: finishRun,
    toast: toast, step: step, draw: draw,
    onDown: onDown, onMove: onMove, onUp: onUp,
    get S() { return _S; }, get META() { return _META; },
    get canvas() { return canvas; },
    get ctx() { return ctx; },
    get size() { return { w: CW, h: CH }; },
  };
}
