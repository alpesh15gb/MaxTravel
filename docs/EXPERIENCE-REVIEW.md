# Experience review and delivery evidence

Review date: 1 November 2026. This is a review of official product documentation and our implementation, not a ranked market survey or a hands-on competitor trial.

## Benchmarks and resulting decisions

| Benchmark | Useful pattern | Applied decision |
| --- | --- | --- |
| [TravelJoy task assignment](https://help.traveljoy.com/hc/en-us/articles/45598371471764-Assign-tasks-to-team-members) and [task workflow](https://help.traveljoy.com/hc/en-us/articles/45717772024596-Use-tasks-to-streamline-your-workflow) | Tasks belong to a trip as well as a personal/team list; assignment must respect access. | Permanent case context, source links, scoped personal/team work, explicit ownership and a handover queue. |
| [Tern template assignment](https://help.tern.travel/en/articles/15021017-assigning-task-templates-to-other-agency-members) | Reusable assignment defaults are checked when a plan is applied. | Versioned service plans; eligible colleague/coordinator defaults, previewed due targets, explicit warnings and no silent reassignment of existing work. |
| [Travefy connected CRM](https://travefy.com/blog-post/travefy-launches-all-new-crm-suite) | Client, trip, communication and commercial activity share context. | One case with Overview, Work, Documents, Conversation, Money and History; the underlying booking, visa and finance records remain authoritative. |
| [Zoho dashboard controls](https://help.zoho.com/portal/en/kb/crm/analytics-and-dashboards/analytics-dashboards/articles/create-dashboard) | Reporting access must follow permissions and scope. | Role-aware navigation, complete filtered counts, export scope enforcement and separate current workload versus dated actions. |

## Screen and handoff coverage

| Screen family | Intended everyday job | Implementation and verification |
| --- | --- | --- |
| Sign in, security, recovery | Enter the correct agency workspace securely. | Existing MFA/session protections retained; readiness render, smoke/security and accessibility gates. |
| Home | Staff see their next actions; managers see exceptions and ownership. | Role-specific My day/Agency overview; work queues, source deadlines, recent outcomes, workload and refresh. |
| Cases and case creation | Register a request once and retain a permanent identifier. | Existing case serials preserved; mixed services supported; coordinator and next action shown. |
| Case detail | Continue a customer journey without losing its context. | Six focused tabs; source-appropriate permissions, explicit conversation links and scoped source documents. |
| Work register and detail | Assign, execute, follow up, review and hand over work. | Search/filter/list/board, versioned writes, recoverable retries, original deadlines, waiting reasons, prerequisites and outcome evidence. |
| Work templates and rules | Configure repeatable operations. | Structured service steps, assignment/reviewer defaults, calendar-hour due targets, working hours, holidays, stale threshold, missing-content target and escalation managers. Existing work is preserved. |
| Visa, flight, hotel and sales records | Perform the actual service transaction. | Existing transaction forms retained with case context; assigned staff receive the permitted linked source record, not unrelated customer history. |
| Documents and upload links | Request, receive, validate and safely open the required files. | Delegated visa access works through document and upload-link endpoints; sensitivity restrictions remain enforced. |
| Inbox and incoming documents | Understand messages and attach the relevant conversation. | Existing supported-content handling retained; unavailable-content follow-ups are accountable work. Missing Meta text is not fabricated. |
| Customers and profile | Maintain customer/traveller information and history. | Existing profile flows retained; legacy unfiled follow-ups have a reconciliation view. Case assignments do not transfer the whole customer profile. |
| Finance, payments, invoices, refunds, advances and suppliers | Record real commercial activity and reconcile it. | Existing journal/receipt/invoice controls retained; case Money links the permitted source records; finance/reporting regression suite protects the ledger. |
| Reports | Explain workload, actions and financial results with a clear basis. | Work reports distinguish current backlog from period events; historical assignee/title/case snapshots, exact filtered drilldowns and complete CSV exports. Existing financial exports retained. |
| Settings, staff, audit and notifications | Govern access and operating rules. | Dedicated settings destination, role-aware navigation, existing staff/security controls, immutable workflow events and scoped in-app notifications. |
| Phone and tablet | Complete work without desktop-only controls. | Collapsed secondary controls, accessible dialogs, horizontal case navigation, readable cards and four tested viewport widths. |

The case-workflow browser suite tests first contact, source-record creation and delegation, admin assignment, staff start/wait/resume/submission, reviewer return/resubmission/approval, duplicate-request recovery, template version conflicts, mixed services, reports and responsive case tabs. Other existing suites cover their own route families; a screenshot is visual evidence, not proof that every business scenario has passed.

## Acceptance boundaries

Automated runs use isolated synthetic data. Migration rehearsal preserves legacy identifiers, amounts and honest history baselines. Agency staff acceptance, real provider UAT, external account configuration and physical-device trials require their own evidence. Preview database/files/worker compatibility is a separate deployment check; no production customer database is copied to Vercel.

The final visual pass added each colleague’s completion-event count and an attributed completion list to the manager home screen. Historical outcomes retain snapshot names; links appear only while the current task is still accessible. Account and My trips screens in booking use a shorter support footer. Actual isolated PostgreSQL checks passed for case assignment, staff submission, separate approval, invoice replay, cross-site denial and admin/staff rendering. The local Docker export produced zero-filled copies of several source files, although the source and generated app files were intact; that failed local image was removed. A fresh Linux image boot/health check remains a release acceptance gate.
