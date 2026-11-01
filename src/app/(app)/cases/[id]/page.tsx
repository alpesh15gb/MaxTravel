import { taskScope } from "@/lib/work-engine";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePage, ApiError, canTouchRecord } from "@/lib/guard";
import {
  CASE_READ,
  caseFor,
  canEditCase,
  canAssignCase,
  childWorkScope,
  roleCanOwnCase,
} from "@/lib/service-cases";
import { readWork } from "@/lib/work-read";
import { PageHeader, Status, EmptyState } from "@/components/ui";
import CaseConversation from "@/components/CaseConversation";
import WorkDesk from "@/components/WorkDesk";
import { enumLabel } from "@/lib/labels";
import { dateTimeLabel } from "@/lib/dates";
import { inrAmount } from "@/lib/money";
import CaseEditor from "./CaseEditor";
export const dynamic = "force-dynamic";
export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePage([...CASE_READ]),
    { id } = await params,
    sp = await searchParams;
  let base;
  try {
    base = await caseFor(prisma, user, id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const finance = user.permissions.includes("payment:view"),
    tab = sp.tab ?? "overview",
    history = Math.max(1, Math.min(10000, Number(sp.history) || 1));
  const [
    customer,
    owner,
    services,
    bookings,
    visas,
    leads,
    events,
    eventCount,
    owners,
  ] = await Promise.all([
    prisma.customer.findUniqueOrThrow({
      where: { id: base.customerId },
      select: {
        id: true,
        name: true,
        code: true,
        phone: true,
        email: true,
        assignedToId: true,
        branchId: true,
      },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: base.ownerId },
      select: { name: true },
    }),
    prisma.serviceWork.findMany({
      where: { caseId: base.id },
      orderBy: { createdAt: "asc" },
    }),
    user.permissions.includes("ticketing:view")
      ? prisma.booking.findMany({
          where: { AND: [{ serviceCaseId: base.id }, childWorkScope(user)] },
          select: {
            id: true,
            bookingNo: true,
            status: true,
            sector: true,
            product: true,
            owner: { select: { name: true } },
          },
        })
      : [],
    user.permissions.includes("visa:view")
      ? prisma.visaCase.findMany({
          where: { AND: [{ serviceCaseId: base.id }, childWorkScope(user)] },
          select: {
            id: true,
            caseNo: true,
            destination: true,
            stage: { select: { name: true } },
            owner: { select: { name: true } },
          },
        })
      : [],
    user.permissions.includes("customer:view")
      ? prisma.salesLead.findMany({
          where: { AND: [{ serviceCaseId: base.id }, childWorkScope(user)] },
          select: { id: true, title: true, stage: true },
        })
      : [],
    tab === "history"
      ? prisma.serviceCaseEvent.findMany({
          where: {
            caseId: base.id,
            OR: [
              { permission: null },
              { permission: { in: user.permissions } },
            ],
          },
          orderBy: [{ at: "desc" }, { id: "desc" }],
          skip: (history - 1) * 50,
          take: 50,
        })
      : [],
    tab === "history"
      ? prisma.serviceCaseEvent.count({
          where: {
            caseId: base.id,
            OR: [
              { permission: null },
              { permission: { in: user.permissions } },
            ],
          },
        })
      : 0,
    canAssignCase(user)
      ? prisma.user.findMany({
          where: {
            active: true,
            ...(user.accessMode === "ALL" ? {} : { branchId: base.branchId }),
          },
          select: { id: true, name: true, role: { select: { key: true } } },
          orderBy: { name: "asc" },
        })
      : [],
  ]);
  const people = await prisma.user.findMany({
      where: {
        id: {
          in: [
            ...new Set(events.flatMap((e) => (e.actorId ? [e.actorId] : []))),
          ],
        },
      },
      select: { id: true, name: true },
    }),
    names = new Map(people.map((p) => [p.id, p.name]));
  const ownerOptions = owners
    .filter((o) => roleCanOwnCase(o.role.key))
    .map(({ id, name }) => ({ id, name }));
  if (!ownerOptions.some((o) => o.id === base.ownerId))
    ownerOptions.push({ id: base.ownerId, name: owner.name });
  const workQuery = new URLSearchParams({ case: base.id, view: "all" });
  for (const [k, v] of Object.entries(sp))
    if (v && ["view", "q", "owner", "service", "page"].includes(k))
      workQuery.set(k, v);
  const work = user.permissions.includes("task:view")
    ? await readWork(user, workQuery)
    : null;
  const documents =
    tab === "documents" && user.permissions.includes("document:view")
      ? await prisma.document.findMany({
          where: { visaCaseId: { in: visas.map((v) => v.id) } },
          select: {
            id: true,
            docNo: true,
            docType: true,
            status: true,
            verificationStatus: true,
          },
          take: 100,
          orderBy: { createdAt: "desc" },
        })
      : [];
  const payments =
    tab === "money" && finance
      ? await prisma.payment.findMany({
          where: {
            OR: [
              { bookingId: { in: bookings.map((b) => b.id) } },
              { visaCaseId: { in: visas.map((v) => v.id) } },
              {
                invoice: {
                  OR: [
                    { bookingId: { in: bookings.map((b) => b.id) } },
                    { visaCaseId: { in: visas.map((v) => v.id) } },
                  ],
                },
              },
            ],
          },
          select: { id: true, receiptNo: true, amount: true, receivedOn: true },
          take: 100,
          orderBy: { receivedOn: "desc" },
        })
      : [];
  const refunds =
    tab === "money" && user.permissions.includes("refund:view")
      ? await prisma.refund.findMany({
          where: { bookingId: { in: bookings.map((b) => b.id) } },
          select: { id: true, refundNo: true, status: true, amount: true },
          take: 100,
        })
      : [];
  const tabs = [
    { id: "overview", label: "Overview" },
    ...(work ? [{ id: "work", label: "Work" }] : []),
    ...(user.permissions.includes("document:view")
      ? [{ id: "documents", label: "Documents" }]
      : []),
    ...(user.permissions.includes("whatsapp:view")
      ? [{ id: "conversation", label: "Conversation" }]
      : []),
    ...(finance ? [{ id: "money", label: "Money" }] : []),
    { id: "history", label: "History" },
  ];
  const next = user.permissions.includes("task:view")
    ? await prisma.task.findFirst({
        where: {
          AND: [
            taskScope(user),
            { serviceCaseId: base.id, status: { in: ["OPEN", "IN_PROGRESS"] } },
          ],
        },
        select: {
          id: true,
          title: true,
          unassigned: true,
          owner: { select: { name: true, active: true } },
        },
        orderBy: [
          { dueAt: { sort: "asc", nulls: "last" } },
          { createdAt: "asc" },
          { id: "asc" },
        ],
      })
    : null;
  return (
    <div className="workspace-page work-desk">
      <PageHeader
        eyebrow="Permanent case ID"
        title={base.caseNo}
        description={base.title}
        actions={
          <Link className="btn-secondary" href="/cases">
            Back to cases
          </Link>
        }
      />
      {base.importedAt&&<section className="panel p-5 space-y-2" aria-label="Imported case provenance"><h2 className="font-semibold">Imported case history</h2><p className="break-words">Original reference: <strong>{base.legacyReference}</strong> · Source: {base.importSource}</p>{base.legacyStage&&<p>Original stage: {base.legacyStage}</p>}<p className="text-sm text-slate-600">Imported {dateTimeLabel(base.importedAt)}. Historical status is retained for context. Review the original documents and record supplier confirmations and financial transactions through the linked workflows.</p></section>}
      <div className="panel p-5 case-journey-summary">
        <div className="work-toolbar">
          <div>
            <strong>{customer.name}</strong>
            <p>
              {services.map((w) => enumLabel(w.service)).join(" + ")} ·
              Coordinator: {owner.name}
            </p>
          </div>
          <Status tone={base.status === "COMPLETED" ? "success" : "info"}>
            {enumLabel(base.status)}
          </Status>
        </div>
        <p className="mt-4">
          Next action:{" "}
          {next ? (
            <Link
              className="text-blue-700 underline"
              href={"/work?task=" + next.id}
            >
              {next.title} ·{" "}
              {next.unassigned || !next.owner.active
                ? "Unassigned"
                : next.owner.name}
            </Link>
          ) : (
            "No open work recorded"
          )}
        </p>
        <p className="mt-2 text-slate-600">
          {base.nextFollowUpAt
            ? "Case follow-up: " + dateTimeLabel(base.nextFollowUpAt)
            : "Set a follow-up when waiting on a customer or authority."}
        </p>
        <details className="case-contact-details">
          <summary>Contact customer</summary>
          <div
            className="work-context-links mt-4"
            aria-label="Case customer contact"
          >
            {customer.phone && (
              <a href={"tel:" + customer.phone.replace(/[^+0-9]/g, "")}>
                Call {customer.phone}
              </a>
            )}
            {customer.email && (
              <a href={"mailto:" + encodeURIComponent(customer.email)}>
                Email {customer.email}
              </a>
            )}
          </div>
        </details>
      </div>
      <nav className="case-work-tabs" aria-label="Case views">
        {tabs.map((t) => (
          <Link
            key={t.id}
            aria-current={tab === t.id ? "page" : undefined}
            href={"/cases/" + base.id + "?tab=" + t.id}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "overview" && (
        <>
          <div className="work-toolbar mb-5">
            <div>
              <h2>Service work and outcomes</h2>
              <p>
                Task completion, supplier confirmation, visa decisions and money
                keep their own status.
              </p>
            </div>
            {work && (
              <Link
                className="btn-primary"
                href={"/cases/" + base.id + "?tab=work"}
              >
                Open case work
              </Link>
            )}
          </div>
          <div className="work-context-links mb-5">
            {canTouchRecord(user, customer) && (
              <Link href={"/customers/" + customer.id}>
                Customer & travellers
              </Link>
            )}
            {user.permissions.includes("customer:create") &&
              services.some((w) => w.service !== "VISA") && (
                <Link href={"/sales?action=new&case=" + base.id}>
                  Prepare quotation
                </Link>
              )}
            {!base.closedAt &&
              services.map((w) =>
                w.service === "VISA"
                  ? user.permissions.includes("visa:create") && (
                      <Link key={w.id} href={"/visa/new?case=" + base.id}>
                        Add visa application
                      </Link>
                    )
                  : user.permissions.includes("ticketing:create") && (
                      <Link
                        key={w.id}
                        href={
                          "/ticketing/new?case=" +
                          base.id +
                          "&product=" +
                          w.service
                        }
                      >
                        Add {w.service.toLowerCase()} booking
                      </Link>
                    ),
              )}
          </div>
          <div className="case-detail-grid">
            <section className="panel p-5">
              <h2 className="text-lg font-semibold">Source records</h2>
              <ul className="case-record-list">
                {leads.map((l) => (
                  <li key={l.id}>
                    <Link href={"/sales?lead=" + l.id}>{l.title}</Link>
                    <span>{enumLabel(l.stage)} · Enquiry</span>
                  </li>
                ))}
                {bookings.map((b) => (
                  <li key={b.id}>
                    <Link href={"/ticketing/" + b.id}>
                      {b.bookingNo} · {b.sector || enumLabel(b.product)}
                    </Link>
                    <span>
                      {enumLabel(b.status)} · {b.owner.name}
                    </span>
                  </li>
                ))}
                {visas.map((v) => (
                  <li key={v.id}>
                    <Link href={"/visa/" + v.id}>
                      Application {v.caseNo} · {v.destination}
                    </Link>
                    <span>
                      {v.stage.name} · {v.owner.name}
                    </span>
                  </li>
                ))}
              </ul>
              {!leads.length && !bookings.length && !visas.length && (
                <EmptyState
                  title="No visible service records yet"
                  description="Assign and plan the service steps, then create the source application or booking from this case."
                />
              )}
            </section>
            {canEditCase(user) && (
              <CaseEditor
                key={base.updatedAt.toISOString()}
                record={{
                  id: base.id,
                  version: base.updatedAt.toISOString(),
                  status: base.status,
                  ownerId: base.ownerId,
                  followUp: base.nextFollowUpAt?.toISOString() ?? null,
                }}
                owners={ownerOptions}
                canAssign={canAssignCase(user)}
              />
            )}
          </div>
        </>
      )}
      {tab === "work" && work && (
        <Suspense fallback={<p role="status">Loading case work…</p>}>
          <WorkDesk initialData={work} caseId={base.id} embedded />
        </Suspense>
      )}
      {tab === "documents" && (
        <section className="panel p-5">
          <h2 className="text-lg font-semibold">Case documents</h2>
          <ul className="case-record-list">
            {documents.map((d) => (
              <li key={d.id}>
                <Link href={"/documents?focus=" + d.id}>
                  {d.docNo} · {d.docType}
                </Link>
                <span>
                  {enumLabel(d.status)} · {enumLabel(d.verificationStatus)}
                </span>
              </li>
            ))}
          </ul>
          <p className="work-report-note">
            Latest 100 documents for service records visible to your role. Open
            the application for the complete dossier.
          </p>
        </section>
      )}
      {tab === "conversation" && user.permissions.includes("whatsapp:view") && (
        <CaseConversation
          key={base.id}
          caseId={base.id}
          customerId={customer.id}
          customerAccess={canTouchRecord(user, customer)}
        />
      )}
      {tab === "money" && finance && (
        <section className="panel p-5">
          <h2 className="text-lg font-semibold">Case receipts and refunds</h2>
          <ul className="case-record-list">
            {payments.map((p) => (
              <li key={p.id}>
                <Link href={"/payments?focus=" + p.id}>{p.receiptNo}</Link>
                <span>
                  {inrAmount(p.amount)} received · {dateTimeLabel(p.receivedOn)}
                </span>
              </li>
            ))}
            {refunds.map((r) => (
              <li key={r.id}>
                <Link href={"/refunds?focus=" + r.id}>{r.refundNo}</Link>
                <span>
                  {enumLabel(r.status)} · {inrAmount(r.amount)}
                </span>
              </li>
            ))}
          </ul>
          <p className="work-report-note">
            Latest 100 receipts/refunds. These records are not a net balance.
            Customer statements retain complete reconciled financial history.
          </p>
          <Link
            className="btn-primary"
            href={"/reports?report=statement&customerId=" + customer.id}
          >
            Open customer statement
          </Link>
          <Link
            className="btn-secondary ml-3"
            href={"/payments?customer=" + customer.id}
          >
            Invoices & receipts
          </Link>
        </section>
      )}
      {tab === "history" && (
        <section className="panel p-5">
          <h2 className="text-lg font-semibold">Case history</h2>
          <ol className="case-history">
            {events.map((e) => (
              <li key={e.id}>
                <p className="whitespace-pre-wrap">{e.summary}</p>
                <p className="text-slate-600 mt-2">
                  {dateTimeLabel(e.at)} ·{" "}
                  {e.actorId
                    ? (names.get(e.actorId) ?? "Former staff member")
                    : "System"}
                </p>
                {e.href && (
                  <Link
                    className="inline-flex min-h-11 items-center underline"
                    href={e.href}
                  >
                    Open source record
                  </Link>
                )}
              </li>
            ))}
          </ol>
          <nav className="flex gap-3" aria-label="History pages">
            {history > 1 && (
              <Link
                className="btn-secondary"
                href={"?tab=history&history=" + (history - 1)}
              >
                Newer history
              </Link>
            )}
            {history * 50 < eventCount && (
              <Link
                className="btn-secondary"
                href={"?tab=history&history=" + (history + 1)}
              >
                Older history
              </Link>
            )}
          </nav>
        </section>
      )}
    </div>
  );
}
