// Turns a stored enum value into a readable label: "PAYMENT_AWAITED" -> "Payment awaited",
// "PNR_CREATED" -> "PNR created", "high" -> "High". Keeps known acronyms in capitals.

const ACRONYMS = new Set(["PNR", "UPI", "GST", "KYC", "ID"]);

export function enumLabel(value: string | null | undefined) {
  if (!value) return "—";
  return value
    .split("_")
    .filter(Boolean)
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower.toUpperCase())) return lower.toUpperCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}
