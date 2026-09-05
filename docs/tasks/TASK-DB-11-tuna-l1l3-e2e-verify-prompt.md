# TASK-DB-11：domain-bot → tuna 三级信息流文本 E2E 实测验机（只读 + 验机产物落盘）

> 工单号：DB-11　｜　创建：2026-09-05　｜　创建人：代理总管小智
> 基线：`domain-bot @ 6838d67`（npm test 392/392 绿）｜`tuna @ 6de2082`
> 工作目录：`/Users/aiatwork/Projects/domain-bot`（tuna 仓只读）
> 推荐通道：cbc（hy3，bypassPermissions）
> 优先级：P1（老张指令：实测验证能否产出符合 tuna 三级信息流要求的文本）
> 所属台账：根仓 `docs/NUMBERING.md`（DB-11 已登记）

---

## 〇、必读（不看会做错）

1. **三级信息流契约**（tuna 端侧「L1 钩子卡 → L2 展开摘要+💡为什么+↗原文 → L3 心流」的 L1/L2 数据层）：
   - **tuna 侧校验器**：`/Users/aiatwork/Projects/tuna/packages/feeds/normalizers.ts` 的 `LocalBriefNormalizer`（:341 起）——id 正则、恒 3 钩子且互异、summary/body 非空、lang 推断、限长截断。坏候选在 `normalizeAll` 里**静默跳过**（:407-418 catch 吞掉），所以「posts 进多少、Post 出多少」必须对账，差额就是看不见的失败。
   - **tuna 侧动态加载**：`/Users/aiatwork/Projects/tuna/packages/content/local-brief.ts`（tuna-brief-v1 文档、900KB 上限）。
   - **domain-bot 侧产出**：`/Users/aiatwork/Projects/domain-bot/src/publish/pack.ts`（`buildPack` posts+brief 双结构、数量一致性断言）+ `src/render/tuna.ts`（限长常量 HOOK_LIMITS zh70/en95、SUMMARY_MAX zh300/en450、WHY_MAX 40、MIN_HOOK_CHARS 12、detectLang）。
2. **验机材料（真实生产产物，非合成）**：
   - `outbox/tuna/feed-pack-deepthought-deepthoughtmtobfpmj.json`（40 条，2026-09-05 11:55 真跑，主体材料）
   - `outbox/tuna/feed-pack-newsline-newslinemtobsx4p.json`（16 条，第二产线）
   - 其余 posts:0 的包只做 schema 存在性检查
3. **tuna 仓自测先例**：`/Users/aiatwork/Projects/tuna/scripts/selftest-db-signals.cjs` + `scripts/sim-m6-2-tsconfig.json`——「tsc 编译 packages → node 直跑」的现成模式。你的 harness 照这个模式建，但 tsconfig 的 files 需加入 `packages/feeds/**`（normalizers.ts 及其依赖；`@tuna/core` 路径映射照抄）。
4. Bash grep 多关键词 `\|` 在本机有静默零命中前科——跨仓核查用 Grep 工具（ripgrep）。

## 一、任务

搭一个**可复跑的 E2E 校验 harness**，把上述真实包灌过 tuna 的 `LocalBriefNormalizer`，产出一份缺陷报告。harness 与报告都落在：

```
/Users/aiatwork/Projects/domain-bot/.verify-logs/2026-09-05-tuna-l1l3/   （harness：tsconfig + .cjs）
/Users/aiatwork/Projects/domain-bot/.verify-logs/2026-09-05-domainbot-tuna-l1l3-e2e-cbc.md   （报告）
```

## 二、校验清单（逐项给结论 + 证据，报告按此结构）

### A. 契约层（对账差额）
1. 每条 pack.post `canHandle` 逐条判定；`normalizeAll` 输出数 == pack posts 数（**静默跳过的候选逐条列出并归因**：缺哪字段/正则不匹配）。
2. pack 顶层 `schema === 'tuna-brief-v1'`；`posts.length === brief.items.length`；postId 与 brief.items.postId 一一对应。
3. brief 文档整体 JSON 序列化长度 < 900KB（tuna 存储上限）。

### B. L1 钩子卡形态
4. 恒 3 钩子；两两互异；码点长度 ∈ [12, HOOK_LIMITS[lang]]（zh70/en95）——注意用**码点**（`Array.from`），不是 UTF-16 length。
5. 钩子质量（S2 级也报）：钩子一与标题前缀高度重合（>80% 字符重叠）= 冗余钩子；三钩子中两条仅大小写/标点差异 = 伪互异；钩子尾部以 `…` 截断的比例（残字风险的信号）。
6. lang 推断正确性：纯英文内容被判 en、中文被判 zh；列出误判条目（误判会选错限长档，中文按 en95 放行会在真机溢出两行）。

### C. L2 展开层
7. summary 码点 ≤ SUMMARY_MAX[lang] 且非空；body 非空；title ≤ 200。
8. `why` 码点 ≤ 40、非空、且**不是模板复读**（不同条目 why 相同/高度雷同的列出）；why 里的关键词引用与该条目实际内容的相关性抽查 5 条（人读判断，给出你的评语）。
9. `sourceUrl` 存在性：L2 的「↗ 原文」依赖它，缺失即缺陷（normalizer 允许缺，产品不允许——报 S1/S2 由你定级并论证）。

### D. 内容质量（DB-03 前科专项）
10. 全文扫 `[object Object]`、`arXiv:` 元数据行、招聘/卖课信号（hiring/join our team/course 等模式）——黑名单与宽通道是 DB-08/DB-10 刚修过的区域。
11. 40 条中**与 AI/LLM 无关**的条目逐条列出（你通读判断），无关条目=宽通道判定质量的直接证据。

### E. 端到端结论
12. 最终判定：**能 / 有条件能 / 不能**产出符合三级信息流要求的文本；缺陷按 S0/S1/S2 列表，每条带：证据（postId + 字段值）、根因定位（domain-bot 渲染层 or tuna 校验层 or 上游内容）、修复建议（双向论证：不修的代价 vs 修了推翻什么）。

## 三、硬约束

- [ ] 两仓**只读**（除 §一 指定的 `.verify-logs/` 落盘外零写入）；禁止 commit/push
- [ ] 禁止改 `domain-bot/memory/`、`tuna/` 任何文件；禁止 pnpm/npm install
- [ ] harness 编译产物只落在 `.verify-logs/2026-09-05-tuna-l1l3/` 内
- [ ] 报告内一切「状态类」断言附命令+输出与读取时间戳

## 四、自测要求

harness 可重复运行（`node .verify-logs/2026-09-05-tuna-l1l3/run.cjs` 一条命令出全量结果）。报告末尾附 `ALL_DB11_PASS`（指 harness 跑通、全部 12 项有实证结论，不代表无缺陷——缺陷照实列）。

## 五、交付物

1. harness（可复跑）
2. 报告（结构按 §二 A-E，含证据与读取时间戳）
3. 若发现本工单描述与两仓代码不符：明确指出并带路径:行号，不要将错就错
