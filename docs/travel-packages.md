# Travel package catalogue

## Scope and rollout

This is a single-agency, enquiry-only marketing catalogue, not supplier inventory, a reservation,
payment flow or instant confirmation. Existing agency-wide `settings:manage` users can open
**Manage → Travel packages**. Branch/assigned access is rejected even when that permission is
present. No role permissions, credentials, integration signing keys or tenant boundaries change.
Each separately operated agency needs its own existing CRM deployment/database; do not point a
customer website at another agency's CRM.

Apply the additive `20261021220000_travel_packages` migration using the normal reviewed deployment
process, regenerate Prisma, and build. No existing table is rebuilt or data rewritten. The change
has only been migrated on isolated fixtures; deploying or migrating a live server is separate.

The booking website consumes its configured trusted CRM origin server-side. This CRM needs no
new secret or CORS policy. Coordinate the booking site's existing fixed server-side CRM origin
with its operator; do not accept a visitor-provided origin or expose a private signing secret.
The public routes intentionally expose approved marketing content without authentication.

## Staff flow

1. Create a package, choose a unique lowercase URL slug, and save a private draft.
2. Add destination, summary, duration, description, each day's itinerary, inclusions, exclusions,
   booking terms, cancellation conditions, date guidance and at least one public enquiry contact.
3. Choose **Price on request** or a **starting estimate** in major currency units, with explicit
   per-person/couple/group basis. For a displayed amount, specify pricing assumptions and validity.
   Specify whether taxes are included; group size, occupancy, supplements and child rates belong
   in the pricing notes, not implied inventory.
4. Optional images must be URLs the operator is entitled to use from the approved existing CDN
   policy: `images.unsplash.com/photo-*`, `pix8.agoda.net/hotelImages/`, or
   `i.travelapi.com/lodging/`. Unsplash permits only bounded `auto=format`, `fit=crop|max|clip`,
   `w/h=1..4000`, and `q=1..100` query parameters, without duplicates. Supplier CDN URLs cannot
   have queries. All reject credentials, ports, fragments, control characters, backslashes and
   encoded path traversal. Add descriptive alternative text. Private CRM document/signed URLs,
   arbitrary remote hosts and uploads are not supported. A neutral no-image fallback is expected.
5. Review the **text-only Preview** and publish checklist. Explicitly publish to make the approved
   version available to the customer website. Verify the customer page separately.
6. Saving edits to a published package changes its private draft only. **Republish changes**
   replaces the public snapshot. The URL is locked after first publication to preserve links.
7. **Unpublish** removes public access while retaining the draft. **Archive** also makes editing
   read-only; **Restore as draft** is recoverable and never republishes automatically.

Every lifecycle write is transactional with an audit entry and optimistic revision check. A stale
window must reload/reopen instead of silently overwriting newer work. On interrupted responses,
the UI blocks further writes and asks staff to reconcile the catalogue; it never asserts that a
write failed merely because its response was lost. Save drafts before navigating with browser
Back/Forward; anchor navigation and page unload warn about unsaved changes, but browser history
transitions are not a durable draft store.

**Private data:** only `internalNotes` is private. Everything else in the editor is intended for
publication. Never put supplier costs, passenger information, unpublished contacts or other private
information into the description, itinerary, policies or image metadata.

## Date semantics

Calendar date validity uses **UTC date boundaries**, explicitly labelled in the editor and consumer.
Prices are valid through the specified UTC date. After expiry, the public projection changes the
amount to `null` and basis to `ON_REQUEST`; this is not a quote. Travel windows ending before the
current UTC date project as `UNAVAILABLE`. Staff must update expired dates before republishing.
No capacity counts, departure guarantees or artificial stock are created.

## Public v1 contract

- `GET /api/public/travel-packages` → `{packages, truncated, unavailableCount}`; newest publication
  first, up to 250 **summaries**, with `truncated` if more exist. A corrupt historical snapshot is
  omitted with `unavailableCount`, not silently presented as a complete empty catalogue.
- `GET /api/public/travel-packages/[slug]` → `{package}` with full content. Unknown, draft,
  unpublished and archived slugs are indistinguishable `404`s. Both reads are dynamic/no-store.
- Summaries: `id, slug, title, destination, summary, durationDays, durationNights, priceAmount,
  currency, priceBasis, priceNotes, priceValidUntil, taxesIncluded, availability, travelStart,
  travelEnd, availabilityNotes, coverImageUrl, coverImageAlt, publishedAt`.
- Details additionally contain `description, itinerary[{day,title,description}], inclusions[],
  exclusions[], terms, cancellationPolicy, gallery[{url,alt}], contactEmail, contactPhone,
  contactWhatsapp`. They never expose draft JSON, internal notes, revision, audit or user metadata.
- Currency: `INR|USD|AED|EUR|GBP`. Basis: `PER_PERSON|PER_COUPLE|PER_GROUP|ON_REQUEST`.
  Availability: `ON_REQUEST|SEASONAL|UNAVAILABLE`. Date fields are `YYYY-MM-DD` or empty string;
  publishedAt is ISO timestamp. priceAmount is a positive major-unit estimate or `null`.
- Consumers must escape plain text (no HTML rendering), enforce the same image policy, display
  honest partial/error/empty states, and offer enquiry contacts rather than payment or reservation.
  `UNAVAILABLE` packages may offer an enquiry about alternatives, never promise availability.

The staff catalogue returns metadata only, with a selected record fetched separately to avoid
sending every private draft to every list view. Its 250-record cap is visibly disclosed. There is
no full archive pagination yet; larger catalogues need a follow-on paginated management workflow.

## Verification

- `npm run test:travel-packages`: isolated baseline migration then additive migration, existing
  settings preservation, permission boundaries, validation, image abuse, UTC expiry, optimistic
  conflicts, snapshot isolation, public privacy/404, archive/restore and audit.
- `npm run test:travel-packages-http`: isolated HTTP lifecycle, auth/branch/CSRF denial, metadata
  projection, stale revision and published/draft separation without Chromium.
- `npm run test:travel-packages-browser`: isolated SQLite/server, synthetic accounts, authenticated
  HTTP boundaries and desktop/mobile package lifecycle. Requires production build and Chromium.
- CI runs the domain/migration test in staff-sales-security and the browser journey in the test
  job. No deployed database, real customer, supplier booking, payment or outbound notification is used.
