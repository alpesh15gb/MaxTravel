# Demo readiness review — 13 October 2026

## Verdict

The local build is suitable for a rehearsed visa/ticketing operations demo after deployment and demo preparation. The currently inspected live session is not ready to demonstrate the new reporting: it still shows the earlier Reports & insights screen, and its dashboard/visa list have no accessible work records. These are observations about this account, not proof that the server database is empty.

No live records were created, messages sent or settings changed in this review. This is an assessment, not implementation of the improvements below.

## Evidence and limits

- Read-only live review: refreshed dashboard, visa list, reporting screen and checklist catalogue at the supplied server. Dashboard remained at zero active visa cases, bookings and receivables; visa list said no cases. Reporting lacked the new statement catalogue. China v2 is active with 13 requirements; v1 remains superseded with three.
- Reviewed the current local desktop screenshots across the 21-route UI gate, representative phone screens, latest statement desktop/phone previews, and relevant financial/checklist source. These are isolated synthetic fixtures, not live client data.
- Current completed verification from this session: production build, 26 reporting checks, WhatsApp formatter checks, 198 smoke checks, 37 evolution checks, accessibility and UI gates. Reporting browser check passed statement balances, exports, terms, supplier statement and phone layout.
- Those checks are regression evidence, not a fresh human exercise of every control in every role. Live outbound provider delivery, backup restoration, HTTPS configuration and post-deployment financial reconciliation have not been certified here.

## Before the demo

| Priority | Finding | Required preparation or improvement | Acceptance |
|---|---|---|---|
| P0 | Live reporting is the previous version; local statement and WhatsApp changes are pending deployment. | Follow reporting-deployment.md; back up, migrate, build/restart app and worker, reconcile. | Live report catalogue includes customer/supplier statements; PDF/XLSX download; an unsent document request preview has numbered lines. |
| P0 | Current live account has no accessible work to demonstrate. | Confirm intended account/scope. Prepare a separate demo database with fictional customers and coherent linked transactions; keep production records untouched. | One customer has a visa case, uploaded/reviewed document, booking, receipt, due date and reconciling statement. Add supplier settlement and a refund example. |
| P0 for public client upload demo | Supplied server and upload-link origin use plain HTTP. | Configure an HTTPS domain/proxy and canonical app URL before handling actual client documents or displaying production upload links. | Login, private upload, signed view and generated links use HTTPS. Server operator verifies proxy/session behavior. |
| P1 | China v1 still appears beside active v2; country labels mix CN with full names. | Show active versions by default, with an explicit version-history filter. Display China consistently while preserving stored matching keys and old case requirements. | New cases select active v2; old cases retain their own checklist; history remains available. Do not delete referenced versions blindly. |
| P1 | Dashboard and money desk report positive work obligations, while statements show signed customer balances including credits. Priced enquiries are included in the existing receivable policy. | Make definitions visible and consistent: distinguish quote/pipeline value, positive work dues and customer credit/net balance. Any accounting-policy change needs a coordinated implementation across screens. | A customer with an advance or cancellation credit has an understandable explanation across customer, dashboard, money and statement views. |
| P1 | Booking shows an indicative numeric margin even when supplier cost is missing; reports exclude missing costs from actual costed margin. | Prefer “Supplier cost required” as the main actual-margin value and place indicative markup separately. Populate actual demo supplier costs. | Booking and report actual margin reconcile; no estimate is presented as profit. |
| P1 | Mobile visa filters/workflow help push case cards far down; statement money columns require horizontal table scrolling. | Collapse secondary filters/help on phones, add a clear table-scroll cue or compact transaction cards. | At 390px the user reaches work records quickly and can discover amounts/balances. |
| P2 | Customer-statement link sits alone above the customer workspace, with unnecessary top whitespace. | Move it into customer header/actions alongside other finance actions. | Customer identity and primary actions appear together on desktop and phone. |
| P2 | Money desk displays the latest 100 receipts; documents/tasks also have capped recent lists. | Add server pagination/date search; until then clearly distinguish recent lists from full registers and use reporting exports for complete history. | Older records remain discoverable without assuming a capped screen is the whole ledger. |
| P2 | Checklist search with no match renders an empty area rather than an explanatory state. | Add “No matching checklists” and a clear-filter action. | An unmatched country query has an understandable recovery action. |

## Module assessment

| Area | Assessment for demo |
|---|---|
| Dashboard | Clear attention queue and quick actions locally; live account currently empty. Populate deadlines and assigned follow-ups in the demo environment. |
| Customers/travellers | Customer workspace and edit/actions are present; demonstrate one linked journey and customer statement. Use fictional contact/passport data. |
| Visa/checklists/documents | Board, stages and per-traveller requirements are present. Demonstrate upload, rejection/re-upload and acceptance rather than only moving stages. Hide superseded checklist clutter. Imported templates are baselines requiring staff destination/applicant review, not a guarantee of universal visa completeness. |
| Ticketing | PNR deadlines, actual ticket recording and reissue workflow exist. This is an operational record system; airline ticket issuance is external. Include travel dates, passengers and supplier cost in demo records. |
| Money/reports | New local reporting provides statements, ageing, registers and exports. Historical balances before deployment are opening balances at cutoff; do not promise reconstructed older statements. |
| Refunds/suppliers | Include a partial supplier payment and a refund lifecycle example. Recording settlement/payout is not moving money through a gateway. |
| WhatsApp | Formatting is fixed locally. Show a preview/log or controlled test recipient; confirm deployed provider mode, worker and consent before claiming automatic delivery. A manual-mode local screenshot does not establish the live provider configuration. |
| Tasks/team | Assignment, edit/cancel and role controls are present. Add dated tasks and demonstrate a restricted staff account, not only the owner. |
| Search/notifications/audit/settings | Regression/render coverage exists; include one search, one notification and one audit event in rehearsal. Confirm agency identity is consistent in exports. |

## Suggested 10-minute rehearsal

1. Dashboard: deadline and missing-document attention item.
2. Customer: family travellers and linked visa/booking.
3. Visa: correct checklist, private upload, review and next stage.
4. WhatsApp: readable numbered document request preview.
5. Ticketing: PNR deadline and recorded airline ticket.
6. Money: partial receipt and due-date setting.
7. Reports: customer statement, ageing and PDF/XLSX export; supplier outstanding.
8. Task assignment and audit trail; brief restricted-role view.

Use a resettable isolated demo environment and rehearse with the same deployed build and account that will be presented. Do not send requests to real customers during rehearsal.

## After the demo

Keep broader scope separate from demo polish: general ledger/statutory accounting, customer-credit allocation, commission settlements, expense management, multi-currency, quotations/itineraries and automated statement delivery remain additional product work. Deployment readiness requires server backup/restore, monitoring and role acceptance beyond passing local UI tests.
