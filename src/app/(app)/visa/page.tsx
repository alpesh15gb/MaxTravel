import { inrAmount } from "@/lib/money";
import { dateLabel } from "@/lib/dates";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePage, scopeWhere } from "@/lib/guard";
import { PageHeader, EmptyState } from "@/components/ui";
import Icon from "@/components/Icon";
import VisaPipeline, { type PipelineCase, type PipelineStage } from "./VisaPipeline";

export const dynamic = "force-dynamic";

// Same document states the stage gate accepts as "on file"; a case is ready only when these are also verified.
const ON_FILE_STATUSES = ["RECEIVED", "UNDER_REVIEW", "ACCEPTED", "SUBMITTED"];
const DAY_MS = 86_400_000;
// Dates and money are formatted here, on the server, so the browser renders exactly what was sent.

export default async function VisaPage({ searchParams: pending }: { searchParams: Promise<{ q?: string; stage?: string }> }) {
  const searchParams = await pending;
  const user = await requirePage("visa:view");
  const [rows, stages] = await Promise.all([
    prisma.visaCase.findMany({
      where: scopeWhere(user, null, "ownerId"),
      include: {
        serviceCase:{select:{caseNo:true}},
        customer: { select: { name: true, phone: true, email: true } },
        stage: true,
        owner: { select: { name: true } },
        travellers: { include: { traveller: { select: { fullName: true } } } },
        documents: { select: { status: true, verificationStatus: true, storagePath: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.visaStage.findMany({ where: { active: true }, orderBy: { seq: "asc" } }),
  ]);

  const canFinance = user.permissions.includes("payment:view");
  const now = Date.now();
  const cases: PipelineCase[] = rows.map(v => {
    const docs = v.documents.filter(d => d.status !== "ARCHIVED");
    const balance = v.sellingPrice - v.amountReceived;
    return {
      id: v.id,
      caseNo: v.caseNo,
      serviceCaseNo:v.serviceCase?.caseNo??null,
      customerId: v.customerId,
      customerName: v.customer.name,
      phone: v.customer.phone,
      email: v.customer.email,
      travellers: v.travellers.map(t => t.traveller.fullName),
      destination: v.destination,
      visaType: v.visaType,
      stageId: v.stage.id,
      stageKey: v.stage.key,
      stageName: v.stage.name,
      stageSeq: v.stage.seq,
      createdAt: v.createdAt.toISOString(),
      createdLabel: dateLabel(v.createdAt),
      travelDate: v.travelDate?.toISOString() ?? null,
      travelLabel: v.travelDate ? dateLabel(v.travelDate) : null,
      travelInDays: v.travelDate ? Math.ceil((v.travelDate.getTime() - now) / DAY_MS) : null,
      ownerName: v.owner.name,
      docsTotal: docs.length,
      docsReady: docs.filter(d => d.storagePath && ON_FILE_STATUSES.includes(d.status) && d.verificationStatus === "VERIFIED").length,
      // Balances are never sent to roles without payment visibility.
      balance: canFinance ? balance : null,
      balanceLabel: canFinance ? `${inrAmount(balance)}` : null,
    };
  });
  const pipelineStages: PipelineStage[] = stages.map(s => ({ id: s.id, key: s.key, name: s.name, seq: s.seq }));
  const canCreate = user.permissions.includes("visa:create");
  const canExport = user.permissions.includes("export:data");

  return <div className="workspace-page">
    <PageHeader
      title="Visa cases"
      description="Track applicants, destination requirements, documents and stages."
      actions={<>
        {canExport && <a className="btn-secondary" href="/api/export?entity=visa"><Icon name="download" size={16} />Export</a>}
        {canCreate && <Link href="/visa/new" className="btn-primary"><Icon name="plus" size={16} />New visa case</Link>}
      </>} />
    {!cases.length
      ? <EmptyState icon="visa" title="No visa cases yet" description="Add a real customer, select their applicants and choose the right destination checklist." href={canCreate ? "/visa/new" : undefined} action={canCreate ? "Start a visa case" : undefined} />
      : <VisaPipeline
          cases={cases}
          stages={pipelineStages}
          perms={{ canMove: user.permissions.includes("visa:edit"), canApprove: user.permissions.includes("visa:approve"), canFinance, canExport, canCreate }}
          initialQuery={searchParams.q ?? ""}
          initialStage={searchParams.stage ?? ""} />}
  </div>;
}
