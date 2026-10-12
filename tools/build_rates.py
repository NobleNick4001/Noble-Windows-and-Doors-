#!/usr/bin/env python3
"""Rebuild data/rates.json + data/milgard_material_rates.csv from tools/milgard_quote_lines.json.
Material-only rate C = quoted line price / (W+H). Labor is NOT in the rate (separate line item).
Recommended (p75) = 75th percentile of C per series/color/type; max = highest C.
Missing colors estimated from V250 color ratios (computed separately for max and p75);
A250 bronze anodized stands in for A250 black/black."""
import json, csv, os
import numpy as np
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
rows = json.load(open('tools/milgard_quote_lines.json'))
SERIES = ['V250', 'V300', 'V400', 'A250']
COLORS = ['White/White', 'Black/White', 'Black/Black', 'Bronze Anodized/Bronze Anodized']
TYPES = ['Horizontal Slider', 'Vertical Slider (Single Hung)', 'Picture', 'Casement', 'Shape / Arch Top']
tmap = dict(zip(TYPES, ['hslider', 'vslider', 'picture', 'casement', 'arch']))
cmap = dict(zip(COLORS, ['ww', 'bw', 'bb', 'bronze']))
BRZ = COLORS[3]
vals = {}
for s in SERIES:
    for c in COLORS:
        for t in TYPES:
            a = np.array([r['price'] / r['wh'] for r in rows if r['series'] == s and r['color'] == c and r['type'] == t])
            if len(a): vals[(s, c, t)] = dict(avg=a.mean(), max=a.max(), p75=np.percentile(a, 75), n=len(a), est=False, basis=f'Real quote lines, n={len(a)}')
ratio = lambda t, c, k: vals[('V250', c, t)][k] / vals[('V250', 'Black/Black', t)][k]
for s in SERIES:
    for c in (COLORS if s == 'A250' else COLORS[:3]):
        for t in TYPES:
            if (s, c, t) in vals: continue
            bc = BRZ if s == 'A250' else 'Black/Black'
            b = vals[(s, bc, t)]
            if c == 'Black/Black':
                v = dict(avg=b['avg'], max=b['max'], p75=b['p75'], basis='A250 black/black assumed = quoted bronze anodized')
            else:
                v = dict(avg=b['avg'] * ratio(t, c, 'avg'), max=b['max'] * ratio(t, c, 'max'), p75=b['p75'] * ratio(t, c, 'p75'), basis=f"{s} {'bronze' if s=='A250' else 'black/black'} x V250 {c} ratio")
            v['max'] = max(v['max'], v['p75']); v.update(n=0, est=True)
            vals[(s, c, t)] = v
rates = {}
for (s, c, t), v in vals.items():
    if s == 'A250' and c == 'Bronze Anodized/Bronze Anodized' and False: continue
    rates[f'{s}|{cmap[c]}|{tmap[t]}'] = {'p75': round(v['p75'], 4), 'max': round(v['max'], 4), 'estimated': v['est'], 'n': v['n']}
d = json.load(open('data/rates.json'))
d['brands'][0]['rates'] = rates
# Adobe: not quoted. Derived at runtime = white/white rate x multiplier (single editable number in rates.json:
# brands[0].derivedColors.adobe.multiplier). Kept if already set; default 1.00.
brand = d['brands'][0]
adobe = {'from': 'ww', 'multiplier': brand.get('derivedColors', {}).get('adobe', {}).get('multiplier', 1.0)}
brand['derivedColors'] = {'adobe': adobe}
for se in brand['series']:
    if se['id'].startswith('V') and 'adobe' not in se['colors']:
        se['colors'].append('adobe')
if not any(c['id'] == 'adobe' for c in d['colors']):
    d['colors'].append({'id': 'adobe', 'name': 'Adobe', 'swatch': '#C8A27A', 'frame': 'adobe'})
d['_readme'] = ("RATE TABLE (material only). Window price = (width_in + height_in) x rate. Rates are customer prices for the WINDOW ONLY: Noble's 40% margin is included; "
  "labor/installation, tax and shipping are NOT (installation is a separate line item, see data/install.json). 'p75' = recommended (75th percentile of quoted $/in), 'max' = highest observed. "
  "'estimated': true = not from a real quote (hidden from customers). To add a brand/series: add entries under brands[].series and brands[].rates using key 'SERIES|colorId|typeId'. See README.md.")
d.pop('laborIncludedPerWindow', None); d['laborIncluded'] = False; d['version'] = 2
json.dump(d, open('data/rates.json', 'w'), indent=1)
with open('data/milgard_material_rates.csv', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['series', 'color', 'type', 'status', 'n_quoted', 'avg_rate', 'max_rate', 'p75_rate_RECOMMENDED', 'basis'])
    for s in SERIES:
        for c in (COLORS if s == 'A250' else COLORS[:3]):
            for t in TYPES:
                v = vals[(s, c, t)]
                w.writerow([s, c, t, 'ESTIMATED' if v['est'] else 'QUOTED', v['n'], round(v['avg'], 4), round(v['max'], 4), round(v['p75'], 4), v['basis']])
    # Adobe rows (derived = white/white x multiplier; ESTIMATED)
    m = adobe['multiplier']
    for s_ in ['V250', 'V300', 'V400']:
        for t in TYPES:
            v = vals[(s_, 'White/White', t)]
            w.writerow([s_, 'Adobe', t, 'ESTIMATED', 0, round(v['avg'] * m, 4), round(v['max'] * m, 4), round(v['p75'] * m, 4), f'Not quoted: {s_} white/white rate x adobeMultiplier ({m})'])
    # bronze rows (A250 quoted)
    for t in TYPES:
        v = vals[('A250', BRZ, t)]
        w.writerow(['A250', BRZ, t, 'QUOTED', v['n'], round(v['avg'], 4), round(v['max'], 4), round(v['p75'], 4), v['basis'] + ' (A250 black/black uses this)'])
print(len(rates), 'rates')
