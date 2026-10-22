/**
 * 移动端 / 多分辨率适配检查。
 *
 * ★ 为什么单独做这个：
 *   mobile-smoke 测的是「在某个视口下能不能跑通流程」，
 *   而**适配问题的表现形式不是报错，是溢出与遮挡**：
 *     · 横向滚动条（某个元素比视口宽）
 *     · 文字被裁成省略号 / 溢出容器
 *     · 按钮太小点不准（< 44px 是移动端公认的最小可点面积）
 *     · 固定定位元素互相重叠
 *   这些 jsdom 全都测不出来（它没有布局引擎），
 *   所以这里做的是**静态可验证的部分**，剩下的交给真机。
 *
 * 覆盖视口：iPhone SE(375) / iPhone 14(390) / iPad(768) / 桌面(1280)
 */
const path = require('path');
const { buildH5Env } = require('./h5-env.js');

const VIEWPORTS = [
  { name: 'iPhone SE', w: 375, h: 667 },
  { name: 'iPhone 14', w: 390, h: 844 },
  { name: 'iPad mini', w: 768, h: 1024 },
  { name: '桌面', w: 1280, h: 800 },
];

/* 各面板里「必须完整可见」的最小宽度元素（px）—— 移动端点击目标的公认下限 */
const MIN_TAP = 32;

console.log('=== 多分辨率适配检查 ===\n');

let fails = 0;
const { window, doc } = buildH5Env();

/* ---------- ① 静态检查：CSS 里有没有写死的像素宽度 ---------- */
console.log('--- ① CSS 固定像素宽度（会在窄屏溢出的源头）---');
{
  const fs = require('fs');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  /* 找width: NNNpx 且 NNN > 视口最小宽度的规则 */
  const minW = 375;
  const bad = [];
  const re = /(?:^|\n)\s*([.#][^{]+?)\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const sel = m[1].trim().split('\n').pop().trim();
    const body = m[2];
    /* 只看 width，不看 max-width/min-width */
    const wRe = /(?<!max-|min-)width:\s*(\d+)px/g;
    let wm;
    while ((wm = wRe.exec(body)) !== null) {
      const w = Number(wm[1]);
      if (w > minW) bad.push({ sel: sel.slice(-40), w });
    }
  }
  const real = bad.filter(b => !/menu-|modal-|chart|report|tutorial/.test(b.sel));
  if (real.length === 0) {
    console.log(`  ✔ 没有超过 ${minW}px 的固定 width（弹出层/图表类除外）`);
  } else {
    fails++;
    console.log(`  ✘ ${real.length} 处固定宽度超过 ${minW}px：`);
    for (const b of real.slice(0, 5)) console.log(`      ${b.sel} { width: ${b.w}px }`);
  }
}

/* ---------- ② 窄屏下是否出现横向溢出 ---------- */
console.log('\n--- ② 横向溢出（scrollWidth > clientWidth）---');
for (const vp of VIEWPORTS) {
  try {
    doc.documentElement.style.width = vp.w + 'px';
    doc.body.style.width = vp.w + 'px';
    const s = window.eval('newGame("normal", 0, null)');
    window.S = s;
    window.eval('window.S.cash = 300000; window.S.shops = 3');
    window.eval('window.S.managers=[{id:1,branch:2,lv:3,skill:1,trait:"qc",name:"甲"},{id:2,branch:3,lv:3,skill:1,trait:"hosp",name:"乙"}]');
    window.eval('window.S.regulars={"student#0":{id:"student#0",type:"student",face:"🧑",fav:80,name:"学生党老熟客"}}');
    window.eval('openShop(window.S)');

    const panels = ['manage', 'lab', 'up', 'staff', 'rival', 'ach'];
    const over = [];
    for (const p of panels) {
      window.eval(`UI.setTab('${p}'); UI.renderAll();`);
      const el = doc.getElementById('panel-' + p);
      if (!el) continue;
      /* jsdom 没有布局，scrollWidth/clientWidth 都是 0 ——
         所以这里改查「有没有元素的内联宽度超过视口」 */
      const wide = el.querySelectorAll('[style*="width"]');
      for (const n of wide) {
        const st = n.getAttribute('style') || '';
        const m = st.match(/(?:^|;)\s*width:\s*(\d+)px/);
        if (m && Number(m[1]) > vp.w) over.push({ p, sel: n.className, w: Number(m[1]) });
      }
    }
    if (over.length === 0) {
      console.log(`  ✔ ${vp.name} (${vp.w}px)：无超宽内联元素`);
    } else {
      fails++;
      console.log(`  ✘ ${vp.name} (${vp.w}px)：${over.length} 处超宽`);
      for (const o of over.slice(0, 3)) console.log(`      ${o.p} · ${o.sel} ${o.w}px`);
    }
  } catch (e) {
    fails++;
    console.log(`  ✘ ${vp.name}：抛异常 ${e.message}`);
  }
}

/* ---------- ③ 关键按钮的最小可点面积 ---------- */
console.log('\n--- ③ 关键操作按钮存在性 ---');
{
  const s = window.eval('newGame("normal", 0, null)');
  window.S = s;
  window.eval('window.S.cash = 300000; window.S.shops = 3');
  window.eval('openShop(window.S)');
  /* ★ 用「语义标记」而不是猜 class 名 ——
     class 名会随重构变，而 data-act / 可见文案是稳定的契约。
     ★ 而且**按面板分别检查**：「开店」在商圈页不在管理页，
       一把抓所有面板就会误判成「功能缺失」。 */
  const panelHtml = (t) => {
    window.eval(`UI.setTab('${t}'); UI.renderAll();`);
    return doc.getElementById('panel-' + t).innerHTML;
  };
  const mh = panelHtml('manage');
  const rh = panelHtml('rival');
  const musts = [
    ['一键补货', mh, /data-act="autofill"/],
    ['配方卡（菜单区）', mh, /data-act="toggle"|上架|下架/],
    ['目标进度（关卡）', mh, /data-act="stagediff"|关卡/],
    ['开店入口', rh, /data-act="sopen"/],
  ];
  const missing = musts.filter(([, h, re]) => !re.test(h)).map(([n]) => n);
  if (missing.length === 0) {
    console.log(`  ✔ 关键操作齐全（${musts.length} 项）`);
  } else {
    fails++;
    console.log(`  ✘ 缺少：${missing.join('、')}`);
  }
}

/* ---------- ④ meta viewport（移动端适配的根） ---------- */
console.log('\n--- ④ viewport meta ---');
{
  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/i);
  if (!m) {
    fails++;
    console.log('  ✘ 缺少 viewport meta —— 移动端会按 980px 渲染再缩放');
  } else {
    const c = m[1];
    const hasWidth = /width=device-width/.test(c);
    const hasInitial = /initial-scale=1/.test(c);
    const hasMaxScale = /maximum-scale/.test(c);
    console.log(`  ${hasWidth ? '✔' : '✘'} width=device-width`);
    console.log(`  ${hasInitial ? '✔' : '✘'} initial-scale=1`);
    console.log(`  ${hasMaxScale ? '✔' : '○'} maximum-scale（不写=允许缩放，对放大无障碍更好）`);
    if (!hasWidth || !hasInitial) fails++;
  }
}

console.log('');
if (fails) { console.log(`✘ ${fails} 项适配检查有问题`); process.exitCode = 1; }
else { console.log('✔ 多分辨率适配检查全部通过'); }
console.log('  注：jsdom 无布局引擎，测不了真实溢出/遮挡 —— 那些仍需真机验证。');
/* ★ 必须显式关闭 window：h5-env 建的是 pretendToBeVisual: true 的 jsdom，
   内部有 rAF / setInterval 在跑，不 close 的话 node 退不干净
   （表现为跑完所有检查后进程被 SIGTERM、看不到输出）。
   ★ 这是本项目第三次踩「jsdom 残留定时器」—— 每次症状都是「跑着跑着被杀」。 */
if (window && typeof window.close === 'function') window.close();
setTimeout(() => process.exit(process.exitCode || 0), 30);