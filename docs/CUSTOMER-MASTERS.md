# Customer and traveller Masters

Research sources (reviewed 3 November 2026):
- Travelport traveller profiles: https://support.travelport.com/webhelp/uapi/Content/Profiles/Profile_Create_Traveler.htm
- Travelport profile retrieval and loyalty/document groups: https://support.travelport.com/webhelp/uapi/Content/Profiles/Profile_Retrieve.htm
- Brex traveller profiles: https://www.brex.com/support/managing-brex-travel

These primary sources distinguish account/contact information, individual traveller identity, preferences, loyalty memberships and travel documents. The implementation below is MaxTravel's field and workflow design based on those patterns. A membership belongs to a traveller and a program; it is not one free-text value on the customer. A program can cover more than one airline. Saved memberships are not all submitted automatically or guaranteed eligible for every flight.

| Area | Fields / records |
| --- | --- |
| Customer core | Customer number, person/company/sub-agent, name, status, primary mobile, email, city, address, legal company name and GSTIN |
| Contact / address | Alternate phone, secondary email, address line 2, state/province, postal code, country |
| Billing / corporate | Billing name/address/city/state/postal code/country, company contact, department, cost centre, purchase-order reference |
| Relationship | Customer source, preferred language/contact method, service interests and contact instructions; messaging consent remains separate |
| Traveller core | Full travel-ID name, relationship, birth date, gender, nationality and optional Known Traveller Number |
| Traveller identity / corporate | Title, passport given names/surname, birth place, residence country, own phone/email, corporate employee number/department/cost centre |
| Emergency contact | Name, relationship, phone and email; name and phone are validated together |
| Air preferences | Home-airport IATA, cabin, seat, meal, airline preferences and optional restricted redress number |
| Other preferences | Hotel bed/room/smoking preference, rail berth, bus seat, optional restricted assistance notes and other preference notes |
| Repeated loyalty memberships | Category (airline/hotel/rail/car rental/other), provider, program, member number, member name, tier, optional expiry, eligible airline-code list, preferred account within that program |
| Repeated travel documents | Passport/visa/national ID/residence permit/driving licence/other; number, issuing-country code, nationality, issue/expiry dates, issuing place, visa type/entries, primary-passport flag and linked uploaded file |
| Manual document library | Staff-authenticated PDF/JPG/PNG upload, traveller or company scope, type, expiry, notes, actual actor/time, pending verification and existing secure-file access/review |
| Audit | Actor, action, timestamp, subject and changed field names; membership/passport values are excluded. Protected profile reads and signed document opens are recorded. |

Only relevant core fields are required. Editors separate basics, contacts, emergency information and preferences. No card numbers/CVV, passwords or compulsory national-ID collection are introduced. Existing free-text frequent-flyer data is shown as legacy data for review; issuer/program affiliations are never guessed. Existing passport scalars stay available and are synchronized when a structured primary passport is selected. Multiple passports and historic expired documents can coexist. Existing booking references and historical tax snapshots are preserved.

Customer/traveller extra profiles and membership/document numbers use authenticated encryption with entity-specific contexts and the existing stable CRM key. Duplicate-number matching uses a keyed digest. Membership and document rows are scoped to the correct traveller/customer; linked files must belong to that same traveller. Restricted staff receive masked identifiers and cannot write back masked values. All writes require the current revision and an actor-bound idempotency key. Lost acknowledgements can retry the same payload; changed records reject stale overwrites.

Changing a primary customer phone revokes its stored WhatsApp opt-in; contact preference is not consent. New tax-invoice snapshots use the configured master billing details without changing already issued snapshots. Import undo is blocked once master data is enriched. CRM reset tools account for the new linked records while retaining logins/settings/key material.

The left navigation contains Masters, Bookings, Tasks & follow-ups, Suppliers and Reporting. Team/access, agency settings, imports and global audit remain under the account menu. Existing URLs continue to work; new Masters uses `/masters` and `/masters/:id`.

Corporate/sub-agent creation captures its company name and optional GSTIN. Individual accounts may create their primary traveller; company accounts do not invent a traveller from the company name. Customer creation and later profile saves retain an in-memory request reference for explicit retries after an uncertain response. Editors also bind requests to the current authenticated session/access context; switching staff sessions rejects an old editor before it can submit private changes.

Verification uses committed migrations against disposable SQLite, including an actual upgrade preserving legacy customer/traveller values. Migration-diff comparison checks that these changes add no drift; the later visa-payables migration additionally aligns the existing SupplierDue booking foreign key; unrelated WhatsAppMessage and InvoiceCreditNote drift is retained. PostgreSQL models are checked for parity and schema validity; no PostgreSQL server upgrade or live provider call is claimed by these tests.
