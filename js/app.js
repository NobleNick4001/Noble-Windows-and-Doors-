import { $, h, loadData } from './core.js';
import { icon, svg } from './icons.js';
import { startAuth, isAdmin, mountAccount, signIn, signUp, consumeAuthMessage } from './cloud.js';
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

const ROUTES = [
  ['calculator', 'Calculator', 'calculator', (r) => calculator.render(r)],
  ['doors', 'Doors', 'door', (r) => prehung.render(r)],
  ['estimate', 'Estimate', 'estimate', (r, sub) => (sub === 'print' ? estimate.renderPrint(r) : sub === 'present' ? estimate.renderPresent(r) : sub === 'contract' ? contract.render(r) : estimate.render(r))],
  ['saved', 'Mine', 'folder', (r) => estimate.renderList(r)],
  ['followups', 'Follow-ups', 'followups', (r) => followups.render(r)],
  ['options', 'Options', 'options', (r, sub) => options.render(r, sub || 'glass')],
  ['gallery', 'Gallery', 'gallery', (r) => gallery.render(r)],
  ['brochures', 'Brochures', 'brochures', (r) => brochures.render(r)],
  ['preview', 'Overlay', 'preview', (r) => overlay.render(r)],
  ['settings', 'Settings', 'settings', (r) => settings.render(r)],
];

function allRoutes() {
  const list = [...ROUTES];
  const inserts = [];
  if (isAdmin()) inserts.push(['admin', 'Admin', 'user', (r, sub, extra) => (sub === 'report' ? report.render(r, sub, extra) : admin.render(r))]);
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

function paintNav(nav, active) {
  $('#nav').replaceChildren(...nav.map(([id, label, ico]) => {
    const link = h('a', { href: '#/' + id, class: id === active ? 'on' : '' }, icon(ico, 'ico'), h('span', { class: 'nl' }, label));
    if (id === 'followups' && followups.dueCount() > 0) {
      link.append(h('span', { class: 'nav-badge', id: 'followup-badge' }, String(followups.dueCount())));
      link.setAttribute('aria-label', `Follow-ups, ${followups.dueCount()} due`);
    }
    return link;
  }));
}

function route() {
  if (!unlocked) return;
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const name = parts[0] || 'calculator';
  const sub = parts[1];
  const extra = parts.slice(2).join('/');
  const routes = allRoutes();
  const r = routes.find((x) => x[0] === name) || routes[0];
  const nav = routes.filter((x) => x[0] !== 'settings' && !x[4]);
  gallery.stop();
  brochures.stop();
  obscure.stop();
  stopFrameTypes();
  document.body.dataset.route = r[0] + (sub ? '-' + sub : '');
  paintNav(nav, r[0]);
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
      if (name === 'saved' || name === 'admin') route();
    });
    window.addEventListener('nwd-access', () => { if (unlocked) route(); });
    window.addEventListener('nwd-followups', () => { if (unlocked) followups.syncBadge(document.getElementById('nav')); });
  }
  mountAccount(document.getElementById('account'));
  route();
  followups.refresh().catch(() => {});
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
