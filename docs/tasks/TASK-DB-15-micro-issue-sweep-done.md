# TASK-DB-15 完成报告：五项微缺陷清扫

> 执行：代理总管小智自修（工单分派 agy；同改 src/editorial/index.ts 的第 2/4 项随 DB-14 会话内顺次完成，符合串行约束）｜日期：2026-09-05｜commit `67224ae`｜ALL_DB15_PASS

1. **jobId 本地日期【改】**：改用本地 Y/M/D（注释写明一次性代价：切换日 staging 续跑失效一次；确认当时无活跃作业）。测试：跨 UTC 午夜时刻断言日期段=本地日期且 ≠ UTC 日期。
2. **校准临时目录【改】**：mkdtemp 句柄提出、跑完 rmSync(recursive, force)，失败不遮蔽主流程；「每次唯一目录」不变量保留（工单红线）。测试：跑带校准的 runEditorial 后 tmpdir 无新增 dbot-calibrate-*（实测存量泄漏 4 个已停增）。
3. **注释条数【改】**：头注释不再写死数字，指向 runAssertions 本体。测试：断言源码不含「十条硬断言」且 check* 调用数 ≥12。
4. **model 字段【改——说真话路线】**：EndpointUsageStat 增可选 model 字段，随 recordUsage 记录 provider.chat 回读值（8052 会改写 model，必须存回读值）；lastUsage 从 stat 取，旧快照无字段时 undefined 不假装有效。测试：chat 回读 usage.model='rewritten-by-8052' 断言。
5. **VIEWER_CHROME【改——方案 A】**：正则源串单独保存，substanceOf 内按需 new RegExp(source,'gi') 局部创建（结构上消除 lastIndex 污染，不靠注释禁令）；**未删 g**（全局语义保留）。测试：多处 chrome 混合文本仍被判空壳（全部剥除）。

全量 **424/424** exit=0；tsc 绿；build 绿。
