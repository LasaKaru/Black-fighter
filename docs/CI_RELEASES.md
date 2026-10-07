# Automatic builds and releases (GitHub Actions)

Three workflows live in `.github/workflows/`:

| Workflow | When | What |
|---|---|---|
| **CI** (`ci.yml`) | Every push (except `main`) and every pull request | Typecheck, unit tests, server test, web build |
| **Release** (`release.yml`) | Every push to `main`, any `v*` tag, or the **Run workflow** button | Tests, then builds the Windows `.exe` + zip and the Linux AppImage + tar.gz, creates a **tag** and a **GitHub Release** with the files, and (optionally) uploads to Steam |
| **Deploy server** (`deploy-server.yml`) | Push to `main` that changes game/server code | SSHes into your VPS, updates and restarts the server (see [DEPLOY_CONTABO.md](DEPLOY_CONTABO.md)) |

## How versions and tags work

- **Push to `main`:** the version is `<major>.<minor>` from `package.json` plus the workflow run number, e.g. `0.4.23`, tag `v0.4.23`. Every push gets a new, increasing version and nothing needs editing.
- **Push a tag yourself** (`git tag v1.0.0 && git push origin v1.0.0`): that exact version is used.
- **New major or minor version:** change `"version"` in `package.json` (e.g. to `1.0.0`). Later pushes become `1.0.N`.
- **Skip a release:** put `[skip release]` in the commit message (for README tweaks, for example).

The version is stamped into the app (`app.getVersion()`, the installer and the file names) automatically.

## One-time setup

### 1. Create the `main` branch

Releases run on pushes to `main`. If your work is on another branch, open a pull request into `main` and merge it, or create `main` from it on GitHub (**Branches → New branch**). You can also make `main` the default branch under **Settings → General**.

Until then you can start a release by hand: **Actions → Release → Run workflow** (choose the branch).

### 2. Allow the workflow to create releases

**Settings → Actions → General → Workflow permissions → "Read and write permissions"** → Save. (The workflow also asks for `contents: write`; some organisations block that unless this is set.)

### 3. Variables and secrets

**Settings → Secrets and variables → Actions**:

| Kind | Name | Example / purpose | Needed? |
|---|---|---|---|
| Variable | `GAME_SERVER_URL` | `https://play.yourgame.com`, the server baked into the game | **Yes** for online play |
| Variable | `GAME_SERVERS` | `Asia=https://asia.yourgame.com,EU=https://eu.yourgame.com` (region picker) | Optional |
| Variable | `GAME_DATA_URL` | Main server for leaderboards and cloud saves when you have regions | Optional |
| Secret | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows code signing ([DESKTOP_BUILD.md](DESKTOP_BUILD.md#code-signing-recommended-before-launch)) | Optional |
| Variable | `STEAM_APP_ID` | Your Steam app ID; turns on the Steam upload job | For Steam |
| Variable | `STEAM_BRANCH` | Steam branch to set live (default `beta`) | Optional |
| Secret | `STEAM_USERNAME`, `STEAM_CONFIG_VDF` | Steam build account ([STEAM_RELEASE.md](STEAM_RELEASE.md#automatic-uploads-from-github)) | For Steam |
| Variable | `DEPLOY_HOST`, `DEPLOY_USER`; Secret `DEPLOY_SSH_KEY` | Server auto-deploy | Optional |

## Using it

```bash
git checkout main
git merge my-feature        # or merge a pull request on GitHub
git push                    # → Release workflow: tests → build .exe → tag v0.4.N → GitHub Release
```

Then open **Actions** to watch it (about 10–15 minutes). When it finishes, the files are under **Releases** on the repo page:

- `BLACKEYE-0.4.N-win-x64.exe`: Windows installer
- `BLACKEYE-0.4.N-win-x64.zip`: portable Windows build
- `BLACKEYE-0.4.N-linux-x64.AppImage` and `.tar.gz`

Release notes are generated from the commit messages and pull requests since the last tag.

The **unpacked** Windows and Linux folders are kept as workflow artifacts (`steam-windows`, `steam-linux`) for 90 days. The Steam job uploads those.

## If a run fails

| Step | Usual cause |
|---|---|
| `test` | A real failing test or type error. Run `npm run typecheck && npm test && npm run test:server` locally. |
| `Package desktop app` on Windows | Bad signing secrets: remove them to build unsigned, or fix the password. |
| `Create GitHub release` | "Read and write permissions" not enabled (step 2), or the tag already has a release (delete that release or push a new version). |
| `steam` | Expired `STEAM_CONFIG_VDF` (re-create it), or depot IDs that don't match `appId + 1/2`. |

## Want macOS too?

Add this to the `matrix.include` list in `release.yml`:

```yaml
- os: macos-latest
  name: mac
  target: --mac
  unpacked: release/mac-universal
```

Without an Apple Developer ID ($99/year) for signing and notarisation, macOS will block the app, so only add this once you have one.
