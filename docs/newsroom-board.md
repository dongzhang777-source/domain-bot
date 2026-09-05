# AI 编辑部质量看板（Newsroom Quality Board）

> 编辑：小智（GLM-5.3-Flash 亲审）｜时段：每日 11:00-21:00｜机制：白名单采集 → 三层闸门 → 主编逐条亲审 → 终审发布

## 第一期（2026-09-04）

| 环节 | 数量 | 说明 |
|---|---|---|
| 六渠道原始采集 | 1396 | rss 1162 / github 104（双清单去重）/ exa 50 / v2ex 39 / bili 56 / yt 35 |
| 渠道白名单+负向黑名单 | → 750 | B站卖课/通识/YT 科普/GH 个人作业拦截 |
| AI 强相关闸门 | → 703 | 标题强命中或正文≥2 关键词 |
| 打分排序+渠道配额 | → 200 | 单渠道≤60 |
| **主编终审** | → **172** | 剔除 28：YouTube 通识 15、B站卖课 5、事件重复转述、GH 学习笔记等 |
| 双 bot 归属 | 深度思想 103 / 时事快线 69 | 按内容特征分类（研究长文 vs 新闻快讯） |

## 终审剔除明细（28 条）
- YouTube 通识科普 15 条（What are LLM Benchmarks? / Risks of LLM / I Built an LLM From Scratch 等）
- B站卖课/黑名单 5 条（就业课/免费不翻墙/锐评排名）
- GPT-6 Astra 事件重复转述多条（仅留 Reuters/TechCrunch/Guardian/arXiv 权威源）
- GitHub 个人学习笔记等

## 待办（下一期改进）
- [ ] 端侧引擎专项（proposal 已备，待排期）
- [ ] Twitter/Reddit 渠道（待 key/登录态）
- [ ] AI 编辑部 LLM 辅助初审（key 配置后，主编抽检）
