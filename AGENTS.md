## Purpose

Small personal utility with no users beyond the author — optimize for simplicity and correctness. Prefer aggressively simplifying redesigns over preserving backwards compatibility.

## Commands

```bash
python schedule_tasks.py       # Run locally (uses .env for TODOIST_API_KEY)
sam build                      # Build Lambda package
sam deploy                     # Deploy to AWS
sam deploy --guided            # First-time deploy with prompts
```

## Architecture

**Todoist Backlog Scheduler** — recreates Todoist's discontinued "Smart Schedule" feature. Distributes undated tasks evenly across the upcoming week using a min-heap algorithm, respecting the user's configured week start day.

**Stack:** Python 3.13, AWS Lambda (SAM), EventBridge (weekly cron), SSM Parameter Store, CloudWatch Alarms + SNS (alerting), Todoist API.

### Key Files

- `schedule_tasks.py` — Core scheduling logic (heap-based task distribution)
- `lambda_handler.py` — AWS Lambda entry point (fetches API key from SSM, sets env var)
- `template.yaml` — SAM/CloudFormation IaC definition
- `samconfig.toml` — SAM CLI deployment config

## Key Constraints

- **Python 3.13** runtime (matches Lambda config in `template.yaml`)
- **AWS SAM** for all infrastructure — no other IaC tools
- **SSM Parameter Store** for secrets — never hardcode API keys
- **`sam deploy`** after any change to **`template.yaml`** (SAM template lives at the repository root; synced rules that mention `aws/template.yaml` refer to other repos)

## Error Handling

- **Fail fast**: No silent fallbacks or default values on unexpected errors.
- **Deterministic error checking**: Use structured error properties, not string matching on messages.

## Logging

- **`LoggingConfig.LogFormat: JSON`** is set on `SchedulerFunction` in `template.yaml`. Python's Lambda runtime emits structured records (`level`, `timestamp`, `message`, `requestId`, `stackTrace`, `errorType`) automatically — use stdlib `logging` (`logger = logging.getLogger(__name__)`) and call `logger.error(...)` / `logger.exception(...)`. Never `print()`.
- **`ErrorMetricFilter` + `ErrorLogAlarm`** in `template.yaml` watch `{ $.level = "ERROR" }` and fire via alert-hub on any logged error, alongside the `AWS/Lambda Errors` alarm that catches runtime crashes. Both are wired to the alert-hub SNS topic via SSM param `/alert-hub/alert-topic-arn` on `AlarmActions` + `OKActions`.
- This repo is the canonical Python reference for the cross-repo Lambda logging pattern documented in `~/.agents/AGENTS.md` → "Lambda Logging". Node projects use a different approach (app-level JSON logger, no `LogFormat: JSON`) — see `~/code/family-memory` / `~/code/misc-notifications`.

<!-- BEGIN GLOBAL RULES (managed by sync-global-agents.sh) -->
## Family Memory

When the family-memory MCP is available, call `recall` (no args) at conversation start to load context about the user. Use `remember` to store notable new facts, preferences, or events that come up naturally.

## Collaboration

- Use `--headed --persistent` when launching playwright-cli for interactive browser sessions. Without `--headed`, it defaults to headless.
- No pull requests for personal projects. `/review-fix-push` skill is the sole review gate — reviews local changes against remote, fixes issues, commits and pushes.
- Custom skills live at `~/.agents/skills/` (e.g., `~/.agents/skills/review-fix-push/SKILL.md`), not `.claude/plugins/`.
- `~/.cursor/skills/` and `~/.claude/skills/` must be **real directories** (not symlinks to `~/.agents/skills/`). The `npx skills add` installer stores content in `~/.agents/skills/<name>/` then creates per-skill symlinks from each agent dir — directory-level symlinks cause circular links.
- Family/domain knowledge lives in the family-memory MCP, not in flat files.
- Don't create new IAM users or roles when an existing one can be reused — these are personal projects, avoid role sprawl.
- Always run `sam deploy` after modifying `aws/template.yaml` — there's no CI for SAM stacks, only code-only updates deploy via GitHub Actions.

## AWS

- Use `--profile prod-admin` for all production AWS commands.
- SSO profiles: `prod-admin` (730335616323, production), `general-admin` (541310242108), `amplify-admin`, `jsolly-sandbox`, `jsolly-dev`.

## Lambda Logging (TL;DR)

- alert-hub enricher is alarm passthrough only (no Logs Insights dependency): `~/code/alert-hub/aws/enricher/handler.py`.
- Use the standard SAM copy-paste resources for Lambda log group + metric filter + dual alarms: `~/code/alert-hub/templates/lambda-logging.yaml`.
- Node source of truth for structured logger shape and masking: `~/code/family-memory/src/shared/logging.ts`.
- Python reference for runtime JSON logging pattern: `~/code/todoist-backlog-scheduler/template.yaml`.
- Keep behavior pinned with logging contract tests (`level=error`, stable JSON shape, PII masked): `tests/logging-contract.test.ts` in Node repos.

## User Context

Software engineer turned CTO at Leidos (FedCiv DIGMOD). When exploring ideas or thinking through design, be discursive and collaborative — follow the thread, steel-man arguments, don't lecture. Prefer being challenged over being reassured. Surface things I haven't considered.

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

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description`

Common types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `test`, `perf`. Scope is the area of the codebase (e.g., `auth`, `notifications`, `e2e`, `deps`).

## Code Style

- **No compatibility layers**: No shims, adapters, deprecations, or re-exports for legacy behavior.
- **No browser polyfills**: Modern browser APIs (`fetch`, `URL`, `AbortController`, `crypto.randomUUID()`, etc.) are assumed. Server-side polyfills are fine when Node.js lacks the API.
- **Relative paths only**: No `@`-style aliases.
- **No barrel files / re-exports**: Import from the defining module, not intermediary files.
- **No timing hacks**: No `setTimeout`/`nextTick`/`requestAnimationFrame` to mask race conditions. Fix the root cause. Legitimate uses (debouncing, throttling) are fine.

## Error Handling

- **Trust the type system**: Skip defensive null/undefined checks when strict TypeScript or DB constraints guarantee safety. Add checks only when values can legitimately be missing (parsed JSON, nullable columns, third-party payloads).
- **Deterministic error checking**: Use structured error properties (`error.code`, `error.status`), not string matching (`.includes()`) on messages.
- **Fail fast**: No silent fallbacks or default values on unexpected errors. If a fallback is needed for resilience, gate it on structured error properties and log with context.
- **Logging levels**: Expected rejections (auth failures, invalid input, rate limits) → `info`, not `warn`/`error`. Reserve `warn`/`error` for genuine failures (DB errors, service outages).

## Testing Philosophy

- **Scenario-based coverage**: Cover real-world scenarios that could happen in production — not to maximize code coverage or add a test file per source file. Each test should represent a plausible user journey or system event.
- **Integration over isolation**: Prefer integration tests that use real dependencies. Only mock external services that consume paid API allocations.
- **Assert via behavior, not mocks**: Prefer asserting on DB state, response payloads, and status codes rather than on mocked return values or call counts.
- **Realistic data**: Use real names, realistic values, and plausible details. Never use placeholder values like `foo`, `bar`, `test123`, or round numbers when a realistic value would work.
- **Scenario-based test style**: Frame `describe`/`it` blocks around user journeys or system events, not abstract technical operations.
  - Good: `"User in Pacific timezone receives market update after close"`
  - Bad: `"returns correct value when input is 2"`
<!-- END GLOBAL RULES (managed by sync-global-agents.sh) -->
