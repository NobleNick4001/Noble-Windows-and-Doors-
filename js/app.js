import { $, h, loadData, estimates, toast } from './core.js';
import * as calculator from './pages/calculator.js';
import * as estimate from './pages/estimate.js';
import * as options from './pages/options.js';
import * as gallery from './pages/gallery.js';
import * as overlay from './pages/overlay.js';
import * as settings from './pages/settings.js';

const ROUTES = [
  ['calculator', 'Calculator', '🧮', (r) => calculator.render(r)],
  ['estimate', 'Estimate', '📄', (r, sub) => (sub === 'print' ? estimate.renderPrint(r) : estimate.render(r))],
  ['saved', 'Saved', '🗂', (r) => estimate.renderList(r)],
  ['options', 'Options', '🪟', (r) => options.render(r)],
  ['gallery', 'Gallery', '🖼', (r) => gallery.render(r)],
  ['preview', 'Preview', '📷', (r) => overlay.render(r)],
  ['settings', 'Settings', '⚙️', (r) => settings.render(r)],
];

function route() {
  const [, name = 'calculator', sub] = location.hash.split('/');
  const r = ROUTES.find((x) => x[0] === name) || ROUTES[0];
  gallery.stop();
  document.body.dataset.route = r[0] + (sub ? '-' + sub : '');
  $('#nav').replaceChildren(...ROUTES.map(([id, label, ico]) => h('a', { href: '#/' + id, class: id === r[0] ? 'on' : '' }, h('span', { class: 'ico' }, ico), h('span', { class: 'nl' }, label))));
  const app = $('#app');
  try { r[3](app, sub); } catch (err) { console.error(err); app.replaceChildren(h('div', { class: 'card' }, 'Something went wrong: ' + err.message)); }
  window.scrollTo(0, 0);
}

(async () => {
  try { await loadData(); } catch (e) { $('#app').textContent = 'Could not load data files: ' + e.message; return; }
  window.addEventListener('hashchange', route); route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
