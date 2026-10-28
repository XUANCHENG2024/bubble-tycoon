/**
 * 难度曲线与存档容错检查（V20）
 *
 * ★ 这轮修的是两个**玩家会直接受害**的问题：
 *   ① easy 难度第 14 天就通关 → 剩 16 天（53%）没有目标可打
 *   ② 存档损坏 → 读档返回 null → 玩家以为进度没了（数据其实还在）
 *
 * ★ 难度部分守「三档必须单调递减」：
 *   原来 easy 221% / normal 110% / hard 84%，
 *   而 hard 的实测净资产**高于** normal —— 难度是反的。
 *   硬测目标值意义不大（玩家水平差异大），
 *   但「easy 比 hard 容易」这种次序错误必须守住。
 */
const fs = require('fs');
const path = require('path');
const { buildH5Env } = require('./h5-env.js');

/* ⑤ 那一段要读 styles.css 确认 pointer-events —— 需要项目根路径 */
const root = path.join(__dirname, '..');

let fails = 0, checks = 0;
function check(cond, label) {
  checks++;
  if (cond) { console.log('  ✔ ' + label); return true; }
  fails++;
  console.log('  ✘ ' + label);
  return false;
}

console.log('=== 难度曲线与存档容错（V20）===\n');

/* ---------- ① 阶段目标配置 ---------- */
console.log('--- ① 阶段目标 ---');
{
  const { window } = buildH5Env();

  /* 三档都必须配置阶段目标表 */
  const ok = ['easy', 'normal', 'hard'].every(k => {
    const t = window.eval('STAGE_GOALS[' + JSON.stringify(k) + ']');
    return Array.isArray(t) && t.length === 6 && t.every(x => x > 0);
  });
  check(ok, '三档都有 6 个阶段的绝对目标值');

  /* ★ 必须单调递增 —— 阶段目标倒着长会让进度条与现实脱节 */
  const mono = ['easy', 'normal', 'hard'].every(k => {
    const t = window.eval('JSON.stringify(STAGE_GOALS[' + JSON.stringify(k) + '])');
    const arr = JSON.parse(t);
    for (let i = 1; i < arr.length; i++) if (arr[i] <= arr[i - 1]) return false;
    return true;
  });
  check(mono, '各档阶段目标单调递增');

  /* ★ 最后一阶段必须等于该档的 goal ——
     否则「第 30 天的目标」和「通关目标」不是同一个数，
     玩家看到通关了但最后锚点没达成，会困惑。 */
  const aligned = ['easy', 'normal', 'hard'].every(k => {
    const last = window.eval('STAGE_GOALS[' + JSON.stringify(k) + '][5]');
    const goal = window.eval('DIFFICULTY[' + JSON.stringify(k) + '].goal');
    return last === goal;
  });
  check(aligned, '最后阶段目标 == 该档通关目标');

  /* 锚点个数常量与天数匹配 */
  const cnt = window.eval('MILESTONE_EVERY_COUNT');
  const days = window.eval('CFG.DAYS');
  check(cnt === Math.ceil(days / window.eval('MILESTONE_EVERY')),
    '阶段数常量与「天数/间隔」一致（' + cnt + ' = ceil(' + days + '/' + window.eval('MILESTONE_EVERY') + ')）');
}

/* ---------- ② milestoneOf 走新锚点 ---------- */
console.log('\n--- ② 锚点判定 ---');
{
  const { window } = buildH5Env();

  /* 各档在自己的**第 1 个窗口**内应取到该档第一个锚点。
     ★ 注意窗口边界：idx = ceil(day/5) - 1，
       所以 Day 1~5 是窗口 0、Day 6~10 是窗口 1 ——
       Day 6 就已经属于第 2 个窗口了（锚点日 10）。
       ★ 我第一次拿 Day 6 去断言「第 1 个锚点」，报了个看似真实的失败；
         实际是我把窗口边界想简单了。断言要对齐真实边界。 */
  const perDiff = ['easy', 'normal', 'hard'].map(k => {
    window.eval('window.S = newGame(' + JSON.stringify(k) + ', 0, null);');
    window.eval('window.S.day = 5;');   /* 第 1 个窗口末尾 */
    const w = window.eval('milestoneOf(window.S).worth');
    const first = window.eval('STAGE_GOALS[' + JSON.stringify(k) + '][0]');
    return { k, w, first, ok: w === first };
  });
  check(perDiff.every(x => x.ok),
    'Day 5 时取该档第一个锚点'
    + (perDiff.some(x => !x.ok)
      ? '（' + perDiff.map(x => x.k + ':' + x.w + '≠' + x.first).join(' ') + '）' : ''));

  /* 窗口推进：Day 6 已进入第 2 个窗口 */
  window.eval('window.S = newGame("normal", 0, null);');
  window.eval('window.S.day = 6;');
  const w1 = window.eval('milestoneOf(window.S).worth');
  check(w1 === window.eval('STAGE_GOALS.normal[1]'),
    'Day 6 推进到第二个锚点（¥' + w1 + '）');

  /* 窗口推进：Day 11 应取第 3 个锚点 */
  window.eval('window.S.day = 11;');
  const w2 = window.eval('milestoneOf(window.S).worth');
  check(w2 === window.eval('STAGE_GOALS.normal[2]'),
    'Day 11 推进到第三个锚点（¥' + w2 + '）');

  /* 老存档容错：difficulty 缺失时不能崩 */
  const fallback = window.eval('(function(){'
    + 'var s = newGame("normal",0,null); s.day = 6; s.diff = undefined;'
    + 'var m = milestoneOf(s);'
    + 'return m && m.worth > 0;})()');
  check(fallback, '难度字段缺失时回落到比例算法（不崩）');
}

/* ---------- ③ 明日建议 ---------- */
console.log('\n--- ③ 结算的「明日建议」---');
{
  const { window } = buildH5Env();
  window.eval('window.S = newGame("normal", 0, null); window.S.cash = 300000;');

  const mk = (obj) => {
    window.eval('window.S.day = 12;');
    window.eval('window.S.report = ' + JSON.stringify(obj));
    return JSON.parse(window.eval('(function(){'
      + 'var a = nextAdvice(window.S);'
      + 'return JSON.stringify({k:a.kind, i:a.icon, t:a.text, p:a.prio});})()'));
  };
  const base = {
    day: 12, served: 30, orders: 40, lost: 2, revenue: 1200, cogs: 500,
    wages: 200, rent: 300, marketing: 0, net: 200, sat: 0.9, repDelta: 1, repAfter: 50,
    stockout: 0, priceLost: 0,
  };

  /* 亏损要最高优先级 —— 会破产 */
  const loss = mk(Object.assign({}, base, { net: -400 }));
  check(loss.k === 'loss' && loss.p === 100,
    '亏损 → prio 100（最高）：' + loss.i + ' ' + loss.t.slice(0, 24) + '…');

  /* 缺料流失次之 —— 白丢的客人 */
  const stock = mk(Object.assign({}, base, { stockout: 9 }));
  check(stock.k === 'stockout', '缺料流失 → stockout：' + stock.t.slice(0, 24) + '…');

  /* 正常时不啰嗦 */
  window.eval('window.S.staff = [{id:1},{id:2},{id:3}];');
  const ok = mk(Object.assign({}, base, { orders: 30 }));
  check(ok.k === 'ok', '一切正常 → ok：' + ok.t.slice(0, 24) + '…');

  /* ★ 每种情况都必须有文字建议 ——
     引擎层返回结构化数据，UI 只显示；
     如果 text 为空，UI 就会显示一个空框。 */
  const all = [loss, stock, ok];
  check(all.every(a => a.t && a.t.length > 6 && a.i),
    '每条建议都有图标与文字');

  /* 没有 report 时不能崩 */
  const noRep = window.eval('(function(){'
    + 'var s = newGame("normal",0,null); s.report = null;'
    + 'var a = nextAdvice(s); return !!a && !!a.text;})()');
  check(noRep, '无 report 时不崩溃');
}

/* ---------- ④ 存档容错 ---------- */
console.log('\n--- ④ 存档损坏恢复 ---');
{
  const { window } = buildH5Env();

  /* 正常写入 → 主档 + 备份都有 */
  window.eval('window.S = newGame("normal", 0, null);');
  window.eval('window.S.cash = 12345; window.S.day = 7; saveGame(window.S);');
  const key = window.eval('slotKey(0)');
  const main = window.eval('storageGet(' + JSON.stringify(key) + ')');
  const bak = window.eval('storageGet(' + JSON.stringify(key + '_bak') + ')');
  check(!!main && !!bak,
    '写入时双写主档与备份（' + (main || '').length + ' / ' + (bak || '').length + ' 字节）');

  /* ★ 模拟「写入中途被浏览器杀掉」：主档截断 */
  window.eval('storeBackend().set(' + JSON.stringify(key) + ', ' + JSON.stringify('{"day":10,"cash":5000') + ')');
  const rec = window.eval('(function(){'
    + 'var s = loadGame(0);'
    + 'if (!s) return null;'
    + 'return {day: s.day, cash: s.cash, flag: !!s.recoveredFromBackup};})()');
  check(rec && rec.day === 7 && rec.cash === 12345,
    '主档截断 → 从备份完整恢复（day=' + (rec && rec.day) + ' cash=' + (rec && rec.cash) + '）');
  check(rec && rec.flag === true,
    '恢复后打标记（UI 据此提示「进度可能少一点」）');

  /* ★ 坏主档要挪走而不是删 —— 万一玩家想人工抢救 */
  const broken = window.eval('storageGet(' + JSON.stringify(key + '_broken') + ')');
  check(!!broken, '坏主档被保留到 _broken 键（不丢弃）');

  /* 主档已恢复为有效内容 */
  const healed = window.eval('storageGet(' + JSON.stringify(key) + ')');
  check(!!healed && healed.indexOf('"day":7') >= 0,
    '恢复后主档被写回有效内容（下次读不再走异常路径）');

  /* 备份也坏 → 返回 null 但不崩 */
  window.eval('storeBackend().set(' + JSON.stringify(key) + ', "garbage");');
  window.eval('storeBackend().set(' + JSON.stringify(key + '_bak') + ', "garbage");');
  const dead = window.eval('(function(){ try { return loadGame(0) === null ? "null" : "有值"; } catch(e){ return "抛异常"; } })()');
  check(dead === 'null', '主档与备份都坏 → 返回 null 而非抛异常（' + dead + '）');

  /* 槽位摘要要能读备份（否则标题页连存档都看不到） */
  window.eval('window.S = newGame("normal", 0, null); window.S.cash = 999; saveGame(window.S);');
  /* 故意写一个非 JSON 的值（数字）——避开引号嵌套的转义麻烦 */
  window.eval('storeBackend().set(' + JSON.stringify(key) + ', 42);');
  const info = window.eval('(function(){ var v = slotInfo(0); return v ? "有摘要 day=" + v.day : "无摘要"; })()');
  check(/有摘要/.test(info), '主档坏时槽位摘要仍能读备份（' + info + '）');
}


/* ★★★ 清档必须把备份一起删 ——
     加了双写之后这是最容易漏的一处：
       ① clearSave 只删主档 → hasAnySave 仍为 true，
          玩家删了档却还显示着（浏览器 smoke 立刻抓到了）
       ② 更糟：下次 loadGame 主档读不到会**从备份把档复活**，
          玩家明明点了删除，进游戏发现进度还在。
     ★ 这类「新增机制忘了让旧路径同步」的 bug 特征很固定：
       新功能自己测都对，一旦与老功能交互就出错。
       浏览器 smoke 的「清档后该槽位为空」就是守这个的。 */
{
  /* ★ 独立环境：这一段需要自己的 S/window —— 上一段的作用域里
     虽然也有 window，但那样会把两段的状态混在一起
     （清档会清掉上一段刚写的存档，断言之间互相影响）。 */
  const env = buildH5Env();
  const w = env.window;
  w.eval('window.S = newGame("normal", 0, null); saveGame(window.S);');
  const key2 = w.eval('slotKey(0)');
  w.eval('clearSave(0);');
  check(w.eval('storageGet(' + JSON.stringify(key2) + ')') === ''
    && w.eval('storageGet(' + JSON.stringify(key2 + '_bak') + ')') === '',
    '清档时主档与备份都被删除');
  check(w.eval('!slotInfo(0)'), '清档后槽位摘要为空');
  check(w.eval('!hasAnySave()'), '清档后 hasAnySave 为 false');
  /* ★ 删了之后读档必须拿不到东西（不能从备份复活） */
  check(w.eval('loadGame(0) === null'), '清档后读档拿不到任何数据');
}

/* ---------- ⑤ 营业即时反馈与音频节奏 ---------- */
console.log('\n--- ⑤ 出杯反馈与音阶 ---');
{
  const { window, doc } = buildH5Env();
  window.eval('window.S = newGame("normal", 0, null); window.S.cash = 300000;');
  window.eval('UI.setTab("manage"); UI.renderAll();');

  /* ★ 音阶：连续出杯时基频单调递增。
     ★ 断言只看**基频**（<1500Hz）——
       第 3 级起会叠一个 2 倍泛音，不排除的话数组看起来就不单调了。
       我第一次写断言没排除泛音，报了个「音阶不递增」的假失败。 */
  window.eval('window.__log = []; SFX.tone = function (f) { window.__log.push(Math.round(f)); };');
  for (let i = 0; i < 7; i++) window.eval('UI.serveFeedback(document.getElementById("stage"), null);');
  const all = JSON.parse(window.eval('JSON.stringify(window.__log)'));
  const base = all.filter(f => f < 1500);
  check(base.length >= 5 && base.every((f, i) => i === 0 || f > base[i - 1]),
    '连续出杯基频单调递增（' + base.join(' → ') + '）');

  /* 音高封顶（连点 20 次也不能刺耳） */
  window.eval('window.__log = []; window.UI.serveChain.lastAt = Date.now();');
  for (let i = 0; i < 20; i++) window.eval('UI.serveFeedback(document.getElementById("stage"), null);');
  const top = Math.max(...JSON.parse(window.eval('JSON.stringify(window.__log)')).filter(f => f < 1500));
  check(top <= 1600, '音阶封顶（连点 20 次最高 ' + top + 'Hz，不刺耳）');

  /* 停手后归零 */
  window.eval('window.UI.serveChain.lastAt = Date.now() - 5000; window.__log = [];');
  window.eval('UI.serveFeedback(document.getElementById("stage"), null);');
  const back = JSON.parse(window.eval('JSON.stringify(window.__log)'))[0];
  check(back === 880, '停手 1.2 秒后音阶回落基准（' + back + 'Hz）');

  /* ★ 飘字参数用对象而不是位置参数 ——
     （host, x, y, text, kind）里两个数字挨着，
     传错顺序不报错、只显示成「top: 12px」这种诡异结果（我踩过）。 */
  window.eval('UI.serveFloat(document.getElementById("stage"), {text: "12", kind: "serve"});');
  const fl = window.eval('(function(){var e=document.querySelector("#stage .serve-float");'
    + 'return e ? e.textContent + "|" + e.className : "";})()');
  check(fl.indexOf('12') === 0 && /serve/.test(fl),
    '飘字参数为对象形式（文本=' + fl.split('|')[0] + '）');

  /* 批量飘字要带坐标 */
  window.eval('UI.serveFloat(document.getElementById("stage"), {x: 100, y: 60, text: "5", kind: "burst"});');
  const pos = window.eval('(function(){var e=document.querySelector("#stage .serve-float.burst");'
    + 'return e ? e.style.left : "";})()');
  check(pos === '100px', '批量飘字按坐标定位（' + pos + '）');

  /* ★ 边界：host / opt 为 null 都不能崩 ——
     舞台可能在页面隐藏时被清掉（stageEnd 会重置引用）。 */
  let crash = false;
  try {
    window.eval('UI.serveFloat(null, {text: "x"});');
    window.eval('UI.serveFeedback(null, null);');
  } catch (e) { crash = true; }
  check(!crash, 'host / opt 为 null 时不崩溃');

  /* 飘字不能挡点击 */
  check(fs.readFileSync(path.join(root, 'styles.css'), 'utf8').indexOf('pointer-events: none') >= 0,
    '飘字 pointer-events:none（不挡后续点击）');
}


/* ---------- ⑥ slotInfo 缓存（性能） ---------- */
console.log('\n--- ⑥ 槽位摘要缓存 ---');
{
  /* ★ 这条守的是 V20 引入的一个真实退化：
     加了「主档损坏→读备份」的兜底后，我最初让兜底路径**不写缓存**，
     于是主档一损坏，标题页每帧都要重解析一次坏 JSON + 一次备份 JSON。
     实测退化 2.6 倍（0.045 → 0.114 ms/次），
     低端机每帧 6 次 = 6.86ms —— 还在预算内，但白烧。
     ★ 修法：缓存主档**与**备份两份结果，任一原文没变就复用。
     ★ 断言用「解析次数」而不是「耗时」——
       耗时受机器影响会抖，解析次数是确定的。 */
  const { window } = buildH5Env();
  window.eval('window.S = newGame("normal", 0, null); window.S.cash = 999; saveGame(window.S);');
  const key = window.eval('slotKey(0)');

  /* 把主档改成损坏（真实场景：写入过程中浏览器被杀） */
  window.eval('storeBackend().set(' + JSON.stringify(key) + ', 42);');

  /* ★ 数一数 parseSlotRaw 被调了几次 */
  window.eval('window.__parseCount = 0;');
  window.eval('var __orig = parseSlotRaw; parseSlotRaw = function(k, raw){ window.__parseCount++; return __orig(k, raw); };');
  for (let i = 0; i < 10; i++) window.eval('slotInfo(0);');
  const n = window.eval('window.__parseCount');
  check(n <= 2,
    '主档损坏时 slotInfo 不重复解析（10 次调用只解析 ' + n + ' 次）');

  /* 缓存后仍要能读到摘要（不能为了性能牺牲正确性） */
  const info = window.eval('(function(){ var v = slotInfo(0); return v ? "day=" + v.day : "无"; })()');
  check(/day=/.test(info), '损坏场景仍能读到摘要（' + info + '）');

  /* ★★ V21：升级项的**文案必须与引擎常量一致**。
     本轮真实发生过：training 从「出杯速度」改成「每杯成本 −4%」，
     常量与引擎都改了、**只有文案没改**（一次字符串替换静默失败），
     于是界面继续显示「全员效率 +12%」，而所有测试都是绿的。
     这类"界面在说谎"不会让任何断言变红，只能靠专门的一致性检查兜住。 */
  const trDesc = window.eval('(function(){var t=UPGRADES.find(function(u){return u.id==="training";});return t?t.desc:"";})()');
  const pct = window.eval('Math.round(CFG.TRAINING_COST_CUT * 100)');
  check(String(trDesc).indexOf(String(pct) + '%') >= 0,
    'training 文案含 ' + pct + '%（实际：' + trDesc + '）');
  const upA = window.eval('upgradesByValue().length');
  const upB = window.eval('UPGRADES.length');
  check(upA === upB, 'upgradesByValue 覆盖全部升级项（' + upA + '/' + upB + '，漏项会从升级页消失）');
  check(window.eval('upgradesByValue()[0].id === "storage"'),
    '展示顺序按实测价值（storage 第一）');
}

console.log('');
if (fails === 0) {
  console.log('✔ 难度曲线与存档容错全部通过（' + checks + ' 项）');
  setTimeout(() => process.exit(0), 40);
} else {
  console.log('✘ ' + fails + ' 项有问题 / 共 ' + checks + ' 项');
  setTimeout(() => process.exit(1), 40);
}