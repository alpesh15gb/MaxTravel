# CRM completion update — 18 October 2026

This update implements the operational/security workflows below. It is not a declaration that every previously discussed expansion or production acceptance gate is complete.

## Implemented

- Revocable database-backed staff sessions, account-security screen, authenticator enrolment with encrypted secrets, replay protection, ten single-use recovery codes, optional enforced enrolment and durable login throttling.
- Operator-issued one-use password recovery links, expiring after 15 minutes. Password recovery preserves MFA requirements and revokes existing sessions. This is an administrator-assisted recovery flow, not an SMTP self-service email service.
- AES-256-GCM protection for passport numbers, bank account fields and extracted document JSON when a private encryption key is configured. Exact passport lookup uses a keyed hash. Existing plaintext rows require an explicit backfill; document files and historical backups are not encrypted by this field-level feature.
- Lead stages, source, budget, notes and follow-up deadlines; immutable quotation versions with line costs/prices, private customer proposal links, recorded acceptance, withdrawal and idempotent conversion into an enquiry booking. Quote acceptance does not reserve inventory or move money.
- Incoming Meta PDF/JPEG/PNG references in signed webhooks, scoped authenticated retrieval, provider hash/size/content validation, private download and filing as sensitive, unverified customer documents. Unmatched messages must be assigned first. Media retrieval currently permits the verified Meta download host `lookaside.fbsbx.com`; redirects and arbitrary hosts are rejected.
- ClamAV INSTREAM integration for customer portal uploads, incoming media and stored outgoing/automatic PDFs. `compose.security.yaml` requires scanning and blocks ingestion on an unavailable scanner. Without a configured scanner and required mode, the legacy unscanned path remains available; enabling the deployment overlay is part of rollout.
- Separate checklist assignment for each applicant in a pre-submission visa case. Received/reviewed requirements cannot be replaced; empty placeholders can be replaced with an audited change.
- Whole-receipt customer advance allocation to same-customer open invoices, manual bookings or visa cases. No new payment is collected; online booking balances remain provider-controlled.
- Configurable operational or accountant-approved tax invoices. Administrators set issuer details, document title/footer, tax profiles, labels and percentage rates. Tax-inclusive totals are calculated in integer paise and a frozen seller, buyer, service, place-of-supply and tax breakdown is stored on each invoice. Tax invoices are currently limited to standalone invoices; linked booking/visa billing keeps its existing operational price flow.
- Full credit notes for fully unpaid standalone invoices. Issuance is permission-gated and audited, preserves the original invoice, reverses the receivable in the finance journal, removes the invoice from collection/reminder flows, and provides a printable credit note. This does not initiate a cash refund.
- CSV customer import with validation, preview, contact duplicate detection and stable request IDs. Imported records do not inherit WhatsApp consent.
- Administrator consolidation of duplicate profiles without booking, visa, financial or platform identity history. The source remains inactive; old upload links are revoked and messaging consent requires review. Historical financial identities are deliberately blocked from this consolidation operation.
- Root CRM CI covers the new tests. Production images include native Node maintenance commands, without requiring development TypeScript tooling.

## Rollout

1. Back up the existing CRM database and upload volume using its existing deployment project. Keep the prior backup and record the current release. Do not migrate the actual database merely to build an image.
2. Generate and securely retain a random 32-byte hexadecimal `CRM_DATA_ENCRYPTION_KEY`. Keep it stable, server-side and recoverable with protected backups. Losing it prevents reading encrypted fields and enrolled authenticator secrets. Do not rotate it as if it were a disposable session key.
3. Deploy the additive migrations and regenerated Prisma client using the existing build/run guide. This update adds staff-security, sales, incoming-media, sensitive-lookup, durable-auth-limit, customer-consolidation, configurable invoice tax and credit-note migrations. Existing browser sessions must sign in again. Existing invoices retain the operational document kind; no old invoice is recalculated or rewritten.
4. In a maintenance window with app and workers stopped, run the new image's native command against the existing database/environment:

   ```sh
   node scripts/encrypt-sensitive.mjs --apply
   ```

   For Compose, use the same project name, volumes and override files as the existing deployment, for example `docker compose -f compose.vps.yaml run --rm app node scripts/encrypt-sensitive.mjs --apply`. Do not create another empty deployment volume. The command validates already encrypted values and supports reruns; back up first. Restart the app/workers after it succeeds.
5. Ask staff to enrol from Account menu → Account security and save recovery codes privately. Then set `CRM_REQUIRE_MFA=true` and restart. The API and workspace direct unenrolled staff to security setup. Recovery remains available while business access is restricted.
6. Add `-f compose.security.yaml` to the existing Compose invocation for required upload scanning. Keep the ClamAV socket private and verify signature updates/scanner health before accepting uploads. Do not expose port 3310 publicly. Allow sufficient VPS resources for the scanner.
7. Keep the existing Meta environment, signed booking integration, worker secrets and approved utility templates. Verify real inbound/outbound media, consent and cancellation behaviour during provider acceptance.

For a forgotten staff password, an authorised server operator can run:

```sh
node scripts/staff-recovery.mjs staff@example.com
```

The command prints a private bearer recovery URL. Deliver it directly to the verified staff member; do not put it in shared logs, tickets or chat. It does not disable MFA. Local CLI use may load the existing `.env`; containers use their injected environment.

## Verified locally in an isolated checkout

- TypeScript, ESLint and Next production compilation.
- Existing HTTP regression suite: 198 checks.
- Staff/sales HTTP suite: MFA/recovery replay protection, session revocation, forced MFA API/page restrictions, branch isolation, quote acceptance and duplicate conversion, encryption at rest and exact passport lookup, advance allocation, applicant requirement protection, import replay and consolidation safety.
- RFC TOTP vectors; sensitive-field encryption; CSV quoting/validation; scanner clean/rejected/error outcomes; mocked authenticated media download, host restrictions and integrity checks.
- Native production maintenance commands against a fresh migrated test database: encryption backfill/retry and hashed, expiring recovery tokens.
- Existing signed booking receiver/accounting, Meta policies, private PDF and automatic booking-document deduplication/stale-document checks.
- The configurable invoice and credit-note implementation was added after those regression suites ran. TypeScript and lint checks pass for the updated code; finance workflow regression and browser acceptance remain pending.

No actual CRM database was migrated, no real message was sent, and no TripJack/Razorpay operation or VPS deployment was performed. Browser/device visual acceptance and a real ClamAV/provider deployment remain pending.

## Still outstanding

- Tax applicability, legal wording, tax rates, service classification and place-of-supply decisions remain accountant-owned configuration. The CRM applies configured arithmetic and stores the exact settings used; it does not decide the legal treatment. Tax invoices are currently standalone only. Full credit notes are supported only for fully unpaid standalone invoices; partial/paid corrections must use an accountant-approved refund and adjustment process until that workflow is extended.
- Splitting one customer advance across several targets; the delivered allocation workflow uses an entire receipt.
- Consolidating profiles with financial/booking history through an audited finance migration.
- Broader commission accounting, multi-currency/FX, package/group itinerary management and a general client portal remain expansion work beyond the current flight/hotel booking and CRM operations flows. Proposal acceptance and the existing document-upload portal are available.
- OCR remains an unconfigured extension point. Document retention/deletion periods and recovery/restore acceptance still need an operator policy and deployment validation.

Primary implementation references: [Meta's media API collection](https://www.postman.com/meta/whatsapp-business-platform/folder/13382743-ecb27be5-4d27-4763-bbee-6a8002c04bf3/media), [ClamAV scanning documentation](https://docs.clamav.net/manual/Usage/Scanning.html).
