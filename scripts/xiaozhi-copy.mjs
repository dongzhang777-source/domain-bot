#!/usr/bin/env node
// 小智亲写文案对齐工具（编辑部生产模式，老张 2026-09-06 指令「编辑部生产由小智亲自执行」）。
//
// 用法：
//   node scripts/xiaozhi-copy.mjs --persona=newsline --input=/tmp/mycopy-newsline.json
// input JSON 格式（键=候选 id，值=亲写文案）：
//   { "<候选id>": { "hooks": ["钩子1","钩子2","钩子3"], "summary": "…", "why": "…", "body": "…" } }
// body 为可选的亲写 L3 正文（2026-09-07 老张「L3 篇幅不够」）：给了就用它作心流层
// 底料（过 stripHtml/stripMetadata 清洗，终审 gk:bodyBelowFloor 把篇幅下限 zh600/en900），
// 不给则回退原文。建议亲写 900–1500 码点中文正文。
//
// 流程：找该 persona 最新 candidates 快照（或 --digest-id 指定的历史快照，用于回填
// 历史轮次的亲写文案）→ editorialTargetsOf 按 maxItems 重算
// targetIds（与 publish 阶段同一函数，杜绝下标错位）→ 按 id 取亲写文案，
// 未覆盖的 id 记 null（机械兜底）→ 落 staging/copy-<persona>-<digestId>.json。
// 之后正常跑 `npm run publish-feed -- --persona=<p>` 即可，终审断言照常把关。
//
// 篇幅契约（2026-09-06 篇幅令）：钩子 zh≤70/en≤95、摘要 zh 200–300/en 300–450 码点、why≤40。
// 本工具不做篇幅截断——写不到位会被终审 gk:summaryBelowFloor 拒收，宁可写作时就写足。

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// P0（2026-09-07 审查）：本文件是 .mjs（恒为 ESM），裸 require() 必崩
// `ReferenceError: require is not defined`。仓内先例 probe-event-cluster.mjs 同款写法。
const require = createRequire(import.meta.url);

function arg(name) {
  // P1（2026-09-07 审查）：同时支持 `--k v` 与文档写法的 `--k=v`。
  for (const a of process.argv.slice(2)) {
    if (a === `--${name}`) return process.argv[process.argv.indexOf(a) + 1];
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return undefined;
}

const persona = arg('persona');
const inputPath = arg('input');
// P1（2026-09-07 审查）：persona 未校验直接拼进 readFileSync/stagePath，
// `--persona ../../tmp/x` 可读写界外文件。只允许 persona 配置名 charset。
if (!persona || !/^[a-z0-9-]+$/.test(persona) || !inputPath || !fs.existsSync(inputPath)) {
  console.error('用法：node scripts/xiaozhi-copy.mjs --persona=<newsline|deepthought> --input=<亲写文案JSON>');
  process.exit(2);
}

const {
  editorialTargetsOf,
  findLatestStage,
  restoreStage,
  COPY_SCHEMA,
  stagePath,
  writeStageJson,
} = require('../dist/staging.js');
const { EMPTY_EDITORIAL_STATS } = require('../dist/editorial/index.js');

const root = process.cwd();
const stagingDir = path.join(root, 'staging');
const digestIdArg = arg('digest-id');
const latest = digestIdArg
  ? stagePath(stagingDir, 'candidates', persona, digestIdArg)
  : findLatestStage(stagingDir, 'candidates', persona);
if (!latest || !fs.existsSync(latest)) {
  console.error(`[xiaozhi-copy] ${persona} 无 candidates 快照${digestIdArg ? `（digest-id=${digestIdArg}）` : ''}，先跑 npm run collect`);
  process.exit(2);
}
const snapshot = JSON.parse(fs.readFileSync(latest, 'utf8'));
const stage = restoreStage(snapshot);
const personaCfg = JSON.parse(fs.readFileSync(path.join(root, 'config', 'personas', `${persona}.json`), 'utf8'));
const targets = editorialTargetsOf(stage, personaCfg.maxItems);
console.log(`[xiaozhi-copy] 快照 ${path.basename(latest)} | digestId=${snapshot.digestId} | 目标 ${targets.length} 条（maxItems=${personaCfg.maxItems}）`);

const mine = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
let covered = 0;
const copies = targets.map((t) => {
  const c = mine[t.id];
  if (!c) return null;
  // P1（2026-09-07 审查）：外部 JSON 形状不校验，非数组 hooks 会在 publish 的
  // checkMechanicalTruncation 处 TypeError 顶穿。形状不对走机械兜底，不进终审浪费坑位。
  if (!Array.isArray(c.hooks) || c.hooks.length !== 3 || !c.hooks.every((h) => typeof h === 'string')
    || typeof c.summary !== 'string' || typeof c.why !== 'string') return null;
  // body（2026-09-07 老张「L3 篇幅不够」）：可选亲写正文，字符串非空才收；
  // 缺省回退原文底料。形状不对的字段直接整条走机械兜底，不进终审浪费坑位。
  if (c.body !== undefined && (typeof c.body !== 'string' || c.body.trim().length === 0)) return null;
  covered += 1;
  return {
    hooks: c.hooks,
    summary: c.summary,
    why: c.why,
    ...(c.body !== undefined ? { body: c.body } : {}),
    origin: 'llm',
  };
});

const doc = {
  schema: COPY_SCHEMA,
  persona,
  digestId: snapshot.digestId,
  targetIds: targets.map((t) => t.id),
  copies,
  active: true,
  stats: { ...EMPTY_EDITORIAL_STATS },
  usage: null,
};
const out = writeStageJson(stagePath(stagingDir, 'copy', persona, snapshot.digestId), doc);
console.log(`[xiaozhi-copy] 亲写覆盖 ${covered}/${targets.length} 条（未覆盖走机械兜底，终审与发布器闸照常把关）`);
console.log(`[xiaozhi-copy] 已落盘 ${out}`);
// P1（2026-09-07 审查）：覆盖 0 条仍打印 PASS 会让调用方误判成功。0 覆盖退非零。
if (covered === 0) {
  console.error('[xiaozhi-copy] 亲写覆盖 0 条，拒绝 PASS（检查 input 键是否为本轮 targetIds）');
  process.exit(3);
}
console.log('XIAOZHI_COPY_PASS');
