# 领域情报 · ai-llm · 2026-09-01 22:21

> digest: mtj8elt8 · 共 6 个趋势簇。有价值请 👍，噪音请 👎（Telegram 内点按钮，或向 feedback.json 追加记录）。

## 1. A collective capability boundary in frontier large language models on guideline-conformant and case-specific oncology decision-making

arXiv:2608.28592v1 Announce Type: new 
Abstract: Large language models (LLMs) achieve high scores on medical knowledge examinations, yet real-world oncology is not a knowledge test--it is a sequence of guideline-pathway choices, escalation judgments, and commitments under uncertainty. Existing benchmarks largely measure factual recall, leaving open whether frontier LLMs share decision-path blind spots that combining models cannot fix. We built the Oncology Decision Boundary Benchmark (ODBB)--2,005 oncology decision points across NCCN guidelines and colorectal cancer cases--and evaluated nine frontier LLMs (four closed-source, five open-weight families) released between June 2025 and April 2026. A fully deterministic scorer (zero LLM inference) classified outputs into 14 failure types, inde

- 为什么值得看：关键词命中 4，信号词命中 2
- 来源 [arxiv-cs-ai](https://arxiv.org/abs/2608.28592) · 分 1.00 · 🆕增量

## 2. Paper Pilot: A Human-in-the-Loop Expert System for Evidence-Traceable Scientific Manuscript Generation in Applied Sciences

arXiv:2608.28596v1 Announce Type: new 
Abstract: Large language model (LLM) agents are increasingly embedded in scientific workflows for literature analysis, drafting, and review. Existing systems advance autonomous discovery and manuscript generation, but do not resolve the governance problem that arises when ideas, methods, results, and claims propagate through AI-assisted workflows without mandatory human approval or artifact-level traceability. This paper proposes Paper Pilot, a human-in-the-loop expert system for evidence-traceable scientific manuscript generation in applied sciences. It adapts the Collaborative Agent Reasoning Engineering (CARE) methodology to manuscript development through manuscript-owner approval gates, explicit no-pass criteria, claim classification, audit loggin

- 为什么值得看：关键词命中 4，信号词命中 2
- 来源 [arxiv-cs-ai](https://arxiv.org/abs/2608.28596) · 分 1.00 · 🆕增量

## 3. BiasMix-Finance: Post-Generation KYC Guardrails for LLM Portfolio Advice

arXiv:2608.28646v1 Announce Type: new 
Abstract: Large language models (LLMs) can generate plausible-sounding ETF portfolios while silently violating basic KYC-style constraints on risk, fees, and diversification. This is especially problematic in agentic multi-turn advisory systems, where each draft recommendation can become an action unless guarded by an auditable enforcement layer. We study a model-agnostic, asset-agnostic post-generation guardrail pipeline: (i) enforce a strict JSON allocation schema, (ii) validate allocations against numeric caps, and (iii) when violations occur, deterministically project the output to the nearest feasible portfolio via a convex quadratic program (QCQP). We introduce BiasMix-Finance (Mini), a compact stress-test benchmark for constrained decision-maki

- 为什么值得看：关键词命中 4，信号词命中 2
- 来源 [arxiv-cs-ai](https://arxiv.org/abs/2608.28646) · 分 1.00 · 🆕增量

## 4. Beyond the Answer Key: Robustness Evaluation of Large Language Models for Step-Level Mathematical Verification

arXiv:2608.28725v1 Announce Type: new 
Abstract: Large language models (LLMs) are increasingly used as graders, verifiers, and process auditors, but most mathematical evaluations still emphasize final-answer accuracy. This can obscure whether a model can verify a non-canonical but valid solution trace. We introduce a controlled linear-equation benchmark for evaluating LLMs in the evaluator role. Each instance asks the model to judge final-answer correctness, step-level trace correctness, and the first incorrect step. Our evaluation of state-of-the-art open LLMs reveals a significant robustness gap: models that accurately evaluate canonical solutions often fail when presented with perturbed but logically equivalent variants. Across GPT-OSS 20B, Qwen3-14B, and Phi-4-Reasoning, base models pe

- 为什么值得看：关键词命中 4，信号词命中 1
- 来源 [arxiv-cs-ai](https://arxiv.org/abs/2608.28725) · 分 1.00 · 🆕增量

## 5. Pro-Router: Token-Aware Progressive Model Routing with Adaptive Edge-Cloud Collaboration for Efficient Multimodal LLM Inference

arXiv:2608.28726v1 Announce Type: new 
Abstract: The remarkable performance of multimodal large language models (MLLMs) comes at the cost of substantial computational overhead, posing significant challenges to real-time deployment and cost effectiveness. Existing model routing approaches either decide from coarse request-level features alone or spend one or several extra language model passes to inspect the generated response, leaving the token-level uncertainty signals that emerge during generation unused. To address these limitations, we propose Pro-Router, a token-aware progressive model routing method with adaptive edge-cloud collaboration for efficient multimodal LLM inference. Pro-Router employs a two-stage progressive decision mechanism. First, a lightweight prompt pre-scorer module

- 为什么值得看：关键词命中 5，信号词命中 1
- 来源 [arxiv-cs-ai](https://arxiv.org/abs/2608.28726) · 分 1.00 · 🆕增量

## 6. Capability-Stratified Degradation in Ternary Language Models

arXiv:2608.28809v1 Announce Type: new 
Abstract: Extreme low-bit inference offers a route toward smaller models and constrained deployment. Ternary language models restrict weights to $\{-1,0,+1\}$, approaching the limit of $\log_2 3 \approx 1.585$ bits/weight. The practical question for a pretrained model is not simply whether weights can be quantised but which capabilities survive and whether it remains useful for adaptation. We explore this by converting Qwen3.5-0.8B (752M parameters) to ternary weights using 72.4M tokens of quantisation-aware training (QAT). The resulting model, Cloe, is evaluated across 29 benchmarks, representation diagnostics, and downstream fine-tuning. The evidence shows non-uniform degradation. A linear probe recovers 43.76% of MMLU answers from the full-precisio

- 为什么值得看：关键词命中 4，信号词命中 1
- 来源 [arxiv-cs-ai](https://arxiv.org/abs/2608.28809) · 分 1.00 · 🆕增量
