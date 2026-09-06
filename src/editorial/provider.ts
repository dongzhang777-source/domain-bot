import type { FetchFn } from '../types.js'
import { defaultFetch } from '../collector/adapters/rss.js'

/**
 * OpenAI 兼容 provider + 自动降级链。
 *
 * 老张 2026-09-04 裁决：端点**不绑定**，做成配置项 + 自动降级链，不硬编码任何地址。
 * 起因是老张口述的 `http://192.168.100.1:8002/v1` + `deepseek-v4-flash` 经实测不存在
 * （`.1` 是本机雷雳桥地址且服务只 bind 127.0.0.1，8002 无服务，该模型名不在任何本地清单）。
 * 把地址写进代码就等于把一次口误固化成架构。
 * 订正（2026-09-05）：老张指令以 `~/start_ds4.sh` 启动 ds4-server 双机推理后，
 * `192.168.100.1:8002/v1` 已真实可用（model id = `deepseek-v4-flash`），并已配为 reviewer
 * 主端点（见 config/editor.json）。走配置不写死代码的裁决不变。
 *
 * 订正（2026-09-06，小巴接手后实测）：上述 ds4 端点已失效——07:47 实测 HTTP 502
 * （upstream connect failed，主机 ping 通说明是后端服务未起）。老张指令改用新设的
 * `127.0.0.1:8082/v1`（Qwen3.8-Flash-Next 双机方案）作 reviewer 主端点。
 * **这次故障正是「端点走配置」裁决的价值证明**：换底座只改了一个 JSON 字段，
 * 代码零改动；若当初把地址写死在代码里，此处就是一次代码修改 + 全量回归。
 *
 * 降级链的必要性（不是装饰）：本机 8052 是免费档云端转发（有限流与 OAuth 刷新依赖），
 * 8080 是本地 llama-server（与 Claude Code 共用 8082 代理会抢资源）。任一端点抖动都不该
 * 让整轮批产报废——writer 单轮 200 条约 53 分钟，从头重跑代价过高。
 */

export interface EndpointConfig {
  id: string
  /** 环境变量名（优先），不是地址本身 */
  baseUrlEnv?: string
  /** 环境变量未设时的默认地址 */
  baseUrlDefault?: string
  apiKeyEnv?: string
  modelEnv?: string
  modelDefault?: string
  timeoutMs: number
  /**
   * 逐端点透传的额外请求体字段（如 {"reasoning_effort":"low"}）。
   * 背景：思考型模型的 reasoning 会吃掉 max_tokens——ds4 的 DeepSeek-V4-Flash 实测
   * max_tokens=1500 时 70%+ 被 reasoning 消耗、批 10 条金标的 JSON 没写完就截断，
   * calibrate 漏答率高达 63.8%（金标自检硬闸正常拦下）。reasoning_effort:low
   * 实测让可见输出完整出 JSON（calibrate 由此可过）。
   */
  extraBody?: Record<string, unknown>
}

export interface ResolvedEndpoint {
  id: string
  baseUrl: string
  apiKey?: string
  model: string
  timeoutMs: number
  extraBody?: Record<string, unknown>
}

export interface Usage {
  promptTokens: number
  completionTokens: number
  /**
   * 思考型模型消耗的推理 token。**必须单独采集**：实测 8052 的 longcat 在编辑任务上
   * completion 2500 里 reasoning 占 1739（70%），reviewer 任务 940 里占 795（85%）。
   * 不看这个数就会把批大小估错一个量级（曾按「可见输出」估算，实测撞 token 上限被截断）。
   */
  reasoningTokens: number
  /** 实际服务的模型名。8052 会无视传入 model 一律返回 meituan/longcat-2.0:free，故必须回读 */
  model: string
  endpointId: string
  elapsedMs: number
}

export interface ChatResponse {
  content: string
  usage: Usage
  /** 是否因 max_tokens 被截断——截断的 JSON 不可解析，必须重试或降批 */
  truncated: boolean
}

export interface RoleConfig {
  batchSize: number
  maxTokens: number
  temperature: number
  chain: EndpointConfig[]
}

export interface EditorialConfig {
  enabled: boolean
  stagingDir: string
  writer: RoleConfig
  reviewer: RoleConfig
  calibration?: {
    goldStandardPath?: string
    minDistinctBuckets?: number
    maxSaturationRate?: number
    minAgreementRate?: number
  }
}

/** 端点解析：env 优先于 default。baseUrl 为空的端点直接跳过（视为未配置）。 */
export function resolveEndpoint(cfg: EndpointConfig, env: NodeJS.ProcessEnv = process.env): ResolvedEndpoint | null {
  const baseUrl = (cfg.baseUrlEnv && env[cfg.baseUrlEnv]) || cfg.baseUrlDefault || ''
  if (!baseUrl) return null
  return {
    id: cfg.id,
    baseUrl: baseUrl.replace(/\/$/, ''),
    apiKey: cfg.apiKeyEnv ? env[cfg.apiKeyEnv] : undefined,
    model: (cfg.modelEnv && env[cfg.modelEnv]) || cfg.modelDefault || '',
    timeoutMs: cfg.timeoutMs,
    extraBody: cfg.extraBody,
  }
}

export function resolveChain(role: RoleConfig, env: NodeJS.ProcessEnv = process.env): ResolvedEndpoint[] {
  return (role.chain ?? []).map((c) => resolveEndpoint(c, env)).filter((e): e is ResolvedEndpoint => e !== null)
}

export class AllEndpointsFailedError extends Error {
  constructor(readonly attempts: Array<{ endpointId: string; error: string }>) {
    super(
      `编辑部降级链全部失败（${attempts.length} 个端点）：` +
        attempts.map((a) => `${a.endpointId}: ${a.error}`).join(' | '),
    )
    this.name = 'AllEndpointsFailedError'
  }
}

export class EditorialProvider {
  private readonly chain: ResolvedEndpoint[]

  constructor(
    private readonly role: RoleConfig,
    env: NodeJS.ProcessEnv = process.env,
    private readonly fetchFn: FetchFn = defaultFetch,
  ) {
    this.chain = resolveChain(role, env)
  }

  get endpoints(): ResolvedEndpoint[] {
    return this.chain
  }

  get available(): boolean {
    return this.chain.length > 0
  }

  /**
   * 按降级链依次尝试。触发降级的三种情况：超时 / 非 2xx / 响应不可解析。
   *
   * 「响应不可解析」必须算失败：8052 实测会因 max_tokens 撞顶而返回**被截断的 JSON**
   * （completion_tokens 恰等于 max_tokens、finish_reason=length），这种响应 HTTP 200
   * 但内容不可用——若只看 status 就会把半截 JSON 喂给下游。
   */
  async chat(
    prompt: string,
    opts?: {
      maxTokens?: number
      temperature?: number
      /** 形状级校验：抛错 = 该端点失败，链自动降级到下一档 */
      validate?: (content: string) => void
    },
  ): Promise<ChatResponse> {
    if (this.chain.length === 0) throw new AllEndpointsFailedError([])

    const attempts: Array<{ endpointId: string; error: string }> = []
    for (const ep of this.chain) {
      try {
        const res = await this.callEndpoint(ep, prompt, opts)
        // HTTP 200 + finish=stop 但 JSON 形状不对的响应必须算该端点失败：
        // parse 检查若只在调用方做，形状错误不落备胎、整批直降机械
        //（2026-09-06 NIM 故障期 42% 批降级的根因）。
        if (opts?.validate) opts.validate(res.content)
        return res
      } catch (err) {
        attempts.push({ endpointId: ep.id, error: err instanceof Error ? err.message : String(err) })
      }
    }
    throw new AllEndpointsFailedError(attempts)
  }

  private async callEndpoint(
    ep: ResolvedEndpoint,
    prompt: string,
    opts?: { maxTokens?: number; temperature?: number },
  ): Promise<ChatResponse> {
    const started = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ep.timeoutMs)
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      // 本地 llama-server 不校验 key，nous-proxy 用占位 key；有就带，没有不伪造
      if (ep.apiKey) headers.authorization = `Bearer ${ep.apiKey}`

      const res = await this.fetchFn(`${ep.baseUrl}/chat/completions`, {
        signal: controller.signal,
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: ep.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: opts?.maxTokens ?? this.role.maxTokens,
          temperature: opts?.temperature ?? this.role.temperature,
          ...(ep.extraBody ?? {}),
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status ?? '?'}`)

      const data = JSON.parse(await res.text()) as {
        model?: string
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
        usage?: {
          prompt_tokens?: number
          completion_tokens?: number
          completion_tokens_details?: { reasoning_tokens?: number }
        }
      }
      const content = data.choices?.[0]?.message?.content
      if (typeof content !== 'string' || content.length === 0) {
        throw new Error('响应无 content（端点可能改写了请求或模型未加载）')
      }

      return {
        content,
        truncated: data.choices?.[0]?.finish_reason === 'length',
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
          // 回读实际 model：8052 无视传入值，一律路由到 meituan/longcat-2.0:free
          model: data.model ?? ep.model,
          endpointId: ep.id,
          elapsedMs: Date.now() - started,
        },
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * 从响应文本里抠出 JSON 数组。
 *
 * 模型常在 JSON 前后包裹说明文字或 ```json 围栏，直接 JSON.parse 会失败。
 * 但**不得因此放宽到"能抠出多少算多少"**：漏答的条目必须显式标记，
 * 由调用方降级处理（旧 LlmScorer 用常数 0.5 填漏答，在观测序列里造假平台，已修）。
 */
export function extractJsonArray(text: string): { items: unknown[]; parsed: boolean } {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1]! : text
  const match = body.match(/\[[\s\S]*\]/)
  if (!match) return { items: [], parsed: false }
  try {
    const arr = JSON.parse(match[0]) as unknown
    return Array.isArray(arr) ? { items: arr, parsed: true } : { items: [], parsed: false }
  } catch {
    return { items: [], parsed: false }
  }
}

/** 把条目渲染成 prompt 里的编号块。转义换行与方括号，防破坏「只输出 JSON 数组」的指令。 */
export function renderItemsBlock(items: Array<{ title: string; body: string }>, bodyChars = 600): string {
  const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, ' ').replace(/\[/g, '\\[').replace(/\]/g, '\\]')
  return items.map((it, i) => `[${i}] ${esc(it.title)}\n${esc((it.body ?? '').slice(0, bodyChars))}`).join('\n')
}
