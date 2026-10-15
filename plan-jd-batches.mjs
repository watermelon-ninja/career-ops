#!/usr/bin/env node
import {readFileSync,existsSync} from 'node:fs';
const target=Number(process.env.FIT_TARGET||30);
const maxBatches=Number(process.env.MAX_JD_BATCHES||6);
const batchSize=50;
function readJsonl(path){if(!existsSync(path))return[];return readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}
const candidates=readJsonl('data/latest-jd-candidates.jsonl');
const processed=new Set(readJsonl('data/processed-jobs.jsonl').map(x=>x.job_key));
const norm=s=>String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
const key=j=>{const company=String(j.company||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'');const id=String(j.job_id||j.requisition_id||j.id||'').trim().toLowerCase();return id?company+'::id::'+id:company+'::role::'+norm(j.title)+'::'+norm(j.location);};
const fresh=candidates.filter(x=>!processed.has(key(x)));
const batches=[...new Set(fresh.map(x=>Number(x.fetch_batch)||Math.ceil((Number(x.fetch_rank)||1)/batchSize)))].sort((a,b)=>a-b).slice(0,maxBatches);
console.log(JSON.stringify({target,max_batches:maxBatches,fresh_candidates:fresh.length,batches}));
if(!batches.length)process.exit(0);
console.log('BATCHES='+batches.join(','));
