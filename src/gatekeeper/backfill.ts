import type { ScoredItem } from '../types.js'

/**
 * 候补池：主编终审否决条目后按序递补，杜绝凑数。
 *
 * 为什么必须有候补池（DB-03 §3.4「动态候补水位线」）：终审否决一条就少一条，
 * 若直接从 `maxItems` 截断后的主池发布，产出条数会随否决数缩水；
 * 而若为了凑满条数放宽终审，就等于让闸门形同虚设。候补池是两者的解法：
 * **条数靠递补维持，质量靠终审守住**。
 *
 * 铁律：候补池耗尽就少发。**宁可少于 maxItems 也不得放垃圾进去**——
 * 这正是老张批评的「应付差事」的反面。
 */
export class BackfillPool {
  private readonly items: ScoredItem[]
  private cursor = 0

  /** @param items 被 maxItems 截掉的候选，必须已按分数降序 */
  constructor(items: ScoredItem[]) {
    // 复制一份并强制按分降序：递补顺序必须是「次优」而不是「池里的偶然顺序」
    this.items = [...items].sort((a, b) => b.valueScore - a.valueScore)
  }

  get remaining(): number {
    return this.items.length - this.cursor
  }

  get exhausted(): boolean {
    return this.cursor >= this.items.length
  }

  /** 取下一条候补；耗尽返回 undefined（调用方据此少发，不得回绕重取）。 */
  next(): ScoredItem | undefined {
    if (this.exhausted) return undefined
    return this.items[this.cursor++]
  }

  /** 已消耗的候补数（看板用）。 */
  get consumed(): number {
    return this.cursor
  }
}
