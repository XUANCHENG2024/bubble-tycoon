/**
 * 解压并安装 Android 构建工具链（V20.5）
 *
 * ★ 为什么写脚本而不是手工敲命令：
 *   sdkmanager 有几个**必须做对否则后面全崩**的细节：
 *   ① 必须先接受 licenses（否则安装 SDK 时交互式提问，CI/脚本里会卡住）
 *   ② cmdline-tools 必须在 android-sdk/cmdline-tools/latest/ 下
 *      （放错位置 sdkmanager 找不到自己）
 *   ③ JAVA_HOME 必须指向 JDK 17
 *   ★ 这些坑每一个都会让人卡半小时，而脚本一次就做对。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const TOOLS = process.env.ANDROID_BUILD_TOOLS || 'D:/tools/android-build';
const SDK = path.join(TOOLS, 'android-sdk');
const SDK_VER = '35';
const BUILD_TOOLS = '35.0.0';

function run(cmd, args, opts) {
  console.log('▶ ' + cmd + ' ' + args.join(' '));
  execFileSync(cmd, args, { stdio: 'inherit', shell: true, ...opts });
}

/* ---------- 1. 解压 JDK ---------- */
function findJDKDir() {
  if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME;
  for (const d of fs.readdirSync(TOOLS)) {
    if (!/^jdk/i.test(d)) continue;
    const p = path.join(TOOLS, d);
    if (fs.existsSync(path.join(p, 'bin', 'java.exe'))) return p;
  }
  return null;
}

if (!fs.existsSync(path.join(TOOLS, 'jdk17.zip'))) {
  console.error('✘ 找不到 jdk17.zip');
  process.exit(1);
}
if (!findJDKDir()) {
  console.log('· 解压 JDK…');
  run('powershell', ['-NoProfile', '-Command',
    `Expand-Archive -Path "${path.join(TOOLS, 'jdk17.zip')}" -DestinationPath "${TOOLS}" -Force`]);
}
const jdk = findJDKDir();
if (!jdk) { console.error('✘ JDK 解压失败'); process.exit(1); }
console.log('✔ JDK: ' + jdk);

/* ---------- 2. 解压 cmdline-tools ---------- */
const sdkBin = path.join(SDK, 'cmdline-tools', 'latest', 'bin');
if (!fs.existsSync(sdkBin)) {
  console.log('· 解压 cmdline-tools…');
  const tmp = path.join(TOOLS, '_cmdline-tmp');
  fs.rmSync(tmp, { recursive: true, force: true });
  run('powershell', ['-NoProfile', '-Command',
    `Expand-Archive -Path "${path.join(TOOLS, 'cmdline-tools.zip')}" -DestinationPath "${tmp}" -Force`]);
  /* ★ 官方 zip 里是 cmdline-tools/ 一层，
     而 sdkmanager 要求它在 cmdline-tools/latest/ 下 —— 要挪一层。 */
  fs.mkdirSync(path.join(SDK, 'cmdline-tools'), { recursive: true });
  fs.renameSync(path.join(tmp, 'cmdline-tools'), path.join(SDK, 'cmdline-tools', 'latest'));
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (!fs.existsSync(sdkBin)) { console.error('✘ cmdline-tools 解压失败'); process.exit(1); }
console.log('✔ cmdline-tools: ' + sdkBin);

/* ---------- 3. 装 SDK 组件 ---------- */
const env = { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: SDK, ANDROID_SDK_ROOT: SDK };
const sdkmanager = path.join(sdkBin, 'sdkmanager.bat');

console.log('· 接受 licenses…');
try {
  execFileSync(sdkmanager, ['--licenses'], {
    stdio: ['pipe', 'ignore', 'ignore'], env, shell: true,
    input: 'y\n'.repeat(50),
  });
} catch (e) { /* 非致命：下面装组件时还会再问 */ }

console.log('· 安装 SDK 组件（platform 35 / build-tools 35 / platform-tools）…');
try {
  execFileSync(sdkmanager, [
    'platforms;android-' + SDK_VER,
    'build-tools;' + BUILD_TOOLS,
    'platform-tools',
  ], { stdio: 'inherit', env, shell: true });
} catch (e) {
  console.error('✘ SDK 组件安装失败（检查网络）');
  process.exit(1);
}

console.log('');
console.log('✔ 工具链就绪');
console.log('  JAVA_HOME=' + jdk);
console.log('  ANDROID_HOME=' + SDK);
console.log('');
console.log('★ 现在可以构建：');
console.log('  node tools/build-android.js');
