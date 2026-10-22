# Cloud setup and operation

Repository: Edwinzynx/hdsd-whisperFT. Storage: internal n8n Data Tables; no external database.

| Component | Live workflow |
| --- | --- |
| Main | https://tryedwin.app.n8n.cloud/workflow/WVgWzYjdocSVykA1 |
| Setup | https://tryedwin.app.n8n.cloud/workflow/zr7r7pAD75jubSVE |
| Discover page | https://tryedwin.app.n8n.cloud/workflow/StdyHUjdCpc6chmu |
| Process lead | https://tryedwin.app.n8n.cloud/workflow/UNuafhjltTtQgskT |
| Error recorder | https://tryedwin.app.n8n.cloud/workflow/wRzekCTIYvCpuZGc |

These workflows already have credentials and links. Do not reimport over them.

## Fresh deployment

1. Import the five JSON files from submission-draft/workflows into separate workflows in one project. Exports are inactive.
2. Select GitHub credentials on Setup's Check Repository/Check Stargazer Access, Discover Page's Fetch Stargazer Page, and Process Lead's Fetch Profile.
3. Select a funded OpenAI credential on OpenAI Model (gpt-4o-mini). Enter your incoming Slack webhook privately in Send Slack.
4. In Main, select the imported Process Lead and Discover One Page workflows. IDs may change during import.
5. Run Setup once, serially. It verifies metadata and stargazer access, creates tables, and preserves any existing monitoring cutoff.
6. Publish Error Recorder before selecting it as Error Workflow on the other four workflows. Publish workers and Main. Setup remains manual.

Exports omit credentials, execution data, pinned data and test nodes. The webhook is a placeholder. Relink dependencies after importing into another account.

## State and runtime

lead_sniper_control stores the singleton repository configuration, cutoff, cursor, cooldowns, lease owner and version. lead_sniper_leads stores repository-ID/user-ID keys, status, stage, pending flag, due time, and profile/pitch/delivery JSON. lead_sniper_events stores sanitized errors.

Main runs every five minutes with a 150-second budget inside the 180-second Cloud timeout. Conditional lease: 600 seconds. New lead admission requires 115 seconds remaining. Profile/Slack HTTP timeouts: 30 seconds; initial and repair AI calls: 20 seconds each. Time and ownership are checked again before sending.

Only stars after the fixed cutoff enter processing. Scans resume at the saved cursor and restart at page 1 after completion. Polling can miss short-lived stars; pagination can shift during star/unstar activity. Repeated stars by the same user on the same repository remain deduplicated.

## Recovery

Honor stored GitHub/Slack cooldowns. Resolve repository permissions before clearing access pauses. AI billing failures require a funded or replacement provider credential; review failed rows because stages stop after five failures.

For delivery_unknown, inspect Slack by reference before retrying. If present, reconcile as delivered; otherwise establish non-delivery before retry. Keep visible row fields and embedded JSON status/pending/due values consistent. Do not reset the monitoring cutoff to fix errors.

No exactly-once Slack guarantee is made: ambiguous responses require reconciliation. No automatic table-retention policy exists. Monitor table growth; deleting deduplication keys can allow repeat processing. Large repositories require capacity review because scans may span runs.
