#!/usr/bin/env node
// Priority-company mapping audit. Does not claim that a board was fetched.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import yaml from 'js-yaml';
const wish=yaml.load(readFileSync('priority-companies-expanded.yml','utf8')).companies||[];
const configured=yaml.load(readFileSync('portals.yml','utf8')).tracked_companies||[];
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases=new Map([
 ['delltechnologies','dell'],['samsungelectronics','samsung'],
 ['nxpsemiconductors','nxp'],['gxo logistics'.replace(/[^a-z0-9]/g,''),'gxo'],
 ['thehomedepot','homedepot'],['ibmconsulting','ibm']
]);
const canonical=s=>aliases.get(normalize(s))||normalize(s);
const index=new Map();
for(const c of configured){const key=canonical(c.name.replace(/\s*\([^)]*\)/g,''));if(!index.has(key))index.set(key,[]);index.get(key).push(c);}
const report=wish.map(w=>{
 const hits=index.get(canonical(w.name))||[];
 const api=hits.find(h=>['workday','greenhouse','ashby','lever','smartrecruiters','teamtailor'].includes(h.scan_method));
 const web=hits.find(h=>h.scan_method==='websearch');
 return {name:w.name,group:w.group,status:api?'configured_api_not_validated':web?'websearch_only_not_scanned':'needs_mapping',method:api?.scan_method||web?.scan_method||'',careers_url:api?.careers_url||web?.careers_url||''};
});
mkdirSync('data',{recursive:true});
writeFileSync('data/priority-company-mapping.json',JSON.stringify({generated_at:new Date().toISOString(),total:report.length,counts:Object.fromEntries(['configured_api_not_validated','websearch_only_not_scanned','needs_mapping'].map(k=>[k,report.filter(r=>r.status===k).length])),companies:report},null,2)+'\n');
console.log('Priority company audit:',JSON.stringify({total:report.length,counts:Object.fromEntries(['configured_api_not_validated','websearch_only_not_scanned','needs_mapping'].map(k=>[k,report.filter(r=>r.status===k).length]))}));
