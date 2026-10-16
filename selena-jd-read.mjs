#!/usr/bin/env node

/**
 * selena-jd-read.mjs
 *
 * Reads every pending Selena candidate's substantive JD with upstream
 * browser-extract.mjs. No fit score is assigned here: extraction and semantic
 * evaluation remain separate stages so a keyword heuristic cannot masquerade
 * as a 9/10 recommendation.
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const QUEUE = process.env.SELENA_JD_QUEUE || path.join(ROOT, 'data/selena-jd-candidates.jsonl');
const RESULTS = process.env.SELENA_JD_RESULTS || path.join(ROOT, 'data/selena-jd-read-results.jsonl');
const LEDGER = process.env.SELENA_COVERAGE_LEDGER || path.join(ROOT, 'data/selena-company-coverage.json');

function args(argv) {
  const out = { limit: Infinity, company: null, retryFailed: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') out.limit = Number(argv[++i]);
    else if (argv[i] === '--company') out.company = argv[++i];
    else if (argv[i] === '--retry-failed') out.retryFailed = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: node selena-jd-read.mjs [--limit N] [--company NAME] [--retry-failed]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return out;
}

const norm = s => String(s || '').trim().toLowerCase();

function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8').split(/\r?\n/).filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function writeJsonl(file, rows) {
  writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf-8');
}

function extract(url) {
  const r = spawnSync(process.execPath, [
    path.join(ROOT, 'browser-extract.mjs'),
    url,
    '--mode', 'jd',
    '--max-chars', '60000',
    '--timeout', '20000',
  ], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf-8',
    maxBuffer: 8 * 1024 * 1024,
  });
  let payload = null;
  try { payload = JSON.parse((r.stdout || '').trim()); } catch { /* handled below */ }
  return { status: r.status ?? 1, payload, stderr: r.stderr || '', error: r.error?.message || null };
}

function updateLedger(queue) {
  if (!existsSync(LEDGER)) return;
  let ledger;
  try { ledger = JSON.parse(readFileSync(LEDGER, 'utf-8')); } catch { return; }

  for (const company of ledger.companies || []) {
    const rows = queue.filter(q => norm(q.company) === norm(company.name));
    company.full_jds_read = rows.filter(q => q.jd_status === 'read').length;
    company.full_jds_failed = rows.filter(q => q.jd_status === 'failed').length;
    company.candidates_remaining_unread = rows.filter(q => q.jd_status === 'pending').length;
  }
  const companies = ledger.companies || [];
  const sum = key => companies.reduce((n, c) => n + (Number(c[key]) || 0), 0);
  ledger.generated_at = new Date().toISOString();
  ledger.summary = {
    ...(ledger.summary || {}),
    full_jds_read: sum('full_jds_read'),
    full_jds_failed: sum('full_jds_failed'),
    candidates_remaining_unread: sum('candidates_remaining_unread'),
  };
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n', 'utf-8');
}

async function main() {
  const opt = args(process.argv.slice(2));
  const queue = readJsonl(QUEUE);
  const results = readJsonl(RESULTS);
  const resultByUrl = new Map(results.map((r, i) => [r.url, i]));

  const eligible = queue
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => (!opt.company || norm(row.company) === norm(opt.company)))
    .filter(({ row }) => row.jd_status === 'pending' || (opt.retryFailed && row.jd_status === 'failed'))
    .slice(0, Number.isFinite(opt.limit) ? opt.limit : undefined);

  let read = 0;
  let failed = 0;

  for (const { row, index } of eligible) {
    const at = new Date().toISOString();
    const r = extract(row.url);
    const text = typeof r.payload?.text === 'string' ? r.payload.text.trim() : '';
    const ok = r.status === 0 && text.length >= 200;

    const result = {
      company: row.company,
      title: row.title,
      url: row.url,
      location: row.location || null,
      read_at: at,
      jd_status: ok ? 'read' : 'failed',
      jd_chars: text.length,
      extracted_title: r.payload?.title || null,
      final_url: r.payload?.url || row.url,
      jd_text: ok ? text : null,
      error: ok ? null : (r.payload?.error || r.error || r.stderr.trim().slice(0, 2000) || `extract_exit_${r.status}`),
    };

    const existing = resultByUrl.get(row.url);
    if (existing == null) {
      resultByUrl.set(row.url, results.length);
      results.push(result);
    } else {
      results[existing] = result;
    }

    queue[index] = {
      ...row,
      jd_status: result.jd_status,
      jd_read_at: at,
      jd_chars: result.jd_chars,
      jd_error: result.error,
      semantic_review_status: ok ? (row.semantic_review_status || 'pending') : 'blocked_jd',
    };

    if (ok) read++; else failed++;
    writeJsonl(QUEUE, queue);
    writeJsonl(RESULTS, results);
    updateLedger(queue);
    console.log(`${ok ? 'READ' : 'FAILED'} | ${row.company} | ${row.title} | chars=${text.length}`);
  }

  updateLedger(queue);
  const remaining = queue.filter(q => q.jd_status === 'pending').length;
  console.log(JSON.stringify({
    attempted: eligible.length,
    read,
    failed,
    candidates_remaining_unread: remaining,
    semantic_review_pending: queue.filter(q => q.semantic_review_status === 'pending').length,
  }, null, 2));
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
