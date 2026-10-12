import { h, data, settings, getRate, saveSettings, loadSettings, store, estimates, toast, colorName, typeName, fmt } from '../core.js';

let unlocked = false;
export function render(root) {
  const s = JSON.parse(JSON.stringify(settings));
  if (s.adminPin && !unlocked) {
    const inp = h('input', { type: 'password', inputmode: 'numeric', id: 'pin', placeholder: 'PIN' });
    root.replaceChildren(h('div', { class: 'page' }, h('h1', {}, 'Settings'), h('div', { class: 'card' }, h('p', {}, 'Enter admin PIN'), inp, h('button', { class: 'btn primary', onclick: () => { if (inp.value === s.adminPin) { unlocked = true; render(root); } else toast('Wrong PIN'); } }, 'Unlock'))));
    return;
  }
  const commit = () => { saveSettings(s); };
  const f = (label, get, set, type = 'text', id) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), h('input', { type, id, value: get(), inputmode: type === 'number' ? 'decimal' : null, oninput: (e) => { set(e.target.value); commit(); } }));
  const wrap = h('div', { class: 'page set' }, h('h1', {}, 'Settings'));
  wrap.append(h('div', { class: 'card' }, h('h3', {}, 'Pricing'),
    h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Rate set (admin)'), h('div', { class: 'seg' },
      h('button', { class: 'seg-btn' + (s.rateSet === 'p75' ? ' on' : ''), id: 'rs-p75', onclick: () => { s.rateSet = 'p75'; commit(); render(root); } }, 'Recommended (P75)'),
      h('button', { class: 'seg-btn' + (s.rateSet === 'max' ? ' on' : ''), id: 'rs-max', onclick: () => { s.rateSet = 'max'; commit(); render(root); } }, 'Max (highest quoted)')),
      h('span', { class: 'fine' }, 'P75 is the default. Max uses the highest $/inch seen on real quotes — higher prices.')),
    f('Sales tax % (default 0)', () => s.taxPct, (v) => (s.taxPct = parseFloat(v) || 0), 'number', 's-tax'),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Tax applies to'), h('select', { onchange: (e) => { s.taxOn = e.target.value; commit(); } }, h('option', { value: 'windows', selected: s.taxOn === 'windows' ? 'selected' : null }, 'Windows (materials) only'), h('option', { value: 'all', selected: s.taxOn === 'all' ? 'selected' : null }, 'Everything (windows + install + extras)'))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.roundToDollar ? 'checked' : null, onchange: (e) => { s.roundToDollar = e.target.checked; commit(); } }), h('span', {}, 'Round prices to whole dollars')),
    f('Estimate valid for (days)', () => s.validDays, (v) => (s.validDays = parseInt(v) || 30), 'number'),
    h('p', { class: 'fine' }, `Window rates are materials only and include Noble’s ${Math.round((Number(data.rates.grossMargin) || 0) * 100)}% margin. Change `, h('code', {}, 'grossMargin'), ' in ', h('code', {}, 'data/rates.json'), ' to reprice every window. Installation stays a separate line (', h('code', {}, 'data/install.json'), ').')));
  wrap.append(h('div', { class: 'card' }, h('h3', {}, 'Company info (shown on estimates)'),
    f('Company name', () => s.company.name, (v) => (s.company.name = v)), f('Address', () => s.company.address, (v) => (s.company.address = v)), f('Phone', () => s.company.phone, (v) => (s.company.phone = v), 'tel'),
    f('Email', () => s.company.email, (v) => (s.company.email = v), 'email'), f('Website', () => s.company.website, (v) => (s.company.website = v)),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Licenses (one per line, printed on estimates)'), h('textarea', { rows: 2, id: 's-license', oninput: (e) => { s.company.license = e.target.value; commit(); } }, s.company.license)),
    f('Hours', () => s.company.hours || '', (v) => (s.company.hours = v))));
  wrap.append(h('div', { class: 'card' }, h('h3', {}, 'Estimate terms'), h('textarea', { rows: 6, id: 's-terms', oninput: (e) => { s.terms = e.target.value; commit(); } }, s.terms)));
  wrap.append(h('div', { class: 'card' }, h('h3', {}, 'App'),
    f('Slideshow seconds per photo', () => s.slideshowSeconds, (v) => (s.slideshowSeconds = parseFloat(v) || 5), 'number'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.showPlaceholders ? 'checked' : null, onchange: (e) => { s.showPlaceholders = e.target.checked; commit(); } }), h('span', {}, 'Show “placeholder” badges on options screens')),
    f('Admin PIN for Settings (blank = none)', () => s.adminPin, (v) => (s.adminPin = v), 'text')));
  wrap.append(h('div', { class: 'card' }, h('h3', {}, 'Backup'), h('div', { class: 'row gap wrap' },
    h('button', { class: 'btn', onclick: () => { const blob = new Blob([JSON.stringify({ estimates: estimates.all(), settings: s }, null, 1)], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: 'noble-estimates-backup.json' }); document.body.append(a); a.click(); a.remove(); } }, 'Export estimates (JSON)'),
    h('label', { class: 'btn' }, 'Import backup', h('input', { type: 'file', accept: 'application/json', hidden: true, onchange: async (e) => { try { const j = JSON.parse(await e.target.files[0].text()); store.set('nwd.estimates', { ...estimates.all(), ...(j.estimates || {}) }); toast('Imported'); } catch { toast('Bad file'); } } })),
    h('button', { class: 'btn danger', onclick: () => { if (confirm('Reset settings to defaults?')) { localStorage.removeItem('nwd.settings'); loadSettings(); render(root); } } }, 'Reset settings'))));
  // rate table viewer (admin) — shows estimated flag, one table per active brand
  const activeBrands = data.rates.brands.filter((x) => x.status === 'active' && x.series?.length);
  for (const b of activeBrands) {
    const typeIds = [...new Set(b.series.flatMap((se) => se.types))];
    const rows = [];
    for (const se of b.series) for (const c of se.colors) rows.push(h('tr', {}, h('td', {}, se.id), h('td', {}, colorName(c)), ...typeIds.map((t) => {
      if (!se.types.includes(t)) return h('td', {}, '—');
      const r = getRate(b.id, se.id, c, t, s.rateSet);
      return h('td', { class: r?.estimated ? 'est' : '' }, r ? r.rate.toFixed(2) + (r.estimated ? ' E' : '') : '—');
    })));
    const note = b.id === 'milgard'
      ? 'E = estimated (not from a real quote). Internal only — never shown to customers. Adobe = white/white × the multiplier in rates.json (brands[0].derivedColors.adobe.multiplier).'
      : 'E = thin sample (fewer than 3 quote lines) or otherwise estimated. Internal only — never shown to customers. Sandtone uses the same rates as White. Dark Bronze is a dark-bronze exterior with a white interior.';
    wrap.append(h('div', { class: 'card' }, h('h3', {}, `${b.name} rates in use ($ per inch of W+H, materials only, ${Math.round((Number(data.rates.grossMargin) || 0) * 100)}% margin, ${s.rateSet === 'max' ? 'MAX' : 'P75'})`), h('div', { class: 'scroll' }, h('table', { class: 'rates' }, h('thead', {}, h('tr', {}, h('th', {}, 'Series'), h('th', {}, 'Color'), ...typeIds.map((t) => h('th', {}, typeName(t))))), h('tbody', {}, rows))),
      h('p', { class: 'fine' }, note)));
  }
  root.replaceChildren(wrap);
}
