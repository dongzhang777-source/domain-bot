## 探针证据快照（gen-evidence.mjs 生成，非手抄）

```json
{
  "generatedAt": "2026-09-07T14:19:00.922Z",
  "probeStart": null,
  "rounds": 40,
  "lastRound": {
    "at": 1788788503502,
    "candidates": 40,
    "pushed": 10,
    "collected": 303,
    "relevant": 40,
    "skippedSources": [
      "hn-search-llm",
      "hn-search-ai"
    ],
    "feedbackCount": 5,
    "sourceYield": {
      "hn-frontpage": {
        "fetched": 20,
        "afterDedupe": 20,
        "afterFilter": 2
      },
      "github-new-llm-tools": {
        "fetched": 30,
        "afterDedupe": 1,
        "afterFilter": 0
      },
      "github-llm-inference": {
        "fetched": 20,
        "afterDedupe": 1,
        "afterFilter": 1
      },
      "github-finetuning": {
        "fetched": 20,
        "afterDedupe": 3,
        "afterFilter": 1
      },
      "github-mcp-tools": {
        "fetched": 20,
        "afterDedupe": 1,
        "afterFilter": 0
      },
      "exa-llm-news": {
        "fetched": 13,
        "afterDedupe": 6,
        "afterFilter": 6
      },
      "exa-agent-releases": {
        "fetched": 12,
        "afterDedupe": 6,
        "afterFilter": 1
      },
      "exa-model-launches": {
        "fetched": 22,
        "afterDedupe": 2,
        "afterFilter": 2
      },
      "exa-ai-industry": {
        "fetched": 16,
        "afterDedupe": 6,
        "afterFilter": 6
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
      },
      "exa-ondevice-ai": {
        "fetched": 15,
        "afterDedupe": 6,
        "afterFilter": 5
      },
      "github-local-llm": {
        "fetched": 20,
        "afterDedupe": 1,
        "afterFilter": 0
      },
      "exa-benchmark-sota": {
        "fetched": 14,
        "afterDedupe": 4,
        "afterFilter": 4
      },
      "exa-open-weights": {
        "fetched": 20,
        "afterDedupe": 4,
        "afterFilter": 4
      },
      "github-inference-engines": {
        "fetched": 15,
        "afterDedupe": 0,
        "afterFilter": 0
      },
      "exa-ai-hardware": {
        "fetched": 14,
        "afterDedupe": 3,
        "afterFilter": 3
      },
      "twitter-feed": {
        "fetched": 30,
        "afterDedupe": 30,
        "afterFilter": 5
      }
    },
    "zeroYieldSources": [
      "github-new-llm-tools",
      "github-mcp-tools",
      "github-local-llm"
    ],
    "emptyYieldSources": [],
    "candidateP50": 0.384,
    "candidateP90": 0.664,
    "candidateTop1": 0.8,
    "rawP50": 0.427,
    "rawP90": 0.604,
    "rawTop1": 0.748,
    "pushedMean": 0.527,
    "saturationRate": 0,
    "isNewRate": 0.975,
    "weights": {
      "arxiv-cs-ai": 0.5,
      "arxiv-cs-cl": 0.5,
      "arxiv-cs-lg": 0.5,
      "huggingface-blog": 0.5,
      "hn-frontpage": 0.4,
      "hn-search-llm": 0.4,
      "hn-search-ai": 0.4,
      "simonwillison": 0.4,
      "jiqizhixin": 0.3,
      "qbitai": 0.3,
      "github-new-llm-tools": 0.5,
      "github-llm-inference": 0.4,
      "github-finetuning": 0.4,
      "github-mcp-tools": 0.4,
      "github-agents": 0.4,
      "github-rag": 0.3,
      "exa-llm-news": 0.6,
      "exa-agent-releases": 0.4,
      "exa-model-launches": 0.4,
      "exa-ai-industry": 0.4,
      "exa-cn-ai": 0.3,
      "hf-daily-papers": 0.6,
      "openai-news": 0.4,
      "anthropic-research": 0.4,
      "v2ex-hot": 0.2,
      "bili-llm": 0.2,
      "yt-llm": 0.3,
      "exa-ondevice-ai": 0.4,
      "github-local-llm": 0.4,
      "exa-benchmark-sota": 0.4,
      "exa-open-weights": 0.4,
      "github-inference-engines": 0.4,
      "exa-ai-hardware": 0.4,
      "twitter-feed": 0.9,
      "anysearch-local-llm": 0.7,
      "anysearch-agent-bench": 0.7
    },
    "bySource": {
      "exa-benchmark-sota": 2,
      "exa-llm-news": 2,
      "exa-model-launches": 1,
      "exa-ai-industry": 1,
      "twitter-feed": 1,
      "exa-ai-hardware": 2,
      "exa-ondevice-ai": 1
    },
    "enabledSourceIds": [
      "hn-frontpage",
      "hn-search-llm",
      "hn-search-ai",
      "github-new-llm-tools",
      "github-llm-inference",
      "github-finetuning",
      "github-mcp-tools",
      "exa-llm-news",
      "exa-agent-releases",
      "exa-model-launches",
      "exa-ai-industry",
      "openai-news",
      "anthropic-research",
      "exa-ondevice-ai",
      "github-local-llm",
      "exa-benchmark-sota",
      "exa-open-weights",
      "github-inference-engines",
      "exa-ai-hardware",
      "twitter-feed"
    ],
    "recallPoolSize": 20,
    "recallIncluded": 5,
    "stalePrescreened": 127,
    "stalePrescreenedBySource": {
      "github-new-llm-tools": 23,
      "github-llm-inference": 6,
      "github-finetuning": 13,
      "github-mcp-tools": 16,
      "exa-llm-news": 5,
      "exa-agent-releases": 1,
      "exa-model-launches": 14,
      "exa-ai-industry": 5,
      "exa-ondevice-ai": 7,
      "github-local-llm": 13,
      "exa-benchmark-sota": 6,
      "exa-open-weights": 7,
      "github-inference-engines": 3,
      "exa-ai-hardware": 8
    },
    "telegram": "disabled",
    "pushedDelivered": 0
  },
  "archive": {
    "total": 1028,
    "pushed": 438,
    "bySource": {
      "arxiv-cs-ai": 450,
      "huggingface-blog": 55,
      "github-new-llm-tools": 15,
      "exa-llm-news": 26,
      "simonwillison": 29,
      "hf-daily-papers": 2,
      "github-rag": 26,
      "exa-agent-releases": 8,
      "yt-llm": 15,
      "github-agents": 13,
      "hn-frontpage": 14,
      "openai-news": 1,
      "anthropic-research": 1,
      "github-llm-inference": 15,
      "github-finetuning": 7,
      "github-mcp-tools": 3,
      "exa-model-launches": 15,
      "exa-ai-industry": 18,
      "exa-ondevice-ai": 15,
      "github-local-llm": 4,
      "exa-benchmark-sota": 11,
      "exa-open-weights": 15,
      "exa-ai-hardware": 9,
      "arxiv-cs-cl": 190,
      "arxiv-cs-lg": 57,
      "anysearch-local-llm": 6,
      "anysearch-agent-bench": 3,
      "twitter-feed": 5
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
      "value": "0/3 轮",
      "status": "pass",
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
      "value": "5/20 = 25%",
      "status": "pass",
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
| I-1 | 连续 3 轮 candidates=0（候选池枯竭） | 3 轮 | 0/3 轮 | **pass** | M6 标定中：拟加「且全源零新增」限定（arXiv 周五/周六无公告属排班，非仪器故障） |
| I-2 | 反馈率 < 5%（👍+👎 数 / 推送条数） | 5% | 5/9 = 55.6% | **pass** | 无 Telegram key 时无输入通道，nodata 属预期；全史口径——签字稿定稿时同批切换 |
| I-3 | 采集失败+零产出源占比 连续 3 轮 > 1/3（B′1 新口径） | 1/3 | 5/20 = 25% | **pass** | 分母按轮取（§2.6.4）；返回空的源单列 emptyYieldSources 可见不报警，是否并入分子待 M6 标定 |
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
{"at":1788637273540,"candidates":14,"pushed":8,"collected":915,"relevant":14,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":0,"afterDedupe":0,"afterFilter":0},"huggingface-blog":{"fetched":859,"afterDedupe":847,"afterFilter":3},"simonwillison":{"fetched":30,"afterDedupe":22,"afterFilter":3},"github-agents":{"fetched":10,"afterDedupe":5,"afterFilter":3},"github-rag":{"fetched":10,"afterDedupe":2,"afterFilter":1},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":5,"afterFilter":4}},"zeroYieldSources":[],"emptyYieldSources":["arxiv-cs-ai"],"candidateP50":0.25,"candidateP90":0.4,"candidateTop1":0.45,"rawP50":0.25,"rawP90":0.5,"rawTop1":0.5,"pushedMean":0.292,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{"simonwillison":2,"huggingface-blog":3,"github-rag":1,"github-agents":2},"enabledSourceIds":["arxiv-cs-ai","huggingface-blog","simonwillison","github-agents","github-rag","hf-daily-papers","yt-llm"],"recallPoolSize":20,"recallIncluded":0,"telegram":"disabled","pushedDelivered":0}
{"at":1788640013498,"candidates":0,"pushed":0,"collected":915,"relevant":0,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":0,"afterDedupe":0,"afterFilter":0},"huggingface-blog":{"fetched":859,"afterDedupe":844,"afterFilter":0},"simonwillison":{"fetched":30,"afterDedupe":19,"afterFilter":0},"github-agents":{"fetched":10,"afterDedupe":2,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":1,"afterFilter":0},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":1,"afterFilter":0}},"zeroYieldSources":["huggingface-blog","simonwillison","github-agents","github-rag","yt-llm"],"emptyYieldSources":["arxiv-cs-ai"],"candidateP50":0,"candidateP90":0,"candidateTop1":0,"rawP50":0,"rawP90":0,"rawTop1":0,"pushedMean":0,"saturationRate":0,"isNewRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{},"enabledSourceIds":["arxiv-cs-ai","huggingface-blog","simonwillison","github-agents","github-rag","hf-daily-papers","yt-llm"],"recallPoolSize":20,"recallIncluded":0,"telegram":"disabled","pushedDelivered":0}
{"at":1788640227005,"candidates":13,"pushed":9,"collected":51,"relevant":13,"skippedSources":[],"feedbackCount":5,"sourceYield":{"hn-frontpage":{"fetched":18,"afterDedupe":16,"afterFilter":3},"github-new-llm-tools":{"fetched":15,"afterDedupe":9,"afterFilter":1},"exa-llm-news":{"fetched":8,"afterDedupe":7,"afterFilter":7},"exa-agent-releases":{"fetched":8,"afterDedupe":7,"afterFilter":2},"openai-news":{"fetched":1,"afterDedupe":0,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":0,"afterFilter":0}},"zeroYieldSources":[],"emptyYieldSources":[],"candidateP50":0.387,"candidateP90":0.476,"candidateTop1":0.662,"rawP50":0.352,"rawP90":0.529,"rawTop1":0.602,"pushedMean":0.439,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{"exa-llm-news":7,"exa-agent-releases":1,"github-new-llm-tools":1},"enabledSourceIds":["hn-frontpage","github-new-llm-tools","exa-llm-news","exa-agent-releases","openai-news","anthropic-research"],"recallPoolSize":16,"recallIncluded":6,"telegram":"disabled","pushedDelivered":0}
{"at":1788644500598,"candidates":7,"pushed":3,"collected":915,"relevant":7,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":0,"afterDedupe":0,"afterFilter":0},"huggingface-blog":{"fetched":859,"afterDedupe":844,"afterFilter":1},"simonwillison":{"fetched":30,"afterDedupe":19,"afterFilter":3},"github-agents":{"fetched":10,"afterDedupe":2,"afterFilter":2},"github-rag":{"fetched":10,"afterDedupe":1,"afterFilter":1},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":1,"afterFilter":0}},"zeroYieldSources":["yt-llm"],"emptyYieldSources":["arxiv-cs-ai"],"candidateP50":0.25,"candidateP90":0.4,"candidateTop1":0.4,"rawP50":0.25,"rawP90":0.5,"rawTop1":0.5,"pushedMean":0.278,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{"github-agents":2,"simonwillison":1},"enabledSourceIds":["arxiv-cs-ai","huggingface-blog","simonwillison","github-agents","github-rag","hf-daily-papers","yt-llm"],"recallPoolSize":20,"recallIncluded":7,"telegram":"disabled","pushedDelivered":0}
{"at":1788645367629,"candidates":0,"pushed":0,"collected":33,"relevant":0,"skippedSources":["hn-frontpage"],"feedbackCount":5,"sourceYield":{"github-new-llm-tools":{"fetched":15,"afterDedupe":8,"afterFilter":0},"exa-llm-news":{"fetched":8,"afterDedupe":0,"afterFilter":0},"exa-agent-releases":{"fetched":8,"afterDedupe":6,"afterFilter":0},"openai-news":{"fetched":1,"afterDedupe":0,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":0,"afterFilter":0}},"zeroYieldSources":["github-new-llm-tools","exa-agent-releases"],"emptyYieldSources":[],"candidateP50":0,"candidateP90":0,"candidateTop1":0,"rawP50":0,"rawP90":0,"rawTop1":0,"pushedMean":0,"saturationRate":0,"isNewRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{},"enabledSourceIds":["hn-frontpage","github-new-llm-tools","exa-llm-news","exa-agent-releases","openai-news","anthropic-research"],"recallPoolSize":1,"recallIncluded":0,"telegram":"disabled","pushedDelivered":0}
{"at":1788649205567,"candidates":11,"pushed":10,"collected":915,"relevant":11,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":0,"afterDedupe":0,"afterFilter":0},"huggingface-blog":{"fetched":859,"afterDedupe":843,"afterFilter":8},"simonwillison":{"fetched":30,"afterDedupe":16,"afterFilter":3},"github-agents":{"fetched":10,"afterDedupe":0,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":0,"afterFilter":0},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":1,"afterFilter":0}},"zeroYieldSources":["yt-llm"],"emptyYieldSources":["arxiv-cs-ai"],"candidateP50":0.25,"candidateP90":0.25,"candidateTop1":0.317,"rawP50":0.25,"rawP90":0.25,"rawTop1":0.352,"pushedMean":0.252,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{"simonwillison":3,"huggingface-blog":7},"enabledSourceIds":["arxiv-cs-ai","huggingface-blog","simonwillison","github-agents","github-rag","hf-daily-papers","yt-llm"],"recallPoolSize":20,"recallIncluded":11,"telegram":"disabled","pushedDelivered":0}
{"at":1788649483037,"candidates":0,"pushed":0,"collected":48,"relevant":0,"skippedSources":[],"feedbackCount":5,"sourceYield":{"hn-frontpage":{"fetched":15,"afterDedupe":12,"afterFilter":0},"github-new-llm-tools":{"fetched":15,"afterDedupe":8,"afterFilter":0},"exa-llm-news":{"fetched":8,"afterDedupe":0,"afterFilter":0},"exa-agent-releases":{"fetched":8,"afterDedupe":6,"afterFilter":0},"openai-news":{"fetched":1,"afterDedupe":0,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":0,"afterFilter":0}},"zeroYieldSources":["hn-frontpage","github-new-llm-tools","exa-agent-releases"],"emptyYieldSources":[],"candidateP50":0,"candidateP90":0,"candidateTop1":0,"rawP50":0,"rawP90":0,"rawTop1":0,"pushedMean":0,"saturationRate":0,"isNewRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{},"enabledSourceIds":["hn-frontpage","github-new-llm-tools","exa-llm-news","exa-agent-releases","openai-news","anthropic-research"],"recallPoolSize":13,"recallIncluded":0,"telegram":"disabled","pushedDelivered":0}
{"at":1788678003701,"candidates":5,"pushed":5,"collected":915,"relevant":5,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":0,"afterDedupe":0,"afterFilter":0},"huggingface-blog":{"fetched":859,"afterDedupe":2,"afterFilter":0},"simonwillison":{"fetched":30,"afterDedupe":14,"afterFilter":2},"github-agents":{"fetched":10,"afterDedupe":1,"afterFilter":1},"github-rag":{"fetched":10,"afterDedupe":2,"afterFilter":2},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":1,"afterFilter":0}},"zeroYieldSources":["huggingface-blog","yt-llm"],"emptyYieldSources":["arxiv-cs-ai"],"candidateP50":0.225,"candidateP90":0.445,"candidateTop1":0.445,"rawP50":0.25,"rawP90":0.556,"rawTop1":0.556,"pushedMean":0.292,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{"simonwillison":2,"github-rag":2,"github-agents":1},"enabledSourceIds":["arxiv-cs-ai","huggingface-blog","simonwillison","github-agents","github-rag","hf-daily-papers","yt-llm"],"recallPoolSize":10,"recallIncluded":2,"stalePrescreened":833,"stalePrescreenedBySource":{"huggingface-blog":833},"telegram":"disabled","pushedDelivered":0}
{"at":1788679086638,"candidates":1,"pushed":0,"collected":48,"relevant":1,"skippedSources":[],"feedbackCount":5,"sourceYield":{"hn-frontpage":{"fetched":15,"afterDedupe":13,"afterFilter":1},"github-new-llm-tools":{"fetched":15,"afterDedupe":1,"afterFilter":0},"exa-llm-news":{"fetched":8,"afterDedupe":0,"afterFilter":0},"exa-agent-releases":{"fetched":8,"afterDedupe":2,"afterFilter":0},"openai-news":{"fetched":1,"afterDedupe":0,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":0,"afterFilter":0}},"zeroYieldSources":["github-new-llm-tools","exa-agent-releases"],"emptyYieldSources":[],"candidateP50":0.225,"candidateP90":0.225,"candidateTop1":0.225,"rawP50":0.25,"rawP90":0.25,"rawTop1":0.25,"pushedMean":0,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{},"enabledSourceIds":["hn-frontpage","github-new-llm-tools","exa-llm-news","exa-agent-releases","openai-news","anthropic-research"],"recallPoolSize":13,"recallIncluded":0,"stalePrescreened":20,"stalePrescreenedBySource":{"github-new-llm-tools":13,"exa-llm-news":4,"exa-agent-releases":3},"telegram":"disabled","pushedDelivered":0}
{"at":1788696366669,"candidates":3,"pushed":2,"collected":915,"relevant":3,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":0,"afterDedupe":0,"afterFilter":0},"huggingface-blog":{"fetched":859,"afterDedupe":2,"afterFilter":2},"simonwillison":{"fetched":30,"afterDedupe":12,"afterFilter":0},"github-agents":{"fetched":10,"afterDedupe":0,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":0,"afterFilter":0},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":1,"afterFilter":1}},"zeroYieldSources":["simonwillison"],"emptyYieldSources":["arxiv-cs-ai"],"candidateP50":0.25,"candidateP90":0.25,"candidateTop1":0.25,"rawP50":0.25,"rawP90":0.25,"rawTop1":0.25,"pushedMean":0.25,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{"huggingface-blog":2},"enabledSourceIds":["arxiv-cs-ai","huggingface-blog","simonwillison","github-agents","github-rag","hf-daily-papers","yt-llm"],"recallPoolSize":9,"recallIncluded":2,"stalePrescreened":833,"stalePrescreenedBySource":{"huggingface-blog":833},"telegram":"disabled","pushedDelivered":0}
{"at":1788697512276,"candidates":3,"pushed":3,"collected":45,"relevant":3,"skippedSources":[],"feedbackCount":5,"sourceYield":{"hn-frontpage":{"fetched":12,"afterDedupe":9,"afterFilter":1},"github-new-llm-tools":{"fetched":15,"afterDedupe":1,"afterFilter":1},"exa-llm-news":{"fetched":8,"afterDedupe":0,"afterFilter":0},"exa-agent-releases":{"fetched":8,"afterDedupe":4,"afterFilter":1},"openai-news":{"fetched":1,"afterDedupe":0,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":0,"afterFilter":0}},"zeroYieldSources":[],"emptyYieldSources":[],"candidateP50":0.317,"candidateP90":0.427,"candidateTop1":0.427,"rawP50":0.352,"rawP90":0.427,"rawTop1":0.427,"pushedMean":0.323,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{"github-new-llm-tools":1,"exa-agent-releases":1,"hn-frontpage":1},"enabledSourceIds":["hn-frontpage","github-new-llm-tools","exa-llm-news","exa-agent-releases","openai-news","anthropic-research"],"recallPoolSize":11,"recallIncluded":3,"stalePrescreened":21,"stalePrescreenedBySource":{"hn-frontpage":2,"github-new-llm-tools":13,"exa-llm-news":4,"exa-agent-releases":2},"telegram":"disabled","pushedDelivered":0}
{"at":1788700239345,"candidates":1,"pushed":1,"collected":915,"relevant":1,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":0,"afterDedupe":0,"afterFilter":0},"huggingface-blog":{"fetched":859,"afterDedupe":0,"afterFilter":0},"simonwillison":{"fetched":30,"afterDedupe":12,"afterFilter":0},"github-agents":{"fetched":10,"afterDedupe":0,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":1,"afterFilter":1},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":1,"afterFilter":0}},"zeroYieldSources":["simonwillison","yt-llm"],"emptyYieldSources":["arxiv-cs-ai"],"candidateP50":0.4,"candidateP90":0.4,"candidateTop1":0.4,"rawP50":0.5,"rawP90":0.5,"rawTop1":0.5,"pushedMean":0.4,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{"github-rag":1},"enabledSourceIds":["arxiv-cs-ai","huggingface-blog","simonwillison","github-agents","github-rag","hf-daily-papers","yt-llm"],"recallPoolSize":7,"recallIncluded":0,"stalePrescreened":833,"stalePrescreenedBySource":{"huggingface-blog":833},"telegram":"disabled","pushedDelivered":0}
{"at":1788700937071,"candidates":0,"pushed":0,"collected":45,"relevant":0,"skippedSources":[],"feedbackCount":5,"sourceYield":{"hn-frontpage":{"fetched":12,"afterDedupe":8,"afterFilter":0},"github-new-llm-tools":{"fetched":15,"afterDedupe":0,"afterFilter":0},"exa-llm-news":{"fetched":8,"afterDedupe":0,"afterFilter":0},"exa-agent-releases":{"fetched":8,"afterDedupe":3,"afterFilter":0},"openai-news":{"fetched":1,"afterDedupe":0,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":0,"afterFilter":0}},"zeroYieldSources":["hn-frontpage","exa-agent-releases"],"emptyYieldSources":[],"candidateP50":0,"candidateP90":0,"candidateTop1":0,"rawP50":0,"rawP90":0,"rawTop1":0,"pushedMean":0,"saturationRate":0,"isNewRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{},"enabledSourceIds":["hn-frontpage","github-new-llm-tools","exa-llm-news","exa-agent-releases","openai-news","anthropic-research"],"recallPoolSize":8,"recallIncluded":0,"stalePrescreened":21,"stalePrescreenedBySource":{"hn-frontpage":2,"github-new-llm-tools":13,"exa-llm-news":4,"exa-agent-releases":2},"telegram":"disabled","pushedDelivered":0}
{"at":1788701111765,"candidates":0,"pushed":0,"collected":915,"relevant":0,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":0,"afterDedupe":0,"afterFilter":0},"huggingface-blog":{"fetched":859,"afterDedupe":0,"afterFilter":0},"simonwillison":{"fetched":30,"afterDedupe":12,"afterFilter":0},"github-agents":{"fetched":10,"afterDedupe":0,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":0,"afterFilter":0},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":2,"afterFilter":0}},"zeroYieldSources":["simonwillison","yt-llm"],"emptyYieldSources":["arxiv-cs-ai"],"candidateP50":0,"candidateP90":0,"candidateTop1":0,"rawP50":0,"rawP90":0,"rawTop1":0,"pushedMean":0,"saturationRate":0,"isNewRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{},"enabledSourceIds":["arxiv-cs-ai","huggingface-blog","simonwillison","github-agents","github-rag","hf-daily-papers","yt-llm"],"recallPoolSize":7,"recallIncluded":0,"stalePrescreened":833,"stalePrescreenedBySource":{"huggingface-blog":833},"telegram":"disabled","pushedDelivered":0}
{"at":1788701394477,"candidates":1,"pushed":1,"collected":45,"relevant":1,"skippedSources":[],"feedbackCount":5,"sourceYield":{"hn-frontpage":{"fetched":12,"afterDedupe":8,"afterFilter":0},"github-new-llm-tools":{"fetched":15,"afterDedupe":0,"afterFilter":0},"exa-llm-news":{"fetched":8,"afterDedupe":1,"afterFilter":1},"exa-agent-releases":{"fetched":8,"afterDedupe":3,"afterFilter":0},"openai-news":{"fetched":1,"afterDedupe":0,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":0,"afterFilter":0}},"zeroYieldSources":["hn-frontpage","exa-agent-releases"],"emptyYieldSources":[],"candidateP50":0.387,"candidateP90":0.387,"candidateTop1":0.387,"rawP50":0.352,"rawP90":0.352,"rawTop1":0.352,"pushedMean":0.387,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{"exa-llm-news":1},"enabledSourceIds":["hn-frontpage","github-new-llm-tools","exa-llm-news","exa-agent-releases","openai-news","anthropic-research"],"recallPoolSize":8,"recallIncluded":0,"stalePrescreened":20,"stalePrescreenedBySource":{"hn-frontpage":2,"github-new-llm-tools":13,"exa-llm-news":3,"exa-agent-releases":2},"telegram":"disabled","pushedDelivered":0}
{"at":1788720391701,"candidates":85,"pushed":60,"collected":272,"relevant":85,"skippedSources":[],"feedbackCount":5,"sourceYield":{"hn-frontpage":{"fetched":20,"afterDedupe":19,"afterFilter":4},"hn-search-llm":{"fetched":0,"afterDedupe":0,"afterFilter":0},"hn-search-ai":{"fetched":0,"afterDedupe":0,"afterFilter":0},"github-new-llm-tools":{"fetched":30,"afterDedupe":4,"afterFilter":4},"github-llm-inference":{"fetched":20,"afterDedupe":14,"afterFilter":14},"github-finetuning":{"fetched":20,"afterDedupe":8,"afterFilter":5},"github-mcp-tools":{"fetched":20,"afterDedupe":4,"afterFilter":3},"exa-llm-news":{"fetched":11,"afterDedupe":2,"afterFilter":2},"exa-agent-releases":{"fetched":13,"afterDedupe":6,"afterFilter":1},"exa-model-launches":{"fetched":23,"afterDedupe":12,"afterFilter":12},"exa-ai-industry":{"fetched":18,"afterDedupe":8,"afterFilter":8},"openai-news":{"fetched":1,"afterDedupe":0,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":0,"afterFilter":0},"exa-ondevice-ai":{"fetched":13,"afterDedupe":8,"afterFilter":8},"github-local-llm":{"fetched":20,"afterDedupe":4,"afterFilter":4},"exa-benchmark-sota":{"fetched":12,"afterDedupe":7,"afterFilter":7},"exa-open-weights":{"fetched":20,"afterDedupe":11,"afterFilter":10},"github-inference-engines":{"fetched":15,"afterDedupe":0,"afterFilter":0},"exa-ai-hardware":{"fetched":15,"afterDedupe":4,"afterFilter":3}},"zeroYieldSources":[],"emptyYieldSources":["hn-search-llm","hn-search-ai"],"candidateP50":0.427,"candidateP90":0.543,"candidateTop1":0.709,"rawP50":0.427,"rawP90":0.604,"rawTop1":0.78,"pushedMean":0.417,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"arxiv-cs-cl":0.5,"arxiv-cs-lg":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"hn-search-llm":0.4,"hn-search-ai":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-llm-inference":0.4,"github-finetuning":0.4,"github-mcp-tools":0.4,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-model-launches":0.4,"exa-ai-industry":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3,"exa-ondevice-ai":0.4,"github-local-llm":0.4,"exa-benchmark-sota":0.4,"exa-open-weights":0.4,"github-inference-engines":0.4,"exa-ai-hardware":0.4},"bySource":{"exa-open-weights":8,"exa-ai-industry":7,"exa-benchmark-sota":6,"exa-model-launches":11,"exa-ondevice-ai":7,"github-local-llm":3,"github-llm-inference":7,"exa-agent-releases":1,"github-finetuning":5,"github-mcp-tools":2,"github-new-llm-tools":3},"enabledSourceIds":["hn-frontpage","hn-search-llm","hn-search-ai","github-new-llm-tools","github-llm-inference","github-finetuning","github-mcp-tools","exa-llm-news","exa-agent-releases","exa-model-launches","exa-ai-industry","openai-news","anthropic-research","exa-ondevice-ai","github-local-llm","exa-benchmark-sota","exa-open-weights","github-inference-engines","exa-ai-hardware"],"recallPoolSize":20,"recallIncluded":11,"stalePrescreened":130,"stalePrescreenedBySource":{"github-new-llm-tools":25,"github-llm-inference":6,"github-finetuning":12,"github-mcp-tools":15,"exa-llm-news":7,"exa-agent-releases":4,"exa-model-launches":10,"exa-ai-industry":6,"exa-ondevice-ai":5,"github-local-llm":14,"exa-benchmark-sota":2,"exa-open-weights":8,"github-inference-engines":5,"exa-ai-hardware":11},"telegram":"disabled","pushedDelivered":0}
{"at":1788730609021,"candidates":399,"pushed":120,"collected":2115,"relevant":399,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":400,"afterDedupe":400,"afterFilter":203},"arxiv-cs-cl":{"fetched":400,"afterDedupe":302,"afterFilter":152},"arxiv-cs-lg":{"fetched":400,"afterDedupe":253,"afterFilter":41},"huggingface-blog":{"fetched":859,"afterDedupe":0,"afterFilter":0},"simonwillison":{"fetched":30,"afterDedupe":14,"afterFilter":0},"github-agents":{"fetched":10,"afterDedupe":0,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":5,"afterFilter":3},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":1,"afterFilter":0}},"zeroYieldSources":["simonwillison","yt-llm"],"emptyYieldSources":[],"candidateP50":0.5,"candidateP90":0.644,"candidateTop1":0.79,"rawP50":0.5,"rawP90":0.658,"rawTop1":0.79,"pushedMean":0.596,"saturationRate":0,"isNewRate":0.855,"weights":{"arxiv-cs-ai":0.5,"arxiv-cs-cl":0.5,"arxiv-cs-lg":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"hn-search-llm":0.4,"hn-search-ai":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-llm-inference":0.4,"github-finetuning":0.4,"github-mcp-tools":0.4,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-model-launches":0.4,"exa-ai-industry":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3,"exa-ondevice-ai":0.4,"github-local-llm":0.4,"exa-benchmark-sota":0.4,"exa-open-weights":0.4,"github-inference-engines":0.4,"exa-ai-hardware":0.4},"bySource":{"arxiv-cs-ai":47,"arxiv-cs-cl":67,"arxiv-cs-lg":6},"enabledSourceIds":["arxiv-cs-ai","arxiv-cs-cl","arxiv-cs-lg","huggingface-blog","simonwillison","github-agents","github-rag","hf-daily-papers","yt-llm"],"recallPoolSize":20,"recallIncluded":19,"stalePrescreened":833,"stalePrescreenedBySource":{"huggingface-blog":833},"telegram":"disabled","pushedDelivered":0}
{"at":1788735968134,"candidates":18,"pushed":18,"collected":2115,"relevant":18,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":400,"afterDedupe":197,"afterFilter":18},"arxiv-cs-cl":{"fetched":400,"afterDedupe":150,"afterFilter":0},"arxiv-cs-lg":{"fetched":400,"afterDedupe":212,"afterFilter":0},"huggingface-blog":{"fetched":859,"afterDedupe":0,"afterFilter":0},"simonwillison":{"fetched":30,"afterDedupe":14,"afterFilter":0},"github-agents":{"fetched":10,"afterDedupe":0,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":2,"afterFilter":0},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":1,"afterFilter":0}},"zeroYieldSources":["arxiv-cs-cl","arxiv-cs-lg","simonwillison","github-rag","yt-llm"],"emptyYieldSources":[],"candidateP50":0.427,"candidateP90":0.602,"candidateTop1":0.644,"rawP50":0.427,"rawP90":0.602,"rawTop1":0.644,"pushedMean":0.452,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"arxiv-cs-cl":0.5,"arxiv-cs-lg":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"hn-search-llm":0.4,"hn-search-ai":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-llm-inference":0.4,"github-finetuning":0.4,"github-mcp-tools":0.4,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-model-launches":0.4,"exa-ai-industry":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3,"exa-ondevice-ai":0.4,"github-local-llm":0.4,"exa-benchmark-sota":0.4,"exa-open-weights":0.4,"github-inference-engines":0.4,"exa-ai-hardware":0.4},"bySource":{"arxiv-cs-ai":18},"enabledSourceIds":["arxiv-cs-ai","arxiv-cs-cl","arxiv-cs-lg","huggingface-blog","simonwillison","github-agents","github-rag","hf-daily-papers","yt-llm"],"recallPoolSize":20,"recallIncluded":18,"stalePrescreened":833,"stalePrescreenedBySource":{"huggingface-blog":833},"telegram":"disabled","pushedDelivered":0}
{"at":1788735968134,"candidates":18,"pushed":0,"collected":2115,"relevant":18,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":400,"afterDedupe":197,"afterFilter":18},"arxiv-cs-cl":{"fetched":400,"afterDedupe":150,"afterFilter":0},"arxiv-cs-lg":{"fetched":400,"afterDedupe":212,"afterFilter":0},"huggingface-blog":{"fetched":859,"afterDedupe":0,"afterFilter":0},"simonwillison":{"fetched":30,"afterDedupe":14,"afterFilter":0},"github-agents":{"fetched":10,"afterDedupe":0,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":2,"afterFilter":0},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":1,"afterFilter":0}},"zeroYieldSources":["arxiv-cs-cl","arxiv-cs-lg","simonwillison","github-rag","yt-llm"],"emptyYieldSources":[],"candidateP50":0.427,"candidateP90":0.602,"candidateTop1":0.644,"rawP50":0.427,"rawP90":0.602,"rawTop1":0.644,"pushedMean":0,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"arxiv-cs-cl":0.5,"arxiv-cs-lg":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"hn-search-llm":0.4,"hn-search-ai":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-llm-inference":0.4,"github-finetuning":0.4,"github-mcp-tools":0.4,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-model-launches":0.4,"exa-ai-industry":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3,"exa-ondevice-ai":0.4,"github-local-llm":0.4,"exa-benchmark-sota":0.4,"exa-open-weights":0.4,"github-inference-engines":0.4,"exa-ai-hardware":0.4},"bySource":{},"enabledSourceIds":["arxiv-cs-ai","arxiv-cs-cl","arxiv-cs-lg","huggingface-blog","simonwillison","github-agents","github-rag","hf-daily-papers","yt-llm"],"recallPoolSize":20,"recallIncluded":18,"stalePrescreened":833,"stalePrescreenedBySource":{"huggingface-blog":833},"telegram":"disabled","pushedDelivered":0}
{"at":1788710885770,"candidates":163,"pushed":120,"collected":1365,"relevant":163,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":150,"afterDedupe":150,"afterFilter":85},"arxiv-cs-cl":{"fetched":150,"afterDedupe":118,"afterFilter":64},"arxiv-cs-lg":{"fetched":150,"afterDedupe":100,"afterFilter":12},"huggingface-blog":{"fetched":859,"afterDedupe":0,"afterFilter":0},"simonwillison":{"fetched":30,"afterDedupe":13,"afterFilter":0},"github-agents":{"fetched":10,"afterDedupe":0,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":4,"afterFilter":2},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":1,"afterFilter":0}},"zeroYieldSources":["simonwillison","yt-llm"],"emptyYieldSources":[],"candidateP50":0.427,"candidateP90":0.602,"candidateTop1":0.79,"rawP50":0.5,"rawP90":0.658,"rawTop1":0.79,"pushedMean":0.469,"saturationRate":0,"isNewRate":0.681,"weights":{"arxiv-cs-ai":0.5,"arxiv-cs-cl":0.5,"arxiv-cs-lg":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"hn-search-llm":0.4,"hn-search-ai":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-llm-inference":0.4,"github-finetuning":0.4,"github-mcp-tools":0.4,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-model-launches":0.4,"exa-ai-industry":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3},"bySource":{"arxiv-cs-cl":48,"arxiv-cs-lg":11,"arxiv-cs-ai":61},"enabledSourceIds":["arxiv-cs-ai","arxiv-cs-cl","arxiv-cs-lg","huggingface-blog","simonwillison","github-agents","github-rag","hf-daily-papers","yt-llm"],"recallPoolSize":20,"recallIncluded":19,"stalePrescreened":833,"stalePrescreenedBySource":{"huggingface-blog":833},"telegram":"disabled","pushedDelivered":0}
{"at":1788736843275,"candidates":17,"pushed":12,"collected":2115,"relevant":17,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":400,"afterDedupe":179,"afterFilter":9},"arxiv-cs-cl":{"fetched":400,"afterDedupe":148,"afterFilter":8},"arxiv-cs-lg":{"fetched":400,"afterDedupe":212,"afterFilter":0},"huggingface-blog":{"fetched":859,"afterDedupe":0,"afterFilter":0},"simonwillison":{"fetched":30,"afterDedupe":14,"afterFilter":0},"github-agents":{"fetched":10,"afterDedupe":0,"afterFilter":0},"github-rag":{"fetched":10,"afterDedupe":2,"afterFilter":0},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":1,"afterFilter":0}},"zeroYieldSources":["arxiv-cs-lg","simonwillison","github-rag","yt-llm"],"emptyYieldSources":[],"candidateP50":0.5,"candidateP90":0.602,"candidateTop1":0.644,"rawP50":0.5,"rawP90":0.602,"rawTop1":0.644,"pushedMean":0.439,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"arxiv-cs-cl":0.5,"arxiv-cs-lg":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"hn-search-llm":0.4,"hn-search-ai":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-llm-inference":0.4,"github-finetuning":0.4,"github-mcp-tools":0.4,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-model-launches":0.4,"exa-ai-industry":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3,"exa-ondevice-ai":0.4,"github-local-llm":0.4,"exa-benchmark-sota":0.4,"exa-open-weights":0.4,"github-inference-engines":0.4,"exa-ai-hardware":0.4,"twitter-feed":0.9,"anysearch-local-llm":0.7,"anysearch-agent-bench":0.7},"bySource":{"arxiv-cs-cl":6,"arxiv-cs-ai":6},"enabledSourceIds":["arxiv-cs-ai","arxiv-cs-cl","arxiv-cs-lg","huggingface-blog","simonwillison","github-agents","github-rag","hf-daily-papers","yt-llm"],"recallPoolSize":20,"recallIncluded":17,"stalePrescreened":833,"stalePrescreenedBySource":{"huggingface-blog":833},"telegram":"disabled","pushedDelivered":0}
{"at":1788738063380,"candidates":12,"pushed":7,"collected":274,"relevant":12,"skippedSources":[],"feedbackCount":5,"sourceYield":{"hn-frontpage":{"fetched":20,"afterDedupe":13,"afterFilter":0},"hn-search-llm":{"fetched":0,"afterDedupe":0,"afterFilter":0},"hn-search-ai":{"fetched":0,"afterDedupe":0,"afterFilter":0},"github-new-llm-tools":{"fetched":30,"afterDedupe":0,"afterFilter":0},"github-llm-inference":{"fetched":20,"afterDedupe":0,"afterFilter":0},"github-finetuning":{"fetched":20,"afterDedupe":2,"afterFilter":1},"github-mcp-tools":{"fetched":20,"afterDedupe":0,"afterFilter":0},"exa-llm-news":{"fetched":11,"afterDedupe":0,"afterFilter":0},"exa-agent-releases":{"fetched":12,"afterDedupe":5,"afterFilter":0},"exa-model-launches":{"fetched":23,"afterDedupe":1,"afterFilter":1},"exa-ai-industry":{"fetched":20,"afterDedupe":4,"afterFilter":4},"openai-news":{"fetched":1,"afterDedupe":0,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":0,"afterFilter":0},"exa-ondevice-ai":{"fetched":13,"afterDedupe":2,"afterFilter":2},"github-local-llm":{"fetched":20,"afterDedupe":0,"afterFilter":0},"exa-benchmark-sota":{"fetched":12,"afterDedupe":0,"afterFilter":0},"exa-open-weights":{"fetched":20,"afterDedupe":1,"afterFilter":1},"github-inference-engines":{"fetched":15,"afterDedupe":0,"afterFilter":0},"exa-ai-hardware":{"fetched":16,"afterDedupe":3,"afterFilter":3}},"zeroYieldSources":["hn-frontpage","exa-agent-releases"],"emptyYieldSources":["hn-search-llm","hn-search-ai"],"candidateP50":0.384,"candidateP90":0.476,"candidateTop1":0.542,"rawP50":0.427,"rawP90":0.529,"rawTop1":0.602,"pushedMean":0.353,"saturationRate":0,"isNewRate":0.917,"weights":{"arxiv-cs-ai":0.5,"arxiv-cs-cl":0.5,"arxiv-cs-lg":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"hn-search-llm":0.4,"hn-search-ai":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-llm-inference":0.4,"github-finetuning":0.4,"github-mcp-tools":0.4,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-model-launches":0.4,"exa-ai-industry":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3,"exa-ondevice-ai":0.4,"github-local-llm":0.4,"exa-benchmark-sota":0.4,"exa-open-weights":0.4,"github-inference-engines":0.4,"exa-ai-hardware":0.4,"twitter-feed":0.9,"anysearch-local-llm":0.7,"anysearch-agent-bench":0.7},"bySource":{"exa-ai-hardware":2,"exa-ondevice-ai":2,"exa-ai-industry":2,"exa-model-launches":1},"enabledSourceIds":["hn-frontpage","hn-search-llm","hn-search-ai","github-new-llm-tools","github-llm-inference","github-finetuning","github-mcp-tools","exa-llm-news","exa-agent-releases","exa-model-launches","exa-ai-industry","openai-news","anthropic-research","exa-ondevice-ai","github-local-llm","exa-benchmark-sota","exa-open-weights","github-inference-engines","exa-ai-hardware"],"recallPoolSize":15,"recallIncluded":2,"stalePrescreened":143,"stalePrescreenedBySource":{"hn-frontpage":5,"github-new-llm-tools":25,"github-llm-inference":7,"github-finetuning":13,"github-mcp-tools":16,"exa-llm-news":8,"exa-agent-releases":3,"exa-model-launches":12,"exa-ai-industry":8,"exa-ondevice-ai":6,"github-local-llm":14,"exa-benchmark-sota":3,"exa-open-weights":8,"github-inference-engines":5,"exa-ai-hardware":10},"telegram":"disabled","pushedDelivered":0}
{"at":1788786295428,"candidates":171,"pushed":10,"collected":2131,"relevant":171,"skippedSources":[],"feedbackCount":5,"sourceYield":{"arxiv-cs-ai":{"fetched":400,"afterDedupe":299,"afterFilter":115},"arxiv-cs-cl":{"fetched":400,"afterDedupe":167,"afterFilter":28},"arxiv-cs-lg":{"fetched":400,"afterDedupe":240,"afterFilter":16},"huggingface-blog":{"fetched":859,"afterDedupe":0,"afterFilter":0},"simonwillison":{"fetched":30,"afterDedupe":15,"afterFilter":1},"github-agents":{"fetched":10,"afterDedupe":1,"afterFilter":1},"github-rag":{"fetched":10,"afterDedupe":3,"afterFilter":1},"hf-daily-papers":{"fetched":1,"afterDedupe":0,"afterFilter":0},"yt-llm":{"fetched":5,"afterDedupe":1,"afterFilter":0},"anysearch-local-llm":{"fetched":8,"afterDedupe":8,"afterFilter":6},"anysearch-agent-bench":{"fetched":8,"afterDedupe":8,"afterFilter":3}},"zeroYieldSources":["yt-llm"],"emptyYieldSources":[],"candidateP50":0.5,"candidateP90":0.658,"candidateTop1":0.82,"rawP50":0.5,"rawP90":0.658,"rawTop1":0.82,"pushedMean":0.521,"saturationRate":0,"isNewRate":0.942,"weights":{"arxiv-cs-ai":0.5,"arxiv-cs-cl":0.5,"arxiv-cs-lg":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"hn-search-llm":0.4,"hn-search-ai":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-llm-inference":0.4,"github-finetuning":0.4,"github-mcp-tools":0.4,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-model-launches":0.4,"exa-ai-industry":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3,"exa-ondevice-ai":0.4,"github-local-llm":0.4,"exa-benchmark-sota":0.4,"exa-open-weights":0.4,"github-inference-engines":0.4,"exa-ai-hardware":0.4,"twitter-feed":0.9,"anysearch-local-llm":0.7,"anysearch-agent-bench":0.7},"bySource":{"arxiv-cs-ai":8,"arxiv-cs-cl":2},"enabledSourceIds":["arxiv-cs-ai","arxiv-cs-cl","arxiv-cs-lg","huggingface-blog","simonwillison","github-agents","github-rag","hf-daily-papers","yt-llm","anysearch-local-llm","anysearch-agent-bench"],"recallPoolSize":20,"recallIncluded":16,"stalePrescreened":833,"stalePrescreenedBySource":{"huggingface-blog":833},"telegram":"disabled","pushedDelivered":0}
{"at":1788788503502,"candidates":40,"pushed":10,"collected":303,"relevant":40,"skippedSources":["hn-search-llm","hn-search-ai"],"feedbackCount":5,"sourceYield":{"hn-frontpage":{"fetched":20,"afterDedupe":20,"afterFilter":2},"github-new-llm-tools":{"fetched":30,"afterDedupe":1,"afterFilter":0},"github-llm-inference":{"fetched":20,"afterDedupe":1,"afterFilter":1},"github-finetuning":{"fetched":20,"afterDedupe":3,"afterFilter":1},"github-mcp-tools":{"fetched":20,"afterDedupe":1,"afterFilter":0},"exa-llm-news":{"fetched":13,"afterDedupe":6,"afterFilter":6},"exa-agent-releases":{"fetched":12,"afterDedupe":6,"afterFilter":1},"exa-model-launches":{"fetched":22,"afterDedupe":2,"afterFilter":2},"exa-ai-industry":{"fetched":16,"afterDedupe":6,"afterFilter":6},"openai-news":{"fetched":1,"afterDedupe":0,"afterFilter":0},"anthropic-research":{"fetched":1,"afterDedupe":0,"afterFilter":0},"exa-ondevice-ai":{"fetched":15,"afterDedupe":6,"afterFilter":5},"github-local-llm":{"fetched":20,"afterDedupe":1,"afterFilter":0},"exa-benchmark-sota":{"fetched":14,"afterDedupe":4,"afterFilter":4},"exa-open-weights":{"fetched":20,"afterDedupe":4,"afterFilter":4},"github-inference-engines":{"fetched":15,"afterDedupe":0,"afterFilter":0},"exa-ai-hardware":{"fetched":14,"afterDedupe":3,"afterFilter":3},"twitter-feed":{"fetched":30,"afterDedupe":30,"afterFilter":5}},"zeroYieldSources":["github-new-llm-tools","github-mcp-tools","github-local-llm"],"emptyYieldSources":[],"candidateP50":0.384,"candidateP90":0.664,"candidateTop1":0.8,"rawP50":0.427,"rawP90":0.604,"rawTop1":0.748,"pushedMean":0.527,"saturationRate":0,"isNewRate":0.975,"weights":{"arxiv-cs-ai":0.5,"arxiv-cs-cl":0.5,"arxiv-cs-lg":0.5,"huggingface-blog":0.5,"hn-frontpage":0.4,"hn-search-llm":0.4,"hn-search-ai":0.4,"simonwillison":0.4,"jiqizhixin":0.3,"qbitai":0.3,"github-new-llm-tools":0.5,"github-llm-inference":0.4,"github-finetuning":0.4,"github-mcp-tools":0.4,"github-agents":0.4,"github-rag":0.3,"exa-llm-news":0.6,"exa-agent-releases":0.4,"exa-model-launches":0.4,"exa-ai-industry":0.4,"exa-cn-ai":0.3,"hf-daily-papers":0.6,"openai-news":0.4,"anthropic-research":0.4,"v2ex-hot":0.2,"bili-llm":0.2,"yt-llm":0.3,"exa-ondevice-ai":0.4,"github-local-llm":0.4,"exa-benchmark-sota":0.4,"exa-open-weights":0.4,"github-inference-engines":0.4,"exa-ai-hardware":0.4,"twitter-feed":0.9,"anysearch-local-llm":0.7,"anysearch-agent-bench":0.7},"bySource":{"exa-benchmark-sota":2,"exa-llm-news":2,"exa-model-launches":1,"exa-ai-industry":1,"twitter-feed":1,"exa-ai-hardware":2,"exa-ondevice-ai":1},"enabledSourceIds":["hn-frontpage","hn-search-llm","hn-search-ai","github-new-llm-tools","github-llm-inference","github-finetuning","github-mcp-tools","exa-llm-news","exa-agent-releases","exa-model-launches","exa-ai-industry","openai-news","anthropic-research","exa-ondevice-ai","github-local-llm","exa-benchmark-sota","exa-open-weights","github-inference-engines","exa-ai-hardware","twitter-feed"],"recallPoolSize":20,"recallIncluded":5,"stalePrescreened":127,"stalePrescreenedBySource":{"github-new-llm-tools":23,"github-llm-inference":6,"github-finetuning":13,"github-mcp-tools":16,"exa-llm-news":5,"exa-agent-releases":1,"exa-model-launches":14,"exa-ai-industry":5,"exa-ondevice-ai":7,"github-local-llm":13,"exa-benchmark-sota":6,"exa-open-weights":7,"github-inference-engines":3,"exa-ai-hardware":8},"telegram":"disabled","pushedDelivered":0}
```
