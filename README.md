# Noble-Windows-and-Doors-
Sales tool

# Noble Windows & Doors — Sales App (v1)

Mobile/tablet-first web app (plain HTML/CSS/JS, no build step, no backend). Runs in Safari on iPad/iPhone, installable to the home screen (Share → Add to Home Screen), works offline after first load (service worker).

## Run locally
    python3 -m http.server 8080      # from this folder, then open http://localhost:8080
(Must be served over http(s) — not file:// — for the service worker, camera and PWA install. Camera/"Add to Home Screen" on a phone need HTTPS, e.g. GitHub Pages / Netlify / Cloudflare Pages.)

## What's in it
Calculator · Estimate (builder + printable/PDF page) · Saved estimates · Options (glass / frame series / frame types / colors / obscure glass) · Gallery + full-screen slideshow · Window preview (photo overlay) · Settings.

## Pricing model
- **Window price** (material only) = (width + height in inches) × rate, rate = $/inch for brand · series · color · type. Rates are customer prices (include Noble's 40% margin), exclude labor, tax and shipping.
- **Installation / labor is a separate per-window line** (default "Standard retrofit/replacement install" = $360) with selectable install type, surcharge checkboxes and a manual per-window price override; plus job-level extras (permit, haul-away, trim, custom).
- Estimate shows Windows subtotal, Installation subtotal, Additional items, Subtotal, optional tax, Total (before tax by default).
- Default rate set = P75 ("recommended"). Settings has an admin toggle for MAX (highest quoted). Andersen 100 uses the same toggle.

## Data files (edit these — no code changes)
| File | What |
|---|---|
| `data/rates.json` | Rate tables per brand. `brands[].series[]` lists series/colors/types; `brands[].rates["SERIES|colorId|typeId"] = {p75, max, estimated, n}`. Andersen 100 Series is active (customer prices, 40% margin included, labor separate). IWC is still `status: "coming_soon"`. `estimated:true` is internal only (shown with "E" in Settings, never to customers): derived colors, or a thin sample (`n` < 3). |
| `data/milgard_material_rates.csv` | Human-readable copy of the Milgard material-only rate table (avg / max / P75, quoted vs estimated, basis). |
| `data/andersen_100_material_rates.csv` | Human-readable Andersen 100 Series material-only rates (P75 / max, quoted vs thin-sample estimate). |
| `data/install.json` | Install types & prices, surcharges, job-extra presets. Only "standard = $360" is real; the rest are placeholder prices. |
| `data/options.json` | Glass / frame options with add-on pricing (`perWindow`, `percent`, `perSqFt`, or `included`). All placeholders ($0). |
| `data/obscure-glass.json` | Andersen privacy-glass patterns (Cascade, Fern, Obscure, Reed, Satin Etch). Photos are in `assets/obscure/` (250×250; the card and the clear-vs-pattern slider show the real photo, capped near 2× so it stays sharp). Reed privacy 3 and Satin Etch privacy 5 are the old generic ratings; Cascade, Fern, and Obscure have no rating yet. Edit name, description, and privacy here — do not guess a number. |
| `data/frame-types.json` | Customer frame-style copy (Z-bar / retrofit, block frame, nailing fin): description, best for, pros, cons, installation note. Each row’s `installType` points at a labor price in `data/install.json`. Placeholders — edit the wording here. |
| `data/settings.default.json` | Defaults: tax %, rate set, company info, estimate terms, validity days. Settings page overrides are stored on each device (localStorage). |
| `assets/gallery/gallery.json` | Slideshow manifest. Drop photos in `assets/gallery/` and add entries (instructions inside the file). |

**Adobe color** (V250/V300/V400 only) has no quote, so its rate is *derived*: white/white rate × `multiplier` in `data/rates.json` → `brands[0].derivedColors.adobe.multiplier` (default 1.00). Change that one number to reprice Adobe everywhere. Adobe cells are always flagged estimated (internal only).

Rebuild Milgard `rates.json` rows + `data/milgard_material_rates.csv` from the source quote lines: `python3 tools/build_rates.py` (reads `tools/milgard_quote_lines.json`). Rate = quoted line price ÷ (W+H); P75 = 75th percentile; missing colors on V300/V400/A250 are estimated with V250 color ratios; A250 bronze anodized stands in for A250 black/black. The script keeps whatever Adobe multiplier is already in rates.json, and it keeps the Andersen 100 brand, the Sandtone / Terratone / Dark Bronze colors, and the Awning / XOX types. It does not rebuild Andersen rates.

Andersen 100 colors: White (`ww`), Sandtone (same price as White, per Nick), Terratone, Black/White (`bw`, black exterior / white interior), Dark Bronze (dark-bronze exterior / white interior), Black/Black (`bb`). Types: horizontal slider XO (`hslider`), XOX slider (`xox`), single hung (`vslider`), picture, casement, specialty shapes (`arch`), awning. P75 is the default. Types with fewer than 3 quote lines are flagged estimated. Spot-check: Andersen XO white 70×60 = (70+60) × 9.5609 = $1,242.92 materials, plus labor on its own line. `python3 tools/check_rates.py` checks that math.

Saved estimates and settings live in each device's browser storage (localStorage). Use Settings → Export to back up.

## Files
    index.html  manifest.webmanifest  sw.js
    css/styles.css
    js/app.js (router)  js/core.js (data, pricing, estimates store)  js/frames.js (SVG window frames)
    js/pages/{calculator,estimate,options,gallery,overlay,settings,obscure,frame-types}.js
    data/*.json  assets/  tools/  screenshots/

## Add to a bigger host
Any static host works (GitHub Pages, Netlify, Cloudflare Pages). No build command; publish the folder root.
