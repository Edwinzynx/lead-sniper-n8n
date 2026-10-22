# Logic Log — GitHub API Rate Limits

The main n8n workflow polls every five minutes. GitHub requests are authenticated, and a Wait node adds a one-second delay before each stargazer-page or profile request. Requests run sequentially, and a shared lease prevents overlapping monitoring runs. Stargazer pages request up to 100 entries to reduce API calls.

The HTTP nodes retain response status and headers. For HTTP 403/429, the classifier first checks `Retry-After` and waits the indicated number of seconds plus two. If `X-RateLimit-Remaining` is zero, it uses the Unix timestamp in `X-RateLimit-Reset`, again adding two seconds.

Secondary rate limits without those headers, network failures, and server errors use exponential backoff starting at 60 seconds, capped at one hour, with 0–9 seconds of jitter. Retries are bounded; authentication and access failures are distinguished from quota exhaustion.

The next permitted request time is stored in the control Data Table. Later executions skip GitHub work until that cooldown expires. The page cursor is saved only after new leads are stored, allowing interrupted scans to resume safely.

These rate-limit branches passed mocked automated tests; a live rate-limit event was not deliberately induced.
