import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import type { DomainConfig, GatesConfig, PersonaConfig, SourceConfig, SpawnFn } from '../types.js'
import { compilePattern } from '../gates/textMatch.js'

export interface DoctorResult {
  ok: boolean
  node: { version: string; execPath: string }
  path: string[]
  tools: Record<string, { ok: boolean; path?: string; version?: string; error?: string }>
  configs: { domain: boolean; sources: boolean; push: boolean; gates: boolean; personas: string[] }
  sourcesStats: { total: number; enabled: number; spawnSources: number }
  keys: { llm: boolean; jina: boolean }
  /** 闸门/persona 配置里的正则编译失败清单。非空即说明有规则实际未生效（闸门假绿） */
  patternErrors: string[]
  issues: string[]
}

const defaultSpawn: SpawnFn = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10_000 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr }))
      else resolve({ stdout, stderr })
    })
  })

export async function runDoctor(root: string = process.cwd(), spawnFn: SpawnFn = defaultSpawn): Promise<DoctorResult> {
  const issues: string[] = []
  const pathDirs = (process.env.PATH ?? '').split(':').filter(Boolean)

  // 1. 探测 CLI 工具
  const toolsToCheck = [
    { name: 'mcporter', testArgs: ['--version'] },
    { name: 'bili', testArgs: ['--help'] },
    { name: 'yt-dlp', testArgs: ['--version'] },
  ]
  const tools: Record<string, { ok: boolean; path?: string; version?: string; error?: string }> = {}
  for (const t of toolsToCheck) {
    try {
      const res = await spawnFn(t.name, t.testArgs)
      const firstLine = (res.stdout || res.stderr || '').split('\n')[0]?.trim() || 'available'
      tools[t.name] = { ok: true, version: firstLine }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      tools[t.name] = { ok: false, error: msg }
    }
  }

  // 2. 检查配置文件
  const domainPath = join(root, 'config/domain.json')
  const sourcesPath = join(root, 'config/sources.json')
  const pushPath = join(root, 'config/push.json')
  const gatesPath = join(root, 'config/gates.json')
  const personasDir = join(root, 'config/personas')
  const personaIds = existsSync(personasDir)
    ? readdirSync(personasDir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort()
    : []
  const configs = {
    domain: existsSync(domainPath),
    sources: existsSync(sourcesPath),
    push: existsSync(pushPath),
    gates: existsSync(gatesPath),
    personas: personaIds,
  }
  if (!configs.domain) issues.push('config/domain.json 不存在')
  if (!configs.sources) issues.push('config/sources.json 不存在')
  if (!configs.push) issues.push('config/push.json 不存在')
  // 闸门与 persona 配置缺失时产线根本无法跑（runGates 无配置可用），属于硬错误
  if (!configs.gates) issues.push('config/gates.json 不存在（三层硬闸门无配置，产线无法运行）')
  if (personaIds.length === 0) issues.push('config/personas/ 下无任何 persona 配置（双产线无定义）')

  let sourcesList: SourceConfig[] = []
  if (configs.sources) {
    try {
      sourcesList = JSON.parse(readFileSync(sourcesPath, 'utf8')) as SourceConfig[]
    } catch {
      issues.push('config/sources.json 解析失败')
    }
  }

  // 2b. 闸门与 persona 配置的健康度：正则必须能编译，白名单必须指向真实存在的源
  const patternErrors: string[] = []
  if (configs.gates) {
    try {
      const gates = JSON.parse(readFileSync(gatesPath, 'utf8')) as GatesConfig
      for (const rule of gates.blacklist ?? []) {
        const { error } = compilePattern(rule.pattern, rule.flags ?? 'i')
        if (error) patternErrors.push(`gates.blacklist/${rule.id}: ${error}`)
      }
      if ((gates.dedupe?.eventStopwords?.length ?? 0) === 0) {
        // 停用词表为空时实体词聚类会把全部条目并成一坨，属于静默失效
        issues.push('config/gates.json 的 dedupe.eventStopwords 为空（实体词聚类会过度合并）')
      }
      const generic = (gates.keywordTiers ?? []).find((t) => t.tier === 'generic')
      if (generic && generic.points !== 0) {
        issues.push(`keywordTiers.generic 的 points 必须为 0（实为 ${generic.points}），否则单凭泛词即可过门禁 2`)
      }
    } catch {
      issues.push('config/gates.json 解析失败')
    }
  }
  const knownSourceIds = new Set(sourcesList.map((s) => s.id))
  for (const id of personaIds) {
    try {
      const persona = JSON.parse(readFileSync(join(personasDir, `${id}.json`), 'utf8')) as PersonaConfig
      for (const rule of persona.rejectRules ?? []) {
        const { error } = compilePattern(rule.pattern, rule.flags ?? 'i')
        if (error) patternErrors.push(`personas/${id}.rejectRules/${rule.id}: ${error}`)
      }
      // 白名单写成不存在的源 → 该产线静默零产出，比报错难查得多
      const unknown = (persona.sources ?? []).filter((s) => !knownSourceIds.has(s))
      if (unknown.length > 0) {
        issues.push(`persona「${id}」白名单里的源不在 config/sources.json：${unknown.join(', ')}`)
      }
    } catch {
      issues.push(`config/personas/${id}.json 解析失败`)
    }
  }
  // 正则编译失败不得静默：一条失效规则等于该规则不存在，闸门会假绿
  for (const e of patternErrors) issues.push(`配置正则编译失败（规则实际未生效）：${e}`)

  const enabledSources = sourcesList.filter((s) => s.enabled)
  const spawnTypes = new Set(['exa', 'bili', 'ytsearch'])
  const enabledSpawnSources = enabledSources.filter((s) => spawnTypes.has(s.type))

  // 检查是否有启用的源依赖不可用的工具
  for (const s of enabledSpawnSources) {
    if (s.type === 'exa' && !tools.mcporter?.ok) {
      issues.push(`源 "${s.id}" (exa) 依赖 mcporter，但 mcporter 未找到或不可用`)
    } else if (s.type === 'bili' && !tools.bili?.ok) {
      issues.push(`源 "${s.id}" (bili) 依赖 bili，但 bili 未找到或不可用`)
    } else if (s.type === 'ytsearch' && !tools['yt-dlp']?.ok) {
      issues.push(`源 "${s.id}" (ytsearch) 依赖 yt-dlp，但 yt-dlp 未找到或不可用`)
    }
  }

  // 3. 检查环境变量 key
  // Telegram 已退役（老张 2026-09-04 裁决：砍掉 Telegram 与每日摘要，改走 tuna 行为回流），
  // 故不再检查 DOMAIN_BOT_TELEGRAM_*。行为回流的接收端属 DB-06。
  // 与 scorer.ts 的 LLM 打分器启用条件（三者齐备）一致；OPENAI_API_KEY 是其他工具的通用变量，不构成 domain-bot 的 LLM 就绪
  const hasLlm = Boolean(process.env.DOMAIN_BOT_LLM_BASE_URL && process.env.DOMAIN_BOT_LLM_API_KEY && process.env.DOMAIN_BOT_LLM_MODEL)
  const hasJina = Boolean(process.env.DOMAIN_BOT_JINA_API_KEY)

  return {
    ok: issues.length === 0,
    node: {
      version: process.version,
      execPath: process.execPath,
    },
    path: pathDirs,
    tools,
    configs,
    sourcesStats: {
      total: sourcesList.length,
      enabled: enabledSources.length,
      spawnSources: enabledSpawnSources.length,
    },
    keys: {
      llm: hasLlm,
      jina: hasJina,
    },
    patternErrors,
    issues,
  }
}

export function formatDoctorReport(res: DoctorResult): string {
  const lines: string[] = [
    '================== domain-bot 环境诊断 (doctor) ==================',
    `Node.js: ${res.node.version} (${res.node.execPath})`,
    `PATH: ${res.path.slice(0, 4).join(':')}${res.path.length > 4 ? ' ...' : ''}`,
    '',
    '--- 外部依赖工具探测 ---',
  ]
  for (const [name, info] of Object.entries(res.tools)) {
    lines.push(`  ${info.ok ? '✓' : '✗'} ${name.padEnd(10)}: ${info.ok ? (info.version ?? 'ok') : `FAIL (${info.error})`}`)
  }
  lines.push('')
  lines.push('--- 通道与凭证配置 ---')
  lines.push(`  ${res.keys.llm ? '✓' : 'ℹ'} LLM       : ${res.keys.llm ? '已就绪' : '未配置 (将自动降级为 HeuristicScorer；AI 编辑部属 DB-05)'}`)
  lines.push(`  ${res.keys.jina ? '✓' : 'ℹ'} Jina Key  : ${res.keys.jina ? '已就绪' : '未配置 (将走匿名或 exa 兜底)'}`)
  lines.push('')
  lines.push('--- 闸门与双产线配置 ---')
  lines.push(`  ${res.configs.gates ? '✓' : '✗'} gates.json : ${res.configs.gates ? '已就绪' : '缺失'}`)
  lines.push(`  ${res.configs.personas.length > 0 ? '✓' : '✗'} personas   : ${res.configs.personas.length > 0 ? res.configs.personas.join(', ') : '缺失'}`)
  lines.push(`  ${res.patternErrors.length === 0 ? '✓' : '✗'} 正则可编译 : ${res.patternErrors.length === 0 ? '全部通过' : `${res.patternErrors.length} 条失败`}`)
  lines.push('')
  lines.push('--- 采集源健康度 ---')
  lines.push(`  总源数: ${res.sourcesStats.total} | 已启用: ${res.sourcesStats.enabled} | 依赖子进程: ${res.sourcesStats.spawnSources}`)
  lines.push('')
  if (res.ok) {
    lines.push('✅ 全部必要依赖与检查通过，环境已就绪！')
  } else {
    lines.push('⚠️ 发现以下问题可能影响探针正常运行:')
    for (const issue of res.issues) {
      lines.push(`  - [!] ${issue}`)
    }
  }
  lines.push('==================================================================')
  return lines.join('\n')
}
