#!/usr/bin/env node

/**
 * Merge semantic-review results into Selena's JD queue and enforce the score
 * contract. Intended flow:
 * discovery -> full JD -> semantic review -> this script -> 9+ inventory.
 *
 * Review input is JSONL at data/selena-semantic-scores.jsonl by default.
 * Each row must identify a URL and contain semantic_score plus the semantic
 * gate fields documented in config/selena-score-rubric.yml.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { applySelenaScoreContract } from './selena-score-contract.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const QUEUE = process.env.SELENA_JD_QUEUE || path.join(ROOT, 'data/selena-jd-candidates.jsonl');
const REVIEWS = process.env.SELENA_SEMANTIC_SCORES || path.join(ROOT, 'data/selena-semantic-scores.jsonl');
const OUT = process.env.SELENA_SCORED_RESULTS || path.join(ROOT, 'data/selena-scored-results.jsonl');

function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8').split(/\r?\n/).filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}
function writeJsonl(file, rows) {
  writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf-8');
}

const queue = readJsonl(QUEUE);
const reviews = readJsonl(REVIEWS);
const reviewByUrl = new Map(reviews.filter(r => r?.url).map(r => [r.url, r]));
const scored = [];
let highFit = 0, review = 0, notHighFit = 0, needsFullJd = 0, excluded = 0;

for (let i = 0; i < queue.length; i++) {
  const row = queue[i];
  const semantic = reviewByUrl.get(row.url);
  if (!semantic) continue;

  const result = applySelenaScoreContract({
    ...semantic,
    full_jd_read: row.jd_status === 'read',
    jd_chars: row.jd_chars,
    application_status: semantic.application_status || row.application_status || null,
  });

  const merged = {
    company: row.company,
    title: row.title,
    url: row.url,
    location: row.location || null,
    semantic_score: semantic.semantic_score ?? null,
    ...result,
    reviewed_at: semantic.reviewed_at || new Date().toISOString(),
    review_reason: semantic.review_reason || null,
  };
  scored.push(merged);

  queue[i] = {
    ...row,
    semantic_review_status: result.disposition,
    semantic_score: semantic.semantic_score ?? null,
    final_fit_score: result.final_fit_score,
    high_fit_eligible: result.high_fit_eligible,
    score_cap_reason: result.cap_reason,
  };

  if (result.disposition === 'high_fit') highFit++;
  else if (result.disposition === 'review') review++;
  else if (result.disposition === 'needs_full_jd') needsFullJd++;
  else if (result.disposition === 'exclude') excluded++;
  else notHighFit++;
}

writeJsonl(QUEUE, queue);
writeJsonl(OUT, scored);
console.log(JSON.stringify({
  semantic_reviews_supplied: reviews.length,
  matched_to_queue: scored.length,
  final_fit_9_plus: highFit,
  review_8_to_8_9: review,
  below_8: notHighFit,
  needs_full_jd: needsFullJd,
  excluded,
}, null, 2));
