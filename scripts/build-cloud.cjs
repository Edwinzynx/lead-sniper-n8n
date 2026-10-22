'use strict';
const fs=require('node:fs');const path=require('node:path');
const {workflow,core}=require('./build.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(root,'cloud');fs.mkdirSync(out,{recursive:true});
const cloud=fs.readFileSync(path.join(root,'src/cloud.cjs'),'utf8').replace(/^'use strict';\s*/,'').replace(/module\.exports =?[\s\S]*$/,'').replace(/module\.exports=[\s\S]*$/,'');
const ids={main:'LSCloudMain00001',lead:'LSCloudLead00001',page:'LSCloudPage00001',errors:'LSCloudErrors001',setup:'LSCloudSetup0001'};
const tables={control:'lead_sniper_control',leads:'lead_sniper_leads',events:'lead_sniper_events'};
const first='https://api.github.com/repos/Edwinzynx/hdsd-whisperFT/stargazers?per_page=100&page=1';
const manifests=[];
const types={key:'string',version:'number',owner:'string',lease_until:'date',data:'string',status:'string',stage:'string',pending:'boolean',due_at:'date',occurred_at:'date',detail:'string'};
const expr=s=>'={{ '+s+' }}';
function wf(id,name){
  const x=workflow(id,'Cloud / '+name);x.w.settings.executionTimeout=180;
  x.w.settings.errorWorkflow=ids.errors;if(id===ids.errors)delete x.w.settings.errorWorkflow;
  x.codeShared=(name,body)=>x.code(name,cloud+'\n'+body,true);
  x.dt=(name,table,operation,{filters=[],values,limit=1,always=false,orderBy}={})=>{
    const p={resource:'row',operation,dataTableId:{__rl:true,value:tables[table],mode:'name'},matchType:'allConditions',
      filters:{conditions:filters.map(([keyName,condition,keyValue])=>({keyName,condition,keyValue}))},returnAll:false,limit,options:{}};
    if(values)p.columns={mappingMode:'defineBelow',value:values,matchingColumns:[],schema:Object.keys(values).map(id=>({id,displayName:id,type:types[id],required:false,defaultMatch:false,display:true,removed:false})),attemptToConvertTypes:false,convertFieldsToString:false};
    if(orderBy)Object.assign(p,{orderBy:true,orderByColumn:orderBy,orderByDirection:'ASC'});
    return x.add(name,'dataTable',p,{typeVersion:1.1,alwaysOutputData:always});
  };
  x.getControl=(name='Read Control')=>x.dt(name,'control','get',{filters:[['key','eq','Edwinzynx/hdsd-whisperFT']],always:true,limit:2});
  x.saveControl=(name)=>x.dt(name,'control','update',{filters:[['id','eq',expr('$json.state.control.id')],['owner','eq',expr('$json.state.owner')]],values:{data:expr('JSON.stringify($json.state.config)')}});
  x.saveLead=(name)=>x.dt(name,'leads','update',{filters:[['id','eq',expr('$json.state.lead_row_id')]],values:{key:expr('$json.state.lead.key'),status:expr('$json.state.lead.status'),stage:expr('$json.state.lead.stage'),pending:expr('$json.state.lead.pending'),due_at:expr('$json.state.lead.due_at'),data:expr('JSON.stringify($json.state.lead)')}});
  x.restore=(name,ref)=>x.code(name,`return [{json:{state:$('${ref}').first().json.state}}];`);
  x.finish=()=>x.code('Return Outcome',`const s=$input.first().json.state||{};return [{json:{state:{more:s.more===true,done:true,status:s.lead?.status||s.status||'idle'}}}];`);
  x.save=file=>{fs.writeFileSync(path.join(out,file),JSON.stringify(x.w,null,2)+'\n');manifests.push({file,id:x.w.id,nodes:x.w.nodes.length});};
  return x;
}

// Setup is idempotent under a single manual execution and establishes a fixed cutoff.
{
  const x=wf(ids.setup,'Setup and Authenticated Preflight');x.add('Manual Setup','manualTrigger');
  x.code('Repository',`return [{json:{state:{accept:'application/vnd.github+json'}}}];`);
  x.http('Check Repository',{method:'GET',url:'https://api.github.com/repos/Edwinzynx/hdsd-whisperFT'},true);
  x.code('Validate Repository',`const r=$input.first().json;if(r.statusCode!==200||!r.body?.id||r.body.full_name?.toLowerCase()!=='edwinzynx/hdsd-whisperft')throw new Error('Repository preflight failed: '+r.statusCode);return [{json:{state:{repository:r.body,accept:'application/vnd.github.star+json'}}}];`);
  x.http('Check Stargazer Access',{method:'GET',url:first},true);
  x.code('Require Listing Access',`const r=$input.first().json;if(r.statusCode!==200||!Array.isArray(r.body))throw new Error('Authenticated stargazer listing failed: HTTP '+r.statusCode+'; inspect GitHub permissions or rate-limit headers');return [{json:{ok:true}}];`);
  x.code('Preflight Transport Failure',`throw new Error('GitHub preflight transport failed; check the credential and connection before activating');`);
  const cols={control:['key','version','owner','lease_until','data'],leads:['key','status','stage','pending','due_at','data'],events:['occurred_at','detail']};
  for(const t of ['control','leads','events'])x.add('Create '+t+' Table','dataTable',{resource:'table',operation:'create',tableName:tables[t],columns:{column:cols[t].map(name=>({name,type:types[name]}))},options:{createIfNotExists:true}},{typeVersion:1.1});
  x.getControl('Find Existing Control');
  x.code('Validate Singleton',`const rows=$input.all().filter(i=>i.json.id);if(rows.length>1)throw new Error('Duplicate control rows: stop and resolve before activation');return [{json:{exists:rows.length===1}}];`);
  x.iff('Needs Initialization?','$json.exists === false');
  x.codeShared('Initialize Monitoring',`const c=cloudInitial($('Validate Repository').first().json.state.repository);return [{json:{key:'Edwinzynx/hdsd-whisperFT',version:0,owner:'',lease_until:'1970-01-01T00:00:00.000Z',data:JSON.stringify(c)}}];`);
  x.dt('Insert Initial Control','control','insert',{values:Object.fromEntries(cols.control.map(k=>[k,expr('$json.'+k)]))});
  x.chain('Manual Setup','Repository','Check Repository','Validate Repository','Check Stargazer Access','Require Listing Access','Create control Table','Create leads Table','Create events Table','Find Existing Control','Validate Singleton','Needs Initialization?');
  x.edge('Needs Initialization?','Initialize Monitoring',0);x.edge('Initialize Monitoring','Insert Initial Control');
  for(const n of ['Check Repository','Check Stargazer Access'])x.edge(n,'Preflight Transport Failure',1);
  x.note('No external database. Select GitHub credentials in both HTTP nodes, then run this once. It verifies authenticated access and creates three internal Data Tables without resetting an existing cutoff. Keep inactive.');x.save('00-setup-and-preflight.json');
}

// One scheduled coordinator owns a conditional Data Table lease. It performs all
// calls to the two worker sub-workflows sequentially and has a 180-second timeout.
{
  const x=wf(ids.main,'Main - Edwinzynx hdsd-whisperFT');x.schedule('Every Five Minutes',5);x.add('Manual Run','manualTrigger');x.getControl();
  x.code('Prepare Lease',`const rows=$input.all().filter(i=>i.json.id);if(rows.length!==1)throw new Error('Run Setup first; exactly one control row is required');const r=rows[0].json;
return [{json:{row:r,can_start:Date.parse(r.lease_until)<=Date.now(),owner:String($execution.id),deadline:Date.now()+150000}}];`);
  x.iff('Lease Available?','$json.can_start === true');
  x.dt('Acquire Conditional Lease','control','update',{filters:[['id','eq',expr('$json.row.id')],['version','eq',expr('$json.row.version')],['lease_until','lte',expr('new Date().toISOString()')]],values:{version:expr('$json.row.version + 1'),owner:expr('$json.owner'),lease_until:expr('new Date(Date.now()+600000).toISOString()')}});
  x.code('Cycle Context',`const control=$input.first().json;const p=$('Prepare Lease').first().json;if(control.owner!==p.owner)throw new Error('Lease not acquired');return [{json:{state:{control,owner:p.owner,deadline:p.deadline,config:JSON.parse(control.data)}}}];`);
  x.dt('Get Due Leads','leads','get',{filters:[['pending','isTrue',undefined],['due_at','lte',expr('new Date().toISOString()')]],limit:5,always:true,orderBy:'due_at'});
  x.code('Prepare Lead Jobs',`const s=$('Cycle Context').first().json.state;const rows=$input.all().filter(i=>i.json.id);return rows.length?rows.map(i=>({json:{state:{...s,lead_row_id:i.json.id,lead:JSON.parse(i.json.data)}}})): [{json:{state:{...s,skip:true}}}];`);
  x.add('Loop Leads','splitInBatches',{batchSize:1,options:{}});x.sub('Process Lead',ids.lead);
  x.code('Prepare Page Slots',`const s=$('Cycle Context').first().json.state;return Array.from({length:100},()=>({json:{state:s}}));`);
  x.add('Loop Pages','splitInBatches',{batchSize:1,options:{}});x.sub('Discover Page',ids.page);
  x.iff('Continue Scan?','$json.state.more === true');
  x.dt('Release Lease','control','update',{filters:[['id','eq',expr('$("Cycle Context").first().json.state.control.id')],['owner','eq',expr('$("Cycle Context").first().json.state.owner')]],values:{owner:'',lease_until:'1970-01-01T00:00:00.000Z'}});
  x.chain('Every Five Minutes','Read Control','Prepare Lease','Lease Available?');x.edge('Manual Run','Read Control');x.edge('Lease Available?','Acquire Conditional Lease',0);
  x.chain('Acquire Conditional Lease','Cycle Context','Get Due Leads','Prepare Lead Jobs','Loop Leads');x.edge('Loop Leads','Process Lead',1);x.edge('Process Lead','Loop Leads');
  x.edge('Loop Leads','Prepare Page Slots',0);x.edge('Prepare Page Slots','Loop Pages');x.edge('Loop Pages','Discover Page',1);x.edge('Loop Pages','Release Lease',0);
  x.edge('Discover Page','Continue Scan?');x.edge('Continue Scan?','Loop Pages',0);x.edge('Continue Scan?','Release Lease',1);
  x.note('Import this into the shared target. Select Cloud / Process Lead and Cloud / Discover One Page in the two sub-workflow nodes. Activate only this workflow after setup. Timeout 180s; lease 600s covers a parent and an in-flight child. Do not launch sub-workflows independently.');x.save('10-main-openai-python.json');
}

// Polling cursor advances only after all new users from a page have been stored.
{
  const x=wf(ids.page,'Discover One Page');x.trigger();x.getControl();
  x.codeShared('Prepare Page',`const initial=$('When Executed by Another Workflow').first().json.state;const control=$input.first().json;if(!control.id)throw new Error('Missing control');const config=JSON.parse(control.data);const s={...initial,control,config,accept:'application/vnd.github.star+json'};
s.allowed=cloudCanWork(s,40)&&!config.github_paused&&Date.parse(config.github_blocked_until)<=Date.now();return [{json:{state:s}}];`);
  x.iff('Page Allowed?','$json.state.allowed === true');x.add('Pace GitHub','wait',{resume:'timeInterval',amount:1,unit:'seconds'});
  x.http('Fetch Stargazer Page',{method:'GET',url:expr('$json.state.config.next_url')},true);
  x.codeShared('Classify Page',`const s=$('Prepare Page').first().json.state;const r=classifyGitHub($input.first().json,s.config.scan_failures);return [{json:{state:{...s,result:r}}}];`);
  x.codeShared('Page Network Failure',`const s=$('Prepare Page').first().json.state;return [{json:{state:{...s,result:classifyGitHub({},s.config.scan_failures)}}}];`);
  x.iff('Page Succeeded?','$json.state.result.outcome === "success"');
  x.codeShared('Normalize Page',`const s=$input.first().json.state;try{const p=normalizePage(s.result.body,s.result.headers,s.config.next_url);return [{json:{state:{...s,page:p,valid:true}}}];}catch{return [{json:{state:{...s,valid:false,result:{outcome:'failed',reason:'invalid_stargazer_page'}}}}];}`);
  x.iff('Page Valid?','$json.state.valid === true');
  x.code('New Stars Only',`const s=$input.first().json.state;const candidates=[...new Map(s.page.events.filter(e=>Date.parse(e.starred_at)>Date.parse(s.config.monitoring_started_at)).map(e=>[e.user_id,e])).values()];return [{json:{state:{...s,candidates}}}];`);
  x.iff('Candidates Present?','$json.state.candidates.length > 0');
  const existing=x.dt('Find Existing Candidate Keys','leads','get',{limit:100,always:true});
  const existingNode=x.w.nodes.find(n=>n.name===existing);existingNode.parameters.matchType='anyCondition';
  existingNode.parameters.filters.conditions=Array.from({length:100},(_,i)=>({keyName:'key',condition:'eq',keyValue:expr('$json.state.candidates['+i+'] ? $json.state.config.repo_id + ":" + $json.state.candidates['+i+'].user_id : "__unused__"')}));
  x.codeShared('Remove Seen Leads',`const s=$('New Stars Only').first().json.state;const rows=$input.all().filter(i=>i.json.id);const seen=new Set(rows.map(i=>i.json.key));if(seen.size!==rows.length)throw new Error('Duplicate lead keys; stop and inspect table writers');const fresh=s.candidates.filter(e=>!seen.has(s.config.repo_id+':'+e.user_id));return fresh.length?fresh.map(e=>({json:{state:{...s,lead:cloudNewLead(e,s.config),has_new:true}}})): [{json:{state:{...s,has_new:false}}}];`);
  x.iff('Any New Leads?','$json.state.has_new === true');
  const insert=x.dt('Insert New Leads in Bulk','leads','insert',{values:{key:expr('$json.state.lead.key'),status:'queued',stage:'profile',pending:true,due_at:expr('$json.state.lead.due_at'),data:expr('JSON.stringify($json.state.lead)')}});
  x.w.nodes.find(n=>n.name===insert).parameters.options.optimizeBulk=true;
  x.code('Advance Saved Cursor',`const s=$('Normalize Page').first().json.state;const c={...s.config,next_url:s.page.next_url||${JSON.stringify(first)},scan_pages:s.page.next_url?s.config.scan_pages+1:0,scan_failures:0,last_error:null};if(!s.page.next_url)c.last_complete_scan=new Date().toISOString();return [{json:{state:{...s,config:c,more:!!s.page.next_url}}}];`);
  x.code('Record Scan Failure',`const s=$input.first().json.state;const r=s.result;const failures=s.config.scan_failures+(r.count_attempt===false?0:1);const config={...s.config,scan_failures:failures,last_error:r.reason,github_paused:r.outcome==='failed'||failures>=5,github_blocked_until:r.retry_at||s.config.github_blocked_until};return [{json:{state:{...s,config,more:false}}}];`);
  x.saveControl('Save Scan Failure');x.restore('Return Scan Failure','Record Scan Failure');
  x.saveControl('Commit Cursor');x.restore('Return Cursor','Advance Saved Cursor');x.finish();
  x.chain('When Executed by Another Workflow','Read Control','Prepare Page','Page Allowed?');x.edge('Page Allowed?','Pace GitHub',0);x.edge('Page Allowed?','Return Outcome',1);
  x.chain('Pace GitHub','Fetch Stargazer Page','Classify Page','Page Succeeded?');x.edge('Fetch Stargazer Page','Page Network Failure',1);x.edge('Page Network Failure','Page Succeeded?');
  x.edge('Page Succeeded?','Normalize Page',0);x.edge('Page Succeeded?','Record Scan Failure',1);x.chain('Normalize Page','Page Valid?');x.edge('Page Valid?','New Stars Only',0);x.edge('Page Valid?','Record Scan Failure',1);
  x.chain('New Stars Only','Candidates Present?');x.edge('Candidates Present?','Find Existing Candidate Keys',0);x.edge('Candidates Present?','Advance Saved Cursor',1);
  x.chain('Find Existing Candidate Keys','Remove Seen Leads','Any New Leads?');x.edge('Any New Leads?','Insert New Leads in Bulk',0);x.edge('Any New Leads?','Advance Saved Cursor',1);x.edge('Insert New Leads in Bulk','Advance Saved Cursor');
  x.chain('Advance Saved Cursor','Commit Cursor','Return Cursor','Return Outcome');x.chain('Record Scan Failure','Save Scan Failure','Return Scan Failure','Return Outcome');
  x.note('Only Main calls this workflow. Uses the timestamp media type, saves new candidates, then checkpoints pagination. Historical stars do not consume table storage. Partial-page failures replay the same page safely.');x.save('20-discover-page.json');
}

// Lead processing stores all durable state in a single row. Marking sending before
// the POST ensures an interrupted response never triggers an automatic duplicate.
{
  const x=wf(ids.lead,'Process Lead');x.trigger();x.getControl();
  x.codeShared('Prepare Lead',`const s=$('When Executed by Another Workflow').first().json.state;const control=$input.first().json;const config=JSON.parse(control.data);const state={...s,control,config};state.allowed=!s.skip&&cloudCanWork(state,115);if(s.lead?.status==='sending'&&cloudCanWork(state)){state.lead=cloudLeadOutcome(s.lead,{outcome:'unknown',reason:'previous_execution_interrupted_during_send'});state.recover_unknown=true;}return [{json:{state}}];`);
  x.iff('Recover Uncertain Send?','$json.state.recover_unknown === true');x.iff('Time and Lease Available?','$json.state.allowed === true');
  x.iff('Needs Profile?','$json.state.lead.stage === "profile"');
  x.code('Prepare Profile',`const s=$input.first().json.state;s.request_allowed=!s.config.github_paused&&Date.parse(s.config.github_blocked_until)<=Date.now();return [{json:{state:{...s,accept:'application/vnd.github+json'}}}];`);
  x.iff('GitHub Available?','$json.state.request_allowed === true');x.add('Pace Profile Request','wait',{resume:'timeInterval',amount:1,unit:'seconds'});
  x.http('Fetch Profile',{method:'GET',url:expr('"https://api.github.com/users/"+encodeURIComponent($json.state.lead.login)')},true);
  x.codeShared('Classify Profile',`const s=$('Prepare Profile').first().json.state;return [{json:{state:{...s,result:classifyGitHub($input.first().json,s.lead.attempts.profile)}}}];`);
  x.codeShared('Profile Network Failure',`const s=$('Prepare Profile').first().json.state;return [{json:{state:{...s,result:classifyGitHub({},s.lead.attempts.profile)}}}];`);
  x.iff('Profile Succeeded?','$json.state.result.outcome === "success"');
  x.codeShared('Normalize and Filter',`const s=$input.first().json.state;let lead={...s.lead};try{lead.profile=normalizeProfile(s.result.body,lead.user_id);const d=qualification(lead.profile);lead.reasons=d.reasons;lead.stage=d.qualified?'ai':'profile';lead.status=d.qualified?'processing':'rejected';lead.pending=d.qualified;lead.login=lead.profile.username;}catch(e){lead=cloudLeadOutcome(lead,{outcome:'failed',reason:e.message});}return [{json:{state:{...s,lead}}}];`);
  x.saveLead('Save Profile');x.restore('Profile Saved','Normalize and Filter');x.iff('Qualified Lead?','$json.state.lead.pending === true');
  x.iff('Needs AI?','$json.state.lead.stage === "ai"');
  x.codeShared('Prepare AI Prompt',`const s=$input.first().json.state;return [{json:{state:{...s,prompt:pitchPrompt(s.lead.profile,s.config.product_context)}}}];`);
  const ai=name=>x.add(name,'@n8n/n8n-nodes-langchain.chainLlm',{promptType:'define',text:expr('$json.state.prompt'),batching:{batchSize:1,delayBetweenBatches:0}},{typeVersion:1.7,onError:'continueErrorOutput',retryOnFail:false});
  ai('Generate Pitch');ai('Repair Pitch Once');
  x.add('OpenAI Model','@n8n/n8n-nodes-langchain.lmChatOpenAi',{model:{__rl:true,value:expr('$("Prepare AI Prompt").first().json.state.config.llm_model'),mode:'id'},options:{temperature:0.2,maxTokens:160,timeout:20000,maxRetries:0}},{typeVersion:1.2,credentials:{openAiApi:{id:'SELECT_OPENAI_CREDENTIAL',name:'Lead Sniper OpenAI'}}});
  x.codeShared('Validate Pitch',`const s=$('Prepare AI Prompt').first().json.state;const validation=validatePitch($input.first().json.text);return [{json:{state:{...s,validation,pitch:validation.pitch}}}];`);
  x.iff('Pitch Valid?','$json.state.validation.valid === true');
  x.codeShared('Prepare Repair',`const s=$input.first().json.state;return [{json:{state:{...s,prompt:pitchPrompt(s.lead.profile,s.config.product_context,s.validation.reason)}}}];`);
  x.codeShared('Validate Repair',`const s=$('Prepare Repair').first().json.state;const validation=validatePitch($input.first().json.text);return [{json:{state:{...s,validation,pitch:validation.pitch}}}];`);
  x.iff('Repair Valid?','$json.state.validation.valid === true');
  x.codeShared('AI Failed',`const s=$('Prepare AI Prompt').first().json.state;return [{json:{state:{...s,lead:cloudLeadOutcome(s.lead,{outcome:'retry',reason:'ai_generation_or_validation_failed'})}}}];`);
  x.codeShared('Prepare Saved Pitch',`const s=$input.first().json.state;const lead={...s.lead,pitch:s.pitch,stage:'delivery',prompt_version:'lead-pitch-v1',model:s.config.llm_model};lead.payload=slackPayload(lead);return [{json:{state:{...s,lead}}}];`);
  x.saveLead('Save Pitch and Payload');x.restore('Pitch Saved','Prepare Saved Pitch');
  x.code('Prepare Send Check',`return $input.all();`);x.getControl('Recheck Send Lease');
  x.codeShared('Authorize Send',`const s=$('Prepare Send Check').first().json.state;const control=$input.first().json;const config=JSON.parse(control.data);const current={...s,control,config};const allowed=cloudCanWork(current,40)&&Date.parse(config.slack_blocked_until)<=Date.now();return [{json:{state:{...current,send_allowed:allowed,lead:{...s.lead,status:allowed?'sending':s.lead.status,due_at:allowed?new Date(Date.now()+360000).toISOString():s.lead.due_at}}}}];`);
  x.iff('Send Allowed?','$json.state.send_allowed === true');x.saveLead('Mark Sending');x.restore('Sending Checkpoint Saved','Authorize Send');
  x.http('Send Slack',{method:'POST',url:'https://hooks.slack.com/services/REPLACE/REPLACE/REPLACE',sendBody:true,contentType:'json',specifyBody:'json',jsonBody:expr('$json.state.lead.payload')});
  x.codeShared('Classify Slack',`const s=$('Authorize Send').first().json.state;const r=classifySlack($input.first().json);const config={...s.config};if(r.outcome==='retry')config.slack_blocked_until=r.retry_at;return [{json:{state:{...s,config,lead:cloudLeadOutcome(s.lead,r)}}}];`);
  x.codeShared('Slack Outcome Unknown',`const s=$('Authorize Send').first().json.state;return [{json:{state:{...s,lead:cloudLeadOutcome(s.lead,{outcome:'unknown',reason:'slack_transport_outcome_unknown'})}}}];`);
  x.codeShared('Map GitHub Failure',`const s=$input.first().json.state;const r=s.result;const config={...s.config};if(r.retry_at)config.github_blocked_until=r.retry_at;if(r.pause_service)config.github_paused=true;return [{json:{state:{...s,config,lead:cloudLeadOutcome(s.lead,r)}}}];`);
  x.code('Outcome Checkpoint',`return $input.all();`);x.saveLead('Save Lead Outcome');x.restore('Restore Outcome','Outcome Checkpoint');x.saveControl('Save Service Cooldowns');x.restore('Outcome Saved','Outcome Checkpoint');x.finish();
  x.chain('When Executed by Another Workflow','Read Control','Prepare Lead','Recover Uncertain Send?');x.edge('Recover Uncertain Send?','Outcome Checkpoint',0);x.edge('Recover Uncertain Send?','Time and Lease Available?',1);
  x.edge('Time and Lease Available?','Needs Profile?',0);x.edge('Time and Lease Available?','Return Outcome',1);x.edge('Needs Profile?','Prepare Profile',0);x.edge('Needs Profile?','Needs AI?',1);
  x.chain('Prepare Profile','GitHub Available?');x.edge('GitHub Available?','Pace Profile Request',0);x.edge('GitHub Available?','Return Outcome',1);x.chain('Pace Profile Request','Fetch Profile','Classify Profile','Profile Succeeded?');x.edge('Fetch Profile','Profile Network Failure',1);x.edge('Profile Network Failure','Profile Succeeded?');
  x.edge('Profile Succeeded?','Normalize and Filter',0);x.edge('Profile Succeeded?','Map GitHub Failure',1);x.chain('Normalize and Filter','Save Profile','Profile Saved','Qualified Lead?');x.edge('Qualified Lead?','Needs AI?',0);x.edge('Qualified Lead?','Return Outcome',1);
  x.edge('Needs AI?','Prepare AI Prompt',0);x.edge('Needs AI?','Prepare Send Check',1);x.chain('Prepare AI Prompt','Generate Pitch','Validate Pitch','Pitch Valid?');x.edge('OpenAI Model','Generate Pitch',0,'ai_languageModel');x.edge('OpenAI Model','Repair Pitch Once',0,'ai_languageModel');x.edge('Generate Pitch','AI Failed',1);
  x.edge('Pitch Valid?','Prepare Saved Pitch',0);x.edge('Pitch Valid?','Prepare Repair',1);x.chain('Prepare Repair','Repair Pitch Once','Validate Repair','Repair Valid?');x.edge('Repair Pitch Once','AI Failed',1);x.edge('Repair Valid?','Prepare Saved Pitch',0);x.edge('Repair Valid?','AI Failed',1);
  x.chain('Prepare Saved Pitch','Save Pitch and Payload','Pitch Saved','Prepare Send Check','Recheck Send Lease','Authorize Send','Send Allowed?');x.edge('Send Allowed?','Mark Sending',0);x.edge('Send Allowed?','Return Outcome',1);x.chain('Mark Sending','Sending Checkpoint Saved','Send Slack','Classify Slack');x.edge('Send Slack','Slack Outcome Unknown',1);
  for(const n of ['Map GitHub Failure','AI Failed','Classify Slack','Slack Outcome Unknown'])x.edge(n,'Outcome Checkpoint');x.chain('Outcome Checkpoint','Save Lead Outcome','Restore Outcome','Save Service Cooldowns','Outcome Saved','Return Outcome');
  x.note('Called only by Main. Select GitHub and OpenAI credentials; enter the real incoming webhook URL only in Send Slack on your private instance. Never share an export containing that URL. All saved execution payloads are disabled.');x.save('30-process-lead.json');
}

{
  const x=wf(ids.errors,'Record Errors');x.add('Unexpected Failure','errorTrigger');
  x.code('Safe Error Detail',`const e=$input.first().json;return [{json:{occurred_at:new Date().toISOString(),detail:JSON.stringify({execution_id:e.execution?.id,workflow:e.workflow?.name,node:e.execution?.lastNodeExecuted||'trigger',message:'Unexpected execution failure; inspect metadata and pending leads'})}}];`);
  x.dt('Persist Error','events','insert',{values:{occurred_at:expr('$json.occurred_at'),detail:expr('$json.detail')}});x.edge('Unexpected Failure','Safe Error Detail');x.edge('Safe Error Detail','Persist Error');x.save('40-record-errors.json');
}

fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({repository:'Edwinzynx/hdsd-whisperFT',externalDatabaseRequired:false,workflows:manifests},null,2)+'\n');
console.log('Built '+manifests.length+' Cloud-native workflows without an external database.');
