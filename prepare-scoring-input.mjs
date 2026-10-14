import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';

const candidatesPath='data/latest-jd-candidates.jsonl';
const enrichmentPath='data/jd-enrichment.jsonl';
const outDir='data/scoring-input';

function jsonl(path){
  if(!existsSync(path)) throw Error(`Missing ${path}`);
  const rows=[];
  for(const line of readFileSync(path,'utf8').split('\n').filter(Boolean)){
    try{ rows.push(JSON.parse(line)); } catch(e){ console.warn(`Skipping malformed row in ${path}: ${e.message}`); }
  }
  return rows;
}
function safe(s){return String(s||'job').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,60).toLowerCase()||'job';}

const candidates=jsonl(candidatesPath);
const batchIds=[...new Set(candidates.map(x=>x.batch_id).filter(Boolean))];
if(batchIds.length!==1) throw Error(`Expected exactly one current batch, got ${batchIds.length}`);
const batchId=batchIds[0];
const urls=new Set(candidates.map(x=>x.url));
const enriched=jsonl(enrichmentPath).filter(x=>urls.has(x.url));
const ready=enriched.filter(x=>x.status==='full_jd_ready');

rmSync(outDir,{recursive:true,force:true});
mkdirSync(outDir,{recursive:true});

const manifest=[];
ready.forEach((x,i)=>{
  const c=candidates.find(y=>y.url===x.url)||{};
  const record={
    batch_id:batchId,
    index:i+1,
    company:x.company||c.company||'',
    title:x.title||c.title||'',
    location:x.location||c.location||'',
    url:x.url,
    source:c.source||x.source||x.portal||'',
    status:x.status,
    jd_length:(x.jd||x.description||'').length,
    jd:x.jd||x.description||''
  };
  const filename=`${String(i+1).padStart(3,'0')}-${safe(record.company)}-${safe(record.title)}.json`;
  writeFileSync(`${outDir}/${filename}`,JSON.stringify(record,null,2)+'\n');
  manifest.push({...record,jd:undefined,file:filename});
});
writeFileSync(`${outDir}/manifest.json`,JSON.stringify({batch_id:batchId,candidates:candidates.length,full_jd_ready:ready.length,jobs:manifest},null,2)+'\n');
console.log(`Scoring input batch: ${batchId}`);
console.log(`Candidates: ${candidates.length}; full JD ready: ${ready.length}`);
console.log(`Wrote ${ready.length} per-job files + manifest to ${outDir}`);
