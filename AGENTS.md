## Ship

Ship profile: `aws-sam`
Integration: `pr-auto-merge`
CI owner: `local`

Code deploys through `.github/workflows/deploy.yml` after merge to `main` using the
`github-actions-deploy` role. Changes to `aws/template.yaml` require the manual,
human-MFA `npm run deploy:infra` path documented under [Deploy model](#deploy-model).

## Local development

- **No dev servers:** This repo has no web UI or long-running app. Verification is `npm test`, `npm run check:ts`, and `npx biome ci .` (see Commands below).
- **Scheduler CLI:** `npm run scheduler` needs `TODOIST_API_KEY` in `.env.local` or the environment; it calls the live Todoist API. Tests stub `fetch` / fake clients — no Todoist token required for `npm test`.
- **SAM:** `sam validate --lint --template-file aws/template.yaml` from repo root. `sam build` / `npm run deploy:infra` need repo-root `node_modules` (`npm ci` first). If `sam build` cannot find esbuild, ensure `node_modules/.bin` is on `PATH` (plain `npm run deploy:infra` does this automatically).
- **AWS deploy:** Optional for local dev; requires credentials/SSM and is not needed to run tests.

## Commands

```bash
npm install                       # First-time setup (configures git hooks via core.hooksPath)
TODOIST_API_KEY=... npm run scheduler   # Run the CLI locally against your real account
npm test                          # vitest
npm run check:ts                  # tsc --noEmit
npx biome ci .                    # lint + format check
npm run deploy:infra              # full deploy via aws/deploy.sh: npm ci + sam build + sam deploy (sets GitSha; admin creds)
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
- `samconfig.toml.example` → copy to gitignored `samconfig.toml`; credentials via `AWS_PROFILE` locally (never commit profile names)

## Key Constraints

- **Node 24 runtime, arm64** (matches Lambda config in `aws/template.yaml`)
- **AWS SAM** for all infrastructure — no other IaC tools
- **SSM Parameter Store** for secrets — keep API keys out of source
- **`src/shared/logging.ts` and `tests/logging-contract.test.ts` are synced from `~/code/family-memory`** via `~/code/family-memory/scripts/sync-shared-logger.sh sync`. The pre-commit hook fails if the snapshot hash drifts; edit the canonical and re-sync.

## Logging

- App-level structured JSON logger. `import { createLogger } from "./shared/logging"` (or relative path from handlers).
- Alarm names in `aws/template.yaml`: `SchedulerErrorLogFilter` + `SchedulerErrorLogAlarm` (custom-metric on `{ $.level = "error" }`) plus `SchedulerLambdaErrorsAlarm` (on `AWS/Lambda Errors`).
- Conventions (logger sync, `LogFormat` unset, shared-infra SNS wiring): see `~/code/shared-infra/docs/adding-a-project.md`.

## Testing

- **Runtime:** Node 24, vitest. `npm test` runs the suite.
- **Layout:** Tests live under `tests/` named after the scenario family (e.g. `scheduler.test.ts`), not 1:1 per source file.
- **External calls:** Stub `globalThis.fetch` for end-to-end paths that would otherwise hit Todoist. Pure logic (`distributeTasks`) takes a fake client object so the heap math is testable without any HTTP.
- **Logger contract:** `tests/logging-contract.test.ts` + `tests/logging-snapshot.test.ts` pin the structured-logger shape; re-sync after edits to the canonical (see Key Constraints).
- **Secrets:** `.env.local` for local runs, SSM for the deployed Lambda.

## Deploy model

**Code-only** deploys via `.github/workflows/deploy.yml` on push to `main` (OIDC → `github-actions-deploy`). Break-glass: `gh workflow run Deploy --ref main`. **Infra/template changes** require a full `sam deploy` with admin SSO creds on the laptop (`npm run deploy:infra`); the deploy workflow fails closed if `aws/template.yaml` changed in the landed push.

## Local UI verification

No user-facing web UI — browser smoke N/A. Verification is `npm test`, `npm run check:ts`, and `npx biome ci .` (see Local development) — not a browser.
