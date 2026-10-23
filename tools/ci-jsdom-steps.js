/**
 * 给 CI workflow 用的公共片段
 *
 * ★ 为什么要抽这一份：
 *   三个 workflow（quick-check / full-check / pages）都需要
 *   「装 jsdom + 设 JSDOM_PATH」——
 *   而**漏掉这一步的后果是整个 CI 静默失效**：
 *   Quick Check 从第 7 步开始失败，后面 18 步全部 skipped。
 *   ★ 我本地 25 套全绿，一直以为 CI 是绿的 ——
 *     直到这次真去看了 CI 结果，才发现它长期是红的。
 *   ★ **本地绿 ≠ CI 绿**。这个漏洞只有真看 CI 才能发现。
 *   ★ 所以这段必须**只有一个来源**，否则改一处漏两处。
 */

/** 在 workflow 里插入的步骤（YAML 片段） */
const JSDOM_STEPS = `      # ★ 装 jsdom —— 四个 DOM 测试需要它
      #   （browser-smoke / mobile-smoke / xss-verify / check-dist-boot）
      # ★ 装到 .ci-node/ 而不是 node_modules/：
      #   项目根刻意保持零依赖（无 package.json），
      #   不想让 clone 的人以为要跑 npm install。
      - name: 安装 jsdom（DOM 测试依赖）
        run: node tools/install-jsdom.js

      # ★ 后续步骤统一读这个变量
      - name: 设置 JSDOM_PATH
        run: echo "JSDOM_PATH=$PWD/.ci-node/node_modules/jsdom" >> $GITHUB_ENV
`;

module.exports = { JSDOM_STEPS };
