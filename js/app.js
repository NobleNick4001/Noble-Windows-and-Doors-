import { $, h, loadData } from './core.js';
import { icon, svg } from './icons.js';
import { startAuth, isAdmin, mountAccount, signIn, signUp, consumeAuthMessage } from './cloud.js';
import { renderLogin } from './pages/auth.js';
import * as calculator from './pages/calculator.js';
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

const ROUTES = [
  ['calculator', 'Calculator', 'calculator', (r) => calculator.render(r)],
  ['estimate', 'Estimate', 'estimate', (r, sub) => (sub === 'print' ? estimate.renderPrint(r) : sub === 'present' ? estimate.renderPresent(r) : sub === 'contract' ? contract.render(r) : estimate.render(r))],
  ['saved', 'Mine', 'folder', (r) => estimate.renderList(r)],
  ['options', 'Options', 'options', (r, sub) => options.render(r, sub || 'glass')],
  ['gallery', 'Gallery', 'gallery', (r) => gallery.render(r)],
  ['brochures', 'Brochures', 'brochures', (r) => brochures.render(r)],
  ['preview', 'Overlay', 'preview', (r) => overlay.render(r)],
  ['settings', 'Settings', 'settings', (r) => settings.render(r)],
];

function allRoutes() {
  const list = [...ROUTES];
  if (isAdmin()) list.splice(3, 0, ['admin', 'Admin', 'user', (r) => admin.render(r)]);
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

function route() {
  if (!unlocked) return;
  const [, name = 'calculator', sub] = location.hash.split('/');
  const routes = allRoutes();
  const r = routes.find((x) => x[0] === name) || routes[0];
  const nav = routes.filter((x) => x[0] !== 'settings');
  gallery.stop();
  brochures.stop();
  obscure.stop();
  stopFrameTypes();
  document.body.dataset.route = r[0] + (sub ? '-' + sub : '');
  $('#nav').replaceChildren(...nav.map(([id, label, ico]) => h('a', { href: '#/' + id, class: id === r[0] ? 'on' : '' }, icon(ico, 'ico'), h('span', { class: 'nl' }, label))));
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
