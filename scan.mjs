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
      return ['greenhouse', 'lever', 'ashby'].flatMap(provider =>
        (data.providers?.[provider]?.live || []).map(([slug]) => ({ provider, slug, name: slug }))
      );
    } },
  ];
  const combined = new Map();
  let baselineCount = 0;
  for (const source of sources) {
    try {
      const response = await fetch(source.url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = source.parse(await response.text());
      let added = 0;
      for (const r of rows) {
        if (!['ashby','greenhouse','lever'].includes(r.provider) || !/^[a-z0-9_.-]+$/i.test(r.slug || '')) continue;
        const key = `${r.provider}:${r.slug.toLowerCase()}`;
        if (!combined.has(key)) { combined.set(key, r); added++; }
      }
      console.log(`ATS source ${source.name}: ${rows.length} entries; ${added} new unique boards`);
      if (source.name === 'lastroundai') baselineCount = combined.size;
    } catch (error) {
      console.error(`ATS source ${source.name} unavailable: ${error.message}`);
    }
  }
  // Keep the original two-source ordering intact so an existing cursor never skips
  // or repeats baseline boards when a new directory source is added.
  const compareBoards = (a,b) => (a.provider + ':' + a.slug).localeCompare(b.provider + ':' + b.slug);
  const allBoards = [...combined.values()];
  const valid = [
    ...allBoards.slice(0, baselineCount).sort(compareBoards),
    ...allBoards.slice(baselineCount).sort(compareBoards),
  ];
  if (!valid.length) throw new Error('No ATS directory sources loaded successfully');
  let cursor = 0;
  if (existsSync(UNIVERSE_CURSOR_PATH)) {
    try {
      const saved = JSON.parse(readFileSync(UNIVERSE_CURSOR_PATH, 'utf-8'));
      if (Number.isInteger(saved.next_index) && saved.next_index >= 0) cursor = saved.next_index % valid.length;
    } catch (error) {
      console.error(`ATS cursor unreadable: ${error.message}; restarting at index 0`);
    }
  }
  const batchSize = Math.min(requested, valid.length);
  const batch = Array.from({length: batchSize}, (_, i) => valid[(cursor + i) % valid.length]);
  const nextIndex = (cursor + batchSize) % valid.length;
  writeFileSync(UNIVERSE_CURSOR_PATH, JSON.stringify({
    next_index: nextIndex,
    universe_size: valid.length,
    batch_size: batchSize,
    last_start_index: cursor,
    updated_at: new Date().toISOString()
  }, null, 2) + '\n', 'utf-8');
  console.log(`ATS universe: ${valid.length} unique directory boards; scanning indices ${cursor}..${(cursor + batchSize - 1) % valid.length}; next cursor ${nextIndex}`);
  return batch.map(r => ({name: r.name || r.slug, careers_url: r.provider === 'ashby' ? `https://jobs.ashbyhq.com/${r.slug}` : r.provider === 'lever' ? `https://jobs.lever.co/${r.slug}` : `https://job-boards.greenhouse.io/${r.slug}`, scan_method: r.provider, enabled: true}));
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

const PARSERS = { greenhouse: parseGreenhouse, ashby: parseAshby, lever: parseLever };

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
  const positive = (titleFilter?.positive || []).map(k => k.toLowerCase());
  const negative = (titleFilter?.negative || []).map(k => k.toLowerCase());

  return (title) => {
    const lower = title.toLowerCase();
    const hasPositive = positive.length === 0 || positive.some(k => lower.includes(k));
    const hasNegative = negative.some(k => lower.includes(k));
    return hasPositive && !hasNegative;
  };
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
  const priorityCompanies = config.tracked_companies || [];
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

  // 4. Fetch all APIs
  const date = new Date().toISOString().slice(0, 10);
  let totalFound = 0;
  let totalFilteredTitle = 0;
  let totalFilteredLocation = 0;
  let totalDupes = 0;
  const newOffers = [];
  const errors = [];

  const tasks = targets.map(company => async () => {
    const { type, url } = company._api;
    try {
      const json = await fetchJson(url);
      const jobs = PARSERS[type](json, company.name);
      totalFound += jobs.length;

      for (const job of jobs) {
        if (!titleFilter(job.title)) {
          totalFilteredTitle++;
          continue;
        }
        if (!locationFilter(job.location)) {
          totalFilteredLocation++;
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
      }
    } catch (err) {
      errors.push({ company: company.name, error: err.message });
    }
  });

  await parallelFetch(tasks, CONCURRENCY);

  // 5. Write results
  if (!dryRun && newOffers.length > 0) {
    appendToPipeline(newOffers);
    appendToScanHistory(newOffers, date);
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
  console.log(`New offers added:      ${newOffers.length}`);

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  ✗ ${e.company}: ${e.error}`);
    }
  }

  if (newOffers.length > 0) {
    console.log('\nNew offers:');
    for (const o of newOffers) {
      console.log(`  + ${o.company} | ${o.title} | ${o.location || 'N/A'}`);
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
