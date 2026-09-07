#!/usr/bin/env node
// 小智亲写文案对齐工具（编辑部生产模式，老张 2026-09-06 指令「编辑部生产由小智亲自执行」）。
//
// 用法：
//   node scripts/xiaozhi-copy.mjs --persona=newsline --input=/tmp/mycopy-newsline.json
// input JSON 格式（键=候选 id，值=亲写文案）：
//   { "<候选id>": { "hooks": ["钩子1","钩子2","钩子3"], "summary": "…", "why": "…" } }
//
// 流程：找该 persona 最新 candidates 快照 → editorialTargetsOf 按 maxItems 重算
// targetIds（与 publish 阶段同一函数，杜绝下标错位）→ 按 id 取亲写文案，
// 未覆盖的 id 记 null（机械兜底）→ 落 staging/copy-<persona>-<digestId>.json。
// 之后正常跑 `npm run publish-feed -- --persona=<p>` 即可，终审断言照常把关。
//
// 篇幅契约（2026-09-06 篇幅令）：钩子 zh≤70/en≤95、摘要 zh 200–300/en 300–450 码点、why≤40。
// 本工具不做篇幅截断——写不到位会被终审 gk:summaryBelowFloor 拒收，宁可写作时就写足。

const fs = require('fs');
const path = require('path');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const persona = arg('persona');
const inputPath = arg('input');
if (!persona || !inputPath || !fs.existsSync(inputPath)) {
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
const latest = findLatestStage(stagingDir, 'candidates', persona);
if (!latest) {
  console.error(`[xiaozhi-copy] ${persona} 无 candidates 快照，先跑 npm run collect`);
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
  covered += 1;
  return {
    hooks: c.hooks,
    summary: c.summary,
    why: c.why,
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
console.log('XIAOZHI_COPY_PASS');
