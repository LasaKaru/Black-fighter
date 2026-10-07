# Pricing BLACKEYE: Ink City on Steam

## Recommendation

| Phase | Price (USD) | Why |
|---|---|---|
| **Early Access launch** | **$9.99** | Big content scope (16 islands, story, bosses, online modes), but the art, audio and voice are still placeholder-quality. $9.99 is an easy impulse buy and leaves room to go up. |
| Launch discount | 10–15% off for the first week ($8.49–$8.99) | Steam's launch discount gets you onto the "New & Trending" and discount lists. |
| **1.0 release** | **$14.99** | Raise the price when the art pass, real music, voice acting and polish are in. Tell Early Access buyers up front that the price will rise. |
| Seasonal sales | 20–35% off at first, deeper (50%) after a year | Don't discount deeply in the first months; it trains players to wait. |

**Why not free-to-play?** F2P needs a cosmetic shop, live-ops and a much bigger audience to pay for servers. The game is built around a one-time purchase plus a cheap server (see [SERVER_ARCHITECTURE.md](SERVER_ARCHITECTURE.md)), which suits a solo developer better.

**Why not $19.99+?** Players compare against established indie parkour and brawler games. At $19.99 they expect hand-made art, recorded audio and a long polished campaign. Get there first, then price there.

**Why not $4.99 or less?** Very low prices signal "asset flip". You also earn little per sale while still paying for servers and support. Below about $5, refunds and Steam's cut eat most of the margin.

## Comparable games to check before you decide

Search Steam for small-team 3D parkour, brawler and open-world sandbox games released in the last two years. Note their price, review count and Early Access status, and put yourself in the same band. Steam's own **pricing page in Steamworks** also shows Valve's suggested price for every region when you enter your USD price.

## Regional pricing

- In Steamworks → *Pricing*, enter $9.99 and click **"Use recommended regional prices"**. Valve converts it for about 40 currencies, using lower prices in poorer regions.
- South Asia (including Sri Lanka), Latin America, Turkey and the CIS end up much cheaper. That is good: lower prices there cut piracy and grow your audience.
- Re-check regional prices once a year; Valve updates its recommendations.

## What you actually earn (rough)

Example: 1,000 copies at $9.99 with a mix of regional prices.

| | |
|---|---|
| Gross sales | ≈ $8,000 (regional prices lower the average) |
| Refunds (≈ 8–12% is normal) | ≈ −$800 |
| VAT/sales tax (Steam collects it in many countries) | ≈ −$600 |
| Steam's share (30%) | ≈ −$2,000 |
| US tax withholding (if no tax treaty applies, see below) | up to 30% of US-sourced sales |
| **You receive** | **≈ $4,000–4,600** before your own income tax |

Steam's share falls to 25% after $10M gross and 20% after $50M.

## One-time costs and requirements

- **Steam Direct fee: $100 per game.** Valve pays it back after the game earns $1,000 gross.
- **New Steamworks accounts wait 30 days** after paying the fee before they can release.
- **A "Coming Soon" store page must be public for at least 2 weeks** before launch. Put it up as early as possible, because wishlists drive day-one visibility.
- Valve reviews the store page and the build (a few business days each).
- **Tax interview:** a developer in Sri Lanka fills in a W-8BEN. Check whether a US tax treaty applies to you; if none does, Valve withholds up to 30% on US sales. Talk to a local accountant about how this interacts with Sri Lankan income tax.
- **Bank account:** Valve pays monthly by wire transfer. You need a bank that accepts USD SWIFT transfers.
- **Content survey:** answer the AI-content questions honestly. Steam asks whether any content was made with AI tools and requires a description on the store page.

## Running costs to budget

| Item | Monthly |
|---|---|
| Contabo VPS for the game server (one region) | ≈ €5–15 |
| Extra regions (each another VPS) | ≈ €5–15 each |
| Domain name | ≈ $1 |
| Code-signing certificate for Windows (optional, see [DESKTOP_BUILD.md](DESKTOP_BUILD.md)) | ≈ $10–40 |

At $9.99, about 5–10 sales a month already pay for one server region.

## Getting wishlists before launch

1. Make the "Coming Soon" page with a strong trailer: the 20-second ink-chase intro and boss fights are the hook.
2. Release a **free demo** (the Ink Run chapter and two islands) and enter **Steam Next Fest**.
3. Post short clips (zip-lines, grapple, bosses, Ink Turf) on TikTok, YouTube Shorts and Reddit (r/indiegaming, r/IndieDev).
4. Aim for 7,000–10,000 wishlists before launch day if you can. That is roughly the level where the Steam algorithm starts helping a small game.
