# What to add next: ideas, ranked

A menu of features and improvements, ranked by value for the effort. ★ =
recommended next. None of these are built yet.

## Before and around the Steam launch

| | Idea | Why |
|---|---|---|
| ★ | **Recorded soundtrack and a few voice lines** (commission or license; drop files into `public/music/`) | The biggest jump in perceived quality for the money |
| ★ | **Authored art pass** for the hero, the Agents and 3–4 landmark islands (Blender glTF, same rig names) | Store-page screenshots sell the game |
| ★ | **Trailer and capsule art** (Photo mode + the attract camera) | Required for the store page |
| ★ | **`steamworks.js`** in the desktop build: achievements, Rich Presence ("Climbing the Spire"), Steam friends invites into rooms | The bridge is ready; this turns it on |
| ★ | **Playtest with 20–50 people** using the Crashes tab and the Dashboard's mission completion rates | Finds the real problems before reviews do |
| | Steam **demo** (Ink City + Colombo + the first chapter) for Steam Next Fest | Wishlists |
| | Localisation (Sinhala, Tamil, Hindi, Spanish, Portuguese, French) | The UI text is already centralised in a few files |

## Gameplay and fun

| | Idea | Why |
|---|---|---|
| ★ | **Ink Graffiti tagging**: spray your own tag (drawn in a small editor) on any wall; tags persist and show to friends in multiplayer | Self-expression, shareable, fits the ink theme |
| ★ | **Weekly challenge courses** picked by the owner (a Creator-mode course + leaderboard each week) | Reasons to come back, cheap to run |
| ★ | **Photo contests**: Photo mode upload to the server, voted in-game, winner shown on billboards | Community and free marketing |
| | **Ink Rush** daily: a 3-minute seeded run with a single global leaderboard | Short-session hook |
| | **Companion pet** (an ink crow) that finds Golden Pens and secrets | Exploration help, cosmetics to sell |
| | **Night races** with neon checkpoints and police-style Agent chases | Uses the day/night cycle |
| | **Boss rush** and **New Game+** (harder Agents, remixed missions) | Post-game content |
| | **Seasonal events**: Vesak lanterns, Avurudu games, Halloween ink, a snowy Ink City | Cultural flavour, ties into the Events tab |
| | **Paraglider and jet-pack** traversal upgrades | More ways to enjoy the big map |
| | **Hidden story logs → a lore codex** in the menu | Rewards exploration |
| | **Wildlife**: monkeys stealing items, elephants in the hills, birds that scatter | A living world |
| | **Fishing and kite flying** mini-games at the Colombo seaside | Calm moments between action |
| | **Player housing**: decorate Blank's Loft with loot | Long-term goal |

## Multiplayer and social

| | Idea | Why |
|---|---|---|
| ★ | **Report player** button (chat, name, cheating) feeding the Moderation tab | Required once the community grows |
| ★ | **Friends list and invites** (Steam friends on desktop, codes on the web) | Easier to play together |
| | Ranked Ink Turf with seasons | Competitive players |
| | Spectator camera for rooms | Streaming and tournaments |
| | Clubs / crews with a shared tag and turf | Belonging |
| | Cross-save between web and Steam (account-less code is already there) | Convenience |

## Owner panel

| | Idea | Why |
|---|---|---|
| ★ | **Funnel**: how many players finish Mission 1, Chapter 1 … the Final; where they quit | Shows exactly what to fix |
| ★ | **Heatmap of deaths / quits** on the world map | Finds frustrating spots |
| ★ | **Two-factor sign-in** (authenticator app) and more owner accounts with roles (moderator, analyst) | Security as the team grows |
| | **Push news** to running games (toast) and a news archive page | Talk to players live |
| | **A/B tests**: two versions of a setting (e.g. mission timer) split by install id | Data-driven tuning |
| | **Promo codes**: give Ink or cosmetics to streamers and testers | Marketing |
| | **Remote config** for balance numbers (Agent damage, mission times, prices) | Tune without a new release |
| | **Sponsor reports**: impressions (billboard views) and clicks per sponsor, exportable as PDF/CSV | Sell sponsorships with real numbers |
| | Email or phone **alerts** when crashes spike or the server goes down | Know before players complain |
| | Export statistics as CSV | Accounting and reports |

## Technical

| | Idea | Why |
|---|---|---|
| ★ | **Automated nightly smoke test** on the real server + alert on failure | Catch broken deploys |
| | Server-side physics (headless Rapier) for fully authoritative multiplayer | Stops movement cheats completely |
| | WebGPU renderer | Better performance on new hardware |
| | Asset streaming per island | Faster first load on slow connections |
| | Database (SQLite/Postgres) instead of JSON files once statistics grow past ~100k players | Scale |
