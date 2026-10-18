import { ApiError, jsonError, requireSession } from "@/lib/guard";
import { boundedJson } from "@/lib/bounded-json";
import { prisma } from "@/lib/db";
import { transactionAudit } from "@/lib/transactions";
import { invoiceConfigSchema, validateTaxInvoiceConfiguration } from "@/lib/invoice-config";

export async function POST(request: Request) {
  try {
    const user = await requireSession("settings:manage");
    const body = await boundedJson(request);
    const parsed = invoiceConfigSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Review the invoice settings.");
    const config = parsed.data;
    const validation = validateTaxInvoiceConfiguration(config);
    if (validation) throw new ApiError(400, validation);

    await prisma.$transaction(async (tx) => {
      await tx.settings.upsert({ where: { key: "invoice.configuration" }, create: { key: "invoice.configuration", value: JSON.stringify(config) }, update: { value: JSON.stringify(config) } });
      await transactionAudit(tx, user, "UPDATE", "Settings", "invoice.configuration", "Invoice and tax configuration changed; issued invoice snapshots remain unchanged.");
    });
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
