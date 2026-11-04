import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { workReport } from "@/lib/work-reports";
import { csvDocument } from "@/lib/csv-export";
import { dateLabel, dateTimeLabel } from "@/lib/dates";

const ist = (v: string | Date | null | undefined) => (v ? dateTimeLabel(v) : "");
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
                "Due (India time)",
                "Waiting on",
                "Next check (India time)",
              ],
              ...r.backlog.map((t) => [
                t.caseNo,
                t.title,
                t.assignee,
                t.state,
                ist(t.dueAt),
                t.waitingReason,
                ist(t.nextCheckAt),
              ]),
            ]
          : [
              [
                "When (India time)",
                "Max ID",
                "Task",
                "Event",
                "Assignee at event",
                "Actor",
                "Original due (India time)",
                "Revised due (India time)",
                "Outcome",
              ],
              ...r.events.map((e) => [
                ist(e.at),
                e.caseNo,
                e.title,
                e.kind,
                e.assignee,
                e.actor,
                ist(e.originalDueAt),
                ist(e.dueAt),
                e.detail,
              ]),
            ];
      return new Response(
        csvDocument([["Work report", r.scope, `${dateLabel(r.from)} to ${dateLabel(new Date(new Date(r.to).getTime() - 1))}`], [r.basis], [], ...rows]),
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
