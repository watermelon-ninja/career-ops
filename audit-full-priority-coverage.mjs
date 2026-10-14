#!/usr/bin/env node
// Compare Selena priority companies against the FULL ATS directories.
// Output is a coverage audit only; it does not claim a board was successfully scanned.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import yaml from 'js-yaml';

const sources=[
 ['moonie0201','https://raw.githubusercontent.com/moonie0201/ats-directory/main/companies.jsonl', body=>body.split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x)).filter(x=>x.status==='ok').map(x=>({provider:x.provider,slug:x.slug,name:x.name}))],
 ['lastroundai','https://raw.githubusercontent.com/fyrosofttech/lastroundai-hiring-data/main/ats-directory/lastroundai-ats-company-directory-2026-08.csv', body=>{
   const lines=body.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean), header=lines.shift().split(',').map(x=>x.replace(/^"|"$/g,'').trim().toLowerCase());
   return lines.map(line=>{const c=[];let v='',q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){v+='"';i++;}else q=!q;}else if(ch===','&&!q){c.push(v);v='';}else v+=ch;}c.push(v);const r=Object.fromEntries(header.map((h,i)=>[h,c[i]||'']));return {provider:r.ats_vendor,slug:r.board_slug,name:r.company_name};});
 }],
 ['open-ats-feed','https://raw.githubusercontent.com/veresk06/open-ats-feed/main/actor/data/companies.json', body=>{const d=JSON.parse(body);return ['greenhouse','lever','ashby','teamtailor'].flatMap(p=>(d.providers?.[p]?.live||[]).map(([slug])=>({provider:p,slug,name:slug})));}],
 ['workday','https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data/workday_companies.json', body=>JSON.parse(body).map(x=>{const [tenant,shard,site]=String(x).split('|');return {provider:'workday',slug:x,name:tenant,tenant,shard,site};})]
];
const norm=x=>String(x||'').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]/g,'');
const alias=new Map([['delltechnologies','dell'],['samsungelectronics','samsung'],['nxpsemiconductors','nxp'],['thehomedepot','homedepot']]);
const canon=x=>alias.get(norm(x))||norm(x);
const wish=yaml.load(readFileSync('priority-companies-expanded.yml','utf8')).companies||[];
const configured=(yaml.load(readFileSync('portals.yml','utf8')).tracked_companies||[]).filter(c=>['workday','greenhouse','ashby','lever','smartrecruiters','teamtailor'].includes(c.scan_method));
const all=new Map();
for(const [source,url,parse] of sources){const res=await fetch(url);if(!res.ok)throw new Error(source+' HTTP '+res.status);for(const b of parse(await res.text())){if(!b.provider||!b.slug)continue;all.set(b.provider+':'+String(b.slug).toLowerCase(),b);}}
// Add verified direct boards from portals.yml even when third-party directories omit them.
for(const c of configured){all.set('configured:'+canon(c.name),{provider:c.scan_method,slug:c.careers_url,name:c.name,configured:true});}
const idx=new Map();for(const b of all.values()){for(const key of new Set([canon(b.name),canon(b.slug),canon(b.tenant)])){if(!key)continue;if(!idx.has(key))idx.set(key,[]);idx.get(key).push(b);}}
mkdirSync('data',{recursive:true});
const covered=[],needs=[];for(const c of wish){
  const key=canon(c.name), hits=idx.get(key)||[];
  if(hits.length){
    covered.push({name:c.name,group:c.group,stage:1,status:'directory_matched_unverified',resolved_by:hits.some(x=>x.configured)?'configured_board':'directory_alias',providers:[...new Set(hits.map(x=>x.provider))],full_jd_verified:false,boards:hits});
  }else{
    needs.push({name:c.name,group:c.group,stage:2,status:'needs_ats_autodetect',resolved_by:null,provider:null,endpoint:null,full_jd_verified:false,attempts:[],failure_reason:null});
  }
}
// Keep unresolved companies explicit instead of blocking the main scan. This file is the handoff list for alias research, dedicated adapters, or later manual follow-up.
writeFileSync('data/priority-manual-followup.json',JSON.stringify({generated_at:new Date().toISOString(),funnel_stage:2,note:'Unresolved after Layer 1 only; not yet manual failures.',companies:needs},null,2)+'\n');
writeFileSync('data/priority-ats-coverage.json',JSON.stringify({generated_at:new Date().toISOString(),universe_boards:all.size,priority_companies:wish.length,covered_count:covered.length,needs_extra_work_count:needs.length,covered,needs_extra_work:needs},null,2)+'\n');
console.log(JSON.stringify({universe_boards:all.size,priority_companies:wish.length,covered_count:covered.length,needs_extra_work_count:needs.length},null,2));
