import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { workReport } from "@/lib/work-reports";
import { csvDocument } from "@/lib/csv-export";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const u = await requireSession("task:view"),
      q = new URL(req.url).searchParams,
      r = await workReport(u, q);
    if (q.get("format") === "csv") {
      if (!r.canExport)
        throw new ApiError(403, "Export permission is required.");
      const rows =
        q.get("dataset") === "backlog"
          ? [
              [
                "Max ID",
                "Task",
                "Assignee",
                "State",
                "Due UTC",
                "Waiting on",
                "Next check UTC",
              ],
              ...r.backlog.map((t) => [
                t.caseNo,
                t.title,
                t.assignee,
                t.state,
                t.dueAt,
                t.waitingReason,
                t.nextCheckAt,
              ]),
            ]
          : [
              [
                "At UTC",
                "Max ID",
                "Task",
                "Event",
                "Assignee at event",
                "Actor",
                "Original due UTC",
                "Revised due UTC",
                "Outcome",
              ],
              ...r.events.map((e) => [
                e.at,
                e.caseNo,
                e.title,
                e.kind,
                e.assignee,
                e.actor,
                e.originalDueAt,
                e.dueAt,
                e.detail,
              ]),
            ];
      return new Response(
        csvDocument([[r.scope, r.from, r.to], [r.basis], [], ...rows]),
        {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": "attachment; filename=work-report.csv",
            "Cache-Control": "private, no-store",
          },
        },
      );
    }
    return Response.json(r, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return jsonError(e);
  }
}
