## 探针证据快照（gen-evidence.mjs 生成，非手抄）

```json
{
  "generatedAt": "2026-09-02T01:06:04.286Z",
  "rounds": 3,
  "lastRound": {
    "at": 1788310983181,
    "candidates": 3,
    "pushed": 3,
    "collected": 1676,
    "relevant": 341,
    "skippedSources": [
      "hf-daily-papers"
    ],
    "feedbackCount": 0,
    "candidateP50": 0.5,
    "candidateP90": 0.652,
    "candidateTop1": 0.652,
    "rawP50": 0.5,
    "rawTop1": 0.604,
    "pushedMean": 0.551,
    "saturationRate": 0,
    "isNewRate": 1,
    "weights": {
      "arxiv-cs-ai": 0.5,
      "huggingface-blog": 0.5,
      "github-new-llm-tools": 0.5,
      "exa-llm-news": 0.58,
      "hf-daily-papers": 0.58,
      "v2ex-hot": 0.26,
      "bili-llm": 0.26
    },
    "bySource": {
      "exa-llm-news": 1,
      "github-new-llm-tools": 2
    }
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
  "weights": {
    "arxiv-cs-ai": 0.5,
    "huggingface-blog": 0.5,
    "github-new-llm-tools": 0.5,
    "exa-llm-news": 0.58,
    "hf-daily-papers": 0.58,
    "v2ex-hot": 0.26,
    "bili-llm": 0.26
  },
  "weightsFeedbackHash": "4f53cda18c2b"
}
```

### observations.jsonl 全文

```jsonl
{"at":1788307589178,"candidates":647,"pushed":6,"candidateP50":0.602,"candidateP90":0.747,"candidateTop1":0.862,"pushedMean":0.759,"saturationRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"github-new-llm-tools":0.5,"exa-llm-news":0.6,"hf-daily-papers":0.6,"v2ex-hot":0.2,"bili-llm":0.2},"bySource":{"arxiv-cs-ai":3,"exa-llm-news":1,"huggingface-blog":2}}
{"at":1788307618871,"candidates":1,"pushed":1,"candidateP50":0.628,"candidateP90":0.628,"candidateTop1":0.628,"pushedMean":0.628,"saturationRate":0,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"github-new-llm-tools":0.5,"exa-llm-news":0.6,"hf-daily-papers":0.6,"v2ex-hot":0.2,"bili-llm":0.2},"bySource":{"exa-llm-news":1}}
{"at":1788310983181,"candidates":3,"pushed":3,"collected":1676,"relevant":341,"skippedSources":["hf-daily-papers"],"feedbackCount":0,"candidateP50":0.5,"candidateP90":0.652,"candidateTop1":0.652,"rawP50":0.5,"rawTop1":0.604,"pushedMean":0.551,"saturationRate":0,"isNewRate":1,"weights":{"arxiv-cs-ai":0.5,"huggingface-blog":0.5,"github-new-llm-tools":0.5,"exa-llm-news":0.58,"hf-daily-papers":0.58,"v2ex-hot":0.26,"bili-llm":0.26},"bySource":{"exa-llm-news":1,"github-new-llm-tools":2}}
```
