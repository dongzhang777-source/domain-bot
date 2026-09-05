/**
 * 规范 URL（Canonical URL）：剥离跟踪参数与易变片段，供跨渠道去重与 id 派生。
 *
 * 背景（DB-03 审计实证，docs/tasks/TASK-DB-03-quality-audit-done.md §1.2）：
 * 同一篇报道经 rss 与 exa 两条渠道抓回时正文略有差异，而旧 id = contentHash({title, body})
 * 是内容派生 → 两条 id 不同 → dedupe 双双放行，200 条里出现 12 条一字不差的完全重复
 * （6 组 URL 100% 重复）。另 #174 microsoft/agent-framework 仅 URL 后缀带活动打点参数
 * 即被判为两条；#171 openai-agents-python 经 GitHub 与 Exa 双渠道各出一条。
 * 故 id 必须改由规范 URL 派生，且所有适配器口径一致，跨渠道才 dedupe 得掉。
 */

/** 精确匹配的跟踪/会话参数名（小写比对）。 */
const TRACKING_PARAMS = new Set([
  // UTM 家族之外的常见营销/会话参数
  'fbclid', 'gclid', 'dclid', 'yclid', 'twclid', 'igshid', 'msclkid', 'gbraid', 'wbraid',
  'ref', 'referrer', 'reference', 'source', 'from', 'spm', 'scm',
  // 邮件营销
  'mc_id', 'mc_eid', 'wt.mc_id', 'mkt_tok', 'vero_id', 'hsa_cam', 'ncid', 'mbid', 'cmpid',
  // GitHub 仓库页的视图切换参数：同一仓库的 readme 视图不是另一篇文档
  'tab',
  // 分页/锚点类易变参数
  'pk_campaign', 'pk_kwd', 'trk', 'scid', 'cid', '_hsenc', '_hsmi',
])

/** 前缀规则：命中即剥离（覆盖各家自造参数名）。 */
const TRACKING_PREFIXES = ['utm_', 'pk_', 'hsa_', 'mkt_', 'igsh', 'vero_', 'mc_', 'wt.']

/**
 * 生成规范 URL。无法解析或非 http(s) 时返回空串，由调用方回退到内容哈希派生 id。
 *
 * 归一化规则：
 * - protocol + host 小写，剥离 `www.` 前缀（www 与非 www 通常同源）；
 * - 剥离跟踪参数，保留的参数按 key 排序（保证比较稳定，与原始顺序无关）；
 * - 路径去尾斜杠（根路径 `/` 除外），路径大小写保留（部分站点路径大小写敏感）；
 * - fragment 一律丢弃（`#` 后是页内锚点，不构成不同文档）。
 */
export function canonicalUrl(raw: string): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return ''

  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    return ''
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''

  let host = u.hostname.toLowerCase()
  if (host.startsWith('www.')) host = host.slice(4)
  if (!host) return ''

  const kept: string[] = []
  u.searchParams.forEach((value, key) => {
    const k = key.toLowerCase()
    if (TRACKING_PARAMS.has(k)) return
    if (TRACKING_PREFIXES.some((p) => k.startsWith(p))) return
    kept.push(`${k}=${value}`)
  })
  kept.sort()

  let path = u.pathname
  if (path.length > 1) path = path.replace(/\/+$/, '') || '/'

  const query = kept.length ? `?${kept.join('&')}` : ''
  return `${u.protocol}//${host}${path}${query}`
}

/** 两个 URL 是否指向同一文档（任一侧无法规范化时判否，交由内容哈希兜底）。 */
export function sameDocument(a: string, b: string): boolean {
  const ca = canonicalUrl(a)
  const cb = canonicalUrl(b)
  return ca !== '' && ca === cb
}
