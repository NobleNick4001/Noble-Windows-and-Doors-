import { $, h, loadData } from './core.js';
import { startAuth, isAdmin, mountAccount, signIn, signUp, consumeAuthMessage } from './cloud.js';
import { renderLogin } from './pages/auth.js';
import * as calculator from './pages/calculator.js';
import * as estimate from './pages/estimate.js';
import * as contract from './pages/contract.js';
import * as options from './pages/options.js';
import * as gallery from './pages/gallery.js';
import * as brochures from './pages/brochures.js';
import * as obscure from './pages/obscure.js';
import * as overlay from './pages/overlay.js';
import * as settings from './pages/settings.js';
import * as admin from './pages/admin.js';

const ROUTES = [
  ['calculator', 'Calculator', '🧮', (r) => calculator.render(r)],
  ['estimate', 'Estimate', '📄', (r, sub) => (sub === 'print' ? estimate.renderPrint(r) : sub === 'present' ? estimate.renderPresent(r) : sub === 'contract' ? contract.render(r) : estimate.render(r))],
  ['saved', 'Mine', '🗂', (r) => estimate.renderList(r)],
  ['options', 'Options', '🪟', (r, sub) => options.render(r, sub || 'glass')],
  ['gallery', 'Gallery', '🖼', (r) => gallery.render(r)],
  ['brochures', 'Brochures', '📘', (r) => brochures.render(r)],
  ['preview', 'Overlay', '📷', (r) => overlay.render(r)],
  ['settings', 'Settings', '⚙️', (r) => settings.render(r)],
];

const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.49-.42h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.22-1.13.53-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.64.22l2.39-.96c.5.41 1.05.72 1.63.94l.36 2.54c.05.24.25.42.49.42h3.8c.24 0 .44-.18.49-.42l.36-2.54c.58-.22 1.13-.53 1.63-.94l2.39.96c.24.1.51 0 .64-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>';

function allRoutes() {
  const list = [...ROUTES];
  if (isAdmin()) list.splice(3, 0, ['admin', 'Admin', '👤', (r) => admin.render(r)]);
  return list;
}

function mountGear(on) {
  let gear = document.getElementById('settings-gear');
  if (!gear) {
    gear = h('a', { id: 'settings-gear', href: '#/settings', 'aria-label': 'Settings', html: GEAR });
    document.querySelector('.top')?.append(gear);
  }
  gear.classList.toggle('on', on);
}

function route() {
  if (!unlocked) return;
  const [, name = 'calculator', sub] = location.hash.split('/');
  const routes = allRoutes();
  const r = routes.find((x) => x[0] === name) || routes[0];
  const nav = routes.filter((x) => x[0] !== 'settings');
  gallery.stop();
  brochures.stop();
  obscure.stop();
  document.body.dataset.route = r[0] + (sub ? '-' + sub : '');
  $('#nav').replaceChildren(...nav.map(([id, label, ico]) => h('a', { href: '#/' + id, class: id === r[0] ? 'on' : '' }, h('span', { class: 'ico' }, ico), h('span', { class: 'nl' }, label))));
  mountGear(r[0] === 'settings');
  const app = $('#app');
  try { r[3](app, sub); } catch (err) { console.error(err); app.replaceChildren(h('div', { class: 'card' }, 'Something went wrong: ' + err.message)); }
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
  }
  mountAccount(document.getElementById('account'));
  route();
}

(async () => {
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
