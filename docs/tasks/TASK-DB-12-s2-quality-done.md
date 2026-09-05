# TASK-DB-12 完成报告：S2 内容质量三项（D4 兜底 why / D6 钩子冗余 / D7 近重复事件）

> 工单：`TASK-DB-12-s2-quality-prompt.md`（2026-09-05 老张指令「S2 外派 CLAUDE」）
> 完成：2026-09-05　｜　执行：外派 claude（z.ai GLM-5.3-Flash）施工 + 代理总管验收 + truncateWhy 收口补丁
> claude 报告：`.verify-logs/2026-09-05-domainbot-db12-s2-quality-claude.md`（唯一作答）

## 一、结论

三项全部闭环（D4 改 / D6 改 / D7 改词层），`npm test` 400 → **412/412 绿**（+12 新增用例），既有 399 条用例零改动（含 e2e 聚类语义基准三条）。变异抽验三项各撤一处各红 2 例、还原复绿（claude 自证 + 总管独立复跑 412/412）。

## 二、各项落地

- **D4 兜底 why**：无命中时不再产「与「ai-llm」相关」/「Related to your ai feed」，改 `Picked for <主题短语>` / `因「<主题短语>」入选`（主题短语取自标题首句、剥小数、预算 28 码点）。铁律逐条兑现（永不空串/永不回显浮点/≤40 词边界/双语）。DB-11 主材 56 条实测：模板 why **16 → 0**。
- **D6 钩子去冗余**：判据换**词级覆盖**（复用 dedupe 的 tokenize，阈值 0.8）——工单第一选项字符级被实测证伪（英文散文饱和误杀）。首句与标题同源时次句顶替、实体卡豁免、素材不足回补。56 条实测：hook[0] 标题复读 **31 → 15**，剩余 15 条全是「标题即正文」形态（属 D3 空壳域邻接问题，非钩子层可解）。
- **D7 近重复事件**：claude 诊断推翻工单猜测——6 变体并存不是聚类没合并（5/6 本就一簇），而是①转载渠道名后缀（`- IBTimes India` / `- India Today`）把**两个独立事件缝成一簇**（词层缺陷，已修：`stripOutletSuffix` 剥末尾 outlet 名，剥空守门回退）；②`eventFillMode=true` 刻意放行（2026-09-04 老张裁决「宁发重复不发薄包」，有测试钉住，**不动**）。修正后该批 clusters 7→8、误并簇 9→5、kept/demoted 9/7→11/5。

## 三、总管验收动作

- 独立复跑 `npm test` → 412/412 exit=0；`git diff --stat` 与报告改动清单一致（4 源文件 + 5 测试文件）
- 抽读 `stripOutletSuffix` 实现与判据注释（收窄判据 + 已知代价记录在案）
- 收口补丁：`truncateWhy` 切点落在单词中间时整词回退（16:51 真实包实测出过 `be…` 残词），加真实案例回归断言

## 四、遗留（登记）

1. **fill mode 每事件上限**（claude 建议二选一：fill 模式同事件 ≤3，或 fill 触发时走 reviewer 语义去重再回填）——涉及 09-04 老张裁决的取舍，**留待老张拍板**，不擅动
2. 15 条「标题即正文」条目（D6 剩余人群）：属 D3 空壳域邻接，可考虑「summary 词元 == title 词元」弱信号上板
3. dist 已重建（17:40），19:00 调度轮起产线吃到全部修复

## 完成署名

- 工单号：DB-12
- 执行通道：claude（施工）+ 自修（验收与收口补丁）
- 执行人标识：claude(z.ai GLM-5.3-Flash) / 小智（ZCode 代理总管）
- 完成日期：2026-09-05
- 派单基线 HEAD：`domain-bot @ 830f77d`（npm test 400/400 绿）
- 实际落盘 HEAD：未 commit，待总管入库（本报告随入库 commit 落盘）
- 验证：npm test 412/412 绿 exit=0；tsc 绿；build 绿
- 自测标记：ALL_DB12_PASS
- 改动文件：src/refinery/scorer.ts、src/render/tuna.ts、src/collector/dedupe.ts、src/gates/eventCluster.ts、tests/{refinery,tuna,gatekeeper,gates,eventCluster}.test.ts（相对 /Users/aiatwork/Projects/domain-bot/）
- 关联台账更新：根仓 NUMBERING.md DB-12 → ✅ 已闭环；代理期动作台账
- 遗留 / 风险：§四三项
