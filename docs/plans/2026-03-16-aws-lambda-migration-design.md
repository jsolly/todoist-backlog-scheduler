# AWS Lambda Migration Design

## Motivation

- Vercel only retains 12 hours of logs — insufficient visibility for a weekly cron
- Downgrading Vercel to free tier (no crons)
- Prefer IaaS (AWS) for infrastructure ownership

## Architecture

**What stays the same:**
- `schedule_tasks.py` — core business logic, untouched
- `requirements.txt` — same dependencies
- GitHub Actions workflow — kept as reference for other users

**What changes:**
- `api/scheduled.py` (Vercel handler) → `lambda_handler.py`
- `vercel.json` → SAM `template.yaml`
- Vercel cron → EventBridge scheduled rule
- Vercel env vars → SSM Parameter Store (SecureString)

**Flow:**
EventBridge (cron: Sunday 9PM UTC) → Lambda → reads API key from SSM → calls `run_scheduler()` → logs to CloudWatch (30-day retention)

## SAM Template Resources

1. **Lambda Function** — Python 3.11, 128MB memory, 30s timeout
2. **EventBridge Rule** — `cron(0 21 ? * SUN *)` via SAM `Schedule` event
3. **CloudWatch Log Group** — explicit, 30-day retention

**IAM:** `ssm:GetParameter` on `/todoist-backlog-scheduler/api-key` (CloudWatch Logs added automatically by SAM)

## Lambda Handler

- Thin wrapper around `run_scheduler()`
- Fetches `TODOIST_API_KEY` from SSM at invocation time
- Sets it as env var so `schedule_tasks.py` works unmodified
- Logs result as JSON for CloudWatch querying

## Deployment

**One-time setup:**
1. `aws ssm put-parameter --name "/todoist-backlog-scheduler/api-key" --type SecureString --value "<key>"`
2. `sam build && sam deploy --guided`

**Subsequent deploys:**
- `sam build && sam deploy`

**Testing:**
- `sam local invoke` for local testing
- `aws lambda invoke` after deploy to verify

## Cleanup

- Delete `api/scheduled.py`, `vercel.json`, `.vercel/`
- Optionally unlink from Vercel dashboard
