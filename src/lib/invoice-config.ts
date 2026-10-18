import { z } from "zod";

const componentSchema = z.object({
  label: z.string().trim().min(1).max(48),
  ratePercent: z.number().finite().min(0).max(100).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.000001, "Use up to two decimal places."),
});

const profileSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  components: z.array(componentSchema).min(1).max(5),
});

export const invoiceConfigSchema = z.object({
  mode: z.enum(["OPERATIONAL_ONLY", "OPERATIONAL_AND_TAX"]),
  issuerName: z.string().trim().max(120),
  gstin: z.string().trim().toUpperCase().max(15),
  address: z.string().trim().max(300),
  state: z.string().trim().max(80),
  placeOfSupply: z.string().trim().max(80),
  documentTitle: z.string().trim().min(1).max(80),
  footer: z.string().trim().max(1000),
  accountantApproved: z.boolean(),
  profiles: z.array(profileSchema).max(8),
});

export type InvoiceConfig = z.infer<typeof invoiceConfigSchema>;
export type InvoiceTaxProfile = InvoiceConfig["profiles"][number];

export const DEFAULT_INVOICE_CONFIG: InvoiceConfig = {
  mode: "OPERATIONAL_ONLY",
  issuerName: "",
  gstin: "",
  address: "",
  state: "",
  placeOfSupply: "",
  documentTitle: "Tax Invoice",
  footer: "",
  accountantApproved: false,
  profiles: [],
};

export function parseInvoiceConfig(value: unknown): InvoiceConfig {
  return invoiceConfigSchema.parse(value);
}

export function readInvoiceConfig(serialized: string | undefined): InvoiceConfig {
  if (!serialized) return DEFAULT_INVOICE_CONFIG;
  try {
    return parseInvoiceConfig(JSON.parse(serialized));
  } catch {
    return DEFAULT_INVOICE_CONFIG;
  }
}

export function validateTaxInvoiceConfiguration(config: InvoiceConfig): string | null {
  if (config.mode !== "OPERATIONAL_AND_TAX") return null;
  if (!config.accountantApproved) return "Enable tax invoices only after your accountant has approved the tax setup.";
  if (config.issuerName.length < 2 || !/^[0-9A-Z]{15}$/.test(config.gstin)) return "Enter the legal issuer name and a 15-character GSTIN.";
  if (config.address.length < 3 || config.state.length < 2 || config.placeOfSupply.length < 2) return "Enter the issuer address, state and default place of supply.";
  if (!config.profiles.length) return "Add at least one accountant-approved tax profile.";
  if (new Set(config.profiles.map((profile) => profile.id)).size !== config.profiles.length) return "Tax profile IDs must be unique.";
  return null;
}

export type InvoiceTaxSnapshot = {
  version: 1;
  title: string;
  issuer: { name: string; gstin: string; address: string; state: string };
  buyer: { name: string; companyName: string | null; gstin: string | null; address: string | null; city: string; state: string };
  profile: { id: string; label: string };
  placeOfSupply: string;
  sac: string | null;
  description: string;
  subtotalMinor: number;
  components: Array<{ label: string; rateBasisPoints: number; amountMinor: number }>;
  taxMinor: number;
  totalMinor: number;
  footer: string;
};

export function buildInvoiceTaxSnapshot(input: {
  config: InvoiceConfig;
  profile: InvoiceTaxProfile;
  subtotalMinor: number;
  description: string;
  buyer: InvoiceTaxSnapshot["buyer"];
  placeOfSupply?: string | null;
  sac?: string | null;
}): InvoiceTaxSnapshot {
  const components = input.profile.components.map((component) => {
    const rateBasisPoints = Math.round(component.ratePercent * 100);
    return {
      label: component.label,
      rateBasisPoints,
      amountMinor: Math.round((input.subtotalMinor * rateBasisPoints) / 10000),
    };
  });
  const taxMinor = components.reduce((total, component) => total + component.amountMinor, 0);
  const totalMinor = input.subtotalMinor + taxMinor;
  if (![input.subtotalMinor, taxMinor, totalMinor].every(Number.isSafeInteger)) throw new Error("Invoice total exceeds the supported exact amount range.");
  return {
    version: 1,
    title: input.config.documentTitle,
    issuer: { name: input.config.issuerName, gstin: input.config.gstin, address: input.config.address, state: input.config.state },
    buyer: input.buyer,
    profile: { id: input.profile.id, label: input.profile.label },
    placeOfSupply: input.placeOfSupply?.trim() || input.config.placeOfSupply,
    sac: input.sac?.trim() || null,
    description: input.description,
    subtotalMinor: input.subtotalMinor,
    components,
    taxMinor,
    totalMinor,
    footer: input.config.footer,
  };
}

export function readInvoiceTaxSnapshot(serialized: string | null): InvoiceTaxSnapshot | null {
  if (!serialized) return null;
  try {
    const value = JSON.parse(serialized) as InvoiceTaxSnapshot;
    if (value.version !== 1 || !Number.isSafeInteger(value.totalMinor) || !Array.isArray(value.components)) return null;
    return value;
  } catch {
    return null;
  }
}
