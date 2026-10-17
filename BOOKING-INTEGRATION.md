# Booking platform receiver



The booking integration is included in the CRM source. Deployment and configuration are separate; real TripJack/Razorpay UAT remains pending.



Apply Prisma migrations and regenerate the client before enabling the receiver:



```text

npm run db:generate

npm run db:migrate

```



Server environment:



```text

BOOKING_PLATFORM_SIGNING_KEYS={"development-key":"same-secret-as-CRM_SIGNING_KEY"}

BOOKING_PLATFORM_OWNER_ID=<existing active CRM staff ID>

BOOKING_PLATFORM_BRANCH_ID=<existing branch ID>

```



Sender URL: https://<crm-host>/api/integrations/booking-platform/events. Use HTTP only for a loopback development host. No actual secret values are stored in this guide.



The receiver verifies exact-body HMAC, key ID, event ID and a five-minute timestamp tolerance. Event receipts and business updates are transactional. Duplicate events are no-ops; older revisions cannot replace newer records. Sender snapshots include the complete payment/refund state so skipped intermediate delivery does not lose financial records.



Customer identity uses explicit platform IDs, not phone/email merging. Flights and hotels appear under Online bookings, link to customers, and update native bookings, receipts, refunds, invoices and the append-only reporting journal. Corporate company records map to native corporate customers. Passport/PAN fields are deliberately not duplicated into CRM events.



Imported bookings must be operated from the booking platform. CRM manual booking/status/payment/refund endpoints are not a replacement for supplier or gateway operations. Review all remaining administrative editing surfaces before rollout.



Cancellation journal entries retain disclosed cancellation charges instead of wiping out the complete sale. Paid refunds become native PAID refund records. Only captured payments become customer receipts.



Verify this extension on a CRM test database before production migration. The existing production database was not accessed.



## 15 October additions



Apply the platform-status migration as well as the initial integration migration. Snapshots can include confirmation PNRs/tickets/hotel names and payment method. The online booking list displays the source platform status. Platform financial, ticketing, deadline, payment-term and reissue changes remain controlled by the booking platform rather than CRM manual endpoints.



## Flight services and partial cancellations

Optional snapshots include serviceKind, parentBookingId, replacementBookings and per-ticket VOID/REISSUED statuses when route mapping is unambiguous. Flight extras and reissue have separate linked platform records and invoices. Confirmed cancellation refund offers reduce the charge even while remaining travel stays active. Refund payment journals are separate. Original ticket confirmation automation is suppressed after cancellation offers or a confirmed replacement, preventing stale ticket notifications.
