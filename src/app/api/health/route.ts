// Liveness/readiness probe for a reverse proxy, a container orchestrator or an uptime monitor.
//
// It answers one question honestly: can this instance serve requests right now? It is deliberately
// unauthenticated (a probe cannot hold a session), so it must reveal nothing an attacker can use —
// no versions, no paths, no configuration, no stack traces. A failing check answers 503 rather than
// 200, so a load balancer stops sending traffic here instead of handing staff 500s.
//
// Two checks, because "the app is running" and "the app can work" are different things:
//   1. the database answers at all; and
//   2. the schema has actually been deployed. A connection to an empty SQLite file succeeds, so a
//      connection-only probe would report a healthy instance whose every page throws.

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const PING_TIMEOUT_MS = 2500;

/** Runs a statement with a deadline, so a wedged database cannot hang the probe itself. */
async function within(statement: Promise<unknown>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("database check timed out")), PING_TIMEOUT_MS);
    });
    await Promise.race([statement, timeout]);
    return true;
  } catch (e) {
    console.error("[health] check failed:", e instanceof Error ? e.message : e);
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET() {
  const started = Date.now();
  const database = await within(prisma.$queryRaw`SELECT 1`);
  // Prisma records every applied migration here. Its absence means the schema was never deployed,
  // which the container's entrypoint or `npm run db:migrate` fixes.
  const schema = database
    ? await within(Promise.all([
      prisma.$queryRawUnsafe("SELECT COUNT(*) FROM \"_prisma_migrations\""),
      prisma.$queryRawUnsafe("SELECT t.\"workState\",t.\"version\",t.\"resultType\",w.\"templateVersion\",e.\"taskTitle\",e.\"caseNo\",m.\"bodyHash\",c.\"messageId\" FROM \"Task\" t,\"ServiceWork\" w,\"WorkEvent\" e,\"WorkMutation\" m,\"CaseMessage\" c LIMIT 0"),
      prisma.$queryRawUnsafe("SELECT s.\"id\", m.\"lastStep\", r.\"tokenHash\", l.\"title\", q.\"items\", i.\"documentId\", t.\"passportLookup\", d.\"sensitive\", a.\"keyHash\" FROM \"StaffSession\" s, \"StaffMfa\" m, \"StaffRecovery\" r, \"SalesLead\" l, \"SalesQuote\" q, \"IncomingMedia\" i, \"Traveller\" t, \"Document\" d, \"StaffAuthFailure\" a LIMIT 0"),
      prisma.$queryRawUnsafe("SELECT v.\"visaCaseId\" FROM \"SupplierDue\" v LIMIT 0"),
      prisma.$queryRawUnsafe("SELECT c.\"profileData\",t.\"profileData\",l.\"memberNumber\",i.\"documentNumber\",m.\"bodyHash\" FROM \"Customer\" c,\"Traveller\" t,\"TravellerLoyaltyMembership\" l,\"TravellerIdentityDocument\" i,\"MasterMutation\" m LIMIT 0"),
      prisma.$queryRawUnsafe("SELECT t.\"nextSequence\",m.\"lastReadSequence\",s.\"sequence\",s.\"body\" FROM \"StaffChatThread\" t,\"StaffChatMember\" m,\"StaffChatMessage\" s LIMIT 0"),
      prisma.$queryRawUnsafe("SELECT a.\"fileHash\",d.\"tokenCipher\",e.\"body\",e.\"visaCaseId\",p.\"amountMinor\",c.\"bodyHash\",s.\"paymentId\",m.\"bodyHash\" FROM \"BookingArtifact\" a,\"ClientDelivery\" d,\"ClientEmail\" e,\"PaymentCollection\" p,\"CollectionEvent\" c,\"CollectionSettlement\" s,\"AgencyMutation\" m LIMIT 0"),
      prisma.$queryRawUnsafe("SELECT b.\"supplierCostConfirmed\",b.\"travelScope\",b.\"travelEndDate\",b.\"airlineChangeFee\",b.\"noShowFee\",v.\"supplierCost\",v.\"travelEndDate\",r.\"taxDifference\",r.\"quoteReference\" FROM \"Booking\" b,\"VisaCase\" v,\"Reissue\" r LIMIT 0"),
    ]))
    : false;

  const ok = database && schema;
  const body = {
    status: ok ? "ok" : "degraded",
    checks: {
      database: database ? "ok" : "unreachable",
      schema: database ? (schema ? "ok" : "not-deployed") : "unknown",
    },
    uptimeSeconds: Math.round(process.uptime()),
    checkedInMs: Date.now() - started,
    time: new Date().toISOString(),
  };
  return Response.json(body, {
    status: ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
