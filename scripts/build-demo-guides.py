import json, pathlib, re, html, textwrap

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'demo-guides'
OUT.mkdir(exist_ok=True)
(OUT/'images').mkdir(exist_ok=True)
DESC={
'Manual Setup':'Starts initialization only when you deliberately run it. It is not a recurring trigger; rerunning it must preserve the original monitoring cutoff.',
'Repository':'Creates the initial state envelope and selects the normal GitHub JSON media type. The next HTTP node contains the actual repository URL.',
'Check Repository':'Fetches authenticated metadata for Edwinzynx/hdsd-whisperFT. Returns body, HTTP status and headers so the next node can verify identity rather than assuming the URL is accessible.',
'Validate Repository':'Requires HTTP 200, a repository ID, and the expected case-insensitive full name. Keeps the verified repository object and changes the Accept media type so the next request includes star timestamps. Throws on mismatch.',
'Check Stargazer Access':'Fetches the first timestamped page of stargazers using the GitHub credential. Repository metadata access alone does not prove permission to list the people who starred it.',
'Require Listing Access':'Requires a successful HTTP response containing an array. Stops setup before state initialization when stargazer access is unavailable.',
'Preflight Transport Failure':'Receives HTTP-node transport errors and deliberately stops setup with a useful message. It prevents a network problem from being mistaken for an empty repository.',
'Create control Table':'Creates lead_sniper_control if absent. This table stores the repository key, version, lease owner/expiry and serialized configuration. It does not clear existing rows.',
'Create leads Table':'Creates lead_sniper_leads if absent. Visible status, stage, pending and due-time fields support efficient work selection; the data field stores the detailed profile, pitch and retry checkpoint.',
'Create events Table':'Creates lead_sniper_events if absent, with occurred_at and detail columns for sanitized unexpected-error metadata.',
'Find Existing Control':'Looks up this repository key, reading up to two rows so a duplicate singleton can be detected. An intentional empty output item allows initialization logic to run when there is no row.',
'Validate Singleton':'Rejects duplicate control rows; otherwise emits exists=true or false. This prevents two independent cursors/leases from representing the same repository.',
'Needs Initialization?':'Initializes only when no control row exists. The false branch ends setup without resetting any saved cutoff or cursor.',
'Initialize Monitoring':'Builds initial configuration from verified metadata. Sets monitoring_started_at to now, cursor to page 1, zero scan failures, unblocked services and model gpt-4o-mini. Emits the control row with version 0 and an expired lease.',
'Insert Initial Control':'Persists the initial singleton control row. This is the durable baseline: stars at or before monitoring_started_at are excluded from lead discovery.',
'Every Five Minutes':'Starts the recurring coordinator every five minutes once Main is published. The exported interval relies on the Schedule Trigger default of five minutes.',
'Manual Run':'Starts the same coordinator path for an intentional test or immediate scan. It still passes through the lease checks, so manual execution does not bypass concurrency protection.',
'Read Control':'Retrieves the repository control row, including the serialized configuration and current lease. Downstream code parses it and combines it with the calling context. Missing or duplicate configuration is not treated as normal work.',
'Prepare Lease':'Requires exactly one control row. Checks lease expiry, uses the current execution ID as the prospective owner, and sets a 150-second cycle deadline. This prepares an attempt; it does not yet acquire ownership.',
'Lease Available?':'Continues only if the earlier read showed an expired lease. If another run already owns the lease, this branch ends without making API calls. The conditional update still protects against races after this check.',
'Acquire Conditional Lease':'Updates only when row ID, previously read version and expired lease all still match. Increments version, stores this execution ID as owner and extends expiry by 600 seconds. A competing run that changed the row makes this update return no rows.',
'Cycle Context':'Verifies that the acquired row belongs to this execution, parses configuration JSON, and constructs state={control, owner, deadline, config}. This common envelope accompanies all child jobs.',
'Get Due Leads':'Reads at most five pending leads whose due_at has arrived, ordered earliest first. The isTrue boolean filter avoids a string/boolean mismatch. An intentional empty result allows discovery to continue even when no lead is queued.',
'Prepare Lead Jobs':'Creates one job per queued row with lead_row_id and parsed lead JSON. If there are no rows, creates a skip=true control item solely to carry execution through the loop to discovery.',
'Loop Leads':'Processes jobs one at a time (batch size 1). Output 1 is the per-job path; output 0 is done. After Process Lead returns, the loop advances to the next item.',
'Process Lead':'Synchronously calls the Process Lead child with the current state. Waiting for the child preserves sequential work and lets Main keep ownership of the shared lease.',
'Prepare Page Slots':'Creates up to 100 page opportunities from the cycle context. These are opportunities, not a promise to fetch 100 pages: time, cooldown, and end-of-pagination checks stop early.',
'Loop Pages':'Runs page opportunities sequentially. Per-item output calls Discover Page; done output releases the lease. Continued pages loop back only when the worker says more=true.',
'Discover Page':'Synchronously calls Discover One Page. The child reloads persisted control state so it uses the latest cursor and cooldown, rather than the initial copy carried by the page slot.',
'Continue Scan?':'Checks the child result state.more. True loops for another page; false releases the lease immediately, including the end-of-scan and deferred-work cases.',
'Release Lease':'Clears owner and resets lease expiry only if this execution still owns the same control row. It does not overwrite the saved cursor/configuration. A crash before this node is recovered through lease expiry.',
'When Executed by Another Workflow':'Accepts all caller input unchanged. Main supplies a state envelope. This is a worker entry point, not a separate polling schedule or public webhook.',
'Prepare Page':'Reloads config from the current control row, sets timestamped-star media type, and requires lease ownership, at least 40 seconds remaining, no GitHub pause and an expired GitHub cooldown. Missing control throws.',
'Page Allowed?':'Routes allowed work to pacing and HTTP. Otherwise returns a compact outcome without advancing the cursor or calling GitHub.',
'Pace GitHub':'Waits one second before the page request, reducing burst pressure. Retry cooldowns are separate persistent timestamps, not long sleeping executions.',
'Fetch Stargazer Page':'GETs state.config.next_url with GitHub authentication and timestamped-star media type. Keeps status/body/headers for explicit classification. Uses a 30-second timeout and disables redirects.',
'Classify Page':'Maps the HTTP response into success, retry, or failed with a reason and optional retry_at. Reads Retry-After/rate-reset headers; distinguishes authentication, access and transient errors.',
'Page Network Failure':'Converts a timeout/transport exception into the same retry result shape used for HTTP failures. Reattaches the original page context because an HTTP error does not preserve it automatically.',
'Page Succeeded?':'Only successful responses reach normalization. Retry and permanent failures go to Record Scan Failure, leaving the current cursor intact.',
'Normalize Page':'Validates every entry has a numeric user ID, valid login and parseable star time. Normalizes event fields and validates any next-page link has the same GitHub origin/path with forward pagination. Invalid data becomes an explicit failed result.',
'Page Valid?':'Routes validated pages into new-star filtering. Malformed entries or unsafe pagination follow the scan-failure path rather than silently advancing.',
'New Stars Only':'Filters star times strictly after the stored cutoff and deduplicates user IDs within the page. Emits one state item holding a candidates array; it does not yet create database rows.',
'Candidates Present?':'Runs the key lookup only when candidates exist. No candidates still advances the page cursor because the page was successfully examined.',
'Find Existing Candidate Keys':'Uses up to 100 explicit OR conditions to find saved repository-ID/user-ID keys in one lookup. Unused slots use __unused__, which cannot match the numeric lead-key format. Explicit condition objects avoid the dynamic-array import corruption found during setup.',
'Remove Seen Leads':'Builds a set of existing keys and removes already-recorded candidates. Duplicate stored keys throw for inspection. Each new candidate becomes a queued/profile lead with zero attempts; if none remain, has_new=false keeps the cursor path alive.',
'Any New Leads?':'Inserts only genuinely unseen lead records. If all candidates were already saved, skips insertion and advances the cursor, supporting replay without resetting leads.',
'Insert New Leads in Bulk':'Persists new keys plus queued status, profile stage, pending=true, due_at and serialized lead data. Bulk mode avoids one write round trip per star. Cursor commit happens downstream, after this succeeds.',
'Advance Saved Cursor':'Prepares updated config: next page if present, otherwise page 1 for the next scan; resets failure counters and records last_complete_scan at end. Sets more according to pagination. This node prepares data but does not persist it.',
'Record Scan Failure':'Records reason and retry time, increases scan failures unless the classifier says not to count the attempt, and pauses after permanent failure or five counted failures. Forces more=false to stop this cycle.',
'Save Scan Failure':'Saves failure/cooldown configuration only while this owner still holds the control row. Preserves the failed page cursor for a later attempt.',
'Return Scan Failure':'Restores the prepared failure state after the table update replaced the item with its database response. This is a data-mapping bridge, not a second failure calculation.',
'Commit Cursor':'Conditionally persists the prepared next cursor while this run owns the control row. Since inserts precede this commit, a crash can replay saved keys safely instead of losing unseen users.',
'Return Cursor':'Restores the cursor state from Advance Saved Cursor after the database update. This retains the more flag needed by Main.',
'Return Outcome':'Returns only state.more, done=true, and a status, rather than the full internal profile/configuration. Main uses the more flag for page loops; lead status is informational.',
'Prepare Lead':'Combines caller job with fresh control/config. Requires no skip flag and at least 115 seconds remaining under the lease. A previously interrupted sending lead becomes delivery_unknown when ownership is valid, so it will not be blindly resent.',
'Recover Uncertain Send?':'Routes recovered interrupted sends directly to durable outcome saving. Otherwise continues to the normal time/lease gate.',
'Time and Lease Available?':'Allows processing only while ownership and the minimum runtime budget hold. If false, returns without changing the queued job so a later cycle can pick it up.',
'Needs Profile?':'Checks whether the saved stage is profile. New work fetches GitHub; AI/delivery retries skip the already-completed profile step.',
'Prepare Profile':'Checks GitHub pause/cooldown and selects normal profile JSON media type. Keeps the lead state while preparing request_allowed.',
'GitHub Available?':'Runs profile fetch only when GitHub is not paused or cooling down. Otherwise returns with the lead unchanged.',
'Pace Profile Request':'Waits one second before requesting an individual profile to reduce burst traffic.',
'Fetch Profile':'Requests /users/{login} with the configured GitHub credential, full JSON response and 30-second timeout. Profile identity is checked against the star user ID after the response arrives.',
'Classify Profile':'Classifies success, retry or permanent failure using the profile attempt count and GitHub response headers. Reattaches the pre-request state.',
'Profile Network Failure':'Produces a transient retry result for profile timeouts or network exceptions, then joins the normal profile response gate.',
'Profile Succeeded?':'Successful HTTP responses go to identity/qualification checks. Other results go to Map GitHub Failure so retry state and shared cooldown can be saved.',
'Normalize and Filter':'Validates profile ID, username and nonnegative integer counts. Normalizes name/bio/company. Qualifies strictly on followers >100 OR public_repos >50: qualified becomes processing/ai/pending; unqualified becomes rejected/pending=false. Malformed identity/counts become failed.',
'Save Profile':'Persists the normalized profile and qualification outcome before spending LLM credits. Writes visible lead fields and serialized JSON by lead_row_id.',
'Profile Saved':'Restores state from Normalize and Filter after the table update. Later nodes need the prepared state envelope, not the update response.',
'Qualified Lead?':'Uses the saved pending flag to continue qualified work. Rejected or validation-failed profiles return without invoking AI or Slack.',
'Needs AI?':'Runs AI only when stage is ai. A delivery retry bypasses AI and reuses the saved pitch/payload.',
'Prepare AI Prompt':'Builds a prompt from bio/company and optional product context. Requests one plain-text sentence, treats profile text as untrusted, forbids invented claims, and defines a restrained response for missing context.',
'Generate Pitch':'Basic LLM Chain submits state.prompt to the attached OpenAI model. Returns text, which must pass validation before it can be sent. Model/chain errors go to AI Failed.',
'Repair Pitch Once':'Makes one fresh generation attempt using the repair prompt. It is a bounded format repair, not an unlimited loop; another invalid result goes to AI Failed.',
'OpenAI Model':'Shared model subnode for initial generation and repair. Resolves the model from Prepare AI Prompt configuration (gpt-4o-mini), uses temperature 0.2, maxTokens 160, timeout 20 seconds and maxRetries 0. This subnode supplies the chain and is not a main data-flow step. Live use is blocked by missing API credits.',
'Validate Pitch':'Takes chain text and restores original prompt state. Checks nonempty plain text, one sentence, terminal punctuation, no newlines/links, at most 60 words and 800 characters. It validates format, not factual truth.',
'Pitch Valid?':'Accepted text moves to persistence. Invalid formatting goes through exactly one repair attempt.',
'Prepare Repair':'Regenerates the same profile-based prompt with the validation reason. Does not treat the invalid output as trusted instructions.',
'Validate Repair':'Applies the same one-sentence/plain-text limits to repair output and restores the repair context.',
'Repair Valid?':'Valid repair proceeds to save. A second invalid result follows AI Failed rather than another repair loop.',
'AI Failed':'Marks the AI stage for a delayed retry and increments its failure count; the fifth counted failure becomes failed/pending=false. Reuses the saved profile. The current no-credit error follows this path.',
'Prepare Saved Pitch':'Copies validated pitch into lead, advances stage to delivery, records model/prompt version and builds the Slack payload. Name, bio, company, counts, rationale and reference are included in plain-text blocks.',
'Save Pitch and Payload':'Persists pitch and exact payload before any Slack POST. Explicit delivery retries can therefore reuse the same text without another model call.',
'Pitch Saved':'Restores the prepared lead from Prepare Saved Pitch after the database response replaced the item.',
'Prepare Send Check':'Pass-through checkpoint for the proposed delivery. Gives later code a stable named reference while fresh control state is fetched.',
'Recheck Send Lease':'Reloads control immediately before the external side effect, avoiding reliance on the older lease and cooldown snapshot.',
'Authorize Send':'Requires current ownership, at least 40 seconds remaining, and expired Slack cooldown. If allowed, prepares status=sending and a due time six minutes ahead for interrupted-send recovery. Otherwise leaves lead unchanged.',
'Send Allowed?':'Only the true branch marks and sends. False returns without calling Slack or marking delivery successful.',
'Mark Sending':'Durably saves sending before the POST. If the process dies afterwards, the system knows delivery may have happened and can avoid automatic duplicate sends.',
'Sending Checkpoint Saved':'Restores the authorized payload/state after saving sending, then supplies it to the HTTP node.',
'Send Slack':'POSTs the saved lead.payload to the private incoming webhook. Uses a 30-second timeout, no redirects, full response and text response format. The shareable export uses a placeholder URL.',
'Classify Slack':'HTTP 200 with ok in body OR data becomes delivered and pending=false. Explicit 429 sets a retry/cooldown. Transport-like/server/ambiguous success results become unknown; other client errors fail. Uses the authorized lead context rather than expecting it in the HTTP response.',
'Slack Outcome Unknown':'Handles the HTTP error output when no reliable delivery response exists. Marks delivery_unknown and disables automatic retries because Slack may already have accepted the POST.',
'Map GitHub Failure':'Copies Retry-After/reset-derived retry time into shared GitHub cooldown, honors authentication pause, and computes lead retry/failed state from the classified profile error.',
'Outcome Checkpoint':'Pass-through convergence point for AI failures, GitHub failures, Slack results and interrupted-send recovery. Provides a stable source for persistence and later restoration.',
'Save Lead Outcome':'Saves the resulting lead status, stage, pending flag, due time and JSON by row ID. This is the durable record used by future scheduled cycles.',
'Restore Outcome':'Restores the original outcome state after saving the lead so shared service configuration is available to the next write.',
'Save Service Cooldowns':'Writes updated configuration JSON to the control row only if this owner still matches. This shares service cooldowns with later leads and scans.',
'Outcome Saved':'Restores the saved outcome for the compact final return; database row output is not mistaken for lead state.',
'Unexpected Failure':'Error Trigger entry point for unexpected production failures from linked workflows. It is not the ordinary HTTP retry branch and does not normally fire for manual test runs.',
'Safe Error Detail':'Extracts execution ID, workflow name and last node, adds a timestamp and a generic diagnostic message. Deliberately omits raw request bodies, profile text and provider error details.',
'Persist Error':'Inserts occurred_at and detail into lead_sniper_events. It does not send a Slack notification or repair the failed workflow. The error handler does not reference itself.'
}
META={
'00':('Setup and preflight','Run once before monitoring. Proves access and creates persistent state without resetting an existing baseline.','Explain this first only briefly: it is initialization, not part of every scheduled scan.'),
'10':('Main coordinator','Owns the schedule and lease, processes due leads, scans new pages, and releases ownership.','Start the demo here: this canvas explains how the other workflows fit together. New stars found during discovery are normally processed in the next cycle because due leads run first.'),
'20':('Discover one page','Reads one GitHub page, removes historical/seen users, inserts new jobs, and commits a resumable cursor.','Emphasize that successful storage must happen before cursor advancement. The discovery workflow does not fetch full profiles or send messages.'),
'30':('Process one lead','Resumes a single lead through profile validation, qualification, AI, Slack, and durable outcomes.','Explain in four sections: profile, AI, delivery, recovery. The real model is configured but unfunded; the demonstrated dummy text did not come from this production AI path.'),
'40':('Shared error recorder','Records sanitized metadata for unexpected production errors from all four other workflows.','Distinguish explicit service-error branches from unexpected workflow failure handling. This workflow logs errors; it does not notify Slack.')}

def edges(w):
    for src,ports in w['connections'].items():
        for typ,outs in ports.items():
            for index,targets in enumerate(outs):
                for t in targets: yield src,t['node'],typ,index,t.get('index',0)

def edge_label(w,src,typ,index):
    n=next(n for n in w['nodes'] if n['name']==src)
    if typ!='main':return typ
    if n['type'].endswith('.if'):return 'true' if index==0 else 'false'
    if n['type'].endswith('.splitInBatches'):return 'done' if index==0 else 'loop item'
    if n.get('onError')=='continueErrorOutput' and index==1:return 'error output'
    return 'main'

def code_tail(code):
    if 'function cloudCanWork' in code:return code.split('function cloudCanWork',1)[1].split('\n\n\n')[-1].strip()
    return code.strip()

def mappings(n):
    p=n['parameters'];typ=n['type'].split('.')[-1];s=[]
    if typ=='dataTable':
        if p.get('resource')=='table':s.append('Creates table: `'+p['tableName']+'`; existing tables are preserved.')
        else:
            s.append('Table: `'+p['dataTableId']['value']+'`; operation: `'+p.get('operation','insert')+'`.')
            cond=p.get('filters',{}).get('conditions',[])
            if len(cond)>10:s.append('Lookup: 100 OR key conditions, each mapping a candidate index to `repo_id:user_id`, or `__unused__` for absent candidates.')
            elif cond:
                s.append('Filters ('+p.get('matchType','anyCondition')+'):')
                for c in cond:s.append('- `'+c.get('keyName','id')+'` '+c.get('condition','eq')+' `'+str(c.get('keyValue','(no value needed)'))+'`')
            values=p.get('columns',{}).get('value',{})
            if values:
                s.append('Saved column mappings:')
                for k,v in values.items():s.append('- `'+k+'` ← `'+str(v)+'`')
    elif typ=='if':s.append('Condition: `'+p['conditions']['conditions'][0]['leftValue']+'`.')
    elif typ=='httpRequest':
        s.append('Request: `'+p.get('method','GET')+' '+p['url']+'`.')
        if 'jsonBody' in p:s.append('JSON body mapping: `'+p['jsonBody']+'`.')
        s.append('Response replaces the incoming item with HTTP response data; downstream code restores state from a named upstream node.')
    elif typ=='code':s.extend(['Runtime transformation (shared helper definitions omitted):','','```javascript',code_tail(p['jsCode']),'```'])
    elif typ=='chainLlm':s.append('Prompt mapping: `'+p.get('text','')+'`; output is normally `{text: "generated sentence"}`.')
    elif typ=='lmChatOpenAi':s.append('Model: `'+str(p['model']['value'])+'`; settings: `'+json.dumps(p['options'])+'`.')
    elif typ=='executeWorkflow':s.append('Child: `'+p['workflowId']['cachedResultName']+'`; caller waits for completion. State passes through to the child trigger.')
    if n.get('alwaysOutputData'):s.append('Empty-result behavior: alwaysOutputData=true produces an empty item; the next normalization/check explicitly handles this case.')
    if n.get('onError'):s.append('Node error behavior: `'+n['onError']+'`. Expected provider errors and transport exceptions may take different routes.')
    return '\n\n'.join(s)

manifest=[]
for path in sorted((ROOT/'submission-draft/workflows').glob('*.json')):
    w=json.loads(path.read_text(encoding='utf-8'));prefix=path.name[:2];title,purpose,talk=META[prefix]
    ns=w['nodes'];order=[n for n in ns if n['type'].endswith(('Trigger','.manualTrigger'))]+[n for n in ns if not n['type'].endswith(('Trigger','.manualTrigger'))]
    # Node identities/names are preserved; trigger-first listing helps narration.
    numbers={n['name']:i+1 for i,n in enumerate(order)};es=list(edges(w))
    slug=prefix+'-'+title.lower().replace(' ','-');name=slug+'.md'
    lines=['# '+w['name'],'',purpose,'','**Live canvas:** https://tryedwin.app.n8n.cloud/workflow/'+w['id'],'',f'**Canvas elements:** {len(ns)} (including sticky notes and model subnodes).','',
    '## Visual reference','', '**Actual n8n screenshot: pending.** This session has no connected browser. The diagram below is generated from exported node names and connections; it is not a screenshot or execution evidence.','',f'![Generated node index, not a screenshot](images/{slug}.svg)','',
    '## How to explain this workflow','',talk,'',
    'The detailed graph below shows branch labels and loops. Node numbers match the explanations. A model connection is shown as ai_languageModel; it supplies the chain, not an ordinary item stream.','', '```mermaid','flowchart TD']
    for n in order:lines.append(f'  n{numbers[n["name"]]}["{numbers[n["name"]]}. {n["name"].replace(chr(34),chr(39))}"]')
    for src,dst,typ,idx,_ in es:lines.append(f'  n{numbers[src]} -->|"{edge_label(w,src,typ,idx)}"| n{numbers[dst]}')
    lines.extend(['```','','## Every node explained',''])
    for n in order:
        desc=DESC.get(n['name'])
        if n['type'].endswith('.stickyNote'):
            desc='Canvas annotation only: no inputs, outputs, API calls or state writes. It explains setup/operation.'
            if '240s' in n['parameters'].get('content',''):desc+=' This exported note still says 240s; that text is stale. The actual workflow timeout is 180 seconds, with a 150-second cycle budget.'
        assert desc, 'Missing explanation: '+n['name']
        incoming=[f'{numbers[a]}. {a} ({edge_label(w,a,t,i)})' for a,b,t,i,j in es if b==n['name']]
        outgoing=[f'{edge_label(w,a,t,i)} → {numbers[b]}. {b}' for a,b,t,i,j in es if a==n['name']]
        lines.extend([f'### {numbers[n["name"]]}. {n["name"]}','',f'**Node type:** `{n["type"]}` (v{n["typeVersion"]}).','',desc,'', '**Receives from:** '+('; '.join(incoming) or 'Trigger entry or disconnected annotation; no main predecessor.') ,'','**Next paths:** '+('; '.join(outgoing) or 'No outgoing connection. This branch ends here.'),'',mappings(n),''])
    lines.extend(['## Demo accuracy notes','','Only stars after setup are eligible for discovery. Qualification uses OR, not AND. A saved pitch is reused for delivery retries. Ambiguous Slack delivery is not automatically resent.','', 'Live GitHub setup/scan and dummy Slack delivery passed. Real AI generation remains blocked by account credits. Do not describe dummy text as an LLM result.','', 'For a genuine canvas screenshot, open the live URL, close node settings, fit the canvas to view, and capture it without exposing credentials. Save it beside this guide and replace the pending screenshot notice. The generated graph remains useful for readable node labels.',''])
    (OUT/name).write_text('\n'.join(lines),encoding='utf-8')
    # A readable static index supplements the complete Mermaid edge graph.
    cols=3;cardw=380;cardh=106;gap=18;rows=(len(order)+cols-1)//cols;W=cols*(cardw+gap)+30;H=rows*(cardh+gap)+110
    svg=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',f'<rect width="{W}" height="{H}" fill="#101827"/>',f'<text x="24" y="32" fill="#f1f5f9" font-family="Arial" font-size="22">{html.escape(title)} — node index</text>', '<text x="24" y="59" fill="#a5b4c7" font-family="Arial" font-size="14">Generated from workflow JSON. NOT an n8n screenshot. See the Markdown graph for branch connections.</text>']
    for i,n in enumerate(order):
        x=24+(i%cols)*(cardw+gap);y=82+(i//cols)*(cardh+gap);typ=n['type'].split('.')[-1];color='#60a5fa' if typ=='code' else '#34d399' if typ=='dataTable' else '#fbbf24' if typ=='if' else '#c084fc'
        svg.extend([f'<rect x="{x}" y="{y}" width="{cardw}" height="{cardh}" rx="10" fill="#1e293b" stroke="{color}"/>',f'<text x="{x+14}" y="{y+25}" fill="{color}" font-family="Arial" font-size="14">{i+1:02} / {html.escape(typ)}</text>'])
        for j,line in enumerate(textwrap.wrap(n['name'],35)):svg.append(f'<text x="{x+14}" y="{y+52+j*22}" fill="#f8fafc" font-family="Arial" font-size="17">{html.escape(line)}</text>')
    svg.append('</svg>');(OUT/'images'/f'{slug}.svg').write_text('\n'.join(svg),encoding='utf-8')
    manifest.append({'guide':name,'name':w['name'],'nodes':len(ns),'id':w['id'],'screenshot':'pending','diagram':'images/'+slug+'.svg'})
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
index=['# Demo preparation — workflow guides','','These five guides explain all 109 canvas elements with exact names, purpose, incoming/outgoing paths, key data mappings, runtime code excerpts and demo talking points.','','**Screenshot limitation:** no browser is connected, so actual n8n canvas screenshots could not be captured. SVG node indexes and Mermaid graphs are explicitly generated diagrams, not screenshots.','','## Recommended demo order','','Main → Setup → Discover One Page → Process Lead → Record Errors.','','## Guides','']
for m in manifest:index.append(f'- [{m["name"]}]({m["guide"]}) — {m["nodes"]} canvas elements.')
index+=['','## State vocabulary','','- `state`: the item envelope passed between nodes and child workflows.','- `control`: the persistent repository row with owner/version/lease.','- `config`: parsed control JSON containing cursor, cutoff, cooldowns and model.','- `lead`: one saved user job, profile, pitch, payload and attempts.','- `lead_row_id`: database row identifier used for updates; different from the deduplication key.','- `repo_id:user_id`: stable deduplication reference.','- `more`: whether Main should fetch another page in this cycle.','','## Honest closing statement for the demo','','"GitHub discovery and labeled dummy Slack delivery have been verified live. The LLM path is configured and locally tested, but live generation is blocked by API credits. The accessible owned repository replaces a popular repository because of GitHub access restrictions; acceptance of that substitution is pending."','','Dummy test nodes were temporary and removed; they are not part of these five workflows.']
(OUT/'README.md').write_text('\n'.join(index)+'\n',encoding='utf-8')
print('Generated',len(manifest),'guides covering',sum(m['nodes'] for m in manifest),'canvas elements; actual screenshots pending.')
