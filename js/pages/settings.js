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
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.roundToDollar ? 'checked' : null, onchange: (e) => { s.roundToDollar = e.target.checked; commit(); } }), h('span', {}, 'Round prices to whole dollars')),
    f('Estimate valid for (days)', () => s.validDays, (v) => (s.validDays = parseInt(v) || 30), 'number'),
    h('p', { class: 'fine' }, 'Every estimate includes Shipping & Handling of $150 and sales tax of 9.1% on materials after promo codes and the additional percent discount. Tax does not apply to labor, add-ons, stucco, extras, or shipping. Promo codes and the additional discount do not discount shipping. The deposit is 60% and the final payment is 40%.'),
    h('p', { class: 'fine' }, 'Milgard windows and patio doors use the OneLink grid. Andersen 100 uses the iQ formula and always rounds up to the next dollar. That toggle above does not change Andersen prices. IWC keeps its fitted prices. Installation, add-ons, and stucco are one Installation / Labor line.')));
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
      const a250Rate = b.id === 'milgard' && se.id === 'A250' ? data.milgardOnelink?.a250Windows?.perUI?.[t] : null;
      if (info?.pricePending) return h('td', { class: 'est' }, 'Price pending', h('div', { class: 'fine' }, 'placeholder, not OneLink'));
      if (info?.onelink && a250Rate) return h('td', { class: 'from-quotes' }, a250Rate.toFixed(2), h('div', { class: 'fine' }, '$ per UI · from quotes'));
      if (info?.onelink && (info.base || info.perUI)) {
        const bits = [];
        if (info.base) bits.push('$' + info.base.toFixed(2));
        if (info.perUI) bits.push(trimNum(info.perUI) + '/UI');
        return h('td', { class: 'from-quotes' }, bits.join(' + '), h('div', { class: 'fine' }, info.min ? `base + united inches · min ${fmt(info.min)}` : 'base + united inches'));
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
      ? 'OneLink = grid price for V250, V300, and V400 windows and for V300, V400, and A250 patio doors. Customer price is never under OneLink. A250 windows are $ per inch of width + height from Milgard A250 quotes (Clear and Bronze Anodized same price). Double casement White and Black/White are base + $ per inch of width + height (V300 Trinsic, V400 Tuscany). Adobe uses that White price. V250 double casement, Bronze, Black/Black, and the arch top stay Price pending. Double Single Hung is two single hungs mulled as one unit: base + $ per inch of width + height on V250, V300, and V400. White and Black exterior / White interior are priced. Adobe uses that White price. V250 White has a $566 minimum. Bronze and Black/Black stay Price pending. Price pending is a placeholder in pendingWindows, not a real OneLink number. E marks a stored rate the grid does not cover.'
      : b.id === 'iwc'
        ? '8200 windows and 8900 doors in Bronze Anodized are from quotes. Clear Anodized, Mojave Beige, and White use the custom supplier-price line.'
        : 'Andersen 100 is the iQ formula: base + $ per inch of width and height + $ per sq ft, then flush fin (factor + adder) and a flat color adder, rounded up to the next dollar. White is the base. Any non-white exterior adds $90.57, and a black interior adds that again. The 2-panel patio door has its own color adders. Nail fin is the base price. E marks the old $/inch table, which is not the selling price.';
    wrap.append(h('div', { class: 'card' }, h('h3', {}, `${b.name} material rates`), h('div', { class: 'scroll' }, h('table', { class: 'rates' }, h('thead', {}, h('tr', {}, h('th', {}, 'Series'), h('th', {}, 'Color'), ...typeIds.map((t) => h('th', {}, typeName(t))))), h('tbody', {}, rows))),
      h('p', { class: 'fine' }, note)));
  }
  root.replaceChildren(wrap);
}
