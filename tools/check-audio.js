/**
 * 音效资源完整性检查（V21）
 *
 * ★ 为什么要单独守这一块：
 *   小游戏端的音频是**静默降级**设计 —— 文件缺失、宿主不支持、
 *   播放抛异常，全都 get 一个 catch 然后什么都不发生（这是对的：
 *   音效永远不该影响玩法）。代价是**丢了声音没有任何提示**，
 *   玩家只会觉得"这游戏没声音"，而开发者在真机上才会发现。
 *   所以「文件在不在、格式对不对、映射指的是不是存在的文件」只能靠测试守。
 *
 * ★ 这一轮真出过的问题（所以这条检查不是假想）：
 *   play() 原来只按频率分流，>=850Hz 一律播 tap，
 *   于是所有"达成类"反馈（980/1175/1405Hz）在真机上听起来都是点击声。
 *   这类问题**跑不出异常**，只能靠"映射表 + 预期语义"的断言来守。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const audioDir = path.join(root, 'minigame', 'audio');

let fails = 0, checks = 0;
function check(cond, label) {
  checks++;
  if (cond) { console.log('  ✔ ' + label); return true; }
  fails++;
  console.log('  ✘ ' + label);
  return false;
}

console.log('=== 音效资源（V21）===\n');

/* ---------- ① 文件必须齐 ---------- */
console.log('--- ① 文件清单 ---');
const REQUIRED = ['tap.wav', 'up.wav', 'up2.wav', 'ach.wav', 'down.wav'];
const present = fs.existsSync(audioDir) ? fs.readdirSync(audioDir).filter(f => /\.wav$/i.test(f)) : [];
for (const f of REQUIRED) {
  check(present.indexOf(f) >= 0, '存在 ' + f);
}
check(present.length === REQUIRED.length,
  '音频目录只有这 5 个（实际 ' + present.length + ' 个：' + present.join(', ') + '）');

/* ---------- ② WAV 头必须合法，时长在预期区间 ---------- */
console.log('\n--- ② 格式与时长 ---');
const DUR = { 'tap.wav': [0.02, 0.12], 'up.wav': [0.08, 0.25], 'up2.wav': [0.2, 0.5], 'ach.wav': [0.5, 1.2], 'down.wav': [0.1, 0.35] };
let totalBytes = 0;
for (const f of REQUIRED) {
  const p = path.join(audioDir, f);
  if (!fs.existsSync(p)) continue;
  const b = fs.readFileSync(p);
  totalBytes += b.length;
  const riff = b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE';
  const fmtOk = b.readUInt16LE(20) === 1 && b.readUInt16LE(22) === 1 && b.readUInt16LE(34) === 16;
  const rate = b.readUInt32LE(24);
  const dataLen = b.readUInt32LE(40);
  const dur = dataLen / (rate * 2);
  const [lo, hi] = DUR[f] || [0, 99];
  check(riff && fmtOk && rate === 22050,
    `${f} 是 PCM/单声道/16bit/22.05kHz（${rate}Hz）`);
  check(dur >= lo && dur <= hi,
    `${f} 时长 ${dur.toFixed(2)}s 在 ${lo}~${hi}s 内`);
}

/* ---------- ③ 体积预算 ---------- */
console.log('\n--- ③ 体积 ---');
/* 上限 120KB：bundle 已 795KB，音频再大就开始挤压首屏。
   留一倍余量而不是贴着 62KB，是为了以后加音效时不用立刻改阈值，
   但又不至于加到失控。 */
check(totalBytes <= 120 * 1024,
  `音频总量 ${(totalBytes / 1024).toFixed(1)} KB ≤ 120 KB`);

/* ---------- ④ 映射表里的每个 key 都必须有对应文件 ---------- */
console.log('\n--- ④ 播放映射表 ---');
const plat = fs.readFileSync(path.join(root, 'minigame', 'src', 'platform.js'), 'utf8');
const mapBlock = /var SFX_FILES = \{([\s\S]*?)\};/.exec(plat);
check(!!mapBlock, '找到 SFX_FILES 映射表');
if (mapBlock) {
  const pairs = [...mapBlock[1].matchAll(/(\w+)\s*:\s*'audio\/([\w.-]+)'/g)]
    .map(m => ({ key: m[1], file: m[2] }));
  check(pairs.length === 5, '映射表有 5 条（实际 ' + pairs.length + '）');
  for (const p of pairs) {
    check(REQUIRED.indexOf(p.file) >= 0 && fs.existsSync(path.join(audioDir, p.file)),
      `映射 ${p.key} → audio/${p.file} 存在`);
  }
}

/* ---------- ⑤ 分流规则：达成类不能落到 tap ---------- */
console.log('\n--- ⑤ 语义分流（防回归）---');
/* ★ 这条是本次修复的核心：880/980/1175/1405Hz 的"达成"必须不再是 tap。
   直接对 platform.js 里的 sfxKeyOf 做源码级断言 —— 它是个纯函数，
   但 platform.js 是 IIFE（还自带一个同名 CFG 遮蔽陷阱），
   整套 require 进来成本高且脆，这里按源码断言够用且稳定。 */
check(/kind === 'tap'\) return 'tap'/.test(plat), "kind 'tap' 直接映射 tap（不再看频率）");
check(/f >= 1200\) return 'ach'/.test(plat), 'freq ≥ 1200 → ach');
check(/f >= 900\) return 'up2'/.test(plat), 'freq ≥ 900 → up2');
check(!/freq >= 850 \? 'tap'/.test(plat), '旧的「freq >= 850 → tap」规则已被移除');
/* 调用点：里程碑三连音必须已收敛成单次 ach（否则三个音轨互相盖住） */
const mgMain = fs.readFileSync(path.join(root, 'minigame', 'src', 'main.js'), 'utf8');
check(!/beep\('up', 1405/.test(mgMain), '里程碑不再用 1405Hz 的 up（会落到 tap）');
check(/beep\('ach'\)/.test(mgMain), '里程碑 / 成就使用 beep(\'ach\')');

console.log('');
if (fails === 0) {
  console.log(`✔ 音效资源全部通过（${checks} 项）`);
  process.exit(0);
} else {
  console.log(`✘ ${fails} 项有问题 / 共 ${checks} 项`);
  process.exit(1);
}
