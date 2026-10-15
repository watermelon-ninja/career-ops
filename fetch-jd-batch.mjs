#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
const rows=readFileSync('data/latest-jd-candidates.jsonl','utf8').trim().split('\n').map(JSON.parse).filter(x=>x.fetch_batch===1).slice(0,50);
const clean=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
function gate(s){const t=clean(s);const a=/(responsibilit|duties|what you.ll do|your role)/i.test(t);const b=/(qualification|requirement|what you bring|minimum qualifications|basic qualifications)/i.test(t);return {jd_char_count:t.length,jd_fetch_status:t.length>=500&&a&&b?'full':t.length>=150?'partial':'metadata_only'};}
async function json(url){const r=await fetch(url,{headers:{accept:'application/json'}});if(!r.ok)throw Error('HTTP '+r.status);return r.json();}
async function one(j){try{const u=new URL(j.url);let body='';
if(j.source==='workday-api'){const p=u.pathname.split('/').filter(Boolean),k=p.indexOf('job'),tenant=u.hostname.split('.')[0];const x=await json(u.origin+'/wday/cxs/'+tenant+'/'+p[0]+'/'+p.slice(k).join('/'));body=x.jobPostingInfo?.jobDescription||'';}
else if(j.source==='greenhouse-api'){const p=u.pathname.split('/').filter(Boolean),id=u.searchParams.get('gh_jid');const x=await json('https://boards-api.greenhouse.io/v1/boards/'+p[0]+'/jobs/'+id);body=x.content||'';}
else if(j.source==='ashby-api'){const p=u.pathname.split('/').filter(Boolean),x=await json('https://api.ashbyhq.com/posting-api/job-board/'+p[0]);const h=(x.jobs||[]).find(v=>String(v.jobUrl||'').includes(p[1]));body=h?.descriptionPlain||h?.descriptionHtml||h?.description||'';}
else throw Error('unsupported_source');const g=gate(body);return {...j,...g,full_jd_verified:g.jd_fetch_status==='full'};}catch(e){return {...j,jd_fetch_status:'failed',full_jd_verified:false,jd_error:String(e.message||e)};}}
const out=[];for(let i=0;i<rows.length;i+=5)out.push(...await Promise.all(rows.slice(i,i+5).map(one)));
writeFileSync('data/latest-jd-read-results.jsonl',out.map(JSON.stringify).join('\n')+'\n');
const counts=out.reduce((a,x)=>(a[x.jd_fetch_status]=(a[x.jd_fetch_status]||0)+1,a),{});
writeFileSync('data/latest-jd-read-summary.json',JSON.stringify({generated_at:new Date().toISOString(),attempted:out.length,status_counts:counts,full_jd_verified:out.filter(x=>x.full_jd_verified).length},null,2)+'\n');
console.log(JSON.stringify({attempted:out.length,counts,full:out.filter(x=>x.full_jd_verified).length}));
