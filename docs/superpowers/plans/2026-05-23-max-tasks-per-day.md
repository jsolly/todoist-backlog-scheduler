# MAX_TASKS_PER_DAY Cap — Implementation Plan

> **Retroactive plan.** The work was implemented before the `docs/superpowers/{specs,plans}/` convention was established for this repo. This file documents the decomposition after the fact so future changes have a structural reference, and so `/review-fix-push`'s `spec-compliance-reviewer` has something to check the diff against. Tasks are marked `[x]` because the implementation is already on disk (uncommitted on `main`); each task points to the actual file:line range that ended up implementing it.

**Spec:** `docs/superpowers/specs/2026-05-23-max-tasks-per-day-design.md`

**Goal:** Add an optional `MAX_TASKS_PER_DAY` daily cap with multi-week overflow so the scheduler can drain backlogs progressively instead of dumping every undated task into one week.

**Architecture:** Add a parallel branch to `distributeTasks` that activates when `maxPerDay` is provided. The original unbounded min-heap branch is preserved unchanged so the no-cap path stays bit-identical. The capped branch sorts by age, then loops over weeks, allocating tasks per day with a `ceil(remaining / daysRemaining)` balance heuristic and respecting both the cap and existing task counts.

**Tech Stack:** TypeScript on Node 24, vitest for the test suite, AWS SAM template parameter wired through to a Lambda environment variable.

---

## File structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/scheduler.ts` | Modify | Add `maxPerDay?: number` parameter to `distributeTasks`; branch on `undefined` for the no-cap path; implement the capped path (sort by age, per-week balanced front-loaded allocation, multi-week overflow). `runScheduler` reads `process.env.MAX_TASKS_PER_DAY` and passes it through. |
| `tests/scheduler.test.ts` | Modify | Add scenario coverage: exact fit, week-full, overflow, existing-task counting, multi-week overflow, no-cap regression. |
| `aws/template.yaml` | Modify | Add `MaxTasksPerDay` CloudFormation parameter (Number, default 0). Set `MAX_TASKS_PER_DAY` env var on the scheduler Lambda from `!Ref MaxTasksPerDay`. |
| `samconfig.toml` | Modify | `parameter_overrides = "MaxTasksPerDay=5"` so `npm run deploy` ships the desired runtime cap. |
| `README.md` | Modify | Document the no-cap vs capped behavior, the rules, the example table, and the configuration knobs. |
| `plans/migrate-to-typescript.md` | Delete | Original Python→TS migration plan; the migration is done. Top-level `plans/` is the now-deprecated location per `~/.agents/rules/specs-and-plans.md`. |

---

## Implementation (retrospective)

### Task 1: Extend `distributeTasks` with an optional `maxPerDay` parameter

**Files:**

- Modify: `src/scheduler.ts:49-115`

- [x] **Step 1:** Add `maxPerDay?: number` as the fifth parameter of `distributeTasks`. Keep all existing call sites working — they pass nothing, so the parameter is `undefined`, and the original min-heap branch runs.
- [x] **Step 2:** Branch on `if (maxPerDay === undefined)` and inline the original min-heap loop unchanged inside it. The early-return on empty `tasks` stays at the top.
- [x] **Step 3:** Implement the capped path: sort by `created_at` ascending, then loop `while (remaining.length > 0)` over weeks. Per week: count free capacity (`sum of max(0, maxPerDay - existing)` across the 7 buckets); if zero, `weekNum++` and continue; otherwise slice the next batch out of `remaining`, then iterate buckets in date order with `Math.ceil(tasksLeft / daysLeft)` allocation, calling `client.updateTaskDueString(task.id, "On <date>")` per assignment.

### Task 2: Wire the env var through `runScheduler`

**Files:**

- Modify: `src/scheduler.ts:131-135`

- [x] **Step 1:** Read `process.env.MAX_TASKS_PER_DAY` in `runScheduler` via `const parsed = Number(process.env.MAX_TASKS_PER_DAY); const maxPerDay = parsed > 0 ? parsed : undefined;`. This intentionally collapses `"0"`, empty, `NaN`, and negative values all to "no cap" so the SAM template's documented `Default: 0` ("no limit") actually behaves that way. (An earlier draft of the spec flagged an infinite-loop bug here because `"0"` was JS-truthy; this parsing fix resolves it. Spec's "Open questions" reflects the resolution.)
- [x] **Step 2:** Pass the resolved `maxPerDay` as the fifth argument to `distributeTasks`.

### Task 3: Test the capped path

**Files:**

- Modify: `tests/scheduler.test.ts`

- [x] **Step 1:** Add a `makeFakeClient({ existingByDate })` helper for tests that need to simulate pre-existing tasks on specific days.
- [x] **Step 2:** Cover the empty-calendar scenarios: cap=5 with 5 / 10 / 35 / 40 tasks, asserting the day-by-day distribution matches the example table in the README.
- [x] **Step 3:** Cover the overflow scenarios: 5 newest tasks land in week 2 when week 1 is full; 16 tasks at cap=1 spread across 3 weeks (7+7+2).
- [x] **Step 4:** Cover existing-task counting: a week with 6 days at 2 existing each + 1 day at 1, cap=2, 2 new tasks → only one fits in week 1, the other overflows.
- [x] **Step 5:** Confirm the no-cap regression: existing tests against the original min-heap path still pass with no edits.

### Task 4: SAM template parameter + Lambda env binding

**Files:**

- Modify: `aws/template.yaml`

- [x] **Step 1:** Add `MaxTasksPerDay` to the `Parameters` block: `Type: Number`, `Default: 0`, with the description `"Max tasks per day (0 = no limit, distributes evenly with no cap)"`.
- [x] **Step 2:** Add `MAX_TASKS_PER_DAY: !Ref MaxTasksPerDay` to the scheduler Lambda's `Environment.Variables`.

### Task 5: Default deploy ships a working cap

**Files:**

- Modify: `samconfig.toml`

- [x] **Step 1:** Add `parameter_overrides = "MaxTasksPerDay=5"` so `npm run deploy` lands with cap=5 in production.

### Task 6: README documents both modes

**Files:**

- Modify: `README.md`

- [x] **Step 1:** Add a `## How scheduling works` section with two subsections (`Without a daily cap (default)` and `With a daily cap`).
- [x] **Step 2:** In the no-cap subsection, make explicit that all undated tasks land in the upcoming week regardless of count, and there is no overflow.
- [x] **Step 3:** In the cap subsection, document the five distribution rules (sort by age, balanced front-loaded fill, oldest-on-earliest, overflow to next week, skip full days).
- [x] **Step 4:** Add the worked-example table for cap=5 with 5 / 10 / 35 / 40 tasks.
- [x] **Step 5:** Document both configuration paths: env var for local runs, `--parameter-overrides MaxTasksPerDay=5` for the deployed Lambda.

### Task 7: Drop the legacy migration plan

**Files:**

- Delete: `plans/migrate-to-typescript.md`

- [x] **Step 1:** The Python → TypeScript migration is complete; the plan no longer reflects open work. Deleting from the deprecated top-level `plans/` location simultaneously aligns with the new `~/.agents/rules/specs-and-plans.md` convention (`docs/superpowers/plans/` is the new home).

---

## Self-review

1. **Spec coverage**: every requirement in the spec maps to at least one task above:
   - R1 (optional env var) → Tasks 2 + 4 + 5
   - R2 (sort by age) → Task 1 Step 3, Task 3 Step 2
   - R3 (balanced front-loaded) → Task 1 Step 3, Task 3 Step 2
   - R4 (existing tasks count) → Task 1 Step 3 (capacity calc), Task 3 Step 4
   - R5 (skip full days) → Task 1 Step 3 (`available <= 0 continue`), Task 3 Step 4
   - R6 (multi-week overflow) → Task 1 Step 3 (while-loop), Task 3 Step 3
   - R7 (SAM wiring) → Tasks 4 + 5
   - AC1–AC8 → Task 3 sub-steps + Task 4

2. **Placeholder scan**: no TBDs, no "implement later", no "similar to Task N". Every checked step points to the concrete code that ended up landing or describes the exact action that was taken.

3. **Type consistency**: parameter name `maxPerDay` consistent in the code and prose. Env var name `MAX_TASKS_PER_DAY` consistent. CloudFormation parameter name `MaxTasksPerDay` consistent. Function name `distributeTasks` consistent. README section headings match the prose.
