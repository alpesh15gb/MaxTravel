// Throttling for the two unauthenticated endpoints that must exist on the public internet:
// sign-in and first-run setup.
//
// Two buckets guard a sign-in, because they stop different attacks:
//
//   - one per account, so nobody can grind a single person's password;
//   - one per client address, so one source cannot spray a few common passwords across every
//     account in the agency (each individual account would stay under its own limit).
//
// The account bucket is the authoritative one. The address bucket is best-effort anti-abuse: a
// client can influence the forwarded header, so it must never be the only thing standing between an
// attacker and an account — and it is deliberately loose enough (20) that a shared office NAT is
// not locked out by one person mistyping a password.
//
// This limiter lives in the process's memory. That is honest for this project's single-node SQLite
// deployment and wrong the moment a second instance runs, since each instance would keep its own
// count and multiply the effective limit. docs/operations.md records that decision; a shared store
// (Redis or the database itself) is the fix when this app moves behind a load balancer.

export interface RateLimitPolicy {
  /** Failed attempts allowed inside the window before the key is locked. */
  limit: number;
  windowMs: number;
}

export const ACCOUNT_POLICY: RateLimitPolicy = { limit: 5, windowMs: 10 * 60 * 1000 };
export const ADDRESS_POLICY: RateLimitPolicy = { limit: 20, windowMs: 10 * 60 * 1000 };

/** Ceiling on tracked keys, so a flood of forged addresses cannot grow this map without bound. */
const MAX_KEYS = 10_000;

const failures = new Map<string, number[]>();

/** The policy for a key, decided by its prefix. Any key without one gets the account policy. */
export function policyFor(key: string): RateLimitPolicy {
  return key.startsWith("ip:") || key.startsWith("login:") ? ADDRESS_POLICY : ACCOUNT_POLICY;
}

/** Drop older attempts and report the ones still inside the window. */
function recent(key: string, now = Date.now()): number[] {
  const policy = policyFor(key);
  const list = (failures.get(key) ?? []).filter((t) => now - t < policy.windowMs);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}

/** Evict the least recently active keys if the map has grown past its ceiling. */
function evictIfNeeded() {
  if (failures.size <= MAX_KEYS) return;
  const oldest = [...failures.entries()]
    .map(([key, list]) => [key, Math.max(...list)] as const)
    .sort((a, b) => a[1] - b[1]);
  for (const [key] of oldest.slice(0, oldest.length - Math.floor(MAX_KEYS * 0.9))) failures.delete(key);
}

export function isLockedOut(key: string): boolean {
  return recent(key).length >= policyFor(key).limit;
}

/** Seconds until this key may try again; 0 when it is not locked. */
export function retryAfterSeconds(key: string): number {
  const list = recent(key);
  const policy = policyFor(key);
  if (list.length < policy.limit) return 0;
  const oldest = Math.min(...list);
  return Math.max(1, Math.ceil((oldest + policy.windowMs - Date.now()) / 1000));
}

export function recordFailure(key: string) {
  const list = failures.get(key) ?? [];
  list.push(Date.now());
  failures.set(key, list);
  evictIfNeeded();
}

export function clearFailures(key: string) {
  failures.delete(key);
}

/**
 * Best-effort client address for the address bucket.
 *
 * `x-forwarded-for` is a client-controllable header, so the entry that means something depends on
 * what sits in front of the app. Behind a proxy we trust (TRUST_PROXY=1) the left-most entry is the
 * address that proxy recorded; without one, our own server appended the address it accepted the
 * connection from, which is the right-most entry. Unset or unparseable means no address bucket at
 * all, never a shared "unknown" bucket that would lock out everyone at once.
 */
export function clientIp(req: Request): string | null {
  const trustProxy = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY ?? "");
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((h) => h.trim()).filter(Boolean);
    const candidate = trustProxy ? hops[0] : hops[hops.length - 1];
    if (candidate) return candidate.slice(0, 64);
  }
  const real = req.headers.get("x-real-ip")?.trim();
  return real ? real.slice(0, 64) : null;
}

/** The buckets a sign-in attempt counts against: the account, the address, or the request shape. */
export function loginLimitKeys(email: string, ip: string | null): string[] {
  const keys: string[] = [];
  const normalized = email.toLowerCase().trim();
  if (normalized) keys.push(`email:${normalized}`);
  if (ip) keys.push(`ip:${ip}`);
  // Never return an empty list. A request with no usable address and no account still has to be
  // throttled, or a malformed flood would be completely unrationed.
  if (!keys.length) keys.push("login:malformed");
  return keys;
}

/** Test seam: forget every recorded failure. */
export function resetRateLimits() {
  failures.clear();
}
