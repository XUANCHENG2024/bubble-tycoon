/**
 * 上传构建产物到 GitHub Release（V20.5）
 *
 * ★ 为什么不用 curl -F：
 *   实测 curl -F 上传 6MB 的 APK 时 GitHub 返回
 *     422 "Bad Size"
 *   ★ 而用 --data-binary 又是 400 "Multipart form data required"
 *     —— GitHub 的 upload API 只接受 multipart，
 *       但 curl 生成的 multipart 在这个环境下没被正确识别。
 *   ★ 所以这里手写 multipart —— 边界、头、Content-Length 全自己控制，
 *     不依赖 curl 的实现细节。
 *
 * 用法：node tools/upload-release.js <tag> <文件…>
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');

/* ★ 从 git credential 取 token（不硬编码、不进环境变量） */
function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8',
  });
  const m = out.match(/^password=(.+)$/m);
  return m ? m[1].trim() : null;
}

const tag = process.argv[2];
const files = process.argv.slice(3);
if (!tag || !files.length) {
  console.error('用法：node tools/upload-release.js <tag> <文件…>');
  process.exit(2);
}

const token = getToken();
if (!token) { console.error('✘ 拿不到 GitHub token'); process.exit(1); }

const REPO = 'XUANCHENG2024/bubble-tycoon';
const API = 'https://api.github.com';

function api(p, opts) {
  /* ★ opts 可能没传 —— 之前忘了给默认值，
     导致 'Cannot read properties of undefined' */
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const req = https.request(API + p, {
      method: opts.method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'bubble-tycoon-builder',
        ...(opts.headers || {}),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch (e) { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

(async () => {
  /* ---------- ① 拿 upload_url ---------- */
  const rel = await api('/repos/' + REPO + '/releases/tags/' + encodeURIComponent(tag));
  if (!rel.body || !rel.body.upload_url) {
    console.error('✘ 拿不到 upload_url：' + JSON.stringify(rel.body).slice(0, 200));
    process.exit(1);
  }
  const uploadBase = rel.body.upload_url.replace(/\{.*\}$/, '');
  console.log('✔ Release: ' + rel.body.html_url);

  /* ---------- ② 逐个上传 ---------- */
  for (const f of files) {
    const full = path.isAbsolute(f) ? f : path.join(root, f);
    if (!fs.existsSync(full)) { console.error('  ✘ 不存在: ' + f); continue; }
    const buf = fs.readFileSync(full);
    const name = path.basename(f);

    /* ★ 手写 multipart ——
       curl -F 在这个环境下报 "Bad Size"（GitHub 侧），
       所以边界自己画。 */
    const boundary = '----bubble' + Date.now().toString(16) + Math.random().toString(16).slice(2);
    const head = Buffer.from(
      '--' + boundary + '\r\n'
      + 'Content-Disposition: form-data; name="file"; filename="' + name + '"\r\n'
      + 'Content-Type: application/octet-stream\r\n\r\n', 'utf8');
    const tail = Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8');
    const body = Buffer.concat([head, buf, tail]);

    console.log('· 上传 ' + name + '（' + (buf.length / 1048576).toFixed(2) + ' MB）…');

    const res = await new Promise((resolve, reject) => {
      const u = new URL(uploadBase + '?name=' + encodeURIComponent(name));
      const req = https.request(u, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'bubble-tycoon-builder',
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
          /* ★ Content-Length 必须显式给 ——
             GitHub 靠它判断大小，给了 chunked 就会当成 "Bad Size"。 */
          'Content-Length': String(body.length),
        },
      }, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => resolve({ status: r.statusCode, body: d }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    if (res.status >= 200 && res.status < 300) {
      let size = '';
      try { size = JSON.parse(res.body).size; } catch (e) { }
      console.log('  ✔ ' + name + ' 上传成功'
        + (size ? '（' + (size / 1048576).toFixed(2) + ' MB）' : ''));
    } else {
      console.error('  ✘ ' + name + ' → HTTP ' + res.status + ' ' + res.body.slice(0, 200));
    }
  }

  /* ---------- ③ 确认 ---------- */
  const rel2 = await api('/repos/' + REPO + '/releases/tags/' + encodeURIComponent(tag));
  console.log('');
  console.log('★ Release 资产：');
  for (const a of (rel2.body.assets || [])) {
    console.log('  ' + a.name + '  ' + (a.size / 1048576).toFixed(2) + ' MB  '
      + a.browser_download_url);
  }
})();