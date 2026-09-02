# 领域情报 · ai-llm · 2026-09-01 22:31

> digest: mtj8s2ec · 共 6 个趋势簇。有价值请 👍，噪音请 👎（Telegram 内点按钮，或向 feedback.json 追加记录）。

## 1. Call Neighbours Yourself: Graph Walks with Destination-Conditioned On-Policy Self-Distillation

arXiv:2608.29588v1 Announce Type: new 
Abstract: Reasoning over text-attributed graphs (TAGs) requires large language models (LLMs) to combine a node's text with evidence distributed across its neighbourhood. Existing methods fix the set of accessible neighbours before generation, forcing reasoning to operate over a static context and preventing the model from acquiring missing evidence during inference. We argue that neighbour selection should itself be part of the reasoning process. To this end, we propose Call Neighbours Yourself (CNY), a framework that enables LLMs to proactively explore graph neighbourhoods through topology-constrained graph-walk actions. Instead of reasoning over a pre-selected neighbour set, CNY exposes lightweight neighbour previews and learns when to expand candid

- 为什么值得看：关键词命中 4，信号词命中 2
- 来源 [arxiv-cs-ai](https://arxiv.org/abs/2608.29588) · 分 1.00 · 🆕增量

## 2. Towards a Systems Foundation for Agentic Skills: Architecture, Lifecycle, and Security

arXiv:2608.29596v1 Announce Type: new 
Abstract: Autonomous large language model (LLM) agents increasingly face reliability, context consumption, and execution stability bottlenecks when deployed on complex, long-horizon tasks. While monolithic prompt engineering and stateless tool-calling paradigms struggle to scale, the field is rapidly converging toward \emph{agentic skills}: modular procedural abstractions that externalize execution knowledge into reusable, executable, and portable artifacts. This paper establishes a unified systems foundation and reference architecture for the agentic skills ecosystem. We formalize skills as externalized procedural knowledge bridging high-level cognitive planning with deterministic execution environments, and systematically delineate the architecture 

- 为什么值得看：关键词命中 5，信号词命中 1
- 来源 [arxiv-cs-ai](https://arxiv.org/abs/2608.29596) · 分 1.00 · 🆕增量

## 3. FRAMEWORKERS: A Dynamic Multi-Agent Framework for AI-Generated Video Production

arXiv:2608.29814v1 Announce Type: new 
Abstract: Modern video generators excel at synthesizing individual clips, but complete video production requires coordinating a long sequence of interdependent creative steps, including scripting, storyboarding, generation, and editing. It further demands persistent asset management and dynamic task orchestration as intermediate outputs, dependencies, and execution states evolve over time. Existing automated systems typically rely on rigid pipelines that are difficult to adapt to diverse inputs and changing workflows, while general-purpose large language models (LLMs) remain unreliable for long-horizon orchestration and multimodal asset routing. We introduce FRAMEWORKERS, a task-centric and workspace-grounded multi-agent framework for open-ended video

- 为什么值得看：关键词命中 6，信号词命中 1
- 来源 [arxiv-cs-ai](https://arxiv.org/abs/2608.29814) · 分 1.00 · 🆕增量

## 4. AutoCRAT: Within-trajectory Joint Control of Stochasticity and Compute for LLM Reasoning

arXiv:2608.29988v1 Announce Type: new 
Abstract: Large language models (LLMs) achieve strong reasoning performance, which depends critically on inference-time decisions. Yet these decisions are commonly handled by static, one-size-fits-all policies, limiting adaptation to diverse tasks and reasoning stages. Recent adaptive methods partially address this limitation, but they primarily adapt either decoding stochasticity (how the model explores) or reasoning compute (how long the model reasons) in isolation, leaving their interaction within a single reasoning trajectory unmodeled. To address this challenge, we shift toward a within-trajectory joint control view, and instantiate it in AutoCRAT, a decoder-side controller for frozen backbones. Using only signals available during decoding, AutoC

- 为什么值得看：关键词命中 5，信号词命中 2
- 来源 [arxiv-cs-ai](https://arxiv.org/abs/2608.29988) · 分 1.00 · 🆕增量

## 5. Interpreting and Steering for Safe and Correct Code Generation

arXiv:2608.30025v1 Announce Type: new 
Abstract: Large language models (LLMs) frequently generate source code containing vulnerabilities, yet little work studies the internal mechanisms that distinguish safe from vulnerable generation in them. In this work, we systematically perform a mechanistic interpretation of LLMs, aiming at both understanding how code safety-vs-vulnerability is represented or driven by components in an LM and turning the insights into actionable steering strategies to encourage safer code generation. To this end, we introduce CodeSec-Pairs, a dataset of 9,342 Python safe-and-vulnerable contrastive code pairs, sampled from Llama-3.1-8B-Instruct. Utilizing the dataset, we explore approaches to localize layers and attention heads that relate to code safety, and further 

- 为什么值得看：关键词命中 5，信号词命中 1
- 来源 [arxiv-cs-ai](https://arxiv.org/abs/2608.30025) · 分 1.00 · 🆕增量

## 6. Generating Workflow DAGs from Natural Language with Non-Reasoning LLMs

arXiv:2608.30250v1 Announce Type: new 
Abstract: This paper addresses the problem of translating natural-language routing rules written by business administrators into executable workflow graphs for enterprise contact centers. Each target is a directed acyclic graph (DAG) of conditional actions with parallel branches, hit-first fallback chains, and per-branch Boolean predicates, encoded in the JSON dialect of a commercial routing platform. We show that neuro-symbolic decomposition enables lower-cost, non-reasoning large language models to generate complex workflow DAGs at production-relevant quality without expensive extended-reasoning models. Our central diagnostic is an emission-density bottleneck: on a 635-rule benchmark of manufactured synthetic data, models select the correct graph no

- 为什么值得看：关键词命中 4，信号词命中 1
- 来源 [arxiv-cs-ai](https://arxiv.org/abs/2608.30250) · 分 1.00 · 🆕增量
