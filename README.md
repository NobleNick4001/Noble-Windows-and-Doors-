# Noble-Windows-and-Doors-
Sales tool

# Noble Windows & Doors — Sales App (v1)

Mobile/tablet-first web app (plain HTML/CSS/JS, no build step, no backend). Runs in Safari on iPad/iPhone, installable to the home screen (Share → Add to Home Screen), works offline after first load (service worker).

## Run locally
    python3 -m http.server 8080      # from this folder, then open http://localhost:8080
(Must be served over http(s) — not file:// — for the service worker, camera and PWA install. Camera/"Add to Home Screen" on a phone need HTTPS, e.g. GitHub Pages / Netlify / Cloudflare Pages.)

## What's in it
Calculator · Estimate (builder + printable/PDF page + purchase agreement) · Saved estimates · Options (glass / brands / frame types / colors / obscure glass) · Gallery + full-screen slideshow · Window overlay (a Milgard photo warped onto the customer’s window, saved on the estimate and its PDF) · Settings.

## Pricing model
- **Fitted material prices** come from `data/variable-rates.json`. Those numbers are **selling** prices at 45% margin. The app does not run them through `marginFactor()`. Formula, in inches of unit size: `UI = width + height`, `sqft = width × height / 144`, `price = base + ($/UI × UI) + ($/sqft × sqft)`, then the color tier and any add-ons. Round only the final unit price.
  - **Andersen 100** (not awning): Sandtone and Dark Bronze / Dark Bronze are priced like Black (ratio 1). Dark Bronze / White, Terratone, and Black/White use × 1.003. White / White is ratio 1, then **−$191.71 per unit**. Flush fin + interior trim and grilles between the glass are $ per UI, scaled by the color tier. TruScene is $130 per window. Tempered, laminated, and obscure stay at 12% each.
  - **Milgard** V250, V300, and V400 windows, and V300, V400, and A250 patio doors (2, 3, and 4 panel), use the OneLink grid in `data/milgard-onelink.json`. Door width and height are the net frame size. A standard-size door (net height exactly 79.5, 81.5, or 95.5, and net width up to 71.5 or exactly 95.5) uses the standard table when that series has one. Every other door uses the custom grid, rounded up. Window sizes round up to the next grid size. Outside the grid, a safety formula is used. The customer price is never under OneLink. PureView is not in the V300 or V400 2-panel or 3-panel base; the PureView toggle adds it. SunCoatMAX, high heat bead where available, and Full Lifetime where available are included. Windows include a standard fiberglass screen. Doors include an upgraded fiberglass screen. PureView is optional. There is no V350. Patio door color is an upcharge on the White door price: `ceil(k × (flat + per inch of width + per inch of height))`. V300 and V400 offer White, Adobe, Black / White, Black / Black, and Classic Brown / Espresso / Bronze. A250 offers Bronze Anodized and Clear Anodized at the White price.
  - **IWC** is active for 8200 block-frame windows (XO and picture) and 8900 block-frame deluxe doors (2-panel OX/XO and 4-panel OXXO), Bronze Anodized only. Door prices include the deluxe screen, stainless rollers, black flush handle, and tempered argon glass.
- **Anything the fit does not cover** keeps the stored `data/rates.json` path: selling rate = stored p75 × `0.60 / (1 - grossMargin)`. **`grossMargin` (currently 0.45) changes only that path.** That path still includes Andersen awning and Milgard shapes the OneLink grid does not cover (arch and half-vent). Those cells stay flagged estimated the same way as before. Labor, tax, shipping, and flat add-ons are not scaled.
- **Custom unit (enter supplier price)** is the line for composites and other specials, including Milgard V400 Tuscany composites and IWC colors other than Bronze Anodized (Clear Anodized, Mojave Beige, White), plus configs the fit does not cover. The salesperson enters the supplier’s customer price. It is used as-is: no margin and no rate math. Labor is still chosen separately. Promo codes do not discount it unless the code sets `appliesToCustom`.
- **Installation is one combined total.** Window labor is Jump Frame $360, Nail Fin RnR Stucco $400, Block $380, or a custom write-in. Patio door labor is automatic: 2-panel $850, 3-panel $1,050, 4-panel $1,250, plus $100 when the door is taller than 84 in. A per-window override still replaces that line’s labor only. On the estimate, the print/PDF, and the purchase agreement, labor and add-ons are one **Installation / Labor** line.
- **Add-ons** stay out of the material price and roll into that Installation total. Windows, multiplied by quantity: Stucco repair & paint $650, Large unit $85, Two-story $75, Hard access $75, Steelies $75. Doors: Second Story $300, Stucco Repair $650, Header modification / new header (wall modification) at $850 per linear foot (decimals allowed), Cut down $1,500, and a write-in description and price.
- **Stucco repair & paint** is optional at $650 per window, with its own quantity. That quantity starts at the window count and keeps following it until the rep changes it. When it is on, the amount is part of Installation / Labor.
- **Glass** choices are Laminated, Tempered, and Obscured. On series the quote fit does not cover, each one adds 12% of that window’s price, and they stack (two selected = 24%). Fitted series use the add-on amounts in `data/variable-rates.json` instead (Andersen stays at 12%; Milgard V300 and A250 use the flat and per-sq-ft amounts above). The obscured pattern picker and photos stay on the Obscure glass screen; the pattern does not add a second charge.
- Every estimate shows itemized windows (including glass and custom units), a promo discount line when a code applies, an optional **additional discount** of 0–10% on materials, one **Installation / Labor** total (labor + add-ons + stucco), **Shipping & Handling** of $150, any additional items, **Sales Tax (9.1%)**, the total, then the 60% deposit and 40% final payment. Order on materials: window subtotal, then the promo, then the additional percent, then 9.1% tax on what is left. Tax is not charged on labor, add-ons, stucco, extras, or shipping. Shipping is on every estimate, and neither promo codes nor the additional percent discount it. The additional percent applies to windows and doors after the promo, including a custom unit the promo did not discount. It never comes off labor or shipping. A value over 10% is rejected and is not applied; a negative value is treated as 0. The percent is saved on the estimate and shown on the screen, the print/PDF, and the purchase agreement. Promo discounts come off the window price including glass upcharges. They never come off labor, add-ons, stucco, or shipping, unless a code sets `appliesToLabor` (labor only, still not add-ons, stucco, or shipping). Codes are in `data/promos.json` (match ignores case): `NOBLE5` 5% off windows, `NOBLE10` 10% off windows, `NOBLEBOGO` one free window per 5 (the cheapest window price, including glass; 5 or more windows required). The code is saved on the estimate, shown on the screen, the print/PDF view, and the purchase agreement, and can be removed. An unknown code shows an error and is not saved. Spot-check: 2 windows at $1,000, Retrofit, Tempered, one 2nd story, `NOBLE10` = materials $2,016 after the promo + Installation / Labor $795 ($720 + $75) + shipping $150 + tax $183.46 (9.1% of $2,016) = $3,144.46; deposit $1,886.68, final $1,257.78. The same job with a 5% additional discount takes another $100.80 off the $2,016, tax is $174.28 (9.1% of $1,915.20), total $3,034.48, deposit $1,820.69, final $1,213.79.
- Default rate set = P75 ("recommended"). Settings has an admin toggle for MAX (highest quoted). Andersen 100 uses the same toggle.

## Data files (edit these — no code changes)
| File | What |
|---|---|
| `data/variable-rates.json` | Selling material prices for the fitted series (base, $ per UI, $ per sq ft, color tiers, add-ons). Already at 45%. Do not run these through `marginFactor()`. |
| `data/rates.json` | Fallback rate tables. `brands[].series[]` lists series/colors/types; `brands[].rates["SERIES|colorId|typeId"] = {p75, max, estimated, n}`. Stored rates are quoted customer $/inch at a 40% margin. `grossMargin` (0.45) scales only combinations that `variable-rates.json` does not cover, by `0.60 / (1 - grossMargin)`. Andersen 100 is active. IWC is active for 8200 windows and 8900 doors. `estimated:true` is internal only (shown with "E" in Settings, never to customers): derived colors, or a thin sample (`n` < 3). |
| `data/milgard_material_rates.csv` | Human-readable copy of the Milgard material-only rate table (avg / max / P75, quoted vs estimated, basis). |
| `data/andersen_100_material_rates.csv` | Human-readable Andersen 100 Series material-only rates (P75 / max, quoted vs thin-sample estimate). |
| `data/milgard-onelink.json` | OneLink grids, door width × height tables, size limits, and screen/frame upcharges for Milgard V250/V300/V400 windows and V300/V400/A250 patio doors. Customer price is never under OneLink. |
| `data/install.json` | Window labor (Jump Frame $360, Nail Fin RnR Stucco $400, Block $380, custom), window add-ons, automatic patio-door labor by panel count, door add-ons (Second Story, Stucco Repair, header at $850 per linear foot, Cut down $1,500, write-in), the estimate-level stucco line, and job-extra presets. Labor and add-ons are not marked up by `grossMargin`. |
| `data/promos.json` | Promo codes. Edit this list only. `appliesToLabor` is per code (false = windows only). |
| `data/overlay/manifest.json` | Straight-on Milgard window photos for Window overlay (`data/overlay/<series>_<type>_<color>[_zbar].webp`). Swap a WebP in place to use a real photo. Picture windows, the V400 single hung, and every Z-bar are marked approximate. |
| `data/purchase-agreement.json` | Purchase-contract wording, the 60% deposit, and the terms on page two. The header on the contract uses company settings (logo, address, phone, email, licenses), not the older phone and ROC on the original Word file. |
| `data/options.json` | Glass (Laminated, Tempered, Obscured — each +12% of the window price, stacked) and frame options, brand talking points (Milgard Tuscany / Trinsic / Style Line / Ultra fiberglass, Andersen 100 through E-Series and SmartSun, IWC 8800 Ambassador), the 3-year workmanship warranty, and the process steps. Add-on prices that are still unknown use `price.unset`. Financing and rebate claims are not in here. Promo codes live in `data/promos.json`. |
| `data/obscure-glass.json` | Andersen privacy glass with photos (Cascade/Rain, Fern/Single Glue Chip, Obscure/Pattern 62/Stippolyte, Reed/English Reed, Satin Etch) and a separate Milgard list by name only. V300 Trinsic omits Aquatex, Glue Chip, and Frosted Glue Chip. The site publishes no privacy ratings — Reed 3 and Satin Etch 5 are still the old generic numbers; everything else is blank. |
| `data/frame-types.json` | Retrofit (Z-bar / jump frame, $360) and full-frame / nailing-fin copy from the website ($400). Block frame wording is still a placeholder (the site does not describe it); the labor price is $380. Each row’s `installType` points at a labor price in `data/install.json`. |
| `data/settings.default.json` | Defaults: rate set, company info, estimate terms, validity days. Sales tax is a fixed 9.1% on materials and shipping is a fixed $150; neither is a setting. Estimates print (623) 810-3460, mgr@noblewandd.com, and both licenses on their own lines: AZ ROC #364772 (KB-1) and AZ ROC #364771 (CR-11). Hours are Mon–Sun 6am–6pm. Settings page overrides are stored on each device (localStorage). |
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
- The agreement lists windows, the promo discount, the additional materials percent when one is entered, one Installation / Labor total (labor, add-ons, and stucco together), Shipping & Handling of $150, and Sales Tax (9.1%) on the materials after both discounts. Project total includes shipping and tax. Deposit is 60% of that total. The final balance is the other 40%, so the two amounts add up to the total.
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

## Who can sign in

The calculator, estimates, and every other page stay hidden until someone signs in. The login that counts is the allowlist in Supabase (`public.allowed_users`), not the copy of names in `js/cloud.js`.

Seeded accounts:

| Name | Email | Role |
|---|---|---|
| Nicholas Sommer | mgr@noblewandd.com | admin |
| Eric Havins | eric@noblewandd.com | sales |
| George Piekarski | mgr@noblegcllc.com | sales |
| Daniel Smalley | dan@noblewandd.com | sales |

Nick adds a later rep from the Admin page (name, email, role). That person then creates a password on the sign-in screen. Revoke blocks new sign-ins, hides estimates and profiles from that login, deletes their Supabase sessions, and the app signs them out the next time the device is online. Restore lets them sign in again.

Each salesperson starts out seeing only their own estimates and contracts. On the Admin page, **Can see other reps' estimates** lets that person read everyone else's jobs too. The list names the rep who owns each estimate. The switch does not let them edit or reassign those jobs. Nick always sees every estimate, so the switch is not shown on the admin row. Running the migration again leaves the switch where Nick set it.

A rep who already signed in can keep building quotes with no signal. The app checks the allowlist again whenever the iPad is back online. A brand-new device still needs a connection the first time.

## What Nick runs in Supabase

Do this once, on the Supabase project the app already uses, before anyone relies on this version. The website code cannot turn the allowlist on by itself.

1. Open the project in the Supabase dashboard. Go to **SQL Editor**, start a new query, and paste the whole file `supabase/migrations/003_allowlist.sql`. Run it. Success is enough. Running the same file again is safe and will not un-revoke someone.
2. Go to **Authentication → Hooks**.
   - **Before user created**: turn it on, choose Postgres, and select `public.hook_before_user_created`. This stops a stranger from creating an account.
   - **Custom access token**: turn it on, choose Postgres, and select `public.custom_access_token_hook`. This stops a revoked or unknown email from signing in or refreshing a session.
3. Deploy the edge function `revoke-sessions` (Dashboard → Edge Functions, or `supabase functions deploy revoke-sessions --project-ref nmyatpcjqfokmfbssimc` from this folder). Supabase fills in `SUPABASE_SERVICE_ROLE_KEY` for the function. Do not put that key in the website, in git, or in an email. The function signs the revoked person out through Supabase Auth. The SQL in step 1 also deletes their sessions, so access is already blocked if the function is deployed a few minutes later.
4. Sign out on each iPad and sign back in once, while online, so the new check is stored on the device.
5. Daniel creates his own password from **Create account** if he does not have one yet. If the screen says to confirm the email, either open that message or, under **Authentication → Providers → Email**, turn off **Confirm email** so the team can sign in right away.

After that, Nick does not need the SQL editor to add or remove a rep. Admin → Add rep, or Revoke / Restore.

## Pricing files are still public on GitHub Pages

Sign-in does not hide `data/*.json`. GitHub Pages and a raw preview link will still hand those files to anyone who requests the URL, including `data/milgard-onelink.json` and `data/rates.json`. Supabase row security covers estimates and accounts only. The service worker also keeps a copy of those files on a device that has opened the app while signed in.

To stop that, move the site off GitHub Pages:

1. Put the repo on **Cloudflare Pages**. No build command. The output directory is the repo root.
2. Use a hostname you control, such as `sales.noblewandd.com`. Access can only sit in front of a hostname on Cloudflare.
3. In **Cloudflare Zero Trust**, create an Access application for that hostname.
4. Allow policy: only the work emails (Nicholas, Eric, George, Daniel, and anyone Nick adds later). One-time email PIN or Google is enough. Everyone else is stopped before HTML, JavaScript, or the pricing JSON is sent.
5. Keep the Supabase login behind Access. Access hides the files. Supabase still decides which rep sees which estimate, and Revoke still signs them out.
6. When Nick adds a rep, add the email in the Admin page and in the Access policy (or in one Access group he edits).
7. Turn **GitHub Pages off** for this repo so the old public URL stops serving the JSON.
8. Each iPad opens the new hostname once while online. After Access lets them in, the service worker can cache the app for offline quotes.

That move is hosting, not an app change. Do not switch the live link until the Access policy lists the same people as the allowlist.

## Add to a bigger host
Any static host works (GitHub Pages, Netlify, Cloudflare Pages). No build command; publish the folder root. GitHub Pages cannot require sign-in before it serves the pricing files. Cloudflare Pages plus Access can. See the section above.
