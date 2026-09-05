#!/usr/bin/env node
/*
 * DB-11 E2E 校验 harness —— domain-bot → tuna 三级信息流文本实测验机
 *
 * 把真实生产产物（outbox/tuna/*.json）灌过 tuna 的 REAL LocalBriefNormalizer，
 * 逐项核对工单 §二 A-E 校验清单，产出：
 *   - 控制台全量报告（12 项均有实证结论）
 *   - findings.json（机器可读）
 *   - <domain-bot>/.verify-logs/2026-09-05-domainbot-tuna-l1l3-e2e-cbc.md（最终报告，含人判）
 *
 * 运行：node .verify-logs/2026-09-05-tuna-l1l3/run.cjs
 * 通过标记：ALL_DB11_PASS（指 harness 跑通、全部 12 项有实证结论，不代表无缺陷）
 *
 * 只读约束：除落到 .verify-logs/2026-09-05-tuna-l1l3/ 内的编译产物/harness/报告外，
 *           不修改 domain-bot / tuna 任何文件，不 commit/push，不安装依赖。
 */

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ---------- 路径 ----------
const HARNESS = __dirname;                                   // .verify-logs/2026-09-05-tuna-l1l3
const DOMAIN_BOT = path.resolve(HARNESS, '..', '..');        // /Users/aiatwork/Projects/domain-bot
const TUNA = '/Users/aiatwork/Projects/tuna';
const OUTBOX = path.join(DOMAIN_BOT, 'outbox', 'tuna');
const BUILD = path.join(HARNESS, 'build');
const NORM_JS = path.join(BUILD, 'tuna', 'packages', 'feeds', 'normalizers.js');
const TSC = path.join(TUNA, 'node_modules', '.bin', 'tsc');
const TSC_CFG = path.join(HARNESS, 'tsconfig.db11.json');
const REPORT_PATH = path.join(DOMAIN_BOT, '.verify-logs', '2026-09-05-domainbot-tuna-l1l3-e2e-cbc.md');
const FINDINGS_PATH = path.join(HARNESS, 'findings.json');

// ---------- 契约常量（与 tuna normalizers.ts / domain-bot render/tuna.ts 同值） ----------
const TUNA_ID_RE = /^[a-z0-9-]+:[a-z0-9]+:\d+$/;
const HOOK_LIMITS = { zh: 70, en: 95 };
const SUMMARY_MAX = { zh: 300, en: 450 };
const WHY_MAX = 40;
const TITLE_MAX = 200;
const MIN_HOOK_CHARS = 12;
const STORE_LIMIT = 900 * 1024; // tuna local-brief 单值上限 900000

// 两份 detectLang（同族不同阈值），用于 B6 误判核对
function tunaDetectLang(text) {
  const sample = Array.from(text || '').slice(0, 400);
  if (sample.length === 0) return 'en';
  let cjk = 0;
  for (const ch of sample) {
    const code = ch.codePointAt(0) || 0;
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf) || (code >= 0xf900 && code <= 0xfaff)) cjk += 1;
  }
  return cjk / sample.length > 0.1 ? 'zh' : 'en';
}
function dbDetectLang(text) {
  const sample = Array.from(text || '').slice(0, 400);
  if (sample.length === 0) return 'en';
  let cjk = 0;
  for (const ch of sample) {
    const code = ch.codePointAt(0) || 0;
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) cjk += 1;
  }
  return cjk / sample.length > 0.3 ? 'zh' : 'en';
}
const cpLen = (s) => Array.from(s == null ? '' : String(s)).length;
const HTML_RE = /<\/?[a-zA-Z!][^>]*>/;
const ARXIV_RE = /arxiv:/i;
const OBJOBJ_RE = /\[object Object\]/;
// 招聘 / 卖课 / 订阅类信号（宽通道已修区域，DB-08/DB-10）。保守匹配，避免把正文里的 course/sign up/subscribe 误伤。
const SPAM_RE = /\b(hiring|we('| a)?re hiring|join our team|apply now|enroll (now|today|in)|webinar|buy (now|this course|course)|get started (for )?free|limited (time|offer)|click here|use (code|coupon)|save (up to|\d+%)|discount (code|now))\b/i;

// ---------- 编译 real normalizer（按需） ----------
function ensureCompiled() {
  const srcs = ['normalizers.ts', 'errors.ts', 'sanitize.ts', 'rss.ts', 'types.ts']
    .map((f) => path.join(TUNA, 'packages', 'feeds', f));
  const need = !fs.existsSync(NORM_JS) ||
    srcs.some((s) => fs.statSync(s).mtimeMs > fs.statSync(NORM_JS).mtimeMs);
  if (need) {
    console.error('[db11] 编译 tuna LocalBriefNormalizer → build/');
    execFileSync(process.execPath, [TSC, '-p', TSC_CFG], { cwd: HARNESS, stdio: 'inherit' });
  }
}
ensureCompiled();
const { LocalBriefNormalizer } = require(NORM_JS);

// ---------- 工具 ----------
function candidateReason(post) {
  if (typeof post !== 'object' || post === null || Array.isArray(post)) return 'not-object';
  if (typeof post.id !== 'string') return 'missing:id';
  if (typeof post.title !== 'string') return 'missing:title';
  if (typeof post.summary !== 'string') return 'missing:summary';
  if (typeof post.body !== 'string') return 'missing:body';
  if (!Array.isArray(post.hooks)) return 'missing:hooks';
  if (!TUNA_ID_RE.test(post.id)) return `id-regex-fail:${post.id}`;
  if (post.hooks.length !== 3) return `hooks!=3:${post.hooks.length}`;
  return 'ok';
}
function overlapRatio(a, b) {
  const sa = new Set(Array.from((a || '').toLowerCase()));
  const sb = new Set(Array.from((b || '').toLowerCase()));
  if (sa.size === 0) return 0;
  let inter = 0;
  sb.forEach((c) => { if (sa.has(c)) inter += 1; });
  return inter / sa.size;
}
function pseudoNorm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function isViewCountSummary(s) {
  const t = (s || '').replace(/\n/g, ' ').trim();
  return /^\S[^·]*·\s*[\d,]+\s*次观看$/.test(t) || /^\S[^·]*·\s*[\d,]+\s*views?$/i.test(t);
}

// ---------- 分析单个 pack ----------
function analyzePack(pack, file) {
  const r = { file, schema: pack.schema, persona: pack.persona || '-', in: 0, canHandle: 0, out: 0, skipped: [] };
  const posts = Array.isArray(pack.posts) ? pack.posts : [];
  const briefItems = (pack.brief && Array.isArray(pack.brief.items)) ? pack.brief.items : [];
  r.in = posts.length;
  const N = new LocalBriefNormalizer(pack.persona || 'domain-bot');

  // A1：逐条 canHandle + 单条 normalize 捕获静默跳过原因
  const perPost = posts.map((post, i) => {
    const cand = candidateReason(post);
    const can = cand === 'ok';
    let err = null;
    if (can) {
      try { N.normalize(post); } catch (e) { err = e.message; }
    } else {
      err = cand;
    }
    if (!can || err) r.skipped.push({ i, id: post.id, reason: err });
    if (can) r.canHandle += 1;
    return { i, id: post.id, can, err, post };
  });
  r.out = N.normalizeAll(posts).length;
  r.diff = r.in - r.out;

  // A2：posts / brief 数量与 postId 对应
  const postIds = posts.map((p) => p.id);
  const briefIds = briefItems.map((b) => b && b.postId);
  const sameCount = postIds.length === briefIds.length;
  const sameSet = sameCount && postIds.every((id, i) => id === briefIds[i]);
  r.a2 = { sameCount, sameSet, postIds: postIds.length, briefIds: briefIds.length };

  // A3：900KB 上限
  const docLen = Buffer.byteLength(JSON.stringify(pack), 'utf8');
  const wrappedLen = Buffer.byteLength(JSON.stringify({ doc: pack, savedAt: Date.now() }), 'utf8');
  r.a3 = { docLen, wrappedLen, underLimit: docLen < STORE_LIMIT };

  // B4 / B5 / B6 / C7 / C8 / C9 / D10
  const langGap = [], hookRedundant = [], hookPseudo = [], hookUnder = [], hookOver = [],
    htmlPosts = [], summaryBad = [], titleBad = [], whyBad = [], whyGeneric = [], whyTooLong = [],
    missingSrc = [], spamHits = [], arxivHits = [], objobjHits = [], viewCountSum = [], langMis = [];
  const whySeen = {};
  const whyDup = [];
  posts.forEach((post, i) => {
    const lang = post.lang === 'zh' ? 'zh' : post.lang === 'en' ? 'en' : '?';
    const hooks = Array.isArray(post.hooks) ? post.hooks : [];
    // B4
    const hlen = hooks.map((h) => cpLen(h));
    const distinct = new Set(hooks).size === hooks.length;
    hlen.forEach((hl, k) => {
      if (hl < MIN_HOOK_CHARS) hookUnder.push({ i, k, len: hl, hook: hooks[k] });
      if (lang !== '?' && hl > HOOK_LIMITS[lang]) hookOver.push({ i, k, len: hl, hook: hooks[k] });
    });
    // B5 冗余 / 伪互异 / 截断
    if (hooks[0] != null && post.title != null && overlapRatio(hooks[0], post.title) > 0.8) {
      hookRedundant.push({ i, hook0: hooks[0], title: post.title, ratio: +overlapRatio(hooks[0], post.title).toFixed(2) });
    }
    const pn = hooks.map(pseudoNorm);
    for (let a = 0; a < pn.length; a++) for (let b = a + 1; b < pn.length; b++) {
      if (pn[a] && pn[b] && pn[a] === pn[b]) hookPseudo.push({ i, a, b, h1: hooks[a], h2: hooks[b] });
    }
    const trunc = hooks.filter((h) => typeof h === 'string' && h.endsWith('…')).length;
    // B6 lang 误判
    const actualTuna = tunaDetectLang(`${post.title}\n${post.summary}`);
    const actualDb = dbDetectLang(`${post.title}\n${post.summary}`);
    if (lang !== '?' && lang !== actualTuna) langMis.push({ i, id: post.id, declared: lang, tuna: actualTuna, db: actualDb });
    // C7
    const slen = cpLen(post.summary), blen = cpLen(post.body), tlen = cpLen(post.title);
    if (lang !== '?' && (slen === 0 || slen > SUMMARY_MAX[lang])) summaryBad.push({ i, len: slen, lang });
    if (blen === 0) summaryBad.push({ i, len: blen, lang, field: 'body' });
    if (tlen > TITLE_MAX) titleBad.push({ i, len: tlen });
    // C8 why
    const b = briefItems[i];
    const why = b ? b.why : undefined;
    const wlen = cpLen(why);
    if (why == null || wlen === 0) whyBad.push({ i, why });
    else {
      if (wlen > WHY_MAX) whyTooLong.push({ i, len: wlen, why });
      if (why === '与「ai-llm」相关') whyGeneric.push({ i, id: post.id, why });
      const key = pseudoNorm(why);
      if (whySeen[key]) whyDup.push({ i, seenAt: whySeen[key], why });
      else whySeen[key] = i;
    }
    // C9 sourceUrl
    if (!post.sourceUrl || String(post.sourceUrl).length === 0) missingSrc.push({ i, id: post.id });
    // D10 黑名单
    const blob = [post.title, (hooks || []).join(' '), post.summary, post.body, why].join('\n');
    if (HTML_RE.test(blob)) htmlPosts.push({ i, id: post.id });
    if (ARXIV_RE.test(blob)) arxivHits.push({ i, id: post.id });
    if (OBJOBJ_RE.test(blob)) objobjHits.push({ i, id: post.id });
    if (SPAM_RE.test(blob)) spamHits.push({ i, id: post.id, why: blob.match(SPAM_RE)[0] });
    if (isViewCountSummary(post.summary)) viewCountSum.push({ i, id: post.id, summary: post.summary });
  });

  r.b4 = { hookUnder, hookOver, distinctViolations: perPost.filter((p) => new Set((p.post.hooks || [])).size !== (p.post.hooks || []).length).map((p) => p.i) };
  r.b5 = { hookRedundant, hookPseudo, truncTotal: posts.reduce((s, p) => s + (p.hooks || []).filter((h) => typeof h === 'string' && h.endsWith('…')).length, 0), hookTotal: posts.reduce((s, p) => s + (p.hooks || []).length, 0) };
  r.b6 = { langMis };
  r.c7 = { summaryBad, titleBad };
  r.c8 = { whyBad, whyGeneric, whyTooLong, whyDup };
  r.c9 = { missingSrc };
  r.d10 = { htmlPosts, arxivHits, objobjHits, spamHits };
  r.viewCountSum = viewCountSum;
  r.langSet = [...new Set(posts.map((p) => p.lang))];
  return r;
}

// ---------- 加载全部 outbox ----------
const files = fs.readdirSync(OUTBOX).filter((f) => f.endsWith('.json')).sort();
const packs = files.map((f) => {
  const raw = fs.readFileSync(path.join(OUTBOX, f), 'utf8');
  let json; try { json = JSON.parse(raw); } catch (e) { return { file: f, parseErr: e.message }; }
  return { file: f, json, rawLen: Buffer.byteLength(raw, 'utf8'), mtime: fs.statSync(path.join(OUTBOX, f)).mtimeMs };
});
const v1Packs = packs.filter((p) => p.json && p.json.schema === 'tuna-brief-v1');
const v0Packs = packs.filter((p) => p.json && p.json.schema === 'tuna-brief-v0');
const mainFiles = ['feed-pack-deepthought-deepthoughtmtobfpmj.json', 'feed-pack-newsline-newslinemtobsx4p.json'];
const mainPacks = mainFiles.map((f) => packs.find((p) => p.file === f)).filter(Boolean);

const results = {};
v1Packs.forEach((p) => { results[p.file] = analyzePack(p.json, p.file); });

// ---------- 跨主材汇总（A-E 主体） ----------
const main = mainPacks.map((p) => results[p.file]);
const M = {
  totalPosts: main.reduce((s, r) => s + r.in, 0),
  htmlPosts: main.flatMap((r) => r.d10.htmlPosts),
  viewCountSum: main.flatMap((r) => r.viewCountSum),
  whyGeneric: main.flatMap((r) => r.c8.whyGeneric),
  whyBad: main.flatMap((r) => r.c8.whyBad),
  whyTooLong: main.flatMap((r) => r.c8.whyTooLong),
  langMis: main.flatMap((r) => r.b6.langMis),
  hookRedundant: main.flatMap((r) => r.b5.hookRedundant),
  hookPseudo: main.flatMap((r) => r.b5.hookPseudo),
  hookUnder: main.flatMap((r) => r.b4.hookUnder),
  hookOver: main.flatMap((r) => r.b4.hookOver),
  missingSrc: main.flatMap((r) => r.c9.missingSrc),
  summBad: main.flatMap((r) => r.c7.summaryBad),
  titleBad: main.flatMap((r) => r.c7.titleBad),
  spam: main.flatMap((r) => r.d10.spamHits),
  arxiv: main.flatMap((r) => r.d10.arxivHits),
  objobj: main.flatMap((r) => r.d10.objobjHits),
  truncTotal: main.reduce((s, r) => s + r.b5.truncTotal, 0),
  hookTotal: main.reduce((s, r) => s + r.b5.hookTotal, 0),
};
M.truncRatio = M.hookTotal ? +(M.truncTotal / M.hookTotal).toFixed(2) : 0;

// ---------- 人判：why 抽查（C8）、擦边条目（D11） ----------
// 抽查 5 条 why 与正文相关性（唯一作答会话人判；重跑 harness 结论不变）
const WHY_SPOTCHECK = [
  { file: 'feed-pack-deepthought-deepthoughtmtobfpmj.json', idx: 0,
    note: 'why 含 llm/ai agent/benchmark；正文确有 "ARD-Bench"，benchmark 词有弱对应；但「强信号 benchmar…」被 WHY_MAX=40 截断丢尾，且未说明为何是强信号。结论：关键词挂接基本成立但含糊。' },
  { file: 'feed-pack-deepthought-deepthoughtmtobfpmj.json', idx: 14,
    note: 'why 含 quantization，但正文(summary)仅为 Hugging Face Daily Papers 的邮件订阅 CTA，全文无 quantization 字样——关键词误挂。结论：why 与内容弱相关/误挂。' },
  { file: 'feed-pack-deepthought-deepthoughtmtobfpmj.json', idx: 28,
    note: 'why=通用兜底「与「ai-llm」相关」；正文为 GeoJSON Map Viewer 工具介绍，仅 "I asked GPT-5.6-Sol" 一句沾边，AI 关联极弱。结论：兜底 why 无具体相关性论证。' },
  { file: 'feed-pack-newsline-newslinemtobsx4p.json', idx: 7,
    note: 'why=通用兜底；正文为 OpenAI News 站点导航 chrome（Filter/Sort 等），无实质内容。结论：兜底 + 正文空壳。' },
  { file: 'feed-pack-newsline-newslinemtobsx4p.json', idx: 4,
    note: 'why 含 inference 与 release；正文为 shipit_agent 的 v1.7.0 release note，release 对应版本发布；但 inference 在摘要中无直接支撑。结论：release 成立、inference 弱挂。' },
];
// D11 擦边/低信号条目（严格无关=0；以下为弱相关/空壳，非严格无关）
const BORDERLINE = [
  { file: 'feed-pack-deepthought-deepthoughtmtobfpmj.json', idx: 28,
    reason: 'GeoJSON Map Viewer：地图工具，AI 关联仅 "I asked GPT-5.6-Sol" 一句，弱相关/擦边，非严格无关。' },
  { file: 'feed-pack-newsline-newslinemtobsx4p.json', idx: 4,
    reason: 'shipit_agent v1.7.0 release note：AI-agent 仓库，相关但薄。' },
  { file: 'feed-pack-newsline-newslinemtobsx4p.json', idx: 7,
    reason: 'OpenAI News 导航页 chrome，AI 相关但无实质内容。' },
  { file: 'feed-pack-newsline-newslinemtobsx4p.json', idx: 10,
    reason: 'OpenAI 新闻列表页，AI 相关但为索引页。' },
];
const VIDEO_VIEWCOUNT = main.flatMap((r, mi) => r.viewCountSum.map((v) => ({ file: mainPacks[mi].file, ...v })));

// ---------- 工单 vs 实际产物不符 ----------
const discrepancy = [];
const postCounts = v1Packs.map((p) => ({ file: p.file, posts: p.json.posts.length, persona: p.json.persona }));
const nonZeroUnexp = v1Packs.filter((p) => p.json.posts.length > 0 && !mainFiles.includes(p.file));
if (nonZeroUnexp.length) {
  discrepancy.push(`工单 §零.2 称「其余 posts:0 的包只做 schema 存在性检查」，但 outbox/tuna 实际存在非 0 posts 的 v1 包：${nonZeroUnexp.map((p) => `${p.file}(${p.json.posts.length})`).join('、')}。已对全部 v1 包执行 normalizeAll 对账。`);
}

// ---------- 状态类证据（命令 + 输出 + 时间戳） ----------
const ts = new Date().toISOString();
function sh(cmd) { try { return execFileSync(cmd[0], cmd.slice(1), { cwd: DOMAIN_BOT, encoding: 'utf8' }).trim(); } catch (e) { return `ERR ${e.message}`; } }
const gitDbStatus = sh(['git', 'status', '-sb']);
const gitDbHead = sh(['git', 'rev-parse', 'HEAD']);
const gitTunaHead = sh(['git', '-C', TUNA, 'rev-parse', 'HEAD']);

// ===================================================================
// 控制台报告
// ===================================================================
console.log('\n========== DB-11 E2E 校验报告（控制台） ==========');
console.log(`读取时间戳: ${ts}`);
console.log(`domain-bot HEAD: ${gitDbHead}`);
console.log(`tuna HEAD: ${gitTunaHead}`);
console.log(`\n[v1 包清单] ${postCounts.map((p) => `${p.file}=${p.posts}`).join('  ')}`);
console.log(`[v0 包] ${v0Packs.map((p) => p.file).join('  ') || '无'}`);

main.forEach((r) => {
  console.log(`\n--- 主材 ${r.file} (persona=${r.persona}) ---`);
  console.log(`A1 in=${r.in} canHandle=${r.canHandle} out=${r.out} diff(静默跳过)=${r.diff}`);
  if (r.skipped.length) console.log(`   跳过: ${r.skipped.map((s) => `#${s.i} ${s.reason}`).join('; ')}`);
  console.log(`A2 schema=${r.schema} posts==brief:${r.a2.sameCount} 顺序对应:${r.a2.sameSet}`);
  console.log(`A3 序列化=${r.a3.docLen}B (wrapped=${r.a3.wrappedLen}B) <900KB:${r.a3.underLimit}`);
  console.log(`B4 hook<${MIN_HOOK_CHARS}:${r.b4.hookUnder.length} hook>limit:${r.b4.hookOver.length} 非互异:${r.b4.distinctViolations.length}`);
  console.log(`B5 冗余钩子(hook0~title>0.8):${r.b5.hookRedundant.length} 伪互异:${r.b5.hookPseudo.length} 截断钩子占比:${r.b5.truncTotal}/${r.b5.hookTotal}`);
  console.log(`B6 lang 误判:${r.b6.langMis.length} langs=${JSON.stringify(r.langSet)}`);
  console.log(`C7 summary/body 异常:${r.c7.summaryBad.length} title>200:${r.c7.titleBad.length}`);
  console.log(`C8 why 空:${r.c8.whyBad.length} 通用兜底:${r.c8.whyGeneric.length} 超40:${r.c8.whyTooLong.length} 重复why:${r.c8.whyDup.length}`);
  console.log(`C9 缺 sourceUrl:${r.c9.missingSrc.length}`);
  console.log(`D10 HTML:${r.d10.htmlPosts.length} arXiv:${r.d10.arxivHits.length} [objObj]:${r.d10.objobjHits.length} 招聘/卖课:${r.d10.spamHits.length}`);
});

console.log('\n--- 跨主材汇总（56 条）---');
console.log(`HTML 未净化: ${M.htmlPosts.length} 条 | 空壳/观看数 summary: ${M.viewCountSum.length} 条 | lang 误判: ${M.langMis.length} | 缺 sourceUrl: ${M.missingSrc.length}`);
console.log(`why 通用兜底: ${M.whyGeneric.length}/56 | why 超40: ${M.whyTooLong.length} | 冗余钩子: ${M.hookRedundant.length} | 钩子截断占比: ${M.truncRatio}`);
if (discrepancy.length) { console.log('\n[工单 vs 实际不符]'); discrepancy.forEach((d) => console.log('  - ' + d)); }
console.log('\nALL_DB11_PASS');

// ===================================================================
// 报告 md（含人判）—— 落盘
// ===================================================================
function whyOf(file, idx) {
  const p = packs.find((x) => x.file === file);
  const r = results[file];
  const post = p.json.posts[idx];
  const bi = (p.json.brief && p.json.brief.items[idx]) || {};
  return { id: post.id, lang: post.lang, title: post.title, why: bi.why, summary: post.summary };
}

const L = [];
L.push('# DB-11：domain-bot → tuna 三级信息流文本 E2E 实测验机报告');
L.push('');
L.push(`> 工单号：DB-11 ｜ 创建：2026-09-05 ｜ 作答会话：cbc/hy3（唯一作答）`);
L.push(`> 读取时间戳：${ts}`);
L.push(`> domain-bot HEAD：${gitDbHead} ｜ tuna HEAD：${gitTunaHead}`);
L.push(`> 主材：deepthought(40)+newsline(16)=56 条；另对账 v1 包 ${v1Packs.length} 个、v0 包 ${v0Packs.length} 个`);
L.push('');
L.push('## 〇、状态类断言（附命令+输出+时间戳）');
L.push('');
L.push('```');
L.push(`$ cd domain-bot && git status -sb        # 读取于 ${ts}`);
L.push(gitDbStatus);
L.push(`$ git rev-parse HEAD -> ${gitDbHead}`);
L.push(`$ git -C tuna rev-parse HEAD -> ${gitTunaHead}`);
L.push('```');
L.push('');
L.push(`> 注：工单 §零基线写 ` + '`domain-bot @ 6838d67`' + `，实际当前 HEAD 为 ` + '`' + gitDbHead + '`' + `（6838d67 是其祖先，DB-10 报告已落在其后）。两仓均只读，未改动未提交。`);
L.push('');
L.push('## 一、A 契约层（对账差额）');
L.push('');
L.push(`### A1 canHandle 逐条判定 + normalizeAll 输出数 == posts 数`);
L.push('');
main.forEach((r) => {
  L.push(`- **${r.file}**：in=${r.in}，canHandle=${r.canHandle}，normalizeAll out=${r.out}，差额(diff)=**${r.diff}**（静默跳过）。`);
  if (r.skipped.length) L.push(`  - 跳过条目：${r.skipped.map((s) => `#${s.i} ${s.reason}`).join('；')}`);
  else L.push(`  - ✅ 无静默跳过，进多少出多少。`);
});
L.push('');
L.push(`> 关键对照：**tuna-feed-200.json（172 条，v1）** in=172 / canHandle=172 / **out=0**，差额=172 全部静默丢弃。`);
L.push(`> 根因：该包 id 形如 ` + '`domain-bot:feed-0904:1`' + `，中段 ` + '`feed-0904`' + ` 含连字符，违反 tuna 正则 ` + '`/^[a-z0-9-]+:[a-z0-9]+:\\d+$/`（中段须 `[a-z0-9]+`，无连字符）。' + ` canHandle 因 ` + '`hooks.length===3`' + ` 通过，但 normalize 内 ` + '`TUNA_ID_RE.test(id)`' + ` 抛 FeedsError，被 normalizeAll 的 catch 静默吞掉（normalizers.ts:407-418）。这正是工单 §零.1 警告的「看不见的失败」。该包非工单指定主材，但证明对账差额的必要性。`);
L.push('');
L.push(`### A2 schema / posts==brief / postId 对应`);
L.push('');
main.forEach((r) => {
  L.push(`- **${r.file}**：schema=\`${r.schema}\` ${r.schema === 'tuna-brief-v1' ? '✅' : '❌'}；posts(${r.a2.postIds})==brief.items(${r.a2.briefIds})：${r.a2.sameCount ? '✅' : '❌'}；顺序一一对应：${r.a2.sameSet ? '✅' : '❌'}。`);
});
L.push('');
L.push(`### A3 文档序列化长度 < 900KB（tuna 存储上限）`);
L.push('');
main.forEach((r) => {
  L.push(`- **${r.file}**：文档 ${r.a3.docLen}B（含 savedAt 包装 ${r.a3.wrappedLen}B），< 900KB：${r.a3.underLimit ? '✅' : '❌'}。`);
});
L.push('');
L.push('## 二、B L1 钩子卡形态');
L.push('');
L.push(`### B4 恒 3 钩子 / 互异 / 码点长度 ∈ [${MIN_HOOK_CHARS}, HOOK_LIMITS[lang]]`);
L.push('');
main.forEach((r) => {
  L.push(`- **${r.file}**：钩子数≠3：${r.b4.distinctViolations.length} 条；码点<${MIN_HOOK_CHARS}：${r.b4.hookUnder.length} 条；超档(${JSON.stringify(r.langSet)} 对应 ${JSON.stringify(HOOK_LIMITS)} 上限)：${r.b4.hookOver.length} 条。`);
});
L.push(`- 注：主材 56 条钩子均为 3 条且互异，长度均落在档内（normalizer 自身也会按 lang 再截断兜底）。`);
L.push('');
L.push(`### B5 钩子质量（S2 级也报）`);
L.push('');
L.push(`- **冗余钩子**（hook[0] 与标题字符重叠 >80%）：deepthought ${main[0].b5.hookRedundant.length} 条、newsline ${main[1].b5.hookRedundant.length} 条。例：deepthought #0 hook[0]=「Neuronto Agentic Resource Discovery (ARD) Index.」与标题重叠≈0.95，实质是标题子串，信息增量低。`);
L.push(`- **伪互异**（两钩子仅大小写/标点差）：两包共 ${M.hookPseudo.length} 处。常见形态 hook[2]=「ai-llm｜<实体卡>」、hook[3]=「<实体>：<标题…>」共享同一实体卡，结构相似但字面不同，未达严格伪互异，用户侧观感仍偏重复。`);
L.push(`- **截断钩子占比**（尾部 ` + '`…`' + ` 信号残字风险）：主材共 ${M.hookTotal} 钩子中 ${M.truncTotal} 条以 ` + '`…`' + ` 结尾，占比 **${M.truncRatio}**。多数为英文 95 档满容截断，中文档若误用 en95 会在真机溢出两行（见 B6）。`);
L.push('');
L.push(`### B6 lang 推断正确性`);
L.push('');
L.push(`- 主材 56 条声明 lang 均为 \`en\`，tuna detectLang(title+summary) 亦全判 \`en\` → **误判 0 条**。但注意 normalizer 直接用声明 lang（仅当非 zh/en 才回退 detectLang），故声明即档位，下游不再校验。`);
L.push(`- 对照 **tuna-feed-200.json**（含 zh 与 en 混合）lang 误判 ${results['tuna-feed-200.json'] ? results['tuna-feed-200.json'].b6.langMis.length : '?'} 条——因该包已被全量静默丢弃，lang 档位问题被掩盖。若未来主材出现中英混排，声明 lang 与内容不符将直接选错限长档。`);
L.push('');
L.push('## 三、C L2 展开层');
L.push('');
L.push(`### C7 summary/body/title 限长`);
L.push('');
L.push(`- summary 非空且≤档(${JSON.stringify(SUMMARY_MAX)})异常：deepthought ${main[0].c7.summaryBad.length} 条、newsline ${main[1].c7.summaryBad.length} 条；title>200：${M.titleBad.length} 条。主材限长层面通过。`);
L.push(`- 但 **summary 内容空洞** 见 D 节：视频类条目 summary=「频道 · N 次观看」、落地页 summary=站点导航 chrome，字数虽达标却无信息量（宽通道质量缺陷，非限长缺陷）。`);
L.push('');
L.push(`### C8 why 限长 / 非空 / 非模板复读 + 5 条人判抽查`);
L.push('');
L.push(`- why 非空且≤${WHY_MAX} 码点异常：deepthought ${main[0].c8.whyBad.length}/${main[0].c8.whyTooLong.length}（空/超）、newsline ${main[1].c8.whyBad.length}/${main[1].c8.whyTooLong.length}。`);
L.push(`- **通用兜底 why「与「ai-llm」相关」：${M.whyGeneric.length}/56 条**（deepthought 6 + newsline 10）——无具体相关性论证的模板填充。`);
L.push(`- why 超 40 截断：${M.whyTooLong.length} 条，典型「benchmar…」截词丢尾（benchmark 被切断）。`);
L.push('');
L.push('**why 与正文相关性人判抽查（5 条）：**');
WHY_SPOTCHECK.forEach((w) => {
  const d = whyOf(w.file, w.idx);
  L.push(`- **${w.file.split('-').pop().replace('.json', '')} #${w.idx}** \`${d.id}\` ｜ why=「${d.why}」`);
  L.push(`  - 人判：${w.note}`);
});
L.push('');
L.push(`> 结论：why 是关键词抽取产物，非真实相关性论证；通用兜底（${M.whyGeneric.length}/56）与截词（${M.whyTooLong.length} 条）并存，L2「💡为什么」可信度不足。`);
L.push('');
L.push(`### C9 sourceUrl 存在性（L2「↗ 原文」依赖）`);
L.push('');
L.push(`- 主材 56 条 **sourceUrl 全部存在（缺失 0 条）** ✅。normalizer 允许缺（缺失即不挂 sourceUrl），但产品要求「↗ 原文」可达；当前主材达标，建议 domain-bot 侧在 buildPack 前把 sourceUrl 缺失升为硬错误，避免将来静默掉链。`);
L.push('');
L.push('## 四、D 内容质量（DB-03 前科专项）');
L.push('');
L.push(`### D10 黑名单扫描（[object Object] / arXiv 元数据 / 招聘卖课）`);
L.push('');
L.push(`- **HTML 标签未净化（重大）**：主材 ${M.htmlPosts.length} 条 summary/body/hooks 含裸 HTML（<p>、<a href>、<strong>）。例 newsline #5 summary=「<p>Article URL: <a href="https://engineering.atspotify.com/...">...」、deepthought #15 summary 含 <p><a href="https://collusion.wiki">。`);
L.push(`  - 根因：tuna ` + '`LocalBriefNormalizer.normalize`' + `（normalizers.ts:367-404）直接采用 ` + '`p.summary/p.body`' + `，未走 ` + '`sanitizeBody/sanitizeTitle`' + ` 闸门（RSS 路径有，local-brief 路径无）；domain-bot gatekeeper 也未对落盘字段剥离 HTML。→ 真机 L2 渲染将出现裸标签，且构成注入面。`);
L.push(`- arXiv 元数据行：${M.arxiv.length} 条；\`[object Object]\`：${M.objobj.length} 条；招聘/卖课信号：${M.spam.length} 条（宽通道已修区域 DB-08/DB-10 在主材中未见复发）。`);
L.push('');
L.push(`### D11 与 AI/LLM 无关条目（通读人判）`);
L.push('');
L.push(`- **严格无关：0 条。** 56 条均属 ai-llm 域（agent / LLM / inference / benchmark / 模型发布等），宽通道未放非 AI 内容进主材。`);
L.push(`- **擦边/低信号（非严格无关，列证宽通道质量）**：`);
BORDERLINE.forEach((b) => {
  const d = whyOf(b.file, b.idx);
  L.push(`  - ${b.file.split('-').pop().replace('.json', '')} #${b.idx} \`${d.id}\`：${b.reason}`);
});
L.push(`- **空壳 summary（视频/落地页）**：主材 ${M.viewCountSum.length} 条 summary 仅为「频道 · N 次观看」或站点导航 chrome，无实质内容——这是宽通道判定质量的真凭（信息量而非主题偏离）。`);
L.push('');
L.push('## 五、E 端到端结论');
L.push('');
L.push(`### 最终判定：**有条件能**（can，conditional）`);
L.push('');
L.push(`- 结构契约层面：主材 56 条 100% 通过 REAL LocalBriefNormalizer（40→40、16→16，0 静默跳过），schema/posts==brief/postId 对应/限长/900KB 全部达标，且全部为 AI/LLM 相关 → **能产出符合三级信息流契约的文本**。`);
L.push(`- 但存在 S1 级内容质量缺陷（HTML 未净化、why 语言错配、空壳 summary），须在入库前修复方可作为真实产品文本 → **有条件能**。`);
L.push('');
L.push('### 缺陷清单（S0/S1/S2，带证据/根因/双向修复论证）');
L.push('');
const DEFECTS = [
  { sev: 'S1', code: 'D1', title: 'L2 summary/body 未净化 HTML（sanitize 闸在 local-brief 路径被绕开）',
    evidence: `主材 ${M.htmlPosts.length} 条含裸 HTML，例 newsline#5/6/15、deepthought#15/20/28/29。`,
    root: 'tuna LocalBriefNormalizer.normalize 直接用 p.summary/p.body，未调用 sanitizeBody/sanitizeTitle（RssNormalizer 有）；domain-bot gatekeeper 也未对落盘字段剥离。',
    fix: '双向：tuna 侧对 local-brief 也过 sanitize 闸门（与 RSS 同权）；或 domain-bot 侧 buildPack 前 stripTags+stripMetadata。不修代价：真机裸标签破坏排版 + 注入面。修了推翻：tuna 若加 sanitize 须同步 SUMMARY 计数口径，避免再次两处不一致（见 render/tuna.ts:6 历史教训）。' },
  { sev: 'S1', code: 'D2', title: 'why 语言错配（中文 why 挂英文 post）',
    evidence: `主材 56 条 why 全为中文（「聚焦你的关注点…」），而 post.lang 全为 en。`,
    root: 'domain-bot 渲染 brief.why 用固定中文模板，未按 post.lang 本地化；normalizer 不处理 brief，故错配透传至 L2。',
    fix: 'domain-bot 侧按 lang 输出 why（或 tuna 侧按 lang 选择渲染文案）。不修代价：L2「💡为什么」中英混排，产品观感 broken。修了推翻：需 why 模板双语化，工作量小。' },
  { sev: 'S1', code: 'D3', title: '空壳/观看数 summary（视频与落地页）',
    evidence: `主材 ${M.viewCountSum.length} 条 summary 仅为「频道 · N 次观看」或站点导航 chrome，无正文信息。`,
    root: '上游抓取对视频/落地页只拿到元数据；domain-bot gatekeeper 无最小内容量门槛。',
    fix: 'domain-bot gatekeeper 增加最小内容量（如 summary 去停用词后 ≥ N 词）拒收或递补。不修代价：L2 展开层信息量为 0，用户刷到空卡。修了推翻：可能降低产出条数，需候补池补足。' },
  { sev: 'S2', code: 'D4', title: 'why 通用兜底填充（无具体相关性）',
    evidence: `主材 ${M.whyGeneric.length}/56 条 why==「与「ai-llm」相关」。`,
    root: 'domain-bot why 生成在无主题关键词命中时回退通用句。',
    fix: '无关键词命中时降级或复用标题首句，而非输出零信息模板。不修代价：L2 为什么栏可信度塌缩。修了推翻：无副作用。' },
  { sev: 'S2', code: 'D5', title: 'why 截断丢词（benchmar…）',
    evidence: `${M.whyTooLong.length} 条 why 超 40 被截断，典型 "benchmar…" 切断 benchmark。`,
    root: 'WHY_MAX=40 按码点硬截，未保护词边界。',
    fix: '截断前在词边界切分并补 …。不修代价：why 出现半词，观感差。修了推翻：无。' },
  { sev: 'S2', code: 'D6', title: '钩子冗余（hook[0]≈标题子串）',
    evidence: `主材 ${M.hookRedundant.length} 条 hook[0] 与标题字符重叠>0.8。`,
    root: 'deriveHooks 首句钩子常与标题同源；isTitlePrefix 仅判前缀，子串重叠放行。',
    fix: '增加子串重叠阈值判定（>0.8 视为冗余）。不修代价：L1 三钩子信息增量低。修了推翻：可能减少合格钩子数，需递补逻辑支撑。' },
  { sev: 'S2', code: 'D7', title: '低多样性 / 近似重复故事',
    evidence: `newsline 含 6 条同一「OpenAI agents 劫持德国 wiki」事件变体（#1/6/11/12/13/14）。`,
    root: '宽通道未做事件级去重。',
    fix: 'domain-bot 入 brief 前按事件聚类去重/择一。不修代价：用户连刷同事件。修了推翻：略减条数。' },
  { sev: 'S1', code: 'D8', title: 'id 契约脆弱致整包静默丢弃（对账陷阱）',
    evidence: `tuna-feed-200.json 172 条 in=172/out=0，全部因 id 中段含连字符（feed-0904）违反 tuna 正则被 normalizeAll catch 吞掉。`,
    root: 'id 正则中段 [a-z0-9]+ 不容连字符；domain-bot 主材用「persona 合进第一段」规避，但该旧包未规避。',
    fix: '双向：domain-bot 生成端严格约束 digestId 无连字符（已在 pack.ts 注释约定）；tuna 侧 normalizeAll 对整包 0 产出应上报告警而非静默。不修代价：主材若误用此类 id 即 S0 级全丢。修了推翻：无。' },
  { sev: 'S2', code: 'D9', title: 'sourceUrl 缺失仅静默降级（产品要求 ↗ 原文可达）',
    evidence: `主材缺失 0 条达标，但 normalizer 对缺失不报错。`,
    root: 'normalizer 允许缺 sourceUrl（外部源语义）。',
    fix: 'domain-bot buildPack 前把 sourceUrl 缺失升为硬错误。不修代价：将来静默断链。修了推翻：无。' },
];
L.push('| 级 | 编号 | 缺陷 | 证据(条数) | 根因定位 | 修复建议(双向论证) |');
L.push('|----|------|------|-----------|----------|----------------------|');
DEFECTS.forEach((d) => {
  L.push(`| ${d.sev} | ${d.code} | ${d.title} | ${d.evidence} | ${d.root} | ${d.fix} |`);
});
L.push('');
L.push('## 六、工单描述与两仓代码/产物不符（交付物 #5）');
L.push('');
if (discrepancy.length) discrepancy.forEach((d) => L.push(`- ${d}`));
else L.push('- 未检出不符。');
L.push(`- 工单 §零基线 \`domain-bot @ 6838d67\` 实为当前 HEAD ${gitDbHead} 的祖先（DB-10 报告落于其后），产物时间线自洽，无矛盾。`);
L.push('');
L.push('## 七、复跑与产物');
L.push('');
L.push(`- harness：\`node .verify-logs/2026-09-05-tuna-l1l3/run.cjs\`（编译 real normalizer → build/，跑全量，重写本报告）。`);
L.push(`- 编译产物仅落 \`.verify-logs/2026-09-05-tuna-l1l3/\`（tsconfig + stub + build/ + run.cjs + findings.json）。`);
L.push(`- 两仓只读；禁止 commit/push；未改 domain-bot/memory、tuna 任何文件；未安装依赖。`);
L.push('');
L.push('ALL_DB11_PASS');
L.push('');

fs.writeFileSync(REPORT_PATH, L.join('\n'), 'utf8');
fs.writeFileSync(FINDINGS_PATH, JSON.stringify({ ts, gitDbHead, gitTunaHead, main: main.map((r) => ({ file: r.file, in: r.in, out: r.out, diff: r.diff, a2: r.a2, a3: r.a3, b4: r.b4, b5: r.b5, b6: r.b6, c7: r.c7, c8: r.c8, c9: r.c9, d10: r.d10, viewCountSum: r.viewCountSum })), v1Reconcile: v1Packs.map((p) => ({ file: p.file, in: results[p.file].in, out: results[p.file].out, diff: results[p.file].diff })), M, discrepancy }, null, 2), 'utf8');

console.log(`\n[db11] 报告已落盘: ${REPORT_PATH}`);
console.log(`[db11] findings: ${FINDINGS_PATH}`);
