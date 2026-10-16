import assert from 'node:assert/strict';
import { buildTitleFilterWithOverrides } from '../scan.mjs';

const exhaustive = buildTitleFilterWithOverrides({
  mode: 'negative_only',
  positive: [],
  negative: ['software engineer', 'nurse', 'driver'],
}, new Map());

assert.equal(exhaustive('Business Transformation Lead'), true);
assert.equal(exhaustive('Enterprise Applications Manager'), true);
assert.equal(exhaustive('Business Transformation Lead'), true);
assert.equal(exhaustive('Supply Chain Transformation Manager'), true);
assert.equal(exhaustive('Senior Software Engineer'), false);
assert.equal(exhaustive('Registered Nurse'), false);

const general = buildTitleFilterWithOverrides({
  positive: ['product', 'business analyst', 'systems'],
  negative: ['software engineer'],
}, new Map());

assert.equal(general('Product Manager'), true);
assert.equal(general('Business Systems Analyst'), true);
assert.equal(general('Business Transformation Lead'), false);
assert.equal(general('Supply Chain Transformation Manager'), true);
assert.equal(general('Software Engineer, Product'), false);

console.log('Selena title-mode tests passed');
