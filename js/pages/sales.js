import { h, fmt, estimates, totals, toast } from '../core.js';
import { mineTabs } from '../mine-tabs.js';
import {
  isAdmin, userId, loadFollowUps, loadSalesExtras, syncFromHubspot, completeFollowUp, snoozeFollowUp, logHubspotNote, loadAdminSales, setProfilePhone,
} from '../cloud.js';
import {
  currentMonth, dueBucket, formatCloseRate, formatMonth, formatPhoenix, formatSyncedAgo, invalidLeadIndex, isDueOrOverdue, isStalledDeal, momChange, monthFromKey, monthKey, monthMetrics, shiftMonth,
} from '../../supabase/functions/_shared/assistant.js';

function card(label, value, note, id) {
  return h('div', { class: 'metric sales-box', id: id || null },
    h('span', {}, label),
    h('b', {}, value),
    note ? h('small', {}, note) : null);
}

function changeText(pair) {
  const mark = pair.direction === 'up' ? '↑' : pair.direction === 'down' ? '↓' : '·';
  return `${mark} ${pair.text}`;
}

export function followHelp(help, actions = {}) {
  const section = h('div', { class: 'card', id: 'follow-up-help' },
    h('h3', {}, 'Follow-up help'),
    h('p', { class: 'fine' }, 'Leads assigned to you in HubSpot with no call, email, note or meeting yet.'));
  const blocks = [
    ['Due and overdue', help.followUps || [], (row) => row.customerName],
    ['Stalled deals', help.stalled || [], (row) => row.customerName],
    ['Uncontacted leads', help.leads || [], (row) => row.name],
  ];
  for (const [title, rows, nameOf] of blocks) {
    section.append(h('h3', {}, title));
    if (!rows.length) {
      section.append(h('p', { class: 'fine' }, 'None right now.'));
      continue;
    }
    rows.forEach((row) => {
      const phone = row.phone || row.customerPhone || '';
      section.append(h('div', { class: 'card sales-box', id: 'help-' + (row.id || row.hubspot_id) },
        h('div', { class: 'row between wrap gap' },
          h('div', {},
            h('b', {}, nameOf(row)),
            h('div', { class: 'fine' }, row.when || row.phone || '')),
          h('b', {}, row.total != null ? fmt(Number(row.total) || 0) : '')),
        h('div', { class: 'row gap wrap' },
          phone ? h('a', { class: 'btn sm', id: 'help-call-' + row.id, href: 'tel:' + String(phone).replace(/[^\d+]/g, '') }, 'Call') : null,
          row.kind === 'followup' ? h('button', { type: 'button', class: 'btn sm primary', id: 'help-done-' + row.id, onclick: () => actions.onDone?.(row) }, 'Mark done') : null,
          row.kind === 'followup' ? h('button', { type: 'button', class: 'btn sm', id: 'help-snooze-' + row.id, onclick: () => actions.onSnooze?.(row) }, 'Snooze 2 business days') : null,
          row.estimateId ? h('button', { type: 'button', class: 'btn sm', id: 'help-open-' + row.id, onclick: () => actions.onOpen?.(row) }, 'Open estimate') : null,
          h('button', { type: 'button', class: 'btn sm', id: 'help-note-' + row.id, onclick: () => actions.onNote?.(row) }, 'Log note'))));
    });
  }
  return section;
}

export function dashboardView(model, actions = {}) {
  const m = model.metrics;
  const page = h('div', { class: 'page', id: 'sales-dashboard' });
  page.append(h('div', { class: 'row between wrap gap' },
    h('div', {},
      h('h1', {}, 'Sales'),
      h('p', { class: 'fine', id: 'sales-month' }, formatMonth(model.month)),
      h('p', { class: 'fine', id: 'sales-synced' }, model.synced || 'Not synced yet')),
    h('div', { class: 'row gap wrap' },
      h('button', { type: 'button', class: 'btn', id: 'sales-prev', onclick: actions.onPrev }, 'Previous month'),
      h('button', { type: 'button', class: 'btn', id: 'sales-next', disabled: model.atCurrent ? true : null, onclick: actions.onNext }, 'Next month'),
      h('button', { type: 'button', class: 'btn primary', id: 'sales-refresh', onclick: actions.onRefresh }, 'Refresh'))));
  if (model.notice) page.append(h('p', { class: model.noticeOk ? 'fine' : 'warn', id: 'sales-notice' }, model.notice));
  const conflicts = conflictLine(model.conflicts);
  if (conflicts) page.append(conflicts);
  page.append(h('div', { class: 'metric-grid', id: 'sales-metrics' },
    card('Appointments set', String(m.appointmentsSet)),
    card('Appointments held', String(m.appointmentsHeld)),
    card('Estimates presented', String(m.presented)),
    card('Won', `${m.wonCount} · ${fmt(m.wonDollars)}`),
    card('Lost', `${m.lostCount} · ${fmt(m.lostDollars)}`),
    card('Close rate', formatCloseRate(m.closeRate)),
    card('Open pipeline (current)', fmt(m.pipeline), 'Not limited to this month'),
    card('Invalid', String(m.invalidCount || 0), 'Not in close rate', 'invalid-count')));
  page.append(outcomeCard('sales-won', 'Won', m.won, 'won', 'No wins this month.'));
  page.append(outcomeCard('sales-lost', 'Lost', m.lost, 'lost', 'No losses this month.'));
  page.append(followHelp(model.help || {}, actions));
  return page;
}

function plainField(field) {
  const name = String(field || 'Detail').replace(/_/g, ' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function conflictLine(conflicts) {
  const rows = (conflicts || []).filter((row) => row);
  if (!rows.length) return null;
  const list = h('div', { id: 'sales-conflict-list', hidden: true });
  rows.forEach((row) => {
    list.append(h('p', { class: 'fine', id: 'sales-conflict-' + (row.id || row.customer) }, `${row.customer || 'Customer'} · ${plainField(row.field)}`));
  });
  const details = h('button', {
    type: 'button',
    class: 'link',
    id: 'sales-conflict-details',
    onclick: () => { list.hidden = !list.hidden; },
  }, 'Details');
  const names = rows.map((row) => row.customer || 'Customer');
  const sentence = names.length === 1
    ? `${names[0]} was updated in HubSpot too. This app kept its copy. `
    : `${names.length} jobs were updated in HubSpot too. This app kept its copy. `;
  return h('div', { id: 'sales-conflicts' },
    h('p', { class: 'fine' }, sentence, details),
    list);
}

function outcomeCard(id, title, rows, kind, empty) {
  return h('div', { class: 'card', id },
    h('h3', {}, title),
    ...(rows.length ? rows.map((row) => historyRow(row, kind)) : [h('p', { class: 'fine' }, empty)]));
}

function historyRow(row, kind) {
  const when = formatPhoenix(kind === 'won' ? (row.won_at || row.signed_at) : row.lost_at, { month: 'short', day: 'numeric' });
  return h('button', { type: 'button', class: 'sales-box history', id: kind + '-' + row.id },
    h('b', {}, row.customer_name || 'Customer'),
    h('span', {}, when),
    h('b', {}, fmt(Number(row.total_amount) || 0)));
}

const METRICS = [
  ['appointmentsSet', 'Appointments set', (m) => String(m.appointmentsSet)],
  ['appointmentsHeld', 'Appointments held', (m) => String(m.appointmentsHeld)],
  ['presented', 'Estimates presented', (m) => String(m.presented)],
  ['wonCount', 'Won', (m) => String(m.wonCount)],
  ['wonDollars', 'Won $', (m) => fmt(m.wonDollars)],
  ['lostCount', 'Lost', (m) => String(m.lostCount)],
  ['lostDollars', 'Lost $', (m) => fmt(m.lostDollars)],
  ['closeRate', 'Close rate', (m) => formatCloseRate(m.closeRate)],
  ['pipeline', 'Open pipeline (current)', (m) => fmt(m.pipeline)],
  ['invalidCount', 'Invalid', (m) => String(m.invalidCount || 0)],
];

export function adminDashboardView({ month, reps, atCurrent, invalidTotal }, actions = {}) {
  const previous = reps.map((rep) => rep.previous);
  const team = fold(reps.map((rep) => rep.metrics));
  const teamPrev = fold(previous);
  if (invalidTotal != null) team.invalidCount = invalidTotal;
  const page = h('div', { class: 'page', id: 'admin-dashboard' });
  page.append(h('div', { class: 'row between wrap gap' },
    h('div', {}, h('h1', {}, 'Team sales'), h('p', { class: 'fine', id: 'admin-month' }, formatMonth(month))),
    h('div', { class: 'row gap wrap' },
      h('button', { type: 'button', class: 'btn', id: 'admin-prev', onclick: actions.onPrev }, 'Previous month'),
      h('button', { type: 'button', class: 'btn', id: 'admin-next', disabled: atCurrent ? true : null, onclick: actions.onNext }, 'Next month'))));
  const table = h('table', { class: 'rates sales-table', id: 'admin-sales-table' });
  table.append(h('tr', {}, h('th', {}, 'Metric'), ...reps.map((rep) => h('th', {}, rep.name)), h('th', {}, 'Team')));
  for (const [key, label, read] of METRICS) {
    table.append(h('tr', {},
      h('td', {}, label),
      ...reps.map((rep) => h('td', {},
        read(rep.metrics),
        key === 'invalidCount' ? null : h('div', { class: 'fine mom mom-' + momChange(numberOf(rep.metrics, key), numberOf(rep.previous, key)).direction }, changeText(momChange(numberOf(rep.metrics, key), numberOf(rep.previous, key)))))),
      h('td', {},
        readMetric(team, key, read),
        key === 'invalidCount' ? null : h('div', { class: 'fine mom mom-' + momChange(numberOf(team, key), numberOf(teamPrev, key)).direction }, changeText(momChange(numberOf(team, key), numberOf(teamPrev, key)))))));
  }
  page.append(h('div', { class: 'card scroll sales-table-wrap' }, table));
  page.append(h('div', { class: 'rep-cards', id: 'rep-cards' }, ...reps.map((rep) => h('div', { class: 'card', id: 'rep-card-' + rep.id },
    h('b', {}, rep.name),
    h('div', { class: 'line' }, h('span', {}, 'Won'), h('b', {}, `${rep.metrics.wonCount} · ${fmt(rep.metrics.wonDollars)}`)),
    h('div', { class: 'line' }, h('span', {}, 'Lost'), h('b', {}, `${rep.metrics.lostCount} · ${fmt(rep.metrics.lostDollars)}`)),
    h('div', { class: 'line' }, h('span', {}, 'Close rate'), h('b', {}, formatCloseRate(rep.metrics.closeRate))),
    h('div', { class: 'line' }, h('span', {}, 'Open pipeline'), h('b', {}, fmt(rep.metrics.pipeline))),
    h('div', { class: 'line', id: 'rep-invalid-' + rep.id }, h('span', {}, 'Invalid'), h('b', {}, String(rep.metrics.invalidCount || 0)))))));
  page.append(h('p', { class: 'fine' }, 'Open pipeline is the current total of presented estimates, not this month. Arrows compare the selected month with the month before it. Invalid is the current count and is not in the close rate. The team total includes unassigned invalid leads.'));
  return page;
}

function readMetric(metrics, key, read) {
  return read(metrics);
}

function numberOf(metrics, key) {
  if (!metrics) return 0;
  if (key === 'closeRate') return metrics.closeRate || 0;
  return Number(metrics[key]) || 0;
}

function fold(list) {
  const rows = list.filter(Boolean);
  const wonCount = rows.reduce((s, m) => s + m.wonCount, 0);
  const lostCount = rows.reduce((s, m) => s + m.lostCount, 0);
  return {
    appointmentsSet: rows.reduce((s, m) => s + m.appointmentsSet, 0),
    appointmentsHeld: rows.reduce((s, m) => s + m.appointmentsHeld, 0),
    presented: rows.reduce((s, m) => s + m.presented, 0),
    wonCount,
    wonDollars: rows.reduce((s, m) => s + m.wonDollars, 0),
    lostCount,
    lostDollars: rows.reduce((s, m) => s + m.lostDollars, 0),
    closeRate: wonCount + lostCount ? wonCount / (wonCount + lostCount) : null,
    pipeline: rows.reduce((s, m) => s + m.pipeline, 0),
    invalidCount: rows.reduce((s, m) => s + (m.invalidCount || 0), 0),
  };
}

export function localMetrics(estimates, appointments, ownerId, month) {
  return monthMetrics({
    estimates: estimates.map(toMetricEstimate),
    appointments,
    ownerId,
    month,
  });
}

export function toMetricEstimate(e) {
  return {
    id: e.id,
    owner_id: e.ownerId || e.owner_id,
    customer_name: e.customer?.name || e.customer_name || '',
    status: e.status,
    total_amount: e.total_amount != null ? Number(e.total_amount) : null,
    presented_at: e.presentedAt || e.presented_at || null,
    signed_at: e.signedAt || e.signed_at || null,
    won_at: e.wonAt || e.won_at || null,
    lost_at: e.lostAt || e.lost_at || null,
    deleted_at: e.deletedAt || e.deleted_at || null,
    updated_at: e.updated ? new Date(e.updated).toISOString() : e.updated_at,
  };
}

let pickedKey = '';
let salesNotice = '';
let salesNoticeOk = false;

function helpFrom(rows, stalled, leads) {
  return {
    followUps: rows.filter((row) => row.bucket !== 'later').map((row) => ({
      id: row.id,
      kind: 'followup',
      estimateId: row.estimate_id,
      customerName: row.estimates?.customer_name || 'Customer',
      phone: row.estimates?.customer_phone || '',
      total: Number(row.estimates?.total_amount) || 0,
      when: formatPhoenix(row.due_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    })),
    stalled: stalled.map((row) => ({
      id: row.id,
      kind: 'stalled',
      estimateId: row.id,
      customerName: row.customer_name,
      total: row.total,
      when: 'No activity for 7 days',
    })),
    leads: leads.map((row) => ({
      id: row.hubspot_id,
      kind: 'lead',
      hubspotObject: row.hubspot_object,
      hubspotId: row.hubspot_id,
      name: row.name,
      phone: row.phone || '',
      when: row.hubspot_object === 'deal' ? 'Open deal' : 'Contact',
    })),
  };
}

export async function renderRep(root, monthToken) {
  const now = new Date();
  const current = currentMonth(now);
  const requested = monthFromKey(monthToken) || monthFromKey(pickedKey) || current;
  const month = requested.start > current.start ? current : requested;
  pickedKey = monthKey(month);
  const uid = userId();
  const mine = estimates.list().filter((e) => !e.deletedAt && (!uid || !e.ownerId || e.ownerId === uid || isAdmin()));
  const owned = isAdmin() ? mine : mine.filter((e) => !e.ownerId || e.ownerId === uid);
  root.replaceChildren(h('div', { class: 'page' }, h('h1', {}, 'Sales'), h('p', { class: 'muted' }, 'Loading this month…')));
  const [extras, follow] = await Promise.all([loadSalesExtras(), loadFollowUps()]);
  const appLeads = extras.appLeads || [];
  const invalid = invalidLeadIndex(appLeads);
  const metricEstimates = owned
    .filter((e) => !invalid.estimateIds.has(e.remoteId) && !invalid.estimateIds.has(e.id) && !(e.leadId && invalid.leadIds.has(e.leadId)))
    .map((e) => ({ ...toMetricEstimate(e), total_amount: totals(e).total }));
  const hubLeads = (extras.leads || []).filter((row) => !invalid.hubspotKeys.has(`${row.hubspot_object}:${row.hubspot_id}`));
  const metrics = monthMetrics({ estimates: metricEstimates, appointments: extras.appointments || [], ownerId: isAdmin() ? null : uid, month, leads: appLeads });
  const stalled = metricEstimates.filter((e) => isStalledDeal(e, [e.presented_at, e.updated_at], now)).map((e) => ({
    id: e.id, customer_name: e.customer_name, total: e.total_amount,
  }));
  const dueRows = (follow.rows || []).filter((row) => !invalid.estimateIds.has(row.estimate_id) && isDueOrOverdue(row.due_at, now, row.status)).map((row) => ({ ...row, bucket: dueBucket(row.due_at, now) }));
  const go = (next) => { location.hash = '#/saved/sales/' + monthKey(next); };
  const actions = {
    onPrev: () => go(shiftMonth(month, -1)),
    onNext: () => { if (monthKey(month) !== monthKey(current)) go(shiftMonth(month, 1)); },
    onRefresh: async () => {
      const res = await syncFromHubspot();
      salesNoticeOk = !!res.ok;
      salesNotice = res.ok ? 'Synced.' : (res.error || 'Could not sync. Try again.');
      renderRep(root, monthKey(month));
    },
    onDone: async (row) => { const res = await completeFollowUp(row.id); toast(res.ok ? 'Follow-up marked done.' : (res.error || 'Not completed.')); if (res.ok) renderRep(root, monthKey(month)); },
    onSnooze: async (row) => { const res = await snoozeFollowUp(row.id); toast(res.ok ? 'Snoozed 2 business days.' : (res.error || 'Not snoozed.')); if (res.ok) renderRep(root, monthKey(month)); },
    onOpen: (row) => { const local = estimates.list().find((e) => e.remoteId === row.estimateId || e.id === row.estimateId); if (local) { estimates.open(local.id); location.hash = '#/estimate'; } else toast('Open My estimates and refresh so this job downloads.'); },
    onNote: async (row) => {
      const note = window.prompt('Note for HubSpot');
      if (!note) return;
      const res = await logHubspotNote(row.estimateId ? { estimateId: row.estimateId, note } : { hubspotObject: row.hubspotObject, hubspotId: row.hubspotId, note });
      toast(res.ok ? 'Note logged.' : (res.error || 'Note was not saved.'));
    },
  };
  const page = dashboardView({
    month,
    atCurrent: monthKey(month) === monthKey(current),
    metrics,
    synced: formatSyncedAgo(extras.syncedAt, now),
    conflicts: extras.conflicts || [],
    notice: salesNotice,
    noticeOk: salesNoticeOk,
    help: helpFrom(dueRows, stalled, hubLeads),
  }, actions);
  page.prepend(mineTabs('sales'));
  root.replaceChildren(page);
}

export async function renderAdmin(root, monthToken) {
  if (!isAdmin()) {
    root.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'card' }, h('h1', {}, 'Team sales'), h('p', {}, 'Only the admin account can open this page.'))));
    return;
  }
  const now = new Date();
  const current = currentMonth(now);
  const requested = monthFromKey(monthToken) || current;
  const month = requested.start > current.start ? current : requested;
  root.replaceChildren(h('div', { class: 'page' }, h('h1', {}, 'Team sales'), h('p', { class: 'muted' }, 'Loading every rep…')));
  const res = await loadAdminSales();
  if (res.error) {
    root.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'card' }, h('h1', {}, 'Team sales'), h('p', { class: 'warn' }, res.error))));
    return;
  }
  const profiles = res.bundle.profiles || [];
  const estimates = res.bundle.estimates || [];
  const appointments = res.bundle.appointments || [];
  const leads = res.bundle.leads || [];
  const reps = profiles.filter((p) => p.role === 'sales').map((p) => ({
    id: p.id,
    name: p.full_name || p.email,
    metrics: monthMetrics({ estimates, appointments, ownerId: p.id, month, leads }),
    previous: monthMetrics({ estimates, appointments, ownerId: p.id, month: shiftMonth(month, -1), leads }),
  }));
  const go = (next) => { location.hash = '#/admin/dashboard/' + monthKey(next); };
  const page = adminDashboardView({
    month,
    atCurrent: monthKey(month) === monthKey(current),
    reps,
    invalidTotal: leads.filter((lead) => lead.stage === 'invalid').length,
  }, {
    onPrev: () => go(shiftMonth(month, -1)),
    onNext: () => { if (monthKey(month) !== monthKey(current)) go(shiftMonth(month, 1)); },
  });
  page.append(textMobiles(profiles, () => renderAdmin(root, monthToken)));
  root.replaceChildren(page);
}

function textMobiles(profiles, redraw) {
  const box = h('div', { class: 'card', id: 'team-phones' },
    h('h3', {}, 'Text mobiles'),
    h('p', { class: 'fine' }, 'Lead texts go to these numbers. Customers are never texted. The same mobile is on Accounts.'));
  (profiles || []).forEach((person) => {
    const id = String(person.id || person.email || '').slice(0, 8);
    box.append(h('div', { class: 'owner-field', id: 'team-phone-' + id },
      h('label', { class: 'field' },
        h('span', { class: 'lbl' }, (person.full_name || person.email || 'Person') + ' mobile'),
        h('input', {
          type: 'tel',
          id: 'team-phone-input-' + id,
          value: person.phone || '',
          placeholder: 'not set',
          autocomplete: 'tel',
        })),
      h('button', {
        type: 'button',
        class: 'btn sm',
        id: 'save-team-phone-' + id,
        onclick: async () => {
          const value = document.getElementById('team-phone-input-' + id)?.value || '';
          const res = await setProfilePhone(person.email, value);
          toast(res.error || (value.trim() ? 'Mobile saved.' : 'Mobile cleared.'));
          if (!res.error) redraw();
        },
      }, 'Save mobile')));
  });
  return box;
}
