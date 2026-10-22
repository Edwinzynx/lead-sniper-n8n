# Lead Sniper — n8n Cloud

Brief Assignment 1 guides: [end-to-end flow](docs/assignment-1/01-END-TO-END.md), [each workflow explained](docs/assignment-1/02-WORKFLOWS.md), and [interview preparation](docs/assignment-1/03-INTERVIEW.md).

[Follow one fictional lead through the workflow](docs/assignment-1/04-EXAMPLE-STORY.md), with the important nodes and each workflow's beginning and endpoint.

Monitors new stars on Edwinzynx/hdsd-whisperFT, fetches GitHub profiles, qualifies users with followers >100 OR public_repos >50, generates one sentence from bio/company, and sends an internal Slack notification.

Start with [submission-draft/README.md](submission-draft/README.md). See [CLOUD-SETUP.md](CLOUD-SETUP.md) for deployment and operation.

The Cloud monitor, workers, and error recorder are published. GitHub scanning and a labeled dummy Slack message passed live tests. Real LLM generation is blocked by an unfunded OpenAI account. The small repository substitution needs evaluator acceptance.

- submission-draft/: sanitized Cloud snapshots and review documentation.
- cloud/: reproducible inactive templates with local placeholder IDs. The historical filename 10-main-openai-python.json is retained for script compatibility; contents monitor the new repository.
- src/, scripts/build-cloud.cjs, tests/: implementation and regression checks.
- POSTGRES-ALTERNATIVE.md, sql/, workflows/: earlier optional prototype, excluded from submission.
- scripts/import-cloud.* and Connect n8n.cmd: legacy import helpers targeting an archived draft. Do not use for the current deployment.

Run npm ci, then npm run check. All 51 tests passed on 2026-09-12. External services are mocked in automated tests; these do not establish real AI generation.

Parent-directory workflow, Logic Log, and HTML preview are superseded; do not submit them. No screenshots or recordings are included.
