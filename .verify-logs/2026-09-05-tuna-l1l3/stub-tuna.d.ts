// Ambient stub for @tuna/* type-only imports used by packages/feeds/normalizers.ts.
// normalizers.ts imports `ContentSource`/`Post` from `@tuna/core` and
// `ContentNormalizer`/`RawContent` from `@tuna/content` — all `import type`,
// so at runtime no @tuna/* module is required. This file lets tsc resolve the
// type-only contracts without pulling in the whole workspace graph (which would
// require pnpm install, forbidden by the task). The structural shape matches the
// real @tuna/core Post / @tuna/content ContentNormalizer exactly, so the
// `implements ContentNormalizer` check and Post literal construction typecheck
// against the same contract the real tuna runtime enforces.

export interface ContentSource {
  id: string;
  kind: string;
  label: string;
}

export interface Post {
  id: string;
  title: string;
  hooks: string[];
  summary: string;
  body: string;
  lang: 'zh' | 'en';
  author: { id: string; name: string; kind: string };
  provenance: string;
  epistemic: string;
  signer: null;
  schemaVersion: number;
  createdAt: string;
  sourceUrl?: string;
}

export interface RawContent {
  [key: string]: unknown;
}

export interface ContentNormalizer {
  readonly source: { id: string; kind: string; label: string };
  canHandle(raw: unknown): raw is RawContent;
  normalize(raw: unknown): Post;
  normalizeAll(candidates: readonly unknown[]): Post[];
}
