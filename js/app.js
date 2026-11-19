import { $, h, loadData } from './core.js';
import { icon, svg } from './icons.js';
import { startAuth, isAdmin, mountAccount, signIn, signUp, consumeAuthMessage, paintConnection } from './cloud.js';
import { renderLogin } from './pages/auth.js';
import * as calculator from './pages/calculator.js';
import * as prehung from './pages/prehung-ui.js';
import * as estimate from './pages/estimate.js';
import * as contract from './pages/contract.js';
import * as options from './pages/options.js';
import * as gallery from './pages/gallery.js';
import * as brochures from './pages/brochures.js';
import * as obscure from './pages/obscure.js';
import { stop as stopFrameTypes } from './pages/frame-types.js';
import * as overlay from './pages/overlay.js';
import * as settings from './pages/settings.js';
import * as admin from './pages/admin.js';
import * as accounts from './pages/accounts.js';
import * as followups from './pages/followups.js';
import * as report from './pages/report.js';
import * as sales from './pages/sales.js';
import * as more from './pages/more.js';
import * as leads from './pages/leads.js';
import { mineAttentionTotal } from './attention.js';

const NAV = [
  ['calculator', 'Quote', 'calculator'],
  ['doors', 'Doors', 'door'],
  ['brochures', 'Brochures', 'brochures'],
  ['estimate', 'Estimate', 'estimate'],
  ['saved', 'Mine', 'folder'],
  ['more', 'More', 'grid'],
];
const MORE_ROUTES = new Set(['more', 'followups', 'options', 'gallery', 'preview', 'settings', 'admin', 'accounts', 'leads']);

const ROUTES = [
  ['calculator', 'Quote', 'calculator', (r) => calculator.render(r)],
  ['doors', 'Doors', 'door', (r) => prehung.render(r)],
  ['brochures', 'Brochures', 'brochures', (r) => brochures.render(r)],
  ['estimate', 'Estimate', 'estimate', (r, sub) => (sub === 'print' ? estimate.renderPrint(r) : sub === 'present' ? estimate.renderPresent(r) : sub === 'contract' ? contract.render(r) : estimate.render(r))],
  ['saved', 'Mine', 'folder', (r, sub, extra) => (sub === 'sales' ? sales.renderRep(r, extra) : sub === 'leads' ? (extra ? leads.renderDetail(r, extra) : leads.renderRep(r)) : sub === 'followups' ? followups.render(r) : estimate.renderList(r))],
  ['more', 'More', 'grid', (r) => more.render(r)],
  ['leads', 'Leads', 'followups', (r) => leads.renderAdmin(r)],
  ['followups', 'Follow-ups', 'followups', (r) => followups.render(r)],
  ['options', 'Options', 'options', (r, sub) => options.render(r, sub || 'glass')],
  ['gallery', 'Gallery', 'gallery', (r) => gallery.render(r)],
  ['preview', 'Window photo', 'preview', (r) => overlay.render(r)],
  ['settings', 'Settings', 'settings', (r) => settings.render(r)],
];

function allRoutes() {
  const list = [...ROUTES];
  const inserts = [];
  if (isAdmin()) inserts.push(['admin', 'Admin', 'user', (r, sub, extra) => (sub === 'dashboard' ? sales.renderAdmin(r, extra) : sub === 'report' ? report.render(r, sub, extra) : admin.render(r))]);
  inserts.push(['accounts', 'Accounts', 'shield', (r) => accounts.render(r), !isAdmin()]);
  list.splice(3, 0, ...inserts);
  return list;
}

function mountGear(on) {
  let gear = document.getElementById('settings-gear');
  if (!gear) {
    gear = h('a', { id: 'settings-gear', href: '#/settings', 'aria-label': 'Settings', html: svg('gear') });
    document.querySelector('.top')?.append(gear);
  }
  gear.classList.toggle('on', on);
}

function navActive() {
  const name = location.hash.replace(/^#\/?/, '').split('/')[0] || 'calculator';
  return MORE_ROUTES.has(name) ? 'more' : name;
}

function paintNav(active) {
  $('#nav').replaceChildren(...NAV.map(([id, label, ico]) => {
    const link = h('a', { href: '#/' + id, class: id === active ? 'on' : '' }, icon(ico, 'ico'), h('span', { class: 'nl' }, label));
    if (id === 'more' && followups.dueCount() > 0) {
      link.append(h('span', { class: 'nav-badge', id: 'followup-badge' }, String(followups.dueCount())));
      link.setAttribute('aria-label', `More, ${followups.dueCount()} follow-ups due`);
    }
    if (id === 'saved') {
      const leadsN = leads.uncalledCount();
      const dueN = followups.dueCount();
      const mineN = mineAttentionTotal(leadsN, dueN);
      if (mineN > 0) {
        link.append(h('span', { class: 'nav-badge' + (leads.uncalledOverdueCount() > 0 ? ' late' : ''), id: 'lead-badge' }, String(mineN)));
        const parts = [];
        if (leadsN) parts.push(`${leadsN} new lead${leadsN === 1 ? '' : 's'}`);
        if (dueN) parts.push(`${dueN} follow-up${dueN === 1 ? '' : 's'} due`);
        link.setAttribute('aria-label', `Mine, ${parts.join(', ')}`);
      }
    }
    return link;
  }));
}

function ensureOfflineBar() {
  if (document.getElementById('offline-bar')) return;
  const bar = h('div', { id: 'offline-bar', hidden: true }, 'Offline. Quotes on this iPad still save. Email and follow-ups need a connection.');
  document.querySelector('.top')?.after(bar);
}

function route() {
  if (!unlocked) return;
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const name = parts[0] || 'calculator';
  const sub = parts[1];
  const extra = parts.slice(2).join('/');
  const routes = allRoutes();
  const r = routes.find((x) => x[0] === name) || routes[0];
  gallery.stop();
  leads.stop();
  brochures.stop();
  obscure.stop();
  stopFrameTypes();
  document.body.dataset.route = r[0] + (sub ? '-' + sub : '');
  paintNav(MORE_ROUTES.has(r[0]) ? 'more' : r[0]);
  ensureOfflineBar();
  paintConnection();
  mountGear(r[0] === 'settings');
  const app = $('#app');
  try { r[3](app, sub, extra); } catch (err) { console.error(err); app.replaceChildren(h('div', { class: 'card' }, 'Something went wrong: ' + err.message)); }
  window.scrollTo(0, 0);
}

let started = false;
let unlocked = false;

function lockShell() {
  unlocked = false;
  document.body.classList.add('auth-locked');
  $('#nav').replaceChildren();
  document.getElementById('account')?.replaceChildren();
}

function boot() {
  unlocked = true;
  document.body.classList.remove('auth-locked');
  if (!started) {
    started = true;
    window.addEventListener('hashchange', () => { if (unlocked) route(); });
    window.addEventListener('nwd-synced', () => {
      if (!unlocked) return;
      const name = location.hash.split('/')[1] || '';
      if (name === 'saved' || name === 'admin' || name === 'leads') route();
    });
    window.addEventListener('nwd-access', () => { if (unlocked) route(); });
    window.addEventListener('nwd-followups', () => { if (unlocked) paintNav(navActive()); });
    window.addEventListener('nwd-leads', () => { if (unlocked) paintNav(navActive()); });
    window.addEventListener('online', () => paintConnection());
    window.addEventListener('offline', () => paintConnection());
  }
  mountAccount(document.getElementById('account'));
  route();
  followups.refresh().catch(() => {});
  leads.refresh().catch(() => {});
}

(async () => {
  window.addEventListener('nwd-lock', () => lockShell());
  lockShell();
  await startAuth({
    onReady: async () => {
      try {
        await loadData();
      } catch (e) {
        document.body.classList.remove('auth-locked');
        $('#app').textContent = 'Could not load data files: ' + e.message;
        return;
      }
      boot();
    },
    onSignedOut: () => {
      lockShell();
      renderLogin($('#app'), { signIn, signUp, message: consumeAuthMessage() });
    },
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
