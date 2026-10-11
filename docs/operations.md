# Operations runbook — Travel OS

For whoever hosts and operates this app. It assumes you have (or are setting up) a Linux host,
a copy of this repository, and a reverse proxy that terminates HTTPS in front of it.

Nothing in this document is automated unless a file in this repository does it. Where a job is a
manual step, it is written as a command you run yourself.

---

## 1. What the system is

Travel OS is a **Next.js server** (`next start`) that serves a private agency workspace. It is not
a static site and it is not serverless: it is a single long-running Node process.

| Component | What it is | Where it lives |
|---|---|---|
| Application server | Next.js 15 on Node, serving pages and API routes on port 3000 | one process on the host (or one container) |
| Database | **SQLite**, a single file | `DATABASE_URL`, by default `prisma/dev.db` |
| Private uploads | Customer documents, never public, served only through short-lived signed URLs | `UPLOAD_ROOT`, by default `./uploads` |
| Session secret | Signs the staff session cookie (HS256, 12-hour lifetime) | `JWT_SECRET` in the environment |

The runtime shape has one consequence that governs everything below: **SQLite is a single-writer
file database with no built-in replication.** There is no replica, no failover and no automatic
point-in-time recovery. One process, one file. The backup cadence in §8 and the restore drill in
§8.3 are the durability story, and the drill is only worth anything if someone has actually run it.

Do not run two app processes against the same SQLite file. If you need more than one instance or
multi-site scale, that is the PostgreSQL + `Decimal` migration recorded in §10.

---

## 2. Configuration

Copy the template and fill it in. `.env` is git-ignored and must never be committed.

```bash
cp .env.example .env
```

| Variable | Required | What it does |
|---|---|---|
| `JWT_SECRET` | **yes** | Signs staff session cookies. Must be at least 32 bytes. The app **refuses to start** with a short or missing value rather than running with a guessable one. |
| `DATABASE_URL` | **yes** | The SQLite file. `file:./dev.db` (Prisma resolves a relative path against `prisma/`). |
| `UPLOAD_ROOT` | recommended | Directory for private customer documents. Defaults to `./uploads` relative to the process working directory — **always set it explicitly in production** so it cannot move when the process is started from elsewhere. |
| `APP_ORIGIN` | recommended | Your public origin, e.g. `https://os.youragency.com`. Cross-origin state-changing API calls are rejected; when this is unset the app falls back to comparing the `Origin` host against the request host, which is weaker behind a proxy or a CDN. Set it. |
| `TRUST_PROXY` | optional | Set to `1` **only** when a proxy you control terminates the connection in front of the app. It makes the sign-in limiter read the client address from the forwarded header instead of the address this server accepted the connection from. Wrong when the app is exposed directly (the header is client-controlled), harmless behind a trusted proxy; the account half of the limiter works either way. |
| `WA_VERIFY_TOKEN` | optional | Enables the inbound WhatsApp webhook's verification handshake. |
| `WA_WEBHOOK_SECRET` | optional | Enables and authenticates inbound WhatsApp messages. Leave both empty to keep the inbound webhook **disabled** (it answers `503`). |
| `NEXT_DIST_DIR` | optional | Build output directory. Defaults to `.next`. Only set this if you deliberately build to another directory. |

### 2.1 Generate the session secret

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# or
openssl rand -hex 32
```

Put the result in `JWT_SECRET` and store a copy in your password manager. Treat it like a
password: it is the only thing standing between a stolen cookie and a staff account.

### 2.2 What rotating `JWT_SECRET` does

Signing out is immediate and global. Every outstanding session cookie fails verification on its
next request, so **every signed-in user is returned to the login screen** and must sign in again.
Nothing is lost or corrupted; sessions are stateless and the database is untouched.

Do it when a device is lost, when you suspect the secret leaked, or on a schedule. If you rotate
while people are working, expect a burst of sign-ins and tell staff first.

Individual sessions also end early on their own: deactivating an employee or changing their
password invalidates that person's existing sessions immediately, because the session is
re-validated against the stored password hash on every request.

### 2.3 Validate the configuration before you start for real

Configuration is validated at boot, before the server accepts a request. The app **prints every
problem it found and exits with status 1** rather than staying alive without listening — a process
that looks running and serves nothing is worse than one that refuses. It refuses a missing or
too-short `JWT_SECRET` (and one that still looks like a placeholder), a missing or unrecognised
`DATABASE_URL`, a SQLite directory that does not exist or cannot be written, an `APP_ORIGIN` that is
not a bare origin, and an `UPLOAD_ROOT` pointing inside `public/` or the build output (which would
serve customer passports as public files). Start the app once in the foreground (§4.1) after any
configuration change and read the first ten lines of output; one of them is the start-up line,
which names where the data lives and how long a session lasts, and never prints a secret.

Confirm the app agrees with you:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health   # expect 200
```

---

## 3. First run

The first person to reach `/setup` becomes the owner. There is no seeded account, no demo data and
no shared password: roles and visa stages are the only thing the seed creates.

```bash
npm install
npx prisma generate
npm run db:migrate        # applies the migration baseline (§7)
npm run build
npm start                 # foreground; see §4 for running it as a service
```

Then, **from the host itself** (not over the network, before it is exposed):

1. Open `http://127.0.0.1:3000/setup`.
2. Create the agency and the owner account. Choose a real password and store it.
3. Sign in, add staff under **Team**, then configure visa checklists and Agency settings.

`/setup` is a one-time creation endpoint and it is unauthenticated. Do this **before** the app is
reachable from a network. If the app must be exposed first, keep it behind an authenticating
reverse proxy until the owner account exists. Setup replay is rejected once an owner exists, but
do not rely on that: the account that exists is the one you created.

Optional, and safe to run more than once:

```bash
npx prisma db seed   # initialises only role and visa-stage definitions; creates no people or money
```

---

## 4. Starting, stopping and restarting

Always build before you serve. `npm start` serves the existing build in `.next`; it does not
compile. **A stale build is the most common cause of "my change did nothing".**

```bash
npm run build      # typecheck + compile; required after any code or dependency change
npm start          # serve on port 3000
```

### 4.1 Foreground (first run, diagnosis)

Run `npm start` in a terminal and watch it. `Ctrl-C` stops it cleanly.

### 4.2 As a systemd service

Adapt the paths, then enable it. This is a template, not a file this repository ships.

```ini
# /etc/systemd/system/travel-os.service
[Unit]
Description=Travel OS
After=network-online.target

[Service]
Type=simple
User=travelos
WorkingDirectory=/srv/travel-os
EnvironmentFile=/srv/travel-os/.env
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5
# The database and uploads must survive a crash: keep them outside the service's temp space.

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now travel-os
sudo systemctl status travel-os
sudo systemctl restart travel-os      # after a rebuild or a configuration change
sudo systemctl stop travel-os         # before a restore (§8.3)
```

Restarting the app is safe and expected: it clears the **in-memory login rate limiter**, which is
exactly why §10 records the limiter's single-node limitation.

---

## 5. Health and readiness

| Endpoint | Expect | Meaning |
|---|---|---|
| `GET /api/health` | `200` | The app is up, the database answered, and the deployed schema is present. |
| `GET /api/health` | `503` | Either the database did not answer, or it answered but no migrations have ever been applied to it. Not ready to serve; do not route traffic to it. |
| `GET /login` | `200` | The app is serving pages (a cheap check that the build is intact). |

```bash
curl -s -o /dev/null -w 'health: %{http_code}\n' http://127.0.0.1:3000/api/health
```

The response separates the two reasons so the fix is obvious: `checks.database` is `ok` or
`unreachable`, and `checks.schema` is `ok` or `not-deployed` (an empty or unmigrated database file
is the usual cause of the latter — run `npm run db:migrate`). It carries nothing else but uptime and
a timestamp: no version, no paths, no configuration, no data. It is safe to expose to a proxy or an
orchestrator, but it is still an internal endpoint. Use the HTTP status code as the signal.

Point your proxy's upstream health check at `/api/health`, and treat a `503` as "remove from
rotation", not as "retry forever".

---

## 6. Logs and the correlation id

The app writes to **stdout and stderr**. There is no log file configuration in this repository:
capture the streams with whatever supervises the process — systemd's journal, the container
runtime, or a redirect you set up yourself.

```bash
sudo journalctl -u travel-os -f            # systemd, follow
sudo journalctl -u travel-os --since "1 hour ago"
docker logs -f travel-os                    # container (see §9)
```

**Use the correlation id for any `500`.** When a request fails unexpectedly, the response carries
a correlation id and the same id is written to the server log next to the stack trace. Ask the
user to read you the id, then find the failure:

```bash
sudo journalctl -u travel-os --since "30 min ago" | grep '<paste-the-id>'
```

The body shape and the id's JSON key are defined in
[src/lib/guard.ts](../src/lib/guard.ts) — read it if you need the exact field. Internal error
messages are not returned to the browser, so the log is the only place the real reason appears.

---

## 7. Schema upgrades

Deployments apply a **checked-in migration history**; they never reshape the database from the
current schema file.

| Command | What it does |
|---|---|
| `npm run db:generate` | Regenerates the Prisma client after a schema change. Needed after pulling code. |
| `npm run db:migrate` | `prisma migrate deploy` — applies every migration that has not run yet. Safe to run repeatedly; this is the command a deploy uses. |
| `npx prisma migrate status` | Shows which migrations are applied and which are pending. Read this first when something is odd. |

`prisma db push` is **not** a deployment tool: it rewrites the database to match the schema and
records nothing, so it can silently drop data. It is not part of any documented procedure here.

### 7.1 Upgrade procedure

```bash
cd /srv/travel-os

# 1. Back up first. An upgrade you can undo is an upgrade you can do calmly.
node scripts/backup.mjs --out /var/backups/travel-os/pre-upgrade-$(date +%Y%m%d-%H%M%S)

# 2. Stop serving, pull the new code and build it.
sudo systemctl stop travel-os
git pull
npm ci
npm run db:generate
npm run build

# 3. Inspect, then apply.
npx prisma migrate status
npm run db:migrate

# 4. Start and verify.
sudo systemctl start travel-os
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health   # expect 200
```

### 7.2 Rolling one back

**There are no down migrations.** A migration that moves or drops data cannot be reversed by a
command; write a new forward migration for that.

For an upgrade that went wrong, the supported rollback is the backup:

```bash
sudo systemctl stop travel-os
node scripts/restore.mjs --in /var/backups/travel-os/pre-upgrade-<timestamp> \
                         --out /srv/travel-os-restore --force
# Verify the restored copy (§8.3), then point the service at it and restart.
sudo systemctl start travel-os
```

Restoring rolls the data back to the moment of the backup: anything entered since is lost. That is
why step 1 exists and why the maintenance window is announced.

**Baseline note.** A database previously created with `db push` has data but no migration history,
so `migrate deploy` would try to create objects that already exist. Mark the baseline as applied
once, then never again:

```bash
npx prisma migrate resolve --applied 0_init   # the committed baseline, prisma/migrations/0_init
npx prisma migrate status                     # confirm: no pending migrations
```

This repository already carries that baseline: `prisma/migrations/0_init/migration.sql` was
generated from `prisma/schema.prisma` and marked as applied to the development database, so any
database that was built with `db push` can be brought onto the migration path with the command
above. Apply it **once** per database. From then on `npm run db:migrate` is the only command that
touches the schema.

---

## 8. Backup and restore

The backup consists of the SQLite database **and** the uploads directory. Backing up only one of
them gives you a workspace whose records point at documents that no longer exist. There is no
automated backup in this repository — the schedule is yours to create.

### 8.1 Take a backup

```bash
node scripts/backup.mjs --out /var/backups/travel-os/$(date +%Y%m%d-%H%M%S)
```

The script writes the database and the upload tree into the target directory plus a manifest
describing what it captured (row counts and checksums). Read the manifest when it finishes; if it
reports counts that look wrong for your agency, investigate before trusting the copy.

Suggested cadence — choose and write it down, because an unstated cadence is no cadence:

- **Nightly** to local disk, keeping 14 days.
- **Weekly** to storage on another machine or an object store. A backup on the same disk as the
  database survives a mistake, not a disk failure.
- **Before** every upgrade and every restore (§7.1).

Example cron entry (adapt paths, and make sure the job's environment has the same `DATABASE_URL`
and `UPLOAD_ROOT` the app uses):

```cron
15 2 * * * cd /srv/travel-os && set -a && . ./.env && set +a && \
  node scripts/backup.mjs --out /var/backups/travel-os/$(date +\%Y\%m\%d-\%H\%M\%S) >> /var/log/travel-os-backup.log 2>&1
```

### 8.2 See what a backup holds

```bash
ls -la /var/backups/travel-os/<timestamp>
cat /var/backups/travel-os/<timestamp>/manifest.json
```

### 8.3 The restore drill — verify before you trust

Run this **now**, on a scratch directory, before you ever need it. An untested backup is a guess.

```bash
# 1. Restore into a throwaway location, never over the live data.
node scripts/restore.mjs --in  /var/backups/travel-os/<timestamp> \
                         --out /srv/travel-os-drill --force

# 2. Read the verification output. restore.mjs compares the restored database's row counts and
#    file checksums against the backup manifest and reports any mismatch. A mismatch means the
#    backup is not usable — take a fresh one and investigate, do not proceed.

# 3. Point a throwaway instance at the restored copy and look at it with real eyes.
cd /srv/travel-os
DATABASE_URL="file:/srv/travel-os-drill/dev.db" \
UPLOAD_ROOT=/srv/travel-os-drill/uploads \
JWT_SECRET="$(grep -m1 JWT_SECRET .env | cut -d= -f2- | tr -d '\"')" \
PORT=3999 npm start
```

Then sign in on `http://127.0.0.1:3999` and confirm the restored workspace is the one you expect:
customers present, a known booking's balance correct, an uploaded document opening through the
signed link. A row count that matches plus one document that opens tells you more than any log
line.

```bash
# 4. Clean up the drill.
rm -rf /srv/travel-os-drill
```

Restoring over live data (`--out` pointing at the running install) requires stopping the service
first; `--force` overwrites an existing target and will not protect you from a typo.

---

## 9. Container

The repository ships a `Dockerfile` and `scripts/docker-entrypoint.sh`. The entrypoint applies
pending migrations (`prisma migrate deploy`) and then serves the app on **port 3000**, so a
container start is a safe, idempotent deploy step. Build the image with the repository as context:

```bash
docker build -t travel-os:$(git rev-parse --short HEAD) .
```

Mount one volume for the durable state — the database and the uploads directory — and pass the
configuration as environment:

```bash
docker run -d --name travel-os \
  -p 3000:3000 \
  -v /srv/travel-os-data:/data \
  -e DATABASE_URL="file:/data/travelos.db" \
  -e UPLOAD_ROOT="/data/uploads" \
  -e JWT_SECRET="<the same secret you stored>" \
  -e APP_ORIGIN="https://os.youragency.com" \
  travel-os:<tag>
```

```bash
docker ps --filter name=travel-os            # running?
docker logs -f travel-os                     # boot + migration output
docker exec travel-os node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>console.log(r.status))"
docker stop travel-os && docker rm travel-os
```

Operational notes for this path:

- **The volume is the installation.** If `/data` is not mounted, the database and every upload die
  with the container. Back up `/data`, not the container.
- **Run one replica.** Two containers sharing one SQLite file is the contention case §1 warns
  about; scale by moving to PostgreSQL first (§10).
- **The image applies migrations on start.** That is convenient and it is a write. If your policy is
  that deploys do not mutate data unattended, run `npm run db:migrate` as a separate step and skip
  it in the entrypoint.
- **Node version.** The image pins the version it was tested with. For a bare-metal install use a
  current Node LTS (Node 20 or newer).
- **Backups inside a container** are just the same commands run against the mounted volume; run
  `scripts/backup.mjs` on the host, pointed at `/srv/travel-os-data`, rather than baking backups
  into the image.

---

## 10. Known sharp edges

Read these before you promise anyone a service level.

| Area | The honest position |
|---|---|
| **Login rate limiting** | In memory: a sliding window of failed attempts counted per account (5 in 10 minutes) and per client address (20 in 10 minutes), answered with `429` and a `Retry-After`. The account bucket is the authoritative one; the address bucket only engages when a forwarded header carries an address (§2, `TRUST_PROXY`), because a directly exposed app has no trustworthy client address to read. It **resets when the process restarts and does not coordinate across processes**, so it slows an attacker on one instance, not a distributed one. A shared store (Redis) is the fix; nothing here uses one. |
| **SQLite** | Single writer, no replication, no failover. Fine for one office. Backup cadence + the §8.3 drill are the durability story. Multi-instance or high-value accounting needs PostgreSQL with `Decimal` money columns. |
| **Money storage** | All arithmetic is integer paise, but the money columns are SQLite `Float`. The PostgreSQL/`Decimal` migration is a prerequisite for high-value accounting. |
| **Sessions** | 12 hours, stateless, signed. Ended early by a `JWT_SECRET` change or a password change. There is no per-session revocation list beyond that. |
| **Inbound WhatsApp** | Disabled unless `WA_VERIFY_TOKEN` and `WA_WEBHOOK_SECRET` are set; unconfigured, the endpoint answers `503`. Even when enabled, the inbound route is a normalized adapter — configure your provider's signature verification before pointing a real provider at it. |
| **Outbound WhatsApp, GDS, OCR, payments** | Deliberately absent. Outbound messages are manual handoffs from the staff UI and are logged as *logged*, never *delivered*. Tickets are typed in by staff; document fields are confirmed by a human; receipts record money actually received. No message, charge or payout leaves this app on its own. |
| **`/setup`** | One-time, unauthenticated creation endpoint. Complete it before exposure (§3) or keep the app behind an authenticating proxy. |
| **Audit trail** | Covers in-app actions and their actors. Changes made directly to the database file are not captured. |
| **Timezone** | Dates and timestamps render in the viewer's timezone. If your staff work across timezones, a fixed agency timezone is a change worth making first. |

### Open decisions and who owns them

These are deliberately not decided here; each one changes behaviour or needs something only the
agency can supply.

1. **Backup retention and off-site destination** — the agency/IT owner. Cost is storage and a
   restore window; the alternative is losing work since the last local copy.
2. **PostgreSQL migration date** — the agency owner with whoever holds the data. Cost is a
   migration project and a maintenance window; the alternative is staying single-instance.
3. **Whether a partly refunded booking needs its own status** — the agency owner (a labelling
   decision; the data already exists).
4. **Which integrations to buy** (WhatsApp Business, GDS, OCR, a payment gateway) — the agency
   owner. Each needs vendor accounts, credentials and a decision about who answers when it fails.
5. **Monitoring and alerting** beyond the health endpoint — the agency/IT owner. Nothing here
   pages anyone today; the minimum useful version is an external check on `/api/health` (§5).

---

## 11. Incident checklist — in order

Work down the list. Do not skip to the fix.

1. **Is it just you?** Another staff member, another browser, incognito. If it is one person, it is
   a session or a device — send them to sign in again.
2. **Check the app is up.**
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health
   ```
   `200` → the app and database are fine; the problem is likely the proxy, the network or the
   browser. `503` → the database, go to step 3. No answer at all → the process, go to step 4.
3. **Database unreachable (`503`).** Check the disk is not full and the file exists and is writable:
   ```bash
   df -h /srv
   ls -l "$(grep -m1 DATABASE_URL /srv/travel-os/.env | cut -d= -f2-)"
   ```
   A full disk is the most common cause. Free space, then restart. If the file is damaged, stop
   accepting writes and go to §8.3 with your most recent backup — and say so to the agency before
   restoring, because a restore rolls data back.
4. **Process not running.** Read the last thing it said, then restart:
   ```bash
   sudo journalctl -u travel-os -n 100 --no-pager
   sudo systemctl restart travel-os
   ```
   A refusal to start that names a variable is the boot-time configuration check doing its job —
   fix the variable, do not work around it.
5. **Something failed for a user (`500`).** Get the correlation id from the error and find the
   matching log line (§6). Fix the cause; do not restart to make the symptom go away.
6. **Suspect a leaked session or device.** Rotate `JWT_SECRET` (§2.2) and restart. Everyone signs
   in again; no data is lost.
7. **Suspect data loss or a bad upgrade.** Stop the service, take a backup of the current state
   **before** touching anything, then restore per §7.2 and verify per §8.3.
8. **Afterwards.** Write down what happened, what you changed and what you would check first next
   time, and note whether the backup cadence and the drill would have covered it. If they would
   not, that is the next change to make.
