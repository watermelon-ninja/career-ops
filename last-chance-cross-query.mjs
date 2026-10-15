#!/usr/bin/env node

/**
 * Prepare a company x role-family x supply-chain-domain cross-query pass
 * when the current run is short of 30 new, full-JD Selena fits >= 9.0.
 *
 * This script deliberately prepares a transparent search plan rather than
 * claiming that web sources were searched. The career-ops GitHub Action has
 * no LinkedIn/Indeed/Jobright/general-web search credentials or connector;
 * an agent with WebSearch must execute the pending queries and record results.
 */
import { readFileSync, writeFileSync } from 'node:fs';

export const TARGET = 30;
export const QUERY_FAMILIES = [
  { id: 'business_systems_erp', roles: ['"business systems analyst"', '"systems analyst"', '"business analyst"'], domains: ['ERP', 'WMS', 'SAP', 'Kinaxis', '"enterprise systems"', 'integration'] },
  { id: 'product_supply_chain', roles: ['"product manager"', '"product owner"', '"technical product manager"'], domains: ['"supply chain"', 'warehouse', 'logistics', 'fulfillment'] },
  { id: 'program_implementation', roles: ['"program manager"', '"implementation manager"', '"implementation consultant"', '"project manager"'], domains: ['"supply chain"', 'warehouse', 'logistics', 'distribution', 'fulfillment'] },
  { id: 'planning_analytics', roles: ['"supply chain analyst"', '"business intelligence"', '"data analyst"'], domains: ['"S&OP"', 'inventory', '"demand planning"', 'fulfillment', 'analytics'] }
];
export const CATCHUP_SITES = [
  'linkedin.com/jobs', 'indeed.com/viewjob', 'jobright.ai'
];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const identity = (j) => {
  const company = norm(j.company);
  const id = String(j.job_id || j.requisition_id || j.id || '').trim().toLowerCase();
  if (id) return `${company}::id::${id}`;
  const url = String(j.url || '').trim().toLowerCase().replace(/[?#].*$/, '').replace(/\/$/, '');
  return url ? `${company}::url::${url}` : `${company}::role::${norm(j.title)}::${norm(j.location)}`;
};

export function countQualifyingFits(rows) {
  const keys = new Set();
  for (const j of rows) {
    const score = Number(j.selena_fit_score ?? j.machine_fit_score);
    if (score < 9 || j.core_work_mode_gate !== 'pass' || j.review_status === 'rejected') continue;
    if (j.full_jd_verified !== true && j.jd_fetch_status !== 'full') continue;
    if (!j.company || !j.title || !j.url) continue;
    keys.add(identity(j));
  }
  return keys.size;
}

function orGroup(terms) { return `(${terms.join(' OR ')})`; }

export function buildQueries(companies) {
  return companies.flatMap((entry, companyIndex) => {
    const company = typeof entry === 'string' ? entry : entry.name;
    if (!company) return [];
    const escaped = `"${company.replaceAll('"', '')}"`;
    const sourceGroup = orGroup(CATCHUP_SITES.map((site) => `site:${site}`));
    const companyBatch = Math.floor(companyIndex / 25) + 1;
    return QUERY_FAMILIES.flatMap((family, familyIndex) => {
      const base = `${escaped} ${orGroup(family.domains)} ${orGroup(family.roles)}`;
      return [
        { company, company_batch: companyBatch, round: familyIndex + 1, query_family: family.id, source_scope: 'official_and_public_web', query: base, status: 'pending' },
        { company, company_batch: companyBatch, round: familyIndex + 1, query_family: family.id, source_scope: 'linkedin_indeed_jobright', query: `${sourceGroup} ${base}`, status: 'pending' }
      ];
    });
  });
}

export function createPlan({ summary, companies, target = TARGET, generatedAt = new Date().toISOString() }) {
  if (!summary || !Number.isFinite(Number(summary.new_strong_apply))) {
    return {
      generated_at: generatedAt,
      target,
      status: 'blocked_not_scored',
      reason: 'A current-run Selena Fit summary is required before deciding whether catch-up search is needed.',
      initial_qualifying_count: null,
      shortfall: null,
      queries: []
    };
  }
  const qualifying = Math.max(0, Math.floor(Number(summary.new_strong_apply)));
  const shortfall = Math.max(0, target - qualifying);
  return {
    generated_at: generatedAt,
    target,
    status: shortfall ? 'pending_external_search' : 'target_met',
    initial_qualifying_count: qualifying,
    shortfall,
    query_method: 'company × focused domain family × related role family; run once unrestricted and once across LinkedIn/Indeed/Jobright indexes',
    execution_policy: { company_batch_size: 25, queries_per_company_batch_per_round: 50, rounds: 'Run the next 25-company batch for one role/domain family, retrieve and score its JDs, then stop immediately if the target is reached. Continue to the next batch/round only while below target.' },
    sources: Object.fromEntries(['official_careers', 'linkedin', 'indeed', 'jobright_aggregator', 'public_web'].map((source) => [source, { status: shortfall ? 'pending' : 'not_needed', jobs_discovered: 0 }])),
    queries: shortfall ? buildQueries(companies) : []
  };
}

function main() {
  const summaryPath = process.argv.find((x) => x.startsWith('--summary='))?.slice(10) || 'data/latest-selena-fit-summary.json';
  const companiesPath = process.argv.find((x) => x.startsWith('--companies='))?.slice(12) || 'priority-companies-expanded.yml';
  const outPath = process.argv.find((x) => x.startsWith('--out='))?.slice(6) || 'data/last-chance-cross-query-plan.json';
  let summary = null;
  try { summary = readJson(summaryPath); } catch { /* blocked status is written below */ }
  let companies = [];
  try {
    const source = readFileSync(companiesPath, 'utf8');
    companies = [...source.matchAll(/^\s*-\s*\{name:\s*["']([^"']+)["']/gm)].map((match) => match[1]);
  } catch { /* leave empty and make the deficiency visible in summary */ }
  const plan = createPlan({ summary, companies });
  if (plan.status === 'pending_external_search' && companies.length === 0) {
    plan.status = 'blocked_company_list_missing';
    plan.reason = `No companies could be read from ${companiesPath}`;
    plan.sources = Object.fromEntries(Object.keys(plan.sources).map((source) => [source, { status: 'blocked', jobs_discovered: 0, reason: 'company_list_missing' }]));
  }
  writeFileSync(outPath, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(JSON.stringify({ status: plan.status, target: plan.target, initial_qualifying_count: plan.initial_qualifying_count, shortfall: plan.shortfall, planned_queries: plan.queries.length, output: outPath }));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
