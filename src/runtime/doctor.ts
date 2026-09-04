import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import type { DomainConfig, SourceConfig, SpawnFn } from '../types.js'

export interface DoctorResult {
  ok: boolean
  node: { version: string; execPath: string }
  path: string[]
  tools: Record<string, { ok: boolean; path?: string; version?: string; error?: string }>
  configs: { domain: boolean; sources: boolean; push: boolean }
  sourcesStats: { total: number; enabled: number; spawnSources: number }
  keys: { telegram: boolean; llm: boolean; jina: boolean }
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
  const configs = {
    domain: existsSync(domainPath),
    sources: existsSync(sourcesPath),
    push: existsSync(pushPath),
  }
  if (!configs.domain) issues.push('config/domain.json 不存在')
  if (!configs.sources) issues.push('config/sources.json 不存在')
  if (!configs.push) issues.push('config/push.json 不存在')

  let sourcesList: SourceConfig[] = []
  if (configs.sources) {
    try {
      sourcesList = JSON.parse(readFileSync(sourcesPath, 'utf8')) as SourceConfig[]
    } catch {
      issues.push('config/sources.json 解析失败')
    }
  }

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
  const tgToken = process.env.DOMAIN_BOT_TELEGRAM_TOKEN
  const tgChatId = process.env.DOMAIN_BOT_TELEGRAM_CHAT_ID
  const hasTg = Boolean(tgToken && tgChatId)
  // 与 scorer.ts 的 LLM 打分器启用条件（三者齐备）一致；OPENAI_API_KEY 是其他工具的通用变量，不构成 domain-bot 的 LLM 就绪
  const hasLlm = Boolean(process.env.DOMAIN_BOT_LLM_BASE_URL && process.env.DOMAIN_BOT_LLM_API_KEY && process.env.DOMAIN_BOT_LLM_MODEL)
  const hasJina = Boolean(process.env.DOMAIN_BOT_JINA_API_KEY)

  if (!hasTg) {
    issues.push('Telegram 未配置（DOMAIN_BOT_TELEGRAM_TOKEN / CHAT_ID），探针将无法进行推送与收集反馈')
  }

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
      telegram: hasTg,
      llm: hasLlm,
      jina: hasJina,
    },
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
  lines.push(`  ${res.keys.telegram ? '✓' : '✗'} Telegram  : ${res.keys.telegram ? '已就绪' : '未配置 (缺失 token 或 chat_id)'}`)
  lines.push(`  ${res.keys.llm ? '✓' : 'ℹ'} LLM       : ${res.keys.llm ? '已就绪' : '未配置 (将自动降级为 HeuristicScorer)'}`)
  lines.push(`  ${res.keys.jina ? '✓' : 'ℹ'} Jina Key  : ${res.keys.jina ? '已就绪' : '未配置 (将走匿名或 exa 兜底)'}`)
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
