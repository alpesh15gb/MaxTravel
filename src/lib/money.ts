// Rupee amounts with Indian digit grouping (₹12,34,567.5), built without ICU so that the server and the
// browser print exactly the same text.

/** 1234567 -> "12,34,567" */
function groupIndian(whole: string) {
  if (whole.length <= 3) return whole;
  const last = whole.slice(-3);
  const rest = whole.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last}`;
}

function formatInr(value: number, fixed: boolean) {
  const [whole, decimals = ""] = Math.abs(value).toFixed(2).split(".");
  const fraction = fixed ? decimals : decimals.replace(/0+$/, "");
  return `${value < 0 ? "-" : ""}₹${groupIndian(whole)}${fraction ? `.${fraction}` : ""}`;
}

/** Up to two decimals: ₹1,234 · ₹1,234.5 · ₹12,34,567.25. "—" when there is no amount. */
export function inrAmount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatInr(value, false);
}

/** Always two decimals, for ledgers and settlements: ₹1,234.00. */
export function inrFixed(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatInr(value, true);
}
