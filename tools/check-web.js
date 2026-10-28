#!/usr/bin/env node
/* 线上版（GitHub Pages / H5）专属检查。
 *
 * ★ 为什么单独一个脚本：tools/ 里已有的检查几乎都针对"游戏逻辑"，
 *   而线上版有一类只在这里才会发生的问题 ——
 *     · sw.js 的 VERSION 忘了改 → 老访客拿旧 JS（"改了没生效"）
 *     · 分享 meta 缺失 → 发链接出去没有标题/缩略图
 *     · manifest 里写"5 难度"而代码只有 3 档 → 装到桌面时原样显示错误信息
 *   这些都不会让游戏跑不起来，也都不会被 smoke 测试抓到。
 *
 * ★ 设计原则：只做**静态一致性**断言（不启动浏览器），因为
 *   CI 里跑不起真实 SW 生命周期；能抓的正是"两处该一致却不一致"这类漂移。
 *
 * 用法：node tools/check-web.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { readAssets, contentHash } = require('./lib/sw-assets');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let pass = 0, fail = 0;
const ok = (t) => { pass++; console.log('  ✔ ' + t); };
const bad = (t) => { fail++; console.log('  ✘ ' + t); };
const check = (cond, t) => (cond ? ok(t) : bad(t));

console.log('\n=== 线上版一致性检查（V21）===\n');

const index = read('index.html');
const sw = read('sw.js');
const manifest = JSON.parse(read('manifest.json'));
const ui = read('js/ui.js');
const main = read('js/main.js');

/* ① sw.js 的 VERSION 必须与 index.html 的 app-version 一致。
      —— 这两处不一致时，缓存清理会失灵（CACHE 名没变），
         症状是"玩家一直看到旧版"，而且完全没有报错。 */
const swVer = (sw.match(/const VERSION\s*=\s*'([^']+)'/) || [])[1];
const metaVer = (index.match(/<meta name="app-version" content="([^"]+)"/) || [])[1];
check(!!swVer, 'sw.js 声明了 VERSION');
check(!!metaVer, 'index.html 声明了 app-version');
check(swVer === metaVer, `两处版本号一致（sw=${swVer} / meta=${metaVer}）`);

/* ② 分享卡：og 四件套 + twitter card。
      缺一个都可能让链接在社交平台里退化成一串 URL。 */
check(/property="og:title"/.test(index), 'og:title 存在');
check(/property="og:description"/.test(index), 'og:description 存在');
check(/property="og:image"/.test(index), 'og:image 存在');
check(/property="og:url"/.test(index), 'og:url 存在');
check(/name="twitter:card"/.test(index), 'twitter:card 存在');
check(/<meta name="description"/.test(index), 'description 存在（搜索引擎摘要）');

/* ③ og:image 必须指向真实存在的文件，且是绝对地址
      （Pages 部署在 /bubble-tycoon/ 子目录，相对路径在分享解析里会失效）。 */
const ogImg = (index.match(/property="og:image" content="([^"]+)"/) || [])[1] || '';
check(/^https:\/\//.test(ogImg), 'og:image 是绝对 https 地址');
const imgPath = ogImg.replace(/^https?:\/\/[^/]+\/bubble-tycoon\//, '');
check(imgPath && fs.existsSync(path.join(root, imgPath)), `og:image 指向的文件存在（${imgPath}）`);

/* ④ manifest 的难度数必须与 DIFFICULTY 实际档数一致。
      —— 这里曾经写着"5 难度"，而游戏只有 3 档。 */
const ctx = {
  console, Math, JSON, Date, Object, Array, String, Number, isNaN, parseInt, parseFloat,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(read('js/data.js') + ';globalThis.__N = Object.keys(DIFFICULTY).length;', ctx, { filename: 'data.js' });
const diffCount = ctx.__N;
const mDesc = String(manifest.description || '');
const claimed = (mDesc.match(/(\d+)\s*(?:档)?难度/) || [])[1];
check(!!claimed, `manifest.description 标了难度数（${mDesc}）`);
check(Number(claimed) === diffCount, `manifest 难度数(${claimed}) == DIFFICULTY(${diffCount})`);

/* ⑤ manifest 的 start_url / scope / 图标必须能在 Pages 子目录下工作。 */
check(manifest.start_url === './', 'start_url 用相对根（"./"）');
check(manifest.scope === './', 'scope 用相对根（"./"）');
const icons = manifest.icons || [];
check(icons.length >= 2, `manifest 至少 2 个图标（${icons.length}）`);
check(icons.every(i => fs.existsSync(path.join(root, i.src))), 'manifest 里的图标文件都存在');

/* ⑥ 分享入口：光有 og 卡没用，游戏里必须有能触发分享的按钮。
      三处必须同时存在，少一处就是"按钮在但点了没反应"。 */
check(/UI\.shareResult\s*=\s*function/.test(ui), 'UI.shareResult 已实现');
check(/data-act="share"/.test(ui), '结算页有分享按钮');
check(/case 'share'\s*:/.test(main), "main.js 有 case 'share' 分发");

/* ⑦ 微信内置浏览器不支持 Web Share，必须有引导分支。 */
check(/MicroMessenger/i.test(ui), '有微信内置浏览器的降级分支');

/* ⑧ SW 只应在网页版注册，App 里不注册（否则缓存与本地资源打架）。 */
check(/isNativePlatform/.test(index), 'SW 注册处有 Capacitor 平台判定');
check(/skipWaiting/.test(sw), 'sw.js 会 skipWaiting（避免卡在 waiting）');
check(/controllerchange/.test(index), '有新版本接管的提示逻辑');

/* ⑨ ASSETS 必须覆盖 index.html 引用的每一个资源。
      —— 漏一个的后果是**离线才暴露**：联网时由网络兜住，断网直接白屏/少一个模块，
         而开发过程中几乎不会发现。加脚本时最容易忘的就是这里。 */
const cached = readAssets(sw);
const refs = [];
(index.match(/(?:src|href)="(js\/[^"]+|styles\.css|manifest\.json)"/g) || []).forEach(m => {
  const p = m.replace(/^(?:src|href)="/, '').replace(/"$/, '');
  if (!refs.includes(p)) refs.push(p);
});
const missing = refs.filter(p => !cached.includes(p));
check(missing.length === 0, missing.length === 0
  ? `ASSETS 覆盖了 index.html 引用的全部 ${refs.length} 个资源`
  : `ASSETS 漏了 ${missing.join(' / ')}（离线会缺文件）`);

/* ⑩ 缓存里的每个文件都必须真实存在 —— 否则 addAll 整批失败，
     结果是**一个都不缓存**（SW 最容易踩的坑之一：单个 404 拖垮整个安装）。 */
const ghost = cached.filter(p => p !== '' && !fs.existsSync(path.join(root, p)));
check(ghost.length === 0, ghost.length === 0
  ? `ASSETS 里 ${cached.length} 个文件都存在`
  : `ASSETS 指向了不存在的文件：${ghost.join(' / ')}（会导致 addAll 整批失败）`);

/* ⑪ 内容指纹必须与真实文件一致。
      —— 这是"改了 ui.js 忘了改版本号"那道坑的根治手段：
         指纹错了 CI 就红，不依赖任何人记得手改数字。 */
const stamped = (sw.match(/const ASSETS_HASH = '([0-9a-f]{8})'/) || [])[1];
const realHash = contentHash(root, cached);
check(!!stamped, 'sw.js 声明了 ASSETS_HASH');
check(stamped === realHash, stamped === realHash
  ? `内容指纹一致（${stamped}）`
  : `内容指纹过期：sw.js=${stamped} / 实际=${realHash} → 跑 node tools/stamp-sw.js`);
check(sw.indexOf("const CACHE = 'bubble-tycoon-' + VERSION + '-' + ASSETS_HASH;") >= 0,
  'CACHE 名包含内容指纹（否则改文件不会使旧缓存失效）');

console.log(`\n${fail === 0 ? '✔ 全部通过' : '✘ 有失败项'}（${pass} 项通过 / ${fail} 项失败）\n`);
process.exit(fail === 0 ? 0 : 1);
