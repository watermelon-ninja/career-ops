#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
const src='data/latest-jd-read-results.jsonl';
const rows=readFileSync(src,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const norm=s=>String(s||'').toLowerCase();
function score(j){
  const title=norm(j.title), jd=norm(j.jd_text), loc=norm(j.location);
  let capability=0, role=0, domain=0, delivery=0, tools=0, level=0;
  const reasons=[], risks=[];
  const hit=(re,text=jd)=>re.test(text);
  if(hit(/business systems|systems analyst|business analyst|product owner|technical product|program manager|project manager|implementation consultant|product operations/,title)){role=18;reasons.push('target_role');}
  else if(hit(/product manager|program manager|project manager|systems|analyst|implementation/,title)){role=13;reasons.push('adjacent_role');}
  else role=5;
  if(hit(/supply chain|warehouse management|\bwms\b|inventory management|inventory control|logistics|fulfillment|distribution center/)){domain=18;reasons.push('supply_chain_domain');}
  else if(hit(/operations|enterprise systems|business process/)){domain=10;reasons.push('operations_domain');}
  if(hit(/requirements|business requirement|functional requirement|process flow|process improvement|stakeholder|cross.functional|uat|user acceptance|testing|agile|scrum/)){delivery=18;reasons.push('delivery_match');}
  if(hit(/infor|kinaxis|\bsap\b|databricks|\bsql\b|power bi|erp|enterprise application|system implementation|integration|api|saas/)){tools=14;reasons.push('systems_tools');}
  if(hit(/3pl|vendor|partner|external developer|implementation partner|cross.functional|stakeholder/)){capability+=8;reasons.push('partner_collaboration');}
  if(hit(/5\+ years|6\+ years|7\+ years|five years|six years|seven years/)){level=9;} else level=12;
  if(hit(/10\+ years|12\+ years|15\+ years|ten years|twelve years|fifteen years/)){level=3;risks.push('experience_gap');}
  if(hit(/director|vice president|vp\b/,title)){level=Math.min(level,3);risks.push('level_too_high');}
  if(hit(/software engineer|developer|architect|data scientist/,title)){risks.push('technical_role_mismatch');}
  if(/remote.*(ontario|quebec|canada)|\bcanada\b/.test(loc)){risks.push('location_not_us');}
  let total=role+domain+delivery+tools+capability+level;
  if(risks.includes('technical_role_mismatch')) total-=15;
  if(risks.includes('location_not_us')) total-=30;
  total=Math.max(0,Math.min(100,total));
  const fit=Math.round(total)/10;
  return {...j,selena_fit_score:fit,selena_fit_band:fit>=9?'strong_apply':fit>=8?'high_review':fit>=7?'possible':'low',selena_fit_reasons:reasons,selena_fit_risks:risks};
}
const eligible=rows.filter(x=>x.fit_scoring_eligible&&x.full_jd_verified&&x.jd_text);
const out=eligible.map(score).sort((a,b)=>b.selena_fit_score-a.selena_fit_score);
writeFileSync('data/latest-selena-fit-results.jsonl',out.map(JSON.stringify).join('\n')+(out.length?'\n':''));
const summary={generated_at:new Date().toISOString(),eligible:eligible.length,scored:out.length,strong_apply:out.filter(x=>x.selena_fit_score>=9).length,high_review:out.filter(x=>x.selena_fit_score>=8&&x.selena_fit_score<9).length,possible:out.filter(x=>x.selena_fit_score>=7&&x.selena_fit_score<8).length,low:out.filter(x=>x.selena_fit_score<7).length};
writeFileSync('data/latest-selena-fit-summary.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));
