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

/** 生产调用 = 出现在定义文件之外、处于调用位置（`fn(` 或 `obj.fn(`）、且不在注释里。
 *  【偏差记录】工作单原正则排除点号前缀（`[^\\w.$]`），但按工作单自带的实现代码，
 *  recordFeedback/resolveRef/feedbackBySource/saveWeights 全部以 `store.fn(` 形式调用，
 *  守卫将永远无法转绿。此处放宽为 `[^\\w$]`（允许方法调用），保留"有生产调用者"的本意。 */
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

const GUARDED: Array<{ fn: string; definedIn: string; why: string }> = [
  { fn: 'recordFeedback', definedIn: 'memory/store.ts', why: '反馈必须落盘，否则进化无输入' },
  { fn: 'resolveRef', definedIn: 'memory/store.ts', why: 'Telegram 回调的 ref 必须能解析回条目' },
  { fn: 'feedbackBySource', definedIn: 'memory/store.ts', why: '权重更新的输入' },
  { fn: 'saveWeights', definedIn: 'memory/store.ts', why: '权重必须持久化，否则每轮从 config 重置' },
  { fn: 'updateWeights', definedIn: 'memory/evolve.ts', why: '进化步骤本身' },
  { fn: 'refreshWeights', definedIn: 'memory/weights.ts', why: '重算入口必须被编排层与接收端调用' },
  { fn: 'parseCallbackData', definedIn: 'push/telegram.ts', why: '回调数据必须被解析' },
  { fn: 'answerCallbackQuery', definedIn: 'push/telegram.ts', why: '不回应则 Telegram 会重复推送同一回调' },
]

describe('接线守卫：反馈回路必须在生产路径接通', () => {
  for (const g of GUARDED) {
    it(`${g.fn}() 有生产调用者 —— ${g.why}`, () => {
      const callers = productionCallers(g.fn, g.definedIn)
      expect(callers, `${g.fn} 在 src/ 内只有定义、无生产调用者`).not.toHaveLength(0)
    })
  }
})

// ---- A2：启动链守卫（V2 教训：摘掉 pollFeedback 启动行，67 条测试无一会红） ----
import { readFileSync as rf2 } from 'node:fs'

describe('启动链守卫：main 必须把采集与反馈接收真正跑起来', () => {
  const indexSrc = rf2(join(SRC, 'index.ts'), 'utf8')
  const mainBody = indexSrc.slice(indexSrc.indexOf('async function main()'))

  it('main 内必须调用 runOnce（否则采集管线不启动）', () => {
    expect(mainBody).toMatch(/\brunOnce\s*\(/)
  })

  it('main 内必须在常驻分支调用 pollFeedback（否则反馈接收端不启动，按钮按了没人听）', () => {
    expect(mainBody).toMatch(/pollFeedback\s*\(/)
  })

  it('常驻分支的启动条件必须包含 telegram 判定（无 token 不该崩，有 token 不该跳过）', () => {
    expect(mainBody).toMatch(/telegram\s*&&\s*!once/)
  })
})
