import { h, fmt, estimates, toast } from '../core.js';
import { isAdmin, currentProfile, loadAdmin, loadRoster, setUserRole, setSeeAll, addRep, revokeAccess, restoreAccess, reassignEstimate, loadSignatures } from '../cloud.js';

const fdate = (t) => t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

export async function render(root) {
  if (!isAdmin()) {
    root.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'card' }, h('h1', {}, 'Admin'), h('p', {}, 'Only the admin account can open this page.'))));
    return;
  }
  root.replaceChildren(h('div', { class: 'page' }, h('h1', {}, 'Admin'), h('p', { class: 'muted' }, 'Loading every rep…')));
  const [data, roster] = await Promise.all([loadAdmin(), loadRoster()]);
  if (data.error || roster.error) {
    root.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'card' }, h('h1', {}, 'Admin'), h('p', { class: 'warn' }, data.error || roster.error))));
    return;
  }
  const people = data.people;
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  const mine = String(currentProfile()?.email || '').toLowerCase();
  const wrap = h('div', { class: 'page' });
  wrap.append(h('div', { class: 'row between wrap' }, h('h1', {}, 'Admin'), h('button', { class: 'btn', id: 'admin-refresh', onclick: () => render(root) }, 'Refresh')));

  const nameInput = h('input', { type: 'text', id: 'rep-name', autocomplete: 'name', required: true });
  const emailInput = h('input', { type: 'email', id: 'rep-email', autocomplete: 'off', required: true });
  const roleInput = h('select', { id: 'rep-role', 'aria-label': 'Role for the new rep' },
    h('option', { value: 'sales', selected: 'selected' }, 'Sales'),
    h('option', { value: 'admin' }, 'Admin'));
  const peopleCard = h('div', { class: 'card', id: 'admin-roles' },
    h('h3', {}, 'People'),
    h('p', { class: 'fine' }, 'Only these emails can sign in or create an account. Revoke cuts off estimates immediately and signs that person out of every device that is online.'),
    h('form', { id: 'add-rep-form', class: 'row wrap gap', onsubmit: async (ev) => {
      ev.preventDefault();
      const btn = document.getElementById('btn-add-rep');
      if (btn) btn.disabled = true;
      const res = await addRep(emailInput.value, nameInput.value, roleInput.value);
      if (btn) btn.disabled = false;
      if (res.error) toast(res.error);
      else { toast('Rep added. They can create their password from the sign-in screen.'); render(root); }
    } },
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Name'), nameInput),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Email'), emailInput),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Role'), roleInput),
      h('button', { type: 'submit', class: 'btn primary', id: 'btn-add-rep' }, 'Add rep')));
  const list = roster.people || [];
  if (!list.length) peopleCard.append(h('p', { class: 'muted' }, 'No one is on the allowlist yet.'));
  list.forEach((p) => {
    const email = String(p.email || '').toLowerCase();
    const revoked = Boolean(p.revoked_at);
    const status = !p.on_list ? 'Not on the allowlist' : revoked ? 'Revoked' : p.profile_id ? 'Active' : 'Not signed up yet';
    const select = h('select', { 'aria-label': 'Role for ' + (email || p.full_name) },
      h('option', { value: 'sales', selected: p.role === 'sales' ? 'selected' : null }, 'Sales'),
      h('option', { value: 'admin', selected: p.role === 'admin' ? 'selected' : null }, 'Admin'));
    const self = email && email === mine;
    const slug = email.replace(/[^a-z0-9]+/g, '-');
    const seeToggle = p.role === 'admin'
      ? h('div', { class: 'fine' }, 'Sees every estimate')
      : h('label', { class: 'check' },
        h('input', {
          type: 'checkbox',
          id: 'see-all-' + slug,
          checked: p.see_all ? true : null,
          onchange: async (ev) => {
            const res = await setSeeAll(email, ev.target.checked);
            if (res.error) { ev.target.checked = !ev.target.checked; toast(res.error); }
            else toast(ev.target.checked ? 'They can see every rep’s estimates.' : 'They only see their own estimates.');
          },
        }),
        h('span', {}, "Can see other reps' estimates"));
    const accessBtn = !p.on_list ? null : self ? h('span', { class: 'fine' }, 'This is you') : h('button', {
      type: 'button',
      class: 'btn sm' + (revoked ? '' : ' danger'),
      id: (revoked ? 'restore-' : 'revoke-') + email.replace(/[^a-z0-9]+/g, '-'),
      onclick: async () => {
        const res = revoked ? await restoreAccess(email) : await revokeAccess(email);
        if (res.error) toast(res.error);
        else { toast(revoked ? 'Access restored. They can sign in again.' : 'Access revoked. Open sessions are signed out.'); render(root); }
      },
    }, revoked ? 'Restore' : 'Revoke');
    peopleCard.append(h('div', { class: 'row between wrap gap', id: 'role-' + email.replace(/[^a-z0-9]+/g, '-') },
      h('div', {},
        h('b', {}, p.full_name || email || 'Rep'),
        h('div', { class: 'fine' }, email),
        h('div', { class: revoked || !p.on_list ? 'warn' : 'fine', id: 'status-' + email.replace(/[^a-z0-9]+/g, '-') }, status),
        p.on_list ? seeToggle : null),
      h('div', { class: 'row gap wrap' },
        select,
        h('button', { type: 'button', class: 'btn sm', onclick: async () => {
          const res = await setUserRole(email, select.value);
          if (res.error) toast(res.error);
          else { toast('Role saved'); render(root); }
        } }, 'Save role'),
        accessBtn)));
  });
  wrap.append(peopleCard);

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
