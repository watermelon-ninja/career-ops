#!/usr/bin/env node

/**
 * selena-scan.mjs
 *
 * Selena target-company orchestration layer on top of upstream Career-Ops.
 * The upstream provider/scanner remains the discovery engine. This wrapper:
 *   1) drives the explicit 354-company universe,
 *   2) optionally resolves ATS mappings through discover-ats.mjs,
 *   3) scans EXACTLY one company at a time (no substring --company matching),
 *   4) uses the target lane's negative-only title gate,
 *   5) persists per-company coverage and a full-JD review queue.
 *
 * Examples:
 *   node selena-scan.mjs --start 1 --end 45 --resolve
 *   node selena-scan.mjs --company "Google" --resolve
 *   node selena-scan.mjs --start 46 --end 90
 */

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import * as yaml from 'js-yaml';

const CODE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const TARGETS_PATH = process.env.SELENA_TARGET_COMPANIES
  || path.join(CODE_ROOT, 'config/selena-target-companies.yml');
const PORTALS_PATH = process.env.SELENA_TARGET_PORTALS
  || path.join(CODE_ROOT, 'config/selena-target-portals.yml');
const RELOCATION_PORTALS_PATH = process.env.SELENA_RELOCATION_PORTALS
  || path.join(CODE_ROOT, 'config/selena-relocation-portals.yml');
// Nationwide relocation is enabled only where the source adapter can bound the
// search honestly. Google has query-scoped nationwide discovery; Apple and
// Microsoft remain pending dedicated nationwide adapters.
const RELOCATION_COMPANIES = new Set(['google']);
const LEDGER_PATH = process.env.SELENA_COVERAGE_LEDGER
  || path.join(CODE_ROOT, 'data/selena-company-coverage.json');
const JD_QUEUE_PATH = process.env.SELENA_JD_QUEUE
  || path.join(CODE_ROOT, 'data/selena-jd-candidates.jsonl');
const TMP_DIR = path.join(CODE_ROOT, 'data/.selena-scan');

function parseArgs(argv) {
  const out = { resolve: false, start: null, end: null, company: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--resolve') out.resolve = true;
    else if (arg === '--start') out.start = Number(argv[++i]);
    else if (arg === '--end') out.end = Number(argv[++i]);
    else if (arg === '--company') out.company = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node selena-scan.mjs [--start N --end N | --company NAME] [--resolve]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function runNode(script, args, env = {}) {
  const result = spawnSync(process.execPath, [path.join(CODE_ROOT, script), ...args], {
    cwd: CODE_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error?.message || null,
  };
}

function lastJsonObject(text) {
  const lines = String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith('{')) continue;
    try { return JSON.parse(lines[i]); } catch { /* keep walking */ }
  }
  return null;
}

function readYaml(file) {
  return yaml.load(readFileSync(file, 'utf-8')) || {};
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function selectCompanies(all, opts) {
  if (opts.company) {
    const exact = all.filter(c => normalizeName(c?.name) === normalizeName(opts.company));
    if (exact.length !== 1) throw new Error(`Expected exactly one target company named "${opts.company}", found ${exact.length}`);
    return exact.map(c => ({ ...c, _index: all.indexOf(c) + 1 }));
  }
  const start = Number.isInteger(opts.start) && opts.start > 0 ? opts.start : 1;
  const end = Number.isInteger(opts.end) && opts.end > 0 ? opts.end : all.length;
  if (start > end || end > all.length) throw new Error(`Invalid range ${start}-${end}; target universe has ${all.length} companies`);
  return all.slice(start - 1, end).map((c, i) => ({ ...c, _index: start + i }));
}

function initialLedger(all) {
  return {
    schema_version: 2,
    purpose: 'Authoritative Selena target-company exhaustive coverage ledger',
    generated_at: null,
    run_id: null,
    companies_total: all.length,
    companies: all.map((c, i) => ({
      index: i + 1,
      name: c.name,
      group: c.group || null,
      status: 'pending',
      last_checked_at: null,
      postings_discovered: 0,
      filtered_title_negative: 0,
      filtered_location: 0,
      candidates_for_full_jd: 0,
      relocation_candidates: 0,
      remote_candidates: 0,
      full_jds_read: 0,
      full_jds_failed: 0,
      candidates_remaining_unread: 0,
      blocker: null,
    })),
    summary: {},
  };
}

function loadLedger(all) {
  if (!existsSync(LEDGER_PATH)) return initialLedger(all);
  try {
    const parsed = JSON.parse(readFileSync(LEDGER_PATH, 'utf-8'));
    const byName = new Map((parsed.companies || []).map(c => [normalizeName(c.name), c]));
    const fresh = initialLedger(all);
    fresh.generated_at = parsed.generated_at || null;
    fresh.run_id = parsed.run_id || null;
    fresh.companies = fresh.companies.map(c => ({ ...c, ...(byName.get(normalizeName(c.name)) || {}) }));
    return fresh;
  } catch {
    return initialLedger(all);
  }
}

function summarize(ledger) {
  const c = ledger.companies;
  const sum = (key) => c.reduce((n, row) => n + (Number(row[key]) || 0), 0);
  ledger.summary = {
    complete: c.filter(x => x.status === 'complete').length,
    partial: c.filter(x => x.status === 'partial').length,
    pending: c.filter(x => x.status === 'pending').length,
    blocked: c.filter(x => x.status === 'blocked').length,
    postings_discovered: sum('postings_discovered'),
    filtered_title_negative: sum('filtered_title_negative'),
    filtered_location: sum('filtered_location'),
    candidates_for_full_jd: sum('candidates_for_full_jd'),
    relocation_candidates: sum('relocation_candidates'),
    remote_candidates: sum('remote_candidates'),
    full_jds_read: sum('full_jds_read'),
    full_jds_failed: sum('full_jds_failed'),
    candidates_remaining_unread: sum('candidates_remaining_unread'),
  };
  return ledger;
}

function writeLedger(ledger) {
  mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  summarize(ledger);
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n', 'utf-8');
}

function loadQueue() {
  if (!existsSync(JD_QUEUE_PATH)) return [];
  return readFileSync(JD_QUEUE_PATH, 'utf-8').split(/\r?\n/).filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function writeQueue(rows) {
  mkdirSync(path.dirname(JD_QUEUE_PATH), { recursive: true });
  writeFileSync(JD_QUEUE_PATH, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf-8');
}

function upsertQueue(queue, offers, company, runId) {
  const byUrl = new Map(queue.map((row, i) => [row.url, i]));
  for (const offer of offers) {
    if (!offer?.url) continue;
    const next = {
      company,
      title: offer.title || null,
      url: offer.url,
      location: offer.location || null,
      posted_at: offer.postedAt || null,
      source: offer.source || null,
      discovered_at: new Date().toISOString(),
      run_id: runId,
      jd_status: 'pending',
    };
    const idx = byUrl.get(offer.url);
    if (idx == null) {
      byUrl.set(offer.url, queue.length);
      queue.push(next);
    } else if (queue[idx]?.jd_status !== 'read') {
      queue[idx] = { ...queue[idx], ...next, jd_status: queue[idx]?.jd_status || 'pending' };
    }
  }
  return queue;
}

function updateCompany(ledger, name, patch) {
  const row = ledger.companies.find(c => normalizeName(c.name) === normalizeName(name));
  if (!row) throw new Error(`Ledger row missing for ${name}`);
  Object.assign(row, patch);
}

function resolveSelected(selected) {
  mkdirSync(TMP_DIR, { recursive: true });
  const input = path.join(TMP_DIR, 'resolve-companies.yml');
  writeFileSync(input, yaml.dump({
    companies: selected.map(({ _index, ...c }) => c),
  }, { noRefs: true, lineWidth: 120 }), 'utf-8');

  const result = runNode('discover-ats.mjs', ['--in', input, '--write'], {
    CAREER_OPS_PORTALS: PORTALS_PATH,
  });
  const receipt = lastJsonObject(result.stdout);
  return { ...result, receipt };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const targetDoc = readYaml(TARGETS_PATH);
  const all = Array.isArray(targetDoc.companies) ? targetDoc.companies : [];
  if (!all.length) throw new Error(`No companies found in ${TARGETS_PATH}`);

  const expected = Number(targetDoc?.policy?.target_company_count || all.length);
  if (all.length !== expected) throw new Error(`Target-company contract says ${expected}, file contains ${all.length}`);

  const selected = selectCompanies(all, opts);
  const runId = `selena-target-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  let ledger = loadLedger(all);
  ledger.schema_version = 2;
  ledger.companies_total = all.length;
  ledger.generated_at = new Date().toISOString();
  ledger.run_id = runId;

  if (opts.resolve) {
    const resolved = resolveSelected(selected);
    if (resolved.status !== 0) {
      console.error(resolved.stderr || resolved.error || 'ATS resolution failed');
    }
  }

  const portalDoc = readYaml(PORTALS_PATH);
  const relocationPortalDoc = existsSync(RELOCATION_PORTALS_PATH) ? readYaml(RELOCATION_PORTALS_PATH) : {};
  const tracked = Array.isArray(portalDoc.tracked_companies) ? portalDoc.tracked_companies : [];
  const trackedByName = new Map(tracked.map(x => [normalizeName(x?.name), x]));
  let queue = loadQueue();

  mkdirSync(TMP_DIR, { recursive: true });

  for (const company of selected) {
    const now = new Date().toISOString();
    const entry = trackedByName.get(normalizeName(company.name));

    if (!entry) {
      updateCompany(ledger, company.name, {
        index: company._index,
        group: company.group || null,
        status: 'blocked',
        last_checked_at: now,
        blocker: 'unmapped_ats_or_official_provider',
        candidates_remaining_unread: 0,
      });
      writeLedger(ledger);
      console.log(`[${company._index}/${all.length}] ${company.name}: BLOCKED (no resolved ATS/provider mapping)`);
      continue;
    }

    // Exact one-company scope: avoids upstream --company substring matching
    // (e.g. "Box" also matching "Dropbox").
    const onePortal = {
      ...portalDoc,
      tracked_companies: [entry],
      job_boards: [],
    };
    const portalPath = path.join(TMP_DIR, `portal-${company._index}.yml`);
    writeFileSync(portalPath, yaml.dump(onePortal, { noRefs: true, lineWidth: 140 }), 'utf-8');

    const scan = runNode('scan.mjs', ['--dry-run', '--json', '--quiet'], {
      CAREER_OPS_PORTALS: portalPath,
    });
    const receipt = lastJsonObject(scan.stdout);

    // Google / Apple / Microsoft get a second, nationwide relocation pass.
    // It is intentionally broad-title-gated rather than exhaustive nationwide:
    // the local Austin/remote pass above is exhaustive, while this extension
    // prevents thousands of clearly unrelated US postings from consuming full-JD reads.
    let relocationReceipt = null;
    let relocationScan = null;
    if (RELOCATION_COMPANIES.has(normalizeName(company.name))) {
      const relocationEntry = normalizeName(company.name) === 'google'
        ? {
            ...entry,
            google: {
              ...(entry.google || {}),
              location: 'United States',
            },
          }
        : entry;
      const relocationOnePortal = {
        ...relocationPortalDoc,
        tracked_companies: [relocationEntry],
        job_boards: [],
      };
      const relocationPath = path.join(TMP_DIR, `portal-relocation-${company._index}.yml`);
      writeFileSync(relocationPath, yaml.dump(relocationOnePortal, { noRefs: true, lineWidth: 140 }), 'utf-8');
      relocationScan = runNode('scan.mjs', ['--dry-run', '--json', '--quiet'], {
        CAREER_OPS_PORTALS: relocationPath,
      });
      relocationReceipt = lastJsonObject(relocationScan.stdout);
    }

    // Amazon's local Austin inventory and US work-from-home inventory are
    // separate source scopes. The remote pass is intentionally provider-filtered
    // before Selena's location gate, then full-JD verification decides whether
    // Texas residence is actually eligible.
    let amazonRemoteReceipt = null;
    let amazonRemoteScan = null;
    if (normalizeName(company.name) === 'amazon') {
      const remoteEntry = {
        ...entry,
        amazon: {
          category_type: 'Work from Home',
          normalized_country_code: ['USA'],
        },
      };
      const remotePortal = {
        ...portalDoc,
        location_filter: {
          allow: ['Remote', 'Virtual'],
        },
        tracked_companies: [remoteEntry],
        job_boards: [],
      };
      const remotePath = path.join(TMP_DIR, `portal-amazon-remote-${company._index}.yml`);
      writeFileSync(remotePath, yaml.dump(remotePortal, { noRefs: true, lineWidth: 140 }), 'utf-8');
      amazonRemoteScan = runNode('scan.mjs', ['--dry-run', '--json', '--quiet'], {
        CAREER_OPS_PORTALS: remotePath,
      });
      amazonRemoteReceipt = lastJsonObject(amazonRemoteScan.stdout);
    }

    if (!receipt) {
      updateCompany(ledger, company.name, {
        index: company._index,
        group: company.group || null,
        status: 'partial',
        last_checked_at: now,
        blocker: scan.error || scan.stderr.trim().slice(0, 1000) || 'scanner_returned_no_json_receipt',
      });
      writeLedger(ledger);
      console.log(`[${company._index}/${all.length}] ${company.name}: PARTIAL (no scanner receipt)`);
      continue;
    }

    const localOffers = Array.isArray(receipt.offers) ? receipt.offers : [];
    const relocationOffers = Array.isArray(relocationReceipt?.offers) ? relocationReceipt.offers : [];
    const amazonRemoteOffers = Array.isArray(amazonRemoteReceipt?.offers) ? amazonRemoteReceipt.offers : [];
    const offersByUrl = new Map();
    for (const offer of [...localOffers, ...relocationOffers, ...amazonRemoteOffers]) {
      if (offer?.url) offersByUrl.set(offer.url, offer);
    }
    const offers = [...offersByUrl.values()];
    queue = upsertQueue(queue, offers, company.name, runId);
    writeQueue(queue);

    const errors = [
      ...(Array.isArray(receipt.errors) ? receipt.errors : []),
      ...(Array.isArray(relocationReceipt?.errors) ? relocationReceipt.errors : []),
      ...(Array.isArray(amazonRemoteReceipt?.errors) ? amazonRemoteReceipt.errors : []),
    ];
    const relocationFailed = RELOCATION_COMPANIES.has(normalizeName(company.name))
      && (!relocationReceipt || relocationScan?.status !== 0);
    const amazonRemoteFailed = normalizeName(company.name) === 'amazon'
      && (!amazonRemoteReceipt || amazonRemoteScan?.status !== 0);
    const amazonProviderCapped = normalizeName(company.name) === 'amazon'
      && (
        Number(receipt?.found || 0) >= 2000
        || Number(amazonRemoteReceipt?.found || 0) >= 2000
      );
    const sourceTruncated = /truncated|stopped early/i.test(
      [scan.stderr, relocationScan?.stderr, amazonRemoteScan?.stderr].filter(Boolean).join('\n')
    );
    // Upstream's Google provider is deliberately first-page-per-query because
    // Google robots.txt disallows paginated result URLs. Treat that as PARTIAL,
    // never as exhaustive COMPLETE, even when every configured query succeeds.
    const boundedProvider = normalizeName(company.name) === 'google'
      || normalizeName(company.name) === 'apple';
    const status = errors.length || scan.status !== 0 || relocationFailed || amazonRemoteFailed || amazonProviderCapped || sourceTruncated || boundedProvider
      ? 'partial'
      : 'complete';
    updateCompany(ledger, company.name, {
      index: company._index,
      group: company.group || null,
      status,
      last_checked_at: now,
      postings_discovered: Math.max(Number(receipt.found || 0), Number(relocationReceipt?.found || 0))
        + Number(amazonRemoteReceipt?.found || 0),
      filtered_title_negative: Number(receipt.filtered_by?.title || 0),
      filtered_location: Number(receipt.filtered_by?.location || 0),
      candidates_for_full_jd: offers.length,
      relocation_candidates: relocationOffers.length,
      remote_candidates: amazonRemoteOffers.length,
      candidates_remaining_unread: offers.length,
      blocker: status === 'partial'
        ? (
            boundedProvider
              ? (
                  normalizeName(company.name) === 'google'
                    ? 'google_provider_bounded_first_page_per_query'
                    : 'apple_provider_bounded_pagination_requires_coverage_confirmation'
                )
              : amazonProviderCapped
                ? 'amazon_provider_hit_2000_posting_safety_cap'
                : sourceTruncated
                  ? 'provider_reported_truncated_or_rate_limited_inventory'
                  : errors.map(e => e.error || String(e)).join('; ')
                  || scan.stderr.trim().slice(0, 1000)
                  || (amazonRemoteFailed ? 'amazon_remote_provider_failed' : `scanner_exit_${scan.status}`)
          )
        : null,
    });
    writeLedger(ledger);

    console.log(
      `[${company._index}/${all.length}] ${company.name}: ${status.toUpperCase()} | raw=${Math.max(Number(receipt.found || 0), Number(relocationReceipt?.found || 0))} | title-=${receipt.filtered_by?.title || 0} | location-=${receipt.filtered_by?.location || 0} | relocation=${relocationOffers.length} | JD queue=${offers.length}`
    );
  }

  ledger = loadLedger(all);
  ledger.generated_at = new Date().toISOString();
  ledger.run_id = runId;
  writeLedger(ledger);

  console.log(JSON.stringify({
    run_id: runId,
    range: selected.length ? [selected[0]._index, selected[selected.length - 1]._index] : null,
    companies_selected: selected.length,
    companies_total: all.length,
    summary: ledger.summary,
    jd_queue_rows: loadQueue().length,
    stop_reason: ledger.summary.pending === 0
      ? (ledger.summary.candidates_remaining_unread === 0 ? 'coverage_complete_and_jd_queue_empty' : 'company_coverage_complete_jd_review_pending')
      : 'company_coverage_remaining',
  }, null, 2));
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
