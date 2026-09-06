import { pipeline, env } from '@xenova/transformers'

/**
 * 内容向量（2026-09-06 老张指令「tuna 设计倚重向量匹配，bot 纳入内容向量」）。
 *
 * 模型锁定（E3 签字决策 2026-08-08，`tuna/docs/NUMBERING.md` §E3）：过渡态使用
 * 单一固定模型，默认候选 `paraphrase-multilingual-MiniLM-L12-v2`（384 维，中英多语）。
 * **换模型=换向量空间=已发向量全部作废**，任何更换必须走老张拍板 + pack 版本三元组
 * （contentVer=pack.digestId/generatedAt，modelVer=EMBEDDING_MODEL，checksum=发布器
 * packSha256 对整包原文哈希天然覆盖）整体升版。
 *
 * 端侧消费（tuna E3/W1）：P = normalize(Σ wᵢ·Vᵢ)，向量在包内预计算（端侧不算 V，
 * 只算 P）——见 tuna-embedding-architecture 技能「过渡态 vs 终态」。
 *
 * 实现：@xenova/transformers（ONNX quantized，~120MB，首次运行自动下载后走本地缓存）。
 * mean pooling + L2 归一化：下游余弦相似度可直接用内积。
 */

// 模型文件缓存到仓库外用户目录，避免工具产物入库（工作区零容忍纪律）
env.cacheDir = `${process.env.HOME ?? '.'}/.cache/domain-bot-embeddings`

export const EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
export const EMBEDDING_DIM = 384

export interface ContentEmbedding {
  /** 模型标识（modelVer）。消费端必须校验与本端模型一致，异构向量不可比。 */
  model: string
  dim: number
  /** L2 归一化后的向量。 */
  vector: number[]
}

type Extractor = (
  text: string,
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>

let extractorPromise: Promise<Extractor> | null = null

function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', EMBEDDING_MODEL, { quantized: true }) as Promise<Extractor>
  }
  return extractorPromise
}

/** 向量合法性校验：维度正确且全为有限数。坏向量比缺向量危害大（会污染端侧 P），直接拒。 */
export function isValidEmbedding(e: unknown): e is ContentEmbedding {
  if (typeof e !== 'object' || e === null) return false
  const c = e as ContentEmbedding
  return (
    c.model === EMBEDDING_MODEL &&
    c.dim === EMBEDDING_DIM &&
    Array.isArray(c.vector) &&
    c.vector.length === EMBEDDING_DIM &&
    c.vector.every((x) => typeof x === 'number' && Number.isFinite(x))
  )
}

/** 单条文本向量化：title + summary 拼接（L1/L2 的读者可见面即匹配面）。 */
export async function embedText(text: string): Promise<ContentEmbedding> {
  const extractor = await getExtractor()
  const out = await extractor(text.slice(0, 2000), { pooling: 'mean', normalize: true })
  if (!out.data || out.data.length !== EMBEDDING_DIM) {
    throw new Error(`embedding 输出维度异常：期望 ${EMBEDDING_DIM}，实为 ${out.data?.length}`)
  }
  return { model: EMBEDDING_MODEL, dim: EMBEDDING_DIM, vector: Array.from(out.data) }
}
