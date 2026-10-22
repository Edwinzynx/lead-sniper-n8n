'use strict';
const {test,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {cloudInitial,cloudNewLead,cloudLeadOutcome,cloudCanWork}=require('../src/cloud.cjs');
const root=path.resolve(__dirname,'..');
const workflows=fs.readdirSync(path.join(root,'cloud')).filter(f=>f.endsWith('.json')&&f!=='manifest.json').map(f=>JSON.parse(fs.readFileSync(path.join(root,'cloud',f),'utf8')));
const byId=Object.fromEntries(workflows.map(w=>[w.id,w]));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const repository={id:1234,full_name:'Edwinzynx/hdsd-whisperFT',owner:{login:'Edwinzynx'},name:'hdsd-whisperFT'};
const pitch='Their work on Python integrations provides a relevant starting point for discussing developer automation with the team.';
let tables,sequence,execution;
beforeEach(()=>{tables={};sequence=0;execution=0;});
const insert=(name,row)=>{const result={id:++sequence,...structuredClone(row)};tables[name].rows.push(result);return result;};
const control=()=>tables.lead_sniper_control.rows[0];
const leads=()=>tables.lead_sniper_leads.rows;
const profile=(id=1,followers=120,repos=52)=>({id,login:'user-'+id,name:'Developer '+id,bio:'Builds Python integrations.',company:'Example',followers,public_repos:repos});
const star=(id=1,when=Date.now()+1000)=>({user:{id,login:'user-'+id},starred_at:new Date(when).toISOString()});

// Data Table emulator for artifact tests. Filtering/updating is one synchronous
// operation to model the conditional UPDATE verified in n8n's official source.
// This is not a claim that the target Cloud instance has been exercised.
async function run(id,options={},input={state:{}}){
  const w=byId[id],history={},loops={},counters={ai:0,slack:0,github:0,bulk:0};const executionId='cloud-test-'+ ++execution;
  let name=options.start||w.nodes.find(n=>n.type.endsWith('.executeWorkflowTrigger')||n.type.endsWith('.manualTrigger')).name;
  let items=[{json:input}],steps=0;
  const lookup=n=>({first:()=>history[n]?.[0],item:history[n]?.[0],all:()=>history[n]});
  const evalValue=(value,json)=>{
    if(typeof value==='string'&&value.startsWith('='))return new Function('$json','$','$execution','return ('+value.slice(1).trim().replace(/^\{\{\s*|\s*\}\}$/g,'')+');')(json,lookup,{id:executionId});
    if(Array.isArray(value))return value.map(v=>evalValue(v,json));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,evalValue(v,json)]));return value;
  };
  while(name){
    if(++steps>10000)throw Error('Unbounded workflow '+id);const n=w.nodes.find(n=>n.name===name);assert.ok(n,'Missing '+name);let port=0;
    const before=structuredClone(items);await options.beforeNode?.(n,before);
    if(n.type.endsWith('.code')){
      const env={$input:{first:()=>items[0],all:()=>items},$json:items[0]?.json,$:lookup,$execution:{id:executionId}};
      items=await new AsyncFunction(...Object.keys(env),n.parameters.jsCode)(...Object.values(env));
    }else if(n.type.endsWith('.dataTable')){
      const p=n.parameters;
      if(p.resource==='table'){
        const table=tables[p.tableName]??={schema:Object.fromEntries(p.columns.column.map(c=>[c.name,c.type])),rows:[]};
        items=[{json:{name:p.tableName,columns:table.schema}}];
      }else{
        const table=tables[p.dataTableId.value];assert.ok(table,'Table missing: '+p.dataTableId.value);const results=[];
        for(const item of items){
          const q=evalValue(p,item.json);const conditions=q.filters.conditions;
          const matches=row=>{const result=conditions.map(c=>{
            const a=row[c.keyName],b=c.keyValue;
            if(c.condition==='isTrue')return a===true;
            if(c.condition==='eq')return a===b;
            if(c.condition==='lte')return a<=b;
            throw Error('Unsupported condition '+c.condition);
          });return q.matchType==='anyCondition'?result.some(Boolean):result.every(Boolean);};
          if(q.operation==='get'){
            let rows=table.rows.filter(matches);if(q.orderBy)rows=rows.toSorted((a,b)=>String(a[q.orderByColumn]).localeCompare(String(b[q.orderByColumn])));
            results.push(...rows.slice(0,q.limit).map(json=>({json:structuredClone(json)})));
          }else{
            const values=q.columns.value;
            for(const [key,value]of Object.entries(values)){
              assert.ok(key in table.schema,'Unrecognized column '+key);const type=table.schema[key];
              assert.ok(type==='date'?Number.isFinite(Date.parse(value)):typeof value===type,`${key} expected ${type}, got ${value}`);
            }
            if(q.operation==='insert'){const row=insert(p.dataTableId.value,values);results.push({json:row});}
            else if(q.operation==='update'){for(const row of table.rows.filter(matches)){Object.assign(row,structuredClone(values));results.push({json:structuredClone(row)});}}
            else throw Error('Unsupported operation '+q.operation);
          }
        }
        if(p.operation==='insert'&&p.options.optimizeBulk){counters.bulk++;items=[{json:{count:results.length}}];}
        else items=results.length?results:n.alwaysOutputData?[{json:{}}]:[];
      }
    }else if(n.type.endsWith('.if')){
      const flags=items.map(i=>!!evalValue(n.parameters.conditions.conditions[0].leftValue,i.json));
      assert.ok(flags.every(f=>f===flags[0]),'Mixed branches unsupported by this test path');port=flags[0]?0:1;
    }else if(n.type.endsWith('.splitInBatches')){
      if(!loops[name])loops[name]={queue:[...items],done:[]};else loops[name].done.push(...items);
      const loop=loops[name];if(loop.queue.length){items=[loop.queue.shift()];port=1;}else{items=loop.done.length?loop.done:[{json:{}}];port=0;}
    }else if(n.type.endsWith('.executeWorkflow')){
      const result=await run(n.parameters.workflowId.value,{...options,start:undefined},items[0].json);items=result.items;
      for(const key of Object.keys(counters))counters[key]+=result.counters[key];
    }else if(n.type.endsWith('.httpRequest')){
      const url=evalValue(n.parameters.url,items[0].json);const isSlack=url.includes('hooks.slack.com');counters[isSlack?'slack':'github']++;
      try{const response=await options.http?.(url,items[0].json,n,counters)??(isSlack?{statusCode:200,body:'ok'}:url.endsWith('/hdsd-whisperFT')?{statusCode:200,body:repository}:url.includes('/stargazers')?{statusCode:200,body:[],headers:{}}:{statusCode:200,body:profile(),headers:{}});items=[{json:response}];}
      catch{port=1;items=[{json:{error:'mock transport failure'}}];}
    }else if(n.type.endsWith('.chainLlm')){
      counters.ai++;try{items=[{json:{text:await options.ai?.(items[0].json,n,counters)??pitch}}];}catch{port=1;items=[{json:{error:'mock LLM failure'}}];}
    }else if(!['wait','manualTrigger','executeWorkflowTrigger','errorTrigger'].some(t=>n.type.endsWith('.'+t)))throw Error('Unsupported node '+n.type);
    await options.afterNode?.(n,items);
    history[name]=structuredClone(items);if(!items.length)break;
    const edges=w.connections[name]?.main?.[port]||[];assert.ok(edges.length<=1);name=edges[0]?.node;
  }
  return {items,counters,history};
}
async function setup(){await run('LSCloudSetup0001');}
test('scheduled main admits a queued lead within the Cloud runtime budget',async()=>{
  await setup();const row=addLead();
  const result=await run('LSCloudMain00001',{http:url=>url.includes('hooks.slack.com')?{statusCode:200,data:'ok'}:url.includes('/users/')?{statusCode:200,body:profile(),headers:{}}:{statusCode:200,body:[],headers:{}}});
  assert.equal(result.counters.ai,1);assert.equal(result.counters.slack,1);
  assert.equal(row.status,'delivered');assert.equal(control().owner,'');
});
function acquire(){const r=control();r.owner='owner';r.lease_until=new Date(Date.now()+600000).toISOString();return {control:structuredClone(r),config:JSON.parse(r.data),owner:'owner',deadline:Date.now()+150000};}
function addLead(id=1){const config=JSON.parse(control().data);const l=cloudNewLead({user_id:String(id),login:'user-'+id,starred_at:new Date().toISOString()},config);return insert('lead_sniper_leads',{key:l.key,status:l.status,stage:l.stage,pending:l.pending,due_at:l.due_at,data:JSON.stringify(l)});}
function job(row){return {state:{...acquire(),lead_row_id:row.id,lead:JSON.parse(row.data)}};}

test('Cloud setup preflights authenticated nodes, creates tables and preserves cutoff',async()=>{
  await setup();const c=control();const cutoff=JSON.parse(c.data).monitoring_started_at;await setup();assert.equal(tables.lead_sniper_control.rows.length,1);assert.equal(JSON.parse(control().data).monitoring_started_at,cutoff);
});
test('failed GitHub access cannot silently initialize monitoring',async()=>{
  await assert.rejects(()=>run('LSCloudSetup0001',{http:()=>({statusCode:403,body:{message:'denied'}})}),/preflight/);assert.equal(Object.keys(tables).length,0);
});
test('conditional control update excludes an overlapping scheduled run',async()=>{
  await setup();const s=acquire();const before=control().version;const result=await run('LSCloudMain00001');assert.equal(result.counters.github,0);assert.equal(control().owner,s.owner);assert.equal(control().version,before);
});
test('compare-and-set rejects a stale version even if the earlier read saw no lease',async()=>{
  await setup();const r=await run('LSCloudMain00001',{beforeNode:n=>{if(n.name==='Acquire Conditional Lease')control().version++;}});
  assert.equal(r.counters.github,0);assert.equal(r.counters.ai,0);
});
test('polling ingests a page in bulk and deduplicates replay without storing baseline rows',async()=>{
  await setup();const s=acquire();const response={statusCode:200,body:[star(1),star(2),star(3,Date.parse('2020-01-01'))],headers:{}};
  const r=await run('LSCloudPage00001',{http:()=>response},{state:s});assert.equal(leads().length,2);assert.equal(r.counters.bulk,1);
  await run('LSCloudPage00001',{http:()=>response},{state:s});assert.equal(leads().length,2);
});
test('cursor moves only after bulk insertion succeeds and supports restart',async()=>{
  await setup();const s=acquire();const next='https://api.github.com/repos/Edwinzynx/hdsd-whisperFT/stargazers?per_page=100&page=2';
  const response={statusCode:200,body:[star()],headers:{link:'<'+next+'>; rel="next"'}};
  await assert.rejects(()=>run('LSCloudPage00001',{http:()=>response,beforeNode:n=>{if(n.name==='Commit Cursor')throw Error('simulated crash');}},{state:s}));
  assert.equal(leads().length,1);assert.ok(JSON.parse(control().data).next_url.endsWith('page=1'));
  await run('LSCloudPage00001',{http:()=>response},{state:s});assert.equal(leads().length,1);assert.equal(JSON.parse(control().data).next_url,next);
});
test('main scans multiple pages sequentially and releases its lease',async()=>{
  await setup();let pages=0;const r=await run('LSCloudMain00001',{http:url=>{
    pages++;return {statusCode:200,body:[star(pages)],headers:pages===1?{link:'<https://api.github.com/repos/Edwinzynx/hdsd-whisperFT/stargazers?per_page=100&page=2>; rel="next"'}:{}};
  }});assert.equal(pages,2);assert.equal(leads().length,2);assert.equal(control().owner,'');assert.ok(JSON.parse(control().data).last_complete_scan);
});
test('Cloud processor qualifies, saves pitch, and sends exactly once',async()=>{
  await setup();const row=addLead();let sent;const r=await run('LSCloudLead00001',{http:(url,item)=>{if(url.includes('hooks.slack.com')){sent=item.state.lead.payload;return {statusCode:200,body:'ok'};}return {statusCode:200,body:profile(),headers:{}};}},job(row));
  assert.equal(row.status,'delivered');assert.equal(row.pending,false);assert.equal(r.counters.ai,1);assert.equal(r.counters.slack,1);assert.ok(sent.blocks.some(b=>b.text?.text.includes(pitch)));
});
test('exact threshold rejection performs no LLM or Slack calls',async()=>{
  await setup();const row=addLead();const r=await run('LSCloudLead00001',{http:()=>({statusCode:200,body:profile(1,100,50)})},job(row));assert.equal(row.status,'rejected');assert.equal(r.counters.ai,0);assert.equal(r.counters.slack,0);
});
test('bad numeric types fail explicitly',async()=>{
  await setup();const row=addLead();await run('LSCloudLead00001',{http:()=>({statusCode:200,body:{...profile(),followers:'120'}})},job(row));assert.equal(row.status,'failed');assert.match(JSON.parse(row.data).last_error,/invalid_followers/);
});
test('pitch repair is bounded to one attempt',async()=>{
  await setup();const row=addLead();const r=await run('LSCloudLead00001',{ai:()=>''},job(row));assert.equal(r.counters.ai,2);assert.equal(row.status,'retry_wait');assert.equal(row.stage,'ai');assert.equal(JSON.parse(row.data).attempts.ai,1);
});
test('Slack 429 stores cooldown and resumes from payload without another AI call',async()=>{
  await setup();const row=addLead();await run('LSCloudLead00001',{http:url=>url.includes('hooks.slack.com')?{statusCode:429,headers:{'retry-after':'5'}}:{statusCode:200,body:profile()}},job(row));
  assert.equal(row.status,'retry_wait');assert.equal(row.stage,'delivery');const c=JSON.parse(control().data);assert.ok(Date.parse(c.slack_blocked_until)>Date.now());c.slack_blocked_until='1970-01-01T00:00:00.000Z';control().data=JSON.stringify(c);
  const r=await run('LSCloudLead00001',{},job(row));assert.equal(r.counters.ai,0);assert.equal(row.status,'delivered');
});
test('a transport timeout leaves delivery_unknown and not pending',async()=>{
  await setup();const row=addLead();await run('LSCloudLead00001',{http:url=>{if(url.includes('hooks.slack.com'))throw Error('timeout');return {statusCode:200,body:profile()};}},job(row));assert.equal(row.status,'delivery_unknown');assert.equal(row.pending,false);
});
test('interrupted sending record is reconciled as unknown without resending',async()=>{
  await setup();const row=addLead();let l=JSON.parse(row.data);l.status='sending';l.stage='delivery';row.status='sending';row.stage='delivery';row.data=JSON.stringify(l);
  const r=await run('LSCloudLead00001',{},job(row));assert.equal(row.status,'delivery_unknown');assert.equal(r.counters.slack,0);
});
test('expired or foreign owner cannot process/recover a lead',async()=>{
  await setup();const row=addLead();const j=job(row);j.state.owner='stale';const r=await run('LSCloudLead00001',{},j);assert.equal(r.counters.github,0);assert.equal(row.status,'queued');
});
test('GitHub cooldown persists without consuming failure budget',async()=>{
  await setup();const row=addLead();await run('LSCloudLead00001',{http:()=>({statusCode:429,headers:{'retry-after':'90'}})},job(row));assert.equal(JSON.parse(row.data).attempts.profile,0);assert.equal(row.status,'retry_wait');assert.ok(Date.parse(JSON.parse(control().data).github_blocked_until)>Date.now());
});
test('main does not process delivered/rejected users again on later cycles',async()=>{
  await setup();const a=addLead(1),b=addLead(2);const r=await run('LSCloudMain00001',{http:url=>url.includes('/users/user-1')?{statusCode:200,body:profile(1,100,50)}:url.includes('/users/user-2')?{statusCode:200,body:profile(2)}:url.includes('hooks.slack.com')?{statusCode:200,body:'ok'}:{statusCode:200,body:[],headers:{}}});
  assert.equal(a.status,'rejected');assert.equal(b.status,'delivered');assert.equal(r.counters.ai,1);assert.equal(control().owner,'');
  const again=await run('LSCloudMain00001');assert.equal(again.counters.ai,0);assert.equal(again.counters.slack,0);
});
test('Cloud artifacts need no PostgreSQL, environment variables, modules or secret values',()=>{
  for(const w of workflows){assert.equal(w.active,false);assert.equal(w.settings.saveDataErrorExecution,'none');const names=new Set(w.nodes.map(n=>n.name));
    for(const n of w.nodes){assert.notEqual(n.type,'n8n-nodes-base.postgres');if(n.type.endsWith('.code')){assert.doesNotThrow(()=>new AsyncFunction(n.parameters.jsCode));assert.doesNotMatch(n.parameters.jsCode,/require\(|\$env|process\.env/);}if(n.type.endsWith('.httpRequest'))assert.ok(w.connections[n.name]?.main?.[1]?.length);if(n.type.endsWith('.executeWorkflow'))assert.ok(byId[n.parameters.workflowId.value]);}
    for(const outputs of Object.values(w.connections))for(const branches of Object.values(outputs))for(const edges of branches)for(const e of edges)assert.ok(names.has(e.node));
  }
});
