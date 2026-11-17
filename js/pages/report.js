import { h, fmt } from '../core.js';
import { isAdmin, loadReportSource } from '../cloud.js';
import {
  buildWeeklyReport, formatCloseRate, formatWeek, money, reportReps, shiftWeek, weekFromKey, weekKey, weekRange,
} from '../../supabase/functions/_shared/assistant.js';

function metric(label, value) {
  return h('div', { class: 'metric' }, h('span', {}, label), h('b', {}, value));
}

export function reportPage(report, { onPrev, onNext } = {}) {
  const page = h('div', { class: 'page', id: 'weekly-report' });
  page.append(h('div', { class: 'row between wrap gap' },
    h('div', {},
      h('h1', {}, 'Weekly report'),
      h('p', { class: 'fine', id: 'report-week' }, formatWeek(report.week))),
    h('div', { class: 'row gap wrap' },
      h('button', { type: 'button', class: 'btn', id: 'report-prev', onclick: onPrev }, 'Previous week'),
      h('button', { type: 'button', class: 'btn', id: 'report-next', onclick: onNext }, 'Next week'))));
  page.append(h('p', { class: 'fine' }, 'Close rate is signed divided by signed plus lost. Overdue follow-ups were still open past their due time at the end of Sunday. Pipeline is the estimate total of presented jobs that were still open.'));
  if (!report.reps.length) page.append(h('div', { class: 'card' }, h('p', { class: 'muted' }, 'No reps for this week.')));
  report.reps.forEach((rep) => {
    const card = h('div', { class: 'card report-rep', id: 'report-' + rep.id },
      h('h3', {}, rep.name),
      h('div', { class: 'metric-grid' },
        metric('Close rate', formatCloseRate(rep.closeRate)),
        metric('Signed', String(rep.signed)),
        metric('Lost', String(rep.lost)),
        metric('Appointments set', String(rep.appointmentsSet)),
        metric('Appointments held', String(rep.appointmentsHeld)),
        metric('Follow-ups due', String(rep.followUpsDue)),
        metric('Follow-ups done', String(rep.followUpsDone)),
        metric('Follow-ups overdue', String(rep.followUpsOverdue)),
        metric('Pipeline', fmt(rep.pipelineValue))));
    if (rep.stalled?.length) {
      card.append(h('h3', {}, 'Stalled'), ...rep.stalled.map((deal) => h('div', { class: 'line', id: 'stalled-' + deal.id },
        h('span', {}, deal.customerName), h('b', {}, money(deal.total)))));
    } else card.append(h('p', { class: 'fine' }, 'No stalled deals.'));
    page.append(card);
  });
  return page;
}

export function reportFrom(source, week) {
  const reps = reportReps(source.reps || source.profiles || [], source.estimates, source.followUps, source.appointments);
  return buildWeeklyReport({ ...source, reps }, week);
}

export async function render(root, _sub, weekToken) {
  if (!isAdmin()) {
    root.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'card' }, h('h1', {}, 'Weekly report'), h('p', {}, 'Only the admin account can open this page.'))));
    return;
  }
  const week = weekFromKey(weekToken) || weekRange(new Date());
  const go = (next) => { location.hash = '#/admin/report/' + weekKey(next); };
  root.replaceChildren(h('div', { class: 'page' }, h('h1', {}, 'Weekly report'), h('p', { class: 'muted' }, 'Loading the week…')));
  const source = await loadReportSource();
  if (source.error) {
    root.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'card' }, h('h1', {}, 'Weekly report'), h('p', { class: 'warn' }, source.error))));
    return;
  }
  root.replaceChildren(reportPage(reportFrom(source, week), {
    onPrev: () => go(shiftWeek(week, -1)),
    onNext: () => go(shiftWeek(week, 1)),
  }));
}
