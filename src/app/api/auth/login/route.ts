import {boundedJson} from "@/lib/bounded-json";
import { login } from "@/lib/session";
import { jsonError } from "@/lib/guard";
import {


  isLockedOut,
  recordFailure,
  clearFailures,
  retryAfterSeconds,
} from "@/lib/staff-auth-limit";
import {clientIp,loginLimitKeys} from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const { email, password, code } = await boundedJson(req);
    const keys = loginLimitKeys(String(email ?? ""), clientIp(req));
    // Checked before the password is compared, so a locked account costs no hashing work.
    for (const key of keys) {
      if (await isLockedOut(key)) {
        const seconds = await retryAfterSeconds(key);
        return Response.json(
          { error: `Too many failed attempts. Try again in ${Math.ceil(seconds / 60)} minute(s).` },
          { status: 429, headers: { "Retry-After": String(seconds) } },
        );
      }
    }
    const user = await login(String(email ?? ""), String(password ?? ""), req, String(code??""));
    if (!user) {
      for (const key of keys) await recordFailure(key);
      return Response.json({ error: "Invalid credentials or authenticator/recovery code" }, { status: 401 });
    }
    // A successful sign-in clears the account bucket. The address bucket is deliberately left
    // alone: it accumulates failures from every account tried from that address, so clearing it
    // here would let an attacker reset their own allowance by signing into an account they control.
    const accountKey = keys.find((key) => key.startsWith("email:"));
    if (accountKey) await clearFailures(accountKey);
    return Response.json({ user });
  } catch (e) {
    return jsonError(e, "auth/login");
  }
}
