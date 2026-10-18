'use strict';
/* ============================================================
 *  jsdom 加载器（仅供测试使用，游戏运行时不依赖它）
 *
 *  三个真实 DOM 测试（browser-smoke / mobile-smoke / xss-verify）都依赖 jsdom，
 *  但它是**开发依赖**。原先各脚本里直接写死某台机器的绝对路径，
 *  换台机器或上 CI 就会崩，报的还是一句看不懂的 MODULE_NOT_FOUND。
 *
 *  解析顺序：
 *    1. 环境变量 JSDOM_PATH（显式指定时用）
 *    2. 正常模块解析（项目内执行 npm i jsdom 即可）
 *    3. 已知的本机全局工作区路径（开发机兜底）
 * ============================================================ */
const path = require('path');

function loadJsdom() {
  /* 显式指定优先，但指错了不能让它抛 —— 否则用户看到的是一堆 require 堆栈
     而不是「路径写错了」。解析失败就警告一声，继续走后面的常规路径。 */
  if (process.env.JSDOM_PATH) {
    try { return require(process.env.JSDOM_PATH); }
    catch (e) {
      console.error('  · JSDOM_PATH 指向的 jsdom 加载失败，改用常规解析：' + process.env.JSDOM_PATH);
    }
  }

  try {
    return require('jsdom');
  } catch (e) {
    /* 落到 3 */
  }

  try {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    return require(path.join(home, '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'jsdom'));
  } catch (e) {
    /* 落到 3 */
  }

  console.error('');
  console.error('✘ 找不到 jsdom —— 真实 DOM 测试需要它。');
  console.error('  在项目目录执行：npm i jsdom');
  console.error('  或用 JSDOM_PATH 直接指向：JSDOM_PATH=<jsdom 目录> node tools/browser-smoke.js');
  console.error('');
  process.exit(1);
}

module.exports = loadJsdom();
