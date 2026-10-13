// Quick-reply templates live in two places by design:
// - `QUICK_REPLY_DEFAULTS` below: the built-in copy every workspace gets, even before any
//   template row exists in the database.
// - the `QuickReply` table: per-agency overrides/additions (same key wins over the default).
//
// Placeholders ({customer}, {outstanding}, {ref}, {pnr}, {deadline}, {case}, {docs}, {stage},
// {uploadLink}, {date}, {agency}) are substituted server-side in /api/whatsapp/send. The inbox
// inserts the body as editable draft text, so any placeholder the server cannot fill stays visible
// for the employee to complete before logging.

export interface QuickReplyDefault {
  key: string;
  title: string;
  body: string;
}

export const QUICK_REPLY_DEFAULTS: QuickReplyDefault[] = [
  {
    key: "PAYMENT_REMINDER",
    title: "Payment reminder",
    body: "Hello {customer}, a balance of {outstanding} is pending for {ref}. Please contact {agency} if you need any help.",
  },
  {
    key: "PNR_EXPIRY",
    title: "Ticketing deadline",
    body: "Hello {customer}, the ticketing deadline for {pnr} is {deadline}. Please contact {agency} to confirm the next step.",
  },
  {
    key: "DOC_REQUEST",
    title: "Document request",
    body: "Hello {customer},\n\n*Documents required*\nVisa case: *{case}*\n\nPlease upload the following outstanding documents:\n\n{docs}\n\n*Private upload link*\n{uploadLink}\n\n*Link expires:* {uploadExpiry}\n\nPlease keep this link private.\nFor help, contact {agency}.",
  },
  {
    key: "STATUS_UPDATE",
    title: "Status update",
    body: "Hello {customer}, your case {case} is at {stage}. — {agency}",
  },
  {
    key: "APPOINTMENT_REMINDER",
    title: "Appointment reminder",
    body: "Hello {customer}, please check your appointment details for {case} with {agency}. {date}",
  },
];

/** Built-in copy keyed by template key, for the send path. */
export const DEFAULT_COPY: Record<string, string> = Object.fromEntries(
  QUICK_REPLY_DEFAULTS.map((t) => [t.key, t.body]),
);
