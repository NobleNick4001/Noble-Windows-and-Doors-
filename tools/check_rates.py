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
check(series['colors'] == ['ww', 'sandtone', 'terratone', 'bw', 'dkbronze', 'dkbronze_dkbronze', 'bb'], 'Andersen colors ' + str(series['colors']))
check(series['types'] == ['hslider', 'xox', 'vslider', 'picture', 'casement', 'arch', 'awning'], 'Andersen types ' + str(series['types']))
color_ids = {c['id'] for c in rates['colors']}
type_ids = {t['id'] for t in rates['types']}
names = {c['id']: c['name'] for c in rates['colors']}
check({'sandtone', 'terratone', 'dkbronze', 'dkbronze_dkbronze'} <= color_ids, 'new colors missing from colors[]')
check({'awning', 'xox', 'hvb', 'custom_supplier'} <= type_ids, 'new types missing from types[]')
check(names.get('dkbronze') == 'Dark Bronze / White', 'dkbronze display name')
check(names.get('dkbronze_dkbronze') == 'Dark Bronze / Dark Bronze', 'same-color dark bronze')
iwc = next(b for b in rates['brands'] if b['id'] == 'iwc')
check(iwc['status'] == 'active', 'IWC should be active')
check({s['id'] for s in iwc['series']} >= {'8200', '8900'}, 'IWC 8200 windows and 8900 doors')

for color in series['colors']:
    for typ in series['types']:
        key = f"100|{color}|{typ}"
        rec = brand['rates'].get(key)
        check(rec is not None, 'missing ' + key)
        if not rec: continue
        check(bool(rec['estimated']) == (rec['n'] < 3), f'{key} estimated={rec["estimated"]} n={rec["n"]}')
        check(rec['max'] + 1e-9 >= rec['p75'], key + ' max < p75')

vr = json.load(open('data/variable-rates.json'))
sand, black, white = (vr['andersen']['colors'][k] for k in ('sandtone', 'bb', 'ww'))
check(sand['ratio'] == black['ratio'] == 1.0 and sand['adjustPerUnit'] == black['adjustPerUnit'] == 0, 'Sandtone is priced like Black')
check(white['adjustPerUnit'] == -191.71 and white['ratio'] == 1.0, 'White/White credit')

def variable_sell(color, typ='hslider', w=70, h=60):
    t = vr['andersen']['types'][typ]
    c = vr['andersen']['colors'][color]
    core = t['base'] + t['perUI'] * (w + h) + t['perSqFt'] * w * h / 144
    return money(core * c['ratio'] + c['adjustPerUnit'])

check(variable_sell('sandtone') == variable_sell('bb'), 'Sandtone selling price equals Black')
check(variable_sell('sandtone') != variable_sell('ww'), 'Sandtone is no longer priced like White')

xo = brand['rates']['100|ww|hslider']
check(abs(xo['p75'] - 9.5609) < 1e-9, 'white XO stored p75 stays the 40% quote rate')
check(rates.get('grossMargin') == 0.45, 'grossMargin should be the one 45% selling margin')
factor = 0.60 / (1 - rates['grossMargin'])
check(abs(factor - (0.60 / 0.55)) < 1e-12, '45% margin factor')
# Selling price is the variable model, not stored p75 × marginFactor.
material = variable_sell('ww')
check(material == 1032.63, f'70x60 white XO material {material} != 1032.63')
check(abs((115.53 + 8.5293 * 130) - 191.71 - 1032.63) < 0.01, 'Andersen XO white formula')
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
check("const CACHE = 'nwd-sales-v40-room-label'" in sw, 'service worker cache should be nwd-sales-v40-room-label')
check('data/variable-rates.json' in sw, 'variable rates should be precached')
check('data/promos.json' in sw, 'promo config should be precached')
check('data/purchase-agreement.json' in sw, 'purchase agreement should be precached')
check('js/pages/contract.js' in sw and 'js/pdf.js' in sw and 'js/sign.js' in sw and 'js/vendor/jspdf.umd.min.js' in sw, 'contract scripts should be precached')
check('js/cloud.js' in sw and 'js/pages/auth.js' in sw and 'js/pages/admin.js' in sw, 'account scripts should be precached')
check(settings.get('salesperson') == '', 'salesperson name defaults blank')
agreement = json.load(open('data/purchase-agreement.json'))
check(agreement.get('depositPct') == 60, 'deposit percent is 60')
check('60% of total' in agreement.get('depositLabel', ''), 'deposit label is 60%')
check('40%' in agreement.get('balanceLabel', ''), 'balance label is 40%')
check('65%' not in agreement.get('depositLabel', '') and '35%' not in agreement.get('balanceLabel', ''), 'old 65/35 labels are gone')
check(len(agreement.get('clauses') or []) == 16, 'purchase agreement keeps all 16 terms')
for name in ('cascade.png', 'fern.png', 'obscure.png', 'reed.png', 'satin-etch.png'):
    check(f'assets/obscure/{name}' in sw, 'sw missing ' + name)
    check(os.path.isfile(f'assets/obscure/{name}'), 'missing file ' + name)
check('assets/gallery/gallery.json' in sw, 'gallery manifest should be precached')
check('placeholder-1.svg' not in sw, 'placeholder gallery should not be precached')
for banned in ('milgard-v300-01.jpg', 'site-finished-01.jpg'):
    check(banned not in sw, 'gallery photo should not be precached: ' + banned)

glass = json.load(open('data/obscure-glass.json'))
sections = {s['id']: s for s in glass['sections']}
andersen = sections['andersen']['patterns']
milgard = sections['milgard']['patterns']
names = [p['name'] for p in andersen]
check(names == ['Cascade', 'Fern', 'Obscure', 'Reed', 'Satin Etch'], 'andersen patterns ' + str(names))
by = {p['name']: p for p in andersen}
check(all(p.get('brand') == 'Andersen' and p.get('image') for p in andersen), 'andersen patterns need brand and photo')
check(by['Cascade'].get('aka') == 'Rain' and by['Fern'].get('aka') == 'Single Glue Chip', 'andersen alt names')
check('Pattern 62' in by['Obscure'].get('aka', '') and by['Reed'].get('aka') == 'English Reed', 'obscure/reed alt names')
check(by['Reed']['privacy'] == 3 and by['Satin Etch']['privacy'] == 5, 'keep generic Reed/Satin ratings')
check(by['Cascade']['privacy'] is None and by['Fern']['privacy'] is None and by['Obscure']['privacy'] is None, 'do not invent Cascade/Fern/Obscure ratings')
check([p['name'] for p in milgard] == ['P516', '#42 Clear', 'Aquatex', 'Delta Frost', 'Glue Chip', 'Frosted Glue Chip', 'Narrow Reed', 'Rain', 'Satin Etch'], 'milgard pattern list')
check(all(p.get('privacy') is None and not p.get('image') for p in milgard), 'milgard patterns are name/description only, no invented ratings')
check(sections['milgard'].get('showPhotos') is False, 'milgard section is not a photo grid')
limited = {p['name'] for p in milgard if p.get('limit')}
check(limited == {'Aquatex', 'Glue Chip', 'Frosted Glue Chip'}, 'V300 Trinsic exclusions ' + str(limited))
def public_text(obj):
    if isinstance(obj, dict):
        return ' '.join(public_text(v) for k, v in obj.items() if k != '_readme')
    if isinstance(obj, list):
        return ' '.join(public_text(v) for v in obj)
    return str(obj)
check('C650' not in public_text(glass) and 'C700' not in public_text(glass), 'do not use the conflicting fiberglass codes')

gallery = json.load(open('assets/gallery/gallery.json'))
gs = gallery['slides']
check(len(gs) == 50, 'gallery should have 50 photos')
check(all(s.get('source') == 'nick' for s in gs[:25]), 'first 25 slides are Nick photos')
check(all(s.get('group') == 'noble-projects' for s in gs[25:]), 'website photos follow as Noble projects')
check([g['label'] for g in gallery['groups']] == ['Milgard V300', 'Milgard V400 Tuscany', 'Andersen 100', 'Andersen 100 Retrofit', 'Multi Slides', 'Noble projects'], 'filter labels')
check(all(os.path.isfile('assets/gallery/' + s['src']) for s in gs), 'a gallery file is missing')
check(sum(1 for s in gs if s.get('lowRes')) == 16, '760px site photos should be flagged lowRes')
check(not any(s.get('placeholder') for s in gs), 'placeholders should be gone')
srcs = {s['src'] for s in gs}
check('andersen-100-05.jpg' in srcs and 'milgard-v300-02.jpg' in srcs, 'keep the house-number and installer photos')
check('object-fit:contain' in open('css/styles.css').read().split('.thumb img')[1][:180], 'gallery thumbs should not crop')

company = settings['company']
check(company.get('phone') == '(623) 810-3460', 'confirmed company phone')
check('820-5935' not in open('data/settings.default.json').read() and '820-5935' not in open('js/pages/settings.js').read() and '820-5935' not in open('README.md').read(), 'old phone should be gone')
check(company.get('email') == 'mgr@noblewandd.com', 'site email')
lic_lines = [ln.strip() for ln in company.get('license', '').split('\n') if ln.strip()]
check(lic_lines == ['AZ ROC #364772 (KB-1)', 'AZ ROC #364771 (CR-11)'], 'both ROC lines ' + str(lic_lines))
check('6:00' in (company.get('hours') or ''), 'hours')
opts = json.load(open('data/options.json'))
blob = public_text(settings) + public_text(opts)
for stale in ('10% Off', '0% interest', '$3 per square foot', 'ProVia'):
    check(stale not in blob, 'stale or conflicting claim in app data: ' + stale)

promos = json.load(open('data/promos.json'))
by_code = {c['code'].upper(): c for c in promos['codes']}
check(set(by_code) == {'NOBLE5', 'NOBLE10', 'NOBLEBOGO'}, 'promo codes ' + str(sorted(by_code)))
check(by_code['NOBLE5']['type'] == 'percent' and by_code['NOBLE5']['percent'] == 5 and by_code['NOBLE5']['appliesToLabor'] is False, 'NOBLE5')
check(by_code['NOBLE10']['type'] == 'percent' and by_code['NOBLE10']['percent'] == 10 and by_code['NOBLE10']['appliesToLabor'] is False, 'NOBLE10')
check(by_code['NOBLEBOGO']['type'] == 'bogo' and by_code['NOBLEBOGO']['buy'] == 4 and by_code['NOBLEBOGO']['get'] == 1 and by_code['NOBLEBOGO']['appliesToLabor'] is False, 'NOBLEBOGO one free per 5')
check('grossMargin' in open('js/core.js').read() and 'appliesToLabor' in open('js/core.js').read(), 'pricing uses the margin constant and the per-code labor flag')

if errs:
    print('FAILED')
    for e in errs: print(' -', e)
    sys.exit(1)
print(f'ok  Andersen XO white 70x60 material ${material:,.2f}  + labor ${std["price"]:.0f} separate')
