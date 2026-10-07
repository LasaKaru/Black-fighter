# Building the desktop game (.exe)

The game is a web app (Three.js + Vite). For Steam it is wrapped in **Electron**, which bundles Chromium and adds a native window, so players get a normal Windows `.exe` (plus Linux builds for Steam Deck).

## Why Electron (and not something else)

| Option | Verdict |
|---|---|
| **Electron** ✅ | Same Chromium engine on every PC, so WebGL, gamepads, pointer lock and audio behave exactly as tested. Mature Steam support (`steamworks.js` for achievements and overlay). About 100 MB download. |
| Tauri | Smaller (≈10 MB), but uses the system WebView: WebView2 on Windows, WebKitGTK on Linux/Steam Deck. WebKitGTK's WebGL is slower and buggier for a 3D game, and Steam integration is harder. |
| NW.js | Similar to Electron, but a smaller community and fewer tools. |
| Rewrite in Unity/Godot | Months of work. Not needed. |

## What's in the repo

| File | Purpose |
|---|---|
| `electron/main.cjs` | Creates the window and serves `dist/` from a private `app://game/` address. Also: fullscreen by default, F11/Alt+Enter toggle, single instance, external links in the browser, optional Steamworks. |
| `electron/preload.cjs` | Exposes `window.blackeyeDesktop` (quit, fullscreen, Steam achievement) to the game safely. |
| `electron-builder.yml` | Packaging: Windows NSIS installer + zip, Linux AppImage + tar.gz, macOS dmg |
| `build/icon.png` | App icon (512×512). Replace it with real art; `npm run icon` re-creates the placeholder. |
| `src/net/Endpoints.ts` | Decides which server the game talks to (see below) |

## Commands

```bash
npm install               # once
npm run desktop           # build and run the desktop app (windowed: add -- --windowed)
npm run desktop:dev       # with `npm run dev` running: desktop window on the live dev server
npm run dist:win          # Windows installer + zip in release/   (run on Windows)
npm run dist:linux        # Linux AppImage + tar.gz in release/
npm run dist:mac          # macOS dmg (run on a Mac)
```

**Build on Windows for Windows.** Cross-building the NSIS installer from Linux needs Wine. The GitHub workflow does this on a real Windows runner for you (see [CI_RELEASES.md](CI_RELEASES.md)).

### Output in `release/`

| File | Use |
|---|---|
| `BLACKEYE-0.4.x-win-x64.exe` | Installer for players outside Steam (itch.io, your website, testers) |
| `BLACKEYE-0.4.x-win-x64.zip` | Portable version |
| `win-unpacked/` | **This folder is what you upload to Steam.** Steam is the installer, so don't upload the .exe installer there. |
| `linux-unpacked/`, `.AppImage`, `.tar.gz` | Linux / Steam Deck native |

## Which server the .exe connects to

A desktop game has no web address of its own, so the server address is **baked in at build time**:

```bash
VITE_SERVER_URL=https://play.yourgame.com npm run dist:win
```

Optional variables:

- **`VITE_SERVERS=Asia=https://asia.yourgame.com,EU=https://eu.yourgame.com`** shows a region picker with live ping in Multiplayer.
- **`VITE_API_URL=https://asia.yourgame.com`** sends leaderboards and cloud saves to one main server.

Players can still type another address under **Multiplayer → Server URL**, for example for LAN parties or community servers.

When nothing is set, the desktop build tries `http://localhost:8787` (for development with `npm run server`).

## Saves on desktop

The game keeps using `localStorage`. Electron stores it in the user's profile folder:

- **Windows:** `%APPDATA%\BLACKEYE Ink City\`
- **Linux:** `~/.config/BLACKEYE Ink City/`

Saves survive game updates. For Steam Cloud, see [STEAM_RELEASE.md](STEAM_RELEASE.md#steam-cloud-saves).

## Code signing (recommended before launch)

Unsigned `.exe` files trigger Windows SmartScreen ("Windows protected your PC"). **Steam builds are fine without signing**, because Steam launches them. The installer you hand out elsewhere should be signed:

1. Buy a code-signing certificate (Certum Open Source/Standard, Sectigo, SSL.com). Azure Trusted Signing is the cheapest option, if it is available in your country.
2. Export it as a `.pfx` and base64 it: `base64 -w0 cert.pfx > cert.txt`.
3. Add the GitHub secrets `WIN_CSC_LINK` (the base64 text) and `WIN_CSC_KEY_PASSWORD`. The release workflow then signs automatically.

Some newer certificates live on a hardware token or a cloud HSM and can't be exported as a `.pfx`. For those, follow electron-builder's "Windows code signing" docs for your provider.

## Troubleshooting

| Problem | Fix |
|---|---|
| Black screen | Start from a terminal to see errors: `"BLACKEYE Ink City.exe" --windowed`, then Ctrl+Shift+I for devtools. Update the GPU driver. |
| Can't connect online | Check `https://your-server/health` in a browser. The build must have `VITE_SERVER_URL`, or set it under Multiplayer → Server URL. |
| Antivirus flags the exe | Sign it (above), or submit it to Microsoft as a false positive. |
| Want windowed by default | Add `--windowed` to the shortcut, or in Steam: Properties → Launch options. |
