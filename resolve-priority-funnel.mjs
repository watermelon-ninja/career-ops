#!/usr/bin/env node
// Layer 2: bulk network-aware ATS autodetection.
// For every Layer-1 unresolved company with a curated careers seed, follow redirects and
// inspect the returned HTML/links/scripts for reusable ATS fingerprints.
// Identification is NOT full-JD verification; candidates remain explicitly unverified.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import yaml from 'js-yaml';

const follow=JSON.parse(readFileSync('data/priority-manual-followup.json','utf8'));
const portals=yaml.load(readFileSync('portals.yml','utf8')).tracked_companies||[];
const seedRegistry=existsSync('data/priority-careers-seeds.json')?JSON.parse(readFileSync('data/priority-careers-seeds.json','utf8')).companies||[]:[];
const norm=x=>String(x||'').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]/g,'');
const aliases=new Map([['thehomedepot','homedepot'],['delltechnologies','dell'],['samsungelectronics','samsung'],['gxo','gxologistics']]);
const canon=x=>aliases.get(norm(x))||norm(x);

// Keep every seed for a company; a later websearch entry must not overwrite a useful ATS URL.
const portalByName=new Map();
for(const p of portals){
 const k=canon(p.name);
 if(!portalByName.has(k)) portalByName.set(k,[]);
 portalByName.get(k).push(p);
}

for(const seed of seedRegistry){
 const k=canon(seed.name);
 if(!portalByName.has(k))portalByName.set(k,[]);
 if(seed.careers_url)portalByName.get(k).push({name:seed.name,careers_url:seed.careers_url});
}

const fingerprints=[
 ['workday',new RegExp("https?:\\/\\/[a-z0-9-]+\\.wd\\d+\\.myworkdayjobs\\.com\\/[^\"'<>\\s]+",'ig')],
 ['greenhouse',new RegExp("https?:\\/\\/(?:boards|job-boards)(?:\\.eu)?\\.greenhouse\\.io\\/[^\"'<>\\s]+",'ig')],
 ['ashby',new RegExp("https?:\\/\\/jobs\\.ashbyhq\\.com\\/[^\"'<>\\s]+",'ig')],
 ['lever',new RegExp("https?:\\/\\/jobs\\.lever\\.co\\/[^\"'<>\\s]+",'ig')],
 ['smartrecruiters',new RegExp("https?:\\/\\/(?:careers\\.)?smartrecruiters\\.com\\/[^\"'<>\\s]+",'ig')],
 ['teamtailor',new RegExp("https?:\\/\\/[a-z0-9.-]+\\.teamtailor\\.com\\/?[^\"'<>\\s]*",'ig')]
];
const platformMarkers=[
 ['oracle_recruiting_cloud',new RegExp("(?:oraclecloud\\.com\\/hcmUI\\/CandidateExperience|CandidateExperience|sites\\/jobsearch)",'i')],
 ['phenom',new RegExp("(?:phenompeople\\.com|phenom-page|phn-)",'i')],
 ['eightfold',new RegExp("(?:eightfold\\.ai|eightfold)",'i')],
 ['successfactors',new RegExp("(?:successfactors\\.(?:com|eu)|sfcareer|careerSiteBuilder)",'i')],
 ['icims',new RegExp("(?:icims\\.com\\/jobs|iCIMS)",'i')]
];

function cleanDetectedUrl(raw=''){
 return String(raw).replace(/&amp;/g,'&').replace(/&#34;|&quot;/g,'"').replace(/[}"'<>\\]+$/g,'');
}
function normalizeWorkday(raw=''){
 const cleaned=cleanDetectedUrl(raw);
 try{
  const u=new URL(cleaned);
  const host=u.hostname.toLowerCase();
  const hm=host.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/i);
  if(!hm)return null;
  const [,tenant,shard]=hm;
  const parts=u.pathname.split('/').filter(Boolean);
  // Workday may prefix locale before the actual career site.
  const locale=/^[a-z]{2}-[A-Z]{2}$/.test(parts[0]||'')?parts.shift():null;
  // Reject action pages as site names; the first remaining segment is the site.
  const site=parts[0];
  if(!site||/^(login|introduceYourself|job|jobs)$/i.test(site))return null;
  return {
   provider:'workday',
   endpoint:`https://${tenant}.${shard}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`,
   origin:`https://${tenant}.${shard}.myworkdayjobs.com`,
   site,
   detected_url:cleaned
  };
 }catch{return null;}
}
function supported(text=''){
 for(const [provider,re] of fingerprints){
  re.lastIndex=0; const m=re.exec(text);
  if(!m)continue;
  const cleaned=cleanDetectedUrl(m[0]);
  if(provider==='workday'){
   const normalized=normalizeWorkday(cleaned);
   if(normalized)return normalized;
   continue;
  }
  return {provider,endpoint:cleaned,detected_url:cleaned};
 }
 return null;
}
function sharedPlatform(text=''){
 for(const [provider,re] of platformMarkers) if(re.test(text)) return provider;
 return null;
}
async function probe(url){
 const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),10000);
 try{
  const res=await fetch(url,{redirect:'follow',signal:ctrl.signal,headers:{'user-agent':'Mozilla/5.0 Career-Ops ATS discovery','accept':'text/html,application/xhtml+xml'}});
  const body=(await res.text()).slice(0,1500000);
  const evidence=res.url+'\\n'+body;
  return {ok:res.ok,status:res.status,final_url:res.url,body,evidence};
 }catch(e){return {ok:false,status:null,final_url:url,body:'',evidence:url,error:e?.name==='AbortError'?'timeout':String(e?.message||e)};}
 finally{clearTimeout(timer);}
}
async function mapLimit(items,limit,fn){
 const out=new Array(items.length); let i=0;
 async function worker(){while(true){const n=i++;if(n>=items.length)return;out[n]=await fn(items[n],n);}}
 await Promise.all(Array.from({length:Math.min(limit,items.length)},worker)); return out;
}

const input=follow.companies||[];
const results=await mapLimit(input,8,async c=>{
 const seeds=(portalByName.get(canon(c.name))||[]).map(p=>p.careers_url).filter(Boolean);
 if(!seeds.length) return {kind:'remaining',item:{...c,stage:3,status:'needs_generic_endpoint',failure_reason:'no_curated_careers_url',attempts:[...(c.attempts||[]),{stage:2,result:'no_curated_careers_url'}]}};
 const attempts=[]; let platformCandidate=null;
 for(const seed of [...new Set(seeds)]){
  const direct=supported(seed);
  if(direct) return {kind:'identified',item:{...c,stage:2,status:'ats_identified_unverified',identified_by:'seed_url',provider:direct.provider,endpoint:direct.endpoint,official_careers_url:seed,full_jd_verified:false,attempts:[...(c.attempts||[]),{stage:2,url:seed,result:'supported_ats_in_seed'}]}};
  const p=await probe(seed);
  const d=supported(p.evidence);
  const shared=sharedPlatform(p.evidence);
  attempts.push({stage:2,url:seed,http_status:p.status,final_url:p.final_url,result:d?'supported_ats_detected':shared?'shared_platform_detected':p.error||'no_supported_ats_signature',provider:d?.provider||shared||null});
  if(d) return {kind:'identified',item:{...c,stage:2,status:'ats_identified_unverified',identified_by:'redirect_or_html',provider:d.provider,endpoint:d.endpoint,official_careers_url:seed,final_url:p.final_url,full_jd_verified:false,attempts:[...(c.attempts||[]),...attempts]}};
  if(shared&&!platformCandidate) platformCandidate={provider:shared,seed,final_url:p.final_url};
 }
 if(platformCandidate) return {kind:'platform',item:{...c,stage:3,status:'shared_platform_candidate',provider:platformCandidate.provider,official_careers_url:platformCandidate.seed,final_url:platformCandidate.final_url,full_jd_verified:false,attempts:[...(c.attempts||[]),...attempts]}};
 return {kind:'remaining',item:{...c,stage:3,status:'needs_generic_endpoint',official_careers_urls:[...new Set(seeds)],full_jd_verified:false,failure_reason:'no_supported_ats_detected',attempts:[...(c.attempts||[]),...attempts]}};
});

const identified=results.filter(x=>x.kind==='identified').map(x=>x.item);
const platformCandidates=results.filter(x=>x.kind==='platform').map(x=>x.item);
const remaining=results.filter(x=>x.kind==='remaining').map(x=>x.item);
const next=[...platformCandidates,...remaining];
const providerCounts=identified.reduce((a,x)=>(a[x.provider]=(a[x.provider]||0)+1,a),{});
const platformCounts=platformCandidates.reduce((a,x)=>(a[x.provider]=(a[x.provider]||0)+1,a),{});
const out={generated_at:new Date().toISOString(),layer:2,input_count:input.length,identified_at_layer_2:identified.length,full_jd_verified_at_layer_2:0,shared_platform_candidates:platformCandidates.length,remaining_for_layer_3:next.length,provider_counts:providerCounts,platform_candidate_counts:platformCounts,identified,platform_candidates:platformCandidates,remaining};
writeFileSync('data/priority-resolution-funnel.json',JSON.stringify(out,null,2)+'\n');
writeFileSync('data/priority-manual-followup.json',JSON.stringify({generated_at:out.generated_at,funnel_stage:3,note:'Unresolved after Layer 2 network autodetect. Includes shared-platform candidates for reusable Layer 3 adapters; these are not manual failures.',companies:next},null,2)+'\n');
console.log(JSON.stringify({layer:2,input:out.input_count,identified:identified.length,full_jd_verified:0,shared_platform_candidates:platformCandidates.length,remaining_for_layer_3:next.length,providers:providerCounts,platforms:platformCounts},null,2));
