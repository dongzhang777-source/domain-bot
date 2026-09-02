# 自进化领域专家 Bot —— 通用框架设计方案

> **For Hermes:** 本方案为设计文档（plan-only，不执行）。批准后可走 subagent-driven-development 逐任务实现。

**Goal:** 设计并落地一个"领域可配置"的 AI Bot：自动抓取某领域最有价值信息并推送，且能通过反馈回路把积累内化为"专家记忆"，实现自进化——从转发者升级为洞察者。

**Architecture:** 三环模型——采集环(广) → 提炼环(深) → 进化环(闭环)。进化环是核心：bot 不重训模型，而是维护领域记忆库(向量+摘要档案)，每次筛选先检索记忆判断"是否已知/是否有增量"，记忆随时间累积=专家感；反馈信号(看/点/忽略)反哺源权重与价值判断。

**Tech Stack:** TypeScript(Node) 或 Python 均可；本地推理(可选 fati-local-service / llama.cpp / oMLX)做价值打分与摘要；向量检索(local-embed 或轻量 ANN)做记忆库；调度 cron/setInterval；推送接口抽象(webhook/IM/本地文件)。

---

## 一、Goal 与验收标准

### 1.1 目标
一个可运行的 MVP：给定一个"领域"(如 AI、加密货币、某行业)，bot 定时抓取多源信息 → 过滤噪音 → 聚类出"本周最有价值 3 条" → 推送 → 记录你的反馈 → 记忆库增长 → 下一轮抓取更精准。

### 1.2 验收标准(可证伪)
1. 采集：同一信息不重复推送(去重率 100%)。
2. 提炼：能从 100 条噪音中选出"真正有价值"的(由用户抽查确认)。
3. 进化：运行 3 轮后，bot 对"老出好信息的源"权重上升、对"已知旧闻"能识别并降低价值分。
4. 推送：通过可配置渠道送达(至少一种)。
5. 记忆：记忆库可导出、可回看、可人工修正(防 bot 自我固化)。

---

## 二、当前上下文 / 假设

- 领域：**先做通用框架，领域作为可配置参数**，后续再指定具体领域。
- 推送渠道：**先抽象接口，实现时再定**(默认命令行/本地文件，便于调试)。
- 运行环境：本工作区 `Projects/`，Node/TypeScript 生态为主。
- 与本工作区项目的联系(统领参考)：
  - `fati-server`(AI 内容生产与分发, 8 阶段管线, bandit 自演进)——本 bot 的"提炼环"可直接复用其管线思路与 bandit 权重自演进机制。
  - `tuna`(内容公共化、智能私有化, 端侧隐私)——本 bot 的"记忆库+画像"天然贴合"智能私有化"：画像/记忆不出设备，推送内容公共化。可做成 tuna 的一个消费终端。
  - `fati-local-service`(Rust 本地推理)——可做价值打分与摘要的本地底座。
  - 但本方案**保持独立、领域可配置**，不硬绑任何项目，先跑通再谈接入。

---

## 三、三环模型详细设计

### 3.1 环1：采集环(广)
- **源注册表**(`sources.json`)：每源有 `id/name/type/url/cron/weight/status`。
- **类型适配器**(adapter)：RSS、X/微博、Reddit、B站、GitHub、arXiv、雪球、自定义网页。每个 adapter 输出统一 `RawItem` 结构。
- **增量抓取**：按 `cron` 调度，抓取后按内容哈希去重，增量入库。
- 本工作区 `agent-reach` 技能已覆盖 15 平台多后端路由，可作为采集源扩展参考。

统一 RawItem 结构：
```ts
interface RawItem {
  id: string            // 内容哈希
  source: string        // 源 id
  title: string
  body: string          // 原文/摘要
  url: string
  publishedAt: number   // 时间戳
  raw: unknown          // 源原始数据(保留)
}
```

### 3.2 环2：提炼环(深)
三段流水线，每段可插拔：
1. **相关性过滤**：领域过滤(关键词+记忆库检索判定是否属本领域)。
2. **价值打分**：本地模型对每条问 3 个问题：
   - 对领域内决策是否有用？
   - 是否新信息(相对记忆库)？
   - 是否反常识/高杠杆？
   输出 `valueScore`(0-1) + 理由。分数低于阈值丢弃。
3. **聚类摘要**：把高分项聚成 N 个趋势簇，每簇生成"本周 3 个最重要趋势"式摘要，只推精华。

输出 `Digest` 结构：
```ts
interface Digest {
  generatedAt: number
  domain: string
  clusters: Array<{
    id: string
    title: string
    summary: string
    items: RawItem[]
    why: string   // 为什么值得看
  }>
}
```

### 3.3 环3：进化环(闭环)——核心
**不重训模型**，用"领域记忆库 + 反馈回路"实现自进化：

1. **领域记忆库**(`memory/`)：
   - 向量索引：每条优质信息嵌入为向量，用于"是否已知/是否增量"判定。
   - 摘要档案：按主题簇归档，附 `firstSeenAt/lastSeenAt/hitCount/decay`。
   - 可导出/可人工修正(防固化)。
2. **反馈信号**：推送后记录你的行为 → `viewed/clicked/dismissed`，转成隐式价值分。
3. **周期性进化**(每周一次，可配置)：
   - **源权重进化**：哪个源老出好信息(被点击/高分比例高)→ 加权；老出噪音→降权。
   - **价值判断进化**：用"被验证为高价值"的样本，校准价值打分器的阈值/提示词(可做轻量 prompt 蒸馏，不做微调)。
   - **记忆衰减**：旧闻 `decay` 增长，让 bot 更关注"真增量"。
4. **进化产出物升级**：从"转发"升级为"洞察"——基于记忆库生成领域趋势判断/预测(可证伪、可记分)。

进化三阶段表现(验收点)：
- 阶段1：只会转发好文。
- 阶段2：开始加权优质源、识别旧闻。
- 阶段3：产出洞察/预测，像领域专家。

---

## 四、技术选型与文件规划

建议独立目录(可放工作区根或独立仓库)：`domain-bot/`。

```
domain-bot/
  package.json
  tsconfig.json
  .env.example            # 模型/推送渠道配置
  config/
    domain.json           # 领域配置(可切换)
    sources.json          # 采集源注册表
    push.json             # 推送渠道配置
  src/
    collector/            # 环1 采集
      adapters/           # RSS/X/Reddit/B站/GitHub/arXiv/雪球...
      scheduler.ts        # cron 调度
      dedupe.ts           # 内容哈希去重
    refinery/             # 环2 提炼
      filter.ts           # 相关性过滤
      scorer.ts           # 价值打分(本地模型)
      cluster.ts          # 聚类摘要
    memory/               # 环3 进化
      vector-store.ts     # 向量记忆库
      archive.ts          # 摘要档案
      feedback.ts         # 反馈信号记录
      evolve.ts           # 周期进化(源权重/价值校准/记忆衰减)
    push/
      channels/           # webhook/IM/本地文件(抽象接口)
      notifier.ts
    types.ts              # RawItem/Digest/Feedback 统一类型
    index.ts              # 入口: 调度 + 流水线编排
  tests/                  # 每个模块 TDD
    collector.test.ts
    refinery.test.ts
    memory.test.ts
    push.test.ts
  memory/                 # 运行时数据(向量+档案, 可导出)
  README.md               # 使用文档
```

可选接入点(后续)：
- 价值打分/摘要 → `fati-local-service`(本地推理) 或 oMLX/llama.cpp。
- 记忆库+画像 → 对齐 `tuna`"智能私有化"哲学(画像不出设备)。
- 提炼管线 → 复用 `fati-server` 管线思路与 bandit 权重演进。

---

## 五、分步实施计划(TDD, 每步 2-5 分钟)

> 每个 task 完整走 TDD：写失败测试 → 跑验证失败 → 最小实现 → 跑验证通过 → commit。

### Task 1: 项目骨架
- 创建 `domain-bot/package.json`、`tsconfig.json`、`config/*.json`、`src/types.ts`。
- 验证：`npx tsc --noEmit` 通过；`types.ts` 导出 RawItem/Digest/Feedback。

### Task 2: 内容哈希去重
- 写 `tests/dedupe.test.ts`: 相同内容只入一次；轻微改写(标题/正文顺序)判定为不同(可配置阈值)。
- 实现 `src/collector/dedupe.ts`。

### Task 3: RSS/网页采集 adapter
- 写 `tests/collector.test.ts`: 给定 RSS 样例，产出结构化 RawItem；增量只抓新增。
- 实现 `src/collector/adapters/rss.ts` + 调度器 `scheduler.ts`。

### Task 4: 相关性过滤
- 写 `tests/filter.test.ts`: 领域关键词+记忆库判定，噪音被滤掉。
- 实现 `src/refinery/filter.ts`。

### Task 5: 价值打分(本地模型接口)
- 写 `tests/scorer.test.ts`: mock 模型返回分数；低于阈值丢弃。
- 实现 `src/refinery/scorer.ts`(模型接口抽象, 可 mock 可接本地推理)。

### Task 6: 聚类摘要
- 写 `tests/cluster.test.ts`: 相似高分项聚成一簇，生成 why 摘要。
- 实现 `src/refinery/cluster.ts`。

### Task 7: 记忆库(向量+档案)
- 写 `tests/vector-store.test.ts`: 检索"是否已知/是否增量"；档案归档与衰减。
- 实现 `src/memory/vector-store.ts` + `archive.ts`。

### Task 8: 反馈信号
- 写 `tests/feedback.test.ts`: viewed/clicked/dismissed 转隐式价值分。
- 实现 `src/memory/feedback.ts`。

### Task 9: 周期进化
- 写 `tests/evolve.test.ts`: 源权重随好源/噪音升降；价值判断校准；记忆衰减。
- 实现 `src/memory/evolve.ts`。

### Task 10: 推送接口
- 写 `tests/push.test.ts`: 抽象接口, 至少本地文件通道可用。
- 实现 `src/push/notifier.ts` + `channels/*`。

### Task 11: 端到端编排 + 集成测试
- 写 `tests/e2e.test.ts`: mock 源 → 采集 → 提炼 → 记忆 → 推送 → 反馈 → 进化, 跑通闭环。
- 实现 `src/index.ts` 编排入口。

### Task 12: 文档 + 领域可配置验证
- 写 `README.md`(使用/配置/进化说明)；验证切换 `config/domain.json` 领域后流水线不炸。

---

## 六、验证

- 单元测试：`cd domain-bot && npm test`(或 vitest)。
- 类型检查：`npx tsc --noEmit`。
- 端到端：`tests/e2e.test.ts` 用 mock 源跑通三环闭环。
- 手动验证：`npm run start` 抓一次真实源 → 看推送文件内容是否有价值、去重是否生效。
- 编辑后验证(本工作区 AGENTS.md 铁律)：任何源码/配置/测试改动后必须跑 `npm test`，通过才 commit。

---

## 七、风险、权衡与未决问题

- **价值判断的"高级感"**：冷启动时价值打分器不够"懂行"，需要用户抽查反馈校准(进化环的意义)。权衡：先关键词+人工反馈，后接本地模型。
- **自进化的固化风险**：记忆库可能自我强化偏见(只看爱看的)。缓解：记忆可导出/可人工修正、记忆衰减、源多样性配额。
- **模型成本**：本地推理省 API 费但慢；云 API 快但贵。权衡：本地做初筛，云端做精筛(可配置)。
- **推送打扰**：价值阈值过低会刷屏。缓解：每日限量(如最多 3 条趋势)+ 反馈降权。
- **未决问题**：
  1. 具体领域(用户选"后续再定"，框架先通用)。
  2. 推送渠道(接口先抽象，实现时再选)。
  3. 本地 vs 云端模型(默认本地可 mock，后续接 fati-local-service)。
  4. 是否最终接入 fati-server/tuna(本方案先独立跑通)。

---

## 八、执行交接

方案已存至 `.hermes/plans/2026-09-01_150921-domain-expert-bot.md`。
批准后可执行：走 subagent-driven-development，每任务派发独立 subagent，两段审查(先规格符合性、后代码质量)，两审都过才推进。
