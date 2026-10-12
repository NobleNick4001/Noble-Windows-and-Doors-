# Noble-Windows-and-Doors-
Sales tool

# Noble Windows & Doors — Sales App (v1)

Mobile/tablet-first web app (plain HTML/CSS/JS, no build step, no backend). Runs in Safari on iPad/iPhone, installable to the home screen (Share → Add to Home Screen), works offline after first load (service worker).

## Run locally
    python3 -m http.server 8080      # from this folder, then open http://localhost:8080
(Must be served over http(s) — not file:// — for the service worker, camera and PWA install. Camera/"Add to Home Screen" on a phone need HTTPS, e.g. GitHub Pages / Netlify / Cloudflare Pages.)

## What's in it
Calculator · Estimate (builder + printable/PDF page + purchase agreement) · Saved estimates · Options (glass / brands / frame types / colors / obscure glass) · Gallery + full-screen slideshow · Window preview (photo overlay) · Settings.

## Pricing model
- **Window price** (material only) = (width + height in inches) × selling rate. The numbers stored in `data/rates.json` are quoted customer $/inch and already include a 40% margin (`cost / 0.60`). Selling rate = stored rate × `0.60 / (1 - grossMargin)`. **`grossMargin` in `data/rates.json` is the one margin to change** (currently `0.45`, so selling rate = stored × `0.60 / 0.55`, about +9.09%). That applies to every series, color, and type, including estimated rates and derived colors (Adobe = white/white × its multiplier, then the same margin). Labor, tax, shipping, and flat add-ons are not scaled. A percent-of-window add-on follows the new window price.
- **Installation / labor is a separate per-window line** (default "Standard retrofit/replacement install" = $360) with selectable install type, surcharge checkboxes and a manual per-window price override; plus job-level extras (permit, haul-away, trim, custom).
- Estimate shows Windows subtotal, a promo discount line when a code applies, Installation subtotal, Additional items, Subtotal, optional tax, Total (before tax by default). Discounts come off window material only unless that code sets `appliesToLabor`. Codes are in `data/promos.json` (match ignores case): `NOBLE5` 5% off windows, `NOBLE10` 10% off windows, `NOBLEBOGO` one free window per 5 (the cheapest material price; 5 or more windows required). The code is saved on the estimate, shown on the screen and the print/PDF view, and can be removed. An unknown code shows an error and is not saved.
- Default rate set = P75 ("recommended"). Settings has an admin toggle for MAX (highest quoted). Andersen 100 uses the same toggle.

## Data files (edit these — no code changes)
| File | What |
|---|---|
| `data/rates.json` | Rate tables per brand. `brands[].series[]` lists series/colors/types; `brands[].rates["SERIES|colorId|typeId"] = {p75, max, estimated, n}`. Stored rates are quoted customer $/inch at a 40% margin. `grossMargin` (0.45) is the selling margin: the app multiplies every rate, including estimated and derived, by `0.60 / (1 - grossMargin)`. Andersen 100 Series is active. IWC is still `status: "coming_soon"`. `estimated:true` is internal only (shown with "E" in Settings, never to customers): derived colors, or a thin sample (`n` < 3). |
| `data/milgard_material_rates.csv` | Human-readable copy of the Milgard material-only rate table (avg / max / P75, quoted vs estimated, basis). |
| `data/andersen_100_material_rates.csv` | Human-readable Andersen 100 Series material-only rates (P75 / max, quoted vs thin-sample estimate). |
| `data/install.json` | Install types & prices, surcharges, job-extra presets. Only "standard = $360" is real; the rest are placeholder prices. Labor is not marked up by `grossMargin`. |
| `data/promos.json` | Promo codes. Edit this list only. `appliesToLabor` is per code (false = windows only). |
| `data/purchase-agreement.json` | Purchase-contract wording, the 65% deposit, and the terms on page two. The header on the contract uses company settings (logo, address, phone, email, licenses), not the older phone and ROC on the original Word file. |
| `data/options.json` | Glass and frame options, brand talking points (Milgard Tuscany / Trinsic / Style Line / Ultra fiberglass, Andersen 100 through E-Series and SmartSun, IWC 8800 Ambassador), the 3-year workmanship warranty, and the process steps. Add-on prices that are still unknown use `price.unset`. Financing, the 10% promo, and rebate claims are not in here. |
| `data/obscure-glass.json` | Andersen privacy glass with photos (Cascade/Rain, Fern/Single Glue Chip, Obscure/Pattern 62/Stippolyte, Reed/English Reed, Satin Etch) and a separate Milgard list by name only. V300 Trinsic omits Aquatex, Glue Chip, and Frosted Glue Chip. The site publishes no privacy ratings — Reed 3 and Satin Etch 5 are still the old generic numbers; everything else is blank. |
| `data/frame-types.json` | Retrofit and full-frame / nailing-fin copy from the website. Block frame is still a placeholder (the site does not describe it). Each row’s `installType` points at a labor price in `data/install.json`. |
| `data/settings.default.json` | Defaults: tax %, rate set, company info, estimate terms, validity days. Estimates print (623) 810-3460, mgr@noblewandd.com, and both licenses on their own lines: AZ ROC #364772 (KB-1) and AZ ROC #364771 (CR-11). Hours are Mon–Sun 6am–6pm. Settings page overrides are stored on each device (localStorage). |
| `assets/gallery/gallery.json` | All 46 job photos, including every Nick photo (house numbers and installers stay in frame). Thumbnails and the slideshow use `object-fit: contain`, so nothing is cropped. Filter chips: Milgard V300, Milgard V400 Tuscany, Andersen 100, Andersen 100 Retrofit, Multi Slides, Noble projects. Nick's 17 photos are first, then the Multi Slides pool-patio before/after, then the website photos. `installType: "unspecified"` shows no install label. 760×570 site photos are marked `lowRes` and are not blown up past their pixel size. Images cache on first view; they are not all precached. |

**Adobe color** (V250/V300/V400 only) has no quote, so its rate is *derived*: white/white rate × `multiplier` in `data/rates.json` → `brands[0].derivedColors.adobe.multiplier` (default 1.00). Change that one number to reprice Adobe everywhere. Adobe cells are always flagged estimated (internal only).

Rebuild Milgard `rates.json` rows + `data/milgard_material_rates.csv` from the source quote lines: `python3 tools/build_rates.py` (reads `tools/milgard_quote_lines.json`). Rate = quoted line price ÷ (W+H); P75 = 75th percentile; missing colors on V300/V400/A250 are estimated with V250 color ratios; A250 bronze anodized stands in for A250 black/black. The script keeps whatever Adobe multiplier is already in rates.json, and it keeps the Andersen 100 brand, the Sandtone / Terratone / Dark Bronze colors, and the Awning / XOX types. It does not rebuild Andersen rates.

Andersen 100 colors: White (`ww`), Sandtone (same price as White, per Nick), Terratone, Black/White (`bw`, black exterior / white interior), Dark Bronze (dark-bronze exterior / white interior), Black/Black (`bb`). Types: horizontal slider XO (`hslider`), XOX slider (`xox`), single hung (`vslider`), picture, casement, specialty shapes (`arch`), awning. P75 is the default. Types with fewer than 3 quote lines are flagged estimated. Spot-check: Andersen XO white 70×60 stored p75 is 9.5609. At a 40% margin that was (70+60) × 9.5609 = $1,242.92 materials. At `grossMargin` 0.45 it is (70+60) × 9.5609 × 0.60/0.55 = $1,355.91 materials, plus labor ($360) on its own line. `python3 tools/check_rates.py` checks that math. The CSV copies stay the quote-basis rates (40% already in the number); Settings shows the selling rates.

Saved estimates and settings live in each device's browser storage (localStorage). Use Settings → Export to back up. A signed purchase agreement is stored on that estimate.

## Purchase agreement
From the estimate, **Agreement** opens Noble's two-page purchase contract for the customer to sign on an iPhone or iPad.

- **Submitted by** is the salesperson. Set it in Settings, or type it on the contract (that saves it for the next estimate).
- Homeowner name, address, phone, and email come from the estimate and stay editable.
- **Specifications** is a short sentence built from the lines (count, brand, series, frame color, install type, and doors when a line is a door). Example: "Remove and replace 12 windows with new Milgard V300 with white frames and retrofit install. Labor and materials. Does not include paint." Edit it before signing, or tap **Rebuild summary from the estimate**.
- Project total is the estimate total after promo discounts (tax included when tax is on). Deposit is 65% of that total. The balance is the rest, so the two amounts add up to the total.
- Purchaser 1 and Purchaser 2 each have a finger signature on page 1 and page 2, with Clear and today's date. Purchaser 2 is optional. The initials line is a smaller pad.
- **Email contract and estimate** builds a signed contract PDF and an estimate PDF. On iPhone and iPad the share sheet (`navigator.share` with files) opens Mail with both PDFs attached. The customer's email is copied and included in the share text so the rep can paste it into To. Browsers that cannot share files download both PDFs and offer a mailto link with the subject and body filled in.
- A true one-tap send (no share sheet) would need a small server: a worker that accepts the two PDFs and sends them with Resend, Amazon SES, or similar. This site is static GitHub Pages and has no backend.

## Files
    index.html  manifest.webmanifest  sw.js
    css/styles.css
    js/app.js (router)  js/core.js (data, pricing, estimates store)  js/frames.js (SVG window frames)
    js/pdf.js (contract + estimate PDFs)  js/sign.js (signature pads)  js/vendor/jspdf.umd.min.js
    js/pages/{calculator,estimate,contract,options,gallery,overlay,settings,obscure,frame-types}.js
    data/*.json  assets/  tools/  screenshots/

## Add to a bigger host
Any static host works (GitHub Pages, Netlify, Cloudflare Pages). No build command; publish the folder root.
