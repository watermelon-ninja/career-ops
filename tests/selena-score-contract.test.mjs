import assert from 'node:assert/strict';
import { applySelenaScoreContract } from '../selena-score-contract.mjs';

const base = {
  full_jd_read: true,
  jd_chars: 5000,
  semantic_score: 9.4,
  location_eligible: true,
  sponsorship_required: false,
  materially_unmet_mandatory_years: false,
  primary_frontline_operations: false,
  primary_people_management_without_direct_fit: false,
  primary_work_mode_direct_fit: true,
  fundamental_gap: false,
};

assert.deepEqual(applySelenaScoreContract(base), {
  final_fit_score: 9.4,
  high_fit_eligible: true,
  disposition: 'high_fit',
  cap_reason: null,
});

const noJd = applySelenaScoreContract({ ...base, full_jd_read: false, jd_chars: 0 });
assert.equal(noJd.final_fit_score, null);
assert.equal(noJd.disposition, 'needs_full_jd');

const ops = applySelenaScoreContract({ ...base, primary_frontline_operations: true });
assert.equal(ops.final_fit_score, 8.9);
assert.equal(ops.high_fit_eligible, false);

const lowComp = applySelenaScoreContract({ ...base, disclosed_max_base_usd: 105000 });
assert.equal(lowComp.final_fit_score, 8.9);
assert.equal(lowComp.high_fit_eligible, false);

const adjacent = applySelenaScoreContract({ ...base, primary_work_mode_direct_fit: false });
assert.equal(adjacent.final_fit_score, 8.9);
assert.equal(adjacent.high_fit_eligible, false);

const applied = applySelenaScoreContract({ ...base, application_status: 'applied' });
assert.equal(applied.disposition, 'exclude');
assert.equal(applied.high_fit_eligible, false);

console.log('Selena score contract tests passed');
