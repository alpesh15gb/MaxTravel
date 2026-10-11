# Visa checklist — how it should be done (research)

Research date: 2026-10-08. Sources: official embassy/VFS Global published checklists (Schengen
tourist/business/student one-pagers for India and Europe), AXA's Schengen requirements compilation,
eimmigration's immigration case-management guide, VisaCRM/Clustdoc document-management practice,
and industry visa-CRM feature guides. Compared against Travel OS (`prisma/schema.prisma` checklist
models, `/api/checklists`, `/api/visa/cases`, `/api/visa/cases/[id]/stage`, `/checklists` UI).

## 1. What an official checklist actually looks like

Every published embassy/VFS checklist (e.g. `vfsglobal.com/.../Checklist_Tourist-EN-2025.pdf`,
Italy/UK tourist checklist, Malta/Switzerland one-pagers) follows the same shape:

1. **Header keys** — mission/application centre, visa category/purpose (tourism, business, visit
   family/friends, study, medical), applicant nationality/ residence. The *same* country publishes a
   **different checklist per purpose**, not just per visa class.
2. **Core mandatory block** — applies to everyone: application form (signed; minors by both
   parents), passport valid ≥3 months past return + issued within 10 years + 2 blank pages, ICAO
   photo, travel medical insurance ≥ €30,000 valid across Schengen for the whole stay, proof of
   accommodation, itinerary/flight, proof of funds (recent bank statements, often stamped),
   purpose cover letter.
3. **Conditional blocks keyed to the applicant's circumstances** — printed *inside one document*:
   - "If employed: employment letter, last 3–6 salary slips, approved leave"
   - "If self-employed: business registration, ITR, company financials"
   - "If student: school registration/student card, transcripts"
   - "If retired: pension proof, pension statements"
   - "If minor: birth certificate, parental consent, both parents' passport copies, custody order"
   - "If sponsored: sponsor's letter + sponsor's financials + relationship proof"
4. **Per-item rules stated inline** — copies ("2 copies", "original + photocopy"), recency ("bank
   statements last 3 months / 6 months"), format (size, language, translation requirement), and
   what is *not* accepted (e.g. "do not book non-refundable flights before the visa").
5. **Fee/step annex** — fee per age band (€90 adult / €45 child 6–12), biometrics, appointment.

Two properties matter operationally: requirements are **conditional and per-applicant**, and they
**change frequently** — every checklist carries a revision date and agencies are told to re-check
the mission's current list before submission.

## 2. How good visa CRMs structure it (industry practice)

- **Template library with versioning.** Checklist = versioned master keyed by destination +
  purpose/visa type (+ applicant circumstances). A new version supersedes the master; in-flight
  cases keep the requirements they were opened with. (Matches "version supersession; old cases
  stable" in our audit.)
- **Instantiation at case level.** Opening a case copies the template's items into per-applicant
  document records so collection, verification and expiry run per traveller.
- **Structured per-item metadata**, not just a name: required flag, quantity/copies, format
  constraints, validity/recency rule, whether expiry must be captured, whether manual verification
  is mandatory, applicability condition.
- **Collection through a client portal** with expiring upload links, status
  (requested → received → under review → accepted/rejected → re-upload), reminders chasing missing
  items, and rejection reasons — rather than email/WhatsApp attachments.
- **Readiness gate before submission:** no case may move to "submitted/ready" while a required
  item is missing, unverified, or has an expiry that doesn't cover the travel date.
- **Audit + ownership** on every requirement change; "last verified against the mission on DATE"
  discipline, because a stale checklist is worse than none.
- **Shareable output:** the checklist itself is sent to the client (printable/PDF/portal view), not
  only shown internally.

## 3. What Travel OS already does right

| Research point | Current implementation |
|---|---|
| Versioned master with supersession | `Checklist` unique on `(country, visaType, applicantType, version)`; save deactivates previous `active` version; case keeps its `ChecklistLink` (schema.prisma:215–256, `/api/checklists` POST) |
| Instantiation per applicant at case creation | `/api/visa/cases` copies items to `Document` rows per traveller, filtered by ALL/ADULT/MINOR |
| Per-item metadata | `required`, `instructions`, `fileTypes`, `maxSizeMb`, `needsExpiry`, `needsVerification`, `travellerType`, `sortOrder` |
| Readiness gate | `/api/visa/cases/[id]/stage` blocks READY_FOR_SUBMISSION+ until every required doc has file + accepted status + VERIFIED (where demanded) + expiry valid past travel date |
| Collection workflow | Portal upload links with expiry capture, re-upload queue for REJECTED, verification fields cleared on re-upload, notifications follow `visaCaseId` |
| Audit | `transactionAudit` on checklist save and stage changes |

## 4. Where the current design diverges from how it should be done

**Gap 1 — applicant type is a whole-checklist key, but official checklists put conditions inside one
list.** `Checklist.applicantType` is part of the unique key and one case binds exactly one
applicant type (`CaseTraveller.applicantType` defaults to the checklist's; known limitation in
implementation-progress.md). Real family cases mix salaried parents, a minor and a student in one
dossier — today that needs either several checklists or wrong docs for some travellers. Official
lists solve this with **conditional items**. *Fix direction:* keep the key as
`country + visaType (+ purpose)`, and give each **item** an applicability condition
(ALL / ADULT / MINOR / SALARIED / SELF_EMPLOYED / STUDENT / RETIRED / SPONSORED), keeping
`travellerType` as the age dimension.

**Gap 2 — no purpose dimension.** `visaType` is free text ("Tourist, business, student…"). Official
divergence is by *purpose* (tourism vs visit family vs business vs study for the same country).
*Fix direction:* either standardise `visaType` to a controlled vocabulary or add a `purpose` field
and match templates on it; recommend controlled vocabulary (small change, big consistency win).

**Gap 3 — missing per-item rules official lists always state.** No `copies` quantity, no recency
rule ("bank statement ≤ 3 months old"), no post-travel validity rule beyond `needsExpiry`
(> "passport valid 3 months past return"), no translation/format note separate from free-text
`instructions`. *Fix direction:* add `copies Int`, `validityDaysAfterTravel Int?`,
`issuedWithinMonths Int?` — the readiness gate can then check passport/statement recency too.

**Gap 4 — no provenance / review discipline.** Checklist has only free-text `notes`. Nothing records
*which mission list it came from* or *when it was last checked*, and no reminder to re-verify.
*Fix direction:* `sourceUrl` + `verifiedOn DateTime?` on `Checklist`, badge "verified 45 days ago →
re-check" in `/checklists`, optional task on overdue re-verification.

**Gap 5 — no grouping/sections.** Official lists separate "mandatory for all" / conditional /
purpose-specific / VAC-specific (appointment, biometrics, fee receipt). The UI renders one flat
list. *Fix direction:* a `section String?` on `ChecklistItem` rendered as groups in the case view
and portal.

**Gap 6 — manual template selection.** `/visa/new` asks the operator to pick a checklist from a
flat dropdown; nothing suggests one from destination + visa type, and nothing warns when the chosen
template's country ≠ typed destination. *Fix direction:* filter/suggest by destination+type and
warn on mismatch — cheap, prevents wrong-document dossiers.

**Gap 7 — checklist not client-shareable as a unit.** Clients see their own document rows in the
portal, but staff cannot send the destination's requirement list itself (with instructions) as one
print/WhatsApp artifact. *Fix direction:* printable checklist view + WhatsApp quick-reply token
`{checklist}` reusing the existing preview resolver.

**Gap 8 — no quantity/progress reporting per case.** The case view shows items; a single
"3 of 9 verified" progress figure and a missing-documents summary line would match how ops teams
actually work the queue. (Partially present via readiness gate error; should be visible before
a stage change is attempted.)

## 5. Recommended target shape (priority order)

1. **P0 — conditional items instead of per-case applicant type** (Gap 1): item-level applicability,
   case binds any active template once, gate filters per traveller. Removes the documented
   limitation and matches official structure.
2. **P0 — controlled `visaType`/purpose vocabulary** (Gap 2) so template matching is deterministic.
3. **P1 — `copies`, `validityDaysAfterTravel`, `issuedWithinMonths`, `section`** on items (Gaps
   3+5), enforced in the existing stage gate where computable.
4. **P1 — `sourceUrl` + `verifiedOn` provenance with staleness badge** (Gap 4).
5. **P1 — template suggestion + destination-mismatch warning on `/visa/new`** (Gap 6).
6. **P2 — shareable checklist artifact (print + WhatsApp token)** (Gap 7) and **per-case progress
   summary** (Gap 8).

Non-goals: ingesting embassy PDFs automatically (requirement pages change without notice; keep the
master human-curated, versioned, and audited — that is what the versioning machinery already
protects).

## 6. Reference: canonical core block for a Schengen tourist template

Use as the seed content when the agency configures its first checklist (already the documented
go-live step "configure visa checklists"):

1. Passport — valid ≥3 months after return, issued ≤10 years ago, ≥2 blank pages *(needsExpiry,
   validityDaysAfterTravel=90)*
2. Signed visa application form (minors: both parents)
3. ICAO-compliant photos ×2 *(copies=2)*
4. Travel medical insurance ≥ €30,000 covering the whole stay *(needsExpiry)*
5. Proof of accommodation + flight itinerary *(issuedWithinMonths=3 where re-confirmable)*
6. Bank statements, recent 3–6 months, stamped *(issuedWithinMonths=3)*
7. Cover letter / purpose of travel
8. Employment proof — *conditional:* employed → letter + salary slips; self-employed →
   registration + ITR; student → enrolment proof; retired → pension proof; minor → birth
   certificate + parental consent *(conditional blocks per Gap 1)*
9. Visa fee per age band + VFS appointment/biometrics receipt *(section: application centre)*
