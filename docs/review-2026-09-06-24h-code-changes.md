# domain-bot 24 小时改动审查报告（2026-09-06 18:26–18:40）

审查人：小巴（项目总管例行审查）。窗口：2026-09-05 18:26 → 2026-09-06 18:26 EDT。
范围：21 条提交（b305254…40527fa）+ 审查时未提交改动。

## 一、改动概况

| 维度 | 读数 |
| --- | --- |
| 提交数 | 21（含昨已审 8 条的收口提交） |
| src + tests | 28 文件，+915 / −93 |
| docs / evidence / config / ops | 27 文件，+18,878 / −52（大头为计划书、evidence 收口） |
| 测试 | 审查时点全量 434/434 绿（vitest 53s），tsc --noEmit 绿 |
| 新增依赖 | `@xenova/transformers ^2.17.2`（内容向量，E3 过渡态） |

主线条目（按时间序）：

1. **DB-13/14/15（昨审项的落地）**：源级时效预筛（P0）、同端点串行修复 + 撞车告警（P1）、五项微缺陷清扫（P2），对应收口提交 b305254/3a1f5d2/67224ae。
2. **扩源与批产准备**（3a95f81）：arXiv 切 Atom API（legacy RSS 已 0 条目）、exa numResults 源级可配、newsline 七源扩容。
3. **DB-16**（f4a3b7b…）：writer 主端点多次切换（NVIDIA NIM → DeepSeek BYOK 官方 API），降级原因留痕 degradedReasons、端点撞车自动告警、parse 失败落备胎（chat() 增 validate 回调）。
4. **DB-18/篇幅令**（1e9b63c/c79b701）：L2 概要下限 zh200/en300 码点，渲染层 ensureSummaryFloor 补句 + 终审 gk:summaryBelowFloor 兜底；内容向量随包下发（E3 过渡态）。
5. **DB-19**（6afbd59/40527fa）：writer 主端点切 DeepSeek BYOK 官方 API（200 条批产令执行需要），备胎 nous-proxy 120s、nvidia-nim 120s。

## 二、逐项审查结论

### 通过项（重点核对过实现的）

- **同端点串行修复（editorial/index.ts）**：旧代码先起两个 Promise 再 await，串行从未生效；新写法把启动推迟到分支内，正确。配套的撞车探测（实际用量端点交集）在 index.ts 与 gatekeeper/board.ts 双侧落点，口径一致。
- **makeJobId 改本地日期（job.ts）**：修 UTC/本地差一天问题，注释如实披露了一次性代价（旧 staging 进度文件失配一次）。可接受。
- **空批不判降级（job.ts）**：`[].every()` 恒真误记降级的修正正确。
- **VIEWER_CHROME 正则改源串（assertions.ts）**：结构上消除模块级 g 正则的 lastIndex 污染，且保留 replace 全局语义，注释交代了「勿直接删 g」。正确。
- **时效预筛（pipeline.ts）**：砍在去重前、漏斗新增 afterSourcePrescreen 层（0 条也保留层形状）、观测字段全链透传（pipeline → staging → observe）。实测该层当轮砍 130/272，正常工作。
- **概要下限双侧对齐**：bot 侧 SUMMARY_MIN（zh200/en300）与 tuna 侧 normalizers.ts SUMMARY_LIMITS 逐值核对一致（本次审查实测读取 tuna 源码确认），且 bot 侧注释标明「改动必须双侧同步」。
- **embedding 链路**：模型锁定 E3 决策、缓存目录在仓库外（~/.cache）、isValidEmbedding 拒坏向量、attachEmbeddings 失败语义（缺向量可后补、坏向量不入包、不阻断发布）均正确。向量测试直连真实模型锁契约属性，符合「mock 测不到维度/归一化」的判断。
- **emitPublished 改 async**：cli.ts 内三处（定义+两调用）全部 await，wiring.test.ts 的单一发布路径守卫测试钉死此约束。
- **安全**：`.env` 未被 git 跟踪（.gitignore 有 .env，git ls-files 确认），新录入的 DEEPSEEK_API_KEY / NVIDIA_API_KEY 只在 .env，未进提交历史。

### 审查中发现并当场修复的（1 项，已提交 c398172）

- **reviewGold 临时目录清理是假 finally**：注释声称「失败也要删（finally 语义）」，实际是 try/catch 顺序块——runJob 抛错（端点全链失败）时 rmSync 走不到，异常路径照样泄漏目录，与「工具产物零容忍」相悖。已改为 runJob 置入 try、rmSync 置入 finally。验证：tsc 绿，tests/editorial.test.ts 49/49 绿。

### 遗留观察项（不阻塞，记录在案）

1. **writer 链 nvidia-nim 端点复用 `EDITOR_WRITER_BASE_URL/EDITOR_WRITER_API_KEY` 环境变量名**（6afbd59 起）：该组变量名原属 nous-proxy 档位，现与 nvidia-nim 共享。当前 .env 未设这些变量（走 baseUrlDefault + 专用 NVIDIA_API_KEY），行为正确；但若未来有人设了 EDITOR_WRITER_BASE_URL，会同时改写两个档位。建议下轮配置整理时拆分为独立变量名。
2. **nvidia-nim 备胎时效性**：9:2x 注记称 NIM 为 writer 主端点，15:56 起主端点已切 DeepSeek BYOK，NIM 降为第二备胎。当前链序（deepseek-byok → nous-proxy → nvidia-nim）下 nous-proxy（120s 超时）排在 NIM 前，长批撞 nous-proxy 限流时仍有 NIM 兜底，链序合理；仅配置注释时序略滞后，无功能影响。
3. **未提交改动三处**（审查时点）：config/sources.json 的 arXiv max_results 150→400（12:30 扩源令的后续调参，未带提交说明落盘）、evidence/feed-quality-newsline-*.json 一份（17:xx 轮运行产物，evidence 目录历有收口惯例）、本次审查的 src/editorial/index.ts 修复（已单独提交 c398172）。建议老张确认 max_results=400 意图后一并收口。
4. **arXiv max_results 150→400 的量级提醒**：三分区合计拉取 1200 条/轮，DB-13 预筛会在去重前砍掉超 72h 的部分，漏斗可承载；但若 arXiv API 对高频全量拉取限流，集中在凌晨轮风险更大。观察 afterSourcePrescreen 层与 zeroYield 即可，无需现在动。

## 三、验证记录

- `npm run typecheck`：绿（审查前、修复后各一次）。
- `npm test`：434/434 绿（53.42s）。
- `tests/editorial.test.ts`（修复后单跑）：49/49 绿。
- 跨仓核对：tuna packages/feeds/normalizers.ts SUMMARY_LIMITS 与 bot 侧 SUMMARY_MIN 逐值一致。
- 审查过程曾出现 .git/index.lock 无法 unlink（18:26 时点 0 字节残留，疑似并行 git 进程遗留），已确认为陈旧锁并清除，git status 现正常。

## 四、结论

过去 24 小时改动整体质量高：昨审 P0/P1/P2 三项全部落地且有测试钉死；新功能（向量、篇幅下限、降级留痕）注释里都写了「为什么」，与项目纪律一致。发现 1 处实现与注释不符（假 finally），已当场修复提交。无阻塞项，发布维持冻结状态不变（等待抽验通过）。
