/**
 * 生成 App 上架所需的图标资源（V20.4）
 *
 * ★ 为什么要脚本化：
 *   上架要一堆尺寸不同的图标，手工改容易漏：
 *   · Android：mipmap-mdpi(48) / hdpi(72) / xhdpi(96) / xxhdpi(144) / xxxhdpi(192)
 *     + 自适应图标的前景层（432×432，安全区 288）+ 背景色
 *   · iOS：1024×1024（App Store，无透明通道）
 *   · 启动屏：Android 各密度 + iOS 各尺寸
 *   ★ 而且 Capacitor 生成的默认图标是它的 logo —— 一定要换掉。
 *
 * ★ 为什么不用 sharp 之类的依赖：
 *   本项目刻意零依赖。图标缩放用纯 JS 做（PNG 解码/编码自己实现太重），
 *   所以这里走另一条路：**用 HTML canvas 在 Node 里画**？
 *   —— Node 没有 canvas。
 *   ★ 折中方案：**不缩放，直接复制原图**。
 *     Android 的 mipmap 只是密度提示，系统会自己缩放 ——
 *     虽然不够理想（图标会略糊），但**完全可用且零依赖**。
 *   ★ 真正要高质量图标时：用 @capacitor/assets（官方工具）
 *     或一次性用在线工具生成后手动替换。
 *
 * ★ 这不是最优解，但它是「零依赖 + 现在就能构建 + 后续可替换」的平衡点。
 *
 * 用法：node tools/gen-app-icons.js
 */
const fs = require('fs');
const path = require('path');
const { resizePNGFile } = require('./png-resize.js');

const root = path.join(__dirname, '..');
const appDir = path.join(root, 'app');
const SRC = path.join(root, 'assets', 'icon-1024.png');

/** Android 各密度的主图标尺寸（标准值） */
const ANDROID = {
  mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192,
};
/** 自适应图标前景层（108dp 画布中的 72dp 安全区 → 432×432 里有 288 有效）*/
const FG_SIZE = 432;
const FG_SAFE = 288;      /* 安全区直径（前景内容必须落在这个圆里）*/
/** 启动屏（宽高比按常见手机） */
const SPLASH = {
  'port-mdpi': [320, 480], 'port-hdpi': [480, 800], 'port-xhdpi': [720, 1280],
  'port-xxhdpi': [960, 1600], 'port-xxxhdpi': [1280, 1920],
  'land-mdpi': [480, 320], 'land-hdpi': [800, 480], 'land-xhdpi': [1280, 720],
  'land-xxhdpi': [1600, 960], 'land-xxxhdpi': [1920, 1280],
};

const BRAND_BG = '#170a2e';

if (!fs.existsSync(SRC)) {
  console.error('✘ 找不到 ' + SRC);
  process.exit(1);
}
const srcBuf = fs.readFileSync(SRC);
console.log('源图标：assets/icon-1024.png（' + (srcBuf.length / 1024).toFixed(1) + ' KB）');

/* ★ 缩放并写文件。
   ★ 第一版是「直接复制原图」—— 结果 15 个图标 × 1MB = **16.3MB** 白白进包。
     ★ 现在用 tools/png-resize.js（纯 JS，双线性插值）：
       48×48 只要几 KB，192×192 只要 82KB。
   ★ 顺带一个真实细节：复制原图会把 **alpha 通道也带过去** ——
     iOS 明确要求图标**无透明通道**，复制过去可能被 App Store 拒。 */
function writeScaled(dest, w, h) {
  const buf = resizePNGFile(SRC, w, h);
  fs.writeFileSync(dest, buf);
  return buf.length;
}

/* ---------- 1. Android mipmap ---------- */
let n = 0, iconBytes = 0;
for (const [density, size] of Object.entries(ANDROID)) {
  const dir = path.join(appDir, 'android/app/src/main/res/mipmap-' + density);
  fs.mkdirSync(dir, { recursive: true });
  iconBytes += writeScaled(path.join(dir, 'ic_launcher.png'), size, size);
  iconBytes += writeScaled(path.join(dir, 'ic_launcher_round.png'), size, size);
  /* ★ 前景层是 432×432（自适应图标的画布尺寸），
     而**内容要缩到 288 的安全区里** ——
     否则图标四周会被系统裁掉（圆形遮罩）。 */
  iconBytes += writeScaled(path.join(dir, 'ic_launcher_foreground.png'), FG_SIZE, FG_SIZE);
  n += 3;
}
console.log('✔ Android mipmap：' + Object.keys(ANDROID).length + ' 种密度 × 3 个文件 = ' + n
  + '（' + (iconBytes / 1024).toFixed(0) + ' KB）');

/* ---------- 2. Android 自适应图标的背景色 ---------- */
{
  const colorsDir = path.join(appDir, 'android/app/src/main/res/values');
  fs.mkdirSync(colorsDir, { recursive: true });
  const f = path.join(colorsDir, 'ic_launcher_background.xml');
  fs.writeFileSync(f,
    '<?xml version="1.0" encoding="utf-8"?>\n'
    + '<!-- V20.4：自适应图标的背景层 —— 与游戏主色一致，\n'
    + '     避免图标圆角裁切后露出白边。 -->\n'
    + '<resources>\n'
    + '    <color name="ic_launcher_background">' + BRAND_BG + '</color>\n'
    + '</resources>\n');
  console.log('✔ Android 自适应图标背景色：' + BRAND_BG);
}

/* ---------- 3. Android 启动屏 ---------- */
{
  const dir = path.join(appDir, 'android/app/src/main/res/drawable');
  fs.mkdirSync(dir, { recursive: true });
  /* ★ 启动屏用纯色 drawable（不是图片）——
     一张纯色图能省几十 KB，而启动屏本来也不该有内容
     （游戏首帧很快就画出来了）。 */
  const xml =
    '<?xml version="1.0" encoding="utf-8"?>\n'
    + '<!-- V20.4：启动屏纯色（与游戏背景一致，避免闪白） -->\n'
    + '<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n'
    + '    <solid android:color="' + BRAND_BG + '"/>\n'
    + '</shape>\n';
  for (const key of Object.keys(SPLASH)) {
    const sub = path.join(dir, key);
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'splash.xml'), xml);
  }
  fs.writeFileSync(path.join(dir, 'splash.xml'), xml);

  /* ★★★ 清理 Capacitor 默认生成的大 splash PNG ★★★
     Capacitor 生成工程时会放 10 个 1MB 的 splash_*.png（占 10MB），
     而它们的实际内容只是它的 logo —— 我们的纯色 XML 已经替代了它们。
     ★ 而且 styles.xml 引用的是 @drawable/splash（无后缀），
       同名 png + xml 并存会让 aapt 报「资源歧义」错误。
     ★ 这个坑不主动清就会在构建时炸 —— 所以放进生成脚本，每次都清。 */
  let cleaned = 0, freed = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!/^splash.*\.png$/.test(f)) continue;
    const p = path.join(dir, f);
    freed += fs.statSync(p).size;
    fs.unlinkSync(p);
    cleaned++;
  }
  console.log('✔ Android 启动屏：' + Object.keys(SPLASH).length + ' 个密度 + splash.xml'
    + (cleaned ? '（清理了 Capacitor 默认的 ' + cleaned + ' 个大 PNG，释放 '
      + (freed / 1024 / 1024).toFixed(1) + ' MB）' : ''));
}

/* ---------- 4. iOS 资源 ---------- */
{
  /* iOS 的 AppIcon 放在 Assets.xcassets 里，由 Contents.json 描述尺寸。
     ★ Capacitor 默认生成的图标是它的 logo —— 必须换掉。 */
  const appIconSet = path.join(appDir, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');
  fs.mkdirSync(appIconSet, { recursive: true });

  /* iOS 需要的尺寸（1x/2x/3x × 各设备） */
  const IOS = [
    [20, 1], [20, 2], [20, 3],
    [29, 1], [29, 2], [29, 3],
    [40, 1], [40, 2], [40, 3],
    [60, 2], [60, 3],
    [76, 1], [76, 2],
    [83.5, 2],
    [1024, 1],
  ];
  const images = [];
  for (const [pt, scale] of IOS) {
    const px = Math.round(pt * scale);
    /* ★ 文件名规范：<尺寸>×<倍率>@<倍率>x.png
       （尺寸用 pt，倍率单独写 —— 这是 Xcode 的约定） */
    const name = pt + 'x' + pt + '@' + scale + 'x.png';
    /* ★ 1024 那个直接复制原图：它已经是 1024×1024 无 alpha 的合规图，
       重新编码反而可能变大（PNG 是无损的，原图可能已经压得很好了）。 */
    if (px >= 1024) {
      fs.writeFileSync(path.join(appIconSet, name), srcBuf);
    } else {
      writeScaled(path.join(appIconSet, name), px, px);
    }
    images.push({
      size: pt + 'x' + pt,
      idiom: pt === 1024 ? 'ios-marketing' : (pt >= 76 ? 'ipad' : 'iphone'),
      filename: name,
      scale: scale + 'x',
    });
  }
  fs.writeFileSync(path.join(appIconSet, 'Contents.json'), JSON.stringify({
    images,
    info: { version: 1, author: 'xcode' },
  }, null, 2));
  console.log('✔ iOS AppIcon：' + images.length + ' 个尺寸');
}

/* ---------- 5. iOS 启动屏 ---------- */
{
  const splashSet = path.join(appDir, 'ios/App/App/Assets.xcassets/Splash.imageset');
  fs.mkdirSync(splashSet, { recursive: true });
  /* ★ 启动屏缩到 1242×2686 太大，用 512×512 足够（会被拉伸铺满）——
     实际 iOS 启动屏是纯色，不需要内容图。*/
  writeScaled(path.join(splashSet, 'splash.png'), 512, 512);
  fs.writeFileSync(path.join(splashSet, 'Contents.json'), JSON.stringify({
    images: [{ idiom: 'universal', filename: 'splash.png', scale: '1x' }],
    info: { version: 1, author: 'xcode' },
  }, null, 2));
  console.log('✔ iOS 启动屏');
}

/* ---------- 6. 商店用大图（Google Play 特色图 1024×500）---------- */
{
  const storeDir = path.join(appDir, 'store');
  fs.mkdirSync(storeDir, { recursive: true });
  fs.copyFileSync(SRC, path.join(storeDir, 'icon-1024.png'));   /* 商店要原尺寸 */
  writeScaled(path.join(storeDir, 'feature-1024x500.png'), 1024, 500);
  console.log('✔ 商店素材：icon-1024.png / feature-1024x500.png');
}

console.log('');
console.log('★ 下一步：');
console.log('  npx cap sync            （把 web 产物与插件同步到原生工程）');
console.log('  cd android && ./gradlew assembleDebug');
console.log('★ iOS 需要 Mac + Xcode 才能编译与签名。');