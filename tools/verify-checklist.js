/**
 * 上线前 UI 清单验证 —— 把《真机验证清单》里**能在 DOM 层自动验**的项
 * 做成可执行断言，并输出「自动覆盖 / 必须真机」对照表。
 *
 * ★ 为什么要自动化一部分清单：
 *   清单有 81 项，其中「渲染、文案、命中区、undefined/NaN、状态自洽」这类
 *   占了相当比例 —— 它们本来就能在 jsdom 里跑，却要占真机时间。
 *   真机时间应该留给只有真机能测的：帧率、发热、音效、分享面板、
 *   刘海屏适配、后台切换、手势。
 *
 *   本工具**不假装覆盖了真机项** —— 结尾会明确列出还剩哪些必须真机跑。
 *
 * 用法：node tools/verify-checklist.js
 */
const path = require('path');
const { buildH5Env, visibleText } = require('./h5-env');

const covered = [];
const deviceOnly = [];
let fails = 0, checks = 0;

function ok(id, name) { covered.push({ id, name }); checks++; console.log(`  ✔ ${id} ${name}`); }
function fail(id, name, msg) { fails++; checks++; console.log(`  ✘ ${id} ${name} → ${msg}`); }
function assert(cond, id, name, msg) { if (cond) ok(id, name); else fail(id, name, msg || '不满足'); }

const env = buildH5Env();
const { window, doc, E } = env;
const $ = id => doc.getElementById(id);

/** 起一局并渲染到指定 tab。state 挂在 window.S 上（UI 依赖这个约定）。 */
function boot(diff, tab) {
  const s = E.newGame(diff || 'normal', 0, null);
  window.S = s;
  window.UI.setTab(tab || 'manage');
  window.UI.renderAll();
  return s;
}

/* 可见文本必须剔除 HTML 注释 —— jsdom 的 textContent 会把注释一起拼出来，
   而代码注释里常写着「…会返回 undefined」这类解释（玩家看不到），
   直接扫会把注释误报成界面文字。详见 h5-env.visibleText 的注释。 */
const visText = id => ($(id) ? visibleText($(id)) : '') || '';
const visAll = () => visibleText(doc.body);

console.log('=============== H5 版（jsdom） ===============');

/* ---- 1.3/ 1.4 开始界面 ---- */
{
  window.eval('renderTitle()');
  const t = visAll();
  assert(/难度/.test(t) && /存档|slot|槽/i.test(t),
    '1.3', '开始界面：难度卡 + 存档槽完整可见', '未找到难度卡或存档槽');
  assert(!/undefined|NaN|\[object Object\]/.test(t),
    '1.4', '开始界面可见文字无 undefined/NaN', t.match(/.{0,30}(undefined|NaN|\[object Object\]).{0,30}/)?.[0] || '');
}

/* ---- 1.5 / 1.6 连登 ---- */
{
  assert(/连登|签到/.test(visAll()), '1.5', '连续登录入口存在', '标题页未找到连登按钮');
  const probe = window.eval(`(function () {
    const m = loadMeta();
    const a = claimLogin(m);
    const b = claimLogin(m);
    return [!!a, !!b].join('/');
  })()`);
  assert(probe === 'true/false',
    '1.6', '连登当天只能领一次（幂等）', `首次/二次 = ${probe}`);
}

/* ---- 2.2 六个 Tab ---- */
{
  const tabs = ['manage', 'lab', 'up', 'staff', 'rival', 'ach'];
  const bad = [];
  for (const t of tabs) {
    boot('normal', t);
    const txt = visAll();
    if (/undefined|NaN|\[object Object\]/.test(txt)) {
      bad.push(`${t}: ${txt.match(/.{0,24}(undefined|NaN|\[object Object\]).{0,24}/)[0]}`);
    }
  }
  assert(bad.length === 0, '2.2', '六个 Tab 均可切换且可见文字无 undefined/NaN', bad.join(' | '));
}

/* ---- 2.13 经营面板四张卡 ---- */
{
  const s = boot('normal', 'manage');
  /* ★ 新闻卡是**条件渲染**（`s.news ? ... : ''`，见 ui.js 的 rollNews），
     刚开局可能还没有新闻 —— 直接断言「一定有新闻」会把
     「还没滚动到」误报成「卡不见了」。
     正确做法：先造出新闻状态，再验证它渲染出来了。*/
  s.news = { text: '测试用新闻：某品牌新品上市', emoji: '📰' };
  window.UI.renderAll();
  const txt = visText('panel-manage');
  const need = [['市场新闻', /测试用新闻|📰/], ['店长日志', /日志|📔/],
  ['每日任务', /任务|🎯/], ['今日建议', /建议|💡/]];
  const missing = need.filter(([, re]) => !re.test(txt)).map(([n]) => n);
  assert(missing.length === 0, '2.13', '经营面板：新闻/日志/任务/建议四张卡齐备',
    `缺 ${missing.join('、')}`);
  assert(!/\[object Object\]/.test(txt), '2.13b', '建议是中文句子而非 [object Object]', '建议渲染成了对象');
}

/* ---- 2.15 一键补货 ---- */
{
  const s = boot('normal', 'manage');
  s.cash = 100000;
  const before = E.invUsed(s);
  E.autoFill(s);
  assert(E.invUsed(s) > before, '2.15', '一键补货可用（库存上升）',
    `库存未变 ${before} → ${E.invUsed(s)}`);
  window.UI.renderAll();
  const has999 = Array.from(doc.querySelectorAll('[data-act="buy"]'))
    .some(el => el.getAttribute('data-q') === '999');
  assert(!has999, '2.15b', '不存在必然撞仓库上限的采购按钮', '存在 data-q=999');
}

/* ---- 2.8 结算数据 ---- */
{
  const s = E.newGame('normal', 0, null);
  s.cash = 100000;
  for (const g of E.ING) s.inv[g.id] = 500;
  E.openShop(s);
  let gd = 0;
  while (s.sim && !s.sim.closing && gd++ < 400) E.tick(s, 0.12);
  E.endDay(s);
  const r = s.lastReport;
  /* ★ 只要求「有限」，不要求整数 —— 净利是带小数的浮点
     （这一局 net = 228.19999999999993，日报里会四舍五入显示，
     但内部就是浮点）。断言成「必须是整数」是把显示层的要求
     错施加到数据层。 */
  /* ★ 日报里已服务杯数字段叫 **served**，不是 cups ——
     `cups` 只存在于**实时 sim** 上（sim.cups），日报对象里没有。
     用错字段名会让 Number.isFinite(undefined) = false 而误报「数据异常」。
     这与 browser-smoke 早先踩的是同一个坑（它当时注释写得很清楚）。*/
  assert(r && [r.revenue, r.cogs, r.net, r.served, r.lost].every(v => Number.isFinite(v)),
    '2.8', '结算数据均为有限数（无 undefined/NaN，净利允许小数）',
    r ? JSON.stringify({ rev: r.revenue, net: r.net, served: r.served }) : '无日报');
  if (r) {
    const expect = Math.round(r.revenue - r.cogs - r.wages - r.rent - (r.marketing || 0));
    assert(Math.abs(expect - r.net) <= 2, '2.8b', '净利 = 营收 − 成本 − 人工 − 租金',
      `${expect} ≠ ${r.net}`);
  }
}

/* ---- 2.10窄屏不溢出 ---- */
{
  const bad = [];
  for (const w of [320, 360]) {
    window.innerWidth = w;
    for (const t of ['manage', 'lab', 'up']) {
      boot('normal', t);
      for (const el of doc.querySelectorAll('#screen-game .card')) {
        const box = el.getBoundingClientRect();
        if (box.width > 0 && box.right > w + 1) { bad.push(`${w}px/${t} 右溢出 ${Math.round(box.right)}`); break; }
      }
    }
  }
  window.innerWidth = 390;
  assert(bad.length === 0, '2.10', '窄屏 320/360px 下卡片不横向溢出', bad.join('；'));
}

/* ---- 4.1 命中区尺寸 ---- */
{
  boot('normal', 'manage');
  const btns = Array.from(doc.querySelectorAll('#screen-game .btn'));
  const small = btns.filter(b => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && (r.height < 16 || r.width < 24);
  });
  assert(small.length === 0,
    '4.1', '可点按钮尺寸足够（≥24×16，手指可命中）',
    `${small.length} 个过小：${small.slice(0, 3).map(b => b.textContent.trim().slice(0, 8)).join('、')}`);
}

/* ---- V10/V11 新系统的界面标示（清单外新增，两版都必须有）---- */
{
  /* 城市标示：H5 端菜单页与研发页都要写明「当前城市 + 可用菜系」 */
  const s = boot('normal', 'manage');
  const manageTxt = visText('panel-manage');
  assert(/📍/.test(manageTxt) && /本店可用菜系/.test(manageTxt),
    'V10', '菜单页标示当前城市与可用菜系数', '未找到城市条');
  window.UI.setTab('lab'); window.UI.renderAll();
  const labTxt = visText('panel-lab');
  assert(/研发树/.test(labTxt) && /第\s*\d+\s*阶段/.test(labTxt),
    'V10', '研发页显示研发树与阶段', '未找到阶段信息');

  /* 店长面板 */
  const s2 = boot('normal', 'manage');
  s2.cash = 1e6;
  E.openShopBranch(s2);
  window.UI.renderAll();
  const mgrTxt = visText('panel-manage');
  assert(/店长与分店编制/.test(mgrTxt),
    'V11', '管理页有「店长与分店编制」区块', '未找到');
  E.hireManager(s2, 2, 0);
  window.UI.renderAll();
  const mgrTxt2 = visText('panel-manage');
  assert(/该店加成/.test(mgrTxt2) && /卸任/.test(mgrTxt2),
    'V11', '店长卡显示该店加成与卸任入口', '加成或卸任按钮缺失');
}

/* ---- 脚本错误 ---- */
{
  const real = env.errors.filter(e => !/Not implemented|Could not parse CSS/.test(e));
  assert(real.length === 0, 'X.0', '渲染过程无脚本错误',
    real.slice(0, 2).join(' | '));
}

/* ============================ 真机项 ============================ */
const PHONE_ITEMS = [
  ['1.1', '冷启动 ≤3 秒（低端机 ≤5 秒）', '加载耗时'],
  ['1.2', '首屏无长时间白/黑屏', '需眼睛看'],
  ['2.4', '开门后倒计时走字、顾客实际出现', '需眼睛看'],
  ['2.5', '★ 点出杯位能加速（核心手感）', '需手指逐台点'],
  ['2.6', '连点出杯位连击数上涨', '需手指连点'],
  ['2.11', '任务达成即时弹出气泡', '气泡动画需眼睛看'],
  ['2.14', '备货阶段看报表不跳天', '需交互复核'],
  ['2.17', '引导能自动推进', '需交互复核'],
  ['2.18', '结算环比（Day 2 起）', '需眼睛看'],
  ['2.21', '音效开关（小游戏）', '音频只能真机测'],
  ['2.22', '分享面板拉起、标题带净资产', '需宿主App 环境'],
  ['2.23', '导出存档跨设备还原', '需两台设备'],
  ['3.1', '★ 杀进程重进进度还在', '需真机杀进程'],
  ['3.4', '★ 切后台再回来不丢进度', '需真机切后台'],
  ['3.5', '★ 切后台时营业自动暂停', '需真机切后台'],
  ['4.2', '无双击缩放（iOS 尤其）', '需真机手势'],
  ['4.3', '面板可滚动', '需手指滑动'],
  ['4.4', '滚动边界不露空白', '需滑到边界'],
  ['4.5', '滑动不误触弹窗', '需真机手势'],
  ['4.7', '★ 无卡顿掉帧', '帧率需真机测'],
  ['5.2', '★ 顶部不被刘海/灵动岛遮挡', '需刘海屏真机'],
  ['5.3', '★ 底部不被 Home 指示条遮挡', '需全面屏真机'],
  ['5.4', '转横屏不崩溃', '需真机旋转'],
  ['二', '★ 中低端 Android 帧率 / 内存 / 发热', '性能只能真机测'],
  ['三', '音频资源加载（仅 H5）', '需真机播放'],
  ['三·五', '抖音平台能力 ②~⑤', '需宿主 App 环境'],
];
for (const it of PHONE_ITEMS) deviceOnly.push({ id: it[0], name: it[1], why: it[2] });

/* ============================ 输出 ============================ */
console.log('');
console.log('=============== 覆盖情况 ===============');
console.log(`  自动覆盖 ${covered.length} 项　必须真机 ${deviceOnly.length} 项`);
console.log('');
console.log('  📱 仍需真机（建议 iOS + 中低端 Android 各跑一遍）：');
for (const d of deviceOnly) {
  console.log(`     ${String(d.id).padEnd(8)} ${d.name}  —— ${d.why}`);
}
console.log('');
if (fails === 0) console.log(`✅ 清单自动化部分全部通过（${checks} 项）`);
else console.log(`❌ 清单验证发现 ${fails} 个问题 / 共 ${checks} 项`);
process.exit(fails === 0 ? 0 : 1);