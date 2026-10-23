/**
 * iOS 插件的静态核对（V20.5）
 *
 * ★★ 为什么需要它 ★★
 *   iOS 版我**没有 Mac，编译不了** —— 而 Swift 的类型错误
 *   只有编译期才能发现（不像 JS 有运行时兜底）。
 *   ★ 所以只能做「静态核对」：把插件里用到的每个 API
 *     拿去和 node_modules 里的 Capacitor 真实源码比对，
 *     确认「这个符号存在、签名对得上」。
 *
 * ★ 这不能替代真机验证，但能挡掉最常见的一类问题：
 *   「用了不存在的 API」—— 我这次就差点犯（见下面的记录）。
 *
 * ★★ 核对清单 ★★
 *   ① 类声明与官方插件一致（public class X: CAPPlugin, CAPBridgedPlugin）
 *   ② @objc(Name) 与 identifier 一致
 *   ③ pluginMethods 的写法与官方插件一致
 *   ④ 用到的 CAPPluginCall 方法确实存在
 *   ⑤ 用到的 Capacitor 常量/类型确实存在
 *   ⑥ ★★ 插件已登记进 packageClassList（否则 iOS 找不到它）
 *   ⑦ Swift 文件在 Xcode 工程的编译列表里（否则不会被编译）
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appDir = path.join(root, 'app');
const capIOS = path.join(appDir, 'node_modules', '@capacitor', 'ios', 'Capacitor', 'Capacitor');
const iosApp = path.join(appDir, 'ios', 'App', 'App');

let fails = 0, checks = 0;
function check(cond, label) {
  checks++;
  if (cond) { console.log('  ✔ ' + label); return true; }
  fails++;
  console.log('  ✘ ' + label);
  return false;
}

console.log('=== iOS 插件静态核对（V20.5）===\n');

/* ---------- 找到本地插件 ---------- */
const swiftFiles = fs.existsSync(iosApp)
  ? fs.readdirSync(iosApp).filter(f => f.endsWith('.swift'))
  : [];
const pluginFile = swiftFiles.find(f => /Plugin\.swift$/.test(f) && f !== 'AppDelegate.swift');

if (!check(!!pluginFile, '找到本地插件 Swift 文件'
  + (pluginFile ? '（' + pluginFile + '）' : ''))) {
  console.log('\n（无法继续核对）');
  process.exit(1);
}
const src = fs.readFileSync(path.join(iosApp, pluginFile), 'utf8');

/* ---------- ① 类声明 ---------- */
console.log('--- ① 类声明（照抄官方插件）---');
{
  check(/@objc\([A-Za-z0-9_-]+\)/.test(src), '有 @objc(Name) 标注');
  check(/public class \w+: CAPPlugin, CAPBridgedPlugin/.test(src),
    '类声明与官方一致（public class X: CAPPlugin, CAPBridgedPlugin）');
  check(/import Foundation/.test(src) && /import Capacitor/.test(src),
    '导入了 Foundation 与 Capacitor');
  check(/public let identifier = "/.test(src), '声明了 identifier');
  check(/public let jsName = "/.test(src), '声明了 jsName');
}

/* ---------- ② 名称一致性 ---------- */
console.log('\n--- ② 名称一致性 ---');
{
  const objc = /@objc\(([A-Za-z0-9_-]+)\)/.exec(src);
  const ident = /public let identifier = "([^"]+)"/.exec(src);
  check(!!objc, '能解析出 @objc 名');
  check(!!ident, '能解析出 identifier');
  if (objc && ident) {
    /* ★ ObjC 类名与 identifier 一致 ——
       NSClassFromString 找的是 ObjC 名，而 identifier 是 Capacitor 内部用。 */
    check(objc[1] === ident[1],
      '@objc 名与 identifier 一致（' + objc[1] + '）');
  }
  const jsName = /public let jsName = "([^"]+)"/.exec(src);
  check(!!jsName, '声明了 jsName');
  if (jsName) {
    /* ★ jsName 必须与 JS 侧调用的 Plugins.<jsName> 一致。 */
    const plat = fs.readFileSync(path.join(root, 'minigame', 'src', 'platform.js'), 'utf8');
    check(plat.indexOf('Plugins.' + jsName[1]) >= 0,
      'JS 侧调用的 Plugins.' + jsName[1] + ' 与之一致');
  }
}

/* ---------- ③ pluginMethods 写法 ---------- */
console.log('\n--- ③ pluginMethods（照抄官方）---');
{
  check(/public let pluginMethods: \[CAPPluginMethod\] = \[/.test(src),
    '声明了 pluginMethods');
  /* ★ 官方用的是 CAPPluginReturnPromise（ObjC 宏，Swift 可见）。
     我一度以为它是 ObjC 专属、Swift 用不了 —— 查官方插件源码才发现
     官方用的正是它。★ 所以这里比对官方而不是凭直觉。 */
  const official = fs.readFileSync(
    path.join(appDir, 'node_modules', '@capacitor', 'app', 'ios', 'Sources',
      'AppPlugin', 'AppPlugin.swift'), 'utf8');
  const mine = /CAPPluginMethod\(name: "[^"]+", returnType: (\S+?)\)/.exec(src);
  const off = /CAPPluginMethod\(name: "[^"]+", returnType: (\S+?)\)/.exec(official);
  check(!!mine, '方法声明格式与官方一致');
  if (mine && off) {
    check(mine[1] === off[1],
      'returnType 用法与官方一致（' + mine[1] + '）');
  }
  /* 每个 @objc 方法都要在 pluginMethods 里列出 */
  const methods = [...src.matchAll(/@objc func (\w+)\(/g)].map(m => m[1]);
  const listed = [...src.matchAll(/CAPPluginMethod\(name: "(\w+)"/g)].map(m => m[1]);
  const missing = methods.filter(m => listed.indexOf(m) < 0);
  check(missing.length === 0,
    '每个 @objc 方法都在 pluginMethods 里' + (missing.length ? '（缺 ' + missing.join(', ') + '）' : ''));
}

/* ---------- ④ CAPPluginCall 的方法确实存在 ---------- */
console.log('\n--- ④ CAPPluginCall API 存在性 ---');
{
  const callSrc = fs.readFileSync(path.join(capIOS, 'CAPPluginCall.swift'), 'utf8');
  const jsTypes = fs.readFileSync(path.join(capIOS, 'JSTypes.swift'), 'utf8');
  /* 我用到的 call 方法 */
  const used = [...new Set([...src.matchAll(/call\.(\w+)\(/g)].map(m => m[1]))];
  check(used.length > 0, '识别出插件用到的 call 方法：' + used.join(', '));
  for (const m of used) {
    const inCall = new RegExp('func ' + m + '\\(').test(callSrc);
    const inTypes = new RegExp('func ' + m + '\\(').test(jsTypes);
    check(inCall || inTypes, 'call.' + m + '() 在 Capacitor 源码中存在');
  }
  /* getString 的返回值是可选 —— 我的 guard let 用法依赖这一点 */
  check(/func getString\(_ key: String\) -> String\?/.test(jsTypes),
    'getString(_:) 返回可选（guard let 用法正确）');
}

/* ---------- ⑤ 其它符号存在性 ---------- */
console.log('\n--- ⑤ 其它符号 ---');
{
  const capPluginH = fs.readFileSync(path.join(capIOS, 'CAPBridgedPlugin.h'), 'utf8');
  check(capPluginH.indexOf('CAPPluginReturnPromise') >= 0,
    'CAPPluginReturnPromise 常量存在（ObjC 宏，Swift 可见）');
  const bridge = fs.readFileSync(path.join(capIOS, 'CapacitorBridge.swift'), 'utf8');
  check(/public func registerPluginType\(_ pluginType: CAPPlugin\.Type\)/.test(bridge),
    'registerPluginType 存在');
  check(/autoRegisterPlugins/.test(bridge),
    'autoRegisterPlugins 机制存在（说明只认 packageClassList）');
}

/* ---------- ⑥★ 插件已登记进 packageClassList ---------- */
console.log('\n--- ⑥ 插件登记（最容易漏且后果最严重）---');
{
  const cfgPath = path.join(iosApp, 'capacitor.config.json');
  if (!check(fs.existsSync(cfgPath), 'capacitor.config.json 存在')) {
    /* 跑一次修复脚本再验 */
    try {
      require('child_process').execFileSync(process.execPath,
        [path.join(root, 'tools', 'fix-ios-plugins.js')], { stdio: 'ignore' });
    } catch (e) { }
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const list = cfg.packageClassList || [];
  const objc = /@objc\(([A-Za-z0-9_-]+)\)/.exec(src);
  if (objc) {
    check(list.indexOf(objc[1]) >= 0,
      '★ ' + objc[1] + ' 已登记进 packageClassList'
      + (list.indexOf(objc[1]) < 0 ? ' —— iOS 会找不到插件！' : ''));
  }
  check(list.length > 0, 'packageClassList 非空');
}

/* ---------- ⑦ Xcode 工程里有这个文件 ---------- */
console.log('\n--- ⑦ Xcode 工程编译列表 ---');
{
  const pbxPath = path.join(appDir, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
  if (!check(fs.existsSync(pbxPath), 'project.pbxproj 存在')) {
    console.log('（无法继续）');
  } else {
    const pbx = fs.readFileSync(pbxPath, 'utf8');
    /* ★ 数「不同的引用点」而不是出现次数 ——
       PBXBuildFile 那行会出现两次（注释 + path）。 */
    const hasBuild = /PBXBuildFile; fileRef = [0-9A-F]+ \/\* .*\.swift \*\/;/.test(pbx);
    const hasFile = /PBXFileReference; lastKnownFileType = sourcecode\.swift; path = /.test(pbx);
    const hasPhase = /PBXSourcesBuildPhase/.test(pbx) && /in Sources/.test(pbx);
    check(hasBuild && hasFile && hasPhase,
      'Swift 文件在 Xcode 工程里（构建文件/文件引用/编译列表）');
    if (pluginFile) {
      check(pbx.indexOf(pluginFile) >= 0, pluginFile + ' 在 project.pbxproj 中');
    }
  }
}

console.log('');
if (fails === 0) {
  console.log('✔ iOS 插件静态核对全部通过（' + checks + ' 项）');
  console.log('  ★ 但这**不能替代真机验证** —— 静态核对只能确认');
  console.log('    「符号存在、签名对得上、已登记、会编译」，');
  console.log('    确认不了「运行时行为正确」。');
  setTimeout(() => process.exit(0), 40);
} else {
  console.log('✘ ' + fails + ' 项有问题 / 共 ' + checks + ' 项');
  setTimeout(() => process.exit(1), 40);
}