# Travel Master completion

Customer intake stays short. PAN and Aadhaar remain optional. Payer PAN is encrypted in the billing profile, separate from traveller identity, with sensitive-role access and audit. Document forms hide irrelevant expiry fields. Aadhaar stores four digits; uploads require staff confirmation of masking, retained in audit and document metadata. Only a confirmed masked copy can be linked to an Aadhaar identity. This is manual review, not automatic OCR or pixel redaction.

Minors link to an adult guardian from the same customer. Received consent needs a child-owned uploaded file; trip checks require verified consent when applicable. Visa records distinguish issuing country from country/region coverage, valid-from date, expiry, entries and permitted stay. Expired documents remain available as history.

Check a trip, under Max IDs & bookings, reviews selected travellers against staff-entered destination/region codes, travel dates, passport validity months, visa requirements and minor consent. Staff record the current airline/embassy guidance used; transit countries are checked separately. The review is audited. This is IATA-informed profile design, not a licensed Timatic integration or immigration clearance. Sources: [IATA passenger data](https://www.iata.org/en/programs/passenger/passenger-facilitation/passenger-data/) and [IATA Travel Centre](https://www.iata.org/en/travel-centre).

Flight entry offers eligible saved memberships by airline code and date. Staff choose one per traveller. Ownership and expiry are checked again on save. Program and masked reference are recorded on the booking; supplier submission/enrolment remains separate. Reviewed passport validity is enforced before confirmation and replacement issuance, and retained during rescheduling.

Additive SQLite/PostgreSQL migrations preserve existing records. Tests use disposable data and cover roles, encryption, guardian/consent scope, dates, masked uploads, membership eligibility and admin/staff browser journeys. They initiate no real customer email, payment or supplier operation.

Verified locally: production build/typecheck, lint, PostgreSQL schema validation, populated SQLite upgrade, 32 Master integration groups, 8 new admin/staff UI groups, 12 existing Master UI groups, 12 agency transaction groups, 6 case-workflow groups/48 screenshots, reporting suite and accessibility gate (zero findings). Test records were synthetic. No VPS rollout or live airline/payment operation is claimed.
