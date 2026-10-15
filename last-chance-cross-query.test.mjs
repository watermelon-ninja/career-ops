import test from 'node:test';
import assert from 'node:assert/strict';
import { TARGET, buildQueries, countQualifyingFits, createPlan } from './last-chance-cross-query.mjs';

const qualifying = (overrides = {}) => ({
  company: 'IBM', title: 'Product Manager, Supply Chain', location: 'Austin, TX',
  url: 'https://careers.ibm.com/job/129886', job_id: '129886', selena_fit_score: 9.2,
  core_work_mode_gate: 'pass', full_jd_verified: true, review_status: 'pending_human_ai_review',
  ...overrides
});

test('reaches target only with unique, full-JD 9+ Core Work Mode passes', () => {
  const rows = [
    qualifying(),
    qualifying({ url: 'https://www.linkedin.com/jobs/view/123', job_id: '129886' }), // same requisition, different source URL
    qualifying({ job_id: '129885', url: 'https://careers.ibm.com/job/129885' }), // same title, different requisition
    qualifying({ job_id: '129884', selena_fit_score: 8.9 }),
    qualifying({ job_id: '129883', full_jd_verified: false }),
    qualifying({ job_id: '129882', core_work_mode_gate: 'fail' }),
    qualifying({ job_id: '129881', review_status: 'rejected' })
  ];
  assert.equal(countQualifyingFits(rows), 2);
});

test('does not make a search plan before a current-run fit summary exists', () => {
  const plan = createPlan({ summary: null, companies: ['IBM'], generatedAt: '2026-10-15T00:00:00Z' });
  assert.equal(plan.status, 'blocked_not_scored');
  assert.equal(plan.queries.length, 0);
});

test('suppresses catch-up queries after the 30-job target is met', () => {
  const plan = createPlan({ summary: { new_strong_apply: TARGET }, companies: ['IBM'] });
  assert.equal(plan.status, 'target_met');
  assert.equal(plan.shortfall, 0);
  assert.equal(plan.queries.length, 0);
});

test('uses company x focused role/domain families for all priority companies', () => {
  const companies = Array.from({ length: 354 }, (_, i) => `Company ${i + 1}`);
  const queries = buildQueries(companies);
  assert.equal(queries.length, 354 * 4 * 2);
  const ibm = buildQueries(['IBM']).find((q) => q.query_family === 'product_supply_chain' && q.source_scope === 'official_and_public_web');
  assert.match(ibm.query, /"IBM"/);
  assert.match(ibm.query, /"product manager"/);
  assert.match(ibm.query, /"supply chain"/);
  assert.match(ibm.query, /warehouse/);
  assert.equal(ibm.status, 'pending');
});
