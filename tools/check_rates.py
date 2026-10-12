#!/usr/bin/env python3
"""Spot-checks for Andersen 100 Series material rates and the obscure-glass set."""
import json, os, sys
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

def money(n):
    # Match JS Math.round for positive amounts: half away from zero, to the cent.
    return int(n * 100 + 0.5) / 100

errs = []
def check(ok, msg):
    if not ok: errs.append(msg)

rates = json.load(open('data/rates.json'))
brand = next(b for b in rates['brands'] if b['id'] == 'andersen')
check(brand.get('status') == 'active', 'Andersen should be active')
series = brand['series'][0]
check(series['id'] == '100', 'series id')
check(series['colors'] == ['ww', 'sandtone', 'terratone', 'bw', 'dkbronze', 'bb'], 'Andersen colors ' + str(series['colors']))
check(series['types'] == ['hslider', 'xox', 'vslider', 'picture', 'casement', 'arch', 'awning'], 'Andersen types ' + str(series['types']))
color_ids = {c['id'] for c in rates['colors']}
type_ids = {t['id'] for t in rates['types']}
check({'sandtone', 'terratone', 'dkbronze'} <= color_ids, 'new colors missing from colors[]')
check({'awning', 'xox'} <= type_ids, 'new types missing from types[]')
check(next(b for b in rates['brands'] if b['id'] == 'iwc')['status'] == 'coming_soon', 'IWC should stay coming soon')

for color in series['colors']:
    for typ in series['types']:
        key = f"100|{color}|{typ}"
        rec = brand['rates'].get(key)
        check(rec is not None, 'missing ' + key)
        if not rec: continue
        check(bool(rec['estimated']) == (rec['n'] < 3), f'{key} estimated={rec["estimated"]} n={rec["n"]}')
        check(rec['max'] + 1e-9 >= rec['p75'], key + ' max < p75')

for typ in series['types']:
    w, s = brand['rates'][f'100|ww|{typ}'], brand['rates'][f'100|sandtone|{typ}']
    check(w['p75'] == s['p75'] and w['max'] == s['max'] and w['n'] == s['n'], 'Sandtone should match White for ' + typ)

xo = brand['rates']['100|ww|hslider']
check(abs(xo['p75'] - 9.5609) < 1e-9, 'white XO p75')
material = money((70 + 60) * xo['p75'])
check(material == 1242.92, f'70x60 white XO material {material} != 1242.92')
check(abs((70 + 60) * xo['p75'] - 1243) < 1, 'about $1,243')
check(xo['estimated'] is False and xo['n'] >= 3, 'white XO should not be a thin-sample estimate')
check(brand['rates']['100|ww|awning']['estimated'] is True, 'awning n<3 should be estimated')
check(brand['rates']['100|ww|xox']['estimated'] is True, 'xox n<3 should be estimated')
check(brand['rates']['100|ww|arch']['n'] >= 3 and brand['rates']['100|ww|arch']['estimated'] is False, 'arch n>=3 quoted')

install = json.load(open('data/install.json'))
std = next(t for t in install['types'] if t['id'] == 'standard')
check(std['price'] == 360, 'standard labor should stay $360 and out of the material rate')
check(rates.get('laborIncluded') is False, 'laborIncluded should stay false')
settings = json.load(open('data/settings.default.json'))
check(settings.get('rateSet') == 'p75', 'default rate set is P75')

sw = open('sw.js').read()
check("const CACHE = 'nwd-sales-v10'" in sw, 'service worker cache should be nwd-sales-v10')
for name in ('cascade.png', 'fern.png', 'obscure.png', 'reed.png', 'satin-etch.png'):
    check(f'assets/obscure/{name}' in sw, 'sw missing ' + name)
    check(os.path.isfile(f'assets/obscure/{name}'), 'missing file ' + name)

glass = json.load(open('data/obscure-glass.json'))
names = [p['name'] for p in glass['patterns']]
check(names == ['Cascade', 'Fern', 'Obscure', 'Reed', 'Satin Etch'], 'patterns ' + str(names))
by = {p['name']: p for p in glass['patterns']}
check(all(p.get('brand') == 'Andersen' for p in glass['patterns']), 'every pattern should be labelled Andersen')
check(by['Reed']['privacy'] == 3 and by['Satin Etch']['privacy'] == 5, 'keep generic Reed/Satin ratings')
check(by['Cascade']['privacy'] is None and by['Fern']['privacy'] is None and by['Obscure']['privacy'] is None, 'do not invent Cascade/Fern/Obscure ratings')

if errs:
    print('FAILED')
    for e in errs: print(' -', e)
    sys.exit(1)
print(f'ok  Andersen XO white 70x60 material ${material:,.2f}  + labor ${std["price"]:.0f} separate')
