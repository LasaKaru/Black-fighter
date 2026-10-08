# The owner panel (hidden)

A private control panel inside the game for the owner: player statistics,
the live server, company branding, sponsors, donation links, the legal
pages, and on/off switches for features. Players never see it.

## Opening it

1. Start the game and wait for the title screen (any menu works).
2. Type **`kumara`** on the keyboard. Nothing is shown while you type.
3. The **Owner sign-in** appears. Sign in with the owner account.

The first time the server starts it creates the owner account from
`PANEL_EMAIL` / `PANEL_PASSWORD` (see `deploy/blackeye.env.example`), or from
the built-in defaults when those are not set:

| | |
|---|---|
| Email | `lasantha@helao2.com` |
| Password | `www111` |

> **Change the password right away** (Account tab). `www111` is short and
> easy to guess, and anyone who can reach your server can try it. A long
> passphrase (12+ characters) is best. Changing it signs you out everywhere.

### How sign-in is protected

- The email and password are checked **on the server**. They are not in the
  game files, so nobody can find them by unpacking the `.exe` or the web build.
- The password is stored only as a salted **scrypt** hash in
  `DATA_DIR/panel/account.json`. Delete that file (and restart) to reset the
  account to `PANEL_EMAIL` / `PANEL_PASSWORD`.
- Sign-in returns a random session token that lasts 12 hours and is kept only
  for the browser tab (sessionStorage).
- Every attempt waits 350 ms, and 8 wrong tries from one network lock sign-in
  for 15 minutes.
- The panel needs the game server online (it talks to `/panel/api`). Over the
  internet always use HTTPS (setup-server.sh sets it up with certbot).

## Tabs

| Tab | What you can do |
|---|---|
| **Dashboard** | Players today / this week / last 30 days, installs, sessions, hours played, minutes per session, and how many players come back after a day, a week and a month. A players-per-day chart (hover a day for details, or open it as a table). Breakdowns: platforms, regions, game versions, modes, art style, graphics preset, islands, achievements, story chapters, sponsor and link clicks, GPUs, secrets. Mission table with completion rate. Errors players hit, grouped. Range: 7, 30 or 90 days. |
| **Live server** | Players online, peak, rooms, uptime, maintenance status. Announce a message to everyone, set the join message, turn maintenance mode on/off, kick or ban a player. Refreshes every 5 s. |
| **Branding** | Company name, the word on the loading screen ("HelaO2 **presents**"), company logo upload, website, support email, the title-screen news line, logo graffiti on/off, the "Advertise with us" boards. Also lists every uploaded image (delete unused ones). |
| **Sponsors** | Add sponsors with a name, link, tier (gold = "Official sponsor", silver, partner) and logo. Choose where each one shows: title-screen footer and/or billboards at every island. |
| **Links** | Buy Me a Coffee, Ko-fi, Patreon, GitHub Sponsors, Discord or any other link, shown as buttons in the title-screen footer. Empty links are hidden. |
| **Pages** | Edit the text of every page in **About & legal**: privacy policy, terms of use, code of conduct, credits (also the end-credits roll), licences, support, health warning, about. Hide a page, or reset it to the built-in text. |
| **Features** | Switch for everyone: multiplayer, world leaderboard, the code-of-conduct prompt, the health warning, the title-screen footer, world billboards, the news line, anonymous statistics. |
| **Account** | Change the sign-in email and password. |

Changes are saved on the server (`DATA_DIR/brand/config.json`, images in
`DATA_DIR/brand/files/`). Your own game updates right away; players get them
the next time they start the game. Offline players keep the last version
they downloaded.

## How logos are shown in the game

Upload a PNG (transparent background looks best), JPEG, WebP or GIF up to
2 MB. SVG is refused because it can contain scripts. The server checks the
file's real type, not just its name.

- **Billboards** at the arrival plaza of every island: sponsor logos in their
  own colours on a clean white board with the tier ribbon, lit so they read at
  night. With no sponsors, the boards alternate between your company and
  "Your brand here, contact support@helao2.com".
- **Ink graffiti**: your company logo is spray-painted on tower walls across
  the city, with drips, overspray and wear, in its real colours.
- **Title screen footer**: sponsor logos, support links and © company.
- **Loading screen**: "{company} presents".

## Anonymous statistics

The game sends small batches of events (no name, email or IP stored) to
`/analytics`; the server keeps daily totals in `DATA_DIR/analytics/` and
deletes days and installs older than 120 days. Players can turn it off in
Settings → Privacy, where they also see their install id. To honour a
deletion request, paste the id into **Dashboard → Delete a player's
statistics**.
