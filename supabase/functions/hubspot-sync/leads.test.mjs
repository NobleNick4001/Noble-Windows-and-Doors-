import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { invalidHubspotCopy } from '../_shared/lead-invalid.js';
import {
  LEAD_PULL_MAX_AGE_DAYS,
  createdWithinLeadWindow,
  leadCreatedCutoffMs,
  pickClosedLostStage,
  unassignedSearchFilters,
} from './leads.js';

const NOW = Date.parse('2026-11-19T15:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

test('the pull window is 30 days, in one place', () => {
  assert.equal(LEAD_PULL_MAX_AGE_DAYS, 30);
  assert.equal(leadCreatedCutoffMs(NOW), NOW - 30 * DAY);
});

test('every unassigned search group requires createdate in that window', () => {
  const cutoff = String(leadCreatedCutoffMs(NOW));
  const groups = unassignedSearchFilters('2044', NOW);
  assert.equal(groups.length, 2);
  for (const group of groups) {
    const owner = group.filters.find((filter) => filter.propertyName === 'hubspot_owner_id');
    const created = group.filters.find((filter) => filter.propertyName === 'createdate');
    assert.ok(owner);
    assert.deepEqual(created, { propertyName: 'createdate', operator: 'GTE', value: cutoff });
  }
  const only = unassignedSearchFilters('', NOW);
  assert.equal(only.length, 1);
  assert.equal(only[0].filters.at(-1).value, cutoff);
});

test('a record older than 30 days is skipped, including a missing date', () => {
  const cutoff = leadCreatedCutoffMs(NOW);
  assert.equal(createdWithinLeadWindow(String(cutoff), NOW), true);
  assert.equal(createdWithinLeadWindow(String(cutoff - 1), NOW), false);
  assert.equal(createdWithinLeadWindow(new Date(NOW).toISOString(), NOW), true);
  assert.equal(createdWithinLeadWindow(new Date(cutoff - DAY).toISOString(), NOW), false);
  assert.equal(createdWithinLeadWindow('', NOW), false);
  assert.equal(createdWithinLeadWindow(null, NOW), false);
});

test('closed lost stage resolution prefers the lost stage on the default pipeline', () => {
  const picked = pickClosedLostStage({
    results: [{
      id: 'default',
      stages: [
        { id: 'appointmentscheduled', label: 'Appointment Scheduled' },
        { id: '123', label: 'Closed Lost' },
        { id: 'closedwon', label: 'Closed Won' },
      ],
    }],
  });
  assert.deepEqual(picked, { stageId: '123', pipelineId: 'default' });
});

test('an invalid lead is labeled for HubSpot and the reason is optional', () => {
  assert.deepEqual(invalidHubspotCopy('Spam/fake'), {
    marker: 'Invalid lead: Spam/fake',
    note: 'Invalid lead. Spam/fake.',
    reason: 'Spam/fake',
  });
  assert.equal(invalidHubspotCopy('').marker, 'Invalid lead');
  assert.equal(invalidHubspotCopy('   ').reason, '');
  assert.equal(invalidHubspotCopy('Not a reason'), null);
});

test('the pull keeps assigned and invalid rows, and the schedule waits 60 seconds', () => {
  const src = readFileSync(new URL('./leads.js', import.meta.url), 'utf8');
  const save = src.slice(src.indexOf('async function saveLead'), src.indexOf('async function audit'));
  const lookup = save.slice(0, save.indexOf('const now'));
  assert.match(lookup, /select\('id, owner_id, stage,/);
  assert.match(lookup, /\.is\('deleted_at', null\)/);
  assert.equal(lookup.includes(".neq('stage'"), false);
  assert.match(save, /\.is\('owner_id', null\)\.neq\('stage', 'invalid'\)\.neq\('stage', 'dismissed'\)/);
  const invalid = src.slice(src.indexOf('export async function invalidateLead'), src.indexOf('export async function textOverdueAdmins'));
  assert.equal(invalid.includes('sendStaffText'), false);
  assert.match(invalid, /hs_lead_status: 'UNQUALIFIED'/);
  assert.match(src, /closed_lost_reason: marker/);
  assert.match(src, /'createdate'/);

  const cron = readFileSync(new URL('../../schedule/pg_cron_lead_sla.sql', import.meta.url), 'utf8');
  assert.match(cron, /cron\.unschedule\('lead-sla'\)/);
  assert.match(cron, /cron\.schedule\(\s*'lead-sla'/);
  assert.match(cron, /timeout_milliseconds := 60000/);

  const cleanup = readFileSync(new URL('../../maintenance/lead_cleanup_30d.sql', import.meta.url), 'utf8');
  assert.match(cleanup, /owner_id is null/);
  assert.match(cleanup, /assigned_at is null/);
  assert.match(cleanup, /called_at is null/);
  assert.match(cleanup, /estimate_id is null/);
  assert.match(cleanup, /stage is distinct from 'invalid'/);
  assert.match(cleanup, /invalid_at is null/);
  assert.match(cleanup, /stage is distinct from 'dismissed'/);
  assert.match(cleanup, /dismissed_at is null/);
  assert.match(cleanup, /last 30 days/);

  const migration = readFileSync(new URL('../../migrations/010_invalid_leads.sql', import.meta.url), 'utf8');
  assert.match(migration, /invalid_reason/);
  assert.match(migration, /invalid_at/);
  assert.match(migration, /invalid_by/);
  assert.match(migration, /'invalid'/);
  assert.match(migration, /lead_mark_invalid/);
  assert.match(migration, /lead_visible\(v\.owner_id\)/);
  assert.match(migration, /stage <> 'invalid'/);
});
