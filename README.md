# Todoist Backlog Scheduler

## Introduction

The Smart Schedule feature was a valuable asset in Todoist that helped many users efficiently manage their backlog of tasks. However, about three years ago, Todoist discontinued this feature, labeling it as 'overly complex' and not widely used.

To recreate the benefits of Smart Schedule, this project distributes undated tasks (Todoist's `no date` filter) across the upcoming week, biasing toward days that already have fewer tasks scheduled. The scheduler honors your Todoist `start_day` setting (Monday vs Sunday vs anything else), so the "upcoming week" lines up with how you already think about your week.

The scheduler runs every Sunday at 21:00 UTC as an AWS Lambda invoked by EventBridge.

## Stack

- TypeScript (Node 24, ES2024) on AWS Lambda (`arm64`)
- AWS SAM for infrastructure (`aws/template.yaml`)
- SSM Parameter Store for the Todoist API token
- CloudWatch alarms wired to alert-hub for error notifications
- Vitest + Biome + Husky for local quality gates

## Local development

```bash
npm install
echo 'TODOIST_API_KEY=...' > .env  # only needed if you want to run the CLI
npm test                            # vitest
npm run check:ts                    # tsc --noEmit
npx biome ci .                      # lint/format
```

To run the scheduler against your real Todoist account from the terminal:

```bash
TODOIST_API_KEY=... npm run scheduler
```

## Deployment

1. Store the Todoist API key in SSM (one-time):

   ```bash
   aws --profile prod-admin ssm put-parameter \
     --name /todoist-backlog-scheduler/api-key \
     --type SecureString \
     --value '<your-api-key>'
   ```

2. Build and deploy:

   ```bash
   npm run deploy   # sam build && sam deploy
   ```

   First-time deploys can use `sam deploy --guided` to populate `samconfig.toml` interactively.

The Lambda runs every Sunday at 21:00 UTC. CloudWatch logs are retained for 30 days. Errors fan out to john@jsolly.com via the alert-hub project.
