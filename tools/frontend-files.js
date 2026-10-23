/**
 * 共享的前端脚本清单（V20.2）
 *
 * ★ 为什么要抽这一份：
 *   ui.js 拆分前，所有测试都硬编码同一份清单：
 *     ['js/data.js', 'js/engine.js', 'js/ui.js', 'js/main.js']
 *   拆分后多出 4 个模块文件 —— 而**每个测试各有一份自己的清单**，
 *   实测有 8 处（dom-smoke / probe / bench / check-dup / online-smoke /
 *   symbol-check / minigame-smoke / mobile-smoke …）。
 *   ★ 手工改 8 处的必然结果就是「漏掉几个」——
 *     我第一次拆完，8 个测试里坏了 8 个，报错还各不相同。
 *
 * ★ 抽成共享模块后：
 *   新增/删除脚本文件只改这一处；
 *   各测试不再需要知道「现在有几个文件、什么顺序」。
 *
 * ★ 顺序很重要：data → engine → ui/* → ui → main
 *   - ui/* 必须在 ui.js **之前**（ui.js 的 PANEL_RENDERERS 引用它们）
 *   - main.js 最后（它做启动与事件绑定）
 */
const path = require('path');

/** H5 端的脚本加载顺序 */
const H5_FILES = [
  'js/data.js',
  'js/engine.js',
  'js/ui/stores.js',
  'js/ui/staff.js',
  'js/ui/lab.js',
  'js/ui/ach.js',
  'js/ui.js',
  'js/main.js',
];

/** 只读 ui 相关（某些测试只要 UI，不要 main 的启动副作用） */
const UI_ONLY_FILES = H5_FILES.filter(f => f !== 'js/main.js');

/** 相对项目根的路径 */
const root = path.join(__dirname, '..');

module.exports = { H5_FILES, UI_ONLY_FILES, root };