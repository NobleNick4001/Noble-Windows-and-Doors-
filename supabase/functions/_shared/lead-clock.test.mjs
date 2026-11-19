import assert from 'node:assert/strict';
import test from 'node:test';
import { callPhrase, inLeadWindow, leadCallPlan } from './lead-clock.js';

function phoenix(y, m, d, hh, mm, ss = 0) {
  return new Date(Date.UTC(y, m - 1, d, hh + 7, mm, ss));
}

test('weekday afternoon uses a 1 hour budget inside the window', () => {
  const plan = leadCallPlan(phoenix(2026, 11, 17, 14, 0));
  assert.equal(plan.callWindow, 'weekday');
  assert.equal(plan.budgetMinutes, 60);
  assert.equal(plan.dueAt, phoenix(2026, 11, 17, 15, 0).toISOString());
});

test('a weekday deadline that passes 6 PM continues the next window', () => {
  const plan = leadCallPlan(phoenix(2026, 11, 20, 17, 30));
  assert.equal(plan.callWindow, 'weekday');
  assert.equal(plan.dueAt, phoenix(2026, 11, 21, 10, 30).toISOString());
});

test('Friday after close starts Saturday and uses the 4 hour weekend budget', () => {
  const plan = leadCallPlan(phoenix(2026, 11, 20, 20, 0));
  assert.equal(plan.callWindow, 'weekend');
  assert.equal(plan.budgetMinutes, 240);
  assert.equal(plan.dueAt, phoenix(2026, 11, 21, 14, 0).toISOString());
});

test('Saturday before open waits until 10 AM', () => {
  const plan = leadCallPlan(phoenix(2026, 11, 21, 9, 0));
  assert.equal(plan.callWindow, 'weekend');
  assert.equal(plan.dueAt, phoenix(2026, 11, 21, 14, 0).toISOString());
});

test('Saturday late afternoon spills into Sunday', () => {
  const plan = leadCallPlan(phoenix(2026, 11, 21, 15, 0));
  assert.equal(plan.callWindow, 'weekend');
  assert.equal(plan.dueAt, phoenix(2026, 11, 22, 13, 0).toISOString());
});

test('Sunday late afternoon spills into Monday and keeps the 4 hour budget', () => {
  const plan = leadCallPlan(phoenix(2026, 11, 22, 15, 30));
  assert.equal(plan.callWindow, 'weekend');
  assert.equal(plan.dueAt, phoenix(2026, 11, 23, 10, 30).toISOString());
});

test('Sunday after close starts Monday with a 1 hour budget', () => {
  const plan = leadCallPlan(phoenix(2026, 11, 22, 17, 0));
  assert.equal(plan.callWindow, 'weekday');
  assert.equal(plan.dueAt, phoenix(2026, 11, 23, 8, 0).toISOString());
});

test('Monday before open starts at 7 AM', () => {
  const plan = leadCallPlan(phoenix(2026, 11, 23, 6, 0));
  assert.equal(plan.callWindow, 'weekday');
  assert.equal(plan.dueAt, phoenix(2026, 11, 23, 8, 0).toISOString());
});

test('6:00 PM is closed, so the clock starts the next morning', () => {
  const plan = leadCallPlan(phoenix(2026, 11, 17, 18, 0));
  assert.equal(plan.callWindow, 'weekday');
  assert.equal(plan.dueAt, phoenix(2026, 11, 18, 8, 0).toISOString());
});

test('7:00 AM is open', () => {
  const plan = leadCallPlan(phoenix(2026, 11, 17, 7, 0));
  assert.equal(plan.dueAt, phoenix(2026, 11, 17, 8, 0).toISOString());
});

test('the pull window matches Phoenix business hours and treats the close as exclusive', () => {
  assert.equal(inLeadWindow(phoenix(2026, 11, 17, 7, 0, 0)), true);
  assert.equal(inLeadWindow(phoenix(2026, 11, 17, 17, 59, 59)), true);
  assert.equal(inLeadWindow(phoenix(2026, 11, 17, 18, 0, 0)), false);
  assert.equal(inLeadWindow(phoenix(2026, 11, 17, 6, 59, 0)), false);
  assert.equal(inLeadWindow(phoenix(2026, 11, 20, 20, 0)), false);
  assert.equal(inLeadWindow(phoenix(2026, 11, 21, 9, 59)), false);
  assert.equal(inLeadWindow(phoenix(2026, 11, 21, 10, 0)), true);
  assert.equal(inLeadWindow(phoenix(2026, 11, 21, 15, 59, 59)), true);
  assert.equal(inLeadWindow(phoenix(2026, 11, 21, 16, 0)), false);
  assert.equal(inLeadWindow(phoenix(2026, 11, 22, 12, 0)), true);
});

test('phrases match the window', () => {
  assert.equal(callPhrase('weekday'), '1 hour');
  assert.equal(callPhrase('weekend'), '4 hours');
});
