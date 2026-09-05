## 探针证据快照（gen-evidence.mjs 生成，非手抄）

```json
{
  "generatedAt": "2026-09-05T13:40:58.855Z",
  "probeStart": null,
  "rounds": 16,
  "lastRound": {
    "at": 1788615643768,
    "candidates": 0,
    "pushed": 0,
    "collected": 53,
    "relevant": 0,
    "skippedSources": [],
    "feedbackCount": 5,
    "sourceYield": {
      "hn-frontpage": {
        "fetched": 20,
        "afterDedupe": 17,
        "afterFilter": 0
      },
      "github-new-llm-tools": {
        "fetched": 15,
        "afterDedupe": 9,
        "afterFilter": 0
      },
      "exa-llm-news": {
        "fetched": 8,
        "afterDedupe": 0,
        "afterFilter": 0
      },
      "exa-agent-releases": {
        "fetched": 8,
        "afterDedupe": 7,
        "afterFilter": 0
      },
      "openai-news": {
        "fetched": 1,
        "afterDedupe": 0,
        "afterFilter": 0
      },
      "anthropic-research": {
        "fetched": 1,
        "afterDedupe": 0,
        "afterFilter": 0
      }
    },
    "zeroYieldSources": [
      "hn-frontpage",
      "github-new-llm-tools",
      "exa-agent-releases"
    ],
    "emptyYieldSources": [],
    "candidateP50": 0,
    "candidateP90": 0,
    "candidateTop1": 0,
    "rawP50": 0,
    "rawP90": 0,
    "rawTop1": 0,
    "pushedMean": 0,
    "saturationRate": 0,
    "isNewRate": 0,
    "weights": {
      "arxiv-cs-ai": 0.5,
      "huggingface-blog": 0.5,
      "hn-frontpage": 0.4,
      "simonwillison": 0.4,
      "jiqizhixin": 0.3,
      "qbitai": 0.3,
      "github-new-llm-tools": 0.5,
      "github-agents": 0.4,
      "github-rag": 0.3,
      "exa-llm-news": 0.6,
      "exa-agent-releases": 0.4,
      "exa-cn-ai": 0.3,
      "hf-daily-papers": 0.6,
      "openai-news": 0.4,
      "anthropic-research": 0.4,
      "v2ex-hot": 0.2,
      "bili-llm": 0.2,
      "yt-llm": 0.3
    },
    "bySource": {},
    "enabledSourceIds": [
      "hn-frontpage",
      "github-new-llm-tools",
      "exa-llm-news",
      "exa-agent-releases",
      "openai-news",
      "anthropic-research"
    ],
    "telegram": "disabled",
    "pushedDelivered": 0
  },
  "archive": {
    "total": 225,
    "pushed": 66,
    "bySource": {
      "arxiv-cs-ai": 105,
      "huggingface-blog": 41,
      "github-new-llm-tools": 9,
      "exa-llm-news": 10,
      "simonwillison": 17,
      "hf-daily-papers": 2,
      "github-rag": 17,
      "exa-agent-releases": 3,
      "yt-llm": 10,
      "github-agents": 6,
      "hn-frontpage": 3,
      "openai-news": 1,
      "anthropic-research": 1
    }
  },
  "feedbackCount": 5,
  "viewsCount": 5,
  "weights": {},
  "weightsFeedbackHash": "5d31411f8e5f",
  "criteria": [
    {
      "id": "I-1",
      "name": "连续 3 轮 candidates=0（候选池枯竭）",
      "threshold": "3 轮",
      "value": "5/3 轮",
      "status": "fail",
      "note": "M6 标定中：拟加「且全源零新增」限定（arXiv 周五/周六无公告属排班，非仪器故障）"
    },
    {
      "id": "I-2",
      "name": "反馈率 < 5%（👍+👎 数 / 推送条数）",
      "threshold": "5%",
      "value": "5/9 = 55.6%",
      "status": "pass",
      "note": "无 Telegram key 时无输入通道，nodata 属预期；全史口径——签字稿定稿时同批切换"
    },
    {
      "id": "I-3",
      "name": "采集失败+零产出源占比 连续 3 轮 > 1/3（B′1 新口径）",
      "threshold": "1/3",
      "value": "3/6 = 50%",
      "status": "fail",
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
      "value": "5 次",
      "status": "nodata",
      "note": "views.json 是 viewed 唯一定义（criteria §2c）"
    },
    {
      "id": "G-2",
      "name": "👍率 < 20%（有效反馈中）",
      "threshold": "20%",
      "value": "40.0%（2👍/3👎）",
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
      "value": "5 次",
      "status": "nodata",
      "note": ""
    },
    {
      "id": "P-2",
      "name": "👍率 ≥ 30% 且有效反馈 ≥ 20 条",
      "threshold": "30% 且 20 条",
      "value": "40.0% 且 5 条",
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
| I-1 | 连续 3 轮 candidates=0（候选池枯竭） | 3 轮 | 5/3 轮 | **fail** | M6 标定中：拟加「且全源零新增」限定（arXiv 周五/周六无公告属排班，非仪器故障） |
| I-2 | 反馈率 < 5%（👍+👎 数 / 推送条数） | 5% | 5/9 = 55.6% | **pass** | 无 Telegram key 时无输入通道，nodata 属预期；全史口径——签字稿定稿时同批切换 |
| I-3 | 采集失败+零产出源占比 连续 3 轮 > 1/3（B′1 新口径） | 1/3 | 3/6 = 50% | **fail** | 分母按轮取（§2.6.4）；返回空的源单列 emptyYieldSources 可见不报警，是否并入分子待 M6 标定 |
| I-4 | saturationRate 持续 > 0.5（原始分口径；判据形式待裁） | 0.5 | 0 | **pass** | 决策点 7 待裁：现行形式被 M3 证明恒真/恒假不可用；倾向案 B（rawP90 ≥ X），X 归联合标定（决策点 8），签字稿定稿时同批切换 |
| G-1 | 主动消费性查看 < 10 次（两周累计） | 10 次 | 5 次 | **nodata** | views.json 是 viewed 唯一定义（criteria §2c） |
| G-2 | 👍率 < 20%（有效反馈中） | 20% | 40.0%（2👍/3👎） | **nodata** |  |
| G-3 | 戒断测试：停 3 天无主动打开 | 停 3 天 | 需探针期末人工判读 | **nodata** | 依赖探针结束后的戒断窗口观测 |
| P-1 | 主动查看 ≥ 10 次 | 10 次 | 5 次 | **nodata** |  |
| P-2 | 👍率 ≥ 30% 且有效反馈 ≥ 20 条 | 30% 且 20 条 | 40.0% 且 5 条 | **nodata** | 有效反馈已按 C′10 同条同信号去重，不可被重放虚增 |
| P-3 | 戒断测试通过：停 3 天内有主动打开 | 停 3 天 | 需探针期末人工判读 | **nodata** | 依赖探针结束后的戒断窗口观测 |
| P-4 | 定性证据 ≥1 条（probe-changelog.md 的 P-4 artifact 行） | ≥1 条 | 0 条有效 / 0 行 P-4 记录 | **nodata** | artifact 行格式：`| P-4 | <date> | digestId=<id> | itemId=<id> | decision=<一句话> |`——四要素齐备才计有效（D5） |

> G/P 组为两周累计/期末项，中途一律 nodata；探针结束后加 --probe-end 评估。

### observations.jsonl 全文

```jsonl
{"at":1788536935800,"candidates":165,"pushed":6,"collected":1237,"relevant":387,"skippedSources":[],"feedbackCount":0,"sourceYield":{"arxiv-cs-ai":{"fetched":269,"afterDedupe":269,"afterFilter":169},"huggingface-blog":{"fetched":859,"afterDedupe":859,"afterFilter":171},"hn-frontpage":{"fetched":20,"afterDedupe":20,"afterFilter":1},"simonwillison":{"fetched":30,"afterDedupe":30,"afterFilter":11},"github-new-llm-tools":{"fetched":15,"afterDedupe":15,"afterFilter":15},"github-agents":{"fetched":10,"afterDedupe":1,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":10,"afterFilter":10},"exa-llm-news":{"fetched":8,"afterDedupe":8,"afterFilter":1},"exa-agent-releases":{"fetched":8,"afterDedupe":8,"afterFilter":3},"hf-daily-papers":{"fetched":1,"afterDedupe":1,"afterFilter":1},"openai-news":{"fetched":1,"afterDedupe":1,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":1,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":5,"afterFilter":5}},"zeroYieldSources":["github-agents","openai-news","anthropic-research"],"emptyYieldSources":[],"candidateP50":0.529,"candidateP90":0.658,"candidateTop1":0.748,"rawP50":0.529,"rawP90":0.658,"rawTop1":0.748,"pushedMean":0.675,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.42000000000000004,"simonwillison":0.42000000000000004,"jiqizhixin":0.33999999999999997,"qbitai":0.33999999999999997,"github-new-llm-tools":0.5,"github-agents":0.42000000000000004,"github-rag":0.33999999999999997,"exa-llm-news":0.58,"exa-agent-releases":0.42000000000000004,"exa-cn-ai":0.33999999999999997,"hf-daily-papers":0.58,"openai-news":0.42000000000000004,"anthropic-research":0.42000000000000004,"v2ex-hot":0.26,"bili-llm":0.26,"yt-llm":0.33999999999999997},"bySource":{"arxiv-cs-ai":3,"huggingface-blog":3},"enabledSourceIds":["arxiv-cs-ai","huggingface-blog","hn-frontpage","simonwillison","github-new-llm-tools","github-agents","github-rag","exa-llm-news","exa-agent-releases","hf-daily-papers","openai-news","anthropic-research","yt-llm"],"telegram":"sent","pushedDelivered":6}
{"at":1788537131168,"candidates":0,"pushed":0,"collected":1237,"relevant":222,"skippedSources":[],"feedbackCount":0,"sourceYield":{"arxiv-cs-ai":{"fetched":269,"afterDedupe":164,"afterFilter":64},"huggingface-blog":{"fetched":859,"afterDedupe":830,"afterFilter":142},"hn-frontpage":{"fetched":20,"afterDedupe":20,"afterFilter":1},"simonwillison":{"fetched":30,"afterDedupe":22,"afterFilter":3},"github-new-llm-tools":{"fetched":15,"afterDedupe":8,"afterFilter":8},"github-agents":{"fetched":10,"afterDedupe":1,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":1,"afterFilter":1},"exa-llm-news":{"fetched":8,"afterDedupe":7,"afterFilter":0},"exa-agent-releases":{"fetched":8,"afterDedupe":6,"afterFilter":1},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"openai-news":{"fetched":1,"afterDedupe":1,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":1,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":2,"afterFilter":2}},"zeroYieldSources":["github-agents","exa-llm-news","openai-news","anthropic-research"],"emptyYieldSources":[],"candidateP50":0,"candidateP90":0,"candidateTop1":0,"rawP50":0,"rawP90":0,"rawTop1":0,"pushedMean":0,"saturationRate":0,"isNewRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.42000000000000004,"simonwillison":0.42000000000000004,"jiqizhixin":0.33999999999999997,"qbitai":0.33999999999999997,"github-new-llm-tools":0.5,"github-agents":0.42000000000000004,"github-rag":0.33999999999999997,"exa-llm-news":0.58,"exa-agent-releases":0.42000000000000004,"exa-cn-ai":0.33999999999999997,"hf-daily-papers":0.58,"openai-news":0.42000000000000004,"anthropic-research":0.42000000000000004,"v2ex-hot":0.26,"bili-llm":0.26,"yt-llm":0.33999999999999997},"bySource":{},"enabledSourceIds":["arxiv-cs-ai","huggingface-blog","hn-frontpage","simonwillison","github-new-llm-tools","github-agents","github-rag","exa-llm-news","exa-agent-releases","hf-daily-papers","openai-news","anthropic-research","yt-llm"],"telegram":"skipped-empty","pushedDelivered":0}
{"at":1788537789950,"candidates":0,"pushed":0,"collected":1237,"relevant":222,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":269,"afterDedupe":164,"afterFilter":64},"huggingface-blog":{"fetched":859,"afterDedupe":830,"afterFilter":142},"hn-frontpage":{"fetched":20,"afterDedupe":20,"afterFilter":1},"simonwillison":{"fetched":30,"afterDedupe":22,"afterFilter":3},"github-new-llm-tools":{"fetched":15,"afterDedupe":8,"afterFilter":8},"github-agents":{"fetched":10,"afterDedupe":1,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":1,"afterFilter":1},"exa-llm-news":{"fetched":8,"afterDedupe":7,"afterFilter":0},"exa-agent-releases":{"fetched":8,"afterDedupe":6,"afterFilter":1},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"openai-news":{"fetched":1,"afterDedupe":1,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":1,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":2,"afterFilter":2}},"zeroYieldSources":["github-agents","exa-llm-news","openai-news","anthropic-research"],"emptyYieldSources":[],"candidateP50":0,"candidateP90":0,"candidateTop1":0,"rawP50":0,"rawP90":0,"rawTop1":0,"pushedMean":0,"saturationRate":0,"isNewRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{},"enabledSourceIds":["arxiv-cs-ai","huggingface-blog","hn-frontpage","simonwillison","github-new-llm-tools","github-agents","github-rag","exa-llm-news","exa-agent-releases","hf-daily-papers","openai-news","anthropic-research","yt-llm"],"telegram":"skipped-empty","pushedDelivered":0}
{"at":1788537993561,"candidates":1,"pushed":1,"collected":1236,"relevant":223,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":269,"afterDedupe":164,"afterFilter":64},"huggingface-blog":{"fetched":859,"afterDedupe":830,"afterFilter":142},"hn-frontpage":{"fetched":19,"afterDedupe":19,"afterFilter":1},"simonwillison":{"fetched":30,"afterDedupe":22,"afterFilter":3},"github-new-llm-tools":{"fetched":15,"afterDedupe":8,"afterFilter":8},"github-agents":{"fetched":10,"afterDedupe":1,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":1,"afterFilter":1},"exa-llm-news":{"fetched":8,"afterDedupe":7,"afterFilter":0},"exa-agent-releases":{"fetched":8,"afterDedupe":6,"afterFilter":2},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"openai-news":{"fetched":1,"afterDedupe":1,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":1,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":2,"afterFilter":2}},"zeroYieldSources":["github-agents","exa-llm-news","openai-news","anthropic-research"],"emptyYieldSources":[],"candidateP50":0.4,"candidateP90":0.4,"candidateTop1":0.4,"rawP50":0.5,"rawP90":0.5,"rawTop1":0.5,"pushedMean":0.4,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{"yt-llm":1},"enabledSourceIds":["arxiv-cs-ai","huggingface-blog","hn-frontpage","simonwillison","github-new-llm-tools","github-agents","github-rag","exa-llm-news","exa-agent-releases","hf-daily-papers","openai-news","anthropic-research","yt-llm"],"telegram":"sent","pushedDelivered":1}
{"at":1788538904895,"candidates":0,"pushed":0,"collected":1235,"relevant":223,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":269,"afterDedupe":164,"afterFilter":64},"huggingface-blog":{"fetched":859,"afterDedupe":830,"afterFilter":142},"hn-frontpage":{"fetched":18,"afterDedupe":18,"afterFilter":1},"simonwillison":{"fetched":30,"afterDedupe":22,"afterFilter":3},"github-new-llm-tools":{"fetched":15,"afterDedupe":8,"afterFilter":8},"github-agents":{"fetched":10,"afterDedupe":1,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":1,"afterFilter":1},"exa-llm-news":{"fetched":8,"afterDedupe":7,"afterFilter":0},"exa-agent-releases":{"fetched":8,"afterDedupe":6,"afterFilter":2},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"openai-news":{"fetched":1,"afterDedupe":1,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":1,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":2,"afterFilter":2}},"zeroYieldSources":["github-agents","exa-llm-news","openai-news","anthropic-research"],"emptyYieldSources":[],"candidateP50":0,"candidateP90":0,"candidateTop1":0,"rawP50":0,"rawP90":0,"rawTop1":0,"pushedMean":0,"saturationRate":0,"isNewRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{},"enabledSourceIds":["arxiv-cs-ai","huggingface-blog","hn-frontpage","simonwillison","github-new-llm-tools","github-agents","github-rag","exa-llm-news","exa-agent-releases","hf-daily-papers","openai-news","anthropic-research","yt-llm"],"telegram":"skipped-empty","pushedDelivered":0}
{"at":1788542574877,"candidates":1,"pushed":1,"collected":1237,"relevant":223,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":269,"afterDedupe":164,"afterFilter":64},"huggingface-blog":{"fetched":859,"afterDedupe":830,"afterFilter":142},"hn-frontpage":{"fetched":20,"afterDedupe":20,"afterFilter":1},"simonwillison":{"fetched":30,"afterDedupe":22,"afterFilter":3},"github-new-llm-tools":{"fetched":15,"afterDedupe":8,"afterFilter":8},"github-agents":{"fetched":10,"afterDedupe":1,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":1,"afterFilter":1},"exa-llm-news":{"fetched":8,"afterDedupe":7,"afterFilter":1},"exa-agent-releases":{"fetched":8,"afterDedupe":6,"afterFilter":1},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"openai-news":{"fetched":1,"afterDedupe":1,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":1,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":2,"afterFilter":2}},"zeroYieldSources":["github-agents","openai-news","anthropic-research"],"emptyYieldSources":[],"candidateP50":0.582,"candidateP90":0.582,"candidateTop1":0.582,"rawP50":0.529,"rawP90":0.529,"rawTop1":0.529,"pushedMean":0.582,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{"exa-llm-news":1},"enabledSourceIds":["arxiv-cs-ai","huggingface-blog","hn-frontpage","simonwillison","github-new-llm-tools","github-agents","github-rag","exa-llm-news","exa-agent-releases","hf-daily-papers","openai-news","anthropic-research","yt-llm"],"telegram":"sent","pushedDelivered":1}
{"at":1788543723867,"candidates":1,"pushed":1,"collected":1235,"relevant":223,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":269,"afterDedupe":164,"afterFilter":64},"huggingface-blog":{"fetched":859,"afterDedupe":830,"afterFilter":142},"hn-frontpage":{"fetched":18,"afterDedupe":18,"afterFilter":1},"simonwillison":{"fetched":30,"afterDedupe":22,"afterFilter":4},"github-new-llm-tools":{"fetched":15,"afterDedupe":8,"afterFilter":8},"github-agents":{"fetched":10,"afterDedupe":1,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":1,"afterFilter":1},"exa-llm-news":{"fetched":8,"afterDedupe":6,"afterFilter":0},"exa-agent-releases":{"fetched":8,"afterDedupe":6,"afterFilter":1},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"openai-news":{"fetched":1,"afterDedupe":1,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":1,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":2,"afterFilter":2}},"zeroYieldSources":["github-agents","exa-llm-news","openai-news","anthropic-research"],"emptyYieldSources":[],"candidateP50":0.543,"candidateP90":0.543,"candidateTop1":0.543,"rawP50":0.604,"rawP90":0.604,"rawTop1":0.604,"pushedMean":0.543,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{"simonwillison":1},"enabledSourceIds":["arxiv-cs-ai","huggingface-blog","hn-frontpage","simonwillison","github-new-llm-tools","github-agents","github-rag","exa-llm-news","exa-agent-releases","hf-daily-papers","openai-news","anthropic-research","yt-llm"],"telegram":"sent","pushedDelivered":1}
{"at":1788544283790,"candidates":0,"pushed":0,"collected":1235,"relevant":222,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":269,"afterDedupe":164,"afterFilter":64},"huggingface-blog":{"fetched":859,"afterDedupe":830,"afterFilter":142},"hn-frontpage":{"fetched":18,"afterDedupe":18,"afterFilter":1},"simonwillison":{"fetched":30,"afterDedupe":21,"afterFilter":3},"github-new-llm-tools":{"fetched":15,"afterDedupe":8,"afterFilter":8},"github-agents":{"fetched":10,"afterDedupe":1,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":1,"afterFilter":1},"exa-llm-news":{"fetched":8,"afterDedupe":6,"afterFilter":0},"exa-agent-releases":{"fetched":8,"afterDedupe":6,"afterFilter":1},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"openai-news":{"fetched":1,"afterDedupe":1,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":1,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":2,"afterFilter":2}},"zeroYieldSources":["github-agents","exa-llm-news","openai-news","anthropic-research"],"emptyYieldSources":[],"candidateP50":0,"candidateP90":0,"candidateTop1":0,"rawP50":0,"rawP90":0,"rawTop1":0,"pushedMean":0,"saturationRate":0,"isNewRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{},"enabledSourceIds":["arxiv-cs-ai","huggingface-blog","hn-frontpage","simonwillison","github-new-llm-tools","github-agents","github-rag","exa-llm-news","exa-agent-releases","hf-daily-papers","openai-news","anthropic-research","yt-llm"],"telegram":"skipped-empty","pushedDelivered":0}
{"at":1788608694907,"candidates":40,"pushed":40,"collected":915,"relevant":40,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":0,"afterDedupe":0,"afterFilter":0},"huggingface-blog":{"fetched":859,"afterDedupe":859,"afterFilter":12},"simonwillison":{"fetched":30,"afterDedupe":30,"afterFilter":8},"github-agents":{"fetched":10,"afterDedupe":10,"afterFilter":6},"github-rag":{"fetched":10,"afterDedupe":10,"afterFilter":8},"hf-daily-papers":{"fetched":1,"afterDedupe":1,"afterFilter":1},"yt-llm":{"fetched":5,"afterDedupe":5,"afterFilter":5}},"zeroYieldSources":[],"emptyYieldSources":["arxiv-cs-ai"],"candidateP50":0.4,"candidateP90":0.482,"candidateTop1":0.635,"rawP50":0.427,"rawP90":0.602,"rawTop1":0.706,"pushedMean":0.38,"saturationRate":0,"isNewRate":0.8,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{"github-agents":6,"github-rag":8,"huggingface-blog":12,"hf-daily-papers":1,"simonwillison":8,"yt-llm":5},"enabledSourceIds":["arxiv-cs-ai","huggingface-blog","simonwillison","github-agents","github-rag","hf-daily-papers","yt-llm"],"telegram":"disabled","pushedDelivered":0}
{"at":1788609311161,"candidates":16,"pushed":16,"collected":52,"relevant":16,"skippedSources":[],"feedbackCount":5,"sourceYield":{"hn-frontpage":{"fetched":19,"afterDedupe":19,"afterFilter":3},"github-new-llm-tools":{"fetched":15,"afterDedupe":11,"afterFilter":2},"exa-llm-news":{"fetched":8,"afterDedupe":8,"afterFilter":8},"exa-agent-releases":{"fetched":8,"afterDedupe":8,"afterFilter":1},"openai-news":{"fetched":1,"afterDedupe":1,"afterFilter":1},"anthropic-research":{"fetched":1,"afterDedupe":1,"afterFilter":1}},"zeroYieldSources":[],"emptyYieldSources":[],"candidateP50":0.275,"candidateP90":0.469,"candidateTop1":0.602,"rawP50":0.25,"rawP90":0.529,"rawTop1":0.602,"pushedMean":0.324,"saturationRate":0,"isNewRate":0.875,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{"github-new-llm-tools":2,"exa-llm-news":8,"exa-agent-releases":1,"hn-frontpage":3,"openai-news":1,"anthropic-research":1},"enabledSourceIds":["hn-frontpage","github-new-llm-tools","exa-llm-news","exa-agent-releases","openai-news","anthropic-research"],"telegram":"disabled","pushedDelivered":0}
{"at":1788610886587,"candidates":1,"pushed":1,"collected":915,"relevant":1,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":0,"afterDedupe":0,"afterFilter":0},"huggingface-blog":{"fetched":859,"afterDedupe":847,"afterFilter":0},"simonwillison":{"fetched":30,"afterDedupe":22,"afterFilter":0},"github-agents":{"fetched":10,"afterDedupe":4,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":2,"afterFilter":0},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":1,"afterFilter":1}},"zeroYieldSources":["huggingface-blog","simonwillison","github-agents","github-rag"],"emptyYieldSources":["arxiv-cs-ai"],"candidateP50":0.341,"candidateP90":0.341,"candidateTop1":0.341,"rawP50":0.427,"rawP90":0.427,"rawTop1":0.427,"pushedMean":0.341,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{"yt-llm":1},"enabledSourceIds":["arxiv-cs-ai","huggingface-blog","simonwillison","github-agents","github-rag","hf-daily-papers","yt-llm"],"telegram":"disabled","pushedDelivered":0}
{"at":1788610896822,"candidates":0,"pushed":0,"collected":53,"relevant":0,"skippedSources":[],"feedbackCount":5,"sourceYield":{"hn-frontpage":{"fetched":20,"afterDedupe":17,"afterFilter":0},"github-new-llm-tools":{"fetched":15,"afterDedupe":9,"afterFilter":0},"exa-llm-news":{"fetched":8,"afterDedupe":0,"afterFilter":0},"exa-agent-releases":{"fetched":8,"afterDedupe":7,"afterFilter":0},"openai-news":{"fetched":1,"afterDedupe":0,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":0,"afterFilter":0}},"zeroYieldSources":["hn-frontpage","github-new-llm-tools","exa-agent-releases"],"emptyYieldSources":[],"candidateP50":0,"candidateP90":0,"candidateTop1":0,"rawP50":0,"rawP90":0,"rawTop1":0,"pushedMean":0,"saturationRate":0,"isNewRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{},"enabledSourceIds":["hn-frontpage","github-new-llm-tools","exa-llm-news","exa-agent-releases","openai-news","anthropic-research"],"telegram":"disabled","pushedDelivered":0}
{"at":1788611537099,"candidates":0,"pushed":0,"collected":915,"relevant":0,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":0,"afterDedupe":0,"afterFilter":0},"huggingface-blog":{"fetched":859,"afterDedupe":847,"afterFilter":0},"simonwillison":{"fetched":30,"afterDedupe":22,"afterFilter":0},"github-agents":{"fetched":10,"afterDedupe":4,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":2,"afterFilter":0},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":1,"afterFilter":0}},"zeroYieldSources":["huggingface-blog","simonwillison","github-agents","github-rag","yt-llm"],"emptyYieldSources":["arxiv-cs-ai"],"candidateP50":0,"candidateP90":0,"candidateTop1":0,"rawP50":0,"rawP90":0,"rawTop1":0,"pushedMean":0,"saturationRate":0,"isNewRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{},"enabledSourceIds":["arxiv-cs-ai","huggingface-blog","simonwillison","github-agents","github-rag","hf-daily-papers","yt-llm"],"telegram":"disabled","pushedDelivered":0}
{"at":1788611546346,"candidates":0,"pushed":0,"collected":53,"relevant":0,"skippedSources":[],"feedbackCount":5,"sourceYield":{"hn-frontpage":{"fetched":20,"afterDedupe":17,"afterFilter":0},"github-new-llm-tools":{"fetched":15,"afterDedupe":9,"afterFilter":0},"exa-llm-news":{"fetched":8,"afterDedupe":0,"afterFilter":0},"exa-agent-releases":{"fetched":8,"afterDedupe":7,"afterFilter":0},"openai-news":{"fetched":1,"afterDedupe":0,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":0,"afterFilter":0}},"zeroYieldSources":["hn-frontpage","github-new-llm-tools","exa-agent-releases"],"emptyYieldSources":[],"candidateP50":0,"candidateP90":0,"candidateTop1":0,"rawP50":0,"rawP90":0,"rawTop1":0,"pushedMean":0,"saturationRate":0,"isNewRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{},"enabledSourceIds":["hn-frontpage","github-new-llm-tools","exa-llm-news","exa-agent-releases","openai-news","anthropic-research"],"telegram":"disabled","pushedDelivered":0}
{"at":1788615633744,"candidates":0,"pushed":0,"collected":915,"relevant":0,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":0,"afterDedupe":0,"afterFilter":0},"huggingface-blog":{"fetched":859,"afterDedupe":847,"afterFilter":0},"simonwillison":{"fetched":30,"afterDedupe":22,"afterFilter":0},"github-agents":{"fetched":10,"afterDedupe":4,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":2,"afterFilter":0},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":0,"afterFilter":0}},"zeroYieldSources":["huggingface-blog","simonwillison","github-agents","github-rag"],"emptyYieldSources":["arxiv-cs-ai"],"candidateP50":0,"candidateP90":0,"candidateTop1":0,"rawP50":0,"rawP90":0,"rawTop1":0,"pushedMean":0,"saturationRate":0,"isNewRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{},"enabledSourceIds":["arxiv-cs-ai","huggingface-blog","simonwillison","github-agents","github-rag","hf-daily-papers","yt-llm"],"telegram":"disabled","pushedDelivered":0}
{"at":1788615643768,"candidates":0,"pushed":0,"collected":53,"relevant":0,"skippedSources":[],"feedbackCount":5,"sourceYield":{"hn-frontpage":{"fetched":20,"afterDedupe":17,"afterFilter":0},"github-new-llm-tools":{"fetched":15,"afterDedupe":9,"afterFilter":0},"exa-llm-news":{"fetched":8,"afterDedupe":0,"afterFilter":0},"exa-agent-releases":{"fetched":8,"afterDedupe":7,"afterFilter":0},"openai-news":{"fetched":1,"afterDedupe":0,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":0,"afterFilter":0}},"zeroYieldSources":["hn-frontpage","github-new-llm-tools","exa-agent-releases"],"emptyYieldSources":[],"candidateP50":0,"candidateP90":0,"candidateTop1":0,"rawP50":0,"rawP90":0,"rawTop1":0,"pushedMean":0,"saturationRate":0,"isNewRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{},"enabledSourceIds":["hn-frontpage","github-new-llm-tools","exa-llm-news","exa-agent-releases","openai-news","anthropic-research"],"telegram":"disabled","pushedDelivered":0}
```
