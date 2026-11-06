# QuickBooks invoicing setup

Merging the pull request does **not** deploy any of this. The website update and the Supabase pieces are separate. Until the migration, the edge function, and the secrets are in place, a signed agreement still saves. The invoice stays queued and the agreement screen shows **Retry QuickBooks invoice**.

The connected company must be the **Windows & Doors** QuickBooks file. Noble General Contracting is a different company. The app does not pick a realm for you. It stores the realm id Intuit returns when an admin finishes the connect screen, then shows that company's name so you can confirm it.

## What gets deployed

1. **Migration** `supabase/migrations/004_quickbooks.sql`
   - Open the Supabase project `nmyatpcjqfokmfbssimc` → **SQL Editor** → New query → paste the whole file → Run.
   - This adds the locked token table and the invoice columns on `estimates`.
   - Row security is on. The browser cannot read tokens. Only the service role used by the edge function can.
2. **Edge function** `quickbooks-invoice`
   - `verify_jwt` is true, same as `send-estimate` and `hubspot-sync`.
   - From this folder: `supabase functions deploy quickbooks-invoice --project-ref nmyatpcjqfokmfbssimc`
   - Supabase injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Do not copy the service role key into the website or into git.
3. **Secrets** on that function (Dashboard → Edge Functions → Secrets, or `supabase secrets set`):

   | Name | Required | Purpose |
   |---|---|---|
   | `INTUIT_CLIENT_ID` | yes, for live mode | Production Intuit app client id |
   | `INTUIT_CLIENT_SECRET` | yes, for live mode | Production Intuit app secret. Server only. |
   | `QBO_MOCK` | no | Set to `true` to run the whole flow with no Intuit calls. Mock company name is "Noble Windows & Doors LLC". Turn this off before real invoices. |
   | `QBO_REDIRECT_URI` | no | If set, it must exactly match the callback URL below. The app also allows `https://…/qbo-callback.html` and localhost. |
   | `QBO_ITEM_SALES_ID` | no | QuickBooks item id for windows, doors, labor, shipping, extras, and discounts. |
   | `QBO_ITEM_SALES_NAME` | no | Name to look up when the id is blank. Default name: `Windows and doors`. |
   | `QBO_ITEM_FEE_ID` / `QBO_ITEM_FEE_NAME` | no | Card processing fee item. Default name: `Card processing fee`. |
   | `QBO_ITEM_TAX_ID` / `QBO_ITEM_TAX_NAME` | no | Sales-tax **item** (not a tax code). Default name: `Sales tax`. The line amount is the quote's tax, to the cent. |
   | `QBO_TAX_CODE` | no | Tax code on every sales line. Default `NON`, so QuickBooks does not add its own tax on top of the quote. |

   There is no realm-id secret. The realm is whatever company you authorize.

4. **Intuit app (production, not Development/sandbox)**
   - Scope: `com.intuit.quickbooks.accounting`
   - Redirect URI, exactly: the public URL of `qbo-callback.html` on the host that serves the sales app.
     - Example: `https://sales.example.com/qbo-callback.html`
     - Local trial: `http://localhost:8080/qbo-callback.html` (or `http://127.0.0.1:8080/qbo-callback.html`)
   - The redirect lands on that page, which is still the signed-in app. The page posts the code to the edge function. The function exchanges it with the client secret. The browser never sees the secret, the access token, or the refresh token.
   - Intuit's browser redirect cannot call the edge function directly while `verify_jwt` is true, because Intuit does not send a Supabase JWT. That is why the redirect URI is the app page.

## Items and tax in the Windows & Doors company

Create these as Service items (amount entered on each invoice, not a fixed price) before the first real invoice:

- **Windows and doors** — one sales item used for each window or door line, for discounts (negative amounts), for **Installation / Labor**, for **Shipping & Handling**, and for additional items. Set `QBO_ITEM_SALES_ID` if the name in QuickBooks is different.
- **Card processing fee** — used only for the 4% lines. Descriptions are `Card processing fee (4%) — deposit` and, later, `Card processing fee (4%) — final payment`.
- **Sales tax** — a normal sales item whose amount is the quote's sales tax (9.1% of materials after discounts). This is not QuickBooks automated sales tax.

Every priced line is sent with tax code `NON` (or `QBO_TAX_CODE`). The quote tax is already one of the lines. If the company rejects `NON`, set `QBO_TAX_CODE` to that company's non-taxable code.

Discount lines are negative. The sales item has to allow a negative amount.

## What you click to authorize

1. Deploy the migration, the function, and the two Intuit secrets. Create the three items in the **Windows & Doors** company.
2. Sign in to the sales app as the admin.
3. Open **Admin**.
4. Choose **Connect QuickBooks**.
5. On the Intuit screen, sign in and choose the **Windows & Doors** company. Do not choose Noble General Contracting.
6. Approve access (`com.intuit.quickbooks.accounting`).
7. You land on `qbo-callback.html`. Read **QuickBooks company:** and confirm it is the Windows & Doors company.
8. If the name is wrong, return to Admin → **Disconnect**, then **Connect QuickBooks** again and pick the other company.
9. The same status line is on **Settings**.

After that, reps do not connect again. Signing an agreement queues one invoice. If QuickBooks is down, the signature is still saved and **Retry QuickBooks invoice** runs the same job again. A second tap does not create a second invoice.

## How the invoice works

- One invoice per job, for the **full** estimate: window and door lines, discounts, Installation / Labor, Shipping & Handling, extras, and the quoted sales-tax amount.
- The first line is a description only (it does not change the total): `60% deposit of $X due now, remaining $Y (40%) due at completion of work`. `$X` and `$Y` are the deposit and balance already stored from `contractPay` on the signed agreement.
- Those two cent amounts are saved on the estimate next to the QuickBooks invoice id, doc number, payment link, and state.
- Bank transfer (ACH) is on. Card payments are off until someone presses **Pay by card**.
- **Pay by card** turns card payments on for that same invoice and adds one fee line: 4% of the **deposit** (the amount being paid now). Pressing it again does not add another deposit fee. The screen shows the fee and the new amount to enter.
- The QR code and **Pay now** open that invoice's QuickBooks payment link (`include=invoiceLink`). The screen tells the customer the exact deposit to enter, because the pay page can allow a different amount.
- If QuickBooks returns no link for an unsent invoice, the function calls the invoice **send** endpoint to the customer email on file, then reads the link again. That send **emails the customer**. The screen says when that happened.
- **Refresh payment status** reads `Invoice.Balance` and shows what has been paid and what is still open. After the deposit is paid, the remaining 40% stays open on the same invoice. `Invoice.Deposit` is never sent. That field means "deposit already received," not "please pay the deposit."
- **Record offline deposit** creates one Payment linked to the invoice for the contract deposit amount. It is idempotent.
- The signed contract PDF is uploaded as an attachment on the invoice. If the upload fails, the invoice still exists and Retry can attach it. Signing is not rolled back.

## Later completion screen (not built here)

The same invoice and the same function actions are enough for a completion certificate later:

- `refresh` — current balance
- `enable-card` with `stage: "final"` — one fee line, 4% of the **remaining balance**, labeled `Card processing fee (4%) — final payment`
- the same payment link and QR, with the remaining balance (plus that fee, if card is used) as the amount to enter
- `record-payment` with `purpose: "final"` — one offline payment for the balance, stored separately from the deposit payment

## Mock mode

Set the function secret `QBO_MOCK=true` and redeploy (or set it before the first deploy). Connect QuickBooks once from Admin. The callback stores a mock realm and the company name "Noble Windows & Doors LLC" without calling Intuit. Invoices, the card fee, the payment link, refresh, and the offline deposit all update the estimate row. The link is `https://invoice.noblewandd.test/pay/…` and is not a real payment page. The Admin status line says mock mode is on. Unset `QBO_MOCK` before creating a live invoice.
