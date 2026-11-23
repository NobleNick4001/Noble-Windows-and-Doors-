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
check(series['types'] == ['hslider', 'xox', 'vslider', 'twin_vslider', 'picture', 'casement', 'twin_casement', 'awning', 'arch_sh', 'specialty_arch', 'patio_door_2p'], 'Andersen types ' + str(series['types']))
check('3panel' not in series['types'] and '4panel' not in series['types'], 'no 3- or 4-panel Andersen door')
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

# The stored $/inch table is the old fallback. New iQ types do not need a cell there.
for color in series['colors']:
    for typ in ('hslider', 'xox', 'vslider', 'picture', 'casement', 'arch', 'awning'):
        key = f"100|{color}|{typ}"
        rec = brand['rates'].get(key)
        check(rec is not None, 'missing ' + key)
        if not rec: continue
        check(bool(rec['estimated']) == (rec['n'] < 3), f'{key} estimated={rec["estimated"]} n={rec["n"]}')
        check(rec['max'] + 1e-9 >= rec['p75'], key + ' max < p75')

import math
vr = json.load(open('data/variable-rates.json'))
A = vr['andersen']
check(A.get('round') == 'up' and A.get('series') == '100', 'Andersen iQ round-up model')
check(A.get('aliases', {}).get('arch') == 'specialty_arch', 'old arch id prices as specialty arch')
check(set(A['types']) == set(series['types']), 'every Andersen type has an iQ formula')
window_colors = A['colorAdders']['window']
check(window_colors['ww'] == 0, 'white is the base color')
check(window_colors['sandtone'] == window_colors['terratone'] == window_colors['dkbronze'] == window_colors['bw'] == 90.57, 'non-white exterior adder')
check(window_colors['bb'] == 181.13 and window_colors['dkbronze_dkbronze'] == 181.13, 'dark interior adder')
check(window_colors['sandtone'] != window_colors['bb'], 'Sandtone is not the Black/Black price')
door_colors = A['colorAdders']['patio_door_2p']
check(set(k for k, v in door_colors.items() if isinstance(v, (int, float))) == {'ww', 'bw', 'bb'}, 'patio door colors')
check(A['types']['patio_door_2p'].get('flushFin') is None and A['types']['arch_sh'].get('flushFin') is None, 'arch single hung and the door have no flush-fin upcharge')
check(A['types']['twin_vslider'].get('integral') and A['types']['twin_casement'].get('integral'), 'twins are one combined unit')
for typ, spec in A['types'].items():
    check('limits' in spec and 'w' in spec['limits'] and 'h' in spec['limits'], typ + ' needs size limits')
    check('base' in spec and 'perUI' in spec and 'perSqFt' in spec, typ + ' needs the iQ formula')

def ceil_dollar(n):
    cents = math.floor(n * 100 + 0.5) / 100
    nearest = math.floor(cents + 0.5)
    if abs(cents - nearest) < 1e-6:
        return nearest
    return math.ceil(cents - 1e-9)

xo_spec = A['types']['hslider']
material = ceil_dollar(xo_spec['base'] + xo_spec['perUI'] * (70 + 60) + xo_spec['perSqFt'] * 70 * 60 / 144)
check(material == 1041, f'70x60 white XO material {material} != 1041')

# Old $/inch cells stay as the unused fallback table. The selling price is the iQ formula.
for color in series['colors']:
    for typ in series['types']:
        if typ in A['types']:
            continue
        key = f"100|{color}|{typ}"
        rec = brand['rates'].get(key)
        check(rec is not None, 'missing ' + key)

xo = brand['rates']['100|ww|hslider']
check(abs(xo['p75'] - 9.5609) < 1e-9, 'white XO stored p75 stays the 40% quote rate')
check(rates.get('grossMargin') == 0.45, 'grossMargin should be the one 45% selling margin')
factor = 0.60 / (1 - rates['grossMargin'])
check(abs(factor - (0.60 / 0.55)) < 1e-12, '45% margin factor')
check(xo['estimated'] is False and xo['n'] >= 3, 'white XO should not be a thin-sample estimate')
check(brand['rates']['100|ww|awning']['estimated'] is True, 'awning stored cell stays a thin sample')
check(brand['rates']['100|ww|xox']['estimated'] is True, 'xox stored cell stays a thin sample')
check(brand['rates']['100|ww|arch']['n'] >= 3 and brand['rates']['100|ww|arch']['estimated'] is False, 'arch stored cell stays quoted')

install = json.load(open('data/install.json'))
std = next(t for t in install['types'] if t['id'] == 'standard')
check(std['price'] == 360, 'standard labor should stay $360 and out of the material rate')
check(rates.get('laborIncluded') is False, 'laborIncluded should stay false')
settings = json.load(open('data/settings.default.json'))
check(settings.get('rateSet') == 'p75', 'default rate set is P75')

sw = open('sw.js').read()
check("const CACHE = 'nwd-sales-v76-prl-doors'" in sw, 'service worker cache should be nwd-sales-v76-prl-doors')
check('js/vendor/supabase-js-2.119.0.mjs' in sw, 'vendored supabase-js should be precached')
check(os.path.isfile('js/vendor/supabase-js-2.119.0.mjs'), 'vendored supabase-js bundle missing')
cloud = open('js/cloud.js').read()
check("./vendor/supabase-js-2.119.0.mjs" in cloud, 'sign-in should import the vendored supabase-js')
check('cdn.jsdelivr.net/npm/@supabase/supabase-js' in cloud, 'jsDelivr stays as the supabase-js fallback')
check("Couldn't load sign-in. Check your connection or reload the app." in cloud, 'a failed sign-in client should say to reload')
check('Sign-in needs a connection' not in cloud, 'online sign-in should not claim it needs a connection')
check('js/ax650.js' in sw and 'data/milgard-ax650.json' in sw, 'AX650 price file and engine should be precached')
check('js/prl.js' in sw and 'js/pages/prl-ui.js' in sw and 'data/prl.json' in sw, 'PRL price file and picker should be precached')
check('js/drawings.js' in sw, 'window drawings should be precached')
check('data/variable-rates.json' in sw, 'variable rates should be precached')
check('data/promos.json' in sw, 'promo config should be precached')
check('data/purchase-agreement.json' in sw, 'purchase agreement should be precached')
check('js/pages/contract.js' in sw and 'js/pdf.js' in sw and 'js/sign.js' in sw and 'js/vendor/jspdf.umd.min.js' in sw, 'contract scripts should be precached')
check('js/cloud.js' in sw and 'js/pages/auth.js' in sw and 'js/pages/admin.js' in sw and 'js/pages/accounts.js' in sw and 'supabase/functions/account-passwords/password.js' in sw, 'account scripts should be precached')
check('js/door-figure.js' in sw and 'js/pages/prehung-ui.js' in sw, 'prehung door scripts should be precached')
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
check('js/pages/brochures.js' in sw, 'brochures page should be precached')
precache = sw.split('const PRECACHE', 1)[1].split('];', 1)[0]
check('js/vendor/pdf.min.mjs' in precache and 'js/vendor/pdf.worker.min.mjs' in precache, 'pdf.js viewer should be precached')
for pdf in ('milgard-v250-style-line.pdf', 'milgard-v300-trinsic.pdf', 'milgard-v400-tuscany.pdf', 'milgard-c700-fiberglass.pdf', 'milgard-a250-aluminum.pdf', 'milgard-ax650-bifold.pdf', 'milgard-ax650-stacking.pdf', 'milgard-ax650-pocket.pdf', 'milgard-patio-doors.pdf', 'milgard-window-selection-guide.pdf', 'andersen-100-series.pdf', 'prl-max-slider-multi-slide-door.pdf', 'prl-bottom-rolling-bifold-door.pdf', 'why-therma-tru-flyer-2026.pdf', 'therma-tru-classic-craft-brochure-2026.pdf', 'therma-tru-enliten-flush-glazed-catalog.pdf', 'therma-tru-prismaguard-brochure.pdf', 'orepac-therma-tru-southwest-region-catalog.pdf', 'therma-tru-fiberglass-steel-catalog-2026.pdf'):
    check(os.path.isfile('brochures/' + pdf), 'missing brochure ' + pdf)
    check(pdf not in precache, 'brochure PDF should not be precached: ' + pdf)
for old in ('milgard-trinsic-v300.pdf', 'milgard-tuscany-v400.pdf', 'milgard-vinyl-line.pdf', 'milgard-series-comparison-chart.pdf'):
    check(not os.path.exists('brochures/' + old), 'old Milgard brochure should be removed: ' + old)
check('andersen-100-product-guide' not in sw and not os.path.exists('brochures/andersen-100-product-guide.pdf'), 'do not ship the Andersen 100 product guide')

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
check(len(gs) == 56, 'gallery should have 56 photos')
check(all(s.get('source') == 'nick' for s in gs[:25]), 'first 25 slides are Nick photos')
check(all(s.get('group') == 'before-after' for s in gs[25:31]), 'before and after photos follow Nick')
check(all(s.get('group') == 'noble-projects' for s in gs[31:]), 'website photos follow as Noble projects')
check([g['label'] for g in gallery['groups']] == ['Milgard V300', 'Milgard V400 Tuscany', 'Andersen 100', 'Andersen 100 Retrofit', 'Multi Slides', 'Before & After', 'Noble projects'], 'filter labels')
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

ax = json.load(open('data/milgard-ax650.json'))
check(ax.get('sourceQuote') == 'MQPASG000219-1', 'AX650 source quote')
check(ax.get('applyMargin') is False and ax.get('pricesAre') == 'customer', 'AX650 prices are customer prices and are not marked up again')
check(ax.get('marginAlreadyIncluded') == 0.45, 'AX650 45% margin is already included')
check(ax.get('glass') == 'Tempered SunCoatMAX' and ax.get('screens') is False, 'AX650 glass is fixed and there is no screen')
inst = ax.get('install') or {}
check(inst.get('applyMargin') is False and inst.get('pricesAre') == 'customer', 'AX650 install is a customer price')
check(inst.get('flat') == 500 and inst.get('perPanel') == 500, 'AX650 install is $500 plus $500 per panel')
check('not priced yet' not in open('js/core.js').read(), 'AX650 install note should be gone')
check([b['upTo'] for b in ax['height']['bands']] == [80, 96, 119.5], 'AX650 height bands')
check(ax['height']['min'] == 79.5 and ax['height']['max'] == 119.5, 'AX650 height range')
expected_ax = {
    'stack2': [11492.22, 12643.57, 14636.36],
    'stack3': [16637.12, 17611.28, 20988.34],
    'stack4': [22381.90, 23689.86, 28206.98],
    'pocket2': [12098.76, 12667.46, 15251.52],
    'pocket3': [17726.08, 18645.83, 20174.10],
    'pocket4': [22565.72, 23774.13, 28591.87],
    'bifold3': [17320.23, 19715.01, 22251.89],
    'bifold4': [23136.01, 25256.59, 27879.05],
    'bifold5': [30047.82, 35436.50, 40298.36],
}
ids = [m['id'] for m in ax['models']]
check(ids == list(expected_ax), 'AX650 models ' + str(ids))
check('pocket' not in ax, 'pocket is its own model, not an adder')
for model in ax['models']:
    check(model['customerPrice'] == expected_ax[model['id']], model['id'] + ' customer prices')
    check(model['kind'] in ('stacking', 'pocket', 'bifold'), model['id'] + ' kind')
check([c['name'] for c in ax['colors']] == ['White', 'Warmtone', 'Bronze Anodized', 'Satin Anodized'], 'AX650 colors')
import subprocess
ax_run = subprocess.run(['node', 'tools/check_ax650.mjs'], capture_output=True, text=True)
check(ax_run.returncode == 0, 'AX650 engine\\n' + ax_run.stdout + ax_run.stderr)

prl = json.load(open('data/prl.json'))
check(prl.get('pricesAre') == 'dealer' and prl.get('applyMargin') is True, 'PRL file stores dealer amounts')
ms = prl['products']['multislide']
bf = prl['products']['bifold']
check(ms['perPanel'] == 1451.53 and ms['perSqFt'] == 30.81 and ms['constant'] == -1236.96, 'multi-slide formula')
check(ms['thermalFactor'] == 1.21 and ms['nailOnScreen'] == 455, 'multi-slide thermal and nail-on screen')
check(ms['panels'] == {'min': 3, 'max': 5} and ms['width'] == {'min': 143, 'max': 287.5} and ms['height'] == {'min': 80, 'max': 120}, 'multi-slide range')
check(bf['perPanel'] == 1392.99 and bf['perSqFt'] == 25.99 and bf['constant'] == 0 and bf['bottomRollingFactor'] == 1.0555, 'bifold formula')
check(bf['panels'] == {'min': 3, 'max': 5} and bf['width'] == {'min': 95.5, 'max': 168} and bf['height'] == {'min': 80, 'max': 119}, 'bifold range')
check(prl['glass']['ea']['factor'] == 1.03 and prl['glass']['ea']['products'] == ['multislide'], 'Energy Advantage is 3% on multi-slide only')
prl_brand = next(b for b in rates['brands'] if b['id'] == 'prl')
check(prl_brand.get('status') == 'active', 'PRL brand is active')
check('Get a PRL quote' in open('js/prl.js').read(), 'unpriced PRL options say Get a PRL quote')
prl_run = subprocess.run(['node', 'tools/check_prl.mjs'], capture_output=True, text=True)
check(prl_run.returncode == 0, 'PRL engine\\n' + prl_run.stdout + prl_run.stderr)

if errs:
    print('FAILED')
    for e in errs: print(' -', e)
    sys.exit(1)
print(f'ok  Andersen XO white 70x60 material ${material:,.2f}  + labor ${std["price"]:.0f} separate')
