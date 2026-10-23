/**
 * 把 Swift 插件加入 Xcode 工程（V20.4）
 *
 * ★ 为什么需要它：
 *   新建的 .swift 文件**不会自动进 Xcode 工程** ——
 *   Xcode 的工程文件（project.pbxproj）是显式列出每个源文件的。
 *   不加这一段，Swift 插件代码就在磁盘上但**不会被编译**，
 *   JS 侧调 `BubbleStore.get()` 会报「插件不存在」。
 *   ★ 而且这个失败是**静默的**（编译通过、运行时报错）。
 *
 * ★ 为什么用脚本而不是手动拖 Xcode：
 *   手动拖会产生不可复现的工程文件改动（UUID 随机、顺序随机），
 *   而工程文件是要进版本库的 —— 每次生成都该得到同样的结果。
 *   ★ 脚本化 = 幂等 + 可审查。
 *
 * ★ pbxproj 里要改 4 处（缺一不可）：
 *   ① PBXBuildFile   —— 「编译这个文件」
 *   ② PBXFileReference —— 「这个文件存在」
 *   ③ PBXGroup       —— 「在项目导航器里显示它」
 *   ④ PBXSourcesBuildPhase —— 「把它加进编译列表」
 *
 * 用法：node tools/add-ios-swift-plugin.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pbx = path.join(root, 'app/ios/App/App.xcodeproj/project.pbxproj');

const FILE_NAME = 'BubbleStorePlugin.swift';
/* ★ 固定 UUID（不用随机）——
   幂等：重复跑不会产生新条目，也不会撞号。
   24 位十六进制，Capacitor 的 ID 风格是 504EC3... 这种前缀。 */
const UUID_FILE = '504EC3A01FED79650016851F';   /* PBXFileReference */
const UUID_BUILD = '504EC3A11FED79650016851F';  /* PBXBuildFile */

let src = fs.readFileSync(pbx, 'utf8');

if (src.indexOf(FILE_NAME) >= 0) {
  console.log('· ' + FILE_NAME + ' 已在工程中（跳过）');
  process.exit(0);
}

/* ① PBXBuildFile —— 挂在 AppDelegate 那行后面 */
const anchorBuild = /\t\t504EC3081FED79650016851F \/\* AppDelegate\.swift in Sources \*\/ = \{isa = PBXBuildFile; fileRef = 504EC3071FED79650016851F \/\* AppDelegate\.swift \*\/; \};\n/;
if (!anchorBuild.test(src)) { console.error('✘ 找不到 PBXBuildFile 锚点'); process.exit(1); }
src = src.replace(anchorBuild, (m) => m
  + `\t\t${UUID_BUILD} /* ${FILE_NAME} in Sources */ = {isa = PBXBuildFile; fileRef = ${UUID_FILE} /* ${FILE_NAME} */; };\n`);

/* ② PBXFileReference */
const anchorFile = /\t\t504EC3071FED79650016851F \/\* AppDelegate\.swift \*\/ = \{isa = PBXFileReference; lastKnownFileType = sourcecode\.swift; path = AppDelegate\.swift; sourceTree = "<group>"; \};\n/;
if (!anchorFile.test(src)) { console.error('✘ 找不到 PBXFileReference 锚点'); process.exit(1); }
src = src.replace(anchorFile, (m) => m
  + `\t\t${UUID_FILE} /* ${FILE_NAME} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${FILE_NAME}; sourceTree = "<group>"; };\n`);

/* ③ PBXGroup（AppDelegate 那一项后面） */
const anchorGroup = /\t\t\t\t504EC3071FED79650016851F \/\* AppDelegate\.swift \*\/,\n/;
if (!anchorGroup.test(src)) { console.error('✘ 找不到 PBXGroup 锚点'); process.exit(1); }
src = src.replace(anchorGroup, (m) => m
  + `\t\t\t\t${UUID_FILE} /* ${FILE_NAME} */,\n`);

/* ④ PBXSourcesBuildPhase */
const anchorSrc = /\t\t\t\t504EC3081FED79650016851F \/\* AppDelegate\.swift in Sources \*\/,\n/;
if (!anchorSrc.test(src)) { console.error('✘ 找不到 PBXSourcesBuildPhase 锚点'); process.exit(1); }
src = src.replace(anchorSrc, (m) => m
  + `\t\t\t\t${UUID_BUILD} /* ${FILE_NAME} in Sources */,\n`);

fs.writeFileSync(pbx, src);
console.log('✔ ' + FILE_NAME + ' 已加入 Xcode 工程（4 处）');
console.log('  PBXBuildFile / PBXFileReference / PBXGroup / PBXSourcesBuildPhase');