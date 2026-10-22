'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'src/core.cjs'), 'utf8').replace(/^'use strict';\s*/, '').replace(/module\.exports = [\s\S]*$/, '');
const configPath = process.argv[2] && path.resolve(process.argv[2]);
const config = configPath ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
const ids = { request: 'LSGitHubRequest01', processor: 'LSProcessLead001', errors: 'LSRecordErrors01', ...config.workflowIds };
const versions = { code: 2, postgres: 2.6, if: 2.2, httpRequest: 4.2, executeWorkflow: 1.2, executeWorkflowTrigger: 1.1, scheduleTrigger: 1.2, splitInBatches: 3, wait: 1.1, manualTrigger: 1, webhook: 2.1, respondToWebhook: 1.4, errorTrigger: 1, stickyNote: 1 };
const credential = key => config.credentials?.[key] ? { id: config.credentials[key].id, name: config.credentials[key].name } : { id: 'SELECT_' + key.toUpperCase() + '_CREDENTIAL', name: 'Lead Sniper ' + key };
const out = path.join(root, 'workflows');
fs.mkdirSync(out, { recursive: true });
const built = [];

function workflow(id, name) {
  const w = { id, name: 'Lead Sniper | ' + name, active: false, nodes: [], connections: {}, settings: {
    executionOrder: 'v1', timezone: 'UTC', saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none',
    saveManualExecutions: false, saveExecutionProgress: false, executionTimeout: 3600,
    ...(id !== ids.errors ? { errorWorkflow: ids.errors } : {}),
  }, pinData: {} };
  const add = (name, type, parameters = {}, extras = {}) => {
    const fullType = type.startsWith('@') ? type : 'n8n-nodes-base.' + type;
    const id = crypto.createHash('sha256').update(w.id + ':' + name).digest('hex').slice(0, 32);
    const i = w.nodes.length;
    w.nodes.push({ id, name, type: fullType, typeVersion: versions[type] || 1, position: [240 + (i % 6) * 280, 200 + Math.floor(i / 6) * 240], parameters, ...extras });
    return name;
  };
  const edge = (from, to, output = 0, type = 'main') => {
    w.connections[from] ??= {}; w.connections[from][type] ??= [];
    while (w.connections[from][type].length <= output) w.connections[from][type].push([]);
    w.connections[from][type][output].push({ node: to, type, index: 0 });
  };
  const chain = (...names) => names.slice(0, -1).forEach((name, i) => edge(name, names[i + 1]));
  const code = (name, body, shared = false, extras = {}) => add(name, 'code', {
    mode: 'runOnceForAllItems', jsCode: (shared ? core + '\n' : '') + body,
  }, extras);
  const sql = (name, fn, expression = '$json.state') => add(name, 'postgres', {
    operation: 'executeQuery', query: `SELECT lead_sniper.${fn}($1::jsonb) AS state;`,
    options: { queryReplacement: `={{ [JSON.stringify(${expression})] }}`, largeNumbersOutput: 'text' },
  }, { credentials: { postgres: credential('postgres') } });
  const iff = (name, expression) => add(name, 'if', { conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: name, leftValue: '={{ ' + expression + ' }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and',
  }, options: {} });
  const sub = (name, target) => add(name, 'executeWorkflow', { source: 'database', workflowId: { __rl: true, value: target, mode: 'id' }, mode: 'once', options: { waitForSubWorkflow: true } });
  const trigger = () => add('When Executed by Another Workflow', 'executeWorkflowTrigger', { inputSource: 'passthrough' });
  const schedule = (name, minutes) => add(name, 'scheduleTrigger', { rule: { interval: [{ field: 'minutes', minutesInterval: minutes }] } });
  const http = (name, parameters, github = false) => add(name, 'httpRequest', {
    ...parameters,
    ...(github ? { authentication: 'predefinedCredentialType', nodeCredentialType: 'githubApi', sendHeaders: true, headerParameters: { parameters: [
      { name: 'Accept', value: '={{ $json.state.accept || "application/vnd.github+json" }}' },
      { name: 'User-Agent', value: 'LeadSniper/1.0' }, { name: 'X-GitHub-Api-Version', value: '2026-03-10' },
    ] } } : {}),
    options: { timeout: 30000, redirect: { redirect: { followRedirects: false } }, response: { response: { fullResponse: true, neverError: true, responseFormat: github ? 'json' : 'text' } } },
  }, { onError: 'continueErrorOutput', retryOnFail: false, ...(github ? { credentials: { githubApi: credential('github') } } : {}) });
  const note = content => add('Setup and behavior', 'stickyNote', { content, width: 680, height: 240 }, { position: [180, -100] });
  const save = file => { fs.writeFileSync(path.join(out, file), JSON.stringify(w, null, 2) + '\n'); built.push({ file, id: w.id, name: w.name, nodes: w.nodes.length }); return w; };
  return { w, add, edge, chain, code, sql, iff, sub, trigger, schedule, http, note, save };
}

// C: Shared GitHub transport. All request and response envelopes retain state.
{
  const x = workflow(ids.request, 'C - GitHub Request');
  x.trigger();
  x.code('Validate Request', `const s = $input.first().json.state;
const url = new URL(s.request_url);
if (url.origin !== 'https://api.github.com' || url.username || url.password || !/^\\/(users\\/[a-zA-Z0-9-]+|repos\\/[a-zA-Z0-9-]+\\/[a-zA-Z0-9_.-]+(?:\\/stargazers)?)$/.test(url.pathname)) throw new Error('Unexpected GitHub endpoint');
return [{json:{state:s}}];`);
  x.add('Pace Requests', 'wait', { resume: 'timeInterval', amount: 1, unit: 'seconds' });
  x.sql('Check Shared API Gate', 'api_gate');
  x.iff('Request Allowed?', '$json.state.api_allowed === true');
  x.iff('Short Pacing Contention?', '$json.state.api_wait === true');
  x.http('Request GitHub', { method: 'GET', url: '={{ $json.state.request_url }}' }, true);
  x.code('Classify GitHub Response', `const s = $('Check Shared API Gate').first().json.state;
return [{json:{state:{...s,result:classifyGitHub($input.first().json,s.attempt || 0)}}}];`, true);
  x.code('Classify GitHub Network Failure', `const s = $('Check Shared API Gate').first().json.state;
return [{json:{state:{...s,result:classifyGitHub({},s.attempt || 0)}}}];`, true);
  x.sql('Save API Result', 'api_result');
  x.code('Return GitHub Result', 'return $input.all();');
  x.chain('When Executed by Another Workflow', 'Validate Request', 'Pace Requests', 'Check Shared API Gate', 'Request Allowed?');
  x.edge('Request Allowed?', 'Request GitHub', 0); x.edge('Request Allowed?', 'Short Pacing Contention?', 1);
  x.edge('Short Pacing Contention?', 'Pace Requests', 0); x.edge('Short Pacing Contention?', 'Return GitHub Result', 1);
  x.edge('Request GitHub', 'Classify GitHub Response', 0); x.edge('Request GitHub', 'Classify GitHub Network Failure', 1);
  x.edge('Classify GitHub Response', 'Save API Result'); x.edge('Classify GitHub Network Failure', 'Save API Result'); x.edge('Save API Result','Return GitHub Result');
  x.note('Select PostgreSQL and GitHub credentials. The shared cooldown applies to this deployment and GitHub credential. Never hard-code a token in headers.');
  x.save('10-github-request.json');
}

// Setup validates the repository identity through the real API; does not enable monitoring.
{
  const x = workflow('LSSetupRepo00001', 'Setup - Configure Repository');
  x.add('Manual Setup', 'manualTrigger');
  x.code('Repository Configuration', `const c = ${JSON.stringify({ repo_owner: config.repoOwner || 'REPLACE_OWNER', repo_name: config.repoName || 'REPLACE_REPOSITORY', discovery_mode: config.discoveryMode || 'polling', product_context: config.productContext || '', llm_model: config.llmModel || 'gpt-4o-mini' })};
if (c.repo_owner.startsWith('REPLACE_') || c.repo_name.startsWith('REPLACE_')) throw new Error('Set the repository in Repository Configuration first');
return [{json:{state:{...c,request_url:'https://api.github.com/repos/'+encodeURIComponent(c.repo_owner)+'/'+encodeURIComponent(c.repo_name),execution_id:$execution.id}}}];`);
  x.sub('Verify GitHub Repository', ids.request);
  x.code('Map Repository Identity', `const s = $input.first().json.state;
if (s.result.outcome !== 'success') throw new Error(s.result.reason);
if (!s.result.body?.id || !s.result.body?.owner?.login || !s.result.body?.name) throw new Error('Invalid repository response');
return [{json:{state:{...s,repo_id:String(s.result.body.id),repo_owner:s.result.body.owner.login,repo_name:s.result.body.name}}}];`);
  x.sql('Save Configuration', 'configure');
  x.chain('Manual Setup', 'Repository Configuration', 'Verify GitHub Repository', 'Map Repository Identity', 'Save Configuration');
  x.note('Run schema.sql first, select credentials, set owner/repository, and select workflow C in the sub-workflow node. This validates repository identity, NOT stargazer-list permissions. Enable only after completing README preflight.');
  x.save('00-configure-repository.json');
}

// A polling discovery: one row per page envelope, pagination only after persistence.
{
  const x = workflow('LSDiscoverPoll01', 'A - Poll Stargazers');
  x.schedule('Poll Every 10 Minutes', 10); x.add('Manual Poll', 'manualTrigger');
  x.sql('Claim Scan', 'scan_begin', '{execution_id:$execution.id}');
  x.iff('Scan Ready?', '$json.state.scan_ready === true');
  x.sub('Fetch Stargazer Page', ids.request);
  x.iff('Page Successful?', '$json.state.result.outcome === "success"');
  x.code('Normalize Stargazer Page', `const s=$input.first().json.state;
try {return [{json:{state:{...s,...normalizePage(s.result.body,s.result.headers,s.request_url)}}}];}
catch {return [{json:{state:{...s,result:{outcome:'failed',reason:'invalid_stargazer_page'},page_invalid:true}}}];}`, true);
  x.iff('Page Valid?', '$json.state.page_invalid !== true');
  x.sql('Persist Page and Advance', 'scan_page');
  x.sql('Defer or Disable Scan', 'scan_fail');
  x.chain('Poll Every 10 Minutes','Claim Scan','Scan Ready?'); x.edge('Manual Poll','Claim Scan');
  x.edge('Scan Ready?','Fetch Stargazer Page',0); x.edge('Fetch Stargazer Page','Page Successful?');
  x.edge('Page Successful?','Normalize Stargazer Page',0); x.edge('Page Successful?','Defer or Disable Scan',1);
  x.edge('Normalize Stargazer Page','Page Valid?'); x.edge('Page Valid?','Persist Page and Advance',0); x.edge('Page Valid?','Defer or Disable Scan',1);
  x.edge('Persist Page and Advance','Scan Ready?');
  x.note('Uses full paginated scans and a fixed monitoring-start timestamp. Repeated users never reset state. Incomplete scans restart from page 1; max-page exhaustion pauses configuration explicitly. Select C and PostgreSQL before activation.');
  x.save('20-poll-stargazers.json');
}

// A webhook discovery: exact raw bytes are verified by pgcrypto before durable acknowledgment.
{
  const x=workflow('LSDiscoverHook01','A - Receive Star Webhook');
  x.add('Receive GitHub Webhook','webhook',{httpMethod:'POST',path:'lead-sniper-github',responseMode:'responseNode',options:{rawBody:true}},{webhookId:'b61c5fe7-d5a4-4b1e-89b5-47180d1b836b'});
  x.code('Capture Signed Raw Body',`const item=$input.first();
const bytes=await this.helpers.getBinaryDataBuffer(0,'data');
const h=item.json.headers||{};
return [{json:{state:{raw_base64:bytes.toString('base64'),signature:h['x-hub-signature-256']||'',event_type:h['x-github-event']||'',execution_id:$execution.id}}}];`);
  const name=x.sql('Verify Signature and Persist','webhook'); x.w.nodes.find(n=>n.name===name).onError='continueErrorOutput';
  x.code('Database Unavailable',`return [{json:{state:{http_status:503,message:'Persistence unavailable'}}}];`);
  x.add('Acknowledge Persisted Event','respondToWebhook',{respondWith:'json',responseBody:'={{ {message:$json.state.message} }}',options:{responseCode:'={{ $json.state.http_status }}'}});
  x.chain('Receive GitHub Webhook','Capture Signed Raw Body','Verify Signature and Persist','Acknowledge Persisted Event');
  x.edge('Verify Signature and Persist','Database Unavailable',1); x.edge('Database Unavailable','Acknowledge Persisted Event');
  x.note('Set mode=webhook. Configure GitHub application/json star events and a strong signing secret also stored in lead_sniper.secrets. GitHub does not automatically redeliver every failed delivery; use its Recent deliveries screen after an outage.');
  x.save('21-receive-webhook.json');
}

// B processor: exactly one claimed lead per sub-execution. Named .first() references
// are intentional here: upstream nodes each execute once for this single lead.
{
  const x=workflow(ids.processor,'B - Process One Lead'); x.trigger();
  x.sql('Claim One Lead','claim','{execution_id:$execution.id}'); x.iff('Lead Available?','$json.state.work_ready === true');
  x.iff('Needs Profile?','$json.state.stage === "profile"');
  x.code('Prepare Profile Request',`const s=$input.first().json.state; return [{json:{state:{...s,request_url:'https://api.github.com/users/'+encodeURIComponent(s.login),accept:'application/vnd.github+json',attempt:s.attempts.profile}}}];`);
  x.sub('Fetch Full Profile',ids.request); x.iff('Profile Successful?','$json.state.result.outcome === "success"');
  x.code('Normalize and Qualify Profile',`const s=$input.first().json.state; try {const profile=normalizeProfile(s.result.body,s.user_id);return [{json:{state:{...s,profile,decision:qualification(profile),action:'profile'}}}];}
catch(e) {return [{json:{state:{...s,action:'fail',reason:e.message}}}];}`,true);
  x.sql('Save Profile Decision','checkpoint'); x.iff('Continue Qualified Lead?','$json.state.work_ready === true');
  x.iff('Needs Pitch?','$json.state.stage === "ai"');
  x.sql('Renew Before AI','checkpoint','{...$json.state,action:"renew"}'); x.iff('AI Lease Valid?','$json.state.work_ready === true');
  x.code('Prepare AI Prompt',`const s=$input.first().json.state; return [{json:{state:{...s,prompt:pitchPrompt(s.profile,s.product_context)}}}];`,true);
  const ai=(name,promptRef)=>x.add(name,'@n8n/n8n-nodes-langchain.chainLlm',{promptType:'define',text:'={{ $json.state.prompt }}',hasOutputParser:false,batching:{batchSize:1,delayBetweenBatches:0}},{typeVersion:1.7,onError:'continueErrorOutput',retryOnFail:false});
  ai('Generate One-Sentence Pitch');
  x.add('OpenAI Chat Model','@n8n/n8n-nodes-langchain.lmChatOpenAi',{
    model:{__rl:true,value:'={{ $("Prepare AI Prompt").first().json.state.llm_model }}',mode:'id'},
    options:{temperature:0.2,maxTokens:160,timeout:60000,maxRetries:0},
  },{typeVersion:1.2,credentials:{openAiApi:credential('openai')}});
  x.code('Validate Initial Pitch',`const s=$('Prepare AI Prompt').first().json.state; const v=validatePitch($input.first().json.text);
return [{json:{state:{...s,validation:v,pitch:v.pitch}}}];`,true);
  x.iff('Initial Pitch Valid?','$json.state.validation.valid === true');
  x.code('Prepare Repair Prompt',`const s=$input.first().json.state; return [{json:{state:{...s,prompt:pitchPrompt(s.profile,s.product_context,s.validation.reason)}}}];`,true);
  ai('Repair Pitch Once');
  x.code('Validate Repaired Pitch',`const s=$('Prepare Repair Prompt').first().json.state; const v=validatePitch($input.first().json.text);
return [{json:{state:{...s,validation:v,pitch:v.pitch}}}];`,true);
  x.iff('Repaired Pitch Valid?','$json.state.validation.valid === true');
  x.code('AI Failure',`const s=$('Prepare AI Prompt').first().json.state;
return [{json:{state:{...s,action:'defer',reason:'ai_generation_or_validation_failed',count_attempt:true}}}];`);
  x.sql('Save Valid Pitch','checkpoint','{...$json.state,action:"pitch"}');
  x.iff('Delivery Lease Valid?','$json.state.work_ready === true');
  x.code('Compose Slack Payload',`const s=$input.first().json.state;return [{json:{state:{...s,payload:slackPayload(s),action:'prepare_delivery'}}}];`,true);
  x.sql('Persist Notification','checkpoint');
  x.sql('Authorize Send Attempt','checkpoint','{...$json.state,action:"begin_send"}');
  x.iff('Send Authorized?','$json.state.send_ready === true');
  x.http('Send Slack Notification',{method:'POST',url:'={{ $json.state.slack_webhook_url }}',sendBody:true,contentType:'json',specifyBody:'json',jsonBody:'={{ $json.state.payload }}'});
  x.code('Classify Slack Result',`const s={...$('Authorize Send Attempt').first().json.state};delete s.slack_webhook_url;
const r=classifySlack($input.first().json);return [{json:{state:{...s,...r,action:{sent:'sent',retry:'defer',failed:'fail',unknown:'unknown'}[r.outcome]}}}];`,true);
  x.code('Uncertain Slack Transport',`const s={...$('Authorize Send Attempt').first().json.state};delete s.slack_webhook_url;
return [{json:{state:{...s,action:'unknown',reason:'slack_transport_outcome_unknown'}}}];`);
  x.code('Map Profile Failure',`const s=$input.first().json.state;const r=s.result;return [{json:{state:{...s,...r,action:r.outcome==='retry'?'defer':'fail'}}}];`);
  x.sql('Save Processing Outcome','checkpoint');
  x.code('Return Processing Outcome',`const s=$input.first().json.state;return [{json:{state:{work_ready:false,lead_id:s.lead_id||null,status:s.status||'idle',reason:s.reason||s.last_error||null}}}];`);
  x.chain('When Executed by Another Workflow','Claim One Lead','Lead Available?');
  x.edge('Lead Available?','Needs Profile?',0);x.edge('Lead Available?','Return Processing Outcome',1);
  x.edge('Needs Profile?','Prepare Profile Request',0);x.edge('Needs Profile?','Needs Pitch?',1);
  x.chain('Prepare Profile Request','Fetch Full Profile','Profile Successful?');
  x.edge('Profile Successful?','Normalize and Qualify Profile',0);x.edge('Profile Successful?','Map Profile Failure',1);
  x.chain('Normalize and Qualify Profile','Save Profile Decision','Continue Qualified Lead?');
  x.edge('Continue Qualified Lead?','Needs Pitch?',0);x.edge('Continue Qualified Lead?','Return Processing Outcome',1);
  x.edge('Needs Pitch?','Renew Before AI',0);x.edge('Needs Pitch?','Delivery Lease Valid?',1);
  x.chain('Renew Before AI','AI Lease Valid?');x.edge('AI Lease Valid?','Prepare AI Prompt',0);x.edge('AI Lease Valid?','Return Processing Outcome',1);
  x.chain('Prepare AI Prompt','Generate One-Sentence Pitch','Validate Initial Pitch','Initial Pitch Valid?');
  x.edge('Generate One-Sentence Pitch','AI Failure',1);x.edge('OpenAI Chat Model','Generate One-Sentence Pitch',0,'ai_languageModel');
  x.edge('Initial Pitch Valid?','Save Valid Pitch',0);x.edge('Initial Pitch Valid?','Prepare Repair Prompt',1);
  x.chain('Prepare Repair Prompt','Repair Pitch Once','Validate Repaired Pitch','Repaired Pitch Valid?');
  x.edge('OpenAI Chat Model','Repair Pitch Once',0,'ai_languageModel');x.edge('Repair Pitch Once','AI Failure',1);
  x.edge('Repaired Pitch Valid?','Save Valid Pitch',0);x.edge('Repaired Pitch Valid?','AI Failure',1);
  x.edge('Save Valid Pitch','Delivery Lease Valid?');x.edge('Delivery Lease Valid?','Compose Slack Payload',0);x.edge('Delivery Lease Valid?','Return Processing Outcome',1);
  x.chain('Compose Slack Payload','Persist Notification','Authorize Send Attempt','Send Authorized?');
  x.edge('Send Authorized?','Send Slack Notification',0);x.edge('Send Authorized?','Return Processing Outcome',1);
  x.edge('Send Slack Notification','Classify Slack Result',0);x.edge('Send Slack Notification','Uncertain Slack Transport',1);
  for(const n of ['Classify Slack Result','Uncertain Slack Transport','Map Profile Failure','AI Failure'])x.edge(n,'Save Processing Outcome');
  x.edge('Save Processing Outcome','Return Processing Outcome');
  x.note('One lead per sub-execution preserves data lineage. Select C, PostgreSQL and OpenAI credentials. Notification payloads and pitches are checkpointed. Slack secrets are fetched only immediately before sending; keep execution payload saving disabled.');
  x.save('30-process-one-lead.json');
}

// B scheduler: ten independent claims, sequentially, with the correct loop output.
{
  const x=workflow('LSWorkerClock001','B - Worker Schedule');x.schedule('Every Minute',1);x.add('Manual Worker','manualTrigger');
  x.code('Create Ten Work Slots',`return Array.from({length:10},(_,slot)=>({json:{slot}}));`);
  x.add('Loop Work Slots','splitInBatches',{batchSize:1,options:{}});
  x.sub('Process One Lead',ids.processor);
  x.add('Pace Worker','wait',{resume:'timeInterval',amount:1,unit:'seconds'});
  x.chain('Every Minute','Create Ten Work Slots','Loop Work Slots');x.edge('Manual Worker','Create Ten Work Slots');
  x.edge('Loop Work Slots','Process One Lead',1);x.chain('Process One Lead','Pace Worker','Loop Work Slots');
  x.note('Import this workflow into the shared target if desired: https://tryedwin.app.n8n.cloud/workflow/cihlgiO4ZiWvgPlB . Select the imported B - Process One Lead sub-workflow. Loop output 0 is DONE; output 1 is LOOP. Activate after preflight.');
  x.save('31-worker-schedule.json');
}

{
  const x=workflow('LSRecovery000001','D - Recover Expired Work');x.schedule('Every Five Minutes',5);x.add('Manual Recovery','manualTrigger');
  x.sql('Recover Expired Leases','recover','{execution_id:$execution.id}');x.edge('Every Five Minutes','Recover Expired Leases');x.edge('Manual Recovery','Recover Expired Leases');
  x.note('Stale pre-send work is requeued. Stale sending work becomes delivery_unknown for manual reconciliation. Never manually change unknown to queued without checking the Slack reference.');x.save('40-recover-work.json');
}

{
  const x=workflow(ids.errors,'E - Record Unexpected Errors');x.add('Execution Failed','errorTrigger');
  x.code('Sanitize Execution Error',`const e=$input.first().json;
return [{json:{state:{execution_id:e.execution?.id||null,stage:'workflow',outcome:'unexpected_failure',reason:'Execution failed at '+String(e.execution?.lastNodeExecuted||e.trigger?.error?.node?.name||'trigger').slice(0,100)}}}];`);
  x.sql('Record Sanitized Error','audit');x.chain('Execution Failed','Sanitize Execution Error','Record Sanitized Error');
  x.note('Assign this workflow as Error Workflow on all the other workflows after import. It intentionally has no error workflow of its own. Raw exception text is not logged because it may contain request secrets.');x.save('50-record-errors.json');
}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({target:'https://tryedwin.app.n8n.cloud/workflow/cihlgiO4ZiWvgPlB',workflows:built},null,2)+'\n');
console.log('Built '+built.length+' inactive workflows ('+built.reduce((a,w)=>a+w.nodes,0)+' nodes).');
module.exports = { workflow, core };
