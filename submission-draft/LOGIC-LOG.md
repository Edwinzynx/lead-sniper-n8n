# Logic Log — Lead Sniper

A five-minute n8n Cloud schedule discovers timestamped GitHub stars, fetches /users/{username}, applies followers >100 OR public_repos >50, and sends name, bio, and a one-sentence rationale to Slack. The exact thresholds of 100 and 50 do not qualify. Storage uses internal Data Tables.

Setup validates repository metadata AND authenticated stargazer-list access before creating a fixed cutoff. Historical stars are excluded. Pages contain up to 100 stars. Unseen repository-ID/user-ID keys are stored before advancing the cursor, so replay skips saved leads. A conditional 600-second lease and version check serialize scheduled work; expired leases recover crashed runs.

GitHub requests are paced. HTTP 429 and rate-limit 403 honor Retry-After or X-RateLimit-Reset with a buffer. Transient/network failures use bounded exponential delays with jitter. Access/authentication failures stop or pause affected work. Cursor and cooldown state persist across executions.

Profile and pitch checkpoints precede subsequent side effects. Each stage permits five failures. Invalid pitch format receives one repair per AI pass. Bio/company text is untrusted input; prompts prohibit invented roles or buying intent. Plain-text Slack blocks prevent profile text from creating mentions.

Immediately before Slack, time and lease ownership are rechecked and sending is saved. HTTP 200 plus ok in response.body or response.data confirms delivery. Slack 429 retries the saved payload after cooldown. Lost responses, server errors, and interrupted sends become delivery_unknown and require reconciliation. This is not an exactly-once delivery guarantee.

Cloud timeout is 180 seconds; main budget is 150 seconds. New lead work requires 115 seconds remaining, HTTP requests allow 30 seconds, and each AI attempt allows 20 seconds. Shared Error Recorder stores sanitized unexpected failures.

Limitations: the user authorized Edwinzynx/hdsd-whisperFT after openai/openai-python denied stargazer-list access. GitHub documents restriction to admins/collaborators from July 2026: https://docs.github.com/en/rest/activity/starring#new-access-restrictions. The small-repository substitution needs evaluator acceptance. OpenAI has no credits; dummy Slack delivery does not establish real AI generation.
