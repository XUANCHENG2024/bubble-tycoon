/**
 * 把本地 Swift 插件登记到 iOS 的 packageClassList（V20.5）
 *
 * ★★★ 为什么必须做这一步 ★★★
 *
 *   iOS 的自定义插件注册机制与 Android 完全不同：
 *
 *   · Android：手动 `registerPlugin(BubbleStorePlugin.class)`（MainActivity 里）
 *   · iOS：从 `capacitor.config.json` 的 `packageClassList` 读类名，
 *          用 `NSClassFromString` 查找并注册
 *          （CapacitorBridge.swift:315）。
 *
 *   ★ 而 `packageClassList` **只包含 npm 包插件** ——
 *     CLI 的 iosplugin.js 用正则扫 node_modules 里的 @capacitor 各包的
 *     ios 目录下的 swift 文件，本地写的 Swift 文件不在其中。
 *   ★ 后果链条（每一步都静默）：
 *     插件没登记 → iOS 找不到 → Plugins.BubbleStore 是 undefined
 *     → 平台层降级到异步 Preferences 路径
 *     → **读档可能全空且不报任何错**（那是最难查的失败）
 *
 *   ★ 所以必须在每次 cap sync 之后补上。
 *   ★ 而不能手动改 capacitor.config.json ——
 *     因为 `cap sync` 会重新生成它，手改必丢。
 *
 * ★ 正确做法是**改 CLI 写它的那份数据**：
 *   把本地插件当成一个「本地 npm 插件」登记到 package.json 的
 *   dependencies 里？—— 太绕。
 *   ★ 更直接：本脚本在 sync 之后把类名补进 packageClassList。
 *
 * 用法：node tools/fix-ios-plugins.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appDir = path.join(root, 'app');
const iosDir = path.join(appDir, 'ios', 'App', 'App');

/* ★ 本地插件清单：[类名（ObjC 名）, Swift 文件相对路径]
   ★ 类名必须与 Swift 里的 @objc(...) 完全一致 ——
     CLI 的正则扫的就是 @objc(Name)。 */
const LOCAL_PLUGINS = [
  ['BubbleStorePlugin', 'BubbleStorePlugin.swift'],
];

/* ---------- ① 扫本地 Swift 文件，找 @objc(...) ---------- */
function findClasses(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(swift|m)$/.test(f)) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    /* ★ 与 CLI 完全相同的正则（iosplugin.js:38）：
       /@objc\(([A-Za-z0-9_-]+)\)/
       ★ 用同一条正则，才能保证 CLI 与我扫出的是同一批类。 */
    const m = /@objc\(([A-Za-z0-9_-]+)\)/.exec(src);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

const localClasses = findClasses(iosDir);

/* ---------- ② 读现有 capacitor.config.json ---------- */
const cfgPath = path.join(iosDir, 'capacitor.config.json');
if (!fs.existsSync(cfgPath)) {
  console.error('✘ 找不到 ' + cfgPath + '（先跑 npx cap sync ios）');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const list = Array.isArray(cfg.packageClassList) ? cfg.packageClassList.slice() : [];

/* ---------- ③ 合并 ---------- */
let added = 0;
for (const c of localClasses) {
  if (!list.includes(c)) { list.push(c); added++; }
}

/* ★ 排序：保持确定性（CAP 的 list 是数组，顺序不影响功能，
   但排序后每次 sync 的 diff 稳定，便于审查）。 */
list.sort();

if (added === 0 && list.length === (cfg.packageClassList || []).length) {
  console.log('· packageClassList 已包含本地插件，无需修改');
  console.log('  ' + list.join(', '));
  process.exit(0);
}

/* ---------- ④ 写回 ---------- */
/* ★★★ 这里必须把 list 赋回 cfg.packageClassList ★★★
   我原来只 push 了 list（局部数组），却忘了写回 cfg ——
   于是脚本「报告成功、实际没改」。
   ★ 教训：**改了局部副本却忘了写回对象**，是这类脚本最常见的 bug，
     而且症状极隐蔽（输出说成功、文件没变）。
     ★ 防御：写回后立刻重新读一遍校验（见下）。 */
cfg.packageClassList = list;

/* 用 Tab 缩进 —— CLI 的 writePluginJSON 用 { spaces: '\t' }，
   保持一致才不会在 git 里出现整文件 diff。 */
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, '\t'), 'utf8');

/* ★★ 写回后立刻校验 —— 不信任「我以为写进去了」。
   ★ 这一步能抓住上面那类 bug（局部副本没写回对象）。 */
const verify = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const verified = Array.isArray(verify.packageClassList) ? verify.packageClassList : [];
const missing = localClasses.filter(c => verified.indexOf(c) < 0);
if (missing.length) {
  console.error('✘ 写回后校验失败，仍缺：' + missing.join(', '));
  console.error('  （这说明有逻辑 bug —— 改了局部副本却没写回对象）');
  process.exit(1);
}

console.log('✔ packageClassList 已更新（新增 ' + added + ' 个，已校验）');
console.log('  ' + verified.join(', '));
console.log('');
console.log('★ 登记的类名必须与 Swift 里的 @objc(Name) 一致，');
console.log('  否则 NSClassFromString 找不到，插件不会被注册。');