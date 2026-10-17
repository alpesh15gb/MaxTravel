# Two-way booking operations and automatic PDFs

The booking platform owns supplier and gateway operations. CRM staff can now request these operations from Online bookings without manually changing imported booking/payment/refund records. Signed booking events continue to reconcile the CRM's native accounting records.

## Operations available from CRM

- Read current booking status and cancellation requests; financial details require finance access on both applications.
- Request full or selected-flight/passenger cancellation review. The booking remains active until the supplier confirms cancellation.
- Check supplier cancellation charges, mark a request under review, and publish an offer.
- Submit a cancellation only after the customer accepts the current offer in the booking website/app. CRM cannot manufacture customer acceptance.
- Request, approve and execute refunds using the booking platform's amount limits, captured-payment checks, accepted cancellation terms and second-person approval rules.
- Recheck an uncertain supplier booking without resubmitting Book, and request a fresh signed CRM snapshot.

Reissue searches, flight extras selection and customer checkout remain in the booking website/app because they require fare selection and payment. Manual CRM accounting edits remain blocked for imported records.

## Private configuration

Deploy matching versions of both applications. Apply booking SQL migration `014-crm-commands`; regenerate the CRM Prisma client and apply `20261018100000_platform_commands`. Back up the existing CRM database and uploads before deployment. No production database was migrated by this coding task.

Booking application environment:

```dotenv
CRM_COMMAND_KEYS={"crm-commands-1":"SEPARATE_RANDOM_SECRET_AT_LEAST_32_CHARACTERS"}
CRM_STAFF_ACTORS={"CRM_STAFF_ID":"BOOKING_ADMIN_USER_ID"}
```

CRM environment:

```dotenv
BOOKING_PLATFORM_API_URL=https://BOOKING_DOMAIN/api/integrations/crm/commands
BOOKING_PLATFORM_COMMAND_KEY_ID=crm-commands-1
BOOKING_PLATFORM_COMMAND_KEY=THE_SAME_DIRECTION_SPECIFIC_SECRET
```

These are placeholders, not credentials. Use a different secret from `CRM_SIGNING_KEY` / `BOOKING_PLATFORM_SIGNING_KEYS`. Keep all values server-side. The supplied CRM Compose files pass the new variables to the app.

Explicitly map each authorised CRM staff member to their own existing booking administrator account. That booking account must have verified email, authenticator enabled and active, appropriate `admin_grants`. Do not map different refund reviewers to one shared account: the booking platform evaluates second-person approval using the mapped booking user ID. This is explicit service delegation from an authenticated CRM session; it does not create a shared login or perform a fresh authenticator challenge per command.

CRM permissions are checked first against the current staff session and the scoped native booking. The booking platform checks the mapped administrator and operation permission independently. Target cancellation/refund/payment IDs must belong to the specified booking. Financial status requires `payment:view` in CRM and `finance:read` in the booking platform. Ordinary operational status does not expose payment/refund totals.

## Retries and unknown outcomes

Commands have an immutable UUID and exact-body HMAC with five-minute timestamp tolerance. Both apps retain an audit/command record. The booking dispatcher directly reuses the existing operation handlers through server-local permission context; arbitrary HTTP headers cannot activate that context. It never generates or impersonates a browser session.

An identical completed command returns its recorded response. Reusing its UUID for different content is rejected. After a lost response, use **Retry the original command safely** in the CRM booking panel. Known committed cancellation requests/offers and refund records can be recovered without repeating their side effects. Unknown financial commands are not automatically resubmitted, and new mutations are blocked while an earlier CRM command remains unresolved. If an outcome cannot be proven from business records, use the booking operations desk/provider reconciliation and retain the original command ID for support; do not clear database records or generate a new financial request blindly.

## Automatic confirmation PDFs

The existing booking CRM worker generates a stable confirmation PDF for confirmed flights/hotels and flight service receipts, then includes its filename, SHA-256 and base64 bytes in the signed event. The worker verifies the booking revision before freezing the event. The generated PDF transport ceiling is 512 KiB; event transport remains limited to 1 MiB. Errors remain in the existing monitored outbox retry flow.

CRM verifies the signature, PDF format, size and hash, then stores it privately under the existing uploads volume. The native booking/customer association and attachment/message deduplication are transactional. Current PDFs can be downloaded from Online bookings. A cancelled/superseded booking does not automatically send an old confirmation.

To enable automatic WhatsApp PDF sending:

1. Configure Meta Cloud API as described in META-WHATSAPP-SETUP.md.
2. Obtain approval for a **UTILITY template with a DOCUMENT header**.
3. Add a `BOOKING_DOCUMENT` entry to `WA_CLOUD_TEMPLATES`, for example parameters `["customer","reference"]` in the approved body's positional order.
4. Enable **Send confirmed booking PDF automatically** in WhatsApp automation settings before test bookings are confirmed.
5. Record the customer's actual WhatsApp permission. Missing consent, STOP, inactive accounts and missing template approval prevent sending.

The worker rechecks booking eligibility before dispatch. A newer cancellation or replacement suppresses an unsent automatic document. Unknown sends retain the existing no-resubmission protection. Header/button variants other than the supported document header remain unsupported. No incoming-media download is added by this feature.

The PDF is a booking confirmation/service receipt, not a GST tax invoice or a substitute for airline-issued ticket numbers. Ticket numbers/PNRs appear only when returned by the supplier.

## Verification and acceptance

Local simulated checks cover signed commands, mapped/revoked permissions, duplicate/colliding IDs, scoped targets, cancellation review/offer acceptance guards, lost-response recovery, generated-PDF stability, signed PDF import, duplicate message prevention and stale-document suppression. Real TripJack/Razorpay, deployed app-to-CRM and Meta messaging tests remain pending. The local preview was not replaced; previous access/approval blocks remain in effect.

Booking checks: `npm run test:crm-commands`, `npm run test:checkout`, existing cancellation/refund tests, lint/type checks, build and worker bundling. CRM checks use the isolated test database and `tests/platform-documents.mts`, `tests/platform-receiver.mts`, `tests/meta-cloud.mts` and `tests/meta-pdf.mts`.
