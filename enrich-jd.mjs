// Full-JD enrichment, separate from discovery. No fit scores are assigned here.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
const batchInput='data/latest-jd-candidates.jsonl', historyInput='data/scan-history.tsv', pipelineInput='data/pipeline.md', output='data/jd-enrichment.jsonl';
const limit=Math.max(1,Math.min(500,Number(process.argv.find(x=>x.startsWith('--limit='))?.split('=')[1]||150)));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function clean(s){return String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/\s+/g,' ').trim();}
async function get(url,options={}){const c=new AbortController();const t=setTimeout(()=>c.abort(),12000);try{const r=await fetch(url,{...options,signal:c.signal});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}finally{clearTimeout(t);}}
function endpoint(row){
 const u=new URL(row.url),p=u.pathname, portal=row.source || row.portal || '';
 if(portal==='workday-api'){
   const m=u.hostname.match(/^([^.]+)\.(wd\d+)\.myworkdayjobs\.com$/i);
   const site=p.split('/').filter(Boolean)[0];if(!m||!site)return null;
   const rest=p.slice(('/'+site).length);
   return {provider:'workday',url:u.origin+'/wday/cxs/'+m[1]+'/'+site+rest};
 }
 if(portal==='greenhouse-api'){
   const m=p.match(/\/(?:jobs\/)?(\d+)(?:\/)?$/);const board=p.match(/\/(?:boards\/)?([^/]+)\/jobs\/\d+/);
   if(!m||!board)return null;
   return {provider:'greenhouse',url:'https://boards-api.greenhouse.io/v1/boards/'+board[1]+'/jobs/'+m[1]};
 }
 if(portal==='ashby-api'){
   const m=p.match(/^\/([^/]+)\/([^/?#]+)/);if(!m)return null;
   return {provider:'ashby',url:'https://api.ashbyhq.com/posting-api/job-board/'+m[1]};
 }
 if(portal==='lever-api'){
   const m=p.match(/^\/([^/]+)\/([^/?#]+)/);if(!m)return null;
   return {provider:'lever',url:'https://api.lever.co/v0/postings/'+m[1]+'/'+m[2]};
 }
 if(portal==='smartrecruiters-api'){
   const m=p.match(/^\/([^/]+)\/([^/?#]+)/);if(!m)return null;
   return {provider:'smartrecruiters',url:'https://api.smartrecruiters.com/v1/companies/'+m[1]+'/postings/'+m[2]};
 }
 return null;
}
async function retrieve(row){
 const e=endpoint(row);if(!e)return {status:'unsupported',reason:'No verified ATS detail endpoint'};
 let j,raw='';
 if(e.provider==='ashby'){
   j=await get(e.url);const match=(j.jobs||[]).find(x=>x.jobUrl===row.url);
   if(!match)return {status:'unavailable',reason:'Posting missing from board'};
   raw=match.descriptionPlain||match.descriptionHtml||'';
 }else{
   j=await get(e.url);
   if(e.provider==='greenhouse')raw=j.content||'';
   if(e.provider==='lever')raw=[j.descriptionPlain||j.description||j.openingPlain||'',...(j.lists||[]).map(x=>x.text+' '+clean(x.content)),j.additionalPlain||''].join('\n');
   if(e.provider==='workday')raw=j.jobPostingInfo?.jobDescription||j.jobPostingInfo?.description||'';
   if(e.provider==='smartrecruiters')raw=[j.jobAd?.sections?.jobDescription?.text||'',j.jobAd?.sections?.qualifications?.text||'',j.jobAd?.sections?.additionalInformation?.text||''].join('\n');
 }
 const description=clean(raw);
 if(description.length<250)return {status:'incomplete',reason:'JD shorter than 250 characters',jd_length:description.length};
 return {status:'full_jd_ready',jd:description,jd_length:description.length,provider:e.provider};
}
function loadCandidates(){
 if(existsSync(batchInput)){
  const rows=[];
  for(const line of readFileSync(batchInput,'utf8').split('\n').filter(Boolean)){
   try{rows.push(JSON.parse(line))}catch(e){console.warn('Skipping malformed candidate JSONL row:',e.message)}
  }
  return rows;
 }
 if(existsSync(historyInput)){
  const lines=readFileSync(historyInput,'utf8').trim().split('\n');const header=lines.shift().split('\t');
  return lines.map(l=>Object.fromEntries(l.split('\t').map((v,i)=>[header[i],v]))).filter(x=>x.url);
 }
 if(!existsSync(pipelineInput))throw Error('Neither scan history nor pipeline exists');
 const text=readFileSync(pipelineInput,'utf8'), rows=[];
 for(const m of text.matchAll(/^- \[ \] (https?:\/\/\S+) \| ([^|]+) \| (.+)$/gm)){
  const url=m[1],company=m[2].trim(),title=m[3].trim();let portal='unknown';
  if(/myworkdayjobs\.com/i.test(url))portal='workday-api';
  else if(/greenhouse\.io/i.test(url))portal='greenhouse-api';
  else if(/ashbyhq\.com/i.test(url))portal='ashby-api';
  else if(/lever\.co/i.test(url))portal='lever-api';
  else if(/smartrecruiters\.com/i.test(url))portal='smartrecruiters-api';
  rows.push({url,first_seen:'',portal,title,company,status:'candidate',location:''});
 }
 return rows;
}
const rows=loadCandidates();
mkdirSync('data',{recursive:true});
const prior=existsSync(output)?readFileSync(output,'utf8').split('\n').filter(Boolean).map(x=>{try{return JSON.parse(x)}catch{return null}}).filter(Boolean):[];
const known=new Map(prior.map(x=>[x.url,x]));
const retryable=new Set(['unsupported','fetch_failed','incomplete','unavailable']);
const pending=rows.filter(x=>!known.has(x.url) || retryable.has(known.get(x.url)?.status)).slice(0,limit);
const results=[];
for(let i=0;i<pending.length;i++){
 const row=pending[i];let result;
 try{result=await retrieve(row)}catch(e){result={status:'fetch_failed',reason:String(e.message).slice(0,180)}}
 results.push({...row,...result,checked_at:new Date().toISOString(),selena_score:null});
 if((i+1)%25===0)console.log('JD enriched '+(i+1)+'/'+pending.length);
 await sleep(75);
}
const refreshed=new Map(prior.map(x=>[x.url,x]));
for(const x of results)refreshed.set(x.url,x);
const all=[...refreshed.values()];
writeFileSync(output,all.map(x=>JSON.stringify(x)).join('\n')+'\n');
const summary={processed:results.length,existing:prior.length,total:all.length,statuses:results.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{})};
console.log('JD enrichment summary:',JSON.stringify(summary));
console.log('No Selena scores assigned; scoring requires complete JD and profile evaluation.');
