import { h, data, settings, getRate, saveSettings, loadSettings, store, estimates, toast, colorName, typeName, fmt, variableRateInfo, isCustomLine } from '../core.js';

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
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Tax applies to'), h('select', { onchange: (e) => { s.taxOn = e.target.value; commit(); } }, h('option', { value: 'windows', selected: s.taxOn === 'windows' ? 'selected' : null }, 'Windows (materials) only'), h('option', { value: 'all', selected: s.taxOn === 'all' ? 'selected' : null }, 'Everything (windows, install, add-ons, stucco, and extras)'))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.roundToDollar ? 'checked' : null, onchange: (e) => { s.roundToDollar = e.target.checked; commit(); } }), h('span', {}, 'Round prices to whole dollars')),
    f('Estimate valid for (days)', () => s.validDays, (v) => (s.validDays = parseInt(v) || 30), 'number'),
    h('p', { class: 'fine' }, `Fitted series use selling prices from `, h('code', {}, 'data/variable-rates.json'), ' (already at 45%). ', h('code', {}, 'grossMargin'), ' in ', h('code', {}, 'data/rates.json'), ' reprices only the combinations that file does not cover. Installation stays a separate line (', h('code', {}, 'data/install.json'), ').')));
  wrap.append(h('div', { class: 'card' }, h('h3', {}, 'Company info (shown on estimates)'),
    f('Salesperson (Submitted by on the purchase agreement)', () => s.salesperson || '', (v) => (s.salesperson = v), 'text', 's-salesperson'),
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
  // rate table viewer (admin). Fitted cells are selling prices from the quote model.
  const trimNum = (n) => String(Math.round(Number(n) * 10000) / 10000);
  const activeBrands = data.rates.brands.filter((x) => x.status === 'active' && x.series?.length);
  for (const b of activeBrands) {
    const typeIds = [...new Set(b.series.flatMap((se) => se.types))];
    const rows = [];
    for (const se of b.series) for (const c of se.colors) rows.push(h('tr', {}, h('td', {}, se.id), h('td', {}, colorName(c)), ...typeIds.map((t) => {
      if (!se.types.includes(t)) return h('td', {}, '—');
      const info = variableRateInfo(b.id, se.id, c, t);
      if (info) {
        const bits = [];
        if (info.base) bits.push(info.base.toFixed(2));
        if (info.perUI) bits.push(trimNum(info.perUI) + '/UI');
        if (info.perSqFt) bits.push(trimNum(info.perSqFt) + '/sqft');
        if (!bits.length) bits.push('0');
        let text = bits.join(' + ');
        if (info.ratio !== 1) text += ` × ${info.ratio}`;
        if (info.adjustPerUnit) text += ` ${info.adjustPerUnit < 0 ? '−' : '+'} ${Math.abs(info.adjustPerUnit).toFixed(2)}`;
        return h('td', { class: 'from-quotes' }, text, h('div', { class: 'fine' }, info.provisional ? 'from quotes · provisional' : 'from quotes'));
      }
      if (isCustomLine({ brand: b.id, series: se.id, color: c, type: t })) return h('td', { class: 'custom-rate' }, 'Custom', h('div', { class: 'fine' }, 'enter supplier price'));
      const r = getRate(b.id, se.id, c, t, s.rateSet);
      return h('td', { class: r?.estimated ? 'est' : '' }, r ? r.rate.toFixed(2) + (r.estimated ? ' E' : '') : '—');
    })));
    const note = b.id === 'milgard'
      ? 'from quotes = selling price fitted from quotes (base, $ per UI, $ per sq ft), already at 45%. No extra margin. E = stored $/inch for a color or series the fit does not cover. V300 White and Adobe, and A250 Bronze, use the fit. V250 Adobe is still white/white × the multiplier.'
      : b.id === 'iwc'
        ? '8200 windows and 8900 doors in Bronze Anodized are from quotes. Clear Anodized, Mojave Beige, and White use the custom supplier-price line.'
        : 'from quotes = selling price (base, $ per UI, $ per sq ft), already at 45%. Sandtone is priced like Black. White/White subtracts $191.71 per unit. Dark Bronze / White, Terratone, and Black/White use × 1.003. E marks the old $/inch table, used for awning.';
    wrap.append(h('div', { class: 'card' }, h('h3', {}, `${b.name} material rates`), h('div', { class: 'scroll' }, h('table', { class: 'rates' }, h('thead', {}, h('tr', {}, h('th', {}, 'Series'), h('th', {}, 'Color'), ...typeIds.map((t) => h('th', {}, typeName(t))))), h('tbody', {}, rows))),
      h('p', { class: 'fine' }, note)));
  }
  root.replaceChildren(wrap);
}
