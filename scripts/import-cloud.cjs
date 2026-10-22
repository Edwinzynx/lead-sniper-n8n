'use strict';
const fs = require('node:fs');
const path = require('node:path');
const BASE = 'https://tryedwin.app.n8n.cloud';
const TARGET = 'cihlgiO4ZiWvgPlB';
const ROOT = path.resolve(__dirname, '..');
const ORDER = ['40-record-errors.json','20-discover-page.json','30-process-lead.json','00-setup-and-preflight.json','10-main-openai-python.json'];

function payloadFor(source, ids, existing, projectId) {
  const body = {name:source.name,nodes:structuredClone(source.nodes),connections:structuredClone(source.connections),settings:structuredClone(source.settings)};
  if(body.settings.errorWorkflow) {
    const id=ids[body.settings.errorWorkflow];if(!id)throw Error('Missing error workflow dependency');body.settings.errorWorkflow=id;
  }
  for(const n of body.nodes) {
    if(n.type==='n8n-nodes-base.executeWorkflow') {
      const id=ids[n.parameters.workflowId.value];if(!id)throw Error('Missing sub-workflow dependency');n.parameters.workflowId.value=id;
    }
    // A second import must not erase credentials the user entered in n8n.
    const current=existing?.nodes?.find(old=>old.id===n.id&&old.type===n.type);
    if(current?.credentials)n.credentials=structuredClone(current.credentials);
    else if(n.credentials) {
      for(const [type,c] of Object.entries(n.credentials))if(c.id?.startsWith('SELECT_'))delete n.credentials[type];
      if(!Object.keys(n.credentials).length)delete n.credentials;
    }
    if(n.name==='Send Slack'&&current?.parameters?.url?.startsWith('https://hooks.slack.com/services/')&&!current.parameters.url.includes('REPLACE'))n.parameters.url=current.parameters.url;
  }
  if(!existing&&projectId)body.projectId=projectId;
  return body;
}

async function importCloud({api,store,apply=false}) {
  // Read and back up the user's target before making any changes.
  const target=await api('GET','/workflows/'+TARGET);
  if(target.active||target.activeVersionId)throw Error('The target is active. Stop here so its running automation is not changed.');
  const projectId=target.homeProject?.id||target.projectId||target.shared?.find(s=>s.role==='workflow:owner')?.projectId;
  if(!projectId)throw Error('Cannot verify the target project from the API. No workflows were changed.');
  const sources=ORDER.map(file=>JSON.parse(fs.readFileSync(path.join(ROOT,'cloud',file),'utf8')));
  const previous=store.load()||{};
  const ids={...previous,LSCloudMain00001:TARGET};
  if(!apply)return {ready:true,target:BASE+'/workflow/'+TARGET,projectId,workflows:sources.map(w=>w.name)};
  const original=await store.backup(target);
  const verified=[];
  for(const source of sources) {
    const remoteId=ids[source.id];
    const current=source.id==='LSCloudMain00001'?target:remoteId?await api('GET','/workflows/'+encodeURIComponent(remoteId)):null;
    if(current?.active||current?.activeVersionId)throw Error('An imported companion is active; it was not modified.');
    if(current&&source.id!=='LSCloudMain00001')await store.backup(current);
    const body=payloadFor(source,ids,current,projectId);
    const saved=await api(current?'PUT':'POST',current?'/workflows/'+encodeURIComponent(current.id):'/workflows',body);
    if(!saved?.id)throw Error('API response did not confirm a workflow ID; inspect before retrying creation.');
    ids[source.id]=saved.id;await store.save(ids);
    const check=await api('GET','/workflows/'+encodeURIComponent(saved.id));
    if(check.active||check.activeVersionId||check.name!==body.name||check.nodes?.length!==body.nodes.length)throw Error('Remote verification failed for '+source.name);
    const remoteCalls=(check.nodes||[]).filter(n=>n.type==='n8n-nodes-base.executeWorkflow').map(n=>n.parameters.workflowId.value);
    const expectedCalls=body.nodes.filter(n=>n.type==='n8n-nodes-base.executeWorkflow').map(n=>n.parameters.workflowId.value);
    if(JSON.stringify(remoteCalls)!==JSON.stringify(expectedCalls)||check.settings?.errorWorkflow!==body.settings.errorWorkflow)throw Error('Remote workflow links did not match the imported design.');
    verified.push({name:source.name,url:BASE+'/workflow/'+saved.id});
  }
  return {imported:true,active:false,originalBackup:original,workflows:verified};
}

async function main() {
  const key=process.env.LEAD_SNIPER_N8N_API_KEY;
  if(!key)throw Error('No connection key is loaded. Run the Connect n8n helper first.');
  const directory=path.join(process.env.LOCALAPPDATA||path.join(process.env.USERPROFILE,'AppData','Local'),'LeadSniper');fs.mkdirSync(directory,{recursive:true});
  const mapFile=path.join(directory,'import-map.json');
  const api=async(method,route,body)=>{
    if(!route.startsWith('/workflows'))throw Error('Unexpected API route');
    const response=await fetch(BASE+'/api/v1'+route,{method,redirect:'error',headers:{'X-N8N-API-KEY':key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error('n8n API returned HTTP '+response.status+' for '+method+' '+route+'. No response body was logged.');
    return response.json();
  };
  const store={
    load:()=>fs.existsSync(mapFile)?JSON.parse(fs.readFileSync(mapFile,'utf8')):{},
    save:ids=>fs.writeFileSync(mapFile,JSON.stringify(ids,null,2)),
    // The original workflow may contain user secrets: encrypt it using Windows DPAPI.
    backup:async workflow=>{
      const {spawnSync}=require('node:child_process');
      const file=path.join(directory,'backup-'+workflow.id.replace(/[^A-Za-z0-9_-]/g,'')+'-'+Date.now()+'.dpapi');
      const command="$text=[Console]::In.ReadToEnd(); $value=ConvertTo-SecureString -String $text -AsPlainText -Force; $cipher=ConvertFrom-SecureString -SecureString $value; [IO.File]::WriteAllText($env:LEAD_SNIPER_BACKUP_PATH,$cipher)";
      const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{input:JSON.stringify(workflow),encoding:'utf8',windowsHide:true,env:{...process.env,LEAD_SNIPER_N8N_API_KEY:'',LEAD_SNIPER_BACKUP_PATH:file}});
      if(result.status!==0)throw Error('Could not encrypt the original workflow backup; import stopped.');return file;
    },
  };
  console.log(JSON.stringify(await importCloud({api,store,apply:process.argv.includes('--apply')}),null,2));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={payloadFor,importCloud};
