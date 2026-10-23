/**
 * 前端脚本内联（V20.2）
 *
 * ★ 为什么要抽这一份：
 *   「把 index.html 里的 <script src> 读出来内联成 <script>…</script>」
 *   这件事在 **4 个地方各写了一遍**，而且**用的是同一条正则**：
 *     js\/([a-z]+)\.js
 *   ★ 那条正则只认 js/ 下的直接文件 —— 拆出 js/ui/ 子目录后，
 *     模块文件**根本没被加载**，而报错是
 *     「marketIngUsesHtml is not defined」——
 *     症状离病因很远，看起来像拆分把代码写坏了。
 *   ★ 同一段逻辑复制到 4 处 = 改一处漏三处。
 *     这是本轮拆分最大的隐性成本，正好在这次一起还掉。
 */
const fs = require('fs');
const path = require('path');

/** 把 index.html 里的外部脚本内联，返回可给 jsdom 执行的 HTML
 *  @param {string} root 项目根目录
 *  @param {string} [html] 已读好的 index.html（避免重复读盘）
 */
function inlineScripts(root, html) {
  const src = html || fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  /* ★ 路径要支持**子目录**（js/ui/stores.js）：
     - 允许 / 与 .
     - 点号要转义（否则 ui.stores 会被当成正则的「任意字符」）
     ★ 保持与 tools/frontend-files.js 的清单一致 ——
     这里按 index.html 实际写的来加载（而不是另存一份清单），
     这样 index.html 改了这里自动跟上。 */
  return src.replace(/<script src="js\/([\w./-]+)\.js"><\/script>/g,
    (m, name) => '<script>' + fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8') + '<\/script>');
}

module.exports = { inlineScripts };