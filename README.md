# Todoist Backlog Scheduler

## Introduction

The Smart Schedule feature was a valuable asset in Todoist that helped many users efficiently manage their backlog of tasks. Todoist removed it, labeling it as 'overly complex' and not widely used.

To recreate the benefits of Smart Schedule, this project distributes undated tasks (Todoist's `no date` filter) across the upcoming week, biasing toward days that already have fewer tasks scheduled. The scheduler honors your Todoist `start_day` setting (Monday vs Sunday vs anything else), so the "upcoming week" lines up with how you already think about your week.

The scheduler runs every Sunday at 21:00 UTC as an AWS Lambda invoked by EventBridge.

## How scheduling works

### Without a daily cap (default)

All undated tasks land in the upcoming week, no matter how many there are — there's no overflow to subsequent weeks in this mode. Each task is assigned to whichever day currently has the fewest tasks (a min-heap), so the week ends up roughly balanced. Task order is preserved as-is from the API.

To spill overflow into subsequent weeks, set `MAX_TASKS_PER_DAY` (see below).

### With a daily cap (`MAX_TASKS_PER_DAY`)

Set the `MAX_TASKS_PER_DAY` environment variable to limit how many total tasks any single day can hold. Existing tasks already on the calendar count toward this limit.

The distribution follows these rules:

1. **Sort by age.** All undated tasks are sorted oldest-first by creation date.
2. **Fill the upcoming week, balanced and front-loaded.** Tasks are assigned to days in chronological order (Monday first, then Tuesday, etc.). Each day gets roughly the same number of new tasks — at most one more than any other day. When the week has enough capacity to hold all tasks, they spread evenly (e.g. 5 tasks across 7 days = one per day for 5 days). When the week is full, each day fills to the cap.
3. **Oldest tasks land on the earliest days.** Because tasks are sorted oldest-first and days are filled in order, the oldest tasks always end up on the earliest days of the week.
4. **Overflow to the next week.** If the week's capacity (`maxPerDay × 7` minus existing tasks) isn't enough, the remaining (newest) tasks spill into the following week. The same balanced distribution applies there. This continues week by week until every task is placed.
5. **Skip full days.** If a day already has `maxPerDay` or more tasks, it gets zero new tasks and doesn't affect the balance calculation.

**Examples (week starts Monday, cap = 5, empty calendar):**

| Undated tasks | Mon | Tue | Wed | Thu | Fri | Sat | Sun | Overflow          |
|---------------|-----|-----|-----|-----|-----|-----|-----|-------------------|
| 5             | 1   | 1   | 1   | 1   | 1   | 0   | 0   | none              |
| 10            | 2   | 2   | 2   | 1   | 1   | 1   | 1   | none              |
| 35            | 5   | 5   | 5   | 5   | 5   | 5   | 5   | none              |
| 40            | 5   | 5   | 5   | 5   | 5   | 5   | 5   | 5 newest → week 2 |

With existing tasks: if Monday already has 3 tasks and the cap is 5, Monday can absorb 2 more. The rest of the week absorbs the remainder, balanced as above.

**Configuration:**

For local runs:

```bash
MAX_TASKS_PER_DAY=5 TODOIST_API_KEY=... npm run scheduler
```

For the deployed Lambda, pass it as a CloudFormation parameter:

```bash
sam deploy --parameter-overrides MaxTasksPerDay=5
```

## Stack

- TypeScript (Node 24, ES2024) on AWS Lambda (`arm64`)
- AWS SAM for infrastructure (`aws/template.yaml`)
- SSM Parameter Store for the Todoist API token
- CloudWatch alarms wired to shared-infra for error notifications
- Vitest + Biome + native git hooks (`.git-hooks/`) for local quality gates

## Local development

```bash
npm install
echo 'TODOIST_API_KEY=...' > .env.local  # only needed if you want to run the CLI
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
   aws ssm put-parameter \
     --name /todoist-backlog-scheduler/api-key \
     --type SecureString \
     --value '<your-api-key>'
   ```

2. Build and deploy:

   ```bash
   npm run deploy   # sam build && sam deploy
   ```

   First-time deploys: copy `samconfig.toml.example` → `samconfig.toml` (gitignored), or run `sam deploy --guided`. Set `AWS_PROFILE` locally for SSO.

The Lambda runs every Sunday at 21:00 UTC. CloudWatch logs are retained for 30 days. Errors fan out to <john@jsolly.com> via the shared-infra project.
