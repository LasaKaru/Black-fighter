# Releasing on Steam

How to go from this repo to a game on Steam: account, app setup, builds, achievements, Steam Deck and store page. Pricing is in [STEAM_PRICING.md](STEAM_PRICING.md).

## 1. Steamworks account (one time)

1. Sign up at **partner.steamgames.com**. Fill in your legal name and address, the **bank details** (needs a bank that accepts USD SWIFT transfers) and the **tax interview** (W-8BEN for a Sri Lankan individual). Valve also verifies your identity.
2. Pay the **$100 Steam Direct fee** for one app. You receive an **App ID** (e.g. `3456780`).
3. New accounts have a **30-day wait** before their first release. Use it to build the store page.

## 2. App setup in Steamworks

### Depots

In **Steamworks → your app → SteamPipe → Depots**:

| Depot ID | Name | OS | Contents |
|---|---|---|---|
| App ID + 1 (created for you) | Windows | Windows, 64-bit | `release/win-unpacked/` |
| App ID + 2 (add it, optional) | Linux | Linux + SteamOS | `release/linux-unpacked/` |

You can start with **Windows only**. Steam Deck and Linux players then run it through Proton, which handles Electron games well.

### Launch options

**Installation → General**:

| OS | Executable | Arguments |
|---|---|---|
| Windows | `BLACKEYE Ink City.exe` | *(none)* |
| Linux (if you ship the Linux depot) | `blackeye-ink-city` | `--no-sandbox` (Chromium's sandbox cannot start inside Steam's Linux runtime) |

Add a second Windows launch option, "Windowed", with the argument `--windowed`.

### Publish

Click **Publish** on the Steamworks "Publish" tab after any app-config change.

## 3. Uploading a build

### Manual upload (first time, to learn the flow)

1. Download the **Steamworks SDK** and use `tools/ContentBuilder`.
2. Copy `release/win-unpacked/*` (from `npm run dist:win` or the GitHub workflow's `steam-windows` artifact) into `ContentBuilder/content/windows/`.
3. Create `ContentBuilder/scripts/app_build.vdf`:

   ```
   "AppBuild"
   {
     "AppID" "3456780"
     "Desc" "v0.4.1"
     "ContentRoot" "..\content\"
     "BuildOutput" "..\output\"
     "Depots"
     {
       "3456781"
       {
         "FileMapping" { "LocalPath" "windows\*" "DepotPath" "." "recursive" "1" }
       }
     }
   }
   ```

4. Run `builder\steamcmd.exe +login <build_account> +run_app_build ..\scripts\app_build.vdf +quit`.
5. In **Steamworks → SteamPipe → Builds**, set the new build live on a branch. Use `beta` for testing; `default` is what buyers get.

### Automatic uploads from GitHub

The **Release** workflow uploads every build for you when `STEAM_APP_ID` is set (see [CI_RELEASES.md](CI_RELEASES.md)). It uses [`game-ci/steam-deploy`](https://github.com/game-ci/steam-deploy).

1. **Make a separate Steam account for builds.** Add it to your Steamworks partner group with only the permissions **Edit App Metadata** and **Publish App Changes To Steam** for this app. Turn on Steam Guard by email (not the mobile authenticator).
2. **Log in once with SteamCMD** on your PC to get a reusable login file:
   ```bash
   steamcmd +login <build_account> +quit      # enter the password and Steam Guard code once
   base64 -w0 ~/Steam/config/config.vdf       # Linux. Windows: steamcmd\config\config.vdf (use certutil -encode or PowerShell)
   ```
3. **Add the GitHub settings:**
   - Secrets: `STEAM_USERNAME` = the build account, `STEAM_CONFIG_VDF` = the base64 text.
   - Variables: `STEAM_APP_ID` = your App ID.
   - Optional variables: `STEAM_BRANCH` (default `beta`), and `STEAM_LINUX` = `true` once the Linux depot exists.
4. **Push to `main`.** Every build appears on the `beta` branch automatically. When you are happy with it, set it live on `default` yourself in Steamworks. Valve does not allow tools to push straight to `default`, which is a good safety net.

If the upload starts failing with a login error after some weeks, Steam Guard expired the session. Repeat step 2.

## 4. Achievements (already wired up)

The desktop build mirrors every in-game achievement to Steam, using the in-game id upper-cased (e.g. `FIRST_INK`).

1. Run `npm run steam:achievements`. It prints all 100 achievements and writes `build/steam-achievements.csv`.
2. In **Steamworks → Stats & Achievements → Achievements**, create each one with exactly that **API name**, plus the display name, description and a 64×64 icon (locked and unlocked versions). Then publish.
3. Install the Steam library binding as a runtime dependency:
   ```bash
   npm install steamworks.js
   ```
   `electron/main.cjs` loads it automatically when Steam launches the game (Steam sets `SteamAppId`) and enables the Steam overlay. Without it the game still runs; achievements just don't sync.
4. Test locally: create `steam_appid.txt` containing your App ID next to the exe, start Steam, run the game, and unlock "First Ink".

## 5. Steam Cloud saves

The desktop build writes every save as a small JSON file in the user's profile folder (as well as the game's own storage):

| OS | Folder |
|---|---|
| Windows | `%APPDATA%\BLACKEYE Ink City\saves\` |
| Linux / Steam Deck | `~/.config/BLACKEYE Ink City/saves/` |

Files: `blackeye.profile.v1.json` (slot 1), `blackeye.profile.slot2.json`, `blackeye.profile.slot3.json` and `blackeye.settings.v1.json`. When the game starts, it compares each file with its own copy and keeps the newer one, so a save that Steam Cloud brought from another PC wins.

Turn on **Steam Auto-Cloud** under **Steamworks → Application → Steam Cloud**:

- Byte quota: 20 MB, files: 20
- Root paths:

| Root | Subdirectory | Pattern | OS |
|---|---|---|---|
| `WinAppDataRoaming` | `BLACKEYE Ink City/saves` | `*.json` | Windows |
| `LinuxXdgConfigHome` | `BLACKEYE Ink City/saves` | `*.json` | Linux |

Test it on two PCs (or a PC and a Steam Deck) before launch. The in-game cloud save codes (Progress screen) keep working as well.

## 6. Steam Deck

The game already has gamepad controls with on-screen glyphs, touch controls and a 16:10-friendly UI. For a "Verified" badge Valve checks:

- **Default controller config:** set it to **Gamepad** in Steamworks → Steam Input.
- **Text size** readable at 1280×800: the UI scale setting is under Settings → Accessibility.
- **No launcher, no mouse required:** the game is fullscreen by default and fully navigable by pad.
- **Performance:** use the Medium graphics preset at 1280×800 and aim for 30–60 fps.

Request a review under **Steamworks → Steam Deck Compatibility**.

## 7. Store page checklist

| Asset | Size |
|---|---|
| Header capsule | 920 × 430 |
| Small capsule | 462 × 174 |
| Main capsule | 1232 × 706 |
| Vertical capsule | 748 × 896 |
| Library capsule | 600 × 900 |
| Library hero | 3840 × 1240 |
| Library logo | 1280 wide, transparent PNG |
| Screenshots | at least 5, 1920 × 1080 (use the in-game **Photo mode**, K) |
| Trailer | 30–90 s; open with gameplay in the first 5 seconds |

Valve updates these sizes from time to time; Steamworks shows the current ones on the Graphical Assets page.

Also fill in:

- **Description:** the feature list from the README works well.
- **Tags:** Parkour, Action, Open World, Beat 'em up, Multiplayer, Co-op, Stylized, 3D Platformer.
- **System requirements:** Windows 10 64-bit, 4 GB RAM, a GPU with WebGL 2 (GTX 750 / Intel Iris Xe or better), 500 MB disk.
- **Content survey:** mild cartoon violence, online chat (moderated through the admin panel), and the AI-generated content disclosure.
- **Controller support:** "Full controller support".
- **Multiplayer tags:** Online Co-op, Online PvP. Note that online play needs your servers to stay up.

## 8. Launch day

1. Turn on **maintenance mode** on the servers (`/admin`) only if you are deploying a new protocol version; otherwise leave the servers open.
2. Set the release build live on `default` and press **Release** on the store page.
3. Watch `/admin` (players and rooms), `journalctl -u blackeye -f` and the Steam forums.
4. Hotfix flow: fix → push to `main` → the build lands on `beta` → test → set live on `default`, about 20 minutes end to end.
