/**
 * 分块并行下载器（V20.5）
 *
 * ★ 为什么需要：
 *   直连 dl.google.com / api.adoptium.net 下载 150MB+ 的文件时，
 *   单连接经常在 60~90 秒后被中断（超时或连接重置），
 *   而 `curl -C -` 断点续传在这两个站点上**不生效**（虽然它们声明了
 *   Accept-Ranges: bytes，但实际会忽略 Range 头返回整个文件）。
 *   ★ 结果就是：反复重试，每次都从 0 开始，永远下不完。
 *
 * ★ 解法：把文件切成 N 块，**并发下载**，每块独立重试，
 *   最后按顺序拼起来。
 *   · 每块只有几 MB → 单块超时概率低
 *   · 并发 → 墙钟时间降到 1/N
 *   · 块级校验 → 某一块坏了只重下那一块
 *
 * 用法：node tools/fetch-big.js <url> <输出路径> [并发数]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const url = process.argv[2];
const out = process.argv[3];
const CONC = Number(process.argv[4]) || 4;

if (!url || !out) {
  console.error('用法：node tools/fetch-big.js <url> <输出路径> [并发数]');
  process.exit(2);
}

/* ---------- 先问总大小 ---------- */
function contentLength(u) {
  const r = execFileSync('curl', ['-sIL', '--max-time', '30', u], { encoding: 'utf8' });
  const m = r.match(/content-length:\s*(\d+)/gi);
  if (!m || !m.length) return 0;
  /* 有些站点 HEAD 与 GET 的长度不同，取最大的那个 */
  return Math.max(...m.map(x => Number(x.replace(/[^0-9]/g, ''))));
}

const total = contentLength(url);
if (!total) {
  console.error('✘ 拿不到内容长度');
  process.exit(1);
}
console.log('目标：' + (total / 1048576).toFixed(1) + ' MB  并发 ' + CONC);

/* ---------- 分块 ---------- */
const CHUNK = 8 * 1024 * 1024;   /* 8MB 一块 */
const parts = [];
for (let start = 0, i = 0; start < total; start += CHUNK, i++) {
  parts.push({ i, start, end: Math.min(total - 1, start + CHUNK - 1) });
}

const tmpDir = path.join(os.tmpdir(), 'fetch-big-' + process.pid);
fs.mkdirSync(tmpDir, { recursive: true });

function downloadPart(p) {
  const dest = path.join(tmpDir, 'part' + p.i);
  const need = p.end - p.start + 1;
  /* 已经下好且大小对就直接跳过（断点续跑的幂等性） */
  if (fs.existsSync(dest) && fs.statSync(dest).size === need) return true;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      execFileSync('curl', [
        '-sL', '--max-time', '180', '--retry', '2', '--retry-delay', '1',
        '-r', p.start + '-' + p.end,     /* ★ 关键：显式 Range */
        '-o', dest, url,
      ], { stdio: ['ignore', 'ignore', 'ignore'] });
      if (fs.existsSync(dest) && fs.statSync(dest).size === need) return true;
    } catch (e) { /* 下一轮重试 */ }
  }
  return false;
}

/* ---------- 并发跑 ---------- */
let done = 0, failed = 0;
const queue = parts.slice();

async function worker() {
  while (queue.length) {
    const p = queue.shift();
    const ok = downloadPart(p);
    done++;
    if (!ok) failed++;
    process.stdout.write('\r  进度 ' + done + '/' + parts.length
      + '  ' + (done * 100 / parts.length).toFixed(0) + '%'
      + (failed ? '  失败 ' + failed : ''));
  }
}

(async () => {
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log('');
  if (failed) {
    console.error('✘ ' + failed + ' 块下载失败');
    process.exit(1);
  }

  /* ---------- 拼接 ---------- */
  const outStream = fs.createWriteStream(out);
  for (const p of parts) {
    outStream.write(fs.readFileSync(path.join(tmpDir, 'part' + p.i)));
  }
  await new Promise(res => outStream.end(res));
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const size = fs.statSync(out).size;
  console.log((size === total ? '✔ ' : '✘ ') + path.basename(out)
    + '  ' + (size / 1048576).toFixed(1) + ' MB / 期望 ' + (total / 1048576).toFixed(1) + ' MB');
  process.exit(size === total ? 0 : 1);
})();