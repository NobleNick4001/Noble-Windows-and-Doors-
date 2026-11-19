import assert from 'node:assert/strict';
import test from 'node:test';
import { leadUpsertPlan } from './lead-upsert.js';

const incoming = {
  hubspot_contact_id: 'c1',
  hubspot_deal_id: 'd1',
  name: 'Priya Shah',
  phone: '(602) 555-0190',
  email: 'priya.shah@example.com',
  address: '85251',
  notes: 'Patio doors',
  source: 'HubSpot',
};

test('a new HubSpot lead is inserted once and is not assigned', () => {
  const plan = leadUpsertPlan(null, incoming, '2026-11-19T15:00:00.000Z');
  assert.equal(plan.action, 'insert');
  assert.equal(plan.values.stage, 'new');
  assert.equal(plan.values.owner_id, undefined);
  assert.equal(plan.values.call_due_at, undefined);
  assert.equal(plan.values.address, '85251');
});

test('an assigned lead is not reassigned or overwritten', () => {
  const plan = leadUpsertPlan({
    id: 'lead-1',
    owner_id: 'eric',
    notes: 'kept',
    hubspot_contact_id: 'c1',
    hubspot_deal_id: 'd1',
  }, { ...incoming, name: 'Changed', phone: 'different' }, '2026-11-19T15:00:00.000Z');
  assert.deepEqual(plan, { action: 'skip' });
});

test('an unassigned lead can refresh details without touching the owner or deadline', () => {
  const plan = leadUpsertPlan({
    id: 'lead-2',
    owner_id: null,
    notes: '',
    hubspot_contact_id: 'c1',
    hubspot_deal_id: null,
  }, incoming, '2026-11-19T15:00:00.000Z');
  assert.equal(plan.action, 'update');
  assert.equal(plan.values.hubspot_deal_id, 'd1');
  assert.equal(plan.values.owner_id, undefined);
  assert.equal(plan.values.stage, undefined);
  assert.equal(plan.values.call_due_at, undefined);
  assert.equal(plan.values.rep_text_at, undefined);
});
