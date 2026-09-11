#!/usr/bin/env node
// 亲写文案工作文件校验仪（规程 3，2026-09-11 复盘产物）。
//
// 用法：node scripts/check-mycopy.mjs <亲写JSON文件> [--json]
//
// 校验项：
//   ① 每条三层齐全（hooks×3 / summary / why / body）
//   ② hooks 每条 ≤70 码点；summary 200-300；why ≤40；body ≥600
//   ③ origin 标记（可选，缺省按 llm 处理）
//
// 输出：逐条 PASS/FAIL + 末尾汇总行。exit 0=全部通过，exit 1=有失败。
//
// 纪律：校验不通过不许进对齐工具（xiaozhi-copy.mjs）。这是亲写流程的必要门槛，
// 防止「写完才发现篇幅不足→反复补足→反复对齐」的返工循环（09-07~09-11 实测）。

import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('用法：node scripts/check-mycopy.mjs <亲写JSON文件>');
  process.exit(1);
}

const cp = s => [...(s || '')].length;
const C = JSON.parse(fs.readFileSync(file, 'utf8'));
const keys = Object.keys(C).filter(k => k.startsWith('u-'));
let pass = 0, fail = 0;

for (const id of keys) {
  const c = C[id];
  const issues = [];
  if (!c.hooks || !Array.isArray(c.hooks) || c.hooks.length !== 3) {
    issues.push(`hooks=${c.hooks ? c.hooks.length : '缺失'}`);
  } else {
    c.hooks.forEach((h, i) => { if (cp(h) > 70) issues.push(`hook[${i}]=${cp(h)}>70`); });
  }
  const s = cp(c.summary || '');
  if (s < 200 || s > 300) issues.push(`summary=${s}（需200-300）`);
  if (cp(c.why || '') > 40) issues.push(`why=${cp(c.why || '')}>40`);
  if (cp(c.body || '') < 600) issues.push(`body=${cp(c.body || '')}<600`);
  if (issues.length === 0) { pass++; console.log(`  ✓ ${id.slice(-8)} PASS`); }
  else { fail++; console.log(`  ✗ ${id.slice(-8)} FAIL: ${issues.join('; ')}`); }
}

console.log(`\n校验结果：${pass} PASS / ${fail} FAIL（共 ${keys.length} 条）`);
if (fail > 0) {
  console.log('\n修正指引：summary 写 240-280 码点（留余量），body 写 700+ 码点（下限 600）。');
  process.exit(1);
}
process.exit(0);
