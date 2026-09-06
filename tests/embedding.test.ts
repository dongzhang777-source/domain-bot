import { describe, expect, it } from 'vitest'
import { EMBEDDING_DIM, EMBEDDING_MODEL, embedText, isValidEmbedding } from '../src/embedding.js'
import { attachEmbeddings, type FeedPack } from '../src/publish/pack.js'

/**
 * 内容向量（E3 过渡态）。直连真实模型（首次运行会下载 ~120MB 量化权重到
 * ~/.cache/domain-bot-embeddings，之后离线可用）——mock 测不到维度/归一化
 * 这些真正要锁死的契约属性。
 */
describe('内容向量：E3 过渡态契约', () => {
  it('embedText 产出 384 维、L2 归一化、model 锁定的向量', async () => {
    const e = await embedText('FlashInfer kernels accelerate transformer serving for LLM inference')
    expect(e.model).toBe(EMBEDDING_MODEL)
    expect(e.dim).toBe(EMBEDDING_DIM)
    expect(e.vector).toHaveLength(EMBEDDING_DIM)
    expect(e.vector.every((x) => Number.isFinite(x))).toBe(true)
    const norm = Math.sqrt(e.vector.reduce((acc, x) => acc + x * x, 0))
    expect(norm, `L2 范数应为 1，实为 ${norm}`).toBeGreaterThan(0.99)
    expect(norm).toBeLessThan(1.01)
  }, 240_000)

  it('语义相近文本的内积显著高于无关文本（余弦可用性冒烟）', async () => {
    const a = await embedText('New LLM inference benchmark for transformer serving performance')
    const b = await embedText('Transformer serving inference performance benchmark released')
    const c = await embedText('Chocolate cake recipe with butter and cocoa powder')
    const dot = (x: typeof a, y: typeof a) => x.vector.reduce((acc, v, i) => acc + v * y.vector[i], 0)
    expect(dot(a, b), '同义文本相似度应 >0.7').toBeGreaterThan(0.7)
    expect(dot(a, b)).toBeGreaterThan(dot(a, c))
  }, 240_000)

  it('isValidEmbedding 拒绝维度错/非有限数/异构模型', () => {
    const good = { model: EMBEDDING_MODEL, dim: EMBEDDING_DIM, vector: new Array(EMBEDDING_DIM).fill(0.1) }
    expect(isValidEmbedding(good)).toBe(true)
    expect(isValidEmbedding({ ...good, dim: 383 })).toBe(false)
    expect(isValidEmbedding({ ...good, vector: [0.1, 0.2] })).toBe(false)
    expect(isValidEmbedding({ ...good, vector: good.vector.map((x, i) => (i === 0 ? NaN : x)) })).toBe(false)
    expect(isValidEmbedding({ ...good, model: 'other-model' })).toBe(false)
    expect(isValidEmbedding(null)).toBe(false)
  })
})

describe('attachEmbeddings：包级向量附加', () => {
  const io = { stderr: (line: string) => void line }
  it('合法 post 附上合法向量；空文本跳过', async () => {
    const pack: FeedPack = {
      schema: 'tuna-brief-v1',
      digestId: 'abc1',
      persona: 'newsline',
      personaDisplay: 'AI时事快线',
      domain: 'ai-llm',
      generatedAt: new Date().toISOString(),
      posts: [
        { id: 'domain-bot-newsline:abc1:0', title: 'FlashInfer serving kernels', summary: 'Inference performance benchmark release' },
        { id: 'domain-bot-newsline:abc1:1', title: '', summary: '' },
      ],
    } as unknown as FeedPack
    const attached = await attachEmbeddings(pack, io)
    expect(attached).toBe(1)
    const e = pack.posts[0]?.['embedding'] as { model: string; dim: number; vector: number[] } | undefined
    expect(e).toBeDefined()
    expect(isValidEmbedding(e)).toBe(true)
    expect(pack.posts[1]?.['embedding']).toBeUndefined()
  }, 120_000)
})
