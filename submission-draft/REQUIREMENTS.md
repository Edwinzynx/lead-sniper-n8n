# Requirement checklist

| Requirement | Implementation/evidence | Status |
| --- | --- | --- |
| n8n or Yellow.ai | Five n8n Cloud workflows | Implemented |
| Monitor new stars | Five-minute polling, cutoff, cursor | Initial live scan passed |
| Popular repository | Owned repository substituted after access restriction | Acceptance pending |
| Fetch user profile | Fetch Profile uses /users/{username} | Implemented; local tests |
| Followers >100 OR repos >50 | Strict predicate and boundary tests | Tests passed |
| One LLM sentence using bio/company | Basic LLM Chain, prompt, validation | Configured; billing blocker |
| Slack name, bio, AI pitch | Plain-text blocks | Dummy passed; real AI pending |
| Workflow JSON | Five sanitized inactive snapshots | Draft prepared |
| Slack screenshot | Actual message capture required | Pending |
| Rate-limit Logic Log | LOGIC-LOG.md | Draft prepared |
| Demo recording | DEMO-SCRIPT.md | Script ready; recording pending |

Durable state, retries, deduplication and error recovery are engineering additions; they do not replace the outstanding LLM/popular-repository requirements.
