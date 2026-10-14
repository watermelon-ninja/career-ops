#!/usr/bin/env node
// Layer 2: bulk ATS autodetect for every company unresolved after directory matching.
// Reads official careers URLs already curated in portals.yml; never blocks the main scanner.
import {readFileSync,writeFileSync} from 'node:fs';
import yaml from 'js-yaml';

const follow=JSON.parse(readFileSync('data/priority-manual-followup.json','utf8'));
const portals=yaml.load(readFileSync('portals.yml','utf8')).tracked_companies||[];
const norm=x=>String(x||'').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]/g,'');
const aliases=new Map([['thehomedepot','homedepot'],['delltechnologies','dell'],['samsungelectronics','samsung'],['gxo','gxologistics']]);
const canon=x=>aliases.get(norm(x))||norm(x);
const portalByName=new Map(portals.map(x=>[canon(x.name),x]));
const patterns=[
 ['workday',/https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/([^/?#]+)/i],
 ['greenhouse',/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/i],
 ['ashby',/jobs\.ashbyhq\.com\/([^/?#]+)/i],
 ['lever',/jobs\.lever\.co\/([^/?#]+)/i],
 ['smartrecruiters',/careers\.smartrecruiters\.com\/([^/?#]+)/i],
 ['teamtailor',/https?:\/\/([a-z0-9-]+)\.teamtailor\.com/i]
];
function detect(url=''){for(const [provider,re] of patterns){const m=url.match(re);if(m)return {provider,endpoint:url};}return null;}
const resolved=[],next=[];
for(const c of follow.companies||[]){
 const p=portalByName.get(canon(c.name));
 if(!p){next.push({...c,stage:3,status:'needs_generic_endpoint',attempts:[...(c.attempts||[]),{stage:2,result:'no_curated_careers_url'}]});continue;}
 const d=detect(p.careers_url);
 if(d){resolved.push({...c,stage:2,status:'ats_autodetected_unverified',resolved_by:'official_careers_url',provider:d.provider,endpoint:d.endpoint,full_jd_verified:false,attempts:[...(c.attempts||[]),{stage:2,result:'supported_ats_detected'}]});}
 else next.push({...c,stage:3,status:'needs_generic_endpoint',official_careers_url:p.careers_url,attempts:[...(c.attempts||[]),{stage:2,result:'no_supported_ats_signature'}]});
}
const out={generated_at:new Date().toISOString(),input_count:(follow.companies||[]).length,resolved_at_layer_2:resolved.length,remaining_for_layer_3:next.length,resolved,remaining:next};
writeFileSync('data/priority-resolution-funnel.json',JSON.stringify(out,null,2)+'\n');
writeFileSync('data/priority-manual-followup.json',JSON.stringify({generated_at:out.generated_at,funnel_stage:3,note:'Unresolved after Layers 1-2; not manual failures. Feed these to generic endpoint discovery.',companies:next},null,2)+'\n');
console.log(JSON.stringify({layer:2,input:out.input_count,resolved:resolved.length,remaining:next.length},null,2));
