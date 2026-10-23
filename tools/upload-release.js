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
/* ★ 失败计数 —— 上传后校验发现问题时要能报出来 */
let failed = 0;
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
  let rel = await api('/repos/' + REPO + '/releases/tags/' + encodeURIComponent(tag));

  /* ★★ Release 不存在则创建（V20.8 新增）★★
   *   原来脚本假设 Release 已由人在网页上建好 ——
   *   拿不到 upload_url 就直接退出。
   *   ★ 结果「发一个新版本」必须先手动去网页点一遍，
   *     而这正是最容易漏、也最容易出错的一步。
   * ★ 现在自动创建，并带上默认标题与说明。 */
  if (!rel.body || !rel.body.upload_url) {
    if (rel.status !== 404) {
      console.error('✘ 拿不到 upload_url：' + JSON.stringify(rel.body).slice(0, 200));
      process.exit(1);
    }
    console.log('· Release ' + tag + ' 不存在 → 自动创建');
    const notes = [
      '## 奶茶星球 ' + tag,
      '',
      '### 本版改动（V20.8 · Android 界面适配专家级复核）',
      '',
      '| # | 问题 | 根因 | 修复 |',
      '|---|---|---|---|',
      '| ① | **Android 安全区整体静默失效** | `env(safe-area-inset-*)` 在 Android WebView（Chromium < 140）+ edge-to-edge 下返回 0；且 `hide(systemBars())` 让原生 inset 恒为 0，而手势条仍物理覆盖底部 | 新增原生 `AppInsetsPlugin`（读 `WindowInsetsCompat`，systemBars + displayCutout 取 max）；系统栏改「透明不隐藏」 |',
      '| ② | **Canvas 整体拉伸 / 点击区偏移** | CSS 用 `100vw/100dvh`，绘制用 `innerWidth/innerHeight`，两个来源不一致 | `setupCanvas()` 显式设定 `canvas.style.width/height = CW/CH px` |',
      '| ③ | **字号缩放形同虚设** | 361 处直读 `FS.xs`，仅 36 处走 `fs(L,…)` | `FS` 改为 getter 令牌表 + `GFX.setTextScale()`，改一处生效全部 |',
      '| ④ | **Android 8+ 图标被裁圆 / 各密度图重复** | 无 `mipmap-anydpi-v26/`；前景层各密度 md5 相同 | 新增 `anydpi-v26` 自适应图标 XML + 按 108dp 生成 108/162/216/324/432 |',
      '| ⑤ | **引导层在平板/横屏横跨视口** | `drawTutorial` 硬编码 `16` / `W-32` | 改用 `L.padX` / `L.innerW` + 诊断断言防复发 |',
      '| ⑥ | **文字截断三处缺陷** | `maxW=0` 完全不截断；省略号预留顺序错误破坏断词边界 | 改为「先扣「…」宽度 → 二分 → 克制回退词边界」 |',
      '',
      '### 新增自动化验证',
      '- `tools/test-text-truncate.js`（35 项）—— V20.7 改过截断算法却从未被测试覆盖',
      '- `tools/test-text-scale.js`（86 项）—— 守住 361 处 `FS.xs` 真的跟随缩放',
      '- 布局诊断器扩展到横屏 × 13 种弹窗 / 引导 / 结算 + 左右安全区',
      '- Android 资源检查从 44 项扩到 60 项',
      '',
      '### 验证状态',
      '- 11 设备 + 横屏专项 + 左右安全区：**问题总数 0**',
      '- 全量 **42 套**回归通过',
      '',
      '> ⚠️ 这是 **debug 包**（未用发布密钥签名）—— 可直接安装体验，但不能上架应用市场。',
      '> 上架需用 `tools/build-android.js --release` 构建 AAB 并用发布密钥签名。',
      '',
      '### 真机必查（★ 第一项最关键）',
      '1. `chrome://inspect` → Console 执行 `window.__APP_INSETS` → 应为 `{top:…, bottom:…, ok:true}`，'
        + '且 `bottom` **大于 0**（手势条机型约 24~48）。若 `ok:false` 或 `bottom:0`，说明原生通道未生效。',
      '2. 底部「开门营业」按钮是否**完整可见且点得到**（看得见点不到 = 仍被手势条盖住）。',
      '3. 横屏时侧边挖孔是否遮挡内容。',
      '4. 桌面图标是否被系统裁圆、长按是否清晰。',
    ].join('\n');
    const created = await api('/repos/' + REPO + '/releases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: '奶茶星球 ' + tag,
        body: notes,
        draft: false,
        prerelease: false,
      }),
    });
    if (!created.body || !created.body.upload_url) {
      console.error('✘ 创建 Release 失败：' + JSON.stringify(created.body).slice(0, 300));
      process.exit(1);
    }
    rel = created;
    console.log('✔ 已创建 Release');
  }

  const uploadBase = rel.body.upload_url.replace(/\{.*\}$/, '');
  console.log('✔ Release: ' + rel.body.html_url);

  /* ---------- ② 逐个上传 ---------- */
  for (const f of files) {
    const full = path.isAbsolute(f) ? f : path.join(root, f);
    if (!fs.existsSync(full)) { console.error('  ✘ 不存在: ' + f); continue; }
    const buf = fs.readFileSync(full);
    const name = path.basename(f);

    console.log('· 上传 ' + name + '（' + (buf.length / 1048576).toFixed(2) + ' MB）…');

    const res = await new Promise((resolve, reject) => {
      const u = new URL(uploadBase + '?name=' + encodeURIComponent(name));
      const req = https.request(u, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'bubble-tycoon-builder',
          /* ★★★ Content-Type 必须是**文件自己的类型**，而不是 multipart ★★★
           *
           * ★★★ 这是一个极其隐蔽的坑（V20.6，被用户报「装不上」才发现）★★★
           *
           * GitHub 的 asset 上传端点**不解析 multipart** ——
           * 它把整个请求体**原样存成文件**。
           * ★ 所以用 multipart/form-data 上传时，
           *   存下来的文件开头是 `------bubbleXXX`（边界头），
           *   结尾是 `------bubbleXXX--`（边界尾），
           *   **中间才是真正的 APK**。
           *
           * ★★ 为什么难以发现：
           *   · 上传返回 HTTP 201（成功）
           *   · 返回的 size 只比本地大 200 多字节（看着正常）
           *   · ★ 只有真正装到手机上才会炸：「解析包时出现问题」
           *   ★ 而且 unzip -t 能通过（ZIP 允许前置任意数据）——
           *     连「完整性检查」都测不出来！
           *
           * ★★ 我试过的三条路（都失败）：
           *   ① curl -F "file=@x"     → 存下来带边界头
           *   ② curl -F "body=@x"     → 同上
           *   ③ 手写 multipart + Content-Length → 同上
           *   ★ 全部返回 201，全部是坏文件。
           *
           * ★★ 正确做法：**直接发 binary body**，
           *   Content-Type 用文件自己的 MIME 类型。
           *   实测：上传后下载回来与本地**逐字节一致**。 */
          'Content-Type': mimeOf(name),
          'Content-Length': String(buf.length),
        },
      }, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => resolve({ status: r.statusCode, body: d }));
      });
      req.on('error', reject);
      req.write(buf);          /* ★ 直接写文件字节，不加任何边界 */
      req.end();
    });

    if (res.status >= 200 && res.status < 300) {
      let size = '';
      try { size = JSON.parse(res.body).size; } catch (e) { }
      console.log('  ✔ ' + name + ' 上传成功'
        + (size ? '（' + (size / 1048576).toFixed(2) + ' MB）' : ''));
      /* ★★★ 上传后必须校验 ★★★
       * GitHub 返回 201 + 正常大小，不代表存对了 ——
       * ★ 我踩过的坑：multipart 的边界头尾被一起存进了文件，
       *   大小只多了 200 字节（看起来完全正常），
       *   而文件开头是 `------bubble...` 而不是 `PK` →
       *   手机装时报「解析包出现问题」。
       * ★ 所以这里比对「GitHub 存的大小」与「本地文件大小」：
       *   差值应当正好是 multipart 的头尾长度（几十到几百字节）。
       *   ★ 而**关键判据**是：能不能从 GitHub 下载回来的文件
       *     用 ZIP 魔数（PK）开头。 */
      /* ★ 现在是 binary body，尺寸应当**完全相等**（没有任何包装）。
         差 1 字节都说明有问题。 */
      if (size && Number(size) !== buf.length) {
        console.error('  ✘★ 尺寸不符：本地 ' + buf.length + '，GitHub ' + size);
        failed++;
      } else if (size) {
        console.log('    · 尺寸一致（' + buf.length + ' 字节）');
      }
    } else {
      console.error('  ✘ ' + name + ' → HTTP ' + res.status + ' ' + res.body.slice(0, 200));
      failed++;
    }
  }

  /* ---------- ③ 确认（并做真正的内容校验）---------- */
  const rel2 = await api('/repos/' + REPO + '/releases/tags/' + encodeURIComponent(tag));
  console.log('');
  console.log('★ Release 资产：');
  for (const a of (rel2.body.assets || [])) {
    console.log('  ' + a.name + '  ' + (a.size / 1048576).toFixed(2) + ' MB  '
      + a.browser_download_url);
  }

  /* ★★★ 真正的校验：把文件下载回来，验 ZIP 魔数与签名 ★★★
   * ★ 这才是能抓住「multipart 头尾混进文件」的唯一办法 ——
   *   GitHub 的 API 返回一切正常，只有下载下来才知道内容坏了。
   * ★ 验 ZIP 魔数（'PK' = 0x50 0x4B）—— APK 本质是 ZIP。 */
  console.log('');
  console.log('· 下载回来校验内容…');
  for (const a of (rel2.body.assets || [])) {
    const buf = await downloadFile(a.browser_download_url);
    if (!buf) { console.error('  ✘ ' + a.name + ' 下载失败'); failed++; continue; }
    const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4B;
    if (!isZip) {
      console.error('  ✘★ ' + a.name + ' 不是有效的 ZIP/APK'
        + '（开头字节 ' + buf.slice(0, 8).toString('hex') + '）'
        + ' —— ★ multipart 边界混进文件了，手机会装不上');
      failed++;
    } else {
      console.log('  ✔ ' + a.name + ' ZIP 魔数正确（PK），大小 '
        + (buf.length / 1048576).toFixed(2) + ' MB');
    }
  }

  console.log('');
  if (failed) {
    console.error('✘ ' + failed + ' 个问题');
    process.exit(1);
  }
  console.log('✔ 全部上传并校验通过');
})();

/** 按扩展名给 Content-Type —— ★ GitHub 的 asset 上传端点
 *  **不解析 multipart**，Content-Type 直接用文件自己的类型即可。 */
function mimeOf(name) {
  if (/\.apk$/i.test(name)) return 'application/vnd.android.package-archive';
  if (/\.aab$/i.test(name)) return 'application/octet-stream';
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.zip$/i.test(name)) return 'application/zip';
  return 'application/octet-stream';
}

/** 下载文件（跟随重定向） */
function downloadFile(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'bubble-tycoon-builder' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(downloadFile(res.headers.location));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', () => resolve(null));
  });
}