import { h, fmt, estimates, toast } from '../core.js';
import { isAdmin, loadAdmin, setUserRole, reassignEstimate, loadSignatures } from '../cloud.js';

const fdate = (t) => t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

export async function render(root) {
  if (!isAdmin()) {
    root.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'card' }, h('h1', {}, 'Admin'), h('p', {}, 'Only the admin account can open this page.'))));
    return;
  }
  root.replaceChildren(h('div', { class: 'page' }, h('h1', {}, 'Admin'), h('p', { class: 'muted' }, 'Loading every rep…')));
  const data = await loadAdmin();
  if (data.error) {
    root.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'card' }, h('h1', {}, 'Admin'), h('p', { class: 'warn' }, data.error))));
    return;
  }
  const people = data.people;
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  const wrap = h('div', { class: 'page' });
  wrap.append(h('div', { class: 'row between wrap' }, h('h1', {}, 'Admin'), h('button', { class: 'btn', id: 'admin-refresh', onclick: () => render(root) }, 'Refresh')));

  const roles = h('div', { class: 'card', id: 'admin-roles' }, h('h3', {}, 'Roles'));
  people.forEach((p) => {
    const select = h('select', { 'aria-label': 'Role for ' + (p.email || p.full_name) },
      h('option', { value: 'sales', selected: p.role === 'sales' ? 'selected' : null }, 'Sales'),
      h('option', { value: 'admin', selected: p.role === 'admin' ? 'selected' : null }, 'Admin'));
    roles.append(h('div', { class: 'row between wrap gap', id: 'role-' + p.id },
      h('div', {}, h('b', {}, p.full_name || p.email || 'Rep'), h('div', { class: 'fine' }, p.email || '')),
      h('div', { class: 'row gap' }, select, h('button', { type: 'button', class: 'btn sm', onclick: async () => {
        const res = await setUserRole(p.id, select.value);
        if (res.error) toast(res.error);
        else { toast('Role saved'); render(root); }
      } }, 'Save role'))));
  });
  if (!people.length) roles.append(h('p', { class: 'muted' }, 'No accounts yet. Each rep creates an account with their work email.'));
  wrap.append(roles);

  const jobs = h('div', { class: 'card', id: 'admin-estimates' }, h('h3', {}, 'All estimates and contracts'));
  if (!data.estimates.length) jobs.append(h('p', { class: 'muted' }, 'No estimates stored yet.'));
  data.estimates.forEach((row) => {
    const owner = byId[row.owner_id];
    const select = h('select', { 'aria-label': 'Reassign ' + (row.customer_name || 'estimate') },
      ...people.map((p) => h('option', { value: p.id, selected: p.id === row.owner_id ? 'selected' : null }, p.full_name || p.email)));
    const detail = h('div', { id: 'sigs-' + row.id });
    const contracts = row.contracts || [];
    jobs.append(h('div', { class: 'lineitem' },
      h('div', { class: 'li-main' },
        h('div', { class: 'li-text' },
          h('b', {}, row.customer_name || '(no name)'),
          h('div', { class: 'muted' }, `${row.status} · ${owner?.full_name || owner?.email || 'Unassigned'} · ${fdate(row.updated_at)}`),
          h('div', { class: 'fine' }, contracts.length ? `${contracts.length} signed agreement${contracts.length === 1 ? '' : 's'}` : 'No signed agreement yet')),
        h('div', { class: 'li-price' }, h('b', {}, fmt(Number(row.total_amount) || 0)))),
      h('div', { class: 'row gap wrap' },
        select,
        h('button', { type: 'button', class: 'btn sm', onclick: async () => {
          const res = await reassignEstimate(row.id, select.value);
          toast(res.error || 'Reassigned');
          if (!res.error) render(root);
        } }, 'Reassign'),
        h('button', { type: 'button', class: 'btn sm', onclick: () => openLocal(row) }, 'Open'),
        contracts.length ? h('button', { type: 'button', class: 'btn sm', onclick: () => showSignatures(detail, contracts) }, 'Signatures') : null),
      detail));
  });
  wrap.append(jobs);
  root.replaceChildren(wrap);
}

function openLocal(row) {
  const local = Object.values(estimates.all()).find((e) => e.remoteId === row.id);
  if (!local) { toast('Open My estimates and refresh so this job downloads, then try again.'); return; }
  estimates.open(local.id);
  location.hash = '#/estimate';
}

async function showSignatures(box, contracts) {
  box.replaceChildren(h('p', { class: 'fine' }, 'Loading signatures…'));
  const blocks = [];
  for (const c of contracts) {
    const data = await loadSignatures(c.id);
    if (!data) { blocks.push(h('p', { class: 'warn' }, 'Could not load a signature.')); continue; }
    const sigs = data.parsed?.signatures || {};
    const imgs = Object.entries(sigs).filter(([, url]) => url).map(([key, url]) => h('div', {}, h('div', { class: 'fine' }, key), h('img', { src: url, alt: key, class: 'sig-preview' })));
    if (data.parsed?.initials) imgs.unshift(h('div', {}, h('div', { class: 'fine' }, 'Initials'), h('img', { src: data.parsed.initials, alt: 'Initials', class: 'sig-preview' })));
    blocks.push(h('div', {}, h('b', {}, data.signer_name || c.signer_name || 'Signer'), h('div', { class: 'fine' }, fdate(data.signed_at)), ...imgs));
  }
  box.replaceChildren(...blocks);
}
