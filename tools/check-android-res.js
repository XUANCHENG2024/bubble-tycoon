/**
 * Android 资源文件合法性检查（V20.7）
 *
 * ★ 为什么需要：
 *   我在 AndroidManifest.xml 里加注释时踩了个坑 ——
 *   **XML 标签内部不允许插注释**（`<activity ... <!-- 注释 --> attr="x">`），
 *   ★ 而 Gradle 的报错是：
 *     `Error parsing .../AndroidManifest.xml`
 *     —— **不告诉你是哪一行**（只说 "ManifestMerger2$MergeFailureException"）。
 *   ★ 于是我得用 Python 的 XML 解析器反查才定位到。
 *
 * ★ 而且这类错误只在**构建时**暴露 —— 改了 Manifest 却没构建就提交了，
 *   CI 才会红。
 *
 * 用法：node tools/check-android-res.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const appDir = path.join(root, 'app');

let fails = 0, checks = 0;
function check(cond, label) {
  checks++;
  if (cond) { console.log('  ✔ ' + label); return true; }
  fails++;
  console.log('  ✘ ' + label);
  return false;
}

console.log('=== Android 资源检查 ===\n');

/* ---------- ① XML 合法性（用 Python 的解析器，它会报行号）---------- */
console.log('--- ① XML 合法性 ---');
const xmlFiles = [];
(function walk(dir, base) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      /* 跳过构建产物与依赖目录 */
      if (/build|\.gradle|node_modules/.test(p)) continue;
      walk(p, base ? base + '/' + f : f);
    } else if (/\.xml$/.test(f)) {
      xmlFiles.push(p);
    }
  }
})(path.join(appDir, 'android', 'app', 'src', 'main'), '');

check(xmlFiles.length > 0, '找到 ' + xmlFiles.length + ' 个 XML 文件');

for (const f of xmlFiles) {
  const rel = path.relative(root, f).replace(/\\/g, '/');
  let ok = true, err = '';
  try {
    /* Python 的 ElementTree 会报**准确的行列**，比 Gradle 有用得多。 */
    execFileSync('python', ['-c', `
import sys, xml.etree.ElementTree as ET
try:
    ET.parse(sys.argv[1])
except Exception as e:
    print(e); sys.exit(1)
`, f], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    ok = false;
    err = (e.stdout || Buffer.alloc(0)).toString().trim()
      || (e.stderr || Buffer.alloc(0)).toString().trim();
  }
  check(ok, rel + (ok ? '' : ' → ' + err.slice(0, 110)));
}

/* ---------- ② Manifest 关键项 ---------- */
console.log('\n--- ② Manifest 关键项 ---');
{
  const mf = path.join(appDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  if (fs.existsSync(mf)) {
    const s = fs.readFileSync(mf, 'utf8');
    check(/android:screenOrientation="unspecified"/.test(s),
      '允许横屏（screenOrientation=unspecified）');
    check(!/android:screenOrientation="portrait"/.test(s),
      '未锁死竖屏（Google Play 大屏适配要求）');
    check(/configChanges="[^"]*screenSize/.test(s),
      'configChanges 含 screenSize（旋转时 Activity 不重建 → 依赖 JS 的 resize 处理）');
    check(/android:configChanges="[^"]*orientation/.test(s),
      'configChanges 含 orientation');
    /* ★ 权限：只应有 VIBRATE 与 WAKE_LOCK */
    const perms = [...s.matchAll(/uses-permission android:name="([^"]+)"/g)].map(m => m[1]);
    check(perms.indexOf('android.permission.INTERNET') < 0,
      '未申请 INTERNET（游戏完全离线）');
    check(perms.length <= 2, '权限数 ≤ 2（实际 ' + perms.length + '：' + perms.join(', ') + '）');
    /* ★ 标签内部不能有注释 —— 这是我踩过的坑 */
    check(!/<[^>]*<!--/.test(s), '标签内部没有注释（XML 不允许）');
  } else {
    check(false, 'AndroidManifest.xml 存在');
  }
}

/* ---------- ③ Java 源文件 ---------- */
console.log('\n--- ③ Java 源文件 ---');
{
  const jdir = path.join(appDir, 'android', 'app', 'src', 'main', 'java');
  const jf = [];
  (function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.java')) jf.push(p);
    }
  })(jdir);
  check(jf.length >= 2, '找到 ' + jf.length + ' 个 Java 文件');
  for (const f of jf) {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    const s = fs.readFileSync(f, 'utf8');
    /* ★ 大括号配平（快速筛掉明显的语法破坏） */
    let depth = 0, bad = false;
    for (const ch of s) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth < 0) { bad = true; break; } }
    }
    check(!bad && depth === 0, rel + ' 大括号配平');
  }
}

console.log('');
if (fails === 0) {
  console.log('✔ Android 资源全部合法（' + checks + ' 项）');
  setTimeout(() => process.exit(0), 40);
} else {
  console.log('✘ ' + fails + ' 项有问题 / 共 ' + checks + ' 项');
  setTimeout(() => process.exit(1), 40);
}