# Hosting the game server on a Contabo VPS

This takes about 30 minutes the first time. After that, every push to `main` updates the server automatically.

## What you need

- A **Contabo Cloud VPS** (the smallest, "Cloud VPS 10", is enough to start) with **Ubuntu 24.04**. Pick the region closest to most players; Singapore is good for Asia.
- A **domain** (for example `play.yourgame.com`). Any registrar works: Namecheap, Cloudflare, Porkbun.
- Your GitHub repo URL, e.g. `git@github.com:lasakaru/black-fighter.git`.

## 1. Point the domain at the server

At your DNS provider, add an **A record**: `play` → your VPS IPv4 address (from the Contabo panel). Wait until `ping play.yourgame.com` shows that IP (usually a few minutes).

## 2. Log in and run the setup script

```bash
ssh root@YOUR_SERVER_IP
apt-get update && apt-get install -y git curl
curl -fsSLO https://raw.githubusercontent.com/lasakaru/black-fighter/main/deploy/setup-server.sh
sudo bash setup-server.sh git@github.com:lasakaru/black-fighter.git play.yourgame.com you@email.com main
```

- **Private repo:** the curl download needs a token. Instead, copy the file up with `scp deploy/setup-server.sh root@YOUR_SERVER_IP:` from your PC.
- **Deploy key:** the script creates a key for the server and prints it. Add it on GitHub (**Settings → Deploy keys → Add deploy key**, read-only), then press Enter.
- **Admin token:** the script prints an **admin token**. Save it in your password manager; it is also stored in `/etc/blackeye.env`.

The script then does all of this:

| Step | Result |
|---|---|
| Node 22, nginx, certbot, ufw firewall | Only SSH, 80 and 443 are open |
| `blackeye` system user | The server never runs as root |
| `/opt/blackeye/app` | The code (git clone) |
| `/opt/blackeye/data` | Leaderboards, cloud saves, bans |
| `/etc/blackeye.env` | Settings (see `deploy/blackeye.env.example`) |
| `blackeye.service` | systemd keeps the server running and restarts it on crash or reboot |
| nginx site + Let's Encrypt | `https://play.yourgame.com` with auto-renewing HTTPS |

## 3. Check it

```bash
curl https://play.yourgame.com/health
# {"ok":true,"region":"asia","protocol":2,"maintenance":false,"rooms":0,"players":0}
```

- `https://play.yourgame.com` plays the web version.
- `https://play.yourgame.com/admin` opens the admin panel (sign in with the admin token).

## 4. Point the desktop game at it

In GitHub: **Settings → Secrets and variables → Actions → Variables → New repository variable**: `GAME_SERVER_URL` = `https://play.yourgame.com`.

Every `.exe` built from now on connects there automatically (see [CI_RELEASES.md](CI_RELEASES.md)).

## 5. Automatic updates on every push (optional, recommended)

1. On your PC, make a key just for GitHub Actions:
   ```bash
   ssh-keygen -t ed25519 -N '' -f blackeye-deploy -C github-actions
   ```
2. Allow it to log in as the `blackeye` user:
   ```bash
   ssh root@YOUR_SERVER_IP "cat >> /opt/blackeye/.ssh/authorized_keys && chown blackeye:blackeye /opt/blackeye/.ssh/authorized_keys && chmod 600 /opt/blackeye/.ssh/authorized_keys" < blackeye-deploy.pub
   ```
3. In GitHub, add:
   - **secret** `DEPLOY_SSH_KEY` = the contents of the private file `blackeye-deploy`
   - **variable** `DEPLOY_HOST` = your server IP or `play.yourgame.com`
   - **variable** `DEPLOY_USER` = `blackeye` (the default)
4. Push to `main`. The **Deploy server** workflow:
   1. SSHes in and runs `deploy/update.sh <commit>`, which does `git fetch`, `npm ci`, `vite build`, and restarts the service.
   2. Checks `/health`.

Manual update at any time:

```bash
ssh blackeye@YOUR_SERVER_IP 'bash /opt/blackeye/app/deploy/update.sh'
```

## Everyday commands

| Task | Command |
|---|---|
| Live logs | `journalctl -u blackeye -f` |
| Restart | `sudo systemctl restart blackeye` |
| Status | `systemctl status blackeye` |
| Change settings | `sudo nano /etc/blackeye.env` then restart |
| Back up data | `sudo tar czf ~/blackeye-data-$(date +%F).tgz /opt/blackeye/data` |
| Renew HTTPS (automatic, to test) | `sudo certbot renew --dry-run` |
| OS security updates | `sudo apt-get update && sudo apt-get upgrade -y` (or enable `unattended-upgrades`) |

## Before a big update

1. In `/admin`, turn on **maintenance mode** and send an announcement ("Server update in 5 minutes").
2. Push to `main` (or run `update.sh`). Players get a "server restarting" message, and the game reconnects.
3. Turn maintenance off.

## Hardening checklist

- [ ] Log in with SSH keys and disable password login: `PasswordAuthentication no` in `/etc/ssh/sshd_config`.
- [ ] Use a long random `ADMIN_TOKEN`. Optionally limit `/admin` to your IP (see `deploy/nginx-blackeye.conf`).
- [ ] Optionally put Cloudflare in front for DDoS protection (proxy on, SSL mode "Full (strict)").
- [ ] Back up the daily data folder off the server.
- [ ] Add an uptime monitor on `/health`.

## Adding another region

Rent another VPS in the new region and repeat steps 1–3 with a new subdomain (`eu.yourgame.com`) and `REGION=eu` in `/etc/blackeye.env`. Then list all regions in the `GAME_SERVERS` variable (see [SERVER_ARCHITECTURE.md](SERVER_ARCHITECTURE.md#going-worldwide-regions)).
