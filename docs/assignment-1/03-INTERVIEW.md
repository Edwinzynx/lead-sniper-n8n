# Assignment 1 — Brief interview preparation

[Entire system](01-END-TO-END.md) · [Individual workflows](02-WORKFLOWS.md)

## Explain the project in 30 seconds

“Lead Sniper monitors new GitHub stars, fetches full profiles, and qualifies users with more than 100 followers or more than 50 public repositories. Qualified profiles receive a one-sentence AI rationale and an internal Slack notification. Five n8n workflows separate setup, coordination, discovery, processing and error logging. Data Tables save the cursor and each lead's progress so retries resume from checkpoints.”

## Key questions and answers

**Why five workflows?**
Each has one responsibility. Setup preserves the baseline, Main owns scheduling and concurrency, discovery handles one page, processing handles one lead, and the recorder centralizes unexpected errors.

**Why keep qualification outside the LLM?**
It is an exact numeric rule. Code applies it consistently and avoids paying for AI on rejected profiles. The LLM only writes the rationale.

**How are duplicates prevented?**
Discovery checks the stable `repo_id:user_id` key before insertion. It saves leads before advancing the cursor so interrupted pages can replay. Cloud relies on a single coordinator; this is not a database uniqueness guarantee.

**What happens after a crash?**
The saved stage determines recovery: profile saved → resume AI; pitch saved → resume delivery. A saved sending state becomes unknown because Slack may already have accepted the request.

**Why not retry every Slack timeout?**
A lost response does not prove failed delivery. Automatic resend could duplicate the message. The workflow stops at `delivery_unknown` and requires checking the stable Slack reference.

**How are rate limits handled?**
GitHub calls are paced and classified using Retry-After/reset headers or exponential backoff. Cooldown timestamps survive executions. Explicit Slack 429 also retries using the saved payload. Counted stage failures stop after five.

**How is AI output controlled?**
The prompt limits evidence to bio/company, treats profile text as untrusted and forbids invented claims. Format validation allows one repair. It does not prove factual accuracy or eliminate prompt injection.

**How would you debug a stuck lead?**
Check pending/due fields, stage, attempts, shared cooldowns, lease owner and remaining runtime. Check node-name references and child links after import. Do not reset the cutoff or blindly resend unknown deliveries.

**How would you scale it?**
First improve stage-aware queue selection and time budgets. Parallel workers would require unique keys, atomic claims and stronger ownership checks. The separate PostgreSQL prototype explores those mechanisms; the Cloud submission does not use them.

**What is actually verified?**
All 51 local tests passed with mocked services. Historical evidence shows GitHub scanning and a labeled dummy Slack message. The last recorded real AI attempt lacked credits; a completed real-AI delivery is not established. Repository substitution acceptance also remains pending in project records.

## Remember the boundaries

- `(100 followers, 50 repos)` is rejected; either strictly higher value qualifies.
- New discoveries normally wait for a later cycle because Main processes before scanning.
- Re-starring does not reopen a stored user assessment.
- Polling can miss short-lived stars; Slack delivery is not exactly once.
- The workflow notifies the internal team; it does not contact GitHub users.
