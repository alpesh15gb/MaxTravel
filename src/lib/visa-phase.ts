export const VISA_PHASES = [
  { id: "enquiry", title: "Enquiry & assessment", dot: "bg-sky-500", keys: ["ENQUIRY", "ASSESSMENT", "PAYMENT_AWAITED"] },
  { id: "documents", title: "Documents", dot: "bg-amber-500", keys: ["DOCUMENTS_PENDING", "DOCUMENTS_VERIFICATION", "READY_FOR_SUBMISSION"] },
  { id: "submission", title: "Appointment & submission", dot: "bg-violet-500", keys: ["APPOINTMENT_REQUIRED", "APPOINTMENT_BOOKED", "SUBMITTED", "BIOMETRICS", "UNDER_PROCESS"] },
  { id: "decision", title: "Decision & delivery", dot: "bg-emerald-500", keys: ["APPROVED", "REJECTED", "PASSPORT_RECEIVED", "DELIVERED", "CLOSED"] },
];

export function visaPhase(stage: { key: string; seq: number }, stages: { key: string; seq: number }[]) {
  const direct = VISA_PHASES.find(phase => phase.keys.includes(stage.key));
  if (direct) return direct;
  for (const prior of stages.filter(s => s.seq < stage.seq).sort((a, b) => b.seq - a.seq)) {
    const phase = VISA_PHASES.find(p => p.keys.includes(prior.key));
    if (phase) return phase;
  }
  return VISA_PHASES[0];
}
