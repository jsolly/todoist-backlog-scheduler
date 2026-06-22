# todoist: fetch the Todoist API key at runtime from SSM SecureString

**Spec:** `shared-infra/docs/specs/2026-06-22-secret-runtime-fetch-design.md`
(cross-repo — the fleet-wide design this plan is the reference implementation of)

## Spec (inline)

- **Goal:** Stop shipping `TODOIST_API_KEY` as a plaintext Lambda environment variable.
  Fetch it at runtime from an SSM `SecureString` parameter, so the secret sits behind
  `ssm:GetParameter` (which the planned Tier-1 read-only role denies) instead of behind
  `lambda:GetFunctionConfiguration` (which it can't sensibly deny).
- **Problem:** The 2026-06-22 audit found `NoEcho: true` is universal but moot — every
  fleet secret is injected into Lambda env vars via `!Ref`, and `agent-deploy` holds
  `lambda:GetFunction`/`GetFunctionConfiguration`, both of which return env vars in
  plaintext. todoist is the smallest case (one secret) and the chosen reference impl;
  `stocktextalerts` (largest surface) goes last. Ordering decision (resolved 2026-06-22):
  **migrate secrets first, then mint the read-only role** — so no interim IAM `Deny` is
  needed here.
- **Acceptance:** After deploy, `aws lambda get-function-configuration --function-name
  todoist-backlog-scheduler` shows **no** `TODOIST_API_KEY` value in `Environment.Variables`
  — only `TODOIST_API_KEY_SSM_PARAM` (the param *name*). The Sunday cron still runs and
  distributes tasks (or a manual invoke succeeds). `npm test` + the pre-push gate stay green.

## Current state (what changes)

| Concern | Today | After |
| --- | --- | --- |
| SAM param | `TodoistApiKey` (`NoEcho`) | removed |
| Lambda env | `TODOIST_API_KEY: !Ref TodoistApiKey` | `TODOIST_API_KEY_SSM_PARAM: /todoist-backlog-scheduler/api-key` |
| Secret value home | `.env.local` → `--parameter-overrides` → env var | SSM `SecureString` `/todoist-backlog-scheduler/api-key` |
| Code read | `process.env.TODOIST_API_KEY` (`src/scheduler.ts:155`) | `await getTodoistApiKey()` (SSM fetch, module-cached; env fallback for local/tests) |
| Function IAM | none for secrets | `ssm:GetParameter` on the one param ARN |

## Tasks

### 1. Add the runtime-fetch helper

- New file `src/shared/secrets.ts` exporting `getTodoistApiKey(): Promise<string>`:
  - Module-scope cache (`let cached: string | undefined`) so warm invokes don't re-fetch.
  - **Local/test fallback first:** if `process.env.TODOIST_API_KEY` is set, return it (keeps
    vitest and local runs offline — prod never sets this env, so it always falls through to SSM
    in the Lambda).
  - Else read `process.env.TODOIST_API_KEY_SSM_PARAM`, call
    `ssm.getParameter({ Name, WithDecryption: true })`, cache, return. Throw a clear error
    if the param name env is unset or the value is empty.
  - Use `@aws-sdk/client-ssm`. **Mark it esbuild-external** (the nodejs24.x runtime provides
    SDK v3) — see task 3 — and add it as a `devDependency` only, for types + local resolution.

### 2. Switch the consumer to the helper

- `src/scheduler.ts:155` — replace `const apiKey = process.env.TODOIST_API_KEY; if (!apiKey)…`
  with `const apiKey = await getTodoistApiKey();` (it already throws on missing). Import from
  `./shared/secrets.ts`.
- `aws/src/handlers/scheduler.ts:9-11` — remove the `if (!process.env.TODOIST_API_KEY) throw`
  precheck; the fetch in `runScheduler()` now owns that failure path (and would otherwise
  false-negative since the env var no longer exists in prod).

### 3. Template: drop the param + env, add the param-name env + IAM

In `aws/template.yaml`:

- Delete the `TodoistApiKey` parameter.
- In `SchedulerFunction.Environment.Variables`: replace `TODOIST_API_KEY: !Ref TodoistApiKey`
  with `TODOIST_API_KEY_SSM_PARAM: /todoist-backlog-scheduler/api-key`.
- Add to `SchedulerFunction.Properties` a `Policies:` block granting **only**:

  ```yaml
  Policies:
    - Statement:
        - Effect: Allow
          Action: ssm:GetParameter
          Resource: !Sub "arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/todoist-backlog-scheduler/api-key"
  ```

  No `kms:Decrypt` needed: the param uses the AWS-managed `alias/aws/ssm` key, whose key
  policy already delegates decryption to the account's IAM via `kms:ViaService`. (Add an
  explicit `kms:Decrypt` scoped by `kms:ViaService: ssm.${Region}.amazonaws.com` **only** if
  this is ever switched to a customer-managed CMK.)
- In `SchedulerFunction.Metadata.BuildProperties` add `External: ["@aws-sdk/*"]` so esbuild
  resolves the SDK from the Lambda runtime instead of bundling it (smaller bundle; matches
  AWS guidance for Node 18+).

### 4. Deploy scripts + samconfig

- `aws/sam-params.sh` — remove `"TodoistApiKey=$TODOIST_API_KEY"` from `SAM_PARAMS` and the
  `: "${TODOIST_API_KEY:?…}"` assertion. (`.env.local` no longer needs `TODOIST_API_KEY` for
  *deploy*; keep it only if you want the local-dev fallback in task 1.)
- `samconfig.toml` **and** `samconfig.toml.example` — remove `TodoistApiKey` from
  `parameter_overrides` (the full deploy replaces the override set wholesale, so it must match).

### 5. Tests

- Update any vitest test that sets `process.env.TODOIST_API_KEY` — they keep working as-is via
  the local/test fallback (task 1). Add one unit test for `getTodoistApiKey()`: env-set path
  returns the env value; env-unset path calls the SSM client (mock `@aws-sdk/client-ssm`).
- `grep -rn TODOIST_API_KEY test*/ src/**/*.test.ts` to find them before editing.

## Human steps (admin / MFA — agent proposes, human runs)

These are the infra-mutation + secret-write actions the agent must not run
(`rules/agent-cloud-access.md`):

1. **Create the SecureString** (one-time, before deploy):

   ```bash
   aws ssm put-parameter \
     --name /todoist-backlog-scheduler/api-key \
     --type SecureString \
     --value "<the Todoist API key>" \
     --overwrite --region us-east-1
   ```

2. **Full deploy** (applies template + IAM + code):

   ```bash
   npm run deploy        # aws/deploy.sh — sam build + sam deploy, admin SSO creds
   ```

## Verification

- **Acceptance check (the whole point):**

  ```bash
  aws lambda get-function-configuration --function-name todoist-backlog-scheduler \
    --query 'Environment.Variables' --output json
  ```

  Confirm `TODOIST_API_KEY` is **absent** and `TODOIST_API_KEY_SSM_PARAM` is present.
- **Functional:** manually invoke (`aws lambda invoke --function-name todoist-backlog-scheduler
  /dev/stdout`) or wait for the Sunday cron; confirm `tasksDistributed` in the logs and no
  `error`-level lines (the error-log alarm would otherwise fire).
- **Gate:** `npm test`, `npm run check:ts`, and the pre-push battery green.

## Out of scope / follow-ups

- The other repos (`misc-notifications`, `family-memory`, `stocktextalerts`) follow the same
  pattern per the spec — `stocktextalerts`'s Twilio bundle + larger surface is the last and
  may use Secrets Manager (Option B) for the multi-field/rotation case.
- Minting the Tier-1 read-only role happens **after** this migration lands fleet-wide (the
  resolved ordering), at which point its `Deny secretsmanager:GetSecretValue` +
  `ssm:GetParameter*` finally delivers "read-only ≠ read-secrets" for real.
