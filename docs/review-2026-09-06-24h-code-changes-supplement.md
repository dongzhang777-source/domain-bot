# domain-bot 24 小时改动审查·补充轮（2026-09-06 21:12–21:25 EDT）

审查人：DSH 审查会话（受老张直接指派）。窗口：2026-09-05 21:18 → 2026-09-06 21:12 EDT（边界提交 `3cb4d7c` → `8b52d99`，21 提交）。
与既有报告的关系：小巴的 `review-2026-09-06-24h-code-changes.md` 覆盖到 18:26/提交 40527fa 为止；本补充轮**独立复查其结论**（抽查 8 项均成立），并覆盖其窗口之后的 4 个代码提交：f694248（arXiv 400）、d5629d3（anysearch/twitter 适配器 + 扩源）、1d31064（读者画像卡）、899a73e（DB-20 四令）。

## 一、验证记录（全部为本次实测，读取时点 21:14–21:24 EDT）

- `npm test`：434/434 绿（exit 0，21:15）。
- `npm run build`（tsc）：exit 0。
- `git status`：工作区干净，`main` 与 `origin/main` 同步，无未推送提交。
- `launchctl list | grep domain-bot`：未装载（与 899a73e「保持卸载、ZCode 定时任务为唯一启动器」一致）。
- `node scripts/xiaozhi-copy.mjs` 实跑：**当场崩溃**（见 P1-1）。
- 跨仓核对：tuna `packages/feeds/normalizers.ts:410-426` 确有 embedding 合法性校验（维度/有限数/model 非空，坏向量静默丢弃）——bot 侧「双保险」声明属实。
- `.env` 未跟踪、仅新增键名（ANYSEARCH_API_KEY / NVIDIA_API_KEY / TWITTER_AUTH_TOKEN / TWITTER_CT0），无密钥入库。

## 二、新发现问题（小巴报告窗口之外）

### P1-1 `scripts/xiaozhi-copy.mjs` 从诞生起就无法运行（899a73e，DB-20 亲写流程核心工具）

脚本是 `.mjs`（ESM 恒成立，与 package.json 的 `"type": "module"` 无关），却从第 17 行起用裸 `require()`。实测 Node v22.23.1：`ReferenceError: require is not defined in ES module scope`，exit 1——**任何参数下都到不了参数校验**。仓内先例 `scripts/probe-event-cluster.mjs:18-20` 就是用 `createRequire` 的正确写法，照抄即可（两行改动：`import { createRequire } from 'node:module'` + `const require = createRequire(import.meta.url)`；它 require 的 `editorialTargetsOf`/`COPY_SCHEMA`/`stagePath`/`writeStageJson`/`EMPTY_EDITORIAL_STATS` 等导出全部核对存在，脚本其余逻辑无误）。
佐证其从未跑通：`logs/` 与 `staging/` 无 `XIAOZHI_COPY_PASS` 痕迹；现存 copy 文件系手工写就。434/434 绿拦不住它——scripts/ 不在测试覆盖内。
**影响**：老张四令之一「编辑部生产由小智亲自执行」目前唯一工具是死代码。修复归 DB-20 执行人（小智会话）。

### P1-2 三个新源「注册即已接线」实为未接线（d5629d3）

`sources.json` 新增并 enabled 的 `twitter-feed`、`anysearch-local-llm`、`anysearch-agent-bench` **未被任何 persona 的 sources 白名单引用**（实测 node 对账脚本输出 orphan 三源）。采集过滤条件是 `s.enabled && persona.sources.includes(s.id)`（`src/pipeline.ts:150`），故三源**永不被采集**：20:55 轮 newsline evidence `skippedSources=[]` 是因为它们根本没进候选，而非成功。d5629d3 标题「T1/T3 落地」只完成了适配器 + 类型联合 + 派发，最后一公里（persona 挂载）缺失。
若属有意（twitter follow 名单待老张审定再挂），应把三源 `"enabled": false` 或在源条目注明「待接线」——现状是「配置声称在跑、观测上从不存在」的双假象；且 `doctor` 无孤儿源检查，此缺口静默。**修复**：二选一，改一行配置或补 doctor 检查。

### P2-1 writer 链序与注释/环境变量命名三者互相矛盾（899a73e 删 byok 的遗留）

HEAD 上 writer 链实测为 `[nous-proxy(8052), nvidia-nim]`——**实际主端点是 nous-proxy（longcat 免费档）**；但：① `_separationNote` 仍写「writer 主端点 → NIM」；② 环境变量名倒置（链首位挂 `EDITOR_WRITER_FALLBACK_*`，NIM 挂主名 `EDITOR_WRITER_*`）；③ `_throughputNote` 的批=3 数据对应早已改掉的 batchSize。若删 byok 时意图是 NIM 升主，只需对调链中两元素；若意图确是 nous-proxy 主，须改注释与 env 命名。另注意 8052 正是 reviewer 链的备胎——reviewer 一降级即与 writer 撞同一端点，新加的撞车告警能发现，但配置本身在重新制造已知撞车模式。

### P2-2 plist 与安装脚本的时刻说明未随 11/15/19 更新（899a73e）

`StartCalendarInterval` 已改 11/15/19，但 plist 注释仍写「03:00 主轮，12:00/12:00 补采」，`ops/install-scheduler.sh` 头注释与完成回显仍打印「每天 03:00 / 12:00 / 19:00」。老张按脚本提示在 Terminal.app 安装时会被回显误导。

### P2-3 新适配器零测试（d5629d3）

`parseTwitterFeed` / `parseAnysearchOutput` / `extractMarkdown` 均为纯函数且格式敏感（markdown 分块、JSON 包裹、t.co 剥离），但无一条单测；仓内其他适配器均有 parse 测试惯例。叠加 P1-2（根本不会被调用），属「未测且未接线的代码已入库」。

### P3 观察项（不阻塞）

1. xiaozhi-copy 把亲写文案标 `origin:'llm'`（字段枚举仅 llm|fallback，下游无碍）；审计视角下人写内容计入 LLM 产出，建议未来加 `human` 值或注释语义。
2. anysearch 条目 `publishedAt=0`：DB-13 预筛有意不碰 =0 条目，等于主动搜索结果**完全绕开时效闸**，旧文可入池（reviewer 二元判定兜底），I 线观测需留意此源。
3. `types.ts` 的 `numResults` 注释「仅 exa」已过期（twitter/anysearch 共用）。
4. `src/editorial/index.ts` 撞车告警块在 sameEndpoint 串行分支也会触发且文案称「并发请求互相拖慢」——串行分支下必然同端点，属未来噪声（当前配置两主端点必不同，分支不可达）。
5. publish 路径首次触发会联网下载 ~120MB embedding 模型（缓存已正确落 `~/.cache` 仓外）；失败语义不阻断发布，正确，但首轮发布延迟需在 ops 心里有数。

## 三、复查通过项（本次独立核对，非照抄小巴）

- **DB-14 惰性启动修复**正确（旧写法 Promise 先起后 await，串行从未生效；新写法把 `runJob` 调用移进分支），配套双侧撞车探测（index.ts + board.ts）口径一致。
- **DB-13 预筛**：判据与 persona 闸同口径（`publishedAt>0` 才判）、漏斗 `afterSourcePrescreen` 层 0 条也保形状、观测字段 pipeline→staging→observe 全链透传、`publishedAt=0` 不误伤有测试钉死。arXiv Atom 兼容属实（rss.ts:58 `parsed.feed?.entry` 分支）。
- **DB-16 降级留痕**：`degradedReasons` 落 state + stderr 双写；`[].every()` 恒真的空批误判修复正确；旧快照读取兜底注释诚实（「字段缺失≠没有原因」）。
- **DB-18 篇幅下限**：`ensureSummaryFloor`（渲染补句、逐句去重）+ `gk:summaryBelowFloor`（终审兜底）双层设计合理，SUMMARY_MIN 与 tuna 侧对齐（小巴已逐值核对，本次不重复）。
- **validate 回调落备胎**（provider.ts）：形状错误计入端点失败并降级，writer/reviewer 同构落点，正确。
- **真 finally 修复 c398172** 已复核：rmSync 确在 finally 内，删除失败不遮蔽主流程。
- 密钥纪律：`.env` 未跟踪；plist 用 `--env-file-if-exists` 注入（Node ≥22.9，实测 v22.23.1 支持）；`KeepAlive` 弃用理由（一次性作业+KeepAlive=紧凑重启循环）成立。

## 四、结论

24 小时窗口整体工程质量高（注释讲「为什么」、观测不留暗账、修复带测试），与项目纪律一致。**但 18:26 之后的 4 个提交首次引入两处 P1**：DB-20 亲写核心工具是死代码（P1-1）、扩源三源未接线（P1-2）——两者共同点是**都发生在测试覆盖之外**（scripts/ 无测试、sources↔persona 一致性无检查），建议把「orphan 源检查」并入 doctor、给 scripts/ 加最小冒烟（`--help` 退出码即钉死语法层错误）。P2 三项均为配置/注释漂移，一处改名级别的工作量。
