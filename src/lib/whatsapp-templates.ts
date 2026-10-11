export const PAYMENT_TEMPLATE_KEY = "whatsapp.template.PAYMENT_RECEIVED";
export const PAYMENT_TOKENS = ["customer", "agency", "amount", "mode", "reference", "receipt", "date", "balance", "balanceReference"] as const;
export const DEFAULT_PAYMENT_TEMPLATE = "Hello {customer}, {agency} has recorded your payment of {amount} by {mode} for {reference}. Receipt: {receipt}. Recorded on {date}. Remaining balance for {balanceReference} after this payment: {balance}. Thank you.";
export const PAYMENT_PREVIEW = { customer: "Alpesh", agency: "Max Travel", amount: "₹500", mode: "UPI", reference: "BK-2026-0001", receipt: "RCP-2026-0004", date: "12 Oct 2026, 2:44 am", balance: "₹1,500", balanceReference: "BK-2026-0001" };
export function paymentTemplateError(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 2500) return "Enter a message between 1 and 2,500 characters.";
  const remaining = value.replace(/\{([a-zA-Z]+)\}/g, (_, key) => PAYMENT_TOKENS.includes(key) ? "" : `{${key}}`);
  if (/[{}]/.test(remaining)) return "Use only the listed placeholders in braces.";
  if (["amount", "receipt", "balance", "balanceReference"].some(key => !value.includes(`{${key}}`))) return "Keep {amount}, {receipt}, {balance} and {balanceReference} so the payment and balance remain clear.";
  return null;
}
export function renderPaymentTemplate(template: string, values: Record<typeof PAYMENT_TOKENS[number], string>) {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_, key: typeof PAYMENT_TOKENS[number]) => values[key]);
}
