import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";

export async function GET() {
  try {
    await requireSession("visa:view");
    const stages = await prisma.visaStage.findMany({ orderBy: { seq: "asc" } });
    return Response.json({ stages });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireSession("settings:manage");
    const b = await req.json();
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name || name.length > 60) throw new ApiError(400, "Enter a stage name of 1–60 characters.");
    const maxSeq = await prisma.visaStage.aggregate({ _max: { seq: true } });
    const stage = await prisma.visaStage.create({
      data: { key: name.toUpperCase().replace(/[^A-Z0-9]+/g, "_"), name, seq: (maxSeq._max.seq ?? 0) + 1, system: false },
    });
    await audit(user, "CREATE", "VisaStage", stage.id, name);
    return Response.json({ ok: true, stage });
  } catch (e) {
    return jsonError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireSession("settings:manage");
    const b = await req.json();
    const { id, name, seq, active } = b;
    if (!id) throw new ApiError(400, "id required");
    const existing = await prisma.visaStage.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Stage not found");
    if (existing.system && (name !== undefined && name !== existing.name)) {
      throw new ApiError(400, "System stage names cannot be changed; deactivate instead");
    }
    // Switching a stage off is only safe while nothing depends on it being available. A stage the
    // workflow cannot start from, or that open cases are sitting in, strands live work — and the
    // person who notices is usually a manager trying to create a case, not the person who clicked.
    const deactivating = active === false && existing.active;
    if (deactivating && existing.key === "ENQUIRY") {
      throw new ApiError(400, "The enquiry stage cannot be deactivated: every new visa case starts there.");
    }
    if (deactivating) {
      const open = await prisma.visaCase.count({ where: { stageId: id, closedAt: null } });
      if (open > 0) throw new ApiError(400, `${open} open case${open === 1 ? "" : "s"} still in this stage. Move them on before deactivating it.`);
    }
    const stage = await prisma.visaStage.update({
      where: { id },
      data: {
        name: name ?? existing.name,
        seq: seq ?? existing.seq,
        active: active ?? existing.active,
      },
    });
    await audit(user, "UPDATE", "VisaStage", id, deactivating ? `Deactivated · ${existing.name}` : existing.name);
    return Response.json({ ok: true, stage });
  } catch (e) {
    return jsonError(e);
  }
}
