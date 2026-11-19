import { h } from './core.js';
import { attention } from './attention.js';

function badge(id, n, late) {
  if (!n) return null;
  return h('span', {
    class: 'nav-badge' + (late ? ' late' : ''),
    id,
  }, String(n));
}

export function mineTabs(active) {
  const leadsN = attention('leads');
  const followN = attention('followups');
  const tab = (id, href, label, count, late) => h('a', {
    class: 'seg-btn' + (active === id ? ' on' : ''),
    href,
    id: 'mine-tab-' + id,
  }, label, badge('mine-badge-' + id, count, late));
  return h('div', { class: 'tabs seg mine', id: 'mine-tabs' },
    tab('estimates', '#/saved', 'Estimates', 0, false),
    tab('leads', '#/saved/leads', 'New Leads', leadsN, attention('leadsLate') > 0),
    tab('followups', '#/saved/followups', 'Follow-ups', followN, attention('followupsLate') > 0),
    tab('sales', '#/saved/sales', 'Sales', 0, false));
}
