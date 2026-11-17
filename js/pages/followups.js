import { h, fmt, toast } from '../core.js';
import { isAdmin, loadFollowUps, completeFollowUp } from '../cloud.js';
import { dueBucket, formatPhoenix, isDueOrOverdue } from '../../supabase/functions/_shared/assistant.js';

let rows = [];
let due = 0;
let loaded = false;

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

export function syncBadge(nav) {
  const link = nav?.querySelector('a[href="#/followups"]');
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
  rows = res.rows || [];
  due = res.error ? due : countDue(rows);
  window.dispatchEvent(new Event('nwd-followups'));
  return res;
}

export function followUpCards(list, { now = new Date(), busyId = '', onDone } = {}) {
  const open = (list || []).filter((row) => (row.status || 'open') === 'open');
  if (!open.length) {
    return h('div', { class: 'card', id: 'followups-empty' }, h('p', { class: 'muted' }, 'No open follow-ups.'));
  }
  const box = h('div', { id: 'followups-list', class: 'page' });
  open.forEach((row) => {
    const bucket = dueBucket(row.due_at, now);
    const flag = bucket === 'overdue' ? 'Overdue' : bucket === 'today' ? 'Due today' : 'Upcoming';
    const when = formatPhoenix(row.due_at, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    box.append(h('div', { class: 'card fu-card' + (bucket === 'overdue' ? ' overdue' : ''), id: 'followup-' + row.id },
      h('div', { class: 'row between wrap gap' },
        h('div', {},
          h('b', {}, nameOf(row)),
          isAdmin() && ownerOf(row) ? h('div', { class: 'fine' }, ownerOf(row)) : null,
          h('div', { class: 'muted' }, when),
          h('span', { class: 'pill' + (bucket === 'later' ? ' ph' : '') }, flag)),
        h('div', { class: 'li-price' }, h('b', {}, fmt(Number(totalOf(row)) || 0)))),
      h('div', { class: 'row gap' },
        h('button', {
          type: 'button',
          class: 'btn sm primary',
          id: 'followup-done-' + row.id,
          disabled: busyId === row.id ? true : null,
          onclick: () => onDone?.(row),
        }, busyId === row.id ? 'Saving…' : 'Done'))));
  });
  return box;
}

export async function render(root) {
  let busyId = '';
  const draw = (message) => {
    const page = h('div', { class: 'page', id: 'followups-page' },
      h('div', { class: 'row between wrap gap' },
        h('h1', {}, 'Follow-ups'),
        h('button', { type: 'button', class: 'btn', id: 'followups-refresh', onclick: async () => { await refresh(); draw(); } }, 'Refresh')),
      h('p', { class: 'fine' }, 'Open follow-ups for your jobs. The orange badge counts what is due today or overdue.'),
      message ? h('p', { class: 'warn', id: 'followups-error' }, message) : null,
      followUpCards(rows, { busyId, onDone }));
    root.replaceChildren(page);
  };
  async function onDone(row) {
    busyId = row.id;
    draw();
    const res = await completeFollowUp(row.id);
    busyId = '';
    if (!res.ok) {
      toast(res.error || 'The follow-up was not completed.');
      draw(res.error);
      return;
    }
    toast('Follow-up marked done.');
    await refresh();
    draw();
  }
  if (!loaded) {
    root.replaceChildren(h('div', { class: 'page' }, h('h1', {}, 'Follow-ups'), h('p', { class: 'muted' }, 'Loading follow-ups…')));
    const res = await refresh();
    draw(res.error || '');
    return;
  }
  draw();
}
