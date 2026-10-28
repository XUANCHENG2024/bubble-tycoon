/**
 * 每日合同可达成性检查（V21）
 *
 * ★ 为什么需要这套检查：
 *   合同是「每天开门前摆在备货页」的当日目标，10 条里每天抽 1 条。
 *   它的 check 是纯函数 `(m, g) => ...`，读的是 contractMetrics() 给的指标对象。
 *   问题在于**这两边是手写对齐的**：check 里写 `m.avgCap`，
 *   而 contractMetrics 从没输出过 avgCap —— `m.avgPrice <= undefined` 恒为 false，
 *   这条合同就**永远不可能达成**，玩家每天白扣口碑，而且界面上完全看不出来
 *   （目标照常显示、进度照常算，就是永远不会变成"达成"）。
 *
 *   实测比例：10 条合同里 3 条中了这个招（c_cheap / c_premium / c_nolost），
 *   按每天随机 1 条算 ≈ **28.9% 的日子**玩家拿到一个不可能完成的任务。
 *
 * ★ 判据设计：给每条合同喂一份「理想指标」——
 *   所有"越多越好"的指标取极大、"越少越好"的取 0、平均单价取区间内合法值。
 *   在这个输入下 check 必须返回 true。
 *   如果它返回 false，只可能是两种情况之一：
 *     ① check 读了不存在的字段（本次的 bug）
 *     ② check 的阈值自相矛盾（比如要求单价同时 ≥30 且 ≤28）
 *   两种都是死规则，都该拦下来。
 *
 * ★ 反证（已做）：把 data.js 里 c_cheap 的 avgCap 删掉，本检查立刻报红；
 *   补回来即恢复。说明判据抓的是真问题，不是"恒真断言"。
 */
const { buildH5Env } = require('./h5-env.js');

let fails = 0, checks = 0;
function check(cond, label) {
  checks++;
  if (cond) { console.log('  ✔ ' + label); return true; }
  fails++;
  console.log('  ✘ ' + label);
  return false;
}

console.log('=== 每日合同可达成性（V21）===\n');

const { window } = buildH5Env();

/* ---------- ① 每条合同在「理想指标」下必须可判定为达成 ---------- */
console.log('--- ① 理想指标下的可达成性 ---');
{
  /* ★ 关键：理想指标必须**经过 contractMetrics()** 生成，不能手搓一个对象。
     第一版就是手搓的（不带 avgCap/avgFloor/lostCap），
     结果三条合同照样报红 —— 但那不是数据的问题，是测试绕过了真实链路。
     现在让"完美的一天"喂给引擎自己的取数函数，
     这样 check 读到的字段名、默认值、单位全都和线上一致。
     ★ 平均单价取 26.5：同时落在「≤28」与「≥26」两个区间的交集里。
       取 0 会让 c_premium 失败、取 999 会让 c_cheap 失败 —— 都不是合同本身的问题。 */
  const rows = window.eval(`(function () {
    return CONTRACTS.map(function (c) {
      var s = newGame('normal', 0, null);
      s.contract = { id: c.id, done: false };
      /* 一杯 ¥26.5 卖 999 杯 —— 所有"越多越好"的指标都拉满 */
      s.sim = {
        cups: 999, orders: 999, revenue: 999 * 26.5, lost: 0,
        clicks: 999, comboBest: 999, trendCups: 999,
        typeServed: { influencer: 999 },
      };
      s.report = { net: 999999, sat: 1 };
      var m = contractMetrics(s);
      var ok = false;
      try { ok = !!c.check(m, c.goal); } catch (e) { ok = false; }
      return { id: c.id, name: c.name, ok: ok, desc: c.desc, avgPrice: Math.round(m.avgPrice * 10) / 10 };
    });
  })()`);

  for (const r of rows) {
    check(r.ok, `${r.id}（${r.name}｜${r.desc}）可达成`);
  }
  check(rows.length === 10, '合同总数为 10（当前 ' + rows.length + '）');
  /* 平均单价这一项顺便守住：若哪天改坏了 revenue/orders 的口径，
     c_premium 与 c_cheap 会同时失效，这两个数字就是现场证据 */
  check(rows.every(r => Math.abs(r.avgPrice - 26.5) < 0.05),
    '理想输入的平均单价被正确解析为 ¥26.5（实际 ' + (rows[0] ? rows[0].avgPrice : '-') + '）');
}

/* ---------- ② 阈值字段必须真的进到 metrics 里 ---------- */
console.log('\n--- ② 阈值字段的取数链路 ---');
{
  /* ★ 这一项盯的是**链路**而不是结果：
     check 读 m.avgCap，那 metrics 就必须产出 avgCap。
     直接把字段名硬编码在这里，是为了将来有人改字段名时立刻报红 ——
     比"跑一局看看能不能过"可靠得多（后者依赖随机客流）。 */
  const fields = window.eval(`(function () {
    var s = newGame('normal', 0, null);
    /* 挑一条带阈值的合同挂上去 */
    s.contract = { id: 'c_cheap', done: false };
    var m = contractMetrics(s);
    return {
      hasCap: m.avgCap === 28,
      hasFloor: m.avgFloor === -Infinity,
      hasLostCap: m.lostCap === Infinity,
      noContractCap: (function () {
        var s2 = newGame('normal', 0, null);
        s2.contract = { id: 'c_cups', done: false };
        var m2 = contractMetrics(s2);
        /* 没设阈值的合同：上限必须是 Infinity、下限必须是 -Infinity，
           否则 c_cups 会莫名其妙地被"默认 0"判失败 */
        return m2.avgCap === Infinity && m2.avgFloor === -Infinity && m2.lostCap === Infinity;
      })()
    };
  })()`);

  check(fields.hasCap, 'avgCap 从合同取到 28');
  check(fields.hasFloor, '未设下限时为 -Infinity（不会误判失败）');
  check(fields.hasLostCap, '未设流失上限时为 Infinity（不会误判失败）');
  check(fields.noContractCap, '无阈值合同三个字段都是中性值');
}

/* ---------- ③ 阈值必须真的起作用（不是恒真） ---------- */
console.log('\n--- ③ 阈值的判定力（反证）---');
{
  const r = window.eval(`(function () {
    var s = newGame('normal', 0, null);
    s.contract = { id: 'c_cheap', done: false };
    s.sim = { cups: 30, orders: 30, revenue: 30 * 40, lost: 0 };   /* 单价 ¥40，超过 ¥28 */
    var m = contractMetrics(s);
    var bad = (function () { var c = contractById('c_cheap'); return !!c.check(m, c.goal); })();
    s.sim = { cups: 30, orders: 30, revenue: 30 * 20, lost: 0 };   /* 单价 ¥20，达标 */
    var m2 = contractMetrics(s);
    var good = (function () { var c = contractById('c_cheap'); return !!c.check(m2, c.goal); })();
    return { bad: bad, good: good };
  })()`);

  check(r.bad === false, '单价 ¥40 时「薄利多销」判失败（阈值真的在起作用）');
  check(r.good === true, '单价 ¥20 时「薄利多销」判达成');
}

console.log('');
/* ★ 必须显式退出：buildH5Env 建出来的 jsdom window 会挂定时器/事件循环，
   脚本跑完不 exit 会一直挂着（实测 CI 里表现为 job 卡到超时才被杀）。 */
if (fails === 0) {
  console.log(`✔ 合同可达成性全部通过（${checks} 项）`);
  setTimeout(() => process.exit(0), 40);
} else {
  console.log(`✘ ${fails} 项有问题 / 共 ${checks} 项`);
  setTimeout(() => process.exit(1), 40);
}
