/**
 * Release 资产校验（V20.6）
 *
 * ★★ 为什么必须有这个检查 ★★
 *   用户报「安卓版装不上」—— 查下来是 **GitHub Release 上的 APK 是坏的**：
 *   上传时用了 multipart/form-data，而 GitHub 的 asset 上传端点
 *   **不解析 multipart**，把整个请求体（含边界头尾）原样存成了文件。
 *
 * ★★ 为什么这个 bug 极其隐蔽 ★★
 *   · 上传返回 HTTP 201（成功）
 *   · 返回的 size 只比本地大 200 多字节（看着完全正常）
 *   · **unzip -t 能通过**（ZIP 规范允许前置任意数据）——
 *     所以连「完整性检查」都测不出来！
 *   · ★ 只有真正装到手机上才会炸：
 *     「解析包时出现问题」/「应用未安装」
 *
 * ★ 所以必须有一个**下载回来验魔数**的检查 ——
 *   这是唯一能抓住它的办法。
 *
 * 用法：node tools/check-release.js [tag]
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const root = path.join(__dirname, '..');
const TAG = process.argv[2] || 'v1.0.0-android';
const REPO = 'XUANCHENG2024/bubble-tycoon';

let fails = 0, checks = 0;
function check(cond, label) {
  checks++;
  if (cond) { console.log('  ✔ ' + label); return true; }
  fails++;
  console.log('  ✘ ' + label);
  return false;
}

/** 下载（跟随重定向） */
function download(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'bubble-tycoon-checker' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(res.headers.location));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', () => resolve(null));
  });
}

(async () => {
  console.log('=== Release 资产校验（' + TAG + '）===\n');

  const api = 'https://api.github.com/repos/' + REPO + '/releases/tags/' + TAG;
  const rel = await new Promise((resolve) => {
    https.get(api, { headers: { 'User-Agent': 'bubble-tycoon-checker', 'Accept': 'application/vnd.github+json' } },
      res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
      }).on('error', () => resolve(null));
  });

  if (!check(!!rel, '能读到 Release 信息')) {
    process.exit(1);
  }
  console.log('  ' + rel.html_url + '\n');

  const assets = rel.assets || [];
  check(assets.length > 0, '有 ' + assets.length + ' 个资产');

  /* ---------- 逐个资产：下载 → 验魔数 → 验签名结构 ---------- */
  for (const a of assets) {
    console.log('\n--- ' + a.name + ' ---');
    console.log('  GitHub 记录大小: ' + a.size + ' 字节');

    const buf = await download(a.browser_download_url);
    if (!check(!!buf, '下载成功')) continue;

    check(buf.length === a.size,
      '下载大小与 GitHub 记录一致（' + buf.length + '）');

    /* ★★★ 关键检查：ZIP 魔数 ★★★
       APK 与 AAB 本质都是 ZIP，必须以 'PK'（0x50 0x4B）开头。
       ★ 若是 multipart 混进来的坏文件，这里就会看到 '-'（0x2D）。 */
    const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4B;
    check(isZip,
      '★ 文件头是 PK（ZIP 魔数）'
      + (isZip ? '' : ' —— 实际是 ' + buf.slice(0, 6).toString('hex')
        + '，★ multipart 边界混进文件了，手机会装不上'));

    if (!isZip) {
      /* ★ 给出诊断：把开头那段打出来，让人一眼看出是边界头 */
      console.log('    · 开头 80 字节:');
      console.log('      ' + JSON.stringify(buf.slice(0, 80).toString('latin1')));
      continue;
    }

    /* APK 特有的结构检查 */
    if (/\.apk$/i.test(a.name)) {
      /* AndroidManifest.xml 必须存在 */
      check(hasEntry(buf, 'AndroidManifest.xml'), '含 AndroidManifest.xml');
      check(hasEntry(buf, 'classes.dex'), '含 classes.dex');
      /* ★ 游戏资源必须在（Capacitor 把 web 产物放在 assets/public/） */
      check(hasEntry(buf, 'assets/public/bundle.js'), '含 assets/public/bundle.js（游戏内容）');
      check(hasEntry(buf, 'assets/public/index.html'), '含 assets/public/index.html');
      /* 签名块必须存在（META-INF/*.RSA|.DSA|.EC） */
      check(hasEntry(buf, 'META-INF/CERT.RSA') || hasEntry(buf, 'META-INF/')
        || hasEntry(buf, 'META-INF'), '含签名元数据（META-INF）');
    }
    if (/\.aab$/i.test(a.name)) {
      check(hasEntry(buf, 'BundleConfig.pb'), '含 BundleConfig.pb（AAB 标志文件）');
      check(hasEntry(buf, 'base/manifest/AndroidManifest.xml')
        || hasEntry(buf, 'base/'), '含 base/ 模块');
    }
  }

  console.log('');
  if (fails === 0) {
    console.log('✔ Release 资产全部有效（' + checks + ' 项）');
    setTimeout(() => process.exit(0), 40);
  } else {
    console.log('✘ ' + fails + ' 项有问题 / 共 ' + checks + ' 项');
    console.log('  ★ 若报「文件头不是 PK」，用这个命令重新上传：');
    console.log('    node tools/upload-release.js ' + TAG + ' <文件>');
    setTimeout(() => process.exit(1), 40);
  }
})();

/** ★ 读 ZIP 中央目录（不整体解压，够用且快） */
function hasEntry(buf, name) {
  /* ZIP 中央目录在文件尾部，EOCD 签名 0x06054b50 */
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) return false;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length) return false;
    if (buf.readUInt32LE(off) !== 0x02014b50) return false;
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const entryName = buf.slice(off + 46, off + 46 + nameLen).toString('utf8');
    if (entryName === name) return true;
    /* 前缀匹配（目录） */
    if (name.endsWith('/') && entryName.indexOf(name) === 0) return true;
    off += 46 + nameLen + extraLen + commentLen;
  }
  return false;
}