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
- **Fitted material prices** come from `data/variable-rates.json`. Those numbers are **selling** prices at 45% margin. The app does not run them through `marginFactor()`. Formula, in inches of unit size: `UI = width + height`, `sqft = width × height / 144`, `price = base + ($/UI × UI) + ($/sqft × sqft)`, then the color tier and any add-ons. Round only the final unit price.
  - **Andersen 100** (not awning): Sandtone and Dark Bronze / Dark Bronze are priced like Black (ratio 1). Dark Bronze / White, Terratone, and Black/White use × 1.003. White / White is ratio 1, then **−$191.71 per unit**. Flush fin + interior trim and grilles between the glass are $ per UI, scaled by the color tier. TruScene is $130 per window. Tempered, laminated, and obscure stay at 12% each.
  - **Milgard V300** White and Adobe share one fit (picture, single hung, XO, XOX, casement, half vent below picture, half round). Tempered is $264.98 per window. Obscure is $497.37 per window on top of tempered. Grids are $0.773 per UI. Laminated stays 12%.
  - **Milgard A250** Bronze uses its own fit, including XOX. Tempered is $60.41 + $22.39 per sq ft. Obscure is $45.10 per sq ft on top of tempered. Grids use the V300 $0.773 per UI.
  - **IWC** is active for 8200 block-frame windows (XO and picture) and 8900 block-frame deluxe doors (2-panel OX/XO and 4-panel OXXO), Bronze Anodized only. Door prices include the deluxe screen, stainless rollers, black flush handle, and tempered argon glass.
- **Anything the fit does not cover** keeps the stored `data/rates.json` path: selling rate = stored p75 × `0.60 / (1 - grossMargin)`. **`grossMargin` (currently 0.45) changes only that path.** It still includes Andersen awning, Milgard V250, V300 black/white and black/black, V400 non-composite, and A250 colors other than bronze. Those cells stay flagged estimated the same way as before. Labor, tax, shipping, and flat add-ons are not scaled.
- **Custom unit (enter supplier price)** is the line for composites and other specials, including Milgard V400 Tuscany composites and IWC colors other than Bronze Anodized (Clear Anodized, Mojave Beige, White), plus configs the fit does not cover. The salesperson enters the supplier’s customer price. It is used as-is: no margin and no rate math. Labor is still chosen separately. Promo codes do not discount it unless the code sets `appliesToCustom`.
- **Installation / labor is a separate per-window line.** Retrofit/Jump frame (the Z-bar retrofit) is $360, R&R stucco / nailing fin is $400, and Block frame install is $380. A custom labor price and a per-window override are still available. Override replaces labor only.
- **Per-line add-ons**, multiplied by that line’s quantity: 2nd story +$75, Difficult access +$75, Oversized/heavy +$85. They are not part of the labor price.
- **Stucco repair & paint** is an optional estimate line at $650 per window, with its own quantity. That quantity starts at the window count and keeps following it until the rep changes it.
- **Glass** choices are Laminated, Tempered, and Obscured. On series the quote fit does not cover, each one adds 12% of that window’s price, and they stack (two selected = 24%). Fitted series use the add-on amounts in `data/variable-rates.json` instead (Andersen stays at 12%; Milgard V300 and A250 use the flat and per-sq-ft amounts above). The obscured pattern picker and photos stay on the Obscure glass screen; the pattern does not add a second charge.
- Estimate shows Windows (including glass), a promo discount line when a code applies, Installation, Add-ons, Stucco repair & paint, Additional items, Subtotal, optional tax, Total, then the 65% deposit and 35% final payment. Discounts come off the window price including glass upcharges. They never come off labor, add-ons, or stucco, unless a code sets `appliesToLabor` (labor only, still not add-ons or stucco). Codes are in `data/promos.json` (match ignores case): `NOBLE5` 5% off windows, `NOBLE10` 10% off windows, `NOBLEBOGO` one free window per 5 (the cheapest window price, including glass; 5 or more windows required). The code is saved on the estimate, shown on the screen, the print/PDF view, and the purchase agreement, and can be removed. An unknown code shows an error and is not saved. Spot-check: 2 windows at $1,000, Retrofit, Tempered, one 2nd story, `NOBLE10` = windows $2,016 after the discount + labor $720 + add-on $75 = $2,811; deposit $1,827.15, final $983.85.
- Default rate set = P75 ("recommended"). Settings has an admin toggle for MAX (highest quoted). Andersen 100 uses the same toggle.

## Data files (edit these — no code changes)
| File | What |
|---|---|
| `data/variable-rates.json` | Selling material prices for the fitted series (base, $ per UI, $ per sq ft, color tiers, add-ons). Already at 45%. Do not run these through `marginFactor()`. |
| `data/rates.json` | Fallback rate tables. `brands[].series[]` lists series/colors/types; `brands[].rates["SERIES|colorId|typeId"] = {p75, max, estimated, n}`. Stored rates are quoted customer $/inch at a 40% margin. `grossMargin` (0.45) scales only combinations that `variable-rates.json` does not cover, by `0.60 / (1 - grossMargin)`. Andersen 100 is active. IWC is active for 8200 windows and 8900 doors. `estimated:true` is internal only (shown with "E" in Settings, never to customers): derived colors, or a thin sample (`n` < 3). |
| `data/milgard_material_rates.csv` | Human-readable copy of the Milgard material-only rate table (avg / max / P75, quoted vs estimated, basis). |
| `data/andersen_100_material_rates.csv` | Human-readable Andersen 100 Series material-only rates (P75 / max, quoted vs thin-sample estimate). |
| `data/install.json` | Install types and prices (Retrofit/Jump frame $360, R&R stucco / nailing fin $400, Block frame install $380), per-window add-ons, the $650 stucco repair & paint line, and job-extra presets. Labor, add-ons, and stucco are not marked up by `grossMargin`. |
| `data/promos.json` | Promo codes. Edit this list only. `appliesToLabor` is per code (false = windows only). |
| `data/purchase-agreement.json` | Purchase-contract wording, the 65% deposit, and the terms on page two. The header on the contract uses company settings (logo, address, phone, email, licenses), not the older phone and ROC on the original Word file. |
| `data/options.json` | Glass (Laminated, Tempered, Obscured — each +12% of the window price, stacked) and frame options, brand talking points (Milgard Tuscany / Trinsic / Style Line / Ultra fiberglass, Andersen 100 through E-Series and SmartSun, IWC 8800 Ambassador), the 3-year workmanship warranty, and the process steps. Add-on prices that are still unknown use `price.unset`. Financing and rebate claims are not in here. Promo codes live in `data/promos.json`. |
| `data/obscure-glass.json` | Andersen privacy glass with photos (Cascade/Rain, Fern/Single Glue Chip, Obscure/Pattern 62/Stippolyte, Reed/English Reed, Satin Etch) and a separate Milgard list by name only. V300 Trinsic omits Aquatex, Glue Chip, and Frosted Glue Chip. The site publishes no privacy ratings — Reed 3 and Satin Etch 5 are still the old generic numbers; everything else is blank. |
| `data/frame-types.json` | Retrofit (Z-bar / jump frame, $360) and full-frame / nailing-fin copy from the website ($400). Block frame wording is still a placeholder (the site does not describe it); the labor price is $380. Each row’s `installType` points at a labor price in `data/install.json`. |
| `data/settings.default.json` | Defaults: tax %, rate set, company info, estimate terms, validity days. Estimates print (623) 810-3460, mgr@noblewandd.com, and both licenses on their own lines: AZ ROC #364772 (KB-1) and AZ ROC #364771 (CR-11). Hours are Mon–Sun 6am–6pm. Settings page overrides are stored on each device (localStorage). |
| `assets/gallery/gallery.json` | All 48 job photos, including every Nick photo (house numbers and installers stay in frame). Thumbnails and the slideshow use `object-fit: contain`, so nothing is cropped. Filter chips: Milgard V300, Milgard V400 Tuscany, Andersen 100, Andersen 100 Retrofit, Multi Slides, Noble projects. Nick's 19 photos are first (the Milgard V300 group includes two black sliders with white trim on stucco), then the Multi Slides pool-patio before/after, then the website photos. `installType: "unspecified"` shows no install label. 760×570 site photos are marked `lowRes` and are not blown up past their pixel size. Images cache on first view; they are not all precached. |

**Adobe color** on V250 and V400, and on V300 colors the quote fit does not cover, is still *derived*: white/white rate × `multiplier` in `data/rates.json` → `brands[0].derivedColors.adobe.multiplier` (default 1.00). V300 White and V300 Adobe are fitted in `data/variable-rates.json` and do not use that multiplier. Derived Adobe cells stay flagged estimated (internal only).

Rebuild Milgard `rates.json` rows + `data/milgard_material_rates.csv` from the source quote lines: `python3 tools/build_rates.py` (reads `tools/milgard_quote_lines.json`). Rate = quoted line price ÷ (W+H); P75 = 75th percentile; missing colors on V300/V400/A250 are estimated with V250 color ratios; A250 bronze anodized stands in for A250 black/black. The script keeps whatever Adobe multiplier is already in rates.json, and it keeps the Andersen 100 brand, the Sandtone / Terratone / Dark Bronze colors (including Dark Bronze / Dark Bronze), the Awning / XOX / half-vent types, and the active IWC 8200 / 8900 series. It does not rebuild Andersen rates or the quote-fit file.

Andersen 100 colors: White (`ww`), Sandtone (priced like Black), Terratone, Black/White (`bw`, black exterior / white interior), Dark Bronze / White (`dkbronze`), Dark Bronze / Dark Bronze (`dkbronze_dkbronze`), Black/Black (`bb`). Types: horizontal slider XO (`hslider`), XOX slider (`xox`), single hung (`vslider`), picture, casement, specialty shapes (`arch`), awning. Awning keeps the stored p75 path. The other types use the quote fit. Spot-check: Andersen XO White 70×60 is `(115.53 + 8.5293 × 130) − 191.71 = $1,032.63` materials, plus labor ($360) on its own line. The stored p75 (9.5609) remains the old $/inch quote rate and is not the selling price for this window. `python3 tools/check_rates.py` and `node tools/check_variable_rates.mjs` check that math. Settings shows fitted cells as base / $/UI / $/sq ft, marked “from quotes”.

Saved estimates and settings live in each device's browser storage (localStorage). Use Settings → Export to back up. A signed purchase agreement is stored on that estimate.

## Purchase agreement
From the estimate, **Agreement** opens Noble's two-page purchase contract for the customer to sign on an iPhone or iPad.

- **Submitted by** is the salesperson. Set it in Settings, or type it on the contract (that saves it for the next estimate).
- Homeowner name, address, phone, and email come from the estimate and stay editable.
- **Specifications** is a short sentence built from the lines (count, brand, series, frame color, install type, add-ons, stucco repair when that line is on, and doors when a line is a door). Example: "Remove and replace 12 windows with new Milgard V300 with white frames and retrofit install. Labor and materials. Does not include paint." Edit it before signing, or tap **Rebuild summary from the estimate**.
- The agreement lists windows, the promo discount, installation, add-ons, and stucco repair when those amounts are on the estimate. Project total is the estimate total after promo discounts (tax included when tax is on). Deposit is 65% of that total. The final balance is the other 35%, so the two amounts add up to the total.
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
