// Full-JD enrichment, separate from discovery. No fit scores are assigned here.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
const input='data/scan-history.tsv', output='data/jd-enrichment.jsonl';
const limit=Math.max(1,Math.min(500,Number(process.argv.find(x=>x.startsWith('--limit='))?.split('=')[1]||150)));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function clean(s){return String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/\s+/g,' ').trim();}
async function get(url,options={}){const c=new AbortController();const t=setTimeout(()=>c.abort(),12000);try{const r=await fetch(url,{...options,signal:c.signal});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}finally{clearTimeout(t);}}
function endpoint(row){
 const u=new URL(row.url),p=u.pathname;
 if(row.portal==='workday-api'){
   const m=u.hostname.match(/^([^.]+)\.(wd\d+)\.myworkdayjobs\.com$/i);
   const site=p.split('/').filter(Boolean)[0];if(!m||!site)return null;
   const rest=p.slice(('/'+site).length);
   return {provider:'workday',url:u.origin+'/wday/cxs/'+m[1]+'/'+site+rest};
 }
 if(row.portal==='greenhouse-api'){
   const m=p.match(/\/(?:jobs\/)?(\d+)(?:\/)?$/);const board=p.match(/\/(?:boards\/)?([^/]+)\/jobs\/\d+/);
   if(!m||!board)return null;
   return {provider:'greenhouse',url:'https://boards-api.greenhouse.io/v1/boards/'+board[1]+'/jobs/'+m[1]};
 }
 if(row.portal==='ashby-api'){
   const m=p.match(/^\/([^/]+)\/([^/?#]+)/);if(!m)return null;
   return {provider:'ashby',url:'https://api.ashbyhq.com/posting-api/job-board/'+m[1]};
 }
 if(row.portal==='lever-api'){
   const m=p.match(/^\/([^/]+)\/([^/?#]+)/);if(!m)return null;
   return {provider:'lever',url:'https://api.lever.co/v0/postings/'+m[1]+'/'+m[2]};
 }
 if(row.portal==='smartrecruiters-api'){
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
const lines=readFileSync(input,'utf8').trim().split('\n');const header=lines.shift().split('\t');
const rows=lines.map(l=>Object.fromEntries(l.split('\t').map((v,i)=>[header[i],v]))).filter(x=>x.url);
mkdirSync('data',{recursive:true});
const prior=existsSync(output)?readFileSync(output,'utf8').split('\n').filter(Boolean).map(x=>{try{return JSON.parse(x)}catch{return null}}).filter(Boolean):[];
const known=new Map(prior.map(x=>[x.url,x]));
const pending=rows.filter(x=>!known.has(x.url)).slice(-limit);
const results=[];
for(let i=0;i<pending.length;i++){
 const row=pending[i];let result;
 try{result=await retrieve(row)}catch(e){result={status:'fetch_failed',reason:String(e.message).slice(0,180)}}
 results.push({...row,...result,checked_at:new Date().toISOString(),selena_score:null});
 if((i+1)%25===0)console.log('JD enriched '+(i+1)+'/'+pending.length);
 await sleep(75);
}
const all=[...prior,...results];
writeFileSync(output,all.map(x=>JSON.stringify(x)).join('\n')+'\n');
const summary={processed:results.length,existing:prior.length,total:all.length,statuses:results.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{})};
console.log('JD enrichment summary:',JSON.stringify(summary));
console.log('No Selena scores assigned; scoring requires complete JD and profile evaluation.');
