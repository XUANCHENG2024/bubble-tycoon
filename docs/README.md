# 文档索引

项目文档按用途分四类。**根目录只留三份**（README / DEPLOY / 真机验证清单），
其余全部在此索引。

> ★ 交叉引用统一写成 `《相对路径.md》`。
> `node tools/check-doc-refs.js` 会校验所有引用是否指向真实文件 ——
> **断掉的引用比没归档更糟**（后者至少文件还在原地），
> 所以每次加文档后跑一次，已接进 CI。

---

## 快速上手

| 文档 | 用途 |
|---|---|
| [../README.md](../README.md) | 项目总览 · 安装运行 · 系统说明 |
| [../DEPLOY.md](../DEPLOY.md) | 部署方式（GitHub Pages / Netlify / 静态托管） |
| [../真机验证清单.md](../真机验证清单.md) | **上线前必做**的 26 项真机验证 |
| [../上线资料.md](../上线资料.md) | 上线所需的素材与文案 |

---

## 设计规格（design）

动手前先读这些 —— 记录了「为什么这么设计」，避免后来者重复推演。

| 文档 | 内容 |
|---|---|
| [design/地图开分店系统-设计.md](design/地图开分店系统-设计.md) | `s.stores[]` 数据模型 · 店长托管 · 店长 AI 日结算 |
| [design/经营维度扩展-设计规格.md](design/经营维度扩展-设计规格.md) | 场地类型 / 经营城市 / 地图位置（V8 基础） |

## 实施记录（implementation）

每个特性改了什么、**为什么这么改**、踩了什么坑。

| 文档 | 特性 |
|---|---|
| [implementation/地图开分店系统-实施记录.md](implementation/地图开分店系统-实施记录.md) | V12 店铺实体 · 店长托管 · 关店 · 店铺升级 · 留档店长 |
| [implementation/城市地图与经营城市修复-实施记录.md](implementation/城市地图与经营城市修复-实施记录.md) | V13 城市地图 · 「经营城市」点击无响应的根因与修复 |
| [implementation/店长招募系统-实施记录.md](implementation/店长招募系统-实施记录.md) | V11 店长招募 · 名额与加成不外溢 |
| [implementation/城市菜系研发树成就奖励-实施记录.md](implementation/城市菜系研发树成就奖励-实施记录.md) | V10 研发树 · 城市菜系 · 成就奖励 |
| [implementation/玩法多样性第一批-实施记录.md](implementation/玩法多样性第一批-实施记录.md) | 天气 · 竞品 · 活动 · 合同 |
| [implementation/玩法多样性第二批-实施记录.md](implementation/玩法多样性第二批-实施记录.md) | 特调饮品 · 特殊顾客 · 招牌 |
| [implementation/玩法多样性第三批-实施记录.md](implementation/玩法多样性第三批-实施记录.md) | 地区口味差异 · 里程碑压力 |

## 评估与方案（plans）

做之前的方向性判断 —— **含被否决的方案与理由**，避免走回头路。

| 文档 | 内容 |
|---|---|
| [plans/玩法多样性评估与迭代方案.md](plans/玩法多样性评估与迭代方案.md) | 三批玩法扩展的取舍依据 |
| [plans/留存与复玩改进方案.md](plans/留存与复玩改进方案.md) | 留存设计 · 复玩动机 |

## 检查与复查报告（reports）

体检记录 —— 结论与修复项。**这些是历史快照，不是当前状态**；
判断现状请看 README 与代码。

| 文档 | 范围 |
|---|---|
| [reports/界面评估与优化建议-第二轮.md](reports/界面评估与优化建议-第二轮.md) | V13.1 界面问题清单与优先级建议（**最新一轮界面评估**） |
| [reports/界面评估与优化建议.md](reports/界面评估与优化建议.md) | 第一轮界面评估（字号令牌 / Canvas Tab 文字的来源） |
| [reports/检查与验证报告.md](reports/检查与验证报告.md) · [第二轮](reports/检查与验证报告-第二轮.md) | 功能完整性检查 |
| [reports/全量检查验证报告.md](reports/全量检查验证报告.md) | 全量验证 |
| [reports/优化扫描报告-第三轮.md](reports/优化扫描报告-第三轮.md) | 性能与体验扫描 |
| [reports/复查报告.md](reports/复查报告.md) · [第二轮](reports/复查报告-第二轮.md) · [第三轮](reports/复查报告-第三轮.md) | 三轮复查历史（保留决策轨迹） |

---

## 当前回归状态（供快速判断基线）

```
probe            352→405 项    引擎不变式（含 T 组城市可用性）
browser-smoke    208 项       真实 DOM 冒烟
minigame-smoke   260 项       Canvas 端对等
e2e-flow         32 项        主流程
verify-checklist 18 项        上线清单自动化
dom-smoke / mobile-smoke / symbol-check / xss-verify
diag-coupling / diag-edge / diag-ui / diag-balance / online-smoke
```

跑全部：

```bash
for t in probe dom-smoke browser-smoke minigame-smoke mobile-smoke \
         symbol-check xss-verify e2e-flow verify-checklist \
         diag-coupling diag-edge diag-ui; do
  node tools/$t.js >/dev/null 2>&1 && echo "PASS $t" || echo "FAIL $t"
done
```

平衡模拟（改动数值相关时必跑）：

```bash
node tools/sim.js 16
```