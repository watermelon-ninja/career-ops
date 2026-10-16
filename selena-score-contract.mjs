#!/usr/bin/env node

/**
 * Selena score-contract enforcement.
 *
 * This does NOT invent a fit score from keywords. An AI/human semantic reviewer
 * supplies the holistic 0-10 score after reading the substantive JD. This layer
 * only enforces Selena's non-negotiable gates and the >=9 high-fit contract.
 */

export const HIGH_FIT_THRESHOLD = 9.0;
export const BLOCKING_STATUSES = new Set(['applied', 'closed', 'excluded', 'paused']);

const bool = (v) => v === true;
const num = (v) => Number.isFinite(Number(v)) ? Number(v) : null;

export function applySelenaScoreContract(input = {}) {
  const semantic = num(input.semantic_score);
  const jdChars = num(input.jd_chars) || 0;
  const fullJd = bool(input.full_jd_read) && jdChars >= 200;

  if (!fullJd) {
    return {
      final_fit_score: null,
      high_fit_eligible: false,
      disposition: 'needs_full_jd',
      cap_reason: 'full_jd_missing',
    };
  }

  if (BLOCKING_STATUSES.has(String(input.application_status || '').trim().toLowerCase())) {
    return {
      final_fit_score: semantic,
      high_fit_eligible: false,
      disposition: 'exclude',
      cap_reason: 'already_applied_closed_excluded_or_paused',
    };
  }

  if (semantic == null || semantic < 0 || semantic > 10) {
    return {
      final_fit_score: null,
      high_fit_eligible: false,
      disposition: 'needs_semantic_score',
      cap_reason: 'invalid_or_missing_semantic_score',
    };
  }

  const caps = [];
  if (input.location_eligible === false) caps.push('location_ineligible');
  if (bool(input.sponsorship_required)) caps.push('sponsorship_required');
  if (bool(input.materially_unmet_mandatory_years)) caps.push('materially_unmet_mandatory_years');
  if (bool(input.primary_frontline_operations)) caps.push('primary_frontline_operations');
  if (bool(input.primary_people_management_without_direct_fit)) caps.push('primary_people_management_without_direct_fit');

  const salaryMax = num(input.disclosed_max_base_usd);
  if (salaryMax != null && salaryMax < 110000) caps.push('disclosed_max_base_below_110k');

  // A role cannot be 9+ unless its center of gravity directly maps to the
  // demonstrated systems/product/program background. This is semantic input,
  // not title/keyword matching.
  if (input.primary_work_mode_direct_fit === false) caps.push('primary_work_mode_not_direct_fit');
  if (bool(input.fundamental_gap)) caps.push('fundamental_gap');

  const final = caps.length ? Math.min(semantic, 8.9) : semantic;
  const highFit = final >= HIGH_FIT_THRESHOLD;

  return {
    final_fit_score: Math.round(final * 10) / 10,
    high_fit_eligible: highFit,
    disposition: highFit ? 'high_fit' : (final >= 8 ? 'review' : 'not_high_fit'),
    cap_reason: caps.length ? caps.join(';') : null,
  };
}
