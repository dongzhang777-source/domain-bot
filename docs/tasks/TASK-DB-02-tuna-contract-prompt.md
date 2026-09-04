# TASK-DB-02：tuna 端摄入契约可行性验机（tuna-brief-v0 ↔ tuna Post/Brief 对齐）

> 工单号：DB-02　｜　创建：2026-09-04　｜　创建人：总管（小智，代理总管）
> 基线 HEAD：`domain-bot @ f03ee4f`（npm test 146/146 绿）；审查对象 `tuna` 仓（只读，HEAD 以本机为准）
> 工作目录：`/Users/aiatwork/Projects`（两个子仓均**只读**）
> 推荐通道：cbc（hy3，免费；有 playwright/模拟器验机经验，本任务为契约审查）
> 预计工时：1~2 小时
> 优先级：P1（tuna 渠道契约未对齐前，domain-bot 的 tuna 分发只是单向写文件，无人消费）
> 所属台账：`docs/HANDOFF-DEPUTY-2026-09-04.md` 附录（代理期动作台账）

---

## 〇、必读（不看会做错）

1. **你只做只读审查，不修改、不 commit、不 push 任何仓**（DISPATCH-RULES §三.4）。tuna 仓代码由老张直接督阵的总管会话管辖，**严禁写入 tuna 仓任何文件**；domain-bot 仓你也只允许写第五节指定的唯一报告文件。
2. **你不得运行 tuna 仓的任何构建/测试命令**（只读源码审查；tuna 构建归督阵会话）。domain-bot 仓的测试/构建本轮也无需跑（DB-01 已验）。
3. 结论必须**断言附实证**（DISPATCH-RULES §二.约束 1）：grep 命令+输出 或 文件:行号。
4. 用 **Grep 工具（ripgrep）** 做跨文件核查，勿用 Bash grep 多关键词 `\|`（静默零命中假阴性）。

## 一、背景（为什么做）

domain-bot（AI 领域需求探针）每轮采集产出双渠道：Telegram + tuna 内容包 `domain-bot/outbox/tuna/brief-<id>.json`（schema=tuna-brief-v0，**domain-bot 侧单方面提案，未经 tuna 侧确认**）。老张指示打通 tuna 端分发。风险：如果 tuna-brief-v0 与 tuna 真实数据模型结构性不兼容，这个产出就是无人消费的死文件。需要第三方独立核验**契约对齐度**并给出摄入路径建议，供两侧总管（domain-bot 代理总管 / tuna 督阵会话）拍板。

## 二、供审查的事实材料

1. **domain-bot 侧 schema 定义**：`domain-bot/src/push/tuna.ts`（renderTunaBrief，字段与限长）
2. **真实产物样例**：`domain-bot/outbox/tuna/brief-mtn8r5nf.json`、`brief-mtn82j31.json`
3. **tuna 侧核心模型**（已初勘，你须逐一读原文并核对行号）：
   - `tuna/packages/core/index.ts:34` 起 `interface Post`：含 **hooks: string[]（3 个候选钩子，各 ≤40 字，视角不同：悬念/数据/个人利益）**、summary ≤200 字、body（L3 底料）、sourceUrl、lang: 'zh'|'en'、author、provenance、epistemic、signer、schemaVersion=2、createdAt（ISO）
   - `tuna/packages/brief/index.ts:9-20` `BriefItem`/`BriefResult`：简报 = postId 引用 + why（model/static），**brief 不存内容本体，内容在 core/Post**
   - `tuna/packages/feeds/`：内容供给管线（rss.ts / search.ts / pipeline.ts `fetchRssIncremental` / `runByoSearch` / normalizers.ts / persist.ts）——**fetch 只允许在 packages/llm 与 packages/feeds**（tuna 宪法）
4. **tuna 宪法/架构约束**：`tuna/AGENTS.md`、`tuna/docs/ARCHITECTURE.md`（packages/content 零网络；简报三路来源；「完读率即真实信号」）

## 三、目标与验收标准（可证伪）

报告须逐项给出（每项附文件:行号实证）：

1. **字段级映射表**：tuna-brief-v0 的每个字段（schema/digestId/domain/generatedAt/now/items[].index/tier1.hook/tier1.meta/tier1.isNew/tier1.publishedAt/tier2.title/tier2.summary/tier2.why/tier3.url/score）→ 映射到 Post/BriefItem/feeds 的哪个字段；无对应字段的标注「缺口」。
2. **结构性缺口清单**（初勘已知至少 4 项，你须核实并补全）：
   a. hooks：tuna 要求 **3 个 ≤40 字钩子（视角不同）**，tuna-brief-v0 只有 1 个 ≤90 字；
   b. summary：tuna ≤200 字 vs 我们 ≤300 字；
   c. lang/author/provenance/epistemic：tuna Post 必需，tuna-brief-v0 缺失；
   d. body：tuna 有 L3 底料字段，tuna-brief-v0 未供给（domain-bot RawItem.body 有原料）。
3. **摄入路径建议**（须双向论证：不做的代价 / 做了推翻哪个资产）：
   - 路径 X：tuna feeds 增加本地文件导入适配器（读 outbox/tuna/*.json → normalizers 转 Post 候选）；
   - 路径 Y：domain-bot 侧改产出，直接对齐 Post 候选结构；
   - 路径 Z：其他你发现的更优路径（如有）。
   每条路径须对照 tuna 宪法（零网络约束/数据流向）判定合规性。
4. **schema 版本建议**：tuna-brief-v0 应该改哪些字段、升什么版本号、两侧谁向谁靠（给出明确建议与理由）。
5. **违宪风险核查**：建议路径不得违反 tuna 宪法（content 零网络 / fetch 限 llm+feeds / 用户数据私有化约束）。

## 四、已知坑点

1. tuna 仓**只读**（治理边界，见〇.1）。
2. `packages/*/node_modules` 勿进入扫描（噪声大）。
3. domain-bot 的 `memory/`、`logs/`、`outbox/` 是运行时数据；样例 JSON 可能含真实新闻标题——引用时正常，无需脱敏。
4. brief 的 why 有 model/static 双来源（`static-why.ts` 模板降级）——domain-bot 侧 tier2.why 的定位与之同族（人话化理由），映射分析时注意这个语义对齐点。
5. 状态类断言（HEAD/文件存在性）在报告交付前最后一步重跑复核，附时间戳。

## 五、产物与署名

- 契约对齐报告写到：`/Users/aiatwork/Projects/domain-bot/docs/tasks/TASK-DB-02-tuna-contract-done.md`（唯一允许写入的文件）。结构：字段映射表 / 缺口清单 / 摄入路径建议（双向论证）/ schema 版本建议 / 最终结论（契约可接：直接可接 / 需改 domain-bot / 需改 tuna / 双侧各改）。
- 报告末尾附完成署名块（DISPATCH-RULES §八.2：执行通道=cbc(hy3)，改动文件=仅本报告）。
- **禁止修改两仓任何源码/测试/文档；禁止 commit/push。**
