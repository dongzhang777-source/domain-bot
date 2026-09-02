/**
 * 源 URL 模板解析：`{{since_days:N}}` → 距今 N 天的日期（UTC，YYYY-MM-DD）。
 * 修 A2/GitHub 硬编码日期：`created:>2026-08-25` 这类写死的窗口在探针期间不滑动，
 * 源会退化成静态名单但权重照常学它。
 */
export function resolveSourceUrl(url: string, now: number): string {
  return url.replace(/\{\{since_days:(\d+)\}\}/g, (_, days: string) =>
    new Date(now - Number(days) * 86_400_000).toISOString().slice(0, 10),
  )
}
