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

## Logging & alert-hub

Every personal-project Lambda is wired to **alert-hub**: structured JSON logs, CloudWatch alarms on `AWS/Lambda Errors` + a `level=error` MetricFilter, both routed to an SNS topic that an enricher Lambda turns into an email with the actual error text. To learn the patterns (logger shape, SAM wiring, retry helper, fan-out error handling), look at existing repos before adding a new one: `~/code/alert-hub` (the hub), `~/code/misc-notifications` (Node logger + retry helper + contract test), `~/code/family-memory` (Node logger + contract test), `~/code/todoist-backlog-scheduler` (Python equivalent).

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

## Code Style

These are prototypes / non-critical apps. Breaking changes are free. Default to destructive forward edits over preserving old behavior.

- **No compatibility layers**: No shims, adapters, deprecations, or re-exports for legacy behavior.
- **No browser polyfills**: Modern browser APIs (`fetch`, `URL`, `AbortController`, `crypto.randomUUID()`, etc.) are assumed. Server-side polyfills are fine when Node.js lacks the API.
- **Relative paths only**: No `@`-style aliases.
- **No barrel files / re-exports**: Import from the defining module, not intermediary files.
- **No timing hacks**: No `setTimeout`/`nextTick`/`requestAnimationFrame` to mask race conditions. Fix the root cause. Legitimate uses (debouncing, throttling) are fine.
- **No dead-shape parsing**: When you change a data shape, delete the branches that handled the old shape. Don't keep them "just in case."
- **No unused schema fields**: If a column/field is no longer read or written, drop it. Don't preserve it for hypothetical old clients.
- **No migration files for schema churn**: Edit the schema in place and recreate the DB. Migrations are for stacks with real users, not prototypes.
- **No feature flags for rollout**: Just ship the new behavior. Flags are for prod traffic you're afraid to break.
- **Delete, don't comment out**: Git history is the archive.

## Error Handling

- **Trust the type system**: Skip defensive null/undefined checks when strict TypeScript or DB constraints guarantee safety. Add checks only when values can legitimately be missing (parsed JSON, nullable columns, third-party payloads).
- **Deterministic error checking**: Use structured error properties (`error.code`, `error.status`), not string matching (`.includes()`) on messages.
- **No swallowed errors, no silent fallbacks**: Don't catch-and-ignore, don't substitute default values for unexpected failures, don't add recovery branches that hide logic bugs. Surface the failure. Retries on structured transient failures (e.g. 429, network timeout via `error.code`/`error.status`) are fine — log them at `warn` while retrying, escalate to `error` only when retries are exhausted or the failure isn't retryable.
- **Logging levels**:
  - `info` — expected business rejections (auth failures, invalid input, rate limits) and routine lifecycle events.
  - `warn` — early signals that could escalate to an error if ignored, or transient failures that the next retry / next scheduled invocation may recover from on its own.
  - `error` — the failure can't be fixed by a retry, or retries have already exhausted. The data is wrong, the operation can't complete, the parser rejected input we expected to parse.

## Testing Philosophy

- **Scenario-based coverage**: Cover real-world scenarios that could happen in production — not to maximize code coverage or add a test file per source file. Each test should represent a plausible user journey or system event.
- **Integration over isolation**: Prefer integration tests that use real dependencies. Only mock external services that consume paid API allocations.
- **Assert via behavior, not mocks**: Prefer asserting on DB state, response payloads, and status codes rather than on mocked return values or call counts.
- **Realistic data**: Use real names, realistic values, and plausible details. Never use placeholder values like `foo`, `bar`, `test123`, or round numbers when a realistic value would work.
- **Scenario-based test style**: Frame `describe`/`it` blocks around user journeys or system events, not abstract technical operations.
  - Good: `"User in Pacific timezone receives market update after close"`
  - Bad: `"returns correct value when input is 2"`
<!-- END GLOBAL RULES (managed by sync-global-agents.sh) -->
