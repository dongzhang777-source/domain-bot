import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GatekeeperInput } from '../types.js'
import { canonicalUrl } from '../collector/canonicalUrl.js'
import { collectCanonicalUrls } from '../gates/fingerprint.js'
import { detectLang } from '../render/tuna.js'
import { embedText, isValidEmbedding } from '../embedding.js'

/**
 * 内容包产出与跨产线指纹库。
 *
 * 职责边界：**本模块只做装配与落盘**，不做渲染、不做质量判定——那是
 * `src/gatekeeper/` 的事。两处都做会造成断言口径漂移（渲染侧以为合法、终审侧否决）。
 *
 * schema 保持 `tuna-brief-v1`，对齐 tuna 侧 `packages/feeds/normalizers.ts` 的
 * `LOCAL_BRIEF_SCHEMA` 与 `LocalBriefNormalizer`（已编码但截至 2026-09-04 尚未接线，
 * 接线属 DB-06 的 T3）。
 */

export const PACK_SCHEMA = 'tuna-brief-v1'

/**
 * tuna 侧稳定 id 的正则（`tuna/packages/feeds/normalizers.ts:370`）。
 * **只允许两段冒号**——四段式 `domain-bot:<persona>:<digestId>:<index>` 会校验失败，
 * 故 persona 必须用连字符并进第一段（`domain-bot-newsline:<digestId>:<index>`）。
 */
export const TUNA_POST_ID = /^[a-z0-9-]+:[a-z0-9]+:\d+$/

export interface FeedPack {
  schema: string
  digestId: string
  /** persona id，供 tuna 侧按 bot 分流 */
  persona: string
  personaDisplay: string
  domain: string
  generatedAt: string
  posts: Array<Record<string, unknown>>
  brief: { generatedAt: string; items: Array<{ postId: string; why: string; source: 'static' }> }
}

export function buildPack(
  published: GatekeeperInput[],
  ctx: { digestId: string; persona: string; personaDisplay: string; domain: string; generatedAt: number },
): FeedPack {
  const generatedAt = new Date(ctx.generatedAt).toISOString()
  const posts = published.map((p) => ({
    id: p.id,
    title: p.title,
    hooks: p.hooks,
    summary: p.summary,
    body: p.body,
    // lang 必须按**交付文案**（summary）的实际语言标注，不能透传候选原文的 lang：
    // 编辑部生产（2026-09-06 起）对英文原文产出中文文案，透传会让 App 侧拿到 lang=en
    // 的中文稿，任何按 lang 分流的消费端都会分流错。判据复用 render/tuna 的 detectLang
    //（CJK 占比 >30% 即 zh），不另写一套。
    lang: detectLang(p.summary),
    author: { id: `domain-bot-${ctx.persona}`, name: ctx.personaDisplay, kind: 'user' as const },
    provenance: 'human',
    epistemic: 'inference',
    signer: null,
    schemaVersion: 1,
    createdAt: new Date(p.publishedAt || ctx.generatedAt).toISOString(),
    sourceUrl: p.url,
  }))
  return {
    schema: PACK_SCHEMA,
    digestId: ctx.digestId,
    persona: ctx.persona,
    personaDisplay: ctx.personaDisplay,
    domain: ctx.domain,
    generatedAt,
    posts,
    brief: { generatedAt, items: published.map((p) => ({ postId: p.id, why: p.why, source: 'static' as const })) },
  }
}

/**
 * 为包内每条 post 附上内容向量（E3 过渡态：向量随包下发，端侧只算 P 不算 V）。
 * 向量面 = title + summary（L1/L2 读者可见面即匹配面）。
 *
 * 失败语义：单条向量化失败→该条**无 embedding 字段**继续发布（缺向量可后补，
 * 坏向量会污染端侧兴趣向量 P，绝不带病入库）；整批失败→打印警告不阻断发布——
 * 向量是增强属性，不能让它拖垮内容主链路。tuna 侧 LocalBriefNormalizer 会做
 * 同样的合法性校验（维度/有限数），双保险。
 */
export async function attachEmbeddings(
  pack: FeedPack,
  io: { stderr: (line: string) => void },
): Promise<number> {
  let attached = 0
  for (const post of pack.posts) {
    try {
      const text = `${String(post['title'] ?? '')}\n${String(post['summary'] ?? '')}`.trim()
      if (!text) continue
      const embedding = await embedText(text)
      if (!isValidEmbedding(embedding)) throw new Error('向量未通过自校验')
      post['embedding'] = embedding
      attached += 1
    } catch (err) {
      io.stderr(`[pack] 向量化失败（该条无向量发布）: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return attached
}

/**
 * 装配前校验：id 必须过 tuna 侧正则。
 *
 * 这条检查放在落盘之前而不是靠 tuna 侧抛错——DB-03 的教训是产物在仓库外生成、
 * 没有任何环节校验契约，直到用户真机刷到才发现。契约违约必须在生产侧就熔断。
 */
export function assertPackContract(pack: FeedPack): void {
  for (const post of pack.posts) {
    const id = String(post['id'] ?? '')
    if (!TUNA_POST_ID.test(id)) {
      throw new Error(`内容包 id 不合 tuna 契约（${TUNA_POST_ID}）：「${id}」`)
    }
  }
  const ids = pack.posts.map((p) => String(p['id']))
  if (new Set(ids).size !== ids.length) throw new Error('内容包存在重复 id')

  const urls = pack.posts.map((p) => String(p['sourceUrl'] ?? ''))
  // DB-11/D9：tuna 的「↗ 原文」依赖 sourceUrl，normalizer 对缺失只静默降级（不挂链接），
  // 产品侧不允许——缺失必须在生产侧熔断，而不是等真机发现 L2 断链。
  const missingUrl = pack.posts.filter((p) => !String(p['sourceUrl'] ?? '').trim())
  if (missingUrl.length > 0) {
    throw new Error(`内容包 ${missingUrl.length} 条缺 sourceUrl（L2「↗ 原文」会静默断链）：${missingUrl.slice(0, 3).map((p) => p['id']).join('、')}`)
  }
  const canonical = collectCanonicalUrls(urls.map((url) => ({ url })))
  if (new Set(canonical).size !== canonical.length) throw new Error('内容包存在重复规范 URL')

  if (pack.posts.length !== pack.brief.items.length) {
    throw new Error(`posts(${pack.posts.length}) 与 brief.items(${pack.brief.items.length}) 数量不一致`)
  }
}

type Entry = { post: Record<string, unknown>; brief: FeedPack['brief']['items'][number] }

const entryUrlOf = (e: Entry) => canonicalUrl(String(e.post.sourceUrl ?? ''))

export function writePack(pack: FeedPack, outDir: string): string {
  const path = join(outDir, `feed-pack-${pack.persona}-${pack.digestId}.json`)
  // 合并写 v3（2026-09-08 事故修复）：同 digest 重跑 publish 时，此前已发布的条目会被
  // 指纹库（gk:alreadyPublished）拦下、不在本轮 published 里——整文件覆盖会把它们从
  // 交付面抹掉（已消费但不在任何 pack，下游永久丢稿）。
  //
  // **条目身份 = 规范 URL**（内容不变则身份不变）。v2 的「id 为主键」有致命缺陷：
  // postId 的 index 是每次 publish 重编号的，跨 run 编号位移时，新亲写稿会与旧机械稿
  // 撞 id——v2 规则把新条目当「挤占者」跳过，实测一晚丢 5 篇亲写稿。
  // v3 规则：
  //   a) 同 URL：同一条目。id 相同 → 文案刷新（新胜）；id 不同 → 保留已交付形态
  //      （旧 id 已对外发布过，不换号，防 postId 漂移与重复）。
  //   b) 新 URL：新条目。id 未被占用 → 直接加入；id 撞车（跨 run 编号位移）→
  //      重映射到空闲序号（防「占坑跳过」式丢稿）。
  let merged = pack
  if (existsSync(path)) {
    try {
      const prev = JSON.parse(readFileSync(path, 'utf8')) as FeedPack
      const urlOf = (p: Record<string, unknown>) => canonicalUrl(String(p.sourceUrl ?? ''))
      const byUrl = new Map<string, Entry>()
      const usedIds = new Set<string>()
      for (let i = 0; i < prev.posts.length; i++) {
        const post = prev.posts[i]!
        byUrl.set(entryUrlOf({ post, brief: prev.brief.items[i]! }), { post, brief: prev.brief.items[i]! })
        usedIds.add(String(post.id))
      }
      for (let i = 0; i < pack.posts.length; i++) {
        const p = pack.posts[i]!
        const k = entryUrlOf({ post: p, brief: pack.brief.items[i]! })
        const hit = byUrl.get(k)
        if (hit) {
          // a) 同 URL：id 相同 = 同一条目刷新（新胜）；id 不同 = 保留已交付形态
          if (String(hit.post.id) === String(p.id)) {
            byUrl.set(k, { post: p, brief: pack.brief.items[i]! })
          }
          continue
        }
        // b) 新 URL 条目：id 撞车（跨 run 编号位移）→ 重映射到空闲序号
        let id = String(p.id)
        if (usedIds.has(id)) {
          const m = id.match(/^(.*:)(\d+)$/)
          const prefix = m ? m[1] : id + ':'
          let n = m ? Number(m[2]) : 0
          do { id = prefix + n; n += 1 } while (usedIds.has(id))
        }
        byUrl.set(k, { post: { ...p, id }, brief: { ...pack.brief.items[i]!, postId: id } })
        usedIds.add(id)
      }
      const posts = [...byUrl.values()]
        .map((e) => e.post)
        .sort((a, b) => postIndex(a) - postIndex(b))
      merged = {
        ...pack,
        posts,
        brief: {
          generatedAt: pack.brief.generatedAt,
          items: posts
            .map((p) => byUrl.get(entryUrlOf({ post: p, brief: { postId: '', why: '', source: 'static' } }))?.brief)
            .filter((i): i is FeedPack['brief']['items'][number] => i !== undefined),
        },
      }
    } catch {
      // 旧包损坏不可读：按纯新一轮覆盖写（等同旧行为），不因合并逻辑引入新故障
      merged = pack
    }
  }
  assertPackContract(merged)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(path, JSON.stringify(merged, null, 2))
  return path
}

/** postId 尾段序号（`domain-bot-<persona>:<digest>:<index>`），保持 digest 内原顺序。 */
function postIndex(p: Record<string, unknown>): number {
  const m = String(p.id ?? '').match(/:(\d+)$/)
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER
}

// ---------- 跨产线共享的已发布指纹库 ----------

/**
 * 指纹库上限。超过后按插入顺序裁掉最旧的——两条产线每天各发百条级，
 * 不设上限会让文件无限增长且拖慢每轮的 Set 构建。
 */
const FINGERPRINT_LIMIT = 20_000
export const FINGERPRINT_FILE = 'published-fingerprints.json'

export function loadFingerprints(memoryDir: string): Set<string> {
  const path = join(memoryDir, FINGERPRINT_FILE)
  if (!existsSync(path)) return new Set()
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { urls?: unknown }
    if (!Array.isArray(raw.urls)) return new Set()
    return new Set(raw.urls.filter((u): u is string => typeof u === 'string'))
  } catch (err) {
    // 坏文件不得静默清零：改名留证 + 从空库开始，与 store.ts 对 interest.json 的处置同口径
    const bad = `${path}.bad-${Date.now()}`
    try {
      writeFileSync(bad, readFileSync(path))
    } catch {
      /* 留证失败不阻塞主流程 */
    }
    console.error(`[publish] ${FINGERPRINT_FILE} 解析失败，坏文件移至 ${bad}：`, err instanceof Error ? err.message : err)
    return new Set()
  }
}

/**
 * 追加本轮发布的规范 URL。
 *
 * 只有真正落盘发布后才调用——`--dry-run` 不得写入，否则试跑会污染指纹库，
 * 使正式发布时同一条目被自己的试跑记录否决。
 */
export function appendFingerprints(memoryDir: string, published: Array<{ url: string }>): number {
  const existing = loadFingerprints(memoryDir)
  const before = existing.size
  for (const url of collectCanonicalUrls(published)) existing.add(url)
  const urls = [...existing]
  const trimmed = urls.length > FINGERPRINT_LIMIT ? urls.slice(urls.length - FINGERPRINT_LIMIT) : urls

  mkdirSync(memoryDir, { recursive: true })
  const path = join(memoryDir, FINGERPRINT_FILE)
  // 原子写：先写临时文件再 rename，避免中断留下半截 JSON（与 store.ts 的 writeFileAtomic 同纪律）
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify({ updatedAt: Date.now(), urls: trimmed }, null, 2))
  renameSync(tmp, path)

  return trimmed.length - before
}
