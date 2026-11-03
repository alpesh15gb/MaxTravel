# Deploying the CRM on its own

The CRM and the booking site are separate applications with separate releases. This guide
covers the CRM only. It never builds, stops or restarts the booking site; the two talk to each
other only through the signed events and the `BOOKING_PLATFORM_*` settings already in the CRM's
private env file.

| | CRM |
|---|---|
| Compose project | `max-travel-crm` (`compose.crm.yaml`) |
| Containers | `max-travel-crm-app-1`, `max-travel-crm-worker-1` |
| Port | `127.0.0.1:3107` |
| Data | external volume `max-travel-crm_agency-data` (never deleted by compose) |
| Private settings | `/opt/max-travel-crm-secrets/crm.env` (root only, 600) |
| Backups | `/opt/max-travel-crm-backups/crm` |
| Image tags | `max-travel-crm:release-<commit>-<timestamp>` |

## One-time setup (existing server)

```bash
cd /opt/max-travel-crm && git status --short   # must be clean, else stop and ask
git fetch origin main && git merge --ff-only origin/main
./deploy/crm-adopt.sh
```

`crm-adopt.sh` copies the running CRM's private settings into `crm.env` and prints variable
names only. It refuses to overwrite an existing file and stops if `JWT_SECRET`, `APP_ORIGIN`,
`DATABASE_URL` or `CRM_WORKER_SECRET` is missing.

## Every update

```bash
cd /opt/max-travel-crm && ./deploy/crm-deploy.sh
```

It fast-forwards the checkout, builds a new tagged image, backs up using the image that is
currently running, applies any new database migrations (the CRM env file turns off automatic
migration, so the script does it), swaps the app and worker, waits for the health check and rolls back by itself
if the new image is not healthy. It prints the previous image tag for a manual rollback:

```bash
./deploy/crm-deploy.sh --rollback max-travel-crm:<previous tag>
```

A rollback does not undo database migrations. If a release applied a migration and must be
undone, restore the backup the deploy just took (see `docs/operations.md`).

## Never

- `docker compose down -v` (it would delete data if the volume were not external).
- Running `compose.vps.yaml` for the CRM again on this server: its image name no longer exists.
- Editing the booking site from this checkout. Release it from its own repository.
