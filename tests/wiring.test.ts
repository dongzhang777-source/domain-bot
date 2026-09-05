import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')

function srcFiles(dir = SRC): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...srcFiles(p))
    else if (name.endsWith('.ts')) out.push(p)
  }
  return out
}

/**
 * 生产调用 = 出现在定义文件之外、处于调用位置（`fn(` 或 `obj.fn(`）、且不在注释里。
 * 【偏差记录】原正则排除点号前缀（`[^\w.$]`），但按实现代码 store 的方法全部以
 * `store.fn(` 形式调用，守卫将永远无法转绿。此处放宽为 `[^\w$]`（允许方法调用），
 * 保留"有生产调用者"的本意。
 */
function productionCallers(fn: string, definedIn: string): string[] {
  const hits: string[] = []
  const callRe = new RegExp(`(^|[^\\w$])${fn}\\s*\\(`)
  for (const file of srcFiles()) {
    const rel = relative(SRC, file).split('\\').join('/')
    if (rel === definedIn) continue
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
      const code = raw.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '')
      if (callRe.test(code)) hits.push(`${rel}: ${raw.trim()}`)
    }
  }
  return hits
}

/**
 * 必须在生产路径接通的函数。
 *
 * 头号守卫是 `runGates`：DB-04 之前 `src/gates/` 有完整代码却**运行时零调用**
 * （`config/gates.json` 不存在、无调用者），于是 `npm test` 149/149 全绿而用户真机
 * 刷到的 172 条里 32.5% 是垃圾（根仓 DRIFT D-09）。这条守卫就是防它复发。
 */
const GUARDED: Array<{ fn: string; definedIn: string; why: string }> = [
  { fn: 'runGates', definedIn: 'gates/index.ts', why: '三层硬闸门必须在生产路径被调用，否则闸门只是架子上的工具（DRIFT D-09 的根因）' },
  { fn: 'capEvents', definedIn: 'gates/fingerprint.ts', why: '事件聚合必须真的跑，否则同事件刷屏' },
  { fn: 'runPipeline', definedIn: 'pipeline.ts', why: 'CLI 必须真的调用产线编排，否则 run 命令空转' },
  { fn: 'gatekeep', definedIn: 'gatekeeper/index.ts', why: '主编终审必须在发布前跑，否则十条硬断言形同虚设' },
  { fn: 'renderPost', definedIn: 'gatekeeper/render.ts', why: '渲染必须在终审之前（机械截断/碎片钩子/浮点回显只在渲染后存在）' },
  { fn: 'buildPack', definedIn: 'publish/pack.ts', why: '内容包必须经装配与契约校验，不得手工拷贝' },
  { fn: 'appendFingerprints', definedIn: 'publish/pack.ts', why: '发布后必须写指纹库，否则下一轮/另一产线会重发同一内容' },
  { fn: 'refreshWeights', definedIn: 'memory/weights.ts', why: '源权重重算入口必须被编排层调用' },
  { fn: 'feedbackBySource', definedIn: 'memory/store.ts', why: '权重更新的输入（由 refreshWeights 调用，反馈为空时退回首轮先验）' },
  { fn: 'updateWeights', definedIn: 'memory/evolve.ts', why: '进化步骤本身' },
  { fn: 'saveWeights', definedIn: 'memory/store.ts', why: '权重必须持久化，否则每轮从 config 重置' },
  { fn: 'observeRound', definedIn: 'memory/observe.ts', why: '观测必须落盘，否则质量随轮次的变化无读数' },
  { fn: 'collectStage', definedIn: 'pipeline.ts', why: '分段命令必须复用产线的采集段，不得在 cli 里另写一份（两条采集逻辑必然漂移）' },
  { fn: 'restoreStage', definedIn: 'staging.ts', why: '分段作业必须从快照还原而不是重跑采集，否则 collect 的落盘就没意义' },
  { fn: 'editorialTargetsOf', definedIn: 'staging.ts', why: 'edit/review/publish 三段与整链 run 必须共用同一个作用域口径，否则 targetIds 校验成了摆设' },
]

describe('接线守卫：关键函数必须在生产路径接通', () => {
  for (const g of GUARDED) {
    it(`${g.fn}() 有生产调用者 —— ${g.why}`, () => {
      const callers = productionCallers(g.fn, g.definedIn)
      expect(callers, `${g.fn} 在 src/ 内只有定义、无生产调用者`).not.toHaveLength(0)
    })
  }
})

/**
 * 已知断开、显式挂账的函数。
 *
 * 这四个的唯一生产调用方曾是 `src/feedback/receiver.ts`（Telegram 长轮询回调），
 * 已随老张 2026-09-04 裁决「砍 Telegram，新建 tuna 行为回流通道」而删除。
 *
 * **不得静默删掉本守卫**：删了这笔欠账就隐形，读者会以为自进化在跑
 * （实测 `memory/weights.json` 早已是空的 `{"weights":{}}`，而文档一直宣称「自进化」）。
 * DB-06 的 `src/ingest/tuna-signals.ts` 落地后，把这四项移回上面的 GUARDED。
 *
 * 注：`feedbackBySource` **不在本清单**——它由 `memory/weights.ts` 的 `refreshWeights`
 * 调用，属于接通的（反馈为空时退回首轮先验），已列入 GUARDED。
 */
const KNOWN_DISCONNECTED: Array<{ fn: string; definedIn: string; until: string }> = [
  // 2026-09-04：recordView / recordEngagement / recordFeedback / resolveRef 已由
  // src/ingest/tuna-signals.ts 接通，移回 GUARDED（见上组用例）。本清单现为空——
  // 保留结构是因为它是「欠账不得隐形」的护栏：将来再有函数断开，登记到这里而不是删断言。
]

describe('已知断开：自进化反馈回路待 DB-06 接通（不得静默删除本组守卫）', () => {
  for (const g of KNOWN_DISCONNECTED) {
    it(`${g.fn}() 当前无生产调用者 —— 挂账至 ${g.until}`, () => {
      const callers = productionCallers(g.fn, g.definedIn)
      // 断言"断开"而不是删掉断言：若将来有人接通了却没把本项移回 GUARDED，
      // 这条会变红，提醒同步守卫清单——正是本仓「文档声明 > 落地」毛病的反向护栏。
      expect(callers, `${g.fn} 已被接通，请把本项移回 GUARDED 清单`).toHaveLength(0)
    })
  }

  it('看板的 selfEvolutionActive 必须由真实信号存量算出，不得硬编码', () => {
    const board = readFileSync(join(SRC, 'gatekeeper/board.ts'), 'utf8')
    // 写死 false 会在回流接通后变成假话；写死 true 则在断开时掩盖欠账。
    // 两头都是本项一直犯的「文档声明 > 落地」毛病，故断言它是算出来的。
    expect(board).not.toMatch(/selfEvolutionActive:\s*(false|true)\s*,/)
    expect(board).toContain('signalCounts.views + signalCounts.engagements + signalCounts.feedback > 0')
    expect(board).toContain('Telegram 链路已退役')
    const pipeline = readFileSync(join(SRC, 'pipeline.ts'), 'utf8')
    expect(pipeline).toContain('store.viewCount()')
    expect(pipeline).toContain('store.engagementAll()')
  })

  it('回流接收端接通后，views/engagements/feedback 必须有生产调用者', () => {
    // DB-06 的接收端 src/ingest/tuna-signals.ts 已落地，故这四个函数从「已知断开」移回接通清单。
    // 若将来有人再删掉 ingest，这条会红——欠账不会隐形。
    for (const fn of ['recordView', 'recordEngagement', 'recordFeedback', 'resolveRef']) {
      const callers = productionCallers(fn, 'memory/store.ts')
      expect(callers, `${fn} 又断开了（ingest 被删？）`).not.toHaveLength(0)
      expect(callers.some((c) => c.startsWith('ingest/')), `${fn} 的调用方应含 ingest/`).toBe(true)
    }
  })
})

describe('启动链守卫：CLI 必须把闸门、聚合、终审真正串起来', () => {
  const pipelineSrc = readFileSync(join(SRC, 'pipeline.ts'), 'utf8')
  const cliSrc = readFileSync(join(SRC, 'cli.ts'), 'utf8')

  it('pipeline 必须调用 runGates，且 compileErrors 非空即抛错（配置写错不得静默）', () => {
    expect(pipelineSrc).toMatch(/\brunGates\s*\(/)
    expect(pipelineSrc).toMatch(/compileErrors\.length > 0/)
    expect(pipelineSrc).toMatch(/throw new Error/)
  })

  it('事件聚合必须在终审之前，且 pipeline 不得提前按 maxItems 截断候选集', () => {
    const capAt = pipelineSrc.indexOf('capEvents(')
    const gkAt = pipelineSrc.indexOf('gatekeep(selected')
    expect(capAt, 'capEvents 必须在产线内被调用').toBeGreaterThan(-1)
    expect(gkAt, 'gatekeep 必须以 selected 为入参被调用').toBeGreaterThan(-1)
    // 这条是结构性守卫：DB-03 §2.5「缺失主题编辑」与旧 index.ts 先截断后聚类的顺序缺陷
    expect(capAt, 'capEvents 必须出现在 gatekeep 之前').toBeLessThan(gkAt)
    // 2026-09-04 真跑实测：`selected = ordered.slice(0, maxItems)` 会把低分的同事件条目
    // 直接挡在终审门外，于是「每事件最多 maxPerEvent 条」的多样性选择根本没有发生机会
    // （实测 deepthought 1184 采集 → 126 过闸 → 提前截断到 6 条时全是同一事件）。
    // 截断只能由 gatekeep 的 target 在扫描循环里做，故此处断言 selected 就是 ordered 全量。
    expect(pipelineSrc, 'selected 必须是事件降权后的全量 ordered，不得在此截断').toMatch(
      /^\s*const selected = ordered\s*$/m,
    )
    expect(pipelineSrc, '产线内不得再出现按 maxItems 的容量截断').not.toMatch(
      /\.slice\(0,\s*opts\.persona\.maxItems\s*\)/,
    )
  })

  it('渲染必须在终审之前（机械截断/碎片钩子/浮点回显只在渲染后存在）', () => {
    const gk = readFileSync(join(SRC, 'gatekeeper/index.ts'), 'utf8')
    const renderAt = gk.indexOf('renderOne(item')
    const assertAt = gk.indexOf('runAssertions(rendered')
    expect(renderAt).toBeGreaterThan(-1)
    expect(assertAt).toBeGreaterThan(-1)
    expect(renderAt).toBeLessThan(assertAt)
  })

  it('cli 必须把指纹库读入产线、并在非 dry-run 时写回（跨产线共享才成立）', () => {
    expect(cliSrc).toMatch(/loadFingerprints\s*\(/)
    expect(cliSrc).toMatch(/knownCanonical/)
    expect(cliSrc).toMatch(/appendFingerprints\s*\(/)
    // dry-run 分支必须在写盘之前 continue，否则试跑会污染指纹库
    expect(cliSrc.indexOf('dry-run：不落盘')).toBeLessThan(cliSrc.indexOf('appendFingerprints('))
  })

  it('单实例锁必须包在 try/finally 里（B3 教训：抛错残留锁文件）', () => {
    expect(cliSrc).toMatch(/acquireLock\s*\(/)
    expect(cliSrc).toMatch(/finally\s*\{[\s\S]{0,80}releaseLock/)
  })

  it('Telegram 链路已彻底退役：src/ 内不得再有推送或长轮询实现', () => {
    for (const gone of ['push/telegram.ts', 'feedback/receiver.ts', 'push/file.ts', 'push/tuna.ts']) {
      expect(srcFiles().some((f) => f.endsWith(gone)), `${gone} 应已删除`).toBe(false)
    }
    // sendDigestTelegram / pollFeedback / pushFile 不得在任何源文件里被调用
    for (const fn of ['sendDigestTelegram', 'pollFeedback', 'pushFile']) {
      const hits = srcFiles().filter((f) => {
        const code = readFileSync(f, 'utf8')
          .split('\n')
          .map((l) => l.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''))
          .join('\n')
        return new RegExp(`(^|[^\\w$])${fn}\\s*\\(`).test(code)
      })
      expect(hits, `${fn} 仍有调用点：${hits.join(', ')}`).toEqual([])
    }
  })
})

describe('单一发布路径守卫：不得再长出第二条产线', () => {
  const cliSrc = readFileSync(join(SRC, 'cli.ts'), 'utf8')

  /**
   * 三道影子工序（`/tmp/edit.mjs` → 人肉终审 → 人工拷贝进 tuna）的成因就是
   * 「同一件事有两个实现」。分段命令上线后这个风险变高：`publish` 很容易
   * 就地再写一遍 buildPack / appendFingerprints。故断言它们在 cli.ts 里各只有
   * **一个调用点**（就在 `emitPublished` 内；import 行不带括号，不计入），
   * `run` 与 `publish` 共用同一段落盘逻辑。
   */
  it('buildPack / writePack / appendFingerprints / writeBoard 在 cli.ts 内各只有一个调用点', () => {
    for (const fn of ['buildPack(', 'writePack(', 'appendFingerprints(', 'writeBoard(']) {
      const occurrences = cliSrc.split(fn).length - 1
      expect(occurrences, `${fn} 在 cli.ts 内有 ${occurrences} 个调用点，应只有 emitPublished 内一处`).toBe(1)
    }
  })

  it('runCommand 与 publishCommand 都必须走 emitPublished（不得各自落盘）', () => {
    const occurrences = cliSrc.split('emitPublished(').length - 1
    // 定义 1 次 + runCommand 1 次 + publishCommand 1 次
    expect(occurrences, `emitPublished 应被两条路径共用（定义+两个调用），实际 ${occurrences} 处`).toBe(3)
  })

  it('宽通道判定（DB-08）只有一个注入工厂：makeRecallJudge 定义 1 次、run/collect 各注入 1 次', () => {
    const occurrences = cliSrc.split('makeRecallJudge(').length - 1
    // 定义 1 次 + runCommand 1 次 + collectCommand 1 次；publish 走 staged 快照不注入
    expect(occurrences, `makeRecallJudge 应为「定义+两个调用」共 3 处，实际 ${occurrences} 处`).toBe(3)
    // 管线本体不得直接感知 recall 的 LLM 实现（判定只经回调注入，保持可测与分段契约）
    const pipelineSrc = readFileSync(join(SRC, 'pipeline.ts'), 'utf8')
    expect(pipelineSrc).not.toMatch(/EditorialProvider|judgeRecallPool|calibrateRecall/)
  })

  it('publishCommand 不得自己调 gatekeep / runGates（终审属于 finalizeStage）', () => {
    const publishBody = cliSrc.slice(cliSrc.indexOf('export async function publishCommand'))
    expect(publishBody.indexOf('gatekeep(')).toBe(-1)
    expect(publishBody.indexOf('runGates(')).toBe(-1)
    // 它只能走 runPipeline({ staged })——这是与整链共用同一段 finalizeStage 的唯一入口
    expect(publishBody).toMatch(/runPipeline\(\{[\s\S]{0,400}staged: snapshot/)
  })

  it('collectCommand 不得走整链（否则 collect+publish 会双重归档）', () => {
    const collectBody = cliSrc.slice(
      cliSrc.indexOf('export async function collectCommand'),
      cliSrc.indexOf('export interface StageRunOptions'),
    )
    expect(collectBody).toMatch(/collectStage\(/)
    expect(collectBody.indexOf('runPipeline('), 'collect 不得调整链 runPipeline').toBe(-1)
  })
})
