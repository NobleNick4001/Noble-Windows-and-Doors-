import { h, toast, estimates, splitCustomerName, browserOffline, OFFLINE_MESSAGE } from '../core.js';
import { mineTabs } from '../mine-tabs.js';
import {
  isAdmin, userId, ensureRemote, flush,
  loadLeads, loadLeadReps, markLeadCalled, setLeadAppointment, linkLeadEstimate,
  markLeadLost, leadAction, markWon, markLost,
} from '../cloud.js';
import { assignmentText, overdueText } from '../../supabase/functions/_shared/quo.js';
import { leadCallPlan } from '../../supabase/functions/_shared/lead-clock.js';
import { INVALID_LEAD_REASONS } from '../../supabase/functions/_shared/lead-invalid.js';

let rows = [];
let reps = [];
let loaded = false;
let repPick = '';
let timer = 0;
let viewGen = 0;

export function stop() {
  clearInterval(timer);
  timer = 0;
  viewGen += 1;
}

export function uncalledCount() {
  const me = userId();
  return rows.filter((row) => row.owner_id === me && row.stage === 'new' && !row.called_at).length;
}

export function waitingCount() {
  return rows.filter((row) => !row.owner_id && row.stage !== 'invalid').length;
}

export function invalidLeadCount(list = rows) {
  return (list || []).filter((row) => row.stage === 'invalid').length;
}

export async function refresh() {
  const res = await loadLeads();
  loaded = true;
  if (!res.error) rows = res.rows || [];
  window.dispatchEvent(new Event('nwd-leads'));
  return res;
}

export function dueClock(dueAt, now = new Date()) {
  const due = new Date(dueAt).getTime();
  if (!Number.isFinite(due)) return { overdue: false, clock: '' };
  const ms = due - now.getTime();
  if (ms <= 0) return { overdue: true, clock: 'Overdue' };
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return { overdue: false, clock: hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}` };
}

export function dueWhen(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function windowLabel(callWindow) {
  return callWindow === 'weekend' ? 'Weekend · 4 hours' : 'Weekday · 1 hour';
}

function telHref(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  return digits ? 'tel:' + digits : '';
}

function slaBox(row, now) {
  const clock = dueClock(row.call_due_at, now);
  return h('div', { class: 'sla' + (clock.overdue ? ' over' : ''), id: 'sla-' + row.id, 'data-due': row.call_due_at },
    h('span', { class: 'fine' }, windowLabel(row.call_window)),
    h('span', { class: 'time' }, clock.clock || '—'),
    h('span', { class: 'fine sla-note' }, clock.overdue ? 'Past the business-hours deadline' : 'Due ' + dueWhen(row.call_due_at)));
}

function tickClocks() {
  document.querySelectorAll('[data-due]').forEach((el) => {
    const clock = dueClock(el.getAttribute('data-due'));
    const time = el.querySelector('.time');
    const note = el.querySelector('.sla-note');
    if (time) time.textContent = clock.clock || '—';
    if (note) note.textContent = clock.overdue ? 'Past the business-hours deadline' : 'Due ' + dueWhen(el.getAttribute('data-due'));
    el.classList.toggle('over', clock.overdue);
  });
}

function leadCountRow(list) {
  const open = (list || []).filter((row) => row.stage !== 'invalid' && row.stage !== 'won' && row.stage !== 'lost').length;
  return h('div', { class: 'metric-grid', id: 'lead-counts' },
    h('div', { class: 'metric', id: 'lead-open-count' }, h('span', {}, 'Leads'), h('b', {}, String(open))),
    h('div', { class: 'metric', id: 'invalid-count' }, h('span', {}, 'Invalid'), h('b', {}, String(invalidLeadCount(list)))));
}

function reasonSlug(reason) {
  return String(reason || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function invalidPanel(row, reason, actions) {
  return h('div', { class: 'invalid-panel', id: 'invalid-panel-' + row.id },
    h('h3', {}, 'Mark invalid'),
    h('p', { class: 'fine' }, 'Optional. Pick a reason, then confirm. Nothing is texted.'),
    h('div', { class: 'pick', id: 'invalid-reasons-' + row.id },
      ...INVALID_LEAD_REASONS.map((label) => h('button', {
        type: 'button',
        class: 'more-box' + (reason === label ? ' on' : ''),
        id: 'invalid-reason-' + reasonSlug(label),
        onclick: () => actions.onInvalidReason?.(row, label),
      }, h('b', {}, label)))),
    h('div', { class: 'row gap wrap' },
      h('button', { type: 'button', class: 'btn primary', id: 'invalid-confirm-' + row.id, onclick: () => actions.onInvalidConfirm?.(row, reason) }, 'Confirm invalid'),
      h('button', { type: 'button', class: 'btn', id: 'invalid-cancel-' + row.id, onclick: () => actions.onInvalidCancel?.() }, 'Cancel')));
}

function personLine(row) {
  return h('div', {},
    h('div', { class: 'row between gap wrap' },
      h('b', {}, row.name || 'Customer'),
      row.source ? h('span', { class: 'pill ph' }, row.source) : null),
    h('p', { class: 'muted' }, [row.phone, row.email].filter(Boolean).join(' · ') || 'No phone yet'),
    row.address ? h('p', { class: 'fine' }, row.address) : null,
    row.notes ? h('p', { class: 'note' }, row.notes) : null);
}

export function repLeadsPage({ rows: list, now = new Date(), onOpen, invalidId = '', invalidReason = '', onInvalid, onInvalidReason, onInvalidConfirm, onInvalidCancel }) {
  const page = h('div', { class: 'page', id: 'new-leads-page' }, mineTabs('leads'));
  page.append(h('div', { class: 'row between wrap gap' },
    h('h1', {}, 'New Leads'),
    h('button', { type: 'button', class: 'btn', id: 'leads-refresh', onclick: () => onOpen?.({ refresh: true }) }, 'Refresh')));
  page.append(leadCountRow(list));
  const open = (list || []).filter((row) => row.stage !== 'won' && row.stage !== 'lost' && row.stage !== 'invalid');
  if (!open.length) {
    page.append(h('div', { class: 'card', id: 'leads-empty' }, h('p', {}, 'No new leads. Assigned leads show up here.')));
    return page;
  }
  const grid = h('div', { class: 'lead-split', id: 'new-leads-list' });
  open.forEach((row) => {
    const call = telHref(row.phone);
    grid.append(h('div', { class: 'card lead-card', id: 'lead-card-' + row.id },
      personLine(row),
      row.call_due_at && row.stage === 'new' && !row.called_at ? slaBox(row, now) : h('p', { class: 'fine' }, stageWord(row)),
      h('div', { class: 'row gap wrap' },
        call ? h('a', { class: 'btn primary', id: 'lead-call-' + row.id, href: call }, 'Call') : h('button', { type: 'button', class: 'btn', disabled: true }, 'Call'),
        h('button', { type: 'button', class: 'btn', id: 'lead-open-' + row.id, onclick: () => onOpen?.(row) }, 'Open'),
        invalidId === row.id ? null : h('button', { type: 'button', class: 'btn', id: 'invalid-lead-' + row.id, onclick: () => onInvalid?.(row) }, 'Mark invalid')),
      invalidId === row.id ? invalidPanel(row, invalidReason, { onInvalidReason, onInvalidConfirm, onInvalidCancel }) : null));
  });
  page.append(grid);
  return page;
}

function stageWord(row) {
  if (row.stage === 'appointment' && row.appointment_at) return 'Appointment ' + dueWhen(row.appointment_at);
  if (row.stage === 'called') return 'Called';
  if (row.stage === 'follow_up') return 'Follow-up';
  if (row.stage === 'presented') return 'Presented';
  return row.stage || '';
}

export function adminLeadsPage({ rows: list, reps: people, repId, now = new Date(), onPick, onAssign, onRefresh, onRetry, refreshing, invalidId = '', invalidReason = '', onInvalid, onInvalidReason, onInvalidConfirm, onInvalidCancel }) {
  const page = h('div', { class: 'page', id: 'admin-leads-page' });
  page.append(h('div', { class: 'row between wrap gap' },
    h('h1', {}, 'Leads'),
    h('button', { type: 'button', class: 'btn', id: 'admin-leads-refresh', disabled: refreshing ? true : null, onclick: onRefresh }, refreshing ? 'Refreshing…' : 'Refresh')));
  page.append(h('p', { class: 'fine' }, 'Assign writes the HubSpot owner, then texts the rep from the company Quo line. The deadline uses Phoenix business hours.'));
  page.append(leadCountRow(list));
  const queue = (list || []).filter((row) => row.stage !== 'invalid' && (!row.owner_id || (row.stage === 'new' && !row.called_at)));
  queue.sort((a, b) => {
    const rank = (row) => {
      if (!row.owner_id) return 0;
      if (row.call_due_at && new Date(row.call_due_at).getTime() < now.getTime()) return 1;
      return 2;
    };
    return rank(a) - rank(b);
  });
  if (!queue.length) page.append(h('div', { class: 'card' }, h('p', {}, 'No leads waiting. Refresh pulls new ones from HubSpot.')));
  const chosen = (people || []).find((person) => person.id === repId);
  queue.forEach((row) => {
    const overdue = row.owner_id && row.call_due_at && new Date(row.call_due_at).getTime() < now.getTime();
    const card = h('div', { class: 'card', id: 'admin-lead-' + row.id }, personLine(row));
    const confirming = invalidId === row.id;
    if (!confirming) {
      card.append(h('button', { type: 'button', class: 'btn', id: 'invalid-lead-' + row.id, onclick: () => onInvalid?.(row) }, 'Mark invalid'));
    } else {
      card.append(invalidPanel(row, invalidReason, { onInvalidReason, onInvalidConfirm, onInvalidCancel }));
    }
    if (confirming) {
      page.append(card);
      return;
    }
    if (!row.owner_id) {
      const plan = leadCallPlan(now);
      const picks = h('div', {},
        h('p', { class: 'fine' }, 'Waiting for assignment. The clock starts when you assign it.'),
        h('h3', {}, 'Assign to'),
        h('div', { class: 'pick', id: 'assign-picks-' + row.id }, ...(people || []).filter((person) => person.role === 'sales' || person.role === 'admin').map((person) => {
          const ready = String(person.hubspot_owner_id || '').trim() && String(person.phone || '').trim();
          return h('button', {
            type: 'button',
            class: 'more-box' + (person.id === repId ? ' on' : ''),
            id: 'pick-' + person.id,
            disabled: ready ? null : true,
            onclick: () => onPick?.(person.id),
          }, h('b', {}, person.full_name || person.email || 'Rep'), h('span', {}, ready ? person.phone : 'No mobile or HubSpot owner'));
        })),
        h('button', {
          type: 'button', class: 'btn primary xl', id: 'assign-' + row.id,
          disabled: chosen ? null : true,
          onclick: () => onAssign?.(row, chosen),
        }, chosen ? 'Assign to ' + (chosen.full_name || 'rep') : 'Choose a rep'));
      const preview = h('div', {},
        h('div', { class: 'sms', id: 'assign-preview' },
          h('b', {}, 'Text to ' + (chosen?.full_name || 'the rep')),
          h('pre', {}, assignmentText({
            name: row.name, phone: row.phone, address: row.address, note: row.notes, callWindow: plan.callWindow,
          }))),
        h('p', { class: 'fine' }, 'Due ' + dueWhen(plan.dueAt) + ' · ' + windowLabel(plan.callWindow) + '. Saved on the server when you assign.'));
      card.append(h('div', { class: 'lead-split' }, picks, preview));
    } else {
      card.append(h('p', { class: 'fine' }, (overdue ? 'Overdue. ' : '') + 'Assigned. Admins are texted once the deadline passes.'));
      if (overdue) {
        const rep = (people || []).find((person) => person.id === row.owner_id);
        card.append(h('div', { class: 'sms' },
          h('b', {}, 'Text to admins'),
          h('pre', {}, overdueText({
            name: row.name, phone: row.phone, address: row.address, repName: rep?.full_name, callWindow: row.call_window,
          }))));
      }
      if (row.rep_text_error && !row.rep_text_at) {
        card.append(h('p', { class: 'warn' }, row.rep_text_error));
        card.append(h('button', { type: 'button', class: 'btn', id: 'retry-text-' + row.id, onclick: () => onRetry?.(row) }, 'Retry text'));
      }
    }
    page.append(card);
  });
  return page;
}

export function leadDetailPage({ lead, now = new Date(), onBack, onCalled, onSaveAppointment, onPresented, onWon, onLost }) {
  const page = h('div', { class: 'page', id: 'lead-detail' }, mineTabs('leads'));
  page.append(h('div', {}, h('button', { type: 'button', class: 'btn', id: 'lead-back', onclick: onBack }, 'Back to New Leads')));
  if (!lead) {
    page.append(h('div', { class: 'card' }, h('p', {}, 'This lead is not on your list.')));
    return page;
  }
  if (lead.stage === 'invalid') {
    page.append(h('div', { class: 'card' },
      h('h1', {}, lead.name || 'Customer'),
      h('p', {}, 'This lead is invalid.'),
      lead.invalid_reason ? h('p', { class: 'fine' }, lead.invalid_reason) : null));
    return page;
  }
  const call = telHref(lead.phone);
  const showClock = lead.stage === 'new' && !lead.called_at && lead.call_due_at;
  const current = lead.stage;
  const stageBtn = (id, label, onclick, extra = '') => h('button', {
    type: 'button',
    class: 'btn' + (current === id ? ' on' : '') + extra,
    id: 'stage-' + id,
    onclick,
  }, label);
  const actions = h('div', { class: 'card stage-card' },
    h('div', { class: 'row between gap wrap' }, h('h1', { style: 'margin:0' }, lead.name || 'Customer'), lead.source ? h('span', { class: 'pill ph' }, lead.source) : null),
    showClock ? slaBox(lead, now) : null,
    call ? h('a', { class: 'btn primary xl', href: call }, 'Call ' + (lead.phone || '')) : null,
    h('h3', {}, 'Stage'),
    h('div', { class: 'stages' },
      stageBtn('called', 'Called', onCalled),
      stageBtn('appointment', 'Appointment set', () => document.getElementById('appt-date')?.focus()),
      stageBtn('presented', 'Presented', onPresented),
      h('a', { class: 'btn' + (current === 'follow_up' ? ' on' : ''), id: 'stage-follow_up', href: '#/followups' }, 'Follow-up'),
      stageBtn('won', 'Won', onWon),
      stageBtn('lost', 'Lost', onLost, ' danger')),
    h('h3', { style: 'margin-top:.7rem' }, 'Set appointment'),
    h('div', { class: 'when' },
      h('label', { class: 'fine' }, 'Date', h('input', { type: 'date', id: 'appt-date' })),
      h('label', { class: 'fine' }, 'Time', h('input', { type: 'time', id: 'appt-time', value: '10:30' }))),
    h('button', { type: 'button', class: 'btn primary', id: 'save-appt', onclick: onSaveAppointment, style: 'margin-top:.45rem' }, 'Save appointment'),
    h('p', { class: 'fine' }, 'Times are Phoenix. Presented opens an estimate. The existing trigger creates the follow-up.'));
  page.append(h('div', { class: 'lead-split' },
    actions,
    h('div', { class: 'card' }, personLine(lead))));
  return page;
}

export function phoenixInputToIso(date, time) {
  const [y, m, d] = String(date || '').split('-').map(Number);
  const [hh, mm] = String(time || '').split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return '';
  return new Date(Date.UTC(y, m - 1, d, hh + 7, mm, 0)).toISOString();
}

function byDue(list) {
  return [...list].sort((a, b) => String(a.call_due_at || '9').localeCompare(String(b.call_due_at || '9')));
}

async function confirmInvalid(row, reason, draw, reset) {
  const res = await leadAction('lead-invalid', { leadId: row.id, reason: reason || '' });
  if (!res.ok) {
    toast(res.error || 'Not saved.');
    if (res.data?.invalid) {
      reset();
      await refresh();
      draw();
    }
    return;
  }
  toast(res.data?.note_error ? 'Marked invalid. The HubSpot note was not saved.' : 'Marked invalid.');
  reset();
  await refresh();
  draw();
}

export async function renderRep(root) {
  const gen = viewGen;
  let invalidId = '';
  let invalidReason = '';
  const draw = () => {
    if (gen !== viewGen) return;
    const me = userId();
    const mine = byDue(rows.filter((row) => row.owner_id && row.owner_id === me && row.stage !== 'won' && row.stage !== 'lost'));
    root.replaceChildren(repLeadsPage({
      rows: mine,
      invalidId,
      invalidReason,
      onOpen: (row) => {
        if (row?.refresh) { refresh().then(draw); return; }
        location.hash = '#/saved/leads/' + row.id;
      },
      onInvalid: (row) => { invalidId = row.id; invalidReason = ''; draw(); },
      onInvalidReason: (_row, label) => { invalidReason = invalidReason === label ? '' : label; draw(); },
      onInvalidCancel: () => { invalidId = ''; invalidReason = ''; draw(); },
      onInvalidConfirm: (row, reason) => confirmInvalid(row, reason, draw, () => { invalidId = ''; invalidReason = ''; }),
    }));
  };
  if (!loaded) {
    if (browserOffline()) {
      root.replaceChildren(h('div', { class: 'page' }, mineTabs('leads'), h('p', { class: 'warn' }, OFFLINE_MESSAGE)));
      return;
    }
    root.replaceChildren(h('div', { class: 'page' }, mineTabs('leads'), h('p', { class: 'muted' }, 'Loading leads…')));
    await refresh();
    if (gen !== viewGen) return;
  }
  draw();
  clearInterval(timer);
  timer = window.setInterval(tickClocks, 1000);
}

export async function renderDetail(root, id) {
  const gen = viewGen;
  const draw = () => {
    if (gen !== viewGen) return;
    const lead = rows.find((row) => row.id === id && (isAdmin() || row.owner_id === userId()));
    root.replaceChildren(leadDetailPage({
      lead,
      onBack: () => { location.hash = '#/saved/leads'; },
      onCalled: async () => {
        const res = await markLeadCalled(id);
        if (!res.ok) { toast(res.error || 'Not saved.'); return; }
        toast('Marked called.');
        await refresh();
        draw();
      },
      onSaveAppointment: async () => {
        const iso = phoenixInputToIso(document.getElementById('appt-date')?.value, document.getElementById('appt-time')?.value);
        if (!iso) { toast('Choose a date and time.'); return; }
        const res = await setLeadAppointment(id, iso);
        if (!res.ok) { toast(res.error || 'Not saved.'); return; }
        const hub = await leadAction('lead-appointment', { leadId: id });
        toast(hub.ok ? 'Appointment set.' : 'Appointment saved. HubSpot sync is not available yet.');
        await refresh();
        draw();
      },
      onPresented: () => openEstimate(lead),
      onWon: () => outcome(lead, 'won'),
      onLost: () => outcome(lead, 'lost'),
    }));
  };
  if (!loaded) {
    await refresh();
    if (gen !== viewGen) return;
  }
  draw();
  clearInterval(timer);
  timer = window.setInterval(tickClocks, 1000);
}

async function openEstimate(lead) {
  if (!lead) return;
  let local = estimates.list().find((item) => item.leadId === lead.id || (lead.estimate_id && item.remoteId === lead.estimate_id));
  if (!local) {
    local = estimates.startNew();
    const parts = splitCustomerName(lead.name);
    local.customer = {
      name: lead.name || '',
      first: parts.first,
      last: parts.last,
      address: lead.address || '',
      phone: lead.phone || '',
      email: lead.email || '',
    };
    local.notes = lead.notes || '';
    local.leadId = lead.id;
    if (lead.hubspot_contact_id) local.hubspotContactId = lead.hubspot_contact_id;
    if (lead.hubspot_deal_id) local.hubspotDealId = lead.hubspot_deal_id;
  }
  estimates.open(local.id);
  ensureRemote(local);
  estimates.save(local);
  await flush();
  if (local.remoteId && !lead.estimate_id) {
    const linked = await linkLeadEstimate(lead.id, local.remoteId);
    if (!linked.ok) toast(linked.error || 'Estimate is on this iPad. Linking it needs a connection.');
  }
  location.hash = '#/estimate';
}

async function outcome(lead, kind) {
  if (!lead) return;
  const local = estimates.list().find((item) => item.remoteId === lead.estimate_id || item.leadId === lead.id);
  if (local && (local.status === 'presented' || lead.stage === 'presented' || lead.stage === 'follow_up')) {
    const res = kind === 'won' ? await markWon(local) : await markLost(local);
    if (res?.ok !== false) await refresh();
    return;
  }
  if (kind === 'won') {
    toast('Present an estimate before marking it won.');
    return;
  }
  const res = await markLeadLost(lead.id);
  if (!res.ok) { toast(res.error || 'Not saved.'); return; }
  const hub = await leadAction('lead-lost', { leadId: lead.id });
  toast(hub.ok ? 'Marked lost.' : 'Marked lost. HubSpot sync is not available yet.');
  await refresh();
  location.hash = '#/saved/leads';
}

export async function renderAdmin(root) {
  if (!isAdmin()) {
    root.replaceChildren(h('div', { class: 'page', id: 'leads-denied' }, h('div', { class: 'card' }, h('h1', {}, 'Leads'), h('p', {}, 'Only an admin can assign leads.'))));
    return;
  }
  let refreshing = false;
  let invalidId = '';
  let invalidReason = '';
  const draw = () => {
    const ready = reps.filter((person) => String(person.hubspot_owner_id || '').trim() && String(person.phone || '').trim());
    if (!repPick || !ready.some((person) => person.id === repPick)) repPick = ready[0]?.id || '';
    root.replaceChildren(adminLeadsPage({
      rows,
      reps,
      repId: repPick,
      refreshing,
      invalidId,
      invalidReason,
      onInvalid: (row) => { invalidId = row.id; invalidReason = ''; draw(); },
      onInvalidReason: (_row, label) => { invalidReason = invalidReason === label ? '' : label; draw(); },
      onInvalidCancel: () => { invalidId = ''; invalidReason = ''; draw(); },
      onInvalidConfirm: (row, reason) => confirmInvalid(row, reason, draw, () => { invalidId = ''; invalidReason = ''; }),
      onPick: (id) => { repPick = id; draw(); },
      onRefresh: async () => {
        if (browserOffline()) { toast(OFFLINE_MESSAGE); return; }
        refreshing = true;
        draw();
        const hub = await leadAction('pull-unassigned', {});
        await refresh();
        refreshing = false;
        toast(hub.ok ? 'Leads refreshed.' : (hub.error || 'HubSpot sync is not available yet.'));
        draw();
      },
      onAssign: async (row, rep) => {
        if (!rep) return;
        const res = await leadAction('assign-lead', { leadId: row.id, repId: rep.id });
        if (!res.ok) { toast(res.error || 'Not assigned.'); return; }
        toast(res.data?.text_error ? 'Assigned. The text did not send.' : 'Assigned. The rep was texted.');
        await refresh();
        draw();
      },
      onRetry: async (row) => {
        const res = await leadAction('retry-lead-text', { leadId: row.id });
        toast(res.ok ? 'Text sent.' : (res.error || 'The text did not send.'));
        await refresh();
        draw();
      },
    }));
  };
  if (!loaded || !reps.length) {
    root.replaceChildren(h('div', { class: 'page' }, h('h1', {}, 'Leads'), h('p', { class: 'muted' }, 'Loading leads…')));
    const [leadRes, repRes] = await Promise.all([refresh(), loadLeadReps()]);
    reps = repRes.people || [];
    if (leadRes.error && !rows.length) {
      root.replaceChildren(h('div', { class: 'page' }, h('h1', {}, 'Leads'), h('p', { class: 'warn' }, leadRes.error)));
      return;
    }
  }
  draw();
}
