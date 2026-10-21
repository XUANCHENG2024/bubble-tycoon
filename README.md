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
├── 上线资料.md                 ── 名称 / 图标 / 文案 / 资质清单 / 提审核对
├── 留存与复玩改进方案.md        ── 留存诊断（实测数据）+ F1~F10 / B1~B3 改进清单与优先级
├── 复查报告-第三轮.md           ── 第三轮系统性复查的问题与处置
├── index.html                 ── H5 版入口
├── styles.css                 ── H5 版样式
├── assets/
│   ├── icon-512.png           ── 游戏图标（512×512 直角，上传这个）
│   ├── icon-1024.png          ── 图标高清母版
│   └── icon-192.png           ── 小尺寸预览 / favicon
├── legal/
│   ├── privacy.html           ── 隐私政策（提审必填链接）
│   └── terms.html             ── 用户协议（提审必填链接）
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
    ├── diag-balance.js        ── 平衡诊断（配对比较 + 噪声底对照）
    ├── dom-smoke.js           ── H5 冒烟
    ├── browser-smoke.js       ── H5 真实 DOM 冒烟
    ├── mobile-smoke.js        ── H5 移动端兼容
    ├── minigame-smoke.js      ── 小游戏冒烟
    ├── probe.js               ── 引擎探针（非常规路径）
    ├── symbol-check.js        ── 全局符号冲突检查
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
node tools/probe.js            # 引擎探针（脏存档 / 阶段错配 / 退化局面 / 长跑不变量）
node tools/symbol-check.js     # 全局符号冲突（顶层 const 重名会让后加载的文件整份失效）
node tools/bench.js 3          # 性能基准（热路径实测 + 低端机 ×10 推算）
node tools/sim.js 40           # 数值平衡（40 局）
node tools/sim.js 12 --chain=6 # 连玩 6 局曲线（判断跨局成长会不会越玩越糟）
node tools/sim.js 20 --bp=150  # 指定声望点做横截面对照
node tools/sim.js 40 --cards=random  # 策略卡平衡（none/first/random 三口径对照）
node tools/sim.js 12 --chain=8        # 连玩 8 局曲线（跨局成长会不会越玩越糟）
node tools/sim.js 12 --chain=8 --nosig # 连玩对照：关掉招牌配方的跨局继承
node tools/diag-balance.js 30         # 平衡诊断：逐个关掉新系统，量化各自对达标率的贡献
```

当前状态（全部通过）：

| 套件             | 项数    | 结果                                  |
| -------------- | ----- | ----------------------------------- |
| dom-smoke      | 32    | ✅                                   |
| browser-smoke  | 136   | ✅（含满员渲染 / 键盘守卫 / 完整 30 天到自然收官 / 两批玩法多样性 UI / 经营维度三级联动与坐标校验） |
| mobile-smoke   | 31    | ✅                                   |
| minigame-smoke | 212~213 | ✅（含弹窗滚动 / 教程全步骤 / 引导跟随滚动 / 经营维度两版对等；随机事件与部分条件分支只在当天真的触发时才计入，所以总数会 ±1） |
| probe          | 197   | ✅ 引擎探针（脏数据 / 阶段错配 / 退化局面 / 账目自洽 / 跨局一致性 / 跨流程闭环 / 两批玩法多样性机制 / 经营维度字段校验与存量兼容） |
| symbol-check   | 2 组  | ✅ 无顶层符号冲突（防「后加载的文件整份失效」）     |
| xss-verify     | —     | ✅ 注入未得逞（4 组 payload 均作为纯文本存在）   |
| sim 40 局       | —     | ✅ easy 169~183% / normal 97~100% / hard 74~76%（AI 用 `Math.random()`，逐轮有波动） |
| sim 连玩 8 局    | —     | ✅ normal 102%→111%（曲线持平微升，无衰减）；招牌等级 Lv.1→Lv.3 需连打多局 |
| sim 策略卡三口径 | —     | ✅ none 94% / first 92% / random 92%（normal，40 局/档） |
| diag-balance   | 5 组  | ✅ 平衡诊断：逐个关掉新系统做**配对比较**，含「等额无关补贴」噪声底对照 |

---

## 四、玩法速览

- **目标**：30 天内把净资产做到目标金额；现金连续 2 天为负则破产
- **每天循环**：进货 → 配菜单与定价 → 开门营业（26 秒实时）→ 结算 → **打烊三选一** → 投资
- **营业操作**：连点出杯位可加速，会累积连击，小费最高翻倍
- **经营策略卡**：每 3 天打烊时抽 3 张，最多持有 6 张，可选「都不要」。
  12 张卡**张张有得有失**（例：外卖平台 客流 +25% / 每杯收入 -¥0.8；中央厨房 原料 -14% / 工资 +14%），
  只改收益结构、不改收益总量（实测 normal/hard 达标率漂移 ≤2pp），本局内持续生效
- **系统**：顾客 5 类、天气 6 种、随机事件 17 个、成就 32 个、员工特质 7 种、对手反制 3 种
- **模式**：标准 30 天 / 无尽模式 / 每日挑战（全网同一种子）
- **每日挑战日榜**：每天全网共用同一个种子 —— 同一张价格表、同一批顾客、同一串事件，
  比的只有经营决策。一天可以打很多局，榜单记的是**当天最好的那一局**（更差的一局既不上榜也不上报）。
  小游戏端走抖音原生 `tt.setImRankData` / `tt.getImRankList`（`rankType:'day'`，平台自己画榜单 UI）；
  平台能力不可用时两版都降级到本机「今日最好 / 个人最佳 / 最近 7 天」，入口不消失
- **每日任务**：每天开局刷 3 条（出杯 / 营业额 / 净利 / 手速 / 潮流 / 进货 / 升级 / 研发 / 招人 / 零流失），
  达成即时到账现金，跨天换血；目标随天数上抬并封顶，奖金刻意压在「锦上添花」档
- **连续登录**：标题页签到，连登越久创业基金越多（`min(¥200, 30+25×天数)`），开局到账；
  断签重置、一天一次、忘点也会在开局自动补签
- **每日合同**：每天开局给 1 个当日目标（出杯 / 营收 / 净利 / 满意率 / 连击 / 零流失 / 网红 / 薄利多销 / 高端形象 / 潮流），
  **开门前就摆在备货页**（决策窗口前移），打烊结算；未达成扣少量口碑，难度不同扣得不同
- **章节关卡**：30 天切成 6 章（每章 5 天），每章 3 关按顺序打通。
  备货阶段选 ⚪普通 / 🔵精英 / 🟣传奇 三档难度 —— 门槛 ×1.0/1.35/1.8、奖励 ×1.0/1.8/3.0。
  与每日合同是**两个时间尺度**（今天 / 这一章）；**未达成不扣口碑**，只失奖励
- **招牌配方**：某款配方**累计**卖出 250 / 700 / 1500 杯，逐级成为「小有名气 / 街坊认可 / 城市名店」，
  加成只对**那一款**生效（销量权重 / 售价 / 每杯成本）。
  累计销量**跨局继承** —— 「这一局把芋泥练成招牌」是真正的跨局策略（专精一款 vs 铺开十款）
- **事件型顾客**：每天最多 1 位特殊顾客，队列里带 ★ 角标，一眼能认出来。
  🧑‍🍳 美食评论家（服务好 +4 口碑 / 服务差 −2）、🛒 团购大单（一单 4~6 杯，耐心只有常规 70%）、
  💝 熟客回购（价格容忍 +15%、小费 +60%）。与常规顾客**1:1 替换**，总客流严格不变
- **结局四维评级**：收官时按利润 / 口碑 / 服务 / 经营四维各评一个称号（每维两档），
  同一个 S 级有多种拿法 —— 走口碑流和走利润流是两种不同的经营叙事
- **中期目标**：每 5 天一个净资产锚点（Day 5/10/15/20/25/30），达成记一次声望 +1，
  经营面板实时显示「还差多少 / 已达成」
- **结算环比**：打烊结算显示「较昨日」的营收 / 杯数 / 流失 / 净利涨跌
- **本机战绩榜**：跨局保留最好的 5 局（难度 · Day · 达标/破产/无尽阶数）
- **跨局成长（品牌声望）**：声望点折算为**开局创业基金**，`⌊45×√声望⌋` 封顶 ¥900，
  这笔钱由玩家自己决定投去雇人 / 提速 / 开店。
  声望**不直接加客流** —— 需求单方面变强而供给不涨，会让客人多到来不及做，实测反而更容易破产。
  成就的 ★ 只在**跨局首次**达成时发放（32 条共 150 ★），重复达成仍给现金
- **经营维度**：门店的经营属性（⚠️ 属店铺配置，不影响每日玩法数值）
  - **场地类型**：10 种（商场 / 步行街 / 景区 / 写字楼 / 社区 / 校园 / 交通枢纽 / 医院 / 厂区 / 乡镇），**数据驱动可扩展**（加一行即可，无需改逻辑）
  - **经营城市**：限中国大陆，省 → 市两级**全量内置**（34 省 / 272 市）；区级为**可选粒度**，未收录的城市自动降级为「仅到市级」
  - **经营地图位置**：标记经营地点，坐标系固定 **GCJ-02（高德）**，带境内范围校验；**未选点时是 null，不用默认坐标冒充真实经营地**
    - 44 个主要城市支持「定位当前城市」（写入市中心坐标，之后可用地图选点精确到店）
  - **存量兼容**：老存档完全没有这三个字段，读档时由清洗器补默认值；脏数据（字典外 id / 越界坐标 / 省市区错配）自动收敛，且**不升存档版本号**
  - 设计细节与后端（Java + MySQL）迁移口径见《经营维度扩展-设计规格.md》
- **存档**：3 个槽位，可导出存档码跨设备搬运

---

## 五、两版的已知差异

| 项     | H5 版               | 小游戏版                    | 说明                                                                                     |
| ----- | ------------------ | ----------------------- | -------------------------------------------------------------------------------------- |
| 音效    | WebAudio 实时合成（8 种） | 3 个离线合成 WAV（tap/up/down） | 小游戏无 AudioContext。音效文件由 `tools/gen-sfx.js` 生成到 `minigame/audio/`（合计约 17KB），按频率自动挑文件                                                                                               |
| 分享    | 下载战绩 PNG 后自行分享     | `tt.shareAppMessage`    | 结局页入口，宿主不支持时按钮不出现                                                                        |
| 存档码导入 | 可直接粘贴              | 从剪贴板读取                  | 小游戏无文本输入框 |
| 存档码导出 | 弹窗 + 复制            | 复制进剪贴板                  | 标题页「📤 导出」 |
| 战绩卡片  | 可下载 PNG            | 暂未实现                    | 小游戏内无 `<a download>`；如需可改为调用 `tt.saveImageToPhotosAlbum`                                 |
| 每日挑战日榜 | 本机记录（今日最好 / 个人最佳 / 近 7 天） | 本机记录 + 「🌐 查看全网日榜」按钮      | 全网日榜走抖音原生 `setImRankData` / `getImRankList`（平台自己画榜单 UI，不需要开放数据域）。自定义 UI 才需要 `getImRankData`，而它必须在开放数据域里调用 —— 单 bundle 架构下不做 |
| 跨设备同步 | 无                  | 无                       | 按需求第 5 条，暂不实现                                                                           |

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

平台提审清单里的能力已全部接入，统一收在 **`minigame/src/caps.js`**。
游戏内入口在**经营面板首屏的「🎁 每日福利」卡片**（平台要求侧边栏入口放在主页面）；
⑦ 的入口在标题页「🏆 日榜」与每日挑战的结局页。

| # | 能力 | 官方接口 | 默认 | 你要做什么 |
| - | ---- | ------- | --- | --------- |
| ③ | **侧边栏复访（必接）** | `tt.checkScene` / `tt.onShow` / `tt.navigateToScene` | 开 | 无需配置。宿主不支持时入口自动隐藏 |
| ② | 添加到桌面 | `tt.checkShortcut` / `tt.addShortcut` | 开 | 无需配置 |
| ④ | 订阅消息 | `tt.requestSubscribeMessage` | 关 | 控制台「运营 → 运营能力 → 订阅消息」拿模板 id，填进 `subscribeTmplIds`（最多 3 个） |
| ⑤ | 广告（激励 / 插屏） | `tt.createRewardedVideoAd` / `tt.createInterstitialAd` | 关 | 控制台「运营 → 变现 → 广告位」拿 id 填进两个 `AdUnitId`，**并把广告位状态切为启用** |
| ① | 内购 | `tt.requestGamePayment`（Android/PC）<br>`tt.openAwemeCustomerService`（iOS） | 关 | 需版号 + 已开通虚拟支付。把 `iap` 置 `true` 并填 `iapGoods` |
| ⑥ | 分享 | `tt.shareAppMessage` | 开 | 无需配置。宿主不支持时按钮不出现 |
| ⑦ | 每日挑战日榜 | `tt.setImRankData` / `tt.getImRankList` | 开 | 控制台「运营能力 → 排行榜」确认已开通即可；`zoneId` 是自定义分区标识，不需要预先配 key |

> ⑦ 用的是**抖音原生**的排行榜 API，不是微信那套 `setUserCloudStorage` + 开放数据域：
> 后者要求把 key 在后台配成「排行榜标识」，且自定义 UI 只能渲染到 sharedCanvas（独立子包）。
> 抖音这边 `getImRankList` 由平台直接画出榜单 UI，只有想自定义 UI 才需要 `getImRankData`
> —— 而它必须在开放数据域里调用，对当前「单 bundle 拼接」的架构是实打实的成本，因此没做。

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
  rank: true,                    // ⑦ 每日挑战日榜
  rankZoneId: 'daily',           // ⑦ 分区标识（每个小游戏除 default/test 外最多 10 个）
  rankType: 'day',               // ⑦ day / week / month / all
  rankTitle: '每日挑战 · 净资产榜',
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
- **排行榜的两个 API 都要求已登录**（错误码 `21101 / 10601 not login`，拉榜未登录还会闪退）。
  所以 `CAPS.init()` 里就 `tt.login` 预热一次；预热之后 `openRank()` 在触摸回调里能**同步**
  走到 `getImRankList`，不会脱离用户手势上下文。
- **上报的 `value` 是字符串、必须是 `[0, int32_MAX)` 的正整数**。破产时净资产可能为负，
  所以 `rankScore()` 会先夹一遍 —— 越界平台直接报 `invalid param`，而且不会告诉你为什么。
- **榜单每次上报是覆盖，不是取最大**。所以只在「刷新了当天最好成绩」时才上报
  （判定在引擎的 `recordDaily` 里），否则一局摆烂成绩会把自己的名次冲掉。

---

## 八、平台规范检查清单（提审前）

- [ ] `game.json` 中 `deviceOrientation: "portrait"`（本作为竖屏）
- [ ] `project.config.json` 已填真实 AppID，**且含 `setting.es6`**（见下方排错）
- [ ] **平台能力已按上表配置完毕**（③②⑥⑦ 默认开；④⑤① 需要后台配置）
- [ ] 已执行 `node tools/build-minigame.js`（它现在会顺带校验平台配置）
- [ ] `node tools/minigame-smoke.js` 全绿（含 21 项平台能力断言 + 19 项日榜断言）
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

上线要填的名称、图标、文案、资质清单见 **`上线资料.md`**。

部署到线上见 **`DEPLOY.md`**（GitHub Pages / Netlify / 其它静态托管三套步骤）。
