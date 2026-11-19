import { h } from '../core.js';
import { isAdmin } from '../cloud.js';
import { dueCount } from './followups.js';
import { waitingCount } from './leads.js';

const LINKS = [
  ['followups', 'Follow-ups', 'Open jobs that need a call'],
  ['gallery', 'Gallery', 'Job photos'],
  ['preview', 'Window photo', 'Show a new window on their photo'],
  ['options', 'Options', 'Glass, colors, and frame types'],
  ['settings', 'Settings', 'Your name and the phone on the estimate'],
];

const ADMIN_LINKS = [
  ['admin', 'Admin', 'People and estimates'],
  ['accounts', 'Accounts', 'Passwords and HubSpot owners'],
  ['admin/dashboard', 'Team sales', 'This month by rep'],
  ['admin/report', 'Weekly report', 'Close rate and pipeline'],
  ['leads', 'Leads', 'Assign new HubSpot leads'],
];

export function morePage({ admin = false, due = 0, waiting = 0 } = {}) {
  const page = h('div', { class: 'page', id: 'more-page' }, h('h1', {}, 'More'));
  const grid = h('div', { class: 'more-grid', id: 'more-grid' });
  for (const [id, label, note] of LINKS) {
    const box = h('a', { class: 'more-box', id: 'more-' + id, href: '#/' + id },
      h('b', {}, label),
      h('span', {}, note));
    if (id === 'followups' && due > 0) box.append(h('span', { class: 'pill', id: 'more-followup-count' }, due + ' due'));
    grid.append(box);
  }
  if (admin) {
    grid.append(h('h2', { class: 'more-admin', id: 'more-admin-label' }, 'Admin'));
    for (const [id, label, note] of ADMIN_LINKS) {
      const box = h('a', { class: 'more-box', id: 'more-' + id.replace(/\//g, '-'), href: '#/' + id },
        h('b', {}, label),
        h('span', {}, note));
      if (id === 'leads' && waiting > 0) box.append(h('span', { class: 'nav-badge', id: 'more-lead-badge' }, String(waiting)));
      grid.append(box);
    }
  }
  page.append(grid);
  return page;
}

export function render(root) {
  root.replaceChildren(morePage({ admin: isAdmin(), due: dueCount(), waiting: waitingCount() }));
}
