-- Read-only operational views. Never selects values from lead_sniper.secrets.
SELECT repo_owner, repo_name, discovery_mode, enabled, monitoring_started_at,
       baseline_complete, last_scan_completed_at, next_scan_at, scan_failures,
       scan_lease_until
FROM lead_sniper.config;

SELECT status, stage, count(*) AS leads
FROM lead_sniper.leads GROUP BY status,stage ORDER BY status,stage;

SELECT lead_id, login, status, stage, next_attempt_at, attempts, last_error
FROM lead_sniper.leads WHERE status IN ('failed','retry_wait','delivery_unknown')
ORDER BY updated_at DESC LIMIT 100;

SELECT service, paused, blocked_until, quota_remaining, quota_reset_at, last_error
FROM lead_sniper.service_controls;

SELECT occurred_at, execution_id, lead_id, stage, outcome, detail
FROM lead_sniper.run_events ORDER BY event_id DESC LIMIT 100;
