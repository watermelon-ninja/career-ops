import assert from 'node:assert/strict';
import { buildTitleFilterWithOverrides } from '../scan.mjs';

const exhaustive = buildTitleFilterWithOverrides({
  mode: 'negative_only',
  positive: [],
  negative: ['software engineer', 'nurse', 'driver'],
}, new Map());

assert.equal(exhaustive('Business Transformation Lead'), true);
assert.equal(exhaustive('Enterprise Applications Manager'), true);
assert.equal(exhaustive('Supply Chain Transformation Manager'), true);
assert.equal(exhaustive('Senior Software Engineer'), false);
assert.equal(exhaustive('Registered Nurse'), false);

const general = buildTitleFilterWithOverrides({
  positive: ['product', 'business analyst', 'systems', 'supply chain'],
  negative: ['software engineer'],
}, new Map());

assert.equal(general('Product Manager'), true);
assert.equal(general('Product Operations Manager'), true);
assert.equal(general('Business Systems Analyst'), true);
assert.equal(general('Business Transformation Lead'), false);
assert.equal(general('Supply Chain Transformation Manager'), true);
assert.equal(general('Software Engineer, Product'), false);

console.log('Selena title-mode tests passed');


console.log('Selena Tesla provider parser');
{
  const html = `
    <a href="/careers/search/job/materials-program-manager-npi-material-planning-281315">Learn More</a>
    <a href="/careers/search/job/sr-product-manager-warehouse-management-system-259913">Learn More</a>
  `;
  const jobs = parseTeslaSearch(html, { name: 'Tesla', tesla: { location: 'Austin, Texas' } });
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].externalId, '281315');
  assert.equal(jobs[0].location, 'Austin, Texas');
  assert.match(jobs[1].title, /Warehouse Management System/i);
}

console.log('  ✓ Tesla official search links normalize into scan jobs');
