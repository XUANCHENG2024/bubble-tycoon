/**
 * 修复 Android 图标的密度资源与自适应图标（V20.8）
 *
 * ★★★ 根因（V20.7 完全没查这一块）★★★
 *
 * ★ 问题 1：**没有自适应图标**
 *   res/ 下**没有任何 mipmap-anydpi-v26/ 目录** ——
 *   ★ 意味着 Android 8.0（API 26）及以上**根本不会使用自适应图标**。
 *   ★ 系统会退回用 legacy 的 ic_launcher.png，
 *     并把它裁成圆形/方形贴到桌面上 —— 视觉上「图标小一圈、边缘被切」。
 *   ★ drawable-v24/ic_launcher_foreground.xml 那个矢量图**根本没被引用**
 *     （自适应图标 XML 不存在，没有任何人 @drawable/ic_launcher_foreground）。
 *
 * ★ 问题 2：**所有密度的前景层是同一个文件**
 *   ic_launcher_foreground.png 在 mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi
 *   **五处都是同一份 432×432**（md5 完全相同）。
 *   ★ 后果：
 *     - mdpi 设备（低密度、老设备）加载 432×432 的图 → 内存浪费 9 倍
 *     - 各密度目录存在的意义完全丧失（密度目录本该提供**对应尺寸**的资源）
 *     - 自适应图标前景层应该是 **108dp**：
 *       mdpi=108 / hdpi=162 / xhdpi=216 / xxhdpi=324 / xxxhdpi=432
 *
 * ★★★ 修法 ★★★
 *   ① 按 108dp 生成各密度的 foreground（复用 tools/png-resize.js，零依赖）
 *   ② 生成 mipmap-anydpi-v26/ic_launcher.xml 与 ic_launcher_round.xml
 *      —— 标准自适应图标三层结构：background + foreground
 *   ③ background 用纯色资源（values/ic_launcher_background.xml 已有）
 *   ④ 主图标 ic_launcher.png 保持各密度正确尺寸（已经是对的，只做校验）
 *
 * ★ 关于「前景层尺寸」：
 *   自适应图标前景是 **108dp 画布**，其中中间 **72dp** 是安全区
 *   （系统裁成圆形时不会切到内容）。
 *   ★ 108dp 在各密度下的像素：mdpi 108 / hdpi 162 / xhdpi 216 / xxhdpi 324 / xxxhdpi 432。
 *
 * 用法：node tools/fix-android-icons.js
 */
const fs = require('fs');
const path = require('path');
const { resizePNGFile } = require('./png-resize.js');

const root = path.join(__dirname, '..');
const res = path.join(root, 'app', 'android', 'app', 'src', 'main', 'res');
const SRC = path.join(root, 'assets', 'icon-1024.png');

/* 108dp 前景层在各密度下的像素尺寸 */
const FG = {
  mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432,
};
/* 主图标（legacy）在各密度下的标准尺寸 —— 仅用于校验 */
const LAUNCHER = {
  mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192,
};

console.log('=== 修复 Android 图标资源（V20.8）===\n');

/* ---------- 1. 生成各密度前景层 ---------- */
console.log('· 生成自适应图标前景层（108dp 画布）');
for (const [dpi, size] of Object.entries(FG)) {
  const dir = path.join(res, 'mipmap-' + dpi);
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
  const out = path.join(dir, 'ic_launcher_foreground.png');
  fs.writeFileSync(out, resizePNGFile(SRC, size, size));
  console.log('  ✔ mipmap-' + dpi + '/ic_launcher_foreground.png  ' + size + '×' + size);
}

/* ---------- 2. 生成自适应图标 XML ---------- */
console.log('\n· 生成自适应图标 XML（anydpi-v26）');
const anydpi = path.join(res, 'mipmap-anydpi-v26');
fs.mkdirSync(anydpi, { recursive: true });

/* ★ 标准三层结构：background（纯色）+ foreground（品牌图）★
 * ★ monochrome（Android 13+ 主题图标）——
 *   本项目没有单色版素材，硬塞会得到一个纯色方块，
 *   ★ 所以不提供 monochrome —— 缺省时系统用彩色版，行为正确。 */
const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<!-- V20.8：自适应图标（Android 8.0+ / API 26+）
     ★ 此前 res/ 下没有任何 anydpi 目录 —— Android 8+ 根本用不上自适应图标，
       只能退回 legacy ic_launcher.png 并被系统裁成圆形（图标小一圈、边缘被切）。
     ★ 三层结构：背景纯色 + 前景品牌图，由系统按机型裁切成圆形/方形/水滴形。 -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
fs.writeFileSync(path.join(anydpi, 'ic_launcher.xml'), adaptiveXml);
fs.writeFileSync(path.join(anydpi, 'ic_launcher_round.xml'), adaptiveXml);
console.log('  ✔ mipmap-anydpi-v26/ic_launcher.xml');
console.log('  ✔ mipmap-anydpi-v26/ic_launcher_round.xml');

/* ---------- 3. 校验主图标尺寸 ---------- */
console.log('\n· 校验主图标（legacy）各密度尺寸');
let bad = 0;
for (const [dpi, size] of Object.entries(LAUNCHER)) {
  const f = path.join(res, 'mipmap-' + dpi, 'ic_launcher.png');
  if (!fs.existsSync(f)) {
    console.log('  ✘ mipmap-' + dpi + '/ic_launcher.png 缺失');
    bad++;
    continue;
  }
  const buf = fs.readFileSync(f);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (w !== size || h !== size) {
    console.log('  ✘ mipmap-' + dpi + '/ic_launcher.png 是 ' + w + '×' + h
      + '，应为 ' + size + '×' + size);
    bad++;
  } else {
    console.log('  ✔ mipmap-' + dpi + '/ic_launcher.png  ' + w + '×' + h);
  }
}

console.log('');
console.log(bad === 0 ? '═══════ 图标资源就绪 ═══════' : '═══════ 有 ' + bad + ' 项异常 ═══════');
process.exit(bad === 0 ? 0 : 1);
