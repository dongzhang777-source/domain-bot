#!/usr/bin/env python3
"""变异测试：证明关键断言在目标变异下真的会红。

DISPATCH-RULES §三.1 / DB-04 工单 §6.3 的要求：凡把某条断言写进验收判据，
必须同时验证「它在目标变异下会红」。断言在变异下仍绿 = 该断言没有锁定任何东西
（本项目已踩过：2 元素样本无法区分 floor 与 ceil，5 条 quantile 断言全绿而缺陷永存）。

每条变异做三件事：注入 → 跑目标测试 → 还原。结束后复跑全量确认树已还原。
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MUTATIONS = [
    {
        "id": "M1",
        "file": "src/staging.ts",
        "find": "export function assertTargetAlignment(kind: 'copy' | 'verdicts', stagedIds: string[], expectedIds: string[]): void {\n",
        "repl": "export function assertTargetAlignment(kind: 'copy' | 'verdicts', stagedIds: string[], expectedIds: string[]): void {\n  if (stagedIds.length >= 0) return\n",
        "tests": ["tests/cli-stages.test.ts"],
        "locks": "下标对齐校验：maxItems 在 edit 与 publish 之间被改过必须拒绝发布",
    },
    {
        "id": "M2",
        "file": "src/gatekeeper/assertions.ts",
        "find": "    if (!shared) {\n      return fail('gk:hookEntity'",
        "repl": "    if (false) {\n      return fail('gk:hookEntity'",
        "tests": ["tests/gatekeeper.test.ts"],
        "locks": "gk:hookEntity：钩子不含原文实体词必须一票否决",
    },
    {
        "id": "M3",
        "file": "src/pipeline.ts",
        "find": "  const selected = ordered\n",
        "repl": "  const selected = ordered.slice(0, opts.persona.maxItems)\n",
        "tests": ["tests/wiring.test.ts"],
        "locks": "不得在终审之前按 maxItems 截断（否则多样性选择无从发生）",
    },
    {
        "id": "M4",
        "file": "src/staging.ts",
        "find": "  if (byId.size !== s.candidates.length) {",
        "repl": "  if (false) {",
        "tests": ["tests/cli-stages.test.ts"],
        "locks": "restoreStage：候选重复 id 必须抛错（规范 URL 派生 id 失效的征兆）",
    },
    {
        "id": "M5",
        "file": "src/cli.ts",
        "find": "    const stage = await collectStage({\n",
        "repl": "    const stage = await collectStage({\n      // MUTATION\n",
        "tests": ["tests/startup.test.ts"],
        "locks": "（对照组）注入一行注释不应让任何测试变红——用来证明本脚本的判定不是恒红",
        "expect_green": True,
    },
]


def run(cmd):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)


def main():
    failures = []
    before = {m["file"]: (ROOT / m["file"]).read_text(encoding="utf-8") for m in MUTATIONS}
    for m in MUTATIONS:
        path = ROOT / m["file"]
        backup = Path(f"/tmp/mutation-backup-{m['id']}.ts")
        original = path.read_text(encoding="utf-8")
        if original.count(m["find"]) != 1:
            failures.append(f"{m['id']}: 锚点在 {m['file']} 出现 {original.count(m['find'])} 次，应为 1 次")
            continue
        shutil.copy2(path, backup)
        try:
            path.write_text(original.replace(m["find"], m["repl"], 1), encoding="utf-8")
            r = run(["npx", "vitest", "run", *m["tests"]])
            went_red = r.returncode != 0
            expect_green = m.get("expect_green", False)
            if expect_green:
                ok = not went_red
                verdict = "仍绿（符合预期：对照组）" if ok else "变红（异常：本脚本判定不可信）"
            else:
                ok = went_red
                verdict = "变红（断言有效）" if ok else "仍绿（断言无效！）"
            print(f"{m['id']} [{m['file']}] {verdict}")
            print(f"    锁定：{m['locks']}")
            if not ok:
                failures.append(f"{m['id']}: {verdict} —— {m['locks']}")
                tail = [l for l in r.stdout.splitlines() if "Tests " in l or "×" in l][:4]
                for l in tail:
                    print(f"    | {l.strip()}")
        finally:
            shutil.copy2(backup, path)
            backup.unlink(missing_ok=True)

    print("\n=== 还原核验 ===")
    # 逐文件比对变异前的字节：不得靠「测试绿了」间接推断已还原
    not_restored = [f for f, text in before.items() if (ROOT / f).read_text(encoding="utf-8") != text]
    for f in not_restored:
        print(f"FAIL 未还原：{f}")
        failures.append(f"变异后 {f} 未还原到注入前的字节")
    print(f"逐文件字节比对：{len(before) - len(not_restored)}/{len(before)} 已还原")
    full = run(["npx", "vitest", "run"])
    green = full.returncode == 0
    line = [l for l in full.stdout.splitlines() if "Tests " in l]
    print(f"全量复跑：exit={full.returncode} {line[-1].strip() if line else ''}")
    if not green:
        failures.append("变异还原后全量测试未回绿——树被污染")

    print("\n=== 结论 ===")
    if failures:
        for f in failures:
            print(f"FAIL {f}")
        sys.exit(1)
    print(f"ALL_MUTATIONS_PASS（{len(MUTATIONS) - 1} 条断言在目标变异下会红，1 条对照组仍绿）")


if __name__ == "__main__":
    main()
