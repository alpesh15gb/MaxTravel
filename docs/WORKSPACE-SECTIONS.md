# CRM workspaces

The CRM opens with a short daily overview and separates detailed transactions into seven sections. Existing record URLs, case IDs, permissions, balances and transaction APIs remain the authoritative workflows.

| Section | Entry | Work |
| --- | --- | --- |
| Today / My work | `/dashboard` | Priorities, India-day follow-ups, tasks and notifications |
| Customers & cases | `/workspace/customers` | Client journeys, customers, enquiries and quotes |
| Travel operations | `/workspace/operations` | Flights, hotels, online bookings, visa applications and verification |
| Finance | `/workspace/finance` | Customer invoices/receipts, advances, refunds and supplier accounts |
| Communications | `/workspace/communications` | WhatsApp and incoming documents |
| Reports | `/reports` | Existing dated, scoped reports and complete exports |
| Administration | `/workspace/administration` | Team/access, agency and case settings, checklists, catalogue, import and audit |

## Daily work

Owners, super administrators and branch managers see **Agency overview**. Other roles see **My work**. Every query retains its existing ALL, BRANCH or ASSIGNED access scope; the displayed scope makes that distinction explicit. A role name never widens access.

Up to four summary numbers show open client journeys, follow-ups due by the end of today in Asia/Kolkata (including overdue work), urgent queue priorities, and unread messages. Inaccessible figures are omitted. Case, due-follow-up and unread counts are queried independently of the bounded attention lists. Queue-based numbers explicitly describe the current queue rather than claiming to be financial or operational reports.

The default view shows at most five decisions and five follow-ups. View-all links retain the relevant view in the URL. Detailed queues have priority filters and progressive disclosure; capped source lists announce their limits and link to the full module. Financial amounts and detailed action queues belong to the relevant sections.

**New case** opens the existing first-contact form and returns its permanent case ID. The service list follows creation permissions, customer search follows scope, and only roles allowed to add customers receive that shortcut. The registration retains the existing request-key recovery and server authorization. Overview queues open source records; transaction writes are completed in the original record workflow.

## Navigation and access

Section headers navigate to their overview. Separate labelled controls expand or collapse their module links. One group is open at a time, and navigating to a record opens its section automatically. Phone navigation retains focus trapping, Escape dismissal and focus restoration. Breadcrumbs include the section and existing record hierarchy.

The navigation, module launchers and server entry guards share `src/lib/workspace-sections.ts`. `/api/pulse?section=…` authorizes that section, computes scoped records, and returns its relevant summary/queue through a private, uncached response. Unknown sections are rejected. Revoked access clears a previously loaded client summary. The original `/api/pulse` contract remains available for existing consumers.

Read-only users receive read tools without creation/settlement/refund launchers. Hiding a control never replaces server-side authorization.

## Verification and rollout

Build the current checkout and run `npm run test:workspace-sections`. The browser suite creates its own database/server on a free loopback port, blocks external browser requests, and checks the seven destinations at desktop/phone widths, single-primary-action hierarchy, navigation, permanent case registration, assigned-staff isolation, denied administration/finance operations and read-only launchers. It also verifies the India-day follow-up boundary.

Run browser suites serially: they share the visual fixture metadata pointer, while each suite creates its own database and server. The existing workspace, sales-handoff, smoke, reporting and accessibility checks remain relevant. This release adds no database migration. On the existing VPS deployment, use the verified `/root/max-crm-cases-upgrade.sh` procedure to rebuild the checkout, preserve the runtime configuration and data volume, back up and recreate both services.

Validated on 31 October 2026 with a production build, lint and TypeScript checks; 200 HTTP regressions; seven transaction journeys with 84 desktop/phone captures; 14 focused workspace captures and access/registration checks; the 64-visit accessibility gate; and the 26-route visual metrics gate. These use disposable local fixtures. Live provider credentials and the deployed VPS still require their separate acceptance checks.
