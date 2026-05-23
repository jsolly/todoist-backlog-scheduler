# MAX_TASKS_PER_DAY Cap — Design

**Status:** Approved (retroactive — written after implementation landed)
**Date:** 2026-05-23

## Goal

Add an optional per-day cap so users with backlogs larger than one week of capacity can grind through them progressively, instead of getting an unusable Monday with 47 tasks on it.

## Problem

The unbounded distribution path (the original behavior) places every undated task into the upcoming week via a min-heap. For a small backlog this is exactly what you want — pick up where you left off, balanced across the week. For a large backlog it's worse than useless: dumping 80 undated tasks across 7 days produces 11–12 tasks per day, every day, with no signal about which ones to start with. The "schedule" exists, but it doesn't help you make decisions, and the moment you check the first day off you're still staring at 10 more.

A daily cap turns the scheduler into a progressive backlog drainer: the next *N* days get exactly *N* tasks each, with the oldest tasks loaded onto the earliest days, and everything else spills into subsequent weeks.

## Requirements

**R1. Optional via env var `MAX_TASKS_PER_DAY`.** Unset (or, by the original design intent, `0`) keeps the existing no-cap behavior. Setting it to a positive integer enables the capped path.

**R2. Capped path: sort by age (oldest first).** `created_at` is the sort key, ascending. The oldest task in the backlog is the most overdue piece of work and lands first.

**R3. Per-week distribution: balanced and front-loaded.** Within a week, assignments go Monday → Sunday (or whatever the user's week-start is). Each day gets `ceil(remaining / daysLeft)` tasks — at most one more than any other day. When the week has enough capacity for everything, tasks spread evenly across the front of the week and the tail is empty (5 tasks → Mon-Fri get one each, Sat/Sun get zero).

**R4. Existing tasks count toward the cap.** A day that already has 3 tasks scheduled and a cap of 5 can absorb 2 more. The free capacity is computed per-week before allocation, not after.

**R5. Full days are skipped.** A day with ≥ `maxPerDay` existing tasks receives zero new assignments and is excluded from the "balance across days" math for that week.

**R6. Overflow to subsequent weeks.** When the current week's free capacity isn't enough, the remainder spills into the next week, then the next, until every task is placed. Each subsequent week applies the same balanced-front-loaded distribution.

**R7. SAM template passes the cap through.** A new CloudFormation parameter `MaxTasksPerDay` (`Type: Number`) sets the Lambda env var `MAX_TASKS_PER_DAY`. Default value in the template documents `0 = no limit`.

## Acceptance criteria

The implementation passes when:

1. **No-cap regression**: with `MAX_TASKS_PER_DAY` unset, distribution is exactly the original min-heap behavior. Existing tests for the unbounded path still pass without modification.
2. **Empty calendar, exact fit**: cap=5, 5 tasks, empty week → Mon-Fri each get 1, Sat/Sun get 0.
3. **Empty calendar, exact week fill**: cap=5, 35 tasks, empty week → every day gets 5, no overflow.
4. **Overflow**: cap=5, 40 tasks, empty week → 35 fit week 1 (5/day), 5 newest go to week 2.
5. **Existing tasks counted**: 6 days with 2 existing each + 1 day with 1 existing, cap=2, 2 new tasks → only the day with 1 existing has room (absorbs 1), the second overflows to week 2.
6. **Multi-week overflow**: cap=1, 16 tasks → week 1 gets 7, week 2 gets 7, week 3 gets 2.
7. **Oldest first**: across all cap scenarios, week-1 tasks are the oldest in the backlog (by `created_at`).
8. **Lambda env wiring**: deploying via SAM with `MaxTasksPerDay=5` sets `MAX_TASKS_PER_DAY=5` in the Lambda environment.

## Alternatives considered

- **Status quo (no cap)**. Adequate for small backlogs; useless past ~10–15 undated tasks. Rejected as the only mode because the scheduler exists to help during backlog grinding, which is exactly when capacity exceeds one week.
- **Single-week cap, drop the overflow**. Simpler — but you'd lose tasks. Rejected; the user explicitly added these to Todoist, dropping them silently is worse than the no-cap dump.
- **Weighted distribution by priority**. Use task priority as a hint to schedule p1s earlier. Rejected as scope creep — the original Smart Schedule didn't do this; age-as-proxy-for-priority is good enough.
- **Different caps per day of week**. Letting the user say `Mon=5, Sat=1`. Rejected as YAGNI; the uniform cap is configurable and that's already enough flexibility.
- **Cap as a Todoist label/project filter**. Use a label like `@backlog` to opt into capped distribution. Rejected because the cap is a deployment-wide policy, not a per-task attribute.

## Out of scope

- Smart scheduling around existing task density patterns (the cap treats existing tasks as immovable; doesn't try to balance the week as a whole).
- Stack-rank tie-breaking within a single creation timestamp (`localeCompare` on the ISO string is stable enough; not bothering with ID-based tie breaks).
- Notifying the user about overflow via SMS/email. The cron's logs already report the count distributed.
- Migrating away from `due_string` to structured `due_date` payloads (separate concern; the scheduler still uses `On <date>` strings because Todoist's NLP is reliable for this case).

## Open questions / known issues

None outstanding. (An earlier draft of this spec flagged that `MAX_TASKS_PER_DAY=0` would enter the capped path with cap=0 and hang the Lambda because `"0"` is JS-truthy. Fixed in `src/scheduler.ts` by parsing first and treating `parsed > 0 ? parsed : undefined`, so `0`, empty, missing, and `NaN` all collapse to the no-cap path as the SAM template's description promises.)
