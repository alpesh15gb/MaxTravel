# Client and case imports

Owners use **Settings → Client & case import** (`/imports`). Other staff cannot upload, preview, commit, download issue files or undo an import. Configure the existing private `CRM_DATA_ENCRYPTION_KEY` before starting; retain the same key when deploying or restoring encrypted records.

## Prepare and review

1. Download the Excel template. Replace all synthetic example data. Each entity can be supplied as CSV or XLSX, with at most 200 nonempty rows and a 2 MB file limit. Save older `.xls` workbooks as `.xlsx`. Formula cells are rejected.
2. Choose a stable source name such as `Legacy CRM 2026`. Keep that source name and each row's external ID unchanged on retries and later imports. A different source represents a different system, not an update to the original import.
3. Choose the destination branch and default case owner. Staff must be active, able to handle the case service, and have access to that branch. A row's `ownerEmail` explicitly selects another eligible staff member.
4. Upload clients, cases and optional travellers. Map the source columns. Case `clientRef` and traveller `clientRef` refer to a client's external ID in this batch or an earlier committed import from the same source. Existing CRM clients can be explicitly linked using `crmClientCode` or the duplicate-review choices.
5. Map unfamiliar case statuses to the operational statuses shown. Preserve specialist stages in `legacyStage`, and original references in `legacyReference`. Use ISO dates (`YYYY-MM-DD`); local follow-up timestamps use India time. Ten-digit Indian mobile numbers are normalized with `+91`.
6. Validate and review every proposed change. Preview does not create clients, cases, tasks or money records. Resolve duplicate contacts explicitly: link an existing profile or choose a separate person after reviewing shared family contact details. Changed rows under an existing source ID are rejected instead of overwriting current records.
7. Import the reviewed batch once. The transaction is atomic and revalidated against current records. Retrying the same batch returns its saved result. Reimporting identical source IDs reuses their records. A changed source ID or source name is not a safe retry.

The staging payload and preview are encrypted. Preview expires after 24 hours; expired staged content is cleared on subsequent import-centre reads. Raw uploaded files are not retained. A browser reload saves only the batch UUID in the URL. If a response is lost, use **Check saved batch status**, or reload that same URL, before starting another batch.

## What is created

New clients receive current CRM client references. A primary SELF traveller is created when none was uploaded. Passports use the existing encrypted sensitive-field storage. An import sends no customer messages.

Each imported case receives a permanent current CRM case ID. Its original opening date, source reference and specialist stage remain visible in **Imported case history**. Active cases receive an assigned review task. A delegated staff member submits that work for separate owner approval; importing a history does not award completed-work credit. Closed historical cases do not create new staff work.

Find an imported case using its original reference in either the case register or global search. Case CSV exports include its original reference, import source and legacy stage. Closed historical cases retain an unknown closure date as unknown, including when their tracking owner changes. Reopen them before creating work or source records; they do not appear in open-work choices.

These are operational cases. The import does not invent supplier bookings, issued tickets, visa applications, verified documents, invoices, receipts, debts, opening balances or tax records. Open the case and use its **Add visa application** / flight or hotel booking action to attach verified source work to the same permanent case. Review actual documents and finance evidence through their normal workflows. Legacy opening balances require a separately reconciled accounting process.

## Safe undo

Import history offers **Review undo**, requiring the exact displayed confirmation. Undo applies only to this owner's untouched batch. It retains explicitly linked pre-existing clients, removes only unused records created by the batch, and never rewinds reference counters. It is refused after edits, audit activity, task progress, comments, documents, transactions, later imports or other dependent work. A later same-source case also protects the client link it relies on. Correct used records through their ordinary audited workflows.

## Demo sequence

Use an isolated demo workspace with synthetic data: finish agency/branch setup; invite a visa staff member; import a client and an active visa case assigned to that staff member; open its permanent case and original reference; sign in as staff and start/submit its review task; sign back in as owner and approve; open Work reporting. Then create real source records using the case actions, record only evidenced operational transactions, and reconcile the corresponding customer statement and reports. Test the unused-import undo on a separate client-only batch.

Automated checks: `npm run test:imports` runs disposable-database import contracts and the production-build browser journeys at desktop and phone widths. The browser test requires `npm run build` first. The CI browser job runs it after the normal audit build.
