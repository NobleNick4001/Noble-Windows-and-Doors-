import { $, h, loadData } from './core.js';
import { startAuth, isAdmin, mountAccount, signIn, signUp, consumeAuthMessage } from './cloud.js';
import { renderLogin } from './pages/auth.js';
import * as calculator from './pages/calculator.js';
import * as estimate from './pages/estimate.js';
import * as contract from './pages/contract.js';
import * as options from './pages/options.js';
import * as gallery from './pages/gallery.js';
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
  ['preview', 'Overlay', '📷', (r) => overlay.render(r)],
  ['settings', 'Settings', '⚙️', (r) => settings.render(r)],
];

function navRoutes() {
  const list = [...ROUTES];
  if (isAdmin()) list.splice(3, 0, ['admin', 'Admin', '👤', (r) => admin.render(r)]);
  return list;
}

function route() {
  if (!unlocked) return;
  const [, name = 'calculator', sub] = location.hash.split('/');
  const routes = navRoutes();
  const r = routes.find((x) => x[0] === name) || routes[0];
  gallery.stop();
  obscure.stop();
  document.body.dataset.route = r[0] + (sub ? '-' + sub : '');
  $('#nav').replaceChildren(...routes.map(([id, label, ico]) => h('a', { href: '#/' + id, class: id === r[0] ? 'on' : '' }, h('span', { class: 'ico' }, ico), h('span', { class: 'nl' }, label))));
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
