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

## Error Logging & alert-hub

**Goal.** Every uncaught exception or `level=error` log entry from any personal-project Lambda lands in a single email inbox with the actual error text — no need to open CloudWatch.

### Pipeline

```
Lambda (structured JSON logger)
  -> CloudWatch Logs (/aws/lambda/<FunctionName>)
  -> CloudWatch Alarm (AWS/Lambda Errors  AND  custom MetricFilter on level=error)
  -> SNS topic (alert-hub-notifications, ARN at SSM /alert-hub/alert-topic-arn)
  -> alert-hub Enricher Lambda (~/code/alert-hub/aws/enricher/handler.py)
  -> Logs Insights pulls the matching log group's recent error lines
  -> SES email with alarm header + extracted error summary + raw alarm JSON
```

The enricher is best-effort: a Logs Insights timeout or missing log group falls through to a plain passthrough email so an alarm is **never** silenced.

### Downstream Lambda contract

Every Lambda that publishes alarms to alert-hub must:

1. **Use the structured logger.** Never `console.log`/`console.error` in app code.
   - Node source of truth: `~/code/family-memory/src/shared/logging.ts` (port verbatim into other Node repos and keep them in sync). PII masking (phones/emails/tokens), sensitive-key redaction, stable JSON shape.
   - Python: rely on the runtime's `LogFormat: JSON` and `logger.error()` / `logger.exception()`. Logger emits uppercase `"ERROR"` level.
2. **Explicit `AWS::Logs::LogGroup`** named `/aws/lambda/<FunctionName>` with `RetentionInDays: 30`. Wire on the function via `LoggingConfig.LogGroup: !Ref <LogGroup>`.
3. **Explicit `FunctionName`** on each `AWS::Serverless::Function` so the log group name is deterministic instead of `<stack>-<logical>-<hash>`. Hyphenated, repo-prefixed (`misc-notifications-morning-text`, `family-memory-memories`).
4. **Do not set `LogFormat: JSON` on Node Lambdas** — the app-level logger already emits structured JSON; the runtime wrapper would double-wrap. Python Lambdas DO set `LogFormat: JSON` (no app-level logger).
5. **Two alarms per Lambda, both wired to alert-hub** with `AlarmActions` AND `OKActions`:
   - **(a) `AWS::CloudWatch::Alarm` on `AWS/Lambda Errors`** (FunctionName dimension). Catches crashes, timeouts, OOM. Always discoverable by the enricher.
   - **(b) `AWS::Logs::MetricFilter` on `{ $.level = "error" }`** (Node) or `{ $.level = "ERROR" }` (Python) plus a custom-namespace alarm. Catches application-logged errors that didn't crash the invocation (e.g. swallowed per-recipient failure inside a `Promise.allSettled`).
6. **Custom metric namespace must align with the Lambda function-name prefix** so the enricher's prefix discovery (`describe_log_groups(prefix=/aws/lambda/<namespace>)`) finds the right log groups. Example: namespace `family-memory` → matches log groups `/aws/lambda/family-memory-*`. Drift here breaks enrichment for the metric-filter alarm.
7. **Logging contract test** (Node only — Python uses the runtime): `tests/logging-contract.test.ts` pins JSON shape, level values, and PII masking so the enricher's `extract_error_summary` keeps working.

Copy-paste starter that satisfies the contract: `~/code/alert-hub/templates/lambda-logging.yaml`.

### Logger usage

```ts
// Node — instantiate once per module with shared base context.
const logger = createLogger({ job: "morning-text" });

logger.info("Send claimed", { recipient: to, dateLocalIso });
logger.warn("Failed to fetch iCloud calendar", { subsystem: "caldav" }, error);
logger.error("Recipient send failed", { recipient: to }, error);
```

```py
# Python — Lambda runtime renders this as JSON via LogFormat: JSON.
logger.error("Failed to process record", extra={"recipient": to})
logger.exception("Unexpected failure")  # includes traceback
```

`error` argument is serialized via `serializeError` (Node) — `error.name`, `error.message`, `error.cause`, full stack — which is what the alert-hub enricher's `extract_error_summary` reads to render the email's "Error log lines" block.

### Logging levels (cross-repo)

- `info` — expected business rejections (auth failures, invalid input, rate limits) and routine lifecycle events.
- `warn` — early signals that could escalate to an error if ignored, or transient failures that the next retry / next scheduled invocation may recover from on its own.
- `error` — the failure can't be fixed by a retry, or retries have already exhausted. The data is wrong, the operation can't complete, the parser rejected input we expected to parse.

**Per-recipient / per-item error handling inside a fan-out:** wrap with `Promise.allSettled` (or equivalent), then **log each rejected reason at `error`** before re-throwing the aggregate. Lambda's runtime serializes only the top-level error message — without an explicit log-per-failure, the actual cause never reaches the enricher.

### alert-hub side

- **Enricher source:** `~/code/alert-hub/aws/enricher/handler.py`. Logs Insights query is `level = "error" or level = "ERROR"`, sorted desc, limit 20. Extraction parses Node tab-delimited JSON tail and Python-runtime JSON objects, surfacing `error.name + error.message` (or `stackTrace[:5]`).
- **Discovery:** AWS/Lambda alarms → `/aws/lambda/<FunctionName>` (deterministic). Custom namespace alarms → `describe_log_groups(prefix=/aws/lambda/<namespace>)`. `AWS/Scheduler|AWS/SQS|AWS/Events` alarms skip enrichment by design (no per-namespace log group).
- **Self-recursion guard:** any `AlarmName` containing `alert-hub` is passthrough-only, even on `OK` recovery. Prevents the enricher's own metric filter from looping.
- **IAM:** enricher has `logs:StartQuery`, `logs:GetQueryResults`, `logs:DescribeLogGroups` on `*` because it serves arbitrary downstream stacks.

### Adding a new project

1. Resolve the topic ARN in the SAM template:
   ```yaml
   AlertTopicArn:
     Type: AWS::SSM::Parameter::Value<String>
     Default: /alert-hub/alert-topic-arn
   ```
2. Copy the relevant blocks from `~/code/alert-hub/templates/lambda-logging.yaml` (LogGroup + MetricFilter + both alarms).
3. Pick a custom MetricNamespace that matches your Lambda function-name prefix.
4. If publishing alerts directly from app code (not just via alarms), grant `sns:Publish` on `!Ref AlertTopicArn` to the function role.
5. Use the structured logger and emit `level=error` for non-recoverable failures.

## External API calls — retry, backoff, and the warn → error contract

**Goal.** Single transient blips don't fire alarms. Persistent failures always do — with the actual error text in the email.

### The pattern

Every call out to a third-party HTTP API (NWS, iCloud CalDAV, AirNow, EPA UV, OpenAI, Bedrock, Twilio, Apple, Google, etc.) goes through a bounded retry helper:

- **3 attempts** total: immediate, then backoff at ~500ms, then ~1500ms.
- **15s `AbortController` timeout per attempt** (skip when the SDK doesn't accept a signal — Lambda's outer timeout is the floor).
- **Retry on:** HTTP 5xx, network errors, abort/timeout, transient SDK errors.
- **Fail fast on:** HTTP 4xx, schema/parse failures (data is wrong, retrying won't help). Throw a tagged error type the helper recognizes — never regex-match on `error.message`.
- **Between attempts:** `logger.warn("<operation> failed, retrying", { attempt, maxAttempts, backoffMs, ... }, error)`.
- **On retry exhaustion:** `logger.error("<operation> failed after N attempt(s)", { ... }, error)` *before* re-throwing. The explicit `level=error` JSON line is what the alert-hub enricher's Logs Insights query (`level = "error" or level = "ERROR"`) picks up. Lambda's runtime "Invoke Error" line has no `level` field and is invisible to the enricher — relying on it is what breaks alarm enrichment.

The caller decides what to do with the throw: crash-the-job (NWS in misc-notifications) or graceful-degrade (iCloud calendar in misc-notifications — caller catches, logs an application-level `level=error` for context, returns a fallback that lets the rest of the flow continue).

### Why this matters

- "API blipped once, recovered" is silent (warn-level → no alarm).
- "API was genuinely broken across 3 attempts" fires the metric-filter alarm AND ships the error text to the inbox.
- The same alarm that used to wake you up at 5am for a transient 504 now only wakes you up when there's actually something to fix.

### Reference implementation

Node: `~/code/misc-notifications/src/shared/retry.ts` — generic `withRetry(fn, options)` helper plus a `NonRetryableError` tagged class. Port it verbatim into other Node repos when you need it; do not reinvent.

The helper signature accepts an `isRetryable(error)` predicate so callers can extend the default (which only short-circuits `NonRetryableError`) with SDK-specific structured-error checks.

### Don't

- Don't rely on Lambda's async-invoke retry as your retry strategy. It works but the *first* failure always fires the alarm. The whole point is to absorb single blips silently.
- Don't string-match on error messages to classify retryable vs. non-retryable. Use a tagged error class, an `error.code`, or `error.status`.
- Don't add `setTimeout`-based fallback handlers outside the helper. Race-condition masking via `setTimeout` is forbidden by the global rules; retry backoff inside `withRetry` is the carve-out.
- Don't double-log on graceful degradation in a confusing way. The helper logs the infrastructure failure ("X failed after N attempts"); the application-layer caller logs the user-visible outcome ("calendar feature degraded — shipping MMS with note"). Both are useful. They have different messages and the same metric filter counts both — same alarm fires either way.

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

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description`

Common types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `test`, `perf`. Scope is the area of the codebase (e.g., `auth`, `notifications`, `e2e`, `deps`).

## Code Style

These are prototypes / non-critical apps. Breaking changes are free. Default to destructive forward edits over preserving old behavior.

Every Lambda is wired to **alert-hub** (see the Error Logging section above) — uncaught exceptions and `level=error` logs land in an email inbox with the actual error text. The goal is visibility, not crashes: don't swallow failures, but don't escalate to `error` while retries are still in flight and a 200 is still possible. Mid-retry failures are `warn`; only log `error` when the operation can't recover (retries exhausted, non-retryable status, parser rejected expected input).

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
