/* ============================================================
 *  Service Worker（V20.6）
 *
 *  作用：让 H5 版**装到手机桌面后能离线玩**。
 *
 *  ★ 为什么需要：
 *    本作完全离线（0 处网络请求），但 H5 版要靠 CDN/服务器提供文件 ——
 *    没有 SW 的话，地铁里没信号就白屏。
 *    ★ 装了 SW 之后，App Shell（html/css/js）被缓存下来，
 *      断网也能启动。
 *
 *  ★ 策略（cache-first + 后台更新）：
 *    · 命中缓存 → 直接返回（最快）
 *    · 未命中 → 联网取，同时**顺手更新缓存**
 *    ★ 纯 cache-first 会让用户永远拿不到新版本，
 *      所以每次联网取到新的都顺手覆盖缓存。
 *
 *  ★ 版本号：改了任何被缓存的文件都要改它，
 *    否则旧缓存不会失效（这是 SW 最常见的"改了没生效"原因）。
 * ============================================================ */

const VERSION = 'v20.6';
const CACHE = 'bubble-tycoon-' + VERSION;

/* ★ 要缓存的文件 —— 与 index.html 里引用的一致。
   ★ 注意路径都是相对路径：Pages 部署在 /bubble-tycoon/ 子目录下，
   用绝对路径会 404（这是 GitHub Pages 上 SW 最常见的坑）。 */
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './js/data.js',
  './js/engine.js',
  './js/ui.js',
  './js/main.js',
  './js/ui/stores.js',
  './js/ui/staff.js',
  './js/ui/lab.js',
  './js/ui/ach.js',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    /* ★ 删掉旧版本的缓存 —— 否则会越攒越多 */
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  /* ★ 只处理 GET —— POST 之类不能进缓存 */
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  /* ★ 只处理同源 —— 跨域请求（如果有的话）交给浏览器自己处理 */
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then(hit => {
      if (hit) {
        /* ★ 命中缓存的同时后台更新（stale-while-revalidate）——
           用户拿到的是快的旧版本，下次打开就是新的。 */
        const net = fetch(req)
          .then(res => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then(c => c.put(req, copy));
            }
            return res;
          })
          .catch(() => hit);
        return hit;
      }
      return fetch(req)
        .then(res => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          /* ★ 离线且没缓存 → 回首页（导航请求的兜底） */
          if (req.mode === 'navigate') return caches.match('./index.html');
          return new Response('离线且无缓存', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        });
    })
  );
});
