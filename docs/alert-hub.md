# alert-hub operator emails

todoist-backlog-scheduler uses explicit log groups, metric filters, and alarm names in `aws/template.yaml`.

## Expected emails

| Alarm | Typical body |
| --- | --- |
| `todoist-backlog-scheduler-error-log-count` | Enriched `error:` + `log:` from `/aws/lambda/todoist-backlog-scheduler` |
| `todoist-backlog-scheduler-lambda-errors` | `log:` or `log-search:` for the scheduler function |
| `todoist-backlog-scheduler-rule-failures` | Passthrough (`AWS/Events`) — short reason only |

Contract: `tests/logging-contract.test.ts`. Architecture: `~/code/alert-hub/docs/architecture.md`.
