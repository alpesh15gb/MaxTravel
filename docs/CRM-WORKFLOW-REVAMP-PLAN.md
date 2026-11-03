# CRM workflow and interface revamp

Research and repository review: 31 October 2026. Status: implemented in this release; see [Case workflow](CASE-WORKFLOW.md) for the delivered behavior, verification and migration/rollout requirements. Agency pilot and provider acceptance are tracked separately.

## 1. Product decision

Build the everyday experience around customer cases and accountable work. A staff member must immediately understand what to do next; an administrator must immediately understand who owns work, what has actually happened, what is waiting and what needs intervention.

The previous seven-section dashboard improved grouping but did not join ownership, task execution, review and management reporting into one process. Another cosmetic rearrangement will not resolve that gap.

Primary hierarchy:

Customer -> permanent case -> service work -> assigned tasks -> recorded outcomes and approvals.

A customer can have several independent cases. A combined visa/flight/hotel request can have several service work items under one case. A case has one accountable coordinator; each service and task has its own responsible person. Business-wide internal tasks can exist without an artificial customer case.

## 2. Research and design implications

These are official product/help documentation benchmarks, not hands-on trials or a ranked market survey. Competitor behavior informs our design; proposed features below are our decisions rather than claims that every benchmark product implements them.

| Benchmark | Observed pattern | Decision for our CRM |
| --- | --- | --- |
| [TravelJoy task assignment](https://help.traveljoy.com/hc/en-us/articles/45598371471764-Assign-tasks-to-team-members) and [teams](https://help.traveljoy.com/hc/en-us/articles/360028239792-Introduction-to-TravelJoy-teams-and-assistants) | Team assignment with different owner/member/assistant access | Delegation must put work in the assignee's daily queue; management and sensitive information remain permission controlled. |
| [Travefy Tasks and Teams](https://intercom.help/travefy/en/articles/6598233-tasks-and-teams) | Task ownership, assignment and different editing rights for administrators versus members | Give staff a personal work queue and managers a team work view, with explicit authority to assign and reassign. |
| [Tern task templates](https://help.tern.travel/en/articles/15021017-assigning-task-templates-to-other-agency-members) | Tasks assigned from workflows/templates; related-record access checked before assignment | Service templates generate repeatable work. An assignment that cannot be accessed must produce a visible exception. |
| [Tern agency reporting](https://help.tern.travel/en/articles/12240925-agency-reporting-suite) | Agency/advisor reporting, date filters, underlying-row exploration, exports and pipeline visibility | Reports answer specific management questions and drill into their contributing cases/tasks. |
| [helloGTX features](https://hellogtx.com/travel-crm-features) | Enquiry capture, reminders, lead aging, sales/operations and finance workflows | Connect enquiry, quotation, service delivery and money to the same customer request; expose aging and handoff exceptions. |

Do not copy another product's full navigation, broad sharing model or marketing promises. Our agency also handles visa processing, Indian transactions and TripJack booking servicing, so the service workflow needs its own rules.

## 3. What the current repository already provides

- Permanent ServiceCase IDs, case owners, case events, next follow-up dates and case update conflict/retry protection.
- Customer, enquiry/quote, booking, visa, document, payment and refund records.
- Task ownership, due dates, comments, basic completion timestamps and task audit entries.
- Branch/assigned-record access, financial approvals, reporting and exports.
- Signed booking/payment integrations and provider message handling.

Observed gaps:

1. Task has no direct ServiceCase relation. The case page finds tasks through linked bookings/visa applications, so first-contact and sales work cannot reliably appear in the complete case work list.
2. Task lifecycle is OPEN / IN_PROGRESS / DONE / CANCELLED. There is no structured waiting reason, scheduled review of a blocker, review submission or acceptance result.
3. Case assignment authority is coupled to employee/settings administration. Work delegation needs dedicated permissions, especially for branch and service managers.
4. Tasks have no structured assignment/completion/review history suitable for historical workload and turnaround reports. An audit string or mutable current owner is insufficient for attribution.
5. The dashboard is a shared attention shortlist, not a complete management work register. Bounded lists cannot supply management totals.
6. Team work is dispersed across employee records, tasks and different service pages; there is no central assignment and intervention view.
7. A case currently has one service value. Combined requests need an additive service-work model while preserving existing case IDs.
8. Current reports include operational/financial views and task-status counts, but not the proposed assignment, blocker, review and historical completion measures.

## 4. Navigation and screen hierarchy

Use six main destinations plus a settings utility. Avoid overview -> module cards -> another overview -> record navigation.

| Destination | Administrator | Staff |
| --- | --- | --- |
| Home | Agency priorities, review requests, urgent exceptions, recent outcomes | My day: new assignments, today's actions, overdue work and returned work |
| Cases | All permitted requests; customers/travellers as a related directory | Assigned/permitted cases with clear next steps |
| Work | Assignment queue, team work, service queues, approvals, workload | My work with due-date and service filters |
| Inbox | Conversations, unmatched messages and delivery/content exceptions | Permitted customer conversations and follow-up work |
| Finance | Existing permitted invoices, receipts, advances, refunds and supplier accounts | Only finance tools their role permits |
| Reports | Work, service outcomes, sales and finance reports according to permission | Personal/department work reports where permitted |
| Settings utility | Team/access, service templates, work rules, business hours and agency configuration | Personal settings and permitted reference tools |

Existing specialist record URLs remain usable. Flights, hotels, visas, online-booking exceptions and document verification are service views inside Work or contextual screens inside a case. Staff should not repeatedly choose which unrelated module contains the same request.

## 5. Administrator's daily operating flow

1. Open Home. Four exception summaries: Unassigned work, Overdue work, Waiting for review, Critical service deadlines. Counts link to exact matching work lists.
2. Open Work to assign incoming requests. Select the case, service template, coordinator, staff assignees and due dates. Preview generated steps before applying.
3. See each candidate's active assignments, overdue work and upcoming deadlines. Counts are workload signals, not a fabricated capacity score.
4. Assign one task or several eligible tasks. Validate branch, role, service access and current task version on the server. Report partial failures explicitly.
5. Monitor a table by default. Columns: case ID, action, assignee, due time, status, waiting on, next check and last meaningful update. Optional board view uses the same records and filters.
6. Review submitted outcomes only where review is required. Approve or return with a reason; existing finance/document approvals are reused rather than duplicated.
7. At day end, inspect work due that day, its current result, completed outcomes, blockers and the next follow-up plan. Every summary opens its underlying rows.

Managers need dedicated Work permissions rather than access to employee salary/bank or agency security settings.

## 6. Staff daily flow

1. Sign in to My day, scoped to their assignments and record permissions.
2. Open a work item with its customer, permanent case ID, instructions, due time, required result and related documents already present.
3. Start work. Acknowledgment/start time is recorded without a separate mandatory acceptance click for every trivial task.
4. Complete the actual business action in context: prepare a quote, verify a document, record application submission, reconcile a booking or record an authorized receipt.
5. Select Complete or Submit for review as applicable. Required evidence/result fields depend on the task type.
6. If unable to proceed, choose Waiting and record who/what is needed, the reason and next follow-up time. The task retains an accountable assignee.
7. Receive returned work in My day with the reviewer's explanation and preserved history.

Routine low-risk work can complete directly. Ticket issuance, payments, refunds, passport verification and other controlled actions retain their own authorization and source-record checks.

## 7. Case workspace and intake

New case is a short contextual intake: identify/create the customer, capture request/service and key dates, allocate the permanent ID, choose the coordinator and apply the service steps. Progressive disclosure reveals service-specific fields. Existing bookings imported from the booking app enter the same case system through idempotent source IDs.

The case header shows case ID, customer, service(s), accountable owner, operational status, next action and next deadline. It remains visible when opening service work.

Use the permanent case ID as the primary journey reference everywhere. Existing visa application numbers, booking references and PNRs remain secondary, explicitly labelled references; do not call several different identifiers "Case ID".

Case tabs:

- Overview: request summary, next action, blockers and recent outcomes.
- Work: service steps, assignees, dependencies and reviews.
- Documents: requested/received/verified items and reasons for rejection.
- Conversation: linked customer communication and internal notes clearly separated.
- Money: permitted source invoices, receipts, dues, refunds and supplier obligations.
- History: who changed what and when, including reassignment and reopening.

Customer details and traveler profiles are maintained once and reused. A message about a customer with multiple cases is not silently filed against an arbitrary case.

## 8. Work states and business rules

To do -> In progress -> Awaiting review -> Done.

Additional paths:

- In progress -> Waiting -> In progress.
- Awaiting review -> In progress when returned with a reason.
- Authorized reopening returns Done to In progress with an event.
- Cancelled is separate from Done and excluded from completed-output totals.

Assignment is separate from work state: an unassigned task is visible to its case owner/authorized manager. An open customer case always has an accountable coordinator.

Waiting reason choices: customer, supplier, internal decision, payment, authority, other. Require a reason, accountable owner and next check date. A waiting flag never suppresses a hard travel, ticketing or appointment deadline. Whether internal response-time clocks pause is explicit policy, not inferred.

Keep case lifecycle, staff work status, supplier/visa outcome and payment status separate. A completed staff task cannot fabricate a confirmed supplier booking, approved visa or settled receipt. Case closure checks required work and the actual service outcome; unresolved financial items remain visible and use a separately configured closure policy.

Task completion uses evidence appropriate to the step: a source-record transition, document verification, quote version, appointment details, submission reference or a brief recorded outcome. Do not demand screenshots for every phone call or add duplicate manual fields when the app already knows the result.

## 9. Service examples

### Visa

Register request -> assess requirements -> request documents -> verify documents -> prepare application -> required review -> appointment/submission -> await authority outcome -> record outcome/return documents -> close according to policy.

Example: the coordinator assigns document verification to one staff member, application preparation to another and a review to the visa manager. When submission is recorded, that task is complete, but the case remains Waiting for authority with a scheduled follow-up until its actual outcome is recorded.

### Flight

Register request -> prepare options/quote -> record customer acceptance -> confirm payment/authorization as applicable -> book/issue through the authorized source -> verify ticket details -> deliver ticket -> service/reissue/cancellation work as required -> close.

Payment success with no confirmed ticket creates an owned exception, not a completed booking. Supplier deadlines remain prominent while waiting for customer or finance action.

### Hotel

Register request -> prepare options -> record acceptance -> supplier booking/payment steps -> verify confirmation/cancellation terms -> deliver voucher -> manage changes/check-in issues -> close.

Shared or parallel work has visible dependencies: a staff member can see what must finish before their task is actionable. Use simple prerequisite steps initially, not a general-purpose visual workflow programming engine.

## 10. Interface rules and screen inventory

The interface should be quiet, readable and predictable: neutral surfaces, a consistent brand accent, readable text, clear status labels and one dominant action appropriate to the current screen. Use compact record rows for daily work and cards only for useful summaries. Avoid large empty panels, repetitive module tiles, nested page headers and several competing create buttons.

Saved filters persist in the URL. A detail view preserves list/filter position on return. Mobile shows the same task context and actions without hover-only controls or mandatory drag gestures. Forms preserve drafts through recoverable failures, display validation beside the field and distinguish unsaved, saved, failed and outcome-unknown states.

| Screen group | Required change |
| --- | --- |
| Login and account | Clear role landing, session/error handling and accessible navigation |
| Home/My day | Different admin and staff decisions; brief queues rather than a module catalogue |
| Team work and assignment | Search, eligible assignees, due dates, workload, bulk preview and reassignment history |
| My work/task detail | Contextual execution, waiting reasons, evidence, review and safe retries |
| Cases list/detail/intake | Permanent identity, next action, shared case workspace and multi-service structure |
| Customers/travellers | Shared profiles, duplicate detection and request history |
| Sales/quotes | Enquiry linked to case; versions and accepted quote handed to an owned service task |
| Visa/documents | Case context, checklist progress, verification/rejection and actual authority outcomes |
| Flights/hotels | Case context, supplier state, issuance/confirmation evidence and servicing work |
| Online-booking exceptions | Payment/supplier mismatches, failed sync, named owner and reconciliation result |
| Inbox/incoming files | Linked cases, unread/reply state, unmatched files and unavailable-content review |
| Finance | Consistent source-linked invoices/receipts/advances/refunds/supplier transactions with existing controls |
| Reports | Questions, scope/date basis, exact source rows and complete authorized exports |
| Team/settings/audit | Separate work delegation from HR/security; configurable rules and clear audit history |

Every route and dialog is covered by a before/after inventory during implementation. A new homepage alone does not meet completion.

## 11. Reporting specification

| Management question | Report and basis |
| --- | --- |
| Who owns unfinished work now? | Current workload by assignee, service and branch, with unassigned work separate |
| What was done today? | Recorded completions/review acceptances during the agency day, with task/case/outcome links |
| What should have finished? | Due-date cohort and current outcome: open, waiting, review, done, cancelled; explicit bucket definitions |
| What is late or stalled? | Open overdue work, aging, time since meaningful update, waiting reason and next check |
| What needs my decision? | Pending reviews/approvals with submission time, reviewer and age |
| Are handoffs effective? | Assignment-to-start, submission-to-review and service turnaround, with sample sizes and missing-data coverage |
| What did each staff member deliver? | Completed/accepted work by type, on-time basis, returned/reopened work and historical assignee attribution |
| What happened to each enquiry? | Case/source cohorts through quotes, acceptance, booking/service and closure |
| What money remains? | Existing source-backed receivables, receipts, payables, advances/refunds and disclosed costed margins |

Report rules:

- Display branch/user/service scope, selected date field, timezone, refresh time and coverage caveats.
- Use independent full-dataset aggregations, not dashboard caps or current-page rows.
- Distinguish current backlog from dated completion/assignment cohorts. A historical completion remains attributed to its historical assignee after reassignment.
- Preserve original and revised due dates. Due-date changes do not silently improve on-time performance. Define reopened/completion cycles explicitly; distinguish completion events from distinct completed tasks.
- Do not label task volume as productivity or booking margin as net profit. Financial comparisons need recorded costs and the existing accounting basis.
- Filters and exports use the same authorized query definition; exports include the full matching set and safe spreadsheet values.
- Unknown historical details remain Unknown. New detailed metrics begin at the event-history cutover rather than inventing old acceptance/review times.

## 12. Data, permissions and automation

Extend the existing data model additively:

- ServiceWork beneath ServiceCase for one or several services, with coordinator/service assignee and source references.
- Direct case/service-work linkage on customer tasks, retaining booking/visa links where relevant.
- Structured task events for assignment, start, due-date changes, waiting, submission, review, completion, cancellation and reopening.
- Fields for required outcome, waiting reason/next check, review requirement/reviewer, timestamps and concurrency version.
- Versioned service templates with step identity, role/default assignee, prerequisites, due-date rules and review policy.
- Event/source uniqueness and transactional outbox/job records for reliable generation and notifications.

Preserve existing customer, case, booking, receipt and invoice identifiers. Keep supplier, payment and document systems as the authority for their business outcomes.

Separate permissions for assigning work, reviewing work, viewing team work and viewing operational reports. Work assignment does not grant unrelated customer history, passport access, financial access or employee HR access. Check assignee activity, branch, service capability and record access before accepting an assignment; reject or explicitly request a permitted access grant instead of producing unusable work.

Administrator settings cover service templates, assignment defaults, working calendar, internal response targets, escalation recipients, evidence/review rules and closure rules. New template versions do not silently rewrite active cases. Rule changes have an impact preview and audit entry.

Begin with manual assignment and reusable templates. Automatic distribution is optional after eligibility, leave/availability and workload rules are proven. Triggered tasks and notifications use stable source IDs; repeated booking/payment webhooks or worker retries must not create duplicate tasks, sends or receipts.

Persist timestamps in UTC, display/aggregate agency days in Asia/Kolkata and require business hours/holiday settings before business-hour escalation. In-app staff notifications work independently of customer email. Client communication uses the scoped email workflow; private documents follow the payment/release rules.

## 13. Delivery sequence and release gates

| Phase | Deliverable | Exit criterion |
| --- | --- | --- |
| 1. Design contract | Route inventory, role wireframes, status/permission definitions and reporting dictionary | Admin and staff walkthroughs cover intake, assignment, waiting, completion, review and reopening without ambiguous labels |
| 2. One complete visa journey | Additive schema/events, case-linked tasks, My work, assignment and review, case workspace | A request is registered once, delegated across staff, blocked/unblocked, submitted/reviewed and audited end to end |
| 3. Management oversight | Team queue, workload, intervention/review views and work reports | Every summary drills into the exact contributing records; reassignment and due changes retain history |
| 4. All service and transaction screens | Flight/hotel/sales/online-booking/docs/inbox/finance/settings flows use the same patterns | Existing business actions remain available and source states/money reconcile |
| 5. Migration and production pilot | Explicit backfill, exception queue, focused regression suite, staff pilot and controlled rollout | Existing IDs, transactions, permissions and document links preserved; old and new work reconcile before wider enablement |

Use the current Next.js/Prisma/SQLite/VPS deployment for this project. Workflow redesign is not a reason to introduce a new database vendor or replace working integrations.

Migration policy: link legacy tasks through unambiguous existing booking/visa relations; place ambiguous/unlinked customer work in a visible reconciliation queue rather than guessing. Existing completed tasks retain recorded completion times, with review/assignment-history coverage marked legacy/unknown. Reconcile counts and identifiers before and after migration.

Use an expand/contract rollout and compatible APIs. New work states must not disappear from legacy queues. Keep server-side transition/review enforcement active during a UI rollback. A database restore after new transactions is a deliberate recovery operation, not a routine UI rollback.

## 14. Acceptance scenarios

1. An administrator registers a visa request once, assigns different steps to two staff and sees the same case ID across their work.
2. A staff member immediately sees the assignment and can open all permitted supporting records; another unauthorized staff member cannot.
3. Blocked work shows who/what is needed and when it will be checked again. A hard appointment/ticketing deadline still escalates.
4. Review-required work cannot be directly marked Done by the assignee or by an older API client. Return/approve records a reviewer and reason.
5. Routine task completion does not require unnecessary approval; actual supplier, visa and financial outcomes still use their original controls.
6. Reassignment, due-date changes, cancellation and reopening preserve history and produce correct current and historical reports.
7. A paid-but-unconfirmed online booking creates one owned exception even when provider callbacks are retried.
8. Failed or uncertain customer email remains visible for staff review without claiming delivery or silently repeating an uncertain send.
9. Every overview count reconciles with its filtered list and complete export, including more records than any attention-list limit.
10. Owner, branch manager, visa/ticketing staff, accounts and read-only flows work at desktop and phone widths, with keyboard support and preserved list context.
11. A migration rehearsal on a backup preserves IDs, source balances, ownership and completed history; ambiguous records remain visible for resolution.
12. A real administrator and staff member perform daily scenarios without coaching before the redesign is called ready for agency-wide use.

The first production outcome to target is the entire assign -> execute -> review -> report loop for one visa case, then extend the same proven model to every service screen.
