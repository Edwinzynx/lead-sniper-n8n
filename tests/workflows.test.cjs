'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const root=path.resolve(__dirname,'..');
const schema=fs.readFileSync(path.join(root,'sql/schema.sql'),'utf8');
const workflows=fs.readdirSync(path.join(root,'workflows')).filter(f=>f.endsWith('.json')&&f!=='manifest.json').map(f=>JSON.parse(fs.readFileSync(path.join(root,'workflows',f),'utf8')));
const byId=Object.fromEntries(workflows.map(w=>[w.id,w]));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
let db;
const fn=async(name,state={})=>(await db.query(`select lead_sniper.${name}($1::jsonb) as state`,[JSON.stringify(state)])).rows[0].state;
const sql=async(q,p=[])=>db.query(q,p);
const getLead=async()=>(await sql('select * from lead_sniper.leads order by discovered_at')).rows[0];
const event=(id='1',starredAt=new Date(Date.now()+1000).toISOString())=>({user_id:id,login:'user-'+id,starred_at:starredAt});
const enqueue=async(id='1')=>fn('ingest',{repo_id:'10',source:'polling',events:[event(id)]});
const profile=(id=1,followers=120,repos=52)=>({id,login:'user-'+id,name:'Sample Developer',bio:'Builds open source automation.',company:'Example',followers,public_repos:repos});
const pitch='Their work on open-source automation at Example provides a relevant starting point for a conversation about developer workflows.';

before(async()=>{db=new PGlite({extensions:{pgcrypto}});await db.exec(schema);});
after(async()=>{await db.close();});
beforeEach(async()=>{
  // Only the disposable in-memory test database is reset.
  await db.exec('TRUNCATE lead_sniper.deliveries,lead_sniper.leads,lead_sniper.run_events,lead_sniper.config,lead_sniper.secrets RESTART IDENTITY CASCADE; UPDATE lead_sniper.service_controls SET paused=false,blocked_until=\'-infinity\',next_slot_at=\'-infinity\';');
  await fn('configure',{repo_id:'10',repo_owner:'acme',repo_name:'tool'});
  await sql('UPDATE lead_sniper.config SET enabled=true');
  await sql('INSERT INTO lead_sniper.secrets(name,value) VALUES ($1,$2),($3,$4)',['slack_webhook_url','https://hooks.slack.com/services/TEST/TEST/TEST','github_webhook_secret','test-secret-never-used-live']);
});

// A small artifact harness: executes the actual generated Code, SQL, IF and
// sub-workflow nodes. External HTTP and LLM calls are mocked; it is NOT n8n itself.
async function run(id, options={}, input={state:{}}) {
  const w=byId[id], history={}, counters={http:0,ai:0,slack:0};
  let name=options.start || w.nodes.find(n=>n.type.endsWith('.executeWorkflowTrigger')||n.type.endsWith('.manualTrigger')||n.type.endsWith('.webhook')).name;
  let items=[{json:input}];if(options.binary)items[0].binary=options.binary;
  let steps=0;
  const lookup=node=>({first:()=>history[node]?.[0],item:history[node]?.[0],all:()=>history[node]});
  const evalExpr=(text,data)=>typeof text==='string'&&text.startsWith('=')
    ? new Function('$json','$','$execution','return ('+text.slice(1).trim().replace(/^\{\{\s*|\s*\}\}$/g,'')+');')(data,lookup,{id:'test-execution'})
    : text;
  while(name){
    if(++steps>500)throw Error('Workflow did not terminate: '+id);
    const n=w.nodes.find(n=>n.name===name);assert.ok(n,'Missing node '+name);let output=0;
    const env={$input:{first:()=>items[0],all:()=>items},$json:items[0]?.json,$:lookup,$execution:{id:'test-execution'}};
    if(n.type.endsWith('.code')) {
      items=await new AsyncFunction(...Object.keys(env),n.parameters.jsCode).call({helpers:{getBinaryDataBuffer:async(i,key)=>Buffer.from(items[i].binary[key].data,'base64')}},...Object.values(env));
    } else if(n.type.endsWith('.postgres')) {
      try {const params=evalExpr(n.parameters.options.queryReplacement,items[0].json);items=(await sql(n.parameters.query,params)).rows.map(json=>({json}));}
      catch(e){if(n.onError!=='continueErrorOutput')throw e;output=1;items=[{json:{error:'mocked database failure'}}];}
    } else if(n.type.endsWith('.if')) {
      output=evalExpr(n.parameters.conditions.conditions[0].leftValue,items[0].json)?0:1;
    } else if(n.type.endsWith('.httpRequest')) {
      counters.http++;const isSlack=n.name==='Send Slack Notification';if(isSlack)counters.slack++;
      const url=evalExpr(n.parameters.url,items[0].json);
      try {const response=await options.http?.(url,items[0].json,n,counters)||{statusCode:200,body:isSlack?'ok':profile(),headers:{}};items=[{json:response}];}
      catch{output=1;items=[{json:{error:'simulated transport failure'}}];}
    } else if(n.type.endsWith('.chainLlm')) {
      counters.ai++;try{const text=await options.ai?.(items[0].json,n,counters)??pitch;items=[{json:{text}}];}
      catch{output=1;items=[{json:{error:'simulated AI failure'}}];}
    } else if(n.type.endsWith('.executeWorkflow')) {
      const result=await run(n.parameters.workflowId.value,{...options,start:undefined},items[0].json);items=result.items;
      for(const key of Object.keys(counters))counters[key]+=result.counters[key];
    } else if(n.type.endsWith('.wait')) {
      // Compress the one-second pacing waits, not API cooldowns, in tests.
      await sql("UPDATE lead_sniper.service_controls SET next_slot_at='-infinity'");
    } else if(n.type.endsWith('.respondToWebhook')) {
      return {items,counters,responseCode:evalExpr(n.parameters.options.responseCode,items[0].json)};
    } else if(!['manualTrigger','executeWorkflowTrigger','webhook'].some(t=>n.type.endsWith('.'+t))) {
      throw Error('Unsupported harness node '+n.type);
    }
    history[name]=structuredClone(items);
    const edges=w.connections[name]?.main?.[output]||[];assert.ok(edges.length<=1,'Unexpected fanout');
    name=edges[0]?.node;
  }
  return {items,counters,history};
}

test('schema migration can be reapplied without losing configuration',async()=>{await db.exec(schema);assert.equal((await sql('select count(*)::int as n from lead_sniper.config')).rows[0].n,1);});
test('baseline timestamp survives setup reruns and suppresses historical stars',async()=>{
  const started=(await sql('select monitoring_started_at from lead_sniper.config')).rows[0].monitoring_started_at;
  await fn('configure',{repo_id:'10',repo_owner:'acme',repo_name:'tool'});
  assert.deepEqual((await sql('select monitoring_started_at from lead_sniper.config')).rows[0].monitoring_started_at,started);
  await fn('ingest',{repo_id:'10',source:'polling',events:[event('1','2020-01-01T00:00:00Z')]});assert.equal((await getLead()).status,'baseline');
});
test('duplicate stars do not reset a queued or delivered lead',async()=>{
  assert.equal((await enqueue()).inserted,1);assert.equal((await enqueue()).inserted,0);
  await run('LSProcessLead001');await enqueue();assert.equal((await getLead()).status,'delivered');
  assert.equal((await sql('select count(*)::int as n from lead_sniper.deliveries')).rows[0].n,1);
});
test('claims exclude already owned leads and stale lease updates cannot change state',async()=>{
  await enqueue();const a=await fn('claim');assert.equal((await fn('claim')).work_ready,false);
  const stale=await fn('checkpoint',{...a,lease_token:crypto.randomUUID(),action:'fail',reason:'stale'});
  assert.equal(stale.work_ready,false);assert.equal((await getLead()).status,'processing');
});
test('generated workflow qualifies, calls AI and sends the persisted Slack payload',async()=>{
  await enqueue();let payload;
  const r=await run('LSProcessLead001',{http:(url,item)=>{
    if(url.includes('hooks.slack.com')){payload=item.state.payload;return {statusCode:200,body:'ok'};}
    return {statusCode:200,body:profile(),headers:{}};
  }});
  assert.equal(r.counters.ai,1);assert.equal(r.counters.slack,1);assert.equal((await getLead()).status,'delivered');
  assert.ok(payload.blocks.some(b=>b.text?.text.includes(pitch)));
});
test('generated workflow rejects exact thresholds without AI or Slack',async()=>{
  await enqueue();const r=await run('LSProcessLead001',{http:()=>({statusCode:200,body:profile(1,100,50),headers:{}})});
  assert.equal(r.counters.ai,0);assert.equal(r.counters.slack,0);assert.equal((await getLead()).status,'rejected');
});
test('malformed profile fails explicitly and cannot qualify',async()=>{
  await enqueue();const r=await run('LSProcessLead001',{http:()=>({statusCode:200,body:{...profile(),followers:'120'}})});
  assert.equal(r.counters.ai,0);assert.equal((await getLead()).last_error,'invalid_followers');
});
test('profile identity mismatch cannot enrich a different account',async()=>{
  await enqueue();await run('LSProcessLead001',{http:()=>({statusCode:200,body:profile(2)})});assert.equal((await getLead()).last_error,'profile_identity_mismatch');
});
test('invalid AI output receives exactly one repair before success',async()=>{
  await enqueue();let calls=0;
  const r=await run('LSProcessLead001',{ai:()=>++calls===1?'Sentence one. Sentence two.':pitch});
  assert.equal(r.counters.ai,2);assert.equal((await getLead()).status,'delivered');
});
test('repeated invalid AI output defers at AI checkpoint',async()=>{
  await enqueue();const r=await run('LSProcessLead001',{ai:()=>''});
  const lead=await getLead();assert.equal(r.counters.ai,2);assert.equal(r.counters.slack,0);assert.equal(lead.status,'retry_wait');assert.equal(lead.stage,'ai');
});
test('LLM transport failure is retryable without losing the saved profile',async()=>{
  await enqueue();await run('LSProcessLead001',{ai:()=>{throw Error('offline');}});
  const l=await getLead();assert.equal(l.status,'retry_wait');assert.ok(l.profile);assert.equal(l.attempts.ai,1);
});
test('GitHub Retry-After updates shared cooldown and preserves retry budget',async()=>{
  await enqueue();await run('LSProcessLead001',{http:()=>({statusCode:429,headers:{'retry-after':'600'}})});
  const l=await getLead();assert.equal(l.status,'retry_wait');assert.equal(l.attempts.profile,0);
  assert.ok(new Date(l.next_attempt_at)>new Date());
  assert.equal((await fn('api_gate',{request_url:'https://api.github.com/users/another'})).api_allowed,false);
});
test('Slack explicit rate limit resumes saved pitch and payload without another AI call',async()=>{
  await enqueue();await run('LSProcessLead001',{http:url=>url.includes('hooks.slack.com')?{statusCode:429,headers:{'retry-after':'1'}}:{statusCode:200,body:profile()}});
  assert.equal((await getLead()).stage,'delivery');
  await db.exec("UPDATE lead_sniper.leads SET next_attempt_at=now(); UPDATE lead_sniper.service_controls SET blocked_until='-infinity',next_slot_at='-infinity'");
  const r=await run('LSProcessLead001');assert.equal(r.counters.ai,0);assert.equal((await getLead()).status,'delivered');
});
test('ambiguous Slack transport failure blocks automatic redelivery',async()=>{
  await enqueue();await run('LSProcessLead001',{http:url=>{if(url.includes('hooks.slack.com'))throw Error('timeout');return {statusCode:200,body:profile()};}});
  const l=await getLead();assert.equal(l.status,'delivery_unknown');assert.equal((await fn('claim')).work_ready,false);
  await fn('reconcile',{lead_id:l.lead_id,resolution:'confirmed_sent'});assert.equal((await getLead()).status,'delivered');
});
test('stale pre-send claims are recoverable but stale sends are uncertain',async()=>{
  await enqueue();let l=await fn('claim');await sql("UPDATE lead_sniper.leads SET lease_until=now()-interval '1 minute'");
  assert.equal((await fn('recover')).requeued,1);l=await fn('claim');
  await sql("INSERT INTO lead_sniper.deliveries(lead_id,destination_id,payload,status) VALUES ($1,'slack-primary','{}','sending')",[l.lead_id]);
  await sql("UPDATE lead_sniper.leads SET lease_until=now()-interval '1 minute'");assert.equal((await fn('recover')).uncertain,1);assert.equal((await getLead()).status,'delivery_unknown');
});
test('five stage failures exhaust the retry budget',async()=>{
  await enqueue();for(let i=0;i<5;i++){await sql('UPDATE lead_sniper.leads SET next_attempt_at=now()');const l=await fn('claim');await fn('checkpoint',{...l,action:'defer',reason:'transient'});}
  assert.equal((await getLead()).status,'failed');assert.equal((await getLead()).attempts.profile,5);
});
test('polling traverses multiple pages and marks completion only after persisting last page',async()=>{
  let pages=0;const stamp=new Date(Date.now()+1000).toISOString();
  await run('LSDiscoverPoll01',{start:'Manual Poll',http:url=>{
    pages++;const second=url.includes('page=2');return {statusCode:200,body:[{user:{id:second?2:1,login:second?'user-2':'user-1'},starred_at:stamp}],headers:second?{}:{link:'<https://api.github.com/repos/acme/tool/stargazers?per_page=100&page=2>; rel="next"'}};
  }});
  assert.equal(pages,2);assert.equal((await sql('select count(*)::int as n from lead_sniper.leads')).rows[0].n,2);
  assert.equal((await sql('select baseline_complete from lead_sniper.config')).rows[0].baseline_complete,true);
});
test('partial scan retains inserted users without claiming completion',async()=>{
  let calls=0;await run('LSDiscoverPoll01',{start:'Manual Poll',http:()=>++calls===1?{statusCode:200,body:[{user:{id:1,login:'user-1'},starred_at:new Date(Date.now()+1000).toISOString()}],headers:{link:'<https://api.github.com/repos/acme/tool/stargazers?per_page=100&page=2>; rel="next"'}}:{statusCode:503}});
  assert.ok(await getLead());assert.equal((await sql('select baseline_complete from lead_sniper.config')).rows[0].baseline_complete,false);
});
test('signed webhook is persisted; tampered bytes and wrong repository are rejected/ignored',async()=>{
  await sql("UPDATE lead_sniper.config SET discovery_mode='webhook'");
  const payload={action:'created',repository:{id:10},sender:{id:1,login:'user-1'},starred_at:new Date(Date.now()+1000).toISOString()};
  const raw=Buffer.from(JSON.stringify(payload));const signature='sha256='+crypto.createHmac('sha256','test-secret-never-used-live').update(raw).digest('hex');
  const result=await run('LSDiscoverHook01',{binary:{data:{data:raw.toString('base64')}}},{headers:{'x-hub-signature-256':signature,'x-github-event':'star'}});
  assert.equal(result.responseCode,200);assert.equal((await getLead()).status,'queued');
  const bad=await fn('webhook',{signature,raw_base64:Buffer.from(JSON.stringify({...payload,repository:{id:11}})).toString('base64'),event_type:'star'});
  assert.equal(bad.http_status,401);
});
test('generated artifacts have valid graphs, Code syntax, credential references and HTTP error branches',()=>{
  for(const w of workflows){
    assert.equal(w.active,false);assert.equal(w.settings.saveDataErrorExecution,'none');
    const names=new Set(w.nodes.map(n=>n.name));assert.equal(names.size,w.nodes.length);
    for(const [from,outputs] of Object.entries(w.connections)){assert.ok(names.has(from));for(const ports of Object.values(outputs))for(const edges of ports)for(const e of edges)assert.ok(names.has(e.node),e.node);}
    for(const n of w.nodes){
      if(n.type.endsWith('.code'))assert.doesNotThrow(()=>new AsyncFunction(n.parameters.jsCode));
      if(n.type.endsWith('.httpRequest')){assert.ok(w.connections[n.name].main[1]?.length);assert.equal(n.retryOnFail,false);}
      if(n.type.endsWith('.executeWorkflow'))assert.ok(byId[n.parameters.workflowId.value]);
      if(n.type.endsWith('.lmChatOpenAi'))assert.equal(n.parameters.model.mode,'id');
    }
  }
  const worker=byId.LSWorkerClock001;assert.equal(worker.connections['Loop Work Slots'].main[0].length,0);assert.equal(worker.connections['Loop Work Slots'].main[1][0].node,'Process One Lead');
});
