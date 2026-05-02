## Purpose

Small personal utility with no users beyond the author — optimize for simplicity and correctness. Prefer aggressively simplifying redesigns over preserving backwards compatibility.

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
- **SSM Parameter Store** for secrets — never hardcode API keys
- **`sam deploy`** after any change to **`aws/template.yaml`**
- **Do not edit `src/shared/logging.ts` or `tests/logging-contract.test.ts` directly.** They're synced from `~/code/family-memory` by `~/code/family-memory/scripts/sync-shared-logger.sh sync`. The pre-commit hook fails if the snapshot hash drifts.

## Error Handling

- **Fail fast**: No silent fallbacks or default values on unexpected errors.
- **Deterministic error checking**: Use structured error properties, not string matching on messages.

## Logging

- **App-level structured JSON logger.** `import { createLogger } from "./shared/logging"` (or relative path from handlers). Never `console.log`/`console.error` in `src/**` — Biome's `noConsole: error` enforces this.
- **No `LogFormat: JSON`** on the Lambda — the app emits the JSON line itself; the runtime wrapper would double-encode and break the metric filter.
- **`SchedulerErrorLogFilter` + `SchedulerErrorLogAlarm`** in `aws/template.yaml` watch `{ $.level = "error" }` (lowercase, Node convention) and fire via alert-hub on any logged error, alongside the `SchedulerLambdaErrorsAlarm` (on `AWS/Lambda Errors`) that catches runtime crashes/timeouts/OOM. Both wire `AlarmActions` + `OKActions` to the alert-hub SNS topic via SSM param `/alert-hub/alert-topic-arn`.

## Testing

- **Runtime:** Node 24, vitest. `npm test` runs the suite.
- **Layout:** Tests live under `tests/` named after the scenario family (e.g. `scheduler.test.ts`), not 1:1 per source file.
- **Scenarios:** Frame `describe`/`it` around real scheduling outcomes — week boundaries, heap distribution, empty backlog, week-start preference — not abstract single-line unit checks.
- **External calls:** Stub `globalThis.fetch` for end-to-end paths that would otherwise hit Todoist. Pure logic (`distributeTasks`) takes a fake client object so the heap math is testable without any HTTP.
- **Logger contract:** `tests/logging-contract.test.ts` and `tests/logging-snapshot.test.ts` are synced from `~/code/family-memory` and pin the structured-logger shape — do not edit them locally; re-sync via `~/code/family-memory/scripts/sync-shared-logger.sh sync`.
- **Secrets:** Never commit Todoist API keys; use `.env` for local runs and SSM for the deployed Lambda.

<!-- BEGIN GLOBAL RULES (managed by sync-global-agents.sh) -->
## Family Memory

When the family-memory MCP is available, call `recall` (no args) at conversation start to load context about the user. Use `remember` to store notable new facts, preferences, or events that come up naturally.

## Collaboration

- No pull requests for personal projects. `/review-fix-push` skill is the sole review gate — reviews local changes against remote, fixes issues, commits and pushes.
- Custom skills live at `~/.agents/skills/` (e.g., `~/.agents/skills/review-fix-push/SKILL.md`), not `.claude/plugins/`.
- `~/.cursor/skills/` and `~/.claude/skills/` must be **real directories** (not symlinks to `~/.agents/skills/`). The `npx skills add` installer stores content in `~/.agents/skills/<name>/` then creates per-skill symlinks from each agent dir — directory-level symlinks cause circular links.
- Family/domain knowledge lives in the family-memory MCP, not in flat files.

## User Context

Software engineer turned Sr. Director at Leidos (Health-IT under DIGMOD). I use this chat to think through ideas, explore topics, write code, and have real conversations.

When exploring ideas, be discursive and collaborative — follow the thread wherever it goes, even if it gets uncomfortable. Steel-man arguments, don't lecture. When I'm vague, call it out directly. When my logic doesn't hold up, say so. I'd rather be challenged than reassured. I value extreme bluntness, the proactive surfacing of things I haven't considered, and getting closer to the truth over reaching a comfortable answer.

## Conversation Preferences

- **Ask when ambiguous.** If there's one obvious approach, just do it. If there are meaningful tradeoffs or multiple paths, stop and ask.
- **Layered questions.** Ask the 2-3 most critical questions first, start on what's clear, then follow up as you go.
- **Present options with a recommendation.** "Here are approaches X, Y, Z. I'd recommend Y because..." — then wait.
- **Brief rationale.** A sentence or two on the "why" is enough. Don't belabor it.
- **Casual and direct.** Like a coworker on Slack. No hedging, no filler.
- **Do what I asked, but flag concerns.** If you think the approach has issues, implement it and note the concern — don't silently diverge.
- **Update at the end.** Show the result when done. Only interrupt mid-task if blocked.
- **Proactively improve adjacent code.** If you see something nearby that could be better, clean it up. Prefer deep refactoring over preserving backwards compatibility.
- **Concise responses.** Short, dense with information. I can ask for more detail.
- **When uncertain, ask.** Don't guess at project conventions, intent, or technical details — even if it slows things down.
<!-- END GLOBAL RULES (managed by sync-global-agents.sh) -->
