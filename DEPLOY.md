# 在线部署说明

本作是**纯静态站点**：只有 `index.html` + `styles.css` + `js/`，没有后端、没有构建步骤。
所以任何静态托管都能直接托管，任选下面一种。

部署前必须先确认一件事：

```bash
node tools/build-minigame.js   # 只有改过 minigame/src 才需要，H5 版无需构建
```

> H5 版（根目录）**不需要任何构建**，直接把整个文件夹扔上去即可。

---

## 方案 A：GitHub Pages（推荐，URL 永久归你）

最终地址形如：`https://<用户名>.github.io/bubble-tycoon`

### A-1 最快：网页拖拽（不用命令行）

1. 打开 https://github.com/new ，仓库名填 `bubble-tycoon`，选 **Public**，**不要**勾选任何初始化选项
2. 创建完成后，在仓库页点 **uploading an existing file**（或 Add file → Upload files）
3. 把本文件夹内**除 `minigame/bundle.js` 以外**的全部内容拖进去，提交
4. 进入仓库 **Settings → Pages**
5. Source 选 **Deploy from a branch**，Branch 选 **main**、目录选 **/(root)**，Save
6. 等 1~2 分钟，刷新 Pages 页面即可看到访问地址

### A-2 用命令行

```bash
cd bubble-tycoon
git init
git add .                      # .gitignore 会自动排除 minigame/bundle.js
git commit -m "奶茶星球 · Bubble Tycoon"
git branch -M main
git remote add origin https://github.com/<用户名>/bubble-tycoon.git
git push -u origin main
```

然后同样到 **Settings → Pages** 开启（Branch: main / root）。

### A-3 用 GitHub Actions 自动部署（改代码即上线）

在仓库里新建 `.github/workflows/pages.yml`：

```yaml
name: Pages
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .            # 只放静态文件，.gitignore 会过滤掉不需要的
      - id: deployment
        uses: actions/deploy-pages@v4
```

仓库 Settings → Pages 里把 Source 改成 **GitHub Actions**。

---

## 方案 B：Netlify（免 git，拖一下就上线）

1. 打开 https://app.netlify.com/drop
2. 把整个 `bubble-tycoon` 文件夹拖到页面上的虚线框里
3. 部署完成后会得到一个 `https://xxxx.netlify.app` 地址

想绑定 Git 自动部署：Netlify → Add new site → Import an existing project → 连 GitHub 仓库，
构建命令留空，发布目录填 `/`。

> 注意：Netlify 对目录名里的 **中文、空格** 比较敏感。若拖放后打不开，
> 把文件夹名改成一个纯英文短名再拖一次。

---

## 方案 C：其它任意静态托管

Cloudflare Pages / Vercel / 腾讯云 COS / 阿里云 OSS 等都可以，
通用配置只有两条：

| 配置项 | 值 |
|---|---|
| 构建命令 | **留空**（本作无需构建） |
| 发布目录 | **仓库根目录**（因为 `index.html` 在根） |

---

## 上线后要确认的 5 件事

| # | 检查点 | 为什么 |
|---|---|---|
| 1 | 打开链接能直接进开始界面 | 入口是根目录的 `index.html` |
| 2 | 浏览器地址栏是 **https** | 音效（WebAudio）与 iOS 的部分能力在非安全上下文下会被禁用 |
| 3 | 玩一局后刷新，进度还在 | 验证 localStorage 正常（https 下才可靠） |
| 4 | 手机上打开，布局没有被地址栏遮挡 | 见 `真机验证清单.md` 的 5.2 / 5.3 |
| 5 | 控制台无报错 | F12 → Console |

---

## 常见问题

**Q：为什么打开是 404？**
A：多半是发布目录选错了。`index.html` 必须在**根目录**，不是 `bubble-tycoon/` 子目录里。

**Q：为什么能打开但没有音效？**
A：检查是不是 http。GitHub Pages / Netlify 默认都是 https，正常不会有这问题；
若是自建服务器，请配好证书。

**Q：为什么刷新后进度没了？**
A：浏览器隐私模式下 localStorage 会被禁用，游戏内会给出「存储不可用」提示，属预期行为。

**Q：`minigame/` 目录要不要一起传？**
A：H5 版用不到它。留着不影响（只是多几 KB），删掉也完全可以 —— 小游戏版是给抖音开发者工具用的，
与网页部署互不相干。

---

## 抖音小游戏上线（与以上无关，别混在一起）

小游戏版走的完全是另一条路：

1. `node tools/build-minigame.js`
2. 抖音开发者工具导入 `minigame/`，填 AppID
3. 开发者工具内上传 → 提审

小游戏**不能**托管在静态服务器上，两者互不替代。
