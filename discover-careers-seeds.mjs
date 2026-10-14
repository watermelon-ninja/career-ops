#!/usr/bin/env node
// Layer 2B: conservative careers seed discovery without a search-engine dependency.
// It probes likely official company domains derived from the company name, follows redirects,
// and accepts a seed only when the page itself looks like a careers/jobs destination.
// Uncertain candidates remain unresolved; no guessed URL is promoted to the seed registry.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import yaml from 'js-yaml';

const follow=JSON.parse(readFileSync('data/priority-manual-followup.json','utf8'));
const seedPath='data/priority-careers-seeds.json';
const seedDoc=existsSync(seedPath)?JSON.parse(readFileSync(seedPath,'utf8')):{schema_version:1,companies:[]};
const existing=new Map((seedDoc.companies||[]).map(x=>[x.name.toLowerCase(),x]));
const portals=yaml.load(readFileSync('portals.yml','utf8')).tracked_companies||[];
const norm=x=>String(x||'').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]/g,'');
const aliases=new Map([['thehomedepot','homedepot'],['delltechnologies','dell'],['samsungelectronics','samsung'],['gxo','gxologistics']]);
const canon=x=>aliases.get(norm(x))||norm(x);
const portalNames=new Set(portals.filter(p=>p.careers_url).map(p=>canon(p.name)));
const seedNames=new Set((seedDoc.companies||[]).map(p=>canon(p.name)));

const stripName=n=>String(n).toLowerCase()
 .replace(/&/g,'and').replace(/\b(the|inc|incorporated|corp|corporation|company|companies|group|holdings|holding|technologies|technology|systems|solutions|international|global|usa|us)\b/g,' ')
 .replace(/[^a-z0-9]/g,'');
const special=new Map([
 ['deerecompany','deere.com'],['fordmotor','ford.com'],['texasinstruments','ti.com'],
 ['proctergamble','pg.com'],['jpmorganchase','jpmorganchase.com'],['bankofamerica','bankofamerica.com'],
 ['berkshirehathaway','berkshirehathaway.com'],['unitedhealth','unitedhealthgroup.com'],
 ['bostonscientific','bostonscientific.com'],['johnsonjohnson','jnj.com'],
 ['eli lilly','lilly.com'],['merckco','merck.com'],['baylor scottwhite health','bswhealth.com']
]);
function domainCandidates(name){
 const raw=String(name).toLowerCase().replace(/[^a-z0-9]/g,'');
 const base=stripName(name);
 const vals=[special.get(String(name).toLowerCase()),special.get(raw),special.get(base),base&&base+'.com',raw&&raw+'.com'].filter(Boolean);
 return [...new Set(vals)];
}
const paths=['/careers','/careers/','/jobs','/jobs/','/en/careers','/us/en/careers'];
async function fetchPage(url){
 const c=new AbortController(),t=setTimeout(()=>c.abort(),6500);
 try{
  const r=await fetch(url,{redirect:'follow',signal:c.signal,headers:{'user-agent':'Mozilla/5.0 Career-Ops seed discovery','accept':'text/html'}});
  const body=(await r.text()).slice(0,350000);
  return {ok:r.ok,status:r.status,url:r.url,body};
 }catch(e){return {ok:false,error:e?.name==='AbortError'?'timeout':String(e?.message||e),url};}
 finally{clearTimeout(t);}
}
function isCareerPage(p){
 if(!p.ok)return false;
 const u=p.url.toLowerCase(),b=p.body.toLowerCase();
 const urlSignal=/(career|jobs|job-search|opportunities|join-us|work-with-us)/.test(u);
 const titleSignal=/<title[^>]*>[^<]*(career|jobs|opportunities|join us|work with us)/i.test(p.body);
 const contentSignals=['search jobs','search careers','view jobs','explore careers','job opportunities','open positions','career opportunities'].filter(x=>b.includes(x)).length;
 return urlSignal&&(titleSignal||contentSignals>=1);
}
async function discover(company){
 if(existing.has(company.name.toLowerCase()))return {company:company.name,status:'already_seeded'};
 const attempts=[];
 for(const domain of domainCandidates(company.name)){
  for(const path of paths){
   const p=await fetchPage('https://www.'+domain+path);
   attempts.push({url:'https://www.'+domain+path,status:p.status||null,final_url:p.url,error:p.error||null});
   if(isCareerPage(p))return {company:company.name,status:'discovered',seed:{name:company.name,careers_url:p.url,source:'layer2b_official_domain_probe',status:'official_careers_page_autodiscovered'},attempts};
  }
 }
 return {company:company.name,status:'unresolved',attempts};
}
async function mapLimit(items,limit,fn){const out=new Array(items.length);let i=0;async function w(){while(true){const n=i++;if(n>=items.length)return;out[n]=await fn(items[n]);}}await Promise.all(Array.from({length:Math.min(limit,items.length)},w));return out;}

// Layer 1 handoff has not run ATS autodetect yet, so it has no failure_reason.
const targets=(follow.companies||[]).filter(x=>!portalNames.has(canon(x.name))&&!seedNames.has(canon(x.name)));
const results=await mapLimit(targets,12,discover);
const found=results.filter(x=>x.status==='discovered').map(x=>x.seed);
for(const x of found)existing.set(x.name.toLowerCase(),x);
const companies=[...existing.values()].sort((a,b)=>a.name.localeCompare(b.name));
writeFileSync(seedPath,JSON.stringify({...seedDoc,generated_at:new Date().toISOString(),companies},null,2)+'\n');
writeFileSync('data/priority-careers-discovery.json',JSON.stringify({generated_at:new Date().toISOString(),input_count:targets.length,discovered:found.length,unresolved:results.filter(x=>x.status==='unresolved').length,results},null,2)+'\n');
console.log(JSON.stringify({layer:'2B',input:targets.length,discovered:found.length,unresolved:results.filter(x=>x.status==='unresolved').length,total_seed_registry:companies.length},null,2));
