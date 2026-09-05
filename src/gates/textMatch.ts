import { normalizeText } from '../collector/dedupe.js'

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff]/

/**
 * 判断标准化后的文本 hay（首尾带空格）是否命中关键词 k。
 * - 英文/ASCII 词/短语：严格词边界匹配（两端为空格，避免 storage 误命中 rag、upbeat 误命中 beat）；
 * - 含 CJK 字符的关键词：子串匹配（中文连续无空格，词边界不适用）。
 *
 * 纯文本匹配工具，闸门与打分器共用；口径不一致会导致「闸门放行但打分器算 0 命中」这类静默错位。
 */
export function matchesKeyword(hay: string, keyword: string): boolean {
  const normK = normalizeText(keyword)
  if (!normK) return false
  if (CJK_PATTERN.test(normK)) {
    return hay.includes(normK)
  }
  return hay.includes(' ' + normK + ' ')
}

/** 把原始文本标准化为「首尾带空格」的比对串，供 matchesKeyword 使用。 */
export function toHaystack(text: string): string {
  return ' ' + normalizeText(text) + ' '
}

export interface CompiledRule {
  id: string
  regex: RegExp
}

/**
 * 编译来自配置文件的正则。配置是外部输入，必须容错：
 * - 语法错误 → 返回 null 并附错误信息，由调用方决定是跳过还是熔断。
 *   **不得静默跳过**：一条写错的黑名单规则等于该规则不存在，闸门会假绿。
 * - flags 白名单：只允许 i/m/s/u，杜绝 `g`（lastIndex 状态在复用时会造成漏判）。
 */
export function compilePattern(
  pattern: string,
  flags = 'i',
): { regex: RegExp | null; error?: string } {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    return { regex: null, error: '空 pattern' }
  }
  const safeFlags = (flags || 'i').split('').filter((f) => 'imsu'.includes(f)).join('')
  try {
    return { regex: new RegExp(pattern, safeFlags) }
  } catch (err) {
    return { regex: null, error: err instanceof Error ? err.message : String(err) }
  }
}
