# Case work, ownership and management reporting

The daily workflow is **customer → permanent case → service work → assigned action → recorded outcome**. One case can contain visa, flight and hotel work. Booking, visa, receipt and supplier records remain authoritative for their own business outcomes.

## Daily operation

- **Home** shows the agency/branch overview for supervisors and **My day** for staff. It refreshes on return to the window and every minute while visible; manual refresh is available.
- **Cases** registers the request at first contact and preserves its case ID. The case has Overview, Work, Documents, Conversation, Money and History views, subject to permissions.
- **Work** contains the active register, personal queue, overdue work, waiting follow-ups, review queue, completion records and legacy reconciliation. Counts use the complete matching dataset. Lists page at 30 records; the board uses the same page and scope.
- **Inbox**, **Finance** and **Reports** provide the specialist workflows. Settings sits below the primary navigation.

For a new request, create the case, add its source application/booking when available, then open Work. Preview the service template or add a specific action. Choose the assignee, due time and any separate reviewer. Template settings can prefill an eligible colleague or case coordinator and a calendar-hour due target; every plan previews the resolved India-time deadline. Ineligible defaults are cleared with an explanation rather than silently assigned. Link the service record that the colleague will work on. This grants that source record within their role without granting the customer's unrelated history. Staff can also create a new source record through a permitted case and link their own record afterwards.

Service plans preserve existing steps and assignments when applied again. Adding a second service does not buy a flight, reserve a hotel or submit an application. Source records can still be created and managed through the existing transaction screens.

## States and decisions

`To do → In progress → Awaiting review → Done` is the normal reviewed workflow. An assignee can place work in **Waiting** only with a reason, note and future follow-up time. Resume it when the blocker clears. A reviewer can approve or return the result with feedback. Required review cannot be bypassed by the compatibility task-status endpoint, and a person cannot review their own work.

Managers can reassign, reopen, cancel or waive work with recorded reasons. Original deadlines remain available after rescheduling. A cancelled required step needs an explicit waiver before a case can be completed when resolved-work checks are enabled. Waiving work never cancels a supplier booking or settles money. Deactivated assignees appear in the unassigned/handover queue.

Source-based result types check the existing records: issued flights/confirmed hotels, verified visa documents, actual submission/authority outcome, quotations or positive receipts. A task outcome cannot manufacture any of these facts. Case completion also retains the source-record closure checks configured under case management.

Writes use versions and request keys. Repeating the same request recovers its result; reusing the key with different details conflicts. Uncertain create/plan/action requests remain locked to their original payload for retry. Bulk assignment validates each selected item independently and reports unchanged items and reasons.

## Access and history

Delegation, team visibility, review, reporting and case reassignment use dedicated permissions. Employee administration does not grant work delegation. Staff receive their own or explicitly reviewed work and the permitted work of cases they coordinate. Supervisors retain agency/branch scope; read-only staff can inspect team progress without mutation controls. Finance result visibility and document sensitivity remain separate checks.

Each transition records actor, assignee, state, deadline and outcome snapshots. Reassignment does not move a previous colleague's completion history to the new owner. Staff can retain their own dated event history after reassignment without gaining access to the current task. Case history exposes only events permitted to the viewer. Messages must belong to the same customer before linking them to a case; unrelated customer conversation is not shared with delegated staff.

## Reports

**Reports → Work & team reports** separates current backlog from dated activity. It includes current ownership, unassigned/overdue work, waiting/review counts, completion events, distinct completed tasks, returns and original-deadline timeliness. Reopened work can have more than one completion event; volume is not a quality score. Due-date cohorts use current deadlines and drill down to the exact work register filters. Service filtering follows the task's current service; assignee and deadline attribution for events use their recorded snapshots.

Dates use India calendar days. Screen event/backlog tables show the first 100 records with their limit disclosed; authorized CSV exports use the entire selected dataset and escape spreadsheet formulas. Existing financial reports retain their own transaction, allocation, currency and historical-cutoff rules. A task completion does not become a receipt, profit figure or cash settlement.

## Settings and automation

Agency settings links to **Work templates & rules** at `/work/settings`. Editors configure structured service steps, prerequisites, required results, review requirements, stale-work days, working days/hours and holidays. Saving requires an impact acknowledgement and version match. Changes apply when previewing future plans; they do not rewrite existing tasks.

Soft reminders are enabled only after configuring working hours. Hard service deadlines can notify outside those hours. Reminder batches prioritize hard deadlines, skip already notified task/version/day combinations and recheck the current state before writing. Existing worker processing runs these jobs under its lease. Positive-receipt TripJack bookings without a resolved supplier status create one owned reconciliation task. Unavailable matched Meta messages create one follow-up task and link to a case only when the customer has one open case. These jobs do not resubmit purchases, refund cash or recover text Meta did not provide.

Assignment defaults, separate reviewers, due targets, missing-content response hours and additional escalation managers are configurable in Work templates & rules. Existing assignments and deadlines are preserved. Reminder recipients are rechecked against current record permissions.

The Service alerts view retains source-derived sales follow-ups, accepted-quote handoffs, supplier holds, appointments and finance exceptions without manufacturing task completions. It links to the exact source record, including enquiries outside the first Sales page.

## Database and rollout

This release requires migration **`20261031100000_case_workflow`** (22 migrations in total). It adds service work, task state/version fields, immutable work events, request recovery and case-message links. Existing case/source IDs and monetary records are retained. Legacy tasks receive an honest baseline; earlier assignment, completion and review events are not invented. Unfiled customer follow-ups remain in reconciliation. Open cases without actions receive an unassigned planning action.

Back up the running database **and private uploads/media** before applying the migration, using the current release's backup procedure or a stopped, consistent volume copy. Keep the old image, exact Compose inputs/environment and backup together. Build the intended Git commit, verify this migration is inside the new image, stop the app and worker, apply `prisma migrate deploy`, check `prisma migrate status`, then recreate both services from the same image. Readiness now checks the workflow tables and fields. Do not start a new image against an unmigrated database, run `db push` on the VPS, or restore an old backup over later transactions without an explicit recovery decision.

The existing VPS recovery helper must build the new checkout rather than reuse accumulated image overrides. Its previous case-migration check alone is insufficient: also verify `20261031100000_case_workflow` and the new Task/WorkEvent columns.

## Verification

`npm run test:case-workflow` rehearses migration from the prior schema, checks ownership/review/deadline/prerequisite/result/idempotency guards, verifies historical reporting and automation, and drives the owner/staff browser journey on disposable data. `npm run test:reporting`, `node tests/backup-restore.mjs`, Meta inbound tests and the existing browser/accessibility suites protect related workflows. Browser captures are under `test-artifacts/case-workflow` and use synthetic customers.

Provider acceptance, physical-device trials and agency staff pilot acceptance remain separate from coding and automated fixture tests. Vercel preview work is a subsequent deployment phase: the VPS SQLite file and local uploads must not be treated as persistent Vercel storage.
