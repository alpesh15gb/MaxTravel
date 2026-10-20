import { prisma } from "@/lib/db";
import { requirePage, scopeWhere } from "@/lib/guard";
import { can } from "@/lib/rbac";
import DocumentsClient from "./DocumentsClient";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const user = await requirePage("document:view");
  const { focus } = await searchParams;

  const where = { customer: { is: scopeWhere(user, null, undefined, "assignedToId") } };
  const include = {
    customer: { select: { name: true, code: true } },
    traveller: { select: { fullName: true } },
    visaCase: { select: { caseNo: true, id: true } },
    verifiedBy: { select: { name: true } },
  } as const;
  const [documents, focusedDocument] = await Promise.all([
    prisma.document.findMany({ where, include, orderBy: { createdAt: "desc" }, take: 400 }),
    focus ? prisma.document.findFirst({ where: { AND: [where, { id: focus }] }, include }) : Promise.resolve(null),
  ]);
  if (focusedDocument && !documents.some(document => document.id === focusedDocument.id)) documents.unshift(focusedDocument);

  return (
    <DocumentsClient
      canAudit={user.permissions.includes("audit:view")}
      documents={documents.map((d) => ({
        id: d.id, docNo: d.docNo, docType: d.docType, status: d.status,
        customer: d.customer.name, customerId: d.customerId, customerCode: d.customer.code,
        traveller: d.traveller?.fullName ?? null,
        visaCase: d.visaCase?.caseNo ?? null, visaCaseId: d.visaCase?.id ?? null,
        uploadedAt: d.uploadedAt?.toISOString() ?? null, uploadSource: d.uploadSource,
        verificationStatus: d.verificationStatus, verifiedBy: d.verifiedBy?.name ?? null,
        expiryDate: d.expiryDate?.toISOString() ?? null,
        rejectionReason: d.rejectionReason, hasFile: !!d.storagePath, version: d.version,
        // Warnings can quote identity details (e.g. the passport name in a mismatch), so they
        // follow the same sensitive:view rule as the extraction data on the case page.
        warnings: can(user.permissions, "sensitive:view") && d.warnings ? JSON.parse(d.warnings) : [],
      }))}
      focus={focus ?? null}
      canExport={can(user.permissions, "export:data")}
      perms={{
        verify: can(user.permissions, "document:verify"),
        upload: can(user.permissions, "document:upload"),
      }}
    />
  );
}
