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
  /* 上限：出杯是高频事件，不封顶的话一次爆单能把飘字堆到几百条 */
  if (VIEW.floaters.length > 24) VIEW.floaters.shift();
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

/* 触感。出杯是每秒好几次的高频事件，不节流会变成持续抖动 ——
   既烦人又费电，所以短震动统一做 250ms 节流。 */
var lastBuzz = 0;
function buzz(kind) {
  var now = Date.now();
  if (kind !== 'long' && now - lastBuzz < 250) return;
  lastBuzz = now;
  PLAT.vibrate(kind);
}

/* ---------------- 主循环 ---------------- */
var lastT = 0;
/* 小游戏没有 beforeunload / pagehide 可用，进程被系统回收时上次动作以来的进度会全丢。
   这里每 5 秒兜一次底（营业中不存：中途存档无法还原现场，存了也没意义）。 */
var lastAutoSaveAt = 0;
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
  /* 出杯/流失发生在 tick 里、进货研发发生在 doAct 里，两条路都可能达成任务，
     统一在这里收口最省事（空数组时开销就是一次长度判断）。 */
  emitQuests();
  if (s && s.phase !== 'open' && Date.now() - lastAutoSaveAt > 5000) {
    lastAutoSaveAt = Date.now();
    autoSave(s);
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

/** 出杯 / 流失的即时反馈：音效 + 飘字 + 触感。模拟「点一下有反应」的手感来源 */
function syncStageFeel(s) {
  if (!s.sim) return;
  var served = Math.round(num(s.sim.cups));
  if (served !== VIEW.lastServed) {
    if (served > VIEW.lastServed) {
      beep('up', 660, 0.09);
      buzz('short');
      for (var k = 0; k < served - VIEW.lastServed; k++) {
        floater(40 + Math.random() * (CW - 80), CH * 0.42, '+', 'good');
      }
    }
    VIEW.lastServed = served;
  }
  var lost = Math.round(num(s.sim.lost));
  if (lost !== VIEW.lastLost) {
    if (lost > VIEW.lastLost) { beep('down', 140, 0.16); buzz('short'); }
    VIEW.lastLost = lost;
  }

  /* 引擎侧的三类负反馈（太贵了 / 缺料 / 走了）由 engine 推进 sim.floaters，
     H5 版在 ui.js 里渲染并清空；小游戏版以前漏了这一步 ——
     结果玩家看不到客人为什么走，而这个游戏的核心策略恰恰是
     「产能 vs 客流 vs 定价」的赛跑，看不到流失原因就学不会调参。
     不 drain 的话它还会一整天只增不减。 */
  var fl = s.sim.floaters;
  if (fl && fl.length) {
    for (var j = 0; j < fl.length; j++) {
      floater(30 + Math.random() * (CW - 60), CH * 0.5 + (Math.random() * 44 - 22),
        fl[j].text, fl[j].kind);
    }
    fl.length = 0;
  }
}

/* ---------------- 输入 ---------------- */
var down = { x: 0, y: 0, t: 0, hit: null, dragging: false, scroll0: 0, stageScroll0: 0, y0: 0 };

function onDown(x, y) {
  if (AUDIO) AUDIO.resume();
  down.x = x; down.y = y; down.y0 = y; down.t = Date.now();
  down.dragging = false;
  down.hit = GFX.hitAt(x, y);
  /* 起手就把当前滚动量记下来：面板区与出杯位区各记一份，
     onMove 里按当时处在哪个区取用，避免两个滚动量互相污染。 */
  down.scroll0 = VIEW.scroll[VIEW.tab] || 0;
  down.stageScroll0 = VIEW.stageScroll || 0;
  VIEW.pressedAct = down.hit ? { act: down.hit.act, id: down.hit.id, extra: down.hit.extra } : null;
}

function onMove(x, y) {
  /* 注意这里不能要求「起手必须落在某个按钮上」：
     面板上大片区域是文本和卡片空白，手指落在那里才是常态。
     如果只有按在按钮上才能滑，玩家会以为列表卡住了。 */
  var dy = y - down.y0;
  var s0 = _S;
  /* 营业中手指主要在做「点工位加速」，判定拖动要用更大的阈值（14px），
     否则连点时的手抖会被当成滑动，加速点击就这么被吃掉了。 */
  var inStage = !!(s0 && s0.phase === 'open' && VIEW.stageMax > 0 && !VIEW.modal && !VIEW.tut.on);
  var thresh = inStage ? 14 : 6;
  if (!down.dragging && Math.abs(dy) > thresh) down.dragging = true;
  if (!down.dragging) return;
  if (VIEW.modal || VIEW.tut.on) return;
  if (inStage) {
    /* 出杯位多到一屏放不下时才允许滑动；能放下就完全不介入，手感与以前一致 */
    VIEW.stageScroll = Math.max(0, Math.min(VIEW.stageMax, down.stageScroll0 - dy));
    return;
  }
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

  /* 引导优先吞掉事件，避免玩家在引导里误触到后面的按钮。
     但「等待型」步骤要放行它正在等的那一个动作 —— 否则玩家永远做不出动作，
     自动推进也就无从发生，只能靠「下一步」把引导硬念完。 */
  if (VIEW.tut.on) {
    if (act === 'tutnext') { tutNext(); return; }
    if (act === 'tutskip') { tutStop(); return; }
    var wait = tutWaitAct();
    if (!wait || wait !== act) return;
    /* 落到下面的正常分支，成功后各自调 tutNotify() */
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
  if (act === 'login') {
    var lr = claimLogin(_META);
    if (!lr) { toast('今天已经签过啦，明天再来'); return; }
    confetti(18); buzz('short');
    toast('🔥 连续登录 ' + lr.streak + ' 天，创业基金 +' + money(lr.cash) + '（开局到账）');
    return;
  }
  if (act === 'daily') {
    RNG.setSeed(seedFromText('bubble-' + todayKey()));
    QUEST_RNG.setSeed(seedFromText('bubble-quest-' + todayKey()));
    var ds = newGame('normal', _META.bp);
    ds.daily = true;
    _META.runs++;
    saveMeta(_META);
    startGame('normal', ds, true);
    toast('📅 每日挑战 ' + todayKey() + ' · 全网同一局');
    return;
  }
  if (act === 'import') { VIEW.modal = { type: 'import' }; return; }
  if (act === 'export') {
    /* 与导入成对：小游戏里没有输入框，导出只能走剪贴板。
       标题页没有当前局面时，导出当前存档槽里的那份。 */
    var es = _S;
    if (!es) { try { es = loadGame(); } catch (e) { es = null; } }
    if (!es) { toast('还没有可导出的存档'); return; }
    var code = exportSave(es);
    if (!code) { toast('存档导出失败'); return; }
    toast(PLAT.copy(code) ? '📋 存档码已复制，可粘到浏览器版导入' : '复制失败，剪贴板不可用');
    return;
  }
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
  /* 必须走独立的 chart 弹窗：report 底部固定带「进入 Day N」按钮，
     复用它会让备货阶段看一眼曲线就直接跳到第二天。 */
  if (act === 'chart') { VIEW.modal = { type: 'chart' }; return; }

  /* --- 抖音平台能力入口（实现见 minigame/src/caps.js） ---
     这几项的回调全部由平台异步返回，所以统一用 toast 反馈结果。
     注意 addShortcut / requestSubscribeMessage 必须由用户点击同步触发，
     doAct 正是由 tt.onTouchEnd 直接驱动，中间不能插入任何异步包装。 */
  if (act === 'gift') { VIEW.modal = { type: 'gift' }; return; }
  if (act === 'sidebar') {
    CAPS.gotoSidebar(function (ok) {
      toast(ok ? '👉 已前往侧边栏，从那里再进来就能领补给' : '当前环境不支持侧边栏');
    });
    return;
  }
  if (act === 'sidebarclaim') {
    if (!CAPS.claimSidebar()) { toast('今天的补给已经领过啦'); return; }
    var gc = grantGift('sidebar');
    VIEW.modal = null;
    beep('up', 880, 0.16);
    confetti(40);
    toast('🎁 复访补给到账：+' + money(gc) + ' 现金，全原料 +30');
    return;
  }
  if (act === 'shortcut') {
    CAPS.addShortcut(function (ok) {
      toast(ok ? '📱 已添加到桌面' : '添加未完成，可在系统设置里手动添加');
    });
    return;
  }
  if (act === 'subscribe') {
    CAPS.subscribe(function (ok) {
      toast(ok ? '🔔 已开启提醒' : '未开启，可在抖音「设置 - 订阅消息管理」里重新允许');
    });
    return;
  }
  if (act === 'adreward') {
    CAPS.showRewarded(function (watched) {
      if (!watched) { toast('广告未看完，奖励不发放'); return; }
      CAPS.markAd();
      var ac = grantGift('ad');
      VIEW.modal = null;
      confetti(24);
      toast('📺 广告奖励到账：+' + money(ac) + ' 现金，全原料 +30');
    });
    return;
  }
  if (act === 'iapbuy') {
    var gl = CAPS.iapList();
    var gi = clamp(+id | 0, 0, gl.length - 1);
    var goods = gl[gi];
    if (!goods) return;
    CAPS.pay(goods, function (ok) {
      if (!ok) { toast('支付未完成'); return; }
      grantIap(goods);
      VIEW.modal = null;
      confetti(40);
      toast('💎 ' + (goods.name || '礼包') + ' 到账');
    });
    return;
  }
  if (act === 'save') { autoSave(s); toast('💾 已保存到槽 ' + (getSlot() + 1)); return; }
  /* 回主菜单前必须先把营业停掉：主循环只看 phase==='open' 就继续 tick，
     不停的话回到标题页后一天照样打完，结算弹窗会盖在标题页上。 */
  if (act === 'home') {
    if (s.phase === 'open' && s.sim) { togglePause(s, true); toast('⏸ 已暂停营业'); }
    autoSave(s); VIEW.screen = 'title'; VIEW.modal = null; return;
  }

  /* --- 下面四项 H5 都有，小游戏原本漏了 --- */
  if (act === 'autofill') {
    var af = autoFill(s);
    if (af.bought) { toast('🛒 补货 ' + af.bought + ' 单位 · -' + money(af.spent)); tutNotify('buy'); }
    else toast('现金或仓位不足');
    return;
  }
  if (act === 'scout') {
    if (s.trendKnown) { toast('已经调研过了'); return; }
    if (num(s.cash) < 150) { toast('现金不足'); return; }
    s.cash = num(s.cash) - 150; s.trendKnown = true;
    var tg = TAGS[s.nextTrend] || {};
    toast('🔍 明日流行：' + (tg.emoji || '') + ' ' + (tg.name || ''));
    return;
  }
  if (act === 'teambuild') {
    var tb = teamBuild(s);
    if (tb.ok) toast('🎉 团建完成，全员体力回满！-' + money(tb.cost));
    else toast(tb.msg || '无法团建');
    return;
  }
  if (act === 'endless') {
    var eg = startEndless(s);
    VIEW.modal = null;
    VIEW.screen = 'game';
    VIEW.tab = 'manage';
    VIEW.scroll = { manage: 0, lab: 0, up: 0, staff: 0, rival: 0, ach: 0 };
    VIEW.stageScroll = 0;
    confetti(40); buzz('long');
    toast('♾️ 无尽模式！新目标 ' + money(eg));
    autoSave(s);
    return;
  }
  if (act === 'nextday') {
    VIEW.modal = null;
    VIEW.stageScroll = 0;
    nextDay(s);
    if (isFinished(s)) { finishRun('finish'); return; }
    autoSave(s);
    /* 插屏广告只放在「打烊结算 → 进入下一天」这个自然断点上，
       并带冷却（默认 120 秒）。营业中途弹广告会直接毁掉连点手感。 */
    CAPS.showInterstitial();
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
    if (r.ok) { beep('up', 600, 0.06); tutNotify('buy'); } else toast(r.msg);
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
    if (ix >= 0) { s.menu.splice(ix, 1); tutNotify('toggle'); }
    else if ((s.menu || []).length < menuSlots(s)) { s.menu.push(id); tutNotify('toggle'); }
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
    /* rivalAction 返回的是 { ok, msgs, cost }，没有 msg ——
       读 msg 会把「XX 跳槽加入！」这类具体结果整段丢掉。 */
    var txt = (ar && ar.msgs && ar.msgs.length) ? ar.msgs.join('，') : (ar && ar.msg) || '行动完成';
    toast('🏙️ ' + txt);
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
    VIEW.stageScroll = 0;      /* 每天开门都从第一个工位看起 */
    beep('up', 660, 0.12);
    tutNotify('open');
    return;
  }
  if (act === 'rush') {
    var rx = rushStation(s, +id);
    if (rx) {
      beep('up', 880, 0.07);
      floater(CW / 2, CH * 0.45, '+¥' + rx.tip.toFixed(1), 'good');
      if (rx.combo >= 5) toast('🔥 ' + rx.combo + ' 连击！');
      /* 这一步要教的是「连点」，点一次就跳过等于没教。与 H5 同为 3 次。 */
      if (VIEW.tut.on && tutWaitAct() === 'rush') {
        VIEW.tutRush = (VIEW.tutRush || 0) + 1;
        if (VIEW.tutRush >= 3) tutNotify('rush');
      }
    }
    return;
  }
  if (act === 'boss') {
    if (bossSkill(s)) { beep('up', 900, 0.18); buzz('long'); toast('⚡ 老板亲自上阵！全员加速'); tutNotify('boss'); }
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
  if (act === 'share') {
    /* 必须是点击直接触发，不能包异步：抖音的 shareAppMessage 会校验手势 */
    var okShare = CAPS.share({ worth: money(Math.round(netWorth(s))), day: num(s.day) });
    if (!okShare) toast('当前环境不支持分享');
    return;
  }
  if (act === 'again') {
    var d = s ? s.diff : VIEW.diff;
    clearSave();
    RNG.clear(); QUEST_RNG.clear();
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
  /* claimOffline() 返回 { mins, gain }。读 hours/income 会永远显示「0 小时 ¥0」。 */
  var m = Math.round(num(o && o.mins, 0));
  var hm = m >= 60 ? Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分' : m + ' 分钟';
  return '离线 ' + hm + '，外卖带来 ' + money(num(o && o.gain, 0)) + ' 收入。';
}

/* ---------------- 平台奖励发放 ----------------
   额度跟着天数涨（后期补给才跟得上开销），但都设了上限 ——
   否则后期一次补给就能顶掉整局的经营压力，玩法就废了。 */
function giftCashOf(kind, s) {
  var d = num(s && s.day, 1);
  var v = kind === 'ad' ? 300 + 80 * d : 200 + 60 * d;
  return Math.round(Math.min(v, kind === 'ad' ? 4000 : 3000));
}

/** 按仓库剩余空间发放原料。
    原来直接 += 固定量，会越过 storageCap —— 之后所有进货都返回「仓库装不下了」，
    玩家只能干等库存耗到线下，等于领个补给把进货功能锁死了。 */
function grantIng(s, each) {
  var room = Math.max(0, Math.round(storageCap(s) - invUsed(s)));
  if (room <= 0) return 0;
  var per = Math.max(0, Math.floor(room / Math.max(1, ING.length)));
  if (per <= 0) return 0;
  var give = Math.min(per, each);
  for (var i = 0; i < ING.length; i++) s.inv[ING[i].id] = num(s.inv[ING[i].id]) + give;
  return give * ING.length;
}

function grantGift(kind) {
  var s = _S;
  if (!s) return 0;
  var c = giftCashOf(kind, s);
  s.cash = num(s.cash) + c;
  grantIng(s, 30);
  autoSave(s);
  return c;
}

function grantIap(g) {
  var s = _S;
  if (!s || !g) return;
  s.cash = num(s.cash) + num(g.grantCash);
  grantIng(s, num(g.grantIng));
  autoSave(s);
}

/* ---------------- 流程 ---------------- */
function startGame(diff, loaded, keepSeed) {
  if (!loaded && !keepSeed) { RNG.clear(); QUEST_RNG.clear(); }
  var s = loaded || newGame(diff, _META.bp);
  _S = s;
  if (!loaded) { _META.runs++; saveMeta(_META); }
  VIEW.screen = 'game';
  VIEW.tab = 'manage';
  VIEW.scroll = { manage: 0, lab: 0, up: 0, staff: 0, rival: 0, ach: 0 };
  VIEW.stageScroll = 0;
  VIEW.modal = null;
  /* 连续登录的创业基金在这里落进这一局（没签到会自动补签） */
  var lb = takeLoginBonus(s, _META);
  /* 读档可能停在 report（结算弹窗开着时被系统回收）。不补弹的话玩家既看不到结算
     也没有「进入下一天」，只能重开当天 —— 而重开会让营收/工资/stats 重复计一次。 */
  if (s.phase === 'report') VIEW.modal = { type: 'report', day: s.day };
  autoSave(s);
  if (lb) { toast('🔥 连续登录 ' + lb.streak + ' 天，创业基金 +' + money(lb.cash)); confetti(16); buzz('short'); }
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

/** 每日任务达成提示。s.newQuests 由引擎在达成时写入，这里消费掉避免重复弹 */
function emitQuests() {
  var s = _S;
  if (!s || !s.newQuests || !s.newQuests.length) return;
  var got = s.newQuests; s.newQuests = [];
  for (var i = 0; i < got.length; i++) {
    toast('🎯 ' + got[i].emoji + ' ' + got[i].name + ' 达成  +' + money(got[i].cash));
  }
  confetti(14);
  buzz('short');
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
  pushRunRecord(_META, s, kind);
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
    kind: kind, emoji: e, title: tt, grade: g,
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

/** 当前步骤在等的游戏动作；'next'（手动）步骤返回 null */
function tutWaitAct() {
  var st = TUTORIAL[VIEW.tut.step];
  if (!st || !st.advance || st.advance === 'next') return null;
  return st.advance;
}
/** 与 H5 的 TUT.notify() 同义：玩家真的做出了这一步要求的动作才推进 */
function tutNotify(evt) {
  if (!VIEW.tut.on) return;
  var st = TUTORIAL[VIEW.tut.step];
  if (!st || st.advance !== evt) return;
  VIEW.tutRush = 0;
  tutNext();
}

function tutStart(step) {
  VIEW.tutRush = 0;
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
  VIEW.tutRush = 0;
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
  /* 从侧边栏回来时给一句提示：入口在经营面板首屏，玩家得先开一局才看得到 */
  if (CAPS.fromSidebar()) toast('🎁 欢迎回来，开局后可领复访补给');
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
    get audio() { return AUDIO; },
  };
}
