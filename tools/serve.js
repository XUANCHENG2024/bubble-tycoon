/**
 * 本地预览服务（H5 版）
 *
 * ★ 为什么需要它：
 *   22 套自动化测试全跑在 jsdom 里 —— 那是**模拟环境**，
 *   能验逻辑，不能验手感（布局、动画、滚动定位的真机表现）。
 *   改动这么多之后必须亲眼看一眼，否则「测试全绿」容易
 *   让人误以为「效果也对」。
 *
 * 用法：
 *   node tools/serve.js          # 自动挑一个空闲端口
 *   node tools/serve.js 8080# 指定端口
 *
 * ★ 只绑 127.0.0.1 —— 不对外暴露。
 *   局域网访问要显式 --host，那里才允许 0.0.0.0。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const portArg = args.find(a => /^\d+$/.test(a));
const wantHost = args.includes('--host');

/* ★ MIME 必须带 charset：
   index.html 与 js/*.js 都是 UTF-8 中文内容，
   不声明 charset 的话浏览器会按系统默认编码解析 → 满屏乱码。
   （这是零依赖静态站的经典坑。） */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    res.writeHead(400); return res.end('400');
  }
  if (urlPath === '/') urlPath = '/index.html';

  /* ★ 目录穿越防护 —— 静态服务的必备防线。
     恶意请求 /../../.ssh/id_rsa 拼路径后可能逃出 root。
     正规做法是 path.resolve 之后判断前缀。 */
  const filePath = path.resolve(root, '.' + urlPath);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 禁止访问');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 ' + urlPath);
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      /* 开发期不要缓存，改完刷新就能看到 */
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

server.listen(portArg ? Number(portArg) : 0, wantHost ? '0.0.0.0' : '127.0.0.1', () => {
  const a = server.address();
  const host = wantHost ? '0.0.0.0' : '127.0.0.1';
  console.log('');
  console.log('  🧋 泡泡Tycoon 本地预览');
  console.log('  ─────────────────────────────');
  console.log(`  本机   http://127.0.0.1:${a.port}/`);
  if (wantHost) {
    /* 局域网 IP 让手机能连 —— 伪 3D 与动画必须真机看 */
    const nets = require('os').networkInterfaces();
    const ips = [];
    for (const k of Object.keys(nets)) {
      for (const n of nets[k]) {
        if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
      }
    }
    for (const ip of ips) console.log(`  局域网 http://${ip}:${a.port}/   ← 手机连这个`);
  }
  console.log('');
  console.log('  按 Ctrl+C 停止');
  console.log('');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`端口被占用，换一个：node tools/serve.js ${(process.argv[2] | 0) + 1 || 8081}`);
    process.exit(1);
  }
  throw e;
});