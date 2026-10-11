import { login } from "@/lib/session";
import { jsonError } from "@/lib/guard";
import {
  clientIp,
  loginLimitKeys,
  isLockedOut,
  recordFailure,
  clearFailures,
  retryAfterSeconds,
} from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();
    const keys = loginLimitKeys(String(email ?? ""), clientIp(req));
    // Checked before the password is compared, so a locked account costs no hashing work.
    for (const key of keys) {
      if (isLockedOut(key)) {
        const seconds = retryAfterSeconds(key);
        return Response.json(
          { error: `Too many failed attempts. Try again in ${Math.ceil(seconds / 60)} minute(s).` },
          { status: 429, headers: { "Retry-After": String(seconds) } },
        );
      }
    }
    const user = await login(String(email ?? ""), String(password ?? ""), req);
    if (!user) {
      for (const key of keys) recordFailure(key);
      return Response.json({ error: "Invalid email or password" }, { status: 401 });
    }
    // A successful sign-in clears the account bucket. The address bucket is deliberately left
    // alone: it accumulates failures from every account tried from that address, so clearing it
    // here would let an attacker reset their own allowance by signing into an account they control.
    const accountKey = keys.find((key) => key.startsWith("email:"));
    if (accountKey) clearFailures(accountKey);
    return Response.json({ user });
  } catch (e) {
    return jsonError(e, "auth/login");
  }
}
