/**
 * Android 构建脚本（V20.5）
 *
 * ★ 为什么需要这个脚本：
 *   Android 构建要三样东西（JDK / SDK / Gradle），每次手工配环境变量很啰嗦，
 *   而且**很容易配错版本**（JDK 11 会构建失败、SDK 34 会被 AGP 拒绝）。
 *   ★ 这个脚本把版本固定下来，并且**检查前置条件**，
 *     缺什么就明确说缺什么 —— 而不是让 Gradle 报一堆看不懂的错。
 *
 * ★ 工具链放在项目**外**（默认 D:/tools/android-build）——
 *   JDK 有 300MB、SDK 有 2GB，绝不该进版本库。
 *
 * 用法：
 *   node tools/build-android.js            # 构建调试包（APK）
 *   node tools/build-android.js --release  # 构建上架包（AAB）
 *   node tools/build-android.js --check    # 只检查环境
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const root = path.join(__dirname, '..');
const appDir = path.join(root, 'app');
const androidDir = path.join(appDir, 'android');

/* ★ 工具链位置 —— 放项目外，绝不入库 */
const TOOLS = process.env.ANDROID_BUILD_TOOLS
  || (process.platform === 'win32' ? 'D:/tools/android-build' : '/opt/android-build');

const JDK_VER = '21';
const SDK_VER = '35';
const BUILD_TOOLS_VER = '35.0.0';

/* ★★ 为什么是 21 而不是 17 ★★
   实测踩坑：用 JDK 17 构建，Gradle 走到 Java 编译阶段才失败：
     「无效的目标发行版: 21」
   ★ 根因：@capacitor/android 7.1.2 的 build.gradle 里写的是
       sourceCompatibility JavaVersion.VERSION_21
       targetCompatibility JavaVersion.VERSION_21
   ★ 而 AGP 8.7.2 + Gradle 8.11.1 都支持 Java 21，所以直接用 21 即可。
   ★ 教训：Capacitor 的 Java 版本要求藏在 node_modules 里，
     不看它的 build.gradle 就会猜错（我一开始按惯例写了 17）。 */

/* ---------- 找可执行文件 ---------- */
function which(cmd) {
  try {
    const out = execSync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split(/\r?\n/).filter(Boolean)[0] || null;
  } catch (e) { return null; }
}

/** 在工具目录里找 JDK（优先版本匹配的） */
function findJDK() {
  /* ① 环境变量 */
  if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME;
  }
  /* ② 系统 PATH 里的 java（看版本对不对）*/
  const javaBin = which('java');
  if (javaBin) {
    const home = path.resolve(path.dirname(javaBin), '..');
    try {
      const v = execSync('java -version 2>&1', { encoding: 'utf8' });
      if (v.indexOf('"' + JDK_VER) >= 0) return home;
    } catch (e) { }
  }
  /* ③ 我们下载的工具目录 —— ★ 优先选版本匹配的，
     否则会拿到 jdk-17 而构建失败（报错是中文乱码的「无效的目标发行版: 21」）。*/
  if (fs.existsSync(TOOLS)) {
    const dirs = fs.readdirSync(TOOLS).filter(d => /jdk/i.test(d));
    /* 先找版本号匹配的 */
    const exact = dirs.filter(d => d.indexOf('-' + JDK_VER + '.') >= 0 || d.indexOf('jdk' + JDK_VER) >= 0);
    for (const d of exact.concat(dirs)) {
      const home = path.join(TOOLS, d);
      if (fs.existsSync(path.join(home, 'bin', 'java.exe'))
        || fs.existsSync(path.join(home, 'bin', 'java'))) {
        return home;
      }
    }
  }
  return null;
}

function findSDK() {
  if (process.env.ANDROID_HOME && fs.existsSync(process.env.ANDROID_HOME)) return process.env.ANDROID_HOME;
  if (process.env.ANDROID_SDK_ROOT && fs.existsSync(process.env.ANDROID_SDK_ROOT)) return process.env.ANDROID_SDK_ROOT;
  if (fs.existsSync(path.join(TOOLS, 'android-sdk'))) return path.join(TOOLS, 'android-sdk');
  return null;
}

/* ---------- 环境检查 ---------- */
const env = {
  jdk: findJDK(),
  sdk: findSDK(),
};

function status() {
  console.log('=== Android 构建环境 ===\n');
  console.log('  JDK        : ' + (env.jdk || '✘ 未找到（需要 JDK ' + JDK_VER + '）'));
  console.log('  Android SDK: ' + (env.sdk || '✘ 未找到（需要 platform ' + SDK_VER + '）'));
  console.log('  工具目录    : ' + TOOLS);
  console.log('  Node       : ' + process.version);

  /* ★ 检查 SDK 里该有的组件 */
  if (env.sdk) {
    const p = path.join(env.sdk, 'platforms', 'android-' + SDK_VER);
    const bt = path.join(env.sdk, 'build-tools');
    console.log('  platform-' + SDK_VER + ': ' + (fs.existsSync(p) ? '✔' : '✘ 缺（sdkmanager 装）'));
    console.log('  build-tools : ' + (fs.existsSync(bt) ? '✔ ' + fs.readdirSync(bt).join(',') : '✘ 缺'));
  }
  /* Gradle wrapper 自带，不用另装 */
  console.log('  Gradle      : wrapper 自带（8.11.1，自动下载）');
  console.log('');
  return !!(env.jdk && env.sdk);
}

if (process.argv.includes('--check')) {
  process.exit(status() ? 0 : 1);
}

/* ---------- 构建 ---------- */
if (!status()) {
  console.error('✘ 环境不完整。');
  console.error('');
  console.error('  安装方式（Windows）：');
  console.error('    1. JDK ' + JDK_VER + '：');
  console.error('       curl -L -o jdk17.zip "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse"');
  console.error('       （解压到 ' + TOOLS + '，目录名建议 jdk17）');
  console.error('    2. Android SDK：');
  console.error('       curl -L -o cmdline-tools.zip "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"');
  console.error('       （解压后把 cmdline-tools 移到 android-sdk/cmdline-tools/latest）');
  console.error('       然后 sdkmanager "platforms;android-' + SDK_VER + '" "build-tools;' + BUILD_TOOLS_VER + '" "platform-tools"');
  console.error('    3. 或直接用 Android Studio（自带 JDK 与 SDK）');
  console.error('');
  console.error('  装好后重跑本脚本。');
  process.exit(1);
}

/* ★ 同步 web 产物到原生工程 —— 不做这步构建出来的是旧内容 */
console.log('· 同步 web 产物到原生工程');
execFileSync('npx', ['cap', 'sync', 'android'], {
  cwd: appDir, stdio: 'inherit', shell: process.platform === 'win32',
});

/* ★ 写 local.properties（告诉 Gradle SDK 在哪）——
   这个文件**不能进版本库**（每台机器路径不同），
   而 app/.gitignore 里已经排除了它。 */
const lp = path.join(androidDir, 'local.properties');
fs.writeFileSync(lp,
  'sdk.dir=' + env.sdk.replace(/\\/g, '\\\\') + '\n'
  + '# 本文件由 tools/build-android.js 生成（每台机器路径不同，故不入库）\n');
console.log('· 已写 local.properties');

/* ---------- 跑 Gradle ---------- */
const isRelease = process.argv.includes('--release');
const task = isRelease ? 'bundleRelease' : 'assembleDebug';

const gradlew = path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const gradleEnv = {
  ...process.env,
  JAVA_HOME: env.jdk,
  ANDROID_HOME: env.sdk,
  ANDROID_SDK_ROOT: env.sdk,
  /* ★ Gradle 在 Windows 上路径含空格会出问题 */
  GRADLE_OPTS: '-Dorg.gradle.jvmargs=-Xmx2048m',
};

console.log('');
console.log('▶ gradlew ' + task + ' …');
console.log('');

try {
  execFileSync(gradlew, [task, '--no-daemon'], {
    cwd: androidDir,
    stdio: 'inherit',
    env: gradleEnv,
    shell: process.platform === 'win32',
  });
} catch (e) {
  console.error('');
  console.error('✘ 构建失败。常见原因：');
  console.error('  · 缺少 SDK 组件 → sdkmanager "platforms;android-' + SDK_VER + '" "build-tools;' + BUILD_TOOLS_VER + '"');
  console.error('  · 网络不通 → Gradle 要下载依赖，加 --offline 或配镜像');
  console.error('  · JDK 版本不对 → 必须是 ' + JDK_VER);
  process.exit(1);
}

/* ---------- 产物 ---------- */
const outDir = isRelease
  ? path.join(androidDir, 'app/build/outputs/bundle/release')
  : path.join(androidDir, 'app/build/outputs/apk/debug');
console.log('');
console.log('✔ 构建完成');
if (fs.existsSync(outDir)) {
  for (const f of fs.readdirSync(outDir)) {
    const st = fs.statSync(path.join(outDir, f));
    if (st.isFile() && (f.endsWith('.apk') || f.endsWith('.aab'))) {
      console.log('  ' + path.join(outDir, f) + '  (' + (st.size / 1024 / 1024).toFixed(2) + ' MB)');
    }
  }
}
