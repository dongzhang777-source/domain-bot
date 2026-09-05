# TASK-DB-11 完成报告：tuna 三级信息流文本 E2E 验机 + 修复循环两轮

> 工单：`TASK-DB-11-tuna-l1l3-e2e-verify-prompt.md`（2026-09-05）
> 完成：2026-09-05　｜　执行：外派 cbc(hy3) 验机 + 代理总管小智修复 + 真实数据回放复验
> 审查报告：`.verify-logs/2026-09-05-domainbot-tuna-l1l3-e2e-cbc.md`（cbc 唯一作答）

## 一、结论

**能**（第一轮「有条件能」，两轮修复后实测通过）：domain-bot 真实生产包经 tuna 仓真实 `LocalBriefNormalizer` 校验，40→40、16→16 零静默丢弃，契约/限长/lang/900KB 全达标；三轮修复后内容层缺陷（裸 HTML、why 语言错配、空壳 summary）在真实数据回放中全部清零。

## 二、验机方法（可复跑）

1. **cbc harness**：`node .verify-logs/2026-09-05-tuna-l1l3/run.cjs`——编译 tuna 真实校验器，灌真实生产包（deepthought 40 + newsline 16 + 旧 v1 包 11 个），12 项检查出 findings.json。
2. **真实数据回放**（修复后新增）：`node .verify-logs/2026-09-05-tuna-l1l3/replay.cjs`——把旧构建产出的 40 条真实包灌过新渲染→终审→装配链，再过 tuna 校验器。

## 三、两轮修复（全部有测试回归锁，npm test 388→400 全绿）

| 轮 | 缺陷 | 修复 | commit |
|---|---|---|---|
| R1 | D1 S1 裸 HTML（11 条） | `stripHtml` 生产端剥标签 + 终审第 11 条 `gk:htmlLeak` | `c6768f2` |
| R1 | D2 S1 中文 why 挂英文帖（56 条） | `humanizeReason`/`fallbackWhy` 按 detectLang 双语化 | `c6768f2` |
| R1 | D3 S1 空壳 summary（5 条：视频观看数/导航页） | 终审第 12 条 `gk:hollowSummary`（剥 chrome 后实质词元 <5 否决） | `c6768f2` |
| R1 | D5 S2 why 截词（benchmar…） | `truncateWhy` 词边界截断 | `c6768f2` |
| R1 | D9 S2 sourceUrl 静默断链风险 | `assertPackContract` 缺失即抛错 | `c6768f2` |
| R2 | 转义标签漏网（`&lt;example&gt;` 解码后复活，回放实测抓到） | `stripHtml` 双 pass（剥→解码→再剥）+ `gk:htmlLeak` 放宽为任意标签形模式 | `ada16fe` |

## 四、回放复验结果（真实数据，非合成）

```
in: 40 | accepted: 35 | rejected: 5        ← 5 条全被 gk:hollowSummary 拒（= cbc 报的 5 条空壳）
rejected by: {"gk:hollowSummary":5}
accepted-with-html: 0 | zh-why-on-en: 0
tuna LocalBriefNormalizer: in 35 out 35    ← 零静默丢弃
normalized-with-any-tag: 0 | zh-why-on-en: 0
```

## 五、遗留（S2 留账，不阻塞交付）

- **D4** 通用兜底 why「Related to your ai feed」16/56 条无具体论证——根治归编辑部 writer 线（LLM 文案本就为替代机械模板）
- **D6** 钩子冗余（hook[0]≈标题子串，33 条）——需钩子递补逻辑
- **D7** 近重复事件（newsline 6 条同事件变体）——事件级去重加宽
- **D8** 旧 v1 包（tuna-feed-200.json）172 条因 id 中段含连字符会被 tuna 全量静默丢弃——**该包已被现行管线取代，勿再投递**；现行 id 生成端已有 `sanitizeDigestId` + `assertPackContract` 双守卫
- **tuna 侧**（不越权，留条督阵线）：`normalizeAll` 整包 0 产出时宜上报告警而非静默；local-brief 路径可考虑补 sanitize 闸门

## 完成署名

- 工单号：DB-11
- 执行通道：cbc（验机）+ 自修（修复）
- 执行人标识：cbc(hy3) 唯一作答验机 / 小智（ZCode 代理总管）修复与复验
- 完成日期：2026-09-05
- 派单基线 HEAD：`domain-bot @ 6838d67`（npm test 392/392 绿）
- 实际落盘 HEAD：`domain-bot @ ada16fe`（已推送 origin）
- 验证：npm test 400/400 绿 exit=0；build 绿；真实数据回放 + tuna 真实校验器双重复验
- 自测标记：ALL_DB11_PASS
- 改动文件：src/render/tuna.ts、src/gatekeeper/render.ts、src/gatekeeper/assertions.ts、src/refinery/scorer.ts、src/publish/pack.ts、tests/{tuna,gatekeeper,refinery,recall,wiring}.test.ts（均相对 /Users/aiatwork/Projects/domain-bot/）
- 关联台账更新：根仓 NUMBERING.md DB-11 → ✅ 已闭环；代理期动作台账
- 遗留 / 风险：§五 S2 留账；19:00 三时段轮为修复后首个真实生产观测点
