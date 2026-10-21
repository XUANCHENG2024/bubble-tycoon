/**
 * H5 测试环境搭建（browser-smoke 与 verify-checklist 共用）。
 *
 * ★ 为什么要抽出来：
 *   verify-checklist 最初自己写了一套 jsdom 搭建，结果连踩三个坑 ——
 *   二次require 拿到另一个 jsdom 实例（页面空白，所有断言假绿）、
 *   引擎符号没经window.eval 导出（拿不到 E）、
 *   照着注释猜API 签名（claimDailyBonus 实际叫 claimLogin）。
 *   三坑的共同根因都是**重复实现**。
 *   与其重写第二套，不如把第一套（已验证）抽出来共用 ——
 *   这也正是本项目 V9 那条教训的同构版本：
 *   「两份清单/两份AI/两份测试环境」各自漂移，不如单点同源。
 *
 * 用法：
 *   const env = buildH5Env();
 *   env.window / env.doc / env.E / env.tick()
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const { JSDOM, VirtualConsole } = require('./jsdom-loader');

/** 引擎里本工具需要的符号（用 window.eval 显式导出 —— jsdom 的经典脚本作用域） */
const EXPORT = `({
  CFG, DIFFICULTY, ING, RECIPES, ALL_RECIPES, ACH_RECIPES, CUISINES, CITIES,
  RESEARCH_TREE, CRAFT_WORKSHOPS, MANAGER_RANKS, MANAGER_TRAITS,
  newGame, openShop, openShopBranch, endDay, nextDay, tick, invUsed, autoFill, buyIng,
  prestigeStartCash, sanitizeState, saveGame, loadGame, setSlot, getSlot,
  loadMeta, saveMeta, exportSave, importSave, b64encode, b64decode,
  researchCost, doResearch, canResearch, toggleMenu, menuSlots,
  staffOfBranch, activeBranchCount, branchStaffCap, managerOfBranch,
  managerSlotsLeft, managerCost, hireManager, currentCityId, cuisinesOfCity,
  ingsOfCity, ingAvailableAt, recipeById, claimAchStars, checkAchievements,
  netWorth, dailyRecent, pushHistory, loginState, claimLogin, todayKey,
})`;

function buildH5Env() {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  /* 把 <script src> 内联 —— 让 jsdom 以经典脚本执行（全局词法作用域），
     与浏览器里 <script src> 的行为一致 */
  let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  html = html.replace(/<script src="js\/([a-z]+)\.js"><\/script>/g,
    (m, name) => '<script>' + fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8') + '<\/script>');

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;
  const doc = window.document;

  /* jsdom 没装 canvas 包：结局页要画战绩分享卡片，
     那是真实分支，不该因环境缺失被判成脚本错误。补一个够用的 2D 上下文桩。 */
  if (window.HTMLCanvasElement) {
    window.HTMLCanvasElement.prototype.getContext = function () {
      return new Proxy({}, {
        get: (t, p) => (p === 'measureText'
          ? (s => ({ width: String(s).length * 6.5 }))
          : (() => { })),
        set: () => true,
      });
    };
  }

  const E = window.eval(EXPORT);
  if (!E || !E.newGame) {
    console.error('✘ 引擎导出失败（window.eval 未取到符号）');
    process.exit(1);
  }

  /* UI / TUT 等 UI 层的符号也要导出。
     ★ 注意：`const UI = {...}` 声明的是**词法绑定**，
       在 window.eval 里能访问，但从 Node 侧 `window.UI` 是 undefined。
       所以必须像E 一样用 window.eval 把它们**显式挂到 window 上**，
       否则测试里`window.UI.setTab()` 直接 TypeError。*/
  window.eval('window.UI = UI; window.TUT = TUT; window.SFX = SFX;');

  /* 让 UI 拿到引擎 —— UI.js 里那些直接调用引擎函数的地方靠window 上有 S */
  const tick = async (n) => {
    for (let i = 0; i < (n || 1); i++) await new Promise(r => setTimeout(r, 0));
  };

  return { window, doc, E, errors, tick };
}

/**
 * 取「玩家真正看得见的文字」。
 *
 * ★ 为什么不能直接用 textContent：
 *   jsdom 的 textContent **包含注释节点的内容**（注释在 DOM 里是 nodeType 8，
 *   textContent 会把它们一起拼出来）。
 *   而本项目代码注释里经常写着解释性文字，比如
     「…之后 recipeById 返回 undefined」——
 *   直接扫 textContent 会把注释当成界面文字误报，
 *   实测踩过：标题页"发现"的 undefined 全部来自注释，玩家根本看不到。
 *
 * @param {Element} root 扫描根节点
 * @returns {string} 剔除所有注释后的可见文本
 */
function visibleText(root) {
  let out = '';
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 8) continue;               /* 注释：跳过 */
      if (c.nodeType === 3) { out += c.nodeValue + ' '; continue; }  /* 文本 */
      if (c.nodeType === 1) {
        /* script / style 的内容不是给玩家看的 */
        const tag = (c.tagName || '').toLowerCase();
        if (tag === 'script' || tag === 'style') continue;
        walk(c);
        out += ' ';
      }
    }
  };
  walk(root);
  return out;
}

module.exports = { buildH5Env, visibleText };