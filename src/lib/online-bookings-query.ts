import type { Prisma } from "@prisma/client";

export const ONLINE_BOOKINGS_PAGE_SIZE = 50;
export const ONLINE_BOOKING_STATUSES = ["ENQUIRY", "QUOTE_SENT", "PNR_CREATED", "ON_HOLD", "PAYMENT_AWAITED", "TICKETED", "CANCELLED", "VOID", "REISSUE_REQUESTED", "REISSUED", "REFUND_REQUESTED", "REFUND_PENDING", "REFUNDED"] as const;
type Cursor = { createdAt: string; id: string };
export type OnlineBookingFilters = { q: string; product: string; status: string; cursor?: Cursor; direction: "older" | "newer"; invalid: boolean };
export type SearchParams = Record<string, string | string[] | undefined>;

export function parseOnlineBookingFilters(params: SearchParams): OnlineBookingFilters {
  let invalid = false;
  const single = (key: string) => { const value = params[key]; if (Array.isArray(value)) { invalid = true; return ""; } return value ?? ""; };
  let q = single("q").trim(), product = single("product"), status = single("status");
  if (q.length > 100 || /[\u0000-\u001f]/.test(q)) { q = ""; invalid = true; }
  if (product && !["FLIGHT", "HOTEL"].includes(product)) { product = ""; invalid = true; }
  if (status && !(ONLINE_BOOKING_STATUSES as readonly string[]).includes(status)) { status = ""; invalid = true; }
  const raw = single("cursor"), rawDirection = single("direction");
  const direction = rawDirection === "newer" ? "newer" : "older";
  if (rawDirection && !["older", "newer"].includes(rawDirection)) invalid = true;
  let cursor: Cursor | undefined;
  if (raw) {
    try {
      if (raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw Error();
      const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
      if (!value || typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id) || typeof value.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) || new Date(value.createdAt).toISOString() !== value.createdAt) throw Error();
      cursor = { id: value.id, createdAt: value.createdAt };
    } catch { invalid = true; }
  } else if (rawDirection) invalid = true;
  return { q, product, status, cursor, direction, invalid };
}

export function onlineBookingQuery(filters: OnlineBookingFilters, scope: Prisma.BookingWhereInput): Prisma.BookingFindManyArgs {
  const conditions: Prisma.BookingWhereInput[] = [{ gdsSource: "TRIPJACK_API" }, scope];
  // Fail closed for malformed filters instead of silently widening the staff queue.
  if (filters.invalid) conditions.push({ id: { in: [] } });
  if (filters.product) conditions.push({ product: filters.product });
  if (filters.status) conditions.push({ status: filters.status });
  if (filters.q) conditions.push({ OR: [{ bookingNo: { contains: filters.q } }, { pnr: { contains: filters.q } }, { customer: { name: { contains: filters.q } } }] });
  if (filters.cursor) {
    const compare = filters.direction === "newer" ? "gt" : "lt";
    const createdAt = new Date(filters.cursor.createdAt);
    conditions.push({ OR: [{ createdAt: { [compare]: createdAt } }, { createdAt, id: { [compare]: filters.cursor.id } }] });
  }
  const order = filters.direction === "newer" ? "asc" : "desc";
  return { where: { AND: conditions }, orderBy: [{ createdAt: order }, { id: order }], take: ONLINE_BOOKINGS_PAGE_SIZE + 1 };
}

export function onlineBookingPage<T>(results: T[], filters: OnlineBookingFilters) {
  const hasMore = results.length > ONLINE_BOOKINGS_PAGE_SIZE;
  const rows = results.slice(0, ONLINE_BOOKINGS_PAGE_SIZE);
  if (filters.direction === "newer") rows.reverse();
  return { rows, hasOlder: filters.direction === "older" ? hasMore : !!filters.cursor, hasNewer: filters.direction === "newer" ? hasMore : !!filters.cursor };
}

export function onlineBookingsHref(filters: OnlineBookingFilters, direction?: "older" | "newer", row?: { id: string; createdAt: Date }) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.product) params.set("product", filters.product);
  if (filters.status) params.set("status", filters.status);
  if (direction && row) {
    params.set("direction", direction);
    params.set("cursor", Buffer.from(JSON.stringify({ id: row.id, createdAt: row.createdAt.toISOString() })).toString("base64url"));
  }
  return `/online-bookings${params.size ? `?${params}` : ""}`;
}
