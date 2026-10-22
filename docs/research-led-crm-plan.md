# Research-led CRM experience plan — 22 October 2026

Base: `f863ce6fbb3d8534a35261154e8aaabc3d54128e`, confirmed against GitHub main before work. This is a new isolated checkout, not the stale local baseline. No deployment or live-data work is included.

## Evidence → original design decisions

Read the shared research BLUEPRINT, CRM operations cohort and MaxTravel baseline. Travefy's documented attention-first approach informs Today; WeTravel's documented opportunity/publication distinction informs the entity boundaries; TravelJoy's public editor illustration informs contextual authoring, not a copied layout. These were not private competitor applications or measured speed benchmarks. All twenty competitors have evidence-quality limits; no invented usability/conversion claims.

- **Today:** current actionable records lead; urgency/reason and real action precede aggregate counts. Existing pulse API remains authoritative. No synthetic waiting-on-supplier/deposit/departure queues.
- **Navigation:** Today / Sales / Travel desk / Finance / Catalogue / Administration, with an explicit active area and current role/branch context. All 21 existing links retain exact routes and permission predicates. Daily work group remains the home of Today; Sales is expanded by default for customer discovery. No permission expansion.
- **Sales:** searchable/filterable enquiry index beside one selected record; deliberate new-enquiry and quote-editor workspace. Creating a quote moves focus to its heading and reveals first fields, never appends an editor below the whole list. Dirty edits require a decision. Save draft → publish private proposal → manually copy one-time private link → accepted quotation → create CRM booking remain distinct. A booking record does not establish supplier confirmation/payment.
- **Public catalogue:** catalogue identity and saved draft/published snapshot shown independently. Editing/saving never republishes. Preview remains explicitly a draft text preview, not the customer website. Existing agency-wide permissions, optimistic versions, media gates and uncertain-write locks remain unchanged.
- **Shared system:** original navy/cobalt, warm near-white workplanes, readable 16px principal text / >=14px important metadata, 44px controls, disciplined borders, contextual status strips and stable form/action hierarchy. No decorative charts, fabricated data or consumer imagery in operational screens.

## Ownership

Parent CRM owner: Shell, globals/shared UI, Dashboard, Packages, this plan and integration checks.
Sales subagent: SalesClient and sales-specific test helpers only; no shared styles/API/schema.
Verification subagent: new research-revamp browser harness/workflow and route-equivalent renamed-nav selectors in existing browser tests. No assertion/budget weakening.
Independent review and exact-tree CI/pixels required before main promotion; parent coordinates publication. No VPS deployment.

## Preserved authenticated route inventory
- `/account-security`
- `/advances`
- `/audit`
- `/checklists`
- `/customer-tools`
- `/customers`
- `/customers/[id]`
- `/dashboard`
- `/documents`
- `/employees`
- `/employees/[id]`
- `/incoming-documents`
- `/notifications`
- `/online-bookings`
- `/payments`
- `/payments/print`
- `/refunds`
- `/reports`
- `/sales`
- `/settings`
- `/suppliers`
- `/tasks`
- `/ticketing`
- `/ticketing/[id]`
- `/ticketing/new`
- `/travel-packages`
- `/visa`
- `/visa-requirements`
- `/visa/[id]`
- `/visa/new`
- `/whatsapp`

## Validation / exit gates

1. Same deterministic isolated fixtures and viewport settings on pinned base and candidate. Baseline capture records existing deficiencies; candidate must pass actual task assertions.
2. 320/390/1440 widths: settled Today first real action visible; all navigation routes reachable with original role filtering; search and contextual screens show meaningful empty/error/loading states.
3. Existing-customer enquiry creation; selected record context; quote heading/first field focused and visible; dirty Close/navigation cancellation preserves input; draft/private proposal/accepted booking states accurately labelled; repeated and uncertain writes cannot duplicate.
4. Package save keeps published snapshot stable; unpublish/archive/private media guards and scope tests remain green. No customer preview claim from text-only view.
5. Existing typecheck, lint, build, core/journey/package/media/a11y/metrics tests retain meaningful assertions. New browser checks run in authorized CI; local Chromium launch remains unattempted after earlier restriction.
6. Contrast, keyboard and rendered screenshots reviewed independently; no page overflow, hidden focused field or overlay-obscured primary action. Physical screen-reader and real-device studies remain explicitly untested unless performed.
7. No speed/zero-error/20-fully-tested claim. Report fixture results and real-user/performance measurement gaps separately.

## Source review and candid boundaries

An independent agent reviewed the product candidate before feature publication. Review found and repaired a stale dashboard GET clearing an uncertain-write lock, discarded uncontrolled sales fields surviving withdrawal, a hidden uncertainty-recovery banner after changing views, stale private links after withdrawal, and invalid accepted-but-lost conversion eligibility. A repeatable test executes AST-extracted production dashboard functions against controlled promises; it is source-level concurrency evidence, not a rendered-browser test. Browser scenarios separately exercise a quote whose save completed before its response was lost, explicit reconciliation, and discarded stage edits.

Known boundary: close/switch, same-tab anchor and beforeunload guards do not intercept all SPA browser Back/Forward transitions. No fragile history override or plaintext browser persistence was added. A future recovery increment requires a bounded authenticated-layout in-memory draft provider keyed by user/record, cleared on auth identity/logout, with scope revalidation and explicit restore; no automatic POST. Existing sales endpoints lack request-key idempotency: current tests prove UI repeat locking after a completed-but-lost response, not universal exactly-once protection if the original server operation is still pending.

No schema/API permission change, extra provider request, credential or host-deployment action is part of this redesign. Feature CI and actual screenshot review remain required; this document is not a visual acceptance certificate.
