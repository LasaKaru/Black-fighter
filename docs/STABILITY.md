# Crashes, freezes and getting stuck: what the game does

The rule: **a player never loses progress and never sees a blank or frozen
screen without a way forward**, and every problem reaches the owner panel
(type `kumara` → **Crashes**) so it can be fixed.

## In the game (browser and desktop)

| What goes wrong | What the player sees | What happens behind it |
|---|---|---|
| A bug throws an error in one frame | Nothing; the game carries on | The frame is skipped and the error is reported with the last 30 actions |
| Errors in frame after frame (>20 in 3 s) | "Something went wrong" with **Continue from checkpoint**, **Main menu**, **Restart the game** | Progress is saved first; the game is paused until they choose |
| Graphics driver reset / GPU hiccup (WebGL context lost) | "Restoring graphics…", then the game continues | The game pauses and waits for the context; after 8 s it offers a restart, which continues from the checkpoint |
| A freeze longer than 5 s | The game continues when it can | Reported as a **hang** with what the player was doing |
| The game cannot start (missing WebGL 2, loading error) | A screen with **Start in safe mode**, **Try again**, **Get help** (emails support) | Reported as a **boot** crash |
| The last start crashed hard (tab or GPU died) | "Started in safe mode (low graphics)…" | The next start uses the low preset (and 60 % resolution after two failures) |
| The game stays very slow (<20 fps for 10 s) | "Graphics lowered to medium to keep the game smooth" | Steps the preset down one level, at most every 30 s (Settings → Graphics → "Lower graphics automatically") |
| Player wedged in a wall or caught on an edge mid-air for 3 s | "You were stuck: moved to safe ground" | Moved back to a safe standing spot from a few seconds earlier |
| Player position breaks (NaN / far outside the world) | Same | Reported as **stuck** |
| Stuck anywhere else | Pause → **Get unstuck** | Back to safe ground; in a car, the car is lifted and set upright |
| Car flipped | Rights itself after 1.5 s | Built into the car physics |
| Car cannot move with the throttle held | "Stuck? Pause → Get unstuck" | |
| Falling off the world | Respawn at the last checkpoint | |
| Save file damaged (power cut, disk error) | "Your save was damaged and has been restored from a backup." | A backup copy is kept every 5 minutes; the damaged copy is kept for support; reported as **storage** |
| Browser storage full | Old caches are cleared and the save retried; if it still fails, a warning | The desktop build also writes save files to disk (Steam Cloud) |
| Server unreachable | Single player keeps working; statistics and crash reports are queued and sent later | Owner features (status, events, branding) use the last known values |
| Connection drops in multiplayer | "Connection lost. Reconnecting…" (3 tries: 2 s, 5 s, 10 s), else "playing offline" | The player stays in the world in free roam, never on a dead connection |
| Kicked, banned or maintenance starts | The reason is shown and the game switches to free roam | |
| Maintenance / development | A screen with the comeback countdown; it closes by itself | See the owner panel's **Game status** tab |

## Desktop app (Electron)

| What goes wrong | What happens |
|---|---|
| The game window's process crashes | It reloads (the title screen offers **Continue**). More than 3 times in 5 minutes: a dialog offers **Restart in safe mode** or **Quit** |
| The window stops responding | A dialog: **Wait** or **Restart** |
| The GPU process crashes | Electron restarts it; the game handles the lost graphics context |
| Anything else | Logged to `%APPDATA%/BLACKEYE Ink City/logs/main.log` (attach it to support emails) |
| Save files | Written to a temp file and renamed, so a crash mid-save never leaves a half-written file |

## Server

| What goes wrong | What happens |
|---|---|
| A bug crashes the server process | Data is saved, the process exits and systemd starts a fresh one within 2 s (`Restart=always`); players reconnect automatically |
| Power cut while writing data | Every data file is written to a temp file and renamed (atomic), with a `.bak` copy; unreadable files load the backup |
| One damaged statistics day | Skipped; the others load |
| Floods of requests | Per-IP limits on posts, connections, messages and chat (spam limit) |
| Bad messages from a modified client | Validated and ignored; movement is checked and corrected |

## For the owner

- **Owner panel → Crashes**: problems grouped by cause with counts, players
  affected, versions, platforms and GPUs; open one to see the stack trace,
  what the player was doing and their last actions. **Mark fixed** after a
  release; if the same crash comes back it reopens as **came back**.
- **Crash-free sessions** (last 7 days) is the number to watch: above 99 %
  is good for a game.
- Players can turn crash reports off in Settings → Privacy.
