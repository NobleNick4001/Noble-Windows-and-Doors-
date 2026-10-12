import { h, fmt, data, settings } from '../core.js';
import { view as obscureView } from './obscure.js';
import { view as frameTypeView } from './frame-types.js';

const ICONS = { sun: '☀️', cloud: '☁️', shield: '🛡️', eye: '👁️', grid: '▦', screen: '▤', frame: '▢', edge: '▭', layers: '▣' };
function priceLabel(o) {
  const p = o.price || {};
  if (p.unset) return h('span', { class: 'pill ph' }, 'Price not set');
  if (p.type === 'included' || !p.amount) return h('span', { class: 'pill ok' }, 'Included');
  const unit = p.type === 'perWindow' ? ' / window' : p.type === 'percent' ? '%' : ' / sq ft';
  return h('span', { class: 'pill' }, p.type === 'percent' ? `+${p.amount}%` : `+${fmt(p.amount)}${unit}`);
}
const badge = (o) => (settings.showPlaceholders && o.placeholder ? h('span', { class: 'pill ph' }, 'placeholder') : null);

export function render(root, sub = 'glass') {
  const titles = { obscure: 'Obscure glass', frametype: 'Frame types' };
  const wrap = h('div', { class: 'page opt' }, h('h1', {}, titles[sub] || 'Options'));
  const tabs = [['glass', 'Glass'], ['frames', 'Brands'], ['frametype', 'Frame types'], ['colors', 'Colors & extras'], ['obscure', 'Obscure glass']];
  wrap.append(h('div', { class: 'tabs seg' }, tabs.map(([id, n]) => h('button', { type: 'button', class: 'seg-btn' + (sub === id ? ' on' : ''), onclick: () => { location.hash = '#/options/' + id; } }, n))));
  if (sub === 'obscure') {
    wrap.append(obscureView());
  } else if (sub === 'frametype') {
    wrap.append(frameTypeView());
  } else if (sub === 'glass') {
    wrap.append(h('div', { class: 'cards3' }, data.options.glass.map((o) => h('div', { class: 'card opt-card' }, h('div', { class: 'opt-ico' }, ICONS[o.icon] || '◻'), h('h2', {}, o.name), h('p', {}, o.desc), h('div', { class: 'row gap' }, priceLabel(o), badge(o))))));
    if (data.options.warranty) wrap.append(h('div', { class: 'card', id: 'warranty' }, h('h3', {}, data.options.warranty.title), h('p', {}, data.options.warranty.text)));
    if (data.options.process?.length) wrap.append(h('div', { class: 'card', id: 'process' }, h('h3', {}, 'How a job goes'), h('ol', { class: 'process' }, data.options.process.map((step) => h('li', {}, h('b', {}, step.title + '. '), step.desc)))));
  } else if (sub === 'frames') {
    for (const brand of data.options.brands || []) {
      wrap.append(h('h2', {}, brand.name));
      if (brand.note) wrap.append(h('p', { class: 'fine' }, brand.note));
      wrap.append(h('div', { class: 'cards2' }, (brand.lines || []).map((s) => h('div', { class: 'card opt-card' }, h('div', { class: 'row between wrap' }, h('h2', {}, s.name), s.tag ? h('span', { class: 'pill ok' }, s.tag) : null), h('ul', {}, (s.bullets || []).map((b) => h('li', {}, b))), badge(s)))));
    }
    data.options.seriesNote && wrap.append(h('p', { class: 'fine' }, data.options.seriesNote));
  } else if (sub === 'colors') {
    const active = data.rates.brands.filter((b) => b.status === 'active');
    const where = (id) => active.flatMap((b) => b.series.filter((s) => s.colors.includes(id)).map((s) => (b.series.length > 1 ? `${b.name} ${s.id}` : `${b.name} ${s.name}`))).join(' · ');
    wrap.append(h('div', { class: 'card' }, h('h3', {}, 'Frame colors'), h('div', { class: 'swatches wide' }, data.rates.colors.map((c) => h('div', { class: 'swatch static' }, h('i', { style: `background:${c.swatch}` }), h('span', {}, c.name), h('small', {}, where(c.id) || '—'))))));
    wrap.append(h('div', { class: 'cards3' }, data.options.frame.map((o) => h('div', { class: 'card opt-card' }, h('div', { class: 'opt-ico' }, ICONS[o.icon] || '◻'), h('h2', {}, o.name), h('p', {}, o.desc), h('div', { class: 'row gap' }, priceLabel(o), badge(o))))));
  }
  root.replaceChildren(wrap);
}
