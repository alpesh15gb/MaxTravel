# Build and update the CRM

Canonical Windows checkout: `D:\Travel CRM\travel-os`. Repository: https://github.com/alpesh15gb/MaxTravel . The booking website/mobile sources are separate projects and are not included in this CRM repository.

## What this update changes

Adds the signed booking-platform receiver, Online bookings page, customer/booking identity links, captured receipts, refunds, invoice/journal adjustments, hotel fields and source booking status. Imported supplier/payment mutations remain controlled by the booking platform. Two additive Prisma migrations are included; no existing database, uploads or credentials are bundled.

## Build locally without changing the database

Use Node.js 22 and run inside the project folder:

```powershell
Set-Location 'D:\Travel CRM\travel-os'
git pull --ff-only origin main
npm ci
npm run db:generate
npm run typecheck
npm run lint
npm run build
```

These commands do not apply migrations. Stop a locally running CRM before changing its dependencies/generated client; the new client expects the new columns after restart. Keep your existing `.env` and `JWT_SECRET`. Do not replace them with `.env.example`, and do not run database reset or seed commands against existing business data.

Before restarting against your existing database, take a database/uploads backup and run:

```powershell
npm run backup -- --out 'D:\CRM Backups'
npm run db:migrate
npm run db:status
npm run start -- --hostname 127.0.0.1 --port 3107
```

`DATABASE_URL` and `UPLOAD_ROOT` must refer to the actual CRM database and private uploads. If your process manager injects environment values, use that same environment for backup and migration commands. Existing development port 3000 may be occupied by the booking website; CRM example port is 3107. Set `APP_ORIGIN` to the origin staff actually use.

## Existing Ubuntu VPS with compose.vps.yaml

Run in the existing VPS CRM checkout with its existing `.env`, compose project and database volume. Do not use `docker compose down -v`; do not create a new compose project name or volume expecting it to contain your existing data.

```bash
git status --short
git pull --ff-only origin main
docker compose -f compose.vps.yaml build app
docker compose -f compose.vps.yaml run --rm backup
# Check that the backup command succeeds and save the backup folder securely.
docker compose -f compose.vps.yaml up -d --no-deps app
docker compose -f compose.vps.yaml logs --tail=100 app
docker compose -f compose.vps.yaml exec app npx prisma migrate status
curl -fsS http://127.0.0.1:3107/api/health
```

The container entrypoint applies committed migrations before starting Next.js. Startup is the database-changing step; building the image is not. The backup service uses the same SQLite volume and private uploads. If you use additional compose overrides (for example Evolution), retain the exact same `-f` files and `-p` project options for every build, backup and startup command. Resolve local modifications before pulling; never use a hard reset to erase them.

After schema migration, rolling back code alone may not be sufficient. Preserve the backup and test a compatible rollback/restore in a separate environment first.

## Enable booking synchronization after testing

Configure these private CRM environment settings:

```dotenv
BOOKING_PLATFORM_SIGNING_KEYS='{"booking-v1":"YOUR_RANDOM_SHARED_SECRET_AT_LEAST_32_CHARACTERS"}'
BOOKING_PLATFORM_OWNER_ID=EXISTING_ACTIVE_CRM_STAFF_ID
BOOKING_PLATFORM_BRANCH_ID=EXISTING_CRM_BRANCH_ID
```

Generate a separate random shared secret locally, store it privately and use the same value on the booking backend. Do not reuse the CRM login JWT secret or paste credentials into GitHub/chat. The supplied compose files pass these optional variables to the app container; recreate the app after changing its environment.

Set the corresponding booking-platform environment:

```dotenv
CRM_EVENTS_URL=https://YOUR_CRM_DOMAIN/api/integrations/booking-platform/events
CRM_KEY_ID=booking-v1
CRM_SIGNING_KEY=THE_SAME_PRIVATE_SHARED_SECRET
```

Use the existing active staff and branch IDs from the actual target CRM, not test database fixture IDs. Keep both machines' clocks synchronized. Enable the booking backend's CRM worker using its deployment configuration. The receiver does not call TripJack directly and does not need a TripJack API key.

Verify an owned test booking reaches Online bookings, and check its receipt, invoice, cancellation/refund balance and duplicate-event behaviour before production enablement. WhatsApp continues to require existing Evolution configuration, automation settings and customer consent.

## Automated receiver check (isolated database only)

This integration test creates synthetic records. Never point it at the business database.

```powershell
$env:DATABASE_URL='file:./integration-test.db'
npm run db:migrate
node --import ./scripts/standalone-server.mjs --import tsx tests/platform-receiver.mts
Remove-Item Env:DATABASE_URL
```

The test refuses any URL without `integration-test.db`. It checks forged signatures, event/payment deduplication, stale revisions, hotel confirmation and partial/full refund journal reconciliation. Real provider/device acceptance and production deployment remain separate.


## Official WhatsApp Cloud API

See META-WHATSAPP-SETUP.md for account setup, template mappings and the compose.meta.yaml cutover. This update adds an additive WhatsAppMessage.cloudTemplate column. Keep the old Evolution worker stopped during cutover; configuration never silently falls back to it.
