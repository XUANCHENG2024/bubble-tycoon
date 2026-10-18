# 奶茶星球 · Bubble Tycoon

30 天街头奶茶帝国 —— 策略经营类完整游戏。

同一个游戏，两套渲染后端，**共用同一份数据层与引擎层**：

| | H5 版 | 抖音小游戏版 |
|---|---|---|
| 目录 | 根目录（`index.html`） | `minigame/` |
| 渲染 | DOM + CSS | Canvas 2D 全绘制 |
| 打开方式 | 浏览器直接双击 `index.html` | 抖音开发者工具打开 `minigame/` |
| 共用源码 | `js/data.js`、`js/engine.js`（字节级相同） | 同左 |

---

## 一、快速开始

### H5 版（最快）

直接用浏览器打开 **`index.html`** 即可，不需要任何服务器、不需要构建、不需要联网。

如需本地服务器（推荐，模拟真实环境）：

```bash
cd bubble-tycoon
python -m http.server 8080
# 然后访问 http://localhost:8080
```

### 抖音小游戏版

1. 下载并安装 **抖音开发者工具**
2. 首次打包：
   ```bash
   cd bubble-tycoon
   node tools/build-minigame.js
   ```
3. 开发者工具里「导入项目」，目录选 **`minigame/`**，`projectconfig.json` 中填自己的 AppID
4. 点击编译 / 预览

> `minigame/bundle.js` 是构建产物，由 4 个源文件拼接而成。
> **改完源码必须重新打包**，否则工具里跑的还是旧代码。

### 浏览器预览小游戏版（免工具调试）

打包后直接用浏览器打开 **`minigame/preview.html`**，即可用鼠标操作 Canvas 版。
这样改代码 → 看效果不必每次都开抖音开发者工具。

---

## 二、目录结构

```
bubble-tycoon/
├── README.md                  ← 本文件
├── index.html                 ── H5 版入口
├── styles.css                 ── H5 版样式
├── js/
│   ├── data.js                ┐
│   ├── engine.js              ├─ 两版共用（零 DOM 依赖）
│   ├── ui.js                  ── H5 版 DOM 渲染层
│   └── main.js                ── H5 版主控
├── minigame/
│   ├── game.js                ── 小游戏入口（平台必需）
│   ├── game.json              ── 小游戏配置（平台必需）
│   ├── projectconfig.json     ── 项目配置（填 AppID）
│   ├── bundle.js              ── 构建产物（由 tools 生成）
│   ├── preview.html          ── 浏览器预览页
│   └── src/                   ┐
│       ├── platform.js        │ 平台适配层
│       ├── gfx.js             │ Canvas 绘制基础
│       ├── ui.js              ├─ 小游戏版源码
│       └── main.js            │
└── tools/
    ├── build-minigame.js      ── 打包脚本
    ├── jsdom-loader.js        ── jsdom 解析（三个真实 DOM 测试共用）
    ├── sim.js                 ── 数值平衡模拟
    ├── dom-smoke.js           ── H5 冒烟
    ├── browser-smoke.js       ── H5 真实 DOM 冒烟
    ├── mobile-smoke.js        ── H5 移动端兼容
    ├── minigame-smoke.js      ── 小游戏冒烟
    └── xss-verify.js          ── 注入验证
```

---

## 三、运行测试

需要 Node 18+。三个 jsdom 测试依赖 jsdom 包。

```bash
# 先装依赖（只需一次）。三个 jsdom 测试共用 tools/jsdom-loader.js 解析，
# 也可用 JSDOM_PATH 指向已有的 jsdom 安装，不必装在项目里。
npm i jsdom
# 或：JSDOM_PATH=<jsdom 目录> node tools/browser-smoke.js

# 打包小游戏（改过 minigame/src 后必跑）
node tools/build-minigame.js

# 各套件
node tools/dom-smoke.js        # H5 全链路
node tools/browser-smoke.js    # H5 真实 DOM + 边界
node tools/mobile-smoke.js     # H5 移动端兼容
node tools/minigame-smoke.js   # 小游戏（模拟 tt 环境）
node tools/xss-verify.js       # 注入验证
node tools/sim.js 40           # 数值平衡（40 局）
```

当前状态（全部通过）：

| 套件 | 项数 | 结果 |
|---|---|---|
| dom-smoke | 24 | ✅ |
| browser-smoke | 31 | ✅ |
| mobile-smoke | 31 | ✅ |
| minigame-smoke | 46~47 | ✅（随机事件那一项按当局是否触发而增减） |
| xss-verify | — | ✅ 注入未得逞 |
| sim 40 局 | — | ✅ easy 160% / normal 88% / hard 64% |

---

## 四、玩法速览

- **目标**：30 天内把净资产做到目标金额；现金连续 2 天为负则破产
- **每天循环**：进货 → 配菜单与定价 → 开门营业（26 秒实时）→ 结算 → 投资
- **营业操作**：连点出杯位可加速，会累积连击，小费最高翻倍
- **系统**：顾客 5 类、天气 6 种、随机事件 17 个、成就 32 个、员工特质 7 种、对手反制 3 种
- **模式**：标准 30 天 / 无尽模式 / 每日挑战（全网同一种子）
- **存档**：3 个槽位，可导出存档码跨设备搬运

---

## 五、两版的已知差异

| 项 | H5 版 | 小游戏版 | 说明 |
|---|---|---|---|
| 音效 | WebAudio 实时合成（8 种） | **静音** | 小游戏无 AudioContext，`tt.createInnerAudioContext` 需真实音频文件，为控制首屏包体积暂未内置。接口已留好，放入音频文件即可启用 |
| 存档码导入 | 可直接粘贴 | 从剪贴板读取 | 小游戏无文本输入框 |
| 战绩卡片 | 可下载 PNG | 暂未实现 | 小游戏内无 `<a download>`；如需可改为调用 `tt.saveImageToPhotosAlbum` |
| 跨设备同步 | 无 | 无 | 按需求第 5 条，暂不实现 |

---

## 六、技術要点（为什么这么组织）

**1. 引擎层零 DOM 依赖**
`js/data.js` 与 `js/engine.js` 从不碰 `document` / `window` / `localStorage`。
这是本作能做两个渲染后端的前提，也正因此才能在 Node 里跑无头数值模拟
（`tools/sim.js` 直接把这两个文件丢进 `vm` 就能跑完整 30 天）。

**2. 存储后端可插拔**
`engine.js` 只认 `{ get / set / remove }` 形状的后端。
H5 下自动用 localStorage（隐私模式自动降级到内存）；
小游戏下由 `platform.js` 在加载时注入 `tt.getStorageSync` 实现。
**注入必须发生在引擎首次读档之前** —— 否则后端会被锁成内存版，进度根本存不进去。

**3. 打包成单文件而非分模块**
`data.js` / `engine.js` 是浏览器经典脚本（顶层 `const` 属文件作用域）。
拆成 CommonJS 模块就得把 H5 版也改成模块，两版逻辑会各自漂移。
拼成单文件后，两版加载的是字节级相同的引擎代码。

**4. Canvas 没有排版，所以自己造了最小一套**
`gfx.js` 提供：中文可用的自动换行、圆角卡片 / 按钮 / 进度条、**命中区域登记 + 裁剪栈**。
其中裁剪栈是关键 —— 没有它，滚动到屏幕外的按钮也会被登记，手指点在空白处就会误触。

---

## 七、平台规范检查清单（提审前）

- [ ] `game.json` 中 `deviceOrientation: "portrait"`（本作为竖屏）
- [ ] `projectconfig.json` 已填真实 AppID
- [ ] 已执行 `node tools/build-minigame.js`
- [ ] `node tools/minigame-smoke.js` 全绿
- [ ] 开发者工具内编译无警告
- [ ] 真机预览正常（见下方验证要点）

---

## 八、真机验证要点

详见 **`真机验证清单.md`**。

部署到线上见 **`DEPLOY.md`**（GitHub Pages / Netlify / 其它静态托管三套步骤）。
