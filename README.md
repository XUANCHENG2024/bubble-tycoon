# 奶茶星球 · Bubble Tycoon

30 天街头奶茶帝国 —— 策略经营类完整游戏。

**🔗 在线试玩：<https://xuancheng2024.github.io/bubble-tycoon/>**

同一个游戏，两套渲染后端，**共用同一份数据层与引擎层**：

|      | H5 版                               | 抖音小游戏版                |
| ---- | ---------------------------------- | --------------------- |
| 目录   | 根目录（`index.html`）                  | `minigame/`           |
| 渲染   | DOM + CSS                          | Canvas 2D 全绘制         |
| 打开方式 | 浏览器直接双击 `index.html`               | 抖音开发者工具打开 `minigame/` |
| 共用源码 | `js/data.js`、`js/engine.js`（字节级相同） | 同左                    |

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
3. 开发者工具里「导入项目」，目录选 **`minigame/`**（注意是这一层，不是仓库根目录），
   `project.config.json` 中填自己的 AppID
4. 点击编译 / 预览

> `minigame/bundle.js` 是构建产物，由 5 个源文件拼接而成。  
> **改完源码必须重新打包**，否则工具里跑的还是旧代码。

> ⚠️ 平台必需的三个文件是 `game.js` / `game.json` / `project.config.json`，
> 文件名一个字都不能差（比如写成 `projectconfig.json` 工具是不认的）。

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
├── minigame/                  ← 抖音开发者工具要导入的就是这一层
│   ├── game.js                ── 小游戏入口（平台必需）
│   ├── game.json              ── 小游戏配置（平台必需）
│   ├── project.config.json    ── 工程配置（平台必需，AppID 与 setting 都在这）
│   ├── code.fortify.config.json ── 代码加固配置（开发者工具生成）
│   ├── bundle.js              ── 构建产物（由 tools 生成）
│   ├── preview.html          ── 浏览器预览页
│   └── src/                   ┐
│       ├── platform.js        │ 平台适配层（画布 / 存储 / 触摸）
│       ├── caps.js            │ 平台能力层（侧边栏 / 加桌 / 订阅 / 广告 / 内购）
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

| 套件             | 项数    | 结果                                  |
| -------------- | ----- | ----------------------------------- |
| dom-smoke      | 24    | ✅                                   |
| browser-smoke  | 31    | ✅                                   |
| mobile-smoke   | 31    | ✅                                   |
| minigame-smoke | 46~47 | ✅（随机事件那一项按当局是否触发而增减）                |
| xss-verify     | —     | ✅ 注入未得逞                             |
| sim 40 局       | —     | ✅ easy 160% / normal 88% / hard 64% |

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

| 项     | H5 版               | 小游戏版   | 说明                                                                                   |
| ----- | ------------------ | ------ | ------------------------------------------------------------------------------------ |
| 音效    | WebAudio 实时合成（8 种） | **静音** | 小游戏无 AudioContext，`tt.createInnerAudioContext` 需真实音频文件，为控制首屏包体积暂未内置。接口已留好，放入音频文件即可启用 |
| 存档码导入 | 可直接粘贴              | 从剪贴板读取 | 小游戏无文本输入框                                                                            |
| 战绩卡片  | 可下载 PNG            | 暂未实现   | 小游戏内无 `<a download>`；如需可改为调用 `tt.saveImageToPhotosAlbum`                             |
| 跨设备同步 | 无                  | 无      | 按需求第 5 条，暂不实现                                                                        |

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

## 七、抖音平台能力接入

平台提审清单里的五项能力已全部接入，统一收在 **`minigame/src/caps.js`**。
游戏内入口在**经营面板首屏的「🎁 每日福利」卡片**（平台要求侧边栏入口放在主页面）。

| # | 能力 | 官方接口 | 默认 | 你要做什么 |
| - | ---- | ------- | --- | --------- |
| ③ | **侧边栏复访（必接）** | `tt.checkScene` / `tt.onShow` / `tt.navigateToScene` | 开 | 无需配置。宿主不支持时入口自动隐藏 |
| ② | 添加到桌面 | `tt.checkShortcut` / `tt.addShortcut` | 开 | 无需配置 |
| ④ | 订阅消息 | `tt.requestSubscribeMessage` | 关 | 控制台「运营 → 运营能力 → 订阅消息」拿模板 id，填进 `subscribeTmplIds`（最多 3 个） |
| ⑤ | 广告（激励 / 插屏） | `tt.createRewardedVideoAd` / `tt.createInterstitialAd` | 关 | 控制台「运营 → 变现 → 广告位」拿 id 填进两个 `AdUnitId`，**并把广告位状态切为启用** |
| ① | 内购 | `tt.requestGamePayment`（Android/PC）<br>`tt.openAwemeCustomerService`（iOS） | 关 | 需版号 + 已开通虚拟支付。把 `iap` 置 `true` 并填 `iapGoods` |

### 改配置的地方

全部在 `minigame/src/caps.js` 顶部的 `CFG`：

```js
var CFG = {
  sidebar: true,                 // ③
  shortcut: true,                // ②
  subscribeTmplIds: [],          // ④ 填 MSG 开头的模板 id
  rewardedAdUnitId: '',          // ⑤ 激励视频广告位
  interstitialAdUnitId: '',      // ⑤ 插屏广告位
  interstitialCooldown: 120,     // 插屏最小间隔（秒）
  adDailyLimit: 3,               // 激励视频每日可领次数
  iap: false,                    // ① 没有版号请保持 false
  iapZoneId: '1',
  iapGoods: [],                  // ① [{ id, name, qty, price(分), grantCash, grantIng }]
};
```

改完必须重新打包：`node tools/build-minigame.js`。

### 侧边栏复访链路（平台必接，不接会被审核拒绝）

```
启动时 tt.onShow 注册 ──► 持续更新 launch_from / location
玩家点「前往侧边栏」  ──► tt.navigateToScene({ scene: 'sidebar' })
玩家从侧边栏再次进入  ──► onShow 回调 launch_from='homepage'、location='sidebar_card'
回到游戏点「领取」    ──► 现金 + 全原料 30 份（每日 1 次）
```

两个官方反复强调的坑，代码里已经规避：

1. **`tt.onShow` 必须在启动时同步注册**。注册晚了收不到回调，玩家从侧边栏回来会领不到奖。
   `CAPS.init()` 在 `caps.js` 加载时就自调用（与 `platform.js` 的 `installStore` 同理）。
2. **必须用 `onShow` 的最新返回值判断**，不能用启动参数 —— 热启动时启动参数不更新。

### 三个容易踩的平台限制

- `tt.addShortcut` / `tt.requestSubscribeMessage` **必须由用户点击同步触发**。
  本作的 `doAct` 由 `tt.onTouchEnd` 直接驱动，所以 `caps.js` 里绝不能给它们包
  `setTimeout` / `Promise`，否则真机会报 `must be invoked by user gesture`。
- 激励视频**每个实例只能 `show()` 一次**，播完即释放。代码里在 `onClose` 后丢弃实例、下次重造。
- 插屏只放在「打烊结算 → 进入下一天」这个自然断点，且带 120 秒冷却。营业中途弹广告会毁掉连点手感。

---

## 八、平台规范检查清单（提审前）

- [ ] `game.json` 中 `deviceOrientation: "portrait"`（本作为竖屏）
- [ ] `project.config.json` 已填真实 AppID，**且含 `setting.es6`**（见下方排错）
- [ ] **五项平台能力已按上表配置完毕**（③ 默认开；④⑤① 需要后台配置）
- [ ] 已执行 `node tools/build-minigame.js`（它现在会顺带校验平台配置）
- [ ] `node tools/minigame-smoke.js` 全绿（含 21 项平台能力断言）
- [ ] 开发者工具内编译无警告
- [ ] 真机预览正常（见下方验证要点）

### 上传失败排错

**`TypeError: Cannot read properties of undefined (reading 'es6')`**

打包器（`byted-tma-pack_v3`）在 `transform` 阶段读 `project.config.json` 的
`setting.es6`，而该文件里**只有 `appid`、没有 `setting`** 就会直接崩 ——
报错栈里完全不提是哪个文件，很难定位。

`project.config.json` 的三个必需字段（缺一即崩）：

```json
{
  "appid": "tt...",
  "projectname": "bubble-tycoon",
  "setting": {
    "es6": true        ← 本作源码确实用了 ES6（箭头函数 / const / 展开运算符）
  }
}
```

两种修法，任选其一：

1. 直接改 `minigame/project.config.json`（仓库里已给出完整版本）。
2. 开发者工具右上角「详情 → 本地设置」里勾一次「ES6 转 ES5」，工具会自己写回 `setting`。
   注意：工具重写文件时可能把它精简掉，改完最好再打开确认一次。

`node tools/build-minigame.js` 现在会在打包前校验这三个文件与 `setting.es6`，
缺了会直接报错退出，不用等上传到平台才发现。

---

## 九、真机验证要点

详见 **`真机验证清单.md`**。

部署到线上见 **`DEPLOY.md`**（GitHub Pages / Netlify / 其它静态托管三套步骤）。
