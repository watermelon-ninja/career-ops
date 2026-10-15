#!/usr/bin/env node

/**
 * scan.mjs — Zero-token portal scanner
 *
 * Fetches Greenhouse, Ashby, and Lever APIs directly, applies title
 * filters from portals.yml, deduplicates against existing history,
 * and appends new offers to pipeline.md + scan-history.tsv.
 *
 * Zero Claude API tokens — pure HTTP + JSON.
 *
 * Usage:
 *   node scan.mjs                  # scan all enabled companies
 *   node scan.mjs --dry-run        # preview without writing files
 *   node scan.mjs --company Cohere # scan a single company
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import yaml from 'js-yaml';
const parseYaml = yaml.load;

// ── Config ──────────────────────────────────────────────────────────

const PORTALS_PATH = 'portals.yml';
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const PIPELINE_PATH = 'data/pipeline.md';
const APPLICATIONS_PATH = 'data/applications.md';
const UNIVERSE_CURSOR_PATH = 'data/universe-cursor.json';
const LATEST_CANDIDATES_PATH = 'data/latest-jd-candidates.jsonl';
const PRIORITY_COMPANIES_PATH = 'priority-companies-expanded.yml';
const DISCOVERY_RESULTS_PATH = 'data/multi-source-discovery-results.json';
const UNIVERSE_URL = 'https://raw.githubusercontent.com/moonie0201/ats-directory/main/companies.jsonl';
const UNIVERSE_BATCH = 100; // Rotate across the external directory; override with --universe-batch N


// Ensure required directories exist (fresh setup)
mkdirSync('data', { recursive: true });

const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 10_000;

// ── API detection ───────────────────────────────────────────────────

function detectApi(company) {
  // Greenhouse: explicit api field
  if (company.api && company.api.includes('greenhouse')) {
    return { type: 'greenhouse', url: company.api };
  }

  const url = company.careers_url || '';

  // SmartRecruiters public Posting API.
  const srMatch = url.match(/^https?:\/\/careers\.smartrecruiters\.com\/([^/?#]+)/i);
  if (srMatch) return { type: 'smartrecruiters', url: `https://api.smartrecruiters.com/v1/companies/${srMatch[1]}/postings`, slug: srMatch[1] };

  // Workday CXS: preserve the tenant, shard and career-site slug from a real URL.
  const wdMatch = url.match(/^https?:\/\/([a-z0-9-]+)\.(wd[0-9]+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)/i);
  if (wdMatch) {
    const [, tenant, shard, site] = wdMatch;
    return { type: 'workday', url: `https://${tenant}.${shard}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`, origin: `https://${tenant}.${shard}.myworkdayjobs.com`, site };
  }

  // Ashby
  const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (ashbyMatch) {
    return {
      type: 'ashby',
      url: `https://api.ashbyhq.com/posting-api/job-board/${ashbyMatch[1]}?includeCompensation=true`,
    };
  }

  // Lever
  const leverMatch = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (leverMatch) {
    return {
      type: 'lever',
      url: `https://api.lever.co/v0/postings/${leverMatch[1]}`,
    };
  }

  // Greenhouse EU boards
  const ghEuMatch = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  if (ghEuMatch && !company.api) {
    return {
      type: 'greenhouse',
      url: `https://boards-api.greenhouse.io/v1/boards/${ghEuMatch[1]}/jobs`,
    };
  }

  const teamtailorMatch = url.match(/https?:\/\/([a-z0-9-]+)\.teamtailor\.com(?:\/|$)/i);
  if (teamtailorMatch) return { type: 'teamtailor', url: `https://${teamtailorMatch[1]}.teamtailor.com/jobs.json` };

  return null;
}

// ── External ATS directory (rotating batches, never silently claims full coverage) ──
const SECOND_UNIVERSE_URL = 'https://raw.githubusercontent.com/fyrosofttech/lastroundai-hiring-data/main/ats-directory/lastroundai-ats-company-directory-2026-08.csv';
const THIRD_UNIVERSE_URL = 'https://raw.githubusercontent.com/veresk06/open-ats-feed/main/actor/data/companies.json';

function parseCsvRows(csv) {
  const rows = [];
  for (const line of csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)) {
    const cols = [];
    let value = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { value += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === ',' && !quoted) { cols.push(value); value = ''; }
      else value += ch;
    }
    cols.push(value);
    rows.push(cols);
  }
  const header = rows.shift()?.map(v => v.trim().toLowerCase()) || [];
  return rows.map(cols => Object.fromEntries(header.map((key, i) => [key, cols[i] || ''])));
}

async function loadUniverse(args) {
  if (!args.includes('--universe')) return [];
  const flag = args.indexOf('--universe-batch');
  const requested = flag >= 0 ? Number(args[flag + 1]) : UNIVERSE_BATCH;
  if (!Number.isInteger(requested) || requested < 1 || requested > 1000) {
    throw new Error('--universe-batch must be between 1 and 1000');
  }
  const sources = [
    { name: 'moonie0201', url: UNIVERSE_URL, parse: body => body.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)).filter(r => r.status === 'ok').map(r => ({ provider: r.provider, slug: r.slug, name: r.name })) },
    { name: 'lastroundai', url: SECOND_UNIVERSE_URL, parse: body => parseCsvRows(body).map(r => ({ provider: r.ats_vendor, slug: r.board_slug, name: r.company_name })) },
    { name: 'open-ats-feed', url: THIRD_UNIVERSE_URL, parse: body => {
      const data = JSON.parse(body);
      return ['greenhouse', 'lever', 'ashby', 'teamtailor'].flatMap(provider =>
        (data.providers?.[provider]?.live || []).map(([slug]) => ({ provider, slug, name: slug }))
      );
    } },
    { name: 'workday-commoncrawl', url: 'https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data/workday_companies.json', parse: body => JSON.parse(body).map(value => {
      const [tenant, shard, site] = String(value).split('|');
      return { provider: 'workday', slug: value, name: tenant, tenant, shard, site };
    }).filter(r => /^[a-z0-9-]+$/i.test(r.tenant || '') && /^wd[0-9]+$/i.test(r.shard || '') && /^[a-z0-9_.-]+$/i.test(r.site || '')) },
  ];
  const combined = new Map();
  const sourceBuckets = new Map();
  for (const source of sources) {
    try {
      const response = await fetch(source.url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = source.parse(await response.text());
      let added = 0;
      const bucket = [];
      for (const r of rows) {
        if (!['ashby','greenhouse','lever','teamtailor','workday'].includes(r.provider) || (r.provider !== 'workday' && !/^[a-z0-9_.-]+$/i.test(r.slug || ''))) continue;
        const key = `${r.provider}:${r.slug.toLowerCase()}`;
        if (!combined.has(key)) { combined.set(key, r); bucket.push(r); added++; }
      }
      console.log(`ATS source ${source.name}: ${rows.length} entries; ${added} new unique boards`);
      sourceBuckets.set(source.name, bucket);
    } catch (error) {
      console.error(`ATS source ${source.name} unavailable: ${error.message}`);
    }
  }
  // Keep the original two-source ordering intact so an existing cursor never skips
  // or repeats baseline boards when a new directory source is added.
  const compareBoards = (a,b) => (a.provider + ':' + a.slug).localeCompare(b.provider + ':' + b.slug);
  // Freeze existing 15,779-board ordering: first two sources form the
  // original sorted prefix, then open-ats-feed, then Workday additions.
  const valid = [
    ...[...(sourceBuckets.get('moonie0201') || []), ...(sourceBuckets.get('lastroundai') || [])].sort(compareBoards),
    ...(sourceBuckets.get('open-ats-feed') || []).sort(compareBoards),
    ...(sourceBuckets.get('workday-commoncrawl') || []).sort(compareBoards),
  ];
  if (!valid.length) throw new Error('No ATS directory sources loaded successfully');
  const general = valid.filter(r => r.provider !== 'workday');
  const workday = valid.filter(r => r.provider === 'workday');
  let generalCursor = 0, workdayCursor = 0;
  if (existsSync(UNIVERSE_CURSOR_PATH)) {
    try {
      const saved = JSON.parse(readFileSync(UNIVERSE_CURSOR_PATH, 'utf-8'));
      // Migrate the old single cursor into the general lane; Workday starts fresh.
      if (Number.isInteger(saved.general_next_index)) generalCursor = saved.general_next_index % Math.max(1, general.length);
      else if (Number.isInteger(saved.next_index)) generalCursor = saved.next_index % Math.max(1, general.length);
      if (Number.isInteger(saved.workday_next_index)) workdayCursor = saved.workday_next_index % Math.max(1, workday.length);
    } catch (error) {
      console.error(`ATS cursor unreadable: ${error.message}; restarting lane cursors at 0`);
    }
  }
  // Enterprise-heavy allocation: 60% Workday, 40% discovery across other ATSs.
  const workdaySize = Math.min(workday.length, Math.max(1, Math.round(requested * 0.60)));
  const generalSize = Math.min(general.length, Math.max(1, requested - workdaySize));
  const generalBatch = Array.from({length: generalSize}, (_, i) => general[(generalCursor + i) % general.length]);
  const workdayBatch = Array.from({length: workdaySize}, (_, i) => workday[(workdayCursor + i) % workday.length]);
  const batch = [...generalBatch, ...workdayBatch];
  const nextGeneral = (generalCursor + generalSize) % general.length;
  const nextWorkday = (workdayCursor + workdaySize) % workday.length;
  writeFileSync(UNIVERSE_CURSOR_PATH, JSON.stringify({
    general_next_index: nextGeneral,
    workday_next_index: nextWorkday,
    general_universe_size: general.length,
    workday_universe_size: workday.length,
    universe_size: valid.length,
    batch_size: batch.length,
    last_general_start_index: generalCursor,
    last_workday_start_index: workdayCursor,
    updated_at: new Date().toISOString()
  }, null, 2) + '\n', 'utf-8');
  console.log(`ATS universe: ${valid.length} boards = ${general.length} general + ${workday.length} Workday`);
  console.log(`General lane: ${generalCursor}..${(generalCursor + generalSize - 1) % general.length} (${generalSize}); next ${nextGeneral}`);
  console.log(`Workday lane: ${workdayCursor}..${(workdayCursor + workdaySize - 1) % workday.length} (${workdaySize}); next ${nextWorkday}`);
  return batch.map(r => ({name: r.name || r.slug, careers_url: r.provider === 'ashby' ? `https://jobs.ashbyhq.com/${r.slug}` : r.provider === 'lever' ? `https://jobs.lever.co/${r.slug}` : r.provider === 'teamtailor' ? `https://${r.slug}.teamtailor.com` : r.provider === 'workday' ? `https://${r.tenant}.${r.shard}.myworkdayjobs.com/${r.site}` : `https://job-boards.greenhouse.io/${r.slug}`, scan_method: r.provider, enabled: true}));
}

// ── API parsers ─────────────────────────────────────────────────────

function parseGreenhouse(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.absolute_url || '',
    company: companyName,
    location: j.location?.name || '',
  }));
}

function parseAshby(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.jobUrl || '',
    company: companyName,
    location: j.location || '',
  }));
}

function parseLever(json, companyName) {
  if (!Array.isArray(json)) return [];
  return json.map(j => ({
    title: j.text || '',
    url: j.hostedUrl || '',
    company: companyName,
    location: j.categories?.location || '',
  }));
}

function parseTeamtailor(json, companyName) {
  return (json.items || []).map(j => ({
    title: j.title || '',
    url: j.url || '',
    company: companyName,
    location: (j._jobposting?.jobLocation || []).map(loc => {
      const a = loc.address || {};
      return [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(', ');
    }).filter(Boolean).join(' / ') || (j._jobposting?.jobLocationType === 'TELECOMMUTE' ? 'Remote' : ''),
  }));
}

// Workday only allows up to 20 results per CXS page. Keep requests bounded
// to avoid spending the whole Actions run on a single very large employer.
async function fetchWorkdayJobs(api, companyName) {
  const pageSize = 20, maxPages = 25;
  const jobs = [];
  let firstPageTotal = null;
  for (let page = 0; page < maxPages; page++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let json;
    try {
      const response = await fetch(api.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: pageSize, offset: page * pageSize, searchText: '' }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Workday HTTP ${response.status}`);
      json = await response.json();
    } finally { clearTimeout(timer); }
    if (page === 0 && Number.isFinite(json.total) && json.total > 0) firstPageTotal = json.total;
    const postings = json.jobPostings || [];
    for (const j of postings) {
      if (!j.externalPath) continue;
      jobs.push({
        title: j.title || '',
        url: `${api.origin}/${api.site}${j.externalPath.startsWith('/') ? '' : '/'}${j.externalPath}`,
        company: companyName,
        location: j.locationsText || j.bulletFields?.join(' / ') || '',
      });
    }
    if (postings.length < pageSize || (firstPageTotal !== null && (page + 1) * pageSize >= firstPageTotal)) break;
    if (page === maxPages - 1) console.log(`Workday ${companyName}: reached ${maxPages * pageSize}-job safety cap; board is partially scanned`);
  }
  return jobs;
}

async function fetchSmartRecruitersJobs(api, companyName) {
  const pageSize = 100, maxPages = 10;
  const jobs = [];
  for (let page = 0; page < maxPages; page++) {
    const json = await fetchJson(`${api.url}?limit=${pageSize}&offset=${page * pageSize}`);
    const postings = json.content || [];
    for (const j of postings) {
      const loc = j.location || {};
      jobs.push({
        title: j.name || '',
        url: j.id ? `https://jobs.smartrecruiters.com/${api.slug}/${j.id}` : '',
        company: companyName,
        location: [loc.city, loc.region, loc.country].filter(Boolean).join(', ') || (loc.remote ? 'Remote' : ''),
      });
    }
    if (postings.length < pageSize || (Number.isFinite(json.totalFound) && (page + 1) * pageSize >= json.totalFound)) break;
    if (page === maxPages - 1) console.log(`SmartRecruiters ${companyName}: reached ${maxPages * pageSize}-job safety cap`);
  }
  return jobs;
}

const PARSERS = { greenhouse: parseGreenhouse, ashby: parseAshby, lever: parseLever, teamtailor: parseTeamtailor };

// ── Fetch with timeout ──────────────────────────────────────────────

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Title filter ────────────────────────────────────────────────────

function buildTitleFilter(titleFilter) {
  const negative = (titleFilter?.negative || []).map(k => k.toLowerCase());
  // High-recall stage-1 signals. Precision belongs to full-JD scoring.
  const domain = ['supply chain','logistics','warehouse','inventory','fulfillment','planning','procurement','operations','distribution','order management'];
  const tech = ['system','systems','technology','tech','digital','it ','information technology','platform','application','applications','integration','erp','wms','sap','kinaxis','infor','data','analytics','business intelligence','bi '];
  const role = ['analyst','product','program','project','manager','owner','consultant','implementation','solution','solutions','lead','specialist','architect'];
  const standalone = ['business analyst','systems analyst','system analyst','product owner','product manager','program manager','project manager','technical program manager','business systems','implementation consultant'];

  return (title) => {
    const lower = String(title || '').toLowerCase();
    if (!lower) return false;
    if (negative.some(k => lower.includes(k))) return false;
    const hasDomain = domain.some(k => lower.includes(k));
    const hasTech = tech.some(k => lower.includes(k));
    const hasRole = role.some(k => lower.includes(k));
    const hasStandalone = standalone.some(k => lower.includes(k));
    // Domain roles are broadly eligible; otherwise require a tech/system signal
    // plus a role signal. Known target role families always pass.
    return hasStandalone || (hasDomain && (hasRole || hasTech)) || (hasTech && hasRole);
  };
}

// ── Cheap hard-negative gate ────────────────────────────────────────
// Title-only exclusions that are unambiguously below/outside Selena's target level.
// Runs during discovery for every company, including Priority Companies.
function levelHardNegative(title) {
  const lower = String(title || '').toLowerCase().trim();
  return [
    /\b(warehouse|inventory)\s+(associate|worker)\b/,
    /\b(material handler|picker|packer|forklift|order selector)\b/,
    /\b(intern|internship|co-op|apprentice|trainee)\b/,
    /\b(development program|rotational program)\b/
  ].some(re => re.test(lower));
}

// ── Location filter ─────────────────────────────────────────────────
// Optional. If `location_filter` is absent from portals.yml, all locations pass.
// Semantics:
//   - Empty location string → pass (don't penalize missing data)
//   - `block` matches → reject (takes precedence over allow)
//   - `allow` empty → pass (already cleared block)
//   - `allow` non-empty → must match at least one keyword
// All matches are case-insensitive substring.

function buildLocationFilter(locationFilter) {
  if (!locationFilter) return () => true;
  const allow = (locationFilter.allow || []).map(k => k.toLowerCase());
  const block = (locationFilter.block || []).map(k => k.toLowerCase());

  return (location) => {
    if (!location) return true;
    const lower = location.toLowerCase();
    if (block.length > 0 && block.some(k => lower.includes(k))) return false;

    // Remote alone is not enough: reject clearly foreign-only remote locations
    // before applying the broad US/Austin/Texas allow list.
    const foreignSignals = [
      'canada','canadian','europe','emea','germany','german','uk','united kingdom',
      'australia','india','mexico','philippines','poland','france','spain','italy',
      'netherlands','ireland','singapore','japan','brazil','argentina',
      'malaysia','costa rica','taipei','taiwan','riyadh','saudi arabia','sao paulo','são paulo',
      'quebec','ontario','british columbia','alberta','manitoba','saskatchewan',
      'nova scotia','new brunswick','newfoundland','prince edward island'
    ];
    const usSignals = ['united states','usa','u.s.',' us ','austin','texas',' tx','remote - us','remote-us','us remote','remote u.s.'];
    const clearlyForeign = foreignSignals.some(k => lower.includes(k));
    const clearlyUS = usSignals.some(k => lower.includes(k));
    if (clearlyForeign && !clearlyUS) return false;

    // Explicit country/region-qualified remote locations must prove US eligibility.
    // Plain "Remote" or "Global" stays ambiguous and may continue to JD review.
    const remoteQualified = /\bremote\b[\s,\-–—]*(?!$)(.+)/i.exec(location);
    if (remoteQualified && !clearlyUS) {
      const qualifier = remoteQualified[1].trim().toLowerCase();
      if (qualifier && !/^(global|worldwide|anywhere)$/.test(qualifier)) return false;
    }

    if (allow.length === 0) return true;
    return allow.some(k => lower.includes(k));
  };
}

// ── Dedup ───────────────────────────────────────────────────────────

function loadSeenUrls() {
  const seen = new Set();

  // scan-history.tsv
  if (existsSync(SCAN_HISTORY_PATH)) {
    const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
    for (const line of lines.slice(1)) { // skip header
      const url = line.split('\t')[0];
      if (url) seen.add(url);
    }
  }

  // pipeline.md — extract URLs from checkbox lines
  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    for (const match of text.matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) {
      seen.add(match[1]);
    }
  }

  // applications.md — extract URLs from report links and any inline URLs
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const match of text.matchAll(/https?:\/\/[^\s|)]+/g)) {
      seen.add(match[0]);
    }
  }

  return seen;
}

function loadSeenCompanyRoles() {
  const seen = new Set();
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    // Parse markdown table rows: | # | Date | Company | Role | ...
    for (const match of text.matchAll(/\|[^|]+\|[^|]+\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g)) {
      const company = match[1].trim().toLowerCase();
      const role = match[2].trim().toLowerCase();
      if (company && role && company !== 'company') {
        seen.add(`${company}::${role}`);
      }
    }
  }
  return seen;
}

// ── Pipeline writer ─────────────────────────────────────────────────

function appendToPipeline(offers) {
  if (offers.length === 0) return;

  let text = readFileSync(PIPELINE_PATH, 'utf-8');

  // Find "## Pendientes" section and append after it
  const marker = '## Pendientes';
  const idx = text.indexOf(marker);
  if (idx === -1) {
    // No Pendientes section — append at end before Procesadas
    const procIdx = text.indexOf('## Procesadas');
    const insertAt = procIdx === -1 ? text.length : procIdx;
    const block = `\n${marker}\n\n` + offers.map(o =>
      `- [ ] ${o.url} | ${o.company} | ${o.title}`
    ).join('\n') + '\n\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  } else {
    // Find the end of existing Pendientes content (next ## or end)
    const afterMarker = idx + marker.length;
    const nextSection = text.indexOf('\n## ', afterMarker);
    const insertAt = nextSection === -1 ? text.length : nextSection;

    const block = '\n' + offers.map(o =>
      `- [ ] ${o.url} | ${o.company} | ${o.title}`
    ).join('\n') + '\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  }

  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

function appendToScanHistory(offers, date) {
  // Ensure file + header exist. Location appended as 7th column for non-breaking
  // backward compat — older scan-history.tsv files with 6 columns still parse fine
  // since loadSeenUrls only reads column 0.
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n', 'utf-8');
  }

  const lines = offers.map(o =>
    `${o.url}\t${date}\t${o.source}\t${o.title}\t${o.company}\tadded\t${o.location || ''}`
  ).join('\n') + '\n';

  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf-8');
}

// ── Parallel fetch with concurrency limit ───────────────────────────

async function parallelFetch(tasks, limit) {
  const results = [];
  let i = 0;

  async function next() {
    while (i < tasks.length) {
      const task = tasks[i++];
      results.push(await task());
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => next());
  await Promise.all(workers);
  return results;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const companyFlag = args.indexOf('--company');
  const filterCompany = companyFlag !== -1 ? args[companyFlag + 1]?.toLowerCase() : null;

  // 1. Read portals.yml
  if (!existsSync(PORTALS_PATH)) {
    console.error('Error: portals.yml not found. Run onboarding first.');
    process.exit(1);
  }

  const config = parseYaml(readFileSync(PORTALS_PATH, 'utf-8'));
  const configuredCompanies = config.tracked_companies || [];
  const priorityRegistry = existsSync(PRIORITY_COMPANIES_PATH)
    ? (parseYaml(readFileSync(PRIORITY_COMPANIES_PATH, 'utf-8')).companies || [])
    : [];
  const normalizeCompany = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const priorityNameMap = new Map(priorityRegistry.map(x => [normalizeCompany(x.name), x.name]));
  const isPriorityCompany = name => priorityNameMap.has(normalizeCompany(name));
  const priorityCompanies = configuredCompanies;
  let extraCompanies = [];
  try { extraCompanies = await loadUniverse(args); }
  catch (error) { console.error(`ATS directory unavailable: ${error.message}; continuing with priority companies`); }
  const priorityKeys = new Set(priorityCompanies.map(c => detectApi(c)?.url).filter(Boolean));
  const companies = [...priorityCompanies, ...extraCompanies.filter(c => !priorityKeys.has(detectApi(c)?.url))];
  const titleFilter = buildTitleFilter(config.title_filter);
  const locationFilter = buildLocationFilter(config.location_filter);

  // 2. Filter to enabled companies with detectable APIs
  const targets = companies
    .filter(c => c.enabled !== false)
    .filter(c => !filterCompany || c.name.toLowerCase().includes(filterCompany))
    .map(c => ({ ...c, _api: detectApi(c) }))
    .filter(c => c._api !== null);

  const selected = companies.filter(c => c.enabled !== false).filter(c => !filterCompany || c.name.toLowerCase().includes(filterCompany));
  const websearchPending = selected.filter(c => c.scan_method === 'websearch' && !detectApi(c));
  const unsupported = selected.filter(c => c.scan_method !== 'websearch' && !detectApi(c));

  console.log(`Scanning ${targets.length} companies via API; ${websearchPending.length} websearch-only companies require a separate runner; ${unsupported.length} companies have no supported API configuration`);
  if (dryRun) console.log('(dry run — no files will be written)\n');

  // 3. Load dedup sets
  const seenUrls = loadSeenUrls();
  const seenCompanyRoles = loadSeenCompanyRoles();
  const processedJobKeys = new Set();
  const processedPath = 'data/processed-jobs.jsonl';
  if (existsSync(processedPath)) {
    for (const line of readFileSync(processedPath, 'utf-8').split('\n').filter(Boolean)) {
      try { const x = JSON.parse(line); if (x.job_key) processedJobKeys.add(x.job_key); } catch {}
    }
  }
  const jobKey = job => {
    const company = String(job.company || '').trim().toLowerCase().replace(/[^a-z0-9]+/g,'');
    const id = String(job.job_id || job.requisition_id || job.id || '').trim().toLowerCase();
    if (id) return company + '::id::' + id;
    return company + '::role::' + String(job.title || '').trim().toLowerCase().replace(/\s+/g,' ') + '::' + String(job.location || '').trim().toLowerCase().replace(/\s+/g,' ');
  };

  // 4. Fetch all APIs
  const date = new Date().toISOString().slice(0, 10);
  let totalFound = 0;
  let totalFilteredTitle = 0;
  let totalFilteredLocation = 0;
  let totalFilteredLevel = 0;
  let totalDupes = 0;
  const newOffers = [];
  const errors = [];
  const providerStats = new Map();
  for (const c of targets) {
    const type = c._api.type;
    if (!providerStats.has(type)) providerStats.set(type, { boards: 0, jobs: 0, errors: 0, candidates: 0 });
    providerStats.get(type).boards++;
  }

  const tasks = targets.map(company => async () => {
    const { type, url } = company._api;
    try {
      const jobs = type === 'workday'
        ? await fetchWorkdayJobs(company._api, company.name)
        : type === 'smartrecruiters'
          ? await fetchSmartRecruitersJobs(company._api, company.name)
          : PARSERS[type](await fetchJson(url), company.name);
      totalFound += jobs.length;
      providerStats.get(type).jobs += jobs.length;
      if (type === 'workday' || type === 'smartrecruiters') console.log(`${type} board: ${company.name} — ${jobs.length} jobs returned`);

      for (const job of jobs) {
        // Priority-company discovery is intentionally high recall: generic titles
        // may hide supply-chain/systems relevance that is only visible in the JD.
        // General-universe jobs still use the cheap title gate.
        // Hard negatives are universal and run before the permissive Priority Company title bypass.
        if (levelHardNegative(job.title)) {
          totalFilteredLevel++;
          continue;
        }
        if (!isPriorityCompany(job.company) && !titleFilter(job.title)) {
          totalFilteredTitle++;
          continue;
        }
        if (!locationFilter(job.location)) {
          totalFilteredLocation++;
          continue;
        }
        if (processedJobKeys.has(jobKey(job))) {
          totalDupes++;
          continue;
        }
        if (seenUrls.has(job.url)) {
          totalDupes++;
          continue;
        }
        const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
        if (seenCompanyRoles.has(key)) {
          totalDupes++;
          continue;
        }
        // Mark as seen to avoid intra-scan dupes
        seenUrls.add(job.url);
        seenCompanyRoles.add(key);
        newOffers.push({ ...job, source: `${type}-api` });
        providerStats.get(type).candidates++;
      }
    } catch (err) {
      providerStats.get(type).errors++;
      errors.push({ company: company.name, error: err.message });
    }
  });

  await parallelFetch(tasks, CONCURRENCY);

  // 4b. Rank cheap listing candidates before any expensive full-JD fetch.
  // Fetch Priority decides WHAT TO READ FIRST; it must never affect Selena Fit.
  function fetchPriority(o) {
    const title=(o.title||'').toLowerCase(), loc=(o.location||'').toLowerCase(), company=(o.company||'').toLowerCase();
    let score=0; const reasons=[];
    const add=(n,r)=>{score+=n;reasons.push(r);};
    if (/(supply chain|warehouse|wms|logistics|inventory|fulfillment|distribution)/.test(title)) add(35,'supply-chain-title');
    if (/(product owner|product manager|program manager|project manager|business systems analyst|business analyst|systems analyst|implementation|transformation)/.test(title)) add(30,'target-role-title');
    if (/(systems|system|technology|technical|platform|integration|erp|tms|planning|analytics|business intelligence)/.test(title)) add(20,'systems-title');
    if (/(austin|cedar park|round rock|texas|remote|united states|usa|u\.s\.)/.test(loc)) add(15,'preferred-location');
    if (/(intern|internship|principal|vp|vice president|director|chief|staff engineer)/.test(title)) {score-=25;reasons.push('seniority-risk');}
    // Configured priority-company listings get read earlier, but this never changes Fit.
    if (isPriorityCompany(company)) add(10,'priority-company');
    return {score:Math.max(0,Math.min(100,score)),reasons};
  }
  const rankedOffers=newOffers.map(o=>{const p=fetchPriority(o);return {...o,fetch_priority:p.score,fetch_priority_reasons:p.reasons};})
    .sort((a,b)=>b.fetch_priority-a.fetch_priority||a.company.localeCompare(b.company)||a.title.localeCompare(b.title));
  // One discovery round contributes at most 300 promising listings.
  // Expensive downstream work should consume this pool in 50-job batches and stop
  // as soon as the qualified pool reaches 30. If it does not, start another
  // discovery round, excluding already-seen/processed jobs.
  const POTENTIAL_POOL_SIZE=300;
  const FETCH_BATCH_SIZE=50;
  const QUALIFIED_TARGET=30;
  const potentialPool=rankedOffers.slice(0,POTENTIAL_POOL_SIZE);
  const deferredOffers=rankedOffers.slice(POTENTIAL_POOL_SIZE);
  const fetchQueue=potentialPool.map((o,i)=>({...o,fetch_batch:Math.floor(i/FETCH_BATCH_SIZE)+1,fetch_rank:i+1}));


  // 4c. Persist source-level discovery evidence for the entire priority registry.
  // Companies without evidence remain pending; this file is a run result, while
  // priority-companies-expanded.yml remains the single source of truth.
  const priorityDiscovery = new Map(priorityRegistry.map(x => [x.name, {
    company: x.name,
    group: x.group || null,
    sources: {
      official_ats: { status: 'pending', jobs_discovered: 0 },
      official_careers: { status: 'pending', jobs_discovered: 0 },
      linkedin: { status: 'pending', jobs_discovered: 0 },
      indeed: { status: 'pending', jobs_discovered: 0 },
      jobright_aggregator: { status: 'pending', jobs_discovered: 0 },
      public_web: { status: 'pending', jobs_discovered: 0 }
    }
  }]));
  for (const o of newOffers) {
    const canonical = priorityNameMap.get(normalizeCompany(o.company));
    if (!canonical) continue;
    const row = priorityDiscovery.get(canonical);
    row.sources.official_ats.status = 'discovered';
    row.sources.official_ats.jobs_discovered++;
  }
  const attemptedPriority = new Set(targets.filter(t => isPriorityCompany(t.name)).map(t => priorityNameMap.get(normalizeCompany(t.name))));
  for (const canonical of attemptedPriority) {
    const row = priorityDiscovery.get(canonical);
    if (row && row.sources.official_ats.status === 'pending') row.sources.official_ats.status = 'attempted_no_new_candidates';
  }
  if (!dryRun) writeFileSync(DISCOVERY_RESULTS_PATH, JSON.stringify({
    generated_at: new Date().toISOString(),
    priority_company_count: priorityRegistry.length,
    discovery_model: 'parallel_union',
    note: 'This run records operational source evidence only; pending sources have not yet been queried by dedicated connectors.',
    companies: [...priorityDiscovery.values()]
  }, null, 2) + '\n', 'utf-8');

  // 5. Write results
  if (!dryRun && newOffers.length > 0) {
    const batchId = new Date().toISOString().replace(/[:.]/g, '-');
    const batchRows = fetchQueue.map(o => ({ ...o, batch_id: batchId, discovered_at: new Date().toISOString(), stage: 'listing_candidate', jd_fetch_status: 'not_fetched', full_jd_verified: false }));
    writeFileSync(LATEST_CANDIDATES_PATH, batchRows.map(x => JSON.stringify(x)).join('\n') + '\n', 'utf-8');
    appendToPipeline(fetchQueue);
    appendToScanHistory(fetchQueue, date);
    console.log(`Candidate batch:       ${batchId} (${batchRows.length} jobs) -> ${LATEST_CANDIDATES_PATH}`);
  }

  // 6. Print summary
  console.log(`\n${'━'.repeat(45)}`);
  console.log(`Portal Scan — ${date}`);
  console.log(`${'━'.repeat(45)}`);
  console.log(`API boards attempted:   ${targets.length}`);
  console.log(`Websearch pending:      ${websearchPending.length} (not scanned)`);
  console.log(`Unconfigured boards:    ${unsupported.length}`);
  console.log(`Total jobs found:      ${totalFound}`);
  console.log(`Filtered by title:     ${totalFilteredTitle} removed`);
  console.log(`Filtered by location:  ${totalFilteredLocation} removed`);
  console.log(`Duplicates:            ${totalDupes} skipped`);
  console.log(`Listing candidates:    ${newOffers.length}`);
  console.log(`Potential pool:         ${fetchQueue.length} / ${POTENTIAL_POOL_SIZE}`);
  console.log(`Deferred this round:    ${deferredOffers.length}`);
  console.log(`Fetch batches (50):     ${Math.ceil(fetchQueue.length / FETCH_BATCH_SIZE)}`);
  console.log(`Qualified stop target:  ${QUALIFIED_TARGET}`);
  if (fetchQueue.length) console.log(`Top fetch priority:     ${fetchQueue[0].fetch_priority} — ${fetchQueue[0].company} | ${fetchQueue[0].title}`);
  console.log('Provider breakdown (boards / jobs / JD candidates / errors):');
  for (const [provider, stats] of [...providerStats.entries()].sort()) {
    console.log(`  ${provider}: ${stats.boards} / ${stats.jobs} / ${stats.candidates} / ${stats.errors}`);
  }

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  ✗ ${e.company}: ${e.error}`);
    }
  }

  if (newOffers.length > 0) {
    console.log('\nTop listing candidates by Fetch Priority:');
    for (const o of fetchQueue.slice(0,50)) {
      console.log(`  + P${o.fetch_priority} B${o.fetch_batch} #${o.fetch_rank} | ${o.company} | ${o.title} | ${o.location || 'N/A'}`);
    }
    if (dryRun) {
      console.log('\n(dry run — run without --dry-run to save results)');
    } else {
      console.log(`\nResults saved to ${PIPELINE_PATH} and ${SCAN_HISTORY_PATH}`);
    }
  }

  console.log(`\n→ Run /career-ops pipeline to evaluate new offers.`);
  console.log('→ Share results and get help: https://discord.gg/8pRpHETxa4');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
