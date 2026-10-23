# App 上架指南（iOS + Android）

> 方案：**Canvas 版 + Capacitor 自定义插件**（复用为移动端而生的 Canvas 渲染层）  
> 状态：代码就绪，**待真机验证 + 签名上架**



---

## 〇、一分钟总览

| 项              | 值                                              |
| -------------- | ---------------------------------------------- |
| 包名 / Bundle ID | `com.bubbletycoon.game`                        |
| 应用名            | 奶茶星球                                           |
| 技术栈            | Capacitor 7 + 原生插件（同步存储）                       |
| 复用内容           | `bundle.js`（Canvas 引擎，733KB）—— 与抖音小游戏**字节级同源** |
| 网络             | **完全离线**，不申请 INTERNET 权限                       |
| 数据             | 全部本地，**无账号、无服务器、无内购、无广告**                      |
| 引擎改动           | **零**（`js/engine.js` 一行未动）                     |

---

## 一、已完成的改造

### 1.1 新增文件

| 文件                                        | 作用                            |
| ----------------------------------------- | ----------------------------- |
| `app/capacitor.config.json`               | App 配置（appId / webDir / 沉浸式）  |
| `app/package.json`                        | Capacitor 依赖与构建脚本             |
| `app/android/.../BubbleStorePlugin.java`  | **同步**存储插件（SharedPreferences） |
| `app/ios/App/App/BubbleStorePlugin.swift` | **同步**存储插件（UserDefaults）      |
| `tools/build-app-web.js`                  | 构建 App web 产物（`app/www/`）     |
| `tools/gen-app-icons.js`                  | 生成各平台图标与启动屏                   |
| `tools/add-ios-swift-plugin.js`           | 把 Swift 插件加进 Xcode 工程         |
| `tools/check-app.js`                      | App 方案检查（39 项）                |

### 1.2 修改的既有文件

| 文件                         | 改动                                  | 为什么               |
| -------------------------- | ----------------------------------- | ----------------- |
| `minigame/src/platform.js` | 加 `isApp` 分支 + 同步存储 + Haptics + 返回键 | 平台层扩展，**引擎零改动**   |
| `minigame/src/main.js`     | App 自启动 + 返回键分层                     | App 里没人调 `boot()` |

### 1.3 ★ 三个关键设计决策

**① 为什么不用 `@capacitor/preferences`**

引擎（`js/engine.js`）的存储契约是**同步**的 —— `storageGet(key)` 必须立刻返回字符串。这是 V2 以来一直成立的契约（小游戏 API 与 localStorage 都同步）。

而 Capacitor Preferences 是 **Promise 异步**的。直接接上会怎样？

```
storageGet 全部返回 undefined
  → 读档全空、存档全丢
  → 而且不报任何错        ← 最难查的那种
```

底层其实本来就是同步的（Android `SharedPreferences` / iOS `UserDefaults`），是 Capacitor 的异步包装制造了冲突。

**所以写了原生插件 `BubbleStore`**，直接调原生同步 API —— **引擎一行都不用改**。

**② 为什么复用 Canvas 版而不是 H5 版**

H5 版是 DOM 渲染（57 张配方卡全量 `innerHTML` 重写），在 WebView 里低端机会卡。  
Canvas 版**纯自绘、不依赖 DOM**，还已经实现了伪 3D 等距舞台 + 深度排序 —— 这是原生级渲染。

**③ 为什么返回键逻辑放在 JS 层**

Android 的物理返回键默认是「关掉 Activity」，游戏会直接退出。  
层级判断（弹窗 → 引导 → 子页面 → 营业中 → 二次确认）依赖 `VIEW` 的状态，  
而 `VIEW` 在 JS 层 —— 放原生层就要把状态复制一遍，必然不同步。

---

## 二、构建

### 2.1 一次性准备

```bash
cd app && npm install
cd .. && node tools/gen-app-icons.js
cd app && npx cap sync
```

### 2.2 每次改代码后

```bash
node tools/build-app-web.js   # 构建 web 产物（含重打 bundle）
cd app && npx cap sync       # 同步到原生工程
```

### 2.3 打 Android 包

**前置**：JDK 17 + Android Studio + Android SDK（API 35）

```bash
cd app/android
./gradlew assembleDebug        # 调试包 → app/build/outputs/apk/debug/
./gradlew bundleRelease        # 上架包 → app/build/outputs/bundle/release/
```

### 2.4 打 iOS 包

**前置**：**Mac** + Xcode 15+ + Apple 开发者账号

```bash
cd app && npx cap sync
npx cap open ios               # 打开 Xcode
# Xcode 里选好签名团队 → Product → Archive → Distribute App
```

> ⚠️ **Windows 上无法完成 iOS 的编译与签名**，这是硬限制。

---

## 三、真机验证清单（**上架前必做**）

> ⚠️ 自动化测试**测不了**这些 —— jsdom 没有布局引擎，也没有真机。

### 3.1 启动与存储（最高优先级）

- [ ] 首次启动不白屏，1 秒内出游戏画面
- [ ] **存档往返**：玩到第 3 天 → 完全杀掉 App → 重开 → **进度还在**
- [ ] 玩到第 3 天 → 重启手机 → 重开 App → **进度还在**
- [ ] 换存档槽（3 个槽位）→ 重开后**槽位对应正确**
- [ ] 「重置进度」→ 重开 App → 确实是新游戏

> ★ 这一组是**本方案最大的风险点**（存储契约从同步换实现）。  
> ★ 验证方式：每玩一步就杀掉 App 重开，别只测一次。

### 3.2 触控手感

- [ ] 连点出杯位响应灵敏，无 300ms 延迟
- [ ] 触感反馈（iOS 需 Core Haptics；部分安卓机无马达）
- [ ] **Android 物理返回键**：
  - [ ] 弹窗打开时 → 关弹窗，**不退出**
  - [ ] 在研发/员工/商圈页 → 回到经营页
  - [ ] 营业中按返回 → 提示「再按一次退出」
  - [ ] 标题页按返回 → 提示，再按一次才退出
- [ ] iOS 无返回键（符合预期）

### 3.3 显示适配

- [ ] iPhone SE（4.7"）~ Pro Max（6.7"）都不裁切
- [ ] 刘海屏：顶部 HUD 不被灵动岛压住
- [ ] 手势条：底部按钮不被 Home Indicator 盖住
- [ ] 安卓小屏（5"）布局不散
- [ ] 全面屏手势导航条区域可点

### 3.4 音频

- [ ] 出杯音效正常
- [ ] **来电/闹钟打断后回来，游戏仍在跑且音频恢复**
- [ ] 静音键静音时游戏静音
- [ ] 切到后台再回来，**游戏时间没有流逝**

### 3.5 性能

- [ ] 低端安卓（2~3GB 内存）FPS 稳定 ≥ 45
- [ ] 连续营业 5 分钟不发热、不掉帧
- [ ] 长时间挂后台再回来不崩

---

## 四、上架配置

### 4.1 Android（Google Play）

| 项         | 值 / 说明                                  |
| --------- | --------------------------------------- |
| 账号        | Google Play Console，**一次性 $25**         |
| ★ 包名      | `com.bubbletycoon.game`                    |
| ★ 应用名    | 奶茶星球                                   |
| ★ 版本      | 1.0.0 (versionCode 1)                     |
| ★ 权限      | 只有 VIBRATE + WAKE_LOCK，**无 INTERNET**   |
| 包格式       | **AAB**（不是 APK）                         |
| 签名        | 上传密钥 + 应用签名密钥**双密钥体系**，**密钥必须备份**       |
| targetSdk | 35+（2026 年要求）                           |
| 权限        | `VIBRATE` + `WAKE_LOCK`（**无 INTERNET**） |
| 数据安全表     | 声明**不收集数据**、**不共享数据**                   |
| 内容分级      | 填写问卷（无暴力/无色情 → 全年龄）                     |
| 隐私政策      | **需要一个可访问的 URL**（即使不收集数据通常也要）           |

> ⚠️ **新个人开发者账号限制**：必须先邀请 **12 位测试者参与封闭测试满 2 周**才能申请正式发布。  
> ★ 这是**时间成本**（不可压缩），排期时必须留出来。

### 4.2 iOS（App Store）

| 项        | 值 / 说明                                |
| -------- | ------------------------------------- |
| 账号       | Apple Developer Program，**$99/年**（个人） |
| 工具       | Xcode（**需 Mac**）                      |
| 签名       | Xcode 自动签名，或 fastlane + `match`       |
| 部署目标     | iOS 16+                               |
| App 隐私问卷 | 声明**不收集数据**                           |
| 出口合规     | 无加密 → 简单声明                            |
| 「删除账号」   | **勾选不适用**（本作无账号）                      |
| 内购       | 无（免费游戏）                               |

**iOS 上架素材要求**

| 素材     | 规格                                                |
| ------ | ------------------------------------------------- |
| App 图标 | 1024×1024 PNG，**无透明通道**（✅ 现有 `icon-1024.png` 已符合） |
| 截图     | iPhone 6.9" / 6.5" / 5.5"（**至少 3 组，每组 2~5 张**）    |
| 预览视频   | 可选                                                |

---

## 四·五、签名密钥（★ 最不能出错的一步）

### 生成

```bash
set KEYSTORE_PASS=你的口令        # Windows
# KEYSTORE_PASS=你的口令 node tools/gen-keystore.js   # macOS/Linux
node tools/gen-keystore.js
```

产出两个文件（在 `app/android/`）：
- `bubbletycoon-upload.jks` —— **密钥本身**
- `keystore.properties` —— 路径与口令

★ 两个都已在 `.gitignore` 里（`*.jks` / `keystore.properties`）—— 绝不能进版本库。

### ★★★ 立刻备份 ★★★

**upload keystore 一旦上传到 Google Play，就与你的应用永久绑定了。**

| 后果 | 说明 |
|---|---|
| 丢了密钥 | **永远无法上传新版本**（除非申请 Google 人工重置，要提供证明材料）|
| 换了密钥 | Play 拒绝更新（签名不匹配）|
| 已上架的 App | ★ **不受影响** —— Play 用的是它自己保管的 app signing key |

★ 双重密钥体系：
- **upload keystore** —— 你保管，用来上传
- **app signing key** —— Play 保管，用来分发

★ 所以真正需要备份的只有 upload keystore 一个。
★ 存到密码管理器 + 云盘各一份，**不要只放这台电脑上**。

### 配到 CI（可选）

在 GitHub 仓库 → Settings → Secrets 加三个：
`KEYSTORE_BASE64`（`base64 -w0 key.jks` 的输出）· `KEYSTORE_PASS` · `KEY_ALIAS`

配好后 CI 会自动多出一个 release AAB 产物。

---

## 五、发布流程

### 5.1 Android

```
① Play Console 建应用（语言、分类：游戏 → 休闲）
② 上传 AAB → 内部测试（自己装一遍，验证上面清单）
③ 封闭测试：建轨道 → 邀请 12 人 → 等满 2 周
④ 申请「生产」发布资格
⑤ 提交审核（首次通常数小时到 3 天）
⑥ 正式发布（可选择立即或定时）
```

### 5.2 iOS

```
① Apple Developer 后台建 App ID + App Store Connect 记录
② Xcode 选好签名团队 → Archive → Distribute App → App Store Connect
③ 填元数据（截图、描述、关键词、年龄分级、隐私问卷）
④ 提交审核（首次通常 1~3 天）
⑤ TestFlight 内测（建议先跑一轮，审核更顺）
⑥ 发布
```

---

## 六、后续可选增强

按性价比排序：

| 项                                 | 价值 | 成本    | 说明                                       |
| --------------------------------- | -- | ----- | ---------------------------------------- |
| **PWA manifest + service worker** | 中  | 1-2 天 | 让 H5 版也能「装到桌面」离线用，**独立于 App 的低成本增量**     |
| 崩溃上报（Crashlytics）                 | 高  | 1 天   | 现在完全没有，真机问题只能靠用户反馈                       |
| 性能监控（FPS）                         | 中  | 1-2 天 | 真机才知道低端机表现                               |
| 应用内更新提示                           | 中  | 1 天   | App Store 更新是异步的                         |
| **推送通知**                          | 低  | 高     | ⚠️ 本作**无服务器**，做不了真推送；只能做本地通知（如「昨天招牌快满了」） |
| 深链                                | 中  | 2 天   | 从分享直接跳到某天/某配方                            |

---

## 七、已知限制与风险

| 风险                         | 影响                | 状态                                    |
| -------------------------- | ----------------- | ------------------------------------- |
| **iOS 编译需 Mac**            | Windows 上无法产出 IPA | ⏳ **需你准备 Mac 或找人协作**                  |
| **Google Play 封闭测试 2 周**   | 阻塞正式发布            | ⏳ 日历时间，不可压缩                           |
| **存储契约从同步换实现**             | 弄错 = 读档全空且不报错     | ✅ 已用原生同步插件解决 + 39 项检查覆盖               |
| **Canvas 在 WebView 的真机表现** | 可能有性能/兼容问题        | ⏳ **必须真机验证**（自动化测不了）                  |
| 图标是复制原图（非重新渲染）             | 边缘机型上略糊           | ⚠️ 可接受；高质量版用 `@capacitor/assets` 重新生成 |
| **iOS Swift 代码未编译验证**      | 可能有语法/API 错误      | ⏳ **需 Mac + Xcode 编译验证**              |

---

## 八、验证命令速查

```bash
node tools/check-app.js        # App 方案检查（39 项）
node tools/build-app-web.js    # 构建 web 产物
node tools/gen-app-icons.js    # 生成图标
node tools/add-ios-swift-plugin.js  # Swift 插件进 Xcode 工程
cd app && npx cap sync         # 同步原生工程
node tools/check-ui-spec.js    # 界面规范（确认没破坏）
node tools/minigame-smoke.js   # Canvas 端回归
```
