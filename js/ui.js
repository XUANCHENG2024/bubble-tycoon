/* ============================================================
 *  奶茶星球 · Bubble Tycoon  —— UI 渲染与交互
 * ============================================================ */
'use strict';

const $ = id => document.getElementById(id);

/* HTML 转义：任何进入 innerHTML 的动态文本都必须过这一层。
   存档可导出/导入，敌方构造的存档里可能带 <img onerror> 之类 payload，
   渲染层不能信任状态里的字符串。 */
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => ESC_MAP[c]);
}
/* num() 由 engine.js 统一提供，此处不再重复声明 ——
   两个文件各写一份同名 function 声明会静默互相覆盖，改一处漏一处。 */

/* traitEmoji() / tagNames() 已下沉到 data.js：
   它们不依赖 DOM，小游戏版（Canvas 渲染）也要用，放在那儿两版共用一份。 */

/* 百分比宽度：统一把脏数值夹在 0~100，避免进度条溢出或被撑破布局 */
function pct(v) { return clamp(num(v), 0, 100); }

/* ============================================================
 *  音效（WebAudio 合成，零资源文件）
 * ============================================================ */
const SFX = {
  on: true, ac: null,
  loadOptions(meta) {
    if (meta && meta.sound === false) this.on = false;
  },
  init() {
    if (this.ac) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.on = false; return; }
      this.ac = new AC();
    } catch (e) { this.on = false; }
  },
  resume() {
    this.init();
    /* iOS/Safari 的 AudioContext 建出来默认是 suspended，必须在用户手势里 resume 才有声。
       原写法只有 tone() 调 init()，所以玩家第一次点的是「出杯位」这类非 data-act 元素时，
       上下文永远是 suspended —— 整局静音且不报错。这里统一走 resume。 */
    if (this.ac && this.ac.state === 'suspended') {
      try { this.ac.resume(); } catch (e) { }
    }
  },
  tone(freq, dur, type, vol, delay) {
    if (!this.on) return;
    this.resume();
    if (!this.ac) return;
    const ac = this.ac, t0 = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.14, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },
  sweep(f1, f2, dur, type, vol) {
    if (!this.on) return;
    this.resume();
    if (!this.ac) return;
    const ac = this.ac, t0 = ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(f1, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.13, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },
  click() { this.tone(760, 0.05, 'square', 0.07); },
  coin() { this.tone(1180, 0.07, 'triangle', 0.09); this.tone(1620, 0.09, 'triangle', 0.07, 0.05); },
  serve() { this.tone(880, 0.06, 'sine', 0.06); },
  bad() { this.sweep(320, 130, 0.22, 'sawtooth', 0.09); },
  up() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.1, i * 0.06)); },
  ach() { [659, 880, 1047, 1319].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.1, i * 0.08)); },
  bell() { this.tone(1046, 0.5, 'sine', 0.1); this.tone(1568, 0.4, 'sine', 0.05, 0.04); },
  cash() { this.tone(1400, 0.05, 'square', 0.06); },
};

/* ============================================================
 *  新手引导管理器
 * ============================================================ */
const TUT = {
  steps: [], i: 0, active: false, _raf: 0,
  load() { this.steps = (typeof TUTORIAL !== 'undefined' && TUTORIAL.length) ? TUTORIAL : []; },

  start(fromStep) {
    this.load();
    if (!this.steps.length) return;
    this.i = fromStep || 0;
    this.active = true;
    if (window.S) window.S.tut = { active: true, step: this.i, done: false };
    $('tutLayer').classList.add('on');
    this.render();
  },

  stop() {
    this.active = false;
    $('tutLayer').classList.remove('on');
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
  },

  markDone(silent) {
    this.stop();
    if (window.S) window.S.tut = { active: false, step: this.steps.length, done: true };
    const m = window.META; m.tutDone = true; saveMeta(m);
    if (!silent) { UI.toast('🎓 教程完成，祝你生意兴隆！', 'gold'); UI.confetti(40); SFX.ach(); }
  },
  finish() { this.markDone(false); },
  skip() { this.markDone(true); UI.toast('已跳过引导，随时可在「📖」里重看', 'ok'); },

  next() {
    if (!this.active) return;
    this.i++;
    if (window.S) window.S.tut.step = this.i;
    if (this.i >= this.steps.length) { this.finish(); return; }
    SFX.click();
    this.render();
  },

  /** 玩家触发了某个游戏事件：匹配当前步，或在后续步骤里找并跳过去（防止玩家抢跑导致卡死） */
  notify(evt) {
    if (!this.active) return;
    const cur = this.steps[this.i];
    if (cur && cur.advance === evt) { this.next(); return; }
    for (let k = this.i + 1; k < this.steps.length; k++) {
      if (this.steps[k].advance === evt) {
        this.i = k;
        if (window.S) window.S.tut.step = this.i;
        this.next();
        return;
      }
    }
  },

  render() {
    if (!this.active) return;
    const st = this.steps[this.i];
    if (!st) { this.finish(); return; }
    if (st.tab) UI.setTab(st.tab);
    const layer = $('tutLayer');
    const spot = $('tutSpot'), card = $('tutCard');
    const isLast = this.i === this.steps.length - 1;

    $('tutStepNo').textContent = `${this.i + 1}/${this.steps.length}`;
    $('tutTitle').textContent = st.title;
    $('tutText').innerHTML = st.text;
    $('tutHint').textContent = (st.advance !== 'next') ? (st.hint || '') : '';
    $('tutNext').textContent = isLast ? '开始经营 🎉' : '下一步 →';

    const el = st.sel ? document.querySelector(st.sel) : null;
    if (!el) {
      spot.classList.add('gone');
      spot.style.cssText += 'left:50%;top:50%;width:0;height:0;';
      this.placeCardCentered(card);
    } else {
      spot.classList.remove('gone');
      this.track(st.sel, spot, card);
    }
  },

  placeCardCentered(card) {
    const w = Math.min(340, window.innerWidth * 0.89);
    card.style.left = Math.round((window.innerWidth - w) / 2) + 'px';
    card.style.top = Math.round(window.innerHeight * 0.26) + 'px';
    card.classList.remove('arrow-up', 'arrow-down');
    card.classList.add('no-arrow');
  },

  /** 每帧按选择器重新查询（面板会重绘 / 隐藏，旧节点会失效） */
  track(sel, spot, card) {
    const update = () => {
      if (!this.active) return;
      const el = document.querySelector(sel);
      const r = el ? el.getBoundingClientRect() : null;
      if (!r || r.width < 1 || r.height < 1) {
        spot.classList.add('gone');
        this._raf = requestAnimationFrame(update);
        return;
      }
      const pad = 6;
      spot.classList.remove('gone');
      spot.style.left = (r.left - pad) + 'px';
      spot.style.top = (r.top - pad) + 'px';
      spot.style.width = (r.width + pad * 2) + 'px';
      spot.style.height = (r.height + pad * 2) + 'px';
      spot.classList.toggle('circle', r.width < 56 && r.height < 56);

      const cw = Math.min(340, window.innerWidth * 0.89);
      const ch = card.offsetHeight || 180;
      let left = Math.round(Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), window.innerWidth - cw - 12));
      let top, arrow;
      const below = r.bottom + pad + 14;
      if (below + ch < window.innerHeight - 10) { top = Math.round(below); arrow = 'arrow-up'; }
      else { top = Math.round(Math.max(10, r.top - pad - ch - 14)); arrow = 'arrow-down'; }
      card.style.left = left + 'px';
      card.style.top = top + 'px';
      card.classList.remove('arrow-up', 'arrow-down', 'no-arrow');
      card.classList.add(arrow);
      card.style.setProperty('--ax', Math.round(Math.min(Math.max(24, r.left + r.width / 2 - left - 6), cw - 30)) + 'px');
      this._raf = requestAnimationFrame(update);
    };
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(update);
  },
};

$('tutSkip').addEventListener('click', () => TUT.skip());
$('tutNext').addEventListener('click', () => TUT.next());

const UI = {
  tab: 'manage',
  stageEls: null,
  custEls: {},
};

/* ---------------- 屏幕切换 ---------------- */
UI.showScreen = function (id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
};

/* ---------------- Toast ---------------- */
UI.toast = function (msg, kind) {
  const box = $('toasts');
  while (box.children.length >= 4) box.removeChild(box.firstChild);
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    setTimeout(() => el.remove(), 320);
  }, 1900);
};

/* ---------------- 弹窗 ---------------- */
UI.modal = function (html, onClose) {
  const root = $('modal');
  $('modalBox').innerHTML = html;
  root.dataset.lock = '0';
  root.classList.add('on');
  UI._modalClose = onClose;
};
UI.closeModal = function () {
  $('modal').classList.remove('on');
  $('modalBox').innerHTML = '';
  if (UI._modalClose) { const f = UI._modalClose; UI._modalClose = null; f(); }
};
$('modalMask').addEventListener('click', () => { if ($('modal').dataset.lock !== '1') UI.closeModal(); });

/* ---------------- 彩带 ---------------- */
UI.confetti = function (n) {
  const fx = $('fx');
  const colors = ['#ff4d9d', '#8b5cff', '#35e5f0', '#ffc247', '#4ade80'];
  /* 手机 GPU 扛不住几十个同时做合成动画的节点，窄屏减半 */
  const count = Math.round((n || 40) * (window.innerWidth < 640 ? 0.45 : 1));
  for (let i = 0; i < count; i++) {
    const d = document.createElement('div');
    const size = rndInt(6, 12);
    d.style.cssText = `position:absolute;left:${rnd(5, 95)}%;top:-20px;width:${size}px;height:${size * 1.6}px;background:${pick(colors)};border-radius:2px;opacity:.95;transform:rotate(${rnd(0, 360)}deg);`;
    fx.appendChild(d);
    const dur = rnd(1400, 2600), delay = rnd(0, 500);
    /* Web Animations API 在旧版 Safari(<13.1) 与部分 WebView 里不存在，必须降级而不是抛异常 */
    if (typeof d.animate === 'function') {
      try {
        d.animate([
          { transform: 'translateY(0) rotate(0deg)', opacity: 1 },
          { transform: `translateY(${window.innerHeight + 40}px) rotate(${rnd(360, 1080)}deg)`, opacity: .9 }
        ], { duration: dur, delay, easing: 'cubic-bezier(.2,.6,.6,1)' });
      } catch (e) { /* 动画失败不影响游戏 */ }
    } else {
      d.style.transition = `transform ${dur}ms cubic-bezier(.2,.6,.6,1) ${delay}ms, opacity ${dur}ms linear ${delay}ms`;
      requestAnimationFrame(() => {
        d.style.transform = `translateY(${window.innerHeight + 40}px) rotate(${rnd(360, 1080)}deg)`;
        d.style.opacity = '.9';
      });
    }
    setTimeout(() => d.remove(), dur + delay + 100);
  }
};

/* ---------------- 飘字 ---------------- */
UI.floater = function (x, y, text, kind) {
  const fx = $('fx');
  const d = document.createElement('div');
  d.className = 'floater ' + (kind || 'good');
  d.textContent = text;
  d.style.left = x + 'px';
  d.style.top = y + 'px';
  fx.appendChild(d);
  setTimeout(() => d.remove(), 1000);
};

/* ---------------- HUD ---------------- */
UI.renderHUD = function () {
  const s = window.S; if (!s) return;
  const d = diffOf(s);
  $('hudDay').innerHTML = s.endless
    ? `${num(s.day, 1)}<i> 无尽·${num(s.milestone)}阶</i>`
    : `${num(s.day, 1)}<i>/${CFG.DAYS}</i>`;
  $('hudCash').textContent = money(num(s.cash));
  $('hudRep').textContent = Math.round(num(s.rep));
  const nw = num(netWorth(s));
  $('hudWorth').textContent = money(nw);
  const goal = Math.max(1, num(goalOf(s), 1));
  const p = pct(nw / goal * 100);
  $('goalFill').style.width = p + '%';
  const share = num(rivalShare(s));
  $('goalText').textContent = `目标 ${money(goal)} · ${p.toFixed(0)}%`
    + (share >= 0.15 ? ` · 🦑对手抢 ${Math.round(share * 100)}%` : '');
  $('hudCash').style.color = num(s.cash) < 0 ? 'var(--red)' : '';
  if (!STORAGE_OK) $('hudCash').title = '⚠️ 浏览器存储不可用，进度无法保存';
};

/* ---------------- Tab ---------------- */
UI.setTab = function (t) {
  UI.tab = t;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + t));
  UI.renderPanel(t);
  const wrap = $('panels');
  if (wrap) wrap.scrollTop = 0;   // 切面板回到顶部，避免移动端停在上一页滚动位置
};

/* 面板渲染表：原来是 6 个 else-if，新增面板容易漏改，
   未知的 tab 也会「静默写不出东西」还不报错。改成查表 + 显式兜底。 */
const PANEL_RENDERERS = {
  manage: () => UI.renderManage(),
  lab: () => UI.renderLab(),
  up: () => UI.renderUp(),
  staff: () => UI.renderStaff(),
  rival: () => UI.renderRival(),
  ach: () => UI.renderAch(),
};
UI.renderPanel = function (t) {
  const fn = PANEL_RENDERERS[t];
  if (!fn) return;                 /* 未知 tab：不渲染，也不报错 */
  if (!window.S) return;           /* 未开局时任何面板都不该碰 DOM */
  fn();
};
UI.renderAll = function () { UI.renderHUD(); UI.renderPanel(UI.tab); };

/* ---------------- 经营面板 ---------------- */
UI.renderManage = function () {
  const s = window.S; if (!s) return;
  const tag = TAGS[s.trend];
  const nextTag = TAGS[s.nextTrend];
  let h = '';

  /* 今日情报 */
  h += `<div class="card"><div class="card-h">📡 今日情报 <span class="ch-sub">Day ${s.day}</span></div>
    <div class="intel">
      <div class="intel-i"><div class="ii-k">天气</div><div class="ii-v">${s.weather.emoji} ${s.weather.name}</div>
        <div style="font-size:10px;color:var(--txt3)">客流 ×${s.weather.traffic}</div></div>
      <div class="intel-i"><div class="ii-k">今日流行</div><div class="ii-v">${tag.emoji} ${tag.name}</div>
        <div style="font-size:10px;color:var(--txt3)">命中销量 +55%</div></div>
      <div class="intel-i"><div class="ii-k">明日预告</div><div class="ii-v">${s.trendKnown ? nextTag.emoji + ' ' + nextTag.name : '❓ 未知'}</div>
        ${s.trendKnown ? '' : '<button class="btn btn-sm btn-ghost" data-act="scout" style="margin-top:3px">🔍 调研 ¥150</button>'}</div>
    </div>
    ${s.news ? `<div style="margin-top:9px;font-size:11.5px;color:var(--amber)">📰 ${s.news.text}</div>` : ''}
  </div>`;

  /* 今日任务 */
  const qs = questViews(s);
  if (qs.length) {
    h += `<div class="card" data-tut="quest"><div class="card-h">🎯 今日任务
        <span class="ch-sub">达成即到账 · 每天刷新</span></div>`;
    for (const q of qs) {
      const show = q.done ? '已达成'
        : (q.dir === 'down'
          /* 越少越好型的含义是「上限」，直接写 x/y 会被读成「已完成 x 个」 */
          ? `还可流失 ${Math.max(0, q.goal - Math.round(q.prog))}${q.unit}`
          : `${q.prefix}${Math.round(q.prog)}/${q.prefix}${q.goal}${q.unit}`);
      h += `<div class="quest${q.done ? ' done' : ''}">
        <span class="q-e">${q.emoji}</span>
        <span class="q-n">${q.name}</span>
        <span class="q-bar"><i style="width:${(q.ratio * 100).toFixed(1)}%"></i></span>
        <span class="q-v">${show}</span>
        <span class="q-r">${q.done ? '✅ ' : ''}+${money(q.reward)}</span>
      </div>`;
    }
    h += `</div>`;
  }

  /* 今日建议 */
  const adv = adviceOf(s);
  h += `<div class="card" data-tut="advice"><div class="card-h">📌 今日建议
      <span class="ch-sub">按当前状态实时计算</span></div>`;
  if (!adv.length) {
    h += `<div class="advice good"><span class="av-i">✅</span><span>一切正常：库存充足、产能匹配、现金流健康。直接开门吧！</span></div>`;
  }
  for (const a of adv) h += `<div class="advice ${a.level}"><span class="av-i">${a.icon}</span><span>${a.text}</span></div>`;
  h += `</div>`;

  /* 市场 */
  h += `<div class="card" data-tut="market"><div class="card-h">📦 原料市场
      <span class="ch-sub">库存 ${Math.round(invUsed(s))}/${storageCap(s)}</span></div>`;
  for (const g of ING) {
    const p = s.prices[g.id], pv = s.prevPrices[g.id] || p;
    const dir = p > pv + .001 ? 'up' : (p < pv - .001 ? 'down' : '');
    const arrow = dir === 'up' ? '▲' : (dir === 'down' ? '▼' : '—');
    const ratio = clamp(p / (g.base * 2.3), 0, 1);
    h += `<div class="mkt-row">
      <div class="mkt-e">${g.emoji}</div>
      <div class="mkt-n">${g.name}</div>
      <div class="mkt-p ${dir}">¥${p.toFixed(2)} ${arrow}</div>
      <div class="mkt-bar"><i style="width:${ratio * 100}%"></i></div>
      <div class="mkt-c">存 ${Math.round(s.inv[g.id] || 0)}</div>
      <div class="mkt-btns">
        <button class="btn btn-ghost" data-act="buy" data-id="${g.id}" data-q="10">+10</button>
        <button class="btn btn-ghost" data-act="buy" data-id="${g.id}" data-q="30">+30</button>
      </div>
    </div>`;
  }
  h += `<div style="display:flex;gap:7px;margin-top:10px">
      <button class="btn btn-cyan" style="flex:1" data-act="autofill">🛒 一键补货</button>
    </div></div>`;

  /* 菜单 */
  const slots = menuSlots(s);
  h += `<div class="card" data-tut="menu"><div class="card-h">📋 今日菜单
      <span class="ch-sub">${s.menu.length}/${slots} 款上架</span></div>
    <div class="grid2">`;
  for (const rid of s.recipes) {
    const r = recipeById(rid);
    const on = s.menu.includes(rid);
    const ratio = s.ratios[rid] || 1;
    const price = priceOf(s, rid);
    const cost = costOf(s, rid);
    const hit = r.tags.includes(s.trend);
    h += `<div class="rc ${on ? 'on' : ''}" data-act="toggle" data-id="${rid}">
      ${hit ? '<div class="rc-badge">🔥流行</div>' : ''}
      <div class="rc-h"><span class="rc-e">${r.emoji}</span><span>${r.name}</span></div>
      <div class="rc-m">售价 <b style="color:var(--amber)">¥${price}</b> · 成本 ¥${cost.toFixed(1)} · 毛利 ¥${(price - cost).toFixed(1)}</div>
      <div class="rc-tags">${r.tags.map(t => `<span class="rc-tag ${t === s.trend ? 'hit' : ''}">${TAGS[t].emoji}${TAGS[t].name}</span>`).join('')}</div>
      <div class="rc-price"><span style="font-size:10px;color:var(--txt3)">定价</span>
        <input type="range" min="50" max="200" value="${Math.round(ratio * 100)}" data-act="ratio" data-id="${rid}">
        <span class="pv">×${ratio.toFixed(2)}</span></div>
    </div>`;
  }
  h += `</div>
    ${s.menu.length === 0 ? '<div style="color:var(--red);font-size:12px;margin-top:8px">⚠️ 至少上架 1 款才能开门</div>' : ''}
    </div>`;

  /* 营销 + 开门 */
  const mm = marketingMul(s.marketing);
  h += `<div class="card"><div class="card-h">📣 今日营销 <span class="ch-sub">投入 ¥${s.marketing} → 客流 ×${mm.toFixed(2)}</span></div>
    <input type="range" min="0" max="2000" step="50" value="${s.marketing}" data-act="mkt" style="width:100%;accent-color:var(--pink)">
    <div style="display:flex;gap:6px;margin-top:8px">
      <button class="btn btn-sm btn-ghost" data-act="mktset" data-v="0">0</button>
      <button class="btn btn-sm btn-ghost" data-act="mktset" data-v="200">200</button>
      <button class="btn btn-sm btn-ghost" data-act="mktset" data-v="500">500</button>
      <button class="btn btn-sm btn-ghost" data-act="mktset" data-v="1000">1000</button>
    </div>
    <div id="mktForecast" style="font-size:10.5px;color:var(--txt3);margin-top:7px;line-height:1.6">
      预计客流 <b style="color:var(--cyan)">${trafficOf(s)} 人</b> · 出杯位 <b style="color:var(--cyan)">${stationCount(s)} 个</b> · 单杯耗时 ${(CFG.BASE_SERVICE / (1 + .2 * s.up.speed) / (1 + .12 * s.up.training)).toFixed(2)}s
      ${s.lastMarketing > 0
        ? `<br><span style="color:var(--amber)">📢 昨日投入 ${money(s.lastMarketing)} 已用完 —— 营销只当天有效，今天要重新投。</span>`
        : `<br><span style="color:var(--txt3)">营销只在当天生效，打烊后归零。</span>`}
    </div>
  </div>`;

  /* 中期目标：30 天只有一个终点太远，这里给出当前这个 5 天窗口的锚点 */
  const ms = milestoneOf(s);
  if (ms) {
    const mp = pct(num(netWorth(s)) / Math.max(1, ms.worth) * 100);
    h += `<div class="card"><div class="card-h">🎯 中期目标
      <span class="ch-sub">Day ${ms.day} 前净资产 ${money(ms.worth)}</span></div>
      <div class="ms-bar"><i style="width:${mp}%;background:${ms.hit ? 'var(--green)' : 'linear-gradient(90deg,var(--cyan),var(--purple))'}"></i></div>
      <div style="font-size:11.5px;color:${ms.hit ? 'var(--green)' : 'var(--txt2)'};margin-top:6px;line-height:1.6">
        ${ms.hit
          ? `✅ 已达成（当前 ${money(netWorth(s))}）· 声望 +1 已记账`
          : `还差 <b style="color:var(--amber)">${money(ms.gap)}</b>（当前 ${money(netWorth(s))}，进度 ${mp.toFixed(0)}%）`}
      </div></div>`;
  }

  /* 今日体检（注意：客流/产能/库存统一按「人次」口径比较，杯数另列） */
  const trfN = trafficOf(s);                    /* 人 */
  const stockCups = maxCupsFromStock(s);        /* 杯 */
  const stockN = maxOrdersFromStock(s);         /* 人 */
  const capN = dailyOrderCapacity(s);           /* 单 */
  const capClick = dailyClickOrderCapacity(s);  /* 单（含手速） */
  const avgC = avgCupsPerOrder(s);
  const bad = (v, thr) => (v < thr ? 'var(--red)' : 'var(--green)');
  h += `<div class="card"><div class="card-h">🩺 今日体检 <span class="ch-sub">开门前的最后检查</span></div>
      <div style="font-size:11.5px;color:var(--txt2);line-height:1.9">
        👥 预计客流 <b style="color:var(--cyan)">${trfN}</b> 人（约 ${Math.round(trfN * avgC)} 杯）<br>
        📦 库存 ${stockCups} 杯 → 够招待 <b style="color:${bad(stockN, trfN * .75)}">${stockN}</b> 人<br>
        🚀 产能 <b style="color:${bad(capN, trfN)}">${capN}</b> 单${capN < trfN ? `（手速全开约 ${capClick} 单）` : ''} · 出杯位 <b>${stationCount(s)}</b> 个
      </div></div>`;

  h += `<button class="btn btn-primary btn-big" data-act="open" data-tut="open" style="width:100%">🔔 开门营业</button>`;

  /* 店长日志 */
  h += `<div class="card"><div class="card-h">📜 店长日志 <span class="ch-sub">共 ${s.log.length} 条</span></div>`;
  const lg = s.log.slice(-8).reverse();
  if (!lg.length) h += `<div style="font-size:11.5px;color:var(--txt3)">还没有记录，先去进点货吧。</div>`;
  for (const l of lg) h += `<div class="jrow"><span>${esc(l)}</span></div>`;
  h += `</div>`;

  $('panel-manage').innerHTML = h;
};

/* ---------------- 研发面板 ---------------- */
UI.renderLab = function () {
  const s = window.S; if (!s) return;
  let h = `<div class="card"><div class="card-h">🧪 配方实验室
    <span class="ch-sub">已解锁 ${s.recipes.length}/${RECIPES.length}</span></div>
    <div style="font-size:11.5px;color:var(--txt3);margin-bottom:10px;line-height:1.6">
      研发消耗现金 + 原料。稀有配方能显著提高单杯毛利，隐藏款「星球特调」通吃所有流行趋势。
    </div><div class="grid2">`;
  for (const r of RECIPES) {
    const owned = s.recipes.includes(r.id);
    const cost = researchCost(s, r.id);
    const need = r.research ? r.research.ing : null;
    let ok = true, needHtml = '';
    if (need) {
      const parts = [];
      for (const k in need) {
        const has = Math.round(s.inv[k] || 0);
        if (has < need[k]) ok = false;
        parts.push(`${ingById(k).emoji}${need[k]}<span style="color:${has >= need[k] ? 'var(--green)' : 'var(--red)'}">(${has})</span>`);
      }
      needHtml = parts.join(' ');
    }
    const affordable = s.cash >= cost;
    h += `<div class="rc ${owned ? 'on' : (ok && affordable ? '' : 'locked')}">
      <div class="rc-h"><span class="rc-e">${r.emoji}</span><span>${r.name}</span></div>
      <div class="rc-m">${r.desc}</div>
      <div class="rc-m">人气 ${r.pop} · 建议售价 ¥${r.price} · 成本约 ¥${costOf(s, r.id).toFixed(1)}</div>
      <div class="rc-tags">${r.tags.map(t => `<span class="rc-tag">${TAGS[t].emoji}${TAGS[t].name}</span>`).join('')}</div>
      ${owned
        ? `<div style="margin-top:7px;font-size:12px;font-weight:800;color:var(--cyan)">✅ 已解锁</div>`
        : `<div style="margin-top:7px;font-size:11px;color:var(--txt3)">需要 ${needHtml}</div>
           <button class="btn btn-sm ${ok && affordable ? 'btn-primary' : 'btn-ghost'}" style="width:100%;margin-top:6px"
             data-act="research" data-id="${r.id}" ${ok && affordable ? '' : 'disabled'}>研发 ${money(cost)}</button>`}
    </div>`;
  }
  h += `</div></div>`;
  $('panel-lab').innerHTML = h;
};

/* ---------------- 升级面板 ---------------- */
UI.renderUp = function () {
  const s = window.S; if (!s) return;
  let h = `<div class="card"><div class="card-h">⬆️ 设备与门店</div>`;
  for (const u of UPGRADES) {
    const lv = s.up[u.id];
    const cost = upgradeCost(s, u.id);
    let pips = '';
    for (let i = 0; i < u.max; i++) pips += `<span class="up-pip ${i < lv ? 'on' : ''}"></span>`;
    h += `<div class="up-row">
      <div class="up-e">${u.emoji}</div>
      <div class="up-body">
        <div class="up-n">${u.name} <span style="font-size:11px;color:var(--txt3)">Lv.${lv}/${u.max}</span></div>
        <div class="up-d">${u.desc}</div>
        <div class="up-d" style="color:var(--cyan)">${u.detail(lv)}</div>
        <div class="up-lv">${pips}</div>
      </div>
      ${cost == null
        ? `<span style="font-size:12px;color:var(--green);font-weight:800">满级</span>`
        : `<button class="btn btn-sm ${s.cash >= cost ? 'btn-primary' : 'btn-ghost'}" data-act="upgrade" data-id="${u.id}" ${s.cash >= cost ? '' : 'disabled'}>${money(cost)}</button>`}
    </div>`;
  }
  h += `</div>`;

  /* 分店 */
  const sc = shopCost(s);
  h += `<div class="card"><div class="card-h">🏪 分店扩张
    <span class="ch-sub">当前 ${s.shops} 家</span></div>
    <div style="font-size:11.5px;color:var(--txt3);line-height:1.6;margin-bottom:9px">
      每开一家分店：出杯位 +1、客流 +60%，但每日固定成本 +${money(CFG.RENT_PER_SHOP + CFG.SHOP_UPKEEP)}。
    </div>
    ${sc == null
      ? `<div style="font-size:13px;font-weight:800;color:var(--green)">🏆 已达分店上限（${s.shops} 家）</div>`
      : `<button class="btn ${s.cash >= sc ? 'btn-green' : 'btn-ghost'}" style="width:100%" data-act="shop" ${s.cash >= sc ? '' : 'disabled'}>开设第 ${s.shops + 1} 家分店 · ${money(sc)}</button>`}
  </div>`;

  /* 品牌 / 转生 */
  const meta = window.META;
  const gain = prestigeGain(s);
  h += `<div class="card"><div class="card-h">🌟 品牌声望
    <span class="ch-sub">已继承 ${meta.bp} 点</span></div>
    <div style="font-size:11.5px;color:var(--txt3);line-height:1.6;margin-bottom:9px">
      声望点永久生效：每点 <b>客流 +2%</b>、<b>离线收益 +2%</b>。当前本局加成：客流 +${(s.bpBonus * 2)}%。
      现在转生可获得 <b style="color:var(--amber)">${gain} 点</b>（按当前净资产 ${money(netWorth(s))} 计算）。
    </div>
    <div style="display:flex;gap:7px">
      <button class="btn btn-amber" style="flex:1" data-act="prestige">♻️ 品牌升级</button>
      <button class="btn btn-ghost" style="flex:1" data-act="finish">🏁 提前收官</button>
    </div>
  </div>`;

  $('panel-up').innerHTML = h;
};

/* ---------------- 员工面板 ---------------- */
UI.renderStaff = function () {
  const s = window.S; if (!s) return;
  let h = `<div class="card"><div class="card-h">👥 我的团队
    <span class="ch-sub">${s.staff.length} 人 · 日薪合计 ${money(s.staff.reduce((a, b) => a + b.wage, 0))}</span></div>`;
  if (!s.staff.length) {
    h += `<div style="font-size:12px;color:var(--txt3);line-height:1.7">
      现在只有你一个人做奶茶。雇佣员工可以<b>增加出杯位</b>，是提升产能最直接的方式。<br>
      <span style="color:var(--amber)">注意：员工体力会随营业下降，低于 30% 效率大跌。</span></div>`;
  }
  for (const st of s.staff) {
    const tr = traitById(st.trait);
    const low = st.stamina < 30;
    h += `<div class="st">
      <div class="st-h"><span class="st-e">${esc(st.emoji)}</span><span class="st-n">${esc(st.name)}</span>
        ${tr ? `<span class="st-tr">${esc(tr.emoji)} ${esc(tr.name)}</span>` : '<span class="st-tr" style="background:rgba(255,255,255,.1)">无特质</span>'}</div>
      <div class="st-m">
        <span>效率 <b>×${num(staffMult(s, st)).toFixed(2)}</b></span>
        <span>日薪 <b>${money(num(st.wage))}</b></span>
        <span>体力 <b>${Math.round(num(st.stamina))}%</b></span>
      </div>
      <div class="st-bar ${low ? 'low' : ''}"><i style="width:${pct(st.stamina)}%"></i></div>
      ${tr ? `<div style="font-size:10.5px;color:var(--txt3);margin-top:5px">${esc(tr.desc)}</div>` : ''}
      <button class="btn btn-sm btn-ghost" style="margin-top:7px" data-act="fire" data-id="${esc(st.id)}">解雇（遣散费 ${money(num(st.wage) * 2)}）</button>
    </div>`;
  }
  h += `</div>`;

  h += `<div class="card"><div class="card-h">🎯 今日候选人</div>`;
  s.candidates.forEach((c, i) => {
    const tr = traitById(c.trait);
    h += `<div class="cand">
      <span style="font-size:22px">${esc(c.emoji)}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:13.5px">${esc(c.name)} ${tr ? `<span style="font-size:10px;padding:1px 6px;border-radius:99px;background:rgba(139,92,255,.3)">${esc(tr.emoji)}${esc(tr.name)}</span>` : ''}</div>
        <div style="font-size:10.5px;color:var(--txt3);margin-top:2px">
          效率 ×${num(c.skill, 1).toFixed(2)} · 日薪 ${money(num(c.wage))} · 聘用费 ${money(num(c.fee))}
          ${tr ? `<br>${esc(tr.desc)}` : ''}</div>
      </div>
      <button class="btn btn-sm ${num(s.cash) >= num(c.fee) ? 'btn-green' : 'btn-ghost'}" data-act="hire" data-i="${i}" ${num(s.cash) >= num(c.fee) ? '' : 'disabled'}>雇佣</button>
    </div>`;
  });
  h += `<button class="btn btn-ghost" style="width:100%;margin-top:4px" data-act="teambuild">🎉 团建（全员体力回满）</button>`;
  h += `</div>`;
  $('panel-staff').innerHTML = h;
};

/* ---------------- 商圈 / 竞争对手面板 ---------------- */
UI.renderRival = function () {
  const s = window.S; if (!s) return;
  const r = s.rival;
  let h = '';
  if (!r) { $('panel-rival').innerHTML = '<div class="card">暂无竞争对手</div>'; return; }

  const share = rivalShare(s);
  const lv = rivalLevel(r);
  h += `<div class="card"><div class="card-h">🦑 竞争对手 <span class="ch-sub">${esc(r.emoji)} ${esc(r.name)} · Lv.${lv}</span></div>
    <div class="rival-vs">
      <div class="rv-me">
        <div class="rv-n">🏪 你的店</div>
        <div class="rv-r">口碑 ${Math.round(num(s.rep))}</div>
        <div class="rv-bar"><i style="width:${pct(s.rep)}%;background:linear-gradient(90deg,var(--cyan),var(--green))"></i></div>
      </div>
      <div class="rv-mid">VS</div>
      <div class="rv-rv">
        <div class="rv-n">${esc(r.emoji)} ${esc(r.name)}</div>
        <div class="rv-r">口碑 ${Math.round(num(r.rep))}</div>
        <div class="rv-bar"><i style="width:${pct(r.rep)}%;background:linear-gradient(90deg,var(--red),var(--amber))"></i></div>
      </div>
    </div>
    <div class="rep-note" style="margin-top:10px">
      对手目前抢走你约 <b style="color:${share >= 0.2 ? 'var(--red)' : 'var(--green)'}">${Math.round(share * 100)}%</b> 的客流。
      它的口碑每天自然成长，但如果你口碑远高于它，它会逐渐萎缩。
      ${num(r.aggro, 1) > 1.05 ? `<br><span style="color:var(--red)">⚠️ 它正在 aggressively 扩张（攻击性 ×${num(r.aggro, 1).toFixed(2)}）！</span>` : ''}
    </div>
    ${num(r.proof) ? `<div class="rep-note">🏰 你的护城河 Lv.${num(r.proof)} · 被抢比例 -${num(r.proof) * 6}%</div>` : ''}
  </div>`;

  h += `<div class="card"><div class="card-h">🥊 反制手段</div>`;
  for (const a of RIVAL_ACTIONS) {
    const cd = r.cd['cd_' + a.id] || 0;
    const cooling = cd > s.day;
    const maxed = a.id === 'diff' && (r.proof || 0) >= 5;
    const disabled = cooling || maxed || s.cash < a.cost;
    h += `<div class="up-row">
      <div class="up-e">${a.emoji}</div>
      <div class="up-body">
        <div class="up-n">${a.name} ${cooling ? `<span style="font-size:10px;color:var(--txt3)">冷却至 Day ${cd}</span>` : ''}${maxed ? '<span style="font-size:10px;color:var(--green)">已满级</span>' : ''}</div>
        <div class="up-d">${a.desc}</div>
      </div>
      <button class="btn btn-sm ${disabled ? 'btn-ghost' : 'btn-primary'}" data-act="rivalact" data-id="${a.id}" ${disabled ? 'disabled' : ''}>${money(a.cost)}</button>
    </div>`;
  }
  h += `</div>`;

  /* 客群构成 */
  h += `<div class="card"><div class="card-h">👥 客群构成 <span class="ch-sub">今日权重</span></div>
    <div style="font-size:11.5px;color:var(--txt3);margin-bottom:9px;line-height:1.6">
      不同客群的口味偏好、价格容忍度和耐心都不一样 —— 菜单要尽量覆盖更多口味。
    </div>`;
  const weights = CUSTOMER_TYPES.map(t => typeWeightOf(s, t));
  const totalW = weights.reduce((a, w) => a + w, 0);
  CUSTOMER_TYPES.forEach((t, ti) => {
    /* totalW 为 0 时（极端数据）退回 0%，不要算出 NaN 百分比 */
    const pctv = totalW > 0 ? Math.round(weights[ti] / totalW * 100) : 0;
    h += `<div class="ctype">
      <div class="ct-h"><span class="ct-e">${t.emoji}</span><span class="ct-n">${t.name}</span>
        <span class="ct-p">${pctv}%</span></div>
      <div class="ct-bar"><i style="width:${pctv}%;background:${t.color}"></i></div>
      <div class="ct-m">
        偏好 ${t.prefer.length ? tagNames(t.prefer) : '人气款'}
        ${t.avoid && t.avoid.length ? ` · 排斥 ${tagNames(t.avoid)}` : ''}
        <br>价格容忍 ×${t.priceTol} · 耐心 ×${t.patienceMul} · 单次 ${t.cups[0]}~${t.cups[1]} 杯
      </div>
    </div>`;
  });
  h += `</div>`;

  /* 昨日客群实绩 */
  const lr = s.lastReport;
  if (lr && Object.keys(lr.typeServed || {}).length) {
    h += `<div class="card"><div class="card-h">📊 Day ${lr.day} 客群实绩</div>`;
    for (const t of CUSTOMER_TYPES) {
      const got = (lr.typeServed[t.id] || 0), lost = (lr.typeLost[t.id] || 0);
      const tot = got + lost;
      if (!tot) continue;
      h += `<div class="mkt-row"><div class="mkt-e">${t.emoji}</div>
        <div class="mkt-n">${t.name}</div>
        <div class="mkt-c">成交 ${got} 杯</div>
        <div class="mkt-bar"><i style="width:${Math.round(got / tot * 100)}%"></i></div>
        <div class="mkt-c" style="color:${lost ? 'var(--red)' : 'var(--txt3)'}">流失 ${lost}</div></div>`;
    }
    h += `</div>`;
  }

  $('panel-rival').innerHTML = h;
};

/* ---------------- 经营报表（曲线图） ---------------- */
UI.chartSVG = function (s, w, h) {
  w = w || 620; h = h || 200;
  const data = s.history || [];
  if (data.length < 2) {
    return `<div style="text-align:center;color:var(--txt3);font-size:12px;padding:24px 0">
      至少经营 2 天才能看到趋势曲线</div>`;
  }
  const series = [
    { key: 'worth', name: '净资产', color: '#ffc247' },
    { key: 'revenue', name: '日营收', color: '#35e5f0' },
    { key: 'net', name: '日净利', color: '#4ade80' },
  ];
  let maxV = 1, minV = 0;
  for (const d of data) for (const se of series) {
    maxV = Math.max(maxV, d[se.key]);
    minV = Math.min(minV, d[se.key]);
  }
  const pad = { l: 44, r: 10, t: 12, b: 22 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const X = i => pad.l + (data.length === 1 ? iw / 2 : iw * i / (data.length - 1));
  const Y = v => pad.t + ih - ((v - minV) / (maxV - minV || 1)) * ih;

  let g = `<svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block">`;
  g += `<line x1="${pad.l}" y1="${Y(0)}" x2="${w - pad.r}" y2="${Y(0)}" stroke="rgba(255,255,255,.25)" stroke-width="1" stroke-dasharray="3 3"/>`;
  g += `<text x="4" y="${Y(0) + 4}" font-size="10" fill="#8f82ad">0</text>`;
  g += `<text x="4" y="${pad.t + 9}" font-size="10" fill="#8f82ad">${Math.round(maxV)}</text>`;
  for (const se of series) {
    const pts = data.map((d, i) => `${X(i).toFixed(1)},${Y(d[se.key]).toFixed(1)}`).join(' ');
    g += `<polyline points="${pts}" fill="none" stroke="${se.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  const last = data[data.length - 1];
  for (const se of series) {
    g += `<circle cx="${X(data.length - 1)}" cy="${Y(last[se.key])}" r="3" fill="${se.color}"/>`;
  }
  /* X 轴刻度 */
  const step = Math.max(1, Math.ceil(data.length / 6));
  for (let i = 0; i < data.length; i += step) {
    g += `<text x="${X(i)}" y="${h - 6}" font-size="9.5" fill="#8f82ad" text-anchor="middle">D${data[i].day}</text>`;
  }
  g += `</svg>`;
  let legend = `<div class="chart-legend">`;
  for (const se of series) legend += `<span><i style="background:${se.color}"></i>${se.name} ${Math.round(last[se.key])}</span>`;
  legend += `</div>`;
  return g + legend;
};

UI.showChart = function () {
  const s = window.S; if (!s) return;
  const data = s.history || [];
  const rows = data.slice(-14).reverse();
  let h = `<button class="close-x" onclick="UI.closeModal()">×</button>
    <div class="m-title">📈 经营报表</div>
    <div class="m-sub">净资产 / 营收 / 净利 趋势</div>
    <div class="chart-box">${UI.chartSVG(s)}</div>`;
  if (rows.length) {
    h += `<div class="m-sec"><h4>📋 每日明细（最近 ${rows.length} 天）</h4>
      <div class="dtable">
      <div class="dt-h"><span>日</span><span>营收</span><span>净利</span><span>杯数</span><span>流失</span><span>口碑</span><span>净资产</span></div>`;
    for (const d of rows) {
      h += `<div class="dt-r">
        <span>D${d.day}</span>
        <span>${money(d.revenue)}</span>
        <span style="color:${d.net >= 0 ? 'var(--green)' : 'var(--red)'}">${d.net >= 0 ? '+' : ''}${money(d.net)}</span>
        <span>${d.cups}</span>
        <span style="color:${d.lost ? 'var(--red)' : 'var(--txt3)'}">${d.lost}</span>
        <span>${d.rep}</span>
        <span style="color:var(--amber)">${money(d.worth)}</span>
      </div>`;
    }
    h += `</div></div>`;
  }
  h += `<div class="m-btns"><button class="btn btn-primary" onclick="UI.closeModal()">关闭</button></div>`;
  UI.modal(h);
};

/* ---------------- 成就面板 ---------------- */
UI.renderAch = function () {
  const s = window.S; if (!s) return;
  const got = ACHIEVEMENTS.filter(a => s.ach[a.id]).length;
  let h = `<div class="card"><div class="card-h">🏅 成就 <span class="ch-sub">${got}/${ACHIEVEMENTS.length}</span></div>
    <div style="font-size:11.5px;color:var(--txt3);margin-bottom:10px">达成成就可获得现金与品牌声望点，声望点永久保留。</div>`;
  for (const a of ACHIEVEMENTS) {
    const on = !!s.ach[a.id];
    h += `<div class="ach ${on ? 'got' : ''}">
      <div class="ach-e">${a.emoji}</div>
      <div class="ach-b"><div class="ach-n">${a.name}</div><div class="ach-d">${a.desc}</div></div>
      <div class="ach-r">${on ? '✅ 已达成' : (a.reward.cash ? money(a.reward.cash) : '') + (a.reward.bp ? ' · ' + a.reward.bp + '★' : '')}</div>
    </div>`;
  }
  h += `</div>`;
  $('panel-ach').innerHTML = h;
};

/* ---------------- 营业舞台 ---------------- */
UI.stageInit = function () {
  const s = window.S;
  $('tabs').style.display = 'none';
  $('panels').style.display = 'none';
  $('stage').classList.add('on');
  UI.custEls = {};
  UI.lastServed = 0;
  UI.lastLost = 0;
  UI.rushN = 0;
  /* 缓存舞台上的节点引用：stageSync 每帧要跑，中低端安卓上
     十几轮 getElementById + querySelector 会实打实吃掉几毫秒，直接掉到 30 帧。 */
  UI.el = {
    tbFill: $('tbFill'), tbText: $('tbText'), btnPause: $('btnPause'),
    lvServed: $('lvServed'), lvLost: $('lvLost'), lvRev: $('lvRev'),
    lvCombo: $('lvCombo'), qCount: $('qCount'), queue: $('queue'), rushCd: $('rushCd'),
  };
  const wrap = $('stations');
  wrap.innerHTML = '';
  UI.stageEls = [];
  s.sim.stations.forEach((st, i) => {
    const el = document.createElement('div');
    el.className = 'stn' + (st.isBoss ? ' boss' : '');
    el.dataset.i = i;
    el.innerHTML = `<div class="sn">${st.isBoss ? '👑 老板' : (st.branch ? '🏪 分店位' : esc(st.worker.emoji) + ' ' + esc(st.worker.name))}</div>
      <div class="sw">${st.isBoss ? '' : traitEmoji(st.worker && st.worker.trait)}</div>
      <div class="so">—</div>
      <div class="sp"><i></i></div>
      <div class="stx"></div>`;
    el.addEventListener('click', () => {
      const r = rushStation(s, i);
      if (r) {
        SFX.click();
        UI.rushN = (UI.rushN || 0) + 1;
        if (UI.rushN >= 3) TUT.notify('rush');
        const rect = el.getBoundingClientRect();
        UI.floater(rect.left + rect.width / 2 - 12, rect.top - 6, '+¥' + r.tip.toFixed(1), 'good');
        if (r.combo >= 5) UI.toast(`🔥 ${r.combo} 连击！`, 'gold');
        UI.renderHUD();
      }
    });
    wrap.appendChild(el);
    UI.stageEls.push(el);
  });
  $('queue').innerHTML = '';
};

UI.stageSync = function () {
  const s = window.S; const sim = s.sim;
  if (!sim) return;
  const E = UI.el || {};
  const p = clamp(sim.t / sim.duration, 0, 1);
  if (E.tbFill) E.tbFill.style.width = (p * 100) + '%';
  if (E.tbText) E.tbText.textContent = sim.paused ? '⏸ 已暂停（点「继续」恢复）'
    : sim.closing ? '🔔 打烊清场中…' : `营业中 ${Math.max(0, Math.ceil(sim.duration - sim.t))}s`;
  const pb = E.btnPause;
  if (pb) { pb.textContent = sim.paused ? '▶ 继续' : '⏸ 暂停'; pb.classList.toggle('btn-rush', sim.paused); }
  /* 注意是 sim.cups 不是 sim.served：
     served 只存在于日报里（s.lastReport.served = sim.cups），营业中的实时计数叫 cups。
     以前这里读 sim.served，结果是「已卖」一栏一直显示 undefined，且出杯音效从不触发。 */
  const servedNow = num(sim.cups, 0);
  if (E.lvServed) E.lvServed.textContent = servedNow;
  if (E.lvLost) E.lvLost.textContent = sim.lost;
  if (E.lvRev) E.lvRev.textContent = money(sim.revenue);
  if (E.lvCombo) E.lvCombo.textContent = (Date.now() / 1000 - sim.lastClickWall < 1.1 ? sim.combo : 0);

  /* 出杯 / 流失音效 */
  if (servedNow !== UI.lastServed) {
    if (servedNow > UI.lastServed) { SFX.serve(); UI.lastServed = servedNow; }
    else UI.lastServed = servedNow;
  }
  if (sim.lost !== UI.lastLost) {
    if (sim.lost > UI.lastLost) SFX.bad();
    UI.lastLost = sim.lost;
  }

  /* 队列 */
  const q = E.queue || $('queue');
  const seen = {};
  sim.queue.forEach((c, i) => {
    seen[c.id] = 1;
    let el = UI.custEls[c.id];
    if (!el) {
      el = document.createElement('div');
      el.className = 'cust';
      const cr = recipeById(c.rid) || { emoji: '🥤', name: '未知' };
      el.innerHTML = `<div class="cf">${esc(c.face)}</div><div class="cw">${esc(cr.emoji)}</div>
        <div class="cp"><i></i></div>`;
      el._bar = el.querySelector('.cp i');   /* 缓存进度条，避免每帧 querySelector */
      UI.custEls[c.id] = el;
      q.appendChild(el);
    }
    const left = 1 - c.wait / c.patience;
    el._bar.style.width = pct(left * 100) + '%';
    el.classList.toggle('angry', left < 0.3);
    if (q.children[i] !== el) q.insertBefore(el, q.children[i] || null);
  });
  for (const id in UI.custEls) {
    if (!seen[id]) { UI.custEls[id].remove(); delete UI.custEls[id]; }
  }
  if (E.qCount) E.qCount.textContent = sim.queue.length + '/' + queueCap(s);

  /* 出杯位 —— 这里是每帧最热的一段：原本每个工位 3 次 querySelector，
     6~8 个工位 × 60fps ≈ 每秒 1400 次查询。改成首帧缓存引用。 */
  sim.stations.forEach((st, i) => {
    const el = UI.stageEls[i]; if (!el) return;
    if (!el._bar) {
      el._bar = el.querySelector('.sp i');
      el._o = el.querySelector('.so');
      el._tx = el.querySelector('.stx');
    }
    const bar = el._bar, o = el._o, tx = el._tx;
    if (!bar || !o || !tx) return;
    if (st.order) {
      const r = recipeById(st.order.rid) || { emoji: '🥤', tags: [] };
      const n = st.order.cups || 1;
      o.textContent = n > 1 ? r.emoji + '×' + n : r.emoji;
      bar.style.width = pct(st.order.progress * 100) + '%';
      const trendHit = r.tags.includes(s.trend);
      tx.textContent = '¥' + (st.order.price * n) + (trendHit ? ' 🔥' : '');
      el.classList.add('busy');
    } else {
      o.textContent = '—';
      bar.style.width = '0%';
      tx.textContent = (st.worker && st.worker.stamina <= 0) ? '😴 累瘫' : '';
      el.classList.remove('busy');
    }
    el.classList.toggle('rush', sim.rushUntil > sim.t);
  });

  /* 大招 CD */
  const cdEl = E.rushCd;
  const btn = $('btnRush');
  if (cdEl && btn) {
    if (sim.rushCd > 0) { btn.disabled = true; cdEl.textContent = `(${Math.ceil(sim.rushCd)}s)`; }
    else { btn.disabled = false; cdEl.textContent = ''; }
  }

  /* 飘字 */
  if (sim.floaters.length) {
    const rect = $('stations').getBoundingClientRect();
    for (const f of sim.floaters) {
      UI.floater(rect.left + rnd(20, Math.max(40, rect.width - 20)), rect.top + rnd(10, 60), f.text, f.kind);
    }
    sim.floaters.length = 0;
  }
};

UI.stageEnd = function () {
  $('stage').classList.remove('on');
  $('tabs').style.display = '';
  $('panels').style.display = '';
  /* 释放上一局的舞台节点引用。原先只把 stage 藏起来，
     UI.custEls / UI.stageEls 还攥着已被移出文档的 DOM 节点，
     退出营业或回主菜单后要等到下一次 stageInit 才可能被回收 ——
     手机上连续玩多局的内存峰值就是这么攒出来的。 */
  UI.custEls = {};
  UI.stageEls = [];
  UI.el = null;
  const queueEl = $('queue');
  if (queueEl) queueEl.innerHTML = '';
  const stationsEl = $('stations');
  if (stationsEl) stationsEl.innerHTML = '';
};

/* ---------------- 结算弹窗 ---------------- */
/* 结算页「较昨日」的小标签。
   inverse = 该指标越小越好（流失人数），涨跌配色要反过来。 */
function deltaTag(cur, prev, opt) {
  if (prev == null || !isFinite(prev)) return '';
  const d = (Number(cur) || 0) - (Number(prev) || 0);
  const unit = (opt && opt.unit) || '';
  if (Math.abs(d) < ((opt && opt.eps) || 0.5)) return '<i class="dt dt-flat">持平</i>';
  const up = d > 0;
  const good = (opt && opt.inverse) ? !up : up;
  const abs = Math.abs(d);
  const v = abs >= 1000 ? Math.round(abs) : (abs % 1 ? abs.toFixed(1) : abs);
  return `<i class="dt ${good ? 'dt-good' : 'dt-bad'}">${up ? '▲' : '▼'}${unit}${v}</i>`;
}

UI.showReport = function () {
  const s = window.S; const r = s.report;
  /* 第一天打烊 = 核心循环已走完，引导到此结束（避免挡住结算按钮） */
  if (typeof TUT !== 'undefined' && TUT.active) TUT.markDone(false);
  const nw = netWorth(s);
  let note = '';
  /* 营销是当日一次性投入，打烊后归零。不说明的话玩家会以为那笔钱白花了。 */
  if (r.marketing > 0) note += `📢 营销投入 ${money(r.marketing)} 当天有效，明日需重新设置。<br>`;
  if (s.endless && r.pressure > 1) note += `⚡ 无尽第 ${s.milestone} 阶：工资与租金 ×${r.pressure.toFixed(2)}。<br>`;
  if (r.lost > 0) note += `😥 今天流失了 <b>${r.lost}</b> 位顾客` + (r.stockout ? `（缺料 ${r.stockout} 位）` : '') + (r.priceLost ? `、嫌贵 ${r.priceLost} 位` : '') + '。<br>';
  if (r.stockout > 0) note += `📦 缺料会直接赶走客人，明天记得提前备货。<br>`;
  if (r.priceLost > r.lost * 0.4 && r.priceLost > 3) note += `💸 有不少人被价格劝退了，试试把倍率调回 1.0 附近，或上架更便宜的款。<br>`;
  if (r.sat >= 0.95) note += `🎯 满意率 ${(r.sat * 100).toFixed(0)}%，服务堪称完美！<br>`;
  if (r.trendCups > 0) note += `🔥 命中流行趋势 ${r.trendCups} 杯，潮流嗅觉不错。<br>`;
  if (r.net < 0) note += `⚠️ 今日亏损，注意控制固定成本（房租/工资）。<br>`;
  if (!note) note = '平稳的一天，继续保持。';

  const html = `<button class="close-x" onclick="UI.closeModal()">×</button>
    <div class="m-title">🔔 Day ${r.day} 打烊结算</div>
    <div class="m-sub">${s.weather.emoji} ${s.weather.name} · 流行 ${TAGS[s.trend].emoji}${TAGS[s.trend].name}</div>
    <div class="rep-grid">
      <div class="rep-i"><div class="ri-k">卖出杯数</div><div class="ri-v">${r.served}</div></div>
      <div class="rep-i"><div class="ri-k">接待 / 流失</div><div class="ri-v ${r.lost ? 'n' : ''}">${r.orders} / ${r.lost}</div></div>
      <div class="rep-i"><div class="ri-k">营业收入</div><div class="ri-v p">${money(r.revenue)}</div></div>
      <div class="rep-i"><div class="ri-k">原料成本</div><div class="ri-v n">-${money(r.cogs)}</div></div>
      <div class="rep-i"><div class="ri-k">房租 + 工资</div><div class="ri-v n">-${money(r.wages + r.rent)}</div></div>
      <div class="rep-i"><div class="ri-k">营销费</div><div class="ri-v n">-${money(r.marketing)}</div></div>
      <div class="rep-i"><div class="ri-k">今日净利</div><div class="ri-v ${r.net >= 0 ? 'p' : 'n'}">${r.net >= 0 ? '+' : ''}${money(r.net)}</div></div>
      <div class="rep-i"><div class="ri-k">口碑</div><div class="ri-v ${r.repDelta >= 0 ? 'p' : 'n'}">${Math.round(r.repAfter)} (${r.repDelta >= 0 ? '+' : ''}${r.repDelta.toFixed(1)})</div></div>
    </div>
    <div class="rep-note">${note}</div>
    ${(() => {
      const p = s.prevReport;
      if (!p || p.day === r.day) return '';
      return `<div class="rep-note">📊 较 Day ${p.day}：`
        + `营收 ${deltaTag(r.revenue, p.revenue, { unit: '¥' })}`
        + ` · 杯数 ${deltaTag(r.served, p.served)}`
        + ` · 流失 ${deltaTag(r.lost, p.lost, { inverse: true })}`
        + ` · 净利 ${deltaTag(r.net, p.net, { unit: '¥' })}`
        + ` · 口碑 ${deltaTag(r.repAfter, p.repAfter, { eps: 0.05 })}`
        + `</div>`;
    })()}
    ${(() => {
      const all = CUSTOMER_TYPES.filter(t => (r.typeServed[t.id] || 0) || (r.typeLost[t.id] || 0));
      if (!all.length) return '';
      let x = `<div class="rep-note"><b>今日客群</b><br>`;
      for (const t of all) {
        const got = r.typeServed[t.id] || 0, lost = r.typeLost[t.id] || 0;
        x += `${t.emoji} ${t.name} <b>${got}</b> 杯${lost ? ` <span style="color:var(--red)">流失${lost}</span>` : ''} · `;
      }
      return x + `</div>`;
    })()}
    <div class="rep-note">💎 净资产 <b style="color:var(--amber)">${money(nw)}</b> / 目标 ${money(goalOf(s))}${s.endless ? `（无尽第 ${s.milestone} 阶）` : ''}</div>
    <div class="m-btns"><button class="btn btn-primary" data-act="nextday">进入 Day ${s.day + 1} →</button></div>`;
  UI.modal(html);
  $('modal').dataset.lock = '1';
  if (r.net >= 500) UI.confetti(18);
};

/* ---------------- 事件弹窗 ---------------- */
UI.showEvent = function () {
  const s = window.S; const ev = s.pendingEvent;
  if (!ev) return false;
  let h = `<div class="m-title">${ev.emoji} ${ev.title}</div>
    <div class="m-sub">突发事件 · 请做出选择</div>
    <div class="rep-note">${ev.text}</div>`;
  ev.options.forEach((o, i) => {
    h += `<button class="ev-opt" data-act="eventopt" data-i="${i}">
      <div class="eo-l">${o.label}</div><div class="eo-d">${o.desc}</div></button>`;
  });
  UI.modal(h);
  $('modal').dataset.lock = '1';
  return true;
};

/* ---------------- 帮助 ---------------- */
UI.showHelp = function () {
  const h = `<button class="close-x" onclick="UI.closeModal()">×</button>
    <div class="m-title">📖 玩法说明</div>
    <div class="m-sub">30 天，从街边小店做到奶茶帝国</div>
    <div class="m-sec"><h4>⚙️ 设置</h4>
      <div class="switch-row"><span>🔊 音效</span>
        <div class="switch ${SFX.on ? 'on' : ''}" data-act="sound"><i></i></div></div>
      <div class="switch-row"><span>🎓 重看新手教程</span>
        <button class="btn btn-sm btn-primary" data-act="retut">开始</button></div>
    </div>
    <div class="m-sec"><h4>🎯 目标</h4>
      <p>在 <b>${CFG.DAYS} 天</b>内把净资产做到目标金额即通关。难度不同目标不同（标准 ${money(DIFFICULTY.normal.goal)}）。<br>
      现金连续 2 天为负 → <b style="color:var(--red)">破产失败</b>。</p></div>
    <div class="m-sec"><h4>🔁 每天的流程</h4>
      <ul>
        <li><b>① 进货</b>：五种原料价格每日波动，低价时囤货 = 纯利润</li>
        <li><b>② 配菜单 & 定价</b>：倍率越高单价越高，但客人会流失，0.9~1.1 最稳</li>
        <li><b>③ 开门营业</b>：${CFG.DAY_DURATION} 秒实时经营，<b>点击出杯位可加速</b>，还有小费和连击！</li>
        <li><b>④ 结算</b>：满意率决定口碑涨跌，口碑决定明天客流</li>
        <li><b>⑤ 投资</b>：升级设备 / 研发配方 / 招人 / 开分店</li>
      </ul></div>
    <div class="m-sec"><h4>👥 客群与竞争</h4>
      <ul>
        <li>顾客分 <b>5 类</b>：学生党 / 打工人 / 网红 / 家庭客 / 街坊长辈，口味偏好、价格容忍度、耐心、单次杯数都不同</li>
        <li>菜单要<b>覆盖更多口味</b>，才留得住不同客群；定价过高会被当场劝退</li>
        <li>隔壁的<b>竞争对手</b>会抢走你的客流，去「🏙️ 商圈」用挖角 / 营销压制 / 差异化反击</li>
      </ul></div>
    <div class="m-sec"><h4>♾️ 模式</h4>
      <ul>
        <li><b>每日挑战</b>：每天一局，全网同一种子，可反复刷分</li>
        <li><b>无尽模式</b>：通关后继续经营，目标每达成一次上涨 55%</li>
        <li><b>战绩卡片</b>：结局页可保存战绩图，方便截图分享</li>
      </ul></div>
    <div class="m-sec"><h4>💡 核心策略</h4>
      <ul>
        <li><b>产能与客流的赛跑</b>：客流涨太快而产能不够，客人会流失、口碑暴跌</li>
        <li><b>出杯位 = 员工数 + 分店数 + 1</b>，招人是提升产能最快的方式</li>
        <li><b>流行趋势</b>：命中当日标签销量 +55%，花 ¥150 可提前知道明天趋势</li>
        <li><b>卡关就看建议</b>：经营面板的「📌 今日建议」和「🩺 今日体检」会直接告诉你缺什么</li>
        <li><b>离线收益</b>：升级「外卖接单」后，关掉页面也在赚钱，最多累计 4 小时</li>
        <li><b>品牌升级（转生）</b>：把净资产换成永久声望点，下一局开局更强</li>
      </ul></div>
    <div class="m-sec"><h4>⌨️ 小技巧</h4>
      <ul><li>营业时空格键 = 老板上阵大招</li><li>连点同一出杯位可叠加连击，小费最高翻倍</li>
      <li>原料低价时多囤，隔天涨价就是纯利润</li></ul></div>
    <div class="m-btns"><button class="btn btn-primary" onclick="UI.closeModal()">知道了</button></div>`;
  UI.modal(h);
};

/* ---------------- 紧急进货 ---------------- */
UI.showRestock = function () {
  const s = window.S;
  let h = `<button class="close-x" onclick="UI.closeModal()">×</button>
    <div class="m-title">🚚 紧急进货</div>
    <div class="m-sub">营业中进货加价 ${Math.round((CFG.RESTOCK_MARKUP - 1) * 100)}%，但能救回排队的客人</div>`;
  for (const g of ING) {
    h += `<div class="mkt-row">
      <div class="mkt-e">${g.emoji}</div><div class="mkt-n">${g.name}</div>
      <div class="mkt-p">¥${(s.prices[g.id] * CFG.RESTOCK_MARKUP).toFixed(2)}</div>
      <div class="mkt-c">存 ${Math.round(s.inv[g.id] || 0)}</div>
      <div class="mkt-btns">
        <button class="btn btn-ghost" data-act="rbug" data-id="${g.id}" data-q="10">+10</button>
        <button class="btn btn-ghost" data-act="rbug" data-id="${g.id}" data-q="30">+30</button>
      </div></div>`;
  }
  h += `<div class="m-btns"><button class="btn btn-ghost" onclick="UI.closeModal()">关闭</button></div>`;
  UI.modal(h);
};

/* ---------------- 战绩卡片（canvas，可下载分享） ---------------- */
UI.drawShareCard = function (s, grade, nw, result) {
  const W = 750, H = 1040;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  if (!g) return null;

  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#2b1150'); bg.addColorStop(0.5, '#1b0a34'); bg.addColorStop(1, '#3a0f42');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 3; i++) {
    const rg = g.createRadialGradient([120, 620, 460][i], [90, 250, 900][i], 0, [120, 620, 460][i], [90, 250, 900][i], 380);
    rg.addColorStop(0, ['rgba(255,77,157,.30)', 'rgba(139,92,255,.28)', 'rgba(53,229,240,.22)'][i]);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
  }

  const F = (size, weight) => `${weight || 400} ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
  g.textAlign = 'center';

  g.font = F(72); g.fillText('🧋', W / 2, 150);
  g.fillStyle = '#ff4d9d'; g.font = F(54, 800);
  g.fillText('奶茶星球', W / 2, 240);
  g.fillStyle = '#8f82ad'; g.font = F(22);
  g.fillText('BUBBLE TYCOON · ' + diffOf(s).name + (s.endless ? ' · 无尽模式' : ''), W / 2, 282);

  const gg = g.createLinearGradient(W / 2 - 150, 0, W / 2 + 150, 0);
  gg.addColorStop(0, '#ff4d9d'); gg.addColorStop(0.5, '#ffc247'); gg.addColorStop(1, '#35e5f0');
  g.fillStyle = gg; g.font = F(200, 900);
  g.fillText(String(grade), W / 2, 470);
  g.fillStyle = '#f4eeff'; g.font = F(30, 700);
  g.fillText(result === 'bankrupt' ? '资金链断裂' : (nw >= goalOf(s) ? '目标达成！' : '未达成目标'), W / 2, 530);

  const st = s.stats;
  const rows = [
    ['最终净资产', money(nw)],
    ['经营天数', st.days + ' 天'],
    ['累计卖出', st.totalCups + ' 杯'],
    ['累计营收', money(st.totalRevenue)],
    ['最高单日净利', money(st.bestDayProfit)],
    ['最终口碑', Math.round(s.rep) + ''],
    ['分店数量', s.shops + ' 家'],
    ['成就', Object.keys(s.ach).length + '/' + ACHIEVEMENTS.length],
  ];
  /* roundRect 是较新的 Canvas API（Chrome 99+/Safari 16.4+），旧环境需降级为直角矩形 */
  g.fillStyle = 'rgba(255,255,255,.07)';
  if (typeof g.roundRect === 'function') {
    g.beginPath(); g.roundRect(60, 580, W - 120, 330, 24); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.15)'; g.lineWidth = 1.5; g.stroke();
  } else {
    g.fillRect(60, 580, W - 120, 330);
    g.strokeStyle = 'rgba(255,255,255,.15)'; g.lineWidth = 1.5; g.strokeRect(60, 580, W - 120, 330);
  }

  g.font = F(26);
  rows.forEach((r, i) => {
    const y = 632 + i * 36;
    g.textAlign = 'left'; g.fillStyle = '#c3b6e0'; g.fillText(r[0], 100, y);
    g.textAlign = 'right'; g.fillStyle = '#ffc247'; g.font = F(26, 700);
    g.fillText(r[1], W - 100, y);
    g.font = F(26);
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(100, y + 14); g.lineTo(W - 100, y + 14); g.stroke();
  });

  g.textAlign = 'center';
  g.fillStyle = '#8f82ad'; g.font = F(20);
  g.fillText('🌟 品牌声望 ' + window.META.bp + ' ★ · 已玩 ' + window.META.runs + ' 局', W / 2, 960);
  g.fillStyle = '#5f5478'; g.font = F(18);
  g.fillText(new Date().toLocaleDateString('zh-CN'), W / 2, 1000);
  return cv;
};

/* iOS Safari 完全不认 <a download>：点了没反应或新开空白页，
   但 Android Chrome 支持。两者必须走不同分支，否则 iOS 上会「显示成功实际没保存」。
   （iPadOS 13+ 会把 UA 伪装成 MacIntel，所以用 maxTouchPoints 二次判定。） */
const IS_IOS = (function () {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iP(hone|ad|od)/i.test(ua)) return true;
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
})();

UI.downloadCard = function () {
  const cv = $('shareCanvas');
  if (!cv) return;
  let url;
  try { url = cv.toDataURL('image/png'); }
  catch (e) { UI.toast('生成图片失败', 'err'); return; }

  if (IS_IOS) {
    /* iOS 唯一可靠的保存路径：把图显示出来让用户长按 → 「存储到照片」 */
    UI.modal(`<button class="close-x" onclick="UI.closeModal()">×</button>
      <div class="m-title">🖼️ 保存战绩卡片</div>
      <div class="m-sub" style="color:var(--amber)">长按下方图片 → 选择「存储到照片」</div>
      <div class="m-sec" style="text-align:center">
        <img src="${url}" alt="战绩卡片"
             style="width:100%;max-width:300px;border-radius:14px;-webkit-touch-callout:default"
             onclick="UI.closeModal()">
      </div>
      <div class="m-btns"><button class="btn btn-ghost" onclick="UI.closeModal()">关闭</button></div>`);
    return;
  }

  try {
    const a = document.createElement('a');
    a.download = '奶茶星球战绩_' + new Date().toISOString().slice(0, 10) + '.png';
    a.href = url;
    document.body.appendChild(a);   /* Firefox 要求节点在文档里才触发 */
    a.click();
    a.remove();
    UI.toast('🖼️ 战绩图已保存到下载目录', 'ok');
  } catch (e) { UI.toast('保存失败，可长按图片另存', 'err'); }
};

/* ---------------- 存档槽选择 ---------------- */
UI.renderSlots = function () {
  const box = $('slotPick');
  if (!box) return;
  let h = `<div class="slot-title">💾 存档槽</div><div class="slot-row">`;
  for (let i = 0; i < CFG.SAVE_SLOTS; i++) {
    const info = slotInfo(i);
    const on = getSlot() === i;
    h += `<div class="slot ${on ? 'on' : ''} ${info ? '' : 'empty'}" data-act="slot" data-id="${i}">
      <div class="sl-h">槽 ${i + 1}${on ? ' ✓' : ''}</div>
      ${info
        ? `<div class="sl-b">Day ${info.day}${info.endless ? ' ♾' : ''} · ${(DIFFICULTY[info.diff] ? DIFFICULTY[info.diff].name : esc(info.diff))}</div>
           <div class="sl-b" style="color:var(--amber)">${money(info.worth)}</div>`
        : `<div class="sl-b" style="color:var(--txt3)">空</div>`}
    </div>`;
  }
  h += `</div>`;
  if (!STORAGE_OK) {
    h += `<div class="storage-warn">⚠️ 浏览器存储不可用（隐私模式或空间已满），本局进度<b>无法保存</b>。</div>`;
  }
  box.innerHTML = h;
};

/* ---------------- 结局 ---------------- */
UI.showEnd = function (result) {
  const s = window.S;
  const d = diffOf(s);
  const nw = netWorth(s);
  let emoji, title, grade, gradeSub;
  if (result === 'bankrupt') {
    emoji = '💸'; title = '资金链断裂'; grade = 'F';
    gradeSub = `你在 Day ${s.day} 破产了，店铺被房东收回。`;
  } else {
    const goal = goalOf(s);
    const ratio = nw / goal;
    if (ratio >= 2) { emoji = '👑'; title = '奶茶帝国！'; grade = 'S'; }
    else if (ratio >= 1.35) { emoji = '🏆'; title = '连锁巨头'; grade = 'A'; }
    else if (ratio >= 1) { emoji = '🎉'; title = '目标达成'; grade = 'B'; }
    else if (ratio >= 0.6) { emoji = '🌱'; title = '小有起色'; grade = 'C'; }
    else { emoji = '😵'; title = '创业未遂'; grade = 'D'; }
    gradeSub = ratio >= 1
      ? `净资产 ${money(nw)}，超额完成 ${money(goal)} 的目标！`
      : `净资产 ${money(nw)}，距离目标 ${money(goal)} 还差 ${money(goal - nw)}。`;
  }
  const st = s.stats;
  const html = `<div class="end-emoji">${emoji}</div>
    <div class="end-title">${title}</div>
    <div class="end-grade">${grade}</div>
    <div style="font-size:12.5px;color:var(--txt2);margin-bottom:16px">${gradeSub}</div>
    ${(s.history || []).length >= 2 ? `<div class="card" style="text-align:left">
      <div class="card-h">📈 经营曲线</div><div id="endChart"></div></div>` : ''}
    <div class="card" style="text-align:left">
      <div class="rep-grid">
        <div class="rep-i"><div class="ri-k">最终净资产</div><div class="ri-v">${money(nw)}</div></div>
        <div class="rep-i"><div class="ri-k">经营天数</div><div class="ri-v">${st.days}</div></div>
        <div class="rep-i"><div class="ri-k">累计卖出</div><div class="ri-v">${st.totalCups} 杯</div></div>
        <div class="rep-i"><div class="ri-k">累计营收</div><div class="ri-v">${money(st.totalRevenue)}</div></div>
        <div class="rep-i"><div class="ri-k">最高单日净利</div><div class="ri-v">${money(st.bestDayProfit)}</div></div>
        <div class="rep-i"><div class="ri-k">最终口碑</div><div class="ri-v">${Math.round(s.rep)}</div></div>
        <div class="rep-i"><div class="ri-k">成就</div><div class="ri-v">${Object.keys(s.ach).length}/${ACHIEVEMENTS.length}</div></div>
        <div class="rep-i"><div class="ri-k">分店数量</div><div class="ri-v">${s.shops}</div></div>
      </div>
    </div>
    <div class="card" style="text-align:left">
      <div class="card-h">♻️ 品牌升级</div>
      <div style="font-size:12px;color:var(--txt2);line-height:1.7">
        本局可获得 <b style="color:var(--amber)">${prestigeGain(s)} ★</b> 品牌声望点（当前共 ${window.META.bp} ★）。<br>
        转生会重置本局进度，但声望点永久保留：每点客流 +2%、离线收益 +2%。
      </div>
      <div class="m-btns"><button class="btn btn-amber" data-act="prestige">♻️ 转生并开始新一局</button></div>
    </div>
    ${result !== 'bankrupt' ? `
    <div class="card" style="text-align:left">
      <div class="card-h">♻️ 无尽模式 <span class="ch-sub">不结束，目标持续升级</span></div>
      <div style="font-size:12px;color:var(--txt2);line-height:1.7">
        从第 ${s.day} 天继续经营，目标将提升为 <b style="color:var(--amber)">${money(endlessGoal(diffOf(s).goal, Math.max(1, s.milestone || 0)))}</b>，
        每达成一次再涨 55%。适合想把数值卷到极致的人。
      </div>
      <div class="m-btns"><button class="btn btn-cyan" data-act="endless">♾️ 继续经营（无尽）</button></div>
    </div>
    <div class="card" style="text-align:left">
      <div class="card-h">🖼️ 战绩卡片</div>
      <div id="shareBox" class="share-box"></div>
      <div class="m-btns"><button class="btn btn-primary" data-act="dlcard">⬇️ 保存战绩图</button></div>
    </div>` : ''}
    <div class="m-btns">
      <button class="btn btn-primary" data-act="again">🔄 再来一局</button>
      <button class="btn btn-ghost" data-act="home">🏠 回主菜单</button>
    </div>`;
  $('endWrap').innerHTML = html;

  /* 曲线图 + 战绩卡片（需要 DOM 就位后再插入 canvas） */
  const chartHost = $('endChart');
  if (chartHost && (s.history || []).length >= 2) chartHost.innerHTML = UI.chartSVG(s, 620, 180);
  const sb = $('shareBox');
  if (sb && result !== 'bankrupt') {
    const cv = UI.drawShareCard(s, grade, nw, result);
    if (cv) { cv.id = 'shareCanvas'; sb.appendChild(cv); }
    else sb.innerHTML = `<div style="font-size:11.5px;color:var(--txt3)">当前浏览器不支持生成图片</div>`;
  }

  UI.showScreen('screen-end');
  if (result !== 'bankrupt' && nw >= goalOf(s)) UI.confetti(90);
};

/* ---------------- 导入 / 导出存档 ---------------- */
UI.showExport = function () {
  /* 入口在标题页，而标题页通常没有 window.S（还没开局）。
     这时导出当前存档槽里的进度 —— 否则按钮点了只会给出一段空码。 */
  let s = window.S;
  if (!s) { try { s = loadGame(); } catch (e) { s = null; } }
  if (!s) { UI.toast('还没有可导出的存档，先开始或继续一局', 'err'); return; }
  const code = exportSave(s);
  if (!code) { UI.toast('存档导出失败，请重试', 'err'); return; }
  UI.modal(`<button class="close-x" onclick="UI.closeModal()">×</button>
    <div class="m-title">📤 导出存档</div>
    <div class="m-sub">复制下面的文本，在另一台设备的「导入存档」中粘贴</div>
    <textarea class="code-box" id="exportCode" readonly>${code}</textarea>
    <div class="m-btns">
      <button class="btn btn-primary" onclick="UI.copyCode()">📋 复制</button>
      <button class="btn btn-ghost" onclick="UI.closeModal()">关闭</button>
    </div>`);
};
UI.copyCode = function () {
  const ta = $('exportCode');
  if (!ta) return;
  const done = () => UI.toast('📋 已复制到剪贴板', 'ok');
  const fail = () => UI.toast('复制失败，请长按选中后手动复制', 'err');

  /* execCommand 已废弃且在部分 iOS 版本失效，优先走异步 Clipboard API；
     它需要安全上下文（https 或 localhost），file:// 下会自动回落到老办法。 */
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value).then(done, () => {
      try { ta.select(); document.execCommand('copy') ? done() : fail(); }
      catch (e) { fail(); }
    });
    return;
  }
  try {
    if (IS_IOS) {
      /* iOS 上 select() 对只读区域经常无效，且 setSelectionRange 才可靠 */
      ta.setSelectionRange(0, ta.value.length);
    } else {
      ta.select();
    }
    document.execCommand('copy') ? done() : fail();
  } catch (e) { fail(); }
};
UI.showImport = function () {
  UI.modal(`<button class="close-x" onclick="UI.closeModal()">×</button>
    <div class="m-title">📥 导入存档</div>
    <div class="m-sub">粘贴之前导出的存档文本</div>
    <textarea class="code-box" id="importCode" placeholder="在这里粘贴存档代码…"></textarea>
    <div class="m-btns">
      <button class="btn btn-primary" data-act="doimport">导入并继续</button>
      <button class="btn btn-ghost" onclick="UI.closeModal()">取消</button>
    </div>`);
};

/* ---------------- 离线收益 ---------------- */
UI.showOffline = function (o) {
  const html = `<div class="m-title">🛵 外卖订单到账</div>
    <div class="m-sub">你离开的 ${o.mins} 分钟里，店铺仍在接单</div>
    <div style="font-size:32px;font-weight:900;color:var(--amber);text-align:center;margin:14px 0">+${money(o.gain)}</div>
    <div class="m-btns"><button class="btn btn-primary" onclick="UI.closeModal()">收下</button></div>`;
  UI.modal(html);
};
