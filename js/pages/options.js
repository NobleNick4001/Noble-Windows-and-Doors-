import { h, fmt, data, settings } from '../core.js';
import { icon, frameKeyFor } from './calculator.js';
import { view as obscureView } from './obscure.js';
import { view as frameTypeView } from './frame-types.js';

const ICONS = { sun: '☀️', cloud: '☁️', shield: '🛡️', eye: '👁️', grid: '▦', screen: '▤', frame: '▢' };
function priceLabel(o) {
  const p = o.price || {};
  if (p.type === 'included' || !p.amount) return h('span', { class: 'pill ok' }, 'Included');
  const unit = p.type === 'perWindow' ? ' / window' : p.type === 'percent' ? '%' : ' / sq ft';
  return h('span', { class: 'pill' }, p.type === 'percent' ? `+${p.amount}%` : `+${fmt(p.amount)}${unit}`);
}
const badge = (o) => (settings.showPlaceholders && o.placeholder ? h('span', { class: 'pill ph' }, 'placeholder') : null);

export function render(root, sub = 'glass') {
  const titles = { obscure: 'Obscure glass', frametype: 'Frame types' };
  const wrap = h('div', { class: 'page opt' }, h('h1', {}, titles[sub] || 'Options'));
  const tabs = [['glass', 'Glass'], ['frames', 'Frame series'], ['frametype', 'Frame types'], ['colors', 'Colors & extras'], ['obscure', 'Obscure glass']];
  wrap.append(h('div', { class: 'tabs seg' }, tabs.map(([id, n]) => h('button', { type: 'button', class: 'seg-btn' + (sub === id ? ' on' : ''), onclick: () => { location.hash = '#/options/' + id; } }, n))));
  if (sub === 'obscure') {
    wrap.append(obscureView());
  } else if (sub === 'frametype') {
    wrap.append(frameTypeView());
  } else if (sub === 'glass') {
    wrap.append(h('div', { class: 'cards3' }, data.options.glass.map((o) => h('div', { class: 'card opt-card' }, h('div', { class: 'opt-ico' }, ICONS[o.icon] || '◻'), h('h2', {}, o.name), h('p', {}, o.desc), h('div', { class: 'row gap' }, priceLabel(o), badge(o))))));
  } else if (sub === 'frames') {
    const types = data.rates.types;
    wrap.append(h('div', { class: 'cards2' }, data.options.series.map((s) => h('div', { class: 'card opt-card' }, h('div', { class: 'row between' }, h('h2', {}, s.name), h('span', { class: 'pill ok' }, s.tag)), h('ul', {}, s.bullets.map((b) => h('li', {}, b))), h('div', { class: 'row gap' }, ...['hslider', 'vslider', 'picture', 'casement', 'arch'].map((t) => icon(t, s.id === 'A250' ? 'bronze' : 'white', 'tyicon sm'))), badge(s)))));
    wrap.append(h('p', { class: 'fine' }, data.options.seriesNote));
  } else if (sub === 'colors') {
    const series = (data.rates.brands[0].series);
    wrap.append(h('div', { class: 'card' }, h('h3', {}, 'Frame colors'), h('div', { class: 'swatches wide' }, data.rates.colors.map((c) => h('div', { class: 'swatch static' }, h('i', { style: `background:${c.swatch}` }), h('span', {}, c.name), h('small', {}, series.filter((s) => s.colors.includes(c.id)).map((s) => s.id).join(' · ')))))));
    wrap.append(h('div', { class: 'cards3' }, data.options.frame.map((o) => h('div', { class: 'card opt-card' }, h('div', { class: 'opt-ico' }, ICONS[o.icon] || '◻'), h('h2', {}, o.name), h('p', {}, o.desc), h('div', { class: 'row gap' }, priceLabel(o), badge(o))))));
  }
  root.replaceChildren(wrap);
}
