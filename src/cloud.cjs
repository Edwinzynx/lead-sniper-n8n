'use strict';

function cloudInitial(repository, now = Date.now()) {
  return {
    repo_id: String(repository.id), repo_owner: repository.owner.login, repo_name: repository.name,
    monitoring_started_at: new Date(now).toISOString(), product_context: '', llm_model: 'gpt-4o-mini',
    next_url: 'https://api.github.com/repos/'+encodeURIComponent(repository.owner.login)+'/'+encodeURIComponent(repository.name)+'/stargazers?per_page=100&page=1',
    scan_pages: 0, scan_failures: 0, last_complete_scan: null,
    github_blocked_until: '1970-01-01T00:00:00.000Z', github_paused: false,
    slack_blocked_until: '1970-01-01T00:00:00.000Z', last_error: null,
  };
}

function cloudNewLead(event, control, now = Date.now()) {
  return {
    key: control.repo_id + ':' + event.user_id, lead_id: control.repo_id + ':' + event.user_id,
    user_id: event.user_id, login: event.login, starred_at: event.starred_at,
    repo_owner: control.repo_owner, repo_name: control.repo_name,
    status: 'queued', stage: 'profile', pending: true, due_at: new Date(now).toISOString(),
    attempts: {profile:0,ai:0,delivery:0}, profile:null, pitch:null, payload:null, last_error:null,
  };
}

function cloudLeadOutcome(lead, result, now = Date.now()) {
  const l = {...lead, attempts:{...lead.attempts}};
  if(result.outcome==='sent') {l.status='delivered';l.pending=false;l.last_error=null;l.sent_at=new Date(now).toISOString();}
  else if(result.outcome==='unknown') {l.status='delivery_unknown';l.pending=false;l.last_error=result.reason;}
  else {
    if(result.count_attempt!==false) l.attempts[l.stage]++;
    l.status=result.outcome==='failed'||l.attempts[l.stage]>=5?'failed':'retry_wait';
    l.pending=l.status==='retry_wait';l.last_error=result.reason;
    l.due_at=result.retry_at||new Date(now+Math.min(3600,60*2**l.attempts[l.stage])*1000).toISOString();
  }
  return l;
}

function cloudCanWork(state, seconds = 0, now = Date.now()) {
  return state.control.owner===state.owner && Date.parse(state.control.lease_until)>now+(seconds+5)*1000 && state.deadline>now+seconds*1000;
}

module.exports={cloudInitial,cloudNewLead,cloudLeadOutcome,cloudCanWork};
