import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import bcrypt from "bcryptjs";
import { clearSessionCookie } from "@/lib/session";

export async function POST(req: Request) {
  try {
    const user = await requireSession();
    const { currentPassword, newPassword } = await req.json();
    if (!currentPassword || !newPassword || String(newPassword).length < 12 || Buffer.byteLength(String(newPassword)) > 72 || !/[a-zA-Z]/.test(String(newPassword)) || !/[^a-zA-Z]/.test(String(newPassword))) {
      throw new ApiError(400, "Use 12 or more characters including a letter and number or symbol; maximum 72 bytes.");
    }
    const rec = await prisma.user.findUnique({ where: { id: user.id } });
    if (!rec) throw new ApiError(404, "User not found");
    const ok = await bcrypt.compare(String(currentPassword), rec.passwordHash);
    if (!ok) throw new ApiError(403, "Current password is incorrect");

    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(String(newPassword), 12) } });
    await audit(user, "CHANGE_PASSWORD", "User", user.id);
    await clearSessionCookie();
    return Response.json({ ok: true, relogin: true });
  } catch (e) {
    return jsonError(e);
  }
}
