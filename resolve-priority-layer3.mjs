#!/usr/bin/env node
// Layer 3: deep platform + endpoint discovery for companies that have a careers seed.
// Processes both known shared-platform candidates and Layer-2 unknown-platform companies.
import {readFileSync,writeFileSync} from 'node:fs';

const funnel=JSON.parse(readFileSync('data/priority-resolution-funnel.json','utf8'));
const known=funnel.platform_candidates||[];
const unknown=(funnel.remaining||[]).filter(x=>x.failure_reason==='no_supported_ats_detected');
const input=[...known,...unknown];

const markers=[
 ['oracle_recruiting_cloud',/(oraclecloud\.com\/hcmUI\/CandidateExperience|CandidateExperience|sites\/jobsearch|recruitingCE)/ig],
 ['eightfold',/(eightfold\.ai|eightfold|\/careers\/jobs\/?|position-list)/ig],
 ['phenom',/(phenompeople\.com|phenom-page|phn-|\/global\/en\/search-results)/ig],
 ['icims',/(icims\.com\/jobs|iCIMS|careers-[a-z0-9.-]+\.icims\.com)/ig],
 ['successfactors',/(successfactors\.(?:com|eu)|sfcareer|careerSiteBuilder|jobs\.sap\.com)/ig],
 ['workday',/https?:\/\/[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com\/[^"'<>\s]+/ig],
 ['greenhouse',/https?:\/\/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/[^"'<>\s]+/ig],
 ['lever',/https?:\/\/jobs\.lever\.co\/[^"'<>\s]+/ig],
 ['ashby',/https?:\/\/jobs\.ashbyhq\.com\/[^"'<>\s]+/ig],
 ['smartrecruiters',/https?:\/\/(?:careers\.)?smartrecruiters\.com\/[^"'<>\s]+/ig],
 ['teamtailor',/https?:\/\/[a-z0-9.-]+\.teamtailor\.com\/?[^"'<>\s]*/ig]
];
const hrefRe=/href=["']([^"'#]+)["']/ig;
const interesting=u=>/(job|career|position|opening|opportunit|search|recruit|apply)/i.test(u);
function clean(s=''){return String(s).replace(/&amp;/g,'&').replace(/&#34;|&quot;/g,'"').replace(/[}"'<>\\]+$/g,'');}
async function get(url){
 const c=new AbortController(),t=setTimeout(()=>c.abort(),9000);
 try{const r=await fetch(url,{redirect:'follow',signal:c.signal,headers:{'user-agent':'Mozilla/5.0 Career-Ops Layer3','accept':'text/html,*/*'}});const body=(await r.text()).slice(0,1800000);return {ok:r.ok,status:r.status,url:r.url,body};}
 catch(e){return {ok:false,url,error:e?.name==='AbortError'?'timeout':String(e?.message||e),body:''};}finally{clearTimeout(t);}
}
function classify(text){
 const hits=[];
 for(const [provider,re] of markers){re.lastIndex=0;const m=re.exec(text);if(m)hits.push({provider,evidence:clean(m[0])});}
 return hits;
}
function links(base,html){
 const out=[];hrefRe.lastIndex=0;let m;
 while((m=hrefRe.exec(html))&&out.length<80){try{const u=new URL(clean(m[1]),base).href;if(interesting(u)&&!out.includes(u))out.push(u);}catch{}}
 return out;
}
async function resolve(c){
 const seeds=[c.final_url,c.official_careers_url,...(c.official_careers_urls||[])].filter(Boolean);
 const attempts=[];let allHits=[];
 for(const seed of [...new Set(seeds)]){
  const p=await get(seed);attempts.push({url:seed,status:p.status||null,final_url:p.url,error:p.error||null});
  const text=p.url+'\n'+p.body;allHits.push(...classify(text));
  const deep=links(p.url,p.body).slice(0,12);
  // Probe a bounded set of likely job-search links; this catches platform redirects hidden one click below careers landing pages.
  for(const u of deep){
   const q=await get(u);attempts.push({url:u,status:q.status||null,final_url:q.url,error:q.error||null});
   allHits.push(...classify(q.url+'\n'+q.body));
  }
 }
 const counts={};for(const h of allHits)counts[h.provider]=(counts[h.provider]||0)+1;
 const ranked=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
 const provider=ranked[0]?.[0]||c.provider||null;
 const capability=provider?'platform_identified_jd_unverified':'attempted_unresolved';
 return {...c,stage:3,status:provider?'platform_identified_deep':'layer3_unresolved',provider,
   platform_evidence:[...new Set(allHits.filter(h=>h.provider===provider).map(h=>h.evidence))].slice(0,10),
   attempts:[...(c.attempts||[]),...attempts],
   jd_fetch_status:'not_fetched',
   full_jd_verified:false,
   fit_scoring_eligible:false,
   jd_capability:capability,
   next_action:provider?'verify_job_detail_and_full_jd':'continue_source_resolution'};
}
async function mapLimit(xs,n,fn){const o=new Array(xs.length);let i=0;async function w(){while(true){const k=i++;if(k>=xs.length)return;o[k]=await fn(xs[k]);}}await Promise.all(Array.from({length:Math.min(n,xs.length)},w));return o;}
const results=await mapLimit(input,8,resolve);
const identified=results.filter(x=>x.status==='platform_identified_deep');
const unresolved=results.filter(x=>x.status==='layer3_unresolved');
const counts=identified.reduce((a,x)=>(a[x.provider]=(a[x.provider]||0)+1,a),{});
const out={generated_at:new Date().toISOString(),layer:3,input_count:input.length,identified_at_layer_3:identified.length,
full_jd_verified_at_layer_3:0,fit_scoring_eligible_at_layer_3:0,unresolved_after_layer_3:unresolved.length,
jd_read_gate:"Only jd_fetch_status=full with substantive responsibilities and qualifications may set full_jd_verified=true and fit_scoring_eligible=true.",
provider_counts:counts,identified,unresolved};
writeFileSync('data/priority-layer3-resolution.json',JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({layer:3,input:input.length,identified:identified.length,unresolved:unresolved.length,providers:counts},null,2));


// Verify actual job-level JD content for already identified Workday boards.
// A platform match, successful listing, or HTML shell never counts as JD read.
function jdQuality(raw){
 const text=String(raw||'').replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g,' ').replace(/\s+/g,' ').trim();
 const responsibilities=/(responsibilit|what you.ll do|what you will do|duties|your role|key accountabilit|job description)/i.test(text);
 const qualifications=/(qualification|requirement|what you.ll need|what you bring|experience required|minimum qualifications|basic qualifications)/i.test(text);
 return {jd_char_count:text.length,has_responsibilities:responsibilities,has_qualifications:qualifications,
   jd_fetch_status:text.length>=500&&responsibilities&&qualifications?'full':text.length>=150?'partial':'metadata_only'};
}
async function verifyWorkday(c){
 const result={name:c.name,group:c.group,provider:'workday',endpoint:c.endpoint,
  jd_fetch_status:'failed',full_jd_verified:false,fit_scoring_eligible:false,job_url:null,reason:null};
 const m=String(c.endpoint||'').match(/^(https:\/\/[^/]+)\/wday\/cxs\/([^/]+)\/([^/]+)\/jobs$/);
 if(!m){result.reason='invalid_workday_endpoint';return result;}
 const [,origin,tenant,site]=m;
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
 try{
  const r=await fetch(c.endpoint,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},
   body:JSON.stringify({appliedFacets:{},limit:20,offset:0,searchText:''}),signal:ctrl.signal});
  if(!r.ok){result.reason='listing_http_'+r.status;return result;}
  const listing=await r.json();const posts=listing.jobPostings||[];
  if(!posts.length){result.reason='no_job_postings';return result;}
  // Try at most three postings, since some tenants return special/unreadable jobs first.
  for(const post of posts.slice(0,3)){
   if(!post.externalPath)continue;
   const detailUrl=origin+'/wday/cxs/'+tenant+'/'+site+post.externalPath;
   const d=await fetch(detailUrl,{headers:{accept:'application/json'},signal:ctrl.signal});
   if(!d.ok){result.reason='detail_http_'+d.status;continue;}
   const json=await d.json();const info=json.jobPostingInfo||{};
   const q=jdQuality(info.jobDescription||info.description||'');
   Object.assign(result,q,{job_url:detailUrl,job_title:info.title||post.title||null,
     full_jd_verified:q.jd_fetch_status==='full',fit_scoring_eligible:q.jd_fetch_status==='full',
     reason:q.jd_fetch_status==='full'?null:'jd_content_incomplete'});
   if(result.full_jd_verified)break;
  }
 }catch(e){result.reason=e.name==='AbortError'?'timeout':String(e.message||e);}
 finally{clearTimeout(timer);}
 return result;
}
async function verifyStandardAts(c){
 const base={name:c.name,group:c.group,provider:c.provider,endpoint:c.endpoint,jd_fetch_status:'failed',full_jd_verified:false,fit_scoring_eligible:false,job_url:null,reason:null};
 try{
  let jobs=[];
  if(c.provider==='greenhouse'){
   const slug=(String(c.endpoint||c.official_careers_url||'').match(/greenhouse\.io\/(?:v1\/boards\/)?([^/?]+)/i)||[])[1];
   if(!slug){base.reason='missing_greenhouse_slug';return base;}
   const r=await fetch('https://boards-api.greenhouse.io/v1/boards/'+slug+'/jobs?content=true');if(!r.ok){base.reason='listing_http_'+r.status;return base;}
   jobs=(await r.json()).jobs||[];jobs=jobs.map(j=>({title:j.title,url:j.absolute_url,description:j.content||''}));
  }else if(c.provider==='lever'){
   const slug=(String(c.endpoint||c.official_careers_url||'').match(/lever\.co\/(?:v0\/postings\/)?([^/?]+)/i)||[])[1];
   if(!slug){base.reason='missing_lever_slug';return base;}
   const r=await fetch('https://api.lever.co/v0/postings/'+slug+'?mode=json');if(!r.ok){base.reason='listing_http_'+r.status;return base;}
   jobs=(await r.json()).map(j=>({title:j.text,url:j.hostedUrl,description:[j.descriptionPlain,j.additionalPlain,...(j.lists||[]).map(x=>x.text+' '+(x.content||''))].filter(Boolean).join(' ')}));
  }else if(c.provider==='ashby'){
   const slug=(String(c.endpoint||c.official_careers_url||'').match(/ashbyhq\.com\/(?:posting-api\/job-board\/)?([^/?]+)/i)||[])[1];
   if(!slug){base.reason='missing_ashby_slug';return base;}
   const r=await fetch('https://api.ashbyhq.com/posting-api/job-board/'+slug);if(!r.ok){base.reason='listing_http_'+r.status;return base;}
   jobs=((await r.json()).jobs||[]).map(j=>({title:j.title,url:j.jobUrl||j.applyUrl,description:j.descriptionPlain||j.descriptionHtml||j.description||''}));
  }
  if(!jobs.length){base.reason='no_job_postings';return base;}
  let best=base;
  for(const j of jobs.slice(0,5)){const q=jdQuality(j.description);const cur={...base,...q,job_title:j.title||null,job_url:j.url||null,
    full_jd_verified:q.jd_fetch_status==='full',fit_scoring_eligible:q.jd_fetch_status==='full',reason:q.jd_fetch_status==='full'?null:'jd_content_incomplete'};
    if(cur.full_jd_verified)return cur;if((cur.jd_char_count||0)>(best.jd_char_count||0))best=cur;}
  return best;
 }catch(e){base.reason=String(e.message||e);return base;}
}
const layer2Identified=(funnel.identified||[]).filter(x=>['workday','greenhouse','ashby','lever'].includes(x.provider));
const jdProbes=await mapLimit(layer2Identified,4,c=>c.provider==='workday'?verifyWorkday(c):verifyStandardAts(c));
const jdVerified=jdProbes.filter(x=>x.full_jd_verified);
const layer3=JSON.parse(readFileSync('data/priority-layer3-resolution.json','utf8'));
const jdAudit={generated_at:new Date().toISOString(),method:'standard_ats_listing_then_job_detail',
 tested:jdProbes.length,full_jd_verified:jdVerified.length,
 rule:'Only substantive job description content with responsibility and qualification signals passes. ATS detection is not JD verification.',
 results:jdProbes};
writeFileSync('data/priority-jd-capability.json',JSON.stringify(jdAudit,null,2)+'\n');
console.log('Workday JD verification:',JSON.stringify({tested:jdProbes.length,full_jd_verified:jdVerified.length,failures:jdProbes.length-jdVerified.length}));


// Shared-platform fallback: verify publicly accessible job-detail pages via
// schema.org JobPosting JSON-LD. No private/vendor API credentials assumed.
function jsonLdJobPostings(html){
 const out=[];
 const openNeedle='<script', closeNeedle='</script>';
 let pos=0;
 while(true){
  const open=html.toLowerCase().indexOf(openNeedle,pos); if(open<0)break;
  const tagEnd=html.indexOf('>',open); if(tagEnd<0)break;
  const tag=html.slice(open,tagEnd+1);
  const close=html.toLowerCase().indexOf(closeNeedle,tagEnd+1); if(close<0)break;
  pos=close+closeNeedle.length;
  const compactTag=tag.toLowerCase().split(/\s+/).join('');
  if(!compactTag.includes('type="application/ld+json"')&&!compactTag.includes("type='application/ld+json'"))continue;
  const payload=html.slice(tagEnd+1,close).trim();
  try{
   const root=JSON.parse(payload);const nodes=Array.isArray(root)?root:[root];
   for(const node of nodes){const list=node?.['@graph']||[node];for(const j of list){
    const types=Array.isArray(j?.['@type'])?j['@type']:[j?.['@type']];
    if(types.includes('JobPosting'))out.push(j);
   }}
  }catch{}
 }
 return out;
}
async function verifyPublicJobPage(c){
 const seeds=[c.final_url,c.official_careers_url,...(c.official_careers_urls||[])].filter(Boolean);
 const result={name:c.name,group:c.group,provider:c.provider||null,method:'public_jobposting_jsonld',
  jd_fetch_status:'failed',full_jd_verified:false,fit_scoring_eligible:false,
  jd_char_count:0,job_url:null,reason:'no_public_job_detail'};
 const visited=new Set();
 for(const seed of [...new Set(seeds)].slice(0,2)){
  const root=await get(seed);if(!root.ok)continue;
  const candidates=[root.url,...links(root.url,root.body).filter(u=>{
   const x=String(u).toLowerCase();
   return x.includes('/job/')||x.includes('/jobs/')||x.includes('jobid')||x.includes('job_id')||x.includes('requisition')||x.includes('/position/');
  }).slice(0,10)];
  for(const url of candidates){
   if(visited.has(url))continue;visited.add(url);
   const page=url===root.url?root:await get(url);if(!page.ok)continue;
   for(const j of jsonLdJobPostings(page.body)){
    const q=jdQuality(j.description||'');
    if(q.jd_char_count>result.jd_char_count)Object.assign(result,q,{
     job_url:page.url,job_title:j.title||null,
     full_jd_verified:q.jd_fetch_status==='full',fit_scoring_eligible:q.jd_fetch_status==='full',
     reason:q.jd_fetch_status==='full'?null:'incomplete_jobposting_description'});
    if(result.full_jd_verified)return result;
   }
  }
 }
 return result;
}
const sharedCandidates=[...(layer3.identified||[])].filter(c=>
 ['eightfold','oracle_recruiting_cloud','phenom','icims','successfactors'].includes(c.provider));
const sharedJdProbes=await mapLimit(sharedCandidates,4,verifyPublicJobPage);
const sharedVerified=sharedJdProbes.filter(x=>x.full_jd_verified);
writeFileSync('data/priority-shared-jd-capability.json',JSON.stringify({
 generated_at:new Date().toISOString(),method:'public_jobposting_jsonld',
 tested:sharedJdProbes.length,full_jd_verified:sharedVerified.length,
 note:'A public JSON-LD JobPosting with substantive description is required; vendor API identification alone does not pass.',
 results:sharedJdProbes
},null,2)+'\n');
console.log('Shared platform public JD verification:',JSON.stringify({
 tested:sharedJdProbes.length,full_jd_verified:sharedVerified.length,
 failures:sharedJdProbes.length-sharedVerified.length}));
