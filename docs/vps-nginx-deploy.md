# Max Travel CRM: existing Ubuntu VPS with Docker and Nginx

Repository: https://github.com/alpesh15gb/MaxTravel

Demo: http://82.112.236.81:8099. Later: https://crm.maxtravel.us.
The dedicated `compose.vps.yaml` uses project `max-travel-crm`, its own data volume,
and loopback port 3107. Do not run the Caddy profile from `compose.yaml` on this host.

## First installation

Check that ports 3107 and 8099 are unused. If either appears below, resolve the
conflict before continuing. Existing applications do not need to be stopped.

```bash
ss -ltnp | grep -E ':(3107|8099)\b'
docker compose version
nginx -t
free -h
git clone https://github.com/alpesh15gb/MaxTravel.git /opt/max-travel-crm
cd /opt/max-travel-crm
umask 077
printf 'JWT_SECRET=%s\nAPP_ORIGIN=http://localhost:3107\n' "$(openssl rand -hex 32)" > .env
docker compose -f compose.vps.yaml up -d --build app
docker compose -f compose.vps.yaml ps
curl -fsS http://127.0.0.1:3107/api/health
```

If the repository is private, authenticate Git on the server using a read-only
deploy key or GitHub's credential tooling. Never put an access token in a clone URL.
Do not overwrite an existing installation's `.env` or regenerate its JWT secret.

Before public access, create the owner through an SSH tunnel. Run this on Windows:

```powershell
ssh -N -L 3107:127.0.0.1:3107 root@82.112.236.81
```

Leave the terminal open and visit http://localhost:3107/setup. Create the agency
and owner, then verify sign-in. This is a fresh database; no demo accounts are seeded.

## Enable the IP demo

On the VPS:

```bash
cd /opt/max-travel-crm
sed -i 's|^APP_ORIGIN=.*|APP_ORIGIN=http://82.112.236.81:8099|' .env
docker compose -f compose.vps.yaml up -d app
test ! -e /etc/nginx/conf.d/max-travel-crm-demo.conf && \
  cp deploy/nginx-demo.conf /etc/nginx/conf.d/max-travel-crm-demo.conf
nginx -t && systemctl reload nginx
curl -fsS http://127.0.0.1:8099/api/health
```

If UFW is active, allow `8099/tcp`; allow the same port in the provider firewall.
Do not expose 3107. Visit http://82.112.236.81:8099. HTTP is unencrypted: use sample
records for this demo. Do not send customer passports or financial records over HTTP.

## Backups

```bash
cd /opt/max-travel-crm
install -d -o 1000 -g 1000 -m 700 backups
docker compose -f compose.vps.yaml --profile maintenance run --rm backup
```

Run during a quiet window without document changes. Copy encrypted backups off the
VPS and prove a restore before live use. See `single-office-launch.md` and
`operations.md`. Never use `docker compose down -v`: it deletes the data volume.

## Updates from GitHub

If Evolution is enabled, follow `evolution-pilot.md` instead: use `docker compose`
without `-f` to retain the messaging override and worker.

Back up first, then pull and rebuild. This keeps the `.env` and data volume.
The update restarts only this project's app; allow a short maintenance window.

```bash
cd /opt/max-travel-crm
docker compose -f compose.vps.yaml --profile maintenance run --rm backup
git status --short
git rev-parse HEAD
git pull --ff-only origin main
docker compose -f compose.vps.yaml up -d --build app
docker compose -f compose.vps.yaml ps
curl -fsS http://127.0.0.1:3107/api/health
docker compose -f compose.vps.yaml logs --tail=80 app
```

Stop if the backup or pull fails. Save the previous commit ID. An old app image
alone may not reverse a database migration; use the matching tested backup when
recovery requires it. For routine restart use `docker compose -f compose.vps.yaml restart app`.

## Switch to the domain after the demo

Point the domain's A record to 82.112.236.81. Configure an AAAA record only if IPv6
is intentionally supported. Add `deploy/nginx-domain.conf` as a separate Nginx
virtual host, test and reload Nginx, then issue TLS using the host's existing
certificate tooling (for example, if Certbot with the Nginx plugin is already
installed: `certbot --nginx -d crm.maxtravel.us`). Verify certificate renewal.

Once HTTPS is working, change `.env` to `APP_ORIGIN=https://crm.maxtravel.us` and
run `docker compose -f compose.vps.yaml up -d app`. Test login, uploads, reporting
and `/api/health` through HTTPS. Remove only the demo Nginx file created above,
test/reload Nginx and close demo port 8099 in the firewalls. Preserve the same
project name and data volume. Set up daily backups and external health alerts.
