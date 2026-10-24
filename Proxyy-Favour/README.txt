FAVOUR — customized copy of Proxyy

The supplied Desktop/Proxyy folder was left untouched. This separate folder
contains the Favour version and the same original parallax scene files.

Run locally
1. Double-click Start Favour.command in this folder.
2. It starts the local server and opens the site in your browser.
3. Keep the Terminal window open while using the site; press Control+C there to stop it.

If macOS asks you to confirm opening the command file, choose Open. You can also
run it from Terminal with: python3 server.py

The first run creates favour.sqlite3 in this folder. Accounts, favours,
confirmations, balances, and treat claims are stored in SQLite.

The site opens on Sign In. Use the Signup link to create an account with your
name, campus email, and password. Then sign in with your campus email and
password to open the parallax home page.

Demo sign-in
Campus email: aanya@iitr.ac.in
Password: campus2026

Other seeded demo accounts use the same password. Or use the Signup link to
create an account.

Create a favour by choosing the person and date/time. There is no favour-name
field; records are simply labeled “Favour.” When that person confirms it,
their balance goes up by one Favourcoin. No balance is deducted. Aloo pakoda
unlocks at 3 coins and Hyderabadi biryani at 5 coins; claiming a treat does
not reduce the balance.

The navigation opens Home, Create a Favour, and People. Kloner is present but
intentionally inactive.

The original parallax markup, CSS, and animation scripts remain present in
this copy. Favour content and styling are added in separate files.
