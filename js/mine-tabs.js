import { h } from './core.js';

export function mineTabs(active) {
  const tab = (id, href, label) => h('a', {
    class: 'seg-btn' + (active === id ? ' on' : ''),
    href,
    id: 'mine-tab-' + id,
  }, label);
  return h('div', { class: 'tabs seg mine', id: 'mine-tabs' },
    tab('estimates', '#/saved', 'Estimates'),
    tab('leads', '#/saved/leads', 'New Leads'),
    tab('sales', '#/saved/sales', 'Sales'));
}
