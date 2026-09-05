/**
 * 兼容入口。
 *
 * 旧 `runOnce` / `startBot` / `printBootBanner`（每日 6 条摘要 + 每源均摊配额 +
 * 常驻 Telegram 轮询）已随老张 2026-09-04 裁决退役：
 * 「只保留批产线，砍掉每日摘要」「砍 Telegram，新建 tuna 行为回流通道」。
 *
 * 产线编排见 `src/pipeline.ts`，命令入口见 `src/cli.ts`。
 * 本文件只保留转发，使 `node dist/index.js` 与 `npm start` 的旧调用方式不至于静默失效——
 * 静默失效比报错更危险（会以为跑了，其实什么都没发生）。
 */
import { main } from './cli.js'

export { main as cliMain }
export { runPipeline, type PipelineOptions, type PipelineResult } from './pipeline.js'

if (process.argv[1] && /index\.(js|ts)$/.test(process.argv[1])) {
  // 旧用法 `node dist/index.js --once`：--once 已无对应语义（批产本就是一次性作业），
  // 显式提示而不是默默忽略，避免使用者以为还在跑日推节奏。
  if (process.argv.includes('--once')) {
    console.warn('[index] --once 已随每日摘要退役；批产本身就是一次性作业，直接 `npm start` 即可。')
  }
  const args = process.argv.slice(2).filter((a) => a !== '--once')
  main(args.length > 0 ? args : ['run', '--persona=all']).then(
    (code) => {
      if (code !== 0) process.exitCode = code
    },
    (err) => {
      console.error(err)
      process.exitCode = 1
    },
  )
}
