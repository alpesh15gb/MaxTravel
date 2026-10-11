# Transaction flows — visual usability review

**Date:** 7 October 2026
**Method:** Driven by hand in a real Chromium browser (clicks, typing, native date pickers) against an
**isolated instance** on `127.0.0.1:3211` using the regression suite's saved fixture database.
The live workspace on `:3210` was never touched — it still has **0 users and 0 records**.
**Verdict:** the transaction flows are **easy**. One flow is outstanding, and three real defects
surfaced that automated checks do not catch.

> **Status (7 October 2026):** all three defects in §3 and the §4 friction points are **fixed and
> re-verified**; a further money-coherence bug was found and fixed during verification. See
> [production-readiness.md](production-readiness.md) for the changes, evidence and remaining gaps.

---

## 1. Headline result

| Flow | Steps taken | Difficulty | Notes |
|---|---|---|---|
| Create customer | 3 (name, phone, create) | **Very easy** | Only 2 required fields; lands straight in Customer 360 |
| Create booking | 6 | **Easy** | Customer pre-filled; live selling-price total |
| Record payment (fresh) | 4 | **Easy** | Allocation list auto-scoped to the customer |
| Record payment (from invoice) | **2** | **Outstanding** | "Collect" pre-fills everything; only the amount is typed |
| Create invoice | 4 | **Easy** | Live invoice → receivables updated instantly |
| Create visa case | 5 | **Easy** | 16-stage workflow, money panel, key dates |
| Advance visa stage | 1 | **Very easy** | Timeline logs actor + timestamp automatically |
| Request refund | n/a (read) | **Easy** | Full supplier pipeline shown with dates |
| Upload documents (customer side) | 1 | **Very easy** | No account needed; per-traveller slots; progress bar |

Nothing required help, documentation, or a second attempt except where noted in §4.

---

## 2. What felt genuinely good

1. **Context carry-through.** Clicking *Create Ticket Booking* from a customer navigates to
   `/ticketing/new?customer=<id>` with the customer already selected and the passenger listed.
   No re-picking the customer — this is the single biggest time-saver.
2. **"Collect" on an unpaid invoice.** One click opens the payment dialog with customer, allocation
   and outstanding balance already filled. Only the amount needs typing. This is the best-designed
   interaction in the app.
3. **Guarded allocation, not just validated.** The *Allocate to* dropdown is **disabled** until a
   customer is chosen, then shows only that customer's open records — and displays them as
   readable references (`BK-2026-0002 · BOM → DXB`), never internal IDs.
4. **Overpayment is impossible.** Entering `999999` against a ₹53,000 balance was blocked with
   *"Value must be less than or equal to 53000"*, and the dialog showed
   *"Outstanding balance on the linked record ₹53,000.00"* as a running hint.
5. **Honest copy throughout.** "Record only money already received… No payment is charged here.",
   "No ticket records yet. Enter the actual airline-issued ticket numbers; this app does not issue
   tickets.", "No money is transferred by this app." Nothing overclaims.
6. **Readable business references everywhere** — `C-2026-0003`, `BK-2026-0002`, `INV-2026-0002`,
   `RCP-2026-0005`, `VC-2026-0002` — allocated sequentially and shown in full.
7. **Errors are specific and inline.** Submitting the visa form without an applicant produced
   *"Select at least one traveller."* in a red panel beside the button, not a generic failure.
8. **The public upload portal needs no account**, shows progress ("1 of 2 documents received, 50%")
   per traveller, and states *"Receipt does not mean approval. WhatsApp confirmation is not
   automatic."*

---

## 3. Defects found

### 3.1 — React hydration error on every dashboard load (real bug, fully isolated)

Loading `/dashboard` **always** throws two errors in the browser console:

```
Error: Minified React error #425   (text content does not match server-rendered HTML)
Error: Minified React error #422   (hydration failed — server HTML didn't match the client)
```

**Root cause, proven by direct comparison.** The dashboard date chip calls
`new Date().toLocaleDateString("en-IN", {weekday:"short",day:"numeric",month:"long"})` in a
`"use client"` component, so it runs on both the server and the client. Node and Chromium ship
**different ICU data for `en-IN`** and disagree about one comma:

| Format | Node (server) | Chromium (client) | Match |
|---|---|---|---|
| `{weekday:"short",day:"numeric",month:"long"}` | `Wed, 7 October` | `Wed 7 October` | ❌ **mismatch** |
| `{day:"2-digit",month:"short",year:"numeric"}` | `07 Oct 2026` | `07 Oct 2026` | ✅ |
| default | `7/10/2026` | `7/10/2026` | ✅ |
| `toLocaleTimeString("en-IN")` | `5:30:00 pm` | `5:30:00 pm` | ✅ |

Server HTML literally contains `Wed, 7 October`; the hydrated DOM contains `Wed 7 October`.
Only **one** format is affected and it appears in **one** place, which is why only `/dashboard`
errors. Every other page loaded clean.

**Impact:** low severity, high visibility. React recovers by re-rendering that subtree, so the date
still looks right — but it logs an error on every load, can flash, and masks future genuine
hydration bugs.

**Suggested fix:** avoid locale-dependent formatting in a component that renders on both sides —
format on the server and pass the string down, gate it behind `useEffect` mount state, or use a
fixed formatter (an explicit weekday/month table) instead of relying on ICU parity.

### 3.2 — "Receivables" ignores money owed on bookings and visa cases

The dashboard showed **Receivables ₹0** at the same moment that:

- booking `BK-2026-0002` had **₹8,000** outstanding (₹53,000 − ₹20,000 direct − ₹25,000 via linked invoice), and
- visa case `VC-2026-0002` showed **Outstanding ₹6,000** in its own money panel.

So **₹14,000 of genuinely owed money was invisible** on the landing page.

Confirmed in source — the definition counts invoices only, in both places:

```
src/lib/pulse.ts:66                 receivable = invoices.filter(status!=="PAID").reduce(amount - amountPaid)
payments/PaymentsClient.tsx:15      out = open.reduce(...)   // open = invoices.filter(status!=="PAID")
```

An agency that takes a deposit on a booking and never raises an invoice would be told it is owed
nothing. **This is the most commercially significant finding.** Either include unpaid booking and
visa balances, or relabel the tile (e.g. "Uninvoiced balances") so the number is not misread as
total money owed.

### 3.3 — "Margin" reports the full selling price as profit

Booking `BK-2026-0002` displayed **Margin ₹53,000** — the entire selling price — because it is
computed as `sellingPrice − supplierCost` and supplier cost defaults to `0`:

```
ticketing/[id]/BookingView.tsx:227   <KV k="Margin" v={money(b.sellingPrice - b.supplierCost)} />
```

Until someone fills in the collapsed *Supplier, source & flight details*, an agency could read
₹53,000 as pure profit when the real margin is the ₹3,000 markup. Consider defaulting the label to
something like "Margin (set supplier cost)" while cost is zero, or computing margin from
markup + service fee.

---

## 4. Smaller friction points

- **Native date inputs.** Dates render as `dd-mm-yyyy` but a user can enter an ambiguous
  `15-12-2026`. Automation had to write ISO; a human uses the segment spinner. Acceptable, but a
  visible `DD-MM-YYYY` hint would remove doubt.
- **Workflow chips look clickable but are not.** The 16 stage chips on the visa dossier read as
  buttons; the real control is the dropdown in the header. The chips correctly highlight the
  current stage, so this is a mild affordance mismatch — making them clickable would be a natural win.
- **Number inputs accept raw text.** `999999` entered cleanly and was caught only on submit by
  native validation. Inline rejection as you type would be friendlier.
- **`collect` deep-link URL is internal.** `/payments?action=record&customer=<id>&invoice=<id>`
  works perfectly, but is not shareable/bookmarkable in a meaningful way.
- **Receipts are correctly linked.** Paying a linked invoice also credited the booking
  (₹20,000 + ₹25,000 → ₹8,000 remaining), which is coherent — worth documenting so it is not
  mistaken for a double-count.

---

## 5. Verification environment

- Server: `next start` on `127.0.0.1:3211`, fixture DB `tests/.runtime/run-1791326985955/test.db`
- Created live during the review: customer `C-2026-0003`, booking `BK-2026-0002`,
  invoice `INV-2026-0002`, receipts `RCP-2026-0004`/`RCP-2026-0005`, visa case `VC-2026-0002`
- Console: clean on every page **except** `/dashboard` (§3.1)
- Network: all assets 200; no failed requests
- Live workspace on `:3210`: untouched (0 users, 0 records)

## 6. Recommended priority

1. **§3.2 Receivables definition** — silent under-reporting of owed money.
2. **§3.1 Dashboard hydration error** — errors on every load; small, well-isolated fix.
3. **§3.3 Margin label** — misleading profitability at a glance.
4. §4 polish, especially making the workflow chips clickable.
