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
