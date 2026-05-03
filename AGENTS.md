## Commands

```bash
npm install                       # First-time setup (also wires husky)
TODOIST_API_KEY=... npm run scheduler   # Run the CLI locally against your real account
npm test                          # vitest
npm run check:ts                  # tsc --noEmit
npx biome ci .                    # lint + format check
npm run deploy                    # sam build && sam deploy
```

## Architecture

**Todoist Backlog Scheduler** — recreates Todoist's discontinued "Smart Schedule" feature. Distributes undated tasks evenly across the upcoming week using a min-heap algorithm, respecting the user's configured week start day.

**Stack:** TypeScript on Node 24 (arm64), AWS Lambda (SAM), EventBridge (weekly cron), SSM Parameter Store, CloudWatch Alarms + SNS (alerting), Todoist REST API v1.

### Key Files

- `src/scheduler.ts` — Core scheduling logic (heap-based task distribution)
- `src/todoist.ts` — Thin Todoist REST v1 client (stdlib `fetch`)
- `src/cli.ts` — Local CLI entry point (`npm run scheduler`)
- `src/shared/logging.ts` — Synced from `~/code/family-memory`; do not edit directly
- `aws/src/handlers/scheduler.ts` — Lambda entry point (resolves SSM, calls `runScheduler`)
- `aws/template.yaml` — SAM/CloudFormation IaC definition
- `samconfig.toml` — SAM CLI deployment config

## Key Constraints

- **Node 24 runtime, arm64** (matches Lambda config in `aws/template.yaml`)
- **AWS SAM** for all infrastructure — no other IaC tools
- **SSM Parameter Store** for secrets — keep API keys out of source
- **`src/shared/logging.ts` and `tests/logging-contract.test.ts` are synced from `~/code/family-memory`** via `~/code/family-memory/scripts/sync-shared-logger.sh sync`. The pre-commit hook fails if the snapshot hash drifts; edit the canonical and re-sync.

## Logging

- **App-level structured JSON logger.** `import { createLogger } from "./shared/logging"` (or relative path from handlers).
- **Leave `LogFormat` unset** on the Lambda — the app emits the JSON line itself; the runtime wrapper would double-encode and break the metric filter.
- **`SchedulerErrorLogFilter` + `SchedulerErrorLogAlarm`** in `aws/template.yaml` watch `{ $.level = "error" }` (lowercase, Node convention) and fire via alert-hub on any logged error, alongside the `SchedulerLambdaErrorsAlarm` (on `AWS/Lambda Errors`) that catches runtime crashes/timeouts/OOM. Both wire `AlarmActions` + `OKActions` to the alert-hub SNS topic via SSM param `/alert-hub/alert-topic-arn`.

## Testing

- **Runtime:** Node 24, vitest. `npm test` runs the suite.
- **Layout:** Tests live under `tests/` named after the scenario family (e.g. `scheduler.test.ts`), not 1:1 per source file.
- **External calls:** Stub `globalThis.fetch` for end-to-end paths that would otherwise hit Todoist. Pure logic (`distributeTasks`) takes a fake client object so the heap math is testable without any HTTP.
- **Logger contract:** `tests/logging-contract.test.ts` and `tests/logging-snapshot.test.ts` are synced from `~/code/family-memory` and pin the structured-logger shape — re-sync via `~/code/family-memory/scripts/sync-shared-logger.sh sync` after edits.
- **Secrets:** `.env` for local runs, SSM for the deployed Lambda.
