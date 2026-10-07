# BLACKEYE: Ink City — shipping guides

| Guide | Read it when you want to… |
|---|---|
| [STEAM_PRICING.md](STEAM_PRICING.md) | Pick a price, understand Steam's fees and what you'll earn |
| [SERVER_ARCHITECTURE.md](SERVER_ARCHITECTURE.md) | Understand the backend, the admin panel, capacity, and going worldwide with regions |
| [DEPLOY_CONTABO.md](DEPLOY_CONTABO.md) | Put the server on your Contabo Linux VPS with HTTPS and auto-deploy |
| [DESKTOP_BUILD.md](DESKTOP_BUILD.md) | Build the Windows `.exe` (Electron) locally, choose the server it connects to, sign it |
| [CI_RELEASES.md](CI_RELEASES.md) | Have GitHub build the `.exe`, tag a version and publish a Release on every push |
| [STEAM_RELEASE.md](STEAM_RELEASE.md) | Set up Steamworks, upload builds (manually or from GitHub), achievements, Steam Cloud, Steam Deck, store page |

## Suggested order

1. **Server:** [DEPLOY_CONTABO.md](DEPLOY_CONTABO.md). Get `https://play.yourgame.com/health` answering.
2. **GitHub:** set `GAME_SERVER_URL`, enable write permissions, create `main` ([CI_RELEASES.md](CI_RELEASES.md)). Push, and download the `.exe` from Releases.
3. **Friends test:** share the installer from Releases and play online together.
4. **Steam:** register, pay the fee, and make the "Coming Soon" page ([STEAM_RELEASE.md](STEAM_RELEASE.md)). Pick the price ([STEAM_PRICING.md](STEAM_PRICING.md)).
5. **Steam uploads:** set the Steam secrets so every push lands on the `beta` branch.
6. **Launch.**
