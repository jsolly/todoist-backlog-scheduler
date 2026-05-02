# Plan: Migrate todoist-backlog-scheduler from Python to TypeScript

## Why

This is the last Python Lambda outside `alert-hub`'s enricher. Four costs of staying Python:

1. **Logger drift, by design.** Today this repo uses `logging.getLogger()` + the Lambda runtime's `LogFormat: JSON` wrapper. Node consumers (`misc-notifications`, `family-memory`, post-migration `alert-hub`) all share the structured logger from `~/code/family-memory/src/shared/logging.ts`, distributed by `~/code/family-memory/scripts/sync-shared-logger.sh`. Python is excluded from that machinery. PII redaction, sensitive-key masking, and the entry shape are the Node logger's contract — the Python equivalent is whatever the stdlib emits, and there's no contract test to lock it down.
2. **Two MetricFilter dialects.** alert-hub's enricher parses both lowercase `level=error` (Node) and uppercase `level=ERROR` (Python runtime JSON wrapper). Once every Lambda is Node, the second branch goes away.
3. **Two test stacks.** pytest + tests/ here vs vitest in every Node repo. Same conceptual coverage, different runner. Migrating consolidates.
4. **The `alert-hub-lambda-setup` skill is Node-only.** Adding a second Lambda to this repo today doesn't get the contract checklist + canonical SAM snippet the skill provides. Migrating means the next time you touch `aws/template.yaml` (or add a second handler), the skill triggers automatically.

The repo is small — `lambda_handler.py` is 28 lines, `schedule_tasks.py` is the actual logic — so the migration cost is low.

## Scope

- Lambda runtime: Python 3.13 → Node 24 (arm64).
- `lambda_handler.py` + `schedule_tasks.py` → TS equivalents under `src/`.
- `template.yaml` runtime/handler/CodeUri/MetricFilter updates.
- `requirements.txt` → `package.json`. pytest → vitest.
- Add this repo as a consumer of `~/code/family-memory/scripts/sync-shared-logger.sh`.

## Approach

1. **Functional parity first.** Same EventBridge schedule, same Todoist API calls, same logical output (`{tasks_distributed: N}`). The scheduler's distribution algorithm in `schedule_tasks.py` ports line-by-line — no algorithmic changes during the migration.
2. **Adopt the canonical logger.** Replace stdlib `logging` with `createLogger` from the synced logger. Every log line gets the `level`, `timestamp`, `message`, optional `context`, optional `error` shape. Drop `LogFormat: JSON` from the SAM template — the app handles structure now.
3. **Use the alert-hub-lambda-setup skill** to lay down the SAM bits: explicit `AWS::Logs::LogGroup`, MetricFilter on `{ $.level = "error" }` (lowercase, Node convention), paired alarms with `AlarmActions` + `OKActions`, no `LogFormat: JSON`.
4. **HTTP client:** stdlib `fetch` (Node 24 has it) instead of `requests`. Strip the requests dependency.
5. **Secrets:** Todoist API token currently from env var via SSM/Secrets Manager — stays the same, just consumed from Node.
6. **Tests.** Port pytest cases to vitest. Scenario-based names. The critical scenarios: today's tasks distributed evenly across the configured days; respects task priorities; handles Todoist 429s with retry; handles a partial Todoist outage without losing the run.

## Sequencing

- **Step 1:** scaffold `package.json`, `tsconfig.json`, `biome.jsonc`, `.husky/pre-commit`, `.gitattributes` from `family-memory` baseline (the bootstrap section of the `alert-hub-lambda-setup` skill covers this).
- **Step 2:** add `todoist-backlog-scheduler` to `CONSUMERS` in `~/code/family-memory/scripts/sync-shared-logger.sh`. Add a `tests/logging-snapshot.test.ts`. Run sync.
- **Step 3:** port `schedule_tasks.py` → `src/scheduler.ts` and `lambda_handler.py` → `aws/src/handlers/scheduler.ts`. Use the structured logger.
- **Step 4:** port pytest tests to vitest under `tests/`.
- **Step 5:** rewrite `template.yaml` runtime/handler/MetricFilter/alarms via the skill checklist. `sam validate --lint` clean.
- **Step 6:** deploy. Watch one scheduled run end-to-end. Confirm the alert-hub enricher's email format renders correctly for a synthetic error.
- **Step 7:** delete `lambda_handler.py`, `schedule_tasks.py`, `requirements.txt`, pytest config, `__pycache__/`. Update `samconfig.toml` build method.

## Risks

- **The Todoist scheduler is the actual user-facing job.** A failed migration means tasks don't get distributed. Cron runs daily, so verification window is 24h.
- **Secrets unchanged**: the API token mechanism doesn't move.
- **Behavior parity is testable in isolation** — the distribution algorithm is pure given an input list, so vitest can cover the core logic before any cloud cutover.

## Out of Scope

- Algorithmic changes to task distribution. Migrate first; iterate later.
- Adding new Lambdas during the migration. One concern at a time.
