HANGOUT — customized copy of Proxyy

The supplied Desktop/Proxyy folder was left untouched. This separate folder
contains the Hangout version and the same original parallax scene files.

Run locally
1. Double-click Start Favour.command in this project folder.
2. It starts the local server and opens the site in your browser.
3. Keep the Terminal window open while using the site; press Control+C there to stop it.

The first run creates favour.sqlite3 in this folder. Accounts, proxy records,
confirmations, balances, and treat claims are stored in SQLite.

Email setup
1. In Terminal, run `cp .env.example .env` from this project folder.
2. Fill in your mail provider's SMTP host, port, sender address, username, and
   password. Port 587 with STARTTLS is the default. For providers using port
   465, set FAVOUR_SMTP_STARTTLS=false and FAVOUR_SMTP_SSL=true.
3. Restart Hangout with Start Favour.command.

The app does not include mail credentials. Until SMTP is configured, signup and
password reset display a clear setup message instead of pretending an email was
sent. Keep .env private; the local server blocks requests for hidden files.

Demo sign-in
Campus email: aanya@iitr.ac.in
Password: campus2026

Other seeded demo accounts use the same password. Or use the Signup link to
create an account.

Mark a proxy by choosing the person and date/time. There is no proxy-name
field; records are simply labeled “Proxy.” When the recipient confirms it, the
person who recorded the proxy gains 1 FC in their balance with that person; the
recipient’s corresponding balance decreases by 1. All other relationships stay
separate. A treat request reserves its cost and reduces that shared balance only
after the provider marks it delivered. A declined or cancelled request releases
the reservation. Aloo pakoda unlocks at 3 coins and Hyderabadi biryani at 5 coins.

The navigation opens Home, Mark a proxy, People, and Klone. Klone opens in a
full-screen overlay; use Return to Hangout to close it.

The original parallax markup, CSS, and animation scripts remain present. Hangout
content and styling are added in separate files.
