import { h, fmt, toast, estimates, browserOffline, OFFLINE_MESSAGE } from '../core.js';
import { isAdmin, loadFollowUps, completeFollowUp, snoozeFollowUp, syncFromHubspot } from '../cloud.js';
import { dueBucket, formatPhoenix, isDueOrOverdue } from '../../supabase/functions/_shared/assistant.js';

let rows = [];
let due = 0;
let loaded = false;
let lastError = '';

function nameOf(row) {
  const job = row.estimates || {};
  return job.customer_name || 'Customer';
}

function totalOf(row) {
  const job = row.estimates || {};
  return job.total_amount;
}

function ownerOf(row) {
  const person = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return person?.full_name || person?.email || '';
}

export function dueCount() { return due; }

export function countDue(list, now = new Date()) {
  return (list || []).filter((row) => isDueOrOverdue(row.due_at, now, row.status || 'open')).length;
}

function phoneOf(row) {
  return String(row.estimates?.customer_phone || '').trim();
}

function telHref(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  return digits ? 'tel:' + digits : '';
}

export function syncBadge(nav) {
  const link = nav?.querySelector('a[href="#/more"]') || nav?.querySelector('a[href="#/followups"]');
  if (!link) return;
  let badge = link.querySelector('.nav-badge');
  if (due <= 0) {
    badge?.remove();
    link.setAttribute('aria-label', 'Follow-ups');
    return;
  }
  if (!badge) {
    badge = h('span', { class: 'nav-badge', id: 'followup-badge' }, String(due));
    link.append(badge);
  } else badge.textContent = String(due);
  link.setAttribute('aria-label', `Follow-ups, ${due} due`);
}

export async function refresh() {
  const res = await loadFollowUps();
  loaded = true;
  lastError = res.error || '';
  if (!lastError) {
    rows = res.rows || [];
    due = countDue(rows);
  }
  window.dispatchEvent(new Event('nwd-followups'));
  return res;
}

export async function refreshFromHubspot() {
  const sync = await syncFromHubspot();
  const res = await refresh();
  const count = (res.rows || []).length;
  const noun = count === 1 ? 'open follow-up' : 'open follow-ups';
  if (!sync.ok) return { ...res, syncError: sync.error || 'HubSpot sync is not available yet.', statusLine: '' };
  if (res.error) return { ...res, syncError: '', statusLine: '' };
  return { ...res, syncError: '', statusLine: `Updated just now · ${count} ${noun}` };
}

export function followUpCards(list, { now = new Date(), busyId = '', onDone, onSnooze, onOpen } = {}) {
  const open = (list || []).filter((row) => (row.status || 'open') === 'open');
  if (!open.length) {
    return h('div', { class: 'card', id: 'followups-empty' },
      h('p', { id: 'followups-empty-text' }, 'No follow-ups due. Mark an estimate Presented to schedule one.'));
  }
  const box = h('div', { id: 'followups-list', class: 'page' });
  open.forEach((row) => {
    const bucket = dueBucket(row.due_at, now);
    const flag = bucket === 'overdue' ? 'Overdue' : bucket === 'today' ? 'Due today' : 'Upcoming';
    const when = formatPhoenix(row.due_at, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const phone = phoneOf(row);
    const call = telHref(phone);
    const busy = busyId === row.id;
    box.append(h('div', { class: 'card fu-card' + (bucket === 'overdue' ? ' overdue' : ''), id: 'followup-' + row.id },
      h('div', { class: 'row between wrap gap' },
        h('div', {},
          h('b', {}, nameOf(row)),
          isAdmin() && ownerOf(row) ? h('div', { class: 'fine' }, ownerOf(row)) : null,
          h('div', { class: 'muted' }, when),
          row.note ? h('p', { class: 'fine fu-note', id: 'followup-note-' + row.id }, row.note) : null,
          h('span', { class: 'pill' + (bucket === 'later' ? ' ph' : '') }, flag)),
        h('div', { class: 'li-price' }, h('b', {}, fmt(Number(totalOf(row)) || 0)))),
      h('div', { class: 'fu-actions' },
        call
          ? h('a', { class: 'btn primary', id: 'followup-call-' + row.id, href: call }, 'Call')
          : h('button', { type: 'button', class: 'btn', id: 'followup-call-' + row.id, disabled: true }, 'Call'),
        h('button', { type: 'button', class: 'btn', id: 'followup-open-' + row.id, onclick: () => onOpen?.(row) }, 'Open'),
        h('button', {
          type: 'button', class: 'btn', id: 'followup-done-' + row.id,
          disabled: busy ? true : null, onclick: () => onDone?.(row),
        }, busy ? 'Saving…' : 'Done'),
        h('button', {
          type: 'button', class: 'btn', id: 'followup-snooze-' + row.id,
          disabled: busy ? true : null, onclick: () => onSnooze?.(row),
        }, 'Snooze 2 days'))));
  });
  return box;
}

export function followUpsPage({ rows: list, refreshing = false, message = '', statusLine = '', busyId = '', now, onRefresh, onDone, onSnooze, onOpen } = {}) {
  return h('div', { class: 'page', id: 'followups-page' },
    h('div', { class: 'row between wrap gap' },
      h('h1', {}, 'Follow-ups'),
      h('button', {
        type: 'button',
        class: 'btn',
        id: 'followups-refresh',
        disabled: refreshing ? true : null,
        'aria-busy': refreshing ? 'true' : 'false',
        onclick: onRefresh,
      }, refreshing ? 'Refreshing…' : 'Refresh')),
    h('p', { class: 'fine' }, 'Open follow-ups for your jobs. The orange badge counts what is due today or overdue.'),
    message ? h('p', { class: 'warn', id: 'followups-error' }, message) : null,
    !message && statusLine ? h('p', { class: 'fine', id: 'followups-status' }, statusLine) : null,
    message ? null : followUpCards(list, { now, busyId, onDone, onSnooze, onOpen }));
}

export async function render(root) {
  let busyId = '';
  let refreshing = false;
  let message = '';
  let statusLine = '';
  const draw = () => {
    root.replaceChildren(followUpsPage({
      rows,
      refreshing,
      message,
      statusLine,
      busyId,
      onRefresh: async () => {
        if (refreshing) return;
        if (browserOffline()) {
          message = OFFLINE_MESSAGE;
          statusLine = '';
          draw();
          return;
        }
        refreshing = true;
        message = '';
        draw();
        const res = await refreshFromHubspot();
        refreshing = false;
        message = res.syncError || res.error || '';
        statusLine = message ? '' : (res.statusLine || '');
        draw();
      },
      onDone,
      onSnooze,
      onOpen: openRow,
    }));
  };
  function openRow(row) {
    const local = estimates.list().find((e) => e.remoteId === row.estimate_id || e.id === row.estimate_id);
    if (!local) {
      toast('Open Mine and refresh so this job downloads.');
      return;
    }
    estimates.open(local.id);
    location.hash = '#/estimate';
  }
  async function onDone(row) {
    busyId = row.id;
    draw();
    const res = await completeFollowUp(row.id);
    busyId = '';
    if (!res.ok) {
      message = res.error || 'The follow-up was not completed.';
      statusLine = '';
      draw();
      return;
    }
    statusLine = nameOf(row) + ' marked done';
    message = '';
    await refresh();
    draw();
  }
  async function onSnooze(row) {
    busyId = row.id;
    draw();
    const res = await snoozeFollowUp(row.id);
    busyId = '';
    if (!res.ok) {
      message = res.error || 'The follow-up was not snoozed.';
      statusLine = '';
      draw();
      return;
    }
    statusLine = nameOf(row) + ' snoozed 2 days';
    message = '';
    await refresh();
    draw();
  }
  if (!loaded) {
    if (browserOffline()) {
      message = OFFLINE_MESSAGE;
      loaded = true;
      lastError = message;
      draw();
      return;
    }
    root.replaceChildren(h('div', { class: 'page' }, h('h1', {}, 'Follow-ups'), h('p', { class: 'muted' }, 'Loading follow-ups…')));
    const res = await refresh();
    message = res.error || '';
    draw();
    return;
  }
  if (!message && lastError) message = lastError;
  draw();
}
