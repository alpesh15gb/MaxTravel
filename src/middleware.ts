import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const configured = process.env.APP_ORIGIN;
    let allowed = !origin;
    if (origin) {
      try {
        const source = new URL(origin);
        allowed = configured
          ? source.origin === new URL(configured).origin
          : source.host === request.headers.get("host") && ["http:", "https:"].includes(source.protocol);
      } catch { allowed = false; }
    }
    if (!allowed || request.headers.get("sec-fetch-site") === "cross-site") {
      return NextResponse.json({ error: "This action must be completed from your agency workspace." }, { status: 403 });
    }
  }
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/api/:path*"] };
