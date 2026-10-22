# Verification record

## Automated tests

2026-09-12: npm run check rebuilt the implementations and passed 51 tests, zero failures: 19 Cloud artifact/emulator, 8 shared-core, 4 importer, and 20 optional PostgreSQL/PGlite tests. External GitHub, LLM, and Slack responses are mocked.

Coverage: exact thresholds, identity/numeric validation, baseline preservation, duplicate replay, cursor checkpointing, overlapping/stale leases, saved profile/pitch, bounded repair, rate limits, uncertain delivery, and retry exhaustion. A new regression verifies Main admits a queued lead within its actual Cloud budget and accepts Slack data="ok".

## Observed live executions

| Execution | Result | Evidence |
| --- | --- | --- |
| 19 | Failed | Original repository metadata succeeded; stargazer listing returned 404. |
| 20 | Success | Authenticated setup initialized owned-repository monitoring. |
| 21 | Success | Initial scan completed, excluded old stars, and released lease. |
| 33 | Failed | OpenAI reported no credits remaining; no generated pitch. |
| 34 | Slack accepted; verifier failed | HTTP 200/data="ok" exposed response mapping defect, subsequently fixed. |
| 74 | Success | Fictional profile with dummy rationale delivered; ai_generated=false. |

Execution IDs are observations, not guarantees of retained logs. No synthetic leads were added to production tables. Temporary test nodes were removed.

The latest timing correction passed local regression tests and was published. No real qualifying star has exercised that corrected path through AI and Slack.

Not established: live real-AI output, full qualifying new-star delivery, live duplicate suppression after that delivery, load/rate-limit tests, screenshot or video evidence.
