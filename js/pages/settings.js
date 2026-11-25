import { h, data, settings, getRate, saveSettings, loadSettings, store, estimates, toast, colorName, typeName, fmt, variableRateInfo, isCustomLine } from '../core.js';
import { isAdmin } from '../cloud.js';

let unlocked = false;
export function render(root) {
  const s = JSON.parse(JSON.stringify(settings));
  const showRates = unlocked || (!s.adminPin && isAdmin());
  const commit = () => { saveSettings(s); };
  const f = (label, get, set, type = 'text', id) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), h('input', { type, id, value: get(), inputmode: type === 'number' ? 'decimal' : null, oninput: (e) => { set(e.target.value); commit(); } }));
  const wrap = h('div', { class: 'page set' }, h('h1', {}, 'Settings'));
  wrap.append(h('div', { class: 'card', id: 'settings-you' },
    f('Your name on the agreement', () => s.salesperson || '', (v) => (s.salesperson = v), 'text', 's-salesperson'),
    f('Phone on the estimate', () => s.company.phone, (v) => (s.company.phone = v), 'tel', 's-phone')));
  wrap.append(h('div', { class: 'card' }, h('h3', {}, 'Company info (shown on estimates)'),
    f('Company name', () => s.company.name, (v) => (s.company.name = v)), f('Address', () => s.company.address, (v) => (s.company.address = v)),
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
  if (s.adminPin && !unlocked) {
    const inp = h('input', { type: 'password', inputmode: 'numeric', id: 'pin', placeholder: 'PIN', autocomplete: 'off' });
    wrap.append(h('div', { class: 'card', id: 'price-pin' }, h('h3', {}, 'Price tables'), h('p', {}, 'Enter the admin PIN to see price tables.'), inp, h('button', { class: 'btn primary', onclick: () => { if (inp.value === s.adminPin) { unlocked = true; render(root); } else toast('Wrong PIN'); } }, 'Unlock')));
  }
  if (showRates) {
    const rateSet = h('div', { class: 'seg' },
      h('button', { class: 'seg-btn' + (s.rateSet === 'p75' ? ' on' : ''), id: 'rs-p75', onclick: () => { s.rateSet = 'p75'; commit(); render(root); } }, 'Recommended'),
      h('button', { class: 'seg-btn' + (s.rateSet === 'max' ? ' on' : ''), id: 'rs-max', onclick: () => { s.rateSet = 'max'; commit(); render(root); } }, 'Highest quoted'));
    wrap.append(h('div', { class: 'card', id: 'price-tables' },
      h('h3', {}, 'Pricing'),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Rate set (admin)'), rateSet),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.roundToDollar ? 'checked' : null, onchange: (e) => { s.roundToDollar = e.target.checked; commit(); } }), h('span', {}, 'Round prices to whole dollars')),
      f('Estimate valid for (days)', () => s.validDays, (v) => (s.validDays = parseInt(v) || 30), 'number'),
      h('p', { class: 'fine' }, 'Installation is one price. Shipping is $150. Sales tax is 9.1% of the materials.'),
      h('p', { class: 'fine', id: 'prl-rate-note' }, 'PRL multi-slide and bifold prices are in data/prl.json. Bronze anodized, 3 to 5 panels, inside the sheet’s width and height. Anything else says Get a PRL quote or is left blank.')));
  }
  // rate table viewer (admin). Fitted cells are selling prices from the quote model.
  const trimNum = (n) => String(Math.round(Number(n) * 10000) / 10000);
  const activeBrands = showRates ? data.rates.brands.filter((x) => x.status === 'active' && x.series?.length && x.id !== 'prl') : [];
  for (const b of activeBrands) {
    const typeIds = [...new Set(b.series.flatMap((se) => se.types))];
    const rows = [];
    for (const se of b.series) for (const c of se.colors) rows.push(h('tr', {}, h('td', {}, se.id), h('td', {}, colorName(c)), ...typeIds.map((t) => {
      if (!se.types.includes(t)) return h('td', {}, '—');
      const info = variableRateInfo(b.id, se.id, c, t);
      const a250Rate = b.id === 'milgard' && se.id === 'A250' ? data.milgardOnelink?.a250Windows?.perUI?.[t] : null;
      if (info?.unavailable) return h('td', { class: 'est' }, 'Not available', h('div', { class: 'fine' }, 'cannot be added'));
      if (info?.pricePending) return h('td', { class: 'est' }, 'Price pending', h('div', { class: 'fine' }, 'placeholder, not OneLink'));
      if (info?.onelink && a250Rate) return h('td', { class: 'from-quotes' }, a250Rate.toFixed(2), h('div', { class: 'fine' }, '$ per UI · from quotes'));
      if (info?.onelink && (info.base || info.perUI)) {
        const bits = [];
        if (info.base) bits.push('$' + info.base.toFixed(2));
        if (info.perUI) bits.push(trimNum(info.perUI) + '/UI');
        if (info.adderSpec && info.adderSpec.flat == null) {
          const parts = [];
          if (info.adderSpec.base) parts.push(String(info.adderSpec.base));
          if (info.adderSpec.perUI) parts.push(info.adderSpec.perUI + '/UI');
          let formula = parts.join(' + ') || '0';
          if (info.adderSpec.min != null) formula = `max(${info.adderSpec.min}, ${formula})`;
          bits.push('color ' + formula);
        } else if (info.adder) bits.push('color +$' + info.adder.toFixed(2));
        const fine = info.provisional ? 'Provisional price' : (info.min ? `base + united inches · min ${fmt(info.min)}` : 'base + united inches');
        return h('td', { class: 'from-quotes' }, bits.join(' + '), h('div', { class: 'fine' }, fine));
      }
      if (info?.onelink) return h('td', { class: 'from-quotes' }, 'OneLink', h('div', { class: 'fine' }, 'grid'));
      if (info?.blocked) return h('td', { class: 'est' }, 'Not priced', h('div', { class: 'fine' }, 'no iQ color'));
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
      ? 'OneLink = grid price for V250, V300, and V400 windows and for V300, V400, and A250 patio doors. Customer price is never under OneLink. A250 windows are $ per inch of width + height from Milgard A250 quotes (Clear and Bronze Anodized same price). Double casement White and Black/White are base + $ per inch of width + height (V300 Trinsic, V400 Tuscany). Adobe uses that White price. V250 double casement, Bronze, and Black/Black stay Price pending. Double Single Hung is two single hungs mulled as one unit: base + $ per inch of width + height on V250, V300, and V400. White and Black exterior / White interior are priced. Adobe uses that White price. V250 White has a $566 minimum. Bronze and Black/Black stay Price pending. Arch and eyebrow XO, XOX, arch single hung, and half-round single hung use the formulas in pendingWindows and round up to the next dollar. V400 black is a flat adder. V300 and V250 arch XO and V300 arch single hung black are formula adders on the White price, flagged Provisional price. Not available cannot be added. The old equal-leg arch top row stays Price pending. E marks a stored rate the grid does not cover.'
      : b.id === 'iwc'
        ? '8200 windows and 8900 doors in Bronze Anodized are from quotes. Clear Anodized, Mojave Beige, and White use the custom supplier-price line.'
        : 'Andersen 100 is the iQ formula: base + $ per inch of width and height + $ per sq ft, then flush fin (factor + adder) and a flat color adder, rounded up to the next dollar. White is the base. Any non-white exterior adds $90.57, and a black interior adds that again. The 2-panel patio door has its own color adders. Nail fin is the base price. E marks the old $/inch table, which is not the selling price.';
    wrap.append(h('div', { class: 'card' }, h('h3', {}, `${b.name} material rates`), h('div', { class: 'scroll' }, h('table', { class: 'rates' }, h('thead', {}, h('tr', {}, h('th', {}, 'Series'), h('th', {}, 'Color'), ...typeIds.map((t) => h('th', {}, typeName(t))))), h('tbody', {}, rows))),
      h('p', { class: 'fine' }, note)));
  }
  root.replaceChildren(wrap);
}
