import { eligiblePerson } from "@/lib/work-engine";
import { ROLE_PERMISSIONS, type RoleKey } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { boundedJson } from "@/lib/bounded-json";
import { readWorkConfig, workConfigSchema } from "@/lib/work-config";
export async function GET() {
  try {
    await requireSession("settings:manage");
    return Response.json(
      readWorkConfig(
        (
          await prisma.settings.findUnique({
            where: { key: "work.configuration" },
          })
        )?.value,
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
export async function POST(req: Request) {
  try {
    const u = await requireSession("settings:manage"),
      b = workConfigSchema.safeParse(await boundedJson(req, 262144));
    if (!b.success)
      throw new ApiError(
        400,
        b.error.issues[0]?.message ?? "Check the work rules.",
      );
    const version = await prisma.$transaction(async (tx) => {
      const current = readWorkConfig(
        (await tx.settings.findUnique({ where: { key: "work.configuration" } }))
          ?.value,
      );
      if (current.version !== b.data.version)
        throw new ApiError(409, "Work rules changed. Reload before saving.");
      for (const t of b.data.templates)
        for (const step of t.steps) {
          if (step.defaultOwnerId && step.defaultOwnerId !== "CASE_COORDINATOR")
            await eligiblePerson(
              tx,
              u,
              step.defaultOwnerId,
              null,
              t.service,
              false,
              step.resultType,
            );
          if (
            step.defaultReviewerId &&
            step.defaultReviewerId !== "CASE_COORDINATOR"
          )
            await eligiblePerson(
              tx,
              u,
              step.defaultReviewerId,
              null,
              t.service,
              true,
              step.resultType,
            );
        }
      for (const id of b.data.escalationUserIds) {
        const p = await tx.user.findUnique({
          where: { id },
          include: { role: true },
        });
        if (
          !p?.active ||
          !(ROLE_PERMISSIONS[p.role.key as RoleKey] ?? []).includes(
            "work:assign",
          )
        )
          throw new ApiError(
            400,
            "Choose active work managers for escalation.",
          );
      }
      const next = { ...b.data, version: current.version + 1 };
      await tx.settings.upsert({
        where: { key: "work.configuration" },
        create: { key: "work.configuration", value: JSON.stringify(next) },
        update: { value: JSON.stringify(next) },
      });
      await tx.auditLog.create({
        data: {
          userId: u.id,
          action: "CONFIGURE_WORK",
          entity: "Settings",
          detail: `Work template version ${next.version}. Existing tasks were not rewritten.`,
        },
      });
      return next.version;
    });
    return Response.json({ ok: true, version });
  } catch (e) {
    return jsonError(e);
  }
}
