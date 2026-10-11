import type { Prisma } from "@prisma/client";

export const ROLE_DEFINITIONS = [
  ["SUPER_ADMIN", "Super Admin", "Full system access"],
  ["OWNER", "Owner / Director", "Agency, team and finance management"],
  ["BRANCH_MANAGER", "Branch Manager", "Branch-wide access"],
  ["VISA_MANAGER", "Visa Manager", "Visa desk management"],
  ["VISA_EXECUTIVE", "Visa Executive", "Assigned visa cases"],
  ["TICKETING_MANAGER", "Ticketing Manager", "Ticketing desk management"],
  ["TICKETING_EXECUTIVE", "Ticketing Executive", "Assigned bookings"],
  ["SALES_EXECUTIVE", "Sales Executive", "Assigned customer relationships"],
  ["ACCOUNTS", "Accounts", "Payments, invoices and refunds"],
  ["HR", "HR", "Employee and HR administration"],
  ["OPERATIONS", "Operations", "Branch operations support"],
  ["READ_ONLY", "Read Only / Auditor", "Read-only operational access"],
] as const;

export const STAGE_DEFINITIONS = [
  ["ENQUIRY", "Enquiry"], ["ASSESSMENT", "Assessment"], ["PAYMENT_AWAITED", "Payment awaited"],
  ["DOCUMENTS_PENDING", "Documents pending"], ["DOCUMENTS_VERIFICATION", "Document review"],
  ["READY_FOR_SUBMISSION", "Ready for submission"], ["APPOINTMENT_REQUIRED", "Appointment required"],
  ["APPOINTMENT_BOOKED", "Appointment booked"], ["SUBMITTED", "Submitted"],
  ["BIOMETRICS", "Biometrics / interview"], ["UNDER_PROCESS", "Under process"],
  ["APPROVED", "Approved"], ["REJECTED", "Rejected"], ["PASSPORT_RECEIVED", "Passport received"],
  ["DELIVERED", "Delivered"], ["CLOSED", "Closed"],
] as const;

export async function initializeReferenceData(tx: Prisma.TransactionClient) {
  for (const [key, name, desc] of ROLE_DEFINITIONS) {
    await tx.role.upsert({ where: { key }, update: {}, create: { key, name, desc } });
  }
  for (let index = 0; index < STAGE_DEFINITIONS.length; index++) {
    const [key, name] = STAGE_DEFINITIONS[index];
    await tx.visaStage.upsert({ where: { key }, update: {}, create: { key, name, seq: index + 1, system: true } });
  }
}
