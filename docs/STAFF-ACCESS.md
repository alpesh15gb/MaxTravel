# Staff access boundaries

The CRM combines module permissions with agency, branch or assigned-record scope. A visible menu is not an authorization grant: API routes and server-side data projections enforce the same boundaries. Permissions are defined in `src/lib/permissions.ts` and refreshed from the current employee role on every authenticated request.

## Role policy

| Role | Record scope | Customer money | Internal costs, margin and supplier accounting |
| --- | --- | --- | --- |
| Owner / Super Admin | Agency | Yes | Yes |
| Accounts | Agency | Yes | Yes |
| Branch Manager | Branch | Yes | Yes, within branch |
| Visa / Ticketing Manager | Branch, within permitted service modules | Yes | No |
| Sales Executive | Assigned | Yes | No |
| Visa / Ticketing / Travel Executive | Assigned operational records | Payment requests and release balance where permitted | No |
| Operations | Branch operational records | Payment requests where permitted | No |
| HR | Employee profiles and payroll; own internal tasks | No | No |
| Read Only | Explicitly owned/assigned operational records | No | No |

`finance:internal` is separate from `payment:view`. Customer selling charges, receipts, balances and permitted statements do not grant supplier net cost, markup, profit or agency reporting. Supplier contacts remain available to operational roles, but accounting amounts, terms, settlement references/notes and unrelated aggregate counts are not sent to those clients. Supplier-cost confirmation also requires finance recording or supplier-management permission. A staff-created booking can record a customer selling price without confirming a supplier cost; unprivileged reschedule costs remain unconfirmed estimates.

Owner and super administrator accounts alone may create staff logins or change login email, role, branch, active status and passwords. HR may edit non-administrator employees' profile/payroll fields without changing their security access. Controls are disabled or omitted in the HR editor, and direct requests are independently rejected.

Read Only is not an agency-wide auditor role. Its global audit, employee directory, team-wide reports and financial access are removed. An owner or branch administrator can explicitly assign a customer through the existing customer relationship-manager control to grant view-only access to that customer's operational records. Removing the assignment removes that access on the next request. Existing individual record ownership/assignments also remain scoped. Desk managers no longer receive bulk export permission. Owner, super administrator, accounts and branch-manager exports retain their existing scope and action checks.

Sensitive customer documents retain their existing separate `sensitive:view` gate and record ownership checks. Passport access is not automatically granted to every ticketing staff member. Staff roles do not gain payroll visibility.

## Deployment and verification

No database migration or production data rewrite is required. Deploy the CRM through its independent release procedure in `CRM-DEPLOY.md`; do not deploy or restart the separate booking site for this change. Refresh signed-in workspaces after rollout. New requests use the new permissions, but restrictions cannot retract information already downloaded before deployment.

Build the current source, then run `npm run test:staff-access`. The HTTP suite creates its own temporary SQLite database, accounts and loopback server; `NEXT_DIST_DIR` may select an isolated production build. It verifies role scopes, protected fields, customer balances, supplier contact-only views, pricing/confirmation guards, owner-only account changes, retained HR edits, explicit read-only assignment and permission reduction on an existing session. It sends no external email and performs no live payment or supplier operation.
