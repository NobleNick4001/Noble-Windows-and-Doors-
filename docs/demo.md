From the repo root, `node tools/build_demo.mjs` writes an offline copy to `./demo-dist/`. That folder is gitignored and is not deployed.
Serve it with `python3 -m http.server -d demo-dist 8080` and open that address on a phone. There is no sign-in.
The orange banner means the customers, invoices, and pay links are fake. The demo does not call Supabase, QuickBooks, HubSpot, or email.
