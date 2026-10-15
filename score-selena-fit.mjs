#!/usr/bin/env node
import {readFileSync,writeFileSync,existsSync,appendFileSync} from 'node:fs';
const rows=readFileSync('data/latest-jd-read-results.jsonl','utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const profile=JSON.parse(readFileSync('data/selena-fit-profile.json','utf8'));
const n=s=>String(s||'').toLowerCase();
const has=(text,re)=>re.test(text);
const cap=(x,max)=>Math.max(0,Math.min(max,x));
function fit(j){
  const title=n(j.title), jd=n(j.jd_text), text=title+' '+jd;
  const dims={}, evidence=[], gaps=[];
  const targetRole=/business systems|systems analyst|business analyst|product owner|technical product|program manager|implementation consultant|product operations|business intelligence/;
  const adjacentRole=/product manager|project manager|operations manager|logistics specialist|inventory consultant/;
  dims.role_function=has(title,targetRole)?2:has(title,adjacentRole)?1.4:0.6;

  const sc=/supply chain|warehouse management|\bwms\b|inventory control|inventory management|logistics|fulfillment|distribution center|s&op/;
  const enterprise=/enterprise system|business system|erp|system implementation|systems integration|operations technology/;
  dims.domain=has(text,sc)?2:has(text,enterprise)?1.4:has(text,/operations|business process/)?0.8:0.3;

  let resp=0;
  if(has(jd,/requirements|functional requirement|business requirement|process flow|process improvement/))resp+=0.7;
  if(has(jd,/stakeholder|cross.functional|partner|vendor/))resp+=0.5;
  if(has(jd,/uat|user acceptance|testing|deployment|release|defect|backlog|agile|scrum/))resp+=0.5;
  if(has(jd,/implementation|integration|transformation/))resp+=0.3;
  dims.responsibilities=cap(resp,2);

  let tech=0;
  if(has(jd,/\binfor\b|kinaxis|\bsap\b|\bwms\b|\berp\b/))tech+=0.7;
  if(has(jd,/databricks|\bsql\b|power bi|analytics|business intelligence/))tech+=0.4;
  if(has(jd,/integration|api|enterprise application|saas/))tech+=0.4;
  if(has(text,/business systems|enterprise systems|systems integration|system implementation/) && tech<0.8)tech+=0.4;
  dims.skills_technology=cap(tech,1.5);

  let senior=1.3;
  if(has(jd,/10\+ years|11\+ years|12\+ years|15\+ years|ten years|twelve years|fifteen years/)){senior=0.4;gaps.push('major_experience_gap');}
  else if(has(jd,/8\+ years|9\+ years|eight years|nine years/)){senior=0.9;gaps.push('seniority_stretch');}
  if(has(title,/director|vice president|\bvp\b/)){senior=0.2;gaps.push('executive_scope');}
  dims.seniority_scope=senior;

  let transfer=0.8;
  if(has(text,/supply chain|enterprise system|business system|implementation|integration/))transfer=1;
  dims.transferability=transfer;

  const occupationMismatch =
    (has(title,/construction/)&&has(title,/project manager/)) ||
    (has(title,/clinical/)&&has(title,/project manager/)) ||
    (has(title,/hardware engineering|power engineer/)) ||
    has(title,/software engineer|sales executive|account executive/) ||
    (has(title,/land development|tenant improvement|mechanical|treatment plant|mission critical/) && has(title,/project manager/)) ||
    (has(title,/hardware|test engineering/) && has(title,/program manager|project manager/)) ||
    (has(title,/manufacturing operations/) && has(title,/project manager/));
  if(occupationMismatch)gaps.push('occupation_mismatch');

  if(has(jd,/registered nurse|medical license|clinical licensure|professional engineer license|licensed architect/))gaps.push('specialized_credential_gap');
  if(has(jd,/people manager|manage a team of|direct reports/) && !has(title,/product owner|analyst/))gaps.push('people_management_requirement');

  let score=Object.values(dims).reduce((a,b)=>a+b,0);
  let gap='none';
  if(gaps.includes('specialized_credential_gap')){gap='disqualifying';score=Math.min(score,5.9);}
  else if(gaps.includes('occupation_mismatch')){gap='major';score=Math.min(score,6.9);}
  else if(gaps.includes('major_experience_gap')){gap='major';score=Math.min(score,7.4);}
  else if(gaps.length){gap='manageable';}
  score=Math.round(score*10)/10;
  if(dims.domain>=1.4)evidence.push('domain_transfer');
  if(dims.responsibilities>=1.5)evidence.push('delivery_ownership');
  if(dims.skills_technology>=1)evidence.push('systems_tools');
  return {...j,fit_dimensions:dims,requirement_gap:gap,requirement_gaps:gaps,selena_fit_score:score,selena_fit_band:score>=9?'strong_apply':score>=8?'high_review':score>=7?'possible':'low',selena_fit_evidence:evidence};
}
const eligible=rows.filter(x=>x.fit_scoring_eligible&&x.full_jd_verified&&x.jd_text);
const out=eligible.map(fit).sort((a,b)=>b.selena_fit_score-a.selena_fit_score);
writeFileSync('data/latest-selena-fit-results.jsonl',out.map(JSON.stringify).join('\n')+(out.length?'\n':''));
const processedPath='data/processed-jobs.jsonl';
const runSessionPath='data/current-run-jobs.jsonl';
const existing=new Set();
if(existsSync(processedPath)){for(const line of readFileSync(processedPath,'utf8').split('\n').filter(Boolean)){try{const x=JSON.parse(line);if(x.job_key)existing.add(x.job_key);}catch{}}}
const key=j=>{const company=String(j.company||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'');const id=String(j.job_id||j.requisition_id||j.id||'').trim().toLowerCase();return id?company+'::id::'+id:company+'::role::'+String(j.title||'').trim().toLowerCase().replace(/\s+/g,' ')+'::'+String(j.location||'').trim().toLowerCase().replace(/\s+/g,' ');};
const stamp=new Date().toISOString();
const fresh=out.map(j=>({job_key:key(j),company:j.company,title:j.title,location:j.location,url:j.url,processed_at:stamp,outcome:'fit_scored',selena_fit_score:j.selena_fit_score,selena_fit_band:j.selena_fit_band,requirement_gap:j.requirement_gap})).filter(x=>!existing.has(x.job_key));
if(fresh.length){
  appendFileSync(processedPath,fresh.map(JSON.stringify).join('\n')+'\n');
  appendFileSync(runSessionPath,fresh.map(JSON.stringify).join('\n')+'\n');
}
const runKeys=new Set();
if(existsSync(runSessionPath)){for(const line of readFileSync(runSessionPath,'utf8').split('\n').filter(Boolean)){try{const x=JSON.parse(line);if(x.job_key)runKeys.add(x.job_key);}catch{}}}
const freshOut=out.filter(j=>runKeys.has(key(j)));
const summary={generated_at:new Date().toISOString(),profile_version:profile.profile_version,eligible:eligible.length,scored:out.length,new_this_run:freshOut.length,new_strong_apply:freshOut.filter(x=>x.selena_fit_score>=9).length,new_high_review:freshOut.filter(x=>x.selena_fit_score>=8&&x.selena_fit_score<9).length,strong_apply:out.filter(x=>x.selena_fit_score>=9).length,high_review:out.filter(x=>x.selena_fit_score>=8&&x.selena_fit_score<9).length,possible:out.filter(x=>x.selena_fit_score>=7&&x.selena_fit_score<8).length,low:out.filter(x=>x.selena_fit_score<7).length,major_or_disqualifying_gap:out.filter(x=>['major','disqualifying'].includes(x.requirement_gap)).length};
writeFileSync('data/latest-selena-fit-summary.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));
