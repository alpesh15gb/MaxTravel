# Single-office launch

Target: one office, one application server, up to 20 staff. Use local SSD storage,
one application instance and durable backups. Staff count is not a capacity guarantee:
run the simultaneous-use checks below on the chosen server. The app records receipts;
it does not process card payments or send WhatsApp messages through a provider.

## Prepare

Use a supported Docker Engine with Compose on the host. Allow at least 2 CPU cores,
4 GB RAM and storage sized for uploaded documents plus backups as an initial allocation.
Copy `.env.example` to `.env`, generate a random JWT_SECRET and keep it private.
Do not copy the development database into a new installation unintentionally.

`compose.yaml` keeps the database and private documents together in the `agency-data`
Docker volume. It publishes the application only on loopback, until the HTTPS proxy is enabled.

```sh
docker compose up -d --build app
docker compose ps
```

Open http://localhost:3000/setup **on the server** and create the owner. For a remote Linux
server, tunnel port 3000 using SSH before opening setup. Do this before enabling public access.
Create staff accounts, check their roles and verify a real customer → visa/booking → invoice
→ receipt workflow. No demo transactions are installed.

## Enable HTTPS

Point a domain at the server and configure these `.env` values:

```dotenv
CRM_DOMAIN=crm.your-agency.example
APP_ORIGIN=https://crm.your-agency.example
TRUST_PROXY=1
```

Replace the example domain. Allow inbound TCP 80/443 and keep port 3000 private.
`TRUST_PROXY=1` is appropriate only when the trusted proxy controls forwarded addresses.

```sh
docker compose --profile public up -d
```

Caddy obtains the TLS certificate. Check HTTPS login and
`https://<your-domain>/api/health` (must return 200). Check owner and restricted staff
accounts independently. Keep the host patched and restrict SSH/admin access.

## Back up and prove recovery

Create `backups` on the host with write access for container uid 1000 (on Linux,
`sudo install -d -o 1000 -g 1000 -m 700 backups`). Then:

```sh
docker compose --profile maintenance run --rm backup
```

The runtime image includes both backup and restore tools. Each backup contains a SQLite
snapshot, private uploads and a verification manifest. The local directory is sensitive:
encrypt and copy backups to a separate machine or managed backup service. Keep at least
14 daily backups as an initial policy; choose retention and storage with the agency owner.
The backup copies the document tree separately from the database snapshot: use a quiet
window without document changes for a consistent database-and-files recovery point.

On Linux, schedule the backup command from the installation directory with cron, for example:

```cron
0 2 * * * cd /srv/travel-os && docker compose --profile maintenance run --rm backup >> /var/log/travel-os-backup.log 2>&1
```

On Windows, use Task Scheduler to run the same command daily with the installation directory
as “Start in”. Monitor job failures; the repository does not install a host schedule for you.
Run `node scripts/restore.mjs --in <backup> --out <empty-drill-directory>` in an environment
with the project dependencies, and verify row counts and checksums before launch. See
[operations.md](operations.md) for recovery and baseline migration instructions.
Never use `docker compose down -v` on the production installation: it removes data volumes.

## Acceptance on the actual server

- Sign in as owner, accounts and an assigned staff member. Verify each can access only intended records.
- With several staff simultaneously, create and edit customers, cases, bookings and tasks;
  record separate receipts; verify totals and reference numbers. Increase to expected peak use.
- Check desktop and staff phones, document upload/download, expired upload links and logout.
- Reconcile Reports with the money desk and dashboard. Report dates use India time and INR.
- Restart the app and host; verify records and uploaded files persist.
- Restore a backup to an isolated installation and check documents open.
- Configure an external `/api/health` monitor and alerts for failed backups, low disk and downtime.

Do not run multiple app replicas or store SQLite on an SMB/NFS share. The rate limiter is
in-process. Money columns remain SQLite Float with paise arithmetic. A future multi-server
or more demanding accounting deployment requires PostgreSQL/Decimal migration and testing.
Deployment, certificates, off-site backups, alert delivery and peak concurrency remain
unverified until completed on the agency's actual host.
