# Optional PostgreSQL implementation

Eight inactive n8n workflows implement the assignment with PostgreSQL-backed discovery, deduplication, enrichment, AI pitches, Slack delivery, retries, and recovery.

Target supplied by the user: https://tryedwin.app.n8n.cloud/workflow/cihlgiO4ZiWvgPlB

**Status:** implemented and tested locally. These files have not been imported into or executed on that n8n Cloud instance. No live GitHub/LLM/Slack calls or real channel messages were made during verification. The screenshot, submission Logic Log, and demo recording are deferred. The older files in the parent directory were preserved and are not this implementation.

## Files

| File | Purpose |
| --- | --- |
| `sql/schema.sql` | Idempotent schema and transactional state functions; PostgreSQL 14+ with pgcrypto |
| `workflows/00-configure-repository.json` | Manual repository configuration and identity validation |
| `workflows/10-github-request.json` | Shared authenticated GitHub GET, pacing, rate-limit classification |
| `workflows/20-poll-stargazers.json` | Paginated, leased polling discovery |
| `workflows/21-receive-webhook.json` | Raw-body signature verification and durable webhook ingestion |
| `workflows/30-process-one-lead.json` | One independently claimed lead through profile, filter, AI, Slack |
| `workflows/31-worker-schedule.json` | Up to ten sequential processing calls each minute |
| `workflows/40-recover-work.json` | Expired lease recovery every five minutes |
| `workflows/50-record-errors.json` | Sanitized unexpected execution errors |
| `src/core.cjs` | Pure functions embedded into generated Code nodes |
| `scripts/build.cjs` | Reproducible workflow generator; no network calls |
| `tests/` | Boundary tests and generated-workflow harness using actual PostgreSQL SQL |
| `config.example.json` | Optional non-secret credential IDs, workflow IDs, and repository settings |

## Prerequisites

1. n8n Cloud with Code, Postgres, HTTP Request, Basic LLM Chain, OpenAI Chat Model, and sub-workflow support.
2. A PostgreSQL database reachable from n8n Cloud over verified TLS. A database only reachable on this Windows computer's localhost will not work with n8n Cloud.
3. Permission to install/use `pgcrypto`. The migration supports the extension in `public` or `extensions`, as used by some managed database providers.
4. GitHub credentials able to fetch the chosen repository and user profiles, plus permission to list stargazers for polling or administer a repository webhook.
5. An OpenAI credential with access to the configured model. Default: `gpt-4o-mini`, matching the existing local implementation's provider. Change the model in repository setup if required.
6. A Slack incoming webhook for the intended channel.

GitHub's current stargazer API documentation describes admin/collaborator restrictions. Public repository metadata access is not proof that its stargazer list is accessible. Verify the actual listing endpoint before committing to polling. If access is absent, choose an accessible repository or request an evaluator-approved substitution; do not scrape around the restriction.

## Install in n8n Cloud

### 1. Prepare the database

Run `sql/schema.sql` in the database provider's SQL editor or an administrative PostgreSQL connection. It creates only the `lead_sniper` application schema and pgcrypto, and preserves existing records when rerun. Keep it separate from n8n's own database tables.

Create/select a dedicated n8n PostgreSQL credential with access to this schema, its sequences, functions and tables. Use TLS with certificate verification. Do not use a database login shared with untrusted workflows: this application's secret table contains the Slack webhook URL and, in webhook mode, the GitHub signing secret.

### 2. Import workflows

Import these first into separate n8n workflows:

1. `50-record-errors.json`
2. `10-github-request.json`
3. `30-process-one-lead.json`
4. The remaining files.

You may import `31-worker-schedule.json` into the supplied target workflow. Back up its existing contents first, and do not replace an active production workflow without stopping its old schedule. The implementation has not changed that remote workflow.

Imported IDs may differ from those in the JSON files. **Select the imported workflow by name in each Execute Sub-workflow node**, rather than assuming IDs were retained:

| Parent | Sub-workflow to select |
| --- | --- |
| Setup / Verify GitHub Repository | C - GitHub Request |
| A - Poll Stargazers / Fetch Stargazer Page | C - GitHub Request |
| B - Process One Lead / Fetch Full Profile | C - GitHub Request |
| B - Worker Schedule / Process One Lead | B - Process One Lead |

Set **E - Record Unexpected Errors** as the Error Workflow for the other seven workflows in their Settings. Do not assign an error workflow to E itself. Leave all workflows inactive during setup.

### 3. Bind credentials

- Select your PostgreSQL credential on every Postgres node.
- Select your GitHub credential on **C / Request GitHub**.
- Select your OpenAI credential on **B - Process One Lead / OpenAI Chat Model**.

For many repeated credential selections, populate `config.local.json` from `config.example.json` with existing credential IDs and actual imported sub-workflow IDs, then rebuild. These are references, not API keys. Never put real tokens or webhook URLs in that file or in Code nodes.

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
node scripts/build.cjs config.local.json
```

Re-import the appropriate regenerated files into their existing draft workflows and re-check references. Alternatively, select credentials directly in the editor without installing any local runtime. The generated workflows are self-contained; n8n Cloud does not need this source folder or npm dependencies.

### 4. Configure the repository

In **Setup / Repository Configuration**, replace the owner/name placeholders, choose `polling` or `webhook`, and optionally provide product context. Run this setup workflow manually.

It fetches the repository identity through GitHub, saves its numeric ID and canonical owner/name, and establishes the monitoring-start timestamp. Configuration starts disabled. Running setup again for the same repository preserves that timestamp and existing state. A different repository requires a separate application schema/database.

Setup verifies the repository endpoint, not list-stargazer permissions. A redirect is deliberately not followed automatically: use GitHub's current canonical owner/name when a repository has moved.

### 5. Store integration secrets

Using your database provider's private SQL editor or a parameterized database client, insert the following rows into `lead_sniper.secrets`:

| name | value |
| --- | --- |
| `slack_webhook_url` | The real `https://hooks.slack.com/services/.../.../...` URL |
| `github_webhook_secret` | A strong random signing secret; required only for webhook mode |

Use an upsert when rotating a value. Do not copy these values into chat, the generated workflow files, the Logic Log, or the recording. Treat the database editor's query history as sensitive. The Slack URL is fetched into workflow memory only immediately before sending.

All generated workflows disable saved successful, failed, progress, and manual execution payloads. Keep these settings: a Slack send input contains its secret URL. Avoid browser screenshots of that input. The application records sanitized operational events in PostgreSQL instead. A failed database connection can prevent that application audit entry; n8n execution metadata then remains the diagnostic source.

### 6. Preflight and activation

The initial monitoring cutoff is the timestamp saved by repository setup, not the timestamp of each run. Existing stars at or before it are baselined; subsequently observed stars are queued.

For **polling**:

1. Verify that the GitHub credential can GET `/repos/OWNER/REPO/stargazers?per_page=1`.
2. Estimate scan cost: `ceil(stargazers / 100)` listing requests per full scan, plus one profile request per new lead. Reserve capacity for other uses of the same token.
3. Enable configuration after setup: `UPDATE lead_sniper.config SET enabled = true WHERE singleton;`.
4. Run **A / Manual Poll** once. Check database scan and lead status before enabling the worker.
5. Activate A - Poll Stargazers, B - Worker Schedule, and D - Recover Expired Work. Keep A - Receive Star Webhook inactive.

For **webhook**:

1. Set `discovery_mode='webhook'`, add the signing secret, and enable configuration.
2. Activate A - Receive Star Webhook and copy its **production** URL.
3. In the selected repository's GitHub webhook settings, choose that URL, `application/json`, the same secret, SSL verification enabled, and star events.
4. Check that GitHub's ping receives HTTP 200. A new-star delivery should show `persisted` only after the database accepts the event.
5. Activate B - Worker Schedule and D - Recover Expired Work. Keep polling inactive.

The request and processor sub-workflows do not need schedule activation. E is referenced as an error workflow. Setup remains manual.

Do not manufacture a screenshot or claim a live successful run before the intended Slack message is actually delivered. Live evidence and the submission package remain a later task.

## Data flow and checkpoints

`new star -> unique (repo_id,user_id) row -> atomic claim -> profile -> strict numeric OR filter -> AI -> saved pitch -> saved notification -> authorized POST -> committed outcome`

- A user with exactly 100 followers and 50 public repositories is rejected.
- Each sub-execution claims only one lead. One rejected/failed lead does not prevent later work slots from running.
- New profile counts must be non-negative integers; missing/malformed counts are an error, not zero.
- The fetched profile ID must match the discovered ID. Username reassignment cannot silently enrich the wrong account.
- A missing name falls back to the username. Bio/company are allowed to be null. They are passed to the model as missing, not fabricated.
- AI receives bio/company plus optional product context; no model tools, memory or agent are attached.
- One invalid pitch gets one immediate repair attempt. Persistent AI failures become retryable stage failures.
- Existing delivered, rejected, failed, and baseline records are not reset by discovery. The default policy is one assessment per person per repository, including unstar/re-star.
- A delivery retry reuses the saved pitch and payload; it does not spend another AI call.

## Failure policy

| Failure | Outcome |
| --- | --- |
| GitHub primary limit / Retry-After | Shared cooldown; no lead retry-budget consumption |
| Brief shared request-slot contention | Up to ten short pacing waits, then defer without consuming the failure budget |
| GitHub secondary limit / transient failure | Backoff; five stage failures maximum |
| GitHub 401 | Pause the shared GitHub service until credentials are fixed |
| Permission 403 or missing profile 404 | Explicit permanent failure |
| Incomplete polling scan | Keep inserted rows; restart the next scan at page 1; never mark it complete |
| Five failed scans or page-budget exhaustion | Disable repository configuration; inspect before re-enabling |
| Worker lease expires before send | Recovery requeues at the saved stage |
| Slack 429 | Save payload and defer; shared Slack pacing/cooldown |
| Slack 4xx other than 429 | Permanent failure |
| Slack network timeout, 5xx, or unexpected successful response | `delivery_unknown`; no automatic resend |
| Database unavailable during webhook ingestion | HTTP 503 rather than a successful acknowledgment |

GitHub does not automatically redeliver every failed webhook request. After an ingestion outage, inspect **Recent deliveries** and explicitly redeliver failed events. Deduplication makes repeated valid deliveries safe. Polling is a snapshot mechanism: a star removed between observations can be missed, and page boundaries can shift while a scan is running. No exactly-once or lossless-polling guarantee is claimed.

Database leases last five minutes and are renewed at checkpoints before the model and notification calls. Requests have bounded timeouts. Database updates require the matching lease token. A stale worker cannot commit another worker's result. Concurrency-safe SQL uses row locks and SKIP LOCKED; the local PGlite tests exercise ownership and fencing but are not a multi-connection PostgreSQL load test.

## Operations

Run `sql/inspect.sql` for a non-secret status view. Pause discovery and new claims with:

```sql
UPDATE lead_sniper.config SET enabled = false WHERE singleton;
```

This does not cancel a request already in flight. Stop the relevant n8n execution if immediate interruption is necessary.

After repairing GitHub credentials, clear the shared pause and, if appropriate, re-enable the repository:

```sql
UPDATE lead_sniper.service_controls
SET paused = false, blocked_until = '-infinity', last_error = NULL
WHERE service = 'github';
```

To resolve an uncertain delivery, search the intended Slack channel for the stable reference shown by `lead_id`. Then run exactly one of these parameterized operations:

```sql
SELECT lead_sniper.reconcile(jsonb_build_object('lead_id', $1, 'resolution', 'confirmed_sent'));
SELECT lead_sniper.reconcile(jsonb_build_object('lead_id', $1, 'resolution', 'confirmed_not_sent'));
```

Use `confirmed_not_sent` only after checking the channel; it authorizes the next scheduled worker to send the saved payload. No automatic reconciliation or channel-search permission is required by the workflow.

## Local verification

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd run check
```

Tests execute the actual generated JavaScript and SQL through a small artifact harness and PGlite, including pgcrypto HMAC verification. GitHub, OpenAI and Slack responses are mocked. The harness is not an n8n runtime. This proves logic and database behavior, not the configuration or credentials of the user's Cloud account.

Node parameter shapes were checked against official registry sources `n8n-nodes-base@2.15.1` and `@n8n/n8n-nodes-langchain@2.38.2`. The target Cloud instance's installed version was not accessible. Import and execution on that instance remain necessary integration checks.

## References checked during implementation

- [n8n HTTP Request](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/)
- [n8n Postgres](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.postgres/)
- [n8n Execute Sub-workflow](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow/)
- [n8n Basic LLM Chain](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.chainllm/)
- [GitHub starring API](https://docs.github.com/en/rest/activity/starring)
- [GitHub REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
- [Slack incoming webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/)
- [OpenAI GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini)
