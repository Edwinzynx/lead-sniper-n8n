'use strict';
// Read-only public API check. No profile contents or credentials are printed.
(async()=>{
  const headers={'User-Agent':'LeadSniper-Preflight','Accept':'application/vnd.github.star+json'};
  if(process.env.GITHUB_TOKEN)headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;
  const response=await fetch('https://api.github.com/repos/openai/openai-python/stargazers?per_page=1',{headers,signal:AbortSignal.timeout(20000)});
  const body=await response.json();
  console.log(JSON.stringify({repository:'openai/openai-python',status:response.status,authenticated:!!process.env.GITHUB_TOKEN,items:Array.isArray(body)?body.length:null,message:Array.isArray(body)?undefined:body.message,hasPagination:!!response.headers.get('link')},null,2));
  if(!response.ok)process.exitCode=1;
})().catch(e=>{console.error('Preflight failed: '+e.name);process.exitCode=1;});
