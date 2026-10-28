/* ============================================================
 *  奶茶星球 · Bubble Tycoon  —— UI 渲染与交互
 * ============================================================ */
'use strict';

const $ = id => document.getElementById(id);

/* HTML 转义：任何进入 innerHTML 的动态文本都必须过这一层。
   存档可导出/导入，敌方构造的存档里可能带 <img onerror> 之类 payload，
   渲染层不能信任状态里的字符串。
   实现放在 engine.js 的 escText()（引擎内部拼 HTML 片段时也要用），这里只是取个别名。
   以前这里自己声明了一份同名的 ESC_MAP —— 经典脚本的顶层 const/let 落在**同一个**
   全局词法环境里，同名重复声明不是覆盖，而是让后加载的文件整份解析失败
   （H5 端表现为白屏，控制台只有一句 "already been declared"）。 */
const esc = escText;
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
  /* ===== V14.3 语义分层 =====
   * ★ 为什么要有分层（实测出来的）：
   *   `click` 原本被当**万能音**用了 25 次 —— 买原料、上架菜单、招人、
   *   雇店长、切城、关店……**全是同一个「叮」**。
   *   玩家听到声音，但不知道那是"买了东西"还是"雇了人"，
   *   听觉反馈退化成背景噪声 —— 相当于没有。
   *
   * ★ 分层的依据是**语义**而不是音量：
   *   操作（切换/查看）→ 中性短促，纯确认用
   *   交易（买进/卖出/上架）→ 音高**上行**，"到手了"
   * 人事（招/雇/调/撤）→ **双音**，有"决定"的仪式感
   *   警示（撤职/关店/清仓）→ 音高**下行**，"失去了"
   *   玩家闭着眼睛也能大致分辨刚才是"赚了"还是"亏了"。
   *
   * ★ 保持 click() 作为「操作」层的向后兼容入口：
   *   未分类的调用点继续走 click，不会因为漏改而没声音。 */
  click() { this.tone(760, 0.05, 'square', 0.07); },

  /** 交易层：买进 / 卖出 / 上架 —— 上行双音，表示"东西到手" */
  deal() { this.tone(680, 0.06, 'triangle', 0.08); this.tone(1020, 0.09, 'triangle', 0.07, 0.05); },

  /** 人事层：招人 / 雇店长 / 调动 —— 双音并列，像"敲定" */
  hire() { this.tone(620, 0.07, 'square', 0.07); this.tone(880, 0.10, 'triangle', 0.08, 0.06); },

  /** 警示层：撤职 / 关店 / 清仓 / 解雇 —— 下行，表示"失去" */
  lose() { this.sweep(520, 240, 0.16, 'triangle', 0.08); },

  /** 达成层：锚点达成 / 目标达成 —— 三音上行（比 up 更"亮"，用于里程碑） */
  reach() { [784, 988, 1319].forEach((f, i) => this.tone(f, 0.18, 'sine', 0.09, i * 0.09)); },

  coin() { this.tone(1180, 0.07, 'triangle', 0.09); this.tone(1620, 0.09, 'triangle', 0.07, 0.05); },
  /* ★ V20：出杯音支持音阶递进。
     chain = 连续出杯的次数（0~8），每级升一个半音。
     ★ 为什么用音阶而不是准备多个音效文件：
       零依赖的项目不该为了一点反馈引入音频资源，
       而音阶只改一个数字 —— 成本几乎为零，且天然带「进展感」。
     ★ 上限 8 级：再高就尖得刺耳了，而且玩家听不出区别。 */
  serve(chain) {
    const n = Math.max(0, Math.min(8, Number(chain) || 0));
    const f = 880 * Math.pow(2, n / 12);
    this.tone(f, 0.06, 'sine', 0.06);
    /* 连续 3 级以上加一个泛音，让高音不显得单薄 */
    if (n >= 3) this.tone(f * 2, 0.04, 'sine', 0.03);
  },
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

/* ============================================================
 *  V16 跨页跳转状态
 * ============================================================
 *
 * ★ 要解决的问题：
 *   「点原料跳到市场」「点配方跳到研发树」这类需求，
 *   光切 tab 是不够的 —— 目标可能**不在首屏**（研发树按城市分了好几组，
 *   市场可能有 20+ 行），切过去之后玩家还得自己找。
 *
 * ★ 三个状态缺一不可：
 *   jumpTab     要跳到哪个面板
 *   jumpFocus   要高亮什么（配方 id / 原料 id）
 *   jumpFrom    来源（决定返回按钮写什么、有没有返回按钮）
 *
 * ★ 为什么放在 UI 而不是引擎：
 *   这是**纯导航状态**，不参与玩法计算，也不需要存档
 *   （刷新页面后回到首屏本来就是合理的）。
 */
UI.nav = {
  tab: null,      /* 待跳转的 tab */
  focus: null,    /* 待高亮的 id */
  kind: null,     /* 'recipe' | 'ing' | null */
  from: null,     /* 来源 tab */
  fromLabel: null,/* 来源的中文名（返回按钮上写） */
};

/**
 * 跳转到一个面板并高亮某一项（V16）
 *
 * @param {string} tab    目标面板
 * @param {string} kind   'recipe' | 'ing'
 * @param {string} id     高亮目标的 id
 * @param {object} [opt] { from, fromLabel }
 */
UI.jumpTo = function (tab, kind, id, opt) {
  const o = opt || {};
  UI.nav.tab = tab;
  UI.nav.kind = kind;
  UI.nav.focus = id;
  UI.nav.from = UI.tab || o.from || null;
  UI.nav.fromLabel = o.fromLabel || TAB_LABEL(UI.nav.from);
  UI.setTab(tab);
  /* 高亮要等 DOM 重建后再打，所以放到下一帧 */
  if (UI._hlTimer) clearTimeout(UI._hlTimer);
  UI._hlTimer = setTimeout(() => UI.applyHighlight(), 40);
};

/** 返回跳转前的面板（返回按钮） */
UI.navBack = function () {
  const back = UI.nav.from;
  UI.nav.tab = null; UI.nav.focus = null; UI.nav.kind = null;
  if (UI._hlTimer) clearTimeout(UI._hlTimer);
  if (back) UI.setTab(back);
  else UI.toast('已经在最初的页面了', 'err');
};

/** tab 的中文名（返回按钮用） */
function TAB_LABEL(t) {
  return { manage: '经营页', lab: '研发页', up: '升级页', staff: '员工页', rival: '商圈页', ach: '成就页' }[t] || '上一页';
}

/**
 * 跳转来源条（V16）—— 统一的返回方式
 *
 * ★ 为什么必须有：
 *   跨页跳转后玩家会失去位置感 ——「我在哪、怎么回去」。
 *   少了这个，他只能靠浏览器返回（移动端根本没有）或乱点 tab 找路。
 *
 * ★ 模式统一：所有跳转共用这一条、同一套文案、同一个按钮，
 *   玩家学一次就能一直用 —— 这才是交互一致性，
 *   而不是每个跳转各写一个提示。
 */
UI.jumpFromHtml = function () {
  if (!UI.nav || !UI.nav.from) return '';
  return `<div class="jump-from">
    <button class="btn btn-sm btn-ghost" data-act="navback">← 回到${esc(UI.nav.fromLabel)}</button>
    <span>从 <b>${esc(UI.nav.fromLabel)}</b> 跳来</span>
  </div>`;
};

/**
 * 给目标元素打上高亮类（V16）
 * ★ 必须在 DOM 重建之后调用 —— 面板内容是整块 innerHTML 重写的。
 */
UI.applyHighlight = function () {
  const k = UI.nav.kind, id = UI.nav.focus;
  if (!k || !id) return false;
  /* 两种选择器：配方卡用 data-rid，原料行用 data-ing */
  const sel = k === 'recipe'
    ? `.rc[data-rid="${id}"], .cui-card[data-rid="${id}"]`
    : `.mkt-row[data-ing="${id}"]`;
  let el = document.querySelector(sel);
  /* 配方卡可能还没带 data-rid（V16 才加的）→ 退回到按文本找 */
  if (!el) {
    el = Array.prototype.find.call(document.querySelectorAll('.rc, .mkt-row'), (n) =>
      n.querySelector('[data-rid="' + id + '"]') || n.getAttribute('data-rid') === id);
  }
  if (!el) return false;
  /* 滚动到可见 */
  try {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } catch (e) {
    /* 老浏览器没有 scrollIntoView 选项 —— 直接 scrollTop 也行 */
    try { el.scrollIntoView(); } catch (e2) { /* 真的不支持就算了，只高亮 */ }
  }
  el.classList.add('jump-hl');
  setTimeout(() => el && el.classList.remove('jump-hl'), 2200);
  return true;
};

/** 展开某个原料的用途列表（V16 的 +N 按钮） */
UI.toggleIngUses = function (ingId) {
  UI.expandUses = UI.expandUses || {};
  UI.expandUses[ingId] = !UI.expandUses[ingId];
  UI.renderPanel(UI.tab);
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
/* 只接 html 一个参数。原来还有个 onClose 回调参数（配一套 UI._modalClose 机制），
   但全仓 14 处 UI.modal() 调用没有一个传第二参 —— 需要"关闭时做点什么"的地方
   都改成在调用方自己处理了。留着只会让人以为存在这条路径。 */
UI.modal = function (html) {
  const root = $('modal');
  $('modalBox').innerHTML = html;
  root.dataset.lock = '0';
  root.classList.add('on');
};
UI.closeModal = function () {
  $('modal').classList.remove('on');
  $('modalBox').innerHTML = '';
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
/* HUD 节点缓存：renderHUD 每帧都跑（主循环里跟在 tick 后面），
   里面 7 次 $() 就是一秒四百多次 getElementById —— 挂在热路径上的白给开销。
   和舞台节点的 UI.el 是同一套做法。HUD 是 index.html 里的静态节点，不会重建。 */
let HUD_EL = null;
function hudEl() {
  if (!HUD_EL) {
    HUD_EL = {
      day: $('hudDay'), cash: $('hudCash'), rep: $('hudRep'), worth: $('hudWorth'),
      goalFill: $('goalFill'), goalText: $('goalText'),
      /* ★ V14：分段仪表的刻度条 */
      goalTicks: $('goalTicks'),
      /* ★ V13.8：负债警示条（平时 hidden，不占空间） */
      debtBar: $('debtBar'), debtText: $('debtText'),
    };
  }
  return HUD_EL;
}

UI.renderHUD = function () {
  const s = window.S; if (!s) return;
  const h = hudEl();
  /* ★ V13.8：脏检查 —— 值没变就不写 DOM。
     renderHUD 挂在主循环上（每帧都跑，60fps = 420 次/秒 DOM 写），
     但营业中 cash/rep/netWorth **只在「完成订单」时才变**，
     绝大多数帧这些值根本没动 —— 那些 DOM 写是纯浪费。
     ★ style.width / style.color 尤其贵（触发样式重算，不是单纯赋值），
       移动端低端机上能明显感觉到。
     ★ 做法：和上次写入的值比，相同则跳过。
       注意 innerHTML 的 day 每天都变（无尽模式还有 milestone），
       所以仍要算 —— 但它只写一次字符串，开销可忽略。 */
  const dayTxt = s.endless
    ? `${num(s.day, 1)}<i> 无尽·${num(s.milestone)}阶</i>`
    : `${num(s.day, 1)}<i>/${CFG.DAYS}</i>`;
  if (HUD_CACHE.day !== dayTxt) { h.day.innerHTML = dayTxt; HUD_CACHE.day = dayTxt; }

  const cashTxt = money(num(s.cash));
  if (HUD_CACHE.cash !== cashTxt) { h.cash.textContent = cashTxt; HUD_CACHE.cash = cashTxt; }

  const repTxt = String(Math.round(num(s.rep)));
  if (HUD_CACHE.rep !== repTxt) { h.rep.textContent = repTxt; HUD_CACHE.rep = repTxt; }

  const nw = num(netWorth(s));
  const worthTxt = money(nw);
  if (HUD_CACHE.worth !== worthTxt) { h.worth.textContent = worthTxt; HUD_CACHE.worth = worthTxt; }

  /* ★★ V14：进度条改成**分段仪表**。
   *
   * 原来：`goalOf(s)` 恒返回最终目标（38000），
   *   于是进度条 Day1 就显示 2% ——「开局就欠 3 万 4」，
   *   而这个数字 30 天不变，中间 29 天提供**零信息**。
   *
   * 现在：指向**下一个中期锚点**（第1 段 9% = ¥3420），
   *   玩家每一天都能回答「今天够不够」——
   *   仪表盘的作用不是显示"离终点多远"，是显示"现在该做什么"。
   *
   * ★ 阶段进度用「本段起点」做分母（nextGoalOf 里算），
   *   否则跨段瞬间会从 100% 掉回很低 —— 视觉上像倒退，很泄气。
   * ★ 同时画出 6 段刻度，让玩家看到全程节奏。 */
  const gm = nextGoalOf(s);
  const p = pct(gm.phase * 100);
  /* style.width 用实际值判断，避免字符串精度差异导致每帧都写 */
  if (HUD_CACHE.goalW !== p) { h.goalFill.style.width = p + '%'; HUD_CACHE.goalW = p; }

  /* 刻度条：6 段，随进度点亮已过的部分 */
  const ticks = MILESTONE_RATIO.map((r, i) =>
    `<i class="gt-tick${i < gm.idx ? ' on' : (i === gm.idx ? ' cur' : '')}"></i>`).join('');
  if (HUD_CACHE.ticks !== gm.idx) {
    if (h.goalTicks) h.goalTicks.innerHTML = ticks;
    HUD_CACHE.ticks = gm.idx;
  }

  const share = num(rivalShare(s));
  /*★ 文案跟着口径一起改** —— 这是这次改动的关键一半：
     只改进度条不改文案，等于让玩家盯着一个没有意义的百分比。 */
  const goalTxt = gm.reached
    ? `✔ 已达第 ${gm.idx + 1} 阶段目标 ${money(gm.value)}`
      + (gm.nextAt ? ` · 下一阶段 Day${gm.nextAt}` : ' · 已是最终目标')
    + (share >= 0.15 ? ` · 🦑对手抢 ${Math.round(share * 100)}%` : '')
    : `阶段目标 ${money(gm.value)} · ${p.toFixed(0)}%`
      + (gm.nextAt ? ` · 下一阶段 Day${gm.nextAt}` : '')
      + (share >= 0.15 ? ` · 🦑对手抢 ${Math.round(share * 100)}%` : '');
  if (HUD_CACHE.goalT !== goalTxt) { h.goalText.textContent = goalTxt; HUD_CACHE.goalT = goalTxt; }

  /* 负现金标红：同样用脏检查（color 写也会触发样式重算） */
  const color = num(s.cash) < 0 ? 'var(--red)' : '';
  if (HUD_CACHE.cashColor !== color) { h.cash.style.color = color; HUD_CACHE.cashColor = color; }
  /* ★ V13.8：负债提示 —— 之前 debtDays 只存在于数据里，UI 完全不显示。
     玩家看到红色「¥-450」却不知道：
       ① 还能撑几天（欠 2 天就破产）
       ② 怎么才算过关（现金回到 ¥0 以上就解除）
     这是典型的「异常状态有内部表示、但没告诉玩家」。
     ★ 用 title（悬停提示）+ 短文案，不占 HUD 横向空间。 */
  const debtTxt = num(s.debtDays, 0) >= 1
    ? `负债 ${money(Math.abs(num(s.cash)))} · 还剩 ${2 - num(s.debtDays, 0)} 天破产`
    : '';
  if (HUD_CACHE.debt !== debtTxt) {
    /* 悬停提示（桌面端） */
    h.cash.title = debtTxt
      ? `⚠️ ${debtTxt}：连续 2 天现金为负就破产。现金回到 ¥0 以上即可解除。`
      : (STORAGE_OK ? '' : '⚠️ 浏览器存储不可用，进度无法保存');
    /* ★ 可见警示条 —— 移动端没有 hover，只有 title 等于没有提示 */
    if (h.debtBar && h.debtText) {
      h.debtBar.hidden = !debtTxt;
      if (debtTxt) h.debtText.textContent = debtTxt + '，现金回到 ¥0 即可解除';
    }
    HUD_CACHE.debt = debtTxt;
  }
  if (!STORAGE_OK) h.cash.title = '⚠️ 浏览器存储不可用，进度无法保存';
};

/** HUD 上次写入的值（用于脏检查）。
 *  ★ 切换局面（开局/读档）时必须作废 —— 否则新局面的 HUD 会停留在旧值上，
 *    而因为「值相同就不写」，旧值恰好等于新值时不更新就对了、
 *    不等时又会写……看似没问题，但**节点可能已经被替换**（换局重建 HUD），
 *    缓存里的旧值会让新节点漏更新。所以新局要显式清空。 */
const HUD_CACHE = { day: '', cash: '', rep: '', worth: '', goalW: '', goalT: '', cashColor: '', debt: '', ticks: -1 };
UI.resetHUDCache = function () {
  for (const k in HUD_CACHE) HUD_CACHE[k] = (k === 'goalW') ? '' : '';
  HUD_CACHE.goalW = -1;      /* 进度条用数值，初值 -1 保证首帧一定写 */
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

  /* ★ V16：从别处跳来时的来源条（统一的返回方式）。
     玩家从研发页点原料跳到市场，得知道「我在哪、怎么回去」——
     没有这个他只能靠浏览器/系统返回，或者乱点 tab 找路。 */
  h += UI.jumpFromHtml();

  /* 已持有的经营策略卡（没有则整块不渲染） */
  h += UI.cardsChipsHtml(s);

  /* news.text 来自存档（可导出 / 导入），必须转义。

     ★ 这里曾经是唯一一处漏掉 esc() 的动态文本，导入一份带 payload 的存档就能执行。
     ★ 但「唯一一处」只描述当时 —— V12/V13 新增了
       store.name/emoji、manager.name/emoji、formerManagers[].name/emoji/fromStore
       等存档可控字段，其中 3 个 emoji 字段一度漏了 esc()
       （同对象上的 name 转义了 —— 同一对象里只转义一半，
         review 时很容易误以为「name 都转了，应该没事」）。

     ★ 所以别再依赖注释，改跑 node tools/check-escape.js ——
       它会逐个污染 10 个存档可控字段、扫 6 个面板，
       只要有一个没转义就报错。新加存档字段时把它加进那个列表。

     ⚠️⚠️ 写这段注释时踩过两个坑，别再犯：
       ① 它必须写在模板字符串**外面**。
          写在 h += 反引号包裹的模板内部的话，注释起始符只是字面文本，
          会把整段注释**原样渲染到游戏界面上**（V12 起就一直是坏的，
          只是当时只有 2 行不明显；扩写成 12 行后一眼就能看见）。
       ② 注释里不能出现「注释闭合符」，也不能出现反引号 ——
          会提前结束块注释导致语法错误。 */
  const newsHtml = s.news
    ? `<div style="margin-top:9px;font-size:var(--fs-md);color:var(--amber)">📰 ${esc(s.news.text)}</div>`
    : '';

  /* 今日情报 */
  h += `<div class="card"><div class="card-h">📡 今日情报 <span class="ch-sub">Day ${s.day}</span></div>
    <div class="intel">
      <div class="intel-i"><div class="ii-k">天气</div><div class="ii-v">${s.weather.emoji} ${s.weather.name}</div>
        <div style="font-size:var(--fs-xs);color:var(--txt3)">客流 ×${s.weather.traffic}</div></div>
      <div class="intel-i"><div class="ii-k">今日流行</div><div class="ii-v">${tag.emoji} ${tag.name}</div>
        <div style="font-size:var(--fs-xs);color:var(--txt3)">命中销量 +55%</div></div>
      <div class="intel-i"><div class="ii-k">明日预告</div><div class="ii-v">${s.trendKnown ? nextTag.emoji + ' ' + nextTag.name : '❓ 未知'}</div>
        ${s.trendKnown ? '' : '<button class="btn btn-sm btn-ghost" data-act="scout" style="margin-top:3px">🔍 调研 ¥150</button>'}</div>
    </div>
    ${newsHtml}
  </div>`;

  /* 每日合同（V1）：放在所有卡片最上面 ——
     它是「今天要凑什么」的方向盘，玩家会照着它改采购、改菜单、改定价，
     所以必须在备货页第一眼看到，而不是和每日任务混在一起。 */
  const ct = contractView(s);
  if (ct) {
    const progTxt = ct.prog === null ? (ct.done ? '已达成' : '打烊时结算')
      : `${ct.prefix}${Math.round(ct.prog)}/${ct.prefix}${ct.goal}${ct.unit}`;
    h += `<div class="card contract${ct.done ? ' done' : ''}" data-tut="contract">
      <div class="card-h">📜 今日合同
        <span class="ch-sub">开门前就知道目标 · 打烊结算</span></div>
      <div class="ct-row">
        <span class="ct-e">${ct.emoji}</span>
        <span class="ct-n">${ct.name}</span>
        <span class="ct-desc">${ct.desc}</span>
        <span class="ct-r">${ct.done ? '✅ 已达成' : '+' + money(ct.cash)}</span>
      </div>
      <div class="ct-bar"><i style="width:${(ct.ratio * 100).toFixed(1)}%"></i></div>
      <div class="ct-sub">${progTxt}${ct.done ? '' : (ct.failRep < 0 ? ` · 未达成扣口碑 ${ct.failRep}` : ' · 未达成不扣口碑')}</div>
    </div>`;
  }

  /* V5 章节关卡：中期目标（跨 5 天推进），紧跟在每日合同之后 ——
     两个都是"开门前就知道目标"的方向盘，但时间尺度不同：
     合同是今天这一关，关卡是这一整章。

     ★ V13.5：地域挑战关卡要给出**具体目标**，否则玩家没法准备 ——
       「卖出特色菜系 12 杯」得告诉他是哪道菜系；
       「在本地卖出 18 杯」得告诉他是哪个城市。
       ★★ 下面那两行目标提示的说明**必须写在这里（模板外）** ——
         写在模板字符串内部的话，注释只是字面文本，会被原样渲染到界面上
         （V13.5 又踩过一次，check-leak 直接抓到）。 */
  const sv = stageView(s);
  if (sv) {
    const steps = sv.stages.map(x =>
      `<span class="stg-step${x.done ? ' on' : ''}${x.current ? ' cur' : ''}">${x.emoji}${esc(x.name)}</span>`
    ).join('');
    const diffBtns = sv.diffs.map(d =>
      `<button class="btn btn-sm ${d.cur ? 'btn-primary' : 'btn-ghost'}" data-act="stagediff" data-id="${d.id}"
        title="门槛 ${d.goal} · 奖励 ${money(d.cash)}">${d.emoji}${esc(d.name)}</button>`
    ).join('');
    h += `<div class="card stage${sv.chapterDone ? ' done' : ''}" data-tut="stage">
      <div class="card-h">🏔️ 第 ${sv.chapter} 章 · 关卡
        <span class="ch-sub">本章 ${sv.cleared}/${sv.total} · 共 ${sv.chapterCount} 章</span>
        ${sv.backlog > 0 ? `<span class="stg-backlog">待补 ${sv.backlog} 关</span>` : ''}</div>
      <div class="stg-steps">${steps}</div>
      ${sv.chapterDone
        ? `<div class="stg-sub" style="color:var(--green)">✅ 本章已通关 · 明天进入第 ${Math.min(sv.chapterCount, sv.chapter + 1)} 章</div>`
        : sv.cur ? `
        <div class="stg-cur">
          <span class="stg-e">${sv.cur.emoji}</span>
          <span class="stg-n">${esc(sv.cur.name)}</span>
          <span class="stg-d">${esc(sv.cur.desc)}</span>
          <span class="stg-r">+${money(sv.cur.cash)}</span>
        </div>
        ${sv.cur.cuisine ? `<div class="stg-target">🎯 目标菜系：${esc(sv.cur.cuisine.emoji)} ${esc(sv.cur.cuisine.name)}
          <span class="stg-target-sub">${esc(sv.cur.cuisine.desc)}</span></div>` : ''}
        ${sv.cur.cityName ? `<div class="stg-target">🎯 目标城市：${esc(sv.cur.cityName)}
          <span class="stg-target-sub">在当前经营城市卖出的杯数</span></div>` : ''}
        <div class="stg-diffs">
          <span class="stg-dl">难度</span>${diffBtns}
          <span class="stg-hint">难度越高门槛越大、奖励越丰厚 · 未达成只失奖励不扣口碑</span>
        </div>` : ''}
    </div>`;
  }

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
  /* ★ V10：市场只列**当前城市买得到**的原料。
     全部 29 种列出来的话，北京的玩家会看到 20+ 行「藤椒油 ¥3.50」点下去没反应
     （当地买不到）—— 表现为整个市场像是坏了。
     本地原料单独提示，让"为什么别的地方看不到"这件事有解释。 */
  const mktCity = currentCityId(s);
  const localSet = new Set(ingsOfCity(mktCity).map(g => g.id));
  let buyable = ING.filter(g => ingAvailableAt(g.id, mktCity));
  /* ★ V16：跳转过滤 —— 从配方跳过来时只看那一项，
     否则玩家在 20+ 行里还要自己找（市场是本次改造里最长的列表）。
     ★ 一旦展开/搜索就取消过滤，否则玩家会以为「其他原料不见了」。 */
  if (UI.nav.kind === 'ing' && UI.nav.focus && !UI.ingFilter) {
    const focus = UI.nav.focus;
    const hit = buyable.filter(g => g.id === focus);
    if (hit.length) {
      buyable = hit;
      h += `<div class="jump-from">
        <button class="btn btn-sm btn-ghost" data-act="ingshowall">← 显示全部原料</button>
        <span>已定位到 <b>${esc(hit[0].emoji + hit[0].name)}</b></span>
      </div>`;
    }
  }
  if (localSet.size) {
    h += `<div style="font-size:var(--fs-sm);color:var(--txt3);margin-bottom:8px">
      🗺️ 本地特产：${esc(ingsOfCity(mktCity).map(g => g.emoji + g.name).join('、'))}</div>`;
  }
  /* ★ V21：今日需求只算一次（stockNeedOf 是单一真相，详见 engine 里那段注释）。
     原来界面上只有「存 N」——玩家得自己估今天要买多少，
     或者干脆跳过计算直接点「一键补货」。后者不算错，但那就没有决策了。 */
  const needInfo = stockNeedOf(s);
  for (const g of buyable) {
    const p = s.prices[g.id], pv = s.prevPrices[g.id] || p;
    const dir = p > pv + .001 ? 'up' : (p < pv - .001 ? 'down' : '');
    const arrow = dir === 'up' ? '▲' : (dir === 'down' ? '▼' : '—');
    const ratio = clamp(p / (g.base * 2.3), 0, 1);
    /* ★ V13.9：补上「相对基准价」的两个信号 ——
       ① 今天是涨还是跌（dir/arrow，玩家已经熟悉）
       ② **相对基准价便不便宜**（徽章）——
          没有第②个时，玩家只能看到「比昨天贵了」，
          却不知道「其实比基准价便宜很多，值得囤」。
       ★ 阈值与「抄底大师」成就共用 CFG.BARGAIN_RATIO：
          徽章亮了却没触发成就（或反之）会让玩家困惑。 */
    const vsBase = p / g.base;
    const bargain = vsBase <= CFG.BARGAIN_RATIO;
    const pctTxt = Math.round((vsBase - 1) * 100);
    h += `<div class="mkt-row${localSet.has(g.id) ? ' local' : ''}${bargain ? ' bargain' : ''}"
      data-ing="${esc(g.id)}">
      <div class="mkt-e">${g.emoji}</div>
      <div class="mkt-n">${g.name}
        ${bargain ? `<span class="mkt-tag" title="低于基准价 ${Math.round((1 - CFG.BARGAIN_RATIO) * 100)}% · 现在买很划算">📉 抄底</span>` : ''}</div>
      <div class="mkt-p ${dir}">¥${p.toFixed(2)} ${arrow}
        <span class="mkt-vs">${pctTxt > 0 ? '+' : ''}${pctTxt}%</span></div>
      <div class="mkt-bar"><i style="width:${ratio * 100}%"></i></div>
      <div class="mkt-c">存 ${Math.round(s.inv[g.id] || 0)}${(needInfo.gap[g.id] || 0) > 0
        ? `<span class="mkt-gap" title="今日预计需要 ${Math.ceil(needInfo.need[g.id] || 0)}，还差 ${needInfo.gap[g.id]}">差 ${needInfo.gap[g.id]}</span>`
        : ''}</div>
      <div class="mkt-btns">
        <button class="btn btn-ghost" data-act="buy" data-id="${g.id}" data-q="10">+10</button>
        <button class="btn btn-ghost${(needInfo.gap[g.id] || 0) > 0 ? ' btn-cyan' : ''}"
          data-act="buy" data-id="${g.id}" data-q="${Math.max(10, needInfo.gap[g.id] || 0)}"
          title="补足今天的用量（预计需要 ${Math.ceil(needInfo.need[g.id] || 0)}）">${(needInfo.gap[g.id] || 0) > 0 ? '补足' : '+30'}</button>
        <button class="btn btn-ghost mkt-sell" data-act="sell" data-id="${g.id}"
          title="按当前价${Math.round(CFG.LIQUID_RATE * 100)}% 回购（清仓腾仓位）"
          ${(s.inv[g.id] || 0) > 0 ? '' : 'disabled'}>清仓</button>
      </div>
      ${marketIngUsesHtml(s, g)}
    </div>`;
  }
  /* ★ V13.9：一键补货要说清「做了什么」。
     原来点完只有 toast 报「花了多少」，玩家不知道买到了什么、
     有没有买齐。这与 V13.9 重写 autoFill（按菜单需求分配）是配套的：
     现在补货是有策略的，就该把策略结果讲出来。 */
  h += `<div style="display:flex;gap:7px;margin-top:10px">
      <button class="btn btn-cyan" style="flex:1" data-act="autofill">🛒 一键补货</button>
    </div>
    <div style="font-size:var(--fs-xs);color:var(--txt3);margin-top:5px;line-height:1.6">
      按<b>今日菜单的需求</b>买齐原料（按缺口紧急度排序），有余量再补当前便宜的。</div>`;

  /* ★ V13.9：「清理买不到的料」——
     切城后旧城专属料会留在仓库里，新城买不到也用不上，
     却占着仓位让需要的料进不来。没有这一步就是**玩家无解的死局**。
     ★ 只在**确实有这类料**时才显示 —— 常驻一个用不上的按钮是噪音。 */
  const stale = ING.filter(g => (s.inv[g.id] || 0) > 0 && !ingAvailableAt(g.id, mktCity));
  if (stale.length) {
    const staleQty = stale.reduce((n, g) => n + (s.inv[g.id] || 0), 0);
    const refund = stale.reduce((n, g) =>
      n + Math.round(num(s.prices[g.id], g.base) * CFG.LIQUID_RATE * (s.inv[g.id] || 0)), 0);
    h += `<div style="margin-top:9px;padding:7px 9px;border-radius:9px;
        background:rgba(255,194,71,.10);border:1px solid rgba(255,194,71,.26)">
      <div style="font-size:var(--fs-sm);color:var(--amber);line-height:1.6">
        ⚠️ 仓库里有 <b>${staleQty}</b> 个<b>本地买不到</b>的原料
        （${stale.slice(0, 3).map(g => esc(g.name)).join('、')}${stale.length > 3 ? '…' : ''}），
        它们正占着仓位。</div>
      <button class="btn btn-sm" style="margin-top:6px;width:100%"
        data-act="sellstale">清掉它们（回收约 ${money(refund)}）</button>
    </div>`;
  }
  h += `</div>`;

  /* ---------- V11 店长与分店编制 ----------
     放在「原料市场」之后：它属于人事管理，重要性低于"今天卖什么"，
     但仍留在管理页 —— 招完人往往顺手看一眼编制。 */
  h += managerPanelHtml(s);

  /* ---------- V13.6 常客名册 ----------
     放在「店长与分店编制」之后：都是"经营人/客情"这一类，
     玩家做完今天的活、安排好人手，顺手看一眼熟客。
     ★ 常客是**个体**层面的东西（不是全局口碑），
       所以必须有个地方看得到"谁是我的熟客"。 */
  h += regularPanelHtml(s);

  /* 菜单 */
  const slots = menuSlots(s);
  /* ★★ V21：菜单卡改成「在售全量 + 未上架折叠」。
     ★ 原来是把 s.recipes 全部平铺 —— 全解锁 57 款 ≈ 9.6 屏（每款带定价滑块约 120px），
       "开门营业"被推到第 10 屏（已用吸底兜住）。但更根本的问题是：
       这一页叫"今日菜单"，玩家 90% 的时间只关心手上这 8 款卖得怎么样，
       剩下 49 款的定价/菜系/工坊信息属于"配置"，不是"今天的决策"。
     ★ 两段渲染但**共用同一个 rcHtml** —— 两份模板必然漂移
       （本项目已经因为"备货按降本后算、扣料按降本前扣"栽过一次）。
     ★ 未上架默认收起：要加菜时点一行就展开，比翻 9 屏精确得多。 */
  const rcHtml = (rid) => {
    const r = recipeById(rid);
    /* ★ V21：必须容错。改成遍历 s.menu 之后，来源从"配方表"变成了"存档里的菜单"——
       脏存档/旧版本里可能残留已不存在的配方 id，原来遍历 s.recipes 时不可能出现。
       一行判断换掉一个整页白屏的风险。 */
    if (!r) return '';
    /* ★ V10：异地已解锁的配方**保留在列表里**（玩家能看到自己的积累），
       但标记为不可上架并说明原因 —— 直接隐藏会让玩家以为配方丢了。 */
    const away = r && r.city && !recipeAvailableAt(s, rid, true);
    const on = s.menu.includes(rid);
    const ratio = s.ratios[rid] || 1;
    const price = priceOf(s, rid);
    const cost = costOf(s, rid);
    const hit = r.tags.includes(s.trend);
    /* V6 招牌配方：达到等级就在配方卡上挂一个徽章 ——
       玩家一眼能看出"这款是我的招牌"，招牌加成（售价/成本）已算进上面的数字。 */
    const sg = sigLevelOf(s, rid);
    const sgBadge = sg.lv > 0
      ? `<div class="rc-badge sig">${sg.tier.emoji} ${esc(sg.tier.name)}</div>` : '';
    /* V9 菜系：菜单卡上标出菜系；顺带提示这条线的加成开没开 */
    const cu = cuisineById(r.cuisine);
    const cuTag = cu
      ? `<span class="rc-tag cui">${cu.emoji}${esc(cu.name)}</span>` : '';
    /* V9：工坊是加成不是门票 —— 两种状态都给正向提示。
       已开线显示当前拿到的三层收益，未开线显示"开了能拿什么"。
       ★ 降本要放在最前面：它是工坊的**主力收益**（绝对量、卖得越多越赚），
         权重是相对量、收益封顶。只说"权重 +8%"会让玩家算不出划不划算。 */
    const wsLv = r.cuisine ? workshopLevel(s, r.cuisine) : 0;
    const wsW = r.cuisine ? workshopById(r.cuisine) : null;
    const wsTip = wsW
      ? (wsLv > 0
        ? `<div class="rc-tip">🏭 ${esc(wsW.name)} Lv.${wsLv} · 成本 −${Math.round((wsW.costCut[wsLv] || 0) * 100)}% · 权重 +${Math.round((wsW.saleBonus[wsLv] || 0) * 100)}%${r.tier >= 3 && wsLv >= 3 ? ' · 高端款再 +18%' : ''}</div>`
        : `<div class="rc-tip">🏭 未建线 · 建了可得成本 −${Math.round((wsW.costCut[1] || 0) * 100)}% / 研发 −${Math.round((wsW.researchCut || 0) * 100)}%</div>`)
      : '';
    return `<div class="rc ${on ? 'on' : ''}${away ? ' away' : ''}" ${away ? '' : `data-act="toggle" data-id="${rid}"`}>
      ${hit ? '<div class="rc-badge">🔥流行</div>' : ''}
      ${sgBadge}
      ${away ? `<div class="rc-badge away">🗺️ ${esc((cityById(r.city) || {}).name || '异地')}</div>` : ''}
      <div class="rc-h"><span class="rc-e">${r.emoji}</span><span>${esc(r.name)}</span></div>
      <div class="rc-m">售价 <b style="color:var(--amber)">¥${price}</b> · 成本 ¥${cost.toFixed(1)} · 毛利 ¥${(price - cost).toFixed(1)}</div>
      <div class="rc-tags">${cuTag}${r.tags.map(t => `<span class="rc-tag ${t === s.trend ? 'hit' : ''}">${TAGS[t].emoji}${TAGS[t].name}</span>`).join('')}</div>
      ${away ? `<div class="rc-tip">🗺️ 本店在${esc((cityById(currentCityId(s)) || {}).name || '')}，这款只能在那儿上架</div>` : wsTip}
      <div class="rc-price"><span style="font-size:var(--fs-xs);color:var(--txt3)">定价</span>
        <input type="range" min="50" max="200" value="${Math.round(ratio * 100)}" data-act="ratio" data-id="${rid}" ${away ? 'disabled' : ''}>
        <span class="pv">×${ratio.toFixed(2)}</span></div>
    </div>`;
  };

  const pending = s.recipes.filter(rid => !s.menu.includes(rid));
  const menuOpen = !!UI._menuOpen;
  h += `<div class="card" data-tut="menu"><div class="card-h">📋 今日菜单
      <span class="ch-sub">${s.menu.length}/${slots} 款上架</span></div>
    ${cityBarHtml(s)}
    ${s.menu.length === 0 ? '<div style="color:var(--red);font-size:var(--fs-md);margin:2px 0 10px">⚠️ 至少上架 1 款才能开门</div>' : ''}
    <div class="grid2">${s.menu.map(rcHtml).join('')}</div>`;
  if (pending.length) {
    h += `<div class="menu-more" data-act="menuopen">
      <span>➕ 加一款</span>
      <span class="mm-sub">${pending.length} 款未上架　${menuOpen ? '▴ 收起' : '▾ 展开'}</span></div>`;
    if (menuOpen) h += `<div class="grid2">${pending.map(rcHtml).join('')}</div>`;
  }
  h += `</div>`;

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
    <div id="mktForecast" style="font-size:var(--fs-sm);color:var(--txt3);margin-top:7px;line-height:1.6">
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
      <div style="font-size:var(--fs-md);color:${ms.hit ? 'var(--green)' : 'var(--txt2)'};margin-top:6px;line-height:1.6">
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
      <div style="font-size:var(--fs-md);color:var(--txt2);line-height:1.9">
        👥 预计客流 <b style="color:var(--cyan)">${trfN}</b> 人（约 ${Math.round(trfN * avgC)} 杯）<br>
        📦 库存 ${stockCups} 杯 → 够招待 <b style="color:${bad(stockN, trfN * .75)}">${stockN}</b> 人<br>
        🚀 产能 <b style="color:${bad(capN, trfN)}">${capN}</b> 单${capN < trfN ? `（手速全开约 ${capClick} 单）` : ''} · 出杯位 <b>${stationCount(s)}</b> 个
      </div></div>`;

  /* ★★ V21：开门按钮改为**吸底**。
     原来它排在这一屏的最后，而菜单卡按 `s.recipes` 逐款平铺（全解锁 57 款
     ≈ 9.6 屏），于是「开门营业」被推到第 10 屏 ——
     首屏看到的是目标（合同/关卡/任务），按钮在第 10 屏，中间隔着 57 行菜单。
     玩家每天被迫做一次"读完目标 → 滚十屏 → 忘了目标 → 开门"的记忆测试。
     ★ Canvas 端早就修过同一个问题（ui.js 的 pinH 注释原文：主操作留在滚动区最底下，
       玩家得先滑到底才能开门），H5 一直没回灌 —— 两版体验不对等的典型。
     ★ 用 sticky 而不是 fixed：fixed 会脱离 .panels 的滚动上下文，
       分屏/横屏时容易压住 tab 栏；sticky 天然跟随滚动容器停靠。 */
  /* ★★ V21：吸底区里补一行「明日客流 + 库存够不够」。
     ★ 为什么这行比体检卡重要：`s.eventTrafficMul` 由**昨天的随机事件**写入
       （"网红探店 → 次日客流 ×1.5"这类），但它在界面上**从来没有显示过**。
       实测后果：easy 档 52% 的破产都是同一条链 ——
       事件把客流 ×2 → 玩家按老习惯备货 → 缺料 → 口碑崩 → 营收塌。
       玩家不是算错，是**根本不知道明天会来多少人**。
     ★ 放在吸底区而不是体检卡里：体检卡在长菜单的第 3.5 屏，而这行要天天看。 */
  const evMul = Number(s.eventTrafficMul) || 1;
  const evTag = evMul > 1.02 || evMul < 0.98
    ? ` <span style="color:var(--amber)">· 事件客流 ×${evMul.toFixed(1)}</span>` : '';
  const shortN = Math.max(0, Math.round(trfN * 0.75) - stockN);
  const stockTag = shortN > 0
    ? `<b style="color:var(--red)">缺 ${shortN} 人份</b>`
    : `<b style="color:var(--green)">够卖</b>`;
  h += `<div class="open-dock">
      <div class="open-hint">👥 明日预计 <b style="color:var(--cyan)">${trfN}</b> 人${evTag} · 库存 ${stockTag}</div>
      <button class="btn btn-primary btn-big" data-act="open" data-tut="open" style="width:100%">🔔 开门营业</button>
    </div>`;

  /* 店长日志 */
  h += `<div class="card"><div class="card-h">📜 店长日志 <span class="ch-sub">共 ${s.log.length} 条</span></div>`;
  const lg = s.log.slice(-8).reverse();
  if (!lg.length) h += `<div style="font-size:var(--fs-md);color:var(--txt3)">还没有记录，先去进点货吧。</div>`;
  for (const l of lg) h += `<div class="jrow"><span>${esc(l)}</span></div>`;
  h += `</div>`;

  $('panel-manage').innerHTML = h;
};



/* ============== 研发页（研发树视图 · V10） ============== */
UI.renderLab = function () {
  const s = window.S; if (!s) return;

  /* ★ V17：初始化折叠状态 —— 非本店分组默认收起。
     切城市后要把「当前城市那组」展开（否则玩家切了城市还看到一堆折叠行，
     以为没生效）。cityBarHtml 的切换会走 setCity → 那里会重置。 */
  if (!UI.collapsed) UI.collapsed = {};
  if (!UI.collapsedInit) {
    for (const g of researchTree(s)) {
      const k = g.cityName.indexOf('成就') >= 0 ? 'ach'
        : (g.city ? ('c' + g.city) : 'univ');
      if (g.city && !g.isHere) UI.collapsed[k] = true;
    }
    UI.collapsedInit = true;
  }
  /* ★ 换过城市后，把「当前城市」那组强制展开 ——
     否则玩家切了城市，看到的还是一堆折叠行，会以为没生效。
     ★ 在 UI 层处理而不是改引擎：这个状态是**浏览状态**，
       引擎不该知道 UI 怎么折叠。 */
  const _curKey = 'c' + currentCityId(s);
  if (UI._lastFoldCity !== currentCityId(s)) {
    if (UI._lastFoldCity) UI.collapsed[_curKey] = false;
    UI._lastFoldCity = currentCityId(s);
  }

  /* V6 招牌配方：跨局继承的成长线。放在实验室页最上面——
     这里是"长期目标"该待的地方：玩家看到某款已经 142/150 杯，
     下一局就会想专门练它。 */
  const sigHtml = sigCardHtml(s);

  const cid = currentCityId(s);
  const tree = researchTree(s);
  const doneTree = RESEARCH_TREE.filter(n => s.recipes.includes(n.recipe)).length;

  let h = `<div class="card"><div class="card-h">🧪 配方实验室 · 研发树
    <span class="ch-sub">已解锁 ${doneTree}/${RESEARCH_TREE.length} 节点</span></div>
    <div style="font-size:var(--fs-md);color:var(--txt3);margin-bottom:10px;line-height:1.6">
      配方按<b>阶段</b>推进：先做前面的，才能解锁后面的。每款配方属于一个菜系，
      建好对应<b>制作工坊</b>后研发费打折、销量权重更高（可选加成，不建也能做）。<br>
      <b>本地特色菜系只在所属城市可研发与上架</b>—— 换个城市就是换一套产品线。<br>
      <b>点配方上的原料</b>可以跳到原料市场查看价格与库存。
    </div>
    ${UI.jumpFromHtml()}
    ${cityBarHtml(s)}
    ${labFoldNavHtml(s)}
  </div>`;

  /* ---- 研发树主体：按城市分组 ---- */
  for (const g of tree) {
    const isAch = g.cityName.indexOf('成就') >= 0;
    const head = isAch
      ? `<span class="cui-e">🏅</span><span class="cui-n">${esc(g.cityName)}</span>
         <span class="cui-d">只能通过成就获得，研发树里没有它们</span>`
      : !g.city
        ? `<span class="cui-e">🌐</span><span class="cui-n">通用配方</span>
           <span class="cui-d">全国都能做 · 5 条基础菜系</span>`
        : `<span class="cui-e">${g.isHere ? '📍' : '🗺️'}</span>
           <span class="cui-n">${esc(g.cityName)}${g.isHere ? ' · 本店' : ''}</span>
           <span class="cui-d">${g.isHere
             ? `${g.nodes.length} 道本地菜 · 专属原料 ${ingsOfCity(g.city).length} 种`
             : '需切换经营城市才能研发'}</span>`;

    /* ★ V17：分组头可点折叠。
       体检实测：研发页 16 个分组（其中 **14 个是非本店**）+ 64 张配方卡
       + 48 个阶段标题，HTML 体积 93669 字符 / 1839 个标签 ——
       是第二名（升级页 26916）的 3.5 倍，玩家要滚很久。
       ★ 而那 14 个非本店分组**当前城市根本研发不了**
         （提示就写着「需切换经营城市」）——
         把它们全展开等于让玩家滚过14 屏不能点的内容。
       ★ 所以：默认只展开「本店 + 通用 + 成就」三组，
         非本店折叠成一行（仍能看到「有 3 道本地菜，想做要换城市」）。
         ★ 折叠状态存 UI.collapsed（不存档）——
           这是临时浏览状态，刷新后回到默认更符合直觉。 */
    const groupKey = isAch ? 'ach' : (g.city ? ('c' + g.city) : 'univ');
    const collapsed = UI.collapsed && UI.collapsed[groupKey];
    /* ★ V18：分组头从 div 改成 **button**。
       原问题是 div.cui-head + data-act=foldtree ——
       div 不可聚焦，键盘用户 Tab 到这里就过去了，**完全无法折叠**。
       ★ 用 button 一次性拿到：可聚焦 / Enter+Space 天然触发 /
         读屏软件播报「按钮」/ 自带 role ——
         比手加 role="button" tabindex="0" 可靠得多（原生语义不会漏）。
       ★ aria-expanded 告诉读屏「这块现在是展开还是收起」。
       ★ CSS 里必须重置 button 默认样式（border/background/font），
         否则会显示成灰色凸起方块 —— 见 .cui-head.foldable 规则。
       ★ 这段说明放在模板**外**：写在 ${} 表达式里的注释，
         只要结尾多一个花括号就会让表达式提前闭合、语法直接崩（踩过一次）。
         同理注释里也不能出现反引号 —— 会把外层模板字符串提前结束。 */
    h += `<div class="cui-group tree${g.isHere || !g.city || isAch ? '' : ' away'}${collapsed ? ' fold' : ''}"
      data-fold="${groupKey}">
      <button type="button" class="cui-head foldable"
        data-act="foldtree" data-id="${groupKey}"
        aria-expanded="${collapsed ? 'false' : 'true'}"
        aria-controls="fold-${groupKey}">
        ${head}
        ${!g.isHere && !isAch ? `<span class="cui-ws off">不在本店</span>` : ''}
        <span class="fold-arrow${collapsed ? '' : ' open'}" aria-hidden="true">▾</span>
      </button>`;
    /* ★ 折叠时只显示摘要行，不铺卡片 */
    if (collapsed) {
      h += `<div class="fold-sum" id="fold-${groupKey}">${g.nodes.length} 道${
        !g.isHere && g.city ? ' · 切换到' + esc((cityById(g.city) || {}).name || '') + '后开放' : ''}</div>
      </div>`;
      continue;
    }

    /* 按阶段分组，阶段之间有明确先后感 */
    const byStage = new Map();
    for (const n of g.nodes) {
      if (!byStage.has(n.stage)) byStage.set(n.stage, []);
      byStage.get(n.stage).push(n);
    }
    for (const st of Array.from(byStage.keys()).sort((a, b) => a - b)) {
      const nodes = byStage.get(st);
      if (st === 99) {
        h += `<div class="tree-stage ach">📜 成就专属 · 不在研发树中</div>`;
      } else if (st > 0) {
        /* ★ V16：前置配方从纯文本改成可点 ——
           玩家看到「需先做『柠檬茶』」时的下一步一定是去看那道菜，
           让他自己在一屏卡片里找是多余的动作。
           ★ 收集时去重（多道配方可能共用同一个前置）。 */
        const names = [];
        const links = [];
        for (const n of nodes) {
          for (const pid of (n.prereq || [])) {
            const pn = treeNodeById(pid);
            const pr = pn && recipeById(pn.recipe);
            if (!pr) continue;
            if (names.indexOf(pr.name) < 0) {
              names.push(pr.name);
              links.push(`<button class="ing-link" data-act="torecipe" data-id="${esc(pr.id)}"
                title="跳到该配方">${pr.emoji}${esc(pr.name)}</button>`);
            }
          }
        }
        h += `<div class="tree-stage">第 ${st} 阶段${names.length
          ? ` · 需先做 ${links.join('、')}` : ''}</div>`;
      }
      /* ★ V18：内容区给 id，让 aria-controls 能指向它 */
      h += `<div class="cui-grid" id="fold-${groupKey}">`;
      for (const n of nodes) h += recipeNodeCardHtml(s, n);
      h += `</div>`;
    }
    h += `</div>`;       /* 闭合 cui-group */
  }
  /* ★ V18：空状态。
     原来树为空时这一页只剩顶部那张卡，玩家看到的是**一片空白**，
     不知道是加载中、出错了、还是本来就该是空的。
     ★ 空状态要说清三件事：发生了什么 / 为什么 / 下一步做什么。 */
  if (!tree.length) {
    h += `<div class="empty">
      <div class="empty-e">🔬</div>
      <div class="empty-t">没有可研发的配方</div>
      <div class="empty-d">当前经营城市下暂时没有配方节点。<br>
        换个城市看看，或到<b>经营页</b>看看菜单里有什么。</div>
    </div>`;
  }

  $('panel-lab').innerHTML = sigHtml + h;
};






/* ---------------- 经营维度面板 ----------------
 * 三个字段（场地类型 / 城市 / 地图坐标）都走「数据驱动 + 引擎校验」：
 * 这里只负责渲染与收集交互，真正的合法性判断在 engine 的 setVenueType /
 * setVenueCity / setGeo 里（小游戏端复用同一套校验，不会出现两版口径）。
 *
 * 地图选点交互的关键取舍：这里**不内嵌第三方地图 SDK**。
 *   ① 静态托管的离线包无法拉取高德瓦片 → 地图区域在离线/内网环境下会是空白，
 *      反而比没有地图更糟（用户以为坏了）。
 *   ② 内嵌 SDK 会把一个外部脚本变成页面的硬依赖，且引入密钥管理与合规责任。
 * 所以这里做的是「**坐标输入 + 校验 + 一键跳转高德**」：
 *   用户可以在高德地图上选好点，复制坐标回来填；也可以直接手输经纬度。
 *   校验（GCJ-02、境内范围、区前缀匹配）在引擎里，与其他端一致。
 * 生产环境若要内嵌地图，把「跳转/回填」换成高德 JS API 的 Map + Marker 即可，
 *   存储结构与校验逻辑都不用动 —— 这也是把 coordSys 显式存下来的原因。
 */
function venuePanelHtml(s) {
  const v = venueView(s);

  /* 场地类型：横向按钮组（10 种，网格排布） */
  const venueBtns = VENUE_TYPES.map(t =>
    `<button class="vtype ${t.id === v.type ? 'on' : ''}" data-act="vtype" data-id="${t.id}"
      title="${esc(t.desc)}"><span class="vt-e">${t.emoji}</span><span class="vt-n">${esc(t.name)}</span></button>`
  ).join('');

  /* 省市：两个下拉。选省时市列表跟着换（由 act="vprov" 触发重渲染） */
  const provOpts = PROVINCES.map(p =>
    `<option value="${p.id}" ${p.id === v.provId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const cityList = citiesOfProvince(v.provId);
  const cityOpts = cityList.map(c =>
    `<option value="${c.id}" ${c.id === v.cityId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

  /* 区级：可选粒度。没收录的城市降级为「仅到市级」，不显示空下拉 */
  const districts = districtsOfCity(v.cityId);
  const districtHtml = districts.length
    ? `<select class="vsel" data-act="vcity" data-id="dist">
        <option value="">— 不指定 —</option>
        ${districts.map(d => `<option value="${d.id}" ${d.id === v.districtId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
      </select>`
    : `<span class="vnote">该城市暂未收录区级（可选仅到市级）</span>`;

  /* 地图坐标：手输 + 一键跳转高德查询 */
  const geo = v.geo;
  const geoHtml = `
    <div class="vgeo">
      <input class="vin" type="text" inputmode="decimal" placeholder="经度 lng" value="${geo ? geo.lng : ''}" data-vfield="lng" style="flex:1">
      <input class="vin" type="text" inputmode="decimal" placeholder="纬度 lat" value="${geo ? geo.lat : ''}" data-vfield="lat" style="flex:1">
      <button class="btn btn-sm btn-primary" data-act="vgeo">定位</button>
      ${geo ? `<button class="btn btn-sm btn-ghost" data-act="vgeoclear">清除</button>` : ''}
    </div>
    <div class="vnote">坐标系固定 <b>${GEO.COORD_SYS}</b>（高德）· 境内范围 ${GEO.MIN_LAT}~${GEO.MAX_LAT} / ${GEO.MIN_LNG}~${GEO.MAX_LNG}
      ${geo ? ` · 当前 <b style="color:var(--cyan)">${geo.lng}, ${geo.lat}</b>` : ' · 尚未选点'}
    </div>`;

  return `<div class="card venue">
    <div class="card-h">🏙️ 经营信息
      <span class="ch-sub">${esc(v.typeName || '未设置')} · ${esc([v.provName, v.cityName, v.districtName].filter(Boolean).join(' / '))}</span></div>

    <div class="vlabel">经营场地类型<span class="vhint">可扩展（数据驱动，新增类型只改配置）</span></div>
    <div class="vtypes">${venueBtns}</div>

    <div class="vlabel">经营城市<span class="vhint">限中国大陆</span></div>
    <div class="vrow">
      <select class="vsel" data-act="vprov" data-id="prov">${provOpts}</select>
      <select class="vsel" data-act="vcity" data-id="city">${cityOpts}</select>
    </div>
    ${citiesOfProvince(v.provId).length <= 1
      ? `<div style="font-size:10.5px;color:var(--txt3);margin-top:3px">
           该省仅 1 个城市（直辖市/特别行政区）· 换省可选其他城市</div>`
      : ''}
    <div class="vrow">${districtHtml}</div>

    <div class="vlabel">经营地图位置<span class="vhint">用于标记经营地点</span></div>
    ${geoHtml}
  </div>`;
}

/* ---------------- 升级面板 ---------------- */
UI.renderUp = function () {
  const s = window.S; if (!s) return;
  /* 经营维度放在**页面最前面**（设备升级之前），不放末尾：
     它是店铺的静态属性、且只有三个字段，是这一页最该被看到的东西；
     而末尾（分店 / 品牌声望之后）在小游戏端会被推出首屏 —— 面板内容一高，
     越靠后的卡片玩家越看不到，等于白做。语义与可见性在这里是一致的。 */
  let h = venuePanelHtml(s);
  /* ★ V17：升级总览条 —— 让玩家第一眼就知道「还要花多少、能升几项」，
     不用逐行加。三个数字：可升级项数 / 已满级项数 / 当前现金。 */
  {
    let canUp = 0, maxed = 0, cheapest = null;
    for (const u of UPGRADES) {
      const lv = s.up[u.id];
      const c = upgradeCost(s, u.id);
      if (c == null) { maxed++; continue; }
      if (s.cash >= c) canUp++;
      if (cheapest == null || c < cheapest) cheapest = c;
    }
    h += `<div class="upsum">
      <div class="upsum-i${canUp ? ' good' : ''}">
        <b>${canUp}</b><span>可升级</span></div>
      <div class="upsum-i">
        <b>${maxed}</b><span>已满级</span></div>
      <div class="upsum-i">
        <b>${money(s.cash)}</b><span>现金</span></div>
      <div class="upsum-i${canUp ? '' : ' dim'}">
        <b>${cheapest == null ? '—' : money(cheapest)}</b><span>最便宜一项</span></div>
    </div>`;
  }
  h += `<div class="card"><div class="card-h">⬆️ 设备与门店</div>`;
  /* ★ V17：设备升级行改成「三层信息」结构 ——
     原来一行里挤着：名称+等级 / 静态描述 / 当前效果 / 消耗，
     四样东西没有视觉层次，玩家要逐字读才知道
     「现在几级」「升到下一级会怎样」「要花多少」「买不买得起」。

     现在的三��（对应玩家的三个问题）：
       ① 现状：现在几级 + 当前效果（已拿到什么）
       ② 变化：下一级**具体**多给什么（不是抽象的 +5%，
          而是从 u.detail(lv) 里取下一级的描述做对比）
       ③ 决策：消耗 + 买不买得起（买不起时说清差多少）
     ★ 第③层最关键：原来钱不够时按钮只是灰掉，
       玩家不知道还差多少 —— 直接问「差多少」比让他心算更快。 */
  for (const u of UPGRADES) {
    const lv = s.up[u.id];
    const cost = upgradeCost(s, u.id);
    let pips = '';
    for (let i = 0; i < u.max; i++) pips += `<span class="up-pip ${i < lv ? 'on' : ''}"></span>`;

    /* ① 现状 */
    let row = `<div class="up-row up-v17">
      <div class="up-e">${u.emoji}</div>
      <div class="up-body">
        <div class="up-n">${u.name}
          <span class="up-lvnow">Lv.${lv}<i>/${u.max}</i></span></div>
        <div class="up-have">当前：<span>${esc(u.detail(lv))}</span></div>`;

    /* ② 变化：下一级的具体收益（满级则不显示） */
    if (lv < u.max) {
      const next = u.detail(lv + 1);
      /* ★ 只写「下一级多什么」，不重复「当前是什么」——
         两行都写反而更难扫。 */
      row += `<div class="up-next">升级后：<span>${esc(next)}</span></div>`;
    }
    row += `</div>`;

    /* ③ 决策 */
    if (cost == null) {
      row += `<span class="up-max">满级</span>`;
    } else {
      const afford = s.cash >= cost;
      const gap = cost - s.cash;
      row += `<div class="up-buy">
        <button class="btn btn-sm ${afford ? 'btn-primary' : 'btn-ghost'}"
          data-act="upgrade" data-id="${u.id}" ${afford ? '' : 'disabled'}
          title="${afford ? '升级 ' + u.name : `还差 ${money(gap)}`}">
          ${money(cost)}</button>
        ${afford ? '' : `<div class="up-gap">差 ${money(gap)}</div>`}
      </div>`;
    }
    row += `</div>`;
    h += row;
  }
  h += `</div>`;

  /* V9 制作工坊：菜系的生产线。三层收益全是**加成**：
     ① 该系配方每杯成本下降（主力，卖得越多越赚）
     ② 研发费打折③ 该系产品更抢手（旗舰级再加高端款加成）
     不做任何硬约束 —— 不建照样能研发上架。
     这是本套系统的主入口，所以放在设备升级之后、分店之前 ——
     它比设备更"重"（一条产品线 ¥260 起），玩家的中期决策多在它身上。 */
  const cvs = cuisineViews(s);
  h += `<div class="card"><div class="card-h">🏭 制作工坊
    <span class="ch-sub">${cvs.filter(c => c.level > 0).length}/${cvs.length} 条产线</span></div>
    <div style="font-size:var(--fs-md);color:var(--txt3);margin-bottom:10px;line-height:1.6">
      工坊给该菜系<b>三层加成</b>：<b>每杯成本下降</b>（主力，卖得越多越省）、研发费打折、产品更抢手。<br>
      <b>不建也能研发上架</b>——工坊是可选的经营深度，开了更赚，不是门票。
      另外菜单上同系配方越多，还有额外的<b>主打加成</b>。
    </div>`;
  for (const cv of cvs) {
    const ws = workshopById(cv.id);
    let pips = '';
    for (let i = 0; i < cv.maxLevel; i++) pips += `<span class="up-pip ${i < cv.level ? 'on' : ''}"></span>`;
    /* ★ 收益说明以**降本**打头：它是主力层（绝对量、卖得越多越赚）。
       只强调"销量权重"会让玩家算不出划不划算 —— 权重是相对量、
       不抬客流总量，收益有天花板。 */
    const nextTxt = cv.cost == null
      ? `已满级 · 成本 −${Math.round((ws.costCut[cv.maxLevel] || 0) * 100)}% · 权重 +${Math.round(cv.saleBonus * 100)}%`
      : `升到 Lv.${cv.level + 1}：成本 −${Math.round((ws.costCut[cv.level + 1] || 0) * 100)}%（现 −${Math.round((ws.costCut[cv.level] || 0) * 100)}%）· 权重 +${Math.round(cv.nextBonus * 100)}%`;
    h += `<div class="up-row cui-up">
      <div class="up-e">${cv.emoji}</div>
      <div class="up-body">
        <div class="up-n">${esc(ws.name)} <span style="font-size:var(--fs-sm);color:var(--txt3)">Lv.${cv.level}/${cv.maxLevel}</span></div>
        <div class="up-d">${esc(cv.desc)} · ${cv.unlocked}/${cv.total} 款已研发</div>
        <div class="up-d" style="color:var(--cyan)">${nextTxt}</div>
        <div class="up-d" style="color:var(--txt3)">研发费 −${Math.round((ws.researchCut || 0) * 100)}%${cv.level >= 3 ? ' · 高端款权重 +18%' : ' · 旗舰级解锁高端款加成'}</div>
        <div class="up-d" style="color:${cv.focusCount >= 2 ? 'var(--amber)' : 'var(--txt3)'}">
          ${cv.focusCount >= 2
            ? `🔥 主打${esc(cv.focusLabel)}：菜单上 ${cv.focusCount} 款，销量权重 +${Math.round(cv.focusBonus * 100)}%`
            : `主打加成：菜单上同系满 2 款可触发（现 ${cv.focusCount} 款）`}
        </div>
        <div class="up-lv">${pips}</div>
      </div>
      ${cv.cost == null
        ? `<span style="font-size:var(--fs-md);color:var(--green);font-weight:800">满级</span>`
        : `<button class="btn btn-sm ${s.cash >= cv.cost ? 'btn-primary' : 'btn-ghost'}" data-act="workshop" data-id="${cv.id}" ${s.cash >= cv.cost ? '' : 'disabled'}>${money(cv.cost)}</button>`}
    </div>`;
  }
  h += `</div>`;

  /* 分店 */
  const sc = shopCost(s);
  h += `<div class="card"><div class="card-h">🏪 分店扩张
    <span class="ch-sub">当前 ${s.shops} 家</span></div>
    <div style="font-size:var(--fs-md);color:var(--txt3);line-height:1.6;margin-bottom:9px">
      每开一家分店：出杯位 +1、客流 +60%，但每日固定成本 +${money(CFG.RENT_PER_SHOP + CFG.SHOP_UPKEEP)}。
    </div>
    ${sc == null
      ? `<div style="font-size:var(--fs-lg);font-weight:800;color:var(--green)">🏆 已达分店上限（${s.shops} 家）</div>`
      : `<button class="btn ${s.cash >= sc ? 'btn-green' : 'btn-ghost'}" style="width:100%" data-act="shop" ${s.cash >= sc ? '' : 'disabled'}>开设第 ${s.shops + 1} 家分店 · ${money(sc)}</button>`}
  </div>`;

  /* 品牌 / 转生 */
  const meta = window.META;
  const gain = prestigeGain(s);
  h += `<div class="card"><div class="card-h">🌟 品牌声望
    <span class="ch-sub">已继承 ${meta.bp} 点</span></div>
    <div style="font-size:var(--fs-md);color:var(--txt3);line-height:1.6;margin-bottom:9px">
      声望点永久生效：<b>折算开局创业基金</b>（${money(prestigeStartCash(meta.bp))}，封顶 ${money(CFG.BP_START_CAP)}，
      越往后每点换得越少）。本局已到账 <b style="color:var(--green)">+${money(s.startBonus || 0)}</b>，
      由你决定投去雇人、提速还是开店。<br>
      声望<b>不再直接加客流</b>：单加客流会让客人多到做不过来，流失扣口碑，反而更亏。<br>
      成就首次达成给 ★（${achStarText()}），重复达成只给现金。
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
    h += `<div style="font-size:var(--fs-md);color:var(--txt3);line-height:1.7">
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
      ${tr ? `<div style="font-size:var(--fs-sm);color:var(--txt3);margin-top:5px">${esc(tr.desc)}</div>` : ''}
      <button class="btn btn-sm btn-ghost" style="margin-top:7px" data-act="fire" data-id="${esc(st.id)}">解雇（遣散费 ${money(num(st.wage) * 2)}）</button>
    </div>`;
  }
  h += `</div>`;

/* ============================================================
   *  V17 招聘区：店员与店长**完全拆开**
   * ============================================================
   *
   * ★ 原来为什么混在一起是个问题：
   *   店员候选人是「效率 / 日薪 / 聘用费」，一按就进编制；
   *   店长候选人是「等级 / 专精 / 招募费」，一按要选一家店任命。
   *   ★ 两种岗位的**决策维度根本不同**（员工看性价比，店长看专精匹配），
   *     字段也不重叠，却塞在同一个「今日候选人」列表里 ——
   *     玩家要在一堆信息里分辨「这条是招人的还是招店长的」。
   *
   * ★ 现在拆成两个独立区块，各用各的表单与字段：
   *     店员区：效率 / 日薪 / 特质 → 雇佣（直接进编制）
   *     店长区：等级 / 专精 / 招募费 → 任命（要去选店）
   *
   * ★ 顺带补上「刷新」按钮（原来完全没有）：
   *   候选人是每日自动刷的，玩家想换一批只能等隔天 ——
   *   而「手上有几个候选」是每天该做的决策。
   *   ★ 必须带冷却（引擎侧 candCd），否则连点刷到 SSR 为止。
   */

  /* ---------- ① 店员招聘 ---------- */
  h += `<div class="card hirecard">
    <div class="card-h">🧑‍🍳 店员招聘
      <span class="ch-sub">${s.candidates.length} 位在招</span></div>`;
  if (!s.candidates.length) {
    h += `<div class="hire-empty">今天还没有候选人，<b>点下方刷新</b>看看。</div>`;
  }
  s.candidates.forEach((c, i) => {
    const tr = traitById(c.trait);
    const afford = num(s.cash) >= num(c.fee);
    h += `<div class="cand hire-cand">
      <span class="cand-e">${esc(c.emoji)}</span>
      <div class="cand-b">
        <div class="cand-n">${esc(c.name)}
          ${tr ? `<span class="cand-tr">${esc(tr.emoji)}${esc(tr.name)}</span>` : ''}</div>
        <div class="cand-f">
          <span class="cf-k">效率</span><span class="cf-v">×${num(c.skill, 1).toFixed(2)}</span>
          <span class="cf-k">日薪</span><span class="cf-v">${money(num(c.wage))}</span>
          <span class="cf-k">聘用费</span><span class="cf-v">${money(num(c.fee))}</span>
        </div>
        ${tr ? `<div class="cand-desc">${esc(tr.desc)}</div>` : ''}
      </div>
      <button class="btn btn-sm ${afford ? 'btn-green' : 'btn-ghost'}"
        data-act="hire" data-i="${i}" ${afford ? '' : 'disabled'}
        title="${afford ? '雇佣入职' : `还差 ${money(num(c.fee) - num(s.cash))}`}">雇佣</button>
    </div>`;
  });
  /* 刷新按钮：冷却中禁用并显示剩余秒数 */
  const cd = num(s.candCd, 0);
  const cdTxt = cd > 0 ? `${Math.ceil(cd)}s` : '';
  h += `<div class="hire-actions">
    <button class="btn btn-cyan" style="flex:1"
      data-act="candrefresh" ${cd > 0 ? 'disabled' : ''}
      title="${cd > 0 ? '冷却中' : '换一批候选人'}">
      ${cd > 0 ? `🔄 刷新中 ${cdTxt}` : '🔄 刷新候选人'}</button>
    <button class="btn btn-ghost" data-act="teambuild">🎉 团建（体力回满）</button>
  </div>`;
  h += `</div>`;

  /* ---------- ② 店长招聘（独立区块，字段完全不同） ---------- */
  {
    /* 找出还缺店长的门店 —— 店长必须挂在具体门店上 */
    const shops = pos(s.shops, 1);
    const freeShops = [];
    for (let b = 1; b <= shops; b++) {
      if (!managerOfBranch(s, b)) freeShops.push(b);
    }
    if (freeShops.length) {
      h += `<div class="card hirecard">
        <div class="card-h">🎩 店长招募
          <span class="ch-sub">${freeShops.length} 家店缺店长</span></div>
        <div class="hire-note">店长是<b>加成不是门票</b>—— 不配也能开店，
          但配了能拿客流与营收加成。招募要花钱，且每次刷新费用递增。</div>`;
      /* 列出每家缺店长的门店，一行一个入口 */
      for (const b of freeShops) {
        const st = storeByBranch(s, b);
        const fee = managerCost(s);
        const afford = num(s.cash) >= num(fee);
        h += `<div class="cand hire-cand">
          <span class="cand-e">🏪</span>
          <div class="cand-b">
            <div class="cand-n">${esc((st && st.name) || `第 ${b} 店`)}
              <span class="cand-tr">第 ${b} 店</span></div>
            <div class="cand-f">
              <span class="cf-k">招募费</span><span class="cf-v">${money(fee)}</span>
              <span class="cf-k">岗位</span><span class="cf-v">店���</span>
            </div>
          </div>
          <button class="btn btn-sm ${afford ? 'btn-primary' : 'btn-ghost'}"
            data-act="smgrh" data-br="${b}" ${afford ? '' : 'disabled'}
            title="${afford ? '挑选店长' : `还差 ${money(fee - num(s.cash))}`}">挑选</button>
        </div>`;
      }
      h += `</div>`;
    }
  }

  $('panel-staff').innerHTML = h;
  $('panel-staff').innerHTML = h;
};

/* ---------------- 商圈 / 竞争对手面板 ---------------- */
UI.renderRival = function () {
  const s = window.S; if (!s) return;
  const r = s.rival;
  let h = '';
  /* ★ V12：店铺地图放在「🏙️ 商圈」页的最前面 ——
     店铺与商圈是同一语义（在哪、开什么店），
     放在这一页比塞进管理页或升级页都自然。
     放最前面是因为它是这一页的**主功能**，竞争对手只是背景信息。*/
  /* ★ V13：城市地图放在最前面 ——
     「🏙️ 商圈」这一页的主功能就是"在哪经营"，地图是它的第一入口。
     店铺列表在其后，竞争对手在最后（背景信息）。*/
  h += cityMapPanelHtml(s);
  h += storesPanelHtml(s);
  if (!r) { $('panel-rival').innerHTML = h + '<div class="card">暂无竞争对手</div>'; return; }

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
        <div class="up-n">${a.name} ${cooling ? `<span style="font-size:var(--fs-xs);color:var(--txt3)">冷却至 Day ${cd}</span>` : ''}${maxed ? '<span style="font-size:var(--fs-xs);color:var(--green)">已满级</span>' : ''}</div>
        <div class="up-d">${a.desc}</div>
      </div>
      <button class="btn btn-sm ${disabled ? 'btn-ghost' : 'btn-primary'}" data-act="rivalact" data-id="${a.id}" ${disabled ? 'disabled' : ''}>${money(a.cost)}</button>
    </div>`;
  }
  h += `</div>`;

  /* 客群构成 */
  h += `<div class="card"><div class="card-h">👥 客群构成 <span class="ch-sub">今日权重</span></div>
    <div style="font-size:var(--fs-md);color:var(--txt3);margin-bottom:9px;line-height:1.6">
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
    return `<div style="text-align:center;color:var(--txt3);font-size:var(--fs-md);padding:24px 0">
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
/* ============================================================
 *  V17 成就页：主线 + 支线两层结构
 * ============================================================
 *
 * ★ 原来为什么难用：
 *   44 个成就**平铺成一张列表**，没有任何分类字段（实测
 *   ACHIEVEMENTS 的字段只有 id/name/emoji/desc/reward/check）。
 *   ★ 玩家打开这一页看到的是 44 行平铺 —— 既看不出
 *     「我整体走到哪了」，也找不到「我现在该冲哪个」。
 *
 * ★ 分类依据不是拍脑袋定的，是**从 check 函数里探测出来的**：
 *   实测各系统被多少成就引用：
 *     st(门店经营) 13 · stats(统计) 9 · flags 9
 *     recipes(配方) 5 · rep(声望) 4 · shops/staff/up/rival 各 2
 *   ★ 所以主线 = **经营推进类**（门店/配方/声望/升级/分店）
 *     —— 它们天然有前后关系，是这局的「主线任务」；
 *     支线 = **单点技巧类**（统计里程碑/竞速/一次性挑战）
 *     —— 达成与否不影响局内节奏，独立挂在旁边。
 *
 * ★ 分类函数是**数据驱动**的（读 check 的源码），不是硬编码 id 列表：
 *   新加成就时只要它引用了主线系统，就自动归主线 ——
 *   硬编码 id 列表会在下一次加成就时立刻过期。
 */


/** 主线/支线的展示元数据 */
const ACH_TIERS = {
  main: {
    key: 'main', label: '主线 · 经营推进', emoji: '🎯',
    /* 主线的作用是回答「这局走到哪了」，所以要给整体进度 */
    desc: '跟着这局的节奏推进：开店、做配方、提声望、扩规模。',
  },
  side: {
    key: 'side', label: '支线 · 单点挑战', emoji: '✨',
    desc: '独立的小目标，达成与否都不影响本局节奏 —— 顺手就做。',
  },
};


UI.renderAch = function () {
  const s = window.S; if (!s) return;
  const got = ACHIEVEMENTS.filter(a => s.ach[a.id]).length;

  const main = ACHIEVEMENTS.filter(isMainAch);
  const side = ACHIEVEMENTS.filter(a => !isMainAch(a));

  /* ★ 进度条放最上面：一屏之内要回答「我完成了多少」 */
  const pct = ACHIEVEMENTS.length ? Math.round(got / ACHIEVEMENTS.length * 100) : 0;
  let h = `<div class="card ach-top">
    <div class="card-h">🏅 成就
      <span class="ch-sub">${got}/${ACHIEVEMENTS.length} · ${pct}%</span></div>
    <div class="ach-bar"><i style="width:${pct}%"></i></div>
    <div class="ach-note">本局达成给现金；<b>跨局首次</b>达成额外给品牌声望 ★
      （${achStarText()}，永久保留）。</div>
  </div>`;

  h += achTierHtml(s, 'main', main);
  h += achTierHtml(s, 'side', side);

  $('panel-ach').innerHTML = h;
};


/* ---------------- 营业舞台 ---------------- */
/* ============================================================
 *  营业中的即时反馈（V20）
 * ============================================================
 *
 * ★ 要解决的问题：
 *   玩家在营业中连续点击出杯时（这占了整局**大部分时间**），
 *   反馈只有两样 —— 杯子消失 + 一声固定的「叮」。
 *   ★ 结果是：连续点 20 下和点 1 下，听起来一模一样。
 *   玩家的手在忙，眼和耳却是空的 —— 反馈与投入不成比例，
 *   「越忙越没感觉」是经营游戏最常见的手感流失。
 *
 * ★ 三个改动：
 *   ① 飘字：出杯时在该工位上方浮出「+¥12」之类的小字
 *   ② 音阶递进：连续出杯时音高逐级上行（连续音阶）
 *   ③ 断连归零：停手 1.2 秒后音阶回落，让节奏有「拍子」
 *
 * ★ 为什么音阶递进比换音效更有效：
 *   换音效要准备多个音频资源，而音阶只是改一个数字 ——
 *   零依赖的项目里这是最划算的做法。
 *   ★ 且音阶天然带「进展感」，玩家会不自觉地想继续点下去。
 */

/** 出杯飘字
 *  ★ 参数用**对象**而不是位置参数 ——
 *    （host, x, y, text, kind）五个位置参数里有两个数字（x/y），
 *    传错顺序不会报错、只会显示成「top: 12px」这种诡异结果，
 *    我自己就踩了一次（把 y 当成 text 传，飘出的是数字）。
 *    对象形式多写几个键，却让调用点自解释。 */
UI.serveFloat = function (host, opt) {
  const o = opt || {};
  if (!host || !host.appendChild || !document.createElement) return;
  const el = document.createElement('div');
  el.className = 'serve-float' + (o.kind ? ' ' + o.kind : '');
  el.textContent = o.text == null ? '' : String(o.text);
  el.style.left = (o.x != null ? o.x : 0) + 'px';
  el.style.top = (o.y != null ? o.y : 0) + 'px';
  host.appendChild(el);
  /* ★ 动画结束后移除：留在 DOM 里会在长时间营业时累积成几百个节点，
     手机上这是内存与掉帧的常见来源。 */
  setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 900);
};

/** 音阶递进器：连续出杯时音高逐级上行 */
UI.serveChain = { n: 0, timer: 0, lastAt: 0 };

/** 触发一次出杯反馈（音 + 飘字）
 *  @param {object} host 飘字宿主元素
 *  @param {object} opt  { x, y, text, kind }
 */
UI.serveFeedback = function (host, opt) {
  const o = opt || {};
  const now = Date.now();
  const ch = UI.serveChain;
  /* ★ 间隔超过 1.2 秒视为「重新开始」——
     不然玩家喝口茶回来，系统还在用上次的高音阶。 */
  ch.n = (now - ch.lastAt < 1200) ? Math.min(ch.n + 1, 8) : 0;
  ch.lastAt = now;
  SFX.serve(ch.n);
  if (o.text) UI.serveFloat(host, o.x, o.y, o.text, o.kind);
};

UI.stageInit = function () {
  const s = window.S;
  /* 与 stageSync 保持同一口径：sim 为空（还没开门 / 已读档回 prep）时
     直接返回，别去读 s.sim.stations 炸掉。生产路径上 case 'open' 一定先
     openShop 成功才会走到这里，所以这只是防御，但缺了它很难查。 */
  if (!s || !s.sim) return;
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
        /* ★ V14.2：工位自身的「被击中」反馈。
           原来飘字浮在工位**上方**、按钮**完全不动**——
           玩家盯着工位等出杯时，视觉上没有任何"我这一下点到了"的确认，
           只能靠进度条慢慢爬。快节奏连点时尤其明显（点十几次屏幕毫无变化）。
           ★ 用「重放 CSS 动画」而不是切换 class：
             连续点击同一个工位时，改 class 不会重新触发动画
             （类没有变化），必须用reflow 强制重排再回加。
           ★ 动画放在 .so（当前订单那一行）而不是整个工位上：
             整卡缩放会让玩家以为布局变了，只动订单行更"物理"。 */
        el.classList.remove('hit');
        void el.offsetWidth;          /* 强制 reflow，让动画能重新播放 */
        el.classList.add('hit');
        UI.renderHUD();
      }
    });
    wrap.appendChild(el);
    UI.stageEls.push(el);
  });
  $('queue').innerHTML = '';
};

UI.stageSync = function () {
  const s = window.S; const sim = s && s.sim;
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
    if (servedNow > UI.lastServed) {
      /* ★ V20：走统一反馈（音阶 + 飘字）——
         原来只有一声固定的「叮」，连点 20 下与点 1 下完全一样。 */
      const n = servedNow - UI.lastServed;
      const stage = $('stage');
      /* 一次涨多杯（比如老板大招清场）时才飘字，且放在舞台中上部 ——
         ★ 每次都飘会在连点时糊成一片，反而看不清。 */
      for (let k = 0; k < Math.min(n, 3); k++) UI.serveFeedback(stage, null);
      if (n > 3 && stage) {
        UI.serveFloat(stage, {
          x: Math.round(stage.clientWidth * 0.5),
          y: Math.round(stage.clientHeight * 0.32),
          text: '+' + n + ' 杯',
          kind: 'burst',
        });
      }
      UI.lastServed = servedNow;
    }
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
      /* V7 事件型顾客：加一个"特殊"类和角标，让玩家一眼认出该优先伺候谁。
         只靠 emoji 区分不够 —— 🧑‍🍳 和普通顾客的脸在同一队列里很容易看漏。 */
      el.className = 'cust' + (c.special ? ' sp' : '');
      const cr = recipeById(c.rid) || { emoji: '🥤', name: '未知' };
      el.innerHTML = `<div class="cf">${esc(c.face)}</div><div class="cw">${esc(cr.emoji)}</div>
        ${c.special ? '<div class="csp">★</div>' : ''}
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

  /* 营业中两个即时决策（V2）的状态：促销倒计时 + 两颗按钮的可用性 */
  const ops = openOps(window.S);
  const bSale = $('btnSale'), bPull = $('btnPull'), saleCd = $('saleCd');
  if (bSale && bPull && ops) {
    if (ops.sale.active) {
      bSale.disabled = true;
      bSale.classList.add('on');
      if (saleCd) saleCd.textContent = `(${ops.sale.left}s)`;
    } else if (ops.sale.used) {
      bSale.disabled = true;
      bSale.classList.remove('on');
      if (saleCd) saleCd.textContent = '（已用）';
    } else {
      bSale.disabled = false;
      bSale.classList.remove('on');
      if (saleCd) saleCd.textContent = '';
    }
    bPull.disabled = !!ops.pull.used;
    bPull.textContent = ops.pull.used ? '📥 已下架一款' : '📥 临时下架';
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
  /* 与同文件其它渲染函数同一口径：window.S 为空（标题页 / 已收官）时直接返回。
     生产路径上调用方都保证了 S 非空，这只是防御 —— 但缺了它，一处误用就会抛
     "Cannot read properties of null"，而报错栈指向 UI 而不是真正的调用方。 */
  const s = window.S; if (!s) return;
  const r = s.report;
  /* 第一天打烊 = 核心循环已走完，引导到此结束（避免挡住结算按钮） */
  if (typeof TUT !== 'undefined' && TUT.active) TUT.markDone(false);
  const nw = netWorth(s);
  let note = '';
  /* 营销是当日一次性投入，打烊后归零。不说明的话玩家会以为那笔钱白花了。 */
  if (r.marketing > 0) note += `📢 营销投入 ${money(r.marketing)} 当天有效，明日需重新设置。<br>`;
  if (s.endless && r.pressure > 1) note += `⚡ 无尽第 ${s.milestone} 阶：工资与租金 ×${r.pressure.toFixed(2)}。<br>`;
  /* ★ V21：流失改成"按主因拆分"。
     原来只写「流失 12 位」+ 偶尔补一句缺料/嫌贵 ——
     玩家知道丢了 12 个人，但**不知道该改什么**：
     加人手？降价？还是扩座位？三者修法完全不同。
     现在按数量降序列出主因，第一项就是他明天最该动的地方。 */
  if (r.lost > 0) {
    const lb = lostBreakdown(r);
    const detail = lb.length
      ? '（' + lb.map(x => `${x.k} ${x.v}`).join(' · ') + ' 位）'
      : '';
    note += `😥 今天流失了 <b>${r.lost}</b> 位顾客${detail}。<br>`;
    if (lb.length) note += `🔍 主因是「${lb[0].k}」—— ${lb[0].tip}。<br>`;
  }
  if (r.stockout > 0) note += `📦 缺料会直接赶走客人，明天记得提前备货。<br>`;
  if (r.priceLost > r.lost * 0.4 && r.priceLost > 3) note += `💸 有不少人被价格劝退了，试试把倍率调回 1.0 附近，或上架更便宜的款。<br>`;
  if (r.sat >= 0.95) note += `🎯 满意率 ${(r.sat * 100).toFixed(0)}%，服务堪称完美！<br>`;
  if (r.trendCups > 0) note += `🔥 命中流行趋势 ${r.trendCups} 杯，潮流嗅觉不错。<br>`;
  if (r.net < 0) note += `⚠️ 今日亏损，注意控制固定成本（房租/工资）。<br>`;
  if (!note) note = '平稳的一天，继续保持。';

  /* ★★ V20：明日建议。
     原来 note 只做**回顾**（今天赚了多少、流失了谁），
     玩家看完知道「昨天怎样」但不知道「明天该干什么」——
     而每天的决策依据本该来自结算。
     ★ 引擎给的是结构化数据（kind/icon/text/prio），
       这里只负责显示 —— 措辞要改的话不该动引擎。 */
  const adv = nextAdvice(s);
  const adviceHtml = `<div class="rep-adv ${esc(adv.kind)}">
    <div class="ra-h">${adv.icon} 明日建议</div>
    <div class="ra-t">${adv.text}</div>
  </div>`;

  /* 不给结算弹窗画 ×：日报是「必须点『进入下一天』才能继续」的强制步骤。
     以前这里有 ×，玩家习惯性关掉后 phase 停在 'report'，再点开门会被
     「今天的账还没结」挡死，而当期内没有任何入口能重新打开日报 ——
     只能提前收官或回主菜单。小游戏版的 drawModal 对 report 同样不画 ×，
     两边口径一致。 */
  const html = `<div class="m-title">🔔 Day ${r.day} 打烊结算</div>
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
    ${adviceHtml}
    ${(r.contractResult || (s.contract && s.contract.done) || r.contract) ? (() => {
      /* 合同结算行：日报是玩家唯一会认真看的页面，合同的成败必须在这里落地，
         否则「备货页给方向、结算页不给交代」等于白给。 */
      const cr = r.contractResult;
      if (!cr) return '';
      return `<div class="rep-ct ${cr.ok ? 'ok' : 'bad'}">`
        + `${cr.ok ? '📜 今日合同达成' : '📜 今日合同未达成'}：`
        + `${esc(cr.emoji)} ${esc(cr.name)} · `
        + (cr.ok ? `<b>+${money(cr.cash)}</b>` : `口碑 ${cr.rep}`)
        + `</div>`;
    })() : ''}
    ${(r.stageResult) ? (() => {
      /* V5 关卡结算行：和合同一样，日报是玩家唯一认真看的页面，
         关卡的成败必须在这里落地。 */
      const sr = r.stageResult;
      return `<div class="rep-ct ${sr.ok ? 'ok' : 'bad'}">`
        + `${sr.ok ? '🏔️ 关卡达成' : '🏔️ 关卡未达成'}：`
        + `${esc(sr.emoji)} ${esc(sr.name)} · ${esc(sr.diffEmoji)}${esc(sr.diffName)} · `
        + (sr.ok ? `<b>+${money(sr.cash)}</b>` : `目标 ${esc(sr.desc)}`)
        + `</div>`;
    })() : ''}
    ${(r.highlights && r.highlights.length) ? `<div class="rep-hl">`
      + r.highlights.map(h => `<div class="hl-i">${esc(h.text)}</div>`).join('')
      + `</div>` : ''}
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
  const s = window.S; if (!s) return false;
  const ev = s.pendingEvent;
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

/* ---------------- 打烊三选一 ---------------- */
/** 把手里已有的策略卡渲染成一行小标签（没有则不占版面） */
UI.cardsChipsHtml = function (s) {
  const ids = Array.isArray(s.cards) ? s.cards : [];
  if (!ids.length) return '';
  const rows = ids.map(id => {
    const c = cardById(id);
    if (!c) return '';
    return `<span class="cd-chip" title="${esc(c.gain)} · 代价 ${esc(c.cost)}">${c.emoji} ${esc(c.name)}</span>`;
  }).join('');
  return `<div class="card"><div class="card-h">🃏 经营策略
    <span class="ch-sub">${ids.length}/${CFG.CARD_MAX} · 打烊时还会再抽</span></div>
    <div style="font-size:var(--fs-md);color:var(--txt3);line-height:1.6;margin-bottom:8px">
      每张卡都同时带来好处和代价，选定后会一直生效到本局结束。手感不对也不用硬吃 —— 可以选择「都不要」。
    </div>
    <div class="cd-chips">${rows}</div></div>`;
};

/** 打烊抽卡：三选一（或跳过）。结构与事件弹窗一致，便于玩家沿用熟悉的操作 */
UI.showCardDraft = function () {
  const s = window.S; if (!s) return false;
  const offer = Array.isArray(s.cardOffer) ? s.cardOffer : [];
  if (!offer.length) return false;
  let h = `<div class="m-title">🃏 经营策略 · 三选一</div>
    <div class="m-sub">Day ${s.day} 打烊 · 选定后在本局内持续生效</div>
    <div class="rep-note">每张卡都是有得有失的：挑一张适配当前产能与现金流的，
      或者一张都不选、维持现有路线。</div>`;
  offer.forEach(c => {
    h += `<button class="ev-opt" data-act="pickcard" data-id="${c.id}">
      <div class="eo-l">${c.emoji} ${esc(c.name)}</div>
      <div class="eo-d"><span class="cd-up">↑ ${esc(c.gain)}</span><br><span class="cd-down">↓ ${esc(c.cost)}</span></div></button>`;
  });
  h += `<div class="m-btns"><button class="btn btn-ghost" data-act="skipcard">🚫 都不要</button></div>`;
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
        <li><b>⑤ 三选一</b>：每 ${CFG.CARD_EVERY} 天打烊时抽 3 张经营策略卡，最多留 ${CFG.CARD_MAX} 张</li>
        <li><b>⑥ 投资</b>：升级设备 / 研发配方 / 招人 / 开分店</li>
      </ul></div>
    <div class="m-sec"><h4>🃏 经营策略卡</h4>
      <p>每张卡都<b>有得有失</b>（例：外卖平台 客流 +25% / 每杯收入 -¥0.8），选定后本局内一直生效。<br>
      它改的是<b>收益结构</b>而不是收益总量 —— 抽到什么不重要，<b>怎么围绕它调整才是玩法</b>。<br>
      手感不对可以选「都不要」，维持现有路线同样是一种决策。</p></div>
    <div class="m-sec"><h4>🏔️ 章节关卡</h4>
      <ul>
        <li>30 天切成 <b>6 章</b>，每章 3 个关卡，按顺序打通</li>
        <li>备货阶段选难度：<b>⚪普通 / 🔵精英 / 🟣传奇</b> —— 门槛越高、奖励越丰厚</li>
        <li>关卡<b>跨 5 天推进</b>，是中期目标；每日合同是今天的目标，两个时间尺度互补</li>
        <li>未达成<b>不扣口碑</b>，只是拿不到奖励 —— 敢挑高难度才有趣</li>
      </ul></div>
    <div class="m-sec"><h4>🏷️ 招牌配方</h4>
      <ul>
        <li>某款配方累计卖出 <b>60 / 150 / 300 杯</b>，逐级成为「小有名气 / 街坊认可 / 城市名店」</li>
        <li>累计销量<b>跨局继承</b>：这一局卖得多，下一局该款永久更强</li>
        <li>加成只对<b>那一款</b>生效 —— 专精一款还是铺开十款，是个真取舍</li>
      </ul></div>
    <div class="m-sec"><h4>🎭 特殊顾客</h4>
      <ul>
        <li>每天最多来 <b>2 位</b>特殊顾客，队列里带 <b>★ 角标</b>，一眼能认出来</li>
        <li><b>🧑‍🍳 美食评论家</b>：服务好口碑 +6，服务砸了 -5</li>
        <li><b>🛒 团购大单</b>：一次要 6~8 杯，但耐心很低，忙不过来他就走了</li>
        <li><b>💝 熟客回购</b>：价格能多接受 15%，给的小费也多 60%</li>
      </ul></div>
    <div class="m-sec"><h4>👥 客群与竞争</h4>
      <ul>
        <li>顾客分 <b>5 类</b>：学生党 / 打工人 / 网红 / 家庭客 / 街坊长辈，口味偏好、价格容忍度、耐心、单次杯数都不同</li>
        <li>菜单要<b>覆盖更多口味</b>，才留得住不同客群；定价过高会被当场劝退</li>
        <li>隔壁的<b>竞争对手</b>会抢走你的客流，去「🏙️ 商圈」用挖角 / 营销压制 / 差异化反击</li>
      </ul></div>
    <div class="m-sec"><h4>♾️ 模式</h4>
      <ul>
        <li><b>每日挑战</b>：每天一局，全网同一种子 —— 同一张价格表、同一批顾客、同一串事件，比的只有经营决策</li>
        <li><b>🏆 日榜</b>：每日挑战的成绩会排进当天的榜单。一天可以打很多局，榜单记的是<b>当天最好的那一局</b>；小游戏端可直接看全网排名，网页端看本机记录</li>
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
  const s = window.S; if (!s) return;
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

/* ---------------- 分享战绩（V21） ----------------
 * ★ 为什么只对线上版有意义：App 里没有可分享的地址，「传播」只能靠应用商店；
 *   而网页版的整条增长路径就是「把链接发给朋友」。之前游戏里**没有任何分享入口** ——
 *   补了 og 分享卡也没人用得上，玩家只能去地址栏复制（手机上极难操作）。
 *
 * ★ 三级降级，覆盖真实的中国移动端环境：
 *   ① 微信内置浏览器：Web Share API 被屏蔽 → 引导用户点右上角「···」。
 *      这条路径吃的正是 index.html 里的 og 卡，所以两件事必须一起做。
 *   ② 支持 navigator.share 的浏览器（Safari / Chrome Android）：优先分享**图片**，
 *      社交平台里图的点击率远高于纯链接；不支持传文件时退回分享链接。
 *   ③ 桌面浏览器：复制「成绩 + 链接」到剪贴板。
 *
 * ★ App（Capacitor）里 location 是 capacitor:// 协议，分享出去打不开，
 *   所以那里只分享图片、不带 url。
 */
UI.shareResult = function (s) {
  if (!s) return;

  const isApp = !!(window.Capacitor && window.Capacitor.isNativePlatform
    && window.Capacitor.isNativePlatform());
  const nw = Math.round(netWorth(s));
  const title = '奶茶星球 · 我的 30 天战绩';
  const text = `我在「奶茶星球」30 天做到净资产 ${money(nw)}（${diffOf(s).name}），来挑战我！`;
  const url = String(location.href).split('#')[0].split('?')[0];

  /* ① 微信内置浏览器 */
  if (/MicroMessenger/i.test(navigator.userAgent || '')) {
    UI.modal(`<button class="close-x" onclick="UI.closeModal()">×</button>
      <div class="m-title">📤 分享给朋友</div>
      <div class="m-sub">点右上角 <b>···</b> → 「发送给朋友」或「分享到朋友圈」</div>
      <div class="m-sec" style="font-size:var(--fs-md);color:var(--txt2);line-height:1.7">
        战绩：净资产 <b style="color:var(--amber)">${money(nw)}</b> · ${esc(diffOf(s).name)}
      </div>
      <div class="m-btns"><button class="btn btn-ghost" onclick="UI.closeModal()">知道了</button></div>`);
    return;
  }

  const cv = $('shareCanvas');

  /* ②-a 分享图片（最优先） */
  if (cv && cv.toBlob && navigator.canShare && typeof File === 'function') {
    cv.toBlob(function (blob) {
      if (!blob) { shareLink(); return; }
      let file;
      try { file = new File([blob], 'bubble-tycoon.png', { type: 'image/png' }); }
      catch (e) { shareLink(); return; }
      if (!navigator.canShare({ files: [file] })) { shareLink(); return; }
      const payload = isApp ? { files: [file], title: title, text: text }
        : { files: [file], title: title, text: text, url: url };
      navigator.share(payload)
        .then(function () { UI.toast('已分享', 'ok'); })
        .catch(function () { /* 用户取消，不提示 */ });
    }, 'image/png');
    return;
  }
  shareLink();

  /* ②-b 分享链接 / ③ 复制到剪贴板 */
  function shareLink() {
    if (isApp) { UI.toast('App 内暂不支持分享链接，可先保存战绩图', 'err'); return; }
    if (navigator.share) {
      navigator.share({ title: title, text: text, url: url })
        .then(function () { UI.toast('已分享', 'ok'); })
        .catch(function () { });
      return;
    }
    const payload = text + ' ' + url;
    const done = function () { UI.toast('文案已复制，粘贴给朋友即可', 'ok'); };
    const fallback = function () {
      const ta = document.createElement('textarea');
      ta.value = payload;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) done(); else UI.toast('复制失败，请手动复制地址栏链接', 'err');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(payload).then(done).catch(fallback);
    } else fallback();
  }
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
/**
 * daily 是 recordDaily 的返回值（普通模式为 null）。
 * 每日挑战这一局结束时，日榜相关的反馈就挂在这里 —— 玩家刚打完，
 * 正是最想知道「我比别人/比自己强在哪」的时刻。
 */
UI.showEnd = function (result, daily) {
  const s = window.S; if (!s) return;
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
  /* V8 结局四维称号：同一个 S 级有多种拿法 —— 走口碑流和走利润流
     是两种不同的经营叙事，给玩家"下一局换个打法"的动力。 */
  /* 分享按钮只在网页版出现 —— App 里 location 是 capacitor:// 协议，
     分享出去对方打不开，留着只会变成"点了没反应"。 */
  const CAN_SHARE = !(window.Capacitor && window.Capacitor.isNativePlatform
    && window.Capacitor.isNativePlatform());
  const et = endingTitle(s);
  const axesHtml = et.axes.map(a => `<div class="ax ${a.tier > 0 ? 'on' : ''}">
      <div class="ax-e">${a.emoji}</div>
      <div class="ax-b"><div class="ax-n">${esc(a.name)}${a.tier > 0 ? ` · ${esc(a.title)}` : ''}</div>
        <div class="ax-d">${esc(a.desc)}</div></div>
    </div>`).join('');
  const html = `<div class="end-emoji">${emoji}</div>
    <div class="end-title">${title}</div>
    <div class="end-grade">${grade}</div>
    <div style="font-size:var(--fs-md);color:var(--txt2);margin-bottom:16px">${gradeSub}</div>
    ${(s.history || []).length >= 2 ? `<div class="card" style="text-align:left">
      <div class="card-h">📈 经营曲线</div><div id="endChart"></div></div>` : ''}
    <div class="card" style="text-align:left">
      <div class="card-h">🏅 经营四维
        <span class="ch-sub">${et.best ? `最高称号「${esc(et.best.title)}」` : '本局未达称号线'}</span></div>
      <div class="ax-grid">${axesHtml}</div>
    </div>
    <div class="card" style="text-align:left">
      <div class="rep-grid">
        <div class="rep-i"><div class="ri-k">最终净资产</div><div class="ri-v">${money(nw)}</div></div>
        <div class="rep-i"><div class="ri-k">经营天数</div><div class="ri-v">${st.days}</div></div>
        <div class="rep-i"><div class="ri-k">累计卖出</div><div class="ri-v">${st.totalCups} 杯</div></div>
        <div class="rep-i"><div class="ri-k">累计营收</div><div class="ri-v">${money(st.totalRevenue)}</div></div>
        <div class="rep-i"><div class="ri-k">最高单日净利</div><div class="ri-v">${money(st.bestDayProfit)}</div></div>
        <div class="rep-i"><div class="ri-k">最终口碑</div><div class="ri-v">${Math.round(s.rep)}</div></div>
        <div class="rep-i"><div class="ri-k">成就</div><div class="ri-v">${Object.keys(s.ach).length}/${ACHIEVEMENTS.length}</div></div>
        <div class="rep-i"><div class="ri-k">招牌配方</div><div class="ri-v">${sigViews(s).filter(x => x.lv > 0).length}/${RECIPES.length}</div></div>
      </div>
    </div>
    <div class="card" style="text-align:left">
      <div class="card-h">♻️ 品牌升级</div>
      <div style="font-size:var(--fs-md);color:var(--txt2);line-height:1.7">
        本局可获得 <b style="color:var(--amber)">${prestigeGain(s)} ★</b> 品牌声望点（当前共 ${window.META.bp} ★）。<br>
        转生会重置本局进度，但声望点永久保留：每点客流 +2%、离线收益 +2%。
      </div>
      <div class="m-btns"><button class="btn btn-amber" data-act="prestige">♻️ 转生并开始新一局</button></div>
    </div>
    ${daily ? `
    <div class="card" style="text-align:left">
      <div class="card-h">📅 每日挑战 <span class="ch-sub">${esc(todayKey())} · 全网同种子</span></div>
      <div style="font-size:var(--fs-md);color:var(--txt2);line-height:1.7">
        本局净资产 <b style="color:var(--amber)">${esc(money(daily.score))}</b>。${
        daily.newEver ? '🎉 刷新了个人最佳！'
          : (daily.newToday ? `比今天上一局多赚 ${esc(money(daily.score - daily.prevToday))}。`
            : (daily.prevToday > 0
              ? `今天已有更好的一局（${esc(money(daily.prevToday))}），本局不计入榜单。`
              : '本局成绩不计入榜单。'))}
      </div>
      <div class="m-btns"><button class="btn btn-amber" data-act="dailyrank">🏆 查看日榜</button></div>
    </div>` : ''}
    ${result !== 'bankrupt' ? `
    <div class="card" style="text-align:left">
      <div class="card-h">♻️ 无尽模式 <span class="ch-sub">不结束，目标持续升级</span></div>
      <div style="font-size:var(--fs-md);color:var(--txt2);line-height:1.7">
        从第 ${s.day} 天继续经营，目标将提升为 <b style="color:var(--amber)">${money(endlessGoal(diffOf(s).goal, Math.max(1, s.milestone || 0)))}</b>，
        每达成一次再涨 55%。适合想把数值卷到极致的人。
      </div>
      <div class="m-btns"><button class="btn btn-cyan" data-act="endless">♾️ 继续经营（无尽）</button></div>
    </div>
    <div class="card" style="text-align:left">
      <div class="card-h">🖼️ 战绩卡片</div>
      <div id="shareBox" class="share-box"></div>
      <div class="m-btns">
        <button class="btn btn-primary" data-act="dlcard">⬇️ 保存战绩图</button>
        ${CAN_SHARE ? '<button class="btn btn-ghost" data-act="share">📤 分享</button>' : ''}
      </div>
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
    else sb.innerHTML = `<div style="font-size:var(--fs-md);color:var(--txt3)">当前浏览器不支持生成图片</div>`;
  }

  UI.showScreen('screen-end');
  if (result !== 'bankrupt' && nw >= goalOf(s)) UI.confetti(90);
};

/* ---------------- 每日挑战日榜（F3） ---------------- */
/**
 * 展示本机这一份每日挑战记录：今日成绩 / 个人最佳 / 最近 7 天。
 *
 * 这不是占位视图 —— 小游戏端在未登录或宿主不支持排行榜时，玩家看到的
 * 也是同一套内容。两版刻意保持结构一致，才不会出现「换端就少半截」。
 */
UI.showDailyRank = function () {
  const m = window.META || {};
  const key = todayKey();
  const today = (m.dailyDate === key) ? Math.max(0, Math.round(num(m.dailyBest, 0))) : 0;
  const ever = Math.max(0, Math.round(num(m.dailyBestEver, 0)));
  const recent = dailyRecent(m, 7);

  let peak = 1;
  for (const r of recent) if (r.best > peak) peak = r.best;

  let bars = '';
  for (const r of recent) {
    const h = Math.max(8, Math.round(r.best / peak * 100));
    const isBest = ever > 0 && r.best >= ever;
    bars += '<div class="rk-bar' + (isBest ? ' on' : '') + '">'
      + '<i style="height:' + h + '%"></i>'
      + '<b>' + esc(r.d.slice(5)) + '</b>'
      + '<span>' + esc(money(r.best)) + '</span>'
      + '</div>';
  }
  if (!bars) {
    bars = '<div style="font-size:var(--fs-md);color:var(--txt3)">还没有成绩 —— '
      + '打一局每日挑战，这里就会出现柱子。</div>';
  }

  UI.modal(`<button class="close-x" onclick="UI.closeModal()">×</button>
    <div class="m-title">📅 每日挑战 · 同种子日榜</div>
    <div class="m-sub">每天全网共用同一个种子：同一张价格表、同一批顾客、同一串事件。比的只有经营决策。</div>
    <div class="card" style="text-align:left">
      <div class="card-h">🎯 今日 <span class="ch-sub">${esc(key)}</span></div>
      <div class="rk-now">
        <div><div class="rk-k">今日最好</div><div class="rk-v">${today ? esc(money(today)) : '未挑战'}</div></div>
        <div><div class="rk-k">个人最佳</div><div class="rk-v">${ever ? esc(money(ever)) : '—'}</div></div>
      </div>
    </div>
    <div class="card" style="text-align:left">
      <div class="card-h">📈 ${recent.length ? `最近 ${recent.length} 天` : '最近战绩'}</div>
      <div class="rk-bars">${bars}</div>
    </div>
    <div style="font-size:var(--fs-sm);color:var(--txt3);line-height:1.7">
      网页版本机保存（换设备或清缓存会丢）。全网日榜在抖音小游戏版内可见。
    </div>
    <div class="m-btns">
      <button class="btn btn-amber" onclick="UI.closeModal();doAct('daily')">🚀 挑战今天这一局</button>
      <button class="btn btn-ghost" onclick="UI.closeModal()">关闭</button>
    </div>`);
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
