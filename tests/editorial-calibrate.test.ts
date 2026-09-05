import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THRESHOLDS,
  SCORE_BUCKETS,
  assessCalibration,
  bucketOf,
  formatCalibration,
  isCalibrated,
  loadGoldStandard,
  type GoldSample,
} from '../src/editorial/calibrate.js'
import type { ReviewVerdict } from '../src/editorial/reviewer.js'

/**
 * reviewer 灵敏度自检的**自检**。
 *
 * 这一层看起来绕，但必须有：calibrate 是防「打分饱和」的仪器，而仪器自己也可能坏。
 * 本项目已踩过一次——计数型打分器触顶后，「噪音逐轮下降」这条验收标准完全无读数
 * （既非假阳性也非假阴性，而是仪器对目标维度零灵敏度）。如果 calibrate 本身
 * 对饱和不敏感，那它就只是给不合格的发合格证。
 *
 * 故本文件用**构造的判定序列**喂 assessCalibration，断言三种失效都能被抓到：
 * 饱和、无区分度、垃圾档放过。
 */

const gold = loadGoldStandard(join(process.cwd(), 'tests/fixtures/gold-standard.json'))

function verdict(score: number, decision?: ReviewVerdict['decision']): ReviewVerdict {
  const d = decision ?? (score >= 7 ? '保留' : score >= 5 ? '降权' : '剔除')
  return { score, decision: d, category: score >= 7 ? 'AI核心' : 'AI周边', rejectReason: '', origin: 'llm' }
}

/** 理想 reviewer：完全复现人工判定。 */
function perfectVerdicts(g: GoldSample[]): ReviewVerdict[] {
  return g.map((s) => verdict(s.humanScore, s.humanDecision))
}

describe('金标集本身（tests/fixtures/gold-standard.json）', () => {
  it('来自 DB-03 真实审计，四个质量档都有覆盖', () => {
    expect(gold.length).toBeGreaterThanOrEqual(40)
    const dist: Record<string, number> = {}
    for (const s of gold) {
      const b = bucketOf(s.humanScore)
      dist[b] = (dist[b] ?? 0) + 1
    }
    // 四档齐备才有资格当灵敏度标尺：只有高档的样本集测不出「垃圾档放过」
    for (const b of SCORE_BUCKETS) {
      expect(dist[b.id], `金标集缺 ${b.id} 档（${b.label}）样本`).toBeGreaterThan(0)
    }
  })

  it('每条都带 DB-03 的原始序号，可逐条回溯（不是凭空的合成样本）', () => {
    for (const s of gold) expect(s.id).toMatch(/^db03-\d{3}$/)
  })

  it('剔除类样本必须带剔除原因（供不一致时定位是哪类内容判错）', () => {
    const rejected = gold.filter((s) => s.humanDecision === '剔除')
    expect(rejected.length).toBeGreaterThan(15)
    // 至少一半带 reason（DB-03 §1.2 的七大顽疾归类）
    expect(rejected.filter((s) => s.reason && s.reason.length > 0).length).toBeGreaterThan(rejected.length / 3)
  })

  it('含 DB-03 点名的每一类顽疾', () => {
    const all = JSON.stringify(gold)
    expect(all).toContain('[object Object]') // 数据损坏
    expect(all).toContain('招全栈开发工程师') // 招聘
    expect(all).toContain('注册送 $1') // 中转站广告
    expect(all).toContain('eInk Bike Computer') // 领域无关硬件
    expect(all).toContain('2024年10月') // 过期旧闻
    expect(all).toContain('学完即就业') // 卖课
    expect(all).toContain('portfolio') // 个人简历
    expect(all).toContain('Internship') // 学生作业
  })
})

describe('bucketOf：DB-03 的四档口径', () => {
  it('边界值归档正确', () => {
    expect(bucketOf(0)).toBe('trash')
    expect(bucketOf(2)).toBe('trash')
    expect(bucketOf(3)).toBe('low')
    expect(bucketOf(4)).toBe('low')
    expect(bucketOf(5)).toBe('mid')
    expect(bucketOf(6)).toBe('mid')
    expect(bucketOf(7)).toBe('high')
    expect(bucketOf(10)).toBe('high')
  })
})

describe('assessCalibration：理想 reviewer 必须通过', () => {
  it('完全复现人工判定时零问题', () => {
    const r = assessCalibration(gold, perfectVerdicts(gold))
    expect(r.problems).toEqual([])
    expect(isCalibrated(r)).toBe(true)
    expect(r.agreementRate).toBe(1)
    expect(r.distinctBuckets).toBe(4)
    expect(r.missingCount).toBe(0)
  })

  it('formatCalibration 输出人话报告，含分档一致率', () => {
    const text = formatCalibration(assessCalibration(gold, perfectVerdicts(gold)))
    expect(text).toContain('一致率')
    expect(text).toContain('顶档占比')
    expect(text).toContain('通过')
  })
})

describe('assessCalibration：三种失效必须被抓到', () => {
  it('① 打分饱和：全部给 8 分 → 报饱和 + 无区分度', () => {
    // 这正是本项目踩过的坑：连续 18 条推送打分全部触顶 1.00，逐轮均值变化 +0.000
    const r = assessCalibration(gold, gold.map(() => verdict(8)))
    expect(isCalibrated(r)).toBe(false)
    expect(r.saturationRate).toBe(1)
    expect(r.distinctBuckets).toBe(1)
    expect(r.problems.some((p) => p.includes('打分饱和'))).toBe(true)
    expect(r.problems.some((p) => p.includes('无区分度'))).toBe(true)
    // 标准差为 0：比饱和更极端的失效，也必须报
    expect(r.scoreStdDev).toBe(0)
    expect(r.problems.some((p) => p.includes('标准差'))).toBe(true)
  })

  it('② 无区分度：只落两档 → 报 distinctBuckets 不足', () => {
    const r = assessCalibration(
      gold,
      gold.map((s) => verdict(s.humanScore >= 5 ? 7 : 5)),
      { ...DEFAULT_THRESHOLDS, maxSaturationRate: 0.9, minAgreementRate: 0 },
    )
    expect(r.distinctBuckets).toBe(2)
    expect(r.problems.some((p) => p.includes('无区分度'))).toBe(true)
  })

  it('③ 垃圾档放过：高档判得准但 0-2 分全给保留 → 单独报垃圾档一致率', () => {
    // 这是最致命的偏斜：总一致率可能仍不低，但招聘广告与卖课视频堂而皇之进信息流
    // ——正是老张批评的场景。只看总一致率会掩盖它。
    const verdicts = gold.map((s) => (s.humanScore <= 2 ? verdict(8, '保留') : verdict(s.humanScore, s.humanDecision)))
    const r = assessCalibration(gold, verdicts, { ...DEFAULT_THRESHOLDS, minAgreementRate: 0.3 })
    const trash = r.agreementByHumanBucket.trash
    expect(trash.total).toBeGreaterThan(0)
    expect(trash.agreed).toBe(0)
    expect(r.problems.some((p) => p.includes('垃圾档'))).toBe(true)
    expect(r.problems.some((p) => p.includes('最致命的偏斜'))).toBe(true)
    // 不一致清单要能定位到具体条目与 DB-03 的剔除原因
    expect(r.disagreements.some((d) => d.reason && d.reason.includes('招聘'))).toBe(true)
  })

  it('④ 漏答率高：>20% 条目无判定 → 报漏答（端点或 prompt 有问题）', () => {
    const verdicts = perfectVerdicts(gold).map((v, i) => (i % 2 === 0 ? null : v))
    const r = assessCalibration(gold, verdicts, { ...DEFAULT_THRESHOLDS, minAgreementRate: 0 })
    expect(r.missingCount).toBe(Math.ceil(gold.length / 2))
    expect(r.problems.some((p) => p.includes('漏答率'))).toBe(true)
    // 漏答的条目必须出现在不一致清单里，不得静默当成"没意见"
    expect(r.disagreements.filter((d) => d.llmScore === null).length).toBe(r.missingCount)
  })

  it('⑤ 一致率低于下限 → 报不达标', () => {
    // 全部反转人工判定
    const verdicts = gold.map((s) => verdict(10 - s.humanScore, s.humanScore >= 5 ? '剔除' : '保留'))
    const r = assessCalibration(gold, verdicts)
    expect(r.agreementRate).toBeLessThan(DEFAULT_THRESHOLDS.minAgreementRate)
    expect(r.problems.some((p) => p.includes('一致率'))).toBe(true)
  })
})

describe('assessCalibration：契约守卫', () => {
  it('金标集与判定数量不一致时抛错（不得静默截断对齐）', () => {
    expect(() => assessCalibration(gold, perfectVerdicts(gold).slice(0, 5))).toThrow(/数量不一致/)
  })

  it('阈值可配（config/editor.json 的 calibration 段）', () => {
    const cfg = JSON.parse(readFileSync(join(process.cwd(), 'config/editor.json'), 'utf8')) as {
      calibration?: { minDistinctBuckets?: number; maxSaturationRate?: number; minAgreementRate?: number }
    }
    expect(cfg.calibration?.minDistinctBuckets).toBeGreaterThan(0)
    expect(cfg.calibration?.maxSaturationRate).toBeGreaterThan(0)
    expect(cfg.calibration?.minAgreementRate).toBeGreaterThan(0)
    // 自检阈值本身必须比"全给高分"更严：maxSaturationRate < 1 才有意义
    expect(cfg.calibration!.maxSaturationRate!).toBeLessThan(1)
  })

  it('loadGoldStandard 对格式非法的文件抛错，不返回空数组冒充通过', () => {
    expect(() => loadGoldStandard(join(process.cwd(), 'package.json'))).toThrow(/金标集格式非法/)
  })
})
