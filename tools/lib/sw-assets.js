/* Service Worker 资源清单的共用工具（check-web.js / stamp-sw.js 都用它）。
 *
 * ★ 为什么要抽出来：这两个脚本都必须**用同一份解析规则**读 sw.js 的 ASSETS，
 *   否则"检查用的清单"和"生成指纹用的清单"会悄悄不一致 ——
 *   那会让校验通过、缓存却漏文件，比没有校验更危险。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** 从 sw.js 源码里解析 ASSETS 数组（返回规范化后的相对路径，去掉 './'） */
function readAssets(swSrc) {
  const block = (swSrc.match(/const ASSETS = \[([\s\S]*?)\];/) || [])[1] || '';
  return (block.match(/'\.\/([^']*)'/g) || [])
    .map(s => s.replace(/^'\.\//, '').replace(/'$/, ''))
    .filter(p => p !== '');          /* './' 本身是目录项，不参与哈希 */
}

/** 计算一组文件的内容指纹（8 位 hex）。
 *  ★ 顺序固定（按路径排序）—— 否则同一批文件换个顺序就是另一个指纹，
 *    会让缓存每轮都失效，等于把离线能力关掉。 */
function contentHash(root, list) {
  const h = crypto.createHash('sha1');
  list.slice().sort().forEach(p => {
    const abs = path.join(root, p);
    h.update(p);
    if (fs.existsSync(abs)) h.update(fs.readFileSync(abs));
    else h.update('<missing>');      /* 缺文件也要进哈希：否则"删了文件"不会触发更新 */
  });
  return h.digest('hex').slice(0, 8);
}

module.exports = { readAssets, contentHash };
