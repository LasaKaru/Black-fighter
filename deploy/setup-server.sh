#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 22.04/24.04 VPS (e.g. Contabo) for the BLACKEYE server.
#
#   sudo bash setup-server.sh <git-repo-url> <domain> <email> [branch]
#
# Example:
#   sudo bash setup-server.sh git@github.com:lasakaru/black-fighter.git play.example.com me@example.com main
#
# What it does: installs Node 22, nginx, certbot and a firewall; creates the
# "blackeye" user; clones the repo to /opt/blackeye/app; builds the web client;
# writes /etc/blackeye.env with a random ADMIN_TOKEN; installs the systemd
# service and the nginx site; and gets a free HTTPS certificate.
# Full guide: docs/DEPLOY_CONTABO.md
set -euo pipefail

REPO="${1:?usage: setup-server.sh <git-repo-url> <domain> <email> [branch]}"
DOMAIN="${2:?missing domain}"
EMAIL="${3:?missing email (for the HTTPS certificate)}"
BRANCH="${4:-main}"
ROOT=/opt/blackeye
APP="$ROOT/app"

if [[ $EUID -ne 0 ]]; then echo "Run with sudo." >&2; exit 1; fi

echo "==> packages"
apt-get update -y
apt-get install -y ca-certificates curl git nginx certbot python3-certbot-nginx ufw
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> firewall (SSH + HTTP/HTTPS only)"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> user and folders"
id blackeye >/dev/null 2>&1 || useradd --system --create-home --home-dir "$ROOT" --shell /bin/bash blackeye
mkdir -p "$ROOT/data" "$ROOT/.ssh"
chown -R blackeye:blackeye "$ROOT"
chmod 700 "$ROOT/.ssh"

echo "==> code"
if [[ "$REPO" == git@* && ! -f "$ROOT/.ssh/id_ed25519" ]]; then
  # private repo: give the server its own read-only deploy key
  sudo -u blackeye -H ssh-keygen -t ed25519 -N '' -C "blackeye-server" -f "$ROOT/.ssh/id_ed25519" >/dev/null
  sudo -u blackeye -H bash -c "ssh-keyscan github.com >> $ROOT/.ssh/known_hosts 2>/dev/null"
  echo
  echo "Add this key on GitHub → your repo → Settings → Deploy keys → Add deploy key (read-only):"
  echo
  cat "$ROOT/.ssh/id_ed25519.pub"
  echo
  read -r -p "Press Enter once the key is added... " _
fi
if [[ ! -d "$APP/.git" ]]; then
  sudo -u blackeye -H git clone --branch "$BRANCH" "$REPO" "$APP"
fi
sudo -u blackeye -H git -C "$APP" config pull.ff only

echo "==> settings (/etc/blackeye.env)"
if [[ ! -f /etc/blackeye.env ]]; then
  TOKEN=$(openssl rand -hex 24)
  sed -e "s|^ADMIN_TOKEN=.*|ADMIN_TOKEN=$TOKEN|" "$APP/deploy/blackeye.env.example" > /etc/blackeye.env
  chmod 600 /etc/blackeye.env
  echo
  echo "    Admin panel token (save it!): $TOKEN"
  echo
fi

echo "==> let the deploy user restart the service without a password"
cat > /etc/sudoers.d/blackeye <<'EOF'
blackeye ALL=(root) NOPASSWD: /usr/bin/systemctl restart blackeye, /usr/bin/systemctl status blackeye
EOF
chmod 440 /etc/sudoers.d/blackeye

echo "==> service"
cp "$APP/deploy/blackeye.service" /etc/systemd/system/blackeye.service
systemctl daemon-reload
systemctl enable blackeye
sudo -u blackeye -H bash "$APP/deploy/update.sh" --no-restart
systemctl restart blackeye

echo "==> nginx"
sed "s/YOUR_DOMAIN/$DOMAIN/g" "$APP/deploy/nginx-blackeye.conf" > /etc/nginx/sites-available/blackeye
ln -sf /etc/nginx/sites-available/blackeye /etc/nginx/sites-enabled/blackeye
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> HTTPS certificate"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || \
  echo "certbot failed: check that $DOMAIN points at this server's IP, then run: sudo certbot --nginx -d $DOMAIN"

echo
echo "Done. Check:  curl https://$DOMAIN/health"
echo "Admin panel:  https://$DOMAIN/admin"
echo "Logs:         journalctl -u blackeye -f"
