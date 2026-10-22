-- Apply to a dedicated PostgreSQL 14+ application database using a TLS connection.
-- This migration is additive and idempotent; it does not erase existing state.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS lead_sniper;

CREATE TABLE IF NOT EXISTS lead_sniper.config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  repo_id text NOT NULL CHECK (repo_id ~ '^[0-9]+$'),
  repo_owner text NOT NULL,
  repo_name text NOT NULL,
  discovery_mode text NOT NULL DEFAULT 'polling' CHECK (discovery_mode IN ('polling','webhook')),
  enabled boolean NOT NULL DEFAULT false,
  monitoring_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  baseline_complete boolean NOT NULL DEFAULT false,
  product_context text NOT NULL DEFAULT '',
  llm_model text NOT NULL DEFAULT 'gpt-4o-mini',
  prompt_version text NOT NULL DEFAULT 'lead-pitch-v1',
  destination_id text NOT NULL DEFAULT 'slack-primary',
  scan_lease_token uuid,
  scan_lease_until timestamptz,
  next_scan_at timestamptz NOT NULL DEFAULT now(),
  last_scan_completed_at timestamptz,
  scan_failures integer NOT NULL DEFAULT 0,
  max_scan_pages integer NOT NULL DEFAULT 5000 CHECK (max_scan_pages > 0)
);

-- Secrets stay out of the generated workflow JSON. Restrict database access and
-- disable saved execution payloads in n8n; Slack URL exists briefly in send input.
CREATE TABLE IF NOT EXISTS lead_sniper.secrets (
  name text PRIMARY KEY CHECK (name IN ('github_webhook_secret','slack_webhook_url')),
  value text NOT NULL CHECK (length(value) > 0)
);
CREATE TABLE IF NOT EXISTS lead_sniper.leads (
  lead_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id text NOT NULL,
  user_id text NOT NULL CHECK (user_id ~ '^[0-9]+$'),
  login text NOT NULL CHECK (login ~ '^[a-zA-Z0-9-]{1,39}$'),
  starred_at timestamptz NOT NULL,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('polling','webhook')),
  status text NOT NULL CHECK (status IN ('baseline','queued','processing','rejected','retry_wait','delivered','failed','delivery_unknown')),
  stage text NOT NULL DEFAULT 'profile' CHECK (stage IN ('profile','ai','delivery')),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  attempts jsonb NOT NULL DEFAULT '{"profile":0,"ai":0,"delivery":0}',
  lease_token uuid,
  lease_until timestamptz,
  profile jsonb,
  reasons jsonb,
  pitch text,
  prompt_version text,
  model text,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repo_id,user_id)
);
CREATE INDEX IF NOT EXISTS leads_due ON lead_sniper.leads(next_attempt_at) WHERE status IN ('queued','retry_wait');
CREATE TABLE IF NOT EXISTS lead_sniper.deliveries (
  delivery_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES lead_sniper.leads(lead_id),
  destination_id text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','sending','sent','unknown','failed')),
  attempts integer NOT NULL DEFAULT 0,
  attempt_started_at timestamptz,
  sent_at timestamptz,
  last_error text,
  UNIQUE (lead_id,destination_id)
);
CREATE TABLE IF NOT EXISTS lead_sniper.service_controls (
  service text PRIMARY KEY,
  blocked_until timestamptz NOT NULL DEFAULT '-infinity',
  next_slot_at timestamptz NOT NULL DEFAULT '-infinity',
  paused boolean NOT NULL DEFAULT false,
  last_error text,
  quota_remaining integer,
  quota_reset_at timestamptz
);
INSERT INTO lead_sniper.service_controls(service) VALUES ('github'),('slack') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS lead_sniper.run_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  execution_id text,
  lead_id uuid,
  stage text NOT NULL,
  outcome text NOT NULL,
  detail text
);

CREATE OR REPLACE FUNCTION lead_sniper.audit(j jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO lead_sniper.run_events(execution_id,lead_id,stage,outcome,detail)
  VALUES(j->>'execution_id',NULLIF(j->>'lead_id','')::uuid,COALESCE(j->>'stage','workflow'),
    COALESCE(j->>'outcome','error'),left(COALESCE(j->>'reason','unspecified'),500));
  RETURN jsonb_build_object('recorded',true);
END $$;

CREATE OR REPLACE FUNCTION lead_sniper.configure(j jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c lead_sniper.config;
BEGIN
  IF COALESCE(j->>'repo_id','') !~ '^[0-9]+$' OR COALESCE(j->>'repo_owner','') !~ '^[a-zA-Z0-9-]+$'
     OR COALESCE(j->>'repo_name','') !~ '^[a-zA-Z0-9_.-]+$' THEN RAISE EXCEPTION 'Invalid repository configuration'; END IF;
  SELECT * INTO c FROM lead_sniper.config WHERE singleton FOR UPDATE;
  IF FOUND AND c.repo_id <> j->>'repo_id' THEN RAISE EXCEPTION 'Use a separate schema/database for another repository'; END IF;
  INSERT INTO lead_sniper.config(repo_id,repo_owner,repo_name,discovery_mode,product_context,llm_model)
  VALUES(j->>'repo_id',j->>'repo_owner',j->>'repo_name',COALESCE(j->>'discovery_mode','polling'),COALESCE(j->>'product_context',''),COALESCE(j->>'llm_model','gpt-4o-mini'))
  ON CONFLICT(singleton) DO UPDATE SET repo_owner=excluded.repo_owner,repo_name=excluded.repo_name,
    discovery_mode=excluded.discovery_mode,product_context=excluded.product_context,llm_model=excluded.llm_model;
  RETURN jsonb_build_object('configured',true,'enabled',(SELECT enabled FROM lead_sniper.config WHERE singleton),'next','Set database secrets, verify access, then enable config');
END $$;

CREATE OR REPLACE FUNCTION lead_sniper.ingest(j jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c lead_sniper.config; e jsonb; inserted integer := 0; n integer;
BEGIN
  SELECT * INTO c FROM lead_sniper.config WHERE singleton;
  IF NOT FOUND OR NOT c.enabled OR c.repo_id <> j->>'repo_id' OR c.discovery_mode <> j->>'source' THEN
    RETURN jsonb_build_object('accepted',false,'reason','repository_or_mode_inactive');
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(j->'events') LOOP
    IF COALESCE(e->>'user_id','') !~ '^[0-9]+$' OR COALESCE(e->>'login','') !~ '^[a-zA-Z0-9-]{1,39}$' OR e->>'starred_at' IS NULL THEN
      RAISE EXCEPTION 'Invalid star event';
    END IF;
    INSERT INTO lead_sniper.leads(repo_id,user_id,login,starred_at,source,status)
    VALUES(c.repo_id,e->>'user_id',e->>'login',(e->>'starred_at')::timestamptz,j->>'source',
      CASE WHEN (e->>'starred_at')::timestamptz <= c.monitoring_started_at THEN 'baseline' ELSE 'queued' END)
    ON CONFLICT(repo_id,user_id) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; inserted := inserted + n;
  END LOOP;
  RETURN jsonb_build_object('accepted',true,'inserted',inserted);
END $$;

CREATE OR REPLACE FUNCTION lead_sniper.webhook(j jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, public, extensions AS $$
DECLARE secret text; raw bytea; expected text; payload jsonb; result jsonb;
BEGIN
  SELECT value INTO secret FROM lead_sniper.secrets WHERE name='github_webhook_secret';
  IF secret IS NULL THEN RETURN '{"http_status":503,"message":"Webhook not configured"}'; END IF;
  IF COALESCE(j->>'signature','') !~ '^sha256=[0-9a-f]{64}$' THEN RETURN '{"http_status":401,"message":"Unauthorized"}'; END IF;
  BEGIN raw := decode(j->>'raw_base64','base64'); EXCEPTION WHEN OTHERS THEN RETURN '{"http_status":400,"message":"Invalid body"}'; END;
  IF raw IS NULL OR octet_length(raw)>1048576 THEN RETURN '{"http_status":400,"message":"Invalid body"}'; END IF;
  expected := 'sha256=' || encode(hmac(raw,convert_to(secret,'UTF8'),'sha256'),'hex');
  -- Compare digests of the MAC strings to avoid a prefix comparison of the MAC itself.
  IF digest(expected,'sha256') <> digest(j->>'signature','sha256') THEN RETURN '{"http_status":401,"message":"Unauthorized"}'; END IF;
  BEGIN payload := convert_from(raw,'UTF8')::jsonb; EXCEPTION WHEN OTHERS THEN RETURN '{"http_status":400,"message":"Invalid JSON"}'; END;
  IF j->>'event_type'='ping' THEN RETURN '{"http_status":200,"message":"pong"}'; END IF;
  IF j->>'event_type'<>'star' OR payload->>'action'<>'created' THEN RETURN '{"http_status":200,"message":"ignored"}'; END IF;
  BEGIN
    result := lead_sniper.ingest(jsonb_build_object('repo_id',payload#>>'{repository,id}','source','webhook','events',
      jsonb_build_array(jsonb_build_object('user_id',payload#>>'{sender,id}','login',payload#>>'{sender,login}','starred_at',payload->>'starred_at'))));
  EXCEPTION WHEN invalid_text_representation OR check_violation OR not_null_violation OR raise_exception OR invalid_datetime_format OR datetime_field_overflow THEN
    RETURN '{"http_status":400,"message":"Invalid event"}';
  END;
  RETURN jsonb_build_object('http_status',200,'message',CASE WHEN (result->>'accepted')::boolean THEN 'persisted' ELSE 'ignored' END);
END $$;

CREATE OR REPLACE FUNCTION lead_sniper.scan_begin(j jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c lead_sniper.config;
BEGIN
  SELECT * INTO c FROM lead_sniper.config WHERE singleton FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR NOT c.enabled OR c.discovery_mode<>'polling' OR c.next_scan_at>now() OR c.scan_lease_until>now() THEN RETURN '{"scan_ready":false}'; END IF;
  c.scan_lease_token := gen_random_uuid();
  UPDATE lead_sniper.config SET scan_lease_token=c.scan_lease_token,scan_lease_until=now()+interval '5 minutes' WHERE singleton;
  RETURN to_jsonb(c) || jsonb_build_object('scan_ready',true,'page_count',0,'execution_id',j->>'execution_id',
    'request_url','https://api.github.com/repos/'||c.repo_owner||'/'||c.repo_name||'/stargazers?per_page=100&page=1',
    'accept','application/vnd.github.star+json','attempt',c.scan_failures);
END $$;

CREATE OR REPLACE FUNCTION lead_sniper.scan_page(j jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c lead_sniper.config; result jsonb; page_count integer := COALESCE((j->>'page_count')::integer,0)+1;
BEGIN
  SELECT * INTO c FROM lead_sniper.config WHERE singleton FOR UPDATE;
  IF c.scan_lease_token IS DISTINCT FROM (j->>'scan_lease_token')::uuid OR c.scan_lease_until<=now() THEN RETURN '{"scan_ready":false,"reason":"lost_scan_lease"}'; END IF;
  result := lead_sniper.ingest(jsonb_build_object('repo_id',c.repo_id,'source','polling','events',j->'events'));
  IF j->>'next_url' IS NULL THEN
    UPDATE lead_sniper.config SET baseline_complete=true,last_scan_completed_at=now(),scan_lease_token=NULL,scan_lease_until=NULL,scan_failures=0,next_scan_at=now()+interval '10 minutes' WHERE singleton;
    PERFORM lead_sniper.audit(j || '{"stage":"scan","outcome":"complete","reason":"full_scan_completed"}');
    RETURN jsonb_build_object('scan_ready',false,'complete',true,'pages',page_count);
  END IF;
  IF page_count>=c.max_scan_pages THEN
    UPDATE lead_sniper.config SET enabled=false,scan_lease_token=NULL,scan_lease_until=NULL WHERE singleton;
    PERFORM lead_sniper.audit(j || '{"stage":"scan","outcome":"failed","reason":"scan_page_budget_exceeded"}');
    RETURN '{"scan_ready":false,"reason":"scan_page_budget_exceeded"}';
  END IF;
  UPDATE lead_sniper.config SET scan_lease_until=now()+interval '5 minutes' WHERE singleton;
  RETURN (j - 'events' - 'response' - 'result') || jsonb_build_object('scan_ready',true,'request_url',j->>'next_url','page_count',page_count);
END $$;

CREATE OR REPLACE FUNCTION lead_sniper.scan_fail(j jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  UPDATE lead_sniper.config SET scan_lease_token=NULL,scan_lease_until=NULL,
    enabled=CASE WHEN j#>>'{result,outcome}'='failed' OR scan_failures+CASE WHEN COALESCE((j#>>'{result,count_attempt}')::boolean,true) THEN 1 ELSE 0 END>=5 THEN false ELSE enabled END,
    next_scan_at=COALESCE((j#>>'{result,retry_at}')::timestamptz,now()+interval '10 minutes'),
    scan_failures=scan_failures+CASE WHEN COALESCE((j#>>'{result,count_attempt}')::boolean,true) THEN 1 ELSE 0 END
  WHERE singleton AND scan_lease_token=(j->>'scan_lease_token')::uuid;
  PERFORM lead_sniper.audit(j || jsonb_build_object('stage','scan','outcome','deferred','reason',j#>>'{result,reason}'));
  RETURN '{"scan_ready":false}';
END $$;

CREATE OR REPLACE FUNCTION lead_sniper.api_gate(j jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE s lead_sniper.service_controls;
BEGIN
  SELECT * INTO s FROM lead_sniper.service_controls WHERE service='github' FOR UPDATE;
  IF s.paused THEN RETURN j || '{"api_allowed":false,"result":{"outcome":"failed","reason":"github_service_paused"}}'; END IF;
  IF s.blocked_until>clock_timestamp() THEN
    RETURN j || jsonb_build_object('api_allowed',false,'result',jsonb_build_object('outcome','retry','reason','github_shared_cooldown','retry_at',greatest(s.blocked_until,s.next_slot_at),'count_attempt',false));
  END IF;
  IF s.next_slot_at>clock_timestamp() THEN
    RETURN j || jsonb_build_object('api_allowed',false,'api_wait',COALESCE((j->>'gate_retries')::integer,0)<10,
      'gate_retries',COALESCE((j->>'gate_retries')::integer,0)+1,
      'result',jsonb_build_object('outcome','retry','reason','github_pacing_contention','retry_at',s.next_slot_at,'count_attempt',false));
  END IF;
  UPDATE lead_sniper.service_controls SET next_slot_at=clock_timestamp()+interval '1 second' WHERE service='github';
  RETURN j || '{"api_allowed":true,"api_wait":false}';
END $$;

CREATE OR REPLACE FUNCTION lead_sniper.api_result(j jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb := j->'result';
BEGIN
  IF COALESCE((r->>'pause_service')::boolean,false) THEN UPDATE lead_sniper.service_controls SET paused=true,last_error=r->>'reason' WHERE service='github'; END IF;
  IF r->>'reason' IN ('github_rate_limit','github_primary_limit','github_secondary_limit') THEN
    UPDATE lead_sniper.service_controls SET blocked_until=greatest(blocked_until,(r->>'retry_at')::timestamptz),last_error=r->>'reason' WHERE service='github';
  END IF;
  IF r#>>'{headers,x-ratelimit-remaining}' ~ '^[0-9]+$' THEN
    UPDATE lead_sniper.service_controls SET quota_remaining=(r#>>'{headers,x-ratelimit-remaining}')::integer,
      quota_reset_at=CASE WHEN r#>>'{headers,x-ratelimit-reset}' ~ '^[0-9]+$' THEN to_timestamp((r#>>'{headers,x-ratelimit-reset}')::double precision) ELSE quota_reset_at END WHERE service='github';
  END IF;
  RETURN j - 'response';
END $$;

CREATE OR REPLACE FUNCTION lead_sniper.claim(j jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c lead_sniper.config; l lead_sniper.leads;
BEGIN
  SELECT * INTO c FROM lead_sniper.config WHERE singleton;
  IF NOT FOUND OR NOT c.enabled THEN RETURN '{"work_ready":false}'; END IF;
  SELECT * INTO l FROM lead_sniper.leads WHERE repo_id=c.repo_id AND status IN ('queued','retry_wait') AND next_attempt_at<=now()
    AND (stage<>'profile' OR NOT EXISTS(SELECT 1 FROM lead_sniper.service_controls WHERE service='github' AND (paused OR blocked_until>now())))
    ORDER BY next_attempt_at,discovered_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN '{"work_ready":false}'; END IF;
  UPDATE lead_sniper.leads SET status='processing',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now()
    WHERE lead_id=l.lead_id RETURNING * INTO l;
  RETURN to_jsonb(l) || jsonb_build_object('work_ready',true,'repo_owner',c.repo_owner,'repo_name',c.repo_name,
    'product_context',c.product_context,'llm_model',c.llm_model,'configured_prompt_version',c.prompt_version,
    'destination_id',c.destination_id,'execution_id',j->>'execution_id');
END $$;

CREATE OR REPLACE FUNCTION lead_sniper.checkpoint(j jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE l lead_sniper.leads; d lead_sniper.deliveries; action text := j->>'action'; failures integer; webhook_url text; s lead_sniper.service_controls;
BEGIN
  SELECT * INTO l FROM lead_sniper.leads WHERE lead_id=(j->>'lead_id')::uuid FOR UPDATE;
  IF NOT FOUND OR l.lease_token IS DISTINCT FROM (j->>'lease_token')::uuid OR l.lease_until<=now() OR l.status<>'processing' THEN RETURN '{"work_ready":false,"reason":"lost_lead_lease"}'; END IF;
  IF action='profile' THEN
    IF j#>>'{profile,id}'<>l.user_id THEN RAISE EXCEPTION 'Profile identity mismatch'; END IF;
    UPDATE lead_sniper.leads SET profile=j->'profile',login=j#>>'{profile,username}',reasons=j#>'{decision,reasons}',
      stage=CASE WHEN (j#>>'{decision,qualified}')::boolean THEN 'ai' ELSE stage END,
      status=CASE WHEN (j#>>'{decision,qualified}')::boolean THEN 'processing' ELSE 'rejected' END WHERE lead_id=l.lead_id;
  ELSIF action='renew' THEN
    NULL;
  ELSIF action='pitch' THEN
    IF NULLIF(j->>'pitch','') IS NULL THEN RAISE EXCEPTION 'Cannot checkpoint empty pitch'; END IF;
    UPDATE lead_sniper.leads SET pitch=j->>'pitch',prompt_version=j->>'configured_prompt_version',model=j->>'llm_model',stage='delivery' WHERE lead_id=l.lead_id;
  ELSIF action='prepare_delivery' THEN
    INSERT INTO lead_sniper.deliveries(lead_id,destination_id,payload) VALUES(l.lead_id,j->>'destination_id',j->'payload') ON CONFLICT DO NOTHING;
  ELSIF action='begin_send' THEN
    SELECT * INTO d FROM lead_sniper.deliveries WHERE lead_id=l.lead_id AND destination_id=j->>'destination_id' FOR UPDATE;
    IF NOT FOUND OR d.status<>'ready' THEN RETURN j || '{"send_ready":false,"reason":"delivery_not_ready"}'; END IF;
    SELECT * INTO s FROM lead_sniper.service_controls WHERE service='slack' FOR UPDATE;
    IF greatest(s.blocked_until,s.next_slot_at)>clock_timestamp() THEN
      UPDATE lead_sniper.leads SET status='retry_wait',next_attempt_at=greatest(s.blocked_until,s.next_slot_at),lease_token=NULL,lease_until=NULL WHERE lead_id=l.lead_id;
      RETURN '{"work_ready":false,"send_ready":false}';
    END IF;
    SELECT value INTO webhook_url FROM lead_sniper.secrets WHERE name='slack_webhook_url';
    IF webhook_url IS NULL OR webhook_url !~ '^https://hooks\.slack\.com/services/[A-Za-z0-9]+/[A-Za-z0-9]+/[A-Za-z0-9]+$' THEN
      UPDATE lead_sniper.leads SET status='failed',last_error='slack_webhook_not_configured',lease_token=NULL,lease_until=NULL WHERE lead_id=l.lead_id;
      RETURN '{"work_ready":false,"send_ready":false,"reason":"slack_webhook_not_configured"}';
    END IF;
    UPDATE lead_sniper.service_controls SET next_slot_at=clock_timestamp()+interval '1 second' WHERE service='slack';
    UPDATE lead_sniper.deliveries SET status='sending',attempts=attempts+1,attempt_started_at=now() WHERE delivery_id=d.delivery_id;
    UPDATE lead_sniper.leads SET lease_until=now()+interval '5 minutes' WHERE lead_id=l.lead_id;
    RETURN j || jsonb_build_object('send_ready',true,'payload',d.payload,'delivery_id',d.delivery_id,'slack_webhook_url',webhook_url);
  ELSIF action='sent' THEN
    UPDATE lead_sniper.deliveries SET status='sent',sent_at=now(),last_error=NULL WHERE lead_id=l.lead_id AND status='sending';
    IF NOT FOUND THEN RAISE EXCEPTION 'Delivery is not sending'; END IF;
    UPDATE lead_sniper.leads SET status='delivered',last_error=NULL WHERE lead_id=l.lead_id;
  ELSIF action='unknown' THEN
    UPDATE lead_sniper.deliveries SET status='unknown',last_error=j->>'reason' WHERE lead_id=l.lead_id AND status='sending';
    UPDATE lead_sniper.leads SET status='delivery_unknown',last_error=j->>'reason' WHERE lead_id=l.lead_id;
  ELSIF action IN ('defer','fail') THEN
    failures := COALESCE((l.attempts->>l.stage)::integer,0) + CASE WHEN COALESCE((j->>'count_attempt')::boolean,true) THEN 1 ELSE 0 END;
    UPDATE lead_sniper.leads SET status=CASE WHEN action='fail' OR failures>=5 THEN 'failed' ELSE 'retry_wait' END,
      next_attempt_at=COALESCE((j->>'retry_at')::timestamptz,now()+make_interval(secs=>least(3600,60*power(2,least(failures,6)))::integer)),
      attempts=jsonb_set(attempts,ARRAY[l.stage],to_jsonb(failures)),last_error=left(j->>'reason',500) WHERE lead_id=l.lead_id;
    UPDATE lead_sniper.deliveries SET status=CASE WHEN action='fail' OR failures>=5 THEN 'failed' ELSE 'ready' END,last_error=j->>'reason' WHERE lead_id=l.lead_id AND status='sending';
    IF j->>'reason'='slack_rate_limit' THEN UPDATE lead_sniper.service_controls SET blocked_until=greatest(blocked_until,(j->>'retry_at')::timestamptz) WHERE service='slack'; END IF;
  ELSE RAISE EXCEPTION 'Unknown checkpoint action'; END IF;
  UPDATE lead_sniper.leads SET updated_at=now(),lease_until=CASE WHEN status='processing' THEN now()+interval '5 minutes' ELSE NULL END,
    lease_token=CASE WHEN status='processing' THEN lease_token ELSE NULL END WHERE lead_id=l.lead_id RETURNING * INTO l;
  IF l.status<>'processing' THEN PERFORM lead_sniper.audit(j || jsonb_build_object('stage',l.stage,'outcome',l.status,'reason',COALESCE(l.last_error,l.status))); END IF;
  RETURN (j - 'response' - 'result' - 'slack_webhook_url' - 'payload') || to_jsonb(l) || jsonb_build_object('work_ready',l.status='processing');
END $$;

CREATE OR REPLACE FUNCTION lead_sniper.recover(j jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE l lead_sniper.leads; recovered integer:=0; uncertain integer:=0;
BEGIN
  FOR l IN SELECT * FROM lead_sniper.leads WHERE status='processing' AND lease_until<now() FOR UPDATE SKIP LOCKED LOOP
    IF EXISTS(SELECT 1 FROM lead_sniper.deliveries WHERE lead_id=l.lead_id AND status IN ('sending','unknown')) THEN
      UPDATE lead_sniper.deliveries SET status='unknown',last_error='worker_expired_during_send' WHERE lead_id=l.lead_id AND status='sending';
      UPDATE lead_sniper.leads SET status='delivery_unknown',last_error='worker_expired_during_send',lease_token=NULL,lease_until=NULL WHERE lead_id=l.lead_id;
      uncertain:=uncertain+1;
    ELSE
      UPDATE lead_sniper.leads SET status='retry_wait',next_attempt_at=now(),last_error='expired_worker_claim',lease_token=NULL,lease_until=NULL WHERE lead_id=l.lead_id;
      recovered:=recovered+1;
    END IF;
    PERFORM lead_sniper.audit(j || jsonb_build_object('lead_id',l.lead_id,'stage',l.stage,'outcome','recovered','reason','expired_lease'));
  END LOOP;
  UPDATE lead_sniper.config SET scan_lease_token=NULL,scan_lease_until=NULL WHERE scan_lease_until<now();
  RETURN jsonb_build_object('requeued',recovered,'uncertain',uncertain);
END $$;

-- Reconciliation is an explicit operator operation after checking Slack.
CREATE OR REPLACE FUNCTION lead_sniper.reconcile(j jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE l lead_sniper.leads;
BEGIN
  SELECT * INTO l FROM lead_sniper.leads WHERE lead_id=(j->>'lead_id')::uuid FOR UPDATE;
  IF NOT FOUND OR l.status<>'delivery_unknown' THEN RAISE EXCEPTION 'Lead is not awaiting reconciliation'; END IF;
  IF j->>'resolution'='confirmed_sent' THEN
    UPDATE lead_sniper.deliveries SET status='sent',sent_at=COALESCE(sent_at,now()) WHERE lead_id=l.lead_id AND status='unknown';
    UPDATE lead_sniper.leads SET status='delivered',last_error=NULL WHERE lead_id=l.lead_id;
  ELSIF j->>'resolution'='confirmed_not_sent' THEN
    UPDATE lead_sniper.deliveries SET status='ready',last_error=NULL WHERE lead_id=l.lead_id AND status='unknown';
    UPDATE lead_sniper.leads SET status='retry_wait',next_attempt_at=now(),last_error=NULL WHERE lead_id=l.lead_id;
  ELSE RAISE EXCEPTION 'Resolution must be confirmed_sent or confirmed_not_sent'; END IF;
  PERFORM lead_sniper.audit(j || '{"stage":"reconcile","outcome":"resolved"}');
  RETURN '{"resolved":true}';
END $$;
COMMIT;
