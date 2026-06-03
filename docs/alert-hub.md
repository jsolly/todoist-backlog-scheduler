# alert-hub operator emails

todoist-backlog-scheduler uses explicit log groups, metric filters, and alarm names in `aws/template.yaml`.

## Expected emails

| Alarm | Typical body |
| --- | --- |
| `todoist-backlog-scheduler-error-log-count` | Enriched `error:` + `log:` from `/aws/lambda/todoist-backlog-scheduler` |
| `todoist-backlog-scheduler-lambda-errors` | `log:` or `log-search:` for the scheduler function |
| `todoist-backlog-scheduler-rule-failures` | Passthrough (`AWS/Events`) — short reason only |

Contract: `tests/logging-contract.test.ts`. Architecture: `~/code/alert-hub/docs/architecture.md`.

## Logging

Use `createLogger(...).error(message, context, err)` for page-worthy paths (`todoist_backlog_sync_failed`, `Todoist API request failed`, `Failed to update task due date`). Pass `err` as the third argument; do not use `context.error`.

For large or sensitive payloads, use `preparePayloadForLog` + `payloadLogFields` from `src/shared/log-payload.ts` (4 KB full, 8 KB preview, 500-char cap). Todoist error responses log as bounded `responseBody*` preview fields — never full API tokens.

### Agent email lookup

Enriched alarms include lookup lines (`region`, `account`, `alarm-name`, `log-group`, `time-start` / `time-end`, `insights-query`, optional `insights-query-request`). When no error line is found, expect `log-groups` plus lookup metadata. Playbook: `~/code/alert-hub/docs/architecture.md` → **Agent log lookup playbook**.

### Expected context fields

| Message | Context fields |
| --- | --- |
| `todoist_backlog_sync_failed` | `taskCount` (when known), `failurePhase` (`ssm` \| `scheduler`), `ssmParameterName` |
| `Todoist API request failed` | `method`, `path`, `status`, bounded `responseBody*` |
| `Failed to update task due date` | `taskId`, `targetDate`, `failurePhase: "todoist-update"` |
