'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {payloadFor,importCloud}=require('../scripts/import-cloud.cjs');
const fs=require('node:fs');const path=require('node:path');
const source=JSON.parse(fs.readFileSync(path.join(__dirname,'../cloud/30-process-lead.json'),'utf8'));
test('importer removes fake credential IDs and maps error dependencies',()=>{
  const p=payloadFor(source,{LSCloudErrors001:'remote-errors'},null,'project');assert.equal(p.settings.errorWorkflow,'remote-errors');assert.equal(p.projectId,'project');
  assert.ok(p.nodes.every(n=>!JSON.stringify(n.credentials||{}).includes('SELECT_')));
});
test('reimport preserves credentials and the private Slack URL already entered',()=>{
  const existing=structuredClone(source);existing.nodes.find(n=>n.name==='OpenAI Model').credentials={openAiApi:{id:'real',name:'Existing'}};
  existing.nodes.find(n=>n.name==='Send Slack').parameters.url='https://hooks.slack.com/services/TEST/TEST/EXISTING';
  const p=payloadFor(source,{LSCloudErrors001:'remote-errors'},existing,'project');assert.equal(p.nodes.find(n=>n.name==='OpenAI Model').credentials.openAiApi.id,'real');assert.ok(p.nodes.find(n=>n.name==='Send Slack').parameters.url.endsWith('EXISTING'));
});
test('importer preflight is read-only and rejects an active target',async()=>{
  const store={load:()=>({})};let calls=[];
  const r=await importCloud({api:async(method,route)=>{calls.push(method);return {id:'cihlgiO4ZiWvgPlB',active:false,projectId:'p'};},store});assert.equal(r.ready,true);assert.deepEqual(calls,['GET']);
  await assert.rejects(()=>importCloud({api:async()=>({active:true}),store}),/active/);
});
test('importer creates dependencies, updates the supplied target, and verifies links',async()=>{
  const target={id:'cihlgiO4ZiWvgPlB',active:false,projectId:'p',nodes:[],settings:{}};const remote={[target.id]:target};let seq=0,saved={};
  const api=async(method,route,body)=>{
    const id=route.split('/')[2];if(method==='GET')return structuredClone(remote[id]);
    const assigned=method==='PUT'?id:'new-'+ ++seq;remote[assigned]={...structuredClone(body),id:assigned,active:false};return remote[assigned];
  };
  const r=await importCloud({api,store:{load:()=>({}),save:ids=>{saved={...ids};},backup:async()=>'/encrypted/backup'},apply:true});
  assert.equal(r.imported,true);assert.equal(r.workflows.length,5);assert.equal(seq,4);assert.equal(saved.LSCloudMain00001,target.id);
  const main=remote[target.id];assert.ok(main.nodes.filter(n=>n.type.endsWith('.executeWorkflow')).every(n=>remote[n.parameters.workflowId.value]));assert.ok(Object.values(remote).every(w=>!w.active));
});
