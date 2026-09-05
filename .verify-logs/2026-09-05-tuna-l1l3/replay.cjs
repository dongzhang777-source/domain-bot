// DB-11 修复回放：旧构建产出的真实包 → 新渲染/终审/装配链重跑（只读生产数据，产物落 .verify-logs）
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..', '..');
const { gatekeep } = require(path.join(root, 'dist/gatekeeper/index.js'));
const { buildPack, assertPackContract } = require(path.join(root, 'dist/publish/pack.js'));
const src = process.argv[2] || path.join(root, 'outbox/tuna/feed-pack-deepthought-deepthoughtmtobfpmj.json');
const pack = JSON.parse(fs.readFileSync(src, 'utf8'));
const gates = JSON.parse(fs.readFileSync(path.join(root, 'config/gates.json'), 'utf8'));
const persona = JSON.parse(fs.readFileSync(path.join(root, 'config/personas/deepthought.json'), 'utf8'));
const now = Date.now();
const items = pack.posts.map((p, i) => ({
  id: `replay-${i}`,
  title: p.title,
  body: p.body || p.title,
  url: p.sourceUrl,
  source: p.author?.id ?? 'replay',
  publishedAt: Date.parse(p.createdAt),
  valueScore: 0.5,
  reason: '',
  isNew: true,
}));
const r = gatekeep(items, [], {
  persona, gates, now, digestId: 'replay0001',
  knownCanonical: new Set(),
  stopwords: new Set(gates.dedupe?.eventStopwords ?? []),
});
const rejectedBy = r.rejectCounts;
console.log('in:', items.length, '| accepted:', r.published.length, '| rejected:', r.rejected.length);
console.log('rejected by:', JSON.stringify(rejectedBy));
let html = 0, zhWhyOnEn = 0;
for (const p of r.published) {
  if (/<(p|a|div|span|strong|em)\b/i.test(`${p.title}${p.summary}${p.body}${p.hooks.join('')}${p.why}`)) html++;
  if (p.why.match(/[\u4e00-\u9fff]/) && p.lang === 'en') { zhWhyOnEn++; console.log('zh-why-on-en:', p.id); }
}
console.log('accepted-with-html:', html, '| zh-why-on-en:', zhWhyOnEn);
const out = buildPack(r.published, { digestId: `replay${Date.now().toString(36)}`, persona: 'deepthought', personaDisplay: persona.displayName ?? 'AI深度思想', domain: 'ai-llm', generatedAt: now });
assertPackContract(out);
const outPath = path.join(__dirname, `replayed-pack-${r.published.length}.json`);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('packed:', outPath, '| posts:', out.posts.length);
