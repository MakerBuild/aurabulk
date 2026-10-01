#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server (Hetzner, Oracle Cloud or any
# VPS). Run it as root or as the default sudo user:
#
#   curl -fsSLO https://raw.githubusercontent.com/MakerBuild/aurabulk/main/deploy/setup.sh
#   bash setup.sh
#
# Safe to run again: every step checks before it changes anything.
set -euo pipefail

ROOT=/opt/aurabulk
REPO=$ROOT/repo
REMOTE=git@github.com:MakerBuild/aurabulk.git
APP_USER=aurabulk

# Hosts like Hetzner hand out root only. The site should not run as root, so
# make a sudo user with root's SSH keys and carry on as that user.
if [[ $EUID -eq 0 ]]; then
  if ! id "$APP_USER" &>/dev/null; then
    adduser --disabled-password --gecos "" "$APP_USER"
    usermod -aG sudo "$APP_USER"
    echo "$APP_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/aurabulk-admin
    chmod 440 /etc/sudoers.d/aurabulk-admin
    if [[ -d /root/.ssh ]]; then
      cp -r /root/.ssh "/home/$APP_USER/.ssh"
      chown -R "$APP_USER:$APP_USER" "/home/$APP_USER/.ssh"
    fi
  fi
  install -o "$APP_USER" -g "$APP_USER" -m 755 "$0" "/home/$APP_USER/setup.sh"
  echo "Continuing as $APP_USER (log in as ssh $APP_USER@<ip> from now on)."
  exec sudo -iu "$APP_USER" bash "/home/$APP_USER/setup.sh"
fi

ME=$(id -un)

step() { echo; echo "==> $*"; }

step "Clock to UTC, system packages"
sudo timedatectl set-timezone UTC
sudo apt-get update -q
sudo DEBIAN_FRONTEND=noninteractive apt-get install -yq git curl ca-certificates caddy cron iptables-persistent

step "Node.js 24"
if ! node -v 2>/dev/null | grep -q '^v24\.'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -yq nodejs
fi
node -v

step "Swap (builds need headroom on small machines)"
if ! swapon --show | grep -q /swapfile && [[ $(free -m | awk '/Mem:/ {print $2}') -lt 4000 ]]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

step "Firewall: open 80 and 443 (Oracle images reject them by default)"
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport $port -m state --state NEW -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 1 -p tcp --dport $port -m state --state NEW -j ACCEPT
  fi
done
sudo netfilter-persistent save

step "Directories"
sudo mkdir -p "$ROOT"
sudo chown "$ME:$ME" "$ROOT"
mkdir -p "$ROOT/releases" "$ROOT/logs"

step "GitHub deploy key (the server pushes recorded data back to the repo)"
mkdir -p ~/.ssh
chmod 700 ~/.ssh
if [[ ! -f ~/.ssh/id_ed25519 ]]; then
  ssh-keygen -t ed25519 -N "" -C "aurabulk-server" -f ~/.ssh/id_ed25519
fi
ssh-keyscan -t ed25519 github.com 2>/dev/null >> ~/.ssh/known_hosts
sort -u -o ~/.ssh/known_hosts ~/.ssh/known_hosts
# ssh -T always exits 1 against GitHub, so read its greeting instead.
if [[ $(ssh -o BatchMode=yes -T git@github.com 2>&1 || true) != *"successfully authenticated"* ]]; then
  echo
  echo "Add this key at https://github.com/MakerBuild/aurabulk/settings/keys/new"
  echo "Title: aurabulk-server. Tick \"Allow write access\"."
  echo
  cat ~/.ssh/id_ed25519.pub
  echo
  read -rp "Press Enter once the key is added... " < /dev/tty
fi

step "Clone"
if [[ ! -d "$REPO/.git" ]]; then
  git clone "$REMOTE" "$REPO"
fi
git -C "$REPO" config user.name "aurabulk-server"
git -C "$REPO" config user.email "aurabulk-server@users.noreply.github.com"
chmod +x "$REPO"/deploy/*.sh

step "Service, sudo rule for restarts, Caddy, log rotation"
sed "s/__USER__/$ME/" "$REPO/deploy/aurabulk.service" | sudo tee /etc/systemd/system/aurabulk.service > /dev/null
echo "$ME ALL=(root) NOPASSWD: /usr/bin/systemctl restart aurabulk" | sudo tee /etc/sudoers.d/aurabulk > /dev/null
sudo chmod 440 /etc/sudoers.d/aurabulk
sudo cp "$REPO/deploy/Caddyfile" /etc/caddy/Caddyfile
sudo tee /etc/logrotate.d/aurabulk > /dev/null <<EOF
$ROOT/logs/*.log {
  weekly
  rotate 4
  compress
  missingok
  notifempty
  copytruncate
}
EOF
sudo systemctl daemon-reload
sudo systemctl enable aurabulk
sudo systemctl reload caddy || sudo systemctl restart caddy

step "First build (a few minutes)"
"$REPO/deploy/update.sh" --force

step "Scheduled jobs"
crontab "$REPO/deploy/crontab"

echo
curl -fsS -o /dev/null -w "Local check: HTTP %{http_code}\n" http://127.0.0.1:3000/ || echo "Local check failed: journalctl -u aurabulk -n 50"
echo "Point DNS for aurabulk.xyz and www at $(curl -fsS4 https://ifconfig.me || echo 'this server')."
echo "Caddy issues HTTPS for both names on its own once DNS resolves here."
