# Official Meta WhatsApp Cloud API

This replaces automatic WhatsApp Web/Evolution sending with direct Meta Cloud API. It reduces reliance on an unofficial connection; it does not guarantee that Meta will never restrict an account. Customer permission, approved templates, account quality and messaging policies still apply.

Official references checked 17 October 2026:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/overview
- https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api
- https://whatsappbusiness.com/policy/
- https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/

## What is implemented

- Direct authenticated Graph API sending; fixed official host and explicit configured API version, with no automatic Evolution fallback.
- Signed Meta webhook verification and account/phone ID isolation, duplicate inbound protection, received/delivered/read/failed statuses and early-receipt handling.
- Free-text staff replies only within 24 hours of a verified inbound Meta message for the current customer number. Manual logs and old Evolution events cannot open this window.
- Customer consent checks for all Cloud outbound sends. STOP/unsubscribe cancels pending messages and records a number-level opt-out, including ambiguous/unmatched customers. An explicit staff-recorded new opt-in is required to clear it.
- Automated updates use mapped, currently APPROVED UTILITY templates. No arbitrary full-body template variable is supported. Document-header utility templates are supported for PDF delivery. Other header formats, buttons, authentication and marketing templates are unsupported by this adapter.
- Staff select a mapped utility template, enter specific business values, preview current approved wording and accept that wording before queueing. Approval and template parameters are rechecked before dispatch.
- Immutable queued template parameter values; stale reminders and withdrawn consent cancel unsent messages. Configuration problems pause/block messages rather than falling back to WhatsApp Web.
- An uncertain send is never automatically repeated. Signed Meta status callbacks can recover its provider ID using the echoed opaque message identifier. If no receipt arrives, staff must reconcile it with Meta; do not create a new send blindly.
- Staff can upload a customer-specific PDF (up to 5 MB), download/review and confirm it, then send within the reply window or through an approved document-header utility template. Private immutable file references are stored with the message; bytes are uploaded directly to Meta, never exposed through a public URL. Consent, customer number, file hash and template approval are checked before delivery.
- Media inbound messages remain notices; automatic incoming media download is not implemented. No Meta account/number registration, real message, template submission or provider billing action has been performed.

## Meta account setup (you perform this in your account)

1. Create/use your own Meta business portfolio and developer app with WhatsApp enabled. Set the business profile and complete phone/business verification as Meta requires.
2. Confirm the current business number's migration or coexistence eligibility before changing its registration. Do not delete your WhatsApp account or assume the Business App and Cloud API will coexist automatically. Test with Meta's test number first.
3. Obtain the WABA ID and phone number ID. Create a suitable system-user access token with whatsapp_business_messaging and whatsapp_business_management access to your own assets. Keep tokens, app secret and verification token private.
4. Use an API version currently supported in Meta's setup/docs; it is an explicit environment setting, not a hardcoded version guessed by the app.
5. In Meta, configure the callback URL as `https://YOUR_CRM_DOMAIN/api/whatsapp/meta`, use the private verification token below and subscribe the app/WABA to messages. The POST signature uses the Meta app secret, not the verification token or old Evolution bearer secret.
6. Create purpose-specific utility templates, obtain Meta approval, then configure their names/languages and ordered fields. Review any Meta category changes or rejected/paused templates before enabling automation.

## Private environment configuration

Add to the existing VPS `.env`; preserve the CRM JWT secret, database and upload configuration:

```dotenv
WA_PROVIDER=meta
WA_CLOUD_ACCESS_TOKEN=YOUR_PRIVATE_SYSTEM_USER_TOKEN
WA_CLOUD_PHONE_NUMBER_ID=YOUR_NUMERIC_PHONE_ID
WA_CLOUD_WABA_ID=YOUR_NUMERIC_WABA_ID
WA_CLOUD_GRAPH_VERSION=SUPPORTED_VERSION_FROM_META
WA_CLOUD_APP_SECRET=YOUR_META_APP_SECRET
WA_CLOUD_VERIFY_TOKEN=YOUR_RANDOM_VERIFY_TOKEN_AT_LEAST_32_CHARACTERS
WA_WORKER_SECRET=YOUR_SEPARATE_RANDOM_WORKER_SECRET_AT_LEAST_32_CHARACTERS
WA_CLOUD_TEMPLATES='{"PAYMENT_RECEIVED":{"name":"YOUR_APPROVED_PAYMENT_TEMPLATE","language":"en","parameters":["customer","receipt","amount","reference","balance"]}}'
```

The Graph version must have the `vNN.0` format with a real supported number. Template language must match Meta, such as en or en_US. Generate separate random verification/worker secrets locally; do not paste credentials into chat or GitHub. No Meta secrets are sent to the browser or stored in message records.

Store CRM customer numbers with an explicit + and country code. The signed India-based booking-platform receiver converts its known 10-digit Indian contact format to +91; manual CRM numbers are never assigned a country implicitly.

## Automation template fields

Every rule supplies `customer` and `agency`, plus:

| Rule | Available fields |
| --- | --- |
| BOOKING_CREATED / TICKET_CONFIRMED | reference, pnr, sector, date, tickets |
| HOTEL_CONFIRMED | reference, hotel, checkIn, checkOut, supplierReference |
| PAYMENT_RECEIVED | amount, mode, reference, receipt, date, balance, balanceReference |
| STATUS_UPDATE | reference, stage |
| DOC_REQUEST | reference, docs, uploadLink, uploadExpiry |
| APPOINTMENT_REMINDER | reference, date |
| PNR_EXPIRY | reference, pnr, deadline |
| PAYMENT_REMINDER | reference, outstanding |

Each `parameters` array must follow the approved template's positional variables {{1}}, {{2}}, etc. For example the payment mapping above requires the approved body to use customer, receipt, amount, reference and balance in that order. Values must be complete single-line strings up to 1024 characters. Long document lists require a concise approved message pointing to the private upload link. CRM quick replies and the local payment wording editor do not create, modify or approve Meta templates.

Manual template mappings may use other uppercase keys, for example CUSTOMER_FOLLOW_UP, with specific fields entered by staff. Only templates which Meta currently classifies as approved utility are sent. Do not use these to disguise marketing.

## Sending tickets, vouchers and receipts as PDFs

1. In the WhatsApp desk choose the correct customer and record valid consent.
2. Attach the final ticket, hotel voucher or receipt PDF. Only PDF files up to 5 MB are supported. Download the private file to review it, then confirm it belongs to the selected customer.
3. Within 24 hours of a verified inbound message, use a caption of up to 1024 characters (or leave it blank for the filename).
4. Outside this window, select a mapped APPROVED UTILITY template with a DOCUMENT header. Enter its body fields and preview the approved text after selecting the PDF. A body-only template cannot carry a PDF; a document-header template requires one.
5. Send once and watch delivery status. An uncertain result must be reconciled before any new send.

Example additional mapping (merge into the same `WA_CLOUD_TEMPLATES` JSON):

```json
{"TRAVEL_DOCUMENT":{"name":"travel_document_ready","language":"en","parameters":["customer","reference"]}}
```

In Meta create the matching utility template with header type Document and an approved body such as `Hello {{1}}, your travel document for {{2}} is attached.` Templates must be approved in your own WABA. Attaching a PDF does not create or submit templates.

PDFs are stored under `UPLOAD_ROOT/whatsapp-pdf`, using random server-generated filenames and private filesystem permissions. Keep the existing uploads volume mounted and include it in backups. Authenticated downloads require access to the customer and are audited. The file is checked for PDF signature, EOF, size and SHA-256 integrity; this is not malware scanning. Only send documents your agency trusts. Removing a file from the composer clears the selection; retained draft uploads remain private on disk. Staff can send selected PDFs. The separate BOOKING_DOCUMENT automation also supports generated booking confirmation PDFs; see TWO-WAY-BOOKING-INTEGRATION.md. Incoming media remains a notice.

## VPS cutover after test-number acceptance

Keep the existing compose project name/database volume. First stop the OLD Evolution worker using the exact old files/project options; for the supplied layout its service name is `worker`:

```bash
# Existing Evolution deployment only; retain your original -p project option if used.
docker compose -f compose.vps.yaml -f compose.evolution.yaml stop worker
```

Do not include compose.evolution.yaml in the new Cloud configuration. Do not use `down -v` or remove the database volume. Keep previous messaging history; old Evolution queue records are not automatically converted/resubmitted as Cloud purchases/messages.

```bash
git pull --ff-only origin main
docker compose -f compose.vps.yaml -f compose.meta.yaml build app
docker compose -f compose.vps.yaml -f compose.meta.yaml run --rm backup
# Verify backup success before recreating the app; startup applies the additive migration.
docker compose -f compose.vps.yaml -f compose.meta.yaml up -d --no-deps app
# Check app health and configure/verify the Meta webhook before starting outbound processing.
docker compose -f compose.vps.yaml -f compose.meta.yaml ps
docker compose -f compose.vps.yaml -f compose.meta.yaml up -d whatsapp-worker
docker compose -f compose.vps.yaml -f compose.meta.yaml logs --tail=100 app whatsapp-worker
```

Retain additional non-Evolution proxy overrides and the original project-name options where applicable. The new worker runs the existing authenticated CRM queue endpoint; it has only the worker secret, not a Meta token or database URL. The image remains max-travel-crm:local, matching compose.vps.yaml.

Before enabling live automation, record real customer permission and verify one inbound message, a reply within the window, a blocked expired-window free-text send, a utility template, delivery/read callbacks and STOP. Confirm billing, account quality and limits in Meta. There is no automatic historical campaign replay and no marketing broadcast feature.

## Local verification

Use only the isolated test database:

```powershell
$env:DATABASE_URL='file:./integration-test.db'
npm run db:generate
npm run db:migrate
node --import ./scripts/standalone-server.mjs --import tsx tests/meta-cloud.mts
node --import ./scripts/standalone-server.mjs --import tsx tests/meta-pdf.mts
Remove-Item Env:DATABASE_URL
```

The test intercepts provider requests; it does not send real messages. It checks signature/challenge verification, account/phone isolation, inbound deduplication, reply-window gating, utility approval/category, opt-out, monotonic receipts and recovery after a lost send response. Real Meta test-number acceptance remains required.

## Incoming messages show as unsupported

The signed webhook reads normal text from `messages[].text.body`, quick-reply and list titles, and supported document/image captions. A missing text body must never be presented as a document waiting in Incoming documents. Meta's [official webhook examples](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api) also include `type: "unsupported"` events with error codes and no readable content.

The WhatsApp desk now shows administrators a warning with the latest Meta error codes when the provider supplies an unavailable event. App logs contain a `[whatsapp:meta:inbound-unavailable]` entry with only the message type and numeric codes. These diagnostics exclude message text, phone numbers, message IDs, access tokens and raw payloads. Only the latest event summary for each configured business phone ID is retained; duplicate deliveries do not replace the summary or repeatedly log the notice.

If a fresh plain-text message also arrives without readable content, retain its Meta error code and check the number's Cloud API registration/migration/coexistence setup with Meta support. Changing CRM display text cannot retrieve content Meta did not supply. Ask the sender to send a new plain-text message. No automatic customer reply is sent by this diagnostic path.

If a later signed delivery of the same message ID contains readable text or a supported document/image, the CRM can replace its unavailable notice. Sender identity, original receipt time and unread count are preserved, STOP still withdraws consent, and an already readable message is never overwritten by a retry. Existing text that was never delivered cannot be reconstructed or silently backfilled.

Run the isolated, synthetic regression suite with `npm run test:meta-inbound`. It creates and removes its own temporary SQLite database and performs no real Meta requests. This change requires no new database migration.
