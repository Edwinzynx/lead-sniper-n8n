# Cloud setup status — 2026-09-12

## Latest update

Wrap-up update: sanitized Cloud snapshots and review documentation are now in submission-draft/. Generator and Cloud deployment now use a 150-second main budget, 115-second lead admission check, and 20-second AI timeouts within the 180-second instance cap. This fixes the earlier 120/185-second mismatch that could defer leads indefinitely. All 51 local tests pass, including a regression through Main with a queued lead. Real AI completion, evaluator acceptance, screenshot, and video remain pending. Earlier runtime/file-sync notes below are historical and superseded.

User-authorized dummy lead Slack demonstration: execution 74 succeeded on 2026-09-12 at 16:21 UTC. Slack returned HTTP 200 with ok. Message clearly labels the fictional profile and dummy outreach rationale as not AI-generated. Temporary nodes were removed. Production AI configuration remains unchanged and still requires credits.

AI/Slack test: execution 33 reached OpenAI but failed because the API account has no credits remaining. Execution 34 sent one explicitly labeled Slack connectivity-test message; Slack returned HTTP 200 and data="ok". The verification node initially expected body="ok", exposing a mapping defect. Production Classify Slack now accepts response.body or response.data and was republished. Temporary test nodes were removed; no synthetic lead was inserted into Data Tables. End-to-end AI generation remains blocked on API billing. The live main monitor and child workflows are published.

Repository switched with user authorization to Edwinzynx/hdsd-whisperFT across all four workflows. Setup execution 20 succeeded, and main execution 21 succeeded. Control row initialized at 2026-09-12T15:13:15.892Z; first complete scan recorded at 15:13:25.999Z, with no failures and no queued leads. Existing stars were correctly excluded. AI/Slack delivery still requires a separate test or a new qualifying star. The earlier openai/openai-python restriction below is historical.

The five components exist in n8n Cloud and have been repaired and linked:

- Main: https://tryedwin.app.n8n.cloud/workflow/WVgWzYjdocSVykA1
- Setup and preflight: https://tryedwin.app.n8n.cloud/workflow/zr7r7pAD75jubSVE
- Discover page: https://tryedwin.app.n8n.cloud/workflow/StdyHUjdCpc6chmu
- Process lead: https://tryedwin.app.n8n.cloud/workflow/UNuafhjltTtQgskT
- Error recorder: https://tryedwin.app.n8n.cloud/workflow/wRzekCTIYvCpuZGc

Restored the missing process-lead trigger and corrected renamed node references. Main now calls the correct child workflows. Replaced the malformed dynamic candidate filter with 100 explicit expression filters. Corrected the pending boolean filter to isTrue. Set execution timeouts to the instance maximum of 180 seconds and the main cycle budget to 120 seconds. Existing GitHub/OpenAI credentials and Slack URL were preserved. Error recorder is published and linked; main remains inactive.

Live setup execution 19 passed repository metadata access but failed authenticated stargazer listing with HTTP 404. GitHub documents that, starting July 2026, stargazer listing is restricted to repository admins and collaborators: https://docs.github.com/en/rest/activity/starring#new-access-restrictions

The three Data Tables exist, but monitoring control is not initialized because preflight correctly stopped. Need a repository for which the connected GitHub account has the required access. No end-to-end AI/Slack test or message delivery has been completed.

Cloud repairs above have not yet been incorporated into the local JSON generator; do not reimport local artifacts over the repaired Cloud workflows without applying these changes. Final assignment submissions remain deferred.
