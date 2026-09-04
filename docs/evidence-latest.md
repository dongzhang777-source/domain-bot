## 探针证据快照（gen-evidence.mjs 生成，非手抄）

```json
{
  "generatedAt": "2026-09-04T14:35:42.931Z",
  "probeStart": null,
  "rounds": 4,
  "lastRound": {
    "at": 1788311788421,
    "candidates": 0,
    "pushed": 0,
    "collected": 1676,
    "relevant": 338,
    "skippedSources": [
      "hf-daily-papers"
    ],
    "feedbackCount": 0,
    "candidateP50": 0,
    "candidateP90": 0,
    "candidateTop1": 0,
    "rawP50": 0,
    "rawTop1": 0,
    "pushedMean": 0,
    "saturationRate": 0,
    "isNewRate": 0,
    "weights": {
      "arxiv-cs-ai": 0.5,
      "huggingface-blog": 0.5,
      "github-new-llm-tools": 0.5,
      "exa-llm-news": 0.58,
      "hf-daily-papers": 0.58,
      "v2ex-hot": 0.26,
      "bili-llm": 0.26
    },
    "bySource": {}
  },
  "archive": {
    "total": 651,
    "pushed": 10,
    "bySource": {
      "arxiv-cs-ai": 557,
      "exa-llm-news": 6,
      "huggingface-blog": 74,
      "github-new-llm-tools": 14
    }
  },
  "feedbackCount": 0,
  "viewsCount": 0,
  "weights": {
    "arxiv-cs-ai": 0.5,
    "huggingface-blog": 0.5,
    "github-new-llm-tools": 0.5,
    "exa-llm-news": 0.58,
    "hf-daily-papers": 0.58,
    "v2ex-hot": 0.26,
    "bili-llm": 0.26
  },
  "weightsFeedbackHash": "4f53cda18c2b",
  "criteria": [
    {
      "id": "I-1",
      "name": "连续 3 轮 candidates=0（候选池枯竭）",
      "threshold": "3 轮",
      "value": "1/3 轮",
      "status": "pass",
      "note": "M6 标定中：拟加「且全源零新增」限定（arXiv 周五/周六无公告属排班，非仪器故障）"
    },
    {
      "id": "I-2",
      "name": "反馈率 < 5%（👍+👎 数 / 推送条数）",
      "threshold": "5%",
      "value": "feedback.json 不存在",
      "status": "nodata",
      "note": "无 Telegram key 时无输入通道，nodata 属预期；全史口径——签字稿定稿时同批切换"
    },
    {
      "id": "I-3",
      "name": "采集失败+零产出源占比 连续 3 轮 > 1/3（B′1 新口径）",
      "threshold": "1/3",
      "value": "旧观测缺 enabledSourceIds——分母无法按轮取",
      "status": "nodata",
      "note": "分母按轮取（§2.6.4）；返回空的源单列 emptyYieldSources 可见不报警，是否并入分子待 M6 标定"
    },
    {
      "id": "I-4",
      "name": "saturationRate 持续 > 0.5（原始分口径；判据形式待裁）",
      "threshold": "0.5",
      "value": "0",
      "status": "pass",
      "note": "决策点 7 待裁：现行形式被 M3 证明恒真/恒假不可用；倾向案 B（rawP90 ≥ X），X 归联合标定（决策点 8），签字稿定稿时同批切换"
    },
    {
      "id": "G-1",
      "name": "主动消费性查看 < 10 次（两周累计）",
      "threshold": "10 次",
      "value": "views.json 不存在",
      "status": "nodata",
      "note": "views.json 是 viewed 唯一定义（criteria §2c）"
    },
    {
      "id": "G-2",
      "name": "👍率 < 20%（有效反馈中）",
      "threshold": "20%",
      "value": "nodata",
      "status": "nodata",
      "note": ""
    },
    {
      "id": "G-3",
      "name": "戒断测试：停 3 天无主动打开",
      "threshold": "停 3 天",
      "value": "需探针期末人工判读",
      "status": "nodata",
      "note": "依赖探针结束后的戒断窗口观测"
    },
    {
      "id": "P-1",
      "name": "主动查看 ≥ 10 次",
      "threshold": "10 次",
      "value": "views.json 不存在",
      "status": "nodata",
      "note": ""
    },
    {
      "id": "P-2",
      "name": "👍率 ≥ 30% 且有效反馈 ≥ 20 条",
      "threshold": "30% 且 20 条",
      "value": "nodata",
      "status": "nodata",
      "note": "有效反馈已按 C′10 同条同信号去重，不可被重放虚增"
    },
    {
      "id": "P-3",
      "name": "戒断测试通过：停 3 天内有主动打开",
      "threshold": "停 3 天",
      "value": "需探针期末人工判读",
      "status": "nodata",
      "note": "依赖探针结束后的戒断窗口观测"
    },
    {
      "id": "P-4",
      "name": "定性证据 ≥1 条（probe-changelog.md 的 P-4 artifact 行）",
      "threshold": "≥1 条",
      "value": "0 条有效 / 0 行 P-4 记录",
      "status": "nodata",
      "note": "artifact 行格式：`| P-4 | <date> | digestId=<id> | itemId=<id> | decision=<一句话> |`——四要素齐备才计有效（D5）"
    }
  ]
}
```

### 判定线 11 项读数（A′3 自动产出；判据原文见 docs/probe-verdict-criteria.md）

| 判据 | 内容 | 阈值 | 当前值 | 状态 | 备注 |
|---|---|---|---|---|---|
| I-1 | 连续 3 轮 candidates=0（候选池枯竭） | 3 轮 | 1/3 轮 | **pass** | M6 标定中：拟加「且全源零新增」限定（arXiv 周五/周六无公告属排班，非仪器故障） |
| I-2 | 反馈率 < 5%（👍+👎 数 / 推送条数） | 5% | feedback.json 不存在 | **nodata** | 无 Telegram key 时无输入通道，nodata 属预期；全史口径——签字稿定稿时同批切换 |
| I-3 | 采集失败+零产出源占比 连续 3 轮 > 1/3（B′1 新口径） | 1/3 | 旧观测缺 enabledSourceIds——分母无法按轮取 | **nodata** | 分母按轮取（§2.6.4）；返回空的源单列 emptyYieldSources 可见不报警，是否并入分子待 M6 标定 |
| I-4 | saturationRate 持续 > 0.5（原始分口径；判据形式待裁） | 0.5 | 0 | **pass** | 决策点 7 待裁：现行形式被 M3 证明恒真/恒假不可用；倾向案 B（rawP90 ≥ X），X 归联合标定（决策点 8），签字稿定稿时同批切换 |
| G-1 | 主动消费性查看 < 10 次（两周累计） | 10 次 | views.json 不存在 | **nodata** | views.json 是 viewed 唯一定义（criteria §2c） |
| G-2 | 👍率 < 20%（有效反馈中） | 20% | nodata | **nodata** |  |
| G-3 | 戒断测试：停 3 天无主动打开 | 停 3 天 | 需探针期末人工判读 | **nodata** | 依赖探针结束后的戒断窗口观测 |
| P-1 | 主动查看 ≥ 10 次 | 10 次 | views.json 不存在 | **nodata** |  |
| P-2 | 👍率 ≥ 30% 且有效反馈 ≥ 20 条 | 30% 且 20 条 | nodata | **nodata** | 有效反馈已按 C′10 同条同信号去重，不可被重放虚增 |
| P-3 | 戒断测试通过：停 3 天内有主动打开 | 停 3 天 | 需探针期末人工判读 | **nodata** | 依赖探针结束后的戒断窗口观测 |
| P-4 | 定性证据 ≥1 条（probe-changelog.md 的 P-4 artifact 行） | ≥1 条 | 0 条有效 / 0 行 P-4 记录 | **nodata** | artifact 行格式：`| P-4 | <date> | digestId=<id> | itemId=<id> | decision=<一句话> |`——四要素齐备才计有效（D5） |

> G/P 组为两周累计/期末项，中途一律 nodata；探针结束后加 --probe-end 评估。

### observations.jsonl 全文

```jsonl
{"at":1788307589178,"candidates":647,"pushed":6,"candidateP50":0.602,"candidateP90":0.747,"candidateTop1":0.862,"pushedMean":0.759,"saturationRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"github-new-llm-tools":0.5,"exa-llm-news":0.6,"hf-daily-papers":0.6,"v2ex-hot":0.2,"bili-llm":0.2},"bySource":{"arxiv-cs-ai":3,"exa-llm-news":1,"huggingface-blog":2}}
{"at":1788307618871,"candidates":1,"pushed":1,"candidateP50":0.628,"candidateP90":0.628,"candidateTop1":0.628,"pushedMean":0.628,"saturationRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"github-new-llm-tools":0.5,"exa-llm-news":0.6,"hf-daily-papers":0.6,"v2ex-hot":0.2,"bili-llm":0.2},"bySource":{"exa-llm-news":1}}
{"at":1788310983181,"candidates":3,"pushed":3,"collected":1676,"relevant":341,"skippedSources":["hf-daily-papers"],"feedbackCount":0,"candidateP50":0.5,"candidateP90":0.652,"candidateTop1":0.652,"rawP50":0.5,"rawTop1":0.604,"pushedMean":0.551,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"github-new-llm-tools":0.5,"exa-llm-news":0.58,"hf-daily-papers":0.58,"v2ex-hot":0.26,"bili-llm":0.26},"bySource":{"exa-llm-news":1,"github-new-llm-tools":2}}
{"at":1788311788421,"candidates":0,"pushed":0,"collected":1676,"relevant":338,"skippedSources":["hf-daily-papers"],"feedbackCount":0,"candidateP50":0,"candidateP90":0,"candidateTop1":0,"rawP50":0,"rawTop1":0,"pushedMean":0,"saturationRate":0,"isNewRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"github-new-llm-tools":0.5,"exa-llm-news":0.58,"hf-daily-papers":0.58,"v2ex-hot":0.26,"bili-llm":0.26},"bySource":{}}
```
