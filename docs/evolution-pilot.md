# Evolution pilot for Max Travel CRM

Target: the existing Evolution API 2.3.7 server, instance **`max travel`**, separate
from **`whatsapp-main`**. Never delete/recreate the Evolution container or change its
global webhook. This integration sends text and receives new text/media notices
from its activation onward. It does not import old WhatsApp history or download
attachments. Messages sent from the phone outside the CRM are not added to the CRM
outbox. Open WhatsApp to view media. Use sample data while the CRM is served over HTTP.

Implementation references are the provider's pinned 2.3.7 source:

- [Webhook configuration and headers](https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/integrations/event/webhook/webhook.controller.ts)
- [Text message request](https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/dto/sendMessage.dto.ts)
- [Incoming messages and receipts](https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts)

## Install on the existing VPS

First back up using the existing image, then pull. Stop if any command fails.

```bash
cd /opt/max-travel-crm
install -d -o 1000 -g 1000 -m 700 backups
docker compose -f compose.vps.yaml --profile maintenance run --rm backup
git status --short
git pull --ff-only origin main
bash deploy/setup-evolution.sh
```

The script prompts for the **instance API key** from the `max travel` card in the
Evolution Manager. Input is hidden. Do not use or share the global admin API key.
It stores the key and separate random worker/webhook secrets in the ignored `.env`,
creates the `max-travel-messaging` network, and attaches the running `evolution_api`
container to that additional network without restarting it. The CRM receives its
own network alias. Neither container exposes a new public port.

It builds the CRM, applies additive database migrations, starts its app and worker,
and configures only `max travel`'s webhook. If that instance already has an enabled
webhook for another app, it refuses to overwrite it. The prior configuration is
saved privately to `/data/evolution-webhook-before-crm.json`. Do not publish it.
Existing global Evolution hooks can still receive this instance's events; the
script does not change them. Review other apps' global-event handling if needed.

An enabled webhook is not proof of end-to-end delivery: complete the checks below.
If setup stops partway through, keep its output and diagnose; do not rerun it blindly.

## Future updates

The setup script adds `COMPOSE_FILE=compose.vps.yaml:compose.evolution.yaml` to `.env`.
**Use `docker compose` without `-f` after enabling Evolution**, so the provider
configuration and worker are retained. Explicitly using only `-f compose.vps.yaml`
would revert the app to manual mode.

```bash
cd /opt/max-travel-crm
docker compose --profile maintenance run --rm backup
git pull --ff-only origin main
docker compose up -d --build --wait --wait-timeout 180 app worker
docker compose ps
docker compose logs --tail=60 worker
curl -fsS http://127.0.0.1:3107/api/health
```

## First live test

1. Open WhatsApp desk as owner; confirm the connection indicator becomes connected.
2. Create a test customer with a separate test phone in full international format.
3. Send one short message. Check queued → sent → delivered/read as provider receipts
   arrive. Verify it reaches the intended phone once and identifies the staff sender.
4. Reply from the test phone; check the correct customer thread updates within 15 seconds.
5. Check unmatched replies under the admin controls. Groups, broadcasts and unresolved
   WhatsApp LID addresses are ignored; they are never treated as customer phone numbers.
6. Record the test customer's consent and enable one automatic rule. Move a test visa
   stage or create an appointment within 24 hours. Check that it sends once during
   09:00–20:00 India time. Disable the rule again if the demo is finished.
7. Reply STOP and verify customer automatic messaging consent is removed.
8. Verify `whatsapp-main` and its application still work.

## Delivery and automation behavior

All provider-bound messages are persisted before sending. Client request IDs prevent
duplicate CRM requests. The worker claims one batch at a time using a database lease,
pauses while disconnected, and backs off on an explicit HTTP 429 rejection. It never
automatically retries a timeout or 5xx after sending: those become **outcome unknown**,
because the provider may already have sent the message. Check WhatsApp before manually
resending. An interrupted send is treated the same way after restart.

Automatic rules start off and require a recorded customer opt-in. An incoming STOP,
UNSUBSCRIBE or CANCEL MESSAGES withdraws it. Rules cover visa stage changes, document
requests on entering a document stage, appointments and unticketed PNR deadlines within
24 hours, and one reminder per overdue invoice due date in the last 30 days. Scheduling
scans up to 200 candidates per rule per cycle; this pilot targets the single office.
Do not use it for bulk campaigns.

Queued automation is rechecked against customer consent, current dates, stages,
invoice balances, booking status and recipient phone. Obsolete reminders are cancelled.
Messages more than 48 hours old are cancelled. Automatic sends use quiet hours;
manual staff sends are not restricted by those hours. Old backlog is not imported.
Delivery/read receipts are monotonic; absence of a receipt never implies delivery.

Webhook requests require a separate bearer secret and the exact instance name. Retry
events are deduplicated. Unknown or ambiguous senders are stored for administrator
matching instead of being attached to an arbitrary customer. Provider payloads containing
API keys are not stored or logged by the CRM. Customer access scopes still apply.

## Recovery and limitations

If the Evolution container is recreated by its own deployment, attach the replacement
to `max-travel-messaging` with alias `evolution-crm-gateway` again. The CRM does not
modify Evolution's Compose files. Rotate the instance key in CRM `.env` when it changes,
then recreate only the CRM app. To pause sends, stop only `docker compose stop worker`.
To pause automatic messages while retaining manual sending, disable the admin rules.

The QR session is an unofficial pilot connection and can disconnect. The live instance,
actual delivery, and VPS network must be verified on the server; local tests use a fake
provider and cannot prove those external conditions. The official WhatsApp Business
Platform can replace the adapter later, but migration requires its own onboarding and
verification; it is not a configuration-only switch.

## Local verification (12 October 2026)

- Production Next.js build and TypeScript/ESLint checks passed.
- Existing CRM regression suite: 190 checks passed.
- Evolution integration: 22 checks against a local mock provider, including restricted
  staff access, instance isolation, idempotency, disconnects, receipt races, opt-out,
  rate-limit backoff, ambiguous sends, scheduling and desktop/phone inbox rendering.
- Accessibility gate: no findings; UI metrics: 21 routes at desktop and phone widths.
- Linux Docker image built and passed migration/setup/login, 20 concurrent reads,
  restart persistence, backup/restore, static branding and packaged worker checks.
- Migrating a copy of the previous regression database preserved customers and
  messages, left customer consent off and did not queue legacy messages.
- Compose override validated and setup shell script passed Bash syntax validation.

The real VPS, instance authentication and actual WhatsApp delivery still require the
first live test above. No live Evolution instance was modified during these tests.
